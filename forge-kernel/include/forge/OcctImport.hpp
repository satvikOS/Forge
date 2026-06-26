// forge/OcctImport.hpp
//
// IN-HOUSE KERNEL — the OCCT -> native B-rep IMPORTER (the Phase-D substrate
// keystone). The mirror of NativeOcctBridge.hpp (native -> OCCT): this turns an
// OCCT-backed shape (ShapeKind::Occt, a TopoDS_Shape) into a pure
// forge::native::brep::Solid so the 18 already-wired `tryNative*` op call-sites
// can take their native branch on OCCT inputs instead of deferring totally.
//
// ============================ HONESTY (Bible §0/§9) ========================
// SCOPE: ANALYTIC faces — Plane + Cylinder + Cone + Sphere — PLUS free-form
// BSpline / Bezier SURFACE faces (the biggest OCCT-zero gap: real CAD parts with
// fillet blends, lofts and sweeps have BSpline faces). Each OCCT analytic face is
// re-expressed as the SAME analytic surface in the native model (frame matched to
// OCCT's elementary parameterization, so the native (u,v) coincides with OCCT's);
// each BSpline face is extracted EXACTLY (poles/weights/clamped knots/degrees,
// 1:1, periodic->clamped via OCCT's own de-periodisation) into a native
// brep::NurbsSurface, with the face's (u,v) wire loops as its trim. Every face is
// then triangulated in its (u,v) domain (the proven Boolean "faceted topology over
// exact geometry" model) so faces with HOLES (a bored cap) are represented and
// welded watertight from the SHARED OCCT edge 3-D curves. Curved sub-faces keep
// the parent surface (paramTri integration over the EXACT — quadric or rational —
// Jacobian); planar sub-faces integrate the exact polygon. The result is
// A/B-verified vs the OCCT original (volume/area/bbox/Betti/validity) by
// test/native_occt_import_test.cpp, INCLUDING a variable-radius-fillet box
// (BSpline blend + 6 planes) and a through-sections loft (BSpline side + caps) —
// genuine MIXED analytic+BSpline solids — to within ~1% mass/area (NURBS trim
// meshing is approximate where the analytic path is exact; bbox/Betti are exact).
//
// A Torus / SurfaceOfRevolution / SurfaceOfExtrusion / Offset face still ->
// ok=false, reason="non-analytic face <type>" — DEFERRED HONESTLY, never
// facet-faked. (Degenerate BSpline corner-setback patches in a constant-radius
// all-edge fillet likewise defer honestly via the 2-manifold pre-check rather
// than emit a folded shell.)
//
// Compiled ONLY under FORGE_NATIVE_BREP. It READS OCCT (it is the bridge) but
// EMITS pure native types. C++20, no new deps.

#ifndef FORGE_OCCT_IMPORT_HPP
#define FORGE_OCCT_IMPORT_HPP

#ifdef FORGE_NATIVE_BREP

#include <memory>
#include <string>

#include <TopoDS_Shape.hxx>

#include "forge/native/brep/Topology.hpp"   // brep::TopologyBuilder, brep::Solid

namespace forge {

// Result of importing one OCCT shape into the native analytic B-rep model.
//   ok     — true iff EVERY face imported faithfully AND the assembled native
//            Solid is a closed 2-manifold. On false, `solid`/`owner` are null and
//            `reason` names why (e.g. "non-analytic face BSpline", "not a closed
//            2-manifold after import", "no solid in shape").
//   reason — empty on success; the honest deferral cause on failure.
//   solid  — a non-owning view into *owner (null on failure).
//   owner  — keeps the native TopologyBuilder (which owns the topology/surfaces
//            the Solid* views into) alive for the entry's lifetime.
struct ImportResult {
    bool ok = false;
    std::string reason;
    native::brep::Solid* solid = nullptr;
    std::shared_ptr<native::brep::TopologyBuilder> owner;
};

// Import the FIRST solid found in `shape` (or, if the shape carries no TopoDS_Solid,
// the shape's faces directly) into a native analytic B-rep Solid. Never throws on
// an unsupported face — returns ok=false with a reason so the caller can defer.
ImportResult importOcctSolid(const TopoDS_Shape& shape);

// TEST-ONLY PROBE — the number of times importOcctSolid has been ENTERED process-wide
// (incremented on the first line of every call, regardless of ok/defer). A/B tests use
// it to PROVE a Phase-D-wired op actually ran the OCCT->native importer on an OCCT input
// (i.e. it took the native branch, not silently deferred to OCCT). Zero behavioral impact
// on production — it only reads/writes a counter.
unsigned long long importOcctSolidCallCount();

}  // namespace forge

#endif  // FORGE_NATIVE_BREP

#endif  // FORGE_OCCT_IMPORT_HPP
