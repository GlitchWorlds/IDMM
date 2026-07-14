const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const width = 256;
const height = 256;

// Create raw pixel data (RGBA) - blue circle with stylized 'I' letter
const rawData = Buffer.alloc(height * (1 + width * 4));
for (let y = 0; y < height; y++) {
  const offset = y * (1 + width * 4);
  rawData[offset] = 0; // filter: none
  for (let x = 0; x < width; x++) {
    const px = offset + 1 + x * 4;
    const cx = x - 128, cy = y - 128;
    const dist = Math.sqrt(cx * cx + cy * cy);
    const inCircle = dist < 110;
    const isI = (x > 108 && x < 148 && y > 58 && y < 198);
    const isTop = (x > 78 && x < 178 && y > 58 && y < 88);
    const isBottom = (x > 78 && x < 178 && y > 168 && y < 198);

    if (inCircle && (isI || isTop || isBottom)) {
      rawData[px] = 0xff;
      rawData[px + 1] = 0xff;
      rawData[px + 2] = 0xff;
      rawData[px + 3] = 0xff;
    } else if (inCircle) {
      rawData[px] = 0x3b;
      rawData[px + 1] = 0x82;
      rawData[px + 2] = 0xf6;
      rawData[px + 3] = 0xff;
    } else {
      rawData[px] = 0;
      rawData[px + 1] = 0;
      rawData[px + 2] = 0;
      rawData[px + 3] = 0;
    }
  }
}

const compressed = zlib.deflateSync(rawData);

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  signature,
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.join(__dirname, 'assets'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'assets', 'icon.png'), png);
console.log('icon.png:', png.length, 'bytes');

// Create ICO file with embedded PNG
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);

const icoDir = Buffer.alloc(16);
icoDir[0] = 0;
icoDir[1] = 0;
icoDir[2] = 0;
icoDir[3] = 0;
icoDir.writeUInt16LE(1, 4);
icoDir.writeUInt16LE(32, 6);
icoDir.writeUInt32LE(png.length, 8);
icoDir.writeUInt32LE(22, 12);

const ico = Buffer.concat([icoHeader, icoDir, png]);
fs.writeFileSync(path.join(__dirname, 'assets', 'icon.ico'), ico);
console.log('icon.ico:', ico.length, 'bytes');
console.log('Icons generated successfully!');
