#include "forge/Healing.hpp"

// ── TKShHealing P1 (2026-07-31) ──────────────────────────────────────────────
// FORGE_HEAL_NATIVE_BCD is the single condition under which this file's
// ShapeFix_Solid / ShapeAnalysis_Shell / ShapeAnalysis_FreeBounds call sites run on
// the in-house forge::occtheal peers and the OCCT fallback is COMPILED OUT (so the
// 8 symbols leave the binary). It requires BOTH the native B-rep layer and the drop
// option; CMake only defines FORGE_SHHEAL_DROP_NATIVE when FORGE_NATIVE_BREP is on,
// but the belt-and-braces conjunction keeps a hand-driven -D from producing a build
// that selects the native branch without the header that declares it.
// Scoring note: this is a SYMBOL-SURFACE reduction (TKShHealing 20 -> 12), NOT a
// library drop. OCCT_CLOSURE stays 14 — TKFillet/TKOffset/TKBO/TKBool all DT_NEED
// libTKShHealing. See CMakeLists.txt (FORGE_SHHEAL_DROP_NATIVE) and
// reports/OCCT_CLOSURE_TRUTH.md.
#if defined(FORGE_NATIVE_BREP) && defined(FORGE_SHHEAL_DROP_NATIVE)
#define FORGE_HEAL_NATIVE_BCD 1
#endif

#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#ifndef FORGE_FILLING_DROP_NATIVE
// TKOffset family C header — referenced ONLY by the OCCT baseline path, which is
// compiled out under -DFORGE_FILLING_DROP_NATIVE. Guarding the include keeps the
// drop build from pulling any BRepOffsetAPI_MakeFilling declaration (and hence its
// vtable reference) into the TU.
#include <BRepOffsetAPI_MakeFilling.hxx>
#endif
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
// DEAD INCLUDES REMOVED 2026-07-31 (verified 0 uses in this TU by grep):
//   ShapeAnalysis_ShapeContents.hxx, ShapeAnalysis_ShapeTolerance.hxx,
//   ShapeFix_ShapeTolerance.hxx.  No symbol effect — they contributed no import.
#ifndef FORGE_HEAL_NATIVE_BCD
// OCCT baseline for groups B/C/D — compiled out when the native peers are wired.
#include <ShapeAnalysis_FreeBounds.hxx>
#include <ShapeAnalysis_Shell.hxx>
#include <ShapeFix_Solid.hxx>
#endif
// Groups A (ShapeFix_Shape, :488/:517) and E (ShapeUpgrade_UnifySameDomain, :387)
// are NOT part of P1 and always link: A is shared with StepReadOcct.cpp:1581 (moving
// this file's A-sites alone buys 0 symbols) and E needs a general OCCT-shape unify
// that does not exist yet (Law 9 forbids dropping the capability instead).
#include <ShapeFix_Shape.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Wire.hxx>

#include <stdexcept>

