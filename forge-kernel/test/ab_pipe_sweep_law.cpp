// forge-kernel/test/ab_pipe_sweep_law.cpp
//
// WHY THIS FILE EXISTS.  The 600-part corpus A/B measures families E (PIPE) and
// F (PIPESHELL) with native and OCCT disagreeing on 599 of 599 shared successes
// at a volume ratio that is a CLOSED FORM, not noise:
//
//     E PIPE       native/occt   min 1.071797  p50 1.071797  max 1.071797
//     F PIPESHELL  native/occt   min 1.055405  p50 1.071797  max 1.097498
//     2 / (1 + cos 30 deg) = 1.0717967697244908
//
// reports/TKOFFSET_EF_PARITY_AND_THE_WRONG_GATE.md identified the LAW behind
// that constant -- native encloses A*(L1+L2), OCCT encloses A*(L1+L2*cos theta)
// -- and then declined to say which arm is RIGHT, calling it "a product
// decision".  It also left three questions open, each of which decides how the
// flip gate for these two families can be written at all:
//
//   Q1  Is there ANY configuration of BRepOffsetAPI_MakePipe -- family E's OCCT
//       arm -- that computes the mitre?  MakePipeShell has SetTransitionMode
//       (RightCorner) and family F's PIPESHELL_RC row uses it.  MakePipe has no
//       transition mode at all; it has a GeomFill_Trihedron argument, which
//       nothing in this repository has ever varied.  If no mode reproduces the
//       mitre, then family E's gate CANNOT be repaired by configuring OCCT and
//       has to be scored against a closed form instead.
//
//   Q2  Why is family F's ratio a SPREAD (1.0554-1.0975) where family E's is a
//       constant to nine figures?  Corpus-side this is now localised: all 215
//       parts whose PIPESHELL ratio departs from 2/(1+cos30) by more than 1e-6
//       have a largest planar face with INNER WIRES, and on all 215 of them
//       native equals OCCT(RightCorner) to 1e-6.  So it is OCCT's DEFAULT-mode
//       arm that departs from its own cosine law, not native.  That is an
//       attribution from stored numbers; this file reproduces the mechanism
//       from scratch on a synthetic holed face, where the outer-wire area is
//       known in closed form and neither engine has to be believed.
//
//   Q3  NativeLoftPipe.cpp's banner states the mitre closed form V = A * (total
//       spine length) holds "with the profile centroid ON the spine start".
//       Derived below it holds for ANY in-plane offset of the section from the
//       spine: the two legs' offset terms cancel identically.  A closed form
//       with an unnecessary hypothesis attached is a closed form nobody can use
//       on family F, whose profile is an outer WIRE while the spine starts at
//       the FACE centroid -- so this is not a pedantic point, it is the reason
//       reports/.../pipe_closed_form_probe declares itself "out of scope for F".
//
// WHICH ARM IS CORRECT, and how this file decides it WITHOUT an appeal to
// authority.  A sweep of a constant profile along a spine is defined by one
// property: the solid's cross-section PERPENDICULAR TO THE SPINE equals the
// profile everywhere.  That is measurable -- clip the solid with a slab normal
// to leg 2 and divide by the slab thickness -- and it is measured here on both
// arms rather than argued.  Two further properties follow from it and are also
// measured, because either one alone refutes the translation law:
//
//   * MONOTONICITY.  Lengthening leg 2 must not DECREASE the enclosed volume.
//     Under A*(L1 + L2*cos theta) with theta > 90 deg the volume falls as the
//     spine grows.
//   * NON-DEGENERACY.  At theta = 90 deg the translation law contributes
//     EXACTLY ZERO volume for leg 2, while the shape's bounding box still spans
//     it -- a solid that reports material it does not enclose.
//
// CONTROLS, both directions, before any verdict:
//   POSITIVE  theta = 0 (straight spine).  The two laws coincide there, so the
//             arms MUST agree.  Without this, a harness comparing one binary to
//             itself would be indistinguishable from this result.
//   NEGATIVE  the same volume comparator is fed two solids of EQUAL volume and
//             different geometry and must REJECT them.
//   ORACLE    the section-area probe is checked on a right prism, where the
//             answer is the profile area by construction.
//
// BUILD + RUN: test/run_ab_pipe_sweep_law.sh
// Exit 0 iff every assertion holds.

#include "forge/native/brep/NativeLoftPipe.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_TransitionMode.hxx>
#include <BRepTools.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GeomFill_Trihedron.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

