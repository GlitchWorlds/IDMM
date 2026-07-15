# IDMAM v4 Security + Quality Audit Report

**Auditor:** OPS-001 (Security Subagent)
**Date:** 2026-07-15 16:56 GMT+7
**Scope:** All 11 specified files — server, engine, db, extension
**Prior fixes verified:** 25 previous fixes (from v3 audit: 22 + 3 extension fixes)
**New additions:** sanitizeError, SSRF block, CSP lock to :9977, test mode bypass

---

## 1. sanitizeError() — Error Message Sanitization

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 1.1 | SAFE_ERROR_PATTERNS whitelist | **PASS** | 10 safe patterns covering all user-facing errors. Unknown errors → `"Internal server error"`. |
| 1.2 | All route handlers use sanitizeError() | **PASS** | Every `catch` block in all 9 route handlers calls `res.status(...).json({ error: sanitizeError(err) })`. No raw `err.message` in responses. |
| 1.3 | WebSocket onError uses sanitizeError() | **PASS** | `this.downloader.onError` callback broadcasts `{ error: sanitizeError(error) }` — no leakage to WS clients. |
| 1.4 | err.message not exposed in any response | **PASS** | `err.message` is read in `pause` (line ~191) and `resume` (line ~201) ONLY for HTTP status code selection (`includes('not active')` → 400, `includes('not found')` → 404). The message itself is never sent to the client. |
| 1.5 | Internal errors logged, not returned | **PASS** | `sanitizeError()` calls `console.error('[INTERNAL]', msg)` for unknown errors before returning generic string. |
| 1.6 | _finalizeDownload error propagation | **PASS** | Errors in `_finalizeDownload` (merge/checksum) set `state.error = err.message` internally and call `this.onError(state.id, err)` which routes through sanitizeError. No leakage to API. |
| 1.7 | Pattern mismatch — concurrent downloads | **WARNING** | Pattern `^Concurrent download limit reached$` won't match actual error `"Maximum concurrent downloads reached (5)"` because the endpoint returns the error directly (not through downloader) at line ~162. However, this error is constructed in server.js itself (not from user input), so no path leakage. Safe. |
| 1.8 | Pattern mismatch — active URL | **WARNING** | Pattern `^URL already being downloaded$` vs actual `"URL is already being downloaded"`. Mismatch means the message won't match the whitelist pattern — but the message at line ~155 is hardcoded in server.js (no dynamic content), so it's still safe. Falls through to generic "Internal server error". |

**Verdict: PASS** — No information leakage. Minor pattern mismatches are cosmetic (hardcoded strings, not user-controllable).

---

## 2. SSRF Protection

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 2.1 | Block localhost hostnames | **PASS** | `['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]']` |
| 2.2 | Block private IP ranges | **PASS** | `192.168.*`, `10.*`, `172.16-31.*` (RFC 1918). |
| 2.3 | IPv6 localhost variants | **PASS** | `::1` and `[::1]` blocked. |
| 2.4 | Case normalization | **PASS** | `hostname.toLowerCase()` before comparison. |
| 2.5 | URL encoding bypass | **PASS** | `new URL(url)` constructor normalizes all encodings (`%31%32%37%2E%30` → `127.0.0.1`). Tested. |
| 2.6 | Test mode bypass protection | **PASS** | `IDMAM_TEST=1` or `NODE_ENV=test` bypasses SSRF. Attack surface: attacker needs to control process environment. API is localhost-only (no external trigger). Risk: **Low**. |
| 2.7 | **CRITICAL: SSRF redirect bypass** | **FAIL** | SSRF check runs ONCE on the initial URL (server.js ~line 142). But `_probeUrl`, `_doSingleStream`, and `downloadChunk` all follow HTTP 301/302/303/307/308 redirects WITHOUT re-checking against the SSRF blocklist. Attack: `POST { url: "https://evil.com/steal" }` → evil.com returns `302 Location: http://127.0.0.1:8080/admin` → downloader follows to localhost. All three code paths are vulnerable. |
| 2.8 | Link-local addresses (169.254.x.x) | **WARNING** | Not in blocked list. Low practical risk for localhost-only API. |
| 2.9 | DNS rebinding | **INFO** | Attack requires victim to first visit attacker's domain in browser (to bind DNS). Not applicable to server-side fetch of user-provided URL. However, if SSRF redirect bypass (2.7) is fixed, DNS rebinding becomes the next vector. |

