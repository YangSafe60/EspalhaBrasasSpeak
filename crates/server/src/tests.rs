//! Router-level integration tests: the real Axum app on an in-memory SQLite
//! database, driven with `tower::ServiceExt::oneshot`.

use crate::config::Config;
use crate::routes;
use crate::state::AppState;
use axum::{
    body::Body,
    http::{header, HeaderMap, Method, Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;
use uuid::Uuid;

struct TestApp {
    router: Router,
    state: AppState,
}

struct Resp {
    status: StatusCode,
    headers: HeaderMap,
    body: Value,
}

async fn test_app() -> TestApp {
    let media_dir = std::env::temp_dir().join(format!("speakapp-test-{}", Uuid::new_v4()));
    let config = Config {
        bind: "127.0.0.1:0".into(),
        database_url: "sqlite::memory:".into(),
        jwt_secret: "test-secret-that-is-at-least-32-characters-long".into(),
        media_dir,
        public_url: "http://localhost:8080".into(),
        livekit_url: "ws://127.0.0.1:7880".into(),
        livekit_api_key: "devkey".into(),
        livekit_api_secret: "test-livekit-secret-at-least-32-characters".into(),
        max_upload_bytes: 25 * 1024 * 1024,
        imgbb_api_key: None,
        klipy_api_key: None,
    };
    let state = AppState::new(config).await.expect("state");
    TestApp {
        router: routes::router(state.clone()),
        state,
    }
}

impl TestApp {
    async fn call(
        &self,
        method: Method,
        path: &str,
        auth: Option<&str>,
        body: Option<Value>,
    ) -> Resp {
        let mut req = Request::builder().method(method).uri(path);
        if let Some(auth) = auth {
            req = req.header(header::AUTHORIZATION, auth);
        }
        let req = match body {
            Some(b) => req
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(serde_json::to_vec(&b).unwrap())),
            None => req.body(Body::empty()),
        }
        .unwrap();
        self.send(req).await
    }

    async fn send(&self, req: Request<Body>) -> Resp {
        let res = self.router.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let headers = res.headers().clone();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        Resp {
            status,
            headers,
            body,
        }
    }

    /// Registers a user and returns its `Bearer` header value.
    async fn register(&self, username: &str) -> String {
        let r = self
            .call(
                Method::POST,
                "/api/auth/register",
                None,
                Some(json!({
                    "username": username,
                    "email": format!("{username}@example.com"),
                    "password": "correct horse battery",
                })),
            )
            .await;
        assert_eq!(r.status, StatusCode::OK, "register: {}", r.body);
        format!("Bearer {}", r.body["access_token"].as_str().unwrap())
    }

    /// Creates a server and returns (server id, first text channel id).
    async fn server_with_text_channel(&self, auth: &str) -> (String, String) {
        let s = self
            .call(
                Method::POST,
                "/api/servers",
                Some(auth),
                Some(json!({ "name": "Test" })),
            )
            .await;
        assert_eq!(s.status, StatusCode::OK, "create server: {}", s.body);
        let server_id = s.body["id"].as_str().unwrap().to_string();
        let c = self
            .call(
                Method::GET,
                &format!("/api/servers/{server_id}/channels"),
                Some(auth),
                None,
            )
            .await;
        let channel_id = c
            .body
            .as_array()
            .unwrap()
            .iter()
            .find(|ch| ch["channel_type"] == "text")
            .expect("default text channel")["id"]
            .as_str()
            .unwrap()
            .to_string();
        (server_id, channel_id)
    }

    async fn count(&self, sql: &str, bind: &str) -> i64 {
        sqlx::query_scalar(sql)
            .bind(bind)
            .fetch_one(&self.state.db)
            .await
            .unwrap()
    }
}

#[tokio::test]
async fn repeated_login_gets_429_with_retry_after() {
    let app = test_app().await;
    app.register("alice").await;
    let body = json!({ "login": "alice", "password": "wrong password" });
    for _ in 0..5 {
        let r = app
            .call(Method::POST, "/api/auth/login", None, Some(body.clone()))
            .await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    }
    let r = app
        .call(Method::POST, "/api/auth/login", None, Some(body))
        .await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);
    let retry: u64 = r.headers[header::RETRY_AFTER]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!((1..=60).contains(&retry), "retry-after {retry}");
}

#[tokio::test]
async fn register_rejects_bad_fields() {
    let app = test_app().await;
    for (username, email, display) in [
        ("bad name", "a@example.com", "ok"),
        ("ok_name", "not-an-email", "ok"),
        ("ok_name", "a@localhost", "ok"),
        ("ok_name", "a@example.com", "bell\u{7}"),
        ("ok_name", "a@example.com", &"x".repeat(33)),
    ] {
        let r = app
            .call(
                Method::POST,
                "/api/auth/register",
                None,
                Some(json!({
                    "username": username,
                    "email": email,
                    "display_name": display,
                    "password": "correct horse battery",
                })),
            )
            .await;
        assert_eq!(
            r.status,
            StatusCode::BAD_REQUEST,
            "{username} {email} {display}"
        );
    }
    // Rejected attempts don't use up the registration quota.
    app.register("valid.name-1").await;
}

