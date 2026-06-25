// PUSH-18 — Multi-shape sewing wrapper.
//
// Builds a BRepBuilderAPI_Sewing instance at the user's tolerance, adds
// every input shape, runs Perform(), and registers the resulting compound
// shape. The report captures the four counters the algorithm exposes:
// free edges (still open), multiple edges (non-manifold join sites),
// contiguous edges (the ones that actually fused), and degenerated
// shapes (singular geometry).

#include "forge/Sewing.hpp"

#include <BRepBuilderAPI_Sewing.hxx>
#include <Precision.hxx>
#include <TopoDS_Shape.hxx>

#include <stdexcept>
#include <string>

// PHASE-D wiring (2026-06-25) — route forge::sewing::sew through the ALREADY-BUILT,
// A/B-certified native sewer (forge::native::brep::sewFaces — Sew.cpp) behind a GATE.
// Compiled in ONLY under -DFORGE_NATIVE_BREP and taken at runtime ONLY when the FEAT
// gate forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1, or the A/B
// harness's setForgeNativeBrepEnabled(true), which flips CORE+FEAT+STEP together).
// PRODUCTION DEFAULT IS OFF: with the gate off, the original OCCT BRepBuilderAPI_Sewing
// path below runs byte-for-byte unchanged. This mirrors the Booleans.cpp / Transform.cpp
// "tryNative* -> else OCCT" idiom: the native branch is taken only when EVERY input
// handle is a NativeSolid (so its faces can be cloned into one builder and welded); a
// mixed/OCCT-backed input HONESTLY DEFERS to OCCT (no silent OCCT-face importer exists).
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled()
#include "forge/native/brep/Sew.hpp"           // sewFaces, SewOptions, SewResult (native)
#include "forge/native/brep/Topology.hpp"      // TopologyBuilder, Face/Loop/Coedge/Vertex/Solid/Shell
#include <memory>
#include <vector>
#endif

namespace forge::sewing {

#ifdef FORGE_NATIVE_BREP
namespace {

// Deep-clone one native Face (its outer ring vertices + analytic surface frame +
// trim window) into `tb` as an INDEPENDENT fragment with PRIVATE fresh vertices/
// edges (exactly the "N separate STEP ADVANCED_FACE records" scenario the native
// sewer expects — see Sew.hpp). Coincident boundaries across the cloned faces stay
// DISTINCT topological entities until sewFaces() welds them. Mirrors the per-face
// loop-clone in NativeRoute.cpp::transformSolid (no transform: identity copy).
native::brep::Face* cloneFaceIndependent(native::brep::TopologyBuilder& tb,
                                         const native::brep::Face* sf) {
    using namespace forge::native::brep;
    Loop* lp = sf->outerLoop;
    if (!lp || lp->coedgeCount < 3) return nullptr;

    std::vector<Vertex*> ring;
    ring.reserve(lp->coedgeCount);
    Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount && c != nullptr; ++i) {
        Vertex* o = c->originVertex();
        // PRIVATE fresh vertex per corner (no welding/sharing here): the sewer
        // welds coincident corners across faces. Same construction the A/B harness
        // (native_vs_occt_sew.cpp::nativeSew via addOuterLoopToFace) relies on.
        ring.push_back(tb.makeVertex(o->point));
        c = c->next;
    }
    Face* nf = tb.makeFace();
    tb.addOuterLoopToFace(nf, ring);   // private fresh edges for this fragment

    // Copy the analytic surface frame + trim window verbatim (identity clone), so a
    // sewn quadric face keeps its EXACT parent surface for downstream mass-props.
    if (sf->surface) {
        Surface* ns = tb.makeSurface();
        *ns = *sf->surface;
        nf->surface = ns;
    }
    nf->u0 = sf->u0; nf->u1 = sf->u1;
    nf->v0 = sf->v0; nf->v1 = sf->v1;
    nf->vertexUV = sf->vertexUV;
    nf->paramTri = sf->paramTri;
    return nf;
}

// Try the native sew (brep::sewFaces). Returns true + sets `out` on success; returns
// false (NEVER throws) when the native path HONESTLY DEFERS so the caller falls back
// to OCCT. Deferral cases (Bible §0 — native-where-valid, OCCT otherwise):
//   * any input handle is NOT a NativeSolid (mixed / OCCT-backed operands — there is
//     no OCCT-face -> native-Face importer, so we cannot ingest an OCCT face).
//   * no cloneable faces, or sewFaces returns ok==false (malformed fragment set).
bool tryNativeSew(const std::vector<ShapeHandle>& shapes, double tolerance,
                  SewResult& out) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();

    // DEFER unless EVERY input is a native analytic solid (the only native shape we
    // can decompose into faces without an OCCT-face importer). Matches Booleans.cpp's
    // "all operands NativeSolid or defer" rule.
    for (ShapeHandle h : shapes) {
        if (reg.kindOf(h) != ShapeKind::NativeSolid) return false;
    }

