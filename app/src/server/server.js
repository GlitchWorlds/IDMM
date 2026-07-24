'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const path = require('node:path');

/**
 * IDMM API Server.
 *
 * Express REST API on localhost:9977 with WebSocket for real-time progress.
 * Security: 127.0.0.1 only, CORS whitelist, rate limiting.
 */

const PORT = 9977;
const HOST = '127.0.0.1';
const WS_BROADCAST_INTERVAL = 500; // ms
const DEBUG = process.env.IDMM_DEBUG === '1' || process.env.DEBUG === 'idmm';
const debugLog = DEBUG ? console.log.bind(console) : () => {};

/**
 * Sanitize error messages for external responses.
 * Known safe errors pass through; unknown errors get generic message.
 * Prevents leaking internal file paths or system details.
 */
const SAFE_ERROR_PATTERNS = [
  /^Download not found$/i,
  /^Download already (active|paused)$/i,
  /^Download is not (active|paused)$/i,
  /^URL is already being downloaded$/i,
  /^Invalid URL$/i,
  /^No file provided$/i,
  /^Invalid setting/i,
  /^save_to path not allowed$/i,
  /^Cannot delete active download$/i,
  /^Maximum concurrent downloads/i,
];
function sanitizeError(err) {
  const msg = err.message || 'Unknown error';
  if (SAFE_ERROR_PATTERNS.some(re => re.test(msg))) return msg;
  console.error('[INTERNAL]', msg);
  return 'Internal server error';
}

class IDMMServer {
  /**
   * @param {Object} options
   * @param {Object} options.db - IDMMDatabase instance
   * @param {Object} options.downloader - DownloadManager instance
   */
  constructor({ db, downloader }) {
    this.db = db;
    this.downloader = downloader;
    this.app = express();
    this.server = null;
    this.wss = null;
    this.wsClients = new Set();
    this.extensionClients = new Map(); // Gap 3: Track extension WS clients with metadata
    this.broadcastTimer = null;
    this._heartbeatTimer = null;
    this.activeUrls = new Set(); // F10: Track URLs currently being downloaded
    this.downloadUrlMap = new Map(); // F10: downloadId  url for cleanup
    this._rateLimitCleanupTimer = null;

    this._setupMiddleware();
    this._setupRoutes();
  }

  //  Middleware 

