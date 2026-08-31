// forge/native/brep/NativeShapeHealBridge.cpp
//
// R4 (bridge) — implementation of forge::occtheal::fixShapeGeneral (see
// NativeShapeHealBridge.hpp for the full scope / honesty / follow-up notes). This TU
// COMPOSES three already-gate-proven stages into one TopoDS->TopoDS rich-repair
// function so the OCCT ShapeFix_Shape general-repair sites can go native. It links
// ZERO TKShHealing symbols: importOcctSolid, healBRep and occtFromNativeSolid all use
// only surviving toolkits (TKMath/TKG3d/TKBRep/TKTopAlgo/TKPrim + native math).
//
// Compiled ONLY under FORGE_NATIVE_BREP.

#include "forge/native/brep/NativeShapeHealBridge.hpp"

#ifdef FORGE_NATIVE_BREP

#include <memory>
#include <string>
#include <unordered_set>
#include <vector>

#include <TopoDS_Shape.hxx>

#include "forge/OcctImport.hpp"                 // importOcctSolid, ImportResult
#include "forge/NativeOcctBridge.hpp"           // occtFromNativeSolid
#include "forge/native/brep/Heal.hpp"           // healBRep, HealOptions, HealReport
#include "forge/native/brep/Topology.hpp"       // TopologyBuilder, Solid/Shell/Face/Loop/Coedge/Vertex/Surface
#include "forge/native/brep/Surface.hpp"        // SurfaceKind (planar-vs-curved classification)

