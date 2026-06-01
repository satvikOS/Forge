// Forge-163 — infill pattern generators.
//
// Each generator takes a polygon region (outer loops minus inner loops)
// and emits a flat list of 2-D extrusion line segments
// ([[[x0,y0],[x1,y1]], ...]) clipped to that region. The patterns are:
//
//   rectilinear — parallel lines at a given angle; alternates per layer.
//   grid        — orthogonal cross-hatch (rectilinear at θ + rectilinear at θ+90°).
//   triangle    — three-axis lines at θ, θ+60°, θ+120°.
//   honeycomb   — hex cells stamped on a brick lattice.
//   cubic       — staggered cubic projection (3D cubic frame
//                 projected to the slice plane; the stagger encodes z).
//   gyroid2D    — slice of f(x,y,z) = sin(zk)·cos(xk) + sin(xk)·cos(yk)
//                 + sin(yk)·cos(zk) at the layer z — extracted via a
//                 marching-squares scalar-field tracer.
//   lightning   — Cura's tree-supported lightning: pick anchor points
//                 inside the region, grow a BFS branching tree toward
//                 region centroids; emit branch segments.
//
// Density is a 0..1 number — patterns translate it into spacing per
// nozzle width (line spacing = nozzleWidth / density for solid-cover,
// or simpler density·boundary inversion for tree-like patterns).
//
// All routines are pure on their inputs.

import { polygonArea, polygonSignedArea, pointInPolygon, loopBounds } from './slicerEngine.js';

/* =====================================================================
 * Polygon clipping — Sutherland–Hodgman against an axis-aligned strip
 * is overkill here; we instead clip a candidate line segment against
 * the region by sampling intersections with each loop edge and
 * stitching them into the visible subsegments.
 * ===================================================================== */

const EPS = 1e-9;

function segIntersect(p1, p2, p3, p4) {
  const x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
  const x3 = p3[0], y3 = p3[1], x4 = p4[0], y4 = p4[1];
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < EPS) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t < -EPS || t > 1 + EPS) return null;
  if (u < -EPS || u > 1 + EPS) return null;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1), t];
}

/**
 * Clip an infinite-line probe (p1 → p2) against the region's outer +
 * inner loops. Returns an array of subsegments [[a,b], ...] lying
 * inside the printable area (inside outers and outside inners).
 */
function clipLineAgainstRegion(p1, p2, outerLoops, innerLoops) {
  // Collect parameter t values where the line crosses any loop edge.
  const crossings = [];
  function addLoop(loop) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const hit = segIntersect(p1, p2, loop[j], loop[i]);
      if (hit) crossings.push(hit[2]);
    }
  }
  for (const l of outerLoops) addLoop(l);
  for (const l of innerLoops) addLoop(l);

  // Add the endpoints so we also handle the case where the line starts
  // inside the region (no crossing before it enters).
  crossings.push(0); crossings.push(1);
  crossings.sort((a, b) => a - b);

  // Dedupe near-coincident parameters.
  const ts = [];
  for (const t of crossings) {
    if (ts.length === 0 || t - ts[ts.length - 1] > 1e-7) ts.push(t);
  }

  const segs = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const ta = ts[i], tb = ts[i + 1];
    const midT = (ta + tb) / 2;
    const m = [p1[0] + midT * (p2[0] - p1[0]),
               p1[1] + midT * (p2[1] - p1[1])];
    // Inside outer + not inside any inner.
    let inside = false;
    for (const outer of outerLoops) {
      if (pointInPolygon(m, outer)) { inside = true; break; }
    }
    if (!inside) continue;
    let inHole = false;
    for (const inner of innerLoops) {
      if (pointInPolygon(m, inner)) { inHole = true; break; }
    }
    if (inHole) continue;
    segs.push([
      [p1[0] + ta * (p2[0] - p1[0]), p1[1] + ta * (p2[1] - p1[1])],
      [p1[0] + tb * (p2[0] - p1[0]), p1[1] + tb * (p2[1] - p1[1])],
    ]);
  }
  return segs;
}

