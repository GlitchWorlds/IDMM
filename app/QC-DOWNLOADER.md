# QC Audit — downloader.js (DownloadManager)

**File:** `D:\IDMAM\app\src\engine\downloader.js` | **Lines:** 869 | **Functions:** 26  
**Date:** 2026-07-15 | **Auditor:** Manager Agent (automated)

---

## Function-by-Function Verdict

| # | Function | Verdict | Notes |
|---|----------|---------|-------|
| 1 | `constructor` | ✅ | Correctly inits db, resume, settings, callbacks, active Map, speedSamples Map. |
| 2 | `startDownload` | ✅ | Full lifecycle: probe → filename → DB record → chunked/single. Settings coercion from strings is correct. |
| 3 | `pauseDownload` | ✅ | Sets `__terminated` on workers before terminate, flushes chunk state, saves resume file. Verbose but safe. |
| 4 | `resumeDownload` | ✅ | Loads DB + resume file, cross-validates chunks via `_buildResumeChunks`, reconstructs state correctly. |
| 5 | `cancelDownload` | ✅ | Terminates workers, cleans up temp files, updates DB. Works for both active and inactive downloads. |
| 6 | `deleteDownload` | ✅ | Cancels if active, deletes output file (best-effort), cleans temp, removes DB record. |
| 7 | `getDownloadState` | ✅ | Returns live state from active Map first, falls back to DB. Progress calculation correct. |
| 8 | `getActiveStates` | ✅ | Simple iteration over active Map with `_formatState`. |
| 9 | `getActiveCount` | ✅ | Returns `this.active.size`. Trivial and correct. |
| 10 | `_probeUrl` | ✅ | HEAD request with redirect chain (max 5), timeout, Range detection. Handles 301/302/303/307/308. |
| 11 | `_startChunkedDownload` | ✅ | Correct chunk math (`Math.ceil(totalSize/threads)`), guards `start > end`, saves to DB + resume file. |
| 12 | `_spawnWorkers` | ✅ | Skips done/completed chunks, checks existing .part files on disk, handles resume edge case (all done → finalize). |
| 13 | `_spawnWorker` | ✅ | Spawns Worker thread, wires message/error/exit handlers. `__terminated` guard on exit is correct. |
| 14 | `_handleWorkerMessage` | ❌ **BUG** | See **Bug #1** below. |
| 15 | `_cancelAllWorkers` | ✅ | Iterates workers, terminates non-exited, clears array. Correct. |
| 16 | `_buildResumeChunks` | ✅ | Three-way cross-validation: DB ↔ resume file ↔ disk (.part file size). Takes the most-progressed value. |
| 17 | `_getPerWorkerSpeedLimit` | ✅ | Divides global limit by active worker count (min 1). Correct. Speed limit is static per worker lifetime. |
| 18 | `_flushChunkState` | ⚠️ | See **Warning #1** below. Functionally correct but has performance issue. |
| 19 | `_startSingleStreamDownload` | ✅ | Checks existing .part file, creates single chunk descriptor, saves to DB/resume, delegates to `_doSingleStream`. |
| 20 | `_doSingleStream` | ⚠️ | See **Warning #2** below. |
| 21 | `_resumeSingleStreamDownload` | ✅ | Reuses `_doSingleStream` with existing bytes. Single-chunk detection for no-range-support case is correct. |
| 22 | `_resumeChunkedDownload` | ✅ | Validates chunk integrity, resets corrupted chunks (deletes .part, resets downloaded=0), re-spawns workers. |
| 23 | `_recalcProgress` | ⚠️ | See **Warning #3** below. |
| 24 | `_checkCompletion` | ⚠️ | See **Warning #4** below. |
| 25 | `_finalizeDownload` | ✅ | Merge + verify, DB update, resume cleanup, notify callbacks, error handling with cleanup. |
| 26 | `_formatState` | ✅ | Correct progress calc, speed rounding, per-chunk progress with division-by-zero guard (`end > start`). |

---

## Bugs Found

### ❌ Bug #1 — `_handleWorkerMessage` loses headers on range-not-supported fallback (HIGH)

**Location:** `_handleWorkerMessage`, `case 'error'` → `msg.noRangeSupport` branch (~line 458)  
**Impact:** Downloads from servers that don't support Range requests will fail if cookies/referrer/custom headers are required.

