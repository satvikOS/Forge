/**
 * ArchDisc Kernel — geometry measurement for B-rep shapes. Drives the
 * numeric assertions in e2e specs. All values in mm / mm² / mm³.
 *
 * SP-14b — first-fix-pass hardening (findings #6 + #10):
 *   - Compound aggregation: `volume()` now iterates a `TopoDS_Compound` via
 *     `TopExp_Explorer(TopAbs_SOLID)` and sums each contained solid's mass.
 *     Pre-SP-14b a 200-sphere compound silently read `volume === 0` because
 *     OCCT's `BRepGProp.VolumeProperties_1` on a raw `TopoDS_Compound` does
 *     not walk the children when the top-level shape isn't a single solid.
 *     We additionally include any `COMPSOLID`s and fall back to the legacy
 *     full-shape `Mass()` when the explorer finds zero solids (e.g., a
 *     shell-only compound).
 *   - "Mass()==0 but shape is non-empty" diagnostic: when the legacy
 *     full-shape path reports 0 but the shape has a finite bbox + face
 *     count > 0, attach `body.diagnostics.volume = { warning: ... }` on the
 *     input SpineBody so calling code can escalate. Returning the same
 *     scalar preserves backwards compatibility — callers that read the
 *     plain number behave as before; callers that inspect diagnostics
 *     learn the result is suspect.
 *
 * Why split solids vs shells: `BRepGProp.VolumeProperties_1.Mass()` is
 * defined for solids only. For a `TopoDS_Compound` that holds N solids
 * the kernel does NOT recurse — it integrates over the compound's
 * top-level `TopAbs_FACE`s, double-counting shared faces and zeroing
 * disjoint clusters. The supported pattern (per OCCT refman + the
 * existing precedent in BrepPartition.js / BrepSection.js) is to
 * explore the compound for `TopAbs_SOLID` and sum per-solid Mass()
 * — which is exactly what we now do here for compounds.
 */

import { getOCCT } from './kernelLoader.js';
import { withScope, track } from './BrepShape.js';

/**
 * Solid volume (mm³).
 *
 * SP-14b — compound-aggregating + diagnostic-attaching.
 *
 *   1. If the shape is a `TopoDS_Compound` / `_CompSolid`, walk every
 *      contained `TopoDS_Solid` via `TopExp_Explorer` and sum per-solid
 *      Mass(). This fixes finding #6 (200-sphere compound reading 0).
 *   2. Otherwise (single solid, shell, …) call `BRepGProp.VolumeProperties_1`
 *      once and read Mass() — the legacy path.
 *   3. If the path's result is 0 BUT the shape carries finite-bbox geometry
 *      (face count > 0, bbox non-empty), attach
 *      `body.diagnostics.volume = { warning: 'mass-returned-zero-but-shape-nonempty', ... }`
 *      on the input SpineBody. Returning the same scalar (0) preserves
 *      backwards compatibility — every existing caller that reads the number
 *      behaves identically; callers that inspect `body.diagnostics.volume`
 *      learn the result is suspect (finding #10).
 *
 * The return type is unchanged — a plain `number` in mm³ — so every existing
 * downstream consumer is unaffected. The diagnostic is purely additive.
 *
 * @param {SpineBody|BrepShape} brepShape  the body to measure
 * @returns {Promise<number>} the mass-properties volume (sum of per-solid for
 *   compounds), or 0 with `body.diagnostics.volume.warning` attached when the
 *   shape is non-empty but Mass() can't compute.
 */
