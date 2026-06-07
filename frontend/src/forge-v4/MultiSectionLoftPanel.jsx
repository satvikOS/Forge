// PUSH-152 (Slice-112) — Multi-section Loft through Guide Curves.
//
// PUSH-102 (Slice-70) shipped the multi-section loft as a SURFACE built
// from N planar {z, radius} polar sections. PUSH-152 lands the GENERIC
// guide-curve form the wing / hull section workflow needs:
//
//   * Each SECTION is an arbitrary closed polyline of N points (default
//     N=24, so the first section is a 24-pt circle ring at z=0 — the
//     panel's preset is a four-section wing-tube). The user can edit /
//     add / remove points within a section, or add a whole new section.
//   * Each GUIDE CURVE is an arbitrary open polyline of M points. Guide
//     curves run along the loft (parameter v) and DEFLECT each section
//     away from its baseline (the centroid-line that runs section-to-
//     section through the section centroids). The deflection is the
//     vector from the baseline-at-v to the guide-at-v; every point of
//     the section at v gets shifted by that vector. Multiple guides add
//     up (linear superposition).
//   * The resulting (uCount × vCount) control grid is handed to the same
//     window.forge.surfacing.buildPatch primitive PUSH-102 / PUSH-85 /
//     PUSH-107 all use. One face commits as a native SURFACE body.
//
// Why this is real — and how it differs from PUSH-102:
//   PUSH-102's sections are { z, radius } pairs — purely polar rings
//   stacked along Z. PUSH-152 generalises both axes:
//     u-axis: an arbitrary closed polyline (not just a circle).
//     v-axis: arbitrary 3D guide curves (not just a vertical centroid).
//   That's the same parametric form OCCT's BRepOffsetAPI_ThruSections
//   exposes through its `AddSection` + the SweepGuide style of MakePipe
//   — but composed entirely on top of the existing buildPatch primitive
//   so no kernel binding has to change.
//
// Hard constraints (per the slice brief + Forge rules):
//   * NO new npm / C++ / external deps. Pure React + existing
//     surfacing.buildPatch + same helper-API pattern PUSH-102 ships.
//   * NO kernel modifications. Single big control grid → one
//     buildPatch call → one native surface body.
//   * Surgical edits: ONE new menu entry (Menus.jsx) + ONE new mount
//     (App.jsx). The kernel binding is untouched.
//   * Real impl, no MVP / stub / placeholder. Failure paths surface the
//     real error verbatim in the log.
//   * Manual UI clicks NEVER post to Archie's thread or auto-open the
//     dock (Forge feedback rule).
//   * Multi-cam e2e: push-152-multi-section.spec.js captures 5 named
//     camera angles per the Forge-171 multi-cam mandate.
//
// Reachable via:
//   * `tools.multiSectionLoft` menu action,
//   * `window.__forgeOpenMultiSectionLoft()`,
//   * `window.__forgeMultiSectionLoftHelper.runPipeline({ sections, guides })`
//     for headless callers (e2e + plugins + future Archie tool calls).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import { buildPatchKnots } from './loftMath.js';

// ─────────────────────────────────────────────────────────────────────
// Constants — bus event + persistence + presets + sample counts.

export const FORGE_MS_LOFT_EVENT   = 'forge:multi-section-loft-built';
export const FORGE_MS_LOFT_STORAGE = 'forge.v4.multiSectionLoft';

/** Default u-axis (around-the-section) sample count for the buildPatch
 *  control grid. 24 samples matches PUSH-102's polar discretisation. */
export const DEFAULT_U_COUNT = 24;

/** Default v-axis (along-the-loft) sample count for the buildPatch
 *  control grid. 11 samples is dense enough for buildPatch's degree-3
 *  tessellator to resolve four sections without over-fitting. */
export const DEFAULT_V_COUNT = 11;

export const MIN_SECTIONS = 2;
export const MIN_SECTION_POINTS = 3;
export const MIN_GUIDE_POINTS = 2;

/** Build a closed-polyline circular section at (cx, cy, z) with the
 *  given radius. n samples spaced uniformly around 2π — does NOT close
 *  the ring by repeating point 0 (the polyline IS closed, i.e. the
 *  edge from point n-1 to point 0 implicitly closes it). */
