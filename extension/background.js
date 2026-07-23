/**
 * IDMM Chrome Extension  Background Service Worker (Manifest V3)
 *
 * 1. Intercepts browser downloads  sends to IDMM via REST API
 * 2. Context menu: "Download with IDMM" for links/images/video/audio
 * 3. Badge showing active download count (poll every 2s)
 * 4. Handles messages from popup and options pages
 */

importScripts('./lib/api-client.js');

//  State 

let serverOnline = false;
let activeDownloadCount = 0;
let interceptedIds = new Set(); // Track downloads we've intercepted to avoid loops

// E5: WebSocket state
let ws = null;
let wsReconnectDelay = 1000; // Start at 1s, doubles on each failure, max 30s
const WS_MAX_DELAY = 30000;
const WS_URL = 'ws://127.0.0.1:9977/ws';

//  Health Check 

async function checkServer() {
  serverOnline = await IDMM_API.healthCheck();
  updateBadge();
  return serverOnline;
}

//  Badge 

function updateBadge() {
  if (!serverOnline) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    return;
  }

  if (activeDownloadCount > 0) {
    chrome.action.setBadgeText({ text: String(activeDownloadCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

//  E5: WebSocket real-time sync 

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return; // Already connected or connecting
  }

  try {
    ws = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[IDMM] WebSocket connected');
    wsReconnectDelay = 1000; // Reset backoff on successful connection
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // Settings changed (from another client or desktop app)  update local cache
      if (data.type === 'SETTINGS_CHANGED' && data.settings) {
        const mapped = IDMM_API._mapServerToLocal(data.settings);
        // Preserve extension-only settings (enabled)
        chrome.storage.local.get('idmm_settings', (result) => {
          const localOnly = result.idmm_settings || {};
          const merged = { ...IDMM_API.defaultSettings(), ...mapped, enabled: localOnly.enabled ?? true };
          chrome.storage.local.set({ idmm_settings: merged });
        });
        // Notify popup(s)
        chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED' }).catch(() => {});
        return;
      }

      // Broadcast download update to popup(s)
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_UPDATE',
        downloads: data.downloads || data,
      }).catch(() => {
        // No listeners (popup closed)  not an error
      });
    } catch (err) {
      console.warn('[IDMM] WebSocket message parse error:', err.message);
    }
  };

  ws.onclose = () => {
    console.log('[IDMM] WebSocket closed, reconnecting...');
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror  reconnect handled there
  };
}

function scheduleReconnect() {
  const delay = wsReconnectDelay;
  wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_MAX_DELAY);
  setTimeout(connectWebSocket, delay);
}

//  Send Download to IDMM 

async function sendToIDMM({ url, filename, filesize, cookies, referrer }) {
  if (!serverOnline) {
    console.log('[IDMM] Server offline, skipping intercept');
    return false;
  }

  try {
    // Get extension settings for defaults
    const settings = await IDMM_API.getSettings();

    const result = await IDMM_API.startDownload({
      url,
      filename: filename || undefined,
      cookies: cookies || undefined,
      referrer: referrer || undefined,
      threads: settings.maxThreads || undefined,
      save_to: settings.defaultSavePath || undefined,
    });

    console.log(`[IDMM] Download sent: ${result.filename} (${result.id})`);
    activeDownloadCount++;
    updateBadge();
    return true;
  } catch (err) {
    console.error('[IDMM] Failed to send download:', err.message);
    return false;
  }
}

//  Download Interception 

chrome.downloads.onDeterminingFilename.addListener(async (item, suggest) => {
  // Skip if we already intercepted this (avoid loops)
  if (interceptedIds.has(item.id)) {
    interceptedIds.delete(item.id);
    suggest(); // Let browser handle
    return;
  }

  // Check settings
  const settings = await IDMM_API.getSettings();
  if (!settings.enabled) {
    suggest();
    return;
  }

  // Check if file should be intercepted
  const should = IDMM_API.shouldIntercept(
    item.filename,
    item.totalBytes,
    settings
  );

  if (!should) {
    suggest();
    return;
  }

  // Send to IDMM
  const sent = await sendToIDMM({
    url: item.finalUrl || item.url,
    filename: item.filename,
    filesize: item.totalBytes,
    cookies: item.cookie,
    referrer: item.referrer,
  });

  if (sent) {
    // Intercept successful!
    interceptedIds.delete(item.id); // Clean up tracking
    // We MUST call cancel asynchronously to prevent Chrome from 
    // resuming the default browser download when we call suggest.
    setTimeout(() => {
      chrome.downloads.cancel(item.id, () => {
        chrome.downloads.erase({ id: item.id }, () => {});
      });
    }, 100);
    
    // Call suggest now to unblock Chrome's download pipeline
    suggest();
    return;
  }

  // If send failed, let browser handle it
  suggest();
});

