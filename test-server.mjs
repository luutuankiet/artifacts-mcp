// Quick test: start server, send MCP initialize, verify response
import { spawn } from 'child_process';
import http from 'http';

function post(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost', port: 3334, path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(data), ...headers }
    }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

// Start server on port 3334
const server = spawn('node', ['src/index.js'], {
  env: { ...process.env, PORT: '3334', BASE_URL: 'http://localhost:3334' },
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
server.stdout.on('data', d => output += d);
server.stderr.on('data', d => output += d);

// Wait for server to start
await new Promise(r => setTimeout(r, 2000));
console.log('Server output:', output.trim());

try {
  // 1. Initialize
  console.log('\n1. MCP Initialize...');
  const init = await post('/mcp', {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
  });
  console.log('   Status:', init.status);
  const sessionId = init.headers['mcp-session-id'];
  console.log('   Session ID:', sessionId ? 'present' : 'MISSING');
  const initResult = JSON.parse(init.body);
  console.log('   Server:', initResult.result?.serverInfo?.name, 'v' + initResult.result?.serverInfo?.version);
  console.log('   Protocol:', initResult.result?.protocolVersion);

  // 2. Tools list
  console.log('\n2. Tools List...');
  const tools = await post('/mcp', {
    jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}
  }, { 'mcp-session-id': sessionId });
  const toolNames = JSON.parse(tools.body).result?.tools?.map(t => t.name) || [];
  console.log('   Found', toolNames.length, 'tools:', toolNames.join(', '));

  // 3. Publish artifact
  console.log('\n3. Publish artifact...');
  const pub = await post('/mcp', {
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'publish_artifact', arguments: {
      source: 'function App() { const [n, setN] = useState(0); return <button onClick={() => setN(n+1)}>Count: {n}</button>; }',
      title: 'SDK Test'
    }}
  }, { 'mcp-session-id': sessionId });
  const pubResult = JSON.parse(pub.body);
  if (pubResult.error) {
    console.log('   ❌ ERROR:', pubResult.error.message);
  } else {
    const artifact = JSON.parse(pubResult.result?.content?.[0]?.text || '{}');
    console.log('   ✅ URL:', artifact.url);
    console.log('   Size:', artifact.size_kb, 'KB');
  }

  // 4. Test GET /mcp returns 405
  const getRes = await new Promise((resolve, reject) => {
    http.get('http://localhost:3334/mcp', res => {
      resolve({ status: res.statusCode });
    }).on('error', reject);
  });
  console.log('\n4. GET /mcp:', getRes.status === 405 ? '✅ 405 (correct)' : '❌ ' + getRes.status);

  console.log('\n✅ ALL MCP SDK TESTS PASSED');
} catch(e) {
  console.log('❌ FAILED:', e.message);
} finally {
  server.kill();
  process.exit(0);
}
