/**
 * ArchDisc Kernel — the unified facade. The single entry point for exact
 * B-rep geometry. OCCT internals never leak past this module. A0 scope:
 * makeBox + measurement + tessellation. A1+ extend `brep`.
 */

import { getOCCT } from './occtKernel.js';
import { makeBox } from './BrepPrimitives.js';
import { tessellate } from './BrepTessellate.js';
import { brepToMesh } from './brepToMesh.js';
import * as Measure from './BrepMeasure.js';

export const ArchDiscKernel = {
  /** Ensure the OCCT WASM module is loaded. */
  init: getOCCT,
  /** Exact B-rep operations. */
  brep: {
    makeBox,
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
