/**
 * ArchDisc Kernel — the unified facade. The single entry point for exact
 * B-rep geometry. OCCT internals never leak past this module. A0 scope:
 * makeBox + measurement + tessellation. A1 scope: all primitives, booleans,
 * features (extrude/revolve/fillet/chamfer), and STEP import/export.
 */

import { getOCCT } from './occtKernel.js';
import {
  makeBox, makeCylinder, makeSphere, makeCone, makeTorus,
} from './BrepPrimitives.js';
import { fuse, cut, common } from './BrepBoolean.js';
import { extrudeRect, revolveRect, filletAll, chamferAll, variableFillet } from './BrepFeatures.js';
import { exportStep, importStep } from './BrepStep.js';
import { shell, thicken, offsetShape, draft } from './BrepLocalOps.js';
import { sweep, loft } from './BrepSurfacing.js';
import { checkSelfIntersection, checkClash } from './BrepCheck.js';
import { tessellate } from './BrepTessellate.js';
import { brepToMesh } from './brepToMesh.js';
import * as Measure from './BrepMeasure.js';

export const ArchDiscKernel = {
  /** Ensure the OCCT WASM module is loaded. */
  init: getOCCT,
  /** Exact B-rep operations. */
  brep: {
    makeBox,
    makeCylinder, makeSphere, makeCone, makeTorus,
    fuse, cut, common,
    extrudeRect, revolveRect, filletAll, chamferAll, variableFillet,
    shell, thicken, offsetShape, draft,
    sweep, loft,
    checkSelfIntersection, checkClash,
    exportStep, importStep,
    /** Returns cached triangle data ({positions,normals,indices}); normally used via brepToMesh. */
    tessellate,
    brepToMesh,
    volume: Measure.volume,
    area: Measure.area,
    faceCount: Measure.faceCount,
    edgeCount: Measure.edgeCount,
    boundingBox: Measure.boundingBox,
    /** All metrics in one call — convenient for e2e assertions. */
    async measure(brepShape) {
      return {
        volume: await Measure.volume(brepShape),
        area: await Measure.area(brepShape),
        faceCount: await Measure.faceCount(brepShape),
        edgeCount: await Measure.edgeCount(brepShape),
        boundingBox: await Measure.boundingBox(brepShape),
      };
    },
  },
};
