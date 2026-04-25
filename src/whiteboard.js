/**
 * Whiteboard — first-class persistent visual artifacts.
 *
 * Architecture:
 *   1. Persistence: write_whiteboard saves source + viewer HTML to artifacts/<slug>.html
 *      so it shows up in the gallery and gets a stable URL.
 *   2. Live broadcast: still pushes to /whiteboard SSE clients for real-time render.
 *   3. Validation: viewer is loaded headless; SVG parser / mermaid render checked.
 *   4. Patch flow: source stored in .meta/<slug>.source so patch_whiteboard works.
 *
 * Three formats are first-class: svg | mermaid | html. Mermaid is the most
 * token-efficient choice for diagrams — 50 tokens of mermaid encodes what
 * 500 tokens of SVG would.
 */

import { saveArtifact, saveSource } from './storage.js';
import { buildWhiteboardViewer, autoDetectWhiteboardFormat } from './whiteboard-template.js';

export { autoDetectWhiteboardFormat };

// ── SSE Client Registry ────────────────────────────────────────────────
const sseClients = new Set();

/**
 * Push content to all connected whiteboard browsers.
 * @param {string} content  Raw SVG or HTML markup
 * @param {string} title    Human-readable title
 * @param {string} format   'svg' | 'html'
 * @returns {number} Number of clients that received the push
 */
export function broadcastWhiteboard(content, title, format) {
  const payload = JSON.stringify({ content, title, format, timestamp: Date.now() });
  let sent = 0;
  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
      sent++;
    } catch {
      sseClients.delete(client);
    }
  }
  console.log(`[whiteboard] broadcast to ${sent} clients (${format}, ${Buffer.byteLength(content)}B)`);
  return sent;
}

/**
 * Persist a whiteboard as a first-class artifact.
 * Writes the viewer HTML, metadata, and raw source so the whiteboard appears
 * in the gallery, has a stable URL, and supports patch_whiteboard.
 *
 * @param {object} args
 * @param {string} args.slug              Stable filename slug
 * @param {string} args.source            Raw whiteboard source (svg/mermaid/html)
 * @param {string} args.title             Human-readable title
 * @param {string} args.format            'svg' | 'mermaid' | 'html'
 * @param {string} args.description       Optional description for gallery
 * @param {string} args.baseUrl           Public base URL
 * @returns {Promise<{html: string, meta: object, viewerUrl: string}>}
 */
export async function persistWhiteboard({ slug, source, title, format, description = '', baseUrl }) {
  const html = buildWhiteboardViewer({ source, title, slug, format, baseUrl });
  const meta = await saveArtifact(slug, html, {
    title,
    description,
    type: 'whiteboard',
    format: 'whiteboard',
    whiteboardFormat: format,
    libraries: format === 'mermaid' ? ['mermaid'] : [],
    sourceSize: Buffer.byteLength(source, 'utf-8'),
  });
  await saveSource(slug, source);
  return { html, meta, viewerUrl: `${baseUrl}/artifacts/${slug}.html` };
}

/**
 * Register SSE routes on the Express app.
 */
export function handleWhiteboard(app, baseUrl) {
  // Serve the whiteboard HTML page
  app.get('/whiteboard', (req, res) => {
    res.type('html').send(whiteboardPageHtml(baseUrl));
  });

  // SSE endpoint — browsers connect here for live updates
  app.get('/whiteboard/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',  // Disable Nginx/Traefik buffering
    });

    // Send initial heartbeat so client knows connection is live
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

    sseClients.add(res);
    console.log(`[whiteboard] SSE client connected (total: ${sseClients.size})`);

    // Keepalive ping every 30s to prevent proxy timeout
    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { clearInterval(keepalive); }
    }, 30000);

    req.on('close', () => {
      sseClients.delete(res);
      clearInterval(keepalive);
      console.log(`[whiteboard] SSE client disconnected (total: ${sseClients.size})`);
    });
  });

  // REST API to check whiteboard status
  app.get('/whiteboard/status', (req, res) => {
    res.json({ clients: sseClients.size });
  });
}

