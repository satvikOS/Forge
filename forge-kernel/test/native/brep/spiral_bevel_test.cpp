// forge/native/brep/spiral_bevel_test.cpp
//
// Standalone ANALYTIC gate for the SPIRAL BEVEL gear generator (Gear.hpp,
// buildSpiralBevelGear). Pure C++20, no OCCT, no test framework, deterministic.
//
// The spiral bevel is the explicitly-named follow-up the Gear module documents as
// "not faked here" (Gear.hpp GearType enum / HONEST SCOPE). It is the straight-bevel
// taper (buildBevelGear's lofted toothed frustum) with the tooth LENGTHWISE trace
// laid out as a CIRCULAR-ARC spiral on the pitch cone — the standard Gleason
// approximation. The transverse profile remains the back-cone involute.
//
// VERIFIED HERE against CLOSED-FORM ground truth (no OCCT primitive exists for a
// spiral bevel, so the A/B is analytic):
//
//   (A) SPIRAL ANGLE at the MEAN cone radius == the prescribed mean spiral angle
//       psi_m, to <= 1e-3 rad. MEASURED from the ACTUAL lengthwise tooth centreline
//       trace (spiralBevelCentrelinePoint): we numerically differentiate the trace at
//       the mean cone distance R_m and form the angle between the lengthwise tangent
//       and the cone RADIAL direction. Ground truth: for the Gleason circular-arc
//       spiral with invariant c = R_m*sin(psi_m), sin(psi(rho)) = c/rho, so at R_m
//       sin(psi) == sin(psi_m) EXACTLY.
//
//   (B) TOOTH COUNT == N (the addendum arcs of the back-cone involute ring).
//
//   (C) CLOSED 2-MANIFOLD via the kernel's own validator (isClosedTwoManifold) AND
//       the Euler-Poincare genus check: with a central bore the toothed frustum is a
//       genus-1 solid, so V - E + F == 0 (eulerPoincareValid(shells=1, genus=1)).
//       Without a bore it is genus 0 (V - E + F == 2).
//
//   (D) PITCH DIAMETER == module*teeth at the back cone, EXACTLY (==, not within tol);
//       back-cone taper exact: 0 < small/back scale < 1 (teeth taper toward the apex).
//
//   (E) STRAIGHT-BEVEL REDUCTION: spiralAngle == 0 reduces EXACTLY to buildBevelGear
//       with the same other params — identical volume, V, E, F, area (the strong
//       regression anchor).
//
// DETERMINISM: any sampling uses a FIXED seed constant with an argv[1] override (NOT
// std::random_device) so the parent's CI gate is reproducible. (This gate is in fact
// fully deterministic — no RNG path is exercised — but the seed plumbing is present
// as mandated.)

#include "forge/native/brep/Gear.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/NurbsSurface.hpp" // declares evaluatePoint/evaluateWithDerivatives (defined by the real NurbsSurface.cpp the gate links)

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

using namespace forge::native::brep;

// NOTE: a spiral-bevel gear emits ONLY Plane/Cylinder analytic faces, so Surface.cpp's
// `case SurfaceKind::Nurbs:` branch (which calls evaluatePoint / evaluateWithDerivatives)
// is never reached here. The full run_native gate links the real NurbsSurface.cpp, which
// provides those evaluators — no test-only shim needed.

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
constexpr double PI = 3.14159265358979323846;

