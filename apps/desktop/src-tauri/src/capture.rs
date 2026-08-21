//! Custom screen/window picker capture for in-app share UI (replaces OS picker).

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::imageops::FilterType;
use image::{DynamicImage, ImageBuffer, Rgba};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use xcap::{Monitor, Window};

struct CaptureSession {
    running: Arc<AtomicBool>,
    join: Option<thread::JoinHandle<()>>,
}

static SESSIONS: Lazy<Mutex<HashMap<String, CaptureSession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSourceDto {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub thumbnail: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareFramePayload {
    source_id: String,
    frame: String,
}

fn rgba_to_jpeg_data_url(
    img: ImageBuffer<Rgba<u8>, Vec<u8>>,
    max_w: Option<u32>,
    quality: u8,
) -> Result<String, String> {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return Err("empty capture".into());
    }
    let resized = match max_w {
        Some(max_w) if w > max_w => {
            let nh = ((h as f32) * (max_w as f32 / w as f32)).round() as u32;
            // Nearest is much cheaper than Triangle — matters at 30fps.
            image::imageops::resize(&img, max_w, nh.max(1), FilterType::Nearest)
        }
        _ => img,
    };
    // JPEG encoder rejects raw RGBA; go through RGB8 with explicit quality.
    let rgb = DynamicImage::ImageRgba8(resized).to_rgb8();
    let mut buf = Cursor::new(Vec::new());
    let mut encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality.clamp(1, 100));
    encoder
        .encode(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        B64.encode(buf.into_inner())
    ))
}

fn capture_with_retry<F>(mut capture: F) -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String>
where
    F: FnMut() -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String>,
{
    match capture() {
        Ok(img) if img.width() > 0 && img.height() > 0 => Ok(img),
        Ok(_) | Err(_) => {
            thread::sleep(Duration::from_millis(80));
            capture()
        }
    }
}

fn capture_monitor_thumb(monitor: &Monitor) -> Result<String, String> {
    let img = capture_with_retry(|| monitor.capture_image().map_err(|e| e.to_string()))?;
    rgba_to_jpeg_data_url(img, Some(560), 70)
}

fn capture_window_thumb(window: &Window) -> Result<String, String> {
    let img = capture_with_retry(|| window.capture_image().map_err(|e| e.to_string()))?;
    rgba_to_jpeg_data_url(img, Some(560), 70)
}