function buildCircleSection(cx, cy, z, radius, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const theta = (Math.PI * 2 * i) / n;
    pts.push({
      x: cx + radius * Math.cos(theta),
      y: cy + radius * Math.sin(theta),
      z,
    });
  }
  return pts;
}

/** Sample a smooth deflection-curve point at parameter v∈[0,1] given
 *  the curve's "amplitude" axis (x or y) and the half-span amplitude. */
function deflectionPoint(v, amp, axis = 'y') {
  // A simple lobe: ymax at v=0.5, zero at endpoints. Used to seed
  // the default guide curves so the loft visibly bulges.
  const lobe = Math.sin(Math.PI * v);
  return axis === 'x'
    ? { x: amp * lobe, y: 0, z: 0 }
    : { x: 0, y: amp * lobe, z: 0 };
}

/** Default preset — a four-section wing-like loft:
 *    section 0 — z=0,  r=30 circle (root)
 *    section 1 — z=30, r=42 circle (max chord — wider)
 *    section 2 — z=60, r=38 circle (continued max-ish)
 *    section 3 — z=90, r=22 circle (tip — narrower)
 *  Plus two guide curves:
 *    guide 0 — a +Y deflection lobe (sweep) that peaks at v=0.5
 *    guide 1 — a +X deflection lobe (dihedral) that peaks at v=0.5
 *  The two guides give the loft both sweep and dihedral so the
 *  resulting NURBS face is unambiguously a guide-driven loft (not just
 *  a polar sleeve like PUSH-102). All numbers in millimetres. */
export function defaultSections() {
  return [
    buildCircleSection(0, 0,  0, 30, DEFAULT_U_COUNT),
    buildCircleSection(0, 0, 30, 42, DEFAULT_U_COUNT),
    buildCircleSection(0, 0, 60, 38, DEFAULT_U_COUNT),
    buildCircleSection(0, 0, 90, 22, DEFAULT_U_COUNT),
  ];
}
export function defaultGuides() {
  // Guide 0: +Y sweep lobe sampled at v ∈ {0, 0.25, 0.5, 0.75, 1.0}.
  const g0 = [];
  for (let j = 0; j < 5; j++) {
    const v = j / 4;
    const p = deflectionPoint(v, 18, 'y');
    g0.push({ x: p.x, y: p.y, z: 0 + v * 90 });
  }
  // Guide 1: +X dihedral lobe over the same v samples.
  const g1 = [];
  for (let j = 0; j < 5; j++) {
    const v = j / 4;
    const p = deflectionPoint(v, 12, 'x');
    g1.push({ x: p.x, y: p.y, z: 0 + v * 90 });
  }
  return [g0, g1];
}

// ─────────────────────────────────────────────────────────────────────
// Section / guide normalisation.
//
// Drops invalid rows + coerces every field to a finite number. Sections
// are sorted by their centroid Z so v-interpolation along the loft is
// monotonic. Guides are NOT sorted — the user's order is preserved so a
// guide that loops back on itself stays as-authored.

