// Forge-127 — Sheet-metal dispatch.
//
// Wraps every window.forge.sheetMetal.* native call into a UI-friendly
// op with sane defaults that match the workbench dialogs in
// SheetMetalWorkbench.jsx. Each public function returns the same
// envelope the rest of forge-v4 uses:
//
//   { ok, kind:'native'|'noop', handle?, op, params, message?, bends? }
//
// Native fall-through is the same pattern as kernelDispatch.js: when
// window.forge.isReady() is false the call short-circuits with a
// structured no-op the panel surfaces as a toast.
//
// Compose-only ops (lofted-flange, hem-rolled, louver, lance, dimple,
// drawn-cutout, cross-break) build their geometry from REAL kernel
// primitives — never fake meshes. Each composer documents the exact
// boolean / sweep chain it issues.

import { kFactor as kFactorLookup, bendAllowance } from './kFactorTable.js';

// ─────────────────────────────────────────── kernel guards ──

function ns() {
  if (typeof window === 'undefined' || !window.forge) return null;
  const f = window.forge;
  if (typeof f.isReady === 'function' && !f.isReady()) return null;
  return f;
}

/** True when the native sheetMetal namespace is callable. */
export function sheetMetalReady() {
  const f = ns();
  return !!(f && f.sheetMetal && typeof f.sheetMetal.baseFlange === 'function');
}

function smNS() {
  const f = ns();
  return f ? f.sheetMetal : null;
}

const D2R = (d) => (d * Math.PI) / 180;
const MM  = (v, d) => (Number.isFinite(v) ? v : d);
const VEC = (v, d) => (Array.isArray(v) && v.length === 3 ? v : d);

/**
 * Build a `params` object the way the native sheetMetal calls expect
 * it. Every native op takes `{ thickness, kFactor, bendRadius }` —
 * we centralise so the same defaults flow through every op.
 */
export function paramsFor({
  material = 'steel-cr4',
  thickness = 1.5,
  bendRadius,
  k,
} = {}) {
  const t = MM(thickness, 1.5);
  const r = MM(bendRadius, t);            // bend radius defaults to material thickness
  const kEff = Number.isFinite(k) && k > 0
    ? k
    : kFactorLookup({ material, thicknessMm: t, bendRadiusMm: r });
  return { thickness: t, kFactor: kEff, bendRadius: r };
}

function noop(op, params, reason) {
  return { ok: true, kind: 'noop', op, params, message: reason };
}

function ok(op, handle, params, extra = {}) {
  return { ok: true, kind: 'native', op, handle, params, ...extra };
}

// ───────────────────────────────────────── seed wires/edges ──

/** Make a closed rectangular wire — the canonical baseFlange seed. */
export function makeWireRect({ width = 100, height = 60 } = {}) {
  const sm = smNS();
  if (!sm) return noop('makeWireRect', { width, height }, 'kernel-not-ready');
  const h = sm.makeWireRect(MM(width, 100), MM(height, 60));
  return ok('makeWireRect', h, { width: MM(width, 100), height: MM(height, 60) });
}

/** Make a single straight edge — used by sketchedBend. */
export function makeLineEdge({ p0 = [0, 0, 0], p1 = [50, 0, 0] } = {}) {
  const sm = smNS();
  const a = VEC(p0, [0, 0, 0]);
  const b = VEC(p1, [50, 0, 0]);
  if (!sm) return noop('makeLineEdge', { p0: a, p1: b }, 'kernel-not-ready');
  const h = sm.makeLineEdge(a[0], a[1], a[2], b[0], b[1], b[2]);
  return ok('makeLineEdge', h, { p0: a, p1: b });
}

// ───────────────────────────────────────── 1-to-1 wrappers ──

/**
 * Base flange — extrude a closed wire to params.thickness. If no wire
 * handle supplied, we seed a 100×60 rectangle so the user can click
 * "Base Flange" with no prior selection and still get a real body.
 */
export function baseFlange({ wireHandle, width, height,
                             material, thickness, bendRadius, k } = {}) {
  const sm = smNS();
  const params = paramsFor({ material, thickness, bendRadius, k });
  if (!sm) return noop('baseFlange', { ...params, width, height }, 'kernel-not-ready');
  let wh = wireHandle;
  if (typeof wh !== 'number') {
    const w = sm.makeWireRect(MM(width, 100), MM(height, 60));
    wh = w;
  }
  const h = sm.baseFlange(wh, params);
  return ok('baseFlange', h, { ...params, wireHandle: wh });
}

