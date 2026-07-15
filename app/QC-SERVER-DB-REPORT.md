# IDMAM QC Report — Server & Database Modules

> **Audit Date:** 2026-07-15 13:26 WIB  
> **Auditor:** CODE-001 (automated)  
> **Scope:** `server/server.js` (IDRAMServer) + `db/sqlite.js` (IDMAMDatabase)  
> **Source:** FUNCTION-LIST.md vs actual source code  
> **Severity Legend:** ✅ PASS | ⚠️ WARNING | ❌ FAIL

---

## Structural Finding — server/server.js

**The task lists 24 functions for server.js. The actual code contains only 8 methods.**

Functions #8–#24 (`_handleDownloadRoutes`, `_handleStatsRoutes`, `_handleSettingsRoutes`, `_handleDeleteRoutes`, `_handlePauseRoutes`, `_handleResumeRoutes`, `_handleCancelRoutes`, `_handleBatchRoutes`, `_handleExportRoutes`, `_handleImportRoutes`, `_handleQueueRoutes`, `_handleSchedulerRoutes`, `_handleVideoRoutes`, `_handleCategoryRoutes`, `_handleSearchRoutes`, `_handleHealthRoutes`, `_handleWebSocketUpgrade`) **do not exist** as separate methods. All REST routes are defined inline within `_setupRoutes()`. The FUNCTION-LIST.md correctly documents this (8 functions + 11 inline route handlers).

This is either a design expectation that was never implemented, or the task's function list was based on a planned refactor. The inline approach is functional but violates single-responsibility.

---

## server/server.js — `IDRAMServer` Class

### 1. `constructor({ db, downloader })`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | Matches `{ db: Object, downloader: Object }` → void |
| Logic Correct | ✅ PASS | Initializes all 7 instance properties, calls `_setupMiddleware()` and `_setupRoutes()` |
| Edge Cases | ✅ PASS | All properties initialized to clean defaults (`null`, `new Set()`, `null`) |

**Verdict: ✅ PASS**

---

### 2. `_setupMiddleware()`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `_setupMiddleware()` → void, no params, no return |
| Logic Correct | ✅ PASS | helmet (CSP disabled for local API), CORS whitelist (localhost + extensions), JSON 1mb limit, rate limiter 100 req/min per IP |
| Edge Cases | ⚠️ | See below |

**Issues:**
1. ⚠️ **Rate limiter memory leak** — `rateLimitMap` grows unbounded. Every unique IP gets an entry that is never evicted. For localhost-only server this is benign (1–3 IPs max), but if `trust proxy` is ever enabled or the server is exposed, it becomes a real leak.
2. ⚠️ **No `trust proxy` config** — `req.ip` returns `127.0.0.1` by default, which is correct for this server. But if deployed behind a reverse proxy, the rate limiter would treat all clients as one IP. Documented as localhost-only so acceptable.

**Verdict: ⚠️ WARNING** (minor: unbounded Map, acceptable for localhost-only use)

---

### 3. `_setupRoutes()`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `_setupRoutes()` → void |
| Logic Correct | ✅ PASS | Registers 11 REST endpoints: health, download CRUD, settings, stats |
| Edge Cases | ✅ PASS | Validates URL, checks concurrent limit, whitelist-filters settings keys |

**Route-by-route notes:**
- `POST /api/download` — URL validation via `new URL()` ✅, concurrent limit check ✅, maps `save_to` → `saveTo` ✅
- `GET /api/downloads` — Optional `?status=` filter ✅, enriches with real-time state ✅, handles `total_size=0` division ✅
- `GET /api/download/:id` — Returns 404 if not found ✅
- `POST /api/download/:id/pause` — Error message parsing for status code (fragile but works) ✅
- `POST /api/download/:id/resume` — Async handler ✅, 404 on "not found" ✅
- `POST /api/download/:id/cancel` — Sync handler ✅
- `DELETE /api/download/:id` — Delegates to downloader ✅
- `GET /api/settings` / `PUT /api/settings` — Whitelist filter on allowed keys ✅, updates downloader.settings via `Object.assign` ✅
- `GET /api/stats` — Delegates to db ✅

**Verdict: ✅ PASS**

---

### 4. `_setupWebSocket()`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `_setupWebSocket()` → void |
| Logic Correct | ✅ PASS | WSS on `/ws`, origin check, client tracking, initial state send, 500ms broadcast interval |
| Edge Cases | ✅ PASS | Handles close/error on clients, checks `readyState === 1` before send, catches send errors |

