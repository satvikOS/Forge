// forge/native/vvuq/Vvuq.hpp
//
// In-house SIMULATION-CREDIBILITY / VVUQ layer — forge::native::vvuq.
// (Verification, Validation & Uncertainty Quantification — NAFEMS /
//  ASME V&V 10 [solid mechanics] / V&V 20 [CFD/heat] / V&V 40 spirit.)
//
// WHY THIS EXISTS (the honesty layer, per Forge Engineering Bible §0/§9):
//   An AI-driven CAE result is only useful if it can be TRUSTED. A raw peak
//   stress / deflection / yield number out of an FE/CFD solver is meaningless —
//   even DANGEROUS — without the credibility context around it. This module,
//   given a simulation result + its mesh + boundary conditions, emits BY DEFAULT
//   a credibility report so the number is never reported bare. The core mandate
//   of this whole module: NEVER report a bare number — always attach the reasons.
//
//   The classic ways an FE/CFD "answer" lies, and the check that catches each:
//
//   (A) STRESS SINGULARITIES. At a re-entrant (concave) sharp corner under load,
//       a point load, or a single-node/edge displacement BC, the linear-elastic
//       stress field is THEORETICALLY INFINITE (Williams' eigenfunction). The FE
//       peak there will NOT converge — it rises every time you refine the mesh.
//       Reporting "max stress = 940 MPa" at such a site is a fiction; the honest
//       statement is "peak here is SINGULAR — not a number." detectSingularities
//       flags the locations so the aggregator can mark the peak singular.
//
//   (B) MESH CONVERGENCE. The SAME quantity sampled at >=3 mesh refinement levels
//       either CONVERGES to an asymptote (then Richardson extrapolation gives the
//       converged value + observed order p + a GCI error bar) or DIVERGES like
//       h^-a at a singularity (grows without bound as h->0). classifyConvergence
//       distinguishes "the peak keeps rising because the mesh is refining a
//       singularity" from "the quantity converged" — purely from the numbers.
//
//   (C) ENERGY-RATIO MONITORS (explicit dynamics). Artificial/hourglass strain
//       energy that is a large fraction of internal energy means the element
//       formulation is faking stiffness (red > 10%). A kinetic/internal energy
//       ratio too high for a "quasi-static" run means dynamic effects / abusive
//       mass-scaling are polluting the answer. Contact-stabilization energy that
//       is large means the contact was held together by artificial springs.
//
//   (D) y+ / WALL-TREATMENT (CFD). A wall-function turbulence model is only valid
//       when the first cell sits in the log-law region (30<=y+<=300); a low-Re /
//       wall-resolved model needs y+~1. A mismatch silently corrupts the wall
//       shear stress and everything downstream of it.
//
//   (E) ANALYTICAL / BENCHMARK CROSS-CHECK. Where a closed-form solution exists
//       (cantilever tip deflection, simply-supported beam, Lame thick cylinder,
//       plate center) the FE answer is compared to it and the % error reported.
//
//   (F) FIT-FOR-PURPOSE VERDICT. All present checks aggregate to RED/AMBER/GREEN
//       WITH the reasons — the honesty aggregator.
//
// HONESTY NOTE (per memory [forge-physics-rigor-met]): the Forge static-FEA gate
// is validated to 0.33%, modal to 0.2%, multibody to 0.016% — so the analytic
// cross-check tolerances here (GREEN<2%) are consistent with that proven accuracy.
// BUT turbulent CFD is UNVERIFIED in this kernel (the CFD solver is a laminar
// pressure-projection solver with NO turbulence/wall model). So every y+ check
// carries cfdUnverified=true, and that caveat CAPS the verdict at AMBER even when
// y+ is perfectly in-band. No stub, no hidden fallback — the limit is stated.
//
// CONVENTIONS: pure C++20, standard library only (no OCCT, no Eigen, no WASM, no
// third-party libs). Mirrors forge/native/gdt + forge/native/tolstack: a minimal
// self-contained local Vec3 + dot/cross/sub/norm/normalize so there is NO
// cross-class link dependency; geometry arrives as a flat triangle soup (the
// solver/mesh outputs are consumed BY VALUE, since the production solvers pull
// OCCT+Eigen and cannot link into the dependency-free native gate).

#ifndef FORGE_NATIVE_VVUQ_VVUQ_HPP
#define FORGE_NATIVE_VVUQ_VVUQ_HPP

#include <vector>
#include <cstddef>
#include <cstdint>

