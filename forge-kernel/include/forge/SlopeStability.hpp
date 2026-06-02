#pragma once

// Forge-176 — Geotechnical slope stability (Bishop + Janbu).
//
// Limit-equilibrium slope stability on circular failure surfaces.
//   * Bishop simplified (iterative): converged FoS such that
//       FoS = Σ[(c'·ℓ + (W − u·ℓ)·tanφ') / m_α] / Σ(W·sinα)
//       m_α = cosα + sinα·tanφ'/FoS
//   * Janbu corrected: same numerator but normalised by ΣW·tanα and
//     multiplied by Janbu's shape correction f0.
//
// Search: 3D grid (Xc, Yc, R) of trial circles intersecting the ground
// surface. For each circle we slice the chord into vertical slices and
// solve for both Bishop and Janbu FoS, tracking the minimum.

#include <cstdint>
#include <string>
#include <vector>

namespace forge { namespace geotech {

struct SoilLayer {
    // Top of layer as a polyline in (x, y) — must be monotone in x and
    // span the slope domain. Below the lowest layer top, everything is
    // treated as bedrock (no failure).
    std::vector<double> topProfile;  // 2K, interleaved
    double gammaWet;   // kN/m³
    double gammaSat;   // kN/m³
    double cPrime;     // kPa effective cohesion
    double phiPrime;   // deg effective friction
    double ru;         // 0..1 pore-pressure ratio (used if no waterTable)
    std::string name;
};

struct SlopeConfig {
    // Ground surface as monotone polyline (left-to-right) in (x, y) metres:
    std::vector<double> groundProfile;  // 2N
    std::vector<SoilLayer> layers;      // ordered top-to-bottom
    // Optional water table (piezometric line), monotone in x:
    std::vector<double> waterTable;     // 2M (empty if N/A; if present overrides ru)
    // Search grid (metres).
    double xcMin, xcMax;
    double ycMin, ycMax;
    double rMin,  rMax;
    int    nXc, nYc, nR;
    // Slice count per trial (typical 25..50)
    int    sliceCount;
    // Bishop iteration bounds.
    int    bishopMaxIters;
    double bishopTol;
    // Janbu correction factor f0; depends on c-φ mix. Typical value
    // 1.05 .. 1.13. Pass 0 to use a c-φ default (b=0.31 ⇒ f0=1+0.31·(d/L))
    // computed from the critical-circle geometry.
    double janbuF0;
};

struct SliceResult {
    double xCentre;      // m
    double yBase;        // m (circle base)
    double width;        // m
    double weight;       // kN/m of length perpendicular to plane
    double baseAngle;    // rad (positive = base dips toward toe)
    double baseLength;   // m
    double porePressure; // kPa
    double cBase;        // kPa
    double phiBase;      // deg
};

struct SlopeResult {
    double fosBishop;
    double fosJanbu;
    double xcCritical, ycCritical, rCritical;
    std::vector<double> slipSurface;   // polyline (2P)
    std::vector<SliceResult> slices;
    int    iterations;       // Bishop iterations on the critical circle
    int    trialsEvaluated;  // total circles that produced a finite FoS
};

SlopeResult analyse(const SlopeConfig& cfg);

}} // namespace forge::geotech
