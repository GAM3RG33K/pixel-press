import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildPNG(S, width, height) {
  const bg = [0x0b, 0x0b, 0x0f];
  const violet = [0x7c, 0x3a, 0xed];
  const white = [255, 255, 255];

  const bgCorr = S * 0.22;
  const tileInset = S * 0.25;
  const tileCorr = S * 0.09;
  const tileHalf = (S - tileInset * 2) / 2;
  const cx = S / 2;

  // arrow geometry
  const headApexY = S * 0.50;
  const headTopY = S * 0.40;
  const headHalfW = S * 0.16;
  const shaftHalfW = S * 0.05;
  const shaftTopY = S * 0.34;
  const barHalfW = S * 0.20;
  const barY1 = S * 0.57;
  const barY2 = S * 0.61;

  // distance functions
  function distRoundRect(px, py, hcx, hcy, hx, hy, r) {
    const qx = Math.abs(px - hcx) - (hx - r);
    const qy = Math.abs(py - hcy) - (hy - r);
    const mx = Math.max(qx, 0);
    const my = Math.max(qy, 0);
    const outside = Math.hypot(mx, my);
    const inside = Math.min(Math.max(qx, qy), 0);
    return outside + inside - r;
  }

  function distRect(px, py, x1, y1, x2, y2) {
    const dx = Math.max(x1 - px, 0, px - x2);
    const dy = Math.max(y1 - py, 0, py - y2);
    return Math.hypot(dx, dy);
  }

  function distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function distTriangle(px, py, x1, y1, x2, y2, x3, y3) {
    function sign(p1x, p1y, p2x, p2y, p3x, p3y) {
      return (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y);
    }
    const d1 = sign(px, py, x1, y1, x2, y2);
    const d2 = sign(px, py, x2, y2, x3, y3);
    const d3 = sign(px, py, x3, y3, x1, y1);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    const inside = !(hasNeg && hasPos);
    const de = Math.min(
      distSeg(px, py, x1, y1, x2, y2),
      distSeg(px, py, x2, y2, x3, y3),
      distSeg(px, py, x3, y3, x1, y1)
    );
    return inside ? -de : de;
  }

  function coverage(dist, edgeWidth) {
    if (dist <= -edgeWidth) return 1;
    if (dist >= edgeWidth) return 0;
    const t = (dist + edgeWidth) / (2 * edgeWidth);
    return t * t * (3 - 2 * t);
  }

  // pixel color calculation
  function pointColor(x, y) {
    let pr = 0, pg = 0, pb = 0, pa = 0;

    function paint(color, cov) {
      if (cov <= 0) return;
      const sa = cov;
      const sr = color[0] * cov;
      const sg = color[1] * cov;
      const sb = color[2] * cov;
      const inv = 1 - sa;
      pr = sr + pr * inv;
      pg = sg + pg * inv;
      pb = sb + pb * inv;
      pa = sa + pa * inv;
    }

    // background rounded square
    const dBg = distRoundRect(x, y, S / 2, S / 2, S / 2, S / 2, bgCorr);
    paint(bg, coverage(dBg, 0.6));

    // violet tile
    const dTile = distRoundRect(x, y, S / 2, S / 2, tileHalf, tileHalf, tileCorr);
    paint(violet, coverage(dTile, 0.6));

    // arrow head (triangle)
    const dHead = distTriangle(x, y, cx - headHalfW, headTopY, cx + headHalfW, headTopY, cx, headApexY);
    paint(white, coverage(dHead, 0.6));

    // arrow shaft (rectangle)
    const dShaft = distRect(x, y, cx - shaftHalfW, shaftTopY, cx + shaftHalfW, headTopY);
    paint(white, coverage(dShaft, 0.6));

    // bar (rectangle)
    const dBar = distRect(x, y, cx - barHalfW, barY1, cx + barHalfW, barY2);
    paint(white, coverage(dBar, 0.6));

    const a = Math.max(0, Math.min(1, pa));
    if (a <= 0) return [0, 0, 0, 0];
    const inv = 1 / a;
    return [pr * inv, pg * inv, pb * inv, a];
  }

  // generate scanlines with supersampling
  const rows = [];
  const supersample = 2;

  for (let y = 0; y < S; y++) {
    const sampleYs = [y * supersample + 0.25, y * supersample + 0.75];
    const rowData = [];

    for (let x = 0; x < S; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy of sampleYs) {
        for (let sx of [x * supersample + 0.25, x * supersample + 0.75]) {
          const [rr, gg, bb, aa] = pointColor(sx, sy);
          r += rr; g += gg; b += bb; a += aa;
        }
      }
      const count = supersample * supersample;
      rowData.push(
        Math.round(r / count),
        Math.round(g / count),
        Math.round(b / count),
        Math.round(a / count)
      );
    }

    rows.push(0, ...rowData); // filter byte 0 = none per row
  }

  // PNG signature
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk (13 bytes)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type 6 = RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  // IDAT chunk (deflate of scanlines)
  const idatData = Buffer.from(deflateSync(Buffer.from(rows)));

  // IEND chunk (0 bytes data)
  const iendData = Buffer.alloc(0);

  return Buffer.concat([pngHeader, chunk('IHDR', ihdrData), chunk('IDAT', idatData), chunk('IEND', iendData)]);
}

const SVG_CONTENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">\n  <rect width="512" height="512" rx="113" ry="113" fill="#0b0b0f"/>\n  <rect x="128" y="128" width="256" height="256" rx="46" ry="46" fill="#7c3aed"/>\n  <polygon points="174.08,204.8 337.92,204.8 256,256" fill="white"/>\n  <rect x="230.4" y="174.08" width="51.2" height="30.72" fill="white"/>\n  <rect x="153.6" y="291.84" width="204.8" height="20.48" fill="white"/>\n</svg>\n`;

async function main() {
  const publicDir = resolve('public');

  // Create public directory if missing (idempotent)
  if (!existsSync(publicDir)) {
    mkdir(publicDir, { recursive: true });
  }

  const sizes = [192, 512];
  for (const size of sizes) {
    const pngData = buildPNG(size, size, size);
    const pngPath = resolve(`public/pwa-${size}.png`);
    await writeFile(pngPath, pngData);
    console.log(`Generated ${pngPath} (${Math.round((pngData.length / 1024))} KB)`);
  }

  const svgPath = resolve('public/icon.svg');
  await writeFile(svgPath, SVG_CONTENT);
  console.log(`Generated ${svgPath}`);
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
