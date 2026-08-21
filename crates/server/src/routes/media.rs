use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    extract::{Multipart, State},
    Json,
};
use serde::Serialize;
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

    let id = Uuid::new_v4();
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");
    let stored = format!("{id}.{ext}");
    let path = state.config.media_dir.join(&stored);
    tokio::fs::write(&path, &data)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    let url = format!("{}/media/{}", state.config.public_url.trim_end_matches('/'), stored);

    // Pending attachment row (linked when message is sent); also usable as avatar/bg URL directly
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
