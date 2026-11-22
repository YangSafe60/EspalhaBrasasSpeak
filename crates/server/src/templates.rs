//! Server templates: ready-made channels, roles and channel permissions,
//! picked when creating a server. Each template has a small-group version
//! and a bigger community version (more channels, staff roles, rules).

use speakapp_shared::Permissions as P;

/// Who a channel permission overwrite applies to.
#[derive(Clone, Copy)]
pub enum Target {
    Everyone,
    /// Index into `Template::roles`.
    Role(usize),
}

#[derive(Clone, Copy)]
pub struct Overwrite {
    pub target: Target,
    pub allow: P,
    pub deny: P,
}

pub struct RoleT {
    pub name: &'static str,
    pub color: &'static str,
    pub permissions: P,
}

pub struct ChannelT {
    pub name: &'static str,
    pub voice: bool,
    pub topic: Option<&'static str>,
    pub user_limit: i64,
    pub overwrites: Vec<Overwrite>,
}

pub struct CategoryT {
    pub name: &'static str,
    /// Applied to the category and to every channel in it.
    pub overwrites: Vec<Overwrite>,
    pub channels: Vec<ChannelT>,
}

pub struct Template {
    /// Highest role first (gets the highest position).
    pub roles: Vec<RoleT>,
    pub categories: Vec<CategoryT>,
    pub rules: Vec<(&'static str, &'static str)>,
}

// ---------------------------------------------------------------- helpers

fn text(name: &'static str, topic: &'static str) -> ChannelT {
    ChannelT { name, voice: false, topic: Some(topic), user_limit: 0, overwrites: vec![] }
}

fn voice(name: &'static str, user_limit: i64) -> ChannelT {
    ChannelT { name, voice: true, topic: None, user_limit, overwrites: vec![] }
}

impl ChannelT {
    fn with(mut self, overwrites: Vec<Overwrite>) -> Self {
        self.overwrites = overwrites;
        self
    }
}

fn cat(name: &'static str, channels: Vec<ChannelT>) -> CategoryT {
    CategoryT { name, overwrites: vec![], channels }
}

fn allow(target: Target, allow: P) -> Overwrite {
    Overwrite { target, allow, deny: P::empty() }
}

fn deny(target: Target, deny: P) -> Overwrite {
    Overwrite { target, allow: P::empty(), deny }
}

/// Everyone reads, only `posters` write (announcements, rules...).
fn read_only(posters: &[usize]) -> Vec<Overwrite> {
    let mut v = vec![deny(Target::Everyone, P::SEND_MESSAGES)];
    v.extend(posters.iter().map(|&r| allow(Target::Role(r), P::SEND_MESSAGES)));
    v
}

/// Hidden from everyone except `roles`.
fn private_to(roles: &[usize]) -> Vec<Overwrite> {
    let mut v = vec![deny(Target::Everyone, P::VIEW_CHANNEL)];
    v.extend(roles.iter().map(|&r| {
        allow(
            Target::Role(r),
            P::VIEW_CHANNEL | P::SEND_MESSAGES | P::CONNECT | P::SPEAK | P::STREAM,
        )
    }));
    v
}

/// Only `roles` may go live (screen share) here.
fn stream_only(roles: &[usize]) -> Vec<Overwrite> {
    let mut v = vec![deny(Target::Everyone, P::STREAM)];
    v.extend(roles.iter().map(|&r| allow(Target::Role(r), P::STREAM)));
    v
}

fn base() -> P {
    P::EVERYONE_DEFAULT
}

fn admin() -> RoleT {
    RoleT { name: "Admin", color: "#e31b23", permissions: base() | P::ADMINISTRATOR }
}

fn moderator() -> RoleT {
    RoleT {
        name: "Moderator",
        color: "#3b82f6",
        permissions: base()
            | P::MANAGE_MESSAGES
            | P::KICK_MEMBERS
            | P::BAN_MEMBERS
            | P::MUTE_MEMBERS
            | P::MOVE_MEMBERS
            | P::MENTION_EVERYONE
            | P::MANAGE_EXPRESSIONS,
    }
}

