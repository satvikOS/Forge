// Forge-92 — CAM dispatch.
// Forge-114 — toolpath + simulation calls now publish a progress row.
//
// Wraps the window.forge.cam.* native namespace. Mirrors the convention
// already established in kernelDispatch.js: guard the call when the
// native addon isn't loaded, surface a structured result so the UI can
// show "kernel not ready" without faking output.
//
// Every public function in this module routes to a real cam.* call when
// possible. No placeholder toolpaths. No fake G-code. The only fallback
// is an explicit `{ ok:false, kind:'no-kernel' }` so the panel renders a
// clear "kernel not ready" notice rather than a synthesized program.

import { startJob, updateJob, finishJob } from './progressBus.js';

// Shared progress-wrapper for the synchronous CAM calls. See the long
// comment in simulationDispatch.js for the rationale on the fake stepper.
function withProgress(label, fn, { estMs = 1500 } = {}) {
  let cancelled = false;
  const job = startJob({
    label,
    total: 100,
    onCancel: () => { cancelled = true; },
  });
  let stepHandle = null;
  if (typeof setInterval === 'function') {
    const startedAt = Date.now();
    stepHandle = setInterval(() => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(90, (elapsed / estMs) * 90);
      const eta_s = estMs > elapsed ? (estMs - elapsed) / 1000 : null;
      updateJob(job.id, { pct, eta_s, message: 'Running' });
    }, 100);
  }
  const stop = (result) => {
    if (stepHandle != null) clearInterval(stepHandle);
    if (cancelled) {
      finishJob(job.id, { result: { cancelled: true } });
      const out = (result && typeof result === 'object')
        ? { ...result, _cancelled: true }
        : { _cancelled: true };
      return out;
    }
    updateJob(job.id, { pct: 100, message: 'Done' });
    finishJob(job.id, { result });
    return result;
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(stop, (err) => {
        if (stepHandle != null) clearInterval(stepHandle);
        finishJob(job.id, { result: { error: err && err.message ? err.message : String(err) } });
        throw err;
      });
    }
    return stop(result);
  } catch (err) {
    if (stepHandle != null) clearInterval(stepHandle);
    finishJob(job.id, { result: { error: err && err.message ? err.message : String(err) } });
    throw err;
  }
}

function camNS() {
  if (typeof window === 'undefined') return null;
  const f = window.forge;
  if (!f) return null;
  // The forge dev shell exposes isReady() once forge-kernel.node is
  // resolved by the bootstrap. We also accept a kernel that's been
  // partially loaded but already published `cam`, since the native
  // namespace is what we actually need here.
  if (typeof f.isReady === 'function' && !f.isReady()) return null;
  return f.cam || null;
}

/** True when window.forge.cam is fully available. */
export function camReady() {
  const c = camNS();
  return !!(c && typeof c.profile === 'function' && c.gcode &&
            typeof c.gcode.toGcode === 'function');
}

/** Native ToolType enum; falls back to a string-keyed object so callers
 *  can still build a tool spec when the kernel hasn't published the enum. */
export function toolTypeEnum() {
  const c = camNS();
  if (c && c.ToolType) return c.ToolType;
  return { EndMill: 'EndMill', BallMill: 'BallMill', VBit: 'VBit',
           Drill: 'Drill', Tap: 'Tap', ChamferTool: 'ChamferTool' };
}

/** Sentinel for the auto-pick first +Z planar face. */
export function autoFaceId() {
  const c = camNS();
  return (c && typeof c.kAutoFaceId !== 'undefined') ? c.kAutoFaceId : -1;
}

/** Available G-code dialects — surfaces the native enum keys + a sane
 *  default ordering. Falls back to the canonical 6 dialects from
 *  Cam.hpp so the dialect dropdown always reads correctly. */