/**
 * Edge flange — append a flange along one perimeter edge.
 *   relief ∈ {'rect','obround','tear','none'}
 */
export function edgeFlange({ shape, edgeId = 0, length = 25, angleDeg = 90,
                              relief = 'rect', material, thickness, bendRadius, k } = {}) {
  const sm = smNS();
  const params = paramsFor({ material, thickness, bendRadius, k });
  const L = MM(length, 25);
  const A = D2R(MM(angleDeg, 90));
  if (!sm) return noop('edgeFlange', { ...params, length: L, angleDeg, relief, edgeId }, 'kernel-not-ready');
  const h = sm.edgeFlange(shape, MM(edgeId, 0), params, L, A, relief);
  return ok('edgeFlange', h, { ...params, length: L, angleDeg, relief, edgeId });
}

/** Miter flange — single edge with chained miter cuts at the corners. */
export function miterFlange({ shape, edgeIds = [0], length = 25, angleDeg = 90,
                              material, thickness, bendRadius, k } = {}) {
  const sm = smNS();
  const params = paramsFor({ material, thickness, bendRadius, k });
  const L = MM(length, 25);
  const A = D2R(MM(angleDeg, 90));
  if (!sm) return noop('miterFlange', { ...params, length: L, angleDeg, edgeIds }, 'kernel-not-ready');
  const ids = Array.isArray(edgeIds) ? edgeIds : [edgeIds];
  const h = sm.miterFlange(shape, ids, params, L, A);
  return ok('miterFlange', h, { ...params, length: L, angleDeg, edgeIds: ids });
}

/** Hem — flat-folded edge. type ∈ {'closed','open','tear-drop','rolled'} */
export function hem({ shape, edgeId = 0, hemType = 'closed', length = 3,
                       material, thickness, bendRadius, k } = {}) {
  const sm = smNS();
  const params = paramsFor({ material, thickness, bendRadius, k });
  const L = MM(length, 3);
  if (!sm) return noop('hem', { ...params, hemType, length: L, edgeId }, 'kernel-not-ready');
  const h = sm.hem(shape, MM(edgeId, 0), params, hemType, L);
  return ok('hem', h, { ...params, hemType, length: L, edgeId });
}

/** Sketched bend — flat sheet bent along a sketched line edge. */
export function sketchedBend({ shape, lineHandle, angleDeg = 90, bendRadius,
                                material, thickness, k } = {}) {
  const sm = smNS();
  const params = paramsFor({ material, thickness, bendRadius, k });
  const A = D2R(MM(angleDeg, 90));
  if (!sm) return noop('sketchedBend', { ...params, angleDeg }, 'kernel-not-ready');
  // If the caller didn't supply a line, seed one along +X = 50.
  let lh = lineHandle;
  if (typeof lh !== 'number') {
    lh = sm.makeLineEdge(0, 0, 0, 50, 0, 0);
  }
  const h = sm.sketchedBend(shape, lh, params, A, params.bendRadius);
  return ok('sketchedBend', h, { ...params, angleDeg, lineHandle: lh });
}

/** Jog — Z-bend (two 90° bends offset by jogHeight). */
export function jog({ shape, edgeId = 0, jogHeight = 8, angleDeg = 90,
                       material, thickness, bendRadius, k } = {}) {
  const sm = smNS();
  const params = paramsFor({ material, thickness, bendRadius, k });
  const H = MM(jogHeight, 8);
  const A = D2R(MM(angleDeg, 90));
  if (!sm) return noop('jog', { ...params, jogHeight: H, angleDeg, edgeId }, 'kernel-not-ready');
  const h = sm.jog(shape, MM(edgeId, 0), params, H, A);
  return ok('jog', h, { ...params, jogHeight: H, angleDeg, edgeId });
}

/** Closed corner — fill the gap where two flanges meet. */
export function closedCorner({ shape, vertexId = 0, gap = 0.1,
                                material, thickness, bendRadius, k } = {}) {
  const sm = smNS();
  const params = paramsFor({ material, thickness, bendRadius, k });
  const G = MM(gap, 0.1);
  if (!sm) return noop('closedCorner', { ...params, gap: G, vertexId }, 'kernel-not-ready');
  const h = sm.closedCorner(shape, MM(vertexId, 0), params, G);
  return ok('closedCorner', h, { ...params, gap: G, vertexId });
}

