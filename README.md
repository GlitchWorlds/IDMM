# 🚀 IDMM — Internet Download Manager Max

**Free, open-source download manager with multi-threaded acceleration, browser extension auto-intercept, and resume capability. 100% free, no ads, no tracking.**

[![Version](https://img.shields.io/badge/version-1.2.6-blue)](#) [![License](https://img.shields.io/badge/license-MIT-green)](#) [![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)](#)

---

## ✨ Features

### Core Engine
- **Multi-threaded Download** — 1 to 128 threads per download. Auto mode (file-size based) or manual.
- **Queue Priority** — 3 levels: `HIGH`, `NORMAL`, `LOW`. New downloads default to NORMAL.
- **Pause / Resume / Cancel** — Full state management via SQLite. Resume after app restart.
- **Worker Health Tracking** — Every worker thread tracked with metadata. `getWorkerHealth()` API.
- **SSRF Protection** — Blocked hosts list, DNS validation, redirect validation.
- **Modular Architecture** — `SpeedTracker`, `WorkerPool`, `DownloadQueue` classes for clean separation.

### Browser Extension
- **Auto-Intercept** — Captures browser downloads automatically. No manual copy-paste.
- **Auto-Install** — Installer detects installed browsers and deploys extension:
  - Chrome / Edge — Registry policy
  - Firefox — `.xpi` copy to profiles
  - Brave / Opera / Vivaldi — Shortcut with `--load-extension` flag
- **Headless** — No popup, no options page. Follows main app settings.
- **Health Check** — Mutual heartbeat between extension and server (10s / 15s intervals).

### Desktop UI (Electron + React)
- **Frameless Window** — Modern dark/light theme with global drag support.
- **Real-time Progress** — WebSocket-based speed and progress updates.
- **Select Folder** — OS-native folder picker for download destination.
- **Speed Graph** — Visual download speed tracking.

---

## 📦 Download & Install

### Option 1: Installer (Recommended)
Download `IDMM-Setup-1.2.6.exe` from [Releases](https://github.com/GlitchWorlds/IDMM/releases).

The installer will:
1. Install IDMM to `%LOCALAPPDATA%\IDMM`
2. Auto-install the browser extension to detected browsers (Chrome, Edge, Firefox, Brave, Opera, Vivaldi)

### Option 2: Portable
Download `IDMM-Portable-1.2.6.exe` from [Releases](https://github.com/GlitchWorlds/IDMM/releases). No installation needed.

---

## 🛠️ Build From Source

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- [Python](https://python.org/) 3.10+ (optional, for Graphify analysis)
- Windows 10/11

### Steps
```bash
git clone https://github.com/GlitchWorlds/IDMM.git
cd IDMM

# Install dependencies
cd app && npm install
cd ../electron && npm install

# Build Firefox XPI
node scripts/build-xpi.js

# Build Electron app
cd electron && npm run build
```

---

## 🏗️ Architecture

```
IDMM/
├── app/                    # Backend (Node.js)
│   └── src/
│       ├── db/sqlite.js          # SQLite database layer ({ ok, data, error })
│       ├── engine/
│       │   ├── downloader.js      # DownloadManager (orchestrator)
│       │   ├── chunk-worker.js   # Worker thread (per-chunk download)
│       │   ├── speed-tracker.js  # Rolling speed samples
│       │   ├── worker-pool.js     # Counting semaphore + health
│       │   ├── download-queue.js # Priority queue (HIGH/NORMAL/LOW)
│       │   ├── resume.js          # Resume state persistence
│       │   └── merge.js           # Chunk merging
│       ├── server/server.js      # REST API + WebSocket
│       └── utils/                # SSRF guard, filename, hash, mime
├── electron/              # Desktop app
│   ├── main.js                   # Electron main process
│   ├── preload.js                # IPC bridge
│   ├── installer.nsh             # NSIS installer script
│   └── ui/                       # React + Vite + Tailwind
├── extension/             # Browser extension (MV3)
│   ├── manifest.json
│   ├── background.js              # Service worker
│   └── content.js                # Page metadata extraction
├── scripts/
│   └── build-xpi.js              # Firefox .xpi builder
└── prod.md                # Single Source of Truth (SSOT)
```

### Local API
| Endpoint | Method | Description |
|----------|--------|-------------|
| `http://127.0.0.1:9977` | — | REST API base |
| `/health` | GET | Server health, WebSocket clients, uptime |
| `/download/start` | POST | Start new download |
| `/download/pause/:id` | POST | Pause download |
| `/download/resume/:id` | POST | Resume download |
| `/download/cancel/:id` | POST | Cancel download |
| `/download/delete/:id` | DELETE | Delete download |
| `/downloads` | GET | List all downloads |
| `/stats` | GET | Download statistics |
| `/settings` | GET/POST | Get/update settings |
| `ws://127.0.0.1:9977/ws` | WS | Real-time progress + speed |

---

## 🧪 Testing

```bash
cd app
node test/integration.test.js
```

Tests cover: module imports, DB lifecycle, concurrent downloads, priority queue ordering, DB consistency, WorkerPool double-release guard.

---

## 📋 Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js (pure, no framework) |
| Database | SQLite (`better-sqlite3`) |
| Desktop | Electron + React + Vite + Tailwind CSS |
| Extension | Chrome Extension Manifest V3 |
| Build | electron-builder, NSIS installer |
| Analysis | Graphify (knowledge graph) |

---

## 📝 Documentation

- [`prod.md`](prod.md) — Single Source of Truth (architecture, features, changelog)
- [`DESIGN.md`](DESIGN.md) — System design document
- [`CHANGELOG.md`](CHANGELOG.md) — Version history
- [`RELEASE_NOTES.md`](RELEASE_NOTES.md) — Release notes

---

## 📜 License

MIT — Free to use, modify, and distribute.

---

## 🙏 Credits

Built with [OpenClaw](https://openclaw.ai) agent orchestration.

---

**⭐ If IDMM helped you, give it a star!**
