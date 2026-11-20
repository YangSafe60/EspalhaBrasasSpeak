//! In-memory sliding-window rate limiter and client-IP resolution.
//!
//! Limits are per process (one API instance), which is how the server is
//! deployed. Keys look like `login:203.0.113.7` or `msg:<user id>`.

use crate::error::AppError;
use crate::state::AppState;
use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::request::Parts,
};
use dashmap::DashMap;
use std::collections::VecDeque;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// A named limit: at most `max` hits per `period`.
#[derive(Clone, Copy, Debug)]
pub struct Limit {
    pub name: &'static str,
    pub max: usize,
    pub period: Duration,
}

pub const LOGIN: Limit = Limit {
    name: "login",
    max: 5,
    period: Duration::from_secs(60),
};
pub const REGISTER: Limit = Limit {
    name: "register",
    max: 3,
    period: Duration::from_secs(60 * 60),
};
pub const REFRESH: Limit = Limit {
    name: "refresh",
    max: 30,
    period: Duration::from_secs(60),
};
/// Shared by channel messages and DMs.
pub const MESSAGE: Limit = Limit {
    name: "msg",
    max: 10,
    period: Duration::from_secs(10),
};

/// Longest period of any limit; entries idle longer than this are dropped.
const MAX_PERIOD: Duration = Duration::from_secs(60 * 60);
const SWEEP_EVERY: u64 = 1024;

#[derive(Default)]
pub struct RateLimiter {
    hits: DashMap<String, VecDeque<Instant>>,
    calls: AtomicU64,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records a hit for `key` under `limit`. Returns `TooManyRequests` with
    /// the time until the oldest hit in the window expires when over the limit
    /// (the rejected hit is not recorded).
    pub fn check(&self, limit: Limit, key: &str) -> Result<(), AppError> {
        self.check_at(limit, key, Instant::now())
    }

    fn check_at(&self, limit: Limit, key: &str, now: Instant) -> Result<(), AppError> {
        if self.calls.fetch_add(1, Ordering::Relaxed) % SWEEP_EVERY == SWEEP_EVERY - 1 {
            self.sweep(now);
        }
        let full_key = format!("{}:{}", limit.name, key);
        let mut entry = self.hits.entry(full_key).or_default();
        let window = entry.value_mut();
        while let Some(&oldest) = window.front() {
            if now.duration_since(oldest) >= limit.period {
                window.pop_front();
            } else {
                break;
            }
        }
        if window.len() >= limit.max {
            let oldest = *window.front().expect("non-empty when at limit");
            let retry = limit.period.saturating_sub(now.duration_since(oldest));
            return Err(AppError::TooManyRequests(retry));
        }
        window.push_back(now);
        Ok(())
    }

    fn sweep(&self, now: Instant) {
        self.hits.retain(|_, w| {
            w.back()
                .map(|&last| now.duration_since(last) < MAX_PERIOD)
                .unwrap_or(false)
        });
    }
}

/// Networks whose `X-Forwarded-For` header is trusted (the reverse proxy).
#[derive(Clone, Debug)]
pub struct TrustedProxies(Vec<(IpAddr, u8)>);

impl TrustedProxies {
    /// `TRUSTED_PROXIES` = comma-separated IPs or CIDRs. Default: loopback and
    /// private ranges, which covers Caddy on the same host or Docker network
    /// while never trusting a header sent straight from the internet.
    pub fn from_env() -> Self {
        match std::env::var("TRUSTED_PROXIES") {
            Ok(raw) if !raw.trim().is_empty() => Self::parse(&raw),
            _ => Self::default_private(),
        }
    }

    pub fn parse(raw: &str) -> Self {
        let nets = raw
            .split(',')
            .filter_map(|part| parse_cidr(part.trim()))
            .collect();
        Self(nets)
    }

    pub fn default_private() -> Self {
        Self::parse("127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7")
    }

    pub fn contains(&self, ip: IpAddr) -> bool {
        let ip = canonical(ip);
        self.0.iter().any(|&(net, bits)| in_net(ip, net, bits))
    }
}

fn parse_cidr(s: &str) -> Option<(IpAddr, u8)> {
    if s.is_empty() {
        return None;
    }
    let (addr, bits) = match s.split_once('/') {
        Some((a, b)) => (a.parse::<IpAddr>().ok()?, b.parse::<u8>().ok()?),
        None => {
            let a = s.parse::<IpAddr>().ok()?;
            (a, if a.is_ipv4() { 32 } else { 128 })
        }
    };
    let max = if addr.is_ipv4() { 32 } else { 128 };
    (bits <= max).then_some((canonical(addr), bits))
}

