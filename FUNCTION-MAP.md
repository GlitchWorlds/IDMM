# IDMAM v1.1.0 — Full Module & Function Map

> Generated: 2026-07-15 22:50 WIB
> Total: 10 backend modules + 5 extension files
> Lines: ~5,500 backend + ~1,200 extension = ~6,700 total

---

## Architecture

```
Chrome Extension                    Node.js Server
┌─────────────────┐                ┌──────────────────────────────┐
│  popup.js       │◄──WS:9977──►  │  server.js (Express+WS)      │
│  background.js  │──REST:9977──► │  ├─ routes                   │
│  options.js     │                │  ├─ WebSocket broadcast      │
│  api-client.js  │                │  └─ rate limiter             │
│  content.js     │                ├──────────────────────────────┤
└─────────────────┘                │  downloader.js (orchestrator)│
                                   │  ├─ chunk-worker.js (threads)│
                                   │  ├─ merge.js                 │
                                   │  └─ resume.js                │
                                   ├──────────────────────────────┤
                                   │  sqlite.js (sql.js WASM)     │
                                   ├──────────────────────────────┤
                                   │  utils/                      │
                                   │  ├─ filename.js              │
                                   │  ├─ hash.js                  │
                                   │  ├─ mime.js                  │
                                   │  └─ ssrf.js                  │
                                   └──────────────────────────────┘
```

---

## Backend Modules

### 1. `src/server/server.js` — API Server (566 lines)

**Class: `IDRAMServer`**

