// native_vs_occt_classa_props_e2e — the four migrated forge::classa entry
// points, END TO END, against closed forms.
//
// WHY THIS EXISTS ALONGSIDE native_vs_occt_surface_props. That gate proves the
// INPUTS agree: every quantity the LProp classes used to return is reproduced
// by forge::props through the T-147 bridge, to 1e-9, on every surface and curve
// kind. It says nothing about whether those quantities were WIRED CORRECTLY
// into the aggregate reports — a curvature comb that reads cp.d2 where it meant
// cp.d1, or a continuity report that lost the mean-curvature sign flip, would
// leave that gate perfectly green. The arithmetic in between is what this gate
// covers, at the level the user actually sees:
//
//   zebraStripes             -> stripe buckets on a sphere
//   curvatureComb            -> kappa == 1/r on a circular edge, comb tip
//                               offset toward the centre
//   gaussianAndMeanCurvature -> K == 1/R^2 on a sphere, K == 0 on a cylinder
//   continuityCheck          -> G0/G1 on a face pair sharing a real edge
//
// Every expectation is a CLOSED FORM or a structural invariant, never a value
// captured from the previous implementation — a golden file recorded from the
// code under test proves only that it still does what it did.
//
// Exit 0 = PASS.

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ClassASurfacing.hpp"
#include "forge/Nurbs.hpp"
#include "forge/ShapeQuery.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/ft/FeatureTree.hpp"

#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Line.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <gp_Ax3.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <Precision.hxx>
#include <gp_Circ.hxx>
#include <gp_Pln.hxx>
#include <Geom_Plane.hxx>

static int g_pass = 0, g_fail = 0;

static void ok(const std::string& what, bool cond, const std::string& detail = "") {
    if (cond) { ++g_pass; std::printf("  [PASS] %s %s\n", what.c_str(), detail.c_str()); }
    else      { ++g_fail; std::printf("  [FAIL] %s %s\n", what.c_str(), detail.c_str()); }
}

static void near(const std::string& what, double got, double want, double tol) {
    char buf[200];
    std::snprintf(buf, sizeof buf, "got %.12g want %.12g |d|=%.3g tol=%.3g",
                  got, want, std::fabs(got - want), tol);
    ok(what, std::fabs(got - want) <= tol, buf);
}

static forge::ShapeHandle reg(const TopoDS_Shape& s) {
    return forge::ShapeRegistry::instance().add(s);
}

static TopoDS_Face faceOfType(const TopoDS_Shape& s, GeomAbs_SurfaceType t) {
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face f = TopoDS::Face(ex.Current());
        BRepAdaptor_Surface ad(f, Standard_True);
        if (ad.GetType() == t) return f;
    }
    return TopoDS_Face();
}

