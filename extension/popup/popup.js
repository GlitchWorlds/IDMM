/**
 * IDMM Download Manager — Popup Script
 * Handles UI rendering, messaging, and user actions for the popup panel.
 */

// ─── State ───────────────────────────────────────────────────────────────

const state = {
  downloads: [],
  pageLinks: [],
  serverOnline: null,
  loadingDownloads: true,
  loadingLinks: true,
  downloadsError: null,
  linksError: null,
};

// ─── DOM Refs ────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const dom = {
  statusDot: $('statusDot'),
  downloadsContainer: $('downloadsContainer'),
  downloadsCount: $('downloadsCount'),
  linksContainer: $('linksContainer'),
  linksCount: $('linksCount'),
  addUrlInput: $('addUrlInput'),
  addUrlBtn: $('addUrlBtn'),
  settingsBtn: $('settingsBtn'),
  openAppBtn: $('openAppBtn'),
};

// ─── Formatting ──────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec) return '';
  return formatBytes(bytesPerSec) + '/s';
}

function formatETA(seconds) {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 60) return Math.round(seconds) + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + Math.round(seconds % 60) + 's';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h + 'h ' + m + 'm';
}

function getFileIcon(filename) {
  if (!filename) return '\u{1F4C4}';
  const ext = filename.toLowerCase().split('.').pop();
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return '\u{1F3AC}';
  if (['mp3', 'wav', 'flac', 'ogg'].includes(ext)) return '\u{1F3B5}';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '\u{1F4E6}';
  if (['exe', 'msi', 'dmg'].includes(ext)) return '\u{2699}\u{FE0F}';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext)) return '\u{1F4D1}';
  return '\u{1F4C4}';
}

function truncateFilename(name, max = 28) {
  if (!name) return 'unknown';
  if (name.length <= max) return name;
  const ext = name.lastIndexOf('.');
  if (ext > 0 && (name.length - ext) < 10) {
    const base = name.substring(0, max - (name.length - ext) - 3);
    return base + '...' + name.substring(ext);
  }
  return name.substring(0, max - 3) + '...';
}

// ─── Status Dot ──────────────────────────────────────────────────────────

function setStatus(stateName) {
  dom.statusDot.className = 'header-status ' + stateName;
  dom.statusDot.title =
    stateName === 'online' ? 'Server connected' :
    stateName === 'offline' ? 'Server offline' :
    'Checking server...';
}

// ─── Render Page Links ───────────────────────────────────────────────────

function renderLinks() {
  if (state.loadingLinks) {
    dom.linksContainer.innerHTML =
      '<div class="loading-state">Scanning page for links<span class="loading-spinner"></span></div>';
    return;
  }

  if (state.linksError) {
    dom.linksContainer.innerHTML = '<div class="error-state">' + escapeHtml(state.linksError) + '</div>';
    return;
  }

  if (!state.pageLinks || state.pageLinks.length === 0) {
    dom.linksContainer.innerHTML = '<div class="empty-state">No downloadable links found on this page</div>';
    dom.linksCount.textContent = '0';
    return;
  }

  dom.linksCount.textContent = String(state.pageLinks.length);

  dom.linksContainer.innerHTML = state.pageLinks.map(function (link, i) {
    var name = link.text || link.filename || link.url.split('/').pop() || ('link-' + (i + 1));
    if (!name || name === link.url) {
      try { name = new URL(link.url).pathname.split('/').pop() || name; } catch (e) { /* keep name */ }
    }
    var size = link.size ? formatBytes(link.size) : '';
    var icon = getFileIcon(name);
    return '' +
      '<div class="link-item">' +
        '<span class="item-icon">' + icon + '</span>' +
        '<div class="item-info">' +
          '<div class="item-name" title="' + escapeAttr(link.url) + '">' + escapeHtml(name) + '</div>' +
          '<div class="item-meta">' + escapeHtml(size) + '</div>' +
        '</div>' +
        '<div class="item-actions">' +
          '<button class="btn btn-primary btn-sm download-link" data-url="' + escapeAttr(link.url) + '" data-filename="' + escapeAttr(name) + '">\u25B6</button>' +
        '</div>' +
      '</div>';
  }).join('');

  // Attach click handlers
  dom.linksContainer.querySelectorAll('.download-link').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var url = btn.getAttribute('data-url');
      var filename = btn.getAttribute('data-filename');
      addDownload(url, filename);
    });
  });
}

