# IDMAM — CONSOLIDATED FIX TASK (QC + Audit Findings)

> Generated: 2026-07-15 14:35 WIB
> Sources: QC-INTEGRATION-REPORT.md + AUDIT-REPORT.md

## Priority P0 — MUST FIX

### F1 — Path traversal via save_to (S2.1)
File: D:\IDMAM\app\src\server\server.js
Problem: save_to parameter from API request flows to downloader without path validation. Attacker could write files anywhere.
Fix: Validate resolved output path stays under default_save_path or allowed roots. Add path.resolve() + startsWith() check.

### F2 — Unhandled rejection in single-stream (Q1.2)
File: D:\IDMAM\app\src\engine\downloader.js
Function: _doSingleStream / _startSingleStreamDownload
Problem: req.on('error') can reject after res.on('end') already resolved → unhandled rejection.
Fix: Add resolved flag guard around resolve/reject.

### F3 — Resume-already-active guard (T8 QC finding)
File: D:\IDMAM\app\src\engine\downloader.js
Function: resumeDownload()
Problem: If called while download already active, overwrites active Map entry and spawns duplicate workers.
Fix: Add guard: if (this.active.has(downloadId)) throw new Error('Download already active')

### F4 — Pause-already-paused better message (T8 QC finding)
File: D:\IDMAM\app\src\engine\downloader.js
Function: pauseDownload()
Problem: Generic "not active" message when download is already paused.
Fix: Check DB status, return "Download already paused" vs "Download not active".

## Priority P1 — SHOULD FIX

### F5 — Extension CSP (S5.1)
File: D:\IDMAM\extension\manifest.json
Problem: No explicit Content Security Policy declared.
Fix: Add content_security_policy to manifest.

### F6 — WS maxPayload (S4.2)
File: D:\IDMAM\app\src\server\server.js
Problem: No WebSocket message size limit. Malicious client could send huge message.
Fix: Set maxPayload: 64 * 1024 on WebSocketServer.

### F7 — WS heartbeat (S4.3)
File: D:\IDMAM\app\src\server\server.js
Problem: No ping/pong heartbeat. Dead connections accumulate.
Fix: Add isAlive ping/pong interval (30s).

### F8 — Chunk progress DB optimization (Q4.2)
File: D:\IDMAM\app\src\engine\downloader.js
Function: _handleWorkerMessage progress handler
Problem: getChunks() called on every 64KB data → full table scan per update.
Fix: Cache chunk DB IDs in state object at download start.

### F9 — Rate limiter cleanup (S1.3)
File: D:\IDMAM\app\src\server\server.js
Problem: rateLimitMap grows unbounded.
Fix: Add TTL-based eviction (cleanup entries older than 1 minute every 5 minutes).

## Priority P2 — NICE TO HAVE

### F10 — Duplicate download check (Q3.5)
File: D:\IDMAM\app\src\server\server.js
Problem: Same URL can be downloaded twice simultaneously.
Fix: Track active URLs, return 409 if URL already downloading.

### F11 — Unbounded worker concurrency (S3.2)
File: D:\IDMAM\app\src\engine\downloader.js
Problem: 64 threads × 5 downloads = 320 workers possible. No global cap.
Fix: Add global worker semaphore (max 128 total).

### F12 — Resume file debouncing (Q4.5)
File: D:\IDMAM\app\src\engine\resume.js
Function: updateChunkState()
Problem: Full file rewrite on every chunk update (~64/sec for 64-thread download).
Fix: Debounce saveState calls to max once per 500ms.

### F13 — Non-atomic merge output (S2.4)
File: D:\IDMAM\app\src\engine\merge.js
Problem: Non-atomic output file write. Crash during merge = corrupt partial.
Fix: Write to temp name first, rename on completion.

### F14 — Rate limiter in-memory (S1.3 alt)
Already covered by F9.

### F15 — Symlink protection (S2.3)
File: D:\IDMAM\app\src\engine\merge.js, downloader.js
Problem: No symlink check before write.
Fix: Low priority for localhost app. Skip unless requested.

## Output Contract
1. Fix all P0 items (F1-F4) — mandatory
2. Fix all P1 items (F5-F9) — mandatory
3. Fix P2 items (F10-F13) — optional, best effort
4. After all fixes: cd D:\IDMAM\app && node test.js — all 9 tests must pass
5. Report: files changed, what was fixed, test results
