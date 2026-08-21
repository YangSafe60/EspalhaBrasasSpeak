//! Custom screen/window picker capture for in-app share UI (replaces OS picker).

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::imageops::FilterType;
use image::{ImageBuffer, ImageFormat, Rgba};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use xcap::{Monitor, Window};

static CAPTURE_RUNNING: AtomicBool = AtomicBool::new(false);
static CAPTURE_JOIN: Lazy<Mutex<Option<thread::JoinHandle<()>>>> =
    Lazy::new(|| Mutex::new(None));

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSourceDto {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub thumbnail: String,
}

fn rgba_to_jpeg_data_url(img: ImageBuffer<Rgba<u8>, Vec<u8>>, max_w: u32) -> Result<String, String> {
    let (w, h) = img.dimensions();
    let resized = if w > max_w {
        let nh = ((h as f32) * (max_w as f32 / w as f32)).round() as u32;
        image::imageops::resize(&img, max_w, nh.max(1), FilterType::Triangle)
    } else {
        img
    };
    let mut buf = Cursor::new(Vec::new());
    resized
        .write_to(&mut buf, ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", B64.encode(buf.into_inner())))
}

fn capture_monitor_thumb(monitor: &Monitor) -> Result<String, String> {
    let img = monitor.capture_image().map_err(|e| e.to_string())?;
    rgba_to_jpeg_data_url(img, 320)
}

fn capture_window_thumb(window: &Window) -> Result<String, String> {
    let img = window.capture_image().map_err(|e| e.to_string())?;
    rgba_to_jpeg_data_url(img, 320)
}

#[tauri::command]
pub fn list_share_sources() -> Result<Vec<ShareSourceDto>, String> {
    let mut out = Vec::new();

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    for (i, m) in monitors.iter().enumerate() {
        let name = m
            .name()
            .unwrap_or_else(|_| format!("Screen {}", i + 1));
        let thumbnail = capture_monitor_thumb(m).unwrap_or_default();
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
        // Skip our own app windows to reduce clutter
        let lower = title.to_lowercase();
        if lower.contains("espalha brasas") {
            continue;
        }
        let id = match w.id() {
            Ok(id) => id,
            Err(_) => continue,
        };
        let thumbnail = capture_window_thumb(&w).unwrap_or_default();
        out.push(ShareSourceDto {
            id: format!("window:{id}"),
            kind: "window".into(),
            name: title,
            thumbnail,
        });
    }

    Ok(out)
}

fn stop_capture_thread() {
    CAPTURE_RUNNING.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = CAPTURE_JOIN.lock() {
        if let Some(handle) = guard.take() {
            let _ = handle.join();
        }
    }
}

#[tauri::command]
pub fn stop_share_capture() -> Result<(), String> {
    stop_capture_thread();
    Ok(())
}

#[tauri::command]
pub fn start_share_capture(app: AppHandle, source_id: String) -> Result<(), String> {
    stop_capture_thread();
    CAPTURE_RUNNING.store(true, Ordering::SeqCst);

    let handle = thread::spawn(move || {
        let interval = Duration::from_millis(66); // ~15 fps
        while CAPTURE_RUNNING.load(Ordering::SeqCst) {
            let frame = match capture_frame(&source_id) {
                Ok(f) => f,
                Err(_) => {
                    thread::sleep(interval);
                    continue;
                }
            };
            let _ = app.emit("share-frame", frame);
            thread::sleep(interval);
        }
    });

    *CAPTURE_JOIN.lock().map_err(|e| e.to_string())? = Some(handle);
    Ok(())
}

fn capture_frame(source_id: &str) -> Result<String, String> {
    if let Some(rest) = source_id.strip_prefix("monitor:") {
        let idx: usize = rest.parse().map_err(|_| "bad monitor id".to_string())?;
        let monitors = Monitor::all().map_err(|e| e.to_string())?;
        let m = monitors.get(idx).ok_or_else(|| "monitor gone".to_string())?;
        let img = m.capture_image().map_err(|e| e.to_string())?;
        return rgba_to_jpeg_data_url(img, 1280);
    }
    if let Some(rest) = source_id.strip_prefix("window:") {
        let id: u32 = rest.parse().map_err(|_| "bad window id".to_string())?;
        let windows = Window::all().map_err(|e| e.to_string())?;
        let w = windows
            .into_iter()
            .find(|w| w.id().ok() == Some(id))
            .ok_or_else(|| "window gone".to_string())?;
        let img = w.capture_image().map_err(|e| e.to_string())?;
        return rgba_to_jpeg_data_url(img, 1280);
    }
    Err("unknown source".into())
}
