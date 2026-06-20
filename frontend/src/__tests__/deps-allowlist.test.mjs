// C0 dependency ratchet — Forge Engineering Bible §2 + user directive: "no dependencies, native only".
//
// Forge's geometric power is NATIVE (forge-kernel.node on the OCCT foundation); the frontend must not
// silently accumulate npm dependencies. This test FAILS if any dependency appears that is not on the
// reviewed allowlist (forcing a conscious decision for every new dep), and WARNS that the two WASM CAD
// runtimes are slated for removal once the native kernel replaces their capability classes (Track C).
//
// When manifold-3d / opencascade.js are removed, move them from SUNSET into a hard "must be absent"
// assertion so they can never silently return.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'));

// Reviewed, allowed dependencies. Adding a new dep requires adding it here ON PURPOSE.
const ALLOWLIST = new Set([
  '@react-three/drei', '@react-three/fiber', '@vitejs/plugin-react',
  'axios', 'cesium', 'jszip', 'lucide-react',
  'manifold-3d', 'opencascade.js',
  'prop-types', 'react', 'react-dom', 'resium',
  'three', 'three-gpu-pathtracer', 'vite', 'vite-plugin-cesium',
  'esbuild',
]);

// WASM CAD runtimes to retire once the native kernel covers their classes (Track C).
// opencascade.js is a literal WASM duplicate of the native OCCT; manifold-3d backs mesh/implicit/voxel.
const SUNSET = ['manifold-3d', 'opencascade.js'];

const present = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
];

const unexpected = present.filter((d) => !ALLOWLIST.has(d));
assert.deepEqual(
  unexpected, [],
  `[deps-allowlist] New dependency added without review: ${unexpected.join(', ')}. `
  + 'Forge is native-only / no-new-deps — if this is intentional, add it to ALLOWLIST in this test '
  + 'with a justification comment.',
);

const sunsetPresent = SUNSET.filter((d) => present.includes(d));
if (sunsetPresent.length) {
  console.warn(
    `[deps-allowlist] WARN — ${sunsetPresent.length} WASM CAD runtime(s) still present, pending native `
    + `replacement (Track C): ${sunsetPresent.join(', ')}. Flip to hard-fail-on-presence once the native `
    + 'kernel covers their capability classes.',
  );
}
console.log(
  `[deps-allowlist] OK — ${present.length} deps, all on the reviewed allowlist `
  + `(${sunsetPresent.length} sunset-pending).`,
);
