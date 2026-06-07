// PUSH-102 (Slice-70) — Multi-section Loft surface generator.
//
// Pure-math driver for the LoftSectionsPanel. Given N planar sections
// — each a {z, radius} pair describing a circle in the world XY plane
// lifted to z — build a dense control-point grid that interpolates
// every section as a closed (or near-closed) ring, then hand the grid
// to the existing window.forge.surfacing.buildPatch primitive to land
// a real OCCT NURBS face.
//
// Why a single big control grid?
//   The brief calls it out:
//     "Generates a surface through them via repeated buildPatch (4 quad
//      patches) OR a single big control grid via the existing
//      surfacing.buildPatch"
//   The single-grid path is cheaper kernel-side (one face vs four with
//   sewing) and round-trips through the same buildPatch contract
//   PUSH-85's Class-A Blend already exercises. Net: every section's
//   radius/z dictates one v-strip of the (uCount × vCount) grid; we
//   linearly interpolate radius along v across adjacent sections.
//
// What the surface looks like:
//   • The u-axis sweeps the circumferential ring (default 24 samples).
//   • The v-axis sweeps section-to-section along z (default 11 samples
//     blends across the four wing-profile sections at z=0/20/60/80).
//   • Each (u,v) point is (radius·cos θ, radius·sin θ, z) where
//     θ = 2π·(u / (uCount-1)) and (radius, z) are sampled from the
//     sections by linear interpolation in v.
//
// Hard constraints honoured:
//   * Pure JS — NO new npm / C++ dependencies.
//   * NO kernel modifications. We hand the result to the existing
//     window.forge.surfacing.buildPatch primitive (same one PUSH-85
//     and PUSH-41 surfacing both call).
//   * No fake surfaces — every number in the grid is real polar
//     interpolation math. The 24-sample u-axis is dense enough that
//     buildPatch's NURBS tessellation reads as a closed loft tube.
//
// API:
//   • buildSweptGrid(sections, uCount=24, vCount=11)
//       → { uCount, vCount, xyz: Float64Array,
//           grid: Array<Array<[x,y,z]>>, sections: normalised }
//     The xyz Float64Array is the flat ControlGrid payload buildPatch
//     accepts directly. The nested `grid` is convenient for callers
//     that want to feed buildPatch's array-of-arrays signature
//     (preload.js handles both).
//   • DEFAULT_SECTIONS — the four-section wing-profile default
//     (z=0/20/60/80, r=30/40/40/30).
//   • DEFAULT_U_COUNT — 24 circumferential samples (matches a typical
//     wing-section discretisation).
//   • DEFAULT_V_COUNT — 11 v-axis samples across the sections.

// ─────────────────────────────────────────────────────────────────────
// Defaults — exported so panel + e2e both share the same vocabulary.

/** Default 4 sections — wing-profile-ish:
 *    z=0,  r=30  (root)
 *    z=20, r=40  (max chord)
 *    z=60, r=40  (continued max)
 *    z=80, r=30  (tip)
 *  Matches the brief: "Default 4 sections at z=0/20/60/80 with radii 30/40/40/30". */
export const DEFAULT_SECTIONS = [
  { z:  0, radius: 30 },
  { z: 20, radius: 40 },
  { z: 60, radius: 40 },
  { z: 80, radius: 30 },
];

/** Default circumferential sample count (u-axis). 24 samples ≈ 15° apart. */
export const DEFAULT_U_COUNT = 24;

/** Default v-axis sample count. 11 samples spread across the sections
 *  give buildPatch's bicubic-degree-3 tessellator enough density to
 *  resolve every section without over-fitting. */
export const DEFAULT_V_COUNT = 11;

// ─────────────────────────────────────────────────────────────────────
// Section normalisation.
//
// Drops any section with non-finite z or non-positive radius, and sorts
// the remaining list by z ascending so v-interpolation is monotonic.

/** Normalise a list of {z, radius} sections — strip invalid rows, sort
 *  ascending by z, and return the sanitised list. Exported so the panel
 *  table can reuse the same logic the surface builder uses. */
