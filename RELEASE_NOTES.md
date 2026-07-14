## IDMAM v1.0.0

🚀 **First release** — Free, open-source IDM alternative

### Downloads
- **IDMAM-Setup-1.0.0.exe** — Standard Windows installer (NSIS)
- **IDMAM-Portable-1.0.0.exe** — Portable (no install needed)

### Features
- ⚡ Multi-threaded download (8-64 parallel streams via worker_threads)
- ⏸️ Pause/Resume with chunk-level checkpoint
- ✅ SHA-256 verification
- 📁 Auto-categorize by file type
- 🌐 REST API (port 9977) + WebSocket real-time
- 🖥️ Dark theme desktop app (Electron + React 19 + Tailwind CSS)
- 🔌 Chrome Extension auto-intercept downloads
- 💾 100% free, no ads, no tracking, no trial

### Chrome Extension
Load unpacked from `extension/` folder, or install from Chrome Web Store (coming soon).

### Build from Source
```bash
git clone https://github.com/GlitchWorlds/IDMAM.git
cd IDMAM/app && npm install
cd ../electron && npm install && npm run build
cd ../electron/ui && npm install && npm run build
```