// ─── Render Downloads ────────────────────────────────────────────────────

function renderDownloads() {
  if (state.loadingDownloads) {
    dom.downloadsContainer.innerHTML =
      '<div class="loading-state">Loading<span class="loading-spinner"></span></div>';
    return;
  }

  if (state.downloadsError) {
    dom.downloadsContainer.innerHTML = '<div class="error-state">' + escapeHtml(state.downloadsError) + '</div>';
    return;
  }

  if (!state.downloads || state.downloads.length === 0) {
    dom.downloadsContainer.innerHTML = '<div class="empty-state">No active downloads</div>';
    dom.downloadsCount.textContent = '0';
    return;
  }

  // Show all downloads, not just active ones
  dom.downloadsCount.textContent = String(state.downloads.length);

  dom.downloadsContainer.innerHTML = state.downloads.map(function (d) {
    var name = d.filename || d.name || d.url ? d.url.split('/').pop() : 'unknown';
    var icon = getFileIcon(name);
    var pct = d.progress != null ? d.progress : (d.total_bytes > 0 ? ((d.received_bytes || 0) / d.total_bytes * 100) : 0);
    pct = Math.min(Math.max(pct, 0), 100);

    var status = d.status || 'unknown';
    var progressClass = 'progress-fill';
    if (status === 'paused') progressClass += ' paused';
    else if (status === 'error' || status === 'failed') progressClass += ' error';
    else if (status === 'completed' || status === 'finished') progressClass += ' completed';

    var metaParts = [];
    if (d.total_bytes > 0) metaParts.push(formatBytes(d.total_bytes));
    else if (d.received_bytes > 0) metaParts.push(formatBytes(d.received_bytes));
    if (d.speed && d.speed > 0 && (status === 'downloading' || status === 'active')) {
      metaParts.push(formatSpeed(d.speed));
    }
    if (d.eta > 0 && (status === 'downloading' || status === 'active')) {
      metaParts.push(formatETA(d.eta));
    }
    if (status === 'paused') metaParts.push('Paused');
    else if (status === 'completed' || status === 'finished') metaParts.push('Done');
    else if (status === 'error' || status === 'failed') metaParts.push('Failed');

    var metaText = metaParts.length > 0 ? metaParts.join(' \u2022 ') : status;
    var pctDisplay = Math.round(pct);

    return '' +
      '<div class="download-item">' +
        '<span class="item-icon">' + icon + '</span>' +
        '<div class="item-info">' +
          '<div class="item-name" title="' + escapeAttr(name) + '">' + escapeHtml(truncateFilename(name)) + '</div>' +
          '<div class="item-meta">' + escapeHtml(pctDisplay + '% \u2022 ' + metaText) + '</div>' +
          (status === 'downloading' || status === 'active' || status === 'paused'
            ? '<div class="progress-bar"><div class="' + progressClass + '" style="width:' + pct + '%"></div></div>'
            : '') +
        '</div>' +
        (d.id ? '<div class="item-actions">' +
          '<button class="btn btn-sm btn-secondary cancel-dl" data-id="' + d.id + '" title="Cancel">\u2716</button>' +
        '</div>' : '') +
      '</div>';
  }).join('');

  // Attach cancel handlers
  dom.downloadsContainer.querySelectorAll('.cancel-dl').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-id');
      chrome.runtime.sendMessage({ type: 'CANCEL_DOWNLOAD', id: id });
    });
  });
}

// ─── Messaging ───────────────────────────────────────────────────────────

function addDownload(url, filename) {
  if (!url) return;
  chrome.runtime.sendMessage({
    type: 'ADD_DOWNLOAD',
    downloadInfo: { url: url, filename: filename || undefined },
  }, function (resp) {
    if (chrome.runtime.lastError) {
      showToast('Error: ' + chrome.runtime.lastError.message);
      return;
    }
    if (resp && !resp.ok) {
      showToast('Error: ' + (resp.error || 'unknown'));
    }
  });
}

