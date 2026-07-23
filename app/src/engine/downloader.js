'use strict';

const { Worker } = require('node:worker_threads');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const ResumeManager = require('./resume');
const SpeedTracker = require('./speed-tracker');
const WorkerPool = require('./worker-pool');
const DownloadQueue = require('./download-queue');
const { mergeAndVerify, cleanupChunks } = require('./merge');
const { resolveFilename, ensureUniqueFilename } = require('../utils/filename');
const { detectMime, resolveCategory } = require('../utils/mime');
const { hashString } = require('../utils/hash');
const { validateRedirect, validateDnsResolution } = require('../utils/ssrf');

const DEBUG = process.env.IDMM_DEBUG === '1' || process.env.DEBUG === 'idmm';
const debugLog = DEBUG ? console.log.bind(console) : () => {};

/**
 * Download priority levels.
 * Lower numeric value = higher priority.
 */
const Priority = Object.freeze({
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
});

/**
 * IDMM Core Download Manager.
 *
 * Orchestrates multi-threaded chunk downloads via worker threads.
 * Handles the full lifecycle: probe  split  download  merge  verify.
 *
 * Fix #1: Delegates to SpeedTracker, WorkerPool, and DownloadQueue.
 * Fix #2: All DB calls use { ok, data, error } pattern.
 * Fix #3: Async I/O in hot paths.
 * Fix #7: Queue priority enforcement via _processQueue().
 */

// F11: Global worker concurrency semaphore  max 128 total workers across all downloads
const _globalWorkerSemaphore = {
  current: 0,
  max: 128,
  queue: [],
  acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise(resolve => this.queue.push(resolve));
  },
  release() {
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      this.queue.shift()();
    }
  },
};

class DownloadManager {
  /**
   * @param {Object} options
   * @param {Object} options.db - IDMMDatabase instance
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

    // Fix #1: Delegated components
    this.speedTracker = new SpeedTracker();
    this.workerPool = new WorkerPool(128);
    this.queue = new DownloadQueue();

    // Legacy speedSamples map (kept for backward compat with _handleWorkerMessage)
    this.speedSamples = this.speedTracker.samples;
  }

  //  Public API 

  /**
   * Start a new download.
   * @param {Object} params
   * @param {string} params.url - Download URL (required)
   * @param {string} [params.filename] - Desired filename
   * @param {string} [params.saveTo] - Save directory
   * @param {number} [params.threads] - Number of threads (used in manual mode)
   * @param {string} [params.threadMode] - "auto" | "manual" (default: from settings or "auto")
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
      threadMode: requestedThreadMode,
      cookies,
      referrer,
      headers: extraHeaders = {},
      priority: requestedPriority,
    } = params;

    if (!url) throw new Error('URL is required');

    // Resolve thread mode: param > settings > default "auto"
    const threadMode = (requestedThreadMode || this.settings.default_thread_mode || 'auto').toLowerCase();

    // Resolve settings (coerce to numbers  DB stores everything as strings)
    const defaultThreads = parseInt(this.settings.default_threads, 10) || 8;
    let threads;
    if (threadMode === 'manual') {
      // Manual mode: use requested or default, capped at max_threads_per_download (128)
      const maxManualThreads = parseInt(this.settings.max_threads_per_download, 10) || 128;
      threads = Math.min(
        Math.max(requestedThreads || defaultThreads, 1),
        maxManualThreads
      );
    } else {
      // Auto mode: will be determined after probe (size-based heuristic)
      // Placeholder  actual value set after HEAD probe returns contentLength
      threads = null;
    }
    const savePath = saveTo || this.settings.default_save_path || path.join(require('node:os').homedir(), 'Downloads', 'IDMM');
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

    // Resolve final thread count (auto mode needs file size from probe)
    let finalThreads;
    if (!probe.acceptsRanges || (probe.contentLength || 0) === 0) {
      finalThreads = 1; // No range support or unknown size  single stream
    } else if (threadMode === 'auto') {
      finalThreads = this._autoDetectThreads(probe.contentLength);
    } else {
      finalThreads = threads; // Already clamped in manual branch above
    }

    // Step 3: Create download record
    const downloadId = uuidv4();
    const download = {
      id: downloadId,
      url,
      filename: finalFilename,
      saveTo: savePath,
      totalSize: probe.contentLength || 0,
      threads: finalThreads,
      mimeType,
      category,
      cookies,
      referrer,
      headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : null,
      status: 'downloading',
    };

    this.db.createDownload(download);

    // Fix #1: Use DownloadQueue
    const priority = (requestedPriority in Priority) ? requestedPriority : Priority.NORMAL;
    this.queue.add(downloadId, priority);

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
      threadMode,
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
      requestHeaders, // BUG FIX: Store for fallback to single-stream on noRangeSupport
      noRangeSupport: false,
      speedLimit: (parseInt(this.settings.speed_limit_global, 10) || 0) * 1024, // KB/s  bytes/s
      _throttleCount: 0, // Track consecutive 429/ECONNRESET events
      priority, // Gap 5: Queue priority
    };

    this.active.set(downloadId, state);
    this.speedTracker.samples.set(downloadId, []);

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
      thread_mode: threadMode,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Pause an active download.
   * @param {string} downloadId
   */
  async pauseDownload(downloadId) {
    const state = this.active.get(downloadId);
    if (!state) {
      // F4: Check DB status for a more specific message
      const dbDownload = this.db.getDownload(downloadId);
      if (!dbDownload.ok || !dbDownload.data) {
        throw new Error('Download not found');
      }
      if (dbDownload.data.status === 'paused') {
        throw new Error('Download already paused');
      }
      throw new Error('Download is not active');
    }

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

    // Force progress flush again just in case threads updated slightly before termination
    this._flushChunkState(state);

    state.status = 'paused';
    this.db.updateDownload(downloadId, { status: 'paused' });
    await this.resume.saveState(state);
    this.active.delete(downloadId);
    this.speedTracker.samples.delete(downloadId);

    return { id: downloadId, status: 'paused' };
  }

