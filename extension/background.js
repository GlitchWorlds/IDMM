/**
 * IDMM Chrome Extension — Background Service Worker (Manifest V3)
 *
 * SIMPLE RELAY pattern:
 * 1. Intercepts browser downloads → sends to IDMM desktop app via REST API
 * 2. Context menu: "Download with IDMM" for links/images/video/audio
 * 3. Badge: "OFF" when server unreachable, blank when online
 * 4. Message relay: forwards URLs from content script to desktop app
 *
 * This extension does NOT track download state, count active downloads,
 * or maintain live server connections. The desktop app handles all of that.
 */

importScripts('./lib/api-client.js');

// ── State ──

let serverOnline = false;
let interceptedIds = new Set(); // Track downloads we've intercepted to avoid loops

// ── Health Check ──

async function checkServer() {
  serverOnline = await IDMM_API.healthCheck();
  updateBadge();
  return serverOnline;
}

// ── Badge (OFF when offline, blank when online) ──

function updateBadge() {
  if (!serverOnline) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Send Download to IDMM ──

async function sendToIDMM({ url, filename, cookies, referrer }) {
  if (!serverOnline) {
    // Quick re-check before giving up
    serverOnline = await IDMM_API.healthCheck();
    if (!serverOnline) return false;
  }

  try {
    const result = await IDMM_API.startDownload({
      url,
      filename: filename || undefined,
      cookies: cookies || undefined,
      referrer: referrer || undefined,
    });

    console.log(`[IDMM] Download sent to server: ${result.filename || url}`);
    return true;
  } catch (err) {
    console.error('[IDMM] Failed to send download:', err.message);
    // Mark offline if the request failed
    if (err.message.includes('offline') || err.message.includes('timeout')) {
      serverOnline = false;
      updateBadge();
    }
    return false;
  }
}

// ── Download Interception (auto-send to IDMM) ──

chrome.downloads.onDeterminingFilename.addListener(async (item, suggest) => {
  // Skip if we already intercepted this (avoid loops via multiple script contexts)
  if (interceptedIds.has(item.id)) {
    interceptedIds.delete(item.id);
    suggest();
    return;
  }

  // Check settings
  const settings = await IDMM_API.getSettings();
  if (!settings.enabled) {
    suggest();
    return;
  }

  // Check if file should be intercepted based on rules
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
    // Track to prevent re-entry loops
    interceptedIds.add(item.id);
    // Cancel Chrome's native download — IDMM handles it now
    // Call suggest() first to unblock Chrome's pipeline, then cancel async
    suggest();
    setTimeout(() => {
      chrome.downloads.cancel(item.id, () => {
        chrome.downloads.erase({ id: item.id }, () => {});
      });
    }, 100);
    return;
  }

  // Send failed — let browser handle it normally
  suggest();
});

// Periodically clean interceptedIds to prevent memory leak
setInterval(() => {
  if (interceptedIds.size > 100) interceptedIds.clear();
}, 60000);

// ── Context Menu ──

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

// ── Message Handlers (content script communication) ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle async — return true to keep message channel open
  (async () => {
    switch (message.type) {
      case 'CHECK_STATUS':
        return { ok: true, online: serverOnline };

      case 'SEND_URL_TO_IDMM':
        try {
          // Always do a fresh health check (don't rely on stale cached flag)
          const online = await IDMM_API.healthCheck();
          serverOnline = online;
          updateBadge();
          if (!online) {
            return { ok: false, error: 'IDMM server is offline. Please open the IDMM desktop app first.' };
          }
          const result = await IDMM_API.startDownload(message.downloadInfo);
          return { ok: true, result };
        } catch (err) {
          if (err.message.includes('offline') || err.message.includes('timeout')) {
            serverOnline = false;
            updateBadge();
          }
          return { ok: false, error: err.message };
        }

      case 'GET_SETTINGS':
        try {
          const settings = await IDMM_API.getSettings();
          return { ok: true, settings };
        } catch (err) {
          return { ok: false, error: err.message };
        }

      case 'SAVE_SETTINGS':
        try {
          await IDMM_API.saveSettings(message.settings);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err.message };
        }

      default:
        return { ok: false, error: 'Unknown message type: ' + message.type };
    }
  })().then(sendResponse).catch(err => {
    sendResponse({ ok: false, error: err.message });
  });

  return true; // Keep channel open for async response
});

// ── Startup ──

(async function init() {
  await checkServer();
  // Re-check server health every 15 seconds
  setInterval(checkServer, 15000);
  console.log('[IDMM] Extension service worker started (relay mode)');
})();
