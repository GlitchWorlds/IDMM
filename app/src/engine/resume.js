'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * IDMM Resume Manager.
 *
 * Dual persistence: saves download state to download.json files alongside
 * the SQLite database. This provides resilience — if the DB is corrupted
 * or the process crashes, we can reconstruct state from the JSON files.
 *
 * Fix #3: All I/O methods are now async (fs.promises).
 */

class ResumeManager {
  /**
   * @param {string} tempDir - Base temp directory (e.g., ~/.idmm/temp)
   */
  constructor(tempDir) {
    this.tempDir = tempDir;
    this._ensureDirSync(tempDir);
  }

  _ensureDirSync(dir) {
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
   * Save download state to download.json (async).
   * @param {Object} state - Download state object
   * @returns {Promise<Object>} The saved data object
   */
  async saveState(state) {
    // Cancel any pending debounced save for this download — direct save supersedes
    if (this._pendingTimers && this._pendingTimers[state.id]) {
      clearTimeout(this._pendingTimers[state.id]);
      delete this._pendingTimers[state.id];
      delete this._pendingUpdates[state.id];
    }

    const dir = this.getDownloadTempDir(state.id);
    await fsp.mkdir(dir, { recursive: true });

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

    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return data;
  }

  /**
   * Load download state from download.json (async).
   * @param {string} downloadId
   * @returns {Promise<Object|null>}
   */
  async loadState(downloadId) {
    const filePath = this.getStateFilePath(downloadId);
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Validate chunk integrity — check if .part file sizes match expected bytes (async).
   * @param {string} downloadId
   * @param {Object[]} chunks - Chunk descriptors from state
   * @returns {Promise<{ valid: boolean, chunks: Object[] }>}
   */
  async validateChunks(downloadId, chunks) {
    let allValid = true;
    const validated = [];

    for (const chunk of chunks) {
      const chunkPath = this.getChunkPath(downloadId, chunk.index);
      const expectedSize = chunk.end - chunk.start + 1;

      try {
        const stat = await fsp.stat(chunkPath);
        const actualSize = stat.size;
        const isValid = actualSize <= expectedSize;

        validated.push({
          ...chunk,
          actualSize,
          valid: isValid,
          completed: actualSize >= expectedSize,
          needsResume: actualSize < expectedSize,
        });

        if (!isValid) allValid = false;
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
   * Delete all temp files for a download (async).
   * @param {string} downloadId
   */
  async cleanup(downloadId) {
    const dir = this.getDownloadTempDir(downloadId);
    try {
      const files = await fsp.readdir(dir);
      for (const file of files) {
        await fsp.unlink(path.join(dir, file));
      }
      await fsp.rmdir(dir);
    } catch {
      // Best effort cleanup
    }
  }

  /**
   * Delete chunk .part files only (keep download.json) (async).
   * @param {string} downloadId
   */
  async cleanupChunks(downloadId) {
    const dir = this.getDownloadTempDir(downloadId);
    try {
      const files = await fsp.readdir(dir);
      for (const file of files) {
        if (file.endsWith('.part')) {
          await fsp.unlink(path.join(dir, file));
        }
      }
    } catch {
      // Best effort
    }
  }

  /**
   * Find all download IDs that have state files (async).
   * @returns {Promise<string[]>}
   */
  async findAllStateFiles() {
    try {
      const entries = await fsp.readdir(this.tempDir, { withFileTypes: true });
      const result = [];
      for (const e of entries) {
        if (e.isDirectory()) {
          const statePath = this.getStateFilePath(e.name);
          if (fs.existsSync(statePath)) result.push(e.name);
        }
      }
      return result;
    } catch {
      return [];
    }
  }

  /**
   * Update a single chunk's state within the download.json.
   * Debounced: at most one file write per 500ms per download.
   * @param {string} downloadId
   * @param {number} chunkIndex
   * @param {Object} updates - { downloaded, status }
   */
  updateChunkState(downloadId, chunkIndex, updates) {
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

        // Async flush — fire and forget (errors logged internally)
        this._flushSingleDownload(downloadId, pending).catch(err => {
          console.error('[Resume] Debounced flush error:', err.message);
        });
      }, 500);
    }
  }

  /**
   * Flush pending updates for a single download (async, internal).
   * @param {string} downloadId
   * @param {Object} pending - { [chunkIndex]: updates }
   */
  async _flushSingleDownload(downloadId, pending) {
    const state = await this.loadState(downloadId);
    if (!state || !state.chunks) return;

    for (const [idx, upd] of Object.entries(pending)) {
      const chunk = state.chunks.find(c => c.index === parseInt(idx, 10));
      if (!chunk) continue;
      if (upd.downloaded !== undefined) chunk.downloaded = upd.downloaded;
      if (upd.status !== undefined) chunk.status = upd.status;
    }

    await this.saveState(state);
  }

  /**
   * Flush all pending debounced updates immediately.
   * Call before pause/cancel/shutdown to avoid losing state.
   */
  async flushPending() {
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
      try {
        await this._flushSingleDownload(downloadId, pending);
      } catch (err) {
        console.error('[Resume] flushPending error:', err.message);
      }
    }
    this._flushing = false;
  }

  // ── Gap 2: ResumeManager → DownloadManager visibility ──

  /**
   * Restore all resumable downloads by querying the DB and resuming each one
   * through DownloadManager. This creates a visible import/call edge from
   * ResumeManager → DownloadManager in the dependency graph.
   *
   * @param {Object} db - IDMMDatabase instance
   * @param {Object} downloadManager - DownloadManager instance (REQUIRED)
   * @returns {Promise<{resumed: string[], failed: Array<{id: string, error: string}>}>}
   */
  async restoreDownloads(db, downloadManager) {
    if (!downloadManager) throw new Error('downloadManager is required');

    const resumableResult = db.getResumableDownloads();
    if (!resumableResult.ok) {
      return { resumed: [], failed: [{ id: 'N/A', error: resumableResult.error }] };
    }

    const resumable = resumableResult.data || [];
    const resumed = [];
    const failed = [];

    for (const dl of resumable) {
      if (dl.status === 'completed' || dl.status === 'cancelled') continue;

      try {
        await downloadManager.resumeDownload(dl.id);
        resumed.push(dl.id);
      } catch (err) {
        failed.push({ id: dl.id, error: err.message });
      }
    }

    return { resumed, failed };
  }
}

module.exports = ResumeManager;