**Verdict: FAIL — SSRF redirect bypass is a real vulnerability.** Even though the API is localhost-only, an attacker can craft a redirect chain to probe internal services.

**Fix for 2.7:** Add SSRF re-check inside redirect handlers in all three code paths:

```javascript
// In _probeUrl, _doSingleStream, downloadChunk — before following redirect:
const redirectHostname = new URL(res.headers.location, currentUrl).hostname.toLowerCase();
const BLOCKED = ['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]'];
if (BLOCKED.includes(redirectHostname) || redirectHostname.startsWith('192.168.') ||
    redirectHostname.startsWith('10.') || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(redirectHostname)) {
  reject(new Error('Redirect to blocked host'));
  return;
}
```

Or better: extract SSRF check into a shared utility and import it everywhere.

---

## 3. CSP — Extension Security

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 3.1 | CSP connect-src locked to :9977 | **PASS** | `connect-src http://127.0.0.1:9977 ws://127.0.0.1:9977` — exact port, no wildcard. **Fixed from v3 WARNING.** |
| 3.2 | CSP script-src 'self' only | **PASS** | No remote scripts, no eval, no unsafe-eval. |
| 3.3 | CSP style-src | **PASS** | `'self' 'unsafe-inline'` — acceptable for extension UI. |
| 3.4 | CSP default-src 'self' | **PASS** | Restrictive baseline. |
| 3.5 | CSP img-src | **PASS** | `'self' data:` — allows data URIs for icons. |
| 3.6 | No frame-src / frame-ancestors needed | **PASS** | Extension pages can't be iframed by default in MV3. |
| 3.7 | Permissions minimal | **PASS** | `downloads`, `downloads.shelf`, `activeTab`, `storage`, `contextMenus` — all justified. |
| 3.8 | host_permissions `<all_urls>` | **PASS** | Required for download interception. Documented. |
| 3.9 | minimum_chrome_version: 109 | **PASS** | MV3 stable baseline. |

**Verdict: PASS** — CSP is now properly locked down. v3 wildcard port issue resolved.

---

## 4. Extension — No Backend URL Exposed to User

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 4.1 | popup.js — no `127.0.0.1:9977` | **PASS** | Uses `IDMAM_API` methods only. Zero hardcoded URLs. |
| 4.2 | options.js — no `127.0.0.1:9977` | **PASS** | Shows "Connected ✓" / "Not Running ✗" only. No URL rendered. |
| 4.3 | options.html — no `127.0.0.1:9977` | **PASS** | Clean HTML. No embedded URLs. |
| 4.4 | popup.js — error messages clean | **PASS** | `IDMAM_API._fetch` catches network errors and returns `"IDMAM server offline"` / `"IDMAM server timeout"`. No raw `fetch` errors with URLs. |
| 4.5 | api-client.js — BASE_URL internal | **PASS** | `BASE_URL` lives in library code only. `defaultSettings()` contains `serverUrl` but it's storage-only, never rendered to DOM. |
| 4.6 | Options page — no server URL input | **PASS** | No server URL configuration exposed in UI. Users can't see or change the backend address. |
| 4.7 | popup.js — XSS in download rendering | **PASS** | `escapeHtml()` uses `textContent` → `innerHTML` conversion. Applied to `filename`, `url` (as title attr), and `error`. No raw HTML injection. |

**Verdict: PASS** — Extension is clean. No backend details leak to user.

---

## 5. Test Mode Bypass (IDMAM_TEST=1)

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 5.1 | Test mode only disables SSRF | **PASS** | `isTestMode` check at SSRF block only. All other security (CORS, rate limit, path traversal, auth) remains active. |
| 5.2 | Cannot be set via API | **PASS** | `process.env` is read-only from HTTP requests. No endpoint sets env vars. |
| 5.3 | Cannot be set via settings DB | **PASS** | `allowedKeys` whitelist in PUT /api/settings doesn't include anything that maps to env vars. |
| 5.4 | Requires local shell access | **PASS** | Attacker needs `CMD/PowerShell` access to set `IDMAM_TEST=1`. At that point, SSRF is irrelevant. |
| 5.5 | NODE_ENV=test also triggers | **INFO** | Both `IDMAM_TEST=1` and `NODE_ENV=test` bypass SSRF. Standard practice. |

