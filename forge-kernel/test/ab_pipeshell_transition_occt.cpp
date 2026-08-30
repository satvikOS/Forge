// forge-kernel/test/ab_pipeshell_transition_occt.cpp
//
// WHY THIS FILE EXISTS. The 600-part corpus A/B (reports/corpus_ab/) measured
// family F, PIPESHELL, as 309 native successes out of 600 — and on every one of
// those 309 shared successes the two arms DISAGREED, with a volume ratio
// native/OCCT of mean 1.071892 and sd 2.84e-3, of which 193 sat on 1.071796769
// to ten significant figures. A ratio that tight across 309 differently-shaped
// parts is one systematic convention error, not noise, and this file names it.
//
// IT IS NOT A THICKNESS SIGN. The corpus's PIPESHELL derivation sweeps the
// OUTER WIRE of a face along a spine with makeSolid=true. There is no wall, no
// offset and no thickness parameter anywhere in it, so no inward/outward
// (2R+t)/(2R-t) reading can be instantiated — there is no t.
//
// IT IS THE SPINE'S TURN ANGLE. 1.071796769 is exactly 1/cos^2(15 deg) =
// 2/(1+cos 30 deg), and 30 degrees is the turn hard-coded in the corpus spine
// (test/corpus_ab_coverage.cpp, spineFromFace). The general law, asserted below
// over five turn angles and three leg ratios, is
//
//     native   volume = A * (L1 + L2)                 <- a MITRE: the section is
//                                                        carried through the
//                                                        bisecting plane, so the
//                                                        section perpendicular to
//                                                        the spine stays A
//     OCCT     volume = A * (L1 + L2 * cos theta)     <- a TRANSLATION: the
//                                                        section is NOT rotated
//                                                        onto leg 2, so the
//                                                        section perpendicular to
//                                                        leg 2 is A * cos theta
//
// and the cross-section areas are measured here directly, by clipping each solid
// with a half-space (TKBO booleans) at two stations along a leg and
// differencing — an oracle that touches neither TKOffset nor the native engine.
//
// THE CAUSE IS ONE DEFAULTED ARGUMENT. BRepOffsetAPI_MakePipeShell's default
// transition mode is BRepBuilderAPI_Transformed, and the production call site
// (src/Features.cpp, forge::part::sweep) never sets it. Ask OCCT for the mitre
// with SetTransitionMode(BRepBuilderAPI_RightCorner) and OCCT reproduces the
// native answer on the FULL observable vector — volume, centre of mass, bounding
// box, and face/edge/vertex/shell counts — in all 45 cases here and in all 309
// shared corpus successes (family PIPESHELL_RC in corpus_ab_coverage.cpp).
// So the native engine is NOT wrong and needs no sign fix.
//
// POSITIVE CONTROL. theta = 0 (a straight spine) must make the two arms AGREE.
// Without it a harness that compared one binary to itself would look identical
// to this result. NEGATIVE CONTROL. The same comparator is fed two solids of
// equal volume and different geometry and must REJECT them.
//
// BUILD + RUN: test/run_ab_pipeshell_transition.sh
// Exit 0 iff every assertion holds.

#include "forge/native/brep/NativeLoftPipe.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <BRepAlgoAPI_Common.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_TransitionMode.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