export async function volume(brepShape) {
  const oc = await getOCCT();
  const computed = await withScope(() => {
    const SE = oc.TopAbs_ShapeEnum;
    const shape = brepShape.shape;
    const shapeType = shape.ShapeType();

    // ─── Single-solid fast path ───────────────────────────────────────────
    // For a `TopoDS_Solid` (the most common case), BRepGProp Mass() is
    // accurate without any compound-walk. We try it first.
    if (shapeType === SE.TopAbs_SOLID) {
      const props = track(new oc.GProp_GProps_1());
      oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
      return { mass: props.Mass(), path: 'mass-properties-direct', solidCount: 1 };
    }

    // ─── Compound aggregation path (SP-14b finding #6) ────────────────────
    // For ANY non-solid top-level shape (`TopoDS_Compound`, `_CompSolid`,
    // anything else the explorer can walk) we walk for `TopAbs_SOLID` and
    // sum per-solid Mass(). `BRepGProp.VolumeProperties_1` on a raw
    // compound silently returns 0 — it integrates over top-level faces
    // and disjoint-solid compounds have no top-level faces. The
    // documented pattern is to enumerate `TopAbs_SOLID` and sum Mass()
    // on each — what BrepPartition / BrepSection do internally.
    //
    // Per the established BrepPartition / BrepSection pattern: the
    // explorer + the `TopoDS.Solid_1(...)` cast MUST not be `track()`-ed
    // (tracking would dispose the sub-shape and the per-solid Mass()
    // call would read garbage). The explorer + casts live for the
    // duration of this aggregation loop only.
    const ex = new oc.TopExp_Explorer_2(
      shape, SE.TopAbs_SOLID, SE.TopAbs_SHAPE);
    let totalMass = 0;
    let solidCount = 0;
    const seen = [];
    for (; ex.More(); ex.Next()) {
      // `ex.Current()` returns a TopoDS_Shape — cast to TopoDS_Solid
      // before VolumeProperties_1 (the integrator expects a concrete
      // Solid type, not the parent shape interface). The cast is the
      // BrepPartition / BrepSection contract.
      const sd = oc.TopoDS.Solid_1(ex.Current());
      // Dedup by IsSame — shared solids inside nested compounds would
      // otherwise be double-counted.
      if (seen.some((s) => s.IsSame(sd))) continue;
      seen.push(sd);
      const props = track(new oc.GProp_GProps_1());
      oc.BRepGProp.VolumeProperties_1(sd, props, false, false, false);
      totalMass += props.Mass();
      solidCount += 1;
    }
    try { ex.delete(); } catch { /* already gone */ }

    if (solidCount > 0) {
      return { mass: totalMass, path: 'compound-aggregated', solidCount };
    }

    // ─── Legacy fallback ──────────────────────────────────────────────────
    // No solids found at all (e.g., a sheet-only compound, a wire, a single
    // face). Fall back to the legacy Mass() integrator — it returns 0 for
    // sheets/wires which is geometrically correct.
    const props = track(new oc.GProp_GProps_1());
    oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
    return { mass: props.Mass(), path: 'mass-properties-fallback', solidCount: 0 };
  });

  // ─── SP-14b finding #10 — "Mass() returned 0 but shape is non-empty" ────
  // When the path above produces 0, sanity-probe: a real zero-volume body
  // has zero faces too (or an empty bbox). If the shape clearly carries
  // geometry (face count > 0 AND a finite, non-degenerate bbox), the 0
  // is suspect — flag it on diagnostics so calling code can escalate.
  // We don't override the returned number (callers that read the scalar
  // continue to behave identically); we only attach the warning on the
  // input SpineBody's `.body.diagnostics.volume`. A plain BrepShape (no
  // `.body`) gets the diagnostic stashed on its `.meta` instead.
  if (computed.mass === 0) {
    try {
      const faces = await faceCount(brepShape);
      // bbox probe — best-effort. On some shape types (e.g. a compound of
      // translated solids hit by the pre-existing `BRepBuilderAPI_Transform`
      // copy=true → bbox-NaN pathology), `boundingBox()` returns
      // `{min:[null,null,null], max:[...]}` because the WASM bindings report
      // a never-set Bnd_Box as null components. We tolerate that case — the
      // diagnostic still fires on faceCount > 0 alone, because a shape with
      // ANY face cannot legitimately have Mass=0 (a closed solid integrates
      // to its volume; a sheet's surface integrator returns area not 0).
      let bbox = null;
      let bboxSpan = null;
      let bboxFinite = false;
      try {
        bbox = await boundingBox(brepShape);
        const minOk = bbox.min.every((v) => Number.isFinite(v));
        const maxOk = bbox.max.every((v) => Number.isFinite(v));
        if (minOk && maxOk) {
          bboxSpan = Math.max(
            bbox.max[0] - bbox.min[0],
            bbox.max[1] - bbox.min[1],
            bbox.max[2] - bbox.min[2],
          );
          bboxFinite = bboxSpan > 0;
        }
      } catch (_e) { /* bbox probe failed — fire diagnostic on faces alone */ }
      // Fire the diagnostic when ANY of:
      //   - faces > 0 (any shape carrying faces should have positive volume
      //     OR be classified as a sheet/wire); OR
      //   - bbox is finite and non-degenerate (shape has spatial extent
      //     even if face-count probe failed).
      if (faces > 0 || bboxFinite) {
        const diag = {
          warning: 'mass-returned-zero-but-shape-nonempty',
          path: computed.path,
          faceCount: faces,
          bbox,
          bboxSpan,
          bboxFinite,
          note: 'OCCT BRepGProp.VolumeProperties_1.Mass() returned 0 on a shape ' +
                'with positive face count and/or finite bbox. The result is ' +
                'likely a non-watertight shell, an inverted-orientation solid, ' +
                'a translate-derived shape hit by the BRepBuilderAPI_Transform ' +
                'copy=true Mass-bug, or a compound whose sub-shapes the ' +
                'aggregator could not walk. Callers should escalate (re-run ' +
                'via partition, tessellate + sum signed triangle volumes, or ' +
                'surface to the user).',
        };
        // Prefer SpineBody.body.diagnostics (the established spine
        // diagnostic surface — see BrepNurbsAutoTrim, BrepTransform). Fall
        // back to BrepShape.meta.diagnostics for raw BrepShape inputs.
        if (brepShape.body && brepShape.body.diagnostics) {
          brepShape.body.diagnostics.volume = diag;
        } else if (brepShape.meta) {
          brepShape.meta.diagnostics = brepShape.meta.diagnostics || {};
          brepShape.meta.diagnostics.volume = diag;
        }
      }
    } catch (_e) {
      // Diagnostic attachment is best-effort. Never crash the measure call
      // because the bbox / faceCount probe failed — the user gets back 0
      // either way, and the spec's verdict-band classifier treats 0-on-
      // non-empty as SILENT-BAD-OUTPUT regardless.
    }
  }

  return computed.mass;
}