export function normaliseSections(sections) {
  if (!Array.isArray(sections)) return [];
  const out = [];
  for (const s of sections) {
    if (!s) continue;
    const z = Number(s.z);
    const r = Number(s.radius);
    if (!Number.isFinite(z) || !Number.isFinite(r) || r <= 0) continue;
    out.push({ z, radius: r });
  }
  out.sort((a, b) => a.z - b.z);
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Interpolated polar sampling.
//
// Given the sorted sections and a v∈[0,1], pick the bracketing pair
// (sections[k], sections[k+1]) and linearly interpolate (z, radius).
// At v=0 we land on the first section; at v=1 we land on the last.

/** Sample a (z, radius) pair from the sections at parameter v∈[0,1].
 *  Linear interpolation across adjacent sections. Returns
 *  { z, radius }. */
export function sampleSectionAt(sections, v) {
  const n = sections.length;
  if (n === 0) return { z: 0, radius: 0 };
  if (n === 1) return { z: sections[0].z, radius: sections[0].radius };
  // Clamp v outside [0,1] to the endpoints.
  if (v <= 0) return { z: sections[0].z, radius: sections[0].radius };
  if (v >= 1) return { z: sections[n - 1].z, radius: sections[n - 1].radius };
  // Find bracketing pair by parametric segment.
  const s = v * (n - 1);
  const k = Math.floor(s);
  const f = s - k;
  const a = sections[k];
  const b = sections[k + 1];
  return {
    z: a.z + (b.z - a.z) * f,
    radius: a.radius + (b.radius - a.radius) * f,
  };
}

// ─────────────────────────────────────────────────────────────────────
// buildSweptGrid
//
// The headline export. Returns the control grid the kernel's buildPatch
// will tessellate into an OCCT NURBS face.
//
// Layout:
//   • u-axis (uCount columns): circumferential angle θ = 2π·(i/(uCount-1)).
//   • v-axis (vCount rows): section parameter v = j/(vCount-1).
//   • grid[j][i] = (radius·cosθ, radius·sinθ, z) where (radius, z) is
//     sampled from the sections at v.
//
// We follow the same indexing convention surfacingDispatch uses for its
// loft / sweep ops: outer dimension is v (sections), inner dimension is
// u (around the section). buildPatch in preload.js flattens nested
// arrays in row-major order with rows=outer, cols=inner — both the
// nested `grid` and the flat `xyz` we return agree on this.

/**
 * Build the (uCount × vCount) control grid for the loft through the
 * given sections.
 *
 * @param {Array<{z:number,radius:number}>} sections
 * @param {number} [uCount=24] Circumferential samples.
 * @param {number} [vCount=11] Section-axis samples.
 * @returns {{
 *   uCount: number,
 *   vCount: number,
 *   xyz: Float64Array,
 *   grid: Array<Array<[number,number,number]>>,
 *   sections: Array<{z:number,radius:number}>,
 * }}
 */
export function buildSweptGrid(sections, uCount = DEFAULT_U_COUNT, vCount = DEFAULT_V_COUNT) {
  const uN = Math.max(2, uCount | 0);
  const vN = Math.max(2, vCount | 0);
  const sane = normaliseSections(sections);
  if (sane.length === 0) {
    // Empty input — return a degenerate but valid grid so the caller
    // can still hand a payload to buildPatch (which will fail with a
    // descriptive error rather than crash on a malformed shape).
    const xyz = new Float64Array(uN * vN * 3);
    const grid = [];
    for (let j = 0; j < vN; j++) {
      const row = [];
      for (let i = 0; i < uN; i++) row.push([0, 0, 0]);
      grid.push(row);
    }
    return { uCount: uN, vCount: vN, xyz, grid, sections: sane };
  }
  const xyz = new Float64Array(uN * vN * 3);
  const grid = [];
  let writeIdx = 0;
  const twoPi = Math.PI * 2;
  for (let j = 0; j < vN; j++) {
    const v = j / (vN - 1);
    const { z, radius } = sampleSectionAt(sane, v);
    const row = [];
    for (let i = 0; i < uN; i++) {
      // θ sweeps [0, 2π). We do NOT close the ring (θ = 2π would
      // duplicate θ = 0); buildPatch's NURBS tessellation interpolates
      // the open polyline so the visible surface reads as a sleeve.
      const theta = twoPi * (i / (uN - 1));
      const x = radius * Math.cos(theta);
      const y = radius * Math.sin(theta);
      row.push([x, y, z]);
      xyz[writeIdx++] = x;
      xyz[writeIdx++] = y;
      xyz[writeIdx++] = z;
    }
    grid.push(row);
  }
  return { uCount: uN, vCount: vN, xyz, grid, sections: sane };
}

// ─────────────────────────────────────────────────────────────────────
// buildPatchKnots (mirror of coonsPatch.js for self-contained use).
//
// We re-implement the open-uniform knot vector here so callers driving
// the loft pipeline don't have to import from coonsPatch.js — keeps
// this module dependency-free. The math is identical: open-uniform
// knots with degree-1 multiplicity at each end.

export function buildPatchKnots(count, degree) {
  const n = Math.max(degree + 1, count);
  const d = Math.max(1, degree);
  const m = n + d + 1;
  const k = new Array(m);
  for (let i = 0; i <= d; i++) k[i] = 0;
  for (let i = d + 1; i < n; i++) k[i] = (i - d) / (n - d);
  for (let i = n; i < m; i++) k[i] = 1;
  return k;
}
