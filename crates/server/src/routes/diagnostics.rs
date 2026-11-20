//! Opt-in desktop memory diagnostics. The app posts one sample every ~10 s
//! while the user has it turned on; samples are kept 7 days and are only
//! visible to the user who sent them. Each sample is also written to the
//! server log as a `memlog` line.

use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::ratelimit::Limit;
use crate::state::AppState;
use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration as StdDuration;

/// Two samples per 10 s leaves room for jitter around the 10 s interval.
const MEMORY_SAMPLE: Limit = Limit {
    name: "memsample",
    max: 2,
    period: StdDuration::from_secs(10),
};
const KEEP_DAYS: i64 = 7;
const MAX_PROCESSES: usize = 64;
const MAX_LABEL: usize = 64;
const MAX_MB: u32 = 1_000_000;
const MAX_LIST: i64 = 5000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessSample {
    /// Electron process type: Browser, Tab, GPU, Utility…
    pub kind: String,
    /// Which window: main-window, voice-host, screen-host:<id>, popout, or "".
    #[serde(default)]
    pub label: String,
    pub mb: u32,
}

#[derive(Deserialize)]
pub struct PostSampleReq {
    pub total_mb: u32,
    pub processes: Vec<ProcessSample>,
    pub app_version: Option<String>,
}

#[derive(Serialize)]
pub struct MemorySample {
    pub created_at: DateTime<Utc>,
    pub app_version: Option<String>,
    pub total_mb: u32,
    pub processes: Vec<ProcessSample>,
}

#[derive(Deserialize)]
pub struct ListQuery {
    /// Only samples at or after this time (RFC 3339).
    pub since: Option<DateTime<Utc>>,
    pub limit: Option<i64>,
}

fn clean(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control())
        .take(MAX_LABEL)
        .collect()
}

pub async fn post_sample(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<PostSampleReq>,
) -> AppResult<Json<serde_json::Value>> {
    state
        .limits
        .check(MEMORY_SAMPLE, &format!("user:{}", user.id))?;
    if body.processes.is_empty() || body.processes.len() > MAX_PROCESSES {
        return Err(AppError::BadRequest("invalid process list".into()));
    }
    if body.total_mb > MAX_MB || body.processes.iter().any(|p| p.mb > MAX_MB) {
        return Err(AppError::BadRequest("invalid memory value".into()));
    }
    let processes: Vec<ProcessSample> = body
        .processes
        .iter()
        .map(|p| ProcessSample {
            kind: clean(&p.kind),
            label: clean(&p.label),
            mb: p.mb,
        })
        .collect();
    let app_version = body.app_version.as_deref().map(clean);
    let now = Utc::now();

    sqlx::query(
        "INSERT INTO memory_samples (user_id, created_at, app_version, total_mb, processes) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(user.id.to_string())
    .bind(now.to_rfc3339())
    .bind(app_version.as_deref())
    .bind(body.total_mb as i64)
    .bind(serde_json::to_string(&processes).map_err(anyhow::Error::from)?)
    .execute(&state.db)
    .await?;

    // Drop this user's samples older than the retention window.
    sqlx::query("DELETE FROM memory_samples WHERE user_id = ? AND created_at < ?")
        .bind(user.id.to_string())
        .bind((now - Duration::days(KEEP_DAYS)).to_rfc3339())
        .execute(&state.db)
        .await?;

    let summary = processes
        .iter()
        .map(|p| {
            if p.label.is_empty() {
                format!("{}={}MB", p.kind, p.mb)
            } else {
                format!("{}[{}]={}MB", p.kind, p.label, p.mb)
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    tracing::info!(
        "memlog user={} version={} total={}MB {}",
        user.id,
        app_version.as_deref().unwrap_or("?"),
        body.total_mb,
        summary
    );
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn list_samples(
    State(state): State<AppState>,
    user: AuthUser,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Vec<MemorySample>>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        created_at: String,
        app_version: Option<String>,
        total_mb: i64,
        processes: String,
    }
    let since = q
        .since
        .unwrap_or_else(|| Utc::now() - Duration::days(KEEP_DAYS))
        .to_rfc3339();
    let limit = q.limit.unwrap_or(MAX_LIST).clamp(1, MAX_LIST);
    // Newest `limit` samples, returned oldest first.
    let mut rows = sqlx::query_as::<_, Row>(
        "SELECT created_at, app_version, total_mb, processes FROM memory_samples WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?",
    )
    .bind(user.id.to_string())
    .bind(since)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;
    rows.reverse();
    Ok(Json(
        rows.into_iter()
            .map(|r| MemorySample {
                created_at: DateTime::parse_from_rfc3339(&r.created_at)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                app_version: r.app_version,
                total_mb: r.total_mb.max(0) as u32,
                processes: serde_json::from_str(&r.processes).unwrap_or_default(),
            })
            .collect(),
    ))
}

pub async fn clear_samples(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    let res = sqlx::query("DELETE FROM memory_samples WHERE user_id = ?")
        .bind(user.id.to_string())
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "deleted": res.rows_affected() })))
}
