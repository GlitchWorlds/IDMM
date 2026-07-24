# IDMM Deep Code Review Report

**Review ID:** REVIEW-IDMM-002  
**Date:** 2025-01  
**Reviewer:** CODE-001 (Claude Code CLI)  
**Scope:** Full codebase review — architecture, process flow, efficiency  
**Confidence:** High — all findings verified by direct source code analysis

---

## Files Reviewed (20)

| File | Area |
|------|------|
| `app/src/engine/downloader.js` | Core download engine |
| `app/src/engine/chunk-worker.js` | Worker thread — chunk download |
| `app/src/engine/worker-pool.js` | Worker concurrency management |
| `app/src/engine/download-queue.js` | Priority queue logic |
| `app/src/engine/resume.js` | Pause/resume state management |
| `app/src/engine/merge.js` | Chunk merge + verification |
| `app/src/engine/speed-tracker.js` | Speed calculation |
| `app/src/server/server.js` | API server + WebSocket |
| `app/src/db/sqlite.js` | Database layer (sql.js) |
| `app/src/utils/ssrf.js` | SSRF protection |
| `app/src/utils/mime.js` | MIME detection + categorization |
| `app/src/utils/filename.js` | Filename resolution + sanitization |
| `app/src/utils/hash.js` | SHA-256 checksum utilities |
| `app/main.js` | Entry point (CLI mode) |
| `electron/main.js` | Electron desktop entry |
| `electron/preload.js` | Electron preload script |
| `extension/background.js` | Browser extension service worker |
| `extension/content.js` | Browser extension content script |
| `electron/ui/src/App.jsx` | React frontend main component |
| `electron/ui/src/hooks/useWebSocket.js` | WebSocket hook |
| `electron/ui/src/api.js` | Frontend API client |

---

## 1. Missing Features

| Priority | Feature | Notes |
|----------|---------|-------|
| **Critical** | **Batch/bulk download** | No API to submit multiple URLs at once. Users must add downloads one-by-one. Standard in all download managers (IDM, Free Download Manager, etc.). |
| **Critical** | **Download scheduling** | No way to schedule downloads for later (e.g., "start at 2 AM"). Only `--auto-resume` flag exists for crash recovery. |
| **Important** | **Download history search/pagination** | `listDownloads()` returns ALL rows with no pagination. Will degrade with thousands of downloads. No search filter in API. Frontend loads all downloads every 3s. |
| **Important** | **Bandwidth scheduling** | `speed_limit_global` setting exists but no time-based scheduling (e.g., unlimited at night, throttle during day). |
| **Important** | **Download categories management** | Categories are hardcoded (`Videos`, `Music`, `Documents`, `Archives`, `Software`, `Others`). No CRUD for custom categories. |
| **Important** | **Clipboard monitoring** | No auto-detect URL copied to clipboard (common in IDM). Extension only intercepts browser downloads, not clipboard. |
| **Nice-to-have** | **Video stream detection** | No detection of streaming media (m3u8/HLS, DASH). Only direct file downloads supported. |
| **Nice-to-have** | **Download-level retry** | Chunk-worker retries with exponential backoff (good), but if the entire download fails, it's not re-queued. No download-level retry mechanism. |
| **Nice-to-have** | **Proxy support** | No HTTP/SOCKS proxy support. Only direct connections. |
| **Nice-to-have** | **FTP/FTP-S support** | Only HTTP/HTTPS supported. No FTP protocol. |
| **Nice-to-have** | **Download prioritization UI** | Priority queue exists in backend (`DownloadQueue`), but no UI to change priority. `setPriority` API endpoint missing from server routes. |
| **Nice-to-have** | **Checksum on completion notification** | SHA-256 verification exists in `mergeAndVerify()`, but result is only stored in DB. No desktop notification or UI badge showing verification status. |

---

## 2. Wrong Processes

