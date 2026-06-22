// forge/native/gdt/fcf_validate_test.cpp
//
// Standalone validation gate for the GEOMETRIC GD&T / FCF VALIDATOR (task #26)
// in forge::native::gdt — the "validate a real sampled part against the actual
// 3D tolerance zone" side that complements the per-feature primitives in
// gdt_test.cpp.
//
// Per Forge Engineering Bible §0/§9 the math is REAL ASME Y14.5-2018, so RANDOM
// inputs (fresh seed EACH RUN) must ALWAYS validate against an independent
// reference computation — no fixed cherry-picked case — alongside deterministic
// CONFORMING / NON-CONFORMING fixtures for EVERY covered characteristic.
//
// Build & run (also via test/native/run_native.sh):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/src/native/gdt/Gdt.cpp \
//       forge-kernel/test/native/gdt/fcf_validate_test.cpp -o /tmp/fcf && /tmp/fcf
//
// VALIDATION GATE:
//   (A) mmcBonus matches an independent reference for all FoS×MC combos AND
//       agrees with evaluateTruePosition(...).bonus to 1e-12.
//   (B) POSITION point set: worst == 2*max radius; pass iff <= Ø+bonus;
//       conformingFraction matches the counted inside-fraction; boundary passes;
//       the worked MMC example (Ø0.2 @MMC, hole 0.1 over MMC -> Ø0.3 allowed).
//   (C) FLATNESS / ORIENTATION point set: band matches a recomputed p2v; a tol
//       just above PASSES and just below FAILS.
//   (D) CIRCULARITY / CYLINDRICITY: radial band ~ 2*noise half-band; perfect
//       round -> ~0.
//   (E) PROFILE: worst == max|offset|; bilateral pass iff <= tol/2, unilateral
//       iff every dev in [0,tol].
//   (F) checkFcfLegality: legal & illegal frames each with the right verdict.
//   (G) Unified validatePointSetAgainstZone dispatcher routes identically.
//   (H) Degenerate paths report ok=false.

#include "forge/native/gdt/Gdt.hpp"

#include <cstdio>
#include <cmath>
#include <random>
#include <vector>
#include <limits>
#include <algorithm>

using namespace forge::native::gdt;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; }
    else      { std::printf("  [FAIL] %s\n", name); }
}

static bool approx(double a, double b, double tol = 1e-7) {
    return std::fabs(a - b) <= tol * (1.0 + std::fabs(a) + std::fabs(b));
}

