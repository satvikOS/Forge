// test/draft_angle_vs_draft_corpus.cpp — T-298: NativeDraftAngle::draftFaces is
// compiled and exported but reached from no production entry point. Measure it
// against the draft path that SHIPS, on the same cases, so the wire-or-retire
// decision is made on numbers. This file decides nothing; it measures.
//
// ── THE ENGINES, AND WHICH ONE SHIPS ───────────────────────────────────────────
// Two functions share the name forge::occtdraft::draftFaces and differ only in
// their parameter lists (both are exported by libforge_kernel_core):
//
//   ang   draftFaces(shape, neutralOrigin, pull, vector<uint32_t> faceIds, angle, why*)
//         src/native/brep/NativeDraftAngle.cpp — the LOCALISED-BOOLEAN engine
//         (planar wedge prisms, cylinder/cone -> cone revolution bodies). The
//         subject of this task. No object of the core, the desktop, ui or
//         binding.cpp calls it; run_draft_angle_vs_draft_corpus.sh re-measures that.
//   arr   draftFaces(shape, ListOfShape faces, pull, angle, gp_Pln neutral, tol)
//         src/native/brep/NativeDraft.cpp — the PLANE-ARRANGEMENT engine. This is
//         the overload src/Features.cpp's forge::part::draftFaces calls first.
//   loc   occtdraftlocal::draftFacesLocal — src/native/brep/NativeDraftLocal.cpp,
//         the second link Features.cpp chains after `arr` (first non-null wins).
//   occt  BRepOffsetAPI_DraftAngle, spelled exactly as Features.cpp spells it
//         (Add; Remove when !AddDone; Build; IsDone). The REFERENCE every delta is
//         taken against. A rejected face is reported as NOT answered (on OCCT 7.9
//         the Remove throws Standard_NoSuchObject; see runOcct).
//
// The shipped NATIVE chain (when FORGE_DRAFT_NATIVE=1) is `arr` then `loc`; the
// summary scores it as `chain` so `ang` is compared with what production would
// actually do, not with one link of it.
//
// ── WHAT EACH ROW CARRIES ───────────────────────────────────────────────────
// One JSON object per (part, case, engine), printed and flushed as soon as that
// engine returns, so a part that hangs in one engine still yields the rows of the
// engines before it and the runner can re-run the rest:
//   answered / declined with the engine's own NAMED reason (or the exception text),
//   BRepCheck validity (and the distinct status codes when invalid), volume, area,
//   the tight bounding box, face/edge/vertex counts, and the wall-clock of the
//   engine call ALONE (the measurements after it are not timed);
//   against the OCCT result of the same case: volume delta (abs and relative),
//   area delta, max |bbox delta| over the six bounds, and the list of observables
//   that disagree. GEOMETRIC agreement (volume, area, centroid, box, validity) is
//   kept apart from TOPOLOGY counts: equivalent solids can have different valid
//   face partitions, and a boolean-built answer splits faces where OCCT's local
//   re-trim does not, so a face-count difference alone is reported, not scored.
//
// ── THE CASES ───────────────────────────────────────────────────────────────
//   --fixtures        the closed-form matrix of test/occt_query_tail_gate.cpp [F]
//                     (itself the minimal port of test/native_draft_ab.mjs, which
//                     was READ for its semantics and never run): 11 positive
//                     cases with a derived volume, 2 that must be refused.
//   <part.step>       the 600-part corpus. The `wall` case is the corpus A/B's own
//                     DRAFT case, derived VERBATIM as test/draft_local_probe.cpp
//                     derives it (largest planar face with |n.z| < 0.1, +3 deg,
//                     pull +Z, neutral plane z = min vertex z), so these rows are
//                     comparable with every draft-local probe run. The `cyl` case
//                     is ADDED because cylinder -> cone is the one capability
//                     `ang` claims that neither shipped engine has: the largest
//                     cylindrical face whose axis is parallel to the pull, same
//                     angle, pull and neutral plane. Every cyl row also carries the
//                     CLOSED-FORM volume change of that draft and whether it is
//                     exact on that part (frustumChange): an adjudicator that owes
//                     nothing to any draft engine, OCCT's included.
//   --summarize F     totals over a results.jsonl (rows from either mode).
//   --selftest        controls that prove each engine slot is wired to the engine
//                     it names, in both directions; see selftest().
//
// Native C++ only. No node, no addon, no .mjs.

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_ListIteratorOfListOfStatus.hxx>
#include <BRepCheck_Result.hxx>
#include <BRepCheck_Status.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Ax2.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

#include "forge/native/brep/NativeAabbBridge.hpp"
#include "forge/native/brep/NativeDraft.hpp"
#include "forge/native/brep/NativeDraftAngle.hpp"
#include "forge/native/brep/NativeDraftLocal.hpp"

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kDeg = kPi / 180.0;

// ─────────────────────────────────────────────────────────────── observables
std::string jesc(const std::string& s) {
    std::string o;
    for (char ch : s) {
        if (ch == '"' || ch == '\\') { o += '\\'; o += ch; }
        else if (static_cast<unsigned char>(ch) < 0x20) o += ' ';
        else o += ch;
    }
    return o;
}

std::string brepCheckStatuses(const TopoDS_Shape& s) {
    if (s.IsNull()) return "";
    std::map<int, int> tally;
    try {
        BRepCheck_Analyzer an(s);
        if (an.IsValid()) return "VALID";
        static const TopAbs_ShapeEnum kinds[] = {
            TopAbs_VERTEX, TopAbs_EDGE, TopAbs_WIRE, TopAbs_FACE, TopAbs_SHELL, TopAbs_SOLID};
        for (TopAbs_ShapeEnum k : kinds) {
            for (TopExp_Explorer ex(s, k); ex.More(); ex.Next()) {
                const Handle(BRepCheck_Result) r = an.Result(ex.Current());
                if (r.IsNull()) continue;
                for (BRepCheck_ListIteratorOfListOfStatus it(r->Status()); it.More(); it.Next())
                    if (it.Value() != BRepCheck_NoError) tally[static_cast<int>(it.Value())] += 1;
            }
        }
    } catch (...) { return "threw"; }
    std::string out;
    for (const auto& kv : tally) {
        if (!out.empty()) out += ",";
        out += std::to_string(kv.first) + ":" + std::to_string(kv.second);
    }
    return out.empty() ? "invalid-but-no-status" : out;
}

struct Obs {
    bool have = false;
    bool valid = false;
    std::string bc;   // BRepCheck verdict / status codes
    double vol = 0.0, area = 0.0;
    double com[3] = {0, 0, 0};
    double box[6] = {0, 0, 0, 0, 0, 0};   // tight box: AddOptimal, no triangulation, no tolerance
    bool boxVoid = true;
    int nF = 0, nE = 0, nV = 0, nSolid = 0;
};

Obs observe(const TopoDS_Shape& s) {
    Obs o;
    if (s.IsNull()) return o;
    try {
        GProp_GProps p;
        BRepGProp::VolumeProperties(s, p);
        o.vol = p.Mass();
        const gp_Pnt c = p.CentreOfMass();
        o.com[0] = c.X(); o.com[1] = c.Y(); o.com[2] = c.Z();
        GProp_GProps sp;
        BRepGProp::SurfaceProperties(s, sp);
        o.area = sp.Mass();
    } catch (...) { return o; }
    try {
        // The TIGHT box, for both sides of every comparison: no triangulation and
        // no tolerance enlargement, so a delta is a geometry delta and never the
        // OCCT gap. (This is a measuring harness, not a kernel object.)
        Bnd_Box bb;
        BRepBndLib::AddOptimal(s, bb, Standard_False, Standard_False);
        if (!bb.IsVoid()) {
            bb.Get(o.box[0], o.box[1], o.box[2], o.box[3], o.box[4], o.box[5]);
            o.boxVoid = false;
        }
    } catch (...) {}
    TopTools_IndexedMapOfShape mf, me, mv, ms;
    TopExp::MapShapes(s, TopAbs_FACE, mf);
    TopExp::MapShapes(s, TopAbs_EDGE, me);
    TopExp::MapShapes(s, TopAbs_VERTEX, mv);
    TopExp::MapShapes(s, TopAbs_SOLID, ms);
    o.nF = mf.Extent(); o.nE = me.Extent(); o.nV = mv.Extent(); o.nSolid = ms.Extent();
    o.bc = brepCheckStatuses(s);
    o.valid = (o.bc == "VALID");
    o.have = true;
    return o;
}

