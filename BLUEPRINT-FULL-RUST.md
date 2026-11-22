# Blueprint: IDMM Full Rust + IDM Parity Evolution

## 1. Context & Objective
Mentransformasikan IDMM (`D:\IDMM`) menjadi arsitektur **Full Rust** tanpa ketergantungan runtime Node.js/Electron, sekaligus mengadopsi mekanisme performa dan keandalan Internet Download Manager (IDM).

## 2. Arsitektur Target
- **Core Engine (`core-engine-rust`)**:
  - Tokio asynchronous multi-connection runtime.
  - **Dynamic Segment Splitting**: Alih-alih pembagian statis di awal saja, chunk yang selesai lebih awal secara aktif memotong sisa byte dari chunk yang masih lambat/terpanjang untuk mempertahankan saturasi bandwidth maksimum hingga file 100% selesai.
  - **Header & Auth Preservation**: Dukungan parsing dan forward headers (`Cookie`, `User-Agent`, `Referer`, `Authorization`) dari request download.
  - **Direct Stream Writer**: Menulis chunk langsung ke offset file target menggunakan pre-allocation (sparse/truncate) guna meminimalkan fase stitching/merging di akhir unduhan.

- **Desktop Shell (`tauri-shell`)**:
  - Rust Tauri v2 sebagai satu-satunya GUI desktop resmi.
  - Mengintegrasikan autostart registry HKCU Run langsung via modul Rust (`winreg` atau Windows API), menghapus ketergantungan pada Electron.
  - Mengelola lifecycle `idmm-core` in-process (background thread / Tokio task) atau embedded binary.

- **Browser Extension (`extension`)**:
  - Komunikasi langsung dengan Host Native Messaging Rust IDMM.
  - Sniffing otomatis link dan metadata HTTP request (Cookies + Referer).

## 3. Tahapan Eksekusi
1. **Fase 1: Engine Enhancement (IDM Parity)**
   - Implementasi header forwarding (Cookies, User-Agent, Referer) pada `models.rs` & `engine.rs`.
   - Implementasi dynamic segmentation logic pada `engine.rs`.
2. **Fase 2: Tauri v2 Autostart & Standalone Unification**
   - Implementasi manajemen autostart Windows HKCU Run native di Rust pada `tauri-shell`.
3. **Fase 3: Verifikasi & Test**
   - Build dan unit test pada `core-engine-rust`.
   - QC kelayakan fungsionalitas unduhan.
