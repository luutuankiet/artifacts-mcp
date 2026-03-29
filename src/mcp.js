import { randomUUID } from 'crypto';
import { compileJsx, detectLibraries } from './compiler.js';
import { buildHtml, getAvailableLibraries } from './template.js';
import { saveArtifact, listArtifacts, getArtifact, deleteArtifact } from './storage.js';
import { broadcastWhiteboard } from './whiteboard.js';

const PROTOCOL_VERSION = '2025-03-26';

function slugify(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

function getToolDefinitions() {
  const availableLibs = getAvailableLibraries();
  return [
    {
      name: 'publish_artifact',
      description: [
        'Publish JSX or HTML as a browsable artifact. Just write your React component — the server handles everything:',
        '- React/hooks imports are auto-injected if missing',
        '- Libraries (recharts, d3, lodash, etc.) are auto-detected from your code',
        '- Default export is auto-added if you define a component named App or any PascalCase function',
        '- JSX is compiled server-side with esbuild — syntax errors return immediately with line:col',
        `Available libraries (auto-detected or manual): ${availableLibs.join(', ')}. Core libs (react, react-dom, tailwindcss) always included.`,
      ].join('\n'),
      inputSchema: {
        type: 'object',
        required: ['source', 'title'],
        properties: {
          source: { type: 'string', description: 'Complete JSX/TSX source code or raw HTML' },
          title: { type: 'string', description: 'Human-readable title for the artifact' },
          format: { type: 'string', enum: ['jsx', 'html'], default: 'jsx', description: 'Source format. jsx = compile with esbuild+React. html = serve as-is.' },
          slug: { type: 'string', description: 'Optional URL slug. Auto-generated from title if omitted.' },
          libraries: { type: 'array', items: { type: 'string' }, description: `Optional CDN libs (auto-detected if omitted). Available: ${availableLibs.join(', ')}` },
          description: { type: 'string', description: 'Optional description shown in gallery' },
        },
      },
    },
    {
      name: 'list_artifacts',
      description: 'List all published artifacts with metadata and URLs',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_artifact',
      description: 'Get metadata and URL for a specific artifact by slug',
      inputSchema: {
        type: 'object',
        required: ['slug'],
        properties: { slug: { type: 'string', description: 'Artifact slug (filename without extension)' } },
      },
    },
    {
      name: 'delete_artifact',
      description: 'Delete an artifact by slug',
      inputSchema: {
        type: 'object',
        required: ['slug'],
        properties: { slug: { type: 'string', description: 'Artifact slug to delete' } },
      },
    },
    {
      name: 'write_whiteboard',
      description: [
        'Push SVG or HTML to the live whiteboard. Content renders instantly in any connected browser — zero compilation, zero page reload.',
        'Best for: diagrams, flowcharts, architecture visuals, data visualizations, any visual explanation.',
        'The user opens /whiteboard in a browser tab once. Every call to this tool updates that tab instantly via SSE.',
        'For SVG: write complete <svg> markup. For HTML: write any HTML fragment (inline styles, inline SVG, etc).',
        'History is preserved — the user can click back to previous whiteboard states.',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        required: ['content', 'title'],
        properties: {
          content: { type: 'string', description: 'SVG markup (starting with <svg) or HTML fragment to render' },
          title: { type: 'string', description: 'Short title for this whiteboard update (shown in history bar)' },
          format: { type: 'string', enum: ['svg', 'html'], default: 'svg', description: 'Content format. Auto-detected from content if omitted.' },
        },
      },
    },
  ];
}

function jsonRpcOk(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcErr(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleToolCall(name, args, baseUrl) {
  switch (name) {
    case 'publish_artifact': {
      const { source, title, format = 'jsx', slug: customSlug, libraries = [], description = '' } = args;

      if (!source || !source.trim()) {
        return { content: [{ type: 'text', text: 'Error: source is empty. Provide JSX or HTML content.' }], isError: true };
      }

      const datePrefix = new Date().toISOString().slice(0, 10);
      const slug = customSlug || `${datePrefix}-${slugify(title)}`;

      let html;
      const t0 = Date.now();
      if (format === 'html') {
        html = source;
        console.log(`[publish] slug=${slug} format=html size=${Buffer.byteLength(source)}B`);
      } else {
        // Auto-detect libraries from source if none specified
        const effectiveLibs = libraries.length > 0 ? libraries : detectLibraries(source);
        console.log(`[publish] slug=${slug} format=jsx libs=[${effectiveLibs}] sourceSize=${Buffer.byteLength(source)}B`);

        // Compile JSX server-side (fail-fast on syntax errors)
        const { code, warnings } = await compileJsx(source);
        const compileMs = Date.now() - t0;
        console.log(`[publish] compiled in ${compileMs}ms → ${code.length}B JS`);
        if (warnings.length > 0) console.log(`[publish] warnings:`, warnings.map(w => w.text));

        html = buildHtml(code, title, effectiveLibs);
        console.log(`[publish] html=${html.length}B hasRequire=${html.includes('require("react")')} hasExport=${html.includes('module.exports')}`);
      }

      const meta = await saveArtifact(slug, html, {
        title, format, description, libraries,
        sourceSize: Buffer.byteLength(source, 'utf-8'),
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            url: `${baseUrl}/artifacts/${slug}.html`,
            title, slug, format,
            size_kb: Math.round(meta.htmlSize / 1024),
            created: meta.created,
          }, null, 2),
        }],
      };
    }

    case 'list_artifacts': {
      const artifacts = await listArtifacts(baseUrl);
      return { content: [{ type: 'text', text: JSON.stringify(artifacts, null, 2) }] };
    }

    case 'get_artifact': {
      const artifact = await getArtifact(args.slug, baseUrl);
      if (!artifact) return { content: [{ type: 'text', text: `Artifact "${args.slug}" not found` }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(artifact, null, 2) }] };
    }

    case 'delete_artifact': {
      const deleted = await deleteArtifact(args.slug);
      if (!deleted) return { content: [{ type: 'text', text: `Artifact "${args.slug}" not found` }], isError: true };
      return { content: [{ type: 'text', text: `Deleted artifact "${args.slug}"` }] };
    }

    case 'write_whiteboard': {
      const { content, title } = args;
      if (!content || !content.trim()) {
        return { content: [{ type: 'text', text: 'Error: content is empty. Provide SVG or HTML markup.' }], isError: true };
      }
      const format = args.format || (content.trimStart().startsWith('<svg') ? 'svg' : 'html');
      const clientCount = broadcastWhiteboard(content, title, format);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            whiteboard_url: `${baseUrl}/whiteboard`,
            title,
            format,
            content_size_bytes: Buffer.byteLength(content, 'utf-8'),
            clients_updated: clientCount,
          }, null, 2),
        }],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

