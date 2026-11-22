'use strict';

/**
 * WorkerPool — Global worker concurrency management with health tracking.
 * Extracted from DownloadManager (Fix #1: Decomposition).
 *
 * Uses a counting semaphore to cap total concurrent workers across all downloads.
 *
 * E-3: Persistent worker reuse — workers are kept alive for reuse across downloads
 *      instead of being created/destroyed on every chunk.
 */

class WorkerPool {
  /**
   * @param {number} maxWorkers — Hard cap on concurrent workers (default 128)
   */
  constructor(maxWorkers = 128) {
    this.max = maxWorkers;
    this.current = 0;
    this.queue = [];
    /** @type {Map<number, {worker: Object, downloadId: string, chunkIndex: number, startTime: number}>} */
    this.activeWorkers = new Map();
    this._workerIdCounter = 0;

    // E-3: Pool of idle workers available for reuse
    /** @type {Array<{worker: Object, id: number}>} */
    this._idlePool = [];
    this._maxIdleWorkers = 16; // Keep up to 16 idle workers for reuse
  }

  /**
   * Acquire a worker slot. Returns immediately if under cap, otherwise waits.
   * @returns {Promise<void>}
   */
  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise(resolve => this.queue.push(resolve));
  }

  /**
   * Release a worker slot. Guards against double-release.
   * E-3: Optionally return worker to idle pool for reuse.
   * @param {Object} worker — Worker instance (tracked via _semaphoreReleased flag)
   * @param {boolean} [reuse=false] — If true, return worker to idle pool
   */
  release(worker, reuse = false) {
    if (worker && worker._semaphoreReleased) return;
    if (worker) worker._semaphoreReleased = true;

    // E-3: Return worker to idle pool if reuse requested and pool not full
    if (reuse && worker && !worker.exited && this._idlePool.length < this._maxIdleWorkers) {
      const id = ++this._workerIdCounter;
      this._idlePool.push({ worker, id });
    }

    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      this.queue.shift()();
    }
  }

  /**
   * E-3: Get an idle worker from the pool, if available.
   * @returns {Object|null}
   */
  getIdleWorker() {
    if (this._idlePool.length === 0) return null;
    const entry = this._idlePool.shift();
    return entry.worker;
  }

  /**
   * E-3: Terminate all idle workers (e.g., on shutdown).
   */
  terminateIdleWorkers() {
    for (const { worker } of this._idlePool) {
      try { worker.terminate(); } catch { /* best effort */ }
    }
    this._idlePool = [];
  }

  // spawnWorker, cancelAll, deregister removed 2025-01 (dead code).
  // DownloadManager handles worker spawning/termination directly via
  // _spawnWorkerAsync and _cancelAllWorkers. WorkerPool now only tracks
  // health and active count.

  /**
   * Get health snapshot of all active workers.
   * @returns {Array<Object>}
   */
  getHealth() {
    const health = [];
    const now = Date.now();
    for (const [id, info] of this.activeWorkers) {
      health.push({
        workerId: id,
        downloadId: info.downloadId,
        chunkIndex: info.chunkIndex,
        uptimeMs: now - info.startTime,
        alive: true,
      });
    }
    return health;
  }

  /**
   * Get count of active workers.
   * @returns {number}
   */
  getActiveCount() {
    return this.activeWorkers.size;
  }

  /**
   * Get count of idle workers available for reuse.
   * @returns {number}
   */
  getIdleCount() {
    return this._idlePool.length;
  }
}

module.exports = WorkerPool;
