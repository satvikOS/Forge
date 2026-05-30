/**
 * HoneycombPanel — flat-top hexagonal-cell grid layout for aerospace /
 * composites honeycomb-core panels. The flagship structural-composite
 * geometry in NX Composites / CATIA CPD / Creo Flexible Modeling.
 *
 * This module produces the 2D footprint of the honeycomb walls: a
 * rectangular panel outline minus the per-cell hex interiors. Pass the
 * resulting polygons into the Manifold CrossSection layer (via
 * extrude) to get the wall-only 3D solid.
 *
 * Geometry contract:
 *   "Side length" s = circumradius of the hex cell (centre → vertex).
 *   Apothem (inradius) r = s · √3 / 2.
 *   Flat-top tessellation (every hex has flat top and bottom edges):
 *     yStep   = s · √3 / 2      (half-row spacing — alternates row parity)
 *     xStep   = 3 · s           (between centres in the SAME row)
 *     odd rows offset by 1.5 · s in +X (so they sit in the gaps of the row below)
 *   So row 0 has centres at (0, 0), (3 s, 0), …; row 1 at (1.5 s, √3 s/2),
 *   (4.5 s, √3 s/2), … — the canonical brick-packed honeycomb.
 *   Wall offset is applied by inset: each edge of each cell moves
 *   inward by wallT / 2, giving an inner hex with circumradius
 *   s − wallT / √3.
 *
 * The panel rectangle is built outline-only; everything outside the
 * panel rectangle is discarded by the boolean subtract in the handler,
 * so cells that overhang the panel edge are clipped naturally (which
 * matches real honeycomb-core terminations on a bonded skin).
 */

const SQRT3 = Math.sqrt(3);

/**
 * Build the regular-hexagon polygon of circumradius `r` centred at
 * (cx, cy), flat-top orientation (one vertex on +X).
 * Returns 6 [x, y] pairs in CCW order.
 */
export function hexagonPolygon(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;     // 0, 60°, 120°, ...
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/**
 * Build all hex cell centres for a flat-top honeycomb panel.
 * Panel is centred on the local origin; W × H is the panel size.
 * `s` is the hex side length (circumradius). `pad` extends the lattice
 * past the panel rim so partial cells appear at the edge.
 *
 * Returns an array of [cx, cy] centres in mm.
 */
export function honeycombCenters(W, H, s, pad = 0) {
  const xStep = 3 * s;                           // between same-row cells
  const yStep = s * SQRT3 / 2;                   // between adjacent rows
  const halfW = W / 2 + pad;
  const halfH = H / 2 + pad;
  const centers = [];
  // Row parity decides whether the row sits at (0, 3s, 6s, …) or
  // (1.5s, 4.5s, 7.5s, …) — the brick-packed offset.
  let row = 0;
  for (let y = -halfH; y <= halfH + 1e-6; y += yStep, row++) {
    const xOffset = (row % 2 === 0) ? 0 : 1.5 * s;
    for (let x = -halfW + xOffset; x <= halfW + 1e-6; x += xStep) {
      centers.push([x, y]);
    }
  }
  return centers;
}

/**
 * Build the panel rectangle (CCW) centred on the local origin.
 * Returns 4 [x, y] pairs.
 */
export function panelRectangle(W, H) {
  const halfW = W / 2, halfH = H / 2;
  return [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]];
}

/**
 * Predict the area of the honeycomb walls in a W × H panel given hex
 * side `s` and wall thickness `wallT`. Approximate but exact in the
 * interior (where every cell is fully contained):
 *
 *   For each interior cell, the contribution to the wall area is the
 *   difference between the unit cell area and the inner-hex area:
 *     A_cell        = (3·√3 / 2) · s²              (one full hex)
 *     A_inner       = (3·√3 / 2) · (s − wallT/√3)²
 *     A_wall_share  = A_cell − A_inner
 *   The number of cells covering W × H is (W · H) / A_cell, so
 *   total wall area ≈ (W · H) · (1 − (1 − wallT / (√3·s))²).
 *
 * This is the closed form a designer reaches for when sizing the
 * weight of a honeycomb core.
 */
export function predictWallArea(W, H, s, wallT) {
  if (s <= 0 || wallT <= 0) return 0;
  const innerRatio = Math.max(0, 1 - wallT / (SQRT3 * s));
  const wallFraction = 1 - innerRatio * innerRatio;
  return W * H * wallFraction;
}
