'use strict';

/**
 * IDMAM Test Script.
 *
 * Demonstrates the complete download lifecycle using a local test server:
 * 1. Start a download
 * 2. Monitor progress
 * 3. Pause
 * 4. Resume
 * 5. Verify completion
 *
 * Usage: node test.js
 *
 * This script is self-contained — it creates its own test file server
 * so it works without internet access.
 */

const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');

const TEST_FILE_SIZE = 10 * 1024 * 1024; // 10 MB test file (large enough to test pause/resume)
const TEST_PORT = 19890;
const TEST_THROTTLE_MS = 50; // ms delay per chunk to simulate slower download for pause test
const TEST_URL = `http://127.0.0.1:${TEST_PORT}/testfile.bin`;

// ─── Utilities ─────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec === 0) return '0 MB/s';
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── WebSocket Test ─────────────────────────────────────────────

function testWebSocket() {
  return new Promise((resolve, reject) => {
    const WebSocket = require('ws');
    const ws = new WebSocket('ws://127.0.0.1:9977/ws');
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timed out'));
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      // Wait briefly for initial message
      setTimeout(() => {
        ws.close();
        resolve(true);
      }, 1000);
    });

    ws.on('message', (data) => {
      // Connection works if we receive any message
      clearTimeout(timeout);
      ws.close();
      resolve(true);
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ─── Local Test File Server ────────────────────────────────────────

function createTestFileServer() {
  // Create deterministic test data
  const testData = Buffer.alloc(TEST_FILE_SIZE);
  for (let i = 0; i < TEST_FILE_SIZE; i++) {
    testData[i] = i % 256;
  }
  const expectedHash = crypto.createHash('sha256').update(testData).digest('hex');

  const server = http.createServer((req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Length': String(TEST_FILE_SIZE),
        'Accept-Ranges': 'bytes',
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="testfile.bin"',
      });
      res.end();
      return;
    }

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : TEST_FILE_SIZE - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${TEST_FILE_SIZE}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': 'application/octet-stream',
      });

      // Throttled send: 64KB chunks with delay to allow pause testing
      const CHUNK_SEND = 64 * 1024;
      let pos = start;
      function sendNext() {
        if (pos > end) { res.end(); return; }
        const sliceEnd = Math.min(pos + CHUNK_SEND - 1, end);
        res.write(testData.slice(pos, sliceEnd + 1));
        pos = sliceEnd + 1;
        setTimeout(sendNext, TEST_THROTTLE_MS);
      }
      sendNext();
    } else {
      res.writeHead(200, {
        'Content-Length': String(TEST_FILE_SIZE),
        'Content-Type': 'application/octet-stream',
      });
      res.end(testData);
    }
  });

  return { server, expectedHash, testData };
}

// ─── HTTP Client ───────────────────────────────────────────────────

