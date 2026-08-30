use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    extract::{Multipart, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize)]
pub struct UploadResponse {
    pub id: Uuid,
    pub url: String,
    pub filename: String,
    pub content_type: String,
    pub size: u64,
}

#[derive(Deserialize)]
pub struct RemoteMediaBody {
    pub url: String,
    pub filename: Option<String>,
    pub content_type: Option<String>,
    pub size: Option<u64>,
}

#[derive(Deserialize)]
pub struct GifSearchQuery {
    pub q: Option<String>,
}

#[derive(Serialize)]
pub struct GifHit {
    pub id: String,
    pub title: String,
    pub preview_url: String,
    pub url: String,
}

#[derive(Serialize)]
pub struct GifSearchResponse {
    pub gifs: Vec<GifHit>,
}

#[derive(Serialize)]
pub struct ImgbbKeyResponse {
    pub key: String,
}

pub async fn imgbb_upload_key(
    State(state): State<AppState>,
    _user: AuthUser,
) -> AppResult<Json<ImgbbKeyResponse>> {
    let key = state.config.imgbb_api_key.as_deref().ok_or_else(|| {
        AppError::BadRequest("image upload is not configured (set IMGBB_API_KEY)".into())
    })?;
    Ok(Json(ImgbbKeyResponse {
        key: key.to_string(),
    }))
}

pub async fn upload(
    State(state): State<AppState>,
    user: AuthUser,
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
    if !content_type.to_ascii_lowercase().starts_with("image/") {
        return Err(AppError::BadRequest(
            "only images can be uploaded here; other files must use temporary external hosting"
                .into(),
        ));
    }
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

    insert_attachment(&state, user.id, &filename, &content_type, data.len() as i64, &url).await
}

pub async fn register_remote(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<RemoteMediaBody>,
) -> AppResult<Json<UploadResponse>> {
    let url = body.url.trim().to_string();
    if !is_allowed_remote_url(&url) {
        return Err(AppError::BadRequest(
            "URL host is not allowed (ImgBB / Klipy / Litterbox / Catbox only)".into(),
        ));
    }
    let filename = body
        .filename
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            if is_klipy_url(&url) {
                "gif.gif".into()
            } else {
                "file.bin".into()
            }
        });
    let content_type = body
        .content_type
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            if is_klipy_url(&url) {
                "image/gif".into()
            } else {
                "application/octet-stream".into()
            }
        });
    let reported = body.size.unwrap_or(0);
    if reported > state.config.max_upload_bytes {
        return Err(AppError::BadRequest("file too large".into()));
    }
    insert_attachment(
        &state,
        user.id,
        &filename,
        &content_type,
        reported as i64,
        &url,
    )
    .await
}

pub async fn search_gifs(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(q): Query<GifSearchQuery>,
) -> AppResult<Json<GifSearchResponse>> {
    let key = state.config.klipy_api_key.as_deref().ok_or_else(|| {
        AppError::BadRequest("GIF search is not configured (set KLIPY_API_KEY)".into())
    })?;
    let query = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let gifs = fetch_klipy(key, query)
        .await
        .map_err(|e| AppError::BadRequest(format!("GIF search failed: {e}")))?;
    Ok(Json(GifSearchResponse { gifs }))
}

