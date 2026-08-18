import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const PORT = 9977;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runE2E() {
  console.log('=== STARTING IDMM v1.4.2 E2E VERIFICATION ===\n');
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    details: []
  };

  function assert(name, condition, extra = '') {
    results.total++;
    if (condition) {
      results.passed++;
      console.log(`[PASS] ${name} ${extra}`);
      results.details.push({ test: name, status: 'PASS', extra });
    } else {
      results.failed++;
      console.error(`[FAIL] ${name} ${extra}`);
      results.details.push({ test: name, status: 'FAIL', extra });
    }
  }

  // 1. Check Binaries Existence and Sizes
  console.log('--- Step 1: Binary & Package Verification ---');
  const rustCorePath = 'D:\\IDMM\\core-engine-rust\\target\\release\\idmm-core.exe';
  const tauriExePath = 'D:\\IDMM\\tauri-shell\\src-tauri\\target\\release\\idmm-desktop.exe';
  const nsisSetupPath = 'D:\\IDMM\\tauri-shell\\src-tauri\\target\\release\\bundle\\nsis\\IDMM_1.4.2_x64-setup.exe';

  assert('Rust Core Binary Exists', fs.existsSync(rustCorePath));
  assert('Tauri Desktop Binary Exists', fs.existsSync(tauriExePath));
  assert('NSIS Installer Exists', fs.existsSync(nsisSetupPath));

  if (fs.existsSync(nsisSetupPath)) {
    const sizeMB = fs.statSync(nsisSetupPath).size / (1024 * 1024);
    assert('NSIS Installer Size < 15MB Target', sizeMB < 15, `(${sizeMB.toFixed(2)} MB)`);
  }

  // 2. Start idmm-core.exe background process
  console.log('\n--- Step 2: Spawn Rust Core Engine Service ---');
  const coreProcess = spawn(rustCorePath, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, IDMM_ALLOW_LOOPBACK: '1' }
  });
  coreProcess.unref();

  // Wait for port 9977 to become ready
  let serverReady = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        const json = await res.json();
        if (json.status === 'ok') {
          serverReady = true;
          break;
        }
      }
    } catch {}
  }
  assert('Rust Core HTTP Server Healthcheck', serverReady);

  if (!serverReady) {
    console.error('Server failed to start. Aborting test.');
    process.exit(1);
  }

  // 3. Test Native Messaging Host
  console.log('\n--- Step 3: Native Messaging Host Protocol Test ---');
  const nativeTest = await new Promise((resolve) => {
    const proc = spawn(rustCorePath, ['--native-messaging-host'], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    const pingPayload = JSON.stringify({ action: 'ping' });
    const payloadBuf = Buffer.from(pingPayload, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(payloadBuf.length, 0);

    let receivedData = Buffer.alloc(0);
    proc.stdout.on('data', (chunk) => {
      receivedData = Buffer.concat([receivedData, chunk]);
      if (receivedData.length >= 4) {
        const respLen = receivedData.readUInt32LE(0);
        if (receivedData.length >= 4 + respLen) {
          const respJson = receivedData.subarray(4, 4 + respLen).toString('utf8');
          try {
            const parsed = JSON.parse(respJson);
            resolve(parsed);
          } catch (e) {
            resolve({ error: e.message });
          }
          proc.kill();
        }
      }
    });

    proc.stdin.write(lenBuf);
    proc.stdin.write(payloadBuf);

    setTimeout(() => {
      proc.kill();
      resolve({ error: 'Timeout waiting for native host response' });
    }, 5000);
  });

  assert('Native Messaging Host Response', nativeTest && nativeTest.success === true, JSON.stringify(nativeTest));

  // 4. Test Multi-Part Download Engine
  console.log('\n--- Step 4: Multi-part File Download & Integrity ---');
  // Create a local test server serving a known 10MB deterministic binary file to test multi-chunk ranges reliably
  const testFileSize = 10 * 1024 * 1024; // 10MB
  const testBuffer = Buffer.alloc(testFileSize);
  for (let i = 0; i < testFileSize; i++) {
    testBuffer[i] = i % 256;
  }
  const expectedHash = crypto.createHash('sha256').update(testBuffer).digest('hex');

  const localTestServer = http.createServer((req, res) => {
    const range = req.headers.range;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/octet-stream');

    if (!range) {
      res.setHeader('Content-Length', testFileSize);
      res.writeHead(200);
      res.end(testBuffer);
      return;
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : testFileSize - 1;
    const chunksize = (end - start) + 1;

    res.setHeader('Content-Range', `bytes ${start}-${end}/${testFileSize}`);
    res.setHeader('Content-Length', chunksize);
    res.writeHead(206);
    res.end(testBuffer.subarray(start, end + 1));
  });

  await new Promise((resolve) => localTestServer.listen(9876, '127.0.0.1', resolve));
  console.log('Local test fixture server listening on http://127.0.0.1:9876');

  const testDownloadUrl = 'http://127.0.0.1:9876/test_10mb.bin';
  const saveDir = 'D:\\IDMM\\test_downloads';
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

  const dlRes = await fetch(`${BASE_URL}/api/downloads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: testDownloadUrl,
      filename: 'test_10mb.bin',
      save_to: saveDir,
      threads: 8,
      thread_mode: 'manual'
    })
  });

  const dlJson = await dlRes.json();
  assert('Start Download API Request', dlRes.ok && dlJson.id, `Download ID: ${dlJson.id}`);
  const downloadId = dlJson.id;

  // Poll progress until completed
  let completed = false;
  let finalStatus = null;
  const startTime = Date.now();

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 300));
    const statusRes = await fetch(`${BASE_URL}/api/downloads/${downloadId}`);
    if (statusRes.ok) {
      const statusJson = await statusRes.json();
      finalStatus = statusJson;
      if (statusJson.status === 'completed' || statusJson.status === 'error') {
        completed = true;
        break;
      }
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  assert('Download Reached Completed State', completed && finalStatus.status === 'completed', `State: ${finalStatus?.status} in ${durationSec}s`);

  // Verify downloaded file integrity on disk
  const downloadedFilePath = path.join(saveDir, 'test_10mb.bin');
  assert('Downloaded File Exists on Disk', fs.existsSync(downloadedFilePath));

  if (fs.existsSync(downloadedFilePath)) {
    const downloadedBuf = fs.readFileSync(downloadedFilePath);
    const actualHash = crypto.createHash('sha256').update(downloadedBuf).digest('hex');
    assert('File Size Exact Match', downloadedBuf.length === testFileSize, `(${downloadedBuf.length} bytes)`);
    assert('SHA-256 Checksum Exact Match', actualHash === expectedHash, `Hash: ${actualHash}`);
    
    // Clean up test file
    fs.unlinkSync(downloadedFilePath);
  }

  // 5. Check Database Persistence & Settings
  console.log('\n--- Step 5: Database State & Settings API ---');
  const listRes = await fetch(`${BASE_URL}/api/downloads`);
  const listJson = await listRes.json();
  const dbItem = Array.isArray(listJson) ? listJson.find(d => d.id === downloadId) : null;
  assert('Download Saved & Queryable in SQLite DB', dbItem !== null && dbItem.status === 'completed');

  const settingsRes = await fetch(`${BASE_URL}/api/settings`);
  const settingsJson = await settingsRes.json();
  assert('Settings API Returns Valid Config', settingsRes.ok && typeof settingsJson === 'object');

  // 6. Test Pause & Delete API Lifecycle
  console.log('\n--- Step 6: Lifecycle API Test (Delete) ---');
  const delRes = await fetch(`${BASE_URL}/api/downloads/${downloadId}?delete_file=true`, {
    method: 'DELETE'
  });
  const delJson = await delRes.json();
  assert('Delete Download Record API', delRes.ok && delJson.deleted === true, JSON.stringify(delJson));

  // Close fixtures
  localTestServer.close();

  console.log('\n=============================================');
  console.log(`TOTAL TESTS: ${results.total} | PASSED: ${results.passed} | FAILED: ${results.failed}`);
  console.log('=============================================');

  process.exit(results.failed === 0 ? 0 : 1);
}

runE2E().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
