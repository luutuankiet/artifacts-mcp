/**
 * Playwright-based artifact validation.
 *
 * Maintains a persistent browser pool — Chromium launches once,
 * reuses across validations. Each validation gets a fresh context
 * (isolated cookies/storage) but shares the browser process.
 *
 * Typical validation: 500ms-2s depending on CDN script load time.
 */
import { chromium } from 'playwright-core';

let browser = null;
let launchPromise = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (launchPromise) return launchPromise;

  launchPromise = (async () => {
    const b = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    b.on('disconnected', () => { browser = null; });
    return b;
  })();

  browser = await launchPromise;
  launchPromise = null;
  return browser;
}

/**
 * Validate a published artifact by loading it in headless Chromium.
 *
 * @param {string} slug     Artifact slug (filename without .html)
 * @param {string} baseUrl  Server base URL (e.g. http://localhost:3333)
 * @param {object} opts
 * @param {number} opts.timeout  Navigation timeout in ms (default 15000)
 * @param {number} opts.settleMs Time to wait for React mount (default 1500)
 * @returns {Promise<{ok, slug, elapsed_ms, errors[], consoleErrors[], rootState}>}
 */
export async function validateArtifact(slug, baseUrl, opts = {}) {
  const { timeout = 15000, settleMs = 1500 } = opts;
  const url = `${baseUrl}/artifacts/${slug}.html`;
  const t0 = Date.now();

  const brow = await getBrowser();
  const context = await brow.newContext();
  const page = await context.newPage();

  const errors = [];
  const consoleErrors = [];

  page.on('pageerror', err => {
    errors.push({
      type: 'pageerror',
      message: err.message,
      location: extractLocation(err.stack),
    });
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Filter non-critical noise
      if (!text.includes('cloudflareinsights') &&
          !text.includes('favicon.ico') &&
          !text.includes('sha512') &&
          !text.includes('Same Origin Policy')) {
        consoleErrors.push(text);
      }
    }
  });

  try {
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });

    if (!response || response.status() !== 200) {
      errors.push({
        type: 'http',
        message: `HTTP ${response ? response.status() : 'null'}`,
      });
    }

    // Wait for React mount + any async rendering
    await page.waitForTimeout(settleMs);

    const rootState = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (!root) return { exists: false };
      return {
        exists: true,
        hasChildren: root.hasChildNodes(),
        childCount: root.childElementCount,
        hasError: !!root.querySelector('.artifact-error'),
        errorText: root.querySelector('.artifact-error')?.textContent?.slice(0, 500) || null,
        innerHTMLLen: root.innerHTML.length,
      };
    });

    if (!rootState.exists) {
      errors.push({ type: 'dom', message: '#root element not found' });
    } else if (!rootState.hasChildren) {
      errors.push({ type: 'dom', message: 'Blank screen: #root has no children' });
    } else if (rootState.hasError) {
      errors.push({ type: 'render', message: rootState.errorText });
    }

    const elapsed = Date.now() - t0;
    const ok = errors.length === 0;

    console.log(`[validate] slug=${slug} ok=${ok} elapsed=${elapsed}ms errors=${errors.length} consoleErrors=${consoleErrors.length}`);

    return { ok, slug, elapsed_ms: elapsed, errors, consoleErrors, rootState };
  } catch (err) {
    errors.push({ type: 'crash', message: err.message });
    return {
      ok: false,
      slug,
      elapsed_ms: Date.now() - t0,
      errors,
      consoleErrors,
      rootState: null,
    };
  } finally {
    await context.close();
  }
}

/**
 * Check library health from libs.json manifest.
 * Returns list of problems for requested libraries.
 *
 * @param {string[]} libraries  Requested library names
 * @param {object} libsManifest  Parsed libs.json
 * @returns {{blocked: Array<{lib, reason, workaround, alternative}>, warnings: Array}}
 */
export function checkLibraryHealth(libraries, libsManifest) {
  const blocked = [];
  const warnings = [];

  for (const lib of libraries) {
    const entry = libsManifest.optional?.[lib];
    if (!entry) continue;
    if (!entry.health) continue;

    const h = entry.health;
    if (h.status === 'broken') {
      blocked.push({
        lib,
        reason: h.reason,
        workaround: h.workaround || null,
        alternative: h.alternative || null,
      });
    } else if (h.status === 'degraded') {
      warnings.push({
        lib,
        reason: h.reason,
        workaround: h.workaround || null,
      });
    }
  }

  return { blocked, warnings };
}

