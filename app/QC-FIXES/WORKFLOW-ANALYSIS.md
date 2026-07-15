# IDMAM — Workflow Analysis

> **Date:** 2026-07-15 | **Analyst:** MANAGER-001

---

## End-to-End Download Flow

```
User clicks "Download" in browser
        │
        ▼
┌─ Chrome Extension (background.js) ──────────────────────┐
│  1. chrome.downloads.onDeterminingFilename fires         │
│  2. Check: shouldIntercept(file)?                        │
│     - Extension: .mp4/.zip/.exe/.pdf → YES               │
│     - Small files <5MB → NO (browser handles)            │
│  3. Cancel browser download (chrome.downloads.cancel)    │
│  4. Send POST http://localhost:9977/api/download          │
│     {url, filename, filesize, cookies, referrer, mime}   │
│  5. Update badge: active download count                  │
└──────────────────────────────────────────────────────────┘
        │
        ▼
┌─ Express API Server (server.js :9977) ──────────────────┐
│  POST /api/download                                      │
│  1. Validate URL (new URL())                             │
│  2. Check concurrent limit (max_concurrent_downloads)    │
│  3. Resolve filename (URL parse + Content-Disposition)   │
│  4. Detect MIME → auto-categorize                        │
│  5. Create DB record (SQLite)                            │
│  6. Call downloader.startDownload()                      │
│  7. Return 201 {id, status, filename, threads}           │
└──────────────────────────────────────────────────────────┘
        │
        ▼
┌─ Download Engine (downloader.js) ───────────────────────┐
│  startDownload(state):                                   │
│                                                          │
│  1. PROBE: HEAD request                                  │
│     ├─ Content-Length? → total_size                      │
│     ├─ Accept-Ranges: bytes? → chunked mode              │
│     └─ No Range → single-stream mode                     │
│                                                          │
│  2. CHUNKED MODE:                                        │
│     chunk_size = total_size / threads                    │
│     chunks = [{start, end, index}, ...]                  │
│     Save to DB + resume file (download.json)             │
│                                                          │
│  3. SPAWN WORKERS (1 per chunk):                         │
│     ┌─ Worker Thread (chunk-worker.js) ──────────────┐  │
│     │  HTTP GET with Range: bytes=start-end           │  │
│     │  Write to chunk_000.part, chunk_001.part, ...   │  │
│     │  Report progress to parent                      │  │
│     │  Retry on failure (3x, exponential backoff)     │  │
│     │  Handle: 206 (partial), 416 (done), 200 (no    │  │
│     │          Range), 301-308 (redirect)             │  │
│     └─────────────────────────────────────────────────┘  │
│                                                          │
│  4. PROGRESS:                                            │
│     Worker → parentPort → _handleWorkerMessage           │
│     → _recalcProgress (500ms throttle)                   │
│     → DB update (downloaded, speed, eta)                 │
│     → WebSocket broadcast (500ms interval)               │
│     → UI / Extension receive real-time updates           │
│                                                          │
│  5. COMPLETION:                                          │
│     All chunks done → _finalizeDownload()                │
│     ├─ mergeChunks() → append all .part → final file    │
│     ├─ Verify size (total_size match)                    │
│     ├─ SHA-256 verify (if checksum provided)             │
│     ├─ Cleanup temp files (.part + download.json)        │
│     ├─ Update DB (status=completed, completed_at)        │
│     └─ Notify callback → WebSocket "completed" event     │
└──────────────────────────────────────────────────────────┘
```

## Pause/Resume Flow

```
PAUSE:
  User → POST /api/download/:id/pause
  → pauseDownload(state)
    1. _flushChunkState(): read actual .part file sizes from disk
    2. Save to DB: each chunk.downloaded = actual file size
    3. Save to resume file: download.json with current state
    4. Terminate all worker threads (worker.terminate())
    5. Update DB: status = "paused"
    6. Remove from active Map

RESUME:
  User → POST /api/download/:id/resume
  → resumeDownload(id)
    1. Load from DB (chunks table) + resume file (download.json)
    2. Cross-validate: DB ↔ resume ↔ disk (.part file sizes)
    3. Take the most-progressed value for each chunk
    4. Reset corrupted chunks (size > expected → delete .part, reset to 0)
    5. If all chunks done → finalize directly
    6. Spawn workers for remaining chunks
```

## Data Flow Diagram

