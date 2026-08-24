use crate::auth::{
    hash_password, hash_token, issue_access_token, issue_refresh_token_value, verify_password,
    AuthUser,
};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{extract::State, Json};
use chrono::{Duration, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct RegisterReq {
    pub username: String,
    pub display_name: Option<String>,
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginReq {
    pub login: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct RefreshReq {
    pub refresh_token: String,
}

#[derive(Deserialize)]
pub struct UpdateMeReq {
    pub display_name: Option<String>,
    pub email: Option<String>,
    /// Absent = leave unchanged; JSON `null` = clear; string = set.
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub avatar_url: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub banner_url: Option<Option<String>>,
}

#[derive(Deserialize)]
pub struct PasswordChangeReq {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Deserialize)]
pub struct PasswordConfirmReq {
    pub password: String,
}

fn deserialize_optional_string<'de, D>(deserializer: D) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Some(Option::<String>::deserialize(deserializer)?))
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: speakapp_shared::UserPublic,
}

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterReq>,
) -> AppResult<Json<AuthResponse>> {
    let username = body.username.trim().to_string();
    if username.len() < 2 || username.len() > 32 {
        return Err(AppError::BadRequest("username must be 2-32 chars".into()));
    }
    if body.password.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }
    let id = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();
    let display = body
        .display_name
        .unwrap_or_else(|| username.clone())
        .trim()
        .to_string();
    let hash = hash_password(&body.password)?;

    let res = sqlx::query(
        "INSERT INTO users (id, username, display_name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(&username)
    .bind(&display)
    .bind(body.email.trim())
    .bind(&hash)
    .bind(&now)
    .execute(&state.db)
    .await;

    if let Err(sqlx::Error::Database(e)) = &res {
        if e.is_unique_violation() {
            return Err(AppError::Conflict("username or email taken".into()));
        }
    }
    res?;

    issue_pair(&state, id).await
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginReq>,
) -> AppResult<Json<AuthResponse>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: String,
        password_hash: String,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT id, password_hash FROM users WHERE username = ? OR email = ?",
    )
    .bind(body.login.trim())
    .bind(body.login.trim())
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    if !verify_password(&body.password, &row.password_hash)? {
        return Err(AppError::Unauthorized);
    }
    let id = Uuid::parse_str(&row.id).unwrap();
    if db::is_user_disabled(&state.db, id).await? {
        return Err(AppError::BadRequest("account disabled".into()));
    }
    issue_pair(&state, id).await
}

pub async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<RefreshReq>,
) -> AppResult<Json<AuthResponse>> {
    let th = hash_token(&body.refresh_token);
    #[derive(sqlx::FromRow)]
    struct Row {
        id: String,
        user_id: String,
        expires_at: String,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT id, user_id, expires_at FROM refresh_tokens WHERE token_hash = ?",
    )
    .bind(&th)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let exp = chrono::DateTime::parse_from_rfc3339(&row.expires_at)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or(Utc::now());
    if exp < Utc::now() {
        return Err(AppError::Unauthorized);
    }
    sqlx::query("DELETE FROM refresh_tokens WHERE id = ?")
        .bind(&row.id)
        .execute(&state.db)
        .await?;
    let user_id = Uuid::parse_str(&row.user_id).unwrap();
    issue_pair(&state, user_id).await
}

pub async fn me(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<db::UserMe>> {
    Ok(Json(db::user_me(&state.db, user.id).await?))
}

pub async fn update_me(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<UpdateMeReq>,
) -> AppResult<Json<db::UserMe>> {
    if let Some(name) = body.display_name {
        let name = name.trim();
        if name.is_empty() || name.len() > 64 {
            return Err(AppError::BadRequest(
                "display name must be 1-64 characters".into(),
            ));
        }
        sqlx::query("UPDATE users SET display_name = ? WHERE id = ?")
            .bind(name)
            .bind(user.id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(email) = body.email {
        let email = email.trim().to_lowercase();
        if !email.contains('@') || email.len() > 254 {
            return Err(AppError::BadRequest("invalid email".into()));
        }
        let res = sqlx::query("UPDATE users SET email = ? WHERE id = ?")
            .bind(&email)
            .bind(user.id.to_string())
            .execute(&state.db)
            .await;
        if let Err(sqlx::Error::Database(e)) = &res {
            if e.is_unique_violation() {
                return Err(AppError::Conflict("email already in use".into()));
            }
        }
        res?;
    }
    if let Some(avatar) = body.avatar_url {
        if let Some(ref url) = avatar {
            if !is_safe_profile_url(url) {
                return Err(AppError::BadRequest("invalid avatar url".into()));
            }
        }
        sqlx::query("UPDATE users SET avatar_url = ? WHERE id = ?")
            .bind(avatar)
            .bind(user.id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(banner) = body.banner_url {
        if let Some(ref url) = banner {
            if !is_safe_profile_url(url) {
                return Err(AppError::BadRequest("invalid banner url".into()));
            }
        }
        sqlx::query("UPDATE users SET banner_url = ? WHERE id = ?")
            .bind(banner)
            .bind(user.id.to_string())
            .execute(&state.db)
            .await?;
    }
    match db::user_me(&state.db, user.id).await {
        Ok(u) => Ok(Json(u)),
        Err(AppError::NotFound) => Err(AppError::Unauthorized),
        Err(e) => Err(e),
    }
}

async fn verify_current_password(
    state: &AppState,
    user_id: Uuid,
    password: &str,
) -> AppResult<()> {
    let hash = db::user_password_hash(&state.db, user_id).await?;
    if !verify_password(password, &hash)? {
        return Err(AppError::Unauthorized);
    }
    Ok(())
}

pub async fn change_password(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<PasswordChangeReq>,
) -> AppResult<Json<serde_json::Value>> {
    if body.new_password.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }
    verify_current_password(&state, user.id, &body.current_password).await?;
    let hash = hash_password(&body.new_password)?;
    sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(&hash)
        .bind(user.id.to_string())
        .execute(&state.db)
        .await?;
    db::revoke_refresh_tokens(&state.db, user.id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn disable_account(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<PasswordConfirmReq>,
) -> AppResult<Json<serde_json::Value>> {
    verify_current_password(&state, user.id, &body.password).await?;
    db::disable_user(&state.db, user.id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_account(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<PasswordConfirmReq>,
) -> AppResult<Json<serde_json::Value>> {
    verify_current_password(&state, user.id, &body.password).await?;
    db::delete_user_account(&state.db, user.id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn is_safe_profile_url(raw: &str) -> bool {
    let raw = raw.trim();
    if raw.len() > 2048 || raw.contains('\0') {
        return false;
    }
    // Reject javascript:, data:, file:, etc. Allow http(s) only.
    let lower = raw.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return false;
    }
    // No credentials in URL (user:pass@host).
    if let Some(rest) = raw.split("://").nth(1) {
        let authority = rest.split('/').next().unwrap_or("");
        if authority.contains('@') {
            return false;
        }
    }
    true
}

async fn issue_pair(state: &AppState, user_id: Uuid) -> AppResult<Json<AuthResponse>> {
    let access = issue_access_token(user_id, &state.config.jwt_secret)?;
    let refresh = issue_refresh_token_value();
    let th = hash_token(&refresh);
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(user_id.to_string())
    .bind(th)
    .bind((now + Duration::days(30)).to_rfc3339())
    .bind(now.to_rfc3339())
    .execute(&state.db)
    .await?;

    Ok(Json(AuthResponse {
        access_token: access,
        refresh_token: refresh,
        user: db::user_public(&state.db, user_id).await?,
    }))
}
