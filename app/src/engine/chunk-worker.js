'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

/**
 * IDMAM Chunk Worker Thread.
 *
 * Downloads a specific byte range of a file using HTTP Range requests.
 * Communicates progress back to the main thread via parentPort.
 *
 * workerData: {
 *   url: string,           // Download URL
 *   start: number,         // Start byte (inclusive)
 *   end: number,           // End byte (inclusive)
 *   filePath: string,      // Path to write the .part file
 *   headers: object,       // Additional headers (cookies, referrer, etc.)
 *   timeout: number,       // Connection timeout in ms
 *   maxRetries: number,    // Max retry attempts
 *   chunkIndex: number,    // This chunk's index
 *   downloadId: string,    // Parent download ID
 * }
 */

const {
  url,
  start,
  end,
  filePath,
  headers: extraHeaders = {},
  timeout = 30000,
  maxRetries = 3,
  chunkIndex,
  downloadId,
  speedLimit = 0,
} = workerData;

/**
 * Send a progress message to the main thread.
 */
function report(type, data) {
  try {
    parentPort.postMessage({ type, chunkIndex, downloadId, ...data });
  } catch {
    // Port may be closed if main thread already terminated us
  }
}

/**
 * Parse a URL, handling both http and https.
 */
function parseUrl(urlStr) {
  const parsed = new URL(urlStr);
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    href: parsed.href,
  };
}

/**
 * Make an HTTP(S) request with Range header for this chunk.
 * Returns a promise that resolves when the chunk is fully downloaded.
 * @param {number} attempt
 * @param {string} currentUrl
 */
function downloadChunk(attempt, currentUrl) {
  return new Promise((resolve, reject) => {
    const parsed = parseUrl(currentUrl);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    // Check how many bytes we already have (for resume)
    let existingBytes = 0;
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        existingBytes = stat.size;
      }
    } catch {
      existingBytes = 0;
    }

    // Calculate adjusted range for resume
    const adjustedStart = start + existingBytes;
    if (adjustedStart > end) {
      // Chunk is already complete
      report('chunk_done', { downloaded: end - start + 1, totalBytes: end - start + 1 });
      resolve();
      return;
    }

    const rangeHeader = `bytes=${adjustedStart}-${end}`;
    const totalChunkSize = end - start + 1;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path,
      method: 'GET',
      headers: {
        'Range': rangeHeader,
        'User-Agent': 'IDMAM/1.0',
        'Accept': '*/*',
        ...extraHeaders,
      },
      timeout: timeout,
    };

    const req = transport.request(reqOptions, (res) => {
      // Handle redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        // Follow redirect — use updated URL
        const newUrl = new URL(res.headers.location, currentUrl).href;
        resolve(downloadChunk(attempt, newUrl)); // retry with new URL
        return;
      }

      // 416 Range Not Satisfiable — chunk may already be complete
      if (res.statusCode === 416) {
        report('chunk_done', { downloaded: totalChunkSize, totalBytes: totalChunkSize });
        resolve();
        return;
      }

      // Server doesn't support Range — but we asked for it, so 200 means full file
      if (res.statusCode === 200) {
        report('error', {
          message: 'Server returned 200 for Range request — Range not supported',
          noRangeSupport: true,
        });
        reject(new Error('NO_RANGE_SUPPORT'));
        return;
      }

      // Expect 206 Partial Content
      if (res.statusCode !== 206) {
        reject(new Error(`Unexpected HTTP ${res.statusCode} for chunk ${chunkIndex}`));
        return;
      }

      // Open file for append (resume-aware)
      const fileStream = fs.createWriteStream(filePath, { flags: 'a' });

      // BUG FIX: Handle write stream errors (disk full, permissions, etc.)
      fileStream.on('error', reject);
      let bytesWritten = existingBytes;
      const startBytes = bytesWritten;

      // Token bucket for speed limiting (0 = unlimited)
      let tokens = speedLimit > 0 ? speedLimit : Infinity;
      let lastRefill = Date.now();
      let paused = false;
      const refillInterval = 100; // ms between refills

      const throttledData = (chunk) => {
        if (speedLimit > 0) {
          const now = Date.now();
          const elapsed = now - lastRefill;
          if (elapsed >= refillInterval) {
            tokens = Math.min(speedLimit, tokens + (speedLimit * elapsed / 1000));
            lastRefill = now;
          }

          if (tokens <= 0) {
            // Pause the response stream
            if (!paused) {
              paused = true;
              res.pause();
              const waitMs = Math.max(refillInterval, 50);
              setTimeout(() => {
                paused = false;
                tokens = Math.min(speedLimit, tokens + (speedLimit * waitMs / 1000));
                lastRefill = Date.now();
                res.resume();
              }, waitMs);
            }
            // Buffer this chunk anyway (it was already received)
          }
          tokens -= chunk.length;
        }

        fileStream.write(chunk);
        bytesWritten += chunk.length;

        report('progress', {
          downloaded: bytesWritten,
          totalBytes: totalChunkSize,
          chunkBytes: chunk.length,
        });
      };

      res.on('data', throttledData);

      res.on('end', () => {
        fileStream.end(() => {
          if (bytesWritten >= totalChunkSize) {
            report('chunk_done', { downloaded: totalChunkSize, totalBytes: totalChunkSize });
            resolve();
          } else {
            // Incomplete download
            reject(new Error(`Chunk ${chunkIndex} incomplete: ${bytesWritten}/${totalChunkSize}`));
          }
        });
      });

      res.on('error', (err) => {
        fileStream.end();
        reject(err);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Chunk ${chunkIndex} timed out after ${timeout}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * Main worker logic with retry loop.
 */
async function main() {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      report('attempt', { attempt, maxRetries });
      await downloadChunk(attempt, url);
      // Success — exit cleanly
      process.exit(0);
      return;
    } catch (err) {
      lastError = err;

      // If server doesn't support Range, don't retry — report immediately
      if (err.message === 'NO_RANGE_SUPPORT') {
        process.exit(1);
        return;
      }

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        report('retry', { attempt, nextAttempt: attempt + 1, delay, error: err.message });
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // All retries exhausted
  report('error', {
    message: `Chunk ${chunkIndex} failed after ${maxRetries} attempts: ${lastError?.message}`,
    exhausted: true,
  });
  process.exit(1);
}

main().catch((err) => {
  console.error(`[chunk-worker] Fatal error for chunk ${chunkIndex} (download ${downloadId}): ${err.message}`);
  console.error(`[chunk-worker] Stack: ${err.stack}`);
  report('error', { message: `Worker fatal: ${err.message} (${err.stack})` });
  process.exit(1);
});
