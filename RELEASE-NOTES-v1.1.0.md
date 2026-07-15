# IDMAM v1.1.0 — Security Hardened Release

**Release Date:** 2026-07-15
**Status:** Production Ready ✅
**Previous Release:** v1.0.0

---

## 🔒 Security Fixes (Critical)

### SSRF Protection (Server-Side Request Forgery)
- **Initial URL validation** — blocks localhost, private IPs (10.x, 192.168.x, 172.16-31.x), link-local (169.254.x)
- **Redirect validation** — all 3 redirect paths now re-validate against SSRF blocklist before following
- **Shared utility** — `src/utils/ssrf.js` with `isBlockedHost()` + `validateRedirect()`
- **Attack vector closed:** `evil.com 302 → 192.168.1.1/admin` now BLOCKED

### Error Message Sanitization
- `sanitizeError()` helper with SAFE_ERROR_PATTERNS whitelist
- Known safe errors pass through; unknown errors → generic "Internal server error"
- Prevents leaking internal file paths in API responses
- All 12 `err.message` references replaced

### CSP Hardened
- Extension `connect-src` narrowed from wildcard port (`127.0.0.1:*`) to exact port (`127.0.0.1:9977`)

### Extension Privacy
- Backend URL (`127.0.0.1:9977`) completely hidden from user-facing UI
- Options page shows only "Connected ✓" / "Not Running ✗"
- No server URL input exposed

---

## 🛡️ Quality Fixes (28 total across 4 rounds)

### Round 1 — Core Fixes (13)
| Fix | Description |
|-----|-------------|
| F1 | Path traversal protection (`save_to` validated) |
| F2 | Double-settle guard (prevent duplicate callbacks) |
| F3 | Resume already-active guard |
| F4 | DB status check for pause message |
| F5 | Extension CSP |
| F6 | WebSocket maxPayload 64KB |
| F7 | WebSocket heartbeat 30s ping/pong |
| F8 | Chunk DB ID caching |
| F9 | Rate limiter TTL eviction |
| F10 | Duplicate URL tracking (409 on collision) |
| F11 | Global worker semaphore (max 128) |
| F12 | Resume file debouncing 500ms |
| F13 | Atomic merge (`.part` temp + `fs.renameSync`) |

### Round 2 — Engine Fixes (6)
| Fix | Description |
|-----|-------------|
| R1 | Redirect loop cap (max 5) |
| R2 | Backpressure handling in merge (drain event) |
| R3 | Temp file cleanup on verification failure |
| R4 | Response drain `res.resume()` on redirect |
| R5 | `process.exit()` flush 100ms delay |
| R6 | `ensureUniqueFilename` upper bound (999) |

### Round 3 — Warning Cleanup (3)
| Fix | Description |
|-----|-------------|
| W2 | `req.destroy()` before redirect recursive call |
| W7 | Comment explaining `onComplete`/`onError` overwrite safety |
| AW2 | Re-entrancy guard (`_flushing` flag) in `flushPending()` |

### Round 4 — Production Hardening (3)
| Fix | Description |
|-----|-------------|
| R1 | SSRF redirect bypass (3 code paths) |
| R2 | `sanitizeError` pattern mismatches |
| R3 | Link-local 169.254.x.x in SSRF blocklist |

---

## 📊 Test Results

- **Integration Tests:** 9/9 PASS every round
- **Total Tests Run:** 54/54 across 6 rounds
- **QC Checks:** 27 PASS / 0 FAIL / 9 warnings (acceptable)
- **Security Audit:** 68 PASS / 4 WARNING / 0 FAIL
- **npm audit:** 0 vulnerabilities

---

## 🏗️ Architecture

- **Engine:** Node.js Worker Threads (chunked/segmented downloads)
- **Server:** Express REST API + WebSocket (localhost:9977)
- **Database:** SQLite via sql.js WASM
- **Extension:** Chrome MV3 (popup + options + context menu)
- **Total Code:** 3446+ lines across 9 modules

---

## 📦 Installation

1. Download IDMAM-Setup-1.1.0.exe from releases
2. Run installer
3. Load extension from `extension/` folder in Chrome (chrome://extensions → Load unpacked)
4. IDMAM will auto-connect when running

---

## 🔄 Upgrade from v1.0.0

1. Close IDMAM if running
2. Install v1.1.0 (will replace v1.0.0)
3. Extension auto-updates if loaded unpacked
4. All download history preserved (SQLite DB unchanged)

---

## ⚠️ Known Limitations

- Localhost-only API (no remote access by design)
- No disk space check before downloads (future)
- DNS rebinding not protected (requires victim to visit attacker domain first)
- Cookies stored in plaintext (local-only app, no multi-user)

---

## 📝 Commits

```
f7a5298 Fix SSRF redirect bypass + sanitizeError patterns (R1-R3)
bb6340d Fix 3 production warnings for external publish
fbb5283 Hide backend details from extension UI
58cb492 Fix remaining warnings: W2, W7, AW2
504f777 QC+Audit v2: 6 remaining fixes (R1-R6)
f8ec27c QC pipeline + audit + fix: 13 security/quality fixes
e3da4bb fix: pause/resume crash - parseInt timeout/retry from DB
```

---

**Full Changelog:** https://github.com/GlitchWorlds/IDMAM/compare/v1.0.0...v1.1.0