//  Context Menu 

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'idmm-download-link',
    title: 'Download with IDMM',
    contexts: ['link'],
  });

  chrome.contextMenus.create({
    id: 'idmm-download-media',
    title: 'Download with IDMM',
    contexts: ['image', 'video', 'audio'],
  });

  chrome.contextMenus.create({
    id: 'idmm-download-selection',
    title: 'Download selected URL with IDMM',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let url = null;

  switch (info.menuItemId) {
    case 'idmm-download-link':
      url = info.linkUrl;
      break;
    case 'idmm-download-media':
      url = info.srcUrl || info.linkUrl;
      break;
    case 'idmm-download-selection': {
      const text = (info.selectionText || '').trim();
      try {
        new URL(text);
        url = text;
      } catch {
        console.log('[IDMM] Selection is not a valid URL');
      }
      break;
    }
  }

  if (!url) return;

  // Extract cookies from current tab
  let cookies = '';
  try {
    const cookieList = await chrome.cookies.getAll({ url });
    cookies = cookieList.map(c => `${c.name}=${c.value}`).join('; ');
  } catch {
    // Cookies API may not be available without permission
  }

  const sent = await sendToIDMM({
    url,
    cookies,
    referrer: tab?.url || '',
  });

  if (sent) {
    try {
      chrome.notifications?.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'IDMM',
        message: 'Download sent to IDMM',
      });
    } catch { /* notifications may not be available */ }
  }
});

//  Polling for Active Downloads 

// E11: Periodic cleanup of interceptedIds to prevent memory leak
setInterval(() => {
  if (interceptedIds.size > 100) interceptedIds.clear();
}, 60000);

async function pollDownloads() {
  if (!serverOnline) return;

  try {
    const downloads = await IDMM_API.listDownloads();
    const active = downloads.filter(d =>
      d.status === 'downloading' || d.status === 'merging'
    );
    activeDownloadCount = active.length;
    updateBadge();
  } catch {
    serverOnline = false;
    updateBadge();
  }
}

//  Message Handlers (popup & options communication) 

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Gap 3: Handle messages from content scripts (PAGE_METADATA)
  if (message && message.type === 'PAGE_METADATA') {
    // Log page metadata from content script
    console.log(
      `[IDMM] Content script metadata: ${message.pageTitle}`,
      `(${message.downloadLinks?.length || 0} links, ${message.mediaUrls?.length || 0} media)`
    );

    // If the page has media URLs, log them for potential interception
    if (message.mediaUrls && message.mediaUrls.length > 0) {
      console.log('[IDMM] Media URLs detected:', message.mediaUrls);
    }

    // If the server is online and there are download links, we could
    // optionally surface them (future: auto-intercept on page load)
    if (serverOnline && message.downloadLinks && message.downloadLinks.length > 0) {
      console.log(`[IDMM] ${message.downloadLinks.length} download link(s) available on page`);
    }

    // ACK to content script (no response needed but clean protocol)
    sendResponse({ ok: true });
    return;
  }

  // Handle async  return true to keep message channel open
  (async () => {
    switch (message.type) {
      case 'CHECK_STATUS':
        return { ok: true, online: serverOnline };

      case 'GET_DOWNLOADS':
        try {
          const downloads = await IDMM_API.listDownloads();
          return { ok: true, downloads };
        } catch (err) {
          return { ok: false, error: err.message, downloads: [] };
        }

      case 'PAUSE_DOWNLOAD':
        try {
          const result = await IDMM_API.pauseDownload(message.id);
          return { ok: true, result };
        } catch (err) {
          return { ok: false, error: err.message };
        }

      case 'RESUME_DOWNLOAD':
        try {
          const result = await IDMM_API.resumeDownload(message.id);
          return { ok: true, result };
        } catch (err) {
          return { ok: false, error: err.message };
        }

      case 'CANCEL_DOWNLOAD':
        try {
          const result = await IDMM_API.cancelDownload(message.id);
          return { ok: true, result };
        } catch (err) {
          return { ok: false, error: err.message };
        }

      case 'DELETE_DOWNLOAD':
        try {
          const result = await IDMM_API.deleteDownload(message.id);
          return { ok: true, result };
        } catch (err) {
          return { ok: false, error: err.message };
        }

      case 'ADD_DOWNLOAD':
        try {
          const result = await IDMM_API.startDownload(message.downloadInfo);
          return { ok: true, result };
        } catch (err) {
          return { ok: false, error: err.message };
        }

      case 'SETTINGS_UPDATED':
        // E10: Broadcast to all popup instances so they can refresh settings
        chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }).catch(() => {});
        return { ok: true };

      default:
        return { ok: false, error: `Unknown message type: ${message.type}` };
    }
  })().then(sendResponse).catch(err => {
    sendResponse({ ok: false, error: err.message });
  });

  return true; // Keep channel open for async response
});

//  Startup 

(async function init() {
  // Initial health check
  await checkServer();

  // E5: Start WebSocket for real-time updates
  connectWebSocket();

  // Periodic checks (fallback polling)
  setInterval(checkServer, 10000); // Health check every 10s
  setInterval(pollDownloads, 5000); // E5: Poll downloads every 5s (reduced from 2s)

  console.log('[IDMM] Extension service worker started');
})();

