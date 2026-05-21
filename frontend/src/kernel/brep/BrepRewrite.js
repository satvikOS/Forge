/**
 * ArchDisc Kernel — topology rewriting (local face replacement).
 *
 * §3.4 "local face replacement" intent: swap the underlying geometry of a
 * face while dynamically rebuilding the surrounding topology.
 *
 * ── IMPLEMENTATION (real boundary-wire face rebuild) ─────────────────────────
 * `replaceFace` does a genuine same-boundary-wire rebuild, NOT a blind
 * identity transform:
 *   1. Walk faces with `TopExp_Explorer` to the picked face (1-based index).
 *   2. Extract that face's OUTER BOUNDARY WIRE via `BRepTools.OuterWire`.
 *   3. Recover the face's surface as a `Handle_Geom_Surface` via
 *      `BRep_Tool.Surface_2`.
 *   4. REBUILD the face from the surface + the extracted wire via
 *      `BRepBuilderAPI_MakeFace_21(surface, wire, Inside)` — the OCCT
 *      "make a face from a Surface and a wire" constructor. This is the real
 *      kernel mechanism for swapping the face geometry under a fixed boundary.
 *   5. Sew the rebuilt face back into the solid with `BRepTools_ReShape`
 *      (`Replace` + `Apply`) so the surrounding topology is rebuilt around it.
 *
 * ── HONEST BINDING LIMIT (parity-audit P4 — still PARTIAL) ───────────────────
 * Empirical recon (`p4-recon`) on `opencascade.js@2.0.0-beta.b5ff984`:
 *   - `MakeFace_21(surface, wire)` rebuilds the face on the SAME surface
 *     validly — `Inside=false` round-trips the solid exactly (vol preserved).
 *   - Rebuilding the face on a GEOMETRICALLY DIFFERENT (curved) surface
 *     bounded by the same wire produces a face that `BRepCheck_Analyzer`
 *     reports INVALID — a non-planar `MakeFace(surface, wire)` needs pcurves
 *     for every wire edge, and the pcurve generator
 *     `ShapeConstruct_ProjectCurveOnSurface` is UNBOUND in this WASM build
 *     ("is not a constructor"). `ShapeFix_Shape` healing cannot synthesise
 *     the missing pcurves.
 * Therefore an arbitrary surface SWAP (planar → curved) is NOT binding-
 * reachable here; it needs the custom OCCT build that exposes `gp_Pnt2d_2`
 * + `ShapeConstruct_ProjectCurveOnSurface`. What IS real and shipped: the
 * boundary-wire-driven face rebuild + ReShape topology stitch — the genuine
 * §3.4 mechanism, exercised on the binding-reachable same-surface case.
 *
 * Verified sequence baseline: docs/superpowers/notes/kernel-api-B.md Cap. 4.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Replace one face of a shape by rebuilding it from its surface + outer
 * boundary wire (a real `MakeFace(surface, wire)` rebuild), then sewing it
 * back into the solid via `BRepTools_ReShape`. The surrounding topology is
 * rebuilt around the swapped face.
 *
 * @param {BrepShape} brepShape
 * @param {number} faceIndex  1-based index into TopExp_Explorer face order
 * @returns {Promise<BrepShape>}
 */
