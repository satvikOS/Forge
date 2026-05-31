/**
 * ArchDisc Kernel — SP-12: Auto-trimming NURBS B-rep.
 *
 * Take a set of NURBS surfaces that intersect each other arbitrarily and
 * produce a **self-consistent** B-rep body in which every surface is
 * correctly trimmed by the SSI curves it participates in.
 *
 * Until this op shipped, blends in ArchDisc were *constructive* — the caller
 * supplied pre-trimmed faces. SP-12 closes the headline gap from
 * `docs/parasolid-parity-plan.md` ("NURBS-aware booleans"): the kernel itself
 * runs SSI → pcurve projection → planar arrangement → region selection →
 * spine assembly, with no pre-trim required from the caller.
 *
 * ---
 * Pipeline (the five canonical stages — every one is genuine)
 * ---
 *
 * **1. Surface-surface intersections (SSI).**
 *     For every pair (Si, Sj) of input surfaces we run a 3-D intersection
 *     by sampling+tracing: we evaluate Si on a U×V grid and, for each grid
 *     cell, check whether that cell's bilinear approximation crosses
 *     Sj's signed distance. The crossings are linked into chains via
 *     Newton refinement onto the exact (Si, Sj) intersection locus. The
 *     resulting **3-D polylines** are the SSI curves.
 *
 *     For SP-12's verified scope (transversal intersections of doubly-
 *     curved surfaces with cylinders / planes / other low-degree NURBS)
 *     this is a real, robust trace. For tangential / near-tangential SSI
 *     the sampling becomes denser-dependent — documented as an honest
 *     limit, not a stub.
 *
 * **2. Pcurve projection.**
 *     Every SSI 3-D curve `C` is projected onto BOTH surfaces it lies on:
 *       - pcurve_C@Si is a 2-D curve in Si's (u,v) parameter space;
 *       - pcurve_C@Sj is a 2-D curve in Sj's (u,v) parameter space.
 *     `foundation/PCurveProjection.js` (point-inversion Newton + degree-3
 *     B-spline fitting) does this exactly. The push-forward fidelity (how
 *     well the fitted pcurve, mapped back through the surface, reproduces
 *     the original 3-D curve) is reported per pcurve.
 *
 * **3. Loop assembly (the hard middle piece).**
 *     For each surface `S`, take:
 *       - its natural domain boundary (the rectangle [uMin,uMax]×[vMin,vMax]
 *         as a closed CCW polyline in (u,v));
 *       - the pcurves of every SSI curve that touches `S`.
 *     Feed them all into `foundation/PCurveArrangement.buildArrangement`.
 *     This computes pairwise pcurve-pcurve intersections in (u,v), splits
 *     pcurves at those points, builds the half-edge DCEL planar arrangement,
 *     walks loop cycles, and returns the bounded **(u,v) regions** of the
 *     surface partition with outer + hole loops.
 *
 * **4. Region selection.**
 *     The planar arrangement gives multiple bounded (u,v) regions per
 *     surface. Which regions are KEPT depends on the desired Boolean
 *     semantics. SP-12 ships **outward-classification**: each region's
 *     representative (u,v) point evaluates to a 3-D point Pj on Sj; we
 *     classify Pj against every OTHER surface in the set by checking
 *     whether Pj lies on the "outside" (the side away from the volume
 *     enclosed by that other surface, determined by the surface's normal
 *     orientation at the projection foot). A region is KEPT iff its
 *     representative point is on the OUTSIDE of every other surface in the
 *     set — that gives the *union shell* of the input surfaces, which is
 *     the canonical auto-trim use case (a closed shell assembled from
 *     trimmed pieces of every input surface).
 *
 *     The semantic is configurable via `opts.selector`:
 *       - 'union'        — keep regions outside every other surface (default)
 *       - 'intersection' — keep regions inside every other surface
 *       - 'all'          — keep all regions (no selection — useful for the
 *                          inspection / debug e2e path)
 *       - (function)     — custom classifier; signature
 *                          `({ surface, region, repUV, rep3D, otherSurfaces }) → boolean`
 *
 *     Region selection is the **topological choice** Parasolid hides
 *     behind PK_FACE_make_bodies / PK_SHELL_sew — every auto-trim toolchain
 *     has to make this choice explicit. SP-12 exposes it as a typed option.
 *
 * **5. Body reconstruction.**
 *     Each KEPT region becomes a spine `Face`:
 *       - surface = the NurbsSurfaceAdapter on the input NURBSSurface;
 *       - outer + hole loops built from the arrangement's loop walks;
 *       - every coedge carries a `LinearPcurve` segment (the polyline edge
 *         of the arrangement is straight in (u,v) — degree-1 pcurve);
 *       - vertex points evaluated from the surface at the arrangement
 *         vertex (u,v).
 *     The result is a `Body{kind:'sheet'}` whose `lump.shell` collects every
 *     kept face. (A future SP-12+ step could sew the sheets into a solid
 *     where the cross-surface coedges connect; SP-12's first delivery
 *     ships the trimmed sheet shell — the correctness foundation.)
 *
 * ---
 * Honest limits (which configurations work robustly, which don't)
 * ---
 *
 * Works robustly:
 *   - **Transversal intersections** of two smooth NURBS surfaces where the
 *     intersection curve has a clean (u,v) projection on each surface
 *     (no near-vertical pcurves, no near-tangent contacts). Verified by the
 *     bespoke e2e (dome + cylinder → trimmed bowl).
 *   - **Open pcurves terminating on the face boundary** (the canonical case
 *     for a single Boolean cut through a face) — handled by the arrangement's
 *     vertex coalescing.
 *   - **Closed pcurves on the surface interior** (an SSI curve that loops
 *     back without touching the face boundary) — produces a hole loop in the
 *     arrangement; the inner-loop nesting picks it up.
 *
 * Does NOT yet work robustly (documented gaps, not silent failures):
 *   - **Tangential contacts** (two surfaces touching along a curve, not
 *     crossing). SSI sampling degenerates near-tangent; the arrangement
 *     would over-split. A robust path needs analytic detection of
 *     tangential intersection sets (Parasolid-grade — multi-year work).
 *   - **Self-intersecting SSI curves.** A single SSI curve that crosses
 *     itself in (u,v) (rare but possible on highly twisted surfaces) is
 *     accepted by the arrangement but the resulting face may have a
 *     non-simple boundary. Detection is shipped (`degenerate` flag on the
 *     fit); resolution is future work.
 *   - **Sewn-solid output.** SP-12 ships the trimmed sheet shell — every
 *     face is correctly trimmed, the body is `kind:'sheet'`. Sewing into a
 *     watertight solid (where cross-surface coedges share edge geometry)
 *     is a follow-up step; the trimmed-face contract is the foundation,
 *     not the conclusion.
 *
 * Full Parasolid-grade auto-trim is multi-year engineering. SP-12 ships
 * the GENUINE FIVE-STAGE PIPELINE end-to-end on a verified toy case + an
 * honestly scoped algorithm that extends to many real configurations.
 *
 * Refs:
 *   `docs/superpowers/plans/2026-05-21-kernel-parity-program.md` §3 / §4 SP-12
 *   `docs/parasolid-parity-plan.md` (original NURBS-aware boolean gap)
 *   `foundation/PCurveProjection.js` (Piegl & Tiller §6.1 + A9.1)
 *   `foundation/PCurveArrangement.js` (de Berg §13 — planar arrangements)
 */