**Verdict: PASS** — Test mode bypass requires local shell access. Acceptable risk.

---

## 6. All 25 Previous Fixes Intact

| # | Fix | Status | Location Verified |
|---|-----|--------|-------------------|
| F1 | Path traversal protection | **PASS** | `server.js` — `path.resolve()` + allowed roots check |
| F2 | Double-settle guard | **PASS** | `downloader.js` — `safeResolve`/`safeReject` with `settled` flag |
| F3 | Resume already-active guard | **PASS** | `downloader.js` — `if (this.active.has(downloadId))` |
| F4 | DB status for pause message | **PASS** | `downloader.js` — checks DB for "already paused" |
| F6 | WebSocket maxPayload | **PASS** | `server.js` — `maxPayload: 64 * 1024` |
| F7 | WebSocket heartbeat | **PASS** | `server.js` — 30s ping/pong, `isAlive` flag |
| F8 | Chunk DB ID cache | **PASS** | `downloader.js` — `state.chunkDbIds` |
| F9 | Rate limit TTL eviction | **PASS** | `server.js` — 5-min cleanup interval |
| F10 | Duplicate URL tracking | **PASS** | `server.js` — `activeUrls` Set, cleanup on cancel/delete |
| F11 | Global worker semaphore | **PASS** | `downloader.js` — max 128, async acquire, stale guard |
| F12 | Resume file debounce | **PASS** | `resume.js` — 500ms debounce, cancel on direct save |
| F13 | Atomic merge | **PASS** | `merge.js` — `.part` temp + `fs.renameSync` |
| R1 | Redirect cap (5) | **PASS** | `chunk-worker.js` + `downloader.js` — `redirectCount >= 5` |
| R2 | Backpressure in merge | **PASS** | `merge.js` — pause/resume on drain |
| R3 | Cleanup on verify failure | **PASS** | `merge.js` — `unlinkSync(outputPath)` on size/checksum mismatch |
| R4 | Response drain before redirect | **PASS** | `downloader.js` — `res.resume()` before following redirect |
| R5 | Flush before exit (workers) | **PASS** | `chunk-worker.js` — `setTimeout(() => process.exit(...), 100)` |
| R6 | Filename uniqueness bound | **PASS** | `filename.js` — bounded at 999, throws on overflow |
| AW2 | Re-entrancy guard | **PASS** | `resume.js` — `_flushing` flag in `flushPending` |
| W2 | Destroy req before redirect | **PASS** | `downloader.js` — `req.destroy()` before recursive call |
| W7 | onComplete/onError safe overwrite | **PASS** | `server.js` — documented that base is no-op |
| EX1 | Extension privacy (popup) | **PASS** | `popup.js` — no backend URL |
| EX2 | Extension privacy (options) | **PASS** | `options.js` — status only, no URL |
| EX3 | Extension CSP locked | **PASS** | `manifest.json` — `connect-src` locked to `:9977` |
| EX4 | Settings whitelist | **PASS** | `server.js` — 10 allowed keys, unknown keys dropped |

**Verdict: PASS** — All 25 fixes verified intact. No regressions.

---

