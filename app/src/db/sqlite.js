'use strict';

const initSqlJs = require('sql.js');
const path = require('node:path');
const fs = require('node:fs');

/**
 * IDMAM SQLite Database Layer.
 * Uses sql.js (WASM-based SQLite) — no native compilation required.
 *
 * Since sql.js init is async, use IDMAMDatabase.create(dbPath) factory.
 */

class IDMAMDatabase {
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
   * @returns {Promise<IDMAMDatabase>}
   */
  static async create(dbPath) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const SQL = await initSqlJs();
    let db;

    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }

    return new IDMAMDatabase(db, dbPath);
  }

  /**
   * Persist database to disk.
   */
  save() {
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

  // ─── sql.js query helpers ────────────────────────────────────────

  /**
   * Execute SQL that returns rows. Returns array of row objects.
   */
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
      return [];
    }
  }

  /**
   * Execute SQL that returns a single row.
   */
  _queryOne(sql, params = []) {
    const rows = this._query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Execute SQL that modifies data (INSERT/UPDATE/DELETE).
   */
  _run(sql, params = []) {
    try {
      this.db.run(sql, params);
      this._markDirty();
    } catch (err) {
      console.error('[DB] Run error:', sql, err.message);
      throw err;
    }
  }

  // ─── Table Init ──────────────────────────────────────────────────

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

    // Indexes
    this.db.run('CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_chunks_download_id ON chunks(download_id);');
  }

  _initSettings() {
    const defaults = {
      default_threads: '8',
      default_thread_mode: 'auto',
      max_concurrent_downloads: '5',
      max_threads_per_download: '128',
      default_save_path: path.join(require('node:os').homedir(), 'Downloads', 'IDMAM'),
      temp_dir: path.join(require('node:os').homedir(), '.idmam', 'temp'),
      retry_count: '3',
      timeout_ms: '30000',
      speed_limit_global: '0',
      auto_resume: 'true',
      auto_categorize: 'true',
    };

    for (const [key, value] of Object.entries(defaults)) {
      this.db.run(
        'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
        [key, value]
      );
    }
  }

  // ─── Download Operations ─────────────────────────────────────────

  createDownload(download) {
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

    return this.getDownload(download.id);
  }

  getDownload(id) {
    const row = this._queryOne('SELECT * FROM downloads WHERE id = ?', [id]);
    if (row) {
      row.headers = row.headers ? JSON.parse(row.headers) : null;
    }
    return row;
  }

  listDownloads(status) {
    let rows;
    if (status) {
      rows = this._query(
        "SELECT * FROM downloads WHERE status = ? ORDER BY created_at DESC",
        [status]
      );
    } else {
      rows = this._query('SELECT * FROM downloads ORDER BY created_at DESC');
    }
    return rows.map(row => {
      row.headers = row.headers ? JSON.parse(row.headers) : null;
      return row;
    });
  }

  updateDownload(id, fields) {
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

    if (updates.length === 0) return;

    updates.push("updated_at = datetime('now')");
    values.push(id);

    this._run(`UPDATE downloads SET ${updates.join(', ')} WHERE id = ?`, values);
  }

  deleteDownload(id) {
    // Delete chunks first (foreign key)
    this._run('DELETE FROM chunks WHERE download_id = ?', [id]);
    this._run('DELETE FROM downloads WHERE id = ?', [id]);
  }

  // ─── Chunk Operations ────────────────────────────────────────────

  createChunks(downloadId, chunks) {
    for (const chunk of chunks) {
      this._run(
        `INSERT INTO chunks (download_id, chunk_index, start_byte, end_byte, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [downloadId, chunk.index, chunk.start, chunk.end]
      );
    }
  }

  getChunks(downloadId) {
    return this._query(
      'SELECT * FROM chunks WHERE download_id = ? ORDER BY chunk_index ASC',
      [downloadId]
    );
  }

  updateChunk(chunkId, fields) {
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

    if (updates.length === 0) return;

    values.push(chunkId);
    this._run(`UPDATE chunks SET ${updates.join(', ')} WHERE id = ?`, values);
  }

  getDownloadWithChunks(id) {
    const download = this.getDownload(id);
    if (!download) return null;
    download.chunks = this.getChunks(id);
    return download;
  }

  // ─── Settings Operations ─────────────────────────────────────────

  getSetting(key) {
    const row = this._queryOne('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  getSettingInt(key, defaultValue = 0) {
    const val = this.getSetting(key);
    return val !== null ? parseInt(val, 10) : defaultValue;
  }

  getAllSettings() {
    const rows = this._query('SELECT key, value FROM settings');
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  }

  setSetting(key, value) {
    this._run(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
      [key, String(value)]
    );
  }

  updateSettings(settings) {
    for (const [key, value] of Object.entries(settings)) {
      this.setSetting(key, value);
    }
  }

  // ─── Statistics ──────────────────────────────────────────────────

  getStats() {
    const total = this._queryOne('SELECT COUNT(*) as count FROM downloads');
    const completed = this._queryOne("SELECT COUNT(*) as count FROM downloads WHERE status = 'completed'");
    const active = this._queryOne("SELECT COUNT(*) as count FROM downloads WHERE status = 'downloading'");
    const paused = this._queryOne("SELECT COUNT(*) as count FROM downloads WHERE status = 'paused'");
    const failed = this._queryOne("SELECT COUNT(*) as count FROM downloads WHERE status = 'failed'");
    const totalBytes = this._queryOne('SELECT COALESCE(SUM(downloaded), 0) as total FROM downloads');

    return {
      total_downloads: total ? total.count : 0,
      completed: completed ? completed.count : 0,
      active: active ? active.count : 0,
      paused: paused ? paused.count : 0,
      failed: failed ? failed.count : 0,
      total_bytes_downloaded: totalBytes ? totalBytes.total : 0,
    };
  }

  getResumableDownloads() {
    const rows = this._query(
      "SELECT * FROM downloads WHERE status IN ('downloading', 'paused', 'pending')"
    );
    return rows.map(row => {
      row.headers = row.headers ? JSON.parse(row.headers) : null;
      row.chunks = this.getChunks(row.id);
      return row;
    });
  }

  close() {
    if (this._saveInterval) {
      clearInterval(this._saveInterval);
    }
    this.save();
    this.db.close();
  }
}

module.exports = IDMAMDatabase;
