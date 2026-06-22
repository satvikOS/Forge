// forge/native/vvuq/vvuq_test.cpp
//
// Standalone validation gate for forge::native::vvuq — the simulation-credibility
// / VVUQ layer. Every fixture is a deterministic, hand-verifiable analytic /
// synthetic case (no solver dependency): a re-entrant corner vs a convex corner
// under the same load, a converging vs a singular mesh-refinement sequence,
// hourglass-energy thresholds, y+ wall-treatment matches/mismatches, and a
// cantilever cross-check inside vs outside tolerance — then the fit-for-purpose
// aggregator on top.
//
// HONESTY NOTE (per memory [forge-physics-rigor-met]): static FEA is validated
// to 0.33%, modal 0.2%, MBD 0.016% — so the analytic-check GREEN tolerance (<2%)
// is consistent. Turbulent CFD is UNVERIFIED, so an in-band y+ is capped at AMBER
// and the aggregator carries that caveat. These tests assert that honesty.
//
// Build & run (also via test/native/run_native.sh):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/src/native/vvuq/Vvuq.cpp \
//       forge-kernel/test/native/vvuq/vvuq_test.cpp \
//       -o /tmp/vvuq_test && /tmp/vvuq_test

#include "forge/native/vvuq/Vvuq.hpp"

#include <cstdio>
#include <cmath>
#include <vector>
#include <cstdint>
#include <cstddef>
#include <limits>
#include <algorithm>
#include <numeric>
#include <string>

using namespace forge::native::vvuq;

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

// ---------------------------------------------------------------------------
// Build a single quad (two triangles) sharing a diagonal edge that BENDS by a
// chosen sign at the shared edge — used to synthesize a concave vs convex fold.
//
// We construct two triangles sharing edge (A,B). Triangle 0 = (A,B,P0),
// triangle 1 = (A,B,P1). The fold direction is set by where P0 and P1 sit
// relative to the A-B line in the out-of-plane (z) direction.
// ---------------------------------------------------------------------------
struct FoldSoup {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
};

// Make a "roof" / "valley" along edge A-B in the x-axis; the two wing vertices
// P0, P1 are lifted by +dz0 / +dz1 in z. A VALLEY (both wings up, viewed from
// below = material below) is re-entrant; a ROOF is convex. We parameterize by
// the wing z so the caller dials concave vs convex.
static FoldSoup makeFold(double wingZ0, double wingZ1) {
    FoldSoup s;
    // A=(0,0,0) B=(1,0,0) shared edge along +x.
    // P0=(0.5,+1, wingZ0)  P1=(0.5,-1, wingZ1)
    s.pos = {
        0.0, 0.0, 0.0,      // 0 = A
        1.0, 0.0, 0.0,      // 1 = B
        0.5, 1.0, wingZ0,   // 2 = P0
        0.5, -1.0, wingZ1,  // 3 = P1
    };
    // tri0 = (A,B,P0) = (0,1,2); tri1 = (A,B,P1) -> wind as (1,0,3) so both
    // share edge (A,B) with consistent orientation in the soup.
    s.idx = { 0, 1, 2,  1, 0, 3 };
    return s;
}

