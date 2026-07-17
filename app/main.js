'use strict';

/**
 * IDMM — Internet Download Manager Max
 * Entry Point v1.0
 *
 * Starts the API server, initializes the database, and optionally
 * auto-resumes any previously paused downloads.
 *
 * Usage: node main.js [--auto-resume]
 */

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const IDMMDatabase = require('./src/db/sqlite');
const DownloadManager = require('./src/engine/downloader');
const IDMMServer = require('./src/server/server');

// ─── Configuration ─────────────────────────────────────────────────

const APP_DIR = __dirname;
const LEGACY_DATA_DIR = path.join(os.homedir(), '.idmam');
const DATA_DIR = path.join(os.homedir(), '.idmm');
const DB_PATH = path.join(DATA_DIR, 'idmm.db');
const TEMP_DIR = path.join(DATA_DIR, 'temp');
const DEFAULT_SAVE_PATH = path.join(os.homedir(), 'Downloads', 'IDMM');

// ─── Data Migration (.idmam → .idmm) ──────────────────────────────
// Migrate legacy data directory if it exists and new one doesn't
if (fs.existsSync(LEGACY_DATA_DIR) && !fs.existsSync(DATA_DIR)) {
  try {
    fs.renameSync(LEGACY_DATA_DIR, DATA_DIR);
    console.log('[IDMM] Migrated data dir: .idmam → .idmm');
    // Rename DB file if it still has the old name
    const legacyDb = path.join(DATA_DIR, 'idmam.db');
    if (fs.existsSync(legacyDb)) {
      fs.renameSync(legacyDb, DB_PATH);
      console.log('[IDMM] Migrated DB: idmam.db → idmm.db');
    }
  } catch (err) {
    console.error('[IDMM] Data migration failed (using existing paths):', err.message);
  }
}

// Ensure directories exist
for (const dir of [DATA_DIR, TEMP_DIR, DEFAULT_SAVE_PATH]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Banner ────────────────────────────────────────────────────────

function printBanner() {
  console.log('');
  console.log('  ██╗██████╗ ███╗   ███╗ ███╗   ███╗');
  console.log('  ██║██╔══██╗████╗ ████║ ████╗ ████║');
  console.log('  ██║██║  ██║██╔████╔██║ ██╔████╔██║');
  console.log('  ██║██║  ██║██║╚██╔╝██║ ██║╚██╔╝██║');
  console.log('  ██║██████╔╝██║ ╚═╝ ██║ ██║ ╚═╝ ██║');
  console.log('  ╚═╝╚═════╝ ╚═╝     ╚═╝ ╚═╝     ╚═╝');
  console.log('  Internet Download Manager Max v1.0.0');
  console.log('  100% Free. No Ads. No Tracking. Forever.');
  console.log('');
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  printBanner();

  const autoResume = process.argv.includes('--auto-resume');

  // 1. Initialize database (async — sql.js WASM needs to load first)
  console.log('[IDMM] Initializing database...');
  const db = await IDMMDatabase.create(DB_PATH);
  console.log(`[IDMM] Database: ${DB_PATH}`);

  // 2. Load settings
  const settings = db.getAllSettings();
  console.log(`[IDMM] Settings loaded (${Object.keys(settings).length} keys)`);

  // 3. Initialize download manager
  console.log('[IDMM] Initializing download engine...');
  const downloader = new DownloadManager({
    db,
    tempDir: TEMP_DIR,
    settings,
    onProgress: (downloadId, state) => {
      // Progress is broadcast via WebSocket in server.js
    },
    onComplete: (downloadId, result) => {
      console.log(`[IDMM] ✅ Download completed: ${result.filename} (${formatBytes(result.total_size)} in ${result.duration}s)`);
    },
    onError: (downloadId, error) => {
      console.error(`[IDMM] ❌ Download error: ${error.message}`);
    },
  });

  // 4. Auto-resume paused downloads if requested
  if (autoResume) {
    const resumable = db.getResumableDownloads();
    if (resumable.length > 0) {
      console.log(`[IDMM] Found ${resumable.length} resumable download(s)`);
      for (const dl of resumable) {
        try {
          console.log(`[IDMM] Resuming: ${dl.filename}`);
          await downloader.resumeDownload(dl.id);
        } catch (err) {
          console.error(`[IDMM] Failed to resume ${dl.filename}: ${err.message}`);
        }
      }
    } else {
      console.log('[IDMM] No resumable downloads found');
    }
  }

  // 5. Start API server
  const server = new IDMMServer({ db, downloader });

  // Wire up completion broadcast
  const origOnComplete = downloader.onComplete;
  downloader.onComplete = (downloadId, result) => {
    origOnComplete(downloadId, result);
    server.broadcast({ type: 'status', id: downloadId, status: 'completed' });
  };

  await server.start();

  console.log('');
  console.log('[IDMM] Ready! API endpoints:');
  console.log(`  POST   http://127.0.0.1:9977/api/download     — Start download`);
  console.log(`  GET    http://127.0.0.1:9977/api/downloads    — List downloads`);
  console.log(`  GET    http://127.0.0.1:9977/api/download/:id — Download status`);
  console.log(`  POST   http://127.0.0.1:9977/api/download/:id/pause  — Pause`);
  console.log(`  POST   http://127.0.0.1:9977/api/download/:id/resume — Resume`);
  console.log(`  POST   http://127.0.0.1:9977/api/download/:id/cancel — Cancel`);
  console.log(`  DELETE http://127.0.0.1:9977/api/download/:id  — Delete`);
  console.log(`  GET    http://127.0.0.1:9977/api/settings     — Settings`);
  console.log(`  PUT    http://127.0.0.1:9977/api/settings     — Update settings`);
  console.log(`  GET    http://127.0.0.1:9977/api/stats        — Statistics`);
  console.log(`  WS     ws://127.0.0.1:9977/ws                — Real-time progress`);
  console.log('');

  // 6. Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[IDMM] ${signal} received, shutting down...`);

    // Pause all active downloads
    const activeStates = downloader.getActiveStates();
    for (const state of activeStates) {
      try {
        downloader.pauseDownload(state.id);
        console.log(`[IDMM] Paused: ${state.filename}`);
      } catch {
        // Best effort
      }
    }

    await server.stop();
    db.close();
    console.log('[IDMM] Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Windows: handle Ctrl+C
  if (process.platform === 'win32') {
    const readline = require('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('SIGINT', () => shutdown('SIGINT'));
  }
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

// ─── Run ───────────────────────────────────────────────────────────

// Global error handlers to prevent silent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('[IDMM] Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[IDMM] Uncaught exception:', err);
});

main().catch((err) => {
  console.error('[IDMM] Fatal error:', err);
  process.exit(1);
});