| Line | Function | Description |
|------|----------|-------------|
| 40 | `sanitizeError(err)` | Whitelist-safe error messages for API responses |
| 53 | `constructor({ db, downloader })` | Initialize Express app, WebSocket, state |
| 72 | `_setupMiddleware()` | CORS, Helmet, JSON parser, static files |
| 82 | `_isAllowedOrigin(origin)` (inline) | CORS origin validation |
| 113 | Rate limiter middleware | Per-IP sliding window (100 req/60s) |
| 140 | Rate limit cleanup interval | Evict stale entries every 5 min |
| 150 | `_setupRoutes()` | All REST API routes |
| 161 | `POST /api/download` | Start new download (SSRF check, path traversal guard). Accepts `thread_mode: "auto"` | "manual"` |
| 217 | `GET /api/downloads` | List all downloads (optional status filter) |
| 234 | `GET /api/download/:id` | Get download details |
| 247 | `POST /api/download/:id/pause` | Pause download |
| 263 | `POST /api/download/:id/resume` | Resume download |
| 280 | `POST /api/download/:id/cancel` | Cancel download |
| 296 | `DELETE /api/download/:id` | Delete download + files |
| 312 | `GET /api/stats` | Server statistics |
| 327 | `GET /api/settings` | Get all settings |
| 333 | `PUT /api/settings` | Update settings (whitelist: 12 keys incl. `default_thread_mode`) |
| 370 | `GET /api/health` | Health check |
| 389 | `_setupWebSocket()` | WebSocket server on `/ws` |
| 395 | `_heartbeat()` | WS ping/pong 30s keepalive |
| 430 | `_broadcastLoop()` | Broadcast download states every 500ms |
| 441 | `_broadcastStates()` | Send JSON to all WS clients |
| 469 | `_removeActiveUrl(downloadId)` | Clean up duplicate URL tracking |
| 477 | `_isAllowedOrigin(origin)` | Validate WS origin (localhost only) |
| 491 | `broadcast(data)` | Send data to all connected WS clients |
| 510 | `async start()` | Start HTTP + WS server |
| 558 | `async stop()` | Graceful shutdown (close WS, HTTP, timers) |

**Security Features:**
- SSRF protection (initial URL + redirect re-validation)
- Path traversal protection (`save_to` validated against allowed roots)
- Rate limiting (100 req/min per IP)
- CORS (localhost origins only)
- WebSocket maxPayload 64KB
- `sanitizeError()` — no internal paths in responses

---

### 2. `src/engine/downloader.js` — Download Engine (1,264 lines)

**Class: `Semaphore`**

| Line | Function | Description |
|------|----------|-------------|
| 28 | `acquire()` | Acquire semaphore slot (async queue) |
| 35 | `release()` | Release slot, dequeue next |

**Class: `DownloadEngine`**

| Line | Function | Description |
|------|----------|-------------|
| 54 | `constructor({ db, tempDir, settings, onProgress, onComplete, onError })` | Initialize engine |
| 83 | `async startDownload(params)` | Full download lifecycle (probe → chunk → download → merge → verify). Supports `threadMode: "auto"` | "manual"` |
| 217 | `pauseDownload(downloadId)` | Pause active download (terminate workers) |
| 266 | `async resumeDownload(downloadId)` | Resume paused download (rebuild chunks, spawn workers) |
| 351 | `cancelDownload(downloadId)` | Cancel + cleanup temp files |
| 378 | `deleteDownload(downloadId)` | Delete download + output file + DB records |
| 411 | `getDownloadState(downloadId)` | Get merged state (active memory + DB) |
| 457 | `getActiveStates()` | Get all active download states |
| 469 | `getActiveCount()` | Count active downloads |
| 478 | `_probeUrl(url, headers, redirectCount)` | HEAD request to detect size, range support (max 5 redirects) |
| 488 | `_autoDetectThreads(totalSize)` | Auto thread count based on file size (<5MB→1, 5-50MB→4, 50-500MB→16, >500MB→32, cap 64) |
| 516 | `async _startChunkedDownload(state, opts)` | Split file into chunks, spawn workers |
| 561 | `_spawnWorkers(state, opts)` | Spawn worker threads for each chunk |
| 599 | `async _spawnWorkerAsync(state, chunk, chunkPath, opts)` | Single worker lifecycle (spawn → message → exit) |
| 658 | `_handleWorkerMessage(state, chunk, msg)` | Process worker messages (progress/chunk_done/error/throttle) |
| 799 | `_handleThrottle(state)` | Reduce threads on 429/ECONNRESET (halve each time, cap at 4 after 3+ throttles) |
| 826 | `_cancelAllWorkers(state)` | Terminate all workers for a download |
| 843 | `_buildResumeChunks(downloadId, dbDownload)` | Rebuild chunk state for resume |
| 895 | `_getPerWorkerSpeedLimit(state)` | Calculate per-worker speed limit |
| 906 | `_flushChunkState(state)` | Flush all chunk states to DB |
| 945 | `_startSingleStreamDownload(state, opts)` | Single-stream download (no range support) |
| 991 | `_doSingleStream(state, opts, chunkPath, existingBytes, resolve, reject)` | Single HTTP GET download with progress |
| 1089 | `async _resumeSingleStreamDownload(state, opts)` | Resume single-stream |
| 1102 | `async _resumeChunkedDownload(state, opts)` | Resume multi-thread download |
| 1136 | `_recalcProgress(state)` | Recalculate speed, ETA, progress % |
| 1177 | `_checkCompletion(state)` | Check if all chunks done → finalize |
| 1206 | `async _finalizeDownload(state)` | Merge chunks → verify size/checksum → DB update |
| 1269 | `_formatState(state)` | Format state for API response (includes thread_mode, throttle_count) |

---

### 3. `src/engine/chunk-worker.js` — Worker Thread (284 lines)

| Line | Function | Description |
|------|----------|-------------|
| 45 | `report(type, data)` | Send message to parent thread |
| 56 | `parseUrl(urlStr)` | Parse URL for HTTP/HTTPS request |
| 74 | `downloadChunk(attempt, currentUrl, redirectCount)` | Download chunk with retry, speed limit, redirect handling |
| 243 | `async main()` | Entry point — receive config, download, handle retries |

**Features:**
- Token bucket speed limiter
- Redirect validation (max 5, SSRF check)
- Retry with exponential backoff
- Timeout handling
- Throttle detection: reports 429 and ECONNRESET as `throttle` messages to parent

---

### 4. `src/engine/merge.js` — File Merger (187 lines)