// PHASE-D wiring (2026-06-25) — route the shape-healing pipeline through the ALREADY-BUILT,
// A/B-certified native B-rep modules behind the FEAT gate. Compiled in ONLY under
// -DFORGE_NATIVE_BREP and taken at runtime ONLY when forgeNativeFeaturesEnabled() is true
// (env FORGE_NATIVE_FEATURES=1, or the A/B harness's setForgeNativeBrepEnabled(true)).
// PRODUCTION DEFAULT IS OFF: with the gate off the original OCCT paths below run
// byte-for-byte unchanged. Mirrors the just-landed wires:
//   * ShapeFix.cpp  (commit 8d5f2ae1) — forge::shapefix::repair -> healBRep. THIS IS THE
//     CANONICAL TEMPLATE; tryNativeHeal below reuses its cloneFaceIndependent +
//     deferral + HealReport->log mapping idiom VERBATIM.
//   * Sewing.cpp    (commit 19840b66) — forge::sewing::sew    -> sewFaces.
//
// TWO of this file's five entries have a native equivalent and are wired:
//   (A) autoRepairSelfIntersection — the OCCT ShapeFix_Shape heal entry. The native
//       healBRep (Heal.cpp) is the in-house ShapeFix_Shape/ShapeFix_Wire/ShapeUpgrade_*
//       replacement; its 5 core + 3 harder passes map onto RepairReport's flags.
//   (B) sewShape                   — the OCCT BRepBuilderAPI_Sewing entry. The native
//       sewFaces (Sew.cpp) is the in-house BRepBuilderAPI_Sewing replacement; its
//       SewDiagnosis maps onto SewReport's before/after counters.
// Both take the native branch when the input handle is a NativeSolid (so its faces can be
// decomposed into independent fragments and re-healed/re-sewn), OR — PHASE-D ACTIVATION
// (2026-06-25) — when it is an OCCT-backed (ShapeKind::Occt) analytic solid, by IMPORTING
// it to a native Solid via forge::importOcctSolid (src/OcctImport.cpp) and decomposing the
// imported faces. A clean analytic OCCT solid (box / bored box / fillet) thus heals + sews
// natively; an import that DEFERS (ok==false: Torus/Revolution/non-analytic / non-manifold)
// HONESTLY falls through to OCCT.
//
// THE THREE ENTRIES LEFT ON OCCT — CAPABILITY GAPS surfaced, NOT silently degraded:
//   * simplifyShape (ShapeUpgrade_UnifySameDomain) — face/edge UNIFICATION (merge
//     co-planar adjacent faces / co-linear edges, B-spline concatenation) has NO native
//     equivalent in the brep/ suite (no native ShapeUpgrade_UnifySameDomain). LEFT ON
//     OCCT. (See KERNEL_PARITY follow-up.)
//   * autoFillMissingFaces (BRepOffsetAPI_MakeFilling) — PARTLY NATIVE since 2026-08-28
//     (TKOffset family C, forge::occtfill::fillC0Boundary). The note below was written
//     when the only native option was healBRep's gap-fill, which merely SNAPS free-edge
//     endpoints and never fabricates a cap; wiring THAT here would indeed have silently
//     degraded wide-gap capping to a no-op. What changed is the observation that this
//     call site adds every boundary edge with GeomAbs_C0 and adds nothing else, so for a
//     PLANAR free wire the requested patch is exactly the plane region the wire encloses
//     — an exact analytic answer, no synthesis required, and MEASURABLY more accurate
//     than OCCT's B-spline plate (area exact vs 6.2e-7 relative error on a circular
//     boundary; see NativeFilling.hpp). A NON-planar free wire still needs a genuine
//     N-sided patch and is HONESTLY DEFERRED — SurfaceFill.cpp is 4-sided and G1, so it
//     does not fit this pipeline, and that remains the documented follow-up.
//   * harmonizeNormals — runs OCCT ShapeFix_Shape + ShapeAnalysis_Shell for outward
//     orientation; healBRep pass (6) does native orientation repair, but harmonizeNormals
//     returns a bare ShapeHandle (no report) and is a narrow orientation-only entry; it is
//     LEFT ON OCCT to keep this slice scoped to the two report-bearing heal entries that
//     match the canonical ShapeFix.cpp/Sewing.cpp templates 1:1. (Documented follow-up.)
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled()
// TKShHealing P1 peers — occtheal::{freeBounds, orientSolidOutward, solidFromShell,
// shellOrientationConsistent}. UNCONDITIONAL (not behind forgeNativeFeaturesEnabled):
// these four are exact replacements for what their call sites consume, so they are the
// production path, not an opt-in experiment.
#include "forge/native/brep/NativeFilling.hpp"     // TKOffset family C: C0 boundary fill
#include "forge/native/brep/NativeShapeHeal.hpp"
#include "forge/native/brep/Heal.hpp"          // healBRep, HealOptions, HealReport (native)
#include "forge/native/brep/Sew.hpp"           // sewFaces, SewOptions, SewResult, diagnoseShell (native)
#include "forge/native/brep/Topology.hpp"      // TopologyBuilder, Face/Loop/Coedge/Vertex/Shell/Solid/Surface
#include "forge/OcctImport.hpp"                // importOcctSolid (OCCT analytic -> native Solid)
#include <memory>
#include <unordered_set>
#include <vector>
#endif

