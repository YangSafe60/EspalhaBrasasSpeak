mod capture;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
async fn open_screen_popout(
    app: tauri::AppHandle,
    title: String,
    track_sid: String,
    url: String,
) -> Result<(), String> {
    let label = format!("screen-{track_sid}");

    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let parsed = url.parse().map_err(|e: url::ParseError| e.to_string())?;

    // Don't steal focus from the main app — user can click the pop-out.
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(title)
        .inner_size(960.0, 540.0)
        .resizable(true)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn relay_screen_signal(app: tauri::AppHandle, payload: serde_json::Value) -> Result<(), String> {
    app.emit("speakapp://screen-signal", payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn relay_popout_frame(app: tauri::AppHandle, payload: serde_json::Value) -> Result<(), String> {
    app.emit("speakapp://popout-frame", payload)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_screen_popout,
            relay_screen_signal,
            relay_popout_frame,
            capture::list_share_sources,
            capture::start_share_capture,
            capture::stop_share_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
