//! User notes, welcome messages, DM "Seen", scheduled events and
//! watch-together queues.

use crate::auth::AuthUser;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use speakapp_shared::{ChannelType, Permissions, ServerEvent, WatchItem, WatchState, WsEvent};
use uuid::Uuid;

fn parse_dt(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

// ------------------------------------------------------------ user notes

#[derive(Serialize, Deserialize)]
pub struct NoteBody {
    pub note: Option<String>,
}

/// My private note about someone (only I can see it).
pub async fn get_note(
    State(state): State<AppState>,
    user: AuthUser,
    Path(target): Path<Uuid>,
) -> AppResult<Json<NoteBody>> {
    let note: Option<String> = sqlx::query_scalar("SELECT note FROM user_notes WHERE owner_id = ? AND target_id = ?")
        .bind(user.id.to_string())
        .bind(target.to_string())
        .fetch_optional(&state.db)
        .await?;
    Ok(Json(NoteBody { note }))
}

/// Set (or clear, with an empty note) my note about someone.
pub async fn set_note(
    State(state): State<AppState>,
    user: AuthUser,
    Path(target): Path<Uuid>,
    Json(body): Json<NoteBody>,
) -> AppResult<Json<NoteBody>> {
    if target == user.id {
        return Err(AppError::BadRequest("you can't add a note about yourself".into()));
    }
    let _ = db::user_public(&state.db, target).await?;
    let note = body.note.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string);
    if note.as_ref().is_some_and(|n| n.chars().count() > 256) {
        return Err(AppError::BadRequest("notes can be up to 256 characters".into()));
    }
    match &note {
        Some(n) => {
            sqlx::query(
                "INSERT INTO user_notes (owner_id, target_id, note, updated_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT(owner_id, target_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at",
            )
            .bind(user.id.to_string())
            .bind(target.to_string())
            .bind(n)
            .bind(Utc::now().to_rfc3339())
            .execute(&state.db)
            .await?;
        }
        None => {
            sqlx::query("DELETE FROM user_notes WHERE owner_id = ? AND target_id = ?")
                .bind(user.id.to_string())
                .bind(target.to_string())
                .execute(&state.db)
                .await?;
        }
    }
    Ok(Json(NoteBody { note }))
}

// ------------------------------------------------------------ welcome message

pub const DEFAULT_WELCOME: &str = "Welcome {user}! 👋";

#[derive(Serialize, Deserialize)]
pub struct WelcomeBody {
    /// Text channel for the message (None = off).
    pub channel_id: Option<Uuid>,
    /// "{user}" becomes a mention of whoever joined.
    pub message: Option<String>,
}

pub async fn get_welcome(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<WelcomeBody>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(&state.db, &server, None, user.id, Permissions::MANAGE_SERVER).await?;
    let (channel, message): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT welcome_channel_id, welcome_message FROM servers WHERE id = ?")
            .bind(id.to_string())
            .fetch_one(&state.db)
            .await?;
    Ok(Json(WelcomeBody {
        channel_id: channel.and_then(|c| Uuid::parse_str(&c).ok()),
        message,
    }))
}

pub async fn set_welcome(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<WelcomeBody>,
) -> AppResult<Json<WelcomeBody>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(&state.db, &server, None, user.id, Permissions::MANAGE_SERVER).await?;
    if let Some(ch) = body.channel_id {
        let channel = db::get_channel(&state.db, ch).await?;
        if channel.server_id != id || channel.channel_type != ChannelType::Text {
            return Err(AppError::BadRequest("pick a text channel of this server".into()));
        }
    }
    let message = body.message.as_deref().map(str::trim).filter(|m| !m.is_empty()).map(str::to_string);
    if message.as_ref().is_some_and(|m| m.chars().count() > 300) {
        return Err(AppError::BadRequest("the message can be up to 300 characters".into()));
    }
    sqlx::query("UPDATE servers SET welcome_channel_id = ?, welcome_message = ? WHERE id = ?")
        .bind(body.channel_id.map(|c| c.to_string()))
        .bind(&message)
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    Ok(Json(WelcomeBody { channel_id: body.channel_id, message }))
}

