# IDMAM Project Comprehensive Audit

## Executive Summary

IDMAM (Internet Download Manager AI Max) is a multi-threaded download manager with:
- **Core Engine**: Chunk-based parallel downloads with resume support
- **API Server**: RESTful API on localhost:9977 with WebSocket for real-time progress
- **Database**: SQLite via sql.js for persistence
- **Utilities**: Filename resolution, MIME detection, hash verification

---

## 1. Exported Functions & API Endpoints

### 1.1 src/engine/downloader.js — DownloadManager (Class)

| # | Export | Type | Description |
|---|--------|------|-------------|
| 1 | `constructor({db, tempDir, settings, onProgress, onComplete, onError})` | Constructor | Initialize download manager with DB instance, temp directory, settings, and event callbacks |
| 2 | `startDownload(params)` | Async Method | Start a new download. Accepts: url, filename, saveTo, threads, cookies, referrer, headers. Returns download info with ID |
| 3 | `pauseDownload(downloadId)` | Method | Pause an active download. Terminates worker threads, saves state, returns `{id, status:'paused'}` |
| 4 | `resumeDownload(downloadId)` | Async Method | Resume a paused download. Loads state from DB/resume file, restarts chunk workers |
| 5 | `cancelDownload(downloadId)` | Method | Cancel download, terminate workers, cleanup temp files, update DB status to 'cancelled' |
| 6 | `deleteDownload(downloadId)` | Method | Delete download and output file. Cancels if active, removes from DB |
| 7 | `getDownloadState(downloadId)` | Method | Get current download state (real-time if active, DB fallback) |
| 8 | `getActiveStates()` | Method | Get all active download states for WebSocket broadcast |
| 9 | `getActiveCount()` | Method | Get count of active downloads |
| 10 | `_probeUrl(url, headers, redirectCount)` | Private | HEAD request to get file size, Range support, Content-Type, redirects (max 5) |
| 11 | `_startChunkedDownload(state, opts)` | Private | Split file into chunks, create DB records, spawn workers |
| 12 | `_spawnWorkers(state, opts)` | Private | Spawn worker threads for pending/incomplete chunks |
| 13 | `_spawnWorker(state, chunk, chunkPath, opts)` | Private | Spawn single worker thread for one chunk |
| 14 | `_handleWorkerMessage(state, chunk, msg)` | Private | Handle worker messages: progress, chunk_done, error, retry |
| 15 | `_cancelAllWorkers(state)` | Private | Terminate all active workers for a download |
| 16 | `_startSingleStreamDownload(state, opts)` | Private | Fallback: download without Range support (single HTTP stream) |
| 17 | `_doSingleStream(state, opts, chunkPath, existingBytes, resolve, reject)` | Private | Execute single-stream download with redirect handling |
| 18 | `_resumeSingleStreamDownload(state, opts)` | Private | Resume a single-stream download |
| 19 | `_resumeChunkedDownload(state, opts)` | Private | Resume chunked download with integrity validation |
| 20 | `_recalcProgress(state)` | Private | Recalculate total downloaded bytes, speed (rolling 3s average), ETA |
| 21 | `_checkCompletion(state)` | Private | Check if all chunks done → finalize, or if failed |
| 22 | `_finalizeDownload(state)` | Private | Merge chunks, verify checksum, cleanup, update DB, notify completion |
| 23 | `_formatState(state)` | Private | Format download state for API/WebSocket response |

### 1.2 src/engine/chunk-worker.js — Worker Thread

| # | Function | Description |
|---|----------|-------------|
| 24 | `report(type, data)` | Send progress message to main thread via parentPort |
| 25 | `parseUrl(urlStr)` | Parse URL into components (protocol, hostname, port, path) |
| 26 | `downloadChunk(attempt, currentUrl)` | Download byte range with HTTP Range request, handles redirects, 416, 200 (no range) |
| 27 | `main()` | Worker entry: retry loop with exponential backoff (1s, 2s, 4s), reports attempt/retry/error |

### 1.3 src/engine/merge.js — Chunk Merger

| # | Export | Type | Description |
|---|--------|------|-------------|
| 28 | `mergeChunks({chunkPaths, outputPath, totalSize, onProgress})` | Function | Sequentially merge .part files into final output with progress callback |
| 29 | `cleanupChunks(chunkPaths, stateFilePath?)` | Function | Delete .part files after successful merge |
| 30 | `mergeAndVerify({downloadId, chunkPaths, outputPath, totalSize, expectedChecksum?, cleanupAfter?, onProgress?})` | Async Function | Full merge operation: merge → verify size → SHA-256 verify (if provided) → cleanup |

### 1.4 src/engine/resume.js — ResumeManager (Class)

