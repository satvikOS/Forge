// forge/native/materials/Materials.hpp
//
// In-house PROCESS-AWARE ANISOTROPIC MATERIAL DATABASE — forge::native::materials.
//
// WHY THIS EXISTS (the honesty layer, per Forge Engineering Bible §0/§9):
//   CAD hands an engineer a SINGLE isotropic {E, sigma} per material. For
//   additively-manufactured (FDM/LPBF) and composite (CFRP) parts that number is
//   a fiction: the stiffness and strength are PROCESS-dependent AND ORIENTATION-
//   dependent, with real run-to-run SCATTER. An FDM part loaded along the build
//   (Z) direction can be 40-75% as stiff/strong as in-plane because the answer is
//   layer-adhesion-limited, not bulk-polymer-limited. A unidirectional CFRP lamina
//   is ~14x stiffer along the fibre than across it. A Ti-6Al-4V LPBF coupon is
//   mildly transversely isotropic AS-BUILT and recovers toward isotropic after HIP.
//   Reporting one isotropic E/sigma for any of these is the single most common
//   AM/composite design error.
//
//   This module is the honest replacement: MATERIAL RECORDS keyed on the full
//   tuple (material, process, buildOrientation, postProcess), each storing the
//   orthotropic / transversely-isotropic ELASTIC constants AND directional
//   STRENGTHS as a SCATTER (mean + std), not a single number. The query API builds
//   the 6x6 compliance/stiffness, ROTATES the stiffness tensor (Bond transform) to
//   an arbitrary load direction, and returns the effective modulus along that
//   direction WITH a scatter band and a CONFIDENCE/HONESTY flag.
//
//   THE NAMED HONESTY FEATURE (the confidence flag):
//     * HIGH   — exact (material,process,orientation,post) record present AND the
//                load direction is along a measured principal material axis. A
//                direct handbook value, no rotation extrapolation.
//     * MEDIUM — exact record present but the load direction is OFF-AXIS. The
//                off-axis modulus is a tensor-rotation PREDICTION between measured
//                principal-axis values, not a measured coupon.
//     * LOW    — the requested combo is NOT in the DB (we fell back on the nearest
//                record on fewer key axes, or nothing matched). couponTestRecommended
//                is set and the reason NAMES which key axis was missing/substituted.
//
// HONESTY NOTE (NO fabricated certified allowables):
//   Every numeric value here is NOMINAL / HANDBOOK-CLASS design data — typical
//   published values (MMPDS / ASM Handbook, public Hexcel/Toray UD-prepreg data
//   sheets / ESDU, and published AM-process literature). They are NOT certified
//   statistical material allowables: there is NO A-basis / B-basis here. The
//   per-property `std` is a REPRESENTATIVE coefficient-of-variation from the
//   literature (AM ~5-10% CV on modulus, ~8-15% on strength; CFRP ~3-5% on
//   modulus, ~6-10% on strength), NOT a qualified allowables dispersion. For any
//   real design value, run a COUPON TEST. Every record carries that caveat in its
//   `note`/`provenance`, and the off-axis modulus + strength projection are
//   surfaced as predictions (MEDIUM), never HIGH.
//
// SCOPE / FOLLOW-UPS (noted, deliberately NOT stubbed):
//   (a) ORIENTATION-AWARE FEA WIRING — feeding the rotated stiffness C' into the
//       element constitutive matrix of forge::fea::tet / forge::Fea (currently
//       isotropic {E,nu,rho}). That is a cross-namespace change on the OCCT/Eigen
//       side and is the explicit follow-up; this module produces the C' it needs.
//   (b) FULL TSAI-WU / TSAI-HILL directional FAILURE INDEX. Here strength_eff is a
//       first-order directional PROJECTION of the axial ultimates, not a quadratic
//       failure-criterion evaluation. A 2D Tsai-Wu already exists in JS
//       (frontend/src/forge-v4/compositesMath.js); the 3D native version is queued.
//   (c) TEMPERATURE-DEPENDENT properties and true A/B-basis statistical allowables.
//
// CONVENTIONS: pure C++20, standard library only (no OCCT, no Eigen, no WASM, no
// third-party libs). Mirrors forge/native/{gdt,tolstack,vvuq}: a minimal
// self-contained local Vec3 so there is NO cross-class link dependency (the
// production FEA Material pulls OCCT+Eigen and cannot link into the dependency-free
// native gate). Voigt order is (11,22,33,23,13,12) throughout. SI units: Pa for
// moduli/strengths, kg/m^3 for density, radians for angles, Poisson dimensionless.

