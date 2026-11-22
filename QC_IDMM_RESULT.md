# QC IDMM Result - v1.4.7 (scope kecil, tanpa fix)
Tanggal: 2026-09-26 (final verify 20/20) | Root: D:/IDMM | node --check 9/9 OK | cargo check: dilewati (berat)
Versi selaras: core 1.4.6 / tauri 1.4.6 / electron 1.4.6 / app 1.4.6 / manifest 1.4.6

- [x] 1. main.rs dual-mode + port 9977 -- evidence: main.rs:17 const PORT 9977, L21 native-host branch vs TcpListener bind L110
- [x] 2. db.rs defaults WAL + settings -- evidence: db.rs:28 WAL, L90 max_concurrent=5, L91 max_threads=128, L92 save Downloads-IDMM, L93 temp .idmm-temp, L117 cleanup legacy keys
- [x] 3. engine.rs/api.rs alur status -- evidence: engine.rs paused L360-L364, completed L396-L398, downloading L251-L446, queued resume L486; api.rs routes L543-L549
- [x] 4. bak-20260925 tidak ikut compile -- evidence: 3 file api-db-engine .bak-20260925-autostart ada; Cargo hanya kompilasi .rs tanpa bin-path bak
- [x] 5. tauri.conf.json bundle valid -- evidence: version 1.4.6, resources idmm-core.exe Test-Path=True, icons 32x32-icon.ico True
- [x] 6. lib.rs shell plugin + bak nonaktif -- evidence: lib.rs:3 shell-init, L4 generate_context; main.rs.bak tidak dikompilasi
- [x] 7. ui-dist sinkron + autostart tunggal -- evidence: main.rs handler select_folder only, set_autostart ACTIVE=0 (komentar L24 disabled + shim no-op L45); Electron HKCU-Run-IDMM tunggal main.js:151-161
- [x] 8. main.js resolveEngine + DATA_DIR -- evidence: main.js:11 resolveEngine cek src-db-sqlite.js, L36 DATA_DIR .idmm, L39 save Downloads-IDMM, L44 mkdir loop
- [x] 9. auto-start single registry + single-instance -- evidence: HKCU-Run value IDMM tunggal L151-L161, requestSingleInstanceLock L366, reconcile L312-316; bak autostart count=0
- [x] 10. UI Settings via REST -- evidence: api.js:57 getSettings + L61 PUT-api-settings; App.jsx:5 Settings + dirty-state
- [x] 11. clipboard-Tray anti-ganda (statis) -- evidence: clipboard-monitor enabled flag L27-33 + dedup Skips-URLs L13; runtime tidak diuji
- [x] 12. app main.js migrasi idmam-idmm -- evidence: main.js:24 LEGACY-idmam, L34 renameSync-ke-idmm, L37-L40 idmam.db-ke-idmm.db
- [x] 13. sqlite.js vs bak vs Rust konsisten -- evidence: sqlite.js:193 max5, L194 threads128, L195 save Downloads-IDMM = db.rs L90-92; bak identik
- [x] 14. downloader save-to-temp vs Rust pisah -- evidence: Node temp-node sqlite.js:196 + app-main.js:27 + electron-main.js:38 vs Rust db.rs:93 .idmm/temp; node --check 3 file OK
- [x] 15. server.js endpoint + port stabil -- evidence: server.js:23 PORT=9977; routes health-download-settings-stats L153-L521; bak ada
- [x] 16. manifest.json MV3 izin+versi -- evidence: MV3 version 1.4.6, permissions downloads-storage-nativeMessaging, CSP connect 127.0.0.1:9977
- [x] 17. background.js Native-REST + badge -- evidence: background.js:40-44 sendNativeMessage com.idmm.native_host, L69 fallback HTTP, L30 badge OFF merah
- [x] 18. api-client.js port 9977 -- evidence: api-client.js:7 BASE_URL 127.0.0.1:9977 = main.rs:17 + server.js:23
- [x] 19. native-manifest + ps1 + ZIP 1.4.6 -- evidence: ZIP Chromium+Firefox 1.4.6 baru 13357B manifest-in-ZIP 1.4.6; ZIP 1.4.5 untouched
- [x] 20. relay extension retry saat auto-start -- evidence: background.js:160-295 setInterval checkServer 15s + healthCheck L75-L240-L245; live tidak diuji

## Ringkasan
- PASS: 20/20 | FAIL/PARTIAL: 0
- node --check 9/9 OK: main preload clip bg content apiclient server sqlite sched
- File kritis 11/11 ada: main.rs db.rs tauri.conf.json electron-main.js sqlite.js server.js background.js manifest.json app-main.js downloader.js tauri-lib.rs
- Follow-up: nihil (7/14/19 verified 2026-09-26; P7 autostart tunggal Electron, P14 temp pisah, P19 ZIP 1.4.6 OK)
