// forge/native/materials/materials_test.cpp
//
// Standalone validation gate for forge::native::materials — the process-aware
// anisotropic material database. Every fixture is deterministic and analytically
// verifiable (no solver dependency):
//   (1) an ISOTROPIC material entered as orthotropic is ROTATION-INVARIANT
//       (E_eff equal in every direction) -- the sanity anchor;
//   (2) FDM Z-loaded effective modulus & strength are 40-75% of the in-plane
//       value, with the strength knockdown harder than the stiffness knockdown;
//   (3) tensor rotation correctness: 0deg = identity (E1 unchanged), 90deg swaps
//       E1<->E2 (and ->E3), and the 45deg off-axis modulus matches the closed-form
//       orthotropic off-axis law 1/E_x(theta) for the CFRP lamina to 1e-6;
//   (4) a CFRP UD lamina returns E1~135 / E2~10 GPa on-axis (real UD ratio);
//   (5) a missing (material,process,orientation,post) combo -> confidence LOW +
//       coupon-test reason, while a present on-axis combo -> confidence HIGH.
//   plus: compliance symmetry/reciprocity, C*S = I across two invert paths, the
//   positive-definite verdict (good vs deliberately-bad record), Ti as-built vs
//   HIP scatter/strength, and the scatter band widening with k.
//
// HONESTY NOTE: every seeded value is NOMINAL / HANDBOOK-CLASS, NOT certified
// A/B-basis allowables; the off-axis modulus is a tensor-rotation PREDICTION
// (MEDIUM confidence). These tests assert that honesty (confidence flags + the
// coupon-test recommendation on missing combos).
//
// Build & run (also via test/native/run_native.sh):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/src/native/materials/Materials.cpp \
//       forge-kernel/test/native/materials/materials_test.cpp \
//       -o /tmp/materials_test && /tmp/materials_test

#include "forge/native/materials/Materials.hpp"

#include <cstdio>
#include <cmath>
#include <vector>
#include <cstdint>
#include <cstddef>
#include <limits>
#include <algorithm>
#include <string>
#include <array>

using namespace forge::native::materials;

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

// Closed-form orthotropic in-plane off-axis modulus (laminate transform), the
// independent analytic oracle for the Bond rotation about axis 3 (the 1-2 plane):
//   1/E_x(theta) = cos^4 t / E1 + sin^4 t / E2
//                  + (1/G12 - 2 nu12/E1) sin^2 t cos^2 t
static double offAxisModulus(double E1, double E2, double G12, double nu12, double theta) {
    const double c = std::cos(theta), s = std::sin(theta);
    const double c2 = c * c, s2 = s * s;
    return 1.0 / (c2 * c2 / E1 + s2 * s2 / E2
                  + (1.0 / G12 - 2.0 * nu12 / E1) * s2 * c2);
}

// A direction-cosine frame for a rotation by `theta` about axis 3 (the 1-2 plane),
// with the load axis = the rotated x. Row 0 = (cos,sin,0).
static std::array<double, 9> rot3(double theta) {
    const double c = std::cos(theta), s = std::sin(theta);
    return std::array<double, 9>{
         c,  s, 0,
        -s,  c, 0,
         0,  0, 1
    };
}

