/**
 * ArchDisc Kernel — retopology facade (Botsch-Kobbelt 2004 isotropic remeshing).
 *
 * 1. Tessellate the B-rep to a triangle mesh (mm).
 * 2. Weld duplicate vertices (tessellation duplicates per-face).
 * 3. Isotropic remeshing — split/collapse/flip/tangential-relax.
 *    When opts.pullBackToSurface is true (default), a surface pull-back oracle
 *    is built from the input BrepShape's faces via GeomAPI_ProjectPointOnSurf_2
 *    and passed as opts.projectVertex to isotropicRemesh. Every interior vertex
 *    is snapped back onto the nearest face surface after each tangential relax
 *    step and immediately after each new midpoint vertex is created during splits.
 * 4. Compute per-vertex normals via Loop limit-normal evaluator.
 * 5. Return Three.js-ready typed arrays + stats (including projection stats).
 */

import { getKernel } from './kernelLoader.js';
import { tessellate } from './BrepTessellate.js';
import { weldMesh } from '../../foundation/LoopSubdivision.js';
import { isotropicRemesh } from '../../foundation/IsotropicRemesh.js';
import { loopLimitNormals } from '../../foundation/SubdivisionNormals.js';

/**
 * Retopologise a B-rep shape via isotropic remeshing.
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {object} [opts]
 * @param {number}  [opts.targetEdgeLength]   Target edge length L (mm). Omit or 0 for auto (mean).
 * @param {number}  [opts.iterations=5]       Number of B-K iterations (1–10).
 * @param {number}  [opts.deflection=0.5]     Tessellation deflection (mm).
 * @param {boolean} [opts.pullBackToSurface=true]
 *   When true, each interior vertex is projected back onto the nearest B-rep face
 *   surface after each tangential relax step (and after each split-created midpoint).
 *   Uses GeomAPI_ProjectPointOnSurf_2 (recon-verified REACHABLE in kernel-api-G.md §2).
 *   Set to false to get the original Botsch-Kobbelt tangential-only behaviour.
 * @returns {Promise<{
 *   positions: Float32Array,
 *   normals: Float32Array,
 *   indices: Uint32Array,
 *   stats: {
 *     baseVerts: number, baseTris: number,
 *     weldedVerts: number,
 *     retopoVerts: number, retopoTris: number,
 *     projections: number,
 *     maxProjectionDelta: number
 *   }
 * }>}
 */