| # | Export | Type | Description |
|---|--------|------|-------------|
| 31 | `constructor(tempDir)` | Constructor | Initialize resume manager with temp directory path |
| 32 | `getDownloadTempDir(downloadId)` | Method | Get temp directory path for specific download |
| 33 | `getStateFilePath(downloadId)` | Method | Get path to download.json state file |
| 34 | `getChunkPath(downloadId, chunkIndex)` | Method | Get path to chunk .part file (e.g., chunk_00001.part) |
| 35 | `saveState(state)` | Method | Save download state to download.json (dual persistence with SQLite) |
| 36 | `loadState(downloadId)` | Method | Load download state from download.json |
| 37 | `validateChunks(downloadId, chunks)` | Method | Validate chunk integrity: check .part file sizes match expected bytes |
| 38 | `cleanup(downloadId)` | Method | Delete all temp files (chunks + download.json) for a download |
| 39 | `cleanupChunks(downloadId)` | Method | Delete chunk .part files only (keep download.json for re-resume) |
| 40 | `findAllStateFiles()` | Method | Find all download IDs with state files (for recovery on startup) |
| 41 | `updateChunkState(downloadId, chunkIndex, updates)` | Method | Update single chunk's state within download.json |

### 1.5 src/server/server.js — IDRAMServer (Class)

| # | Export | Type | Description |
|---|--------|------|-------------|
| 42 | `constructor({db, downloader})` | Constructor | Initialize Express server with DB and downloader instances |
| 43 | `start()` | Async Method | Start HTTP server on 127.0.0.1:9977 with WebSocket |
| 44 | `stop()` | Async Method | Graceful shutdown: close WebSocket, stop server |
| 45 | `broadcast(data)` | Method | Broadcast custom event to all WebSocket clients |

#### REST API Endpoints

| # | Endpoint | Method | Description |
|---|----------|--------|-------------|
| 46 | `/api/health` | GET | Health check: returns `{status, version, uptime}` |
| 47 | `/api/download` | POST | Start new download. Body: `{url, filename, save_to, threads, cookies, referrer, headers, checksum}` |
| 48 | `/api/downloads` | GET | List all downloads. Query param: `?status=` filter |
| 49 | `/api/download/:id` | GET | Get download status with real-time state |
| 50 | `/api/download/:id/pause` | POST | Pause download |
| 51 | `/api/download/:id/resume` | POST | Resume download |
| 52 | `/api/download/:id/cancel` | POST | Cancel download |
| 53 | `/api/download/:id` | DELETE | Delete download and files |
| 54 | `/api/settings` | GET | Get all settings |
| 55 | `/api/settings` | PUT | Update settings (whitelist: default_threads, max_concurrent_downloads, etc.) |
| 56 | `/api/stats` | GET | Download statistics (total, completed, active, paused, failed, bytes) |

#### WebSocket

| # | Feature | Description |
|---|---------|-------------|
| 57 | `/ws` | WebSocket endpoint for real-time progress (broadcasts every 500ms) |
| 58 | Origin validation | Only allows localhost, 127.0.0.1, chrome-extension, moz-extension |
| 59 | Rate limiting | 100 requests/minute per IP |
| 60 | CORS whitelist | localhost + browser extensions |

### 1.6 src/db/sqlite.js — IDMAMDatabase (Class)

| # | Export | Type | Description |
|---|--------|------|-------------|
| 61 | `static async create(dbPath)` | Factory | Async factory to create/load SQLite database (sql.js WASM) |
| 62 | `save()` | Method | Persist database to disk |
| 63 | `createDownload(download)` | Method | Insert download record into DB |
| 64 | `getDownload(id)` | Method | Get single download by ID |
| 65 | `listDownloads(status?)` | Method | List downloads, optionally filtered by status |
| 66 | `updateDownload(id, fields)` | Method | Update download fields (filename, status, progress, etc.) |
| 67 | `deleteDownload(id)` | Method | Delete download and its chunks from DB |
| 68 | `createChunks(downloadId, chunks)` | Method | Insert chunk records for a download |
| 69 | `getChunks(downloadId)` | Method | Get all chunks for a download |
| 70 | `updateChunk(chunkId, fields)` | Method | Update chunk fields (downloaded_bytes, status, error, retries) |
| 71 | `getDownloadWithChunks(id)` | Method | Get download with all chunks (join query) |
| 72 | `getSetting(key)` | Method | Get single setting value |
| 73 | `getSettingInt(key, defaultValue)` | Method | Get setting as integer |
| 74 | `getAllSettings()` | Method | Get all settings as key-value object |
| 75 | `setSetting(key, value)` | Method | Set/update single setting |
| 76 | `updateSettings(settings)` | Method | Batch update multiple settings |
| 77 | `getStats()` | Method | Get download statistics (counts by status, total bytes) |
| 78 | `getResumableDownloads()` | Method | Get downloads in 'downloading', 'paused', or 'pending' status |
| 79 | `close()` | Method | Close DB connection, save, clear intervals |

