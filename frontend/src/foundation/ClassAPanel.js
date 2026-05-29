// Class-A surface CONSTRUCTION (kernel-dependent — imports the manifold
// loft path; do NOT import this at node level in e2e). Curvature ANALYSIS
// lives in the kernel-free ClassASurface.js next door.
//
// Produces smooth, curvature-continuous exterior skins (crowned roof /
// hood / door panels) — the kind of doubly-curved bodywork a Class-A
// modeller builds. The result is a closed manifold solid the rest of the
// kernel can boolean / fillet / export, and whose reflection lines read
// clean under zebra-stripe analysis.

import { loft } from './SweepLoft.js';

/**
 * Crowned panel: a doubly-curved constant-thickness skin. The top face
 * crowns parabolically across the WIDTH (crownX) and rises toward the
 * middle of the LENGTH (crownZ), so the surface curves in both directions
 * — the signature of a Class-A body panel.
 *
 * Built by lofting a stack of arched, constant-thickness cross-sections
 * along +Z, so it returns a closed manifold. Resolution (nu × nv) is high
 * enough that facets read as a smooth surface.
 *
 * Local frame: width along X (centred), length along +Z (0..length),
 * crown rises in +Y. Caller rotates/translates into place.
 *
 * @param {object} o
 * @param {number} o.width      panel width  (X, mm)
 * @param {number} o.length     panel length (Z, mm)
 * @param {number} o.crownX     transverse crown height (mm)
 * @param {number} o.crownZ     extra longitudinal crown at mid-length (mm)
 * @param {number} o.thickness  panel thickness (mm)
 * @param {number} [o.nu]       points across the width  (>=8)
 * @param {number} [o.nv]       stations along the length (>=4)
 * @returns {Promise<Manifold>}
 */
export async function crownPanel({
  width = 2000, length = 2400, crownX = 180, crownZ = 120, thickness = 40,
  nu = 30, nv = 26,
}) {
  nu = Math.max(8, Math.floor(nu));
  nv = Math.max(4, Math.floor(nv));
  const profiles = [];
  for (let s = 0; s < nv; s++) {
    const z = (s / (nv - 1)) * length;
    // 0 at both ends → 1 at mid-length: smooth longitudinal crown
    const longFactor = 1 - Math.pow((2 * z / length) - 1, 2);
    const crown = crownX + crownZ * longFactor;
    const top = [], bot = [];
    for (let i = 0; i < nu; i++) {
      const u = -width / 2 + (i / (nu - 1)) * width;
      const t = 2 * u / width;                    // -1..1 across the width
      const vTop = crown * (1 - t * t);            // parabolic transverse arch
      top.push([u, vTop]);
      bot.push([u, vTop - thickness]);
    }
    // closed band: top edge L→R, then bottom edge R→L
    const points2D = top.concat(bot.reverse());
    profiles.push({ points2D, origin: [0, 0, z], normal: [0, 0, 1], up: [0, 1, 0] });
  }
  return await loft({ profiles });
}

/**
 * Swept fender / wheel-arch skin: a curved channel section (a shallow
 * arc) swept along a circular-arc path — a single-curvature Class-A
 * surface for fender flares, wheel arches, cab corner radii.
 *
 * Returns a closed manifold (the arc section is closed into a thin band).
 * Built directly as a quad mesh lofted over the sweep so the caller can
 * pick the arc span and section independently.
 *
 * @param {object} o
 * @param {number} o.archRadius  wheel-arch radius (mm) — path curvature
 * @param {number} o.archSpan    swept angle (deg, e.g. 180 for a full arch)
 * @param {number} o.width       fender width across the tyre (mm)
 * @param {number} o.section     section depth / lip height (mm)
 * @param {number} o.thickness   skin thickness (mm)
 * @param {number} [o.nv]        stations along the arch (>=8)
 * @returns {Promise<Manifold>}
 */