| Line | Function | Description |
|------|----------|-------------|
| 22 | `mergeChunks({ chunkPaths, outputPath, totalSize, onProgress })` | Stream chunks into output file (backpressure handling) |
| 36 | `writeNextChunk()` (inner) | Recursive chunk writer with drain events |
| 106 | `cleanupChunks(chunkPaths, stateFilePath)` | Delete .part chunk files |
| 130 | `async mergeAndVerify({ chunkPaths, outputPath, ... })` | Merge + verify size + optional SHA-256 checksum |

**Features:**
- Atomic merge (`.part` temp → `fs.renameSync`)
- Backpressure (pause/resume on drain)
- Cleanup on verification failure

---

### 5. `src/engine/resume.js` — Resume State Manager (301 lines)

**Class: `ResumeManager`**

| Line | Function | Description |
|------|----------|-------------|
| 18 | `constructor(tempDir)` | Initialize with temp directory |
| 23 | `_ensureDir(dir)` | Create directory if not exists |
| 34 | `getDownloadTempDir(downloadId)` | Get temp directory for download |
| 43 | `getStateFilePath(downloadId)` | Get state JSON file path |
| 53 | `getChunkPath(downloadId, chunkIndex)` | Get chunk .part file path |
| 62 | `saveState(state)` | Save state to JSON (500ms debounced) |
| 107 | `loadState(downloadId)` | Load state from JSON file |
| 125 | `validateChunks(downloadId, chunks)` | Validate chunk files on disk |
| 178 | `cleanup(downloadId)` | Delete entire download temp directory |
| 197 | `cleanupChunks(downloadId)` | Delete only .part chunk files |
| 217 | `findAllStateFiles()` | Find all state files in temp dir |
| 238 | `updateChunkState(downloadId, chunkIndex, updates)` | Update single chunk state (debounced) |
| 275 | `flushPending()` | Flush all pending chunk updates immediately |

**Features:**
- 500ms write debounce
- Re-entrancy guard (`_flushing` flag)
- Chunk validation (disk size vs expected)

---

### 6. `src/db/sqlite.js` — Database Layer (400 lines)

**Class: `Database`**

| Line | Function | Description |
|------|----------|-------------|
| 19 | `constructor(db, dbPath)` | Initialize sql.js WASM database |
| 30 | Auto-save interval | Every 30s if dirty |
| 43 | `_ensureDir(dir)` | Create DB directory |
| 50 | `_loadOrCreate()` | Load existing or create new DB |
| 63 | `save()` | Persist to disk |
| 73 | `_markDirty()` | Flag for next save |
| 82 | `_query(sql, params)` | Execute query, return rows |
| 102 | `_queryOne(sql, params)` | Execute query, return first row |
| 110 | `_run(sql, params)` | Execute write statement |
| 122 | `_initTables()` | Create tables (downloads, chunks, settings) |
| 176 | `_initSettings()` | Seed default settings |
| 200 | `createDownload(download)` | Insert download record |
| 223 | `getDownload(id)` | Get download by ID |
| 231 | `listDownloads(status)` | List downloads (optional filter) |
| 247 | `updateDownload(id, fields)` | Update download fields |
| 275 | `deleteDownload(id)` | Delete download + chunks |
| 283 | `createChunks(downloadId, chunks)` | Insert chunk records |
| 293 | `getChunks(downloadId)` | Get chunks for download |
| 300 | `updateChunk(chunkId, fields)` | Update chunk fields |
| 319 | `getDownloadWithChunks(id)` | Get download with all chunks |
| 328 | `getSetting(key)` | Get single setting |
| 333 | `getSettingInt(key, defaultValue)` | Get setting as integer |
| 338 | `getAllSettings()` | Get all settings as object |
| 347 | `setSetting(key, value)` | Set single setting |
| 354 | `updateSettings(settings)` | Update multiple settings |
| 362 | `getStats()` | Get download statistics |
| 380 | `getResumableDownloads()` | Get paused/active downloads for auto-resume |
| 391 | `close()` | Close DB + save |

---

### 7. `src/utils/filename.js` — Filename Utilities (162 lines)

