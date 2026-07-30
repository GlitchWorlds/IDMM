/**
 * IDMM Content Script — Floating Download Button.
 *
 * Detects downloadable file links on the page and injects a floating
 * "Download with IDMM" button next to each eligible link.
 *
 * Downloadable extensions: media, archives, executables, documents, etc.
 */

// ── Config ──

const DOWNLOAD_EXTENSIONS = new Set([
  // Media
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mpg', '.mpeg',
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a',
  // Archives
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.zst',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.epub', '.mobi', '.cbz', '.cbr',
  // Executables
  '.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.apk', '.ipa',
  // Images (large format)
  '.iso', '.img', '.vhd', '.vmdk',
  // Developer
  '.dll', '.so', '.dylib', '.whl', '.jar',
  // Fonts / Assets
  '.ttf', '.otf', '.woff', '.woff2',
]);

// Check if a URL points to a downloadable file
function isDownloadable(url) {
  try {
    const u = new URL(url);
    const ext = u.pathname.toLowerCase().split('?')[0];
    const lastDot = ext.lastIndexOf('.');
    if (lastDot === -1) return false;
    return DOWNLOAD_EXTENSIONS.has(ext.slice(lastDot));
  } catch {
    return false;
  }
}

// ── Inject Floating Button ──

function injectButton(linkEl, url) {
  if (linkEl.dataset.idmmProcessed) return;
  linkEl.dataset.idmmProcessed = 'true';
  linkEl.style.position = 'relative';

  const btn = document.createElement('div');
  btn.className = 'idmm-download-btn';
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span style="font-size:11px;font-weight:600;white-space:nowrap">IDMM</span>`;

  Object.assign(btn.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    padding: '2px 6px',
    marginLeft: '6px',
    borderRadius: '4px',
    background: '#3b82f6',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0',
    lineHeight: '1',
    border: 'none',
    verticalAlign: 'middle',
    transition: 'background 0.15s',
    userSelect: 'none',
    position: 'relative',
    zIndex: '9999',
  });

  btn.addEventListener('mouseenter', () => btn.style.background = '#2563eb');
  btn.addEventListener('mouseleave', () => btn.style.background = '#3b82f6');

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.innerHTML = '<span style="font-size:11px;color:#fff">...</span>';
    btn.style.background = '#6366f1';

    try {
      // Send download to IDMM via background
      chrome.runtime.sendMessage({
        type: 'SEND_URL_TO_IDMM',
        downloadInfo: { url }
      }, (response) => {
        if (response && response.ok) {
          btn.innerHTML = '<span style="font-size:11px;font-weight:600;color:#fff">✓</span>';
          btn.style.background = '#22c55e';
          setTimeout(() => {
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span style="font-size:11px;font-weight:600;white-space:nowrap">IDMM</span>`;
            btn.style.background = '#3b82f6';
          }, 2000);
        } else {
          btn.innerHTML = '<span style="font-size:11px;font-weight:600;color:#fff">✗</span>';
          btn.style.background = '#ef4444';
          setTimeout(() => {
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span style="font-size:11px;font-weight:600;white-space:nowrap">IDMM</span>`;
            btn.style.background = '#3b82f6';
          }, 2000);
        }
      });
    } catch (err) {
      console.warn('[IDMM] Send error:', err);
      btn.innerHTML = '<span style="font-size:11px;font-weight:600;color:#fff">✗</span>';
      btn.style.background = '#ef4444';
      setTimeout(() => {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span style="font-size:11px;font-weight:600;white-space:nowrap">IDMM</span>`;
        btn.style.background = '#3b82f6';
      }, 2000);
    }
  });

  // Insert after the link or inside the parent
  if (linkEl.nextSibling) {
    linkEl.parentNode.insertBefore(btn, linkEl.nextSibling);
  } else {
    linkEl.parentNode.appendChild(btn);
  }
}

// ── Scan Page for Download Links ──

let scanTimer = null;

function scanPage() {
  if (scanTimer) return; // Debounce — one scan at a time

  scanTimer = setTimeout(() => {
    scanTimer = null;

    // First pass: find <a> tags with direct href to downloadable files
    const links = document.querySelectorAll('a[href]');
    for (const a of links) {
      const url = a.href || '';
      if (!url || url.startsWith('javascript:') || a.dataset.idmmProcessed) continue;
      if (isDownloadable(url)) {
        injectButton(a, url);
      }
    }

    // Second pass: find <a> tags with download attribute
    const downloadLinks = document.querySelectorAll('a[download]');
    for (const a of downloadLinks) {
      if (a.dataset.idmmProcessed) continue;
      const url = a.href || '';
      if (url && url.startsWith('http')) {
        injectButton(a, url);
      }
    }
  }, 300); // Debounce 300ms
}

// ── Mutation Observer — Handle dynamic content ──

function setupObserver() {
  const observer = new MutationObserver(() => {
    scanPage();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// ── Styles ──

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .idmm-download-btn {
      animation: idmmFadeIn 0.2s ease-out;
    }
    @keyframes idmmFadeIn {
      from { opacity: 0; transform: scale(0.8); }
      to { opacity: 1; transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

// ── Init ──

function init() {
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
