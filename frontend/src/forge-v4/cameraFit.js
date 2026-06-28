// Forge v4 — camera fit-to-bounds math (pure, testable).
//
// This is the SINGLE implementation of "frame a bounding box in the
// viewport". It was previously inlined inside Viewport.jsx's
// `window.__forgeFitToBounds`; it now lives here as a pure function so:
//   1. `__forgeFitToBounds` delegates to it (one formula, no duplication), and
//   2. the auto-zoom-to-fit-on-build path reuses the exact same math, and
//   3. it can be unit-tested headlessly (node, no DOM, no Electron).
//
// Geometry: the camera is placed along a view direction at a distance that
// makes the body's bounding sphere fit inside the camera frustum, then the
// controls target is set to the bbox centre. The distance uses the SMALLER
// of the horizontal/vertical FOV so the model fits in BOTH axes regardless
// of viewport aspect.
//
//   distance = (boundingSphere.radius / tan(fovMin/2)) * padding
//
// where boundingSphere.radius = ½·|box diagonal|. `padding` (a.k.a. `margin`)
// > 1 leaves breathing room; the auto-fit-on-build path uses ~1.2 so the
// model fills ~70–85 % of the frame instead of sitting as a tiny mesh on a
// black canvas.

const DEFAULT_DIR = [1.4, 0.6, 1.0];

function len3(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function normalize3(v, fallback = DEFAULT_DIR) {
  const l = len3(v);
  if (!(l > 1e-9)) {
    const fl = len3(fallback);
    return [fallback[0] / fl, fallback[1] / fl, fallback[2] / fl];
  }
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Compute the camera placement that frames `box`.
 *
 * @param {{min:{x,y,z}, max:{x,y,z}}} box  A THREE.Box3 (or any object with
 *        numeric min/max vectors). An empty / invalid box returns null.
 * @param {Object} [opts]
 * @param {number} [opts.fovDeg=45]      Vertical field of view, degrees.
 * @param {number} [opts.aspect=1.7778]  Viewport aspect (w/h).
 * @param {number} [opts.margin=2.4]     Padding multiplier (>1 = looser).
 * @param {number[]} [opts.dir]          Explicit view direction [x,y,z].
 * @param {number[]} [opts.currentPosition] Current camera position [x,y,z].
 * @param {number[]} [opts.currentTarget]   Current controls target [x,y,z].
 * @returns {null | {position:number[], target:number[], center:number[],
 *                    radius:number, distance:number, near:number, far:number,
 *                    direction:number[]}}
 *
 * Direction priority: explicit `dir` → current view direction
 * (currentPosition − currentTarget) → DEFAULT iso. Honouring the current
 * view direction means re-framing keeps the user's orbit angle.
 */
export function computeCameraFit(box, opts = {}) {
  if (!box || !box.min || !box.max) return null;
  const minx = box.min.x, miny = box.min.y, minz = box.min.z;
  const maxx = box.max.x, maxy = box.max.y, maxz = box.max.z;
  if (![minx, miny, minz, maxx, maxy, maxz].every((n) => Number.isFinite(n))) return null;
  const sx = maxx - minx, sy = maxy - miny, sz = maxz - minz;
  if (sx < 0 || sy < 0 || sz < 0) return null;            // empty box
  const radius = Math.sqrt(sx * sx + sy * sy + sz * sz) / 2;
  if (!(radius > 0)) return null;                          // zero-extent → nothing to frame

  const center = [(minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2];

  const fovDeg = Number.isFinite(opts.fovDeg) ? opts.fovDeg : 45;
  const aspect = Number.isFinite(opts.aspect) && opts.aspect > 0 ? opts.aspect : (16 / 9);
  const margin = Number.isFinite(opts.margin) && opts.margin > 0 ? opts.margin : 2.4;

  const fovV = (fovDeg * Math.PI) / 180;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect);
  const fovMin = Math.min(fovV, fovH);                    // fit BOTH axes
  const distance = (radius / Math.tan(fovMin / 2)) * margin;

  // Direction: explicit → current view direction → default iso.
  let dir;
  if (Array.isArray(opts.dir) && opts.dir.length === 3) {
    dir = normalize3(opts.dir);
  } else if (Array.isArray(opts.currentPosition) && Array.isArray(opts.currentTarget)) {
    dir = normalize3([
      opts.currentPosition[0] - opts.currentTarget[0],
      opts.currentPosition[1] - opts.currentTarget[1],
      opts.currentPosition[2] - opts.currentTarget[2],
    ]);
  } else {
    dir = normalize3(DEFAULT_DIR);
  }

  const position = [
    center[0] + dir[0] * distance,
    center[1] + dir[1] * distance,
    center[2] + dir[2] * distance,
  ];
  const near = Math.max(1, distance / 100);
  const far = Math.max(5000, distance * 10);

  return { position, target: center.slice(), center, radius, distance, near, far, direction: dir };
}

export default computeCameraFit;