#[tokio::test]
async fn too_long_message_is_400() {
    let app = test_app().await;
    let auth = app.register("alice").await;
    let (_, channel) = app.server_with_text_channel(&auth).await;
    let path = format!("/api/channels/{channel}/messages");

    let r = app
        .call(
            Method::POST,
            &path,
            Some(&auth),
            Some(json!({ "content": "é".repeat(4001) })),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);

    // Exactly at the limit (counted in characters, not bytes) is fine.
    let r = app
        .call(
            Method::POST,
            &path,
            Some(&auth),
            Some(json!({ "content": "é".repeat(4000) })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);

    // Edits are capped too.
    let id = r.body["id"].as_str().unwrap();
    let r = app
        .call(
            Method::PATCH,
            &format!("/api/messages/{id}"),
            Some(&auth),
            Some(json!({ "content": "x".repeat(4001) })),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn message_flood_gets_429() {
    let app = test_app().await;
    let auth = app.register("alice").await;
    let (_, channel) = app.server_with_text_channel(&auth).await;
    let path = format!("/api/channels/{channel}/messages");
    for i in 0..10 {
        let r = app
            .call(
                Method::POST,
                &path,
                Some(&auth),
                Some(json!({ "content": format!("m{i}") })),
            )
            .await;
        assert_eq!(r.status, StatusCode::OK);
    }
    let r = app
        .call(
            Method::POST,
            &path,
            Some(&auth),
            Some(json!({ "content": "one too many" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(r.headers.contains_key(header::RETRY_AFTER));
}

#[tokio::test]
async fn non_member_cannot_read_or_post_is_403() {
    let app = test_app().await;
    let alice = app.register("alice").await;
    let mallory = app.register("mallory").await;
    let (_, channel) = app.server_with_text_channel(&alice).await;

    let path = format!("/api/channels/{channel}/messages");
    let r = app.call(Method::GET, &path, Some(&mallory), None).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let r = app
        .call(
            Method::POST,
            &path,
            Some(&mallory),
            Some(json!({ "content": "hi" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(
        app.count(
            "SELECT COUNT(1) FROM messages WHERE channel_id = ?",
            &channel
        )
        .await,
        0
    );
}

#[tokio::test]
async fn invalid_attachment_leaves_no_message() {
    let app = test_app().await;
    let alice = app.register("alice").await;
    let bob = app.register("bob").await;
    let (_, channel) = app.server_with_text_channel(&alice).await;

    let upload = |auth: String| {
        let app = &app;
        async move {
            let r = app
                .call(
                    Method::POST,
                    "/api/media/remote",
                    Some(&auth),
                    Some(json!({
                        "url": format!("https://files.catbox.moe/{}.png", Uuid::new_v4().simple()),
                        "content_type": "image/png",
                        "size": 10,
                    })),
                )
                .await;
            assert_eq!(r.status, StatusCode::OK, "{}", r.body);
            r.body["id"].as_str().unwrap().to_string()
        }
    };
    let own = upload(alice.clone()).await;
    let foreign = upload(bob.clone()).await;

    let path = format!("/api/channels/{channel}/messages");
    for ids in [
        vec![own.clone(), foreign.clone()],
        vec![own.clone(), Uuid::new_v4().to_string()],
    ] {
        let r = app
            .call(
                Method::POST,
                &path,
                Some(&alice),
                Some(json!({ "content": "with files", "attachment_ids": ids })),
            )
            .await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{}", r.body);
    }
    assert_eq!(
        app.count(
            "SELECT COUNT(1) FROM messages WHERE channel_id = ?",
            &channel
        )
        .await,
        0
    );
    // The valid upload was not claimed by the failed message.
    assert_eq!(
        app.count(
            "SELECT COUNT(1) FROM attachments WHERE id = ? AND message_id IS NULL",
            &own
        )
        .await,
        1
    );

    // And it still works on its own.
    let r = app
        .call(
            Method::POST,
            &path,
            Some(&alice),
            Some(json!({ "content": "ok", "attachment_ids": [own, own] })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["attachments"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn json_body_over_1mb_is_rejected_but_upload_route_allows_more() {
    let app = test_app().await;
    let auth = app.register("alice").await;
    let (_, channel) = app.server_with_text_channel(&auth).await;
    let r = app
        .call(
            Method::POST,
            &format!("/api/channels/{channel}/messages"),
            Some(&auth),
            Some(json!({ "content": "x".repeat(1024 * 1024 + 1) })),
        )
        .await;
    assert_eq!(r.status, StatusCode::PAYLOAD_TOO_LARGE);

    // A 2 MB image passes the body limit and only fails because ImgBB is not
    // configured in tests.
    let boundary = "XBOUNDARYX";
    let mut body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\r\nContent-Type: image/png\r\n\r\n"
    )
    .into_bytes();
    body.extend(std::iter::repeat_n(0u8, 2 * 1024 * 1024));
    body.extend(format!("\r\n--{boundary}--\r\n").into_bytes());
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/media/upload")
        .header(header::AUTHORIZATION, &auth)
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();
    let r = app.send(req).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    assert!(r.body["error"].as_str().unwrap().contains("IMGBB_API_KEY"));
}

#[tokio::test]
async fn batched_channel_viewers_match_per_member_permissions() {
    use speakapp_shared::Permissions;

    let app = test_app().await;
    let alice = app.register("alice").await;
    let bob = app.register("bob").await;
    let (server_id, channel) = app.server_with_text_channel(&alice).await;
    let inv = app
        .call(
            Method::POST,
            &format!("/api/servers/{server_id}/invites"),
            Some(&alice),
            Some(json!({})),
        )
        .await;
    assert_eq!(inv.status, StatusCode::OK, "{}", inv.body);
    let code = inv.body["code"].as_str().unwrap();
    let r = app
        .call(
            Method::POST,
            &format!("/api/invites/{code}"),
            Some(&bob),
            Some(json!({})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);

    let db = &app.state.db;
    let server = crate::db::get_server(db, Uuid::parse_str(&server_id).unwrap())
        .await
        .unwrap();
    let channel_id = Uuid::parse_str(&channel).unwrap();
    let bob_id: String = sqlx::query_scalar("SELECT id FROM users WHERE username = 'bob'")
        .fetch_one(db)
        .await
        .unwrap();

    let server = &server;
    let check = |expected_viewers: usize| async move {
        let batched =
            crate::db::members_with_channel_perm(db, server, channel_id, Permissions::VIEW_CHANNEL)
                .await
                .unwrap();
        let mut one_by_one = Vec::new();
        for uid in crate::db::server_member_ids(db, server.id).await.unwrap() {
            if crate::db::effective_permissions(db, server, Some(channel_id), uid)
                .await
                .unwrap()
                .has(Permissions::VIEW_CHANNEL)
            {
                one_by_one.push(uid);
            }
        }
        assert_eq!(batched, one_by_one);
        assert_eq!(batched.len(), expected_viewers);
    };

    check(2).await;
    // Hide the channel from bob with a member overwrite.
    sqlx::query(
        "INSERT INTO permission_overwrites (id, channel_id, target_type, target_id, allow_bits, deny_bits) VALUES (?, ?, 'member', ?, 0, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&channel)
    .bind(&bob_id)
    .bind(Permissions::VIEW_CHANNEL.bits() as i64)
    .execute(db)
    .await
    .unwrap();
    check(1).await;
}

#[tokio::test]
async fn memory_samples_are_stored_per_user_and_rate_limited() {
    let app = test_app().await;
    let alice = app.register("alice").await;
    let bob = app.register("bob").await;
    let sample = json!({
        "total_mb": 612,
        "app_version": "1.2.3",
        "processes": [
            { "kind": "Browser", "label": "", "mb": 98 },
            { "kind": "Tab", "label": "voice-host", "mb": 180 },
        ],
    });
    let path = "/api/diagnostics/memory";
    for _ in 0..2 {
        let r = app.call(Method::POST, path, Some(&alice), Some(sample.clone())).await;
        assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    }
    let r = app.call(Method::POST, path, Some(&alice), Some(sample.clone())).await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);

    let r = app
        .call(Method::POST, path, Some(&alice), Some(json!({ "total_mb": 1, "processes": [] })))
        .await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);

    let mine = app.call(Method::GET, path, Some(&alice), None).await;
    assert_eq!(mine.status, StatusCode::OK);
    let list = mine.body.as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["total_mb"], 612);
    assert_eq!(list[0]["processes"][1]["label"], "voice-host");

    // Other users never see them.
    let theirs = app.call(Method::GET, path, Some(&bob), None).await;
    assert_eq!(theirs.body.as_array().unwrap().len(), 0);
    let r = app
        .call(Method::POST, path, Some(&bob), Some(json!({ "total_mb": 1, "processes": [] })))
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    let r = app.call(Method::DELETE, path, Some(&alice), None).await;
    assert_eq!(r.body["deleted"], 2);
    let mine = app.call(Method::GET, path, Some(&alice), None).await;
    assert_eq!(mine.body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn websocket_takes_token_from_subprotocol_only() {
    use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue};

    let app = test_app().await;
    let auth = app.register("alice").await;
    let token = auth.trim_start_matches("Bearer ").to_string();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app.router.clone();
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });

    // Token in Sec-WebSocket-Protocol: accepted, protocol echoed back.
    let mut req = format!("ws://{addr}/api/ws").into_client_request().unwrap();
    req.headers_mut().insert(
        "sec-websocket-protocol",
        HeaderValue::from_str(&format!("speakapp.auth, {token}")).unwrap(),
    );
    let (_ws, res) = tokio_tungstenite::connect_async(req).await.expect("subprotocol auth");
    assert_eq!(
        res.headers().get("sec-websocket-protocol").unwrap(),
        "speakapp.auth"
    );

    // A token in the URL is no longer accepted (it would end up in logs).
    let legacy = format!("ws://{addr}/api/ws?token={token}");
    assert!(tokio_tungstenite::connect_async(legacy).await.is_err());

    // No token, or a bad one: refused.
    assert!(tokio_tungstenite::connect_async(format!("ws://{addr}/api/ws")).await.is_err());
    let mut bad = format!("ws://{addr}/api/ws").into_client_request().unwrap();
    bad.headers_mut().insert(
        "sec-websocket-protocol",
        HeaderValue::from_static("speakapp.auth, not-a-token"),
    );
    assert!(tokio_tungstenite::connect_async(bad).await.is_err());
}

#[tokio::test]
async fn login_takes_as_long_for_unknown_accounts() {
    let app = test_app().await;
    app.register("alice").await;
    let time = |login: &'static str| {
        let app = &app;
        async move {
            let t = std::time::Instant::now();
            let r = app
                .call(
                    Method::POST,
                    "/api/auth/login",
                    None,
                    Some(json!({ "login": login, "password": "wrong password!" })),
                )
                .await;
            assert_eq!(r.status, StatusCode::UNAUTHORIZED);
            t.elapsed()
        }
    };
    // Warm the dummy hash, then compare (limit is 5/min per IP, so 4 calls).
    time("nobody").await;
    let known = time("alice").await;
    let unknown = time("nobody").await;
    let ratio = unknown.as_secs_f64() / known.as_secs_f64();
    assert!(
        (0.5..2.0).contains(&ratio),
        "unknown {unknown:?} vs known {known:?}"
    );
}

#[tokio::test]
async fn moderators_delete_but_never_edit_others_messages() {
    let app = test_app().await;
    let owner = app.register("owner").await;
    let member = app.register("member").await;
    let (server_id, channel) = app.server_with_text_channel(&owner).await;
    let inv = app
        .call(
            Method::POST,
            &format!("/api/servers/{server_id}/invites"),
            Some(&owner),
            Some(json!({})),
        )
        .await;
    let code = inv.body["code"].as_str().unwrap();
    app.call(Method::POST, &format!("/api/invites/{code}"), Some(&member), Some(json!({})))
        .await;

    let path = format!("/api/channels/{channel}/messages");
    let by_owner = app
        .call(Method::POST, &path, Some(&owner), Some(json!({ "content": "owner says" })))
        .await;
    let by_member = app
        .call(Method::POST, &path, Some(&member), Some(json!({ "content": "member says" })))
        .await;
    let owner_msg = by_owner.body["id"].as_str().unwrap().to_string();
    let member_msg = by_member.body["id"].as_str().unwrap().to_string();

    // A plain member can't delete someone else's message.
    let r = app
        .call(Method::DELETE, &format!("/api/messages/{owner_msg}"), Some(&member), None)
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    // The owner (all permissions) can't rewrite it either...
    let r = app
        .call(
            Method::PATCH,
            &format!("/api/messages/{member_msg}"),
            Some(&owner),
            Some(json!({ "content": "words in your mouth" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    // ...but can delete it.
    let r = app
        .call(Method::DELETE, &format!("/api/messages/{member_msg}"), Some(&owner), None)
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(
        app.count("SELECT COUNT(1) FROM messages WHERE id = ?", &member_msg).await,
        0
    );
}

#[tokio::test]
async fn replies_must_target_the_same_channel() {
    let app = test_app().await;
    let auth = app.register("alice").await;
    let (server_a, chan_a) = app.server_with_text_channel(&auth).await;
    let (_, chan_b) = app.server_with_text_channel(&auth).await;
    let _ = server_a;
    let first = app
        .call(
            Method::POST,
            &format!("/api/channels/{chan_a}/messages"),
            Some(&auth),
            Some(json!({ "content": "question" })),
        )
        .await;
    let first_id = first.body["id"].as_str().unwrap().to_string();

    let ok = app
        .call(
            Method::POST,
            &format!("/api/channels/{chan_a}/messages"),
            Some(&auth),
            Some(json!({ "content": "answer", "reply_to_id": first_id })),
        )
        .await;
    assert_eq!(ok.status, StatusCode::OK, "{}", ok.body);
    assert_eq!(ok.body["reply_to_id"], first_id.as_str());

    let cross = app
        .call(
            Method::POST,
            &format!("/api/channels/{chan_b}/messages"),
            Some(&auth),
            Some(json!({ "content": "sneaky", "reply_to_id": first_id })),
        )
        .await;
    assert_eq!(cross.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn pins_need_manage_messages_and_list_newest_first() {
    let app = test_app().await;
    let owner = app.register("owner").await;
    let member = app.register("member").await;
    let (server_id, channel) = app.server_with_text_channel(&owner).await;
    let inv = app
        .call(Method::POST, &format!("/api/servers/{server_id}/invites"), Some(&owner), Some(json!({})))
        .await;
    let code = inv.body["code"].as_str().unwrap();
    app.call(Method::POST, &format!("/api/invites/{code}"), Some(&member), Some(json!({}))).await;
    let path = format!("/api/channels/{channel}/messages");
    let a = app.call(Method::POST, &path, Some(&member), Some(json!({ "content": "a" }))).await;
    let b = app.call(Method::POST, &path, Some(&member), Some(json!({ "content": "b" }))).await;
    let (a, b) = (a.body["id"].as_str().unwrap().to_string(), b.body["id"].as_str().unwrap().to_string());

    // Plain member: no Manage Messages.
    let r = app.call(Method::PUT, &format!("/api/messages/{a}/pin"), Some(&member), None).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    let r = app.call(Method::PUT, &format!("/api/messages/{a}/pin"), Some(&owner), None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert!(r.body["pinned_at"].is_string());
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    app.call(Method::PUT, &format!("/api/messages/{b}/pin"), Some(&owner), None).await;

    // Anyone who can read the channel sees the pins, newest pin first.
    let pins = app.call(Method::GET, &format!("/api/channels/{channel}/pins"), Some(&member), None).await;
    let ids: Vec<&str> = pins.body.as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec![b.as_str(), a.as_str()]);

    let r = app.call(Method::DELETE, &format!("/api/messages/{b}/pin"), Some(&owner), None).await;
    assert!(r.body.get("pinned_at").is_none() || r.body["pinned_at"].is_null());
    let pins = app.call(Method::GET, &format!("/api/channels/{channel}/pins"), Some(&member), None).await;
    assert_eq!(pins.body.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn search_finds_words_in_readable_channels_only() {
    let app = test_app().await;
    let owner = app.register("owner").await;
    let outsider = app.register("outsider").await;
    let (server_id, channel) = app.server_with_text_channel(&owner).await;
    let path = format!("/api/channels/{channel}/messages");
    for text in ["Vamos jogar Valorant hoje", "amanhã há reunião", "Ação às 21h"] {
        app.call(Method::POST, &path, Some(&owner), Some(json!({ "content": text }))).await;
    }
    // Edited text is re-indexed; deleted messages disappear.
    let edit_me = app.call(Method::POST, &path, Some(&owner), Some(json!({ "content": "old words" }))).await;
    let edit_id = edit_me.body["id"].as_str().unwrap().to_string();
    app.call(Method::PATCH, &format!("/api/messages/{edit_id}"), Some(&owner), Some(json!({ "content": "brand new words" }))).await;

    let search = |q: &'static str| {
        let app = &app;
        let enc: String = q
            .bytes()
            .map(|b| if b.is_ascii_alphanumeric() { (b as char).to_string() } else { format!("%{b:02X}") })
            .collect();
        let url = format!("/api/servers/{server_id}/search?q={enc}");
        let owner = owner.clone();
        async move {
            let r = app.call(Method::GET, &url, Some(&owner), None).await;
            assert_eq!(r.status, StatusCode::OK, "{}", r.body);
            r.body["messages"].as_array().unwrap().iter().map(|m| m["content"].as_str().unwrap().to_string()).collect::<Vec<_>>()
        }
    };
    assert_eq!(search("valor").await, vec!["Vamos jogar Valorant hoje"]); // prefix
    assert_eq!(search("acao").await, vec!["Ação às 21h"]); // accents ignored
    assert_eq!(search("old").await, Vec::<String>::new());
    assert_eq!(search("brand").await, vec!["brand new words"]);
    assert_eq!(search("\"OR* NEAR(").await.len(), 0); // no FTS syntax injection

    // Not a member: refused.
    let r = app
        .call(Method::GET, &format!("/api/servers/{server_id}/search?q=valorant"), Some(&outsider), None)
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn reused_refresh_token_revokes_the_whole_login() {
    let app = test_app().await;
    let r = app
        .call(
            Method::POST,
            "/api/auth/register",
            None,
            Some(json!({
                "username": "alice",
                "email": "alice@example.com",
                "password": "correct horse battery",
            })),
        )
        .await;
    let first = r.body["refresh_token"].as_str().unwrap().to_string();
    let refresh = |t: String| {
        let app = &app;
        async move {
            app.call(Method::POST, "/api/auth/refresh", None, Some(json!({ "refresh_token": t })))
                .await
        }
    };
    // Normal rotation works.
    let r = refresh(first.clone()).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let second = r.body["refresh_token"].as_str().unwrap().to_string();
    // The old token comes back (stolen copy): refused...
    assert_eq!(refresh(first).await.status, StatusCode::UNAUTHORIZED);
    // ...and the current token of that login is revoked too.
    assert_eq!(refresh(second).await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn group_dms_need_friends_and_an_envelope_per_member() {
    let app = test_app().await;
    let alice = app.register("alice").await;
    let bob = app.register("bob").await;
    let carol = app.register("carol").await;
    let id_of = |auth: &str| {
        let auth = auth.to_string();
        let app = &app;
        async move {
            app.call(Method::GET, "/api/auth/me", Some(&auth), None).await.body["id"]
                .as_str()
                .unwrap()
                .to_string()
        }
    };
    let (bob_id, carol_id) = (id_of(&bob).await, id_of(&carol).await);
    let alice_id = id_of(&alice).await;
    let befriend = |name: &'static str, auth: String| {
        let app = &app;
        let alice = alice.clone();
        async move {
            let f = app
                .call(Method::POST, "/api/friends/request", Some(&alice), Some(json!({ "username": name })))
                .await;
            assert_eq!(f.status, StatusCode::OK, "{}", f.body);
            let fid = f.body["id"].as_str().unwrap();
            let path = format!("/api/friends/{fid}/accept");
            assert_eq!(app.call(Method::POST, &path, Some(&auth), None).await.status, StatusCode::OK);
        }
    };
    befriend("bob", bob.clone()).await;

    // Non-friends (carol, for now) can't be added.
    let r = app
        .call(Method::POST, "/api/dms/groups", Some(&alice), Some(json!({ "user_ids": [bob_id, carol_id] })))
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    befriend("carol", carol.clone()).await;

    let r = app
        .call(
            Method::POST,
            "/api/dms/groups",
            Some(&alice),
            Some(json!({ "user_ids": [bob_id, carol_id], "name": " Trio " })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["is_group"], true);
    assert_eq!(r.body["name"], "Trio");
    assert_eq!(r.body["members"].as_array().unwrap().len(), 3);
    let gid = r.body["id"].as_str().unwrap().to_string();

    let env = |uid: &str| json!({ "user_id": uid, "public_key": "pk", "wrapped_key": "wk", "nonce": "n" });
    let msgs = format!("/api/dms/{gid}/messages");
    // Missing a member's envelope: refused.
    let r = app
        .call(
            Method::POST,
            &msgs,
            Some(&bob),
            Some(json!({ "ciphertext": "c", "nonce": "n", "key_envelopes": [env(&alice_id), env(&bob_id)] })),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = app
        .call(
            Method::POST,
            &msgs,
            Some(&bob),
            Some(json!({
                "ciphertext": "c", "nonce": "n",
                "key_envelopes": [env(&alice_id), env(&bob_id), env(&carol_id)]
            })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["key_envelopes"].as_array().unwrap().len(), 3);
    let list = app.call(Method::GET, &msgs, Some(&carol), None).await;
    assert_eq!(list.body.as_array().unwrap().len(), 1);

    // Group calls: any member can join; the room is the group's.
    let call = format!("/api/dms/{gid}/call/token");
    let r = app.call(Method::POST, &call, Some(&bob), None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["room"], format!("dm_call_{gid}"));
    let r = app.call(Method::POST, &call, Some(&carol), None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let state_path = format!("/api/dms/{gid}/call/state");
    let r = app
        .call(Method::PUT, &state_path, Some(&carol), Some(json!({ "muted": true })))
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["muted"], true);

    // Only the owner removes others; the owner leaving passes ownership on.
    let kick = format!("/api/dms/{gid}/members/{carol_id}");
    assert_eq!(app.call(Method::DELETE, &kick, Some(&bob), None).await.status, StatusCode::FORBIDDEN);
    let leave = format!("/api/dms/{gid}/members/{alice_id}");
    assert_eq!(app.call(Method::DELETE, &leave, Some(&alice), None).await.status, StatusCode::OK);
    let dms = app.call(Method::GET, "/api/dms", Some(&bob), None).await;
    let g = dms.body.as_array().unwrap().iter().find(|d| d["id"] == gid.as_str()).unwrap();
    assert_eq!(g["members"].as_array().unwrap().len(), 2);
    assert_ne!(g["owner_id"], alice_id.as_str());
    assert_eq!(app.call(Method::GET, &msgs, Some(&alice), None).await.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn templates_create_channels_roles_and_permissions() {
    let app = test_app().await;
    let owner = app.register("owner").await;
    let member = app.register("member").await;

    let bad = app
        .call(Method::POST, "/api/servers", Some(&owner), Some(json!({ "name": "X", "template": "nope" })))
        .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);

    let small = app
        .call(Method::POST, "/api/servers", Some(&owner), Some(json!({ "name": "Small", "template": "gaming" })))
        .await;
    assert_eq!(small.status, StatusCode::OK, "{}", small.body);
    let r = app
        .call(
            Method::POST,
            "/api/servers",
            Some(&owner),
            Some(json!({ "name": "Big", "template": "gaming", "community": true })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let sid = r.body["id"].as_str().unwrap().to_string();
    let small_id = small.body["id"].as_str().unwrap().to_string();

    let names = |body: &Value| -> Vec<String> {
        body.as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap().to_string()).collect()
    };
    let owner_view = app.call(Method::GET, &format!("/api/servers/{sid}/channels"), Some(&owner), None).await;
    let owner_names = names(&owner_view.body);
    for n in ["announcements", "general", "Squad 1", "Stream Room", "staff-chat", "Staff"] {
        assert!(owner_names.contains(&n.to_string()), "missing {n}: {owner_names:?}");
    }
    let small_view = app
        .call(Method::GET, &format!("/api/servers/{small_id}/channels"), Some(&owner), None)
        .await;
    assert!(names(&small_view.body).len() < owner_names.len());

    let roles = app.call(Method::GET, &format!("/api/servers/{sid}/roles"), Some(&owner), None).await;
    let role_names: Vec<String> = roles.body.as_array().unwrap().iter()
        .map(|r| r["name"].as_str().unwrap().to_string()).collect();
    for n in ["Admin", "Moderator", "Streamer"] {
        assert!(role_names.contains(&n.to_string()), "missing role {n}: {role_names:?}");
    }

    // A plain member: no staff channels, can't post announcements, can chat.
    let inv = app
        .call(Method::POST, &format!("/api/servers/{sid}/invites"), Some(&owner), Some(json!({})))
        .await;
    let code = inv.body["code"].as_str().unwrap();
    app.call(Method::POST, &format!("/api/invites/{code}"), Some(&member), Some(json!({}))).await;
    app.call(Method::POST, &format!("/api/servers/{sid}/rules/accept"), Some(&member), Some(json!({}))).await;
    let member_view = app.call(Method::GET, &format!("/api/servers/{sid}/channels"), Some(&member), None).await;
    let member_names = names(&member_view.body);
    assert!(!member_names.contains(&"staff-chat".to_string()), "{member_names:?}");
    assert!(member_names.contains(&"general".to_string()));
    let id_of = |n: &str| {
        owner_view.body.as_array().unwrap().iter()
            .find(|c| c["name"] == n).unwrap()["id"].as_str().unwrap().to_string()
    };
    let post = |ch: String| {
        let app = &app;
        let member = member.clone();
        async move {
            app.call(Method::POST, &format!("/api/channels/{ch}/messages"), Some(&member), Some(json!({ "content": "hi" })))
                .await
                .status
        }
    };
    assert_eq!(post(id_of("announcements")).await, StatusCode::FORBIDDEN);
    assert_eq!(post(id_of("general")).await, StatusCode::OK);
}

#[tokio::test]
async fn creating_servers_is_rate_limited() {
    let app = test_app().await;
    let owner = app.register("owner").await;
    for i in 0..10 {
        let r = app
            .call(Method::POST, "/api/servers", Some(&owner), Some(json!({ "name": format!("S{i}") })))
            .await;
        assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    }
    let r = app
        .call(Method::POST, "/api/servers", Some(&owner), Some(json!({ "name": "one too many" })))
        .await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn websocket_drops_oversized_frames() {
    use futures_util::SinkExt;
    use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue, Message};

    let app = test_app().await;
    let auth = app.register("alice").await;
    let token = auth.trim_start_matches("Bearer ").to_string();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app.router.clone();
    tokio::spawn(async move {
        axum::serve(listener, router.into_make_service_with_connect_info::<std::net::SocketAddr>())
            .await
            .unwrap();
    });
    let mut req = format!("ws://{addr}/api/ws").into_client_request().unwrap();
    req.headers_mut().insert(
        "sec-websocket-protocol",
        HeaderValue::from_str(&format!("speakapp.auth, {token}")).unwrap(),
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
    // 1 MB of text: far over the 16 KB cap, the server closes the socket.
    let _ = ws.send(Message::Text("x".repeat(1 << 20).into())).await;
    let mut closed = false;
    for _ in 0..50 {
        match tokio::time::timeout(std::time::Duration::from_millis(100), futures_util::StreamExt::next(&mut ws)).await {
            Ok(None) | Ok(Some(Err(_))) | Ok(Some(Ok(Message::Close(_)))) => {
                closed = true;
                break;
            }
            _ => {}
        }
    }
    assert!(closed, "server kept the connection after a 1 MB frame");
}

#[tokio::test]
async fn encrypted_attachments_keep_their_key() {
    let app = test_app().await;
    let owner = app.register("owner").await;
    let (_server, channel) = app.server_with_text_channel(&owner).await;
    let key = "A".repeat(43);
    let bad = app
        .call(
            Method::POST,
            "/api/media/remote",
            Some(&owner),
            Some(json!({ "url": "https://files.catbox.moe/abc123.bin", "enc_key": "short" })),
        )
        .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    let up = app
        .call(
            Method::POST,
            "/api/media/remote",
            Some(&owner),
            Some(json!({
                "url": "https://files.catbox.moe/abc123.bin",
                "filename": "photo.png",
                "content_type": "image/png",
                "size": 1234,
                "enc_key": key,
            })),
        )
        .await;
    assert_eq!(up.status, StatusCode::OK, "{}", up.body);
    let att = up.body["id"].as_str().unwrap();
    let msg = app
        .call(
            Method::POST,
            &format!("/api/channels/{channel}/messages"),
            Some(&owner),
            Some(json!({ "content": "", "attachment_ids": [att] })),
        )
        .await;
    assert_eq!(msg.status, StatusCode::OK, "{}", msg.body);
    let a = &msg.body["attachments"][0];
    assert_eq!(a["enc_key"], key.as_str());
    assert_eq!(a["filename"], "photo.png");
    assert_eq!(a["content_type"], "image/png");
    let list = app
        .call(Method::GET, &format!("/api/channels/{channel}/messages"), Some(&owner), None)
        .await;
    assert_eq!(list.body[0]["attachments"][0]["enc_key"], key.as_str());
}

#[tokio::test]
async fn attachments_are_removed_with_their_message_and_when_never_sent() {
    let app = test_app().await;
    let owner = app.register("owner").await;
    let (server_id, channel) = app.server_with_text_channel(&owner).await;
    let upload = |name: &'static str| {
        let app = &app;
        let owner = owner.clone();
        async move {
            let up = app
                .call(
                    Method::POST,
                    "/api/media/remote",
                    Some(&owner),
                    Some(json!({
                        "url": format!("https://files.catbox.moe/{name}.dat"),
                        "filename": "a.zip",
                        "content_type": "application/zip",
                        "size": 10,
                        "enc_key": "A".repeat(43),
                    })),
                )
                .await;
            assert_eq!(up.status, StatusCode::OK, "{}", up.body);
            up.body["id"].as_str().unwrap().to_string()
        }
    };
    let count = "SELECT COUNT(1) FROM attachments WHERE id = ?";

    // Deleting a message deletes its attachment row (link + key).
    let a = upload("aaa111").await;
    let msg = app
        .call(Method::POST, &format!("/api/channels/{channel}/messages"), Some(&owner), Some(json!({ "content": "", "attachment_ids": [a] })))
        .await;
    let msg_id = msg.body["id"].as_str().unwrap().to_string();
    assert_eq!(app.count(count, &a).await, 1);
    let r = app.call(Method::DELETE, &format!("/api/messages/{msg_id}"), Some(&owner), None).await;
    assert!(r.status.is_success(), "{}", r.body);
    assert_eq!(app.count(count, &a).await, 0, "attachment kept after its message was deleted");

    // Deleting the whole server (cascade) also removes them.
    let b = upload("bbb222").await;
    app.call(Method::POST, &format!("/api/channels/{channel}/messages"), Some(&owner), Some(json!({ "content": "", "attachment_ids": [b] })))
        .await;
    let r = app.call(Method::DELETE, &format!("/api/servers/{server_id}"), Some(&owner), None).await;
    assert!(r.status.is_success(), "{}", r.body);
    assert_eq!(app.count(count, &b).await, 0, "attachment kept after its server was deleted");

    // Uploads never sent: kept for a day, then removed.
    let fresh = upload("ccc333").await;
    let old = upload("ddd444").await;
    sqlx::query("UPDATE attachments SET uploaded_at = '2000-01-01T00:00:00+00:00' WHERE id = ?")
        .bind(&old)
        .execute(&app.state.db)
        .await
        .unwrap();
    let removed = crate::catbox_mover::remove_unsent(&app.state).await.unwrap();
    assert_eq!(removed, 1);
    assert_eq!(app.count(count, &fresh).await, 1);
    assert_eq!(app.count(count, &old).await, 0);
}

/// Owner + a plain member in one server; returns (owner, member, server, channel, member id).
async fn owner_and_member(app: &TestApp) -> (String, String, String, String, String) {
    let owner = app.register("owner").await;
    let member = app.register("member").await;
    let (server_id, channel) = app.server_with_text_channel(&owner).await;
    let inv = app
        .call(Method::POST, &format!("/api/servers/{server_id}/invites"), Some(&owner), Some(json!({})))
        .await;
    let code = inv.body["code"].as_str().unwrap();
    app.call(Method::POST, &format!("/api/invites/{code}"), Some(&member), Some(json!({}))).await;
    app.call(Method::POST, &format!("/api/servers/{server_id}/rules/accept"), Some(&member), Some(json!({}))).await;
    let me = app.call(Method::GET, "/api/auth/me", Some(&member), None).await;
    let member_id = me.body["id"].as_str().unwrap().to_string();
    (owner, member, server_id, channel, member_id)
}

#[tokio::test]
async fn slow_mode_and_word_filter_skip_moderators() {
    let app = test_app().await;
    let (owner, member, server_id, channel, _) = owner_and_member(&app).await;
    let post = |auth: String, text: &'static str| {
        let app = &app;
        let path = format!("/api/channels/{channel}/messages");
        async move { app.call(Method::POST, &path, Some(&auth), Some(json!({ "content": text }))).await }
    };
    let r = app
        .call(Method::PATCH, &format!("/api/channels/{channel}"), Some(&owner), Some(json!({ "slowmode_seconds": 30 })))
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["slowmode_seconds"], 30);
    assert_eq!(post(member.clone(), "first").await.status, StatusCode::OK);
    assert_eq!(post(member.clone(), "too soon").await.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(post(owner.clone(), "owner a").await.status, StatusCode::OK);
    assert_eq!(post(owner.clone(), "owner b").await.status, StatusCode::OK);
    app.call(Method::PATCH, &format!("/api/channels/{channel}"), Some(&owner), Some(json!({ "slowmode_seconds": 0 })))
        .await;

    let r = app
        .call(Method::PUT, &format!("/api/servers/{server_id}/automod"), Some(&owner), Some(json!({ "words": ["Batata", " palavrão ", "batata"] })))
        .await;
    assert_eq!(r.body["words"], json!(["batata", "palavrão"]));
    assert_eq!(post(member.clone(), "gosto de BATATA frita").await.status, StatusCode::BAD_REQUEST);
    assert_eq!(post(member.clone(), "batatas são outra palavra").await.status, StatusCode::OK);
    assert_eq!(post(owner.clone(), "batata").await.status, StatusCode::OK);
    let forbidden = app.call(Method::GET, &format!("/api/servers/{server_id}/automod"), Some(&member), None).await;
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    // Both settings changes are in the audit log, newest first.
    let log = app.call(Method::GET, &format!("/api/servers/{server_id}/audit-log"), Some(&owner), None).await;
    let actions: Vec<&str> = log.body.as_array().unwrap().iter().map(|e| e["action"].as_str().unwrap()).collect();
    assert_eq!(actions.first(), Some(&"automod_update"), "{actions:?}");
    assert!(actions.contains(&"channel_update"), "{actions:?}");
    assert_eq!(app.call(Method::GET, &format!("/api/servers/{server_id}/audit-log"), Some(&member), None).await.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn polls_count_votes_per_person() {
    let app = test_app().await;
    let (owner, member, _server, channel, _) = owner_and_member(&app).await;
    let r = app
        .call(
            Method::POST,
            &format!("/api/channels/{channel}/polls"),
            Some(&owner),
            Some(json!({ "question": "A que horas?", "options": ["20h", " "] })),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "only one real option");
    let r = app
        .call(
            Method::POST,
            &format!("/api/channels/{channel}/polls"),
            Some(&owner),
            Some(json!({ "question": "A que horas?", "options": ["20h", "21h", "22h"] })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let mid = r.body["id"].as_str().unwrap().to_string();
    let opts: Vec<String> = r.body["poll"]["options"].as_array().unwrap().iter().map(|o| o["id"].as_str().unwrap().to_string()).collect();
    let vote = |auth: String, ids: Vec<String>| {
        let app = &app;
        let path = format!("/api/messages/{mid}/poll/vote");
        async move { app.call(Method::PUT, &path, Some(&auth), Some(json!({ "option_ids": ids }))).await }
    };
    assert_eq!(vote(member.clone(), vec![opts[0].clone(), opts[1].clone()]).await.status, StatusCode::BAD_REQUEST);
    vote(member.clone(), vec![opts[0].clone()]).await;
    vote(owner.clone(), vec![opts[0].clone()]).await;
    let r = vote(member.clone(), vec![opts[1].clone()]).await; // changes their vote
    let votes: Vec<u64> = r.body["options"].as_array().unwrap().iter().map(|o| o["votes"].as_u64().unwrap()).collect();
    assert_eq!(votes, vec![1, 1, 0]);
    assert_eq!(r.body["my_votes"], json!([opts[1]]));
    let list = app.call(Method::GET, &format!("/api/channels/{channel}/messages"), Some(&owner), None).await;
    let poll = &list.body.as_array().unwrap().last().unwrap()["poll"];
    assert_eq!(poll["my_votes"], json!([opts[0]]), "owner sees their own vote");
}

#[tokio::test]
async fn threads_follow_their_channel_and_count_messages() {
    let app = test_app().await;
    let (owner, member, server_id, channel, _) = owner_and_member(&app).await;
    let first = app
        .call(Method::POST, &format!("/api/channels/{channel}/messages"), Some(&owner), Some(json!({ "content": "start here" })))
        .await;
    let mid = first.body["id"].as_str().unwrap().to_string();
    let t = app
        .call(Method::POST, &format!("/api/messages/{mid}/thread"), Some(&member), Some(json!({ "name": "Plano" })))
        .await;
    assert_eq!(t.status, StatusCode::OK, "{}", t.body);
    let thread = t.body["id"].as_str().unwrap().to_string();
    assert_eq!(t.body["parent_channel_id"], channel.as_str());
    let again = app
        .call(Method::POST, &format!("/api/messages/{mid}/thread"), Some(&owner), Some(json!({ "name": "Outro" })))
        .await;
    assert_eq!(again.body["id"], thread.as_str(), "one thread per message");
    for text in ["a", "b"] {
        let r = app
            .call(Method::POST, &format!("/api/channels/{thread}/messages"), Some(&member), Some(json!({ "content": text })))
            .await;
        assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    }
    let list = app.call(Method::GET, &format!("/api/channels/{channel}/messages"), Some(&owner), None).await;
    let parent = list.body.as_array().unwrap().iter().find(|m| m["id"] == mid.as_str()).unwrap();
    assert_eq!(parent["thread"]["message_count"], 2);
    assert_eq!(parent["thread"]["name"], "Plano");

    // Hide the channel from @everyone: the thread is hidden too.
    let roles = app.call(Method::GET, &format!("/api/servers/{server_id}/roles"), Some(&owner), None).await;
    let everyone = roles.body.as_array().unwrap().iter().find(|r| r["is_everyone"] == true).unwrap()["id"].as_str().unwrap().to_string();
    let r = app
        .call(
            Method::PUT,
            &format!("/api/channels/{channel}/overwrites"),
            Some(&owner),
            Some(json!({ "overwrites": [{ "target_type": "role", "target_id": everyone, "allow": 0, "deny": 1 }] })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let hidden = app.call(Method::GET, &format!("/api/channels/{thread}/messages"), Some(&member), None).await;
    assert_eq!(hidden.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn profiles_and_forwarded_messages() {
    let app = test_app().await;
    let (owner, member, _server, channel, member_id) = owner_and_member(&app).await;
    let r = app
        .call(Method::PATCH, "/api/auth/me", Some(&member), Some(json!({ "bio": " Joga FIFA ", "accent_color": "#FF8800" })))
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["bio"], "Joga FIFA");
    let p = app.call(Method::GET, &format!("/api/users/{member_id}/profile"), Some(&owner), None).await;
    assert_eq!(p.body["bio"], "Joga FIFA");
    assert_eq!(p.body["accent_color"], "#ff8800");
    let bad = app.call(Method::PATCH, "/api/auth/me", Some(&member), Some(json!({ "accent_color": "red" }))).await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);

    let r = app
        .call(Method::POST, &format!("/api/channels/{channel}/messages"), Some(&owner), Some(json!({ "content": "copied", "forwarded": true })))
        .await;
    assert_eq!(r.body["forwarded"], true);
    let plain = app
        .call(Method::POST, &format!("/api/channels/{channel}/messages"), Some(&owner), Some(json!({ "content": "normal" })))
        .await;
    assert!(plain.body.get("forwarded").is_none());
}

#[tokio::test]
async fn player_groups_fill_up_and_announce() {
    let app = test_app().await;
    let (owner, member, _server, channel, member_id) = owner_and_member(&app).await;
    let bad = app
        .call(Method::POST, &format!("/api/channels/{channel}/groups"), Some(&owner), Some(json!({ "game": "Valorant", "slots": 1 })))
        .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    let r = app
        .call(
            Method::POST,
            &format!("/api/channels/{channel}/groups"),
            Some(&owner),
            Some(json!({ "game": "Valorant", "slots": 2, "duration_minutes": 60 })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["lfg"]["members"].as_array().unwrap().len(), 1, "creator is in");
    assert!(r.body["lfg"]["expires_at"].is_string());
    let mid = r.body["id"].as_str().unwrap().to_string();
    let join = format!("/api/messages/{mid}/group/join");

    // Join, leave, join again: the second player fills it.
    assert_eq!(app.call(Method::PUT, &join, Some(&member), None).await.status, StatusCode::OK);
    // (filled on the first join: 2 of 2)
    let list = app.call(Method::GET, &format!("/api/channels/{channel}/messages"), Some(&owner), None).await;
    let msgs = list.body.as_array().unwrap();
    let card = msgs.iter().find(|m| m["id"] == mid.as_str()).unwrap();
    assert!(card["lfg"]["completed_at"].is_string());
    assert_eq!(card["lfg"]["members"][1], member_id.as_str());
    let done = msgs.last().unwrap();
    assert_eq!(done["reply_to_id"], mid.as_str());
    let text = done["content"].as_str().unwrap();
    assert!(text.contains("Valorant") && text.contains(&format!("<@{member_id}>")), "{text}");

    // Closed: nobody can join or leave any more.
    assert_eq!(app.call(Method::DELETE, &join, Some(&member), None).await.status, StatusCode::BAD_REQUEST);

    // A bigger group: leaving frees the slot.
    let r = app
        .call(Method::POST, &format!("/api/channels/{channel}/groups"), Some(&owner), Some(json!({ "game": "CS2", "slots": 5 })))
        .await;
    let mid2 = r.body["id"].as_str().unwrap().to_string();
    let join2 = format!("/api/messages/{mid2}/group/join");
    let r = app.call(Method::PUT, &join2, Some(&member), None).await;
    assert_eq!(r.body["lfg"]["members"].as_array().unwrap().len(), 2);
    let r = app.call(Method::DELETE, &join2, Some(&member), None).await;
    assert_eq!(r.body["lfg"]["members"].as_array().unwrap().len(), 1);
    assert!(r.body["lfg"].get("completed_at").is_none());
}

#[tokio::test]
async fn litterbox_fallback_is_temporary_and_encrypted_only() {
    let app = test_app().await;
    let owner = app.register("owner").await;
    let (_server, channel) = app.server_with_text_channel(&owner).await;
    let plain = app
        .call(Method::POST, "/api/media/remote", Some(&owner), Some(json!({ "url": "https://litter.catbox.moe/abc123.dat" })))
        .await;
    assert_eq!(plain.status, StatusCode::BAD_REQUEST, "plain files must not use the temporary host");
    let up = app
        .call(
            Method::POST,
            "/api/media/remote",
            Some(&owner),
            Some(json!({
                "url": "https://litter.catbox.moe/abc123.dat",
                "filename": "voice-message.webm",
                "content_type": "audio/webm",
                "size": 1000,
                "enc_key": "B".repeat(43),
            })),
        )
        .await;
    assert_eq!(up.status, StatusCode::OK, "{}", up.body);
    let att = up.body["id"].as_str().unwrap();
    let msg = app
        .call(Method::POST, &format!("/api/channels/{channel}/messages"), Some(&owner), Some(json!({ "content": "", "attachment_ids": [att] })))
        .await;
    let until = msg.body["attachments"][0]["temporary_until"].as_str().expect("marked temporary");
    let until = chrono::DateTime::parse_from_rfc3339(until).unwrap();
    let hours = (until.with_timezone(&chrono::Utc) - chrono::Utc::now()).num_hours();
    assert!((71..=72).contains(&hours), "{hours}");
}

#[tokio::test]
async fn custom_status_set_read_and_clear() {
    let app = test_app().await;
    let (owner, member, _server, _channel, member_id) = owner_and_member(&app).await;
    let r = app
        .call(Method::PUT, "/api/users/me/custom-status", Some(&member), Some(json!({ "text": " Watermelon ", "emoji": "🍉", "expires_minutes": 60 })))
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let p = app.call(Method::GET, &format!("/api/users/{member_id}/profile"), Some(&owner), None).await;
    assert_eq!(p.body["custom_status"]["text"], "Watermelon");
    assert_eq!(p.body["custom_status"]["emoji"], "🍉");
    assert!(p.body["custom_status"]["expires_at"].is_string());
    let long = app
        .call(Method::PUT, "/api/users/me/custom-status", Some(&member), Some(json!({ "text": "x".repeat(200) })))
        .await;
    assert_eq!(long.status, StatusCode::BAD_REQUEST);
    app.call(Method::PUT, "/api/users/me/custom-status", Some(&member), Some(json!({ "text": "" }))).await;
    let p = app.call(Method::GET, &format!("/api/users/{member_id}/profile"), Some(&owner), None).await;
    assert!(p.body.get("custom_status").is_none(), "{}", p.body);
}

#[tokio::test]
async fn user_notes_are_private_to_their_owner() {
    let app = test_app().await;
    let (owner, member, _server, _channel, member_id) = owner_and_member(&app).await;
    let path = format!("/api/users/{member_id}/note");
    let r = app.call(Method::PUT, &path, Some(&owner), Some(json!({ "note": "  primo do João  " }))).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["note"], "primo do João");
    assert_eq!(app.call(Method::GET, &path, Some(&owner), None).await.body["note"], "primo do João");
    // Someone else sees their own (empty) note, not mine.
    let other = app.register("other").await;
    assert!(app.call(Method::GET, &path, Some(&other), None).await.body["note"].is_null());
    // No note about yourself; too long is refused; empty clears.
    let r = app.call(Method::PUT, &path, Some(&member), Some(json!({ "note": "x" }))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = app.call(Method::PUT, &path, Some(&owner), Some(json!({ "note": "a".repeat(257) }))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    app.call(Method::PUT, &path, Some(&owner), Some(json!({ "note": "" }))).await;
    assert!(app.call(Method::GET, &path, Some(&owner), None).await.body["note"].is_null());
}

#[tokio::test]
async fn welcome_message_is_posted_when_someone_joins() {
    let app = test_app().await;
    let owner = app.register("owner").await;
    let (server_id, channel) = app.server_with_text_channel(&owner).await;
    let path = format!("/api/servers/{server_id}/welcome");
    let r = app
        .call(Method::PUT, &path, Some(&owner), Some(json!({ "channel_id": channel, "message": "Bem-vindo {user}, lê as regras!" })))
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(app.call(Method::GET, &path, Some(&owner), None).await.body["message"], "Bem-vindo {user}, lê as regras!");

    let member = app.register("member").await;
    let inv = app.call(Method::POST, &format!("/api/servers/{server_id}/invites"), Some(&owner), Some(json!({}))).await;
    let code = inv.body["code"].as_str().unwrap().to_string();
    app.call(Method::POST, &format!("/api/invites/{code}"), Some(&member), Some(json!({}))).await;
    let me = app.call(Method::GET, "/api/auth/me", Some(&member), None).await;
    let member_id = me.body["id"].as_str().unwrap().to_string();

    let list = app.call(Method::GET, &format!("/api/channels/{channel}/messages"), Some(&owner), None).await;
    let last = list.body.as_array().unwrap().last().unwrap().clone();
    assert_eq!(last["system"], "member_join");
    assert_eq!(last["author_id"], member_id.as_str());
    assert_eq!(last["content"], format!("Bem-vindo <@{member_id}>, lê as regras!"));

    // Only managers can change it.
    let r = app.call(Method::PUT, &path, Some(&member), Some(json!({ "channel_id": null }))).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    // Off: nobody gets a message.
    app.call(Method::PUT, &path, Some(&owner), Some(json!({ "channel_id": null }))).await;
    let third = app.register("third").await;
    app.call(Method::POST, &format!("/api/invites/{code}"), Some(&third), Some(json!({}))).await;
    let again = app.call(Method::GET, &format!("/api/channels/{channel}/messages"), Some(&owner), None).await;
    assert_eq!(again.body.as_array().unwrap().len(), list.body.as_array().unwrap().len());
}

#[tokio::test]
async fn events_rsvp_and_delete_rules() {
    let app = test_app().await;
    let (owner, member, server_id, _channel, member_id) = owner_and_member(&app).await;
    let starts = (chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339();
    let r = app
        .call(
            Method::POST,
            &format!("/api/servers/{server_id}/events"),
            Some(&member),
            Some(json!({ "title": "CS2", "description": "5 stack", "starts_at": starts })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let event_id = r.body["id"].as_str().unwrap().to_string();
    assert_eq!(r.body["going"], json!([member_id]), "creator is going");

    let r = app.call(Method::PUT, &format!("/api/events/{event_id}/rsvp"), Some(&owner), None).await;
    assert_eq!(r.body["going"].as_array().unwrap().len(), 2);
    let r = app.call(Method::DELETE, &format!("/api/events/{event_id}/rsvp"), Some(&member), None).await;
    assert_eq!(r.body["going"].as_array().unwrap().len(), 1);

    let list = app.call(Method::GET, &format!("/api/servers/{server_id}/events"), Some(&owner), None).await;
    assert_eq!(list.body.as_array().unwrap().len(), 1);

    // Past times and outsiders are refused.
    let past = (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339();
    let r = app
        .call(Method::POST, &format!("/api/servers/{server_id}/events"), Some(&owner), Some(json!({ "title": "old", "starts_at": past })))
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let outsider = app.register("outsider").await;
    let r = app.call(Method::GET, &format!("/api/servers/{server_id}/events"), Some(&outsider), None).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    // A plain member can't delete someone else's event; the owner can.
    let r = app
        .call(Method::POST, &format!("/api/servers/{server_id}/events"), Some(&owner), Some(json!({ "title": "Owner event", "starts_at": starts })))
        .await;
    let owners_event = r.body["id"].as_str().unwrap().to_string();
    let r = app.call(Method::DELETE, &format!("/api/events/{owners_event}"), Some(&member), None).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let r = app.call(Method::DELETE, &format!("/api/events/{event_id}"), Some(&owner), None).await;
    assert!(r.status.is_success());
    let list = app.call(Method::GET, &format!("/api/servers/{server_id}/events"), Some(&owner), None).await;
    assert_eq!(list.body.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn dm_seen_only_moves_forward() {
    let app = test_app().await;
    let (owner, member, _server, _channel, member_id) = owner_and_member(&app).await;
    let dm = app.call(Method::POST, &format!("/api/dms/by-peer/{member_id}/open"), Some(&owner), None).await;
    assert_eq!(dm.status, StatusCode::OK, "{}", dm.body);
    let dm_id = dm.body["id"].as_str().unwrap().to_string();
    let owner_id = app.call(Method::GET, "/api/auth/me", Some(&owner), None).await.body["id"].as_str().unwrap().to_string();
    // Two messages straight in the DB (the real ones are end-to-end encrypted).
    let msgs = [
        ("11111111-1111-4111-8111-111111111111", "2026-01-01T10:00:00+00:00"),
        ("22222222-2222-4222-8222-222222222222", "2026-01-01T10:05:00+00:00"),
    ];
    for (id, at) in msgs {
        sqlx::query("INSERT INTO dm_messages (id, dm_channel_id, author_id, ciphertext, nonce, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(id)
            .bind(&dm_id)
            .bind(&owner_id)
            .bind("x")
            .bind("y")
            .bind(at)
            .execute(&app.state.db)
            .await
            .unwrap();
    }
    let path = format!("/api/dms/{dm_id}/read");
    let r = app.call(Method::PUT, &path, Some(&member), Some(json!({ "message_id": msgs[1].0 }))).await;
    assert!(r.status.is_success(), "{}", r.body);
    let r = app.call(Method::PUT, &path, Some(&member), Some(json!({ "message_id": msgs[0].0 }))).await;
    assert!(r.status.is_success(), "{}", r.body);
    let reads = app.call(Method::GET, &format!("/api/dms/{dm_id}/reads"), Some(&owner), None).await;
    assert_eq!(reads.body[0]["message_id"], msgs[1].0, "never goes back");
    assert_eq!(reads.body[0]["user_id"], member_id.as_str());
    // Outsiders can't see it.
    let outsider = app.register("outsider").await;
    let r = app.call(Method::GET, &format!("/api/dms/{dm_id}/reads"), Some(&outsider), None).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn watch_together_queue() {
    let app = test_app().await;
    let (owner, member, server_id, _channel, member_id) = owner_and_member(&app).await;
    let channels = app.call(Method::GET, &format!("/api/servers/{server_id}/channels"), Some(&owner), None).await;
    let voice = channels
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["channel_type"] == "voice")
        .expect("voice channel")["id"]
        .as_str()
        .unwrap()
        .to_string();
    let path = format!("/api/channels/{voice}/watch");
    let add = |url: &'static str| {
        let app = &app;
        let member = member.clone();
        let path = path.clone();
        async move { app.call(Method::POST, &path, Some(&member), Some(json!({ "action": "add", "url": url }))).await }
    };
    // Not in the voice channel yet.
    assert_eq!(add("https://youtu.be/dQw4w9WgXcQ").await.status, StatusCode::BAD_REQUEST);
    sqlx::query("INSERT INTO voice_states (user_id, channel_id, updated_at) VALUES (?, ?, ?)")
        .bind(&member_id)
        .bind(&voice)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&app.state.db)
        .await
        .unwrap();
    let r = add("https://youtu.be/dQw4w9WgXcQ").await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["playing"], true, "first video starts");
    let first = r.body["queue"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(r.body["current"], first.as_str());
    let r = add("https://www.youtube.com/watch?v=9bZkp7q19f0").await;
    assert_eq!(r.body["queue"].as_array().unwrap().len(), 2);
    assert_eq!(add("https://vimeo.com/1").await.status, StatusCode::BAD_REQUEST);

    let r = app.call(Method::POST, &path, Some(&member), Some(json!({ "action": "pause", "position": 42.5 }))).await;
    assert_eq!(r.body["playing"], false);
    assert_eq!(r.body["position"], 42.5);
    // Two apps report the same end: it only advances once.
    for _ in 0..2 {
        app.call(Method::POST, &path, Some(&member), Some(json!({ "action": "next", "item_id": first }))).await;
    }
    let r = app.call(Method::GET, &path, Some(&owner), None).await;
    assert_eq!(r.body["queue"].as_array().unwrap().len(), 1);
    assert_eq!(r.body["queue"][0]["video_id"], "9bZkp7q19f0");
    assert_eq!(r.body["playing"], true);
    assert_eq!(r.body["position"], 0.0);

    // Listen together has its own queue in the same channel.
    let listen = format!("{path}?kind=listen");
    let r = app.call(Method::GET, &listen, Some(&owner), None).await;
    assert_eq!(r.body["queue"].as_array().unwrap().len(), 0);
    let r = app
        .call(Method::POST, &listen, Some(&member), Some(json!({ "action": "add", "url": "https://youtu.be/dQw4w9WgXcQ" })))
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["queue"].as_array().unwrap().len(), 1);
    let r = app.call(Method::GET, &path, Some(&owner), None).await;
    assert_eq!(r.body["queue"][0]["video_id"], "9bZkp7q19f0", "watch queue untouched");
    let r = app.call(Method::GET, &format!("{path}?kind=karaoke"), Some(&owner), None).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}
