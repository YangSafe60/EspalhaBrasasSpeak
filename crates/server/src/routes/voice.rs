use crate::auth::AuthUser;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::livekit::{mint_participant_token, voice_room_name};
use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Deserializer, Serialize};
use speakapp_shared::{ChannelType, Permissions, WsEvent};
use uuid::Uuid;

#[derive(Serialize)]
pub struct VoiceTokenResponse {
    pub token: String,
    pub url: String,
    pub room: String,
}

#[derive(Deserialize)]
pub struct VoiceStateReq {
    /// `null` clears channel (leave); omit to keep current.
    #[serde(default, deserialize_with = "crate::routes::voice::deserialize_optional_channel")]
    pub channel_id: Option<Option<Uuid>>,
    pub muted: Option<bool>,
    pub deafened: Option<bool>,
    pub streaming: Option<bool>,
}

fn deserialize_optional_channel<'de, D>(
    deserializer: D,
) -> Result<Option<Option<Uuid>>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Some(Option::<Uuid>::deserialize(deserializer)?))
}

#[derive(Serialize, Clone)]
pub struct VoiceStateView {
    pub user_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub muted: bool,
    pub deafened: bool,
    pub streaming: bool,
    pub server_muted: bool,
    pub server_deafened: bool,
}

#[derive(Deserialize)]
pub struct ListVoiceQuery {
    pub server_id: Uuid,
}

pub async fn token(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<VoiceTokenResponse>> {
    let channel = db::get_channel(&state.db, id).await?;
    user.bot_server_scope(channel.server_id)?;
    if channel.channel_type != ChannelType::Voice {
        return Err(AppError::BadRequest("not a voice channel".into()));
    }
    let server = db::get_server(&state.db, channel.server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        Some(id),
        user.id,
        Permissions::CONNECT,
    )
    .await?;
    if !user.is_bot() {
        db::require_not_timed_out(&state.db, server.id, user.id).await?;
    }

    if channel.user_limit > 0 {
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(1) FROM voice_states WHERE channel_id = ? AND user_id != ?",
        )
        .bind(id.to_string())
        .bind(user.id.to_string())
        .fetch_one(&state.db)
        .await?;
        if count.0 >= channel.user_limit as i64 {
            return Err(AppError::BadRequest("voice channel is full".into()));
        }
    }

    let can_speak = db::effective_permissions(&state.db, &server, Some(id), user.id)
        .await?
        .has(Permissions::SPEAK);
    let profile = db::user_public(&state.db, user.id).await?;
    let room = voice_room_name(id);
    let token = mint_participant_token(
        &state.config.livekit_api_key,
        &state.config.livekit_api_secret,
        &room,
        user.id,
        &profile.display_name,
        can_speak,
    )?;

    // Upsert voice state join — keep mute/deafen/streaming across lobby switches.
    let now = Utc::now().to_rfc3339();
    #[derive(sqlx::FromRow)]
    struct Prior {
        muted: i64,
        deafened: i64,
        streaming: i64,
        server_muted: i64,
        server_deafened: i64,
    }
    let prior = sqlx::query_as::<_, Prior>(
        "SELECT muted, deafened, streaming, server_muted, server_deafened FROM voice_states WHERE user_id = ?",
    )
    .bind(user.id.to_string())
    .fetch_optional(&state.db)
    .await?;

    let muted = prior.as_ref().map(|p| p.muted != 0).unwrap_or(false)
        || prior.as_ref().map(|p| p.server_muted != 0).unwrap_or(false);
    let deafened = prior.as_ref().map(|p| p.deafened != 0).unwrap_or(false)
        || prior.as_ref().map(|p| p.server_deafened != 0).unwrap_or(false);
    let streaming = prior.as_ref().map(|p| p.streaming != 0).unwrap_or(false);
    let server_muted = prior.as_ref().map(|p| p.server_muted != 0).unwrap_or(false);
    let server_deafened = prior
        .as_ref()
        .map(|p| p.server_deafened != 0)
        .unwrap_or(false);

    sqlx::query(
        r#"INSERT INTO voice_states (user_id, channel_id, muted, deafened, streaming, server_muted, server_deafened, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET channel_id = excluded.channel_id, updated_at = excluded.updated_at"#,
    )
    .bind(user.id.to_string())
    .bind(id.to_string())
    .bind(muted as i64)
    .bind(deafened as i64)
    .bind(streaming as i64)
    .bind(server_muted as i64)
    .bind(server_deafened as i64)
    .bind(&now)
    .execute(&state.db)
    .await?;

    state.hub.broadcast_server(
        channel.server_id,
        &WsEvent::VoiceStateUpdate {
            channel_id: Some(id),
            user_id: user.id,
            muted,
            deafened,
            streaming,
            server_muted,
            server_deafened,
        },
    );

    Ok(Json(VoiceTokenResponse {
        token,
        // Prefer loopback IPv4 — `localhost` can resolve to ::1 and break
        // WebRTC ICE inside Tauri/WebView2 while Chrome still works.
        // Also rewrite Docker/loopback LIVEKIT_URL using PUBLIC_URL on VPS.
        url: state.config.client_livekit_url(),
        room,
    }))
}

