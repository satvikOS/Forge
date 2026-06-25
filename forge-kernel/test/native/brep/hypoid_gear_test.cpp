// forge/native/brep/hypoid_gear_test.cpp
//
// Standalone ANALYTIC gate for the HYPOID gear generator (Gear.hpp,
// buildHypoidGear). Pure C++20, no OCCT, no test framework, deterministic.
//
// A hypoid gear is a spiral-bevel gear whose meshing PINION axis is OFFSET from the
// gear axis by the defining hypoid offset E (so the axes do NOT intersect) — the
// geometry of automotive rear-axle final drives. It is the LAST named gear follow-up
// (Gear.hpp documents "SPIRAL bevel, HELICAL-internal and HYPOID are named follow-ups";
// spiral-bevel + straight-bevel + internal + spur already shipped). The MEMBER built is
// the hypoid RING GEAR: the spiral-bevel taper + Gleason circular-arc lengthwise spiral
// with the GEAR-side mean spiral angle psi_g; the offset's effect (the differing pinion
// spiral angle, the hyperboloidal pitch surface) is captured by the closed-form hypoid
// relation + the recoverable offset E.
//
// VERIFIED HERE against CLOSED-FORM ground truth (OCCT has no hypoid primitive, so the
// A/B is analytic — Gleason / AGMA 2005 / Litvin hypoid relations + the spiral-bevel
// reduction anchor):
//
//   (A) HYPOID OFFSET == 0 reduces EXACTLY to the spiral-bevel ring gear
//       (buildSpiralBevelGear with the same other params) — identical volume / topology
//       (V,E,F) / area to <= 1e-9 rel. The STRONG regression anchor.
//
//   (B) PINION-vs-GEAR mean spiral-angle DIFFERENCE follows the closed-form hypoid
//       relation  sin(psi_p) - sin(psi_g) = E / R_m  for the chosen offset, to a tight
//       tolerance; and the offset E is RECOVERABLE from the spiral angles + R_m
//       (E = R_m*(sin(psi_p) - sin(psi_g))) to <= 1e-9 rel.
//
//   (C) TOOTH COUNT == N (the back-cone involute addendum arcs).
//
//   (D) CLOSED 2-MANIFOLD via the kernel's own validator AND the Euler-Poincare GENUS
//       check: the bored hypoid ring gear is genus 1, so V - E + F == 0.
//
//   (E) PITCH DIAMETER == module*teeth at the back cone, EXACTLY (==, not within tol).
//
//   (F) The pinion spiral angle is strictly LARGER than the gear spiral angle for E>0
//       (the physical sense of the offset), and the relation is recovered for a SECOND,
//       distinct offset (no cherry-picking).
//
// DETERMINISM: any sampling uses a FIXED seed constant with an argv[1] override (NOT
// std::random_device) so the parent's CI gate is reproducible. (This gate is in fact
// fully deterministic — no RNG path is exercised — but the seed plumbing is present as
// mandated.)

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

