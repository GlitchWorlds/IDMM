# IDMAM QC v3 Report

**Date:** 2026-07-15 15:44 GMT+7
**Test environment:** D:\IDMAM\app (Windows, Node.js)

---

## Results Summary

| Check | Status | Details |
|-------|--------|---------|
| **Test (node test.js)** | ✅ PASS | 9/9 tests passed, 0 failed, 0 skipped |
| **F1 — Path Traversal** | ✅ PASS | `server.js:148-163` — `save_to` validated via `path.resolve()` against allowed roots; rejects if not under allowed root |
| **F13 — Atomic Merge** | ✅ PASS | `merge.js:23-46` — writes to `outputPath + '.part'` temp file, then `fs.renameSync(tempPath, outputPath)` for atomic swap |
| **R1 — Redirect Cap** | ✅ PASS | `chunk-worker.js:73,120` — `redirectCount` param, hard cap at `>= 5` redirects |
| **Extension Clean** | ✅ PASS | `popup.html`, `popup.js`, `options.html`, `options.js` — zero matches for `127.0.0.1` or `9977` |

**Overall: 5/5 PASS**

---

## Evidence

### Test Output
- Health check ✅
- Download start (4 threads, 10 MB testfile.bin) ✅
- Pause/Resume cycle ✅
- SHA-256 integrity verification ✅
- WebSocket connection ✅
- List downloads ✅
- Statistics ✅

### F1 — Path Traversal Protection
**File:** `app/src/server/server.js` (lines 135, 148-163)
- Extracts `save_to` from request body (line 135)
- Resolves `save_to` against `path.resolve()` (line 158)
- Validates resolved path is within allowed roots via `startsWith(root + path.sep)` (line 160)
- Returns `403` if path escapes allowed roots (line 163)

### F13 — Atomic Merge
**File:** `app/src/engine/merge.js` (lines 23-46)
- Writes chunks to `outputPath + '.part'` temp file (line 25)
- On completion, `fs.renameSync(tempPath, outputPath)` for atomic swap (line 38)
- Cleanup on failure: `fs.unlinkSync(tempPath)` (lines 40, 47, 55)

### R1 — Redirect Cap
**File:** `app/src/engine/chunk-worker.js` (lines 71-73, 120-126)
- `downloadChunk(attempt, currentUrl, redirectCount = 0)` (line 73)
- Hard cap: `if (redirectCount >= 5)` → reject (line 120)
- Recursive call increments: `redirectCount + 1` (line 126)

### Extension Privacy
- `popup.html`, `popup.js`, `options.html`, `options.js` in `electron/dist/.../extension/` — no hardcoded `127.0.0.1` or `9977` references found.

---

## New Issues Found

**None.** All checks passed cleanly.

---

## Verdict

✅ **ALL QC CHECKS PASSED** — v3 fixes verified intact, no regressions, no new issues.
