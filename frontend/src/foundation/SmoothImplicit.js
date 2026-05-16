/**
 * ArchDisc Foundation — smooth implicit (SDF) filleting.
 *
 * A *selective* analytic-blend fillet on arbitrary curved B-Rep — pick
 * an edge of an existing body, replace it with a trimmed G1 blend
 * surface — needs a full NURBS B-Rep kernel with face/edge topology.
 * ArchDisc's geometry kernel (manifold-3d) is a mesh CSG kernel, so
 * that path is genuinely out of scope here and this module does not
 * pretend otherwise.
 *
 * What it DOES deliver is the smooth fillet technique that implicit-
 * modelling CAD kernels (e.g. nTopology) ship as a production feature:
 * filleting in the implicit construction tree. Bodies are described by
 * signed-distance functions; a *smooth* boolean (smooth-min / smooth-
 * max) rounds the seam it creates into a true circular-arc blend. The
 * result is surface-extracted by Manifold.levelSet (marching
 * tetrahedra) into a watertight manifold whose fillet is a genuinely
 * smooth curved surface — not a voxel staircase. Refining edgeLength
 * converges to the exact blend.
 *
 * The `smin` here is the circular variant: its radius parameter is the
 * exact geometric fillet radius. For two perpendicular planar faces the
 * zero-isocontour of smin is a circular arc of radius r tangent to both
 * faces — i.e. a constant-radius rolling-ball fillet.
 *
 * SDF sign convention in this module: OUTSIDE-positive (standard SDF,
 * negative inside). levelSetManifold negates to match manifold-3d's
 * inside-positive levelSet convention.
 */

// ── Signed-distance primitives (outside-positive) ──────────────────

/** Sphere of radius r centred at c. */
export function sdSphere(p, c, r) {
  return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r;
}

/** Axis-aligned box, centre c, half-extents he. Exact Euclidean SDF. */
export function sdBox(p, c, he) {
  const qx = Math.abs(p[0] - c[0]) - he[0];
  const qy = Math.abs(p[1] - c[1]) - he[1];
  const qz = Math.abs(p[2] - c[2]) - he[2];
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  const inside = Math.min(Math.max(qx, qy, qz), 0);
  return outside + inside;
}

/** Box with every edge rounded to radius r (exact rounded-box SDF). */
export function sdRoundBox(p, c, he, r) {
  return sdBox(p, c, [he[0] - r, he[1] - r, he[2] - r]) - r;
}

/** Z-aligned capped cylinder, centre c, radius R, half-height hz. */
export function sdCappedCylinderZ(p, c, R, hz) {
  const dRad = Math.hypot(p[0] - c[0], p[1] - c[1]) - R;
  const dAx = Math.abs(p[2] - c[2]) - hz;
  const outside = Math.hypot(Math.max(dRad, 0), Math.max(dAx, 0));
  const inside = Math.min(Math.max(dRad, dAx), 0);
  return outside + inside;
}

// ── Boolean operators (outside-positive convention) ────────────────

export const opUnion = (a, b) => Math.min(a, b);
export const opIntersect = (a, b) => Math.max(a, b);
export const opSubtract = (a, b) => Math.max(a, -b);

/**
 * Circular smooth-minimum. The zero-isocontour of a smooth union built
 * with this is a circular arc of radius exactly `r` — a true constant-
 * radius fillet. Reduces to plain min when the operands differ by more
 * than r (i.e. away from the seam).
 */
export function smin(a, b, r) {
  if (!(r > 0)) return Math.min(a, b);
  const h = Math.max(r - Math.abs(a - b), 0) / r;
  return Math.min(a, b) - r * 0.5 * (1 + h - Math.sqrt(1 - h * (h - 2)));
}

/** Circular smooth-maximum (rounds convex ridges with radius r). */
export function smax(a, b, r) {
  return -smin(-a, -b, r);
}

/** Smooth union — rounds the concave seam between two solids. */
export const opSmoothUnion = (a, b, r) => smin(a, b, r);
/** Smooth intersection — rounds the convex edge of the overlap. */
export const opSmoothIntersect = (a, b, r) => smax(a, b, r);
/** Smooth subtraction — rounds the concave edge left by a cut. */
export const opSmoothSubtract = (a, b, r) => smax(a, -b, r);

// ── Canonical filleted assembly: a boss on a base ──────────────────

/**
 * Build the SDF (outside-positive) of a cylindrical boss standing on a
 * rectangular base. The seam where the boss meets the base is the
 * single most common fillet in mechanical CAD.
 *
 * @param {object=} opts
 * @param {boolean=} opts.sharp  true → plain union (sharp seam);
 *                                false → smooth union (filleted seam)
 * @param {number=}  opts.filletRadius  fillet radius (mm), default 8
 * @returns {(p:number[]) => number}  outside-positive SDF
 */
export function bossOnBaseField(opts = {}) {
  const baseC = opts.baseCenter ?? [0, 0, 10];
  const baseHE = opts.baseHalfExtents ?? [40, 40, 10];
  const bossC = opts.bossCenter ?? [0, 0, 40];
  const bossR = opts.bossRadius ?? 20;
  const bossHZ = opts.bossHalfHeight ?? 20;
  const r = opts.filletRadius ?? 8;
  const sharp = opts.sharp ?? false;
  return (p) => {
    const dBase = sdBox(p, baseC, baseHE);
    const dBoss = sdCappedCylinderZ(p, bossC, bossR, bossHZ);
    return sharp ? opUnion(dBase, dBoss) : opSmoothUnion(dBase, dBoss, r);
  };
}

/** Bounds (with margin) enclosing the default boss-on-base assembly. */
export const BOSS_ON_BASE_BOUNDS = {
  min: [-45, -45, -5],
  max: [45, 45, 65],
};

// ── Surface extraction via manifold-3d levelSet ────────────────────

/**
 * Extract a watertight manifold from an outside-positive SDF using
 * manifold-3d's marching-tetrahedra level-set. The field is negated
 * to match manifold-3d's inside-positive convention.
 *
 * @param {(p:number[]) => number} field  outside-positive SDF
 * @param {{min:number[],max:number[]}} bounds
 * @param {number} edgeLength  approx. triangle edge length (mm)
 * @param {object} Mod         resolved manifold-3d module
 * @returns {Manifold}
 */
export function levelSetManifold(field, bounds, edgeLength, Mod) {
  return Mod.Manifold.levelSet(
    (p) => -field(p),
    { min: bounds.min, max: bounds.max },
    edgeLength,
  );
}

/**
 * Build the boss-on-base assembly as a manifold, with or without the
 * smooth implicit fillet at the seam.
 *
 * @param {object} Mod  resolved manifold-3d module
 * @param {object=} opts  see bossOnBaseField, plus:
 * @param {number=} opts.edgeLength  marching-tet edge length, default 2
 * @returns {{ manifold, triangleCount, volume, genus, filletRadius, edgeLength, sharp }}
 */
export function buildBossOnBase(Mod, opts = {}) {
  const edgeLength = opts.edgeLength ?? 2;
  const field = bossOnBaseField(opts);
  const manifold = levelSetManifold(field, BOSS_ON_BASE_BOUNDS, edgeLength, Mod);
  const mesh = manifold.getMesh();
  return {
    manifold,
    triangleCount: mesh.triVerts.length / 3,
    volume: manifold.volume(),
    genus: manifold.genus(),
    filletRadius: opts.filletRadius ?? 8,
    edgeLength,
    sharp: opts.sharp ?? false,
  };
}
