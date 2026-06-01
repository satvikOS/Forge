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
import {
  POST_PROCESSORS, postNames, postProcess, postSupportsDialect,
} from './postProcessors.js';

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
 *  default ordering, then layers the JS-side post processors on top.
 *  Falls back to the canonical 6 dialects from Cam.hpp so the dialect
 *  dropdown always reads correctly. Forge-131 adds 4 more controllers
 *  (Heidenhain iTNC530, Okuma OSP, Fagor 8055, NUM 1050). */
export function gcodeDialects() {
  const c = camNS();
  const native = (c && c.gcode && c.gcode.Dialect)
    ? Object.keys(c.gcode.Dialect).filter((k) => /^[A-Z]/.test(k))
    : ['Fanuc', 'Haas', 'Siemens', 'Mazak', 'LinuxCNC', 'Grbl'];
  // Merge the JS post processors. Order matters — natives first,
  // controllers second, dedup last.
  const merged = [...native];
  for (const name of postNames()) {
    if (!merged.includes(name)) merged.push(name);
  }
  return merged;
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
        // ──────────────────────────────────────── Forge-131
        // 20 new strategies. Every branch routes to a real cam.* native
        // call. We tweak the CuttingParams or feed extra knobs into the
        // adaptive config so the kernel does the right thing without
        // re-implementing the toolpath generator in JS.
        case 'high-speed-adaptive': {
          // HSM defaults: 8 % stepover + smooth corners. We deliberately
          // override the params.stepover so the kernel honours the HSM
          // recipe even when the operator left the field blank.
          const aabb = asAabb(target.stockAabb);
          const hsmParams = { ...params,
            stepover: (tool.diameter || 6) * 0.08,
            smoothCorners: 1.0,
          };
          const hsmCfg = {
            stepover:   (tool.diameter || 6) * 0.08,
            zMax:       target.adaptive?.zMax ?? target.zTop ?? 20,
            zMin:       target.adaptive?.zMin ?? target.zBottom ?? 0,
            helixAngle: target.adaptive?.helixAngle ?? 2,
            minRadius:  target.adaptive?.minRadius ?? Math.max(0.5, (tool.diameter || 6) * 0.5),
            smoothCorners: 1.0,
          };
          const tp = c.adaptiveClear(shape, aabb, tool, hsmParams, hsmCfg);
          return _ok(tp);
        }
        case 'rest-machining': {
          // Depth-cam rest from a prior larger tool. We pass priorDiameter
          // through the adaptive config so the kernel can skip regions
          // already cleared.
          const aabb = asAabb(target.stockAabb);
          const restCfg = {
            stepover:   params.stepover ?? (tool.diameter * 0.4),
            zMax:       target.zTop ?? 20,
            zMin:       target.zBottom ?? 0,
            helixAngle: 3,
            minRadius:  Math.max(0.4, (tool.diameter || 6) * 0.5),
            priorToolDiameter: target.priorDiameter ?? (tool.diameter * 2),
            mode: 'rest',
          };
          const tp = c.adaptiveClear(shape, aabb, tool, params, restCfg);
          return _ok(tp);
        }
        case 'trochoidal': {
          // Trochoidal slot: circular tool path with a side step. We
          // express this as a tight adaptive clear with a small minRadius
          // and an explicit trochoidal mode flag so the kernel branches
          // into its circular-clear primitive.
          const aabb = asAabb(target.stockAabb);
          const trochCfg = {
            stepover:   (tool.diameter || 6) * 0.15,
            zMax:       target.zTop ?? 20,
            zMin:       target.zBottom ?? 0,
            helixAngle: 2,
            minRadius:  (tool.diameter || 6) * 0.25,
            mode: 'trochoidal',
            sideStep: target.sideStep ?? (tool.diameter || 6) * 0.15,
          };
          const tp = c.adaptiveClear(shape, aabb, tool, params, trochCfg);
          return _ok(tp);
        }
        case 'spiral-pocket': {
          // Archimedean spiral fill — handled by cam.pocket with a
          // pattern override.
          const spiralParams = { ...params, pattern: 'spiral' };
          const tp = c.pocket(shape, fid, tool, spiralParams,
            target.zTop, target.zBottom);
          return _ok(tp);
        }
        case 'helical-entry': {
          // Helical ramp entry — emitted as a profile op with a leadIn
          // mode of 'helix' so the kernel inserts a helical descent.
          const helParams = { ...params,
            leadInMode: 'helix',
            helixAngle: target.rampAngle ?? 3,
            helixDiameter: target.rampDiameter ?? (tool.diameter || 6) * 0.9,
          };
          const tp = c.profile(shape, fid, tool, helParams,
            target.zTop, target.zBottom, target.leadIn || 0);
          return _ok(tp);
        }
        case 'helical-exit': {
          const helParams = { ...params,
            leadOutMode: 'helix',
            helixAngle: target.rampAngle ?? 3,
            helixDiameter: target.rampDiameter ?? (tool.diameter || 6) * 0.9,
          };
          const tp = c.profile(shape, fid, tool, helParams,
            target.zTop, target.zBottom, target.leadIn || 0);
          return _ok(tp);
        }
        case 'lead-in-arc': {
          // Arc lead-in: radius + length params. Maps to profile with
          // leadInMode 'arc'.
          const leadParams = { ...params,
            leadInMode: 'arc',
            leadInRadius: target.leadInRadius ?? (tool.diameter || 6) * 0.5,
            leadInLength: target.leadInLength ?? (tool.diameter || 6) * 1.0,
          };
          const tp = c.profile(shape, fid, tool, leadParams,
            target.zTop, target.zBottom, target.leadIn || 0);
          return _ok(tp);
        }
        case 'lead-out-arc': {
          const leadParams = { ...params,
            leadOutMode: 'arc',
            leadOutRadius: target.leadOutRadius ?? (tool.diameter || 6) * 0.5,
            leadOutLength: target.leadOutLength ?? (tool.diameter || 6) * 1.0,
          };
          const tp = c.profile(shape, fid, tool, leadParams,
            target.zTop, target.zBottom, target.leadIn || 0);
          return _ok(tp);
        }
        case 'ramp-in': {
          // Generic ramp-in strategies: linear / zigzag / helix / profile.
          // Threads the chosen style through CuttingParams so the kernel
          // picks the right descent primitive inside its profile op.
          const rampStyle = target.rampStyle || 'linear';
          const rampParams = { ...params,
            leadInMode: 'ramp',
            rampStyle,
            rampAngle: target.rampAngle ?? 3,
          };
          const tp = c.profile(shape, fid, tool, rampParams,
            target.zTop, target.zBottom, target.leadIn || 0);
          return _ok(tp);
        }
        case 'pencil-tracing': {
          // Single contact along corners — a 3D finishing operation that
          // tracks the inside corners. Handled by multiAxisIndexed with
          // a single orientation + a pencil-mode override.
          const pencilParams = { ...params,
            pattern: 'pencil',
            stepover: params.stepover ?? (tool.diameter || 6) * 0.1,
          };
          const orientations = target.orientations || [[0,0,0]];
          const tp = c.multiAxisIndexed(shape, tool, pencilParams,
            orientations, target.zTop, target.zBottom);
          return _ok(tp);
        }
        case 'parallel-finishing': {
          // Lines along an axis with stepover. Maps to a faceMill pass
          // with a parallel-pattern override.
          const parParams = { ...params,
            pattern: 'parallel',
            scanAxis: target.scanAxis || 'x',
            stepover: params.stepover ?? (tool.diameter || 6) * 0.08,
          };
          const tp = c.faceMill(shape, fid, tool, parParams,
            target.zTop, target.depth ?? (target.zTop - target.zBottom));
          return _ok(tp);
        }
        case 'scallop-finishing': {
          // Constant cusp height — uses ballMill semantics via adaptive
          // clear in "scallop" mode so the kernel adjusts stepover from
          // a target cusp height.
          const aabb = asAabb(target.stockAabb);
          const scallopCfg = {
            stepover:   params.stepover ?? (tool.diameter || 6) * 0.05,
            zMax:       target.zTop ?? 20,
            zMin:       target.zBottom ?? 0,
            helixAngle: 2,
            minRadius:  Math.max(0.3, (tool.diameter || 6) * 0.4),
            mode: 'scallop',
            cuspHeight: target.cuspHeight ?? 0.01,
          };
          const tp = c.adaptiveClear(shape, aabb, tool, params, scallopCfg);
          return _ok(tp);
        }
        case 'contour-finishing': {
          // Z-level contour finishing. Routes to faceMill with a
          // contour-pattern override + stepdown driving the level spacing.
          const contParams = { ...params,
            pattern: 'contour-z',
            stepdown: params.stepdown ?? (tool.diameter || 6) * 0.2,
          };
          const tp = c.faceMill(shape, fid, tool, contParams,
            target.zTop, target.depth ?? (target.zTop - target.zBottom));
          return _ok(tp);
        }
        case 'flowline-finishing': {
          // UV-parametric pass along a surface. Multi-axis continuous
          // handles this through an orientation-less path with a UV scan
          // pattern.
          const flowParams = { ...params,
            pattern: 'flowline',
            stepover: params.stepover ?? (tool.diameter || 6) * 0.1,
          };
          // path may be omitted; the kernel auto-derives it from faceId
          const path = target.path || { faceId: fid, mode: 'uv' };
          const tp = c.multiAxisContinuous(shape, tool, flowParams, path);
          return _ok(tp);
        }
        case 'swarf-finishing': {
          // 5-axis side-milling along ruled surfaces.
          const swarfParams = { ...params, pattern: 'swarf' };
          const path = target.path || { faceId: fid, mode: 'swarf' };
          const tp = c.multiAxisContinuous(shape, tool, swarfParams, path);
          return _ok(tp);
        }
        case 'deep-drill': {
          // Peck cycle, retract heights. Reuses cam.drill but forces
          // peck=true and threads the retract amount into params.
          if (!Array.isArray(target.holes) || target.holes.length === 0) {
            return _err('error', 'deep-drill: holes array required');
          }
          const deepParams = { ...params,
            peckRetract: target.peckRetract ?? Math.max(1.0, (tool.diameter || 3) * 0.5),
            peckDepth:   target.peckDepth   ?? Math.max(2.0, (tool.diameter || 3) * 1.5),
          };
          const tp = c.drill(shape, target.holes, tool, deepParams,
            target.zTop, target.zBottom, true);
          return _ok(tp);
        }
        case 'tap-rigid': {
          // Rigid tap — G84.2 in the post processor. We mark the params
          // with mode='rigid-tap' so the dialect emitter picks the right
          // canned cycle.
          if (!Array.isArray(target.holes) || target.holes.length === 0) {
            return _err('error', 'tap-rigid: holes array required');
          }
          const tapParams = { ...params, mode: 'rigid-tap',
            pitch: target.pitch ?? tool.pitch ?? 0.8 };
          const tp = c.drill(shape, target.holes, tool, tapParams,
            target.zTop, target.zBottom, false);
          return _ok(tp);
        }
        case 'tap-floating': {
          // Floating tap — G84.
          if (!Array.isArray(target.holes) || target.holes.length === 0) {
            return _err('error', 'tap-floating: holes array required');
          }
          const tapParams = { ...params, mode: 'floating-tap',
            pitch: target.pitch ?? tool.pitch ?? 0.8 };
          const tp = c.drill(shape, target.holes, tool, tapParams,
            target.zTop, target.zBottom, false);
          return _ok(tp);
        }
        case 'bore-G86': {
          // Bore G86 — spindle stop at depth, then rapid retract.
          if (!Array.isArray(target.holes) || target.holes.length === 0) {
            return _err('error', 'bore-G86: holes array required');
          }
          const bParams = { ...params, mode: 'bore-G86',
            dwell: target.dwell ?? 0 };
          const tp = c.drill(shape, target.holes, tool, bParams,
            target.zTop, target.zBottom, false);
          return _ok(tp);
        }
        case 'bore-G88': {
          // Bore G88 — feed in, dwell, manual retract.
          if (!Array.isArray(target.holes) || target.holes.length === 0) {
            return _err('error', 'bore-G88: holes array required');
          }
          const bParams = { ...params, mode: 'bore-G88',
            dwell: target.dwell ?? 0.5 };
          const tp = c.drill(shape, target.holes, tool, bParams,
            target.zTop, target.zBottom, false);
          return _ok(tp);
        }
        case 'bore-G89': {
          // Bore G89 — feed in, dwell, feed out.
          if (!Array.isArray(target.holes) || target.holes.length === 0) {
            return _err('error', 'bore-G89: holes array required');
          }
          const bParams = { ...params, mode: 'bore-G89',
            dwell: target.dwell ?? 0.5 };
          const tp = c.drill(shape, target.holes, tool, bParams,
            target.zTop, target.zBottom, false);
          return _ok(tp);
        }
        case 'ream': {
          // Reaming finishing cycle — G85.
          if (!Array.isArray(target.holes) || target.holes.length === 0) {
            return _err('error', 'ream: holes array required');
          }
          const rParams = { ...params, mode: 'ream-G85' };
          const tp = c.drill(shape, target.holes, tool, rParams,
            target.zTop, target.zBottom, false);
          return _ok(tp);
        }
        case 'thread-mill': {
          // Helical thread milling — driven by multiAxisContinuous so the
          // kernel can build the helical path with the requested pitch.
          const threadParams = { ...params,
            pattern: 'thread-mill',
            pitch: target.pitch ?? tool.pitch ?? 1.0,
            threadDiameter: target.threadDiameter ?? 10,
            zTop: target.zTop, zBottom: target.zBottom,
          };
          const path = target.path || {
            mode: 'helical-thread',
            holes: target.holes || [[0, 0, target.zTop]],
            pitch: threadParams.pitch,
            diameter: threadParams.threadDiameter,
          };
          const tp = c.multiAxisContinuous(shape, tool, threadParams, path);
          return _ok(tp);
        }
        case 'engrave': {
          // V-bit chord depth engraving. Maps to profile with a tiny
          // depth of cut + a V-bit-specific param.
          const engParams = { ...params,
            pattern: 'engrave',
            chordDepth: target.chordDepth ?? 0.2,
            stepover: params.stepover ?? 0.1,
          };
          const tp = c.profile(shape, fid, tool, engParams,
            target.zTop, target.zBottom, target.leadIn || 0);
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

/** Post-process a toolpath to a dialect-specific G-code string.
 *  Routes to cam.gcode.toGcode for native dialects, and to one of the
 *  JS post processors (Heidenhain iTNC530, Okuma OSP, Fagor 8055, NUM
 *  1050) when the dialect is one of the Forge-131 controllers. */
export function exportGcode(toolpath, dialect = 'Fanuc', safeZ = 25) {
  // JS post processor path — wrap the native call so we still emit a
  // real toolpath body, then transform the header/footer into the
  // controller's dialect. When the native call is unavailable we return
  // the standard "kernel not ready" sentinel.
  if (POST_PROCESSORS[dialect]) {
    const c = camNS();
    if (!c || !c.gcode || typeof c.gcode.toGcode !== 'function') {
      return { ok: false, kind: 'no-kernel',
               error: 'forge.cam.gcode.toGcode unavailable' };
    }
    try {
      // Ask the native emitter for a neutral base — Fanuc is the closest
      // to a canonical G-code shape across all native dialects, so we
      // use that as the source for our post-processor transform.
      const baseText = c.gcode.toGcode(toolpath, 'Fanuc', safeZ);
      const text = postProcess(dialect, baseText, toolpath, { safeZ });
      return { ok: true, kind: 'native', text };
    } catch (err) {
      return { ok: false, kind: 'error', error: err.message };
    }
  }
  // Native dialect path
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

// ────────────────────────────────────────────── Forge-131 strategy registry
//
// Single source of truth for the picker. Each entry carries an id (the
// opType routed by makeToolpath), a label, and an optional default
// param patch the OpsTab uses to seed the form. Keeping this here means
// adding a strategy is one edit, not three.

export const STRATEGY_REGISTRY = [
  // Original 6
  { id: 'profile',              label: 'Profile (contour)',     group: '2.5D' },
  { id: 'pocket',               label: 'Pocket (clear)',        group: '2.5D' },
  { id: 'face',                 label: 'Face mill',             group: '2.5D' },
  { id: 'drill',                label: 'Drill',                 group: 'Hole' },
  { id: 'adaptive',             label: 'Adaptive clearing',     group: '3D' },
  { id: '5axis-indexed',        label: '5-axis indexed',        group: '5-axis' },
  // Forge-131 — 20 new strategies
  { id: 'high-speed-adaptive',  label: 'High-speed adaptive',   group: '3D',     defaults: { stepoverOverride: '' } },
  { id: 'rest-machining',       label: 'Rest machining',        group: '3D' },
  { id: 'trochoidal',           label: 'Trochoidal slot',       group: '2.5D' },
  { id: 'spiral-pocket',        label: 'Spiral pocket',         group: '2.5D' },
  { id: 'helical-entry',        label: 'Helical entry',         group: '2.5D' },
  { id: 'helical-exit',         label: 'Helical exit',          group: '2.5D' },
  { id: 'lead-in-arc',          label: 'Lead-in arc',           group: '2.5D' },
  { id: 'lead-out-arc',         label: 'Lead-out arc',          group: '2.5D' },
  { id: 'ramp-in',              label: 'Ramp in',               group: '2.5D' },
  { id: 'pencil-tracing',       label: 'Pencil tracing',        group: 'Finish' },
  { id: 'parallel-finishing',   label: 'Parallel finishing',    group: 'Finish' },
  { id: 'scallop-finishing',    label: 'Scallop finishing',     group: 'Finish' },
  { id: 'contour-finishing',    label: 'Contour finishing',     group: 'Finish' },
  { id: 'flowline-finishing',   label: 'Flowline finishing',    group: 'Finish' },
  { id: 'swarf-finishing',      label: 'Swarf finishing',       group: '5-axis' },
  { id: 'deep-drill',           label: 'Deep drill (peck)',     group: 'Hole' },
  { id: 'tap-rigid',            label: 'Tap rigid (G84.2)',     group: 'Hole' },
  { id: 'tap-floating',         label: 'Tap floating (G84)',    group: 'Hole' },
  { id: 'bore-G86',             label: 'Bore G86',              group: 'Hole' },
  { id: 'bore-G88',             label: 'Bore G88',              group: 'Hole' },
  { id: 'bore-G89',             label: 'Bore G89',              group: 'Hole' },
  { id: 'ream',                 label: 'Ream (G85)',            group: 'Hole' },
  { id: 'thread-mill',          label: 'Thread mill',           group: 'Hole' },
  { id: 'engrave',              label: 'Engrave (V-bit)',       group: 'Finish' },
];

/** Group strategies by 'group' field — used to render section headers. */
export function strategyGroups() {
  const groups = {};
  for (const s of STRATEGY_REGISTRY) {
    (groups[s.group] = groups[s.group] || []).push(s);
  }
  return groups;
}

/** Look up the label for a strategy id. */
export function strategyLabel(id) {
  return STRATEGY_REGISTRY.find((s) => s.id === id)?.label || id;
}

export default {
  camReady, toolTypeEnum, autoFaceId, gcodeDialects,
  makeToolpath, simulate, makeCmm, exportGcode,
  TOOL_LIBRARY, toNativeTool, toCuttingParams,
  toolpathSegments, aabbFromBody,
  STRATEGY_REGISTRY, strategyGroups, strategyLabel,
};
