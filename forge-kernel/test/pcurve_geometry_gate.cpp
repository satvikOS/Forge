// pcurve_geometry_gate.cpp — cylinderPCurve() on REAL GEOMETRY: the drafted plane
// meeting a cylinder that is the whole of the remaining DRAFT gap.
//
// WHY THIS EXISTS. reports/DRAFT_NATIVE_ENGINE.md section 5 names the blocker
// exactly: "The entire remaining gap to OCCT is 73 parts, and every one is a
// drafted plane meeting a CYLINDER ... What blocks it is the pcurve on the
// cylinder. On the cylinder's own (u, v) parameterisation that section is
// v(u) = a + b cos u + c sin u, a sinusoid. No Geom2d conic represents it, so it
// must be approximated." test/run_pcurve_fit_gate.sh covers the NUMERICS
// underneath the fit and says in its own header that it does NOT touch
// cylinderPCurve. This does.
//
// WHAT IS MEASURED, and it is measured OUT OF SAMPLE. cylinderPCurve grades
// itself on an audit set "deliberately OFFSET from every sample the fit sees",
// because a fit graded on its own sample points is graded on the one set where a
// least-squares solution is guaranteed to look good. maxDev3d is that number, in
// model units, and this gate asserts on it.
#include "forge/native/geom/NativePCurveFit.hpp"

#include <cmath>
#include <cstdio>
#include <string>

#include <Geom_Curve.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

static int g_fail = 0, g_checks = 0;
static void ok(bool c, const std::string& what) {
  ++g_checks;
  if (!c) { std::printf("[pcurve-geom] FAIL: %s\n", what.c_str()); ++g_fail; }
}

int main() {
  using namespace forge::pcurvefit;

  const gp_Ax3 cyl(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
  const double R = 20.0;

  // ── 1. THE BLOCKER ITSELF: a plane drafted off the axis, cutting the cylinder ──
  // A draft angle is the tilt of the wall from the pull direction. Sweeping it
  // proves the fit holds across the range a real part uses, not at one lucky angle.
  for (const double deg : {1.0, 3.0, 5.0, 7.0, 10.0, 15.0, 30.0}) {
    const double th = deg * 3.14159265358979323846 / 180.0;
    // The plane's unit normal, tilted from +Z by th, through the point (0,0,30).
    const gp_Dir n(std::sin(th), 0.0, std::cos(th));
    const double d = n.X() * 0.0 + n.Y() * 0.0 + n.Z() * 30.0;

    const PlaneCylSection sec = planeCylinderSection(n, d, cyl, R);
    const std::string tag = " (draft " + std::to_string(int(deg)) + " deg)";
    ok(sec.kind == SectionKind::Ellipse, "a tilted plane sections the cylinder in an ELLIPSE" + tag);
    ok(!sec.curve.IsNull(), "the section curve exists" + tag + (sec.defer.empty() ? "" : " defer=" + sec.defer));
    if (sec.curve.IsNull()) continue;

    // The section must lie on BOTH surfaces. A wrong 3-D curve with a perfect
    // pcurve is still a wrong edge, so this is checked before the fit.
    const double res = sectionResidual(sec, n, d, cyl, R);
    ok(res < 1e-9, "the section lies on both surfaces, residual=" + std::to_string(res) + tag);

    const double t0 = sec.curve->FirstParameter(), t1 = sec.curve->LastParameter();
    const double tol = 1.0e-7;
    const PCurveFit fit = cylinderPCurve(sec.curve, t0, t1, cyl, R, tol);
    ok(!fit.curve.IsNull(),
       "a pcurve was produced" + tag + (fit.defer.empty() ? "" : " defer=" + fit.defer));
    if (fit.curve.IsNull()) continue;
    ok(fit.maxDev3d >= 0.0 && fit.maxDev3d <= tol,
       "OUT-OF-SAMPLE deviation " + std::to_string(fit.maxDev3d) + " <= " + std::to_string(tol) + tag);
    ok(fit.nAudit > 0, "the audit set is non-empty" + tag);
    // u is the cylinder's angular parameter: the pcurve must track it exactly,
    // because only v is approximated. A drifting u is a wrong edge, not a coarse one.
    ok(fit.maxDevU >= 0.0 && fit.maxDevU < 1e-9,
       "u is reproduced exactly, maxDevU=" + std::to_string(fit.maxDevU) + tag);
  }

  // ── 2. THE EXACT CASE falls out of the same code path ────────────────────
  // A plane PERPENDICULAR to the axis meets the cylinder in a circle whose pcurve
  // is v = const -- a straight line in (u, v). The header's claim is that this is
  // not special-cased but emerges from measuring the relation; `exact` says so.
  {
    const gp_Dir n(0, 0, 1);
    const PlaneCylSection sec = planeCylinderSection(n, 30.0, cyl, R);
    ok(sec.kind == SectionKind::Circle, "a perpendicular plane sections in a CIRCLE");
    ok(!sec.curve.IsNull(), "the circle exists");
    if (!sec.curve.IsNull()) {
      ok(sectionResidual(sec, n, 30.0, cyl, R) < 1e-9, "the circle lies on both surfaces");
      const PCurveFit fit =
          cylinderPCurve(sec.curve, sec.curve->FirstParameter(), sec.curve->LastParameter(),
                         cyl, R, 1.0e-7);
      ok(!fit.curve.IsNull(), "the circle's pcurve exists");
      ok(fit.exact, "v = const is emitted EXACTLY, not fitted");
      ok(fit.maxDev3d >= 0.0 && fit.maxDev3d < 1e-9,
         "and its deviation is ~0: " + std::to_string(fit.maxDev3d));
    }
  }

  // ── 3. NEGATIVE CONTROLS — the guards must REFUSE, with a reason ──────────
  // A function that never defers is a function whose defer path is untested.
  {
    const gp_Dir para(1, 0, 0);  // parallel to the axis: two generatrices, not one curve
    const PlaneCylSection sec = planeCylinderSection(para, 0.0, cyl, R);
    ok(sec.curve.IsNull(), "a plane parallel to the axis yields NO single section curve");
    ok(!sec.defer.empty(), "and it says why: " + sec.defer);

    const gp_Dir miss(1, 0, 0);
    const PlaneCylSection out = planeCylinderSection(miss, R * 3.0, cyl, R);
    ok(out.curve.IsNull(), "a parallel plane that misses the cylinder yields no curve");
    ok(!out.defer.empty(), "and it says why: " + out.defer);

    const PCurveFit noCurve = cylinderPCurve(Handle(Geom_Curve)(), 0.0, 1.0, cyl, R, 1e-7);
    ok(noCurve.curve.IsNull() && noCurve.defer == "no 3-D curve", "a null 3-D curve is refused by name");
    const PlaneCylSection cs = planeCylinderSection(gp_Dir(0, 0, 1), 30.0, cyl, R);
    const PCurveFit badR = cylinderPCurve(cs.curve, 0.0, 1.0, cyl, -1.0, 1e-7);
    ok(badR.curve.IsNull() && badR.defer == "the cylinder radius is not positive",
       "a non-positive radius is refused by name");
    const PCurveFit badRange = cylinderPCurve(cs.curve, 1.0, 1.0, cyl, R, 1e-7);
    ok(badRange.curve.IsNull() && badRange.defer == "the parameter range is empty",
       "an empty parameter range is refused by name");
  }

  std::printf("[pcurve-geom] %d checks, %d failed\n", g_checks, g_fail);
  return g_fail == 0 ? 0 : 1;
}
