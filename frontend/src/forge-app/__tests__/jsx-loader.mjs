/**
 * Tiny ESM loader that transforms .jsx files via esbuild on the fly.
 *
 * Used by the Forge-26 Forge-App tests so we can `import` the JSX
 * panels in plain Node without dragging in the full vitest+jsdom stack
 * yet. Wire-up: `node --experimental-loader ./jsx-loader.mjs <file>`.
 */
import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.jsx')) {
    const src = await readFile(fileURLToPath(url), 'utf8');
    const out = await transform(src, {
      loader: 'jsx',
      jsx: 'automatic',
      format: 'esm',
      target: 'es2022',
      sourcefile: fileURLToPath(url),
    });
    return { format: 'module', source: out.code, shortCircuit: true };
  }
  if (url.endsWith('.css')) {
    // CSS imports are no-ops in node — the styles only apply in the
    // browser; they don't affect SSR markup or unit-test assertions.
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }
  return nextLoad(url, context);
}
