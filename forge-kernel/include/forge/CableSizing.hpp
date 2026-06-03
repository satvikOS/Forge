// Forge-252 — Cable sizing (NEC 310.16 ampacity + voltage drop).
//
// Ampacity table NEC 310.16 (75°C insulation, single conductor in
// raceway, ≤ 3 current-carrying conductors, 30°C ambient):
//
//   Cu | AWG/kcmil   ampacity (A)
//      | 14            20
//      | 12            25
//      | 10            35
//      |  8            50
//      |  6            65
//      |  4            85
//      |  3           100
//      |  2           115
//      |  1           130
//      | 1/0          150
//      | 2/0          175
//      | 3/0          200
//      | 4/0          230
//      | 250 kcmil    255
//      | 350 kcmil    310
//      | 500 kcmil    380
//
// Aluminum: ~80% of copper at same size (approximate; NEC uses
// distinct columns but the ratio is consistent within ~5%).
//
// Voltage drop per IEC 60364 (single-phase, two-wire round-trip):
//   ΔV = 2·I·L·(R cosφ + X sinφ)        (1-φ, V)
//   ΔV = √3·I·L·(R cosφ + X sinφ)       (3-φ line-to-line, V)
// where R and X are per-km.  For copper at 20°C, R ≈ ρ/A
// (ρ = 0.0172 Ω·mm²/m).
//
// Derating: NEC 310.15(B)(2)(a) ambient correction (75°C insul):
//   T_amb (°C)  factor
//      21-25     1.05
//      26-30     1.00
//      31-35     0.94
//      36-40     0.88
//      41-45     0.82
//      46-50     0.75
//      51-55     0.67
//
// Grouping (NEC 310.15(B)(3)(a)):
//   4-6 conductors → 0.80, 7-9 → 0.70, 10-20 → 0.50.

#pragma once
#include <string>
#include <vector>

namespace forge::cable {

enum class Material { Copper, Aluminum };

struct AmpacityEntry {
    std::string size;   // "14", "12", ..., "4/0", "250 kcmil"
    double xsecMm2;     // cross-section in mm²
    int    ampacityCu75C;  // base from NEC 310.16, 75°C Cu
};

std::vector<AmpacityEntry> nec31016Table();

double ambientDeratingFactor(double tempC);
double groupingDeratingFactor(int numConductors);

struct AmpacityInput {
    std::string conductorSize;
    Material    material;
    double      ambientTempC;       // °C
    int         numCurrentCarryingConductors;
};

struct AmpacityResult {
    double baseAmpacityA;
    double ambientFactor;
    double groupingFactor;
    double materialFactor;          // 1.0 Cu, 0.80 Al
    double effectiveAmpacityA;
};

AmpacityResult ampacity(const AmpacityInput& in);

enum class System { SinglePhase, ThreePhase };

struct VoltageDropInput {
    System system;
    double xsecMm2;                 // mm² conductor area
    double lengthMeters;
    double loadAmperes;
    double powerFactor;
    double materialResistivityOhmMmSqPerM;  // ρ at 20°C; default Cu 0.0172
    double conductorReactanceOhmPerKm;      // X — small for low-V cables
    double systemVoltage;           // V (line for 1-φ; line-line for 3-φ)
};

struct VoltageDropResult {
    double cableResistanceOhmPerKm;
    double voltageDropV;
    double voltageDropPct;
};

VoltageDropResult voltageDrop(const VoltageDropInput& in);

}  // namespace forge::cable
