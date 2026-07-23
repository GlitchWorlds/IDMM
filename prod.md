# Dokumentasi Produksi IDMM (Internet Download Manager Max)

**Versi Terkini:** v1.2.4
**Tujuan Dokumen:** *Single Source of Truth* (SSOT) untuk arsitektur, fitur, dan pedoman pengembangan proyek IDMM dan ekstensinya. Segala modifikasi di masa depan harus merujuk dan memperbarui dokumen ini.

---

## 1. Arsitektur Proyek & Tech Stack

Proyek IDMM terbagi menjadi 3 komponen utama:
1. **Core Engine (Backend):** Node.js murni (File system, HTTP server, stream processing).
2. **Desktop UI (Frontend):** Electron + React + Vite + Tailwind CSS.
3. **Browser Extension:** Chrome Extension Manifest V3.

### Struktur Direktori Utama
- `/app/` : Logika inti backend (`downloader.js`, `sqlite.js`, `server.js`). Berjalan di background.
- `/electron/` : File utama Electron (`main.js`, `preload.js`). Menjembatani OS dengan UI.
- `/electron/ui/` : Kode React untuk antarmuka pengguna.
- `/extension/` : Ekstensi peramban (Chrome/Edge) untuk menangkap unduhan. 
 
### Database & Endpoint Internal (API Lokal)
- **SQLite Database (`idmm.db`):** Menyimpan *state* unduhan, daftar *chunk* (bagian unduhan), dan preferensi pengaturan. Semua method DB mengembalikan format `{ ok: boolean, data?: any, error?: string }` untuk error handling konsisten.
- **REST API (`http://127.0.0.1:9977`):** Menangani *start, pause, resume, cancel, delete*, serta mengembalikan daftar *history* dan *stats*.
- **Health Endpoint (`GET /health`):** Mengembalikan status server, jumlah WebSocket clients yang terhubung, dan uptime. Digunakan untuk health check mutual antara server dan extension.
- **WebSocket (`ws://127.0.0.1:9977/ws`):** Mengirim *real-time progress* dan status kecepatan ke UI/Frontend. Server mengirim *ping* setiap 15 detik dan me-*drop* client yang tidak respond dalam 10 detik (heartbeat).

---

## 2. Spesifikasi Fitur Terkini

### A. Core Engine (Backend)
- **Multi-threading:** Mendukung 1 hingga 128 *thread* per unduhan. Terdapat mode **Auto** (berdasarkan ukuran file) dan **Manual**.
- **Worker Health Tracking:** Setiap worker thread didaftarkan di `activeWorkers` Map dengan metadata (download ID, chunk index, start time). Error handler (`worker.on('error')`) dan exit handler (`worker.on('exit', code)`) terpasang otomatis. Method `getWorkerHealth()` mengembalikan status semua worker aktif.
- **Queue Priority:** Download queue mendukung 3 level prioritas: `HIGH`, `NORMAL`, `LOW`. Method `setPriority(id, level)` dan `getQueue()` tersedia. Download baru default ke NORMAL.
- **State Management:** Chunk dan progress disimpan di SQLite (`idmm.db`). Mendukung *Pause*, *Resume*, dan pemulihan setelah aplikasi ditutup. Semua operasi DB menggunakan format `{ ok, data, error }` dengan 17 guard clauses untuk mencegah crash.
- **Cancel & Delete:**
  - Fungsi `Cancel` mematikan semua *worker thread* secara paksa dan aman tanpa *memory leak*.
  - Menghapus unduhan memiliki 2 opsi: "Hanya Riwayat" atau "Riwayat + File Fisik Temp/Asli".
- **Local Server:** Berjalan pada `http://127.0.0.1:9977`. Digunakan untuk komunikasi dengan UI dan Ekstensi (REST & WebSocket). Endpoint `/health` tersedia untuk monitoring.