// GEOMETRIC disagreement only (see the header): the same bounds the draft-local
// probe uses, scaled by the part's own size, never widened to make a row pass.
std::string geomDisagreements(const Obs& a, const Obs& b, double scale) {
    std::string out;
    auto add = [&](const char* w) { if (!out.empty()) out += ","; out += w; };
    const double lenTol = 1.0e-6 * std::max(1.0, scale);
    if (!(std::fabs(a.vol - b.vol) <= 1.0e-6 * std::max(1.0, std::fabs(b.vol))))   add("volume");
    if (!(std::fabs(a.area - b.area) <= 1.0e-6 * std::max(1.0, std::fabs(b.area)))) add("area");
    static const char* cn[3] = {"com.x", "com.y", "com.z"};
    for (int k = 0; k < 3; ++k)
        if (!(std::fabs(a.com[k] - b.com[k]) <= lenTol)) add(cn[k]);
    static const char* bn[6] = {"bbox.lo.x", "bbox.lo.y", "bbox.lo.z", "bbox.hi.x", "bbox.hi.y", "bbox.hi.z"};
    if (a.boxVoid != b.boxVoid) add("bbox.void");
    else for (int k = 0; k < 6; ++k)
        if (!(std::fabs(a.box[k] - b.box[k]) <= lenTol)) add(bn[k]);
    if (a.valid != b.valid) add("validity");
    if (a.nSolid != b.nSolid) add("nsolids");
    return out;
}

std::string topoDifferences(const Obs& a, const Obs& b) {
    std::string out;
    auto add = [&](const char* w) { if (!out.empty()) out += ","; out += w; };
    if (a.nF != b.nF) add("nfaces");
    if (a.nE != b.nE) add("nedges");
    if (a.nV != b.nV) add("nverts");
    return out;
}

// ──────────────────────────────────────────────────────────────── one case
struct Case {
    std::string part;      // corpus part id, or "fixture:<name>"
    std::string kind;      // wall | cyl | closed-form
    TopoDS_Shape shape;
    std::vector<std::uint32_t> faceIds;   // 0-based TopExp_Explorer FACE order (ang's convention)
    TopTools_ListOfShape faces;           // the same faces (arr / loc / occt convention)
    gp_Pnt origin;                        // neutral plane through here, normal = pull
    gp_Dir pull{0, 0, 1};
    double deg = 0.0;
    double scale = 1.0;
    bool hasRef = false;   // fixtures: a closed-form volume exists
    double ref = 0.0;
    bool expectRefuse = false;
    // The input itself, measured once: a result is read against it as well as
    // against OCCT (volume change, and whether an invalid answer was inherited).
    double inVol = 0.0;
    bool inValid = false;
    // cyl case only: the CLOSED-FORM volume change of drafting a full-revolution
    // cylinder coaxial with the pull (see frustumChange). It is the exact answer
    // only when every neighbour of the wall is a plane perpendicular to the axis
    // (`frustumEndsPlanar`) AND the region the draft sweeps lies wholly in the
    // material (the overlap check); `frustumExact` is both, and only those rows
    // adjudicate.
    bool hasFrustum = false;
    bool frustumEndsPlanar = false;
    double frustumDv = 0.0;
    double cylR = 0.0, cylH0 = 0.0, cylH1 = 0.0;
    bool cylBoss = false;
    bool frustumExact = false;      // ends planar AND the swept region wholly in the material
    double regionVol = 0.0, commonVol = 0.0;
};

struct Run {
    bool answered = false;
    bool threw = false;
    std::string reason;
    double ms = 0.0;
    TopoDS_Shape shape;
    unsigned long long aabbCalls = 0, aabbNative = 0;
};

using Clock = std::chrono::steady_clock;
double msSince(Clock::time_point t0) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

// An OCCT exception often carries NO message; its dynamic type is then the only
// thing that names it, and an empty reason would read as "declined, no reason".
std::string failureText(const Standard_Failure& e) {
    const char* m = e.GetMessageString();
    std::string t = e.DynamicType().IsNull() ? "Standard_Failure" : e.DynamicType()->Name();
    if (m != nullptr && *m != '\0') t += std::string(": ") + m;
    return t;
}

Run runAng(const Case& c) {
    Run r;
    std::string why;
    const unsigned long long c0 = forge::native::brep::shapeAabbCallCount();
    const unsigned long long n0 = forge::native::brep::shapeAabbNativeCount();
    const Clock::time_point t0 = Clock::now();
    try {
        r.shape = forge::occtdraft::draftFaces(c.shape, c.origin, c.pull, c.faceIds, c.deg * kDeg, &why);
        r.reason = why;
    } catch (const Standard_Failure& e) {
        r.threw = true; r.reason = failureText(e);
    } catch (const std::exception& e) {
        r.threw = true; r.reason = e.what();
    } catch (...) { r.threw = true; r.reason = "unknown throw"; }
    r.ms = msSince(t0);
    r.aabbCalls = forge::native::brep::shapeAabbCallCount() - c0;
    r.aabbNative = forge::native::brep::shapeAabbNativeCount() - n0;
    r.answered = !r.threw && !r.shape.IsNull();
    if (!r.answered && r.reason.empty()) r.reason = "null shape, no reason";
    if (r.answered) r.reason.clear();
    return r;
}

Run runArr(const Case& c) {
    Run r;
    const gp_Pln neutral(c.origin, c.pull);
    const Clock::time_point t0 = Clock::now();
    try {
        r.shape = forge::occtdraft::draftFaces(c.shape, c.faces, c.pull, c.deg * kDeg, neutral);
        const char* w = forge::occtdraft::draftLastDeferReason();
        r.reason = w ? w : "";
    } catch (const Standard_Failure& e) {
        r.threw = true; r.reason = failureText(e);
    } catch (const std::exception& e) {
        r.threw = true; r.reason = e.what();
    } catch (...) { r.threw = true; r.reason = "unknown throw"; }
    r.ms = msSince(t0);
    r.answered = !r.threw && !r.shape.IsNull();
    if (!r.answered && r.reason.empty()) r.reason = "null shape, no reason";
    if (r.answered) r.reason.clear();
    return r;
}

Run runLoc(const Case& c) {
    Run r;
    const gp_Pln neutral(c.origin, c.pull);
    const Clock::time_point t0 = Clock::now();
    try {
        r.shape = forge::occtdraftlocal::draftFacesLocal(c.shape, c.faces, c.pull, c.deg * kDeg, neutral);
        const char* w = forge::occtdraftlocal::draftLocalLastDeferReason();
        r.reason = w ? w : "";
    } catch (const Standard_Failure& e) {
        r.threw = true; r.reason = failureText(e);
    } catch (const std::exception& e) {
        r.threw = true; r.reason = e.what();
    } catch (...) { r.threw = true; r.reason = "unknown throw"; }
    r.ms = msSince(t0);
    r.answered = !r.threw && !r.shape.IsNull();
    if (!r.answered && r.reason.empty()) r.reason = "null shape, no reason";
    if (r.answered) r.reason.clear();
    return r;
}

// Features.cpp's OCCT branch, call for call. MEASURED on OCCT 7.9 (box, +X wall
// then top cap, and the reverse order): Remove() of a face whose Add() was
// rejected THROWS Standard_NoSuchObject, and a Build() with no face added throws
// Standard_ConstructionError. So a rejected face surfaces here -- and out of
// Features.cpp's forge::part::draftFaces -- as a thrown Standard_Failure, and the
// `!allAdded` branch below (a Build after a dropped face) is unreachable with this
// OCCT; it is kept so a future OCCT that stops throwing cannot turn a half-applied
// draft into an "answer".
Run runOcct(const Case& c) {
    Run r;
    const gp_Pln neutral(c.origin, c.pull);
    const Clock::time_point t0 = Clock::now();
    try {
        BRepOffsetAPI_DraftAngle mk(c.shape);
        bool allAdded = true;
        for (TopTools_ListIteratorOfListOfShape it(c.faces); it.More(); it.Next()) {
            const TopoDS_Face f = TopoDS::Face(it.Value());
            mk.Add(f, c.pull, c.deg * kDeg, neutral);
            if (!mk.AddDone()) { allAdded = false; mk.Remove(f); }
        }
        mk.Build();
        if (!mk.IsDone()) r.reason = "BRepOffsetAPI_DraftAngle::Build not done";
        else if (!allAdded) r.reason = "Add rejected a face (a Build now is a half-applied draft)";
        else r.shape = mk.Shape();
    } catch (const Standard_Failure& e) {
        r.threw = true; r.reason = failureText(e);
    } catch (const std::exception& e) {
        r.threw = true; r.reason = e.what();
    } catch (...) { r.threw = true; r.reason = "unknown throw"; }
    r.ms = msSince(t0);
    r.answered = !r.threw && !r.shape.IsNull();
    if (!r.answered && r.reason.empty()) r.reason = "null shape, no reason";
    if (r.answered) r.reason.clear();
    return r;
}

