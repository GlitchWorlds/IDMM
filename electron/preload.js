const { contextBridge, ipcRenderer } = require('electron');

// Expose protected API to renderer
contextBridge.exposeInMainWorld('idmm', {
  platform: process.platform,
  version: '1.2.1', // Hardcoded safely to avoid require('path') in sandbox
  apiUrl: 'http://127.0.0.1:9977',
});
