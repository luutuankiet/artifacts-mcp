#!/usr/bin/env node
/**
 * E2E Stress Test Suite for artifact-server v2.0
 * 
 * Tests the full pipeline: MCP endpoint → esbuild compilation → HTML serve
 * Covers: basic rendering, hooks, complex patterns, library integration,
 *         edge cases, error scenarios, HTML passthrough, metadata handling.
 *
 * Usage:
 *   node tests/e2e-stress.mjs                          # localhost:3333
 *   ARTIFACT_HOST=domain.com ARTIFACT_AUTH=u:p node tests/e2e-stress.mjs
 *   node tests/e2e-stress.mjs --keep                   # don't delete artifacts after
 */

import http from 'http';
import https from 'https';

const BASE = process.env.ARTIFACT_HOST || 'localhost:3333';
const PROTOCOL = BASE.includes('localhost') ? 'http' : 'https';
const AUTH = process.env.ARTIFACT_AUTH || '';
const KEEP = process.argv.includes('--keep');

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

async function publishArtifact(args) {
  const res = await mcpCall('tools/call', { name: 'publish_artifact', arguments: args });
  const result = JSON.parse(res.body);
  if (result.error) throw new Error(`MCP error: ${result.error.message}`);
  const content = result.result?.content?.[0];
  if (content?.type === 'text') {
    try { return JSON.parse(content.text); } catch { return { raw: content.text }; }
  }
  if (result.result?.isError) throw new Error(`Tool error: ${content?.text || 'unknown'}`);
  return result.result;
}

async function deleteArtifact(slug) {
  await mcpCall('tools/call', { name: 'delete_artifact', arguments: { slug } });
}

async function fetchHtml(url) {
  // Convert full URL to path for our request helper
  const path = new URL(url.replace(PROTOCOL + '://' + BASE, PROTOCOL + '://localhost')).pathname;
  const actualUrl = `${PROTOCOL}://${BASE}${path}`;
  const mod = PROTOCOL === 'https' ? https : http;
  return new Promise((resolve, reject) => {
    const headers = {};
    if (AUTH) headers['Authorization'] = 'Basic ' + Buffer.from(AUTH).toString('base64');
    const [hostname, port] = BASE.split(':');
    mod.get({ hostname, port: port || (PROTOCOL === 'https' ? 443 : 80), path, headers }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, html: b, size: b.length }));
    }).on('error', reject);
  });
}

// ── Test runner ───────────��───────────────────────────────────────────

