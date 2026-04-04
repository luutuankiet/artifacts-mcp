import { randomUUID } from 'crypto';
import { compileJsx, detectLibraries } from './compiler.js';
import { buildHtml, getAvailableLibraries, getLibsManifest } from './template.js';
import { saveArtifact, listArtifacts, getArtifact, deleteArtifact, saveSource, getSource } from './storage.js';
import { broadcastWhiteboard } from './whiteboard.js';
import { validateArtifact, checkLibraryHealth } from './validator.js';

// Validation always uses internal URL (bypasses Traefik auth)
const INTERNAL_URL = `http://localhost:${process.env.PORT || 3333}`;

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
        'Publish JSX or HTML as a browsable artifact. Just write your React component \u2014 the server handles everything:',
        '- React/hooks imports are auto-injected if missing',
        '- Libraries (recharts, d3, lodash, etc.) are auto-detected from your code',
        '- Default export is auto-added if you define a component named App or any PascalCase function',
        '- JSX is compiled server-side with esbuild \u2014 syntax errors return immediately with line:col',
        '- **Validation gate**: after compilation, the artifact is loaded in headless Chromium to verify it renders correctly. Blank screens and runtime errors are caught before the URL is returned.',
        '- **Source stored**: the raw source is saved server-side. If validation fails, use patch_artifact to fix errors without resending the full source.',
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
      name: 'patch_artifact',
      description: [
        'Apply surgical patches to a previously published artifact without resending the full source.',
        'Use this after publish_artifact returns a validation error. The server stores the original source',
        'and applies your text-based patches, then recompiles and revalidates.',
        'Each patch finds exact text in the source and replaces it. Use for fixing specific errors',
        'without retransmitting the entire artifact (saves tokens on large artifacts).',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        required: ['slug', 'patches'],
        properties: {
          slug: { type: 'string', description: 'Artifact slug from the original publish_artifact response' },
          patches: {
            type: 'array',
            items: {
              type: 'object',
              required: ['search', 'replace'],
              properties: {
                search: { type: 'string', description: 'Exact text to find in the stored source' },
                replace: { type: 'string', description: 'Replacement text' },
              },
            },
            description: 'Array of search-and-replace patches to apply to the stored source',
          },
        },
      },
    },
    {
      name: 'validate_artifact',
      description: 'Validate a published artifact by loading it in headless Chromium. Returns render status, errors, and DOM state. Use to check if an existing artifact renders correctly.',
      inputSchema: {
        type: 'object',
        required: ['slug'],
        properties: { slug: { type: 'string', description: 'Artifact slug to validate' } },
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
        'Push SVG or HTML to the live whiteboard. Content renders instantly in any connected browser \u2014 zero compilation, zero page reload.',
        'Best for: diagrams, flowcharts, architecture visuals, data visualizations, any visual explanation.',
        'The user opens /whiteboard in a browser tab once. Every call to this tool updates that tab instantly via SSE.',
        'For SVG: write complete <svg> markup. For HTML: write any HTML fragment (inline styles, inline SVG, etc).',
        'History is preserved \u2014 the user can click back to previous whiteboard states.',
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
      let effectiveLibs = libraries;
      const t0 = Date.now();

      if (format === 'html') {
        html = source;
        console.log(`[publish] slug=${slug} format=html size=${Buffer.byteLength(source)}B`);
      } else {
        effectiveLibs = libraries.length > 0 ? libraries : detectLibraries(source);

        // Pre-flight: check library health before wasting compile + validation time
        const libHealth = checkLibraryHealth(effectiveLibs, getLibsManifest());
        if (libHealth.blocked.length > 0) {
          const issues = libHealth.blocked.map(b => {
            let msg = `"${b.lib}": ${b.reason}`;
            if (b.workaround) msg += `\n  Workaround: ${b.workaround}`;
            if (b.alternative) msg += `\n  Alternative library: ${b.alternative}`;
            return msg;
          }).join('\n\n');
          console.log(`[publish] BLOCKED by library health: ${libHealth.blocked.map(b => b.lib).join(', ')}`);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'library_health_check_failed',
                blocked_libraries: libHealth.blocked,
                message: `The following libraries have known issues that will cause blank screens:\n\n${issues}`,
                source_stored: false,
                suggestion: 'Remove the broken library from your code and use the workaround, or specify an alternative library.',
              }, null, 2),
            }],
            isError: true,
          };
        }

        console.log(`[publish] slug=${slug} format=jsx libs=[${effectiveLibs}] sourceSize=${Buffer.byteLength(source)}B`);

        const { code, warnings } = await compileJsx(source);
        const compileMs = Date.now() - t0;
        console.log(`[publish] compiled in ${compileMs}ms, ${code.length}B JS`);
        if (warnings.length > 0) console.log(`[publish] warnings:`, warnings.map(w => w.text));

        html = buildHtml(code, title, effectiveLibs);
        console.log(`[publish] html=${html.length}B hasRequire=${html.includes('require("react")')} hasExport=${html.includes('module.exports')}`);
      }

      // Save artifact + store source for patch_artifact
      const meta = await saveArtifact(slug, html, {
        title, format, description, libraries: effectiveLibs,
        sourceSize: Buffer.byteLength(source, 'utf-8'),
      });
      await saveSource(slug, source);

      // Validation gate: headless Chromium render check
      // Uses internal URL to bypass Traefik auth
      let validation;
      try {
        validation = await validateArtifact(slug, INTERNAL_URL);
      } catch (valErr) {
        console.error(`[publish] Validation crashed for slug=${slug}:`, valErr.message);
        // If validator itself crashes, still return URL but flag as unvalidated
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              url: `${baseUrl}/artifacts/${slug}.html`,
              title, slug, format,
              size_kb: Math.round(meta.htmlSize / 1024),
              created: meta.created,
              validated: false,
              validation_error: `Validator crashed: ${valErr.message}`,
            }, null, 2),
          }],
        };
      }

      if (!validation.ok) {
        console.log(`[publish] VALIDATION FAILED slug=${slug} errors=${JSON.stringify(validation.errors)}`);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'validation_failed',
              url: `${baseUrl}/artifacts/${slug}.html`,
              slug,
              title,
              validation_errors: validation.errors,
              console_errors: validation.consoleErrors,
              root_state: validation.rootState,
              validation_ms: validation.elapsed_ms,
              source_stored: true,
              message: 'Artifact was saved but failed browser validation. Use patch_artifact to fix errors without resending full source.',
              hint: buildErrorHint(validation),
            }, null, 2),
          }],
          isError: true,
        };
      }

      console.log(`[publish] VALIDATED slug=${slug} in ${validation.elapsed_ms}ms`);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            url: `${baseUrl}/artifacts/${slug}.html`,
            title, slug, format,
            size_kb: Math.round(meta.htmlSize / 1024),
            created: meta.created,
            validated: true,
            validation_ms: validation.elapsed_ms,
          }, null, 2),
        }],
      };
    }

    case 'patch_artifact': {
      const { slug, patches } = args;
      if (!slug || !patches || patches.length === 0) {
        return { content: [{ type: 'text', text: 'Error: slug and patches[] are required.' }], isError: true };
      }

      const storedSource = await getSource(slug);
      if (!storedSource) {
        return { content: [{ type: 'text', text: `No stored source for "${slug}". Only artifacts published with v2.1+ have stored source.` }], isError: true };
      }

      // Apply patches sequentially
      let patched = storedSource;
      const applied = [];
      const failed = [];
      for (const patch of patches) {
        if (patched.includes(patch.search)) {
          patched = patched.replace(patch.search, patch.replace);
          applied.push(patch.search.slice(0, 80));
        } else {
          failed.push({ search: patch.search.slice(0, 80), reason: 'Text not found in source' });
        }
      }

      if (failed.length > 0 && applied.length === 0) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'no_patches_applied', failed }, null, 2) }],
          isError: true,
        };
      }

      // Get existing meta to preserve title, description, etc.
      const existing = await getArtifact(slug, baseUrl);
      const title = existing?.title || slug;
      const existingLibs = existing?.libraries || [];
      const effectiveLibs = existingLibs.length > 0 ? existingLibs : detectLibraries(patched);

      // Pre-flight library health on patched source
      const libHealth = checkLibraryHealth(effectiveLibs, getLibsManifest());
      if (libHealth.blocked.length > 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'library_health_check_failed',
              blocked_libraries: libHealth.blocked,
              patches_applied: applied,
              source_stored: true,
              suggestion: 'Your patches were applied but the artifact still uses a broken library. Patch the library usage out.',
            }, null, 2),
          }],
          isError: true,
        };
      }

      // Recompile
      const { code, warnings } = await compileJsx(patched);
      const html = buildHtml(code, title, effectiveLibs);

      // Save updated artifact + source
      const meta = await saveArtifact(slug, html, {
        title,
        format: 'jsx',
        description: existing?.description || '',
        libraries: effectiveLibs,
        sourceSize: Buffer.byteLength(patched, 'utf-8'),
        patched_from: patches.length,
      });
      await saveSource(slug, patched);

      // Revalidate
      const validation = await validateArtifact(slug, INTERNAL_URL);

      if (!validation.ok) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'validation_failed_after_patch',
              url: `${baseUrl}/artifacts/${slug}.html`,
              slug,
              patches_applied: applied,
              patches_failed: failed,
              validation_errors: validation.errors,
              console_errors: validation.consoleErrors,
              source_stored: true,
              hint: buildErrorHint(validation),
            }, null, 2),
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            url: `${baseUrl}/artifacts/${slug}.html`,
            slug,
            patches_applied: applied,
            patches_failed: failed,
            validated: true,
            validation_ms: validation.elapsed_ms,
            size_kb: Math.round(meta.htmlSize / 1024),
          }, null, 2),
        }],
      };
    }

    case 'validate_artifact': {
      const validation = await validateArtifact(args.slug, INTERNAL_URL);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(validation, null, 2),
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

/**
 * Build a human/LLM-readable hint from validation results.
 * Designed to give MCP clients (AI agents) actionable guidance.
 */
function buildErrorHint(validation) {
  const hints = [];

  for (const err of validation.errors) {
    if (err.type === 'pageerror') {
      if (err.message.includes('forwardRef') || err.message.includes('is not defined')) {
        hints.push('A library failed to load (likely UMD incompatibility). Check if the library works as a standalone CDN script. Consider using inline implementations or an alternative library.');
      } else if (err.message.includes('SyntaxError')) {
        hints.push('JavaScript syntax error in compiled output. Check for template literal escaping issues or malformed JSX.');
      } else if (err.message.includes('is not a function')) {
        hints.push('A function call failed \u2014 likely a missing or incorrectly mapped library export. Check require() shim mappings.');
      } else {
        hints.push(`Runtime error: ${err.message.slice(0, 200)}`);
      }
    } else if (err.type === 'dom' && err.message.includes('Blank screen')) {
      hints.push('Component did not render. Possible causes: (1) no default export found, (2) a script error prevented React mount, (3) a CDN library failed to load.');
    } else if (err.type === 'render') {
      hints.push(`React render error displayed: ${err.message?.slice(0, 200)}`);
    }
  }

  for (const ce of validation.consoleErrors || []) {
    if (ce.includes('require(') && ce.includes('no CDN global')) {
      const match = ce.match(/require\("([^"]+)"\)/);
      if (match) hints.push(`Missing CDN mapping for "${match[1]}". This module is not available via CDN \u2014 use inline implementation.`);
    }
  }

  return hints.length > 0 ? hints.join(' | ') : 'Unknown validation failure \u2014 check errors array for details.';
}

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
            serverInfo: { name: 'artifact-server', version: '2.1.0' },
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

  app.get('/mcp', (req, res) => {
    res.status(405).set('Allow', 'POST, DELETE').end();
  });

  app.delete('/mcp', (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
    }
    res.status(200).end();
  });
}