export function gcodeDialects() {
  const c = camNS();
  if (c && c.gcode && c.gcode.Dialect) {
    const e = c.gcode.Dialect;
    // Normalise — native enums sometimes come back as { key: number, ... }
    // and sometimes as a frozen { key: 'key' } map. Either way, return
    // an array of string labels.
    return Object.keys(e).filter((k) => /^[A-Z]/.test(k));
  }
  return ['Fanuc', 'Haas', 'Siemens', 'Mazak', 'LinuxCNC', 'Grbl'];
}

// ────────────────────────────────────────────── op dispatch
//
// Every `make*` helper returns { ok, kind: 'native'|'no-kernel'|'error',
// toolpath?, error? }. The UI just inspects `ok` + `kind` and either
// renders the toolpath or shows the kernel-not-ready chip.

function asAabb(stockAabb) {
  if (stockAabb instanceof Float64Array) return stockAabb;
  if (Array.isArray(stockAabb)) return Float64Array.from(stockAabb);
  return Float64Array.from([0,0,0, 10,10,10]);
}

function _err(kind, msg) { return { ok: false, kind, error: msg }; }
function _ok(toolpath) { return { ok: true, kind: 'native', toolpath }; }

/**
 * Build a toolpath. `opType` is one of:
 *   'profile' | 'pocket' | 'drill' | 'face' | 'adaptive' | '5axis-indexed' | '5axis-cont'
 *
 *   target is op-specific:
 *     - profile/pocket/face:   { faceId?:number, zTop, zBottom, depth?, leadIn? }
 *     - drill:                 { holes:[[x,y,z],…], zTop, zBottom, peck? }
 *     - adaptive:              { stockAabb, adaptive:{stepover,zMax,zMin,helixAngle,minRadius} }
 *     - 5axis-indexed:         { orientations, zTop, zBottom }
 *     - 5axis-cont:            { path }
 */
export function makeToolpath(opType, shape, target, tool, params) {
  const c = camNS();
  if (!c) return _err('no-kernel', 'forge.cam not ready');
  const fid = (target && target.faceId != null) ? target.faceId : autoFaceId();
  const toolName = (tool && (tool.name || tool.id)) ? ` · ${tool.name || tool.id}` : '';
  return withProgress(`CAM ${opType}${toolName}`, () => {
    try {
      switch (opType) {
        case 'profile': {
          const tp = c.profile(shape, fid, tool, params,
            target.zTop, target.zBottom, target.leadIn || 0);
          return _ok(tp);
        }
        case 'pocket': {
          const tp = c.pocket(shape, fid, tool, params,
            target.zTop, target.zBottom);
          return _ok(tp);
        }
        case 'drill': {
          if (!Array.isArray(target.holes) || target.holes.length === 0) {
            return _err('error', 'drill: holes array required');
          }
          const tp = c.drill(shape, target.holes, tool, params,
            target.zTop, target.zBottom, !!target.peck);
          return _ok(tp);
        }
        case 'face': {
          const tp = c.faceMill(shape, fid, tool, params,
            target.zTop, target.depth);
          return _ok(tp);
        }
        case 'adaptive': {
          const aabb = asAabb(target.stockAabb);
          const tp = c.adaptiveClear(shape, aabb, tool, params, target.adaptive);
          return _ok(tp);
        }
        case '5axis-indexed': {
          const tp = c.multiAxisIndexed(shape, tool, params,
            target.orientations, target.zTop, target.zBottom);
          return _ok(tp);
        }
        case '5axis-cont': {
          const tp = c.multiAxisContinuous(shape, tool, params, target.path);
          return _ok(tp);
        }
        default:
          return _err('error', `unknown opType: ${opType}`);
      }
    } catch (err) {
      return _err('error', err.message || String(err));
    }
  }, { estMs: 1500 });
}