| Line | Function | Description |
|------|----------|-------------|
| 18 | `parseContentDisposition(header)` | Parse RFC 5987 + standard Content-Disposition |
| 45 | `filenameFromUrl(url)` | Extract filename from URL path |
| 69 | `sanitizeFilename(name)` | Remove illegal chars, bound length (255) |
| 108 | `resolveFilename({ url, filename, contentDisposition, fallback })` | Smart filename resolution (priority: explicit > CD > URL > fallback) |
| 141 | `ensureUniqueFilename(dir, filename, existsFn)` | Add (1), (2), ... suffix (max 999) |

---

### 8. `src/utils/hash.js` — Hash Utilities (77 lines)

| Line | Function | Description |
|------|----------|-------------|
| 18 | `hashFile(filePath)` | SHA-256 hash of file |
| 35 | `async verifyFile(filePath, expectedHash)` | Verify file against expected hash |
| 45 | `hashString(data)` | SHA-256 hash of string |
| 54 | `hashBuffer(buffer)` | SHA-256 hash of buffer |
| 63 | `createHasher()` | Create streaming hasher (update/digest) |

---

### 9. `src/utils/mime.js` — MIME Detection (224 lines)

| Line | Function | Description |
|------|----------|-------------|
| 159 | `detectMime(filename)` | Detect MIME type from extension |
| 170 | `parseContentType(contentType)` | Parse Content-Type header |
| 180 | `getCategoryFromMime(mime)` | Map MIME to category (Videos/Music/Images/Documents/Others) |
| 204 | `resolveCategory(filename, contentType)` | Smart category resolution |

**Data:**
- `MIME_MAP`: 50+ extension → MIME mappings
- `MIME_TO_CATEGORY`: MIME → category mappings

---

### 10. `src/utils/ssrf.js` — SSRF Protection (75 lines)

| Line | Function | Description |
|------|----------|-------------|
| 30 | `isBlockedHost(hostname)` | Check if hostname is blocked (localhost, private IPs, link-local) |
| 54 | `validateRedirect(redirectUrl, baseUrl)` | Validate redirect URL against SSRF blocklist |

**Blocked ranges:**
- Loopback: `127.0.0.1`, `localhost`, `0.0.0.0`, `::1`, `[::1]`
- Private: `10.x`, `192.168.x`, `172.16-31.x`
- Link-local: `169.254.x`, `fe80:*`

---

## Extension Files

### 11. `extension/background.js` — Service Worker (348 lines)

| Line | Function | Description |
|------|----------|-------------|
| 18 | `connectWebSocket()` | Connect to `ws://127.0.0.1:9977` with exponential backoff |
| 99 | `checkServer()` | Health check every 10s |
| 107 | `updateBadge()` | Update extension badge (active count / OFF) |
| 119 | `sendToIDMAM({ url, filename, ... })` | Send download to IDMAM server |
| 149 | `onDeterminingFilename` listener | Intercept browser downloads → IDMAM |
| 189 | Context menu setup | "Download with IDMAM" for links/media/selection |
| 234 | `pollDownloads()` | Poll downloads every 5s (fallback) |
| 250 | Message handlers | Handle popup/options messages |
| 340 | `init()` | Startup — health check + WebSocket + polling |

### 12. `extension/popup/popup.js` — Popup UI (430 lines)

| Line | Function | Description |
|------|----------|-------------|
| 35 | `DOMContentLoaded` | Init: listeners, restore tab, check status, refresh |
| 57 | `setupEventListeners()` | Add URL, settings button, tab clicks |
| 73 | `restoreLastTab()` | Load last selected tab from storage |
| 82 | `checkServerStatus()` | Health check + badge update |
| 96 | `refreshDownloads()` | Fetch downloads from API |
| 113 | `renderDownloads()` | Render download list with filters |
| 140 | `filterDownloads(all, filter)` | Filter by active/paused/completed/all |
| 155 | `updateStats()` | Update active count, speed, queued |
| 168 | `createDownloadElement(dl)` | Create download card with actions |
| 270 | `handleAction(action, id, data)` | Handle pause/resume/cancel/delete/open-folder |
| 295 | `addDownload()` | Add new download (with settings applied) |
| 330 | `loadSavePathHint()` | Show save path from settings |
| 348 | `copyToClipboard(text)` | Clipboard copy with fallback |
| 358 | `showToast(text, msg)` | Centered toast notification |
| 373 | `showError(message)` | Error toast |
| 382 | `extractFilename(url)` | Extract filename from URL |
| 391 | `escapeHtml(str)` | XSS-safe HTML escaping |
| 396 | `DOWNLOAD_UPDATE` listener | Real-time updates from background WebSocket |

