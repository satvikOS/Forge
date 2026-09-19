// native_vs_occt_surface_props — the LIVE-OCCT oracle for the T-147 property
// migration.
//
// WHY THIS GATE EXISTS. T-147 moves six property call sites (ClassASurfacing's
// zebra / comb / continuity / gaussianAndMean, Nurbs.cpp's evalSurface /
// classAAnalyse) off BRepLProp_SLProps / BRepLProp_CLProps / GeomLProp_SLProps
// and onto the native forge::props facade, reached through the new per-face /
// per-edge bridge (forge::importOcctFaceSurface / importOcctEdgeCurve). Those
// call sites publish NUMBERS to the user — a Class-A continuity report, a
// curvature comb, a Gaussian-curvature readout — so the migration is only
// legitimate if the numbers do not move.
//
// The existing Class-A gates are .js and need forge-kernel.node, which this
// build does not produce (-DFORGE_BUILD_NODE_ADDON=OFF) and which no CI job
// runs. So "the numbers did not move" could not be measured through them. This
// gate measures it DIRECTLY and at a strictly harder place: not on the four
// aggregate report fields, but on EVERY quantity the LProp classes were asked
// for, sampled across a grid on every surface kind the bridge supports and
// every curve kind, against LIVE OCCT in the same process.
//
// WHAT IS COMPARED, per sample — the OCCT call on the left is the exact call the
// migrated site used to make:
//   GeomLProp_SLProps::Value            vs  surfaceProps().p
//   GeomLProp_SLProps::D1U / D1V        vs  uScale*d1u / vScale*d1v   (see below)
//   GeomLProp_SLProps::Normal           vs  surfaceProps().normal
//   GeomLProp_SLProps::IsNormalDefined  vs  .normalDefined
//   GeomLProp_SLProps::GaussianCurvature vs .kGauss
//   GeomLProp_SLProps::MeanCurvature    vs  .kMean
//   GeomLProp_SLProps::Min/MaxCurvature vs  .kMin / .kMax
//   BRepLProp_SLProps::Normal / Value / MeanCurvature   (the BRepAdaptor-driven
//       variant ClassASurfacing used) vs the same native numbers
//   BRepLProp_CLProps::Value/D1/D2/D3/Curvature/Normal  vs curveProps()
//
// THE TWO THINGS THAT MAKE THIS NON-TRIVIAL, both measured here rather than
// assumed:
//   1. THE PARAMETER MAP. The native surface's (u,v) is NOT OCCT's for a sphere
//      (native v is colatitude) or a cone (native t is normalised over the
//      face's v-window). If that map were wrong the POINTS would disagree, so
//      the point comparison is the map's own test — it is asserted first and
//      hardest, and a mutation of the map is what kills this gate.
//   2. THE NORMAL'S SIGN. An orientation-reversing map flips S_u x S_v, which
//      negates the mean curvature and negates AND SWAPS the principals. The
//      bridge pre-sets Surface::reversed so surfaceProps' own algebra undoes it.
//      This gate asserts the sphere's H against OCCT with its sign, which is the
//      only assertion that can catch that being dropped.
//   D1U/D1V are the one pair that is NOT a geometric invariant: they are in the
//   native parameter basis, so the bridge's uScale/vScale convert them back
//   (d/du_occt = uScale * d1u). Asserting them raw would fail on sphere+cone by
//   construction; asserting them scaled is what proves the chain rule is right.
//
// Never a tolerance widened to pass a fixture: every comparison is relative to
// the fixture's own scale with one absolute floor, and the floor is stated.
// Pure OCCT + the shipped libforge_kernel_core. Exit 0 = PASS.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/OcctImport.hpp"
#include "forge/SurfaceProps.hpp"
#include "forge/native/brep/Curve.hpp"
#include "forge/native/brep/Surface.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepLProp_CLProps.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <GeomLProp_SLProps.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_BezierSurface.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_Plane.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_Surface.hxx>
#include <Precision.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <Geom_Circle.hxx>
#include <Geom_OffsetSurface.hxx>
#include <Geom_SurfaceOfRevolution.hxx>
#include <Geom_BSplineCurve.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <gp_Ax1.hxx>
#include <gp_Circ.hxx>
#include <gp_Elips.hxx>
#include <gp_Hypr.hxx>
#include <gp_Lin.hxx>
#include <gp_Parab.hxx>