namespace forge::heal {

namespace {

std::size_t countSubShapes(const TopoDS_Shape& shape, TopAbs_ShapeEnum kind) {
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(shape, kind, map);
    return static_cast<std::size_t>(map.Extent());
}

bool shapeIsClosedSolid(const TopoDS_Shape& shape) {
    // A shape counts as a closed solid if at least one TopoDS_Solid lives
    // inside it AND every shell in that solid passes the OCCT closedness
    // check. For a raw shell we just inspect the shell directly.
    for (TopExp_Explorer ex(shape, TopAbs_SOLID); ex.More(); ex.Next()) {
        for (TopExp_Explorer es(ex.Current(), TopAbs_SHELL); es.More(); es.Next()) {
            if (!BRep_Tool::IsClosed(TopoDS::Shell(es.Current()))) return false;
        }
        return true;
    }
    // No solid → check the bare shell.
    for (TopExp_Explorer es(shape, TopAbs_SHELL); es.More(); es.Next()) {
        return BRep_Tool::IsClosed(TopoDS::Shell(es.Current()));
    }
    return false;
}

// Free-boundary edges = edges that are owned by exactly one face in the
// shape's edge→face ancestor map. The ShapeAnalysis_FreeBounds wrapper
// gives us the free wires too, which we need for autoFillMissingFaces.
std::size_t countFreeEdges(const TopoDS_Shape& shape) {
    TopTools_IndexedDataMapOfShapeListOfShape map;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, map);
    std::size_t n = 0;
    for (Standard_Integer i = 1; i <= map.Extent(); ++i) {
        if (map(i).Extent() == 1) ++n;
    }
    return n;
}

} // namespace

#ifdef FORGE_NATIVE_BREP
namespace {

// Deep-clone one native Face (its outer ring vertices + any inner rings + analytic
// surface frame + trim window) into `tb` as an INDEPENDENT fragment with PRIVATE fresh
// vertices/edges — exactly the "N separate STEP ADVANCED_FACE records" import state the
// native healer/sewer (Heal.hpp / Sew.hpp) expect to ingest, so their weld/gap-fill/
// sliver/orientation/non-manifold passes act on the raw fragment soup (NOT on an
// already-sewn shell). This is byte-for-byte ShapeFix.cpp::cloneFaceIndependent (identity
// copy, no transform). Coincident boundaries across the cloned faces stay DISTINCT
// topological entities until healBRep/sewFaces welds + re-sews them.
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
            // PRIVATE fresh vertex per corner (no welding/sharing here): healBRep/sewFaces
            // weld coincident corners across faces themselves.
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
    // healed/sewn quadric face keeps its EXACT parent surface for downstream mass-props.
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

// Gather the cloned INDEPENDENT face fragments of a solid handle into a fresh builder.
// A NativeSolid handle is decomposed directly; PHASE-D ACTIVATION (2026-06-25) — an
// OCCT-backed (ShapeKind::Occt) analytic solid is first IMPORTED into a native Solid via
// forge::importOcctSolid, then its faces are cloned into `owner` (the clone deep-copies
// the vertices + analytic surface, so the import's own TopologyBuilder is needed only for
// the duration of this call and is released on return). Returns false (defer to OCCT) when
// the handle is a NativeMesh, when importOcctSolid DEFERS (ok==false: non-analytic /
// non-manifold), or when no cloneable faces result. Mirrors ShapeFix.cpp's gather.
bool gatherNativeFaces(ShapeHandle shape,
                       std::shared_ptr<native::brep::TopologyBuilder>& owner,
                       std::vector<native::brep::Face*>& faces) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();

    const Solid* sptr = nullptr;
    ImportResult imported;                 // keeps the imported topology alive while cloning
    if (reg.kindOf(shape) == ShapeKind::NativeSolid) {
        sptr = &reg.getNativeSolid(shape);
    } else if (reg.kindOf(shape) == ShapeKind::Occt) {
        imported = importOcctSolid(reg.get(shape));
        if (!imported.ok || imported.solid == nullptr) return false;   // defer to OCCT
        sptr = imported.solid;
    } else {
        return false;                                                  // NativeMesh -> defer
    }

    owner = std::make_shared<TopologyBuilder>();
    const Solid& s = *sptr;
    for (Shell* sh : s.shells) {
        for (Face* sf : sh->faces) {
            if (Face* nf = cloneFaceIndependent(*owner, sf)) faces.push_back(nf);
        }
    }
    return !faces.empty();
}