/** Run the voxel stock simulator on a toolpath. */
export function simulate(stockAabb, toolpath, tool, gridResolution = 50) {
  const c = camNS();
  if (!c || typeof c.simulateStock !== 'function') {
    return { ok: false, kind: 'no-kernel', error: 'simulateStock unavailable' };
  }
  const moveCount = (toolpath && toolpath.moveCount) || 0;
  const label = `CAM Simulate · ${moveCount} moves`;
  return withProgress(label, () => {
    try {
      const rep = c.simulateStock(asAabb(stockAabb), toolpath, tool, gridResolution);
      return { ok: true, kind: 'native', report: rep };
    } catch (err) {
      return { ok: false, kind: 'error', error: err.message };
    }
  }, { estMs: 3500 });
}

/** CMM inspection program. */
export function makeCmm(shape, features, gauge) {
  const c = camNS();
  if (!c || typeof c.generateCmm !== 'function') {
    return { ok: false, kind: 'no-kernel', error: 'generateCmm unavailable' };
  }
  try {
    const prog = c.generateCmm(shape, features, gauge);
    return { ok: true, kind: 'native', program: prog };
  } catch (err) {
    return { ok: false, kind: 'error', error: err.message };
  }
}

/** Post-process a toolpath to a dialect-specific G-code string. */
export function exportGcode(toolpath, dialect = 'Fanuc', safeZ = 25) {
  const c = camNS();
  if (!c || !c.gcode || typeof c.gcode.toGcode !== 'function') {
    return { ok: false, kind: 'no-kernel',
             error: 'forge.cam.gcode.toGcode unavailable' };
  }
  try {
    const text = c.gcode.toGcode(toolpath, dialect, safeZ);
    return { ok: true, kind: 'native', text };
  } catch (err) {
    return { ok: false, kind: 'error', error: err.message };
  }
}

// ────────────────────────────────────────────── tool library
//
// Real machinist defaults — diameter / flutes / RPM / feed values are
// taken from common carbide tooling catalogs (Harvey Tool / Helical /
// OSG). Coolant 1.0 = flood. These values are sane starting points for
// the materials a hobbyist + jobbing-shop kernel will see most often
// (Al-6061 + mild steel + plastic).

export const TOOL_LIBRARY = [
  { id: 'em6',   name: 'EndMill Ø6',     type: 'EndMill',
    diameter: 6,  length: 25, flutes: 4, helix: 35,
    rpm: 16000, feedXY: 1100, feedZ: 280, stepover: 3,   stepdown: 3 },
  { id: 'em10',  name: 'EndMill Ø10',    type: 'EndMill',
    diameter: 10, length: 32, flutes: 4, helix: 35,
    rpm: 12000, feedXY: 1400, feedZ: 350, stepover: 5,   stepdown: 4 },
  { id: 'bm6',   name: 'BallMill Ø6',    type: 'BallMill',
    diameter: 6,  length: 25, flutes: 2, helix: 30,
    rpm: 18000, feedXY:  900, feedZ: 220, stepover: 0.4, stepdown: 0.4 },
  { id: 'vbit',  name: 'VBit 60°',       type: 'VBit',
    diameter: 6,  length: 18, flutes: 2, helix: 0,
    rpm: 18000, feedXY:  600, feedZ: 200, stepover: 0.3, stepdown: 0.3,
    angle: 60 },
  { id: 'dr3',   name: 'Drill Ø3',       type: 'Drill',
    diameter: 3,  length: 30, flutes: 2, helix: 30,
    rpm: 3500,  feedXY:    0, feedZ: 120, stepover: 0,   stepdown: 1.5 },
  { id: 'dr5',   name: 'Drill Ø5',       type: 'Drill',
    diameter: 5,  length: 40, flutes: 2, helix: 30,
    rpm: 2800,  feedXY:    0, feedZ: 150, stepover: 0,   stepdown: 2.0 },
  { id: 'tapM5', name: 'Tap M5×0.8',     type: 'Tap',
    diameter: 5,  length: 22, flutes: 4, helix: 0,
    rpm: 600,   feedXY:    0, feedZ: 480, stepover: 0,   stepdown: 0.8,
    pitch: 0.8 },
  { id: 'cf10',  name: 'ChamferTool Ø10', type: 'ChamferTool',
    diameter: 10, length: 18, flutes: 4, helix: 0,
    rpm: 14000, feedXY:  800, feedZ: 250, stepover: 0.5, stepdown: 0.5,
    angle: 45 },
];

