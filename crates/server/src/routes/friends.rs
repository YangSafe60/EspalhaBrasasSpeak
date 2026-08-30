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
use speakapp_shared::{
    DmChannel, Friendship, FriendshipStatus, FriendsList, UserIdentityKey, UserPublic, WsEvent,
};
use uuid::Uuid;

fn pair_users(a: Uuid, b: Uuid) -> (Uuid, Uuid) {
    if a.to_string() < b.to_string() {
        (a, b)
    } else {
        (b, a)
    }
}

fn parse_dt(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn parse_status(s: &str) -> FriendshipStatus {
    match s {
        "accepted" => FriendshipStatus::Accepted,
        "declined" => FriendshipStatus::Declined,
        _ => FriendshipStatus::Pending,
    }
}

#[derive(sqlx::FromRow)]
struct FriendshipRow {
    id: String,
    user_low: String,
    user_high: String,
    status: String,
    requested_by: String,
    created_at: String,
    updated_at: String,
}

async fn friendship_for_viewer(
    db: &sqlx::SqlitePool,
    row: FriendshipRow,
    viewer: Uuid,
) -> AppResult<Friendship> {
    let low = Uuid::parse_str(&row.user_low).unwrap();
    let high = Uuid::parse_str(&row.user_high).unwrap();
    let peer_id = if low == viewer { high } else { low };
    let peer = db::user_public(db, peer_id).await?;
    let muted: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM friend_mutes WHERE user_id = ? AND peer_id = ?",
    )
    .bind(viewer.to_string())
    .bind(peer_id.to_string())
    .fetch_optional(db)
    .await?;
    Ok(Friendship {
        id: Uuid::parse_str(&row.id).unwrap(),
        status: parse_status(&row.status),
        requested_by: Uuid::parse_str(&row.requested_by).unwrap(),
        peer,
        muted: muted.is_some(),
        created_at: parse_dt(&row.created_at),
        updated_at: parse_dt(&row.updated_at),
    })
}

pub async fn is_blocked(
    db: &sqlx::SqlitePool,
    a: Uuid,
    b: Uuid,
) -> AppResult<bool> {
    let hit: Option<i64> = sqlx::query_scalar(
        r#"SELECT 1 FROM user_blocks
           WHERE (blocker_id = ? AND blocked_id = ?)
              OR (blocker_id = ? AND blocked_id = ?)"#,
    )
    .bind(a.to_string())
    .bind(b.to_string())
    .bind(b.to_string())
    .bind(a.to_string())
    .fetch_optional(db)
    .await?;
    Ok(hit.is_some())
}

async fn get_friendship_row(
    db: &sqlx::SqlitePool,
    id: Uuid,
) -> AppResult<FriendshipRow> {
    sqlx::query_as::<_, FriendshipRow>(
        "SELECT id, user_low, user_high, status, requested_by, created_at, updated_at FROM friendships WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)
}

fn is_participant(row: &FriendshipRow, user_id: Uuid) -> bool {
    row.user_low == user_id.to_string() || row.user_high == user_id.to_string()
}

pub async fn are_friends(db: &sqlx::SqlitePool, a: Uuid, b: Uuid) -> AppResult<bool> {
    let (low, high) = pair_users(a, b);
    let status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM friendships WHERE user_low = ? AND user_high = ?",
    )
    .bind(low.to_string())
    .bind(high.to_string())
    .fetch_optional(db)
    .await?;
    Ok(matches!(status.as_deref(), Some("accepted")))
}

pub async fn user_by_username(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(username): Path<String>,
) -> AppResult<Json<UserPublic>> {
    let username = username.trim().trim_start_matches('@').trim();
    let row = sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>, String)>(
        "SELECT id, username, display_name, avatar_url, banner_url, created_at FROM users WHERE lower(username) = lower(?)",
    )
    .bind(username)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::BadRequest(format!("no user with username \"{username}\"")))?;
    Ok(Json(UserPublic {
        id: Uuid::parse_str(&row.0).unwrap(),
        username: row.1,
        display_name: row.2,
        avatar_url: row.3,
        banner_url: row.4,
        created_at: parse_dt(&row.5),
    }))
}

