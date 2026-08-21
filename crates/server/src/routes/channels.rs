use crate::auth::AuthUser;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use speakapp_shared::{
    Channel, ChannelType, OverwriteTarget, PermissionOverwrite, Permissions, WsEvent,
};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct CreateChannelReq {
    pub name: String,
    pub channel_type: ChannelType,
    pub category_id: Option<Uuid>,
    pub topic: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateChannelReq {
    pub name: Option<String>,
    pub topic: Option<String>,
    pub category_id: Option<Option<Uuid>>,
    pub position: Option<i32>,
    pub background_url: Option<Option<String>>,
    pub background_blur: Option<f32>,
    pub background_dim: Option<f32>,
    pub text_color: Option<Option<String>>,
    pub atmosphere: Option<Option<String>>,
    pub user_limit: Option<i32>,
}

#[derive(Deserialize)]
pub struct OverwriteInput {
    pub target_type: OverwriteTarget,
    pub target_id: Uuid,
    pub allow: u64,
    pub deny: u64,
}

#[derive(Deserialize)]
pub struct SetOverwritesReq {
    pub overwrites: Vec<OverwriteInput>,
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Channel>>> {
    if !db::is_member(&state.db, id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    Ok(Json(db::server_channels(&state.db, id).await?))
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateChannelReq>,
) -> AppResult<Json<Channel>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;
    let channel_id = Uuid::new_v4();
    let ty = match body.channel_type {
        ChannelType::Text => "text",
        ChannelType::Voice => "voice",
        ChannelType::Category => "category",
    };
    let max_pos: (i64,) =
        sqlx::query_as("SELECT COALESCE(MAX(position), 0) FROM channels WHERE server_id = ?")
            .bind(id.to_string())
            .fetch_one(&state.db)
            .await?;
    sqlx::query(
        "INSERT INTO channels (id, server_id, category_id, name, channel_type, position, topic, background_blur, background_dim, user_limit) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0.45, 0)",
    )
    .bind(channel_id.to_string())
    .bind(id.to_string())
    .bind(body.category_id.map(|c| c.to_string()))
    .bind(body.name.trim())
    .bind(ty)
    .bind(max_pos.0 + 1)
    .bind(body.topic)
    .execute(&state.db)
    .await?;

    let channel = db::get_channel(&state.db, channel_id).await?;
    state
        .hub
        .broadcast_server(id, &WsEvent::ChannelCreate { channel: channel.clone() });
    Ok(Json(channel))
}

pub async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Channel>> {
    let channel = db::get_channel(&state.db, id).await?;
    if !db::is_member(&state.db, channel.server_id, user.id).await? {
        return Err(AppError::Forbidden);
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
    Ok(Json(channel))
}

pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateChannelReq>,
) -> AppResult<Json<Channel>> {
    let channel = db::get_channel(&state.db, id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(id),
        user.id,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    if let Some(name) = body.name {
        sqlx::query("UPDATE channels SET name = ? WHERE id = ?")
            .bind(name.trim())
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(topic) = body.topic {
        sqlx::query("UPDATE channels SET topic = ? WHERE id = ?")
            .bind(topic)
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(cat) = body.category_id {
        sqlx::query("UPDATE channels SET category_id = ? WHERE id = ?")
            .bind(cat.map(|c| c.to_string()))
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(pos) = body.position {
        sqlx::query("UPDATE channels SET position = ? WHERE id = ?")
            .bind(pos)
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(bg) = body.background_url {
        sqlx::query("UPDATE channels SET background_url = ? WHERE id = ?")
            .bind(bg)
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(blur) = body.background_blur {
        sqlx::query("UPDATE channels SET background_blur = ? WHERE id = ?")
            .bind(blur)
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(dim) = body.background_dim {
        sqlx::query("UPDATE channels SET background_dim = ? WHERE id = ?")
            .bind(dim)
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(tc) = body.text_color {
        sqlx::query("UPDATE channels SET text_color = ? WHERE id = ?")
            .bind(tc)
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(atm) = body.atmosphere {
        // Apply atmosphere presets as theme defaults when set
        if let Some(ref preset) = atm {
            let (blur, dim, text) = match preset.as_str() {
                "focus" => (2.0_f32, 0.55_f32, Some("#f4f7fb")),
                "chill" => (8.0, 0.35, Some("#e8fff6")),
                "gaming" => (4.0, 0.5, Some("#ffe8f0")),
                _ => (0.0, 0.45, None),
            };
            sqlx::query(
                "UPDATE channels SET atmosphere = ?, background_blur = ?, background_dim = ?, text_color = COALESCE(?, text_color) WHERE id = ?",
            )
            .bind(preset)
            .bind(blur)
            .bind(dim)
            .bind(text)
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
        } else {
            sqlx::query("UPDATE channels SET atmosphere = NULL WHERE id = ?")
                .bind(id.to_string())
                .execute(&state.db)
                .await?;
        }
    }
    if let Some(limit) = body.user_limit {
        sqlx::query("UPDATE channels SET user_limit = ? WHERE id = ?")
            .bind(limit.max(0))
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }

    let channel = db::get_channel(&state.db, id).await?;
    state.hub.broadcast_server(
        channel.server_id,
        &WsEvent::ChannelUpdate {
            channel: channel.clone(),
        },
    );
    Ok(Json(channel))
}

pub async fn delete(
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
        Permissions::MANAGE_CHANNELS,
    )
    .await?;
    sqlx::query("DELETE FROM channels WHERE id = ?")
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    state.hub.broadcast_server(
        channel.server_id,
        &WsEvent::ChannelDelete {
            server_id: channel.server_id,
            channel_id: id,
        },
    );
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn list_overwrites(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<PermissionOverwrite>>> {
    let channel = db::get_channel(&state.db, id).await?;
    if !db::is_member(&state.db, channel.server_id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    Ok(Json(db::channel_overwrites(&state.db, id).await?))
}

pub async fn set_overwrites(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<SetOverwritesReq>,
) -> AppResult<Json<Vec<PermissionOverwrite>>> {
    let channel = db::get_channel(&state.db, id).await?;
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(id),
        user.id,
        Permissions::MANAGE_ROLES,
    )
    .await?;
    sqlx::query("DELETE FROM permission_overwrites WHERE channel_id = ?")
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    for ow in body.overwrites {
        let ty = match ow.target_type {
            OverwriteTarget::Role => "role",
            OverwriteTarget::Member => "member",
        };
        sqlx::query(
            "INSERT INTO permission_overwrites (id, channel_id, target_type, target_id, allow_bits, deny_bits) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(id.to_string())
        .bind(ty)
        .bind(ow.target_id.to_string())
        .bind(ow.allow as i64)
        .bind(ow.deny as i64)
        .execute(&state.db)
        .await?;
    }
    Ok(Json(db::channel_overwrites(&state.db, id).await?))
}
