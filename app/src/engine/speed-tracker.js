'use strict';

/**
 * SpeedTracker — Rolling speed samples (3s window) for download progress.
 * Extracted from DownloadManager (Fix #1: Decomposition).
 *
 * E-6: Uses findIndex+slice instead of Array.shift() for O(1) removal.
 */

class SpeedTracker {
  constructor() {
    /** @type {Map<string, Array<{time: number, bytes: number}>>} */
    this.samples = new Map();
  }

  /**
   * Add a speed sample for a download.
   * Called by DownloadManager._handleWorkerMessage and _doSingleStream.
   * @param {string} downloadId
   * @param {number} bytes — bytes received in this sample
   */
  addSample(downloadId, bytes) {
    let samples = this.samples.get(downloadId) || [];
    samples.push({ time: Date.now(), bytes });
    // E-6: Use findIndex+splice instead of shift() — avoids O(n) per-shift cost
    const cutoff = Date.now() - 3000;
    const firstOld = samples.findIndex(s => s.time >= cutoff);
    if (firstOld > 0) {
      samples.splice(0, firstOld);
    }
    this.samples.set(downloadId, samples);
  }

  /**
   * Get current speed (bytes/sec) for a download.
   * @param {string} downloadId
   * @returns {number}
   */
  getSpeed(downloadId) {
    const samples = this.samples.get(downloadId) || [];
    if (samples.length < 2) return 0;
    const totalBytes = samples.reduce((sum, s) => sum + s.bytes, 0);
    const timeSpan = (samples[samples.length - 1].time - samples[0].time) / 1000;
    return timeSpan > 0 ? totalBytes / timeSpan : 0;
  }

  /**
   * Clear samples for a download.
   * @param {string} downloadId
   */
  clear(downloadId) {
    this.samples.delete(downloadId);
  }
}

module.exports = SpeedTracker;
