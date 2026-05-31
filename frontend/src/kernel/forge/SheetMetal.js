/**
 * ArchDisc Forge — Sheet Metal (Forge-24)
 *
 * Thin JS facade over the native `forge.sheetMetal.*` namespace.
 *
 * Workflow (matches the native smoke):
 *   1. Build a closed wire (rectangle for the smoke; arbitrary planar wire
 *      via the existing kernel ops in production).
 *   2. `baseFlange(wire, params)` → handle.
 *   3. `edgeFlange / miterFlange / hem / sketchedBend / jog / ...` on that
 *      handle (each returns a new handle).
 *   4. `unfold(handle, params)` to flatten, or `flatPattern(handle, params)`
 *      to grab the 2D outline ready for laser-cut export.
 *
 * The native side keeps a SheetMetalPart record (bend list + base sizes)
 * for every handle. Re-feature chains read it back so unfold doesn't need
 * to walk the BRep every time.
 */

import { getForge } from './index.js';

let _kernelOverride = null;
/** Test seam — Node smoke runners inject the native kernel directly. */
export function _setForgeKernel(kernel) { _kernelOverride = kernel; }
function _kernel() { return _kernelOverride || getForge(); }

export class ForgeSheetMetal {
  constructor() {
    const k = _kernel();
    if (!k.sheetMetal) {
      throw new Error('[forge.sheetMetal] native namespace missing — older kernel?');
    }
    this._sm = k.sheetMetal;
  }

  /** Build a rectangle wire in the XY plane — handy seed for baseFlange. */
  makeWireRect(w, h)                          { return this._sm.makeWireRect(w, h); }

  /** Build a single line edge from (x0,y0,z0) → (x1,y1,z1). */
  makeLineEdge(x0, y0, z0, x1, y1, z1)        { return this._sm.makeLineEdge(x0, y0, z0, x1, y1, z1); }

  /** Extrude a closed wire to params.thickness — the seed of every sheet-metal part. */
  baseFlange(wireHandle, params)              { return this._sm.baseFlange(wireHandle, params); }

  /** Add a flange on a perimeter edge. `reliefMode` ∈ {'rect','obround','tear'}. */
  edgeFlange(shape, edgeId, params, flangeLengthMm, angleRad, reliefMode = 'rect') {
    return this._sm.edgeFlange(shape, edgeId, params, flangeLengthMm, angleRad, reliefMode);
  }

  /** Multi-edge mitered flange. */
  miterFlange(shape, edgeIds, params, flangeLengthMm, angleRad) {
    return this._sm.miterFlange(shape, edgeIds, params, flangeLengthMm, angleRad);
  }

  /** Hem an edge. `hemType` ∈ {'closed','open','tear-drop','rolled'}. */
  hem(shape, edgeId, params, hemType = 'closed', length = 2.0) {
    return this._sm.hem(shape, edgeId, params, hemType, length);
  }

  /** Sketched bend along a line edge. */
  sketchedBend(shape, lineSketchHandle, params, bendAngleRad, bendRadius) {
    return this._sm.sketchedBend(shape, lineSketchHandle, params, bendAngleRad, bendRadius);
  }

  /** Z-style jog. */
  jog(shape, edgeId, params, jogHeight, angleRad) {
    return this._sm.jog(shape, edgeId, params, jogHeight, angleRad);
  }

  /** Close a 3-flange corner gap. */
  closedCorner(shape, vertexId, params, gapMm) {
    return this._sm.closedCorner(shape, vertexId, params, gapMm);
  }

  /** Add a relief at a corner. `reliefMode` ∈ {'circular','oval','rectangular'}. */
  cornerRelief(shape, vertexId, params, reliefMode = 'circular', sizeMm = 1.0) {
    return this._sm.cornerRelief(shape, vertexId, params, reliefMode, sizeMm);
  }

  /** Flatten the part. Returns a new flat shape handle. */
  unfold(shape, params)                                 { return this._sm.unfold(shape, params); }

  /**
   * 2D flat-pattern outline for laser cutting.
   * Returns `{ wire: ShapeHandle, bbox: [minX,minY,maxX,maxY], formedHeight }`.
   */
  flatPattern(shape, params)                            { return this._sm.flatPattern(shape, params); }

  /** Inspect the recorded bend list (read-only). */
  bends(shape)                                          { return this._sm.bends(shape); }
}

export default ForgeSheetMetal;
