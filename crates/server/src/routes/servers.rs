use crate::auth::AuthUser;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use speakapp_shared::{
    Invite, Member, Permissions, Role, Server, ServerRule, WsEvent,
};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct CreateServerReq {
    pub name: String,
}

#[derive(Deserialize)]
pub struct UpdateServerReq {
    pub name: Option<String>,
    /// Absent = leave unchanged; JSON `null` = clear; string = set.
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub icon_url: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub banner_url: Option<Option<String>>,
    pub accent_color: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub invite_splash_url: Option<Option<String>>,
}

/// Makes JSON `null` mean “clear” (`Some(None)`), not “omit” (`None`).
fn deserialize_optional_string<'de, D>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Some(Option::<String>::deserialize(deserializer)?))
}

#[derive(Deserialize)]
pub struct CreateInviteReq {
    pub max_uses: Option<u32>,
    /// Lifetime in seconds (preferred). `0` / omitted = never expires.
    pub max_age: Option<i64>,
    /// Legacy alias (hours). Used only when `max_age` is absent.
    pub expires_hours: Option<i64>,
}

#[derive(Deserialize)]
pub struct CreateRoleReq {
    pub name: String,
    pub color: Option<String>,
    pub gradient: Option<String>,
    pub permissions: Option<u64>,
}

#[derive(Deserialize)]
pub struct UpdateRoleReq {
    pub name: Option<String>,
    pub color: Option<String>,
    pub gradient: Option<String>,
    pub permissions: Option<u64>,
    pub position: Option<i32>,
}

#[derive(Deserialize)]
pub struct SetRolesReq {
    pub role_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
pub struct BanReq {
    pub user_id: Uuid,
    pub reason: Option<String>,
}

#[derive(Deserialize)]
pub struct RulesReq {
    pub rules: Vec<RuleInput>,
}

#[derive(Deserialize)]
pub struct RuleInput {
    pub title: String,
    pub body: String,
}

#[derive(Serialize)]
pub struct BanInfo {
    pub user_id: Uuid,
    pub reason: Option<String>,
    pub banned_by: Uuid,
    pub created_at: String,
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Vec<Server>>> {
    Ok(Json(db::user_servers(&state.db, user.id).await?))
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateServerReq>,
) -> AppResult<Json<Server>> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name required".into()));
    }
    let server_id = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();
    let everyone_id = Uuid::new_v4();

    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO servers (id, name, owner_id, accent_color, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(server_id.to_string())
    .bind(name)
    .bind(user.id.to_string())
    .bind("#e31b23")
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO roles (id, server_id, name, color, position, permissions, is_everyone) VALUES (?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(everyone_id.to_string())
    .bind(server_id.to_string())
    .bind("@everyone")
    .bind("#99a1b3")
    .bind(0)
    .bind(Permissions::EVERYONE_DEFAULT.bits() as i64)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO members (server_id, user_id, joined_at, accepted_rules) VALUES (?, ?, ?, 1)",
    )
    .bind(server_id.to_string())
    .bind(user.id.to_string())
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    // Default channels
    let cat_id = Uuid::new_v4();
    let text_id = Uuid::new_v4();
    let voice_id = Uuid::new_v4();
    for (id, name, ty, pos, cat) in [
        (cat_id, "Text Channels", "category", 0, None),
        (text_id, "general", "text", 1, Some(cat_id)),
        (voice_id, "Lobby", "voice", 2, None),
    ] {
        sqlx::query(
            "INSERT INTO channels (id, server_id, category_id, name, channel_type, position, background_blur, background_dim, user_limit) VALUES (?, ?, ?, ?, ?, ?, 0, 0.45, 0)",
        )
        .bind(id.to_string())
        .bind(server_id.to_string())
        .bind(cat.map(|c| c.to_string()))
        .bind(name)
        .bind(ty)
        .bind(pos)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "INSERT INTO server_rules (id, server_id, title, body, position) VALUES (?, ?, ?, ?, 0)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(server_id.to_string())
    .bind("Be respectful")
    .bind("Treat everyone with respect. Harassment and hate speech are not allowed.")
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    state.hub.set_server_members(server_id, vec![user.id]);
    let server = db::get_server(&state.db, server_id).await?;
    Ok(Json(server))
}

pub async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Server>> {
    if !db::is_member(&state.db, id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    Ok(Json(db::get_server(&state.db, id).await?))
}

pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateServerReq>,
) -> AppResult<Json<Server>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::MANAGE_SERVER,
    )
    .await?;

