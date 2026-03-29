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
  // Debug: verify we received compiled JS, not raw source
  const hasReactRequire = compiledJs.includes('require("react")');
  const firstLine = compiledJs.split('\n')[0];
  console.log(`[buildHtml] received ${compiledJs.length}B, hasRequire=${hasReactRequire}, firstLine="${firstLine.slice(0,80)}"`);
  if (!hasReactRequire && compiledJs.includes('useState')) {
    console.error('[buildHtml] WARNING: received raw JSX instead of compiled JS!');
  }
  const libs = getLibs();

  // Core libs: React + ReactDOM + PropTypes (NO Babel)
  const scripts = [];
  scripts.push(`<script crossorigin src="${libs.core.react.cdn}"></script>`);
  scripts.push(`<script crossorigin src="${libs.core['react-dom'].cdn}"></script>`);
  // prop-types is a peer dependency of Recharts UMD — must load before it
  if (libs.core['prop-types']) {
    scripts.push(`<script crossorigin src="${libs.core['prop-types'].cdn}"></script>`);
  }

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

// Spread library exports onto window for bare identifier access.
// Claude.ai artifacts use components as globals (e.g., <BarChart> not
// Recharts.BarChart), so we need window.BarChart = Recharts.BarChart etc.
// This runs after CDN scripts load but before compiled JS executes.
var _libGlobals = ${JSON.stringify(Object.fromEntries(
  Object.entries(requireMap).filter(([, g]) => g !== 'React' && g !== 'ReactDOM' && g !== 'tailwind')
))};
Object.keys(_libGlobals).forEach(function(name) {
  var g = _libGlobals[name];
  var lib = window[g];
  if (lib && typeof lib === 'object') {
    Object.keys(lib).forEach(function(k) {
      if (!window[k]) window[k] = lib[k];
    });
  }
});
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
// esbuild CJS output sets module.exports = { __esModule: true, default: Component }
// The __esModule wrapper uses defineProperty getters, so we access .default carefully
var _m = module.exports;
var _ArtifactComponent = null;
try {
  // 1. CJS default export (esbuild: module.exports.default)
  if (_m && _m.__esModule && _m.default) _ArtifactComponent = _m.default;
  // 2. Direct CJS export (module.exports = Component)
  else if (_m && typeof _m === 'function') _ArtifactComponent = _m;
  // 3. Named export on exports object
  else if (typeof exports !== 'undefined' && exports.default) _ArtifactComponent = exports.default;
  // 4. Global App (bare function App() {} without export)
  else if (typeof App !== 'undefined') _ArtifactComponent = App;
  // 5. Legacy _default_export
  else if (typeof _default_export !== 'undefined') _ArtifactComponent = _default_export;
} catch(e) {
  document.getElementById('root').innerHTML = '<div class="artifact-error">Mount Error: ' + e.message + '</div>';
}

if (_ArtifactComponent) {
  try {
    var _root = ReactDOM.createRoot(document.getElementById('root'));
    _root.render(React.createElement(_ArtifactComponent));
  } catch(e) {
    document.getElementById('root').innerHTML = '<div class="artifact-error">React Render Error:\\n' + e.message + '\\n\\nStack:\\n' + (e.stack || '').split('\\n').slice(0,5).join('\\n') + '</div>';
  }
} else {
  var _dbg = 'module.exports type: ' + typeof _m
    + '\\nmodule.exports keys: ' + (typeof _m === 'object' && _m ? Object.keys(_m).join(', ') : 'N/A')
    + '\\n__esModule: ' + (_m && _m.__esModule)
    + '\\ntypeof App: ' + typeof App;
  document.getElementById('root').innerHTML =
    '<div class="artifact-error">Error: No component found to render.\\n\\nDebug info:\\n' + _dbg + '</div>';
}
  </script>
  <script>
    // Catch ALL errors — both sync and async — and show them visually
    window.addEventListener('error', function(e) {
      var root = document.getElementById('root');
      var msg = 'Runtime Error:\\n' + e.message;
      if (e.filename) msg += '\\n\\nFile: ' + e.filename + ':' + e.lineno + ':' + e.colno;
      if (e.error && e.error.stack) msg += '\\n\\nStack:\\n' + e.error.stack.split('\\n').slice(0,8).join('\\n');
      if (root && (!root.hasChildNodes() || root.querySelector('.artifact-error'))) {
        root.innerHTML = '<div class="artifact-error">' + msg + '</div>';
      } else {
        // App rendered but hit a runtime error — overlay it
        var overlay = document.createElement('div');
        overlay.className = 'artifact-error';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#fef2f2;border-bottom:2px solid #dc2626;max-height:40vh;overflow:auto;font-size:12px';
        overlay.textContent = msg;
        document.body.prepend(overlay);
      }
    });
    window.addEventListener('unhandledrejection', function(e) {
      var root = document.getElementById('root');
      if (root) {
        var overlay = document.createElement('div');
        overlay.className = 'artifact-error';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#fef2f2;border-bottom:2px solid #dc2626;max-height:40vh;overflow:auto;font-size:12px';
        overlay.textContent = 'Unhandled Promise Rejection:\\n' + (e.reason ? e.reason.message || e.reason : 'unknown');
        document.body.prepend(overlay);
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
