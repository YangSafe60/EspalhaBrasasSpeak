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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: Uuid,
    pub message_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size: u64,
    pub url: String,
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
pub struct Member {
    pub user: UserPublic,
    pub server_id: Uuid,
    pub nickname: Option<String>,
    pub role_ids: Vec<Uuid>,
    pub joined_at: DateTime<Utc>,
    pub accepted_rules: bool,
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
    MemberLeave {
        server_id: Uuid,
        user_id: Uuid,
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresenceStatus {
    Online,
    Idle,
    Dnd,
    Offline,
}

/// Resolve effective permissions for a member in a channel.
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

    let mut base = Permissions::empty();
    let mut sorted: Vec<&Role> = roles
        .iter()
        .filter(|r| r.is_everyone || member_role_ids.contains(&r.id))
        .collect();
    sorted.sort_by_key(|r| r.position);

    for role in sorted {
        base |= role.permissions;
    }

    if base.contains(Permissions::ADMINISTRATOR) {
        return Permissions::all();
    }

    let mut allow = Permissions::empty();
    let mut deny = Permissions::empty();

    let mut role_ows: Vec<&PermissionOverwrite> = overwrites
        .iter()
        .filter(|o| {
            o.target_type == OverwriteTarget::Role
                && (member_role_ids.contains(&o.target_id)
                    || roles.iter().any(|r| r.is_everyone && r.id == o.target_id))
        })
        .collect();
    role_ows.sort_by_key(|o| {
        roles
            .iter()
            .find(|r| r.id == o.target_id)
            .map(|r| r.position)
            .unwrap_or(0)
    });

    for o in role_ows {
        allow |= o.allow;
        deny |= o.deny;
        allow &= !o.deny;
    }

    if let Some(member_ow) = overwrites
        .iter()
        .find(|o| o.target_type == OverwriteTarget::Member && o.target_id == member_id)
    {
        allow |= member_ow.allow;
        deny |= member_ow.deny;
        allow &= !member_ow.deny;
    }

    (base | allow) & !deny
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
}
