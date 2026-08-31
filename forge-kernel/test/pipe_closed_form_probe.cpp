// ─────────────────────────────────────────────────────────────────────────────
// pipe_closed_form_probe.cpp — is OCCT an ORACLE for TKOffset families E and F
// on the 600-part corpus, or only a participant?
//
// WHY THIS EXISTS. test/corpus_ab_coverage.cpp scores families E (PIPE) and F
// (PIPESHELL) by COVERAGE — "did the arm return a shape" — and the flip gate in
// CMakeLists.txt reads `native % >= occt %`. That gate silently assumes OCCT's
// answer is CORRECT on every part it counts. src/native/brep/NativeLoftPipe.cpp
// :1122-1136 records, from synthetic probes, that it is not:
//
//     "On every BENT polyline spine OCCT either fails BRepCheck_Analyzer
//      outright or returns a shape whose volume is only the FIRST leg's
//      contribution ... while its bounding box spans the whole spine."
//
// That claim is asserted in test/ab_native_loftpipe_occt.cpp on FIVE synthetic
// spines. It has never been measured on the corpus the gate actually scores —
// and the harness builds a BENT spine for EVERY part (spineFromFace, a 2-leg
// polyline with a 30 degree turn). If the claim carries, then family E's "OCCT
// 100.0%" is 100% of a denominator that includes wrong answers, and no flip
// verdict computed against it means what it says.
//
// THE ORACLE. The harness's own input construction makes a closed form exact,
// with no reference to either engine:
//   * the spine is origin -> origin+n*L -> that+n2*L, where origin is the
//     CENTROID of the profile face, n is its normal, L = 0.5*diag, and n2 is n
//     turned 30 degrees (corpus_ab_coverage.cpp:585-599, :1303-1312);
//   * so the profile plane is PERPENDICULAR to leg 0 and the section centroid
//     lies ON the spine — the two hypotheses NativeLoftPipe.cpp:1150-1153 names;
//   * therefore the mitred sweep encloses exactly
//         V = area(profile) * (total spine length) = planarBigArea * diag.
//
// This TU links NO forge object and calls NO forge symbol. It reproduces the
// harness's part import, bbox, `diag` and largest-planar-face pick verbatim
// (including betterFace's centroid tie-break) so that the area and diag it
// reports are the SAME numbers the A/B fed its arms. Compare its `closed_form`
// against the `native.vol` / `occt.vol` already in a corpus A/B results.jsonl.
//
// WHERE THE CLOSED FORM DOES NOT APPLY, stated rather than hidden. A mitred
// sweep whose section is large compared with the leg length folds through
// itself at the bend; the region is then covered twice and its SOLID volume is
// strictly less than area*length. The fold cannot occur while
//     L  >  rmax * tan(theta/2),    theta = 30 degrees,
// where rmax is the greatest distance from the section centroid to the section
// boundary MEASURED ALONG THE TURN DIRECTION (the only direction the mitre
// shears). `fold_free` reports that test per part, so a part where the oracle
// is inapplicable is EXCLUDED by evidence instead of being read as a defect.
//
// POSITIVE CONTROL (--selftest). An instrument that reports "OCCT is wrong"
// on every input is indistinguishable from one that is wrong itself, so the
// probe is required to prove it can say BOTH answers before any corpus number
// is trusted: on a STRAIGHT spine OCCT MakePipe must MATCH the closed form, and
// on the harness's own bent spine it must MISS it. If the straight case does
// not match, the probe — not OCCT — is what is broken, and it exits nonzero.
//
// usage:  pipe_closed_form_probe --selftest
//         pipe_closed_form_probe <part.step> [--name=ID]
// One JSON object per part on stdout. Exit 0 iff the part was measured.
// ─────────────────────────────────────────────────────────────────────────────
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <algorithm>
#include <vector>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <BRep_Tool.hxx>
#include <BRepTools.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Surface.hxx>
#include <Geom_Plane.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <gp_Ax1.hxx>
#include <gp_Trsf.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepCheck_Analyzer.hxx>

