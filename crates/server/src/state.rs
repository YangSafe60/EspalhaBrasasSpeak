use crate::config::Config;
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
}

impl AppState {
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        std::fs::create_dir_all(&config.media_dir)?;
        if let Some(parent) = std::path::Path::new(
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
            .max_connections(8)
            .connect_with(options)
            .await?;

        sqlx::migrate!("./migrations").run(&db).await?;

        Ok(Self {
            db,
            config: Arc::new(config),
            hub: WsHub::new(),
        })
    }
}
