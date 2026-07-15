# IDMAM v4 — REMAINING FIX TASK

> Generated: 2026-07-15
> Sources: QC-V4-REPORT.md + AUDIT-V4-REPORT.md
> Status: 25 previous fixes verified ✅ — these are NEW findings

## P0 — MUST FIX BEFORE PUBLISH

### R1: SSRF Redirect Bypass (3 code paths)
Problem: SSRF check runs only on initial URL. All 3 redirect-following paths do NOT re-validate against blocklist.
Attack: POST { url: "https://evil.com/r" } → evil.com 302 → http://192.168.1.1/admin → follows without check.

Fix:
1. Create shared utility: D:\IDMAM\app\src\utils\ssrf.js
   - export function isBlockedHost(hostname) — checks localhost, private IPs, link-local
   - export function validateRedirect(redirectUrl, baseUrl) — resolves redirect URL, checks host, throws if blocked

2. Import in downloader.js — call validateRedirect() before following redirect in:
   - _probeUrl redirect handler
   - _doSingleStream redirect handler

3. Import in chunk-worker.js — call validateRedirect() before following redirect in:
   - downloadChunk redirect handler

## P1 — SHOULD FIX

### R2: sanitizeError pattern mismatches
File: D:\IDMAM\app\src\server\server.js
Problem: SAFE_ERROR_PATTERNS don't match actual error strings:
- Pattern: /^Concurrent download limit reached/i → Actual: "Maximum concurrent downloads reached (5)"
- Pattern: /^URL already being downloaded$/i → Actual: "URL is already being downloaded"
Fix: Update patterns to match actual strings. Make patterns more flexible (partial match OK for hardcoded strings).

### R3: Add link-local to SSRF blocklist
File: D:\IDMAM\app\src\utils\ssrf.js (from R1)
Problem: 169.254.x.x addresses not blocked.
Fix: Add hostname.startsWith('169.254.') check.

## P2 — NICE TO HAVE (skip if time)

### R4: DNS rebinding protection (INFO)
Not blocking for localhost-only API. Document as known limitation.

### R5: Disk space check (WARNING)
Not blocking. Document as known limitation.

## SKIP
- R4, R5: acceptable for v1 localhost app

## Output Contract
1. Fix R1 (shared ssrf.js + all 3 redirect paths)
2. Fix R2 (sanitizeError patterns)
3. Fix R3 (link-local in ssrf.js)
4. After fixes: cd D:\IDMAM\app && node test.js — all 9 must pass
5. Report: files changed, what was fixed per item
