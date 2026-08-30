use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use speakapp_shared::{
    Attachment, Channel, ChannelType, Member, Message, OverwriteTarget, PermissionOverwrite,
    Permissions, PresenceStatus, ReactionSummary, Role, Server, ServerRule, UserPublic,
};
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize)]
pub struct UserMe {
    #[serde(flatten)]
    pub profile: UserPublic,
    pub email: String,
    pub disabled: bool,
}

#[allow(dead_code)]
pub fn parse_uuid(s: &str) -> AppResult<Uuid> {
    Uuid::parse_str(s).map_err(|_| AppError::BadRequest("invalid uuid".into()))
}

pub async fn user_public(db: &SqlitePool, id: Uuid) -> AppResult<UserPublic> {
    let row = sqlx::query_as::<_, UserRow>(
        "SELECT id, username, display_name, avatar_url, banner_url, created_at FROM users WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(row.into())
}

pub async fn user_me(db: &SqlitePool, id: Uuid) -> AppResult<UserMe> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: String,
        username: String,
        display_name: String,
        email: String,
        avatar_url: Option<String>,
        banner_url: Option<String>,
        created_at: String,
        disabled_at: Option<String>,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT id, username, display_name, email, avatar_url, banner_url, created_at, disabled_at FROM users WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(UserMe {
        profile: UserPublic {
            id: Uuid::parse_str(&row.id).unwrap(),
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            banner_url: row.banner_url,
            created_at: DateTime::parse_from_rfc3339(&row.created_at)
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
        },
        email: row.email,
        disabled: row.disabled_at.is_some(),
    })
}

pub async fn is_user_disabled(db: &SqlitePool, id: Uuid) -> AppResult<bool> {
    let row: Option<Option<String>> =
        sqlx::query_scalar("SELECT disabled_at FROM users WHERE id = ?")
            .bind(id.to_string())
            .fetch_optional(db)
            .await?;
    Ok(matches!(row, Some(Some(_))))
}

pub async fn user_password_hash(db: &SqlitePool, id: Uuid) -> AppResult<String> {
    sqlx::query_scalar("SELECT password_hash FROM users WHERE id = ?")
        .bind(id.to_string())
        .fetch_optional(db)
        .await?
        .ok_or(AppError::NotFound)
}

pub async fn revoke_refresh_tokens(db: &SqlitePool, user_id: Uuid) -> AppResult<()> {
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = ?")
        .bind(user_id.to_string())
        .execute(db)
        .await?;
    Ok(())
}

pub async fn disable_user(db: &SqlitePool, user_id: Uuid) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    let res = sqlx::query("UPDATE users SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL")
        .bind(&now)
        .bind(user_id.to_string())
        .execute(db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    revoke_refresh_tokens(db, user_id).await?;
    Ok(())
}