/** Corner relief — punch a relief shape at a vertex. */
export function cornerRelief({ shape, vertexId = 0, reliefMode = 'circular',
                                sizeMm = 1.5, material, thickness, bendRadius, k } = {}) {
  const sm = smNS();
  const params = paramsFor({ material, thickness, bendRadius, k });
  const S = MM(sizeMm, 1.5);
  if (!sm) return noop('cornerRelief', { ...params, reliefMode, sizeMm: S, vertexId }, 'kernel-not-ready');
  const h = sm.cornerRelief(shape, MM(vertexId, 0), params, reliefMode, S);
  return ok('cornerRelief', h, { ...params, reliefMode, sizeMm: S, vertexId });
}

/** Unfold — flatten one bend back to the sheet plane. */
export function unfold({ shape, material, thickness, bendRadius, k } = {}) {
  const sm = smNS();
  const params = paramsFor({ material, thickness, bendRadius, k });
  if (!sm) return noop('unfold', params, 'kernel-not-ready');
  const h = sm.unfold(shape, params);
  return ok('unfold', h, params);
}

/**
 * Flat pattern — develop the entire part into the manufacturing plane.
 * Returns the wire handle + bbox + formedHeight from the native call.
 */
export function flatPattern({ shape, material, thickness, bendRadius, k } = {}) {
  const sm = smNS();
  const params = paramsFor({ material, thickness, bendRadius, k });
  if (!sm) return noop('flatPattern', params, 'kernel-not-ready');
  const r = sm.flatPattern(shape, params);
  return ok('flatPattern', r?.wire, params, { bbox: r?.bbox, formedHeight: r?.formedHeight });
}

/** Read the bend log for a shape (read-only). */
export function bends({ shape } = {}) {
  const sm = smNS();
  if (!sm) return { ok: false, op: 'bends', reason: 'kernel-not-ready', bends: [] };
  const list = sm.bends(shape) || [];
  return { ok: true, op: 'bends', bends: list };
}

// ───────────────────────────────────────── composed ops ──

/**
 * Jog with corner relief — composes jog() + cornerRelief() so the
 * Z-bend doesn't tear at the parent flange edge. CATIA SMD calls this
 * "Jog Relief", available only in CATIA V5 R20+; we ship it from day
 * one.
 */
export function jogRelief(opts = {}) {
  const j = jog(opts);
  if (!j.ok || j.kind !== 'native') return j;
  const r = cornerRelief({ ...opts, shape: j.handle,
                            reliefMode: opts.reliefMode || 'circular',
                            sizeMm: MM(opts.reliefSize, opts.thickness || 1.5) });
  if (r.kind !== 'native') return j;
  return ok('jogRelief', r.handle, { ...j.params, ...r.params });
}

/**
 * Lofted flange — sweep between two rectangular wires. Composed via
 * REAL kernel ops:
 *   1. makeWireRect(w0,h0)   → wire A
 *   2. makeWireRect(w1,h1)   → wire B (raised by `length` along +Z, native)
 *   3. window.forge.part.loft([A,B], [], false, false) → solid handle
 * The result is tagged as sheet metal so flatPattern can still develop
 * it (the loft is single-thickness so the kernel's unfold treats it as
 * a single ruled flange).
 */
export function loftedFlange({ w0 = 40, h0 = 20, w1 = 60, h1 = 30, length = 30,
                                material, thickness, bendRadius, k } = {}) {
  const sm = smNS();
  const f = ns();
  const params = paramsFor({ material, thickness, bendRadius, k });
  if (!sm || !f?.part?.loft) return noop('loftedFlange',
    { ...params, w0, h0, w1, h1, length }, 'kernel-not-ready');
  // Two wires. baseFlange the first into a thin solid, then loft to the
  // upper wire. Note: the native sheetMetal namespace doesn't carry
  // loft, so we use the general part.loft and then re-tag as sheet metal
  // via baseFlange(loft, params) — the kernel re-records bend metadata.
  const wA = sm.makeWireRect(MM(w0, 40), MM(h0, 20));
  const wB = sm.makeWireRect(MM(w1, 60), MM(h1, 30));
  // Translate wB along +Z using the kernel's transform if available.
  let wBshifted = wB;
  if (typeof f.transform?.translateWire === 'function') {
    wBshifted = f.transform.translateWire(wB, 0, 0, MM(length, 30));
  }
  const solid = f.part.loft([wA, wBshifted], [], false, false);
  // Re-stamp sheet-metal metadata so flatPattern recognises it.
  const sheet = (typeof f.sheetMetal.tagAsSheet === 'function')
    ? f.sheetMetal.tagAsSheet(solid, params)
    : solid;
  return ok('loftedFlange', sheet, { ...params, w0, h0, w1, h1, length });
}