namespace {

const double kPi = 3.14159265358979323846;

int gPass = 0, gFail = 0;
void check(bool ok, const std::string& what) {
    (ok ? gPass : gFail)++;
    std::printf("  [%s] %s\n", ok ? "PASS" : "FAIL", what.c_str());
}

double volumeOf(const TopoDS_Shape& s) {
    if (s.IsNull()) return -1.0;
    GProp_GProps g;
    BRepGProp::VolumeProperties(s, g);
    return std::fabs(g.Mass());
}

int validOf(const TopoDS_Shape& s) {
    if (s.IsNull()) return -1;
    try { return BRepCheck_Analyzer(s).IsValid() ? 1 : 0; } catch (...) { return -1; }
}

double relDiff(double a, double b) {
    const double d = std::fabs(b) > 1e-12 ? std::fabs(b) : 1.0;
    return std::fabs(a - b) / d;
}

// ── the corpus harness's OWN spine, generalised in the two parameters the
// corpus hard-codes.  corpus_ab_coverage.cpp:588-602 builds exactly this with
// turnDeg = 30 and L2 == L1; nothing else here differs from it.
TopoDS_Wire twoLegSpine(const gp_Pnt& origin, const gp_Dir& n,
                        double L1, double L2, double turnDeg) {
    gp_Dir perp(1, 0, 0);
    if (std::fabs(n.Dot(gp_Dir(1, 0, 0))) > 0.9) perp = gp_Dir(0, 1, 0);
    const gp_Dir axis = n.Crossed(perp);
    gp_Trsf rot;
    rot.SetRotation(gp_Ax1(origin, axis), turnDeg * kPi / 180.0);
    gp_Dir n2 = n;
    n2.Transform(rot);
    const gp_Pnt p1 = origin.Translated(gp_Vec(n) * L1);
    const gp_Pnt p2 = p1.Translated(gp_Vec(n2) * L2);
    BRepBuilderAPI_MakePolygon mp;
    mp.Add(origin); mp.Add(p1); mp.Add(p2);
    if (!mp.IsDone()) return TopoDS_Wire();
    return mp.Wire();
}

// leg-2 unit direction, for the perpendicular-section probe
gp_Dir leg2Dir(const gp_Dir& n, double turnDeg) {
    gp_Dir perp(1, 0, 0);
    if (std::fabs(n.Dot(gp_Dir(1, 0, 0))) > 0.9) perp = gp_Dir(0, 1, 0);
    const gp_Dir axis = n.Crossed(perp);
    gp_Trsf rot;
    rot.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), axis), turnDeg * kPi / 180.0);
    gp_Dir n2 = n;
    n2.Transform(rot);
    return n2;
}

// A square of side `s` in the plane z = 0, centred at (cx, cy).  Area s*s.
TopoDS_Wire squareWire(double s, double cx, double cy) {
    const double h = 0.5 * s;
    BRepBuilderAPI_MakePolygon mp;
    mp.Add(gp_Pnt(cx - h, cy - h, 0));
    mp.Add(gp_Pnt(cx + h, cy - h, 0));
    mp.Add(gp_Pnt(cx + h, cy + h, 0));
    mp.Add(gp_Pnt(cx - h, cy + h, 0));
    mp.Close();
    return mp.Wire();
}

TopoDS_Face faceOf(const TopoDS_Wire& w) {
    BRepBuilderAPI_MakeFace mf(gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), w);
    return mf.IsDone() ? mf.Face() : TopoDS_Face();
}

// A square with ONE circular hole.  Face area = s*s - pi*r*r; the OUTER WIRE
// bounds s*s.  This is the family-E / family-F input split in miniature.
TopoDS_Face squareWithHole(double s, double r, double hx, double hy) {
    BRepBuilderAPI_MakeFace mf(gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), squareWire(s, 0, 0));
    if (!mf.IsDone()) return TopoDS_Face();
    const gp_Circ c(gp_Ax2(gp_Pnt(hx, hy, 0), gp_Dir(0, 0, 1)), r);
    BRepBuilderAPI_MakeWire mw(BRepBuilderAPI_MakeEdge(c).Edge());
    if (!mw.IsDone()) return TopoDS_Face();
    TopoDS_Wire hole = mw.Wire();
    hole.Reverse();
    mf.Add(hole);
    return mf.IsDone() ? mf.Face() : TopoDS_Face();
}

// ── ARMS ────────────────────────────────────────────────────────────────────
TopoDS_Shape occtPipe(const TopoDS_Wire& sp, const TopoDS_Shape& prof) {
    try {
        BRepOffsetAPI_MakePipe mk(sp, prof);          // 2-arg: corpus call, verbatim
        mk.Build();
        if (!mk.IsDone()) return TopoDS_Shape();
        return mk.Shape();
    } catch (...) { return TopoDS_Shape(); }
}

TopoDS_Shape occtPipeMode(const TopoDS_Wire& sp, const TopoDS_Shape& prof,
                          GeomFill_Trihedron mode) {
    try {
        BRepOffsetAPI_MakePipe mk(sp, prof, mode, Standard_False);
        mk.Build();
        if (!mk.IsDone()) return TopoDS_Shape();
        return mk.Shape();
    } catch (...) { return TopoDS_Shape(); }
}

TopoDS_Shape occtPipeShell(const TopoDS_Wire& sp, const TopoDS_Wire& pw,
                           bool setRightCorner) {
    try {
        BRepOffsetAPI_MakePipeShell mk(sp);
        if (setRightCorner) mk.SetTransitionMode(BRepBuilderAPI_RightCorner);
        mk.Add(pw);
        mk.Build();
        if (!mk.IsDone()) return TopoDS_Shape();
        mk.MakeSolid();
        return mk.Shape();
    } catch (...) { return TopoDS_Shape(); }
}

TopoDS_Shape nativePipe(const TopoDS_Wire& sp, const TopoDS_Shape& prof) {
    try { return forge::occtloft::pipe(sp, prof, 1.0e-6); }
    catch (...) { return TopoDS_Shape(); }
}

