# QC Audit — chunk-worker.js

**File:** `D:\IDMAM\app\src\engine\chunk-worker.js`
**Date:** 2026-07-15
**Scope:** Worker thread, 4 functions

---

## Per-Function Audit

| # | Function | Verdict | Notes |
|---|----------|---------|-------|
| 1 | `report(type, data)` | ✅ | Correct: posts structured message to parentPort with chunkIndex/downloadId. Silent catch on closed port is acceptable for a worker that may be terminated. No issues. |
| 2 | `parseUrl(urlStr)` | ✅ | Correct: uses `new URL()` for spec-compliant parsing, reconstructs `pathname + search` for HTTP options. Edge case: auth-in-URL (`user:pass@host`) not forwarded — acceptable since extraHeaders can carry auth. Clean implementation. |
| 3 | `downloadChunk(attempt, currentUrl)` | ⚠️ | See detailed findings below. Core logic is solid (resume, redirect follow, 416/200/206 handling, speed limiter). Several edge-case gaps. |
| 4 | `main()` | ✅ | Correct retry loop with exponential backoff (1s→2s→4s, capped 10s). Correctly fast-fails on NO_RANGE_SUPPORT. Clean exit codes (0=success, 1=failure). Top-level `.catch()` handles truly fatal errors. No issues. |

---

## Detailed Findings — `downloadChunk`

### Strengths
- Resume-aware: checks existing file size, adjusts Range header, opens with `{ flags: 'a' }`.
- Redirect handling covers all 5 status codes (301–308), resolves relative `Location`.
- 416 Range Not Satisfiable treated as chunk-complete (correct heuristic).
- 200 response correctly detected as missing Range support, reported with `noRangeSupport: true`.
- Speed limiter uses token-bucket approach with response pause/resume.

### Issues

| Severity | Finding |
|----------|---------|
| ⚠️ Medium | **`fileStream` missing `'error'` handler.** If the write stream errors (disk full, permissions), the promise never rejects — it hangs until the HTTP timeout fires. Add `fileStream.on('error', reject)`. |
| ⚠️ Medium | **`bytesWritten` starts at `existingBytes` (0 on fresh download), but `fileStream` opens with `'a'` (append).** If a stale `.part` file exists from a *different* chunk or failed run with wrong data, the resumed bytes are corrupt. No integrity check or partial-hash validation on resume. |
| ⚠️ Low | **Speed limiter writes data to file even when tokens are negative.** The `res.pause()` throttles the *upstream*, but `fileStream.write(chunk)` still runs unconditionally for the chunk that triggered depletion. This is functionally correct (backpressure propagates on next read) but means the limiter is bursty — a large incoming chunk is fully written before pause takes effect. |
| ⚠️ Low | **Redirect does not reset `existingBytes`.** After following a redirect to a new URL, the resumed range is still based on the local file size. If the redirect target is a different resource (different content), the resume assumption breaks. |
| ℹ️ Info | **No HTTP keep-alive agent.** Each request creates a new TCP connection. For servers that support it, a keep-alive agent would reduce latency on retries. Low priority — correctness is fine. |

### Verdict

Functionally correct for the common case. The missing `fileStream.on('error')` is the most actionable fix — it can cause a silent hang on disk errors. The resume-without-integrity-check is a design trade-off acceptable for a download manager (the merged file should have its own hash verification later).

---

## Overall Assessment

**4/4 functions correct in core logic.** The worker is well-structured: clean separation of report/parse/download/main, proper retry with backoff, resume support, and redirect handling. The `⚠️` items on `downloadChunk` are edge-case hardening, not bugs in normal operation.

**Recommended fixes (priority order):**
1. Add `fileStream.on('error', reject)` in `downloadChunk` (~1 line)
2. Consider resetting/resuming from 0 on redirect to a different hostname (~3 lines)
3. Optionally: verify `.part` file hash before resuming (larger change)