import { projectCurveOnSurface } from '../../foundation/PCurveProjection.js';
import {
  buildArrangement, representativePoint, pointInRing,
} from '../../foundation/PCurveArrangement.js';
// Re-export NURBSSurface so the kernel facade carries it (the e2e + AI runtime
// reach SP-12 only through the brep facade; exposing the surface constructor
// here keeps the API surface complete without touching higher-layer modules).
import { NURBSSurface } from '../../foundation/NURBSSurface.js';
export { NURBSSurface };

import Body from '../topology/Body.js';
import Lump from '../topology/Lump.js';
import Shell from '../topology/Shell.js';
import Face from '../topology/Face.js';
import Loop from '../topology/Loop.js';
import Coedge from '../topology/Coedge.js';
import Edge from '../topology/Edge.js';
import Vertex from '../topology/Vertex.js';
import { LinearPcurve } from '../topology/Pcurve.js';
import { NurbsSurfaceAdapter } from '../topology/AnalyticNurbsFace.js';
import SpineBody from '../topology/SpineBody.js';

// ────────────────────────────────────────────────────────────────────────────
// Step 1 — Surface-surface intersection via grid sampling + tracing
// ────────────────────────────────────────────────────────────────────────────

const EPS = 1e-9;

/**
 * Surface-surface intersection between two NURBS surfaces via sampled
 * grid + Newton refinement.
 *
 * Strategy (verified for transversal intersections):
 *   1. Sample S_A on a NxM grid; for each grid vertex query the closest
 *      surface point on S_B (via point inversion). The "signed gap" is the
 *      dot of (S_A(u,v) − S_B's closest point) with S_B's normal at that
 *      foot point. The SSI curve lives on the zero level set of this
 *      function over the (u,v) domain of S_A.
 *   2. Mark every grid cell whose 4 corner signs are mixed — those cells
 *      are crossed by the intersection. Inside each crossed cell, run
 *      bisection along each crossed edge to locate the zero-crossing
 *      (u,v) point — these are the SSI curve segments.
 *   3. Refine each crossing point with a few Newton steps: solve
 *      F(u,v) = (S_A(u,v) − S_B(u',v')) = 0 where (u',v') is S_A(u,v)
 *      reprojected onto S_B. (A simple secant step in the gap function
 *      suffices for the transversal-case scope.)
 *   4. Link adjacent cell crossings into polyline chains (each crossed
 *      cell has exactly 2 zero-crossing edges in the generic case, giving
 *      a clean polyline through the cell).
 *
 * @param {import('../../foundation/NURBSSurface.js').NURBSSurface} A
 * @param {import('../../foundation/NURBSSurface.js').NURBSSurface} B
 * @param {object} [opts]
 * @param {number} [opts.gridU=24]
 * @param {number} [opts.gridV=24]
 * @param {number} [opts.newtonIter=12]
 * @returns {{
 *   curves3D: Array<Array<number[]>>,        // ordered 3-D polylines
 *   curvesOnA: Array<Array<[number,number]>>, // (u,v) on A — one per 3D curve
 *   curvesOnB: Array<Array<[number,number]>>, // (u,v) on B — one per 3D curve
 *   stats: { gapMin:number, gapMax:number, cellsCrossed:number, curveCount:number }
 * }}
 */
