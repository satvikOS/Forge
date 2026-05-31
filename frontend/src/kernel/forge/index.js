/**
 * Forge native-kernel JS facade.
 *
 * The renderer talks to the native Forge kernel through `window.forge`,
 * exposed by `electron/preload.js`. This module is the only place
 * outside that preload that knows about `window.forge` — every other
 * module imports from here. That gives us a single seam to mock when
 * running unit tests in plain Node (Vitest / Playwright `page.evaluate`
 * doesn't carry the preload bridge).
 *
 * `getForge()` resolves the bridge object (or throws a descriptive
 * error if the native addon failed to load — e.g. ABI mismatch after
 * an Electron upgrade).
 */

let memoized = null;

export function getForge() {
  if (memoized) return memoized;
  const f = typeof window !== 'undefined' ? window.forge : null;
  if (!f) {
    throw new Error(
      '[forge] window.forge is undefined — the preload bridge did not run. ' +
        'Are you running outside Electron, or is the renderer launched ' +
        'without `preload: electron/preload.js`?',
    );
  }
  if (!f.isReady()) {
    throw new Error(`[forge] kernel failed to load: ${f.loadError() || 'unknown'}`);
  }
  memoized = f;
  return f;
}

export function isForgeReady() {
  try {
    return typeof window !== 'undefined' && window.forge && window.forge.isReady();
  } catch {
    return false;
  }
}

/**
 * Lightweight handle wrapper. We hand these around in lieu of OCCT
 * TopoDS_Shape objects — they're plain uint32 ids, but wrapping them
 * gives us a `.dispose()` finaliser, a `.meta` slot, and a stable type
 * tag for instanceof checks downstream.
 */
export class ForgeBody {
  constructor(handle, meta = {}) {
    if (!Number.isInteger(handle) || handle <= 0) {
      throw new Error(`[forge] ForgeBody requires a positive integer handle; got ${handle}`);
    }
    this.handle = handle;
    this.meta = meta;
    this._disposed = false;
  }
  dispose() {
    if (this._disposed) return;
    try { getForge().release(this.handle); } catch { /* preload not present in tests */ }
    this._disposed = true;
  }
  /** Volume/area/COM via OCCT GProp. */
  massProperties() { return getForge().massProps(this.handle); }
  /** Returns { positions, normals, indices, triangleCount }. */
  tessellate(linTol = 0.1, angTol = 0.5) { return getForge().tessellate(this.handle, linTol, angTol); }
}