/** Total surface area (mm²). */
export async function area(brepShape) {
  const oc = await getOCCT();
  return withScope(() => {
    const props = track(new oc.GProp_GProps_1());
    oc.BRepGProp.SurfaceProperties_1(brepShape.shape, props, false, false);
    return props.Mass();
  });
}

/**
 * Count UNIQUE sub-shapes of a given TopAbs kind. A raw TopExp_Explorer
 * DOUBLE-COUNTS shared sub-shapes: a box edge is visited once per adjacent
 * face, so TopAbs_EDGE yields 24 hits for 12 real edges (empirically
 * verified — see docs/superpowers/notes/occt-api-A0.md, Item 3). We
 * deduplicate with TopoDS_Shape.IsSame(). (A1+ may switch to
 * TopExp.MapShapes for O(n) counting on large shapes; IsSame dedup is
 * sufficient at A0 scope — box only.)
 */
async function countSubShapes(brepShape, kind) {
  const oc = await getOCCT();
  return withScope(() => {
    const ex = track(new oc.TopExp_Explorer_2(
      brepShape.shape, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
    const unique = [];
    for (; ex.More(); ex.Next()) {
      const cur = track(ex.Current());
      if (!unique.some((s) => s.IsSame(cur))) unique.push(cur);
    }
    return unique.length;
  });
}

/** Number of faces. */
export async function faceCount(brepShape) {
  const oc = await getOCCT();
  return countSubShapes(brepShape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
}

/** Number of edges. */
export async function edgeCount(brepShape) {
  const oc = await getOCCT();
  return countSubShapes(brepShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
}

/** Axis-aligned bounding box: {min:[x,y,z], max:[x,y,z]} in mm. */
export async function boundingBox(brepShape) {
  const oc = await getOCCT();
  return withScope(() => {
    const bbox = track(new oc.Bnd_Box_1());
    oc.BRepBndLib.Add(brepShape.shape, bbox, false);
    const min = track(bbox.CornerMin());
    const max = track(bbox.CornerMax());
    return {
      min: [min.X(), min.Y(), min.Z()],
      max: [max.X(), max.Y(), max.Z()],
    };
  });
}
