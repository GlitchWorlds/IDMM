# IDMM — Feature Catalog

> Internet Download Manager Max — Free, open-source, multi-threaded download manager with browser integration.

---

## 🌐 Browser Extension

### Floating Download Button
- Saat browsing website, extension mendeteksi semua link yang mengarah ke file unduhan (seperti `.mp4`, `.zip`, `.pdf`, `.exe`, `.mp3`, `.iso`, dan 40+ ekstensi lainnya).
- Extension akan menampilkan tombol biru **`[IDMM]`** di sebelah link tersebut.
- Cukup satu klik pada tombol, file akan langsung dikirim dan didownload oleh IDMM.

### Auto-Intercept Browser Downloads
- Jika fitur ini diaktifkan, IDMM akan secara otomatis "membajak" dan mengambil alih proses download dari browser.
- Anda tidak perlu copy-paste link manual; saat Anda klik tombol download bawaan website, IDMM yang akan mengerjakannya.

### Right-Click Context Menu
- Klik kanan pada link, gambar, video, atau audio apa saja di halaman web → pilih **"Download with IDMM"**.
- Anda juga bisa memblok teks yang berisi URL, klik kanan → **"Download selected URL with IDMM"**.

### Active Badge Indicator
- Icon IDMM di pojok browser akan menampilkan angka jumlah file yang sedang aktif didownload.
- Jika desktop app IDMM belum dibuka, icon akan berwarna merah dengan tulisan **`OFF`**.

---

## 🖥️ Desktop Application

### Super Fast Multi-Threaded Engine
- Kecepatan download diakselerasi dengan memecah file menjadi beberapa bagian (chunk) dan mendownloadnya secara bersamaan (hingga 128 koneksi paralel).
- **Auto Mode:** IDMM akan mengatur jumlah koneksi otomatis berdasarkan ukuran file (1 koneksi untuk file kecil, hingga 32 koneksi untuk file besar >500MB).
- **Manual Mode:** Anda bisa menentukan sendiri batas maksimum jumlah koneksi di menu Settings.

### Smart Download Queue & Priority
- Anda bisa mengatur prioritas setiap file yang didownload: **HIGH**, **NORMAL**, atau **LOW**.
- IDMM akan otomatis mendownload file berdasarkan urutan antrean dan prioritas tanpa membebani bandwidth komputer secara bersamaan.

### Pause, Resume, & Cancel
- Download bisa di-pause kapan saja dan dilanjutkan kembali tanpa harus mengulang dari awal.
- **Auto-Resume Recovery:** Jika komputer mati mendadak atau aplikasi ter-close, progress download tidak akan hilang dan bisa dilanjutkan saat IDMM dibuka kembali.

### Download Scheduling
- Jadwalkan kapan file harus mulai didownload.
- Mendukung penjadwalan satu kali jalan (One-time), atau berulang (Harian / Mingguan) — cocok untuk download file besar di malam hari saat bandwidth sedang longgar.

### Batch Download
- Masukkan banyak URL sekaligus untuk didownload secara masal tanpa harus klik satu-per-satu.

### Clipboard Monitoring
- Fitur auto-detect link: setiap kali Anda mencopy (Ctrl+C) sebuah URL file ke clipboard, IDMM akan mendeteksinya dan langsung menawarkan untuk mendownload file tersebut. (Fitur ini bisa dimatikan di Settings).

### File Categories & Organization
- File yang didownload otomatis dikelompokkan ke dalam kategori berdasarkan jenisnya (Videos, Music, Documents, Archives, Software, Others).
- Anda juga dapat membuat, mengubah, dan mewarnai custom kategori Anda sendiri.

### Speed Limiter & Control
- Jika Anda ingin main game atau browsing sambil mendownload, Anda dapat membatasi kecepatan maksimal download (Global Speed Limit) agar koneksi internet tidak lag.

### Real-Time Dashboard
- **Speed Graph:** Visualisasi kecepatan download (MB/s) secara real-time dalam bentuk grafik.
- **Download List:** Monitor estimasi waktu selesai (ETA), kecepatan, ukuran file, dan progress bar.
- **Search & Filter:** Cari file yang sudah didownload dengan cepat, atau saring berdasarkan status (Active, Completed, Paused, Queue).

### Custom Save Path & File Integrity
- Pilih folder tujuan download secara global atau ubah per-file sebelum download dimulai.
- IDMM otomatis melakukan pengecekan file saat selesai (Size & Checksum Verification) untuk memastikan file yang diunduh utuh dan tidak korup.

---

## ⚙️ Settings & System
- **Theme Switcher:** Tampilan antarmuka mendukung Dark Mode (Default) dan Light Mode.
- **Auto-Start:** IDMM bisa dikonfigurasi untuk otomatis menyala di background saat Windows baru dinyalakan.
- **Auto-Install Extension:** Installer IDMM secara pintar akan mendeteksi browser yang ada di komputer Anda (Chrome, Edge, Brave, Firefox) dan otomatis memasangkan ekstensinya.

---
*IDMM v1.3.0*
