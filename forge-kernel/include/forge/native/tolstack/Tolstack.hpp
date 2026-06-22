// forge/native/tolstack/Tolstack.hpp
//
// In-house TOLERANCE-STACK solver — forge::native::tolstack.
//
// WHY THIS EXISTS (honest scope, per Forge Engineering Bible §0/§9):
//   A mechanical assembly's fit/clearance is the SUM of many toleranced
//   contributors along a dimension chain. Three industry methods coexist, and
//   choosing the WRONG one is the single most common tolerance-analysis error:
//
//     * WORST-CASE  — arithmetic limit stack. Σ|sensitivity|·tol. Guarantees
//       100 % interchangeability but is brutally pessimistic for long chains.
//     * RSS (root-sum-square, statistical) — assumes INDEPENDENT, NORMAL
//       contributors and adds their variances: σ_gap = √(Σ(sᵢσᵢ)²). It gives
//       a realistic yield via the normal CDF, Cp/Cpk. BUT it is a LINEARIZATION
//       and a normal-sum assumption — exact ONLY for a linear sum of normals.
//     * MONTE-CARLO — deterministic-seeded sampling of each contributor's real
//       distribution, propagated through the (possibly NON-LINEAR) transfer
//       function. This is the TRUTH for mechanisms and non-normal stacks.
//
//   THE NAMED CAPABILITY (the thing engineers get wrong): RSS QUIETLY MISLEADS
//   when its assumptions break. This module DECLARES rssValid=false + a reason
//   and reports Monte-Carlo as authoritative whenever:
//     (a) the transfer is non-linear (a mechanism: |∂²gap/∂dim²| significant) —
//         linearized RSS underpredicts the real spread;
//     (b) a NON-NORMAL contributor (uniform/triangular) dominates the variance —
//         the normal-sum assumption is broken;
//     (c) too few contributors for the central-limit theorem to apply;
//     (d) the MC yield and the RSS yield diverge beyond a threshold.
//
//   GD&T COUPLING: a feature-of-size contributor at MMC legitimately earns a
//   BONUS (more positional slack as it departs the material boundary). We reuse
//   forge::native::gdt::mmcBonus (task #26) to GROW such a contributor's tol
//   band BEFORE deriving its sigma — the same Y14.5 §7.3.3 branch the geometric
//   GD&T evaluator uses, so the two stay numerically consistent.
//
// HONESTY NOTE: RSS here is a linearization — exact only for a linear sum of
// normals. For mechanisms / non-normal-dominant / thin-CLT stacks the engine
// sets rssValid=false and authoritativeMc=true and reports Monte-Carlo as the
// truth. No stub, no hidden fallback — the limit is stated, not papered over.
//
// CONVENTIONS: pure C++20, standard library only (a seeded std::mt19937_64 RNG
// + the normal CDF via std::erfc). No OCCT, no WASM, no third-party libs —
// mirrors forge/native/gdt/Gdt.hpp. 1D scalar dimension chain (no Vec3).

#ifndef FORGE_NATIVE_TOLSTACK_TOLSTACK_HPP
#define FORGE_NATIVE_TOLSTACK_TOLSTACK_HPP

#include <vector>
#include <cstddef>
#include <functional>
#include "forge/native/gdt/Gdt.hpp"   // gdt::mmcBonus, MaterialCondition, FeatureType