    if let Some(name) = body.name {
        sqlx::query("UPDATE servers SET name = ? WHERE id = ?")
            .bind(name.trim())
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(v) = body.icon_url {
        sqlx::query("UPDATE servers SET icon_url = ? WHERE id = ?")
            .bind(v.as_deref())
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(v) = body.banner_url {
        sqlx::query("UPDATE servers SET banner_url = ? WHERE id = ?")
            .bind(v.as_deref())
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(v) = body.accent_color {
        sqlx::query("UPDATE servers SET accent_color = ? WHERE id = ?")
            .bind(v)
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(v) = body.invite_splash_url {
        sqlx::query("UPDATE servers SET invite_splash_url = ? WHERE id = ?")
            .bind(v.as_deref())
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }

    let server = db::get_server(&state.db, id).await?;
    state
        .hub
        .broadcast_server(id, &WsEvent::ServerUpdate { server: server.clone() });
    Ok(Json(server))
}

pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let server = db::get_server(&state.db, id).await?;
    if server.owner_id != user.id {
        return Err(AppError::Forbidden);
    }
    sqlx::query("DELETE FROM servers WHERE id = ?")
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct TransferOwnershipReq {
    pub user_id: Uuid,
}

/// Only the current owner can hand the server to another member.
pub async fn transfer_ownership(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<TransferOwnershipReq>,
) -> AppResult<Json<Server>> {
    let server = db::get_server(&state.db, id).await?;
    if server.owner_id != user.id {
        return Err(AppError::Forbidden);
    }
    if body.user_id == user.id {
        return Err(AppError::BadRequest("already the owner".into()));
    }
    if !db::is_member(&state.db, id, body.user_id).await? {
        return Err(AppError::BadRequest(
            "new owner must be a member of this server".into(),
        ));
    }
    sqlx::query("UPDATE servers SET owner_id = ? WHERE id = ?")
        .bind(body.user_id.to_string())
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    let server = db::get_server(&state.db, id).await?;
    state
        .hub
        .broadcast_server(id, &WsEvent::ServerUpdate { server: server.clone() });
    Ok(Json(server))
}

pub async fn list_members(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Member>>> {
    if !db::is_member(&state.db, id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    let ids = db::server_member_ids(&state.db, id).await?;
    let mut out = Vec::new();
    for uid in ids {
        out.push(db::get_member(&state.db, id, uid).await?);
    }
    Ok(Json(out))
}

#[derive(serde::Serialize)]
pub struct PresenceView {
    pub user_id: Uuid,
    pub status: speakapp_shared::PresenceStatus,
}

pub async fn list_presence(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<PresenceView>>> {
    if !db::is_member(&state.db, id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    let ids = db::server_member_ids(&state.db, id).await?;
    // Refresh hub membership cache so presence fanout stays accurate.
    state.hub.set_server_members(id, ids.clone());
    let out = ids
        .into_iter()
        .map(|user_id| PresenceView {
            user_id,
            status: state.hub.public_status(user_id),
        })
        .collect();
    Ok(Json(out))
}

pub async fn kick_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, user_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(&state.db, &server, None, user.id, Permissions::KICK_MEMBERS)
        .await?;
    if !db::can_moderate_member(&state.db, &server, user.id, user_id).await? {
        return Err(AppError::Forbidden);
    }
    sqlx::query("DELETE FROM members WHERE server_id = ? AND user_id = ?")
        .bind(id.to_string())
        .bind(user_id.to_string())
        .execute(&state.db)
        .await?;
    let now = Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "UPDATE voice_states SET channel_id = NULL, streaming = 0, updated_at = ? WHERE user_id = ?",
    )
    .bind(&now)
    .bind(user_id.to_string())
    .execute(&state.db)
    .await;
    state.hub.remove_server_member(id, user_id);
    state.hub.broadcast_server(
        id,
        &WsEvent::MemberLeave {
            server_id: id,
            user_id,
        },
    );
    state.hub.broadcast_server(
        id,
        &WsEvent::VoiceStateUpdate {
            channel_id: None,
            user_id,
            muted: false,
            deafened: false,
            streaming: false,
            server_muted: false,
            server_deafened: false,
        },
    );
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct ModVoiceReq {
    pub server_muted: Option<bool>,
    pub server_deafened: Option<bool>,
}

/// Owner / MUTE_MEMBERS: force mute or deafen a member in voice.
pub async fn moderate_voice(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<ModVoiceReq>,
) -> AppResult<Json<crate::routes::voice::VoiceStateView>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(&state.db, &server, None, user.id, Permissions::MUTE_MEMBERS)
        .await?;
    if !db::can_moderate_member(&state.db, &server, user.id, user_id).await? {
        return Err(AppError::Forbidden);
    }
    if !db::is_member(&state.db, id, user_id).await? {
        return Err(AppError::NotFound);
    }
    crate::routes::voice::moderator_set_voice(&state, id, user_id, body.server_muted, body.server_deafened).await
}

#[derive(Deserialize)]
pub struct TimeoutReq {
    /// Seconds from now. Use `0` or omit with `clear: true` to remove timeout.
    pub duration_seconds: Option<u64>,
    pub reason: Option<String>,
    #[serde(default)]
    pub clear: bool,
}

/// Temporarily block chat, reactions, and voice (MUTE_MEMBERS or KICK_MEMBERS).
pub async fn timeout_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<TimeoutReq>,
) -> AppResult<Json<Member>> {
    let server = db::get_server(&state.db, id).await?;
    let perms = db::effective_permissions(&state.db, &server, None, user.id).await?;
    if !perms.has(Permissions::MUTE_MEMBERS) && !perms.has(Permissions::KICK_MEMBERS) {
        return Err(AppError::Forbidden);
    }
    if !db::can_moderate_member(&state.db, &server, user.id, user_id).await? {
        return Err(AppError::Forbidden);
    }
    if !db::is_member(&state.db, id, user_id).await? {
        return Err(AppError::NotFound);
    }
    if user_id == server.owner_id {
        return Err(AppError::BadRequest("cannot timeout the server owner".into()));
    }
    if user_id == user.id {
        return Err(AppError::BadRequest("cannot timeout yourself".into()));
    }

    let reason = body
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(500).collect::<String>());

    if body.clear || body.duration_seconds == Some(0) {
        sqlx::query(
            "UPDATE members SET timeout_until = NULL, timeout_reason = NULL WHERE server_id = ? AND user_id = ?",
        )
        .bind(id.to_string())
        .bind(user_id.to_string())
        .execute(&state.db)
        .await?;
    } else {
        let secs = body.duration_seconds.ok_or_else(|| {
            AppError::BadRequest("duration_seconds required (or clear: true)".into())
        })?;
        // Cap at 1 year; presets are shorter, custom days map into seconds on the client.
        const MAX_SECS: u64 = 365 * 24 * 60 * 60;
        if secs == 0 || secs > MAX_SECS {
            return Err(AppError::BadRequest(
                "timeout duration must be between 1 second and 365 days".into(),
            ));
        }
        let until = (Utc::now() + chrono::Duration::seconds(secs as i64)).to_rfc3339();
        sqlx::query(
            "UPDATE members SET timeout_until = ?, timeout_reason = ? WHERE server_id = ? AND user_id = ?",
        )
        .bind(&until)
        .bind(reason.as_deref())
        .bind(id.to_string())
        .bind(user_id.to_string())
        .execute(&state.db)
        .await?;

        // Kick from voice for the duration.
        let now = Utc::now().to_rfc3339();
        let _ = sqlx::query(
            "UPDATE voice_states SET channel_id = NULL, streaming = 0, updated_at = ? WHERE user_id = ?",
        )
        .bind(&now)
        .bind(user_id.to_string())
        .execute(&state.db)
        .await;
        state.hub.broadcast_server(
            id,
            &WsEvent::VoiceStateUpdate {
                channel_id: None,
                user_id,
                muted: false,
                deafened: false,
                streaming: false,
                server_muted: false,
                server_deafened: false,
            },
        );
    }

    let member = db::get_member(&state.db, id, user_id).await?;
    state
        .hub
        .broadcast_server(id, &WsEvent::MemberUpdate { member: member.clone() });
    Ok(Json(member))
}

pub async fn ban_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<BanReq>,
) -> AppResult<Json<serde_json::Value>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(&state.db, &server, None, user.id, Permissions::BAN_MEMBERS)
        .await?;
    if !db::can_moderate_member(&state.db, &server, user.id, body.user_id).await? {
        return Err(AppError::Forbidden);
    }
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR REPLACE INTO bans (server_id, user_id, reason, banned_by, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(body.user_id.to_string())
    .bind(body.reason)
    .bind(user.id.to_string())
    .bind(&now)
    .execute(&state.db)
    .await?;
    sqlx::query("DELETE FROM members WHERE server_id = ? AND user_id = ?")
        .bind(id.to_string())
        .bind(body.user_id.to_string())
        .execute(&state.db)
        .await?;
    state.hub.remove_server_member(id, body.user_id);
    // Drop voice presence if they were in a lobby.
    let _ = sqlx::query("UPDATE voice_states SET channel_id = NULL, streaming = 0, updated_at = ? WHERE user_id = ?")
        .bind(&now)
        .bind(body.user_id.to_string())
        .execute(&state.db)
        .await;
    state.hub.broadcast_server(
        id,
        &WsEvent::MemberLeave {
            server_id: id,
            user_id: body.user_id,
        },
    );
    state.hub.broadcast_server(
        id,
        &WsEvent::VoiceStateUpdate {
            channel_id: None,
            user_id: body.user_id,
            muted: false,
            deafened: false,
            streaming: false,
            server_muted: false,
            server_deafened: false,
        },
    );
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn unban_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, user_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(&state.db, &server, None, user.id, Permissions::BAN_MEMBERS)
        .await?;
    sqlx::query("DELETE FROM bans WHERE server_id = ? AND user_id = ?")
        .bind(id.to_string())
        .bind(user_id.to_string())
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn list_bans(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<BanInfo>>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(&state.db, &server, None, user.id, Permissions::BAN_MEMBERS)
        .await?;
    #[derive(sqlx::FromRow)]
    struct Row {
        user_id: String,
        reason: Option<String>,
        banned_by: String,
        created_at: String,
    }
    let rows = sqlx::query_as::<_, Row>(
        "SELECT user_id, reason, banned_by, created_at FROM bans WHERE server_id = ?",
    )
    .bind(id.to_string())
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| BanInfo {
                user_id: Uuid::parse_str(&r.user_id).unwrap(),
                reason: r.reason,
                banned_by: Uuid::parse_str(&r.banned_by).unwrap(),
                created_at: r.created_at,
            })
            .collect(),
    ))
}

pub async fn create_invite(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateInviteReq>,
) -> AppResult<Json<Invite>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::CREATE_INVITE,
    )
    .await?;
    let code = {
        use rand::Rng;
        const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let mut rng = rand::thread_rng();
        (0..8)
            .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
            .collect::<String>()
    };
    let now = Utc::now();
    let expires = match body.max_age {
        Some(secs) if secs > 0 => Some((now + Duration::seconds(secs)).to_rfc3339()),
        Some(_) => None,
        None => body
            .expires_hours
            .filter(|h| *h > 0)
            .map(|h| (now + Duration::hours(h)).to_rfc3339()),
    };
    sqlx::query(
        "INSERT INTO invites (code, server_id, creator_id, max_uses, uses, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(&code)
    .bind(id.to_string())
    .bind(user.id.to_string())
    .bind(body.max_uses.map(|u| u as i64))
    .bind(&expires)
    .bind(now.to_rfc3339())
    .execute(&state.db)
    .await?;

    Ok(Json(Invite {
        code,
        server_id: id,
        creator_id: user.id,
        max_uses: body.max_uses,
        uses: 0,
        expires_at: expires.and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(&s)
                .ok()
                .map(|d| d.with_timezone(&Utc))
        }),
    }))
}

