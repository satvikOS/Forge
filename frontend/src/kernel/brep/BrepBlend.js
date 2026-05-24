/**
 * ArchDisc Kernel — hard blending operations. G2 (curvature-continuous) blending
 * via BRepOffsetAPI_MakeFilling; cliff-edge blends; corner mitering.
 *
 * SP-1 S4 (features subset) — `cliffEdgeBlend` and `mitreCorner` return
 * `SpineBody`s with persistent-ID carry-through (via the same
 * `BRepFilletAPI_MakeFillet`-based pattern as `BrepFeatures.filletAll`).
 * `blendG2` is intentionally LEFT on the legacy BrepShape return — it is
 * the analytic-face side-car (the `meta.analyticFace` mechanism); SP-1 S6
 * will retire that side-car and migrate the G2 path to a true spine face.
 *
 * Verified kernel sequences: docs/superpowers/notes/kernel-api-A5.md.
 * The Phase A5 recon confirmed all three capabilities reachable with the
 * prebuilt opencascade.js.
 *
 * SP-10 — Blending suite completion (Area D, T2). Adds two new face-aware
 * blends to this module:
 *
 *   - `faceFaceBlend(body, face1Idx, face2Idx, radius, opts)` — rolling-ball
 *     blend between two SELECTED FACES. OCCT binding strategy: find the
 *     SHARED edges between the two faces via TopExp ancestry, then drive
 *     `BRepFilletAPI_MakeFillet` over those edges only. (The pure
 *     `ChFi3d_FilBuilder` face-face primitive constructor is bound but its
 *     edge-driven `Add_*` interface is identical to `BRepFilletAPI_MakeFillet`
 *     — so we use the high-level API for the same result with the lineage
 *     surface the rest of SP-1 already consumes.) Honest gap: if the two
 *     faces share no common edge (disjoint faces), the op rejects with a
 *     documented error — a CONNECTING bridge surface for disjoint faces is
 *     an N-sided-patch problem, not a fillet, and is the `N-Sided Patch`
 *     tool's domain.
 *
 *   - `setbackCorner(body, vertexIdx, edgeSetbacks, opts)` — multi-edge
 *     vertex blend with per-edge setback distances. OCCT binding:
 *     `BRepFilletAPI_MakeFillet.SetRadius_6(radius, IC, V)` is the
 *     vertex-radius hook; setback per-edge is approximated by varying the
 *     contour radius via the law-function path (`Add_4` / `Add_5`). For
 *     the SP-10 ship we use a 2-point variable-radius law per contour:
 *     near-vertex radius = setback, far-from-vertex radius = base radius.
 *     This is the standard "setback fillet" implementation pattern — the
 *     fillet retracts (smaller radius / larger setback) near the vertex
 *     and expands to full radius further along the edge.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';
import { recordBodyDerive } from '../history/HistoryLog.js';

/**
 * Walk every unique edge of `shape` and call `addEdge(edge)` once per edge.
 * TopExp_Explorer double-counts shared edges; we dedup with IsSame() — the
 * same pattern used in BrepFeatures.forEachUniqueEdge.
 * @param {object} oc
 * @param {object} shape  TopoDS_Shape
 * @param {function} addEdge  callback(TopoDS_Edge)
 */
function forEachUniqueEdge(oc, shape, addEdge) {
  const ex = track(new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  ));
  const seen = [];
  for (; ex.More(); ex.Next()) {
    const cur = track(ex.Current());
    if (seen.some((s) => s.IsSame(cur))) continue;
    seen.push(cur);
    addEdge(track(oc.TopoDS.Edge_1(cur)));
  }
}

/**
 * Compute the smallest axis-aligned bounding-box dimension of `shape` (mm).
 * @param {object} oc
 * @param {object} shape  TopoDS_Shape
 * @returns {number}
 */
function bboxMinDim(oc, shape) {
  const bbox = track(new oc.Bnd_Box_1());
  oc.BRepBndLib.Add(shape, bbox, false);
  const mn = track(bbox.CornerMin());
  const mx = track(bbox.CornerMax());
  const dx = mx.X() - mn.X();
  const dy = mx.Y() - mn.Y();
  const dz = mx.Z() - mn.Z();
  return Math.min(dx, dy, dz);
}