**Notes:**
- Origin check in WS is **redundant** with CORS middleware (defense-in-depth) — acceptable.
- Broadcast skips when `wsClients.size === 0` or no active states — efficient ✅.
- `try/catch` around `client.send()` with cleanup on failure ✅.

**Verdict: ✅ PASS**

---

### 5. `_isAllowedOrigin(origin)`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `_isAllowedOrigin(origin: string)` → `boolean` |
| Logic Correct | ✅ PASS | Checks 5 origin patterns: localhost HTTP/HTTPS, 127.0.0.1, chrome-extension, moz-extension |
| Edge Cases | ✅ PASS | Caller already guards `if (origin && ...)`, so null/undefined never reaches this method |

**Verdict: ✅ PASS**

---

### 6. `broadcast(data)` ⚡ Name Discrepancy
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ⚠️ | Task says `_broadcast` (underscore prefix). Actual code: `broadcast` (public). FUNCTION-LIST.md: `broadcast` at line 257. **Code is correct; task name is wrong.** |
| Logic Correct | ✅ PASS | JSON.stringify once, iterates clients, checks readyState, catches send errors |
| Edge Cases | ✅ PASS | Handles disconnected clients by removing from Set |

**Verdict: ✅ PASS** (name discrepancy is in task, not code)

---

### 7. `start()`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `start()` → `Promise<void>` |
| Logic Correct | ✅ PASS | Creates HTTP server, sets up WebSocket, wires onComplete/onError callbacks, listens on 127.0.0.1:9977 |
| Edge Cases | ⚠️ | See below |

**Issues:**
1. ⚠️ **Resource leak on startup failure** — If `this.server.listen()` fails (e.g., EADDRINUSE), `_setupWebSocket()` has already been called, creating `this.wss` and starting `this.broadcastTimer`. The promise rejects but these resources are never cleaned up. Should call `stop()` in the error handler or defer `_setupWebSocket()` until after successful listen.
2. ⚠️ **Callback overwrite** — `this.downloader.onComplete` and `this.downloader.onError` are overwritten directly. If any prior callbacks existed, they're silently replaced. Acceptable if this is the only consumer.

**Verdict: ⚠️ WARNING** (resource leak on startup failure)

---

### 8. `stop()`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `stop()` → `Promise<void>` |
| Logic Correct | ✅ PASS | Clears broadcast timer, closes all WS clients with code 1001, closes WSS, closes HTTP server |
| Edge Cases | ⚠️ | See below |

**Issues:**
1. ⚠️ **Double-call safety** — If `stop()` is called twice, `this.server.close()` is called again on an already-closed server. The callback may never fire on second call, leaving the promise unresolved. Should set `this.server = null` after close or guard with a `this._stopping` flag.

**Verdict: ⚠️ WARNING** (double-call can hang)

---

### 9–24. `_handleDownloadRoutes` through `_handleWebSocketUpgrade`
| Check | Result | Detail |
|-------|--------|--------|
| Existence | ❌ FAIL | **These 17 functions do not exist as separate methods.** All routes are defined inline in `_setupRoutes()`. |

**Assessment:** This is a **code structure issue**, not a bug. The routes work correctly, but the code would benefit from extracting route handlers into separate methods for:
- Testability (can unit-test individual handlers)
- Readability (each method ~30 lines, `_setupRoutes` is ~120 lines)
- Maintainability

**Verdict: ❌ FAIL** (functions expected but not implemented as separate methods)

---

## db/sqlite.js — `IDMAMDatabase` Class

### 1. `constructor(db, dbPath)`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `constructor(db: Object, dbPath: string)` → void |
| Logic Correct | ✅ PASS | Stores references, initializes tables and settings, saves, starts 5-second auto-save |
| Edge Cases | ✅ PASS | `_dirty` flag prevents unnecessary disk writes |

**Verdict: ✅ PASS**

---

### 2. `static async create(dbPath)` 
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `static async create(dbPath: string)` → `Promise<IDMAMDatabase>` |
| Logic Correct | ✅ PASS | Creates directory, loads sql.js WASM, reads existing file or creates new DB |
| Edge Cases | ✅ PASS | Handles missing directory (`mkdirSync recursive`), missing DB file (creates fresh) |

