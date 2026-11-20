use crate::config::Config;
use crate::ratelimit::{RateLimiter, TrustedProxies};
use crate::ws::WsHub;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub config: Arc<Config>,
    pub hub: WsHub,
    pub limits: Arc<RateLimiter>,
    pub trusted_proxies: Arc<TrustedProxies>,
}

impl AppState {
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        std::fs::create_dir_all(&config.media_dir)?;
        let in_memory = config.database_url.contains(":memory:");
        if in_memory {
            // nothing to create on disk
        } else if let Some(parent) = std::path::Path::new(
            config
                .database_url
                .trim_start_matches("sqlite://")
                .split('?')
                .next()
                .unwrap_or("data/speakapp.db"),
        )
        .parent()
        {
            std::fs::create_dir_all(parent)?;
        }

        let options = SqliteConnectOptions::from_str(&config.database_url)?
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

        let db = SqlitePoolOptions::new()
            // Every connection to `:memory:` is its own database, so tests use one.
            .max_connections(if in_memory { 1 } else { 8 })
            .idle_timeout(if in_memory { None } else { Some(std::time::Duration::from_secs(600)) })
            .max_lifetime(if in_memory { None } else { Some(std::time::Duration::from_secs(1800)) })
            .connect_with(options)
            .await?;

        sqlx::migrate!("./migrations").run(&db).await?;

        Ok(Self {
            db,
            config: Arc::new(config),
            hub: WsHub::new(),
            limits: Arc::new(RateLimiter::new()),
            trusted_proxies: Arc::new(TrustedProxies::from_env()),
        })
    }
}