pub async fn list_invites(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Invite>>> {
    let server = db::get_server(&state.db, id).await?;
    // Creators can view the list; managers always can.
    let ok = db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::CREATE_INVITE,
    )
    .await
    .is_ok()
        || db::require_perm(
            &state.db,
            &server,
            None,
            user.id,
            Permissions::MANAGE_SERVER,
        )
        .await
        .is_ok();
    if !ok {
        return Err(AppError::Forbidden);
    }
    #[derive(sqlx::FromRow)]
    struct Row {
        code: String,
        server_id: String,
        creator_id: String,
        max_uses: Option<i64>,
        uses: i64,
        expires_at: Option<String>,
    }
    let rows = sqlx::query_as::<_, Row>(
        "SELECT code, server_id, creator_id, max_uses, uses, expires_at FROM invites WHERE server_id = ? ORDER BY created_at DESC",
    )
    .bind(id.to_string())
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| Invite {
                code: r.code,
                server_id: Uuid::parse_str(&r.server_id).unwrap(),
                creator_id: Uuid::parse_str(&r.creator_id).unwrap(),
                max_uses: r.max_uses.map(|u| u as u32),
                uses: r.uses as u32,
                expires_at: r.expires_at.and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(&s)
                        .ok()
                        .map(|d| d.with_timezone(&Utc))
                }),
            })
            .collect(),
    ))
}