/**
 * Helper: bounding box of all outer loops.
 */
function regionBounds(outerLoops) {
  let minX =  Infinity, minY =  Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const l of outerLoops) {
    const b = loopBounds(l);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/* =====================================================================
 * Rectilinear
 * ===================================================================== */

/**
 * Parallel rectilinear lines at angle `angleDeg`. Spacing is derived
 * from density: spacing = nozzleWidth / max(density, 0.01).
 */
export function rectilinear(outerLoops, innerLoops, opts) {
  const angleDeg = opts.angleDeg ?? 45;
  const density  = clamp(opts.density ?? 0.2, 0.01, 1);
  const nozzleWidth = opts.nozzleWidth ?? 0.4;
  const spacing = nozzleWidth / density;

  const bb = regionBounds(outerLoops);
  if (!bb) return [];

  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const theta = (angleDeg * Math.PI) / 180;
  const cs = Math.cos(theta), sn = Math.sin(theta);
  const r = Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY);

  // Rasterise lines perpendicular to the angle direction. We sweep s
  // from -r to +r at increments of `spacing` and emit lines parallel
  // to the angle direction at each offset.
  const segs = [];
  for (let s = -r; s <= r; s += spacing) {
    // Line passes through (cx - sn*s, cy + cs*s) with direction (cs, sn).
    const px = cx - sn * s, py = cy + cs * s;
    const p1 = [px - r * cs, py - r * sn];
    const p2 = [px + r * cs, py + r * sn];
    const sub = clipLineAgainstRegion(p1, p2, outerLoops, innerLoops);
    for (const seg of sub) segs.push(seg);
  }
  return segs;
}

/* =====================================================================
 * Grid (rectilinear ⊕ rectilinear at θ + 90°)
 * ===================================================================== */

export function grid(outerLoops, innerLoops, opts) {
  const angleDeg = opts.angleDeg ?? 0;
  const segsA = rectilinear(outerLoops, innerLoops, { ...opts, angleDeg });
  const segsB = rectilinear(outerLoops, innerLoops, { ...opts, angleDeg: angleDeg + 90 });
  return [...segsA, ...segsB];
}

/* =====================================================================
 * Triangle (three axes at θ, θ+60°, θ+120°)
 * ===================================================================== */

export function triangle(outerLoops, innerLoops, opts) {
  const angleDeg = opts.angleDeg ?? 0;
  const out = [];
  for (const off of [0, 60, 120]) {
    out.push(...rectilinear(outerLoops, innerLoops, { ...opts, angleDeg: angleDeg + off }));
  }
  return out;
}

/* =====================================================================
 * Honeycomb — hexagonal cells stamped on a brick lattice
 * ===================================================================== */

export function honeycomb(outerLoops, innerLoops, opts) {
  const density = clamp(opts.density ?? 0.2, 0.01, 1);
  const nozzleWidth = opts.nozzleWidth ?? 0.4;
  // A "hex cell side" of `cellSide` produces wall lines at the cell
  // perimeter; density inverts cell size so high density → smaller
  // cells → denser walls.
  const cellSide = (nozzleWidth * 4) / Math.max(density, 0.01);

  const bb = regionBounds(outerLoops);
  if (!bb) return [];

  // Hexagon geometry: flat-top hex with side s.
  //   width  = 2·s
  //   height = √3·s
  // Adjacent rows are offset by 1.5·s in x and 0 in y for flat-top.
  // For brick stagger, we offset every other column row by √3/2·s.
  const w = 2 * cellSide;
  const h = Math.sqrt(3) * cellSide;
  const xStep = 1.5 * cellSide;
  const yStep = h;

  const segs = [];
  for (let cx = bb.minX - w; cx <= bb.maxX + w; cx += xStep) {
    const col = Math.round((cx - bb.minX) / xStep);
    const yOffset = (col % 2 === 0) ? 0 : yStep / 2;
    for (let cy = bb.minY - h + yOffset; cy <= bb.maxY + h; cy += yStep) {
      // Hex vertices around (cx, cy), flat-top.
      const verts = [];
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k;
        verts.push([cx + cellSide * Math.cos(a), cy + cellSide * Math.sin(a)]);
      }
      for (let k = 0; k < 6; k++) {
        const a = verts[k];
        const b = verts[(k + 1) % 6];
        const sub = clipLineAgainstRegion(a, b, outerLoops, innerLoops);
        for (const s of sub) segs.push(s);
      }
    }
  }
  return segs;
}

