// Generates PWA icons (PNG 192/512/maskable/apple-touch + SVG) with zero
// image dependencies: minimal PNG encoder (zlib + CRC32) + geometric mark.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const APPS = [
  { dir: 'apps/admin', bg: [32, 107, 196], accent: [47, 179, 68], letter: 'A' },
  { dir: 'apps/teacher', bg: [23, 92, 165], accent: [255, 193, 7], letter: 'T' },
  { dir: 'apps/student', bg: [47, 179, 68], accent: [32, 107, 196], letter: 'S' },
  { dir: 'apps/parent', bg: [121, 85, 200], accent: [255, 193, 7], letter: 'P' },
  { dir: 'apps/web', bg: [32, 107, 196], accent: [255, 255, 255], letter: 'L' },
];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Rounded-square gradient + white ring + accent dot. Deterministic, no fonts.
function render(size, bg, accent, pad = 0) {
  const buf = Buffer.alloc(size * size * 4);
  const [r1, g1, b1] = bg;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      const r = Math.round(r1 + (20 - r1) * t * 0.35);
      const g = Math.round(g1 + (40 - g1) * t * 0.35);
      const b = Math.round(b1 + (60 - b1) * t * 0.35);
      const i = (y * size + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
  const cx = size / 2;
  const cy = size / 2;
  const R = size * (pad ? 0.32 : 0.4);
  const ring = (R2, w, col) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dist = Math.hypot(x - cx, y - cy);
        if (Math.abs(dist - R2) < w) {
          const i = (y * size + x) * 4;
          buf[i] = col[0];
          buf[i + 1] = col[1];
          buf[i + 2] = col[2];
        }
      }
    }
  };
  ring(R, size * 0.035, [255, 255, 255]);
  // accent dot (book/learner mark)
  const dr = size * 0.09;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.hypot(x - (cx + R * 0.45), y - (cy - R * 0.45)) < dr) {
        const i = (y * size + x) * 4;
        buf[i] = accent[0];
        buf[i + 1] = accent[1];
        buf[i + 2] = accent[2];
      }
    }
  }
  return buf;
}

for (const app of APPS) {
  const out = join(root, app.dir, 'public', 'icons');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'icon-192.png'), png(192, 192, render(192, app.bg, app.accent)));
  writeFileSync(join(out, 'icon-512.png'), png(512, 512, render(512, app.bg, app.accent)));
  writeFileSync(
    join(out, 'maskable-512.png'),
    png(512, 512, render(512, app.bg, app.accent, true))
  );
  writeFileSync(join(out, 'apple-touch-icon.png'), png(180, 180, render(180, app.bg, app.accent)));
  const [r, g, b] = app.bg;
  writeFileSync(
    join(out, 'icon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="110" fill="rgb(${r},${g},${b})"/><circle cx="256" cy="256" r="120" fill="none" stroke="#fff" stroke-width="34"/><circle cx="352" cy="160" r="44" fill="#fff"/></svg>`
  );
  console.log(`icons: ${app.dir}`);
}
