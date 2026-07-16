'use strict';

const path = require('node:path');

/**
 * MIME type detection and auto-categorization for IDMAM.
 * Maps file extensions to MIME types and download categories.
 */

// Extension → MIME type mapping (common download types)
const EXTENSION_TO_MIME = {
  // Video
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.m4v': 'video/mp4',
  '.ts': 'video/mp2t',

  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',

  // Archives
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.bz2': 'application/x-bzip2',
  '.xz': 'application/x-xz',
  '.zst': 'application/zstd',
  '.iso': 'application/x-iso9660-image',

  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.rtf': 'application/rtf',
  '.csv': 'text/csv',
  '.epub': 'application/epub+zip',

  // Software / Executables
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.msi': 'application/x-msi',
  '.dmg': 'application/x-apple-diskimage',
  '.deb': 'application/vnd.debian.binary-package',
  '.rpm': 'application/x-rpm',
  '.apk': 'application/vnd.android.package-archive',
  '.appimage': 'application/x-executable',
  '.snap': 'application/x-snap',

  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',

  // Fonts
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',

  // Code / Data
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.java': 'text/x-java-source',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.sh': 'application/x-sh',
  '.bat': 'application/x-bat',
};

// MIME type → category mapping for IDMAM auto-categorization
const MIME_TO_CATEGORY = {
  'video/mp4': 'Videos',
  'video/x-matroska': 'Videos',
  'video/x-msvideo': 'Videos',
  'video/quicktime': 'Videos',
  'video/webm': 'Videos',
  'video/x-flv': 'Videos',
  'video/x-ms-wmv': 'Videos',
  'video/mp2t': 'Videos',

  'audio/mpeg': 'Music',
  'audio/wav': 'Music',
  'audio/flac': 'Music',
  'audio/aac': 'Music',
  'audio/ogg': 'Music',
  'audio/x-ms-wma': 'Music',
  'audio/mp4': 'Music',
  'audio/opus': 'Music',

  'application/zip': 'Archives',
  'application/vnd.rar': 'Archives',
  'application/x-7z-compressed': 'Archives',
  'application/x-tar': 'Archives',
  'application/gzip': 'Archives',
  'application/x-bzip2': 'Archives',
  'application/x-xz': 'Archives',
  'application/zstd': 'Archives',
  'application/x-iso9660-image': 'Archives',

  'application/pdf': 'Documents',
  'application/msword': 'Documents',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Documents',
  'application/vnd.ms-excel': 'Documents',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Documents',
  'application/vnd.ms-powerpoint': 'Documents',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Documents',
  'text/plain': 'Documents',
  'application/rtf': 'Documents',
  'text/csv': 'Documents',
  'application/epub+zip': 'Documents',

  'application/vnd.microsoft.portable-executable': 'Software',
  'application/x-msi': 'Software',
  'application/x-apple-diskimage': 'Software',
  'application/vnd.debian.binary-package': 'Software',
  'application/x-rpm': 'Software',
  'application/vnd.android.package-archive': 'Software',
  'application/x-executable': 'Software',
  'application/x-snap': 'Software',
};

/**
 * Detect MIME type from file extension.
 * @param {string} filename - Filename or path
 * @returns {string} MIME type or 'application/octet-stream' if unknown
 */
function detectMime(filename) {
  const ext = path.extname(filename).toLowerCase();
  return EXTENSION_TO_MIME[ext] || 'application/octet-stream';
}

/**
 * Detect MIME type from Content-Type header value.
 * Strips parameters (charset, boundary, etc.)
 * @param {string} contentType - Content-Type header value
 * @returns {string} Clean MIME type
 */
function parseContentType(contentType) {
  if (!contentType) return null;
  return contentType.split(';')[0].trim().toLowerCase();
}

/**
 * Get download category based on MIME type.
 * @param {string} mime - MIME type
 * @returns {string} Category name (Videos, Music, Documents, Archives, Software, Others)
 */
function getCategoryFromMime(mime) {
  if (!mime) return 'Others';
  const cleanMime = parseContentType(mime) || mime;

  // Check direct match
  if (MIME_TO_CATEGORY[cleanMime]) {
    return MIME_TO_CATEGORY[cleanMime];
  }

  // Check by prefix
  if (cleanMime.startsWith('video/')) return 'Videos';
  if (cleanMime.startsWith('audio/')) return 'Music';
  if (cleanMime.startsWith('image/')) return 'Images';
  if (cleanMime.startsWith('text/')) return 'Documents';

  return 'Others';
}

/**
 * Resolve category from filename + optional Content-Type.
 * @param {string} filename
 * @param {string} [contentType]
 * @returns {string} Category name
 */
function resolveCategory(filename, contentType) {
  // Try Content-Type first (more reliable for server-served files)
  if (contentType) {
    const mime = parseContentType(contentType);
    const category = getCategoryFromMime(mime);
    if (category !== 'Others') return category;
  }

  // Fall back to extension
  const mime = detectMime(filename);
  return getCategoryFromMime(mime);
}

module.exports = {
  detectMime,
  parseContentType,
  getCategoryFromMime,
  resolveCategory,
  EXTENSION_TO_MIME,
  MIME_TO_CATEGORY,
};
