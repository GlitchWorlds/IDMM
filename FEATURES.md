# IDMM — Feature Catalog

> Internet Download Manager Max — Free, open-source, multi-threaded download manager with browser integration.

---

## Extension (Browser)

### Floating Download Button
- Saat browsing website, content script scan semua `<a href>` link di halaman
- Deteksi file berdasarkan ekstensi: `.mp4`, `.mkv`, `.avi`, `.zip`, `.rar`, `.pdf`, `.exe`, `.msi`, `.mp3`, `.flac`, `.iso`, dan 40+ ekstensi lainnya
- Inject button biru `[IDMM]` di samping setiap link download
- Klik button → kirim URL ke background service worker → kirim ke IDMM server via REST API
- Button jadi hijau `[✓]` kalau sukses, merah `[✗]` kalau gagal
- MutationObserver untuk halaman dinamis (lazy load, infinite scroll)

### Download Interception
- `chrome.downloads.onDeterminingFilename` listener — intercept download dari browser
- Filter berdasarkan file type, size, dan settings (`enabled` toggle)
- Cancel browser download → kirim URL ke IDMM server
- Support cookies dan referrer passing

### Right-Click Menu
- "Download with IDMM" pada link context (`contexts: ['link']`)
- "Download with IDMM" pada media (`contexts: ['image', 'video', 'audio']`)
- "Download selected URL with IDMM" pada selection (`contexts: ['selection']`)
- Kirim URL + cookies + referrer ke IDMM server

### Badge Indicator
- Ikon toolbar menampilkan jumlah active download (badge count)
- Health check server setiap 10s — badge `OFF`(merah) kalau server mati
- Polling download list setiap 5s untuk update badge
- WebSocket untuk real-time sync

### WebSocket Connection
- Koneksi ke `ws://127.0.0.1:9977/ws`
- Exponential backoff reconnect (1s → 2s → 4s → ... → 30s max)
- Menerima `SETTINGS_CHANGED` broadcast → update local settings cache
- Menerima `DOWNLOAD_UPDATE` → relay ke popup (jika ada)
- Kirim sinyal ke content script untuk metadata page

### Server Communication (REST API)
- Endpoints: health check, list downloads, start download, pause/resume/cancel, delete
- Settings sync antara extension dan desktop app
- Extension ID stabil (`oacdlfdjmjepdjgcjhdihbfemioifhao`) dari RSA key di manifest
- Auto-install via installer (registry HKCU method)

---

## Desktop App (Electron + React)

### Download Engine

#### Multi-Threaded Download
- 1–128 threads per download
- Auto mode: thread count berdasarkan file size:
  - `< 5 MB` → 1 thread
  - `5–50 MB` → 4 threads
  - `50–500 MB` → 16 threads
  - `> 500 MB` → 32 threads (max 64)
- Manual mode: user menentukan jumlah thread (range slider 1–128)

#### Queue Management
- Priority: HIGH / NORMAL / LOW
- New download default ke NORMAL
- Queue processing otomatis — download berikutnya dari queue jalan saat slot kosong
- Priority bisa di-set per download

#### Pause / Resume / Cancel
- Pause: flush state ke DB + resume file → terminate workers
- Resume: load state dari DB + resume file → rebuild chunks → spawn workers
- Cancel: terminate workers + cleanup temp files → update DB
- Resume survive app restart — dual persistence (SQLite + JSON resume files)

#### Download Scheduling
- One-time: schedule download pada waktu tertentu (setTimeout)
- Recurring: daily/weekly (setInterval)
- Cron expression parsing (5-field format)
- Persistence: jobs disimpan di JSON file, reload otomatis saat restart

#### Batch Download
- `POST /api/downloads/batch` — submit multiple URLs sekaligus
- Concurrent limit 3 — tidak overload server
- Per-URL error handling — satu gagal tidak menghentikan yang lain
- Return array hasil: `{ url, success, downloadId?, error? }`

### Performance Features

#### HTTP Keep-Alive
- `http.Agent` / `https.Agent` dengan `keepAlive: true`
- Connection reuse across chunks — eliminate TCP/TLS handshake overhead
- `maxSockets: 1` per worker