// Wrap a set of healed/sewn faces' DISTINCT shells into one fresh Solid (so the handle is
// a NativeSolid the registry + downstream native ops understand), preferring each face's
// ->shell back-pointer, falling back to `primary`. Returns false if nothing has a shell.
// Mirrors ShapeFix.cpp's shell-gather.
bool wrapHealedSolid(native::brep::TopologyBuilder& owner,
                     const std::vector<native::brep::Face*>& faces,
                     native::brep::Shell* primary,
                     native::brep::Solid*& solidOut) {
    using namespace forge::native::brep;
    Solid* solid = owner.makeSolid();
    std::unordered_set<Shell*> seen;
    for (Face* f : faces) {
        if (f && f->shell && seen.insert(f->shell).second) owner.addShellToSolid(solid, f->shell);
    }
    if (solid->shells.empty()) {
        if (primary) owner.addShellToSolid(solid, primary);
        else return false;
    }
    solidOut = solid;
    return true;
}

// (A) Try the native heal (brep::healBRep) for autoRepairSelfIntersection. Returns true +
// sets `out` on success; returns false (NEVER throws) when the native path HONESTLY DEFERS
// to OCCT. Same deferral contract as ShapeFix.cpp::tryNativeRepair. Maps the rich native
// HealReport onto forge::heal::RepairReport's flags+count.
bool tryNativeHeal(ShapeHandle shape, double tolerance, RepairResult& out) {
    using namespace forge::native::brep;
    std::shared_ptr<TopologyBuilder> owner;
    std::vector<Face*> faces;
    if (!gatherNativeFaces(shape, owner, faces)) return false;   // defer to OCCT

    HealOptions opt;
    if (tolerance > 0.0) opt.tol = tolerance;
    HealReport rep = healBRep(*owner, faces, opt);
    if (!rep.ok || rep.faces.empty()) return false;              // malformed -> defer

    Solid* solid = nullptr;
    if (!wrapHealedSolid(*owner, rep.faces, rep.shell, solid)) return false;
    out.handle = ShapeRegistry::instance().addNativeSolid(std::move(owner), solid);

    // ---- Map native HealReport -> RepairReport (the OCCT entry's per-fixer booleans) ----
    // OCCT autoRepairSelfIntersection reads ShapeFix DONE1..6:
    //   fixedTolerance        <- vertex-weld (the tolerance/dedup pass, OCCT DONE1)
    //   fixedWires            <- short-edge collapse (loop repair, OCCT DONE2)
    //   fixedSmallFaces       <- sliver-face removal (OCCT DONE3 small-face fix)
    //   fixedOrientation      <- face-orientation flips (OCCT DONE4/5)
    //   fixedSelfIntersection <- self-intersecting sliver removal (OCCT DONE6)
    out.report.fixedTolerance        = (rep.verticesWelded > 0) || (rep.gapsClosed > 0);
    out.report.fixedWires            = (rep.shortEdgesCollapsed > 0) || (rep.edgePairsMerged > 0);
    out.report.fixedSmallFaces       = (rep.sliverFacesRemoved > 0) || (rep.duplicateFacesRemoved > 0);
    out.report.fixedOrientation      = (rep.facesFlipped > 0);
    out.report.fixedSelfIntersection = (rep.selfIntersectingFacesRemoved > 0);
    out.report.fixersFired = (out.report.fixedTolerance        ? 1u : 0u)
                           + (out.report.fixedWires            ? 1u : 0u)
                           + (out.report.fixedSmallFaces       ? 1u : 0u)
                           + (out.report.fixedOrientation      ? 1u : 0u)
                           + (out.report.fixedSelfIntersection ? 1u : 0u);
    // GAP (surfaced, not silently degraded): RepairReport is a fixed 5-bool struct, so the
    // native healer's RICHER honest residuals (rep.unfixedFreeEdgeIds /
    // unfixedSelfIntersectionFacePairs / unfixedNonManifoldEdgeReport / nonManifoldVertexIds
    // / keptSliverFaceIds) have NO field to land in here — they are NOT lost (the structural-
    // self-intersection case stays UNFIXED in the geometry, the booleans only flag what WAS
    // fixed), but a caller wanting the residual ids must use the native Check.cpp/checkValidity
    // path. Documented; never faked to a wrong boolean.
    return true;
}