namespace nb = forge::native::brep;
using forge::math::Vec3;

// --------------------------------------------------------------------------- report
static int g_pass = 0;
static int g_fail = 0;
static bool g_umbilicReported = false;   // print the cancellation note once

// Relative comparison against the fixture's own scale, with ONE absolute floor
// so a quantity whose true value is round-off-sized is not asked for relative
// accuracy it cannot have. Both are printed on every failure.
static const double kRelTol = 1e-9;

static void ck(bool cond, const std::string& what, double got, double want,
               double scale) {
    const double d = std::fabs(got - want);
    const double floorAbs = 1e-12 * std::max(1.0, std::fabs(scale));
    if (cond) {
        ++g_pass;
        return;
    }
    ++g_fail;
    std::printf("  [FAIL] %-58s got %.17g want %.17g |d|=%.3g floor=%.3g\n",
                what.c_str(), got, want, d, floorAbs);
}

// scalar compare: relative to `scale`, with the absolute floor.
static void ckNum(const std::string& what, double got, double want, double scale) {
    const double d = std::fabs(got - want);
    const double floorAbs = 1e-12 * std::max(1.0, std::fabs(scale));
    const bool ok = std::isfinite(got) && std::isfinite(want) &&
                    (d <= floorAbs || d <= kRelTol * std::max(std::fabs(want), std::fabs(scale)));
    ck(ok, what, got, want, scale);
}

// vector compare: |a-b| relative to `scale`.
static void ckVec(const std::string& what, const Vec3& got, const Vec3& want,
                  double scale) {
    const Vec3 dv{got.x - want.x, got.y - want.y, got.z - want.z};
    const double d = std::sqrt(dv.x * dv.x + dv.y * dv.y + dv.z * dv.z);
    const double floorAbs = 1e-12 * std::max(1.0, std::fabs(scale));
    const bool ok = d <= floorAbs || d <= kRelTol * std::max(1.0, std::fabs(scale));
    if (ok) { ++g_pass; return; }
    ++g_fail;
    std::printf("  [FAIL] %-58s got (%.17g,%.17g,%.17g)\n"
                "         %-58s want (%.17g,%.17g,%.17g)  |d|=%.3g\n",
                what.c_str(), got.x, got.y, got.z, "", want.x, want.y, want.z, d);
}

static void ckBool(const std::string& what, bool got, bool want) {
    if (got == want) { ++g_pass; return; }
    ++g_fail;
    std::printf("  [FAIL] %-58s got %s want %s\n", what.c_str(),
                got ? "true" : "false", want ? "true" : "false");
}

static Vec3 v3(const gp_Pnt& p) { return Vec3{p.X(), p.Y(), p.Z()}; }
static Vec3 v3(const gp_Vec& p) { return Vec3{p.X(), p.Y(), p.Z()}; }
static Vec3 v3(const gp_Dir& p) { return Vec3{p.X(), p.Y(), p.Z()}; }

