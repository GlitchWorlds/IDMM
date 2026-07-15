# IDMAM — Complete Function List

> Generated: 2026-07-15 | Source: `D:\IDMAM\app\src\`, `main.js`, `test.js`

---

## 1. engine/downloader.js — `DownloadManager` Class

| # | Function | Line | Signature | Description | Dependencies |
|---|----------|------|-----------|-------------|--------------|
| 1 | `constructor` | 33 | `constructor({ db, tempDir, settings?, onProgress?, onComplete?, onError? })` → void | Initialize DownloadManager with DB, temp dir, settings, and callbacks. | `ResumeManager`, `new Map()` |
| 2 | `startDownload` | 62 | `async startDownload(params: { url, filename?, saveTo?, threads?, cookies?, referrer?, headers?, checksum? })` → `Promise<Object>` | Probe URL, resolve filename, create DB record, and start chunked or single-stream download. | `_probeUrl`, `resolveFilename`, `ensureUniqueFilename`, `detectMime`, `resolveCategory`, `db.createDownload`, `resume.getDownloadTempDir`, `_startChunkedDownload`, `_startSingleStreamDownload` |
| 3 | `pauseDownload` | 145 | `pauseDownload(downloadId: string)` → `Object` | Pause an active download — flush chunk state, terminate workers, persist resume state. | `_flushChunkState`, `db.updateDownload`, `resume.saveState` |
| 4 | `resumeDownload` | 181 | `async resumeDownload(downloadId: string)` → `Promise<Object>` | Resume a paused download from DB + resume file + disk cross-validated state. | `db.getDownloadWithChunks`, `resume.loadState`, `_buildResumeChunks`, `db.updateDownload`, `_resumeChunkedDownload`, `_resumeSingleStreamDownload` |
| 5 | `cancelDownload` | 242 | `cancelDownload(downloadId: string)` → `Object` | Cancel a download, terminate workers, cleanup temp files, update DB. | `resume.cleanup`, `db.updateDownload` |
| 6 | `deleteDownload` | 265 | `deleteDownload(downloadId: string)` → `Object` | Delete download record, output file, and temp files. | `cancelDownload`, `db.getDownload`, `resume.cleanup`, `db.deleteDownload` |
| 7 | `getDownloadState` | 287 | `getDownloadState(downloadId: string)` → `Object\|null` | Get real-time download state (active memory or DB fallback). | `_formatState`, `db.getDownloadWithChunks` |
| 8 | `getActiveStates` | 323 | `getActiveStates()` → `Object[]` | Get states of all active downloads for WebSocket broadcast. | `_formatState` |
| 9 | `getActiveCount` | 331 | `getActiveCount()` → `number` | Get count of currently active downloads. | — |
| 10 | `_probeUrl` | 338 | `_probeUrl(url: string, headers?: Object, redirectCount?: number)` → `Promise<Object>` | HEAD request to probe file size, Range support, content type, and redirects (max 5). | `_probeUrl` (recursive) |
| 11 | `_startChunkedDownload` | 394 | `async _startChunkedDownload(state: Object, opts: Object)` → `Promise<void>` | Split file into chunks, save to DB/resume, and spawn worker threads. | `db.createChunks`, `resume.saveState`, `_spawnWorkers` |
| 12 | `_spawnWorkers` | 426 | `_spawnWorkers(state: Object, opts: Object)` → void | Spawn worker threads for all pending/incomplete chunks; finalize if all done. | `resume.getChunkPath`, `_spawnWorker`, `_finalizeDownload` |
| 13 | `_spawnWorker` | 462 | `_spawnWorker(state: Object, chunk: Object, chunkPath: string, opts: Object)` → void | Create a single Worker thread for one chunk, attach message/error/exit handlers. | `Worker`, `_handleWorkerMessage`, `_checkCompletion` |
| 14 | `_handleWorkerMessage` | 500 | `_handleWorkerMessage(state: Object, chunk: Object, msg: Object)` → void | Dispatch worker messages: progress, chunk_done, error (with noRangeSupport fallback), retry. | `_recalcProgress`, `resume.updateChunkState`, `db.getChunks`, `db.updateChunk`, `_cancelAllWorkers`, `_startSingleStreamDownload`, `_checkCompletion` |
| 15 | `_cancelAllWorkers` | 569 | `_cancelAllWorkers(state: Object)` → void | Terminate all active worker threads for a download. | — |
| 16 | `_buildResumeChunks` | 577 | `_buildResumeChunks(downloadId: string, dbDownload: Object)` → `Object[]` | Cross-reference DB, resume JSON, and .part file sizes to build accurate chunk descriptors. | `resume.loadState`, `resume.getChunkPath` |
| 17 | `_getPerWorkerSpeedLimit` | 620 | `_getPerWorkerSpeedLimit(state: Object)` → `number` | Calculate per-worker speed limit by dividing global limit across active workers. | — |
| 18 | `_flushChunkState` | 630 | `_flushChunkState(state: Object)` → void | Flush all chunk downloaded bytes to DB and resume file (reads actual file sizes from disk). | `resume.getChunkPath`, `db.getChunks`, `db.updateChunk`, `resume.updateChunkState` |
| 19 | `_startSingleStreamDownload` | 657 | `_startSingleStreamDownload(state: Object, opts: Object)` → `Promise<void>` | Download without Range support — single HTTP stream with resume-aware append. | `resume.getChunkPath`, `db.getChunks`, `db.createChunks`, `resume.saveState`, `_doSingleStream` |
| 20 | `_doSingleStream` | 694 | `_doSingleStream(state, opts, chunkPath, existingBytes, resolve, reject)` → void | Core single-stream HTTP GET with redirect handling, speed samples, and progress tracking. | `_recalcProgress`, `_finalizeDownload` |
| 21 | `_resumeSingleStreamDownload` | 758 | `async _resumeSingleStreamDownload(state: Object, opts: Object)` → `Promise<void>` | Resume a single-stream download from existing partial file. | `resume.getChunkPath`, `_doSingleStream` |
| 22 | `_resumeChunkedDownload` | 768 | `async _resumeChunkedDownload(state: Object, opts: Object)` → `Promise<void>` | Resume chunked download — validate chunks, reset corrupted ones, spawn workers. | `resume.validateChunks`, `_recalcProgress`, `_spawnWorkers` |
| 23 | `_recalcProgress` | 795 | `_recalcProgress(state: Object)` → void | Recalculate total downloaded, rolling speed (3s window), and ETA; persist to DB and notify. | `db.updateDownload`, `onProgress`, `_formatState` |
| 24 | `_checkCompletion` | 826 | `_checkCompletion(state: Object)` → void | Check if all chunks are done → finalize; if any failed and none downloading → mark failed. | `_finalizeDownload`, `db.updateDownload`, `onError` |
| 25 | `_finalizeDownload` | 849 | `async _finalizeDownload(state: Object)` → `Promise<void>` | Merge chunks → verify checksum → cleanup → update DB → notify completion. | `mergeAndVerify`, `db.updateDownload`, `resume.cleanup`, `onComplete`, `onError` |
| 26 | `_formatState` | 888 | `_formatState(state: Object)` → `Object` | Format download state into API/WebSocket response shape with progress, speed, ETA, chunk details. | — |

---

## 2. engine/chunk-worker.js — Worker Thread Functions

| # | Function | Line | Signature | Description | Dependencies |
|---|----------|------|-----------|-------------|--------------|
| 1 | `report` | 47 | `report(type: string, data: Object)` → void | Send a typed message from worker thread to main thread via parentPort. | `parentPort.postMessage` |
| 2 | `parseUrl` | 56 | `parseUrl(urlStr: string)` → `{ protocol, hostname, port, path, href }` | Parse a URL string into components for HTTP(S) request construction. | `URL` |
| 3 | `downloadChunk` | 69 | `downloadChunk(attempt: number, currentUrl: string)` → `Promise<void>` | Download a specific byte range via HTTP Range request with resume, redirect handling, and token-bucket speed limiting. | `parseUrl`, `report`, `downloadChunk` (recursive on redirect) |
| 4 | `main` | 171 | `async main()` → `Promise<void>` | Main worker entry — retry loop with exponential backoff, calls downloadChunk up to maxRetries times. | `downloadChunk`, `report` |

---

## 3. engine/merge.js — Merge & Verify Functions

| # | Function | Line | Signature | Description | Dependencies |
|---|----------|------|-----------|-------------|--------------|
| 1 | `mergeChunks` | 23 | `mergeChunks({ chunkPaths: string[], outputPath: string, totalSize: number, onProgress?: Function })` → `Promise<void>` | Sequentially merge all .part chunk files into a single output file with progress callback. | — |
| 2 | `cleanupChunks` | 72 | `cleanupChunks(chunkPaths: string[], stateFilePath?: string)` → void | Delete temporary .part chunk files after successful merge (best-effort). | — |
| 3 | `mergeAndVerify` | 87 | `async mergeAndVerify({ downloadId, chunkPaths, outputPath, totalSize, expectedChecksum?, cleanupAfter?, onProgress? })` → `Promise<{ success, checksum?, verified?, size }>` | Full pipeline: merge chunks → verify output size → optional SHA-256 checksum verification → cleanup. | `mergeChunks`, `hashFile`, `cleanupChunks` |

---

## 4. engine/resume.js — `ResumeManager` Class

| # | Function | Line | Signature | Description | Dependencies |
|---|----------|------|-----------|-------------|--------------|
| 1 | `constructor` | 21 | `constructor(tempDir: string)` → void | Initialize ResumeManager with base temp directory, ensure it exists. | `_ensureDir` |
| 2 | `_ensureDir` | 26 | `_ensureDir(dir: string)` → void | Create directory recursively if it doesn't exist. | — |
| 3 | `getDownloadTempDir` | 32 | `getDownloadTempDir(downloadId: string)` → `string` | Get the temp directory path for a specific download. | — |
| 4 | `getStateFilePath` | 41 | `getStateFilePath(downloadId: string)` → `string` | Get the path to a download's `download.json` state file. | `getDownloadTempDir` |
| 5 | `getChunkPath` | 50 | `getChunkPath(downloadId: string, chunkIndex: number)` → `string` | Get the path for a specific chunk's `.part` file (zero-padded index). | `getDownloadTempDir` |
| 6 | `saveState` | 59 | `saveState(state: Object)` → `Object` | Serialize and save download state to `download.json` with normalized fields. | `_ensureDir`, `getStateFilePath` |
| 7 | `loadState` | 102 | `loadState(downloadId: string)` → `Object\|null` | Load download state from `download.json` file, or null if not found. | `getStateFilePath` |
| 8 | `validateChunks` | 116 | `validateChunks(downloadId: string, chunks: Object[])` → `{ valid: boolean, chunks: Object[] }` | Validate chunk integrity — check .part file sizes match expected byte ranges. | `getChunkPath` |
| 9 | `cleanup` | 163 | `cleanup(downloadId: string)` → void | Delete all temp files and directory for a download. | `getDownloadTempDir` |
| 10 | `cleanupChunks` | 180 | `cleanupChunks(downloadId: string)` → void | Delete only `.part` files, keeping `download.json` for possible re-resume. | `getDownloadTempDir` |
| 11 | `findAllStateFiles` | 196 | `findAllStateFiles()` → `string[]` | Scan temp directory for all download IDs that have state files (for startup recovery). | `getStateFilePath` |
| 12 | `updateChunkState` | 213 | `updateChunkState(downloadId: string, chunkIndex: number, updates: { downloaded?, status? })` → void | Update a single chunk's state within the download.json file. | `loadState`, `saveState` |

---

## 5. server/server.js — `IDRAMServer` Class (API + WebSocket)

| # | Function | Line | Signature | Description | Dependencies |
|---|----------|------|-----------|-------------|--------------|
| 1 | `constructor` | 33 | `constructor({ db: Object, downloader: Object })` → void | Initialize Express app, setup middleware and routes. | `_setupMiddleware`, `_setupRoutes` |
| 2 | `_setupMiddleware` | 44 | `_setupMiddleware()` → void | Configure helmet, CORS (localhost + extensions), JSON parser, and in-memory rate limiter (100 req/min). | — |
| 3 | `_setupRoutes` | 92 | `_setupRoutes()` → void | Register all REST API routes: health, download CRUD, settings, stats. | — |
| 4 | `_setupWebSocket` | 208 | `_setupWebSocket()` → void | Create WebSocketServer on `/ws`, handle connections, broadcast progress every 500ms. | `WebSocketServer`, `downloader.getActiveStates` |
| 5 | `_isAllowedOrigin` | 247 | `_isAllowedOrigin(origin: string)` → `boolean` | Check if a WebSocket origin is in the localhost/extension whitelist. | — |
| 6 | `broadcast` | 257 | `broadcast(data: Object)` → void | Send a JSON message to all connected WebSocket clients. | — |
| 7 | `start` | 270 | `start()` → `Promise<void>` | Start HTTP server on `127.0.0.1:9977`, setup WebSocket, wire download callbacks to broadcasts. | `_setupWebSocket` |
| 8 | `stop` | 298 | `stop()` → `Promise<void>` | Graceful shutdown: clear broadcast timer, close all WebSocket connections, stop HTTP server. | — |

### API Routes (registered in `_setupRoutes`)

| Method | Path | Line | Description |
|--------|------|------|-------------|
| GET | `/api/health` | 98 | Health check — returns status, version, uptime |
| POST | `/api/download` | 102 | Start a new download — validates URL, checks concurrent limit |
| GET | `/api/downloads` | 134 | List all downloads — optional `?status=` filter, enriches with real-time state |
| GET | `/api/download/:id` | 160 | Get single download status |
| POST | `/api/download/:id/pause` | 170 | Pause an active download |
| POST | `/api/download/:id/resume` | 179 | Resume a paused download |
| POST | `/api/download/:id/cancel` | 189 | Cancel a download |
| DELETE | `/api/download/:id` | 198 | Delete download + files |
| GET | `/api/settings` | 207 | Get all settings |
| PUT | `/api/settings` | 214 | Update settings (whitelist-filtered) |
| GET | `/api/stats` | 245 | Download statistics |

---

## 6. db/sqlite.js — `IDMAMDatabase` Class

| # | Function | Line | Signature | Description | Dependencies |
|---|----------|------|-----------|-------------|--------------|
| 1 | `constructor` | 20 | `constructor(db: Object, dbPath: string)` → void | Initialize database instance, create tables, insert default settings, start auto-save interval. | `_initTables`, `_initSettings`, `save` |
| 2 | `create` (static) | 36 | `static async create(dbPath: string)` → `Promise<IDMAMDatabase>` | Async factory — load sql.js WASM, read or create database file, return instance. | `initSqlJs` |
| 3 | `save` | 55 | `save()` → void | Persist in-memory database to disk file. | — |
| 4 | `_markDirty` | 64 | `_markDirty()` → void | Flag database as having unsaved changes. | — |
| 5 | `_query` | 68 | `_query(sql: string, params?: any[])` → `Object[]` | Execute SELECT query and return array of row objects. | — |
| 6 | `_queryOne` | 84 | `_queryOne(sql: string, params?: any[])` → `Object\|null` | Execute query and return first row or null. | `_query` |
| 7 | `_run` | 90 | `_run(sql: string, params?: any[])` → void | Execute INSERT/UPDATE/DELETE statement, mark dirty. | `_markDirty` |
| 8 | `_initTables` | 100 | `_initTables()` → void | Create `downloads`, `chunks`, `settings` tables and indexes if not exist. | — |
| 9 | `_initSettings` | 131 | `_initSettings()` → void | Insert default settings (threads, paths, timeouts) if not present. | — |
| 10 | `createDownload` | 153 | `createDownload(download: Object)` → `Object` | Insert a new download record and return it. | `_run`, `getDownload` |
| 11 | `getDownload` | 171 | `getDownload(id: string)` → `Object\|null` | Get a single download by ID, parse JSON headers. | `_queryOne` |
| 12 | `listDownloads` | 178 | `listDownloads(status?: string)` → `Object[]` | List downloads, optionally filtered by status, ordered by created_at DESC. | `_query` |
| 13 | `updateDownload` | 193 | `updateDownload(id: string, fields: Object)` → void | Update allowed fields on a download record. | `_run` |
| 14 | `deleteDownload` | 220 | `deleteDownload(id: string)` → void | Delete download and its chunks (cascade). | `_run` |
| 15 | `createChunks` | 227 | `createChunks(downloadId: string, chunks: Object[])` → void | Insert chunk records for a download. | `_run` |
| 16 | `getChunks` | 236 | `getChunks(downloadId: string)` → `Object[]` | Get all chunks for a download, ordered by index. | `_query` |
| 17 | `updateChunk` | 243 | `updateChunk(chunkId: number, fields: Object)` → void | Update allowed fields on a chunk record. | `_run` |
| 18 | `getDownloadWithChunks` | 260 | `getDownloadWithChunks(id: string)` → `Object\|null` | Get download with embedded chunks array. | `getDownload`, `getChunks` |
| 19 | `getSetting` | 267 | `getSetting(key: string)` → `string\|null` | Get a single setting value by key. | `_queryOne` |
| 20 | `getSettingInt` | 272 | `getSettingInt(key: string, defaultValue?: number)` → `number` | Get a setting value as integer. | `getSetting` |
| 21 | `getAllSettings` | 277 | `getAllSettings()` → `Object` | Get all settings as key-value object. | `_query` |
| 22 | `setSetting` | 285 | `setSetting(key: string, value: any)` → void | Insert or replace a setting. | `_run` |
| 23 | `updateSettings` | 292 | `updateSettings(settings: Object)` → void | Batch update multiple settings. | `setSetting` |
| 24 | `getStats` | 298 | `getStats()` → `Object` | Get download statistics (total, completed, active, paused, failed, total bytes). | `_queryOne` |
| 25 | `getResumableDownloads` | 313 | `getResumableDownloads()` → `Object[]` | Get all downloads in resumable states (downloading, paused, pending) with chunks. | `_query`, `getChunks` |
| 26 | `close` | 323 | `close()` → void | Clear auto-save interval, save, and close database. | `save` |

---

## 7. utils/filename.js — Filename Resolution

| # | Function | Line | Signature | Description | Dependencies |
|---|----------|------|-----------|-------------|--------------|
| 1 | `parseContentDisposition` | 19 | `parseContentDisposition(header: string)` → `string\|null` | Parse filename from Content-Disposition header (RFC 5987 and standard formats). | — |
| 2 | `filenameFromUrl` | 40 | `filenameFromUrl(url: string)` → `string\|null` | Extract filename from URL path's last segment. | `URL` |
| 3 | `sanitizeFilename` | 58 | `sanitizeFilename(name: string)` → `string` | Remove illegal chars, handle reserved Windows names, limit length to 255. | — |
| 4 | `resolveFilename` | 88 | `resolveFilename({ url, filename?, contentDisposition?, fallback? })` → `string` | Resolve best filename: explicit > Content-Disposition > URL path > fallback. | `parseContentDisposition`, `filenameFromUrl`, `sanitizeFilename` |
| 5 | `ensureUniqueFilename` | 113 | `ensureUniqueFilename(dir: string, filename: string, existsFn: Function)` → `string` | Append (1), (2), etc. to avoid file collisions in a directory. | — |

## 7b. utils/hash.js — SHA-256 Utilities

| # | Function | Line | Signature | Description | Dependencies |
|---|----------|------|-----------|-------------|--------------|
| 1 | `hashFile` | 16 | `hashFile(filePath: string)` → `Promise<string>` | Compute SHA-256 hash of a file using streaming (memory-efficient). | `crypto.createHash` |
| 2 | `verifyFile` | 28 | `verifyFile(filePath: string, expectedHash: string)` → `Promise<boolean>` | Verify a file's SHA-256 hash against an expected value. | `hashFile` |
| 3 | `hashString` | 38 | `hashString(data: string)` → `string` | Compute SHA-256 hash of a string (used for URL deduplication). | `crypto.createHash` |
| 4 | `hashBuffer` | 47 | `hashBuffer(buffer: Buffer)` → `string` | Compute SHA-256 hash of a buffer. | `crypto.createHash` |
| 5 | `createHasher` | 56 | `createHasher()` → `{ update: (chunk: Buffer) => void, digest: () => string }` | Create a streaming hash calculator with update/digest interface. | `crypto.createHash` |

## 7c. utils/mime.js — MIME Detection & Categorization

| # | Function | Line | Signature | Description | Dependencies |
|---|----------|------|-----------|-------------|--------------|
| 1 | `detectMime` | 102 | `detectMime(filename: string)` → `string` | Detect MIME type from file extension using built-in mapping table. | — |
| 2 | `parseContentType` | 112 | `parseContentType(contentType: string)` → `string\|null` | Strip parameters from Content-Type header, return clean MIME type. | — |
| 3 | `getCategoryFromMime` | 121 | `getCategoryFromMime(mime: string)` → `string` | Map MIME type to download category (Videos, Music, Documents, Archives, Software, Images, Others). | `parseContentType` |
| 4 | `resolveCategory` | 140 | `resolveCategory(filename: string, contentType?: string)` → `string` | Resolve category from Content-Type first, then fall back to extension-based detection. | `parseContentType`, `getCategoryFromMime`, `detectMime` |

---

## 8. main.js — Electron/Node Entry Point

| # | Function | Line | Signature | Description | Dependencies |
|---|----------|------|-----------|-------------|--------------|
| 1 | `printBanner` | 33 | `printBanner()` → void | Print ASCII art IDMAM banner and version info to console. | — |
| 2 | `main` | 47 | `async main()` → `Promise<void>` | Application entry point: init DB → load settings → init DownloadManager → auto-resume → start server → register shutdown handlers. | `IDMAMDatabase.create`, `DownloadManager`, `IDRAMServer`, `formatBytes` |
| 3 | `formatBytes` | 111 | `formatBytes(bytes: number)` → `string` | Format bytes to human-readable string (B/KB/MB/GB/TB). | — |
| 4 | `shutdown` (closure) | 93 | `async shutdown(signal: string)` → `Promise<void>` | Graceful shutdown handler: pause all active downloads, stop server, close DB. | `downloader.getActiveStates`, `downloader.pauseDownload`, `server.stop`, `db.close` |

---

## 9. test.js — Integration Test Functions

| # | Function | Line | Signature | Description | Dependencies |
|---|----------|------|-----------|-------------|--------------|
| 1 | `formatBytes` | 30 | `formatBytes(bytes: number)` → `string` | Format bytes to human-readable string (B/KB/MB/GB). | — |
| 2 | `formatSpeed` | 36 | `formatSpeed(bytesPerSec: number)` → `string` | Format bytes/sec to human-readable speed string (MB/s). | — |
| 3 | `sleep` | 41 | `sleep(ms: number)` → `Promise<void>` | Promise-based delay utility. | — |
| 4 | `testWebSocket` | 46 | `testWebSocket()` → `Promise<boolean>` | Test WebSocket connection to IDMAM server — connect, wait for message, close. | `ws.WebSocket` |
| 5 | `createTestFileServer` | 68 | `createTestFileServer()` → `{ server: http.Server, expectedHash: string, testData: Buffer }` | Create a local HTTP file server with a 10MB deterministic test file supporting Range requests and throttled delivery. | `crypto.createHash` |
| 6 | `apiRequest` | 113 | `apiRequest(method: string, apiPath: string, body?: Object)` → `Promise<{ status: number, data: any }>` | HTTP client for IDMAM REST API — sends JSON request and parses response. | — |
| 7 | `runTests` | 138 | `async runTests()` → `Promise<void>` | Run full integration test suite: health check → start download → monitor → pause → resume → verify → WebSocket → list → stats. | `createTestFileServer`, `IDMAMDatabase`, `DownloadManager`, `IDRAMServer`, `apiRequest`, `testWebSocket`, `formatBytes`, `formatSpeed`, `sleep`, `cleanup` |
| 8 | `cleanup` | 360 | `async cleanup(server: Object, db: Object, testServer: Object, dataDir: string)` → `Promise<void>` | Stop server, close test server, close DB, delete test data directory. | — |

---

## Summary Statistics

| Module | Classes | Functions | Total |
|--------|---------|-----------|-------|
| engine/downloader.js | 1 (`DownloadManager`) | 26 | 26 |
| engine/chunk-worker.js | 0 | 4 | 4 |
| engine/merge.js | 0 | 3 | 3 |
| engine/resume.js | 1 (`ResumeManager`) | 12 | 12 |
| server/server.js | 1 (`IDRAMServer`) | 8 + 11 routes | 8 |
| db/sqlite.js | 1 (`IDMAMDatabase`) | 26 | 26 |
| utils/filename.js | 0 | 5 | 5 |
| utils/hash.js | 0 | 5 | 5 |
| utils/mime.js | 0 | 4 | 4 |
| main.js | 0 | 4 | 4 |
| test.js | 0 | 8 | 8 |
| **TOTAL** | **4 classes** | **105** | **105** |