// NOTE: a hypoid gear emits ONLY Plane/Cylinder analytic faces (it is built via the
// spiral-bevel path), so Surface.cpp's `case SurfaceKind::Nurbs:` branch is never
// reached here. The full run_native gate links the real NurbsSurface.cpp, which
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
    std::uint64_t seed = 0x4A57B011D0FFEE42ULL;
    if (argc > 1) seed = std::strtoull(argv[1], nullptr, 0);
    (void)seed; // no RNG path is exercised; plumbing present per the CI mandate.

    std::printf("== hypoid_gear_test (offset spiral-bevel hypoid ring gear) ==\n");

    // -----------------------------------------------------------------------
    // Hypoid ring gear: m=3, N=41 (a real rear-axle ring-gear count), pressure
    // angle 20 deg, pitch-cone 70 deg (a large gear-side cone angle typical of a
    // hypoid ring gear meshing a small pinion), gear-side mean spiral angle 30 deg,
    // face band 8 (< cone distance), central bore 4, hypoid offset E = 30 mm.
    // -----------------------------------------------------------------------
    GearSpec spec;
    spec.gearType       = GearType::Hypoid;
    spec.module         = 3.0;
    spec.teeth          = 41;
    spec.pressureAngle  = 20.0 * PI / 180.0;
    spec.faceWidth      = 8.0;
    spec.boreRadius     = 4.0;
    spec.pitchConeAngle = 70.0 * PI / 180.0;
    spec.spiralAngle    = 30.0 * PI / 180.0; // psi_g (GEAR-side mean spiral angle)
    spec.hypoidOffset   = 30.0;              // E (mm)
    spec.flankSamples   = 24;

    GearGeometry g = gearDimensions(spec);

    // ---- (E) PITCH DIAMETER == m*N at the back cone, EXACTLY ------------------
    const double dExpect = spec.module * (double)spec.teeth; // 3*41 = 123
    std::printf("  back-cone pitch diameter d = m*N = %.17g  (expect %.17g)\n",
                g.pitchDiameter, dExpect);
    check(g.pitchDiameter == dExpect, "back-cone pitch diameter == m*N exactly");
    check(g.pitchDiameter == 123.0,   "back-cone pitch diameter == 123 exactly");
    std::printf("  pitch r=%.6f  addendum r=%.6f  root r=%.6f  cone angle=%.6f  "
                "coneDist R=%.6f  spiralAngle(psi_g)=%.6f  hypoidOffset E=%.6f\n",
                g.pitchRadius, g.addendumRadius, g.rootRadius, g.pitchConeAngle,
                g.coneDistance, g.spiralAngle, g.hypoidOffset);
    check(g.addendumRadius > g.rootRadius, "addendum radius > root radius (teeth point out)");
    check(g.coneDistance > 0.0, "positive cone distance R = rp/sin(gamma)");
    check(std::fabs(g.spiralAngle - spec.spiralAngle) < 1e-15,
          "geometry carries the prescribed GEAR-side mean spiral angle psi_g");
    check(std::fabs(g.hypoidOffset - spec.hypoidOffset) < 1e-15,
          "geometry carries the prescribed hypoid offset E");

    // ---- (B) HYPOID RELATION: pinion-vs-gear spiral-angle difference ---------
    // Closed form: sin(psi_p) - sin(psi_g) = E / R_m, R_m the mean cone distance.
    const double Rm   = hypoidMeanConeDistance(spec, g); // R - faceWidth/2
    std::printf("  mean cone distance R_m = %.9f\n", Rm);
    check(Rm > 0.0, "positive mean cone distance R_m");

    const double psiG = g.spiralAngle;                       // gear-side psi_g
    const double psiP = hypoidPinionSpiralAngle(spec, g);    // pinion-side psi_p
    std::printf("  gear  spiral angle psi_g = %.9f rad (%.4f deg)\n",
                psiG, psiG * 180.0 / PI);
    std::printf("  pinion spiral angle psi_p = %.9f rad (%.4f deg)\n",
                psiP, psiP * 180.0 / PI);

    // (F-part) the offset makes the pinion run at a LARGER spiral angle.
    check(psiP > psiG + 1e-9, "pinion spiral angle > gear spiral angle for E>0 (offset sense)");

    // The defining hypoid relation, asserted directly on the sines.
    const double lhs = std::sin(psiP) - std::sin(psiG);
    const double rhs = spec.hypoidOffset / Rm;
    std::printf("  hypoid relation:  sin(psi_p) - sin(psi_g) = %.12f   E/R_m = %.12f   "
                "residual = %.3e\n", lhs, rhs, std::fabs(lhs - rhs));
    check(std::fabs(lhs - rhs) <= 1e-12,
          "closed-form hypoid relation sin(psi_p)-sin(psi_g) == E/R_m (Gleason/AGMA/Litvin)");

    // Offset RECOVERY from the geometry: invert the relation, must return E.
    const double Erec = hypoidOffsetFromGeometry(Rm, psiG, psiP);
    std::printf("  recovered hypoid offset E = %.12f  (prescribed %.12f)  rel.err = %.3e\n",
                Erec, spec.hypoidOffset, std::fabs(Erec - spec.hypoidOffset) / spec.hypoidOffset);
    check(std::fabs(Erec - spec.hypoidOffset) <= 1e-9 * spec.hypoidOffset,
          "hypoid offset E recoverable from the geometry (<= 1e-9 rel)");

    // ---- build the hypoid ring-gear solid + (C) tooth count ------------------
    GearResult R = buildHypoidGear(spec);
    std::printf("  buildHypoidGear ok=%d reason=\"%s\"\n", (int)R.ok, R.reason);
    check(R.ok, "buildHypoidGear succeeded (ok)");
    std::printf("  tooth count = %d  (expect %d)\n", R.toothCount, spec.teeth);
    check(R.toothCount == spec.teeth, "exactly N=41 hypoid teeth on the back cone");

    if (R.ok) {
        // ---- (D) CLOSED 2-MANIFOLD + GENUS-1 (bore) --------------------------
        check(R.closedManifold, "hypoid ring-gear solid is a closed 2-manifold");
        std::printf("  V=%zu  E=%zu  F=%zu  volume=%.6f  area=%.6f\n",
                    R.vertices, R.edges, R.faces, R.volume, R.area);
        const long long chi =
            (long long)R.vertices - (long long)R.edges + (long long)R.faces;
        std::printf("  Euler characteristic V-E+F = %lld  (expect 0 for genus-1 bored solid)\n", chi);
        check(chi == 0, "genus 1 (bored toothed frustum): V - E + F == 0");

        // the result geometry must report the hypoid offset (not 0 from the SB path).
        std::printf("  result geometry hypoidOffset = %.6f  (expect %.6f)\n",
                    R.geometry.hypoidOffset, spec.hypoidOffset);
        check(std::fabs(R.geometry.hypoidOffset - spec.hypoidOffset) < 1e-15,
              "result geometry reports the hypoid offset E");

        // independent re-measure for sanity.
        MassProps mp = massProperties(*R.solid, 8);
        check(std::fabs(mp.volume - R.volume) <= 1e-6 * R.volume,
              "volume re-measure consistent");
        // physical sanity: volume strictly positive and below the back-cone addendum
        // disk * axial gap (an over-estimate that ignores the taper + bore).
        const double axialGap = spec.faceWidth * std::cos(spec.pitchConeAngle);
        const double vCeil = PI * g.addendumRadius * g.addendumRadius * axialGap;
        std::printf("  volume %.6f  < back-addendum-disk*axialGap %.6f\n", R.volume, vCeil);
        check(R.volume > 0.0 && R.volume < vCeil, "volume positive and below the back-cone ceiling");
    }

    // =======================================================================
    // (A) HYPOID OFFSET == 0 reduces EXACTLY to the spiral-bevel ring gear with
    //     the same other params. The STRONG regression anchor — identical topology
    //     AND identical volume/area to the spiral bevel.
    // =======================================================================
    std::printf("\n== hypoidOffset == 0 reduces EXACTLY to the spiral-bevel gear ==\n");
    GearSpec zspec = spec;
    zspec.hypoidOffset = 0.0;             // E = 0 => no offset

    GearResult ZR = buildHypoidGear(zspec);  // hypoid path, zero offset
    GearSpec sbspec = spec;
    sbspec.gearType = GearType::SpiralBevel; // the spiral-bevel reference (same psi_g)
    sbspec.hypoidOffset = 0.0;
    GearResult SR = buildSpiralBevelGear(sbspec);

    std::printf("  hypoid(E=0):    ok=%d V=%zu E=%zu F=%zu vol=%.12f area=%.12f\n",
                (int)ZR.ok, ZR.vertices, ZR.edges, ZR.faces, ZR.volume, ZR.area);
    std::printf("  spiral bevel:   ok=%d V=%zu E=%zu F=%zu vol=%.12f area=%.12f\n",
                (int)SR.ok, SR.vertices, SR.edges, SR.faces, SR.volume, SR.area);
    check(ZR.ok && SR.ok, "both E=0 hypoid and spiral bevel build ok");
    check(ZR.vertices == SR.vertices && ZR.edges == SR.edges && ZR.faces == SR.faces,
          "E=0 hypoid: IDENTICAL topology (V,E,F) to the spiral bevel");
    check(ZR.toothCount == SR.toothCount, "E=0 hypoid: identical tooth count");
    check(std::fabs(ZR.volume - SR.volume) <= 1e-9 * std::max(1.0, SR.volume),
          "E=0 hypoid: volume EXACTLY matches the spiral bevel (<= 1e-9 rel)");
    check(std::fabs(ZR.area - SR.area) <= 1e-9 * std::max(1.0, SR.area),
          "E=0 hypoid: surface area EXACTLY matches the spiral bevel (<= 1e-9 rel)");
    // and at E=0 the pinion spiral angle must equal the gear spiral angle exactly.
    GearGeometry zg = gearDimensions(zspec);
    const double zPsiP = hypoidPinionSpiralAngle(zspec, zg);
    std::printf("  E=0 pinion spiral angle = %.12f  gear = %.12f  diff = %.3e (expect 0)\n",
                zPsiP, zg.spiralAngle, std::fabs(zPsiP - zg.spiralAngle));
    check(std::fabs(zPsiP - zg.spiralAngle) <= 1e-12,
          "E=0: pinion spiral angle == gear spiral angle (no offset => spiral bevel)");

    // =======================================================================
    // (F) A second, DISTINCT offset (E = 18 mm) to confirm the relation is not a
    //     fixed-point fluke — different offset, must be recovered, pinion>gear.
    // =======================================================================
    std::printf("\n== second hypoid offset E = 18 mm (no cherry-picking) ==\n");
    GearSpec s2 = spec;
    s2.hypoidOffset = 18.0;
    GearGeometry g2 = gearDimensions(s2);
    const double Rm2  = hypoidMeanConeDistance(s2, g2);
    const double psiG2 = g2.spiralAngle;
    const double psiP2 = hypoidPinionSpiralAngle(s2, g2);
    const double lhs2 = std::sin(psiP2) - std::sin(psiG2);
    const double rhs2 = s2.hypoidOffset / Rm2;
    std::printf("  E=18: psi_p=%.6f deg  psi_g=%.6f deg  sin-diff=%.12f  E/R_m=%.12f  res=%.3e\n",
                psiP2 * 180.0 / PI, psiG2 * 180.0 / PI, lhs2, rhs2, std::fabs(lhs2 - rhs2));
    check(psiP2 > psiG2 + 1e-9, "E=18: pinion spiral angle > gear spiral angle");
    check(std::fabs(lhs2 - rhs2) <= 1e-12, "E=18: hypoid relation holds (sin-diff == E/R_m)");
    const double Erec2 = hypoidOffsetFromGeometry(Rm2, psiG2, psiP2);
    check(std::fabs(Erec2 - s2.hypoidOffset) <= 1e-9 * s2.hypoidOffset,
          "E=18: offset recoverable from the geometry (<= 1e-9 rel)");
    GearResult R2 = buildHypoidGear(s2);
    check(R2.ok && R2.closedManifold && R2.toothCount == s2.teeth,
          "E=18: hypoid builds — closed 2-manifold, N teeth");
    // E=18 has a smaller offset => its pinion spiral angle is smaller than E=30's.
    check(psiP2 < psiP - 1e-9, "E=18 pinion spiral angle < E=30 pinion spiral angle (monotone in E)");

    std::printf("\n== hypoid_gear_test: %d/%d checks passed ==\n", g_pass, g_total);
    std::printf("REPORT  hypoid  pitchDia=%.17g  teeth=%d  manifold=%d  "
                "psi_g=%.9f  psi_p=%.9f  E=%.6f  E_recovered=%.6f  genus=%d  "
                "spiralBevelReductionVolMatch=%d\n",
                g.pitchDiameter, R.toothCount, (int)R.closedManifold,
                psiG, psiP, spec.hypoidOffset, Erec,
                (R.ok && ((long long)R.vertices - (long long)R.edges + (long long)R.faces) == 0) ? 1 : 0,
                (ZR.ok && SR.ok && std::fabs(ZR.volume - SR.volume) <= 1e-9 * std::max(1.0, SR.volume)) ? 1 : 0);
    std::printf("=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
