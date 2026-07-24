'use strict';

// TODO: implement persistent worker reuse (E-3)

/**
 * WorkerPool — Global worker concurrency management with health tracking.
 * Extracted from DownloadManager (Fix #1: Decomposition).
 *
 * Uses a counting semaphore to cap total concurrent workers across all downloads.
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
   * @param {Object} worker — Worker instance (tracked via _semaphoreReleased flag)
   */
  release(worker) {
    if (worker && worker._semaphoreReleased) return;
    if (worker) worker._semaphoreReleased = true;
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      this.queue.shift()();
    }
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
}

module.exports = WorkerPool;