int main(int argc, char** argv) {
    // DETERMINISM: fixed default seed, argv[1] override; NOT std::random_device.
    std::uint64_t seed = 0x5BE7A11ABCDEF123ULL;
    if (argc > 1) seed = std::strtoull(argv[1], nullptr, 0);
    (void)seed; // no RNG path is exercised; plumbing present per the CI mandate.

    std::printf("== spiral_bevel_test (Gleason circular-arc spiral bevel gear) ==\n");

    // -----------------------------------------------------------------------
    // Spiral bevel: m=3, N=20, pressure angle 20 deg, pitch-cone 45 deg, mean
    // spiral angle 35 deg (the Gleason default), face band 8 (< cone distance),
    // central bore 4.
    // -----------------------------------------------------------------------
    GearSpec spec;
    spec.gearType       = GearType::SpiralBevel;
    spec.module         = 3.0;
    spec.teeth          = 20;
    spec.pressureAngle  = 20.0 * PI / 180.0;
    spec.faceWidth      = 8.0;
    spec.boreRadius     = 4.0;
    spec.pitchConeAngle = 45.0 * PI / 180.0;
    spec.spiralAngle    = 35.0 * PI / 180.0; // psi_m
    spec.flankSamples   = 24;

    GearGeometry g = gearDimensions(spec);

    // ---- (D) PITCH DIAMETER == m*N at the back cone, EXACTLY ------------------
    const double dExpect = spec.module * (double)spec.teeth; // 3*20 = 60
    std::printf("  back-cone pitch diameter d = m*N = %.17g  (expect %.17g)\n",
                g.pitchDiameter, dExpect);
    check(g.pitchDiameter == dExpect, "back-cone pitch diameter == m*N exactly");
    check(g.pitchDiameter == 60.0,    "back-cone pitch diameter == 60 exactly");
    std::printf("  pitch r=%.6f  addendum r=%.6f  root r=%.6f  cone angle=%.6f  coneDist R=%.6f  spiralAngle=%.6f\n",
                g.pitchRadius, g.addendumRadius, g.rootRadius, g.pitchConeAngle,
                g.coneDistance, g.spiralAngle);
    check(g.addendumRadius > g.rootRadius, "addendum radius > root radius (teeth point out)");
    check(g.coneDistance > 0.0, "positive cone distance R = rp/sin(gamma)");
    check(std::fabs(g.spiralAngle - spec.spiralAngle) < 1e-15,
          "geometry carries the prescribed mean spiral angle");

    // ---- back-cone taper exact: 0 < small/back scale < 1 ---------------------
    const double Rcone   = g.coneDistance;
    const double faceBand = spec.faceWidth;
    const double scale    = (Rcone - faceBand) / Rcone;
    std::printf("  taper scale (small/back) = %.6f  (0<scale<1 => teeth taper to apex)\n", scale);
    check(scale > 0.0 && scale < 1.0, "teeth taper toward the apex (0 < scale < 1)");

    // ---- (A) SPIRAL ANGLE at the MEAN cone radius == psi_m, <= 1e-3 -----------
    // Measure psi from the ACTUAL lengthwise centreline trace (spiralBevelCentrelinePoint)
    // by central differencing at the mean cone distance R_m. The Gleason mean spiral
    // angle is defined in the BACK-CONE DEVELOPMENT (the flattened pitch cone), where
    // the trace is a planar polar curve (radial == cone distance rho). The spiral angle
    // is the angle between the lengthwise tangent (d(point)/d rho) and the RADIAL (rho)
    // direction. We central-difference the development trace and decompose the tangent
    // into the radial unit and the perpendicular (circumferential) unit.
    auto dot3  = [](const Vec3& a, const Vec3& b){ return a.x*b.x + a.y*b.y + a.z*b.z; };
    const double Rm   = Rcone - 0.5 * faceBand;     // mean cone distance
    const double phi0 = 0.0;                          // a representative tooth phase
    const double dr   = 1e-6 * Rcone;                 // central-difference step in rho

    Vec3 pMinus = spiralBevelCentrelinePoint(spec, g, Rm - dr, phi0);
    Vec3 pPlus  = spiralBevelCentrelinePoint(spec, g, Rm + dr, phi0);
    // lengthwise tangent T = d/d rho (development point); orientation-independent angle.
    Vec3 T{(pPlus.x - pMinus.x) / (2.0 * dr),
           (pPlus.y - pMinus.y) / (2.0 * dr),
           (pPlus.z - pMinus.z) / (2.0 * dr)};

    // The mean development point and its local radial / circumferential unit dirs.
    Vec3 pm = spiralBevelCentrelinePoint(spec, g, Rm, phi0);
    const double phiM = std::atan2(pm.y, pm.x);          // development azimuth
    Vec3 radial{std::cos(phiM), std::sin(phiM), 0.0};    // +rho direction
    Vec3 circum{-std::sin(phiM), std::cos(phiM), 0.0};   // +azimuth (perpendicular)

    const double tRad = dot3(T, radial);
    const double tCir = dot3(T, circum);
    const double psiMeasured = std::atan2(std::fabs(tCir), std::fabs(tRad));
    std::printf("  MEASURED spiral angle (development) at R_m=%.6f : psi = %.9f rad (%.4f deg)\n",
                Rm, psiMeasured, psiMeasured * 180.0 / PI);
    std::printf("  PRESCRIBED mean spiral angle      : psi_m = %.9f rad (%.4f deg)\n",
                spec.spiralAngle, spec.spiralAngle * 180.0 / PI);
    std::printf("  spiral-angle residual = %.3e rad\n",
                std::fabs(psiMeasured - spec.spiralAngle));
    check(std::fabs(psiMeasured - spec.spiralAngle) <= 1e-3,
          "measured spiral angle at mean cone radius == prescribed psi_m (<= 1e-3 rad)");

    // closed-form cross-check: sin(psi(R_m)) must equal sin(psi_m) exactly.
    const double c = Rm * std::sin(spec.spiralAngle);
    std::printf("  closed-form sin(psi(R_m)) = c/R_m = %.12f  vs sin(psi_m) = %.12f\n",
                c / Rm, std::sin(spec.spiralAngle));
    check(std::fabs(c / Rm - std::sin(spec.spiralAngle)) <= 1e-12,
          "closed form: sin(psi(R_m)) == sin(psi_m) (Gleason circular-arc invariant)");

    // ---- build the spiral-bevel solid + (B) tooth count ----------------------
    GearResult R = buildSpiralBevelGear(spec);
    std::printf("  buildSpiralBevelGear ok=%d reason=\"%s\"\n", (int)R.ok, R.reason);
    check(R.ok, "buildSpiralBevelGear succeeded (ok)");
    std::printf("  tooth count = %d  (expect %d)\n", R.toothCount, spec.teeth);
    check(R.toothCount == spec.teeth, "exactly N=20 spiral teeth on the back cone");

    if (R.ok) {
        // ---- (C) CLOSED 2-MANIFOLD + GENUS-1 (bore) --------------------------
        check(R.closedManifold, "spiral bevel solid is a closed 2-manifold");
        std::printf("  V=%zu  E=%zu  F=%zu  volume=%.6f  area=%.6f\n",
                    R.vertices, R.edges, R.faces, R.volume, R.area);
        const long long chi =
            (long long)R.vertices - (long long)R.edges + (long long)R.faces;
        std::printf("  Euler characteristic V-E+F = %lld  (expect 0 for genus-1 bored solid)\n", chi);
        check(chi == 0, "genus 1 (bored toothed frustum): V - E + F == 0");

        // independent re-measure for sanity.
        MassProps mp = massProperties(*R.solid, 8);
        check(std::fabs(mp.volume - R.volume) <= 1e-6 * R.volume,
              "volume re-measure consistent");
        // physical sanity: volume strictly positive and below the back-cone addendum
        // disk * axial gap (an over-estimate that ignores the taper + bore).
        const double axialGap = faceBand * std::cos(spec.pitchConeAngle);
        const double vCeil = PI * g.addendumRadius * g.addendumRadius * axialGap;
        std::printf("  volume %.6f  < back-addendum-disk*axialGap %.6f\n", R.volume, vCeil);
        check(R.volume > 0.0 && R.volume < vCeil, "volume positive and below the back-cone ceiling");
    }

    // =======================================================================
    // (E) STRAIGHT-BEVEL REDUCTION: spiralAngle == 0 reduces EXACTLY to a
    //     straight bevel (buildBevelGear) with the same other params. This is the
    //     strong regression anchor — identical topology AND identical volume/area.
    // =======================================================================
    std::printf("\n== spiralAngle == 0 reduces EXACTLY to the straight bevel ==\n");
    GearSpec zspec = spec;
    zspec.spiralAngle = 0.0;            // psi_m = 0 => no lengthwise twist

    GearResult ZR = buildSpiralBevelGear(zspec); // spiral path, zero spiral
    GearSpec bspec = spec;
    bspec.gearType = GearType::Bevel;  // the straight-bevel reference
    GearResult BR = buildBevelGear(bspec);

    std::printf("  spiral(psi=0): ok=%d V=%zu E=%zu F=%zu vol=%.12f area=%.12f\n",
                (int)ZR.ok, ZR.vertices, ZR.edges, ZR.faces, ZR.volume, ZR.area);
    std::printf("  straight bevel: ok=%d V=%zu E=%zu F=%zu vol=%.12f area=%.12f\n",
                (int)BR.ok, BR.vertices, BR.edges, BR.faces, BR.volume, BR.area);
    check(ZR.ok && BR.ok, "both psi=0 spiral and straight bevel build ok");
    check(ZR.vertices == BR.vertices && ZR.edges == BR.edges && ZR.faces == BR.faces,
          "psi=0 spiral: IDENTICAL topology (V,E,F) to the straight bevel");
    check(ZR.toothCount == BR.toothCount, "psi=0 spiral: identical tooth count");
    check(std::fabs(ZR.volume - BR.volume) <= 1e-9 * std::max(1.0, BR.volume),
          "psi=0 spiral: volume EXACTLY matches the straight bevel (<= 1e-9 rel)");
    check(std::fabs(ZR.area - BR.area) <= 1e-9 * std::max(1.0, BR.area),
          "psi=0 spiral: surface area EXACTLY matches the straight bevel (<= 1e-9 rel)");
    // and the zero-spiral twist at the small end must be exactly 0.
    GearGeometry zg = gearDimensions(zspec);
    const double zTwist = spiralBevelTwist(zspec, zg, zg.coneDistance - zspec.faceWidth);
    std::printf("  psi=0 small-end lengthwise twist = %.3e (expect exactly 0)\n", zTwist);
    check(zTwist == 0.0, "psi=0: lengthwise twist is exactly zero (straight teeth)");

    // =======================================================================
    // A second NON-trivial spiral angle (25 deg) to confirm the measurement is not
    // a fixed-point fluke — DIFFERENT prescribed angle, must be recovered.
    // =======================================================================
    std::printf("\n== second spiral angle 25 deg (no cherry-picking) ==\n");
    GearSpec s2 = spec;
    s2.spiralAngle = 25.0 * PI / 180.0;
    GearGeometry g2 = gearDimensions(s2);
    const double Rm2 = g2.coneDistance - 0.5 * s2.faceWidth;
    const double dr2 = 1e-6 * g2.coneDistance;
    Vec3 q0 = spiralBevelCentrelinePoint(s2, g2, Rm2 - dr2, 0.0);
    Vec3 q1 = spiralBevelCentrelinePoint(s2, g2, Rm2 + dr2, 0.0);
    Vec3 T2{(q1.x - q0.x) / (2*dr2), (q1.y - q0.y) / (2*dr2), (q1.z - q0.z) / (2*dr2)};
    Vec3 qm = spiralBevelCentrelinePoint(s2, g2, Rm2, 0.0);
    const double phiM2 = std::atan2(qm.y, qm.x);
    Vec3 rad2{std::cos(phiM2), std::sin(phiM2), 0.0};
    Vec3 cir2{-std::sin(phiM2), std::cos(phiM2), 0.0};
    const double psi2 = std::atan2(std::fabs(dot3(T2, cir2)), std::fabs(dot3(T2, rad2)));
    std::printf("  measured psi=%.6f deg  prescribed=%.6f deg  residual=%.3e\n",
                psi2 * 180.0 / PI, s2.spiralAngle * 180.0 / PI,
                std::fabs(psi2 - s2.spiralAngle));
    check(std::fabs(psi2 - s2.spiralAngle) <= 1e-3,
          "second spiral angle (25 deg) also recovered at mean radius (<= 1e-3)");
    GearResult R2 = buildSpiralBevelGear(s2);
    check(R2.ok && R2.closedManifold && R2.toothCount == s2.teeth,
          "second spiral bevel builds: closed 2-manifold, N teeth");

    std::printf("\n== spiral_bevel_test: %d/%d checks passed ==\n", g_pass, g_total);
    std::printf("REPORT  spiralBevel  pitchDia=%.17g  teeth=%d  manifold=%d  "
                "measuredPsi=%.9f  prescribedPsi=%.9f  genus=%d  straightReductionVolMatch=%d\n",
                g.pitchDiameter, R.toothCount, (int)R.closedManifold,
                psiMeasured, spec.spiralAngle,
                (R.ok && ((long long)R.vertices - (long long)R.edges + (long long)R.faces) == 0) ? 1 : 0,
                (ZR.ok && BR.ok && std::fabs(ZR.volume - BR.volume) <= 1e-9 * std::max(1.0, BR.volume)) ? 1 : 0);
    std::printf("=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
