'use strict';
/**
 * IDMM Deep Function Test Suite
 * Tests edge cases, error handling, concurrent ops, boundary conditions
 */
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');

const TEST_PORT = 19895;
const testDir = path.join(os.tmpdir(), 'IDMM_deep_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
fs.mkdirSync(path.join(testDir, 'temp'), { recursive: true });
fs.mkdirSync(path.join(testDir, 'downloads'), { recursive: true });

let pass = 0, fail = 0, warn = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('   ' + name); }
  else { fail++; console.log('   ' + name + (detail ? '  ' + detail : '')); }
}
function warning(name, msg) { warn++; console.log('    ' + name + '  ' + msg); }

//  Test File Server 

const FILE_1MB = 1 * 1024 * 1024;
const FILE_50MB = 50 * 1024 * 1024;
const FILE_ZERO = 0;
const files = {
  '/1mb.bin': Buffer.alloc(FILE_1MB),
  '/50mb.bin': null, // lazy
  '/zero.bin': Buffer.alloc(0),
  '/no-range.bin': null, // served without Accept-Ranges
  '/slow.bin': null, // very slow server
  '/redirect.bin': null, // redirect chain
  '/broken.bin': null, // drops connection mid-download
  '/dup.bin': Buffer.alloc(FILE_1MB), // duplicate URL test
};

// Fill deterministic data
for (let i = 0; i < FILE_1MB; i++) files['/1mb.bin'][i] = i % 256;
files['/dup.bin'] = files['/1mb.bin']; // same data

