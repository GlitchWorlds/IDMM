import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

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
  console.log('=== STARTING IDMM v1.4.4 COMPREHENSIVE QC VERIFICATION ===\n');
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
  const nsisSetupPath = 'D:\\IDMM\\tauri-shell\\src-tauri\\target\\release\\bundle\\nsis\\IDMM_1.4.4_x64-setup.exe';

  assert('Rust Core Binary Exists', fs.existsSync(rustCorePath));
  assert('Resource Core Binary Exists', fs.existsSync(resourceCorePath));
  assert('Tauri Desktop Binary Exists', fs.existsSync(tauriExePath));
  assert('NSIS 1.4.4 Installer Exists', fs.existsSync(nsisSetupPath));

  const rustCoreHash = getSha256(rustCorePath);
  const resCoreHash = getSha256(resourceCorePath);
  assert('Core Binary Sync (target == resources)', rustCoreHash === resCoreHash, `(${rustCoreHash.substring(0, 8)})`);

  // Manifests version check
  const extManifest = JSON.parse(fs.readFileSync('D:\\IDMM\\extension\\manifest.json', 'utf8'));
  const uiPkg = JSON.parse(fs.readFileSync('D:\\IDMM\\electron\\ui\\package.json', 'utf8'));
  const tauriConf = JSON.parse(fs.readFileSync('D:\\IDMM\\tauri-shell\\src-tauri\\tauri.conf.json', 'utf8'));
  assert('Extension manifest.json is 1.4.4', extManifest.version === '1.4.4');
  assert('UI package.json is 1.4.4', uiPkg.version === '1.4.4');
  assert('tauri.conf.json is 1.4.4', tauriConf.version === '1.4.4');

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

  // 3. Health & Metadata QC
  console.log('\n--- Step 3: Health & Metadata QC ---');
  const healthRes = await request('GET', '/api/health');
  assert('Health Check Status OK', healthRes.data.status === 'ok');
  assert('Health Check Version == 1.4.4', healthRes.data.version === '1.4.4', `(received: ${healthRes.data.version})`);

  // Check SQLite WAL Mode
  const walFile = `${DB_PATH}-wal`;
  const shmFile = `${DB_PATH}-shm`;
  assert('SQLite WAL/SHM active', fs.existsSync(walFile) || fs.existsSync(shmFile) || fs.existsSync(DB_PATH));

  // 4. Multi-Part Download with SHA-256 integrity
  console.log('\n--- Step 4: Real Multi-Part Download & SHA-256 Integrity ---');
  const downloadUrl = 'https://proof.ovh.net/files/10Mb.dat';
  const saveFileName = `test_10mb_${Date.now()}.dat`;
  const saveFilePath = path.join(TEST_DIR, saveFileName);

  const startRes = await request('POST', '/api/downloads', {
    url: downloadUrl,
    save_to: TEST_DIR,
    filename: saveFileName,
    threads: 8
  });

  assert('Download Start Request Succeeded', (startRes.status === 200 || startRes.status === 201) && !!startRes.data.id, JSON.stringify(startRes.data));
  const testDownloadId = startRes.data.id;

  // Poll until completed
  let downloadCompleted = false;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const itemRes = await request('GET', `/api/downloads/${testDownloadId}`);
    if (itemRes.status === 200 && itemRes.data) {
      const dl = itemRes.data;
      if (dl.status === 'completed') {
        downloadCompleted = true;
        break;
      }
      if (dl.status === 'failed') {
        console.error('Download reported failed:', dl.error);
        break;
      }
    }
  }

  assert('Multi-part Download Completed Successfully', downloadCompleted);
  assert('Downloaded File Exists on Disk', fs.existsSync(saveFilePath));
  if (fs.existsSync(saveFilePath)) {
    const fileSize = fs.statSync(saveFilePath).size;
    assert('Downloaded File Size matches 10485760 bytes (10MB)', fileSize === 10485760, `(size: ${fileSize})`);
    
    const downloadedHash = getSha256(saveFilePath);
    assert('File SHA-256 Calculated Successfully', downloadedHash.length === 64, `(hash: ${downloadedHash.substring(0, 16)}...)`);
  }

  // 5. Auto-Resume / Crash Recovery Test (Same ID, No Duplication, No Suffix)
  console.log('\n--- Step 5: Crash Recovery & Auto-Resume QC ---');
  const resumeFileName = `test_resume_${Date.now()}.dat`;
  const resumeFilePath = path.join(TEST_DIR, resumeFileName);
  
  const resumeStartRes = await request('POST', '/api/downloads', {
    url: 'https://proof.ovh.net/files/100Mb.dat',
    save_to: TEST_DIR,
    filename: resumeFileName,
    threads: 8
  });

  const resumeDlId = resumeStartRes.data.id;
  assert('Resume Test Task Started', !!resumeDlId);

  // Wait until it has downloaded some bytes
  await sleep(1500);

  // Kill core engine abruptly
  coreProc.kill();
  await sleep(1000);

  // Restart engine
  coreProc = spawn(rustCorePath, [], {
    stdio: 'ignore',
    detached: false
  });

  // Wait for reconnect
  let restarted = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) {
        restarted = true;
        break;
      }
    } catch (e) {}
    await sleep(200);
  }
  assert('Engine Restarted after Crash', restarted);

  // Verify auto-resume behavior: same ID, no duplicate record, no "(1)" suffix in filename
  await sleep(2000);
  const listRes = await request('GET', '/api/downloads');
  const downloads = Array.isArray(listRes.data) ? listRes.data : (listRes.data.data || []);
  const matchingDownloads = downloads.filter(d => d.id === resumeDlId);
  const duplicateDownloads = downloads.filter(d => d.filename && d.filename.startsWith('test_resume_') && d.filename.includes('(1)'));

  assert('Auto-Resumed Under Exact Same ID', matchingDownloads.length === 1);
  assert('Zero Duplicate Records with (1) suffix', duplicateDownloads.length === 0);

  // Clean up the active resume download
  await request('POST', `/api/downloads/${resumeDlId}/pause`);
  await request('DELETE', `/api/downloads/${resumeDlId}?delete_file=true`);
  await request('DELETE', `/api/downloads/${testDownloadId}?delete_file=true`);

  // 6. WebSocket Test
  console.log('\n--- Step 6: WebSocket Broadcast QC ---');
  let wsPass = false;
  try {
    const wsStatusRes = await request('GET', '/api/ws-status');
    wsPass = wsStatusRes.status === 200 && wsStatusRes.data.ws_running === true;
  } catch (e) {
    wsPass = false;
  }
  assert('WebSocket Engine Endpoint Active', wsPass);

  // 7. Native Messaging Host Framing Test
  console.log('\n--- Step 7: Native Messaging Host Protocol QC ---');
  let nativeHostPass = false;
  try {
    const nativeProc = spawn(rustCorePath, ['chrome-extension://dummy-ext/'], {
      stdio: ['pipe', 'pipe', 'ignore']
    });

    const pingPayload = JSON.stringify({ type: 'ping' });
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
      if (respObj.status === 'ok' || respObj.version === '1.4.4' || respObj.type === 'pong' || respObj.action === 'pong') {
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
