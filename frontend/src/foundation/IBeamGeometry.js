/**
 * IBeamGeometry — parametric AISC W-shape (wide-flange) rolled steel
 * beam cross-section. The structural-engineering primitive every
 * civil / industrial CAD ships: AutoCAD (W-shape blocks), Revit
 * (Structural Framing), NX / CATIA / Creo (Standard Sections).
 *
 * A W-shape is described by four dimensions:
 *   d  = total depth (flange-to-flange outside-to-outside)
 *   bf = flange width
 *   tw = web thickness
 *   tf = flange thickness
 * The CCW cross-section polygon is a 12-vertex "I" silhouette centred
 * on the origin, lying in the X-Y plane:
 *
 *          ┌───────────┐  ← y = +d/2
 *          │           │
 *          └──┐     ┌──┘  ← y = +d/2 − tf
 *             │     │
 *             │     │     ← web of thickness tw
 *             │     │
 *          ┌──┘     └──┐  ← y = −d/2 + tf
 *          │           │
 *          └───────────┘  ← y = −d/2
 *
 * The kernel already carries AISC tables in
 * `kernel/atomic/standards/data/aisc.js`; this module ships a tiny
 * preset map for the four most common metric-imperial W-shapes so the
 * Sculpt handler can offer them as a dropdown.
 */

/**
 * Build the CCW closed polygon for a W-shape cross-section, centred on
 * the origin (X = horizontal width, Y = vertical depth). Returns an
 * array of [x, y] pairs ready to feed to Manifold.extrude.
 */
export function wShapeProfile({ d, bf, tw, tf }) {
  if (!(d > 0 && bf > 0 && tw > 0 && tf > 0)) {
    throw new Error('IBeam: d, bf, tw, tf must all be > 0');
  }
  if (tw > bf - 1e-6) throw new Error('IBeam: web thickness must be < flange width');
  if (2 * tf > d - 1e-6) throw new Error('IBeam: 2 × flange thickness must be < depth');
  const hbf = bf / 2, htw = tw / 2;
  const yTopOuter   = d / 2;
  const yTopInner   = d / 2 - tf;
  const yBotInner   = -d / 2 + tf;
  const yBotOuter   = -d / 2;
  // CCW (looking from +Z), starting at bottom-left of the bottom flange.
  return [
    [-hbf, yBotOuter],
    [ hbf, yBotOuter],
    [ hbf, yBotInner],
    [ htw, yBotInner],
    [ htw, yTopInner],
    [ hbf, yTopInner],
    [ hbf, yTopOuter],
    [-hbf, yTopOuter],
    [-hbf, yTopInner],
    [-htw, yTopInner],
    [-htw, yBotInner],
    [-hbf, yBotInner],
  ];
}

/**
 * Analytic cross-sectional area of a W-shape:
 *   A = 2·bf·tf + tw·(d − 2·tf)
 * Used as a sanity check vs the marching-cubes / extrude volume / L.
 */
export function wShapeArea({ d, bf, tw, tf }) {
  return 2 * bf * tf + tw * (d - 2 * tf);
}

/**
 * Small preset map for the most commonly-spec'd W-shapes. Dimensions
 * are in millimetres rounded from the imperial AISC catalogue.
 * Designations follow the imperial convention (Wd × wt/ft).
 */
export const WSHAPE_PRESETS = {
  'W8x10':   { d: 200, bf: 100, tw:  4.3, tf:  5.2 },
  'W12x26':  { d: 310, bf: 165, tw:  5.8, tf:  9.7 },
  'W18x35':  { d: 450, bf: 152, tw:  7.5, tf: 10.8 },
  'W24x68':  { d: 600, bf: 230, tw: 10.5, tf: 14.9 },
};