```
┌──────────┐     POST /api/download      ┌──────────────┐
│  Chrome   │ ──────────────────────────▶ │  Express API  │
│ Extension │                             │  :9977        │
└──────────┘     GET /api/download/:id    └──────┬───────┘
       ▲        ┌───────────────────────────────┘
       │        │
       │   ┌────▼──────────────────────────────────────────┐
       │   │           DownloadManager                      │
       │   │  ┌─────────────────────────────────────────┐  │
       │   │  │  active Map<id, State>                   │  │
       │   │  │  State = {                               │  │
       │   │  │    id, url, filename, status,            │  │
       │   │  │    totalSize, downloaded, speed, eta,    │  │
       │   │  │    chunks[], workers[], requestHeaders   │  │
       │   │  │  }                                       │  │
       │   │  └─────────────────────────────────────────┘  │
       │   └────────────────────┬───────────────────────────┘
       │                        │
       │   ┌────────────────────▼───────────────────────────┐
       │   │         Worker Threads (chunk-worker.js)        │
       │   │  ┌──────┐ ┌──────┐ ┌──────┐      ┌──────┐    │
       │   │  │ W-0  │ │ W-1  │ │ W-2  │ ...  │ W-N  │    │
       │   │  │Range │ │Range │ │Range │      │Range │    │
       │   │  │HTTP  │ │HTTP  │ │HTTP  │      │HTTP  │    │
       │   │  └──┬───┘ └──┬───┘ └──┬───┘      └──┬───┘    │
       │   │     │        │        │              │         │
       │   │     ▼        ▼        ▼              ▼         │
       │   │  chunk_   chunk_   chunk_         chunk_       │
       │   │  000.part 001.part 002.part       N.part       │
       │   └────────────────────────────────────────────────┘
       │                        │
       │   ┌────────────────────▼───────────────────────────┐
       │   │              Merge + Verify                     │
       │   │  1. Append all .part files → final file         │
       │   │  2. Check size == totalSize                     │
       │   │  3. SHA-256 verify (if checksum)                │
       │   │  4. Cleanup temp/                               │
       │   └────────────────────────────────────────────────┘
       │                        │
       │   ┌────────────────────▼───────────────────────────┐
       │   │              SQLite (sql.js WASM)                │
       │   │  Tables: downloads, chunks, settings             │
       │   │  Auto-save every 5 seconds                      │
       │   └────────────────────────────────────────────────┘
       │
       │   ┌────────────────────────────────────────────────┐
       └───│           WebSocket (ws :9977/ws)               │
           │  Broadcast every 500ms to all connected clients │
           │  Events: progress, completed, error, paused     │
           └────────────────────────────────────────────────┘
```

## File System Layout

```
D:\IDMAM\app\
├── downloads/                    # Completed files land here
│   ├── Videos/                   # Auto-categorized by MIME
│   ├── Music/
│   ├── Documents/
│   ├── Software/
│   └── Others/                   # Default category
│
├── temp/                         # Active download chunks
│   └── <download-uuid>/
│       ├── chunk_000.part        # Chunk data
│       ├── chunk_001.part
│       ├── ...
│       └── download.json         # Resume state
│
└── data/
    └── idmam.db                  # SQLite database (sql.js WASM)
```

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Worker Threads (not child_process) | Shared memory, faster spawn, true parallelism |
| sql.js WASM (not better-sqlite3) | No native build step, works in Electron |
| Express on localhost:9977 | Extension communicates via HTTP, no native messaging needed |
| 500ms WebSocket broadcast | Balance between real-time feel and CPU usage |
| Resume file (download.json) | Survives crash even if DB auto-save hasn't fired |
| SHA-256 after merge | Verifies integrity of reassembled file |
| 3-way cross-validation on resume | DB + resume file + disk — takes most-progressed value |

## Known Limitations (v1)

| # | Limitation | Impact |
|---|-----------|--------|
| 1 | No authentication on API | Anyone on localhost can control downloads |
| 2 | No video grabber (v2 feature) | Cannot detect embedded video players |
| 3 | No scheduler (v2 feature) | Cannot queue downloads for later |
| 4 | No Firefox extension | Chrome only |
| 5 | No antivirus integration | No post-download scan |
| 6 | Rate limiter never evicts stale entries | Memory grows slowly (benign for localhost) |
| 7 | `updateChunkState` has no locking | Race condition possible on 8-thread writes |

---

**END WORKFLOW ANALYSIS**