/// Clears lobby membership when a client disappears without calling leave.
pub async fn clear_stale_presence(state: &AppState, user_id: Uuid) {
    #[derive(sqlx::FromRow)]
    struct Row {
        channel_id: Option<String>,
        muted: i64,
        deafened: i64,
        server_muted: i64,
        server_deafened: i64,
    }
    let Ok(Some(existing)) = sqlx::query_as::<_, Row>(
        "SELECT channel_id, muted, deafened, server_muted, server_deafened FROM voice_states WHERE user_id = ?",
    )
    .bind(user_id.to_string())
    .fetch_optional(&state.db)
    .await
    else {
        return;
    };

    let Some(prev) = existing
        .channel_id
        .as_ref()
        .and_then(|c| Uuid::parse_str(c).ok())
    else {
        return;
    };

    let now = Utc::now().to_rfc3339();
    let _ = sqlx::query(
        r#"UPDATE voice_states
           SET channel_id = NULL, streaming = 0, updated_at = ?
           WHERE user_id = ?"#,
    )
    .bind(&now)
    .bind(user_id.to_string())
    .execute(&state.db)
    .await;

    if let Ok(channel) = db::get_channel(&state.db, prev).await {
        state.hub.broadcast_server(
            channel.server_id,
            &WsEvent::VoiceStateUpdate {
                channel_id: None,
                user_id,
                muted: existing.muted != 0,
                deafened: existing.deafened != 0,
                streaming: false,
                server_muted: existing.server_muted != 0,
                server_deafened: existing.server_deafened != 0,
            },
        );
    }
}

pub async fn update_state(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<VoiceStateReq>,
) -> AppResult<Json<VoiceStateView>> {
    let now = Utc::now().to_rfc3339();
    #[derive(sqlx::FromRow)]
    struct Row {
        channel_id: Option<String>,
        muted: i64,
        deafened: i64,
        streaming: i64,
        server_muted: i64,
        server_deafened: i64,
    }
    let existing = sqlx::query_as::<_, Row>(
        "SELECT channel_id, muted, deafened, streaming, server_muted, server_deafened FROM voice_states WHERE user_id = ?",
    )
    .bind(user.id.to_string())
    .fetch_optional(&state.db)
    .await?;

    let server_muted = existing.as_ref().map(|e| e.server_muted != 0).unwrap_or(false);
    let server_deafened = existing
        .as_ref()
        .map(|e| e.server_deafened != 0)
        .unwrap_or(false);

    let mut muted = body
        .muted
        .unwrap_or(existing.as_ref().map(|e| e.muted != 0).unwrap_or(false));
    let mut deafened = body
        .deafened
        .unwrap_or(existing.as_ref().map(|e| e.deafened != 0).unwrap_or(false));
    if server_muted {
        muted = true;
    }
    if server_deafened {
        deafened = true;
    }
    let streaming = body
        .streaming
        .unwrap_or(existing.as_ref().map(|e| e.streaming != 0).unwrap_or(false));
    let channel_id = match body.channel_id {
        Some(v) => v,
        None => existing
            .as_ref()
            .and_then(|e| e.channel_id.as_ref())
            .and_then(|c| Uuid::parse_str(c).ok()),
    };

    // Joining / staying in a voice channel requires membership + CONNECT.
    if let Some(cid) = channel_id {
        let channel = db::get_channel(&state.db, cid).await?;
        if channel.channel_type != ChannelType::Voice {
            return Err(AppError::BadRequest("not a voice channel".into()));
        }
        let server = db::get_server(&state.db, channel.server_id).await?;
        db::require_perm(
            &state.db,
            &server,
            Some(cid),
            user.id,
            Permissions::CONNECT,
        )
        .await?;
    }

    sqlx::query(
        r#"INSERT INTO voice_states (user_id, channel_id, muted, deafened, streaming, server_muted, server_deafened, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             channel_id = excluded.channel_id,
             muted = excluded.muted,
             deafened = excluded.deafened,
             streaming = excluded.streaming,
             updated_at = excluded.updated_at"#,
    )
    .bind(user.id.to_string())
    .bind(channel_id.map(|c| c.to_string()))
    .bind(muted as i64)
    .bind(deafened as i64)
    .bind(streaming as i64)
    .bind(server_muted as i64)
    .bind(server_deafened as i64)
    .bind(&now)
    .execute(&state.db)
    .await?;

    let event = WsEvent::VoiceStateUpdate {
        channel_id,
        user_id: user.id,
        muted,
        deafened,
        streaming,
        server_muted,
        server_deafened,
    };
    if let Some(cid) = channel_id {
        if let Ok(channel) = db::get_channel(&state.db, cid).await {
            state.hub.broadcast_server(channel.server_id, &event);
        }
    } else if let Some(prev) = existing
        .and_then(|e| e.channel_id)
        .and_then(|c| Uuid::parse_str(&c).ok())
    {
        if let Ok(channel) = db::get_channel(&state.db, prev).await {
            state.hub.broadcast_server(channel.server_id, &event);
        }
    }

    Ok(Json(VoiceStateView {
        user_id: user.id,
        channel_id,
        muted,
        deafened,
        streaming,
        server_muted,
        server_deafened,
    }))
}