#ifndef FORGE_NATIVE_MATERIALS_MATERIALS_HPP
#define FORGE_NATIVE_MATERIALS_MATERIALS_HPP

#include <vector>
#include <cstddef>
#include <cstdint>
#include <array>

namespace forge {
namespace native {
namespace materials {

// ---------------------------------------------------------------------------
// Self-contained minimal vector (gdt/tolstack/vvuq convention — no coupling).
// ---------------------------------------------------------------------------
struct Vec3 {
    double x{0.0};
    double y{0.0};
    double z{0.0};
};
double dotV(const Vec3& a, const Vec3& b);
Vec3   crossV(const Vec3& a, const Vec3& b);
double normV(const Vec3& a);
Vec3   normalizeV(const Vec3& a);   // returns {0,0,0} for a (near-)zero vector

// ---------------------------------------------------------------------------
// Scatter: a property's mean + dispersion. Means carry the handbook value (SI);
// std is the absolute std-dev (SI) from a representative published CV. std==0
// means "no scatter data" (treated as a point value, band collapses to mean).
// ---------------------------------------------------------------------------
struct Scatter {
    double mean {0.0};
    double std  {0.0};
    double cv() const;                         // std/mean (0 if mean==0)
    void   band(double k, double& lo, double& hi) const;   // mean -/+ k*std
};

// ---------------------------------------------------------------------------
// Keys: the (material, process, buildOrientation, postProcess) tuple.
// ---------------------------------------------------------------------------
enum class Material    { ABS, PLA, CFRP_UD_T700, Ti6Al4V };
enum class Process     { FDM_FFF, LPBF, WROUGHT, PREPREG_AUTOCLAVE };
enum class BuildOrient { XY_INPLANE, Z_BUILD, ANGLE_45, NA };
enum class PostProcess { NONE, AS_BUILT, HIP, ANNEAL, NA };

struct MatKey {
    Material    m   {Material::ABS};
    Process     p   {Process::FDM_FFF};
    BuildOrient o   {BuildOrient::XY_INPLANE};
    PostProcess post{PostProcess::AS_BUILT};
    bool operator==(const MatKey& r) const;
};

// ---------------------------------------------------------------------------
// Symmetry class + the engineering-constant record.
//   Voigt order (1,2,3) = principal material axes. For a UD CFRP, axis 1 = fibre.
//   For an AM transversely-isotropic record: in-plane = (1,2) = build-plate XY,
//   build direction = axis 3 = Z (so E1==E2==E_xy, E3==E_z, with the Z knockdown
//   encoded as E3.mean < E1.mean).
// ---------------------------------------------------------------------------
enum class Symmetry { ISOTROPIC, TRANSVERSELY_ISOTROPIC, ORTHOTROPIC };

struct OrthoConstants {
    Scatter E1, E2, E3;        // Pa
    Scatter G12, G13, G23;     // Pa
    Scatter nu12, nu13, nu23;  // dimensionless (major Poisson, nu_ij with Ei>=Ej)
};

struct Strengths {
    Scatter S1t, S1c;          // axis-1 tensile / compressive ultimate (Pa)
    Scatter S2t, S2c;          // axis-2 tensile / compressive (Pa)
    Scatter S3t, S3c;          // axis-3 tensile / compressive (Pa)
    Scatter S12, S13, S23;     // in-plane / interlaminar shear ultimates (Pa)
};

struct MaterialRecord {
    MatKey         key;
    Symmetry       sym {Symmetry::ORTHOTROPIC};
    OrthoConstants C;
    Strengths      S;
    double         density {0.0};        // kg/m^3
    const char*    provenance {""};      // source + "nominal / not certified"
    const char*    note {""};            // per-record honesty caveat
};

// ---------------------------------------------------------------------------
// 6x6 matrix in row-major flat storage (Voigt). Small, fixed-size, value type.
// ---------------------------------------------------------------------------
struct Mat6 {
    std::array<double, 36> a {};   // row-major: a[6*i + j]
    double  at(int i, int j) const { return a[6 * i + j]; }
    double& at(int i, int j)       { return a[6 * i + j]; }
};

Mat6 mul6(const Mat6& A, const Mat6& B);              // A*B
Mat6 transpose6(const Mat6& A);
Mat6 identity6();
bool isSymmetric6(const Mat6& A, double tol);
bool invert6(const Mat6& A, Mat6& out);               // general Gauss-Jordan, partial pivot
// LDL^T (symmetric) factor + verdict: ok iff A is symmetric positive-definite.
// On success `out` = A^-1 via the same factorization (the "small symmetric solve").
bool solveSymPD(const Mat6& A, Mat6& out);

// ---------------------------------------------------------------------------
// Constitutive build + validity verdicts.
// ---------------------------------------------------------------------------
struct ComplianceResult {
    Mat6  S;                   // 6x6 compliance (Voigt)
    Mat6  C;                   // 6x6 stiffness = S^-1
    bool  symmetric {false};   // S symmetric (reciprocity) to tol
    bool  admissible {false};  // thermodynamic admissibility (Ei>0, |nu|<sqrt(Ei/Ej), ...)
    bool  positiveDefinite {false};   // S (hence C) PD
    bool  ok {false};          // symmetric && admissible && positiveDefinite
    const char* reason {""};   // why NOT ok (empty when ok)
};

// Build compliance S from the 9 engineering constants (mean values), invert to C,
// run the symmetry / admissibility / positive-definite checks.
ComplianceResult buildCompliance(const OrthoConstants& c);

// ---------------------------------------------------------------------------
// Bond / tensor rotation of the 6x6 stiffness & compliance.
//   a = 3x3 direction-cosine matrix (material -> rotated frame), row-major 9.
//   Tsigma = 6x6 stress-transform (Bond/Auld form); Teps = (Tsigma^-1)^T.
//   C' = Tsigma * C * Tsigma^T ;  S' = Teps * S * Teps^T  (Auld congruence;
//   preserves isotropy and matches the closed-form off-axis modulus law).
// ---------------------------------------------------------------------------
Mat6 bondStress(const std::array<double, 9>& a);   // T_sigma
Mat6 bondStrain(const std::array<double, 9>& a);   // T_eps
Mat6 rotateStiffness (const Mat6& C, const std::array<double, 9>& a);   // C'
Mat6 rotateCompliance(const Mat6& S, const std::array<double, 9>& a);   // S'

// Orthonormal frame whose first axis == normalized loadDir (Gram-Schmidt a stable
// second axis), packed as the 3x3 direction-cosine matrix material->load (row-major).
std::array<double, 9> frameFromLoadDir(const Vec3& loadDir);

// ---------------------------------------------------------------------------
// Query return types.
// ---------------------------------------------------------------------------
struct EffectiveModuli {
    double E_eff {0.0};   // 1 / S'_11 (axial Young's modulus along loadDir)
    double G_eff {0.0};   // 1 / S'_66 (shear)
    double nu_eff{0.0};   // -S'_21 / S'_11
    bool   ok {false};    // false if the record/build was invalid
};

enum class Confidence { HIGH, MEDIUM, LOW };

struct PropertyQuery {
    double E_eff {0.0};
    double G_eff {0.0};
    double nu_eff{0.0};
    double strength_eff {0.0};      // first-order directional projection (PREDICTION)
    double band_lo {0.0};           // E_eff scatter band (mean -/+ k*std propagated)
    double band_hi {0.0};
    double k {2.0};                 // band multiplier used (2 sigma ~ 95%)
    Confidence confidence {Confidence::LOW};
    char   reason[224] {};          // honesty string (NEVER empty); OWNED buffer
                                    // (was const char* into a function-local static
                                    // std::string -> dangling for a multi-query caller)
    bool   couponTestRecommended {false};   // true iff confidence==LOW
    bool   ok {false};              // false iff nothing usable was found
};

// ---------------------------------------------------------------------------
// The database.
// ---------------------------------------------------------------------------
class MaterialDB {
public:
    MaterialDB();                               // seeds the §4 records

    const MaterialRecord* exact(const MatKey& key) const;   // nullptr if absent
    std::size_t size() const { return records_.size(); }
    const std::vector<MaterialRecord>& records() const { return records_; }

    // Effective elastic moduli along loadDir for an exact key (no confidence).
    EffectiveModuli getEffective(Material m, Process p, BuildOrient o,
                                 const Vec3& loadDir,
                                 PostProcess post = PostProcess::NA) const;

    // Full honest query: rotates to loadDir, reports scatter band + confidence.
    PropertyQuery getProperties(const MatKey& key, const Vec3& loadDir,
                                double k = 2.0) const;

private:
    std::vector<MaterialRecord> records_;
    // Nearest record on FEWER key axes (for the LOW-confidence fallback). Returns
    // nullptr if not even the material matches. `missingAxis` names what differed.
    const MaterialRecord* nearest(const MatKey& key, const char*& missingAxis) const;
};

} // namespace materials
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MATERIALS_MATERIALS_HPP
