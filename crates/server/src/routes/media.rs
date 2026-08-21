use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    extract::{Multipart, State},
    Json,
};
use serde::Serialize;
use std::path::Path;
use uuid::Uuid;

#[derive(Serialize)]
pub struct UploadResponse {
    pub id: Uuid,
    pub url: String,
    pub filename: String,
    pub content_type: String,
    pub size: u64,
}

pub async fn upload(
    State(state): State<AppState>,
    _user: AuthUser,
    mut multipart: Multipart,
) -> AppResult<Json<UploadResponse>> {
    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
        .ok_or_else(|| AppError::BadRequest("file required".into()))?;

    let filename = field
        .file_name()
        .unwrap_or("upload.bin")
        .to_string();
    let content_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();
    let data = field
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    if data.len() as u64 > state.config.max_upload_bytes {
        return Err(AppError::BadRequest("file too large".into()));
    }

    // Prefer catbox; fall back to local /media when the host is unreachable.
    let url = match upload_catbox(&filename, &content_type, &data).await {
        Ok(url) => url,
        Err(err) => {
            tracing::warn!(error = %err, "catbox upload failed; storing file locally");
            store_local(&state, &filename, &data).await?
        }
    };

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO attachments (id, message_id, filename, content_type, size, url) VALUES (?, NULL, ?, ?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(&filename)
    .bind(&content_type)
    .bind(data.len() as i64)
    .bind(&url)
    .execute(&state.db)
    .await?;

    Ok(Json(UploadResponse {
        id,
        url,
        filename,
        content_type,
        size: data.len() as u64,
    }))
}

fn sanitize_filename(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("upload.bin");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "upload.bin".into()
    } else {
        cleaned
    }
}

async fn store_local(state: &AppState, filename: &str, data: &[u8]) -> AppResult<String> {
    let id = Uuid::new_v4();
    let safe = sanitize_filename(filename);
    let stored = format!("{id}_{safe}");
    let path = state.config.media_dir.join(&stored);
    tokio::fs::create_dir_all(&state.config.media_dir)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    tokio::fs::write(&path, data)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    let base = state.config.public_url.trim_end_matches('/');
    Ok(format!("{base}/media/{stored}"))
}

async fn upload_catbox(filename: &str, content_type: &str, data: &[u8]) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("EspalhaBrasas/0.1")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::bytes(data.to_vec())
        .file_name(filename.to_string())
        .mime_str(content_type)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("reqtype", "fileupload")
        .part("fileToUpload", part);

    let res = client
        .post("https://catbox.moe/user/api.php")
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?.trim().to_string();

    if !status.is_success() || !text.starts_with("http") {
        return Err(format!("image host rejected upload: {text}"));
    }
    Ok(text)
}