void printRow(const Case& c, const char* engine, const Run& r, const Obs& o,
              bool occtOk, const Obs& ref) {
    std::ostringstream s;
    s.precision(17);
    s << "{\"part\":\"" << jesc(c.part) << "\",\"case\":\"" << c.kind << "\",\"engine\":\"" << engine
      << "\",\"answered\":" << (r.answered ? "true" : "false")
      << ",\"threw\":" << (r.threw ? "true" : "false")
      << ",\"reason\":\"" << jesc(r.reason) << "\""
      << ",\"ms\":" << r.ms
      << ",\"deg\":" << c.deg << ",\"nsel\":" << c.faceIds.size() << ",\"scale\":" << c.scale
      << ",\"in_vol\":" << c.inVol << ",\"in_valid\":" << (c.inValid ? "true" : "false");
    if (c.hasFrustum)
        s << ",\"frustum_dvol\":" << c.frustumDv
          << ",\"frustum_ends_planar\":" << (c.frustumEndsPlanar ? "true" : "false")
          << ",\"cyl_r\":" << c.cylR << ",\"cyl_h0\":" << c.cylH0 << ",\"cyl_h1\":" << c.cylH1
          << ",\"cyl_sense\":\"" << (c.cylBoss ? "boss" : "bore") << "\""
          << ",\"swept_vol\":" << c.regionVol << ",\"swept_in_material\":" << c.commonVol
          << ",\"frustum_exact\":" << (c.frustumExact ? "true" : "false");
    if (std::string(engine) == "ang")
        s << ",\"aabb_calls\":" << r.aabbCalls << ",\"aabb_native\":" << r.aabbNative;
    if (r.answered && o.have) {
        s << ",\"valid\":" << (o.valid ? "true" : "false") << ",\"bc\":\"" << jesc(o.bc) << "\""
          << ",\"vol\":" << o.vol << ",\"area\":" << o.area
          << ",\"nf\":" << o.nF << ",\"ne\":" << o.nE << ",\"nv\":" << o.nV << ",\"nsolid\":" << o.nSolid
          << ",\"dvol_in\":" << (o.vol - c.inVol);
        if (c.hasFrustum) {
            // Tolerance stated here, not tuned: 1e-6 of the closed-form change plus
            // 1e-8 of the part's volume (BRepGProp's own integration error on a
            // curved solid is that order, and V_out - V_in inherits it twice).
            const double tol = 1e-6 * std::fabs(c.frustumDv) + 1e-8 * std::fabs(c.inVol);
            const double err = std::fabs((o.vol - c.inVol) - c.frustumDv);
            s << ",\"dfrustum\":" << err << ",\"frustum_ok\":" << (err <= tol ? "true" : "false");
        }
        if (!o.boxVoid)
            s << ",\"box\":\"" << o.box[0] << " " << o.box[1] << " " << o.box[2] << " "
              << o.box[3] << " " << o.box[4] << " " << o.box[5] << "\"";
    }
    s << ",\"occt_ok\":" << (occtOk ? "true" : "false");
    if (r.answered && o.have && occtOk && std::string(engine) != "occt") {
        double dbox = 0.0;
        if (!o.boxVoid && !ref.boxVoid)
            for (int k = 0; k < 6; ++k) dbox = std::max(dbox, std::fabs(o.box[k] - ref.box[k]));
        else dbox = -1.0;
        const std::string gd = geomDisagreements(o, ref, c.scale);
        s << ",\"dvol\":" << (o.vol - ref.vol)
          << ",\"dvol_rel\":" << (std::fabs(o.vol - ref.vol) / std::max(1e-300, std::fabs(ref.vol)))
          << ",\"darea_rel\":" << (std::fabs(o.area - ref.area) / std::max(1e-300, std::fabs(ref.area)))
          << ",\"dbox\":" << dbox
          << ",\"geom_agrees\":" << (gd.empty() ? "true" : "false")
          << ",\"geom_diff\":\"" << gd << "\""
          << ",\"topo_diff\":\"" << topoDifferences(o, ref) << "\"";
    }
    if (c.hasRef || c.expectRefuse) {
        s << ",\"expect_refuse\":" << (c.expectRefuse ? "true" : "false");
        if (c.hasRef) {
            s << ",\"ref\":" << c.ref;
            if (r.answered && o.have)
                s << ",\"dref_rel\":" << (std::fabs(o.vol - c.ref) / std::fabs(c.ref));
        }
    }
    s << "}";
    std::printf("%s\n", s.str().c_str());
    std::fflush(stdout);
}

// Runs the engines named in `which` (occt first: it is the reference the others
// are measured against) and prints one row each.
void runCase(Case c, const std::set<std::string>& which) {
    {
        const Obs in = observe(c.shape);
        c.inVol = in.vol;
        c.inValid = in.valid;
    }
    Run occt;
    Obs ref;
    bool occtOk = false;
    if (which.count("occt")) {
        occt = runOcct(c);
        ref = observe(occt.shape);
        occtOk = occt.answered && ref.have;
        printRow(c, "occt", occt, ref, occtOk, ref);
    }
    const struct { const char* name; Run (*fn)(const Case&); } engines[] = {
        {"arr", runArr}, {"loc", runLoc}, {"ang", runAng}};
    for (const auto& e : engines) {
        if (!which.count(e.name)) continue;
        const Run r = e.fn(c);
        const Obs o = observe(r.shape);
        printRow(c, e.name, r, o, occtOk, ref);
    }
}

// ─────────────────────────────────────── the closed-form fixtures ([F] port)
double volumeOf(const TopoDS_Shape& s) {
    GProp_GProps gp;
    BRepGProp::VolumeProperties(s, gp);
    return gp.Mass();
}

bool planeNormal(const TopoDS_Face& f, gp_Dir& n) {
    BRepAdaptor_Surface as(f);
    if (as.GetType() != GeomAbs_Plane) return false;
    n = as.Plane().Axis().Direction();
    if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
    return true;
}

template <class Pred>
std::vector<std::uint32_t> faceIdsWhere(const TopoDS_Shape& s, Pred pred) {
    std::vector<std::uint32_t> ids;
    std::uint32_t i = 0;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next(), ++i)
        if (pred(TopoDS::Face(ex.Current()))) ids.push_back(i);
    return ids;
}

std::vector<std::uint32_t> firstOf(std::vector<std::uint32_t> v) {
    if (v.size() > 1) v.resize(1);
    return v;
}

// Resolve ang's 0-based ids to the faces the other engines take, so every engine
// drafts the SAME faces.
void bindFaces(Case& c) {
    c.faces.Clear();
    for (std::uint32_t want : c.faceIds) {
        std::uint32_t i = 0;
        for (TopExp_Explorer ex(c.shape, TopAbs_FACE); ex.More(); ex.Next(), ++i)
            if (i == want) { c.faces.Append(ex.Current()); break; }
    }
}

double vertexScale(const TopoDS_Shape& s) {
    double lo[3] = {0, 0, 0}, hi[3] = {0, 0, 0};
    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        const double v[3] = {p.X(), p.Y(), p.Z()};
        for (int k = 0; k < 3; ++k) {
            if (first) { lo[k] = hi[k] = v[k]; }
            else { lo[k] = std::min(lo[k], v[k]); hi[k] = std::max(hi[k], v[k]); }
        }
        first = false;
    }
    return std::max(std::max(hi[0] - lo[0], hi[1] - lo[1]), hi[2] - lo[2]);
}