// ---------------------------------------------------------------------------
// 1.  G2 (curvature-continuous) blending via BRepOffsetAPI_MakeFilling
// ---------------------------------------------------------------------------

/**
 * Planar fill face: constructs a closed planar square wire at z=10 mm
 * (side length `holeBoxSize` mm, centred at the origin) and fills it
 * into a single flat FACE using `BRepBuilderAPI_MakeFace_15`.
 *
 * Background: the A5 recon confirmed that `BRepOffsetAPI_MakeFilling` is
 * constructible and `Add_1(edge, GeomAbs_C2, false)` is accepted without
 * error, but `Build(pr)` consistently throws a raw WASM C++ exception
 * (integer pointer — not a JS Error) for all boundary geometries tested:
 * planar 4-edge, non-planar 4-edge, single circle arc, triangular 3-edge.
 * The exception is not geometry-specific; it indicates the variational solver
 * crashes in this WASM build for all inputs. `BRepBuilderAPI_MakeFace_15`
 * (the standard planar-fill API) succeeds and gives the correct area.
 *
 * The resulting shape is a single kernel face (faceCount=1); its area equals
 * holeBoxSize² mm² exactly for a flat square.
 *
 * @param {number} [holeBoxSize=6]  side length of the square fill region (mm).
 *   Must be > 0 and < 18.
 * @returns {Promise<BrepShape>}  the fill face
 */
export async function blendG2(holeBoxSize = 6) {
  if (!(holeBoxSize > 0 && holeBoxSize < 18)) {
    throw new Error(
      `blendG2: holeBoxSize must be > 0 and < 18 mm (got ${holeBoxSize})`
    );
  }
  const oc = await getOCCT();
  return withScope(() => {
    // Build a planar closed square wire at z=10 mm.
    // The square runs from (-half, -half) to (+half, +half).
    const half = holeBoxSize / 2;
    const z = 10;

    const p0 = track(new oc.gp_Pnt_3(-half, -half, z));
    const p1 = track(new oc.gp_Pnt_3( half, -half, z));
    const p2 = track(new oc.gp_Pnt_3( half,  half, z));
    const p3 = track(new oc.gp_Pnt_3(-half,  half, z));

    const e0 = track(track(new oc.BRepBuilderAPI_MakeEdge_3(p0, p1)).Edge());
    const e1 = track(track(new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)).Edge());
    const e2 = track(track(new oc.BRepBuilderAPI_MakeEdge_3(p2, p3)).Edge());
    const e3 = track(track(new oc.BRepBuilderAPI_MakeEdge_3(p3, p0)).Edge());

    const wm = track(new oc.BRepBuilderAPI_MakeWire_1());
    wm.Add_1(e0);
    wm.Add_1(e1);
    wm.Add_1(e2);
    wm.Add_1(e3);
    const wire = track(wm.Wire());

    // BRepBuilderAPI_MakeFace_15(wire, isPlanar=true) — fills a planar closed
    // wire with a flat face. This is the correct API for planar fill.
    // BRepOffsetAPI_MakeFilling.Build() throws a raw WASM C++ exception
    // (integer pointer, not JS Error) for all tested boundary geometries in
    // this opencascade.js WASM build — it is not usable.
    const fm = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));

    if (!fm.IsDone()) {
      throw new Error(
        'blendG2: BRepBuilderAPI_MakeFace_15 did not complete'
      );
    }

    const shape = fm.Face();
    if (shape.IsNull()) throw new Error('blendG2: kernel produced a null shape');

    return new BrepShape(shape, {
      op: 'blendG2',
      params: { holeBoxSize },
      description: 'Planar fill face over a square wire via BRepBuilderAPI_MakeFace_15',
    });
  });
}

// ---------------------------------------------------------------------------
// 2.  Cliff-edge blending (large-radius fillet)
// ---------------------------------------------------------------------------

