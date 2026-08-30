use crate::auth::{hash_token, AuthUser};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use speakapp_shared::{
    ChannelWebhook, ChannelWebhookCreated, Message, Permissions, Server, WsEvent,
};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct CreateWebhookReq {
    pub name: String,
    pub avatar_url: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateWebhookReq {
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Deserialize)]
pub struct ExecuteWebhookReq {
    pub content: String,
    #[serde(default)]
    pub username: Option<String>,
}

fn parse_dt(s: &str) -> chrono::DateTime<Utc> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn map_webhook_row(
    id: String,
    channel_id: String,
    name: String,
    avatar_url: Option<String>,
    creator_id: String,
    created_at: String,
) -> ChannelWebhook {
    ChannelWebhook {
        id: Uuid::parse_str(&id).unwrap(),
        channel_id: Uuid::parse_str(&channel_id).unwrap(),
        name,
        avatar_url,
        creator_id: Uuid::parse_str(&creator_id).unwrap(),
        created_at: parse_dt(&created_at),
    }
}

fn generate_webhook_token() -> String {
    format!("wh_{}", crate::auth::issue_refresh_token_value())
}

async fn broadcast_message(
    state: &AppState,
    server: &Server,
    channel_id: Uuid,
    message: &Message,
    author_id: Uuid,
) -> AppResult<()> {
    let author = db::user_public(&state.db, author_id).await?;
    let viewers = db::members_with_channel_perm(
        &state.db,
        server,
        channel_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;
    state.hub.broadcast_users(
        &viewers,
        &WsEvent::MessageCreate {
            message: message.clone(),
            author,
        },
    );
    Ok(())
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<Vec<ChannelWebhook>>> {
    let channel = db::get_channel(&state.db, channel_id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(channel_id),
        user.id,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    #[derive(sqlx::FromRow)]
    struct Row {
        id: String,
        channel_id: String,
        name: String,
        avatar_url: Option<String>,
        creator_id: String,
        created_at: String,
    }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT id, channel_id, name, avatar_url, creator_id, created_at FROM channel_webhooks WHERE channel_id = ? ORDER BY created_at",
    )
    .bind(channel_id.to_string())
    .fetch_all(&state.db)
    .await?;

    Ok(Json(
        rows.into_iter()
            .map(|r| {
                map_webhook_row(
                    r.id,
                    r.channel_id,
                    r.name,
                    r.avatar_url,
                    r.creator_id,
                    r.created_at,
                )
            })
            .collect(),
    ))
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<CreateWebhookReq>,
) -> AppResult<Json<ChannelWebhookCreated>> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name required".into()));
    }
    let channel = db::get_channel(&state.db, channel_id).await?;
    if channel.channel_type != speakapp_shared::ChannelType::Text {
        return Err(AppError::BadRequest("webhooks only for text channels".into()));
    }
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(channel_id),
        user.id,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    let id = Uuid::new_v4();
    let token = generate_webhook_token();
    let token_hash = hash_token(&token);
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO channel_webhooks (id, channel_id, name, token_hash, avatar_url, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(channel_id.to_string())
    .bind(name)
    .bind(&token_hash)
    .bind(body.avatar_url.as_deref())
    .bind(user.id.to_string())
    .bind(&now)
    .execute(&state.db)
    .await?;

    let webhook = map_webhook_row(
        id.to_string(),
        channel_id.to_string(),
        name.to_string(),
        body.avatar_url,
        user.id.to_string(),
        now,
    );

    Ok(Json(ChannelWebhookCreated { webhook, token }))
}

pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateWebhookReq>,
) -> AppResult<Json<ChannelWebhook>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        channel_id: String,
        name: String,
        avatar_url: Option<String>,
        creator_id: String,
        created_at: String,
    }

    let row = sqlx::query_as::<_, Row>(
        "SELECT channel_id, name, avatar_url, creator_id, created_at FROM channel_webhooks WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    let channel_id = Uuid::parse_str(&row.channel_id).unwrap();
    let channel = db::get_channel(&state.db, channel_id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(channel_id),
        user.id,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    let name = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(row.name.as_str());
    let avatar_url = body.avatar_url.or(row.avatar_url);

    sqlx::query("UPDATE channel_webhooks SET name = ?, avatar_url = ? WHERE id = ?")
        .bind(name)
        .bind(avatar_url.as_deref())
        .bind(id.to_string())
        .execute(&state.db)
        .await?;

    Ok(Json(map_webhook_row(
        id.to_string(),
        row.channel_id,
        name.to_string(),
        avatar_url,
        row.creator_id,
        row.created_at,
    )))
}

pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        channel_id: String,
    }

    let row = sqlx::query_as::<_, Row>("SELECT channel_id FROM channel_webhooks WHERE id = ?")
        .bind(id.to_string())
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;

    let channel_id = Uuid::parse_str(&row.channel_id).unwrap();
    let channel = db::get_channel(&state.db, channel_id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(channel_id),
        user.id,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    sqlx::query("DELETE FROM channel_webhooks WHERE id = ?")
        .bind(id.to_string())
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn execute(
    State(state): State<AppState>,
    Path((id, token)): Path<(Uuid, String)>,
    Json(body): Json<ExecuteWebhookReq>,
) -> AppResult<Json<Message>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        channel_id: String,
        name: String,
        token_hash: String,
        creator_id: String,
    }

    let row = sqlx::query_as::<_, Row>(
        "SELECT channel_id, name, token_hash, creator_id FROM channel_webhooks WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    if hash_token(&token) != row.token_hash {
        return Err(AppError::Unauthorized);
    }

    let content = body.content.trim();
    if content.is_empty() {
        return Err(AppError::BadRequest("empty content".into()));
    }

    let channel_id = Uuid::parse_str(&row.channel_id).unwrap();
    let channel = db::get_channel(&state.db, channel_id).await?;
    if channel.channel_type != speakapp_shared::ChannelType::Text {
        return Err(AppError::BadRequest("not a text channel".into()));
    }
    let server = db::get_server(&state.db, channel.server_id).await?;
    let creator_id = Uuid::parse_str(&row.creator_id).unwrap();

    let display_name = body
        .username
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(row.name.as_str());

    let msg_id = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO messages (id, channel_id, author_id, content, created_at, webhook_id, webhook_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(msg_id.to_string())
    .bind(channel_id.to_string())
    .bind(creator_id.to_string())
    .bind(content)
    .bind(&now)
    .bind(id.to_string())
    .bind(display_name)
    .execute(&state.db)
    .await?;

    let message = db::load_message(&state.db, msg_id, creator_id).await?;
    broadcast_message(&state, &server, channel_id, &message, creator_id).await?;
    Ok(Json(message))
}