// test/occt_query_tail_gate.cpp angleCases(), case for case and number for number.
std::vector<Case> fixtureCases() {
    const double t3 = std::tan(3.0 * kDeg), t5 = std::tan(5.0 * kDeg);
    auto sqFrustum   = [](double h, double a, double b) { return h / 3.0 * (a * a + b * b + a * b); };
    auto coneFrustum = [](double h, double r0, double r1) {
        return kPi * h / 3.0 * (r0 * r0 + r1 * r1 + r0 * r1);
    };
    auto plusX    = [](const TopoDS_Face& f) { gp_Dir n; return planeNormal(f, n) && n.X() > 0.9; };
    auto sideWall = [](const TopoDS_Face& f) { gp_Dir n; return planeNormal(f, n) && std::fabs(n.Z()) < 0.5; };
    auto topCap   = [](const TopoDS_Face& f) { gp_Dir n; return planeNormal(f, n) && n.Z() > 0.9; };
    auto cylFace  = [](const TopoDS_Face& f) { return BRepAdaptor_Surface(f).GetType() == GeomAbs_Cylinder; };
    auto sphFace  = [](const TopoDS_Face& f) { return BRepAdaptor_Surface(f).GetType() == GeomAbs_Sphere; };
    const gp_Pnt O(0, 0, 0);

    std::vector<Case> c;
    auto push = [&c](const std::string& name, const TopoDS_Shape& s, std::vector<std::uint32_t> ids,
                     const gp_Pnt& origin, double deg, double ref, bool refuse = false) {
        Case k;
        k.part = "fixture:" + name;
        k.kind = "closed-form";
        k.shape = s;
        k.faceIds = std::move(ids);
        k.origin = origin;
        k.deg = deg;
        k.hasRef = !refuse;
        k.ref = ref;
        k.expectRefuse = refuse;
        k.scale = vertexScale(s);
        bindFaces(k);
        c.push_back(k);
    };
    const TopoDS_Shape box = BRepPrimAPI_MakeBox(10, 10, 10).Shape();
    const std::vector<std::uint32_t> walls = faceIdsWhere(box, sideWall);
    push("box one wall +3", box, firstOf(faceIdsWhere(box, plusX)), O, 3.0, 1000.0 - 500.0 * t3);
    push("box one wall -3", box, firstOf(faceIdsWhere(box, plusX)), O, -3.0, 1000.0 + 500.0 * t3);
    push("box four walls +5", box, walls, O, 5.0, sqFrustum(10, 10, 10 - 20 * t5));
    push("box four walls +5 neutral mid", box, walls, gp_Pnt(0, 0, 5), 5.0,
         1000.0 + (1000.0 / 3.0) * t5 * t5);
    push("box four walls +5 neutral top", box, walls, gp_Pnt(0, 0, 10), 5.0,
         sqFrustum(10, 10 + 20 * t5, 10));
    const TopoDS_Shape cy = BRepPrimAPI_MakeCylinder(10, 30).Shape();
    push("cylinder wall +3", cy, firstOf(faceIdsWhere(cy, cylFace)), O, 3.0, coneFrustum(30, 10, 10 - 30 * t3));
    push("cylinder wall -3", cy, firstOf(faceIdsWhere(cy, cylFace)), O, -3.0, coneFrustum(30, 10, 10 + 30 * t3));
    const TopoDS_Shape holed = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(40, 40, 20).Shape(),
        BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(15, 15, 0), gp::DZ()), 6, 20).Shape()).Shape();
    push("bored block: the bore +3", holed, firstOf(faceIdsWhere(holed, cylFace)), O, 3.0,
         32000.0 - coneFrustum(20, 6, 6 + 20 * t3));
    push("bored block: one outer wall +3", holed, firstOf(faceIdsWhere(holed, sideWall)), O, 3.0,
         32000.0 - kPi * 36.0 * 20.0 - 40.0 * 200.0 * t3);
    {
        ShapeUpgrade_UnifySameDomain u(BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(20, 20, 10).Shape(),
            BRepPrimAPI_MakeBox(gp_Pnt(10, 10, 0), 10, 10, 10).Shape()).Shape());
        u.Build();
        const TopoDS_Shape L = u.Shape();
        const double base = volumeOf(L);
        for (double cx : {10.0, 20.0}) {
            auto flank = [cx](const TopoDS_Face& f) {
                gp_Dir n;
                if (!planeNormal(f, n) || n.X() <= 0.9) return false;
                GProp_GProps gp;
                BRepGProp::SurfaceProperties(f, gp);
                return std::fabs(gp.CentreOfMass().X() - cx) < 1e-3;
            };
            push(cx == 10.0 ? "L-bracket inner flank x=10 +3" : "L-bracket outer flank x=20 +3",
                 L, firstOf(faceIdsWhere(L, flank)), O, 3.0, base - 500.0 * t3);
        }
    }
    push("box top cap (refuse)", box, firstOf(faceIdsWhere(box, topCap)), O, 3.0, 0.0, true);
    const TopoDS_Shape sp = BRepPrimAPI_MakeSphere(10).Shape();
    push("sphere wall (refuse)", sp, firstOf(faceIdsWhere(sp, sphFace)), O, 3.0, 0.0, true);
    return c;
}

// ───────────────────────────── the corpus case derivation (draft_local_probe)
// ── copied verbatim from test/draft_local_probe.cpp (itself verbatim from
//    test/draft_defer_probe.cpp and test/corpus_ab_coverage.cpp) ────────────────
bool boundsOf(const TopoDS_Shape& s, double bb[6]) {
    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) {
            bb[0] = bb[3] = p.X(); bb[1] = bb[4] = p.Y(); bb[2] = bb[5] = p.Z();
            first = false;
        } else {
            bb[0] = std::min(bb[0], p.X()); bb[3] = std::max(bb[3], p.X());
            bb[1] = std::min(bb[1], p.Y()); bb[4] = std::max(bb[4], p.Y());
            bb[2] = std::min(bb[2], p.Z()); bb[5] = std::max(bb[5], p.Z());
        }
    }
    return !first;
}

double faceArea(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}

gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0, 0, 0); }
    return g.CentreOfMass();
}

bool planeOf(const TopoDS_Face& f, gp_Pln& out) {
    Handle(Geom_Surface) s = BRep_Tool::Surface(f);
    if (s.IsNull()) return false;
    Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s);
    if (pl.IsNull()) return false;
    const gp_Pln p = pl->Pln();
    gp_Dir n = p.Axis().Direction();
    if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
    out = gp_Pln(p.Location(), n);
    return true;
}

bool betterFace(const TopoDS_Face& cand, double candArea,
                const TopoDS_Face& best, double bestArea) {
    if (best.IsNull()) return candArea > 0.0;
    if (candArea > bestArea * (1.0 + 1e-12)) return true;
    if (candArea < bestArea * (1.0 - 1e-12)) return false;
    const gp_Pnt a = faceCentroid(cand), b = faceCentroid(best);
    if (a.X() != b.X()) return a.X() < b.X();
    if (a.Y() != b.Y()) return a.Y() < b.Y();
    return a.Z() < b.Z();
}
// ── end verbatim copy ───────────────────────────────────────────────────────

