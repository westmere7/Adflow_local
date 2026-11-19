#!/usr/bin/env node
// ============================================================================
// scripts/build-app-icons.js — the desktop app's icon, from the violet Adflow mark
// ============================================================================
// The app icon is the same violet mark as the browser favicon
// (data/Elements/favicon-32x32.png): the RMIT pixel shape in Adflow's accent
// violet, #7c5cff, on a transparent background. The favicon is only 32 × 32, far
// too small for a desktop icon (macOS wants 1024 × 1024), so this draws the mark
// from its vector outline at every size instead of scaling the bitmap up.
//
// Writes, into build/:
//   icon.ico   Windows — 16, 24, 32, 48, 64, 128 and 256 px, PNG-encoded entries
//   icon.icns  macOS   — 16 to 1024 px, including the @2x retina variants
//   icon.png   1024 px — the Linux build and the window icon on Linux
//
// No dependencies: a small scanline rasteriser with 16× vertical supersampling
// and exact horizontal coverage, a PNG encoder on Node's zlib, and the ICO and
// ICNS containers written by hand. Run it again after changing the mark or the
// colour:   node scripts/build-app-icons.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'build');
const COLOR = [0x7c, 0x5c, 0xff];   // --accent-base, the favicon's violet

// The RMIT pixel mark — the same outline the editor draws for "Brand Elements"
// (app-boot.js, brandSvg), viewBox 0 0 578.52 556.76.
const MARK = 'M290.78,0h-74.15v60.23h-123.75v125.78H0v184.74h92.88v125.78h123.5v60.23h65.55c152.85,0,287.74-123.5,287.74-277.62S444.14,0,290.78,0';

// Margin around the mark, as a fraction of the icon. Windows icons are expected
// to fill their square (as the favicon does); macOS icons leave breathing room
// inside Apple's 1024 grid, so the mark does not look oversized in the Dock.
const WIN_MARGIN = 0.04;
const MAC_MARGIN = 0.10;

// ---- path → polygon ---------------------------------------------------------
// Handles exactly what the mark uses: M H V h v c S z (absolute and relative).
function pathToPolygon(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const pts = [];
  let i = 0, cmd = null, x = 0, y = 0, lastC2 = null;
  const num = () => parseFloat(tokens[i++]);
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const x0 = x, y0 = y;
    for (let s = 1; s <= 96; s++) {
      const t = s / 96, u = 1 - t;
      pts.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
      ]);
    }
    lastC2 = [x2, y2]; x = x3; y = y3;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M': x = num(); y = num(); pts.push([x, y]); lastC2 = null; break;
      case 'H': x = num(); pts.push([x, y]); lastC2 = null; break;
      case 'V': y = num(); pts.push([x, y]); lastC2 = null; break;
      case 'h': x += num(); pts.push([x, y]); lastC2 = null; break;
      case 'v': y += num(); pts.push([x, y]); lastC2 = null; break;
      case 'c': { const a = num(), b = num(), c = num(), e = num(), f = num(), g = num();
        cubic(x + a, y + b, x + c, y + e, x + f, y + g); break; }
      case 'S': { const c = num(), e = num(), f = num(), g = num();
        const r = lastC2 ? [2 * x - lastC2[0], 2 * y - lastC2[1]] : [x, y];
        cubic(r[0], r[1], c, e, f, g); break; }
      case 'z': case 'Z': break;
      default: throw new Error('Unsupported path command: ' + cmd);
    }
  }
  return pts;
}

