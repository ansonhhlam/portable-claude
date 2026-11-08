#!/usr/bin/env node
// Generates the web app icons in src/web/public/ without any dependencies.
//
// The logo is a cord with a single loop. The curve is a prolate trochoid
// (x = t - b sin t, y = -b cos t) with straight tails on both ends; the same
// formula is used by src/web/logo.ts. Shapes are rasterized with signed
// distance functions (analytic anti-aliasing) and encoded as PNG via node:zlib.
//
// Usage: node scripts/gen-icons.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'src', 'web', 'public');

const BG = [0x0b, 0x6e, 0x69]; // teal
const FG = [0xff, 0xff, 0xff];

// ------------------------------------------------------------ geometry
// All coordinates are in a 64 x 64 design box.
const LOOP_B = 3;
const SCALE = 4.2;
const CX = 32;
const CY = 32;
const STROKE = 5;

/** Polyline points of the logo cord in the 64-unit box. */
function logoPoints(steps = 96) {
  const pts = [];
  const tailY = CY + SCALE * LOOP_B;
  pts.push([8, tailY]);
  for (let i = 0; i <= steps; i++) {
    const t = -Math.PI + (2 * Math.PI * i) / steps;
    pts.push([CX + SCALE * (t - LOOP_B * Math.sin(t)), CY - SCALE * LOOP_B * Math.cos(t)]);
  }
  pts.push([56, tailY]);
  return pts;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

function sdRoundedRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r;
  const hy = (y1 - y0) / 2 - r;
  const qx = Math.abs(px - cx) - hx;
  const qy = Math.abs(py - cy) - hy;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * @param {number} size output size in pixels
 * @param {{ rounded: boolean, logoScale: number }} opts
 *   rounded: draw a rounded-square background with transparent corners,
 *   otherwise fill the whole square (maskable and Apple icons).
 *   logoScale: logo size relative to the full icon.
 */
function render(size, { rounded, logoScale }) {
  const px = size / 64; // pixels per design unit for the background
  const pts = logoPoints();
  const lpx = px * logoScale; // pixels per design unit for the logo
  const offset = (size - 64 * lpx) / 2;
  const half = (STROKE / 2) * lpx;
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = x + 0.5;
      const sy = y + 0.5;
      const bgCov = rounded ? clamp01(0.5 - sdRoundedRect(sx, sy, 0, 0, size, size, 14 * px)) : 1;

      let d = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        const dd = distToSegment(
          sx,
          sy,
          offset + ax * lpx,
          offset + ay * lpx,
          offset + bx * lpx,
          offset + by * lpx,
        );
        if (dd < d) d = dd;
      }
      const fgCov = clamp01(half - d + 0.5) * bgCov;

      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[i + c] = Math.round(
          BG[c] * (1 - fgCov / (bgCov || 1)) + FG[c] * (fgCov / (bgCov || 1)),
        );
      }
      rgba[i + 3] = Math.round(bgCov * 255);
    }
  }
  return encodePng(size, size, rgba);
}

// ------------------------------------------------------------ PNG
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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
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

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------ SVG
function svg() {
  const d = logoPoints(64)
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${hex(BG)}"/>` +
    `<path d="${d}" fill="none" stroke="${hex(FG)}" stroke-width="${STROKE}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/></svg>\n`
  );
}

// ------------------------------------------------------------ main
mkdirSync(outDir, { recursive: true });
const outputs = [
  ['icon-192.png', render(192, { rounded: true, logoScale: 1 })],
  ['icon-512.png', render(512, { rounded: true, logoScale: 1 })],
  // Maskable icons keep the logo inside the central safe zone.
  ['icon-maskable-512.png', render(512, { rounded: false, logoScale: 0.72 })],
  ['apple-touch-icon.png', render(180, { rounded: false, logoScale: 0.86 })],
  ['favicon.svg', Buffer.from(svg(), 'utf8')],
];
for (const [name, data] of outputs) {
  writeFileSync(path.join(outDir, name), data);
  console.log(`wrote src/web/public/${name} (${data.length} bytes)`);
}
