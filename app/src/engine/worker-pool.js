'use strict';

const { Worker } = require('node:worker_threads');
const path = require('node:path');

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

  /**
   * Spawn a worker thread for a chunk download.
   * @param {Object} state — Download state
   * @param {Object} chunk — Chunk descriptor
   * @param {string} chunkPath — Path to .part file
   * @param {Object} opts — { requestHeaders, timeoutMs, retryCount, speedLimit }
   * @param {string} workerScript — Path to chunk-worker.js
   * @returns {Object} The spawned Worker instance
   */
  spawnWorker(state, chunk, chunkPath, opts, workerScript) {
    const worker = new Worker(workerScript, {
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
        speedLimit: opts.speedLimit || 0,
      },
    });

    const workerId = ++this._workerIdCounter;
    this.activeWorkers.set(workerId, {
      worker,
      downloadId: state.id,
      chunkIndex: chunk.index,
      startTime: Date.now(),
    });

    worker._workerId = workerId;
    state.workers.push(worker);
    return worker;
  }

  /**
   * Terminate all workers for a download.
   * @param {Object} state — Download state
   */
  cancelAll(state) {
    for (const worker of state.workers) {
      if (worker && !worker.exited) {
        worker.terminate();
      }
    }
    state.workers = [];
  }

  /**
   * Deregister a worker from the health map.
   * @param {Object} worker
   */
  deregister(worker) {
    if (worker._workerId) {
      this.activeWorkers.delete(worker._workerId);
    }
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
