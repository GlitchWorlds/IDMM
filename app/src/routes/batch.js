'use strict';

const express = require('express');
const { validateDnsResolution, isBlockedHost } = require('../utils/ssrf');

const router = express.Router();

const MAX_CONCURRENCY = 3;
const MAX_URLS_PER_BATCH = 50;

/**
 * Validate a single URL for safety (format + SSRF).
 * @param {string} url
 * @returns {{ valid: boolean, error?: string }}
 */
function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, error: 'Only http/https URLs are allowed' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedHost(hostname)) {
    return { valid: false, error: 'Blocked host (SSRF protection)' };
  }

  return { valid: true };
}

/**
 * Process a single URL through the download manager.
 * @param {Object} downloader - DownloadManager instance
 * @param {string} url
 * @param {Object} options - Download options (filename, save_to, threads, etc.)
 * @returns {Promise<{ url: string, success: boolean, downloadId?: string, error?: string }>}
 */
async function processSingleUrl(downloader, url, options) {
  try {
    // DNS resolution check (skip in test mode)
    const isTestMode = process.env.IDMM_TEST === '1' || process.env.NODE_ENV === 'test';
    if (!isTestMode) {
      const parsed = new URL(url);
      await validateDnsResolution(parsed.hostname.toLowerCase());
    }

    const result = await downloader.startDownload({
      url,
      filename: options.filename,
      saveTo: options.save_to,
      threads: options.threads,
      threadMode: options.thread_mode,
      cookies: options.cookies,
      referrer: options.referrer,
      headers: options.headers,
      checksum: options.checksum,
    });

    return {
      url,
      success: true,
      downloadId: result.id,
    };
  } catch (err) {
    return {
      url,
      success: false,
      error: err.message || 'Download failed',
    };
  }
}

/**
 * Run an async function over items with limited concurrency.
 * @param {Array} items
 * @param {number} limit
 * @param {(item: *, index: number) => Promise<*>} fn
 * @returns {Promise<Array>}
 */
async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/**
 * POST /api/downloads/batch
 *
 * Body: { urls: ["url1", "url2", ...], options?: { filename?, save_to?, threads?, thread_mode?, cookies?, referrer?, headers?, checksum? } }
 *
 * Validates each URL (SSRF check), creates downloads with concurrency limit (max 3).
 * Returns array of results per URL.
 *
 * Response: { results: [{ url, success, downloadId?, error? }] }
 */
router.post('/', async (req, res) => {
  try {
    const { urls, options = {} } = req.body || {};

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'urls array is required and must not be empty' });
    }

    if (urls.length > MAX_URLS_PER_BATCH) {
      return res.status(400).json({ error: `Maximum ${MAX_URLS_PER_BATCH} URLs per batch` });
    }

    // Validate all URLs first
    const validations = urls.map(url => ({ url, ...validateUrl(url) }));
    const invalidUrls = validations.filter(v => !v.valid);

    // Process valid URLs with concurrency limit
    const validUrls = validations.filter(v => v.valid).map(v => v.url);

    const downloadResults = await runWithConcurrency(
      validUrls,
      MAX_CONCURRENCY,
      (url) => processSingleUrl(req.downloader, url, options)
    );

    // Merge invalid URL results with download results
    const results = [
      ...invalidUrls.map(v => ({
        url: v.url,
        success: false,
        error: v.error,
      })),
      ...downloadResults,
    ];

    // Preserve original order
    const urlOrder = new Map(urls.map((url, i) => [url, i]));
    results.sort((a, b) => (urlOrder.get(a.url) ?? 0) - (urlOrder.get(b.url) ?? 0));

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    res.status(201).json({
      results,
      summary: {
        total: results.length,
        success: successCount,
        failed: failCount,
      },
    });
  } catch (err) {
    console.error('[Batch] Error:', err.message);
    res.status(500).json({ error: 'Batch download failed' });
  }
});

/**
 * Factory function to create a batch router with injected dependencies.
 * @param {Object} deps - { downloader }
 * @returns {express.Router}
 */
function createBatchRouter(deps) {
  const batchRouter = express.Router();
  batchRouter.use((req, _res, next) => {
    req.downloader = deps.downloader;
    next();
  });
  batchRouter.use('/', router);
  return batchRouter;
}

module.exports = router;
module.exports.createBatchRouter = createBatchRouter;
module.exports.validateUrl = validateUrl;
module.exports.runWithConcurrency = runWithConcurrency;
