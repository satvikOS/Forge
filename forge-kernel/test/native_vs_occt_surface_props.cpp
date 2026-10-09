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

#include <stdexcept>

#include "forge/ClassASurfacing.hpp"   // the PRODUCTION entry points (frozen 19)
#include "forge/OcctImport.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/SurfaceProps.hpp"
#include "forge/native/brep/Curve.hpp"
#include "forge/native/brep/Surface.hpp"

#include <BRepPrimAPI_MakeBox.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_Hyperbola.hxx>
#include <Geom_Parabola.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <gp_Ax3.hxx>

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

// --------------------------------------------------------------------------- per-kind table
// ONE ROW PER FIXTURE, printed at the end, so "carried" is read kind by kind and
// never as a total that a single missing kind can hide inside.
//
// A row is CARRIED only when ALL of these hold — never because something merely
// returned without throwing:
//   * the bridge imported the geometry (ok = true), AND
//   * every LProp quantity it was asked for matched live OCCT (zero failures in
//     the row, at least one comparison made), AND, for the FROZEN 19 only,
//   * the PRODUCTION entry point (forge::classa::gaussianAndMeanCurvature /
//     curvatureComb — what the user's curvature readout and comb call) answered,
//     and every K/H (face) or kappa/position (edge) it returned matched live OCCT
//     at the (u,v)/t it reports.
struct KindRow {
    std::string label;
    bool frozen = false;          // one of the FROZEN 19 (see main)
    int pass0 = 0, fail0 = 0;     // the global counters when the row began
    int checks = 0, fails = 0;    // this row's own comparisons
    bool bridgeOk = false;
    std::string bridgeReason;
    std::string bridgeForm;       // which PropSurface form carried it ("-" for edges)
    bool classaRan = false;       // frozen rows only
    bool classaAnswered = false;
    int classaStations = 0;
    std::string classaWhy;
    bool carried() const {
        return bridgeOk && fails == 0 && checks > 0 &&
               (!classaRan || (classaAnswered && classaStations > 0));
    }
};
static std::vector<KindRow> g_rows;
static bool g_lastBridgeOk = false;
static std::string g_lastBridgeReason;
static std::string g_lastBridgeForm = "-";

static const char* formName(forge::props::PropSurface::Form f) {
    switch (f) {
    case forge::props::PropSurface::Form::Native:   return "Native";
    case forge::props::PropSurface::Form::Revolved: return "Revolved";
    case forge::props::PropSurface::Form::Offset:   return "Offset";
    case forge::props::PropSurface::Form::Extruded: return "Extruded";
    }
    return "?";
}

static std::size_t rowBegin(const std::string& label, bool frozen) {
    KindRow r;
    r.label = label;
    r.frozen = frozen;
    r.pass0 = g_pass;
    r.fail0 = g_fail;
    g_lastBridgeOk = false;
    g_lastBridgeReason.clear();
    g_lastBridgeForm = "-";
    g_rows.push_back(r);
    return g_rows.size() - 1;
}
static void rowEnd(std::size_t i) {
    KindRow& r = g_rows[i];
    r.fails = g_fail - r.fail0;
    r.checks = (g_pass - r.pass0) + r.fails;
}

