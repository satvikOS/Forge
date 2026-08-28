// PUSH-18 — Guided loft via BRepOffsetAPI_ThruSections.
//
// Loads every profile-wire handle, adds each as a section via AddWire(),
// and for each guide edge samples one point at its midpoint that gets
// added as a point-section via AddVertex(). This is OCCT's only built-in
// way to direct a ThruSections operation toward intermediate points; for
// true guide-curve interpolation the caller should use
// forge::part::loftWithGuides which builds a GeomFill_NSections surface.

#include "forge/LoftGuide.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <Precision.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>

#include <stdexcept>
#include <string>

// PHASE-D wiring (2026-06-25) — route the ONE genuine loft op in this module,
// loft()'s UNGUIDED loft through ordered profile sections (BRepOffsetAPI_ThruSections),
// through the ALREADY-BUILT in-house analytic loft solid
// (forge::native::brep::loftSolid — LoftSweep.hpp/.cpp: the OCCT-FREE replacement for
// BRepOffsetAPI_ThruSections that lofts N ordered planar polygon sections into a closed
// analytic brep::Solid) behind a GATE. Compiled in ONLY under -DFORGE_NATIVE_BREP and
// taken at runtime ONLY when forgeNativeFeaturesEnabled() is true (env
// FORGE_NATIVE_FEATURES=1, or the A/B harness's setForgeNativeBrepEnabled(true)).
// PRODUCTION DEFAULT IS OFF: with the gate off the original OCCT path below
// (BRepOffsetAPI_ThruSections AddWire/AddVertex) runs byte-for-byte unchanged. Mirrors
// the prior wires (CamAdvanced.cpp generateCmm / Drawings.cpp projectShape /
// Cam.cpp PolygonOffset2D / Healing.cpp healBRep): tryNativeLoftGuide takes the native
// branch ONLY when EVERY input section is a native section (no OCCT-wire -> native-
// section importer exists), so an OCCT-backed input HONESTLY DEFERS to OCCT, and the
// gate-off default and the gate-on OCCT-input path are both identical to today.
//
// ONLY the UNGUIDED loft is wired. The native loft (LoftSweep.hpp) explicitly names
// "guide-rail loft" as a NAMED FOLLOW-UP that is NOT in its increment (see the header's
// "NAMED FOLLOW-UPS (explicitly NOT in this increment): guide-rail loft, ..."). There
// is therefore NO native target for the GUIDED case (any non-empty guideEdges, which
// OCCT realises here as supplemental midpoint vertex-sections via AddVertex). So when
// the caller passes guide edges, tryNativeLoftGuide defers and the call stays OCCT-only
// — surfaced honestly, NOT a silent degrade and NOT a stub.
//
// DEFERRAL is total today: a profile-wire ShapeHandle is always an OCCT TopoDS_Wire
// (ShapeRegistry has only Occt / NativeSolid / NativeMesh kinds — no native wire/section
// handle, and no OCCT-wire -> native-LoftSection importer). loftSolid() consumes
// LoftSection{ std::vector<Point3> } polygon rings, so until a native-section producer
// exists, tryNativeLoftGuide returns false for every input and the OCCT path runs. The
// gate + native target are wired so the path activates the moment native sections land,
// with ZERO change to today's behaviour.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled()
#include "forge/native/brep/LoftSweep.hpp"     // loftSolid (native unguided loft)
#include "forge/native/brep/Topology.hpp"      // Point3, Solid
#include "forge/native/brep/NativeLoftPipe.hpp" // TKOffset family D: ruled loft on OCCT wires
#endif