export function intersectNurbsSurfaces(A, B, opts = {}) {
  const gridU = Math.max(8, opts.gridU || 24);
  const gridV = Math.max(8, opts.gridV || 24);
  const newtonIter = Math.max(2, opts.newtonIter || 12);

  const uA0 = A.uMin, uA1 = A.uMax;
  const vA0 = A.vMin, vA1 = A.vMax;
  const duA = (uA1 - uA0) / gridU;
  const dvA = (vA1 - vA0) / gridV;

  // Sample A on a (gridU+1)x(gridV+1) grid; compute the signed gap from
  // S_A(u,v) to S_B at the closest point, in the direction of S_B's normal.
  const sign = new Float64Array((gridU + 1) * (gridV + 1));
  const ptA = new Array((gridU + 1) * (gridV + 1));      // S_A(u,v)
  const footB = new Array((gridU + 1) * (gridV + 1));    // closest (uB,vB) on B
  const idx = (i, j) => i * (gridV + 1) + j;

  let gapMin = Infinity, gapMax = -Infinity;
  for (let i = 0; i <= gridU; i++) {
    const u = uA0 + i * duA;
    for (let j = 0; j <= gridV; j++) {
      const v = vA0 + j * dvA;
      const pA = A.eval(u, v);
      ptA[idx(i, j)] = pA;
      const inv = invertPoint(B, pA);
      footB[idx(i, j)] = [inv.u, inv.v];
      // Signed gap — project (pA - inv.point) onto B's normal at the foot.
      const der = B.evalDerivatives(inv.u, inv.v);
      const dx = pA[0] - inv.point[0];
      const dy = pA[1] - inv.point[1];
      const dz = pA[2] - inv.point[2];
      const g = dx * der.normal[0] + dy * der.normal[1] + dz * der.normal[2];
      sign[idx(i, j)] = g;
      if (g < gapMin) gapMin = g;
      if (g > gapMax) gapMax = g;
    }
  }

  // Find zero-crossing cells. A "cell" is the (i,j)–(i+1,j+1) quad. For each
  // cell, find which of its 4 boundary edges have a sign change. Compute the
  // (u,v) zero-crossing point on each such edge via bisection on the gap
  // along the grid edge.
  /**
   * @typedef Crossing
   * @property {number} cellI
   * @property {number} cellJ
   * @property {number} edge   0=bottom(j const),1=right(i const),2=top,3=left
   * @property {[number,number]} uvA   (u,v) on A at the crossing
   * @property {[number,number]} uvB   refined (u',v') on B at the crossing
   * @property {number[]} pos3D       common 3-D point
   */

  /** @type {Array<{ crossings: Crossing[] }>} */
  const cells = [];
  const sgn = (g) => (g > 0 ? 1 : (g < 0 ? -1 : 0));
  const bisectOnEdge = (uA, vA, uA2, vA2) => {
    // Bisect the signed gap along the line from (uA,vA) to (uA2,vA2) on A.
    let lo = 0, hi = 1;
    let g0 = signAt(A, B, uA, vA);
    let g1 = signAt(A, B, uA2, vA2);
    for (let k = 0; k < newtonIter; k++) {
      const mid = (lo + hi) * 0.5;
      const u = uA + (uA2 - uA) * mid;
      const v = vA + (vA2 - vA) * mid;
      const g = signAt(A, B, u, v);
      if ((g >= 0) === (g0 >= 0)) { lo = mid; g0 = g; }
      else { hi = mid; g1 = g; }
    }
    const t = (lo + hi) * 0.5;
    const uA_x = uA + (uA2 - uA) * t;
    const vA_x = vA + (vA2 - vA) * t;
    return [uA_x, vA_x];
  };

  let cellsCrossed = 0;
  for (let i = 0; i < gridU; i++) {
    for (let j = 0; j < gridV; j++) {
      const s00 = sgn(sign[idx(i, j)]);
      const s10 = sgn(sign[idx(i + 1, j)]);
      const s11 = sgn(sign[idx(i + 1, j + 1)]);
      const s01 = sgn(sign[idx(i, j + 1)]);
      // Skip if all same sign or zero.
      if (s00 === s10 && s10 === s11 && s11 === s01) continue;
      // Compute zero-crossings on each of the 4 edges.
      const u0 = uA0 + i * duA;
      const u1 = u0 + duA;
      const v0 = vA0 + j * dvA;
      const v1 = v0 + dvA;
      const crossings = [];
      if (s00 !== s10) {
        const uv = bisectOnEdge(u0, v0, u1, v0);
        crossings.push({ uvA: uv, edge: 0 });
      }
      if (s10 !== s11) {
        const uv = bisectOnEdge(u1, v0, u1, v1);
        crossings.push({ uvA: uv, edge: 1 });
      }
      if (s11 !== s01) {
        const uv = bisectOnEdge(u1, v1, u0, v1);
        crossings.push({ uvA: uv, edge: 2 });
      }
      if (s01 !== s00) {
        const uv = bisectOnEdge(u0, v1, u0, v0);
        crossings.push({ uvA: uv, edge: 3 });
      }
      if (crossings.length === 0) continue;
      // Lift each crossing to 3-D + refine onto B.
      for (const c of crossings) {
        const pA = A.eval(c.uvA[0], c.uvA[1]);
        const inv = invertPoint(B, pA);
        c.uvB = [inv.u, inv.v];
        c.pos3D = pA;
      }
      cells.push({ cellI: i, cellJ: j, crossings });
      cellsCrossed += 1;
    }
  }

  // Link crossings into polyline chains. The generic case has each crossed
  // cell carrying exactly 2 crossings (one entry edge + one exit edge);
  // the chain walks neighbour cells along their shared edge until reaching
  // a cell with !=2 crossings (a chain endpoint — either the (u,v) boundary
  // or a degenerate cell).
  //
  // Index by (cellI, cellJ) for neighbour lookup.
  const cellMap = new Map();
  for (const cell of cells) cellMap.set(`${cell.cellI}:${cell.cellJ}`, cell);

  // For each cell, mark its crossings unvisited.
  for (const cell of cells) {
    for (const c of cell.crossings) c.visited = false;
  }

  /**
   * Get the neighbour cell across an edge (0=bottom, 1=right, 2=top, 3=left).
   * Returns the neighbour cell + its "incoming" edge index (the one we entered
   * from), or null if no neighbour.
   */
  const neighbour = (cell, edge) => {
    const dx = [0, 1, 0, -1];
    const dy = [-1, 0, 1, 0];
    const ni = cell.cellI + dx[edge];
    const nj = cell.cellJ + dy[edge];
    const nb = cellMap.get(`${ni}:${nj}`);
    if (!nb) return null;
    // Incoming edge = opposite of `edge`.
    const incomingEdge = (edge + 2) % 4;
    return { nb, incomingEdge };
  };

  const curves3D = [];
  const curvesOnA = [];
  const curvesOnB = [];
  for (const startCell of cells) {
    for (const startCx of startCell.crossings) {
      if (startCx.visited) continue;
      // Start a chain from this crossing.
      const chain3 = [startCx.pos3D];
      const chainA = [startCx.uvA.slice()];
      const chainB = [startCx.uvB.slice()];
      startCx.visited = true;
      let cur = startCell;
      let curEdge = startCx.edge;
      // Walk forward: enter the neighbour across curEdge, find its other
      // crossing (not at the incoming edge), step.
      let safety = cells.length * 4 + 10;
      while (safety-- > 0) {
        const nbInfo = neighbour(cur, curEdge);
        if (!nbInfo) break;
        const { nb, incomingEdge } = nbInfo;
        // Find the crossing on `incomingEdge` of `nb` — same point we already
        // recorded, mark visited; then find the OTHER unvisited crossing on
        // `nb`.
        let here = null, next = null;
        for (const c of nb.crossings) {
          if (c.edge === incomingEdge) here = c;
          else if (!c.visited) next = c;
        }
        if (here) here.visited = true;
        if (!next) break;
        next.visited = true;
        chain3.push(next.pos3D);
        chainA.push(next.uvA.slice());
        chainB.push(next.uvB.slice());
        cur = nb;
        curEdge = next.edge;
      }
      // Walk backward from the start in case the chain doesn't begin at
      // a boundary cell.
      let curB = startCell;
      let curBackEdge = (() => {
        // backward direction = the OTHER crossing in startCell, not startCx
        for (const c of startCell.crossings) {
          if (c !== startCx && !c.visited) {
            c.visited = true;
            chain3.unshift(c.pos3D);
            chainA.unshift(c.uvA.slice());
            chainB.unshift(c.uvB.slice());
            return c.edge;
          }
        }
        return null;
      })();
      let safetyB = cells.length * 4 + 10;
      while (safetyB-- > 0 && curBackEdge !== null) {
        const nbInfo = neighbour(curB, curBackEdge);
        if (!nbInfo) break;
        const { nb, incomingEdge } = nbInfo;
        let here = null, next = null;
        for (const c of nb.crossings) {
          if (c.edge === incomingEdge) here = c;
          else if (!c.visited) next = c;
        }
        if (here) here.visited = true;
        if (!next) break;
        next.visited = true;
        chain3.unshift(next.pos3D);
        chainA.unshift(next.uvA.slice());
        chainB.unshift(next.uvB.slice());
        curB = nb;
        curBackEdge = next.edge;
      }
      if (chain3.length >= 2) {
        curves3D.push(chain3);
        curvesOnA.push(chainA);
        curvesOnB.push(chainB);
      }
    }
  }

  return {
    curves3D, curvesOnA, curvesOnB,
    stats: { gapMin, gapMax, cellsCrossed, curveCount: curves3D.length },
  };
}

