/**
 * ArchDisc Kernel — Sketch Profile extraction.
 *
 * Turns sketch geometry into closed, correctly-oriented 2-D loops ready to
 * feed a feature operation (extrude, cut, revolve). Kernel-free pure math.
 *
 * Convention: an outer boundary is counter-clockwise (CCW, positive signed
 * area); a hole is clockwise (CW). This matches manifold-3d's
 * CrossSection.ofPolygons([outerCCW, ...holesCW]).
 */

/**
 * Signed area of a closed polygon via the shoelace formula.
 * Positive for counter-clockwise winding, negative for clockwise.
 *
 * @param {Array<[number,number]>} poly  polygon vertices (no repeated first pt)
 * @returns {number}
 */
export function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/**
 * @param {Array<[number,number]>} poly
 * @returns {boolean} true if the polygon is wound clockwise
 */
export function isClockwise(poly) {
  return signedArea(poly) < 0;
}

/**
 * Return a copy of `poly` wound in the requested direction. Never mutates
 * the input.
 *
 * @param {Array<[number,number]>} poly
 * @param {boolean} ccw  true -> counter-clockwise, false -> clockwise
 * @returns {Array<[number,number]>}
 */
export function orient(poly, ccw = true) {
  const cw = isClockwise(poly);
  const needsReverse = (ccw && cw) || (!ccw && !cw);
  return needsReverse ? [...poly].reverse() : [...poly];
}