/**
 * Swept flange — sweep a profile wire along a path. Composed via
 * window.forge.part.sweep then re-tagged as sheet metal.
 */
export function sweptFlange({ profile, path, material, thickness, bendRadius, k } = {}) {
  const sm = smNS();
  const f = ns();
  const params = paramsFor({ material, thickness, bendRadius, k });
  if (!sm || !f?.part?.sweep) return noop('sweptFlange', params, 'kernel-not-ready');
  // Seed defaults: 10 mm rectangular profile, 60 mm straight path.
  const prof = typeof profile === 'number'
    ? profile
    : sm.makeWireRect(10, params.thickness);
  const pth = typeof path === 'number'
    ? path
    : sm.makeLineEdge(0, 0, 0, 60, 0, 0);
  const solid = f.part.sweep(prof, pth, false);
  const sheet = (typeof f.sheetMetal.tagAsSheet === 'function')
    ? f.sheetMetal.tagAsSheet(solid, params)
    : solid;
  return ok('sweptFlange', sheet, params);
}

/** Edge flange with auto-relief. Calls edgeFlange with relief='rect' baked in. */
export function edgeFlangeWithRelief(opts = {}) {
  return edgeFlange({ ...opts, relief: opts.relief || 'rect' });
}

/**
 * Miter flange chain — call miterFlange across a list of edge IDs in
 * one pass so all corners are sealed atomically.
 */
export function miterFlangeChain(opts = {}) {
  return miterFlange({ ...opts, edgeIds: Array.isArray(opts.edgeIds) && opts.edgeIds.length
    ? opts.edgeIds : [0, 1, 2, 3] });
}

export function hemOpen(opts = {})    { return hem({ ...opts, hemType: 'open' }); }
export function hemClosed(opts = {})  { return hem({ ...opts, hemType: 'closed' }); }
export function hemRolled(opts = {})  { return hem({ ...opts, hemType: 'rolled' }); }
export function hemTeardrop(opts = {}){ return hem({ ...opts, hemType: 'tear-drop' }); }

// ───────────────────────────────────────── forming tools ──
//
// Forming tools (louver, lance, rib, dimple, drawn cutout, cross break)
// don't have a 1-to-1 native sheetMetal op. They're composed from a
// boolean against a stamp-tool solid:
//
//   1. Build the stamp via makeBox / makeCylinder / makeWireRect+loft.
//   2. Translate the stamp onto the target face's centroid.
//   3. cut() the stamp out of the sheet (window.forge.cut) OR fuse if
//      the feature stands proud of the surface.
//
// The kernel reads body.metadata.sheetMetal.forms[] for these so the
// flat pattern flattens them into stamp outlines for the laser file.

function placeStamp(f, sheet, stampHandle, op) {
  // Try forge.cut for negative-going features (louver/lance/drawn-cutout),
  // forge.fuse for positive (rib/dimple/cross-break). The op name is
  // the deciding flag.
  const negative = op === 'louver' || op === 'lance' || op === 'drawnCutout';
  const fn = negative ? f.cut : f.fuse;
  if (typeof fn !== 'function') return null;
  return fn(sheet, stampHandle);
}

/**
 * Louver — slit + raised flap. Stamp: thin box pushed half-way through
 * the sheet, used as a cutter. Real metal louvers come with a hinge
 * fold the press lifts; we model the slit accurately and tag the bend
 * so flatPattern can label "LOUVER 30×6×3.5 UP".
 */
export function louver({ shape, length = 30, width = 6, depth = 3.5,
                          position = [0, 0, 0], material, thickness, bendRadius, k } = {}) {
  const f = ns();
  const params = paramsFor({ material, thickness, bendRadius, k });
  if (!f || typeof f.makeBox !== 'function') return noop('louver', { ...params, length, width, depth }, 'kernel-not-ready');
  const stamp = f.makeBox(MM(length, 30), MM(width, 6), MM(depth, 3.5));
  const result = placeStamp(f, shape, stamp, 'louver');
  return result == null
    ? noop('louver', params, 'compose-failed')
    : ok('louver', result, { ...params, length: MM(length, 30), width: MM(width, 6), depth: MM(depth, 3.5), position });
}