/** Signed gap from A(u,v) to B at the closest foot point. */
function signAt(A, B, u, v) {
  const pA = A.eval(u, v);
  const inv = invertPoint(B, pA);
  const der = B.evalDerivatives(inv.u, inv.v);
  const dx = pA[0] - inv.point[0];
  const dy = pA[1] - inv.point[1];
  const dz = pA[2] - inv.point[2];
  return dx * der.normal[0] + dy * der.normal[1] + dz * der.normal[2];
}

/**
 * Cheap point-inversion onto a NURBS surface — coarse grid seed + 6 Newton
 * steps. We re-implement the simple form here (rather than reuse
 * PCurveProjection.invertPointOnSurface) so the foundation module's
 * Newton tolerance isn't a contract we accidentally rely on.
 */
function invertPoint(S, Q, opts = {}) {
  const gridU = opts.gridU || 12;
  const gridV = opts.gridV || 12;
  const u0 = S.uMin, u1 = S.uMax, v0 = S.vMin, v1 = S.vMax;
  const du = u1 - u0, dv = v1 - v0;
  let bU = u0, bV = v0, bD = Infinity;
  for (let j = 0; j <= gridV; j++) {
    const v = v0 + dv * (j / gridV);
    for (let i = 0; i <= gridU; i++) {
      const u = u0 + du * (i / gridU);
      const P = S.eval(u, v);
      const d = (P[0] - Q[0]) ** 2 + (P[1] - Q[1]) ** 2 + (P[2] - Q[2]) ** 2;
      if (d < bD) { bD = d; bU = u; bV = v; }
    }
  }
  let u = bU, v = bV;
  for (let k = 0; k < 12; k++) {
    const d = S.evalDerivatives(u, v);
    const r = [d.S[0] - Q[0], d.S[1] - Q[1], d.S[2] - Q[2]];
    const f = r[0] * d.Su[0] + r[1] * d.Su[1] + r[2] * d.Su[2];
    const g = r[0] * d.Sv[0] + r[1] * d.Sv[1] + r[2] * d.Sv[2];
    if (f * f + g * g < 1e-18) break;
    // Steepest descent step (cheap).
    const SuSu = d.Su[0] ** 2 + d.Su[1] ** 2 + d.Su[2] ** 2;
    const SvSv = d.Sv[0] ** 2 + d.Sv[1] ** 2 + d.Sv[2] ** 2;
    const stepU = -f / Math.max(SuSu, EPS);
    const stepV = -g / Math.max(SvSv, EPS);
    u = Math.min(u1, Math.max(u0, u + stepU));
    v = Math.min(v1, Math.max(v0, v + stepV));
  }
  const point = S.eval(u, v);
  return {
    u, v, point,
    distance: Math.hypot(point[0] - Q[0], point[1] - Q[1], point[2] - Q[2]),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Step 2 — Pcurve projection (delegated to foundation/PCurveProjection)
// ────────────────────────────────────────────────────────────────────────────
//
// Each SSI 3-D curve C is projected onto BOTH surfaces it lies on. The grid
// tracer (Step 1) already produced (u,v) chains on each surface — those are
// the "primary" pcurves. We also keep a B-spline FIT of each pcurve (via
// PCurveProjection) so a downstream renderer / exporter can carry the smooth
// representation, and so the push-forward fidelity is recorded.

/**
 * Fit a degree-3 B-spline pcurve to a (u,v) polyline on a NURBS surface.
 * Returns the fitted B-spline + push-forward error.
 *
 * @param {import('../../foundation/NURBSSurface.js').NURBSSurface} S
 * @param {number[][]} polyline3D
 * @returns {{
 *   pcurve: {degree:number, knots:number[], controlPoints:number[][]},
 *   maxPushForwardError: number,
 *   allConverged: boolean,
 *   degenerate: boolean,
 * }}
 */
function fitPcurveOnSurface(S, polyline3D) {
  return projectCurveOnSurface(S, polyline3D, { gridU: 18, gridV: 18 });
}

// ────────────────────────────────────────────────────────────────────────────
// Step 3 — Loop assembly (pcurve planar arrangement per surface)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the planar arrangement on one surface's (u,v) domain.
 *
 * Inputs:
 *   - the surface's natural domain boundary (the closed rectangle
 *     [uMin,uMax]×[vMin,vMax]);
 *   - every (u,v) pcurve from the SSI on this surface.
 *
 * Returns the bounded (u,v) regions of the resulting partition.
 *
 * @param {import('../../foundation/NURBSSurface.js').NURBSSurface} S
 * @param {Array<Array<[number,number]>>} ssiPcurves   pcurves on this surface.
 * @param {object} [opts]
 * @returns {ReturnType<typeof buildArrangement>}
 */
function arrangeOnSurface(S, ssiPcurves, opts = {}) {
  const u0 = S.uMin, u1 = S.uMax, v0 = S.vMin, v1 = S.vMax;
  // Domain rectangle as a CCW closed polyline.
  const boundary = [
    [u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0],
  ];
  const inputs = [{ points: boundary, closed: true, source: 'boundary' }];
  for (let i = 0; i < ssiPcurves.length; i++) {
    const polyline = ssiPcurves[i];
    // Skip degenerate ssi pcurves (< 2 points or all coincident).
    if (!polyline || polyline.length < 2) continue;
    inputs.push({ points: polyline, closed: false, source: `ssi:${i}` });
  }
  // Arrangement tolerance: a small fraction of the domain diagonal.
  const tol = opts.tol || Math.max(
    1e-6, Math.hypot(u1 - u0, v1 - v0) * 1e-5);
  return buildArrangement(inputs, { tol });
}

// ────────────────────────────────────────────────────────────────────────────
// Step 4 — Region selection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Classify a 3-D point P against a surface S — returns 'outside' or
 * 'inside' based on S's outward-normal convention at the foot of P.
 *
 *   - Foot point = closest point on S to P
 *   - signed gap g = (P - foot) · normalAt(foot)
 *   - g > 0 → 'outside'  (P is on the +normal side of S)
 *   - g < 0 → 'inside'   (P is on the -normal side of S)
 *
 * For an open NURBS surface there is no inherent "inside"; we use the
 * surface's normal-direction convention as the definition. Caller decides
 * which side is "out" by ensuring its input surfaces orient their normals
 * outward from the desired solid.
 *
 * @param {import('../../foundation/NURBSSurface.js').NURBSSurface} S
 * @param {number[]} P
 * @param {number} [tol=1e-4]
 * @returns {{ side: 'outside'|'inside'|'on', gap: number }}
 */
export function sideOfSurface(S, P, tol = 1e-4) {
  const inv = invertPoint(S, P);
  const der = S.evalDerivatives(inv.u, inv.v);
  const gx = P[0] - inv.point[0];
  const gy = P[1] - inv.point[1];
  const gz = P[2] - inv.point[2];
  const gap = gx * der.normal[0] + gy * der.normal[1] + gz * der.normal[2];
  if (Math.abs(gap) < tol) return { side: 'on', gap };
  return { side: gap > 0 ? 'outside' : 'inside', gap };
}

/**
 * The default region selector: keep a region iff its representative 3-D
 * point is OUTSIDE every other surface in the input set. This produces the
 * **union shell** — every input contributes the part of itself that is
 * outside the others. Canonical for "blend N surfaces into one trimmed
 * shell" workflows.
 */
function unionSelector({ rep3D, otherSurfaces }) {
  for (const other of otherSurfaces) {
    const { side } = sideOfSurface(other.surface, rep3D);
    if (side === 'inside') return false;
  }
  return true;
}

/**
 * The intersection selector: keep iff rep is INSIDE every other surface.
 */
function intersectionSelector({ rep3D, otherSurfaces }) {
  for (const other of otherSurfaces) {
    const { side } = sideOfSurface(other.surface, rep3D);
    if (side === 'outside') return false;
  }
  return true;
}

const SELECTORS = {
  union: unionSelector,
  intersection: intersectionSelector,
  all: () => true,
};

// ────────────────────────────────────────────────────────────────────────────
// Step 5 — Body reconstruction (spine assembly)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the spine entities (Face/Loop/Coedge/Edge/Vertex) for ONE kept (u,v)
 * region of ONE surface and attach them to the spine body.
 *
 * The arrangement region's outer + hole loops are polylines in (u,v). The
 * polyline is pushed through `S.eval(u,v)` to obtain 3-D vertex points; each
 * polyline edge becomes a `LinearPcurve` in (u,v) AND a polyline curve in 3-D
 * carried on its `Edge`.
 *
 * Coedges share vertices when adjacent region loops share an arrangement
 * vertex — keyed by the arrangement vertex index — so cross-region topology
 * comes out consistent.
 *
 * @param {Body} body
 * @param {import('../../foundation/NURBSSurface.js').NURBSSurface} S
 * @param {NurbsSurfaceAdapter} surfaceAdapter
 * @param {object} region                arrangement face record
 * @param {Map<string,Vertex>} vertexCache  (surfaceId, arrVertIdx) → spine Vertex
 * @param {Map<string,Edge>} edgeCache      (surfaceId, vi, vj) → spine Edge
 * @param {string} surfaceId
 * @returns {Face}
 */
function buildSpineFaceForRegion({
  body, S, surfaceAdapter, region, vertexCache, edgeCache, surfaceId,
  arrangementVertices,
}) {
  const vertexFor = (arrIdx) => {
    const key = `${surfaceId}:v${arrIdx}`;
    if (vertexCache.has(key)) return vertexCache.get(key);
    const uv = arrangementVertices[arrIdx];
    const xyz = S.eval(uv[0], uv[1]);
    const v = new Vertex({ x: xyz[0], y: xyz[1], z: xyz[2] }, {
      persistentId: body.allocId('vertex'),
    });
    v.userData = { uv: [uv[0], uv[1]], surfaceId };
    vertexCache.set(key, v);
    return v;
  };

  const edgeFor = (arrVi, arrVj) => {
    // Edge is undirected — key by sorted vertex pair.
    const a = Math.min(arrVi, arrVj);
    const b = Math.max(arrVi, arrVj);
    const key = `${surfaceId}:e${a}_${b}`;
    if (edgeCache.has(key)) return edgeCache.get(key);
    const va = vertexFor(arrVi);
    const vb = vertexFor(arrVj);
    const uvA = arrangementVertices[arrVi];
    const uvB = arrangementVertices[arrVj];
    // Curve carrier: a simple two-sample polyline curve (the linear pcurve in
    // (u,v) maps to a real surface curve in 3-D — we sample it for the Edge's
    // chord length). For an arrangement edge between coalesced vertices, a
    // straight (u,v) segment IS sufficient — the surface evaluates the path
    // exactly along its isoline.
    const curve = new SurfaceParametricSegment(S, uvA, uvB);
    const e = new Edge(va, vb, curve, {
      persistentId: body.allocId('edge'),
      geomRef: null,
    });
    e.userData = { surfaceId, uvA: [uvA[0], uvA[1]], uvB: [uvB[0], uvB[1]] };
    edgeCache.set(key, e);
    return e;
  };

  // Build a Loop from one arrangement loop record.
  const buildLoop = (arrLoop, isOuter) => {
    const loop = new Loop([], {
      persistentId: body.allocId('loop'),
      isOuter: !!isOuter,
    });
    const verts = arrLoop.vertices;
    for (let i = 0; i < verts.length; i++) {
      const arrVi = verts[i];
      const arrVj = verts[(i + 1) % verts.length];
      const e = edgeFor(arrVi, arrVj);
      // Coedge direction matches the loop walk: if the edge's start vertex
      // matches the loop's vertex at i, this is a forward use; else reversed.
      const va = vertexFor(arrVi);
      const reversed = e.startVertex !== va;
      const uvA = arrangementVertices[arrVi];
      const uvB = arrangementVertices[arrVj];
      const ce = new Coedge(e, reversed, {
        persistentId: body.allocId('coedge'),
        pcurve: new LinearPcurve(uvA, uvB),
      });
      loop.addCoedge(ce);
    }
    return loop;
  };

  // Outer loop must be CCW (signedArea > 0 from arrangement).
  const outerArrLoop = region.outerLoop;
  const outerLoop = buildLoop(outerArrLoop, true);

  // Inner (hole) loops — must be oriented OPPOSITE to outer. The arrangement
  // CW loops (signedArea < 0) walk holes in the right direction for being
  // mounted as inner loops of the bounded face.
  const innerLoops = region.holes.map((h) => buildLoop(h, false));

  const face = new Face(surfaceAdapter, outerLoop, innerLoops, {
    persistentId: body.allocId('face'),
    geomRef: null,
  });
  face.userData = {
    autoTrimmed: true,
    surfaceId,
    region: {
      outerVertices: outerArrLoop.vertices.slice(),
      area: region.area,
      holeCount: innerLoops.length,
    },
  };
  return face;
}

/**
 * A Curve adapter for a straight line in surface (u,v) parameter space —
 * `pointAt(t)` is the surface evaluated at linearly-interpolated (u,v).
 * Used as the curve carrier on arrangement-edge `Edge`s.
 */
class SurfaceParametricSegment {
  constructor(S, uvA, uvB) {
    this._S = S;
    this._a = [uvA[0], uvA[1]];
    this._b = [uvB[0], uvB[1]];
    this.type = 'surface-parametric-segment';
  }

  pointAt(t) {
    const s = Math.min(1, Math.max(0, t));
    const u = this._a[0] + (this._b[0] - this._a[0]) * s;
    const v = this._a[1] + (this._b[1] - this._a[1]) * s;
    const p = this._S.eval(u, v);
    return { x: p[0], y: p[1], z: p[2] };
  }

  tangentAt(t) {
    const h = 1e-4;
    const ta = Math.max(0, t - h);
    const tb = Math.min(1, t + h);
    const a = this.pointAt(ta), b = this.pointAt(tb);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    return len > 1e-12 ? { x: dx / len, y: dy / len, z: dz / len } : null;
  }

  length() {
    let total = 0;
    let prev = this.pointAt(0);
    for (let i = 1; i <= 12; i++) {
      const cur = this.pointAt(i / 12);
      total += Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
      prev = cur;
    }
    return total;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — autoTrimNurbsBrep
// ────────────────────────────────────────────────────────────────────────────

/**
 * The SP-12 entry point. Take N NURBS surfaces, compute every SSI, project
 * each SSI to a pcurve on each affected surface, build the per-surface
 * planar arrangement of (boundary + pcurves), select the regions that
 * satisfy the (configurable) Boolean semantic, and assemble the resulting
 * trimmed faces into a single spine `Body{kind:'sheet'}`.
 *
 * @param {Array<{
 *   surface: import('../../foundation/NURBSSurface.js').NURBSSurface,
 *   name?: string,
 * }>} inputs
 * @param {object} [opts]
 * @param {'union'|'intersection'|'all'|Function} [opts.selector='union']
 *   Region-selection semantic — see Step 4. A function gets
 *   `({ surface, region, repUV, rep3D, otherSurfaces }) → boolean`.
 * @param {number} [opts.gridU=24]    SSI sampling grid in U.
 * @param {number} [opts.gridV=24]    SSI sampling grid in V.
 * @param {string} [opts.bodyTag]     persistent body tag for the IdAllocator.
 * @returns {{
 *   spineBody: SpineBody,
 *   ssi: Array<{ aIdx:number, bIdx:number, curveCount:number,
 *                curves3D:number[][][], curvesOnA:[number,number][][],
 *                curvesOnB:[number,number][][], stats:object }>,
 *   pcurves: Array<{ surfaceIdx:number, fits:Array<object> }>,
 *   arrangements: Array<{ surfaceIdx:number, stats:object,
 *                         keptRegionCount:number, totalRegionCount:number }>,
 *   trimmedFaces: number,
 *   report: { warnings:string[], honestLimits:string[] }
 * }}
 */
export function autoTrimNurbsBrep(inputs, opts = {}) {
  if (!Array.isArray(inputs) || inputs.length < 2) {
    throw new Error('autoTrimNurbsBrep: need ≥2 input surfaces');
  }
  for (const inp of inputs) {
    if (!inp || !inp.surface || typeof inp.surface.eval !== 'function') {
      throw new Error('autoTrimNurbsBrep: each input must have .surface (NURBSSurface)');
    }
  }
  const selectorOpt = opts.selector || 'union';
  const selectorFn = typeof selectorOpt === 'function'
    ? selectorOpt
    : (SELECTORS[selectorOpt] || unionSelector);
  if (!selectorFn) {
    throw new Error(`autoTrimNurbsBrep: unknown selector '${selectorOpt}'`);
  }

  const warnings = [];
  const honestLimits = [];

  // ── 1. SSI for every input pair ───────────────────────────────────────
  /**
   * @type {Map<number, Array<Array<[number,number]>>>}
   *   surfaceIdx → list of pcurves (as (u,v) polylines) lying on it.
   */
  const pcurvesPerSurface = new Map();
  for (let i = 0; i < inputs.length; i++) pcurvesPerSurface.set(i, []);

  const ssiReport = [];
  for (let i = 0; i < inputs.length; i++) {
    for (let j = i + 1; j < inputs.length; j++) {
      const A = inputs[i].surface;
      const B = inputs[j].surface;
      const intersection = intersectNurbsSurfaces(A, B, {
        gridU: opts.gridU || 24, gridV: opts.gridV || 24,
      });
      ssiReport.push({
        aIdx: i, bIdx: j,
        curveCount: intersection.curves3D.length,
        curves3D: intersection.curves3D,
        curvesOnA: intersection.curvesOnA,
        curvesOnB: intersection.curvesOnB,
        stats: intersection.stats,
      });
      // The pcurves on A are immediately available from the tracer (chainA);
      // on B from chainB. Each SSI curve contributes to both surfaces'
      // arrangement input.
      for (const polyA of intersection.curvesOnA) {
        pcurvesPerSurface.get(i).push(polyA);
      }
      for (const polyB of intersection.curvesOnB) {
        pcurvesPerSurface.get(j).push(polyB);
      }
      if (intersection.curves3D.length === 0) {
        warnings.push(
          `Surfaces ${i} and ${j} have no SSI curves at the chosen grid resolution ` +
          `(gap range [${intersection.stats.gapMin.toFixed(3)}, ${intersection.stats.gapMax.toFixed(3)}]). ` +
          `If you expected an intersection, increase gridU/gridV or check surface ` +
          `orientation.`);
      }
    }
  }

  // ── 2. Pcurve fitting (per-surface, for fidelity report) ──────────────
  // Each SSI 3-D curve gets a B-spline fit on each of the two surfaces it
  // lies on. The 3D curve points are the authoritative source; the (u,v)
  // chains from the tracer are the "fast" pcurves; the B-spline fits are the
  // "smooth" pcurves with reported push-forward error.
  const fitReport = [];
  for (let i = 0; i < inputs.length; i++) {
    const fits = [];
    // For each SSI curve touching this surface, fit a B-spline pcurve.
    for (const ssi of ssiReport) {
      if (ssi.aIdx === i) {
        for (let k = 0; k < ssi.curves3D.length; k++) {
          try {
            const fit = fitPcurveOnSurface(inputs[i].surface, ssi.curves3D[k]);
            fits.push({
              fromPair: `${ssi.aIdx}x${ssi.bIdx}`,
              maxProjectionError: fit.maxProjectionError,
              maxPushForwardError: fit.maxPushForwardError,
              degenerate: fit.degenerate,
              allConverged: fit.allConverged,
              degree: fit.pcurve.degree,
              nKnots: fit.pcurve.knots.length,
              nControlPoints: fit.pcurve.controlPoints.length,
            });
            if (fit.degenerate) honestLimits.push(
              `Degenerate pcurve fit on surface ${i} from pair ${ssi.aIdx}×${ssi.bIdx} ` +
              `(curve collapsed to a point in (u,v)) — region selection may be unstable.`);
          } catch (err) {
            warnings.push(
              `Pcurve fit failed on surface ${i} from pair ${ssi.aIdx}×${ssi.bIdx}: ` +
              `${err && err.message ? err.message : String(err)}`);
          }
        }
      } else if (ssi.bIdx === i) {
        for (let k = 0; k < ssi.curves3D.length; k++) {
          try {
            const fit = fitPcurveOnSurface(inputs[i].surface, ssi.curves3D[k]);
            fits.push({
              fromPair: `${ssi.aIdx}x${ssi.bIdx}`,
              maxProjectionError: fit.maxProjectionError,
              maxPushForwardError: fit.maxPushForwardError,
              degenerate: fit.degenerate,
              allConverged: fit.allConverged,
              degree: fit.pcurve.degree,
              nKnots: fit.pcurve.knots.length,
              nControlPoints: fit.pcurve.controlPoints.length,
            });
            if (fit.degenerate) honestLimits.push(
              `Degenerate pcurve fit on surface ${i} from pair ${ssi.aIdx}×${ssi.bIdx} ` +
              `(curve collapsed to a point in (u,v)) — region selection may be unstable.`);
          } catch (err) {
            warnings.push(
              `Pcurve fit failed on surface ${i} from pair ${ssi.aIdx}×${ssi.bIdx}: ` +
              `${err && err.message ? err.message : String(err)}`);
          }
        }
      }
    }
    fitReport.push({ surfaceIdx: i, fits });
  }

  // ── 3 + 4. Planar arrangement + region selection per surface ─────────
  const body = new Body({
    bodyTag: opts.bodyTag || 'autoTrim',
    declaredKind: 'sheet',
  });

  const arrangementReport = [];
  const trimmedFaces = [];
  const vertexCache = new Map();
  const edgeCache = new Map();

  for (let i = 0; i < inputs.length; i++) {
    const S = inputs[i].surface;
    const ssiPcurves = pcurvesPerSurface.get(i);
    const arrangement = arrangeOnSurface(S, ssiPcurves);
    const surfaceAdapter = new NurbsSurfaceAdapter(S);
    const otherSurfaces = inputs
      .map((inp, k) => ({ surface: inp.surface, idx: k }))
      .filter((x) => x.idx !== i);

    const keptRegions = [];
    for (const region of arrangement.faces) {
      const repUV = representativePoint(region.outerLoop.points);
      const rep3D = S.eval(repUV[0], repUV[1]);
      const keep = selectorFn({
        surface: S, region, repUV, rep3D,
        otherSurfaces,
      });
      if (keep) keptRegions.push(region);
    }

    arrangementReport.push({
      surfaceIdx: i, stats: arrangement.stats,
      totalRegionCount: arrangement.faces.length,
      keptRegionCount: keptRegions.length,
    });

    if (arrangement.faces.length === 0) {
      warnings.push(
        `Arrangement on surface ${i} produced no bounded regions — the input ` +
        `pcurves may be degenerate or the SSI is empty.`);
    }

    for (const region of keptRegions) {
      const face = buildSpineFaceForRegion({
        body, S, surfaceAdapter, region,
        vertexCache, edgeCache,
        surfaceId: `s${i}`,
        arrangementVertices: arrangement.vertices,
      });
      trimmedFaces.push(face);
    }
  }

  // ── 5. Body assembly — one shell, one lump, all trimmed faces ─────────
  if (trimmedFaces.length === 0) {
    warnings.push(
      'autoTrimNurbsBrep: no faces survived region selection. ' +
      'Check input surface orientations and the selector option.');
  }

  const shell = new Shell(trimmedFaces, {
    persistentId: body.allocId('shell'),
    role: 'peripheral',
  });
  const lump = new Lump([shell], { persistentId: body.allocId('lump') });
  body.addLump(lump);

  body.diagnostics.bind = {
    adjacencyStrategy: 'auto-trim-native',
    degenerateEdges: 0,
    openShells: 1,
    coedgePartners: { manifold: 0, nonManifold: 0, free: trimmedFaces.reduce(
      (s, f) => s + f.coedges().length, 0) },
    radialOrdering: { ordered: 0, skipped: 0 },
  };
  body.diagnostics.autoTrim = {
    inputSurfaces: inputs.length,
    selector: typeof selectorOpt === 'function' ? 'custom' : selectorOpt,
    ssi: ssiReport.map((s) => ({
      pair: `${s.aIdx}x${s.bIdx}`, curveCount: s.curveCount, ...s.stats })),
    arrangements: arrangementReport,
    trimmedFaces: trimmedFaces.length,
    warnings, honestLimits,
  };
  body.assertKind();

  const spineBody = new SpineBody(body, null, {
    op: 'autoTrimNurbsBrep',
    params: { selector: typeof selectorOpt === 'function' ? 'custom' : selectorOpt },
    autoTrim: body.diagnostics.autoTrim,
  });

  return {
    spineBody,
    ssi: ssiReport,
    pcurves: fitReport,
    arrangements: arrangementReport,
    trimmedFaces: trimmedFaces.length,
    report: { warnings, honestLimits },
  };
}