int main() {
    MaterialDB db;

    // =======================================================================
    // (0) Matrix primitives: C*S = I across the two invert paths.
    // =======================================================================
    {
        // CFRP record -> build its compliance/stiffness.
        const MatKey cfrpKey{Material::CFRP_UD_T700, Process::PREPREG_AUTOCLAVE,
                             BuildOrient::NA, PostProcess::NONE};
        const MaterialRecord* rec = db.exact(cfrpKey);
        check(rec != nullptr, "(0a) CFRP record present");

        ComplianceResult cr = buildCompliance(rec->C);
        check(cr.symmetric, "(0b) CFRP compliance symmetric (reciprocity)");
        check(cr.admissible, "(0c) CFRP thermodynamically admissible");
        check(cr.positiveDefinite, "(0d) CFRP compliance positive-definite");
        check(cr.ok, "(0e) CFRP constitutive verdict ok");

        // reciprocity identity: S(1,0) = -nu12/E1 and S(0,1) = -nu21/E2 must match.
        check(approx(cr.S.at(0, 1), cr.S.at(1, 0), 1e-12), "(0f) S symmetric to 1e-12");

        // C*S = I (C came from the symmetric solve).
        Mat6 prod = mul6(cr.C, cr.S);
        bool ident = true;
        for (int i = 0; i < 6; ++i)
            for (int j = 0; j < 6; ++j) {
                const double want = (i == j) ? 1.0 : 0.0;
                if (!approx(prod.at(i, j), want, 1e-9)) ident = false;
            }
        check(ident, "(0g) C*S = I to 1e-9 (symmetric-solve invert)");

        // Cross-check: the general Gauss-Jordan inverse agrees with the PD solve.
        Mat6 Cgen;
        check(invert6(cr.S, Cgen), "(0h) general invert6 succeeds");
        bool agree = true;
        for (int i = 0; i < 6; ++i)
            for (int j = 0; j < 6; ++j)
                if (!approx(Cgen.at(i, j), cr.C.at(i, j), 1e-6)) agree = false;
        check(agree, "(0i) Gauss-Jordan invert == symmetric-solve invert");
    }

    // =======================================================================
    // (1) ISOTROPIC-as-orthotropic -> rotation-invariant E_eff (the sanity anchor).
    //     Use the HIP'd Ti record (seeded isotropic). E_eff must be the same in
    //     every queried direction.
    // =======================================================================
    {
        const MatKey hip{Material::Ti6Al4V, Process::LPBF, BuildOrient::NA, PostProcess::HIP};
        const MaterialRecord* rec = db.exact(hip);
        check(rec != nullptr && rec->sym == Symmetry::ISOTROPIC, "(1a) HIP Ti record isotropic");

        EffectiveModuli e1 = db.getEffective(Material::Ti6Al4V, Process::LPBF,
                                             BuildOrient::NA, Vec3{1, 0, 0}, PostProcess::HIP);
        EffectiveModuli e2 = db.getEffective(Material::Ti6Al4V, Process::LPBF,
                                             BuildOrient::NA, Vec3{0, 1, 0}, PostProcess::HIP);
        EffectiveModuli e3 = db.getEffective(Material::Ti6Al4V, Process::LPBF,
                                             BuildOrient::NA, Vec3{1, 1, 1}, PostProcess::HIP);
        EffectiveModuli e4 = db.getEffective(Material::Ti6Al4V, Process::LPBF,
                                             BuildOrient::NA, Vec3{2, -1, 0.5}, PostProcess::HIP);
        check(e1.ok && e2.ok && e3.ok && e4.ok, "(1b) all isotropic queries ok");
        check(approx(e1.E_eff, e2.E_eff, 1e-9), "(1c) iso E_eff dir-x == dir-y");
        check(approx(e1.E_eff, e3.E_eff, 1e-9), "(1d) iso E_eff dir-x == dir-(1,1,1)");
        check(approx(e1.E_eff, e4.E_eff, 1e-9), "(1e) iso E_eff dir-x == dir-(2,-1,.5)");
        check(approx(e1.E_eff, 114.0e9, 1e-3), "(1f) iso E_eff ~ 114 GPa (seed)");
    }

    // =======================================================================
    // (2) FDM Z-loaded modulus & strength = 40-75% of in-plane; strength
    //     knockdown harder than stiffness knockdown (layer adhesion).
    // =======================================================================
    {
        // In-plane (axis 1 = XY) vs build (axis 3 = Z) on the ABS record.
        EffectiveModuli exy = db.getEffective(Material::ABS, Process::FDM_FFF,
                                              BuildOrient::XY_INPLANE, Vec3{1, 0, 0},
                                              PostProcess::AS_BUILT);
        EffectiveModuli ez = db.getEffective(Material::ABS, Process::FDM_FFF,
                                             BuildOrient::XY_INPLANE, Vec3{0, 0, 1},
                                             PostProcess::AS_BUILT);
        check(exy.ok && ez.ok, "(2a) ABS in-plane & Z queries ok");
        const double stiffRatio = ez.E_eff / exy.E_eff;
        check(stiffRatio >= 0.40 && stiffRatio <= 0.75,
              "(2b) ABS Z stiffness 40-75% of in-plane");

        // Strength via full query (projection along the load axis).
        const MatKey absKey{Material::ABS, Process::FDM_FFF, BuildOrient::XY_INPLANE,
                            PostProcess::AS_BUILT};
        PropertyQuery qxy = db.getProperties(absKey, Vec3{1, 0, 0});
        PropertyQuery qz  = db.getProperties(absKey, Vec3{0, 0, 1});
        check(qxy.ok && qz.ok, "(2c) ABS strength queries ok");
        const double strRatio = qz.strength_eff / qxy.strength_eff;
        check(strRatio >= 0.40 && strRatio <= 0.75, "(2d) ABS Z strength 40-75% of in-plane");
        check(strRatio < stiffRatio + 1e-9,
              "(2e) strength knockdown >= stiffness knockdown (adhesion hits strength harder)");

        // The in-plane axis-1 query is on a principal axis -> HIGH confidence.
        check(qxy.confidence == Confidence::HIGH, "(2f) ABS in-plane axis-1 -> HIGH confidence");
        // The Z (axis-3) query is also a principal axis -> HIGH.
        check(qz.confidence == Confidence::HIGH, "(2g) ABS Z axis-3 -> HIGH confidence");
    }

    // =======================================================================
    // (3) Tensor rotation: 0deg identity, 90deg axis swap, 45deg off-axis law.
    //     Use the CFRP lamina (transversely isotropic about fibre axis 1).
    // =======================================================================
    {
        const MatKey cfrpKey{Material::CFRP_UD_T700, Process::PREPREG_AUTOCLAVE,
                             BuildOrient::NA, PostProcess::NONE};
        const MaterialRecord* rec = db.exact(cfrpKey);
        const double E1 = rec->C.E1.mean, E2 = rec->C.E2.mean, E3 = rec->C.E3.mean;
        const double G12 = rec->C.G12.mean, nu12 = rec->C.nu12.mean;

        ComplianceResult cr = buildCompliance(rec->C);

        // 0deg: load along axis 1 -> E_eff == E1, rotated C' == C.
        {
            std::array<double, 9> a = rot3(0.0);
            Mat6 Sp = rotateCompliance(cr.S, a);
            check(approx(1.0 / Sp.at(0, 0), E1, 1e-9), "(3a) 0deg E_eff == E1");
            Mat6 Cp = rotateStiffness(cr.C, a);
            bool same = true;
            for (int i = 0; i < 6; ++i)
                for (int j = 0; j < 6; ++j)
                    if (!approx(Cp.at(i, j), cr.C.at(i, j), 1e-6)) same = false;
            check(same, "(3b) 0deg rotated stiffness == C (identity)");
        }

        // 90deg about axis 3: load axis -> axis 2, so E_eff == E2.
        {
            std::array<double, 9> a = rot3(M_PI / 2.0);
            Mat6 Sp = rotateCompliance(cr.S, a);
            check(approx(1.0 / Sp.at(0, 0), E2, 1e-7), "(3c) 90deg about z: E_eff == E2");
        }

        // load along axis 3 directly -> E_eff == E3.
        {
            std::array<double, 9> a = frameFromLoadDir(Vec3{0, 0, 1});
            Mat6 Sp = rotateCompliance(cr.S, a);
            check(approx(1.0 / Sp.at(0, 0), E3, 1e-7), "(3d) load axis-3: E_eff == E3");
        }

        // 45deg off-axis in the 1-2 plane: match the closed-form laminate law.
        {
            const double theta = M_PI / 4.0;
            std::array<double, 9> a = rot3(theta);
            Mat6 Sp = rotateCompliance(cr.S, a);
            const double Eeff = 1.0 / Sp.at(0, 0);
            const double Eclosed = offAxisModulus(E1, E2, G12, nu12, theta);
            check(approx(Eeff, Eclosed, 1e-6), "(3e) 45deg off-axis == closed-form law (1e-6)");

            // and via the public query the confidence is MEDIUM (off-axis).
            Vec3 ld{std::cos(theta), std::sin(theta), 0.0};
            PropertyQuery q = db.getProperties(cfrpKey, ld);
            check(q.ok, "(3f) 45deg CFRP query ok");
            check(approx(q.E_eff, Eclosed, 1e-6), "(3g) query E_eff == closed-form 45deg");
            check(q.confidence == Confidence::MEDIUM, "(3h) 45deg off-axis -> MEDIUM confidence");
            check(!q.couponTestRecommended, "(3i) off-axis exact record: no coupon flag");
        }
    }

    // =======================================================================
    // (4) CFRP on-axis: E1~135 GPa, E2~9.5 GPa, ratio in [10,20].
    // =======================================================================
    {
        const MatKey cfrpKey{Material::CFRP_UD_T700, Process::PREPREG_AUTOCLAVE,
                             BuildOrient::NA, PostProcess::NONE};
        const MaterialRecord* rec = db.exact(cfrpKey);
        const double E1 = rec->C.E1.mean, E2 = rec->C.E2.mean;
        check(approx(E1, 135.0e9, 1e-3), "(4a) CFRP E1 ~ 135 GPa");
        check(approx(E2, 9.5e9, 1e-3), "(4b) CFRP E2 ~ 9.5 GPa");
        const double ratio = E1 / E2;
        check(ratio >= 10.0 && ratio <= 20.0, "(4c) CFRP E1/E2 ratio in [10,20]");

        // On-axis query returns E1 and HIGH confidence.
        PropertyQuery q1 = db.getProperties(cfrpKey, Vec3{1, 0, 0});
        check(approx(q1.E_eff, E1, 1e-7), "(4d) on-axis query E_eff == E1");
        check(q1.confidence == Confidence::HIGH, "(4e) CFRP on-axis -> HIGH confidence");
        check(!q1.couponTestRecommended, "(4f) on-axis: no coupon flag");
    }

    // =======================================================================
    // (5) Missing combo -> LOW + coupon flag + reason naming the missing axis;
    //     present on-axis combo -> HIGH, no coupon flag.
    // =======================================================================
    {
        // Ti6Al4V LPBF ANGLE_45 ANNEAL is NOT seeded.
        const MatKey missing{Material::Ti6Al4V, Process::LPBF, BuildOrient::ANGLE_45,
                             PostProcess::ANNEAL};
        PropertyQuery q = db.getProperties(missing, Vec3{1, 0, 0});
        check(q.confidence == Confidence::LOW, "(5a) missing combo -> LOW confidence");
        check(q.couponTestRecommended, "(5b) missing combo -> couponTestRecommended");
        check(std::string(q.reason).size() > 0,
              "(5c) missing combo reason non-empty");
        check(std::string(q.reason).find("coupon") != std::string::npos,
              "(5d) reason recommends coupon test");
        // it still substituted a nearest Ti record (so ok==true, but LOW).
        check(q.ok, "(5e) nearest Ti record substituted (numbers labeled LOW)");

        // A material genuinely absent -> no fabrication. (Re-key onto a present
        // material to confirm the present path, then assert the present HIGH path.)
        const MatKey presentOnAxis{Material::PLA, Process::FDM_FFF, BuildOrient::XY_INPLANE,
                                   PostProcess::AS_BUILT};
        PropertyQuery qp = db.getProperties(presentOnAxis, Vec3{1, 0, 0});
        check(qp.confidence == Confidence::HIGH, "(5f) present on-axis -> HIGH confidence");
        check(!qp.couponTestRecommended, "(5g) present on-axis -> no coupon flag");
    }

    // =======================================================================
    // (6) Positive-definite verdict: a deliberately-bad record -> ok=false.
    // =======================================================================
    {
        OrthoConstants bad;
        // E1 < E2 with nu12 = 0.9 violates |nu12| < sqrt(E1/E2).
        bad.E1 = {10.0e9, 0}; bad.E2 = {200.0e9, 0}; bad.E3 = {200.0e9, 0};
        bad.G12 = {5.0e9, 0}; bad.G13 = {5.0e9, 0}; bad.G23 = {5.0e9, 0};
        bad.nu12 = {0.9, 0}; bad.nu13 = {0.3, 0}; bad.nu23 = {0.3, 0};
        ComplianceResult cr = buildCompliance(bad);
        check(!cr.admissible, "(6a) bad record: not admissible");
        check(!cr.ok, "(6b) bad record: verdict not ok");
        check(std::string(cr.reason).size() > 0, "(6c) bad record: reason given");

        // A valid record passes admissibility.
        const MatKey cfrpKey{Material::CFRP_UD_T700, Process::PREPREG_AUTOCLAVE,
                             BuildOrient::NA, PostProcess::NONE};
        ComplianceResult good = buildCompliance(db.exact(cfrpKey)->C);
        check(good.ok, "(6d) valid CFRP record: verdict ok");
    }

    // =======================================================================
    // (7) Ti as-built vs HIP: HIP has LOWER scatter (CV) and HIGHER strength mean.
    // =======================================================================
    {
        const MatKey ab{Material::Ti6Al4V, Process::LPBF, BuildOrient::Z_BUILD, PostProcess::AS_BUILT};
        const MatKey hip{Material::Ti6Al4V, Process::LPBF, BuildOrient::NA, PostProcess::HIP};
        const MaterialRecord* ra = db.exact(ab);
        const MaterialRecord* rh = db.exact(hip);
        check(ra && rh, "(7a) both Ti records present");

        const double cvE_ab = ra->C.E1.cv(), cvE_hip = rh->C.E1.cv();
        check(cvE_hip < cvE_ab, "(7b) HIP modulus CV < as-built CV");

        const double cvS_ab = ra->S.S1t.cv(), cvS_hip = rh->S.S1t.cv();
        check(cvS_hip < cvS_ab, "(7c) HIP strength CV < as-built CV");

        check(rh->S.S1t.mean > ra->S.S3t.mean,
              "(7d) HIP strength mean > as-built build-dir strength mean");
    }

    // =======================================================================
    // (8) Scatter band: band_lo < E_eff < band_hi, band widens with k, and the AM
    //     as-built band is relatively wider than the CFRP band.
    // =======================================================================
    {
        const MatKey absKey{Material::ABS, Process::FDM_FFF, BuildOrient::XY_INPLANE,
                            PostProcess::AS_BUILT};
        PropertyQuery q1 = db.getProperties(absKey, Vec3{1, 0, 0}, 1.0);
        PropertyQuery q2 = db.getProperties(absKey, Vec3{1, 0, 0}, 2.0);
        check(q1.band_lo < q1.E_eff && q1.E_eff < q1.band_hi, "(8a) band brackets E_eff");
        const double w1 = q1.band_hi - q1.band_lo;
        const double w2 = q2.band_hi - q2.band_lo;
        check(w2 > w1, "(8b) band widens with larger k");

        // relative band width: AM as-built (ABS) wider than CFRP.
        const MatKey cfrpKey{Material::CFRP_UD_T700, Process::PREPREG_AUTOCLAVE,
                             BuildOrient::NA, PostProcess::NONE};
        PropertyQuery qc = db.getProperties(cfrpKey, Vec3{1, 0, 0}, 2.0);
        const double relABS = (q2.band_hi - q2.band_lo) / q2.E_eff;
        const double relCFRP = (qc.band_hi - qc.band_lo) / qc.E_eff;
        check(relABS > relCFRP, "(8c) AM as-built relative band wider than CFRP");
    }

    // -----------------------------------------------------------------------
    std::printf("\n== RESULT: %d / %d checks passed ==\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
