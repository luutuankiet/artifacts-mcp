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

export function buildJsxHtml(source, title, libraries = []) {
  const libs = getLibs();

  // Always include core libs
  const scripts = [];

  // React + ReactDOM
  scripts.push(`<script crossorigin src="${libs.core.react.cdn}"></script>`);
  scripts.push(`<script crossorigin src="${libs.core['react-dom'].cdn}"></script>`);

  // Babel standalone for client-side JSX compilation
  scripts.push(`<script src="${libs.core['babel-standalone'].cdn}"></script>`);

  // Tailwind CDN — always include (most artifacts use it)
  const tw = libs.optional.tailwindcss;
  scripts.push(`<script src="${tw.cdn}"></script>`);

  // Optional libraries requested by the client
  for (const libName of libraries) {
    const lib = libs.optional[libName];
    if (lib && libName !== 'tailwindcss') {
      scripts.push(`<script crossorigin src="${lib.cdn}"></script>`);
    }
  }

  // Escape the source for embedding in a script tag
  const escapedSource = source
    .replace(/<\/script>/gi, '<\\/script>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${scripts.join('\n  ')}
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #root { min-height: 100vh; }
    .artifact-error { color: #dc2626; padding: 2rem; font-family: monospace; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-type="module">
${source}

// Auto-mount: find the default export and render it
const _ArtifactComponent = typeof App !== 'undefined' ? App 
  : typeof default_export !== 'undefined' ? default_export 
  : null;

if (_ArtifactComponent) {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(_ArtifactComponent));
} else {
  document.getElementById('root').innerHTML = 
    '<div class="artifact-error">Error: No App or default export found in artifact source.</div>';
}
  </script>
  <script>
    // Error boundary for Babel compilation failures
    window.addEventListener('error', function(e) {
      const root = document.getElementById('root');
      if (root && !root.hasChildNodes()) {
        root.innerHTML = '<div class="artifact-error">Compilation Error:\n' + e.message + '</div>';
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