namespace {

const double kPi = 3.14159265358979323846;

// ── verbatim from test/corpus_ab_coverage.cpp ───────────────────────────────
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
TopoDS_Wire spineFromFace(const gp_Pnt& origin, const gp_Dir& n, double len,
                          gp_Dir* turnAxisOut) {
    gp_Dir perp(1, 0, 0);
    if (std::fabs(n.Dot(gp_Dir(1, 0, 0))) > 0.9) perp = gp_Dir(0, 1, 0);
    const gp_Dir axis = n.Crossed(perp);
    if (turnAxisOut) *turnAxisOut = axis;
    gp_Trsf rot;
    rot.SetRotation(gp_Ax1(origin, axis), 30.0 * kPi / 180.0);
    gp_Dir n2 = n;
    n2.Transform(rot);
    const gp_Pnt p1 = origin.Translated(gp_Vec(n) * len);
    const gp_Pnt p2 = p1.Translated(gp_Vec(n2) * len);
    BRepBuilderAPI_MakePolygon mp;
    mp.Add(origin); mp.Add(p1); mp.Add(p2);
    if (!mp.IsDone()) return TopoDS_Wire();
    return mp.Wire();
}

double volumeOf(const TopoDS_Shape& s) {
    if (s.IsNull()) return -1.0;
    GProp_GProps g;
    try { BRepGProp::VolumeProperties(s, g); } catch (...) { return -1.0; }
    return std::fabs(g.Mass());
}
int validOf(const TopoDS_Shape& s) {
    if (s.IsNull()) return -1;
    try { BRepCheck_Analyzer an(s); return an.IsValid() ? 1 : 0; } catch (...) { return -1; }
}

// OCCT's MakePipe arm, EXACTLY as corpus_ab_coverage.cpp:1321-1326 runs it.
TopoDS_Shape occtPipe(const TopoDS_Wire& spine, const TopoDS_Face& prof) {
    try {
        BRepOffsetAPI_MakePipe mk(spine, prof);
        mk.Build();
        if (!mk.IsDone()) return TopoDS_Shape();
        return mk.Shape();
    } catch (...) { return TopoDS_Shape(); }
}

// The greatest extent of the section from its centroid ALONG THE TURN
// DIRECTION. The mitre plane at the bend bisects the 30 degree turn and shears
// the section only in that direction, so this — not the section's overall
// radius — is what decides whether the swept body folds through itself.
double sectionReachAlongTurn(const TopoDS_Face& f, const gp_Pnt& c, const gp_Dir& turnDir) {
    double reach = 0.0;
    for (TopExp_Explorer ex(f, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        reach = std::max(reach, std::fabs(gp_Vec(c, p).Dot(gp_Vec(turnDir))));
    }
    return reach;
}

int selftest() {
    // A 10 x 10 square in the z = 0 plane, centroid at the origin, normal +z.
    // Closed form for a sweep of length L: 100 * L.
    BRepBuilderAPI_MakePolygon mp;
    mp.Add(gp_Pnt(-5, -5, 0)); mp.Add(gp_Pnt(5, -5, 0));
    mp.Add(gp_Pnt(5, 5, 0));   mp.Add(gp_Pnt(-5, 5, 0));
    mp.Close();
    if (!mp.IsDone()) { std::printf("SELFTEST FAIL: profile wire\n"); return 1; }
    BRepBuilderAPI_MakeFace mf(mp.Wire(), Standard_True);
    if (!mf.IsDone()) { std::printf("SELFTEST FAIL: profile face\n"); return 1; }
    const TopoDS_Face prof = mf.Face();
    const double area = faceArea(prof);
    if (std::fabs(area - 100.0) > 1e-9) {
        std::printf("SELFTEST FAIL: area %.12g != 100\n", area); return 1;
    }
    const double L = 25.0;
    int bad = 0;

    // (1) STRAIGHT spine — OCCT MUST agree with the closed form. If it does
    //     not, this probe's oracle is wrong and nothing below it can be read.
    {
        BRepBuilderAPI_MakePolygon sp;
        sp.Add(gp_Pnt(0, 0, 0)); sp.Add(gp_Pnt(0, 0, L));
        const TopoDS_Shape s = occtPipe(sp.Wire(), prof);
        const double v = volumeOf(s);
        const double cf = area * L;
        const double rel = (v < 0.0) ? 1.0 : std::fabs(v - cf) / cf;
        std::printf("  straight spine: occt vol=%.10g closed form=%.10g rel=%.3e valid=%d  %s\n",
                    v, cf, rel, validOf(s), rel <= 1e-9 ? "MATCH (oracle sane)" : "MISMATCH");
        if (!(rel <= 1e-9)) {
            std::printf("SELFTEST FAIL: the ORACLE disagrees with OCCT on a STRAIGHT spine.\n"
                        "  That is a defect in THIS PROBE, not in OCCT. No corpus number below\n"
                        "  this line may be read as evidence about OCCT.\n");
            bad = 1;
        }
    }
    // (2) The harness's own BENT spine — the probe must be able to say "miss".
    {
        gp_Dir turnAxis;
        const TopoDS_Wire sw = spineFromFace(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), L, &turnAxis);
        const TopoDS_Shape s = occtPipe(sw, prof);
        const double v = volumeOf(s);
        const double cf = area * 2.0 * L;
        const double rel = (v < 0.0) ? 1.0 : std::fabs(v - cf) / cf;
        std::printf("  bent spine    : occt vol=%.10g closed form=%.10g rel=%.3e valid=%d  %s\n",
                    v, cf, rel, validOf(s), rel <= 1e-9 ? "MATCH" : "MISS");
        std::printf("  first-leg-only volume would be %.10g (rel to closed form %.3e)\n",
                    area * L, std::fabs(area * L - cf) / cf);
        if (rel <= 1e-9) {
            std::printf("NOTE: OCCT MATCHED the closed form on the bent spine. The corpus\n"
                        "      result must then be read as OCCT being CORRECT, not broken.\n");
        }
    }
    std::printf("%s\n", bad ? "SELFTEST FAIL" : "SELFTEST PASS (probe can say both MATCH and MISS)");
    return bad;
}

}  // namespace

