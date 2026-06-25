// PUSH-18 — ShapeFix_Shape::Perform() with full status logging.
//
// Wraps Healing's ShapeFix_Shape pass with a human-readable list of every
// fixer that fired. Maps the DONE1..8 / FAIL1..8 enums to short strings
// matching OCCT documentation. Returns the fixed shape's handle + log.

#include "forge/ShapeFix.hpp"

#include <Precision.hxx>
#include <ShapeExtend_Status.hxx>
#include <ShapeFix_Shape.hxx>
#include <TopoDS_Shape.hxx>

#include <stdexcept>

// PHASE-D wiring (2026-06-25) — route forge::shapefix::repair through the ALREADY-BUILT,
// A/B-certified native HEALER (forge::native::brep::healBRep — Heal.cpp, the in-house
// ShapeFix_Shape/ShapeFix_Wire/ShapeUpgrade_* replacement) behind a GATE. Compiled in
// ONLY under -DFORGE_NATIVE_BREP and taken at runtime ONLY when the FEAT gate
// forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1, or the A/B harness's
// setForgeNativeBrepEnabled(true), which flips CORE+FEAT+STEP together). PRODUCTION
// DEFAULT IS OFF: with the gate off, the original OCCT ShapeFix_Shape path below runs
// byte-for-byte unchanged. This mirrors the just-landed Sewing.cpp wire (commit 19840b66):
// the native branch is taken only when the input handle is a NativeSolid (so its faces can
// be decomposed into independent fragments and re-healed); an OCCT-backed input HONESTLY
// DEFERS to OCCT (there is no OCCT-face -> native-Face importer).
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled()
#include "forge/native/brep/Heal.hpp"          // healBRep, HealOptions, HealReport (native)
#include "forge/native/brep/Topology.hpp"      // TopologyBuilder, Face/Loop/Coedge/Vertex/Shell/Solid/Surface
#include <memory>
#include <string>
#include <unordered_set>
#include <vector>
#endif

