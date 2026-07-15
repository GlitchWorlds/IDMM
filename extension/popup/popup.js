'use strict';

/**
 * IDMAM Extension — Popup Script.
 *
 * Renders the download list with real-time progress, supports
 * pause/resume/cancel/delete actions, and adding new downloads.
 * Uses IDMAM_API from lib/api-client.js (loaded via script tag in popup.html).
 */

// ─── DOM references ────────────────────────────────────────────────

const $list = document.getElementById('downloads-list');
const $emptyState = document.getElementById('empty-state');
const $inputUrl = document.getElementById('input-url');
const $btnAdd = document.getElementById('btn-add');
const $btnSettings = document.getElementById('btn-settings');
const $statusBadge = document.getElementById('status-badge');
const $statsActive = document.getElementById('stats-active');
const $statsSpeed = document.getElementById('stats-speed');
const $statsQueued = document.getElementById('stats-queued');
const $tabs = document.querySelectorAll('.tab');
const $savePathHint = document.getElementById('save-path-hint'); // E9

// ─── State ─────────────────────────────────────────────────────────

let currentFilter = 'active';
let downloads = [];
let online = false;
let refreshTimer = null;

// ─── Initialization ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await restoreLastTab();
  await checkServerStatus();
  await refreshDownloads();
  await loadSavePathHint(); // E9: Show save path if configured

  // E5: Reduced polling — 5s as fallback (WebSocket provides real-time)
  refreshTimer = setInterval(refreshDownloads, 5000);
});

// Clean up on popup close
window.addEventListener('unload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});

// ─── Event listeners ───────────────────────────────────────────────

function setupEventListeners() {
  $btnAdd.addEventListener('click', addDownload);
  $inputUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addDownload();
  });

  $btnSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  $tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      $tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      chrome.storage.local.set({ idmam_lastTab: currentFilter });
      renderDownloads();
    });
  });

  // E5: Listen for real-time download updates from background WebSocket
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DOWNLOAD_UPDATE' && message.downloads) {
      downloads = message.downloads;
      online = true;
      updateStatusBadge();
      renderDownloads();
      updateStats();
    }

    // E10: Listen for settings changes from options page
    if (message.type === 'SETTINGS_UPDATED') {
      loadSavePathHint();
    }
  });
}

// ─── Tab memory (B4 / T1 / T2) ────────────────────────────────────

async function restoreLastTab() {
  return new Promise((resolve) => {
    chrome.storage.local.get('idmam_lastTab', (result) => {
      const saved = result.idmam_lastTab || 'active';
      currentFilter = saved;
      $tabs.forEach(t => {
        t.classList.toggle('active', t.dataset.filter === saved);
      });
      resolve();
    });
  });
}

// ─── E9: Save path hint ────────────────────────────────────────────

async function loadSavePathHint() {
  try {
    const settings = await IDMAM_API.getSettings();
    const path = settings.defaultSavePath;
    if (path) {
      $savePathHint.innerHTML = 'Save to: <strong>' + escapeHtml(path) + '</strong>';
      $savePathHint.title = path;
      $savePathHint.style.display = 'block';
    } else {
      $savePathHint.style.display = 'none';
    }
  } catch {
    $savePathHint.style.display = 'none';
  }
}

// ─── Server status ─────────────────────────────────────────────────

async function checkServerStatus() {
  online = await IDMAM_API.healthCheck();
  updateStatusBadge();
}

function updateStatusBadge() {
  if (online) {
    $statusBadge.textContent = 'Online';
    $statusBadge.className = 'status-badge status-online';
    $statusBadge.title = 'IDMAM server is running';
  } else {
    $statusBadge.textContent = 'Offline';
    $statusBadge.className = 'status-badge status-offline';
    $statusBadge.title = 'IDMAM server is not running. Start the IDMAM app first.';
  }
}

// ─── Downloads management ──────────────────────────────────────────

async function refreshDownloads() {
  try {
    downloads = await IDMAM_API.listDownloads();
    online = true;
  } catch {
    online = false;
    downloads = [];
  }

  updateStatusBadge();
  renderDownloads();
  updateStats();
}

