#!/usr/bin/env node
/**
 * build-xpi.js
 * Converts the IDMM extension folder to a Firefox .xpi file.
 * .xpi = ZIP archive with .xpi extension.
 *
 * Usage: node scripts/build-xpi.js [version]
 * If no version arg, reads from extension/manifest.json.
 *
 * Output: dist/IDMM-Extension-{version}.xpi
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'extension');
const DIST_DIR = path.join(ROOT, 'dist');

// Read version from manifest.json or CLI arg
let version = process.argv[2];
if (!version) {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
  version = manifest.version;
}

const outputFile = path.join(DIST_DIR, `IDMM-Extension-${version}.xpi`);

// Ensure dist directory exists
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// Remove old .xpi if exists
if (fs.existsSync(outputFile)) {
  fs.unlinkSync(outputFile);
}

// Build zip using 7z (available on most Windows dev machines) or PowerShell
// We include ALL files from the extension directory, preserving structure
const filesToInclude = getAllFiles(EXT_DIR);

console.log(`Building XPI v${version}`);
console.log(`Source: ${EXT_DIR}`);
console.log(`Output: ${outputFile}`);
console.log(`Files: ${filesToInclude.length}`);

// Use PowerShell Compress-Archive (available on all Windows 10+)
const tempZip = path.join(DIST_DIR, `_temp_xpi.zip`);

// Remove temp if exists
if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);

// Write a temporary PS1 script to avoid shell escaping issues
const psScriptPath = path.join(DIST_DIR, `_build_xpi.ps1`);
const psScript = [
  `Set-Location '${EXT_DIR}'`,
  `Compress-Archive -Path * -DestinationPath '${tempZip}' -Force`,
  `Rename-Item '${tempZip}' '${outputFile}' -Force`
].join('; ');
fs.writeFileSync(psScriptPath, psScript, 'utf8');

try {
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, {
    stdio: 'inherit',
    shell: true
  });
  fs.unlinkSync(psScriptPath);
  console.log(`\nXPI created: ${outputFile}`);
} catch (err) {
  // Fallback: use Node.js built-in zip
  console.log('PowerShell failed, trying Node.js zip fallback...');
  if (fs.existsSync(psScriptPath)) fs.unlinkSync(psScriptPath);
  buildZipManually(EXT_DIR, outputFile, filesToInclude);
}

function getAllFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Minimal ZIP file builder for .xpi (no external deps).
 * Handles flat + nested directory structures.
 */
function buildZipManually(sourceDir, outputPath, allFiles) {
  // Implementation using Node.js Buffer for ZIP format
  const localHeaders = [];
  const centralHeaders = [];
  const dataBuffers = [];
  let offset = 0;

  for (const filePath of allFiles) {
    const relativePath = path.relative(sourceDir, filePath).replace(/\\/g, '/');
    const data = fs.readFileSync(filePath);
    const crc = crc32(data);

    // Local file header
    const nameBuf = Buffer.from(relativePath, 'utf8');
    const header = Buffer.alloc(30 + nameBuf.length);
    header.writeUInt32LE(0x04034b50, 0);  // signature
    header.writeUInt16LE(20, 4);           // version needed
    header.writeUInt16LE(0, 6);            // flags
    header.writeUInt16LE(0, 8);            // compression (store)
    header.writeUInt16LE(0, 10);           // mod time
    header.writeUInt16LE(0, 12);           // mod date
    header.writeUInt32LE(crc, 14);         // crc-32
    header.writeUInt32LE(data.length, 18); // compressed size
    header.writeUInt32LE(data.length, 22); // uncompressed size
    header.writeUInt16LE(nameBuf.length, 26); // name length
    header.writeUInt16LE(0, 28);           // extra length
    nameBuf.copy(header, 30);

    localHeaders.push(header);
    dataBuffers.push(data);

    // Central directory header
    const cenHeader = Buffer.alloc(46 + nameBuf.length);
    cenHeader.writeUInt32LE(0x02014b50, 0);  // signature
    cenHeader.writeUInt16LE(20, 4);           // version made by
    cenHeader.writeUInt16LE(20, 6);           // version needed
    cenHeader.writeUInt16LE(0, 8);            // flags
    cenHeader.writeUInt16LE(0, 10);           // compression
    cenHeader.writeUInt16LE(0, 12);           // mod time
    cenHeader.writeUInt16LE(0, 14);           // mod date
    cenHeader.writeUInt32LE(crc, 16);         // crc-32
    cenHeader.writeUInt32LE(data.length, 20); // compressed size
    cenHeader.writeUInt32LE(data.length, 24); // uncompressed size
    cenHeader.writeUInt16LE(nameBuf.length, 28); // name length
    cenHeader.writeUInt16LE(0, 30);           // extra length
    cenHeader.writeUInt16LE(0, 32);           // comment length
    cenHeader.writeUInt16LE(0, 34);           // disk number start
    cenHeader.writeUInt16LE(0, 36);           // internal attribs
    cenHeader.writeUInt32LE(0, 38);           // external attribs
    cenHeader.writeUInt32LE(offset, 42);      // local header offset
    nameBuf.copy(cenHeader, 46);

    centralHeaders.push(cenHeader);
    offset += header.length + data.length;
  }

  // End of central directory
  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) centralDirSize += ch.length;
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);  // signature
  endRecord.writeUInt16LE(0, 4);            // disk number
  endRecord.writeUInt16LE(0, 6);            // disk with central dir
  endRecord.writeUInt16LE(localHeaders.length, 8);  // entries on disk
  endRecord.writeUInt16LE(localHeaders.length, 10); // total entries
  endRecord.writeUInt32LE(centralDirSize, 12);
  endRecord.writeUInt32LE(centralDirOffset, 16);
  endRecord.writeUInt16LE(0, 20);           // comment length

  const allParts = [...localHeaders, ...dataBuffers, ...centralHeaders, endRecord];
  const zipBuf = Buffer.concat(allParts);
  fs.writeFileSync(outputPath, zipBuf);
  console.log(`\nXPI created (node fallback): ${outputPath}`);
}

function crc32(buf) {
  let table = crc32._table;
  if (!table) {
    table = crc32._table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}
