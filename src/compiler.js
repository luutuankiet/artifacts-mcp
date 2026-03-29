import * as esbuild from 'esbuild';

/**
 * Normalize JSX source for maximum compatibility.
 *
 * Writers (Claude, humans) often produce JSX that needs small fixups:
 * - Missing React import (most common — Claude.ai doesn't need it)
 * - Using `export default` vs bare `function App`
 * - TypeScript-style type annotations in .jsx
 * - Stray semicolons after component declarations
 *
 * This function makes ALL of those "just work" so writers never have to
 * think about the compilation target.
 */
function normalizeSource(source) {
  let s = source.trim();

  // 1. Auto-inject React import if missing
  //    Claude.ai artifacts never import React (it's a global).
  //    esbuild classic JSX needs React in scope → require('react') via CJS shim.
  //    We inject `import React from 'react'` so esbuild → `require('react')` → CDN global.
  const hasReactImport = /^\s*import\s+React[\s,{]/m.test(s);
  if (!hasReactImport) {
    s = `import React from 'react';\n${s}`;
  }

  // 2. Auto-inject useState/useEffect etc. if used but not imported
  //    Pattern: hooks used as bare identifiers but not imported from 'react'
  const hookNames = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback',
                     'useReducer', 'useContext', 'useLayoutEffect', 'useId',
                     'useTransition', 'useDeferredValue', 'useSyncExternalStore',
                     'useInsertionEffect', 'useImperativeHandle', 'useDebugValue',
                     'createContext', 'createRef', 'forwardRef', 'memo', 'lazy',
                     'Suspense', 'Fragment', 'StrictMode'];
  const usedHooks = hookNames.filter(h => {
    // Used as identifier but not already in an import statement
    const usageRegex = new RegExp(`\\b${h}\\b`);
    const importRegex = new RegExp(`import\\s.*\\b${h}\\b.*from\\s+['"]react['"]`);
    return usageRegex.test(s) && !importRegex.test(s);
  });
  if (usedHooks.length > 0) {
    // Add destructured import: const { useState, useEffect } = React;
    // (after React import, before component code)
    const destructure = `const { ${usedHooks.join(', ')} } = React;`;
    // Insert after the React import line
    s = s.replace(
      /^(import React from 'react';)$/m,
      `$1\n${destructure}`
    );
  }

  // 3. Ensure there's a default export for the auto-mount to find
  //    Common patterns that need wrapping:
  //    - `function App() {}` with no export → add export default App
  //    - `const App = () => {}` with no export → add export default App
  const hasDefaultExport = /export\s+default\b/.test(s);
  if (!hasDefaultExport) {
    // Look for common component patterns
    const funcMatch = s.match(/^(?:function|const|let|var)\s+(App|Component|Main|Default|Page|Root|View|Dashboard|Demo|Example|Viewer|Explorer|Builder|Calculator|Chart|Game|Player|Editor|Manager|Tracker|Monitor|Analyzer|Visualizer|Simulator|Generator|Counter|Timer|Clock|Form|Table|List|Grid|Card|Panel|Layout|Wrapper|Container|Widget|Tool|Helper)\b/m);
    if (funcMatch) {
      s += `\nexport default ${funcMatch[1]};\n`;
    } else {
      // Fallback: look for ANY top-level function component (capitalized name + returns JSX)
      const anyFuncMatch = s.match(/^(?:function|const|let|var)\s+([A-Z]\w*)\b/m);
      if (anyFuncMatch) {
        s += `\nexport default ${anyFuncMatch[1]};\n`;
      }
    }
  }

  return s;
}

/**
 * Auto-detect which optional libraries the source needs.
 *
 * Scans for import statements and common API usage patterns.
 * This means writers don't need to specify `libraries: ['recharts', 'lodash']`
 * in the tool call — the server figures it out.
 *
 * @param {string} source  Raw JSX source
 * @param {object} libsManifest  The libs.json manifest
 * @returns {string[]}  Library names to include
 */
export function detectLibraries(source) {
  const detected = [];

  // Map of import paths / API usage → library name in libs.json
  const patterns = [
    { lib: 'recharts', test: /\b(recharts|BarChart|LineChart|PieChart|AreaChart|RadarChart|ComposedChart|ResponsiveContainer|XAxis|YAxis|CartesianGrid|Tooltip|Legend|Bar|Line|Pie|Area|Cell|Scatter)\b/ },
    { lib: 'lucide-react', test: /\b(lucide-react|(?:from|require\()['"]lucide)/ },
    { lib: 'd3', test: /\bd3\./ },
    { lib: 'three', test: /\b(THREE|three)\b/ },
    { lib: 'chart-js', test: /\b(Chart\.js|chart\.js|new Chart\b)/ },
    { lib: 'papaparse', test: /\b(Papa\.parse|papaparse)\b/ },
    { lib: 'mathjs', test: /\b(math\.evaluate|math\.parse|mathjs)\b/ },
    { lib: 'lodash', test: /\b(_\.\w+|lodash)\b/ },
    { lib: 'tone', test: /\b(Tone\.|tone)\b/ },
  ];

  for (const { lib, test } of patterns) {
    if (test.test(source)) {
      detected.push(lib);
    }
  }

  return detected;
}

/**
 * Compile JSX source to browser-ready JavaScript using esbuild.
 *
 * Uses CJS output format so esbuild natively handles:
 *   - import X from 'y'  →  const X = require('y')
 *   - export default App  →  module.exports = App
 * No fragile regex post-processing needed.
 *
 * The browser template provides:
 *   - window.require() shim mapping module names to CDN globals
 *   - window.module / window.exports stubs for CJS compat
 *
 * @param {string} source  Raw JSX/TSX source code
 * @returns {Promise<{code: string, warnings: Array}>}
 * @throws {Error} with line:col detail on syntax errors
 */
export async function compileJsx(source) {
  // Normalize source for maximum writer ergonomics
  const normalized = normalizeSource(source);

  try {
    const result = await esbuild.transform(normalized, {
      loader: 'jsx',
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      target: 'es2020',
      format: 'cjs',
    });

    return { code: result.code, warnings: result.warnings };
  } catch (err) {
    if (err.errors && err.errors.length > 0) {
      const e = err.errors[0];
      const loc = e.location
        ? ` (line ${e.location.line}, col ${e.location.column})`
        : '';
      throw new Error(`JSX compilation failed${loc}: ${e.text}`);
    }
    throw err;
  }
}