function renderDownloads() {
  const filtered = filterDownloads(downloads, currentFilter);

  $list.innerHTML = '';

  if (filtered.length === 0) {
    $list.appendChild($emptyState);
    $emptyState.style.display = 'flex';

    if (!online) {
      $emptyState.querySelector('.empty-icon').textContent = '\u{1F50C}';
      $emptyState.querySelector('.empty-text').textContent = 'IDMAM server is offline';
      $emptyState.querySelector('.empty-hint').textContent = 'Start the IDMAM app, then try again';
    } else if (currentFilter === 'active') {
      $emptyState.querySelector('.empty-icon').textContent = '\u{1F4E5}';
      $emptyState.querySelector('.empty-text').textContent = 'No active downloads';
      $emptyState.querySelector('.empty-hint').textContent = 'Right-click a link → "Download with IDMAM"';
    } else {
      $emptyState.querySelector('.empty-icon').textContent = '\u{1F4ED}';
      $emptyState.querySelector('.empty-text').textContent = `No ${currentFilter} downloads`;
      $emptyState.querySelector('.empty-hint').textContent = '';
    }
    return;
  }

  $emptyState.style.display = 'none';

  for (const dl of filtered) {
    $list.appendChild(createDownloadElement(dl));
  }
}

function filterDownloads(all, filter) {
  switch (filter) {
    case 'active':
      return all.filter(d => d.status === 'downloading');
    case 'paused':
      return all.filter(d => d.status === 'paused');
    case 'completed':
      return all.filter(d => d.status === 'completed');
    case 'all':
    default:
      return all;
  }
}

function updateStats() {
  const active = downloads.filter(d => d.status === 'downloading').length;
  const paused = downloads.filter(d => d.status === 'paused').length;
  const queued = downloads.filter(d => d.status === 'queued').length;
  const totalSpeed = downloads
    .filter(d => d.status === 'downloading')
    .reduce((sum, d) => sum + (d.speed || 0), 0);

  $statsActive.textContent = `${active} active`;
  $statsSpeed.textContent = IDMAM_API.formatSpeed(totalSpeed);
  $statsQueued.textContent = `${queued + paused} queued`;
}

// ─── Download item rendering ───────────────────────────────────────

function createDownloadElement(dl) {
  const div = document.createElement('div');
  div.className = 'download-item';
  div.dataset.id = dl.id;

  const filename = dl.filename || extractFilename(dl.url) || 'Unknown file';
  const progress = dl.progress || 0;
  const speed = dl.speed || 0;
  const eta = dl.eta || 0;
  const downloaded = dl.downloaded || 0;
  const totalSize = dl.total_size || 0;

  // Status icon
  let statusIcon = '\u{1F4E5}';
  let progressClass = '';
  if (dl.status === 'completed') {
    statusIcon = '✅';
    progressClass = 'completed';
  } else if (dl.status === 'paused') {
    statusIcon = '⏸';
    progressClass = 'paused';
  } else if (dl.status === 'failed') {
    statusIcon = '❌';
    progressClass = 'failed';
  } else if (dl.status === 'downloading') {
    statusIcon = '⬇️';
  }

  // Action buttons
  let actionsHtml = '';
  if (dl.status === 'downloading') {
    actionsHtml = `
      <button class="dl-btn btn-pause" data-action="pause" data-id="${dl.id}">⏸ Pause</button>
      <button class="dl-btn btn-cancel" data-action="cancel" data-id="${dl.id}">✕ Cancel</button>
    `;
  } else if (dl.status === 'paused') {
    actionsHtml = `
      <button class="dl-btn btn-resume" data-action="resume" data-id="${dl.id}">▶ Resume</button>
      <button class="dl-btn btn-cancel" data-action="cancel" data-id="${dl.id}">✕ Cancel</button>
    `;
  } else if (dl.status === 'completed') {
    const openBtn = dl.save_to
      ? `<button class="dl-btn btn-open" data-action="open-folder" data-id="${dl.id}" data-path="${escapeHtml(dl.save_to)}">\u{1F4C2} Open</button>`
      : '';
    actionsHtml = `
      ${openBtn}
      <button class="dl-btn btn-delete" data-action="delete" data-id="${dl.id}">\u{1F5D1} Remove</button>
    `;
  } else if (dl.status === 'failed') {
    actionsHtml = `
      <button class="dl-btn btn-resume" data-action="resume" data-id="${dl.id}">↻ Retry</button>
      <button class="dl-btn btn-delete" data-action="delete" data-id="${dl.id}">\u{1F5D1} Remove</button>
    `;
  }

  // Meta info
  let metaHtml = '';
  if (dl.status === 'downloading') {
    metaHtml = `
      <span class="dl-speed">${IDMAM_API.formatSpeed(speed)}</span>
      <span>·</span>
      <span>${dl.active_threads || dl.threads || 0}T</span>
      ${eta > 0 ? `<span>·</span><span class="dl-eta">ETA ${IDMAM_API.formatETA(eta)}</span>` : ''}
    `;
  } else if (dl.status === 'completed') {
    metaHtml = '<span>Complete</span>';
  } else if (dl.status === 'paused') {
    metaHtml = `<span>Paused</span>${dl.threads ? ` · ${dl.threads}T` : ''}`;
  } else if (dl.status === 'failed') {
    metaHtml = `<span style="color: var(--danger)">${escapeHtml(dl.error || 'Failed')}</span>`;
  }

  div.innerHTML = `
    <div class="dl-header">
      <span class="dl-filename" title="${escapeHtml(dl.url || '')}">${escapeHtml(filename)}</span>
      <span class="dl-status-icon">${statusIcon}</span>
    </div>
    <div class="dl-progress-wrap">
      <div class="dl-progress-bar ${progressClass}" style="width: ${progress}%"></div>
    </div>
    <div class="dl-stats">
      <span class="dl-progress-text">${progress.toFixed(1)}%</span>
      <span>·</span>
      <span>${IDMAM_API.formatBytes(downloaded)}${totalSize > 0 ? ' / ' + IDMAM_API.formatBytes(totalSize) : ''}</span>
      <span>·</span>
      ${metaHtml}
    </div>
    <div class="dl-actions">${actionsHtml}</div>
  `;

  // Wire up action buttons
  div.querySelectorAll('.dl-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handleAction(btn.dataset.action, btn.dataset.id, {
        path: btn.dataset.path,
        btn,
      });
    });
  });

  return div;
}

