/**
 * Fetches a CC0 sample clip into .test-assets/ for dev/testing.
 * Downloads only on demand; never bundled or committed.
 *
 * Usage: bun run scripts/fetch-assets.mjs
 * License: sample clip is Public Domain (Wikimedia Commons).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const SAMPLE_URL =
  process.env.SAMPLE_URL ??
  'https://upload.wikimedia.org/wikipedia/commons/transcoded/2/21/Big_Buck_Bunny_small.ogv/Big_Buck_Bunny_small.ogv.360p.webm';
const DEST = process.env.SAMPLE_DEST ?? '.test-assets/sample.webm';

async function main() {
  if (existsSync(DEST)) {
    console.info(`[fetch-assets] ${DEST} already exists; skipping download.`);
    return;
  }

  console.info(`[fetch-assets] downloading ${SAMPLE_URL}`);
  const response = await fetch(SAMPLE_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await mkdir(join(DEST, '..'), { recursive: true });
  await writeFile(DEST, bytes);
  console.info(`[fetch-assets] wrote ${bytes.byteLength} bytes to ${DEST}`);
}

main().catch((error) => {
  console.error('[fetch-assets] failed:', error);
  process.exit(1);
});
