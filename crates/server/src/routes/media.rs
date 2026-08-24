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

    let key = state.config.imgbb_api_key.as_deref().ok_or_else(|| {
        AppError::BadRequest("image upload is not configured (set IMGBB_API_KEY)".into())
    })?;
    let url = upload_imgbb(key, &filename, &content_type, &data)
        .await
        .map_err(|e| AppError::BadRequest(format!("ImgBB upload failed: {e}")))?;

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

async fn upload_imgbb(
    api_key: &str,
    filename: &str,
    content_type: &str,
    data: &[u8],
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("EspalhaBrasas/0.1")
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::bytes(data.to_vec())
        .file_name(filename.to_string())
        .mime_str(content_type)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("image", part);
    let res = client
        .post("https://api.imgbb.com/1/upload")
        .query(&[("key", api_key)])
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() || body["success"].as_bool() != Some(true) {
        return Err(format!("rejected ({status}): {body}"));
    }
    body["data"]["url"]
        .as_str()
        .or_else(|| body["data"]["display_url"].as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "ImgBB response missing url".into())
}
