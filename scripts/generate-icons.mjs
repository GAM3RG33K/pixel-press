/**
 * Regenerates every icon asset from the single source of truth: public/icon.svg
 * ("The Press" mark — three scan bars compressing into a violet press plate).
 *
 * Requires macOS tooling: rsvg-convert, iconutil, and python3 with Pillow.
 * Outputs:
 *   public/pwa-192.png, public/pwa-512.png
 *   src-tauri/icons/32x32.png, 128x128.png, 128x128@2x.png, 256x256.png, 512x512.png
 *   src-tauri/icons/icon.icns  (iconutil)
 *   src-tauri/icons/icon.ico   (multi-size via Pillow)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SVG = resolve('public/icon.svg');
const iconsetSizes = [16, 32, 64, 128, 256, 512, 1024];
const pngJobs = [
  [192, 'public/pwa-192.png'],
  [512, 'public/pwa-512.png'],
  [32, 'src-tauri/icons/32x32.png'],
  [128, 'src-tauri/icons/128x128.png'],
  [256, 'src-tauri/icons/128x128@2x.png'],
  [256, 'src-tauri/icons/256x256.png'],
  [512, 'src-tauri/icons/512x512.png'],
];

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit' });
}

for (const [size, out] of pngJobs) {
  run('rsvg-convert', ['-w', String(size), '-h', String(size), SVG, '-o', resolve(out)]);
}

const iconset = mkdtempSync(join(tmpdir(), 'pixel-press-iconset-') + '/icon.iconset');
mkdirSync(iconset, { recursive: true });
try {
  for (const size of iconsetSizes) {
    run('rsvg-convert', ['-w', String(size), '-h', String(size), SVG, '-o', join(iconset, `icon_${size}x${size}.png`)]);
    if (size !== 1024) {
      run('rsvg-convert', ['-w', String(size * 2), '-h', String(size * 2), SVG, '-o', join(iconset, `icon_${size}x${size}@2x.png`)]);
    }
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', resolve('src-tauri/icons/icon.icns')]);
} finally {
  rmSync(join(iconset, '..'), { recursive: true, force: true });
}

// Multi-size .ico via Pillow
const icoSizes = [16, 32, 48, 256];
const tmp = mkdtempSync(join(tmpdir(), 'pixel-press-ico-'));
for (const s of icoSizes) {
  run('rsvg-convert', ['-w', String(s), '-h', String(s), SVG, '-o', join(tmp, `icon-${s}.png`)]);
}
execFileSync('python3', [
  '-c',
  `
from PIL import Image
import sys
sizes = [16, 32, 48, 256]
tmp = sys.argv[1]
imgs = [Image.open(f'{tmp}/icon-{s}.png').convert('RGBA') for s in sizes]
imgs[0].save('src-tauri/icons/icon.ico', sizes=[(s, s) for s in sizes], append_images=imgs[1:])
`,
  tmp,
], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });

console.log('All icons regenerated from public/icon.svg');