### 1.7 src/utils/filename.js — Filename Utilities

| # | Export | Type | Description |
|---|--------|------|-------------|
| 80 | `parseContentDisposition(header)` | Function | Parse filename from Content-Disposition header (RFC 5987 + standard) |
| 81 | `filenameFromUrl(url)` | Function | Extract filename from URL path (last segment) |
| 82 | `sanitizeFilename(name)` | Function | Remove illegal chars (Windows), handle reserved names, limit length (255) |
| 83 | `resolveFilename({url, filename, contentDisposition, fallback})` | Function | Smart filename resolution: explicit > Content-Disposition > URL > fallback |
| 84 | `ensureUniqueFilename(dir, filename, existsFn)` | Function | Append (1), (2), etc. to avoid filename collisions |

### 1.8 src/utils/hash.js — Hash Utilities

| # | Export | Type | Description |
|---|--------|------|-------------|
| 85 | `hashFile(filePath)` | Async Function | Compute SHA-256 of file (streaming, memory-efficient) |
| 86 | `verifyFile(filePath, expectedHash)` | Async Function | Verify file's SHA-256 matches expected value |
| 87 | `hashString(data)` | Function | Compute SHA-256 of string (e.g., URL for dedup) |
| 88 | `hashBuffer(buffer)` | Function | Compute SHA-256 of Buffer |
| 89 | `createHasher()` | Function | Create streaming hash calculator with update()/digest() |

### 1.9 src/utils/mime.js — MIME & Category Detection

| # | Export | Type | Description |
|---|--------|------|-------------|
| 90 | `detectMime(filename)` | Function | Detect MIME type from file extension (80+ mappings) |
| 91 | `parseContentType(contentType)` | Function | Strip parameters from Content-Type header |
| 92 | `getCategoryFromMime(mime)` | Function | Map MIME type to category: Videos, Music, Archives, Documents, Software, Others |
| 93 | `resolveCategory(filename, contentType?)` | Function | Resolve category from filename + Content-Type (prefers Content-Type) |
| 94 | `EXTENSION_TO_MIME` | Constant | Extension → MIME type mapping object |
| 95 | `MIME_TO_CATEGORY` | Constant | MIME → category mapping object |

### 1.10 main.js — Entry Point

| # | Function | Description |
|---|----------|-------------|
| 96 | `printBanner()` | Print IDMAM ASCII art banner |
| 97 | `main()` | Async entry: init DB → load settings → create downloader → auto-resume (if flag) → start server → setup graceful shutdown |
| 98 | `formatBytes(bytes)` | Format bytes to human-readable string (B, KB, MB, GB, TB) |

### 1.11 test.js — Integration Test

| # | Function | Description |
|---|----------|-------------|
| 99 | `createTestFileServer()` | Create local HTTP server serving 2MB deterministic test file with Range support |
| 100 | `apiRequest(method, apiPath, body?)` | HTTP client for IDMAM API |
| 101 | `runTests()` | Full integration test: health → start → monitor → pause → resume → verify → list → stats |
| 102 | `cleanup(server, db, testServer, dataDir)` | Clean up test resources |

---

## 2. Key Features

| # | Feature | Implementation |
|---|---------|----------------|
| F1 | Multi-threaded chunked downloads | Splits file into N chunks, downloads in parallel worker threads |
| F2 | HTTP Range request support | Detects server support via HEAD request, falls back to single-stream |
| F3 | Resume capability | Dual persistence: SQLite + download.json, validates chunk integrity |
| F4 | Auto-retry with exponential backoff | Worker retries: 1s, 2s, 4s delays, configurable max retries |
| F5 | Redirect handling | Follows 301/302/303/307/308 redirects (max 5) |
| F6 | Real-time progress via WebSocket | Broadcasts every 500ms: speed, ETA, chunk progress |
| F7 | SHA-256 checksum verification | Optional post-download verification |
| F8 | Smart filename resolution | Content-Disposition → URL path → fallback, with sanitization |
| F9 | Auto-categorization | MIME detection → categories: Videos, Music, Archives, Documents, Software |
| F10 | Concurrent download limiting | Configurable max concurrent downloads (default 5) |
| F11 | Rate limiting | 100 req/min per IP |
| F12 | Security | Localhost-only binding, CORS whitelist, helmet headers |
| F13 | Settings persistence | SQLite-backed settings with defaults |
| F14 | Graceful shutdown | Pauses active downloads on SIGINT/SIGTERM |
| F15 | Auto-resume on startup | `--auto-resume` flag resumes incomplete downloads |

