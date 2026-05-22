/**
 * ArchDisc Kernel — tessellate a B-rep shape into plain triangle data
 * ready for a Three.js BufferGeometry. Positions are in mm.
 */

import { getOCCT } from './kernelLoader.js';
import { track, withScope } from './BrepShape.js';

/**
 * Tessellate a BrepShape.
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {number} [deflection]  linear chord deviation (mm); smaller = finer
 * @returns {Promise<{positions:Float32Array,normals:Float32Array,indices:Uint32Array}>}
 */
export async function tessellate(brepShape, deflection = 0.1) {
  if (brepShape._triangulation) return brepShape._triangulation;
  return withScope(async () => {
    const oc = await getOCCT();
    const shape = brepShape.shape;

    // Generate the mesh on the shape's faces.
    track(new oc.BRepMesh_IncrementalMesh_2(shape, deflection, false, 0.5, false));

    const positions = [];
    const indices = [];
    const explorer = track(
      new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE),
    );
    const loc = track(new oc.TopLoc_Location_1());
    for (; explorer.More(); explorer.Next()) {
      const face = track(oc.TopoDS.Face_1(explorer.Current()));
      const triHandle = oc.BRep_Tool.Triangulation(face, loc, 0);
      // m1: track triHandle immediately — before IsNull check — so a non-null
      // but IsNull handle is still freed rather than leaking.
      if (triHandle) track(triHandle);
      if (!triHandle || triHandle.IsNull()) { continue; }
      const tri = triHandle.get();
      const base = positions.length / 3;
      const nbNodes = tri.NbNodes();
      // tri.Node(i) returns gp_Pnt by value. For identity location (all
      // primitive solids placed at origin) skip the transform — the Embind
      // binding for the return-by-value gp_Pnt may not expose .Transformed().
      // For non-identity apply the affine matrix via gp_Trsf.Value(row,col).
      if (loc.IsIdentity()) {
        for (let i = 1; i <= nbNodes; i++) {
          const p = tri.Node(i);
          positions.push(p.X(), p.Y(), p.Z());
        }
      } else {
        // gp_Trsf.Value(row, col) — rows 1..3, cols 1..4 (col 4 = translation).
        const t = loc.Transformation();
        const m11 = t.Value(1,1), m12 = t.Value(1,2), m13 = t.Value(1,3), m14 = t.Value(1,4);
        const m21 = t.Value(2,1), m22 = t.Value(2,2), m23 = t.Value(2,3), m24 = t.Value(2,4);
        const m31 = t.Value(3,1), m32 = t.Value(3,2), m33 = t.Value(3,3), m34 = t.Value(3,4);
        for (let i = 1; i <= nbNodes; i++) {
          const p = tri.Node(i);
          const px = p.X(), py = p.Y(), pz = p.Z();
          positions.push(
            m11*px + m12*py + m13*pz + m14,
            m21*px + m22*py + m23*pz + m24,
            m31*px + m32*py + m33*pz + m34,
          );
        }
      }
      const oriVal = face.Orientation_1();
      // I2: compare integer .value properties — opencascade.js Embind wraps
      // TopAbs_Orientation as an object { value: N }, so === on the objects
      // is a reference comparison that is always false. Extract .value instead.
      const reversedVal = oc.TopAbs_Orientation.TopAbs_REVERSED;
      const reversed = (typeof oriVal === 'number')
        ? oriVal === reversedVal
        : (oriVal && reversedVal && oriVal.value === reversedVal.value);
      const nbTri = tri.NbTriangles();
      for (let i = 1; i <= nbTri; i++) {
        const t = tri.Triangle(i);
        const a = base + t.Value(1) - 1;
        const b = base + t.Value(2) - 1;
        const c = base + t.Value(3) - 1;
        if (reversed) { indices.push(a, c, b); } else { indices.push(a, b, c); }
      }
    }

    const posArr = new Float32Array(positions);
    const idxArr = new Uint32Array(indices);
    const normals = computeNormals(posArr, idxArr);
    const result = { positions: posArr, normals, indices: idxArr };
    // Cache on the shape BEFORE returning so subsequent calls return from cache.
    brepShape._triangulation = result;
    // withScope returns whatever fn returns; no BrepShape is returned so all
    // tracked kernel objects are freed. The result is a plain JS object — safe.
    return result;
  });
}

/**
 * Tessellate a BrepShape into triangle data WITH a per-triangle B-rep face id.
 *
 * Unlike `tessellate`, this keeps the face partition: `faceIds[i]` is the
 * 0-based index of the B-rep face that triangle `i` belongs to (faces in
 * TopExp_Explorer order, IsSame-deduplicated). It also returns `faceAdjacency`
 * — pairs of face indices that share a B-rep EDGE, i.e. faces that touch
 * legitimately. Self-intersection detection consumes both: it skips triangle
 * pairs on the same face or on edge-adjacent faces (those meet at a shared
 * boundary, not a crossing).
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {number} [deflection]  linear chord deviation (mm); smaller = finer
 * @returns {Promise<{positions:Float32Array, indices:Uint32Array,
 *   faceIds:Int32Array, faceCount:number, faceAdjacency:Array<[number,number]>}>}
 */
