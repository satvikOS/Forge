// forge/native/brep/NativeShapeHealBridge.hpp
//
// R4 (bridge) — the OCCT<->native RICH-REPAIR bridge that lets the RICH
// ShapeFix_Shape general-repair call sites go native. It is the TopoDS-in /
// TopoDS-out companion to NativeShapeHeal.hpp's LIGHT-heal subset: where
// NativeShapeHeal.cpp natively covers the small ShapeAnalysis_*/ShapeFix_* slice
// our sources call directly (valueOfUV / projectPointOnCurve / freeBounds /
// solidFromShell / finalizeShape), THIS file covers the one residual it could not
// — the RICH general repair (ShapeFix.cpp:295 forge::shapefix::repair,
// Healing.cpp:488 autoRepairSelfIntersection) — by routing an arbitrary OCCT shape
// through the already-A/B-certified native healer forge::native::brep::healBRep
// (Heal.cpp) and materialising the result back to an OCCT shape.
//
// THE PIPE (all three stages already exist and are gate-proven; this file only
// COMPOSES them into one TopoDS->TopoDS function — it adds NO new geometry math):
//   (1) forge::importOcctSolid(shape)      OCCT analytic shape -> native brep::Solid
//                                          (OcctImport.cpp; Plane/Cyl/Cone/Sphere/
//                                           Torus/BSpline/Bezier/LinearExtrusion).
//   (2) forge::native::brep::healBRep(...)  the native ShapeFix-class healer: weld /
//                                          gap-fill / short-edge collapse / sliver
//                                          removal / orientation / non-manifold /
//                                          self-intersection (Heal.cpp).
//   (3) forge::occtFromNativeSolid(solid)   native brep::Solid -> OCCT TopoDS_Shape
//                                          (NativeOcctBridge.cpp; planar bodies
//                                           exact 1:1, curved bodies via the
//                                           analytic reconstructors / faceted
//                                           fallback).
//
// It is the SAME import+clone+heal spine tryNativeRepair (ShapeFix.cpp:147) already
// uses for a REGISTRY handle, but (a) it takes/returns a bare TopoDS_Shape (so the
// pure-TopoDS rich sites that have no ShapeHandle can use it), and (b) it EXPORTS
// the healed native solid back to OCCT (stage 3) — the step tryNativeRepair omits
// because it keeps a NativeSolid handle. Zero TKShHealing symbols are linked by this
// TU; every toolkit it (transitively) uses survives the drop.
//
// ============================ HONESTY (Bible §0/§9) — READ ================
// This bridge is a REAL composition, never a stub. Its coverage is bounded by the
// coverage of its three stages, and it DEFERS (returns the input shape UNCHANGED,
// with the reason recorded) rather than fabricate a result whenever a stage cannot
// faithfully proceed. The honest limits (each is why TKShHealing is NOT yet fully
// droppable at the rich sites — see the wiring plan in the .cpp):
//
//   * IMPORT (stage 1) requires the shape to import as a CLOSED 2-MANIFOLD analytic
//     solid. importOcctSolid runs a 2-manifold pre-check (OcctImport.cpp:1428/1485)
//     and returns ok=false for an OPEN shell, a shape with free edges / gaps, a
//     duplicated directed edge, or a non-oppositely-mated edge — i.e. EXACTLY the
//     broken inputs a rich repair is invoked to fix. On such inputs this bridge
//     DEFERS. Closing a genuinely-open shell needs a LENIENT face-soup importer (no
//     2-manifold gate) that hands healBRep the raw fragment set — a documented
//     follow-up (see .cpp wiring plan §B), NOT authored here.
//
//   * IMPORT also defers (importOcctSolid, honest, named reason) on
//     SurfaceOfRevolution (no exact uniform-angle NURBS), OffsetSurface (toleranced
//     fit), and GeomAbs_OtherSurface. NOTE: NURBS/BSpline/Bezier AND Torus DO import
//     (contra the "NURBS/torus still defer" guess) — they are first-class; the real
//     import residuals are Revolution / Offset / Other, plus the 2-manifold gate.
//
//   * EXPORT (stage 3) FACETS curved geometry WHEN heal actually changed the shape.
//     healBRep's rebuild (Heal.cpp:537) mints fresh BARE polygonal faces (it drops
//     the analytic surface pointer), so occtFromNativeSolid's analytic reconstructors
//     (which key off face->surface) DECLINE and the body exports through the FACETED
//     fallback — a cylinder/sphere/torus/NURBS returns as a triangulated polyhedron.
//     Therefore this bridge is HIGH-FIDELITY (exact 1:1) only for an ALL-PLANAR,
//     hole-free body; for a curved or holed body a *changed* heal returns a faceted
//     approximation. To keep the drop lossless the heal rebuild must carry the
//     surface pointer through (follow-up §A). Because of this, when heal applies ZERO
//     structural fixes this bridge returns the ORIGINAL OCCT shape UNTOUCHED (never
//     facets a clean shape); it only emits the native-rebuilt shape when it truly
//     repaired something.
//
// Compiled ONLY under FORGE_NATIVE_BREP (it depends on importOcctSolid / healBRep /
// occtFromNativeSolid, all FORGE_NATIVE_BREP-only). A pure-OCCT build never sees it;
// the wiring plan keeps the OCCT ShapeFix_Shape fallback under the same gate so a red
// corpus gate reverts instantly. C++20, no new deps.

