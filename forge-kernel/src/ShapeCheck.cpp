// PUSH-18 — Full BRepCheck_Analyzer wrapper.
//
// Walks every sub-shape kind (solid → shell → face → wire → edge → vertex),
// asks the analyser whether each sub-shape is valid, and for those that
// aren't pulls the BRepCheck_Result status list and translates each
// BRepCheck_Status enum into a human-readable string.

#include "forge/ShapeCheck.hpp"

#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_ListOfStatus.hxx>
#include <BRepCheck_Result.hxx>
#include <BRepCheck_Status.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>

#include <sstream>
#include <stdexcept>

// PHASE-D wiring step #3 (2026-06-25) — route forge::shapecheck::analyse through the
// ALREADY-BUILT, A/B-certified native VALIDATOR (forge::native::brep::checkBRep —
// Check.cpp, the in-house BRepCheck_Analyzer replacement, the "BRepCheck-class" K5/H1.1
// oracle) behind a GATE. Compiled in ONLY under -DFORGE_NATIVE_BREP and taken at runtime
// ONLY when the FEAT gate forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1,
// or the A/B harness's setForgeNativeBrepEnabled(true), which flips CORE+FEAT+STEP together).
// PRODUCTION DEFAULT IS OFF: with the gate off, the original OCCT BRepCheck_Analyzer path
// below runs byte-for-byte unchanged.
//
// PHASE-D ACTIVATION (2026-06-25, winding reconciliation): this wire now takes the native
// path on BOTH a NativeSolid AND an OCCT-backed (ShapeKind::Occt) analytic solid — the
// latter by importing it via forge::importOcctSolid (src/OcctImport.cpp) and running the
// native predicate battery on the imported native Solid. This was previously BLOCKED: the
// native validator's O2.OuterLoopCCW (BadOrientationCCW) predicate measured each outer
// loop's signed PARAMETER-SPACE area against the surface's NATURAL normal (S_u x S_v),
// ignoring the `reversed` flag — so it false-flagged EVERY face whose outward normal is
// -(S_u x S_v) (reversed==true), which is the convention BOTH the importer AND Boolean.cpp
// emit. A plain imported box therefore reported valid=false while OCCT reported valid=true.
// O2 is now reversed-aware (it measures the loop sign against the OUTWARD normal — see
// Check.cpp O2), so checkBRep(imported solid) == OCCT's verdict for analytic solids
// (verified: box + bored box native valid=TRUE matching OCCT — native_occt_import_test).
// HONEST DEFERRAL still applies: an OCCT input whose importOcctSolid defers (NURBS/Torus/
// non-analytic faces) falls through to the OCCT BRepCheck_Analyzer path unchanged, as does
// a NativeMesh handle. NOTHING about the default (gate-OFF) build changes.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled()
#include "forge/native/brep/Check.hpp"         // checkBRep, CheckOptions, CheckReport (native)
#include "forge/native/brep/Topology.hpp"      // Solid (for getNativeSolid)
#include "forge/OcctImport.hpp"                // importOcctSolid (OCCT analytic -> native Solid)
#include <memory>                              // shared_ptr (keep imported topology alive)
#endif