#[derive(Deserialize)]
pub struct PutIdentityReq {
    pub public_key: String,
}

pub async fn put_identity(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<PutIdentityReq>,
) -> AppResult<Json<UserIdentityKey>> {
    let key = body.public_key.trim();
    if key.is_empty() || key.len() > 256 {
        return Err(AppError::BadRequest("invalid public key".into()));
    }
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"INSERT INTO user_identity_keys (user_id, public_key, created_at) VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET public_key = excluded.public_key"#,
    )
    .bind(user.id.to_string())
    .bind(key)
    .bind(&now)
    .execute(&state.db)
    .await?;

    let created: String = sqlx::query_scalar(
        "SELECT created_at FROM user_identity_keys WHERE user_id = ?",
    )
    .bind(user.id.to_string())
    .fetch_one(&state.db)
    .await?;

    Ok(Json(UserIdentityKey {
        user_id: user.id,
        public_key: key.to_string(),
        created_at: parse_dt(&created),
    }))
}

pub async fn get_identity(
    State(state): State<AppState>,
    user: AuthUser,
    Path(user_id): Path<Uuid>,
) -> AppResult<Json<UserIdentityKey>> {
    if user.id != user_id {
        let friends = are_friends(&state.db, user.id, user_id).await?;
        let shared_dm: Option<i64> = sqlx::query_scalar(
            r#"SELECT 1 FROM dm_participants a
               INNER JOIN dm_participants b ON a.dm_channel_id = b.dm_channel_id
               WHERE a.user_id = ? AND b.user_id = ?
               LIMIT 1"#,
        )
        .bind(user.id.to_string())
        .bind(user_id.to_string())
        .fetch_optional(&state.db)
        .await?;
        if !friends && shared_dm.is_none() {
            return Err(AppError::Forbidden);
        }
    }
    let row = sqlx::query_as::<_, (String, String, String)>(
        "SELECT user_id, public_key, created_at FROM user_identity_keys WHERE user_id = ?",
    )
    .bind(user_id.to_string())
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(UserIdentityKey {
        user_id: Uuid::parse_str(&row.0).unwrap(),
        public_key: row.1,
        created_at: parse_dt(&row.2),
    }))
}