TopoDS_Shape nativePipeShell(const TopoDS_Wire& sp, const TopoDS_Shape& prof) {
    try {
        const std::vector<TopoDS_Wire> g;
        return forge::occtloft::pipeShell(sp, prof, g, true, 1.0e-6);
    } catch (...) { return TopoDS_Shape(); }
}

// ── THE SECTION PROBE.  Cross-section area PERPENDICULAR TO A DIRECTION,
// measured by clipping the solid with a slab of thickness h normal to `d`,
// centred on `at`, and dividing the clipped volume by h.  Exact for a solid
// that is prismatic across the slab -- which every arm here is, away from the
// corner and the ends.  It uses TKBO booleans and a plain box: it touches
// neither TKOffset nor the native engine, so its verdict cannot be an artefact
// of the thing it judges.
double sectionAreaNormalTo(const TopoDS_Shape& solid, const gp_Pnt& at,
                           const gp_Dir& d, double h, double halfWidth) {
    if (solid.IsNull()) return -1.0;
    try {
        gp_Dir u(1, 0, 0);
        if (std::fabs(d.Dot(u)) > 0.9) u = gp_Dir(0, 1, 0);
        const gp_Dir v = d.Crossed(u);
        u = v.Crossed(d);
        // box spanning [-halfWidth, halfWidth]^2 across, [-h/2, h/2] along d
        const gp_Pnt corner = at.Translated(gp_Vec(u) * (-halfWidth))
                                .Translated(gp_Vec(v) * (-halfWidth))
                                .Translated(gp_Vec(d) * (-0.5 * h));
        BRepPrimAPI_MakeBox mb(gp_Ax2(corner, d, u), 2.0 * halfWidth, 2.0 * halfWidth, h);
        const TopoDS_Shape slab = mb.Shape();
        const TopoDS_Shape cut = BRepAlgoAPI_Common(solid, slab).Shape();
        const double v2 = volumeOf(cut);
        if (v2 < 0.0) return -1.0;
        return v2 / h;
    } catch (...) { return -1.0; }
}

double bboxSpanAlong(const TopoDS_Shape& s, const gp_Dir& d) {
    if (s.IsNull()) return -1.0;
    double lo = 1e300, hi = -1e300;
    for (TopExp_Explorer e(s, TopAbs_VERTEX); e.More(); e.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(e.Current()));
        const double t = gp_Vec(p.XYZ()).Dot(gp_Vec(d));
        if (t < lo) lo = t;
        if (t > hi) hi = t;
    }
    return (hi < lo) ? -1.0 : hi - lo;
}

const char* kModeName[] = {"CorrectedFrenet", "Fixed", "Frenet", "ConstantNormal",
                           "Darboux", "GuideAC", "GuidePlan", "GuideACWithContact",
                           "GuidePlanWithContact", "DiscreteTrihedron"};

}  // namespace