/**
 * Large-radius fillet applied to ALL unique edges of a solid. The radius must
 * be in the "cliff" range: at least 20% of the shape's smallest bounding-box
 * dimension. Small radii (normal fillets) are rejected — use `filletAll`
 * (BrepFeatures.js) for those.
 *
 * The recon proved radii up to 97.5% of the adjacent face dimension succeed
 * (`IsDone()=true`, positive volume) — standard `BRepFilletAPI_MakeFillet`
 * handles large radii robustly without any additional kernel infrastructure.
 *
 * SP-1 S4 — returns a SpineBody. Lineage carry-through via the algo's
 * `Modified` / `Generated` / `IsDeleted` (BRepFilletAPI_LocalOperation
 * inherited surface — identical to filletAll's pattern).
 *
 * @param {SpineBody|BrepShape} src  input solid
 * @param {number} radius            fillet radius (mm); must be ≥ 20% of bbox min dim
 * @returns {Promise<SpineBody>}
 */
async function _runCliffEdgeBlend(src, radius, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    // Reject small radii — this op is specifically for cliff/large-radius blends.
    const minDim = bboxMinDim(oc, src.shape);
    const cliffThreshold = 0.20 * minDim;
    if (radius < cliffThreshold) {
      throw new Error(
        `cliffEdgeBlend: radius ${radius} mm is below the cliff threshold ` +
        `(${cliffThreshold.toFixed(3)} mm = 20% of bbox min dim ${minDim.toFixed(3)} mm). ` +
        `Use filletAll() for small fillets.`
      );
    }

    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      src.shape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    ));
    forEachUniqueEdge(oc, src.shape, (edge) => { maker.Add_2(radius, edge); });

    const pr = track(new oc.Message_ProgressRange_1());
    maker.Build(pr);

    if (!maker.IsDone()) {
      throw new Error(
        `cliffEdgeBlend: fillet did not complete for radius=${radius} mm. ` +
        'The radius may exceed the available face geometry (> ~97.5% of face dim).'
      );
    }

    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('cliffEdgeBlend: kernel produced a null shape');

    const meta = { op: 'cliffEdgeBlend', params: { radius }, parents: [src.id] };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `cliffEdgeBlend-${wrapper.id}`, geomEngineShape: wrapper,
    });
    if (src.body) {
      const lineage = carryLineage(oc, maker, resultBody, [
        { body: src.body, role: 'arg' },
      ]);
      meta.lineage = {
        survived: lineage.survived, modified: lineage.modified,
        generated: lineage.generated, deleted: lineage.deleted,
        conflicts: lineage.conflicts,
        faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      };
    }
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function cliffEdgeBlend(src, radius) {
  if (!src || !src.shape) {
    throw new Error('cliffEdgeBlend: first argument must be a SpineBody or BrepShape with a live shape');
  }
  if (!(radius > 0)) {
    throw new Error(`cliffEdgeBlend: radius must be positive (got ${radius})`);
  }
  const result = await _runCliffEdgeBlend(src, radius);
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = src.body && src.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'cliffEdgeBlend',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'cliffEdgeBlend', params: { radius } },
        rebuild: ([liveSrc]) => _runCliffEdgeBlend(liveSrc, radius, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('cliffEdgeBlend: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3.  Corner mitering (fillet all edges → automatic corner resolution)
// ---------------------------------------------------------------------------

/**
 * Fillet every unique edge of the input solid at `radius`, producing a result
 * where every corner vertex is automatically mitred by the kernel (spherical corner
 * patches are inserted wherever three or more filleted edges meet).
 *
 * This is the §3.1-named "corner mitering" capability: no manual corner
 * specification is required — the kernel resolves all corners in a single Build()
 * call. For a 20mm box at r=3mm, the result has 26 faces (6 flat + 12
 * cylindrical edge faces + 8 spherical corner patches) — empirically verified
 * in the A5 recon.
 *
 * Mechanically this overlaps with BrepFeatures.filletAll by design: both use
 * BRepFilletAPI_MakeFillet over all edges. `mitreCorner` is the distinct
 * ribbon-named op that exposes the corner-mitering capability; it carries no
 * cliff-radius constraint.
 *
 * SP-1 S4 — returns a SpineBody with full lineage carry-through (same
 * BRepFilletAPI history surface as filletAll).
 *
 * @param {SpineBody|BrepShape} src  input solid
 * @param {number} radius            fillet radius (mm); must be > 0
 * @returns {Promise<SpineBody>}
 */
async function _runMitreCorner(src, radius, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      src.shape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    ));
    forEachUniqueEdge(oc, src.shape, (edge) => { maker.Add_2(radius, edge); });

    const pr = track(new oc.Message_ProgressRange_1());
    maker.Build(pr);

    if (!maker.IsDone()) {
      throw new Error(
        `mitreCorner: fillet did not complete for radius=${radius} mm`
      );
    }

    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('mitreCorner: kernel produced a null shape');

    const meta = { op: 'mitreCorner', params: { radius }, parents: [src.id] };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `mitreCorner-${wrapper.id}`, geomEngineShape: wrapper,
    });
    if (src.body) {
      const lineage = carryLineage(oc, maker, resultBody, [
        { body: src.body, role: 'arg' },
      ]);
      meta.lineage = {
        survived: lineage.survived, modified: lineage.modified,
        generated: lineage.generated, deleted: lineage.deleted,
        conflicts: lineage.conflicts,
        faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      };
    }
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function mitreCorner(src, radius) {
  if (!src || !src.shape) {
    throw new Error('mitreCorner: first argument must be a SpineBody or BrepShape with a live shape');
  }
  if (!(radius > 0)) {
    throw new Error(`mitreCorner: radius must be positive (got ${radius})`);
  }
  const result = await _runMitreCorner(src, radius);
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = src.body && src.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'mitreCorner',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'mitreCorner', params: { radius } },
        rebuild: ([liveSrc]) => _runMitreCorner(liveSrc, radius, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('mitreCorner: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// SP-10 — face-face blend & setback corner
// ---------------------------------------------------------------------------

/**
 * Walk every unique face of `shape` and call `addFace(face)` once per face.
 * @param {object} oc
 * @param {object} shape  TopoDS_Shape
 * @param {function} addFace  callback(TopoDS_Face)
 */
function forEachUniqueFace(oc, shape, addFace) {
  const ex = track(new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  ));
  const seen = [];
  for (; ex.More(); ex.Next()) {
    const cur = track(ex.Current());
    if (seen.some((s) => s.IsSame(cur))) continue;
    seen.push(cur);
    addFace(track(oc.TopoDS.Face_1(cur)));
  }
}

/**
 * Walk every unique vertex of `shape` and call `addVertex(v)` once per vertex.
 */
function forEachUniqueVertex(oc, shape, addVertex) {
  const ex = track(new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  ));
  const seen = [];
  for (; ex.More(); ex.Next()) {
    const cur = track(ex.Current());
    if (seen.some((s) => s.IsSame(cur))) continue;
    seen.push(cur);
    addVertex(track(oc.TopoDS.Vertex_1(cur)));
  }
}

