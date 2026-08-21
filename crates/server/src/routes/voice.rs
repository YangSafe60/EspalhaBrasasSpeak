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

#[derive(Serialize)]
pub struct VoiceStateView {
    pub user_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub muted: bool,
    pub deafened: bool,
    pub streaming: bool,
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

    // Upsert voice state join
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"INSERT INTO voice_states (user_id, channel_id, muted, deafened, streaming, updated_at)
           VALUES (?, ?, 0, 0, 0, ?)
           ON CONFLICT(user_id) DO UPDATE SET channel_id = excluded.channel_id, updated_at = excluded.updated_at"#,
    )
    .bind(user.id.to_string())
    .bind(id.to_string())
    .bind(&now)
    .execute(&state.db)
    .await?;

    state.hub.broadcast_server(
        channel.server_id,
        &WsEvent::VoiceStateUpdate {
            channel_id: Some(id),
            user_id: user.id,
            muted: false,
            deafened: false,
            streaming: false,
        },
    );

    Ok(Json(VoiceTokenResponse {
        token,
        url: state.config.livekit_url.clone(),
        room,
    }))
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
    }
    let existing = sqlx::query_as::<_, Row>(
        "SELECT channel_id, muted, deafened, streaming FROM voice_states WHERE user_id = ?",
    )
    .bind(user.id.to_string())
    .fetch_optional(&state.db)
    .await?;

    let muted = body
        .muted
        .unwrap_or(existing.as_ref().map(|e| e.muted != 0).unwrap_or(false));
    let deafened = body
        .deafened
        .unwrap_or(existing.as_ref().map(|e| e.deafened != 0).unwrap_or(false));
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

    sqlx::query(
        r#"INSERT INTO voice_states (user_id, channel_id, muted, deafened, streaming, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
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
    .bind(&now)
    .execute(&state.db)
    .await?;

    // Broadcast to servers the user belongs to (best-effort via channel)
    if let Some(cid) = channel_id {
        if let Ok(channel) = db::get_channel(&state.db, cid).await {
            state.hub.broadcast_server(
                channel.server_id,
                &WsEvent::VoiceStateUpdate {
                    channel_id,
                    user_id: user.id,
                    muted,
                    deafened,
                    streaming,
                },
            );
        }
    } else if let Some(prev) = existing.and_then(|e| e.channel_id).and_then(|c| Uuid::parse_str(&c).ok()) {
        if let Ok(channel) = db::get_channel(&state.db, prev).await {
            state.hub.broadcast_server(
                channel.server_id,
                &WsEvent::VoiceStateUpdate {
                    channel_id: None,
                    user_id: user.id,
                    muted,
                    deafened,
                    streaming,
                },
            );
        }
    }

    Ok(Json(VoiceStateView {
        user_id: user.id,
        channel_id,
        muted,
        deafened,
        streaming,
    }))
}

pub async fn list_states(
    State(state): State<AppState>,
    user: AuthUser,
    Query(q): Query<ListVoiceQuery>,
) -> AppResult<Json<Vec<VoiceStateView>>> {
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
    }
    let rows = sqlx::query_as::<_, Row>(
        r#"SELECT vs.user_id, vs.channel_id, vs.muted, vs.deafened, vs.streaming
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
            })
            .collect(),
    ))
}