// ─── Actions ───────────────────────────────────────────────────────

async function handleAction(action, id, data = {}) {
  try {
    switch (action) {
      case 'pause':
        await IDMAM_API.pauseDownload(id);
        break;
      case 'resume':
        await IDMAM_API.resumeDownload(id);
        break;
      case 'cancel':
        await IDMAM_API.cancelDownload(id);
        break;
      case 'delete':
        await IDMAM_API.deleteDownload(id);
        break;
      case 'open-folder':
        await copyToClipboard(data.path);
        // E6: Show prominent toast instead of small tooltip
        showToast('Path copied! Paste in Explorer address bar (Win+R)');
        return; // No refresh needed
    }
    await refreshDownloads();
  } catch (err) {
    showError(`Action failed: ${err.message}`);
  }
}

async function addDownload() {
  const url = $inputUrl.value.trim();
  if (!url) return;

  try {
    new URL(url);
  } catch {
    showError('Invalid URL. Please enter a valid download URL.');
    return;
  }

  try {
    // B1+B2: Read settings and apply save path + threads
    const settings = await IDMAM_API.getSettings();
    await IDMAM_API.startDownload({
      url,
      save_to: settings.defaultSavePath || undefined,
      threads: settings.maxThreads || undefined,
    });
    $inputUrl.value = '';

    // Switch to active tab
    $tabs.forEach(t => t.classList.remove('active'));
    document.querySelector('.tab[data-filter="active"]').classList.add('active');
    currentFilter = 'active';
    chrome.storage.local.set({ idmam_lastTab: 'active' });
    await refreshDownloads();
  } catch (err) {
    showError(`Failed: ${err.message}`);
  }
}

// ─── UI helpers ────────────────────────────────────────────────────

// ─── B5: Open Folder helpers ──────────────────────────────────────

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

function showTooltip(anchor, text) {
  const tip = document.createElement('span');
  tip.className = 'open-folder-tooltip';
  tip.textContent = text;
  anchor.style.position = 'relative';
  anchor.appendChild(tip);
  setTimeout(() => tip.remove(), 1500);
}

function showError(message) {
  document.querySelectorAll('.error-toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// E6: Prominent info toast for Open Folder / clipboard actions
function showToast(message) {
  document.querySelectorAll('.info-toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = 'info-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

function extractFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('/');
    const last = parts[parts.length - 1];
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