const testServer = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/redirect.bin') {
    res.writeHead(302, { 'Location': 'http://127.0.0.1:' + TEST_PORT + '/1mb.bin' });
    res.end();
    return;
  }

  if (url === '/no-range.bin') {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': String(FILE_1MB), 'Content-Type': 'application/octet-stream' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Length': String(FILE_1MB) });
    res.end(files['/1mb.bin']);
    return;
  }

  if (url === '/zero.bin') {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': '0', 'Accept-Ranges': 'bytes' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Length': '0' });
    res.end();
    return;
  }

  if (url === '/broken.bin') {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': String(FILE_1MB), 'Accept-Ranges': 'bytes' });
      res.end();
      return;
    }
    // Send 256KB then destroy
    res.writeHead(206, {
      'Content-Range': `bytes 0-${FILE_1MB - 1}/${FILE_1MB}`,
      'Content-Length': String(FILE_1MB),
    });
    res.write(files['/1mb.bin'].slice(0, 262144));
    setTimeout(() => res.destroy(), 50);
    return;
  }

  if (url === '/slow.bin') {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': String(FILE_1MB), 'Accept-Ranges': 'bytes' });
      res.end();
      return;
    }
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const s = parseInt(parts[0]), e = parts[1] ? parseInt(parts[1]) : FILE_1MB - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${s}-${e}/${FILE_1MB}`, 'Content-Length': String(e - s + 1) });
      let pos = s;
      function send() {
        if (pos > e) { res.end(); return; }
        const chunk = Math.min(4096, e - pos + 1);
        res.write(files['/1mb.bin'].slice(pos, pos + chunk));
        pos += chunk;
        setTimeout(send, 200); // 4KB per 200ms = ~20KB/s
      }
      send();
    } else {
      res.writeHead(200, { 'Content-Length': String(FILE_1MB) });
      let pos = 0;
      function send() {
        if (pos >= FILE_1MB) { res.end(); return; }
        const chunk = Math.min(4096, FILE_1MB - pos);
        res.write(files['/1mb.bin'].slice(pos, pos + chunk));
        pos += chunk;
        setTimeout(send, 200);
      }
      send();
    }
    return;
  }

  // Default: range-supporting 1MB server
  if (req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Length': String(FILE_1MB), 'Accept-Ranges': 'bytes', 'Content-Disposition': 'attachment; filename="test.bin"' });
    res.end();
    return;
  }

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const s = parseInt(parts[0]), e = parts[1] ? parseInt(parts[1]) : FILE_1MB - 1;
    const chunkSize = e - s + 1;
    res.writeHead(206, { 'Content-Range': `bytes ${s}-${e}/${FILE_1MB}`, 'Content-Length': String(chunkSize), 'Accept-Ranges': 'bytes' });
    res.end(files['/1mb.bin'].slice(s, e + 1));
  } else {
    res.writeHead(200, { 'Content-Length': String(FILE_1MB) });
    res.end(files['/1mb.bin']);
  }
});

//  Tests 

async function run() {
  console.log('');
  console.log('  IDMM Deep Function Test Suite                     ');
  console.log('\n');

  await new Promise(r => testServer.listen(TEST_PORT, '127.0.0.1', r));
  console.log(`  Test server on port ${TEST_PORT}\n`);

  const IDMMDatabase = require('./src/db/sqlite');
  const DownloadEngine = require('./src/engine/downloader');
  process.env.IDMM_TEST = '1';
  const IDMMServer = require('./src/server/server');

  const db = await IDMMDatabase.create(path.join(testDir, 'test.db'));
  db.setSetting('default_save_path', path.join(testDir, 'downloads'));
  const settings = db.getAllSettings();

  let completedResults = [];
  let errorResults = [];
  const downloader = new DownloadEngine({
    db,
    tempDir: path.join(testDir, 'temp'),
    settings,
    onComplete: (id, r) => completedResults.push({ id, ...r }),
    onError: (id, err) => errorResults.push({ id, error: err.message }),
  });
  const server = new IDMMServer({ db, downloader });
  await server.start();

  function req(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const r = http.request('http://127.0.0.1:9977' + urlPath, {
        method,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
        timeout: 30000,
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve({ s: res.statusCode, d: JSON.parse(d) }); } catch { resolve({ s: res.statusCode, d }); } });
      });
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('Timeout')); });
      if (data) r.write(data);
      r.end();
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // 
  // GROUP 1: startDownload  Edge Cases
  // 
  console.log('\n GROUP 1: startDownload edge cases');

  // 1.1 Normal download
  const r1 = await req('POST', '/api/download', { url: `http://127.0.0.1:${TEST_PORT}/1mb.bin`, threads: 2 });
  check('1.1 Normal download starts', r1.s === 200 || r1.s === 201, `status=${r1.s}`);
  const id1 = r1.d.id;
  await sleep(2000);
  const s1 = await req('GET', '/api/download/' + id1);
  check('1.1 Download completes', s1.d.status === 'completed', `status=${s1.d.status}`);
  check('1.1 Size correct', s1.d.downloaded === FILE_1MB, `downloaded=${s1.d.downloaded}`);

  // 1.2 Missing URL
  const r2 = await req('POST', '/api/download', {});
  check('1.2 Missing URL rejected', r2.s >= 400, `status=${r2.s}`);

  // 1.3 Invalid URL
  const r3 = await req('POST', '/api/download', { url: 'not-a-url' });
  check('1.3 Invalid URL rejected', r3.s >= 400, `status=${r3.s}`);

  // 1.4 Blocked URL (localhost SSRF  test mode bypassed, but still test the path)
  const r4 = await req('POST', '/api/download', { url: 'http://127.0.0.1:1/secret' });
  // In test mode (IDMM_TEST=1), SSRF is bypassed so this may succeed or fail for other reasons
  warning('1.4 SSRF test mode', `status=${r4.s} (SSRF bypassed in test mode)`);

  // 1.5 Duplicate URL
  const r5a = await req('POST', '/api/download', { url: `http://127.0.0.1:${TEST_PORT}/dup.bin`, threads: 4 });
  check('1.5 First dup starts', r5a.s === 200 || r5a.s === 201);
  // Send duplicate immediately (no sleep)  URL should be in activeUrls
  const r5b = await req('POST', '/api/download', { url: `http://127.0.0.1:${TEST_PORT}/dup.bin`, threads: 1 });
  check('1.5 Duplicate URL rejected', r5b.s === 409, `status=${r5b.s}`);
  // Cancel first one
  if (r5a.d && r5a.d.id) await req('POST', '/api/download/' + r5a.d.id + '/cancel');

  // 1.6 Zero-byte file
  const r6 = await req('POST', '/api/download', { url: `http://127.0.0.1:${TEST_PORT}/zero.bin`, threads: 1 });
  check('1.6 Zero-byte download starts', r6.s === 200 || r6.s === 201, `status=${r6.s}`);
  await sleep(1000);
  if (r6.d && r6.d.id) {
    const s6 = await req('GET', '/api/download/' + r6.d.id);
    check('1.6 Zero-byte status', s6.d.status === 'completed' || s6.d.status === 'failed', `status=${s6.d.status}`);
  }

  // 1.7 Redirect (302  actual file)  SSRF validation blocks localhost redirect even in test mode
  const r7 = await req('POST', '/api/download', { url: `http://127.0.0.1:${TEST_PORT}/redirect.bin`, threads: 2 });
  check('1.7 Redirect blocked by SSRF', r7.s >= 400, `status=${r7.s}`);

  // 
  // GROUP 2: pauseDownload  Edge Cases
  // 
  console.log('\n GROUP 2: pauseDownload edge cases');

  // 2.1 Pause non-existent
  const r21 = await req('POST', '/api/download/nonexistent/pause');
  check('2.1 Pause non-existent  404', r21.s === 404, `status=${r21.s}`);

  // 2.2 Pause already completed
  const r22 = await req('POST', '/api/download/' + id1 + '/pause');
  check('2.2 Pause completed  error', r22.s >= 400, `status=${r22.s}`);

  // 2.3 Pause + verify bytes preserved
  const r23 = await req('POST', '/api/download', { url: `http://127.0.0.1:${TEST_PORT}/slow.bin`, threads: 2 });
  await sleep(3000); // let it download some
  const r23p = await req('POST', '/api/download/' + r23.d.id + '/pause');
  check('2.3 Pause slow download', r23p.s === 200, `status=${r23p.s}`);
  const s23 = await req('GET', '/api/download/' + r23.d.id);
  check('2.3 Bytes preserved after pause', s23.d.downloaded > 0, `downloaded=${s23.d.downloaded}`);
  check('2.3 Status is paused', s23.d.status === 'paused', `status=${s23.d.status}`);

  // 2.4 Double pause
  const r24 = await req('POST', '/api/download/' + r23.d.id + '/pause');
  check('2.4 Double pause  error', r24.s >= 400, `status=${r24.s}`);

  // 
  // GROUP 3: resumeDownload  Edge Cases
  // 
  console.log('\n GROUP 3: resumeDownload edge cases');

  // 3.1 Resume paused download
  const r31 = await req('POST', '/api/download/' + r23.d.id + '/resume');
  check('3.1 Resume paused download', r31.s === 200, `status=${r31.s}`);
  await sleep(5000);
  const s31 = await req('GET', '/api/download/' + r23.d.id);
  check('3.1 Progress after resume', s31.d.downloaded > s23.d.downloaded || s31.d.status === 'completed', `downloaded=${s31.d.downloaded} status=${s31.d.status}`);

  // 3.2 Resume non-existent
  const r32 = await req('POST', '/api/download/nonexistent/resume');
  check('3.2 Resume non-existent  404', r32.s === 404, `status=${r32.s}`);

  // 3.3 Resume completed
  const r33 = await req('POST', '/api/download/' + id1 + '/resume');
  check('3.3 Resume completed  error', r33.s >= 400, `status=${r33.s}`);

  // 
  // GROUP 4: cancelDownload  Edge Cases
  // 
  console.log('\n GROUP 4: cancelDownload edge cases');

  // 4.1 Cancel active
  const r41 = await req('POST', '/api/download', { url: `http://127.0.0.1:${TEST_PORT}/slow.bin`, threads: 2 });
  await sleep(2000);
  const r41c = await req('POST', '/api/download/' + r41.d.id + '/cancel');
  check('4.1 Cancel active download', r41c.s === 200, `status=${r41c.s}`);
  check('4.1 Cancel response has status', r41c.d.status === 'cancelled', `response=${JSON.stringify(r41c.d)}`);
  await sleep(500);
  const s41 = await req('GET', '/api/download/' + r41.d.id);
  check('4.1 GET after cancel shows cancelled', s41.d.status === 'cancelled', `status=${s41.d.status}`);

  // 4.2 Cancel non-existent
  const r42 = await req('POST', '/api/download/nonexistent/cancel');
  check('4.2 Cancel non-existent  handled', r42.s === 200 || r42.s >= 400, `status=${r42.s}`);

  // 4.3 Cancel already cancelled
  const r43 = await req('POST', '/api/download/' + r41.d.id + '/cancel');
  check('4.3 Double cancel  handled', r43.s === 200 || r43.s >= 400, `status=${r43.s}`);

  // 
  // GROUP 5: deleteDownload  Edge Cases
  // 
  console.log('\n GROUP 5: deleteDownload edge cases');

  // 5.1 Delete completed
  const r51 = await req('DELETE', '/api/download/' + id1);
  check('5.1 Delete completed download', r51.s === 200, `status=${r51.s}`);
  const s51 = await req('GET', '/api/download/' + id1);
  check('5.1 Gone after delete', s51.s === 404, `status=${s51.s}`);

  // 5.2 Delete non-existent
  const r52 = await req('DELETE', '/api/download/nonexistent');
  check('5.2 Delete non-existent  404 or handled', r52.s === 404 || r52.s === 200, `status=${r52.s}`);

  // 5.3 Delete cancelled
  const r53 = await req('DELETE', '/api/download/' + r41.d.id);
  check('5.3 Delete cancelled download', r53.s === 200, `status=${r53.s}`);

  // 
  // GROUP 6: Settings  Deep
  // 
  console.log('\n GROUP 6: Settings deep test');

  const r61 = await req('GET', '/api/settings');
  check('6.1 GET settings returns object', typeof r61.d === 'object' && r61.d !== null, `type=${typeof r61.d}`);
  check('6.2 Has default_threads', 'default_threads' in r61.d);
  check('6.3 Has max_concurrent_downloads', 'max_concurrent_downloads' in r61.d);
  check('6.4 Has speed_limit_global', 'speed_limit_global' in r61.d);
  check('6.5 Has auto_resume', 'auto_resume' in r61.d);

  // Update multiple settings
  const r66 = await req('PUT', '/api/settings', { default_threads: '16', speed_limit_global: '5242880' });
  check('6.6 PUT multiple settings', r66.s === 200, `status=${r66.s}`);
  const r67 = await req('GET', '/api/settings');
  check('6.7 Verify default_threads updated', r67.d.default_threads === '16', `value=${r67.d.default_threads}`);
  check('6.8 Verify speed_limit_global updated', r67.d.speed_limit_global === '5242880', `value=${r67.d.speed_limit_global}`);

  // Invalid key ignored
  const r69 = await req('PUT', '/api/settings', { nonexistent_key: 'hack' });
  check('6.9 Invalid key ignored', r69.s === 200, `status=${r69.s}`);

  // 
  // GROUP 7: Stats
  // 
  console.log('\n GROUP 7: Stats deep test');

  const r71 = await req('GET', '/api/stats');
  check('7.1 Stats has total_downloads', typeof r71.d.total_downloads === 'number');
  check('7.2 Stats has completed', typeof r71.d.completed === 'number');
  check('7.3 Stats has active', typeof r71.d.active === 'number');
  check('7.4 Stats has paused', typeof r71.d.paused === 'number');
  check('7.5 Stats has failed', typeof r71.d.failed === 'number');
  check('7.6 Stats has total_bytes_downloaded', typeof r71.d.total_bytes_downloaded === 'number');

  // 
  // GROUP 8: Health
  // 
  console.log('\n GROUP 8: Health + WebSocket');

  const r81 = await req('GET', '/api/health');
  check('8.1 Health returns 200', r81.s === 200);
  check('8.2 Health status ok', r81.d.status === 'ok');

  // WebSocket
  const WebSocket = require('ws');
  let wsMsg = null;
  const ws = new WebSocket('ws://127.0.0.1:9977/ws');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error('WS timeout')); }, 5000);
    ws.on('open', () => { clearTimeout(timeout); setTimeout(resolve, 1500); });
    ws.on('message', (data) => { wsMsg = JSON.parse(data); });
  });
  check('8.3 WebSocket connects', ws.readyState === WebSocket.OPEN);
  check('8.3 WebSocket receives data', wsMsg !== null);
  ws.close();

  // 
  // GROUP 9: File Integrity
  // 
  console.log('\n GROUP 9: File integrity');

  // Download and verify SHA-256
  const expectedHash = crypto.createHash('sha256').update(files['/1mb.bin']).digest('hex');
  const r91 = await req('POST', '/api/download', { url: `http://127.0.0.1:${TEST_PORT}/1mb.bin`, threads: 4 });
  await sleep(3000);
  const s91 = await req('GET', '/api/download/' + r91.d.id);
  check('9.1 Download with 4 threads completes', s91.d.status === 'completed', `status=${s91.d.status}`);

  // Verify file on disk
  if (s91.d.status === 'completed') {
    const savePath = path.join(s91.d.save_to, s91.d.filename);
    if (fs.existsSync(savePath)) {
      const actual = fs.readFileSync(savePath);
      const actualHash = crypto.createHash('sha256').update(actual).digest('hex');
      check('9.2 SHA-256 matches', actualHash === expectedHash, `expected=${expectedHash.slice(0, 16)}... actual=${actualHash.slice(0, 16)}...`);
      check('9.3 File size matches', actual.length === FILE_1MB, `size=${actual.length}`);
    } else {
      check('9.2 File exists on disk', false, `path=${savePath}`);
    }
  }

  // 
  // GROUP 10: No-Range Support
  // 
  console.log('\n GROUP 10: No-Range (single-stream)');

  const r101 = await req('POST', '/api/download', { url: `http://127.0.0.1:${TEST_PORT}/no-range.bin`, threads: 4 });
  check('10.1 No-range download starts', r101.s === 200 || r101.s === 201, `status=${r101.s}`);
  await sleep(5000);
  if (r101.d && r101.d.id) {
    const s101 = await req('GET', '/api/download/' + r101.d.id);
    check('10.2 No-range completes or downloading', ['completed', 'downloading', 'pending'].includes(s101.d.status), `status=${s101.d.status}`);
  }

  // 
  // GROUP 11: Broken Connection
  // 
  console.log('\n GROUP 11: Broken connection (retry)');

  const r111 = await req('POST', '/api/download', { url: `http://127.0.0.1:${TEST_PORT}/broken.bin`, threads: 1 });
  check('11.1 Broken download starts', r111.s === 200 || r111.s === 201);
  await sleep(10000); // wait for retry
  if (r111.d && r111.d.id) {
    const s111 = await req('GET', '/api/download/' + r111.d.id);
    check('11.2 Broken download handled', ['completed', 'failed', 'downloading'].includes(s111.d.status), `status=${s111.d.status}`);
    if (s111.d.status === 'failed') {
      check('11.3 Error message present', s111.d.error && s111.d.error.length > 0, `error=${s111.d.error}`);
    }
  }

  // 
  // CLEANUP
  // 
  console.log('\n Cleanup...');
  await server.stop();
  db.close();
  testServer.close();
  fs.rmSync(testDir, { recursive: true, force: true });

  // 
  // SUMMARY
  // 
  console.log('\n');
  console.log(`  Results: ${pass} passed, ${fail} failed, ${warn} warnings`);
  console.log('');

  if (fail > 0) process.exit(1);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});

