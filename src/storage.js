import { readdir, readFile, writeFile, unlink, mkdir, stat } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = resolve(__dirname, '..', 'artifacts');
const META_DIR = resolve(__dirname, '..', 'artifacts', '.meta');

// Ensure directories exist on import
await mkdir(ARTIFACTS_DIR, { recursive: true });
await mkdir(META_DIR, { recursive: true });

export async function saveArtifact(slug, html, meta) {
  const htmlPath = join(ARTIFACTS_DIR, `${slug}.html`);
  const metaPath = join(META_DIR, `${slug}.json`);

  await writeFile(htmlPath, html, 'utf-8');

  const fullMeta = {
    ...meta,
    slug,
    htmlSize: Buffer.byteLength(html, 'utf-8'),
    created: new Date().toISOString(),
  };

  await writeFile(metaPath, JSON.stringify(fullMeta, null, 2), 'utf-8');
  return fullMeta;
}

export async function listArtifacts(baseUrl) {
  const files = await readdir(ARTIFACTS_DIR);
  const htmlFiles = files.filter(f => f.endsWith('.html'));

  const artifacts = [];
  for (const file of htmlFiles) {
    const slug = file.replace('.html', '');
    const metaPath = join(META_DIR, `${slug}.json`);
    const htmlPath = join(ARTIFACTS_DIR, file);

    let meta = {};
    try {
      meta = JSON.parse(await readFile(metaPath, 'utf-8'));
    } catch {
      // No meta file — build from filesystem
      const stats = await stat(htmlPath);
      meta = { slug, title: slug, created: stats.mtime.toISOString(), htmlSize: stats.size };
    }

    artifacts.push({
      url: `${baseUrl}/artifacts/${file}`,
      slug,
      title: meta.title || slug,
      description: meta.description || '',
      format: meta.format || 'unknown',
      size_kb: Math.round((meta.htmlSize || 0) / 1024),
      created: meta.created,
    });
  }

  // Sort by created date, newest first
  artifacts.sort((a, b) => new Date(b.created) - new Date(a.created));
  return artifacts;
}

export async function getArtifact(slug, baseUrl) {
  const htmlPath = join(ARTIFACTS_DIR, `${slug}.html`);
  if (!existsSync(htmlPath)) return null;

  const metaPath = join(META_DIR, `${slug}.json`);
  let meta = {};
  try {
    meta = JSON.parse(await readFile(metaPath, 'utf-8'));
  } catch {
    const stats = await stat(htmlPath);
    meta = { slug, title: slug, created: stats.mtime.toISOString(), htmlSize: stats.size };
  }

  return {
    url: `${baseUrl}/artifacts/${slug}.html`,
    slug,
    title: meta.title || slug,
    description: meta.description || '',
    format: meta.format || 'unknown',
    size_kb: Math.round((meta.htmlSize || 0) / 1024),
    created: meta.created,
    libraries: meta.libraries || [],
  };
}

export async function deleteArtifact(slug) {
  const htmlPath = join(ARTIFACTS_DIR, `${slug}.html`);
  if (!existsSync(htmlPath)) return false;

  await unlink(htmlPath);
  const metaPath = join(META_DIR, `${slug}.json`);
  try { await unlink(metaPath); } catch {}
  return true;
}
