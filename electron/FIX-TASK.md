# CRITICAL BUG FIX: IDMAM Packaged App Crash

## Error (on user's PC after install)
```
Error: Cannot find module
'D:\Users\B\AppData\Local\Programs\IDMAM\resources\app.asar\app-engine\src\db\sqlite'
```

## Root Cause Analysis
When Electron packages the app with `asar: true`, `require()` fails to resolve paths inside the asar archive. The `prebuild` script copies `../app/src` → `app-engine/src` but:

1. **Module resolution inside asar is fragile** — `require(path.join(__dirname, 'app-engine', 'src', 'db', 'sqlite'))` can fail
2. **Dependencies from `../app/node_modules` are NOT copied** — if `sqlite.js` requires `sql.js`, it won't find it
3. The previous Claude Code session set `"asar": false` but that change got lost or overwritten

## Required Fix (COMPREHENSIVE)

### Option A: Disable asar (SIMPLE, RECOMMENDED)
In `D:\IDMAM\electron\package.json` build config:
- Set `"asar": false`
- Remove `"asarUnpack"` if present
- This makes the app slightly larger but 100% reliable

### Option B: Fix asar paths (COMPLEX)
Keep `asar: true` but:
- Use `__dirname` + proper path resolution
- Ensure ALL dependencies are bundled
- Add `asarUnpack` for native modules

**GO WITH OPTION A** — reliability over size.

## Also Fix These Issues

### 1. Prebuild must copy app dependencies too
The prebuild script only copies `../app/src` and `../app/package.json` but NOT `../app/node_modules`.
If the app-engine modules depend on anything from `../app/node_modules`, they'll fail.

Fix: Either:
- Copy `../app/node_modules` into `app-engine/node_modules` during prebuild, OR
- Ensure all dependencies are in `electron/node_modules` (they already are: sql.js, express, ws, etc.)

Best approach: Remove `app-engine` indirection entirely. Just reference `../app` directly in dev AND use the electron `files` config to include `../app/**/*` properly.

### 2. Path resolution in main.js
Current code:
```js
const APP_DIR = isPackaged
  ? path.join(__dirname, 'app-engine')
  : path.join(__dirname, '..', 'app');
```

Better approach: Always use relative path from __dirname:
```js
const APP_DIR = path.join(__dirname, 'app-engine');
// In dev, symlink or copy; in prod, it's bundled
```

Or even simpler: embed the engine directly in electron and skip the indirection.

### 3. Verify all require() paths work in packaged mode
After building, test that ALL these resolve correctly:
- `app-engine/src/db/sqlite`
- `app-engine/src/engine/downloader`
- `app-engine/src/server/server`

### 4. Icon path in packaged mode
`path.join(__dirname, 'assets', 'icon.png')` — verify this works in packaged mode.
For NSIS: `extraResources` copies to `process.resourcesPath`, not `__dirname`.

## Steps
1. Read current `D:\IDMAM\electron\package.json` and `D:\IDMAM\electron\main.js`
2. Fix package.json: set `"asar": false`, ensure all files included
3. Fix main.js: robust path resolution for both dev and packaged
4. Run `cd D:\IDMAM\electron && npm run build` to rebuild
5. Verify `dist/win-unpacked/resources/` contains all needed files
6. Verify `dist/IDMAM-Setup-1.0.0.exe` is generated
7. Report: what was changed, what files are in the packaged app

## CRITICAL
- Test that `require()` works for all 3 engine modules in the packaged output
- Do NOT leave asar:true without thorough testing
- The fix must work on a FRESH Windows machine (no dev dependencies)
