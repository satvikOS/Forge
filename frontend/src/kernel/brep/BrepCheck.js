/**
 * ArchDisc Kernel — evaluation & checking (analytical, no new geometry):
 * self-intersection detection and clash / interference detection.
 * Verified kernel sequences: docs/superpowers/notes/kernel-api-A3.md.
 *
 * Note: BOPAlgo_CheckerSI is unbound in this build.
 * checkSelfIntersection uses BRepCheck_Analyzer validity + pairwise
 * solid-overlap, the verified reachable approach.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import { tessellatePerFace } from './BrepTessellate.js';
import { detectSelfIntersection } from '../../foundation/SelfIntersection.js';

/** Volume of a B-rep shape (mm³). Helper — caller is inside a withScope. */
function shapeVolume(oc, shape) {
  const props = track(new oc.GProp_GProps_1());
  oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
  return props.Mass();
}

/**
 * Collect all SOLID sub-shapes from a shape via TopExp_Explorer_2.
 * Returns an array of TopoDS_Shape copies (track()ed) — will be freed
 * when the surrounding withScope exits.
 * Must be called from inside a withScope.
 */
function collectSolids(oc, shape) {
  const solidEnum = oc.TopAbs_ShapeEnum.TopAbs_SOLID;
  const shapeEnum = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
  const exp = track(new oc.TopExp_Explorer_2(shape, solidEnum, shapeEnum));
  const solids = [];
  while (exp.More()) {
    const s = exp.Current();
    // Copy to get an independent handle that survives explorer moves
    try {
      const copy = track(new oc.BRepBuilderAPI_Copy_1(s, true, false));
      solids.push(track(copy.Shape()));
    } catch (_e) {
      // fallback: alias (safe for read-only ops like volume measurement)
      solids.push(s);
    }
    exp.Next();
  }
  return solids;
}

/**
 * Compute Boolean Common volume between two shapes (mm³).
 * Must be called from inside a withScope.
 */
function commonVolume(oc, sA, sB) {
  let vol = 0;
  const pr1 = track(new oc.Message_ProgressRange_1());
  const algo = track(new oc.BRepAlgoAPI_Common_3(sA, sB, pr1));
  const prB = track(new oc.Message_ProgressRange_1());
  algo.Build(prB);
  if (algo.IsDone()) {
    const cs = algo.Shape();
    if (cs && !cs.IsNull()) {
      vol = Math.abs(shapeVolume(oc, cs));
    }
  }
  return vol;
}

/**
 * Detect self-intersection in a shape: reports the shape as self-intersecting
 * if it fails an intrinsic validity check OR contains two solids that overlap.
 *
 * Limitation: this uses BRepCheck_Analyzer for intrinsic validity and pairwise
 * solid-overlap via BRepAlgoAPI_Common. It does NOT detect face-level
 * self-intersection within a single solid because BOPAlgo_CheckerSI is
 * unbound in this opencascade.js build.
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @returns {Promise<{selfIntersects: boolean, count: number, valid: boolean}>}
 */
export async function checkSelfIntersection(brepShape) {
  if (!brepShape || !brepShape.shape) throw new Error('checkSelfIntersection: needs a BrepShape');
  const oc = await getOCCT();
  return withScope(() => {
    // Step 1: intrinsic validity via BRepCheck_Analyzer(shape, isGeomCtrled, isParallelMode)
    // Per kernel-api-A3.md Item 6: 3-arg constructor (no _N suffix), IsValid_2() = whole shape
    const analyzer = track(new oc.BRepCheck_Analyzer(brepShape.shape, true, false));
    const valid = analyzer.IsValid_2();

    // Step 2: collect all SOLID sub-shapes via TopExp_Explorer_2
    // Per kernel-api-A3.md Item 7: _2(shape, solidEnum, shapeEnum), Current() usable directly
    const solids = collectSolids(oc, brepShape.shape);

    // Step 3: for every pair (i < j), compute Boolean Common volume
    // Per kernel-api-A3.md Item 8: BRepAlgoAPI_Common_3 + pairwise volume > epsilon → overlap
    let count = 0;
    const epsilon = 1e-6;
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const vol = commonVolume(oc, solids[i], solids[j]);
        if (vol > epsilon) {
          count++;
        }
      }
    }

    // Step 4: selfIntersects = !valid || intersectingPairCount > 0
    const selfIntersects = !valid || count > 0;

    return { selfIntersects, count, valid };
  });
}

