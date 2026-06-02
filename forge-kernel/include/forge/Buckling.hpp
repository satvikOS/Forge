#pragma once

// Forge-215 — Euler buckling + Johnson short-column transition.
//
// Critical compression load for slender columns:
//
//   λ = K · L / r            (slenderness ratio)
//   λ_c = √(2 π² E / σ_y)    (transition slenderness)
//
// If λ ≥ λ_c (long column → Euler):
//
//     P_cr = π² · E · I / (K · L)²
//
// If λ < λ_c (short column → Johnson):
//
//     P_J = σ_y · A · (1 − σ_y · λ² / (4 π² E))
//
// The end-condition factor K depends on column ends:
//   pinned-pinned → 1.0   fixed-fixed → 0.5
//   fixed-free    → 2.0   fixed-pinned → ≈ 0.699

#include <cstdint>
#include <string>

namespace forge { namespace buckling {

enum class EndCondition : std::uint8_t {
    PinnedPinned,
    FixedFixed,
    FixedFree,
    FixedPinned,
};

double effectiveLengthFactor(EndCondition c);

struct Section {
    double area;
    double secondMomentI;     // I in m⁴, weak-axis if applicable
};

Section sectionRectangle(double b, double h);
Section sectionSolidCircle(double d);
Section sectionHollowCircle(double dOuter, double dInner);

struct Inputs {
    double area;
    double secondMomentI;
    double length;            // m
    double youngsModulus;     // Pa
    double yieldStrength;     // Pa
    EndCondition ends;
};

struct Outputs {
    double slenderness;
    double slendernessTransition;
    double criticalLoad;
    double allowableLoad;     // = critical / safetyFactor (caller scales)
    double radiusOfGyration;
    std::string mode;         // "euler" | "johnson"
};

Outputs analyse(const Inputs& in);

}} // namespace forge::buckling
