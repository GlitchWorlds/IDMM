#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

struct SidecarHandle(Mutex<Option<std::process::Child>>);

#[tauri::command]
async fn select_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    match folder {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

fn main() {
    const INIT_SCRIPT: &str = r#"
        window.idmm = {
            platform: 'win32',
            version: '1.4.2',
            apiUrl: 'http://127.0.0.1:9977',
            selectFolder: async function() {
                try {
                    if (window.__TAURI__ && window.__TAURI__.core) {
                        return await window.__TAURI__.core.invoke('select_folder');
                    }
                } catch (e) {
                    console.error('Folder selection error:', e);
                }
                return null;
            },
            getTheme: async function() {
                try { return localStorage.getItem('idmm-theme') || 'dark'; } catch { return 'dark'; }
            },
            setTheme: async function(theme) {
                try { localStorage.setItem('idmm-theme', theme); } catch {}
            },
        };
    "#;

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(SidecarHandle(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![select_folder])
        .setup(|app| {
            let app_exe = std::env::current_exe().expect("failed to get current exe path");
            let app_dir = app_exe.parent().expect("failed to get exe parent dir");

            // Collect candidate paths for idmm-core.exe
            let mut candidates: Vec<std::path::PathBuf> = vec![
                app_dir.join("resources").join("idmm-core.exe"),
                app_dir.join("idmm-core.exe"),
                std::path::PathBuf::from("D:/IDMM/core-engine-rust/target/release/idmm-core.exe"),
            ];

            // Also try Tauri resource dir
            if let Ok(resource_dir) = app.path().resource_dir() {
                candidates.insert(0, resource_dir.join("idmm-core.exe"));
            }

            let exe_path = candidates
                .iter()
                .find(|p| p.exists())
                .expect("idmm-core.exe not found. Place it next to the app exe or in resources/.");

            eprintln!("[IDMM] Starting core engine from: {:?}", exe_path);

            let mut cmd = std::process::Command::new(exe_path);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }

            let child = cmd
                .spawn()
                .expect("failed to start idmm-core.exe");

            let handle = app.state::<SidecarHandle>();
            *handle.0.lock().unwrap() = Some(child);
            eprintln!("[IDMM] Core engine started on 127.0.0.1:9977");

            // Create Tray Menu
            let quit_i = MenuItem::with_id(app, "quit", "Quit IDMM", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Open IDMM", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(true);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Create main window with initialization script for window.idmm shim
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("IDMM")
                .inner_size(1100.0, 720.0)
                .min_inner_size(800.0, 500.0)
                .resizable(true)
                .center()
                .initialization_script(INIT_SCRIPT)
                .build()
                .expect("failed to create main window");

            // Handle window close -> minimize to tray
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_clone.hide();
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                eprintln!("[IDMM] Shutting down core engine...");
                let handle = app_handle.state::<SidecarHandle>();
                let mut guard = handle.0.lock().unwrap();
                if let Some(ref mut child) = *guard {
                    let _ = child.kill();
                    let _ = child.wait();
                    eprintln!("[IDMM] Core engine stopped.");
                }
            }
        });
}
