use crate::auth::{
    hash_password, hash_token, issue_access_token, issue_refresh_token_value, verify_password,
    AuthUser,
};
use crate::db;
use crate::ratelimit::{self, ClientIp};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
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
    /// "About me" (up to 190 characters; empty = clear).
    pub bio: Option<String>,
    /// Profile colour "#rrggbb" (empty = default).
    pub accent_color: Option<String>,
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

pub const MAX_DISPLAY_NAME: usize = 32;
pub const MAX_EMAIL: usize = 254;

/// 2-32 ASCII letters, digits, `_`, `.` or `-`.
pub fn validate_username(raw: &str) -> AppResult<String> {
    let username = raw.trim();
    if username.len() < 2 || username.len() > 32 {
        return Err(AppError::BadRequest("username must be 2-32 characters".into()));
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
    {
        return Err(AppError::BadRequest(
            "username may only contain letters, numbers, _, . and -".into(),
        ));
    }
    Ok(username.to_string())
}

/// 1-32 characters, no control characters.
pub fn validate_display_name(raw: &str) -> AppResult<String> {
    let name = raw.trim();
    let len = name.chars().count();
    if len == 0 || len > MAX_DISPLAY_NAME {
        return Err(AppError::BadRequest(format!(
            "display name must be 1-{MAX_DISPLAY_NAME} characters"
        )));
    }
    if name.chars().any(char::is_control) {
        return Err(AppError::BadRequest(
            "display name must not contain control characters".into(),
        ));
    }
    Ok(name.to_string())
}

/// Pragmatic `local@domain.tld` check (not full RFC 5322), max 254 chars.
/// Returns the trimmed, lower-cased address.
pub fn validate_email(raw: &str) -> AppResult<String> {
    let invalid = || AppError::BadRequest("invalid email".into());
    let email = raw.trim().to_lowercase();
    if email.is_empty() || email.len() > MAX_EMAIL {
        return Err(invalid());
    }
    let (local, domain) = email.split_once('@').ok_or_else(invalid)?;
    if local.is_empty()
        || local.len() > 64
        || local.starts_with('.')
        || local.ends_with('.')
        || local.contains("..")
        || !local
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "!#$%&'*+/=?^_`{|}~.-".contains(c))
    {
        return Err(invalid());
    }
    let labels: Vec<&str> = domain.split('.').collect();
    if labels.len() < 2 {
        return Err(invalid());
    }
    for label in &labels {
        if label.is_empty()
            || label.len() > 63
            || label.starts_with('-')
            || label.ends_with('-')
            || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err(invalid());
        }
    }
    if labels.last().is_some_and(|tld| tld.len() < 2) {
        return Err(invalid());
    }
    Ok(email)
}

pub async fn register(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(body): Json<RegisterReq>,
) -> AppResult<Json<AuthResponse>> {
    let username = validate_username(&body.username)?;
    let email = validate_email(&body.email)?;
    let display = validate_display_name(body.display_name.as_deref().unwrap_or(&username))?;
    if body.password.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }
    let id = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();
    // Counted only once the request is well-formed, so typos don't burn the quota.
    state.limits.check(ratelimit::REGISTER, &ip.to_string())?;
    let hash = hash_password(&body.password)?;

    let res = sqlx::query(
        "INSERT INTO users (id, username, display_name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(&username)
    .bind(&display)
    .bind(&email)
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

/// Argon2 hash of a random password, used to equalise login timing.
fn dummy_password_hash() -> &'static str {
    static HASH: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    HASH.get_or_init(|| {
        hash_password(&crate::auth::issue_refresh_token_value())
            .unwrap_or_else(|_| String::new())
    })
}

pub async fn login(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(body): Json<LoginReq>,
) -> AppResult<Json<AuthResponse>> {
    state.limits.check(ratelimit::LOGIN, &ip.to_string())?;
    #[derive(sqlx::FromRow)]
    struct Row {
        id: String,
        password_hash: String,
    }
    let row = sqlx::query_as::<_, Row>(
        // `username` and `email` are COLLATE NOCASE, so this is case-insensitive
        // and still uses their unique indexes.
        "SELECT id, password_hash FROM users WHERE username = ? OR email = ?",
    )
    .bind(body.login.trim())
    .bind(body.login.trim())
    .fetch_optional(&state.db)
    .await?;

    // Unknown account: still run Argon2 against a dummy hash, so the response
    // time doesn't reveal which usernames/emails exist.
    let (row, hash) = match row {
        Some(r) => {
            let h = r.password_hash.clone();
            (Some(r), h)
        }
        None => (None, dummy_password_hash().to_string()),
    };
    let password = body.password.clone();
    // Argon2 is deliberately slow; keep it off the async worker threads.
    let ok = tokio::task::spawn_blocking(move || verify_password(&password, &hash))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))??;
    let row = match row {
        Some(r) if ok => r,
        _ => return Err(AppError::Unauthorized),
    };
    let id = Uuid::parse_str(&row.id).unwrap();
    if db::is_user_disabled(&state.db, id).await? {
        return Err(AppError::BadRequest("account disabled".into()));
    }
    issue_pair(&state, id).await
}

