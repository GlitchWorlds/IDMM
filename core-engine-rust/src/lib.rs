pub mod api;
pub mod db;
pub mod engine;
pub mod models;
pub mod native_messaging;
pub mod utils;

use api::{AppState, build_router};
use db::Database;
use engine::DownloadManager;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;

pub const HOST: &str = "127.0.0.1";
pub const PORT: u16 = 9977;

pub async fn start_embedded_core() {
    let home = dirs::home_dir().unwrap_or_default();
    let db_path = home.join(".idmm").join("idmm.db");
    let temp_dir = home.join(".idmm").join("temp").to_string_lossy().into_owned();

    eprintln!("[IDMM-Core] Opening database at {}", db_path.display());
    let db = match Database::open(&db_path) {
        Ok(db) => Arc::new(db),
        Err(e) => {
            eprintln!("[IDMM-Core] Failed to open database: {}", e);
            return;
        }
    };

    let dm = DownloadManager::new(Arc::clone(&db), temp_dir);
    let state = AppState { dm: Arc::clone(&dm) };

    // Auto-resume existing tasks
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
                    eprintln!("[IDMM-Core] Auto-resuming {} download: {} ({})", status, dl.filename, dl.id);
                    let result = if status == "queued" {
                        dm.requeue_startup(&dl.id).await
                    } else {
                        dm.resume_download(&dl.id).await
                    };
                    if let Err((_, e)) = result {
                        eprintln!("[IDMM-Core] Failed to auto-resume {}: {}", dl.id, e);
                    } else {
                        resumed_ids.push(dl.id.clone());
                    }
                }
            }
        }
    }

    let router = build_router(state, None);
    let addr = format!("{}:{}", HOST, PORT);
    eprintln!("[IDMM-Core] In-process server listening on http://{}", addr);

    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[IDMM-Core] Failed to bind to {}: {}", addr, e);
            return;
        }
    };

    let _ = axum::serve(listener, router).await;
}
