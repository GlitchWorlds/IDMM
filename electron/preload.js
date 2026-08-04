const { contextBridge, ipcRenderer } = require('electron');
const path = require('node:path');

// E-10: Read version from package.json instead of hardcoding
let appVersion = '0.0.0';
try {
  appVersion = require(path.join(__dirname, '..', 'package.json')).version || appVersion;
} catch {
  // Fallback if package.json not found
  appVersion = process.env.npm_package_version || '0.0.0';
}

// Expose protected API to renderer
contextBridge.exposeInMainWorld('idmm', {
  platform: process.platform,
  version: appVersion,
  apiUrl: 'http://127.0.0.1:9977',
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
});
