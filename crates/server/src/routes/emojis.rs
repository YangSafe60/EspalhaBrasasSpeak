use crate::auth::AuthUser;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use speakapp_shared::{Permissions, ServerEmoji};
use uuid::Uuid;

const MAX_EMOJIS_PER_SERVER: i64 = 50;

fn parse_dt(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn normalize_name(raw: &str) -> AppResult<String> {
    let name = raw.trim().to_lowercase();
    if name.len() < 2 || name.len() > 32 {
        return Err(AppError::BadRequest(
            "emoji name must be 2–32 characters".into(),
        ));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    {
        return Err(AppError::BadRequest(
            "emoji name may only use a-z, 0-9, and _".into(),
        ));
    }
    Ok(name)
}

fn row_to_emoji(
    id: String,
    server_id: String,
    name: String,
    image_url: String,
    animated: i64,
    creator_id: String,
    created_at: String,
) -> ServerEmoji {
    ServerEmoji {
        id: Uuid::parse_str(&id).unwrap(),
        server_id: Uuid::parse_str(&server_id).unwrap(),
        name,
        image_url,
        animated: animated != 0,
        creator_id: Uuid::parse_str(&creator_id).unwrap(),
        created_at: parse_dt(&created_at),
    }
}

async fn fetch_emoji(db: &sqlx::SqlitePool, id: Uuid) -> AppResult<ServerEmoji> {
    let row = sqlx::query_as::<_, (String, String, String, String, i64, String, String)>(
        r#"SELECT id, server_id, name, image_url, animated, creator_id, created_at
           FROM server_emojis WHERE id = ?"#,
    )
    .bind(id.to_string())
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(row_to_emoji(
        row.0, row.1, row.2, row.3, row.4, row.5, row.6,
    ))
}

pub async fn list_server_emojis(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<ServerEmoji>>> {
    user.bot_server_scope(id)?;
    if !db::is_member(&state.db, id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    let rows = sqlx::query_as::<_, (String, String, String, String, i64, String, String)>(
        r#"SELECT id, server_id, name, image_url, animated, creator_id, created_at
           FROM server_emojis WHERE server_id = ? ORDER BY lower(name)"#,
    )
    .bind(id.to_string())
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| row_to_emoji(r.0, r.1, r.2, r.3, r.4, r.5, r.6))
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct CreateEmojiReq {
    pub name: String,
    pub image_url: String,
    #[serde(default)]
    pub animated: Option<bool>,
}

pub async fn create_server_emoji(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateEmojiReq>,
) -> AppResult<Json<ServerEmoji>> {
    user.bot_server_scope(id)?;
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::MANAGE_EXPRESSIONS,
    )
    .await?;
    let name = normalize_name(&body.name)?;
    let image_url = body.image_url.trim().to_string();
    if image_url.is_empty() || image_url.len() > 2048 {
        return Err(AppError::BadRequest("invalid image url".into()));
    }
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(1) FROM server_emojis WHERE server_id = ?")
            .bind(id.to_string())
            .fetch_one(&state.db)
            .await?;
    if count >= MAX_EMOJIS_PER_SERVER {
        return Err(AppError::BadRequest(format!(
            "server emoji limit reached ({MAX_EMOJIS_PER_SERVER})"
        )));
    }
    let animated = body.animated.unwrap_or_else(|| {
        let lower = image_url.to_lowercase();
        lower.contains(".gif") || lower.contains("image/gif")
    });
    let emoji_id = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        r#"INSERT INTO server_emojis (id, server_id, name, image_url, animated, creator_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(emoji_id.to_string())
    .bind(id.to_string())
    .bind(&name)
    .bind(&image_url)
    .bind(if animated { 1 } else { 0 })
    .bind(user.id.to_string())
    .bind(&now)
    .execute(&state.db)
    .await;

    if let Err(sqlx::Error::Database(e)) = &res {
        if e.is_unique_violation() {
            return Err(AppError::Conflict(format!(
                "emoji :{name}: already exists on this server"
            )));
        }
    }
    res?;
    Ok(Json(fetch_emoji(&state.db, emoji_id).await?))
}

#[derive(Deserialize)]
pub struct RenameEmojiReq {
    pub name: String,
}

pub async fn rename_server_emoji(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, emoji_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<RenameEmojiReq>,
) -> AppResult<Json<ServerEmoji>> {
    user.bot_server_scope(id)?;
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::MANAGE_EXPRESSIONS,
    )
    .await?;
    let existing = fetch_emoji(&state.db, emoji_id).await?;
    if existing.server_id != id {
        return Err(AppError::NotFound);
    }
    let name = normalize_name(&body.name)?;
    let res = sqlx::query("UPDATE server_emojis SET name = ? WHERE id = ? AND server_id = ?")
        .bind(&name)
        .bind(emoji_id.to_string())
        .bind(id.to_string())
        .execute(&state.db)
        .await;
    if let Err(sqlx::Error::Database(e)) = &res {
        if e.is_unique_violation() {
            return Err(AppError::Conflict(format!(
                "emoji :{name}: already exists on this server"
            )));
        }
    }
    res?;
    Ok(Json(fetch_emoji(&state.db, emoji_id).await?))
}

pub async fn delete_server_emoji(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, emoji_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    user.bot_server_scope(id)?;
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::MANAGE_EXPRESSIONS,
    )
    .await?;
    let res = sqlx::query("DELETE FROM server_emojis WHERE id = ? AND server_id = ?")
        .bind(emoji_id.to_string())
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// All custom emojis from servers the user is a member of (for the picker / cross-server use).
pub async fn list_my_emojis(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Vec<ServerEmoji>>> {
    let rows = sqlx::query_as::<_, (String, String, String, String, i64, String, String)>(
        r#"SELECT e.id, e.server_id, e.name, e.image_url, e.animated, e.creator_id, e.created_at
           FROM server_emojis e
           INNER JOIN members m ON m.server_id = e.server_id AND m.user_id = ?
           ORDER BY e.server_id, lower(e.name)"#,
    )
    .bind(user.id.to_string())
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| row_to_emoji(r.0, r.1, r.2, r.3, r.4, r.5, r.6))
            .collect(),
    ))
}

/// Resolve any emoji by id so message recipients can render it.
pub async fn get_emoji(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(emoji_id): Path<Uuid>,
) -> AppResult<Json<ServerEmoji>> {
    Ok(Json(fetch_emoji(&state.db, emoji_id).await?))
}
