/**
 * IDMM Content Script — Page context for extracting download links.
 * Minimal footprint: deferred metadata reporting, capped payload.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSelectedLinks') {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({ url: a.href, text: a.textContent?.trim() }))
      .filter(l => l.url.startsWith('http'));
    sendResponse({ links });
  }

  if (request.action === 'getPageMedia') {
    const media = [
      ...Array.from(document.querySelectorAll('video[src], video source[src]'))
        .map(el => ({ type: 'video', url: el.src })),
      ...Array.from(document.querySelectorAll('audio[src], audio source[src]'))
        .map(el => ({ type: 'audio', url: el.src })),
      ...Array.from(document.querySelectorAll('img[src]'))
        .map(el => ({ type: 'image', url: el.src })),
    ].filter(m => m.url.startsWith('http'));
    sendResponse({ media });
  }

  return true;
});

// --- Gap 3: Proactive content → background communication (deferred) ---
function reportPageMetadata() {
  try {
    const downloadLinks = Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({ url: a.href, text: (a.textContent || '').trim() }))
      .filter(l => l.url.startsWith('http'))
      .slice(0, 20); // Cap at 20 (was 50)

    const metadata = {
      type: 'PAGE_METADATA',
      pageTitle: document.title || '',
      pageUrl: window.location.href || '',
      downloadLinks,
      mediaUrls: [],
    };

    // Only collect media if few links (perf heuristic)
    if (downloadLinks.length < 5) {
      metadata.mediaUrls = [
        ...Array.from(document.querySelectorAll('video[src], video source[src]')).map(el => el.src),
        ...Array.from(document.querySelectorAll('audio[src], audio source[src]')).map(el => el.src),
      ].filter(u => u && u.startsWith('http')).slice(0, 10);
    }

    chrome.runtime.sendMessage(metadata);
  } catch {
    // Content script context may be invalidated on navigation
  }
}

// Defer until DOM is idle (was document_start)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', reportPageMetadata);
} else {
  reportPageMetadata();
}