async fn insert_attachment(
    state: &AppState,
    uploader_id: Uuid,
    filename: &str,
    content_type: &str,
    size: i64,
    url: &str,
) -> AppResult<Json<UploadResponse>> {
    let id = Uuid::new_v4();
    // Sanitize filename: strip path components to avoid client-side confusion.
    let safe_name = filename
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("upload.bin")
        .chars()
        .take(180)
        .collect::<String>();
    sqlx::query(
        "INSERT INTO attachments (id, message_id, filename, content_type, size, url, uploader_id) VALUES (?, NULL, ?, ?, ?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(&safe_name)
    .bind(content_type)
    .bind(size)
    .bind(url)
    .bind(uploader_id.to_string())
    .execute(&state.db)
    .await?;

    Ok(Json(UploadResponse {
        id,
        url: url.to_string(),
        filename: safe_name,
        content_type: content_type.to_string(),
        size: size as u64,
    }))
}

fn is_klipy_url(raw: &str) -> bool {
    host_matches(raw, |h| h == "klipy.com" || h.ends_with(".klipy.com"))
}

fn is_imgbb_url(raw: &str) -> bool {
    host_matches(raw, |h| {
        h == "ibb.co"
            || h.ends_with(".ibb.co")
            || h == "imgbb.com"
            || h.ends_with(".imgbb.com")
    })
}

/// HTTPS hosts we trust for URL-only attachment registration (bytes never stored on this server).
fn is_allowed_remote_url(raw: &str) -> bool {
    is_klipy_url(raw)
        || is_imgbb_url(raw)
        || host_matches(raw, |h| {
            h == "litter.catbox.moe" || h == "files.catbox.moe"
        })
}

fn host_matches(raw: &str, pred: impl FnOnce(&str) -> bool) -> bool {
    let Ok(parsed) = reqwest::Url::parse(raw) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    parsed
        .host_str()
        .map(|h| pred(&h.to_ascii_lowercase()))
        .unwrap_or(false)
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("EspalhaBrasas/0.1")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch_klipy(api_key: &str, query: Option<&str>) -> Result<Vec<GifHit>, String> {
    let key = api_key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        .then_some(api_key)
        .ok_or_else(|| "invalid KLIPY_API_KEY".to_string())?;
    let path = if query.is_some() {
        format!("https://api.klipy.com/api/v1/{key}/gifs/search")
    } else {
        format!("https://api.klipy.com/api/v1/{key}/gifs/trending")
    };
    let client = http_client()?;
    let mut req = client.get(&path).query(&[("per_page", "24")]);
    if let Some(q) = query {
        req = req.query(&[("q", q)]);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("rejected ({status}): {body}"));
    }
    let items = klipy_items(&body);
    let mut out = Vec::new();
    for item in items {
        if item["type"].as_str() == Some("ad") {
            continue;
        }
        let id = item["id"]
            .as_str()
            .map(|s| s.to_string())
            .or_else(|| item["id"].as_u64().map(|n| n.to_string()))
            .or_else(|| item["slug"].as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let title = item["title"].as_str().unwrap_or("gif").to_string();
        let files = if item["file"].is_object() {
            &item["file"]
        } else {
            &item["files"]
        };
        let url = klipy_media_url(files, &["md", "hd", "sm", "xs"]);
        let preview = klipy_media_url(files, &["xs", "sm", "md", "hd"]);
        let (Some(url), Some(preview)) = (url, preview) else {
            continue;
        };
        if !is_klipy_url(&url) || !is_klipy_url(&preview) {
            continue;
        }
        out.push(GifHit {
            id: if id.is_empty() { url.clone() } else { id },
            title,
            preview_url: preview,
            url,
        });
    }
    Ok(out)
}

fn klipy_items(body: &serde_json::Value) -> Vec<serde_json::Value> {
    let data = &body["data"];
    if let Some(arr) = data["data"].as_array() {
        return arr.clone();
    }
    if let Some(arr) = data.as_array() {
        return arr.clone();
    }
    Vec::new()
}

fn klipy_media_url(files: &serde_json::Value, sizes: &[&str]) -> Option<String> {
    for size in sizes {
        for fmt in ["gif", "webp"] {
            if let Some(url) = files[size][fmt]["url"].as_str() {
                if url.starts_with("https://") {
                    return Some(url.to_string());
                }
            }
        }
    }
    None
}

async fn upload_imgbb(
    api_key: &str,
    filename: &str,
    content_type: &str,
    data: &[u8],
) -> Result<String, String> {
    let client = http_client()?;
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