namespace forge::shapecheck {

namespace {

const char* statusName(BRepCheck_Status s) {
    switch (s) {
        case BRepCheck_NoError:                       return "NoError";
        case BRepCheck_InvalidPointOnCurve:           return "InvalidPointOnCurve";
        case BRepCheck_InvalidPointOnCurveOnSurface:  return "InvalidPointOnCurveOnSurface";
        case BRepCheck_InvalidPointOnSurface:         return "InvalidPointOnSurface";
        case BRepCheck_No3DCurve:                     return "No3DCurve";
        case BRepCheck_Multiple3DCurve:               return "Multiple3DCurve";
        case BRepCheck_Invalid3DCurve:                return "Invalid3DCurve";
        case BRepCheck_NoCurveOnSurface:              return "NoCurveOnSurface";
        case BRepCheck_InvalidCurveOnSurface:         return "InvalidCurveOnSurface";
        case BRepCheck_InvalidCurveOnClosedSurface:   return "InvalidCurveOnClosedSurface";
        case BRepCheck_InvalidSameRangeFlag:          return "InvalidSameRangeFlag";
        case BRepCheck_InvalidSameParameterFlag:      return "InvalidSameParameterFlag";
        case BRepCheck_InvalidDegeneratedFlag:        return "InvalidDegeneratedFlag";
        case BRepCheck_FreeEdge:                      return "FreeEdge";
        case BRepCheck_InvalidMultiConnexity:         return "InvalidMultiConnexity";
        case BRepCheck_InvalidRange:                  return "InvalidRange";
        case BRepCheck_EmptyWire:                     return "EmptyWire";
        case BRepCheck_RedundantEdge:                 return "RedundantEdge";
        case BRepCheck_SelfIntersectingWire:          return "SelfIntersectingWire";
        case BRepCheck_NoSurface:                     return "NoSurface";
        case BRepCheck_InvalidWire:                   return "InvalidWire";
        case BRepCheck_RedundantWire:                 return "RedundantWire";
        case BRepCheck_IntersectingWires:             return "IntersectingWires";
        case BRepCheck_InvalidImbricationOfWires:     return "InvalidImbricationOfWires";
        case BRepCheck_EmptyShell:                    return "EmptyShell";
        case BRepCheck_RedundantFace:                 return "RedundantFace";
        case BRepCheck_InvalidImbricationOfShells:    return "InvalidImbricationOfShells";
        case BRepCheck_UnorientableShape:             return "UnorientableShape";
        case BRepCheck_NotClosed:                     return "NotClosed";
        case BRepCheck_NotConnected:                  return "NotConnected";
        case BRepCheck_SubshapeNotInShape:            return "SubshapeNotInShape";
        case BRepCheck_BadOrientation:                return "BadOrientation";
        case BRepCheck_BadOrientationOfSubshape:      return "BadOrientationOfSubshape";
        case BRepCheck_InvalidPolygonOnTriangulation: return "InvalidPolygonOnTriangulation";
        case BRepCheck_InvalidToleranceValue:         return "InvalidToleranceValue";
        case BRepCheck_EnclosedRegion:                return "EnclosedRegion";
        case BRepCheck_CheckFail:                     return "CheckFail";
    }
    return "UnknownStatus";
}

const char* shapeKindName(TopAbs_ShapeEnum k) {
    switch (k) {
        case TopAbs_COMPOUND:  return "compound";
        case TopAbs_COMPSOLID: return "compsolid";
        case TopAbs_SOLID:     return "solid";
        case TopAbs_SHELL:     return "shell";
        case TopAbs_FACE:      return "face";
        case TopAbs_WIRE:      return "wire";
        case TopAbs_EDGE:      return "edge";
        case TopAbs_VERTEX:    return "vertex";
        case TopAbs_SHAPE:     return "shape";
    }
    return "unknown";
}

void collectFaultsFor(const BRepCheck_Analyzer& chk,
                      const TopoDS_Shape& parent,
                      const TopoDS_Shape& sub,
                      std::size_t index,
                      std::vector<std::string>& out) {
    if (chk.IsValid(sub)) return;
    // Pull the per-sub-shape status list from the analyser.
    Handle(BRepCheck_Result) res = chk.Result(sub);
    if (res.IsNull()) {
        std::ostringstream oss;
        oss << shapeKindName(sub.ShapeType()) << "#" << index
            << ": invalid (no detailed BRepCheck_Result)";
        out.push_back(oss.str());
        return;
    }
    // Status() returns the list pertaining to `sub` (myShape inside the
    // result). InContext / OnShape lists are richer but for our gate use
    // case this is enough.
    const BRepCheck_ListOfStatus& statuses = res->Status();
    if (statuses.IsEmpty()) {
        std::ostringstream oss;
        oss << shapeKindName(sub.ShapeType()) << "#" << index << ": invalid";
        out.push_back(oss.str());
        return;
    }
    BRepCheck_ListIteratorOfListOfStatus it(statuses);
    for (; it.More(); it.Next()) {
        if (it.Value() == BRepCheck_NoError) continue;
        std::ostringstream oss;
        oss << shapeKindName(sub.ShapeType()) << "#" << index
            << ": " << statusName(it.Value());
        out.push_back(oss.str());
    }
    (void)parent;
}

}  // namespace

#ifdef FORGE_NATIVE_BREP
namespace {

// Human kind-tag for a native CheckPredicate offender (edge / face / coedge / loop /
// vertex / shell) so the fault string names WHAT each id refers to — the native
// equivalent of OCCT's shapeKindName(sub.ShapeType()) prefix on each fault row.
const char* offenderKindName(native::brep::CheckPredicate::IdKind k) {
    using IdKind = native::brep::CheckPredicate::IdKind;
    switch (k) {
        case IdKind::Edge:   return "edge";
        case IdKind::Face:   return "face";
        case IdKind::Coedge: return "coedge";
        case IdKind::Loop:   return "loop";
        case IdKind::Vertex: return "vertex";
        case IdKind::Shell:  return "shell";
    }
    return "entity";
}

// Try the native validator (brep::checkBRep). Returns true + fills `out` on success;
// returns false (NEVER throws) when the native path HONESTLY DEFERS so the caller falls
// back to OCCT. Deferral case (Bible §0 — native-where-valid, OCCT otherwise):
//   * the input handle is NOT a NativeSolid (an OCCT-backed shape — there is no
//     OCCT-shape -> native-topology importer, so we cannot ingest it). Mirrors the
//     ShapeFix.cpp / Sewing.cpp NativeSolid-or-defer rule EXACTLY.
//
// On success it maps the native CheckReport -> AnalysisReport (the OCCT-facing return
// type) 1:1:
//   AnalysisReport.valid        <- CheckReport.valid (true iff EVERY predicate passed)
//   AnalysisReport.faultyCount  <- number of FAILED predicate rows (one per defect class)
//   AnalysisReport.faultStrings <- per-failed-predicate "<kind>#<id>: <StatusName>"
//                                  rows (one per named offender) + the predicate detail,
//                                  matching src/ShapeCheck.cpp's OCCT fault-string shape
//                                  ("<kind>#<index>: <StatusName>").
//
// Deferral cases (Bible §0 — native-where-valid, OCCT otherwise):
//   * a NativeMesh handle (no analytic Solid topology to validate);
//   * an OCCT-backed handle whose importOcctSolid DEFERS (NURBS/Torus/non-analytic
//     faces) — falls through to OCCT BRepCheck_Analyzer unchanged.
bool tryNativeAnalyse(ShapeHandle shape, AnalysisReport& out) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();