// ── Session tracking (lightweight, survives proxy reconnects) ──────────
const sessions = new Map();

export function handleMcp(app, baseUrl) {
  app.post('/mcp', async (req, res) => {
    try {
      const { jsonrpc, id, method, params } = req.body;

      if (jsonrpc !== '2.0') {
        return res.json(jsonRpcErr(id, -32600, 'Invalid JSON-RPC version'));
      }

      switch (method) {
        case 'initialize': {
          const newSessionId = `mcp-session-${randomUUID()}`;
          sessions.set(newSessionId, { created: Date.now() });
          res.setHeader('mcp-session-id', newSessionId);
          return res.json(jsonRpcOk(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'artifact-server', version: '2.0.0' },
          }));
        }

        case 'notifications/initialized':
          return res.status(202).end();

        case 'tools/list':
          return res.json(jsonRpcOk(id, { tools: getToolDefinitions() }));

        case 'tools/call': {
          const { name, arguments: toolArgs } = params;
          try {
            const result = await handleToolCall(name, toolArgs || {}, baseUrl);
            return res.json(jsonRpcOk(id, result));
          } catch (err) {
            // Compilation errors, etc. — return as tool error, not protocol error
            return res.json(jsonRpcOk(id, {
              content: [{ type: 'text', text: `Error: ${err.message}` }],
              isError: true,
            }));
          }
        }

        case 'ping':
          return res.json(jsonRpcOk(id, {}));

        default:
          return res.json(jsonRpcErr(id, -32601, `Method not found: ${method}`));
      }
    } catch (error) {
      console.error('MCP error:', error);
      if (!res.headersSent) {
        res.status(500).json(jsonRpcErr(null, -32603, 'Internal server error'));
      }
    }
  });

  // GET /mcp — 405 (no SSE, Streamable HTTP request/response only)
  // mcp-go handles 405 gracefully. Returning 200+JSON causes infinite retry.
  app.get('/mcp', (req, res) => {
    res.status(405).set('Allow', 'POST, DELETE').end();
  });

  // DELETE /mcp — session termination per spec
  app.delete('/mcp', (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
    }
    res.status(200).end();
  });
}