pub async fn refresh(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(body): Json<RefreshReq>,
) -> AppResult<Json<AuthResponse>> {
    state.limits.check(ratelimit::REFRESH, &ip.to_string())?;
    let th = hash_token(&body.refresh_token);
    #[derive(sqlx::FromRow)]
    struct Row {
        id: String,
        user_id: String,
        expires_at: String,
        family_id: Option<String>,
        used_at: Option<String>,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT id, user_id, expires_at, family_id, used_at FROM refresh_tokens WHERE token_hash = ?",
    )
    .bind(&th)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;
    let family = row.family_id.clone().unwrap_or_else(|| row.id.clone());

    let exp = chrono::DateTime::parse_from_rfc3339(&row.expires_at)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or(Utc::now());
    if exp < Utc::now() {
        return Err(AppError::Unauthorized);
    }
    // Mark it used; only one caller can win this update.
    let claimed = if row.used_at.is_none() {
        sqlx::query("UPDATE refresh_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL")
            .bind(Utc::now().to_rfc3339())
            .bind(&row.id)
            .execute(&state.db)
            .await?
            .rows_affected()
            == 1
    } else {
        false
    };
    if !claimed {
        // A rotated token came back: it was copied. End that whole login
        // (the thief's and the owner's tokens) so the copy is useless.
        tracing::warn!(user_id = %row.user_id, "refresh token reuse detected; revoking its family");
        sqlx::query("DELETE FROM refresh_tokens WHERE family_id = ? OR id = ?")
            .bind(&family)
            .bind(&row.id)
            .execute(&state.db)
            .await?;
        return Err(AppError::Unauthorized);
    }
    let user_id = Uuid::parse_str(&row.user_id).map_err(|_| AppError::Unauthorized)?;
    // Housekeeping: drop this user's expired tokens.
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = ? AND expires_at < ?")
        .bind(&row.user_id)
        .bind(Utc::now().to_rfc3339())
        .execute(&state.db)
        .await?;
    issue_pair_in(&state, user_id, Some(family)).await
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
        let name = validate_display_name(&name)?;
        sqlx::query("UPDATE users SET display_name = ? WHERE id = ?")
            .bind(name)
            .bind(user.id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(email) = body.email {
        let email = validate_email(&email)?;
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
    if let Some(bio) = body.bio {
        let bio = bio.trim();
        if bio.chars().count() > 190 {
            return Err(AppError::BadRequest("About me can be up to 190 characters".into()));
        }
        sqlx::query("UPDATE users SET bio = ? WHERE id = ?")
            .bind(if bio.is_empty() { None } else { Some(bio) })
            .bind(user.id.to_string())
            .execute(&state.db)
            .await?;
    }
    if let Some(color) = body.accent_color {
        let color = color.trim();
        let ok = color.is_empty()
            || (color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit()));
        if !ok {
            return Err(AppError::BadRequest("invalid colour".into()));
        }
        sqlx::query("UPDATE users SET accent_color = ? WHERE id = ?")
            .bind(if color.is_empty() { None } else { Some(color.to_lowercase()) })
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
    issue_pair_in(state, user_id, None).await
}

/// `family`: the login this refresh belongs to (None = a new login).
async fn issue_pair_in(
    state: &AppState,
    user_id: Uuid,
    family: Option<String>,
) -> AppResult<Json<AuthResponse>> {
    let access = issue_access_token(user_id, &state.config.jwt_secret)?;
    let refresh = issue_refresh_token_value();
    let th = hash_token(&refresh);
    let now = Utc::now();
    let id = Uuid::new_v4().to_string();
    let family = family.unwrap_or_else(|| id.clone());
    sqlx::query(
        "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at, family_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(user_id.to_string())
    .bind(th)
    .bind((now + Duration::days(30)).to_rfc3339())
    .bind(now.to_rfc3339())
    .bind(family)
    .execute(&state.db)
    .await?;

    Ok(Json(AuthResponse {
        access_token: access,
        refresh_token: refresh,
        user: db::user_public(&state.db, user_id).await?,
    }))
}


/// Someone's "About me" and profile colour (any signed-in user).
pub async fn profile(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<db::UserProfile>> {
    Ok(Json(db::user_profile(&state.db, id).await?))
}
