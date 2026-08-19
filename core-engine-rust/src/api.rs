use crate::engine::{DownloadManager, EngineEvent};
use crate::models::*;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

/// Shared app state.
#[derive(Clone)]
pub struct AppState {
    pub dm: Arc<DownloadManager>,
}

// ── Handlers ──

async fn health(_state: State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "uptime": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs_f64(),
        "connected_clients": 0,
    }))
}

async fn ws_status(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ws_running": true,
        "ws_clients_count": 0,
        "ws_set_count": 0,
        "clients": []
    }))
}

async fn get_downloads(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, Json<serde_json::Value>)> {
    let status = params.get("status").map(|s| s.as_str());
    let sort = params.get("sort").map(|s| s.as_str()).unwrap_or("date");
    let dir = params.get("dir").map(|s| s.as_str()).unwrap_or("desc");

    let db_downloads = state.dm.db.list_downloads(status, sort, dir)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))))?;

    let mut results = Vec::new();
    for dl in db_downloads {
        // Enrich with active state if present
        if let Some(active) = state.dm.get_download_state(&dl.id).await {
            results.push(active);
        } else {
            let progress = if dl.total_size > 0 {
                ((dl.downloaded as f64 / dl.total_size as f64) * 10000.0).round() / 100.0
            } else { 0.0 };
            results.push(serde_json::json!({
                "id": dl.id,
                "url": dl.url,
                "filename": dl.filename,
                "save_to": dl.save_to,
                "status": dl.status,
                "total_size": dl.total_size,
                "downloaded": dl.downloaded,
                "progress": progress,
                "speed": 0,
                "eta": 0,
                "threads": dl.threads,
                "mime_type": dl.mime_type,
                "category": dl.category,
                "created_at": dl.created_at,
                "completed_at": dl.completed_at,
                "error": dl.error,
            }));
        }
    }
    Ok(Json(results))
}

async fn get_download(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match state.dm.get_download_state(&id).await {
        Some(s) => Ok(Json(s)),
        None => Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Download not found" })))),
    }
}

async fn create_download(
    State(state): State<AppState>,
    Json(req): Json<StartDownloadRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    // SSRF check
    if let Some(ref url) = req.url {
        if let Ok(parsed) = url::Url::parse(url) {
            let host = parsed.host_str().unwrap_or("");
            if crate::utils::is_blocked_host(host) {
                return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Cannot download from localhost or private network" }))));
            }
            if let Err(e) = crate::utils::validate_dns_resolution(host) {
                return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))));
            }
        }
    }

    match state.dm.start_download(req).await {
        Ok(resp) => {
            let val = serde_json::to_value(&resp).unwrap_or_default();
            state.dm.emit(EngineEvent::Added { id: resp.id.clone(), data: val.clone() });
            Ok((StatusCode::CREATED, Json(val)))
        }
        Err((status, err)) => {
            let sc = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            Err((sc, Json(serde_json::json!({ "error": err }))))
        }
    }
}

async fn pause_download(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match state.dm.pause_download(&id).await {
        Ok(v) => Ok(Json(v)),
        Err((s, e)) => {
            let sc = StatusCode::from_u16(s).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            Err((sc, Json(serde_json::json!({ "error": e }))))
        }
    }
}

async fn resume_download(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match state.dm.resume_download(&id).await {
        Ok(v) => Ok(Json(v)),
        Err((s, e)) => {
            let sc = StatusCode::from_u16(s).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            Err((sc, Json(serde_json::json!({ "error": e }))))
        }
    }
}

async fn cancel_download(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match state.dm.cancel_download(&id).await {
        Ok(v) => Ok(Json(v)),
        Err((s, e)) => {
            let sc = StatusCode::from_u16(s).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            Err((sc, Json(serde_json::json!({ "error": e }))))
        }
    }
}

async fn delete_download(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let delete_file = params.get("delete_file").map(|v| v == "true").unwrap_or(false);
    match state.dm.delete_download(&id, delete_file).await {
        Ok(v) => Ok(Json(v)),
        Err((s, e)) => {
            let sc = StatusCode::from_u16(s).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            Err((sc, Json(serde_json::json!({ "error": e }))))
        }
    }
}

async fn get_settings(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match state.dm.db.get_all_settings() {
        Ok(s) => Ok(Json(serde_json::to_value(s).unwrap_or_default())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e })))),
    }
}

async fn update_settings(
    State(state): State<AppState>,
    Json(updates): Json<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let updated = state.dm.update_settings(updates).await;
    // Broadcast settings change
    if let Ok(settings) = state.dm.db.get_all_settings() {
        state.dm.emit(EngineEvent::SettingsChanged { settings });
    }
    Ok(Json(serde_json::json!({ "updated": updated })))
}

async fn get_stats(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match state.dm.db.get_stats() {
        Ok(s) => Ok(Json(serde_json::to_value(s).unwrap_or_default())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e })))),
    }
}

async fn open_folder(
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let file_path = body.get("path").and_then(|v| v.as_str()).ok_or((
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "error": "path is required" })),
    ))?;

    let path = std::path::Path::new(file_path);
    if !path.exists() {
        return Ok(Json(serde_json::json!({ "ok": true, "exists": false, "path": file_path })));
    }

    // Use std::process::Command to open explorer
    #[cfg(target_os = "windows")]
    {
        if path.is_dir() {
            let _ = std::process::Command::new("explorer").arg(file_path).spawn();
        } else {
            let _ = std::process::Command::new("explorer").arg(format!("/select,{}", file_path)).spawn();
        }
    }
    #[cfg(target_os = "macos")]
    {
        if path.is_dir() {
            let _ = std::process::Command::new("open").arg(file_path).spawn();
        } else {
            let _ = std::process::Command::new("open").arg("-R").arg(file_path).spawn();
        }
    }
    #[cfg(target_os = "linux")]
    {
        let dir = if path.is_dir() { file_path.to_string() } else {
            path.parent().unwrap_or(path).to_string_lossy().into_owned()
        };
        let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
    }

    Ok(Json(serde_json::json!({ "ok": true, "exists": true, "path": file_path })))
}

