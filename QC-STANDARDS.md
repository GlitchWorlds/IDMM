# Quality Control (QC) Architecture & Logic Standard — IDMM

Standar Quality Control IDMM v1.4.5+ dirancang untuk memverifikasi performa tinggi, stabilitas memory, concurrency non-blocking, serta integritas data pada arsitektur hybrid Rust + Tauri + React.

---

## 1. QC Check Points & Logic Dasar

Setiap rilis binary dan kode IDMM wajib lulus 8 pilar verifikasi otomatis tanpa kegagalan:

| No | Pillar QC | Target Evaluasi | Toleransi / Syarat Lulus |
|---|---|---|---|
| 1 | **Binary & Manifest Integrity** | Target release binary sinkron dengan bundler resource (`idmm-core.exe` hash exact match, installer `.exe` ter-generate, manifest versions match). | Exact match SHA-256 hash antara `core-engine-rust/target/release/idmm-core.exe` dan `tauri-shell/src-tauri/resources/idmm-core.exe`. Versi semua package/manifest identik. |
| 2 | **Server Health & Low-Footprint Daemon** | Axum HTTP server bind pada 127.0.0.1:9977, response time < 50ms, memory overhead idle < 20MB. | HTTP 200 OK dengan format `{"status": "ok", "version": "...", "uptime": ...}`. |
| 3 | **Database Resilience (SQLite WAL & Busy Timeout)** | Concurrency read/write bebas dari `SQLITE_BUSY` atau `database is locked`. | `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000`. Memory footprint minimal, instant rollback/commit. |
| 4 | **Multi-Part & Multi-Thread Download Acceleration** | Range header parsing (RFC 7233), auto thread chunking, speed tracking, stream-to-disk write buffering, dan file assembly merge. | Size hasil unduhan identik bit-for-bit dengan Content-Length server. Checksum SHA-256 valid. |
| 5 | **Crash Recovery & In-Place Auto-Resume** | Engine crash / kill paksa saat unduhan berjalan tidak merusak file part dan tidak menduplikasi task saat engine kembali online. | Auto-resume memakai exact UUID record yang sama. Zero duplicate record `(1)`. Chunks offset dihitung dari byte part existing tanpa corrupt. |
| 6 | **WebSocket Low-Latency Event Broadcast** | Push notifikasi status unduhan (`added`, `progress`, `status`, `completed`, `error`, `removed`) ke desktop frontend via ws://127.0.0.1:9977/ws. | WS client terhubung, handshake sukses, batch progress tick terkirim tiap 500ms tanpa memory leak. |
| 7 | **Native Messaging & Extension Protocol** | Komunikasi stdio framing 32-bit Little Endian integer length-prefixed JSON antara browser extension dan core daemon. | Stdio ping-pong sukses, parsing request URL download sukses tanpa hanging. |
| 8 | **Memory Footprint & UI Responsiveness** | Memory footprint UI WebView2 + Rust daemon tetap hemat resource (CPU idle ~0%, UI render fluid 60fps). | Tidak ada memory leak saat batch processing unduhan besar. |

---

## 2. Cara Menjalankan Automated QC Suite

Jalankan skrip verifikasi otomatis:

```bash
# Pastikan tidak ada proses idmm lama yang mengunci port 9977
node test_e2e_v145.mjs
```

Kriteria Sukses: **23/23 Tests Passed (0 Failed)**.
