use crate::auth::AuthUser;
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
    let server = db::get_server(&state.db, id).await?;
    let channels = db::server_channels(&state.db, id).await?;
    let mut visible = Vec::with_capacity(channels.len());
    for ch in channels {
        let perms =
            db::effective_permissions(&state.db, &server, Some(ch.id), user.id).await?;
        if perms.has(Permissions::VIEW_CHANNEL) {
            visible.push(ch);
        }
    }
    Ok(Json(visible))
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

pub async fn list_server_overwrites(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<PermissionOverwrite>>> {
    if !db::is_member(&state.db, id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    Ok(Json(db::server_channel_overwrites(&state.db, id).await?))
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
    let saved = db::channel_overwrites(&state.db, id).await?;
    // Sync visibility: viewers get create/update, others lose the channel.
    let members = db::server_member_ids(&state.db, channel.server_id).await?;
    for uid in members {
        let can = db::effective_permissions(&state.db, &server, Some(id), uid)
            .await?
            .has(Permissions::VIEW_CHANNEL);
        if can {
            state.hub.send_to_user(
                uid,
                &WsEvent::ChannelCreate {
                    channel: channel.clone(),
                },
            );
        } else {
            state.hub.send_to_user(
                uid,
                &WsEvent::ChannelDelete {
                    server_id: channel.server_id,
                    channel_id: id,
                },
            );
        }
    }
    Ok(Json(saved))
}

#[derive(Deserialize)]
pub struct InviteToChannelReq {
    pub user_id: Uuid,
}

/// Invite a friend (or server member) into a channel — grants access + join card.
pub async fn invite_to_channel(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<InviteToChannelReq>,
) -> AppResult<Json<serde_json::Value>> {
    if body.user_id == user.id {
        return Err(AppError::BadRequest("cannot invite yourself".into()));
    }
    let channel = db::get_channel(&state.db, id).await?;
    if channel.channel_type == ChannelType::Category {
        return Err(AppError::BadRequest("cannot invite to a category".into()));
    }
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(id),
        user.id,
        Permissions::CREATE_INVITE,
    )
    .await?;

    let is_friend =
        crate::routes::friends::are_friends(&state.db, user.id, body.user_id).await?;
    let is_member = db::is_member(&state.db, server.id, body.user_id).await?;
    if !is_friend && !is_member {
        return Err(AppError::BadRequest(
            "you can only invite friends or server members".into(),
        ));
    }

    let banned: (i64,) =
        sqlx::query_as("SELECT COUNT(1) FROM bans WHERE server_id = ? AND user_id = ?")
            .bind(server.id.to_string())
            .bind(body.user_id.to_string())
            .fetch_one(&state.db)
            .await?;
    if banned.0 > 0 {
        return Err(AppError::Forbidden);
    }

    if !is_member {
        if !is_friend {
            return Err(AppError::BadRequest("you can only invite friends".into()));
        }
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO members (server_id, user_id, joined_at, accepted_rules) VALUES (?, ?, ?, 0)",
        )
        .bind(server.id.to_string())
        .bind(body.user_id.to_string())
        .bind(&now)
        .execute(&state.db)
        .await?;
        state.hub.add_server_member(server.id, body.user_id);
        let member = db::get_member(&state.db, server.id, body.user_id).await?;
        state
            .hub
            .broadcast_server(server.id, &WsEvent::MemberJoin { member });
    }

    grant_member_channel_access(&state, &channel, body.user_id).await?;

    // Ensure invitee can see the channel.
    let can = db::effective_permissions(&state.db, &server, Some(id), body.user_id)
        .await?
        .has(Permissions::VIEW_CHANNEL);
    if can {
        state.hub.send_to_user(
            body.user_id,
            &WsEvent::ChannelCreate {
                channel: channel.clone(),
            },
        );
    }

    let member_ids = db::server_member_ids(&state.db, server.id).await?;
    let member_count = member_ids.len() as u32;
    let online_count = state.hub.online_among(&member_ids).len() as u32;
    let invited_by = db::user_public(&state.db, user.id).await?;
    state.hub.send_to_user(
        body.user_id,
        &WsEvent::ChannelInvite {
            server: server.clone(),
            channel: channel.clone(),
            invited_by,
            member_count,
            online_count,
        },
    );

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn grant_member_channel_access(
    state: &AppState,
    channel: &Channel,
    user_id: Uuid,
) -> AppResult<()> {
    let mut access = Permissions::VIEW_CHANNEL;
    if channel.channel_type == ChannelType::Voice {
        access |= Permissions::CONNECT;
    }

    let existing = db::channel_overwrites(&state.db, channel.id).await?;
    if let Some(ow) = existing.iter().find(|o| {
        o.target_type == OverwriteTarget::Member && o.target_id == user_id
    }) {
        let allow = ow.allow | access;
        let deny = ow.deny - access;
        sqlx::query(
            "UPDATE permission_overwrites SET allow_bits = ?, deny_bits = ? WHERE id = ?",
        )
        .bind(allow.bits() as i64)
        .bind(deny.bits() as i64)
        .bind(ow.id.to_string())
        .execute(&state.db)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO permission_overwrites (id, channel_id, target_type, target_id, allow_bits, deny_bits) VALUES (?, ?, 'member', ?, ?, 0)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(channel.id.to_string())
        .bind(user_id.to_string())
        .bind(access.bits() as i64)
        .execute(&state.db)
        .await?;
    }
    Ok(())
}
