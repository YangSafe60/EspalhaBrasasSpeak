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
use speakapp_shared::Permissions;
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
async fn bot_without_send_permission_is_403() {
    let app = test_app().await;
    let auth = app.register("alice").await;
    let (server, channel) = app.server_with_text_channel(&auth).await;
    let bot = app
        .call(
            Method::POST,
            &format!("/api/servers/{server}/bots"),
            Some(&auth),
            Some(json!({ "name": "Reader", "permissions": Permissions::VIEW_CHANNEL.bits() })),
        )
        .await;
    assert_eq!(bot.status, StatusCode::OK, "{}", bot.body);
    let bot_auth = format!("Bot {}", bot.body["token"].as_str().unwrap());

    // It can read but not post.
    let path = format!("/api/channels/{channel}/messages");
    let r = app.call(Method::GET, &path, Some(&bot_auth), None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let r = app
        .call(
            Method::POST,
            &path,
            Some(&bot_auth),
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
async fn webhook_limits_and_token_check() {
    let app = test_app().await;
    let auth = app.register("alice").await;
    let (_, channel) = app.server_with_text_channel(&auth).await;
    let wh = app
        .call(
            Method::POST,
            &format!("/api/channels/{channel}/webhooks"),
            Some(&auth),
            Some(json!({ "name": "CI" })),
        )
        .await;
    assert_eq!(wh.status, StatusCode::OK, "{}", wh.body);
    let id = wh.body["id"].as_str().unwrap();
    let token = wh.body["token"].as_str().unwrap();

    let exec = |tok: String, body: Value| {
        let app = &app;
        let path = format!("/api/webhooks/{id}/{tok}");
        async move { app.call(Method::POST, &path, None, Some(body)).await }
    };
    let r = exec("wh_wrong".into(), json!({ "content": "hi" })).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    let r = exec(token.into(), json!({ "content": "x".repeat(4001) })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = exec(
        token.into(),
        json!({ "content": "hi", "username": "u".repeat(81) }),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = exec(
        token.into(),
        json!({ "content": "hi", "username": "u".repeat(80) }),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
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