---

## 3. Test Scenarios

### 3.1 src/engine/downloader.js

| # | Function | Test Scenario |
|---|----------|---------------|
| T1 | `startDownload()` | **Happy path**: Start download of 2MB file with 4 threads → verify returns download ID, status='downloading', correct filename, total_size |
| T2 | `startDownload()` | **Invalid URL**: Pass empty/invalid URL → verify throws "URL is required" or "Invalid URL" |
| T3 | `startDownload()` | **No Range support**: Download from server without Accept-Ranges → verify falls back to single-thread mode, threads=1 |
| T4 | `startDownload()` | **With cookies/headers**: Pass cookies and custom headers → verify they're sent in HTTP request |
| T5 | `pauseDownload()` | **Happy path**: Start download, pause at 30% → verify status='paused', workers terminated, state saved to DB |
| T6 | `pauseDownload()` | **Not active**: Pause non-existent download → verify throws "Download not active" |
| T7 | `resumeDownload()` | **Happy path**: Start → pause → resume → verify downloads continue from where left off, no data loss |
| T8 | `resumeDownload()` | **Already completed**: Resume completed download → verify throws "Download already completed" |
| T9 | `cancelDownload()` | **Happy path**: Start → cancel → verify status='cancelled', temp files deleted, DB updated |
| T10 | `deleteDownload()` | **Active download**: Start → delete → verify cancelled first, output file deleted, removed from DB |
| T11 | `deleteDownload()` | **Completed download**: Delete completed → verify output file removed from disk |
| T12 | `getDownloadState()` | **Active**: Get state of downloading file → verify real-time progress, speed, ETA, chunk details |
| T13 | `getDownloadState()` | **From DB**: Get state of paused/completed → verify reads from DB correctly |
| T14 | `getDownloadState()` | **Not found**: Pass invalid ID → verify returns null |
| T15 | `getActiveStates()` | **Multiple downloads**: Start 3 downloads → verify returns array of 3 active states |
| T16 | `getActiveCount()` | **Zero**: Before any downloads → verify returns 0 |
| T17 | `_probeUrl()` | **Redirect chain**: Probe URL that redirects 3 times → verify follows all, returns final headers |
| T18 | `_probeUrl()` | **Timeout**: Probe unreachable server → verify throws timeout error after 15s |
| T19 | `_probeUrl()` | **Too many redirects**: 6+ redirects → verify throws "Too many redirects" |
| T20 | `_recalcProgress()` | **Speed calculation**: Simulate speed samples → verify rolling average over 3 seconds |
| T21 | `_checkCompletion()` | **All done**: All chunks status='done' → verify triggers finalization |
| T22 | `_checkCompletion()` | **Some failed**: 2/4 chunks failed → verify sets status='failed' with error message |
| T23 | `_finalizeDownload()` | **With checksum**: Download with expected checksum → verify SHA-256 verified, result includes checksum |
| T24 | `_finalizeDownload()` | **Size mismatch**: Merge produces wrong size → verify throws error |
| T25 | `_finalizeDownload()` | **Checksum mismatch**: Wrong expected checksum → verify throws "Checksum mismatch" |
| T26 | `_formatState()` | **Progress calculation**: 50% downloaded → verify progress=50.00, correct chunk progress percentages |

### 3.2 src/engine/chunk-worker.js

| # | Function | Test Scenario |
|---|----------|---------------|
| T27 | `downloadChunk()` | **Happy path**: Download 100KB chunk → verify writes correct bytes, reports progress, reports chunk_done |
| T28 | `downloadChunk()` | **Redirect**: Follow 302 redirect → verify downloads from new URL |
| T29 | `downloadChunk()` | **416 Range Not Satisfiable**: Request already-complete chunk → verify reports chunk_done immediately |
| T30 | `downloadChunk()` | **200 (no Range)**: Server returns full file → verify reports error with noRangeSupport=true |
| T31 | `downloadChunk()` | **Resume**: 50% already downloaded → verify appends remaining bytes, not re-downloads |
| T32 | `main()` | **Retry logic**: First attempt fails, second succeeds → verify completes successfully |
| T33 | `main()` | **All retries exhausted**: All attempts fail → verify reports error with exhausted=true |
| T34 | `main()` | **Exponential backoff**: Verify delays: attempt 1→2: 1s, attempt 2→3: 2s |
| T35 | `report()` | **Port closed**: parentPort closed → verify no crash (try/catch) |