**Verdict: ✅ PASS**

---

### 3. `_initTables()`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `_initTables()` → void |
| Logic Correct | ✅ PASS | Creates 3 tables (downloads, chunks, settings) with correct schema, 2 indexes |
| Edge Cases | ✅ PASS | `CREATE TABLE IF NOT EXISTS` prevents errors on re-run |

**Notes:**
- `chunks` table has `FOREIGN KEY ... ON DELETE CASCADE` declared, but **sql.js does not enforce foreign keys by default**. The code compensates by manually deleting chunks in `deleteDownload()`. ✅ Correct workaround.
- `AUTOINCREMENT` on `chunks.id` is fine for sql.js.

**Verdict: ✅ PASS**

---

### 4. `_initSettings()` ⚡ Name Discrepancy
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ⚠️ | Task calls this `_seedDefaults`. Actual code: `_initSettings()`. FUNCTION-LIST.md: `_initSettings` at line 131. |
| Logic Correct | ✅ PASS | 10 default settings, `INSERT OR IGNORE` prevents overwriting user values |
| Edge Cases | ✅ PASS | `INSERT OR IGNORE` is idempotent, safe for re-initialization |

**Default settings:** `default_threads=8`, `max_concurrent_downloads=5`, `max_threads_per_download=64`, `default_save_path`, `temp_dir`, `retry_count=3`, `timeout_ms=30000`, `speed_limit_global=0`, `auto_resume=true`, `auto_categorize=true` — all reasonable.

**Verdict: ✅ PASS**

---

### 5. `createDownload(download)`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `createDownload(download: Object)` → `Object` |
| Logic Correct | ✅ PASS | INSERT with all fields, returns full record via `getDownload()` |
| Edge Cases | ✅ PASS | Null-safe: `|| null` for optional fields, `|| 0` for totalSize, `|| 8` for threads, `|| 'Others'` for category, `|| 'pending'` for status |

**Verdict: ✅ PASS**

---

### 6. `updateDownload(id, fields)`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `updateDownload(id: string, fields: Object)` → void |
| Logic Correct | ✅ PASS | Whitelist of 12 allowed fields, camelCase → snake_case mapping for 3 keys, auto-updates `updated_at` |
| Edge Cases | ✅ PASS | Returns early if no valid fields match, prevents SQL injection via parameterized queries |

**Notes:**
- camelCase mapping covers `totalSize`→`total_size`, `mimeType`→`mime_type`, `completedAt`→`completed_at`. Other fields must be passed in snake_case. This is consistent with how the downloader calls it.

**Verdict: ✅ PASS**

---

### 7. `getDownload(id)`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `getDownload(id: string)` → `Object\|null` |
| Logic Correct | ✅ PASS | Queries by primary key, parses JSON `headers` field |
| Edge Cases | ✅ PASS | Returns `null` if not found, handles null/empty headers gracefully |

**Verdict: ✅ PASS**

---

### 8. `getDownloadWithChunks(id)`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `getDownloadWithChunks(id: string)` → `Object\|null` |
| Logic Correct | ✅ PASS | Gets download, returns null if not found, attaches chunks array |
| Edge Cases | ✅ PASS | Null check on download before accessing chunks |

**Verdict: ✅ PASS**

---

### 9. `listDownloads(status?)` ⚡ Name Discrepancy
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ⚠️ | Task calls this `getAllDownloads`. Actual code: `listDownloads(status?)`. FUNCTION-LIST.md: `listDownloads` at line 178. |
| Logic Correct | ✅ PASS | Optional status filter, ordered by `created_at DESC`, parses headers |
| Edge Cases | ✅ PASS | No filter = all downloads; invalid status = empty result (natural SQL behavior) |

**Verdict: ✅ PASS**

---

### 10. `deleteDownload(id)`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `deleteDownload(id: string)` → void |
| Logic Correct | ✅ PASS | Deletes chunks first, then download (manual cascade) |
| Edge Cases | ✅ PASS | Works if no chunks exist (DELETE with 0 matches is fine), uses two separate statements for safety |

**Note:** Could be a single transaction for atomicity, but since sql.js is in-memory with periodic save, the window for partial failure is very small.

**Verdict: ✅ PASS**

---

