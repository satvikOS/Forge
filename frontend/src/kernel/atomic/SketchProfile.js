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

/**
 * Chain a set of loose line segments into closed loops.
 *
 * Each segment is `[[x1,y1],[x2,y2]]`. Segments may be supplied in any order
 * and any direction; chaining walks endpoint-to-endpoint, treating endpoints
 * closer than `tol` as coincident. Every segment must belong to exactly one
 * closed loop or the function throws.
 *
 * @param {Array<[[number,number],[number,number]]>} segments
 * @param {number} tol  endpoint coincidence tolerance (default 1e-6)
 * @returns {Array<Array<[number,number]>>}  closed loops; each loop is a list
 *          of vertices with NO repeated first/last point
 */
export function chainLoops(segments, tol = 1e-6) {
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
  const pool = segments.map((s) => ({ a: s[0], b: s[1], used: false }));
  const loops = [];

  for (let start = 0; start < pool.length; start++) {
    if (pool[start].used) continue;
    pool[start].used = true;

    const loopStart = pool[start].a;
    const loop = [pool[start].a, pool[start].b];
    let tail = pool[start].b;

    while (true) {
      if (loop.length >= 3 && near(tail, loopStart)) break;  // closed

      let advanced = false;
      for (const seg of pool) {
        if (seg.used) continue;
        if (near(seg.a, tail)) { seg.used = true; tail = seg.b; advanced = true; break; }
        if (near(seg.b, tail)) { seg.used = true; tail = seg.a; advanced = true; break; }
      }
      if (!advanced) throw new Error('chainLoops: open chain — cannot close loop');
      loop.push(tail);
    }

    loop.pop();   // final vertex duplicates loopStart — drop it
    if (loop.length < 3) {
      throw new Error('chainLoops: degenerate loop with fewer than 3 vertices');
    }
    loops.push(loop);
  }

  return loops;
}
