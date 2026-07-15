'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * IDMAM Chunk Merger.
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
function mergeChunks({ chunkPaths, outputPath, totalSize, onProgress }) {
  return new Promise((resolve, reject) => {
    // F13: Atomic write — write to temp file first, rename on completion
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const tempPath = outputPath + '.part';

    const outputStream = fs.createWriteStream(tempPath);
    let bytesWritten = 0;
    let chunkIndex = 0;

    function writeNextChunk() {
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

      if (!fs.existsSync(chunkPath)) {
        outputStream.destroy();
        // Clean up temp file
        try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
        reject(new Error(`Missing chunk file: ${chunkPath}`));
        return;
      }

      const inputStream = fs.createReadStream(chunkPath);

      inputStream.on('data', (chunk) => {
        outputStream.write(chunk);
        bytesWritten += chunk.length;
        if (onProgress) {
          onProgress(bytesWritten, totalSize);
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
function cleanupChunks(chunkPaths, stateFilePath) {
  for (const chunkPath of chunkPaths) {
    try {
      if (fs.existsSync(chunkPath)) {
        fs.unlinkSync(chunkPath);
      }
    } catch {
      // Best effort cleanup
    }
  }
}

/**
 * Full merge operation: merge chunks → verify → cleanup.
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
      throw new Error(
        `Checksum mismatch: expected ${expectedChecksum}, got ${checksum}`
      );
    }
  }

  // Step 4: Cleanup temp files
  if (cleanupAfter) {
    cleanupChunks(chunkPaths);
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
