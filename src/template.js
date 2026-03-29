import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libsPath = resolve(__dirname, '..', 'libs.json');

let libsManifest;
function getLibs() {
  if (!libsManifest) {
    libsManifest = JSON.parse(readFileSync(libsPath, 'utf-8'));
  }
  return libsManifest;
}

export function reloadLibs() {
  libsManifest = null;
  return getLibs();
}

export function getAvailableLibraries() {
  const libs = getLibs();
  const result = [];
  for (const [name, info] of Object.entries(libs.optional)) {
    result.push(`${name}@${info.version}`);
  }
  return result;
}

/**
 * Build an HTML page from server-compiled JavaScript.
 * The JS has already been transformed by esbuild (JSX -> React.createElement,
 * imports -> require()), so NO Babel is needed in the browser.
 *
 * @param {string} compiledJs  esbuild-compiled JavaScript (with require() calls)
 * @param {string} title       Page title
 * @param {string[]} libraries Optional CDN library names
 * @returns {string} Complete HTML document
 */
export function buildHtml(compiledJs, title, libraries = []) {
  const libs = getLibs();

  // Core libs: React + ReactDOM (NO Babel)
  const scripts = [];
  scripts.push(`<script crossorigin src="${libs.core.react.cdn}"></script>`);
  scripts.push(`<script crossorigin src="${libs.core['react-dom'].cdn}"></script>`);

  // Tailwind CDN — always include
  const tw = libs.optional.tailwindcss;
  scripts.push(`<script src="${tw.cdn}"></script>`);

  // Optional libraries requested by the client
  for (const libName of libraries) {
    const lib = libs.optional[libName];
    if (lib && libName !== 'tailwindcss') {
      scripts.push(`<script crossorigin src="${lib.cdn}"></script>`);
    }
  }

  // Build require() shim — maps module names to CDN window globals
  // esbuild output uses require() calls (converted from ESM imports)
  const requireMap = {};
  for (const [name, info] of Object.entries(libs.core)) {
    if (info.global) requireMap[name] = info.global;
  }
  requireMap['react-dom/client'] = 'ReactDOM';
  for (const [name, info] of Object.entries(libs.optional)) {
    if (info.global) requireMap[name] = info.global;
  }

  const requireShim = `<script>
// Module shim: esbuild-compiled code uses require(), this maps to CDN globals
window.require = function(name) {
  const map = ${JSON.stringify(requireMap)};
  const g = map[name];
  if (g && window[g]) return window[g];
  console.warn('require("' + name + '"): no CDN global mapped');
  return {};
};
window.exports = {}; window.module = { exports: {} };
</script>`;

  // Escape closing script tags in the compiled JS
  const escapedJs = compiledJs.replace(/<\/script>/gi, '<\\/script>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${scripts.join('\n  ')}
  ${requireShim}
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #root { min-height: 100vh; }
    .artifact-error { color: #dc2626; padding: 2rem; font-family: monospace; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
${escapedJs}

// Auto-mount: find the component to render
// Priority: module.exports.default (CJS default export from esbuild)
//           module.exports (direct CJS export)
//           global App (common convention)
var _ArtifactComponent = (module.exports && module.exports.default) ? module.exports.default
  : (module.exports && typeof module.exports === 'function') ? module.exports
  : (exports && exports.default) ? exports.default
  : typeof App !== 'undefined' ? App
  : typeof _default_export !== 'undefined' ? _default_export
  : null;

if (_ArtifactComponent) {
  var root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(_ArtifactComponent));
} else {
  document.getElementById('root').innerHTML =
    '<div class="artifact-error">Error: No App or default export found in artifact source.</div>';
}
  </script>
  <script>
    window.addEventListener('error', function(e) {
      var root = document.getElementById('root');
      if (root && !root.hasChildNodes()) {
        root.innerHTML = '<div class="artifact-error">Runtime Error:\n' + e.message + '</div>';
      }
    });
  </script>
</body>
</html>`;
}

// Keep backward compat export name
export { buildHtml as buildJsxHtml };

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