// ===========================================================================
int main() {
    std::printf("== forge::native::gdt FCF/zone validator gate (RANDOMIZED) ==\n");

    std::random_device rd;
    unsigned seed = rd();
    std::mt19937_64 rng(seed);
    std::printf("seed = %u\n", seed);

    auto randVec = [&](double lo, double hi) {
        std::uniform_real_distribution<double> d(lo, hi);
        return Vec3{d(rng), d(rng), d(rng)};
    };

    // -----------------------------------------------------------------------
    // (A) mmcBonus — independent reference + agreement with evaluateTruePosition.
    // -----------------------------------------------------------------------
    {
        std::uniform_real_distribution<double> Usz(5.0, 20.0);
        std::uniform_real_distribution<double> Udelta(-1.5, 1.5);
        int trials = 0;
        for (int t = 0; t < 5000; ++t) {
            ++trials;
            double mmc = Usz(rng);
            double actual = mmc + Udelta(rng);
            FeatureType ft = (rng() & 1) ? FeatureType::HOLE : FeatureType::PIN;
            int mcsel = static_cast<int>(rng() % 3);
            MaterialCondition mc = (mcsel == 0) ? MaterialCondition::RFS
                                 : (mcsel == 1) ? MaterialCondition::MMC
                                                : MaterialCondition::LMC;

            double ref = 0.0;
            if (mc == MaterialCondition::MMC)
                ref = (ft == FeatureType::HOLE) ? (actual - mmc) : (mmc - actual);
            else if (mc == MaterialCondition::LMC)
                ref = (ft == FeatureType::HOLE) ? (mmc - actual) : (actual - mmc);
            if (ref < 0) ref = 0;

            double b = mmcBonus(actual, mmc, mc, ft);
            check(approx(b, ref, 1e-12), "(A) mmcBonus == independent reference");

            // Agreement with the already-shipped true-position bonus branch.
            TruePositionResult tp = evaluateTruePosition(
                Point2D{0, 0}, Point2D{0, 0}, actual, mmc, 0.5, mc, ft);
            check(approx(b, tp.bonus, 1e-12),
                  "(A) mmcBonus == evaluateTruePosition().bonus");
            if (mc == MaterialCondition::RFS)
                check(b == 0.0, "(A) RFS bonus is exactly 0");
        }
        std::printf("(A) mmcBonus: %d trials validated\n", trials);

        // Exact worked arithmetic to 1e-9: hole MMC=10, actual=10.1 -> bonus 0.1.
        check(approx(mmcBonus(10.1, 10.0, MaterialCondition::MMC,
                              FeatureType::HOLE), 0.1, 1e-9),
              "(A) worked: hole 0.1 over MMC -> bonus 0.1");
        // pin MMC=10 (largest), actual=9.7 -> bonus 0.3.
        check(approx(mmcBonus(9.7, 10.0, MaterialCondition::MMC,
                              FeatureType::PIN), 0.3, 1e-9),
              "(A) worked: pin 0.3 under MMC -> bonus 0.3");
    }

    // -----------------------------------------------------------------------
    // (B) POSITION point set — cylindrical zone, RFS + MMC/LMC bonus.
    // -----------------------------------------------------------------------
    {
        std::uniform_real_distribution<double> U(-5.0, 5.0);
        std::uniform_real_distribution<double> Upos(0.1, 3.0);
        std::uniform_real_distribution<double> Ur(0.0, 1.2);
        int trials = 0, passes = 0, fails = 0;
        for (int t = 0; t < 3000; ++t) {
            ++trials;
            Point2D tl{U(rng), U(rng)};
            double posTol = Upos(rng);
            double mmc = Upos(rng) + 5.0;
            std::uniform_real_distribution<double> dsz(-0.6, 0.6);
            double actualSize = mmc + dsz(rng);
            FeatureType ft = (rng() & 1) ? FeatureType::HOLE : FeatureType::PIN;
            int mcsel = static_cast<int>(rng() % 3);
            MaterialCondition mc = (mcsel == 0) ? MaterialCondition::RFS
                                 : (mcsel == 1) ? MaterialCondition::MMC
                                                : MaterialCondition::LMC;

            // Scatter axis samples at known radii about the basic axis.
            std::vector<Vec3> samples;
            int n = 4 + static_cast<int>(rng() % 12);
            double maxR = 0.0;
            std::uniform_real_distribution<double> dth(0.0, 2 * M_PI);
            std::uniform_real_distribution<double> dz(-2.0, 2.0);
            for (int i = 0; i < n; ++i) {
                double r = Ur(rng);
                double th = dth(rng);
                if (r > maxR) maxR = r;
                samples.push_back(Vec3{tl.x + r * std::cos(th),
                                       tl.y + r * std::sin(th), dz(rng)});
            }

            ToleranceZoneVerdict v = validatePositionPointSet(
                samples, tl, actualSize, mmc, posTol, mc, ft);

            double refBonus = mmcBonus(actualSize, mmc, mc, ft);
            check(approx(v.allowedZone, posTol + refBonus),
                  "(B) allowed = Ø tol + bonus");
            check(approx(v.worstDeviationMm, 2.0 * maxR, 1e-9),
                  "(B) worst = 2*max radius");
            check(v.pass == (2.0 * maxR <= posTol + refBonus),
                  "(B) pass iff worst <= zone");

            // conformingFraction independently recounted.
            std::size_t inside = 0;
            for (const auto& p : samples) {
                double dia = 2.0 * std::sqrt((p.x - tl.x) * (p.x - tl.x) +
                                             (p.y - tl.y) * (p.y - tl.y));
                if (dia <= v.allowedZone) ++inside;
            }
            check(approx(v.conformingFraction,
                         static_cast<double>(inside) / samples.size(), 1e-12),
                  "(B) conformingFraction matches recount");
            if (v.pass) ++passes; else ++fails;
        }
        std::printf("(B) position: %d trials (%d pass / %d fail)\n",
                    trials, passes, fails);
        check(passes > 0 && fails > 0, "(B) spread exercises pass AND fail");

        // Deterministic CONFORMING fixture: worst dia 0.2 < zone 0.5 -> PASS.
        {
            std::vector<Vec3> s = {{0.05, 0.0, 0}, {-0.05, 0.0, 1},
                                   {0.0, 0.08, -1}, {0.0, -0.06, 0.5}};
            ToleranceZoneVerdict v = validatePositionPointSet(
                s, Point2D{0, 0}, 10.0, 10.0, 0.5,
                MaterialCondition::RFS, FeatureType::HOLE);
            check(v.pass && v.conformingFraction == 1.0,
                  "(B) CONFORMING position fixture PASSES");
            check(approx(v.worstDeviationMm, 0.16, 1e-9),
                  "(B) CONFORMING worst = 0.16 (2*0.08)");
        }
        // Deterministic NON-CONFORMING: a sample at r=0.5 -> dia 1.0 > 0.5.
        {
            std::vector<Vec3> s = {{0.05, 0.0, 0}, {0.5, 0.0, 1}};
            ToleranceZoneVerdict v = validatePositionPointSet(
                s, Point2D{0, 0}, 10.0, 10.0, 0.5,
                MaterialCondition::RFS, FeatureType::HOLE);
            check(!v.pass && v.conformingFraction == 0.5,
                  "(B) NON-CONFORMING position fixture FAILS (half inside)");
        }
        // Worked MMC: Ø0.2 @MMC, hole 0.1 OVER MMC -> Ø0.3 allowed; a sample at
        // r=0.14 -> dia 0.28 < 0.3 PASSES but the SAME at RFS (Ø0.2) FAILS.
        {
            std::vector<Vec3> s = {{0.14, 0.0, 0}};
            ToleranceZoneVerdict mmcV = validatePositionPointSet(
                s, Point2D{0, 0}, 10.1, 10.0, 0.2,
                MaterialCondition::MMC, FeatureType::HOLE);
            check(approx(mmcV.bonus, 0.1, 1e-9) &&
                  approx(mmcV.allowedZone, 0.3, 1e-9) && mmcV.pass,
                  "(B) worked MMC: bonus 0.1, zone Ø0.3, PASS");
            ToleranceZoneVerdict rfsV = validatePositionPointSet(
                s, Point2D{0, 0}, 10.1, 10.0, 0.2,
                MaterialCondition::RFS, FeatureType::HOLE);
            check(rfsV.bonus == 0.0 && !rfsV.pass,
                  "(B) same feature RFS (Ø0.2) FAILS");
        }
        // Boundary: dia exactly == zone passes (inclusive).
        {
            std::vector<Vec3> s = {{0.25, 0.0, 0}};  // dia 0.5 == zone 0.5
            ToleranceZoneVerdict v = validatePositionPointSet(
                s, Point2D{0, 0}, 10.0, 10.0, 0.5,
                MaterialCondition::RFS, FeatureType::HOLE);
            check(approx(v.worstDeviationMm, 0.5, 1e-9) && v.pass,
                  "(B) boundary dia==zone PASSES (inclusive)");
        }
    }

    // -----------------------------------------------------------------------
    // (C) FLATNESS / ORIENTATION point sets.
    // -----------------------------------------------------------------------
    {
        int trials = 0;
        for (int t = 0; t < 1500; ++t) {
            ++trials;
            Vec3 n = normalize(randVec(-1, 1));
            if (norm(n) == 0) { --trials; continue; }
            Vec3 helper = (std::fabs(n.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
            Vec3 u = normalize(cross(n, helper));
            Vec3 v2 = normalize(cross(n, u));
            Vec3 p0 = randVec(-3, 3);
            std::uniform_real_distribution<double> dband(0.001, 0.15);
            double B = dband(rng);
            std::uniform_real_distribution<double> doff(-B, B);
            std::uniform_real_distribution<double> dspan(-4, 4);

            std::vector<Vec3> pts;
            int npts = 8 + static_cast<int>(rng() % 18);
            for (int i = 0; i < npts; ++i) {
                Vec3 inPlane = add(add(p0, scale(u, dspan(rng))),
                                   scale(v2, dspan(rng)));
                pts.push_back(add(inPlane, scale(n, doff(rng))));
            }

            ToleranceZoneVerdict fv = validateFlatnessPointSet(pts, 1.0);
            check(fv.ok, "(C) flatness ok");
            // Reference: p2v vs the returned-equivalent LS plane == evaluateFlatness.
            FlatnessResult fr = evaluateFlatness(pts, 1.0);
            check(approx(fv.worstDeviationMm, fr.flatness, 1e-9),
                  "(C) flatness band == evaluateFlatness");
            // Just-above PASS / just-below FAIL.
            ToleranceZoneVerdict above =
                validateFlatnessPointSet(pts, fr.flatness + 1e-6);
            check(above.pass, "(C) flatness tol just above PASSES");
            if (fr.flatness > 1e-6) {
                ToleranceZoneVerdict below =
                    validateFlatnessPointSet(pts, fr.flatness - 1e-6);
                check(!below.pass, "(C) flatness tol just below FAILS");
            }

            // ORIENTATION is DATUM-RELATIVE: the band is the p2v of the points
            // along the FIXED nominal zone normal, NOT the points' own LS normal.
            // The points were built as inPlane + n*off with inPlane ⊥ n, so the
            // exact p2v along `n` is max(off)-min(off); recompute it independently.
            Vec3 cenRef{0, 0, 0};
            for (const auto& p : pts) cenRef = add(cenRef, p);
            cenRef = scale(cenRef, 1.0 / static_cast<double>(pts.size()));
            double loN = std::numeric_limits<double>::infinity();
            double hiN = -std::numeric_limits<double>::infinity();
            for (const auto& p : pts) {
                double sd = dot(sub(p, cenRef), n);
                loN = std::min(loN, sd);
                hiN = std::max(hiN, sd);
            }
            double p2vAlongN = hiN - loN;
            // (1) Feature CORRECTLY oriented: PARALLELISM with the datum normal ==
            // the feature's own normal `n`. The zone normal IS `n`, so the band
            // equals the exact p2v along `n` -> conforming/datum-relative.
            ToleranceZoneVerdict ovPar = validateOrientationPointSet(
                pts, n, Characteristic::PARALLELISM, 0.0, 1.0);
            check(ovPar.ok && approx(ovPar.worstDeviationMm, p2vAlongN, 1e-9),
                  "(C) parallelism band == p2v along datum normal (correct orient)");
            // (2) Same flat feature MIS-ORIENTED: call it parallel to a datum
            // whose normal is tilted 30° from `n`. The band along that fixed
            // tilted normal opens to ~span*sin(30°) >> the in-plane band -> the
            // datum-relative validator must report a LARGER band than the form
            // band (the old self-normal bug reported the tiny form band here).
            Vec3 dnTilt = normalize(add(scale(n, std::cos(30.0 * M_PI / 180.0)),
                                        scale(u, std::sin(30.0 * M_PI / 180.0))));
            ToleranceZoneVerdict ovTilt = validateOrientationPointSet(
                pts, dnTilt, Characteristic::PARALLELISM, 0.0, 1.0);
            check(ovTilt.ok && ovTilt.worstDeviationMm >= fr.flatness - 1e-9,
                  "(C) mis-oriented feature -> band >= form band (datum-relative)");
        }
        std::printf("(C) flatness/orientation: %d fits validated\n", trials);

        // Deterministic CONFORMING flatness: planar set within 0.04 band, tol 0.1.
        {
            std::vector<Vec3> pts = {{0, 0, 0.02}, {1, 0, -0.02}, {0, 1, 0.01},
                                     {1, 1, -0.015}, {2, 2, 0.0}, {3, 1, 0.018}};
            ToleranceZoneVerdict v = validateFlatnessPointSet(pts, 0.1);
            check(v.pass && v.worstDeviationMm <= 0.1,
                  "(C) CONFORMING flatness fixture PASSES");
        }
        // Deterministic NON-CONFORMING flatness: 0.4 spike vs tol 0.1.
        {
            std::vector<Vec3> pts = {{0, 0, 0}, {1, 0, 0}, {0, 1, 0},
                                     {1, 1, 0}, {2, 2, 0}, {1.5, 1.5, 0.4}};
            ToleranceZoneVerdict v = validateFlatnessPointSet(pts, 0.1);
            check(!v.pass && v.worstDeviationMm > 0.1,
                  "(C) NON-CONFORMING flatness fixture FAILS");
        }
        // Deterministic PERPENDICULARITY, DATUM-RELATIVE, about a Z-normal datum.
        // A feature perpendicular to the Z datum has its nominal surface normal
        // IN the datum plane; take the nominal feature normal = +X.
        {
            const Vec3 datumZ{0, 0, 1};
            const Vec3 nomFeatNormalX{1, 0, 0};  // lies in the datum XY plane

            // CONFORMING: a VERTICAL plate whose surface normal is ~+X. Points
            // span Y & Z (the plate face) with a small ±0.03 wobble along X.
            // Band along the fixed nominal normal X ~0.06 <= tol 0.1 -> PASS.
            std::vector<Vec3> okPts = {
                {0.03, 0, 0}, {-0.03, 1, 0}, {0.02, 0, 1},
                {-0.02, 1, 1}, {0.01, 0, 2}, {0.0, 2, 0.5}};
            ToleranceZoneVerdict v = validateOrientationPointSet(
                okPts, datumZ, Characteristic::PERPENDICULARITY, 90.0, 0.1,
                nomFeatNormalX);
            check(v.pass && v.worstDeviationMm <= 0.1,
                  "(C) CONFORMING perpendicularity fixture PASSES (band ~0.06)");

            // NON-CONFORMING: a HORIZONTAL plate (surface in XY, normal ~+Z) —
            // the classic mis-orientation the old self-normal bug FALSE-PASSED.
            // Called ⊥ the Z datum, its band along the fixed nominal normal X
            // spans the plate's X extent (~2.0) -> band ~2.0 -> FAIL.
            std::vector<Vec3> badPts = {
                {0, 0, 0.0}, {1, 0, 0.02}, {2, 0, -0.02},
                {0, 1, 0.01}, {1, 1, 0.0}, {2, 2, -0.01}};
            ToleranceZoneVerdict vb = validateOrientationPointSet(
                badPts, datumZ, Characteristic::PERPENDICULARITY, 90.0, 0.1,
                nomFeatNormalX);
            check(!vb.pass && vb.worstDeviationMm > 1.5,
                  "(C) NON-CONFORMING perpendicularity (horizontal plate) FAILS, "
                  "band ~2.0");

            // AGREEMENT with evaluatePerpendicularity: the existing primitive
            // measures the angle between a feature direction and a reference. The
            // measured feature's LS normal vs the nominal feature normal must
            // flag the SAME verdict the point-set validator does — conforming
            // plate (LS normal ~ X) -> small angle -> pass; horizontal plate (LS
            // normal ~ Z) -> ~90° off X -> large deviation -> fail.
            FlatnessResult okFit = evaluateFlatness(okPts, 1.0);
            FlatnessResult badFit = evaluateFlatness(badPts, 1.0);
            PerpendicularityResult okPerp = evaluatePerpendicularity(
                okFit.fitPlane.normal, nomFeatNormalX, 0.1, 1.0);
            PerpendicularityResult badPerp = evaluatePerpendicularity(
                badFit.fitPlane.normal, nomFeatNormalX, 0.1, 1.0);
            check(okPerp.ok && okPerp.angleDeg < 5.0 &&
                  badPerp.ok && badPerp.angleDeg > 85.0,
                  "(C) evaluatePerpendicularity recovers the orientation angle");
            // Same direction of verdict as the point-set validator.
            check(okPerp.pass == v.pass && badPerp.pass == vb.pass,
                  "(C) point-set orientation AGREES with evaluatePerpendicularity");
        }
    }

    // -----------------------------------------------------------------------
    // (D) CIRCULARITY / CYLINDRICITY.
    // -----------------------------------------------------------------------
    {
        int trials = 0;
        for (int t = 0; t < 1200; ++t) {
            ++trials;
            std::uniform_real_distribution<double> dR(2.0, 8.0);
            std::uniform_real_distribution<double> dC(-3.0, 3.0);
            double R = dR(rng);
            double cx = dC(rng), cy = dC(rng);
            std::uniform_real_distribution<double> dband(0.005, 0.1);
            double b = dband(rng);  // radial noise half-band
            std::uniform_real_distribution<double> dnoise(-b, b);

            // CLEAN fixture: ONLY two radial extrema at +b and -b, the rest
            // exactly on radius R. The true radial span is exactly 2b; the LS
            // algebraic center barely shifts (O(b^2/R)) so the reported band
            // tracks 2b tightly from below (<= 2b, within a few percent).
            std::vector<Vec3> pts;
            int n = 16 + static_cast<int>(rng() % 16);
            for (int i = 0; i < n; ++i) {
                double th = 2 * M_PI * i / n;
                double rr = R + ((i == 0) ? b : (i == 1) ? -b : 0.0);
                pts.push_back(Vec3{cx + rr * std::cos(th),
                                   cy + rr * std::sin(th), 0.0});
            }
            ToleranceZoneVerdict v = validateCircularityPointSet(pts, 1.0);
            check(v.ok, "(D) circularity ok");
            check(v.worstDeviationMm <= 2.0 * b + 1e-9,
                  "(D) circularity band <= 2*noise half-band");
            check(v.worstDeviationMm >= 2.0 * b * 0.95,
                  "(D) circularity band ~ 2*noise half-band (within ~5%)");

            // NOISY set (all points ± independent noise in [-b,b]): the band is a
            // genuine R_max-R_min; it must be >= 0 and the per-point band must be
            // recoverable. Pass a generous tol and verify pass + full conformance.
            std::vector<Vec3> noisy;
            for (int i = 0; i < n; ++i) {
                double th = 2 * M_PI * i / n;
                double rr = R + dnoise(rng);
                noisy.push_back(Vec3{cx + rr * std::cos(th),
                                     cy + rr * std::sin(th), 0.0});
            }
            ToleranceZoneVerdict nv = validateCircularityPointSet(noisy, 4.0 * b);
            check(nv.ok && nv.pass && nv.worstDeviationMm >= 0.0 &&
                  nv.worstDeviationMm <= 4.0 * b,
                  "(D) noisy circularity band in [0,2b-ish] and PASSES a 4b tol");
        }
        std::printf("(D) circularity: %d fits validated\n", trials);

        // Perfect circle -> band ~ 0, passes any positive tol.
        {
            std::vector<Vec3> pts;
            for (int i = 0; i < 24; ++i) {
                double th = 2 * M_PI * i / 24;
                pts.push_back(Vec3{5.0 * std::cos(th), 5.0 * std::sin(th), 0});
            }
            ToleranceZoneVerdict v = validateCircularityPointSet(pts, 1e-6);
            check(v.ok && v.worstDeviationMm < 1e-7 && v.pass,
                  "(D) perfect circle -> band~0 PASS");
        }
        // CONFORMING circularity: band 0.04 < tol 0.1.
        {
            std::vector<Vec3> pts;
            for (int i = 0; i < 20; ++i) {
                double th = 2 * M_PI * i / 20;
                double rr = 3.0 + 0.02 * ((i % 2) ? 1 : -1);
                pts.push_back(Vec3{rr * std::cos(th), rr * std::sin(th), 0});
            }
            ToleranceZoneVerdict v = validateCircularityPointSet(pts, 0.1);
            check(v.pass, "(D) CONFORMING circularity fixture PASSES");
        }
        // NON-CONFORMING circularity: band 0.4 > tol 0.1.
        {
            std::vector<Vec3> pts;
            for (int i = 0; i < 20; ++i) {
                double th = 2 * M_PI * i / 20;
                double rr = 3.0 + 0.2 * ((i % 2) ? 1 : -1);
                pts.push_back(Vec3{rr * std::cos(th), rr * std::sin(th), 0});
            }
            ToleranceZoneVerdict v = validateCircularityPointSet(pts, 0.1);
            check(!v.pass && v.worstDeviationMm > 0.1,
                  "(D) NON-CONFORMING circularity fixture FAILS");
        }
        // CYLINDRICITY: cylinder along Z, R=4, height samples, radial band ~0.06.
        {
            std::vector<Vec3> pts;
            for (int k = 0; k < 5; ++k) {
                double z = k * 1.0;
                for (int i = 0; i < 16; ++i) {
                    double th = 2 * M_PI * i / 16;
                    double rr = 4.0 + ((i + k) % 2 ? 0.03 : -0.03);
                    pts.push_back(Vec3{rr * std::cos(th), rr * std::sin(th), z});
                }
            }
            ToleranceZoneVerdict ok = validateCylindricityPointSet(pts, 0.1);
            check(ok.ok && ok.pass && ok.worstDeviationMm <= 0.1,
                  "(D) CONFORMING cylindricity fixture PASSES (band~0.06)");
            ToleranceZoneVerdict bad = validateCylindricityPointSet(pts, 0.04);
            check(!bad.pass, "(D) NON-CONFORMING cylindricity (tol 0.04) FAILS");
        }
    }

    // -----------------------------------------------------------------------
    // (E) PROFILE-OF-A-SURFACE — bilateral / unilateral.
    // -----------------------------------------------------------------------
    {
        int trials = 0;
        for (int t = 0; t < 1500; ++t) {
            ++trials;
            int n = 6 + static_cast<int>(rng() % 12);
            std::vector<Vec3> truePts, normals, meas;
            std::uniform_real_distribution<double> dpos(-4, 4);
            double maxAbs = 0.0;
            std::uniform_real_distribution<double> doff(-0.3, 0.3);
            for (int i = 0; i < n; ++i) {
                Vec3 tp = randVec(-4, 4);
                Vec3 nm = normalize(randVec(-1, 1));
                if (norm(nm) == 0) nm = Vec3{0, 0, 1};
                double off = doff(rng);
                if (std::fabs(off) > maxAbs) maxAbs = std::fabs(off);
                truePts.push_back(tp);
                normals.push_back(nm);
                meas.push_back(add(tp, scale(nm, off)));  // exact known offset
            }
            std::uniform_real_distribution<double> dtol(0.1, 1.0);
            double tol = dtol(rng);
            ToleranceZoneVerdict bv = validateProfilePointSet(
                meas, truePts, normals, tol, /*unilateral=*/false);
            check(bv.ok, "(E) profile ok");
            check(approx(bv.worstDeviationMm, maxAbs, 1e-9),
                  "(E) worst = max|signed normal offset|");
            check(bv.pass == (maxAbs <= 0.5 * tol + 1e-12),
                  "(E) bilateral pass iff worst <= tol/2");
        }
        std::printf("(E) profile: %d offset sets validated\n", trials);

        // Deterministic CONFORMING bilateral: max offset 0.04 <= tol/2=0.05.
        {
            std::vector<Vec3> tp = {{0, 0, 0}, {1, 0, 0}, {2, 0, 0}};
            std::vector<Vec3> nm = {{0, 0, 1}, {0, 0, 1}, {0, 0, 1}};
            std::vector<Vec3> ms = {{0, 0, 0.03}, {1, 0, -0.04}, {2, 0, 0.02}};
            ToleranceZoneVerdict v =
                validateProfilePointSet(ms, tp, nm, 0.1, false);
            check(v.pass && v.conformingFraction == 1.0,
                  "(E) CONFORMING bilateral profile PASSES (max 0.04 <= 0.05)");
        }
        // Deterministic NON-CONFORMING bilateral: 0.08 offset > tol/2=0.05.
        {
            std::vector<Vec3> tp = {{0, 0, 0}, {1, 0, 0}};
            std::vector<Vec3> nm = {{0, 0, 1}, {0, 0, 1}};
            std::vector<Vec3> ms = {{0, 0, 0.03}, {1, 0, 0.08}};
            ToleranceZoneVerdict v =
                validateProfilePointSet(ms, tp, nm, 0.1, false);
            check(!v.pass && approx(v.worstDeviationMm, 0.08, 1e-9),
                  "(E) NON-CONFORMING bilateral profile FAILS (0.08 > 0.05)");
        }
        // Unilateral: outward 0..tol. +0.07 conforms, -0.01 does NOT (negative).
        {
            std::vector<Vec3> tp = {{0, 0, 0}, {1, 0, 0}};
            std::vector<Vec3> nm = {{0, 0, 1}, {0, 0, 1}};
            std::vector<Vec3> okm = {{0, 0, 0.02}, {1, 0, 0.07}};
            ToleranceZoneVerdict vok =
                validateProfilePointSet(okm, tp, nm, 0.1, true);
            check(vok.pass, "(E) CONFORMING unilateral profile PASSES (0..0.1)");
            std::vector<Vec3> badm = {{0, 0, -0.01}, {1, 0, 0.05}};
            ToleranceZoneVerdict vbad =
                validateProfilePointSet(badm, tp, nm, 0.1, true);
            check(!vbad.pass,
                  "(E) NON-CONFORMING unilateral profile FAILS (negative side)");
        }
    }

    // -----------------------------------------------------------------------
    // (F) checkFcfLegality — legal & illegal frames.
    // -----------------------------------------------------------------------
    {
        std::vector<char> avail = {'A', 'B', 'C', 'D'};

        // Legal: position of a FoS w/ ordered existing datums + MMC.
        {
            FcfLegality r = checkFcfLegality(
                Characteristic::POSITION, ControlledFeature::FEATURE_OF_SIZE,
                MaterialCondition::MMC, {'A', 'B', 'C'}, avail);
            check(r.legal, "(F) LEGAL: position FoS + ABC datums + MMC");
        }
        // Legal: flatness with NO datum, RFS.
        {
            FcfLegality r = checkFcfLegality(
                Characteristic::FLATNESS, ControlledFeature::PLANAR_SURFACE,
                MaterialCondition::RFS, {}, avail);
            check(r.legal, "(F) LEGAL: flatness, no datum, RFS");
        }
        // Legal: cylindricity surface, no datum.
        {
            FcfLegality r = checkFcfLegality(
                Characteristic::CYLINDRICITY, ControlledFeature::CYLINDER_SURFACE,
                MaterialCondition::RFS, {}, avail);
            check(r.legal, "(F) LEGAL: cylindricity surface, no datum");
        }

        // ILLEGAL: flatness WITH a datum (form control takes none).
        {
            FcfLegality r = checkFcfLegality(
                Characteristic::FLATNESS, ControlledFeature::PLANAR_SURFACE,
                MaterialCondition::RFS, {'A'}, avail);
            check(!r.legal, "(F) ILLEGAL: flatness with a datum");
        }
        // ILLEGAL: circularity with MMC modifier (form control, no modifier).
        {
            FcfLegality r = checkFcfLegality(
                Characteristic::CIRCULARITY, ControlledFeature::CYLINDER_SURFACE,
                MaterialCondition::MMC, {}, avail);
            check(!r.legal, "(F) ILLEGAL: circularity with MMC modifier");
        }
        // ILLEGAL: position referencing a MISSING datum 'Z'.
        {
            FcfLegality r = checkFcfLegality(
                Characteristic::POSITION, ControlledFeature::FEATURE_OF_SIZE,
                MaterialCondition::MMC, {'A', 'Z'}, avail);
            check(!r.legal, "(F) ILLEGAL: position references missing datum Z");
        }
        // ILLEGAL: position with NO datum.
        {
            FcfLegality r = checkFcfLegality(
                Characteristic::POSITION, ControlledFeature::FEATURE_OF_SIZE,
                MaterialCondition::RFS, {}, avail);
            check(!r.legal, "(F) ILLEGAL: position with no datum");
        }
        // ILLEGAL: duplicate datum reference.
        {
            FcfLegality r = checkFcfLegality(
                Characteristic::POSITION, ControlledFeature::FEATURE_OF_SIZE,
                MaterialCondition::RFS, {'A', 'A'}, avail);
            check(!r.legal, "(F) ILLEGAL: duplicate datum reference");
        }
        // ILLEGAL: more than three datum references.
        {
            FcfLegality r = checkFcfLegality(
                Characteristic::POSITION, ControlledFeature::FEATURE_OF_SIZE,
                MaterialCondition::RFS, {'A', 'B', 'C', 'D'}, avail);
            check(!r.legal, "(F) ILLEGAL: more than 3 datum references");
        }
        // ILLEGAL: MMC on a planar-surface flatness (wrong characteristic/feature).
        {
            FcfLegality r = checkFcfLegality(
                Characteristic::PERPENDICULARITY, ControlledFeature::PLANAR_SURFACE,
                MaterialCondition::MMC, {'A'}, avail);
            check(!r.legal,
                  "(F) ILLEGAL: MMC on a planar-surface (non-FoS) control");
        }
        // ILLEGAL: position applied to a planar surface (not a FoS).
        {
            FcfLegality r = checkFcfLegality(
                Characteristic::POSITION, ControlledFeature::PLANAR_SURFACE,
                MaterialCondition::RFS, {'A'}, avail);
            check(!r.legal, "(F) ILLEGAL: position on a planar surface");
        }
        // ILLEGAL: cylindricity on a planar surface.
        {
            FcfLegality r = checkFcfLegality(
                Characteristic::CYLINDRICITY, ControlledFeature::PLANAR_SURFACE,
                MaterialCondition::RFS, {}, avail);
            check(!r.legal, "(F) ILLEGAL: cylindricity on a planar surface");
        }
    }

    // -----------------------------------------------------------------------
    // (G) Unified dispatcher routes identically to the per-characteristic paths.
    // -----------------------------------------------------------------------
    {
        // Position via dispatcher == direct.
        std::vector<Vec3> s = {{0.1, 0.0, 0}, {0.0, 0.1, 1}, {-0.05, 0.05, -1}};
        ToleranceZoneVerdict direct = validatePositionPointSet(
            s, Point2D{0, 0}, 10.2, 10.0, 0.3, MaterialCondition::MMC,
            FeatureType::HOLE);
        ToleranceZoneVerdict disp = validatePointSetAgainstZone(
            Characteristic::POSITION, s, Point2D{0, 0}, Vec3{0, 0, 1},
            0.3, 0.0, MaterialCondition::MMC, FeatureType::HOLE, 10.2, 10.0);
        check(direct.pass == disp.pass &&
              approx(direct.allowedZone, disp.allowedZone, 1e-12) &&
              approx(direct.worstDeviationMm, disp.worstDeviationMm, 1e-12),
              "(G) dispatcher POSITION == direct");

        // Flatness via dispatcher == direct.
        std::vector<Vec3> fpts = {{0, 0, 0.01}, {1, 0, -0.01}, {0, 1, 0.0},
                                  {1, 1, 0.008}, {2, 2, -0.006}};
        ToleranceZoneVerdict fd = validateFlatnessPointSet(fpts, 0.1);
        ToleranceZoneVerdict fdisp = validatePointSetAgainstZone(
            Characteristic::FLATNESS, fpts, Point2D{0, 0}, Vec3{0, 0, 1},
            0.1, 0.0, MaterialCondition::RFS, FeatureType::HOLE, 0, 0);
        check(fd.pass == fdisp.pass &&
              approx(fd.worstDeviationMm, fdisp.worstDeviationMm, 1e-12),
              "(G) dispatcher FLATNESS == direct");

        // Profile via dispatcher == direct.
        std::vector<Vec3> tp = {{0, 0, 0}, {1, 0, 0}};
        std::vector<Vec3> nm = {{0, 0, 1}, {0, 0, 1}};
        std::vector<Vec3> ms = {{0, 0, 0.02}, {1, 0, -0.03}};
        ToleranceZoneVerdict pd = validateProfilePointSet(ms, tp, nm, 0.1, false);
        ToleranceZoneVerdict pdisp = validatePointSetAgainstZone(
            Characteristic::PROFILE_SURFACE, ms, Point2D{0, 0}, Vec3{0, 0, 1},
            0.1, 0.0, MaterialCondition::RFS, FeatureType::HOLE, 0, 0,
            tp, nm, false);
        check(pd.pass == pdisp.pass &&
              approx(pd.worstDeviationMm, pdisp.worstDeviationMm, 1e-12),
              "(G) dispatcher PROFILE == direct");
    }

    // -----------------------------------------------------------------------
    // (H) Degenerate inputs report ok=false.
    // -----------------------------------------------------------------------
    {
        check(!validatePositionPointSet({}, Point2D{0, 0}, 1, 1, 0.1,
                                        MaterialCondition::RFS,
                                        FeatureType::HOLE).ok,
              "(H) empty position set -> ok=false");
        std::vector<Vec3> two = {{0, 0, 0}, {1, 1, 1}};
        check(!validateFlatnessPointSet(two, 0.1).ok,
              "(H) <3 points flatness -> ok=false");
        check(!validateOrientationPointSet({}, Vec3{0, 0, 1},
                                           Characteristic::PERPENDICULARITY,
                                           90.0, 0.1).ok,
              "(H) empty orientation set -> ok=false");
        check(!validateOrientationPointSet(two, Vec3{0, 0, 0},
                                           Characteristic::PERPENDICULARITY,
                                           90.0, 0.1).ok,
              "(H) zero datum normal -> ok=false");
        // Perpendicularity/angularity REQUIRE a nominal feature normal (the band
        // is measured along the fixed datum-relative zone normal) — absent it,
        // the validator must NOT guess; it reports ok=false.
        std::vector<Vec3> three = {{0, 0, 0}, {1, 0, 0}, {0, 1, 0}};
        check(!validateOrientationPointSet(three, Vec3{0, 0, 1},
                                           Characteristic::PERPENDICULARITY,
                                           90.0, 0.1 /*no nominal normal*/).ok,
              "(H) perpendicularity w/o nominal feature normal -> ok=false");
        // A nominal feature normal PARALLEL to the datum normal has no in-plane
        // component to build the zone normal from -> ok=false.
        check(!validateOrientationPointSet(three, Vec3{0, 0, 1},
                                           Characteristic::PERPENDICULARITY,
                                           90.0, 0.1, Vec3{0, 0, 1}).ok,
              "(H) nominal normal ∥ datum normal -> ok=false");
        check(!validateCircularityPointSet(two, 0.1).ok,
              "(H) <3 circularity points -> ok=false");
        check(!validateCylindricityPointSet(two, 0.1).ok,
              "(H) <6 cylindricity points -> ok=false");
        // Mismatched profile array sizes.
        std::vector<Vec3> a = {{0, 0, 0}}, b = {{0, 0, 0}, {1, 0, 0}};
        std::vector<Vec3> nrm = {{0, 0, 1}};
        check(!validateProfilePointSet(a, b, nrm, 0.1, false).ok,
              "(H) mismatched profile arrays -> ok=false");
        check(!validateProfilePointSet({}, {}, {}, 0.1, false).ok,
              "(H) empty profile -> ok=false");
    }

    // -----------------------------------------------------------------------
    std::printf("\n== RESULT: %d / %d checks passed (seed %u) ==\n",
                g_pass, g_total, seed);
    return (g_pass == g_total) ? 0 : 1;
}
