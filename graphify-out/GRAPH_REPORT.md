# Graph Report - IDMM  (2026-07-28)

## Corpus Check
- 51 files · ~37,546 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 647 nodes · 897 edges · 29 communities (24 shown, 5 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `932fc90d`
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
- background.js
- hash.js
- patch.js
- preload.js
- content.js
- 🚀 IDMM — Internet Download Manager Max
- Dokumentasi Produksi IDMM (Internet Download Manager Max)
- README.md
- 4. KOMPONEN DETAIL

## God Nodes (most connected - your core abstractions)
1. `DownloadManager` - 35 edges
2. `IDMMDatabase` - 31 edges
3. `ResumeManager` - 15 edges
4. `DownloadScheduler` - 15 edges
5. `nsis` - 15 edges
6. `ClipboardMonitor` - 14 edges
7. `request()` - 12 edges
8. `build` - 11 edges
9. `DownloadItem()` - 11 edges
10. `Desktop Application` - 11 edges

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

## Communities (29 total, 5 thin omitted)

### Community 0 - "api.js"
Cohesion: 0.13
Nodes (27): addDownload(), cancelDownload(), deleteDownload(), formatBytes(), formatETA(), formatSpeed(), getDownload(), getDownloads() (+19 more)

### Community 1 - "downloader.js"
Cohesion: 0.07
Nodes (37): { detectMime, resolveCategory }, DownloadQueue, fs, fsp, _globalWorkerSemaphore, http, https, { mergeAndVerify } (+29 more)

### Community 2 - "nsis"
Cohesion: 0.05
Nodes (38): build, appId, asar, copyright, directories, extraResources, files, nsis (+30 more)

### Community 4 - "electron/package.json"
Cohesion: 0.06
Nodes (34): concurrently, electron, electron-builder, author, dependencies, cors, express, helmet (+26 more)

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
Cohesion: 0.11
Nodes (18): Active Badge Indicator, Auto-Intercept Browser Downloads, Batch Download, Browser Extension, Clipboard Monitoring, Custom Save Path & File Integrity, Desktop Application, Download Scheduling (+10 more)

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

### Community 20 - "background.js"
Cohesion: 0.36
Nodes (8): checkServer(), connectWebSocket(), interceptedIds, pollDownloads(), scheduleReconnect(), sendToIDMM(), updateBadge(), IDMM_API

### Community 21 - "hash.js"
Cohesion: 0.33
Nodes (5): crypto, fs, hashFile(), path, verifyFile()

### Community 24 - "content.js"
Cohesion: 0.50
Nodes (7): DOWNLOAD_EXTENSIONS, init(), injectButton(), injectStyles(), isDownloadable(), scanPage(), setupObserver()

### Community 28 - "🚀 IDMM — Internet Download Manager Max"
Cohesion: 0.12
Nodes (15): API & Integration, Browser Extension, Browser Extension, Desktop App (Electron), Download Engine, Download & Install, Features Detail, IDMM — Internet Download Manager Max (+7 more)

### Community 38 - "Dokumentasi Produksi IDMM (Internet Download Manager Max)"
Cohesion: 0.11
Nodes (23): downloadChunk(), fs, http, httpAgent, https, httpsAgent, main(), { parentPort, workerData } (+15 more)

### Community 42 - "README.md"
Cohesion: 0.08
Nodes (24): DATA_DIR, DB_PATH, DEFAULT_SAVE_PATH, DownloadManager, DownloadScheduler, formatBytes(), fs, IDMMDatabase (+16 more)

### Community 45 - "4. KOMPONEN DETAIL"
Cohesion: 0.18
Nodes (4): { clipboard }, ClipboardMonitor, { EventEmitter }, path

## Knowledge Gaps
- **298 isolated node(s):** `http`, `path`, `os`, `fs`, `crypto` (+293 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `IDMMDatabase` connect `IDMMDatabase` to `README.md`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `DownloadManager` connect `DownloadManager` to `downloader.js`, `Dokumentasi Produksi IDMM (Internet Download Manager Max)`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `http`, `path`, `os` to the rest of the system?**
  _298 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `api.js` be split into smaller, more focused modules?**
  _Cohesion score 0.12564102564102564 - nodes in this community are weakly interconnected._
- **Should `downloader.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06533776301218161 - nodes in this community are weakly interconnected._
- **Should `nsis` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Should `DownloadManager` be split into smaller, more focused modules?**
  _Cohesion score 0.13068181818181818 - nodes in this community are weakly interconnected._