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
// ★ T-154: the pcurve fit itself is now NATIVE and OCCT-FREE. This gate drives it
// through gp_Ax3 / Handle(Geom_Curve) fixtures, so it exercises the OCCT BRIDGE —
// which is the right seam to test: it covers the native arithmetic AND the type
// conversion the draft engine actually depends on.
#include "forge/PCurveFitOcctBridge.hpp"

#include <cmath>
#include <cstdio>
#include <limits>
#include <string>
#include <utility>
#include <vector>

#include <Geom_Curve.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

static int g_fail = 0, g_checks = 0;
static void ok(bool c, const std::string& what) {
  ++g_checks;
  if (!c) { std::printf("[pcurve-geom] FAIL: %s\n", what.c_str()); ++g_fail; }
}

int main() {
  using namespace forge::pcurvefit::occt;

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

  // ── 1b. ★ A LEFT-HANDED (INDIRECT) gp_Ax3, CHECKED AGAINST OCCT'S OWN SURFACE ──
  // T-154. The native fit carries its own frame and STORES ydir rather than deriving
  // `dir x xdir`, because gp_Ax3 may be INDIRECT: its YDirection() is the NEGATIVE of
  // that cross product when Direct() is false. Deriving it would mirror the u
  // parameterisation of every indirect cylinder — a pcurve that is wrong and
  // perfectly well-formed, which is the one shape this engine must never emit.
  //
  // ★★ AND THE OBVIOUS TEST FOR THAT DOES NOT WORK — MEASURED, after writing it.
  //    Asserting on `fit.maxDev3d` catches NOTHING, because maxDev3d is computed by
  //    mapping the pcurve back through the SAME frame the fit used: mirror ydir and
  //    the sampling and the audit mirror together, the error cancels exactly, and a
  //    gate built from the engine's own numbers reports 78 checks / 0 failed over the
  //    defect. A self-consistent check cannot see a consistent mistake.
  //
  //    So the oracle has to be EXTERNAL, and the right external oracle is the one the
  //    contract is actually about: a pcurve exists to be attached to an OCCT FACE, so
  //    it is checked against Geom_CylindricalSurface::Value(u, v) — OCCT's own
  //    parameterisation of this very cylinder, which honours YDirection(). With ydir
  //    derived instead of carried, that lands the point on the wrong side of the axis.
  {
    gp_Ax3 lh(gp_Pnt(2.0, 1.0, -3.0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
    lh.YReverse();
    ok(!lh.Direct(), "the left-handed fixture really is INDIRECT (else this block proves nothing)");
    const double Rlh = 13.0;
    for (const double deg : {4.0, 18.0, 40.0}) {
      const double th = deg * 3.14159265358979323846 / 180.0;
      const gp_Dir n(std::sin(th), 0.0, std::cos(th));
      const std::string tag = " [left-handed " + std::to_string(int(deg)) + " deg]";
      const PlaneCylSection sec = planeCylinderSection(n, 6.0, lh, Rlh);
      ok(sec.kind == SectionKind::Ellipse, "an indirect frame still sections in an ELLIPSE" + tag);
      if (sec.curve.IsNull()) { ok(false, "the section exists" + tag); continue; }
      ok(sectionResidual(sec, n, 6.0, lh, Rlh) < 1e-9,
         "the section lies on both surfaces" + tag);
      const PCurveFit fit =
          cylinderPCurve(sec.curve, sec.curve->FirstParameter(), sec.curve->LastParameter(),
                         lh, Rlh, 1.0e-7);
      ok(!fit.curve.IsNull(), "the pcurve on an INDIRECT cylinder exists" + tag +
                              (fit.curve.IsNull() ? " defer=\"" + fit.defer + "\"" : ""));
      ok(fit.maxDev3d >= 0.0 && fit.maxDev3d <= 1.0e-7,
         "the engine's own bound holds" + tag + " (NOTE: this one cannot see a "
         "mirrored frame — see the block comment): " + std::to_string(fit.maxDev3d));
      // ★ THE ASSERTION THAT ACTUALLY CATCHES A DERIVED ydir: OCCT's own surface.
      if (!fit.curve.IsNull()) {
        const Handle(Geom_CylindricalSurface) surf = new Geom_CylindricalSurface(lh, Rlh);
        const double a0 = sec.curve->FirstParameter(), a1 = sec.curve->LastParameter();
        double worst = 0.0;
        for (int k = 0; k < 64; ++k) {
          const double t = a0 + (a1 - a0) * (double(k) + 0.5) / 64.0;   // off-sample
          const gp_Pnt2d q = fit.curve->Value(t);
          worst = std::max(worst, surf->Value(q.X(), q.Y()).Distance(sec.curve->Value(t)));
        }
        ok(worst <= 1.0e-6,
           "the pcurve is valid on OCCT'S OWN Geom_CylindricalSurface (u,v): "
           + std::to_string(worst) + tag);
      }
      ok(fit.maxDevU >= 0.0 && fit.maxDevU < 1e-9,
         "u comes through exactly on an indirect frame: " + std::to_string(fit.maxDevU) + tag);
    }
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

  // ── 5. ★ A KNOT VECTOR IS UNTRUSTED INPUT ────────────────────────────────
  // BSpline2d is the OCCT-free carrier T-154 introduced, and its fields arrive
  // from whatever built them — including, once a pcurve is read back from a STEP
  // file, a parser. The first version validated only "multiplicity >= 1" and the
  // expanded length, which is an assumption, not validation. MEASURED on that
  // version, every case below returned valid() == true, and the first two returned
  // NON-FINITE COORDINATES from a curve that called itself valid:
  //
  //     NaN knot -> (nan, nan)      decreasing knots -> (10, 0), plausible and wrong
  //     inf knot -> (nan, nan)      endpoint mult != degree+1 -> a point not on a
  //                                 clamped curve at all
  //
  // This is T-153's defect class in a new carrier: 30 runtime assert() sites under
  // src/native guard degenerate rational weights and cusps from parsed STEP, and
  // under NDEBUG an assert is not a guard at all — the arithmetic simply runs on
  // ±inf/NaN. So the carrier REFUSES, by return value, identically in every build.
  //
  // ★ THE TWO CONTROLS ARE LOAD-BEARING: without a well-formed curve that must be
  //   ACCEPTED, a validator that refuses everything would pass this block.
  {
    const double qNaN = std::numeric_limits<double>::quiet_NaN();
    const double qInf = std::numeric_limits<double>::infinity();
    using forge::pcurvefit::BSpline2d;
    using forge::pcurvefit::Pnt2d;

    auto mk = [](int deg, std::vector<Pnt2d> poles,
                 std::vector<double> kn, std::vector<int> mu) {
      BSpline2d c; c.degree = deg; c.poles = std::move(poles);
      c.knots = std::move(kn); c.mults = std::move(mu); return c;
    };
    auto refuses = [&](const BSpline2d& c, const std::string& what) {
      ok(!c.valid(), "REFUSED: " + what);
      const Pnt2d p = c.value(0.5);
      ok(std::isfinite(p.x) && std::isfinite(p.y),
         "and value() stays finite for " + what);
    };

    // CONTROL 1 — a well-formed clamped degree-1 curve must be ACCEPTED.
    const BSpline2d ctl1 = mk(1, {{0,0},{10,0}}, {0.0, 1.0}, {2,2});
    ok(ctl1.valid(), "control: a well-formed clamped degree-1 curve is ACCEPTED");
    ok(std::fabs(ctl1.value(0.5).x - 5.0) < 1e-12,
       "control: and it evaluates correctly (midpoint x == 5)");

    // CONTROL 2 — a well-formed degree-2 curve with a legal interior knot.
    const BSpline2d ctl2 = mk(2, {{0,0},{3,4},{7,4},{10,0}}, {0.0,0.5,1.0}, {3,1,3});
    ok(ctl2.valid(), "control: a clamped degree-2 curve with a legal interior knot is ACCEPTED");

    refuses(mk(1, {{0,0},{10,0}}, {qNaN, 1.0}, {2,2}),            "a NaN knot");
    refuses(mk(1, {{0,0},{10,0}}, {0.0, qInf}, {2,2}),            "an infinite knot");
    refuses(mk(1, {{0,0},{10,0}}, {1.0, 0.0}, {2,2}),             "a DECREASING knot vector");
    refuses(mk(1, {{0,0},{10,0}}, {0.0, 0.0}, {2,2}),             "a duplicated 'distinct' knot (zero span)");
    // ★ THIS CASE ISOLATES ONE RULE, and the first version did not. It was written
    //   as mults {2,3,2}, whose ENDPOINTS are also wrong (2 != degree+1 == 3), so it
    //   was refused by the clamped-endpoint rule and removing the interior cap
    //   changed nothing — the mutation 'INTERIOR multiplicity cap removed' was NOT
    //   caught and said so. Endpoints are now legal (3 == degree+1) and ONLY the
    //   interior multiplicity violates: 6 poles, sum of mults 9 == 6 + 2 + 1.
    refuses(mk(2, {{0,0},{2,4},{5,5},{8,4},{9,2},{10,0}}, {0.0,0.5,1.0}, {3,3,3}),
            "an interior multiplicity above the degree (endpoints legal)");
    refuses(mk(2, {{0,0},{3,4},{7,4},{10,0}}, {0.0,0.25,0.75,1.0}, {2,1,1,3}),
            "an endpoint multiplicity that is not degree+1 (unclamped)");
    refuses(mk(1, {{0,0},{qNaN,0}}, {0.0, 1.0}, {2,2}),           "a NaN POLE");
    refuses(mk(1, {{0,0},{10,0}}, {0.0, 1.0}, {2,1}),             "a multiplicity sum that does not match the poles");
  }

  std::printf("[pcurve-geom] %d checks, %d failed\n", g_checks, g_fail);
  return g_fail == 0 ? 0 : 1;
}