fn monitor_label(monitor: &Monitor, index: usize) -> String {
    let primary = monitor.is_primary().unwrap_or(false);
    let friendly = monitor
        .friendly_name()
        .ok()
        .filter(|s| !s.trim().is_empty() && !s.starts_with(r"\\.\"))
        .or_else(|| {
            monitor
                .name()
                .ok()
                .filter(|s| !s.trim().is_empty() && !s.starts_with(r"\\.\"))
        });
    match friendly {
        Some(name) if primary => format!("{name} (Primary)"),
        Some(name) => name,
        None if primary => format!("Screen {} (Primary)", index + 1),
        None => format!("Screen {}", index + 1),
    }
}

#[tauri::command]
pub fn list_share_sources() -> Result<Vec<ShareSourceDto>, String> {
    let mut out = Vec::new();

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    for (i, m) in monitors.iter().enumerate() {
        let name = monitor_label(m, i);
        let thumbnail = match capture_monitor_thumb(m) {
            Ok(url) => url,
            Err(err) => {
                log::warn!("monitor thumb {i} failed: {err}");
                String::new()
            }
        };
        out.push(ShareSourceDto {
            id: format!("monitor:{i}"),
            kind: "screen".into(),
            name,
            thumbnail,
        });
    }

    let windows = Window::all().map_err(|e| e.to_string())?;
    for w in windows {
        if w.is_minimized().unwrap_or(true) {
            continue;
        }
        let title = w.title().unwrap_or_default();
        if title.trim().is_empty() {
            continue;
        }
        let width = w.width().unwrap_or(0);
        let height = w.height().unwrap_or(0);
        if width < 64 || height < 64 {
            continue;
        }
        let lower = title.to_lowercase();
        if lower.contains("espalha brasas") {
            continue;
        }
        let id = match w.id() {
            Ok(id) => id,
            Err(_) => continue,
        };
        let thumbnail = match capture_window_thumb(&w) {
            Ok(url) => url,
            Err(err) => {
                log::warn!("window thumb {id} failed: {err}");
                String::new()
            }
        };
        out.push(ShareSourceDto {
            id: format!("window:{id}"),
            kind: "window".into(),
            name: title,
            thumbnail,
        });
    }

    Ok(out)
}

fn stop_one_session(source_id: &str) {
    let mut sessions = match SESSIONS.lock() {
        Ok(s) => s,
        Err(_) => return,
    };
    if let Some(mut session) = sessions.remove(source_id) {
        session.running.store(false, Ordering::SeqCst);
        if let Some(handle) = session.join.take() {
            let _ = handle.join();
        }
    }
}

fn stop_all_sessions() {
    let mut sessions = match SESSIONS.lock() {
        Ok(s) => s,
        Err(_) => return,
    };
    let keys: Vec<String> = sessions.keys().cloned().collect();
    for key in keys {
        if let Some(mut session) = sessions.remove(&key) {
            session.running.store(false, Ordering::SeqCst);
            if let Some(handle) = session.join.take() {
                let _ = handle.join();
            }
        }
    }
}

/// Stop one source (`Some(id)`) or every active capture (`None`).
#[tauri::command]
pub fn stop_share_capture(source_id: Option<String>) -> Result<(), String> {
    match source_id {
        Some(id) => stop_one_session(&id),
        None => stop_all_sessions(),
    }
    Ok(())
}

#[tauri::command]
pub fn start_share_capture(app: AppHandle, source_id: String) -> Result<(), String> {
    // Restart this source if it was already running; leave others alone.
    stop_one_session(&source_id);

    let running = Arc::new(AtomicBool::new(true));
    let running_flag = running.clone();
    let sid = source_id.clone();

    let handle = thread::spawn(move || {
        // Target ~30fps: sleep only the leftover budget after capture+encode.
        let frame_budget = Duration::from_millis(33);
        let mut failures = 0u32;
        while running_flag.load(Ordering::SeqCst) {
            let started = Instant::now();
            let frame = match capture_frame(&sid) {
                Ok(f) => {
                    failures = 0;
                    f
                }
                Err(err) => {
                    failures = failures.saturating_add(1);
                    if failures == 1 || failures % 30 == 0 {
                        log::warn!("share capture {sid} failed ({failures}): {err}");
                    }
                    let spent = started.elapsed();
                    if spent < frame_budget {
                        thread::sleep(frame_budget - spent);
                    }
                    continue;
                }
            };
            let payload = ShareFramePayload {
                source_id: sid.clone(),
                frame,
            };
            if app.emit("share-frame", &payload).is_err() {
                break;
            }
            let spent = started.elapsed();
            if spent < frame_budget {
                thread::sleep(frame_budget - spent);
            }
        }
    });

    let mut sessions = SESSIONS.lock().map_err(|e| e.to_string())?;
    sessions.insert(
        source_id,
        CaptureSession {
            running,
            join: Some(handle),
        },
    );
    Ok(())
}

fn capture_frame(source_id: &str) -> Result<String, String> {
    // 1080p-native; scale down hotter displays so motion (video) stays smooth.
    const MAX_W: u32 = 1920;
    // Slightly lower quality = faster encode/decode, less “teleport” on motion.
    const QUALITY: u8 = 78;
    if let Some(rest) = source_id.strip_prefix("monitor:") {
        let idx: usize = rest.parse().map_err(|_| "bad monitor id".to_string())?;
        let monitors = Monitor::all().map_err(|e| e.to_string())?;
        let m = monitors.get(idx).ok_or_else(|| "monitor gone".to_string())?;
        let img = m.capture_image().map_err(|e| e.to_string())?;
        return rgba_to_jpeg_data_url(img, Some(MAX_W), QUALITY);
    }
    if let Some(rest) = source_id.strip_prefix("window:") {
        let id: u32 = rest.parse().map_err(|_| "bad window id".to_string())?;
        let windows = Window::all().map_err(|e| e.to_string())?;
        let w = windows
            .into_iter()
            .find(|w| w.id().ok() == Some(id))
            .ok_or_else(|| "window gone".to_string())?;
        let img = w.capture_image().map_err(|e| e.to_string())?;
        return rgba_to_jpeg_data_url(img, Some(MAX_W), QUALITY);
    }
    Err("unknown source".into())
}