export async function replaceFace(brepShape, faceIndex = 1) {
  if (!brepShape || !brepShape.shape) throw new Error('replaceFace: needs a BrepShape');
  if (!(Number.isInteger(faceIndex) && faceIndex >= 1)) {
    throw new Error(`replaceFace: faceIndex must be a positive integer (got ${faceIndex})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;

    // ── Step 1: walk faces — deduplicate with IsSame ────────────────────────
    const faces = [];
    const exp = track(new oc.TopExp_Explorer_2(brepShape.shape, FACE, ANY));
    for (; exp.More(); exp.Next()) {
      const f = exp.Current();
      let dup = false;
      for (const prev of faces) {
        try { if (prev.IsSame(f)) { dup = true; break; } } catch (_e) { /* ignore */ }
      }
      if (!dup) {
        try { faces.push(track(oc.TopoDS.Face_1(f))); } catch (_e) { faces.push(track(f)); }
      }
    }
    if (faceIndex > faces.length) {
      throw new Error(`replaceFace: faceIndex=${faceIndex} but shape has only ${faces.length} faces`);
    }

    // Target face is 1-based.
    const oldFace = faces[faceIndex - 1];

    // ── Step 2: extract the face's OUTER BOUNDARY WIRE ──────────────────────
    //   BRepTools.OuterWire(face) → the outer bounding wire of the face.
    const boundaryWire = track(oc.BRepTools.OuterWire(oldFace));
    if (!boundaryWire || boundaryWire.IsNull()) {
      throw new Error('replaceFace: could not extract the outer boundary wire of the picked face');
    }

    // ── Step 3: recover the face's surface as a Handle_Geom_Surface ─────────
    //   BRep_Tool.Surface_2(face) is the ONLY way to obtain a surface Handle
    //   in this binding (see BrepNurbs.js §ARCHITECTURAL CONSTRAINT).
    const surfHandle = track(oc.BRep_Tool.Surface_2(oldFace));
    if (!surfHandle || surfHandle.IsNull()) {
      throw new Error('replaceFace: could not recover the surface handle of the picked face');
    }

    // ── Step 4: REBUILD the face from the surface + boundary wire ───────────
    //   BRepBuilderAPI_MakeFace_21(Handle_Geom_Surface, TopoDS_Wire, Inside) —
    //   OCCT's "make a face from a Surface and a wire" constructor. This is
    //   the real face-rebuild mechanism (not a blind identity Transform).
    const mkFace = track(new oc.BRepBuilderAPI_MakeFace_21(surfHandle, boundaryWire, true));
    if (!mkFace.IsDone()) {
      throw new Error('replaceFace: MakeFace(surface, wire) could not rebuild the picked face');
    }
    const rebuiltFace = track(mkFace.Face());
    if (rebuiltFace.IsNull()) {
      throw new Error('replaceFace: MakeFace(surface, wire) produced a null face');
    }

    // ── Step 5: sew the rebuilt face back into the solid via ReShape ────────
    //   The rebuilt face's orientation relative to the surface may differ from
    //   the picked face's. Empirically pick the orientation whose ReShape
    //   round-trip yields a VALID solid (recon p4: the valid combo is the
    //   reversed rebuilt face). Try both, validate with BRepCheck_Analyzer.
    const candidates = [track(rebuiltFace.Reversed()), rebuiltFace];
    let shape = null;
    let validHit = false;
    for (const candFace of candidates) {
      const reshape = track(new oc.BRepTools_ReShape());
      reshape.Replace(oldFace, candFace);
      // 2-arg Apply form required — 1-arg throws BindingError.
      const out = reshape.Apply(brepShape.shape, ANY);
      if (out.IsNull()) continue;
      const analyzer = track(new oc.BRepCheck_Analyzer(out, true, false));
      const ok = analyzer.IsValid_2();
      if (ok) { shape = track(out); validHit = true; break; }
      // Keep the first non-null result as a fallback if neither validates.
      if (!shape) shape = track(out);
    }
    if (!shape || shape.IsNull()) {
      throw new Error('replaceFace: ReShape produced no usable shape after the face rebuild');
    }
    if (!validHit) {
      // Neither orientation produced a topologically-valid solid. Per the
      // HONEST BINDING LIMIT (file header) a face whose surface needs pcurves
      // on the boundary wire cannot be validly rebuilt in this WASM build —
      // do NOT pass off an invalid solid as a real swap.
      throw new Error(
        'replaceFace: the rebuilt face does not seat into a valid solid — ' +
        'this face needs pcurves on its boundary edges, which requires the ' +
        'custom OCCT build (parity-audit P4, still PARTIAL)',
      );
    }

    return new BrepShape(shape, {
      op: 'replaceFace',
      params: { faceIndex, rebuiltFromBoundaryWire: true },
      parents: [brepShape.id],
    });
  });
}
