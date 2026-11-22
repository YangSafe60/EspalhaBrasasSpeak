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
use speakapp_shared::{Message, Permissions, Server, WsEvent};
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
        "INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(msg_id.to_string())
    .bind(id.to_string())
    .bind(user.id.to_string())
    .bind(content)
    .bind(body.reply_to_id.map(|r| r.to_string()))
    .bind(&now)
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