pub async fn delete_invite(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, code)): Path<(Uuid, String)>,
) -> AppResult<Json<serde_json::Value>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::CREATE_INVITE,
    )
    .await?;
    let res = sqlx::query("DELETE FROM invites WHERE server_id = ? AND code = ?")
        .bind(id.to_string())
        .bind(&code)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct InviteFriendReq {
    pub user_id: Uuid,
}

/// Add an accepted friend to the server (Discord-style Invite People).
pub async fn invite_friend(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<InviteFriendReq>,
) -> AppResult<Json<Member>> {
    if body.user_id == user.id {
        return Err(AppError::BadRequest("cannot invite yourself".into()));
    }
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::CREATE_INVITE,
    )
    .await?;
    if !crate::routes::friends::are_friends(&state.db, user.id, body.user_id).await? {
        return Err(AppError::BadRequest("you can only invite friends".into()));
    }
    let banned: (i64,) =
        sqlx::query_as("SELECT COUNT(1) FROM bans WHERE server_id = ? AND user_id = ?")
            .bind(id.to_string())
            .bind(body.user_id.to_string())
            .fetch_one(&state.db)
            .await?;
    if banned.0 > 0 {
        return Err(AppError::Forbidden);
    }
    if db::is_member(&state.db, id, body.user_id).await? {
        return Ok(Json(db::get_member(&state.db, id, body.user_id).await?));
    }
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO members (server_id, user_id, joined_at, accepted_rules) VALUES (?, ?, ?, 0)",
    )
    .bind(id.to_string())
    .bind(body.user_id.to_string())
    .bind(&now)
    .execute(&state.db)
    .await?;

    state.hub.add_server_member(id, body.user_id);
    let member = db::get_member(&state.db, id, body.user_id).await?;
    state
        .hub
        .broadcast_server(id, &WsEvent::MemberJoin { member: member.clone() });

    let (member_count, online_count) = invite_presence_counts(&state, id).await?;
    let invited_by = db::user_public(&state.db, user.id).await?;
    state.hub.send_to_user(
        body.user_id,
        &WsEvent::ServerInvite {
            server: server.clone(),
            invited_by,
            member_count,
            online_count,
        },
    );

    Ok(Json(member))
}

