// forge/native/materials/Materials.cpp
//
// Implementation of forge::native::materials — the process-aware anisotropic
// material database: orthotropic compliance/stiffness build with symmetry +
// positive-definite checks, Bond/tensor rotation of the 6x6 stiffness to an
// arbitrary load direction, the seeded handbook/nominal records (FDM ABS/PLA,
// CFRP UD lamina, Ti-6Al-4V LPBF as-built/HIP), and the getProperties/getEffective
// queries with scatter band + confidence/honesty flag.
// Pure C++20, standard library only. See Materials.hpp for the full scope note.
//
// HONESTY: all numeric seeds are NOMINAL / HANDBOOK-CLASS (typical published
// values), NOT certified A/B-basis allowables. Per-property std is a representative
// published CV, not a qualified allowables dispersion. Off-axis modulus and the
// strength projection are tensor-rotation PREDICTIONS (MEDIUM confidence). For any
// real design value, run a coupon test.

#include "forge/native/materials/Materials.hpp"

#include <cmath>
#include <cstdio>
#include <algorithm>
#include <vector>
#include <limits>
#include <cstddef>
#include <cstdint>
#include <array>
#include <string>

namespace forge {
namespace native {
namespace materials {

// ===========================================================================
// Vector math (self-contained).
// ===========================================================================
double dotV(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
Vec3   crossV(const Vec3& a, const Vec3& b) {
    return Vec3{ a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x };
}
double normV(const Vec3& a) { return std::sqrt(dotV(a, a)); }
Vec3   normalizeV(const Vec3& a) {
    const double n = normV(a);
    if (n <= std::numeric_limits<double>::min()) return Vec3{0.0, 0.0, 0.0};
    return Vec3{ a.x / n, a.y / n, a.z / n };
}

// ===========================================================================
// Scatter helpers.
// ===========================================================================
double Scatter::cv() const { return (mean != 0.0) ? std / mean : 0.0; }
void   Scatter::band(double k, double& lo, double& hi) const {
    lo = mean - k * std;
    hi = mean + k * std;
}

// ===========================================================================
// Keys.
// ===========================================================================
bool MatKey::operator==(const MatKey& r) const {
    return m == r.m && p == r.p && o == r.o && post == r.post;
}

// ===========================================================================
// 6x6 matrix ops.
// ===========================================================================
Mat6 identity6() {
    Mat6 I;
    for (int i = 0; i < 6; ++i) I.at(i, i) = 1.0;
    return I;
}
Mat6 mul6(const Mat6& A, const Mat6& B) {
    Mat6 C;
    for (int i = 0; i < 6; ++i)
        for (int j = 0; j < 6; ++j) {
            double s = 0.0;
            for (int k = 0; k < 6; ++k) s += A.at(i, k) * B.at(k, j);
            C.at(i, j) = s;
        }
    return C;
}
Mat6 transpose6(const Mat6& A) {
    Mat6 T;
    for (int i = 0; i < 6; ++i)
        for (int j = 0; j < 6; ++j) T.at(i, j) = A.at(j, i);
    return T;
}
bool isSymmetric6(const Mat6& A, double tol) {
    for (int i = 0; i < 6; ++i)
        for (int j = i + 1; j < 6; ++j) {
            const double d = std::fabs(A.at(i, j) - A.at(j, i));
            const double s = 1.0 + std::fabs(A.at(i, j)) + std::fabs(A.at(j, i));
            if (d > tol * s) return false;
        }
    return true;
}

// General 6x6 inverse via Gauss-Jordan with partial pivoting. Used by the rotated
// (full) tensor. Returns false on a (near-)singular matrix.
bool invert6(const Mat6& A, Mat6& out) {
    double m[6][12];
    for (int i = 0; i < 6; ++i) {
        for (int j = 0; j < 6; ++j) m[i][j] = A.at(i, j);
        for (int j = 0; j < 6; ++j) m[i][6 + j] = (i == j) ? 1.0 : 0.0;
    }
    for (int col = 0; col < 6; ++col) {
        // partial pivot
        int piv = col;
        double best = std::fabs(m[col][col]);
        for (int r = col + 1; r < 6; ++r) {
            if (std::fabs(m[r][col]) > best) { best = std::fabs(m[r][col]); piv = r; }
        }
        if (best <= 1e-300) return false;
        if (piv != col) for (int j = 0; j < 12; ++j) std::swap(m[col][j], m[piv][j]);
        const double d = m[col][col];
        for (int j = 0; j < 12; ++j) m[col][j] /= d;
        for (int r = 0; r < 6; ++r) {
            if (r == col) continue;
            const double f = m[r][col];
            if (f == 0.0) continue;
            for (int j = 0; j < 12; ++j) m[r][j] -= f * m[col][j];
        }
    }
    for (int i = 0; i < 6; ++i)
        for (int j = 0; j < 6; ++j) out.at(i, j) = m[i][6 + j];
    return true;
}

// Symmetric LDL^T factorization. Verdict ok iff A is symmetric positive-definite
// (all pivots D_i > 0). On success, out = A^-1 (the "small symmetric solve":
// L D L^T x = e_j column-by-column). This is the PD test used for the verdict.
bool solveSymPD(const Mat6& A, Mat6& out) {
    if (!isSymmetric6(A, 1e-9)) return false;
    double L[6][6] = {{0}};
    double D[6]    = {0};
    for (int j = 0; j < 6; ++j) {
        double sum = A.at(j, j);
        for (int k = 0; k < j; ++k) sum -= L[j][k] * L[j][k] * D[k];
        D[j] = sum;
        if (D[j] <= 0.0) return false;            // not positive-definite
        L[j][j] = 1.0;
        for (int i = j + 1; i < 6; ++i) {
            double s = A.at(i, j);
            for (int k = 0; k < j; ++k) s -= L[i][k] * L[j][k] * D[k];
            L[i][j] = s / D[j];
        }
    }
    // Invert column by column: solve A x = e_c.
    for (int c = 0; c < 6; ++c) {
        double e[6] = {0}; e[c] = 1.0;
        // forward: L y = e
        double y[6];
        for (int i = 0; i < 6; ++i) {
            double s = e[i];
            for (int k = 0; k < i; ++k) s -= L[i][k] * y[k];
            y[i] = s;
        }
        // diagonal: D z = y
        double z[6];
        for (int i = 0; i < 6; ++i) z[i] = y[i] / D[i];
        // backward: L^T x = z
        double x[6];
        for (int i = 5; i >= 0; --i) {
            double s = z[i];
            for (int k = i + 1; k < 6; ++k) s -= L[k][i] * x[k];
            x[i] = s;
        }
        for (int i = 0; i < 6; ++i) out.at(i, c) = x[i];
    }
    return true;
}

// ===========================================================================
// Compliance / stiffness build (Voigt 11,22,33,23,13,12).
// ===========================================================================
ComplianceResult buildCompliance(const OrthoConstants& c) {
    ComplianceResult r;
    const double E1 = c.E1.mean, E2 = c.E2.mean, E3 = c.E3.mean;
    const double G23 = c.G23.mean, G13 = c.G13.mean, G12 = c.G12.mean;
    const double nu12 = c.nu12.mean, nu13 = c.nu13.mean, nu23 = c.nu23.mean;

    // Admissibility: positive moduli.
    if (E1 <= 0 || E2 <= 0 || E3 <= 0 || G23 <= 0 || G13 <= 0 || G12 <= 0) {
        r.reason = "non-positive modulus (Ei or Gij <= 0)";
        return r;
    }
    // Reciprocity-derived minor Poisson ratios: nu_ji/Ej = nu_ij/Ei.
    const double nu21 = nu12 * E2 / E1;
    const double nu31 = nu13 * E3 / E1;
    const double nu32 = nu23 * E3 / E2;

    // Thermodynamic admissibility (orthotropic): |nu_ij| < sqrt(Ei/Ej) and the
    // determinant condition 1 - nu12 nu21 - nu23 nu32 - nu31 nu13 - 2 nu21 nu32 nu13 > 0.
    const bool boundOk =
        std::fabs(nu12) < std::sqrt(E1 / E2) &&
        std::fabs(nu13) < std::sqrt(E1 / E3) &&
        std::fabs(nu23) < std::sqrt(E2 / E3);
    const double det = 1.0 - nu12 * nu21 - nu23 * nu32 - nu31 * nu13
                       - 2.0 * nu21 * nu32 * nu13;
    if (!boundOk) { r.reason = "Poisson bound violated: |nu_ij| >= sqrt(Ei/Ej)"; }
    else if (det <= 0.0) { r.reason = "compliance determinant condition <= 0 (inadmissible)"; }
    r.admissible = boundOk && (det > 0.0);

    // Build the 6x6 compliance.
    Mat6& S = r.S;
    S.at(0,0) = 1.0 / E1;   S.at(0,1) = -nu21 / E2; S.at(0,2) = -nu31 / E3;
    S.at(1,0) = -nu12 / E1; S.at(1,1) = 1.0 / E2;   S.at(1,2) = -nu32 / E3;
    S.at(2,0) = -nu13 / E1; S.at(2,1) = -nu23 / E2; S.at(2,2) = 1.0 / E3;
    S.at(3,3) = 1.0 / G23;
    S.at(4,4) = 1.0 / G13;
    S.at(5,5) = 1.0 / G12;

    r.symmetric = isSymmetric6(S, 1e-9);

    // Positive-definite verdict via the symmetric solve (also yields C = S^-1).
    Mat6 Cpd;
    r.positiveDefinite = solveSymPD(S, Cpd);
    if (r.positiveDefinite) {
        r.C = Cpd;
    } else {
        // Fall back to the general inverse so C is still populated for inspection,
        // but the verdict stays "not PD".
        Mat6 Cgen;
        if (invert6(S, Cgen)) r.C = Cgen;
        if (r.reason[0] == '\0') r.reason = "compliance not positive-definite";
    }

    r.ok = r.symmetric && r.admissible && r.positiveDefinite;
    if (r.ok) r.reason = "";
    else if (r.reason[0] == '\0') r.reason = "constitutive validity check failed";
    return r;
}

// ===========================================================================
// Bond / tensor rotation.
//   `a` is the 3x3 direction-cosine matrix material->rotated (row-major a[3*i+j]).
//   a_ij = cos(angle between rotated axis i and material axis j).
//   Voigt order (1,2,3,4,5,6) = (11,22,33,23,13,12).
//   Bond stress-transform T_sigma maps material-frame stress (Voigt) to the
//   rotated frame. Standard Auld/Bond form.
// ===========================================================================
Mat6 bondStress(const std::array<double, 9>& a) {
    auto A = [&](int i, int j) { return a[3 * i + j]; };  // i,j in 0..2
    Mat6 T;
    // Upper-left 3x3 (normal-normal): T[i][j] = a_ij^2
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j)
            T.at(i, j) = A(i, j) * A(i, j);
    // Upper-right 3x3 (normal-shear): columns 4,5,6 = (23,13,12)
    for (int i = 0; i < 3; ++i) {
        T.at(i, 3) = 2.0 * A(i, 1) * A(i, 2);   // 23
        T.at(i, 4) = 2.0 * A(i, 2) * A(i, 0);   // 13
        T.at(i, 5) = 2.0 * A(i, 0) * A(i, 1);   // 12
    }
    // Lower-left 3x3 (shear-normal): rows 4,5,6
    for (int j = 0; j < 3; ++j) {
        // row 3 -> 23, row 4 -> 13, row 5 -> 12
        T.at(3, j) = A(1, j) * A(2, j);
        T.at(4, j) = A(2, j) * A(0, j);
        T.at(5, j) = A(0, j) * A(1, j);
    }
    // Lower-right 3x3 (shear-shear)
    // row 23 (3)
    T.at(3, 3) = A(1, 1) * A(2, 2) + A(1, 2) * A(2, 1);
    T.at(3, 4) = A(1, 2) * A(2, 0) + A(1, 0) * A(2, 2);
    T.at(3, 5) = A(1, 0) * A(2, 1) + A(1, 1) * A(2, 0);
    // row 13 (4)
    T.at(4, 3) = A(2, 1) * A(0, 2) + A(2, 2) * A(0, 1);
    T.at(4, 4) = A(2, 2) * A(0, 0) + A(2, 0) * A(0, 2);
    T.at(4, 5) = A(2, 0) * A(0, 1) + A(2, 1) * A(0, 0);
    // row 12 (5)
    T.at(5, 3) = A(0, 1) * A(1, 2) + A(0, 2) * A(1, 1);
    T.at(5, 4) = A(0, 2) * A(1, 0) + A(0, 0) * A(1, 2);
    T.at(5, 5) = A(0, 0) * A(1, 1) + A(0, 1) * A(1, 0);
    return T;
}

// Strain Bond transform: T_eps = (T_sigma^-1)^T. Equivalently the same Auld form
// with the factor-of-2 moved to the lower-left block. We build it from T_sigma
// directly via the standard relation to avoid re-deriving the 36 entries.
Mat6 bondStrain(const std::array<double, 9>& a) {
    Mat6 Ts = bondStress(a);
    Mat6 TsInv;
    if (!invert6(Ts, TsInv)) return identity6();
    return transpose6(TsInv);   // T_eps = (T_sigma^-1)^T
}

Mat6 rotateStiffness(const Mat6& C, const std::array<double, 9>& a) {
    // C' = T_sigma * C * T_sigma^T  (Auld). With T_eps = (T_sigma^-1)^T this is the
    // proper congruence that preserves isotropy and matches the closed-form law.
    Mat6 Ts = bondStress(a);
    return mul6(mul6(Ts, C), transpose6(Ts));
}

Mat6 rotateCompliance(const Mat6& S, const std::array<double, 9>& a) {
    // S' = T_eps * S * T_eps^T  (Auld). Equals (T_sigma^-1)^T S (T_sigma^-1).
    Mat6 Te = bondStrain(a);
    return mul6(mul6(Te, S), transpose6(Te));
}

// Orthonormal frame: first axis = normalized loadDir; remaining axes via a stable
// Gram-Schmidt against the least-aligned cardinal axis. Returns the direction-
// cosine matrix material->load (row i = the i-th rotated axis expressed in the
// material basis), row-major a[3*i+j].
std::array<double, 9> frameFromLoadDir(const Vec3& loadDir) {
    Vec3 e1 = normalizeV(loadDir);
    if (normV(e1) == 0.0) e1 = Vec3{1.0, 0.0, 0.0};   // degenerate -> material axis 1
    // pick the cardinal axis least aligned with e1 as the seed
    const double ax = std::fabs(e1.x), ay = std::fabs(e1.y), az = std::fabs(e1.z);
    Vec3 seed = (ax <= ay && ax <= az) ? Vec3{1, 0, 0}
              : (ay <= az)             ? Vec3{0, 1, 0}
                                       : Vec3{0, 0, 1};
    // e2 = normalize(seed - (seed.e1) e1)
    const double d = dotV(seed, e1);
    Vec3 e2 = normalizeV(Vec3{ seed.x - d * e1.x, seed.y - d * e1.y, seed.z - d * e1.z });
    Vec3 e3 = crossV(e1, e2);
    return std::array<double, 9>{
        e1.x, e1.y, e1.z,
        e2.x, e2.y, e2.z,
        e3.x, e3.y, e3.z
    };
}

// ===========================================================================
// Strengths helper: a first-order directional projection of the axial ultimates.
//   Given the rotated-frame load axis expressed in material coords (a row 0),
//   weight the axis tensile ultimates by the squared direction cosines. This is a
//   PREDICTION, NOT a Tsai-Wu failure index (that quadratic criterion is the
//   noted follow-up). Tensile vs compressive picked by sign convention = tensile.
// ===========================================================================
static double projectStrength(const Strengths& S, const std::array<double, 9>& a) {
    const double l = a[0], m = a[1], n = a[2];   // load axis cosines in material frame
    const double w1 = l * l, w2 = m * m, w3 = n * n;
    // Reuss-like (compliance-weighted) projection of the directional tensile
    // ultimates: 1/Seff = w1/S1t + w2/S2t + w3/S3t  (so the WEAKEST axis dominates,
    // which is the conservative, honest first-order estimate).
    const double s1 = S.S1t.mean, s2 = S.S2t.mean, s3 = S.S3t.mean;
    double inv = 0.0;
    if (s1 > 0) inv += w1 / s1;
    if (s2 > 0) inv += w2 / s2;
    if (s3 > 0) inv += w3 / s3;
    return (inv > 0.0) ? 1.0 / inv : 0.0;
}

// E_eff for a given mean-valued OrthoConstants + load frame (used for band props).
static bool effModulusFor(const OrthoConstants& c, const std::array<double, 9>& a,
                          EffectiveModuli& out) {
    ComplianceResult cr = buildCompliance(c);
    if (!cr.symmetric) return false;             // require a sane (symmetric) S
    Mat6 Sp = rotateCompliance(cr.S, a);
    if (Sp.at(0, 0) <= 0.0) return false;
    out.E_eff = 1.0 / Sp.at(0, 0);
    out.G_eff = (Sp.at(5, 5) != 0.0) ? 1.0 / Sp.at(5, 5) : 0.0;
    out.nu_eff = (Sp.at(0, 0) != 0.0) ? -Sp.at(1, 0) / Sp.at(0, 0) : 0.0;
    out.ok = true;
    return true;
}

// ===========================================================================
// Seed records (§4) — REAL handbook/nominal values, labeled.
// ===========================================================================
namespace {

// Transversely-isotropic helper: fill E2==E3, G12==G13, nu12==nu13, and derive
// G23 = E2 / (2(1+nu23)). All inputs in SI (Pa, dimensionless), with CV applied
// uniformly to give a representative std on every constant.
OrthoConstants transIso(double E_axial, double E_trans, double G_axial,
                        double nu_axial, double nu_trans,
                        double cvE, double cvG, double cvNu) {
    OrthoConstants c;
    const double G23 = E_trans / (2.0 * (1.0 + nu_trans));
    c.E1 = {E_axial, cvE * E_axial};
    c.E2 = {E_trans, cvE * E_trans};
    c.E3 = {E_trans, cvE * E_trans};
    c.G12 = {G_axial, cvG * G_axial};
    c.G13 = {G_axial, cvG * G_axial};
    c.G23 = {G23, cvG * G23};
    c.nu12 = {nu_axial, cvNu * nu_axial};
    c.nu13 = {nu_axial, cvNu * nu_axial};
    c.nu23 = {nu_trans, cvNu * nu_trans};
    return c;
}

Scatter sc(double mean, double cv) { return Scatter{mean, cv * mean}; }

} // namespace

MaterialDB::MaterialDB() {
    const double GPa = 1.0e9, MPa = 1.0e6;

    // -----------------------------------------------------------------------
    // (1) FDM ABS — XY in-plane vs Z build (as-built). Layer-adhesion-limited:
    //     E_z ~ 0.55*E_xy, S_z ~ 0.45*S_xy (representative knockdown band 40-75%).
    //     E_xy ~ 2.1 GPa, nu ~ 0.35. Source: published FFF-ABS literature (nominal).
    // -----------------------------------------------------------------------
    {
        const double Exy = 2.1 * GPa, Ez = 0.55 * Exy;
        const double nu = 0.35, G = Exy / (2.0 * (1.0 + nu));
        OrthoConstants c;
        const double cvE = 0.08, cvG = 0.08, cvNu = 0.05;
        c.E1 = sc(Exy, cvE); c.E2 = sc(Exy, cvE); c.E3 = sc(Ez, cvE);   // axis 3 = Z (build)
        c.G12 = sc(G, cvG);  c.G13 = sc(0.55 * G, cvG); c.G23 = sc(0.55 * G, cvG);
        c.nu12 = sc(nu, cvNu); c.nu13 = sc(nu, cvNu); c.nu23 = sc(nu, cvNu);
        Strengths s;
        const double Sxy = 38.0 * MPa, Sz = 0.45 * Sxy;
        s.S1t = sc(Sxy, 0.12); s.S1c = sc(1.5 * Sxy, 0.12);
        s.S2t = sc(Sxy, 0.12); s.S2c = sc(1.5 * Sxy, 0.12);
        s.S3t = sc(Sz, 0.15);  s.S3c = sc(1.5 * Sz, 0.15);              // Z weaker
        s.S12 = sc(0.5 * Sxy, 0.12); s.S13 = sc(0.5 * Sz, 0.15); s.S23 = sc(0.5 * Sz, 0.15);
        records_.push_back({
            MatKey{Material::ABS, Process::FDM_FFF, BuildOrient::XY_INPLANE, PostProcess::AS_BUILT},
            Symmetry::TRANSVERSELY_ISOTROPIC, c, s, 1040.0,
            "FDM ABS, published FFF literature typ (nominal) -- NOT certified A/B-basis; coupon test for design",
            "Z-build knockdown ~55% stiffness / ~45% strength of in-plane (layer adhesion limited)"
        });
    }

    // -----------------------------------------------------------------------
    // (2) FDM PLA — XY vs Z (as-built). E_xy ~ 3.5 GPa, Z knockdown ~60%.
    // -----------------------------------------------------------------------
    {
        const double Exy = 3.5 * GPa, Ez = 0.60 * Exy;
        const double nu = 0.33, G = Exy / (2.0 * (1.0 + nu));
        OrthoConstants c;
        const double cvE = 0.07, cvG = 0.07, cvNu = 0.05;
        c.E1 = sc(Exy, cvE); c.E2 = sc(Exy, cvE); c.E3 = sc(Ez, cvE);
        c.G12 = sc(G, cvG);  c.G13 = sc(0.60 * G, cvG); c.G23 = sc(0.60 * G, cvG);
        c.nu12 = sc(nu, cvNu); c.nu13 = sc(nu, cvNu); c.nu23 = sc(nu, cvNu);
        Strengths s;
        const double Sxy = 55.0 * MPa, Sz = 0.50 * Sxy;
        s.S1t = sc(Sxy, 0.10); s.S1c = sc(1.6 * Sxy, 0.10);
        s.S2t = sc(Sxy, 0.10); s.S2c = sc(1.6 * Sxy, 0.10);
        s.S3t = sc(Sz, 0.13);  s.S3c = sc(1.6 * Sz, 0.13);
        s.S12 = sc(0.5 * Sxy, 0.10); s.S13 = sc(0.5 * Sz, 0.13); s.S23 = sc(0.5 * Sz, 0.13);
        records_.push_back({
            MatKey{Material::PLA, Process::FDM_FFF, BuildOrient::XY_INPLANE, PostProcess::AS_BUILT},
            Symmetry::TRANSVERSELY_ISOTROPIC, c, s, 1240.0,
            "FDM PLA, published FFF literature typ (nominal) -- NOT certified A/B-basis; coupon test for design",
            "Z-build knockdown ~60% stiffness / ~50% strength of in-plane"
        });
    }

    // -----------------------------------------------------------------------
    // (3) CFRP UD lamina (T700/M21), prepreg/autoclave. Transversely isotropic
    //     about the FIBRE axis (= axis 1). Handbook nominal (Hexcel/Toray data
    //     sheets / ESDU; same numbers as frontend compositesMath.js):
    //       E1=135, E2=E3=9.5, G12=G13=4.5 GPa, nu12=nu13=0.31, nu23=0.45
    //       => G23 = E2/(2(1+nu23)) ~ 3.28 GPa.
    //       Xt=2100, Xc=1200, Yt=60, Yc=250, S12=90 MPa.
    // -----------------------------------------------------------------------
    {
        OrthoConstants c = transIso(135.0 * GPa, 9.5 * GPa, 4.5 * GPa,
                                    0.31, 0.45, /*cvE*/0.04, /*cvG*/0.05, /*cvNu*/0.05);
        Strengths s;
        s.S1t = sc(2100.0 * MPa, 0.08); s.S1c = sc(1200.0 * MPa, 0.10);
        s.S2t = sc(60.0 * MPa, 0.10);   s.S2c = sc(250.0 * MPa, 0.10);
        s.S3t = sc(60.0 * MPa, 0.10);   s.S3c = sc(250.0 * MPa, 0.10);
        s.S12 = sc(90.0 * MPa, 0.08);   s.S13 = sc(90.0 * MPa, 0.08);
        s.S23 = sc(50.0 * MPa, 0.10);
        records_.push_back({
            MatKey{Material::CFRP_UD_T700, Process::PREPREG_AUTOCLAVE, BuildOrient::NA, PostProcess::NONE},
            Symmetry::TRANSVERSELY_ISOTROPIC, c, s, 1580.0,
            "CFRP UD T700/M21, Hexcel/Toray data-sheet + ESDU typ (nominal) -- NOT certified A/B-basis; coupon test for design",
            "transversely isotropic about fibre axis 1; E1/E2 ~ 14 (real UD ratio)"
        });
    }

    // -----------------------------------------------------------------------
    // (4) Ti-6Al-4V LPBF as-built. Mild transverse isotropy: E_z ~ 112 GPa vs
    //     E_xy ~ 118 GPa; HIGHER scatter; as-built strength carries surface/
    //     porosity penalty (~870 MPa UTS-class). Build dir = axis 3 = Z.
    // -----------------------------------------------------------------------
    {
        const double Exy = 118.0 * GPa, Ez = 112.0 * GPa, nu = 0.34;
        const double G = Exy / (2.0 * (1.0 + nu));
        OrthoConstants c;
        const double cvE = 0.06, cvG = 0.06, cvNu = 0.05;   // as-built: higher CV
        c.E1 = sc(Exy, cvE); c.E2 = sc(Exy, cvE); c.E3 = sc(Ez, cvE);
        c.G12 = sc(G, cvG);  c.G13 = sc(0.95 * G, cvG); c.G23 = sc(0.95 * G, cvG);
        c.nu12 = sc(nu, cvNu); c.nu13 = sc(nu, cvNu); c.nu23 = sc(nu, cvNu);
        Strengths s;
        const double Sxy = 950.0 * MPa, Sz = 870.0 * MPa;   // as-built, with penalty
        s.S1t = sc(Sxy, 0.12); s.S1c = sc(1.05 * Sxy, 0.12);
        s.S2t = sc(Sxy, 0.12); s.S2c = sc(1.05 * Sxy, 0.12);
        s.S3t = sc(Sz, 0.14);  s.S3c = sc(1.05 * Sz, 0.14);
        s.S12 = sc(0.58 * Sxy, 0.12); s.S13 = sc(0.55 * Sz, 0.14); s.S23 = sc(0.55 * Sz, 0.14);
        records_.push_back({
            MatKey{Material::Ti6Al4V, Process::LPBF, BuildOrient::Z_BUILD, PostProcess::AS_BUILT},
            Symmetry::TRANSVERSELY_ISOTROPIC, c, s, 4430.0,
            "Ti-6Al-4V LPBF as-built, published AM literature typ (nominal) -- NOT certified A/B-basis; coupon test for design",
            "mild transverse isotropy (E_z<E_xy); as-built porosity/surface penalty; HIGHER scatter than HIP"
        });
    }

    // -----------------------------------------------------------------------
    // (5) Ti-6Al-4V LPBF + HIP. Porosity closed -> near-isotropic, E ~ 114 GPa,
    //     nu ~ 0.34, strength recovered toward wrought (~930 MPa UTS-class),
    //     LOWER scatter than as-built. Demonstrates the post-process axis.
    // -----------------------------------------------------------------------
    {
        const double E = 114.0 * GPa, nu = 0.34, G = E / (2.0 * (1.0 + nu));
        OrthoConstants c;
        const double cvE = 0.03, cvG = 0.03, cvNu = 0.04;   // HIP: LOWER CV
        c.E1 = sc(E, cvE); c.E2 = sc(E, cvE); c.E3 = sc(E, cvE);
        c.G12 = sc(G, cvG); c.G13 = sc(G, cvG); c.G23 = sc(G, cvG);
        c.nu12 = sc(nu, cvNu); c.nu13 = sc(nu, cvNu); c.nu23 = sc(nu, cvNu);
        Strengths s;
        const double Sult = 930.0 * MPa;                    // recovered, isotropic
        s.S1t = sc(Sult, 0.06); s.S1c = sc(1.05 * Sult, 0.06);
        s.S2t = sc(Sult, 0.06); s.S2c = sc(1.05 * Sult, 0.06);
        s.S3t = sc(Sult, 0.06); s.S3c = sc(1.05 * Sult, 0.06);
        s.S12 = sc(0.58 * Sult, 0.06); s.S13 = sc(0.58 * Sult, 0.06); s.S23 = sc(0.58 * Sult, 0.06);
        records_.push_back({
            MatKey{Material::Ti6Al4V, Process::LPBF, BuildOrient::NA, PostProcess::HIP},
            Symmetry::ISOTROPIC, c, s, 4430.0,
            "Ti-6Al-4V LPBF + HIP, published AM literature typ (nominal) -- NOT certified A/B-basis; coupon test for design",
            "HIP closes porosity -> near-isotropic, strength recovered toward wrought, LOWER scatter than as-built"
        });
    }
}

// ===========================================================================
// Lookup.
// ===========================================================================
const MaterialRecord* MaterialDB::exact(const MatKey& key) const {
    for (const auto& r : records_)
        if (r.key == key) return &r;
    return nullptr;
}

// Nearest record relaxing key axes in priority order: post -> orientation ->
// process. Material MUST match (no cross-material fabrication). Names the axis
// that was substituted in `missingAxis`.
const MaterialRecord* MaterialDB::nearest(const MatKey& key, const char*& missingAxis) const {
    // 1) relax post-process only.
    for (const auto& r : records_)
        if (r.key.m == key.m && r.key.p == key.p && r.key.o == key.o && r.key.post != key.post) {
            missingAxis = "post-process"; return &r;
        }
    // 2) relax orientation (+/- post).
    for (const auto& r : records_)
        if (r.key.m == key.m && r.key.p == key.p && r.key.o != key.o) {
            missingAxis = "build-orientation"; return &r;
        }
    // 3) relax process (same material).
    for (const auto& r : records_)
        if (r.key.m == key.m && r.key.p != key.p) {
            missingAxis = "process"; return &r;
        }
    missingAxis = "material/process";
    return nullptr;
}

// ===========================================================================
// getEffective — rotated moduli along loadDir for an exact key (no confidence).
// ===========================================================================
EffectiveModuli MaterialDB::getEffective(Material m, Process p, BuildOrient o,
                                         const Vec3& loadDir, PostProcess post) const {
    EffectiveModuli out;
    const MaterialRecord* rec = exact(MatKey{m, p, o, post});
    if (!rec) return out;   // ok stays false
    const std::array<double, 9> a = frameFromLoadDir(loadDir);
    effModulusFor(rec->C, a, out);
    return out;
}

// ===========================================================================
// getProperties — the full honest query with scatter band + confidence flag.
// ===========================================================================
PropertyQuery MaterialDB::getProperties(const MatKey& key, const Vec3& loadDir,
                                        double k) const {
    PropertyQuery q;
    q.k = k;

    const MaterialRecord* rec = exact(key);
    Confidence conf = Confidence::HIGH;
    std::string reasonBuf;          // local scratch builder; copied into q.reason (owned)

    if (!rec) {
        // No exact combo — fall back to nearest on fewer key axes.
        const char* missing = "";
        rec = nearest(key, missing);
        conf = Confidence::LOW;
        if (!rec) {
            reasonBuf = "material/process not in nominal DB; recommend coupon test";
            std::snprintf(q.reason, sizeof q.reason, "%s", reasonBuf.c_str());
            q.confidence = Confidence::LOW;
            q.couponTestRecommended = true;
            q.ok = false;            // do NOT fabricate numbers
            return q;
        }
        reasonBuf = std::string("no exact record for requested ") + missing
                  + "; nearest record substituted -- extrapolated; recommend coupon test";
    }

    // Build the load frame and check whether loadDir is along a principal axis.
    const std::array<double, 9> a = frameFromLoadDir(loadDir);
    const Vec3 ld = normalizeV(loadDir);
    const double ax = std::fabs(ld.x), ay = std::fabs(ld.y), az = std::fabs(ld.z);
    const bool onAxis = (std::fabs(ax - 1.0) < 1e-6) ||
                        (std::fabs(ay - 1.0) < 1e-6) ||
                        (std::fabs(az - 1.0) < 1e-6);

    ComplianceResult cr = buildCompliance(rec->C);
    if (!cr.symmetric) {
        reasonBuf = "record compliance failed symmetry/build; recommend coupon test";
        std::snprintf(q.reason, sizeof q.reason, "%s", reasonBuf.c_str());
        q.confidence = Confidence::LOW;
        q.couponTestRecommended = true;
        q.ok = false;
        return q;
    }

    // Effective moduli at the mean.
    EffectiveModuli em;
    effModulusFor(rec->C, a, em);
    q.E_eff = em.E_eff;
    q.G_eff = em.G_eff;
    q.nu_eff = em.nu_eff;
    q.strength_eff = projectStrength(rec->S, a);

    // Scatter band on E_eff: re-evaluate §5 at mean +/- k*std of the DOMINANT
    // constant along the load axis. For an on-axis load that constant is the axis
    // modulus; first-order, we perturb whichever Ei dominates 1/S'_11. Practically
    // we perturb E1,E2,E3 together by the same relative k*CV envelope (first-order,
    // labeled) which gives a clean monotone band.
    {
        auto perturbed = [&](double sign) {
            OrthoConstants cp = rec->C;
            cp.E1.mean += sign * k * rec->C.E1.std;
            cp.E2.mean += sign * k * rec->C.E2.std;
            cp.E3.mean += sign * k * rec->C.E3.std;
            cp.G12.mean += sign * k * rec->C.G12.std;
            cp.G13.mean += sign * k * rec->C.G13.std;
            cp.G23.mean += sign * k * rec->C.G23.std;
            EffectiveModuli e;
            if (!effModulusFor(cp, a, e)) return q.E_eff;
            return e.E_eff;
        };
        const double lo = perturbed(-1.0);
        const double hi = perturbed(+1.0);
        q.band_lo = std::min(lo, hi);
        q.band_hi = std::max(lo, hi);
    }

    // Confidence verdict.
    if (conf == Confidence::LOW) {
        q.confidence = Confidence::LOW;
        q.couponTestRecommended = true;
        std::snprintf(q.reason, sizeof q.reason, "%s", reasonBuf.c_str());
    } else if (!onAxis) {
        q.confidence = Confidence::MEDIUM;
        q.couponTestRecommended = false;
        reasonBuf = "exact record; off-axis modulus is a tensor-rotation interpolation "
                    "between measured principal-axis values (prediction, not a coupon)";
        std::snprintf(q.reason, sizeof q.reason, "%s", reasonBuf.c_str());
    } else {
        q.confidence = Confidence::HIGH;
        q.couponTestRecommended = false;
        reasonBuf = std::string("exact record, on principal material axis -- direct "
                                "handbook value (nominal). Provenance: ") + rec->provenance;
        std::snprintf(q.reason, sizeof q.reason, "%s", reasonBuf.c_str());
    }
    q.ok = true;
    return q;
}

} // namespace materials
} // namespace native
} // namespace forge
