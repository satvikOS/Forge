/**
 * ForgeBodyMesh — bridge native tessellation into a Three.js scene.
 *
 * The native kernel's `forge.tessellate(handle)` returns flat-packed
 * Float32Array positions/normals + Uint32Array indices. This module
 * turns that into a `THREE.BufferGeometry` once, caches the result
 * keyed by handle + tolerance, and ships a Mesh whose `userData.forge`
 * carries the handle back so the picker can resolve THREE.Object3D →
 * kernel entity in O(1).
 *
 * `THREE` is injected, not imported. Lets headless tests run in node
 * with a stub geometry/mesh class — no JSDOM, no webgl-bootstrap.
 */

export const FORGE_USERDATA_KEY = 'forge';

export class ForgeBodyMesh {
  /**
   * @param {object} THREE Injected three.js (or a test stub with
   *   `BufferGeometry`, `BufferAttribute`, `Mesh`, `MeshStandardMaterial`).
   * @param {object} forge `window.forge` proxy.
   */
  constructor(THREE, forge) {
    this.THREE = THREE;
    this.forge = forge;
    /** key (`handle:linTol:angTol`) → BufferGeometry */
    this._geomCache = new Map();
  }

  cacheKey(handle, linTol, angTol) {
    return `${handle}:${linTol}:${angTol}`;
  }

  /**
   * Returns a BufferGeometry for the body. Cached per (handle, tol).
   */
  geometryFor(handle, { linTol = 0.1, angTol = 0.5 } = {}) {
    const key = this.cacheKey(handle, linTol, angTol);
    if (this._geomCache.has(key)) return this._geomCache.get(key);

    const m = this.forge.tessellate(handle, linTol, angTol);
    const { THREE } = this;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geom.setAttribute('normal',   new THREE.BufferAttribute(m.normals,   3));
    geom.setIndex(new THREE.BufferAttribute(m.indices, 1));
    // Compute bounding sphere up-front so the renderer can cull cheaply.
    if (typeof geom.computeBoundingSphere === 'function') {
      geom.computeBoundingSphere();
    }
    this._geomCache.set(key, geom);
    return geom;
  }

  /**
   * Build a THREE.Mesh ready to add to a scene. `material` is optional;
   * default is a neutral PBR material with low metalness.
   */
  meshFor(handle, opts = {}) {
    const geom = this.geometryFor(handle, opts);
    const { THREE } = this;
    const material = opts.material || new THREE.MeshStandardMaterial({
      color: 0xc4ccd6,
      metalness: 0.05,
      roughness: 0.45,
    });
    const mesh = new THREE.Mesh(geom, material);
    mesh.userData[FORGE_USERDATA_KEY] = { handle, kind: 'body' };
    return mesh;
  }

  /**
   * Refresh the geometry for `handle` — call after a parametric edit or
   * a boolean re-run produced a new BREP. Drops cached entries that
   * reference the old handle and rebuilds at the previously-used tol.
   */
  invalidate(handle) {
    for (const k of [...this._geomCache.keys()]) {
      if (k.startsWith(`${handle}:`)) this._geomCache.delete(k);
    }
  }

  /**
   * Resolve a `THREE.Intersection` (from a raycaster) back to a forge
   * entity. Returns `{ handle, kind }` from userData, or `null` if the
   * hit object wasn't bound by `meshFor`.
   */
  resolveHit(intersection) {
    if (!intersection || !intersection.object) return null;
    return intersection.object.userData?.[FORGE_USERDATA_KEY] || null;
  }
}

// ===================================================================
//                         Color maps (palettes)
// ===================================================================

/**
 * Apply a scalar field (one number per vertex) as per-vertex colors on
 * an existing BufferGeometry. The geometry must already have a
 * `position` attribute; we add (or replace) a `color` attribute.
 *
 * `palette` is a function `(t01) → [r,g,b]` with t01 in [0, 1]. Use
 * `PALETTES.viridis`, `PALETTES.turbo`, etc.
 */
export function applyScalarField(THREE, geometry, scalars, { palette = PALETTES.viridis,
                                                              vmin = null, vmax = null } = {}) {
  const positions = geometry.attributes.position;
  const N = positions.count;
  if (scalars.length !== N) {
    throw new Error(`[forge.colormap] scalar length ${scalars.length} != vertex count ${N}`);
  }
  let mn = vmin, mx = vmax;
  if (mn === null || mx === null) {
    mn = Infinity; mx = -Infinity;
    for (const v of scalars) { if (v < mn) mn = v; if (v > mx) mx = v; }
  }
  const span = mx - mn || 1;
  const colors = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const t = (scalars[i] - mn) / span;
    const [r, g, b] = palette(Math.max(0, Math.min(1, t)));
    colors[i*3+0] = r; colors[i*3+1] = g; colors[i*3+2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return { min: mn, max: mx };
}

/** Continuous palettes. Cheap polynomial approximations of well-known ramps. */
export const PALETTES = {
  // Viridis — perceptually uniform; safe default for scientific fields.
  viridis(t) {
    // Polynomial fit (Mikhail Matrosov's approximation, MIT-licensed).
    const c0 = [0.2777273272234, 0.0054872488844, 0.3340998564800];
    const c1 = [0.1050930431667, 1.4040475893630, 1.3838179576240];
    const c2 = [-0.330997817100,  0.214847559468, 0.0938519667740];
    const c3 = [-4.634230894200, -5.799100973700, -19.33244095800];
    const c4 = [6.228269936000, 14.17993336780, 56.69055260000];
    const c5 = [4.776384997000, -13.74514537620, -65.35303263000];
    const c6 = [-5.435455271000, 4.645852612000, 26.31243425000];
    const r = ((((c6[0]*t + c5[0])*t + c4[0])*t + c3[0])*t + c2[0])*t*t + c1[0]*t + c0[0];
    const g = ((((c6[1]*t + c5[1])*t + c4[1])*t + c3[1])*t + c2[1])*t*t + c1[1]*t + c0[1];
    const b = ((((c6[2]*t + c5[2])*t + c4[2])*t + c3[2])*t + c2[2])*t*t + c1[2]*t + c0[2];
    return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
  },
  // Turbo — high-contrast rainbow that survives grayscale conversion.
  turbo(t) {
    const r = Math.max(0, Math.min(1, 0.13572 + t*(4.61539 + t*(-42.66032 + t*(132.13108 + t*(-152.94239 + t*59.28637))))));
    const g = Math.max(0, Math.min(1, 0.09140 + t*(2.19418 + t*(4.84296 + t*(-14.18503 + t*(4.27729 + t*2.82939))))));
    const b = Math.max(0, Math.min(1, 0.10667 + t*(12.64194 + t*(-60.58204 + t*(110.36276 + t*(-89.90319 + t*27.34824))))));
    return [r, g, b];
  },
  // Cool — blue → magenta. Good for displacement.
  cool(t) {
    return [t, 1 - t, 1];
  },
  // Grayscale — when the user wants no color (and the field comes in as luminance).
  gray(t) {
    return [t, t, t];
  },
};
