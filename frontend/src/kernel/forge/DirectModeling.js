/**
 * Forge Direct Modeling — synchronous-technology face editing.
 *
 * Wraps the native `forge.direct.*` namespace exposed by the preload bridge.
 * Every method returns a fresh `ForgeBody` (the original is untouched —
 * callers are responsible for disposing it when no longer needed).
 *
 * Face addressing convention: 1-based integers into the BREP face table
 * (the same order OCCT's `TopExp::MapShapes(TopAbs_FACE)` produces). The
 * ids are stable for a given shape but NOT preserved across booleans.
 */

import { getForge, ForgeBody } from './index.js';

function requireDirect() {
  const f = getForge();
  if (!f.direct) {
    throw new Error('[forge.direct] not present on bridge — rebuild forge-kernel >= Forge-23');
  }
  return f.direct;
}

export class ForgeDirect {
  /** Push (positive distance) or pull (negative) `faceId` along its outward normal. */
  static pushPullFace(body, faceId, distance) {
    const h = requireDirect().pushPullFace(body.handle, faceId, distance);
    return new ForgeBody(h, { source: 'direct.pushPull', faceId, distance });
  }

  /** Translate `faceId` by `[tx, ty, tz]`. */
  static moveFace(body, faceId, translation) {
    if (!Array.isArray(translation) || translation.length !== 3) {
      throw new Error('[forge.direct] moveFace: translation must be [tx, ty, tz]');
    }
    const h = requireDirect().moveFace(body.handle, faceId, translation);
    return new ForgeBody(h, { source: 'direct.move', faceId, translation });
  }

  /** Rotate `faceId` about an axis (origin + dir) by `angleRad`. */
  static rotateFace(body, faceId, axisOrigin, axisDir, angleRad) {
    const h = requireDirect().rotateFace(body.handle, faceId, axisOrigin, axisDir, angleRad);
    return new ForgeBody(h, { source: 'direct.rotate', faceId, angleRad });
  }

  /** Remove `faceIds` (array) and stitch a cap across the gap. */
  static deleteFaceAndHeal(body, faceIds) {
    const ids = Array.isArray(faceIds) ? faceIds : [faceIds];
    const h = requireDirect().deleteFaceAndHeal(body.handle, ids);
    return new ForgeBody(h, { source: 'direct.delete', faceIds: ids });
  }

  /** Swap `faceId`'s underlying surface for `spec` ({ kind, origin, normal, radius }). */
  static replaceFace(body, faceId, spec) {
    const h = requireDirect().replaceFace(body.handle, faceId, spec);
    return new ForgeBody(h, { source: 'direct.replaceFace', faceId, spec });
  }

  /** Classify the touched face — kind ∈ {boss, hole, fillet, blend, chamfer, unknown}. */
  static inferFeature(body, faceId) {
    return requireDirect().inferFeature(body.handle, faceId);
  }

  /** Total face count — handy for iterating every face for selection UIs. */
  static faceCount(body) {
    return requireDirect().faceCount(body.handle);
  }
}