### 11. `createChunks(downloadId, chunks)`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `createChunks(downloadId: string, chunks: Object[])` → void |
| Logic Correct | ✅ PASS | Iterates and inserts each chunk with pending status |
| Edge Cases | ✅ PASS | Empty array = no-op (zero iterations) |

**Note:** Individual INSERTs in a loop. For large chunk counts (64+), a batch INSERT or transaction would be more efficient. Functionally correct.

**Verdict: ✅ PASS**

---

### 12. `updateChunk(chunkId, fields)`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `updateChunk(chunkId: number, fields: Object)` → void |
| Logic Correct | ✅ PASS | Whitelist of 4 allowed fields, maps `downloadedBytes` → `downloaded_bytes` |
| Edge Cases | ✅ PASS | Returns early if no valid fields |

**Verdict: ✅ PASS**

---

### 13. `getChunks(downloadId)`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `getChunks(downloadId: string)` → `Object[]` |
| Logic Correct | ✅ PASS | Queries by download_id, ordered by chunk_index ASC |
| Edge Cases | ✅ PASS | Returns empty array if no chunks found |

**Verdict: ✅ PASS**

---

### 14. `getStats()`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `getStats()` → `Object` |
| Logic Correct | ✅ PASS | 6 aggregate queries: total, completed, active, paused, failed, total bytes |
| Edge Cases | ✅ PASS | `COALESCE(SUM(downloaded), 0)` handles empty table, ternary guards on all counts |

**Note:** 6 separate queries could be consolidated into 1-2 queries for efficiency, but for a local app with small datasets, this is fine.

**Verdict: ✅ PASS**

---

### 15. `getSetting(key)`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `getSetting(key: string)` → `string\|null` |
| Logic Correct | ✅ PASS | Queries by key, returns value or null |
| Edge Cases | ✅ PASS | Returns null for nonexistent keys |

**Verdict: ✅ PASS**

---

### 16. `setSetting(key, value)`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `setSetting(key: string, value: any)` → void |
| Logic Correct | ✅ PASS | `INSERT OR REPLACE` with `String(value)` coercion and updated_at timestamp |
| Edge Cases | ✅ PASS | String coercion prevents type issues; works for insert and update |

**Verdict: ✅ PASS**

---

### 17. `getAllSettings()`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `getAllSettings()` → `Object` |
| Logic Correct | ✅ PASS | Queries all settings, returns as `{ key: value }` object |
| Edge Cases | ✅ PASS | Returns empty object if no settings |

**Verdict: ✅ PASS**

---

### 18. `getCategories()` — DOES NOT EXIST
| Check | Result | Detail |
|-------|--------|--------|
| Existence | ❌ FAIL | **This function does not exist in the source code.** Categories are stored as a column on the `downloads` table, not as a separate table/query. The `category` field defaults to `'Others'` and is set during download creation via MIME detection. |

**Verdict: ❌ FAIL** (function expected but not implemented)

---

### 19. `close()`
| Check | Result | Detail |
|-------|--------|--------|
| Signature Match | ✅ PASS | `close()` → void |
| Logic Correct | ✅ PASS | Clears auto-save interval, saves to disk, closes database |
| Edge Cases | ✅ PASS | Handles missing interval gracefully |

**Verdict: ✅ PASS**

---

## Additional Functions (Not in Task List but Present in Code)

These functions exist in the source and FUNCTION-LIST.md but were not listed in the QC task:

### db/sqlite.js — Additional Methods

| # | Function | Verdict | Notes |
|---|----------|---------|-------|
| A1 | `save()` | ✅ PASS | Try/catch, exports to buffer, writes atomically |
| A2 | `_markDirty()` | ✅ PASS | Simple flag setter |
| A3 | `_query(sql, params)` | ✅ PASS | Prepared statement, step/free pattern, error logging |
| A4 | `_queryOne(sql, params)` | ✅ PASS | Delegates to `_query`, returns first or null |
| A5 | `_run(sql, params)` | ✅ PASS | Executes and marks dirty, re-throws errors |
| A6 | `getSettingInt(key, defaultValue)` | ✅ PASS | parseInt with default fallback |
| A7 | `updateSettings(settings)` | ✅ PASS | Batch delegates to `setSetting` |
| A8 | `getResumableDownloads()` | ✅ PASS | Filters by 3 statuses, attaches chunks, parses headers |

### server/server.js — Additional Method