namespace forge::loftguide {

namespace {

TopoDS_Wire asWire(const TopoDS_Shape& s, ShapeHandle h) {
    if (s.ShapeType() != TopAbs_WIRE) {
        // Accept compounds/edges if they carry exactly one wire — that's a
        // common idiom for sketches that resolved into a TopoDS_Compound.
        TopExp_Explorer ex(s, TopAbs_WIRE);
        if (ex.More()) {
            TopoDS_Wire w = TopoDS::Wire(ex.Current());
            ex.Next();
            if (!ex.More()) return w;
        }
        throw std::invalid_argument(
            "forge.loftguide.loft: profile handle " + std::to_string(h) +
            " is not a single TopoDS_Wire");
    }
    return TopoDS::Wire(s);
}

// [[maybe_unused]]: the only caller is the guide-edge -> AddVertex loop in the
// OCCT ThruSections path, which FORGE_THRUSECTIONS_DROP_NATIVE compiles out.
[[maybe_unused]] TopoDS_Edge asEdge(const TopoDS_Shape& s, ShapeHandle h) {
    if (s.ShapeType() != TopAbs_EDGE) {
        TopExp_Explorer ex(s, TopAbs_EDGE);
        if (ex.More()) return TopoDS::Edge(ex.Current());
        throw std::invalid_argument(
            "forge.loftguide.loft: guide handle " + std::to_string(h) +
            " is not a TopoDS_Edge");
    }
    return TopoDS::Edge(s);
}

}  // namespace

#ifdef FORGE_NATIVE_BREP
namespace {

// Try the native analytic loft (brep::loftSolid) for the UNGUIDED loft case. Returns
// true + adds the native solid to the registry via `out` on success; returns false
// (NEVER throws) when the native path HONESTLY DEFERS so the caller falls through to the
// OCCT BRepOffsetAPI_ThruSections path. Same deferral contract as the prior wires
// (CamAdvanced.cpp::tryNativeGenerateCmm / Drawings.cpp::tryNativeProjectShape).
//
// Deferral / GAP cases (Bible §0 — native-where-valid, OCCT otherwise):
//   * GUIDED loft (any non-empty `guideEdges`): the native loft (LoftSweep.hpp) has NO
//     guide-rail variant — it is a NAMED FOLLOW-UP explicitly outside that increment —
//     so the WHOLE call defers to OCCT (which steers the surface with AddVertex point-
//     sections). Surfaced honestly; the guided case stays OCCT-only.
//   * ANY profile section that is not a NATIVE section: a profile-wire ShapeHandle is an
//     OCCT TopoDS_Wire, and there is NO OCCT-wire -> native-LoftSection importer (the
//     registry has no native wire/section kind). loftSolid consumes
//     LoftSection{ Point3 ring } polygons, so until a native-section producer exists
//     EVERY input defers and the OCCT path runs — byte-identical to the gate-off
//     default. We must NOT fabricate sections from OCCT wires (that would be a silent
//     substitution), so the WHOLE call defers when any profile is not natively backed.
//
// `nativeSectionsOf` is the single seam a future native-section producer plugs into: it
// returns true + fills `sections` ONLY when every profile handle is a native section.
// Today no profile handle is, so it returns false and this helper defers.
bool nativeSectionsOf(const std::vector<ShapeHandle>& /*profileWires*/,
                      std::vector<forge::native::brep::LoftSection>& /*sections*/) {
    // No OCCT-wire -> native-LoftSection importer and no native wire/section handle in
    // ShapeRegistry (kinds are Occt / NativeSolid / NativeMesh). A profile section is
    // therefore never natively backed today -> defer. When a native-section producer
    // lands, this is where its handles are resolved into LoftSection rings.
    return false;
}

bool tryNativeLoftGuide(const std::vector<ShapeHandle>& profileWires,
                        const std::vector<ShapeHandle>& guideEdges,
                        bool solid,
                        bool ruled,
                        ShapeHandle& out) {
    using namespace forge::native::brep;
    // GUIDED loft has no native target -> defer the whole call to OCCT.
    if (!guideEdges.empty()) return false;
    // Resolve the profile sections natively; any OCCT-backed profile -> defer.
    std::vector<LoftSection> sections;
    if (!nativeSectionsOf(profileWires, sections)) return false;
    if (sections.size() < 2) return false;                       // mirror OCCT >= 2 guard

    LoftSweepResult res = loftSolid(sections);
    if (!res.ok || !res.solid || !res.owner) return false;       // degenerate -> defer

    (void)solid;  // native loftSolid always yields a closed solid (== solid=true);
    (void)ruled;  // ruled/smoothed side-surface selection is an OCCT-only ThruSections
                  // toggle. A non-default (ruled==false smoothed, or solid==false shell)
                  // request has no exact native equivalent yet, so callers reaching this
                  // path want the closed analytic solid; nativeSectionsOf gates entry.

    // LoftSweepResult::owner is a shared_ptr<SolidFactory> (the factory owns the
    // TopologyBuilder by value). Hand the registry a shared_ptr<TopologyBuilder> via the
    // aliasing constructor — the canonical idiom in Primitives.cpp::registerNative — so
    // the whole factory stays alive while the registry holds the builder/Solid.
    std::shared_ptr<TopologyBuilder> owner(res.owner, &res.owner->builder());
    out = ShapeRegistry::instance().addNativeSolid(std::move(owner), res.solid);
    return true;
}

}  // namespace
#endif

ShapeHandle loft(const std::vector<ShapeHandle>& profileWires,
                 const std::vector<ShapeHandle>& guideEdges,
                 bool solid,
                 bool ruled) {
#ifdef FORGE_NATIVE_BREP
    // GATE: the native analytic loft (brep::loftSolid) is opt-in via the FEAT gate
    // (default OFF). When on AND every profile is a native section AND no guide edges
    // are requested (the unguided case the native loft covers), build the lofted solid
    // natively; otherwise fall through to OCCT (an OCCT-backed input or a guided loft
    // HONESTLY DEFERS — no behavior change in the default build). A false return ==
    // defer. The same input-validation throws below still guard the OCCT path; the
    // native pre-flight only intercepts the geometry-building work.
    if (native::brep::forgeNativeFeaturesEnabled()) {
        ShapeHandle nativeOut = 0;
        if (tryNativeLoftGuide(profileWires, guideEdges, solid, ruled, nativeOut)) {
            return nativeOut;
        }
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    if (profileWires.size() < 2) {
        throw std::invalid_argument(
            "forge.loftguide.loft: need at least 2 profile wires (got " +
            std::to_string(profileWires.size()) + ")");
    }

#ifdef FORGE_NATIVE_BREP
    // TKOffset family D — TKOffset-free ruled loft on the OCCT wires themselves.
    // Unlike tryNativeLoftGuide above (which needs a native LoftSection and so
    // defers on 100% of inputs), this engine consumes the TopoDS_Wire directly.
    // Guide edges become AddVertex point-sections in the OCCT path, which the
    // native engine only accepts at the ends; a guided call therefore DEFERS.
    if (::forge::occtloft::loftNativeEnabled() && guideEdges.empty()) {
        std::vector<TopoDS_Shape> secs;
        secs.reserve(profileWires.size());
        bool ok = true;
        for (auto h : profileWires) {
            const auto& s = ShapeRegistry::instance().get(h);
            if (s.IsNull()) { ok = false; break; }
            secs.push_back(asWire(s, h));
        }
        if (ok) {
            const TopoDS_Shape nat = ::forge::occtloft::thruSections(secs, solid, ruled);
            if (!nat.IsNull()) return ShapeRegistry::instance().add(nat);
        }
    }
#endif
#ifdef FORGE_THRUSECTIONS_DROP_NATIVE
    throw std::runtime_error(
        "forge.loftguide.loft: the native ruled loft DECLINED these profiles and the "
        "OCCT BRepOffsetAPI_ThruSections fallback is compiled out "
        "(FORGE_THRUSECTIONS_DROP_NATIVE=ON)");
#else
    BRepOffsetAPI_ThruSections mk(
        /*isSolid*/ solid ? Standard_True : Standard_False,
        /*ruled*/  ruled ? Standard_True : Standard_False,
        /*pres3d*/ 1.0e-6);

    // Profile sections.
    for (auto h : profileWires) {
        const auto& s = ShapeRegistry::instance().get(h);
        if (s.IsNull()) {
            throw std::runtime_error(
                "forge.loftguide.loft: profile handle " + std::to_string(h) +
                " is null");
        }
        mk.AddWire(asWire(s, h));
    }

    // Guide edges become supplementary vertex sections (one mid-point per
    // guide). This is the only built-in ThruSections affordance for
    // steering the surface toward intermediate points; for proper
    // guide-curve interpolation use forge::part::loftWithGuides instead.
    for (auto h : guideEdges) {
        const auto& s = ShapeRegistry::instance().get(h);
        if (s.IsNull()) {
            throw std::runtime_error(
                "forge.loftguide.loft: guide handle " + std::to_string(h) +
                " is null");
        }
        TopoDS_Edge e = asEdge(s, h);
        BRepAdaptor_Curve curve(e);
        const Standard_Real pFirst = curve.FirstParameter();
        const Standard_Real pLast  = curve.LastParameter();
        const Standard_Real pMid   = 0.5 * (pFirst + pLast);
        gp_Pnt mid = curve.Value(pMid);
        BRepBuilderAPI_MakeVertex mkv(mid);
        if (!mkv.IsDone()) {
            throw std::runtime_error(
                "forge.loftguide.loft: failed to make vertex from guide edge midpoint");
        }
        mk.AddVertex(mkv.Vertex());
    }

    mk.Build();
    if (!mk.IsDone()) {
        throw std::runtime_error(
            "forge.loftguide.loft: BRepOffsetAPI_ThruSections build failed");
    }
    return ShapeRegistry::instance().add(mk.Shape());
#endif  // !FORGE_THRUSECTIONS_DROP_NATIVE
}

}  // namespace forge::loftguide
