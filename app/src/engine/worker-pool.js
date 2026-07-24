'use strict';

/**
 * WorkerPool — Global worker concurrency management with health tracking
 * and persistent worker reuse (E-3).
 *
 * Uses a counting semaphore to cap total concurrent workers across all downloads.
 * Idle workers are kept in a pool and reused for same-path worker scripts.
 */

const { Worker } = require('node:worker_threads');

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
    /** @type {Map<string, Array<Worker>>} — idle workers keyed by workerPath */
    this._idlePool = new Map();
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

  /**
   * Acquire a reusable worker for the given worker script path.
   * If an idle worker exists for this path, reuse it. Otherwise spawn new.
   * @param {string} workerPath — absolute path to worker script
   * @param {Object} workerData — data to pass to worker
   * @returns {Worker}
   */
  acquireWorker(workerPath, workerData) {
    const idle = this._idlePool.get(workerPath);
    if (idle && idle.length > 0) {
      const worker = idle.pop();
      // Post new job data to reused worker
      worker.postMessage({ type: 'new-job', data: workerData });
      return worker;
    }
    // No idle worker — spawn new
    return new Worker(workerPath, { workerData });
  }

  /**
   * Return a worker to the idle pool for reuse instead of terminating.
   * @param {Worker} worker
   * @param {string} workerPath — the script path the worker was created with
   */
  releaseWorker(worker, workerPath) {
    if (!worker) return;
    // Remove from active tracking
    for (const [id, info] of this.activeWorkers) {
      if (info.worker === worker) {
        this.activeWorkers.delete(id);
        break;
      }
    }
    // Return to idle pool
    if (!this._idlePool.has(workerPath)) {
      this._idlePool.set(workerPath, []);
    }
    this._idlePool.get(workerPath).push(worker);
  }

  /**
   * Terminate all idle workers (e.g., on app shutdown).
   */
  terminateAllIdle() {
    for (const [, workers] of this._idlePool) {
      for (const w of workers) {
        try { w.terminate(); } catch {}
      }
    }
    this._idlePool.clear();
  }

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