namespace forge {
namespace native {
namespace tolstack {

// The statistical distribution of a single contributor about its mean.
enum class DistType { NORMAL, UNIFORM, TRIANGULAR };

// ---------------------------------------------------------------------------
// One dimension-chain contributor.
//
//   sensitivity  : ∂gap/∂dim. ±1 for a simple 1D add/subtract; a general real
//                  for a mechanism (the local linear gain about the operating
//                  point). Used for WC and RSS; the MC path can instead use the
//                  full non-linear `transfer` on StackSpec.
//   plus/minusTol: the ± tolerance band magnitudes (>=0). Asymmetric allowed.
//   sigmaOverride: >0 overrides the tol-derived sigma (e.g. supplier Cpk data).
//   meanOverride : when useMeanOverride, the contributor's mean is this value
//                  instead of nominal + (plusTol - minusTol)/2.
//   GD&T (FoS)   : when isFeatureOfSize, the tol band is GROWN by
//                  gdt::mmcBonus(actualSize, materialLimit, mc, ft) before sigma
//                  derivation — a FoS departing MMC has more positional slack.
// ---------------------------------------------------------------------------
struct Contributor {
    const char* name        {""};
    double nominal          {0.0};
    double plusTol          {0.0};   // +tol  (>=0)
    double minusTol         {0.0};   // -tol magnitude (>=0); asym allowed
    double sensitivity      {1.0};   // ∂gap/∂dim
    DistType dist           {DistType::NORMAL};
    double sigmaOverride     {0.0};  // >0 overrides the derived sigma
    bool   useMeanOverride   {false};
    double meanOverride      {0.0};
    // Optional GD&T feature-of-size: grow tol by mmcBonus at MMC.
    bool   isFeatureOfSize   {false};
    double actualSize        {0.0};
    double materialLimit     {0.0};
    gdt::MaterialCondition mc {gdt::MaterialCondition::RFS};
    gdt::FeatureType       ft {gdt::FeatureType::HOLE};
};

// One critical-path ranking row.
struct ContributorShare {
    const char* name {""};
    double varianceShare {0.0};   // (sens*sigma)^2 / total, in [0,1]
    double sigmaContribution {0.0}; // |sens|*sigma
};

// ---------------------------------------------------------------------------
// The full stack specification.
// ---------------------------------------------------------------------------
struct StackSpec {
    std::vector<Contributor> contributors;
    double LSL {0.0};       // lower spec limit on the gap
    double USL {0.0};       // upper spec limit on the gap
    double k   {3.0};       // k-sigma for RSS limits & tol->sigma (default 3σ)
    int    mcSamples {200000};
    unsigned mcSeed  {0xC0FFEEu};   // deterministic seed (MC must be reproducible)
    int    topN {3};        // critical-path contributors to return
    double rssDivergeThresh {0.02}; // |mcYield - rssYield| above this ⇒ rssValid=false
    double dominanceThresh  {0.50}; // a single non-normal share above this ⇒ rssValid=false
    int    cltMinContributors {4};  // fewer ⇒ rssValid=false (CLT too thin)
    // Optional non-linear transfer for the MC path (the TRUTH for mechanisms).
    // gap = transfer(sampledDims). If null, gap = Σ sensitivity_i · dim_i (linear).
    std::function<double(const std::vector<double>&)> transfer {nullptr};
    // Optional max |∂²gap/∂dim²| magnitude estimate; >0 marks the stack non-linear.
    double maxSecondDeriv {0.0};
    double nonlinThresh   {1e-9};   // |maxSecondDeriv| above this ⇒ non-linear flag
};

// ---------------------------------------------------------------------------
// The combined result of every method + the RSS-validity verdict.
// ---------------------------------------------------------------------------
struct StackResult {
    // worst-case
    double wcNominal {0.0};
    double wcMin {0.0};
    double wcMax {0.0};
    double wcTol {0.0};
    // RSS
    double rssMean {0.0};
    double rssSigma {0.0};
    double rssMin {0.0};      // mean - k·sigma
    double rssMax {0.0};      // mean + k·sigma
    double rssYield {0.0};    // P(LSL<=gap<=USL), normal CDF
    double cp {0.0};
    double cpk {0.0};
    // Monte-Carlo (truth for non-linear / non-normal)
    double mcMean {0.0};
    double mcSigma {0.0};
    double mcYield {0.0};
    double mcP01 {0.0};       // 1st percentile
    double mcP99 {0.0};       // 99th percentile
    // critical-path
    std::vector<ContributorShare> contributors;   // sorted desc, top-N
    // RSS-validity verdict
    bool   rssValid {true};
    const char* rssWarning {""};
    bool   authoritativeMc {false};   // true when rssValid==false ⇒ trust mcYield
};

// Standard normal CDF: 0.5*erfc(-x/sqrt2). Mean/sigma overload re-centers/scales.
double normalCdf(double x);
double normalCdf(double x, double mean, double sigma);

// Effective ± tol of a contributor AFTER GD&T mmcBonus growth (FoS only).
double effectivePlusTol (const Contributor& c);
double effectiveMinusTol(const Contributor& c);

// The mean and sigma a contributor contributes (after GD&T growth + overrides).
double contributorMean (const Contributor& c, double k);
double contributorSigma(const Contributor& c, double k);

StackResult solveWorstCase  (const StackSpec& spec);
StackResult solveRSS        (const StackSpec& spec);
StackResult solveMonteCarlo (const StackSpec& spec);
// Runs all three, fills critical-path + the rssValid/rssWarning verdict.
StackResult analyzeStack    (const StackSpec& spec);

} // namespace tolstack
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_TOLSTACK_TOLSTACK_HPP