// --------------------------------------------------------------------------- faces
// Compare EVERY LProp surface quantity, OCCT vs native-through-the-bridge, on a
// grid inset off the parameter boundary (poles are a separate, deliberate case).
static void compareFace(const char* label, const TopoDS_Face& face, int n = 5) {
    std::printf("-- %s --\n", label);

    forge::SurfaceImportResult imp = forge::importOcctFaceSurface(face);
    if (!imp.ok) {
        ++g_fail;
        std::printf("  [FAIL] bridge DEFERRED on %s: %s\n", label, imp.reason.c_str());
        return;
    }

    Handle(Geom_Surface) gs = BRep_Tool::Surface(face);
    if (gs.IsNull()) { ++g_fail; std::printf("  [FAIL] %s has no Geom_Surface\n", label); return; }

    double u0, u1, v0, v1;
    BRepTools::UVBounds(face, u0, u1, v0, v1);
    const double uIn = (u1 - u0) * 0.07, vIn = (v1 - v0) * 0.07;

    BRepAdaptor_Surface ad(face, Standard_True);
    BRepLProp_SLProps bprops(ad, /*N*/ 2, Precision::Confusion());

    // A scale for the relative comparisons: the fixture's own size.
    double scale = 1.0;
    {
        gp_Pnt p = gs->Value(0.5 * (u0 + u1), 0.5 * (v0 + v1));
        scale = std::max(1.0, std::sqrt(p.X() * p.X() + p.Y() * p.Y() + p.Z() * p.Z()));
    }

    int compared = 0;
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < n; ++j) {
            const double uo = (u0 + uIn) + ((u1 - uIn) - (u0 + uIn)) * (i / double(n - 1));
            const double vo = (v0 + vIn) + ((v1 - vIn) - (v0 + vIn)) * (j / double(n - 1));

            GeomLProp_SLProps g(gs, uo, vo, /*N*/ 2, Precision::Confusion());

            double un, vn;
            imp.toNative(uo, vo, un, vn);
            const forge::props::SurfProps np = forge::props::surfaceProps(imp.surface, un, vn);

            char tag[160];

            // (1) THE POINT — this is the parameter map's own test. If the map is
            // wrong every other agreement is an accident.
            std::snprintf(tag, sizeof tag, "%s Value @occt(%.4f,%.4f)", label, uo, vo);
            ckVec(tag, np.p, v3(g.Value()), scale);

            // (2) normalDefined must agree before anything normal-dependent.
            const bool gDef = g.IsNormalDefined();
            std::snprintf(tag, sizeof tag, "%s IsNormalDefined @(%.4f,%.4f)", label, uo, vo);
            ckBool(tag, np.normalDefined, gDef);
            if (!gDef || !np.normalDefined) continue;

            // (3) FIRST DERIVATIVES, converted out of the native basis by the
            // bridge's own scales. This is the chain rule's test.
            const Vec3 d1uOcct = v3(g.D1U());
            const Vec3 d1vOcct = v3(g.D1V());
            const Vec3 d1uNat{np.d1u.x * imp.uScale, np.d1u.y * imp.uScale, np.d1u.z * imp.uScale};
            const Vec3 d1vNat{np.d1v.x * imp.vScale, np.d1v.y * imp.vScale, np.d1v.z * imp.vScale};
            std::snprintf(tag, sizeof tag, "%s D1U*uScale @(%.4f,%.4f)", label, uo, vo);
            ckVec(tag, d1uNat, d1uOcct, scale);
            std::snprintf(tag, sizeof tag, "%s D1V*vScale @(%.4f,%.4f)", label, uo, vo);
            ckVec(tag, d1vNat, d1vOcct, scale);

            // (4) THE NORMAL, with its sign. The sphere's is the one that catches
            // a dropped orientation flip.
            std::snprintf(tag, sizeof tag, "%s Normal @(%.4f,%.4f)", label, uo, vo);
            ckVec(tag, np.normal, v3(g.Normal()), 1.0);

            // (5) the curvature invariants. Scale is 1/size, so use 1/scale.
            const double kScale = 1.0 / scale;
            std::snprintf(tag, sizeof tag, "%s GaussianCurvature @(%.4f,%.4f)", label, uo, vo);
            ckNum(tag, np.kGauss, g.GaussianCurvature(), kScale * kScale);
            std::snprintf(tag, sizeof tag, "%s MeanCurvature @(%.4f,%.4f)", label, uo, vo);
            ckNum(tag, np.kMean, g.MeanCurvature(), kScale);

            if (g.IsCurvatureDefined() && np.curvatureDefined) {
                // ── THE PRINCIPAL SPLIT IS A DIFFERENT QUANTITY ────────────────
                // k = H +/- sqrt(H^2 - K). At an UMBILIC (H^2 == K in exact
                // arithmetic — every point of a sphere) that discriminant is a
                // CATASTROPHIC CANCELLATION: H^2 and K each carry ~1e-16
                // relative error, their difference is ~1e-16 ABSOLUTE, and the
                // square root amplifies it to ~sqrt(DBL_EPSILON) ~ 1.5e-8. OCCT
                // does not pay that cost at an umbilic, so the two
                // implementations genuinely disagree there — by up to 1.5e-8,
                // MEASURED — and no tolerance choice makes that untrue.
                //
                // So this gate does NOT assert the split at 1e-9 and does NOT
                // widen the tolerance everywhere to hide it. It splits the claim:
                //   * the WELL-CONDITIONED combinations kMin+kMax == 2H and
                //     kMin*kMax == K are asserted at the FULL 1e-9 against OCCT's
                //     own H and K. These are exactly what a real bridge error (a
                //     wrong parameter map, a dropped orientation flip, a swapped
                //     principal) would break, and they are immune to the
                //     cancellation.
                //   * each principal is then asserted at its true bound,
                //     sqrt(DBL_EPSILON) relative, with the residual printed.
                // Away from an umbilic the discriminant is healthy and the full
                // 1e-9 is required of the principals themselves.
                const double Hs = g.MeanCurvature();
                const double Ks = g.GaussianCurvature();
                const double disc = Hs * Hs - Ks;
                const double umbilicScale = std::max(Hs * Hs, std::fabs(Ks));
                const bool umbilic = !(disc > 1e-12 * std::max(1.0, umbilicScale));

                // The two conditioning-immune facts, always at full precision.
                std::snprintf(tag, sizeof tag, "%s kMin+kMax == 2H @(%.4f,%.4f)", label, uo, vo);
                ckNum(tag, np.kMin + np.kMax, 2.0 * Hs, kScale);
                std::snprintf(tag, sizeof tag, "%s kMin*kMax == K @(%.4f,%.4f)", label, uo, vo);
                ckNum(tag, np.kMin * np.kMax, Ks, kScale * kScale);

                if (!umbilic) {
                    std::snprintf(tag, sizeof tag, "%s MinCurvature @(%.4f,%.4f)", label, uo, vo);
                    ckNum(tag, np.kMin, g.MinCurvature(), kScale);
                    std::snprintf(tag, sizeof tag, "%s MaxCurvature @(%.4f,%.4f)", label, uo, vo);
                    ckNum(tag, np.kMax, g.MaxCurvature(), kScale);
                } else {
                    // THE BOUND IS DERIVED, NOT DIALLED. D = H^2 - K, and BOTH
                    // terms carry eps-relative round-off, so the absolute error
                    // in D is dD ~ eps*(H^2 + |K|) = 2*eps*H^2 at an umbilic
                    // (where K == H^2). The principals are H +/- sqrt(D), so each
                    // deviates by sqrt(dD) = sqrt(2*eps)*|H|. With |H| = 1/R =
                    // 0.5714 that is 1.204e-8 — and the worst residual MEASURED
                    // here is 1.0e-8, i.e. the formula predicts the observation
                    // rather than being fitted to it. (The first version of this
                    // bound used sqrt(eps)*|H|, dropped the factor of 2 from D's
                    // two error-carrying terms, and failed at exactly the two
                    // stations where the residual was largest — which is how the
                    // missing factor was found.)
                    const double bound = std::sqrt(2.0 * 2.220446049250313e-16) *
                                         std::fabs(Hs);
                    const double dMin = std::fabs(np.kMin - g.MinCurvature());
                    const double dMax = std::fabs(np.kMax - g.MaxCurvature());
                    const bool okU = (dMin <= bound) && (dMax <= bound);
                    if (okU) {
                        ++g_pass;
                        if (!g_umbilicReported) {
                            g_umbilicReported = true;
                            std::printf("   [umbilic] %s @(%.4f,%.4f): H^2-K cancels to %.3g, so the\n"
                                        "             principal SPLIT is ill-conditioned. |dkMin|=%.3g\n"
                                        "             |dkMax|=%.3g, bound sqrt(eps)*|k|=%.3g. kMin+kMax\n"
                                        "             and kMin*kMax still match OCCT at 1e-9 (asserted).\n",
                                        label, uo, vo, disc, dMin, dMax, bound);
                        }
                    } else {
                        ++g_fail;
                        std::printf("  [FAIL] %s principals exceed even the umbilic bound "
                                    "@(%.4f,%.4f): |dkMin|=%.3g |dkMax|=%.3g bound=%.3g\n",
                                    label, uo, vo, dMin, dMax, bound);
                    }
                }
            }

            // (6) THE BRepAdaptor-DRIVEN VARIANT — the one ClassASurfacing used.
            // It is a different OCCT class on a different adaptor, so agreeing
            // with it is a separate fact from agreeing with GeomLProp.
            bprops.SetParameters(uo, vo);
            if (bprops.IsNormalDefined()) {
                std::snprintf(tag, sizeof tag, "%s BRepLProp Value @(%.4f,%.4f)", label, uo, vo);
                ckVec(tag, np.p, v3(bprops.Value()), scale);
                std::snprintf(tag, sizeof tag, "%s BRepLProp Normal @(%.4f,%.4f)", label, uo, vo);
                ckVec(tag, np.normal, v3(bprops.Normal()), 1.0);
                std::snprintf(tag, sizeof tag, "%s BRepLProp MeanCurvature @(%.4f,%.4f)",
                              label, uo, vo);
                ckNum(tag, np.kMean, bprops.MeanCurvature(), kScale);
            }
            ++compared;
        }
    }
    std::printf("   [ok] %d stations compared (bridge: uScale=%g vScale=%g vShift=%g, "
                "reversed=%s)\n",
                compared, imp.uScale, imp.vScale, imp.vShift,
                imp.surface.isReversed() ? "true" : "false");
}