namespace {

int gPass = 0, gFail = 0;
void check(bool ok, const std::string& what) {
    (ok ? gPass : gFail)++;
    std::printf("  [%s] %s\n", ok ? "PASS" : "FAIL", what.c_str());
}

struct Metrics {
    double vol = 0, com[3] = {0, 0, 0}, bb[6] = {0, 0, 0, 0, 0, 0};
    int nF = 0, nE = 0, nV = 0, nS = 0;
    bool valid = false;
};

int countOf(const TopoDS_Shape& s, TopAbs_ShapeEnum t) {
    int n = 0;
    for (TopExp_Explorer e(s, t); e.More(); e.Next()) ++n;
    return n;
}

Metrics measure(const TopoDS_Shape& s) {
    Metrics m;
    if (s.IsNull()) return m;
    GProp_GProps g;
    BRepGProp::VolumeProperties(s, g);
    m.vol = std::fabs(g.Mass());
    m.com[0] = g.CentreOfMass().X();
    m.com[1] = g.CentreOfMass().Y();
    m.com[2] = g.CentreOfMass().Z();
    Bnd_Box b;
    BRepBndLib::Add(s, b);
    if (!b.IsVoid()) b.Get(m.bb[0], m.bb[1], m.bb[2], m.bb[3], m.bb[4], m.bb[5]);
    m.nF = countOf(s, TopAbs_FACE);
    m.nE = countOf(s, TopAbs_EDGE);
    m.nV = countOf(s, TopAbs_VERTEX);
    m.nS = countOf(s, TopAbs_SHELL);
    m.valid = BRepCheck_Analyzer(s).IsValid() == Standard_True;
    return m;
}

bool relClose(double a, double b, double t) {
    const double d = std::fabs(a - b), s = std::max(std::fabs(a), std::fabs(b));
    return s < 1.0e-12 ? d < t : d / s < t;
}

// volume(1e-9 relative), com and bbox (1e-7 absolute * scale), exact counts.
bool sameSolid(const Metrics& a, const Metrics& b, double scale, std::string& why) {
    why.clear();
    if (!relClose(a.vol, b.vol, 1.0e-9)) why += "vol ";
    for (int i = 0; i < 3; ++i)
        if (std::fabs(a.com[i] - b.com[i]) > 1.0e-7 * std::max(1.0, scale)) why += "com ";
    for (int i = 0; i < 6; ++i)
        if (std::fabs(a.bb[i] - b.bb[i]) > 1.0e-7 * std::max(1.0, scale)) why += "bbox ";
    if (a.nF != b.nF || a.nE != b.nE || a.nV != b.nV || a.nS != b.nS) why += "counts ";
    return why.empty();
}

// volume of { x : m . (x - p) <= 0 } intersected with `s`, via a large box.
double clipVol(const TopoDS_Shape& s, const gp_Pnt& p, const gp_Dir& m, double S) {
    gp_Dir seed(1, 0, 0);
    if (std::fabs(m.Dot(gp_Dir(1, 0, 0))) > 0.9) seed = gp_Dir(0, 1, 0);
    const gp_Dir mx = m.Crossed(seed);
    const gp_Dir my = m.Crossed(mx);
    const gp_Pnt corner = p.Translated(gp_Vec(m) * (-S))
                              .Translated(gp_Vec(mx) * (-0.5 * S))
                              .Translated(gp_Vec(my) * (-0.5 * S));
    const TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Ax2(corner, m, mx), S, S, S).Shape();
    BRepAlgoAPI_Common cut(s, box);
    cut.Build();
    if (!cut.IsDone()) return -1.0;
    GProp_GProps g;
    BRepGProp::VolumeProperties(cut.Shape(), g);
    return std::fabs(g.Mass());
}

TopoDS_Wire polyWire(const std::vector<gp_Pnt>& pts) {
    BRepBuilderAPI_MakePolygon mp;
    for (const gp_Pnt& p : pts) mp.Add(p);
    mp.Close();
    return mp.Wire();
}

TopoDS_Shape occtPS(const TopoDS_Wire& spine, const TopoDS_Wire& prof, int transition) {
    BRepOffsetAPI_MakePipeShell mk(spine);
    if (transition >= 0) mk.SetTransitionMode(static_cast<BRepBuilderAPI_TransitionMode>(transition));
    mk.Add(prof);
    mk.Build();
    if (!mk.IsDone()) return TopoDS_Shape();
    mk.MakeSolid();
    return mk.Shape();
}

struct Profile {
    const char* tag;
    TopoDS_Wire wire;
    double area;
    bool convex;  // the mitre closed form A*(L1+L2) only holds when the mitred
                  // sweep does not fold, which a re-entrant profile does.
};

}  // namespace