pub async fn list_friends(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<FriendsList>> {
    let uid = user.id.to_string();
    let rows = sqlx::query_as::<_, FriendshipRow>(
        r#"SELECT id, user_low, user_high, status, requested_by, created_at, updated_at
           FROM friendships
           WHERE (user_low = ? OR user_high = ?) AND status != 'declined'
           ORDER BY updated_at DESC"#,
    )
    .bind(&uid)
    .bind(&uid)
    .fetch_all(&state.db)
    .await?;

    let mut friends = Vec::new();
    let mut inbound = Vec::new();
    let mut outbound = Vec::new();

    for row in rows {
        let f = friendship_for_viewer(&state.db, row, user.id).await?;
        match f.status {
            FriendshipStatus::Accepted => friends.push(f),
            FriendshipStatus::Pending => {
                if f.requested_by == user.id {
                    outbound.push(f);
                } else {
                    inbound.push(f);
                }
            }
            FriendshipStatus::Declined => {}
        }
    }

    Ok(Json(FriendsList {
        friends,
        inbound,
        outbound,
    }))
}

#[derive(Deserialize)]
pub struct FriendRequestReq {
    pub username: String,
}

pub async fn request_friend(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<FriendRequestReq>,
) -> AppResult<Json<Friendship>> {
    let raw = body.username.trim();
    let username = raw.trim_start_matches('@').trim();
    if username.is_empty() {
        return Err(AppError::BadRequest("username required".into()));
    }

    let peer_id: String = sqlx::query_scalar(
        "SELECT id FROM users WHERE lower(username) = lower(?)",
    )
    .bind(username)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| {
        AppError::BadRequest(format!("no user with username \"{username}\""))
    })?;
    let peer_id = Uuid::parse_str(&peer_id).unwrap();
    if peer_id == user.id {
        return Err(AppError::BadRequest("cannot friend yourself".into()));
    }
    if is_blocked(&state.db, user.id, peer_id).await? {
        return Err(AppError::Forbidden);
    }

    let (low, high) = pair_users(user.id, peer_id);
    if let Some(existing) = sqlx::query_as::<_, FriendshipRow>(
        "SELECT id, user_low, user_high, status, requested_by, created_at, updated_at FROM friendships WHERE user_low = ? AND user_high = ?",
    )
    .bind(low.to_string())
    .bind(high.to_string())
    .fetch_optional(&state.db)
    .await?
    {
        match existing.status.as_str() {
            "accepted" => {
                return Err(AppError::Conflict("already friends".into()));
            }
            "pending" => {
                return Err(AppError::Conflict("request already pending".into()));
            }
            "declined" => {
                let now = Utc::now().to_rfc3339();
                sqlx::query(
                    "UPDATE friendships SET status = 'pending', requested_by = ?, updated_at = ? WHERE id = ?",
                )
                .bind(user.id.to_string())
                .bind(&now)
                .bind(&existing.id)
                .execute(&state.db)
                .await?;
                let row = get_friendship_row(&state.db, Uuid::parse_str(&existing.id).unwrap()).await?;
                let friendship = friendship_for_viewer(&state.db, row, peer_id).await?;
                state.hub.send_to_user(
                    peer_id,
                    &WsEvent::FriendRequest {
                        friendship: friendship.clone(),
                    },
                );
                let for_me = friendship_for_viewer(
                    &state.db,
                    get_friendship_row(&state.db, friendship.id).await?,
                    user.id,
                )
                .await?;
                return Ok(Json(for_me));
            }
            _ => {}
        }
    }

    let id = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO friendships (id, user_low, user_high, status, requested_by, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(low.to_string())
    .bind(high.to_string())
    .bind(user.id.to_string())
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await?;

    let for_peer = friendship_for_viewer(
        &state.db,
        get_friendship_row(&state.db, id).await?,
        peer_id,
    )
    .await?;
    state.hub.send_to_user(
        peer_id,
        &WsEvent::FriendRequest {
            friendship: for_peer,
        },
    );

    let for_me = friendship_for_viewer(
        &state.db,
        get_friendship_row(&state.db, id).await?,
        user.id,
    )
    .await?;
    Ok(Json(for_me))
}

async fn ensure_dm_channel(
    state: &AppState,
    friendship_id: Uuid,
    user_a: Uuid,
    user_b: Uuid,
) -> AppResult<DmChannel> {
    if let Some(existing_id) = find_dm_between_users(&state.db, user_a, user_b).await? {
        sqlx::query("UPDATE dm_channels SET friendship_id = ? WHERE id = ?")
            .bind(friendship_id.to_string())
            .bind(existing_id.to_string())
            .execute(&state.db)
            .await?;
        return load_dm_for_user(state, existing_id, user_a).await;
    }

    if let Some(existing_id) = sqlx::query_scalar::<_, String>(
        "SELECT id FROM dm_channels WHERE friendship_id = ?",
    )
    .bind(friendship_id.to_string())
    .fetch_optional(&state.db)
    .await?
    {
        return load_dm_for_user(state, Uuid::parse_str(&existing_id).unwrap(), user_a).await;
    }

    let dm_id = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO dm_channels (id, friendship_id, created_at) VALUES (?, ?, ?)")
        .bind(dm_id.to_string())
        .bind(friendship_id.to_string())
        .bind(&now)
        .execute(&state.db)
        .await?;
    for uid in [user_a, user_b] {
        sqlx::query("INSERT INTO dm_participants (dm_channel_id, user_id) VALUES (?, ?)")
            .bind(dm_id.to_string())
            .bind(uid.to_string())
            .execute(&state.db)
            .await?;
    }

    let for_a = load_dm_for_user(state, dm_id, user_a).await?;
    let for_b = load_dm_for_user(state, dm_id, user_b).await?;
    state
        .hub
        .send_to_user(user_a, &WsEvent::DmChannelCreate { channel: for_a.clone() });
    state
        .hub
        .send_to_user(user_b, &WsEvent::DmChannelCreate { channel: for_b });
    Ok(for_a)
}

pub async fn find_dm_between_users(
    db: &sqlx::SqlitePool,
    a: Uuid,
    b: Uuid,
) -> AppResult<Option<Uuid>> {
    let id: Option<String> = sqlx::query_scalar(
        r#"SELECT d.id FROM dm_channels d
           INNER JOIN dm_participants p1 ON p1.dm_channel_id = d.id AND p1.user_id = ?
           INNER JOIN dm_participants p2 ON p2.dm_channel_id = d.id AND p2.user_id = ?
           WHERE (SELECT COUNT(*) FROM dm_participants WHERE dm_channel_id = d.id) = 2
           LIMIT 1"#,
    )
    .bind(a.to_string())
    .bind(b.to_string())
    .fetch_optional(db)
    .await?;
    Ok(id.and_then(|s| Uuid::parse_str(&s).ok()))
}

/// Open or create a 1:1 DM with any user (friends optional). Blocked users are rejected.
pub async fn ensure_dm_with_peer(
    state: &AppState,
    viewer: Uuid,
    peer: Uuid,
) -> AppResult<DmChannel> {
    if viewer == peer {
        return Err(AppError::BadRequest("cannot message yourself".into()));
    }
    if is_blocked(&state.db, viewer, peer).await? {
        return Err(AppError::Forbidden);
    }
    let _ = db::user_public(&state.db, peer).await?;

    if let Some(dm_id) = find_dm_between_users(&state.db, viewer, peer).await? {
        return load_dm_for_user(state, dm_id, viewer).await;
    }

    if are_friends(&state.db, viewer, peer).await? {
        let (low, high) = pair_users(viewer, peer);
        let friendship_id: String = sqlx::query_scalar(
            "SELECT id FROM friendships WHERE user_low = ? AND user_high = ? AND status = 'accepted'",
        )
        .bind(low.to_string())
        .bind(high.to_string())
        .fetch_one(&state.db)
        .await?;
        return ensure_dm_channel(
            state,
            Uuid::parse_str(&friendship_id).unwrap(),
            low,
            high,
        )
        .await;
    }

    let dm_id = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO dm_channels (id, friendship_id, created_at) VALUES (?, NULL, ?)")
        .bind(dm_id.to_string())
        .bind(&now)
        .execute(&state.db)
        .await?;
    for uid in [viewer, peer] {
        sqlx::query("INSERT INTO dm_participants (dm_channel_id, user_id) VALUES (?, ?)")
            .bind(dm_id.to_string())
            .bind(uid.to_string())
            .execute(&state.db)
            .await?;
    }

    let for_viewer = load_dm_for_user(state, dm_id, viewer).await?;
    let for_peer = load_dm_for_user(state, dm_id, peer).await?;
    state.hub.send_to_user(
        viewer,
        &WsEvent::DmChannelCreate {
            channel: for_viewer.clone(),
        },
    );
    state.hub.send_to_user(peer, &WsEvent::DmChannelCreate { channel: for_peer });
    Ok(for_viewer)
}

pub async fn load_dm_for_user(
    state: &AppState,
    dm_id: Uuid,
    viewer: Uuid,
) -> AppResult<DmChannel> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: String,
        friendship_id: Option<String>,
        created_at: String,
    }
    let row = sqlx::query_as::<_, Row>(
        r#"SELECT d.id, d.friendship_id, d.created_at
           FROM dm_channels d
           INNER JOIN dm_participants p ON p.dm_channel_id = d.id
           WHERE d.id = ? AND p.user_id = ?"#,
    )
    .bind(dm_id.to_string())
    .bind(viewer.to_string())
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    let peer_id: String = sqlx::query_scalar(
        "SELECT user_id FROM dm_participants WHERE dm_channel_id = ? AND user_id != ?",
    )
    .bind(dm_id.to_string())
    .bind(viewer.to_string())
    .fetch_one(&state.db)
    .await?;

    Ok(DmChannel {
        id: Uuid::parse_str(&row.id).unwrap(),
        friendship_id: row
            .friendship_id
            .and_then(|s| Uuid::parse_str(&s).ok()),
        peer: db::user_public(&state.db, Uuid::parse_str(&peer_id).unwrap()).await?,
        created_at: parse_dt(&row.created_at),
    })
}

