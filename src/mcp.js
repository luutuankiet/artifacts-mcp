import { randomUUID } from 'crypto';
import { buildJsxHtml, getAvailableLibraries } from './template.js';
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
      description: `Publish JSX or HTML as a browsable artifact. Available libraries (JSX mode): ${availableLibs.join(', ')}. Core libs (react, react-dom, tailwindcss) are always included.`,
      inputSchema: {
        type: 'object',
        required: ['source', 'title'],
        properties: {
          source: { type: 'string', description: 'Complete JSX/TSX source code or raw HTML' },
          title: { type: 'string', description: 'Human-readable title for the artifact' },
          format: { type: 'string', enum: ['jsx', 'html'], default: 'jsx', description: 'Source format. jsx = compile with Babel+React client-side. html = serve as-is.' },
          slug: { type: 'string', description: 'Optional URL slug. Auto-generated from title if omitted.' },
          libraries: { type: 'array', items: { type: 'string' }, description: `Optional CDN libs to include (jsx only). Available: ${availableLibs.join(', ')}` },
          description: { type: 'string', description: 'Optional description shown in gallery' }
        }
      }
    },
    {
      name: 'list_artifacts',
      description: 'List all published artifacts with metadata and URLs',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_artifact',
      description: 'Get metadata and URL for a specific artifact by slug',
      inputSchema: {
        type: 'object',
        required: ['slug'],
        properties: {
          slug: { type: 'string', description: 'Artifact slug (filename without extension)' }
        }
      }
    },
    {
      name: 'delete_artifact',
      description: 'Delete an artifact by slug',
      inputSchema: {
        type: 'object',
        required: ['slug'],
        properties: {
          slug: { type: 'string', description: 'Artifact slug to delete' }
        }
      }
    }
  ];
}

function makeJsonRpcResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function makeJsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleToolCall(name, args, baseUrl) {
  switch (name) {
    case 'publish_artifact': {
      const { source, title, format = 'jsx', slug: customSlug, libraries = [], description = '' } = args;
      const datePrefix = new Date().toISOString().slice(0, 10);
      const slug = customSlug || `${datePrefix}-${slugify(title)}`;

      let html;
      if (format === 'html') {
        html = source;
      } else {
        html = buildJsxHtml(source, title, libraries);
      }

      const meta = await saveArtifact(slug, html, {
        title,
        format,
        description,
        libraries,
        sourceSize: Buffer.byteLength(source, 'utf-8'),
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            url: `${baseUrl}/artifacts/${slug}.html`,
            title,
            slug,
            format,
            size_kb: Math.round(meta.htmlSize / 1024),
            created: meta.created,
          }, null, 2)
        }]
      };
    }

    case 'list_artifacts': {
      const artifacts = await listArtifacts(baseUrl);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(artifacts, null, 2)
        }]
      };
    }

    case 'get_artifact': {
      const artifact = await getArtifact(args.slug, baseUrl);
      if (!artifact) {
        return { content: [{ type: 'text', text: `Artifact "${args.slug}" not found` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(artifact, null, 2) }] };
    }

    case 'delete_artifact': {
      const deleted = await deleteArtifact(args.slug);
      if (!deleted) {
        return { content: [{ type: 'text', text: `Artifact "${args.slug}" not found` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Deleted artifact "${args.slug}"` }] };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

const sessions = new Map();

export function handleMcp(app, baseUrl) {
  // Auth handled by Traefik basicauth - no app-level key check
  app.post('/mcp', (req, res) => {

    const { jsonrpc, id, method, params } = req.body;

    if (jsonrpc !== '2.0') {
      return res.json(makeJsonRpcError(id, -32600, 'Invalid JSON-RPC version'));
    }

    const sessionId = req.headers['mcp-session-id'];

    switch (method) {
      case 'initialize': {
        const newSessionId = `mcp-session-${randomUUID()}`;
        sessions.set(newSessionId, { created: Date.now() });
        res.setHeader('mcp-session-id', newSessionId);
        return res.json(makeJsonRpcResponse(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'artifact-server', version: '1.0.0' }
        }));
      }

      case 'notifications/initialized':
        return res.status(202).end();

      case 'tools/list':
        return res.json(makeJsonRpcResponse(id, {
          tools: getToolDefinitions()
        }));

      case 'tools/call': {
        const { name, arguments: toolArgs } = params;
        handleToolCall(name, toolArgs || {}, baseUrl)
          .then(result => res.json(makeJsonRpcResponse(id, result)))
          .catch(err => res.json(makeJsonRpcError(id, -32603, err.message)));
        return;
      }

      case 'ping':
        return res.json(makeJsonRpcResponse(id, {}));

      default:
        return res.json(makeJsonRpcError(id, -32601, `Method not found: ${method}`));
    }
  });

  // Handle GET for SSE (not needed for Streamable HTTP request/response, but some clients probe)
  // Streamable HTTP spec: GET is for SSE session establishment.
  // Server MUST return 405 if it doesn't support server-initiated messages.
  // mcp-go handles 405 gracefully (stops GET listener). Returning 200+JSON
  // causes mcp-go to loop forever expecting SSE stream.
  app.get('/mcp', (req, res) => {
    res.status(405).set('Allow', 'POST, DELETE').end();
  });

  // Handle DELETE for session termination per spec
  app.delete('/mcp', (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
    }
    res.status(200).end();
  });
}