int main() {
    const double DEG = M_PI / 180.0;

    std::vector<Profile> profiles;
    profiles.push_back({"square10",
                        polyWire({gp_Pnt(-5, -5, 0), gp_Pnt(5, -5, 0), gp_Pnt(5, 5, 0),
                                  gp_Pnt(-5, 5, 0)}),
                        100.0, true});
    {
        std::vector<gp_Pnt> hx;
        for (int i = 0; i < 6; ++i)
            hx.emplace_back(7.0 * std::cos(i * M_PI / 3.0), 7.0 * std::sin(i * M_PI / 3.0), 0.0);
        profiles.push_back({"hex7", polyWire(hx), 0.5 * 6.0 * 49.0 * std::sin(M_PI / 3.0), true});
    }
    // 12x12 outer square with a 7x7 bite taken out: area 144 - 49 = 95, re-entrant.
    profiles.push_back({"L-nonconvex",
                        polyWire({gp_Pnt(-6, -6, 0), gp_Pnt(6, -6, 0), gp_Pnt(6, -1, 0),
                                  gp_Pnt(-1, -1, 0), gp_Pnt(-1, 6, 0), gp_Pnt(-6, 6, 0)}),
                        95.0, false});

    // ── POSITIVE CONTROL ────────────────────────────────────────────────────
    // A straight spine has no corner, so the transition mode cannot matter and
    // the two arms MUST agree. A harness comparing one engine to itself would
    // pass every other assertion in this file; only this one separates them.
    std::printf("\n--- POSITIVE CONTROL: straight spine, the arms must AGREE ---\n");
    {
        BRepBuilderAPI_MakePolygon sp;
        sp.Add(gp_Pnt(0, 0, 0));
        sp.Add(gp_Pnt(0, 0, 60));
        sp.Add(gp_Pnt(0, 0, 120));
        const TopoDS_Wire spine = sp.Wire();
        for (const Profile& pf : profiles) {
            const TopoDS_Shape nat = forge::occtloft::pipeShell(spine, pf.wire, {}, true, 1.0e-6);
            const TopoDS_Shape occ = occtPS(spine, pf.wire, -1);
            check(!nat.IsNull() && !occ.IsNull(),
                  std::string("straight ") + pf.tag + ": both arms produced a shape");
            if (nat.IsNull() || occ.IsNull()) continue;
            std::string why;
            const Metrics mn = measure(nat), mo = measure(occ);
            check(sameSolid(mn, mo, 120.0, why),
                  std::string("straight ") + pf.tag +
                      ": native == OCCT(default) on the full observable vector [" + why + "]");
            check(relClose(mn.vol, pf.area * 120.0, 1.0e-9),
                  std::string("straight ") + pf.tag + ": volume == A * spine length");
        }
    }

    // ── the bent spine: which convention does each arm implement? ───────────
    const double thetas[] = {10.0, 20.0, 30.0, 45.0, 60.0};
    const double legs[][2] = {{60.0, 60.0}, {90.0, 30.0}, {30.0, 90.0}};
    int nCase = 0, nAgreeDefault = 0, nAgreeRC = 0;
    std::printf("\n--- bent spine: native vs OCCT(default Transformed) vs OCCT(RightCorner) ---\n");
    for (const Profile& pf : profiles) {
        for (const double td : thetas) {
            for (const auto& lg : legs) {
                const double th = td * DEG, L1 = lg[0], L2 = lg[1];
                const gp_Dir d1(0, 0, 1), d2(std::sin(th), 0.0, std::cos(th));
                const gp_Pnt P0(0, 0, 0);
                const gp_Pnt P1 = P0.Translated(gp_Vec(d1) * L1);
                const gp_Pnt P2 = P1.Translated(gp_Vec(d2) * L2);
                BRepBuilderAPI_MakePolygon sp;
                sp.Add(P0);
                sp.Add(P1);
                sp.Add(P2);
                const TopoDS_Wire spine = sp.Wire();

                const TopoDS_Shape nat = forge::occtloft::pipeShell(spine, pf.wire, {}, true, 1.0e-6);
                const TopoDS_Shape ocD = occtPS(spine, pf.wire, -1);
                const TopoDS_Shape ocR = occtPS(spine, pf.wire, BRepBuilderAPI_RightCorner);
                char tag[128];
                std::snprintf(tag, sizeof tag, "%s th=%.0f L=%.0f/%.0f", pf.tag, td, L1, L2);
                if (nat.IsNull() || ocD.IsNull() || ocR.IsNull()) {
                    check(false, std::string(tag) + ": all three arms produced a shape");
                    continue;
                }
                ++nCase;
                const Metrics mn = measure(nat), md = measure(ocD), mr = measure(ocR);
                std::string whyD, whyR;
                if (sameSolid(mn, md, L1 + L2, whyD)) ++nAgreeDefault;
                if (sameSolid(mn, mr, L1 + L2, whyR)) ++nAgreeRC;

                // 1. native is the MITRE. For a convex profile the mitred sweep
                //    does not fold, and its volume is exactly A * spine length —
                //    an oracle derived on paper, independent of both engines.
                if (pf.convex)
                    check(relClose(mn.vol, pf.area * (L1 + L2), 1.0e-9),
                          std::string(tag) + ": native volume == A*(L1+L2), the mitre closed form");

                // 2. OCCT's default is the TRANSLATION: the section never rotates
                //    onto leg 2, so the enclosed volume is A * (displacement . n).
                check(relClose(md.vol, pf.area * (L1 + L2 * std::cos(th)), 1.0e-9),
                      std::string(tag) +
                          ": OCCT(default) volume == A*(L1 + L2*cos theta), the translation form");

                // 3. and the whole disagreement is that one defaulted argument.
                check(whyR.empty(),
                      std::string(tag) + ": native == OCCT(RightCorner), full observable vector [" +
                          whyR + "]");
                check(!whyD.empty(),
                      std::string(tag) + ": native != OCCT(default) — the disagreement is real");
            }
        }
    }
    std::printf("\n  bent cases %d   native==OCCT(default): %d   native==OCCT(RightCorner): %d\n",
                nCase, nAgreeDefault, nAgreeRC);
    check(nAgreeRC == nCase, "every bent case: native == OCCT(RightCorner)");
    check(nAgreeDefault == 0, "every bent case: native != OCCT(default Transformed)");

    // ── the defining property, measured with booleans, not with either engine ─
    // A pipe shell's section perpendicular to the spine is congruent to the
    // profile. dV/ds along a leg IS that section's area, and V(s) here comes
    // from a half-space Common — TKBO, not TKOffset and not NativeLoftPipe.
    std::printf("\n--- section area perpendicular to each leg (half-space clip, TKBO) ---\n");
    {
        const double th = 30.0 * DEG, L1 = 60.0, L2 = 60.0, A = 100.0;
        const gp_Dir d1(0, 0, 1), d2(std::sin(th), 0.0, std::cos(th));
        const gp_Pnt P0(0, 0, 0);
        const gp_Pnt P1 = P0.Translated(gp_Vec(d1) * L1);
        const gp_Pnt P2 = P1.Translated(gp_Vec(d2) * L2);
        BRepBuilderAPI_MakePolygon sp;
        sp.Add(P0);
        sp.Add(P1);
        sp.Add(P2);
        const TopoDS_Wire spine = sp.Wire();
        const TopoDS_Wire prof = profiles[0].wire;
        const TopoDS_Shape nat = forge::occtloft::pipeShell(spine, prof, {}, true, 1.0e-6);
        const TopoDS_Shape occ = occtPS(spine, prof, -1);
        const double S = 20.0 * (L1 + L2 + 10.0);
        auto secArea = [&](const TopoDS_Shape& s, const gp_Pnt& b, const gp_Dir& d, double L) {
            const double v1 = clipVol(s, b.Translated(gp_Vec(d) * (0.30 * L)), d, S);
            const double v2 = clipVol(s, b.Translated(gp_Vec(d) * (0.70 * L)), d, S);
            return (v1 < 0 || v2 < 0) ? -1.0 : (v2 - v1) / (0.40 * L);
        };
        const double n1 = secArea(nat, P0, d1, L1), o1 = secArea(occ, P0, d1, L1);
        const double n2 = secArea(nat, P1, d2, L2), o2 = secArea(occ, P1, d2, L2);
        std::printf("      leg1: native %.10g  occt %.10g   (profile area %g)\n", n1, o1, A);
        std::printf("      leg2: native %.10g  occt %.10g   (A*cos30 = %.10g)\n", n2, o2,
                    A * std::cos(th));
        check(relClose(n1, A, 1.0e-6), "native leg1 section area == profile area");
        check(relClose(n2, A, 1.0e-6), "native leg2 section area == profile area (it is a SWEEP)");
        check(relClose(o1, A, 1.0e-6), "OCCT leg1 section area == profile area");
        check(relClose(o2, A * std::cos(th), 1.0e-6),
              "OCCT leg2 section area == A*cos(theta) (the section never rotated)");
    }

    // ── NEGATIVE CONTROL: the comparator must reject ────────────────────────
    std::printf("\n--- NEGATIVE CONTROL: same volume, different solid ---\n");
    {
        const Metrics a = measure(BRepPrimAPI_MakeBox(10.0, 10.0, 40.0).Shape());
        const Metrics b = measure(BRepPrimAPI_MakeBox(20.0, 20.0, 10.0).Shape());
        std::string why;
        check(relClose(a.vol, b.vol, 1.0e-12), "the two control solids DO match on volume");
        check(!sameSolid(a, b, 40.0, why),
              "the comparator REJECTS them on position/topology [" + why + "]");
    }

    std::printf("\n===== %d/%d assertions passed =====\n", gPass, gPass + gFail);
    return gFail == 0 ? 0 : 1;
}