pub async fn invite_info(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let invite = load_invite(&state, &code).await?;
    let server = db::get_server(&state.db, invite.server_id).await?;
    let (member_count, online_count) = invite_presence_counts(&state, invite.server_id).await?;
    Ok(Json(serde_json::json!({
        "invite": invite,
        "server": server,
        "member_count": member_count,
        "online_count": online_count,
    })))
}

async fn invite_presence_counts(state: &AppState, server_id: Uuid) -> AppResult<(u32, u32)> {
    let ids = db::server_member_ids(&state.db, server_id).await?;
    let member_count = ids.len() as u32;
    let online_count = state.hub.online_among(&ids).len() as u32;
    Ok((member_count, online_count))
}

pub async fn join_invite(
    State(state): State<AppState>,
    user: AuthUser,
    Path(code): Path<String>,
) -> AppResult<Json<Server>> {
    let invite = load_invite(&state, &code).await?;
    let banned: (i64,) =
        sqlx::query_as("SELECT COUNT(1) FROM bans WHERE server_id = ? AND user_id = ?")
            .bind(invite.server_id.to_string())
            .bind(user.id.to_string())
            .fetch_one(&state.db)
            .await?;
    if banned.0 > 0 {
        return Err(AppError::Forbidden);
    }
    if db::is_member(&state.db, invite.server_id, user.id).await? {
        return Ok(Json(db::get_server(&state.db, invite.server_id).await?));
    }
    let now = Utc::now().to_rfc3339();
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO members (server_id, user_id, joined_at, accepted_rules) VALUES (?, ?, ?, 0)",
    )
    .bind(invite.server_id.to_string())
    .bind(user.id.to_string())
    .bind(&now)
    .execute(&mut *tx)
    .await?;
    // Atomic use count — refuse if exhausted under concurrency.
    let updated = if let Some(max) = invite.max_uses {
        sqlx::query("UPDATE invites SET uses = uses + 1 WHERE code = ? AND uses < ?")
            .bind(&code)
            .bind(max as i64)
            .execute(&mut *tx)
            .await?
            .rows_affected()
    } else {
        sqlx::query("UPDATE invites SET uses = uses + 1 WHERE code = ?")
            .bind(&code)
            .execute(&mut *tx)
            .await?
            .rows_affected()
    };
    if updated == 0 {
        return Err(AppError::BadRequest("invite exhausted".into()));
    }
    tx.commit().await?;

    state.hub.add_server_member(invite.server_id, user.id);
    let member = db::get_member(&state.db, invite.server_id, user.id).await?;
    state
        .hub
        .broadcast_server(invite.server_id, &WsEvent::MemberJoin { member });

    Ok(Json(db::get_server(&state.db, invite.server_id).await?))
}

