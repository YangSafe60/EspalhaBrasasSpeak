use crate::auth::AuthUser;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::routes::friends::{ensure_dm_with_peer, is_blocked, load_dm_for_user};
use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use speakapp_shared::{DmChannel, DmMessage, WsEvent};
use uuid::Uuid;

fn parse_dt(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

async fn require_participant(
    db: &sqlx::SqlitePool,
    dm_id: Uuid,
    user_id: Uuid,
) -> AppResult<()> {
    let ok: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM dm_participants WHERE dm_channel_id = ? AND user_id = ?",
    )
    .bind(dm_id.to_string())
    .bind(user_id.to_string())
    .fetch_optional(db)
    .await?;
    if ok.is_none() {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

async fn peer_of_dm(
    db: &sqlx::SqlitePool,
    dm_id: Uuid,
    viewer: Uuid,
) -> AppResult<Uuid> {
    let _: String = sqlx::query_scalar("SELECT id FROM dm_channels WHERE id = ?")
        .bind(dm_id.to_string())
        .fetch_optional(db)
        .await?
        .ok_or(AppError::NotFound)?;
    let peer_id: String = sqlx::query_scalar(
        "SELECT user_id FROM dm_participants WHERE dm_channel_id = ? AND user_id != ?",
    )
    .bind(dm_id.to_string())
    .bind(viewer.to_string())
    .fetch_one(db)
    .await?;
    Ok(Uuid::parse_str(&peer_id).unwrap())
}

async fn require_can_message_peer(db: &sqlx::SqlitePool, a: Uuid, b: Uuid) -> AppResult<()> {
    if is_blocked(db, a, b).await? {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

async fn dm_participant_ids(db: &sqlx::SqlitePool, dm_id: Uuid) -> AppResult<Vec<Uuid>> {
    let rows: Vec<String> =
        sqlx::query_scalar("SELECT user_id FROM dm_participants WHERE dm_channel_id = ?")
            .bind(dm_id.to_string())
            .fetch_all(db)
            .await?;
    Ok(rows
        .into_iter()
        .filter_map(|s| Uuid::parse_str(&s).ok())
        .collect())
}

fn row_to_message(
    id: String,
    dm_channel_id: String,
    author_id: String,
    ciphertext: String,
    nonce: String,
    reply_to_id: Option<String>,
    edited_at: Option<String>,
    created_at: String,
) -> DmMessage {
    DmMessage {
        id: Uuid::parse_str(&id).unwrap(),
        dm_channel_id: Uuid::parse_str(&dm_channel_id).unwrap(),
        author_id: Uuid::parse_str(&author_id).unwrap(),
        ciphertext,
        nonce,
        reply_to_id: reply_to_id.and_then(|s| Uuid::parse_str(&s).ok()),
        edited_at: edited_at.map(|s| parse_dt(&s)),
        created_at: parse_dt(&created_at),
    }
}

async fn load_dm_message(db: &sqlx::SqlitePool, id: Uuid) -> AppResult<DmMessage> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: String,
        dm_channel_id: String,
        author_id: String,
        ciphertext: String,
        nonce: String,
        reply_to_id: Option<String>,
        edited_at: Option<String>,
        created_at: String,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT id, dm_channel_id, author_id, ciphertext, nonce, reply_to_id, edited_at, created_at FROM dm_messages WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(row_to_message(
        row.id,
        row.dm_channel_id,
        row.author_id,
        row.ciphertext,
        row.nonce,
        row.reply_to_id,
        row.edited_at,
        row.created_at,
    ))
}

pub async fn list_dms(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Vec<DmChannel>>> {
    let ids: Vec<String> = sqlx::query_scalar(
        r#"SELECT d.id FROM dm_channels d
           INNER JOIN dm_participants p ON p.dm_channel_id = d.id
           WHERE p.user_id = ? AND COALESCE(p.hidden, 0) = 0
           ORDER BY d.created_at DESC"#,
    )
    .bind(user.id.to_string())
    .fetch_all(&state.db)
    .await?;

    let mut out = Vec::new();
    for id in ids {
        out.push(load_dm_for_user(&state, Uuid::parse_str(&id).unwrap(), user.id).await?);
    }
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
}

pub async fn list_messages(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Vec<DmMessage>>> {
    require_participant(&state.db, id, user.id).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 100);

    #[derive(sqlx::FromRow)]
    struct Row {
        id: String,
        dm_channel_id: String,
        author_id: String,
        ciphertext: String,
        nonce: String,
        reply_to_id: Option<String>,
        edited_at: Option<String>,
        created_at: String,
    }

    let rows = if let Some(before) = q.before {
        let before_created: String =
            sqlx::query_scalar("SELECT created_at FROM dm_messages WHERE id = ?")
                .bind(before.to_string())
                .fetch_optional(&state.db)
                .await?
                .ok_or(AppError::BadRequest("invalid before cursor".into()))?;
        sqlx::query_as::<_, Row>(
            r#"SELECT id, dm_channel_id, author_id, ciphertext, nonce, reply_to_id, edited_at, created_at
               FROM dm_messages
               WHERE dm_channel_id = ? AND created_at < ?
               ORDER BY created_at DESC
               LIMIT ?"#,
        )
        .bind(id.to_string())
        .bind(before_created)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, Row>(
            r#"SELECT id, dm_channel_id, author_id, ciphertext, nonce, reply_to_id, edited_at, created_at
               FROM dm_messages
               WHERE dm_channel_id = ?
               ORDER BY created_at DESC
               LIMIT ?"#,
        )
        .bind(id.to_string())
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    let mut msgs: Vec<DmMessage> = rows
        .into_iter()
        .map(|r| {
            row_to_message(
                r.id,
                r.dm_channel_id,
                r.author_id,
                r.ciphertext,
                r.nonce,
                r.reply_to_id,
                r.edited_at,
                r.created_at,
            )
        })
        .collect();
    msgs.reverse();
    Ok(Json(msgs))
}

#[derive(Deserialize)]
pub struct CreateDmMessageReq {
    pub ciphertext: String,
    pub nonce: String,
    pub reply_to_id: Option<Uuid>,
}

pub async fn create_message(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateDmMessageReq>,
) -> AppResult<Json<DmMessage>> {
    require_participant(&state.db, id, user.id).await?;
    let peer = peer_of_dm(&state.db, id, user.id).await?;
    if is_blocked(&state.db, user.id, peer).await? {
        return Err(AppError::Forbidden);
    }
    require_can_message_peer(&state.db, user.id, peer).await?;

    let ct = body.ciphertext.trim();
    let nonce = body.nonce.trim();
    if ct.is_empty() || nonce.is_empty() {
        return Err(AppError::BadRequest("ciphertext and nonce required".into()));
    }
    if ct.len() > 64_000 || nonce.len() > 128 {
        return Err(AppError::BadRequest("payload too large".into()));
    }

    let msg_id = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO dm_messages (id, dm_channel_id, author_id, ciphertext, nonce, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(msg_id.to_string())
    .bind(id.to_string())
    .bind(user.id.to_string())
    .bind(ct)
    .bind(nonce)
    .bind(body.reply_to_id.map(|r| r.to_string()))
    .bind(&now)
    .execute(&state.db)
    .await?;

    // Re-open for both sides so a closed DM reappears when someone writes.
    sqlx::query("UPDATE dm_participants SET hidden = 0 WHERE dm_channel_id = ?")
        .bind(id.to_string())
        .execute(&state.db)
        .await?;

    let message = load_dm_message(&state.db, msg_id).await?;
    let author = db::user_public(&state.db, user.id).await?;
    let participants = dm_participant_ids(&state.db, id).await?;
    let channel_for_peer = load_dm_for_user(&state, id, peer).await?;
    state.hub.send_to_user(
        peer,
        &WsEvent::DmChannelCreate {
            channel: channel_for_peer,
        },
    );
    state.hub.broadcast_users(
        &participants,
        &WsEvent::DmMessageCreate {
            message: message.clone(),
            author,
        },
    );
    Ok(Json(message))
}

pub async fn close_dm(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<()>> {
    require_participant(&state.db, id, user.id).await?;
    sqlx::query(
        "UPDATE dm_participants SET hidden = 1 WHERE dm_channel_id = ? AND user_id = ?",
    )
    .bind(id.to_string())
    .bind(user.id.to_string())
    .execute(&state.db)
    .await?;
    Ok(Json(()))
}

pub async fn open_dm(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DmChannel>> {
    require_participant(&state.db, id, user.id).await?;
    sqlx::query(
        "UPDATE dm_participants SET hidden = 0 WHERE dm_channel_id = ? AND user_id = ?",
    )
    .bind(id.to_string())
    .bind(user.id.to_string())
    .execute(&state.db)
    .await?;
    load_dm_for_user(&state, id, user.id).await.map(Json)
}

pub async fn open_dm_by_peer(
    State(state): State<AppState>,
    user: AuthUser,
    Path(peer_id): Path<Uuid>,
) -> AppResult<Json<DmChannel>> {
    let channel = ensure_dm_with_peer(&state, user.id, peer_id).await?;
    sqlx::query(
        "UPDATE dm_participants SET hidden = 0 WHERE dm_channel_id = ? AND user_id = ?",
    )
    .bind(channel.id.to_string())
    .bind(user.id.to_string())
    .execute(&state.db)
    .await?;
    load_dm_for_user(&state, channel.id, user.id).await.map(Json)
}

pub async fn open_dm_by_friendship(
    State(state): State<AppState>,
    user: AuthUser,
    Path(friendship_id): Path<Uuid>,
) -> AppResult<Json<DmChannel>> {
    let dm_id: String = sqlx::query_scalar(
        r#"SELECT d.id FROM dm_channels d
           INNER JOIN dm_participants p ON p.dm_channel_id = d.id
           WHERE d.friendship_id = ? AND p.user_id = ?"#,
    )
    .bind(friendship_id.to_string())
    .bind(user.id.to_string())
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    let id = Uuid::parse_str(&dm_id).unwrap();
    sqlx::query(
        "UPDATE dm_participants SET hidden = 0 WHERE dm_channel_id = ? AND user_id = ?",
    )
    .bind(id.to_string())
    .bind(user.id.to_string())
    .execute(&state.db)
    .await?;
    load_dm_for_user(&state, id, user.id).await.map(Json)
}

#[derive(Deserialize)]
pub struct UpdateDmMessageReq {
    pub ciphertext: String,
    pub nonce: String,
}

pub async fn update_message(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateDmMessageReq>,
) -> AppResult<Json<DmMessage>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        author_id: String,
        dm_channel_id: String,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT author_id, dm_channel_id FROM dm_messages WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    let author_id = Uuid::parse_str(&row.author_id).unwrap();
    let dm_id = Uuid::parse_str(&row.dm_channel_id).unwrap();
    if author_id != user.id {
        return Err(AppError::Forbidden);
    }
    require_participant(&state.db, dm_id, user.id).await?;
    let peer = peer_of_dm(&state.db, dm_id, user.id).await?;
    require_can_message_peer(&state.db, user.id, peer).await?;

    let ct = body.ciphertext.trim();
    let nonce = body.nonce.trim();
    if ct.is_empty() || nonce.is_empty() {
        return Err(AppError::BadRequest("ciphertext and nonce required".into()));
    }

    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE dm_messages SET ciphertext = ?, nonce = ?, edited_at = ? WHERE id = ?",
    )
    .bind(ct)
    .bind(nonce)
    .bind(&now)
    .bind(id.to_string())
    .execute(&state.db)
    .await?;

    let message = load_dm_message(&state.db, id).await?;
    let participants = dm_participant_ids(&state.db, dm_id).await?;
    state
        .hub
        .broadcast_users(&participants, &WsEvent::DmMessageUpdate { message: message.clone() });
    Ok(Json(message))
}

pub async fn delete_message(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<()>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        author_id: String,
        dm_channel_id: String,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT author_id, dm_channel_id FROM dm_messages WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    let author_id = Uuid::parse_str(&row.author_id).unwrap();
    let dm_id = Uuid::parse_str(&row.dm_channel_id).unwrap();
    if author_id != user.id {
        return Err(AppError::Forbidden);
    }
    require_participant(&state.db, dm_id, user.id).await?;

    sqlx::query("DELETE FROM dm_messages WHERE id = ?")
        .bind(id.to_string())
        .execute(&state.db)
        .await?;

    let participants = dm_participant_ids(&state.db, dm_id).await?;
    state.hub.broadcast_users(
        &participants,
        &WsEvent::DmMessageDelete {
            dm_channel_id: dm_id,
            message_id: id,
        },
    );
    Ok(Json(()))
}

pub async fn typing(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<()>> {
    require_participant(&state.db, id, user.id).await?;
    let peer = peer_of_dm(&state.db, id, user.id).await?;
    require_can_message_peer(&state.db, user.id, peer).await?;
    let author = db::user_public(&state.db, user.id).await?;
    state.hub.send_to_user(
        peer,
        &WsEvent::DmTypingStart {
            dm_channel_id: id,
            user_id: user.id,
            username: author.username,
        },
    );
    Ok(Json(()))
}
