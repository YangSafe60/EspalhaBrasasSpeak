mod auth_routes;
mod channels;
mod community;
mod diagnostics;
mod dms;
mod emojis;
pub(crate) mod friends;
mod media;
mod messages;
mod presence;
mod servers;
pub(crate) mod voice;

use crate::auth::{decode_token, AuthUser};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::ws;
use axum::{
    extract::{DefaultBodyLimit, State, WebSocketUpgrade},
    http::{header, HeaderMap, HeaderValue, Method},
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
    Router,
};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

/// Global request body cap; image uploads get `MAX_UPLOAD_BYTES` instead.
pub const JSON_BODY_LIMIT: usize = 1024 * 1024;

fn build_cors(public_url: &str) -> CorsLayer {
    let mut origins: Vec<HeaderValue> = Vec::new();
    for raw in [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ] {
        if let Ok(v) = raw.parse() {
            origins.push(v);
        }
    }
    if let Ok(v) = public_url.trim_end_matches('/').parse() {
        origins.push(v);
    }
    if let Ok(extra) = std::env::var("CORS_ORIGINS") {
        for part in extra.split(',') {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            if let Ok(v) = part.parse() {
                origins.push(v);
            }
        }
    }
    // Electron may send Origin: null for file:// / custom schemes.
    if let Ok(v) = HeaderValue::from_str("null") {
        origins.push(v);
    }

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
        ])
        .allow_credentials(false)
}

