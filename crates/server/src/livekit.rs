//! Minimal LiveKit access token minting (JWT HS256) without heavy SDK deps.

use crate::error::{AppError, AppResult};
use chrono::{Duration, Utc};
use jsonwebtoken::{encode, EncodingKey, Header};
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoGrant {
    room: String,
    room_join: bool,
    can_publish: bool,
    can_subscribe: bool,
    can_publish_data: bool,
}

#[derive(Serialize)]
struct Claims {
    exp: i64,
    iss: String,
    nbf: i64,
    sub: String,
    name: String,
    video: VideoGrant,
    metadata: String,
}

pub fn mint_participant_token(
    api_key: &str,
    api_secret: &str,
    room: &str,
    identity: Uuid,
    name: &str,
    can_publish: bool,
) -> AppResult<String> {
    let now = Utc::now();
    let claims = Claims {
        exp: (now + Duration::hours(6)).timestamp(),
        iss: api_key.to_string(),
        nbf: now.timestamp(),
        sub: identity.to_string(),
        name: name.to_string(),
        video: VideoGrant {
            room: room.to_string(),
            room_join: true,
            can_publish,
            can_subscribe: true,
            can_publish_data: true,
        },
        metadata: String::new(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(api_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(e.into()))
}

pub fn voice_room_name(channel_id: Uuid) -> String {
    format!("voice_{channel_id}")
}

pub fn dm_call_room_name(dm_channel_id: Uuid) -> String {
    format!("dm_call_{dm_channel_id}")
}