function apiRequest(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, 'http://127.0.0.1:9977');
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── Test Steps ────────────────────────────────────────────────────

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  IDMAM Core Engine — Integration Test               ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  const results = { passed: 0, failed: 0, skipped: 0, errors: [] };
  function pass(name) { results.passed++; console.log(`  ✅ ${name}`); }
  function fail(name, err) { results.failed++; results.errors.push(`${name}: ${err}`); console.error(`  ❌ ${name}: ${err}`); }
  function skip(name) { results.skipped++; console.log(`  ⏭️  ${name}`); }

  // ─── Setup ───────────────────────────────────────────────────────

  console.log('▸ Step 0: Setting up test environment...');

  const IDMAMDatabase = require('./src/db/sqlite');
  const DownloadManager = require('./src/engine/downloader');
  process.env.IDMAM_TEST = '1'; // Enable test mode (allows localhost downloads)
  const IDRAMServer = require('./src/server/server');

  // Create temp directories
  const DATA_DIR = path.join(os.homedir(), '.idmam', 'test-run');
  const TEMP_DIR = path.join(DATA_DIR, 'temp');
  const SAVE_DIR = path.join(DATA_DIR, 'downloads');

  for (const dir of [DATA_DIR, TEMP_DIR, SAVE_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // Start test file server
  const { server: testServer, expectedHash } = createTestFileServer();
  await new Promise(r => testServer.listen(TEST_PORT, '127.0.0.1', r));
  console.log(`  ✅ Test file server on http://127.0.0.1:${TEST_PORT} (${formatBytes(TEST_FILE_SIZE)})`);

  // Initialize IDMAM
  const db = await IDMAMDatabase.create(path.join(DATA_DIR, 'test.db'));
  db.setSetting('default_save_path', SAVE_DIR);
  const settings = db.getAllSettings();
  console.log('  ✅ Database initialized');

  let completedResult = null;
  let errorResult = null;
  const downloader = new DownloadManager({
    db,
    tempDir: TEMP_DIR,
    settings,
    onComplete: (id, result) => {
      completedResult = result;
    },
    onError: (id, err) => {
      errorResult = err;
      console.error(`  ❌ Error: ${err.message}`);
    },
  });

  const server = new IDRAMServer({ db, downloader });
  await server.start();
  console.log('  ✅ IDMAM server started on http://127.0.0.1:9977');
  console.log('');

  // ─── Test 1: Health Check ────────────────────────────────────────

  console.log('\n▸ Step 1: Health check...');
  try {
    const health = await apiRequest('GET', '/api/health');
    if (health.status === 200 && health.data.status === 'ok') {
      pass('Health check');
    } else {
      fail('Health check', `Status ${health.status}`);
    }
  } catch (err) {
    fail('Health check', err.message);
  }

  // ─── Test 2: Start Download ──────────────────────────────────────

  console.log('\n▸ Step 2: Starting download...');
  let downloadId = null;
  try {
    const startRes = await apiRequest('POST', '/api/download', {
      url: TEST_URL,
      threads: 4,
    });

    if (startRes.status === 201 && startRes.data.id) {
      downloadId = startRes.data.id;
      console.log(`  ID: ${downloadId}`);
      console.log(`  File: ${startRes.data.filename}`);
      console.log(`  Size: ${formatBytes(startRes.data.total_size)}`);
      console.log(`  Threads: ${startRes.data.threads}`);
      pass('Download started');
    } else {
      fail('Download start', JSON.stringify(startRes.data));
      await cleanup(server, db, testServer, DATA_DIR);
      process.exit(1);
    }
  } catch (err) {
    fail('Download start', err.message);
    await cleanup(server, db, testServer, DATA_DIR);
    process.exit(1);
  }

  // ─── Test 3: Monitor Progress ────────────────────────────────────

  console.log('\n▸ Step 3: Monitoring progress...');
  let pauseTested = false;
  let prePauseDownloaded = 0;

  for (let tick = 0; tick < 120; tick++) {
    await sleep(250);

    const statusRes = await apiRequest('GET', `/api/download/${downloadId}`);
    if (statusRes.status !== 200) continue;

    const d = statusRes.data;
    const bar = '█'.repeat(Math.floor((d.progress || 0) / 5)) +
                '░'.repeat(20 - Math.floor((d.progress || 0) / 5));
    const line = `  [${bar}] ${(d.progress || 0).toFixed(1)}% | ${formatBytes(d.downloaded)} / ${formatBytes(d.total_size)} | ${formatSpeed(d.speed)} | ETA: ${d.eta}s | threads: ${d.active_threads}`;

    if (tick % 4 === 0) {
      console.log(line);
    }

    // Test pause at ~30% progress
    if ((d.progress || 0) >= 30 && !pauseTested) {
      prePauseDownloaded = d.downloaded || 0;
      pauseTested = true;
      console.log('');
      break;
    }

    if (d.status === 'completed') {
      prePauseDownloaded = d.downloaded || 0;
      pauseTested = true;
      console.log('');
      break;
    }

    if (d.status === 'failed') {
      fail('Download monitoring', d.error);
      await cleanup(server, db, testServer, DATA_DIR);
      process.exit(1);
    }
  }

  if (!pauseTested) {
    fail('Download monitoring', 'Timed out waiting for 30% progress');
  }

  // ─── Test 4: Pause ──────────────────────────────────────────────

  let resumeSucceeded = false;

  if (pauseTested) {
    const statusCheck = await apiRequest('GET', `/api/download/${downloadId}`);
    if (statusCheck.data.status === 'completed') {
      skip('Pause test (download completed too fast)');
      skip('Resume test (download completed too fast)');
      resumeSucceeded = true; // No resume needed
    } else {
      console.log('\n▸ Step 4: Pausing download...');
      try {
        const pauseRes = await apiRequest('POST', `/api/download/${downloadId}/pause`);
        console.log(`  Status: ${pauseRes.data.status}`);

        await sleep(1000);

        const pausedStatus = await apiRequest('GET', `/api/download/${downloadId}`);
        const pausedDownloaded = pausedStatus.data.downloaded || 0;
        console.log(`  Downloaded: ${formatBytes(pausedDownloaded)} (${(pausedStatus.data.progress || 0).toFixed(1)}%)`);

        if (pauseRes.data.status === 'paused' && pausedDownloaded > 0) {
          pass('Pause download');
        } else {
          fail('Pause download', `Unexpected status: ${pauseRes.data.status}`);
        }
      } catch (err) {
        fail('Pause download', err.message);
      }

      // ─── Test 5: Resume ──────────────────────────────────────────

      console.log('\n▸ Step 5: Resuming download...');
      try {
        const resumeRes = await apiRequest('POST', `/api/download/${downloadId}/resume`);
        console.log(`  Status: ${resumeRes.data.status}`);

        if (resumeRes.data.status === 'downloading') {
          pass('Resume download');
        } else {
          fail('Resume download', `Unexpected status: ${resumeRes.data.status}`);
        }
      } catch (err) {
        fail('Resume download', err.message);
      }

      // ─── Test 6: Wait for completion after resume ────────────────

      console.log('\n▸ Step 6: Waiting for completion after resume...');
      let completedAfterResume = false;
      let failedAfterResume = false;
      let lastProgress = 0;
      let stuckTicks = 0;

      for (let tick = 0; tick < 240; tick++) {
        await sleep(250);

        const statusRes = await apiRequest('GET', `/api/download/${downloadId}`);
        const d = statusRes.data;

        if (tick % 8 === 0) {
          console.log(`  [${(d.progress || 0).toFixed(1)}%] ${formatBytes(d.downloaded)} / ${formatBytes(d.total_size)} | ${formatSpeed(d.speed)}`);
        }

        if (d.status === 'completed') {
          completedAfterResume = true;
          resumeSucceeded = true;
          console.log(`  ✅ Download completed after resume!\n`);
          break;
        }
        if (d.status === 'failed') {
          failedAfterResume = true;
          console.error(`  ❌ Download failed after resume: ${d.error}\n`);
          break;
        }

        // Detect stuck downloads (no progress for 5 seconds = 20 ticks)
        const currentProgress = d.downloaded || 0;
        if (currentProgress === lastProgress && d.status === 'downloading') {
          stuckTicks++;
          if (stuckTicks >= 20) {
            failedAfterResume = true;
            console.error(`  ❌ Download stuck at ${formatBytes(currentProgress)} — no progress for 5s\n`);
            break;
          }
        } else {
          stuckTicks = 0;
          lastProgress = currentProgress;
        }
      }

      if (completedAfterResume) {
        pass('Complete after resume');
      } else if (failedAfterResume) {
        fail('Complete after resume', 'Download failed or stuck after resume');
      } else {
        fail('Complete after resume', 'Timed out waiting for completion');
      }
    }
  }

  // ─── Test 7: Verify File ─────────────────────────────────────────

  console.log('\n▸ Step 7: Verifying downloaded file...');
  let fileVerified = false;
  if (fs.existsSync(SAVE_DIR)) {
    const files = fs.readdirSync(SAVE_DIR);
    console.log(`  Files: ${files.join(', ')}`);

    for (const file of files) {
      const filePath = path.join(SAVE_DIR, file);
      const stat = fs.statSync(filePath);
      console.log(`  ${file}: ${formatBytes(stat.size)}`);

      if (stat.size === TEST_FILE_SIZE) {
        const content = fs.readFileSync(filePath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        if (hash === expectedHash) {
          fileVerified = true;
          console.log(`  SHA-256 verified — file integrity confirmed!`);
        } else {
          console.error(`  Hash mismatch! Expected: ${expectedHash.substring(0, 16)}..., Got: ${hash.substring(0, 16)}...`);
        }
      } else {
        console.error(`  Size mismatch: expected ${formatBytes(TEST_FILE_SIZE)}, got ${formatBytes(stat.size)}`);
      }
    }
  } else {
    console.error(`  Download directory not found`);
  }

  if (fileVerified) {
    pass('File integrity verification');
  } else {
    fail('File integrity verification', 'SHA-256 hash mismatch or file missing');
  }

  // ─── Test 8: WebSocket Connection ────────────────────────────────

  console.log('\n▸ Step 8: Testing WebSocket connection...');
  try {
    await testWebSocket();
    pass('WebSocket connection');
  } catch (err) {
    fail('WebSocket connection', err.message);
  }

  // ─── Test 9: List & Stats ────────────────────────────────────────

  console.log('\n▸ Step 9: Listing downloads...');
  try {
    const listRes = await apiRequest('GET', '/api/downloads');
    console.log(`  Found ${listRes.data.length} download(s)`);
    for (const d of listRes.data) {
      console.log(`  • ${d.filename} — ${d.status} (${(d.progress || 0).toFixed(1)}%)`);
    }
    if (listRes.data.length > 0) {
      pass('List downloads');
    } else {
      fail('List downloads', 'No downloads found');
    }
  } catch (err) {
    fail('List downloads', err.message);
  }

  console.log('\n▸ Step 10: Statistics...');
  try {
    const statsRes = await apiRequest('GET', '/api/stats');
    const s = statsRes.data;
    console.log(`  Total: ${s.total_downloads} | Completed: ${s.completed} | Failed: ${s.failed}`);
    console.log(`  Total downloaded: ${formatBytes(s.total_bytes_downloaded)}`);
    pass('Statistics');
  } catch (err) {
    fail('Statistics', err.message);
  }

  // ─── Summary ─────────────────────────────────────────────────────

  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  Results: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
  if (results.errors.length > 0) {
    console.log('  Failures:');
    for (const err of results.errors) {
      console.log(`    ❌ ${err}`);
    }
  }
  console.log('════════════════════════════════════════════════════════');

  if (results.failed === 0) {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  ✅ ALL TESTS PASSED!                               ║');
    console.log('╚══════════════════════════════════════════════════════╝');
  } else {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log(`║  ❌ ${results.failed} TEST(S) FAILED!                            ║`);
    console.log('╚══════════════════════════════════════════════════════╝');
  }

  // Cleanup
  await cleanup(server, db, testServer, DATA_DIR);

  // Exit with appropriate code
  if (results.failed > 0) {
    process.exit(1);
  }
}

async function cleanup(server, db, testServer, dataDir) {
  try {
    await server.stop();
    testServer.close();
    db.close();
    // Clean up test files
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
