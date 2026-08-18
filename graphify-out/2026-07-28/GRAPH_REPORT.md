# Graph Report - IDMM  (2026-07-26)

## Corpus Check
- 72 files · ~61,413 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 949 nodes · 1175 edges · 50 communities (46 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `89b4c0d6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- api.js
- downloader.js
- nsis
- DownloadManager
- electron/package.json
- IDMMDatabase
- manifest.json
- integration.test.js
- app/package.json
- ui/package.json
- ResumeManager
- server.js
- electron/main.js
- 1. Exported Functions & API Endpoints
- app/main.js
- build-xpi.js
- test.js
- generate-icons.js
- deep-test.js
- Detailed Findings
- background.js
- hash.js
- patch.js
- preload.js
- Priority P2  NICE TO HAVE
- IDMM Security & Quality Audit Report
-  IDMM — Internet Download Manager Max
- Security Checklist
- IDMM v3 Security + Quality Audit Report
- IDMM v4 Security + Quality Audit Report
- CRITICAL BUG FIX: IDMM Packaged App Crash
- BUG LIST
- IDMM v2  REMAINING FIX TASK (QC + Audit v2)
- IDMM v4  REMAINING FIX TASK
- Bugs to Fix
- Task
- Dokumentasi Produksi IDMM (Internet Download Manager Max)
- IDMM Extension Fix Task  v5
- IDMM  Workflow Analysis
- IDMM  Internet Download Manager Max
- README.md
- Task
- IDMM  Workflow Analysis v2 (Post-Fix)
- 4. KOMPONEN DETAIL
- 7. DEVELOPMENT PHASES
- IDMM v1.2.0
- 8. API SPECIFICATION
- 11. CATATAN TEKNIS

## God Nodes (most connected - your core abstractions)
1. `DownloadManager` - 35 edges
2. `IDMMDatabase` - 31 edges
3. `ResumeManager` - 15 edges
4. `DownloadScheduler` - 15 edges
5. `nsis` - 15 edges
6. `ClipboardMonitor` - 14 edges
7. `IDMM Security & Quality Audit Report` - 14 edges
8. `IDMM  Internet Download Manager Max` - 13 edges
9. `request()` - 12 edges
10. `1. Exported Functions & API Endpoints` - 12 edges

## Surprising Connections (you probably didn't know these)
- `validateUrl()` --calls--> `isBlockedHost()`  [EXTRACTED]
  app/src/routes/batch.js → app/src/utils/ssrf.js
- `processSingleUrl()` --calls--> `validateDnsResolution()`  [EXTRACTED]
  app/src/routes/batch.js → app/src/utils/ssrf.js
- `Header()` --calls--> `formatSpeed()`  [EXTRACTED]
  electron/ui/src/components/Header.jsx → electron/ui/src/api.js
- `SpeedGraph()` --calls--> `formatSpeed()`  [EXTRACTED]
  electron/ui/src/components/SpeedGraph.jsx → electron/ui/src/api.js
- `downloadChunk()` --calls--> `validateRedirect()`  [EXTRACTED]
  app/src/engine/chunk-worker.js → app/src/utils/ssrf.js

## Import Cycles
- None detected.

## Communities (50 total, 4 thin omitted)

### Community 0 - "api.js"
Cohesion: 0.12
Nodes (28): addDownload(), cancelDownload(), deleteDownload(), formatBytes(), formatETA(), formatSpeed(), getDownload(), getDownloads() (+20 more)

### Community 1 - "downloader.js"
Cohesion: 0.12
Nodes (16): { detectMime, resolveCategory }, DownloadQueue, fs, fsp, _globalWorkerSemaphore, http, https, { mergeAndVerify } (+8 more)

### Community 2 - "nsis"
Cohesion: 0.05
Nodes (38): build, appId, asar, copyright, directories, extraResources, files, nsis (+30 more)

### Community 4 - "electron/package.json"
Cohesion: 0.06
Nodes (34): concurrently, electron, electron-builder, author, dependencies, cors, express, helmet (+26 more)

### Community 5 - "IDMMDatabase"
Cohesion: 0.10
Nodes (5): fs, fsp, IDMMDatabase, initSqlJs, path

### Community 6 - "manifest.json"
Cohesion: 0.06
Nodes (33): action, default_icon, default_title, background, service_worker, browser_specific_settings, gecko, content_scripts (+25 more)

### Community 7 - "integration.test.js"
Cohesion: 0.05
Nodes (20): DownloadQueue, Priority, SpeedTracker, WorkerPool, assert, crypto, { describe, it, before, after }, DownloadManager (+12 more)

### Community 8 - "app/package.json"
Cohesion: 0.07
Nodes (27): author, dependencies, cors, express, helmet, sql.js, uuid, ws (+19 more)

### Community 9 - "ui/package.json"
Cohesion: 0.08
Nodes (24): dependencies, react, react-dom, recharts, devDependencies, tailwindcss, @tailwindcss/vite, vite (+16 more)

### Community 10 - "ResumeManager"
Cohesion: 0.18
Nodes (4): fs, fsp, path, ResumeManager

### Community 11 - "server.js"
Cohesion: 0.07
Nodes (32): CATEGORIES_FILE, createCategoriesRouter(), crypto, DEFAULT_CATEGORIES, express, fs, fsp, generateCategoryId() (+24 more)

### Community 12 - "electron/main.js"
Cohesion: 0.10
Nodes (16): { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain }, APP_DIR, ClipboardMonitor, DATA_DIR, DB_PATH, DEFAULT_SAVE_PATH, DownloadManager, DownloadScheduler (+8 more)

### Community 13 - "1. Exported Functions & API Endpoints"
Cohesion: 0.06
Nodes (35): 1.10 main.js  Entry Point, 1.11 test.js  Integration Test, 1.1 src/engine/downloader.js  DownloadManager (Class), 1.2 src/engine/chunk-worker.js  Worker Thread, 1.3 src/engine/merge.js  Chunk Merger, 1.4 src/engine/resume.js  ResumeManager (Class), 1.5 src/server/server.js  IDRAMServer (Class), 1.6 src/db/sqlite.js  IDMMDatabase (Class) (+27 more)

### Community 14 - "app/main.js"
Cohesion: 0.25
Nodes (8): ensureUniqueFilename(), filenameFromUrl(), parseContentDisposition(), path, resolveFilename(), sanitizeFilename(), { URL }, RFC-5987

### Community 15 - "build-xpi.js"
Cohesion: 0.14
Nodes (13): buildZipManually(), crc32(), DIST_DIR, { execSync }, EXT_DIR, filesToInclude, fs, outputFile (+5 more)

### Community 16 - "test.js"
Cohesion: 0.22
Nodes (13): apiRequest(), cleanup(), createTestFileServer(), crypto, formatBytes(), formatSpeed(), fs, http (+5 more)

### Community 17 - "generate-icons.js"
Cohesion: 0.15
Nodes (13): compressed, crc32(), fs, ico, icoDir, icoHeader, ihdr, path (+5 more)

### Community 18 - "deep-test.js"
Cohesion: 0.20
Nodes (11): check(), crypto, files, fs, http, os, path, run() (+3 more)

### Community 19 - "Detailed Findings"
Cohesion: 0.06
Nodes (30): 1. `src\server\server.js`   PASS, 2. `src\engine\downloader.js`   PASS, 3. `src\engine\chunk-worker.js`   WARNING, 4. `src\engine\merge.js`   WARNING, 5. `src\engine\resume.js`   WARNING, 6. `src\db\sqlite.js`   PASS, 7. `extension\manifest.json`   PASS, Architecture Strengths Observed (+22 more)

### Community 20 - "background.js"
Cohesion: 0.36
Nodes (8): checkServer(), connectWebSocket(), interceptedIds, pollDownloads(), scheduleReconnect(), sendToIDMM(), updateBadge(), IDMM_API

### Community 21 - "hash.js"
Cohesion: 0.33
Nodes (5): crypto, fs, hashFile(), path, verifyFile()

### Community 26 - "Priority P2  NICE TO HAVE"
Cohesion: 0.10
Nodes (20): F10  Duplicate download check (Q3.5), F11  Unbounded worker concurrency (S3.2), F12  Resume file debouncing (Q4.5), F13  Non-atomic merge output (S2.4), F14  Rate limiter in-memory (S1.3 alt), F15  Symlink protection (S2.3), F1  Path traversal via save_to (S2.1), F2  Unhandled rejection in single-stream (Q1.2) (+12 more)

### Community 27 - "IDMM Security & Quality Audit Report"
Cohesion: 0.11
Nodes (17): File-by-File Summary, IDMM Security & Quality Audit Report, P0  Fix Before Release, P1  Fix Soon, P2  Improve When Convenient, Priority Remediation Plan, Q1  Error Handling, Q2  Resource Management (+9 more)

### Community 28 - " IDMM — Internet Download Manager Max"
Cohesion: 0.05
Nodes (36): Changelog, QC & Security Update, [v1.2.0] - 2026-07-20, 1. Arsitektur Proyek & Tech Stack, 2. Spesifikasi Fitur Terkini, 3. Changelog Ringkas, 4. Aturan Pengembangan (SOP), A. Core Engine (Backend) (+28 more)

### Community 29 - "Security Checklist"
Cohesion: 0.12
Nodes (16): Code Quality Checklist, IDMM Security & Quality Audit Task, Mission, Output Contract, Q1  Error Handling, Q2  Resource Management, Q3  Edge Cases, Q4  Performance (+8 more)

### Community 30 - "IDMM v3 Security + Quality Audit Report"
Cohesion: 0.13
Nodes (14): 10. Cross-Cutting Concerns, 1. Extension Info Leak Check (Critical), 2. Extension Permissions & CSP, 3. Server Security (server.js), 4. Downloader Security (downloader.js), 5. Chunk Worker Security (chunk-worker.js), 6. Merge & Verify (merge.js), 7. Resume Manager (resume.js) (+6 more)

### Community 31 - "IDMM v4 Security + Quality Audit Report"
Cohesion: 0.13
Nodes (14): 1. sanitizeError()  Error Message Sanitization, 2. SSRF Protection, 3. CSP  Extension Security, 4. Extension  No Backend URL Exposed to User, 5. Test Mode Bypass (IDMM_TEST=1), 6. All 25 Previous Fixes Intact, 7. New Attack Surface Analysis, Critical Finding (+6 more)

### Community 32 - "CRITICAL BUG FIX: IDMM Packaged App Crash"
Cohesion: 0.14
Nodes (13): 1. Prebuild must copy app dependencies too, 2. Path resolution in main.js, 3. Verify all require() paths work in packaged mode, 4. Icon path in packaged mode, Also Fix These Issues, CRITICAL, CRITICAL BUG FIX: IDMM Packaged App Crash, Error (on user's PC after install) (+5 more)

### Community 33 - "BUG LIST"
Cohesion: 0.15
Nodes (12): B1: Save Path not applied during download, B2: Download Threads not applied during download, B3: Server URL still showing, B4: Tab memory missing, B5: No "Open Folder" button, B6: Extension intercept behavior (Chrome download then transfer), BUG LIST, IDMM v5  User Bug Fixes (+4 more)

### Community 34 - "IDMM v2  REMAINING FIX TASK (QC + Audit v2)"
Cohesion: 0.17
Nodes (11): IDMM v2  REMAINING FIX TASK (QC + Audit v2), Output Contract, P1  SHOULD FIX, P2  NICE TO HAVE, R1: Redirect loop cap in chunk-worker.js, R2: No backpressure in merge.js, R3: mergeAndVerify temp file cleanup on verification failure, R4: _probeUrl redirect drain (+3 more)

### Community 35 - "IDMM v4  REMAINING FIX TASK"
Cohesion: 0.17
Nodes (11): IDMM v4  REMAINING FIX TASK, Output Contract, P0  MUST FIX BEFORE PUBLISH, P1  SHOULD FIX, P2  NICE TO HAVE (skip if time), R1: SSRF Redirect Bypass (3 code paths), R2: sanitizeError pattern mismatches, R3: Add link-local to SSRF blocklist (+3 more)

### Community 36 - "Bugs to Fix"
Cohesion: 0.18
Nodes (10): BUG #1  merge.js stream leak (CRITICAL), BUG #2  downloader.js lost headers on range fallback (HIGH), BUG #3  chunk-worker.js missing fileStream error handler (MEDIUM), BUG #4  downloader.js _doSingleStream exited flag (MEDIUM), BUG #5  downloader.js _recalcProgress unthrottled DB writes (MEDIUM), BUG #6  server.js stop() double-call guard (LOW), Bugs to Fix, Context (+2 more)

### Community 37 - "Task"
Cohesion: 0.18
Nodes (10): 1. src/components/Sidebar.jsx, 2. src/components/Header.jsx, 3. src/components/DownloadList.jsx, 4. src/components/AddDownload.jsx, 5. src/components/SpeedGraph.jsx, 6. src/components/Settings.jsx, Context, IDMM Phase 3 - Complete React UI Components (+2 more)

### Community 38 - "Dokumentasi Produksi IDMM (Internet Download Manager Max)"
Cohesion: 0.11
Nodes (23): downloadChunk(), fs, http, httpAgent, https, httpsAgent, main(), { parentPort, workerData } (+15 more)

### Community 39 - "IDMM Extension Fix Task  v5"
Cohesion: 0.20
Nodes (9): After all fixes, E10: Settings sync, E3: Save Path  Add folder browse button, E5: WebSocket real-time sync, E6: Open Folder  improve UX, E7: Settings hint text, E8: Remove downloads.shelf permission, E9: Show save path in popup (+1 more)

### Community 40 - "IDMM  Workflow Analysis"
Cohesion: 0.25
Nodes (7): Data Flow Diagram, End-to-End Download Flow, File System Layout, IDMM  Workflow Analysis, Key Architectural Decisions, Known Limitations (v1), Pause/Resume Flow

### Community 41 - "IDMM  Internet Download Manager Max"
Cohesion: 0.07
Nodes (28): 10. ESTIMASI UKURAN, 11. CATATAN TEKNIS, 1. VISI & MISI, 2. PERBANDINGAN FITUR: IDM vs IDMM, 3. ARSITEKTUR SISTEM, 4.1 Download Engine (Core), 4.2 Local API Server, 4.3 Chrome Extension (IDMM-ext) (+20 more)

### Community 42 - "README.md"
Cohesion: 0.08
Nodes (21): DATA_DIR, DB_PATH, DEFAULT_SAVE_PATH, DownloadManager, DownloadScheduler, formatBytes(), fs, IDMMDatabase (+13 more)

### Community 43 - "Task"
Cohesion: 0.29
Nodes (6): Context, IDMM Windows Installer - Build Task, Important:, Requirements:, Steps:, Task

### Community 44 - "IDMM  Workflow Analysis v2 (Post-Fix)"
Cohesion: 0.33
Nodes (5): End-to-End Download Flow (Updated v2), IDMM  Workflow Analysis v2 (Post-Fix), Pause/Resume Flow (Updated v2), Security Hardening (v2), Source Code Stats

### Community 45 - "4. KOMPONEN DETAIL"
Cohesion: 0.18
Nodes (4): { clipboard }, ClipboardMonitor, { EventEmitter }, path

### Community 46 - "7. DEVELOPMENT PHASES"
Cohesion: 0.13
Nodes (14): 1. Fix async/await bugs in server.js (WP-2, WP-3, WP-6), 1. Missing Features, 2. Migrate from sql.js to better-sqlite3 (E-1, E-2, WP-1), 2. Wrong Processes, 3. Efficiency Issues, 3. Wire `_processQueue()` into completion/cancellation flow (WP-4), 4. Batch WebSocket broadcasts (WP-8, E-4), 4. Confidence (+6 more)

### Community 48 - "8. API SPECIFICATION"
Cohesion: 0.39
Nodes (7): detectMime(), EXTENSION_TO_MIME, getCategoryFromMime(), MIME_TO_CATEGORY, parseContentType(), path, resolveCategory()

### Community 49 - "11. CATATAN TEKNIS"
Cohesion: 0.38
Nodes (6): cleanupChunks(), fs, fsp, mergeAndVerify(), mergeChunks(), path

## Knowledge Gaps
- **517 isolated node(s):** `http`, `path`, `os`, `fs`, `crypto` (+512 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DownloadManager` connect `DownloadManager` to `Dokumentasi Produksi IDMM (Internet Download Manager Max)`, `downloader.js`, `app/main.js`, `IDMM v1.2.0`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **What connects `http`, `path`, `os` to the rest of the system?**
  _517 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `api.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11614401858304298 - nodes in this community are weakly interconnected._
- **Should `downloader.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `nsis` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Should `electron/package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._
- **Should `IDMMDatabase` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._