function sanePoint(p) {
  if (!p) return null;
  const x = Number(p.x), y = Number(p.y), z = Number(p.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}
function sanePolyline(poly, min) {
  if (!Array.isArray(poly)) return [];
  const out = [];
  for (const p of poly) {
    const q = sanePoint(p);
    if (q) out.push(q);
  }
  return out.length >= min ? out : [];
}

/** Centroid Z of a section — used to sort sections along v. */
function sectionZ(poly) {
  if (!poly.length) return 0;
  let s = 0;
  for (const p of poly) s += p.z;
  return s / poly.length;
}

/** Centroid (x, y, z) of a polyline — used as the section's baseline
 *  origin so guide deflections are applied relative to the centroid. */
function centroid(poly) {
  if (!poly.length) return { x: 0, y: 0, z: 0 };
  let sx = 0, sy = 0, sz = 0;
  for (const p of poly) { sx += p.x; sy += p.y; sz += p.z; }
  const n = poly.length;
  return { x: sx / n, y: sy / n, z: sz / n };
}

/** Normalise a list of section polylines. Drops sections with < 3
 *  valid points and sorts the rest by centroid Z ascending. */
export function normaliseSections(sections) {
  if (!Array.isArray(sections)) return [];
  const out = [];
  for (const s of sections) {
    const sane = sanePolyline(s, MIN_SECTION_POINTS);
    if (sane.length) out.push(sane);
  }
  out.sort((a, b) => sectionZ(a) - sectionZ(b));
  return out;
}

/** Normalise a list of guide polylines. Drops guides with < 2 valid
 *  points. Each guide is sorted along its own arc length parameter
 *  (insertion order is preserved — the user authored the path). */
export function normaliseGuides(guides) {
  if (!Array.isArray(guides)) return [];
  const out = [];
  for (const g of guides) {
    const sane = sanePolyline(g, MIN_GUIDE_POINTS);
    if (sane.length) out.push(sane);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Polyline sampling.
//
// For a closed section polyline of N points and a u-parameter ∈ [0, 1),
// linearly interpolate the matching point on the ring (wrapping the
// last → first edge).
//
// For an open guide polyline of M points and a v-parameter ∈ [0, 1],
// linearly interpolate along the arc-length-parameterised path.

/** Sample a closed polyline at parameter u∈[0,1). Wraps the last edge.
 *  Returns { x, y, z }. */
export function sampleClosed(poly, u) {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0, z: 0 };
  if (n === 1) return { ...poly[0] };
  // Map u to [0, n) so the n-th sample wraps to point 0.
  const t = ((u % 1) + 1) % 1;        // normalise into [0,1)
  const s = t * n;
  const k = Math.floor(s) % n;
  const f = s - Math.floor(s);
  const a = poly[k];
  const b = poly[(k + 1) % n];
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
  };
}

/** Sample an open polyline at parameter v∈[0,1] along its uniform
 *  parametric domain (NOT arc-length — keeps this dependency-free). */
export function sampleOpen(poly, v) {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0, z: 0 };
  if (n === 1) return { ...poly[0] };
  if (v <= 0) return { ...poly[0] };
  if (v >= 1) return { ...poly[n - 1] };
  const s = v * (n - 1);
  const k = Math.floor(s);
  const f = s - k;
  const a = poly[k];
  const b = poly[k + 1];
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
  };
}

/** Linearly blend between two sections at parameter f∈[0,1]. Both
 *  sections must have the same point count (the caller normalises
 *  this — see buildSectionAt). */
function blendSections(a, b, f) {
  const n = Math.min(a.length, b.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      x: a[i].x + (b[i].x - a[i].x) * f,
      y: a[i].y + (b[i].y - a[i].y) * f,
      z: a[i].z + (b[i].z - a[i].z) * f,
    };
  }
  return out;
}

/** Resample a closed polyline to a fixed uCount samples by walking the
 *  ring at uniform u-parameter intervals. Idempotent if the polyline
 *  already has uCount points (modulo small fp drift). */
function resampleClosed(poly, uCount) {
  const out = new Array(uCount);
  for (let i = 0; i < uCount; i++) {
    out[i] = sampleClosed(poly, i / uCount);
  }
  return out;
}

/** Build the section profile at v∈[0,1] by lerping the bracketing pair
 *  of sections. Both sections are first resampled to uCount points so
 *  the lerp is index-aligned. */
function buildSectionAt(sections, v, uCount) {
  const n = sections.length;
  if (n === 0) {
    const ring = [];
    for (let i = 0; i < uCount; i++) ring.push({ x: 0, y: 0, z: 0 });
    return ring;
  }
  if (n === 1) return resampleClosed(sections[0], uCount);
  if (v <= 0) return resampleClosed(sections[0], uCount);
  if (v >= 1) return resampleClosed(sections[n - 1], uCount);
  const s = v * (n - 1);
  const k = Math.floor(s);
  const f = s - k;
  const a = resampleClosed(sections[k], uCount);
  const b = resampleClosed(sections[k + 1], uCount);
  return blendSections(a, b, f);
}

// ─────────────────────────────────────────────────────────────────────
// Baseline — the centroid-line that runs through every section's
// centroid in order. Acts as the "spine" that guide curves deflect
// the loft away from.

/** Build the section-centroid baseline (a polyline of n centroids) so
 *  guide curves can be measured as deflections relative to it. */
function buildBaseline(sections) {
  return sections.map((s) => centroid(s));
}

