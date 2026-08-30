use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    extract::FromRequestParts,
    http::{request::Parts, Method},
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub exp: i64,
    pub iat: i64,
    pub typ: String,
}

#[derive(Clone)]
pub struct BotContext {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub creator_id: Uuid,
    pub created_at: chrono::DateTime<Utc>,
}

#[derive(Clone)]
pub struct AuthUser {
    /// Human user id, or bot creator id when authenticated as a bot.
    pub id: Uuid,
    pub bot: Option<BotContext>,
}

impl AuthUser {
    pub fn ensure_human(&self) -> AppResult<()> {
        if self.bot.is_some() {
            return Err(AppError::Forbidden);
        }
        Ok(())
    }

    pub fn bot_server_scope(&self, server_id: Uuid) -> AppResult<()> {
        if let Some(bot) = &self.bot {
            if bot.server_id != server_id {
                return Err(AppError::Forbidden);
            }
        }
        Ok(())
    }

    pub fn is_bot(&self) -> bool {
        self.bot.is_some()
    }
}

/// Discord-style: bots use the same REST routes as users, but only server-scoped APIs.
fn bot_may_access(method: &Method, path: &str) -> bool {
    if path == "/api/bots/me" {
        return *method == Method::GET;
    }
    if path.contains("/webhooks") || path.contains("/bots") {
        return false;
    }
    if path == "/api/servers" {
        return *method == Method::GET;
    }
    if path.starts_with("/api/servers/") {
        return true;
    }
    if path.starts_with("/api/channels/") {
        return true;
    }
    if path.starts_with("/api/messages/") {
        return true;
    }
    if path == "/api/media/upload" || path == "/api/media/remote" || path == "/api/media/imgbb-key" {
        return true;
    }
    if path == "/api/gifs/search" {
        return true;
    }
    if path.starts_with("/api/voice/") {
        return true;
    }
    if path.starts_with("/api/emojis/") {
        return *method == Method::GET;
    }
    false
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::Unauthorized)?;

        if let Some(token) = auth.strip_prefix("Bearer ") {
            let claims = decode_token(token, &state.config.jwt_secret)?;
            if claims.typ != "access" {
                return Err(AppError::Unauthorized);
            }
            if crate::db::is_user_disabled(&state.db, claims.sub).await? {
                return Err(AppError::BadRequest("account disabled".into()));
            }
            return Ok(AuthUser {
                id: claims.sub,
                bot: None,
            });
        }

        if let Some(token) = auth.strip_prefix("Bot ") {
            let path = parts.uri.path();
            if !bot_may_access(&parts.method, path) {
                return Err(AppError::Forbidden);
            }
            let token_hash = hash_token(token);

            #[derive(sqlx::FromRow)]
            struct Row {
                id: String,
                server_id: String,
                name: String,
                creator_id: String,
                created_at: String,
            }

            let row = sqlx::query_as::<_, Row>(
                "SELECT id, server_id, name, creator_id, created_at FROM server_bots WHERE token_hash = ?",
            )
            .bind(&token_hash)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::Unauthorized)?;

            let creator_id =
                Uuid::parse_str(&row.creator_id).map_err(|_| AppError::Unauthorized)?;
            if crate::db::is_user_disabled(&state.db, creator_id).await? {
                return Err(AppError::BadRequest("account disabled".into()));
            }

            return Ok(AuthUser {
                id: creator_id,
                bot: Some(BotContext {
                    id: Uuid::parse_str(&row.id).map_err(|_| AppError::Unauthorized)?,
                    server_id: Uuid::parse_str(&row.server_id)
                        .map_err(|_| AppError::Unauthorized)?,
                    name: row.name,
                    creator_id,
                    created_at: chrono::DateTime::parse_from_rfc3339(&row.created_at)
                        .map(|d| d.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                }),
            });
        }

        Err(AppError::Unauthorized)
    }
}

pub fn hash_password(password: &str) -> AppResult<String> {
    use argon2::{
        password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
        Argon2,
    };
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?
        .to_string();
    Ok(hash)
}

pub fn verify_password(password: &str, hash: &str) -> AppResult<bool> {
    use argon2::{
        password_hash::{PasswordHash, PasswordVerifier},
        Argon2,
    };
    let parsed = PasswordHash::new(hash).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

pub fn issue_access_token(user_id: Uuid, secret: &str) -> AppResult<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        iat: now.timestamp(),
        exp: (now + Duration::hours(12)).timestamp(),
        typ: "access".into(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(e.into()))
}

pub fn issue_refresh_token_value() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Clone)]
pub struct AuthBot {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub creator_id: Uuid,
    pub created_at: chrono::DateTime<Utc>,
}

impl From<&BotContext> for AuthBot {
    fn from(bot: &BotContext) -> Self {
        AuthBot {
            id: bot.id,
            server_id: bot.server_id,
            name: bot.name.clone(),
            creator_id: bot.creator_id,
            created_at: bot.created_at,
        }
    }
}

impl FromRequestParts<AppState> for AuthBot {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        let bot = user.bot.ok_or(AppError::Unauthorized)?;
        Ok(AuthBot::from(&bot))
    }
}

pub fn decode_token(token: &str, secret: &str) -> AppResult<Claims> {
    let mut validation = Validation::new(jsonwebtoken::Algorithm::HS256);
    validation.validate_exp = true;
    validation.algorithms = vec![jsonwebtoken::Algorithm::HS256];
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map(|d| d.claims)
    .map_err(|_| AppError::Unauthorized)
}
