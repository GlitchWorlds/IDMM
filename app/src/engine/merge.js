'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * IDMM Chunk Merger.
 *
 * Merges all chunk .part files into the final output file.
 * Optionally verifies SHA-256 checksum after merge.
 */

/**
 * Merge all chunk files into a single final file.
 * @param {Object} options
 * @param {string[]} options.chunkPaths - Ordered array of .part file paths
 * @param {string} options.outputPath - Final output file path
 * @param {number} options.totalSize - Expected total file size in bytes
 * @param {Function} [options.onProgress] - Progress callback (bytesWritten, total)
 * @returns {Promise<void>}
 */
async function mergeChunks({ chunkPaths, outputPath, totalSize, onProgress }) {
  // F13: Atomic write — write to temp file first, rename on completion
  const outDir = path.dirname(outputPath);
  if (!(await fsp.access(outDir).then(() => true).catch(() => false))) {
    await fsp.mkdir(outDir, { recursive: true });
  }

  const tempPath = outputPath + '.part';

  return new Promise((resolve, reject) => {
    const outputStream = fs.createWriteStream(tempPath);
    let bytesWritten = 0;
    let chunkIndex = 0;

    async function writeNextChunk() {
      if (chunkIndex >= chunkPaths.length) {
        outputStream.end(() => {
          // F13: Atomic rename — on the same filesystem this is guaranteed atomic
          try {
            fs.renameSync(tempPath, outputPath);
            resolve();
          } catch (err) {
            // Clean up temp file on rename failure
            try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
            reject(new Error(`Failed to rename temp file: ${err.message}`));
          }
        });
        return;
      }

      const chunkPath = chunkPaths[chunkIndex];
      chunkIndex++;

      if (!(await fsp.access(chunkPath).then(() => true).catch(() => false))) {
        outputStream.destroy();
        // Clean up temp file
        try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
        reject(new Error(`Missing chunk file: ${chunkPath}`));
        return;
      }

      const inputStream = fs.createReadStream(chunkPath);

      inputStream.on('data', (chunk) => {
        const canContinue = outputStream.write(chunk);
        bytesWritten += chunk.length;
        if (onProgress) {
          onProgress(bytesWritten, totalSize);
        }
        // R2: Backpressure — pause reader until writer drains
        if (!canContinue) {
          inputStream.pause();
          outputStream.once('drain', () => inputStream.resume());
        }
      });

      inputStream.on('end', () => {
        writeNextChunk();
      });

      inputStream.on('error', (err) => {
        outputStream.destroy();
        // Clean up temp file
        try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
        reject(new Error(`Error reading chunk ${chunkPath}: ${err.message}`));
      });
    }

    outputStream.on('error', (err) => {
      outputStream.destroy();
      // Clean up temp file
      try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
      reject(new Error(`Error writing output: ${err.message}`));
    });

    writeNextChunk();
  });
}

/**
 * Cleanup temp chunk files after successful merge.
 * @param {string[]} chunkPaths - Array of .part file paths to delete
 * @param {string} [stateFilePath] - Optional download.json path to keep
 */
async function cleanupChunks(chunkPaths, stateFilePath) {
  for (const chunkPath of chunkPaths) {
    try {
      if (await fsp.access(chunkPath).then(() => true).catch(() => false)) {
        fs.unlinkSync(chunkPath);
      }
    } catch {
      // Best effort cleanup
    }
  }
}

/**
 * Full merge operation: merge chunks  verify  cleanup.
 * @param {Object} options
 * @param {string} options.downloadId
 * @param {string[]} options.chunkPaths - Ordered chunk paths
 * @param {string} options.outputPath - Final output path
 * @param {number} options.totalSize - Expected total bytes
 * @param {string} [options.expectedChecksum] - Expected SHA-256 (optional)
 * @param {boolean} [options.cleanupAfter=true] - Delete chunk files after merge
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<{ success: boolean, checksum?: string, verified?: boolean }>}
 */
async function mergeAndVerify({
  downloadId,
  chunkPaths,
  outputPath,
  totalSize,
  expectedChecksum,
  cleanupAfter = true,
  onProgress,
}) {
  const { hashFile } = require('../utils/hash');

  // Step 1: Merge all chunks
  await mergeChunks({ chunkPaths, outputPath, totalSize, onProgress });

  // Step 2: Verify output size
  const stat = fs.statSync(outputPath);
  if (stat.size !== totalSize) {
    // R3: Clean up output file on size verification failure
    try { fs.unlinkSync(outputPath); } catch { /* best effort */ }
    throw new Error(
      `Size mismatch after merge: expected ${totalSize}, got ${stat.size}`
    );
  }

  // Step 3: SHA-256 verification (if checksum provided)
  let checksum = null;
  let verified = null;

  if (expectedChecksum) {
    checksum = await hashFile(outputPath);
    verified = checksum.toLowerCase() === expectedChecksum.toLowerCase();
    if (!verified) {
      // R3: Clean up output file on checksum verification failure
      try { fs.unlinkSync(outputPath); } catch { /* best effort */ }
      throw new Error(
        `Checksum mismatch: expected ${expectedChecksum}, got ${checksum}`
      );
    }
  }

  // Step 4: Cleanup temp files
  if (cleanupAfter) {
    await cleanupChunks(chunkPaths);
  }

  return {
    success: true,
    checksum,
    verified,
    size: stat.size,
  };
}

module.exports = {
  mergeChunks,
  cleanupChunks,
  mergeAndVerify,
};