/**
 * Detect FACE-LEVEL self-intersection in a single body — faces of ONE solid
 * geometrically crossing EACH OTHER (self-intersecting fillet, degenerate
 * sweep, over-offset enclosure, badly-warped spline patch). This is the
 * §3.6 "scanning highly warped spline surfaces for crossings" capability.
 *
 * The body is tessellated PER FACE (BrepTessellate.tessellatePerFace) so every
 * triangle carries its B-rep face id and the set of edge-adjacent face pairs.
 * The pure-JS `detectSelfIntersection` (foundation/SelfIntersection.js) then
 * runs a genuine Möller triangle-triangle intersection test, BVH-accelerated,
 * between triangles whose faces are NON-ADJACENT (triangles on the same face
 * or on faces sharing an edge touch legitimately and are skipped).
 *
 * Honest caveat — this is a TESSELLATION-RESOLUTION detector: it works on the
 * mesh at the given `deflection`; a finer deflection finds finer crossings. It
 * is an exact triangle-triangle detector on the mesh it is given, NOT an
 * exact-analytic B-rep face/face intersector. It complements (does not
 * replace) `checkSelfIntersection`, which catches intrinsic invalidity and
 * inter-solid overlap.
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {{deflection?:number, maxPairs?:number}} [opts]
 *        deflection — tessellation chord deviation in mm (default 0.1; smaller
 *        = finer detection). maxPairs — safety cap on tested triangle pairs.
 * @returns {Promise<{
 *   intersecting:boolean,
 *   pairCount:number,
 *   facePairs:Array<[number,number]>,
 *   segments:Array<[number[],number[]]>,
 *   stats:object,
 *   highlight:({positions:Float32Array,normals:Float32Array,indices:Uint32Array}|null)
 * }>}  `highlight` is a renderable mesh of the intersecting triangles (mm),
 *      or null when the body is clean.
 */
export async function selfIntersect(brepShape, opts = {}) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('selfIntersect: needs a BrepShape with a live shape');
  }
  const deflection = (opts.deflection && opts.deflection > 0) ? opts.deflection : 0.1;

  // Per-face tessellation — positions + per-triangle face id + edge adjacency.
  const tess = await tessellatePerFace(brepShape, deflection);

  // Pure-JS Möller detector (BVH-accelerated). Pass the kernel's exact face
  // adjacency so legitimate edge contacts between faces are not flagged.
  const det = detectSelfIntersection(
    { positions: tess.positions, indices: tess.indices, faceIds: tess.faceIds },
    { faceAdjacency: tess.faceAdjacency, maxPairs: opts.maxPairs },
  );

  // Build a renderable highlight mesh from the intersecting triangles. Each
  // crossing triangle pair contributes its two triangles — a caller renders
  // this as a bright overlay so the user SEES the exact crossing zone.
  let highlight = null;
  if (det.pairs.length) {
    const triSet = new Set();
    for (const [t, u] of det.pairs) { triSet.add(t); triSet.add(u); }
    const tris = [...triSet];
    const positions = new Float32Array(tris.length * 9);
    const indices = new Uint32Array(tris.length * 3);
    let vp = 0;
    for (let k = 0; k < tris.length; k++) {
      const t = tris[k];
      for (let c = 0; c < 3; c++) {
        const vi = tess.indices[t * 3 + c] * 3;
        positions[vp++] = tess.positions[vi];
        positions[vp++] = tess.positions[vi + 1];
        positions[vp++] = tess.positions[vi + 2];
      }
      indices[k * 3]     = k * 3;
      indices[k * 3 + 1] = k * 3 + 1;
      indices[k * 3 + 2] = k * 3 + 2;
    }
    // Per-triangle face normals.
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
      const ux = positions[ib] - positions[ia];
      const uy = positions[ib + 1] - positions[ia + 1];
      const uz = positions[ib + 2] - positions[ia + 2];
      const wx = positions[ic] - positions[ia];
      const wy = positions[ic + 1] - positions[ia + 1];
      const wz = positions[ic + 2] - positions[ia + 2];
      let nx = uy * wz - uz * wy;
      let ny = uz * wx - ux * wz;
      let nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (const idx of [ia, ib, ic]) {
        normals[idx] = nx; normals[idx + 1] = ny; normals[idx + 2] = nz;
      }
    }
    highlight = { positions, normals, indices };
  }

  return {
    intersecting: det.intersecting,
    pairCount: det.pairs.length,
    facePairs: det.facePairs,
    segments: det.segments,
    stats: { ...det.stats, deflection, faceCount: tess.faceCount },
    highlight,
  };
}

