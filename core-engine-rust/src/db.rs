use crate::models::{Chunk, Download, Stats};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

/// Result of a paginated download query.
pub struct PaginatedDownloads {
    pub items: Vec<Download>,
    pub total: u64,
    pub total_pages: u64,
}

/// Native SQLite database layer (replaces sql.js WASM).
/// All methods return Result to mirror the Node { ok, data, error } pattern.
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(db_path: &Path) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        let db = Self { conn: Mutex::new(conn) };
        db.init_tables()?;
        db.init_settings()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                filename TEXT NOT NULL,
                save_to TEXT NOT NULL,
                total_size INTEGER DEFAULT 0,
                downloaded INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                threads INTEGER DEFAULT 8,
                speed REAL DEFAULT 0,
                eta INTEGER DEFAULT 0,
                mime_type TEXT,
                category TEXT DEFAULT 'Others',
                cookies TEXT,
                referrer TEXT,
                headers TEXT,
                error TEXT,
                checksum TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                download_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                start_byte INTEGER NOT NULL,
                end_byte INTEGER NOT NULL,
                downloaded_bytes INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                error TEXT,
                retries INTEGER DEFAULT 0,
                FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
            CREATE INDEX IF NOT EXISTS idx_chunks_download_id ON chunks(download_id);",
        )
        .map_err(|e| e.to_string())
    }

    fn init_settings(&self) -> Result<(), String> {
        let home = dirs::home_dir().unwrap_or_default();
        let defaults: Vec<(&str, String)> = vec![
            ("max_concurrent_downloads", "5".into()),
            ("max_threads_per_download", "128".into()),
            ("default_save_path", home.join("Downloads").join("IDMM").to_string_lossy().into_owned()),
            ("temp_dir", home.join(".idmm").join("temp").to_string_lossy().into_owned()),
            ("retry_count", "3".into()),
            ("timeout_ms", "30000".into()),
            ("speed_limit_global", "0".into()),
            ("auto_resume", "true".into()),
            ("auto_categorize", "true".into()),
            ("intercept_all", "true".into()),
            ("intercept_min_size", "0".into()),
            ("intercept_video", "true".into()),
            ("intercept_audio", "true".into()),
            ("intercept_archive", "true".into()),
            ("intercept_software", "true".into()),
            ("intercept_document", "true".into()),
        ];
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        for (key, value) in defaults {
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute(
            "DELETE FROM settings WHERE key IN ('default_threads', 'default_thread_mode')",
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Download Operations ──

    pub fn create_download(&self, d: &Download) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let headers_json = d
            .headers
            .as_ref()
            .map(|h| serde_json::to_string(h).unwrap_or_default());
        conn.execute(
            "INSERT INTO downloads (id, url, filename, save_to, total_size, threads, mime_type, category, cookies, referrer, headers, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                d.id,
                d.url,
                d.filename,
                d.save_to,
                d.total_size,
                d.threads,
                d.mime_type,
                d.category,
                d.cookies,
                d.referrer,
                headers_json,
                d.status,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn row_to_download(row: &rusqlite::Row) -> rusqlite::Result<Download> {
        let headers_raw: Option<String> = row.get(14)?;
        let headers = headers_raw
            .and_then(|h| serde_json::from_str::<HashMap<String, String>>(&h).ok());
        Ok(Download {
            id: row.get(0)?,
            url: row.get(1)?,
            filename: row.get(2)?,
            save_to: row.get(3)?,
            total_size: row.get(4)?,
            downloaded: row.get(5)?,
            status: row.get(6)?,
            threads: row.get(7)?,
            speed: row.get(8)?,
            eta: row.get(9)?,
            mime_type: row.get(10)?,
            category: row.get(11)?,
            cookies: row.get(12)?,
            referrer: row.get(13)?,
            headers,
            error: row.get(15)?,
            checksum: row.get(16)?,
            created_at: row.get(17)?,
            updated_at: row.get(18)?,
            completed_at: row.get(19)?,
        })
    }

    const DOWNLOAD_COLS: &'static str = "id, url, filename, save_to, total_size, downloaded, status, threads, speed, eta, mime_type, category, cookies, referrer, headers, error, checksum, created_at, updated_at, completed_at";

    pub fn get_download(&self, id: &str) -> Result<Option<Download>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let sql = format!("SELECT {} FROM downloads WHERE id = ?1", Self::DOWNLOAD_COLS);
        let result = conn
            .query_row(&sql, params![id], Self::row_to_download)
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub fn list_downloads(&self, status: Option<&str>, sort: &str, dir: &str) -> Result<Vec<Download>, String> {
        let sort_col = match sort {
            "name" => "filename",
            "type" => "mime_type",
            "size" => "total_size",
            _ => "created_at",
        };
        let order = if dir.eq_ignore_ascii_case("asc") { "ASC" } else { "DESC" };
        let order_sql = format!("ORDER BY {} {}, created_at DESC", sort_col, order);

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut downloads = Vec::new();
        if let Some(st) = status {
            let sql = format!("SELECT {} FROM downloads WHERE status = ?1 {}", Self::DOWNLOAD_COLS, order_sql);
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![st], Self::row_to_download)
                .map_err(|e| e.to_string())?;
            for row in rows {
                downloads.push(row.map_err(|e| e.to_string())?);
            }
        } else {
            let sql = format!("SELECT {} FROM downloads {}", Self::DOWNLOAD_COLS, order_sql);
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], Self::row_to_download).map_err(|e| e.to_string())?;
            for row in rows {
                downloads.push(row.map_err(|e| e.to_string())?);
            }
        }
        Ok(downloads)
    }

    pub fn update_download(&self, id: &str, fields: &HashMap<String, serde_json::Value>) -> Result<(), String> {
        let allowed = [
            "filename", "total_size", "downloaded", "status", "speed", "eta",
            "mime_type", "category", "error", "checksum", "completed_at", "threads",
        ];
        let mut updates = Vec::new();
        let mut values: Vec<serde_json::Value> = Vec::new();
        for (key, value) in fields {
            let db_key = match key.as_str() {
                "totalSize" => "total_size",
                "mimeType" => "mime_type",
                "completedAt" => "completed_at",
                k => k,
            };
            if allowed.contains(&db_key) {
                updates.push(format!("{} = ?", db_key));
                values.push(value.clone());
            }
        }
        if updates.is_empty() {
            return Ok(());
        }
        updates.push("updated_at = datetime('now')".to_string());

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let sql = format!("UPDATE downloads SET {} WHERE id = ?", updates.join(", "));
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut idx = 1;
        for v in &values {
            bind_value(&mut stmt, idx, v)?;
            idx += 1;
        }
        stmt.raw_bind_parameter(idx, id).map_err(|e| e.to_string())?;
        stmt.raw_execute().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_download(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM chunks WHERE download_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Chunk Operations ──

    pub fn create_chunks(&self, download_id: &str, chunks: &[(i64, i64, i64)]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for (index, start, end) in chunks {
            tx.execute(
                "INSERT INTO chunks (download_id, chunk_index, start_byte, end_byte, status) VALUES (?1, ?2, ?3, ?4, 'pending')",
                params![download_id, index, start, end],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_chunks(&self, download_id: &str) -> Result<Vec<Chunk>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, download_id, chunk_index, start_byte, end_byte, downloaded_bytes, status, error, retries FROM chunks WHERE download_id = ?1 ORDER BY chunk_index ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![download_id], |row| {
                Ok(Chunk {
                    id: row.get(0)?,
                    download_id: row.get(1)?,
                    chunk_index: row.get(2)?,
                    start_byte: row.get(3)?,
                    end_byte: row.get(4)?,
                    downloaded_bytes: row.get(5)?,
                    status: row.get(6)?,
                    error: row.get(7)?,
                    retries: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut chunks = Vec::new();
        for row in rows {
            chunks.push(row.map_err(|e| e.to_string())?);
        }
        Ok(chunks)
    }

    pub fn update_chunk(&self, chunk_id: i64, downloaded_bytes: Option<i64>, status: Option<&str>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        match (downloaded_bytes, status) {
            (Some(db), Some(st)) => {
                conn.execute(
                    "UPDATE chunks SET downloaded_bytes = ?1, status = ?2 WHERE id = ?3",
                    params![db, st, chunk_id],
                )
                .map_err(|e| e.to_string())?;
            }
            (Some(db), None) => {
                conn.execute(
                    "UPDATE chunks SET downloaded_bytes = ?1 WHERE id = ?2",
                    params![db, chunk_id],
                )
                .map_err(|e| e.to_string())?;
            }
            (None, Some(st)) => {
                conn.execute(
                    "UPDATE chunks SET status = ?1 WHERE id = ?2",
                    params![st, chunk_id],
                )
                .map_err(|e| e.to_string())?;
            }
            (None, None) => {}
        }
        Ok(())
    }

    // ── Settings ──

    #[allow(dead_code)]
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let result: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(result)
    }

    #[allow(dead_code)]
    pub fn get_setting_int(&self, key: &str, default: i64) -> i64 {
        self.get_setting(key)
            .ok()
            .flatten()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(default)
    }

    pub fn get_all_settings(&self) -> Result<HashMap<String, String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT key, value FROM settings").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut map = HashMap::new();
        for row in rows {
            let (k, v) = row.map_err(|e| e.to_string())?;
            map.insert(k, v);
        }
        Ok(map)
    }

    pub fn update_settings(&self, settings: &HashMap<String, String>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for (key, value) in settings {
            tx.execute(
                "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Paginated Downloads (SQL-level pagination) ──

    pub fn get_download_with_pagination(
        &self,
        page: u64,
        limit: u64,
        search: Option<&str>,
        status: Option<&str>,
    ) -> Result<PaginatedDownloads, String> {
        let offset = (page - 1) * limit;
        let mut where_clauses: Vec<String> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(s) = search {
            where_clauses.push("(d.filename LIKE ? OR d.url LIKE ?)".into());
            let pattern = format!("%{}%", s);
            params.push(Box::new(pattern.clone()));
            params.push(Box::new(pattern));
        }
        if let Some(st) = status {
            where_clauses.push("d.status = ?".into());
            params.push(Box::new(st.to_string()));
        }

        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_clauses.join(" AND "))
        };

        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Count query
        let count_sql = format!("SELECT COUNT(*) FROM downloads d {}", where_sql);
        let mut count_stmt = conn.prepare(&count_sql).map_err(|e| e.to_string())?;
        let count_params: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let total: i64 = count_stmt
            .query_row(count_params.as_slice(), |r| r.get(0))
            .map_err(|e| e.to_string())?;

        let total_pages = if limit > 0 { ((total as u64) + limit - 1) / limit } else { 0 };

        // Items query
        let items_sql = format!(
            "SELECT {} FROM downloads d {} ORDER BY d.created_at DESC LIMIT ? OFFSET ?",
            Self::DOWNLOAD_COLS, where_sql
        );
        let mut items_params: Vec<Box<dyn rusqlite::types::ToSql>> = params;
        items_params.push(Box::new(limit as i64));
        items_params.push(Box::new(offset as i64));
        let items_refs: Vec<&dyn rusqlite::types::ToSql> = items_params.iter().map(|p| p.as_ref()).collect();

        let mut items_stmt = conn.prepare(&items_sql).map_err(|e| e.to_string())?;
        let rows = items_stmt
            .query_map(items_refs.as_slice(), Self::row_to_download)
            .map_err(|e| e.to_string())?;
        let mut downloads = Vec::new();
        for row in rows {
            downloads.push(row.map_err(|e| e.to_string())?);
        }

        Ok(PaginatedDownloads {
            items: downloads,
            total: total as u64,
            total_pages,
        })
    }

    // ── Statistics ──

    pub fn get_stats(&self) -> Result<Stats, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count = |sql: &str| -> Result<i64, String> {
            conn.query_row(sql, [], |r| r.get(0)).map_err(|e| e.to_string())
        };
        Ok(Stats {
            total_downloads: count("SELECT COUNT(*) FROM downloads")?,
            completed: count("SELECT COUNT(*) FROM downloads WHERE status = 'completed'")?,
            active: count("SELECT COUNT(*) FROM downloads WHERE status = 'downloading'")?,
            paused: count("SELECT COUNT(*) FROM downloads WHERE status = 'paused'")?,
            failed: count("SELECT COUNT(*) FROM downloads WHERE status = 'failed'")?,
            total_bytes_downloaded: count("SELECT COALESCE(SUM(downloaded), 0) FROM downloads")?,
        })
    }
}

fn bind_value(stmt: &mut rusqlite::Statement, idx: usize, v: &serde_json::Value) -> Result<(), String> {

    match v {
        serde_json::Value::Null => stmt.raw_bind_parameter(idx, rusqlite::types::Null).map_err(|e| e.to_string())?,
        serde_json::Value::Bool(b) => stmt.raw_bind_parameter(idx, *b).map_err(|e| e.to_string())?,
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                stmt.raw_bind_parameter(idx, i).map_err(|e| e.to_string())?;
            } else if let Some(f) = n.as_f64() {
                stmt.raw_bind_parameter(idx, f).map_err(|e| e.to_string())?;
            }
        }
        serde_json::Value::String(s) => stmt.raw_bind_parameter(idx, s.clone()).map_err(|e| e.to_string())?,
        _ => stmt.raw_bind_parameter(idx, v.to_string()).map_err(|e| e.to_string())?,
    }
    Ok(())
}