### 13. `extension/options/options.js` — Settings Page (175 lines)

| Line | Function | Description |
|------|----------|-------------|
| 42 | `DOMContentLoaded` | Init: listeners, load settings, check status |
| 48 | `setupEventListeners()` | Save, reset, browse button |
| 57 | Browse button handler | Folder picker via `webkitdirectory` |
| 75 | `loadSettings()` | Load all settings from chrome.storage.local |
| 91 | `saveSettings()` | Save all settings + notify background |
| 115 | `resetSettings()` | Reset to defaults |
| 131 | `checkStatus()` | Health check (Connected/Not Running) |
| 152 | `sendMessage(message)` | Chrome runtime message helper |
| 163 | `showSaveStatus(text, isError)` | Save status toast |
| 172 | `clamp(value, min, max)` | Number clamping |

### 14. `extension/lib/api-client.js` — API Client (195 lines)

| Line | Function | Description |
|------|----------|-------------|
| 12 | `_fetch(path, options)` | HTTP fetch with timeout + error handling |
| 48 | `startDownload({ url, ... })` | POST /api/download |
| 57 | `listDownloads(status)` | GET /api/downloads |
| 63 | `getDownload(id)` | GET /api/download/:id |
| 67 | `pauseDownload(id)` | POST /api/download/:id/pause |
| 71 | `resumeDownload(id)` | POST /api/download/:id/resume |
| 75 | `cancelDownload(id)` | POST /api/download/:id/cancel |
| 79 | `deleteDownload(id)` | DELETE /api/download/:id |
| 83 | `getServerStats()` | GET /api/stats |
| 87 | `healthCheck()` | GET /api/health |
| 101 | `getSettings()` | Read from chrome.storage.local |
| 111 | `saveSettings(settings)` | Write to chrome.storage.local |
| 120 | `defaultSettings()` | Default settings object |
| 138 | `shouldIntercept(filename, fileSize, settings)` | File type interception logic |
| 172 | `formatBytes(bytes)` | Human-readable bytes |
| 178 | `formatSpeed(bytesPerSec)` | Human-readable speed |
| 184 | `formatETA(seconds)` | Human-readable ETA |

### 15. `extension/content.js` — Content Script (38 lines)

| Line | Function | Description |
|------|----------|-------------|
| 10 | `getSelectedLinks` handler | Extract all links from page |
| 18 | `getPageMedia` handler | Extract video/audio/image sources |

---

## API Endpoints Summary

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/download | Start download |
| GET | /api/downloads | List downloads |
| GET | /api/download/:id | Get download |
| POST | /api/download/:id/pause | Pause |
| POST | /api/download/:id/resume | Resume |
| POST | /api/download/:id/cancel | Cancel |
| DELETE | /api/download/:id | Delete |
| GET | /api/stats | Statistics |
| GET | /api/settings | Get settings |
| PUT | /api/settings | Update settings |
| GET | /api/health | Health check |
| WS | /ws | WebSocket (real-time updates) |

---

## Data Flow

```
1. User pastes URL in popup
2. popup.js → addDownload() → reads settings → API POST /api/download
3. server.js → SSRF check → path validation → downloader.startDownload()
4. downloader.js → HEAD probe → calculate chunks → spawn workers
5. chunk-worker.js → HTTP GET with Range → write .part file → report progress
6. downloader.js → merge chunks → verify checksum → DB update
7. server.js → WebSocket broadcast → popup.js renders progress
```

---

## Statistics

| Metric | Value |
|--------|-------|
| Backend files | 10 |
| Extension files | 5 |
| Total lines | ~6,700 |
| Functions (backend) | ~120 |
| Functions (extension) | ~40 |
| API endpoints | 12 |
| Security fixes | 28 |
| Tests passed | 54/54 |
