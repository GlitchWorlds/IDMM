'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/**
 * SHA-256 checksum utilities for IDMM.
 * Used for file integrity verification after download.
 */

/**
 * Compute SHA-256 hash of a file.
 * Streams the file to avoid loading it entirely into memory.
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Verify a file's SHA-256 hash against an expected value.
 * @param {string} filePath - Path to the file
 * @param {string} expectedHash - Expected hex SHA-256 hash
 * @returns {Promise<boolean>} True if hash matches
 */
async function verifyFile(filePath, expectedHash) {
  if (!expectedHash || typeof expectedHash !== 'string') return false;
  const actualHash = await hashFile(filePath);
  return actualHash === expectedHash.toLowerCase();
}

/**
 * Compute SHA-256 hash of a string (e.g., URL for deduplication).
 * @param {string} data - Input string
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashString(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

module.exports = {
  hashFile,
  verifyFile,
  hashString,
};
