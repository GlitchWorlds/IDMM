const API_BASE = 'http://127.0.0.1:9977';
const WS_URL = 'ws://127.0.0.1:9977/ws';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || 'Request failed');
  }
  if (res.status === 204) return null;
  return res.json();
}

export function getDownloads() {
  return request('/api/downloads');
}

export function getDownload(id) {
  return request(`/api/download/${id}`);
}

export function addDownload(url, options = {}) {
  return request('/api/download', {
    method: 'POST',
    body: JSON.stringify({ url, ...options }),
  });
}

export function pauseDownload(id) {
  return request(`/api/download/${id}/pause`, { method: 'POST' });
}

export function resumeDownload(id) {
  return request(`/api/download/${id}/resume`, { method: 'POST' });
}

export function cancelDownload(id) {
  return request(`/api/download/${id}/cancel`, { method: 'POST' });
}

export function deleteDownload(id, deleteFile = false) {
  const url = deleteFile ? `/api/download/${id}?delete_file=true` : `/api/download/${id}`;
  return request(url, { method: 'DELETE' });
}

export function openFolder(path) {
  return request('/api/open-folder', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function getSettings() {
  return request('/api/settings');
}

export function updateSettings(settings) {
  return request('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export function getStats() {
  return request('/api/stats');
}

export function getWebSocketUrl() {
  return WS_URL;
}

// Utility formatters
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec === 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(1024));
  const value = bytesPerSec / Math.pow(1024, i);
  return `${value.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export function formatETA(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
