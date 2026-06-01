// Forge-163 — support generation.
//
// 1. Overhang detection — per triangle normal:
//      gravity = (0,0,-1). If angle between normal and -gravity is
//      greater than `overhangAngleDeg` (default 45°), mark the triangle
//      as an overhang. We only care about downward-facing triangles
//      (normal.z < 0).
//
// 2. Anchor extraction — collect overhang centroids as bed targets;
//      filter out points that already rest on the bed (z near minZ).
//
// 3. Tree support — BFS from overhang anchors:
//      Each anchor starts a tree. Neighbouring anchors within
//      `mergeRadius` collapse into one trunk. The trunk descends in
//      `branchStep` segments toward the bed; we tilt branches outward
//      to a cone of `trunkAngleDeg` from vertical.
//
// 4. Grid support — bed-anchored vertical pillars beneath every
//      overhang. The pillar grid is generated on the bed at
//      `pillarSpacing`; any pillar that pierces an overhang gets
//      promoted to a real support column.
//
// Output:
//   {
//     overhangs:    [{ centroid:[x,y,z], normal:[x,y,z] }, ...],
//     treeBranches: [[[x,y,z],[x,y,z]], ...],     // line segments
//     gridPillars:  [{ x, y, z0, z1 }, ...],
//   }

const GRAVITY_DOWN = [0, 0, -1];

/* =====================================================================
 * Triangle normal + overhang test
 * ===================================================================== */

function triNormal(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/**
 * angleFromGravity returns the angle (deg) between the *downward-
 * facing* triangle and vertical. A horizontal downward face yields
 * 90° (worst overhang); a perfectly vertical wall yields 0°.
 */
function downAngleDeg(n) {
  if (n[2] >= 0) return -1;          // upward-facing, not an overhang.
  // dot(-n, [0,0,1]) = -n.z; angle from vertical:
  const dotUp = -n[2];
  // dotUp in (0, 1]; angle from vertical = acos(dotUp).
  return (Math.acos(Math.min(1, Math.max(-1, dotUp))) * 180) / Math.PI;
}

/**
 * Detect overhangs. Returns an array of { centroid:[x,y,z], normal,
 * angleDeg } objects.
 */
export function detectOverhangs(geom, opts = {}) {
  const threshold = opts.overhangAngleDeg ?? 45;
  const minBedClearance = opts.minBedClearance ?? 0.5; // mm above bed.
  if (!geom || !geom.positions) throw new Error('supportGen: no geometry');

  const out = [];
  const pos = geom.positions;
  const idx = geom.indices;

  // Need the bed plane = minZ of the geometry.
  let minZ = Infinity;
  for (let i = 2; i < pos.length; i += 3) {
    if (pos[i] < minZ) minZ = pos[i];
  }
  const bedZ = minZ;

  function consume(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const n = triNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
    // Only downward-facing triangles can be overhangs.
    if (n[2] >= 0) return;
    // `downAngleDeg` is the angle between -n and +Z, i.e. between the
    // triangle's *outward* normal and the gravity-up vector. A perfect
    // horizontal underside has -n=(0,0,1) so the angle is 0°. A
    // perfectly vertical wall has n.z=0 so the angle is 90°. The
    // overhang predicate is therefore "angle from vertical-up axis is
    // SMALLER than (90° - threshold)" — which is the same as saying
    // the triangle leans more than `threshold` from vertical.
    const angFromUp = downAngleDeg(n);
    if (angFromUp >= 90 - threshold) return;
    const ccx = (ax + bx + cx) / 3;
    const ccy = (ay + by + cy) / 3;
    const ccz = (az + bz + cz) / 3;
    if (ccz - bedZ < minBedClearance) return; // already on bed.
    out.push({ centroid: [ccx, ccy, ccz], normal: n, angleDeg: angFromUp });
  }

  if (idx) {
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      consume(
        pos[3*a], pos[3*a+1], pos[3*a+2],
        pos[3*b], pos[3*b+1], pos[3*b+2],
        pos[3*c], pos[3*c+1], pos[3*c+2],
      );
    }
  } else {
    for (let t = 0; t + 8 < pos.length; t += 9) {
      consume(
        pos[t],   pos[t+1], pos[t+2],
        pos[t+3], pos[t+4], pos[t+5],
        pos[t+6], pos[t+7], pos[t+8],
      );
    }
  }
  return { overhangs: out, bedZ };
}

/* =====================================================================
 * Tree supports — BFS branching from each anchor toward the bed
 * ===================================================================== */

/**
 * Tree branches descend from each overhang anchor toward the bed.
 * Anchors within `mergeRadius` of an existing tree merge into the
 * common trunk; the trunk tilts toward each parent branch's axis at a
 * shallow angle so trees fan out (Cura's tree-support trunk pattern).
 *
 * Returns an array of [a,b] segment pairs in 3-D.
 */