int main() {
    std::printf("== ab_pipe_sweep_law: where 2/(1+cos30) enters, and which arm is a sweep ==\n");
    const gp_Dir nz(0, 0, 1);
    const double S = 10.0;            // profile side
    const double A = S * S;           // profile area, exactly
    const double L = 50.0;            // leg length; L >> S/2*tan(theta/2), so fold-free

    // ══════════════════════════════════════════════════════════════════ 0
    std::printf("\n-- 0. ORACLE CONTROL: the section probe on a right prism --\n");
    {
        const TopoDS_Wire sp = twoLegSpine(gp_Pnt(0, 0, 0), nz, L, L, 0.0);
        const TopoDS_Face pf = faceOf(squareWire(S, 0, 0));
        const TopoDS_Shape pr = occtPipe(sp, pf);
        const double a = sectionAreaNormalTo(pr, gp_Pnt(0, 0, 0.5 * L), nz, 1.0, 5.0 * S);
        check(relDiff(a, A) < 1e-9,
              "section probe on a straight prism reads the profile area "
              "(" + std::to_string(a) + " vs " + std::to_string(A) + ")");
        // NEGATIVE CONTROL for the volume comparator: equal volume, different solid.
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(volumeOf(pr) / 25.0, 5.0, 5.0).Shape();
        check(relDiff(volumeOf(box), volumeOf(pr)) < 1e-9 &&
                  relDiff(bboxSpanAlong(box, nz), bboxSpanAlong(pr, nz)) > 1e-3,
              "NEGATIVE CONTROL: a box of the SAME volume has a different extent, "
              "so equal volume alone is not read as agreement");
    }

    // ══════════════════════════════════════════════════════════════════ 1
    // THE LAW.  Two closed forms, over a grid of turn angles and leg ratios.
    std::printf("\n-- 1. THE TWO SWEEP LAWS, over 5 turn angles x 3 leg ratios --\n");
    std::printf("   %-7s %-7s | %-14s %-14s | %-14s %-14s | %s\n",
                "theta", "L2/L1", "native", "A*(L1+L2)", "occt", "A*(L1+L2cos)", "ratio");
    {
        const double thetas[] = {0.0, 15.0, 30.0, 45.0, 60.0};
        const double ratios[] = {0.5, 1.0, 2.0};
        int natFit = 0, occFit = 0, n = 0;
        for (double th : thetas) {
            for (double lr : ratios) {
                const double L1 = L, L2 = L * lr;
                const TopoDS_Wire sp = twoLegSpine(gp_Pnt(0, 0, 0), nz, L1, L2, th);
                const TopoDS_Face pf = faceOf(squareWire(S, 0, 0));
                const double mitre = A * (L1 + L2);
                const double trans = A * (L1 + L2 * std::cos(th * kPi / 180.0));
                const double vn = volumeOf(nativePipe(sp, pf));
                const double vo = volumeOf(occtPipe(sp, pf));
                ++n;
                if (vn > 0 && relDiff(vn, mitre) < 1e-9) ++natFit;
                if (vo > 0 && relDiff(vo, trans) < 1e-7) ++occFit;
                std::printf("   %-7.1f %-7.2f | %-14.6f %-14.6f | %-14.6f %-14.6f | %.10f\n",
                            th, lr, vn, mitre, vo, trans, (vo > 0 ? vn / vo : -1.0));
            }
        }
        check(natFit == n, "native MakePipe encloses A*(L1+L2) -- the MITRE -- on " +
                               std::to_string(natFit) + "/" + std::to_string(n) + " cases");
        check(occFit == n, "OCCT  MakePipe encloses A*(L1+L2*cos theta) -- a TRANSLATION -- on " +
                               std::to_string(occFit) + "/" + std::to_string(n) + " cases");
    }

    // ══════════════════════════════════════════════════════════════════ 2
    std::printf("\n-- 2. THE CONSTANT, and its POSITIVE CONTROL at theta = 0 --\n");
    {
        const TopoDS_Face pf = faceOf(squareWire(S, 0, 0));
        const TopoDS_Wire sp30 = twoLegSpine(gp_Pnt(0, 0, 0), nz, L, L, 30.0);
        const double r30 = volumeOf(nativePipe(sp30, pf)) / volumeOf(occtPipe(sp30, pf));
        const double K = 2.0 / (1.0 + std::cos(30.0 * kPi / 180.0));
        std::printf("   ratio at theta=30, L1=L2 : %.12f   2/(1+cos30) = %.12f\n", r30, K);
        check(relDiff(r30, K) < 1e-9,
              "native/occt at the corpus spine is EXACTLY 2/(1+cos 30 deg) = 1.0717967697");
        const TopoDS_Wire sp0 = twoLegSpine(gp_Pnt(0, 0, 0), nz, L, L, 0.0);
        const double r0 = volumeOf(nativePipe(sp0, pf)) / volumeOf(occtPipe(sp0, pf));
        check(relDiff(r0, 1.0) < 1e-9,
              "POSITIVE CONTROL: on a STRAIGHT spine the two arms AGREE exactly "
              "(ratio " + std::to_string(r0) + ")");
    }

    // ══════════════════════════════════════════════════════════════════ 3
    // Q3.  The mitre closed form and its OFFSET term -- which is the SAME
    // factor 2/(1+cos theta) that separates the two arms.
    //
    // DERIVED.  Section plane perpendicular to d1; r = a section point's offset
    // from the spine start, so r . d1 = 0.  The mitre plane at the corner has
    // normal n = normalize(d1 + d2) through the corner C = S + L1*d1
    // (NativeLoftPipe.cpp, "THE MITRE, derived").  The point reaches it at
    //     t1 = ((C - p0) . n) / (d1 . n) = L1 - (r . n)/(d1 . n),
    // is FIXED by the reflection there, and runs on to the final station plane
    // (through C + L2*d2, normal d2) at
    //     t2 = L2 + L1*c - r.d2 - c*t1,      c = d1 . d2 = cos theta.
    // With n . d1 = sqrt((1+c)/2) and r . n = (r . d2)/sqrt(2(1+c)),
    //     (r . n)/(d1 . n) = (r . d2)/(1 + c),
    // and the two lines collapse to
    //
    //     path(r) = L1 + L2 - 2 (r . d2) / (1 + cos theta).
    //
    // The map is AFFINE in r, so integrating over the section replaces r by the
    // AREA CENTROID rbar and
    //
    //     V_mitre = A * [ (L1 + L2) - 2 (rbar . d2) / (1 + cos theta) ].          (*)
    //
    // TWO DIRECTIONS, and this is the point of the section: (*) must FIT at every
    // offset, and the uncorrected form A*(L1+L2) that NativeLoftPipe.cpp's banner
    // states must fit ONLY at offset 0.  A closed form that fits everything is not
    // being tested.
    std::printf("\n-- 3. Q3: the mitre closed form carries an OFFSET term, in 2/(1+cos) --\n");
    {
        const double offs[] = {0.0, 3.0, 12.0, 40.0};
        const double th = 30.0, c = std::cos(th * kPi / 180.0);
        const gp_Dir d2 = leg2Dir(nz, th);
        int corrOK = 0, uncorrOK = 0, occOK = 0, n = 0;
        const double trans = A * (L + L * c);
        std::printf("   %-8s %-15s %-15s %-11s %-15s %s\n", "offset", "native",
                    "A*[2L-2r.d2/(1+c)]", "rel", "A*(L1+L2)", "rel(uncorrected)");
        for (double off : offs) {
            // spine start at the ORIGIN; the section centroid moved off it by `off`
            // IN ITS OWN PLANE.  Same spine every time, so only the offset varies.
            const TopoDS_Wire sp = twoLegSpine(gp_Pnt(0, 0, 0), nz, L, L, th);
            const TopoDS_Face pf = faceOf(squareWire(S, off, 0));
            const double rd2 = off * d2.X();          // rbar . d2, rbar = (off,0,0)
            const double corrected = A * ((L + L) - 2.0 * rd2 / (1.0 + c));
            const double uncorrected = A * (L + L);
            const double vn = volumeOf(nativePipe(sp, pf));
            const double vo = volumeOf(occtPipe(sp, pf));
            ++n;
            if (vn > 0 && relDiff(vn, corrected) < 1e-9) ++corrOK;
            if (vn > 0 && relDiff(vn, uncorrected) < 1e-9) ++uncorrOK;
            if (vo > 0 && relDiff(vo, trans) < 1e-7) ++occOK;
            std::printf("   %-8.1f %-15.6f %-15.6f %-11.3e %-15.6f %.3e\n",
                        off, vn, corrected, relDiff(vn, corrected),
                        uncorrected, relDiff(vn, uncorrected));
        }
        check(corrOK == n,
              "the OFFSET-CORRECTED mitre form V = A*[(L1+L2) - 2(rbar.d2)/(1+cos theta)] "
              "fits on " + std::to_string(corrOK) + "/" + std::to_string(n) + " offsets");
        check(uncorrOK == 1,
              "NEGATIVE DIRECTION: the uncorrected form A*(L1+L2) fits on " +
                  std::to_string(uncorrOK) + "/" + std::to_string(n) +
                  " -- only at offset 0, so the offset term is doing real work and the "
                  "banner's 'centroid ON the spine start' hypothesis is load-bearing");
        check(occOK == n,
              "the TRANSLATION law A*(L1+L2*cos theta) is by contrast OFFSET-INDEPENDENT (" +
                  std::to_string(occOK) + "/" + std::to_string(n) + ")");
    }

    // ══════════════════════════════════════════════════════════════════ 4
    // WHICH ARM IS A SWEEP.  Perpendicular cross-section on leg 2.
    std::printf("\n-- 4. WHICH ARM IS A SWEEP: cross-section PERPENDICULAR to leg 2 --\n");
    {
        const double th = 30.0;
        const double c = std::cos(th * kPi / 180.0);
        const TopoDS_Wire sp = twoLegSpine(gp_Pnt(0, 0, 0), nz, L, L, th);
        const TopoDS_Face pf = faceOf(squareWire(S, 0, 0));
        const gp_Dir d2 = leg2Dir(nz, th);
        const gp_Pnt corner(0, 0, L);
        const gp_Pnt mid2 = corner.Translated(gp_Vec(d2) * (0.5 * L));
        const double an = sectionAreaNormalTo(nativePipe(sp, pf), mid2, d2, 1.0, 6.0 * S);
        const double ao = sectionAreaNormalTo(occtPipe(sp, pf), mid2, d2, 1.0, 6.0 * S);
        std::printf("   profile area A = %.6f\n", A);
        std::printf("   native  perpendicular section on leg 2 = %.6f   (A      = %.6f)\n", an, A);
        std::printf("   occt    perpendicular section on leg 2 = %.6f   (A*cos  = %.6f)\n", ao, A * c);
        check(relDiff(an, A) < 1e-6,
              "NATIVE presents the PROFILE perpendicular to leg 2 -- it is a sweep");
        check(relDiff(ao, A * c) < 1e-6,
              "OCCT presents A*cos(theta) perpendicular to leg 2 -- the section is "
              "translated, not swept, so the solid is NOT of constant cross-section");
    }

    // ══════════════════════════════════════════════════════════════════ 5
    std::printf("\n-- 5. THE TRANSLATION LAW IS NOT A SWEEP: degeneracy and non-monotonicity --\n");
    {
        // (a) theta = 90: leg 2 contributes EXACTLY zero volume, and the bbox still spans it.
        const TopoDS_Wire sp90 = twoLegSpine(gp_Pnt(0, 0, 0), nz, L, L, 90.0);
        const TopoDS_Face pf = faceOf(squareWire(S, 0, 0));
        const TopoDS_Shape o90 = occtPipe(sp90, pf);
        const TopoDS_Shape n90 = nativePipe(sp90, pf);
        const gp_Dir d2 = leg2Dir(nz, 90.0);
        const double vo = volumeOf(o90), vn = volumeOf(n90);
        const double spanO = bboxSpanAlong(o90, d2), spanN = bboxSpanAlong(n90, d2);
        std::printf("   theta=90  occt vol %.6f (A*L1 = %.6f)  extent along leg2 %.4f  valid=%d\n",
                    vo, A * L, spanO, validOf(o90));
        std::printf("   theta=90  nat  vol %.6f (A*2L = %.6f)  extent along leg2 %.4f  valid=%d\n",
                    vn, A * 2 * L, spanN, validOf(n90));
        check(relDiff(vo, A * L) < 1e-6 && spanO > 0.9 * L,
              "at theta=90 OCCT encloses ONLY leg 1's volume while its extent along leg 2 "
              "is " + std::to_string(spanO) + " -- material reported and not enclosed");
        check(relDiff(vn, A * 2 * L) < 1e-6,
              "at theta=90 native still encloses A*(L1+L2)");

        // (b) theta = 120: enclosing LESS as the spine gets LONGER.
        std::printf("   theta=120, growing leg 2:\n");
        double prevO = 1e300, prevN = -1.0;
        bool occFalls = true, natRises = true;
        for (double lr : {0.4, 0.8, 1.2}) {
            const TopoDS_Wire sp = twoLegSpine(gp_Pnt(0, 0, 0), nz, L, L * lr, 120.0);
            const double a = volumeOf(occtPipe(sp, pf));
            const double b = volumeOf(nativePipe(sp, pf));
            std::printf("     L2 = %.0f   occt %.4f   native %.4f\n", L * lr, a, b);
            if (!(a >= 0 && a < prevO)) occFalls = false;
            if (!(b > prevN)) natRises = false;
            prevO = a; prevN = b;
        }
        check(occFalls,
              "OCCT's enclosed volume DECREASES as leg 2 is lengthened at theta=120 -- "
              "a sweep cannot lose volume when spine is added");
        check(natRises, "native's enclosed volume increases monotonically with leg 2");
    }

    // ══════════════════════════════════════════════════════════════════ 6
    // Q1.  Can family E's OCCT arm be CONFIGURED to the mitre, the way family
    // F's can with SetTransitionMode(RightCorner)?
    std::printf("\n-- 6. Q1: does ANY GeomFill_Trihedron mode of MakePipe give the mitre? --\n");
    {
        const TopoDS_Wire sp = twoLegSpine(gp_Pnt(0, 0, 0), nz, L, L, 30.0);
        const TopoDS_Face pf = faceOf(squareWire(S, 0, 0));
        const double mitre = A * (L + L);
        const double trans = A * (L + L * std::cos(30.0 * kPi / 180.0));
        const GeomFill_Trihedron modes[] = {
            GeomFill_IsCorrectedFrenet, GeomFill_IsFixed, GeomFill_IsFrenet,
            GeomFill_IsConstantNormal, GeomFill_IsDarboux, GeomFill_IsDiscreteTrihedron};
        int anyMitre = 0;
        std::printf("   %-20s %-14s %-12s %-12s %s\n",
                    "mode", "volume", "rel(mitre)", "rel(trans)", "valid");
        for (GeomFill_Trihedron m : modes) {
            const TopoDS_Shape s = occtPipeMode(sp, pf, m);
            const double v = volumeOf(s);
            const double rm = v > 0 ? relDiff(v, mitre) : -1.0;
            const double rt = v > 0 ? relDiff(v, trans) : -1.0;
            std::printf("   %-20s %-14.6f %-12.3e %-12.3e %d\n",
                        kModeName[(int)m], v, rm, rt, validOf(s));
            if (v > 0 && rm < 1e-6) ++anyMitre;
        }
        std::printf("   (default 2-arg ctor is GeomFill_IsCorrectedFrenet -- "
                    "BRepFill_Pipe.hxx:53-57)\n");
        check(anyMitre == 0,
              "NO GeomFill_Trihedron mode of BRepOffsetAPI_MakePipe reproduces the mitre "
              "(" + std::to_string(anyMitre) + " of 6) -- family E's OCCT arm CANNOT be "
              "configured to the operation native computes, unlike family F's RightCorner");

        // ... and the family-F control, which CAN be.
        const TopoDS_Wire pw = squareWire(S, 0, 0);
        const double vRc = volumeOf(occtPipeShell(sp, pw, true));
        const double vTr = volumeOf(occtPipeShell(sp, pw, false));
        std::printf("   family F control: MakePipeShell(Transformed) %.6f   "
                    "(RightCorner) %.6f   mitre %.6f\n", vTr, vRc, mitre);
        check(relDiff(vRc, mitre) < 1e-6,
              "CONTROL: family F's MakePipeShell(RightCorner) DOES reproduce the mitre, "
              "so the asymmetry is real and is a property of the two OCCT APIs");
    }

    // ══════════════════════════════════════════════════════════════════ 7
    // Q2.  Family F's SPREAD, reproduced from scratch and predicted in closed
    // form.  The corpus starts the spine at the FACE centroid and hands
    // PIPESHELL the face's OUTER WIRE (corpus_ab_coverage.cpp:1303-1348), so on
    // any face WITH HOLES the swept region's centroid is NOT the spine start and
    // (*)'s offset term fires.  Family E is handed the FACE itself, whose
    // centroid IS the spine start, so its offset term is identically zero and
    // its ratio is a constant.  That asymmetry is the whole of the difference
    // between "min = p50 = max = 1.071797" and "1.055405 - 1.097498".
    std::printf("\n-- 7. Q2: family F's SPREAD is (*)'s offset term, on a HOLED face --\n");
    {
        const double th = 30.0, c = std::cos(th * kPi / 180.0);
        const gp_Dir d2 = leg2Dir(nz, th);
        const double K = 2.0 / (1.0 + c);
        int predOK = 0, n = 0;
        std::printf("   %-6s %-7s | %-14s %-14s %-10s | %-13s %-13s\n",
                    "hole r", "hole x", "native", "closed form (*)", "rel",
                    "nat/occt", "K*(1-r.d2/L(1+c))");
        // hx + hr < S/2 on every row: a hole that pokes THROUGH the wall makes an
        // invalid face, and BRepGProp will still hand back an area for it -- the
        // exact trap reports/corpus_ab/pipeshell_defer_audit/README.md tabulates.
        for (double hr : {0.0, 1.5, 3.0}) {
            for (double hx : {0.0, 1.8}) {
                if (hr == 0.0 && hx != 0.0) continue;   // no hole: x is meaningless
                const TopoDS_Face holed =
                    (hr == 0.0) ? faceOf(squareWire(S, 0, 0)) : squareWithHole(S, hr, hx, 0.0);
                if (holed.IsNull()) continue;
                if (BRepCheck_Analyzer(holed).IsValid() != Standard_True) {
                    check(false, "FIXTURE: the holed face must be BRepCheck-VALID "
                                 "(hole inside the wall)");
                    continue;
                }
                GProp_GProps gp;
                BRepGProp::SurfaceProperties(holed, gp);
                const gp_Pnt fc = gp.CentreOfMass();      // spine start, as the corpus does
                const TopoDS_Wire sp = twoLegSpine(fc, nz, L, L, th);
                const TopoDS_Wire outer = squareWire(S, 0, 0);
                // rbar = (swept region's centroid) - (spine start).  The swept region
                // is the OUTER square, centroid (0,0).
                const double rd2 = (0.0 - fc.X()) * d2.X() + (0.0 - fc.Y()) * d2.Y();
                const double closed = A * ((L + L) - 2.0 * rd2 / (1.0 + c));
                const double vNat = volumeOf(nativePipeShell(sp, outer));
                const double vTr  = volumeOf(occtPipeShell(sp, outer, false));
                const double ratio = (vTr > 0) ? vNat / vTr : -1.0;
                const double ratioPred = K * (1.0 - rd2 / (L * (1.0 + c)));
                ++n;
                if (vNat > 0 && relDiff(vNat, closed) < 1e-6) ++predOK;
                std::printf("   %-6.1f %-7.1f | %-14.6f %-14.6f %-10.3e | %-13.10f %-13.10f\n",
                            hr, hx, vNat, closed, relDiff(vNat, closed), ratio, ratioPred);
            }
        }
        check(predOK == n,
              "(*) predicts native PIPESHELL on a holed face to 1e-6 on " +
                  std::to_string(predOK) + "/" + std::to_string(n) + " cases -- so the "
              "closed form IS in scope for family F once the offset term is carried, "
              "and the spread is a property of the INPUT, not a defect in either arm");

        // The independent corroboration: a SECOND engine, asked for the same
        // operation, must land on the same number.  Without this the closed form
        // is only being checked against the engine it was derived for.
        const TopoDS_Face holed = squareWithHole(S, 3.0, 1.8, 0.0);
        GProp_GProps gp;
        BRepGProp::SurfaceProperties(holed, gp);
        const gp_Pnt fc = gp.CentreOfMass();
        const TopoDS_Wire sp = twoLegSpine(fc, nz, L, L, th);
        const TopoDS_Wire outer = squareWire(S, 0, 0);
        const double rd2 = (0.0 - fc.X()) * d2.X();
        const double closed = A * ((L + L) - 2.0 * rd2 / (1.0 + c));
        const double vNat = volumeOf(nativePipeShell(sp, outer));
        const double vRc  = volumeOf(occtPipeShell(sp, outer, true));
        const double vTr  = volumeOf(occtPipeShell(sp, outer, false));
        std::printf("   corroboration on r=3 x=1.8: native %.6f  OCCT(RightCorner) %.6f  "
                    "closed form %.6f\n", vNat, vRc, closed);
        check(vRc > 0 && relDiff(vRc, closed) < 1e-6 && relDiff(vNat, closed) < 1e-6,
              "OCCT(RightCorner) -- a SECOND, independent engine asked for the mitre -- "
              "lands on the same closed form, so (*) is not being checked against only "
              "the engine it was derived for");
        check(vTr > 0 && relDiff(vTr, A * (L + L * c)) < 1e-6,
              "and OCCT(Transformed) still obeys A*(L1+L2*cos theta) EXACTLY here, "
              "offset and all -- so family F's spread is the MITRE's offset term, "
              "NOT a wobble in OCCT's default arm");
    }

    // ══════════════════════════════════════════════════════════════════ 8
    // THE GATE.  Section 6 measured that family E's OCCT arm cannot be
    // configured to the mitre -- all six GeomFill_Trihedron modes of
    // BRepOffsetAPI_MakePipe return the translation law, bit for bit.  So the
    // flip gate for family E cannot be repaired the way family F's was, by
    // adding SetTransitionMode(RightCorner) to the existing call.  It needs a
    // REFERENCE SOLID for the mitre that is built with OCCT and no forge
    // symbol, and MakePipeShell(RightCorner) is one -- provided it can carry a
    // face WITH HOLES, which family E's profile always may.
    //
    // Two candidate constructions, and the point of this section is that one of
    // them does not work and is measured rather than assumed:
    //   (a) hand MakePipeShell the FACE;
    //   (b) sweep the OUTER wire and CUT one shell per inner wire.
    // (b) is legitimate because the mitre map is a boolean homomorphism (an
    // affine station map, an extrusion and a slab clip each commute with union,
    // intersection and difference -- NativeLoftPipe.hpp, "ARC CHAIN").
    //
    // The oracle is (*) with rbar = 0, because the spine starts at the FACE
    // centroid and the face IS the swept region for family E:
    //     V = A_face * (L1 + L2),   exactly.
    std::printf("\n-- 8. THE GATE: an OCCT-ONLY mitre reference for family E --\n");
    {
        const double th = 30.0;
        const double r = 3.0, hx = 1.8;   // hx + r < S/2: the hole is INSIDE the wall
        const TopoDS_Face holed = squareWithHole(S, r, hx, 0.0);
        check(!holed.IsNull() && BRepCheck_Analyzer(holed).IsValid() == Standard_True,
              "FIXTURE: the holed face is BRepCheck-VALID -- BRepGProp returns an area "
              "for a face that bounds nothing, so without this the oracle would check a "
              "wrong answer against a wrong expectation and agree");
        GProp_GProps gp;
        BRepGProp::SurfaceProperties(holed, gp);
        const gp_Pnt fc = gp.CentreOfMass();
        const double aFace = gp.Mass();
        const TopoDS_Wire sp = twoLegSpine(fc, nz, L, L, th);
        const double oracle = aFace * (L + L);      // rbar == 0 by construction

        // (a) MakePipeShell handed the FACE.
        double vFaceProfile = -1.0;
        try {
            BRepOffsetAPI_MakePipeShell mk(sp);
            mk.SetTransitionMode(BRepBuilderAPI_RightCorner);
            mk.Add(holed);
            mk.Build();
            if (mk.IsDone()) { mk.MakeSolid(); vFaceProfile = volumeOf(mk.Shape()); }
        } catch (...) { vFaceProfile = -1.0; }

        // (b) OUTER shell CUT by one shell per inner wire.
        TopoDS_Shape ref;
        {
            const TopoDS_Wire ow = BRepTools::OuterWire(holed);
            ref = occtPipeShell(sp, ow, true);
            for (TopExp_Explorer wx(holed, TopAbs_WIRE); wx.More() && !ref.IsNull(); wx.Next()) {
                const TopoDS_Wire w = TopoDS::Wire(wx.Current());
                if (w.IsSame(ow)) continue;
                const TopoDS_Shape tube = occtPipeShell(sp, w, true);
                if (tube.IsNull()) { ref.Nullify(); break; }
                try { ref = BRepAlgoAPI_Cut(ref, tube).Shape(); }
                catch (...) { ref.Nullify(); }
            }
        }
        const double vRef = volumeOf(ref);
        const double vNat = volumeOf(nativePipe(sp, holed));
        const double vOcc = volumeOf(occtPipe(sp, holed));
        std::printf("   A_face %.6f   oracle A_face*(L1+L2) %.6f\n", aFace, oracle);
        std::printf("   (a) MakePipeShell(RC) given the FACE      %.6f  rel %.3e\n",
                    vFaceProfile, vFaceProfile > 0 ? relDiff(vFaceProfile, oracle) : -1.0);
        std::printf("   (b) OUTER shell CUT by the hole shell     %.6f  rel %.3e  valid %d\n",
                    vRef, vRef > 0 ? relDiff(vRef, oracle) : -1.0, validOf(ref));
        std::printf("   native pipe(face)                         %.6f  rel %.3e  valid %d\n",
                    vNat, vNat > 0 ? relDiff(vNat, oracle) : -1.0, validOf(nativePipe(sp, holed)));
        std::printf("   OCCT MakePipe (the arm the gate compares) %.6f  rel %.3e\n",
                    vOcc, vOcc > 0 ? relDiff(vOcc, oracle) : -1.0);
        check(vRef > 0 && relDiff(vRef, oracle) < 1e-6,
              "construction (b) -- OUTER MakePipeShell(RightCorner) CUT by one shell per "
              "inner wire -- reproduces the mitre on a HOLED face, in pure OCCT, with no "
              "forge symbol: a usable reference arm for family E's gate");
        check(vNat > 0 && relDiff(vNat, oracle) < 1e-6,
              "and native agrees with it, so the proposed gate would score AGREE where "
              "today's gate scores DISAGREE on every part");
        check(!(vFaceProfile > 0 && relDiff(vFaceProfile, oracle) < 1e-6),
              "NEGATIVE DIRECTION: construction (a), handing MakePipeShell the FACE, does "
              "NOT give the mitre of the holed region -- so (b) is doing real work and the "
              "hole cut is not decoration");
        check(vOcc > 0 && relDiff(vOcc, oracle) > 1e-2,
              "NEGATIVE DIRECTION: the arm the gate uses TODAY misses the same oracle by " +
                  std::to_string(relDiff(vOcc, oracle)) + ", so the reference and the "
              "incumbent are not the same shape and the change is not a no-op");
    }

    std::printf("\n== ab_pipe_sweep_law: %d passed, %d failed ==\n", gPass, gFail);
    return gFail == 0 ? 0 : 1;
}