// ─────────────────────────────────────────────────────────────────────
// buildLoftGrid — the headline math.
//
// Combines sections + guide curves into the (uCount × vCount) control
// grid the kernel's buildPatch turns into an OCCT NURBS face.
//
// Outer dimension (rows / u-axis convention here): vCount samples
// stepping along the loft from section-0 to section-(n-1).
// Inner dimension (cols / v-axis convention here): uCount samples
// stepping around each section.
//
// At each (v, u) sample:
//   1. Lerp the bracketing section pair at v to get a resampled ring.
//   2. Sample the centroid-line baseline at v to get the spine point.
//   3. For each guide curve g, sample at v to get a point on the
//      guide. The DEFLECTION VECTOR is (guide_at_v − baseline_at_v).
//   4. Take the ring's point at u and shift by the SUM of every
//      guide's deflection vector. That's the final (x, y, z).
//
// The result is a closed-loop guide-driven loft.

/**
 * Build the (uCount × vCount) control grid for the multi-section loft.
 *
 * @param {Array<Array<{x:number,y:number,z:number}>>} sections
 *   List of closed polylines (each is a section).
 * @param {Array<Array<{x:number,y:number,z:number}>>} guides
 *   List of open polylines (each is a guide curve). May be empty —
 *   in which case the result is a pure section-stack loft.
 * @param {number} [uCount=24] Around-the-section sample count.
 * @param {number} [vCount=11] Along-the-loft sample count.
 * @returns {{
 *   uCount: number,
 *   vCount: number,
 *   xyz: Float64Array,
 *   grid: Array<Array<[number,number,number]>>,
 *   sections: Array<Array<{x:number,y:number,z:number}>>,
 *   guides: Array<Array<{x:number,y:number,z:number}>>,
 *   guideCount: number,
 * }}
 */
export function buildLoftGrid(sections, guides = [],
                              uCount = DEFAULT_U_COUNT,
                              vCount = DEFAULT_V_COUNT) {
  const uN = Math.max(MIN_SECTION_POINTS, uCount | 0);
  const vN = Math.max(2, vCount | 0);
  const ss = normaliseSections(sections);
  const gs = normaliseGuides(guides);
  if (ss.length === 0) {
    const xyz = new Float64Array(uN * vN * 3);
    const grid = [];
    for (let j = 0; j < vN; j++) {
      const row = [];
      for (let i = 0; i < uN; i++) row.push([0, 0, 0]);
      grid.push(row);
    }
    return { uCount: uN, vCount: vN, xyz, grid,
             sections: ss, guides: gs, guideCount: gs.length };
  }
  const baseline = buildBaseline(ss);
  const xyz = new Float64Array(uN * vN * 3);
  const grid = [];
  let w = 0;
  for (let j = 0; j < vN; j++) {
    const v = j / (vN - 1);
    const ring = buildSectionAt(ss, v, uN);
    // Spine point on the centroid baseline.
    const spine = sampleOpen(baseline, v);
    // Sum of guide deflection vectors at v.
    let dx = 0, dy = 0, dz = 0;
    for (const g of gs) {
      const gp = sampleOpen(g, v);
      dx += gp.x - spine.x;
      dy += gp.y - spine.y;
      dz += gp.z - spine.z;
    }
    const row = [];
    for (let i = 0; i < uN; i++) {
      const p = ring[i];
      const x = p.x + dx;
      const y = p.y + dy;
      const z = p.z + dz;
      row.push([x, y, z]);
      xyz[w++] = x;
      xyz[w++] = y;
      xyz[w++] = z;
    }
    grid.push(row);
  }
  return {
    uCount: uN, vCount: vN, xyz, grid,
    sections: ss, guides: gs, guideCount: gs.length,
  };
}

// ─────────────────────────────────────────────────────────────────────
// commitLoftGrid + appendLoftBody — same shape as PUSH-102's helpers so
// downstream listeners can adopt either pipeline.

/** Hand the control grid to window.forge.surfacing.buildPatch and
 *  return { ok, faceHandle, reason, message, gridSpec }. */
