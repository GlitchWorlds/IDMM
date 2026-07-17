'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// ─── IDMM Core ─────────────────────────────────────────────────
// Resolve engine paths — works in both dev and packaged mode
function resolveEngine() {
  // Try multiple candidate paths (covers dev, asar, no-asar, portable)
  const candidates = [
    path.join(__dirname, 'app-engine'),          // electron/app-engine/ (prebuild copy)
    path.join(__dirname, '..', 'app'),            // ../app/ (dev mode)
    path.join(process.resourcesPath || '', 'app-engine'), // resources/app-engine/ (extraResources)
    path.join(path.dirname(process.execPath), 'resources', 'app-engine'),
  ];
  for (const dir of candidates) {
    try {
      const testPath = path.join(dir, 'src', 'db', 'sqlite.js');
      if (fs.existsSync(testPath)) return dir;
    } catch {}
  }
  // Fallback: let it fail with a clear error
  throw new Error(`[IDMM] Cannot find engine. Tried: ${candidates.join(', ')}`);
}

const APP_DIR = resolveEngine();

const IDMMDatabase = require(path.join(APP_DIR, 'src', 'db', 'sqlite'));
const DownloadManager = require(path.join(APP_DIR, 'src', 'engine', 'downloader'));
const IDMMServer = require(path.join(APP_DIR, 'src', 'server', 'server'));

const DATA_DIR = path.join(os.homedir(), '.idmm');
const DB_PATH = path.join(DATA_DIR, 'idmm.db');
const TEMP_DIR = path.join(DATA_DIR, 'temp');
const DEFAULT_SAVE_PATH = path.join(os.homedir(), 'Downloads', 'IDMM');
const UI_DEV_URL = 'http://localhost:5174';
const UI_PROD_PATH = path.join(__dirname, 'ui', 'build', 'index.html');

// Ensure directories
for (const dir of [DATA_DIR, TEMP_DIR, DEFAULT_SAVE_PATH]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let mainWindow = null;
let tray = null;
let server = null;
let db = null;
let downloader = null;

// ─── Server Start ───────────────────────────────────────────────

async function startServer() {
  console.log('[IDMM] Starting server...');
  db = await IDMMDatabase.create(DB_PATH);
  downloader = new DownloadManager({
    db,
    tempDir: TEMP_DIR,
    settings: db.getAllSettings(),
  });
  server = new IDMMServer({ db, downloader });
  await server.start();
  console.log('[IDMM] Server ready on http://127.0.0.1:9977');
}

// ─── Window ─────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    title: 'IDMM - Internet Download Manager Max',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0f172a',
    show: false, // Show when ready
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Remove menu bar completely
  mainWindow.removeMenu();

  // Load UI
  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL(UI_DEV_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(UI_PROD_PATH);
  }

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── System Tray ────────────────────────────────────────────────

function createTray() {
  // Create a simple tray icon (16x16 blue circle)
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon;

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    // Create a simple 16x16 icon programmatically
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip('IDMM - Download Manager');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show IDMM',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Active Downloads: 0',
      enabled: false,
      id: 'active-count',
    },
    { type: 'separator' },
    {
      label: 'Open Downloads Folder',
      click: () => shell.openPath(DEFAULT_SAVE_PATH),
    },
    {
      label: 'Open Web UI',
      click: () => shell.openExternal('http://127.0.0.1:9977'),
    },
    { type: 'separator' },
    {
      label: 'Quit IDMM',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
    createTray();

    // Update tray active count periodically
    setInterval(() => {
      if (tray && downloader) {
        const count = downloader.getActiveCount();
        const menu = tray.contextMenu;
        if (menu) {
          const items = menu.items;
          const countItem = items.find(i => i.id === 'active-count');
          if (countItem) countItem.label = `Active Downloads: ${count}`;
        }
      }
    }, 5000);
  } catch (err) {
    console.error('[IDMM] Fatal:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray (don't quit)
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (db) db.close();
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
