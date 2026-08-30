use crate::auth::{hash_token, AuthBot, AuthUser};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use speakapp_shared::{Permissions, ServerBot, ServerBotCreated};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct CreateBotReq {
    pub name: String,
}

fn parse_dt(s: &str) -> chrono::DateTime<Utc> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn map_bot_row(
    id: String,
    server_id: String,
    name: String,
    creator_id: String,
    created_at: String,
) -> ServerBot {
    ServerBot {
        id: Uuid::parse_str(&id).unwrap(),
        server_id: Uuid::parse_str(&server_id).unwrap(),
        name,
        creator_id: Uuid::parse_str(&creator_id).unwrap(),
        created_at: parse_dt(&created_at),
    }
}

fn generate_bot_token() -> String {
    format!("bot_{}", crate::auth::issue_refresh_token_value())
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<Vec<ServerBot>>> {
    user.ensure_human()?;
    if !db::is_member(&state.db, server_id, user.id).await? {
        return Err(AppError::Forbidden);
    }
    let server = db::get_server(&state.db, server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::MANAGE_SERVER,
    )
    .await?;

    #[derive(sqlx::FromRow)]
    struct Row {
        id: String,
        server_id: String,
        name: String,
        creator_id: String,
        created_at: String,
    }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT id, server_id, name, creator_id, created_at FROM server_bots WHERE server_id = ? ORDER BY created_at",
    )
    .bind(server_id.to_string())
    .fetch_all(&state.db)
    .await?;

    Ok(Json(
        rows.into_iter()
            .map(|r| {
                map_bot_row(
                    r.id,
                    r.server_id,
                    r.name,
                    r.creator_id,
                    r.created_at,
                )
            })
            .collect(),
    ))
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateBotReq>,
) -> AppResult<Json<ServerBotCreated>> {
    user.ensure_human()?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name required".into()));
    }
    let server = db::get_server(&state.db, server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::MANAGE_SERVER,
    )
    .await?;

    let id = Uuid::new_v4();
    let token = generate_bot_token();
    let token_hash = hash_token(&token);
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO server_bots (id, server_id, name, token_hash, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(server_id.to_string())
    .bind(name)
    .bind(&token_hash)
    .bind(user.id.to_string())
    .bind(&now)
    .execute(&state.db)
    .await?;

    let bot = map_bot_row(
        id.to_string(),
        server_id.to_string(),
        name.to_string(),
        user.id.to_string(),
        now,
    );

    Ok(Json(ServerBotCreated { bot, token }))
}

pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    user.ensure_human()?;
    #[derive(sqlx::FromRow)]
    struct Row {
        server_id: String,
    }

    let row = sqlx::query_as::<_, Row>("SELECT server_id FROM server_bots WHERE id = ?")
        .bind(id.to_string())
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;

    let server_id = Uuid::parse_str(&row.server_id).unwrap();
    let server = db::get_server(&state.db, server_id).await?;
    db::require_perm(
        &state.db,
        &server,
        None,
        user.id,
        Permissions::MANAGE_SERVER,
    )
    .await?;

    sqlx::query("DELETE FROM server_bots WHERE id = ?")
        .bind(id.to_string())
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn me(bot: AuthBot) -> AppResult<Json<ServerBot>> {
    Ok(Json(ServerBot {
        id: bot.id,
        server_id: bot.server_id,
        name: bot.name,
        creator_id: bot.creator_id,
        created_at: bot.created_at,
    }))
}
