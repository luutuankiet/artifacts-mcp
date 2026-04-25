#!/usr/bin/env node
/**
 * Stdio entrypoint smoke test.
 * Spawns src/stdio.js, sends initialize + tools/list + a mermaid write_whiteboard,
 * verifies persistence + validation. Logs result + exit code.
 */
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stdioPath = resolve(__dirname, '..', 'src', 'stdio.js');

const child = spawn('node', [stdioPath], {
  env: { ...process.env, BASE_URL: 'http://localhost:3333' },
});

let out = '';
child.stdout.on('data', c => { out += c.toString(); });
child.stderr.on('data', c => { process.stderr.write(`[child] ${c}`); });

function send(obj) { child.stdin.write(JSON.stringify(obj) + '\n'); }
const delay = ms => new Promise(r => setTimeout(r, ms));

const results = {};

try {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stdio-smoke' } } });
  await delay(200);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await delay(50);
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  await delay(200);
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'write_whiteboard', arguments: { content: 'graph TD\n  S[Stdio] --> T[Test]\n  T --> P[Pass]', title: 'stdio smoke v221', slug: 'stdio-smoke-v221' } } });
  await delay(5500);
  child.kill();
  await delay(100);

  const lines = out.split('\n').filter(Boolean);
  let failed = false;
  for (const l of lines) {
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    if (r.id === 1) {
      results.initialize = r.result?.serverInfo;
      if (r.result?.serverInfo?.transport !== 'stdio') failed = true;
    } else if (r.id === 2) {
      const names = (r.result?.tools || []).map(t => t.name).sort();
      results.tools = names;
      if (names.length !== 8) failed = true;
    } else if (r.id === 3) {
      try {
        const t = JSON.parse(r.result?.content?.[0]?.text || '{}');
        results.write_whiteboard = t;
        if (!t.validated) failed = true;
        if (t.format !== 'mermaid') failed = true;
        if (!t.url || !t.url.includes('stdio-smoke-v221')) failed = true;
      } catch (e) {
        results.write_whiteboard = { _raw: r.result?.content?.[0]?.text };
        failed = true;
      }
    }
  }

  console.log(JSON.stringify(results, null, 2));
  console.log(failed ? '\nFAIL' : '\nPASS');
  process.exit(failed ? 1 : 0);
} catch (e) {
  console.error('Harness error:', e);
  child.kill();
  process.exit(2);
}