export async function retopoShape(brepShape, opts = {}) {
  const {
    targetEdgeLength,
    iterations = 5,
    deflection = 0.5,
    pullBackToSurface = true,
  } = opts;

  if (!brepShape || !brepShape.shape) {
    throw new Error('retopoShape: needs a BrepShape');
  }
  if (!(Number.isInteger(iterations) && iterations >= 1)) {
    throw new Error(`retopoShape: iterations must be a positive integer (got ${iterations})`);
  }

  // ── 1. Tessellate B-rep → triangle mesh (positions in mm) ───────────────
  const tess = await tessellate(brepShape, deflection);
  const baseVertices = [];
  for (let i = 0; i < tess.positions.length; i += 3) {
    baseVertices.push([tess.positions[i], tess.positions[i + 1], tess.positions[i + 2]]);
  }
  const baseTriangles = [];
  for (let i = 0; i < tess.indices.length; i += 3) {
    baseTriangles.push([tess.indices[i], tess.indices[i + 1], tess.indices[i + 2]]);
  }
  const baseStats = { baseVerts: baseVertices.length, baseTris: baseTriangles.length };

  // ── 2. Weld duplicate vertices ───────────────────────────────────────────
  const welded = weldMesh({ vertices: baseVertices, triangles: baseTriangles }, 1e-4);

  // ── 3. Build surface pull-back oracle (when enabled) ────────────────────
  let projectVertex;
  let projectionCount = 0;
  let maxProjectionDelta = 0;

  if (pullBackToSurface) {
    const oc = await getKernel();

    // Collect all faces + pre-extract surface handles.
    // We keep these alive for the entire remesh loop (not per-vertex withScope)
    // because the projector is called thousands of times; per-call oc.init()
    // overhead would be prohibitive.
    const faces = [];
    const surfaces = [];
    const exp = new oc.TopExp_Explorer_2(
      brepShape.shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (exp.More()) {
      const face = oc.TopoDS.Face_1(exp.Current());
      faces.push(face);
      surfaces.push(oc.BRep_Tool.Surface_2(face));
      exp.Next();
    }
    exp.delete();

    if (surfaces.length > 0) {
      const qPnt = new oc.gp_Pnt_3(0, 0, 0);

      projectVertex = (idx, pos) => {
        qPnt.SetX(pos[0]);
        qPnt.SetY(pos[1]);
        qPnt.SetZ(pos[2]);

        let bestDist = Infinity;
        let bestX = pos[0], bestY = pos[1], bestZ = pos[2];

        for (let fi = 0; fi < surfaces.length; fi++) {
          let proj;
          try {
            proj = new oc.GeomAPI_ProjectPointOnSurf_2(qPnt, surfaces[fi], 1e-6);
          } catch {
            continue;
          }
          if (proj.NbPoints() > 0) {
            const d = proj.LowerDistance();
            if (d < bestDist) {
              bestDist = d;
              const np = proj.NearestPoint();
              bestX = np.X();
              bestY = np.Y();
              bestZ = np.Z();
              np.delete();
            }
          }
          proj.delete();
        }

        // Track stats.
        projectionCount++;
        const delta = Math.sqrt(
          (bestX - pos[0]) ** 2 +
          (bestY - pos[1]) ** 2 +
          (bestZ - pos[2]) ** 2,
        );
        if (delta > maxProjectionDelta) maxProjectionDelta = delta;

        return [bestX, bestY, bestZ];
      };

      // Register cleanup to run after remeshing completes.
      // (Cleanup is deferred; the local refs hold the objects alive until then.)
      var _cleanupPullBack = () => {
        try { qPnt.delete(); } catch { /* ok */ }
        for (const s of surfaces) { try { s.delete(); } catch { /* ok */ } }
        for (const f of faces)    { try { f.delete(); } catch { /* ok */ } }
      };
    }
  }

  // ── 4. Isotropic remeshing (Botsch-Kobbelt 2004) ─────────────────────────
  const tgt = (typeof targetEdgeLength === 'number' && targetEdgeLength > 0)
    ? targetEdgeLength
    : undefined;

  const remeshed = isotropicRemesh(welded, {
    targetEdgeLength: tgt,
    iterations,
    projectVertex,
  });

  // ── 5. Clean up pull-back WASM objects ───────────────────────────────────
  if (typeof _cleanupPullBack === 'function') {
    _cleanupPullBack();
    _cleanupPullBack = null;
  }

  // ── 6. Loop limit-normals for smooth shading ──────────────────────────────
  const normals = loopLimitNormals(remeshed);

  // ── 7. Pack into Three.js-ready typed arrays ──────────────────────────────
  const positions = new Float32Array(remeshed.vertices.length * 3);
  for (let i = 0; i < remeshed.vertices.length; i++) {
    positions[i * 3]     = remeshed.vertices[i][0];
    positions[i * 3 + 1] = remeshed.vertices[i][1];
    positions[i * 3 + 2] = remeshed.vertices[i][2];
  }
  const indices = new Uint32Array(remeshed.triangles.length * 3);
  for (let i = 0; i < remeshed.triangles.length; i++) {
    indices[i * 3]     = remeshed.triangles[i][0];
    indices[i * 3 + 1] = remeshed.triangles[i][1];
    indices[i * 3 + 2] = remeshed.triangles[i][2];
  }

  return {
    positions,
    normals,
    indices,
    stats: {
      ...baseStats,
      weldedVerts: welded.vertices.length,
      retopoVerts: remeshed.vertices.length,
      retopoTris:  remeshed.triangles.length,
      projections:           projectionCount,
      maxProjectionDelta:    maxProjectionDelta,
    },
  };
}