    // One fresh builder owns the whole cloned-fragment graph + the sewn result, so
    // the registered handle keeps its topology alive (same ownership model as
    // registerNative in Primitives.cpp).
    auto owner = std::make_shared<TopologyBuilder>();
    std::vector<Face*> faces;
    for (ShapeHandle h : shapes) {
        const Solid& s = reg.getNativeSolid(h);
        for (Shell* sh : s.shells) {
            for (Face* sf : sh->faces) {
                if (Face* nf = cloneFaceIndependent(*owner, sf)) faces.push_back(nf);
            }
        }
    }
    if (faces.empty()) return false;

    SewOptions opt;
    opt.tol = tolerance;            // honor the caller's tolerance (model-space dist)
    // NOTE: fully-qualify the native result type — bare `SewResult` in this TU is the
    // OCCT-facing forge::sewing::SewResult (the function's own return struct), NOT the
    // native sewer's result. They are DISTINCT types in DISTINCT namespaces.
    native::brep::SewResult r = sewFaces(*owner, faces, opt);
    if (!r.ok) return false;

    // Wrap the sewn shell(s) into a Solid so the handle is a NativeSolid (the kind
    // the registry + downstream native ops understand). sewFaces does not allocate a
    // Solid — it returns connected Shell(s); we make one Solid owning them all.
    Solid* solid = owner->makeSolid();
    for (Shell* sh : r.shells) owner->addShellToSolid(solid, sh);

    out.handle = reg.addNativeSolid(std::move(owner), solid);
    out.report.inputShapeCount = shapes.size();
    // EXACT mappings native -> SewReport:
    //   freeEdges      <- diagnosis.freeEdges        (still-open boundary edges)
    //   multipleEdges  <- diagnosis.nonManifoldEdges (shared by >2 faces)
    //   contiguousEdges<- mergedEdgePairs            (independent edges fused into one)
    out.report.freeEdges       = r.diagnosis.freeEdges;
    out.report.multipleEdges   = r.diagnosis.nonManifoldEdges;
    out.report.contiguousEdges = r.mergedEdgePairs;
    // GAP (surfaced, not silently degraded): OCCT's NbDegeneratedShapes() counts
    // singular-geometry inputs the sewer dropped. The native sewer rejects malformed
    // faces up front (returns ok==false) rather than counting them, so there is no
    // per-result degenerate count to report; left 0. This is the one report field the
    // native API cannot express 1:1 — documented here, never faked to a wrong number.
    out.report.degeneratedShapes = 0;
    return true;
}

}  // namespace
#endif

SewResult sew(const std::vector<ShapeHandle>& shapes, double tolerance) {
    if (shapes.empty()) {
        throw std::invalid_argument(
            "forge.sewing.sew: must pass at least one shape handle");
    }
    if (tolerance <= 0.0) {
        throw std::invalid_argument(
            "forge.sewing.sew: tolerance must be > 0 (got " +
            std::to_string(tolerance) + ")");
    }

#ifdef FORGE_NATIVE_BREP
    // GATE: native sewer is opt-in via the FEAT gate (default OFF). When on AND every
    // input is a NativeSolid, sew via brep::sewFaces; otherwise fall through to OCCT
    // (mixed/OCCT operands HONESTLY DEFER — no behavior change in the default build).
    if (native::brep::forgeNativeFeaturesEnabled()) {
        SewResult nativeOut{};
        if (tryNativeSew(shapes, tolerance, nativeOut)) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    // Defaults Option=Standard_True (use BRep) + Cutting=Standard_True
    // (split overlapping edges at intersections) + NonManifold=False
    // (return manifold compound). Same as OCCT's default ctor.
    BRepBuilderAPI_Sewing tool(tolerance);
    for (auto h : shapes) {
        const auto& s = ShapeRegistry::instance().get(h);
        if (s.IsNull()) {
            throw std::runtime_error(
                "forge.sewing.sew: shape handle " + std::to_string(h) +
                " resolves to a null shape");
        }
        tool.Add(s);
    }
    tool.Perform();

    const TopoDS_Shape& result = tool.SewedShape();
    if (result.IsNull()) {
        throw std::runtime_error(
            "forge.sewing.sew: BRepBuilderAPI_Sewing returned a null shape");
    }

    SewResult out{};
    out.handle = ShapeRegistry::instance().add(result);
    out.report.inputShapeCount   = shapes.size();
    out.report.freeEdges         = static_cast<std::size_t>(tool.NbFreeEdges());
    out.report.multipleEdges     = static_cast<std::size_t>(tool.NbMultipleEdges());
    out.report.contiguousEdges   = static_cast<std::size_t>(tool.NbContigousEdges());
    out.report.degeneratedShapes = static_cast<std::size_t>(tool.NbDegeneratedShapes());
    return out;
}

}  // namespace forge::sewing
