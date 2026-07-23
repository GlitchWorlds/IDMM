const { contextBridge, ipcRenderer } = require('electron');

// Expose protected API to renderer
contextBridge.exposeInMainWorld('idmm', {
  platform: process.platform,
  version: process.env.npm_package_version || '1.2.5',
  apiUrl: 'http://127.0.0.1:9977',
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
});
