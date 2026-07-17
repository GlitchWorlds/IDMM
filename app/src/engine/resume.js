'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * IDMM Resume Manager.
 *
 * Dual persistence: saves download state to download.json files alongside
 * the SQLite database. This provides resilience — if the DB is corrupted
 * or the process crashes, we can reconstruct state from the JSON files.
 */

class ResumeManager {
  /**
   * @param {string} tempDir - Base temp directory (e.g., ~/.idmm/temp)
   */
  constructor(tempDir) {
    this.tempDir = tempDir;
    this._ensureDir(tempDir);
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Get the temp directory for a specific download.
   * @param {string} downloadId
   * @returns {string}
   */
  getDownloadTempDir(downloadId) {
    return path.join(this.tempDir, downloadId);
  }

  /**
   * Get the path to a download's state file.
   * @param {string} downloadId
   * @returns {string}
   */
  getStateFilePath(downloadId) {
    return path.join(this.getDownloadTempDir(downloadId), 'download.json');
  }

  /**
   * Get the path for a specific chunk's .part file.
   * @param {string} downloadId
   * @param {number} chunkIndex
   * @returns {string}
   */
  getChunkPath(downloadId, chunkIndex) {
    const padded = String(chunkIndex).padStart(5, '0');
    return path.join(this.getDownloadTempDir(downloadId), `chunk_${padded}.part`);
  }

  /**
   * Save download state to download.json.
   * @param {Object} state - Download state object
   */
  saveState(state) {
    // F12: Cancel any pending debounced save for this download — direct save supersedes
    if (this._pendingTimers && this._pendingTimers[state.id]) {
      clearTimeout(this._pendingTimers[state.id]);
      delete this._pendingTimers[state.id];
      delete this._pendingUpdates[state.id];
    }

    const dir = this.getDownloadTempDir(state.id);
    this._ensureDir(dir);

    const filePath = this.getStateFilePath(state.id);
    const data = {
      id: state.id,
      url: state.url,
      filename: state.filename,
      save_to: state.saveTo || state.save_to,
      total_size: state.totalSize || state.total_size || 0,
      threads: state.threads || 8,
      status: state.status || 'pending',
      chunks: (state.chunks || []).map(c => ({
        index: c.index !== undefined ? c.index : c.chunk_index,
        start: c.start !== undefined ? c.start : c.start_byte,
        end: c.end !== undefined ? c.end : c.end_byte,
        downloaded: c.downloaded !== undefined ? c.downloaded : (c.downloaded_bytes || 0),
        status: c.status || 'pending',
      })),
      created_at: state.createdAt || state.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      url_hash: state.urlHash || state.url_hash || null,
      checksum: state.checksum || null,
      cookies: state.cookies || null,
      referrer: state.referrer || null,
      headers: state.headers || null,
      threadMode: state.threadMode || 'manual',
      _throttleCount: state._throttleCount || 0,
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return data;
  }

  /**
   * Load download state from download.json.
   * @param {string} downloadId
   * @returns {Object|null}
   */
  loadState(downloadId) {
    const filePath = this.getStateFilePath(downloadId);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Validate chunk integrity — check if .part file sizes match expected bytes.
   * @param {string} downloadId
   * @param {Object[]} chunks - Chunk descriptors from state
   * @returns {{ valid: boolean, chunks: Object[] }} Validated chunks with actual sizes
   */
  validateChunks(downloadId, chunks) {
    let allValid = true;
    const validated = [];

    for (const chunk of chunks) {
      const chunkPath = this.getChunkPath(downloadId, chunk.index);
      const expectedSize = chunk.end - chunk.start + 1;

      if (!fs.existsSync(chunkPath)) {
        validated.push({
          ...chunk,
          actualSize: 0,
          valid: false,
          needsResume: true,
        });
        allValid = false;
        continue;
      }

      try {
        const stat = fs.statSync(chunkPath);
        const actualSize = stat.size;
        const isValid = actualSize <= expectedSize;

        validated.push({
          ...chunk,
          actualSize,
          valid: isValid,
          completed: actualSize >= expectedSize,
          needsResume: actualSize < expectedSize,
        });

        if (!isValid) {
          allValid = false;
        }
      } catch {
        validated.push({
          ...chunk,
          actualSize: 0,
          valid: false,
          needsResume: true,
        });
        allValid = false;
      }
    }

    return { valid: allValid, chunks: validated };
  }

  /**
   * Delete all temp files for a download.
   * @param {string} downloadId
   */
  cleanup(downloadId) {
    const dir = this.getDownloadTempDir(downloadId);
    if (!fs.existsSync(dir)) return;

    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        fs.unlinkSync(path.join(dir, file));
      }
      fs.rmdirSync(dir);
    } catch {
      // Best effort cleanup
    }
  }

  /**
   * Delete chunk .part files only (keep download.json for possible re-resume).
   * @param {string} downloadId
   */
  cleanupChunks(downloadId) {
    const dir = this.getDownloadTempDir(downloadId);
    if (!fs.existsSync(dir)) return;

    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith('.part')) {
          fs.unlinkSync(path.join(dir, file));
        }
      }
    } catch {
      // Best effort
    }
  }

  /**
   * Find all download IDs that have state files (for recovery on startup).
   * @returns {string[]} Array of download IDs
   */
  findAllStateFiles() {
    if (!fs.existsSync(this.tempDir)) return [];

    try {
      const entries = fs.readdirSync(this.tempDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .filter(id => fs.existsSync(this.getStateFilePath(id)));
    } catch {
      return [];
    }
  }

  /**
   * Update a single chunk's state within the download.json.
   * Debounced: at most one file write per 500ms per download (F12).
   * @param {string} downloadId
   * @param {number} chunkIndex
   * @param {Object} updates - { downloaded, status }
   */
  updateChunkState(downloadId, chunkIndex, updates) {
    // F12: Accumulate pending updates in-memory and flush on a 500ms debounce
    if (!this._pendingUpdates) this._pendingUpdates = {};
    if (!this._pendingTimers) this._pendingTimers = {};

    const key = downloadId;
    if (!this._pendingUpdates[key]) {
      this._pendingUpdates[key] = {};
    }
    this._pendingUpdates[key][chunkIndex] = updates;

    if (!this._pendingTimers[key]) {
      this._pendingTimers[key] = setTimeout(() => {
        delete this._pendingTimers[key];
        const pending = this._pendingUpdates[key];
        if (!pending) return;
        delete this._pendingUpdates[key];

        const state = this.loadState(downloadId);
        if (!state || !state.chunks) return;

        for (const [idx, upd] of Object.entries(pending)) {
          const chunk = state.chunks.find(c => c.index === parseInt(idx, 10));
          if (!chunk) continue;
          if (upd.downloaded !== undefined) chunk.downloaded = upd.downloaded;
          if (upd.status !== undefined) chunk.status = upd.status;
        }

        this.saveState(state);
      }, 500);
    }
  }

  /**
   * Flush all pending debounced updates immediately.
   * Call before pause/cancel/shutdown to avoid losing state.
   */
  flushPending() {
    // AW2: Re-entrancy guard — flushPending() can be called while a
    // debounced saveState() callback is already running inside the same
    // tick (e.g. via _flushChunkState → saveState).  Prevent infinite
    // recursion by bailing out if we are already mid-flush.
    if (this._flushing) return;
    this._flushing = true;

    if (!this._pendingTimers) { this._flushing = false; return; }
    for (const key of Object.keys(this._pendingTimers)) {
      clearTimeout(this._pendingTimers[key]);
      delete this._pendingTimers[key];
    }
    if (!this._pendingUpdates) { this._flushing = false; return; }
    for (const [downloadId, pending] of Object.entries(this._pendingUpdates)) {
      if (!pending) continue;
      delete this._pendingUpdates[downloadId];

      const state = this.loadState(downloadId);
      if (!state || !state.chunks) continue;

      for (const [idx, upd] of Object.entries(pending)) {
        const chunk = state.chunks.find(c => c.index === parseInt(idx, 10));
        if (!chunk) continue;
        if (upd.downloaded !== undefined) chunk.downloaded = upd.downloaded;
        if (upd.status !== undefined) chunk.status = upd.status;
      }

      this.saveState(state);
    }
    this._flushing = false;
  }
}

module.exports = ResumeManager;
