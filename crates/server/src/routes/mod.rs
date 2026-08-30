mod auth_routes;
mod bots;
mod channels;
mod dms;
mod emojis;
pub(crate) mod friends;
mod media;
mod messages;
mod presence;
mod servers;
mod webhooks;
pub(crate) mod voice;

use crate::auth::{decode_token, AuthUser};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::ws;
use axum::{
    extract::{Query, State, WebSocketUpgrade},
    http::{header, HeaderValue, Method},
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
    Router,
};
use serde::Deserialize;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

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
        .route("/api/servers", get(servers::list).post(servers::create))
        .route(
            "/api/servers/{id}",
            get(servers::get).patch(servers::update).delete(servers::delete),
        )
        .route(
            "/api/servers/{id}/transfer-ownership",
            post(servers::transfer_ownership),
        )
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
            "/api/channels/{id}/webhooks",
            get(webhooks::list).post(webhooks::create),
        )
        .route(
            "/api/webhooks/{id}",
            patch(webhooks::update).delete(webhooks::delete),
        )
        .route(
            "/api/webhooks/{id}/{token}",
            post(webhooks::execute),
        )
        .route(
            "/api/servers/{id}/bots",
            get(bots::list).post(bots::create),
        )
        .route("/api/bots/{id}", delete(bots::delete))
        .route("/api/bots/me", get(bots::me))
        .route(
            "/api/channels/{id}/messages",
            get(messages::list).post(messages::create),
        )
        .route(
            "/api/messages/{id}",
            patch(messages::update).delete(messages::delete),
        )
        .route(
            "/api/messages/{id}/reactions/{emoji}",
            put(messages::add_reaction).delete(messages::remove_reaction),
        )
        .route("/api/channels/{id}/typing", post(messages::typing))
        .route("/api/channels/{id}/voice/token", post(voice::token))
        .route("/api/voice/state", put(voice::update_state).get(voice::list_states))
        .route("/api/media/upload", post(media::upload))
        .route("/api/media/imgbb-key", get(media::imgbb_upload_key))
        .route("/api/media/remote", post(media::register_remote))
        .route("/api/gifs/search", get(media::search_gifs))
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
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[derive(Deserialize)]
struct WsQuery {
    token: String,
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(q): Query<WsQuery>,
) -> AppResult<impl IntoResponse> {
    let claims = decode_token(&q.token, &state.config.jwt_secret)?;
    if claims.typ != "access" {
        return Err(AppError::Unauthorized);
    }
    let user_id = claims.sub;
    if crate::db::is_user_disabled(&state.db, user_id).await? {
        return Err(AppError::BadRequest("account disabled".into()));
    }
    // Prime server membership cache
    let servers = crate::db::user_servers(&state.db, user_id).await?;
    for s in &servers {
        let members = crate::db::server_member_ids(&state.db, s.id).await?;
        state.hub.set_server_members(s.id, members);
    }
    Ok(ws.on_upgrade(move |socket| ws::handle_socket(socket, user_id, state)))
}

// silence unused AuthUser in this module
#[allow(dead_code)]
fn _auth(_: AuthUser) {}
