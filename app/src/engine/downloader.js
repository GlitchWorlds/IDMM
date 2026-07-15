'use strict';

const { Worker } = require('node:worker_threads');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const ResumeManager = require('./resume');
const { mergeAndVerify, cleanupChunks } = require('./merge');
const { resolveFilename, ensureUniqueFilename } = require('../utils/filename');
const { detectMime, resolveCategory } = require('../utils/mime');
const { hashString } = require('../utils/hash');

/**
 * IDMAM Core Download Manager.
 *
 * Orchestrates multi-threaded chunk downloads via worker threads.
 * Handles the full lifecycle: probe → split → download → merge → verify.
 */

class DownloadManager {
  /**
   * @param {Object} options
   * @param {Object} options.db - IDMAMDatabase instance
   * @param {string} options.tempDir - Temp directory for chunk files
   * @param {Object} [options.settings] - Runtime settings
   * @param {Function} [options.onProgress] - Global progress callback (downloadId, state)
   * @param {Function} [options.onComplete] - Completion callback (downloadId, result)
   * @param {Function} [options.onError] - Error callback (downloadId, error)
   */
  constructor({ db, tempDir, settings = {}, onProgress, onComplete, onError }) {
    this.db = db;
    this.resume = new ResumeManager(tempDir);
    this.settings = settings;
    this.onProgress = onProgress || (() => {});
    this.onComplete = onComplete || (() => {});
    this.onError = onError || (() => {});

    // Active downloads: Map<downloadId, DownloadState>
    this.active = new Map();

    // Rolling speed tracking: Map<downloadId, Array<{time, bytes}>>
    this.speedSamples = new Map();
  }

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Start a new download.
   * @param {Object} params
   * @param {string} params.url - Download URL (required)
   * @param {string} [params.filename] - Desired filename
   * @param {string} [params.saveTo] - Save directory
   * @param {number} [params.threads] - Number of threads
   * @param {string} [params.cookies] - Cookie string
   * @param {string} [params.referrer] - Referrer URL
   * @param {Object} [params.headers] - Additional headers
   * @returns {Promise<Object>} Download info
   */
  async startDownload(params) {
    const {
      url,
      filename,
      saveTo,
      threads: requestedThreads,
      cookies,
      referrer,
      headers: extraHeaders = {},
    } = params;

    if (!url) throw new Error('URL is required');

    // Resolve settings (coerce to numbers — DB stores everything as strings)
    const defaultThreads = parseInt(this.settings.default_threads, 10) || 8;
    const maxThreads = parseInt(this.settings.max_threads_per_download, 10) || 64;
    const threads = Math.min(
      Math.max(requestedThreads || defaultThreads, 1),
      maxThreads
    );
    const savePath = saveTo || this.settings.default_save_path || path.join(require('node:os').homedir(), 'Downloads', 'IDMAM');
    const retryCount = parseInt(this.settings.retry_count, 10) || 3;
    const timeoutMs = parseInt(this.settings.timeout_ms, 10) || 30000;

    // Build request headers
    const requestHeaders = { ...extraHeaders };
    if (cookies) requestHeaders['Cookie'] = cookies;
    if (referrer) requestHeaders['Referer'] = referrer;

    // Step 1: Probe the URL (HEAD request) to get size + Range support
    const probe = await this._probeUrl(url, requestHeaders);

    // Step 2: Resolve filename
    const resolvedFilename = resolveFilename({
      url,
      filename,
      contentDisposition: probe.contentDisposition,
    });

    // Ensure unique filename in save directory
    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath, { recursive: true });
    }
    const finalFilename = ensureUniqueFilename(savePath, resolvedFilename, fs.existsSync);

    // Detect MIME and category
    const mimeType = probe.contentType || detectMime(finalFilename);
    const category = resolveCategory(finalFilename, probe.contentType);

    // Step 3: Create download record
    const downloadId = uuidv4();
    const download = {
      id: downloadId,
      url,
      filename: finalFilename,
      saveTo: savePath,
      totalSize: probe.contentLength || 0,
      threads: probe.acceptsRanges ? threads : 1,
      mimeType,
      category,
      cookies,
      referrer,
      headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : null,
      status: 'downloading',
    };

    this.db.createDownload(download);

    // Step 4: Set up temp directory for chunks
    const downloadTempDir = this.resume.getDownloadTempDir(downloadId);
    if (!fs.existsSync(downloadTempDir)) {
      fs.mkdirSync(downloadTempDir, { recursive: true });
    }

    // Step 5: Create chunks and start downloading
    const state = {
      id: downloadId,
      url,
      filename: finalFilename,
      saveTo: savePath,
      totalSize: download.totalSize,
      threads: download.threads,
      status: 'downloading',
      downloaded: 0,
      speed: 0,
      eta: 0,
      chunks: [],
      workers: [],
      startedAt: Date.now(),
      checksum: params.checksum || null,
      cookies,
      referrer,
      headers: download.headers,
      noRangeSupport: false,
      speedLimit: (parseInt(this.settings.speed_limit_global, 10) || 0) * 1024, // KB/s → bytes/s
    };

    this.active.set(downloadId, state);
    this.speedSamples.set(downloadId, []);

    if (probe.acceptsRanges && download.totalSize > 0) {
      // Multi-threaded mode
      await this._startChunkedDownload(state, {
        retryCount,
        timeoutMs,
        requestHeaders,
      });
    } else {
      // Single-stream fallback
      state.noRangeSupport = true;
      state.threads = 1;
      this.db.updateDownload(downloadId, { threads: 1 });
      await this._startSingleStreamDownload(state, {
        retryCount,
        timeoutMs,
        requestHeaders,
      });
    }

    return {
      id: downloadId,
      status: 'downloading',
      filename: finalFilename,
      total_size: download.totalSize,
      threads: download.threads,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Pause an active download.
   * @param {string} downloadId
   */
  pauseDownload(downloadId) {
    const state = this.active.get(downloadId);
    if (!state) throw new Error('Download not active');

    state.status = 'pausing';

    // Mark workers as intentionally terminated before terminating them.
    // This prevents late-firing exit handlers from marking chunks as 'failed'
    // when a subsequent resume spawns new workers for the same chunk.
    for (const worker of state.workers) {
      if (worker && typeof worker.__terminated !== 'undefined') {
        worker.__terminated = true;
      } else if (worker) {
        worker.__terminated = true;
      }
    }

    // Flush all chunk progress to DB and resume file BEFORE terminating
    this._flushChunkState(state);

    // Terminate all worker threads
    for (const worker of state.workers) {
      if (worker && !worker.exited) {
        worker.terminate();
      }
    }
    state.workers = [];

    state.status = 'paused';
    this.db.updateDownload(downloadId, { status: 'paused' });
    this.resume.saveState(state);
    this.active.delete(downloadId);
    this.speedSamples.delete(downloadId);

    return { id: downloadId, status: 'paused' };
  }

  /**
   * Resume a paused download.
   * @param {string} downloadId
   * @returns {Promise<Object>}
   */
  async resumeDownload(downloadId) {
    // Load state from DB
    const dbDownload = this.db.getDownloadWithChunks(downloadId);
    if (!dbDownload) throw new Error('Download not found');
    if (dbDownload.status === 'completed') throw new Error('Download already completed');

    // Also try loading from resume state file
    const resumeState = this.resume.loadState(downloadId);

    // Build state object — cross-validate DB chunk state with actual .part file sizes
    const downloadTempDir = this.resume.getDownloadTempDir(downloadId);
    const chunks = this._buildResumeChunks(downloadId, dbDownload);

    // Recalculate total downloaded from validated chunks
    const totalDownloaded = chunks.reduce((sum, c) => sum + c.downloaded, 0);

    const state = {
      id: downloadId,
      url: dbDownload.url,
      filename: dbDownload.filename,
      saveTo: dbDownload.save_to,
      totalSize: dbDownload.total_size,
      threads: dbDownload.threads,
      status: 'downloading',
      downloaded: totalDownloaded,
      speed: 0,
      eta: 0,
      chunks,
      workers: [],
      startedAt: Date.now(),
      checksum: dbDownload.checksum || null,
      cookies: dbDownload.cookies,
      referrer: dbDownload.referrer,
      headers: dbDownload.headers,
      noRangeSupport: false,
      speedLimit: (parseInt(this.settings.speed_limit_global, 10) || 0) * 1024, // KB/s → bytes/s
    };

    this.active.set(downloadId, state);
    this.speedSamples.set(downloadId, []);

    this.db.updateDownload(downloadId, { status: 'downloading' });

    const retryCount = parseInt(this.settings.retry_count, 10) || 3;
    const timeoutMs = parseInt(this.settings.timeout_ms, 10) || 30000;

    const requestHeaders = {};
    if (state.headers) Object.assign(requestHeaders, state.headers);
    if (state.cookies) requestHeaders['Cookie'] = state.cookies;
    if (state.referrer) requestHeaders['Referer'] = state.referrer;

    if (state.chunks.length > 1) {
      await this._resumeChunkedDownload(state, {
        retryCount,
        timeoutMs,
        requestHeaders,
      });
    } else if (state.chunks.length === 1) {
      state.noRangeSupport = true;
      await this._resumeSingleStreamDownload(state, {
        retryCount,
        timeoutMs,
        requestHeaders,
      });
    }

    return { id: downloadId, status: 'downloading' };
  }

  /**
   * Cancel a download and clean up.
   * @param {string} downloadId
   */
  cancelDownload(downloadId) {
    const state = this.active.get(downloadId);

    if (state) {
      // Terminate workers
      for (const worker of state.workers) {
        if (worker && !worker.exited) {
          worker.terminate();
        }
      }
      this.active.delete(downloadId);
      this.speedSamples.delete(downloadId);
    }

    // Cleanup temp files
    this.resume.cleanup(downloadId);

    // Update DB status
    this.db.updateDownload(downloadId, { status: 'cancelled' });

    return { id: downloadId, status: 'cancelled' };
  }

  /**
   * Delete a download and all its files.
   * @param {string} downloadId
   */
  deleteDownload(downloadId) {
    // Cancel if active
    if (this.active.has(downloadId)) {
      this.cancelDownload(downloadId);
    }

    const download = this.db.getDownload(downloadId);
    if (download) {
      // Delete the output file if it exists
      const outputPath = path.join(download.save_to, download.filename);
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      } catch {
        // Best effort
      }
    }

    // Cleanup temp files
    this.resume.cleanup(downloadId);

    // Remove from DB
    this.db.deleteDownload(downloadId);

    return { id: downloadId, deleted: true };
  }

  /**
   * Get the current state of a download (for API responses).
   * @param {string} downloadId
   * @returns {Object}
   */
  getDownloadState(downloadId) {
    // Check active downloads first (most accurate real-time data)
    const activeState = this.active.get(downloadId);
    if (activeState) {
      return this._formatState(activeState);
    }

    // Fall back to DB
    const dbDownload = this.db.getDownloadWithChunks(downloadId);
    if (!dbDownload) return null;

    return {
      id: dbDownload.id,
      url: dbDownload.url,
      filename: dbDownload.filename,
      save_to: dbDownload.save_to,
      status: dbDownload.status,
      total_size: dbDownload.total_size,
      downloaded: dbDownload.downloaded,
      progress: dbDownload.total_size > 0
        ? Math.round((dbDownload.downloaded / dbDownload.total_size) * 10000) / 100
        : 0,
      speed: 0,
      eta: 0,
      threads: dbDownload.threads,
      active_threads: 0,
      chunks: (dbDownload.chunks || []).map(c => ({
        index: c.chunk_index,
        progress: c.end_byte > c.start_byte
          ? Math.round((c.downloaded_bytes / (c.end_byte - c.start_byte + 1)) * 100)
          : 0,
        speed: 0,
        status: c.status,
      })),
      mime_type: dbDownload.mime_type,
      category: dbDownload.category,
      created_at: dbDownload.created_at,
      completed_at: dbDownload.completed_at,
      error: dbDownload.error,
    };
  }

  /**
   * Get all active download states for WebSocket broadcast.
   * @returns {Object[]}
   */
  getActiveStates() {
    const states = [];
    for (const [id, state] of this.active) {
      states.push(this._formatState(state));
    }
    return states;
  }

  /**
   * Get count of active downloads.
   * @returns {number}
   */
  getActiveCount() {
    return this.active.size;
  }

  // ─── Internal: Probing ───────────────────────────────────────────

  /**
   * Probe a URL with HEAD request to get file info.
   */
  _probeUrl(url, headers = {}, redirectCount = 0) {
    return new Promise((resolve, reject) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const transport = isHttps ? https : http;

      const reqOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'HEAD',
        headers: {
          'User-Agent': 'IDMAM/1.0',
          ...headers,
        },
        timeout: 15000,
      };

      const req = transport.request(reqOptions, (res) => {
        // Handle redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const newUrl = new URL(res.headers.location, url).href;
          resolve(this._probeUrl(newUrl, headers, redirectCount + 1));
          return;
        }

        const result = {
          contentLength: parseInt(res.headers['content-length'], 10) || 0,
          acceptsRanges: false,
          contentType: res.headers['content-type'] || null,
          contentDisposition: res.headers['content-disposition'] || null,
          etag: res.headers['etag'] || null,
          lastModified: res.headers['last-modified'] || null,
          statusCode: res.statusCode,
        };

        // Check Range support
        const acceptRanges = (res.headers['accept-ranges'] || '').toLowerCase();
        if (acceptRanges === 'bytes') {
          result.acceptsRanges = true;
        }

        resolve(result);
        res.resume(); // Drain response
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('HEAD request timed out'));
      });

      req.on('error', reject);
      req.end();
    });
  }

  // ─── Internal: Chunked Download ──────────────────────────────────

  /**
   * Start a multi-threaded chunked download.
   */
  async _startChunkedDownload(state, opts) {
    const { totalSize, threads } = state;
    const chunkSize = Math.ceil(totalSize / threads);

    // Build chunk descriptors
    const chunks = [];
    for (let i = 0; i < threads; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, totalSize - 1);
      if (start > end) continue;

      chunks.push({
        index: i,
        start,
        end,
        downloaded: 0,
        status: 'pending',
      });
    }

    state.chunks = chunks;

    // Save chunks to DB and resume file
    this.db.createChunks(state.id, chunks.map(c => ({
      index: c.index,
      start: c.start,
      end: c.end,
    })));
    this.resume.saveState(state);

    // Spawn workers
    this._spawnWorkers(state, opts);
  }

  /**
   * Spawn worker threads for each pending/incomplete chunk.
   */
  _spawnWorkers(state, opts) {
    for (const chunk of state.chunks) {
      if (chunk.status === 'done' || chunk.status === 'completed') continue;

      const chunkPath = this.resume.getChunkPath(state.id, chunk.index);

      // For resume: check existing .part file size
      let existingBytes = 0;
      if (fs.existsSync(chunkPath)) {
        try {
          existingBytes = fs.statSync(chunkPath).size;
          const expectedSize = chunk.end - chunk.start + 1;
          if (existingBytes >= expectedSize) {
            chunk.status = 'done';
            chunk.downloaded = expectedSize;
            continue; // This chunk is already complete
          }
          chunk.downloaded = existingBytes;
        } catch {
          existingBytes = 0;
        }
      }

      chunk.status = 'downloading';
      this._spawnWorker(state, chunk, chunkPath, opts);
    }

    // Check if all chunks are already done (resume edge case)
    const allDone = state.chunks.every(c => c.status === 'done');
    if (allDone) {
      this._finalizeDownload(state);
    }
  }

  /**
   * Spawn a single worker thread for a chunk.
   */
  _spawnWorker(state, chunk, chunkPath, opts) {
    const worker = new Worker(path.join(__dirname, 'chunk-worker.js'), {
      workerData: {
        url: state.url,
        start: chunk.start,
        end: chunk.end,
        filePath: chunkPath,
        headers: opts.requestHeaders,
        timeout: opts.timeoutMs,
        maxRetries: opts.retryCount,
        chunkIndex: chunk.index,
        downloadId: state.id,
        speedLimit: this._getPerWorkerSpeedLimit(state),
      },
    });

    state.workers.push(worker);

    worker.on('message', (msg) => {
      this._handleWorkerMessage(state, chunk, msg);
    });

    worker.on('error', (err) => {
      // Worker crashed (not just a download error)
      console.error(`[IDMAM] Worker error for chunk ${chunk.index}: ${err.message}`);
      chunk.status = 'failed';
      this._checkCompletion(state);
    });

    worker.on('exit', (code) => {
      // Remove from workers list
      const idx = state.workers.indexOf(worker);
      if (idx !== -1) state.workers.splice(idx, 1);

      // Skip failure marking if worker was intentionally terminated (pause/cancel)
      // or if this is a stale exit handler from a previous worker generation
      if (worker.__terminated) return;

      if (code !== 0 && chunk.status !== 'done' && chunk.status !== 'paused') {
        console.error(`[IDMAM] Worker exited with code ${code} for chunk ${chunk.index}`);
        chunk.status = 'failed';
      }
      this._checkCompletion(state);
    });
  }

  /**
   * Handle a message from a chunk worker.
   */
  _handleWorkerMessage(state, chunk, msg) {
    switch (msg.type) {
      case 'progress':
        chunk.downloaded = msg.downloaded;
        chunk.status = 'downloading';

        // Record speed sample
        const samples = this.speedSamples.get(state.id) || [];
        samples.push({ time: Date.now(), bytes: msg.chunkBytes });
        // Keep only last 3 seconds of samples
        const cutoff = Date.now() - 3000;
        while (samples.length > 0 && samples[0].time < cutoff) {
          samples.shift();
        }
        this.speedSamples.set(state.id, samples);

        // Update total downloaded
        this._recalcProgress(state);

        // Note: Speed limiting is handled at the worker level via token-bucket
        // in chunk-worker.js — no need to terminate workers from the main thread.

        // Persist to resume file periodically (every ~1MB)
        if (msg.downloaded % (1024 * 1024) < 65536) {
          this.resume.updateChunkState(state.id, chunk.index, {
            downloaded: msg.downloaded,
            status: 'downloading',
          });
          // Also update DB chunk record periodically for resume reliability
          const chunkRows = this.db.getChunks(state.id);
          const dbChunk = chunkRows.find(c => c.chunk_index === chunk.index);
          if (dbChunk) {
            this.db.updateChunk(dbChunk.id, {
              downloaded_bytes: msg.downloaded,
              status: 'downloading',
            });
          }
        }
        break;

      case 'chunk_done':
        chunk.status = 'done';
        chunk.downloaded = chunk.end - chunk.start + 1;
        this._recalcProgress(state);

        // Update DB chunk
        const chunkRows = this.db.getChunks(state.id);
        const dbChunk = chunkRows.find(c => c.chunk_index === chunk.index);
        if (dbChunk) {
          this.db.updateChunk(dbChunk.id, {
            downloaded_bytes: chunk.downloaded,
            status: 'done',
          });
        }

        this.resume.updateChunkState(state.id, chunk.index, {
          downloaded: chunk.downloaded,
          status: 'done',
        });

        this._checkCompletion(state);
        break;

      case 'error':
        if (msg.noRangeSupport) {
          state.noRangeSupport = true;
          // Cancel all workers, switch to single stream
          this._cancelAllWorkers(state);
          state.chunks = [{
            index: 0,
            start: 0,
            end: 0,
            downloaded: 0,
            status: 'pending',
          }];
          state.noRangeSupport = true;
          state.threads = 1;
          this._startSingleStreamDownload(state, {
            retryCount: this.settings.retry_count || 3,
            timeoutMs: this.settings.timeout_ms || 30000,
            requestHeaders: {},
          }).catch(err => {
            state.status = 'failed';
            state.error = err.message;
            this.db.updateDownload(state.id, { status: 'failed', error: err.message });
            this.onError(state.id, err);
          });
          return;
        }

        if (msg.exhausted) {
          chunk.status = 'failed';
          this._checkCompletion(state);
        }
        break;

      case 'retry':
        chunk.status = 'retrying';
        break;

      case 'attempt':
        // Worker is starting an attempt
        break;
    }
  }

  /**
   * Cancel all active workers for a download.
   */
  _cancelAllWorkers(state) {
    for (const worker of state.workers) {
      if (worker && !worker.exited) {
        worker.terminate();
      }
    }
    state.workers = [];
  }

  // ─── Internal: Chunk State Flush ────────────────────────────────

  /**
   * Build chunk descriptors for resume, cross-referencing DB, resume file, and disk.
   * @param {string} downloadId
   * @param {Object} dbDownload
   * @returns {Object[]}
   */
  _buildResumeChunks(downloadId, dbDownload) {
    // Try resume file first (most up-to-date)
    const resumeState = this.resume.loadState(downloadId);
    const resumeChunks = resumeState && resumeState.chunks ? resumeState.chunks : [];

    const dbChunks = dbDownload.chunks || [];
    const result = [];

    for (const dbC of dbChunks) {
      const chunk = {
        index: dbC.chunk_index,
        start: dbC.start_byte,
        end: dbC.end_byte,
        downloaded: dbC.downloaded_bytes || 0,
        status: dbC.status,
      };

      // Use resume file data if it has more progress
      const resumeC = resumeChunks.find(rc => rc.index === chunk.index);
      if (resumeC && (resumeC.downloaded || 0) > chunk.downloaded) {
        chunk.downloaded = resumeC.downloaded;
        chunk.status = resumeC.status || chunk.status;
      }

      // Cross-reference with actual .part file size on disk
      const chunkPath = this.resume.getChunkPath(downloadId, chunk.index);
      try {
        if (fs.existsSync(chunkPath)) {
          const diskSize = fs.statSync(chunkPath).size;
          const expectedSize = chunk.end - chunk.start + 1;
          if (diskSize >= expectedSize) {
            chunk.downloaded = expectedSize;
            chunk.status = 'done';
          } else if (diskSize > chunk.downloaded) {
            chunk.downloaded = diskSize;
          }
        }
      } catch {
        // Use existing values
      }

      result.push(chunk);
    }

    return result;
  }

  /**
   * Calculate per-worker speed limit (bytes/sec).
   * Global limit is split evenly across active workers.
   * @returns {number} 0 = unlimited
   */
  _getPerWorkerSpeedLimit(state) {
    const globalLimit = parseInt(this.settings.speed_limit_global, 10) || 0;
    if (globalLimit <= 0) return 0;
    const activeWorkers = Math.max(state.workers.filter(w => w && !w.exited).length, 1);
    return Math.floor(globalLimit / activeWorkers);
  }

  /**
   * Flush all chunk downloaded bytes to DB and resume file.
   * Called periodically during download and before pause.
   */
  _flushChunkState(state) {
    for (const chunk of state.chunks) {
      // Read actual file size on disk for accuracy
      const chunkPath = this.resume.getChunkPath(state.id, chunk.index);
      let actualDownloaded = chunk.downloaded;
      try {
        if (fs.existsSync(chunkPath)) {
          actualDownloaded = fs.statSync(chunkPath).size;
          chunk.downloaded = actualDownloaded;
        }
      } catch {
        // Use in-memory value
      }

      // Update DB chunk record
      const chunkRows = this.db.getChunks(state.id);
      const dbChunk = chunkRows.find(c => c.chunk_index === chunk.index);
      if (dbChunk) {
        this.db.updateChunk(dbChunk.id, {
          downloaded_bytes: actualDownloaded,
          status: chunk.status,
        });
      }

      // Update resume file
      this.resume.updateChunkState(state.id, chunk.index, {
        downloaded: actualDownloaded,
        status: chunk.status,
      });
    }
  }

  // ─── Internal: Single Stream (fallback) ──────────────────────────

  /**
   * Download without Range support — single HTTP stream.
   */
  _startSingleStreamDownload(state, opts) {
    return new Promise((resolve, reject) => {
      const chunkPath = this.resume.getChunkPath(state.id, 0);

      // Check existing partial download
      let existingBytes = 0;
      if (fs.existsSync(chunkPath)) {
        try {
          existingBytes = fs.statSync(chunkPath).size;
        } catch {
          existingBytes = 0;
        }
      }

      state.chunks = [{
        index: 0,
        start: 0,
        end: state.totalSize > 0 ? state.totalSize - 1 : 0,
        downloaded: existingBytes,
        status: 'downloading',
      }];

      // Save to DB and resume file
      if (this.db.getChunks(state.id).length === 0) {
        this.db.createChunks(state.id, [{
          index: 0,
          start: 0,
          end: state.totalSize > 0 ? state.totalSize - 1 : 0,
        }]);
      }
      this.resume.saveState(state);

      this._doSingleStream(state, opts, chunkPath, existingBytes, resolve, reject);
    });
  }

  _doSingleStream(state, opts, chunkPath, existingBytes, resolve, reject) {
    const parsed = new URL(state.url);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'IDMAM/1.0',
        ...(opts.requestHeaders || {}),
      },
      timeout: opts.timeoutMs,
    };

    const req = transport.request(reqOptions, (res) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        state.url = new URL(res.headers.location, state.url).href;
        this._doSingleStream(state, opts, chunkPath, existingBytes, resolve, reject);
        return;
      }

      if (res.statusCode !== 200 && res.statusCode !== 206) {
        reject(new Error(`HTTP ${res.statusCode} for single-stream download`));
        return;
      }

      // Update total size if we got it from response
      if (res.headers['content-length'] && state.totalSize === 0) {
        state.totalSize = parseInt(res.headers['content-length'], 10) || 0;
        state.chunks[0].end = state.totalSize > 0 ? state.totalSize - 1 : 0;
        this.db.updateDownload(state.id, { total_size: state.totalSize });
      }

      const fileStream = fs.createWriteStream(chunkPath, {
        flags: existingBytes > 0 ? 'a' : 'w',
      });

      res.on('data', (chunk) => {
        fileStream.write(chunk);
        state.chunks[0].downloaded += chunk.length;

        // Speed samples
        const samples = this.speedSamples.get(state.id) || [];
        samples.push({ time: Date.now(), bytes: chunk.length });
        const cutoff = Date.now() - 3000;
        while (samples.length > 0 && samples[0].time < cutoff) samples.shift();
        this.speedSamples.set(state.id, samples);

        this._recalcProgress(state);
      });

      res.on('end', () => {
        fileStream.end(() => {
          state.chunks[0].status = 'done';
          this._finalizeDownload(state);
          resolve();
        });
      });

      res.on('error', (err) => {
        fileStream.end();
        reject(err);
      });
    });

    state.workers.push({ terminate: () => req.destroy(), exited: false });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Single-stream download timed out'));
    });

    req.on('error', reject);
    req.end();
  }

  /**
   * Resume a single-stream download.
   */
  async _resumeSingleStreamDownload(state, opts) {
    return new Promise((resolve, reject) => {
      const chunkPath = this.resume.getChunkPath(state.id, 0);
      const existingBytes = state.chunks[0]?.downloaded || 0;

      state.chunks[0].status = 'downloading';
      this._doSingleStream(state, opts, chunkPath, existingBytes, resolve, reject);
    });
  }

  /**
   * Resume a chunked download.
   */
  async _resumeChunkedDownload(state, opts) {
    // Validate chunk integrity
    const validation = this.resume.validateChunks(state.id, state.chunks);
    if (!validation.valid) {
      // Some chunks are corrupted — reset them
      for (let i = 0; i < validation.chunks.length; i++) {
        if (!validation.chunks[i].valid) {
          const chunkPath = this.resume.getChunkPath(state.id, i);
          if (fs.existsSync(chunkPath)) {
            fs.unlinkSync(chunkPath);
          }
          state.chunks[i].downloaded = 0;
          state.chunks[i].status = 'pending';
        }
      }
    }

    // Update chunk downloaded amounts from validated files
    for (const vc of validation.chunks) {
      const chunk = state.chunks.find(c => c.index === vc.index);
      if (chunk && vc.actualSize !== undefined) {
        chunk.downloaded = vc.actualSize;
      }
    }

    this._recalcProgress(state);
    this._spawnWorkers(state, opts);
  }

  // ─── Internal: Progress Tracking ─────────────────────────────────

  /**
   * Recalculate total downloaded bytes and speed.
   */
  _recalcProgress(state) {
    let totalDownloaded = 0;
    for (const chunk of state.chunks) {
      totalDownloaded += chunk.downloaded;
    }
    state.downloaded = totalDownloaded;

    // Calculate speed (rolling average over last 3 seconds)
    const samples = this.speedSamples.get(state.id) || [];
    if (samples.length >= 2) {
      const totalBytes = samples.reduce((sum, s) => sum + s.bytes, 0);
      const timeSpan = (samples[samples.length - 1].time - samples[0].time) / 1000;
      if (timeSpan > 0) {
        state.speed = totalBytes / timeSpan;
      }
    }

    // ETA
    if (state.speed > 0 && state.totalSize > 0) {
      const remaining = state.totalSize - totalDownloaded;
      state.eta = Math.ceil(remaining / state.speed);
    }

    // Persist to DB periodically
    this.db.updateDownload(state.id, {
      downloaded: totalDownloaded,
      speed: state.speed,
      eta: state.eta,
    });

    // Notify listeners
    this.onProgress(state.id, this._formatState(state));
  }

  /**
   * Check if all chunks are done → finalize.
   */
  _checkCompletion(state) {
    if (state.status === 'paused' || state.status === 'cancelled') return;
    if (state._finalizing) return; // Guard against double finalization

    const allDone = state.chunks.every(c => c.status === 'done');
    const anyFailed = state.chunks.some(c => c.status === 'failed');
    const anyDownloading = state.chunks.some(c => c.status === 'downloading');

    if (allDone) {
      state._finalizing = true;
      this._finalizeDownload(state);
    } else if (anyFailed && !anyDownloading) {
      // All active workers finished, but some failed
      if (state._finalizing) return;
      state._finalizing = true;
      state.status = 'failed';
      const failedChunks = state.chunks.filter(c => c.status === 'failed').length;
      const errMsg = `${failedChunks} chunk(s) failed to download`;
      state.error = errMsg;
      this.db.updateDownload(state.id, { status: 'failed', error: errMsg });
      this.onError(state.id, new Error(errMsg));
      this.active.delete(state.id);
      this.speedSamples.delete(state.id);
    }
  }

  /**
   * Finalize a completed download: merge chunks, verify, cleanup.
   */
  async _finalizeDownload(state) {
    try {
      state.status = 'merging';
      this.db.updateDownload(state.id, { status: 'merging' });

      const outputPath = path.join(state.saveTo, state.filename);
      const chunkPaths = state.chunks
        .sort((a, b) => a.index - b.index)
        .map(c => this.resume.getChunkPath(state.id, c.index));

      // Merge + optional checksum verification
      const result = await mergeAndVerify({
        downloadId: state.id,
        chunkPaths,
        outputPath,
        totalSize: state.totalSize || state.downloaded,
        expectedChecksum: state.checksum,
        cleanupAfter: true,
      });

      // Update DB
      state.status = 'completed';
      const completedAt = new Date().toISOString();
      this.db.updateDownload(state.id, {
        status: 'completed',
        downloaded: state.downloaded,
        speed: 0,
        eta: 0,
        completed_at: completedAt,
        checksum: result.checksum || null,
      });

      // Clean up resume state
      this.resume.cleanup(state.id);

      // Notify
      this.onComplete(state.id, {
        id: state.id,
        filename: state.filename,
        total_size: state.totalSize,
        duration: Math.round((Date.now() - state.startedAt) / 1000),
        average_speed: state.totalSize > 0
          ? Math.round(state.totalSize / ((Date.now() - state.startedAt) / 1000))
          : 0,
        checksum: result.checksum,
        verified: result.verified,
      });

      this.active.delete(state.id);
      this.speedSamples.delete(state.id);
    } catch (err) {
      state.status = 'failed';
      state.error = err.message;
      this.db.updateDownload(state.id, { status: 'failed', error: err.message });
      this.onError(state.id, err);
      this.active.delete(state.id);
      this.speedSamples.delete(state.id);
    }
  }

  /**
   * Format a download state for API/WebSocket response.
   */
  _formatState(state) {
    const totalDownloaded = state.chunks.reduce((sum, c) => sum + (c.downloaded || 0), 0);
    const progress = state.totalSize > 0
      ? Math.round((totalDownloaded / state.totalSize) * 10000) / 100
      : 0;

    return {
      id: state.id,
      url: state.url,
      filename: state.filename,
      save_to: state.saveTo,
      status: state.status,
      total_size: state.totalSize,
      downloaded: totalDownloaded,
      progress,
      speed: Math.round(state.speed || 0),
      eta: state.eta || 0,
      threads: state.threads,
      active_threads: state.workers.filter(w => w && !w.exited).length,
      chunks: state.chunks.map(c => ({
        index: c.index,
        progress: c.end > c.start
          ? Math.round((c.downloaded / (c.end - c.start + 1)) * 100)
          : (c.status === 'done' ? 100 : 0),
        speed: 0, // Per-chunk speed tracked at worker level
        status: c.status,
        downloaded: c.downloaded,
        total: c.end - c.start + 1,
      })),
      error: state.error || null,
    };
  }
}

module.exports = DownloadManager;
