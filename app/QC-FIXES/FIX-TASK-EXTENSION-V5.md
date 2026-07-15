# IDMAM Extension Fix Task — v5

> Source: QC-EXTENSION-V5.md
> Priority: P0 first, then P1

## E3: Save Path — Add folder browse button
Files: D:\IDMAM\extension\options\options.html, D:\IDMAM\extension\options\options.js
Fix:
1. Add a "Browse" button next to the save path input
2. Use hidden `<input type="file" webkitdirectory>` to pick folder
3. Extract folder path from selected files[0].webkitRelativePath
4. Set the input value to the selected folder path
5. Show current IDMAM default path as placeholder text

## E5: WebSocket real-time sync
Files: D:\IDMAM\extension\background.js, D:\IDMAM\extension\popup\popup.js
Fix:
1. In background.js: connect to ws://127.0.0.1:9977
2. On WebSocket message (download update), store latest state and broadcast to popup via chrome.runtime.sendMessage
3. In popup.js: listen for DOWNLOAD_UPDATE messages from background
4. When received, update the download in the list without full refresh
5. Keep polling as fallback (every 5s instead of 2s)
6. Reconnect WebSocket on disconnect (exponential backoff)

## E6: Open Folder — improve UX
Files: D:\IDMAM\extension\popup\popup.js
Fix:
1. When "Open" button clicked, copy path to clipboard
2. Show prominent toast: "Path copied! Open Explorer and paste in address bar"
3. Add a small "📋" icon on the button to indicate clipboard action

## E7: Settings hint text
Files: D:\IDMAM\extension\options\options.html
Fix: Add hint below Download Defaults section: "These settings apply to new downloads only"

## E8: Remove downloads.shelf permission
Files: D:\IDMAM\extension\manifest.json
Fix: Remove "downloads.shelf" from permissions array (not used in any code)

## E9: Show save path in popup
Files: D:\IDMAM\extension\popup\popup.js, D:\IDMAM\extension\popup\popup.css
Fix:
1. Below URL input, show "Save to: <path>" if defaultSavePath is set
2. Make it clickable to toggle (show/hide)
3. Read from settings on popup load

## E10: Settings sync
Files: D:\IDMAM\extension\popup\popup.js
Fix:
1. Listen for SETTINGS_UPDATED message from background
2. When received, re-read settings and update UI (save path display, etc.)

## After all fixes
- Verify manifest.json has no warnings
- Verify all settings save/load correctly
- Verify WebSocket connects and receives updates
- Report: files changed per fix