// (B) Try the native sew (brep::sewFaces) for sewShape. Returns true + sets `out` on
// success; returns false (NEVER throws) when the native path HONESTLY DEFERS. Same
// deferral contract as Sewing.cpp::tryNativeSew. Maps SewDiagnosis onto the SewReport
// before/after counters. The BEFORE signature comes from diagnoseShell on the raw cloned
// fragments (matching the OCCT facesBefore/openEdgesBefore/closedBefore semantics).
bool tryNativeSewShape(ShapeHandle shape, double tolerance, SewResult& out) {
    using namespace forge::native::brep;
    std::shared_ptr<TopologyBuilder> owner;
    std::vector<Face*> faces;
    if (!gatherNativeFaces(shape, owner, faces)) return false;   // defer to OCCT

    // BEFORE signature on the un-sewn fragment soup (independent faces, every boundary
    // edge still free) — same "pile of faces" state OCCT's facesBefore/openEdgesBefore read.
    SewDiagnosis before = diagnoseShell(faces);

    SewOptions sopt;
    if (tolerance > 0.0) sopt.tol = tolerance;
    native::brep::SewResult r = sewFaces(*owner, faces, sopt);
    if (!r.ok) return false;                                     // malformed -> defer

    Solid* solid = owner->makeSolid();
    for (Shell* sh : r.shells) owner->addShellToSolid(solid, sh);
    if (solid->shells.empty()) return false;

    out.handle = ShapeRegistry::instance().addNativeSolid(std::move(owner), solid);
    // EXACT mappings native SewDiagnosis -> forge::heal::SewReport:
    out.report.facesBefore     = before.faces;
    out.report.openEdgesBefore = before.freeEdges;
    out.report.closedBefore    = before.closed;
    out.report.facesAfter      = r.diagnosis.faces;
    out.report.openEdgesAfter  = r.diagnosis.freeEdges;
    out.report.closedAfter     = r.diagnosis.closed;
    return true;
}

} // namespace
#endif

