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
use speakapp_shared::{Message, Permissions, WsEvent};
use uuid::Uuid;

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
        q.limit.unwrap_or(50),
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
    if !matches!(
        channel.channel_type,
        speakapp_shared::ChannelType::Text
    ) {
        return Err(AppError::BadRequest("not a text channel".into()));
    }
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(id),
        user.id,
        Permissions::SEND_MESSAGES,
    )
    .await?;

    let content = body.content.trim();
    if content.is_empty() && body.attachment_ids.as_ref().map(|a| a.is_empty()).unwrap_or(true)
    {
        return Err(AppError::BadRequest("empty message".into()));
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
    .execute(&state.db)
    .await?;

    if let Some(ids) = body.attachment_ids {
        for aid in ids {
            sqlx::query(
                "UPDATE attachments SET message_id = ? WHERE id = ? AND message_id IS NULL",
            )
            .bind(msg_id.to_string())
            .bind(aid.to_string())
            .execute(&state.db)
            .await?;
        }
    }

    let message = db::load_message(&state.db, msg_id, user.id).await?;
    let author = db::user_public(&state.db, user.id).await?;
    state.hub.broadcast_server(
        channel.server_id,
        &WsEvent::MessageCreate {
            message: message.clone(),
            author,
        },
    );
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
    let row = sqlx::query_as::<_, Row>("SELECT author_id, channel_id FROM messages WHERE id = ?")
        .bind(id.to_string())
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    let author_id = Uuid::parse_str(&row.author_id).unwrap();
    let channel_id = Uuid::parse_str(&row.channel_id).unwrap();
    if author_id != user.id {
        let channel = db::get_channel(&state.db, channel_id).await?;
        let server = db::get_server(&state.db, channel.server_id).await?;
        db::require_perm(
            &state.db,
            &server,
            Some(channel_id),
            user.id,
            Permissions::MANAGE_MESSAGES,
        )
        .await?;
    }
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE messages SET content = ?, edited_at = ? WHERE id = ?")
        .bind(body.content.trim())
        .bind(&now)
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    let message = db::load_message(&state.db, id, user.id).await?;
    let channel = db::get_channel(&state.db, channel_id).await?;
    state.hub.broadcast_server(
        channel.server_id,
        &WsEvent::MessageUpdate {
            message: message.clone(),
        },
    );
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
    let row = sqlx::query_as::<_, Row>("SELECT author_id, channel_id FROM messages WHERE id = ?")
        .bind(id.to_string())
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    let author_id = Uuid::parse_str(&row.author_id).unwrap();
    let channel_id = Uuid::parse_str(&row.channel_id).unwrap();
    if author_id != user.id {
        let channel = db::get_channel(&state.db, channel_id).await?;
        let server = db::get_server(&state.db, channel.server_id).await?;
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
    let channel = db::get_channel(&state.db, channel_id).await?;
    state.hub.broadcast_server(
        channel.server_id,
        &WsEvent::MessageDelete {
            channel_id,
            message_id: id,
        },
    );
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn add_reaction(
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
        Permissions::ADD_REACTIONS,
    )
    .await?;
    sqlx::query(
        "INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(user.id.to_string())
    .bind(&emoji)
    .execute(&state.db)
    .await?;
    state.hub.broadcast_server(
        channel.server_id,
        &WsEvent::ReactionAdd {
            channel_id: channel.id,
            message_id: id,
            emoji,
            user_id: user.id,
        },
    );
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_reaction(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, emoji)): Path<(Uuid, String)>,
) -> AppResult<Json<serde_json::Value>> {
    let message = db::load_message(&state.db, id, user.id).await?;
    let channel = db::get_channel(&state.db, message.channel_id).await?;
    sqlx::query("DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?")
        .bind(id.to_string())
        .bind(user.id.to_string())
        .bind(&emoji)
        .execute(&state.db)
        .await?;
    state.hub.broadcast_server(
        channel.server_id,
        &WsEvent::ReactionRemove {
            channel_id: channel.id,
            message_id: id,
            emoji,
            user_id: user.id,
        },
    );
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn typing(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let channel = db::get_channel(&state.db, id).await?;
    if !db::is_member(&state.db, channel.server_id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    let u = db::user_public(&state.db, user.id).await?;
    state.hub.broadcast_server(
        channel.server_id,
        &WsEvent::TypingStart {
            channel_id: id,
            user_id: user.id,
            username: u.username,
        },
    );
    Ok(Json(serde_json::json!({ "ok": true })))
}
