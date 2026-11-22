use crate::auth::AuthUser;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use speakapp_shared::{Channel, Message, Permissions, Server, WsEvent};
use uuid::Uuid;

/// Max characters in a channel message or edit.
pub const MAX_MESSAGE_CHARS: usize = 4000;

pub(crate) fn check_message_len(content: &str) -> AppResult<()> {
    if content.chars().count() > MAX_MESSAGE_CHARS {
        return Err(AppError::BadRequest(format!(
            "message too long (max {MAX_MESSAGE_CHARS} characters)"
        )));
    }
    Ok(())
}

/// Per-user message rate limit, shared by channel messages and DMs.
pub(crate) fn check_message_rate(state: &AppState, user: &AuthUser) -> AppResult<()> {
    state
        .limits
        .check(crate::ratelimit::MESSAGE, &format!("user:{}", user.id))
}

/// Removes duplicates and checks every attachment was uploaded by `uploader`
/// and is not yet linked to a message. Runs inside the caller's transaction.
pub(crate) async fn validate_attachments(
    conn: &mut sqlx::SqliteConnection,
    ids: &[Uuid],
    uploader: Uuid,
) -> AppResult<Vec<Uuid>> {
    let mut unique: Vec<Uuid> = Vec::with_capacity(ids.len());
    for id in ids {
        if !unique.contains(id) {
            unique.push(*id);
        }
    }
    for aid in &unique {
        let ok: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM attachments WHERE id = ? AND message_id IS NULL AND uploader_id = ?",
        )
        .bind(aid.to_string())
        .bind(uploader.to_string())
        .fetch_optional(&mut *conn)
        .await?;
        if ok.is_none() {
            return Err(AppError::Forbidden);
        }
    }
    Ok(unique)
}

/// Links validated attachments to a new message. The `message_id IS NULL`
/// guard makes a concurrent claim fail instead of stealing the upload.
pub(crate) async fn link_attachments(
    conn: &mut sqlx::SqliteConnection,
    ids: &[Uuid],
    message_id: Uuid,
    uploader: Uuid,
) -> AppResult<()> {
    for aid in ids {
        let res = sqlx::query(
            "UPDATE attachments SET message_id = ? WHERE id = ? AND message_id IS NULL AND uploader_id = ?",
        )
        .bind(message_id.to_string())
        .bind(aid.to_string())
        .bind(uploader.to_string())
        .execute(&mut *conn)
        .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::Forbidden);
        }
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct CreateMessageReq {
    pub content: String,
    pub reply_to_id: Option<Uuid>,
    pub attachment_ids: Option<Vec<Uuid>>,
    /// A copy sent with "Forward".
    #[serde(default)]
    pub forwarded: bool,
}

#[derive(Deserialize)]
pub struct UpdateMessageReq {
    pub content: String,
}