## 7. New Attack Surface Analysis

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 7.1 | SQL injection | **PASS** | All queries use `?` parameterized bindings. No string interpolation in SQL. |
| 7.2 | Prototype pollution | **PASS** | No `__proto__`, `constructor`, or untrusted `Object.assign`. |
| 7.3 | ReDoS | **PASS** | All regex patterns are simple (no nested quantifiers). `SAFE_ERROR_PATTERNS`, `parseContentDisposition`, `sanitizeFilename`. |
| 7.4 | XSS in popup rendering | **PASS** | `escapeHtml()` applied to all user-controlled strings (filename, url, error). |
| 7.5 | WebSocket auth | **PASS** | Origin validation via `_isAllowedOrigin()`. Localhost-only binding. No auth token needed for local app. |
| 7.6 | Cookie plaintext storage | **INFO** | Cookies stored in plaintext in SQLite + download.json. Acceptable for local-only app with no multi-user model. |
| 7.7 | Rate limit — req.ip on localhost | **PASS** | `req.ip` correctly returns `::ffff:127.0.0.1` for localhost. Single entry in rate limit map. Correct behavior. |
| 7.8 | Express JSON parse error | **PASS** | Express 4.x returns 400 for malformed JSON by default. No crash. |
| 7.9 | Integer overflow in chunk calc | **PASS** | `Math.ceil(totalSize / threads)` — JS handles large numbers via BigInt if needed. Typical file sizes are safe. |
| 7.10 | Worker thread crash safety | **PASS** | `worker.on('error')` + `worker.on('exit')` handle crashes. `__terminated` flag prevents double-marking. |
| 7.11 | Memory leak — wsClients cleanup | **PASS** | Cleanup on `close`, `error`, heartbeat termination, and `stop()`. |
| 7.12 | Disk exhaustion via download flood | **WARNING** | No disk space check before starting downloads. Rate limit (100/min) + concurrent cap (5) mitigate but don't prevent. Low risk for local app. |
| 7.13 | Path traversal via URL-sourced filename | **PASS** | `sanitizeFilename()` strips `<>:"/\|?*\x00-\x1f` including slashes. Even if URL contains `../../`, it's sanitized. |

---

## Summary

| Category | PASS | WARNING | FAIL | INFO |
|----------|------|---------|------|------|
| sanitizeError | 6 | 2 | 0 | 0 |
| SSRF Protection | 6 | 1 | **1** | 1 |
| CSP | 9 | 0 | 0 | 0 |
| Extension Privacy | 7 | 0 | 0 | 0 |
| Test Mode Bypass | 4 | 0 | 0 | 1 |
| Previous Fixes (25) | 25 | 0 | 0 | 0 |
| New Attack Surface | 11 | 1 | 0 | 1 |
| **Total** | **68** | **4** | **1** | **3** |

---

## Critical Finding

### FAIL — SSRF Redirect Bypass (Finding 2.7)

**Severity:** Medium (reduced from High — API is localhost-only)
**Impact:** Attacker can probe internal network services via redirect chains
**Reproduction:**
1. Host `https://evil.com/redirect` which returns `302 Location: http://192.168.1.1/admin`
2. `POST /api/download { url: "https://evil.com/redirect" }`
3. Initial URL passes SSRF check (evil.com is public)
4. `_probeUrl` follows redirect → fetches from internal IP without SSRF check
5. Same applies to `_doSingleStream` and `downloadChunk` (chunk-worker.js)

**Affected code paths:**
- `downloader.js:_probeUrl` — redirect handler (line ~330)
- `downloader.js:_doSingleStream` — redirect handler (line ~460)
- `chunk-worker.js:downloadChunk` — redirect handler (line ~120)

**Recommended fix:** Extract SSRF check into a shared utility `isBlockedHost(hostname)` and call it before following every redirect in all three code paths.

---

## Warnings (Non-Blocking)

| # | Warning | Risk | Recommendation |
|---|---------|------|----------------|
| W1 | sanitizeError pattern mismatches (1.7, 1.8) | Low | Align patterns with actual error strings (cosmetic) |
| W2 | Link-local addresses not blocked (2.8) | Low | Add `169.254.*` to SSRF blocklist |
| W3 | No disk space check (7.12) | Low | Add `fs.statfs()` check before download start (future) |
| W4 | DNS rebinding as next SSRF vector (2.9) | Info | After fixing redirect bypass, consider DNS resolution validation |

---

## Verdict

**1 FAIL (SSRF Redirect Bypass), 0 blocking for localhost-only deployment, but should be fixed before publish.**

- **All 25 previous fixes: ✅ Intact**
- **sanitizeError: ✅ Working** (minor pattern mismatches are cosmetic)
- **CSP: ✅ Fixed** (connect-src locked to :9977)
- **Extension privacy: ✅ Clean** (no backend URL exposed)
- **Test mode bypass: ✅ Acceptable** (requires local shell access)
- **SSRF redirect bypass: ❌ Needs fix** — add re-check in redirect handlers

### Recommended Priority
1. **Fix SSRF redirect bypass** (3 code paths) — ~30 min
2. Align sanitizeError patterns (optional, cosmetic)
3. Add link-local to blocklist (optional, low risk)

---
*Report generated by OPS-001 Security Auditor | IDMAM Audit v4 | 2026-07-15*
