/**
 * IDMM Chrome Extension — Background Service Worker (Manifest V3)
 *
 * Relay murni:
 * 1. Terima URL dari content script (klik link download) → kirim ke IDMM via REST.
 * 2. Fallback: intercept chrome.downloads (download yang diinisiasi JavaScript)
 *    → batalkan download browser, kirim URL ke IDMM.
 * 3. Context menu "Download with IDMM" untuk link/media/seleksi.
 * 4. Badge "OFF" saat server tidak bisa dijangkau.
 *
 * Tidak ada popup UI. Tidak melacak status download (desktop app yang pegang).
 */

importScripts('./lib/api-client.js');

// ── State ──

let serverOnline = false;

// ── Health Check / Badge ──

async function checkServer() {
  serverOnline = await IDMM_API.healthCheck();
  updateBadge();
  return serverOnline;
}

function updateBadge() {
  if (!serverOnline) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Kirim download ke IDMM ──

async function sendToIDMM({ url, filename, cookies, referrer, userAgent }) {
  // 1. Try Native Messaging first if available
  if (chrome.runtime.sendNativeMessage) {
    try {
      const nativeResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendNativeMessage(
          'com.idmm.native_host',
          {
            action: 'download',
            url,
            filename: filename || undefined,
            cookies: cookies || undefined,
            referrer: referrer || undefined,
            user_agent: userAgent || undefined,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve(response);
          }
        );
      });

      if (nativeResp && nativeResp.success) {
        serverOnline = true;
        updateBadge();
        return { ok: true, result: nativeResp };
      }
    } catch (err) {
      console.warn('[IDMM] Native messaging fallback to HTTP:', err.message);
    }
  }

  // 2. HTTP/WS fallback
  if (!serverOnline) {
    serverOnline = await IDMM_API.healthCheck();
    updateBadge();
    if (!serverOnline) return { ok: false, error: 'IDMM server offline. Buka aplikasi IDMM dulu.' };
  }

  try {
    const result = await IDMM_API.startDownload({
      url,
      filename: filename || undefined,
      cookies: cookies || undefined,
      referrer: referrer || undefined,
      userAgent: userAgent || undefined,
    });
    return { ok: true, result };
  } catch (err) {
    console.error('[IDMM] Gagal kirim download:', err.message);
    if (err.message.includes('offline') || err.message.includes('timeout')) {
      serverOnline = false;
      updateBadge();
    }
    return { ok: false, error: err.message };
  }
}

async function getCompleteCookies(url, referrer) {
  const cookieMap = new Map();
  const urlsToQuery = [];
  if (url) urlsToQuery.push(url);
  if (referrer && referrer !== url) urlsToQuery.push(referrer);

  for (const targetUrl of urlsToQuery) {
    try {
      const list = await chrome.cookies.getAll({ url: targetUrl });
      for (const c of list) {
        cookieMap.set(c.name, c.value);
      }
    } catch {}
  }

  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ── Intercept Download Browser (fallback untuk download JS-initiated) ──

const interceptedIds = new Set();

chrome.downloads.onCreated.addListener(async (item) => {
  if (interceptedIds.has(item.id)) return;

  const settings = await IDMM_API.getSettings();
  if (!settings.enabled) return;

  const should = IDMM_API.shouldIntercept(item, item.totalBytes, settings);
  if (!should) return;

  // Batalkan langsung pada event onCreated sebelum browser menulis disk
  interceptedIds.add(item.id);
  try {
    chrome.downloads.cancel(item.id, () => {
      chrome.downloads.erase({ id: item.id }, () => {});
    });
  } catch {}

  const url = item.finalUrl || item.url;
  const referrer = item.referrer || '';
  const cookies = await getCompleteCookies(url, referrer);

  await sendToIDMM({
    url,
    filename: item.filename,
    cookies,
    referrer,
    userAgent: navigator.userAgent,
  });
});

chrome.downloads.onDeterminingFilename.addListener(async (item, suggest) => {
  if (interceptedIds.has(item.id)) {
    suggest();
    return;
  }

  const settings = await IDMM_API.getSettings();
  if (!settings.enabled) {
    suggest();
    return;
  }

  const should = IDMM_API.shouldIntercept(item, item.totalBytes, settings);
  if (!should) {
    suggest();
    return;
  }

  interceptedIds.add(item.id);
  try {
    chrome.downloads.cancel(item.id, () => {
      chrome.downloads.erase({ id: item.id }, () => {});
    });
  } catch {}

  const url = item.finalUrl || item.url;
  const referrer = item.referrer || '';
  const cookies = await getCompleteCookies(url, referrer);

  await sendToIDMM({
    url,
    filename: item.filename,
    cookies,
    referrer,
    userAgent: navigator.userAgent,
  });

  suggest();
});

// Bersihkan set agar tidak bocor memori
setInterval(() => {
  if (interceptedIds.size > 100) interceptedIds.clear();
}, 60000);

// ── Context Menu ──

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
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
      } catch { /* bukan URL */ }
      break;
    }
  }

  if (!url) return;

  const cookies = await getCompleteCookies(url, tab?.url || '');
  const sent = await sendToIDMM({
    url,
    cookies,
    referrer: tab?.url || '',
    userAgent: navigator.userAgent,
  });

  if (sent.ok) {
    try {
      chrome.notifications?.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'IDMM',
        message: 'Download dikirim ke IDMM',
      });
    } catch { /* notifikasi opsional */ }
  } else {
    try {
      chrome.notifications?.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'IDMM',
        message: sent.error || 'Gagal mengirim download',
      });
    } catch { /* noop */ }
  }
});

// ── Message Handlers (dari content script) ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'CHECK_STATUS':
        // Selalu health-check fresh — kalau server mati, content script
        // menyembunyikan floating button-nya.
        serverOnline = await IDMM_API.healthCheck();
        updateBadge();
        return { ok: true, online: serverOnline };

      case 'SEND_URL_TO_IDMM': {
        const online = await IDMM_API.healthCheck();
        serverOnline = online;
        updateBadge();
        if (!online) {
          return { ok: false, error: 'IDMM server offline. Buka aplikasi IDMM dulu.' };
        }
        const dlUrl = message.downloadInfo?.url;
        const dlRef = message.downloadInfo?.referrer || sender.tab?.url || '';
        const cookies = await getCompleteCookies(dlUrl, dlRef);
        const sent = await sendToIDMM({
          url: dlUrl,
          filename: message.downloadInfo?.filename,
          cookies: message.downloadInfo?.cookies || cookies,
          referrer: dlRef,
          userAgent: message.downloadInfo?.userAgent || navigator.userAgent,
        });
        return sent;
      }

      case 'NOTIFY_OFFLINE':
        try {
          chrome.notifications?.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'IDMM',
            message: message.message || 'IDMM server offline',
          });
        } catch { /* noop */ }
        return { ok: true };

      case 'GET_SETTINGS':
        try {
          const settings = await IDMM_API.getSettings();
          return { ok: true, settings };
        } catch (err) {
          return { ok: false, error: err.message };
        }

      default:
        return { ok: false, error: 'Unknown message type: ' + message.type };
    }
  })().then(sendResponse).catch(err => {
    sendResponse({ ok: false, error: err.message });
  });

  return true; // Jaga channel tetap terbuka untuk async
});

// ── Startup ──

(async function init() {
  await checkServer();
  setInterval(checkServer, 15000);
  console.log('[IDMM] Extension service worker started (relay mode)');
})();
