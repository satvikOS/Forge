/**
 * ArchDisc Foundation — general turbomachinery blade-row geometry.
 *
 * A blade row (a ring of aerofoils around an axis) is a GENERAL
 * mechanical primitive — fans, compressors, turbines, pumps and
 * propellers all use one. This module provides the 2-D aerofoil
 * cross-section; the caller extrudes it (with twist + chord taper)
 * into one blade — a valid manifold by construction — and arrays it.
 *
 * Kernel-free pure math.
 */

/** Symmetric aerofoil half-thickness at chord fraction s∈[0,1]. */
function halfThickness(s) {
  return 1.4845 * Math.sqrt(s) - 0.63 * s - 1.758 * s * s
    + 1.4215 * s ** 3 - 0.5075 * s ** 4;
}

/**
 * Closed 2-D aerofoil section polygon, chord along X, centred on the
 * origin, thickness along Y. The leading and trailing edges are single
 * shared vertices, so the polygon is simple (non-self-intersecting) and
 * safe for CrossSection.ofPolygons → Manifold.extrude.
 *
 * @param {number} chord       chord length
 * @param {number} thickRatio  max thickness / chord
 * @param {number} nPts        points per surface
 * @returns {number[][]}       closed polygon [[x,y],...]
 */
export function aerofoilSection(chord = 80, thickRatio = 0.10, nPts = 28) {
  const lower = [], upper = [];
  // Lower surface LE→TE, then upper surface TE→LE → counter-clockwise,
  // so CrossSection.ofPolygons reads it as a filled region.
  for (let i = 0; i < nPts; i++) {
    const s = i / (nPts - 1);
    lower.push([(s - 0.5) * chord, -0.5 * thickRatio * chord * halfThickness(s)]);
  }
  for (let i = nPts - 2; i >= 1; i--) {
    const s = i / (nPts - 1);
    upper.push([(s - 0.5) * chord, 0.5 * thickRatio * chord * halfThickness(s)]);
  }
  return [...lower, ...upper];
}

/**
 * Parameters for one blade row, with defaults filled in. The caller
 * (the Blade Row tool handler) uses these to extrude + array blades.
 */
export function bladeRowParams(opts = {}) {
  return {
    count: Math.max(2, Math.round(opts.count ?? 24)),
    rHub: opts.rHub ?? 100,
    rTip: opts.rTip ?? 300,
    xMid: opts.xMid ?? 0,
    chordHub: opts.chordHub ?? 80,
    chordTip: opts.chordTip ?? 60,
    thickRatio: opts.thickRatio ?? 0.10,
    staggerHub: opts.staggerHub ?? 0.9,
    staggerTip: opts.staggerTip ?? 0.4,
  };
}
