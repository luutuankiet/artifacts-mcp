#!/usr/bin/env node
/**
 * Render Smoke Test — headless Chromium verification for artifacts.
 *
 * Usage:
 *   node tests/render-smoke.mjs                          # test all artifacts
 *   node tests/render-smoke.mjs test-bar-chart-fixed     # test specific slug
 *   node tests/render-smoke.mjs --base http://localhost:3333  # custom base URL
 *
 * Returns exit code 0 if all pass, 1 if any fail.
 */
import { chromium } from 'playwright-core';
import { readdir, readFile } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = resolve(__dirname, '..', 'artifacts');
const META_DIR = resolve(__dirname, '..', 'artifacts', '.meta');

async function readMeta(slug) {
  try {
    const j = await readFile(join(META_DIR, `${slug}.json`), 'utf-8');
    return JSON.parse(j);
  } catch {
    return null;
  }
}

// Parse args
const args = process.argv.slice(2);
let baseUrl = 'http://localhost:3333';
let slugFilter = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base' && args[i + 1]) { baseUrl = args[++i]; }
  else if (!args[i].startsWith('-')) { slugFilter = args[i]; }
}

async function getSlugs() {
  if (slugFilter) return [slugFilter];
  const files = await readdir(ARTIFACTS_DIR);
  const allSlugs = files.filter(f => f.endsWith('.html')).map(f => f.replace('.html', ''));

  // Render-smoke validates the React mount path (#root). Skip artifacts that
  // don't follow that contract: whiteboards and HTML passthroughs.
  const eligible = [];
  const skipped = [];
  for (const slug of allSlugs) {
    const meta = await readMeta(slug);
    if (meta && (meta.type === 'whiteboard' || meta.format === 'html')) {
      skipped.push({ slug, reason: meta.type === 'whiteboard' ? `whiteboard (${meta.whiteboardFormat || 'html'})` : 'html passthrough' });
    } else {
      eligible.push(slug);
    }
  }
  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.length} non-JSX artifact(s):`);
    for (const s of skipped) console.log(`  — ${s.slug} [${s.reason}]`);
    console.log('');
  }
  return eligible;
}

async function smokeTest(browser, slug) {
  const url = `${baseUrl}/artifacts/${slug}.html`;
  const page = await browser.newPage();
  const errors = [];
  const consoleErrors = [];

  page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[console.error] ${msg.text()}`);
  });

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    if (!response || response.status() !== 200) {
      errors.push(`[http] Status ${response ? response.status() : 'null'}`);
    }

    // Wait a bit for React to render
    await page.waitForTimeout(1000);

    // Check if #root has children (not blank)
    const rootState = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (!root) return { exists: false };
      return {
        exists: true,
        hasChildren: root.hasChildNodes(),
        childCount: root.childElementCount,
        hasError: !!root.querySelector('.artifact-error'),
        errorText: root.querySelector('.artifact-error')?.textContent?.slice(0, 200) || null,
        innerHTMLLen: root.innerHTML.length
      };
    });

    if (!rootState.exists) {
      errors.push('[dom] #root element not found');
    } else if (!rootState.hasChildren) {
      errors.push('[dom] BLANK SCREEN: #root has no children');
    } else if (rootState.hasError) {
      errors.push(`[render] Error displayed: ${rootState.errorText}`);
    }

    // Filter out non-critical console errors (Cloudflare, favicon)
    const criticalErrors = consoleErrors.filter(e =>
      !e.includes('cloudflareinsights') &&
      !e.includes('favicon.ico') &&
      !e.includes('sha512') &&
      !e.includes('Same Origin Policy')
    );
    if (criticalErrors.length > 0) {
      errors.push(...criticalErrors);
    }

    return {
      slug,
      url,
      ok: errors.length === 0,
      rootState,
      errors,
      consoleErrors: criticalErrors
    };
  } catch (err) {
    errors.push(`[crash] ${err.message}`);
    return { slug, url, ok: false, errors, consoleErrors };
  } finally {
    await page.close();
  }
}

async function main() {
  const slugs = await getSlugs();
  if (slugs.length === 0) {
    console.log('No artifacts to test.');
    return;
  }

  console.log(`\n🧪 Render Smoke Test — ${slugs.length} artifact(s)\n`);
  console.log(`Base URL: ${baseUrl}\n`);

  const browser = await chromium.launch({ headless: true });
  let passed = 0;
  let failed = 0;
  const results = [];

  for (const slug of slugs) {
    const result = await smokeTest(browser, slug);
    results.push(result);
    if (result.ok) {
      passed++;
      console.log(`  ✅ ${slug} — rendered (${result.rootState?.childCount || 0} elements, ${result.rootState?.innerHTMLLen || 0}B)`);
    } else {
      failed++;
      console.log(`  ❌ ${slug}`);
      for (const err of result.errors) {
        console.log(`     ${err}`);
      }
    }
  }

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed out of ${slugs.length}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
