//! Noteboard for Windows. The window shows the same Angular app as the browser and the phones,
//! bundled inside the app (never loaded from a server). The app talks to the Noteboard server the
//! person chooses, with bearer tokens; the long-lived refresh token is kept in the Windows
//! Credential Manager through the commands below, never in the webview's storage.
//!
//! The original desktop app (Rust/egui, local boards.json) is a separate program and is left
//! untouched; its data is only read if the person imports it from Settings.

use base64::Engine;
use tauri::Manager;

const SERVICE: &str = "Noteboard";

fn entry(key: &str) -> Result<keyring::Entry, String> {
    if key.is_empty() || key.len() > 200 || !key.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
        return Err("invalid key".into());
    }
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

/// Reads a secret (a refresh token) for this Windows user; None when there is none.
#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    if value.len() > 4096 {
        return Err("value too long".into());
    }
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_remove(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Opens an http(s) address in the default browser (admin panel, help). Nothing else is opened.
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only web addresses can be opened".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Asks where to save a file (export, unsent changes) and writes it. Returns the path, or None
/// when the person cancels.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, name: String, data: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    let safe: String = name.chars().filter(|c| !"/\\:*?\"<>|".contains(*c)).collect();
    let picked = app.dialog().file().set_file_name(&safe).blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // A second launch focuses the window that is already open.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_remove, open_external, save_file])
        .run(tauri::generate_context!())
        .expect("error while running Noteboard");
}