export function commitLoftGrid(gridSpec, { uDeg = 3, vDeg = 3 } = {}) {
  if (typeof window === 'undefined' || !window.forge || !window.forge.surfacing) {
    return { ok: false, reason: 'kernel not ready', gridSpec };
  }
  const buildPatch = window.forge.surfacing.buildPatch;
  if (typeof buildPatch !== 'function') {
    return { ok: false, reason: 'buildPatch missing', gridSpec };
  }
  // The control grid we build has outer = vCount rows, inner = uCount
  // columns. preload.js's buildPatch shim flattens nested arrays with
  // rows = uCount, cols = vCount — so the natural way to round-trip is
  // to pass the explicit { uCount, vCount, xyz } spec the kernel
  // understands directly. We re-label here so the kernel's
  // uKnots.length check (= uCount + uDeg + 1) lines up with what we
  // actually generated (vN was the OUTER dimension of our grid).
  const outerCount = gridSpec.vCount;   // vN — along-the-loft
  const innerCount = gridSpec.uCount;   // uN — around-the-section
  const uKnots = buildPatchKnots(outerCount, uDeg);
  const vKnots = buildPatchKnots(innerCount, vDeg);
  try {
    const spec = {
      uCount: outerCount, vCount: innerCount, xyz: gridSpec.xyz,
    };
    const faceHandle = buildPatch(spec, uDeg, vDeg, uKnots, vKnots);
    if (typeof faceHandle !== 'number' || !Number.isFinite(faceHandle)) {
      return { ok: false, reason: 'buildPatch returned non-handle',
               message: String(faceHandle), gridSpec };
    }
    return { ok: true, faceHandle, uKnots, vKnots, uDeg, vDeg, gridSpec };
  } catch (err) {
    return { ok: false, reason: 'buildPatch threw',
             message: err && err.message ? err.message : String(err),
             gridSpec };
  }
}

/** Append a surface body to the live scene. */
export function appendLoftBody(faceHandle, {
  sections, guides, uCount, vCount, name,
}) {
  if (typeof window === 'undefined') return null;
  const ts = Date.now();
  const id = `multi-section-loft-${ts}`;
  const body = {
    id, kind: 'native', handle: faceHandle,
    toolId: 'surfacing.multiSectionLoft',
    surface: true,
    params: {
      sectionCount: sections.length,
      guideCount: guides.length,
      uCount, vCount,
    },
    name: name || `Multi-section Loft (${sections.length}×${guides.length})`,
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }
  return body;
}

/** Top-level driver — sections + guides → buildLoftGrid → buildPatch
 *  → __forgeAppendBody → bus event. Used by both the panel Apply
 *  button and the e2e spec. */
