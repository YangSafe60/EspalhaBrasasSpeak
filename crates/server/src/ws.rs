use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use speakapp_shared::WsEvent;
use std::sync::Arc;
use tokio::sync::mpsc;
use uuid::Uuid;

pub type ConnTx = mpsc::UnboundedSender<String>;

#[derive(Clone, Default)]
pub struct WsHub {
    /// user_id -> connection senders (multi-device)
    inner: Arc<DashMap<Uuid, Vec<ConnTx>>>,
    /// server_id -> member user ids (cached loosely; also fanout via membership queries)
    server_members: Arc<DashMap<Uuid, Vec<Uuid>>>,
}

impl WsHub {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, user_id: Uuid, tx: ConnTx) {
        self.inner.entry(user_id).or_default().push(tx);
    }

    pub fn unregister(&self, user_id: Uuid, tx: &ConnTx) {
        if let Some(mut entry) = self.inner.get_mut(&user_id) {
            entry.retain(|t| !t.same_channel(tx));
        }
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

    #[allow(dead_code)]
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

    #[allow(dead_code)]
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
    hub: WsHub,
) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    hub.register(user_id, tx.clone());

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
}
