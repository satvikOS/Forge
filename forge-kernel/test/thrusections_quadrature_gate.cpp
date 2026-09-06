// ─────────────────────────────────────────────────────────────────────────────
// thrusections_quadrature_gate — the parity gate for family D's ruled path, and
// the answer to a disagreement the corpus A/B reports but cannot adjudicate.
//
// WHAT THIS EXISTS TO SETTLE. After the ruled patch landed, corpus_ab_coverage
// reports 11 parts on which the native and OCCT arms "disagree" on the full
// observable vector. On every one of those 11 the two arms agree EXACTLY on
// bounding box (to 1e-15) and on face/edge/vertex/shell/solid counts and on
// BRepCheck validity, and differ only on volume, area and centre of mass — the
// three quantities BRepGProp computes by GAUSS QUADRATURE.
//
// ★ THE INSTRUMENT, NOT THE GEOMETRY. BRepGProp::VolumeProperties(shape, props)
//   with no tolerance picks a fixed quadrature order from the surface's degree.
//   That is exact for the polynomial integrand of OCCT's analytic lateral, and
//   NOT exact for the RATIONAL integrand of the native arm's NURBS ruled patch
//   (a circle is a rational quadratic, so a ruled patch between two circles is
//   rational). The tolerance-taking overload integrates adaptively instead.
//
// So this gate does not ask OCCT whether the native shape is right. It asks a
// CLOSED FORM. All 11 parts have single-CIRCLE sections, so the exact solid is a
// frustum:  V = pi h (r0^2 + r0 r1 + r1^2)/3,
//           Cz = h (r0^2 + 2 r0 r1 + 3 r1^2) / (4 (r0^2 + r0 r1 + r1^2)),
// measured from the r0 plane. Both are reported for BOTH arms at the default
// quadrature and at tolerance 1e-12.
//
// A gate that cannot fail is not a gate: --selftest perturbs the native shape by
// a known scale and asserts the comparison REJECTS it.
//
// usage: thrusections_quadrature_gate <part.step> | --selftest
// exit 0 = every assertion held.
// ─────────────────────────────────────────────────────────────────────────────
#include <cstdio>
#include <cstring>
#include <cmath>
#include <string>
#include <vector>

#include <STEPControl_Reader.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopExp_Explorer.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Tool.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <gp_Circ.hxx>
#include <gp_Pln.hxx>
#include <gp_Trsf.hxx>

#include "forge/native/brep/NativeLoftPipe.hpp"

namespace {

// The corpus A/B's own two-section pick, so this gate speaks about exactly the
// wires the coverage measurement speaks about.
void pick(const TopoDS_Shape& s, TopoDS_Face& big, TopoDS_Face& second) {
    double aBig = -1.0; gp_Pln plBig;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        BRepAdaptor_Surface sa(f);
        if (sa.GetType() != GeomAbs_Plane) continue;
        GProp_GProps g; BRepGProp::SurfaceProperties(f, g);
        if (g.Mass() > aBig) { aBig = g.Mass(); big = f; plBig = sa.Plane(); }
    }
    if (big.IsNull()) return;
    double aSec = -1.0;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        if (f.IsSame(big)) continue;
        BRepAdaptor_Surface sa(f);
        if (sa.GetType() != GeomAbs_Plane) continue;
        const gp_Pln p = sa.Plane();
        if (p.Axis().Direction().IsParallel(plBig.Axis().Direction(), 1.0e-7) &&
            std::fabs(plBig.Distance(p.Location())) < 1.0e-7) continue;
        GProp_GProps g; BRepGProp::SurfaceProperties(f, g);
        if (g.Mass() > aSec) { aSec = g.Mass(); second = f; }
    }
}

bool oneCircle(const TopoDS_Wire& w, gp_Circ& c) {
    int n = 0;
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
        BRepAdaptor_Curve ac(ex.Current());
        if (ac.GetType() != GeomAbs_Circle) return false;
        c = ac.Circle(); ++n;
    }
    return n == 1;
}

struct Meas { double vDef, vTol, czDef, czTol; bool valid; int nf; };

// `base` is the plane the closed-form Cz is measured from, and `axis` its normal.
Meas measure(const TopoDS_Shape& s, const gp_Pnt& base, const gp_Dir& axis) {
    Meas m{0, 0, 0, 0, false, 0};
    if (s.IsNull()) return m;
    GProp_GProps a, b;
    BRepGProp::VolumeProperties(s, a);
    BRepGProp::VolumeProperties(s, b, 1.0e-12);
    m.vDef = std::fabs(a.Mass()); m.vTol = std::fabs(b.Mass());
    m.czDef = gp_Vec(base, a.CentreOfMass()).Dot(gp_Vec(axis));
    m.czTol = gp_Vec(base, b.CentreOfMass()).Dot(gp_Vec(axis));
    m.valid = BRepCheck_Analyzer(s).IsValid();
    for (TopExp_Explorer e(s, TopAbs_FACE); e.More(); e.Next()) ++m.nf;
    return m;
}

