// Erzeugt das App-Symbol (ein blaues Schulheft) als build/icon.png (512 px) und build/icon.ico (256/48/32/16 px).
// Ohne Zusatzprogramme: Formen werden direkt gerastert (4×4-Kantenglättung). Ausführen: node build/make-icon.mjs
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Formen im Raster 0…256: [Farbe RGBA, Test(x, y)] – spätere Formen liegen oben
const rrect = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const SHAPES = [
  [[0x1f, 0x4e, 0x86, 255], rrect(44, 20, 220, 236, 20)],          // Umschlag (Schatten/Rand)
  [[0x2f, 0x6f, 0xb0, 255], rrect(48, 20, 220, 230, 18)],          // Umschlag
  [[0x24, 0x57, 0x8c, 255], rrect(48, 20, 82, 230, 18)],           // Rücken
  [[0x2f, 0x6f, 0xb0, 255], (x, y) => x > 74 && x <= 82 && y > 20 && y < 230],
  [[0xff, 0xff, 0xff, 255], rrect(100, 62, 196, 122, 8)],          // Etikett
  [[0x9a, 0xb4, 0xd0, 255], rrect(112, 80, 184, 85, 2)],           // Zeilen auf dem Etikett
  [[0x9a, 0xb4, 0xd0, 255], rrect(112, 98, 166, 103, 2)],
  ...[56, 100, 144, 188].map(y => [[0xf4, 0xf6, 0xfa, 255], circle(65, y + 8, 7)]),   // Ringe
];

function render(size) {
  const px = Buffer.alloc(size * size * 4), S = 4, k = 256 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const X = (x + (sx + 0.5) / S) * k, Y = (y + (sy + 0.5) / S) * k;
      let c = null;
      for (const [col, hit] of SHAPES) if (hit(X, Y)) c = col;
      if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
    }
    const n = S * S, i = (y * size + x) * 4;
    // Farbe gewichtet nach Deckung (vormultipliziert → zurückrechnen)
    px[i] = a ? Math.round(r * 255 / a) : 0; px[i + 1] = a ? Math.round(g * 255 / a) : 0; px[i + 2] = a ? Math.round(b * 255 / a) : 0; px[i + 3] = Math.round(a / n);
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(size) {
  const raw = render(size), rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// ICO mit eingebetteten PNGs (geht ab Windows Vista)
function ico(sizes) {
  const imgs = sizes.map(png), head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head[e] = s >= 256 ? 0 : s; head[e + 1] = s >= 256 ? 0 : s; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(off, e + 12); off += imgs[i].length;
  });
  return Buffer.concat([head, ...imgs]);
}

writeFileSync(path.join(HERE, 'icon.png'), png(512));
writeFileSync(path.join(HERE, 'icon.ico'), ico([256, 48, 32, 16]));
console.log('Gebaut: build/icon.png, build/icon.ico');
