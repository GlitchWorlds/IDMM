use crate::db::Database;
use crate::models::{Download, DownloadState, StartDownloadRequest, StartDownloadResponse};
use crate::utils;
use dashmap::DashMap;
use futures::StreamExt;
use reqwest::Client;
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::sync::{broadcast, Mutex, Notify};
use tokio::time::sleep;

const MB: i64 = 1024 * 1024;

/// Priority levels (mirrors Node Priority enum).
#[allow(dead_code)]
pub const PRIORITY_HIGH: i64 = 1;
pub const PRIORITY_NORMAL: i64 = 2;
#[allow(dead_code)]
pub const PRIORITY_LOW: i64 = 3;

/// Events emitted to the server layer for WS broadcast.
#[derive(Debug, Clone)]
pub enum EngineEvent {
    Added { id: String, data: serde_json::Value },
    Status { id: String, status: String },
    Completed { id: String, result: serde_json::Value },
    Error { id: String, error: String },
    Removed { id: String },
    #[allow(dead_code)]
    SettingsChanged { settings: HashMap<String, String> },
}

/// Per-chunk runtime state.
pub(crate) struct ChunkState {
    index: i64,
    start: i64,
    end: i64,
    downloaded: AtomicI64,
    done: AtomicBool,
    db_id: Option<i64>,
}

/// Runtime state for an active download.
pub struct ActiveDownload {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub save_to: String,
    pub total_size: AtomicI64,
    pub downloaded: AtomicI64,
    pub threads: i64,
    pub status: Arc<Mutex<String>>,
    pub mime_type: Option<String>,
    pub category: String,
    pub created_at: String,
    pub cancel: Arc<Notify>,
    pub chunks: Vec<Arc<ChunkState>>,
    pub speed_window: Arc<Mutex<Vec<(Instant, i64)>>>,
    #[allow(dead_code)]
    pub no_range_support: bool,
    pub checksum: Option<String>,
}

impl ActiveDownload {
    pub fn progress(&self) -> f64 {
        let total = self.total_size.load(Ordering::Relaxed);
        if total <= 0 {
            return 0.0;
        }
        let dl = self.downloaded.load(Ordering::Relaxed);
        ((dl as f64 / total as f64) * 10000.0).round() / 100.0
    }

    pub async fn speed(&self) -> f64 {
        let samples = self.speed_window.lock().await;
        if samples.len() < 2 {
            return 0.0;
        }
        let total_bytes: i64 = samples.iter().map(|(_, b)| b).sum();
        let span = samples.last().unwrap().0.duration_since(samples.first().unwrap().0).as_secs_f64();
        if span > 0.0 {
            total_bytes as f64 / span
        } else {
            0.0
        }
    }

    pub async fn eta(&self) -> i64 {
        let speed = self.speed().await;
        if speed <= 0.0 {
            return 0;
        }
        let remaining = self.total_size.load(Ordering::Relaxed) - self.downloaded.load(Ordering::Relaxed);
        (remaining as f64 / speed) as i64
    }

    pub async fn format_state(&self) -> DownloadState {
        let status = self.status.lock().await.clone();
        DownloadState {
            id: self.id.clone(),
            url: self.url.clone(),
            filename: self.filename.clone(),
            save_to: self.save_to.clone(),
            status,
            total_size: self.total_size.load(Ordering::Relaxed),
            downloaded: self.downloaded.load(Ordering::Relaxed),
            progress: self.progress(),
            speed: self.speed().await,
            eta: self.eta().await,
            threads: self.threads,
            mime_type: self.mime_type.clone(),
            category: self.category.clone(),
            created_at: Some(self.created_at.clone()),
            completed_at: None,
            error: None,
        }
    }
}

/// Queue entry.
#[derive(Debug, Clone)]
struct QueueEntry {
    id: String,
    priority: i64,
    added_at: Instant,
}

/// The Download Manager — Rust port of Node DownloadManager.
pub struct DownloadManager {
    pub db: Arc<Database>,
    pub settings: Arc<Mutex<HashMap<String, String>>>,
    pub active: Arc<DashMap<String, Arc<ActiveDownload>>>,
    pub client: Client,
    pub temp_dir: String,
    queue: Arc<Mutex<Vec<QueueEntry>>>,
    pub event_tx: broadcast::Sender<EngineEvent>,
}

impl DownloadManager {
    pub fn new(db: Arc<Database>, temp_dir: String) -> Arc<Self> {
        let (event_tx, _) = broadcast::channel(256);
        let settings = db.get_all_settings().unwrap_or_default();
        Arc::new(Self {
            db,
            settings: Arc::new(Mutex::new(settings)),
            active: Arc::new(DashMap::new()),
            client: Client::builder()
                .user_agent(utils::DEFAULT_USER_AGENT)
                .timeout(Duration::from_secs(30))
                .connect_timeout(Duration::from_secs(15))
                .danger_accept_invalid_certs(false)
                .build()
                .expect("Failed to build HTTP client"),
            temp_dir,
            queue: Arc::new(Mutex::new(Vec::new())),
            event_tx,
        })
    }

