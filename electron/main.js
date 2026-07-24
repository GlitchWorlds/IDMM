'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const ClipboardMonitor = require(path.join(__dirname, 'clipboard-monitor'));

//  IDMM Core 
// Resolve engine paths  works in both dev and packaged mode
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

//  Server Start 

async function startServer() {
  console.log('[IDMM] Starting server...');
  db = await IDMMDatabase.create(DB_PATH);
  const settingsResult = db.getAllSettings();
  downloader = new DownloadManager({
    db,
    tempDir: TEMP_DIR,
    settings: settingsResult.ok ? settingsResult.data : {},
  });
  server = new IDMMServer({ db, downloader });
  await server.start();

  // WP-5: Wire onComplete callback — same pattern as app/main.js
  // Save server's handler (set in server.start()), then chain our logging + broadcast
  const serverOnComplete = downloader.onComplete;
  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  };
  downloader.onComplete = (downloadId, result) => {
    console.log(`[IDMM] ✓ Download completed: ${result.filename} (${formatBytes(result.total_size)} in ${result.duration}s)`);
    serverOnComplete(downloadId, result);
    server.broadcast({ type: 'status', id: downloadId, status: 'completed' });
  };

  console.log('[IDMM] Server ready on http://127.0.0.1:9977');
}

//  Window 

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    title: 'IDMM',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0f172a',
    show: false, // Show when ready
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f172a',
      symbolColor: '#cbd5e1',
      height: 32
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
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
      mainWindow.loadFile(path.join(__dirname, 'ui', 'build', 'index.html'));
      // Open dev tools in production temporarily to see what's failing if it's white
      // mainWindow.webContents.openDevTools();
    }

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Debugging logs from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (line ${line})`);
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log(`[Renderer Error] Failed to load: ${errorDescription}`);
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

//  System Tray 

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

//  App Lifecycle 

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
    createTray();

    // Clipboard monitor — auto-detect URLs copied to clipboard
    const clipMonitor = new ClipboardMonitor({ interval: 2000, cooldown: 10000 });
    clipMonitor.on('url-detected', (url) => {
      if (downloader) {
        downloader.startDownload(url).catch(err => console.error('[Clipboard]', err.message));
      }
    });
    clipMonitor.start();

    // Update tray active count periodically
    setInterval(() => {
      if (tray && downloader) {
        const count = downloader.getActiveCount();
        if (tray.contextMenu) {
          const items = tray.contextMenu.items;
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

app.on('before-quit', async () => {
  app.isQuitting = true;
  if (server) await server.stop();
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

// IPC Handlers
ipcMain.handle('dialog:selectFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (!canceled) {
    return filePaths[0];
  }
  return null;
});