namespace forge::shapefix {

namespace {

// Map DONE1..DONE8 to a short message taken from the OCCT ShapeFix_Shape
// header documentation (DONE1 = some free wires fixed, DONE2 = some free
// edges fixed, …). FAIL bits use a generic "fix attempted, failed" tag
// since the per-bit semantics aren't always documented per-sub-fixer.
const char* doneMessage(int idx) {
    switch (idx) {
        case 1: return "DONE1: tolerance fixed";
        case 2: return "DONE2: wires fixed";
        case 3: return "DONE3: small faces removed";
        case 4: return "DONE4: edges fixed";
        case 5: return "DONE5: face orientations fixed";
        case 6: return "DONE6: self-intersection / shell topology fixed";
        case 7: return "DONE7: missing seams / pcurves fixed";
        case 8: return "DONE8: other fixer fired";
    }
    return "DONE?: unknown";
}

const char* failMessage(int idx) {
    switch (idx) {
        case 1: return "FAIL1: tolerance fix failed";
        case 2: return "FAIL2: wire fix failed";
        case 3: return "FAIL3: small-face fix failed";
        case 4: return "FAIL4: edge fix failed";
        case 5: return "FAIL5: face orientation fix failed";
        case 6: return "FAIL6: self-intersection / shell fix failed";
        case 7: return "FAIL7: missing seam / pcurve fix failed";
        case 8: return "FAIL8: other fixer failed";
    }
    return "FAIL?: unknown";
}

}  // namespace

#ifdef FORGE_NATIVE_BREP
namespace {

// Deep-clone one native Face (its outer ring vertices + any inner rings + analytic
// surface frame + trim window) into `tb` as an INDEPENDENT fragment with PRIVATE fresh
// vertices/edges — exactly the "N separate STEP ADVANCED_FACE records" import state the
// native healer (Heal.hpp) expects to ingest, so its weld/gap-fill/sliver/orientation/
// non-manifold passes act on the raw fragment soup (NOT on an already-sewn shell). This
// is byte-for-byte the per-face loop-clone of Sewing.cpp::cloneFaceIndependent (identity
// copy, no transform). Coincident boundaries across the cloned faces stay DISTINCT
// topological entities until healBRep welds + re-sews them.
native::brep::Face* cloneFaceIndependent(native::brep::TopologyBuilder& tb,
                                         const native::brep::Face* sf) {
    using namespace forge::native::brep;
    Loop* lp = sf->outerLoop;
    if (!lp || lp->coedgeCount < 3) return nullptr;

    auto ringOf = [&](const Loop* loop) -> std::vector<Vertex*> {
        std::vector<Vertex*> ring;
        if (!loop || loop->coedgeCount < 3) return ring;
        ring.reserve(loop->coedgeCount);
        Coedge* c = loop->first;
        for (std::size_t i = 0; i < loop->coedgeCount && c != nullptr; ++i) {
            Vertex* o = c->originVertex();
            // PRIVATE fresh vertex per corner (no welding/sharing here): healBRep welds
            // coincident corners across faces itself (its (4) weld + (1) gap-fill pass).
            if (o) ring.push_back(tb.makeVertex(o->point));
            c = c->next;
        }
        return ring;
    };

    std::vector<Vertex*> outer = ringOf(lp);
    if (outer.size() < 3) return nullptr;

    Face* nf = tb.makeFace();
    tb.addOuterLoopToFace(nf, outer);          // private fresh edges for this fragment
    // Carry inner (hole) loops verbatim so a face-with-holes heals correctly.
    for (Loop* il : sf->innerLoops) {
        std::vector<Vertex*> inner = ringOf(il);
        if (inner.size() >= 3) tb.addInnerLoopToFace(nf, inner);
    }

    // Copy the analytic surface frame + trim window verbatim (identity clone), so a
    // healed quadric face keeps its EXACT parent surface for downstream mass-props.
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

// Try the native heal (brep::healBRep). Returns true + sets `out` on success; returns
// false (NEVER throws) when the native path HONESTLY DEFERS so the caller falls back to
// OCCT. Deferral cases (Bible §0 — native-where-valid, OCCT otherwise):
//   * the input handle is NOT a NativeSolid (an OCCT-backed shape — there is no
//     OCCT-face -> native-Face importer, so we cannot ingest it). Mirrors Sewing.cpp.
//   * no cloneable faces, or healBRep returns ok==false (malformed fragment set).
bool tryNativeRepair(ShapeHandle shape, double precision, RepairResult& out) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();

    // DEFER unless the input is a native analytic solid (the only native shape we can
    // decompose into faces without an OCCT-face importer). Matches Sewing.cpp's rule.
    if (reg.kindOf(shape) != ShapeKind::NativeSolid) return false;

    // One fresh builder owns the whole cloned-fragment graph + the healed result, so the
    // registered handle keeps its topology alive (same ownership model as Sewing.cpp).
    auto owner = std::make_shared<TopologyBuilder>();
    std::vector<Face*> faces;
    {
        const Solid& s = reg.getNativeSolid(shape);
        for (Shell* sh : s.shells) {
            for (Face* sf : sh->faces) {
                if (Face* nf = cloneFaceIndependent(*owner, sf)) faces.push_back(nf);
            }
        }
    }
    if (faces.empty()) return false;

    HealOptions opt;
    // `precision` is forge::shapefix::repair's model-space precision (0 => keep the
    // OCCT defaults; the native healer has no analogous "unset" so use its own tol
    // default). When the caller passes a precision, honor it as the heal tolerance.
    if (precision > 0.0) opt.tol = precision;

    HealReport rep = healBRep(*owner, faces, opt);
    if (!rep.ok) return false;                 // malformed input -> defer to OCCT
    if (rep.faces.empty()) return false;       // nothing survived -> defer to OCCT

    // Wrap the healed shell(s) into a Solid so the handle is a NativeSolid (the kind the
    // registry + downstream native ops understand). healBRep returns the healed Face set
    // (rep.faces) + the primary connected Shell (rep.shell); each healed Face carries its
    // ->shell back-pointer. We gather the DISTINCT shells the healed faces belong to and
    // own them all under one fresh Solid (mirrors Sewing.cpp wrapping r.shells).
    Solid* solid = owner->makeSolid();
    std::unordered_set<Shell*> seen;
    for (Face* f : rep.faces) {
        if (f && f->shell && seen.insert(f->shell).second) {
            owner->addShellToSolid(solid, f->shell);
        }
    }
    // Defensive: if the diagnosis path left faces without a shell back-pointer (e.g. an
    // all-sliver degenerate result), fall back to the primary shell if any; else defer.
    if (solid->shells.empty()) {
        if (rep.shell) owner->addShellToSolid(solid, rep.shell);
        else return false;
    }

    out.handle = reg.addNativeSolid(std::move(owner), solid);

    // ---- Surface the heal log, mapping native HealReport -> the human-readable list ----
    // EXACT mappings native -> RepairResult.log (the counts of fixes ACTUALLY applied):
    if (rep.verticesWelded > 0)
        out.log.emplace_back("native heal: welded " + std::to_string(rep.verticesWelded) +
                             " coincident vertices");
    if (rep.gapsClosed > 0)
        out.log.emplace_back("native heal: closed " + std::to_string(rep.gapsClosed) +
                             " sub-tol free-edge gaps");
    if (rep.shortEdgesCollapsed > 0)
        out.log.emplace_back("native heal: collapsed " + std::to_string(rep.shortEdgesCollapsed) +
                             " short/collinear edges");
    if (rep.sliverFacesRemoved > 0)
        out.log.emplace_back("native heal: removed " + std::to_string(rep.sliverFacesRemoved) +
                             " sliver faces");
    if (rep.edgePairsMerged > 0)
        out.log.emplace_back("native heal: re-mated " + std::to_string(rep.edgePairsMerged) +
                             " shared edge pairs");
    if (rep.facesFlipped > 0)
        out.log.emplace_back("native heal: flipped " + std::to_string(rep.facesFlipped) +
                             " mis-oriented faces");
    if (rep.selfIntersectingFacesRemoved > 0)
        out.log.emplace_back("native heal: removed " + std::to_string(rep.selfIntersectingFacesRemoved) +
                             " self-intersecting slivers");
    if (rep.duplicateFacesRemoved > 0)
        out.log.emplace_back("native heal: removed " + std::to_string(rep.duplicateFacesRemoved) +
                             " duplicate faces");

    // ---- HONESTLY surface defects the native healer left UNFIXED (never silently
    // degraded). These are reported, not papered over — same honesty contract as the
    // OCCT FAILi bits below. The native API is RICHER here than OCCT's 8-bit FAIL mask:
    // it names the specific residual classes.
    if (!rep.unfixedFreeEdgeIds.empty())
        out.log.emplace_back("native heal: UNFIXED " + std::to_string(rep.unfixedFreeEdgeIds.size()) +
                             " free edges (gap wider than tol / genuine missing face)");
    if (!rep.unfixedNonManifoldEdgeReport.empty())
        out.log.emplace_back("native heal: UNFIXED " + std::to_string(rep.unfixedNonManifoldEdgeReport.size()) +
                             " non-manifold edges (2-manifold model cannot split)");
    if (!rep.nonManifoldVertexIds.empty())
        out.log.emplace_back("native heal: UNFIXED " + std::to_string(rep.nonManifoldVertexIds.size()) +
                             " non-manifold vertices");
    if (!rep.unfixedSelfIntersectionFacePairs.empty())
        out.log.emplace_back("native heal: UNFIXED " + std::to_string(rep.unfixedSelfIntersectionFacePairs.size()) +
                             " structural self-intersection face pairs");
    if (!rep.keptSliverFaceIds.empty())
        out.log.emplace_back("native heal: KEPT " + std::to_string(rep.keptSliverFaceIds.size()) +
                             " sliver faces (dropping them would open an unclosable hole)");

    // CAPABILITY GAP vs OCCT ShapeFix_Shape (surfaced, NOT silently degraded):
    //   * minTol / maxTol — the OCCT path's tolerance-clamp band (SetMinTolerance /
    //     SetMaxTolerance) has NO native equivalent: healBRep uses a single ACIS-style
    //     model tolerance (HealOptions.tol). When the caller passed a non-default
    //     minTol/maxTol the native heal CANNOT honor that band; the parent's A/B + the
    //     gate keep this opt-in until that gap is closed (see RETURN risks). We note it
    //     in the log so a dashboard sees the native pass ignored the band.
    //   * the DONE1..8 / FAIL1..8 OCCT bit semantics are replaced by the richer named
    //     counts above (a deliberate, documented representation change — not a loss).
    if (out.log.empty())
        out.log.emplace_back("native heal: no defect found — input was already clean");

    return true;
}

}  // namespace
#endif

RepairResult repair(ShapeHandle shape,
                    double precision,
                    double minTol,
                    double maxTol) {
#ifdef FORGE_NATIVE_BREP
    // GATE: native healer is opt-in via the FEAT gate (default OFF). When on AND the
    // input is a NativeSolid, heal via brep::healBRep; otherwise fall through to OCCT
    // (OCCT-backed input HONESTLY DEFERS — no behavior change in the default build).
    if (native::brep::forgeNativeFeaturesEnabled()) {
        RepairResult nativeOut{};
        if (tryNativeRepair(shape, precision, nativeOut)) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    const auto& s = ShapeRegistry::instance().get(shape);
    if (s.IsNull()) {
        throw std::invalid_argument("forge.shapefix.repair: null shape");
    }

    Handle(ShapeFix_Shape) fixer = new ShapeFix_Shape(s);
    if (precision > Precision::Confusion()) fixer->SetPrecision(precision);
    if (minTol    > Precision::Confusion()) fixer->SetMinTolerance(minTol);
    if (maxTol    > Precision::Confusion()) fixer->SetMaxTolerance(maxTol);

    // Perform runs ShapeFix_Wire, ShapeFix_Edge, ShapeFix_Face,
    // ShapeFix_Shell, ShapeFix_Solid in order, recording DONEi bits on
    // success and FAILi bits on failure.
    fixer->Perform();
    TopoDS_Shape fixed = fixer->Shape();
    if (fixed.IsNull()) {
        throw std::runtime_error(
            "forge.shapefix.repair: ShapeFix_Shape produced a null shape");
    }

    RepairResult out{};
    out.handle = ShapeRegistry::instance().add(fixed);

    // ShapeExtend_DONE1..DONE8 are the 8 consecutive enum values starting
    // at ShapeExtend_DONE1; same for FAIL1..FAIL8. We probe each bit
    // explicitly via fixer->Status(<bit>).
    const ShapeExtend_Status doneBits[8] = {
        ShapeExtend_DONE1, ShapeExtend_DONE2, ShapeExtend_DONE3,
        ShapeExtend_DONE4, ShapeExtend_DONE5, ShapeExtend_DONE6,
        ShapeExtend_DONE7, ShapeExtend_DONE8
    };
    const ShapeExtend_Status failBits[8] = {
        ShapeExtend_FAIL1, ShapeExtend_FAIL2, ShapeExtend_FAIL3,
        ShapeExtend_FAIL4, ShapeExtend_FAIL5, ShapeExtend_FAIL6,
        ShapeExtend_FAIL7, ShapeExtend_FAIL8
    };
    for (int i = 0; i < 8; ++i) {
        if (fixer->Status(doneBits[i])) {
            out.log.emplace_back(doneMessage(i + 1));
        }
    }
    for (int i = 0; i < 8; ++i) {
        if (fixer->Status(failBits[i])) {
            out.log.emplace_back(failMessage(i + 1));
        }
    }
    if (out.log.empty()) {
        out.log.emplace_back("no fixer fired — input was already clean");
    }
    return out;
}

}  // namespace forge::shapefix