  _setupMiddleware() {
    // Security headers
    this.app.use(helmet({
      contentSecurityPolicy: false, // Local API, no CSP needed
    }));

    // CORS: whitelist localhost + chrome extensions
    this.app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (curl, Postman, same-origin)
        if (!origin) return callback(null, true);

        if (this._isAllowedOrigin(origin)) {
          return callback(null, true);
        }

        callback(new Error('CORS not allowed'));
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-IDMM-Token'],
    }));

    // JSON body parsing
    this.app.use(express.json({ limit: '1mb' }));

    // Simple in-memory rate limiter: 100 req/min per IP
    const rateLimitMap = new Map();
    const RATE_LIMIT = 100;
    const RATE_WINDOW = 60000; // 1 minute

    this.app.use((req, res, next) => {
      const ip = req.ip;
      const now = Date.now();

      if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return next();
      }

      const entry = rateLimitMap.get(ip);

      if (now - entry.windowStart > RATE_WINDOW) {
        entry.count = 1;
        entry.windowStart = now;
        return next();
      }

      entry.count++;
      if (entry.count > RATE_LIMIT) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retry_after: Math.ceil((entry.windowStart + RATE_WINDOW - now) / 1000),
        });
      }

      next();
    });

    // F9: TTL-based eviction  clean up stale rate limit entries every 5 minutes
    this._rateLimitCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [ip, entry] of rateLimitMap) {
        if (now - entry.windowStart > RATE_WINDOW) {
          rateLimitMap.delete(ip);
        }
      }
    }, 5 * 60 * 1000);
  }

  //  Routes 

  _setupRoutes() {
    // Health check
    this.app.get('/api/health', (req, res) => {
      let serverVersion = '1.2.0';
      try {
        const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
        serverVersion = pkg.version || serverVersion;
      } catch { /* use fallback */ }

      // Gap 3: Include connected clients count in health response
      const connectedClients = this.extensionClients.size;

      res.json({
        status: 'ok',
        version: serverVersion,
        uptime: process.uptime(),
        connected_clients: connectedClients,
      });
    });

    // POST /api/download  Start a new download
    this.app.post('/api/download', async (req, res) => {
      const url = req.body && req.body.url; // F10: Extract URL early for catch block
      try {
        const { filename, save_to, threads, thread_mode, cookies, referrer, headers, checksum } = req.body;

        if (!url) {
          return res.status(400).json({ error: 'URL is required' });
        }

        // Validate URL
        let parsedUrl;
        try {
          parsedUrl = new URL(url);
        } catch {
          return res.status(400).json({ error: 'Invalid URL' });
        }

        // SSRF protection  block localhost/private IPs (skip in test mode)
        const isTestMode = process.env.IDMM_TEST === '1' || process.env.NODE_ENV === 'test';
        if (!isTestMode) {
          const hostname = parsedUrl.hostname.toLowerCase();
          const BLOCKED_HOSTS = ['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]'];
          if (BLOCKED_HOSTS.includes(hostname) || hostname.startsWith('192.168.') || hostname.startsWith('10.') || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) {
            return res.status(400).json({ error: 'Cannot download from localhost or private network' });
          }

          // DNS resolution check  catch hosts that resolve to private/loopback IPs
          const { validateDnsResolution } = require('../utils/ssrf');
          try {
            await validateDnsResolution(hostname);
          } catch {
            return res.status(400).json({ error: 'Cannot download from localhost or private network' });
          }
        }

        // F1: Path traversal protection  validate save_to against allowed roots
        {
          const defaultSavePathResult = this.db.getSetting('default_save_path');
          const defaultSavePath = (defaultSavePathResult.ok && defaultSavePathResult.data) ? defaultSavePathResult.data : '';
          const allowedRoots = new Set();
          if (defaultSavePath) allowedRoots.add(path.resolve(defaultSavePath));
          try {
            allowedRoots.add(path.resolve(require('node:os').homedir(), 'Downloads'));
          } catch { /* OS module unavailable  rely on default_save_path only */ }

          if (allowedRoots.size > 0) {
            const resolvedSaveTo = path.resolve(save_to || defaultSavePath);
            const isAllowed = [...allowedRoots].some(
              root => resolvedSaveTo === root || resolvedSaveTo.startsWith(root + path.sep)
            );
            if (!isAllowed) {
              return res.status(403).json({ error: 'Save path not allowed' });
            }
          }
        }

        // F10: Duplicate download URL check
        if (this.activeUrls.has(url)) {
          return res.status(409).json({ error: 'URL is already being downloaded' });
        }

        // Check concurrent download limit
        const maxSetting = this.db.getSetting('max_concurrent_downloads');
        const maxConcurrent = (maxSetting.ok && maxSetting.data) ? parseInt(maxSetting.data, 10) : 5;
        if (this.downloader.getActiveCount() >= maxConcurrent) {
          return res.status(429).json({
            error: `Maximum concurrent downloads reached (${maxConcurrent})`,
          });
        }

        // F10: Track active URL BEFORE startDownload to prevent race condition
        this.activeUrls.add(url);

        const result = await this.downloader.startDownload({
          url,
          filename,
          saveTo: save_to,
          threads,
          threadMode: thread_mode,
          cookies,
          referrer,
          headers,
          checksum,
        });

        this.downloadUrlMap.set(result.id, url);

        // Broadcast new download to desktop UI
        this.broadcast({ type: 'added', id: result.id, data: result });

        res.status(201).json(result);
      } catch (err) {
        // F10: Remove URL from tracking on failure
        this.activeUrls.delete(url);
        console.error('Download start error:', err.message);
        res.status(500).json({ error: sanitizeError(err) });
      }
    });

    // GET /api/downloads  List all downloads
    this.app.get('/api/downloads', (req, res) => {
      try {
        const { status } = req.query;
        const result = this.db.listDownloads(status);
        if (!result.ok) {
          return res.status(500).json({ error: result.error || 'Failed to list downloads' });
        }
        const downloads = result.data || [];

        // Enrich active downloads with real-time state
        const enriched = downloads.map(d => {
          const activeState = this.downloader.getDownloadState(d.id);
          if (activeState) return activeState;
          return {
            id: d.id,
            url: d.url,
            filename: d.filename,
            save_to: d.save_to,
            status: d.status,
            total_size: d.total_size,
            downloaded: d.downloaded,
            progress: d.total_size > 0
              ? Math.round((d.downloaded / d.total_size) * 10000) / 100
              : 0,
            speed: d.speed || 0,
            eta: d.eta || 0,
            threads: d.threads,
            mime_type: d.mime_type,
            category: d.category,
            created_at: d.created_at,
            completed_at: d.completed_at,
            error: d.error,
          };
        });

        res.json(enriched);
      } catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
      }
    });

    // GET /api/download/:id  Get download status
    this.app.get('/api/download/:id', (req, res) => {
      try {
        const state = this.downloader.getDownloadState(req.params.id);
        if (!state) {
          return res.status(404).json({ error: 'Download not found' });
        }
        res.json(state);
      } catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
      }
    });

    // POST /api/download/:id/pause  Pause download
    this.app.post('/api/download/:id/pause', (req, res) => {
      try {
        const result = this.downloader.pauseDownload(req.params.id);
        this.broadcast({ type: 'status', id: req.params.id, status: 'paused' });
        res.json(result);
      } catch (err) {
        const status = err.message.includes('not found') ? 404
          : err.message.includes('not active') ? 400
          : err.message.includes('already') ? 409 : 500;
        res.status(status).json({ error: sanitizeError(err) });
      }
    });

    // POST /api/download/:id/resume  Resume download
    this.app.post('/api/download/:id/resume', async (req, res) => {
      try {
        const result = await this.downloader.resumeDownload(req.params.id);
        this.broadcast({ type: 'status', id: req.params.id, status: 'downloading' });
        res.json(result);
      } catch (err) {
        const status = err.message.includes('not found') ? 404 : 500;
        res.status(status).json({ error: sanitizeError(err) });
      }
    });

    // POST /api/download/:id/cancel  Cancel download
    this.app.post('/api/download/:id/cancel', (req, res) => {
      try {
        const result = this.downloader.cancelDownload(req.params.id);
        this._removeActiveUrl(req.params.id);
        this.broadcast({ type: 'status', id: req.params.id, status: 'failed' });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
      }
    });

    // DELETE /api/download/:id  Delete download (and optionally file)
    this.app.delete('/api/download/:id', (req, res) => {
      try {
        const deleteFile = req.query.delete_file === 'true';
        const result = this.downloader.deleteDownload(req.params.id, deleteFile);
        this._removeActiveUrl(req.params.id);
        this.broadcast({ type: 'removed', id: req.params.id });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
      }
    });

    // GET /api/settings  Get all settings
    this.app.get('/api/settings', (req, res) => {
      try {
        const settings = this.db.getAllSettings();
        if (!settings.ok) {
          return res.status(500).json({ error: settings.error || 'Failed to load settings' });
        }
        res.json(settings);
      } catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
      }
    });

    // PUT /api/settings  Update settings
    this.app.put('/api/settings', (req, res) => {
      try {
        const updates = req.body;
        if (!updates || typeof updates !== 'object') {
          return res.status(400).json({ error: 'Settings object required' });
        }

        // Whitelist allowed settings keys
        const allowedKeys = [
          'default_threads', 'default_thread_mode', 'max_concurrent_downloads', 'max_threads_per_download',
          'default_save_path', 'temp_dir', 'retry_count', 'timeout_ms',
          'speed_limit_global', 'auto_resume', 'auto_categorize', 'intercept_all',
          // Extension sync: intercept rules
          'intercept_min_size', 'intercept_video', 'intercept_audio',
          'intercept_archive', 'intercept_software', 'intercept_document',
        ];

        const filtered = {};
        for (const [key, value] of Object.entries(updates)) {
          if (allowedKeys.includes(key)) {
            filtered[key] = value;
          }
        }

        this.db.updateSettings(filtered);

        // Update downloader settings
        Object.assign(this.downloader.settings, filtered);

        // Broadcast settings change to all connected clients (extension sync)
        if (Object.keys(filtered).length > 0) {
          const broadcastResult = this.db.getAllSettings();
          this.broadcast({
            type: 'SETTINGS_CHANGED',
            settings: broadcastResult.ok ? broadcastResult.data : {},
          });
        }

        res.json({ updated: Object.keys(filtered) });
      } catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
      }
    });

    // POST /api/open-folder  Open file location in system file explorer
    this.app.post('/api/open-folder', (req, res) => {
      try {
        const { path: filePath } = req.body;
        if (!filePath) {
          return res.status(400).json({ error: 'path is required' });
        }

        const { execFile } = require('node:child_process');
        const fs = require('node:fs');

        // Determine if path is a file or directory
        let isDir = false;
        try { isDir = fs.statSync(filePath).isDirectory(); } catch { /* assume file */ }

        const platform = process.platform;
        if (platform === 'win32') {
          if (isDir) {
            execFile('explorer', [filePath]);
          } else {
            execFile('explorer', ['/select,', filePath]);
          }
        } else if (platform === 'darwin') {
          execFile('open', isDir ? [filePath] : ['-R', filePath]);
        } else {
          const dir = isDir ? filePath : require('node:path').dirname(filePath);
          execFile('xdg-open', [dir]);
        }

        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to open folder' });
      }
    });

    // POST /api/extension/install  Install browser extension
    this.app.post('/api/extension/install', async (req, res) => {
      try {
        const { browser } = req.body;
        const validBrowsers = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi'];
        if (!browser || !validBrowsers.includes(browser)) {
          return res.status(400).json({ ok: false, error: 'Invalid browser. Supported: chrome, edge, firefox, brave, opera, vivaldi' });
        }

        const { execFile, exec } = require('node:child_process');
        const fs = require('node:fs');
        const os = require('node:os');
        const path = require('node:path');

        const extensionDir = path.join(__dirname, '..', '..', 'extension');
        const manifestPath = path.join(extensionDir, 'manifest.json');

        if (!fs.existsSync(manifestPath)) {
          return res.status(404).json({ ok: false, error: 'Extension not found on server.' });
        }

        const platform = process.platform;

        if (platform === 'win32') {
          // Chrome/Edge: use registry policy for persistent install
          if (browser === 'chrome' || browser === 'edge') {
            const regKey = browser === 'chrome'
              ? 'HKLM\\Software\\Policies\\Google\\Chrome\\ExtensionInstallForcelist'
              : 'HKLM\\Software\\Policies\\Microsoft\\Edge\\ExtensionInstallForcelist';
            const extensionId = require(manifestPath).id || 'idmm-extension';
            const updateUrl = 'https://clients2.google.com/service/update2/crx';

            return new Promise((resolve) => {
              exec(`reg add "${regKey}" /v 1 /t REG_SZ /d "${extensionId};${updateUrl}" /f`, (err) => {
                if (err) {
                  resolve(res.json({ ok: false, error: `Failed to install ${browser} extension via registry: ${err.message}` }));
                } else {
                  resolve(res.json({ ok: true, message: `${browser} extension installed via registry policy. Restart ${browser} to apply.` }));
                }
              });
            });
          }

          // Firefox: copy .xpi to profile directories
          if (browser === 'firefox') {
            const profilesRoot = path.join(os.homedir(), 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles');
            if (!fs.existsSync(profilesRoot)) {
              return res.json({ ok: false, error: 'Firefox profiles directory not found. Is Firefox installed?' });
            }
            const profiles = fs.readdirSync(profilesRoot).filter(p =>
              fs.statSync(path.join(profilesRoot, p)).isDirectory()
            );
            if (profiles.length === 0) {
              return res.json({ ok: false, error: 'No Firefox profiles found.' });
            }
            const xpiPath = path.join(extensionDir, 'idmm.xpi');
            if (!fs.existsSync(xpiPath)) {
              return res.json({ ok: false, error: 'Extension .xpi file not found.' });
            }
            for (const profile of profiles) {
              const dest = path.join(profilesRoot, profile, 'extensions');
              if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
              fs.copyFileSync(xpiPath, path.join(dest, 'idmm@idmm.xpi'));
            }
            return res.json({ ok: true, message: `Firefox extension installed to ${profiles.length} profile(s). Restart Firefox to apply.` });
          }

          // Brave/Opera/Vivaldi: Chromium-based, load unpacked
          const browserPaths = {
            brave: path.join(os.homedir(), 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data'),
            opera: path.join(os.homedir(), 'AppData', 'Local', 'Opera Software', 'Opera Stable'),
            vivaldi: path.join(os.homedir(), 'AppData', 'Local', 'Vivaldi', 'User Data'),
          };

          const userDataPath = browserPaths[browser];
          if (!userDataPath || !fs.existsSync(userDataPath)) {
            return res.json({ ok: false, error: `${browser} installation not found. Is it installed?` });
          }

          // Create a shortcut with --load-extension flag
          const shortcutPath = path.join(os.homedir(), 'Desktop', `IDMM-${browser}.lnk`);
          const browserExecutables = {
            brave: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
            opera: 'Opera Software\\Opera Stable\\opera.exe',
            vivaldi: 'Vivaldi\\Application\\vivaldi.exe',
          };

          // For Chromium-based browsers, we can't force-load from server side safely.
          // Return instructions instead.
          return res.json({
            ok: true,
            message: `To install on ${browser}: Open ${browser}, go to chrome://extensions, enable Developer Mode, click "Load unpacked" and select: ${extensionDir}`,
          });
        }

        // Linux/macOS: return instructions
        return res.json({
          ok: true,
          message: `To install on ${browser}: Open browser extension settings and load unpacked from: ${extensionDir}`,
        });
      } catch (err) {
        console.error('Extension install error:', err.message);
        res.status(500).json({ ok: false, error: 'Failed to install extension: ' + err.message });
      }
    });

    // GET /api/stats  Download statistics
    this.app.get('/api/stats', (req, res) => {
      try {
        const stats = this.db.getStats();
        if (!stats.ok) {
          return res.status(500).json({ error: stats.error || 'Failed to load stats' });
        }
        res.json(stats.data);
      } catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
      }
    });
  }

  //  WebSocket 

  _setupWebSocket() {
    // F6: Set maxPayload to prevent memory abuse from huge messages
    this.wss = new WebSocketServer({ server: this.server, path: '/ws', maxPayload: 64 * 1024 });

    // Gap 3: Heartbeat every 15s, drop clients unresponsive for 10s+ (no pong response)
    this._heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [ws, info] of this.extensionClients) {
        // If we marked isAlive=false on previous ping and still no pong, drop
        if (ws.isAlive === false) {
          this.extensionClients.delete(ws);
          this.wsClients.delete(ws);
          ws.terminate();
          debugLog(`[WS] Client dropped (no pong) (total: ${this.extensionClients.size})`);
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }

      // Also clean stale entries from wsClients Set that may not be in extensionClients
      for (const ws of this.wsClients) {
        if (!this.extensionClients.has(ws)) {
          if (ws.isAlive === false) {
            this.wsClients.delete(ws);
            ws.terminate();
            continue;
          }
          ws.isAlive = false;
          ws.ping();
        }
      }
    }, 15000);

    this.wss.on('connection', (ws, req) => {
      // Verify origin
      const origin = req.headers.origin;
      if (origin && !this._isAllowedOrigin(origin)) {
        ws.close(4003, 'Origin not allowed');
        return;
      }

      // Gap 3: Register with timestamp in extensionClients Map
      const clientInfo = { connectedAt: Date.now(), lastActivity: Date.now() };
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
        clientInfo.lastActivity = Date.now();
      });

      this.wsClients.add(ws);
      this.extensionClients.set(ws, clientInfo);
      debugLog(`[WS] Client connected (total: ${this.extensionClients.size})`);

      ws.on('close', () => {
        this.extensionClients.delete(ws);
        this.wsClients.delete(ws);
        debugLog(`[WS] Client disconnected (total: ${this.extensionClients.size})`);
      });

      ws.on('error', () => {
        this.extensionClients.delete(ws);
        this.wsClients.delete(ws);
      });

      // Send initial state
      const states = this.downloader.getActiveStates();
      ws.send(JSON.stringify({
        type: 'init',
        downloads: states,
      }));
    });

    // Broadcast progress every 500ms
    this.broadcastTimer = setInterval(() => {
      if (this.wsClients.size === 0) return;

      const states = this.downloader.getActiveStates();
      if (states.length === 0) return;

      // Send individual progress per download (matches desktop UI format)
      for (const state of states) {
        const message = JSON.stringify({
          type: 'progress',
          id: state.id,
          data: state,
        });

        for (const client of this.wsClients) {
          if (client.readyState === 1) {
            try {
              client.send(message);
            } catch {
              this.wsClients.delete(client);
            }
          }
        }
      }
    }, WS_BROADCAST_INTERVAL);
  }

  /**
   * Remove a download's URL from the active tracking set.
   * @param {string} downloadId
   */
  _removeActiveUrl(downloadId) {
    const url = this.downloadUrlMap.get(downloadId);
    if (url) {
      this.activeUrls.delete(url);
      this.downloadUrlMap.delete(downloadId);
    }
  }

  _isAllowedOrigin(origin) {
    return (
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:') ||
      origin.startsWith('https://localhost:') ||
      origin.startsWith('chrome-extension://') ||
      origin.startsWith('moz-extension://')
    );
  }

  /**
   * Broadcast a custom event to all WebSocket clients.
   * @param {Object} data
   */
  broadcast(data) {
    const message = JSON.stringify(data);
    for (const client of this.wsClients) {
      if (client.readyState === 1) {
        try {
          client.send(message);
        } catch {
          this.wsClients.delete(client);
        }
      }
    }
  }

  //  Lifecycle 

  /**
   * Start the server.
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.app);

      this._setupWebSocket();

      // W7: Overwriting onComplete/onError is safe here  the DownloadManager
      // constructor initialises both to no-ops (() => {}), so no prior handler
      // is lost.  The replacements extend the original contract: they add
      // WebSocket broadcast + active-URL cleanup on top of the base no-op,
      // which is exactly what the server layer needs.
      this.downloader.onComplete = (downloadId, result) => {
        this._removeActiveUrl(downloadId);
        this.broadcast({
          type: 'completed',
          download_id: downloadId,
          ...result,
        });
      };

      this.downloader.onError = (downloadId, error) => {
        this._removeActiveUrl(downloadId);
        this.broadcast({
          type: 'error',
          download_id: downloadId,
          error: sanitizeError(error),
        });
      };

      this.server.listen(PORT, HOST, () => {
        debugLog(`[IDMM] API Server running at http://${HOST}:${PORT}`);
        debugLog(`[IDMM] WebSocket at ws://${HOST}:${PORT}/ws`);
        resolve();
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[IDMM] Port ${PORT} is already in use`);
        }
        reject(err);
      });
    });
  }

  /**
   * Stop the server gracefully.
   * @returns {Promise<void>}
   */
  stop() {
    // BUG FIX: Guard against double-call  return same promise if already stopping
    if (this._stopping) {
      return this._stopping;
    }

    this._stopping = new Promise((resolve) => {
      if (this.broadcastTimer) {
        clearInterval(this.broadcastTimer);
        this.broadcastTimer = null;
      }

      if (this._heartbeatTimer) {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
      }

      if (this._rateLimitCleanupTimer) {
        clearInterval(this._rateLimitCleanupTimer);
        this._rateLimitCleanupTimer = null;
      }

      // Close all WebSocket connections
      for (const client of this.wsClients) {
        client.close(1001, 'Server shutting down');
      }
      this.wsClients.clear();

      if (this.wss) {
        this.wss.close();
      }

      if (this.server) {
        this.server.close(() => {
          this.server = null;
          debugLog('[IDMM] Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });

    return this._stopping;
  }
}

module.exports = IDMMServer;

