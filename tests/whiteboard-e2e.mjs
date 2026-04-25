#!/usr/bin/env node
/**
 * E2E Test Suite for Whiteboard feature
 *
 * Tests: MCP tool registration, SSE connectivity, content push,
 *        format auto-detection, history, error handling.
 *
 * Usage:
 *   node tests/whiteboard-e2e.mjs
 *   ARTIFACT_HOST=domain.com ARTIFACT_AUTH=u:p node tests/whiteboard-e2e.mjs
 */

import http from 'http';
import https from 'https';

const BASE = process.env.ARTIFACT_HOST || 'localhost:3333';
const PROTOCOL = BASE.includes('localhost') ? 'http' : 'https';
const AUTH = process.env.ARTIFACT_AUTH || '';

let sessionId = null;
let reqId = 0;

// ── HTTP helpers ──────────────────────────────────────────────────────
function request(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const mod = PROTOCOL === 'https' ? https : http;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...extraHeaders,
    };
    if (AUTH) headers['Authorization'] = 'Basic ' + Buffer.from(AUTH).toString('base64');
    if (sessionId) headers['mcp-session-id'] = sessionId;

    let data;
    if (body) {
      data = JSON.stringify(body);
      headers['Content-Length'] = Buffer.byteLength(data);
    }

    const [hostname, port] = BASE.split(':');
    const req = mod.request({
      hostname,
      port: port || (PROTOCOL === 'https' ? 443 : 80),
      path,
      method,
      headers,
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        if (!sessionId && res.headers['mcp-session-id']) {
          sessionId = res.headers['mcp-session-id'];
        }
        resolve({ status: res.statusCode, headers: res.headers, body: b });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function post(path, body) { return request('POST', path, body); }
function get(path) { return request('GET', path); }

function mcpCall(method, params = {}) {
  return post('/mcp', { jsonrpc: '2.0', id: ++reqId, method, params });
}

/**
 * Connect to SSE endpoint, collect events, return controller.
 * @returns {{ events: Array, close: Function, waitForEvent: Function }}
 */
function connectSSE() {
  return new Promise((resolve, reject) => {
    const mod = PROTOCOL === 'https' ? https : http;
    const headers = { 'Accept': 'text/event-stream' };
    if (AUTH) headers['Authorization'] = 'Basic ' + Buffer.from(AUTH).toString('base64');
    const [hostname, port] = BASE.split(':');

    const req = mod.get({
      hostname,
      port: port || (PROTOCOL === 'https' ? 443 : 80),
      path: '/whiteboard/events',
      headers,
    }, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE status ${res.statusCode}`));
        return;
      }

      const events = [];
      let buf = '';
      const waiters = [];

      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop(); // keep incomplete line
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              events.push(data);
              // Resolve any waiters
              for (let i = waiters.length - 1; i >= 0; i--) {
                if (waiters[i].check(data)) {
                  waiters[i].resolve(data);
                  waiters.splice(i, 1);
                }
              }
            } catch {}
          }
        }
      });

      const controller = {
        events,
        close: () => { req.destroy(); },
        waitForEvent: (check, timeoutMs = 5000) => {
          // Check existing events first
          const existing = events.find(check);
          if (existing) return Promise.resolve(existing);
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              rej(new Error(`SSE event timeout after ${timeoutMs}ms (got ${events.length} events)`));
            }, timeoutMs);
            waiters.push({
              check,
              resolve: (data) => { clearTimeout(timer); res(data); },
            });
          });
        },
      };

      // Wait for initial connected event
      const initCheck = setInterval(() => {
        if (events.some(e => e.type === 'connected')) {
          clearInterval(initCheck);
          resolve(controller);
        }
      }, 50);

      setTimeout(() => {
        clearInterval(initCheck);
        if (events.length === 0) reject(new Error('SSE: no initial event'));
        else resolve(controller);
      }, 3000);
    });
    req.on('error', reject);
  });
}

// ── Test harness ──────────────────────────────────────────────────────
const results = [];

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms });
    console.log(`  \x1b[32m\u2705 ${name}\x1b[0m (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ name, ok: false, ms, error: err.message });
    console.log(`  \x1b[31m\u274c ${name}\x1b[0m (${ms}ms)`);
    console.log(`     ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// ── Tests ─────────────────────────────────────────────────────────────
async function runTests() {
  console.log(`\n\x1b[1m=== Whiteboard E2E Test Suite ===\x1b[0m`);
  console.log(`Target: ${PROTOCOL}://${BASE}\n`);

  // ── 0. MCP Setup ──
  console.log('\x1b[1m0. MCP Connection\x1b[0m');

  await test('mcp-initialize', async () => {
    const res = await mcpCall('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'whiteboard-e2e', version: '1.0' },
    });
    assert(res.status === 200, `Status ${res.status}`);
    const r = JSON.parse(res.body);
    assert(r.result?.serverInfo?.name === 'artifact-server', 'Wrong server name');
    await mcpCall('notifications/initialized', {});
  });

  await test('tools-list-includes-write_whiteboard', async () => {
    const res = await mcpCall('tools/list');
    const tools = JSON.parse(res.body).result?.tools || [];
    const wb = tools.find(t => t.name === 'write_whiteboard');
    assert(wb, `write_whiteboard not in tools list (got: ${tools.map(t=>t.name).join(', ')})`);
    assert(wb.inputSchema.required.includes('content'), 'Missing required: content');
    assert(wb.inputSchema.required.includes('title'), 'Missing required: title');
    assert(wb.inputSchema.properties.format, 'Missing format property');
  });

  // ── 1. Whiteboard Page ──
  console.log('\n\x1b[1m1. Whiteboard Page\x1b[0m');

  await test('whiteboard-page-serves-html', async () => {
    const res = await get('/whiteboard');
    assert(res.status === 200, `Status ${res.status}`);
    assert(res.body.includes('Whiteboard'), 'Missing title');
    assert(res.body.includes('EventSource'), 'Missing SSE client code');
    assert(res.body.includes('/whiteboard/events'), 'Missing SSE endpoint reference');
    assert(res.body.includes('write_whiteboard'), 'Missing tool name reference');
  });

  await test('whiteboard-status-endpoint', async () => {
    const res = await get('/whiteboard/status');
    assert(res.status === 200, `Status ${res.status}`);
    const data = JSON.parse(res.body);
    assert(typeof data.clients === 'number', 'Missing clients count');
  });

  // ── 2. SSE Connectivity ──
  console.log('\n\x1b[1m2. SSE Connectivity\x1b[0m');

  let sseClient;

  await test('sse-connect-receives-initial-event', async () => {
    sseClient = await connectSSE();
    const connected = sseClient.events.find(e => e.type === 'connected');
    assert(connected, 'No connected event received');
    assert(connected.timestamp, 'Connected event missing timestamp');
  });

  await test('sse-client-count-increments', async () => {
    const res = await get('/whiteboard/status');
    const data = JSON.parse(res.body);
    assert(data.clients >= 1, `Expected >= 1 client, got ${data.clients}`);
  });

  // ── 3. Write Whiteboard (SVG) ──
  console.log('\n\x1b[1m3. Write Whiteboard — SVG\x1b[0m');

  const testSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect x="10" y="10" width="380" height="180" rx="12" fill="#1e293b" stroke="#3b82f6" stroke-width="2"/><text x="200" y="105" text-anchor="middle" fill="white" font-size="24" font-family="sans-serif">Whiteboard Test</text></svg>';

  await test('write-whiteboard-svg-via-mcp', async () => {
    const res = await mcpCall('tools/call', {
      name: 'write_whiteboard',
      arguments: { content: testSvg, title: 'SVG Test Diagram' },
    });
    const result = JSON.parse(res.body).result;
    assert(!result.isError, `Tool error: ${result?.content?.[0]?.text}`);
    const data = JSON.parse(result.content[0].text);
    assert(data.whiteboard_url, 'Missing whiteboard_url');
    assert(data.format === 'svg', `Expected format svg, got ${data.format}`);
    assert(data.content_size_bytes > 0, 'Content size should be > 0');
    assert(data.title === 'SVG Test Diagram', `Title mismatch: ${data.title}`);
  });

  await test('sse-receives-svg-push', async () => {
    const event = await sseClient.waitForEvent(
      e => e.title === 'SVG Test Diagram',
      3000
    );
    assert(event.content.includes('<svg'), 'SSE payload missing SVG');
    assert(event.format === 'svg', `Format should be svg, got ${event.format}`);
    assert(event.timestamp, 'Missing timestamp');
  });

  // ── 4. Write Whiteboard (HTML) ──
  console.log('\n\x1b[1m4. Write Whiteboard — HTML\x1b[0m');

  const testHtml = '<div style="padding:2rem;font-family:sans-serif;background:#0f172a;color:white;min-height:200px;border-radius:12px;"><h1 style="color:#3b82f6;">Architecture Overview</h1><ul><li>Express server</li><li>esbuild compiler</li><li>SSE whiteboard</li></ul></div>';

  await test('write-whiteboard-html-via-mcp', async () => {
    const res = await mcpCall('tools/call', {
      name: 'write_whiteboard',
      arguments: { content: testHtml, title: 'HTML Overview' },
    });
    const result = JSON.parse(res.body).result;
    assert(!result.isError, `Tool error: ${result?.content?.[0]?.text}`);
    const data = JSON.parse(result.content[0].text);
    assert(data.format === 'html', `Expected format html, got ${data.format}`);
  });

  await test('sse-receives-html-push', async () => {
    const event = await sseClient.waitForEvent(
      e => e.title === 'HTML Overview',
      3000
    );
    assert(event.content.includes('Architecture Overview'), 'SSE payload missing content');
    assert(event.format === 'html', `Format should be html, got ${event.format}`);
  });

  // ── 5. Format Auto-Detection ──
  console.log('\n\x1b[1m5. Format Auto-Detection\x1b[0m');

  await test('auto-detect-svg-format', async () => {
    const res = await mcpCall('tools/call', {
      name: 'write_whiteboard',
      arguments: { content: '<svg><circle cx="50" cy="50" r="40" fill="red"/></svg>', title: 'Auto SVG' },
    });
    const data = JSON.parse(JSON.parse(res.body).result.content[0].text);
    assert(data.format === 'svg', `Expected auto-detected svg, got ${data.format}`);
  });

  await test('auto-detect-html-format', async () => {
    const res = await mcpCall('tools/call', {
      name: 'write_whiteboard',
      arguments: { content: '<div><h1>Hello</h1></div>', title: 'Auto HTML' },
    });
    const data = JSON.parse(JSON.parse(res.body).result.content[0].text);
    assert(data.format === 'html', `Expected auto-detected html, got ${data.format}`);
  });

  await test('explicit-format-overrides-autodetect', async () => {
    const res = await mcpCall('tools/call', {
      name: 'write_whiteboard',
      arguments: { content: '<svg><rect/></svg>', title: 'Force HTML', format: 'html' },
    });
    const data = JSON.parse(JSON.parse(res.body).result.content[0].text);
    assert(data.format === 'html', `Explicit format not honored, got ${data.format}`);
  });

  // ── 6. Error Handling ──
  console.log('\n\x1b[1m6. Error Handling\x1b[0m');

  await test('error-empty-content', async () => {
    const res = await mcpCall('tools/call', {
      name: 'write_whiteboard',
      arguments: { content: '', title: 'Empty' },
    });
    const result = JSON.parse(res.body).result;
    assert(result.isError === true, 'Empty content should return isError');
  });

  await test('error-whitespace-only-content', async () => {
    const res = await mcpCall('tools/call', {
      name: 'write_whiteboard',
      arguments: { content: '   \n  \n  ', title: 'Whitespace' },
    });
    const result = JSON.parse(res.body).result;
    assert(result.isError === true, 'Whitespace-only content should return isError');
  });

  // ── 7. Multiple Pushes (History) ──
  console.log('\n\x1b[1m7. Multiple Pushes (History)\x1b[0m');

  await test('multiple-pushes-all-received', async () => {
    // Count events before
    const before = sseClient.events.length;

    // Push 3 rapid updates
    for (let i = 0; i < 3; i++) {
      await mcpCall('tools/call', {
        name: 'write_whiteboard',
        arguments: {
          content: `<svg><text x="10" y="30" fill="white">Update ${i}</text></svg>`,
          title: `Rapid Update ${i}`,
        },
      });
    }

    // Wait for last one
    await sseClient.waitForEvent(e => e.title === 'Rapid Update 2', 3000);

    const after = sseClient.events.length;
    assert(after - before >= 3, `Expected >= 3 new events, got ${after - before}`);
  });

  // ── 8. Large Content ──
  console.log('\n\x1b[1m8. Large Content\x1b[0m');

  await test('large-svg-content', async () => {
    // Generate a large SVG with many elements
    const circles = Array.from({ length: 200 }, (_, i) =>
      `<circle cx="${(i % 20) * 20 + 10}" cy="${Math.floor(i / 20) * 20 + 10}" r="8" fill="hsl(${i * 1.8}, 70%, 50%)"/>`
    ).join('');
    const largeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">${circles}</svg>`;

    const res = await mcpCall('tools/call', {
      name: 'write_whiteboard',
      arguments: { content: largeSvg, title: 'Large SVG (200 circles)' },
    });
    const data = JSON.parse(JSON.parse(res.body).result.content[0].text);
    assert(data.content_size_bytes > 5000, `Expected large content, got ${data.content_size_bytes}B`);

    await sseClient.waitForEvent(e => e.title === 'Large SVG (200 circles)', 3000);
  });

  // ── 10. Persistence + Mermaid (v2.2) ──
  console.log('\n\x1b[1m10. Persistence + Mermaid (v2.2)\x1b[0m');

  const stamp = Date.now();
  let persistedSvgSlug, persistedMermaidSlug, brokenMermaidSlug, ephemeralCallCount = 0;

  await test('write_whiteboard-persists-by-default', async () => {
    const slug = `test-wb-svg-${stamp}`;
    const res = await mcpCall('tools/call', {
      name: 'write_whiteboard',
      arguments: {
        content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect x="10" y="10" width="180" height="80" fill="#1e40af"/><text x="100" y="55" text-anchor="middle" fill="white">PersistTest</text></svg>',
        title: 'Persist test SVG',
        slug,
      },
    });
    const result = JSON.parse(res.body).result;
    assert(!result.isError, `Tool error: ${result?.content?.[0]?.text}`);
    const data = JSON.parse(result.content[0].text);
    assert(data.persisted === true, `Expected persisted=true, got ${data.persisted}`);
    assert(data.validated === true, `Expected validated=true, got ${JSON.stringify(data.validation_errors || data)}`);
    assert(data.url && data.url.includes(slug), `Missing or wrong url: ${data.url}`);
    persistedSvgSlug = slug;
  });

  await test('persisted-whiteboard-appears-in-list_artifacts', async () => {
    const res = await mcpCall('tools/call', { name: 'list_artifacts', arguments: {} });
    const arr = JSON.parse(JSON.parse(res.body).result.content[0].text);
    const found = arr.find(a => a.slug === persistedSvgSlug);
    assert(found, `Persisted whiteboard ${persistedSvgSlug} missing from list_artifacts`);
    assert(found.type === 'whiteboard', `Expected type=whiteboard, got ${found.type}`);
    assert(found.whiteboardFormat === 'svg', `Expected whiteboardFormat=svg, got ${found.whiteboardFormat}`);
  });

  await test('persisted-whiteboard-viewer-renders', async () => {
    const res = await get(`/artifacts/${persistedSvgSlug}.html`);
    assert(res.status === 200, `Status ${res.status}`);
    assert(res.body.includes('wb-source'), 'Viewer missing wb-source script');
    assert(res.body.includes('PersistTest'), 'Viewer missing source content');
  });

  await test('mermaid-format-auto-detected', async () => {
    const slug = `test-wb-mermaid-${stamp}`;
    const res = await mcpCall('tools/call', {
      name: 'write_whiteboard',
      arguments: {
        content: 'graph TD\n  A[Start] --> B{Decide}\n  B -->|yes| C[End]\n  B -->|no| A',
        title: 'Mermaid auto-detect test',
        slug,
      },
    });
    const result = JSON.parse(res.body).result;
    assert(!result.isError, `Tool error: ${result?.content?.[0]?.text}`);
    const data = JSON.parse(result.content[0].text);
    assert(data.format === 'mermaid', `Expected format=mermaid, got ${data.format}`);
    assert(data.persisted === true, `Expected persisted=true`);
    assert(data.validated === true, `Mermaid render validation failed: ${JSON.stringify(data.validation_errors)}`);
    persistedMermaidSlug = slug;
  });

  await test('mermaid-viewer-loads-mermaid-cdn', async () => {
    const res = await get(`/artifacts/${persistedMermaidSlug}.html`);
    assert(res.status === 200, `Status ${res.status}`);
    assert(res.body.includes('mermaid'), 'Mermaid viewer missing mermaid CDN ref');
    assert(res.body.includes('mermaid.run'), 'Mermaid viewer missing mermaid.run() invocation');
  });

  await test('mermaid-syntax-error-fails-validation-and-stores-source', async () => {
    const slug = `test-wb-broken-${stamp}`;
    const res = await mcpCall('tools/call', {
      name: 'write_whiteboard',
      arguments: {
        content: 'graph TD\n  A --> B[Unclosed',  // missing closing bracket
        title: 'Broken mermaid',
        slug,
      },
    });
    const result = JSON.parse(res.body).result;
    assert(result.isError === true, `Expected isError=true on bad mermaid`);
    const data = JSON.parse(result.content[0].text);
    assert(data.error === 'validation_failed', `Expected validation_failed, got ${data.error}`);
    assert(data.source_stored === true, 'Source should still be stored on validation failure');
    assert(data.url && data.url.includes(slug), 'Should still return viewer url for inspection');
    brokenMermaidSlug = slug;
  });

  await test('patch_whiteboard-fixes-broken-mermaid', async () => {
    const res = await mcpCall('tools/call', {
      name: 'patch_whiteboard',
      arguments: {
        slug: brokenMermaidSlug,
        patches: [{ search: 'B[Unclosed', replace: 'B[Closed]' }],
      },
    });
    const result = JSON.parse(res.body).result;
    assert(!result.isError, `Patch error: ${result?.content?.[0]?.text}`);
    const data = JSON.parse(result.content[0].text);
    assert(data.validated === true, `Patch did not produce valid mermaid: ${JSON.stringify(data.validation_errors)}`);
    assert(data.patches_applied && data.patches_applied.length === 1, 'Expected 1 patch applied');
  });

  await test('persist-false-skips-gallery', async () => {
    const beforeRes = await mcpCall('tools/call', { name: 'list_artifacts', arguments: {} });
    const before = JSON.parse(JSON.parse(beforeRes.body).result.content[0].text).length;
    const res = await mcpCall('tools/call', {
      name: 'write_whiteboard',
      arguments: {
        content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="red"/></svg>',
        title: 'Ephemeral push',
        persist: false,
      },
    });
    const result = JSON.parse(res.body).result;
    assert(!result.isError, `Tool error: ${result?.content?.[0]?.text}`);
    const data = JSON.parse(result.content[0].text);
    assert(data.persisted === false, `Expected persisted=false, got ${data.persisted}`);
    assert(!data.url, 'Should not return permanent url for ephemeral push');
    assert(data.clients_updated >= 0, 'Should still report clients_updated');
    const afterRes = await mcpCall('tools/call', { name: 'list_artifacts', arguments: {} });
    const after = JSON.parse(JSON.parse(afterRes.body).result.content[0].text).length;
    assert(after === before, `Gallery size changed (${before} -> ${after}); ephemeral should not persist`);
    ephemeralCallCount++;
  });

  // Cleanup test artifacts so we don't pollute the gallery on repeated test runs
  await test('cleanup-test-whiteboards', async () => {
    const cleanupSlugs = [persistedSvgSlug, persistedMermaidSlug, brokenMermaidSlug].filter(Boolean);
    for (const slug of cleanupSlugs) {
      await mcpCall('tools/call', { name: 'delete_artifact', arguments: { slug } });
    }
    const res = await mcpCall('tools/call', { name: 'list_artifacts', arguments: {} });
    const arr = JSON.parse(JSON.parse(res.body).result.content[0].text);
    for (const slug of cleanupSlugs) {
      assert(!arr.find(a => a.slug === slug), `Cleanup failed for ${slug}`);
    }
  });

  // ── 9. SSE Disconnect & Reconnect ──
  console.log('\n\x1b[1m9. SSE Lifecycle\x1b[0m');

  await test('sse-client-count-after-disconnect', async () => {
    const before = JSON.parse((await get('/whiteboard/status')).body).clients;
    sseClient.close();
    // Give the server a moment to detect disconnect
    await new Promise(r => setTimeout(r, 200));
    const after = JSON.parse((await get('/whiteboard/status')).body).clients;
    assert(after < before, `Client count should decrease: ${before} -> ${after}`);
  });

  await test('sse-reconnect-gets-new-connected-event', async () => {
    sseClient = await connectSSE();
    const connected = sseClient.events.find(e => e.type === 'connected');
    assert(connected, 'Reconnect: no connected event');
    sseClient.close();
  });

  // ── Summary ──
  console.log('\n' + '='.repeat(60));
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m\u2705 ALL ${passed} TESTS PASSED\x1b[0m (${totalMs}ms total)`);
  } else {
    console.log(`\x1b[31m\x1b[1m\u274c ${failed}/${passed + failed} FAILED\x1b[0m (${totalMs}ms total)`);
    console.log('\nFailures:');
    for (const r of results.filter(r => !r.ok)) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Fatal:', e);
  process.exit(2);
});
