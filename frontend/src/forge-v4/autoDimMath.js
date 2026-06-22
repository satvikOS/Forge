// PUSH-136 (Slice 101 / Auto-dimensioning) — pure math layer.
//
// These helpers were originally inlined in `AutoDimPanel.jsx`, but they
// are pure (no React, no DOM) and are reused by the AUTO-2D-DRAWING
// engine (`drawing/autoDrawing.js`) and exercised by plain-Node
// (`node --test`) suites that cannot import a `.jsx` module (Node has no
// JSX transform). Extracting them here gives ONE source of truth that
// both the React panel and the headless drawing engine import.
//
// Hard constraint (PUSH-136): NO new npm packages — pure JS over the
// `forge.drawings.projectView` V2 view `{visibleEdges, hiddenEdges, bbox}`.

// All three orthographic views the auto-dim pass scans so it can derive
// the full 3D extent regardless of which view the user has selected.
export const ORTHO_VIEWS = Object.freeze(['front', 'top', 'right']);

// Per-view bbox-axis labels in the kernel's projection convention:
//   front (look -Y) → screen X = world X (width),  screen Y = world Z (depth)
//   top   (look -Z) → screen X = world X (width),  screen Y = world Y (height)
//   right (look -X) → screen X = world Y (height), screen Y = world Z (depth)
export const VIEW_AXIS_LABELS = Object.freeze({
  front: { width: 'width', height: 'depth' },
  top:   { width: 'width', height: 'height' },
  right: { width: 'height', height: 'depth' },
});

// Hole-detection tolerances.
export const HOLE_RADIUS_TOL = 0.15;   // 15 % of mean radius
export const HOLE_MIN_VERTS  = 6;      // at least a hexagon
export const HOLE_MIN_RADIUS = 0.5;    // mm

/**
 * Compute the 2D bbox of an HLR view's visibleEdges. Trusts the kernel's
 * pre-computed bbox when finite, otherwise recomputes off the polylines.
 *
 * @param {{bbox?: {minX, minY, maxX, maxY}, visibleEdges?: Array}} view
 * @returns {{minX, minY, maxX, maxY, width, height}|null}
 */
export function bboxOfView(view) {
  if (!view) return null;
  let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
  const bb = view.bbox;
  if (bb && Number.isFinite(bb.minX) && Number.isFinite(bb.maxX)
         && Number.isFinite(bb.minY) && Number.isFinite(bb.maxY)) {
    minX = bb.minX; minY = bb.minY; maxX = bb.maxX; maxY = bb.maxY;
  } else {
    const edges = Array.isArray(view.visibleEdges) ? view.visibleEdges : [];
    for (const pl of edges) {
      if (!Array.isArray(pl)) continue;
      for (const p of pl) {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)
     || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
  return {
    minX, minY, maxX, maxY,
    width:  maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Detect circular holes in an HLR view's visibleEdges. Each visible
 * polyline is a candidate circle; accepted when its vertex spread is
 * circle-consistent (max deviation < HOLE_RADIUS_TOL × meanRadius), it
 * has ≥ HOLE_MIN_VERTS vertices, and it is closed.
 *
 * @returns {Array<{cx, cy, diameter, radius, edgeIndex}>}
 */
export function detectHoles(view) {
  if (!view || !Array.isArray(view.visibleEdges)) return [];
  const out = [];
  for (let i = 0; i < view.visibleEdges.length; i += 1) {
    const pl = view.visibleEdges[i];
    if (!Array.isArray(pl) || pl.length < HOLE_MIN_VERTS) continue;
    let cx = 0, cy = 0, n = 0;
    for (const p of pl) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      cx += p.x; cy += p.y; n += 1;
    }
    if (n < HOLE_MIN_VERTS) continue;
    cx /= n; cy /= n;
    let rSum = 0, rMax = -Infinity, rMin = +Infinity;
    for (const p of pl) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const dx = p.x - cx, dy = p.y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      rSum += r;
      if (r > rMax) rMax = r;
      if (r < rMin) rMin = r;
    }
    const rMean = rSum / n;
    if (!Number.isFinite(rMean) || rMean < HOLE_MIN_RADIUS) continue;
    const dev = Math.max(Math.abs(rMax - rMean), Math.abs(rMin - rMean));
    if (dev / rMean > HOLE_RADIUS_TOL) continue;
    // Reject open polylines: a true tessellated circle closes on itself.
    const first = pl[0], last = pl[pl.length - 1];
    const closeDx = last.x - first.x, closeDy = last.y - first.y;
    const closeDist = Math.sqrt(closeDx * closeDx + closeDy * closeDy);
    if (closeDist / rMean > 0.5) continue;
    out.push({ cx, cy, radius: rMean, diameter: 2 * rMean, edgeIndex: i });
  }
  return out;
}