    pub fn emit(&self, event: EngineEvent) {
        let _ = self.event_tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<EngineEvent> {
        self.event_tx.subscribe()
    }

    async fn get_setting(&self, key: &str, default: &str) -> String {
        self.settings.lock().await.get(key).cloned().unwrap_or_else(|| default.to_string())
    }

    async fn get_setting_int(&self, key: &str, default: i64) -> i64 {
        self.get_setting(key, &default.to_string())
            .await
            .parse::<i64>()
            .unwrap_or(default)
    }

    // ── Public API ──

    pub async fn start_download(self: &Arc<Self>, req: StartDownloadRequest) -> Result<StartDownloadResponse, (u16, String)> {
        let url = req.url.clone().ok_or((400, "URL is required".to_string()))?;

        let thread_mode = req.thread_mode.clone().unwrap_or_else(|| "auto".into()).to_lowercase();

        // Build request headers
        let mut request_headers: HashMap<String, String> = req.headers.clone().unwrap_or_default();
        if let Some(ref cookies) = req.cookies {
            request_headers.insert("Cookie".into(), cookies.clone());
        }
        if let Some(ref referrer) = req.referrer {
            request_headers.insert("Referer".into(), referrer.clone());
        }

        // Probe URL
        let probe = self.probe_url(&url, &request_headers).await
            .map_err(|e| (500, e))?;

        // Resolve filename
        let resolved = utils::resolve_filename(&url, req.filename.as_deref(), probe.content_disposition.as_deref());

        let save_path = if let Some(sp) = req.save_to.clone() {
            sp
        } else {
            self.get_setting("default_save_path", "").await
        };
        let save_path = if save_path.is_empty() {
            dirs::home_dir()
                .map(|h| h.join("Downloads").join("IDMM").to_string_lossy().into_owned())
                .unwrap_or_else(|| "downloads".into())
        } else {
            save_path
        };
        fs::create_dir_all(&save_path).await.map_err(|e| (500, format!("Failed to create save dir: {}", e)))?;

        let final_filename = utils::ensure_unique_filename(&save_path, &resolved);
        let mime_type = probe.content_type.clone().unwrap_or_else(|| utils::detect_mime(&final_filename));
        let category = utils::resolve_category(&final_filename, probe.content_type.as_deref());

        // Thread count
        let final_threads = if !probe.accepts_ranges || probe.content_length == 0 {
            1
        } else if thread_mode == "auto" {
            auto_detect_threads(probe.content_length)
        } else {
            let max_manual = self.get_setting_int("max_threads_per_download", 128).await;
            req.threads.unwrap_or(4).clamp(1, max_manual)
        };

        let download_id = uuid::Uuid::new_v4().to_string();
        let download = Download {
            id: download_id.clone(),
            url: url.clone(),
            filename: final_filename.clone(),
            save_to: save_path.clone(),
            total_size: probe.content_length,
            downloaded: 0,
            status: "downloading".into(),
            threads: final_threads,
            speed: 0.0,
            eta: 0,
            mime_type: Some(mime_type.clone()),
            category: category.clone(),
            cookies: req.cookies.clone(),
            referrer: req.referrer.clone(),
            headers: if request_headers.is_empty() { None } else { Some(request_headers.clone()) },
            error: None,
            checksum: req.checksum.clone(),
            created_at: None,
            updated_at: None,
            completed_at: None,
        };
        self.db.create_download(&download).map_err(|e| (500, e))?;

        // Queue gate
        let max_concurrent = self.get_setting_int("max_concurrent_downloads", 5).await;
        if self.active.len() as i64 >= max_concurrent {
            let mut fields = HashMap::new();
            fields.insert("status".into(), json!("queued"));
            let _ = self.db.update_download(&download_id, &fields);
            self.queue.lock().await.push(QueueEntry {
                id: download_id.clone(),
                priority: req.priority.unwrap_or(PRIORITY_NORMAL),
                added_at: Instant::now(),
            });
            return Ok(StartDownloadResponse {
                id: download_id,
                status: "queued".into(),
                filename: final_filename,
                total_size: probe.content_length,
                threads: final_threads,
                thread_mode,
                created_at: chrono::Utc::now().to_rfc3339(),
            });
        }

        let created_at = chrono::Utc::now().to_rfc3339();
        let state = Arc::new(ActiveDownload {
            id: download_id.clone(),
            url: url.clone(),
            filename: final_filename.clone(),
            save_to: save_path.clone(),
            total_size: AtomicI64::new(probe.content_length),
            downloaded: AtomicI64::new(0),
            threads: final_threads,
            status: Arc::new(Mutex::new("downloading".into())),
            mime_type: Some(mime_type.clone()),
            category: category.clone(),
            created_at: created_at.clone(),
            cancel: Arc::new(Notify::new()),
            chunks: Vec::new(),
            speed_window: Arc::new(Mutex::new(Vec::new())),
            no_range_support: false,
            checksum: req.checksum.clone(),
        });

        self.active.insert(download_id.clone(), state.clone());

        let self_clone = Arc::clone(self);
        let state_clone = Arc::clone(&state);
        let headers_clone = request_headers.clone();
        let retry_count = self.get_setting_int("retry_count", 3).await;
        let timeout_ms = self.get_setting_int("timeout_ms", 30000).await;
        let speed_limit = self.get_setting_int("speed_limit_global", 0).await * 1024;

        tokio::spawn(async move {
            let result = if probe.accepts_ranges && probe.content_length > 0 {
                self_clone.run_chunked_download(&state_clone, &headers_clone, retry_count, timeout_ms, speed_limit).await
            } else {
                self_clone.run_single_stream_download(&state_clone, &headers_clone, retry_count, timeout_ms, speed_limit).await
            };
            self_clone.handle_download_result(&state_clone, result).await;
        });

        Ok(StartDownloadResponse {
            id: download_id,
            status: "downloading".into(),
            filename: final_filename,
            total_size: probe.content_length,
            threads: final_threads,
            thread_mode,
            created_at,
        })
    }

    pub async fn pause_download(self: &Arc<Self>, id: &str) -> Result<serde_json::Value, (u16, String)> {
        let state = self.active.get(id).map(|s| Arc::clone(&s));
        let state = match state {
            Some(s) => s,
            None => {
                let db_dl = self.db.get_download(id).map_err(|e| (500, e))?;
                return match db_dl {
                    Some(d) if d.status == "paused" => Err((409, "Download already paused".into())),
                    Some(_) => Err((400, "Download is not active".into())),
                    None => Err((404, "Download not found".into())),
                };
            }
        };

        *state.status.lock().await = "pausing".to_string();
        state.cancel.notify_waiters();

        // Flush chunk progress to DB
        self.flush_chunk_state(&state).await;

        let mut fields = HashMap::new();
        fields.insert("status".into(), json!("paused"));
        let _ = self.db.update_download(id, &fields);

        self.active.remove(id);
        self.process_queue().await;

        Ok(json!({ "id": id, "status": "paused" }))
    }

    pub async fn resume_download(self: &Arc<Self>, id: &str) -> Result<serde_json::Value, (u16, String)> {
        if let Some(existing) = self.active.get(id) {
            let status = existing.status.lock().await.clone();
            if status == "downloading" {
                return Err((409, "Download already active".into()));
            }
            if status == "pausing" {
                return Err((400, "Download is currently pausing. Please wait.".into()));
            }
        }

        let db_dl = self.db.get_download(id).map_err(|e| (500, e))?
            .ok_or((404, "Download not found".to_string()))?;
        if db_dl.status == "completed" {
            return Err((400, "Download already completed".into()));
        }

        let chunks = self.db.get_chunks(id).map_err(|e| (500, e))?;
        let total_downloaded: i64 = chunks.iter().map(|c| c.downloaded_bytes).sum();

        let state = Arc::new(ActiveDownload {
            id: id.to_string(),
            url: db_dl.url.clone(),
            filename: db_dl.filename.clone(),
            save_to: db_dl.save_to.clone(),
            total_size: AtomicI64::new(db_dl.total_size),
            downloaded: AtomicI64::new(total_downloaded),
            threads: db_dl.threads,
            status: Arc::new(Mutex::new("downloading".into())),
            mime_type: db_dl.mime_type.clone(),
            category: db_dl.category.clone(),
            created_at: db_dl.created_at.clone().unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
            cancel: Arc::new(Notify::new()),
            chunks: chunks.iter().map(|c| Arc::new(ChunkState {
                index: c.chunk_index,
                start: c.start_byte,
                end: c.end_byte,
                downloaded: AtomicI64::new(c.downloaded_bytes),
                done: AtomicBool::new(c.status == "done" || c.status == "completed"),
                db_id: c.id,
            })).collect(),
            speed_window: Arc::new(Mutex::new(Vec::new())),
            no_range_support: chunks.len() == 1,
            checksum: db_dl.checksum.clone(),
        });

        self.active.insert(id.to_string(), Arc::clone(&state));

        let mut fields = HashMap::new();
        fields.insert("status".into(), json!("downloading"));
        let _ = self.db.update_download(id, &fields);

        let retry_count = self.get_setting_int("retry_count", 3).await;
        let timeout_ms = self.get_setting_int("timeout_ms", 30000).await;
        let speed_limit = self.get_setting_int("speed_limit_global", 0).await * 1024;

        let mut request_headers: HashMap<String, String> = db_dl.headers.clone().unwrap_or_default();
        if let Some(ref cookies) = db_dl.cookies {
            request_headers.insert("Cookie".into(), cookies.clone());
        }
        if let Some(ref referrer) = db_dl.referrer {
            request_headers.insert("Referer".into(), referrer.clone());
        }

        let self_clone = Arc::clone(self);
        let state_clone = Arc::clone(&state);
        tokio::spawn(async move {
            let result = if state_clone.chunks.is_empty() {
                // Never-started (queued) download — probe and start fresh
                self_clone.run_queued_from_scratch(&state_clone, &request_headers, retry_count, timeout_ms, speed_limit).await
            } else if state_clone.chunks.len() > 1 {
                self_clone.run_chunked_download(&state_clone, &request_headers, retry_count, timeout_ms, speed_limit).await
            } else {
                self_clone.run_single_stream_download(&state_clone, &request_headers, retry_count, timeout_ms, speed_limit).await
            };
            self_clone.handle_download_result(&state_clone, result).await;
        });

        Ok(json!({ "id": id, "status": "downloading" }))
    }

    pub async fn cancel_download(self: &Arc<Self>, id: &str) -> Result<serde_json::Value, (u16, String)> {
        if let Some((_, state)) = self.active.remove(id) {
            *state.status.lock().await = "canceled".to_string();
            state.cancel.notify_waiters();
        }

        // Cleanup temp files
        let temp_dir = Path::new(&self.temp_dir).join(id);
        let _ = fs::remove_dir_all(&temp_dir).await;

        let mut fields = HashMap::new();
        fields.insert("status".into(), json!("cancelled"));
        let _ = self.db.update_download(id, &fields);

        self.queue.lock().await.retain(|e| e.id != id);
        self.process_queue().await;

        Ok(json!({ "id": id, "status": "cancelled" }))
    }

    pub async fn delete_download(self: &Arc<Self>, id: &str, delete_file: bool) -> Result<serde_json::Value, (u16, String)> {
        if self.active.contains_key(id) {
            let _ = self.cancel_download(id).await;
        }

        if delete_file {
            if let Ok(Some(dl)) = self.db.get_download(id) {
                let output_path = Path::new(&dl.save_to).join(&dl.filename);
                let _ = fs::remove_file(&output_path).await;
            }
        }

        let temp_dir = Path::new(&self.temp_dir).join(id);
        let _ = fs::remove_dir_all(&temp_dir).await;

        self.db.delete_download(id).map_err(|e| (500, e))?;
        self.queue.lock().await.retain(|e| e.id != id);

        Ok(json!({ "id": id, "deleted": true, "fileDeleted": delete_file }))
    }

    pub async fn get_download_state(&self, id: &str) -> Option<serde_json::Value> {
        if let Some(state) = self.active.get(id) {
            let formatted = state.format_state().await;
            return Some(serde_json::to_value(formatted).unwrap_or_default());
        }
        // Fall back to DB
        let db_dl = self.db.get_download(id).ok()??;
        let progress = if db_dl.total_size > 0 {
            ((db_dl.downloaded as f64 / db_dl.total_size as f64) * 10000.0).round() / 100.0
        } else {
            0.0
        };
        Some(json!({
            "id": db_dl.id,
            "url": db_dl.url,
            "filename": db_dl.filename,
            "save_to": db_dl.save_to,
            "status": db_dl.status,
            "total_size": db_dl.total_size,
            "downloaded": db_dl.downloaded,
            "progress": progress,
            "speed": 0,
            "eta": 0,
            "threads": db_dl.threads,
            "mime_type": db_dl.mime_type,
            "category": db_dl.category,
            "created_at": db_dl.created_at,
            "completed_at": db_dl.completed_at,
            "error": db_dl.error,
        }))
    }

    pub async fn get_active_states(&self) -> Vec<serde_json::Value> {
        let mut states = Vec::new();
        for entry in self.active.iter() {
            let formatted = entry.value().format_state().await;
            states.push(serde_json::to_value(formatted).unwrap_or_default());
        }
        states
    }

    pub async fn update_settings(&self, updates: HashMap<String, String>) -> Vec<String> {
        let allowed = [
            "max_concurrent_downloads", "max_threads_per_download",
            "default_save_path", "temp_dir", "retry_count", "timeout_ms",
            "speed_limit_global", "auto_resume", "auto_categorize", "intercept_all",
            "intercept_min_size", "intercept_video", "intercept_audio",
            "intercept_archive", "intercept_software", "intercept_document",
        ];
        let mut filtered = HashMap::new();
        for (k, v) in updates {
            if allowed.contains(&k.as_str()) {
                filtered.insert(k, v);
            }
        }
        let updated: Vec<String> = filtered.keys().cloned().collect();
        if !filtered.is_empty() {
            let _ = self.db.update_settings(&filtered);
            let mut settings = self.settings.lock().await;
            for (k, v) in &filtered {
                settings.insert(k.clone(), v.clone());
            }
        }
        updated
    }

    // ── Internal: Queue ──

    /// Process the queue, resuming queued downloads as slots free up.
    /// Returns a boxed future to break the E0391 type cycle between
    /// `resume_download` ↔ `process_queue` via `tokio::spawn`.
    fn process_queue(self: &Arc<Self>) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        let self_clone = Arc::clone(self);
        Box::pin(async move {
            let max_concurrent = self_clone.get_setting_int("max_concurrent_downloads", 5).await;
            loop {
                if self_clone.active.len() as i64 >= max_concurrent {
                    break;
                }
                let entry = {
                    let mut queue = self_clone.queue.lock().await;
                    if queue.is_empty() {
                        break;
                    }
                    queue.sort_by(|a, b| {
                        a.priority.cmp(&b.priority).then(a.added_at.cmp(&b.added_at))
                    });
                    Some(queue.remove(0))
                };
                if let Some(entry) = entry {
                    if self_clone.active.contains_key(&entry.id) {
                        continue;
                    }
                    let dm = Arc::clone(&self_clone);
                    let id = entry.id.clone();
                    tokio::spawn(async move {
                        if let Err(e) = dm.resume_download(&id).await {
                            tracing::error!("Queue processing failed for {}: {}", id, e.1);
                        }
                    });
                }
            }
        })
    }

