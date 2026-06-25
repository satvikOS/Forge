// forge/OcctImport.hpp
//
// IN-HOUSE KERNEL — the OCCT -> native B-rep IMPORTER (the Phase-D substrate
// keystone). The mirror of NativeOcctBridge.hpp (native -> OCCT): this turns an
// OCCT-backed shape (ShapeKind::Occt, a TopoDS_Shape) into a pure
// forge::native::brep::Solid so the 18 already-wired `tryNative*` op call-sites
// can take their native branch on OCCT inputs instead of deferring totally.
//
// ============================ HONESTY (Bible §0/§9) ========================
// SCOPE: ANALYTIC faces only — Plane + Cylinder + Cone + Sphere. Each OCCT
// analytic face is re-expressed as the SAME analytic surface in the native
// model (frame matched to OCCT's elementary parameterization, so the native
// (u,v) coincides with OCCT's), then triangulated in its (u,v) domain (the
// proven Boolean "faceted topology over exact analytic geometry" model) so that
// faces with HOLES (e.g. a bored box cap) are represented and welded watertight.
// Curved sub-faces keep the parent quadric (paramTri integration -> EXACT mass);
// planar sub-faces integrate the exact polygon. The result is A/B-verified vs
// the OCCT original (volume/area/bbox/Betti) by test/native_occt_import_test.cpp.
//
// A NURBS / BSpline / Bezier / Torus / Revolution / Extrusion / Offset face ->
// ok=false, reason="non-analytic face <type>" — DEFERRED HONESTLY, never
// facet-faked. This covers the canonical primitives (box/cyl/cone/sphere/prism)
// and analytic-boolean results, which is exactly what the wires need first.
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

}  // namespace forge

#endif  // FORGE_NATIVE_BREP

#endif  // FORGE_OCCT_IMPORT_HPP