// THE CLOSED FORM for a full-revolution cylinder wall of radius r whose axis is
// parallel to the pull, spanning heights [h0, h1] above the neutral plane, drafted
// by alpha (t = tan alpha). A positive angle makes material recede with height
// along the wall's OUTWARD normal, so the drafted radius is
//     boss (normal points away from the axis):  r(h) = r - t h
//     bore (normal points toward the axis):     r(h) = r + t h
// and the volume change is the solid of revolution between r and r(h):
//     boss: dV = +pi [ -r t (h1^2 - h0^2) + t^2 (h1^3 - h0^3) / 3 ]
//     bore: dV = -pi [ +r t (h1^2 - h0^2) + t^2 (h1^3 - h0^3) / 3 ]
// (cylinder r=10 h=0..30 +3 deg gives exactly the cone-frustum fixture; the
// bored block's bore gives exactly its fixture; --selftest asserts both).
// The answer is EXACT only when (1) the wall's ends are planes perpendicular to
// the axis, so nothing else is trimmed or extended (`endsPlanar`), AND (2) the
// region the draft sweeps out of the wall lies wholly in the material -- a bore
// opened near an outer wall breaks THROUGH it, and then less material exists to
// remove than the closed form assumes. (2) is checked INDEPENDENTLY of every
// draft engine: the swept region is built here from primitives (the cylinder and
// the drafted cone over [h0, h1]), and its overlap with the input is measured
// with a plain boolean Common. Exact iff Vol(input ∩ region) == Vol(region).
// Only a positive angle on a span with h0 >= 0 (all material receding) is
// checked; anything else is left unadjudicated.
struct CylInfo {
    double r = 0.0, h0 = 0.0, h1 = 0.0;
    bool boss = false;
    bool materialChecked = false;   // the overlap check below ran
    bool materialOk = false;        // ... and found the swept region wholly in the material
    double regionVol = 0.0, commonVol = 0.0;
};
bool frustumChange(const TopoDS_Shape& shape, const TopoDS_Face& face, const gp_Pnt& origin,
                   const gp_Dir& pull, double deg, double& dv, bool& endsPlanar,
                   CylInfo* info = nullptr) {
    try {
        BRepAdaptor_Surface as(face, Standard_True);
        if (as.GetType() != GeomAbs_Cylinder) return false;
        const gp_Cylinder cyl = as.Cylinder();
        const gp_Dir ax = cyl.Axis().Direction();
        if (std::fabs(std::fabs(ax.Dot(pull)) - 1.0) > 1e-9) return false;
        const double u0 = as.FirstUParameter(), u1 = as.LastUParameter();
        if (std::fabs((u1 - u0) - 2.0 * kPi) > 1e-9) return false;
        const double v0 = as.FirstVParameter(), v1 = as.LastVParameter();
        if (!(std::isfinite(v0) && std::isfinite(v1)) || !(v1 > v0)) return false;
        const gp_Pnt loc = cyl.Axis().Location();
        auto height = [&](double v) {
            const gp_Pnt p(loc.X() + v * ax.X(), loc.Y() + v * ax.Y(), loc.Z() + v * ax.Z());
            return (p.X() - origin.X()) * pull.X() + (p.Y() - origin.Y()) * pull.Y() +
                   (p.Z() - origin.Z()) * pull.Z();
        };
        const double h0 = std::min(height(v0), height(v1)), h1 = std::max(height(v0), height(v1));
        // Outward normal at the parametric centre, orientation honoured.
        gp_Pnt P; gp_Vec du, dv1;
        as.D1(0.5 * (u0 + u1), 0.5 * (v0 + v1), P, du, dv1);
        gp_Vec n = du.Crossed(dv1);
        if (face.Orientation() == TopAbs_REVERSED) n.Reverse();
        gp_Vec radial(loc, P);
        radial -= gp_Vec(ax) * radial.Dot(gp_Vec(ax));
        if (n.Magnitude() < 1e-12 || radial.Magnitude() < 1e-12) return false;
        const bool boss = n.Dot(radial) > 0.0;
        const double r = cyl.Radius(), t = std::tan(deg * kDeg);
        const double a2 = h1 * h1 - h0 * h0, a3 = h1 * h1 * h1 - h0 * h0 * h0;
        dv = boss ? kPi * (-r * t * a2 + t * t * a3 / 3.0) : -kPi * (r * t * a2 + t * t * a3 / 3.0);
        if (info != nullptr) { info->r = r; info->h0 = h0; info->h1 = h1; info->boss = boss; }
        // (2), only where (1) holds.
        bool ends = true;
        // The ends: every OTHER face sharing an edge with the wall must be a plane
        // perpendicular to the axis.
        TopTools_IndexedDataMapOfShapeListOfShape ef;
        TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, ef);
        for (TopExp_Explorer ex(face, TopAbs_EDGE); ex.More() && ends; ex.Next()) {
            const int i = ef.FindIndex(ex.Current());
            if (i == 0) { ends = false; break; }
            for (TopTools_ListIteratorOfListOfShape it(ef.FindFromIndex(i)); it.More(); it.Next()) {
                if (it.Value().IsSame(face)) continue;
                BRepAdaptor_Surface ns(TopoDS::Face(it.Value()), Standard_False);
                if (ns.GetType() != GeomAbs_Plane ||
                    std::fabs(std::fabs(ns.Plane().Axis().Direction().Dot(ax)) - 1.0) > 1e-12) {
                    ends = false;
                    break;
                }
            }
        }
        endsPlanar = ends;
        if (ends && info != nullptr && t > 0.0 && h0 >= 0.0 && h1 > h0) {
            // A point of the axis at height h0, and the pull as the primitives' axis.
            const double vAt = [&] {
                const double s0 = height(v0), s1 = height(v1);
                return v0 + (h0 - s0) * (v1 - v0) / (s1 - s0);
            }();
            const gp_Pnt base(loc.X() + vAt * ax.X(), loc.Y() + vAt * ax.Y(), loc.Z() + vAt * ax.Z());
            const gp_Ax2 frame(base, pull);
            const double H = h1 - h0;
            const double rA = boss ? r - t * h0 : r + t * h0;   // the drafted radius at h0
            const double rB = boss ? r - t * h1 : r + t * h1;   // ... and at h1
            if (rA > 0.0 && rB > 0.0) {
                const TopoDS_Shape cylBody = BRepPrimAPI_MakeCylinder(frame, r, H).Shape();
                const TopoDS_Shape coneBody = BRepPrimAPI_MakeCone(frame, rA, rB, H).Shape();
                // boss: material between the drafted cone and the cylinder (inside r);
                // bore: material between the cylinder and the drafted cone (outside r).
                const TopoDS_Shape region = boss ? BRepAlgoAPI_Cut(cylBody, coneBody).Shape()
                                                 : BRepAlgoAPI_Cut(coneBody, cylBody).Shape();
                const TopoDS_Shape common = BRepAlgoAPI_Common(shape, region).Shape();
                if (!region.IsNull() && !common.IsNull()) {
                    info->regionVol = volumeOf(region);
                    info->commonVol = volumeOf(common);
                    info->materialChecked = true;
                    const double inVol = std::fabs(volumeOf(shape));
                    info->materialOk =
                        std::fabs(info->regionVol - info->commonVol) <=
                            1e-6 * info->regionVol + 1e-8 * inVol &&
                        std::fabs(info->regionVol - std::fabs(dv)) <= 1e-6 * std::fabs(dv);
                }
            }
        }
        return std::isfinite(dv);
    } catch (...) {
        return false;
    }
}

// The 0-based TopExp_Explorer index of `f` (ang's face-id convention): the FIRST
// visit of the same TShape, which is also the occurrence TopExp::MapShapes keeps,
// so both conventions name one face with one orientation.
bool explorerIndexOf(const TopoDS_Shape& s, const TopoDS_Face& f, std::uint32_t& out) {
    std::uint32_t i = 0;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next(), ++i)
        if (ex.Current().IsSame(f)) { out = i; return true; }
    return false;
}

int corpusPart(const std::string& stepPath, std::string partName, const std::set<std::string>& which,
               const std::set<std::string>& kinds) {
    if (partName.empty()) {
        const size_t slash = stepPath.find_last_of('/');
        partName = (slash == std::string::npos) ? stepPath : stepPath.substr(slash + 1);
        const size_t dot = partName.find_last_of('.');
        if (dot != std::string::npos) partName = partName.substr(0, dot);
    }
    TopoDS_Shape shape;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(stepPath.c_str()); } catch (...) { st = IFSelect_RetFail; }
        if (st != IFSelect_RetDone) {
            std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", jesc(partName).c_str());
            return 1;
        }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
        if (shape.IsNull()) {
            std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", jesc(partName).c_str());
            return 1;
        }
    }
    double bb[6] = {0, 0, 0, 0, 0, 0};
    if (!boundsOf(shape, bb)) {
        std::printf("{\"part\":\"%s\",\"error\":\"no_vertices\"}\n", jesc(partName).c_str());
        return 1;
    }
    const double scale = std::max(std::max(bb[3] - bb[0], bb[4] - bb[1]), bb[5] - bb[2]);

    // The draft-local probe's sideWall pick, verbatim, and the cylinder pick beside it.
    TopoDS_Face sideWall; double sideWallArea = 0.0;
    TopoDS_Face cylWall;  double cylWallArea = 0.0;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(shape, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const double a = faceArea(f);
        gp_Pln pl;
        const bool isPlane = planeOf(f, pl);
        if (!(a > 0.0)) continue;
        if (isPlane && std::fabs(pl.Axis().Direction().Z()) < 0.1 &&
            betterFace(f, a, sideWall, sideWallArea)) {
            sideWall = f; sideWallArea = a;
        }
        if (!isPlane) {
            try {
                BRepAdaptor_Surface as(f, Standard_False);
                if (as.GetType() == GeomAbs_Cylinder &&
                    std::fabs(std::fabs(as.Cylinder().Axis().Direction().Z()) - 1.0) < 1e-9 &&
                    betterFace(f, a, cylWall, cylWallArea)) {
                    cylWall = f; cylWallArea = a;
                }
            } catch (...) {}
        }
    }
    int rows = 0;
    auto emitCase = [&](const char* kind, const TopoDS_Face& wall) {
        if (!kinds.count(kind)) return;
        if (wall.IsNull()) {
            std::printf("{\"part\":\"%s\",\"case\":\"%s\",\"applicable\":false}\n",
                        jesc(partName).c_str(), kind);
            std::fflush(stdout);
            return;
        }
        Case c;
        c.part = partName;
        c.kind = kind;
        c.shape = shape;
        c.origin = gp_Pnt(0, 0, bb[2]);
        c.pull = gp_Dir(0, 0, 1);
        c.deg = 3.0;
        c.scale = scale;
        std::uint32_t id = 0;
        if (!explorerIndexOf(shape, wall, id)) {
            std::printf("{\"part\":\"%s\",\"case\":\"%s\",\"error\":\"face_not_in_explorer_order\"}\n",
                        jesc(partName).c_str(), kind);
            return;
        }
        c.faceIds.push_back(id);
        bindFaces(c);
        if (std::string(kind) == "cyl") {
            CylInfo ci;
            c.hasFrustum = frustumChange(shape, wall, c.origin, c.pull, c.deg, c.frustumDv,
                                         c.frustumEndsPlanar, &ci);
            c.cylR = ci.r; c.cylH0 = ci.h0; c.cylH1 = ci.h1; c.cylBoss = ci.boss;
            c.frustumExact = c.frustumEndsPlanar && ci.materialChecked && ci.materialOk;
            c.regionVol = ci.regionVol; c.commonVol = ci.commonVol;
        }
        runCase(c, which);
        ++rows;
    };
    emitCase("wall", sideWall);
    emitCase("cyl", cylWall);
    (void)rows;
    return 0;
}