// --------------------------------------------------------------------------- faces
// Compare EVERY LProp surface quantity, OCCT vs native-through-the-bridge, on a
// grid inset off the parameter boundary (poles are a separate, deliberate case).
static void compareFaceImpl(const char* label, const TopoDS_Face& face, int n) {
    std::printf("-- %s --\n", label);

    forge::SurfaceImportResult imp = forge::importOcctFaceSurface(face);
    g_lastBridgeOk = imp.ok;
    g_lastBridgeReason = imp.reason;
    if (imp.ok) g_lastBridgeForm = formName(imp.surface.form);
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
static void compareEdgeImpl(const char* label, const TopoDS_Edge& edge, int n) {
    std::printf("-- %s --\n", label);

    forge::CurveImportResult imp = forge::importOcctEdgeCurve(edge);
    g_lastBridgeOk = imp.ok;
    g_lastBridgeReason = imp.reason;
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

// ------------------------------------------------- the PRODUCTION entry points
// The bridge+facade comparison above is the mathematics. These two check the
// path the USER's numbers actually take — ShapeRegistry -> forge::classa ->
// bridge -> forge::props — and they check VALUES, not survival: every sample the
// entry point returns is compared with live OCCT LProp at the parameter the
// sample itself reports. A kind that "answers" with a wrong number is red here.
static void classaFaceCheck(const char* label, const TopoDS_Face& face, std::size_t r) {
    g_rows[r].classaRan = true;
    forge::ShapeHandle h = forge::ShapeRegistry::instance().add(face);
    std::vector<forge::classa::CurvatureSample> v;
    try {
        v = forge::classa::gaussianAndMeanCurvature(h, 4, 4);
    } catch (const std::exception& e) {
        ++g_fail;
        g_rows[r].classaWhy = e.what();
        std::printf("  [FAIL] %s: forge::classa::gaussianAndMeanCurvature THREW: %s\n",
                    label, e.what());
        return;
    }
    g_rows[r].classaAnswered = true;

    Handle(Geom_Surface) gs = BRep_Tool::Surface(face);
    double u0, u1, v0, v1;
    BRepTools::UVBounds(face, u0, u1, v0, v1);
    double scale = 1.0;
    {
        gp_Pnt p = gs->Value(0.5 * (u0 + u1), 0.5 * (v0 + v1));
        scale = std::max(1.0, std::sqrt(p.X() * p.X() + p.Y() * p.Y() + p.Z() * p.Z()));
    }
    const double kScale = 1.0 / scale;
    int compared = 0;
    char tag[200];
    for (const auto& s : v) {
        GeomLProp_SLProps g(gs, s.u, s.v, /*N*/ 2, Precision::Confusion());
        if (!g.IsNormalDefined() || !g.IsCurvatureDefined()) continue;
        std::snprintf(tag, sizeof tag, "%s classa K @occt(%.4f,%.4f)", label, s.u, s.v);
        ckNum(tag, s.K_gaussian, g.GaussianCurvature(), kScale * kScale);
        std::snprintf(tag, sizeof tag, "%s classa H @occt(%.4f,%.4f)", label, s.u, s.v);
        ckNum(tag, s.H_mean, g.MeanCurvature(), kScale);
        ++compared;
    }
    g_rows[r].classaStations = compared;
    std::snprintf(tag, sizeof tag, "%s classa returned comparable stations", label);
    ckBool(tag, compared > 0, true);
    std::printf("   [classa] gaussianAndMeanCurvature: %zu samples, %d compared to LProp\n",
                v.size(), compared);
}

static void classaEdgeCheck(const char* label, const TopoDS_Edge& edge, std::size_t r) {
    g_rows[r].classaRan = true;
    forge::ShapeHandle h = forge::ShapeRegistry::instance().add(edge);
    std::vector<forge::classa::CurvatureCombSample> v;
    try {
        v = forge::classa::curvatureComb(h, 7, 1.0);
    } catch (const std::exception& e) {
        ++g_fail;
        g_rows[r].classaWhy = e.what();
        std::printf("  [FAIL] %s: forge::classa::curvatureComb THREW: %s\n", label, e.what());
        return;
    }
    g_rows[r].classaAnswered = true;

    BRepAdaptor_Curve ad(edge);
    BRepLProp_CLProps c(ad, /*N*/ 2, Precision::Confusion());
    double scale = 1.0;
    {
        gp_Pnt p = ad.Value(0.5 * (ad.FirstParameter() + ad.LastParameter()));
        scale = std::max(1.0, std::sqrt(p.X() * p.X() + p.Y() * p.Y() + p.Z() * p.Z()));
    }
    int compared = 0;
    char tag[200];
    for (const auto& s : v) {
        c.SetParameter(s.u);
        std::snprintf(tag, sizeof tag, "%s classa comb position @t=%.4f", label, s.u);
        ckVec(tag, Vec3{s.position3d[0], s.position3d[1], s.position3d[2]},
              v3(c.Value()), scale);
        std::snprintf(tag, sizeof tag, "%s classa comb kappa @t=%.4f", label, s.u);
        ckNum(tag, s.curvature, c.Curvature(), 1.0 / scale);
        ++compared;
    }
    g_rows[r].classaStations = compared;
    std::snprintf(tag, sizeof tag, "%s classa returned comparable stations", label);
    ckBool(tag, compared > 0, true);
    std::printf("   [classa] curvatureComb: %d samples compared to LProp\n", compared);
}

// An ADDITIONAL fixture: bridge+facade vs LProp, one table row.
static void compareFace(const char* label, const TopoDS_Face& face, int n = 5) {
    const std::size_t r = rowBegin(label, false);
    compareFaceImpl(label, face, n);
    g_rows[r].bridgeOk = g_lastBridgeOk;
    g_rows[r].bridgeReason = g_lastBridgeReason;
    g_rows[r].bridgeForm = g_lastBridgeForm;
    rowEnd(r);
}
static void compareEdge(const char* label, const TopoDS_Edge& edge, int n = 7) {
    const std::size_t r = rowBegin(label, false);
    compareEdgeImpl(label, edge, n);
    g_rows[r].bridgeOk = g_lastBridgeOk;
    g_rows[r].bridgeReason = g_lastBridgeReason;
    g_rows[r].bridgeForm = g_lastBridgeForm;
    rowEnd(r);
}
// One of the FROZEN 19: the same, PLUS the production entry point's values.
static void probeFace(const char* label, const TopoDS_Face& face) {
    const std::size_t r = rowBegin(label, true);
    compareFaceImpl(label, face, 5);
    g_rows[r].bridgeOk = g_lastBridgeOk;
    g_rows[r].bridgeReason = g_lastBridgeReason;
    g_rows[r].bridgeForm = g_lastBridgeForm;
    classaFaceCheck(label, face, r);
    rowEnd(r);
}
static void probeEdge(const char* label, const TopoDS_Edge& edge) {
    const std::size_t r = rowBegin(label, true);
    compareEdgeImpl(label, edge, 7);
    g_rows[r].bridgeOk = g_lastBridgeOk;
    g_rows[r].bridgeReason = g_lastBridgeReason;
    g_rows[r].bridgeForm = g_lastBridgeForm;
    classaEdgeCheck(label, edge, r);
    rowEnd(r);
}

static Handle(Geom_Surface) surfaceOfType(const TopoDS_Shape& s, const char* dynType) {
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        Handle(Geom_Surface) g = BRep_Tool::Surface(TopoDS::Face(ex.Current()));
        if (!g.IsNull() && g->DynamicType()->Name() == std::string(dynType)) return g;
    }
    return Handle(Geom_Surface)();
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

    // ═══════════════ THE FROZEN 19-KIND PROBE ══════════════════════════════
    // T-147's adversarial pass built a 19-kind capability probe (cap3.cpp, run
    // against the pre-migration and migrated dylibs on 2026-09-18) and measured
    // 19/19 before the migration and 14/19 after; T-151 exists to restore the
    // five. That probe was never committed, so "19/19" could not be re-run from
    // the tree. These are ITS NINETEEN FIXTURES, geometry for geometry and label
    // for label, recovered from that session and now part of the gate.
    //
    // ★ THE KIND LIST IS FROZEN AT 19. Nothing is ever removed from it to make
    //   the denominator match the answer; a new kind goes in the ADDITIONAL
    //   section below and is reported separately. The count is asserted.
    //
    // ★ The original probe called a kind CARRIED when the production entry point
    //   merely RETURNED. That is not enough and is not what is asserted here:
    //   each row must ALSO match live OCCT LProp on a station grid through the
    //   bridge, and the production entry point's own returned K/H (or kappa) must
    //   match LProp at the parameters it reports.
    //
    // ★ WHAT RE-RUNNING IT FOUND (T-151, 2026-10-08, on b609b41d): 18/19, not the
    //   19/19 the merge recorded. "linear extrusion (circle profile)" THROWS. The
    //   original probe's 19/19 run predates 8341ad68, which added a correct
    //   round-trip check to the extrusion reader: the tensor B-spline built from
    //   a CIRCLE basis is the rational-quadratic arc, whose parameter is NOT the
    //   circle's angle, so the bridge had been handing callers the wrong point at
    //   OCCT's (u,v) — invisible to the original probe because a cylinder's K and
    //   H are the same everywhere. The check made it decline honestly, and the
    //   kind fell out. It is restored as props::PropSurface::Form::Extruded.
    std::printf("=== THE FROZEN 19-KIND PROBE (bridge+facade AND forge::classa vs LProp)\n\n");
    {   // 1. plane (box face)
        TopoDS_Shape b = BRepPrimAPI_MakeBox(2., 3., 4.).Shape();
        TopExp_Explorer ex(b, TopAbs_FACE);
        probeFace("plane (box face)", TopoDS::Face(ex.Current()));
    }
    {   // 2. cylinder
        TopoDS_Shape c = BRepPrimAPI_MakeCylinder(2.5, 4.).Shape();
        Handle(Geom_Surface) g = surfaceOfType(c, "Geom_CylindricalSurface");
        probeFace("cylinder", BRepBuilderAPI_MakeFace(g, 0., 6.283, 0., 4., 1e-6).Face());
    }
    {   // 3. cone
        TopoDS_Shape c = BRepPrimAPI_MakeCone(3., 1., 4.).Shape();
        Handle(Geom_Surface) g = surfaceOfType(c, "Geom_ConicalSurface");
        probeFace("cone", BRepBuilderAPI_MakeFace(g, 0., 6.283, 0., 4., 1e-6).Face());
    }
    {   // 4. sphere
        TopoDS_Shape s = BRepPrimAPI_MakeSphere(1.75).Shape();
        TopExp_Explorer ex(s, TopAbs_FACE);
        probeFace("sphere", TopoDS::Face(ex.Current()));
    }
    {   // 5. torus
        TopoDS_Shape s = BRepPrimAPI_MakeTorus(5., 1.5).Shape();
        TopExp_Explorer ex(s, TopAbs_FACE);
        probeFace("torus", TopoDS::Face(ex.Current()));
    }
    {   // 6. bezier surface 4x4
        TColgp_Array2OfPnt p(1, 4, 1, 4);
        for (int i = 1; i <= 4; ++i)
            for (int j = 1; j <= 4; ++j) p(i, j) = gp_Pnt(i * 1.0, j * 1.0, 0.15 * i * j);
        Handle(Geom_BezierSurface) bz = new Geom_BezierSurface(p);
        probeFace("bezier surface 4x4", BRepBuilderAPI_MakeFace(bz, 1e-6).Face());
    }
    {   // 7. linear extrusion (circle profile)
        Handle(Geom_Circle) c = new Geom_Circle(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 2.0);
        Handle(Geom_SurfaceOfLinearExtrusion) ex =
            new Geom_SurfaceOfLinearExtrusion(c, gp_Dir(0, 0, 1));
        probeFace("linear extrusion (circle profile)",
                  BRepBuilderAPI_MakeFace(ex, 0., 6.283, 0., 3., 1e-6).Face());
    }
    {   // 8. offset of PLANE
        Handle(Geom_Surface) pl = new Geom_Plane(gp_Ax3(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)));
        Handle(Geom_OffsetSurface) off = new Geom_OffsetSurface(pl, 0.5);
        probeFace("offset of PLANE", BRepBuilderAPI_MakeFace(off, -1., 1., -1., 1., 1e-6).Face());
    }
    {   // 9. offset of CYLINDER
        TopoDS_Shape c = BRepPrimAPI_MakeCylinder(2.5, 4.).Shape();
        Handle(Geom_OffsetSurface) off =
            new Geom_OffsetSurface(surfaceOfType(c, "Geom_CylindricalSurface"), 0.3);
        probeFace("offset of CYLINDER",
                  BRepBuilderAPI_MakeFace(off, 0., 6.283, 0.5, 3.5, 1e-6).Face());
    }
    {   // 10. offset of CONE (bounded)                                   [T-151]
        TopoDS_Shape c = BRepPrimAPI_MakeCone(3., 1., 4.).Shape();
        Handle(Geom_OffsetSurface) off =
            new Geom_OffsetSurface(surfaceOfType(c, "Geom_ConicalSurface"), 0.25);
        probeFace("offset of CONE (bounded)",
                  BRepBuilderAPI_MakeFace(off, 0., 6.283, 0.5, 3.5, 1e-6).Face());
    }
    {   // 11. revolution of a B-SPLINE meridian                          [T-151]
        TColgp_Array1OfPnt pts(1, 5);
        pts(1) = gp_Pnt(1, 0, 0); pts(2) = gp_Pnt(1.4, 0, 1); pts(3) = gp_Pnt(1.1, 0, 2);
        pts(4) = gp_Pnt(1.6, 0, 3); pts(5) = gp_Pnt(1.2, 0, 4);
        Handle(Geom_BSplineCurve) m = GeomAPI_PointsToBSpline(pts).Curve();
        Handle(Geom_SurfaceOfRevolution) rv =
            new Geom_SurfaceOfRevolution(m, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)));
        probeFace("revolution of a B-SPLINE meridian", BRepBuilderAPI_MakeFace(rv, 1e-6).Face());
    }
    {   // 12. revolution of a CIRCLE (== torus)                          [T-151]
        Handle(Geom_Circle) c = new Geom_Circle(gp_Ax2(gp_Pnt(6, 0, 0), gp_Dir(0, 1, 0)), 1.5);
        Handle(Geom_SurfaceOfRevolution) rv =
            new Geom_SurfaceOfRevolution(c, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)));
        probeFace("revolution of a CIRCLE (== torus)", BRepBuilderAPI_MakeFace(rv, 1e-6).Face());
    }
    // edges
    probeEdge("line", BRepBuilderAPI_MakeEdge(gp_Lin(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), 0., 5.).Edge());
    probeEdge("circle", BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 2.5)).Edge());
    probeEdge("ellipse", BRepBuilderAPI_MakeEdge(gp_Elips(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 3., 2.)).Edge());
    {
        TColgp_Array1OfPnt p(1, 4);
        p(1) = gp_Pnt(0, 0, 0); p(2) = gp_Pnt(1, 2, 0); p(3) = gp_Pnt(3, 2, 0); p(4) = gp_Pnt(4, 0, 0);
        probeEdge("bezier", BRepBuilderAPI_MakeEdge(new Geom_BezierCurve(p)).Edge());
    }
    {
        TColgp_Array1OfPnt p(1, 5);
        for (int i = 1; i <= 5; ++i) p(i) = gp_Pnt(i * 1.0, (i % 2) ? 1.0 : 0.0, 0.0);
        probeEdge("b-spline", BRepBuilderAPI_MakeEdge(GeomAPI_PointsToBSpline(p).Curve()).Edge());
    }
    probeEdge("PARABOLA",                                               // [T-151]
              BRepBuilderAPI_MakeEdge(gp_Parab(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 2.), -1., 1.).Edge());
    probeEdge("HYPERBOLA",                                              // [T-151]
              BRepBuilderAPI_MakeEdge(gp_Hypr(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 3., 2.), 0.2, 1.).Edge());

    std::printf("\n=== ADDITIONAL FIXTURES (NOT part of the frozen 19)\n\n");

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
        // A circle edge taken off a real solid (the sphere's seam), so its frame
        // is whatever the primitive builder placed — not one this file chose.
        // (This fixture was previously commented as "a B-spline edge"; it never
        // was one. The RATIONAL B-spline edge below is the one that is.) A
        // missing seam is a FAILURE, not a silently skipped row.
        BRepPrimAPI_MakeSphere sp(1.75);
        TopoDS_Edge got;
        for (TopExp_Explorer ex(sp.Shape(), TopAbs_EDGE); ex.More(); ex.Next()) {
            BRepAdaptor_Curve ac(TopoDS::Edge(ex.Current()));
            if (ac.GetType() == GeomAbs_Circle) { got = TopoDS::Edge(ex.Current()); break; }
        }
        if (!got.IsNull()) {
            compareEdge("SPHERE seam CIRCLE (placed frame)", got);
        } else {
            ++g_fail;
            std::printf("  [FAIL] the sphere has no circular seam edge to compare\n");
        }
    }
    {
        // A RATIONAL B-spline edge: the exact quarter circle (weights 1, 1/sqrt2,
        // 1), so the rational branch of the curve derivative table is what runs.
        TColgp_Array1OfPnt poles(1, 3);
        poles(1) = gp_Pnt(2.0, 0.0, 0.5);
        poles(2) = gp_Pnt(2.0, 2.0, 0.5);
        poles(3) = gp_Pnt(0.0, 2.0, 0.5);
        TColStd_Array1OfReal w(1, 3);
        w(1) = 1.0; w(2) = std::sqrt(0.5); w(3) = 1.0;
        TColStd_Array1OfReal k(1, 2);
        k(1) = 0.0; k(2) = 1.0;
        TColStd_Array1OfInteger m(1, 2);
        m(1) = 3; m(2) = 3;
        Handle(Geom_BSplineCurve) arc = new Geom_BSplineCurve(poles, w, k, m, 2);
        compareEdge("RATIONAL B-SPLINE edge (exact quarter circle)",
                    BRepBuilderAPI_MakeEdge(arc).Edge());
    }

    // ── EXTRUSIONS the frozen row does not reach (T-151) ──────────────────────
    // The frozen "linear extrusion (circle profile)" is a RIGHT circular
    // cylinder in disguise: orthogonal parameters (F = S_u.S_v = 0). An OBLIQUE
    // direction makes F != 0, which is the term an extrusion evaluator that
    // assumed a right cylinder would get wrong; an ELLIPSE profile makes the
    // curvature vary along u, which a constant-curvature profile cannot test.
    {
        Handle(Geom_Ellipse) el = new Geom_Ellipse(
            gp_Ax2(gp_Pnt(0.3, -0.2, 0.1), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)), 3.0, 1.25);
        Handle(Geom_SurfaceOfLinearExtrusion) ex =
            new Geom_SurfaceOfLinearExtrusion(el, gp_Dir(0.35, -0.2, 0.915));
        compareFace("EXTRUSION(ellipse profile, OBLIQUE direction)",
                    BRepBuilderAPI_MakeFace(ex, 0.1, 6.0, -1.0, 2.5, 1e-6).Face());
    }
    {
        // A NON-rational B-spline profile: the tensor path's own territory (its
        // u IS the basis parameter), kept here so that path stays measured too.
        TColgp_Array1OfPnt p(1, 5);
        p(1) = gp_Pnt(0, 0, 0); p(2) = gp_Pnt(1, 1.2, 0); p(3) = gp_Pnt(2.5, 0.4, 0);
        p(4) = gp_Pnt(3.5, 1.5, 0); p(5) = gp_Pnt(5, 0.8, 0);
        Handle(Geom_BSplineCurve) prof = GeomAPI_PointsToBSpline(p).Curve();
        Handle(Geom_SurfaceOfLinearExtrusion) ex =
            new Geom_SurfaceOfLinearExtrusion(prof, gp_Dir(0, 0, 1));
        compareFace("EXTRUSION(B-spline profile)",
                    BRepBuilderAPI_MakeFace(ex, prof->FirstParameter(), prof->LastParameter(),
                                            0.0, 2.0, 1e-6).Face());
    }
    {
        // The two UNBOUNDED conics as profiles, each in a placed frame and swept
        // OBLIQUELY. A hyperbola's tensor form is rational like the circle's; a
        // parabola's is polynomial. Whichever route the bridge takes for each
        // (the form column says which), the values must match LProp.
        Handle(Geom_Hyperbola) hy = new Geom_Hyperbola(
            gp_Ax2(gp_Pnt(-0.5, 0.4, 0.2), gp_Dir(0.1, 0.2, 1.0), gp_Dir(1, 0, -0.1)), 3.0, 2.0);
        Handle(Geom_SurfaceOfLinearExtrusion) ex =
            new Geom_SurfaceOfLinearExtrusion(hy, gp_Dir(0.4, 0.3, 0.866));
        compareFace("EXTRUSION(hyperbola profile, OBLIQUE direction)",
                    BRepBuilderAPI_MakeFace(ex, -1.2, 0.9, -0.5, 1.5, 1e-6).Face());
    }
    {
        Handle(Geom_Parabola) pa = new Geom_Parabola(
            gp_Ax2(gp_Pnt(0.3, -0.6, 0.4), gp_Dir(0.0, 0.3, 1.0), gp_Dir(1, 0, 0)), 1.6);
        Handle(Geom_SurfaceOfLinearExtrusion) ex =
            new Geom_SurfaceOfLinearExtrusion(pa, gp_Dir(-0.3, 0.5, 0.81));
        compareFace("EXTRUSION(parabola profile, OBLIQUE direction)",
                    BRepBuilderAPI_MakeFace(ex, -2.5, 3.0, 0.0, 2.0, 1e-6).Face());
    }

    // ═══════════════ THE PER-KIND TABLE ════════════════════════════════════
    int frozenRows = 0, frozenCarried = 0, extraRows = 0, extraCarried = 0;
    std::printf("\n=== PER-KIND TABLE (CARRIED = bridge ok AND every value matched LProp"
                "\n===   AND, for the frozen 19, forge::classa answered with matching values)\n");
    for (int pass = 0; pass < 2; ++pass) {
        const bool frozen = (pass == 0);
        std::printf("\n  %s\n", frozen ? "FROZEN 19-KIND PROBE"
                                       : "ADDITIONAL FIXTURES (not part of the frozen 19)");
        std::printf("  %-3s %-48s %-7s %-9s %7s %5s  %-9s %-8s\n", "#", "kind", "bridge",
                    "form", "checks", "fail", "classa", "VERDICT");
        int idx = 0;
        for (const KindRow& r : g_rows) {
            if (r.frozen != frozen) continue;
            ++idx;
            const char* cl = !r.classaRan ? "-"
                             : (!r.classaAnswered ? "THREW"
                                                  : (r.classaStations > 0 ? "answered" : "no-data"));
            std::printf("  %-3d %-48s %-7s %-9s %7d %5d  %-9s %-8s\n", idx, r.label.c_str(),
                        r.bridgeOk ? "ok" : "DEFER", r.bridgeForm.c_str(), r.checks,
                        r.fails, cl, r.carried() ? "CARRIED" : "NOT");
            if (!r.bridgeOk)
                std::printf("      bridge reason: %s\n", r.bridgeReason.c_str());
            if (r.classaRan && !r.classaAnswered)
                std::printf("      classa threw:  %s\n", r.classaWhy.c_str());
            if (frozen) { ++frozenRows; if (r.carried()) ++frozenCarried; }
            else        { ++extraRows;  if (r.carried()) ++extraCarried; }
        }
    }
    std::printf("\n  FROZEN 19-KIND PROBE: %d of %d carried\n", frozenCarried, frozenRows);
    std::printf("  ADDITIONAL FIXTURES:  %d of %d carried   (reported separately, never"
                " merged into the 19)\n", extraCarried, extraRows);
    // The denominator is part of the claim. A frozen list that quietly shrank
    // would make "N of N" true and meaningless.
    ckBool("the frozen probe has EXACTLY 19 kinds", frozenRows == 19, true);
    ckBool("every frozen kind is CARRIED", frozenCarried == frozenRows, true);
    ckBool("every additional fixture is CARRIED", extraCarried == extraRows, true);

    std::printf("\n=== RESULT %d passed, %d failed\n", g_pass, g_fail);
    if (g_fail == 0) {
        std::printf("PASS: every LProp quantity the migrated sites read is reproduced by\n"
                    "      forge::props through the bridge, on every supported kind.\n");
    }
    return g_fail == 0 ? 0 : 1;
}
