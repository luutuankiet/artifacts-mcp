import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { compileJsx, detectLibraries } from './compiler.js';
import { buildHtml, getAvailableLibraries } from './template.js';
import { saveArtifact, listArtifacts, getArtifact, deleteArtifact } from './storage.js';

function slugify(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

/**
 * Create and configure an McpServer instance with all artifact tools.
 * A fresh server is created per session (stateful mode).
 */
function createServer(baseUrl) {
  const availableLibs = getAvailableLibraries();

  const server = new McpServer(
    { name: 'artifact-server', version: '1.0.0' },
    { capabilities: { tools: { listChanged: false } } }
  );

  // ── publish_artifact ──────────────────────────────────────────────
  server.tool(
    'publish_artifact',
    `Publish JSX or HTML as a browsable artifact. Just write your React component — the server handles everything:\n` +
    `- React/hooks imports are auto-injected if missing\n` +
    `- Libraries (recharts, d3, lodash, etc.) are auto-detected from your code\n` +
    `- Default export is auto-added if you define a component named App or any PascalCase function\n` +
    `- JSX is compiled server-side with esbuild — syntax errors return immediately with line:col\n` +
    `Available libraries (auto-detected or manual): ${availableLibs.join(', ')}. Core libs (react, react-dom, tailwindcss) are always included.`,
    {
      source: z.string().describe('Complete JSX/TSX source code or raw HTML'),
      title: z.string().describe('Human-readable title for the artifact'),
      format: z.enum(['jsx', 'html']).default('jsx').describe('Source format. jsx = compile with esbuild+React. html = serve as-is.'),
      slug: z.string().optional().describe('Optional URL slug. Auto-generated from title if omitted.'),
      libraries: z.array(z.string()).default([]).describe(`Optional CDN libs to include (jsx only). Available: ${availableLibs.join(', ')}`),
      description: z.string().default('').describe('Optional description shown in gallery'),
    },
    async ({ source, title, format, slug: customSlug, libraries, description }) => {
      const datePrefix = new Date().toISOString().slice(0, 10);
      const slug = customSlug || `${datePrefix}-${slugify(title)}`;

      let html;
      if (format === 'html') {
        html = source;
      } else {
        // Auto-detect libraries from source if none specified
        const effectiveLibs = libraries.length > 0 ? libraries : detectLibraries(source);

        // Compile JSX → JS on the server (fail-fast on syntax errors)
        const { code } = await compileJsx(source);
        html = buildHtml(code, title, effectiveLibs);
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
  );

  // ── list_artifacts ────────────────────────────────────────────────
  server.tool(
    'list_artifacts',
    'List all published artifacts with metadata and URLs',
    {},
    async () => {
      const artifacts = await listArtifacts(baseUrl);
      return { content: [{ type: 'text', text: JSON.stringify(artifacts, null, 2) }] };
    }
  );

  // ── get_artifact ──────────────────────────────────────────────────
  server.tool(
    'get_artifact',
    'Get metadata and URL for a specific artifact by slug',
    { slug: z.string().describe('Artifact slug (filename without extension)') },
    async ({ slug }) => {
      const artifact = await getArtifact(slug, baseUrl);
      if (!artifact) {
        return { content: [{ type: 'text', text: `Artifact "${slug}" not found` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(artifact, null, 2) }] };
    }
  );

  // ── delete_artifact ───────────────────────────────────────────────
  server.tool(
    'delete_artifact',
    'Delete an artifact by slug',
    { slug: z.string().describe('Artifact slug to delete') },
    async ({ slug }) => {
      const deleted = await deleteArtifact(slug);
      if (!deleted) {
        return { content: [{ type: 'text', text: `Artifact "${slug}" not found` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Deleted artifact "${slug}"` }] };
    }
  );

  return server;
}

// ── Session management ────────────────────────────────────────────────
const transports = {};

export function handleMcp(app, baseUrl) {
  app.post('/mcp', async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'];
      let transport;

      if (sessionId && transports[sessionId]) {
        // Reuse existing session transport
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New session — create transport + server
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            transports[id] = transport;
          },
        });

        transport.onclose = () => {
          const id = transport.sessionId;
          if (id && transports[id]) delete transports[id];
        };

        const server = createServer(baseUrl);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // GET /mcp — 405 (no SSE support)
  app.get('/mcp', (req, res) => {
    res.status(405).set('Allow', 'POST, DELETE').end();
  });

  // DELETE /mcp — session termination
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId && transports[sessionId]) {
      const transport = transports[sessionId];
      await transport.close();
      delete transports[sessionId];
    }
    res.status(200).end();
  });
}
