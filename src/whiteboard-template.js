/**
 * Whiteboard viewer templates.
 *
 * Three viewer types — all share the same chrome (header, badge, copy/download buttons):
 *   - SVG       : direct innerHTML render
 *   - HTML      : direct innerHTML render of an HTML fragment
 *   - Mermaid   : mermaid.js CDN renders the diagram source at load time
 *
 * The raw source is inlined as <script type="text/plain" id="wb-source"> so the
 * viewer can offer Copy + Download without a separate API endpoint.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libsPath = resolve(__dirname, '..', 'libs.json');

let libsCache;
function getLibs() {
  if (!libsCache) libsCache = JSON.parse(readFileSync(libsPath, 'utf-8'));
  return libsCache;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SHARED_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; color: #0f172a; min-height: 100vh; display: flex; flex-direction: column; }
header { padding: 12px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; gap: 16px; }
header h1 { font-size: 16px; font-weight: 500; color: #475569; flex: 1; min-width: 0; }
header h1 .title { color: #0f172a; }
header h1 .badge { display: inline-block; padding: 2px 8px; margin-left: 12px; border-radius: 4px; background: #dbeafe; color: #1e40af; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; vertical-align: middle; }
.actions { display: flex; gap: 6px; flex-shrink: 0; }
.btn { padding: 6px 12px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 4px; color: #475569; font-size: 12px; cursor: pointer; text-decoration: none; transition: all 0.15s; line-height: 1.2; }
.btn:hover { background: #f1f5f9; color: #0f172a; border-color: #94a3b8; }
.canvas { flex: 1; padding: 24px; overflow: auto; display: flex; align-items: flex-start; justify-content: center; }
.canvas-inner { width: 100%; max-width: 1400px; }
.canvas-inner svg { max-width: 100%; height: auto; }
.canvas-inner pre.mermaid { background: transparent; display: flex; justify-content: center; }
.canvas-inner pre.mermaid svg { background: transparent; }
.err { color: #b91c1c; padding: 1rem; background: #fef2f2; border: 1px solid #fca5a5; border-radius: 6px; font-family: ui-monospace, monospace; white-space: pre-wrap; font-size: 13px; }
#wb-source { display: none; }
`;

function downloadScriptBlock(format, slug) {
  const ext = format === 'svg' ? 'svg' : format === 'mermaid' ? 'mmd' : 'html';
  const mime = format === 'svg' ? 'image/svg+xml' : format === 'mermaid' ? 'text/plain' : 'text/html';
  return `
function wbDownload() {
  var src = document.getElementById('wb-source').textContent;
  var blob = new Blob([src], { type: ${JSON.stringify(mime)} });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href = url; a.download = ${JSON.stringify(slug + '.' + ext)};
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function wbCopy() {
  var src = document.getElementById('wb-source').textContent;
  navigator.clipboard.writeText(src).then(function(){
    var btn = document.getElementById('wb-copy-btn');
    var orig = btn.textContent; btn.textContent = 'Copied';
    setTimeout(function(){ btn.textContent = orig; }, 1200);
  });
}
`;
}

function commonHeader(title, format, baseUrl) {
  return `<header>
  <h1><span class="title">${escapeHtml(title)}</span> <span class="badge">${format}</span></h1>
  <div class="actions">
    <button class="btn" id="wb-copy-btn" onclick="wbCopy()">Copy source</button>
    <button class="btn" onclick="wbDownload()">Download</button>
    <a class="btn" href="${baseUrl}/">Gallery</a>
  </div>
</header>`;
}

function inlineSource(source) {
  // Wrap in <script type="text/plain"> so any chars (incl. </script>) are safe.
  // Browsers won't execute, and textContent gives us the raw source for copy/download.
  // Still need to escape </script in source itself (textContent of a <script type=text/plain> stops at first </script>).
  const safe = String(source).replace(/<\/script>/gi, '<\\/script>');
  return `<script type="text/plain" id="wb-source">${safe}</script>`;
}

function buildSvgViewer({ source, title, slug, baseUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  ${commonHeader(title, 'svg', baseUrl)}
  <div class="canvas"><div class="canvas-inner" id="wb-render"></div></div>
  ${inlineSource(source)}
  <script>
    (function(){
      var src = document.getElementById('wb-source').textContent;
      var host = document.getElementById('wb-render');
      try {
        host.innerHTML = src;
        var svg = host.querySelector('svg');
        if (!svg) {
          host.innerHTML = '<div class="err" data-wb-error="1">No <svg> element found in source.</div>';
        }
      } catch (err) {
        host.innerHTML = '<div class="err" data-wb-error="1">SVG render error: ' + err.message + '</div>';
      }
    })();
    ${downloadScriptBlock('svg', slug)}
  </script>
</body>
</html>`;
}

function buildHtmlFragmentViewer({ source, title, slug, baseUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  ${commonHeader(title, 'html', baseUrl)}
  <div class="canvas"><div class="canvas-inner" id="wb-render"></div></div>
  ${inlineSource(source)}
  <script>
    (function(){
      var src = document.getElementById('wb-source').textContent;
      try {
        document.getElementById('wb-render').innerHTML = src;
      } catch (err) {
        document.getElementById('wb-render').innerHTML = '<div class="err" data-wb-error="1">HTML render error: ' + err.message + '</div>';
      }
    })();
    ${downloadScriptBlock('html', slug)}
  </script>
</body>
</html>`;
}

function buildMermaidViewer({ source, title, slug, baseUrl }) {
  const libs = getLibs();
  const mermaidCdn = libs.optional?.mermaid?.cdn
    || 'https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  ${commonHeader(title, 'mermaid', baseUrl)}
  <div class="canvas"><div class="canvas-inner"><pre class="mermaid" id="wb-render">${escapeHtml(source)}</pre></div></div>
  ${inlineSource(source)}
  <script src="${mermaidCdn}"></script>
  <script>
    (function(){
      function fail(msg){
        var host = document.getElementById('wb-render');
        if (host) host.outerHTML = '<div class="err" data-mermaid-error="1">Mermaid error:\\n' + msg + '</div>';
      }
      if (typeof mermaid === 'undefined') { fail('mermaid CDN failed to load'); return; }
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          themeVariables: { background: '#ffffff' },
          securityLevel: 'loose',
          flowchart: { htmlLabels: true, curve: 'basis' },
          sequence: { useMaxWidth: true },
        });
        var p = mermaid.run({ querySelector: '#wb-render' });
        if (p && p.catch) p.catch(function(err){ fail((err && err.message) ? err.message : String(err)); });
      } catch(err) { fail(err.message); }
    })();
    ${downloadScriptBlock('mermaid', slug)}
  </script>
</body>
</html>`;
}

/**
 * Auto-detect whiteboard format from raw content when not specified.
 *
 * Mermaid diagram-type keywords are checked first for diagrams that don't
 * begin with a tag. SVG content always opens with <svg. Anything else is
 * treated as html.
 */
export function autoDetectWhiteboardFormat(content) {
  const trimmed = String(content).trimStart();
  if (trimmed.startsWith('<svg')) return 'svg';
  if (/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|sankey-beta|xychart-beta|block-beta|architecture-beta|packet-beta|kanban|radar-beta)\b/i.test(trimmed)) {
    return 'mermaid';
  }
  return 'html';
}

export function buildWhiteboardViewer({ source, title, slug, format, baseUrl }) {
  switch (format) {
    case 'svg':     return buildSvgViewer({ source, title, slug, baseUrl });
    case 'mermaid': return buildMermaidViewer({ source, title, slug, baseUrl });
    case 'html':
    default:        return buildHtmlFragmentViewer({ source, title, slug, baseUrl });
  }
}
