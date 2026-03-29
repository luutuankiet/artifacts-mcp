import { randomUUID } from 'crypto';
import { compileJsx, detectLibraries } from './compiler.js';
import { buildHtml, getAvailableLibraries } from './template.js';
import { saveArtifact, listArtifacts, getArtifact, deleteArtifact } from './storage.js';

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
      if (format === 'html') {
        html = source;
      } else {
        // Auto-detect libraries from source if none specified
        const effectiveLibs = libraries.length > 0 ? libraries : detectLibraries(source);
        // Compile JSX server-side (fail-fast on syntax errors)
        const { code } = await compileJsx(source);
        html = buildHtml(code, title, effectiveLibs);
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