**The problem:** When a chunk worker discovers the server doesn't support Range requests, it sends an `error` message with `noRangeSupport: true`. The handler cancels all workers and calls `_startSingleStreamDownload` with **empty `requestHeaders: {}`**:

```js
this._startSingleStreamDownload(state, {
  retryCount: this.settings.retry_count || 3,   // ignores original retryCount
  timeoutMs: this.settings.timeout_ms || 30000,  // ignores original timeoutMs
  requestHeaders: {},  // ← BUG: all original headers lost
}).catch(...)
```

The original `opts` (containing `requestHeaders` with cookies, referrer, custom headers) from `_startChunkedDownload` is **not captured** in the closure, so it's unavailable when the worker sends this message asynchronously.

**The fix:** Store `requestHeaders` on the `state` object during `startDownload` / `resumeDownload`, then read it back in the fallback branch:

```js
// In startDownload, after building requestHeaders:
state.requestHeaders = requestHeaders;

// In _handleWorkerMessage, the fallback becomes:
this._startSingleStreamDownload(state, {
  retryCount: parseInt(this.settings.retry_count, 10) || 3,
  timeoutMs: parseInt(this.settings.timeout_ms, 10) || 30000,
  requestHeaders: state.requestHeaders || {},
}).catch(...)
```

---

## Warnings

### ⚠️ Warning #1 — `_flushChunkState`: DB query inside loop (LOW)

**Location:** `_flushChunkState` (~line 498)  
**Impact:** Performance — `this.db.getChunks(state.id)` is called once per chunk instead of once total.

```js
for (const chunk of state.chunks) {
  // ...
  const chunkRows = this.db.getChunks(state.id);  // ← queried N times
  const dbChunk = chunkRows.find(c => c.chunk_index === chunk.index);
}
```

**Fix:** Move the query above the loop:
```js
const chunkRows = this.db.getChunks(state.id);
for (const chunk of state.chunks) {
  const dbChunk = chunkRows.find(c => c.chunk_index === chunk.index);
  // ...
}
```

### ⚠️ Warning #2 — `_doSingleStream`: wrapper object never sets `exited: true` (MEDIUM)

**Location:** `_doSingleStream` (~line 558)  
**Impact:** `_formatState` will report an inflated `active_threads` count for single-stream downloads even after completion.

```js
state.workers.push({ terminate: () => req.destroy(), exited: false });
// exited is never set to true on completion or error
```

`_formatState` counts active threads via:
```js
active_threads: state.workers.filter(w => w && !w.exited).length
```

**Fix:** Set `exited = true` in the `res.on('end')` and error paths, or use a Proxy/getter that checks `req.destroyed`.

### ⚠️ Warning #3 — `_recalcProgress`: DB write on every progress tick (MEDIUM)

**Location:** `_recalcProgress` (~line 607)  
**Impact:** High-frequency DB writes during active downloads. `_handleWorkerMessage` fires on every worker progress message (potentially every few KB), and each call writes to DB.

```js
this.db.updateDownload(state.id, {
  downloaded: totalDownloaded,
  speed: state.speed,
  eta: state.eta,
});
```

The resume file already has throttling (`msg.downloaded % (1024 * 1024) < 65536`), but `_recalcProgress` has none.

**Fix:** Add a timestamp-based throttle (e.g., max once per 500ms) or reuse the chunk-level throttle pattern.

### ⚠️ Warning #4 — `_checkCompletion`: redundant `_finalizing` guard (LOW)

**Location:** `_checkCompletion` (~line 618)

```js
if (allDone) {
  state._finalizing = true;          // set here
  this._finalizeDownload(state);
} else if (anyFailed && !anyDownloading) {
  if (state._finalizing) return;     // checked again, but already true if we got here via allDone
  state._finalizing = true;
  // ...
}
```

The inner `if (state._finalizing) return` in the `else if` branch is dead code — if `allDone` was true, we already entered the first branch. If `allDone` was false, `_finalizing` can only be true from a previous call. This is harmless but indicates copy-paste from an earlier iteration.

---

## Summary

| Category | Count |
|----------|-------|
| ✅ Correct | **21** |
| ⚠️ Warning | **4** |
| ❌ Bug | **1** |

**Critical action item:** Bug #1 (lost headers on range-fallback) should be fixed before release — it will cause authentication failures for any download that requires cookies/referrer and falls back to single-stream.
