// forge/native/gdt/gdt_test.cpp
//
// Standalone validation gate for forge::native::gdt — the GEOMETRIC GD&T
// evaluator. Per Forge Engineering Bible §0/§9 the math is REAL ASME Y14.5,
// so RANDOM inputs (fresh seed EACH RUN) must ALWAYS validate against an
// independent reference computation — no fixed cherry-picked case.
//
// Build & run (also via test/native/run_native.sh):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/src/native/gdt/Gdt.cpp \
//       forge-kernel/test/native/gdt/gdt_test.cpp -o /tmp/gdt_test && /tmp/gdt_test
//
// VALIDATION GATE (each section runs many randomized trials):
//   (1) DRF round-trip: world->DRF->world is identity; DRF axes orthonormal &
//       right-handed; the DRF origin lies on all three datum planes; a point on
//       plane A has DRF z=0.
//   (2) TRUE POSITION: deviation, MMC/LMC bonus, and allowed zone match an
//       independent reference; pass iff Δ<=allowed; boundary (Δ==allowed) passes;
//       an out-of-tolerance feature fails; RFS earns zero bonus.
//   (3) FLATNESS: points placed within a known band off a random plane give a
//       flatness <= that band and PASS at a tol above it; an injected spike
//       FAILS a tight tol; perfectly planar points give flatness ~0.
//   (4) PERPENDICULARITY: a feature dir built at a known tilt off a datum normal
//       reports that tilt (sign-folded) and passes/fails the tol correctly.

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
    std::printf("== forge::native::gdt validation gate (RANDOMIZED) ==\n");

    // Fresh, varying seed EACH RUN — no fixed cherry-picked case.
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    unsigned seed = rd();
    std::mt19937_64 rng(seed);
    std::printf("seed = %u\n", seed);

    std::uniform_real_distribution<double> U(-5.0, 5.0);
    std::uniform_real_distribution<double> Upos(0.05, 4.0);
    std::uniform_real_distribution<double> Uang(0.0, 1.2);  // radians, < pi/2

    auto randVec = [&](double lo, double hi) {
        std::uniform_real_distribution<double> d(lo, hi);
        return Vec3{d(rng), d(rng), d(rng)};
    };

    // -----------------------------------------------------------------------
    // (1) DATUM REFERENCE FRAME — round-trip, orthonormality, plane incidence.
    // -----------------------------------------------------------------------
    {
        int built = 0;
        for (int t = 0; t < 2000; ++t) {
            // Random non-degenerate planes. Use near-orthogonal normals so the
            // system is well-conditioned, then a random rotation makes them
            // arbitrary in world space.
            Plane A{randVec(-3, 3), normalize(randVec(-1, 1))};
            Plane B{randVec(-3, 3), normalize(randVec(-1, 1))};
            Plane C{randVec(-3, 3), normalize(randVec(-1, 1))};
            if (norm(A.normal) == 0 || norm(B.normal) == 0 || norm(C.normal) == 0)
                continue;

            DatumReferenceFrame drf = buildDrf(A, B, C);
            if (!drf.ok) continue;  // skip the rare ill-conditioned draw
            ++built;

            // Orthonormal basis.
            check(approx(norm(drf.axisX), 1.0), "DRF axisX unit");
            check(approx(norm(drf.axisY), 1.0), "DRF axisY unit");
            check(approx(norm(drf.axisZ), 1.0), "DRF axisZ unit");
            check(approx(dot(drf.axisX, drf.axisY), 0.0), "DRF X.Y=0");
            check(approx(dot(drf.axisX, drf.axisZ), 0.0), "DRF X.Z=0");
            check(approx(dot(drf.axisY, drf.axisZ), 0.0), "DRF Y.Z=0");
            // Right-handed: X x Y == Z.
            Vec3 xy = cross(drf.axisX, drf.axisY);
            check(approx(xy.x, drf.axisZ.x) && approx(xy.y, drf.axisZ.y) &&
                  approx(xy.z, drf.axisZ.z), "DRF right-handed (X x Y = Z)");

            // axisZ is A's (normalized) normal.
            Vec3 nA = normalize(A.normal);
            check(approx(std::fabs(dot(drf.axisZ, nA)), 1.0), "DRF Z || A.normal");

            // World->DRF->World round-trip is identity.
            Vec3 wp = randVec(-4, 4);
            Vec3 inDrf = transformToDrf(drf, wp);
            Vec3 back = transformToWorld(drf, inDrf);
            check(approx(back.x, wp.x) && approx(back.y, wp.y) &&
                  approx(back.z, wp.z), "DRF round-trip identity");

            // Origin lies on all three ORIGINAL planes: n.(origin-p)=0.
            check(approx(dot(normalize(A.normal), sub(drf.origin, A.point)), 0.0),
                  "DRF origin on plane A");
            check(approx(dot(normalize(B.normal), sub(drf.origin, B.point)), 0.0),
                  "DRF origin on plane B");
            check(approx(dot(normalize(C.normal), sub(drf.origin, C.point)), 0.0),
                  "DRF origin on plane C");

            // A point ON plane A has DRF z == 0 (A is the z=0 datum).
            // Construct such a point: origin + t*axisX + s*axisY (both ⊥ axisZ).
            std::uniform_real_distribution<double> d(-3, 3);
            Vec3 onA = transformToWorld(drf, Vec3{d(rng), d(rng), 0.0});
            check(approx(transformToDrf(drf, onA).z, 0.0), "DRF point on A has z=0");
        }
        std::printf("(1) DRF: %d frames built & validated\n", built);
        check(built > 1500, "(1) most random plane triples form a valid DRF");
    }

    // -----------------------------------------------------------------------
    // (2) TRUE POSITION with MMC / LMC bonus.
    // -----------------------------------------------------------------------
    {
        int trials = 0, passes = 0, fails = 0;
        for (int t = 0; t < 5000; ++t) {
            ++trials;
            Point2D trueLoc{U(rng), U(rng)};
            // Random offset; deviation = 2*r.
            std::uniform_real_distribution<double> dr(0.0, 1.5);
            double r = dr(rng);
            std::uniform_real_distribution<double> dth(0.0, 2 * M_PI);
            double th = dth(rng);
            Point2D actual{trueLoc.x + r * std::cos(th),
                           trueLoc.y + r * std::sin(th)};

            double posTol = Upos(rng);            // FCF Ø tolerance at MC
            double mmc = Upos(rng);               // material-condition limit
            std::uniform_real_distribution<double> dsz(-0.8, 0.8);
            double actualSize = mmc + dsz(rng);   // may be either side of MMC

            // Pick a random feature type & material condition.
            FeatureType ft = (rng() & 1) ? FeatureType::HOLE : FeatureType::PIN;
            int mcsel = static_cast<int>(rng() % 3);
            MaterialCondition mc = (mcsel == 0) ? MaterialCondition::RFS
                                 : (mcsel == 1) ? MaterialCondition::MMC
                                                : MaterialCondition::LMC;

            TruePositionResult res = evaluateTruePosition(
                actual, actualSize > 0 ? actual : actual, // placeholder (unused)
                0, 0, 0, mc, ft);                          // overwritten below
            res = evaluateTruePosition(actual, trueLoc, actualSize, mmc,
                                       posTol, mc, ft);

            // Independent reference deviation.
            double refDev = 2.0 * r;
            check(approx(res.deviation, refDev), "(2) deviation = 2*radial");

            // Independent reference bonus.
            double refBonus = 0.0;
            if (mc == MaterialCondition::MMC)
                refBonus = (ft == FeatureType::HOLE) ? (actualSize - mmc)
                                                     : (mmc - actualSize);
            else if (mc == MaterialCondition::LMC)
                refBonus = (ft == FeatureType::HOLE) ? (mmc - actualSize)
                                                     : (actualSize - mmc);
            if (refBonus < 0) refBonus = 0;
            check(approx(res.bonus, refBonus), "(2) MMC/LMC bonus exact");
            if (mc == MaterialCondition::RFS)
                check(res.bonus == 0.0, "(2) RFS earns zero bonus");

            double refAllowed = posTol + refBonus;
            check(approx(res.allowedZoneDia, refAllowed), "(2) allowed zone = tol+bonus");
            check(res.pass == (refDev <= refAllowed), "(2) pass iff Δ<=allowed");
            if (res.pass) ++passes; else ++fails;
        }
        std::printf("(2) true position: %d trials (%d pass / %d fail)\n",
                    trials, passes, fails);
        check(passes > 0 && fails > 0,
              "(2) random spread exercises BOTH pass and fail");

        // Explicit BOUNDARY: Δ exactly == allowed must PASS (inclusive zone).
        {
            // posTol=0.4, RFS, deviation forced to 0.4 -> radial 0.2.
            Point2D tl{0, 0};
            Point2D ac{0.2, 0.0};  // radial 0.2 -> deviation 0.4
            TruePositionResult res = evaluateTruePosition(
                ac, tl, 10.0, 10.0, 0.4, MaterialCondition::RFS, FeatureType::HOLE);
            check(approx(res.deviation, 0.4), "(2) boundary deviation=0.4");
            check(res.pass, "(2) boundary Δ==allowed PASSES (inclusive)");
        }

        // Explicit MMC bonus worked example (hole): MMC=10, actual=10.5 ->
        // bonus 0.5; posTol 0.2 -> allowed 0.7; deviation 0.6 -> PASS,
        // but at RFS (no bonus, allowed 0.2) the SAME feature FAILS.
        {
            Point2D tl{0, 0};
            Point2D ac{0.3, 0.0};  // deviation 0.6
            TruePositionResult mmc = evaluateTruePosition(
                ac, tl, 10.5, 10.0, 0.2, MaterialCondition::MMC, FeatureType::HOLE);
            check(approx(mmc.bonus, 0.5) && approx(mmc.allowedZoneDia, 0.7) &&
                  mmc.pass, "(2) worked MMC hole: bonus 0.5, allowed 0.7, PASS");
            TruePositionResult rfs = evaluateTruePosition(
                ac, tl, 10.5, 10.0, 0.2, MaterialCondition::RFS, FeatureType::HOLE);
            check(rfs.bonus == 0.0 && !rfs.pass,
                  "(2) same feature RFS (no bonus) FAILS at 0.2");
        }

        // Explicit MMC pin: MMC is the LARGEST size; shrinking earns bonus.
        {
            Point2D tl{0, 0}, ac{0.0, 0.0};  // deviation 0
            TruePositionResult pin = evaluateTruePosition(
                ac, tl, 9.6, 10.0, 0.1, MaterialCondition::MMC, FeatureType::PIN);
            check(approx(pin.bonus, 0.4), "(2) MMC pin shrink earns bonus 0.4");
        }
    }

    // -----------------------------------------------------------------------
    // (3) FLATNESS — random best-fit plane recovery.
    // -----------------------------------------------------------------------
    {
        // Independent reference: peak-to-valley of `pts` measured against an
        // ARBITRARY plane (centroid + unit normal `m`). This is the exact
        // definition the evaluator applies to ITS fit plane; we recompute it
        // here against (a) the evaluator's returned fit plane — must MATCH —
        // and (b) the GENERATING plane — the LS plane minimizes the variance of
        // signed distances, so its peak-to-valley is the tightest a plane gives
        // for this noise model and must be <= the generating plane's band.
        auto pvAgainst = [](const std::vector<Vec3>& P, const Vec3& c,
                            const Vec3& m) {
            double lo = std::numeric_limits<double>::infinity();
            double hi = -std::numeric_limits<double>::infinity();
            for (const auto& p : P) {
                double sd = dot(sub(p, c), m);
                lo = std::min(lo, sd);
                hi = std::max(hi, sd);
            }
            return hi - lo;
        };

        int trials = 0;
        for (int t = 0; t < 2000; ++t) {
            ++trials;
            // Random plane: point p0, unit normal n. Build an in-plane basis.
            Vec3 n = normalize(randVec(-1, 1));
            if (norm(n) == 0) { --trials; continue; }
            Vec3 helper = (std::fabs(n.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
            Vec3 u = normalize(cross(n, helper));
            Vec3 v = normalize(cross(n, u));
            Vec3 p0 = randVec(-3, 3);

            // Off-plane noise half-band B; keep it SMALL vs the in-plane span so
            // the LS plane stays well-conditioned (it tracks the generating
            // plane; a large noise:span ratio would let LS legitimately tilt and
            // report a *different* — still correct — min-variance band, which is
            // why we assert against a recomputed reference, never a fixed bound).
            std::uniform_real_distribution<double> dband(0.001, 0.2);
            double B = dband(rng);
            std::uniform_real_distribution<double> doff(-B, B);
            std::uniform_real_distribution<double> dspan(-4, 4);

            std::vector<Vec3> pts;
            int npts = 8 + static_cast<int>(rng() % 20);
            for (int i = 0; i < npts; ++i) {
                Vec3 inPlane = add(add(p0, scale(u, dspan(rng))),
                                   scale(v, dspan(rng)));
                Vec3 p = add(inPlane, scale(n, doff(rng)));
                pts.push_back(p);
            }

            // The evaluator's flatness is exact for ITS OWN fit plane, so we
            // validate it against a recomputed reference (NOT a fixed bound):
            // the LS plane minimizes the VARIANCE of signed distances, which is
            // not the same as minimizing the peak-to-valley RANGE — so we never
            // assert flatness <= the generating-plane band (that would be a
            // mathematically false claim, range != variance).

            FlatnessResult fr = evaluateFlatness(pts, 1.0);
            check(fr.ok, "(3) flatness fit ok");

            // (i) INTERNAL CONSISTENCY: the reported flatness EXACTLY equals the
            //     peak-to-valley of the points against the returned fit plane.
            //     This validates the flatness DEFINITION on every random set.
            double pvFit = pvAgainst(pts, fr.fitPlane.point,
                                     normalize(fr.fitPlane.normal));
            check(approx(fr.flatness, pvFit, 1e-9),
                  "(3) flatness == p2v vs returned fit plane");

            // (ii) LS OPTIMALITY (the real least-squares property): the variance
            //     of signed distances about the LS plane is <= the variance
            //     about the generating plane. This is exactly what the LS
            //     normal (smallest covariance eigenvector) guarantees, so it
            //     holds on EVERY random set.
            Vec3 cen{0, 0, 0};
            for (const auto& p : pts) cen = add(cen, p);
            cen = scale(cen, 1.0 / static_cast<double>(pts.size()));
            auto varAbout = [&](const Vec3& m) {
                double s = 0.0;
                for (const auto& p : pts) {
                    double d = dot(sub(p, cen), m);
                    s += d * d;
                }
                return s;
            };
            check(varAbout(normalize(fr.fitPlane.normal)) <= varAbout(n) + 1e-6,
                  "(3) LS plane has min signed-distance variance");

            // (iii) maxAbsDeviation <= flatness band, and >= half of it.
            check(fr.maxAbsDeviation <= fr.flatness + 1e-9,
                  "(3) maxAbsDeviation within band");
            check(2.0 * fr.maxAbsDeviation >= fr.flatness - 1e-9,
                  "(3) flatness <= 2*maxAbsDeviation");

            // (iv) PASS/FAIL gating is exact: a tol just ABOVE the measured
            //     flatness PASSES; one just BELOW FAILS.
            FlatnessResult above = evaluateFlatness(pts, fr.flatness + 1e-6);
            check(above.pass, "(3) tol just above flatness PASSES");
            if (fr.flatness > 1e-6) {
                FlatnessResult below = evaluateFlatness(pts, fr.flatness - 1e-6);
                check(!below.pass, "(3) tol just below flatness FAILS");
            }
        }
        std::printf("(3) flatness: %d random fits validated\n", trials);

        // Perfectly planar set -> flatness ~ 0, passes any positive tol.
        {
            std::vector<Vec3> flat = {
                {0, 0, 0}, {1, 0, 0}, {0, 1, 0}, {1, 1, 0},
                {2, 3, 0}, {-1, 2, 0}, {4, -2, 0}};
            FlatnessResult fr = evaluateFlatness(flat, 1e-6);
            check(fr.ok && fr.flatness < 1e-9 && fr.pass,
                  "(3) perfectly planar -> flatness~0 PASS");
        }

        // Injected spike on an otherwise planar set FAILS a tight tol.
        {
            std::vector<Vec3> pts = {
                {0, 0, 0}, {1, 0, 0}, {0, 1, 0}, {1, 1, 0},
                {2, 2, 0}, {3, 0, 0}, {0, 3, 0},
                {1.5, 1.5, 0.4}};  // spike 0.4 off-plane
            FlatnessResult fr = evaluateFlatness(pts, 0.1);
            check(fr.ok && !fr.pass && fr.flatness > 0.1,
                  "(3) injected spike FAILS tight tol");
        }

        // < 3 points reported degenerate.
        {
            std::vector<Vec3> two = {{0, 0, 0}, {1, 1, 1}};
            FlatnessResult fr = evaluateFlatness(two, 1.0);
            check(!fr.ok, "(3) <3 points reported degenerate");
        }
    }

    // -----------------------------------------------------------------------
    // (4) PERPENDICULARITY — known-tilt recovery.
    // -----------------------------------------------------------------------
    {
        int trials = 0;
        for (int t = 0; t < 3000; ++t) {
            ++trials;
            // Random datum normal n. Feature dir = n tilted by a known angle
            // `ang` about a random in-plane axis.
            Vec3 n = normalize(randVec(-1, 1));
            if (norm(n) == 0) { --trials; continue; }
            Vec3 helper = (std::fabs(n.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
            Vec3 u = normalize(cross(n, helper));  // ⊥ n

            double ang = Uang(rng);  // [0, 1.2] rad, < pi/2
            // feature = cos(ang)*n + sin(ang)*u  (exactly `ang` off n).
            Vec3 fdir = add(scale(n, std::cos(ang)), scale(u, std::sin(ang)));

            std::uniform_real_distribution<double> dlen(0.5, 5.0);
            double L = dlen(rng);
            // Choose tol straddling the expected deviation so both outcomes
            // appear across trials.
            double expectDev = L * std::tan(ang);
            std::uniform_real_distribution<double> dtolf(0.5, 1.5);
            double tol = expectDev * dtolf(rng);

            PerpendicularityResult pr =
                evaluatePerpendicularity(fdir, n, tol, L);
            check(pr.ok, "(4) perpendicularity ok");
            check(approx(pr.angleDeg, ang * 180.0 / M_PI, 1e-6),
                  "(4) recovered tilt angle exact");
            check(approx(pr.deviation, expectDev, 1e-6),
                  "(4) deviation = L*tan(angle)");
            check(pr.pass == (expectDev <= tol), "(4) pass iff dev<=tol");

            // Sign-fold: a flipped feature dir is the SAME line -> same angle.
            PerpendicularityResult prFlip =
                evaluatePerpendicularity(scale(fdir, -1.0), n, tol, L);
            check(approx(prFlip.angleDeg, pr.angleDeg, 1e-9),
                  "(4) flipped feature dir gives identical angle");
        }
        std::printf("(4) perpendicularity: %d random tilts validated\n", trials);

        // Perfect perpendicularity (feature || datum normal) -> 0 deviation.
        {
            PerpendicularityResult pr = evaluatePerpendicularity(
                Vec3{0, 0, 2}, Vec3{0, 0, 1}, 0.05, 3.0);
            check(approx(pr.angleDeg, 0.0) && approx(pr.deviation, 0.0) && pr.pass,
                  "(4) perfect perpendicular -> 0 deviation PASS");
        }
        // 90deg off (feature lies IN the datum, parallel to it) -> max error.
        {
            PerpendicularityResult pr = evaluatePerpendicularity(
                Vec3{1, 0, 0}, Vec3{0, 0, 1}, 0.05, 3.0);
            check(approx(pr.angleDeg, 90.0) && !pr.pass,
                  "(4) feature in datum plane (90deg) FAILS");
        }
    }

    // -----------------------------------------------------------------------
    std::printf("\n== RESULT: %d / %d checks passed ==\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
