# IDMAM QC Task — Full Integration Test

> **Date:** 2026-07-15 | **Auditor:** QC Team

## Mission
Verify IDMAM works end-to-end. Test every workflow path. Report bugs.

## Test Plan

### T1 — Server Health
- Start IDMAM server: cd D:\IDMAM\app && node src/server/server.js
- GET http://localhost:9977/api/health → expect 200
- Verify JSON response with uptime

### T2 — Download Lifecycle (Happy Path)
- POST /api/download with URL http://localhost:9978/testfile (10MB random)
- Verify 201 response with id, status=downloading, threads
- Wait for completion (poll GET /api/download/:id)
- Verify status=completed, downloaded=total_size
- Verify SHA-256 matches expected
- Verify file exists in downloads/

### T3 — Pause/Resume
- Start a slow download (http://localhost:9978/slowfile, 50MB with throttle)
- When progress > 20%, POST /api/download/:id/pause
- Verify status=paused, chunk states saved
- POST /api/download/:id/resume
- Verify download continues from saved progress
- Verify final file integrity (SHA-256)

### T4 — Cancel
- Start a download
- POST /api/download/:id/cancel before completion
- Verify status=failed, temp files cleaned

### T5 — Delete
- Complete a download
- DELETE /api/download/:id
- Verify removed from DB, file deleted

### T6 — Concurrent Downloads
- Start 3 downloads simultaneously
- Verify all progress independently
- Verify active_threads count is correct per download

### T7 — WebSocket
- Connect to ws://localhost:9977/ws
- Verify initial state message received
- Start a download, verify progress messages arrive every ~500ms
- Verify completed message on finish

### T8 — Edge Cases
- POST with invalid URL → expect 400
- POST with non-existent URL → expect error
- GET with non-existent ID → expect 404
- Pause already-paused download → expect graceful handling
- Resume already-downloading download → expect graceful handling

### T9 — Settings
- GET /api/settings → expect all defaults
- PUT /api/settings {default_threads: 16} → verify persisted
- GET /api/settings → verify updated value

### T10 — Stats
- GET /api/stats → expect object with total, completed, active, paused, failed, totalBytes

## Output Contract
- One line per test: ✅ PASS / ❌ FAIL / ⚠️ WARNING
- Detail for failures
- Save to D:\IDMAM\app\QC-FIXES\QC-INTEGRATION-REPORT.md