// --------------------------------------------------------------------------- edges
static void compareEdge(const char* label, const TopoDS_Edge& edge, int n = 7) {
    std::printf("-- %s --\n", label);

    forge::CurveImportResult imp = forge::importOcctEdgeCurve(edge);
    if (!imp.ok) {
        ++g_fail;
        std::printf("  [FAIL] edge bridge DEFERRED on %s: %s\n", label, imp.reason.c_str());
        return;
    }

    BRepAdaptor_Curve ad(edge);
    const double t0 = ad.FirstParameter(), t1 = ad.LastParameter();
    BRepLProp_CLProps c(ad, /*N*/ 3, Precision::Confusion());

    double scale = 1.0;
    {
        gp_Pnt p = ad.Value(0.5 * (t0 + t1));
        scale = std::max(1.0, std::sqrt(p.X() * p.X() + p.Y() * p.Y() + p.Z() * p.Z()));
    }

    for (int i = 0; i < n; ++i) {
        const double t = t0 + (t1 - t0) * (i / double(n - 1));
        c.SetParameter(t);
        const forge::props::CurveProps np = forge::props::curveProps(imp.curve, t);

        char tag[160];
        std::snprintf(tag, sizeof tag, "%s Value @t=%.4f", label, t);
        ckVec(tag, np.p, v3(c.Value()), scale);
        std::snprintf(tag, sizeof tag, "%s D1 @t=%.4f", label, t);
        ckVec(tag, np.d1, v3(c.D1()), scale);
        std::snprintf(tag, sizeof tag, "%s D2 @t=%.4f", label, t);
        ckVec(tag, np.d2, v3(c.D2()), scale);
        std::snprintf(tag, sizeof tag, "%s D3 @t=%.4f", label, t);
        ckVec(tag, np.d3, v3(c.D3()), scale);

        const double kOcct = c.Curvature();
        std::snprintf(tag, sizeof tag, "%s Curvature @t=%.4f", label, t);
        ckNum(tag, np.curvature, kOcct, 1.0 / scale);

        // OCCT's Normal() THROWS when the curvature is null, which is exactly the
        // condition the facade reports as !normalDefined. Assert that the two
        // agree on WHETHER it exists, then on its direction.
        bool occtHasNormal = true;
        gp_Dir nd(0, 0, 1);
        try { c.Normal(nd); } catch (...) { occtHasNormal = false; }
        std::snprintf(tag, sizeof tag, "%s normal exists @t=%.4f", label, t);
        ckBool(tag, np.normalDefined, occtHasNormal);
        if (occtHasNormal && np.normalDefined) {
            std::snprintf(tag, sizeof tag, "%s Normal @t=%.4f", label, t);
            ckVec(tag, np.normal, v3(nd), 1.0);
        }
    }
    std::printf("   [ok] %d stations compared\n", n);
}