async fn broadcast_to_viewers(
    state: &AppState,
    server: &Server,
    channel_id: Uuid,
    event: &WsEvent,
) -> AppResult<()> {
    let viewers = db::members_with_channel_perm(
        &state.db,
        server,
        channel_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;
    state.hub.broadcast_users(&viewers, event);
    Ok(())
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Vec<Message>>> {
    let channel = db::get_channel(&state.db, id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(id),
        user.id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;
    let msgs = db::list_messages(
        &state.db,
        id,
        q.before,
        q.limit.unwrap_or(50).clamp(1, 100),
        user.id,
    )
    .await?;
    Ok(Json(msgs))
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateMessageReq>,
) -> AppResult<Json<Message>> {
    let channel = db::get_channel(&state.db, id).await?;
    if channel.channel_type != speakapp_shared::ChannelType::Text {
        return Err(AppError::BadRequest("not a text channel".into()));
    }
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(id),
        user.id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;
    db::require_perm(
        &state.db,
        &server,
        Some(id),
        user.id,
        Permissions::SEND_MESSAGES,
    )
    .await?;
    db::require_not_timed_out(&state.db, server.id, user.id).await?;

    let content = body.content.trim();
    let has_attachments = body
        .attachment_ids
        .as_ref()
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    if content.is_empty() && !has_attachments {
        return Err(AppError::BadRequest("empty message".into()));
    }
    check_message_len(content)?;
    if has_attachments {
        db::require_perm(
            &state.db,
            &server,
            Some(id),
            user.id,
            Permissions::ATTACH_FILES,
        )
        .await?;
    }

    if !is_moderator(&state, &server, id, user.id).await? {
        check_slowmode(&state, &channel, user.id).await?;
        check_word_filter(&state, &server, content).await?;
    }
    check_message_rate(&state, &user)?;

    // Message + attachment links commit together, so a bad attachment never
    // leaves a message behind; the WebSocket event goes out only after commit.
    let mut tx = state.db.begin().await?;
    let attachment_ids = validate_attachments(
        &mut tx,
        body.attachment_ids.as_deref().unwrap_or(&[]),
        user.id,
    )
    .await?;

    // A reply must point at a message in this same channel.
    if let Some(target) = body.reply_to_id {
        let found: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM messages WHERE id = ? AND channel_id = ?")
                .bind(target.to_string())
                .bind(id.to_string())
                .fetch_optional(&mut *tx)
                .await?;
        if found.is_none() {
            return Err(AppError::BadRequest("reply target not found".into()));
        }
    }

    let msg_id = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, created_at, forwarded) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(msg_id.to_string())
    .bind(id.to_string())
    .bind(user.id.to_string())
    .bind(content)
    .bind(body.reply_to_id.map(|r| r.to_string()))
    .bind(&now)
    .bind(body.forwarded as i64)
    .execute(&mut *tx)
    .await?;

    link_attachments(&mut tx, &attachment_ids, msg_id, user.id).await?;
    tx.commit().await?;

    let message = db::load_message(&state.db, msg_id, user.id).await?;
    let author = db::user_public(&state.db, user.id).await?;
    broadcast_to_viewers(
        &state,
        &server,
        id,
        &WsEvent::MessageCreate {
            message: message.clone(),
            author,
        },
    )
    .await?;
    refresh_thread_parent(&state, &server, &channel, user.id).await;
    Ok(Json(message))
}

pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateMessageReq>,
) -> AppResult<Json<Message>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        author_id: String,
        channel_id: String,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT author_id, channel_id FROM messages WHERE id = ?",
    )
        .bind(id.to_string())
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    let author_id = Uuid::parse_str(&row.author_id).unwrap();
    let channel_id = Uuid::parse_str(&row.channel_id).unwrap();
    let channel = db::get_channel(&state.db, channel_id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(channel_id),
        user.id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;
    // Only the author edits a message. Manage Messages lets moderators
    // delete other people's messages, not rewrite them.
    if author_id != user.id {
        return Err(AppError::Forbidden);
    }
    let content = body.content.trim();
    check_message_len(content)?;
    if !is_moderator(&state, &server, channel_id, user.id).await? {
        check_word_filter(&state, &server, content).await?;
    }
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE messages SET content = ?, edited_at = ? WHERE id = ?")
        .bind(content)
        .bind(&now)
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    let message = db::load_message(&state.db, id, user.id).await?;
    broadcast_to_viewers(
        &state,
        &server,
        channel_id,
        &WsEvent::MessageUpdate {
            message: message.clone(),
        },
    )
    .await?;
    Ok(Json(message))
}

pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        author_id: String,
        channel_id: String,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT author_id, channel_id FROM messages WHERE id = ?",
    )
        .bind(id.to_string())
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    let author_id = Uuid::parse_str(&row.author_id).unwrap();
    let channel_id = Uuid::parse_str(&row.channel_id).unwrap();
    let channel = db::get_channel(&state.db, channel_id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(channel_id),
        user.id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;
    if author_id != user.id {
        db::require_perm(
            &state.db,
            &server,
            Some(channel_id),
            user.id,
            Permissions::MANAGE_MESSAGES,
        )
        .await?;
    }
    sqlx::query("DELETE FROM messages WHERE id = ?")
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    broadcast_to_viewers(
        &state,
        &server,
        channel_id,
        &WsEvent::MessageDelete {
            channel_id,
            message_id: id,
        },
    )
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
    /// Limit to one channel of the server.
    pub channel_id: Option<Uuid>,
    pub limit: Option<i64>,
}