| # | Severity | Area | Current Behavior | Expected |
|---|----------|------|------------------|----------|
| WP-1 | **High** | DB concurrency — no transactions | `sql.js` is in-memory, auto-save every 5s. No transactions wrapping multi-row operations. `createChunks()` does N individual INSERTs without `BEGIN/COMMIT`. If process crashes between INSERTs, partial chunk records persist. | Wrap multi-row operations in `BEGIN; ... COMMIT;`. sql.js supports `db.run("BEGIN")` / `db.run("COMMIT")`. |
| WP-2 | **High** | `pauseDownload()` not awaited in server | `server.js` line ~213: `this.downloader.pauseDownload(req.params.id)` called without `await`. It's async (terminates workers, saves state, updates DB). API responds before pause completes. Client may see "downloading" status after API returns "paused". | Add `await`: `const result = await this.downloader.pauseDownload(req.params.id);` |
| WP-3 | **High** | `cancelDownload()` not awaited in server | `server.js` line ~229: Same issue. `cancelDownload` is async (terminates workers, cleans temp files, updates DB) but called synchronously. | Add `await`. |
| WP-4 | **High** | Queue never enforces concurrency | `startDownload()` always starts immediately if `active.size < maxConcurrent` (checked in server.js). But `_processQueue()` is never called after a download completes/cancels. So if 5 are active and 3 finish, queued items (if any were added beyond limit) never start. Queue is dead code. | Call `this._processQueue()` at end of `_finalizeDownload()` and `cancelDownload()`. |
| WP-5 | **Medium** | Electron `startServer()` doesn't wire callbacks | Electron's `main.js` creates `DownloadManager` without `onComplete`/`onError` callbacks. Server overwrites them in `start()`. But unlike app/main.js (which has FIX-5 for `onComplete` chain), Electron has no completion log handler. Inconsistent behavior between CLI and desktop modes. | Apply same `onComplete` chain pattern from app/main.js FIX-5 to electron/main.js. |
| WP-6 | **Medium** | `deleteDownload()` not awaited in server | `server.js` line ~245: `this.downloader.deleteDownload(req.params.id, deleteFile)` is async but not awaited. | Add `await`. |
| WP-7 | **Medium** | `getDownloadState()` — `getChunks` return value inconsistency | In `downloader.js`, `_startChunkedDownload` line ~413: `const dbChunks = this.db.getChunks(state.id); if (Array.isArray(dbChunks))` — but `getChunks()` returns `{ ok, data }`, not an array. This is a bug: the `if` always fails, so `chunkDbIds` is never populated for the initial chunked download path. | Should be: `const dbChunks = this.db.getChunks(state.id); if (dbChunks.ok && Array.isArray(dbChunks.data))`. |
| WP-8 | **Medium** | WebSocket broadcast sends per-download JSON individually | `server.js` broadcast loop (every 500ms): for each active download, `JSON.stringify` is called, then sent to each client individually. With 5 downloads × 3 clients = 15 `send()` calls per 500ms = 30 msg/s. | Batch all active states into one message: `{ type: 'progress', downloads: [...] }`. Serialize once, send to all. |
| WP-9 | **Medium** | `server.js` cancel broadcast sends `'failed'` status | `server.js` line ~231: On cancel, broadcasts `{ status: 'failed' }` instead of `{ status: 'cancelled' }`. Client UI shows "failed" for user-cancelled downloads. | Change to `status: 'cancelled'`. |
| WP-10 | **Low** | `mergeChunks` uses sync `existsSync` in async flow | `merge.js` line ~38: `fs.existsSync(chunkPath)` inside a Promise-based async function. Blocks the event loop. | Use `fsp.access()` or wrap in try/catch with `createReadStream` (which will throw if file doesn't exist). |
| WP-11 | **Low** | `_buildResumeChunks` uses sync file I/O | `downloader.js`: `fs.existsSync` + `fs.statSync` in a loop, inside an async method. Called during resume flow. | Use `fsp.access` + `fsp.stat` for non-blocking I/O. |
| WP-12 | **Low** | DB `getResumableDownloads` does N+1 query | For each resumable download, calls `this.getChunks(row.id)` individually. With 50 resumable downloads = 51 queries. | Use a JOIN query: `SELECT d.*, c.* FROM downloads d LEFT JOIN chunks c ON c.download_id = d.id WHERE d.status IN (...)`. Or at minimum, batch chunk queries. |

---

## 3. Efficiency Issues

| # | Area | Current Behavior | Proposed | Estimated Impact |
|---|------|------------------|----------|-------------------|
| E-1 | **DB write frequency** | `_recalcProgress()` calls `db.updateDownload()` every 500ms per active download. With 5 downloads = 10 DB writes/s. sql.js `save()` exports entire DB to disk. | Throttle to 2s, or batch updates. Consider WAL mode or better-sqlite3. | **High** — disk I/O bottleneck on active downloads. |
| E-2 | **sql.js full DB export on every save** | Every `save()` exports the entire database to a Buffer and writes to disk. DB size grows with download history. After 1000 downloads, each save could be writing megabytes. | Migrate to `better-sqlite3` (native, incremental writes, transaction support). Or at minimum, batch dirty writes. | **High** — scales very poorly. |
| E-3 | **Worker thread spawn overhead** | Each chunk spawns a new `Worker` thread. For a 32-thread download, that's 32 thread creations. No worker reuse across chunks or downloads. | Implement a persistent worker pool that reuses threads across chunks. Workers receive new `workerData` via `postMessage`. | **Medium** — overhead on multi-chunk downloads, especially many small files. |
| E-4 | **WebSocket serialization duplication** | Each progress broadcast: `JSON.stringify` per download per client. Same data serialized N times for N clients. | Serialize once, send raw string to all clients. `const msg = JSON.stringify(data); for (client of clients) client.send(msg);` | **Medium** — CPU scales with client count. |
| E-5 | **Frontend double data source** | `App.jsx` polls `getDownloads()` every 3s AND listens to WebSocket for real-time updates. Both update the same state. Double network traffic and potential race conditions. | WebSocket should be authoritative. Poll only as fallback every 10s+ or on reconnect. | **Medium** — unnecessary network/CPU, potential state flicker. |
| E-6 | **Speed samples array — O(n) shift** | In `_handleWorkerMessage`, samples are trimmed by 3s cutoff using `while + shift()`. `Array.shift()` is O(n) per call. With high-frequency progress messages (many threads), this is slow. | Use a circular buffer (ring buffer) or deque instead of array shift. Or just truncate from the front with `slice()` and reassign. | **Low-Medium** — noticeable on fast downloads with many threads (32+). |
| E-7 | **`getSorted()` copies entire queue** | `DownloadQueue.getSorted()` creates `[...this.queue].sort()` every call. `next()` calls `getSorted()` then `remove()` which does `findIndex` + `splice`. All O(n). | Use a binary heap (priority queue) for O(log n) operations. Or maintain sorted order on insert. | **Low** — queue is typically small (< 20 items). |
| E-8 | **No HTTP keep-alive in chunk-worker** | Each chunk creates a new HTTP request with a new TCP connection. No connection reuse across chunks or retry attempts. | Use `http.Agent` with `keepAlive: true` and share agent across requests in the same worker. Or pass a shared agent from DownloadManager. | **Medium** — TCP handshake overhead, especially for many small chunks from the same server. |
| E-9 | **`_flushChunkState` sync file I/O** | Uses `fs.existsSync` + `fs.statSync` per chunk during flush. Called on every pause operation. | Use `fsp.access` + `fsp.stat`. Or cache file sizes from worker progress messages. | **Low** — only called on pause, not in hot path. |
| E-10 | **Electron `preload.js` hardcoded version** | `version: '1.2.5'` in `preload.js` — stale, doesn't match `package.json` v1.2.7. | Read from `package.json` at build time or use `process.env.npm_package_version`. | **Low** — cosmetic but misleading to UI. |

---

## 4. Confidence

**High** — All findings verified by reading source code directly. Architectural patterns and data flows traced end-to-end. File paths and line numbers referenced from current codebase state (post v1.2.7 audit fixes).

---

## 5. Recommendations (Top 5 by Impact)

### 1. Fix async/await bugs in server.js (WP-2, WP-3, WP-6)

**Problem:** `pauseDownload()`, `cancelDownload()`, and `deleteDownload()` are async but called without `await` in server route handlers. API responds before the operation completes.

**Fix:** Add `await` to three route handlers. ~3 line changes.

**Impact:** High — correctness bug affecting API contract. Clients see stale state after API returns. Quick fix.

---

### 2. Migrate from sql.js to better-sqlite3 (E-1, E-2, WP-1)

**Problem:** `sql.js` exports the entire database to a Buffer on every `save()`. With 100+ downloads, each 500ms progress flush writes megabytes to disk. No transaction support — multi-row operations can leave partial state.

**Fix:** Replace `sql.js` with `better-sqlite3`:
- Native C++ binding (no WASM overhead)
- Incremental writes (only changed pages flushed)
- Native transaction support (`db.transaction(() => { ... })`)
- Synchronous API (no callback hell, actually faster for small queries)

**Impact:** Highest — eliminates the biggest performance bottleneck. Database operations go from O(DB_size) per write to O(changed_pages).

---

### 3. Wire `_processQueue()` into completion/cancellation flow (WP-4)

**Problem:** Queue is dead code. Downloads added beyond `maxConcurrent` limit are never started because `_processQueue()` is never called after a download finishes or is cancelled.

**Fix:** Add `this._processQueue()` calls at:
- End of `_finalizeDownload()` (after successful completion)
- End of `cancelDownload()` (after cleanup)
- End of `pauseDownload()` (after state saved)

**Impact:** Critical for multi-download scenarios. Without this, the "queue" feature is non-functional.

---

### 4. Batch WebSocket broadcasts (WP-8, E-4)

**Problem:** Server sends individual `client.send()` for EACH active download to EACH client every 500ms. 5 downloads × 3 clients = 15 messages per 500ms. Each message is separately `JSON.stringify`-d.

**Fix:**
```javascript
// Instead of per-download messages:
const batch = { type: 'progress', downloads: states };
const message = JSON.stringify(batch);  // Serialize once
for (const client of this.wsClients) {
  if (client.readyState === 1) {
    try { client.send(message); } catch { this.wsClients.delete(client); }
  }
}
```

**Impact:** Medium — reduces syscalls and CPU proportional to `active_downloads × clients`. Also simplifies frontend handling (single message with all updates).

---

### 5. Add HTTP keep-alive agent to chunk-worker (E-8)

**Problem:** Each chunk request creates a new TCP connection. For a 32-thread download, that's 32 TCP handshakes (+ TLS if HTTPS). No connection reuse across retry attempts either.

**Fix:**
```javascript
const http = require('node:http');
const https = require('node:https');

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });

// In downloadChunk():
const agent = isHttps ? httpsAgent : httpAgent;
const reqOptions = { ..., agent };
```

**Impact:** Medium — eliminates TCP/TLS handshake overhead. Measurable speed improvement for multi-chunk downloads from same server. Low effort to implement.

---

## Appendix: Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Extension                         │
│  background.js (intercept) → REST API → content.js (metadata)│
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP :9977
┌──────────────────────────▼──────────────────────────────────┐
│                     IDMMServer (server.js)                   │
│  Express REST + WebSocket broadcast + Rate limiting + CORS  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  DownloadManager (downloader.js)              │
│  startDownload → probe → chunk split → spawn workers         │
│  pause/resume/cancel → state management → finalize           │
├────────────┬─────────────┬──────────────┬──────────────────┤
│ WorkerPool  │ SpeedTracker │ DownloadQueue │ ResumeManager   │
│ (health)    │ (samples)    │ (priority)    │ (state files)   │
└────────────┴─────────────┴──────────────┴──────────────────┘
                           │
              ┌────────────▼────────────┐
              │   chunk-worker.js (×N)   │
              │   HTTP Range download    │
              │   Retry + backoff        │
              │   Speed limiting         │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │    merge.js              │
              │    Merge + SHA-256       │
              │    Atomic rename         │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │    sqlite.js (sql.js)    │
              │    downloads + chunks    │
              │    settings + stats      │
              └─────────────────────────┘
```

### Key Data Flows

**Download Flow:**
1. Client POST `/api/download` → server validates URL (SSRF check) → `downloader.startDownload()`
2. `_probeUrl()` HEAD request → get size + Range support
3. Split into N chunks → `createChunks()` in DB → spawn N worker threads
4. Each worker: HTTP Range GET → write to `.part` file → progress via `postMessage`
5. `onProgress` → `_recalcProgress()` → DB update (500ms throttle) → WebSocket broadcast
6. All chunks done → `_finalizeDownload()` → `mergeAndVerify()` → atomic rename → cleanup

**Resume Flow:**
1. `resumeDownload(id)` → DB lookup → `loadState()` from resume JSON
2. `_buildResumeChunks()` → cross-reference DB + resume file + disk (.part sizes)
3. Re-spawn workers for incomplete chunks → continue download

**Pause Flow:**
1. `pauseDownload(id)` → flush chunk state to DB + resume file
2. Terminate all workers → update DB status → save resume state
3. Remove from active map → clear speed samples

---

*End of report.*
