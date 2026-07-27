# 🚀 IDMM — Internet Download Manager Max

**Free, open-source download manager with multi-threaded acceleration, browser extension, and resume capability. 100% free, no ads, no tracking.**

![version](https://img.shields.io/badge/version-1.3.0-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![platform](https://img.shields.io/badge/platform-Windows-lightgrey)

---

## 📦 Download & Install

### Option 1: Installer (Recommended)
Download `IDMM-Setup-1.3.0.exe` from [Releases](https://github.com/GlitchWorlds/IDMM/releases).

The installer will:
1. Install IDMM to your chosen directory
2. Add auto-start on boot
3. Create desktop shortcuts for browser launch with extension

### Option 2: Portable
Download `IDMM-Portable-1.3.0.exe` — no installation needed, runs directly.

### Browser Extension
- **Chrome / Edge / Brave / Opera / Vivaldi**: Download `IDMM-Extension-v1.3.0.zip`, extract, open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select the extension folder.
- **Firefox**: Download `idmm.xpi` and open it — Firefox will prompt to install.

Or use the **"Install Extension"** button inside IDMM Settings to auto-install.

---

## ✨ Features Detail

### Download Engine
- **Multi-threaded Download** — 1 to 128 threads per download. Auto mode (file-size based) or manual.
- **Queue with Priority** — HIGH / NORMAL / LOW priority. Downloads start based on queue position.
- **Pause / Resume / Cancel** — Full state management. Resume survives app restart.
- **Download Scheduling** — Schedule downloads for later (one-time, daily, weekly).
- **Batch Download** — Submit multiple URLs at once via API.
- **Custom Save Path** — Choose where files are saved, per download or globally.

### Performance
- **HTTP Keep-Alive** — Connection reuse across chunks for faster downloads.
- **Speed Limiting** — Global speed cap per download.
- **Auto Thread Tuning** — Thread count adapts to file size (1 thread for small files, up to 32 for large).
- **Persistent Worker Pool** — Workers are reused instead of spawned fresh per chunk.

### Browser Extension
- **Floating Download Button** — `[↓IDMM]` button appears next to every downloadable link on any website. One click sends the file to IDMM.
- **Download Interception** — Automatically captures browser downloads for supported file types (media, archives, documents, executables).
- **Right-click Menu** — "Download with IDMM" on any link, image, video, or audio.
- **Badge Indicator** — Shows active download count on the extension icon.

### Desktop App (Electron)
- **Frameless Window** — Dark/light theme with native title bar overlay.
- **Real-time Progress** — Live speed, ETA, and progress via WebSocket.
- **Speed Graph** — Visual download speed chart.
- **Search & Filter** — Filter downloads by status (active, completed, paused, queued).
- **Clipboard Monitoring** — Auto-detect copied URLs (toggle in settings).

### API & Integration
- **REST API** — Full control via `http://127.0.0.1:9977`. Manage downloads, settings, and extensions programmatically.
- **WebSocket** — Real-time progress updates and status changes.
- **Download History** — Paginated history with search and status filter.
- **Custom Categories** — Organize downloads by custom categories.

### Security
- **SSRF Protection** — Blocks downloads from localhost, private networks, and DNS rebinding.
- **Path Traversal Prevention** — Validates save paths against allowed directories.
- **Rate Limiting** — Prevents API abuse.
- **SHA-256 Verification** — Optional checksum verification after download.

### Supported File Types
- Media: `.mp4` `.mkv` `.avi` `.mov` `.webm` `.mp3` `.flac` `.m4a`
- Archives: `.zip` `.rar` `.7z` `.tar` `.gz`
- Documents: `.pdf` `.doc` `.docx` `.epub`
- Executables: `.exe` `.msi` `.dmg` `.apk`
- And more: `.iso` `.img` `.jar` `.whl`

---

## 🛠️ Quick Start

```bash
# Clone & build
git clone https://github.com/GlitchWorlds/IDMM.git
cd IDMM/app && npm install
cd ../electron && npm install

# Run (development)
cd ../app && node main.js

# Build installer
cd ../electron && npm run build
```

---

## 📜 License

MIT — Free to use, modify, and distribute.

**⭐ Star this repo if you find it useful!**
