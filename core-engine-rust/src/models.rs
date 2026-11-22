use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Download record as stored in SQLite (mirrors Node sql.js schema exactly).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Download {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub save_to: String,
    #[serde(default)]
    pub total_size: i64,
    #[serde(default)]
    pub downloaded: i64,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default = "default_threads")]
    pub threads: i64,
    #[serde(default)]
    pub speed: f64,
    #[serde(default)]
    pub eta: i64,
    pub mime_type: Option<String>,
    #[serde(default = "default_category")]
    pub category: String,
    pub cookies: Option<String>,
    pub referrer: Option<String>,
    /// Stored as JSON string in DB; exposed as object in API.
    pub headers: Option<HashMap<String, String>>,
    pub error: Option<String>,
    pub checksum: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub completed_at: Option<String>,
}

fn default_status() -> String {
    "pending".into()
}
fn default_threads() -> i64 {
    8
}
fn default_category() -> String {
    "Others".into()
}

/// Chunk record (mirrors `chunks` table).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub id: Option<i64>,
    pub download_id: String,
    pub chunk_index: i64,
    pub start_byte: i64,
    pub end_byte: i64,
    #[serde(default)]
    pub downloaded_bytes: i64,
    #[serde(default = "default_status")]
    pub status: String,
    pub error: Option<String>,
    #[serde(default)]
    pub retries: i64,
}

/// Real-time download state broadcast over WS / returned by API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadState {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub save_to: String,
    pub status: String,
    pub total_size: i64,
    pub downloaded: i64,
    pub progress: f64,
    pub speed: f64,
    pub eta: i64,
    pub threads: i64,
    pub mime_type: Option<String>,
    pub category: String,
    pub created_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

/// POST /api/download request body.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct StartDownloadRequest {
    pub url: Option<String>,
    pub filename: Option<String>,
    pub save_to: Option<String>,
    pub threads: Option<i64>,
    pub thread_mode: Option<String>,
    pub cookies: Option<String>,
    pub referrer: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub checksum: Option<String>,
    pub priority: Option<i64>,
}

/// Response for POST /api/download (201).
#[derive(Debug, Clone, Serialize)]
pub struct StartDownloadResponse {
    pub id: String,
    pub status: String,
    pub filename: String,
    pub total_size: i64,
    pub threads: i64,
    pub thread_mode: String,
    pub created_at: String,
}

/// GET /api/stats response.
#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    pub total_downloads: i64,
    pub completed: i64,
    pub active: i64,
    pub paused: i64,
    pub failed: i64,
    pub total_bytes_downloaded: i64,
}

/// Category entry (categories.json).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    #[serde(default)]
    pub is_default: bool,
}

/// Scheduled job (data/scheduled-jobs.json).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledJob {
    pub id: String,
    pub url: String,
    pub schedule: ScheduleSpec,
    #[serde(default)]
    pub options: serde_json::Value,
    pub status: String,
    pub created_at: String,
    pub next_run: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleSpec {
    #[serde(rename = "type")]
    pub kind: String,
    pub at: String,
    pub weekday: Option<u8>,
}

/// POST /api/downloads/batch request.
#[derive(Debug, Clone, Deserialize)]
pub struct BatchRequest {
    pub urls: Vec<String>,
    #[serde(default)]
    pub options: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResultItem {
    pub url: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
