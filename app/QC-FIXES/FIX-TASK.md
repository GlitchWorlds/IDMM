# QC Fix Tasks — IDMAM

## Context
IDMAM (Internet Download Manager AI Max) at D:\IDMAM\app\
Node.js download manager with multi-threaded chunks, Express API, SQLite

## Bugs to Fix

### BUG #1 — merge.js stream leak (CRITICAL)
File: D:\IDMAM\app\src\engine\merge.js
Function: mergeChunks()
Problem: When chunk read fails or file is missing, reject() is called but outputStream is never destroyed. File descriptor leaks.
Fix: Add outputStream.destroy() before every reject() call in mergeChunks.

### BUG #2 — downloader.js lost headers on range fallback (HIGH)
File: D:\IDMAM\app\src\engine\downloader.js
Function: _handleWorkerMessage() → case 'error' → noRangeSupport branch
Problem: Fallback to _startSingleStreamDownload passes requestHeaders: {} instead of original headers. Cookies/referrer/custom headers are lost.
Fix: Store requestHeaders on the state object in startDownload, then read state.requestHeaders in the fallback branch.

### BUG #3 — chunk-worker.js missing fileStream error handler (MEDIUM)
File: D:\IDMAM\app\src\engine\chunk-worker.js
Function: downloadChunk()
Problem: fileStream has no 'error' handler. If write stream errors (disk full, permissions), promise hangs until HTTP timeout.
Fix: Add fileStream.on('error', reject) after creating the write stream.

### BUG #4 — downloader.js _doSingleStream exited flag (MEDIUM)
File: D:\IDMAM\app\src\engine\downloader.js
Function: _doSingleStream()
Problem: Wrapper object { terminate, exited: false } never sets exited: true on completion. Inflates active_threads count.
Fix: Set exited = true in res.on('end') and error paths.

### BUG #5 — downloader.js _recalcProgress unthrottled DB writes (MEDIUM)
File: D:\IDMAM\app\src\engine\downloader.js
Function: _recalcProgress()
Problem: Writes to DB on every progress tick (potentially every few KB). No throttle.
Fix: Add timestamp-based throttle — max once per 500ms. Use state._lastDbWrite timestamp.

### BUG #6 — server.js stop() double-call guard (LOW)
File: D:\IDMAM\app\src\server\server.js
Function: stop()
Problem: Calling stop() twice can leave the second promise unresolved forever.
Fix: Add this._stopping flag or null out this.server after close.

## Output Contract
1. Fix each bug in-place in the source files
2. After all fixes, run: cd D:\IDMAM\app && node test.js
3. All 9 tests must still pass
4. Report: which files changed, what was fixed, test results