### 3.3 src/engine/merge.js

| # | Function | Test Scenario |
|---|----------|---------------|
| T36 | `mergeChunks()` | **Happy path**: 4 chunks → verify final file = concatenation of all chunks in order |
| T37 | `mergeChunks()` | **Missing chunk**: 1 chunk file missing → verify throws "Missing chunk file" |
| T38 | `mergeChunks()` | **Progress callback**: Merge 4 chunks → verify onProgress called with cumulative bytes |
| T39 | `cleanupChunks()` | **Delete files**: 4 .part files exist → verify all deleted after cleanup |
| T40 | `cleanupChunks()` | **Missing file**: Already-deleted chunk → verify no crash (best effort) |
| T41 | `mergeAndVerify()` | **Full flow**: Merge → verify size → SHA-256 match → cleanup → verify returns {success, checksum, verified:true} |
| T42 | `mergeAndVerify()` | **No checksum**: Merge without expectedChecksum → verify returns {success, checksum:null, verified:null} |
| T43 | `mergeAndVerify()` | **Checksum mismatch**: Wrong expected → verify throws "Checksum mismatch" |
| T44 | `mergeAndVerify()` | **Size mismatch**: Wrong totalSize → verify throws "Size mismatch after merge" |

### 3.4 src/engine/resume.js

| # | Function | Test Scenario |
|---|----------|---------------|
| T45 | `getDownloadTempDir()` | Verify returns `{tempDir}/{downloadId}` |
| T46 | `getStateFilePath()` | Verify returns `{tempDir}/{downloadId}/download.json` |
| T47 | `getChunkPath()` | **Index 0**: Verify returns `chunk_00000.part` |
| T48 | `getChunkPath()` | **Index 42**: Verify returns `chunk_00042.part` (zero-padded to 5) |
| T49 | `saveState()` | **Full state**: Save state with 3 chunks → verify JSON file written correctly with all fields |
| T50 | `loadState()` | **Happy path**: Save then load → verify roundtrip preserves all data |
| T51 | `loadState()` | **Missing file**: Load non-existent → verify returns null |
| T52 | `loadState()` | **Corrupt JSON**: Write invalid JSON → verify returns null |
| T53 | `validateChunks()` | **All valid**: 3 chunks, all correct size → verify valid=true, all chunks.valid=true |
| T54 | `validateChunks()` | **One undersized**: Chunk 1 is 50% size → verify valid=false, chunk.needsResume=true |
| T55 | `validateChunks()` | **Oversized**: Chunk larger than expected → verify valid=false |
| T56 | `validateChunks()` | **Missing file**: Chunk .part not found → verify valid=false, actualSize=0 |
| T57 | `cleanup()` | **Delete all**: 3 chunks + download.json → verify directory removed |
| T58 | `cleanupChunks()` | **Keep download.json**: Delete only .part files → verify download.json still exists |
| T59 | `findAllStateFiles()` | **Multiple downloads**: 3 downloads with state files → verify returns 3 IDs |
| T60 | `findAllStateFiles()` | **Empty temp dir**: No downloads → verify returns [] |
| T61 | `updateChunkState()` | **Update downloaded**: Update chunk 0 downloaded bytes → verify JSON updated |

### 3.5 src/server/server.js