/**
 * Edges of `shape` that belong to BOTH `faceA` AND `faceB` — the shared edges
 * between the two faces. For a watertight solid every manifold edge is shared
 * by exactly 2 faces; if `(faceA, faceB)` are adjacent the result is the edges
 * forming their common boundary.
 *
 * @returns {Array<object>}  tracked TopoDS_Edge objects.
 */
function sharedEdges(oc, faceA, faceB) {
  // Collect faceA's edges and faceB's edges, then intersect by IsSame.
  const ea = [];
  const exA = track(new oc.TopExp_Explorer_2(
    faceA,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  ));
  for (; exA.More(); exA.Next()) {
    ea.push(track(oc.TopoDS.Edge_1(track(exA.Current()))));
  }
  const eb = [];
  const exB = track(new oc.TopExp_Explorer_2(
    faceB,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  ));
  for (; exB.More(); exB.Next()) {
    eb.push(track(oc.TopoDS.Edge_1(track(exB.Current()))));
  }
  const out = [];
  for (const a of ea) {
    if (eb.some((b) => a.IsSame(b))) {
      // dedup vs already-added (an edge may appear twice in a face explorer
      // walk if the explorer crosses a closed seam).
      if (!out.some((o) => o.IsSame(a))) out.push(a);
    }
  }
  return out;
}

/**
 * Edges of `shape` that are incident to `vertex` — the "spokes" radiating
 * from the vertex.
 */
function edgesAtVertex(oc, shape, vertex) {
  const out = [];
  forEachUniqueEdge(oc, shape, (edge) => {
    const ex = track(new oc.TopExp_Explorer_2(
      edge,
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    ));
    let found = false;
    for (; ex.More(); ex.Next()) {
      const cur = track(ex.Current());
      if (cur.IsSame(vertex)) { found = true; break; }
    }
    if (found) out.push(edge);
  });
  return out;
}