async fn load_invite(state: &AppState, code: &str) -> AppResult<Invite> {
    #[derive(sqlx::FromRow)]
    struct Row {
        code: String,
        server_id: String,
        creator_id: String,
        max_uses: Option<i64>,
        uses: i64,
        expires_at: Option<String>,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT code, server_id, creator_id, max_uses, uses, expires_at FROM invites WHERE code = ?",
    )
    .bind(code)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    if let Some(exp) = &row.expires_at {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(exp) {
            if dt.with_timezone(&Utc) < Utc::now() {
                return Err(AppError::BadRequest("invite expired".into()));
            }
        }
    }
    if let Some(max) = row.max_uses {
        if row.uses >= max {
            return Err(AppError::BadRequest("invite exhausted".into()));
        }
    }
    Ok(Invite {
        code: row.code,
        server_id: Uuid::parse_str(&row.server_id).unwrap(),
        creator_id: Uuid::parse_str(&row.creator_id).unwrap(),
        max_uses: row.max_uses.map(|u| u as u32),
        uses: row.uses as u32,
        expires_at: row.expires_at.and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(&s)
                .ok()
                .map(|d| d.with_timezone(&Utc))
        }),
    })
}

pub async fn list_roles(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Role>>> {
    if !db::is_member(&state.db, id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    Ok(Json(db::server_roles(&state.db, id).await?))
}

pub async fn create_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateRoleReq>,
) -> AppResult<Json<Role>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(&state.db, &server, None, user.id, Permissions::MANAGE_ROLES)
        .await?;
    let role_id = Uuid::new_v4();
    let perms = db::cap_role_permissions(
        &state.db,
        &server,
        user.id,
        body.permissions.unwrap_or(0),
    )
    .await?;
    let color = body.color.unwrap_or_else(|| "#99a1b3".into());
    let max_pos: (i64,) =
        sqlx::query_as("SELECT COALESCE(MAX(position), 0) FROM roles WHERE server_id = ?")
            .bind(id.to_string())
            .fetch_one(&state.db)
            .await?;
    // New roles sit below the actor's highest role (unless owner).
    let actor_pos = if user.id == server.owner_id {
        max_pos.0 + 1
    } else {
        db::member_highest_position(&state.db, id, user.id).await? as i64
    };
    let position = (max_pos.0 + 1).min(actor_pos.max(0));
    sqlx::query(
        "INSERT INTO roles (id, server_id, name, color, gradient, position, permissions, is_everyone) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
    )
    .bind(role_id.to_string())
    .bind(id.to_string())
    .bind(body.name.trim())
    .bind(color)
    .bind(body.gradient)
    .bind(position)
    .bind(perms as i64)
    .execute(&state.db)
    .await?;
    let roles = db::server_roles(&state.db, id).await?;
    Ok(Json(
        roles.into_iter().find(|r| r.id == role_id).unwrap(),
    ))
}