/// Post the server's welcome message for someone who just joined (if the
/// server has one set). Failures are logged, never block the join.
pub async fn post_welcome(state: &AppState, server_id: Uuid, user_id: Uuid) {
    if let Err(e) = try_post_welcome(state, server_id, user_id).await {
        tracing::warn!("welcome message for {user_id} in {server_id}: {e}");
    }
}

async fn try_post_welcome(state: &AppState, server_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let row: Option<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT welcome_channel_id, welcome_message FROM servers WHERE id = ?")
            .bind(server_id.to_string())
            .fetch_optional(&state.db)
            .await?;
    let Some((Some(channel_id), message)) = row else { return Ok(()) };
    let Ok(channel_id) = Uuid::parse_str(&channel_id) else { return Ok(()) };
    let Ok(channel) = db::get_channel(&state.db, channel_id).await else { return Ok(()) };
    if channel.server_id != server_id || channel.channel_type != ChannelType::Text {
        return Ok(());
    }
    let template = message.unwrap_or_else(|| DEFAULT_WELCOME.to_string());
    let content = if template.contains("{user}") {
        template.replace("{user}", &format!("<@{user_id}>"))
    } else {
        format!("{template} <@{user_id}>")
    };
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO messages (id, channel_id, author_id, content, created_at, system_kind) VALUES (?, ?, ?, ?, ?, 'member_join')",
    )
    .bind(id.to_string())
    .bind(channel_id.to_string())
    .bind(user_id.to_string())
    .bind(&content)
    .bind(Utc::now().to_rfc3339())
    .execute(&state.db)
    .await?;
    let server = db::get_server(&state.db, server_id).await?;
    let message = db::load_message(&state.db, id, user_id).await?;
    let author = db::user_public(&state.db, user_id).await?;
    crate::routes::messages::broadcast_to_viewers(state, &server, channel_id, &WsEvent::MessageCreate { message, author })
        .await
}

// ------------------------------------------------------------ DM "Seen"

#[derive(Deserialize)]
pub struct ReadReq {
    pub message_id: Uuid,
}

#[derive(Serialize)]
pub struct DmReadView {
    pub user_id: Uuid,
    pub message_id: Uuid,
    pub read_at: DateTime<Utc>,
}

