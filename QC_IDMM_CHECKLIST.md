# QC IDMM Checklist - v1.4.7 auto-start baru
Tanggal: 2026-09-26 - Scope: inventory plus checklist, tanpa build test fix
Root: D:/IDMM
Modul: core-engine-rust, tauri-shell, electron ui, app, extension

## 1. core-engine-rust - engine native Rust
Settings utama: Cargo.toml, src main.rs port 9977, src db.rs SQLite WAL init-settings, src models.rs
Kritis: Database open init-settings, engine DownloadManager, api build-router, native-messaging host

- [ ] 1. main.rs mode native-host vs server terpisah benar, port 9977 sama dengan api-client
- [ ] 2. db.rs init-settings default save-path dan threads benar, migrasi idmam ke idmm aman
- [ ] 3. engine.rs dan api.rs alur download save resume konsisten pending downloading paused completed
- [ ] 4. file bak-20260925-autostart api db engine terdokumentasi, tidak ikut compile

## 2. tauri-shell - bundle desktop
Settings utama: src-tauri tauri.conf.json v1.4.6 bundle nsis resources idmm-core.exe, src lib.rs dan main.rs, ui-dist
Kritis: bundle resources core, window CSP, shell plugin init

- [ ] 5. tauri.conf.json versi resources icon valid, idmm-core.exe terbundle di path benar
- [ ] 6. lib.rs plugin shell init dan generate-context jalan, file bak autostart tidak aktif
- [ ] 7. ui-dist sinkron dengan electron ui build, auto-start tidak dobel dengan Electron

## 3. electron plus ui - shell lama plus React UI
Settings utama: electron main.js dan preload.js, clipboard-monitor.js, package.json, ui src App.jsx api.js vite.config.js build index.html
Kritis: resolveEngine startServer, sqlite settings save, downloader download, Tray Menu autostart clipboard, UI Settings page

- [ ] 8. main.js resolveEngine menemukan app src db sqlite.js di dev dan packaged, DATA_DIR idmm dan save-path Downloads IDMM dibuat
- [ ] 9. auto-start baru main.js preload.js vs bak-20260925-autostart konsisten single registry LoginItem tidak dobel start server
- [ ] 10. ui App.jsx dan api.js halaman Settings tersimpan via REST ke DB bukan hanya state lokal
- [ ] 11. clipboard-monitor.js dan Tray Menu tidak memicu download ganda saat auto-start aktif

## 4. app - Node engine server lama
Settings utama: app main.js package.json, src db sqlite.js, src server server.js, src scheduler.js, src routes batch categories history scheduler
Kritis: Database create getAllSettings, DownloadManager chunk merge resume speed worker queue, IDMMServer REST, Scheduler auto-resume

- [ ] 12. app main.js migrasi idmam ke idmm aman DB rename idmam.db ke idmm.db
- [ ] 13. sqlite.js vs bak-20260925-autostart konsisten settings default save path threads sama dengan core Rust
- [ ] 14. downloader.js merge resume queue alur save-to dan temp dir benar tidak tabrakan dengan core Rust
- [ ] 15. server.js vs bak-20260925-autostart endpoint download settings history stabil port tidak tabrakan 9977

## 5. extension - browser MV3
Settings utama: manifest.json v1.4.6 MV3, background.js content.js lib api-client.js, manifest-native chrome firefox json, register-native-host.ps1
Kritis: intercept chrome.downloads dan content click, sendToIDMM REST native com.idmm.native-host, badge OFF, context menu

- [ ] 16. manifest.json permissions downloads storage nativeMessaging dan host-permissions benar versi selaras 1.4.6
- [ ] 17. background.js urutan Native Messaging ke REST fallback benar healthCheck badge OFF akurat
- [ ] 18. api-client.js base URL port 9977 sama dengan core main.rs dan electron server
- [ ] 19. manifest-native json dan register-native-host.ps1 path host valid di Windows, ZIP rilis 1.4.5 vs source tidak campur
- [ ] 20. auto-start baru tidak memutus relay extension server ready sebelum extension kirim download pertama retry health check