export function runMultiSectionLoftPipeline({
  sections = defaultSections(),
  guides = defaultGuides(),
  uCount = DEFAULT_U_COUNT,
  vCount = DEFAULT_V_COUNT,
} = {}) {
  const ss = normaliseSections(sections);
  if (ss.length < MIN_SECTIONS) {
    return { ok: false, reason: `need at least ${MIN_SECTIONS} sections`,
             sections: ss };
  }
  const gs = normaliseGuides(guides);
  const gridSpec = buildLoftGrid(ss, gs, uCount, vCount);
  const built = commitLoftGrid(gridSpec);
  if (!built.ok) {
    return { ok: false, reason: built.reason, message: built.message,
             gridSpec };
  }
  const body = appendLoftBody(built.faceHandle, {
    sections: ss, guides: gs, uCount, vCount,
    name: `Multi-section Loft (${ss.length} sections, ${gs.length} guides)`,
  });
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FORGE_MS_LOFT_EVENT, {
        detail: {
          faceHandle: built.faceHandle,
          bodyId: body?.id,
          sectionCount: ss.length,
          guideCount: gs.length,
          uCount: gridSpec.uCount,
          vCount: gridSpec.vCount,
          ts: Date.now(),
        },
      }));
    }
  } catch { /* fail soft — CustomEvent is universal in Electron */ }
  return {
    ok: true, faceHandle: built.faceHandle, body,
    gridSpec, uKnots: built.uKnots, vKnots: built.vKnots,
    sectionCount: ss.length, guideCount: gs.length,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Side-effect helper API install — same pattern as PUSH-102 / PUSH-121.

if (typeof window !== 'undefined') {
  try {
    window.__forgeMultiSectionLoftHelper = Object.freeze({
      buildLoftGrid,
      commitLoftGrid,
      appendLoftBody,
      runPipeline: runMultiSectionLoftPipeline,
      normaliseSections,
      normaliseGuides,
      sampleClosed,
      sampleOpen,
      defaultSections,
      defaultGuides,
      DEFAULT_U_COUNT,
      DEFAULT_V_COUNT,
      MIN_SECTIONS,
      MIN_SECTION_POINTS,
      MIN_GUIDE_POINTS,
      EVENT_NAME:  FORGE_MS_LOFT_EVENT,
      STORAGE_KEY: FORGE_MS_LOFT_STORAGE,
    });
    window.addEventListener('forge:menu-action', (e) => {
      if (e?.detail?.id === 'tools.multiSectionLoft') {
        window.__forgeMultiSectionLoftLastMenuTs = Date.now();
      }
    });
  } catch { /* fail soft — defensive in SSR / non-window envs */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail as PUSH-102 / PUSH-121 / PUSH-122.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 460,
  zIndex: 1333,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = { display: 'flex', alignItems: 'center', gap: 8 };
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)', margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const LIST_ROW = {
  display: 'grid', gridTemplateColumns: '24px 1fr 60px 24px',
  alignItems: 'center', gap: 6,
  padding: '4px 2px', borderRadius: 3,
};
const LIST_HEADER_ROW = {
  ...LIST_ROW,
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  paddingBottom: 4,
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
};
const SMALL_BTN = {
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer', padding: '2px 6px', borderRadius: 3, fontSize: 11,
};
const ROW_LABEL = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  textAlign: 'center',
};
const ROW_DESC = {
  fontSize: 11, color: 'var(--forge-ink-2, #b5bac4)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const ACTION_BTN = (variant = 'default', disabled = false) => ({
  background: disabled ? 'var(--forge-surface-mute, #1a1f27)'
            : variant === 'primary' ? 'var(--forge-accent, #4f87ff)'
            : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: disabled ? 'var(--forge-ink-mute, #9aa1ab)'
       : variant === 'primary' ? '#fff'
       : 'var(--forge-ink, #dadde2)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '6px 14px', borderRadius: 3, fontSize: 12,
  fontWeight: variant === 'primary' ? 600 : 400,
});
const LOG_BOX = {
  flex: 1, minHeight: 0, overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, background: 'var(--forge-canvas-1, #0e1218)',
  padding: 6, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-2, #b5bac4)',
};

// ─────────────────────────────────────────────────────────────────────
// Helpers used by the panel UI to describe each section / guide row
// without dumping the entire polyline.

