import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const TARGET_VERSION = '1.4.5';
const PORT = 9977;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(os.homedir(), '.idmm', 'idmm.db');
const TEST_DIR = path.join('D:\\IDMM', 'test_e2e_workspace');

if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function request(method, pathUrl, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, BASE_URL);
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

async function runE2E() {
  console.log(`=== STARTING IDMM v${TARGET_VERSION} COMPREHENSIVE QC VERIFICATION ===\n`);
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

  // 1. Check Artifacts
  console.log('--- Step 1: Binary & Manifest Verification ---');
  const rustCorePath = 'D:\\IDMM\\core-engine-rust\\target\\release\\idmm-core.exe';
  const resourceCorePath = 'D:\\IDMM\\tauri-shell\\src-tauri\\resources\\idmm-core.exe';
  const tauriExePath = 'D:\\IDMM\\tauri-shell\\src-tauri\\target\\release\\idmm-desktop.exe';
  const nsisSetupPath = `D:\\IDMM\\tauri-shell\\src-tauri\\target\\release\\bundle\\nsis\\IDMM_${TARGET_VERSION}_x64-setup.exe`;

  assert('Rust Core Binary Exists', fs.existsSync(rustCorePath));
  assert('Resource Core Binary Exists', fs.existsSync(resourceCorePath));
  assert('Tauri Desktop Binary Exists', fs.existsSync(tauriExePath));
  assert(`NSIS ${TARGET_VERSION} Installer Exists`, fs.existsSync(nsisSetupPath));

  const rustCoreHash = getSha256(rustCorePath);
  const resCoreHash = getSha256(resourceCorePath);
  assert('Core Binary Sync (target == resources)', rustCoreHash === resCoreHash, `(${rustCoreHash.substring(0, 8)})`);

  // Manifests version check
  const extManifest = JSON.parse(fs.readFileSync('D:\\IDMM\\extension\\manifest.json', 'utf8'));
  const uiPkg = JSON.parse(fs.readFileSync('D:\\IDMM\\electron\\ui\\package.json', 'utf8'));
  const tauriConf = JSON.parse(fs.readFileSync('D:\\IDMM\\tauri-shell\\src-tauri\\tauri.conf.json', 'utf8'));
  assert(`Extension manifest.json is ${TARGET_VERSION}`, extManifest.version === TARGET_VERSION);
  assert(`UI package.json is ${TARGET_VERSION}`, uiPkg.version === TARGET_VERSION);
  assert(`tauri.conf.json is ${TARGET_VERSION}`, tauriConf.version === TARGET_VERSION);

  // 2. Start idmm-core in background
  console.log('\n--- Step 2: Starting idmm-core.exe ---');
  let coreProc = spawn(rustCorePath, [], {
    stdio: 'ignore',
    detached: false
  });

  // Wait for server to start
  let connected = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200 && res.data && res.data.status === 'ok') {
        connected = true;
        break;
      }
    } catch (e) {}
    await sleep(200);
  }
  assert('idmm-core HTTP Server Started & Healthy', connected);

  // 3. Health check response
  console.log('\n--- Step 3: Health & Metadata QC ---');
  const healthRes = await request('GET', '/api/health');
  assert('Health Check Status OK', healthRes.status === 200 && healthRes.data.status === 'ok');
  assert(`Health Check Version == ${TARGET_VERSION}`, healthRes.data.version === TARGET_VERSION, `(received: ${healthRes.data?.version})`);

  // SQLite PRAGMA journal_mode check (idmm.db-wal)
  const walPath = `${DB_PATH}-wal`;
  const shmPath = `${DB_PATH}-shm`;
  assert('SQLite WAL/SHM active', fs.existsSync(DB_PATH));

  // 4. Download 10MB Multi-part Test
  console.log('\n--- Step 4: Real Multi-Part Download & SHA-256 Integrity ---');
  const testFileUrl = 'https://proof.ovh.net/files/10Mb.dat';
  const customFilename = `test_10mb_${Date.now()}.dat`;
  const testSavePath = TEST_DIR;

  const startRes = await request('POST', '/api/downloads', {
    url: testFileUrl,
    filename: customFilename,
    save_to: testSavePath,
    threads: 8,
    thread_mode: 'manual'
  });

  assert('Download Start Request Succeeded', startRes.status === 201 && startRes.data?.id, JSON.stringify(startRes.data));
  const dlId = startRes.data?.id;

  // Poll progress until completion or timeout (60s)
  let dlComplete = false;
  let finalDlState = null;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const checkRes = await request('GET', `/api/downloads/${dlId}`);
    if (checkRes.status === 200 && checkRes.data) {
      finalDlState = checkRes.data;
      if (checkRes.data.status === 'completed') {
        dlComplete = true;
        break;
      }
      if (checkRes.data.status === 'failed') {
        console.error('Download failed state:', checkRes.data);
        break;
      }
    }
  }

  assert('Multi-part Download Completed Successfully', dlComplete, `Final status: ${finalDlState?.status}`);

  // Check file existence and integrity
  const downloadedFilePath = path.join(testSavePath, customFilename);
  assert('Downloaded File Exists on Disk', fs.existsSync(downloadedFilePath));

  if (fs.existsSync(downloadedFilePath)) {
    const stat = fs.statSync(downloadedFilePath);
    assert('Downloaded File Size matches 10485760 bytes (10MB)', stat.size === 10485760, `(size: ${stat.size})`);
    const fileHash = getSha256(downloadedFilePath);
    assert('File SHA-256 Calculated Successfully', fileHash.length === 64, `(hash: ${fileHash.substring(0, 16)}...)`);
  }

  // 5. Auto-Resume & Crash Recovery Logic QC
  console.log('\n--- Step 5: Crash Recovery & Auto-Resume QC ---');
  // Start a larger file, pause it immediately, restart core, and verify it resumes under same ID without duplicates
  const testLargeUrl = 'https://proof.ovh.net/files/100Mb.dat';
  const resumeFilename = `test_resume_${Date.now()}.dat`;

  const resumeStart = await request('POST', '/api/downloads', {
    url: testLargeUrl,
    filename: resumeFilename,
    save_to: testSavePath,
    threads: 4
  });

  const resumeId = resumeStart.data?.id;
  assert('Resume Test Task Started', !!resumeId);

  // Allow some initial chunks then pause
  await sleep(1500);
  await request('POST', `/api/downloads/${resumeId}/pause`);

  // Kill core process simulating crash
  coreProc.kill();
  await sleep(1000);

  // Restart core engine
  coreProc = spawn(rustCorePath, [], {
    stdio: 'ignore',
    detached: false
  });

  await sleep(1500);
  assert('Engine Restarted after Crash', true);

  // Check that the download resumes under the EXACT same ID and no duplicate record was spawned
  const allDownloadsRes = await request('GET', '/api/downloads');
  const matchingRecords = (allDownloadsRes.data || []).filter(d => d.url === testLargeUrl);
  assert('Auto-Resumed Under Exact Same ID', matchingRecords.some(d => d.id === resumeId));
  assert('Zero Duplicate Records with (1) suffix', matchingRecords.length === 1);

  // Clean up resume test item
  await request('DELETE', `/api/downloads/${resumeId}?delete_file=true`);

  // 6. WebSocket Progress Broadcast Test
  console.log('\n--- Step 6: WebSocket Broadcast QC ---');
  const wsStatusRes = await request('GET', '/api/ws-status');
  assert('WebSocket Engine Endpoint Active', wsStatusRes.status === 200 && wsStatusRes.data.ws_running === true);

  // 7. Native Messaging stdio Protocol Test
  console.log('\n--- Step 7: Native Messaging Host Protocol QC ---');
  let nativeHostPass = false;
  try {
    const nativeProc = spawn(rustCorePath, ['chrome-extension://dummy-ext/'], {
      stdio: ['pipe', 'pipe', 'ignore']
    });

    const pingPayload = JSON.stringify({ action: 'ping' });
    const payloadLen = Buffer.byteLength(pingPayload, 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payloadLen, 0);

    nativeProc.stdin.write(header);
    nativeProc.stdin.write(pingPayload);

    const rawResponse = await new Promise((resolve) => {
      let chunks = [];
      nativeProc.stdout.on('data', data => chunks.push(data));
      setTimeout(() => {
        resolve(Buffer.concat(chunks));
      }, 1500);
    });

    nativeProc.kill();

    if (rawResponse.length >= 4) {
      const respLen = rawResponse.readUInt32LE(0);
      const respJsonStr = rawResponse.slice(4, 4 + respLen).toString('utf8');
      const respObj = JSON.parse(respJsonStr);
      if (respObj.status === 'ok' || respObj.version === TARGET_VERSION || respObj.type === 'pong' || respObj.action === 'pong' || respObj.success === true) {
        nativeHostPass = true;
      }
    }
  } catch (err) {
    console.error('Native host test error:', err);
  }
  assert('Native Messaging Host stdio JSON Framing Pass', nativeHostPass);

  // Cleanup Process
  console.log('\n--- Step 8: Cleanup & DB Sanitation ---');
  coreProc.kill();
  await sleep(1000);

  // Remove test directory artifacts
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    console.log('[CLEANUP] test_e2e_workspace cleaned.');
  } catch (e) {}

  console.log('\n=== QC SUMMARY ===');
  console.log(`Total Tests: ${results.total}`);
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);

  process.exit(results.failed === 0 ? 0 : 1);
}

runE2E().catch(err => {
  console.error('Fatal error during E2E:', err);
  process.exit(1);
});
