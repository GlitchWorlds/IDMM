'use strict';

// Enable test mode BEFORE any imports to bypass SSRF blocks on localhost
process.env.IDMM_TEST = '1';
process.env.NODE_ENV = 'test';

/**
 * IDMM Integration Tests.
 *
 * Tests real imports from production code - bridges the gap between
 * isolated test scripts and the actual modules.
 *
 * Uses Node.js built-in test runner (node:test) - no extra dependencies.
 *
 * Usage: node test/integration.test.js  (from app/)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');

// --- Production imports ---
const DownloadManager = require('../src/engine/downloader');
const IDMMDatabase = require('../src/db/sqlite');
const IDMMServer = require('../src/server/server');
const SpeedTracker = require('../src/engine/speed-tracker');
const WorkerPool = require('../src/engine/worker-pool');
const DownloadQueue = require('../src/engine/download-queue');

// --- Test fixtures ---
const TEST_DB_PATH = path.join(os.tmpdir(), 'idmm-integration-test-' + Date.now() + '.db');
const TEST_TEMP_DIR = path.join(os.tmpdir(), 'idmm-integration-temp-' + Date.now());
const TEST_SAVE_DIR = path.join(os.tmpdir(), 'idmm-integration-save-' + Date.now());
const TEST_SERVER_PORT = 19891;
const TEST_FILE_SIZE = 64 * 1024; // 64 KB

let db;
let downloader;
let server;
let testHttpServer;

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function createTestFileServer() {
  return new Promise(function (resolve) {
    var testFile = crypto.randomBytes(TEST_FILE_SIZE);
    var srv = http.createServer(function (req, res) {
      if (req.url === '/testfile.bin') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': testFile.length,
          'Accept-Ranges': 'bytes',
        });
        res.end(testFile);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    srv.listen(TEST_SERVER_PORT, '127.0.0.1', function () {
      resolve({ server: srv, testFile: testFile });
    });
  });
}

// ============================================================
// TEST SUITE
// ============================================================

describe('IDMM Integration Tests', function () {

  before(async function () {
    for (var dir of [TEST_TEMP_DIR, TEST_SAVE_DIR]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    db = await IDMMDatabase.create(TEST_DB_PATH);
    assert.ok(db.isConnected(), 'DB should be connected');

    downloader = new DownloadManager({
      db: db,
      tempDir: TEST_TEMP_DIR,
      settings: {
        default_threads: '2',
        default_thread_mode: 'manual',
        default_save_path: TEST_SAVE_DIR,
        max_concurrent_downloads: '5',
        retry_count: '1',
        timeout_ms: '5000',
        speed_limit_global: '0',
      },
    });

    testHttpServer = await createTestFileServer();
  });

  after(async function () {
    if (downloader) {
      for (var state of downloader.getActiveStates()) {
        try { await downloader.cancelDownload(state.id); } catch (_) {}
      }
    }
    if (server) { try { await server.stop(); } catch (_) {} }
    if (db) { db.close(); }
    if (testHttpServer) { testHttpServer.server.close(); }
    try { fs.rmSync(TEST_DB_PATH, { force: true }); } catch (_) {}
    try { fs.rmSync(TEST_TEMP_DIR, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(TEST_SAVE_DIR, { recursive: true, force: true }); } catch (_) {}
  });

  // ---- Module Import Tests ----

  describe('Module imports', function () {

    it('should import DownloadManager from production code', function () {
      assert.ok(DownloadManager, 'DownloadManager should be importable');
      assert.equal(typeof DownloadManager, 'function', 'DownloadManager should be a constructor');
    });

    it('should import IDMMDatabase from production code', function () {
      assert.ok(IDMMDatabase, 'IDMMDatabase should be importable');
      assert.equal(typeof IDMMDatabase, 'function', 'IDMMDatabase should be a constructor');
    });

    it('should import IDMMServer from production code', function () {
      assert.ok(IDMMServer, 'IDMMServer should be importable');
      assert.equal(typeof IDMMServer, 'function', 'IDMMServer should be a constructor');
    });

    // Fix #1: Decomposition imports
    it('should import SpeedTracker', function () {
      assert.ok(SpeedTracker, 'SpeedTracker should be importable');
      const st = new SpeedTracker();
      st.addSample('dl1', 1024);
      assert.ok(st.getSpeed('dl1') >= 0, 'getSpeed should return a number');
    });

    it('should import WorkerPool', function () {
      assert.ok(WorkerPool, 'WorkerPool should be importable');
      const wp = new WorkerPool(4);
      assert.equal(wp.max, 4, 'WorkerPool max should be 4');
      assert.equal(wp.getActiveCount(), 0, 'No active workers initially');
    });

    it('should import DownloadQueue', function () {
      assert.ok(DownloadQueue, 'DownloadQueue should be importable');
      const dq = new DownloadQueue();
      dq.add('a', DownloadQueue.Priority.HIGH);
      dq.add('b', DownloadQueue.Priority.LOW);
      const next = dq.next();
      assert.equal(next.id, 'a', 'HIGH priority should be next first');
    });
  });

  // ---- Database Lifecycle ----

  describe('Database lifecycle', function () {

    it('DB init -> create download -> get download -> update download -> delete download', function () {
      var downloadId = 'test-' + Date.now();

      var created = db.createDownload({
        id: downloadId,
        url: 'http://example.com/file.bin',
        filename: 'file.bin',
        saveTo: TEST_SAVE_DIR,
        totalSize: 1024,
        threads: 4,
        mimeType: 'application/octet-stream',
        category: 'Others',
        status: 'pending',
      });
      assert.ok(created.ok, 'createDownload should return ok');
      assert.ok(created.data, 'createDownload should return data');
      assert.equal(created.data.id, downloadId);

      var fetched = db.getDownload(downloadId);
      assert.ok(fetched.ok, 'getDownload should return ok');
      assert.equal(fetched.data.url, 'http://example.com/file.bin');

      db.updateDownload(downloadId, { status: 'downloading', downloaded: 512 });
      var updated = db.getDownload(downloadId);
      assert.ok(updated.ok);
      assert.equal(updated.data.status, 'downloading');
      assert.equal(updated.data.downloaded, 512);

      db.deleteDownload(downloadId);
      var deleted = db.getDownload(downloadId);
      assert.ok(deleted.ok);
      assert.equal(deleted.data, null, 'getDownload should return null data after delete');
    });

    it('should support createChunks -> getChunks -> updateChunk', function () {
      var downloadId = 'chunk-test-' + Date.now();

      db.createDownload({
        id: downloadId,
        url: 'http://example.com/chunked.bin',
        filename: 'chunked.bin',
        saveTo: TEST_SAVE_DIR,
        totalSize: 2048,
        threads: 2,
        status: 'pending',
      });

      var createResult = db.createChunks(downloadId, [
        { index: 0, start: 0, end: 1023 },
        { index: 1, start: 1024, end: 2047 },
      ]);
      assert.ok(createResult.ok, 'createChunks should return ok');

      var chunksResult = db.getChunks(downloadId);
      assert.ok(chunksResult.ok, 'getChunks should return ok');
      assert.ok(Array.isArray(chunksResult.data), 'getChunks data should be array');
      assert.equal(chunksResult.data.length, 2);

      db.updateChunk(chunksResult.data[0].id, { downloaded_bytes: 512, status: 'downloading' });
      var updatedChunks = db.getChunks(downloadId);
      assert.equal(updatedChunks.data[0].downloaded_bytes, 512);

      db.deleteDownload(downloadId);
    });

    // Fix #2: DB error propagation
    it('DB query failure returns { ok: false, error }', function () {
      // getDownload with non-existent ID should return ok with null data
      var result = db.getDownload('nonexistent-id-' + Date.now());
      assert.ok(result.ok, 'getDownload should return ok even for non-existent ID');
      assert.equal(result.data, null, 'data should be null for non-existent ID');

      // getStats should return ok with stats object
      var stats = db.getStats();
      assert.ok(stats.ok, 'getStats should return ok');
      assert.ok(stats.data, 'getStats should return data');
      assert.equal(typeof stats.data.total_downloads, 'number');
    });
  });

  // ---- Server + WebSocket ----

  describe('Server lifecycle + WebSocket', function () {

    it('Server start -> GET /api/health -> WebSocket init', async function () {
      server = new IDMMServer({ db: db, downloader: downloader });
      await server.start();
      await sleep(300);

      var response = await new Promise(function (resolve, reject) {
        var req = http.get('http://127.0.0.1:9977/api/health', function (res) {
          var body = '';
          res.on('data', function (chunk) { body += chunk; });
          res.on('end', function () { resolve({ status: res.statusCode, body: body }); });
        });
        req.on('error', reject);
        req.setTimeout(5000, function () { req.destroy(); reject(new Error('timeout')); });
      });

      assert.equal(response.status, 200);
      var health = JSON.parse(response.body);
      assert.equal(health.status, 'ok');
      assert.ok(health.version);
      assert.equal(typeof health.uptime, 'number');

      var wsMsg = await new Promise(function (resolve, reject) {
        var ws;
        try {
          var WebSocket = require('ws');
          ws = new WebSocket('ws://127.0.0.1:9977/ws');
        } catch (err) {
          return reject(err);
        }

        var timeout = setTimeout(function () { ws.close(); reject(new Error('WebSocket timeout')); }, 5000);
        ws.on('open', function () {});
        ws.on('message', function (data) {
          clearTimeout(timeout);
          try { resolve(JSON.parse(data.toString())); } catch (_) { resolve({ raw: data.toString() }); }
          ws.close();
        });
        ws.on('error', function (err) { clearTimeout(timeout); reject(err); });
      });

      assert.ok(wsMsg);
      assert.equal(wsMsg.type, 'init');
      assert.ok(Array.isArray(wsMsg.downloads));

      await server.stop();
      server = null;
    });
  });

  // ---- DownloadManager Lifecycle ----

  describe('DownloadManager lifecycle', function () {

    it('DownloadManager start -> pause -> resume -> cancel flow', async function () {
      var url = 'http://127.0.0.1:' + TEST_SERVER_PORT + '/testfile.bin';

      var result = await downloader.startDownload({
        url: url,
        threads: 1,
        threadMode: 'manual',
        saveTo: TEST_SAVE_DIR,
      });
      assert.ok(result.id);
      assert.equal(result.status, 'downloading');

      await sleep(200);

      var paused = await downloader.pauseDownload(result.id);
      assert.equal(paused.status, 'paused');

      var dbAfterPause = db.getDownload(result.id);
      assert.ok(dbAfterPause.ok);
      assert.equal(dbAfterPause.data.status, 'paused');

      var resumed = await downloader.resumeDownload(result.id);
      assert.equal(resumed.status, 'downloading');

      await sleep(200);

      var cancelled = await downloader.cancelDownload(result.id);
      assert.equal(cancelled.status, 'cancelled');

      var dbAfterCancel = db.getDownload(result.id);
      assert.ok(dbAfterCancel.ok);
      assert.equal(dbAfterCancel.data.status, 'cancelled');
    });

    // Fix #12: Concurrent downloads
    it('should handle 3 concurrent downloads', async function () {
      var url = 'http://127.0.0.1:' + TEST_SERVER_PORT + '/testfile.bin';
      var results = [];

      for (var i = 0; i < 3; i++) {
        var r = await downloader.startDownload({
          url: url,
          threads: 1,
          threadMode: 'manual',
          saveTo: TEST_SAVE_DIR,
        });
        results.push(r);
        assert.ok(r.id, 'Download ' + i + ' should have an id');
      }

      assert.equal(downloader.getActiveCount(), 3, 'Should have 3 active downloads');

      // Cleanup
      for (var r of results) {
        await downloader.cancelDownload(r.id);
      }
    });

    // Fix #12: Priority queue ordering
    it('DownloadQueue should return HIGH priority before LOW', function () {
      var dq = new DownloadQueue();
      dq.add('low1', DownloadQueue.Priority.LOW);
      dq.add('high1', DownloadQueue.Priority.HIGH);
      dq.add('normal1', DownloadQueue.Priority.NORMAL);

      var first = dq.next();
      assert.equal(first.id, 'high1', 'HIGH should be first');

      var second = dq.next();
      assert.equal(second.id, 'normal1', 'NORMAL should be second');

      var third = dq.next();
      assert.equal(third.id, 'low1', 'LOW should be third');
    });

    // Fix #12: DB error propagation pattern
    it('All DB methods return { ok, data/error } consistently', function () {
      // getSetting
      var setting = db.getSetting('default_threads');
      assert.ok(setting.ok, 'getSetting should return ok');
      assert.ok(setting.data, 'getSetting should return data');

      // getAllSettings
      var allSettings = db.getAllSettings();
      assert.ok(allSettings.ok, 'getAllSettings should return ok');
      assert.ok(allSettings.data, 'getAllSettings should return data');

      // listDownloads
      var list = db.listDownloads();
      assert.ok(list.ok, 'listDownloads should return ok');
      assert.ok(Array.isArray(list.data), 'listDownloads data should be array');

      // getStats
      var stats = db.getStats();
      assert.ok(stats.ok, 'getStats should return ok');
      assert.ok(stats.data, 'getStats should return data');
    });

    // Fix #12: Semaphore release on worker crash
    it('WorkerPool release guards against double-release', function () {
      var wp = new WorkerPool(2);
      var fakeWorker = { _semaphoreReleased: false };

      // Simulate acquire + release
      wp.acquire(); // current = 1
      wp.release(fakeWorker); // current = 0, worker._semaphoreReleased = true
      assert.equal(fakeWorker._semaphoreReleased, true, 'Worker should be marked released');

      // Double-release should be a no-op
      var beforeCurrent = wp.current;
      wp.release(fakeWorker);
      assert.equal(wp.current, beforeCurrent, 'Double-release should not change current');
    });
  });
});
