'use strict';

const initSqlJs = require('sql.js');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

/**
 * IDMM SQLite Database Layer.
 * Uses sql.js (WASM-based SQLite) — no native compilation required.
 *
 * All public methods return { ok: boolean, data?: any, error?: string }.
 * Use IDMMDatabase.create(dbPath) async factory.
 */

class IDMMDatabase {
  /**
   * @param {Object} db - sql.js Database instance
   * @param {string} dbPath - File path for persistence
   */
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
    this._dirty = false;

    this._initTables();
    this._initSettings();
    this.save();

    // Auto-save every 5 seconds if dirty
    this._saveInterval = setInterval(() => {
      if (this._dirty) {
        this.save();
      }
    }, 5000);
  }

  /**
   * Async factory — creates and initializes the database.
   * @param {string} dbPath - Path to the SQLite database file
   * @returns {Promise<IDMMDatabase>}
   */
  static async create(dbPath) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      await fsp.mkdir(dir, { recursive: true });
    }

    const SQL = await initSqlJs();
    let db;

    if (fs.existsSync(dbPath)) {
      const fileBuffer = await fsp.readFile(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }

    return new IDMMDatabase(db, dbPath);
  }

  /**
   * Check whether the underlying sql.js Database instance is still usable.
   */
  isConnected() {
    try {
      return this.db !== null && this.db !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Persist database to disk.
   */
  save() {
    if (!this.isConnected()) return;
    try {
      const data = this.db.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
      this._dirty = false;
    } catch (err) {
      console.error('[DB] Save error:', err.message);
    }
  }

  _markDirty() {
    this._dirty = true;
  }

  // ── sql.js query helpers ──

  _query(sql, params = []) {
    try {
      const stmt = this.db.prepare(sql);
      if (params.length > 0) stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('[DB] Query error:', sql, err.message);
      throw err;
    }
  }

  _queryOne(sql, params = []) {
    const rows = this._query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  _run(sql, params = []) {
    try {
      this.db.run(sql, params);
      this._markDirty();
    } catch (err) {
      console.error('[DB] Run error:', sql, err.message);
      throw err;
    }
  }

  // ── Table Init ──

  _initTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS downloads (
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
    `);

    this.db.run(`
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
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_chunks_download_id ON chunks(download_id);');
  }

  _initSettings() {
    const defaults = {
      default_threads: '8',
      default_thread_mode: 'auto',
      max_concurrent_downloads: '5',
      max_threads_per_download: '128',
      default_save_path: path.join(require('node:os').homedir(), 'Downloads', 'IDMM'),
      temp_dir: path.join(require('node:os').homedir(), '.idmm', 'temp'),
      retry_count: '3',
      timeout_ms: '30000',
      speed_limit_global: '0',
      auto_resume: 'true',
      auto_categorize: 'true',
      intercept_all: 'true',
      intercept_min_size: '0',
      intercept_video: 'true',
      intercept_audio: 'true',
      intercept_archive: 'true',
      intercept_software: 'true',
      intercept_document: 'true',
    };

    for (const [key, value] of Object.entries(defaults)) {
      this.db.run(
        'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
        [key, value]
      );
    }
  }

  _safeError(err) {
    if (!err) return 'Unknown database error';
    const msg = err.message || String(err);
    return msg.replace(/\\[^\\]+\\/g, '.../').replace(/\/[^\/]+\//g, '.../');
  }

  // ── Download Operations ──

  createDownload(download) {
    try {
      this._run(
        `INSERT INTO downloads (id, url, filename, save_to, total_size, threads, mime_type, category, cookies, referrer, headers, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          download.id,
          download.url,
          download.filename,
          download.saveTo,
          download.totalSize || 0,
          download.threads || 8,
          download.mimeType || null,
          download.category || 'Others',
          download.cookies || null,
          download.referrer || null,
          download.headers ? JSON.stringify(download.headers) : null,
          download.status || 'pending',
        ]
      );
      const result = this.getDownload(download.id);
      return result.ok ? { ok: true, data: result.data } : { ok: false, error: 'Failed to read created download' };
    } catch (err) {
      console.error('[DB] createDownload error:', err.message);
      return { ok: false, error: 'Failed to create download record' };
    }
  }

  getDownload(id) {
    try {
      const row = this._queryOne('SELECT * FROM downloads WHERE id = ?', [id]);
      if (row) {
        row.headers = row.headers ? JSON.parse(row.headers) : null;
      }
      return { ok: true, data: row };
    } catch (err) {
      console.error('[DB] getDownload error:', err.message);
      return { ok: false, error: 'Failed to retrieve download' };
    }
  }

  listDownloads(status) {
    try {
      let rows;
      if (status) {
        rows = this._query(
          "SELECT * FROM downloads WHERE status = ? ORDER BY created_at DESC",
          [status]
        );
      } else {
        rows = this._query('SELECT * FROM downloads ORDER BY created_at DESC');
      }
      rows = rows.map(row => {
        row.headers = row.headers ? JSON.parse(row.headers) : null;
        return row;
      });
      return { ok: true, data: rows };
    } catch (err) {
      console.error('[DB] listDownloads error:', err.message);
      return { ok: false, error: 'Failed to list downloads' };
    }
  }

  updateDownload(id, fields) {
    try {
      const allowed = [
        'filename', 'total_size', 'downloaded', 'status', 'speed', 'eta',
        'mime_type', 'category', 'error', 'checksum', 'completed_at', 'threads'
      ];

      const updates = [];
      const values = [];

      for (const [key, value] of Object.entries(fields)) {
        const dbKey = key === 'totalSize' ? 'total_size' :
                      key === 'mimeType' ? 'mime_type' :
                      key === 'completedAt' ? 'completed_at' : key;

        if (allowed.includes(dbKey)) {
          updates.push(`${dbKey} = ?`);
          values.push(value);
        }
      }

      if (updates.length === 0) return { ok: true };

      updates.push("updated_at = datetime('now')");
      values.push(id);

      this._run(`UPDATE downloads SET ${updates.join(', ')} WHERE id = ?`, values);
      return { ok: true };
    } catch (err) {
      console.error('[DB] updateDownload error:', err.message);
      return { ok: false, error: 'Failed to update download' };
    }
  }

  deleteDownload(id) {
    try {
      this._run('DELETE FROM chunks WHERE download_id = ?', [id]);
      this._run('DELETE FROM downloads WHERE id = ?', [id]);
      return { ok: true };
    } catch (err) {
      console.error('[DB] deleteDownload error:', err.message);
      return { ok: false, error: 'Failed to delete download' };
    }
  }

  // ── Chunk Operations ──

  createChunks(downloadId, chunks) {
    try {
      this._run('BEGIN');
      try {
        for (const chunk of chunks) {
          this._run(
            `INSERT INTO chunks (download_id, chunk_index, start_byte, end_byte, status)
             VALUES (?, ?, ?, ?, 'pending')`,
            [downloadId, chunk.index, chunk.start, chunk.end]
          );
        }
        this._run('COMMIT');
      } catch (innerErr) {
        this._run('ROLLBACK');
        throw innerErr;
      }
      return { ok: true };
    } catch (err) {
      console.error('[DB] createChunks error:', err.message);
      return { ok: false, error: 'Failed to create chunk records' };
    }
  }

  getChunks(downloadId) {
    try {
      const rows = this._query(
        'SELECT * FROM chunks WHERE download_id = ? ORDER BY chunk_index ASC',
        [downloadId]
      );
      return { ok: true, data: rows };
    } catch (err) {
      console.error('[DB] getChunks error:', err.message);
      return { ok: false, error: 'Failed to retrieve chunks' };
    }
  }

  updateChunk(chunkId, fields) {
    try {
      const allowed = ['downloaded_bytes', 'status', 'error', 'retries'];
      const updates = [];
      const values = [];

      for (const [key, value] of Object.entries(fields)) {
        const dbKey = key === 'downloadedBytes' ? 'downloaded_bytes' : key;
        if (allowed.includes(dbKey)) {
          updates.push(`${dbKey} = ?`);
          values.push(value);
        }
      }

      if (updates.length === 0) return { ok: true };

      values.push(chunkId);
      this._run(`UPDATE chunks SET ${updates.join(', ')} WHERE id = ?`, values);
      return { ok: true };
    } catch (err) {
      console.error('[DB] updateChunk error:', err.message);
      return { ok: false, error: 'Failed to update chunk' };
    }
  }

  getDownloadWithChunks(id) {
    try {
      const dlResult = this.getDownload(id);
      if (!dlResult.ok) return dlResult;
      if (!dlResult.data) return { ok: true, data: null };

      const chunksResult = this.getChunks(id);
      if (!chunksResult.ok) return { ok: false, error: chunksResult.error };

      dlResult.data.chunks = chunksResult.data || [];
      return { ok: true, data: dlResult.data };
    } catch (err) {
      console.error('[DB] getDownloadWithChunks error:', err.message);
      return { ok: false, error: 'Failed to retrieve download with chunks' };
    }
  }

  // ── Settings Operations ──

  getSetting(key) {
    try {
      const row = this._queryOne('SELECT value FROM settings WHERE key = ?', [key]);
      return { ok: true, data: row ? row.value : null };
    } catch (err) {
      console.error('[DB] getSetting error:', err.message);
      return { ok: false, error: 'Failed to retrieve setting' };
    }
  }

  getSettingInt(key, defaultValue = 0) {
    const result = this.getSetting(key);
    if (!result.ok) return defaultValue;
    return result.data !== null ? parseInt(result.data, 10) : defaultValue;
  }

  getAllSettings() {
    try {
      const rows = this._query('SELECT key, value FROM settings');
      const settings = {};
      for (const row of rows) {
        settings[row.key] = row.value;
      }
      return { ok: true, data: settings };
    } catch (err) {
      console.error('[DB] getAllSettings error:', err.message);
      return { ok: false, error: 'Failed to retrieve settings' };
    }
  }

  setSetting(key, value) {
    try {
      this._run(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
        [key, String(value)]
      );
      return { ok: true };
    } catch (err) {
      console.error('[DB] setSetting error:', err.message);
      return { ok: false, error: 'Failed to save setting' };
    }
  }

  updateSettings(settings) {
    try {
      for (const [key, value] of Object.entries(settings)) {
        const result = this.setSetting(key, value);
        if (!result.ok) return result;
      }
      return { ok: true };
    } catch (err) {
      console.error('[DB] updateSettings error:', err.message);
      return { ok: false, error: 'Failed to update settings' };
    }
  }

  // ── Statistics ──

  getStats() {
    try {
      const total = this._queryOne('SELECT COUNT(*) as count FROM downloads');
      const completed = this._queryOne("SELECT COUNT(*) as count FROM downloads WHERE status = 'completed'");
      const active = this._queryOne("SELECT COUNT(*) as count FROM downloads WHERE status = 'downloading'");
      const paused = this._queryOne("SELECT COUNT(*) as count FROM downloads WHERE status = 'paused'");
      const failed = this._queryOne("SELECT COUNT(*) as count FROM downloads WHERE status = 'failed'");
      const totalBytes = this._queryOne('SELECT COALESCE(SUM(downloaded), 0) as total FROM downloads');

      return {
        ok: true,
        data: {
          total_downloads: total ? total.count : 0,
          completed: completed ? completed.count : 0,
          active: active ? active.count : 0,
          paused: paused ? paused.count : 0,
          failed: failed ? failed.count : 0,
          total_bytes_downloaded: totalBytes ? totalBytes.total : 0,
        }
      };
    } catch (err) {
      console.error('[DB] getStats error:', err.message);
      return { ok: false, error: 'Failed to retrieve statistics' };
    }
  }

  getResumableDownloads() {
    try {
      const rows = this._query(
        `SELECT d.*, c.chunk_index, c.start_byte, c.end_byte, c.downloaded_bytes, c.status as chunk_status
         FROM downloads d
         LEFT JOIN chunks c ON c.download_id = d.id
         WHERE d.status IN ('downloading', 'paused', 'pending')
         ORDER BY d.created_at DESC, c.chunk_index ASC`
      );

      const downloadMap = new Map();
      for (const row of rows) {
        if (!downloadMap.has(row.id)) {
          downloadMap.set(row.id, {
            ...row,
            headers: row.headers ? JSON.parse(row.headers) : null,
            chunks: [],
          });
        }
        const dl = downloadMap.get(row.id);
        if (row.chunk_index !== null) {
          dl.chunks.push({
            chunk_index: row.chunk_index,
            start_byte: row.start_byte,
            end_byte: row.end_byte,
            downloaded_bytes: row.downloaded_bytes,
            status: row.chunk_status,
          });
        }
      }

      return { ok: true, data: Array.from(downloadMap.values()) };
    } catch (err) {
      console.error('[DB] getResumableDownloads error:', err.message);
      return { ok: false, error: 'Failed to retrieve resumable downloads' };
    }
  }

  close() {
    try {
      if (this._saveInterval) {
        clearInterval(this._saveInterval);
      }
      this.save();
      this.db.close();
      return { ok: true };
    } catch (err) {
      console.error('[DB] close error:', err.message);
      return { ok: false, error: 'Failed to close database' };
    }
  }
}

module.exports = IDMMDatabase;