    // ── Internal: Probe ──

    async fn probe_url(&self, url: &str, headers: &HashMap<String, String>) -> Result<ProbeResult, String> {
        let mut current_url = url.to_string();
        for _ in 0..=5 {
            let mut req = self.client.head(&current_url);
            for (k, v) in headers {
                req = req.header(k.as_str(), v.as_str());
            }
            let resp = req.send().await.map_err(|e| format!("HEAD request failed: {}", e))?;
            let status = resp.status();

            if status.is_redirection() {
                if let Some(location) = resp.headers().get("location") {
                    let loc = location.to_str().unwrap_or("");
                    current_url = utils::validate_redirect(loc, &current_url)?;
                    continue;
                }
            }

            let content_length = resp.headers().get("content-length")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<i64>().ok())
                .unwrap_or(0);

            let accept_ranges = resp.headers().get("accept-ranges")
                .and_then(|v| v.to_str().ok())
                .map(|v| v.to_lowercase().split(',').any(|t| t.trim() == "bytes"))
                .unwrap_or(false);

            let content_type = resp.headers().get("content-type")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            let content_disposition = resp.headers().get("content-disposition")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            return Ok(ProbeResult {
                content_length,
                accepts_ranges: accept_ranges,
                content_type,
                content_disposition,
            });
        }
        Err("Too many redirects".into())
    }

    // ── Internal: Chunked Download ──

    async fn run_chunked_download(
        self: &Arc<Self>,
        state: &Arc<ActiveDownload>,
        headers: &HashMap<String, String>,
        retry_count: i64,
        timeout_ms: i64,
        speed_limit: i64,
    ) -> Result<(), String> {
        let total_size = state.total_size.load(Ordering::Relaxed);

        // Create chunks if not already present (fresh download)
        if state.chunks.is_empty() {
            let threads = state.threads;
            let chunk_size = (total_size as f64 / threads as f64).ceil() as i64;
            let mut chunk_defs = Vec::new();
            let mut chunk_states = Vec::new();
            for i in 0..threads {
                let start = i * chunk_size;
                let end = std::cmp::min(start + chunk_size - 1, total_size - 1);
                if start > end {
                    continue;
                }
                chunk_defs.push((i, start, end));
                chunk_states.push(Arc::new(ChunkState {
                    index: i,
                    start,
                    end,
                    downloaded: AtomicI64::new(0),
                    done: AtomicBool::new(false),
                    db_id: None,
                }));
            }
            self.db.create_chunks(&state.id, &chunk_defs).map_err(|e| e)?;

            // Cache DB IDs
            if let Ok(db_chunks) = self.db.get_chunks(&state.id) {
                for dbc in &db_chunks {
                    if let Some(_cs) = chunk_states.iter().find(|c| c.index == dbc.chunk_index) {
                        // Can't mutate through Arc — rebuild with db_id
                    }
                }
            }
            // Rebuild chunk states with DB IDs
            let db_chunks = self.db.get_chunks(&state.id).unwrap_or_default();
            let mut final_chunks = Vec::new();
            for cs in &chunk_states {
                let db_id = db_chunks.iter().find(|d| d.chunk_index == cs.index).and_then(|d| d.id);
                final_chunks.push(Arc::new(ChunkState {
                    index: cs.index,
                    start: cs.start,
                    end: cs.end,
                    downloaded: AtomicI64::new(0),
                    done: AtomicBool::new(false),
                    db_id,
                }));
            }
            // SAFETY: chunks only written once before workers start
            let state_mut = unsafe { &mut *(Arc::as_ptr(state) as *mut ActiveDownload) };
            state_mut.chunks = final_chunks;
        }

        // Ensure temp dir
        let temp_dir = Path::new(&self.temp_dir).join(&state.id);
        fs::create_dir_all(&temp_dir).await.map_err(|e| e.to_string())?;

        // Save resume state
        self.save_resume_state(state).await;

        // Spawn chunk tasks with stagger
        let stagger_ms = self.get_setting_int("thread_stagger_ms", 400).await;
        let mut handles = Vec::new();

        for chunk in state.chunks.clone() {
            if chunk.done.load(Ordering::Relaxed) {
                continue;
            }
            let chunk_path = temp_dir.join(format!("chunk_{:05}.part", chunk.index));

            // Check existing bytes for resume
            let existing = fs::metadata(&chunk_path).await.map(|m| m.len() as i64).unwrap_or(0);
            let expected = chunk.end - chunk.start + 1;
            if existing >= expected {
                chunk.done.store(true, Ordering::Relaxed);
                chunk.downloaded.store(expected, Ordering::Relaxed);
                continue;
            }
            chunk.downloaded.store(existing, Ordering::Relaxed);

            let self_clone = Arc::clone(self);
            let state_clone = Arc::clone(state);
            let chunk_clone = Arc::clone(&chunk);
            let url = state.url.clone();
            let headers = headers.clone();
            let chunk_path_str = chunk_path.to_string_lossy().into_owned();

            let handle = tokio::spawn(async move {
                self_clone.download_chunk(
                    &state_clone, &chunk_clone, &url, &headers,
                    &chunk_path_str, retry_count, timeout_ms, speed_limit,
                ).await
            });
            handles.push(handle);

            if stagger_ms > 0 {
                sleep(Duration::from_millis(stagger_ms as u64)).await;
            }
        }

        // Wait for all chunks
        for handle in handles {
            let _ = handle.await;
        }

        // Check if cancelled/paused
        let status = state.status.lock().await.clone();
        if status == "canceled" || status == "pausing" || status == "paused" {
            return Err(format!("Download {}", status));
        }

        // Verify all chunks done
        let all_done = state.chunks.iter().all(|c| c.done.load(Ordering::Relaxed));
        if !all_done {
            return Err("Some chunks failed to download".into());
        }

        // Merge
        *state.status.lock().await = "merging".to_string();
        let mut fields = HashMap::new();
        fields.insert("status".into(), json!("merging"));
        let _ = self.db.update_download(&state.id, &fields);

        let output_path = Path::new(&state.save_to).join(&state.filename);
        let chunk_paths: Vec<String> = state.chunks.iter()
            .map(|c| temp_dir.join(format!("chunk_{:05}.part", c.index)).to_string_lossy().into_owned())
            .collect();

        merge_chunks(&chunk_paths, &output_path.to_string_lossy(), total_size).await?;

        // Verify size
        let stat = fs::metadata(&output_path).await.map_err(|e| e.to_string())?;
        if stat.len() as i64 != total_size {
            let _ = fs::remove_file(&output_path).await;
            return Err(format!("Size mismatch after merge: expected {}, got {}", total_size, stat.len()));
        }

        // Checksum verification
        if let Some(ref expected_checksum) = state.checksum {
            let actual = utils::hash_file(&output_path.to_string_lossy()).await?;
            if !actual.eq_ignore_ascii_case(expected_checksum) {
                let _ = fs::remove_file(&output_path).await;
                return Err(format!("Checksum mismatch: expected {}, got {}", expected_checksum, actual));
            }
        }

        // Cleanup temp
        let _ = fs::remove_dir_all(&temp_dir).await;

        Ok(())
    }

    async fn download_chunk(
        self: &Arc<Self>,
        state: &Arc<ActiveDownload>,
        chunk: &Arc<ChunkState>,
        url: &str,
        headers: &HashMap<String, String>,
        chunk_path: &str,
        max_retries: i64,
        timeout_ms: i64,
        speed_limit: i64,
    ) -> Result<(), String> {
        let mut last_error = String::new();

        for attempt in 1..=max_retries {
            // Check cancellation
            if *state.status.lock().await != "downloading" {
                return Err("Cancelled".into());
            }

            let existing = fs::metadata(chunk_path).await.map(|m| m.len() as i64).unwrap_or(0);
            let adjusted_start = chunk.start + existing;
            let total_chunk_size = chunk.end - chunk.start + 1;

            if adjusted_start > chunk.end {
                chunk.done.store(true, Ordering::Relaxed);
                chunk.downloaded.store(total_chunk_size, Ordering::Relaxed);
                return Ok(());
            }

            let range_header = format!("bytes={}-{}", adjusted_start, chunk.end);

            let mut req = self.client.get(url)
                .header("Range", &range_header)
                .header("Accept", "*/*")
                .timeout(Duration::from_millis(timeout_ms as u64));
            for (k, v) in headers {
                req = req.header(k.as_str(), v.as_str());
            }

            let resp = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    last_error = e.to_string();
                    if attempt < max_retries {
                        let delay = std::cmp::min(1000 * 2i64.pow((attempt - 1) as u32), 10000);
                        sleep(Duration::from_millis(delay as u64)).await;
                    }
                    continue;
                }
            };

            let status = resp.status().as_u16();

            if status == 416 {
                chunk.done.store(true, Ordering::Relaxed);
                chunk.downloaded.store(total_chunk_size, Ordering::Relaxed);
                return Ok(());
            }

            if status == 429 {
                last_error = "HTTP 429 Too Many Requests".into();
                if attempt < max_retries {
                    let delay = std::cmp::min(1000 * 2i64.pow((attempt - 1) as u32), 10000);
                    sleep(Duration::from_millis(delay as u64)).await;
                }
                continue;
            }

            if status == 200 {
                return Err("NO_RANGE_SUPPORT".into());
            }

            if status != 206 {
                last_error = format!("Unexpected HTTP {}", status);
                if attempt < max_retries {
                    let delay = std::cmp::min(1000 * 2i64.pow((attempt - 1) as u32), 10000);
                    sleep(Duration::from_millis(delay as u64)).await;
                }
                continue;
            }

            // Stream to file
            let mut file = match tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(chunk_path)
                .await
            {
                Ok(f) => f,
                Err(e) => return Err(format!("Failed to open chunk file: {}", e)),
            };

            let mut stream = resp.bytes_stream();
            let mut bytes_written = existing;
            let mut tokens = if speed_limit > 0 { speed_limit as f64 } else { f64::INFINITY };
            let mut last_refill = Instant::now();

            while let Some(chunk_result) = stream.next().await {
                // Check cancellation
                if *state.status.lock().await != "downloading" {
                    return Err("Cancelled".into());
                }

                let data = match chunk_result {
                    Ok(d) => d,
                    Err(e) => {
                        last_error = e.to_string();
                        break;
                    }
                };

                // Speed limiting (token bucket)
                if speed_limit > 0 {
                    let now = Instant::now();
                    let elapsed = now.duration_since(last_refill).as_secs_f64();
                    if elapsed >= 0.1 {
                        tokens = (tokens + speed_limit as f64 * elapsed).min(speed_limit as f64);
                        last_refill = now;
                    }
                    if tokens <= 0.0 {
                        sleep(Duration::from_millis(100)).await;
                        tokens = speed_limit as f64 * 0.1;
                        last_refill = Instant::now();
                    }
                    tokens -= data.len() as f64;
                }

                if let Err(e) = file.write_all(&data).await {
                    last_error = format!("Write error: {}", e);
                    break;
                }
                bytes_written += data.len() as i64;
                chunk.downloaded.store(bytes_written, Ordering::Relaxed);
                state.downloaded.fetch_add(data.len() as i64, Ordering::Relaxed);

                // Speed sample
                {
                    let mut window = state.speed_window.lock().await;
                    window.push((Instant::now(), data.len() as i64));
                    let cutoff = Instant::now() - Duration::from_secs(3);
                    window.retain(|(t, _)| *t >= cutoff);
                }
            }

            if bytes_written >= total_chunk_size {
                chunk.done.store(true, Ordering::Relaxed);
                chunk.downloaded.store(total_chunk_size, Ordering::Relaxed);
                if let Some(db_id) = chunk.db_id {
                    let _ = self.db.update_chunk(db_id, Some(total_chunk_size), Some("done"));
                }
                return Ok(());
            }

            // Incomplete — retry
            if attempt < max_retries {
                let delay = std::cmp::min(1000 * 2i64.pow((attempt - 1) as u32), 10000);
                sleep(Duration::from_millis(delay as u64)).await;
            }
        }

        Err(format!("Chunk {} failed after {} attempts: {}", chunk.index, max_retries, last_error))
    }

    // ── Internal: Single Stream ──

    async fn run_single_stream_download(
        self: &Arc<Self>,
        state: &Arc<ActiveDownload>,
        headers: &HashMap<String, String>,
        retry_count: i64,
        timeout_ms: i64,
        _speed_limit: i64,
    ) -> Result<(), String> {
        let temp_dir = Path::new(&self.temp_dir).join(&state.id);
        fs::create_dir_all(&temp_dir).await.map_err(|e| e.to_string())?;
        let part_path = temp_dir.join("chunk_00000.part");

        let mut last_error = String::new();
        for attempt in 1..=retry_count {
            if *state.status.lock().await != "downloading" {
                return Err("Cancelled".into());
            }

            let existing = fs::metadata(&part_path).await.map(|m| m.len() as i64).unwrap_or(0);

            let mut req = self.client.get(&state.url)
                .timeout(Duration::from_millis(timeout_ms as u64));
            if existing > 0 {
                req = req.header("Range", format!("bytes={}-", existing));
            }
            for (k, v) in headers {
                req = req.header(k.as_str(), v.as_str());
            }

            let resp = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    last_error = e.to_string();
                    if attempt < retry_count {
                        sleep(Duration::from_millis(1000 * 2u64.pow((attempt - 1) as u32))).await;
                    }
                    continue;
                }
            };

            if !resp.status().is_success() && resp.status().as_u16() != 206 {
                last_error = format!("HTTP {}", resp.status());
                if attempt < retry_count {
                    sleep(Duration::from_millis(1000 * 2u64.pow((attempt - 1) as u32))).await;
                }
                continue;
            }

            // If server returned 200 (not 206) on resume attempt, restart from scratch
            let resume_offset = if resp.status().as_u16() == 206 { existing } else { 0 };

            let mut file = match tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(resume_offset == 0)
                .append(resume_offset > 0)
                .open(&part_path)
                .await
            {
                Ok(f) => f,
                Err(e) => return Err(format!("Failed to open file: {}", e)),
            };

            let mut stream = resp.bytes_stream();
            let mut bytes_written = resume_offset;
            state.downloaded.store(resume_offset, Ordering::Relaxed);

            while let Some(chunk_result) = stream.next().await {
                if *state.status.lock().await != "downloading" {
                    return Err("Cancelled".into());
                }
                let data = match chunk_result {
                    Ok(d) => d,
                    Err(e) => {
                        last_error = e.to_string();
                        break;
                    }
                };
                if let Err(e) = file.write_all(&data).await {
                    last_error = format!("Write error: {}", e);
                    break;
                }
                bytes_written += data.len() as i64;
                state.downloaded.store(bytes_written, Ordering::Relaxed);
                {
                    let mut window = state.speed_window.lock().await;
                    window.push((Instant::now(), data.len() as i64));
                    let cutoff = Instant::now() - Duration::from_secs(3);
                    window.retain(|(t, _)| *t >= cutoff);
                }
            }

            // Check if complete (if we know total size)
            let total = state.total_size.load(Ordering::Relaxed);
            if total > 0 && bytes_written < total {
                if attempt < retry_count {
                    sleep(Duration::from_millis(1000 * 2u64.pow((attempt - 1) as u32))).await;
                    continue;
                }
                return Err(format!("Download incomplete: {}/{}", bytes_written, total));
            }

            // Move to final location
            let output_path = Path::new(&state.save_to).join(&state.filename);
            fs::rename(&part_path, &output_path).await.map_err(|e| e.to_string())?;
            let _ = fs::remove_dir_all(&temp_dir).await;
            return Ok(());
        }

        Err(format!("Single stream failed after {} attempts: {}", retry_count, last_error))
    }

    // ── Internal: Queued from scratch ──

    async fn run_queued_from_scratch(
        self: &Arc<Self>,
        state: &Arc<ActiveDownload>,
        headers: &HashMap<String, String>,
        retry_count: i64,
        timeout_ms: i64,
        speed_limit: i64,
    ) -> Result<(), String> {
        let probe = self.probe_url(&state.url, headers).await?;
        state.total_size.store(probe.content_length, Ordering::Relaxed);

        let threads = if !probe.accepts_ranges || probe.content_length == 0 {
            1
        } else {
            auto_detect_threads(probe.content_length)
        };

        // Update threads in state (unsafe but chunks empty so safe)
        let state_mut = unsafe { &mut *(Arc::as_ptr(state) as *mut ActiveDownload) };
        state_mut.threads = threads;

        let mut fields = HashMap::new();
        fields.insert("threads".into(), json!(threads));
        let _ = self.db.update_download(&state.id, &fields);

        if probe.accepts_ranges && probe.content_length > 0 {
            self.run_chunked_download(state, headers, retry_count, timeout_ms, speed_limit).await
        } else {
            self.run_single_stream_download(state, headers, retry_count, timeout_ms, speed_limit).await
        }
    }

    // ── Internal: Result handling ──

    async fn handle_download_result(self: &Arc<Self>, state: &Arc<ActiveDownload>, result: Result<(), String>) {
        let id = state.id.clone();
        match result {
            Ok(()) => {
                let mut fields = HashMap::new();
                fields.insert("status".into(), json!("completed"));
                fields.insert("downloaded".into(), json!(state.total_size.load(Ordering::Relaxed)));
                fields.insert("completed_at".into(), json!(chrono::Utc::now().to_rfc3339()));
                let _ = self.db.update_download(&id, &fields);

                self.active.remove(&id);
                self.emit(EngineEvent::Completed {
                    id: id.clone(),
                    result: json!({
                        "filename": state.filename,
                        "save_to": state.save_to,
                        "total_size": state.total_size.load(Ordering::Relaxed),
                    }),
                });
                self.process_queue().await;
            }
            Err(e) => {
                let status = state.status.lock().await.clone();
                if status == "canceled" || status == "pausing" || status == "paused" {
                    // Intentional stop — don't mark as error
                    return;
                }
                let mut fields = HashMap::new();
                fields.insert("status".into(), json!("failed"));
                fields.insert("error".into(), json!(e));
                let _ = self.db.update_download(&id, &fields);

                self.active.remove(&id);
                self.emit(EngineEvent::Error { id: id.clone(), error: e });
                self.process_queue().await;
            }
        }
    }

    // ── Internal: State persistence ──

    async fn flush_chunk_state(&self, state: &Arc<ActiveDownload>) {
        for chunk in &state.chunks {
            if let Some(db_id) = chunk.db_id {
                let downloaded = chunk.downloaded.load(Ordering::Relaxed);
                let status = if chunk.done.load(Ordering::Relaxed) { "done" } else { "downloading" };
                let _ = self.db.update_chunk(db_id, Some(downloaded), Some(status));
            }
        }
        let mut fields = HashMap::new();
        fields.insert("downloaded".into(), json!(state.downloaded.load(Ordering::Relaxed)));
        let _ = self.db.update_download(&state.id, &fields);
        self.save_resume_state(state).await;
    }

    async fn save_resume_state(&self, state: &Arc<ActiveDownload>) {
        let temp_dir = Path::new(&self.temp_dir).join(&state.id);
        let _ = fs::create_dir_all(&temp_dir).await;
        let state_path = temp_dir.join("download.json");

        let chunks: Vec<serde_json::Value> = state.chunks.iter().map(|c| {
            json!({
                "index": c.index,
                "start": c.start,
                "end": c.end,
                "downloaded": c.downloaded.load(Ordering::Relaxed),
                "status": if c.done.load(Ordering::Relaxed) { "done" } else { "pending" },
            })
        }).collect();

        let data = json!({
            "id": state.id,
            "url": state.url,
            "filename": state.filename,
            "save_to": state.save_to,
            "total_size": state.total_size.load(Ordering::Relaxed),
            "threads": state.threads,
            "status": *state.status.lock().await,
            "chunks": chunks,
            "created_at": state.created_at,
            "updated_at": chrono::Utc::now().to_rfc3339(),
            "checksum": state.checksum,
        });

        let _ = fs::write(&state_path, serde_json::to_string_pretty(&data).unwrap_or_default()).await;
    }
}

struct ProbeResult {
    content_length: i64,
    accepts_ranges: bool,
    content_type: Option<String>,
    content_disposition: Option<String>,
}

fn auto_detect_threads(total_size: i64) -> i64 {
    let threads = if total_size < 5 * MB {
        1
    } else if total_size < 50 * MB {
        4
    } else if total_size < 500 * MB {
        16
    } else {
        32
    };
    std::cmp::min(threads, 64)
}

/// Merge chunk files into final output (streaming, low memory).
async fn merge_chunks(chunk_paths: &[String], output_path: &str, _total_size: i64) -> Result<(), String> {
    let temp_path = format!("{}.part", output_path);
    let mut out = tokio::fs::File::create(&temp_path).await.map_err(|e| e.to_string())?;

    for chunk_path in chunk_paths {
        let mut input = tokio::fs::File::open(chunk_path).await
            .map_err(|_| format!("Missing chunk file: {}", chunk_path))?;
        tokio::io::copy(&mut input, &mut out).await.map_err(|e| e.to_string())?;
    }

    out.flush().await.map_err(|e| e.to_string())?;
    drop(out);

    fs::rename(&temp_path, output_path).await.map_err(|e| e.to_string())?;
    Ok(())
}