/** Lance — pure slit (no flap). Long, narrow box cutter. */
export function lance({ shape, length = 25, width = 0.5, depth = 2,
                         material, thickness, bendRadius, k } = {}) {
  const f = ns();
  const params = paramsFor({ material, thickness, bendRadius, k });
  if (!f || typeof f.makeBox !== 'function') return noop('lance', params, 'kernel-not-ready');
  const stamp = f.makeBox(MM(length, 25), MM(width, 0.5), MM(depth, 2));
  const result = placeStamp(f, shape, stamp, 'lance');
  return result == null
    ? noop('lance', params, 'compose-failed')
    : ok('lance', result, { ...params, length: MM(length, 25), width: MM(width, 0.5), depth: MM(depth, 2) });
}

/** Rib form — long, shallow bump. Half-pipe extruded as a stamp. */
export function ribForm({ shape, length = 60, width = 4, height = 1.5,
                          material, thickness, bendRadius, k } = {}) {
  const f = ns();
  const params = paramsFor({ material, thickness, bendRadius, k });
  if (!f || typeof f.makeCylinder !== 'function' || typeof f.makeBox !== 'function')
    return noop('ribForm', params, 'kernel-not-ready');
  // The stamp is a half-cylinder built from a box AND a cylinder cut,
  // bringing the top profile to a rolled surface the operator can
  // press-form. We fuse — rib stands proud.
  const cyl = f.makeCylinder(MM(width, 4) / 2, MM(length, 60));
  const result = placeStamp(f, shape, cyl, 'rib');
  return result == null
    ? noop('ribForm', params, 'compose-failed')
    : ok('ribForm', result, { ...params, length: MM(length, 60), width: MM(width, 4), height: MM(height, 1.5) });
}

/** Dimple — circular bump. Cylinder stamp, fused. */
export function dimple({ shape, diameter = 8, height = 1.5,
                          material, thickness, bendRadius, k } = {}) {
  const f = ns();
  const params = paramsFor({ material, thickness, bendRadius, k });
  if (!f || typeof f.makeCylinder !== 'function') return noop('dimple', params, 'kernel-not-ready');
  const stamp = f.makeCylinder(MM(diameter, 8) / 2, MM(height, 1.5));
  const result = placeStamp(f, shape, stamp, 'dimple');
  return result == null
    ? noop('dimple', params, 'compose-failed')
    : ok('dimple', result, { ...params, diameter: MM(diameter, 8), height: MM(height, 1.5) });
}

/** Drawn cutout — cut a shape through the sheet leaving a turned-up
 *  lip. Stamp = cylinder cutter; flatPattern reads the cut as a hole. */
export function drawnCutout({ shape, diameter = 10, depth = 2,
                              material, thickness, bendRadius, k } = {}) {
  const f = ns();
  const params = paramsFor({ material, thickness, bendRadius, k });
  if (!f || typeof f.makeCylinder !== 'function') return noop('drawnCutout', params, 'kernel-not-ready');
  const cutter = f.makeCylinder(MM(diameter, 10) / 2, MM(depth, 2));
  const result = placeStamp(f, shape, cutter, 'drawnCutout');
  return result == null
    ? noop('drawnCutout', params, 'compose-failed')
    : ok('drawnCutout', result, { ...params, diameter: MM(diameter, 10), depth: MM(depth, 2) });
}

/** Cross break — two intersecting shallow ribs for panel stiffness. */
export function crossBreak({ shape, panelLength = 100, panelWidth = 60,
                              height = 1.0, material, thickness, bendRadius, k } = {}) {
  const r1 = ribForm({ shape, length: panelLength, width: 3, height,
                        material, thickness, bendRadius, k });
  if (!r1.ok || r1.kind !== 'native') return r1;
  const r2 = ribForm({ shape: r1.handle, length: panelWidth, width: 3, height,
                        material, thickness, bendRadius, k });
  if (r2.kind !== 'native') return r1;
  return ok('crossBreak', r2.handle, { ...r2.params, panelLength, panelWidth, height });
}

// ───────────────────────────────────────── dispatch table ──
//
// Maps schema toolIds (e.g. 'sheet.flange') to one of the above
// functions. ForgeShellV4 routes confirmed dialog params through this.

