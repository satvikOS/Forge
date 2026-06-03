// Forge-292 — Wood shear wall design (NDS 2018 + SDPWS-21 §4).
//
// Wood structural panel shear walls resist lateral wind and seismic loads
// in light-frame construction (residential, low-rise commercial, mid-rise
// CLT). This calculator captures the three checks every shear-wall
// designer must satisfy:
//
//   (1) UNIT SHEAR        v = V / b
//       v must not exceed v_allow (tabulated for the chosen sheathing,
//       nail size, nail spacing, and species; user supplies directly).
//
//   (2) ASPECT RATIO     h / b  ≤  3.5 for blocked wood structural panels
//       (SDPWS Table 4.3.4). Walls beyond this need an aspect-ratio
//       reduction or boundary-element design.
//
//   (3) CHORD FORCE       T = V · h / b   (tension & compression)
//       Chord stress σ_c = T / A_c must be ≤ f_c_allow (NDS adjusted
//       allowable for the chord stud — typically a 4× or 6× full-height
//       end post). Same chord acts in tension on opposite side; user
//       assumes the limit applies symmetrically.
//
// Returns an overall pass / fail plus the three demand-capacity ratios for
// shear, aspect, and chord stress. Pure ASD form (units SI throughout:
// V kN, dimensions m, allowable stresses MPa, chord area mm²).

#pragma once

namespace forge::woodshear {

struct Input {
    double shearLoadKN;             // V
    double wallLengthM;             // b
    double wallHeightM;             // h
    double allowableShearKNm;       // v_allow (kN/m)
    double chordAreaMm2;            // A_c
    double chordAllowableStressMPa; // f_c_allow
};

struct Result {
    double unitShearKNm;            // v
    double shearDCR;                // v / v_allow
    double aspectRatio;             // h/b
    bool   aspectOK;                // h/b ≤ 3.5
    double chordForceKN;            // T = C
    double chordStressMPa;          // σ_c = T·1000/A_c
    double chordDCR;                // σ_c / f_c_allow
    bool   shearOK;
    bool   chordOK;
    bool   overallOK;
};

Result analyse(const Input& in);

}  // namespace forge::woodshear
