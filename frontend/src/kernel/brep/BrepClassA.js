/**
 * ArchDisc Kernel — class-A curvature analysis facade.
 *
 * `classAAnalyze` tessellates an exact B-rep body into a triangle mesh,
 * computes a TRUE discrete Gaussian-curvature field over it via the
 * angle-deficit (Gauss-Bonnet) operator, derives the production red/white/
 * blue heatmap colours, and returns mesh data ready for a Three.js
 * BufferGeometry with per-vertex colours.
 *
 * The curvature mathematics lives in the kernel-free, node-importable
 * `foundation/ClassACurvature.js`; this facade is the thin B-rep adapter:
 * tessellate → analyze → pack.
 *
 * Honest scope: the curvature is a per-vertex DISCRETE estimate on the
 * tessellation (it converges to the smooth Gaussian curvature under mesh
 * refinement). It is the instrument a class-A modeller reads to find dents
 * and curvature breaks; it is not the exact analytic curvature of the
 * underlying NURBS surfaces. The companion `nurbsCurvature` op gives the
 * analytic path for evaluable NURBS patches.
 */

import { tessellate } from './BrepTessellate.js';
import { analyzeClassACurvature } from '../../foundation/ClassACurvature.js';

/**
 * Class-A Gaussian-curvature analysis of an exact B-rep body.
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {object} [opts]
 * @param {number} [opts.deflection=0.25]  tessellation chord deviation (mm) —
 *                                         finer than the default so curved
 *                                         regions carry enough vertices for a
 *                                         smooth heatmap.
 * @param {number} [opts.percentile=0.98]  percentile for the robust colour
 *                                         range (rejects sliver-triangle
 *                                         curvature spikes).
 * @param {number} [opts.gamma=0.7]        contrast exponent on the colour ramp
 *                                         (<1 lifts low-curvature detail).
 * @param {number} [opts.range]            explicit symmetric ± colour range;
 *                                         overrides the auto percentile range.
 * @returns {Promise<{
 *   positions: Float32Array,
 *   normals:   Float32Array,
 *   indices:   Uint32Array,
 *   colors:    Float32Array,   // per-vertex RGB Gaussian-curvature heatmap
 *   stats: {
 *     gaussianRange: [number,number],   // raw Gaussian curvature extrema (1/mm²)
 *     meanRange:     [number,number],   // raw |mean curvature| extrema (1/mm)
 *     samples: number,                  // vertices analysed
 *     triangleCount: number,
 *     degenerateTriangles: number,
 *     robustRange: number,              // the symmetric ± range the ramp used
 *     deflection: number
 *   }
 * }>}
 */
export async function classAAnalyze(brepShape, opts = {}) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('classAAnalyze: needs a BrepShape');
  }
  const deflection = Number.isFinite(opts.deflection) && opts.deflection > 0
    ? opts.deflection : 0.25;

  // ── 1. Tessellate the exact B-rep → triangle mesh (mm) ─────────────────────
  const tess = await tessellate(brepShape, deflection);
  if (!tess.positions.length || !tess.indices.length) {
    throw new Error('classAAnalyze: tessellation produced an empty mesh');
  }

  // ── 2. Discrete Gaussian-curvature field + per-vertex heatmap colours ──────
  // The colour range rejects sliver-triangle curvature spikes at the 90th
  // percentile (a filleted solid is mostly K≈0 flats + a thin band of genuine
  // curvature — a high percentile would let one spike wash the part white);
  // gamma 0.6 lifts the low-curvature detail so the genuine variation reads.
  const analysis = analyzeClassACurvature(
    { positions: tess.positions, indices: tess.indices },
    {
      percentile: Number.isFinite(opts.percentile) ? opts.percentile : 0.90,
      gamma: Number.isFinite(opts.gamma) ? opts.gamma : 0.6,
      range: opts.range,
    },
  );

  // ── 3. Pack — positions/normals/indices straight from the tessellation,
  //         colours from the curvature analysis (1 RGB triple per vertex). ────
  return {
    positions: tess.positions,
    normals: tess.normals,
    indices: tess.indices,
    colors: analysis.colors,
    stats: {
      gaussianRange: analysis.gaussianRange,
      meanRange: analysis.meanRange,
      samples: analysis.samples,
      triangleCount: analysis.triangleCount,
      degenerateTriangles: analysis.degenerateTriangles,
      robustRange: analysis.robustRange,
      deflection,
    },
  };
}
