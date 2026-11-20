use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error("not found")]
    NotFound,
    #[error("conflict: {0}")]
    Conflict(String),
    /// 429 with `Retry-After` set to the wait time (rounded up, at least 1s).
    #[error("too many requests")]
    TooManyRequests(std::time::Duration),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        if let AppError::TooManyRequests(wait) = &self {
            let secs = wait.as_secs() + u64::from(wait.subsec_nanos() > 0);
            let secs = secs.max(1);
            let mut res = (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({
                    "error": format!("too many requests, try again in {secs}s"),
                    "retry_after": secs,
                })),
            )
                .into_response();
            if let Ok(v) = HeaderValue::from_str(&secs.to_string()) {
                res.headers_mut().insert(header::RETRY_AFTER, v);
            }
            return res;
        }
        let (status, message) = match &self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m.clone()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized".into()),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "forbidden".into()),
            AppError::NotFound => (StatusCode::NOT_FOUND, "not found".into()),
            AppError::Conflict(m) => (StatusCode::CONFLICT, m.clone()),
            AppError::TooManyRequests(_) => unreachable!("handled above"),
            AppError::Internal(e) => {
                tracing::error!("internal error: {e:?}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error".into())
            }
            AppError::Sqlx(e) => {
                tracing::error!("db error: {e:?}");
                (StatusCode::INTERNAL_SERVER_ERROR, "database error".into())
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