export function generateTreeSupport(overhangs, bedZ, opts = {}) {
  const branchStep   = opts.branchStep   ?? 2;     // mm per descent step.
  const mergeRadius  = opts.mergeRadius  ?? 6;     // mm to merge tips.
  const trunkAngleDeg = opts.trunkAngleDeg ?? 30;  // ° from vertical.
  const trunkTan     = Math.tan((trunkAngleDeg * Math.PI) / 180);

  // Cluster overhang centroids into starter tips by greedy merge.
  const tips = [];
  for (const o of overhangs) {
    const c = o.centroid;
    let merged = false;
    for (const tip of tips) {
      const dx = tip[0] - c[0], dy = tip[1] - c[1], dz = tip[2] - c[2];
      if (Math.hypot(dx, dy, dz) < mergeRadius) {
        // Average tip position toward the new point.
        tip[0] = (tip[0] + c[0]) / 2;
        tip[1] = (tip[1] + c[1]) / 2;
        tip[2] = Math.max(tip[2], c[2]); // keep upper tip
        merged = true;
        break;
      }
    }
    if (!merged) tips.push([c[0], c[1], c[2]]);
  }

  // Descend each tip toward the bed; at every step, drift toward the
  // mean of neighbouring tips within mergeRadius so trunks coalesce.
  const branches = [];
  const active = tips.map((t) => [t[0], t[1], t[2]]);
  let safetyIters = 0;
  while (active.length > 0 && safetyIters < 5000) {
    safetyIters++;
    // Move every tip down one branchStep, drifting toward neighbours.
    const next = [];
    for (let i = 0; i < active.length; i++) {
      const cur = active[i];
      let driftX = 0, driftY = 0, nNbr = 0;
      for (let j = 0; j < active.length; j++) {
        if (i === j) continue;
        const o = active[j];
        const dx = o[0] - cur[0], dy = o[1] - cur[1], dz = o[2] - cur[2];
        if (Math.hypot(dx, dy, dz) < mergeRadius * 2) {
          driftX += dx; driftY += dy; nNbr++;
        }
      }
      if (nNbr > 0) { driftX /= nNbr; driftY /= nNbr; }
      const driftLen = Math.hypot(driftX, driftY);
      const maxDrift = branchStep * trunkTan;
      let dxStep = 0, dyStep = 0;
      if (driftLen > 1e-6) {
        dxStep = (driftX / driftLen) * Math.min(driftLen, maxDrift);
        dyStep = (driftY / driftLen) * Math.min(driftLen, maxDrift);
      }
      const newPt = [cur[0] + dxStep, cur[1] + dyStep, cur[2] - branchStep];
      if (newPt[2] <= bedZ) {
        // Clip the last segment so it ends exactly at bedZ.
        const t = (cur[2] - bedZ) / branchStep;
        const bed = [
          cur[0] + dxStep * t,
          cur[1] + dyStep * t,
          bedZ,
        ];
        branches.push([cur, bed]);
        continue;                    // tip retired.
      }
      branches.push([cur, newPt]);
      next.push(newPt);
    }
    // Merge tips that now share a position (within mergeRadius).
    const collapsed = [];
    const taken = new Array(next.length).fill(false);
    for (let i = 0; i < next.length; i++) {
      if (taken[i]) continue;
      let cx = next[i][0], cy = next[i][1], cz = next[i][2], n = 1;
      taken[i] = true;
      for (let j = i + 1; j < next.length; j++) {
        if (taken[j]) continue;
        const dx = next[j][0] - cx / n, dy = next[j][1] - cy / n,
              dz = next[j][2] - cz / n;
        if (Math.hypot(dx, dy, dz) < mergeRadius) {
          cx += next[j][0]; cy += next[j][1]; cz += next[j][2]; n++;
          taken[j] = true;
        }
      }
      collapsed.push([cx / n, cy / n, cz / n]);
    }
    active.length = 0;
    for (const p of collapsed) active.push(p);
  }
  return branches;
}

/* =====================================================================
 * Grid supports — vertical pillars under overhangs
 * ===================================================================== */

/**
 * Build a regular grid of pillars on the bed; for each grid cell that
 * has at least one overhang centroid directly above it, emit a pillar
 * from bedZ up to that overhang's z height.
 */
export function generateGridSupport(overhangs, bedZ, opts = {}) {
  const pillarSpacing = opts.pillarSpacing ?? 5;
  const pillars = [];
  // Bucket overhangs into grid cells keyed by floor(x/spacing), floor(y/spacing).
  const cells = new Map();
  for (const o of overhangs) {
    const cx = Math.floor(o.centroid[0] / pillarSpacing);
    const cy = Math.floor(o.centroid[1] / pillarSpacing);
    const key = `${cx}|${cy}`;
    const cur = cells.get(key);
    if (!cur || cur.z < o.centroid[2]) {
      cells.set(key, {
        x: (cx + 0.5) * pillarSpacing,
        y: (cy + 0.5) * pillarSpacing,
        z: o.centroid[2],
      });
    }
  }
  for (const c of cells.values()) {
    if (c.z <= bedZ + 1e-6) continue;
    pillars.push({ x: c.x, y: c.y, z0: bedZ, z1: c.z });
  }
  return pillars;
}

/* =====================================================================
 * High-level public surface
 * ===================================================================== */

export function generateSupports(geom, opts = {}) {
  const detect = detectOverhangs(geom, opts);
  const treeBranches = opts.kind === 'grid'
    ? []
    : generateTreeSupport(detect.overhangs, detect.bedZ, opts);
  const gridPillars  = opts.kind === 'tree'
    ? []
    : generateGridSupport(detect.overhangs, detect.bedZ, opts);
  return {
    overhangs: detect.overhangs,
    bedZ:      detect.bedZ,
    treeBranches,
    gridPillars,
  };
}

export const SupportGen = {
  detectOverhangs,
  generateTreeSupport,
  generateGridSupport,
  generateSupports,
};

export default SupportGen;