// ── Whiteboard Page HTML ───────────────────────────────────────────────
function whiteboardPageHtml(baseUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Whiteboard — Artifact Server</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      padding: 12px 20px;
      background: #111;
      border-bottom: 1px solid #222;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    header h1 { font-size: 16px; font-weight: 500; color: #999; }
    header h1 span { color: #fff; }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #666;
    }
    .status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #333;
      transition: background 0.3s;
    }
    .status-dot.connected { background: #22c55e; }
    .status-dot.receiving { background: #3b82f6; animation: pulse 0.5s ease; }
    @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.5); } }
    .canvas-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      overflow: auto;
    }
    .canvas-area.has-content {
      justify-content: flex-start;
    }
    .empty-state {
      text-align: center;
      color: #444;
    }
    .empty-state h2 { font-size: 24px; margin-bottom: 8px; color: #555; }
    .empty-state p { font-size: 14px; line-height: 1.6; }
    .empty-state .hint { margin-top: 16px; padding: 10px 16px; background: #1a1a1a; border-left: 2px solid #3b82f6; color: #94a3b8; font-size: 13px; text-align: left; max-width: 420px; }
    .empty-state code {
      background: #1a1a1a;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
      color: #888;
    }
    #whiteboard {
      width: 100%;
      max-width: 1200px;
    }
    #whiteboard svg {
      max-width: 100%;
      height: auto;
    }
    .title-bar {
      font-size: 14px;
      color: #888;
      padding: 8px 0;
      margin-bottom: 12px;
      border-bottom: 1px solid #222;
      display: none;
    }
    .title-bar.visible { display: flex; justify-content: space-between; align-items: center; }
    .title-bar .title { color: #ccc; font-weight: 500; }
    .title-bar .meta { font-size: 12px; color: #555; }
    .history-bar {
      display: flex;
      gap: 6px;
      padding: 8px 20px;
      background: #111;
      border-top: 1px solid #222;
      overflow-x: auto;
      flex-shrink: 0;
    }
    .history-bar:empty { display: none; }
    .history-chip {
      padding: 4px 10px;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 4px;
      font-size: 12px;
      color: #888;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .history-chip:hover { border-color: #555; color: #ccc; }
    .history-chip.active { border-color: #3b82f6; color: #3b82f6; background: #0f1729; }
    .dl-btn {
      padding: 4px 12px;
      background: #1e293b;
      border: 1px solid #475569;
      border-radius: 4px;
      color: #94a3b8;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .dl-btn:hover { background: #334155; color: #e2e8f0; border-color: #64748b; }
  </style>
</head>
<body>
  <header>
    <h1><span>Whiteboard</span> &mdash; live broadcast</h1>
    <div class="status">
      <a class="dl-btn" href="${baseUrl}/" style="text-decoration:none">Gallery</a>
      <button class="dl-btn" id="download-btn" onclick="downloadContent()" style="display:none">Download</button>
      <span id="status-text">Connecting...</span>
      <div class="status-dot" id="status-dot"></div>
    </div>
  </header>

  <div class="canvas-area" id="canvas-area">
    <div class="empty-state" id="empty-state">
      <h2>Waiting for content</h2>
      <p>Claude will push SVG / Mermaid / HTML here via the <code>write_whiteboard</code> tool.<br>
      Content renders instantly &mdash; no compilation, no page reload.</p>
      <div class="hint">Whiteboards now <strong>persist by default</strong>. Find past boards in the <a href="${baseUrl}/" style="color:#60a5fa">Gallery</a> or pass <code>persist:false</code> for ephemeral broadcasts.</div>
    </div>
    <div class="title-bar" id="title-bar">
      <span class="title" id="content-title"></span>
      <span class="meta" id="content-meta"></span>
    </div>
    <div id="whiteboard"></div>
  </div>

  <div class="history-bar" id="history-bar"></div>

  <script>
    const whiteboard = document.getElementById('whiteboard');
    const emptyState = document.getElementById('empty-state');
    const canvasArea = document.getElementById('canvas-area');
    const titleBar = document.getElementById('title-bar');
    const contentTitle = document.getElementById('content-title');
    const contentMeta = document.getElementById('content-meta');
    const historyBar = document.getElementById('history-bar');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    const history = [];
    let activeIdx = -1;

    let currentEntry = null;

    function renderContent(entry) {
      currentEntry = entry;
      whiteboard.innerHTML = entry.content;
      contentTitle.textContent = entry.title;
      const time = new Date(entry.timestamp).toLocaleTimeString();
      contentMeta.textContent = entry.format.toUpperCase() + ' \u2014 ' + time;
      titleBar.classList.add('visible');
      emptyState.style.display = 'none';
      canvasArea.classList.add('has-content');
      document.getElementById('download-btn').style.display = 'inline-block';
    }

    function downloadContent() {
      if (!currentEntry) return;
      const ext = currentEntry.format === 'svg' ? 'svg' : 'html';
      const mime = currentEntry.format === 'svg' ? 'image/svg+xml' : 'text/html';
      let content = currentEntry.content;
      if (ext === 'html') {
        content = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' +
          (currentEntry.title || 'whiteboard') + '</title></head><body>' + content + '</body></html>';
      }
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = (currentEntry.title || 'whiteboard').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      a.href = url; a.download = slug + '.' + ext;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function addHistoryChip(entry, idx) {
      const chip = document.createElement('button');
      chip.className = 'history-chip';
      chip.textContent = entry.title || 'Untitled #' + (idx + 1);
      chip.onclick = () => {
        activeIdx = idx;
        renderContent(history[idx]);
        document.querySelectorAll('.history-chip').forEach((c, i) => {
          c.classList.toggle('active', i === idx);
        });
      };
      historyBar.appendChild(chip);
      return chip;
    }

    function connect() {
      const es = new EventSource('/whiteboard/events');

      es.onopen = () => {
        statusDot.className = 'status-dot connected';
        statusText.textContent = 'Connected';
      };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'connected') return;

          // Flash the status dot blue
          statusDot.className = 'status-dot receiving';
          setTimeout(() => { statusDot.className = 'status-dot connected'; }, 600);

          // Store in history
          const idx = history.length;
          history.push(data);
          const chip = addHistoryChip(data, idx);

          // Auto-show latest
          activeIdx = idx;
          renderContent(data);
          document.querySelectorAll('.history-chip').forEach((c, i) => {
            c.classList.toggle('active', i === idx);
          });
        } catch (err) {
          console.error('SSE parse error:', err);
        }
      };

      es.onerror = () => {
        statusDot.className = 'status-dot';
        statusText.textContent = 'Reconnecting...';
      };
    }

    connect();
  </script>
</body>
</html>`;
}
