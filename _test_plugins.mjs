// Validate that the fixed plugin modules parse and resolve real paths (no $env literal).
const esmPlugins = [
  './plugins/auto-summary/index.js',
  './plugins/compaction-memory-guard/index.js',
  './plugins/memory-rotate/index.js',
  './plugins/disk-compact/index.js',
  './plugins/dual-model-trainer/index.js',
  './plugins/error-filter/index.js',
  './plugins/weixin-reconnect/index.js',
];

let ok = true;
for (const p of esmPlugins) {
  try {
    const mod = await import(p);
    if (typeof mod.default !== 'function') throw new Error('no default export function');
    console.log('OK   ', p);
  } catch (e) {
    ok = false;
    console.log('FAIL ', p, '->', e.message);
  }
}

// CJS helper
try {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ls = require('./plugins/dual-model-trainer/learning-summary.js');
  console.log('OK    learning-summary.js (cjs)');
} catch (e) {
  ok = false;
  console.log('FAIL  learning-summary.js ->', e.message);
}

console.log(ok ? 'ALL_PLUGINS_OK' : 'SOME_FAILED');