fn community_rules() -> Vec<(&'static str, &'static str)> {
    vec![
        ("Be respectful", "Treat everyone with respect. Harassment, hate speech and personal attacks are not allowed."),
        ("No spam", "No spam, flooding or unsolicited advertising, in channels or in DMs."),
        ("Keep it in the right channel", "Use each channel for its topic so conversations stay easy to follow."),
        ("Listen to the staff", "Moderators have the final word. If something is wrong, tell a moderator instead of escalating."),
    ]
}

fn friends_rules() -> Vec<(&'static str, &'static str)> {
    vec![("Be nice", "Have fun and look out for each other.")]
}

// ---------------------------------------------------------------- templates

#[cfg(test)]
pub const KEYS: [&str; 6] = ["gaming", "friends", "study", "school_club", "creators", "local_community"];

/// The template for `key`, small group or community version.
pub fn get(key: &str, community: bool) -> Option<Template> {
    Some(match (key, community) {
        ("gaming", false) => {
            // 0 = Streamer
            let roles = vec![RoleT { name: "Streamer", color: "#a855f7", permissions: base() }];
            Template {
                roles,
                categories: vec![
                    cat("Text Channels", vec![
                        text("general", "Talk about anything."),
                        text("clips-and-highlights", "Share your best plays."),
                        text("looking-for-group", "Find people to play with."),
                    ]),
                    cat("Voice Channels", vec![
                        voice("Lobby", 0),
                        voice("Gaming", 0),
                        voice("Stream Room", 0).with(stream_only(&[0])),
                    ]),
                ],
                rules: friends_rules(),
            }
        }
        ("gaming", true) => {
            // 0 = Admin, 1 = Moderator, 2 = Streamer
            let roles = vec![
                admin(),
                moderator(),
                RoleT { name: "Streamer", color: "#a855f7", permissions: base() },
            ];
            Template {
                roles,
                categories: vec![
                    cat("Information", vec![
                        text("welcome", "Start here.").with(read_only(&[0, 1])),
                        text("rules", "Read before posting.").with(read_only(&[0, 1])),
                        text("announcements", "News, events and updates.").with(read_only(&[0, 1])),
                    ]),
                    cat("Text Channels", vec![
                        text("general", "Talk about anything."),
                        text("clips-and-highlights", "Share your best plays."),
                        text("looking-for-group", "Find people to play with."),
                        text("memes", "Keep them coming."),
                    ]),
                    cat("Voice Channels", vec![
                        voice("Lobby", 0),
                        voice("Squad 1", 4),
                        voice("Squad 2", 4),
                        voice("Duo", 2),
                        voice("Stream Room", 0).with(stream_only(&[0, 1, 2])),
                    ]),
                    CategoryT {
                        name: "Staff",
                        overwrites: private_to(&[0, 1]),
                        channels: vec![text("staff-chat", "Moderation talk."), voice("Staff", 0)],
                    },
                ],
                rules: community_rules(),
            }
        }
        ("friends", false) => {
            // 0 = Close Friends
            let roles = vec![RoleT { name: "Close Friends", color: "#ec4899", permissions: base() }];
            Template {
                roles,
                categories: vec![
                    cat("Text Channels", vec![
                        text("general", "Talk about anything."),
                        text("plans", "What are we doing this weekend?"),
                        text("photos", "Pictures and memories."),
                        text("close-friends", "Just us.").with(private_to(&[0])),
                    ]),
                    cat("Voice Channels", vec![voice("Hangout", 0), voice("Gaming", 0)]),
                ],
                rules: friends_rules(),
            }
        }
        ("friends", true) => {
            // 0 = Admin, 1 = Moderator, 2 = Event Host
            let roles = vec![
                admin(),
                moderator(),
                RoleT { name: "Event Host", color: "#f59e0b", permissions: base() | P::MENTION_EVERYONE },
            ];
            Template {
                roles,
                categories: vec![
                    cat("Information", vec![
                        text("welcome", "Say hi!").with(read_only(&[0, 1])),
                        text("announcements", "News and events.").with(read_only(&[0, 1, 2])),
                    ]),
                    cat("Text Channels", vec![
                        text("general", "Talk about anything."),
                        text("introductions", "Tell us about yourself."),
                        text("plans", "Meetups and events."),
                        text("photos", "Pictures and memories."),
                        text("memes", "Keep them coming."),
                    ]),
                    cat("Voice Channels", vec![
                        voice("Hangout", 0),
                        voice("Gaming", 0),
                        voice("Movie Night", 0).with(stream_only(&[0, 1, 2])),
                    ]),
                    CategoryT {
                        name: "Staff",
                        overwrites: private_to(&[0, 1]),
                        channels: vec![text("staff-chat", "Moderation talk.")],
                    },
                ],
                rules: community_rules(),
            }
        }
        ("study", false) => {
            // 0 = Tutor: pins resources, may speak in the focus room.
            let roles = vec![RoleT { name: "Tutor", color: "#22c55e", permissions: base() }];
            let tutor_pins = vec![allow(Target::Role(0), P::MANAGE_MESSAGES)];
            Template {
                roles,
                categories: vec![
                    cat("Text Channels", vec![
                        text("general", "Talk about anything."),
                        text("homework-help", "Ask and answer questions.").with(tutor_pins.clone()),
                        text("notes-and-resources", "Notes, links and files.").with(tutor_pins),
                        text("study-sessions", "Plan the next session."),
                    ]),
                    cat("Voice Channels", vec![
                        voice("Study Room", 0),
                        voice("Focus Room", 0).with(vec![
                            deny(Target::Everyone, P::SPEAK),
                            allow(Target::Role(0), P::SPEAK),
                        ]),
                    ]),
                ],
                rules: friends_rules(),
            }
        }
        ("study", true) => {
            // 0 = Admin, 1 = Moderator, 2 = Tutor
            let roles = vec![
                admin(),
                moderator(),
                RoleT { name: "Tutor", color: "#22c55e", permissions: base() },
            ];
            let tutor_pins = vec![allow(Target::Role(2), P::MANAGE_MESSAGES)];
            Template {
                roles,
                categories: vec![
                    cat("Information", vec![
                        text("welcome", "Start here.").with(read_only(&[0, 1])),
                        text("announcements", "Schedules and news.").with(read_only(&[0, 1, 2])),
                    ]),
                    cat("Study", vec![
                        text("general", "Talk about anything."),
                        text("homework-help", "Ask and answer questions.").with(tutor_pins.clone()),
                        text("notes-and-resources", "Notes, links and files.").with(tutor_pins),
                        text("study-sessions", "Plan the next session."),
                    ]),
                    cat("Subjects", vec![
                        text("math", "Numbers and formulas."),
                        text("science", "Physics, chemistry, biology."),
                        text("languages", "Practice together."),
                    ]),
                    cat("Voice Channels", vec![
                        voice("Study Room 1", 6),
                        voice("Study Room 2", 6),
                        voice("Focus Room", 0).with(vec![
                            deny(Target::Everyone, P::SPEAK),
                            allow(Target::Role(2), P::SPEAK),
                        ]),
                        // Tutors present; everyone else listens.
                        voice("Lecture Hall", 0).with(vec![
                            deny(Target::Everyone, P::SPEAK | P::STREAM),
                            allow(Target::Role(0), P::SPEAK | P::STREAM),
                            allow(Target::Role(1), P::SPEAK | P::STREAM),
                            allow(Target::Role(2), P::SPEAK | P::STREAM),
                        ]),
                    ]),
                    CategoryT {
                        name: "Staff",
                        overwrites: private_to(&[0, 1, 2]),
                        channels: vec![text("staff-chat", "Tutors and moderators.")],
                    },
                ],
                rules: community_rules(),
            }
        }
        ("school_club", false) => {
            // 0 = Club Officer
            let roles = vec![RoleT {
                name: "Club Officer",
                color: "#0ea5e9",
                permissions: base() | P::MANAGE_MESSAGES | P::MENTION_EVERYONE,
            }];
            Template {
                roles,
                categories: vec![
                    cat("Text Channels", vec![
                        text("announcements", "Club news.").with(read_only(&[0])),
                        text("general", "Talk about anything."),
                        text("meeting-notes", "What we decided."),
                        text("events", "Upcoming events."),
                    ]),
                    cat("Voice Channels", vec![voice("Meeting Room", 0), voice("Hangout", 0)]),
                ],
                rules: friends_rules(),
            }
        }
        ("school_club", true) => {
            // 0 = President, 1 = Club Officer, 2 = Member
            let roles = vec![
                RoleT { name: "President", color: "#e31b23", permissions: base() | P::ADMINISTRATOR },
                RoleT {
                    name: "Club Officer",
                    color: "#0ea5e9",
                    permissions: base()
                        | P::MANAGE_MESSAGES
                        | P::MENTION_EVERYONE
                        | P::KICK_MEMBERS
                        | P::MUTE_MEMBERS
                        | P::MOVE_MEMBERS,
                },
                RoleT { name: "Member", color: "#99a1b3", permissions: base() },
            ];
            Template {
                roles,
                categories: vec![
                    cat("Information", vec![
                        text("welcome", "Start here.").with(read_only(&[0, 1])),
                        text("rules", "How the club works.").with(read_only(&[0, 1])),
                        text("announcements", "Club news.").with(read_only(&[0, 1])),
                    ]),
                    cat("Club", vec![
                        text("general", "Talk about anything."),
                        text("meeting-notes", "What we decided.").with(read_only(&[0, 1])),
                        text("events", "Upcoming events."),
                        text("ideas", "Suggest activities."),
                        // Members only: visitors see the public channels.
                        text("members-chat", "For club members.").with(private_to(&[0, 1, 2])),
                    ]),
                    cat("Voice Channels", vec![
                        voice("Meeting Room", 0),
                        voice("Workshop", 0).with(stream_only(&[0, 1])),
                        voice("Hangout", 0),
                    ]),
                    CategoryT {
                        name: "Officers",
                        overwrites: private_to(&[0, 1]),
                        channels: vec![text("officers-chat", "Planning."), voice("Officers", 0)],
                    },
                ],
                rules: community_rules(),
            }
        }
        ("creators", false) => {
            // 0 = Creator
            let roles = vec![RoleT { name: "Creator", color: "#f97316", permissions: base() }];
            Template {
                roles,
                categories: vec![
                    cat("Text Channels", vec![
                        text("general", "Talk about anything."),
                        text("show-your-work", "Post what you made."),
                        text("feedback", "Ask for honest feedback."),
                        text("inspiration", "Things worth seeing."),
                    ]),
                    cat("Voice Channels", vec![
                        voice("Creative Lounge", 0),
                        voice("Live Session", 0).with(stream_only(&[0])),
                    ]),
                ],
                rules: friends_rules(),
            }
        }
        ("creators", true) => {
            // 0 = Admin, 1 = Moderator, 2 = Creator
            let roles = vec![
                admin(),
                moderator(),
                RoleT { name: "Creator", color: "#f97316", permissions: base() },
            ];
            Template {
                roles,
                categories: vec![
                    cat("Information", vec![
                        text("welcome", "Start here.").with(read_only(&[0, 1])),
                        text("rules", "Read before posting.").with(read_only(&[0, 1])),
                        text("announcements", "News and updates.").with(read_only(&[0, 1])),
                    ]),
                    cat("Community", vec![
                        text("general", "Talk about anything."),
                        // Showcase: creators post, everyone comments elsewhere.
                        text("showcase", "Finished work from our creators.").with(read_only(&[0, 1, 2])),
                        text("work-in-progress", "Share what you're making."),
                        text("feedback", "Ask for honest feedback."),
                        text("collabs", "Find people to make things with."),
                        text("commissions", "Offer or request commissions."),
                    ]),
                    cat("Voice Channels", vec![
                        voice("Creative Lounge", 0),
                        voice("Live Session", 0).with(stream_only(&[0, 1, 2])),
                        voice("Critique Circle", 8),
                    ]),
                    CategoryT {
                        name: "Staff",
                        overwrites: private_to(&[0, 1]),
                        channels: vec![text("staff-chat", "Moderation talk.")],
                    },
                ],
                rules: community_rules(),
            }
        }
        ("local_community", false) => {
            // 0 = Organizer
            let roles = vec![RoleT {
                name: "Organizer",
                color: "#10b981",
                permissions: base() | P::MENTION_EVERYONE | P::MANAGE_MESSAGES,
            }];
            Template {
                roles,
                categories: vec![
                    cat("Text Channels", vec![
                        text("announcements", "Neighborhood news.").with(read_only(&[0])),
                        text("general", "Talk about anything."),
                        text("events", "What's happening nearby."),
                        text("marketplace", "Buy, sell, give away."),
                    ]),
                    cat("Voice Channels", vec![voice("Town Square", 0)]),
                ],
                rules: friends_rules(),
            }
        }
        ("local_community", true) => {
            // 0 = Admin, 1 = Moderator, 2 = Organizer
            let roles = vec![
                admin(),
                moderator(),
                RoleT { name: "Organizer", color: "#10b981", permissions: base() | P::MENTION_EVERYONE },
            ];
            Template {
                roles,
                categories: vec![
                    cat("Information", vec![
                        text("welcome", "Start here.").with(read_only(&[0, 1])),
                        text("rules", "Read before posting.").with(read_only(&[0, 1])),
                        text("announcements", "Neighborhood news.").with(read_only(&[0, 1, 2])),
                    ]),
                    cat("Community", vec![
                        text("general", "Talk about anything."),
                        text("introductions", "Say hi to your neighbors."),
                        text("events", "What's happening nearby.").with(read_only(&[0, 1, 2])),
                        text("local-news", "News from the area."),
                        text("recommendations", "Best places, services and tips."),
                        text("marketplace", "Buy, sell, give away."),
                    ]),
                    cat("Voice Channels", vec![voice("Town Square", 0), voice("Meetup Planning", 10)]),
                    CategoryT {
                        name: "Staff",
                        overwrites: private_to(&[0, 1]),
                        channels: vec![text("staff-chat", "Moderation talk.")],
                    },
                ],
                rules: community_rules(),
            }
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_template_is_valid() {
        for key in KEYS {
            for community in [false, true] {
                let t = get(key, community).unwrap_or_else(|| panic!("{key}"));
                assert!(!t.roles.is_empty(), "{key}: roles");
                let mut names = std::collections::HashSet::new();
                for c in &t.categories {
                    let mut all = c.overwrites.clone();
                    for ch in &c.channels {
                        assert!(names.insert(ch.name), "{key}: duplicate channel {}", ch.name);
                        all.extend(ch.overwrites.iter().copied());
                    }
                    for o in all {
                        if let Target::Role(i) = o.target {
                            assert!(i < t.roles.len(), "{key}: role index {i}");
                        }
                    }
                }
                // Community versions are bigger than the small ones.
                if community {
                    let small = get(key, false).unwrap();
                    let n = |t: &Template| t.categories.iter().map(|c| c.channels.len()).sum::<usize>();
                    assert!(n(&t) > n(&small), "{key}: community should have more channels");
                }
            }
        }
        assert!(get("nope", false).is_none());
    }
}