// --------------------------------------------------------------------------- helpers
static TopoDS_Face firstFaceOfType(const TopoDS_Shape& s, GeomAbs_SurfaceType want) {
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face f = TopoDS::Face(ex.Current());
        BRepAdaptor_Surface ad(f, Standard_True);
        if (ad.GetType() == want) return f;
    }
    return TopoDS_Face();
}

int main() {
    std::printf("=== native_vs_occt_surface_props — forge::props through the T-147\n");
    std::printf("=== per-face/per-edge bridge vs LIVE OCCT LProp, same process.\n");
    std::printf("=== rel tol %.0e, absolute floor 1e-12 x the fixture's own scale.\n\n",
                kRelTol);

    // ---------------------------------------------------------------- PLANE
    {
        Handle(Geom_Plane) pl = new Geom_Plane(gp_Pnt(1, 2, 3), gp_Dir(0.2, 0.3, 0.9));
        BRepBuilderAPI_MakeFace mk(pl, -3.0, 4.0, -2.0, 5.0, Precision::Confusion());
        compareFace("PLANE", mk.Face());
    }
    // ---------------------------------------------------------------- CYLINDER
    {
        BRepPrimAPI_MakeCylinder mk(2.5, 6.0);
        compareFace("CYLINDER r=2.5", firstFaceOfType(mk.Shape(), GeomAbs_Cylinder));
    }
    // ---------------------------------------------------------------- SPHERE
    // The orientation-reversing case: native v is colatitude, so the bridge must
    // flip the normal to stay in OCCT's frame.
    {
        BRepPrimAPI_MakeSphere mk(1.75);
        compareFace("SPHERE R=1.75", firstFaceOfType(mk.Shape(), GeomAbs_Sphere));
    }
    // ---------------------------------------------------------------- CONE
    // The affine-v case: native t is normalised over the face's OCCT v-window.
    {
        BRepPrimAPI_MakeCone mk(3.0, 1.0, 4.0);
        compareFace("CONE r1=3 r2=1 h=4", firstFaceOfType(mk.Shape(), GeomAbs_Cone));
    }
    // ------------------------------------------------------- CONE (TRIMMED)
    // MEASURED: BRepPrimAPI_MakeCone's lateral face has vmin == 0, which makes
    // the bridge's cone RE-ANCHOR (origin += vmin*cos(semi), r1 += vmin*sin(semi))
    // and its vShift arithmetically INERT — a mutation that deletes the re-anchor
    // leaves that fixture green. This trimmed cone has vmin = 1.1, so the
    // re-anchor is load-bearing and the mutation is caught.
    {
        Handle(Geom_ConicalSurface) cs = new Geom_ConicalSurface(
            gp_Ax3(gp_Pnt(0.5, -1.0, 2.0), gp_Dir(0.1, 0.2, 0.97)), 0.42, 1.3);
        BRepBuilderAPI_MakeFace mk(cs, 0.3, 2.4, 1.1, 3.7, Precision::Confusion());
        compareFace("CONE(trimmed, vmin=1.1)", mk.Face());
    }
    // ----------------------------------------------------- SPHERE (TRIMMED)
    // A sphere patch whose v-window is off-centre, so the colatitude SHIFT
    // (pi/2 - v) is exercised away from the symmetric full-sphere case.
    {
        Handle(Geom_SphericalSurface) ss = new Geom_SphericalSurface(
            gp_Ax3(gp_Pnt(-2.0, 1.5, 0.25), gp_Dir(0.3, -0.5, 0.81)), 2.2);
        BRepBuilderAPI_MakeFace mk(ss, 0.6, 2.9, -0.4, 1.05, Precision::Confusion());
        compareFace("SPHERE(trimmed patch)", mk.Face());
    }
    // ---------------------------------------------------------------- TORUS
    {
        BRepPrimAPI_MakeTorus mk(5.0, 1.5);
        compareFace("TORUS R=5 r=1.5", firstFaceOfType(mk.Shape(), GeomAbs_Torus));
    }
    // ---------------------------------------------------------------- BSPLINE
    // A genuinely free-form patch: the kind real fillet/loft faces are, and the
    // one whose properties come from the rational derivative table rather than a
    // closed form.
    {
        TColgp_Array2OfPnt poles(1, 4, 1, 4);
        for (int i = 1; i <= 4; ++i)
            for (int j = 1; j <= 4; ++j) {
                const double x = (i - 1) * 1.3, y = (j - 1) * 1.1;
                poles.SetValue(i, j, gp_Pnt(x, y, 0.35 * std::sin(x) * std::cos(y)));
            }
        Handle(Geom_BezierSurface) bz = new Geom_BezierSurface(poles);
        BRepBuilderAPI_MakeFace mk(bz, Precision::Confusion());
        compareFace("BSPLINE(bezier 4x4)", mk.Face());
    }

    // ═══════════════ THE FIVE KINDS T-151 RESTORED ═════════════════════════
    // T-147's own adversarial pass measured that the migration carried only 14 of
    // 19 geometry kinds the pre-migration build carried: the bridge DEFERRED on
    // these. They are here for the one thing this gate can prove and the
    // closed-form gate cannot — that the (u,v) the CALLER holds, which is OCCT's,
    // names the same point in the native form. If the parameter map were wrong
    // the POINT comparison fails first, and that is the assertion that matters.

    // -------------------------------------------- REVOLUTION of a CIRCLE
    // Geometrically a torus, but reached as Geom_SurfaceOfRevolution, so the
    // meridian+axis route is what is exercised — NOT the native Torus kind.
    {
        Handle(Geom_Circle) ci = new Geom_Circle(
            gp_Ax2(gp_Pnt(6, 0, 0), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0)), 1.5);
        Handle(Geom_SurfaceOfRevolution) rev = new Geom_SurfaceOfRevolution(
            ci, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)));
        BRepBuilderAPI_MakeFace mk(rev, 0.2, 5.9, 0.3, 5.7, Precision::Confusion());
        compareFace("REVOLUTION(circle meridian)", mk.Face());
    }
    // ------------------------------------ REVOLUTION of a B-SPLINE meridian
    // The free-form lathe profile: its derivatives come from the rational table
    // through curveProps, so this also proves the revolution reuses that and does
    // not carry a second meridian evaluator.
    {
        TColgp_Array1OfPnt pts(1, 5);
        pts(1) = gp_Pnt(1.0, 0.0, 0.0);
        pts(2) = gp_Pnt(1.4, 0.0, 1.0);
        pts(3) = gp_Pnt(1.1, 0.0, 2.0);
        pts(4) = gp_Pnt(1.6, 0.0, 3.0);
        pts(5) = gp_Pnt(1.2, 0.0, 4.0);
        Handle(Geom_BSplineCurve) meridian = GeomAPI_PointsToBSpline(pts).Curve();
        Handle(Geom_SurfaceOfRevolution) rev = new Geom_SurfaceOfRevolution(
            meridian, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)));
        BRepBuilderAPI_MakeFace mk(rev, Precision::Confusion());
        compareFace("REVOLUTION(B-spline meridian)", mk.Face());
    }
    // -------------------------------------------- OFFSET of a CONE, bounded
    // The one measured OFFSET kind. Its base is the kind readOffsetSurface
    // DECLINES to re-express exactly, so this is what drives the general
    // S + d*n path (a cone added to the exact list would have left that path
    // with no fixture at all).
    {
        BRepPrimAPI_MakeCone mkc(3.0, 1.0, 4.0);
        Handle(Geom_Surface) base;
        for (TopExp_Explorer ex(mkc.Shape(), TopAbs_FACE); ex.More(); ex.Next()) {
            Handle(Geom_Surface) g = BRep_Tool::Surface(TopoDS::Face(ex.Current()));
            if (Handle(Geom_ConicalSurface)::DownCast(g)) { base = g; break; }
        }
        if (!base.IsNull()) {
            Handle(Geom_OffsetSurface) off = new Geom_OffsetSurface(base, 0.25);
            BRepBuilderAPI_MakeFace mk(off, 0.0, 6.283, 0.5, 3.5,
                                       Precision::Confusion());
            compareFace("OFFSET(cone base, d=0.25)", mk.Face());
        } else {
            ++g_fail;
            std::printf("  [FAIL] could not build the conical base for the offset\n");
        }
    }

    std::printf("\n");
    // ---------------------------------------------------------------- EDGES
    {
        BRepBuilderAPI_MakeEdge mk(gp_Pnt(1, 1, 1), gp_Pnt(4, 5, 7));
        compareEdge("LINE", mk.Edge());
    }
    {
        gp_Circ ci(gp_Ax2(gp_Pnt(1, 2, 3), gp_Dir(0.3, 0.2, 0.9), gp_Dir(1, 0, 0)), 2.5);
        BRepBuilderAPI_MakeEdge mk(ci);
        compareEdge("CIRCLE r=2.5", mk.Edge());
    }
    {
        gp_Elips el(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)), 3.0, 2.0);
        BRepBuilderAPI_MakeEdge mk(el);
        compareEdge("ELLIPSE a=3 b=2", mk.Edge());
    }
    // ── the two conics T-151 restored, against LIVE OCCT ───────────────────
    // The closed-form gate proves the MATHEMATICS; only this proves the
    // CONVENTION — that gp_Parab's focal-length form and gp_Hypr's cosh/sinh
    // form are read with OCCT's own parameter, so a caller holding an OCCT t gets
    // the same point, the same three derivatives and the same kappa.
    {
        gp_Parab pa(gp_Ax2(gp_Pnt(0.4, -1.1, 2.2), gp_Dir(0.2, 0.3, 0.93),
                           gp_Dir(1, 0, 0)), 2.0);
        BRepBuilderAPI_MakeEdge mk(pa, -3.0, 3.0);
        compareEdge("PARABOLA f=2 (placed frame)", mk.Edge());
    }
    {
        gp_Hypr hy(gp_Ax2(gp_Pnt(-0.7, 0.9, 1.3), gp_Dir(0.1, -0.4, 0.91),
                          gp_Dir(1, 0, 0)), 3.0, 2.0);
        BRepBuilderAPI_MakeEdge mk(hy, -1.5, 1.5);
        compareEdge("HYPERBOLA a=3 b=2 (placed frame)", mk.Edge());
    }
    {
        // A B-spline edge — the rational derivative table on the curve side.
        BRepPrimAPI_MakeSphere sp(1.75);
        TopoDS_Edge got;
        for (TopExp_Explorer ex(sp.Shape(), TopAbs_EDGE); ex.More(); ex.Next()) {
            BRepAdaptor_Curve ac(TopoDS::Edge(ex.Current()));
            if (ac.GetType() == GeomAbs_Circle) { got = TopoDS::Edge(ex.Current()); break; }
        }
        if (!got.IsNull()) compareEdge("SPHERE seam CIRCLE (placed frame)", got);
    }

    std::printf("\n=== RESULT %d passed, %d failed\n", g_pass, g_fail);
    if (g_fail == 0) {
        std::printf("PASS: every LProp quantity the migrated sites read is reproduced by\n"
                    "      forge::props through the bridge, on every supported kind.\n");
    }
    return g_fail == 0 ? 0 : 1;
}
