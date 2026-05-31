/**
 * ArchDisc Foundation — manifold-3d singleton loader.
 *
 * manifold-3d ships as a WASM module; we load it once and cache the
 * promise. All foundation code awaits this module before doing geometry
 * work.
 *
 * Why this exists: the legacy `BooleanEngine` (BSP CSG in pure JS) fails
 * on ~30 sequential subtractions on a single envelope. manifold-3d is a
 * topology-robust geometry library (MIT license, by Emmett Lalish) that
 * Onshape, Slic3r, OpenSCAD and others rely on. It guarantees manifold
 * output without numerical edge-case caveats.
 */

import Module from 'manifold-3d';
// eslint-disable-next-line import/no-unresolved
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';

let cachedModule = null;
let loadPromise = null;

/**
 * Load (or return cached) the manifold WASM module.
 * @returns {Promise<object>} the manifold-3d API surface, ready to use.
 *   Notable members: `Manifold` (3D solids), `CrossSection` (2D shapes),
 *   `triangulate`, `setMinCircularAngle`, `setCircularSegments`,
 *   `setMinCircularEdgeLength`.
 */
export async function getManifold() {
  if (cachedModule) return cachedModule;
  if (!loadPromise) {
    loadPromise = (async () => {
      const wasm = await Module({ locateFile: () => manifoldWasmUrl });
      wasm.setup();
      cachedModule = wasm;
      return wasm;
    })();
  }
  return loadPromise;
}

/**
 * Reset cache. For tests that need to verify load-from-scratch behavior.
 */
export function _reset() {
  cachedModule = null;
  loadPromise = null;
}
