#!/usr/bin/env node
/**
 * Rebuild whiteboard viewer HTML files from stored source using the CURRENT
 * whiteboard-template.js. Use after editing the template / theme so existing
 * persisted artifacts pick up the new chrome.
 *
 * JSX artifacts are not rebuilt here — their compiled JS is fine; only the
 * (negligible) <body> styling differs and the actual component renders
 * whatever it draws.
 */
import { readdir, readFile } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { saveArtifact } from '../src/storage.js';
import { buildWhiteboardViewer } from '../src/whiteboard-template.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const META_DIR = resolve(__dirname, '..', 'artifacts', '.meta');
const BASE_URL = process.env.BASE_URL || 'https://artifacts.kenluu.org';

const files = await readdir(META_DIR);
const metaFiles = files.filter(f => f.endsWith('.json'));
let rebuilt = 0;
let skipped = 0;
for (const f of metaFiles) {
  const meta = JSON.parse(await readFile(join(META_DIR, f), 'utf-8'));
  if (meta.type !== 'whiteboard') { skipped++; continue; }
  const slug = meta.slug;
  let source;
  try { source = await readFile(join(META_DIR, slug + '.source'), 'utf-8'); }
  catch { console.log('  skip (no source):', slug); skipped++; continue; }
  const html = buildWhiteboardViewer({
    source,
    title: meta.title || slug,
    slug,
    format: meta.whiteboardFormat || 'html',
    baseUrl: BASE_URL,
  });
  await saveArtifact(slug, html, {
    title: meta.title,
    description: meta.description || '',
    type: 'whiteboard',
    format: 'whiteboard',
    whiteboardFormat: meta.whiteboardFormat,
    libraries: meta.libraries || [],
    sourceSize: Buffer.byteLength(source, 'utf-8'),
  });
  rebuilt++;
  console.log('  rebuilt:', slug, '(' + meta.whiteboardFormat + ')');
}
console.log(`\nDone: ${rebuilt} whiteboard viewer(s) rebuilt, ${skipped} skipped (non-whiteboard or no source).`);