int main() {
    std::printf("=== native_vs_occt_classa_props_e2e — the four migrated forge::classa\n");
    std::printf("=== entry points, end to end, against CLOSED FORMS.\n\n");

    // ------------------------------------------------ gaussianAndMeanCurvature
    // Sphere: K == 1/R^2 everywhere, |H| == 1/R. Cylinder: K == 0, |H| == 1/(2R).
    {
        std::printf("-- gaussianAndMeanCurvature --\n");
        const double R = 1.75;
        BRepPrimAPI_MakeSphere mk(R);
        TopoDS_Face f = faceOfType(mk.Shape(), GeomAbs_Sphere);
        auto s = forge::classa::gaussianAndMeanCurvature(reg(f), 5, 5);
        ok("sphere: 25 samples returned", s.size() == 25,
           "n=" + std::to_string(s.size()));
        double worstK = 0.0, worstH = 0.0;
        for (const auto& c : s) {
            worstK = std::max(worstK, std::fabs(c.K_gaussian - 1.0 / (R * R)));
            worstH = std::max(worstH, std::fabs(std::fabs(c.H_mean) - 1.0 / R));
        }
        near("sphere: max |K - 1/R^2| over the grid", worstK, 0.0, 1e-9);
        near("sphere: max ||H| - 1/R| over the grid", worstH, 0.0, 1e-9);

        BRepPrimAPI_MakeCylinder mkc(2.5, 6.0);
        TopoDS_Face fc = faceOfType(mkc.Shape(), GeomAbs_Cylinder);
        auto sc = forge::classa::gaussianAndMeanCurvature(reg(fc), 4, 4);
        double worstKc = 0.0, worstHc = 0.0;
        for (const auto& c : sc) {
            worstKc = std::max(worstKc, std::fabs(c.K_gaussian));
            worstHc = std::max(worstHc, std::fabs(std::fabs(c.H_mean) - 1.0 / (2 * 2.5)));
        }
        near("cylinder: max |K| (developable)", worstKc, 0.0, 1e-12);
        near("cylinder: max ||H| - 1/(2R)|", worstHc, 0.0, 1e-9);
        // The principals must still bracket H and multiply to K — the two
        // conditioning-immune facts, asserted on the PRODUCT output.
        double worstSum = 0.0, worstProd = 0.0;
        for (const auto& c : sc) {
            worstSum  = std::max(worstSum,  std::fabs((c.kappaMin + c.kappaMax) - 2 * c.H_mean));
            worstProd = std::max(worstProd, std::fabs(c.kappaMin * c.kappaMax - c.K_gaussian));
        }
        near("cylinder: max |kMin+kMax - 2H|", worstSum, 0.0, 1e-9);
        near("cylinder: max |kMin*kMax - K|", worstProd, 0.0, 1e-9);
    }

    // ------------------------------------------------------------ zebraStripes
    {
        std::printf("-- zebraStripes --\n");
        BRepPrimAPI_MakeSphere mk(5.0);
        TopoDS_Face f = faceOfType(mk.Shape(), GeomAbs_Sphere);
        auto z = forge::classa::zebraStripes(reg(f), 8, 0, 0, 1, 12, 12);
        ok("sphere: 144 samples", z.size() == 144, "n=" + std::to_string(z.size()));
        bool bucketsInRange = true;
        std::vector<int> seen(8, 0);
        for (const auto& s : z) {
            if (s.stripeIndex >= 8) bucketsInRange = false;
            else seen[s.stripeIndex] = 1;
        }
        ok("every stripeIndex < stripeCount", bucketsInRange);
        int distinct = 0; for (int v : seen) distinct += v;
        ok("stripes span >= 2 buckets (the normal field actually varies)",
           distinct >= 2, "distinct=" + std::to_string(distinct));
        // The zebra angle is atan2 of the normal in the view plane, so it must
        // stay in [-pi, pi]; a garbage normal shows up here immediately.
        bool angOk = true;
        for (const auto& s : z) if (!(s.normalAngle >= -M_PI - 1e-12 && s.normalAngle <= M_PI + 1e-12)) angOk = false;
        ok("every normalAngle in [-pi, pi]", angOk);
    }

    // ----------------------------------------------------------- curvatureComb
    // A circular edge of radius r has kappa == 1/r at every station, and the comb
    // tip sits at distance |r - kappa*scale| from the centre (the principal
    // normal points INWARD, toward the centre of curvature).
    {
        std::printf("-- curvatureComb --\n");
        const double r = 2.5, scale = 0.4;
        gp_Circ ci(gp_Ax2(gp_Pnt(1, 2, 3), gp_Dir(0.3, 0.2, 0.9), gp_Dir(1, 0, 0)), r);
        BRepBuilderAPI_MakeEdge mk(ci);
        auto comb = forge::classa::curvatureComb(reg(mk.Edge()), 9, scale);
        ok("9 samples", comb.size() == 9, "n=" + std::to_string(comb.size()));
        double worstK = 0.0, worstPos = 0.0, worstTip = 0.0;
        for (const auto& c : comb) {
            worstK = std::max(worstK, std::fabs(c.curvature - 1.0 / r));
            const double dx = c.position3d[0] - 1.0, dy = c.position3d[1] - 2.0,
                         dz = c.position3d[2] - 3.0;
            worstPos = std::max(worstPos, std::fabs(std::sqrt(dx * dx + dy * dy + dz * dz) - r));
            const double tx = c.combTip3d[0] - 1.0, ty = c.combTip3d[1] - 2.0,
                         tz = c.combTip3d[2] - 3.0;
            const double tipR = std::sqrt(tx * tx + ty * ty + tz * tz);
            worstTip = std::max(worstTip, std::fabs(tipR - (r - (1.0 / r) * scale)));
        }
        near("max |kappa - 1/r|", worstK, 0.0, 1e-9);
        near("max |position on the circle| - r", worstPos, 0.0, 1e-9);
        near("comb tip is kappa*scale INWARD (normal -> centre)", worstTip, 0.0, 1e-9);
    }

    // ---------------------------------------------------------- continuityCheck
    // Two halves of ONE plane, split along a shared line: the join is exactly
    // G2 (same surface), so g0 == 0, g1 == 0 and g2 == 0 to round-off. This is
    // the report's own definition, not a recorded number.
    {
        std::printf("-- continuityCheck --\n");
        Handle(Geom_Plane) pl = new Geom_Plane(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));
        BRepBuilderAPI_MakeFace mkA(pl, -2.0, 0.0, -1.0, 1.0, Precision::Confusion());
        BRepBuilderAPI_MakeFace mkB(pl,  0.0, 2.0, -1.0, 1.0, Precision::Confusion());
        BRepBuilderAPI_MakeEdge mkE(gp_Pnt(0, -1, 0), gp_Pnt(0, 1, 0));
        auto rep = forge::classa::continuityCheck(reg(mkA.Face()), reg(mkB.Face()),
                                                  reg(mkE.Edge()), 7);
        ok("samples were accepted", rep.samples > 0,
           "samples=" + std::to_string(rep.samples));
        near("coplanar join: g0_max_mm == 0", rep.g0_max_mm, 0.0, 1e-9);
        near("coplanar join: g1_max_deg == 0", rep.g1_max_deg, 0.0, 1e-7);
        near("coplanar join: g2_max_pct == 0", rep.g2_max_pct, 0.0, 1e-6);
        ok("coplanar join reports G3 continuity", rep.g3_continuity);
    }

    // ========================= CROSS-FACE CONTINUITY =========================
    // WHY THIS EXISTS, in the words of the failure that bought it.
    //
    // The coplanar join above, and the 19-kind capability probe beside it, both
    // measure ONE surface at a time. A bridge can be exact per-surface and still
    // be wrong AT A SEAM, because a seam is where the (u,v) MAP, the face's own
    // parameter window and the frame's HANDEDNESS all have to agree — and none
    // of those is visible from inside a single face. T-147 shipped with two such
    // defects and 19/19 green:
    //
    //   1. AN UNBOUNDED BASIS CURVE. A prismatic wall is a
    //      Geom_SurfaceOfLinearExtrusion whose basis Geom_Line reports the range
    //      [-2e100, 2e100]. Built over that range the native tensor B-spline
    //      collapses to the line's midpoint, so the wall answered ONE frozen
    //      point and its joins read a 22 mm / 37 mm gap (half the face's u-span)
    //      on a solid that is exactly closed.
    //   2. A LEFT-HANDED gp_Ax3. brep::Surface's binormal is always
    //      axis x refDir; OCCT's YDirection is its negative when Direct() is
    //      false, so the imported quadric was the MIRROR and answered the
    //      DIAMETRICALLY OPPOSITE point — a 2r gap. OCCT built two of the four
    //      blend cylinders of an ordinary filleted prism that way.
    //
    // Both are asserted below on fixtures whose right answer is arithmetic on
    // the fixture's own definition, and each fixture PROVES IT IS THE THING IT
    // CLAIMS TO BE (the basis really is unbounded; the frame really is
    // left-handed) before the measurement is allowed to count.
    {
        std::printf("-- continuityCheck ACROSS FACES: an extrusion wall on an "
                    "UNBOUNDED basis --\n");
        // The wall: P(u,v) = (-40 + u, -25, v) over the SAME window the desktop
        // default part's 80 mm wall has, u in [3, 77], v in [0, 20]. Its basis is
        // a Geom_Line, so its parameter range is OCCT's infinity and there is no
        // domain to build a B-spline over except the face's own u-window.
        Handle(Geom_Line) basis = new Geom_Line(gp_Pnt(-40, -25, 0), gp_Dir(1, 0, 0));
        ok("the wall's basis curve really is UNBOUNDED (else this proves nothing)",
           Precision::IsInfinite(basis->FirstParameter()) &&
               Precision::IsInfinite(basis->LastParameter()),
           "range = [" + std::to_string(basis->FirstParameter()) + ", " +
               std::to_string(basis->LastParameter()) + "]");
        Handle(Geom_SurfaceOfLinearExtrusion) wall =
            new Geom_SurfaceOfLinearExtrusion(basis, gp_Dir(0, 0, 1));
        BRepBuilderAPI_MakeFace mkWall(wall, 3.0, 77.0, 0.0, 20.0, Precision::Confusion());
        // The cap it meets at z = 20, and the shared edge between them: the top
        // of the wall, from u = 3 to u = 77.
        Handle(Geom_Plane) cap = new Geom_Plane(gp_Pnt(0, 0, 20), gp_Dir(0, 0, 1));
        BRepBuilderAPI_MakeFace mkCap(cap, -60.0, 60.0, -40.0, 40.0, Precision::Confusion());
        BRepBuilderAPI_MakeEdge mkTop(gp_Pnt(-37, -25, 20), gp_Pnt(37, -25, 20));
        // A DEFER IS A FAILURE AND MUST READ LIKE ONE. The bridge has no OCCT
        // fallback by design, so an unsupported face makes continuityCheck THROW;
        // letting that escape would abort the process and report which assertion
        // failed to nobody. Caught here so the verdict is a named FAIL line.
        forge::classa::ContinuityReport rep;
        try {
            rep = forge::classa::continuityCheck(reg(mkWall.Face()), reg(mkCap.Face()),
                                                 reg(mkTop.Edge()), 16);
        } catch (const std::exception& e) {
            ok("the wall/cap join could be measured at all", false, e.what());
        }
        ok("samples were accepted", rep.samples > 0,
           "samples=" + std::to_string(rep.samples));
        // Both faces contain the edge EXACTLY, so the gap is zero by construction
        // and the wall stands square to the cap. 37 mm -- half the u-span -- is
        // the number the unbounded-basis defect produced here.
        near("wall/cap join: g0_max_mm == 0 (no gap on an exact meeting)",
             rep.g0_max_mm, 0.0, 1e-9);
        near("wall/cap join: g1_max_deg == 90 (a wall meets its cap square)",
             rep.g1_max_deg, 90.0, 1e-6);
    }
    {
        std::printf("-- continuityCheck ACROSS FACES: a LEFT-HANDED cylinder "
                    "TANGENT to its wall --\n");
        // A blend cylinder r = 3 about +Z at the origin, on a deliberately
        // LEFT-handed frame, and the plane y = 3 it touches along x = 0, y = 3.
        // Tangency is the whole point: the two normals agree there, so g1 == 0 --
        // the "no crease where a fillet meets its wall" property, which is exactly
        // what a mirrored frame destroys.
        const double r = 3.0;
        gp_Ax3 frame(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
        frame.YReverse();                       // <- the mirror, made on purpose
        ok("the blend's frame really IS left-handed (else this proves nothing)",
           !frame.Direct(), "gp_Ax3::Direct() == false");
        Handle(Geom_CylindricalSurface) cyl = new Geom_CylindricalSurface(frame, r);
        BRepBuilderAPI_MakeFace mkCyl(cyl, 3.14159265358979, 2.0 * 3.14159265358979,
                                      0.0, 10.0, Precision::Confusion());
        Handle(Geom_Plane) wall = new Geom_Plane(gp_Pnt(0, r, 0), gp_Dir(0, 1, 0));
        BRepBuilderAPI_MakeFace mkWall(wall, -8.0, 8.0, -8.0, 18.0, Precision::Confusion());
        BRepBuilderAPI_MakeEdge mkTan(gp_Pnt(0, r, 0), gp_Pnt(0, r, 10));
        forge::classa::ContinuityReport rep;
        try {
            rep = forge::classa::continuityCheck(reg(mkCyl.Face()), reg(mkWall.Face()),
                                                 reg(mkTan.Edge()), 16);
        } catch (const std::exception& e) {
            ok("the tangent join could be measured at all", false, e.what());
        }
        ok("samples were accepted", rep.samples > 0,
           "samples=" + std::to_string(rep.samples));
        // The mirrored frame answered the point 2r across the axis: 6.000 mm.
        near("tangent join: g0_max_mm == 0 (the blend touches the wall)",
             rep.g0_max_mm, 0.0, 1e-9);
        near("tangent join: g1_max_deg == 0 (tangent means NO crease)",
             rep.g1_max_deg, 0.0, 1e-6);
    }
    {
        std::printf("-- continuityCheck over EVERY join of a real composed part --\n");
        // The desktop application's own default part, built here through the same
        // kernel IR the app seeds: an 80 x 50 x 20 plate, a 12 mm through bore, r3
        // on the vertical corners. Its walls are surfaces of linear extrusion and
        // its blends are B-splines, so the join inventory below is the composition
        // the two fixtures above cover one at a time. The desktop quality gate
        // asserts the same three counts; asserting them HERE means a kernel-side
        // regression is caught in the kernel job, not only in the app's.
        forge::ft::CompileResult cr = forge::ft::compileText(
            "%1 = RECT(80, 50)\n"
            "%2 = EXTRUDE(%1, 20)\n"
            "%3 = CYL(6, 40, 0, 0, -10)\n"
            "%4 = CUT(%2, %3)\n"
            "%5 = FILLET(%4, 3, VERTICAL)\n", "");
        ok("the composed part builds", cr.ok, cr.error);
        if (cr.ok) {
            std::size_t joins = 0, measured = 0, apart = 0, tangent = 0, square = 0;
            double worstG0 = 0.0;
            for (const forge::EdgeJoin& j : forge::shapeEdgeJoins(cr.handle)) {
                if (j.seam) continue;           // a face meeting ITSELF is not a join
                ++joins;
                try {
                    const forge::classa::ContinuityReport rep =
                        forge::classa::continuityCheck(j.faceA, j.faceB, j.edge, 16);
                    if (rep.samples == 0) continue;
                    ++measured;
                    if (rep.g0_max_mm > worstG0) worstG0 = rep.g0_max_mm;
                    if (rep.g0_max_mm >= 1.0e-3)      ++apart;
                    else if (rep.g1_max_deg < 1.0)    ++tangent;
                    else if (rep.g1_max_deg > 80.0)   ++square;
                } catch (const std::exception& e) {
                    ok("every join could be measured", false, e.what());
                }
            }
            // THE DENOMINATOR, printed rather than trusted: an empty join set would
            // otherwise satisfy "apart == 0" silently.
            std::printf("     joins=%zu measured=%zu apart=%zu tangent=%zu square=%zu "
                        "worst g0=%.4g mm\n",
                        joins, measured, apart, tangent, square, worstG0);
            ok("the part has the joins a filleted bored plate has",
               joins >= 24, "joins=" + std::to_string(joins));
            ok("every join produced a measurement",
               measured == joins,
               std::to_string(measured) + " of " + std::to_string(joins));
            ok("no join on a sound solid leaves a gap",
               apart == 0, "apart=" + std::to_string(apart) +
                   ", worst g0=" + std::to_string(worstG0) + " mm");
            ok("the fillets meet their walls with no crease",
               tangent >= 4, "tangent=" + std::to_string(tangent));
            ok("the plate's own corners meet at a right angle",
               square >= 4, "square=" + std::to_string(square));
        }
    }

    std::printf("\n=== RESULT %d passed, %d failed\n", g_pass, g_fail);
    if (g_fail == 0)
        std::printf("PASS: the four migrated forge::classa entry points produce the\n"
                    "      closed-form-correct reports through the native facade.\n");
    return g_fail == 0 ? 0 : 1;
}
