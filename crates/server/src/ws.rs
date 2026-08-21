use crate::state::AppState;
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use speakapp_shared::{PresenceStatus, WsEvent};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use uuid::Uuid;

pub type ConnTx = mpsc::UnboundedSender<String>;

/// Grace period before clearing voice presence after the last WS drops.
/// Covers brief reconnects without leaving ghosts after a hard quit.
const VOICE_CLEAR_GRACE: Duration = Duration::from_secs(15);

#[derive(Clone, Default)]
pub struct WsHub {
    /// user_id -> connection senders (multi-device)
    inner: Arc<DashMap<Uuid, Vec<ConnTx>>>,
    /// server_id -> member user ids (cached loosely; also fanout via membership queries)
    server_members: Arc<DashMap<Uuid, Vec<Uuid>>>,
    /// Bumped on each new connection so delayed voice-clear tasks can cancel.
    presence_generation: Arc<DashMap<Uuid, u64>>,
}

impl WsHub {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, user_id: Uuid, tx: ConnTx) {
        // Invalidate any pending "left lobby" clear from a previous disconnect.
        self.bump_presence_generation(user_id);
        self.inner.entry(user_id).or_default().push(tx);
    }

    pub fn unregister(&self, user_id: Uuid, tx: &ConnTx) {
        if let Some(mut entry) = self.inner.get_mut(&user_id) {
            entry.retain(|t| !t.same_channel(tx));
        }
    }

    pub fn connection_count(&self, user_id: Uuid) -> usize {
        self.inner
            .get(&user_id)
            .map(|c| c.iter().filter(|t| !t.is_closed()).count())
            .unwrap_or(0)
    }

    pub fn is_online(&self, user_id: Uuid) -> bool {
        self.connection_count(user_id) > 0
    }

    /// Online user ids among the given candidates.
    pub fn online_among(&self, user_ids: &[Uuid]) -> Vec<Uuid> {
        user_ids
            .iter()
            .copied()
            .filter(|id| self.is_online(*id))
            .collect()
    }

    /// Fan out an event to every server the hub knows this user belongs to.
    pub fn broadcast_user_servers(&self, user_id: Uuid, event: &WsEvent) {
        for entry in self.server_members.iter() {
            if entry.value().contains(&user_id) {
                self.broadcast_server(*entry.key(), event);
            }
        }
    }

    fn bump_presence_generation(&self, user_id: Uuid) -> u64 {
        let mut entry = self.presence_generation.entry(user_id).or_insert(0);
        *entry += 1;
        *entry
    }

    fn presence_generation(&self, user_id: Uuid) -> u64 {
        self.presence_generation
            .get(&user_id)
            .map(|v| *v)
            .unwrap_or(0)
    }

    pub fn set_server_members(&self, server_id: Uuid, members: Vec<Uuid>) {
        self.server_members.insert(server_id, members);
    }

    pub fn add_server_member(&self, server_id: Uuid, user_id: Uuid) {
        self.server_members
            .entry(server_id)
            .or_default()
            .push(user_id);
    }

    pub fn remove_server_member(&self, server_id: Uuid, user_id: Uuid) {
        if let Some(mut m) = self.server_members.get_mut(&server_id) {
            m.retain(|id| *id != user_id);
        }
    }

    pub fn send_to_user(&self, user_id: Uuid, event: &WsEvent) {
        if let Ok(payload) = serde_json::to_string(event) {
            if let Some(conns) = self.inner.get(&user_id) {
                for tx in conns.iter() {
                    let _ = tx.send(payload.clone());
                }
            }
        }
    }

    pub fn broadcast_server(&self, server_id: Uuid, event: &WsEvent) {
        if let Ok(payload) = serde_json::to_string(event) {
            if let Some(members) = self.server_members.get(&server_id) {
                for user_id in members.iter() {
                    if let Some(conns) = self.inner.get(user_id) {
                        for tx in conns.iter() {
                            let _ = tx.send(payload.clone());
                        }
                    }
                }
            }
        }
    }

    pub fn broadcast_users(&self, user_ids: &[Uuid], event: &WsEvent) {
        if let Ok(payload) = serde_json::to_string(event) {
            for user_id in user_ids {
                if let Some(conns) = self.inner.get(user_id) {
                    for tx in conns.iter() {
                        let _ = tx.send(payload.clone());
                    }
                }
            }
        }
    }
}

pub async fn handle_socket(
    socket: axum::extract::ws::WebSocket,
    user_id: Uuid,
    state: AppState,
) {
    let hub = state.hub.clone();
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let was_offline = hub.connection_count(user_id) == 0;
    hub.register(user_id, tx.clone());
    if was_offline {
        hub.broadcast_user_servers(
            user_id,
            &WsEvent::PresenceUpdate {
                user_id,
                status: PresenceStatus::Online,
            },
        );
    }

    let write = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sender
                .send(axum::extract::ws::Message::Text(msg.into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            axum::extract::ws::Message::Text(text) => {
                // Client heartbeats / typing can be handled here later
                let _ = text;
            }
            axum::extract::ws::Message::Close(_) => break,
            _ => {}
        }
    }

    hub.unregister(user_id, &tx);
    write.abort();

    // Hard quit / crash leaves voice_states behind. After a short grace (reconnects),
    // clear lobby presence so others don't see a ghost.
    if hub.connection_count(user_id) == 0 {
        hub.broadcast_user_servers(
            user_id,
            &WsEvent::PresenceUpdate {
                user_id,
                status: PresenceStatus::Offline,
            },
        );
        let gen = hub.presence_generation(user_id);
        let state = state.clone();
        tokio::spawn(async move {
            tokio::time::sleep(VOICE_CLEAR_GRACE).await;
            if state.hub.connection_count(user_id) == 0
                && state.hub.presence_generation(user_id) == gen
            {
                crate::routes::voice::clear_stale_presence(&state, user_id).await;
            }
        });
    }
}