SewResult sewShape(ShapeHandle shape, double tolerance) {
#ifdef FORGE_NATIVE_BREP
    // GATE: native sewer is opt-in via the FEAT gate (default OFF). When on AND the input
    // is a NativeSolid, sew via brep::sewFaces; otherwise fall through to OCCT (OCCT-backed
    // input HONESTLY DEFERS — no behavior change in the default build).
    if (native::brep::forgeNativeFeaturesEnabled()) {
        SewResult nativeOut{};
        if (tryNativeSewShape(shape, tolerance, nativeOut)) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    const auto& s = ShapeRegistry::instance().get(shape);

    SewReport rep{};
    rep.facesBefore     = countSubShapes(s, TopAbs_FACE);
    rep.openEdgesBefore = countFreeEdges(s);
    rep.closedBefore    = shapeIsClosedSolid(s);

    BRepBuilderAPI_Sewing tool(tolerance);
    tool.Add(s);
    tool.Perform();
    TopoDS_Shape sewn = tool.SewedShape();

    // Try to upgrade the sewn shell to a closed solid where possible.
    TopoDS_Shape result = sewn;
    if (sewn.ShapeType() == TopAbs_SHELL) {
        TopoDS_Shell sh = TopoDS::Shell(sewn);
        if (BRep_Tool::IsClosed(sh)) {
            BRepBuilderAPI_MakeSolid mk(sh);
            if (mk.IsDone()) {
                result = mk.Solid();
            }
        }
    }

    rep.facesAfter     = countSubShapes(result, TopAbs_FACE);
    rep.openEdgesAfter = countFreeEdges(result);
    rep.closedAfter    = shapeIsClosedSolid(result);

    return { ShapeRegistry::instance().add(result), rep };
}

SimplifyResult simplifyShape(ShapeHandle shape, const SimplifyOptions& opts) {
    const auto& s = ShapeRegistry::instance().get(shape);

    SimplifyResult out{};
    out.facesBefore = countSubShapes(s, TopAbs_FACE);
    out.edgesBefore = countSubShapes(s, TopAbs_EDGE);

    ShapeUpgrade_UnifySameDomain unify(s, opts.unifyEdges, opts.unifyFaces,
                                       opts.concatBSplines);
    unify.SetAngularTolerance(opts.angularTol);
    unify.Build();
    TopoDS_Shape simplified = unify.Shape();

    out.handle      = ShapeRegistry::instance().add(simplified);
    out.facesAfter  = countSubShapes(simplified, TopAbs_FACE);
    out.edgesAfter  = countSubShapes(simplified, TopAbs_EDGE);
    return out;
}

AutoFillResult autoFillMissingFaces(ShapeHandle shape, double tolerance) {
    const auto& s = ShapeRegistry::instance().get(shape);

    AutoFillReport rep{};
    rep.openEdgesBefore = countFreeEdges(s);

    // Detect free wires (closed loops of free edges) we can cap.
#ifdef FORGE_HEAL_NATIVE_BCD
    // NATIVE (TKShHealing-free) — group D. Free edges = edges with exactly one face
    // ancestor (the ShapeAnalysis_FreeBounds definition, and the same rule
    // countFreeEdges() above already uses), chained by coincident endpoints into
    // closed loops vs open chains. Same contract as
    // ShapeAnalysis_FreeBounds(s, tol, splitClosed=false, splitOpen=false) +
    // GetClosedWires(): no closed wire is split, no open wire is split.
    // `fb` must outlive `closedWires` — it owns the compound.
    const forge::occtheal::FreeBounds fb = forge::occtheal::freeBounds(s, tolerance);
    const TopoDS_Compound& closedWires = fb.closedWires;
#else
    // ShapeAnalysis_FreeBounds returns a compound of wires in OCCT 7.9.
    ShapeAnalysis_FreeBounds analyzer(s, tolerance,
                                      /*splitClosed*/ Standard_False,
                                      /*splitOpen*/   Standard_False);
    const TopoDS_Compound& closedWires = analyzer.GetClosedWires();
#endif

    // For each closed free wire, fit a filling patch and add it to a sewing
    // pile alongside the original shape.
    BRepBuilderAPI_Sewing sew(tolerance);
    sew.Add(s);

    for (TopExp_Explorer wex(closedWires, TopAbs_WIRE); wex.More(); wex.Next()) {
        TopoDS_Wire w = TopoDS::Wire(wex.Current());
#ifdef FORGE_NATIVE_BREP
        // TKOffset family C — TKOffset-free boundary fill. The call site asks for a
        // C0 patch through the boundary and nothing else, which for a PLANAR
        // boundary is exactly the plane region it encloses; the native cap is the
        // analytic Geom_Plane face and is measurably more accurate than OCCT's
        // B-spline plate (see NativeFilling.hpp). A null return is an HONEST DEFER
        // and falls through to the same skip a failed OCCT filling already takes.
        if (::forge::occtfill::fillingNativeEnabled()) {
            const TopoDS_Shape cap = ::forge::occtfill::fillC0Boundary(w, tolerance);
            if (!cap.IsNull()) {
                sew.Add(cap);
                ++rep.facesAdded;
                continue;
            }
        }
#endif
#ifndef FORGE_FILLING_DROP_NATIVE
        try {
            BRepOffsetAPI_MakeFilling filling;
            for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) {
                filling.Add(TopoDS::Edge(ex.Current()), GeomAbs_C0);
            }
            filling.Build();
            if (filling.IsDone()) {
                sew.Add(filling.Shape());
                ++rep.facesAdded;
            }
        } catch (const std::exception&) {
            // Skip wires the filler can't tame — leaves them as residual
            // open edges in the after report.
        } catch (...) {
            // OCCT throws its own non-std exceptions; swallow them too.
        }
#endif  // !FORGE_FILLING_DROP_NATIVE
        // Under FORGE_FILLING_DROP_NATIVE a wire the native engine declined is
        // simply SKIPPED — deliberately NOT an error. That is byte-identical to
        // the path a failed/throwing OCCT filling already takes today, and it is
        // reported honestly: the wire stays a residual open edge and is counted in
        // AutoFillReport.openEdgesAfter with facesAdded left unincremented.
    }

    sew.Perform();
    TopoDS_Shape sewn = sew.SewedShape();

    // Promote to a closed solid if the sewing produced a closed shell.
    TopoDS_Shape result = sewn;
    if (sewn.ShapeType() == TopAbs_SHELL && BRep_Tool::IsClosed(TopoDS::Shell(sewn))) {
        BRepBuilderAPI_MakeSolid mk(TopoDS::Shell(sewn));
        if (mk.IsDone()) {
#ifdef FORGE_HEAL_NATIVE_BCD
            // NATIVE (TKShHealing-free) — group B. The net effect this site consumes
            // from ShapeFix_Solid(solid)->Perform()->Solid() is the OUTWARD
            // orientation (reverse when the signed volume is negative). The input is
            // a solid built from an ALREADY-SEWN closed shell, so per-face
            // orientation inside the shell is already consistent — which is the one
            // extra thing OCCT's Perform() would do. orientSolidOutward never returns
            // null, so the OCCT null-guard collapses.
            const TopoDS_Shape oriented = forge::occtheal::orientSolidOutward(mk.Solid());
            result = oriented.IsNull() ? TopoDS_Shape(mk.Solid()) : oriented;
#else
            // Sanity-check + orient the solid outwards.
            Handle(ShapeFix_Solid) fix = new ShapeFix_Solid(mk.Solid());
            fix->Perform();
            if (fix->Solid().IsNull()) {
                result = mk.Solid();
            } else {
                result = fix->Solid();
            }
#endif
        }
    } else if (sewn.ShapeType() == TopAbs_COMPOUND) {
        // Find a shell inside and try to close it.
        for (TopExp_Explorer ex(sewn, TopAbs_SHELL); ex.More(); ex.Next()) {
            TopoDS_Shell sh = TopoDS::Shell(ex.Current());
            if (BRep_Tool::IsClosed(sh)) {
                BRepBuilderAPI_MakeSolid mk(sh);
                if (mk.IsDone()) {
                    result = mk.Solid();
                    break;
                }
            }
        }
    }

    rep.openEdgesAfter = countFreeEdges(result);
    rep.closedAfter    = shapeIsClosedSolid(result);

    return { ShapeRegistry::instance().add(result), rep };
}

