'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const path = require('node:path');

/**
 * IDMAM API Server.
 *
 * Express REST API on localhost:9977 with WebSocket for real-time progress.
 * Security: 127.0.0.1 only, CORS whitelist, rate limiting.
 */

const PORT = 9977;
const HOST = '127.0.0.1';
const WS_BROADCAST_INTERVAL = 500; // ms
const DEBUG = process.env.IDMAM_DEBUG === '1' || process.env.DEBUG === 'idmam';
const debugLog = DEBUG ? console.log.bind(console) : () => {};

class IDRAMServer {
  /**
   * @param {Object} options
   * @param {Object} options.db - IDMAMDatabase instance
   * @param {Object} options.downloader - DownloadManager instance
   */
  constructor({ db, downloader }) {
    this.db = db;
    this.downloader = downloader;
    this.app = express();
    this.server = null;
    this.wss = null;
    this.wsClients = new Set();
    this.broadcastTimer = null;
    this._heartbeatTimer = null;
    this.activeUrls = new Set(); // F10: Track URLs currently being downloaded
    this.downloadUrlMap = new Map(); // F10: downloadId → url for cleanup
    this._rateLimitCleanupTimer = null;

    this._setupMiddleware();
    this._setupRoutes();
  }

  // ─── Middleware ───────────────────────────────────────────────────

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

        // Allow localhost variants
        if (
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:') ||
          origin.startsWith('https://localhost:') ||
          origin.startsWith('chrome-extension://') ||
          origin.startsWith('moz-extension://')
        ) {
          return callback(null, true);
        }

        callback(new Error('CORS not allowed'));
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-IDMAM-Token'],
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