#### Speed Limiting
- Global speed cap (`speed_limit_global` setting) dalam KB/s
- Per-worker token bucket untuk speed limiting
- Throttle detection — otomatis kurangi thread saat limit tercapai
- Respawn workers setelah 5s (jika throttle selesai)

#### Persistent Worker Pool
- Workers direuse antar chunks — tidak spawn baru setiap chunk
- `acquireWorker(workerPath, workerData)` — ambil dari idle pool atau spawn baru
- `releaseWorker(worker)` — return ke idle pool, bukan terminate
- `terminateAllIdle()` — cleanup idle workers saat shutdown

#### DB Write Optimization
- Throttle DB update ke 2s (dari 500ms)
- Dirty check: hanya update jika progress berubah >1%
- Transaction wrapper untuk multi-row operations (BEGIN/COMMIT/ROLLBACK)
- JOIN query untuk getResumableDownloads (N+1 → single query)

### API Server (REST + WebSocket)

#### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server health + version + uptime + connected clients |
| POST | `/api/download` | Start new download |
| POST | `/api/downloads/batch` | Batch download (multiple URLs) |
| GET | `/api/downloads` | List all downloads |
| GET | `/api/downloads/history` | Paginated download history (search + filter + pagination) |
| GET | `/api/download/:id` | Download detail + status |
| POST | `/api/download/:id/pause` | Pause download |
| POST | `/api/download/:id/resume` | Resume download |
| POST | `/api/download/:id/cancel` | Cancel download |
| DELETE | `/api/download/:id` | Delete download (optional delete file) |
| GET | `/api/settings` | Get all settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/stats` | Download statistics |
| POST | `/api/schedule` | Create scheduled download |
| GET | `/api/scheduled` | List scheduled jobs |
| DELETE | `/api/schedule/:jobId` | Cancel scheduled job |
| GET | `/api/categories` | List categories |
| POST | `/api/categories` | Create category |
| PUT | `/api/categories/:id` | Update category |
| DELETE | `/api/categories/:id` | Delete category |
| POST | `/api/open-folder` | Open folder in file explorer |

#### WebSocket
- Path: `ws://127.0.0.1:9977/ws`
- Broadcast interval: 500ms
- Message types: `progress` (batched), `status`, `added`, `removed`, `SETTINGS_CHANGED`
- Heartbeat setiap 15s, drop unresponsive clients setelah 10s
- Extension clients tracking dengan metadata

### Security

#### SSRF Protection
- Blocked hosts: `127.0.0.1`, `localhost`, `0.0.0.0`, `::1`, private network ranges
- DNS validation — cek resolved IP bukan private/loopback
- Redirect validation — validasi URL setelah redirect

#### Path Traversal Prevention
- Validasi `save_to` terhadap allowed roots (default Downloads folder)
- Whitelist-based — hanya path dalam allowed roots

#### Rate Limiting
- 100 request/min per IP
- TTL-based eviction untuk stale entries

#### SHA-256 Verification
- Optional checksum verification setelah merge
- File integrity check — size mismatch → cleanup + throw
- Checksum mismatch → cleanup + throw

### Data Management

#### Download History
- Paginated dengan search (filename/url) dan status filter
- Default 20 items per page

#### Custom Categories
- Six default: Videos, Music, Documents, Archives, Software, Others
- CRUD: create, rename, color/icon, delete
- Persistence: JSON file (`data/categories.json`)

#### Resume State
- Dual persistence: SQLite + JSON resume files
- Per-chunk tracking: `chunk_index`, `start_byte`, `end_byte`, `downloaded`
- Validate chunks on resume — cross-check DB + resume file + actual file sizes
- Cleanup: temp files deleted on cancel/complete

### Desktop UI

#### Frameless Window
- Modern dark/light theme — toggle via settings
- Custom title bar dengan drag support
- Min size: 600×400

#### Real-Time Progress
- Live speed (KB/s atau MB/s), ETA, progress percentage
- WebSocket-based — update setiap 500ms
- Speed history graph (60 data points, ~30s window)

#### Download List
- Columns: filename, size, status, speed, progress, actions
- Filter by status: All, Active, Completed, Paused, Queue
- Search by filename or URL
- Refresh button untuk reload dari server