### B. User Interface (UI) - Electron & React
- **Window Controls & Layout:**
  - Antarmuka bersifat *frameless* (tanpa title bar bawaan Windows).
  - Terdapat *padding* kanan (sekitar 140px) di `Header.jsx` agar tombol bawaan OS tidak menutupi tombol UI (seperti tombol "Add").
  - **Global Drag:** Pengguna dapat menyeret (*drag*) aplikasi dari bagian mana saja yang kosong (background). Elemen interaktif (tombol, input, navigasi, daftar unduhan) menggunakan *no-drag* agar tetap bisa diklik.
- **Tema (Color Harmony):**
  - Hanya terdapat 2 tema: **Dark Theme** (Default - Monochromatic slate & soft blue) dan **Light Theme** (Clean white/gray & soft blue). Diatur via CSS variables di `index.css`.
- **Sidebar:**
  - Hanya menampilkan navigasi utama: *All Downloads, Active, Completed, Paused, Queue, Settings, Help*.
  - **Dihapus:** Bagian "Speed" (grafik kecepatan global) sudah tidak ada di sidebar demi kebersihan UI.

### C. Ekstensi Browser
- **Headless (Tanpa UI):** Ekstensi murni beroperasi di latar belakang (Background Service Worker). File HTML, CSS, popup, dan options telah dihapus. Pengaturan ekstensi sepenuhnya mengikuti pengaturan *software* utama.
- **Intersepsi (Interception):** Menangkap event `chrome.downloads.onDeterminingFilename`. Jika unduhan tertangkap, ekstensi akan melakukan:
  1. *Cancel* unduhan bawaan browser secara sinkron.
  2. Meneruskan fungsi `suggest()` agar browser tidak *hang*.
  3. Mengirimkan parameter unduhan ke backend IDMM.
  4. Mencegah *loop* ganda (*double download*) dengan melacak ID unduhan.
- **Health Check Mutual:** Extension melakukan `checkServer()` setiap 10 detik. Server mengirim WebSocket ping setiap 15 detik. Jika extension tidak respond dalam 10 detik, server me-*drop* koneksi. Extension menggunakan reconnect backoff (1s → 30s max) jika WebSocket terputus.
- **Content Script Communication:** Content script mengirim `PAGE_METADATA` (pageTitle, pageUrl, contentLength, downloadLinks[], mediaUrls[]) ke background service worker via `chrome.runtime.sendMessage()`. Background memproses metadata dan mendeteksi konten yang bisa didownload.

---

## 3. Changelog Ringkas

| Versi | Perubahan |
|-------|-----------|
| v1.2.1 | UI overlap fix, global window drag, extension headless, pause/resume race fix |
| v1.2.2 | Select folder dialog (OS picker) di Add Download dan Settings |
| v1.2.3 | Worker health tracking, DB error propagation (17 guard clauses), server health endpoint, WebSocket heartbeat |
| v1.2.4 | Integration tests (7 tests), ResumeManager visibility, content script comms, community labels, queue priority (HIGH/NORMAL/LOW) |

---

### D. Testing
- **Integration Tests:** `app/test/integration.test.js` — 7 tests menggunakan Node.js built-in test runner (`node:test`).
- **Cara jalan:** `cd app && node test/integration.test.js`
- **Coverage:** Module imports (3), DB lifecycle (2), Server+WebSocket (1), Download lifecycle (1)

---

## 4. Aturan Pengembangan (SOP)

Jika ada permintaan fitur baru atau perbaikan *bug*:
1. **Baca Dokumen Ini:** Pastikan tidak ada konflik dengan arsitektur saat ini (contoh: jangan menambahkan UI pada ekstensi karena aturannya adalah *headless*).
2. **Ubah Kode & Tes:** Lakukan perubahan, pastikan *build* sukses (khusus UI wajib menggunakan `loadFile`, `nodeIntegration: true`, `contextIsolation: true`).
3. **Update prod.md:** Tambahkan spesifikasi fitur baru atau ubah yang lama di dokumen ini agar tetap relevan.
4. **Commit & Build:** Sinkronisasi kode ke GitHub dan kompilasi (*dist*) versi *production* secara konsisten dengan konfigurasi `asar: false`.