pub async fn accept_friend(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Friendship>> {
    let row = get_friendship_row(&state.db, id).await?;
    if !is_participant(&row, user.id) {
        return Err(AppError::Forbidden);
    }
    if row.status != "pending" {
        return Err(AppError::BadRequest("not a pending request".into()));
    }
    let requested_by = Uuid::parse_str(&row.requested_by).unwrap();
    if requested_by == user.id {
        return Err(AppError::BadRequest("cannot accept your own request".into()));
    }

    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(id.to_string())
        .execute(&state.db)
        .await?;

    let low = Uuid::parse_str(&row.user_low).unwrap();
    let high = Uuid::parse_str(&row.user_high).unwrap();
    let _ = ensure_dm_channel(&state, id, low, high).await?;

    let for_me = friendship_for_viewer(
        &state.db,
        get_friendship_row(&state.db, id).await?,
        user.id,
    )
    .await?;
    let peer_id = for_me.peer.id;
    let for_peer = friendship_for_viewer(
        &state.db,
        get_friendship_row(&state.db, id).await?,
        peer_id,
    )
    .await?;

    state.hub.send_to_user(
        peer_id,
        &WsEvent::FriendUpdate {
            friendship: for_peer,
        },
    );
    Ok(Json(for_me))
}

pub async fn decline_friend(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Friendship>> {
    let row = get_friendship_row(&state.db, id).await?;
    if !is_participant(&row, user.id) {
        return Err(AppError::Forbidden);
    }
    if row.status != "pending" {
        return Err(AppError::BadRequest("not a pending request".into()));
    }

    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE friendships SET status = 'declined', updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(id.to_string())
        .execute(&state.db)
        .await?;

    let for_me = friendship_for_viewer(
        &state.db,
        get_friendship_row(&state.db, id).await?,
        user.id,
    )
    .await?;
    let peer_id = for_me.peer.id;
    let for_peer = friendship_for_viewer(
        &state.db,
        get_friendship_row(&state.db, id).await?,
        peer_id,
    )
    .await?;
    state.hub.send_to_user(
        peer_id,
        &WsEvent::FriendUpdate {
            friendship: for_peer,
        },
    );
    Ok(Json(for_me))
}

pub async fn remove_friend(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<()>> {
    let row = get_friendship_row(&state.db, id).await?;
    if !is_participant(&row, user.id) {
        return Err(AppError::Forbidden);
    }
    let low = Uuid::parse_str(&row.user_low).unwrap();
    let high = Uuid::parse_str(&row.user_high).unwrap();
    let peer = if low == user.id { high } else { low };

    sqlx::query("DELETE FROM friendships WHERE id = ?")
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    sqlx::query("DELETE FROM friend_mutes WHERE (user_id = ? AND peer_id = ?) OR (user_id = ? AND peer_id = ?)")
        .bind(user.id.to_string())
        .bind(peer.to_string())
        .bind(peer.to_string())
        .bind(user.id.to_string())
        .execute(&state.db)
        .await?;

    let ev = WsEvent::FriendRemoved { friendship_id: id };
    state.hub.send_to_user(user.id, &ev);
    state.hub.send_to_user(peer, &ev);
    Ok(Json(()))
}

pub async fn mute_friend(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Friendship>> {
    let row = get_friendship_row(&state.db, id).await?;
    if !is_participant(&row, user.id) {
        return Err(AppError::Forbidden);
    }
    if row.status != "accepted" {
        return Err(AppError::BadRequest("not friends".into()));
    }
    let low = Uuid::parse_str(&row.user_low).unwrap();
    let high = Uuid::parse_str(&row.user_high).unwrap();
    let peer = if low == user.id { high } else { low };

    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM friend_mutes WHERE user_id = ? AND peer_id = ?",
    )
    .bind(user.id.to_string())
    .bind(peer.to_string())
    .fetch_optional(&state.db)
    .await?;

    if existing.is_some() {
        sqlx::query("DELETE FROM friend_mutes WHERE user_id = ? AND peer_id = ?")
            .bind(user.id.to_string())
            .bind(peer.to_string())
            .execute(&state.db)
            .await?;
    } else {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO friend_mutes (user_id, peer_id, created_at) VALUES (?, ?, ?)",
        )
        .bind(user.id.to_string())
        .bind(peer.to_string())
        .bind(&now)
        .execute(&state.db)
        .await?;
    }

    let for_me = friendship_for_viewer(
        &state.db,
        get_friendship_row(&state.db, id).await?,
        user.id,
    )
    .await?;
    Ok(Json(for_me))
}

pub async fn block_friend(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<()>> {
    let row = get_friendship_row(&state.db, id).await?;
    if !is_participant(&row, user.id) {
        return Err(AppError::Forbidden);
    }
    let low = Uuid::parse_str(&row.user_low).unwrap();
    let high = Uuid::parse_str(&row.user_high).unwrap();
    let peer = if low == user.id { high } else { low };

    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)",
    )
    .bind(user.id.to_string())
    .bind(peer.to_string())
    .bind(&now)
    .execute(&state.db)
    .await?;

    // Hide DM for blocker; keep messages.
    if let Some(dm_id) = sqlx::query_scalar::<_, String>(
        "SELECT id FROM dm_channels WHERE friendship_id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(&state.db)
    .await?
    {
        sqlx::query(
            "UPDATE dm_participants SET hidden = 1 WHERE dm_channel_id = ? AND user_id = ?",
        )
        .bind(&dm_id)
        .bind(user.id.to_string())
        .execute(&state.db)
        .await?;
    }

    sqlx::query("DELETE FROM friendships WHERE id = ?")
        .bind(id.to_string())
        .execute(&state.db)
        .await?;
    sqlx::query("DELETE FROM friend_mutes WHERE (user_id = ? AND peer_id = ?) OR (user_id = ? AND peer_id = ?)")
        .bind(user.id.to_string())
        .bind(peer.to_string())
        .bind(peer.to_string())
        .bind(user.id.to_string())
        .execute(&state.db)
        .await?;

    let ev = WsEvent::FriendRemoved { friendship_id: id };
    state.hub.send_to_user(user.id, &ev);
    state.hub.send_to_user(peer, &ev);
    Ok(Json(()))
}

/// Block any user by id (friendship optional). Used from server member menus.
pub async fn block_user(
    State(state): State<AppState>,
    user: AuthUser,
    Path(peer): Path<Uuid>,
) -> AppResult<Json<()>> {
    if peer == user.id {
        return Err(AppError::BadRequest("cannot block yourself".into()));
    }
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)",
    )
    .bind(user.id.to_string())
    .bind(peer.to_string())
    .bind(&now)
    .execute(&state.db)
    .await?;

    let (low, high) = pair_users(user.id, peer);
    if let Some(fid) = sqlx::query_scalar::<_, String>(
        "SELECT id FROM friendships WHERE user_low = ? AND user_high = ?",
    )
    .bind(low.to_string())
    .bind(high.to_string())
    .fetch_optional(&state.db)
    .await?
    {
        if let Some(dm_id) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM dm_channels WHERE friendship_id = ?",
        )
        .bind(&fid)
        .fetch_optional(&state.db)
        .await?
        {
            sqlx::query(
                "UPDATE dm_participants SET hidden = 1 WHERE dm_channel_id = ? AND user_id = ?",
            )
            .bind(&dm_id)
            .bind(user.id.to_string())
            .execute(&state.db)
            .await?;
        }
        let friendship_id = Uuid::parse_str(&fid).unwrap();
        sqlx::query("DELETE FROM friendships WHERE id = ?")
            .bind(&fid)
            .execute(&state.db)
            .await?;
        let ev = WsEvent::FriendRemoved { friendship_id };
        state.hub.send_to_user(user.id, &ev);
        state.hub.send_to_user(peer, &ev);
    }

    sqlx::query(
        "DELETE FROM friend_mutes WHERE (user_id = ? AND peer_id = ?) OR (user_id = ? AND peer_id = ?)",
    )
    .bind(user.id.to_string())
    .bind(peer.to_string())
    .bind(peer.to_string())
    .bind(user.id.to_string())
    .execute(&state.db)
    .await?;

    Ok(Json(()))
}
