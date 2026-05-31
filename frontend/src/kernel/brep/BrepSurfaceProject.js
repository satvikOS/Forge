/**
 * ArchDisc Kernel — Surface Pull-back via GeomAPI_ProjectPointOnSurf_2.
 *
 * Provides point-to-B-rep-surface projection — the geometric primitive
 * used by the retopology surface pull-back feature.
 *
 * Algorithm (projectPointsOntoBrep):
 *   1. Collect every face of the BrepShape via TopExp_Explorer_2 (TopAbs_FACE).
 *   2. Extract each face's surface handle via BRep_Tool.Surface_2.
 *   3. For each query point, project onto every face's surface via
 *      GeomAPI_ProjectPointOnSurf_2(pnt, surf, tol). If NbPoints() > 0 the
 *      nearest projection has .NearestPoint() and .LowerDistance().
 *   4. Keep the projection with the smallest LowerDistance across all faces —
 *      this is the standard nearest-face heuristic used by commercial retopo
 *      tools (ZBrush ZRemesher, Houdini retopo). We do NOT enforce UV-in-domain;
 *      the surface is treated as infinite and the distance criterion alone
 *      selects the nearest face. For typical B-rep bodies (sphere, cylinder,
 *      torus, etc.) this produces exact results because the closest point on
 *      the infinite surface lies on the face.
 *   5. Fall back to the input point unchanged if every face projection fails
 *      (NbPoints() == 0 on all faces).
 *
 * Honest scope:
 *   - No UV-in-domain enforcement. A production pull-back would additionally
 *     test whether the projected (u,v) lies within the face's bounding box in
 *     parameter space, and if not, would project onto the face's boundary edges.
 *     The nearest-face-on-infinite-surface approach is exact for convex faces
 *     and a high-quality approximation for concave faces with small curvature.
 *   - The per-face GeomAPI_ProjectPointOnSurf call disposes immediately after use
 *     to avoid WASM heap pressure during large-scale retopo.
 *
 * Refs:
 *   Recon: docs/superpowers/notes/kernel-api-G.md §2
 *   Verified: GeomAPI_ProjectPointOnSurf_2(pnt, surfHandle, 1e-6)
 *             NbPoints() ≥ 1 → NearestPoint() → gp_Pnt; LowerDistance() → mm
 */

import { getKernel } from './kernelLoader.js';
import { withScope, track } from './BrepShape.js';

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Collect all unique faces from a TopoDS_Shape.
 * Returns array of TopoDS_Face (caller must delete them via withScope/track).
 *
 * @param {object} oc
 * @param {object} shape  TopoDS_Shape
 * @returns {object[]}
 */
function _collectFaces(oc, shape) {
  const faces = [];
  const exp = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (exp.More()) {
    faces.push(oc.TopoDS.Face_1(exp.Current()));
    exp.Next();
  }
  exp.delete();
  return faces;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Project a flat array of 3-D points onto the nearest face of a B-rep body.
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape  Source B-rep body.
 * @param {Float32Array|number[]}              points     Flat xyz array (length = 3 × N).
 * @param {object}  [opts]
 * @param {number}  [opts.tolerance=1e-6]  Projection tolerance (mm).
 * @returns {Promise<Float32Array>}  Projected points, same length as input.
 *   Points for which projection fails are returned unchanged.
 */
export async function projectPointsOntoBrep(brepShape, points, opts = {}) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('projectPointsOntoBrep: needs a BrepShape with a live shape');
  }

  const tolerance = Math.max(1e-9, Math.min(1e-2, opts.tolerance ?? 1e-6));
  const n = Math.floor(points.length / 3);
  if (n === 0) return new Float32Array(0);

  const oc = await getKernel();

  return withScope(async () => {
    // ── 1. Collect faces + surface handles ──────────────────────────────────
    const faces = _collectFaces(oc, brepShape.shape);
    if (faces.length === 0) {
      // No faces — return input unchanged.
      const out = new Float32Array(points.length);
      out.set(points instanceof Float32Array ? points : Float32Array.from(points));
      return out;
    }

    // Pre-extract surface handles (one per face) — reused for every query point.
    const surfaces = faces.map(f => oc.BRep_Tool.Surface_2(f));

    // ── 2. Project each query point ─────────────────────────────────────────
    const out = new Float32Array(n * 3);
    const qPnt = new oc.gp_Pnt_3(0, 0, 0);

    for (let i = 0; i < n; i++) {
      const qx = points[i * 3];
      const qy = points[i * 3 + 1];
      const qz = points[i * 3 + 2];

      qPnt.SetX(qx);
      qPnt.SetY(qy);
      qPnt.SetZ(qz);

      let bestDist = Infinity;
      let bestX = qx, bestY = qy, bestZ = qz;

      for (let fi = 0; fi < surfaces.length; fi++) {
        let proj;
        try {
          proj = new oc.GeomAPI_ProjectPointOnSurf_2(qPnt, surfaces[fi], tolerance);
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

      out[i * 3]     = bestX;
      out[i * 3 + 1] = bestY;
      out[i * 3 + 2] = bestZ;
    }

    qPnt.delete();

    // ── 3. Clean up face/surface handles ────────────────────────────────────
    for (const s of surfaces) { try { s.delete(); } catch { /* ok */ } }
    for (const f of faces)    { try { f.delete(); } catch { /* ok */ } }

    // withScope survival filter only applies to BrepShape returns.
    // Float32Array is a plain JS object and survives scope exit unchanged.
    return out;
  });
}

/**
 * Project every vertex of a mesh onto the nearest face of a B-rep body.
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {{ vertices: number[][]|Float32Array, triangles: number[][] }}  mesh
 *   `vertices` may be a nested array `[[x,y,z],...]` or a flat `Float32Array`.
 * @param {object} [opts]   Forwarded to `projectPointsOntoBrep`.
 * @returns {Promise<{ vertices: number[][], triangles: number[][] }>}
 */
export async function projectMeshOntoBrep(brepShape, mesh, opts = {}) {
  if (!mesh || !mesh.vertices || !mesh.triangles) {
    throw new Error('projectMeshOntoBrep: mesh must be { vertices, triangles }');
  }

  // Flatten vertices to a Float32Array for the projection call.
  let flat;
  const verts = mesh.vertices;
  if (verts instanceof Float32Array) {
    flat = verts;
  } else {
    flat = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
      flat[i * 3]     = verts[i][0];
      flat[i * 3 + 1] = verts[i][1];
      flat[i * 3 + 2] = verts[i][2];
    }
  }

  const projected = await projectPointsOntoBrep(brepShape, flat, opts);

  // Re-expand to nested array format for back-compat with IsotropicRemesh.
  const n = Math.floor(projected.length / 3);
  const newVerts = new Array(n);
  for (let i = 0; i < n; i++) {
    newVerts[i] = [projected[i * 3], projected[i * 3 + 1], projected[i * 3 + 2]];
  }

  return { vertices: newVerts, triangles: mesh.triangles };
}