// ─────────────────────────────────────────────────────────────── --selftest
// Each engine slot must be wired to the engine it names, in BOTH directions; a
// harness whose `ang` slot called the shipped overload would report a plausible
// number that looked exactly like this one.
int selftest() {
    int bad = 0;
    auto fail = [&bad](const std::string& m) { std::printf("  SELFTEST FAIL: %s\n", m.c_str()); bad = 1; };
    const std::vector<Case> fx = fixtureCases();
    const Case* oneWall = nullptr;
    const Case* cylWall = nullptr;
    const Case* sphere = nullptr;
    const Case* fourWalls = nullptr;
    const Case* bore = nullptr;
    for (const Case& c : fx) {
        if (c.part == "fixture:box one wall +3") oneWall = &c;
        if (c.part == "fixture:cylinder wall +3") cylWall = &c;
        if (c.part == "fixture:sphere wall (refuse)") sphere = &c;
        if (c.part == "fixture:box four walls +5") fourWalls = &c;
        if (c.part == "fixture:bored block: the bore +3") bore = &c;
    }
    if (!oneWall || !cylWall || !sphere || !fourWalls || !bore) { fail("fixture lookup"); return 1; }
    for (const Case* c : {oneWall, cylWall, sphere, fourWalls, bore})
        if (c->faceIds.empty() || c->faces.Extent() != static_cast<int>(c->faceIds.size()))
            fail("face binding " + c->part);

    // ang: answers a planar wall AND a cylinder wall with the closed form; refuses
    // the sphere BY NAME; and goes through the AABB bridge, whose only library
    // caller is NativeDraftAngle.cpp — so a call counted there proves this slot
    // reaches that TU and not the other overload.
    for (const Case* c : {oneWall, cylWall}) {
        const Run r = runAng(*c);
        const double rel = r.answered ? std::fabs(volumeOf(r.shape) - c->ref) / c->ref : 1.0;
        if (!r.answered || rel > 1e-9) fail("ang on " + c->part + ": " + r.reason);
        if (r.aabbCalls == 0) fail("ang on " + c->part + " never entered the AABB bridge");
    }
    {
        const Run r = runAng(*sphere);
        if (r.answered || r.reason.empty()) fail("ang did not refuse the sphere wall by name");
    }
    // arr: answers the cube's four walls (a closed single-wire polyhedron) and
    // must DECLINE a cylinder wall by name; ang answers that same cylinder, so the
    // two slots cannot be the same function.
    {
        const Run r = runArr(*fourWalls);
        const double rel = r.answered ? std::fabs(volumeOf(r.shape) - fourWalls->ref) / fourWalls->ref : 1.0;
        if (!r.answered || rel > 1e-9) fail("arr on the four walls: " + r.reason);
        const Run rc = runArr(*cylWall);
        if (rc.answered || rc.reason.empty()) fail("arr did not decline the cylinder wall by name");
        const Run ra = runAng(*fourWalls);
        if (ra.aabbCalls == 0) fail("ang never entered the bridge on the four walls");
        const unsigned long long c0 = forge::native::brep::shapeAabbCallCount();
        (void)runArr(*fourWalls);
        (void)runLoc(*fourWalls);
        (void)runOcct(*fourWalls);
        if (forge::native::brep::shapeAabbCallCount() != c0)
            fail("arr/loc/occt entered the AABB bridge — the slots are not what they name");
    }
    // loc: answers a plate whose drafted wall meets a bore (arr's documented decline).
    {
        Case c;
        c.part = "selftest:plate with bore";
        c.kind = "closed-form";
        c.shape = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(20.0, 20.0, 10.0).Shape(),
            BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(10.0, 10.0, -1.0), gp::DZ()), 3.0, 12.0).Shape()).Shape();
        c.faceIds = firstOf(faceIdsWhere(c.shape, [](const TopoDS_Face& f) {
            gp_Dir n; return planeNormal(f, n) && n.X() > 0.9; }));
        bindFaces(c);
        c.origin = gp_Pnt(0, 0, 0);
        c.deg = 5.0;
        const Run ra = runArr(c);
        const Run rl = runLoc(c);
        const Run ro = runOcct(c);
        if (ra.answered || ra.reason.empty()) fail("arr did not decline the bored plate by name");
        if (!rl.answered) fail("loc declined the bored plate: " + rl.reason);
        if (!ro.answered) fail("occt declined the bored plate: " + ro.reason);
        if (rl.answered && ro.answered) {
            const Obs a = observe(rl.shape), b = observe(ro.shape);
            const std::string d = geomDisagreements(a, b, 20.0);
            if (!d.empty()) fail("loc vs occt on the bored plate disagree: " + d);
        }
    }
    // The cylinder adjudicator against the two cylinder closed forms: the boss
    // (cylinder wall +3) and the bore (bored block) must reproduce the fixtures'
    // derived volumes, and both have planar perpendicular ends.
    for (const Case* c : {cylWall, bore}) {
        double dv = 0.0;
        bool ends = false;
        CylInfo ci;
        const bool ok = frustumChange(c->shape, TopoDS::Face(c->faces.First()), c->origin, c->pull,
                                      c->deg, dv, ends, &ci);
        const double want = c->ref - volumeOf(c->shape);
        if (!ok || !ends || !ci.materialChecked || !ci.materialOk ||
            std::fabs(dv - want) > 1e-9 * std::fabs(want))
            fail("frustumChange on " + c->part + ": ok=" + std::to_string(ok) + " ends=" +
                 std::to_string(ends) + " dv=" + std::to_string(dv) + " want=" + std::to_string(want));
    }
    // ... and it must be able to say NO: a bore 1 mm from an outer wall opens by
    // 20*tan(3 deg) = 1.05 mm at its top, so it breaks THROUGH the wall and the
    // closed form is no longer the answer.
    {
        const TopoDS_Shape thin = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(40, 40, 20).Shape(),
            BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(7, 20, 0), gp::DZ()), 6, 20).Shape()).Shape();
        const std::vector<std::uint32_t> ids = firstOf(faceIdsWhere(thin, [](const TopoDS_Face& f) {
            return BRepAdaptor_Surface(f).GetType() == GeomAbs_Cylinder; }));
        TopoDS_Face wall;
        std::uint32_t i = 0;
        for (TopExp_Explorer ex(thin, TopAbs_FACE); ex.More(); ex.Next(), ++i)
            if (!ids.empty() && i == ids[0]) wall = TopoDS::Face(ex.Current());
        double dv = 0.0;
        bool ends = false;
        CylInfo ci;
        const bool ok = !wall.IsNull() &&
                        frustumChange(thin, wall, gp_Pnt(0, 0, 0), gp::DZ(), 3.0, dv, ends, &ci);
        if (!ok || !ends || !ci.materialChecked || ci.materialOk)
            fail("frustumChange did not flag a bore that breaks through its wall (ok=" +
                 std::to_string(ok) + " ends=" + std::to_string(ends) + " checked=" +
                 std::to_string(ci.materialChecked) + " materialOk=" + std::to_string(ci.materialOk) + ")");
    }
    // occt reference: the one-wall closed form, so the reference itself is pinned.
    {
        const Run r = runOcct(*oneWall);
        const double rel = r.answered ? std::fabs(volumeOf(r.shape) - oneWall->ref) / oneWall->ref : 1.0;
        if (!r.answered || rel > 1e-9) fail("occt reference on the one-wall box: " + r.reason);
    }
    // ... and it must not count a HALF-APPLIED draft as an answer. MEASURED on
    // OCCT 7.9: Add rejects a box's top cap (AddDone false, no throw) after
    // accepting its +X wall, and the Remove that Features.cpp's loop then calls
    // THROWS Standard_NoSuchObject, so the half-applied Build is never reached
    // (see runOcct). Either way the reference must report "not answered".
    {
        Case half = *oneWall;
        half.part = "selftest:+X wall and top cap";
        const std::vector<std::uint32_t> cap = firstOf(faceIdsWhere(half.shape, [](const TopoDS_Face& f) {
            gp_Dir n; return planeNormal(f, n) && n.Z() > 0.9; }));
        half.faceIds.insert(half.faceIds.end(), cap.begin(), cap.end());
        bindFaces(half);
        const Run r = runOcct(half);
        if (half.faceIds.size() != 2 || r.answered || r.reason.empty())
            fail("occt reference counted a half-applied draft (answered=" + std::to_string(r.answered) +
                 " reason='" + r.reason + "')");
    }
    // The comparator must be able to say NO: a drafted box against the undrafted
    // one disagrees on volume, and a shape against itself agrees on everything.
    {
        const Obs a = observe(oneWall->shape);
        const Run r = runOcct(*oneWall);
        const Obs b = observe(r.shape);
        if (geomDisagreements(a, b, 10.0).find("volume") == std::string::npos)
            fail("comparator did not flag a drafted vs undrafted volume");
        if (!geomDisagreements(b, b, 10.0).empty()) fail("comparator flags a shape against itself");
    }
    std::printf(bad ? "SELFTEST FAIL\n" : "SELFTEST PASS\n");
    return bad;
}