| # | Endpoint/Feature | Test Scenario |
|---|------------------|---------------|
| T62 | `GET /api/health` | Verify returns `{status:'ok', version:'1.0.0', uptime: <number>}` |
| T63 | `POST /api/download` | **Happy path**: POST with valid URL → verify 201, returns download object with ID |
| T64 | `POST /api/download` | **Missing URL**: POST without url → verify 400 "URL is required" |
| T65 | `POST /api/download` | **Invalid URL**: POST with "not-a-url" → verify 400 "Invalid URL" |
| T66 | `POST /api/download` | **Max concurrent**: 5 active downloads, start 6th → verify 429 error |
| T67 | `GET /api/downloads` | **List all**: 3 downloads → verify returns array of 3 |
| T68 | `GET /api/downloads` | **Filter by status**: ?status=completed → verify returns only completed |
| T69 | `GET /api/downloads` | **Enriched state**: Active download → verify includes real-time progress |
| T70 | `GET /api/download/:id` | **Valid ID**: Existing download → verify 200 with full state |
| T71 | `GET /api/download/:id` | **Invalid ID**: Non-existent → verify 404 |
| T72 | `POST /api/download/:id/pause` | **Active download**: Pause → verify `{id, status:'paused'}` |
| T73 | `POST /api/download/:id/pause` | **Not active**: Pause non-active → verify 400 |
| T74 | `POST /api/download/:id/resume` | **Paused download**: Resume → verify `{id, status:'downloading'}` |
| T75 | `POST /api/download/:id/resume` | **Not found**: Resume non-existent → verify 404 |
| T76 | `POST /api/download/:id/cancel` | **Active download**: Cancel → verify `{id, status:'cancelled'}` |
| T77 | `DELETE /api/download/:id` | **Delete**: Delete completed → verify `{id, deleted:true}` |
| T78 | `GET /api/settings` | **Get all**: Verify returns all 10 default settings |
| T79 | `PUT /api/settings` | **Update**: Change default_threads to '16' → verify updated |
| T80 | `PUT /api/settings` | **Invalid key**: Send unknown key → verify filtered out, not saved |
| T81 | `PUT /api/settings` | **Invalid body**: Send string instead of object → verify 400 |
| T82 | `GET /api/stats` | **With downloads**: 3 downloads (1 completed, 1 active, 1 failed) → verify counts match |
| T83 | WebSocket `/ws` | **Connection**: Connect → verify receives init message with active downloads |
| T84 | WebSocket `/ws` | **Progress broadcast**: Active download → verify progress messages every 500ms |
| T85 | WebSocket `/ws` | **Origin validation**: Connect from disallowed origin → verify connection closed (4003) |
| T86 | `broadcast()` | **Custom event**: Broadcast `{type:'test'}` → verify all clients receive |
| T87 | `start()` | **Port in use**: Start twice → verify EADDRINUSE error |
| T88 | `stop()` | **Graceful**: Active downloads + clients → verify all closed cleanly |
| T89 | Rate limiting | **100 requests**: Send 101 requests in 1 minute → verify 429 on 101st |

### 3.6 src/db/sqlite.js

| # | Function | Test Scenario |
|---|----------|---------------|
| T90 | `IDMAMDatabase.create()` | **New DB**: Create with non-existent path → verify creates file + tables |
| T91 | `IDMAMDatabase.create()` | **Existing DB**: Create with existing path → verify loads data |
| T92 | `save()` | **Persistence**: Create record → save → read file → verify data present |
| T93 | `createDownload()` | **Full fields**: Create with all fields → verify inserted correctly |
| T94 | `createDownload()` | **Minimal fields**: Create with only required fields → verify defaults applied |
| T95 | `getDownload()` | **Existing**: Insert then get → verify all fields match |
| T96 | `getDownload()` | **Not found**: Get non-existent → verify returns null |
| T97 | `listDownloads()` | **All**: 5 downloads → verify returns 5 ordered by created_at DESC |
| T98 | `listDownloads()` | **By status**: Filter 'completed' → verify returns only completed |
| T99 | `updateDownload()` | **Allowed fields**: Update status, downloaded, speed → verify updated |
| T100 | `updateDownload()` | **Disallowed fields**: Try to update 'id' → verify ignored |
| T101 | `updateDownload()` | **Field name mapping**: totalSize → total_size, mimeType → mime_type |
| T102 | `deleteDownload()` | **With chunks**: Download has 4 chunks → verify chunks also deleted |
| T103 | `createChunks()` | **Batch insert**: 8 chunks → verify all 8 inserted |
| T104 | `getChunks()` | **Order**: Verify chunks returned ordered by chunk_index ASC |
| T105 | `updateChunk()` | **Downloaded bytes**: Update to 50% → verify updated |
| T106 | `getDownloadWithChunks()` | **Join**: Download with chunks → verify includes chunks array |
| T107 | `getSetting()` | **Existing**: Get 'default_threads' → verify returns '8' |
| T108 | `getSetting()` | **Not found**: Get 'nonexistent' → verify returns null |
| T109 | `getSettingInt()` | **Parse**: Get integer setting → verify returns number |
| T110 | `getAllSettings()` | **Defaults**: Fresh DB → verify 10 default settings |
| T111 | `setSetting()` | **New**: Set 'custom_key' → verify inserted |
| T112 | `setSetting()` | **Update**: Change existing → verify updated |
| T113 | `updateSettings()` | **Batch**: Update 3 settings → verify all updated |
| T114 | `getStats()` | **Mixed statuses**: 5 downloads (2 completed, 1 active, 1 failed, 1 paused) → verify counts |
| T115 | `getResumableDownloads()` | **Filter**: 3 completed + 2 paused → verify returns 2 paused |
| T116 | `close()` | **Cleanup**: Close → verify save called, interval cleared, DB closed |
| T117 | Auto-save interval | **Dirty flag**: Make change → wait 6s → verify file updated on disk |

### 3.7 src/utils/filename.js