fn canonical(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6
            .to_ipv4_mapped()
            .map(IpAddr::V4)
            .unwrap_or(IpAddr::V6(v6)),
        v4 => v4,
    }
}

fn in_net(ip: IpAddr, net: IpAddr, bits: u8) -> bool {
    match (ip, net) {
        (IpAddr::V4(a), IpAddr::V4(n)) => {
            let mask = if bits == 0 {
                0
            } else {
                u32::MAX << (32 - bits)
            };
            u32::from(a) & mask == u32::from(n) & mask
        }
        (IpAddr::V6(a), IpAddr::V6(n)) => {
            let mask = if bits == 0 {
                0
            } else {
                u128::MAX << (128 - bits)
            };
            u128::from(a) & mask == u128::from(n) & mask
        }
        _ => false,
    }
}

/// Resolves the client IP: the TCP peer, or the right-most `X-Forwarded-For`
/// entry when the peer is a trusted proxy. The right-most entry is the one
/// the proxy itself appended, so a client cannot forge it.
pub fn resolve_client_ip(
    peer: Option<IpAddr>,
    forwarded_for: Option<&str>,
    trusted: &TrustedProxies,
) -> IpAddr {
    let Some(peer) = peer.map(canonical) else {
        return IpAddr::V4(Ipv4Addr::UNSPECIFIED);
    };
    if !trusted.contains(peer) {
        return peer;
    }
    forwarded_for
        .and_then(|h| h.rsplit(',').next())
        .map(str::trim)
        .and_then(|s| s.parse::<IpAddr>().ok())
        .map(canonical)
        .unwrap_or(peer)
}

/// Extractor for the real client IP (see [`resolve_client_ip`]).
#[derive(Clone, Copy, Debug)]
pub struct ClientIp(pub IpAddr);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let peer = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|c| c.0.ip());
        // Several X-Forwarded-For headers are joined so the last value wins.
        let xff: Vec<&str> = parts
            .headers
            .get_all("x-forwarded-for")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .collect();
        let joined = (!xff.is_empty()).then(|| xff.join(","));
        Ok(ClientIp(resolve_client_ip(
            peer,
            joined.as_deref(),
            &state.trusted_proxies,
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST: Limit = Limit {
        name: "t",
        max: 3,
        period: Duration::from_secs(10),
    };

    #[test]
    fn allows_up_to_max_then_rejects_with_retry_after() {
        let rl = RateLimiter::new();
        let t0 = Instant::now();
        for _ in 0..3 {
            rl.check_at(TEST, "a", t0).unwrap();
        }
        match rl.check_at(TEST, "a", t0 + Duration::from_secs(4)) {
            Err(AppError::TooManyRequests(d)) => assert_eq!(d, Duration::from_secs(6)),
            other => panic!("expected 429, got {other:?}"),
        }
        // Other keys are independent.
        rl.check_at(TEST, "b", t0).unwrap();
        // The window slides.
        rl.check_at(TEST, "a", t0 + Duration::from_secs(10))
            .unwrap();
    }

    #[test]
    fn forwarded_for_only_trusted_from_proxy() {
        let trusted = TrustedProxies::default_private();
        let proxy: IpAddr = "172.18.0.5".parse().unwrap();
        let public: IpAddr = "203.0.113.9".parse().unwrap();
        assert_eq!(
            resolve_client_ip(Some(proxy), Some("1.1.1.1, 198.51.100.4"), &trusted),
            "198.51.100.4".parse::<IpAddr>().unwrap()
        );
        // Direct connection from the internet: header ignored.
        assert_eq!(
            resolve_client_ip(Some(public), Some("198.51.100.4"), &trusted),
            public
        );
        // Proxy without header: fall back to the peer.
        assert_eq!(resolve_client_ip(Some(proxy), None, &trusted), proxy);
        assert_eq!(
            resolve_client_ip(Some(proxy), Some("garbage"), &trusted),
            proxy
        );
        // Explicit list.
        let only = TrustedProxies::parse("10.0.0.2");
        assert!(only.contains("10.0.0.2".parse().unwrap()));
        assert!(!only.contains("10.0.0.3".parse().unwrap()));
        assert!(!TrustedProxies::parse("").contains(proxy));
        // IPv4-mapped IPv6 peers count as IPv4.
        assert!(trusted.contains("::ffff:127.0.0.1".parse().unwrap()));
    }
}
