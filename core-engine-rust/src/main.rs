#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod db;
mod engine;
mod models;
mod native_messaging;
mod utils;

use api::{AppState, build_router};
use db::Database;
use engine::DownloadManager;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;
const HOST: &str = "127.0.0.1";
const PORT: u16 = 9977;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && (args.iter().any(|a| a.contains("chrome-extension://") || a == "--native-messaging-host" || a == "--native-host")) {
        native_messaging::run_native_messaging_host();
        return;
    }
    
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create Tokio runtime");

    rt.block_on(async_main());
}

async fn async_main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_target(false)
        .with_ansi(false)
        .init();

    let home = dirs::home_dir().unwrap_or_default();
    let db_path = home.join(".idmm").join("idmm.db");
    let temp_dir = home.join(".idmm").join("temp").to_string_lossy().into_owned();

    tracing::info!("[IDMM-Rust] Opening database at {}", db_path.display());
    let db = match Database::open(&db_path) {
        Ok(db) => Arc::new(db),
        Err(e) => {
            tracing::error!("[IDMM-Rust] Failed to open database: {}", e);
            std::process::exit(1);
        }
    };

    let dm = DownloadManager::new(Arc::clone(&db), temp_dir);
    let state = AppState { dm: Arc::clone(&dm) };

    // ── Auto-resume (v1.4.4 fix) ──
    // Previously this called start_download() for every 'downloading' record,
    // which created a NEW record + UUID and appended "(1)" filename suffixes
    // via ensure_unique_filename(). Now we RESUME the SAME record in place:
    //   - status downloading/queued → dm.resume_download(&id)
    //     (updates the existing record; chunk offsets / .part files reused;
    //      missing partial files restart from scratch under the same ID)
    //   - queued tasks were previously never resumed at all — now they are
    //     enqueued into the manager queue with their original priority.
    {
        let settings = db.get_all_settings().unwrap_or_default();
        let auto_resume = settings.get("auto_resume").map(|v| v == "true").unwrap_or(true);

        if auto_resume {
            let mut resumed_ids: Vec<String> = Vec::new();
            for status in ["downloading", "queued"] {
                let downloads = db.list_downloads(Some(status), "date", "desc").unwrap_or_default();
                for dl in downloads {
                    if resumed_ids.iter().any(|id| id == &dl.id) {
                        continue;
                    }
                    tracing::info!("[IDMM-Rust] Auto-resuming {} download: {} ({})", status, dl.filename, dl.id);
                    // v1.4.4: RESUME the SAME record ID — no INSERT, no new
                    // UUID, no filename dedup suffix.
                    let result = if status == "queued" {
                        dm.requeue_startup(&dl.id).await
                    } else {
                        dm.resume_download(&dl.id).await
                    };
                    match result {
                        Ok(_) => resumed_ids.push(dl.id.clone()),
                        Err((_, e)) => {
                            tracing::warn!("[IDMM-Rust] Failed to auto-resume {}: {}", dl.id, e);
                            let mut fields = std::collections::HashMap::<String, serde_json::Value>::new();
                            fields.insert("status".to_string(), serde_json::json!("failed"));
                            fields.insert("error".to_string(), serde_json::json!(format!("auto-resume failed: {}", e)));
                            let _ = db.update_download(&dl.id, &fields);
                        }
                    }
                }
            }
        }
    }

    // Determine static file directory
    let static_dir = find_static_dir();

    let router = build_router(state, static_dir.as_deref());

    let addr = format!("{}:{}", HOST, PORT);
    tracing::info!("[IDMM-Rust] API Server running at http://{}", addr);
    tracing::info!("[IDMM-Rust] WebSocket at ws://{}/ws", addr);

    let listener = TcpListener::bind(&addr).await.unwrap_or_else(|e| {
        tracing::error!("[IDMM-Rust] Failed to bind to {}: {}", addr, e);
        std::process::exit(1);
    });

    axum::serve(listener, router).await.unwrap_or_else(|e| {
        tracing::error!("[IDMM-Rust] Server error: {}", e);
        std::process::exit(1);
    });
}

/// Find the static directory containing the built React UI.
/// Searches multiple locations in priority order.
fn find_static_dir() -> Option<PathBuf> {
    // 1. Relative to executable (for Tauri sidecar)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir.join("ui").join("build"),
                exe_dir.join("ui"),
                exe_dir.join("static"),
                exe_dir.join("dist"),
            ];
            for candidate in &candidates {
                if candidate.exists() && candidate.join("index.html").exists() {
                    return Some(candidate.clone());
                }
            }
        }
    }

    // 2. Environment variable
    if let Ok(idmm_ui_dir) = std::env::var("IDMM_UI_DIR") {
        let p = PathBuf::from(idmm_ui_dir);
        if p.exists() && p.join("index.html").exists() {
            return Some(p);
        }
    }

    // 3. Dev mode: use React dev server proxy (no static files needed)
    if std::env::var("IDMM_DEV").is_ok() {
        tracing::info!("[IDMM-Rust] Dev mode: no static files served, use React dev server");
        return None;
    }

    tracing::warn!("[IDMM-Rust] No static UI directory found. API-only mode.");
    None
}
