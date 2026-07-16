/**
 * IDMAM API Client — shared between popup, background, and options.
 * Handles all communication with the IDMAM desktop app server.
 */

const IDMAM_API = {
  BASE_URL: 'http://127.0.0.1:9977',
  TIMEOUT: 5000,

  async _fetch(path, options = {}) {
    const baseUrl = IDMAM_API.BASE_URL;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), IDMAM_API.TIMEOUT);

      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('IDMAM server timeout');
      }
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        throw new Error('IDMAM server offline');
      }
      throw err;
    }
  },

  // ─── Downloads ─────────────────────────────────────────────────

  async startDownload({ url, filename, cookies, referrer, threads, save_to, headers }) {
    return IDMAM_API._fetch('/api/download', {
      method: 'POST',
      body: JSON.stringify({ url, filename, cookies, referrer, threads, save_to, headers }),
    });
  },

  async listDownloads(status) {
    const query = status ? `?status=${status}` : '';
    return IDMAM_API._fetch(`/api/downloads${query}`);
  },

  async getDownload(id) {
    return IDMAM_API._fetch(`/api/download/${id}`);
  },

  async pauseDownload(id) {
    return IDMAM_API._fetch(`/api/download/${id}/pause`, { method: 'POST' });
  },

  async resumeDownload(id) {
    return IDMAM_API._fetch(`/api/download/${id}/resume`, { method: 'POST' });
  },

  async cancelDownload(id) {
    return IDMAM_API._fetch(`/api/download/${id}/cancel`, { method: 'POST' });
  },

  async deleteDownload(id) {
    return IDMAM_API._fetch(`/api/download/${id}`, { method: 'DELETE' });
  },

  async getServerStats() {
    return IDMAM_API._fetch('/api/stats');
  },

  async openFolder(filePath) {
    return IDMAM_API._fetch('/api/open-folder', {
      method: 'POST',
      body: JSON.stringify({ path: filePath }),
    });
  },

  async healthCheck() {
    try {
      const baseUrl = IDMAM_API.BASE_URL;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  },

  // ─── Settings (Server SSOT + local cache) ──────────────────────

  /**
   * Key mapping: extension camelCase ↔ server snake_case.
   */
  _LOCAL_TO_SERVER: {
    maxThreads: 'default_threads',
    defaultSavePath: 'default_save_path',
    interceptMinSize: 'intercept_min_size',
    interceptVideo: 'intercept_video',
    interceptAudio: 'intercept_audio',
    interceptArchive: 'intercept_archive',
    interceptSoftware: 'intercept_software',
    interceptDocument: 'intercept_document',
  },

  _SERVER_TO_LOCAL: {
    default_threads: 'maxThreads',
    default_save_path: 'defaultSavePath',
    intercept_min_size: 'interceptMinSize',
    intercept_video: 'interceptVideo',
    intercept_audio: 'interceptAudio',
    intercept_archive: 'interceptArchive',
    intercept_software: 'interceptSoftware',
    intercept_document: 'interceptDocument',
  },

  /**
   * Map server snake_case settings to extension camelCase.
   */
  _mapServerToLocal(serverSettings) {
    const local = {};
    for (const [serverKey, localKey] of Object.entries(IDMAM_API._SERVER_TO_LOCAL)) {
      const val = serverSettings[serverKey];
      if (val !== undefined) {
        // Boolean-ish values from SQLite
        if (typeof val === 'string' && (val === 'true' || val === 'false')) {
          local[localKey] = val === 'true';
        } else {
          local[localKey] = val;
        }
      }
    }
    return local;
  },

  /**
   * Map extension camelCase settings to server snake_case.
   */
  _mapLocalToServer(localSettings) {
    const server = {};
    for (const [localKey, serverKey] of Object.entries(IDMAM_API._LOCAL_TO_SERVER)) {
      const val = localSettings[localKey];
      if (val !== undefined) {
        server[serverKey] = typeof val === 'boolean' ? String(val) : val;
      }
    }
    return server;
  },

  /**
   * Get settings: server-first with local cache fallback.
   * Extension-only settings (enabled) always from local.
   */
  async getSettings() {
    const defaults = IDMAM_API.defaultSettings();

    // Get extension-only settings from local
    const localOnly = await new Promise((resolve) => {
      chrome.storage.local.get('idmam_settings', (result) => {
        const s = result.idmam_settings || {};
        resolve({
          enabled: s.enabled !== undefined ? s.enabled : defaults.enabled,
        });
      });
    });

    try {
      // Fetch shared settings from server (SSOT)
      const serverSettings = await IDMAM_API._fetch('/api/settings');
      const mapped = IDMAM_API._mapServerToLocal(serverSettings);

      // Merge: server shared + local-only
      const merged = { ...defaults, ...mapped, ...localOnly };

      // Cache to local for offline fallback
      await IDMAM_API._cacheLocal(merged);

      return merged;
    } catch {
      // Server offline → use full local cache
      return new Promise((resolve) => {
        chrome.storage.local.get('idmam_settings', (result) => {
          resolve({ ...defaults, ...result.idmam_settings, ...localOnly });
        });
      });
    }
  },

  /**
   * Save settings: dual-write to server + local cache.
   */
  async saveSettings(settings) {
    // Always cache locally (offline resilience)
    await IDMAM_API._cacheLocal(settings);

    // Map to server keys and push
    const serverPayload = IDMAM_API._mapLocalToServer(settings);
    try {
      await IDMAM_API._fetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(serverPayload),
      });
    } catch {
      // Server offline — local cache saved, will sync on next save
      console.warn('[IDMAM] Server offline, settings cached locally only');
    }
  },

  /**
   * Cache settings to chrome.storage.local.
   */
  async _cacheLocal(settings) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ idmam_settings: settings }, resolve);
    });
  },

  /**
   * Default settings object.
   */
  defaultSettings() {
    return {
      enabled: true,
      maxThreads: 8,
      defaultSavePath: '',
      interceptMinSize: 5 * 1024 * 1024, // 5MB
      interceptVideo: true,
      interceptAudio: true,
      interceptArchive: true,
      interceptSoftware: true,
      interceptDocument: true,
    };
  },

  // ─── File Type Detection ───────────────────────────────────────

  INTERCEPT_EXTENSIONS: {
    video: ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.ts', '.mpg', '.mpeg'],
    audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus'],
    archive: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso', '.tgz'],
    software: ['.exe', '.msi', '.dmg', '.deb', '.rpm', '.apk', '.appx', '.appimage'],
    document: ['.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt', '.epub'],
  },

  /**
   * Determine if a download should be intercepted.
   * @param {string} filename
   * @param {number} fileSize - bytes, -1 if unknown
   * @param {Object} settings - from getSettings()
   * @returns {boolean}
   */
  shouldIntercept(filename, fileSize, settings) {
    if (!settings.enabled) return false;
    if (!filename) return false;

    const lower = filename.toLowerCase();

    // Size threshold — skip small files
    const minSize = settings.interceptMinSize || 0;
    if (fileSize > 0 && fileSize < minSize) return false;

    const categories = {
      video: settings.interceptVideo,
      audio: settings.interceptAudio,
      archive: settings.interceptArchive,
      software: settings.interceptSoftware,
      document: settings.interceptDocument,
    };

    for (const [category, enabled] of Object.entries(categories)) {
      if (!enabled) continue;
      const exts = IDMAM_API.INTERCEPT_EXTENSIONS[category];
      if (exts && exts.some(ext => lower.endsWith(ext))) return true;
    }

    return false;
  },

  // ─── Formatting Helpers ────────────────────────────────────────

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  },

  formatSpeed(bytesPerSec) {
    if (!bytesPerSec) return '0 B/s';
    return `${IDMAM_API.formatBytes(bytesPerSec)}/s`;
  },

  formatETA(seconds) {
    if (!seconds || seconds <= 0) return '--';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  },
};

if (typeof module !== 'undefined') module.exports = IDMAM_API;