/** Resolve a tool library entry into the Tool schema the native CAM API
 *  consumes (id / name / diameter / fluteLength / helix / flutes / type). */
export function toNativeTool(libEntry) {
  return {
    id:          libEntry.id ? hashId(libEntry.id) : 1,
    name:        libEntry.name,
    diameter:    libEntry.diameter,
    fluteLength: libEntry.length,
    helix:       libEntry.helix || 0,
    flutes:      libEntry.flutes,
    type:        libEntry.type,
  };
}

/** Resolve op params from a tool entry — the CuttingParams schema. */
export function toCuttingParams(libEntry, override = {}) {
  return {
    feedXY:     override.feedXY     ?? libEntry.feedXY,
    feedZ:      override.feedZ      ?? libEntry.feedZ,
    spindleRPM: override.spindleRPM ?? libEntry.rpm,
    stepover:   override.stepover   ?? libEntry.stepover,
    stepdown:   override.stepdown   ?? libEntry.stepdown,
    coolant:    override.coolant    ?? 1.0,
  };
}

// Small string→int hash so the native Tool.id stays numeric.
function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

/**
 * Extract a flat XYZ-cutting-flag-feed array from a native toolpath.
 * The kernel encodes each move as 5 floats: x, y, z, cutting, feed.
 * Returns null when toolpath is missing / unusable.
 */
export function toolpathSegments(toolpath) {
  if (!toolpath || !toolpath.moves || !toolpath.moveCount) return null;
  const N = toolpath.moveCount;
  const moves = toolpath.moves;
  const out = [];
  for (let i = 0; i < N; i++) {
    out.push({
      x: moves[i * 5 + 0],
      y: moves[i * 5 + 1],
      z: moves[i * 5 + 2],
      cutting: moves[i * 5 + 3] > 0.5,
      feed: moves[i * 5 + 4],
    });
  }
  return out;
}

/** Default stock AABB inferred from a body's bounding box, with a
 *  per-axis machining margin (mm). The shell-passed body may carry
 *  either a native handle (use forge.bbox if available) or a synthetic
 *  spec — we read whichever side is present. */
export function aabbFromBody(body, margin = 1.0) {
  if (!body) return null;
  // Native bbox path
  if (body.kind === 'native' && typeof body.handle === 'number' &&
      typeof window !== 'undefined' && window.forge?.bbox) {
    try {
      const b = window.forge.bbox(body.handle);
      return Float64Array.from([
        b.min[0] - margin, b.min[1] - margin, b.min[2] - margin,
        b.max[0] + margin, b.max[1] + margin, b.max[2] + margin,
      ]);
    } catch { /* fall through */ }
  }
  // Synthetic spec path — use the named dimensions
  const s = body.spec;
  if (!s) return null;
  if (s.kind === 'box') {
    return Float64Array.from([
      -s.dx / 2 - margin, -s.dy / 2 - margin, -margin,
       s.dx / 2 + margin,  s.dy / 2 + margin, s.dz + margin,
    ]);
  }
  if (s.kind === 'cylinder') {
    return Float64Array.from([
      -s.r - margin, -s.r - margin, -margin,
       s.r + margin,  s.r + margin, s.h + margin,
    ]);
  }
  // Anything else — default 60×40×20 block.
  return Float64Array.from([
    -30 - margin, -20 - margin, -margin,
     30 + margin,  20 + margin, 20 + margin,
  ]);
}

export default {
  camReady, toolTypeEnum, autoFaceId, gcodeDialects,
  makeToolpath, simulate, makeCmm, exportGcode,
  TOOL_LIBRARY, toNativeTool, toCuttingParams,
  toolpathSegments, aabbFromBody,
};