const results = [];

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms });
    console.log(`  \x1b[32m✅ ${name}\x1b[0m (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ name, ok: false, ms, error: err.message });
    console.log(`  \x1b[31m❌ ${name}\x1b[0m (${ms}ms)`);
    console.log(`     ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

/** Publish, verify HTML, optionally cleanup */
async function publishAndVerify(name, args, checks = {}) {
  const slug = `stress-${name}`;
  const artifact = await publishArtifact({ ...args, slug });
  assert(artifact.url, 'No URL returned');
  assert(artifact.slug === slug, `Slug mismatch: ${artifact.slug}`);

  const { status, html, size } = await fetchHtml(artifact.url);
  assert(status === 200, `HTTP ${status} (expected 200)`);
  assert(size > 100, `HTML too small: ${size} bytes`);

  // Common checks for JSX artifacts
  if (args.format !== 'html') {
    assert(!html.includes('babel'), 'HTML contains Babel (should be server-compiled)');
    assert(html.includes('react@18'), 'Missing React CDN');
    assert(html.includes('window.require'), 'Missing require shim');
    assert(html.includes('_ArtifactComponent'), 'Missing auto-mount');
    assert(!html.includes('<script type="text/babel"'), 'Still using Babel script type');
    assert(html.includes('createElement'), 'No compiled React.createElement calls');
  }

  // Custom checks
  if (checks.htmlContains) {
    for (const s of checks.htmlContains) {
      assert(html.includes(s), `HTML missing: "${s.slice(0, 60)}"`);
    }
  }
  if (checks.htmlNotContains) {
    for (const s of checks.htmlNotContains) {
      assert(!html.includes(s), `HTML should not contain: "${s.slice(0, 60)}"`);
    }
  }
  if (checks.minSize) {
    assert(size >= checks.minSize, `HTML too small: ${size} < ${checks.minSize}`);
  }

  if (!KEEP) await deleteArtifact(slug);
  return { artifact, html, size };
}

// ── Test definitions ──────────────────────────────────────────────────

async function runTests() {
  console.log(`\n\x1b[1m=== E2E Stress Test Suite ===\x1b[0m`);
  console.log(`Target: ${PROTOCOL}://${BASE}`);
  console.log(`Cleanup: ${KEEP ? 'DISABLED (--keep)' : 'enabled'}\n`);

  // ── 0. Setup: MCP Initialize ──────────────────────────────────────
  console.log('\x1b[1m0. MCP Connection\x1b[0m');
  await test('mcp-initialize', async () => {
    const res = await mcpCall('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'e2e-stress', version: '2.0' },
    });
    assert(res.status === 200, `Status ${res.status}`);
    const r = JSON.parse(res.body);
    assert(r.result?.serverInfo?.name === 'artifact-server', 'Wrong server name');
    // Send initialized notification
    await mcpCall('notifications/initialized', {});
  });

  await test('mcp-tools-list', async () => {
    const res = await mcpCall('tools/list');
    const tools = JSON.parse(res.body).result?.tools || [];
    assert(tools.length === 4, `Expected 4 tools, got ${tools.length}`);
    const names = tools.map(t => t.name).sort();
    assert(names.join(',') === 'delete_artifact,get_artifact,list_artifacts,publish_artifact',
      `Wrong tools: ${names}`);
  });

  await test('mcp-get-405', async () => {
    const res = await get('/mcp');
    assert(res.status === 405, `Expected 405, got ${res.status}`);
  });

  // ── 1. Basic Rendering ─────────────────────────────────────────��──
  console.log('\n\x1b[1m1. Basic Rendering\x1b[0m');

  await test('basic-useState', async () => {
    await publishAndVerify('basic-usestate', {
      source: `function App() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}`,
      title: 'Basic useState',
    });
  });

  await test('basic-useEffect', async () => {
    await publishAndVerify('basic-useeffect', {
      source: `function App() {
  const [msg, setMsg] = useState('loading');
  useEffect(() => { setMsg('loaded'); return () => {}; }, []);
  return <div>{msg}</div>;
}`,
      title: 'Basic useEffect',
    });
  });

  await test('basic-useRef', async () => {
    await publishAndVerify('basic-useref', {
      source: `function App() {
  const ref = useRef(null);
  return <input ref={ref} placeholder="focused" />;
}`,
      title: 'Basic useRef',
    });
  });

  await test('basic-useMemo-useCallback', async () => {
    await publishAndVerify('basic-usememo', {
      source: `function App() {
  const [n, setN] = useState(0);
  const doubled = useMemo(() => n * 2, [n]);
  const increment = useCallback(() => setN(p => p + 1), []);
  return <div><span>{doubled}</span><button onClick={increment}>+</button></div>;
}`,
      title: 'useMemo + useCallback',
    });
  });

  await test('basic-multi-component', async () => {
    await publishAndVerify('basic-multi', {
      source: `function Badge({ text }) {
  return <span className="px-2 py-1 bg-blue-100 rounded">{text}</span>;
}
function App() {
  return <div><Badge text="hello" /><Badge text="world" /></div>;
}`,
      title: 'Multi-component',
    });
  });

  // ── 2. Complex Patterns ──────────────��────────────────────────────
  console.log('\n\x1b[1m2. Complex Patterns\x1b[0m');

  await test('complex-context', async () => {
    await publishAndVerify('complex-context', {
      source: `const ThemeContext = createContext('light');
function ThemeDisplay() {
  const theme = useContext(ThemeContext);
  return <div className={theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white'}>{theme}</div>;
}
function App() {
  const [theme, setTheme] = useState('light');
  return (
    <ThemeContext.Provider value={theme}>
      <ThemeDisplay />
      <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>Toggle</button>
    </ThemeContext.Provider>
  );
}`,
      title: 'Context Provider',
    });
  });

  await test('complex-useReducer', async () => {
    await publishAndVerify('complex-reducer', {
      source: `function reducer(state, action) {
  switch(action.type) {
    case 'inc': return { ...state, count: state.count + 1 };
    case 'dec': return { ...state, count: state.count - 1 };
    case 'reset': return { count: 0 };
    default: return state;
  }
}
function App() {
  const [state, dispatch] = useReducer(reducer, { count: 0 });
  return (
    <div>
      <span>{state.count}</span>
      <button onClick={() => dispatch({type:'inc'})}>+</button>
      <button onClick={() => dispatch({type:'dec'})}>-</button>
      <button onClick={() => dispatch({type:'reset'})}>Reset</button>
    </div>
  );
}`,
      title: 'useReducer',
    });
  });

  await test('complex-custom-hook', async () => {
    await publishAndVerify('complex-custom-hook', {
      source: `function useToggle(initial = false) {
  const [val, setVal] = useState(initial);
  const toggle = useCallback(() => setVal(v => !v), []);
  return [val, toggle];
}
function App() {
  const [on, toggle] = useToggle();
  return <button onClick={toggle}>{on ? 'ON' : 'OFF'}</button>;
}`,
      title: 'Custom Hook',
    });
  });

  await test('complex-conditional-rendering', async () => {
    await publishAndVerify('complex-conditional', {
      source: `function App() {
  const [show, setShow] = useState(false);
  const [tab, setTab] = useState('a');
  return (
    <div>
      <button onClick={() => setShow(!show)}>Toggle</button>
      {show && <p>Visible!</p>}
      {tab === 'a' ? <div>Tab A</div> : <div>Tab B</div>}
      <button onClick={() => setTab(tab === 'a' ? 'b' : 'a')}>Switch tab</button>
    </div>
  );
}`,
      title: 'Conditional Rendering',
    });
  });

  await test('complex-list-rendering', async () => {
    await publishAndVerify('complex-list', {
      source: `function App() {
  const items = Array.from({length: 20}, (_, i) => ({ id: i, name: 'Item ' + i }));
  const [filter, setFilter] = useState('');
  const filtered = items.filter(x => x.name.toLowerCase().includes(filter));
  return (
    <div>
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter..." />
      <ul>{filtered.map(item => <li key={item.id}>{item.name}</li>)}</ul>
    </div>
  );
}`,
      title: 'List Rendering with Filter',
    });
  });

  await test('complex-deep-nesting', async () => {
    await publishAndVerify('complex-nesting', {
      source: `function Level3({ text }) { return <span className="text-xs text-gray-500">{text}</span>; }
function Level2({ items }) { return <div className="pl-4">{items.map((t,i) => <Level3 key={i} text={t} />)}</div>; }
function Level1({ sections }) { return <div className="pl-4">{sections.map((s,i) => <Level2 key={i} items={s} />)}</div>; }
function App() {
  const data = [['a','b','c'],['d','e'],['f','g','h','i']];
  return <div className="p-4"><h1>Nested</h1><Level1 sections={data} /></div>;
}`,
      title: 'Deep Nesting (3 levels)',
    });
  });

  await test('complex-large-data', async () => {
    const bigArray = Array.from({length:100}, (_,i) => `{ id: ${i}, value: "item-${i}", active: ${i%2===0} }`);
    await publishAndVerify('complex-large-data', {
      source: `function App() {
  const data = [${bigArray.join(',')}];
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const slice = data.slice(page * pageSize, (page+1) * pageSize);
  return (
    <div className="p-4">
      <table className="w-full"><thead><tr><th>ID</th><th>Value</th><th>Active</th></tr></thead>
      <tbody>{slice.map(r => <tr key={r.id}><td>{r.id}</td><td>{r.value}</td><td>{r.active?'Y':'N'}</td></tr>)}</tbody></table>
      <div className="mt-2"><button onClick={()=>setPage(p=>Math.max(0,p-1))}>Prev</button> Page {page+1} <button onClick={()=>setPage(p=>p+1)}>Next</button></div>
    </div>
  );
}`,
      title: 'Large Data (100 rows, paginated)',
    });
  });

  // ── 3. Library Integration ────────────────────────────────────────
  console.log('\n\x1b[1m3. Library Integration (auto-detected)\x1b[0m');

  await test('lib-recharts', async () => {
    await publishAndVerify('lib-recharts', {
      source: `import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
function App() {
  const data = [{name:'A',val:40},{name:'B',val:70},{name:'C',val:30},{name:'D',val:90}];
  return (
    <div className="p-8" style={{width:'100%',height:400}}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" /><YAxis /><Tooltip />
          <Bar dataKey="val" fill="#6366f1" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}`,
      title: 'Recharts BarChart',
    }, { htmlContains: ['recharts'] });
  });

  await test('lib-lodash', async () => {
    await publishAndVerify('lib-lodash', {
      source: `function App() {
  const data = [{a:1,b:2},{a:3,b:4},{a:5,b:6}];
  const sum = _.sumBy(data, 'a');
  const grouped = _.groupBy([1,2,3,4,5,6], n => n % 2 === 0 ? 'even' : 'odd');
  return (
    <div className="p-4">
      <p>Sum of a: {sum}</p>
      <p>Even: {JSON.stringify(grouped.even)}</p>
      <p>Odd: {JSON.stringify(grouped.odd)}</p>
    </div>
  );
}`,
      title: 'Lodash Usage',
    }, { htmlContains: ['lodash'] });
  });

  await test('lib-d3', async () => {
    await publishAndVerify('lib-d3', {
      source: `function App() {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const svg = d3.select(ref.current).append('svg').attr('width', 300).attr('height', 200);
    svg.selectAll('circle')
      .data([30, 70, 110, 150, 190])
      .join('circle')
      .attr('cx', d => d).attr('cy', 100).attr('r', 20).attr('fill', '#6366f1');
  }, []);
  return <div ref={ref} className="p-4"><h2>D3 Circles</h2></div>;
}`,
      title: 'D3 SVG',
    }, { htmlContains: ['d3@'] });
  });

  // ── 4. CSS / Styling ──────────────────────────────────────────��───
  console.log('\n\x1b[1m4. CSS & Styling\x1b[0m');

  await test('css-tailwind-grid', async () => {
    await publishAndVerify('css-tailwind-grid', {
      source: `function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
        {['red','green','blue'].map(c => (
          <div key={c} className={\`bg-\${c}-100 p-6 rounded-lg shadow\`}>
            <h2 className="text-lg font-semibold">{c}</h2>
            <p className="text-sm text-gray-600">Card content</p>
          </div>
        ))}
      </div>
    </div>
  );
}`,
      title: 'Tailwind Grid',
    }, { htmlContains: ['tailwindcss'] });
  });

  await test('css-inline-styles', async () => {
    await publishAndVerify('css-inline-styles', {
      source: `function App() {
  const styles = {
    container: { display: 'flex', gap: '1rem', padding: '2rem', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' },
    card: { background: 'white', borderRadius: '12px', padding: '2rem', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', maxWidth: '400px' },
  };
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={{fontSize: '1.5rem', fontWeight: 'bold'}}>Inline Styles</h1>
        <p style={{color: '#666', marginTop: '0.5rem'}}>No Tailwind needed</p>
      </div>
    </div>
  );
}`,
      title: 'Inline Styles',
    });
  });

  // ── 5. Edge Cases & Error Scenarios ────────────────────────────────
  console.log('\n\x1b[1m5. Edge Cases & Errors\x1b[0m');

  await test('edge-empty-source', async () => {
    // Server should return isError for empty source
    const res = await mcpCall('tools/call', { name: 'publish_artifact', arguments: { source: '', title: 'Empty', slug: 'stress-edge-empty' } });
    const result = JSON.parse(res.body).result;
    assert(result?.isError === true, 'Empty source should return isError');
  });

  await test('edge-invalid-jsx-syntax-error', async () => {
    // Truly broken JSX that esbuild cannot parse
    try {
      await publishArtifact({ source: 'function App() { return <div onClick={>broken</div>; }', title: 'Invalid', slug: 'stress-edge-invalid' });
      throw new Error('Should have failed on invalid JSX');
    } catch (e) {
      assert(e.message.includes('compilation failed') || e.message.includes('error') || e.message.includes('MCP'),
        `Expected compilation error, got: ${e.message}`);
    }
  });

  await test('edge-unclosed-tag-graceful', async () => {
    // Unclosed tags: esbuild may handle gracefully or error — verify it doesn't crash the server
    try {
      const result = await publishArtifact({ source: '<div><span>unclosed content', title: 'Unclosed', slug: 'stress-edge-unclosed' });
      // If it succeeds, clean up
      if (result?.slug) { if (!KEEP) await deleteArtifact(result.slug); }
    } catch (e) {
      // Compilation error is also acceptable
      assert(e.message.includes('error') || e.message.includes('failed'), `Unexpected: ${e.message}`);
    }
  });

  await test('edge-script-tag-in-string', async () => {
    await publishAndVerify('edge-script-tag', {
      source: `function App() {
  const code = '<\/script><script>alert(1)<\/script>';
  return <pre>{code}</pre>;
}`,
      title: 'Script Tag in String',
    });
  });

  await test('edge-unicode-emoji', async () => {
    await publishAndVerify('edge-unicode', {
      source: `function App() {
  return (
    <div className="p-8 text-center">
      <h1 className="text-4xl">\u{1F680} Rocket Launch \u{1F30D}</h1>
      <p>日本語テスト — Ñoño — Ελληνικά</p>
      <p>Math: π ≈ 3.14159, ∑(1..n) = n(n+1)/2</p>
    </div>
  );
}`,
      title: 'Unicode & Emoji 🚀',
    });
  });

  await test('edge-arrow-component', async () => {
    await publishAndVerify('edge-arrow', {
      source: `const MyWidget = () => {
  const [x, setX] = useState(42);
  return <div onClick={() => setX(x + 1)}>Value: {x}</div>;
};`,
      title: 'Arrow Function Component',
    });
  });

  await test('edge-export-default-function', async () => {
    await publishAndVerify('edge-export-default', {
      source: `export default function Dashboard() {
  const [tab, setTab] = useState('home');
  return (
    <div className="p-4">
      <nav className="flex gap-2 mb-4">
        {['home','settings','about'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={tab === t ? 'font-bold underline' : ''}>{t}</button>
        ))}
      </nav>
      <div>{tab === 'home' ? 'Welcome' : tab === 'settings' ? 'Settings Page' : 'About Page'}</div>
    </div>
  );
}`,
      title: 'Export Default Function',
    });
  });

  await test('edge-explicit-imports', async () => {
    await publishAndVerify('edge-explicit-imports', {
      source: `import React, { useState, useEffect, useMemo } from 'react';
export default function App() {
  const [items, setItems] = useState([1,2,3,4,5]);
  const sum = useMemo(() => items.reduce((a,b) => a+b, 0), [items]);
  useEffect(() => { console.log('sum:', sum); }, [sum]);
  return <div><p>Sum: {sum}</p><button onClick={() => setItems(i => [...i, i.length+1])}>Add</button></div>;
}`,
      title: 'Explicit React Imports',
    });
  });

  await test('edge-large-source', async () => {
    // Generate a ~12KB JSX source
    const rows = Array.from({length: 50}, (_, i) =>
      `      <div key={${i}} className="p-2 border-b"><span className="font-mono">${i}</span> Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt.</div>`);
    await publishAndVerify('edge-large', {
      source: `function App() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Large Content ({expanded ? 'all' : 'preview'})</h1>
      <button onClick={() => setExpanded(!expanded)} className="mb-4 px-4 py-2 bg-indigo-600 text-white rounded">
        {expanded ? 'Collapse' : 'Expand'}
      </button>
      <div>
${rows.slice(0, 10).join('\n')}
        {expanded && <>
${rows.slice(10).join('\n')}
        </>}
      </div>
    </div>
  );
}`,
      title: 'Large Source (~12KB)',
    }, { minSize: 3000 });
  });

  await test('edge-template-literals', async () => {
    await publishAndVerify('edge-template-lit', {
      source: "function App() {\n  const name = 'World';\n  const greeting = `Hello, ${name}! Today is ${new Date().toLocaleDateString()}`;\n  const multiline = `Line 1\nLine 2\nLine 3`;\n  return (\n    <div className=\"p-4\">\n      <p>{greeting}</p>\n      <pre>{multiline}</pre>\n    </div>\n  );\n}",
      title: 'Template Literals',
    });
  });

  // ── 6. HTML Passthrough ───��───────────────────────────────────────
  console.log('\n\x1b[1m6. HTML Passthrough\x1b[0m');

  await test('html-passthrough-basic', async () => {
    await publishAndVerify('html-passthrough', {
      source: '<!DOCTYPE html><html><head><title>Raw HTML</title></head><body><h1>Hello from raw HTML</h1><p>No JSX compilation needed.</p></body></html>',
      title: 'Raw HTML',
      format: 'html',
    }, { htmlContains: ['Hello from raw HTML'], htmlNotContains: ['babel', 'require'] });
  });

  await test('html-passthrough-with-script', async () => {
    await publishAndVerify('html-with-script', {
      source: '<!DOCTYPE html><html><body><div id="out"></div><script>document.getElementById("out").textContent="Dynamic!";</script></body></html>',
      title: 'HTML with Script',
      format: 'html',
    }, { htmlContains: ['Dynamic!'] });
  });

  // ── 7. Slug & Metadata ──────────────��─────────────────────────────
  console.log('\n\x1b[1m7. Slug & Metadata\x1b[0m');

  await test('meta-custom-slug', async () => {
    const a = await publishArtifact({
      source: 'function App() { return <div>Custom slug</div>; }',
      title: 'Custom Slug Test',
      slug: 'stress-meta-custom-slug',
    });
    assert(a.slug === 'stress-meta-custom-slug', `Slug: ${a.slug}`);
    if (!KEEP) await deleteArtifact('stress-meta-custom-slug');
  });

  await test('meta-special-chars-title', async () => {
    const a = await publishArtifact({
      source: 'function App() { return <div>Special chars</div>; }',
      title: 'Test: Special (Chars) & "Quotes" <Tags>',
      slug: 'stress-meta-special',
    });
    assert(a.slug === 'stress-meta-special', `Slug: ${a.slug}`);
    if (!KEEP) await deleteArtifact('stress-meta-special');
  });

  await test('meta-unicode-title', async () => {
    const a = await publishArtifact({
      source: 'function App() { return <div>Unicode title</div>; }',
      title: '日本語テスト 🚀 Ñoño',
      slug: 'stress-meta-unicode',
    });
    assert(a.url, 'No URL');
    if (!KEEP) await deleteArtifact('stress-meta-unicode');
  });

  await test('meta-list-and-get', async () => {
    // Publish, then verify list and get return it
    await publishArtifact({
      source: 'function App() { return <div>List test</div>; }',
      title: 'List Test',
      slug: 'stress-meta-listget',
    });
    // List
    const listRes = await mcpCall('tools/call', { name: 'list_artifacts', arguments: {} });
    const list = JSON.parse(JSON.parse(listRes.body).result?.content?.[0]?.text || '[]');
    const found = list.find(a => a.slug === 'stress-meta-listget');
    assert(found, 'Artifact not in list');
    // Get
    const getRes = await mcpCall('tools/call', { name: 'get_artifact', arguments: { slug: 'stress-meta-listget' } });
    const got = JSON.parse(JSON.parse(getRes.body).result?.content?.[0]?.text || '{}');
    assert(got.slug === 'stress-meta-listget', 'Get returned wrong artifact');
    if (!KEEP) await deleteArtifact('stress-meta-listget');
  });

  await test('meta-delete-nonexistent', async () => {
    const res = await mcpCall('tools/call', { name: 'delete_artifact', arguments: { slug: 'nonexistent-slug-12345' } });
    const result = JSON.parse(res.body).result;
    assert(result?.isError === true, 'Should return isError for nonexistent slug');
  });

  // ── Report ─���──────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m✅ ALL ${passed} TESTS PASSED\x1b[0m (${totalMs}ms total)`);
  } else {
    console.log(`\x1b[31m\x1b[1m❌ ${failed}/${passed + failed} FAILED\x1b[0m (${totalMs}ms total)`);
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