int main(int argc, char** argv) {
    std::string stepPath, partName;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--selftest") return selftest();
        else if (a.rfind("--name=", 0) == 0) partName = a.substr(7);
        else if (a.rfind("--", 0) != 0) stepPath = a;
    }
    if (stepPath.empty()) {
        std::fprintf(stderr, "usage: pipe_closed_form_probe <part.step> [--name=ID] | --selftest\n");
        return 2;
    }
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
            std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", partName.c_str());
            return 1;
        }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
    }
    if (shape.IsNull()) {
        std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", partName.c_str());
        return 1;
    }
    double bb[6];
    if (!boundsOf(shape, bb)) {
        std::printf("{\"part\":\"%s\",\"error\":\"no_vertices\"}\n", partName.c_str());
        return 1;
    }
    const double dx = bb[3] - bb[0], dy = bb[4] - bb[1], dz = bb[5] - bb[2];
    const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    if (!(diag > 0.0)) {
        std::printf("{\"part\":\"%s\",\"error\":\"degenerate_bbox\"}\n", partName.c_str());
        return 1;
    }

    TopoDS_Face planarBig; double planarBigArea = 0.0; gp_Pln planarBigPln;
    {
        TopTools_IndexedMapOfShape fm;
        TopExp::MapShapes(shape, TopAbs_FACE, fm);
        for (int i = 1; i <= fm.Extent(); ++i) {
            const TopoDS_Face f = TopoDS::Face(fm(i));
            const double a = faceArea(f);
            if (!(a > 0.0)) continue;
            gp_Pln pl;
            if (!planeOf(f, pl)) continue;
            if (betterFace(f, a, planarBig, planarBigArea)) {
                planarBig = f; planarBigArea = a; planarBigPln = pl;
            }
        }
    }
    if (planarBig.IsNull()) {
        std::printf("{\"part\":\"%s\",\"applicable\":false,\"na_reason\":\"no_planar_face\"}\n",
                    partName.c_str());
        return 0;
    }

    const double len = 0.5 * diag;
    const gp_Pnt origin = faceCentroid(planarBig);
    const gp_Dir n = planarBigPln.Axis().Direction();
    gp_Dir turnAxis;
    const TopoDS_Wire spine = spineFromFace(origin, n, len, &turnAxis);
    if (spine.IsNull()) {
        std::printf("{\"part\":\"%s\",\"applicable\":false,\"na_reason\":\"no_spine\"}\n",
                    partName.c_str());
        return 0;
    }
    // The turn happens in the plane spanned by n and (turnAxis x n); the mitre
    // shears the section along that second direction.
    const gp_Dir turnDir = turnAxis.Crossed(n);
    const double reach = sectionReachAlongTurn(planarBig, origin, turnDir);
    const double foldLimit = reach * std::tan(15.0 * kPi / 180.0);
    const int foldFree = (len > foldLimit) ? 1 : 0;

    const double closedForm = planarBigArea * (2.0 * len);

    // OCCT's own arm, re-run here so this file is self-contained evidence.
    const TopoDS_Shape oc = occtPipe(spine, planarBig);
    const double ocVol = volumeOf(oc);
    const int    ocValid = validOf(oc);
    const double ocRel = (ocVol < 0.0) ? -1.0 : std::fabs(ocVol - closedForm) / closedForm;
    // The specific defect NativeLoftPipe.cpp names: volume == FIRST LEG ONLY.
    const double firstLegOnly = planarBigArea * len;
    const double ocRelFirstLeg =
        (ocVol < 0.0) ? -1.0 : std::fabs(ocVol - firstLegOnly) / firstLegOnly;

    std::printf(
        "{\"part\":\"%s\",\"applicable\":true,\"diag\":%.10g,\"profile_area\":%.10g,"
        "\"leg_len\":%.10g,\"spine_len\":%.10g,\"closed_form\":%.10g,"
        "\"section_reach_along_turn\":%.10g,\"fold_limit\":%.10g,\"fold_free\":%s,"
        "\"occt_vol\":%.10g,\"occt_valid\":%d,\"occt_rel_closed_form\":%.10g,"
        "\"first_leg_only\":%.10g,\"occt_rel_first_leg\":%.10g}\n",
        partName.c_str(), diag, planarBigArea, len, 2.0 * len, closedForm,
        reach, foldLimit, foldFree ? "true" : "false",
        ocVol, ocValid, ocRel, firstLegOnly, ocRelFirstLeg);
    return 0;
}