export async function fenderArch({
  archRadius = 560, archSpan = 200, width = 360, section = 140, thickness = 30, nv = 40,
}) {
  nv = Math.max(8, Math.floor(nv));
  const profiles = [];
  const spanRad = archSpan * Math.PI / 180;
  for (let s = 0; s < nv; s++) {
    const a = -spanRad / 2 + spanRad * (s / (nv - 1));
    // path point on the arch (in X-Y, arch opening downward)
    const px = archRadius * Math.sin(a);
    const py = archRadius * Math.cos(a);
    // outward radial direction (the fender lip points outward from centre)
    const rx = Math.sin(a), ry = Math.cos(a);
    // cross-section in (width across Z, lip along radial): a shallow C.
    const top = [], bot = [];
    const half = width / 2;
    for (let i = 0; i < 12; i++) {
      const w = -half + width * (i / 11);
      const lip = section * (1 - Math.pow(w / half, 2)); // shallow crowned lip
      top.push([px + rx * lip, py + ry * lip, w]);
      bot.push([px + rx * (lip - thickness), py + ry * (lip - thickness), w]);
    }
    profiles.push(top.concat(bot.reverse()));
  }
  return await loftStations(profiles);
}

/** NACA-style symmetric airfoil as a closed 2D loop of [xc∈0..1, yfrac]
 *  points (yfrac = half-thickness fraction of chord, per unit t/c). Ordered
 *  upper LE→TE then lower TE→LE so the loop winding matches crownPanel. */
function airfoilLoop(n = 24) {
  const yt = (xc) => 5 * (0.2969 * Math.sqrt(xc) - 0.1260 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
  const up = [], lo = [];
  for (let i = 0; i <= n; i++) { const xc = i / n, y = yt(xc); up.push([xc, y]); lo.push([xc, -y]); }
  return up.concat(lo.slice(1, -1).reverse());
}

/**
 * A real swept, tapered, airfoil-section wing for ONE side (root at the
 * local origin, tip outboard). Unlike a flat crown panel this has genuine
 * planform geometry — leading-edge sweep, dihedral, taper, and a NACA
 * thickness section — lofted from a large root airfoil to a smaller tip
 * airfoil. Aircraft frame: X = span (side 'R' = +X, 'L' = -X), Y = up,
 * Z = chord (leading edge toward +Z). Caller translates the root onto the
 * wing-box. Volume sign is corrected so both sides render solid regardless
 * of loft direction.
 */
export async function sweptWing({
  side = 'R', rootChord = 1500, tipChord = 520, span = 3400,
  sweepDeg = 27, dihedralDeg = 5, rootThick = 0.13, tipThick = 0.10, n = 24,
} = {}) {
  const s = side === 'L' ? -1 : 1;
  const sweep = Math.tan(sweepDeg * Math.PI / 180);
  const dih = Math.tan(dihedralDeg * Math.PI / 180);
  const rootLE = rootChord * 0.5;                 // root chord centred on local z=0
  const tipLE = rootLE - span * sweep;            // tip leading edge swept aft
  const station = (xPos, chord, tc, leZ, yBase, loop) =>
    loop.map(([xc, yf]) => [xPos, yBase + yf * tc * chord, leZ - xc * chord]);
  const build = async (loop) => loftStations([
    station(0, rootChord, rootThick, rootLE, 0, loop),
    station(s * span, tipChord, tipThick, tipLE, span * dih, loop),
  ]);
  const af = airfoilLoop(n);
  let m = await build(af);
  if (m.volume() < 0) { m.delete?.(); m = await build(af.slice().reverse()); }
  return m;
}

/** Loft already-3D station loops (each same length) into a closed solid. */
async function loftStations(stations) {
  const { getManifold } = await import('./manifoldKernel.js');
  const Mod = await getManifold();
  const N = stations.length, M = stations[0].length;
  const verts = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) verts.push(...stations[i][j]);
  const tris = [];
  const idx = (i, j) => i * M + j;
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      tris.push(idx(i, j), idx(i, j1), idx(i + 1, j1));
      tris.push(idx(i, j), idx(i + 1, j1), idx(i + 1, j));
    }
  }
  // end caps (triangle fan over each closed loop)
  const fan = (off, flip) => {
    for (let j = 1; j < M - 1; j++) {
      if (flip) tris.push(off, off + j + 1, off + j);
      else tris.push(off, off + j, off + j + 1);
    }
  };
  fan(0, true);
  fan((N - 1) * M, false);
  const mesh = new Mod.Mesh({ vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris) });
  return new Mod.Manifold(mesh);
}
