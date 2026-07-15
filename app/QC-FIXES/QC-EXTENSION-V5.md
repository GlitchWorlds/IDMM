# IDMAM Extension — Full QC Report v5

> Auditor: Manager (manual deep inspection)
> Date: 2026-07-15 22:35 WIB
> Files: All extension files (manifest, popup, options, background, content, api-client)

---

## P0 — CRITICAL (Must Fix Before Publish)

### E1: Manifest `_comment_host_permissions` warning ❌
File: manifest.json
Problem: Non-standard key `_comment_host_permissions` — Chrome warns "Unrecognized manifest key"
Status: ✅ FIXED (removed in this session)

### E2: Manifest version stuck at 1.0.0 ❌
File: manifest.json
Problem: Version still "1.0.0" despite software being 1.1.0
Status: ✅ FIXED (bumped to 1.1.0)

### E3: Save Path — no folder picker ❌
File: options.html, options.js
Problem: User must manually type save path. No "Browse" button. Bad UX.
Root cause: Chrome extensions can't use native folder picker directly.
Fix: Add a "Browse" button that uses `<input type="file" webkitdirectory>` to pick a folder, then extract the path. Or at minimum, show the current IDMAM default path as placeholder.

### E4: Save Path not sent to server on intercept ❌
File: background.js → sendToIDMAM()
Problem: When background intercepts a download (auto-intercept), it DOES pass `save_to` from settings. ✅ CORRECT.
BUT: When user downloads via Chrome's download bar (not intercepted), the save path from settings is NOT applied because the download goes to Chrome's default location first.
Fix: This is by design — intercepted downloads use settings, non-intercepted go to Chrome.

### E5: Real-time sync — no WebSocket connection ❌
File: background.js, popup.js
Problem: Extension only polls every 2s. No WebSocket connection to server.
Impact: When download completes, user sees it up to 2s later. When download speed changes, popup shows stale data.
Fix: Connect to `ws://127.0.0.1:9977` in background.js. Broadcast download updates to popup via chrome.runtime.sendMessage. Popup subscribes to updates instead of polling.

### E6: Open Folder — only copies path ❌
File: popup.js
Problem: "📁 Open" button only copies path to clipboard. User expects folder to open in Explorer.
Fix: Add native messaging host that opens folder. Or use `chrome.downloads.show()` with download ID. Or at minimum, show "Copied!" feedback more prominently.

---

## P1 — IMPORTANT (Should Fix)

### E7: Save button — no indication settings apply to NEW downloads only ⚠️
File: options.html
Problem: User might think changing threads/path applies to existing downloads.
Fix: Add hint text: "These settings apply to new downloads only"

### E8: `downloads.shelf` permission side effect ⚠️
File: manifest.json
Problem: `downloads.shelf` permission can hide Chrome's download shelf/bar.
Fix: Remove `downloads.shelf` if not needed. Check if any code uses it.

### E9: No "Save Path" display in popup ⚠️
File: popup.js
Problem: When adding a download, user can't see/change the save path. It's silently taken from settings.
Fix: Show current save path below the URL input (expandable).

### E10: Settings not synced between popup and options ⚠️
File: popup.js, options.js
Problem: If user changes settings in options while popup is open, popup doesn't update until next refresh.
Fix: Listen for `SETTINGS_UPDATED` message in popup.

---

## P2 — NICE TO HAVE

### E11: No download speed graph ⚪
Not critical for v1.1.0.

### E12: No drag-and-drop URL ⚪
Not critical for v1.1.0.

---

## VERIFIED WORKING ✅

| Feature | Status |
|---------|--------|
| Save settings (chrome.storage.local) | ✅ PASS |
| Load settings on popup open | ✅ PASS |
| Tab memory (last selected tab) | ✅ PASS |
| Server URL hidden from UI | ✅ PASS |
| Download intercept (auto) | ✅ PASS |
| Context menu "Download with IDMAM" | ✅ PASS |
| Pause/Resume/Cancel/Delete | ✅ PASS |
| Badge showing active count | ✅ PASS |
| Health check (Connected/Not Running) | ✅ PASS |
| Settings applied in sendToIDMAM() | ✅ PASS |
| Settings applied in addDownload() | ✅ PASS |
| CSP locked to :9977 | ✅ PASS |
| No serverUrl in api-client.js | ✅ PASS |

---

## SUMMARY

| Priority | Count | Status |
|----------|-------|--------|
| P0 Critical | 6 | 2 fixed, 4 need fix |
| P1 Important | 4 | Need fix |
| P2 Nice to have | 2 | Skip for now |
| Verified Working | 13 | ✅ All pass |

---

## FIX PRIORITY

1. E3: Save path folder picker
2. E5: WebSocket real-time sync
3. E6: Open folder (native or better UX)
4. E8: Remove downloads.shelf permission
5. E7: Settings hint text
6. E9: Save path display in popup
7. E10: Settings sync between popup/options
