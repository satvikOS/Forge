#pragma once

// Forge-201 — parametric sheet-metal flat-pattern unfold + bend allowance.
//
// This is a lightweight, BRep-free companion to the OCCT-based
// `forge::sheet` module (Forge-24). Inputs are just numbers (flange
// lengths + bend specs); outputs are developed length, sheet area,
// per-bend bend-allowance / bend-deduction / neutral-fibre radius, and
// per-flange start positions in the developed coord system.
//
// Formulae (industry-standard, mm everywhere):
//
//   K-factor table (R/T ratio → K), per material (DIN 6935 baseline)
//   Bend allowance      BA = (π/180) · α · (R + K · T)
//   Bend deduction      BD = 2 · (R + T) · tan(α/2) - BA
//   Developed length    L_dev = Σ L_flange_i + Σ BA_j
//
// where α = bend angle (deg), R = inner radius, T = thickness, K =
// neutral-fibre offset factor (typically 0.33–0.5 for steel, 0.41 for
// aluminium at R/T ≥ 1).

#include <cstdint>
#include <vector>

namespace forge { namespace sheetmetal {

enum class Material : std::uint8_t {
    Aluminium,
    MildSteel,
    StainlessSteel,
    Copper,
    Brass,
    Galvanised,
};

double kFactor(Material material, double ratioRoT);

struct BendSpec {
    double angleDeg;
    double innerRadius;
    double kOverride;        // ≤ 0 ⇒ look up from material + R/T ratio
};

struct BendResult {
    double bendAllowance;     // BA, mm
    double bendDeduction;     // BD, mm
    double neutralRadius;     // R + K·T, mm
    double effectiveK;        // K actually used (after lookup or override)
};

BendResult computeBend(double angleDeg, double innerRadius,
                       double thickness, double kOverride,
                       Material material);

struct UnfoldInputs {
    std::vector<double>   flangeLengths;   // N entries, mm
    std::vector<BendSpec> bends;           // N - 1 entries (gap between flanges)
    double                thickness;       // mm
    double                width;           // mm (sheet width, used for area)
    Material              material = Material::MildSteel;
};

struct UnfoldOutputs {
    double developedLength;
    double sheetArea;
    std::vector<BendResult> perBend;       // size == bends.size()
    std::vector<double>     flangeStartX;  // size == flangeLengths.size()
};

UnfoldOutputs unfoldChain(const UnfoldInputs& in);

}} // namespace forge::sheetmetal