RepairResult autoRepairSelfIntersection(ShapeHandle shape, double tolerance) {
#ifdef FORGE_NATIVE_BREP
    // GATE: native healer is opt-in via the FEAT gate (default OFF). When on AND the input
    // is a NativeSolid, heal via brep::healBRep; otherwise fall through to OCCT (OCCT-backed
    // input HONESTLY DEFERS — no behavior change in the default build). Mirrors ShapeFix.cpp.
    if (native::brep::forgeNativeFeaturesEnabled()) {
        RepairResult nativeOut{};
        if (tryNativeHeal(shape, tolerance, nativeOut)) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    const auto& s = ShapeRegistry::instance().get(shape);

    Handle(ShapeFix_Shape) fixer = new ShapeFix_Shape(s);
    fixer->SetPrecision(tolerance);
    fixer->SetMinTolerance(tolerance * 0.1);
    fixer->SetMaxTolerance(tolerance * 10.0);
    fixer->Perform();
    TopoDS_Shape fixed = fixer->Shape();

    RepairReport rep{};
    // ShapeFix_Shape exposes per-fixer status flags; we summarise here.
    // DONE1..6 are the per-sub-shape "something was fixed" indicators.
    rep.fixedWires       = fixer->Status(ShapeExtend_DONE2);  // wires fixed
    rep.fixedSmallFaces  = fixer->Status(ShapeExtend_DONE3);  // faces fixed
    rep.fixedOrientation = fixer->Status(ShapeExtend_DONE4)
                          || fixer->Status(ShapeExtend_DONE5);
    rep.fixedTolerance   = fixer->Status(ShapeExtend_DONE1);
    rep.fixedSelfIntersection = fixer->Status(ShapeExtend_DONE6);
    rep.fixersFired = (rep.fixedWires ? 1u : 0u)
                    + (rep.fixedSmallFaces ? 1u : 0u)
                    + (rep.fixedOrientation ? 1u : 0u)
                    + (rep.fixedTolerance ? 1u : 0u)
                    + (rep.fixedSelfIntersection ? 1u : 0u);

    return { ShapeRegistry::instance().add(fixed), rep };
}

ShapeHandle harmonizeNormals(ShapeHandle shape) {
    const auto& s = ShapeRegistry::instance().get(shape);
    // ShapeFix_Solid orients faces so the resulting solid has positive
    // volume — equivalent to "outward normals everywhere".
    Handle(ShapeFix_Shape) fixer = new ShapeFix_Shape(s);
    fixer->Perform();
    TopoDS_Shape work = fixer->Shape();

    // For each shell, run ShapeAnalysis_Shell + ShapeFix_Solid for the
    // outward orientation. We don't change face wires.
    for (TopExp_Explorer ex(work, TopAbs_SHELL); ex.More(); ex.Next()) {
        TopoDS_Shell sh = TopoDS::Shell(ex.Current());
#ifdef FORGE_HEAL_NATIVE_BCD
        // NATIVE (TKShHealing-free) — group C. Peer of LoadShells +
        // CheckOrientedShells. The OCCT pair DISCARDED its result here (a diagnostic
        // no-op on `work`), and this branch preserves that behaviour EXACTLY: the
        // capability is re-implemented, not removed (Law 9). occtheal's version
        // returns a real answer (every 2-face edge used with opposite sense), so the
        // native path is strictly richer at zero behavioural risk.
        (void)forge::occtheal::shellOrientationConsistent(sh);
#else
        ShapeAnalysis_Shell ana;
        ana.LoadShells(sh);
        ana.CheckOrientedShells(sh, /*alsofree*/ Standard_True);
#endif
    }

    if (work.ShapeType() == TopAbs_SHELL && BRep_Tool::IsClosed(TopoDS::Shell(work))) {
#ifdef FORGE_HEAL_NATIVE_BCD
        // NATIVE (TKShHealing-free) — group B. Peer of
        // ShapeFix_Solid()->SolidFromShell(shell): BRepBuilderAPI_MakeSolid on the
        // shell + signed-volume outward flip. Returns a null solid only when the
        // shell cannot make one, which is exactly the case the guard below skips.
        TopoDS_Solid solid = forge::occtheal::solidFromShell(TopoDS::Shell(work));
#else
        Handle(ShapeFix_Solid) fs = new ShapeFix_Solid();
        TopoDS_Solid solid = fs->SolidFromShell(TopoDS::Shell(work));
#endif
        if (!solid.IsNull()) {
            work = solid;
        }
    }

    return ShapeRegistry::instance().add(work);
}

ValidityReport checkValidity(ShapeHandle shape) {
    const auto& s = ShapeRegistry::instance().get(shape);

    ValidityReport r{};
    r.isClosed   = shapeIsClosedSolid(s);

    BRepCheck_Analyzer checker(s, Standard_True);
    r.isOriented = checker.IsValid();

    // Manifold-ness: every edge shared by ≤2 faces; non-manifold edge =
    // shared by ≥3 faces.
    TopTools_IndexedDataMapOfShapeListOfShape map;
    TopExp::MapShapesAndAncestors(s, TopAbs_EDGE, TopAbs_FACE, map);
    bool nonManifold = false;
    TopTools_IndexedMapOfShape edgeMap;
    TopExp::MapShapes(s, TopAbs_EDGE, edgeMap);
    for (Standard_Integer i = 1; i <= map.Extent(); ++i) {
        const auto& neigh = map(i);
        if (neigh.Extent() > 2) {
            nonManifold = true;
            // Record bad edge index in BREP order.
            const auto& edgeShape = map.FindKey(i);
            r.badEdges.push_back(static_cast<std::uint32_t>(edgeMap.FindIndex(edgeShape)));
        }
    }
    r.hasNonManifoldEdge = nonManifold;
    r.isManifold = !nonManifold;

    // Self-intersection: ShapeAnalysis_Shell reports it. As a low-cost
    // proxy, mass properties on a closed solid should be positive; a
    // negative-volume solid is a strong signal of intersection.
    if (r.isClosed) {
        GProp_GProps p;
        BRepGProp::VolumeProperties(s, p);
        r.hasSelfIntersect = (p.Mass() < 0.0);
    }

    // Bad faces: any face the BRepCheck_Analyzer flagged.
    TopTools_IndexedMapOfShape faceMap;
    TopExp::MapShapes(s, TopAbs_FACE, faceMap);
    for (Standard_Integer i = 1; i <= faceMap.Extent(); ++i) {
        if (!checker.IsValid(faceMap(i))) {
            r.badFaces.push_back(static_cast<std::uint32_t>(i));
        }
    }
    return r;
}

} // namespace forge::heal