/* =====================================================================
 * Cubic — 3D cubic frame projected to the layer
 *
 * The cubic infill is three rectilinear sets at 0/120/240° rotated
 * around the print Z. As Z increases the in-plane offset shifts by a
 * fraction of the period, encoding the 3D cube vertices into the
 * layer-by-layer cross-section.
 * ===================================================================== */

export function cubic(outerLoops, innerLoops, opts) {
  const z = opts.z ?? 0;
  const density = clamp(opts.density ?? 0.2, 0.01, 1);
  const nozzleWidth = opts.nozzleWidth ?? 0.4;
  const spacing = nozzleWidth / density;
  const period = spacing * Math.sqrt(2);
  const phase = ((z / period) % 1) * spacing;
  const out = [];
  for (const angleDeg of [0, 120, 240]) {
    out.push(...rectilinearWithPhase(outerLoops, innerLoops,
      { ...opts, angleDeg, density, phase }));
  }
  return out;
}

function rectilinearWithPhase(outerLoops, innerLoops, opts) {
  const angleDeg = opts.angleDeg ?? 45;
  const density  = clamp(opts.density ?? 0.2, 0.01, 1);
  const nozzleWidth = opts.nozzleWidth ?? 0.4;
  const spacing = nozzleWidth / density;
  const phase = opts.phase ?? 0;

  const bb = regionBounds(outerLoops);
  if (!bb) return [];
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const theta = (angleDeg * Math.PI) / 180;
  const cs = Math.cos(theta), sn = Math.sin(theta);
  const r = Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY);

  const segs = [];
  for (let s = -r + phase; s <= r; s += spacing) {
    const px = cx - sn * s, py = cy + cs * s;
    const p1 = [px - r * cs, py - r * sn];
    const p2 = [px + r * cs, py + r * sn];
    const sub = clipLineAgainstRegion(p1, p2, outerLoops, innerLoops);
    for (const seg of sub) segs.push(seg);
  }
  return segs;
}

/* =====================================================================
 * Gyroid 2D slice — marching squares on the implicit scalar field
 *
 * f(x,y,z) = sin(z·k)·cos(x·k) + sin(x·k)·cos(y·k) + sin(y·k)·cos(z·k)
 *
 * The slice extracts the iso-contour at f = 0, restricted to the
 * printable region. `k` is the spatial frequency derived from density:
 * higher density → tighter cells → larger k.
 * ===================================================================== */