#[derive(serde::Serialize)]
pub struct SearchResults {
    pub messages: Vec<Message>,
}

/// Turn user input into a safe FTS5 query: each word becomes a quoted prefix
/// term ("word"*), all required. No FTS syntax from the user gets through.
fn fts_query(raw: &str) -> Option<String> {
    let terms: Vec<String> = raw
        .split_whitespace()
        .map(|w| w.replace('"', ""))
        .filter(|w| !w.is_empty())
        .take(8)
        .map(|w| format!("\"{w}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

/// Search the text channels of a server the user can read, newest first.
pub async fn search(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<SearchResults>> {
    state.limits.check(crate::ratelimit::SEARCH, &user.id.to_string())?;
    let server = db::get_server(&state.db, server_id).await?;
    if !db::is_member(&state.db, server_id, user.id).await? && server.owner_id != user.id {
        return Err(AppError::Forbidden);
    }
    let Some(fts) = fts_query(q.q.trim()) else {
        return Ok(Json(SearchResults { messages: Vec::new() }));
    };
    if q.q.chars().count() > 200 {
        return Err(AppError::BadRequest("search is too long".into()));
    }
    let limit = q.limit.unwrap_or(25).clamp(1, 50);

    // Channels the user may read (one permission check per channel).
    let channels = db::server_channels(&state.db, server_id).await?;
    let mut readable = Vec::new();
    for c in channels {
        if c.channel_type != speakapp_shared::ChannelType::Text {
            continue;
        }
        if q.channel_id.is_some_and(|only| only != c.id) {
            continue;
        }
        let perms = db::effective_permissions(&state.db, &server, Some(c.id), user.id).await?;
        if perms.has(Permissions::VIEW_CHANNEL) {
            readable.push(c.id.to_string());
        }
    }
    if readable.is_empty() {
        return Ok(Json(SearchResults { messages: Vec::new() }));
    }

    let placeholders = vec!["?"; readable.len()].join(",");
    let sql = format!(
        "SELECT m.id FROM messages_fts f JOIN messages m ON m.rowid = f.rowid          WHERE messages_fts MATCH ? AND m.channel_id IN ({placeholders})          ORDER BY m.created_at DESC LIMIT ?"
    );
    let mut query = sqlx::query_scalar::<_, String>(&sql).bind(fts);
    for c in &readable {
        query = query.bind(c);
    }
    let ids = query.bind(limit).fetch_all(&state.db).await?;
    let mut messages = Vec::with_capacity(ids.len());
    for id in ids {
        if let Ok(id) = Uuid::parse_str(&id) {
            messages.push(db::load_message(&state.db, id, user.id).await?);
        }
    }
    Ok(Json(SearchResults { messages }))
}

/// Max pinned messages per channel (same as Discord).
const MAX_PINS: i64 = 50;

/// Pin or unpin a channel message. Needs Manage Messages in that channel.
async fn set_pinned(
    state: &AppState,
    user: &AuthUser,
    id: Uuid,
    pinned: bool,
) -> AppResult<Json<Message>> {
    let channel_id: String = sqlx::query_scalar("SELECT channel_id FROM messages WHERE id = ?")
        .bind(id.to_string())
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    let channel_id = Uuid::parse_str(&channel_id).map_err(|_| AppError::NotFound)?;
    let channel = db::get_channel(&state.db, channel_id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(&state.db, &server, Some(channel_id), user.id, Permissions::VIEW_CHANNEL).await?;
    db::require_perm(&state.db, &server, Some(channel_id), user.id, Permissions::MANAGE_MESSAGES).await?;

    if pinned {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(1) FROM messages WHERE channel_id = ? AND pinned_at IS NOT NULL AND id != ?",
        )
        .bind(channel_id.to_string())
        .bind(id.to_string())
        .fetch_one(&state.db)
        .await?;
        if count >= MAX_PINS {
            return Err(AppError::BadRequest(format!(
                "this channel already has {MAX_PINS} pinned messages"
            )));
        }
        sqlx::query("UPDATE messages SET pinned_at = COALESCE(pinned_at, ?), pinned_by = ? WHERE id = ?")
            .bind(Utc::now().to_rfc3339())
            .bind(user.id.to_string())
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    } else {
        sqlx::query("UPDATE messages SET pinned_at = NULL, pinned_by = NULL WHERE id = ?")
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    let message = db::load_message(&state.db, id, user.id).await?;
    broadcast_to_viewers(
        state,
        &server,
        channel_id,
        &WsEvent::MessageUpdate {
            message: message.clone(),
        },
    )
    .await?;
    Ok(Json(message))
}

pub async fn pin(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Message>> {
    set_pinned(&state, &user, id, true).await
}

pub async fn unpin(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Message>> {
    set_pinned(&state, &user, id, false).await
}

/// Pinned messages of a channel, newest pin first.
pub async fn list_pins(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Message>>> {
    let channel = db::get_channel(&state.db, id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(&state.db, &server, Some(id), user.id, Permissions::VIEW_CHANNEL).await?;
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM messages WHERE channel_id = ? AND pinned_at IS NOT NULL ORDER BY pinned_at DESC LIMIT ?",
    )
    .bind(id.to_string())
    .bind(MAX_PINS)
    .fetch_all(&state.db)
    .await?;
    let mut out = Vec::with_capacity(ids.len());
    for mid in ids {
        if let Ok(mid) = Uuid::parse_str(&mid) {
            out.push(db::load_message(&state.db, mid, user.id).await?);
        }
    }
    Ok(Json(out))
}

pub async fn add_reaction(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, emoji)): Path<(Uuid, String)>,
) -> AppResult<Json<serde_json::Value>> {
    state.limits.check(crate::ratelimit::REACTION, &user.id.to_string())?;
    let message = db::load_message(&state.db, id, user.id).await?;
    let channel = db::get_channel(&state.db, message.channel_id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(channel.id),
        user.id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;
    db::require_perm(
        &state.db,
        &server,
        Some(channel.id),
        user.id,
        Permissions::ADD_REACTIONS,
    )
    .await?;
    db::require_not_timed_out(&state.db, server.id, user.id).await?;
    sqlx::query(
        "INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(user.id.to_string())
    .bind(&emoji)
    .execute(&state.db)
    .await?;
    broadcast_to_viewers(
        &state,
        &server,
        channel.id,
        &WsEvent::ReactionAdd {
            channel_id: channel.id,
            message_id: id,
            emoji,
            user_id: user.id,
        },
    )
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_reaction(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, emoji)): Path<(Uuid, String)>,
) -> AppResult<Json<serde_json::Value>> {
    let message = db::load_message(&state.db, id, user.id).await?;
    let channel = db::get_channel(&state.db, message.channel_id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(channel.id),
        user.id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;
    sqlx::query("DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?")
        .bind(id.to_string())
        .bind(user.id.to_string())
        .bind(&emoji)
        .execute(&state.db)
        .await?;
    broadcast_to_viewers(
        &state,
        &server,
        channel.id,
        &WsEvent::ReactionRemove {
            channel_id: channel.id,
            message_id: id,
            emoji,
            user_id: user.id,
        },
    )
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn typing(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let channel = db::get_channel(&state.db, id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(id),
        user.id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;
    db::require_not_timed_out(&state.db, server.id, user.id).await?;
    let u = db::user_public(&state.db, user.id).await?;
    broadcast_to_viewers(
        &state,
        &server,
        id,
        &WsEvent::TypingStart {
            channel_id: id,
            user_id: user.id,
            username: u.username,
        },
    )
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ------------------------------------------------- slow mode / word filter

/// Moderators skip slow mode and the word filter.
async fn is_moderator(state: &AppState, server: &Server, channel_id: Uuid, user: Uuid) -> AppResult<bool> {
    let perms = db::effective_permissions(&state.db, server, Some(channel_id), user).await?;
    Ok(perms.has(Permissions::MANAGE_MESSAGES) || perms.has(Permissions::MANAGE_CHANNELS))
}

async fn check_slowmode(state: &AppState, channel: &Channel, user: Uuid) -> AppResult<()> {
    if channel.slowmode_seconds <= 0 {
        return Ok(());
    }
    let last: Option<String> = sqlx::query_scalar(
        "SELECT MAX(created_at) FROM messages WHERE channel_id = ? AND author_id = ?",
    )
    .bind(channel.id.to_string())
    .bind(user.to_string())
    .fetch_one(&state.db)
    .await?;
    if let Some(last) = last.and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok()) {
        let wait = chrono::Duration::seconds(channel.slowmode_seconds as i64)
            - (Utc::now() - last.with_timezone(&Utc));
        if wait > chrono::Duration::zero() {
            let secs = wait.num_milliseconds().max(1000) as u64;
            return Err(AppError::TooManyRequests(std::time::Duration::from_millis(secs)));
        }
    }
    Ok(())
}

/// The server's word filter (lowercase words or phrases).
pub async fn blocked_words(db: &sqlx::SqlitePool, server_id: Uuid) -> AppResult<Vec<String>> {
    let raw: Option<Option<String>> =
        sqlx::query_scalar("SELECT blocked_words FROM servers WHERE id = ?")
            .bind(server_id.to_string())
            .fetch_optional(db)
            .await?;
    Ok(raw
        .flatten()
        .and_then(|j| serde_json::from_str::<Vec<String>>(&j).ok())
        .unwrap_or_default())
}

/// Whole-word, case-insensitive match ("ass" doesn't match "class").
pub fn contains_blocked(content: &str, words: &[String]) -> bool {
    if words.is_empty() {
        return false;
    }
    let text = content.to_lowercase();
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    words.iter().any(|w| {
        let w = w.trim();
        if w.is_empty() {
            return false;
        }
        let mut from = 0;
        while let Some(pos) = text[from..].find(w) {
            let start = from + pos;
            let end = start + w.len();
            let before_ok = text[..start].chars().next_back().map_or(true, |c| !is_word(c));
            let after_ok = text[end..].chars().next().map_or(true, |c| !is_word(c));
            if before_ok && after_ok {
                return true;
            }
            from = start + w.chars().next().map_or(1, |c| c.len_utf8());
        }
        false
    })
}

async fn check_word_filter(state: &AppState, server: &Server, content: &str) -> AppResult<()> {
    let words = blocked_words(&state.db, server.id).await?;
    if contains_blocked(content, &words) {
        return Err(AppError::BadRequest(
            "Your message contains a word that isn't allowed in this server.".into(),
        ));
    }
    Ok(())
}

/// A message in a thread changes the thread's count shown on its parent message.
async fn refresh_thread_parent(state: &AppState, server: &Server, thread: &Channel, actor: Uuid) {
    let (Some(parent_channel), Some(parent_msg)) = (thread.parent_channel_id, thread.thread_message_id) else {
        return;
    };
    if let Ok(message) = db::load_message(&state.db, parent_msg, actor).await {
        let _ = broadcast_to_viewers(state, server, parent_channel, &WsEvent::MessageUpdate { message }).await;
    }
}

// ------------------------------------------------------------------ polls

#[derive(Deserialize)]
pub struct CreatePollReq {
    pub question: String,
    pub options: Vec<String>,
    #[serde(default)]
    pub multi: bool,
}

pub async fn create_poll(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreatePollReq>,
) -> AppResult<Json<Message>> {
    let channel = db::get_channel(&state.db, id).await?;
    if channel.channel_type != speakapp_shared::ChannelType::Text {
        return Err(AppError::BadRequest("not a text channel".into()));
    }
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(&state.db, &server, Some(id), user.id, Permissions::VIEW_CHANNEL).await?;
    db::require_perm(&state.db, &server, Some(id), user.id, Permissions::SEND_MESSAGES).await?;
    db::require_not_timed_out(&state.db, server.id, user.id).await?;

    let question = body.question.trim();
    if question.is_empty() || question.chars().count() > 300 {
        return Err(AppError::BadRequest("the question needs 1 to 300 characters".into()));
    }
    let options: Vec<String> = body
        .options
        .iter()
        .map(|o| o.trim().to_string())
        .filter(|o| !o.is_empty())
        .collect();
    if options.len() < 2 || options.len() > 10 {
        return Err(AppError::BadRequest("a poll needs 2 to 10 options".into()));
    }
    if options.iter().any(|o| o.chars().count() > 100) {
        return Err(AppError::BadRequest("options can be up to 100 characters".into()));
    }
    let moderator = is_moderator(&state, &server, id, user.id).await?;
    if !moderator {
        check_slowmode(&state, &channel, user.id).await?;
        let all = std::iter::once(question.to_string()).chain(options.iter().cloned()).collect::<Vec<_>>().join("\n");
        check_word_filter(&state, &server, &all).await?;
    }
    check_message_rate(&state, &user)?;

    let msg_id = Uuid::new_v4();
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
    )
    .bind(msg_id.to_string())
    .bind(id.to_string())
    .bind(user.id.to_string())
    .bind(question)
    .bind(Utc::now().to_rfc3339())
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO polls (message_id, question, multi) VALUES (?, ?, ?)")
        .bind(msg_id.to_string())
        .bind(question)
        .bind(body.multi as i64)
        .execute(&mut *tx)
        .await?;
    for (i, label) in options.iter().enumerate() {
        sqlx::query("INSERT INTO poll_options (id, message_id, position, label) VALUES (?, ?, ?, ?)")
            .bind(Uuid::new_v4().to_string())
            .bind(msg_id.to_string())
            .bind(i as i64)
            .bind(label)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    let message = db::load_message(&state.db, msg_id, user.id).await?;
    let author = db::user_public(&state.db, user.id).await?;
    broadcast_to_viewers(&state, &server, id, &WsEvent::MessageCreate { message: message.clone(), author }).await?;
    Ok(Json(message))
}

#[derive(Deserialize)]
pub struct VoteReq {
    /// The options picked (replaces earlier votes; empty = remove my vote).
    pub option_ids: Vec<Uuid>,
}

pub async fn vote_poll(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<VoteReq>,
) -> AppResult<Json<speakapp_shared::Poll>> {
    let message = db::load_message(&state.db, id, user.id).await?;
    let poll = message.poll.ok_or(AppError::NotFound)?;
    let channel = db::get_channel(&state.db, message.channel_id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(&state.db, &server, Some(channel.id), user.id, Permissions::VIEW_CHANNEL).await?;
    let mut picked: Vec<Uuid> = Vec::new();
    for o in body.option_ids {
        if !poll.options.iter().any(|p| p.id == o) {
            return Err(AppError::BadRequest("unknown option".into()));
        }
        if !picked.contains(&o) {
            picked.push(o);
        }
    }
    if !poll.multi && picked.len() > 1 {
        return Err(AppError::BadRequest("this poll allows one answer".into()));
    }
    state.limits.check(crate::ratelimit::REACTION, &user.id.to_string())?;

    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?")
        .bind(id.to_string())
        .bind(user.id.to_string())
        .execute(&mut *tx)
        .await?;
    for o in &picked {
        sqlx::query("INSERT INTO poll_votes (option_id, message_id, user_id) VALUES (?, ?, ?)")
            .bind(o.to_string())
            .bind(id.to_string())
            .bind(user.id.to_string())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    let options = db::poll_options_for(&state.db, &[id.to_string()])
        .await?
        .remove(&id.to_string())
        .unwrap_or_default();
    broadcast_to_viewers(
        &state,
        &server,
        channel.id,
        &WsEvent::PollUpdate {
            channel_id: channel.id,
            message_id: id,
            options: options.clone(),
            user_id: user.id,
            option_ids: picked.clone(),
        },
    )
    .await?;
    Ok(Json(speakapp_shared::Poll {
        question: poll.question,
        multi: poll.multi,
        options,
        my_votes: picked,
    }))
}

// ---------------------------------------------------------------- threads

#[derive(Deserialize)]
pub struct CreateThreadReq {
    pub name: String,
}

/// Start a thread from a message (or get the one it already has).
pub async fn create_thread(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateThreadReq>,
) -> AppResult<Json<Channel>> {
    let message = db::load_message(&state.db, id, user.id).await?;
    let parent = db::get_channel(&state.db, message.channel_id).await?;
    if parent.parent_channel_id.is_some() {
        return Err(AppError::BadRequest("threads can't have threads".into()));
    }
    let server = db::get_server(&state.db, parent.server_id).await?;
    db::require_perm(&state.db, &server, Some(parent.id), user.id, Permissions::VIEW_CHANNEL).await?;
    db::require_perm(&state.db, &server, Some(parent.id), user.id, Permissions::SEND_MESSAGES).await?;
    if let Some(existing) = message.thread {
        return Ok(Json(db::get_channel(&state.db, existing.id).await?));
    }
    let name = body.name.trim();
    let name: String = if name.is_empty() { "Thread".into() } else { name.chars().take(100).collect() };
    state.limits.check(crate::ratelimit::CREATE, &user.id.to_string())?;

    let thread_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO channels (id, server_id, category_id, name, channel_type, position, background_blur, background_dim, user_limit, parent_channel_id, thread_message_id)
         VALUES (?, ?, ?, ?, 'text', 0, 0, 0.45, 0, ?, ?)",
    )
    .bind(thread_id.to_string())
    .bind(server.id.to_string())
    .bind(parent.category_id.map(|c| c.to_string()))
    .bind(&name)
    .bind(parent.id.to_string())
    .bind(id.to_string())
    .execute(&state.db)
    .await?;
    let thread = db::get_channel(&state.db, thread_id).await?;
    broadcast_to_viewers(&state, &server, parent.id, &WsEvent::ChannelCreate { channel: thread.clone() }).await?;
    if let Ok(updated) = db::load_message(&state.db, id, user.id).await {
        let _ = broadcast_to_viewers(&state, &server, parent.id, &WsEvent::MessageUpdate { message: updated }).await;
    }
    Ok(Json(thread))
}

// ------------------------------------------------- "find players" groups

#[derive(Deserialize)]
pub struct CreateGroupReq {
    pub game: String,
    /// Players wanted, the creator included (2..=20).
    pub slots: u32,
    /// Time limit in minutes (None = until it's full).
    pub duration_minutes: Option<i64>,
}

pub async fn create_group(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateGroupReq>,
) -> AppResult<Json<Message>> {
    let channel = db::get_channel(&state.db, id).await?;
    if channel.channel_type != speakapp_shared::ChannelType::Text {
        return Err(AppError::BadRequest("not a text channel".into()));
    }
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(&state.db, &server, Some(id), user.id, Permissions::VIEW_CHANNEL).await?;
    db::require_perm(&state.db, &server, Some(id), user.id, Permissions::SEND_MESSAGES).await?;
    db::require_not_timed_out(&state.db, server.id, user.id).await?;
    let game = body.game.trim();
    if game.is_empty() || game.chars().count() > 60 {
        return Err(AppError::BadRequest("the game needs 1 to 60 characters".into()));
    }
    if !(2..=20).contains(&body.slots) {
        return Err(AppError::BadRequest("a group has 2 to 20 players".into()));
    }
    let expires_at = match body.duration_minutes {
        None | Some(0) => None,
        Some(m) if (5..=24 * 60).contains(&m) => Some(Utc::now() + chrono::Duration::minutes(m)),
        Some(_) => return Err(AppError::BadRequest("time limit: 5 minutes to 24 hours".into())),
    };
    if !is_moderator(&state, &server, id, user.id).await? {
        check_slowmode(&state, &channel, user.id).await?;
        check_word_filter(&state, &server, game).await?;
    }
    check_message_rate(&state, &user)?;

    let msg_id = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
    )
    .bind(msg_id.to_string())
    .bind(id.to_string())
    .bind(user.id.to_string())
    .bind(format!("Looking for players for {game}"))
    .bind(&now)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO lfg_groups (message_id, game, slots, expires_at) VALUES (?, ?, ?, ?)")
        .bind(msg_id.to_string())
        .bind(game)
        .bind(body.slots as i64)
        .bind(expires_at.map(|e| e.to_rfc3339()))
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO lfg_members (message_id, user_id, joined_at) VALUES (?, ?, ?)")
        .bind(msg_id.to_string())
        .bind(user.id.to_string())
        .bind(&now)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let message = db::load_message(&state.db, msg_id, user.id).await?;
    let author = db::user_public(&state.db, user.id).await?;
    broadcast_to_viewers(&state, &server, id, &WsEvent::MessageCreate { message: message.clone(), author }).await?;
    Ok(Json(message))
}

/// Join (`PUT`) or leave (`DELETE`) a group. Filling the last slot closes it
/// and posts a message that mentions everyone in it.
pub async fn join_group(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    method: axum::http::Method,
) -> AppResult<Json<Message>> {
    let joining = method == axum::http::Method::PUT;
    let message = db::load_message(&state.db, id, user.id).await?;
    let group = message.lfg.clone().ok_or(AppError::NotFound)?;
    let channel = db::get_channel(&state.db, message.channel_id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(&state.db, &server, Some(channel.id), user.id, Permissions::VIEW_CHANNEL).await?;
    if group.completed_at.is_some() {
        return Err(AppError::BadRequest("this group is already full".into()));
    }
    if group.expires_at.is_some_and(|e| e < Utc::now()) {
        return Err(AppError::BadRequest("this group has closed".into()));
    }
    state.limits.check(crate::ratelimit::REACTION, &user.id.to_string())?;

    let mut completed = false;
    let mut tx = state.db.begin().await?;
    if joining {
        if group.members.contains(&user.id) {
            return Ok(Json(message));
        }
        sqlx::query("INSERT INTO lfg_members (message_id, user_id, joined_at) VALUES (?, ?, ?)")
            .bind(id.to_string())
            .bind(user.id.to_string())
            .bind(Utc::now().to_rfc3339())
            .execute(&mut *tx)
            .await?;
        // Count inside the transaction, so two last joiners can't both fit.
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM lfg_members WHERE message_id = ?")
            .bind(id.to_string())
            .fetch_one(&mut *tx)
            .await?;
        if count > group.slots as i64 {
            return Err(AppError::BadRequest("this group is already full".into()));
        }
        if count == group.slots as i64 {
            sqlx::query("UPDATE lfg_groups SET completed_at = ? WHERE message_id = ?")
                .bind(Utc::now().to_rfc3339())
                .bind(id.to_string())
                .execute(&mut *tx)
                .await?;
            completed = true;
        }
    } else {
        sqlx::query("DELETE FROM lfg_members WHERE message_id = ? AND user_id = ?")
            .bind(id.to_string())
            .bind(user.id.to_string())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    let updated = db::load_message(&state.db, id, user.id).await?;
    broadcast_to_viewers(&state, &server, channel.id, &WsEvent::MessageUpdate { message: updated.clone() }).await?;

    if completed {
        let members = updated.lfg.as_ref().map(|g| g.members.clone()).unwrap_or_default();
        let mentions = members.iter().map(|m| format!("<@{m}>")).collect::<Vec<_>>().join(" ");
        let content = format!("✅ **{}** group is complete! {}", group.game, mentions);
        let done_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(done_id.to_string())
        .bind(channel.id.to_string())
        .bind(message.author_id.to_string())
        .bind(&content)
        .bind(id.to_string())
        .bind(Utc::now().to_rfc3339())
        .execute(&state.db)
        .await?;
        let done = db::load_message(&state.db, done_id, user.id).await?;
        let author = db::user_public(&state.db, message.author_id).await?;
        broadcast_to_viewers(&state, &server, channel.id, &WsEvent::MessageCreate { message: done, author }).await?;
    }
    Ok(Json(updated))
}