// ---- rasterise ----------------------------------------------------------------
function rasterize(poly, size, margin) {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const scale = (size * (1 - 2 * margin)) / Math.max(w, h);
  const ox = (size - w * scale) / 2 - minX * scale;
  const oy = (size - h * scale) / 2 - minY * scale;
  const P = poly.map(([px, py]) => [px * scale + ox, py * scale + oy]);

  const alpha = new Float32Array(size * size);
  const SUB = 16;
  for (let row = 0; row < size; row++) {
    const acc = new Float32Array(size + 1);
    for (let s = 0; s < SUB; s++) {
      const yc = row + (s + 0.5) / SUB;
      const hits = [];
      for (let k = 0; k < P.length; k++) {
        const [x1, y1] = P[k], [x2, y2] = P[(k + 1) % P.length];
        if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) {
          hits.push(x1 + (yc - y1) / (y2 - y1) * (x2 - x1));
        }
      }
      hits.sort((a, b) => a - b);
      for (let k = 0; k + 1 < hits.length; k += 2) {
        const a = Math.max(0, hits[k]), b = Math.min(size, hits[k + 1]);
        if (b <= a) continue;
        const ia = Math.floor(a), ib = Math.floor(b);
        if (ia === ib) { acc[ia] += b - a; continue; }
        acc[ia] += ia + 1 - a;
        for (let px = ia + 1; px < ib; px++) acc[px] += 1;
        if (ib < size) acc[ib] += b - ib;
      }
    }
    for (let px = 0; px < size; px++) alpha[row * size + px] = Math.min(1, acc[px] / SUB);
  }
  return alpha;
}

// ---- PNG ----------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(alpha, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;   // filter: none
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const a = Math.round(alpha[y * size + x] * 255);
      raw[o] = COLOR[0]; raw[o + 1] = COLOR[1]; raw[o + 2] = COLOR[2]; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- ICO (PNG entries; Windows Vista and later) --------------------------------
function encodeICO(images) {   // [{ size, png }]
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const o = 6 + i * 16;
    head[o] = size >= 256 ? 0 : size; head[o + 1] = size >= 256 ? 0 : size;
    head[o + 2] = 0; head[o + 3] = 0;
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(png.length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map(im => im.png)]);
}

// ---- ICNS (PNG entries) -----------------------------------------------------------
function encodeICNS(entries) {   // [{ type, png }]
  const parts = entries.map(({ type, png }) => {
    const h = Buffer.alloc(8); h.write(type, 0, 'ascii'); h.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([h, png]);
  });
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8); h.write('icns', 0, 'ascii'); h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
}

// ---- build ------------------------------------------------------------------------
const poly = pathToPolygon(MARK);
const cache = new Map();
const png = (size, margin) => {
  const key = size + '|' + margin;
  if (!cache.has(key)) cache.set(key, encodePNG(rasterize(poly, size, margin), size));
  return cache.get(key);
};

fs.mkdirSync(OUT, { recursive: true });

const ico = encodeICO([16, 24, 32, 48, 64, 128, 256].map(size => ({ size, png: png(size, WIN_MARGIN) })));
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);

const icns = encodeICNS([
  { type: 'icp4', png: png(16, MAC_MARGIN) },
  { type: 'icp5', png: png(32, MAC_MARGIN) },
  { type: 'icp6', png: png(64, MAC_MARGIN) },
  { type: 'ic07', png: png(128, MAC_MARGIN) },
  { type: 'ic08', png: png(256, MAC_MARGIN) },
  { type: 'ic09', png: png(512, MAC_MARGIN) },
  { type: 'ic10', png: png(1024, MAC_MARGIN) },   // 512 @2x
  { type: 'ic11', png: png(32, MAC_MARGIN) },     // 16 @2x
  { type: 'ic12', png: png(64, MAC_MARGIN) },     // 32 @2x
  { type: 'ic13', png: png(256, MAC_MARGIN) },    // 128 @2x
  { type: 'ic14', png: png(512, MAC_MARGIN) }     // 256 @2x
]);
fs.writeFileSync(path.join(OUT, 'icon.icns'), icns);

fs.writeFileSync(path.join(OUT, 'icon.png'), png(1024, MAC_MARGIN));

console.log(`[app-icons] build/icon.ico  ${(ico.length / 1024).toFixed(1)} KB (16–256 px)`);
console.log(`[app-icons] build/icon.icns ${(icns.length / 1024).toFixed(1)} KB (16–1024 px)`);
console.log('[app-icons] build/icon.png  1024 px');
