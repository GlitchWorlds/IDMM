'use strict';

/**
 * DownloadQueue — Priority-based download queue (HIGH > NORMAL > LOW, FIFO within same priority).
 * Extracted from DownloadManager (Fix #1: Decomposition).
 */

const Priority = Object.freeze({
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
});

class DownloadQueue {
  constructor() {
    /** @type {Array<{id: string, priority: number, addedAt: number}>} */
    this.queue = [];
  }

  /**
   * Add a download to the queue.
   * @param {string} id
   * @param {number} priority — One of Priority.HIGH/NORMAL/LOW
   */
  add(id, priority = Priority.NORMAL) {
    this.queue.push({ id, priority, addedAt: Date.now() });
  }

  /**
   * Remove a download from the queue.
   * @param {string} id
   */
  remove(id) {
    const idx = this.queue.findIndex(e => e.id === id);
    if (idx !== -1) this.queue.splice(idx, 1);
  }

  /**
   * Update priority for a queued download.
   * @param {string} id
   * @param {number} priority
   */
  setPriority(id, priority) {
    const entry = this.queue.find(e => e.id === id);
    if (entry) entry.priority = priority;
  }

  /**
   * Get queue sorted by priority (HIGH first), then FIFO.
   * @returns {Array<{id: string, priority: number, addedAt: number}>}
   */
  getSorted() {
    return [...this.queue].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.addedAt - b.addedAt;
    });
  }

  /**
   * Pop the highest-priority entry.
   * @returns {{id: string, priority: number, addedAt: number}|null}
   */
  next() {
    const sorted = this.getSorted();
    if (sorted.length === 0) return null;
    const entry = sorted[0];
    this.remove(entry.id);
    return entry;
  }

  /**
   * Get queue length.
   * @returns {number}
   */
  get length() {
    return this.queue.length;
  }
}

module.exports = DownloadQueue;
module.exports.Priority = Priority;
