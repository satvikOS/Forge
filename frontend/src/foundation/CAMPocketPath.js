/**
 * CAMPocketPath — rectangular pocket clearing toolpath as a 3D
 * polyline. Sister to CAMToolpath.js which emits G-code text; this
 * module emits the geometric path the tool actually follows so we can
 * VISUALISE it in 3D (sweep a small-radius circle along the polyline
 * → ribbon you can see inside the stock).
 *
 * The path is the classic concentric-rectangle pocket clearing
 * algorithm every CAM workbench ships: for each Z pass, trace inset
 * rectangles from the outer pocket boundary inward in stepover-spaced
 * passes. Between passes the tool rapids back to safeZ + plunges into
 * the next inset's start corner. Repeat at the next Z level until the
 * full depth is cut.
 *
 * Coordinates: pocket lies in the X-Y plane, Z=0 at the stock top
 * surface. Cuts go DOWN (negative Z). safeZ is positive (above stock).
 *
 * NX CAM / Fusion CAM / Creo NC / Mastercam / SolidCAM all ship this
 * exact algorithm under names like "2.5D Pocket", "Pocket Clearing",
 * "Adaptive Clearing". This is the entry point; adaptive radial
 * stepover + climb-vs-conventional + entry helices are tier-2.
 */

/**
 * Build the full pocket-clearing polyline as a flat array of
 * [x, y, z] points. Adjacent points are connected by a straight cut
 * (or rapid travel; not distinguished here — the visualisation just
 * shows the geometric path).
 *
 * @param {object} pocket   { xmin, ymin, xmax, ymax, depth }
 * @param {object} opts
 *   toolDiaMm       tool diameter (mm), default 6
 *   stepoverMm      radial stepover between concentric passes, default 0.6·dia
 *   depthPerPassMm  axial depth of cut per Z pass, default 1.5
 *   safeZmm         rapid clearance height above stock, default 5
 */
export function pocketSpiralPath({ xmin, ymin, xmax, ymax, depth }, opts = {}) {
  if (!(xmax > xmin) || !(ymax > ymin)) throw new Error('CAMPocketPath: pocket bounds must satisfy xmax > xmin and ymax > ymin');
  if (!(depth > 0)) throw new Error('CAMPocketPath: depth must be > 0');
  const toolDiaMm    = opts.toolDiaMm    ?? 6;
  const stepoverMm   = opts.stepoverMm   ?? 0.6 * toolDiaMm;
  const depthPerPass = opts.depthPerPassMm ?? 1.5;
  const safeZ        = opts.safeZmm      ?? 5;
  const halfDia      = toolDiaMm / 2;

  if (xmax - xmin <= toolDiaMm + 1e-6 || ymax - ymin <= toolDiaMm + 1e-6) {
    throw new Error('CAMPocketPath: pocket is smaller than the tool — no clearance possible');
  }

  const path = [];
  const passes = Math.ceil(depth / depthPerPass);

  for (let p = 1; p <= passes; p++) {
    const z = -Math.min(p * depthPerPass, depth);
    let x0 = xmin + halfDia, y0 = ymin + halfDia;
    let x1 = xmax - halfDia, y1 = ymax - halfDia;
    let first = true;
    while (x1 > x0 && y1 > y0) {
      if (first) {
        path.push([x0, y0, safeZ]);                          // rapid above start corner
        path.push([x0, y0, z]);                              // plunge to cut depth
        first = false;
      } else {
        path.push([x0, y0, z]);                              // step inward (cut to next start)
      }
      path.push([x1, y0, z]);                                // trace rectangle CCW
      path.push([x1, y1, z]);
      path.push([x0, y1, z]);
      path.push([x0, y0, z]);                                // close
      x0 += stepoverMm; y0 += stepoverMm;
      x1 -= stepoverMm; y1 -= stepoverMm;
    }
    // Retract to safeZ at the end of this Z pass before the next plunge.
    const lx = path[path.length - 1][0], ly = path[path.length - 1][1];
    path.push([lx, ly, safeZ]);
  }
  return path;
}

/** Total Euclidean path length (mm). */
export function pathLength(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    s += Math.hypot(dx, dy, dz);
  }
  return s;
}

/**
 * Estimated cycle time (minutes) assuming the tool travels at
 * `feedMmPerMin` along every segment. (A real CAM controller would
 * use feed for cuts + rapid for travels; the visualisation glosses
 * this since it only knows the geometric path.)
 */
export function pathCycleMinutes(path, feedMmPerMin) {
  return pathLength(path) / Math.max(1, feedMmPerMin);
}

/**
 * Count how many concentric "rings" (inset rectangles) fit in the
 * pocket for the given tool / stepover. A useful predictor for the
 * pass complexity surfaced to the user.
 */
export function pocketRingCount({ xmin, ymin, xmax, ymax }, opts = {}) {
  const toolDiaMm  = opts.toolDiaMm  ?? 6;
  const stepoverMm = opts.stepoverMm ?? 0.6 * toolDiaMm;
  const halfDia    = toolDiaMm / 2;
  let x0 = xmin + halfDia, y0 = ymin + halfDia;
  let x1 = xmax - halfDia, y1 = ymax - halfDia;
  let count = 0;
  while (x1 > x0 && y1 > y0) {
    count += 1;
    x0 += stepoverMm; y0 += stepoverMm;
    x1 -= stepoverMm; y1 -= stepoverMm;
  }
  return count;
}
