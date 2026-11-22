'use strict';

const { clipboard } = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');

/**
 * ClipboardMonitor — polls the system clipboard for download URLs.
 *
 * Features:
 *  - Polls clipboard every 2 seconds
 *  - Detects http/https URLs
 *  - Skips URLs already in the downloads list
 *  - 10-second cooldown between same URL detections
 *  - Emits 'url-detected' event with the URL
 *  - Configurable enable/disable via settings
 *
 * @class ClipboardMonitor
 * @extends {EventEmitter}
 */
class ClipboardMonitor extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} [options.downloader] - DownloadManager instance (to check active URLs)
   * @param {number} [options.pollIntervalMs=2000] - Poll interval in milliseconds
   * @param {number} [options.cooldownMs=10000] - Cooldown between same URL detections
   * @param {boolean} [options.enabled=true] - Initial enabled state
   */
  constructor({
    downloader = null,
    pollIntervalMs = 2000,
    cooldownMs = 10000,
    enabled = true,
  } = {}) {
    super();
    this.downloader = downloader;
    this.pollIntervalMs = pollIntervalMs;
    this.cooldownMs = cooldownMs;
    this._enabled = enabled;
    this._running = false;
    this._timer = null;
    this._lastClipboardText = '';
    this._detectionHistory = new Map(); // url → lastDetectedTimestamp
  }

  /**
   * Check if clipboard monitoring is enabled.
   * @returns {boolean}
   */
  isEnabled() {
    return this._enabled;
  }

  /**
   * Enable clipboard monitoring.
   */
  enable() {
    this._enabled = true;
    if (!this._running) {
      this.start();
    }
  }

  /**
   * Disable clipboard monitoring.
   */
  disable() {
    this._enabled = false;
    this.stop();
  }

  /**
   * Start polling the clipboard.
   * Does nothing if already running or if disabled.
   */
  start() {
    if (this._running) return;
    if (!this._enabled) return;

    this._running = true;
    this._poll();
  }

  /**
   * Stop polling the clipboard.
   */
  stop() {
    this._running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /**
   * Poll the clipboard once and schedule the next poll.
   * @private
   */
  _poll() {
    if (!this._running || !this._enabled) {
      this._running = false;
      return;
    }

    try {
      const text = clipboard.readText();

      // Skip if clipboard hasn't changed
      if (text && text !== this._lastClipboardText) {
        this._lastClipboardText = text;
        this._processClipboardText(text);
      }
    } catch (err) {
      console.error('[ClipboardMonitor] Poll error:', err.message);
    }

    // Schedule next poll
    this._timer = setTimeout(() => {
      this._poll();
    }, this.pollIntervalMs);

    // Don't keep the process alive just for clipboard polling
    if (this._timer.unref) this._timer.unref();
  }

  /**
   * Process clipboard text to extract and validate URLs.
   * @param {string} text
   * @private
   */
  _processClipboardText(text) {
    // Extract URLs from clipboard text
    const urls = this._extractUrls(text);

    for (const url of urls) {
      // Skip if URL is already being downloaded
      if (this._isUrlActive(url)) {
        continue;
      }

      // Check cooldown
      const lastDetected = this._detectionHistory.get(url);
      const now = Date.now();
      if (lastDetected && (now - lastDetected) < this.cooldownMs) {
        continue;
      }

      // Record detection
      this._detectionHistory.set(url, now);

      // Emit event
      this.emit('url-detected', { url, timestamp: now });
    }

    // Clean up old detection history entries (older than cooldown)
    this._cleanupDetectionHistory();
  }

  /**
   * Extract valid http/https URLs from text.
   * Handles:
   *  - Plain URL strings
   *  - URLs embedded in text
   *  - Multiple URLs
   * @param {string} text
   * @returns {string[]} Array of unique URLs
   * @private
   */
  _extractUrls(text) {
    if (!text || typeof text !== 'string') return [];

    const trimmed = text.trim();

    // Fast path: the entire clipboard is a single URL
    try {
      const parsed = new URL(trimmed);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        return [parsed.href];
      }
    } catch {
      // Not a single URL — try regex extraction
    }

    // Regex extraction for URLs embedded in text
    const urlRegex = /https?:\/\/[^\s<>"'{}|\\^`[\]]+/gi;
    const matches = trimmed.match(urlRegex);

    if (!matches) return [];

    // Deduplicate and validate
    const seen = new Set();
    const valid = [];

    for (const match of matches) {
      const cleaned = match.replace(/[.,;!?)]+$/, ''); // Strip trailing punctuation
      try {
        const parsed = new URL(cleaned);
        if (['http:', 'https:'].includes(parsed.protocol)) {
          const href = parsed.href;
          if (!seen.has(href)) {
            seen.add(href);
            valid.push(href);
          }
        }
      } catch {
        // Invalid URL, skip
      }
    }

    return valid;
  }

  /**
   * Check if a URL is already being actively downloaded.
   * @param {string} url
   * @returns {boolean}
   * @private
   */
  _isUrlActive(url) {
    if (!this.downloader) return false;

    // Check active downloads
    const activeStates = this.downloader.getActiveStates();
    return activeStates.some(state => state.url === url);
  }

  /**
   * Remove detection history entries older than the cooldown period.
   * @private
   */
  _cleanupDetectionHistory() {
    const now = Date.now();
    const threshold = now - (this.cooldownMs * 2); // Keep 2x cooldown for safety

    for (const [url, timestamp] of this._detectionHistory) {
      if (timestamp < threshold) {
        this._detectionHistory.delete(url);
      }
    }
  }

  /**
   * Update settings (e.g., from user preferences).
   * @param {Object} settings
   * @param {boolean} [settings.enabled]
   * @param {number} [settings.pollIntervalMs]
   * @param {number} [settings.cooldownMs]
   */
  updateSettings(settings) {
    if (settings.enabled !== undefined) {
      this._enabled = settings.enabled;
      if (settings.enabled && !this._running) {
        this.start();
      } else if (!settings.enabled && this._running) {
        this.stop();
      }
    }

    if (settings.pollIntervalMs !== undefined) {
      this.pollIntervalMs = settings.pollIntervalMs;
    }

    if (settings.cooldownMs !== undefined) {
      this.cooldownMs = settings.cooldownMs;
    }
  }

  /**
   * Clean up and stop monitoring.
   */
  destroy() {
    this.stop();
    this._detectionHistory.clear();
    this._lastClipboardText = '';
    this.removeAllListeners();
  }
}

module.exports = ClipboardMonitor;
