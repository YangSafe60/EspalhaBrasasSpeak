//! Shared types and permission bitflags for Espalha Brasas.

use bitflags::bitflags;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    #[serde(transparent)]
    pub struct Permissions: u64 {
        const VIEW_CHANNEL     = 1 << 0;
        const SEND_MESSAGES    = 1 << 1;
        const MANAGE_MESSAGES  = 1 << 2;
        const CONNECT          = 1 << 3;
        const SPEAK            = 1 << 4;
        const STREAM           = 1 << 5;
        const MUTE_MEMBERS     = 1 << 6;
        const MOVE_MEMBERS     = 1 << 7;
        const MANAGE_CHANNELS  = 1 << 8;
        const MANAGE_ROLES     = 1 << 9;
        const MANAGE_SERVER    = 1 << 10;
        const KICK_MEMBERS     = 1 << 11;
        const BAN_MEMBERS      = 1 << 12;
        const CREATE_INVITE    = 1 << 13;
        const ATTACH_FILES     = 1 << 14;
        const ADD_REACTIONS    = 1 << 15;
        const MENTION_EVERYONE = 1 << 16;
        const MANAGE_EXPRESSIONS = 1 << 17;
        const ADMINISTRATOR    = 1 << 63;
    }
}

impl Permissions {
    pub const EVERYONE_DEFAULT: Permissions = Permissions::from_bits_truncate(
        Permissions::VIEW_CHANNEL.bits()
            | Permissions::SEND_MESSAGES.bits()
            | Permissions::CONNECT.bits()
            | Permissions::SPEAK.bits()
            | Permissions::STREAM.bits()
            | Permissions::CREATE_INVITE.bits()
            | Permissions::ATTACH_FILES.bits()
            | Permissions::ADD_REACTIONS.bits(),
    );