pub async fn moderator_set_voice(
    state: &AppState,
    server_id: Uuid,
    target_id: Uuid,
    server_muted: Option<bool>,
    server_deafened: Option<bool>,
) -> AppResult<Json<VoiceStateView>> {
    let now = Utc::now().to_rfc3339();
    #[derive(sqlx::FromRow)]
    struct Row {
        channel_id: Option<String>,
        muted: i64,
        deafened: i64,
        streaming: i64,
        server_muted: i64,
        server_deafened: i64,
    }
    let existing = sqlx::query_as::<_, Row>(
        "SELECT channel_id, muted, deafened, streaming, server_muted, server_deafened FROM voice_states WHERE user_id = ?",
    )
    .bind(target_id.to_string())
    .fetch_optional(&state.db)
    .await?;

    let sm = server_muted.unwrap_or(
        existing
            .as_ref()
            .map(|e| e.server_muted != 0)
            .unwrap_or(false),
    );
    let sd = server_deafened.unwrap_or(
        existing
            .as_ref()
            .map(|e| e.server_deafened != 0)
            .unwrap_or(false),
    );
    let muted = if sm {
        true
    } else {
        existing.as_ref().map(|e| e.muted != 0).unwrap_or(false)
    };
    let deafened = if sd {
        true
    } else {
        existing.as_ref().map(|e| e.deafened != 0).unwrap_or(false)
    };
    let streaming = existing.as_ref().map(|e| e.streaming != 0).unwrap_or(false);
    let channel_id = existing
        .as_ref()
        .and_then(|e| e.channel_id.as_ref())
        .and_then(|c| Uuid::parse_str(c).ok());

    sqlx::query(
        r#"INSERT INTO voice_states (user_id, channel_id, muted, deafened, streaming, server_muted, server_deafened, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             muted = excluded.muted,
             deafened = excluded.deafened,
             server_muted = excluded.server_muted,
             server_deafened = excluded.server_deafened,
             updated_at = excluded.updated_at"#,
    )
    .bind(target_id.to_string())
    .bind(channel_id.map(|c| c.to_string()))
    .bind(muted as i64)
    .bind(deafened as i64)
    .bind(streaming as i64)
    .bind(sm as i64)
    .bind(sd as i64)
    .bind(&now)
    .execute(&state.db)
    .await?;

    let view = VoiceStateView {
        user_id: target_id,
        channel_id,
        muted,
        deafened,
        streaming,
        server_muted: sm,
        server_deafened: sd,
    };
    state.hub.broadcast_server(
        server_id,
        &WsEvent::VoiceStateUpdate {
            channel_id,
            user_id: target_id,
            muted,
            deafened,
            streaming,
            server_muted: sm,
            server_deafened: sd,
        },
    );
    // Also notify the target directly in case they're not in hub cache.
    state.hub.send_to_user(
        target_id,
        &WsEvent::VoiceStateUpdate {
            channel_id,
            user_id: target_id,
            muted,
            deafened,
            streaming,
            server_muted: sm,
            server_deafened: sd,
        },
    );
    Ok(Json(view))
}

pub async fn list_states(
    State(state): State<AppState>,
    user: AuthUser,
    Query(q): Query<ListVoiceQuery>,
) -> AppResult<Json<Vec<VoiceStateView>>> {
    user.bot_server_scope(q.server_id)?;
    if !db::is_member(&state.db, q.server_id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    #[derive(sqlx::FromRow)]
    struct Row {
        user_id: String,
        channel_id: Option<String>,
        muted: i64,
        deafened: i64,
        streaming: i64,
        server_muted: i64,
        server_deafened: i64,
    }
    let rows = sqlx::query_as::<_, Row>(
        r#"SELECT vs.user_id, vs.channel_id, vs.muted, vs.deafened, vs.streaming,
                  vs.server_muted, vs.server_deafened
           FROM voice_states vs
           INNER JOIN channels c ON c.id = vs.channel_id
           WHERE c.server_id = ?"#,
    )
    .bind(q.server_id.to_string())
    .fetch_all(&state.db)
    .await?;

    Ok(Json(
        rows.into_iter()
            .map(|r| VoiceStateView {
                user_id: Uuid::parse_str(&r.user_id).unwrap(),
                channel_id: r.channel_id.and_then(|c| Uuid::parse_str(&c).ok()),
                muted: r.muted != 0,
                deafened: r.deafened != 0,
                streaming: r.streaming != 0,
                server_muted: r.server_muted != 0,
                server_deafened: r.server_deafened != 0,
            })
            .collect(),
    ))
}
