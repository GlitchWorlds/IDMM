# Graph Report - D:\IDMM  (2026-07-23)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 469 nodes · 665 edges · 23 communities (20 shown, 3 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7ece1ea6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20

## God Nodes (most connected - your core abstractions)
1. `DownloadManager` - 34 edges
2. `IDMMDatabase` - 29 edges
3. `ResumeManager` - 15 edges
4. `nsis` - 15 edges
5. `request()` - 12 edges
6. `build` - 11 edges
7. `DownloadItem()` - 11 edges
8. `IDMMServer` - 10 edges
9. `runTests()` - 8 edges
10. `scripts` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Header()` --calls--> `formatSpeed()`  [EXTRACTED]
  electron/ui/src/components/Header.jsx → electron/ui/src/api.js
- `SpeedGraph()` --calls--> `formatSpeed()`  [EXTRACTED]
  electron/ui/src/components/SpeedGraph.jsx → electron/ui/src/api.js
- `downloadChunk()` --calls--> `validateRedirect()`  [EXTRACTED]
  app/src/engine/chunk-worker.js → app/src/utils/ssrf.js
- `App()` --calls--> `getDownloads()`  [EXTRACTED]
  electron/ui/src/App.jsx → electron/ui/src/api.js
- `App()` --calls--> `getStats()`  [EXTRACTED]
  electron/ui/src/App.jsx → electron/ui/src/api.js

## Import Cycles
- None detected.

## Communities (23 total, 3 thin omitted)

### Community 0 - "Core Engine Utilities"
Cohesion: 0.06
Nodes (38): { detectMime, resolveCategory }, fs, _globalWorkerSemaphore, { hashString }, http, https, { mergeAndVerify, cleanupChunks }, path (+30 more)

### Community 1 - "UI API Layer"
Cohesion: 0.13
Nodes (27): addDownload(), cancelDownload(), deleteDownload(), formatBytes(), formatETA(), formatSpeed(), getDownload(), getDownloads() (+19 more)

### Community 2 - "Build Configuration"
Cohesion: 0.05
Nodes (37): build, appId, asar, copyright, directories, extraResources, files, nsis (+29 more)

### Community 3 - "App Dependencies"
Cohesion: 0.12
Nodes (3): DownloadManager, { Worker }, ensureUniqueFilename()

### Community 4 - "Database Layer"
Cohesion: 0.06
Nodes (34): concurrently, electron, electron-builder, author, dependencies, cors, express, helmet (+26 more)

### Community 5 - "Download Manager"
Cohesion: 0.07
Nodes (28): action, default_icon, default_title, background, service_worker, content_scripts, content_security_policy, extension_pages (+20 more)

### Community 6 - "Extension Config"
Cohesion: 0.07
Nodes (27): author, dependencies, cors, express, helmet, sql.js, uuid, ws (+19 more)

### Community 8 - "UI Framework"
Cohesion: 0.08
Nodes (24): dependencies, react, react-dom, recharts, devDependencies, tailwindcss, @tailwindcss/vite, vite (+16 more)

### Community 9 - "HTTP Server"
Cohesion: 0.10
Nodes (16): fs, initSqlJs, path, assert, crypto, { describe, it, before, after }, DownloadManager, fs (+8 more)

### Community 10 - "Electron Main"
Cohesion: 0.20
Nodes (4): fs, _getDownloadManager(), path, ResumeManager

### Community 11 - "Chunk Worker"
Cohesion: 0.19
Nodes (9): cors, express, helmet, http, IDMMServer, path, SAFE_ERROR_PATTERNS, sanitizeError() (+1 more)

### Community 12 - "Resume Manager"
Cohesion: 0.11
Nodes (14): { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain }, APP_DIR, DATA_DIR, DB_PATH, DEFAULT_SAVE_PATH, DownloadManager, fs, gotLock (+6 more)

### Community 13 - "App Bootstrap"
Cohesion: 0.18
Nodes (15): downloadChunk(), fs, http, https, main(), { parentPort, workerData }, parseUrl(), path (+7 more)

### Community 14 - "Integration Tests"
Cohesion: 0.15
Nodes (14): DATA_DIR, DB_PATH, DEFAULT_SAVE_PATH, DownloadManager, formatBytes(), fs, IDMMDatabase, IDMMServer (+6 more)

### Community 15 - "Icon Generator"
Cohesion: 0.22
Nodes (13): apiRequest(), cleanup(), createTestFileServer(), crypto, formatBytes(), formatSpeed(), fs, http (+5 more)

### Community 16 - "Deep Tests"
Cohesion: 0.15
Nodes (13): compressed, crc32(), fs, ico, icoDir, icoHeader, ihdr, path (+5 more)

### Community 17 - "Extension Runtime"
Cohesion: 0.20
Nodes (11): check(), crypto, files, fs, http, os, path, run() (+3 more)

### Community 18 - "Code Patcher"
Cohesion: 0.36
Nodes (8): checkServer(), connectWebSocket(), interceptedIds, pollDownloads(), scheduleReconnect(), sendToIDMM(), updateBadge(), IDMM_API

## Knowledge Gaps
- **212 isolated node(s):** `http`, `path`, `os`, `fs`, `crypto` (+207 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `IDMMDatabase` connect `Community 7` to `Community 9`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `DownloadManager` connect `Community 3` to `Community 0`, `Community 13`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **What connects `http`, `path`, `os` to the rest of the system?**
  _212 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06060606060606061 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.13090418353576247 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.11596638655462185 - nodes in this community are weakly interconnected._