// Forge-293 — Single-point crane hook stress check (DIN 15400 / ASME B30.10).
//
// Two checks govern every single hook used in lifting equipment:
//
//   (1) SHANK TENSION (straight-axis loading through the shank centreline):
//       σ_shank = WLL · 1000 / A_shank        (WLL in kN, A in mm² → MPa)
//       Must be ≤ σ_shank,allow (typically 80 MPa for ungraded forgings;
//       up to 400 MPa for high-grade Q&T alloy steel hooks).
//
//   (2) THROAT BENDING (curved-beam bending at the critical section
//       through the throat, where the line of action of WLL passes
//       across the hook profile):
//       M           = WLL · 1000 · L_arm               (N·mm)
//       σ_throat    = M / Z_throat                      (MPa, simple beam)
//       Must be ≤ σ_throat,allow.
//
//   Combined utilization is the larger of the two demand-capacity ratios.
//   This is the rapid-check form used at the design-review stage; full
//   Winkler-Bach curved-beam analysis (with the r_n / e neutral-axis shift)
//   is a downstream verification step.
//
// SI units throughout.

#pragma once

namespace forge::cranehook {

struct Input {
    double wllKN;                       // working load limit
    double shankDiameterMm;             // d_s
    double shankAllowableStressMPa;     // σ_shank,allow
    double throatSectionModulusMm3;     // Z_throat
    double throatMomentArmMm;           // L_arm (load eccentricity)
    double throatAllowableStressMPa;    // σ_throat,allow
};

struct Result {
    double shankAreaMm2;
    double shankStressMPa;
    double shankDCR;
    double bendingMomentNmm;
    double throatStressMPa;
    double throatDCR;
    double governingDCR;
    bool   shankOK;
    bool   throatOK;
    bool   overallOK;
};

Result analyse(const Input& in);

}  // namespace forge::cranehook
