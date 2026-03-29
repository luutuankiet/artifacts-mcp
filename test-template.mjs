import { compileJsx, detectLibraries } from './src/compiler.js';
import { buildHtml } from './src/template.js';

// Test full pipeline: JSX → compiled JS → HTML
const source = `
function App() {
  const [count, setCount] = useState(0);
  return (
    <div className="p-8 text-center">
      <h1 className="text-3xl font-bold">Counter: {count}</h1>
      <button 
        onClick={() => setCount(count + 1)}
        className="mt-4 px-6 py-2 bg-blue-600 text-white rounded"
      >
        Click me
      </button>
    </div>
  );
}
`;

try {
  const libs = detectLibraries(source);
  console.log('Detected libs:', libs);
  
  const { code } = await compileJsx(source);
  console.log('Compiled JS length:', code.length, 'bytes');
  
  const html = buildHtml(code, 'Test Counter', libs);
  console.log('HTML length:', html.length, 'bytes');
  
  // Verify HTML structure
  console.log('Has React CDN:', html.includes('react@18.3.1'));
  console.log('Has Tailwind CDN:', html.includes('tailwindcss'));
  console.log('NO Babel:', !html.includes('babel'));
  console.log('Has require shim:', html.includes('window.require'));
  console.log('Has auto-mount:', html.includes('_ArtifactComponent'));
  console.log('Has module.exports check:', html.includes('module.exports'));
  console.log('Has createElement:', html.includes('createElement'));
  console.log('Has error handler:', html.includes('Runtime Error'));
  
  console.log('\n✅ Full pipeline works!');
} catch(e) {
  console.log('❌ FAILED:', e.message);
}