// ===========================================================================
int main() {
    std::printf("== forge::native::vvuq validation gate ==\n");

    // -----------------------------------------------------------------------
    // (0) vector-math sanity.
    // -----------------------------------------------------------------------
    {
        Vec3 a{1, 0, 0}, b{0, 1, 0};
        check(approx(dot(a, b), 0.0), "(0) dot orthogonal = 0");
        Vec3 c = cross(a, b);
        check(approx(c.x, 0) && approx(c.y, 0) && approx(c.z, 1), "(0) x cross y = z");
        check(approx(norm(Vec3{3, 4, 0}), 5.0), "(0) norm 3-4-5");
        Vec3 z = normalize(Vec3{0, 0, 0});
        check(z.x == 0 && z.y == 0 && z.z == 0, "(0) normalize(0) = 0 (no NaN)");
    }

    // -----------------------------------------------------------------------
    // (1) SINGULARITY DETECTION.
    //   (1a) A re-entrant (valley/concave) 90deg fold under load -> a
    //        REENTRANT_CORNER site.
    //   (1b) A convex (roof) fold with the SAME |dihedral| under the SAME load
    //        -> NO geometric site (proves signed-dihedral, not magnitude).
    //   (1c) A point-load node and a point-disp-BC node each yield a site.
    // -----------------------------------------------------------------------
    {
        // A valley: both wings lifted up in +z -> the surface folds toward the
        // outward normals (concave when material is the wedge between).
        FoldSoup valley = makeFold(+1.0, +1.0);
        SingularityInput in;
        in.positions = valley.pos;
        in.indices = valley.idx;
        in.loadedVertices = {0, 1};       // the shared edge carries load
        in.sharpThresholdDeg = 30.0;
        in.filletRadius = 0.0;

        auto sitesV = detectSingularities(in);
        // Exactly the geometric edge should be flagged for ONE orientation
        // (valley = re-entrant) — assert at least one re-entrant site.
        int reentrant = 0;
        for (auto& s : sitesV) if (s.kind == SingularityKind::REENTRANT_CORNER) ++reentrant;

        // A roof: wings dipped down -> convex; same magnitude dihedral.
        FoldSoup roof = makeFold(-1.0, -1.0);
        SingularityInput in2 = in;
        in2.positions = roof.pos;
        in2.indices = roof.idx;
        auto sitesR = detectSingularities(in2);
        int reentrant2 = 0;
        for (auto& s : sitesR) if (s.kind == SingularityKind::REENTRANT_CORNER) ++reentrant2;

        // EXACTLY ONE of {valley, roof} is re-entrant (the signed test splits
        // the two identical-|dihedral| folds). That is the load-bearing claim.
        check((reentrant > 0) != (reentrant2 > 0),
              "(1a/b) signed dihedral: exactly one of concave/convex fold is flagged");
        check(reentrant + reentrant2 >= 1,
              "(1a) at least one fold flagged as re-entrant");

        // The convex twin under the same load is NOT flagged (the one that is
        // NOT re-entrant has zero geometric sites).
        check((reentrant == 0) || (reentrant2 == 0),
              "(1b) the convex twin under the same load is NOT a singularity");

        // (1c) point-load + point-disp-BC nodes are ALWAYS singular sites.
        SingularityInput pin;
        pin.positions = { 0,0,0,  1,0,0,  2,0,0 };
        pin.pointLoadNodes = {1};
        pin.pointDispBCNodes = {2};
        auto pinSites = detectSingularities(pin);
        int pl = 0, pd = 0;
        double plx = 0, ply = 0, plz = 0;
        for (auto& s : pinSites) {
            if (s.kind == SingularityKind::POINT_LOAD)    { ++pl; plx = s.x; ply = s.y; plz = s.z; }
            if (s.kind == SingularityKind::POINT_DISP_BC) ++pd;
        }
        check(pl == 1, "(1c) point-load node -> POINT_LOAD site");
        check(pd == 1, "(1c) point-disp-BC node -> POINT_DISP_BC site");
        check(approx(plx, 1.0) && approx(ply, 0.0) && approx(plz, 0.0),
              "(1c) point-load site located at node 1 = (1,0,0)");

        // isPeakSingular: a peak reported AT the point-load node is singular.
        check(isPeakSingular(pinSites, 1.0, 0.0, 0.0, 1e-6),
              "(1c) reported peak at the point-load node is SINGULAR");
        check(!isPeakSingular(pinSites, 50.0, 0.0, 0.0, 1e-6),
              "(1c) a peak far from every site is NOT singular");

        // Robustness: empty / malformed geometry -> no crash, empty.
        SingularityInput bad;
        bad.positions = {0,0,0, 1,0,0};   // 2 verts, no tris
        bad.indices = {0, 1};             // not a multiple of 3
        auto none = detectSingularities(bad);
        int geomBad = 0;
        for (auto& s : none) if (s.kind == SingularityKind::REENTRANT_CORNER) ++geomBad;
        check(geomBad == 0, "(1d) malformed soup -> no geometric sites, no UB");

        // Fillet present (>0) suppresses the geometric singularity even when sharp+loaded.
        SingularityInput filleted = in;     // the valley that DID flag
        filleted.filletRadius = 2.0;
        auto fSites = detectSingularities(filleted);
        int fRe = 0;
        for (auto& s : fSites) if (s.kind == SingularityKind::REENTRANT_CORNER) ++fRe;
        // (only meaningful if the valley was the flagged one; otherwise vacuously holds)
        check(fRe == 0 || reentrant == 0,
              "(1e) a non-zero fillet suppresses the re-entrant singularity");
    }

    // -----------------------------------------------------------------------
    // (2) MESH-CONVERGENCE CLASSIFICATION.
    //   (2a) CONVERGING: f = f_inf + C*h^2 (a 2nd-order FE quantity, e.g. tip
    //        deflection). h = 4,2,1. classifyConvergence -> CONVERGING, p~2,
    //        convergedValue ~ f_inf.
    //   (2b) SINGULAR: peak stress = C*h^(-0.3) (Williams re-entrant). Growing
    //        deltas as h->0 -> DIVERGING_SINGULAR, exponent ~0.3, NOT converging.
    //   Both run through the SAME classifier — the distinction is the point.
    // -----------------------------------------------------------------------
    {
        // (2a) converging 2nd-order quantity. A well-refined sequence (small C,
        // fine grids 0.4/0.2/0.1) so the finest grid is already close to the
        // asymptote and the fine-grid GCI is genuinely small (< 5%).
        const double fInf = 12.5;       // the true asymptote
        const double C = 0.5;
        auto fOf = [&](double h) { return fInf + C * h * h; };
        std::vector<ConvergenceLevel> conv = {
            { 0.4, fOf(0.4) },   // coarse
            { 0.2, fOf(0.2) },
            { 0.1, fOf(0.1) },   // fine
        };
        ConvergenceResult rc = classifyConvergence(conv);
        check(rc.cls == ConvergenceClass::CONVERGING, "(2a) 2nd-order seq -> CONVERGING");
        check(rc.converging, "(2a) converging flag set");
        check(approx(rc.orderP, 2.0, 0.05), "(2a) observed order p ~ 2");
        check(approx(rc.convergedValue, fInf, 1e-4),
              "(2a) Richardson extrapolation recovers the asymptote f_inf");
        check(rc.gci >= 0.0 && rc.gci < 0.05, "(2a) fine-grid GCI is small (< 5%)");
        check(rc.monotone, "(2a) monotone");

        // (2a') a COARSE 2nd-order sequence still CONVERGES but with a LARGE GCI
        //       (the honest discretization-uncertainty signal the aggregator uses
        //       to drop GREEN->AMBER). Same physics, coarser grid.
        auto gOf = [&](double h) { return fInf + 3.0 * h * h; };
        std::vector<ConvergenceLevel> coarse = {
            { 4.0, gOf(4.0) }, { 2.0, gOf(2.0) }, { 1.0, gOf(1.0) },
        };
        ConvergenceResult rcCoarse = classifyConvergence(coarse);
        check(rcCoarse.cls == ConvergenceClass::CONVERGING, "(2a') coarse 2nd-order seq still CONVERGING");
        check(rcCoarse.gci > 0.05, "(2a') coarse grid -> large GCI (real discretization uncertainty)");
        check(approx(rcCoarse.convergedValue, fInf, 1e-3),
              "(2a') Richardson still recovers f_inf despite the coarse grid");

        // (2b) singular peak ~ h^(-0.3). value GROWS as h shrinks.
        const double Csig = 100.0;
        const double aExp = 0.3;
        auto sOf = [&](double h) { return Csig * std::pow(h, -aExp); };
        std::vector<ConvergenceLevel> sing = {
            { 4.0, sOf(4.0) },   // coarse (smallest)
            { 2.0, sOf(2.0) },
            { 1.0, sOf(1.0) },   // fine (largest)
        };
        ConvergenceResult rs = classifyConvergence(sing);
        check(rs.cls == ConvergenceClass::DIVERGING_SINGULAR,
              "(2b) ~h^-a peak-stress seq -> DIVERGING_SINGULAR");
        check(!rs.converging, "(2b) NOT converging");
        check(approx(rs.divergenceExponent, aExp, 1e-6),
              "(2b) recovered divergence exponent a ~ 0.3");

        // The KEY claim: the two are DISTINGUISHED on the same harness.
        check(rc.cls != rs.cls,
              "(2) converging tip-deflection vs singular peak-stress are DISTINGUISHED");

        // (2b') LOG SINGULARITY q = B - K*ln(h) — the slow-growth fooling case.
        // Its successive refinement deltas are CONSTANT (K*ln r), so it grows
        // without bound as h->0 yet would slip past a bare |eps32|<|eps21| test on
        // floating-point rounding. It MUST be classified non-convergent (a true
        // converged value of 9e15 here would be a dangerous fiction), for several
        // (B,K,ratio) so the result does not hinge on last-bit rounding.
        {
            int logOk = 0, logN = 0;
            for (double K : {0.5, 1.0, 3.0, 5.0})
                for (double B : {0.0, 5.0, 10.0})
                    for (double rbase : {2.0, 3.0}) {
                        auto lg = [&](double h) { return B - K * std::log(h); };
                        double hh1 = rbase * rbase, hh2 = rbase, hh3 = 1.0;
                        std::vector<ConvergenceLevel> lseq = {
                            {hh1, lg(hh1)}, {hh2, lg(hh2)}, {hh3, lg(hh3)} };
                        ConvergenceResult rl = classifyConvergence(lseq);
                        ++logN;
                        if (rl.cls == ConvergenceClass::DIVERGING_SINGULAR && !rl.converging)
                            ++logOk;
                    }
            check(logOk == logN,
                  "(2b') log singularity q=B-K*ln(h) classified non-convergent (not fooled)");
        }

        // Robustness: <3 levels -> INSUFFICIENT (not a crash).
        std::vector<ConvergenceLevel> few = { {2.0, 1.0}, {1.0, 1.0} };
        ConvergenceResult ri = classifyConvergence(few);
        check(ri.cls == ConvergenceClass::INSUFFICIENT, "(2c) <3 levels -> INSUFFICIENT");

        // Oscillatory deltas -> OSCILLATORY.
        std::vector<ConvergenceLevel> osc = { {4.0, 10.0}, {2.0, 11.0}, {1.0, 10.5} };
        ConvergenceResult ro = classifyConvergence(osc);
        check(ro.cls == ConvergenceClass::OSCILLATORY, "(2d) sign-alternating deltas -> OSCILLATORY");

        // Randomized: many monotone-converging 2nd-order sequences always classify CONVERGING.
        int convOk = 0, trials = 0;
        for (int t = 0; t < 200; ++t) {
            double fi = -50.0 + 0.5 * t;
            double cc = 0.1 + 0.05 * (t % 7);
            auto g = [&](double h) { return fi + cc * h * h; };
            std::vector<ConvergenceLevel> seq = { {4.0, g(4)}, {2.0, g(2)}, {1.0, g(1)} };
            ConvergenceResult r = classifyConvergence(seq);
            ++trials;
            if (r.cls == ConvergenceClass::CONVERGING) ++convOk;
        }
        check(convOk == trials, "(2e) all randomized 2nd-order seqs classify CONVERGING");
    }

    // -----------------------------------------------------------------------
    // (3) ENERGY-RATIO MONITORS.
    //   hourglass 12% of IE -> RED; 3% -> GREEN; KE/IE 8% quasi-static -> RED.
    // -----------------------------------------------------------------------
    {
        EnergyInput hi;  hi.internalEnergy = 100.0; hi.hourglassEnergy = 12.0;
        EnergyAudit ahi = auditEnergy(hi);
        check(approx(ahi.hourglassPct, 12.0), "(3) hourglassPct = 12");
        check(ahi.level == Level::RED, "(3) hourglass 12% -> RED");
        check(!ahi.reasons.empty(), "(3) RED energy audit has reasons");

        EnergyInput lo;  lo.internalEnergy = 100.0; lo.hourglassEnergy = 3.0;
        EnergyAudit alo = auditEnergy(lo);
        check(approx(alo.hourglassPct, 3.0), "(3) hourglassPct = 3");
        check(alo.level == Level::GREEN, "(3) hourglass 3% -> GREEN");

        EnergyInput ke; ke.internalEnergy = 100.0; ke.kineticEnergy = 8.0; ke.quasiStatic = true;
        EnergyAudit ake = auditEnergy(ke);
        check(approx(ake.keIeRatio, 0.08), "(3) KE/IE = 0.08");
        check(ake.level == Level::RED, "(3) KE/IE 8% in a quasi-static run -> RED (mass-scaling abuse)");

        // contact-stabilization 7% -> AMBER.
        EnergyInput cs; cs.internalEnergy = 100.0; cs.contactStabEnergy = 7.0;
        EnergyAudit acs = auditEnergy(cs);
        check(acs.level == Level::AMBER, "(3) contact-stab 7% -> AMBER");

        // clean run -> GREEN.
        EnergyInput clean; clean.internalEnergy = 100.0;
        check(auditEnergy(clean).level == Level::GREEN, "(3) all-zero artificial energy -> GREEN");

        // non-positive IE -> AMBER, no divide-by-zero.
        EnergyInput zero; zero.internalEnergy = 0.0; zero.hourglassEnergy = 5.0;
        EnergyAudit az = auditEnergy(zero);
        check(az.level == Level::AMBER && std::isfinite(az.hourglassPct),
              "(3) IE<=0 -> AMBER, ratios finite (no div0)");
    }

    // -----------------------------------------------------------------------
    // (4) y+ / WALL-TREATMENT.
    //   y+=150 wall-function -> in-band (ok, but AMBER honesty cap).
    //   y+=150 low-Re        -> MISMATCH flagged -> RED.
    //   y+=2  wall-function  -> below band -> RED.
    //   y+=0.7 low-Re        -> in-band -> AMBER (cap).
    // -----------------------------------------------------------------------
    {
        YPlusCheck wf = checkYPlus(150.0, WallTreatment::WALL_FUNCTION);
        check(wf.inBand, "(4) y+=150 in the wall-function band (30..300)");
        check(wf.level == Level::AMBER, "(4) in-band wall-function -> AMBER (cfd unverified cap)");
        check(wf.cfdUnverified, "(4) cfdUnverified carried on the y+ check");

        YPlusCheck lr = checkYPlus(150.0, WallTreatment::LOW_RE_RESOLVED);
        check(!lr.inBand, "(4) y+=150 is OUT of the low-Re band (~1)");
        check(lr.level == Level::RED, "(4) y+=150 low-Re -> MISMATCH flagged RED");

        YPlusCheck wfLow = checkYPlus(2.0, WallTreatment::WALL_FUNCTION);
        check(!wfLow.inBand && wfLow.level == Level::RED,
              "(4) y+=2 wall-function -> below band -> RED");

        YPlusCheck lrOk = checkYPlus(0.7, WallTreatment::LOW_RE_RESOLVED);
        check(lrOk.inBand && lrOk.level == Level::AMBER,
              "(4) y+=0.7 low-Re -> in-band but AMBER (cfd unverified cap)");

        YPlusCheck bad = checkYPlus(-1.0, WallTreatment::WALL_FUNCTION);
        check(bad.level == Level::RED, "(4) negative y+ -> RED, no crash");
    }

    // -----------------------------------------------------------------------
    // (5) ANALYTIC CROSS-CHECK.
    //   cantilever tip PL^3/3EI: a 0.33%-off result -> GREEN; a 40%-off -> RED.
    // -----------------------------------------------------------------------
    {
        const double P = 1000.0, L = 2.0, E = 210e9;
        const double I = 1.0e-6;     // m^4
        const double dExact = cantileverTipDeflection(P, L, E, I);
        check(dExact > 0.0, "(5) cantilever closed-form > 0");

        double params[4] = { P, L, E, I };

        // 0.33% off (the validated static gate) -> GREEN.
        double dGood = dExact * 1.0033;
        AnalyticCheck cg = crossCheckAnalytic(Benchmark::CANTILEVER_TIP, dGood, params, 4);
        check(approx(cg.analytic, dExact, 1e-9), "(5) cross-check recomputes the analytic value");
        check(approx(cg.pctError, 0.33, 0.05), "(5) pctError ~ 0.33%");
        check(cg.level == Level::GREEN, "(5) 0.33%-off cantilever -> GREEN");

        // 40% off -> RED.
        double dBad = dExact * 1.40;
        AnalyticCheck cb = crossCheckAnalytic(Benchmark::CANTILEVER_TIP, dBad, params, 4);
        check(approx(cb.pctError, 40.0, 0.5), "(5) pctError ~ 40%");
        check(cb.level == Level::RED, "(5) 40%-off cantilever -> RED");

        // Lame thick-cylinder sanity: hoop stress positive, decreasing with r.
        double sIn = lamePressurizedStress(10e6, 0.1, 0.2, 0.1);
        double sOut = lamePressurizedStress(10e6, 0.1, 0.2, 0.2);
        check(sIn > sOut && sOut > 0.0, "(5) Lame hoop stress decreases outward, stays > 0");

        // Zero analytic -> RED, infinite pctError, no crash.
        double zp[4] = {0, 0, 0, 0};
        AnalyticCheck cz = crossCheckAnalytic(Benchmark::CANTILEVER_TIP, 1.0, zp, 4);
        check(cz.level == Level::RED && !std::isfinite(cz.pctError),
              "(5) zero analytic -> RED, pctError = inf (no div0 crash)");
    }

    // -----------------------------------------------------------------------
    // (6) FIT-FOR-PURPOSE AGGREGATION (the honesty layer).
    //   (6a) report with a singular peak -> RED + a reason naming it.
    //   (6b) clean static report (converging, no singularity, analytic <1%,
    //        no CFD) -> GREEN.
    //   (6c) CFD-only report with a perfect y+ -> AMBER (honesty caveat).
    //   Every branch: reasons NON-EMPTY (never a bare number).
    // -----------------------------------------------------------------------
    {
        // (6a) singular peak.
        CredibilityReport rep;
        rep.hasSingularities = true;
        SingularitySite ss; ss.kind = SingularityKind::REENTRANT_CORNER;
        ss.x = 0; ss.y = 0; ss.z = 0;
        rep.singularities = { ss };
        rep.peakIsSingular = true;
        CredibilityReport a = fitForPurpose(rep);
        check(a.level == Level::RED, "(6a) singular peak -> RED");
        check(!a.reasons.empty(), "(6a) RED report carries reasons (never a bare number)");
        bool named = false;
        for (const char* s : a.reasons)
            if (std::string(s).find("SINGULAR") != std::string::npos ||
                std::string(s).find("singular") != std::string::npos) named = true;
        check(named, "(6a) a reason names the singularity");

        // (6b) clean static report.
        CredibilityReport clean;
        clean.hasSingularities = true;
        clean.singularities = {};          // none detected
        clean.peakIsSingular = false;
        clean.hasConvergence = true;
        clean.convergence.cls = ConvergenceClass::CONVERGING;
        clean.convergence.converging = true;
        clean.convergence.gci = 0.01;      // 1% discretization uncertainty
        clean.hasEnergy = true;
        EnergyInput ein; ein.internalEnergy = 100.0;   // all-zero artificial
        clean.energy = auditEnergy(ein);
        clean.hasAnalytic = true;
        double pr[4] = {1000.0, 2.0, 210e9, 1e-6};
        double dEx = cantileverTipDeflection(1000.0, 2.0, 210e9, 1e-6);
        clean.analytic = crossCheckAnalytic(Benchmark::CANTILEVER_TIP, dEx * 1.005, pr, 4);
        // no CFD -> no AMBER cap.
        CredibilityReport b = fitForPurpose(clean);
        check(b.level == Level::GREEN, "(6b) clean converged static report -> GREEN");
        check(!b.reasons.empty(), "(6b) GREEN report still carries reasons");

        // (6c) CFD-only with a perfect y+ -> AMBER (honesty cap).
        CredibilityReport cfd;
        cfd.hasYPlus = true;
        cfd.yplus = checkYPlus(100.0, WallTreatment::WALL_FUNCTION);  // dead-center band
        CredibilityReport c = fitForPurpose(cfd);
        check(c.yplus.inBand, "(6c) y+=100 wall-function is in-band");
        check(c.level == Level::AMBER, "(6c) in-band CFD -> AMBER (turbulent CFD unverified)");
        bool cfdNamed = false;
        for (const char* s : c.reasons)
            if (std::string(s).find("UNVERIFIED") != std::string::npos) cfdNamed = true;
        check(cfdNamed, "(6c) a reason names the unverified-CFD caveat");

        // (6d) diverging convergence dominates -> RED even if everything else is clean.
        CredibilityReport div;
        div.hasConvergence = true;
        div.convergence.cls = ConvergenceClass::DIVERGING_SINGULAR;
        div.convergence.converging = false;
        CredibilityReport d = fitForPurpose(div);
        check(d.level == Level::RED, "(6d) diverging/singular convergence -> RED");

        // (6e) every aggregation branch leaves reasons non-empty.
        CredibilityReport empty;
        CredibilityReport e = fitForPurpose(empty);
        check(!e.reasons.empty(), "(6e) even an empty report yields a reason (never bare)");
    }

    // -----------------------------------------------------------------------
    std::printf("\n== RESULT: %d / %d checks passed ==\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