function fetchDownloads() {
  state.loadingDownloads = true;
  state.downloadsError = null;
  renderDownloads();

  chrome.runtime.sendMessage({ type: 'GET_DOWNLOADS' }, function (resp) {
    state.loadingDownloads = false;
    if (chrome.runtime.lastError) {
      state.downloadsError = 'Connection error';
      state.serverOnline = false;
      setStatus('offline');
      renderDownloads();
      return;
    }
    if (resp && resp.ok && Array.isArray(resp.downloads)) {
      state.downloads = resp.downloads;
      state.serverOnline = true;
      setStatus('online');
    } else {
      state.downloads = [];
      state.downloadsError = resp && resp.error ? resp.error : 'Failed to load downloads';
      state.serverOnline = false;
      setStatus('offline');
    }
    renderDownloads();
  });
}

function fetchPageLinks() {
  state.loadingLinks = true;
  state.linksError = null;
  renderLinks();

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (chrome.runtime.lastError || !tabs || !tabs[0]) {
      state.loadingLinks = false;
      state.linksError = 'Cannot access current tab';
      renderLinks();
      return;
    }

    var tabId = tabs[0].id;

    // Try getSelectedLinks first
    chrome.tabs.sendMessage(tabId, { action: 'getSelectedLinks' }, function (resp) {
      if (chrome.runtime.lastError) {
        state.loadingLinks = false;
        // Content script not loaded on this page (e.g. chrome:// or about:)
        state.linksError = null;
        state.pageLinks = [];
        renderLinks();
        return;
      }

      state.loadingLinks = false;
      if (resp && Array.isArray(resp.links)) {
        // Filter to likely downloadable extensions
        var downloadExts = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.exe', '.msi', '.dmg',
                           '.mp4', '.mkv', '.avi', '.mov', '.webm', '.mp3', '.wav', '.flac',
                           '.pdf', '.doc', '.docx', '.xlsx', '.pptx', '.epub', '.iso', '.apk'];
        var links = resp.links.filter(function (l) {
          var u = l.url.toLowerCase();
          return downloadExts.some(function (ext) { return u.includes(ext); });
        });
        state.pageLinks = links;
      } else {
        state.pageLinks = [];
      }
      renderLinks();
    });
  });
}

function checkServerStatus() {
  chrome.runtime.sendMessage({ type: 'CHECK_STATUS' }, function (resp) {
    if (chrome.runtime.lastError) return;
    var online = resp && resp.ok && resp.online;
    if (online !== state.serverOnline) {
      state.serverOnline = online;
      setStatus(online ? 'online' : 'offline');
      if (online) fetchDownloads();
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(msg) {
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:50px;left:50%;transform:translateX(-50%);background:#334155;color:#e2e8f0;padding:6px 12px;border-radius:6px;font-size:11px;z-index:999;white-space:nowrap;max-width:300px;overflow:hidden;text-overflow:ellipsis;';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 2500);
}

// ─── Event Handlers ─────────────────────────────────────────────────────

dom.addUrlBtn.addEventListener('click', function () {
  var url = dom.addUrlInput.value.trim();
  if (!url) {
    showToast('Enter a URL');
    return;
  }
  // Basic URL validation
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    showToast('Invalid URL (must start with http:// or https://)');
    return;
  }
  addDownload(url);
  dom.addUrlInput.value = '';
});

dom.addUrlInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') dom.addUrlBtn.click();
});

dom.settingsBtn.addEventListener('click', function () {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  }
});

dom.openAppBtn.addEventListener('click', function () {
  chrome.tabs.create({ url: 'http://127.0.0.1:9977' });
});

// ─── Message Listener (from background) ──────────────────────────────────

chrome.runtime.onMessage.addListener(function (message) {
  if (message.type === 'DOWNLOAD_UPDATE') {
    var dl = message.downloads;
    if (Array.isArray(dl)) {
      state.downloads = dl;
      state.loadingDownloads = false;
      state.downloadsError = null;
      renderDownloads();
    }
  }
});

// ─── Init ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  fetchLinks();
  fetchDownloads();
  setStatus('checking');

  // Re-check server status periodically
  setInterval(checkServerStatus, 10000);

  // Re-fetch page links after a short delay (page may have updated)
  setTimeout(fetchLinks, 3000);
});

// Use fetchLinks as an alias for fetchPageLinks
function fetchLinks() {
  fetchPageLinks();
}