// ── Categories ──

async fn get_categories() -> Json<serde_json::Value> {
    let categories_path = std::path::Path::new("data/categories.json");
    if categories_path.exists() {
        if let Ok(content) = std::fs::read_to_string(categories_path) {
            if let Ok(arr) = serde_json::from_str::<serde_json::Value>(&content) {
                return Json(arr);
            }
        }
    }
    // Default categories
    Json(serde_json::json!(["Videos","Music","Documents","Archives","Software","Others"]))
}

// ── History (paginated) ──

#[derive(Deserialize)]
struct HistoryQuery {
    page: Option<i64>,
    limit: Option<i64>,
    search: Option<String>,
    status: Option<String>,
}

async fn get_history(
    State(state): State<AppState>,
    Query(params): Query<HistoryQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let page = params.page.unwrap_or(1).max(1);
    let limit = params.limit.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * limit;
    // Use list_downloads with pagination (simplified)
    let downloads = state.dm.db.list_downloads(params.status.as_deref(), "date", "desc")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))))?;

    // Filter by search if present
    let filtered: Vec<_> = if let Some(ref search) = params.search {
        let search_lower = search.to_lowercase();
        downloads.into_iter()
            .filter(|d| d.filename.to_lowercase().contains(&search_lower) || d.url.to_lowercase().contains(&search_lower))
            .collect()
    } else {
        downloads
    };

    let total = filtered.len() as i64;
    let total_pages = (total as f64 / limit as f64).ceil() as i64;
    let items: Vec<_> = filtered.into_iter().skip(offset as usize).take(limit as usize).collect();
    let items_json: Vec<_> = items.into_iter().map(|d| {
        serde_json::json!({
            "id": d.id,
            "url": d.url,
            "filename": d.filename,
            "save_to": d.save_to,
            "status": d.status,
            "total_size": d.total_size,
            "downloaded": d.downloaded,
            "threads": d.threads,
            "mime_type": d.mime_type,
            "category": d.category,
            "created_at": d.created_at,
            "completed_at": d.completed_at,
        })
    }).collect();

    Ok(Json(serde_json::json!({
        "items": items_json,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": total_pages,
    })))
}

// ── Batch ──

async fn batch_download(
    State(state): State<AppState>,
    Json(body): Json<BatchRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    if body.urls.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "urls array is required and must not be empty" }))));
    }
    if body.urls.len() > 50 {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Maximum 50 URLs per batch" }))));
    }

    let mut results = Vec::new();
    for url in &body.urls {
        let filename = body.options.get("filename").and_then(|v| v.as_str()).map(String::from);
        let save_to = body.options.get("save_to").and_then(|v| v.as_str()).map(String::from);
        let cookies = body.options.get("cookies").and_then(|v| v.as_str()).map(String::from);
        let referrer = body.options.get("referrer").and_then(|v| v.as_str()).map(String::from);
        let checksum = body.options.get("checksum").and_then(|v| v.as_str()).map(String::from);

        let req = StartDownloadRequest {
            url: Some(url.clone()),
            filename,
            save_to,
            threads: None,
            thread_mode: None,
            cookies,
            referrer,
            headers: None,
            checksum,
            priority: None,
        };

        match state.dm.start_download(req).await {
            Ok(resp) => {
                results.push(BatchResultItem {
                    url: url.clone(),
                    success: true,
                    download_id: Some(resp.id),
                    error: None,
                });
            }
            Err((_, e)) => {
                results.push(BatchResultItem {
                    url: url.clone(),
                    success: false,
                    download_id: None,
                    error: Some(e),
                });
            }
        }
    }

    let success = results.iter().filter(|r| r.success).count();
    let failed = results.len() - success;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "results": results,
        "summary": { "total": results.len(), "success": success, "failed": failed },
    }))))
}

// ── Router ──

pub fn build_router(state: AppState, static_dir: Option<&std::path::Path>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api = Router::new()
        .route("/health", get(health))
        .route("/api/health", get(health))
        .route("/api/ws-status", get(ws_status))
        .route("/api/downloads", get(get_downloads).post(create_download))
        .route("/api/download", post(create_download))
        .route("/api/downloads/{id}", get(get_download).delete(delete_download))
        .route("/api/downloads/{id}/pause", post(pause_download))
        .route("/api/downloads/{id}/resume", post(resume_download))
        .route("/api/downloads/{id}/cancel", post(cancel_download))
        .route("/api/download/{id}", get(get_download).delete(delete_download))
        .route("/api/download/{id}/pause", post(pause_download))
        .route("/api/download/{id}/resume", post(resume_download))
        .route("/api/download/{id}/cancel", post(cancel_download))
        .route("/api/settings", get(get_settings).put(update_settings))
        .route("/api/stats", get(get_stats))
        .route("/api/open-folder", post(open_folder))
        .route("/api/categories", get(get_categories))
        .route("/api/downloads/history", get(get_history))
        .route("/api/downloads/batch", post(batch_download))
        .with_state(state);

    let mut router = api.layer(cors);

    // Serve static files (React UI) if directory provided
    if let Some(dir) = static_dir {
        router = router.nest_service("/", ServeDir::new(dir));
    }

    router
}