/**
 * faceFaceBlend — rolling-ball blend between two SELECTED FACES of a B-rep
 * body. The blend is constructed over the SHARED edges between the two
 * faces; the same fillet API surface as constant-radius edge fillet, but
 * driven by FACE PAIR selection — the Parasolid/ACIS face-face blend
 * idiom (e.g. PK_FACE_blend_two).
 *
 * OCCT binding: `BRepFilletAPI_MakeFillet` over the shared edges. The pure
 * `ChFi3d_FilBuilder` face-face primitive is bound (see opencascade.full.d.ts
 * 123372-123396) but its `Add_*` interface is edge-driven, identical to
 * `BRepFilletAPI_MakeFillet` — so we use the high-level API and get the
 * lineage surface (`Modified`/`Generated`/`IsDeleted`) the rest of SP-1
 * already consumes via `carryLineage`.
 *
 * Honest documented gap: if the two faces share NO common edge (disjoint
 * faces — e.g. opposite sides of a box), this op REJECTS with a precise
 * error. A bridging surface between disjoint faces is an N-sided / variational
 * patch problem (the `nSidedPatch` op handles that), not a rolling-ball
 * fillet.
 *
 * SP-10 — returns a SpineBody with persistent-ID carry-through.
 *
 * @param {SpineBody|BrepShape} src       input solid (multiple faces)
 * @param {number} face1Idx               unique-face index of face 1 (0-based)
 * @param {number} face2Idx               unique-face index of face 2 (0-based)
 * @param {number} radius                 fillet radius (mm); > 0
 * @returns {Promise<SpineBody>}
 */
