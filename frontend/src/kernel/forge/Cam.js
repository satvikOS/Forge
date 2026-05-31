/**
 * ArchDisc Forge — CAM (Forge-13)
 *
 * Thin JS facade over the native `forge.cam.*` namespace. The 2.5D toolpath
 * generators (profile / pocket / drill / faceMill) run synchronously in
 * native code, but we expose them as `async`-feeling methods so call sites
 * can await them today and not be surprised when a future slice spins them
 * out to a worker thread. No UI — UI lives in the CAM workbench (later
 * slice).
 *
 * Tools and CuttingParams are plain JS objects passed straight through to
 * the native side; see `forge/Cam.hpp` for the schema. The Toolpath
 * returned from any operation is augmented with a `.toGcode({...})`
 * method so feature code does not have to grab the kernel handle again to
 * post-process it.
 */

import { getForge } from './index.js';

let _kernelOverride = null;
/** Test seam — Node smoke runners can inject the native kernel directly. */
export function _setForgeKernel(kernel) { _kernelOverride = kernel; }
function _kernel() {
  return _kernelOverride || getForge();
}

/**
 * Wrap a raw native toolpath in a small object that knows how to post itself
 * to G-code. We keep the original `.moves` Float32Array around because the
 * native post reads it back; copying would be wasteful for long programs.
 */
function wrapToolpath(raw) {
  return {
    toolId:       raw.toolId,
    moves:        raw.moves,
    moveCount:    raw.moveCount,
    cycleTimeSec: raw.cycleTimeSec,
    estCuttingMm: raw.estCuttingMm,
    toGcode({ dialect = 'Fanuc', safeZ = 25 } = {}) {
      const k = _kernel();
      if (!k.cam || !k.cam.gcode) {
        throw new Error('[forge.cam] gcode namespace unavailable');
      }
      return k.cam.gcode.toGcode(this, dialect, safeZ);
    },
  };
}

export class ForgeCam {
  constructor() {
    const k = _kernel();
    if (!k.cam) {
      throw new Error('[forge.cam] native CAM namespace missing — older kernel?');
    }
    this._cam = k.cam;
  }

  /** Tool-type enum (string keys → numeric values from the native side). */
  get ToolType() { return this._cam.ToolType; }
  /** Sentinel for "first +Z planar face" auto-pick. */
  get kAutoFaceId() { return this._cam.kAutoFaceId; }

  /**
   * Contour the outer boundary of the face, inset by tool radius, stepping
   * from zTop down to zBottom.
   *
   * @param {object}  cfg
   * @param {number}  cfg.shape   forge shape handle
   * @param {number|null} cfg.faceId  face id; null/undefined → kAutoFaceId
   * @param {object}  cfg.tool    Tool (see Cam.hpp)
   * @param {object}  cfg.params  CuttingParams (see Cam.hpp)
   * @param {number}  cfg.zTop
   * @param {number}  cfg.zBottom
   * @param {number}  [cfg.leadIn=0] tangential lead-in mm; 0 = plunge entry
   * @returns {Promise<object>}    wrapped toolpath
   */
  async profile({ shape, faceId = null, tool, params, zTop, zBottom, leadIn = 0 }) {
    const fid = faceId == null ? this.kAutoFaceId : faceId;
    const raw = this._cam.profile(shape, fid, tool, params, zTop, zBottom, leadIn);
    return wrapToolpath(raw);
  }

  /** Pocket clearing: inset-perimeter + zigzag fill, per Z level. */
  async pocket({ shape, faceId = null, tool, params, zTop, zBottom }) {
    const fid = faceId == null ? this.kAutoFaceId : faceId;
    const raw = this._cam.pocket(shape, fid, tool, params, zTop, zBottom);
    return wrapToolpath(raw);
  }

  /**
   * Drill holes straight down. `holes` is `[[x, y, z], …]`; the z entry is
   * informational only (peck/plunge depth comes from zTop / zBottom).
   */
  async drill({ shape, holes, tool, params, zTop, zBottom, peck = false }) {
    const raw = this._cam.drill(shape, holes, tool, params, zTop, zBottom, peck);
    return wrapToolpath(raw);
  }

  /** Single-Z zigzag face mill across the face's XY bbox. */
  async faceMill({ shape, faceId = null, tool, params, zTop, depth }) {
    const fid = faceId == null ? this.kAutoFaceId : faceId;
    const raw = this._cam.faceMill(shape, fid, tool, params, zTop, depth);
    return wrapToolpath(raw);
  }

  // ----------------------------------------------------------- Forge-33
  /**
   * 3-axis adaptive clearing. Engagement-arc-modulated feed: the cutting
   * feedrate is scaled by min(1, localR/minRadius) so tight pockets get
   * a lower feedrate automatically.
   *
   * @param {object} cfg
   * @param {number} cfg.shape     forge shape handle
   * @param {Float64Array|number[]} cfg.stockAabb   [minX,minY,minZ,maxX,maxY,maxZ]
   * @param {object} cfg.tool      Tool
   * @param {object} cfg.params    CuttingParams
   * @param {object} cfg.adaptive  { stepover, zMax, zMin, helixAngle, minRadius }
   */
  async adaptiveClear({ shape, stockAabb, tool, params, adaptive }) {
    const raw = this._cam.adaptiveClear(shape,
      stockAabb instanceof Float64Array ? stockAabb : Float64Array.from(stockAabb),
      tool, params, adaptive);
    return wrapToolpath(raw);
  }

  /**
   * Indexed multi-axis (3+2/4+1/5-axis). Pass an array of [A,B,C] degree
   * triples; output is a single toolpath whose `.perOrientation` field
   * gives the sub-path start indices.
   */
  async multiAxisIndexed({ shape, tool, params, orientations, zTop, zBottom }) {
    const raw = this._cam.multiAxisIndexed(shape, tool, params, orientations, zTop, zBottom);
    return Object.assign(wrapToolpath(raw), { perOrientation: raw.perOrientation });
  }

  /**
   * Continuous 5-axis along a sketched surface path. Each station has
   * (x,y,z,nx,ny,nz). The returned toolpath carries an `axisOrientations`
   * Float32Array of (a,b,c) Euler degrees per move.
   */
  async multiAxisContinuous({ shape, tool, params, path }) {
    const raw = this._cam.multiAxisContinuous(shape, tool, params, path);
    return Object.assign(wrapToolpath(raw), { axisOrientations: raw.axisOrientations });
  }

  /**
   * Voxel stock simulation. `stockAabb` is the 6-element Float64Array,
   * `toolpath` is any toolpath emitted by this module, `tool` carries
   * the diameter used to envelope-stamp each cutting segment.
   */
  async simulateStock({ stockAabb, toolpath, tool, gridResolution = 50 }) {
    return this._cam.simulateStock(
      stockAabb instanceof Float64Array ? stockAabb : Float64Array.from(stockAabb),
      toolpath, tool, gridResolution);
  }

  /**
   * CMM inspection program. `features` is an array of
   * `{ kind: 'plane'|'cylinder'|'point', topo: faceId, label }`. Returns
   * { points: Float64Array (6 doubles per probe), pointsPerFeature, text }.
   */
  async generateCmm({ shape, features, gauge }) {
    return this._cam.generateCmm(shape, features, gauge);
  }
}

export default ForgeCam;
