use crate::auth::AuthUser;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use speakapp_shared::{PresenceStatus, WsEvent};

#[derive(Serialize)]
pub struct PresenceMe {
    pub status: PresenceStatus,
}

#[derive(Deserialize)]
pub struct SetPresenceReq {
    pub status: String,
}

pub async fn get_my_presence(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<PresenceMe>> {
    let status = if state.hub.is_online(user.id) {
        state
            .hub
            .chosen_status(user.id)
            .unwrap_or(PresenceStatus::Online)
    } else {
        db::get_user_status(&state.db, user.id).await?
    };
    Ok(Json(PresenceMe { status }))
}

pub async fn set_my_presence(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<SetPresenceReq>,
) -> AppResult<Json<PresenceMe>> {
    let status = db::parse_presence_status(&body.status);
    // Only allow known values (reject garbage → online is ok via parse).
    let normalized = body.status.trim().to_ascii_lowercase();
    if !matches!(
        normalized.as_str(),
        "online" | "idle" | "dnd" | "busy" | "offline" | "invisible"
    ) {
        return Err(AppError::BadRequest(
            "status must be online, idle, busy, or offline".into(),
        ));
    }
    db::set_user_status(&state.db, user.id, status).await?;
    if state.hub.is_online(user.id) {
        state.hub.set_status(user.id, status);
        state.hub.broadcast_user_servers(
            user.id,
            &WsEvent::PresenceUpdate {
                user_id: user.id,
                status: state.hub.public_status(user.id),
            },
        );
    }
    Ok(Json(PresenceMe { status }))
}