// ─────────────────────────────────────────────────────────────── --summarize
// A flat-JSON field reader for the rows this file writes (no nesting, no arrays).
std::string field(const std::string& line, const std::string& key) {
    const std::string k = "\"" + key + "\":";
    size_t p = line.find(k);
    if (p == std::string::npos) return "";
    p += k.size();
    if (p < line.size() && line[p] == '"') {
        std::string out;
        for (size_t i = p + 1; i < line.size(); ++i) {
            if (line[i] == '\\' && i + 1 < line.size()) { out += line[++i]; continue; }
            if (line[i] == '"') break;
            out += line[i];
        }
        return out;
    }
    size_t e = line.find_first_of(",}", p);
    return line.substr(p, e == std::string::npos ? std::string::npos : e - p);
}
bool fbool(const std::string& line, const std::string& key) { return field(line, key) == "true"; }
double fnum(const std::string& line, const std::string& key) {
    const std::string v = field(line, key);
    return v.empty() ? 0.0 : std::strtod(v.c_str(), nullptr);
}

struct EngineTally {
    int rows = 0, answered = 0, declined = 0, threw = 0, timeout = 0, valid = 0;
    int occtBoth = 0, geomAgree = 0, geomDisagree = 0, topoDiffer = 0;
    int refRows = 0, refWithin = 0, refusalRows = 0, refused = 0;
    int frRows = 0, frOk = 0, inheritedInvalid = 0;
    double msTotal = 0.0, worstDvolRel = 0.0, worstDbox = 0.0, worstDref = 0.0;
    std::vector<double> ms;
    std::map<std::string, int> reasons, geomDiffs;
};

