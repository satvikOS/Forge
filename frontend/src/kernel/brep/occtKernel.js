/**
 * ArchDisc Kernel — OpenCASCADE (OCCT) WASM singleton loader.
 *
 * OCCT is ArchDisc's exact B-rep / NURBS kernel. It ships as a large
 * Emscripten WASM module; we load it once and cache the promise. Mirrors
 * `foundation/manifoldKernel.js`. All `kernel/brep/` code awaits this.
 *
 * NOTE: the dist filenames are confirmed in Task 1 Step 3. If they are not
 * `opencascade.full.{js,wasm}`, update the two import specifiers below.
 */

import ocFactory from 'opencascade.js/dist/opencascade.full.js';
// eslint-disable-next-line import/no-unresolved
import ocWasmUrl from 'opencascade.js/dist/opencascade.full.wasm?url';

let cachedModule = null;
let loadPromise = null;

/**
 * Load (or return cached) the OCCT WASM module.
 * @returns {Promise<object>} the `oc` API object (all OCCT classes).
 */
export async function getOCCT() {
  if (cachedModule) return cachedModule;
  if (!loadPromise) {
    loadPromise = (async () => {
      const oc = await ocFactory({ locateFile: () => ocWasmUrl });
      cachedModule = oc;
      return oc;
    })();
  }
  return loadPromise;
}

/** Reset cache — for tests that verify load-from-scratch behavior. */
export function _reset() {
  cachedModule = null;
  loadPromise = null;
}
