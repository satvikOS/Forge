/**
 * ArchDisc Foundation — Sketch → Profile (CrossSection) bridge.
 *
 * Converts an ordered set of sketch entities into a manifold-3d
 * `CrossSection`. The CrossSection is the 2D primitive that feeds
 * `Manifold.extrude` and `Manifold.revolve`.
 *
 * The caller passes a list of "loops". Each loop is an ordered list of
 * sketch entities (lines + arcs + circles) that form a closed boundary.
 * One loop = one outer contour. Additional loops are interpreted as
 * holes (inner contours).
 *
 * For each loop we sample points along entities (arcs are tessellated
 * using the manifold default circular-segment count — adjustable via
 * `setCircularSegments` upstream).
 */

import { getManifold } from './manifoldKernel.js';

const ARC_SEGMENTS_DEFAULT = 32;

/**
 * Sample points along an arc from start to end angle.
 */
function sampleArc(arc, segments) {
  const { center } = arc;
  const r = arc.radius();
  let a0 = arc.startAngle();
  let a1 = arc.endAngle();
  if (arc.ccw) {
    while (a1 <= a0) a1 += 2 * Math.PI;
  } else {
    while (a1 >= a0) a1 -= 2 * Math.PI;
  }
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const a = a0 + (a1 - a0) * t;
    pts.push([center.x + r * Math.cos(a), center.y + r * Math.sin(a)]);
  }
  return pts;
}

function sampleCircle(circle, segments) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    pts.push([
      circle.center.x + circle.radius * Math.cos(a),
      circle.center.y + circle.radius * Math.sin(a),
    ]);
  }
  return pts;
}

/**
 * Convert a loop (ordered entities) into a flat list of [x, y] points.
 * Lines contribute their start point; arcs are sampled into segments;
 * a circle in a loop is treated as a complete closed curve and
 * returned alone (no other entities in that loop allowed).
 */
function loopToPoints(loop, arcSegments = ARC_SEGMENTS_DEFAULT) {
  // single circle loop
  if (loop.length === 1 && loop[0].type === 'circle') {
    return sampleCircle(loop[0], arcSegments * 4);
  }
  const pts = [];
  for (const e of loop) {
    if (e.type === 'line') {
      pts.push([e.p1.x, e.p1.y]);
    } else if (e.type === 'arc') {
      pts.push(...sampleArc(e, arcSegments));
    } else if (e.type === 'circle') {
      throw new Error('Circle inside multi-entity loop is ambiguous; use arcs instead');
    } else {
      throw new Error(`Unknown loop entity type: ${e.type}`);
    }
  }
  return pts;
}

/**
 * Compute signed area of a polygon (positive = CCW).
 */
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += (x2 - x1) * (y2 + y1);
  }
  return -a / 2;
}

function ensureCCW(pts) {
  return signedArea(pts) > 0 ? pts : pts.slice().reverse();
}
function ensureCW(pts) {
  return signedArea(pts) < 0 ? pts : pts.slice().reverse();
}

/**
 * Build a manifold-3d CrossSection from one or more closed loops.
 *
 * @param {Array<Array>} loops - array of loops; each loop is an array
 *   of sketch entities (line/arc/circle).
 * @param {object} options
 * @param {number} options.arcSegments - circular tessellation per arc
 * @returns {Promise<CrossSection>}
 */
export async function buildCrossSection(loops, options = {}) {
  const { CrossSection } = await getManifold();
  const arcSegments = options.arcSegments ?? ARC_SEGMENTS_DEFAULT;

  if (!loops || loops.length === 0) throw new Error('No loops provided');

  const polygons = loops.map((loop, i) => {
    const pts = loopToPoints(loop, arcSegments);
    if (pts.length < 3) throw new Error(`Loop ${i} has ${pts.length} points (< 3)`);
    // First loop = outer (CCW). Subsequent loops = holes (CW).
    return i === 0 ? ensureCCW(pts) : ensureCW(pts);
  });

  return new CrossSection(polygons, 'EvenOdd');
}

/**
 * Convenience: build CrossSection from raw [[x,y],…] polygon arrays.
 * First polygon = outer (CCW); rest = holes (CW). Auto-fixes winding.
 */
export async function crossSectionFromPolygons(polygons) {
  const { CrossSection } = await getManifold();
  const fixed = polygons.map((p, i) => i === 0 ? ensureCCW(p) : ensureCW(p));
  return new CrossSection(fixed, 'EvenOdd');
}

export const _internals = { sampleArc, sampleCircle, loopToPoints, signedArea, ensureCCW, ensureCW };