pub async fn update_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, role_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateRoleReq>,
) -> AppResult<Json<Role>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(&state.db, &server, None, user.id, Permissions::MANAGE_ROLES)
        .await?;
    let roles = db::server_roles(&state.db, id).await?;
    let target = roles
        .iter()
        .find(|r| r.id == role_id)
        .ok_or(AppError::NotFound)?;
    if target.is_everyone {
        return Err(AppError::BadRequest("cannot edit @everyone this way".into()));
    }
    if user.id != server.owner_id {
        let actor_pos = db::member_highest_position(&state.db, id, user.id).await?;
        if target.position >= actor_pos {
            return Err(AppError::Forbidden);
        }
    }
    if let Some(name) = body.name {
        sqlx::query("UPDATE roles SET name = ? WHERE id = ? AND server_id = ? AND is_everyone = 0")
            .bind(name.trim())
            .bind(role_id.to_string())
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(color) = body.color {
        sqlx::query("UPDATE roles SET color = ? WHERE id = ? AND server_id = ?")
            .bind(color)
            .bind(role_id.to_string())
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(gradient) = body.gradient {
        sqlx::query("UPDATE roles SET gradient = ? WHERE id = ? AND server_id = ?")
            .bind(gradient)
            .bind(role_id.to_string())
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(perms) = body.permissions {
        let capped = db::cap_role_permissions(&state.db, &server, user.id, perms).await?;
        sqlx::query("UPDATE roles SET permissions = ? WHERE id = ? AND server_id = ?")
            .bind(capped as i64)
            .bind(role_id.to_string())
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(pos) = body.position {
        let mut next_pos = pos;
        if user.id != server.owner_id {
            let actor_pos = db::member_highest_position(&state.db, id, user.id).await?;
            if next_pos >= actor_pos {
                next_pos = actor_pos.saturating_sub(1);
            }
        }
        sqlx::query("UPDATE roles SET position = ? WHERE id = ? AND server_id = ?")
            .bind(next_pos)
            .bind(role_id.to_string())
            .bind(id.to_string())
            .execute(&state.db)
            .await?;
    }
    let roles = db::server_roles(&state.db, id).await?;
    roles
        .into_iter()
        .find(|r| r.id == role_id)
        .map(Json)
        .ok_or(AppError::NotFound)
}

pub async fn delete_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, role_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(&state.db, &server, None, user.id, Permissions::MANAGE_ROLES)
        .await?;
    let roles = db::server_roles(&state.db, id).await?;
    let target = roles
        .iter()
        .find(|r| r.id == role_id)
        .ok_or(AppError::NotFound)?;
    if target.is_everyone {
        return Err(AppError::BadRequest("cannot delete @everyone".into()));
    }
    if user.id != server.owner_id {
        let actor_pos = db::member_highest_position(&state.db, id, user.id).await?;
        if target.position >= actor_pos {
            return Err(AppError::Forbidden);
        }
    }
    sqlx::query("DELETE FROM roles WHERE id = ? AND server_id = ? AND is_everyone = 0")
        .bind(role_id.to_string())
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn set_member_roles(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<SetRolesReq>,
) -> AppResult<Json<Member>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(&state.db, &server, None, user.id, Permissions::MANAGE_ROLES)
        .await?;
    if !db::is_member(&state.db, id, user_id).await? {
        return Err(AppError::NotFound);
    }
    if !db::can_moderate_member(&state.db, &server, user.id, user_id).await?
        && user.id != server.owner_id
    {
        // Owners always can; otherwise must outrank the target.
        if user_id != user.id {
            return Err(AppError::Forbidden);
        }
    }
    let roles = db::server_roles(&state.db, id).await?;
    let actor_pos = if user.id == server.owner_id {
        i32::MAX
    } else {
        db::member_highest_position(&state.db, id, user.id).await?
    };
    let mut allowed: Vec<Uuid> = Vec::new();
    for role_id in body.role_ids {
        let Some(role) = roles.iter().find(|r| r.id == role_id) else {
            continue;
        };
        if role.is_everyone {
            continue;
        }
        if role.position >= actor_pos && user.id != server.owner_id {
            return Err(AppError::Forbidden);
        }
        allowed.push(role_id);
    }
    sqlx::query("DELETE FROM member_roles WHERE server_id = ? AND user_id = ?")
        .bind(id.to_string())
        .bind(user_id.to_string())
        .execute(&state.db)
        .await?;
    for role_id in allowed {
        sqlx::query(
            "INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(user_id.to_string())
        .bind(role_id.to_string())
        .execute(&state.db)
        .await?;
    }
    Ok(Json(db::get_member(&state.db, id, user_id).await?))
}

pub async fn list_rules(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<ServerRule>>> {
    if !db::is_member(&state.db, id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    Ok(Json(db::server_rules(&state.db, id).await?))
}

pub async fn set_rules(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<RulesReq>,
) -> AppResult<Json<Vec<ServerRule>>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::MANAGE_SERVER,
    )
    .await?;
    sqlx::query("DELETE FROM server_rules WHERE server_id = ?")
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    for (i, rule) in body.rules.iter().enumerate() {
        sqlx::query(
            "INSERT INTO server_rules (id, server_id, title, body, position) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(id.to_string())
        .bind(rule.title.trim())
        .bind(rule.body.trim())
        .bind(i as i64)
        .execute(&state.db)
        .await?;
    }
    Ok(Json(db::server_rules(&state.db, id).await?))
}

pub async fn accept_rules(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    if !db::is_member(&state.db, id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    sqlx::query("UPDATE members SET accepted_rules = 1 WHERE server_id = ? AND user_id = ?")
        .bind(id.to_string())
        .bind(user.id.to_string())
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
