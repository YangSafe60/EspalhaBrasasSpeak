use serde::Deserialize;
use std::env;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub bind: String,
    pub database_url: String,
    pub jwt_secret: String,
    pub media_dir: PathBuf,
    pub public_url: String,
    pub livekit_url: String,
    pub livekit_api_key: String,
    pub livekit_api_secret: String,
    pub max_upload_bytes: u64,
    pub imgbb_api_key: Option<String>,
    pub klipy_api_key: Option<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let jwt_secret = env::var("JWT_SECRET")
            .unwrap_or_else(|_| "dev-secret-change-me-in-production".into());
        let livekit_api_secret = env::var("LIVEKIT_API_SECRET").unwrap_or_else(|_| {
            "espalha_brasas_dev_livekit_secret_32b".into()
        });
        let allow_insecure =
            env::var("SPEAKAPP_ALLOW_INSECURE_SECRETS").as_deref() == Ok("1");
        let is_prod_like = env::var("SPEAKAPP_ENV")
            .map(|v| {
                let v = v.to_ascii_lowercase();
                v == "production" || v == "prod"
            })
            .unwrap_or(false);

        if !allow_insecure {
            let weak_jwt = jwt_secret.len() < 32
                || jwt_secret == "dev-secret-change-me-in-production"
                || jwt_secret == "change-me-please";
            let weak_lk = livekit_api_secret.len() < 32
                || livekit_api_secret == "espalha_brasas_dev_livekit_secret_32b"
                || livekit_api_secret == "secret";
            if is_prod_like && (weak_jwt || weak_lk) {
                anyhow::bail!(
                    "refusing to start with weak JWT_SECRET / LIVEKIT_API_SECRET in production; \
                     set strong secrets (≥32 chars) or SPEAKAPP_ALLOW_INSECURE_SECRETS=1 for local-only"
                );
            }
            if weak_jwt {
                tracing::warn!(
                    "JWT_SECRET is weak/default — set a long random secret before any public deploy"
                );
            }
            if weak_lk {
                tracing::warn!(
                    "LIVEKIT_API_SECRET is weak/default — set a strong secret before any public deploy"
                );
            }
        }

        Ok(Self {
            bind: env::var("SPEAKAPP_BIND").unwrap_or_else(|_| "0.0.0.0:8080".into()),
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite://data/speakapp.db?mode=rwc".into()),
            jwt_secret,
            media_dir: PathBuf::from(
                env::var("MEDIA_DIR").unwrap_or_else(|_| "data/media".into()),
            ),
            public_url: env::var("PUBLIC_URL")
                .unwrap_or_else(|_| "http://localhost:8080".into()),
            livekit_url: env::var("LIVEKIT_URL")
                .unwrap_or_else(|_| "ws://localhost:7880".into()),
            livekit_api_key: env::var("LIVEKIT_API_KEY").unwrap_or_else(|_| "devkey".into()),
            livekit_api_secret,
            max_upload_bytes: env::var("MAX_UPLOAD_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(25 * 1024 * 1024),
            imgbb_api_key: env::var("IMGBB_API_KEY")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            klipy_api_key: env::var("KLIPY_API_KEY")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
        })
    }

    /// URL embedded in voice tokens for desktop clients.
    /// Rewrites loopback / Docker-only hosts using PUBLIC_URL so VPS deploys
    /// don't hand clients `ws://127.0.0.1:7880`.
    pub fn client_livekit_url(&self) -> String {
        let url = self
            .livekit_url
            .trim()
            .trim_end_matches('/')
            .replace("://localhost", "://127.0.0.1");

        let Some(lk_host) = url_host(&url) else {
            return url;
        };
        if !is_unusable_livekit_host(&lk_host) {
            return url;
        }

        let Some(pub_host) = url_host(&self.public_url) else {
            return url;
        };
        if is_unusable_livekit_host(&pub_host) {
            // Local dev — keep loopback.
            return url;
        }

        // IP / host without a dedicated LiveKit subdomain: direct :7880 (compose publishes it).
        let rewritten = format!("ws://{}:7880", pub_host);
        tracing::warn!(
            livekit = %rewritten,
            "LIVEKIT_URL was loopback/docker-internal; rewritten from PUBLIC_URL for clients"
        );
        rewritten
    }
}

fn is_unusable_livekit_host(host: &str) -> bool {
    matches!(
        host,
        "127.0.0.1" | "localhost" | "::1" | "livekit" | "0.0.0.0"
    )
}

/// Host from `scheme://host[:port]/path` (IPv4 / hostname; not IPv6).
fn url_host(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1)?;
    let authority = rest.split('/').next()?;
    let hostport = authority.split('@').next_back()?;
    if let Some((host, port)) = hostport.rsplit_once(':') {
        if port.chars().all(|c| c.is_ascii_digit()) {
            return Some(host.to_string());
        }
    }
    Some(hostport.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bare(public_url: &str, livekit_url: &str) -> Config {
        Config {
            bind: String::new(),
            database_url: String::new(),
            jwt_secret: String::new(),
            media_dir: PathBuf::new(),
            public_url: public_url.into(),
            livekit_url: livekit_url.into(),
            livekit_api_key: String::new(),
            livekit_api_secret: String::new(),
            max_upload_bytes: 0,
            imgbb_api_key: None,
            klipy_api_key: None,
        }
    }

    #[test]
    fn rewrites_loopback_livekit_using_public_ip() {
        let cfg = bare("http://130.61.1.2:8080", "ws://127.0.0.1:7880");
        assert_eq!(cfg.client_livekit_url(), "ws://130.61.1.2:7880");
    }

    #[test]
    fn rewrites_docker_hostname() {
        let cfg = bare("http://130.61.1.2:8080", "ws://livekit:7880");
        assert_eq!(cfg.client_livekit_url(), "ws://130.61.1.2:7880");
    }

    #[test]
    fn keeps_explicit_public_livekit() {
        let cfg = bare("https://chat.example.com", "wss://livekit.example.com");
        assert_eq!(cfg.client_livekit_url(), "wss://livekit.example.com");
    }

    #[test]
    fn local_dev_keeps_loopback() {
        let cfg = bare("http://127.0.0.1:8080", "ws://127.0.0.1:7880");
        assert_eq!(cfg.client_livekit_url(), "ws://127.0.0.1:7880");
    }
}