/** Extract line:col from a stack trace string. */
function extractLocation(stack) {
  if (!stack) return null;
  const match = stack.match(/:(\d+):(\d+)/);
  if (match) return { line: parseInt(match[1]), col: parseInt(match[2]) };
  return null;
}

/** Shut down the browser pool (for graceful shutdown). */
export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Validate a persisted whiteboard by loading its viewer page in headless Chromium.
 *
 * Checks differ by format:
 *   - svg     : #wb-render must contain an <svg> with content; no [data-wb-error]
 *   - mermaid : after settle, the mermaid pre is replaced with an <svg>; reject [data-mermaid-error]
 *   - html    : #wb-render must have children; no [data-wb-error]
 *
 * Mermaid gets a longer settle window because the CDN script must download + render.
 */
export async function validateWhiteboard(slug, format, baseUrl, opts = {}) {
  const { timeout = 15000, settleMs = format === 'mermaid' ? 2500 : 600 } = opts;
  const url = `${baseUrl}/artifacts/${slug}.html`;
  const t0 = Date.now();

  const brow = await getBrowser();
  const context = await brow.newContext();
  const page = await context.newPage();

  const errors = [];
  const consoleErrors = [];

  page.on('pageerror', err => {
    errors.push({ type: 'pageerror', message: err.message, location: extractLocation(err.stack) });
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('cloudflareinsights') &&
          !text.includes('favicon.ico') &&
          !text.includes('sha512') &&
          !text.includes('Same Origin Policy')) {
        consoleErrors.push(text);
      }
    }
  });

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout });
    if (!response || response.status() !== 200) {
      errors.push({ type: 'http', message: `HTTP ${response ? response.status() : 'null'}` });
    }

    await page.waitForTimeout(settleMs);

    const state = await page.evaluate(() => {
      const host = document.getElementById('wb-render');
      const inner = document.querySelector('.canvas-inner');
      const wbErr = document.querySelector('[data-wb-error]');
      const mErr = document.querySelector('[data-mermaid-error]');
      const svg = inner ? inner.querySelector('svg') : null;
      return {
        hostExists: !!host,
        hostHasChildren: host ? host.hasChildNodes() : false,
        hostInnerLen: host ? host.innerHTML.length : 0,
        innerHasSvg: !!svg,
        wbError: wbErr ? wbErr.textContent.slice(0, 500) : null,
        mermaidError: mErr ? mErr.textContent.slice(0, 500) : null,
      };
    });

    if (state.wbError) {
      const isEmptySvg = /No <svg> element/.test(state.wbError);
      errors.push({ type: isEmptySvg ? 'svg-empty' : 'svg-parse', message: state.wbError });
    }
    if (state.mermaidError) {
      errors.push({ type: 'mermaid', message: state.mermaidError });
    }

    if (format === 'svg' || format === 'html') {
      if (!state.hostExists) errors.push({ type: 'dom', message: '#wb-render not found' });
      else if (!state.hostHasChildren) errors.push({ type: 'dom', message: 'Whiteboard rendered empty (no children in #wb-render)' });
    } else if (format === 'mermaid') {
      // After mermaid.run replaces the <pre>, we expect an SVG inside .canvas-inner
      if (!state.innerHasSvg && !state.mermaidError) {
        errors.push({ type: 'mermaid', message: 'Mermaid did not produce an <svg> output — likely a syntax error before init.' });
      }
    }

    const elapsed = Date.now() - t0;
    const ok = errors.length === 0;
    console.log(`[validate-wb] slug=${slug} format=${format} ok=${ok} elapsed=${elapsed}ms errors=${errors.length}`);
    return { ok, slug, format, elapsed_ms: elapsed, errors, consoleErrors, state };
  } catch (err) {
    errors.push({ type: 'crash', message: err.message });
    return { ok: false, slug, format, elapsed_ms: Date.now() - t0, errors, consoleErrors, state: null };
  } finally {
    await context.close();
  }
}