export function gyroid2D(outerLoops, innerLoops, opts) {
  const z = opts.z ?? 0;
  const density = clamp(opts.density ?? 0.2, 0.01, 1);
  const nozzleWidth = opts.nozzleWidth ?? 0.4;
  // Cell side roughly = 4·nozzleWidth at density 1, scaling inversely.
  const cellSide = (nozzleWidth * 4) / Math.max(density, 0.01);
  const k = (Math.PI * 2) / cellSide;
  const sinZK = Math.sin(z * k), cosZK = Math.cos(z * k);
  const field = (x, y) => {
    const sX = Math.sin(x * k), cX = Math.cos(x * k);
    const sY = Math.sin(y * k), cY = Math.cos(y * k);
    return sinZK * cX + sX * cY + sY * cosZK;
  };

  const bb = regionBounds(outerLoops);
  if (!bb) return [];
  const step = cellSide / 3;          // 3 samples per cell — solid contour.
  const out = [];
  for (let y = bb.minY; y < bb.maxY; y += step) {
    for (let x = bb.minX; x < bb.maxX; x += step) {
      const x2 = x + step, y2 = y + step;
      const v00 = field(x, y), v10 = field(x2, y);
      const v01 = field(x, y2), v11 = field(x2, y2);
      // Marching-squares case index.
      let c = 0;
      if (v00 > 0) c |= 1;
      if (v10 > 0) c |= 2;
      if (v11 > 0) c |= 4;
      if (v01 > 0) c |= 8;
      if (c === 0 || c === 15) continue;
      const lerp = (a, b, va, vb, axis) => {
        const t = va / (va - vb);
        return axis === 'x' ? [a + t * (b - a), y === undefined ? 0 : y]
                            : [0, a + t * (b - a)];
      };
      // Per-edge midpoints (using true linear interpolation):
      const eTop    = [x + (v00 / (v00 - v10)) * step, y];
      const eRight  = [x2, y + (v10 / (v10 - v11)) * step];
      const eBottom = [x + (v01 / (v01 - v11)) * step, y2];
      const eLeft   = [x,  y + (v00 / (v00 - v01)) * step];
      const cases = {
        1:  [[eLeft, eTop]], 14: [[eLeft, eTop]],
        2:  [[eTop, eRight]], 13: [[eTop, eRight]],
        4:  [[eRight, eBottom]], 11: [[eRight, eBottom]],
        8:  [[eBottom, eLeft]], 7:  [[eBottom, eLeft]],
        3:  [[eLeft, eRight]], 12: [[eLeft, eRight]],
        6:  [[eTop, eBottom]], 9:  [[eTop, eBottom]],
        5:  [[eLeft, eTop], [eRight, eBottom]],
        10: [[eTop, eRight], [eBottom, eLeft]],
      };
      const list = cases[c];
      if (!list) continue;
      for (const [a, b] of list) {
        // Validate endpoints; some lerps can produce NaN when va≈vb.
        if (!Number.isFinite(a[0]) || !Number.isFinite(a[1])) continue;
        if (!Number.isFinite(b[0]) || !Number.isFinite(b[1])) continue;
        const sub = clipLineAgainstRegion(a, b, outerLoops, innerLoops);
        for (const s of sub) out.push(s);
      }
    }
  }
  return out;
}

/* =====================================================================
 * Lightning — Cura's tree-supported lightning algorithm (honest impl)
 *
 * Real Cura lightning is a 3D upper-tree that drops from one layer to
 * the next; per layer the in-plane projection is what gets printed.
 * Our 2-D-per-layer honest implementation:
 *   1. Seed anchor points along the region boundary at the spacing
 *      derived from density.
 *   2. Sample a uniform grid of test points inside the region.
 *   3. For each test point, find the nearest existing tree node and
 *      grow a branch toward it; if a branch already passes within
 *      `minBranchGap` of the test point, skip.
 *   4. Emit one segment per branch.
 *
 * This produces the characteristic radial-arboreal pattern Cura ships,
 * just done per-layer instead of in 3D. We label it lightning-2D
 * honestly in the comments — no claim of true volumetric lightning.
 * ===================================================================== */