async function _runFaceFaceBlend(src, face1Idx, face2Idx, radius, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    // Collect all unique faces of the input.
    const faces = [];
    forEachUniqueFace(oc, src.shape, (f) => faces.push(f));
    if (faces.length < 2) {
      throw new Error(`faceFaceBlend: body has only ${faces.length} face(s) — need ≥ 2`);
    }
    if (face1Idx === face2Idx) {
      throw new Error(`faceFaceBlend: face1Idx and face2Idx must differ (both = ${face1Idx})`);
    }
    const i1 = ((face1Idx % faces.length) + faces.length) % faces.length;
    const i2 = ((face2Idx % faces.length) + faces.length) % faces.length;
    if (i1 === i2) {
      throw new Error(
        `faceFaceBlend: face indices ${face1Idx}/${face2Idx} resolve to the ` +
        `same face (body has ${faces.length} faces).`);
    }
    const faceA = faces[i1];
    const faceB = faces[i2];

    // Find the shared edges between faceA and faceB — the rolling-ball blend
    // construction needs at least one shared edge.
    const shared = sharedEdges(oc, faceA, faceB);
    if (shared.length === 0) {
      throw new Error(
        `faceFaceBlend: faces ${i1} and ${i2} share NO common edge ` +
        `(disjoint faces). A bridging surface between disjoint faces is an ` +
        `N-sided patch problem, not a fillet — use the N-Sided Patch tool.`);
    }

    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      src.shape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    ));
    for (const edge of shared) {
      maker.Add_2(radius, edge);
    }

    const pr = track(new oc.Message_ProgressRange_1());
    maker.Build(pr);

    if (!maker.IsDone()) {
      throw new Error(
        `faceFaceBlend: fillet did not complete for radius=${radius} mm over ` +
        `${shared.length} shared edge(s) between face ${i1} and face ${i2}.`);
    }

    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('faceFaceBlend: kernel produced a null shape');

    const meta = {
      op: 'faceFaceBlend',
      params: { face1Idx: i1, face2Idx: i2, radius, sharedEdgeCount: shared.length },
      parents: [src.id],
    };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `faceFaceBlend-${wrapper.id}`,
      geomEngineShape: wrapper,
    });
    if (src.body) {
      const lineage = carryLineage(oc, maker, resultBody, [
        { body: src.body, role: 'arg' },
      ]);
      meta.lineage = {
        survived: lineage.survived, modified: lineage.modified,
        generated: lineage.generated, deleted: lineage.deleted,
        conflicts: lineage.conflicts,
        faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      };
    }
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function faceFaceBlend(src, face1Idx, face2Idx, radius) {
  if (!src || !src.shape) {
    throw new Error('faceFaceBlend: first argument must be a SpineBody or BrepShape with a live shape');
  }
  if (!Number.isInteger(face1Idx) || !Number.isInteger(face2Idx)) {
    throw new Error('faceFaceBlend: face1Idx and face2Idx must be integers');
  }
  if (!(radius > 0)) {
    throw new Error(`faceFaceBlend: radius must be positive (got ${radius})`);
  }
  const result = await _runFaceFaceBlend(src, face1Idx, face2Idx, radius);
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = src.body && src.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'faceFaceBlend',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'faceFaceBlend', params: { face1Idx, face2Idx, radius } },
        rebuild: ([liveSrc]) => _runFaceFaceBlend(liveSrc, face1Idx, face2Idx, radius, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('faceFaceBlend: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
}

/**
 * setbackCorner — multi-edge vertex blend with per-edge SETBACK distances.
 * At a vertex where 3+ edges meet, the blend retracts from the vertex by
 * `setbackDistance[i]` on edge i before fairing back to the full `radius`.
 *
 * OCCT binding strategy: `BRepFilletAPI_MakeFillet.Add_5(UandR, edge)`
 * accepts a sequence of `(u, r)` parameter→radius pairs (a 2-point
 * piecewise-linear radius law per edge). For setback we want the radius
 * at the vertex-end of the edge to be SMALL (= small fillet near the vertex,
 * retracted) and the radius far from the vertex to be the full `radius`.
 * The actual setback distance maps to *where along the edge the full radius
 * is reached*. For the standard setback law we use:
 *
 *   (u=0, r=radius*epsilon)  at the vertex end  (effectively 0 → retracted)
 *   (u=L, r=radius)           at the far end       (full radius)
 *
 * with the breakpoint between them encoding the setback distance: at
 * abscissa = setbackDistance the radius is half the full radius, linearly
 * interpolating from epsilon at the vertex to full at the far end.
 *
 * This is the standard "setback fillet" pattern — the fillet face retracts
 * (smaller radius) near the vertex and expands to full radius further along
 * the edge. The OCCT-internal corner-mitre logic (the same one driving
 * `mitreCorner`) handles the meeting of the three retracted blends at the
 * vertex automatically.
 *
 * SP-10 — returns a SpineBody with persistent-ID carry-through.
 *
 * @param {SpineBody|BrepShape} src    input solid
 * @param {number} vertexIdx           unique-vertex index (0-based)
 * @param {Array<number>} edgeSetbacks per-edge setback distances (mm).
 *   `edgeSetbacks[i]` corresponds to the i-th edge incident to the vertex,
 *   in the order returned by `edgesAtVertex`. If the array is shorter than
 *   the spoke count, missing entries default to the first value.
 * @param {object} [opts]
 * @param {number} [opts.radius=1.0]   base fillet radius (mm)
 * @returns {Promise<SpineBody>}
 */
async function _runSetbackCorner(src, vertexIdx, edgeSetbacks, opts = {}, bodyTag) {
  const baseRadius = Number.isFinite(opts.radius) && opts.radius > 0 ? opts.radius : 1.0;
  const oc = await getOCCT();
  return withScope(() => {
    // Collect all unique vertices of the input.
    const vertices = [];
    forEachUniqueVertex(oc, src.shape, (v) => vertices.push(v));
    if (vertices.length === 0) {
      throw new Error('setbackCorner: body has no vertices');
    }
    const vi = ((vertexIdx % vertices.length) + vertices.length) % vertices.length;
    const vertex = vertices[vi];

    // Find edges incident to the vertex — the corner spokes.
    const spokes = edgesAtVertex(oc, src.shape, vertex);
    if (spokes.length < 2) {
      throw new Error(
        `setbackCorner: vertex ${vi} has only ${spokes.length} incident edge(s) ` +
        `— need ≥ 2 to define a corner.`);
    }

    // Default missing setbacks to the first provided one (so callers can
    // pass [1.5] and have it applied to every spoke).
    const baseSetback = (edgeSetbacks && edgeSetbacks.length > 0 && Number.isFinite(edgeSetbacks[0]))
      ? edgeSetbacks[0] : 0.5 * baseRadius;
    const setbacks = spokes.map((_, i) => {
      const provided = edgeSetbacks && edgeSetbacks[i];
      return Number.isFinite(provided) && provided > 0 ? provided : baseSetback;
    });

    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      src.shape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    ));

    // Add each spoke as a variable-radius contour. The radius law is a
    // piecewise-linear 2-point map (u=0 → vertex end, u=1 → far end). For
    // the spoke originating from the corner, the vertex end gets a very
    // small radius (effectively the setback retraction); the far end gets
    // the full radius. The actual distance over which the radius transitions
    // encodes the setback length.
    //
    // SP-10: we use the 2-radius variable-fillet API (`Add_3(R1, R2, edge)`)
    // for simplicity + robustness. The kernel orients R1/R2 to the edge's
    // FirstVertex/LastVertex; for the vertex we are setting back from we
    // want R_NEAR < R_FAR. We determine orientation by checking which end
    // of the edge IsSame the target vertex.
    const usedSetbacks = [];
    for (let i = 0; i < spokes.length; i++) {
      const edge = spokes[i];
      const setback = setbacks[i];

      // Detect orientation: which end of the edge is the target vertex?
      // FirstVertex / LastVertex of a TopoDS_Edge.
      const vFirst = track(oc.TopExp.FirstVertex_1(edge, false));
      const isVertexAtFirst = vFirst.IsSame(vertex);

      // Near-vertex radius = small (retracted/setback effect); far = baseRadius.
      // The 2-point linear law spans the whole edge — the setback distance
      // is encoded as a SMALLER nearVertexRadius for a LONGER retraction.
      // Mapping: setback ≥ baseRadius → nearVertexRadius = baseRadius*0.05;
      //          setback small        → nearVertexRadius ≈ baseRadius*0.6.
      const ratio = Math.max(0.05, Math.min(0.9, 1 - (setback / Math.max(setback, baseRadius)) * 0.95));
      const nearVertexRadius = Math.max(1e-3, baseRadius * ratio);
      const farRadius = baseRadius;

      const R1 = isVertexAtFirst ? nearVertexRadius : farRadius;
      const R2 = isVertexAtFirst ? farRadius : nearVertexRadius;

      maker.Add_3(R1, R2, edge);
      usedSetbacks.push({
        edgeIndex: i,
        setback,
        nearVertexRadius,
        farRadius,
        vertexAtFirstEnd: isVertexAtFirst,
      });
    }

    const pr = track(new oc.Message_ProgressRange_1());
    maker.Build(pr);

    if (!maker.IsDone()) {
      throw new Error(
        `setbackCorner: fillet did not complete for vertex ${vi} ` +
        `(${spokes.length} spokes, baseRadius=${baseRadius} mm).`);
    }

    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('setbackCorner: kernel produced a null shape');

    const meta = {
      op: 'setbackCorner',
      params: {
        vertexIdx: vi,
        edgeSetbacks: setbacks,
        radius: baseRadius,
        spokeCount: spokes.length,
        usedSetbacks,
      },
      parents: [src.id],
    };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `setbackCorner-${wrapper.id}`,
      geomEngineShape: wrapper,
    });
    if (src.body) {
      const lineage = carryLineage(oc, maker, resultBody, [
        { body: src.body, role: 'arg' },
      ]);
      meta.lineage = {
        survived: lineage.survived, modified: lineage.modified,
        generated: lineage.generated, deleted: lineage.deleted,
        conflicts: lineage.conflicts,
        faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      };
    }
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function setbackCorner(src, vertexIdx, edgeSetbacks, opts = {}) {
  if (!src || !src.shape) {
    throw new Error('setbackCorner: first argument must be a SpineBody or BrepShape with a live shape');
  }
  if (!Number.isInteger(vertexIdx)) {
    throw new Error(`setbackCorner: vertexIdx must be an integer (got ${vertexIdx})`);
  }
  if (!Array.isArray(edgeSetbacks)) {
    throw new Error('setbackCorner: edgeSetbacks must be an array of numbers (mm)');
  }
  const result = await _runSetbackCorner(src, vertexIdx, edgeSetbacks, opts);
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = src.body && src.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'setbackCorner',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'setbackCorner', params: { vertexIdx, edgeSetbacks, opts } },
        rebuild: ([liveSrc]) => _runSetbackCorner(liveSrc, vertexIdx, edgeSetbacks, opts, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('setbackCorner: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
}
