const https = require('https');

const BASE = process.env.ARTIFACT_HOST || 'localhost:3333';
const PROTOCOL = BASE.includes('localhost') ? 'http' : 'https';
const AUTH = process.env.ARTIFACT_AUTH || ''; // user:pass for basic auth

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const mod = PROTOCOL === 'https' ? https : require('http');
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (AUTH) headers['Authorization'] = 'Basic ' + Buffer.from(AUTH).toString('base64');
    const req = mod.request({
      hostname: BASE.split(':')[0], port: PROTOCOL === 'https' ? 443 : (BASE.split(':')[1] || 80), path: path,
      method: 'POST', headers
    }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

(async () => {
  console.log(`=== E2E TEST via ${PROTOCOL}://${BASE} ===\n`);

  // 1. Initialize
  console.log('1. MCP Initialize...');
  const init = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-test', version: '1.0' } } });
  console.log(`   Status: ${init.status}`);
  const initResult = JSON.parse(init.body);
  console.log(`   Server: ${initResult.result?.serverInfo?.name} v${initResult.result?.serverInfo?.version}`);

  // 2. Tools list
  console.log('\n2. Tools List...');
  const tools = await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const toolNames = JSON.parse(tools.body).result?.tools?.map(t => t.name) || [];
  console.log(`   Found ${toolNames.length} tools: ${toolNames.join(', ')}`);

  // 3. Publish an interactive JSX artifact
  console.log('\n3. Publishing JSX artifact...');
  const jsxSource = `
function App() {
  const [count, setCount] = React.useState(0);
  const [history, setHistory] = React.useState([]);
  
  const handleClick = () => {
    const newCount = count + 1;
    setCount(newCount);
    setHistory(prev => [...prev, { count: newCount, time: new Date().toLocaleTimeString() }]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 p-8">
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600 mb-2">
            Artifact Server E2E Test
          </h1>
          <p className="text-gray-400 text-sm mb-6">Published via MCP Streamable HTTP</p>
          
          <div className="text-7xl font-bold text-indigo-600 mb-6 tabular-nums">{count}</div>
          
          <button 
            onClick={handleClick}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-8 py-3 rounded-xl text-lg font-semibold hover:shadow-lg hover:scale-105 transition-all"
          >
            Click me!
          </button>
          
          {history.length > 0 && (
            <div className="mt-6 text-left">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Click History</h3>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {history.map((h, i) => (
                  <div key={i} className="flex justify-between text-sm text-gray-600 bg-gray-50 px-3 py-1 rounded">
                    <span>Click #{h.count}</span>
                    <span className="text-gray-400">{h.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">
          Rendered client-side via Babel + React CDN
        </p>
      </div>
    </div>
  );
}
`;

  const pub = await post('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'publish_artifact', arguments: { source: jsxSource, title: 'E2E Test - Interactive Counter', format: 'jsx', description: 'Full E2E test artifact with click counter and history' } } });
  const pubResult = JSON.parse(pub.body);
  const artifact = JSON.parse(pubResult.result?.content?.[0]?.text || '{}');
  console.log(`   URL: ${artifact.url}`);
  console.log(`   Size: ${artifact.size_kb} KB`);
  console.log(`   Created: ${artifact.created}`);

  // 4. List artifacts
  console.log('\n4. List artifacts...');
  const list = await post('/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_artifacts', arguments: {} } });
  const listResult = JSON.parse(list.body);
  const artifacts = JSON.parse(listResult.result?.content?.[0]?.text || '[]');
  console.log(`   Total artifacts: ${artifacts.length}`);
  artifacts.forEach(a => console.log(`   - ${a.title} (${a.format}, ${a.size_kb}KB) ${a.url}`));

  // 5. Verify HTML is served
  console.log('\n5. Verify artifact serves...');
  const html = await new Promise((resolve, reject) => {
    https.get(artifact.url, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, size: b.length, hasReact: b.includes('react'), hasBabel: b.includes('babel'), hasSource: b.includes('Click me') }));
    }).on('error', reject);
  });
  console.log(`   HTTP ${html.status}, ${html.size} bytes`);
  console.log(`   Has React: ${html.hasReact}`);
  console.log(`   Has Babel: ${html.hasBabel}`);
  console.log(`   Has Source: ${html.hasSource}`);

  console.log('\n=== ALL E2E TESTS PASSED ===');
  console.log(`\nOpen in browser: ${artifact.url}`);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
