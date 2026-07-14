# IDMAM QC Fix Task

Read D:\IDMAM\QC-REPORT.md and fix ALL issues found. Here are the specific fixes needed:

## FIX 1: Remove unused undici dependency
File: D:\IDMAM\app\package.json
Action: Remove "undici" from dependencies (it's not used anywhere in source code)

## FIX 2: Clean up console.log in production
Files: D:\IDMAM\app\src\server\server.js and other app/src/*.js files
Action: Replace console.log with a debug flag or remove non-essential logs.
Keep error logs (console.error). Remove informational logs that clutter production.

## FIX 3: Pin helmet version for CJS compatibility
File: D:\IDMAM\electron\package.json
Action: Change "helmet": "^8.3.0" to "helmet": "8.3.0" (exact version, no caret)
This prevents auto-upgrade to a future version that might drop CJS support.

## FIX 4: Document extension host_permissions
File: D:\IDMAM\extension\manifest.json
Action: Add a comment or _comment field explaining why <all_urls> is needed:
"host_permissions needed for download URL interception - IDMAM must be able to
intercept downloads from any URL"

## FIX 5: Optimize Tailwind CSS build (optional but recommended)
File: D:\IDMAM\electron\ui\vite.config.js
Action: Add CSS code splitting or configure Tailwind to purge unused classes.
Or add to the Tailwind config: content purge paths for all .jsx files.

## After ALL fixes:
1. Run: cd D:\IDMAM\electron; npm run build
2. Verify dist/IDMAM-Setup-1.0.0.exe exists
3. Verify dist/win-unpacked/resources/app/ has all critical files
4. Report what was changed and any issues encountered
