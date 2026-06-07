// Node.js로 PNG 아이콘 생성 (의존성 없음)
// 실행: node create-icons.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function makePNG(size) {
  const bg = [15, 15, 26];       // #0f0f1a
  const accent = [168, 85, 247]; // #a855f7
  const cx = size / 2, cy = size / 2;

  const pixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - cx, dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const cr = size * 0.5;

      // 둥근 배경
      const bgR = size * 0.48;
      if (r > bgR) { pixels[i+3] = 0; continue; }

      // 기본 배경
      pixels[i] = bg[0]; pixels[i+1] = bg[1]; pixels[i+2] = bg[2]; pixels[i+3] = 255;

      // 바깥 원
      const outerR = size * 0.38, outerW = size * 0.04;
      if (Math.abs(r - outerR) < outerW) {
        pixels[i] = accent[0]; pixels[i+1] = accent[1]; pixels[i+2] = accent[2]; continue;
      }

      // 안쪽 원
      const innerR = size * 0.25, innerW = size * 0.025;
      if (Math.abs(r - innerR) < innerW) {
        pixels[i] = 192; pixels[i+1] = 132; pixels[i+2] = 252; continue;
      }

      // 재생 삼각형
      const triLeft = cx - size * 0.08;
      const triRight = cx + size * 0.14;
      const triHalf = size * 0.12;
      if (x >= triLeft && x <= triRight) {
        const progress = (x - triLeft) / (triRight - triLeft);
        if (Math.abs(dy) < triHalf * progress) {
          pixels[i] = 233; pixels[i+1] = 213; pixels[i+2] = 255; continue;
        }
      }
    }
  }

  // PNG 인코딩
  const rawRows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 4 + 1);
    row[0] = 0; // filter type none
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      row[1 + x * 4] = pixels[si];
      row[2 + x * 4] = pixels[si+1];
      row[3 + x * 4] = pixels[si+2];
      row[4 + x * 4] = pixels[si+3];
    }
    rawRows.push(row);
  }
  const raw = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  function crc32(buf) {
    let c = 0xffffffff;
    const table = [];
    for (let i = 0; i < 256; i++) {
      let v = i;
      for (let j = 0; j < 8; j++) v = (v & 1) ? (0xedb88320 ^ (v >>> 1)) : (v >>> 1);
      table[i] = v;
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const crcBuf = Buffer.concat([t, d]);
    const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(crcBuf));
    return Buffer.concat([len, t, d, crcVal]);
  }

  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = path.join(__dirname, 'icons');
fs.writeFileSync(path.join(outDir, 'icon-192.png'), makePNG(192));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), makePNG(512));
console.log('아이콘 생성 완료: icons/icon-192.png, icons/icon-512.png');
