/**
 * IDMM Content Script — Download-Link Click Interception (rombak total).
 *
 * Behavior (sesuai permintaan Bob):
 * 1. Semua klik pada link download DIINTERCEPT — browser TIDAK mulai download.
 * 2. URL link langsung dikirim ke IDMM desktop app via background (REST API).
 * 3. Tidak ada popup UI — hanya floating button kecil "IDMM" di samping link
 *    download untuk klik manual (fallback kalau link tidak terdeteksi otomatis).
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

  const DATA_ATTR = 'idmm-intercept';

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

  /**
   * Ambil URL download terbaik dari sebuah anchor:
   * href → data-* attributes → download attribute.
   */
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

  // ── Intercept Click (capture phase — blokir download browser) ──

  async function handleClick(e) {
    // Cari anchor terdekat dari elemen yang diklik
    const a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;

    const url = resolveDownloadUrl(a);
    if (!url) return;

    const isFileLink = isDownloadable(url);
    const hasDownloadAttr = a.hasAttribute('download');

    // Hanya intercept link yang memang untuk download:
    //  - href menunjuk file langsung, ATAU
    //  - punya atribut download, ATAU
    //  - punya data-* download URL yang valid
    if (!isFileLink && !hasDownloadAttr) return;

    // Jangan intercept kalau klik adalah modifier (user mau save-as / new tab)
    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    sendToIDMM(url, a, e);
  }

  function sendToIDMM(url, anchor, event) {
    // Feedback visual kecil di link (hanya fallback manual)
    const origBg = anchor && anchor.style ? anchor.style.background : '';

    chrome.runtime.sendMessage(
      { type: 'SEND_URL_TO_IDMM', downloadInfo: { url, referrer: location.href } },
      (response) => {
        if (chrome.runtime.lastError) {
          flash(anchor, '#ef4444', '✗', origBg);
          return;
        }
        if (response && response.ok) {
          flash(anchor, '#22c55e', '✓', origBg);
        } else {
          flash(anchor, '#ef4444', '✗', origBg);
          const msg = (response && response.error) || 'IDMM tidak merespons';
          if (msg.includes('offline')) {
            notifyOffline(msg);
          }
        }
      }
    );
  }

  function flash(anchor, color, text, origBg) {
    if (!anchor) return;
    anchor.style.transition = 'background 0.15s';
    anchor.style.background = color;
    const origText = anchor.textContent;
    if (text === '✓' || text === '✗') {
      anchor.textContent = text;
    }
    setTimeout(() => {
      anchor.style.background = origBg;
      anchor.textContent = origText;
    }, 1200);
  }

  function notifyOffline(msg) {
    try {
      chrome.runtime.sendMessage({ type: 'NOTIFY_OFFLINE', message: msg });
    } catch { /* noop */ }
  }

  // ── Floating Button (fallback manual untuk link yang tidak terdeteksi) ──

  function injectButton(linkEl, url) {
    if (linkEl.dataset.idmmProcessed) return;
    linkEl.dataset.idmmProcessed = 'true';
    linkEl.style.position = 'relative';

    const btn = document.createElement('div');
    btn.className = 'idmm-download-btn';
    btn.title = 'Download with IDMM';
    btn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      '<span style="font-size:10px;font-weight:700;white-space:nowrap">IDMM</span>';

    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '3px',
      padding: '2px 7px',
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
      boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
    });

    btn.addEventListener('mouseenter', () => (btn.style.background = '#4b56b8'));
    btn.addEventListener('mouseleave', () => (btn.style.background = '#5e6ad2'));

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.style.background = '#f59e0b';
      sendToIDMM(url, btn, e);
      // Reset warna button setelah feedback
      setTimeout(() => {
        const ok = btn.dataset.idmmOk === '1';
        btn.style.background = ok ? '#22c55e' : '#5e6ad2';
        btn.dataset.idmmOk = '';
        btn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
          '<span style="font-size:10px;font-weight:700;white-space:nowrap">IDMM</span>';
      }, 2000);
    });

    if (linkEl.nextSibling) {
      linkEl.parentNode.insertBefore(btn, linkEl.nextSibling);
    } else {
      linkEl.parentNode.appendChild(btn);
    }
  }

  // ── Scan halaman untuk link download (pasang floating button) ──

  let scanTimer = null;

  function scanPage() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      const links = document.querySelectorAll('a[href]');
      for (const a of links) {
        if (a.dataset.idmmProcessed) continue;
        const url = resolveDownloadUrl(a);
        if (!url) continue;
        if (isDownloadable(url) || a.hasAttribute('download')) {
          injectButton(a, url);
        }
      }
    }, 400);
  }

  function setupObserver() {
    const observer = new MutationObserver(() => scanPage());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .idmm-download-btn { animation: idmmFadeIn 0.2s ease-out; }
      @keyframes idmmFadeIn { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
    `;
    document.head.appendChild(style);
  }

  // ── Init ──

  function init() {
    // Capture-phase click listener: jalan duluan sebelum handler situs,
    // mencegah download browser dimulai.
    document.addEventListener('click', handleClick, true);

    if (document.body) {
      injectStyles();
      scanPage();
      setupObserver();
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        injectStyles();
        scanPage();
        setupObserver();
      });
    }
  }

  init();
})();