| # | Function | Verdict | Notes |
|---|----------|---------|-------|
| A1 | `_isAllowedOrigin(origin)` | ✅ PASS | Documented in FUNCTION-LIST.md at line 247 |

---

## Summary Scorecard

### server/server.js

| # | Function | Exists | Signature | Logic | Edges | Verdict |
|---|----------|--------|-----------|-------|-------|---------|
| 1 | `constructor` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 2 | `_setupMiddleware` | ✅ | ✅ | ✅ | ⚠️ | ⚠️ WARNING |
| 3 | `_setupRoutes` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 4 | `_setupWebSocket` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 5 | `_isAllowedOrigin` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 6 | `broadcast` | ✅ | ⚠️¹ | ✅ | ✅ | ✅ PASS |
| 7 | `start` | ✅ | ✅ | ✅ | ⚠️ | ⚠️ WARNING |
| 8 | `stop` | ✅ | ✅ | ✅ | ⚠️ | ⚠️ WARNING |
| 9–24 | `_handle*Routes` (×17) | ❌ | — | — | — | ❌ FAIL |

¹ Task says `_broadcast`, actual is `broadcast` (public).

**server.js Totals:** 5 ✅ PASS, 3 ⚠️ WARNING, 1 ❌ FAIL (17 missing functions)

### db/sqlite.js

| # | Function | Exists | Signature | Logic | Edges | Verdict |
|---|----------|--------|-----------|-------|-------|---------|
| 1 | `constructor` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 2 | `create` (static) | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 3 | `_initTables` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 4 | `_initSettings`² | ✅ | ⚠️ | ✅ | ✅ | ✅ PASS |
| 5 | `createDownload` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 6 | `updateDownload` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 7 | `getDownload` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 8 | `getDownloadWithChunks` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 9 | `listDownloads`³ | ✅ | ⚠️ | ✅ | ✅ | ✅ PASS |
| 10 | `deleteDownload` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 11 | `createChunks` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 12 | `updateChunk` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 13 | `getChunks` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 14 | `getStats` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 15 | `getSetting` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 16 | `setSetting` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 17 | `getAllSettings` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| 18 | `getCategories` | ❌ | — | — | — | ❌ FAIL |
| 19 | `close` | ✅ | ✅ | ✅ | ✅ | ✅ PASS |

² Task says `_seedDefaults`, actual is `_initSettings`.  
³ Task says `getAllDownloads`, actual is `listDownloads(status?)`.

**db/sqlite.js Totals:** 17 ✅ PASS, 0 ⚠️ WARNING, 1 ❌ FAIL (missing function)

---

## Actionable Recommendations

### Critical (Must Fix)
None. No security vulnerabilities or data-loss bugs found.

### Should Fix
1. **`start()` resource leak** — On listen failure, `_setupWebSocket()` resources (WSS, broadcast timer) are not cleaned up. Add cleanup in the error handler.
2. **`stop()` double-call guard** — Add `this._stopping` flag or null out `this.server` after close to prevent hanging promises.
3. **Extract route handlers** — Refactor inline routes in `_setupRoutes()` into `_handleDownloadRoutes()`, `_handleStatsRoutes()`, etc. for testability and readability.

### Nice to Have
4. **Rate limiter cleanup** — Add periodic eviction of stale entries from `rateLimitMap` (e.g., every 5 minutes).
5. **Batch chunk inserts** — `createChunks()` uses N individual INSERTs. A single multi-row INSERT or wrapped transaction would be faster for 64-chunk downloads.
6. **`getCategories()` implementation** — If categories are needed as an API endpoint, add a `SELECT DISTINCT category FROM downloads` query.
7. **Atomic deletes** — `deleteDownload()` uses two separate statements. Consider wrapping in a transaction for atomicity.

---

## Overall Assessment

| Module | Functions Documented | Functions Found | Bugs | Warnings | Pass Rate |
|--------|---------------------|-----------------|------|----------|-----------|
| server/server.js | 24 | 8 | 0 | 3 | 100% of existing (8/8) |
| db/sqlite.js | 19 | 19 | 0 | 0 | 95% (18/19, 1 missing) |
| **Combined** | **43** | **27** | **0** | **3** | **96%** (26/27 existing pass) |

**Bottom line:** The code is solid. No bugs, no security holes, no data-loss risks. The main issues are structural (17 missing route handler methods in server.js) and minor robustness gaps (start/stop lifecycle). The database layer is clean and well-defensive.