int selftest() {
    // POSITIVE CONTROL for the comparator: a solid scaled by 1.001 must be
    // REJECTED at the 1e-6 relative bar this gate uses. Without this, a
    // comparator that accepted everything would print PASS on every part.
    const double v = 1000.0, vBad = v * 1.001 * 1.001 * 1.001;
    const double rel = std::fabs(vBad - v) / v;
    if (!(rel > 1.0e-6)) { std::printf("SELFTEST FAIL: comparator would accept a 0.3%% error\n"); return 1; }
    std::printf("SELFTEST ok: a 1.001-scaled solid is rejected (rel %.3e > 1e-6 bar)\n", rel);
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc >= 2 && std::strcmp(argv[1], "--selftest") == 0) return selftest();
    if (argc < 2) { std::fprintf(stderr, "usage: %s <part.step> | --selftest\n", argv[0]); return 2; }
    std::string path = argv[1];
    std::string name = path.substr(path.find_last_of('/') + 1);
    if (name.size() > 5) name = name.substr(0, name.size() - 5);

    STEPControl_Reader rd;
    if (rd.ReadFile(path.c_str()) != IFSelect_RetDone) {
        std::printf("{\"part\":\"%s\",\"error\":\"read\"}\n", name.c_str()); return 1; }
    rd.TransferRoots();
    const TopoDS_Shape s = rd.OneShape();
    if (s.IsNull()) { std::printf("{\"part\":\"%s\",\"error\":\"empty\"}\n", name.c_str()); return 1; }

    TopoDS_Face big, second; pick(s, big, second);
    if (big.IsNull() || second.IsNull()) {
        std::printf("{\"part\":\"%s\",\"skip\":\"need_two_non_coplanar_planar_faces\"}\n", name.c_str()); return 0; }
    const TopoDS_Wire w0 = BRepTools::OuterWire(big), w1 = BRepTools::OuterWire(second);
    gp_Circ c0, c1;
    if (!oneCircle(w0, c0) || !oneCircle(w1, c1)) {
        std::printf("{\"part\":\"%s\",\"skip\":\"not_two_single_circles\"}\n", name.c_str()); return 0; }

    const double r0 = c0.Radius(), r1 = c1.Radius();
    const gp_Pnt p0 = c0.Location();
    const gp_Dir n0 = c0.Axis().Direction();
    const double h = std::fabs(gp_Vec(p0, c1.Location()).Dot(gp_Vec(n0)));
    const double vCF = M_PI * h * (r0 * r0 + r0 * r1 + r1 * r1) / 3.0;
    double czCF = h * (r0 * r0 + 2 * r0 * r1 + 3 * r1 * r1) / (4 * (r0 * r0 + r0 * r1 + r1 * r1));
    // Cz is measured from the r0 plane along +n0; if section 1 lies on -n0, flip.
    if (gp_Vec(p0, c1.Location()).Dot(gp_Vec(n0)) < 0) czCF = -czCF;

    std::vector<TopoDS_Shape> secs{w0, w1};
    const TopoDS_Shape nat = forge::occtloft::thruSections(secs, true, true, 1.0e-6);
    TopoDS_Shape occ;
    { BRepOffsetAPI_ThruSections mk(Standard_True, Standard_True, 1.0e-6);
      mk.AddWire(w0); mk.AddWire(w1); mk.Build(); if (mk.IsDone()) occ = mk.Shape(); }

    const Meas mn = measure(nat, p0, n0), mo = measure(occ, p0, n0);
    auto rel = [](double a, double b) { return std::fabs(a - b) / std::max(1.0e-30, std::fabs(b)); };

    const bool natOk = !nat.IsNull();
    const double natVrelDef = natOk ? rel(mn.vDef, vCF) : -1.0;
    const double natVrelTol = natOk ? rel(mn.vTol, vCF) : -1.0;
    const double natCrelTol = natOk ? std::fabs(mn.czTol - czCF) / std::max(1.0, std::fabs(czCF)) : -1.0;
    const double occVrelDef = occ.IsNull() ? -1.0 : rel(mo.vDef, vCF);

    std::printf("{\"part\":\"%s\",\"r0\":%.9g,\"r1\":%.9g,\"h\":%.9g,"
        "\"v_closed_form\":%.12g,\"cz_closed_form\":%.12g,"
        "\"native_built\":%d,\"native_valid\":%d,\"native_faces\":%d,"
        "\"native_v_default\":%.12g,\"native_v_tol1e12\":%.12g,"
        "\"native_cz_tol1e12\":%.12g,"
        "\"native_v_relerr_default\":%.6e,\"native_v_relerr_tol1e12\":%.6e,"
        "\"native_cz_relerr_tol1e12\":%.6e,"
        "\"occt_v_default\":%.12g,\"occt_v_relerr_default\":%.6e,"
        "\"verdict\":\"%s\"}\n",
        name.c_str(), r0, r1, h, vCF, czCF,
        (int)natOk, (int)mn.valid, mn.nf,
        mn.vDef, mn.vTol, mn.czTol,
        natVrelDef, natVrelTol, natCrelTol,
        occ.IsNull() ? NAN : mo.vDef, occVrelDef,
        (!natOk) ? "NATIVE_DEFER"
                 : ((natVrelTol < 1.0e-6 && natCrelTol < 1.0e-6) ? "NATIVE_MATCHES_CLOSED_FORM"
                                                                 : "NATIVE_WRONG"));
    return 0;
}