| # | Function | Test Scenario |
|---|----------|---------------|
| T118 | `parseContentDisposition()` | **Standard quoted**: `attachment; filename="file.zip"` → verify returns "file.zip" |
| T119 | `parseContentDisposition()` | **Standard unquoted**: `attachment; filename=file.zip` → verify returns "file.zip" |
| T120 | `parseContentDisposition()` | **RFC 5987**: `filename*=UTF-8''%E4%B8%AD%E6%96%87.zip` → verify returns "中文.zip" |
| T121 | `parseContentDisposition()` | **Null/empty**: null/"" → verify returns null |
| T122 | `filenameFromUrl()` | **Simple**: `http://example.com/path/file.zip` → verify returns "file.zip" |
| T123 | `filenameFromUrl()` | **Encoded**: `http://example.com/my%20file.zip` → verify returns "my file.zip" |
| T124 | `filenameFromUrl()` | **Trailing slash**: `http://example.com/path/` → verify returns null |
| T125 | `filenameFromUrl()` | **No path**: `http://example.com` → verify returns null |
| T126 | `sanitizeFilename()` | **Illegal chars**: `file<>:"/\|?*.zip` → verify all replaced with _ |
| T127 | `sanitizeFilename()` | **Reserved name**: `CON` → verify returns `_CON` |
| T128 | `sanitizeFilename()` | **Long name**: 300 char name → verify truncated to 255, extension preserved |
| T129 | `sanitizeFilename()` | **Empty**: "" → verify returns "download" |
| T130 | `sanitizeFilename()` | **Trailing dots/spaces**: `file...  ` → verify trailing removed |
| T131 | `resolveFilename()` | **Priority**: Explicit + Content-Disposition + URL → verify explicit wins |
| T132 | `resolveFilename()` | **Content-Disposition only**: No explicit, has header → verify uses header |
| T133 | `resolveFilename()` | **URL only**: No explicit, no header, has URL → verify uses URL |
| T134 | `resolveFilename()` | **Fallback**: No explicit, no header, no URL → verify returns "download" |
| T135 | `ensureUniqueFilename()` | **No collision**: `file.zip` doesn't exist → verify returns "file.zip" |
| T136 | `ensureUniqueFilename()` | **One collision**: `file.zip` exists → verify returns "file (1).zip" |
| T137 | `ensureUniqueFilename()` | **Multiple collisions**: `file.zip`, `file (1).zip` exist → verify returns "file (2).zip" |

### 3.8 src/utils/hash.js

| # | Function | Test Scenario |
|---|----------|---------------|
| T138 | `hashFile()` | **Known content**: Write "hello" to file → verify returns correct SHA-256 |
| T139 | `hashFile()` | **Large file**: 100MB file → verify streams without OOM, returns correct hash |
| T140 | `hashFile()` | **Missing file**: Non-existent path → verify throws error |
| T141 | `verifyFile()` | **Match**: File with known hash → verify returns true |
| T142 | `verifyFile()` | **Mismatch**: Wrong expected hash → verify returns false |
| T143 | `verifyFile()` | **Case insensitive**: Uppercase expected → verify still matches |
| T144 | `hashString()` | **Known string**: "hello world" → verify returns expected SHA-256 |
| T145 | `hashBuffer()` | **Known buffer**: Buffer.from("test") → verify returns expected SHA-256 |
| T146 | `createHasher()` | **Streaming**: Feed data in 3 chunks → verify digest matches hash of concatenation |

### 3.9 src/utils/mime.js

| # | Function | Test Scenario |
|---|----------|---------------|
| T147 | `detectMime()` | **Video**: "movie.mp4" → verify returns "video/mp4" |
| T148 | `detectMime()` | **Audio**: "song.mp3" → verify returns "audio/mpeg" |
| T149 | `detectMime()` | **Archive**: "data.zip" → verify returns "application/zip" |
| T150 | `detectMime()` | **Document**: "report.pdf" → verify returns "application/pdf" |
| T151 | `detectMime()` | **Software**: "app.exe" → verify returns "application/vnd.microsoft.portable-executable" |
| T152 | `detectMime()` | **Image**: "photo.jpg" → verify returns "image/jpeg" |
| T153 | `detectMime()` | **Unknown**: "file.xyz" → verify returns "application/octet-stream" |
| T154 | `detectMime()` | **Case insensitive**: "FILE.MP4" → verify returns "video/mp4" |
| T155 | `parseContentType()` | **With charset**: "text/html; charset=utf-8" → verify returns "text/html" |
| T156 | `parseContentType()` | **Null**: null → verify returns null |
| T157 | `getCategoryFromMime()` | **Video**: "video/mp4" → verify returns "Videos" |
| T158 | `getCategoryFromMime()` | **Music**: "audio/mpeg" → verify returns "Music" |
| T159 | `getCategoryFromMime()` | **Archive**: "application/zip" → verify returns "Archives" |
| T160 | `getCategoryFromMime()` | **Document**: "application/pdf" → verify returns "Documents" |
| T161 | `getCategoryFromMime()` | **Software**: "application/vnd.microsoft.portable-executable" → verify returns "Software" |
| T162 | `getCategoryFromMime()` | **Unknown**: "application/octet-stream" → verify returns "Others" |
| T163 | `getCategoryFromMime()` | **Prefix fallback**: "video/custom" → verify returns "Videos" (prefix match) |
| T164 | `resolveCategory()` | **Content-Type priority**: Content-Type='video/mp4', filename='file.zip' → verify returns "Videos" |
| T165 | `resolveCategory()` | **Fallback to extension**: No Content-Type, filename='movie.mp4' → verify returns "Videos" |
| T166 | `resolveCategory()` | **Both unknown**: Unknown Content-Type + unknown extension → verify returns "Others" |