#### Settings Page
- Theme: Dark / Light
- Thread Mode: Auto / Manual
- Thread count slider (1–128, manual mode)
- Default save path (folder picker)
- Save / Cancel / Discard changes
- Dirty tracking — confirm sebelum navigate away

#### Clipboard Monitoring
- Poll clipboard setiap 2s untuk URL
- Filter: http/https only, cooldown 10s per URL
- Emit event → start download otomatis
- Toggle di settings

#### Install Extension
- Button di Settings (sebelumnya di Sidebar)
- Buka instruksi manual jika installer tidak admin
- Extension path ditampilkan untuk loading unpacked

### Merge Engine

#### Chunk Merging
- Atomic write — tulis ke `.part` file dulu, rename setelah selesai
- Backpressure handling — pause reader saat writer penuh
- Error handling — destroy stream + cleanup pada error

#### File Verification
- Size verification setelah merge (`stat.size !== totalSize`)
- Optional SHA-256 checksum verification
- Auto cleanup pada verification failure — tidak tinggalkan file setengah jadi

### Database Layer

#### Tabel
- `downloads` — download records (id, url, filename, status, size, timestamps, etc.)
- `chunks` — per-chunk tracking (index, byte range, status, error, retries)
- `settings` — key-value settings store

#### Query Methods
- `listDownloads(status?)` — list dengan optional filter status
- `getDownload(id)` — single download record
- `getDownloadWithChunks(id)` — download + chunks joined
- `getResumableDownloads()` — JOIN query untuk paused/error downloads
- `getDownloadsWithPagination(page, limit, search, status)` — paginated + search
- `getAllSettings()` / `getSetting(key)` / `updateSettings(settings)`

### Utils

#### Filename
- `resolveFilename(url, disposition, mimeType)` — extract filename dari URL/headers
- `ensureUniqueFilename(filePath)` — add suffix jika file already exists
- `resolveCategory(mimeType)` — map MIME ke category

#### MIME Detection
- `detectMime(filePath, buffer)` — MIME type detection dari extension + content sniff
- `resolveCategory(mimeType)` — category mapping
- `getCategoryFromMime(mimeType)` — rule-based categorization
- `parseContentType(header)` — parse Content-Type header

#### Hash
- `hashFile(filePath)` — SHA-256 file hashing
- `hashString(str)` — SHA-256 string hashing
- `hashBuffer(buf)` — SHA-256 buffer hashing
- `createHasher()` — streaming hasher untuk large files

#### SSRF Guard
- `validateRedirect(url)` — check redirect target bukan private/loopback
- `validateDnsResolution(hostname)` — resolve DNS + validate IP
- `isBlockedHost(hostname)` — static blocked host list check

---

## Installer (NSIS)

### Extension Auto-Install
- Saat install (admin), scan Chrome, Edge, Brave, Firefox
- Chrome/Edge/Brave: `HKCU\Software\<Browser>\Extensions\<id>\` — `path` + `version`
- Firefox: registry pointer ke `.xpi` + copy ke profiles
- Extension ID stabil dari RSA key di manifest
- Uninstall: cleanup registry, hapus `.xpi` dari profiles

### Startup
- Auto-start registry (`HKCU\...\Run`)
- Protocol handler (`idmm://` URLs)
- File association (`.idmm` config files)

---

## File Structure

```
IDMM/
├── app/                   # Backend (Node.js)
│   └── src/
│       ├── db/sqlite.js
│       ├── engine/
│       │   ├── downloader.js
│       │   ├── chunk-worker.js
│       │   ├── merge.js
│       │   ├── resume.js
│       │   ├── speed-tracker.js
│       │   ├── worker-pool.js
│       │   └── download-queue.js
│       ├── server/server.js
│       ├── scheduler.js
│       ├── routes/
│       │   ├── batch.js
│       │   ├── scheduler.js
│       │   ├── history.js
│       │   └── categories.js
│       └── utils/
├── electron/              # Desktop
│   ├── main.js
│   ├── preload.js
│   ├── clipboard-monitor.js
│   ├── installer.nsh
│   └── ui/
├── extension/             # Browser
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   └── lib/api-client.js
└── data/                  # Runtime data
    ├── categories.json
    └── scheduled-jobs.json
```

---

*IDMM v1.3.0 — Generated from source analysis*