pub async fn delete_user_account(db: &SqlitePool, user_id: Uuid) -> AppResult<()> {
    let uid = user_id.to_string();
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM messages WHERE author_id = ?")
        .bind(&uid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM reactions WHERE user_id = ?")
        .bind(&uid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM invites WHERE creator_id = ?")
        .bind(&uid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM bans WHERE banned_by = ? OR user_id = ?")
        .bind(&uid)
        .bind(&uid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM servers WHERE owner_id = ?")
        .bind(&uid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = ?")
        .bind(&uid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM voice_states WHERE user_id = ?")
        .bind(&uid)
        .execute(&mut *tx)
        .await?;
    let res = sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(&uid)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    tx.commit().await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct UserRow {
    id: String,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    banner_url: Option<String>,
    created_at: String,
}

impl From<UserRow> for UserPublic {
    fn from(r: UserRow) -> Self {
        Self {
            id: Uuid::parse_str(&r.id).unwrap(),
            username: r.username,
            display_name: r.display_name,
            avatar_url: r.avatar_url,
            banner_url: r.banner_url,
            created_at: DateTime::parse_from_rfc3339(&r.created_at)
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
        }
    }
}

pub fn parse_presence_status(raw: &str) -> PresenceStatus {
    match raw.trim().to_ascii_lowercase().as_str() {
        "idle" => PresenceStatus::Idle,
        "dnd" | "busy" => PresenceStatus::Dnd,
        "offline" | "invisible" => PresenceStatus::Offline,
        _ => PresenceStatus::Online,
    }
}

pub fn presence_status_str(status: PresenceStatus) -> &'static str {
    match status {
        PresenceStatus::Online => "online",
        PresenceStatus::Idle => "idle",
        PresenceStatus::Dnd => "dnd",
        PresenceStatus::Offline => "offline",
    }
}

pub async fn get_user_status(db: &SqlitePool, id: Uuid) -> AppResult<PresenceStatus> {
    let row: Option<String> = sqlx::query_scalar("SELECT status FROM users WHERE id = ?")
        .bind(id.to_string())
        .fetch_optional(db)
        .await?;
    Ok(row
        .map(|s| parse_presence_status(&s))
        .unwrap_or(PresenceStatus::Online))
}

pub async fn set_user_status(
    db: &SqlitePool,
    id: Uuid,
    status: PresenceStatus,
) -> AppResult<()> {
    let res = sqlx::query("UPDATE users SET status = ? WHERE id = ?")
        .bind(presence_status_str(status))
        .bind(id.to_string())
        .execute(db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[derive(sqlx::FromRow)]
struct ServerRow {
    id: String,
    name: String,
    icon_url: Option<String>,
    banner_url: Option<String>,
    owner_id: String,
    accent_color: String,
    invite_splash_url: Option<String>,
    created_at: String,
}

impl From<ServerRow> for Server {
    fn from(r: ServerRow) -> Self {
        Self {
            id: Uuid::parse_str(&r.id).unwrap(),
            name: r.name,
            icon_url: r.icon_url,
            banner_url: r.banner_url,
            owner_id: Uuid::parse_str(&r.owner_id).unwrap(),
            accent_color: r.accent_color,
            invite_splash_url: r.invite_splash_url,
            created_at: DateTime::parse_from_rfc3339(&r.created_at)
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
        }
    }
}

pub async fn get_server(db: &SqlitePool, id: Uuid) -> AppResult<Server> {
    let row = sqlx::query_as::<_, ServerRow>(
        "SELECT id, name, icon_url, banner_url, owner_id, accent_color, invite_splash_url, created_at FROM servers WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(row.into())
}

pub async fn user_servers(db: &SqlitePool, user_id: Uuid) -> AppResult<Vec<Server>> {
    let rows = sqlx::query_as::<_, ServerRow>(
        r#"SELECT s.id, s.name, s.icon_url, s.banner_url, s.owner_id, s.accent_color, s.invite_splash_url, s.created_at
           FROM servers s
           INNER JOIN members m ON m.server_id = s.id
           WHERE m.user_id = ?
           ORDER BY s.name"#,
    )
    .bind(user_id.to_string())
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn is_member(db: &SqlitePool, server_id: Uuid, user_id: Uuid) -> AppResult<bool> {
    let count: (i64,) =
        sqlx::query_as("SELECT COUNT(1) FROM members WHERE server_id = ? AND user_id = ?")
            .bind(server_id.to_string())
            .bind(user_id.to_string())
            .fetch_one(db)
            .await?;
    Ok(count.0 > 0)
}

pub async fn server_member_ids(db: &SqlitePool, server_id: Uuid) -> AppResult<Vec<Uuid>> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT user_id FROM members WHERE server_id = ?")
        .bind(server_id.to_string())
        .fetch_all(db)
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(id,)| Uuid::parse_str(&id).ok())
        .collect())
}

#[derive(sqlx::FromRow)]
struct RoleRow {
    id: String,
    server_id: String,
    name: String,
    color: String,
    gradient: Option<String>,
    position: i64,
    permissions: i64,
    is_everyone: i64,
}

impl From<RoleRow> for Role {
    fn from(r: RoleRow) -> Self {
        Self {
            id: Uuid::parse_str(&r.id).unwrap(),
            server_id: Uuid::parse_str(&r.server_id).unwrap(),
            name: r.name,
            color: r.color,
            gradient: r.gradient,
            position: r.position as i32,
            permissions: Permissions::from_bits_truncate(r.permissions as u64),
            is_everyone: r.is_everyone != 0,
        }
    }
}

pub async fn server_roles(db: &SqlitePool, server_id: Uuid) -> AppResult<Vec<Role>> {
    let rows = sqlx::query_as::<_, RoleRow>(
        "SELECT id, server_id, name, color, gradient, position, permissions, is_everyone FROM roles WHERE server_id = ? ORDER BY position",
    )
    .bind(server_id.to_string())
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn member_role_ids(
    db: &SqlitePool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<Vec<Uuid>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?")
            .bind(server_id.to_string())
            .bind(user_id.to_string())
            .fetch_all(db)
            .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(id,)| Uuid::parse_str(&id).ok())
        .collect())
}

#[derive(sqlx::FromRow)]
struct ChannelRow {
    id: String,
    server_id: String,
    category_id: Option<String>,
    name: String,
    channel_type: String,
    position: i64,
    topic: Option<String>,
    background_url: Option<String>,
    background_blur: f64,
    background_dim: f64,
    text_color: Option<String>,
    atmosphere: Option<String>,
    user_limit: i64,
}

impl From<ChannelRow> for Channel {
    fn from(r: ChannelRow) -> Self {
        let channel_type = match r.channel_type.as_str() {
            "voice" => ChannelType::Voice,
            "category" => ChannelType::Category,
            _ => ChannelType::Text,
        };
        Self {
            id: Uuid::parse_str(&r.id).unwrap(),
            server_id: Uuid::parse_str(&r.server_id).unwrap(),
            category_id: r.category_id.and_then(|id| Uuid::parse_str(&id).ok()),
            name: r.name,
            channel_type,
            position: r.position as i32,
            topic: r.topic,
            background_url: r.background_url,
            background_blur: r.background_blur as f32,
            background_dim: r.background_dim as f32,
            text_color: r.text_color,
            atmosphere: r.atmosphere,
            user_limit: r.user_limit as i32,
        }
    }
}

pub async fn get_channel(db: &SqlitePool, id: Uuid) -> AppResult<Channel> {
    let row = sqlx::query_as::<_, ChannelRow>(
        "SELECT id, server_id, category_id, name, channel_type, position, topic, background_url, background_blur, background_dim, text_color, atmosphere, user_limit FROM channels WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(row.into())
}

pub async fn server_channels(db: &SqlitePool, server_id: Uuid) -> AppResult<Vec<Channel>> {
    let rows = sqlx::query_as::<_, ChannelRow>(
        "SELECT id, server_id, category_id, name, channel_type, position, topic, background_url, background_blur, background_dim, text_color, atmosphere, user_limit FROM channels WHERE server_id = ? ORDER BY position, name",
    )
    .bind(server_id.to_string())
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn channel_overwrites(
    db: &SqlitePool,
    channel_id: Uuid,
) -> AppResult<Vec<PermissionOverwrite>> {
    #[derive(sqlx::FromRow)]
    struct OwRow {
        id: String,
        channel_id: String,
        target_type: String,
        target_id: String,
        allow_bits: i64,
        deny_bits: i64,
    }
    let rows = sqlx::query_as::<_, OwRow>(
        "SELECT id, channel_id, target_type, target_id, allow_bits, deny_bits FROM permission_overwrites WHERE channel_id = ?",
    )
    .bind(channel_id.to_string())
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| map_overwrite_row(
            r.id,
            r.channel_id,
            r.target_type,
            r.target_id,
            r.allow_bits,
            r.deny_bits,
        ))
        .collect())
}

/// All permission overwrites for channels in a server (for sidebar lock badges).
pub async fn server_channel_overwrites(
    db: &SqlitePool,
    server_id: Uuid,
) -> AppResult<Vec<PermissionOverwrite>> {
    #[derive(sqlx::FromRow)]
    struct OwRow {
        id: String,
        channel_id: String,
        target_type: String,
        target_id: String,
        allow_bits: i64,
        deny_bits: i64,
    }
    let rows = sqlx::query_as::<_, OwRow>(
        "SELECT po.id, po.channel_id, po.target_type, po.target_id, po.allow_bits, po.deny_bits
         FROM permission_overwrites po
         INNER JOIN channels c ON c.id = po.channel_id
         WHERE c.server_id = ?",
    )
    .bind(server_id.to_string())
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| map_overwrite_row(
            r.id,
            r.channel_id,
            r.target_type,
            r.target_id,
            r.allow_bits,
            r.deny_bits,
        ))
        .collect())
}

fn map_overwrite_row(
    id: String,
    channel_id: String,
    target_type: String,
    target_id: String,
    allow_bits: i64,
    deny_bits: i64,
) -> PermissionOverwrite {
    PermissionOverwrite {
        id: Uuid::parse_str(&id).unwrap(),
        channel_id: Uuid::parse_str(&channel_id).unwrap(),
        target_type: if target_type == "member" {
            OverwriteTarget::Member
        } else {
            OverwriteTarget::Role
        },
        target_id: Uuid::parse_str(&target_id).unwrap(),
        allow: Permissions::from_bits_truncate(allow_bits as u64),
        deny: Permissions::from_bits_truncate(deny_bits as u64),
    }
}

pub async fn effective_permissions(
    db: &SqlitePool,
    server: &Server,
    channel_id: Option<Uuid>,
    user_id: Uuid,
) -> AppResult<Permissions> {
    if server.owner_id == user_id {
        return Ok(Permissions::all());
    }
    // Non-members must not inherit @everyone (or any) server permissions.
    if !is_member(db, server.id, user_id).await? {
        return Ok(Permissions::empty());
    }
    let roles = server_roles(db, server.id).await?;
    let mut role_ids = member_role_ids(db, server.id, user_id).await?;
    if let Some(everyone) = roles.iter().find(|r| r.is_everyone) {
        if !role_ids.contains(&everyone.id) {
            role_ids.push(everyone.id);
        }
    }
    let overwrites = if let Some(cid) = channel_id {
        channel_overwrites(db, cid).await?
    } else {
        vec![]
    };
    Ok(speakapp_shared::resolve_permissions(
        &roles,
        &role_ids,
        false,
        &overwrites,
        user_id,
    ))
}

/// Highest role position held by a member (`-1` if none / not a member).
pub async fn member_highest_position(
    db: &SqlitePool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<i32> {
    let roles = server_roles(db, server_id).await?;
    let held = member_role_ids(db, server_id, user_id).await?;
    let mut max = -1i32;
    for role in &roles {
        if role.is_everyone || held.contains(&role.id) {
            max = max.max(role.position);
        }
    }
    Ok(max)
}

/// True when `actor` may moderate `target` (kick/ban/mute/role assign).
pub async fn can_moderate_member(
    db: &SqlitePool,
    server: &Server,
    actor_id: Uuid,
    target_id: Uuid,
) -> AppResult<bool> {
    if actor_id == target_id {
        return Ok(false);
    }
    if target_id == server.owner_id {
        return Ok(false);
    }
    if actor_id == server.owner_id {
        return Ok(true);
    }
    let actor_pos = member_highest_position(db, server.id, actor_id).await?;
    let target_pos = member_highest_position(db, server.id, target_id).await?;
    Ok(actor_pos > target_pos)
}

/// Cap role permission bits so an actor cannot grant powers they lack.
/// Owners may grant anything; others cannot grant ADMINISTRATOR.
pub async fn cap_role_permissions(
    db: &SqlitePool,
    server: &Server,
    actor_id: Uuid,
    requested: u64,
) -> AppResult<u64> {
    let actor_perms = effective_permissions(db, server, None, actor_id).await?;
    let mut bits = Permissions::from_bits_truncate(requested);
    if actor_id != server.owner_id {
        bits.remove(Permissions::ADMINISTRATOR);
        // Only grant bits the actor themselves holds (ADMINISTRATOR already covered).
        bits = bits.intersection(actor_perms);
        bits.remove(Permissions::ADMINISTRATOR);
    }
    Ok(bits.bits())
}

/// Cap channel overwrite bits to what the actor can manage.
pub async fn cap_overwrite_bits(
    db: &SqlitePool,
    server: &Server,
    channel_id: Uuid,
    actor_id: Uuid,
    allow: u64,
    deny: u64,
) -> AppResult<(u64, u64)> {
    let actor_perms = effective_permissions(db, server, Some(channel_id), actor_id).await?;
    let mut allow_bits = Permissions::from_bits_truncate(allow);
    let mut deny_bits = Permissions::from_bits_truncate(deny);
    if actor_id != server.owner_id && !actor_perms.has(Permissions::ADMINISTRATOR) {
        allow_bits = allow_bits.intersection(actor_perms);
        deny_bits = deny_bits.intersection(actor_perms);
        allow_bits.remove(Permissions::ADMINISTRATOR);
        deny_bits.remove(Permissions::ADMINISTRATOR);
    }
    Ok((allow_bits.bits(), deny_bits.bits()))
}

pub async fn require_perm(
    db: &SqlitePool,
    server: &Server,
    channel_id: Option<Uuid>,
    user_id: Uuid,
    need: Permissions,
) -> AppResult<()> {
    let perms = effective_permissions(db, server, channel_id, user_id).await?;
    if perms.has(need) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Members of `server` who currently have `need` on `channel_id`.
pub async fn members_with_channel_perm(
    db: &SqlitePool,
    server: &Server,
    channel_id: Uuid,
    need: Permissions,
) -> AppResult<Vec<Uuid>> {
    let ids = server_member_ids(db, server.id).await?;
    let mut out = Vec::with_capacity(ids.len());
    for uid in ids {
        if effective_permissions(db, server, Some(channel_id), uid)
            .await?
            .has(need)
        {
            out.push(uid);
        }
    }
    Ok(out)
}

pub async fn get_member(db: &SqlitePool, server_id: Uuid, user_id: Uuid) -> AppResult<Member> {
    #[derive(sqlx::FromRow)]
    struct MRow {
        nickname: Option<String>,
        joined_at: String,
        accepted_rules: i64,
        timeout_until: Option<String>,
        timeout_reason: Option<String>,
    }
    let row = sqlx::query_as::<_, MRow>(
        "SELECT nickname, joined_at, accepted_rules, timeout_until, timeout_reason FROM members WHERE server_id = ? AND user_id = ?",
    )
    .bind(server_id.to_string())
    .bind(user_id.to_string())
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    let user = user_public(db, user_id).await?;
    let role_ids = member_role_ids(db, server_id, user_id).await?;
    let timeout_until = row.timeout_until.as_deref().and_then(|s| {
        DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|d| d.with_timezone(&Utc))
    });
    // Expired timeouts clear lazily on read.
    let (timeout_until, timeout_reason) = match timeout_until {
        Some(until) if until > Utc::now() => (Some(until), row.timeout_reason),
        Some(_) => {
            let _ = sqlx::query(
                "UPDATE members SET timeout_until = NULL, timeout_reason = NULL WHERE server_id = ? AND user_id = ?",
            )
            .bind(server_id.to_string())
            .bind(user_id.to_string())
            .execute(db)
            .await;
            (None, None)
        }
        None => (None, None),
    };
    Ok(Member {
        user,
        server_id,
        nickname: row.nickname,
        role_ids,
        joined_at: DateTime::parse_from_rfc3339(&row.joined_at)
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        accepted_rules: row.accepted_rules != 0,
        timeout_until,
        timeout_reason,
    })
}

/// True when the member is currently timed out on this server.
pub async fn member_is_timed_out(
    db: &SqlitePool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<bool> {
    let member = get_member(db, server_id, user_id).await?;
    Ok(member
        .timeout_until
        .map(|t| t > Utc::now())
        .unwrap_or(false))
}

pub async fn require_not_timed_out(
    db: &SqlitePool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<()> {
    if member_is_timed_out(db, server_id, user_id).await? {
        Err(AppError::BadRequest(
            "you are timed out in this server".into(),
        ))
    } else {
        Ok(())
    }
}

pub async fn server_rules(db: &SqlitePool, server_id: Uuid) -> AppResult<Vec<ServerRule>> {
    #[derive(sqlx::FromRow)]
    struct RRow {
        id: String,
        server_id: String,
        title: String,
        body: String,
        position: i64,
    }
    let rows = sqlx::query_as::<_, RRow>(
        "SELECT id, server_id, title, body, position FROM server_rules WHERE server_id = ? ORDER BY position",
    )
    .bind(server_id.to_string())
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| ServerRule {
            id: Uuid::parse_str(&r.id).unwrap(),
            server_id: Uuid::parse_str(&r.server_id).unwrap(),
            title: r.title,
            body: r.body,
            position: r.position as i32,
        })
        .collect())
}

pub async fn load_message(db: &SqlitePool, id: Uuid, viewer_id: Uuid) -> AppResult<Message> {
    #[derive(sqlx::FromRow)]
    struct MRow {
        id: String,
        channel_id: String,
        author_id: String,
        content: String,
        reply_to_id: Option<String>,
        edited_at: Option<String>,
        created_at: String,
        webhook_id: Option<String>,
        webhook_name: Option<String>,
        bot_id: Option<String>,
        bot_name: Option<String>,
    }
    let row = sqlx::query_as::<_, MRow>(
        "SELECT id, channel_id, author_id, content, reply_to_id, edited_at, created_at, webhook_id, webhook_name, bot_id, bot_name FROM messages WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;

    let attachments = message_attachments(db, id).await?;
    let reactions = message_reactions(db, id, viewer_id).await?;

    Ok(Message {
        id: Uuid::parse_str(&row.id).unwrap(),
        channel_id: Uuid::parse_str(&row.channel_id).unwrap(),
        author_id: Uuid::parse_str(&row.author_id).unwrap(),
        content: row.content,
        reply_to_id: row.reply_to_id.and_then(|x| Uuid::parse_str(&x).ok()),
        edited_at: row.edited_at.and_then(|s| {
            DateTime::parse_from_rfc3339(&s)
                .ok()
                .map(|d| d.with_timezone(&Utc))
        }),
        created_at: DateTime::parse_from_rfc3339(&row.created_at)
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        attachments,
        reactions,
        webhook_id: row.webhook_id.and_then(|x| Uuid::parse_str(&x).ok()),
        webhook_name: row.webhook_name,
        bot_id: row.bot_id.and_then(|x| Uuid::parse_str(&x).ok()),
        bot_name: row.bot_name,
    })
}

async fn message_attachments(db: &SqlitePool, message_id: Uuid) -> AppResult<Vec<Attachment>> {
    #[derive(sqlx::FromRow)]
    struct ARow {
        id: String,
        message_id: String,
        filename: String,
        content_type: String,
        size: i64,
        url: String,
    }
    let rows = sqlx::query_as::<_, ARow>(
        "SELECT id, message_id, filename, content_type, size, url FROM attachments WHERE message_id = ?",
    )
    .bind(message_id.to_string())
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| Attachment {
            id: Uuid::parse_str(&r.id).unwrap(),
            message_id: Uuid::parse_str(&r.message_id).unwrap(),
            filename: r.filename,
            content_type: r.content_type,
            size: r.size as u64,
            url: r.url,
        })
        .collect())
}

async fn message_reactions(
    db: &SqlitePool,
    message_id: Uuid,
    viewer_id: Uuid,
) -> AppResult<Vec<ReactionSummary>> {
    #[derive(sqlx::FromRow)]
    struct RRow {
        emoji: String,
        count: i64,
        me: i64,
    }
    let rows = sqlx::query_as::<_, RRow>(
        r#"SELECT emoji, COUNT(*) as count,
           SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) as me
           FROM reactions WHERE message_id = ? GROUP BY emoji"#,
    )
    .bind(viewer_id.to_string())
    .bind(message_id.to_string())
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| ReactionSummary {
            emoji: r.emoji,
            count: r.count as u32,
            me: r.me > 0,
        })
        .collect())
}

pub async fn list_messages(
    db: &SqlitePool,
    channel_id: Uuid,
    before: Option<Uuid>,
    limit: i64,
    viewer_id: Uuid,
) -> AppResult<Vec<Message>> {
    #[derive(sqlx::FromRow)]
    struct MRow {
        id: String,
    }
    let limit = limit.clamp(1, 100);
    let ids: Vec<MRow> = if let Some(before_id) = before {
        sqlx::query_as(
            r#"SELECT id FROM messages
               WHERE channel_id = ? AND created_at < (SELECT created_at FROM messages WHERE id = ?)
               ORDER BY created_at DESC LIMIT ?"#,
        )
        .bind(channel_id.to_string())
        .bind(before_id.to_string())
        .bind(limit)
        .fetch_all(db)
        .await?
    } else {
        sqlx::query_as(
            "SELECT id FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(channel_id.to_string())
        .bind(limit)
        .fetch_all(db)
        .await?
    };

    let mut out = Vec::with_capacity(ids.len());
    for row in ids {
        let id = Uuid::parse_str(&row.id).unwrap();
        out.push(load_message(db, id, viewer_id).await?);
    }
    out.reverse();
    Ok(out)
}