    // Resolve the native Solid to validate from EITHER a native handle OR an OCCT one.
    const Solid* s = nullptr;
    std::shared_ptr<TopologyBuilder> keepAlive;   // keeps an imported topology alive
    if (reg.kindOf(shape) == ShapeKind::NativeSolid) {
        s = &reg.getNativeSolid(shape);
    } else if (reg.kindOf(shape) == ShapeKind::Occt) {
        // PHASE-D: import the OCCT analytic solid into a native Solid and validate THAT.
        // ok==false (NURBS/Torus/non-analytic) -> defer to OCCT, exactly as before. The
        // importer's faces wind CCW-about-the-outward-normal with `reversed` set so
        // normalAt points out — the convention the now-reversed-aware native battery
        // expects (see file-head PHASE-D ACTIVATION + native_occt_import_test).
        ImportResult ir = importOcctSolid(reg.get(shape));
        if (!ir.ok || ir.solid == nullptr) return false;
        keepAlive = ir.owner;
        s = ir.solid;
    } else {
        return false;  // NativeMesh -> no analytic Solid -> defer to OCCT
    }

    // Run the full predicate battery on the solid (concatenates all its shells' faces;
    // expectClosed defaults true — a solid IS a closed body, which is the right
    // expectation for the T6/T8 closure predicates, same default the A/B harness uses).
    CheckOptions opt;   // tol=1e-6, curveSamples=8, maxTolerance=1.0, expectClosed=true
    CheckReport rep = checkBRep(s, opt);

    out.valid = rep.valid;

    // faultyCount = the count of FAILED predicate rows (one per distinct defect class
    // the battery found), mirroring src/ShapeCheck.cpp's ++rep.faultyCount per invalid
    // sub-shape. We count failed predicates (not raw offenders) so the count is a stable
    // defect-class tally; the offenders are enumerated in faultStrings below.
    out.faultyCount = static_cast<std::int32_t>(rep.failed());

    // Emit one fault string per offender of each FAILED predicate (named "<kind>#<id>:
    // <StatusName>"), with the predicate's optional detail appended. A failed predicate
    // with NO named offenders (e.g. T8 Euler, which carries only a detail note) still
    // emits one row so the defect is never silently dropped.
    for (const CheckPredicate& p : rep.predicates) {
        if (p.passed) continue;
        const char* statusNm = checkStatusName(p.status);
        if (p.offenders.empty()) {
            std::ostringstream oss;
            oss << statusNm;
            if (!p.detail.empty()) oss << " (" << p.detail << ")";
            out.faultStrings.push_back(oss.str());
        } else {
            for (const auto& off : p.offenders) {
                std::ostringstream oss;
                oss << offenderKindName(off.kind) << "#" << off.id << ": " << statusNm;
                if (!p.detail.empty()) oss << " (" << p.detail << ")";
                out.faultStrings.push_back(oss.str());
            }
        }
    }

