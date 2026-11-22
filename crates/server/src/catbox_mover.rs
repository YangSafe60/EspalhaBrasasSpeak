//! Moves temporary attachments (Litterbox, 72 h) to Catbox for good.
//!
//! When Catbox is down, the app uploads encrypted attachments to Litterbox
//! instead and marks them temporary. Every hour this job copies those bytes
//! (still encrypted: the server never has the key's plaintext use, it just
//! moves ciphertext in memory, nothing is written to disk) to Catbox, checks
//! the stored size, and switches the attachment's link. If Catbox stays
//! down until the Litterbox copy expires, the file is gone.

use crate::state::AppState;
use chrono::Utc;
use std::time::Duration;

const EVERY: Duration = Duration::from_secs(60 * 60);
const MAX_BYTES: usize = 26 * 1024 * 1024;

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        // First pass shortly after start, then hourly.
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            if let Err(e) = run_once(&state).await {
                tracing::warn!("catbox mover: {e}");
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("EspalhaBrasas/0.1")
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

/// Try every pending attachment once. Returns how many were moved.
pub async fn run_once(state: &AppState) -> Result<usize, String> {
    let now = Utc::now().to_rfc3339();
    // Expired copies can't be recovered: stop trying.
    let _ = sqlx::query("UPDATE attachments SET temporary_until = NULL WHERE temporary_until IS NOT NULL AND temporary_until < ? AND url LIKE 'https://litter.catbox.moe/%'")
        .bind(&now)
        .execute(&state.db)
        .await;
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, url FROM attachments WHERE temporary_until IS NOT NULL AND temporary_until >= ? LIMIT 50",
    )
    .bind(&now)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    if rows.is_empty() {
        return Ok(0);
    }
    let http = client()?;
    let mut moved = 0;
    for (id, url) in rows {
        match move_one(&http, &url).await {
            Ok(new_url) => {
                let _ = sqlx::query("UPDATE attachments SET url = ?, temporary_until = NULL WHERE id = ?")
                    .bind(&new_url)
                    .bind(&id)
                    .execute(&state.db)
                    .await;
                moved += 1;
            }
            Err(e) => {
                tracing::info!("catbox mover: {id} not moved yet: {e}");
                // Catbox down for one file is down for all: wait for the next run.
                if e.starts_with("catbox") {
                    break;
                }
            }
        }
    }
    if moved > 0 {
        tracing::info!("catbox mover: moved {moved} attachment(s) to Catbox");
    }
    Ok(moved)
}

async fn move_one(http: &reqwest::Client, url: &str) -> Result<String, String> {
    let res = http.get(url).send().await.map_err(|e| format!("download: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("download: HTTP {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| format!("download: {e}"))?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("download: bad size".into());
    }
    upload_to_catbox(http, &bytes).await
}

/// Same rules as the desktop app: retry empty replies with the same bytes,
/// and only accept a link whose stored size matches.
async fn upload_to_catbox(http: &reqwest::Client, bytes: &[u8]) -> Result<String, String> {
    for wait in [0u64, 1000, 3000] {
        if wait > 0 {
            tokio::time::sleep(Duration::from_millis(wait)).await;
        }
        let part = reqwest::multipart::Part::bytes(bytes.to_vec())
            .file_name("file.dat")
            .mime_str("application/octet-stream")
            .map_err(|e| e.to_string())?;
        let form = reqwest::multipart::Form::new()
            .text("reqtype", "fileupload")
            .part("fileToUpload", part);
        let Ok(res) = http.post("https://catbox.moe/user/api.php").multipart(form).send().await else {
            continue;
        };
        let text = res.text().await.unwrap_or_default().trim().to_string();
        if text.starts_with("https://files.catbox.moe/") {
            let stored = http
                .head(&text)
                .send()
                .await
                .ok()
                .and_then(|r| r.headers().get("content-length")?.to_str().ok()?.parse::<usize>().ok());
            if stored == Some(bytes.len()) {
                return Ok(text);
            }
            continue;
        }
        if !text.is_empty() {
            return Err(format!("catbox refused: {}", text.chars().take(120).collect::<String>()));
        }
    }
    Err("catbox unavailable".into())
}