    // F9: TTL-based eviction — clean up stale rate limit entries every 5 minutes
    this._rateLimitCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [ip, entry] of rateLimitMap) {
        if (now - entry.windowStart > RATE_WINDOW) {
          rateLimitMap.delete(ip);
        }
      }
    }, 5 * 60 * 1000);
  }

  // ─── Routes ──────────────────────────────────────────────────────

  _setupRoutes() {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', version: '1.0.0', uptime: process.uptime() });
    });

    // POST /api/download — Start a new download
    this.app.post('/api/download', async (req, res) => {
      try {
        const { url, filename, save_to, threads, cookies, referrer, headers, checksum } = req.body;

        if (!url) {
          return res.status(400).json({ error: 'URL is required' });
        }

        // Validate URL
        try {
          new URL(url);
        } catch {
          return res.status(400).json({ error: 'Invalid URL' });
        }

        // F1: Path traversal protection — validate save_to against allowed roots
        {
          const defaultSavePath = this.db.getSetting('default_save_path') || '';
          const allowedRoots = new Set();
          if (defaultSavePath) allowedRoots.add(path.resolve(defaultSavePath));
          try {
            allowedRoots.add(path.resolve(require('node:os').homedir(), 'Downloads'));
          } catch { /* OS module unavailable — rely on default_save_path only */ }

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
        const maxConcurrent = parseInt(this.db.getSetting('max_concurrent_downloads') || '5', 10);
        if (this.downloader.getActiveCount() >= maxConcurrent) {
          return res.status(429).json({
            error: `Maximum concurrent downloads reached (${maxConcurrent})`,
          });
        }

        const result = await this.downloader.startDownload({
          url,
          filename,
          saveTo: save_to,
          threads,
          cookies,
          referrer,
          headers,
          checksum,
        });

        // F10: Track active URL
        this.activeUrls.add(url);
        this.downloadUrlMap.set(result.id, url);

        res.status(201).json(result);
      } catch (err) {
        console.error('Download start error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/downloads — List all downloads
    this.app.get('/api/downloads', (req, res) => {
      try {
        const { status } = req.query;
        const downloads = this.db.listDownloads(status);

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
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/download/:id — Get download status
    this.app.get('/api/download/:id', (req, res) => {
      try {
        const state = this.downloader.getDownloadState(req.params.id);
        if (!state) {
          return res.status(404).json({ error: 'Download not found' });
        }
        res.json(state);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/download/:id/pause — Pause download
    this.app.post('/api/download/:id/pause', (req, res) => {
      try {
        const result = this.downloader.pauseDownload(req.params.id);
        res.json(result);
      } catch (err) {
        const status = err.message.includes('not active') ? 400 : 500;
        res.status(status).json({ error: err.message });
      }
    });

    // POST /api/download/:id/resume — Resume download
    this.app.post('/api/download/:id/resume', async (req, res) => {
      try {
        const result = await this.downloader.resumeDownload(req.params.id);
        res.json(result);
      } catch (err) {
        const status = err.message.includes('not found') ? 404 : 500;
        res.status(status).json({ error: err.message });
      }
    });

    // POST /api/download/:id/cancel — Cancel download
    this.app.post('/api/download/:id/cancel', (req, res) => {
      try {
        const result = this.downloader.cancelDownload(req.params.id);
        this._removeActiveUrl(req.params.id); // F10: Cleanup URL tracking
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // DELETE /api/download/:id — Delete download + files
    this.app.delete('/api/download/:id', (req, res) => {
      try {
        const result = this.downloader.deleteDownload(req.params.id);
        this._removeActiveUrl(req.params.id); // F10: Cleanup URL tracking
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/settings — Get all settings
    this.app.get('/api/settings', (req, res) => {
      try {
        const settings = this.db.getAllSettings();
        res.json(settings);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // PUT /api/settings — Update settings
    this.app.put('/api/settings', (req, res) => {
      try {
        const updates = req.body;
        if (!updates || typeof updates !== 'object') {
          return res.status(400).json({ error: 'Settings object required' });
        }

        // Whitelist allowed settings keys
        const allowedKeys = [
          'default_threads', 'max_concurrent_downloads', 'max_threads_per_download',
          'default_save_path', 'temp_dir', 'retry_count', 'timeout_ms',
          'speed_limit_global', 'auto_resume', 'auto_categorize',
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

        res.json({ updated: Object.keys(filtered) });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/stats — Download statistics
    this.app.get('/api/stats', (req, res) => {
      try {
        const stats = this.db.getStats();
        res.json(stats);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  // ─── WebSocket ───────────────────────────────────────────────────

  _setupWebSocket() {
    // F6: Set maxPayload to prevent memory abuse from huge messages
    this.wss = new WebSocketServer({ server: this.server, path: '/ws', maxPayload: 64 * 1024 });

    // F7: Heartbeat — terminate dead connections every 30s
    this._heartbeatTimer = setInterval(() => {
      for (const ws of this.wsClients) {
        if (ws.isAlive === false) {
          this.wsClients.delete(ws);
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, 30000);

    this.wss.on('connection', (ws, req) => {
      // Verify origin
      const origin = req.headers.origin;
      if (origin && !this._isAllowedOrigin(origin)) {
        ws.close(4003, 'Origin not allowed');
        return;
      }

      ws.isAlive = true; // F7: Mark alive on connect
      ws.on('pong', () => { ws.isAlive = true; }); // F7: Refresh on pong

      this.wsClients.add(ws);
      debugLog(`[WS] Client connected (total: ${this.wsClients.size})`);

      ws.on('close', () => {
        this.wsClients.delete(ws);
        debugLog(`[WS] Client disconnected (total: ${this.wsClients.size})`);
      });

      ws.on('error', () => {
        this.wsClients.delete(ws);
      });

      // Send initial state
      const states = this.downloader.getActiveStates();
      if (states.length > 0) {
        ws.send(JSON.stringify({
          type: 'init',
          downloads: states,
        }));
      }
    });

    // Broadcast progress every 500ms
    this.broadcastTimer = setInterval(() => {
      if (this.wsClients.size === 0) return;

      const states = this.downloader.getActiveStates();
      if (states.length === 0) return;

      const message = JSON.stringify({
        type: 'progress',
        downloads: states,
        timestamp: Date.now(),
      });

      for (const client of this.wsClients) {
        if (client.readyState === 1) { // WebSocket.OPEN
          try {
            client.send(message);
          } catch {
            // Client disconnected
            this.wsClients.delete(client);
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

  // ─── Lifecycle ───────────────────────────────────────────────────

  /**
   * Start the server.
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.app);

      this._setupWebSocket();

      // W7: Overwriting onComplete/onError is safe here — the DownloadManager
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
          error: error.message,
        });
      };

      this.server.listen(PORT, HOST, () => {
        debugLog(`[IDMAM] API Server running at http://${HOST}:${PORT}`);
        debugLog(`[IDMAM] WebSocket at ws://${HOST}:${PORT}/ws`);
        resolve();
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[IDMAM] Port ${PORT} is already in use`);
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
    // BUG FIX: Guard against double-call — return same promise if already stopping
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
          debugLog('[IDMAM] Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });

    return this._stopping;
  }
}

module.exports = IDRAMServer;