int summarize(const std::string& path) {
    std::ifstream in(path);
    if (!in) { std::fprintf(stderr, "cannot read %s\n", path.c_str()); return 2; }
    // (part|case) -> engine -> row
    std::map<std::string, std::map<std::string, std::string>> byCase;
    std::map<std::string, EngineTally> tally;
    std::set<std::string> parts, errorParts;
    std::map<std::string, int> notApplicable;
    std::string line;
    while (std::getline(in, line)) {
        if (line.empty() || line[0] != '{') continue;
        const std::string part = field(line, "part");
        parts.insert(part);
        if (!field(line, "error").empty()) { errorParts.insert(part + " (" + field(line, "error") + ")"); continue; }
        if (field(line, "applicable") == "false") { notApplicable[field(line, "case")] += 1; continue; }
        const std::string eng = field(line, "engine");
        if (eng.empty()) continue;
        const std::string key = part + "|" + field(line, "case");
        byCase[key][eng] = line;
        EngineTally& t = tally[field(line, "case") + "/" + eng];
        t.rows += 1;
        if (fbool(line, "timeout")) { t.timeout += 1; t.reasons["TIMEOUT"] += 1; continue; }
        const bool ans = fbool(line, "answered");
        const double ms = fnum(line, "ms");
        t.msTotal += ms;
        t.ms.push_back(ms);
        if (fbool(line, "threw")) t.threw += 1;
        if (ans) {
            t.answered += 1;
            if (fbool(line, "valid")) t.valid += 1;
            else if (field(line, "in_valid") == "false") t.inheritedInvalid += 1;
            if (fbool(line, "frustum_exact")) {
                t.frRows += 1;
                if (fbool(line, "frustum_ok")) t.frOk += 1;
            }
        } else {
            t.declined += 1;
            std::string r = field(line, "reason");
            // Fold the per-face id into one bucket so the histogram counts guards.
            const size_t p = r.find("selected face id ");
            if (p != std::string::npos) r = "selected face id <n> is out of range";
            t.reasons[(fbool(line, "threw") ? "THREW: " : "") + r] += 1;
        }
        if (ans && fbool(line, "occt_ok") && eng != "occt") {
            t.occtBoth += 1;
            if (fbool(line, "geom_agrees")) t.geomAgree += 1;
            else {
                t.geomDisagree += 1;
                std::stringstream ss(field(line, "geom_diff"));
                std::string d;
                while (std::getline(ss, d, ',')) t.geomDiffs[d] += 1;
            }
            if (!field(line, "topo_diff").empty()) t.topoDiffer += 1;
            t.worstDvolRel = std::max(t.worstDvolRel, fnum(line, "dvol_rel"));
            t.worstDbox = std::max(t.worstDbox, fnum(line, "dbox"));
        }
        if (field(line, "expect_refuse") == "true") {
            t.refusalRows += 1;
            if (!ans) t.refused += 1;
        } else if (!field(line, "ref").empty()) {
            t.refRows += 1;
            if (ans && fnum(line, "dref_rel") <= 1e-9) t.refWithin += 1;
            if (ans) t.worstDref = std::max(t.worstDref, fnum(line, "dref_rel"));
        }
    }

    std::printf("rows from %zu parts/fixtures; %zu with an error row\n", parts.size(), errorParts.size());
    for (const std::string& e : errorParts) std::printf("  error: %s\n", e.c_str());
    for (const auto& kv : notApplicable) std::printf("  case %s not applicable on %d parts\n", kv.first.c_str(), kv.second);
    std::printf("\n%-18s %5s %5s %5s %5s %5s %5s | %5s %5s %5s %5s | %9s %8s %8s | %10s %10s\n",
                "case/engine", "rows", "ans", "decl", "threw", "tmout", "valid",
                "vsOK", "agree", "disag", "topo", "ms_total", "ms_med", "ms_max",
                "max|dV|rel", "max|dbox|");
    for (auto& kv : tally) {
        EngineTally& t = kv.second;
        std::sort(t.ms.begin(), t.ms.end());
        const double med = t.ms.empty() ? 0.0 : t.ms[t.ms.size() / 2];
        const double mx = t.ms.empty() ? 0.0 : t.ms.back();
        std::printf("%-18s %5d %5d %5d %5d %5d %5d | %5d %5d %5d %5d | %9.0f %8.1f %8.0f | %10.3g %10.3g\n",
                    kv.first.c_str(), t.rows, t.answered, t.declined, t.threw, t.timeout, t.valid,
                    t.occtBoth, t.geomAgree, t.geomDisagree, t.topoDiffer, t.msTotal, med, mx,
                    t.worstDvolRel, t.worstDbox);
    }
    std::printf("\n  ans = answered (non-null shape); vsOK = answered AND the OCCT reference answered;\n"
                "  agree/disag = GEOMETRIC agreement with OCCT (volume, area, centroid, tight box, validity,\n"
                "  solid count; scale-relative 1e-6); topo = face/edge/vertex counts differ (reported, not scored)\n");
    for (auto& kv : tally) {
        const EngineTally& t = kv.second;
        if (t.frRows)
            std::printf("  %-18s cylinder closed form (exact rows: planar perpendicular ends, swept region all material): %d/%d answered rows match "
                        "the frustum volume change\n", kv.first.c_str(), t.frOk, t.frRows);
        if (t.answered > t.valid)
            std::printf("  %-18s %d answered rows are BRepCheck-invalid, %d of them on an input that was "
                        "already invalid\n", kv.first.c_str(), t.answered - t.valid, t.inheritedInvalid);
    }
    for (auto& kv : tally) {
        const EngineTally& t = kv.second;
        if (t.refRows || t.refusalRows)
            std::printf("  %-18s closed form: %d/%d answered within 1e-9 (worst %.3g); refusals %d/%d\n",
                        kv.first.c_str(), t.refWithin, t.refRows, t.worstDref, t.refused, t.refusalRows);
    }
    for (auto& kv : tally) {
        const EngineTally& t = kv.second;
        if (t.reasons.empty() && t.geomDiffs.empty()) continue;
        std::printf("\n  %s declines by reason:\n", kv.first.c_str());
        std::vector<std::pair<int, std::string>> v;
        for (const auto& r : t.reasons) v.push_back({r.second, r.first});
        std::sort(v.rbegin(), v.rend());
        for (const auto& r : v) std::printf("    %5d  %s\n", r.first, r.second.c_str());
        if (!t.geomDiffs.empty()) {
            std::printf("  %s geometric disagreements by observable:\n", kv.first.c_str());
            for (const auto& d : t.geomDiffs) std::printf("    %5d  %s\n", d.second, d.first.c_str());
        }
    }

    // ── THE DECISION TABLE: ang against the SHIPPED native chain (arr, then loc)
    // and against OCCT, per case kind. "good" = answered AND geometrically agrees
    // with an OCCT reference that answered.
    std::map<std::string, std::map<std::string, int>> cross;
    std::map<std::string, std::vector<std::string>> angOnlyExamples;
    for (const auto& kv : byCase) {
        const std::string kind = kv.first.substr(kv.first.find('|') + 1);
        const auto& m = kv.second;
        auto good = [&m](const char* e) {
            auto it = m.find(e);
            return it != m.end() && fbool(it->second, "answered") && fbool(it->second, "occt_ok") &&
                   fbool(it->second, "geom_agrees");
        };
        auto ans = [&m](const char* e) {
            auto it = m.find(e);
            return it != m.end() && fbool(it->second, "answered");
        };
        const bool occtOk = ans("occt");
        const bool chainGood = good("arr") || (!ans("arr") && good("loc"));
        const bool chainAns = ans("arr") || ans("loc");
        const bool angGood = good("ang");
        const bool angAns = ans("ang");
        auto& c = cross[kind];
        c["cases"] += 1;
        // The headline rows are always printed, zeros included: "chain answered 0"
        // is the finding on a case kind the shipped engines cannot draft at all.
        c["occt answered"] += occtOk ? 1 : 0;
        c["chain answered"] += chainAns ? 1 : 0;
        c["chain good"] += chainGood ? 1 : 0;
        c["ang answered"] += angAns ? 1 : 0;
        c["ang good"] += angGood ? 1 : 0;
        if (angGood && chainGood) c["both good"] += 1;
        if (angGood && !chainGood) {
            c["ang good, chain not"] += 1;
            if (angOnlyExamples[kind].size() < 12) angOnlyExamples[kind].push_back(kv.first.substr(0, kv.first.find('|')));
        }
        if (!angGood && chainGood) c["chain good, ang not"] += 1;
        if (!angGood && !chainGood) c["neither good"] += 1;
        if (angAns && !angGood && occtOk) c["ang answered but disagrees with occt"] += 1;
        if (chainAns && !chainGood && occtOk) c["chain answered but disagrees with occt"] += 1;
        if (angAns && !occtOk) c["ang answered where occt did not"] += 1;
        // AGAINST WHICH OCCT? OCCT is an oracle, not the truth: an OCCT answer that
        // BRepCheck rejects is not a reference a disagreement can be blamed on. So
        // ang is split by the validity of the OCCT answer it is compared with.
        {
            auto ia = m.find("ang");
            auto io = m.find("occt");
            if (angAns && occtOk && io != m.end()) {
                const bool oValid = fbool(io->second, "valid");
                const bool agree = fbool(ia->second, "geom_agrees");
                if (oValid) c[std::string("ang vs a VALID occt: ") + (agree ? "agrees" : "DISAGREES")] += 1;
                if (!oValid) {
                    c["ang vs an INVALID occt answer"] += 1;
                    if (fbool(ia->second, "valid")) c["  ... where ang is BRepCheck-valid"] += 1;
                    if (field(ia->second, "geom_diff").find("volume") == std::string::npos)
                        c["  ... where ang's volume still agrees"] += 1;
                }
            }
            if (angAns && !occtOk) {
                if (fbool(ia->second, "valid")) c["  ang answers where occt did not: BRepCheck-valid"] += 1;
                else c["  ang answers where occt did not: INVALID"] += 1;
            }
            // A "draft" that leaves the volume unchanged is a no-op wearing an
            // answer's shape; on these cases (3 deg, a wall above the neutral
            // plane) every real draft moves material.
            if (angAns && std::fabs(fnum(ia->second, "dvol_in")) <= 1e-9 * std::fabs(fnum(ia->second, "in_vol")))
                c["ang answers that changed NO volume"] += 1;
        }
        if (chainAns && !occtOk) c["chain answered where occt did not"] += 1;
        // The cylinder adjudication: where the closed form is exact, who is right?
        auto fr = [&m](const char* e) {
            auto it = m.find(e);
            if (it == m.end() || !fbool(it->second, "answered") ||
                !fbool(it->second, "frustum_exact")) return -1;
            return fbool(it->second, "frustum_ok") ? 1 : 0;
        };
        if (fr("occt") >= 0 || fr("ang") >= 0) {
            c["closed-form-exact rows"] += 1;
            if (fr("ang") == 1 && fr("occt") == 1) c["  ang right, occt right"] += 1;
            if (fr("ang") == 1 && fr("occt") == 0) c["  ang right, occt WRONG"] += 1;
            if (fr("ang") == 0 && fr("occt") == 1) c["  ang WRONG, occt right"] += 1;
            if (fr("ang") == 0 && fr("occt") == 0) c["  ang WRONG, occt WRONG"] += 1;
            if (fr("ang") == 1 && fr("occt") < 0) c["  ang right, occt did not answer"] += 1;
            if (fr("ang") == 0 && fr("occt") < 0) c["  ang WRONG, occt did not answer"] += 1;
            if (fr("ang") < 0 && fr("occt") == 1) c["  ang did not answer, occt right"] += 1;
            if (fr("ang") < 0 && fr("occt") == 0) c["  ang did not answer, occt WRONG"] += 1;
        }
    }
    std::printf("\nDECISION TABLE (good = answered AND geometrically agrees with an answering OCCT reference;\n"
                "chain = what Features.cpp ships with FORGE_DRAFT_NATIVE=1: arr, then loc on its decline)\n");
    // A fixed reading order (a std::map would interleave the indented sub-rows).
    static const char* const kOrder[] = {
        "cases", "occt answered", "chain answered", "chain good", "ang answered", "ang good",
        "both good", "ang good, chain not", "chain good, ang not", "neither good",
        "ang vs a VALID occt: agrees", "ang vs a VALID occt: DISAGREES",
        "ang vs an INVALID occt answer", "  ... where ang is BRepCheck-valid",
        "  ... where ang's volume still agrees",
        "ang answered where occt did not", "  ang answers where occt did not: BRepCheck-valid",
        "  ang answers where occt did not: INVALID", "chain answered where occt did not",
        "ang answered but disagrees with occt", "chain answered but disagrees with occt",
        "ang answers that changed NO volume", "closed-form-exact rows",
        "  ang right, occt right", "  ang right, occt WRONG", "  ang WRONG, occt right",
        "  ang WRONG, occt WRONG", "  ang right, occt did not answer", "  ang WRONG, occt did not answer",
        "  ang did not answer, occt right", "  ang did not answer, occt WRONG"};
    for (const auto& kv : cross) {
        std::printf("  case %s\n", kv.first.c_str());
        std::set<std::string> shown;
        for (const char* key : kOrder) {
            const auto it = kv.second.find(key);
            if (it == kv.second.end()) continue;
            std::printf("    %-48s %5d\n", key, it->second);
            shown.insert(key);
        }
        for (const auto& c : kv.second)
            if (!shown.count(c.first)) std::printf("    %-48s %5d\n", c.first.c_str(), c.second);
        const auto it = angOnlyExamples.find(kv.first);
        if (it != angOnlyExamples.end()) {
            std::printf("    ang-only examples:");
            for (const auto& p : it->second) std::printf(" %s", p.c_str());
            std::printf("\n");
        }
    }
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    std::string stepPath, partName, summarizePath;
    bool fixtures = false;
    std::set<std::string> which = {"occt", "arr", "loc", "ang"};
    std::set<std::string> kinds = {"wall", "cyl"};
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--selftest") return selftest();
        else if (a == "--fixtures") fixtures = true;
        else if (a == "--summarize" && i + 1 < argc) summarizePath = argv[++i];
        else if (a == "--aabb=on") forge::native::brep::setForgeNativeAabbEnabled(true);
        else if (a == "--aabb=off") forge::native::brep::setForgeNativeAabbEnabled(false);
        else if (a.rfind("--name=", 0) == 0) partName = a.substr(7);
        else if (a.rfind("--engines=", 0) == 0 || a.rfind("--cases=", 0) == 0) {
            std::set<std::string>& dst = (a.rfind("--engines=", 0) == 0) ? which : kinds;
            dst.clear();
            std::stringstream ss(a.substr(a.find('=') + 1));
            std::string e;
            while (std::getline(ss, e, ',')) if (!e.empty()) dst.insert(e);
        }
        else if (a.rfind("--", 0) != 0) stepPath = a;
        else { std::fprintf(stderr, "unknown option %s\n", a.c_str()); return 2; }
    }
    if (!summarizePath.empty()) return summarize(summarizePath);
    if (fixtures) {
        for (const Case& c : fixtureCases()) runCase(c, which);
        return 0;
    }
    if (stepPath.empty()) {
        std::fprintf(stderr,
            "usage: draft_angle_vs_draft_corpus --selftest\n"
            "       draft_angle_vs_draft_corpus --fixtures [--aabb=on|off] [--engines=occt,arr,loc,ang]\n"
            "       draft_angle_vs_draft_corpus <part.step> [--name=ID] [--engines=...] [--cases=wall,cyl]\n"
            "       draft_angle_vs_draft_corpus --summarize results.jsonl\n");
        return 2;
    }
    return corpusPart(stepPath, partName, which, kinds);
}
