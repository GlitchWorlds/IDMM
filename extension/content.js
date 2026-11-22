/**
 * IDMM Content Script — Inline Download Buttons + Click Interception.
 *
 * Perilaku:
 * 1. Klik link download di halaman di-INTERCEPT — browser TIDAK mulai download,
 *    URL langsung dikirim ke IDMM desktop app.
 * 2. Setiap link download terdeteksi → tombol kecil "IDMM" inline di samping link,
 *    dengan tombol X untuk menutup tombol itu (diingat per tab, tidak muncul lagi).
 * 3. Kalau software IDMM tidak aktif (server offline) → SEMUA tombol
 *    DISEMBUNYIKAN otomatis. Muncul lagi begitu server online.
 */

(() => {
  if (window.__idmmContentLoaded) return;
  window.__idmmContentLoaded = true;

  // ── Config ──

  const DOWNLOAD_EXTENSIONS = new Set([
    // Media & Video/Audio
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mpg', '.mpeg', '.m4v', '.3gp', '.ts', '.vob',
    '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.mid', '.midi',
    // Archives & Compressed
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.zst', '.iso', '.tgz', '.tbz2', '.cab', '.dmg',
    // Documents & E-books
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
    '.epub', '.mobi', '.cbz', '.cbr',
    // Executables & Installers
    '.exe', '.msi', '.pkg', '.deb', '.rpm', '.apk', '.ipa', '.appx', '.appxbundle', '.appimage', '.bin',
    // Disk Images & System
    '.img', '.vhd', '.vhdx', '.vmdk',
    // Developer & Packages
    '.dll', '.so', '.dylib', '.whl', '.jar', '.nupkg', '.crx', '.xpi',
    // Fonts
    '.ttf', '.otf', '.woff', '.woff2',
  ]);

  const IGNORED_EXTENSIONS = new Set([
    '.html', '.htm', '.xhtml', '.php', '.asp', '.aspx', '.jsp', '.jspx', '.action', '.do',
    '.css', '.js', '.mjs', '.jsx', '.ts', '.tsx', '.json', '.xml', '.rss', '.atom',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tif', '.tiff',
    '.map', '.txt', '.log',
  ]);

  const HIDDEN_KEY = 'idmm_hidden_links'; // URL yang tombolnya ditutup user (per tab)
  const POLL_MS = 4000;

  // ── State ──

  let online = false;
  let hiddenLinks = new Set();

  // ── Detection ──

  function isDownloadable(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      const pathname = u.pathname.toLowerCase().split('?')[0];
      const lastDot = pathname.lastIndexOf('.');
      if (lastDot === -1) return false;
      const ext = pathname.slice(lastDot);
      if (IGNORED_EXTENSIONS.has(ext)) return false;
      return DOWNLOAD_EXTENSIONS.has(ext);
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

  // ── Hidden links (persist per tab) ──

  function loadHidden() {
    try {
      const raw = sessionStorage.getItem(HIDDEN_KEY);
      if (raw) hiddenLinks = new Set(JSON.parse(raw));
    } catch { /* noop */ }
  }

  function persistHidden() {
    try {
      sessionStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenLinks]));
    } catch { /* noop */ }
  }

  // ── Kirim URL ke IDMM (via background) ──

  function sendUrl(url) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'SEND_URL_TO_IDMM', downloadInfo: { url, referrer: location.href, userAgent: navigator.userAgent } },
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

    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;

    // e.preventDefault();
    // e.stopPropagation();
    // e.stopImmediatePropagation();

    const res = await sendUrl(url);
    if (res.ok) {
      flash(a, '#22c55e');
    } else {
      flash(a, '#ef4444');
      if (String(res.error || '').toLowerCase().includes('offline') || !res.ok && !online) {
        setOnline(false);
        notifyOffline();
      }
    }
  }

  function flash(a, color) {
    a.style.transition = 'outline 0.15s ease';
    a.style.outline = `2px solid ${color}`;
    a.style.outlineOffset = '2px';
    setTimeout(() => {
      a.style.outline = '';
      a.style.outlineOffset = '';
    }, 1500);
  }

  // ── Inline Button (di samping tiap link) ──

  const BTN_HTML =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
    '<span style="font-size:10px;font-weight:700;letter-spacing:.2px">IDMM</span>' +
    '<span class="idmm-x" title="Tutup tombol">✕</span>';

  function injectButton(a, url) {
    if (a.dataset.idmmProcessed) return;
    a.dataset.idmmProcessed = '1'; // jangan proses dua kali

    if (hiddenLinks.has(url)) return; // user menutup tombol untuk link ini

    const btn = document.createElement('div');
    btn.className = 'idmm-dl-btn';
    btn.title = 'Download dengan IDMM';
    btn.innerHTML = BTN_HTML;

    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '3px 8px',
      marginLeft: '6px',
      borderRadius: '999px',
      background: '#5e6ad2',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '0',
      lineHeight: '1',
      border: 'none',
      verticalAlign: 'middle',
      transition: 'background 0.15s',
      userSelect: 'none',
      position: 'relative',
      zIndex: '2147483647',
      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    });

    const x = btn.querySelector('.idmm-x');
    Object.assign(x.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '13px',
      height: '13px',
      borderRadius: '50%',
      background: 'rgba(0,0,0,0.25)',
      color: '#fff',
      fontSize: '8px',
      fontWeight: '700',
      lineHeight: '1',
      marginLeft: '2px',
    });
    x.addEventListener('mouseenter', () => (x.style.background = 'rgba(0,0,0,0.5)'));
    x.addEventListener('mouseleave', () => (x.style.background = 'rgba(0,0,0,0.25)'));

    btn.addEventListener('mouseenter', () => (btn.style.background = '#4b56b8'));
    btn.addEventListener('mouseleave', () => (btn.style.background = '#5e6ad2'));

    btn.addEventListener('click', (e) => {
      // e.preventDefault();
      // e.stopPropagation();

      // Klik tombol X → tutup tombol ini (permanen per tab)
      if (e.target.closest('.idmm-x')) {
        btn.remove();
        hiddenLinks.add(url);
        persistHidden();
        return;
      }

      // Klik utama → kirim ke IDMM
      sendToIDMM(url, btn);
    });

    if (a.nextSibling) {
      a.parentNode.insertBefore(btn, a.nextSibling);
    } else {
      a.parentNode.appendChild(btn);
    }
  }

  function setBtnState(btn, state) {
    if (!btn || !btn.isConnected) return;
    const svg = btn.querySelector('svg');
    const label = btn.querySelector('span');
    if (state === 'loading') {
      btn.style.background = '#f59e0b';
      if (label) label.textContent = '…';
      btn.style.pointerEvents = 'none';
    } else if (state === 'ok') {
      btn.style.background = '#22c55e';
      if (label) label.textContent = '✓';
      btn.style.pointerEvents = '';
      setTimeout(() => restoreBtn(btn, svg), 1500);
    } else {
      btn.style.background = '#ef4444';
      if (label) label.textContent = '✗';
      btn.style.pointerEvents = '';
      setTimeout(() => restoreBtn(btn, svg), 1500);
    }
  }

  function restoreBtn(btn, svg) {
    if (!btn || !btn.isConnected) return;
    btn.style.background = '#5e6ad2';
    btn.style.pointerEvents = '';
    btn.innerHTML = BTN_HTML;
    // re-wire X handler (innerHTML mengganti node)
    const x = btn.querySelector('.idmm-x');
    if (x) {
      Object.assign(x.style, {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '13px', height: '13px', borderRadius: '50%',
        background: 'rgba(0,0,0,0.25)', color: '#fff', fontSize: '8px',
        fontWeight: '700', lineHeight: '1', marginLeft: '2px',
      });
      x.addEventListener('mouseenter', () => (x.style.background = 'rgba(0,0,0,0.5)'));
      x.addEventListener('mouseleave', () => (x.style.background = 'rgba(0,0,0,0.25)'));
    }
  }

  async function sendToIDMM(url, btn) {
    setBtnState(btn, 'loading');
    const res = await sendUrl(url);
    if (res.ok) {
      setBtnState(btn, 'ok');
    } else {
      setBtnState(btn, 'fail');
      if (!online) {
        setOnline(false);
        notifyOffline();
      }
    }
  }

  // ── Sembunyikan/tampilkan semua tombol berdasarkan status server ──

  function removeAllButtons() {
    document.querySelectorAll('.idmm-dl-btn').forEach((b) => b.remove());
    document.querySelectorAll('a[data-idmm-processed]').forEach((a) => {
      delete a.dataset.idmmProcessed;
    });
  }

  function setOnline(v) {
    if (online === v) return;
    online = v;
    if (!online) {
      removeAllButtons();
    } else {
      scanPage();
    }
  }

  // ── Scan halaman ──

  let scanTimer = null;

  function scanPage() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (!online) return; // offline — jangan pasang tombol baru
      const anchors = document.querySelectorAll('a[href]');
      for (const a of anchors) {
        if (a.dataset.idmmProcessed) continue;
        const url = resolveDownloadUrl(a);
        if (!url) continue;
        if (isDownloadable(url) || a.hasAttribute('download')) {
          injectButton(a, url);
        }
      }
    }, 400);
  }

  // ── Status polling ──

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
    setOnline(!!(res && res.online));
  }

  // ── Styles ──

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .idmm-dl-btn { animation: idmmFadeIn 0.2s ease-out; }
      @keyframes idmmFadeIn { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
    `;
    document.head.appendChild(style);
  }

  // ── Init ──

  function init() {
    loadHidden();

    // Interception klik tetap aktif walau semua tombol ditutup
    // document.addEventListener('click', handleClick, true);

    if (document.body) {
      injectStyles();
      pollStatus();
      setInterval(pollStatus, POLL_MS);
      scanPage();
      new MutationObserver(scanPage).observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        injectStyles();
        pollStatus();
        setInterval(pollStatus, POLL_MS);
        scanPage();
        new MutationObserver(scanPage).observe(document.body, { childList: true, subtree: true });
      });
    }
  }

  init();
})();

