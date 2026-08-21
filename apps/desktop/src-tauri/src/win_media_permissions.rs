//! Auto-approve microphone/camera for the embedded WebView2 so Windows does not
//! show the generic "localhost intends to use your microphone" prompt.

use tauri::Manager;
use webview2_com::{
  Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_13, ICoreWebView2Profile4, COREWEBVIEW2_PERMISSION_KIND,
    COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
    COREWEBVIEW2_PERMISSION_STATE_ALLOW,
  },
  PermissionRequestedEventHandler, SetPermissionStateCompletedHandler,
};
use windows::core::{Interface, HSTRING};

const MEDIA_ORIGINS: &[&str] = &[
  "http://localhost:1420",
  "https://localhost:1420",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost",
  "https://localhost",
];

fn allow_media_kind(kind: COREWEBVIEW2_PERMISSION_KIND) -> bool {
  kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
}

pub fn install(app: &tauri::AppHandle) {
  let Some(window) = app.get_webview_window("main") else {
    return;
  };

  let _ = window.with_webview(|platform| {
    let controller = platform.controller();
    let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
      return;
    };

    // Intercept prompts and approve mic/camera immediately.
    let mut token = 0i64;
    let _ = unsafe {
      core.add_PermissionRequested(
        &PermissionRequestedEventHandler::create(Box::new(|_, args| {
          let Some(args) = args else {
            return Ok(());
          };
          let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
          args.PermissionKind(&mut kind)?;
          if allow_media_kind(kind) {
            args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
          }
          Ok(())
        })),
        &mut token,
      )
    };

    // Pre-seed profile permissions for known app origins (dev + packaged).
    let Ok(core13) = core.cast::<ICoreWebView2_13>() else {
      return;
    };
    let Ok(profile) = (unsafe { core13.Profile() }) else {
      return;
    };
    let Ok(profile4) = profile.cast::<ICoreWebView2Profile4>() else {
      return;
    };

    let completed = SetPermissionStateCompletedHandler::create(Box::new(|_| Ok(())));
    for origin in MEDIA_ORIGINS {
      let origin_h = HSTRING::from(*origin);
      let _ = unsafe {
        profile4.SetPermissionState(
          COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
          &origin_h,
          COREWEBVIEW2_PERMISSION_STATE_ALLOW,
          &completed,
        )
      };
      let _ = unsafe {
        profile4.SetPermissionState(
          COREWEBVIEW2_PERMISSION_KIND_CAMERA,
          &origin_h,
          COREWEBVIEW2_PERMISSION_STATE_ALLOW,
          &completed,
        )
      };
    }
  });
}
