//! Server audit log: who did which moderation action, and when.
//!
//! Recorded by one middleware instead of in every handler: before a
//! moderation request runs it notes the server (and details that a delete
//! would erase, like a channel's name); after a successful response it writes
//! the entry. Only `GET /api/servers/{id}/audit-log` reads it.

use crate::auth::{decode_token, AuthUser};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    body::{to_bytes, Body},
    extract::{Path, Query, Request, State},
    http::{header, Method},
    middleware::Next,
    response::Response,
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use speakapp_shared::{Permissions, UserPublic};
use uuid::Uuid;

/// What a request is, if it's an audited action.
struct Pending {
    server_id: Uuid,
    action: &'static str,
    target_id: Option<String>,
    details: Value,
}

fn uuid_at(parts: &[&str], i: usize) -> Option<Uuid> {
    parts.get(i).and_then(|p| Uuid::parse_str(p).ok())
}

async fn channel_info(state: &AppState, id: Uuid) -> Option<(Uuid, String)> {
    let ch = db::get_channel(&state.db, id).await.ok()?;
    Some((ch.server_id, ch.name))
}

/// Recognise the audited routes; resolves the server before the handler runs.
async fn classify(state: &AppState, method: &Method, path: &str, body: &Value, actor: Uuid) -> Option<Pending> {
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    // ["api", "servers", "{id}", ...] or ["api", "channels"|"messages", "{id}", ...]
    if parts.len() < 3 || parts[0] != "api" {
        return None;
    }
    let p = |server_id, action, target_id: Option<String>, details| {
        Some(Pending { server_id, action, target_id, details })
    };
    match parts[1] {
        "servers" => {
            let sid = uuid_at(&parts, 2)?;
            let rest = &parts[3..];
            match (method.as_str(), rest) {
                ("PATCH", []) => p(sid, "server_update", None, body.clone()),
                ("POST", ["transfer-ownership"]) => p(sid, "ownership_transfer", body.get("new_owner_id").and_then(|v| v.as_str()).map(String::from), json!({})),
                ("DELETE", ["members", uid]) if Uuid::parse_str(uid).ok() != Some(actor) => {
                    p(sid, "member_kick", Some(uid.to_string()), json!({}))
                }
                ("PUT", ["members", uid, "voice"]) => p(sid, "member_voice", Some(uid.to_string()), body.clone()),
                ("PUT", ["members", uid, "timeout"]) => p(sid, "member_timeout", Some(uid.to_string()), body.clone()),
                ("PUT", ["members", uid, "roles"]) => p(sid, "member_roles", Some(uid.to_string()), body.clone()),
                ("POST", ["bans"]) => p(
                    sid,
                    "member_ban",
                    body.get("user_id").and_then(|v| v.as_str()).map(String::from),
                    json!({ "reason": body.get("reason") }),
                ),
                ("DELETE", ["bans", uid]) => p(sid, "member_unban", Some(uid.to_string()), json!({})),
                ("DELETE", ["invites", code]) => p(sid, "invite_delete", Some(code.to_string()), json!({})),
                ("POST", ["roles"]) => p(sid, "role_create", None, json!({ "name": body.get("name") })),
                ("PATCH", ["roles", rid]) | ("DELETE", ["roles", rid]) => {
                    // Looked up before a delete removes it.
                    let roles = db::server_roles(&state.db, sid).await.ok().unwrap_or_default();
                    let role_name = roles.iter().find(|r| r.id.to_string() == *rid).map(|r| r.name.clone());
                    let action = if method == Method::DELETE { "role_delete" } else { "role_update" };
                    p(sid, action, Some(rid.to_string()), json!({ "name": role_name, "changes": body }))
                }
                ("PUT", ["rules"]) => p(sid, "rules_update", None, json!({})),
                ("PUT", ["automod"]) => p(sid, "automod_update", None, json!({ "count": body.get("words").and_then(|w| w.as_array()).map(|a| a.len()) })),
                ("POST", ["channels"]) => p(sid, "channel_create", None, json!({ "name": body.get("name"), "type": body.get("channel_type") })),
                _ => None,
            }
        }
        "channels" => {
            let cid = uuid_at(&parts, 2)?;
            let rest = &parts[3..];
            let action = match (method.as_str(), rest) {
                ("PATCH", []) => "channel_update",
                ("DELETE", []) => "channel_delete",
                ("POST", ["duplicate"]) => "channel_duplicate",
                ("PUT", ["overwrites"]) => "channel_permissions",
                _ => return None,
            };
            let (sid, name) = channel_info(state, cid).await?;
            let details = if action == "channel_update" { json!({ "name": name, "changes": body }) } else { json!({ "name": name }) };
            p(sid, action, Some(cid.to_string()), details)
        }
        "messages" => {
            let mid = uuid_at(&parts, 2)?;
            let rest = &parts[3..];
            let action = match (method.as_str(), rest) {
                ("DELETE", []) => "message_delete",
                ("PUT", ["pin"]) => "message_pin",
                ("DELETE", ["pin"]) => "message_unpin",
                _ => return None,
            };
            let row: Option<(String, String, String)> = sqlx::query_as(
                "SELECT author_id, channel_id, substr(content, 1, 120) FROM messages WHERE id = ?",
            )
            .bind(mid.to_string())
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
            let (author, channel_id, preview) = row?;
            // Deleting your own message isn't a moderation action.
            if action == "message_delete" && Uuid::parse_str(&author).ok() == Some(actor) {
                return None;
            }
            let (sid, channel_name) = channel_info(state, Uuid::parse_str(&channel_id).ok()?).await?;
            p(sid, action, Some(author), json!({ "channel": channel_name, "preview": preview }))
        }
        _ => None,
    }
}