export async function tessellatePerFace(brepShape, deflection = 0.1) {
  return withScope(async () => {
    const oc = await getOCCT();
    const shape = brepShape.shape;

    track(new oc.BRepMesh_IncrementalMesh_2(shape, deflection, false, 0.5, false));

    // Dedup faces by IsSame so the face index is stable and matches faceCount.
    const faceExp = track(new oc.TopExp_Explorer_2(
      shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
    const faces = [];
    for (; faceExp.More(); faceExp.Next()) {
      const cur = track(oc.TopoDS.Face_1(faceExp.Current()));
      if (faces.some((f) => f.IsSame(cur))) continue;
      faces.push(cur);
    }

    const positions = [];
    const indices = [];
    const faceIds = [];
    const loc = track(new oc.TopLoc_Location_1());

    for (let fi = 0; fi < faces.length; fi++) {
      const face = faces[fi];
      const triHandle = oc.BRep_Tool.Triangulation(face, loc, 0);
      if (triHandle) track(triHandle);
      if (!triHandle || triHandle.IsNull()) continue;
      const tri = triHandle.get();
      const base = positions.length / 3;
      const nbNodes = tri.NbNodes();
      if (loc.IsIdentity()) {
        for (let i = 1; i <= nbNodes; i++) {
          const p = tri.Node(i);
          positions.push(p.X(), p.Y(), p.Z());
        }
      } else {
        const t = loc.Transformation();
        const m11 = t.Value(1,1), m12 = t.Value(1,2), m13 = t.Value(1,3), m14 = t.Value(1,4);
        const m21 = t.Value(2,1), m22 = t.Value(2,2), m23 = t.Value(2,3), m24 = t.Value(2,4);
        const m31 = t.Value(3,1), m32 = t.Value(3,2), m33 = t.Value(3,3), m34 = t.Value(3,4);
        for (let i = 1; i <= nbNodes; i++) {
          const p = tri.Node(i);
          const px = p.X(), py = p.Y(), pz = p.Z();
          positions.push(
            m11*px + m12*py + m13*pz + m14,
            m21*px + m22*py + m23*pz + m24,
            m31*px + m32*py + m33*pz + m34,
          );
        }
      }
      const oriVal = face.Orientation_1();
      const reversedVal = oc.TopAbs_Orientation.TopAbs_REVERSED;
      const reversed = (typeof oriVal === 'number')
        ? oriVal === reversedVal
        : (oriVal && reversedVal && oriVal.value === reversedVal.value);
      const nbTri = tri.NbTriangles();
      for (let i = 1; i <= nbTri; i++) {
        const t = tri.Triangle(i);
        const a = base + t.Value(1) - 1;
        const b = base + t.Value(2) - 1;
        const c = base + t.Value(3) - 1;
        if (reversed) { indices.push(a, c, b); } else { indices.push(a, b, c); }
        faceIds.push(fi);
      }
    }

    // Face adjacency: faces sharing a B-rep edge meet legitimately. Walk each
    // edge's parent faces via TopExp.MapShapesAndAncestors.
    const faceAdjacency = [];
    try {
      const edgeFaceMap = track(new oc.TopTools_IndexedDataMapOfShapeListOfShape_1());
      oc.TopExp.MapShapesAndAncestors(
        shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_FACE, edgeFaceMap);
      const indexOfFace = (f) => {
        for (let k = 0; k < faces.length; k++) if (faces[k].IsSame(f)) return k;
        return -1;
      };
      const seen = new Set();
      const n = edgeFaceMap.Extent();
      for (let e = 1; e <= n; e++) {
        const lst = edgeFaceMap.FindFromIndex(e);
        const it = track(new oc.TopTools_ListIteratorOfListOfShape_2(lst));
        const adjFaces = [];
        for (; it.More(); it.Next()) {
          const idx = indexOfFace(track(it.Value()));
          if (idx >= 0 && !adjFaces.includes(idx)) adjFaces.push(idx);
        }
        for (let i = 0; i < adjFaces.length; i++) {
          for (let j = i + 1; j < adjFaces.length; j++) {
            const lo = Math.min(adjFaces[i], adjFaces[j]);
            const hi = Math.max(adjFaces[i], adjFaces[j]);
            const key = `${lo}|${hi}`;
            if (!seen.has(key)) { seen.add(key); faceAdjacency.push([lo, hi]); }
          }
        }
      }
    } catch {
      // Adjacency map unavailable — SelfIntersection falls back to its own
      // position-based shared-edge inference, which is also correct.
    }

    return {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      faceIds: new Int32Array(faceIds),
      faceCount: faces.length,
      faceAdjacency,
    };
  });
}

/** Per-vertex normals from face geometry (averaged). */
function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ux = positions[ib] - positions[ia];
    const uy = positions[ib + 1] - positions[ia + 1];
    const uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia];
    const vy = positions[ic + 1] - positions[ia + 1];
    const vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const idx of [ia, ib, ic]) {
      normals[idx] += nx; normals[idx + 1] += ny; normals[idx + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return normals;
}
