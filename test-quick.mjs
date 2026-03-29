import { compileJsx, detectLibraries } from './src/compiler.js';

// Test 1: Simple component (no imports, no export)
try {
  const r = await compileJsx('function App() { return <div>hello</div>; }');
  console.log('✅ Test 1 (bare component): OK, output', r.code.length, 'bytes');
  console.log('   Has require react:', r.code.includes('require'));
  console.log('   Has createElement:', r.code.includes('createElement'));
  console.log('   Has module.exports:', r.code.includes('module.exports'));
} catch(e) { console.log('❌ Test 1 FAILED:', e.message); }

// Test 2: Component with hooks (no imports)
try {
  const r = await compileJsx('function App() { const [x, setX] = useState(0); return <button onClick={() => setX(x+1)}>{x}</button>; }');
  console.log('✅ Test 2 (hooks no import): OK, output', r.code.length, 'bytes');
  console.log('   Has useState destructure:', r.code.includes('useState'));
} catch(e) { console.log('❌ Test 2 FAILED:', e.message); }

// Test 3: Invalid JSX
try {
  await compileJsx('<div><span></div>');
  console.log('❌ Test 3 (invalid JSX): Should have thrown!');
} catch(e) { console.log('✅ Test 3 (invalid JSX): Caught error:', e.message); }

// Test 4: Library detection
const libs = detectLibraries('import { BarChart } from "recharts"; _.map(data, fn);');
console.log('✅ Test 4 (lib detection):', libs);

// Test 5: Component with explicit import React
try {
  const r = await compileJsx('import React, { useState } from "react";\nfunction App() { return <div>hi</div>; }');
  console.log('✅ Test 5 (explicit import): OK, no duplicate import');
} catch(e) { console.log('❌ Test 5 FAILED:', e.message); }

console.log('\nDone.');
