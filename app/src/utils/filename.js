'use strict';

const path = require('node:path');
const { URL } = require('node:url');

/**
 * Smart filename resolver for IDMM.
 * Extracts filename from Content-Disposition header or URL, sanitizes it,
 * and handles collision by appending (1), (2), etc.
 */

/**
 * Parse filename from Content-Disposition header.
 * Handles: attachment; filename="file.zip", filename*=UTF-8''encoded.zip
 * @param {string} header - Content-Disposition header value
 * @returns {string|null} Parsed filename or null
 */
function parseContentDisposition(header) {
  if (!header) return null;

  // RFC 5987: filename*=charset'language'value
  const rfc5987Match = header.match(/filename\*=(?:UTF-8''|utf-8'')([^;\s]+)/i);
  if (rfc5987Match) {
    try {
      return decodeURIComponent(rfc5987Match[1]);
    } catch {
      // fall through
    }
  }

  // Standard: filename="name" or filename=name
  const standardMatch = header.match(/filename="?([^";\n]+)"?/i);
  if (standardMatch) {
    return standardMatch[1].trim();
  }

  return null;
}

/**
 * Extract filename from a URL path.
 * @param {string} url - The download URL
 * @returns {string|null} Filename from URL path, or null
 */
function filenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    // Get last path segment, decode it
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      const decoded = decodeURIComponent(last);
      // Only use it if it looks like a filename (has extension or isn't just a path)
      if (decoded && !decoded.endsWith('/')) {
        return decoded;
      }
    }
  } catch {
    // invalid URL
  }
  return null;
}

/**
 * Sanitize a filename: remove/replace illegal characters for Windows + cross-platform.
 * @param {string} name - Raw filename
 * @returns {string} Sanitized filename safe for all OS
 */
function sanitizeFilename(name) {
  if (!name) return 'download';

  // Remove or replace characters illegal on Windows
  let clean = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')  // Windows illegal chars
    .replace(/[\x7f]/g, '')                     // DEL char
    .replace(/\s+/g, ' ')                       // collapse whitespace
    .trim();

  // Remove trailing dots and spaces (Windows doesn't like them)
  clean = clean.replace(/[. ]+$/, '');

  // Avoid reserved names on Windows
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (reserved.test(clean)) {
    clean = `_${clean}`;
  }

  // Limit length (255 chars for most filesystems)
  if (clean.length > 255) {
    const ext = path.extname(clean);
    const base = clean.slice(0, 255 - ext.length);
    clean = base + ext;
  }

  return clean || 'download';
}

/**
 * Resolve the best filename for a download.
 * Priority: explicit filename > Content-Disposition > URL path > fallback
 * @param {Object} options
 * @param {string} options.url - Download URL
 * @param {string} [options.filename] - Explicitly provided filename
 * @param {string} [options.contentDisposition] - Content-Disposition header
 * @param {string} [options.fallback='download'] - Fallback name if all else fails
 * @returns {string} Resolved and sanitized filename
 */
function resolveFilename({ url, filename, contentDisposition, fallback = 'download' }) {
  let name = null;

  // 1. Explicit filename takes priority
  if (filename) {
    name = filename;
  }

  // 2. Content-Disposition header
  if (!name && contentDisposition) {
    name = parseContentDisposition(contentDisposition);
  }

  // 3. URL path
  if (!name && url) {
    name = filenameFromUrl(url);
  }

  // 4. Fallback
  if (!name) {
    name = fallback;
  }

  return sanitizeFilename(name);
}

/**
 * Ensure unique filename in a directory by appending (1), (2), etc. if needed.
 * @param {string} dir - Target directory
 * @param {string} filename - Desired filename
 * @param {Function} existsFn - Function to check if file exists (fs.existsSync)
 * @returns {string} Unique filename
 */
function ensureUniqueFilename(dir, filename, existsFn) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);

  let candidate = filename;
  let counter = 1;

  // R6: Upper bound to prevent runaway loop with thousands of files
  while (existsFn(path.join(dir, candidate))) {
    if (counter > 999) {
      throw new Error(`Could not find unique filename for "${filename}" after 999 attempts`);
    }
    candidate = `${base} (${counter})${ext}`;
    counter++;
  }

  return candidate;
}

module.exports = {
  parseContentDisposition,
  filenameFromUrl,
  sanitizeFilename,
  resolveFilename,
  ensureUniqueFilename,
};