/**
 * Detect a clash between two solids. Reports whether they interfere, the
 * overlap (interference) volume in mm³, the minimum clearance distance in mm
 * (0 when they touch or overlap), the number of disjoint interfering zones,
 * and — when `withZone` is set — the interfering region itself as a BrepShape
 * so the caller can render the exact clash zone.
 *
 * `interferenceZone` is the Boolean Common (BRepAlgoAPI_Common) of the two
 * solids — per the OCCT refman this is precisely the region shared by both
 * inputs, i.e. the geometry that is double-occupied. `zoneCount` counts the
 * SOLID components of that region (multiple disjoint interpenetrations).
 *
 * @param {import('./BrepShape.js').BrepShape} a
 * @param {import('./BrepShape.js').BrepShape} b
 * @param {{withZone?:boolean}} [opts]  withZone (default true) also returns
 *        the clash region as a BrepShape (null when there is no clash).
 * @returns {Promise<{clash:boolean, interferenceVolume:number,
 *          minDistance:number, zoneCount:number,
 *          interferenceZone:(import('./BrepShape.js').BrepShape|null)}>}
 */
export async function checkClash(a, b, opts = {}) {
  if (!a || !a.shape || !b || !b.shape) {
    throw new Error('checkClash: both operands must be BrepShapes with live shapes');
  }
  const oc = await getOCCT();
  const withZone = opts.withZone !== false;

  // Numeric verdict — computed inside a scope that frees every transient.
  const verdict = await withScope(() => {
    // interferenceVolume + zoneCount via BRepAlgoAPI_Common_3
    // Per kernel-api-A3.md Item 4: _3(shapeA, shapeB, pr) + Build + Shape + VolumeProperties
    let interferenceVolume = 0;
    let zoneCount = 0;
    const pr1 = track(new oc.Message_ProgressRange_1());
    const algo = track(new oc.BRepAlgoAPI_Common_3(a.shape, b.shape, pr1));
    const prBuild = track(new oc.Message_ProgressRange_1());
    algo.Build(prBuild);
    if (algo.IsDone()) {
      const commonShape = algo.Shape();
      if (commonShape && !commonShape.IsNull()) {
        interferenceVolume = Math.abs(shapeVolume(oc, commonShape));
        // Count disjoint interfering zones = SOLID sub-shapes of the common.
        const SOLID = oc.TopAbs_ShapeEnum.TopAbs_SOLID;
        const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
        const exp = track(new oc.TopExp_Explorer_2(commonShape, SOLID, ANY));
        for (; exp.More(); exp.Next()) zoneCount++;
      }
    }

    // minDistance via BRepExtrema_DistShapeShape_1
    // Per kernel-api-A3.md Item 5: no-arg _1() + LoadS1/LoadS2 + Perform(pr) + Value()
    let minDistance = 0;
    const distAlgo = track(new oc.BRepExtrema_DistShapeShape_1());
    distAlgo.LoadS1(a.shape);
    distAlgo.LoadS2(b.shape);
    const prDist = track(new oc.Message_ProgressRange_1());
    distAlgo.Perform(prDist);
    if (distAlgo.IsDone()) {
      minDistance = distAlgo.Value();
    }

    const clash = interferenceVolume > 1e-6;
    return { clash, interferenceVolume, minDistance, zoneCount };
  });

  // Clash region as a renderable BrepShape — produced in its own scope so the
  // surviving TopoDS_Shape (reachable from the returned BrepShape) is kept.
  let interferenceZone = null;
  if (withZone && verdict.clash) {
    try {
      interferenceZone = await withScope(() => {
        const pr = track(new oc.Message_ProgressRange_1());
        const common = track(new oc.BRepAlgoAPI_Common_3(a.shape, b.shape, pr));
        const prB = track(new oc.Message_ProgressRange_1());
        common.Build(prB);
        if (!common.IsDone()) return null;
        const cs = common.Shape();
        if (!cs || cs.IsNull()) return null;
        // Independent copy so the BrepShape owns its lifetime.
        // BRepBuilderAPI_Copy_2(shape, copyGeom, copyMesh) — the 3-arg
        // constructing overload (empirically verified in this build; the
        // _1 overload is no-arg only).
        const copy = track(new oc.BRepBuilderAPI_Copy_2(cs, true, false));
        const owned = copy.Shape();
        if (!owned || owned.IsNull()) return null;
        return new BrepShape(owned, {
          op: 'clashZone', parents: [a.id, b.id],
        });
      });
    } catch {
      interferenceZone = null; // zone extraction is best-effort
    }
  }

  return { ...verdict, interferenceZone };
}