### 3.10 main.js

| # | Function | Test Scenario |
|---|----------|---------------|
| T167 | `main()` | **Startup**: Run with --auto-resume → verify DB initialized, server started on :9977 |
| T168 | `main()` | **Auto-resume**: 2 paused downloads + --auto-resume → verify both resumed |
| T169 | `main()` | **Graceful shutdown**: Send SIGINT → verify active downloads paused, server stopped |
| T170 | `formatBytes()` | **Zero**: 0 → verify returns "0 B" |
| T171 | `formatBytes()` | **KB**: 1024 → verify returns "1.00 KB" |
| T172 | `formatBytes()` | **MB**: 1048576 → verify returns "1.00 MB" |
| T173 | `formatBytes()` | **GB**: 1073741824 → verify returns "1.00 GB" |
| T174 | `printBanner()` | Verify outputs IDMAM ASCII art to console |

### 3.11 test.js — Integration Tests

| # | Function | Test Scenario |
|---|----------|---------------|
| T175 | `createTestFileServer()` | **Range support**: Request with Range header → verify 206 Partial Content |
| T176 | `createTestFileServer()` | **HEAD request**: Verify returns Content-Length, Accept-Ranges: bytes |
| T177 | `createTestFileServer()` | **Deterministic**: Verify test data is byte-repeating pattern (i % 256) |
| T178 | `apiRequest()` | **GET**: GET /api/health → verify returns parsed JSON |
| T179 | `apiRequest()` | **POST**: POST with body → verify body sent correctly |
| T180 | `runTests()` | **Full lifecycle**: Health → start → monitor → pause → resume → verify hash → list → stats |

---

## 4. Summary Statistics

- **Total Exported Functions/Methods**: 102
- **Total REST API Endpoints**: 11 (including WebSocket)
- **Total Features**: 15
- **Total Test Scenarios**: 180

### Coverage by Module

| Module | Exports | Tests |
|--------|---------|-------|
| downloader.js | 26 | 26 |
| chunk-worker.js | 4 | 9 |
| merge.js | 3 | 9 |
| resume.js | 11 | 17 |
| server.js | 4 + 11 endpoints | 28 |
| sqlite.js | 19 | 28 |
| filename.js | 5 | 20 |
| hash.js | 5 | 9 |
| mime.js | 6 | 20 |
| main.js | 3 | 8 |
| test.js | 4 | 6 |

---

## 5. Quality Observations

### Strengths
1. **Comprehensive error handling**: Try/catch blocks, best-effort cleanup
2. **Dual persistence**: SQLite + JSON files for resilience
3. **Resume capability**: Chunk-level resume with integrity validation
4. **Security**: Localhost binding, CORS whitelist, rate limiting, helmet
5. **Real-time updates**: WebSocket with 500ms broadcast interval
6. **Smart filename resolution**: RFC 5987 support, Windows-safe sanitization
7. **Auto-categorization**: MIME detection with 80+ file types

### Potential Issues
1. **Race condition**: `_checkCompletion` guards against double finalization but concurrent worker messages could cause issues
2. **Memory**: Speed samples array grows unbounded (trimmed to 3s window but not bounded)
3. **Concurrency**: No mutex on DB operations (sql.js is single-threaded in WASM but worker messages are async)
4. **File locking**: No file locks on chunk .part files (Windows may have issues)
5. **Cleanup**: `cleanupChunks` uses `rmdirSync` which fails if directory not empty

### Recommendations
1. Add unit tests for each exported function
2. Add integration tests for edge cases (network failures, disk full, corrupt files)
3. Consider adding request validation middleware
4. Add logging levels (debug, info, error)
5. Consider using a proper test framework (Jest, Mocha)
