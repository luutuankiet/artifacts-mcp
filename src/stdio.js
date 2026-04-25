#!/usr/bin/env node
/**
 * Stdio MCP entrypoint (v2.2).
 *
 * Reads newline-delimited JSON-RPC from stdin, dispatches to the SAME tool
 * handlers as the HTTP path (src/mcp.js exports getToolDefinitions and
 * handleToolCall), writes responses to stdout. Logging stays on stderr to
 * keep the JSON-RPC channel clean.
 *
 * Designed for mcpproxy-go's stdio upstream mode. Two ways to wire it up:
 *
 *   1. Local (source on the proxy host):
 *        command: ["node", "/path/to/artifact-server/src/stdio.js"]
 *        env:     { BASE_URL: "https://artifacts.kenluu.org" }
 *
 *   2. Remote (source on hetzner, proxy elsewhere):
 *        command: ["ssh", "-T", "root@hetzner",
 *                  "cd /root/dev/artifact-server && BASE_URL=https://artifacts.kenluu.org node src/stdio.js"]
 *
 * The stdio process writes to the SAME artifacts/ + .meta/ filesystem the
 * Docker HTTP server reads from — so persisted artifacts show up in the
 * gallery instantly. Live SSE broadcast doesn't go through this entrypoint;
 * use the HTTP server for /whiteboard live tabs.
 */
import { createInterface } from 'readline';
import { getToolDefinitions, handleToolCall } from './mcp.js';

const PROTOCOL_VERSION = '2025-03-26';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3333';

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
function ok(id, result) { return { jsonrpc: '2.0', id, result }; }
function err(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

async function dispatch(req) {
  const { id, method, params } = req;
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'artifact-server', version: '2.2.0', transport: 'stdio' },
      });
    case 'notifications/initialized':
      return null; // notification — no response
    case 'tools/list':
      return ok(id, { tools: getToolDefinitions() });
    case 'tools/call': {
      try {
        const { name, arguments: toolArgs } = params;
        const result = await handleToolCall(name, toolArgs || {}, BASE_URL);
        return ok(id, result);
      } catch (e) {
        return ok(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }
    case 'ping':
      return ok(id, {});
    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); }
  catch (e) { send(err(null, -32700, 'Parse error')); return; }
  try {
    const resp = await dispatch(req);
    if (resp) send(resp);
  } catch (e) {
    process.stderr.write(`[stdio] handler error: ${e.message}\n${e.stack || ''}\n`);
    send(err(req.id, -32603, 'Internal error'));
  }
});

rl.on('close', () => {
  process.stderr.write('[stdio] stdin closed, exiting\n');
  process.exit(0);
});

process.stderr.write(`[stdio] artifact-server v2.2.0 ready (BASE_URL=${BASE_URL})\n`);
