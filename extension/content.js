/**
 * IDMM Content Script — Floating Download Button + Click Interception.
 *
 * Perilaku (sesuai permintaan):
 * 1. Klik link download di halaman di-INTERCEPT — browser TIDAK mulai download,
 *    URL langsung dikirim ke IDMM desktop app.
 * 2. TIDAK ada tombol kecil di samping tiap link. Gantinya: SATU floating button
 *    "IDMM" di pojok kanan bawah, dengan tombol X untuk menutupnya.
 * 3. Kalau software IDMM tidak aktif (server offline) → floating button
 *    DISEMBUNYIKAN otomatis. Muncul lagi begitu server online.
 * 4. Klik floating button → panel daftar link download yang terdeteksi di halaman,
 *    tiap item bisa dikirim ke IDMM (atau "Kirim Semua").
 */

(() => {
  if (window.__idmmContentLoaded) return;
  window.__idmmContentLoaded = true;

  // ── Config ──

  const DOWNLOAD_EXTENSIONS = new Set([
    // Media
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mpg', '.mpeg',
    '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.m4v', '.ts', '.opus',
    // Archives
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.zst', '.iso', '.tgz',
    // Documents
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.epub', '.mobi', '.cbz', '.cbr', '.csv', '.txt',
    // Executables
    '.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.apk', '.ipa', '.appx', '.appimage',
    // Images (large format)
    '.img', '.vhd', '.vmdk',
    // Developer
    '.dll', '.so', '.dylib', '.whl', '.jar', '.nupkg',
    // Fonts / Assets
    '.ttf', '.otf', '.woff', '.woff2',
  ]);

  const FAB_CLOSED_KEY = 'idmm_fab_closed';
  const POLL_MS = 4000;
  const MAX_LIST = 50;

  // ── State ──

  let online = false;          // server IDMM aktif?
  let closed = false;          // user menutup FAB (persist per tab via sessionStorage)
  let links = [];              // daftar link download terdeteksi { url, name }
  let host = null;             // root element FAB
  let shadow = null;           // shadow root (isolasi dari CSS halaman)
  let panelOpen = false;
  let el = {};                 // refs elemen UI

  // ── Detection ──

  function isDownloadable(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      const pathname = u.pathname.toLowerCase().split('?')[0];
      const lastDot = pathname.lastIndexOf('.');
      if (lastDot === -1) return false;
      return DOWNLOAD_EXTENSIONS.has(pathname.slice(lastDot));
    } catch {
      return false;
    }
  }

  function resolveDownloadUrl(a) {
    if (!a || !a.href) return null;
    let url = a.href;
    if (url.startsWith('javascript:') || url.startsWith('#')) return null;
    for (const attr of ['data-url', 'data-href', 'data-download', 'data-file', 'data-src']) {
      const v = a.getAttribute(attr);
      if (v && /^https?:\/\//i.test(v)) { url = v; break; }
    }
    return url;
  }

  function fileNameFromUrl(url, a) {
    const dl = a && a.getAttribute('download');
    if (dl) return dl;
    try {
      const u = new URL(url);
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
      return last || u.hostname;
    } catch {
      return url;
    }
  }

  function collectLinks() {
    const seen = new Set();
    const out = [];
    const anchors = document.querySelectorAll('a[href]');
    for (const a of anchors) {
      const url = resolveDownloadUrl(a);
      if (!url || seen.has(url)) continue;
      if (isDownloadable(url) || a.hasAttribute('download')) {
        seen.add(url);
        out.push({ url, name: fileNameFromUrl(url, a) });
      }
    }
    links = out;
    return out;
  }

  // ── Kirim URL ke IDMM (via background) ──

  function sendUrl(url) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'SEND_URL_TO_IDMM', downloadInfo: { url, referrer: location.href } },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(res && res.ok ? { ok: true } : { ok: false, error: res && res.error });
          }
        );
      } catch {
        resolve({ ok: false, error: 'extension context invalidated' });
      }
    });
  }

  function notifyOffline() {
    try {
      chrome.runtime.sendMessage({ type: 'NOTIFY_OFFLINE', message: 'IDMM server offline — buka aplikasi IDMM dulu.' });
    } catch { /* noop */ }
  }

  // ── Intercept klik link download (capture phase) ──

  async function handleClick(e) {
    const a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;

    const url = resolveDownloadUrl(a);
    if (!url) return;

    const isFileLink = isDownloadable(url);
    const hasDownloadAttr = a.hasAttribute('download');
    if (!isFileLink && !hasDownloadAttr) return;

    // Jangan intercept kalau klik pakai modifier (save-as / new tab)
    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const res = await sendUrl(url);
    if (res.ok) {
      flash(a, '#22c55e');
    } else {
      flash(a, '#ef4444');
      if (!online) {
        setFabVisible(false);
        notifyOffline();
      }
    }
  }

  // Feedback non-destruktif: outline saja, tidak menyentuh isi link
  function flash(a, color) {
    a.style.transition = 'outline 0.15s ease';
    a.style.outline = `2px solid ${color}`;
    a.style.outlineOffset = '2px';
    setTimeout(() => {
      a.style.outline = '';
      a.style.outlineOffset = '';
    }, 1500);
  }

  // ── UI: Floating Button + Panel (Shadow DOM) ──

  const FAB_CSS = `
    * { box-sizing: border-box; }
    #wrap { position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .fab {
      display: flex; align-items: center; gap: 6px;
      background: #5e6ad2; color: #fff; border: none; border-radius: 999px;
      padding: 9px 12px; cursor: pointer;
      box-shadow: 0 3px 14px rgba(0,0,0,.35);
      font-size: 12px; font-weight: 600; line-height: 1; user-select: none;
      transition: background .15s, transform .1s;
    }
    .fab:hover { background: #4b56b8; }
    .fab:active { transform: scale(.97); }
    .fab .count {
      background: rgba(255,255,255,.22); border-radius: 999px;
      padding: 2px 6px; font-size: 10px; font-weight: 700;
    }
    .fab .x {
      display: flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%;
      background: rgba(0,0,0,.22); color: #fff;
      font-size: 11px; font-weight: 700; line-height: 1; margin-left: 2px;
    }
    .fab .x:hover { background: rgba(0,0,0,.4); }
    .panel {
      position: absolute; bottom: calc(100% + 10px); right: 0;
      width: 300px; max-width: min(360px, calc(100vw - 32px));
      background: #fff; color: #1f1f1f; border-radius: 14px;
      box-shadow: 0 10px 40px rgba(0,0,0,.3);
      overflow: hidden; display: none; flex-direction: column; font-size: 12px;
    }
    .panel.open { display: flex; }
    .panel-head {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; background: #f5f5f7; border-bottom: 1px solid #e4e4e4;
      font-weight: 700; font-size: 12px;
    }
    .panel-head .sp { flex: 1; }
    .panel-head .send-all {
      font-size: 11px; font-weight: 600; background: #5e6ad2; color: #fff;
      border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer;
    }
    .panel-head .send-all:hover { background: #4b56b8; }
    .panel-head .p-x {
      font-size: 13px; color: #888; background: none; border: none;
      cursor: pointer; padding: 2px 6px; border-radius: 6px; line-height: 1;
    }
    .panel-head .p-x:hover { background: #e4e4e4; color: #333; }
    .list { overflow-y: auto; max-height: 280px; }
    .item {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 12px; border-bottom: 1px solid #f0f0f0;
    }
    .item:hover { background: #f8f8fa; }
    .item .name {
      flex: 1; min-width: 0; color: #333; cursor: pointer;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .item .name:hover { color: #5e6ad2; }
    .item .go {
      flex-shrink: 0; font-size: 11px; font-weight: 700;
      background: #5e6ad2; color: #fff; border: none; border-radius: 6px;
      padding: 5px 9px; cursor: pointer;
    }
    .item .go:hover { background: #4b56b8; }
    .item.ok .go { background: #22c55e; }
    .item.fail .go { background: #ef4444; }
    .empty { padding: 20px 12px; text-align: center; color: #999; }
    @media (prefers-color-scheme: dark) {
      .panel { background: #1c1c1e; color: #f2f2f7; }
      .panel-head { background: #2c2c2e; border-bottom-color: #3a3a3c; }
      .item { border-bottom-color: #2c2c2e; }
      .item:hover { background: #2c2c2e; }
      .item .name { color: #f2f2f7; }
      .panel-head .p-x:hover { background: #3a3a3c; color: #f2f2f7; }
      .empty { color: #888; }
    }
  `;

  function buildUI() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>${FAB_CSS}</style>
      <div id="wrap">
        <div class="panel" id="panel">
          <div class="panel-head">
            <span>IDMM Download</span><span class="sp"></span>
            <button class="send-all" id="sendAll" title="Kirim semua link ke IDMM">Kirim Semua</button>
            <button class="p-x" id="pX" title="Tutup panel">✕</button>
          </div>
          <div class="list" id="list"></div>
        </div>
        <button class="fab" id="fab" title="Download dengan IDMM">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>IDMM</span>
          <span class="count" id="count" style="display:none"></span>
          <span class="x" id="x" title="Tutup tombol">✕</span>
        </button>
      </div>`;
    document.documentElement.appendChild(host);

    el = {
      fab: shadow.getElementById('fab'),
      panel: shadow.getElementById('panel'),
      list: shadow.getElementById('list'),
      count: shadow.getElementById('count'),
      sendAll: shadow.getElementById('sendAll'),
    };

    el.fab.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('#x')) {
        closeFab();
        return;
      }
      togglePanel();
    });
    shadow.getElementById('pX').addEventListener('click', closePanel);
    el.sendAll.addEventListener('click', sendAll);
  }

  function setFabVisible(v) {
    if (!host) return;
    host.style.display = v && !closed ? 'block' : 'none';
    if (!v) closePanel();
  }

  function closePanel() {
    panelOpen = false;
    if (el.panel) el.panel.classList.remove('open');
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    if (el.panel) el.panel.classList.toggle('open', panelOpen);
    if (panelOpen) renderList();
  }

  function closeFab() {
    closed = true;
    try { sessionStorage.setItem(FAB_CLOSED_KEY, '1'); } catch { /* noop */ }
    if (host) { host.remove(); host = null; shadow = null; el = {}; }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderList() {
    if (!el.list) return;
    el.list.innerHTML = '';

    if (links.length === 0) {
      el.list.innerHTML = '<div class="empty">Tidak ada link download terdeteksi di halaman ini</div>';
      el.count.style.display = 'none';
      el.count.textContent = '';
      return;
    }

    const items = links.slice(0, MAX_LIST);
    items.forEach((l, i) => {
      const row = document.createElement('div');
      row.className = 'item';
      row.dataset.idx = String(i);
      row.innerHTML =
        `<span class="name" title="${escapeHtml(l.url)}">${escapeHtml(l.name || l.url)}</span>` +
        `<button class="go" title="Kirim ke IDMM">⬇</button>`;
      row.querySelector('.name').addEventListener('click', () => sendItem(row, l));
      row.querySelector('.go').addEventListener('click', () => sendItem(row, l));
      el.list.appendChild(row);
    });

    if (links.length > MAX_LIST) {
      const more = document.createElement('div');
      more.className = 'empty';
      more.textContent = `+${links.length - MAX_LIST} link lainnya`;
      el.list.appendChild(more);
    }

    el.count.textContent = String(links.length);
    el.count.style.display = '';
  }

  async function sendItem(row, l) {
    row.classList.remove('ok', 'fail');
    const go = row.querySelector('.go');
    go.textContent = '…';
    const res = await sendUrl(l.url);
    if (res.ok) {
      row.classList.add('ok');
      go.textContent = '✓';
    } else {
      row.classList.add('fail');
      go.textContent = '✗';
      if (!online) setFabVisible(false);
    }
    setTimeout(() => { go.textContent = '⬇'; }, 1500);
  }

  async function sendAll() {
    if (!el.list) return;
    const rows = [...el.list.querySelectorAll('.item')];
    for (let i = 0; i < rows.length; i++) {
      const l = links[Number(rows[i].dataset.idx)];
      if (l) await sendItem(rows[i], l);
    }
  }

  // ── Status polling: sembunyikan FAB kalau IDMM offline ──

  async function pollStatus() {
    let res = null;
    try {
      res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'CHECK_STATUS' }, (r) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r);
        });
      });
    } catch { res = null; }
    online = !!(res && res.online);
    setFabVisible(online);
  }

  // ── Scan halaman (perbarui daftar link) ──

  let scanTimer = null;

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      collectLinks();
      if (panelOpen) renderList();
    }, 500);
  }

  // ── Init ──

  function init() {
    try {
      closed = sessionStorage.getItem(FAB_CLOSED_KEY) === '1';
    } catch { closed = false; }

    // Interception klik tetap aktif walau FAB di-close
    document.addEventListener('click', handleClick, true);

    if (closed) return; // FAB sudah ditutup user di tab ini

    buildUI();
    pollStatus();
    setInterval(pollStatus, POLL_MS);

    collectLinks();
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  }

  init();
})();