    pub fn has(self, other: Permissions) -> bool {
        self.contains(Permissions::ADMINISTRATOR) || self.contains(other)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelType {
    Text,
    Voice,
    Category,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPublic {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub banner_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Server {
    pub id: Uuid,
    pub name: String,
    pub icon_url: Option<String>,
    pub banner_url: Option<String>,
    pub owner_id: Uuid,
    pub accent_color: String,
    pub invite_splash_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub color: String,
    pub gradient: Option<String>,
    pub position: i32,
    pub permissions: Permissions,
    pub is_everyone: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: Uuid,
    pub server_id: Uuid,
    pub category_id: Option<Uuid>,
    pub name: String,
    pub channel_type: ChannelType,
    pub position: i32,
    pub topic: Option<String>,
    pub background_url: Option<String>,
    pub background_blur: f32,
    pub background_dim: f32,
    pub text_color: Option<String>,
    pub atmosphere: Option<String>,
    pub user_limit: i32,
    /// Seconds between messages from the same person (0 = off).
    #[serde(default)]
    pub slowmode_seconds: i32,
    /// Threads: the channel they were started in (None = normal channel).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_channel_id: Option<Uuid>,
    /// Threads: the message they were started from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_message_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionOverwrite {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub target_type: OverwriteTarget,
    pub target_id: Uuid,
    pub allow: Permissions,
    pub deny: Permissions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverwriteTarget {
    Role,
    Member,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerRule {
    pub id: Uuid,
    pub server_id: Uuid,
    pub title: String,
    pub body: String,
    pub position: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Uuid,
    pub content: String,
    pub reply_to_id: Option<Uuid>,
    pub edited_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub attachments: Vec<Attachment>,
    pub reactions: Vec<ReactionSummary>,
    /// When the message was pinned in its channel (None = not pinned).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned_at: Option<DateTime<Utc>>,
    /// Sent with "Forward" (a copy of another message).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub forwarded: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poll: Option<Poll>,
    /// A thread started from this message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread: Option<ThreadInfo>,
    /// A "find players" group card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lfg: Option<PlayerGroup>,
    /// Written by the app, not typed by a person ("member_join").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
}

/// A scheduled server event ("Friday 21h - CS2").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerEvent {
    pub id: Uuid,
    pub server_id: Uuid,
    pub creator_id: Uuid,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub starts_at: DateTime<Utc>,
    /// Voice channel to meet in, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<Uuid>,
    /// Who said they're going (in the order they said it).
    pub going: Vec<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// A video in a voice channel's "watch together" queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchItem {
    pub id: Uuid,
    /// YouTube video id (11 chars).
    pub video_id: String,
    pub title: String,
    pub added_by: Uuid,
}

/// What a voice channel is watching together.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WatchState {
    /// Up next, the current one first.
    pub queue: Vec<WatchItem>,
    /// The item playing now (the queue's first), if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<Uuid>,
    pub playing: bool,
    /// Seconds into the current video at `updated_at`.
    pub position: f64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerGroup {
    pub game: String,
    pub slots: u32,
    /// In join order (the creator first).
    pub members: Vec<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
    /// Set when it filled up.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Poll {
    pub question: String,
    /// More than one option can be picked.
    pub multi: bool,
    pub options: Vec<PollOption>,
    /// Options the viewer picked.
    #[serde(default)]
    pub my_votes: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollOption {
    pub id: Uuid,
    pub label: String,
    pub votes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadInfo {
    /// The thread's channel id.
    pub id: Uuid,
    pub name: String,
    pub message_count: u32,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: Uuid,
    pub message_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size: u64,
    pub url: String,
    /// Set when the file at `url` is encrypted (AES-256-GCM, base64url key).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enc_key: Option<String>,
    /// Temporary copy (Catbox was down): when it expires unless the server
    /// manages to move it to Catbox first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temporary_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReactionSummary {
    pub emoji: String,
    pub count: u32,
    pub me: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invite {
    pub code: String,
    pub server_id: Uuid,
    pub creator_id: Uuid,
    pub max_uses: Option<u32>,
    pub uses: u32,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerEmoji {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub image_url: String,
    pub animated: bool,
    pub creator_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Member {
    pub user: UserPublic,
    pub server_id: Uuid,
    pub nickname: Option<String>,
    pub role_ids: Vec<Uuid>,
    pub joined_at: DateTime<Utc>,
    pub accepted_rules: bool,
    /// When set and in the future, member cannot chat/react/join voice.
    #[serde(default)]
    pub timeout_until: Option<DateTime<Utc>>,
    #[serde(default)]
    pub timeout_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FriendshipStatus {
    Pending,
    Accepted,
    Declined,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Friendship {
    pub id: Uuid,
    pub status: FriendshipStatus,
    pub requested_by: Uuid,
    pub peer: UserPublic,
    pub muted: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendsList {
    pub friends: Vec<Friendship>,
    pub inbound: Vec<Friendship>,
    pub outbound: Vec<Friendship>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserIdentityKey {
    pub user_id: Uuid,
    pub public_key: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserIdentityKeyHistoryEntry {
    pub public_key: String,
    pub active_from: DateTime<Utc>,
    pub retired_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserIdentityKeyHistory {
    pub user_id: Uuid,
    pub current: Option<UserIdentityKey>,
    pub history: Vec<UserIdentityKeyHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmChannel {
    pub id: Uuid,
    pub friendship_id: Option<Uuid>,
    /// 1:1: the other person. Group: some other member (or the viewer if alone).
    pub peer: UserPublic,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub is_group: bool,
    /// Group name (None = show the member names).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_id: Option<Uuid>,
    /// Group members, the viewer included (empty for 1:1).
    #[serde(default)]
    pub members: Vec<UserPublic>,
}

/// A group message's content key, wrapped for one member with the pairwise
/// X25519 key (author private + member public).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmKeyEnvelope {
    pub user_id: Uuid,
    /// The member's public key the key was wrapped for.
    pub public_key: String,
    pub wrapped_key: String,
    pub nonce: String,
}

/// Wire format for E2E DMs — ciphertext only; plaintext never leaves the client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmMessage {
    pub id: Uuid,
    pub dm_channel_id: Uuid,
    pub author_id: Uuid,
    pub ciphertext: String,
    pub nonce: String,
    /// Author's X25519 public key at send time (for decrypt after key rotation).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sender_public_key: Option<String>,
    /// Recipient's X25519 public key at send time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipient_public_key: Option<String>,
    /// Group DMs only: the content key for each member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_envelopes: Option<Vec<DmKeyEnvelope>>,
    pub reply_to_id: Option<Uuid>,
    pub edited_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsEvent {
    Ready {
        user: UserPublic,
        servers: Vec<Server>,
    },
    MessageCreate {
        message: Message,
        author: UserPublic,
    },
    MessageUpdate {
        message: Message,
    },
    MessageDelete {
        channel_id: Uuid,
        message_id: Uuid,
    },
    TypingStart {
        channel_id: Uuid,
        user_id: Uuid,
        username: String,
    },
    PresenceUpdate {
        user_id: Uuid,
        status: PresenceStatus,
    },
    VoiceStateUpdate {
        channel_id: Option<Uuid>,
        user_id: Uuid,
        muted: bool,
        deafened: bool,
        streaming: bool,
        #[serde(default)]
        server_muted: bool,
        #[serde(default)]
        server_deafened: bool,
    },
    ChannelCreate {
        channel: Channel,
    },
    ChannelUpdate {
        channel: Channel,
    },
    ChannelDelete {
        server_id: Uuid,
        channel_id: Uuid,
    },
    ServerUpdate {
        server: Server,
    },
    MemberJoin {
        member: Member,
    },
    MemberUpdate {
        member: Member,
    },
    /// Friend was added to a server via Invite People — show invite card to invitee.
    ServerInvite {
        server: Server,
        invited_by: UserPublic,
        member_count: u32,
        online_count: u32,
    },
    /// Invited to a specific channel (often private) — show join-channel card.
    ChannelInvite {
        server: Server,
        channel: Channel,
        invited_by: UserPublic,
        member_count: u32,
        online_count: u32,
    },
    MemberLeave {
        server_id: Uuid,
        user_id: Uuid,
    },
    RoleCreate {
        role: Role,
    },
    RoleUpdate {
        role: Role,
    },
    RoleDelete {
        server_id: Uuid,
        role_id: Uuid,
    },
    /// Someone voted: new totals for everyone, `option_ids` = that person's votes.
    PollUpdate {
        channel_id: Uuid,
        message_id: Uuid,
        options: Vec<PollOption>,
        user_id: Uuid,
        option_ids: Vec<Uuid>,
    },
    ReactionAdd {
        channel_id: Uuid,
        message_id: Uuid,
        emoji: String,
        user_id: Uuid,
    },
    ReactionRemove {
        channel_id: Uuid,
        message_id: Uuid,
        emoji: String,
        user_id: Uuid,
    },
    FriendRequest {
        friendship: Friendship,
    },
    FriendUpdate {
        friendship: Friendship,
    },
    FriendRemoved {
        friendship_id: Uuid,
    },
    DmChannelCreate {
        channel: DmChannel,
    },
    /// You left or were removed from a group DM.
    DmChannelRemove {
        dm_channel_id: Uuid,
    },
    DmMessageCreate {
        message: DmMessage,
        author: UserPublic,
    },
    DmMessageUpdate {
        message: DmMessage,
    },
    DmMessageDelete {
        dm_channel_id: Uuid,
        message_id: Uuid,
    },
    DmTypingStart {
        dm_channel_id: Uuid,
        user_id: Uuid,
        username: String,
    },
    /// Someone read a DM up to `message_id` ("Seen").
    DmRead {
        dm_channel_id: Uuid,
        user_id: Uuid,
        message_id: Uuid,
        read_at: DateTime<Utc>,
    },
    /// A scheduled event was created or changed (incl. who's going).
    EventUpsert {
        event: ServerEvent,
    },
    EventDelete {
        server_id: Uuid,
        event_id: Uuid,
    },
    /// A voice channel's watch-together queue / playback changed.
    WatchUpdate {
        channel_id: Uuid,
        /// "watch" (video) or "listen" (audio only); each has its own queue.
        #[serde(default)]
        kind: String,
        state: WatchState,
    },
    /// Peer joined or left a private DM voice call.
    DmCallUpdate {
        dm_channel_id: Uuid,
        user_id: Uuid,
        active: bool,
        muted: bool,
        deafened: bool,
        streaming: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresenceStatus {
    Online,
    Idle,
    Dnd,
    Offline,
}

/// Resolve effective permissions for a member in a channel (Discord order).
///
/// 1. OR role permissions (including @everyone)
/// 2. Apply @everyone channel overwrite
/// 3. Batch other role overwrites (OR denies, OR allows, then apply — allows restore)
/// 4. Apply member overwrite
pub fn resolve_permissions(
    roles: &[Role],
    member_role_ids: &[Uuid],
    is_owner: bool,
    overwrites: &[PermissionOverwrite],
    member_id: Uuid,
) -> Permissions {
    if is_owner {
        return Permissions::all();
    }

    let mut perms = Permissions::empty();
    let mut sorted: Vec<&Role> = roles
        .iter()
        .filter(|r| r.is_everyone || member_role_ids.contains(&r.id))
        .collect();
    sorted.sort_by_key(|r| r.position);

    for role in &sorted {
        perms |= role.permissions;
    }

    if perms.contains(Permissions::ADMINISTRATOR) {
        return Permissions::all();
    }

    let everyone_id = roles.iter().find(|r| r.is_everyone).map(|r| r.id);

    if let Some(eid) = everyone_id {
        if let Some(ow) = overwrites.iter().find(|o| {
            o.target_type == OverwriteTarget::Role && o.target_id == eid
        }) {
            perms = (perms & !ow.deny) | ow.allow;
        }
    }

    let mut role_allow = Permissions::empty();
    let mut role_deny = Permissions::empty();
    for o in overwrites.iter().filter(|o| {
        o.target_type == OverwriteTarget::Role
            && Some(o.target_id) != everyone_id
            && member_role_ids.contains(&o.target_id)
    }) {
        role_allow |= o.allow;
        role_deny |= o.deny;
    }
    perms = (perms & !role_deny) | role_allow;

    if let Some(member_ow) = overwrites
        .iter()
        .find(|o| o.target_type == OverwriteTarget::Member && o.target_id == member_id)
    {
        perms = (perms & !member_ow.deny) | member_ow.allow;
    }

    perms
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_role_grants_all() {
        let everyone = Role {
            id: Uuid::new_v4(),
            server_id: Uuid::new_v4(),
            name: "@everyone".into(),
            color: "#fff".into(),
            gradient: None,
            position: 0,
            permissions: Permissions::EVERYONE_DEFAULT,
            is_everyone: true,
        };
        let admin = Role {
            id: Uuid::new_v4(),
            server_id: everyone.server_id,
            name: "Admin".into(),
            color: "#f00".into(),
            gradient: None,
            position: 1,
            permissions: Permissions::ADMINISTRATOR,
            is_everyone: false,
        };
        let member = Uuid::new_v4();
        let perms = resolve_permissions(
            &[everyone, admin.clone()],
            &[admin.id],
            false,
            &[],
            member,
        );
        assert!(perms.has(Permissions::BAN_MEMBERS));
    }

    #[test]
    fn deny_overwrite_wins() {
        let everyone_id = Uuid::new_v4();
        let everyone = Role {
            id: everyone_id,
            server_id: Uuid::new_v4(),
            name: "@everyone".into(),
            color: "#fff".into(),
            gradient: None,
            position: 0,
            permissions: Permissions::EVERYONE_DEFAULT,
            is_everyone: true,
        };
        let member = Uuid::new_v4();
        let ow = PermissionOverwrite {
            id: Uuid::new_v4(),
            channel_id: Uuid::new_v4(),
            target_type: OverwriteTarget::Role,
            target_id: everyone_id,
            allow: Permissions::empty(),
            deny: Permissions::SEND_MESSAGES,
        };
        let perms = resolve_permissions(&[everyone], &[everyone_id], false, &[ow], member);
        assert!(perms.has(Permissions::VIEW_CHANNEL));
        assert!(!perms.has(Permissions::SEND_MESSAGES));
    }

    #[test]
    fn role_allow_overrides_everyone_deny_view() {
        let server_id = Uuid::new_v4();
        let everyone_id = Uuid::new_v4();
        let staff_id = Uuid::new_v4();
        let everyone = Role {
            id: everyone_id,
            server_id,
            name: "@everyone".into(),
            color: "#fff".into(),
            gradient: None,
            position: 0,
            permissions: Permissions::EVERYONE_DEFAULT,
            is_everyone: true,
        };
        let staff = Role {
            id: staff_id,
            server_id,
            name: "Staff".into(),
            color: "#0f0".into(),
            gradient: None,
            position: 1,
            permissions: Permissions::EVERYONE_DEFAULT,
            is_everyone: false,
        };
        let channel_id = Uuid::new_v4();
        let overwrites = vec![
            PermissionOverwrite {
                id: Uuid::new_v4(),
                channel_id,
                target_type: OverwriteTarget::Role,
                target_id: everyone_id,
                allow: Permissions::empty(),
                deny: Permissions::VIEW_CHANNEL,
            },
            PermissionOverwrite {
                id: Uuid::new_v4(),
                channel_id,
                target_type: OverwriteTarget::Role,
                target_id: staff_id,
                allow: Permissions::VIEW_CHANNEL,
                deny: Permissions::empty(),
            },
        ];
        let staff_member = Uuid::new_v4();
        let staff_perms = resolve_permissions(
            &[everyone.clone(), staff.clone()],
            &[everyone_id, staff_id],
            false,
            &overwrites,
            staff_member,
        );
        assert!(staff_perms.has(Permissions::VIEW_CHANNEL));

        let regular = Uuid::new_v4();
        let regular_perms = resolve_permissions(
            &[everyone, staff],
            &[everyone_id],
            false,
            &overwrites,
            regular,
        );
        assert!(!regular_perms.has(Permissions::VIEW_CHANNEL));
    }
}