    // ---- PREDICATE-COVERAGE GAP vs OCCT's ~30 BRepCheck_Status (surfaced, NEVER
    // silently passed/failed). The native battery's 21 CheckStatus enums COVER the
    // structural + the common geometric/orientation OCCT statuses:
    //   COVERED (native predicate -> OCCT BRepCheck_Status):
    //     InvalidMultiConnexity(T1/T9)  NotConnected(T7)            NotClosed(T6)
    //     RedundantEdge(T3)             EmptyWire/NoSurface(T5)     SubshapeNotInShape(T2)
    //     NotClosedWire->InvalidWire(T4) SelfIntersectingWire(G4)  ZeroLengthEdge->
    //       InvalidRange(G1)           DegeneratedFace->InvalidDegeneratedFlag(G2)
    //     BadOrientation-family(G3/O1/O2/O3)  InvalidCurveOnSurface(G5)
    //     InvalidPointOnCurve(G6)      NoCurveOnSurface(G7)        InvalidToleranceValue(G8)
    //     InvalidSameParameter/SameRange(G9)  EulerInvalid(T8, OCCT has no direct status)
    //   NOT COVERED by a native predicate (the GAP — OCCT statuses with NO native
    //   equivalent today; an OCCT-only check would catch these and the native pass will
    //   NOT report them, so we DOCUMENT the gap rather than imply completeness):
    //     InvalidPointOnCurveOnSurface, InvalidPointOnSurface, No3DCurve, Multiple3DCurve,
    //     Invalid3DCurve, InvalidCurveOnClosedSurface, InvalidSameRangeFlag (flag-only;
    //       native checks the RANGE via G9, not the boolean flag), InvalidSameParameterFlag
    //       (flag-only), IntersectingWires/InvalidImbricationOfWires (multi-wire face
    //       imbrication — covered ONLY for TrimmedFace via checkTrimmedFaceSelfIntersection,
    //       NOT here in the solid face-set battery), RedundantWire, EmptyShell,
    //       RedundantFace, InvalidImbricationOfShells, UnorientableShape,
    //       BadOrientationOfSubshape (native uses BadOrientationFace), EnclosedRegion,
    //       InvalidPolygonOnTriangulation (no triangulation stored on native faces),
    //       CheckFail. These are surfaced as ONE explicit advisory row appended below so a
    //       dashboard/heal-op sees the native pass did NOT gauge those classes — it is
    //       never silently treated as "clean" for them.
    out.faultStrings.push_back(
        "native-check NOTE: validated by the native predicate battery "
        "(21 predicates, T1-T9/G1-G9/O1-O3); OCCT-only BRepCheck statuses NOT gauged here "
        "[InvalidPointOnSurface, No3DCurve/Multiple3DCurve/Invalid3DCurve, "
        "InvalidSameRangeFlag/InvalidSameParameterFlag (flag-only), "
        "IntersectingWires/InvalidImbricationOfWires (solid-face-set only — trimmed-face "
        "imbrication is a separate native pass), RedundantWire/RedundantFace/EmptyShell, "
        "InvalidImbricationOfShells, UnorientableShape, EnclosedRegion, "
        "InvalidPolygonOnTriangulation, CheckFail] — see Check.hpp battery");

    return true;
}

}  // namespace
#endif

AnalysisReport analyse(ShapeHandle shape) {
#ifdef FORGE_NATIVE_BREP
    // GATE: native validator is opt-in via the FEAT gate (default OFF). When on AND the
    // input is a NativeSolid, validate via brep::checkBRep; otherwise fall through to OCCT
    // (OCCT-backed input HONESTLY DEFERS — no behavior change in the default build).
    if (native::brep::forgeNativeFeaturesEnabled()) {
        AnalysisReport nativeOut{};
        if (tryNativeAnalyse(shape, nativeOut)) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    const auto& s = ShapeRegistry::instance().get(shape);
    if (s.IsNull()) {
        throw std::invalid_argument("forge.shapecheck.analyse: null shape");
    }

    // GeomFill checks + curve-on-surface checks all on (true = run).
    BRepCheck_Analyzer chk(s, Standard_True);

    AnalysisReport rep{};
    rep.valid = chk.IsValid();

    // Top-level shape itself.
    if (!chk.IsValid(s)) {
        ++rep.faultyCount;
        collectFaultsFor(chk, s, s, 0, rep.faultStrings);
    }

    // Walk every shape kind so callers get a complete fault inventory.
    constexpr TopAbs_ShapeEnum kinds[] = {
        TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE, TopAbs_WIRE,
        TopAbs_EDGE,  TopAbs_VERTEX
    };
    for (auto kind : kinds) {
        TopTools_IndexedMapOfShape sub;
        TopExp::MapShapes(s, kind, sub);
        for (Standard_Integer i = 1; i <= sub.Extent(); ++i) {
            const TopoDS_Shape& sh = sub(i);
            if (!chk.IsValid(sh)) {
                ++rep.faultyCount;
                collectFaultsFor(chk, s, sh, static_cast<std::size_t>(i),
                                 rep.faultStrings);
            }
        }
    }

    return rep;
}

}  // namespace forge::shapecheck