function describeSection(poly) {
  const c = centroid(poly);
  return `${poly.length}pt · z̄ ${c.z.toFixed(1)}mm`;
}
function describeGuide(poly) {
  const a = poly[0], b = poly[poly.length - 1];
  return `${poly.length}pt · z ${a.z.toFixed(1)}…${b.z.toFixed(1)}mm`;
}

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function MultiSectionLoftPanel({ open, onClose }) {
  const [sections, setSections] = useState(() => defaultSections());
  const [guides, setGuides] = useState(() => defaultGuides());
  const [log, setLog] = useState([]);
  const lastFaceRef = useRef(null);

  // Reset to the preset each time the panel opens so the e2e's
  // "click Apply with defaults" assertion is deterministic.
  useEffect(() => {
    if (!open) return;
    setSections(defaultSections());
    setGuides(defaultGuides());
    setLog([]);
  }, [open]);

  const onAddSection = useCallback(() => {
    setSections((prev) => {
      const last = prev[prev.length - 1] || defaultSections()[0];
      const lastZ = last.length ? sectionZ(last) : 0;
      // New section is a 24-pt circle at z = lastZ + 30, r = 30.
      const next = buildCircleSection(0, 0, lastZ + 30, 30, DEFAULT_U_COUNT);
      return [...prev, next];
    });
  }, []);

  const onRemoveSection = useCallback((idx) => {
    setSections((prev) => {
      if (prev.length <= MIN_SECTIONS) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const onScaleSection = useCallback((idx, delta) => {
    setSections((prev) => prev.map((poly, i) => {
      if (i !== idx) return poly;
      const c = centroid(poly);
      const scale = 1 + delta;
      return poly.map((p) => ({
        x: c.x + (p.x - c.x) * scale,
        y: c.y + (p.y - c.y) * scale,
        z: p.z,
      }));
    }));
  }, []);

  const onAddGuide = useCallback(() => {
    setGuides((prev) => {
      const ss = normaliseSections(sections);
      const zHi = ss.length ? sectionZ(ss[ss.length - 1]) : 90;
      const zLo = ss.length ? sectionZ(ss[0]) : 0;
      // New guide is a 5-pt straight line along Z with a small Y bias
      // (so the loft visibly deflects when this guide is added).
      const next = [];
      for (let j = 0; j < 5; j++) {
        const v = j / 4;
        next.push({ x: 0, y: 8 * Math.sin(Math.PI * v), z: zLo + (zHi - zLo) * v });
      }
      return [...prev, next];
    });
  }, [sections]);

  const onRemoveGuide = useCallback((idx) => {
    setGuides((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const onReset = useCallback(() => {
    setSections(defaultSections());
    setGuides(defaultGuides());
  }, []);

  const saneSections = useMemo(() => normaliseSections(sections), [sections]);
  const saneGuides = useMemo(() => normaliseGuides(guides), [guides]);
  const canApply = saneSections.length >= MIN_SECTIONS;

  const onApply = useCallback(() => {
    const r = runMultiSectionLoftPipeline({
      sections, guides, uCount: DEFAULT_U_COUNT, vCount: DEFAULT_V_COUNT,
    });
    if (r.ok) lastFaceRef.current = r.faceHandle;
    setLog((l) => [
      ...l.slice(-12),
      {
        ok: r.ok, ts: Date.now(),
        message: r.ok
          ? `Lofted ${r.sectionCount} sections × ${r.guideCount} guides → face ${r.faceHandle} (${r.gridSpec.uCount}×${r.gridSpec.vCount} grid)`
          : `Apply failed: ${r.reason || 'error'}${r.message ? ' · ' + r.message : ''}`,
      },
    ]);
  }, [sections, guides]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Multi-section loft with guide curves"
         data-testid="forge-ms-loft-panel"
         data-section-count={saneSections.length}
         data-guide-count={saneGuides.length}
         data-last-face={lastFaceRef.current == null ? '' : String(lastFaceRef.current)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="sketch.spline" size={14} />
        <strong style={{ fontSize: 13 }}>Multi-section Loft</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          guides + sections
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Multi-section Loft panel"
                data-testid="forge-ms-loft-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Sweep a NURBS surface through N closed sections (each an
        arbitrary polyline) along M open guide curves. Each guide
        deflects the loft away from the section-centroid spine; multiple
        guides add up. Calls window.forge.surfacing.buildPatch (PUSH-102
        plus guide-curve influence).
      </div>

      <div style={SECTION_TITLE}>
        Sections ({saneSections.length} valid)
      </div>
      <div style={SECTION_BOX}>
        <div style={LIST_HEADER_ROW}>
          <span style={{ textAlign: 'center' }}>#</span>
          <span>profile</span>
          <span>scale</span>
          <span></span>
        </div>
        <div data-testid="forge-ms-loft-sections-list"
             data-row-count={sections.length}
             style={{ display: 'flex', flexDirection: 'column', gap: 2,
                      maxHeight: 160, overflowY: 'auto' }}>
          {sections.map((poly, idx) => (
            <div key={idx}
                 data-testid={`forge-ms-loft-section-${idx}`}
                 data-point-count={poly.length}
                 style={LIST_ROW}>
              <span style={ROW_LABEL}>{idx + 1}</span>
              <span style={ROW_DESC}>{describeSection(poly)}</span>
              <span style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                <button type="button"
                        onClick={() => onScaleSection(idx, -0.1)}
                        data-testid={`forge-ms-loft-section-shrink-${idx}`}
                        style={{ ...SMALL_BTN, padding: '0 6px' }}
                        aria-label={`Shrink section ${idx + 1}`}>−</button>
                <button type="button"
                        onClick={() => onScaleSection(idx, +0.1)}
                        data-testid={`forge-ms-loft-section-grow-${idx}`}
                        style={{ ...SMALL_BTN, padding: '0 6px' }}
                        aria-label={`Grow section ${idx + 1}`}>+</button>
              </span>
              <button type="button"
                      onClick={() => onRemoveSection(idx)}
                      data-testid={`forge-ms-loft-section-remove-${idx}`}
                      aria-label={`Remove section ${idx + 1}`}
                      disabled={sections.length <= MIN_SECTIONS}
                      style={{
                        ...SMALL_BTN,
                        opacity: sections.length <= MIN_SECTIONS ? 0.4 : 1,
                        cursor: sections.length <= MIN_SECTIONS
                                ? 'not-allowed' : 'pointer',
                      }}>×</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button"
                  onClick={onAddSection}
                  data-testid="forge-ms-loft-add-section"
                  style={SMALL_BTN}>+ Add section</button>
          <button type="button"
                  onClick={onReset}
                  data-testid="forge-ms-loft-reset"
                  style={SMALL_BTN}>Reset to preset</button>
        </div>
      </div>

      <div style={SECTION_TITLE}>
        Guide curves ({saneGuides.length} valid)
      </div>
      <div style={SECTION_BOX}>
        <div style={LIST_HEADER_ROW}>
          <span style={{ textAlign: 'center' }}>#</span>
          <span>spline</span>
          <span></span>
          <span></span>
        </div>
        <div data-testid="forge-ms-loft-guides-list"
             data-row-count={guides.length}
             style={{ display: 'flex', flexDirection: 'column', gap: 2,
                      maxHeight: 120, overflowY: 'auto' }}>
          {guides.length === 0 ? (
            <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)',
                           fontSize: 11, padding: 4 }}
                  data-testid="forge-ms-loft-guides-empty">
              no guides — pure section-stack loft
            </span>
          ) : guides.map((poly, idx) => (
            <div key={idx}
                 data-testid={`forge-ms-loft-guide-${idx}`}
                 data-point-count={poly.length}
                 style={LIST_ROW}>
              <span style={ROW_LABEL}>{idx + 1}</span>
              <span style={ROW_DESC}>{describeGuide(poly)}</span>
              <span></span>
              <button type="button"
                      onClick={() => onRemoveGuide(idx)}
                      data-testid={`forge-ms-loft-guide-remove-${idx}`}
                      aria-label={`Remove guide ${idx + 1}`}
                      style={SMALL_BTN}>×</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button"
                  onClick={onAddGuide}
                  data-testid="forge-ms-loft-add-guide"
                  style={SMALL_BTN}>+ Add guide</button>
        </div>
      </div>

      <div style={SECTION_TITLE}>Build</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onApply}
                disabled={!canApply}
                data-testid="forge-ms-loft-apply"
                style={ACTION_BTN('primary', !canApply)}>
          Apply — Build guide-driven loft
        </button>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {`${DEFAULT_U_COUNT}-pt rings · ${DEFAULT_V_COUNT}-pt v-axis · degree 3 NURBS · open-uniform knots`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Log</div>
      <div data-testid="forge-ms-loft-log"
           data-log-count={log.length}
           style={LOG_BOX}>
        {log.length === 0 ? (
          <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            no builds yet
          </span>
        ) : log.slice().reverse().map((entry, i) => (
          <div key={`${entry.ts}-${i}`}
               style={{
                 display: 'flex', gap: 6, alignItems: 'baseline',
                 borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
                 padding: '2px 0',
               }}>
            <span style={{ color: entry.ok ? 'var(--forge-ok, #4caf50)'
                                            : 'var(--forge-err, #ef5350)' }}>
              {entry.ok ? 'OK' : 'ER'}
            </span>
            <span style={{ flex: 1 }}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.multiSectionLoft` menu action and
// exposes the imperative open/close hooks for plugins / e2e / Archie.

export function MultiSectionLoftPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenMultiSectionLoft  = () => setOpen(true);
    window.__forgeCloseMultiSectionLoft = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.multiSectionLoft') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenMultiSectionLoft; } catch {}
      try { delete window.__forgeCloseMultiSectionLoft; } catch {}
    };
  }, []);
  if (!open) return null;
  return <MultiSectionLoftPanel open={open} onClose={() => setOpen(false)} />;
}

export default MultiSectionLoftPanel;