#ifndef FORGE_NATIVE_BREP_NATIVESHAPEHEALBRIDGE_HPP
#define FORGE_NATIVE_BREP_NATIVESHAPEHEALBRIDGE_HPP

#ifdef FORGE_NATIVE_BREP

#include <cstddef>
#include <string>

#include <TopoDS_Shape.hxx>

namespace forge {
namespace occtheal {

// Honest telemetry of one fixShapeGeneral() call. The rich ShapeFix_Shape sites read
// DONE/FAIL status bits; this report lets the integrator synthesise those bits from
// what the native healer ACTUALLY did (and surface the honest capability gaps).
struct GeneralFixReport {
    bool imported = false;   // stage 1: importOcctSolid succeeded (closed 2-manifold)
    bool healed   = false;   // stage 2: healBRep ran ok and produced a face set
    bool exported = false;   // stage 3: occtFromNativeSolid produced a non-null shape
    bool changed  = false;   // healBRep applied >= 1 structural fix (else input is returned)
    bool faceted  = false;   // the EXPORTED shape faceted curved/holed geometry (fidelity loss)
    // Cause when the returned shape is the INPUT unchanged (import/heal/export defer),
    // or the honest limitation note when it changed but faceted. Empty on an exact pass.
    std::string reason;

    // Counts of fixes actually applied (mirrored from HealReport for the caller's log).
    std::size_t verticesWelded          = 0;
    std::size_t gapsClosed              = 0;
    std::size_t shortEdgesCollapsed     = 0;
    std::size_t sliverFacesRemoved      = 0;
    std::size_t edgePairsMerged         = 0;
    std::size_t facesFlipped            = 0;
    std::size_t selfIntersectingRemoved = 0;
    std::size_t duplicateFacesRemoved   = 0;

    // Residuals healBRep left UNFIXED (honest, never papered over).
    std::size_t unfixedFreeEdges        = 0;
    std::size_t unfixedNonManifoldEdges = 0;
    bool anyUnfixed() const {
        return unfixedFreeEdges != 0 || unfixedNonManifoldEdges != 0;
    }
};

// RICH general shape repair, native (the ShapeFix_Shape::Perform() replacement for
// the general-repair sites). Runs import -> healBRep -> export as above.
//
//   precision : model-space heal tolerance (<= 0 => healBRep's own default, 1e-6).
//               Mirrors ShapeFix_Shape::SetPrecision on the sites that pass one.
//   maxTol    : accepted for signature parity with SetMaxTolerance; healBRep uses a
//               single ACIS-style tolerance, so this only clamps `precision` (there
//               is no min/max tolerance BAND natively — surfaced in the report).
//   report    : optional; when non-null, filled with the honest telemetry above.
//
// RETURNS the healed OCCT shape, OR the input `shape` UNCHANGED when the native path
// defers (import/heal/export could not faithfully proceed) or when heal found nothing
// to fix (clean input — geometry preserved exactly, never faceted). NEVER throws and
// NEVER returns a null/wrong shape: on any internal failure it returns the input.
TopoDS_Shape fixShapeGeneral(const TopoDS_Shape& shape,
                             double precision = 0.0,
                             double maxTol = 0.0,
                             GeneralFixReport* report = nullptr);

}  // namespace occtheal
}  // namespace forge

#endif  // FORGE_NATIVE_BREP

#endif  // FORGE_NATIVE_BREP_NATIVESHAPEHEALBRIDGE_HPP