pub fn router(state: AppState) -> Router {
    let media = ServeDir::new(&state.config.media_dir);
    let cors = build_cors(&state.config.public_url);
    // Multipart overhead (boundaries, headers) on top of the file itself.
    let upload_limit = usize::try_from(state.config.max_upload_bytes)
        .unwrap_or(usize::MAX)
        .saturating_add(64 * 1024);

    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/api/auth/register", post(auth_routes::register))
        .route("/api/auth/login", post(auth_routes::login))
        .route("/api/auth/refresh", post(auth_routes::refresh))
        .route(
            "/api/auth/me",
            get(auth_routes::me).patch(auth_routes::update_me),
        )
        .route(
            "/api/users/me",
            patch(auth_routes::update_me).delete(auth_routes::delete_account),
        )
        .route(
            "/api/users/me/password",
            put(auth_routes::change_password),
        )
        .route(
            "/api/users/me/disable",
            post(auth_routes::disable_account),
        )
        .route(
            "/api/users/by-username/{username}",
            get(friends::user_by_username),
        )
        .route("/api/crypto/identity", put(friends::put_identity))
        .route(
            "/api/crypto/identity/{user_id}",
            get(friends::get_identity),
        )
        .route(
            "/api/crypto/identity/{user_id}/history",
            get(friends::get_identity_history),
        )
        .route("/api/friends", get(friends::list_friends))
        .route("/api/friends/request", post(friends::request_friend))
        .route(
            "/api/friends/{id}/accept",
            post(friends::accept_friend),
        )
        .route(
            "/api/friends/{id}/decline",
            post(friends::decline_friend),
        )
        .route("/api/friends/{id}", delete(friends::remove_friend))
        .route("/api/friends/{id}/mute", post(friends::mute_friend))
        .route("/api/friends/{id}/block", post(friends::block_friend))
        .route("/api/dms", get(dms::list_dms))
        .route("/api/dms/groups", post(dms::create_group))
        .route("/api/dms/{id}/group", axum::routing::patch(dms::rename_group))
        .route("/api/dms/{id}/members", post(dms::add_group_member))
        .route(
            "/api/dms/{id}/members/{user_id}",
            axum::routing::delete(dms::remove_group_member),
        )
        .route(
            "/api/dms/{id}/messages",
            get(dms::list_messages).post(dms::create_message),
        )
        .route("/api/dms/{id}/close", post(dms::close_dm))
        .route("/api/dms/{id}/open", post(dms::open_dm))
        .route(
            "/api/dms/by-peer/{peer_id}/open",
            post(dms::open_dm_by_peer),
        )
        .route(
            "/api/dms/by-friendship/{friendship_id}/open",
            post(dms::open_dm_by_friendship),
        )
        .route(
            "/api/dms/messages/{id}",
            patch(dms::update_message).delete(dms::delete_message),
        )
        .route("/api/dms/{id}/typing", post(dms::typing))
        .route("/api/dms/{id}/call/token", post(dms::call_token))
        .route(
            "/api/dms/{id}/call/screen-token",
            post(dms::screen_call_token),
        )
        .route("/api/dms/{id}/call/state", put(dms::call_state))
        .route("/api/servers", get(servers::list).post(servers::create))
        .route(
            "/api/servers/{id}",
            get(servers::get).patch(servers::update).delete(servers::delete),
        )
        .route(
            "/api/servers/{id}/transfer-ownership",
            post(servers::transfer_ownership),
        )
        .route("/api/servers/{id}/leave", post(servers::leave_server))
        .route("/api/servers/{id}/members", get(servers::list_members))
        .route("/api/servers/{id}/presence", get(servers::list_presence))
        .route(
            "/api/servers/{id}/members/{user_id}",
            delete(servers::kick_member),
        )
        .route(
            "/api/servers/{id}/members/{user_id}/voice",
            put(servers::moderate_voice),
        )
        .route(
            "/api/servers/{id}/members/{user_id}/timeout",
            put(servers::timeout_member),
        )
        .route("/api/users/{user_id}/block", post(friends::block_user))
        .route("/api/users/{user_id}/profile", get(auth_routes::profile))
        .route("/api/users/me/custom-status", put(auth_routes::set_custom_status))
        .route("/api/users/{user_id}/note", get(community::get_note).put(community::set_note))
        .route("/api/servers/{id}/welcome", get(community::get_welcome).put(community::set_welcome))
        .route("/api/servers/{id}/events", get(community::list_events).post(community::create_event))
        .route("/api/events/{id}", delete(community::delete_event))
        .route("/api/events/{id}/rsvp", put(community::rsvp_event).delete(community::rsvp_event))
        .route("/api/dms/{id}/read", put(community::mark_dm_read))
        .route("/api/dms/{id}/reads", get(community::list_dm_reads))
        .route("/api/channels/{id}/watch", get(community::get_watch).post(community::watch_action))
        .route(
            "/api/servers/{id}/automod",
            get(servers::get_automod).put(servers::set_automod),
        )
        .route("/api/servers/{id}/audit-log", get(crate::audit::list))
        .route("/api/servers/{id}/bans", get(servers::list_bans).post(servers::ban_member))
        .route(
            "/api/servers/{id}/bans/{user_id}",
            delete(servers::unban_member),
        )
        .route(
            "/api/servers/{id}/invites",
            get(servers::list_invites).post(servers::create_invite),
        )
        .route(
            "/api/servers/{id}/invites/{code}",
            delete(servers::delete_invite),
        )
        .route(
            "/api/servers/{id}/invite-friend",
            post(servers::invite_friend),
        )
        .route(
            "/api/servers/{id}/emojis",
            get(emojis::list_server_emojis).post(emojis::create_server_emoji),
        )
        .route(
            "/api/servers/{id}/emojis/{emoji_id}",
            patch(emojis::rename_server_emoji).delete(emojis::delete_server_emoji),
        )
        .route("/api/users/me/emojis", get(emojis::list_my_emojis))
        .route(
            "/api/users/me/presence",
            get(presence::get_my_presence).put(presence::set_my_presence),
        )
        .route("/api/emojis/{emoji_id}", get(emojis::get_emoji))
        .route("/api/invites/{code}", get(servers::invite_info).post(servers::join_invite))
        .route(
            "/api/servers/{id}/roles",
            get(servers::list_roles).post(servers::create_role),
        )
        .route(
            "/api/servers/{id}/roles/{role_id}",
            patch(servers::update_role).delete(servers::delete_role),
        )
        .route(
            "/api/servers/{id}/members/{user_id}/roles",
            put(servers::set_member_roles),
        )
        .route(
            "/api/servers/{id}/rules",
            get(servers::list_rules).put(servers::set_rules),
        )
        .route(
            "/api/servers/{id}/rules/accept",
            post(servers::accept_rules),
        )
        .route(
            "/api/servers/{id}/channels",
            get(channels::list).post(channels::create),
        )
        .route(
            "/api/servers/{id}/channel-overwrites",
            get(channels::list_server_overwrites),
        )
        .route(
            "/api/channels/{id}",
            get(channels::get).patch(channels::update).delete(channels::delete),
        )
        .route(
            "/api/channels/{id}/duplicate",
            post(channels::duplicate),
        )
        .route(
            "/api/channels/{id}/overwrites",
            get(channels::list_overwrites).put(channels::set_overwrites),
        )
        .route(
            "/api/channels/{id}/invite",
            post(channels::invite_to_channel),
        )
        .route(
            "/api/channels/{id}/messages",
            get(messages::list).post(messages::create),
        )
        .route(
            "/api/messages/{id}",
            patch(messages::update).delete(messages::delete),
        )
        .route("/api/channels/{id}/polls", post(messages::create_poll))
        .route("/api/channels/{id}/groups", post(messages::create_group))
        .route(
            "/api/messages/{id}/group/join",
            put(messages::join_group).delete(messages::join_group),
        )
        .route("/api/messages/{id}/poll/vote", put(messages::vote_poll))
        .route("/api/messages/{id}/thread", post(messages::create_thread))
        .route(
            "/api/messages/{id}/pin",
            put(messages::pin).delete(messages::unpin),
        )
        .route("/api/channels/{id}/pins", get(messages::list_pins))
        .route("/api/servers/{id}/search", get(messages::search))
        .route(
            "/api/messages/{id}/reactions/{emoji}",
            put(messages::add_reaction).delete(messages::remove_reaction),
        )
        .route("/api/channels/{id}/typing", post(messages::typing))
        .route("/api/channels/{id}/voice/token", post(voice::token))
        .route(
            "/api/channels/{id}/voice/screen-token",
            post(voice::screen_token),
        )
        .route("/api/voice/state", put(voice::update_state).get(voice::list_states))
        .route(
            "/api/media/upload",
            post(media::upload).layer(DefaultBodyLimit::max(upload_limit)),
        )
        .route("/api/media/remote", post(media::register_remote))
        .route("/api/gifs/search", get(media::search_gifs))
        .route(
            "/api/diagnostics/memory",
            get(diagnostics::list_samples)
                .post(diagnostics::post_sample)
                .delete(diagnostics::clear_samples),
        )
        .route("/api/ws", get(ws_upgrade))
        .nest_service("/media", media)
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        // Audit log for moderation actions (see crate::audit).
        .layer(axum::middleware::from_fn_with_state(state.clone(), crate::audit::layer))
        // JSON bodies: 1 MB. The upload route overrides this above.
        .layer(DefaultBodyLimit::max(JSON_BODY_LIMIT))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// WebSocket subprotocol that carries the access token, so it is not in the
/// URL (URLs end up in proxy and access logs). The client offers
/// `speakapp.auth, <token>` and the server answers with `speakapp.auth`.
const WS_AUTH_PROTOCOL: &str = "speakapp.auth";

fn ws_token_from_protocols(headers: &HeaderMap) -> Option<String> {
    let offered: Vec<String> = headers
        .get_all(header::SEC_WEBSOCKET_PROTOCOL)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    if !offered.iter().any(|p| p == WS_AUTH_PROTOCOL) {
        return None;
    }
    offered.into_iter().find(|p| p != WS_AUTH_PROTOCOL)
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    // Only the subprotocol is accepted: a token in the URL ends up in logs.
    let token = ws_token_from_protocols(&headers).ok_or(AppError::Unauthorized)?;
    let claims = decode_token(&token, &state.config.jwt_secret)?;
    if claims.typ != "access" {
        return Err(AppError::Unauthorized);
    }
    let user_id = claims.sub;
    if crate::db::is_user_disabled(&state.db, user_id).await? {
        return Err(AppError::BadRequest("account disabled".into()));
    }
    // Prime the server membership cache (one query for all the user's servers).
    for (server_id, members) in crate::db::member_ids_of_users_servers(&state.db, user_id).await? {
        state.hub.set_server_members(server_id, members);
    }
    // Echo the auth subprotocol, or browsers reject the connection. Clients
    // don't send anything that needs more than a few KB, so big frames are
    // refused instead of buffered (the default allows 64 MB).
    let ws = ws
        .protocols([WS_AUTH_PROTOCOL])
        .max_message_size(16 * 1024)
        .max_frame_size(16 * 1024);
    Ok(ws.on_upgrade(move |socket| ws::handle_socket(socket, user_id, state)))
}

// silence unused AuthUser in this module
#[allow(dead_code)]
fn _auth(_: AuthUser) {}