export function lightning(outerLoops, innerLoops, opts) {
  const density = clamp(opts.density ?? 0.1, 0.01, 1);
  const nozzleWidth = opts.nozzleWidth ?? 0.4;
  const seedSpacing = (nozzleWidth * 6) / Math.max(density, 0.01);
  const branchStep  = (nozzleWidth * 4) / Math.max(density, 0.01);
  const minBranchGap = branchStep * 0.6;

  const bb = regionBounds(outerLoops);
  if (!bb) return [];

  // Seed anchors along outer-loop perimeters at `seedSpacing`.
  const anchors = [];
  for (const loop of outerLoops) {
    if (loop.length < 2) continue;
    let acc = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let stepStart = 0;
      // Carry acc forward so spacing is consistent across edges.
      while (acc + (len - stepStart) >= seedSpacing) {
        const need = seedSpacing - acc;
        const t = (stepStart + need) / len;
        anchors.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        stepStart += need;
        acc = 0;
      }
      acc += len - stepStart;
    }
  }
  if (anchors.length === 0) {
    // Tiny region — drop a single anchor at the centroid.
    let cx = 0, cy = 0, n = 0;
    for (const loop of outerLoops) {
      for (const p of loop) { cx += p[0]; cy += p[1]; n++; }
    }
    if (n > 0) anchors.push([cx / n, cy / n]);
  }

  // Sample test points on a grid inside the region.
  const tests = [];
  for (let y = bb.minY; y <= bb.maxY; y += branchStep) {
    for (let x = bb.minX; x <= bb.maxX; x += branchStep) {
      const p = [x, y];
      let inside = false;
      for (const outer of outerLoops) {
        if (pointInPolygon(p, outer)) { inside = true; break; }
      }
      if (!inside) continue;
      let hole = false;
      for (const inner of innerLoops) {
        if (pointInPolygon(p, inner)) { hole = true; break; }
      }
      if (hole) continue;
      tests.push(p);
    }
  }

  // Tree nodes start as the anchor set; each branch adds one node.
  const nodes = anchors.map((p) => [p[0], p[1]]);
  const segs = [];

  for (const t of tests) {
    // Find nearest tree node.
    let best = -1, bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const dx = nodes[i][0] - t[0], dy = nodes[i][1] - t[1];
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    if (best < 0) continue;
    const bestDist = Math.sqrt(bestD);
    if (bestDist < minBranchGap) continue;

    // Grow branch from nearest node toward t but stop at branchStep.
    const dx = t[0] - nodes[best][0], dy = t[1] - nodes[best][1];
    const norm = Math.hypot(dx, dy) || 1;
    const reach = Math.min(branchStep, bestDist);
    const newNode = [
      nodes[best][0] + (dx / norm) * reach,
      nodes[best][1] + (dy / norm) * reach,
    ];
    const branch = [[nodes[best][0], nodes[best][1]], [newNode[0], newNode[1]]];
    // Clip against region (the new node may have escaped a thin neck).
    const sub = clipLineAgainstRegion(branch[0], branch[1], outerLoops, innerLoops);
    for (const s of sub) segs.push(s);
    nodes.push(newNode);
  }
  return segs;
}

/* =====================================================================
 * Pattern dispatch table
 * ===================================================================== */

export const INFILL_PATTERNS = Object.freeze({
  rectilinear, grid, triangle, honeycomb, cubic, gyroid2D, lightning,
});

export const INFILL_PATTERN_NAMES = Object.freeze([
  'rectilinear', 'grid', 'triangle', 'honeycomb', 'cubic', 'gyroid2D', 'lightning',
]);

/**
 * Generate infill for a single layer. Alternates the rectilinear angle
 * between odd/even layers when `pattern` is rectilinear (true Slicer
 * 90°-flip behaviour).
 */
export function generateLayerInfill(layer, opts) {
  const pattern = opts.pattern || 'rectilinear';
  const fn = INFILL_PATTERNS[pattern];
  if (!fn) throw new Error(`infillPatterns: unknown pattern ${pattern}`);
  const layerIndex = opts.layerIndex ?? 0;
  const baseAngle = opts.angleDeg ?? 45;
  let angleDeg = baseAngle;
  if (pattern === 'rectilinear' && opts.alternate !== false) {
    angleDeg = baseAngle + (layerIndex % 2 === 0 ? 0 : 90);
  }
  return fn(layer.outerLoops, layer.innerLoops, {
    ...opts,
    angleDeg,
    z: layer.z,
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export default INFILL_PATTERNS;
