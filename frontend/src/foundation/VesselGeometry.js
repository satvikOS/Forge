/**
 * VesselGeometry — meridional profile of an ASME-style ellipsoidal
 * vertical pressure vessel. Pure-math counterpart to the stress
 * routines in PressureVessel.js (which already lives in this folder
 * and does Lamé + thin-wall): this module just emits the 2D half-
 * section the kernel's revolve op needs to build the solid.
 *
 * The 2:1 ellipsoidal head spec (ASME Sec VIII Div 1) has the
 * canonical "stretched dome" you see on every propane tank, gas
 * separator, and chemical reactor — major axis = D/2 (radial),
 * minor axis = D/4 (vertical).
 *
 * Coordinate convention (matches Manifold.revolve, which rotates
 * around the Y-axis):
 *   x = radial distance from axis (mm), ≥ 0
 *   y = vertical height in the vessel (mm)
 * Profile starts on the axis at the BOTTOM apex (0, 0), traces the
 * outer wall around the bottom head + shell + top head, and finishes
 * on the axis at the TOP apex (0, D/2 + L). Manifold.revolve closes
 * the loop along the Y-axis automatically.
 */

const EPS = 1e-9;

/**
 * Sample a quarter-ellipse from `startT` to `endT` (radians) on an
 * ellipse centred at (cx, cy) with semi-axes (a, b):
 *   x = cx + a · cos(t),  y = cy + b · sin(t)
 * Returns segments+1 points (start + end both included).
 */
export function sampleEllipseArc(cx, cy, a, b, startT, endT, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = startT + (endT - startT) * (i / segments);
    pts.push([cx + a * Math.cos(t), cy + b * Math.sin(t)]);
  }
  return pts;
}

/**
 * Closed meridional half-section of a 2:1-ellipsoidal pressure vessel
 * of diameter D and cylindrical-shell length L. Profile traces:
 *   1. bottom head quarter-ellipse from (0, 0) → (D/2, D/4)
 *   2. cylindrical shell from (D/2, D/4) → (D/2, D/4 + L)
 *   3. top head quarter-ellipse from (D/2, D/4 + L) → (0, D/2 + L)
 *
 * Manifold.revolve closes the loop along the axis. The polygon is
 * already on the +X side so it gets revolved verbatim.
 */
export function ellipsoidalVesselProfile({ D, L, headSegments = 32 }) {
  if (!(D > 0)) throw new Error('VesselGeometry: D must be > 0');
  if (!(L >= 0)) throw new Error('VesselGeometry: L must be ≥ 0');
  const a = D / 2;
  const b = D / 4;
  // Bottom head: ellipse centred at (0, b), parametrise t = −π/2 → 0.
  const bottomHead = sampleEllipseArc(0, b, a, b, -Math.PI / 2, 0, headSegments);
  const shellTop = b + L;
  const shell = (L > EPS) ? [[a, shellTop]] : [];
  // Top head: ellipse centred at (0, shellTop), parametrise t = 0 → π/2.
  // Slice(1) drops the duplicated (a, shellTop) point.
  const topHead = sampleEllipseArc(0, shellTop, a, b, 0, Math.PI / 2, headSegments).slice(1);
  return [...bottomHead, ...shell, ...topHead];
}

/**
 * Analytic volume of the SOLID 2:1-ellipsoidal vessel — two half-
 * ellipsoid heads (combining into one full ellipsoid of semi-axes
 * (D/2, D/4, D/2)) plus a cylindrical shell:
 *   V = (4/3)·π·(D/2)²·(D/4) + π·(D/2)²·L
 *     = (π·D³)/12 + (π·D²·L)/4
 */
export function predictVesselVolume(D, L) {
  const a = D / 2;
  return (Math.PI * D * D * D) / 12 + Math.PI * a * a * L;
}

/**
 * Overall height of the vessel = bottom head depth + shell + top head
 * depth = D/4 + L + D/4 = L + D/2.
 */
export function vesselHeight(D, L) {
  return L + D / 2;
}
