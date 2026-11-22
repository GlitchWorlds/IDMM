# IDMM — Internet Download Manager Max

High-performance, open-source download manager built with Rust, multi-threaded acceleration, dynamic chunk segmentation, and browser integration. 100% free, no ads, no tracking.

![version](https://img.shields.io/badge/version-1.4.6-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![platform](https://img.shields.io/badge/platform-Windows-lightgrey)

---

## Key Features

### Download Engine (Core Rust)
- **High-Performance Multi-Threading** — 1 to 128 parallel connection threads per download task.
- **Dynamic Segment Splitting** — Active segment division and workload redistribution for maximum bandwidth utilization until completion.
- **State Persistence & Resume** — Pause and resume downloads across system restarts without losing progress.
- **Bandwidth Control** — Configurable speed limiting (Token Bucket algorithm).
- **Task Scheduling & Queues** — Prioritized queue management with concurrent download limits.
- **Header & Auth Preservation** — Seamless forwarding of cookies, authentication tokens, and referrer headers.

### Browser Extension
- **Download Interception** — Automatically captures media, documents, archives, and executables from supported browsers (Chrome, Edge, Brave, Firefox).
- **Context Menu Integration** — Quick right-click download action for links, audio, and video streams.
- **Floating Action Button** — Direct one-click capture button adjacent to detected download URLs.

### Desktop Application
- **Native Desktop Shell** — Lightweight GUI built with Tauri v2.
- **Real-Time Telemetry** — Live transfer speed, estimated time of arrival (ETA), and progress updates.
- **System Tray & Autostart** — Native background daemon support with Windows startup integration.

---

## Architecture Overview

- `core-engine-rust/`: Tokio asynchronous engine handling HTTP range requests, chunk management, storage IO, and local IPC/REST APIs.
- `tauri-shell/`: Native Windows desktop user interface using Tauri v2.
- `extension/`: WebExtension for Chrome/Firefox link detection and interception.

---

## Building from Source

### Prerequisites
- Rust 1.80+ (with `cargo`)
- MinGW-w64 or Visual Studio C++ Build Tools
- Node.js 18+ (for frontend assets)

### Build Commands

```bash
# 1. Build Rust Core Engine
cd core-engine-rust
cargo build --release

# 2. Build Tauri Desktop Shell
cd ../tauri-shell
cargo build --release --manifest-path src-tauri/Cargo.toml
```

---

## License

MIT License. Free for personal and commercial use.