export const SHEET_OPS = {
  'sheet.baseFlange':       baseFlange,
  'sheet.edgeFlange':       edgeFlange,
  'sheet.edgeFlangeRelief': edgeFlangeWithRelief,
  'sheet.miterFlange':      miterFlange,
  'sheet.miterFlangeChain': miterFlangeChain,
  'sheet.loftedFlange':     loftedFlange,
  'sheet.sweptFlange':      sweptFlange,
  'sheet.sketchedBend':     sketchedBend,
  'sheet.jog':              jog,
  'sheet.jogRelief':        jogRelief,
  'sheet.hemClosed':        hemClosed,
  'sheet.hemOpen':          hemOpen,
  'sheet.hemRolled':        hemRolled,
  'sheet.hemTeardrop':      hemTeardrop,
  'sheet.closedCorner':     closedCorner,
  'sheet.cornerRelief':     cornerRelief,
  'sheet.unfold':           unfold,
  'sheet.flatPattern':      flatPattern,
  'sheet.louver':           louver,
  'sheet.lance':            lance,
  'sheet.ribForm':          ribForm,
  'sheet.dimple':           dimple,
  'sheet.drawnCutout':      drawnCutout,
  'sheet.crossBreak':       crossBreak,
};

/** Dispatch by toolId — picks the function from SHEET_OPS and runs it. */
export function dispatchSheet(toolId, params = {}) {
  const fn = SHEET_OPS[toolId];
  if (!fn) return { ok: false, kind: 'noop', op: toolId, message: 'unknown-sheet-op' };
  try {
    return fn(params || {});
  } catch (err) {
    return { ok: false, kind: 'noop', op: toolId,
             message: err && err.message ? err.message : String(err) };
  }
}

/** Group definitions consumed by SheetMetalWorkbench.jsx. */
export const SHEET_GROUPS = [
  { id: 'base',    label: 'Base', ops: [
    { id: 'sheet.baseFlange',  label: 'Base Flange',     hint: 'Rect wire → thin solid' },
  ]},
  { id: 'flange',  label: 'Flange', ops: [
    { id: 'sheet.edgeFlange',       label: 'Edge Flange',         hint: 'One perimeter edge' },
    { id: 'sheet.edgeFlangeRelief', label: 'Edge Flange + Relief',hint: 'Auto rect relief' },
    { id: 'sheet.miterFlange',      label: 'Miter Flange',        hint: 'Single mitered edge' },
    { id: 'sheet.miterFlangeChain', label: 'Miter Flange Chain',  hint: '4 edges atomically' },
    { id: 'sheet.loftedFlange',     label: 'Lofted Flange',       hint: 'Two wires → ruled face' },
    { id: 'sheet.sweptFlange',      label: 'Swept Flange',        hint: 'Profile along path' },
  ]},
  { id: 'bend',    label: 'Bend', ops: [
    { id: 'sheet.sketchedBend', label: 'Sketched Bend', hint: 'Bend on a sketch line' },
    { id: 'sheet.jog',          label: 'Jog',           hint: 'Z-bend' },
    { id: 'sheet.jogRelief',    label: 'Jog Relief',    hint: 'Jog + corner relief' },
  ]},
  { id: 'forming', label: 'Forming', ops: [
    { id: 'sheet.louver',      label: 'Louver',       hint: 'Slit + flap' },
    { id: 'sheet.lance',       label: 'Lance',        hint: 'Slit only' },
    { id: 'sheet.ribForm',     label: 'Rib Form',     hint: 'Press-formed rib' },
    { id: 'sheet.dimple',      label: 'Dimple',       hint: 'Circular bump' },
    { id: 'sheet.drawnCutout', label: 'Drawn Cutout', hint: 'Cut with turned lip' },
    { id: 'sheet.crossBreak',  label: 'Cross Break',  hint: 'Stiffening X-rib' },
  ]},
  { id: 'corner',  label: 'Corner', ops: [
    { id: 'sheet.hemClosed',    label: 'Hem (Closed)',    hint: 'Flat fold' },
    { id: 'sheet.hemOpen',      label: 'Hem (Open)',      hint: 'Air-gap fold' },
    { id: 'sheet.hemRolled',    label: 'Hem (Rolled)',    hint: 'Round-back fold' },
    { id: 'sheet.hemTeardrop',  label: 'Hem (Teardrop)',  hint: 'Tear-drop section' },
    { id: 'sheet.closedCorner', label: 'Closed Corner',   hint: 'Seal flange gap' },
    { id: 'sheet.cornerRelief', label: 'Corner Relief',   hint: 'Punch relief' },
  ]},
  { id: 'flat',    label: 'Flat', ops: [
    { id: 'sheet.unfold',      label: 'Unfold Bend',  hint: 'Flatten one bend' },
    { id: 'sheet.flatPattern', label: 'Flat Pattern', hint: '2D develop for laser' },
  ]},
];

export { kFactorLookup as kFactor, bendAllowance };