namespace forge {
namespace native {
namespace vvuq {

// ---------------------------------------------------------------------------
// Self-contained minimal vector math (gdt/tolstack convention — no coupling).
// ---------------------------------------------------------------------------
struct Vec3 {
    double x{0.0};
    double y{0.0};
    double z{0.0};
};
double dot(const Vec3& a, const Vec3& b);
Vec3   cross(const Vec3& a, const Vec3& b);
Vec3   sub(const Vec3& a, const Vec3& b);
Vec3   add(const Vec3& a, const Vec3& b);
Vec3   scale(const Vec3& a, double s);
double norm(const Vec3& a);
Vec3   normalize(const Vec3& a);   // returns {0,0,0} for a (near-)zero vector

// The three-light aggregate severity used everywhere.
enum class Level { GREEN, AMBER, RED };

// ===========================================================================
// (A) SINGULARITY DETECTION
// ===========================================================================
enum class SingularityKind {
    REENTRANT_CORNER,   // concave sharp edge/vertex under load (Williams)
    POINT_LOAD,         // a concentrated force applied at a single node
    POINT_DISP_BC,      // a prescribed displacement on a single node / edge
    SHARP_NOTCH         // a sharp loaded feature with zero fillet radius
};

struct SingularitySite {
    SingularityKind kind {SingularityKind::REENTRANT_CORNER};
    double x{0.0}, y{0.0}, z{0.0};    // location (mesh coordinates)
    double dihedralDeg {0.0};         // interior dihedral; <180 & concave for re-entrant
    double filletRadius {0.0};        // 0 => sharp; >0 => not singular
    const char* note {"peak here is SINGULAR -- not a number"};
};

// Geometry path (optional): flat triangle soup + which vertices carry load /
// concentrated nodal forces / single-node prescribed displacement.
struct SingularityInput {
    std::vector<double>        positions;        // flat xyz, length = 3*nVerts
    std::vector<std::uint32_t> indices;          // triangle soup, length = 3*nTris
    std::vector<std::uint32_t> loadedVertices;   // vertices carrying applied load
    std::vector<std::uint32_t> pointLoadNodes;   // concentrated nodal forces
    std::vector<std::uint32_t> pointDispBCNodes; // single-node/edge prescribed disp
    double sharpThresholdDeg {30.0};             // dihedral deviation above => sharp
    double filletRadius      {0.0};              // model's min fillet at sharp edges
};

// Re-entrant (concave) sharp loaded edges + every point-load / point-disp-BC node.
std::vector<SingularitySite> detectSingularities(const SingularityInput&);

// Is the reported peak-stress location AT one of the detected singular sites?
// (If so, the peak is "singular -- not a number" and the verdict goes RED.)
bool isPeakSingular(const std::vector<SingularitySite>& sites,
                    double px, double py, double pz, double tol);

// ===========================================================================
// (B) MESH-CONVERGENCE CLASSIFICATION  (Richardson / GCI from >=3 levels)
// ===========================================================================
enum class ConvergenceClass {
    CONVERGING,           // monotone to an asymptote; Richardson value + order p
    DIVERGING_SINGULAR,   // grows without bound as h->0 (~h^-a at a singularity)
    OSCILLATORY,          // sign-alternating successive deltas
    INSUFFICIENT          // <3 levels or non-finite input
};

struct ConvergenceLevel {
    double h{0.0};      // representative mesh size (h1 > h2 > h3 ...; finest last)
    double value{0.0};  // the monitored quantity at that level
};

struct ConvergenceResult {
    ConvergenceClass cls {ConvergenceClass::INSUFFICIENT};
    bool   converging      {false};
    double convergedValue  {0.0};   // Richardson-extrapolated value as h->0
    double orderP          {0.0};   // observed order of convergence (3-level)
    double gci             {0.0};   // fine-grid GCI as a FRACTION (0.03 = 3%)
    double divergenceExponent {0.0};// a in value ~ h^-a when DIVERGING_SINGULAR (>0)
    bool   monotone        {false};
    const char* reason     {""};
};

// safetyFactor = Fs in the GCI (1.25 is the Roache 3-grid recommendation).
ConvergenceResult classifyConvergence(const std::vector<ConvergenceLevel>& levels,
                                      double safetyFactor = 1.25);

// ===========================================================================
// (C) ENERGY-RATIO MONITORS  (explicit dynamics)
// ===========================================================================
struct EnergyInput {
    double internalEnergy    {0.0};  // IE (J)
    double hourglassEnergy   {0.0};  // artificial / hourglass strain energy (J)
    double kineticEnergy     {0.0};  // KE (J)
    double contactStabEnergy {0.0};  // contact-stabilization energy (J)
    bool   quasiStatic       {true}; // a quasi-static run? (KE should be tiny)
};

struct EnergyAudit {
    double hourglassPct  {0.0};   // HG/IE * 100        -- RED > 10, AMBER > 5
    double keIeRatio     {0.0};   // KE/IE              -- (quasi-static) RED > 0.05
    double contactStabPct{0.0};   // contactStab/IE*100 -- AMBER > 5, RED > 10
    Level  level {Level::GREEN};
    std::vector<const char*> reasons;
};

EnergyAudit auditEnergy(const EnergyInput&);

// ===========================================================================
// (D) y+ / WALL-TREATMENT  (CFD)
// ===========================================================================
enum class WallTreatment {
    WALL_FUNCTION,    // log-law wall function: needs 30 <= y+ <= 300
    LOW_RE_RESOLVED,  // wall-resolved / low-Re: needs y+ ~ 1
    AUTO_WALL         // SST blended automatic wall treatment: tolerant 1..300
};

struct YPlusCheck {
    double yPlus {0.0};
    WallTreatment treatment {WallTreatment::WALL_FUNCTION};
    bool   inBand {false};
    double lo {0.0}, hi {0.0};       // the valid band for the chosen treatment
    Level  level {Level::RED};
    const char* reason {""};
    // HONESTY: turbulent CFD is UNVERIFIED in this kernel -> even an in-band y+
    // is capped at AMBER. Always true here.
    bool cfdUnverified {true};
};

YPlusCheck checkYPlus(double yPlus, WallTreatment treatment);

// ===========================================================================
// (E) ANALYTICAL / BENCHMARK CROSS-CHECK
// ===========================================================================
enum class Benchmark {
    CANTILEVER_TIP,   // tip deflection of an end-loaded cantilever: PL^3/(3EI)
    SS_BEAM_CENTER,   // center deflection of a simply-supported center-load: PL^3/(48EI)
    LAME_THICK_CYL,   // Lame hoop stress in a pressurized thick cylinder at r
    PLATE_CENTER,     // center deflection of a simply-supported circular plate
    CUSTOM            // caller supplies the analytic value directly
};

struct AnalyticCheck {
    Benchmark which {Benchmark::CUSTOM};
    double computed {0.0};
    double analytic {0.0};
    double pctError {0.0};   // |computed-analytic|/|analytic| * 100
    Level  level {Level::GREEN};
    const char* reason {""};
};

// Closed-form helpers (SI, consistent units).
double cantileverTipDeflection(double P, double L, double E, double I);     // PL^3/(3EI)
double ssBeamCenterDeflection (double P, double L, double E, double I);     // PL^3/(48EI)
double lamePressurizedStress  (double pi, double ri, double ro, double r);  // hoop at r
double plateCenterDeflection  (double q, double a, double D, double nu);    // SS circular plate

// Cross-check a computed quantity against a benchmark.
//   CANTILEVER_TIP : params = {P, L, E, I}
//   SS_BEAM_CENTER : params = {P, L, E, I}
//   LAME_THICK_CYL : params = {pi, ri, ro, r}
//   PLATE_CENTER   : params = {q, a, D, nu}
//   CUSTOM         : params = {analyticValue}
AnalyticCheck crossCheckAnalytic(Benchmark which, double computed,
                                 const double* params, std::size_t n);

// ===========================================================================
// (F) FIT-FOR-PURPOSE VERDICT  (the honesty aggregator)
// ===========================================================================
struct CredibilityReport {
    bool hasSingularities {false};  std::vector<SingularitySite> singularities;
    bool peakIsSingular   {false};  // the REPORTED peak sits on a singular site

    bool hasConvergence {false};    ConvergenceResult convergence;
    bool hasEnergy      {false};    EnergyAudit       energy;
    bool hasYPlus       {false};    YPlusCheck        yplus;
    bool hasAnalytic    {false};    AnalyticCheck     analytic;

    Level level {Level::GREEN};            // aggregate RED / AMBER / GREEN
    std::vector<const char*> reasons;      // NEVER empty -- never a bare number
};

// Aggregate every present check into the fit-for-purpose verdict + reasons.
CredibilityReport fitForPurpose(const CredibilityReport& partial);

} // namespace vvuq
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_VVUQ_VVUQ_HPP