/// Middleware: writes an audit entry after successful moderation requests.
pub async fn layer(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let method = req.method().clone();
    if method == Method::GET || method == Method::HEAD || method == Method::OPTIONS {
        return next.run(req).await;
    }
    let path = req.uri().path().to_string();
    let quick_match = path.starts_with("/api/servers/") || path.starts_with("/api/channels/") || path.starts_with("/api/messages/");
    let actor = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .and_then(|t| decode_token(t, &state.config.jwt_secret).ok())
        .map(|c| c.sub);
    let (Some(actor), true) = (actor, quick_match) else {
        return next.run(req).await;
    };

    // Only JSON bodies are read (and put back); uploads pass through untouched.
    let is_json = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("application/json"));
    let (pending, res) = if is_json {
        let (parts, body) = req.into_parts();
        let bytes = match to_bytes(body, 1024 * 1024).await {
            Ok(b) => b,
            Err(_) => return Response::builder().status(413).body(Body::empty()).unwrap(),
        };
        let json_body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        let pending = classify(&state, &method, &path, &json_body, actor).await;
        (pending, next.run(Request::from_parts(parts, Body::from(bytes))).await)
    } else {
        let pending = classify(&state, &method, &path, &Value::Null, actor).await;
        (pending, next.run(req).await)
    };

    if let Some(p) = pending {
        if res.status().is_success() {
            let _ = sqlx::query(
                "INSERT INTO audit_log (id, server_id, actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(p.server_id.to_string())
            .bind(actor.to_string())
            .bind(p.action)
            .bind(p.target_id)
            .bind(p.details.to_string())
            .bind(Utc::now().to_rfc3339())
            .execute(&state.db)
            .await;
            // Keep 90 days.
            if rand_bool(50) {
                let cutoff = (Utc::now() - chrono::Duration::days(90)).to_rfc3339();
                let _ = sqlx::query("DELETE FROM audit_log WHERE created_at < ?")
                    .bind(cutoff)
                    .execute(&state.db)
                    .await;
            }
        }
    }
    res
}

/// True about once every `n` calls.
fn rand_bool(n: u32) -> bool {
    Uuid::new_v4().as_u128() % n as u128 == 0
}

#[derive(Deserialize)]
pub struct AuditQuery {
    pub before: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Serialize)]
pub struct AuditEntry {
    pub id: Uuid,
    pub actor: Option<UserPublic>,
    pub action: String,
    pub target_id: Option<String>,
    pub details: Value,
    pub created_at: String,
}

/// Newest first; `before` = a `created_at` to page back from.
pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Query(q): Query<AuditQuery>,
) -> AppResult<Json<Vec<AuditEntry>>> {
    let server = db::get_server(&state.db, id).await?;
    db::require_perm(&state.db, &server, None, user.id, Permissions::MANAGE_SERVER).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 100);
    let rows: Vec<(String, String, String, Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT id, actor_id, action, target_id, details, created_at FROM audit_log
         WHERE server_id = ? AND created_at < COALESCE(?, '9999') ORDER BY created_at DESC LIMIT ?",
    )
    .bind(id.to_string())
    .bind(q.before)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for (eid, actor, action, target_id, details, created_at) in rows {
        let actor = match Uuid::parse_str(&actor) {
            Ok(a) => db::user_public(&state.db, a).await.ok(),
            Err(_) => None,
        };
        out.push(AuditEntry {
            id: Uuid::parse_str(&eid).map_err(|_| AppError::NotFound)?,
            actor,
            action,
            target_id,
            details: details.and_then(|d| serde_json::from_str(&d).ok()).unwrap_or(Value::Null),
            created_at,
        });
    }
    Ok(Json(out))
}