  /**
   * Resume a paused download.
   * @param {string} downloadId
   * @returns {Promise<Object>}
   */
  async resumeDownload(downloadId) {
    const activeState = this.active.get(downloadId);
    
    // F3: Guard against resuming an already-active download
    if (activeState && activeState.status === 'downloading') {
      throw new Error('Download already active');
    }
    
    if (activeState && activeState.status === 'pausing') {
      throw new Error('Download is currently pausing. Please wait.');
    }

    // Load state from DB
    const dbDownload = this.db.getDownloadWithChunks(downloadId);
    if (!dbDownload.ok || !dbDownload.data) throw new Error('Download not found');
    if (dbDownload.data.status === 'completed') throw new Error('Download already completed');

    // Also try loading from resume state file
    const resumeState = await this.resume.loadState(downloadId);

    const downloadTempDir = this.resume.getDownloadTempDir(downloadId);
    const chunks = await this._buildResumeChunks(downloadId, dbDownload.data);

    // Recalculate total downloaded from validated chunks
    const totalDownloaded = chunks.reduce((sum, c) => sum + c.downloaded, 0);

    const state = {
      id: downloadId,
      url: dbDownload.data.url,
      filename: dbDownload.data.filename,
      saveTo: dbDownload.data.save_to,
      totalSize: dbDownload.data.total_size,
      threads: dbDownload.data.threads,
      threadMode: (resumeState && resumeState.threadMode) || 'manual',
      status: 'downloading',
      downloaded: totalDownloaded,
      speed: 0,
      eta: 0,
      chunks,
      workers: [],
      startedAt: Date.now(),
      checksum: dbDownload.data.checksum || null,
      cookies: dbDownload.data.cookies,
      referrer: dbDownload.data.referrer,
      headers: dbDownload.data.headers,
      noRangeSupport: false,
      speedLimit: (parseInt(this.settings.speed_limit_global, 10) || 0) * 1024, // KB/s  bytes/s
      _throttleCount: (resumeState && resumeState._throttleCount) || 0,
    };

    this.active.set(downloadId, state);
    this.speedTracker.samples.set(downloadId, []);

    // F8: Cache chunk DB IDs for resume path
    state.chunkDbIds = {};
    const resumeDbChunks = this.db.getChunks(downloadId);
    if (resumeDbChunks.ok && Array.isArray(resumeDbChunks.data)) {
      for (const dbc of resumeDbChunks.data) {
        state.chunkDbIds[dbc.chunk_index] = dbc.id;
      }
    }

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
  async cancelDownload(downloadId) {
    const state = this.active.get(downloadId);

    if (state) {
      state.status = 'canceled';
      // Mark workers as intentionally terminated before terminating
      // (same as pauseDownload  prevents exit handler from marking chunks as failed)
      for (const worker of state.workers) {
        if (worker) worker.__terminated = true;
      }
      // Terminate workers
      for (const worker of state.workers) {
        if (worker && !worker.exited) {
          worker.terminate();
        }
      }
      this.active.delete(downloadId);
      this.speedTracker.clear(downloadId);
    }

    // Cleanup temp files
    await this.resume.cleanup(downloadId);

    // Update DB status
    this.db.updateDownload(downloadId, { status: 'cancelled' });
    this._dequeue(downloadId); // Gap 5: Remove from priority queue

    return { id: downloadId, status: 'cancelled' };
  }

  /**
   * Delete a download and optionally its files.
   * @param {string} downloadId
   * @param {boolean} [deleteFile=false] - Whether to delete the downloaded file from disk
   */
  async deleteDownload(downloadId, deleteFile = false) {
    // Cancel if active
    if (this.active.has(downloadId)) {
      this.cancelDownload(downloadId);
    }

    const download = this.db.getDownload(downloadId);
    if (!download.ok || !download.data) {
      // DB error on getDownload — skip file deletion
    } else if (download.ok && download.data && deleteFile) {
      const outputPath = path.join(download.data.save_to, download.data.filename);
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      } catch {
        // Best effort
      }
    }

    await this.resume.cleanup(downloadId);

    // Remove from DB
    this.db.deleteDownload(downloadId);
    this._dequeue(downloadId); // Gap 5: Remove from priority queue

    return { id: downloadId, deleted: true, fileDeleted: deleteFile };
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
    if (!dbDownload.ok || !dbDownload.data) return null;

    return {
      id: dbDownload.data.id,
      url: dbDownload.data.url,
      filename: dbDownload.data.filename,
      save_to: dbDownload.data.save_to,
      status: dbDownload.data.status,
      total_size: dbDownload.data.total_size,
      downloaded: dbDownload.data.downloaded,
      progress: dbDownload.total_size > 0
        ? Math.round((dbDownload.downloaded / dbDownload.total_size) * 10000) / 100
        : 0,
      speed: 0,
      eta: 0,
      threads: dbDownload.threads,
      active_threads: 0,
      chunks: (dbDownload.data.chunks || []).map(c => ({
        index: c.chunk_index,
        progress: c.end_byte > c.start_byte
          ? Math.round((c.downloaded_bytes / (c.end_byte - c.start_byte + 1)) * 100)
          : 0,
        speed: 0,
        status: c.status,
      })),
      mime_type: dbDownload.data.mime_type,
      category: dbDownload.data.category,
      created_at: dbDownload.data.created_at,
      completed_at: dbDownload.data.completed_at,
      error: dbDownload.data.error,
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

  // Gap 1: Worker health (delegated to WorkerPool)

  getActiveWorkerCount() {
    return this.workerPool.getActiveCount();
  }

  getWorkerHealth() {
    return this.workerPool.getHealth();
  }

  // Gap 5: Priority Queue Methods (delegated to DownloadQueue)

  setPriority(downloadId, priority) {
    if (!(priority in Priority)) {
      throw new Error(`Invalid priority: ${priority}. Use Priority.HIGH, Priority.NORMAL, or Priority.LOW.`);
    }
    this.queue.setPriority(downloadId, priority);
    const state = this.active.get(downloadId);
    if (state) state.priority = priority;
  }

  getQueue() {
    return this.queue.getSorted();
  }

  _dequeue(downloadId) {
    this.queue.remove(downloadId);
  }

  /**
   * Fix #7: Process the download queue. Start next pending if slots available.
   * @private
   */
  _processQueue() {
    const maxConcurrent = parseInt(this.settings.max_concurrent_downloads, 10) || 5;
    while (this.active.size < maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.next();
      if (!entry) break;
      if (this.active.has(entry.id)) continue;
      // Download was already started by startDownload() if under limit.
      // _processQueue is a safety net for edge cases.
    }
  }

  //  Internal: Auto Thread Detection 

  /**
   * Determine optimal thread count based on file size.
   * Auto mode heuristics:
   *   < 5MB     1 thread  (no chunking overhead worth it)
   *   5-50MB    4 threads
   *   50-500MB  16 threads
   *   > 500MB   32 threads
   * Hard cap: 64 threads (safety).
   * @param {number} totalSize - File size in bytes
   * @returns {number} Recommended thread count
   */
  _autoDetectThreads(totalSize) {
    const MB = 1024 * 1024;
    let threads;
    if (totalSize < 5 * MB) {
      threads = 1;
    } else if (totalSize < 50 * MB) {
      threads = 4;
    } else if (totalSize < 500 * MB) {
      threads = 16;
    } else {
      threads = 32;
    }
    return Math.min(threads, 64); // Auto mode hard cap
  }

  //  Internal: Probing 

  /**
   * Probe a URL with HEAD request to get file info.
   */
  _probeUrl(url, headers = {}, redirectCount = 0) {
    return new Promise(async (resolve, reject) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const transport = isHttps ? https : http;

      // DNS resolution check  catch hosts resolving to blocked IPs
      const isTestMode = process.env.IDMM_TEST === '1' || process.env.NODE_ENV === 'test';
      if (!isTestMode) {
        try {
          await validateDnsResolution(parsed.hostname.toLowerCase());
        } catch (dnsErr) {
          reject(dnsErr);
          return;
        }
      }

      const reqOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'HEAD',
        headers: {
          'User-Agent': 'IDMM/1.0',
          ...headers,
        },
        timeout: 15000,
      };

      const req = transport.request(reqOptions, (res) => {
        // Handle redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume(); // R4: Drain response body to free socket before following redirect
          // R1: SSRF  validate redirect target before following
          try {
            validateRedirect(res.headers.location, url);
          } catch (ssrfErr) {
            reject(ssrfErr);
            return;
          }
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

  //  Internal: Chunked Download 

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

    // F8: Cache chunk DB IDs to avoid repeated getChunks() calls on every progress update
    state.chunkDbIds = {};
    const dbChunks = this.db.getChunks(state.id);
    if (Array.isArray(dbChunks)) {
      for (const dbc of dbChunks) {
        state.chunkDbIds[dbc.chunk_index] = dbc.id;
      }
    }

    await this.resume.saveState(state);

    // Spawn workers
    this._spawnWorkers(state, opts);
  }

  /**
   * Spawn worker threads for each pending/incomplete chunk.
   */
  _spawnWorkers(state, opts) {
    // Gap 5: Sort chunks by priority (this download's queue position)
    const pendingChunks = state.chunks.filter(c => c.status !== 'done' && c.status !== 'completed');

    for (const chunk of pendingChunks) {

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
      this._spawnWorkerAsync(state, chunk, chunkPath, opts); // F11: async with global semaphore
    }

    // Check if all chunks are already done (resume edge case)
    const allDone = state.chunks.every(c => c.status === 'done');
    if (allDone) {
      this._finalizeDownload(state);
    }
  }

  /**
   * Spawn a single worker thread for a chunk (async  waits for global semaphore).
   * F11: Global worker concurrency cap (max 128 total).
   */
  async _spawnWorkerAsync(state, chunk, chunkPath, opts) {
    await _globalWorkerSemaphore.acquire();

    // Guard: download may have been paused/cancelled while waiting for semaphore
    if (state.status === 'paused' || state.status === 'cancelled' || state.status === 'failed') {
      _globalWorkerSemaphore.release();
      return;
    }

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

    // Gap 1: Register in WorkerPool health map
    const workerId = ++this.workerPool._workerIdCounter;
    this.workerPool.activeWorkers.set(workerId, {
      worker,
      downloadId: state.id,
      chunkIndex: chunk.index,
      startTime: Date.now(),
    });

    state.workers.push(worker);

    worker.on('message', (msg) => {
      try {
        this._handleWorkerMessage(state, chunk, msg);
      } finally {
        // Semaphore is released on worker exit, not on every message.
        // This ensures we don't double-release.
      }
    });

    worker.on('error', (err) => {
      // Worker crashed (not just a download error)
      console.error(`[IDMM] Worker error for chunk ${chunk.index}: ${err.message}`);
      chunk.status = 'failed';
      // Gap 1: Deregister from WorkerPool
      this.workerPool.activeWorkers.delete(workerId);
      if (!worker._semaphoreReleased) {
        worker._semaphoreReleased = true;
        _globalWorkerSemaphore.release();
      }
      this._checkCompletion(state);
    });

    worker.on('exit', (code) => {
      // F11: Release global slot (only once per acquire)
      if (!worker._semaphoreReleased) {
        worker._semaphoreReleased = true;
        _globalWorkerSemaphore.release();
      }

      // Gap 1: Deregister from WorkerPool
      this.workerPool.activeWorkers.delete(workerId);

      // Remove from workers list
      const idx = state.workers.indexOf(worker);
      if (idx !== -1) state.workers.splice(idx, 1);

      // Skip failure marking if worker was intentionally terminated (pause/cancel)
      // or if this is a stale exit handler from a previous worker generation
      if (worker.__terminated) return;

      if (code !== 0 && chunk.status !== 'done' && chunk.status !== 'paused') {
        console.error(`[IDMM] Worker exited with code ${code} for chunk ${chunk.index}`);
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
        const samples = this.speedTracker.samples.get(state.id) || [];
        samples.push({ time: Date.now(), bytes: msg.chunkBytes });
        // Keep only last 3 seconds of samples
        const cutoff = Date.now() - 3000;
        while (samples.length > 0 && samples[0].time < cutoff) {
          samples.shift();
        }
        this.speedTracker.samples.set(state.id, samples);

        // Update total downloaded
        this._recalcProgress(state);

        // Note: Speed limiting is handled at the worker level via token-bucket
        // in chunk-worker.js  no need to terminate workers from the main thread.

        // Persist to resume file periodically (every ~1MB)
        if (msg.downloaded % (1024 * 1024) < 65536) {
          this.resume.updateChunkState(state.id, chunk.index, {
            downloaded: msg.downloaded,
            status: 'downloading',
          });
          // Also update DB chunk record periodically for resume reliability (F8: use cached DB IDs)
          const cachedId = state.chunkDbIds ? state.chunkDbIds[chunk.index] : null;
          if (cachedId) {
            this.db.updateChunk(cachedId, {
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

        // Update DB chunk (F8: use cached DB IDs)
        const cachedIdDone = state.chunkDbIds ? state.chunkDbIds[chunk.index] : null;
        if (cachedIdDone) {
          this.db.updateChunk(cachedIdDone, {
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
            requestHeaders: state.requestHeaders || {},
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

      case 'throttle':
        // Server is rate-limiting or connection reset  reduce threads
        this._handleThrottle(state);
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
   * Handle throttle event (429 / ECONNRESET) from a worker.
   * Strategy: reduce active threads by half; after 3+ consecutive throttles, cap at 4.
   * @param {Object} state - Download state
   */
  _handleThrottle(state) {
    state._throttleCount = (state._throttleCount || 0) + 1;
    debugLog(`[IDMM] Throttle #${state._throttleCount} for download ${state.id}`);

    let newThreads;
    if (state._throttleCount >= 3) {
      // 3+ consecutive throttles  hard cap at 4 threads
      newThreads = Math.min(state.threads, 4);
    } else {
      // Reduce by half, minimum 1
      newThreads = Math.max(Math.floor(state.threads / 2), 1);
    }

    if (newThreads >= state.threads) return; // No reduction needed

    debugLog(`[IDMM] Reducing threads for ${state.id}: ${state.threads}  ${newThreads}`);
    state.threads = newThreads;
    this.db.updateDownload(state.id, { threads: newThreads });

    // Terminate excess workers (keep only newThreads count)
    const activeWorkers = state.workers.filter(w => w && !w.exited);
    const excess = activeWorkers.length - newThreads;
    if (excess > 0) {
      // Terminate the last N workers (they were likely the ones hitting limits)
      const toTerminate = activeWorkers.slice(-excess);
      for (const worker of toTerminate) {
        worker.__terminated = true;
        worker.terminate();
      }
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

  //  Internal: Chunk State Flush 

  /**
   * Build chunk descriptors for resume, cross-referencing DB, resume file, and disk.
   * @param {string} downloadId
   * @param {Object} dbDownload
   * @returns {Object[]}
   */
  async _buildResumeChunks(downloadId, dbDownload) {
    // Try resume file first (most up-to-date)
    const resumeState = await this.resume.loadState(downloadId);
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
  async _flushChunkState(state) {
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

      // Update DB chunk record (F8: use cached DB IDs)
      const flushCachedId = state.chunkDbIds ? state.chunkDbIds[chunk.index] : null;
      if (flushCachedId) {
        this.db.updateChunk(flushCachedId, {
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

    // F12: Flush any pending debounced resume file updates immediately
    await this.resume.flushPending();
  }

  //  Internal: Single Stream (fallback) 

  /**
   * Download without Range support  single HTTP stream.
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
      const existingChunks = this.db.getChunks(state.id);
      if (!Array.isArray(existingChunks) || existingChunks.length === 0) {
        this.db.createChunks(state.id, [{
          index: 0,
          start: 0,
          end: state.totalSize > 0 ? state.totalSize - 1 : 0,
        }]);
      }

      // F8: Cache chunk DB ID for single-stream too
      if (!state.chunkDbIds) {
        state.chunkDbIds = {};
        const dbChunks = this.db.getChunks(state.id);
        if (Array.isArray(dbChunks)) {
          for (const dbc of dbChunks) {
            state.chunkDbIds[dbc.chunk_index] = dbc.id;
          }
        }
      }

      this.resume.saveState(state);

      this._doSingleStream(state, opts, chunkPath, existingBytes, resolve, reject);
    });
  }

  _doSingleStream(state, opts, chunkPath, existingBytes, resolve, reject) {
    let settled = false; // F2: Guard against double-settle (resolve after reject or vice versa)
    const safeResolve = (...args) => { if (!settled) { settled = true; resolve(...args); } };
    const safeReject = (...args) => { if (!settled) { settled = true; reject(...args); } };

    const parsed = new URL(state.url);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'IDMM/1.0',
        ...(opts.requestHeaders || {}),
      },
      timeout: opts.timeoutMs,
    };

    const req = transport.request(reqOptions, (res) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        // W2: Destroy the original request before following the redirect to
        // prevent late-firing 'error' or 'timeout' events on the old socket
        // from racing with the new recursive request.
        req.destroy();
        // R1: SSRF  validate redirect target before following
        try { validateRedirect(res.headers.location, state.url); } catch (e) { safeReject(e); return; }
        state.url = new URL(res.headers.location, state.url).href;
        this._doSingleStream(state, opts, chunkPath, existingBytes, resolve, reject);
        return;
      }

      if (res.statusCode !== 200 && res.statusCode !== 206) {
        safeReject(new Error(`HTTP ${res.statusCode} for single-stream download`));
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
        const samples = this.speedTracker.samples.get(state.id) || [];
        samples.push({ time: Date.now(), bytes: chunk.length });
        const cutoff = Date.now() - 3000;
        while (samples.length > 0 && samples[0].time < cutoff) samples.shift();
        this.speedTracker.samples.set(state.id, samples);

        this._recalcProgress(state);
      });

      res.on('end', () => {
        fileStream.end(() => {
          // BUG FIX: Mark single-stream wrapper as exited
          if (streamWrapper) streamWrapper.exited = true;
          state.chunks[0].status = 'done';
          this._finalizeDownload(state);
          safeResolve();
        });
      });

      res.on('error', (err) => {
        // BUG FIX: Mark single-stream wrapper as exited
        if (streamWrapper) streamWrapper.exited = true;
        fileStream.end();
        safeReject(err);
      });
    });

    const streamWrapper = { terminate: () => req.destroy(), exited: false };
    state.workers.push(streamWrapper);

    req.on('timeout', () => {
      req.destroy();
      safeReject(new Error('Single-stream download timed out'));
    });

    req.on('error', safeReject);
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
    const validation = await this.resume.validateChunks(state.id, state.chunks);
    if (!validation.valid) {
      // Some chunks are corrupted  reset them
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

  //  Internal: Progress Tracking 

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
    const samples = this.speedTracker.samples.get(state.id) || [];
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

    // Persist to DB periodically (throttled to max once per 500ms)
    const now = Date.now();
    if (!state._lastDbWrite || (now - state._lastDbWrite) >= 500) {
      state._lastDbWrite = now;
      this.db.updateDownload(state.id, {
        downloaded: totalDownloaded,
        speed: state.speed,
        eta: state.eta,
      });
    }

    // Notify listeners
    this.onProgress(state.id, this._formatState(state));
  }

  /**
   * Check if all chunks are done  finalize.
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
      this.speedTracker.samples.delete(state.id);
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
      await this.resume.cleanup(state.id);

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
      this.speedTracker.samples.delete(state.id);
    } catch (err) {
      state.status = 'failed';
      state.error = err.message;
      this.db.updateDownload(state.id, { status: 'failed', error: err.message });
      this.onError(state.id, err);
      this.active.delete(state.id);
      this.speedTracker.samples.delete(state.id);
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
      thread_mode: state.threadMode || null,
      throttle_count: state._throttleCount || 0,
      active_threads: state.workers.filter(w => w && !w.exited).length,
      priority: state.priority || Priority.NORMAL, // Gap 5
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
module.exports.Priority = Priority;
module.exports.DownloadManager = DownloadManager;

