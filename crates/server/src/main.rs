mod auth;
mod config;
mod db;
mod error;
mod livekit;
mod ratelimit;
mod routes;
mod state;
mod templates;
mod ws;

#[cfg(test)]
mod tests;

use crate::config::Config;
use crate::state::AppState;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            "speakapp_server=info,tower_http=info,axum=info".into()
        }))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env()?;
    let state = AppState::new(config.clone()).await?;
    let app = routes::router(state);

    let listener = tokio::net::TcpListener::bind(&config.bind).await.map_err(|e| {
        anyhow::anyhow!(
            "failed to bind {}: {e} (is another speakapp-server already running?)",
            config.bind
        )
    })?;
    tracing::info!("Espalha Brasas server listening on {}", config.bind);
    // Peer address feeds the per-IP rate limits (see ratelimit::ClientIp).
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
        .await
        .map_err(|e| anyhow::anyhow!("server stopped: {e}"))?;
    tracing::info!("Espalha Brasas server shut down cleanly");
    Ok(())
}