/// I read this DM up to `message_id`. Only ever moves forward.
pub async fn mark_dm_read(
    State(state): State<AppState>,
    user: AuthUser,
    Path(dm_id): Path<Uuid>,
    Json(body): Json<ReadReq>,
) -> AppResult<Json<serde_json::Value>> {
    crate::routes::dms::require_participant(&state.db, dm_id, user.id).await?;
    let created: Option<String> =
        sqlx::query_scalar("SELECT created_at FROM dm_messages WHERE id = ? AND dm_channel_id = ?")
            .bind(body.message_id.to_string())
            .bind(dm_id.to_string())
            .fetch_optional(&state.db)
            .await?;
    let created = created.ok_or(AppError::NotFound)?;
    let previous: Option<String> = sqlx::query_scalar(
        "SELECT m.created_at FROM dm_reads r JOIN dm_messages m ON m.id = r.message_id
         WHERE r.dm_channel_id = ? AND r.user_id = ?",
    )
    .bind(dm_id.to_string())
    .bind(user.id.to_string())
    .fetch_optional(&state.db)
    .await?;
    if previous.is_some_and(|p| parse_dt(&p) >= parse_dt(&created)) {
        return Ok(Json(serde_json::json!({ "ok": true })));
    }
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO dm_reads (dm_channel_id, user_id, message_id, read_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(dm_channel_id, user_id) DO UPDATE SET message_id = excluded.message_id, read_at = excluded.read_at",
    )
    .bind(dm_id.to_string())
    .bind(user.id.to_string())
    .bind(body.message_id.to_string())
    .bind(now.to_rfc3339())
    .execute(&state.db)
    .await?;
    let people = crate::routes::dms::dm_participant_ids(&state.db, dm_id).await?;
    state.hub.broadcast_users(
        &people,
        &WsEvent::DmRead { dm_channel_id: dm_id, user_id: user.id, message_id: body.message_id, read_at: now },
    );
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Where everyone in this DM has read up to.
pub async fn list_dm_reads(
    State(state): State<AppState>,
    user: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> AppResult<Json<Vec<DmReadView>>> {
    crate::routes::dms::require_participant(&state.db, dm_id, user.id).await?;
    let rows: Vec<(String, String, String)> =
        sqlx::query_as("SELECT user_id, message_id, read_at FROM dm_reads WHERE dm_channel_id = ?")
            .bind(dm_id.to_string())
            .fetch_all(&state.db)
            .await?;
    Ok(Json(
        rows.into_iter()
            .filter_map(|(u, m, at)| {
                Some(DmReadView { user_id: Uuid::parse_str(&u).ok()?, message_id: Uuid::parse_str(&m).ok()?, read_at: parse_dt(&at) })
            })
            .collect(),
    ))
}

// ------------------------------------------------------------ scheduled events

async fn require_member(state: &AppState, server_id: Uuid, user_id: Uuid) -> AppResult<()> {
    if !db::is_member(&state.db, server_id, user_id).await? {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

async fn load_event(state: &AppState, id: Uuid) -> AppResult<ServerEvent> {
    #[allow(clippy::type_complexity)]
    let row: Option<(String, String, String, Option<String>, String, Option<String>, String)> = sqlx::query_as(
        "SELECT server_id, creator_id, title, description, starts_at, channel_id, created_at FROM server_events WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(&state.db)
    .await?;
    let (server_id, creator_id, title, description, starts_at, channel_id, created_at) = row.ok_or(AppError::NotFound)?;
    let going: Vec<String> =
        sqlx::query_scalar("SELECT user_id FROM server_event_rsvps WHERE event_id = ? ORDER BY created_at")
            .bind(id.to_string())
            .fetch_all(&state.db)
            .await?;
    Ok(ServerEvent {
        id,
        server_id: db::parse_uuid(&server_id)?,
        creator_id: db::parse_uuid(&creator_id)?,
        title,
        description,
        starts_at: parse_dt(&starts_at),
        channel_id: channel_id.and_then(|c| Uuid::parse_str(&c).ok()),
        going: going.iter().filter_map(|g| Uuid::parse_str(g).ok()).collect(),
        created_at: parse_dt(&created_at),
    })
}

/// Upcoming events (and ones that started in the last 3 hours).
pub async fn list_events(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<ServerEvent>>> {
    require_member(&state, id, user.id).await?;
    let since = (Utc::now() - Duration::hours(3)).to_rfc3339();
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM server_events WHERE server_id = ? AND starts_at >= ? ORDER BY starts_at LIMIT 50",
    )
    .bind(id.to_string())
    .bind(since)
    .fetch_all(&state.db)
    .await?;
    let mut out = Vec::with_capacity(ids.len());
    for e in ids {
        out.push(load_event(&state, db::parse_uuid(&e)?).await?);
    }
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct CreateEventReq {
    pub title: String,
    pub description: Option<String>,
    pub starts_at: DateTime<Utc>,
    pub channel_id: Option<Uuid>,
}

/// Any member can schedule one; the creator is marked as going.
pub async fn create_event(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateEventReq>,
) -> AppResult<Json<ServerEvent>> {
    require_member(&state, id, user.id).await?;
    let title = body.title.trim();
    if title.is_empty() || title.chars().count() > 100 {
        return Err(AppError::BadRequest("the title needs 1 to 100 characters".into()));
    }
    let description = body.description.as_deref().map(str::trim).filter(|d| !d.is_empty());
    if description.is_some_and(|d| d.chars().count() > 1000) {
        return Err(AppError::BadRequest("the description can be up to 1000 characters".into()));
    }
    let now = Utc::now();
    if body.starts_at < now - Duration::minutes(5) || body.starts_at > now + Duration::days(365) {
        return Err(AppError::BadRequest("pick a time in the next year".into()));
    }
    if let Some(ch) = body.channel_id {
        let channel = db::get_channel(&state.db, ch).await?;
        if channel.server_id != id || channel.channel_type != ChannelType::Voice {
            return Err(AppError::BadRequest("pick a voice channel of this server".into()));
        }
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM server_events WHERE server_id = ? AND starts_at >= ?")
        .bind(id.to_string())
        .bind(now.to_rfc3339())
        .fetch_one(&state.db)
        .await?;
    if count >= 50 {
        return Err(AppError::BadRequest("this server already has 50 upcoming events".into()));
    }
    let event_id = Uuid::new_v4();
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO server_events (id, server_id, creator_id, title, description, starts_at, channel_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(event_id.to_string())
    .bind(id.to_string())
    .bind(user.id.to_string())
    .bind(title)
    .bind(description)
    .bind(body.starts_at.to_rfc3339())
    .bind(body.channel_id.map(|c| c.to_string()))
    .bind(now.to_rfc3339())
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO server_event_rsvps (event_id, user_id, created_at) VALUES (?, ?, ?)")
        .bind(event_id.to_string())
        .bind(user.id.to_string())
        .bind(now.to_rfc3339())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let event = load_event(&state, event_id).await?;
    state.hub.broadcast_server(id, &WsEvent::EventUpsert { event: event.clone() });
    Ok(Json(event))
}

/// The creator, or someone who can manage the server.
pub async fn delete_event(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let event = load_event(&state, event_id).await?;
    if event.creator_id != user.id {
        let server = db::get_server(&state.db, event.server_id).await?;
        db::require_perm(&state.db, &server, None, user.id, Permissions::MANAGE_SERVER).await?;
    }
    sqlx::query("DELETE FROM server_events WHERE id = ?")
        .bind(event_id.to_string())
        .execute(&state.db)
        .await?;
    state.hub.broadcast_server(event.server_id, &WsEvent::EventDelete { server_id: event.server_id, event_id });
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// "I'm going" (`PUT`) or not anymore (`DELETE`).
pub async fn rsvp_event(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    method: axum::http::Method,
) -> AppResult<Json<ServerEvent>> {
    let event = load_event(&state, event_id).await?;
    require_member(&state, event.server_id, user.id).await?;
    if method == axum::http::Method::PUT {
        sqlx::query("INSERT OR IGNORE INTO server_event_rsvps (event_id, user_id, created_at) VALUES (?, ?, ?)")
            .bind(event_id.to_string())
            .bind(user.id.to_string())
            .bind(Utc::now().to_rfc3339())
            .execute(&state.db)
            .await?;
    } else {
        sqlx::query("DELETE FROM server_event_rsvps WHERE event_id = ? AND user_id = ?")
            .bind(event_id.to_string())
            .bind(user.id.to_string())
            .execute(&state.db)
            .await?;
    }
    let event = load_event(&state, event_id).await?;
    state.hub.broadcast_server(event.server_id, &WsEvent::EventUpsert { event: event.clone() });
    Ok(Json(event))
}

// ------------------------------------------------------------ watch together

const MAX_QUEUE: usize = 50;

/// YouTube video id from a link (watch, youtu.be, shorts, embed, live) or a bare id.
pub fn youtube_id(raw: &str) -> Option<String> {
    let valid = |s: &str| s.len() == 11 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let raw = raw.trim();
    if valid(raw) {
        return Some(raw.to_string());
    }
    let with_scheme = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let url = reqwest::Url::parse(&with_scheme).ok()?;
    let host = url.host_str()?.trim_start_matches("www.").trim_start_matches("m.").trim_start_matches("music.");
    let mut segs = url.path_segments()?.filter(|s| !s.is_empty());
    let id = match host {
        "youtu.be" => segs.next().map(str::to_string),
        "youtube.com" | "youtube-nocookie.com" => match segs.next() {
            Some("watch") => url.query_pairs().find(|(k, _)| k == "v").map(|(_, v)| v.into_owned()),
            Some("shorts" | "embed" | "live" | "v") => segs.next().map(str::to_string),
            _ => None,
        },
        _ => None,
    }?;
    valid(&id).then_some(id)
}

/// The video's title from YouTube's oEmbed (no API key needed).
async fn youtube_title(video_id: &str) -> Option<String> {
    if cfg!(test) {
        return None;
    }
    #[derive(Deserialize)]
    struct OEmbed {
        title: String,
    }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(5)).build().ok()?;
    let res = client
        .get("https://www.youtube.com/oembed")
        .query(&[("format", "json"), ("url", &format!("https://www.youtube.com/watch?v={video_id}"))])
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    res.json::<OEmbed>().await.ok().map(|o| o.title.chars().take(200).collect())
}

/// Voice channel the user is in, and that it's a voice channel they can see.
async fn require_in_voice(state: &AppState, channel_id: Uuid, user_id: Uuid) -> AppResult<speakapp_shared::Channel> {
    let channel = db::get_channel(&state.db, channel_id).await?;
    if channel.channel_type != ChannelType::Voice {
        return Err(AppError::BadRequest("not a voice channel".into()));
    }
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(&state.db, &server, Some(channel_id), user_id, Permissions::VIEW_CHANNEL).await?;
    let mine: Option<Option<String>> = sqlx::query_scalar("SELECT channel_id FROM voice_states WHERE user_id = ?")
        .bind(user_id.to_string())
        .fetch_optional(&state.db)
        .await?;
    if mine.flatten().as_deref() != Some(channel_id.to_string().as_str()) {
        return Err(AppError::BadRequest("join the voice channel first".into()));
    }
    Ok(channel)
}

#[derive(Deserialize)]
pub struct KindQuery {
    /// "watch" (default, video) or "listen" (audio only).
    pub kind: Option<String>,
}

fn activity_kind(q: &KindQuery) -> AppResult<String> {
    match q.kind.as_deref().unwrap_or("watch") {
        k @ ("watch" | "listen") => Ok(k.to_string()),
        _ => Err(AppError::BadRequest("unknown activity".into())),
    }
}

fn watch_snapshot(state: &AppState, channel_id: Uuid, kind: &str) -> WatchState {
    let map = state.watch.lock().unwrap();
    map.get(&(channel_id, kind.to_string()))
        .cloned()
        .unwrap_or_else(|| WatchState { updated_at: Utc::now(), ..Default::default() })
}

pub async fn get_watch(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(q): Query<KindQuery>,
) -> AppResult<Json<WatchState>> {
    let kind = activity_kind(&q)?;
    let channel = db::get_channel(&state.db, channel_id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(&state.db, &server, Some(channel_id), user.id, Permissions::VIEW_CHANNEL).await?;
    Ok(Json(watch_snapshot(&state, channel_id, &kind)))
}

#[derive(Deserialize)]
pub struct WatchReq {
    /// add | remove | play | pause | seek | next | select | clear
    pub action: String,
    pub url: Option<String>,
    pub item_id: Option<Uuid>,
    pub position: Option<f64>,
}

/// Change the queue or the playback; everyone in the server gets the new state
/// (the app shows it to whoever is in that voice channel).
pub async fn watch_action(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(q): Query<KindQuery>,
    Json(body): Json<WatchReq>,
) -> AppResult<Json<WatchState>> {
    let kind = activity_kind(&q)?;
    let channel = require_in_voice(&state, channel_id, user.id).await?;
    let position = body.position.filter(|p| p.is_finite() && *p >= 0.0).unwrap_or(0.0);

    // Network first (outside the lock): the title for a new video.
    let new_item = if body.action == "add" {
        let url = body.url.as_deref().unwrap_or_default();
        let video_id = youtube_id(url).ok_or_else(|| AppError::BadRequest("that isn't a YouTube link".into()))?;
        let title = youtube_title(&video_id).await.unwrap_or_else(|| "YouTube video".to_string());
        Some(WatchItem { id: Uuid::new_v4(), video_id, title, added_by: user.id })
    } else {
        None
    };

    let snapshot = {
        let mut map = state.watch.lock().unwrap();
        let w = map
            .entry((channel_id, kind.clone()))
            .or_insert_with(|| WatchState { updated_at: Utc::now(), ..Default::default() });
        let now = Utc::now();
        // Where playback is right now (so pausing/adding keeps the place).
        let live_position = if w.playing {
            w.position + (now - w.updated_at).num_milliseconds() as f64 / 1000.0
        } else {
            w.position
        };
        match body.action.as_str() {
            "add" => {
                if w.queue.len() >= MAX_QUEUE {
                    return Err(AppError::BadRequest("the queue is full (50 videos)".into()));
                }
                let item = new_item.expect("built above");
                if w.queue.is_empty() {
                    w.current = Some(item.id);
                    w.playing = true;
                    w.position = 0.0;
                    w.updated_at = now;
                }
                w.queue.push(item);
            }
            "remove" => {
                let id = body.item_id.ok_or_else(|| AppError::BadRequest("item_id required".into()))?;
                let was_current = w.current == Some(id);
                w.queue.retain(|i| i.id != id);
                if was_current {
                    w.current = w.queue.first().map(|i| i.id);
                    w.position = 0.0;
                    w.playing = w.current.is_some() && w.playing;
                    w.updated_at = now;
                }
            }
            "play" | "pause" | "seek" => {
                if w.current.is_none() {
                    return Err(AppError::BadRequest("nothing is playing".into()));
                }
                w.playing = match body.action.as_str() {
                    "play" => true,
                    "pause" => false,
                    _ => w.playing,
                };
                w.position = body.position.map(|_| position).unwrap_or(live_position);
                w.updated_at = now;
            }
            "next" => {
                // Sent with the item that ended/was skipped, so several people's
                // apps reporting the same end only advance once.
                if body.item_id.is_some() && body.item_id != w.current {
                    return Ok(Json(w.clone()));
                }
                if let Some(cur) = w.current {
                    w.queue.retain(|i| i.id != cur);
                }
                w.current = w.queue.first().map(|i| i.id);
                w.playing = w.current.is_some();
                w.position = 0.0;
                w.updated_at = now;
            }
            "select" => {
                let id = body.item_id.ok_or_else(|| AppError::BadRequest("item_id required".into()))?;
                let idx = w.queue.iter().position(|i| i.id == id).ok_or(AppError::NotFound)?;
                // The one playing now is done; the picked one moves to the front.
                if let Some(cur) = w.current {
                    if cur != id {
                        w.queue.retain(|i| i.id != cur);
                    }
                }
                let idx = w.queue.iter().position(|i| i.id == id).unwrap_or(idx);
                let item = w.queue.remove(idx);
                w.queue.insert(0, item);
                w.current = Some(id);
                w.playing = true;
                w.position = 0.0;
                w.updated_at = now;
            }
            "clear" => {
                *w = WatchState { updated_at: now, ..Default::default() };
            }
            _ => return Err(AppError::BadRequest("unknown action".into())),
        }
        w.clone()
    };
    state.hub.broadcast_server(
        channel.server_id,
        &WsEvent::WatchUpdate { channel_id, kind, state: snapshot.clone() },
    );
    Ok(Json(snapshot))
}

#[cfg(test)]
mod tests {
    use super::youtube_id;

    #[test]
    fn youtube_links() {
        let id = Some("dQw4w9WgXcQ".to_string());
        assert_eq!(youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s"), id);
        assert_eq!(youtube_id("youtube.com/watch?v=dQw4w9WgXcQ"), id);
        assert_eq!(youtube_id("https://youtu.be/dQw4w9WgXcQ?si=abc"), id);
        assert_eq!(youtube_id("https://youtube.com/shorts/dQw4w9WgXcQ"), id);
        assert_eq!(youtube_id("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), id);
        assert_eq!(youtube_id("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), id);
        assert_eq!(youtube_id("dQw4w9WgXcQ"), id);
        assert_eq!(youtube_id("https://vimeo.com/123"), None);
        assert_eq!(youtube_id("https://www.youtube.com/watch?v=short"), None);
        assert_eq!(youtube_id("not a link"), None);
    }
}