namespace forge {
namespace occtheal {

namespace {

using namespace forge::native::brep;

// Deep-clone one native Face (outer ring vertices + inner rings + analytic surface
// frame + trim window) into `tb` as an INDEPENDENT fragment with PRIVATE fresh
// vertices/edges — the "N separate ADVANCED_FACE records" fragment-soup state the
// native healer (Heal.hpp) ingests (its weld/gap-fill/sliver/orientation/non-manifold
// passes act on the raw soup, not an already-sewn shell). This is byte-for-byte the
// clone tryNativeRepair (ShapeFix.cpp:95) and Sewing.cpp::cloneFaceIndependent use;
// mirrored here (not shared) so this bridge lands as a self-contained NEW TU. The
// serial integrator can later factor ONE shared cloneFaceIndependent — flagged.
Face* cloneFaceIndependent(TopologyBuilder& tb, const Face* sf) {
    Loop* lp = sf->outerLoop;
    if (!lp || lp->coedgeCount < 3) return nullptr;

    auto ringOf = [&](const Loop* loop) -> std::vector<Vertex*> {
        std::vector<Vertex*> ring;
        if (!loop || loop->coedgeCount < 3) return ring;
        ring.reserve(loop->coedgeCount);
        Coedge* c = loop->first;
        for (std::size_t i = 0; i < loop->coedgeCount && c != nullptr; ++i) {
            Vertex* o = c->originVertex();
            // PRIVATE fresh vertex per corner: healBRep welds coincident corners across
            // faces itself (its (4) weld + (1) gap-fill pass), so DO NOT share here.
            if (o) ring.push_back(tb.makeVertex(o->point));
            c = c->next;
        }
        return ring;
    };

    std::vector<Vertex*> outer = ringOf(lp);
    if (outer.size() < 3) return nullptr;

    Face* nf = tb.makeFace();
    tb.addOuterLoopToFace(nf, outer);
    for (Loop* il : sf->innerLoops) {
        std::vector<Vertex*> inner = ringOf(il);
        if (inner.size() >= 3) tb.addInnerLoopToFace(nf, inner);
    }

    // Carry the analytic surface frame + trim window verbatim (identity clone). NOTE:
    // healBRep's rebuild (Heal.cpp:537) currently DROPS this on the rebuilt output
    // face, so it survives only up to the heal — the export then facets curved faces.
    // Kept here regardless so a future surface-preserving rebuild is a drop-in win.
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

// A body exports LOSSLESSLY through occtFromNativeSolid's planar-simple path only when
// every face is a hole-free plane (bare healed faces => the analytic reconstructors,
// which key off face->surface, decline => faceted fallback for anything curved/holed).
// So classify the IMPORTED source up front: any curved or holed face means a *changed*
// heal will facet. Honest fidelity flag, computed before the clone perturbs anything.
bool bodyIsCurvedOrHoled(const Solid* src) {
    for (Shell* sh : src->shells) {
        if (!sh) continue;
        for (Face* f : sh->faces) {
            if (!f) continue;
            if (!f->innerLoops.empty()) return true;
            if (f->surface && f->surface->kind != SurfaceKind::Plane) return true;
        }
    }
    return false;
}

}  // namespace

TopoDS_Shape fixShapeGeneral(const TopoDS_Shape& shape,
                             double precision,
                             double maxTol,
                             GeneralFixReport* report) {
    GeneralFixReport local;
    GeneralFixReport& r = report ? *report : local;

    if (shape.IsNull()) {
        r.reason = "null input shape";
        return shape;
    }

    // -- STAGE 1: import the OCCT analytic shape into a native brep::Solid. ----------
    // ok=false on: SurfaceOfRevolution / OffsetSurface / OtherSurface (honest analytic
    // defers) OR the 2-manifold pre-check (open shell / gaps / duplicated edge) — i.e.
    // exactly the broken inputs a rich repair targets. Either way => DEFER to input.
    ImportResult ir;
    try {
        ir = importOcctSolid(shape);
    } catch (...) {
        r.reason = "importOcctSolid threw";
        return shape;
    }
    if (!ir.ok || ir.solid == nullptr) {
        r.reason = ir.reason.empty()
                       ? "importOcctSolid deferred (non-analytic or not a closed 2-manifold)"
                       : ("import deferred: " + ir.reason);
        return shape;   // no native solid to heal -> OCCT fallback stays authoritative
    }
    r.imported = true;
    const bool curvedOrHoled = bodyIsCurvedOrHoled(ir.solid);

    // -- STAGE 2: clone the imported faces into a fresh fragment soup + heal. --------
    auto owner = std::make_shared<TopologyBuilder>();
    std::vector<Face*> faces;
    for (Shell* sh : ir.solid->shells) {
        if (!sh) continue;
        for (Face* sf : sh->faces) {
            if (Face* nf = cloneFaceIndependent(*owner, sf)) faces.push_back(nf);
        }
    }
    if (faces.empty()) {
        r.reason = "no cloneable faces in imported solid";
        return shape;
    }

    HealOptions opt;
    double prec = precision;
    if (maxTol > 0.0 && prec > maxTol) prec = maxTol;   // parity clamp (no min/max BAND)
    if (prec > 0.0) opt.tol = prec;

    HealReport hp;
    try {
        hp = healBRep(*owner, faces, opt);
    } catch (...) {
        r.reason = "healBRep threw";
        return shape;
    }
    if (!hp.ok || hp.faces.empty()) {
        r.reason = hp.ok ? "healBRep produced no surviving faces" : "healBRep: malformed input";
        return shape;
    }
    r.healed = true;

    // mirror the counts + residuals for the caller's DONE/FAIL synthesis.
    r.verticesWelded          = hp.verticesWelded;
    r.gapsClosed              = hp.gapsClosed;
    r.shortEdgesCollapsed     = hp.shortEdgesCollapsed;
    r.sliverFacesRemoved      = hp.sliverFacesRemoved;
    r.edgePairsMerged         = hp.edgePairsMerged;
    r.facesFlipped            = hp.facesFlipped;
    r.selfIntersectingRemoved = hp.selfIntersectingFacesRemoved;
    r.duplicateFacesRemoved   = hp.duplicateFacesRemoved;
    r.unfixedFreeEdges        = hp.unfixedFreeEdgeIds.size();
    r.unfixedNonManifoldEdges = hp.unfixedNonManifoldEdgeReport.size();

    r.changed = (hp.verticesWelded + hp.gapsClosed + hp.shortEdgesCollapsed +
                 hp.sliverFacesRemoved + hp.edgePairsMerged + hp.facesFlipped +
                 hp.selfIntersectingFacesRemoved + hp.duplicateFacesRemoved) > 0;

    // CLEAN INPUT: heal applied nothing -> return the ORIGINAL OCCT shape UNTOUCHED.
    // Never round-trip a clean shape through the faceting export (that would silently
    // degrade a valid analytic body); the OCCT ShapeFix_Shape no-op behaviour is to
    // return the input essentially unchanged, and this matches it losslessly.
    if (!r.changed) {
        r.reason = "input already clean (no fix applied) — returned unchanged";
        return shape;
    }

    // -- STAGE 3: wrap the healed faces into a Solid and export back to OCCT. --------
    Solid* solid = owner->makeSolid();
    std::unordered_set<Shell*> seen;
    for (Face* f : hp.faces) {
        if (f && f->shell && seen.insert(f->shell).second) {
            owner->addShellToSolid(solid, f->shell);
        }
    }
    if (solid->shells.empty()) {
        if (hp.shell) owner->addShellToSolid(solid, hp.shell);
        else { r.reason = "healed faces carried no shell to export"; return shape; }
    }

    TopoDS_Shape out;
    try {
        out = occtFromNativeSolid(*solid);
    } catch (...) {
        // occtFromNativeSolid throws on a malformed solid / OCCT read failure. Honest
        // DEFER: return the input rather than a wrong shape.
        r.reason = "occtFromNativeSolid could not materialise the healed solid";
        return shape;
    }
    if (out.IsNull()) {
        r.reason = "occtFromNativeSolid returned a null shape";
        return shape;
    }
    r.exported = true;
    r.faceted  = curvedOrHoled;   // a changed heal of a curved/holed body facets on export
    if (r.faceted) {
        r.reason = "repaired, but curved/holed geometry FACETED on export "
                   "(heal-rebuild drops analytic surfaces — see follow-up §A)";
    }
    return out;
}

// ===========================================================================
// PER-CALL-SITE WIRING PLAN (serial integrator applies; this TU edits NO call site).
// Each keeps the existing OCCT ShapeFix_Shape path under the SAME FORGE_NATIVE_BREP +
// forgeNativeFeaturesEnabled() gate the two rich sites already use, so a red corpus
// gate (Models-OS 13/13) reverts instantly by flipping the gate OFF.
//
// PRIMARY TARGETS — the RICH general-repair sites (the TKShHealing keystone blockers):
//
//   ShapeFix.cpp:295  forge::shapefix::repair(...)
//     The native branch already exists: tryNativeRepair (ShapeFix.cpp:147) imports +
//     heals into a NativeSolid HANDLE. It does NOT export back to OCCT — so when the
//     registry ultimately needs a TopoDS (ShapeRegistry::get on the healed handle) it
//     relies on occtFromNativeSolid lazily anyway. This bridge is the SAME pipe made
//     TopoDS->TopoDS. To DROP the symbol here, replace the OCCT fallback body
//     (`new ShapeFix_Shape(s); ... fixer->Perform(); fixer->Shape()`, lines ~294-303)
//     with:
//         forge::occtheal::GeneralFixReport gr;
//         TopoDS_Shape fixed = forge::occtheal::fixShapeGeneral(s, precision, maxTol, &gr);
//         out.handle = ShapeRegistry::instance().add(fixed);
//         // synthesise the DONE log from gr (welds/gaps/flips/... -> doneMessage(i)),
//         // and if !gr.changed emit "no fixer fired — input already clean".
//     GATE: leave this under `if (forgeNativeFeaturesEnabled())` with the OCCT
//     ShapeFix_Shape path as the #else, until the corpus gate is green with it ON by
//     default AND the two IMPORT/EXPORT residuals below are closed. Only then delete
//     the OCCT branch (that is the actual TKShHealing symbol drop for this file).
//
//   Healing.cpp:488  autoRepairSelfIntersection(...)
//     Same shape: tryNativeHeal is wired ahead behind the gate. Replace the OCCT
//     fallback `new ShapeFix_Shape(s); SetPrecision/Min/MaxTolerance; Perform();
//     Shape()` (lines ~487-499) with `fixShapeGeneral(s, tolerance, tolerance*10.0,
//     &gr)` and map gr -> RepairReport (fixedTolerance<-welds/gaps, fixedOrientation
//     <-facesFlipped, fixedSelfIntersection<-selfIntersectingRemoved, fixedWires
//     <-edgePairsMerged, fixedSmallFaces<-sliverFacesRemoved). Same gate discipline.
//
//   Healing.cpp:517 harmonizeNormals + StepReadOcct.cpp:1570 + DirectEdit.cpp:57 +
//   DirectModeling.cpp:505/552/600/698
//     These are LIGHT-heal sites (defensive post-boolean / post-transfer Perform with
//     no status reads). Prefer NativeShapeHeal.cpp::finalizeShape (surface-preserving,
//     no faceting) for them — do NOT route them through fixShapeGeneral, whose faceting
//     export is only acceptable where a genuine structural repair is worth it. (These
//     already have finalizeShape wiring in NativeShapeHeal.cpp's plan.)
//
// FOLLOW-UPS REQUIRED FOR A LOSSLESS, COMPLETE DROP (honest — NOT done here):
//   §A  SURFACE-PRESERVING HEAL REBUILD. Heal.cpp:537's rebuildAndSew mints bare
//       faces; carry the source face's `surface`/u0..v1/vertexUV onto each rebuilt
//       Face so occtFromNativeSolid's analytic reconstructors keep cylinders/spheres/
//       tori/NURBS EXACT instead of faceting. Until then fixShapeGeneral facets a
//       *changed* curved body (report.faceted=true) — acceptable only where the input
//       was going to be re-tessellated anyway.
//   §B  LENIENT FACE-SOUP IMPORTER. importOcctSolid's 2-manifold gate (OcctImport.cpp
//       :1428/1485) rejects the OPEN / gapped / self-intersecting shells that are the
//       whole reason a rich repair runs. Add importOcctFaceSoup(shape) that emits the
//       cloned face fragments WITHOUT the 2-manifold gate (walk each TopoDS_Face's
//       outer+inner wires; planar faces -> ring polygons directly; curved faces ->
//       native tessellation of the trimmed (u,v) region), so healBRep can WELD/gap-fill/
//       close them. Without §B, fixShapeGeneral can only heal shapes that already
//       import clean (weld/orient/dedup residual defects) — it cannot rescue a
//       genuinely-broken shell, so the OCCT fallback must remain for those.
//   §C  MIN/MAX TOLERANCE BAND. SetMinTolerance/SetMaxTolerance has no native analogue
//       (healBRep uses one ACIS-style tol). Surfaced in the report; a banded native
//       heal is a separate increment.
//
// DROPPABILITY VERDICT (honest): TKShHealing is NOT yet droppable via this bridge
// alone. This file makes the rich sites' native path REAL and TopoDS-complete, but a
// clean symbol drop needs §A (no faceting regression on curved bodies) AND §B (rich
// repair actually reaching the broken inputs it is called on). With §A+§B the OCCT
// ShapeFix_Shape fallback can be deleted; without them, keep it gated.
//
// CMake: add BOTH
//     src/native/brep/NativeShapeHeal.cpp        (R4 light subset — not yet listed)
//     src/native/brep/NativeShapeHealBridge.cpp  (this file)
//   to the forge_kernel source list next to src/native/brep/Heal.cpp (~CMakeLists:662).
//   This TU is #ifdef FORGE_NATIVE_BREP internally, so listing it unconditionally is
//   safe (empty TU in a pure-OCCT build).
// ===========================================================================

}  // namespace occtheal
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
