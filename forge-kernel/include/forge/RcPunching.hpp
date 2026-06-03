// Forge-267 — RC two-way (punching) shear at flat-plate slab-column joints.
//
// ACI 318-19 §22.6.5.2 (SI, MPa). Three classic locations: interior, edge,
// corner. Critical perimeter b_0 taken at d/2 from the column face.
//
//   Interior:  b_0 = 2·(c_1 + d) + 2·(c_2 + d)
//   Edge:      b_0 = 2·(c_1 + d/2) + (c_2 + d)
//   Corner:    b_0 =   (c_1 + d/2) +   (c_2 + d/2)
//
//   β_c   = max(c_1, c_2) / min(c_1, c_2)
//   α_s   = 40 (interior), 30 (edge), 20 (corner)
//
// Nominal two-way shear strength (governs by min):
//   v_c = min{ 0.33·λ·√f'_c,
//              (0.17 + 0.33/β_c)·λ·√f'_c,
//              (0.083·α_s·d/b_0 + 0.17)·λ·√f'_c }
//
//   V_c   = v_c · b_0 · d
//   φV_c  = 0.75 · V_c            (ACI 318-19 §21.2.1 shear strength reduction)
//   DCR   = V_u / φV_c            (>1 fails)
//
// All inputs are SI: stress MPa, dimensions mm, force N. Output stress MPa,
// area mm², force N.

#pragma once

namespace forge::rcpunching {

enum class Location { Interior, Edge, Corner };

struct Input {
    double concreteStrengthMPa;     // f'_c
    double effectiveDepthMm;        // d
    double columnWidthMm;           // c_1
    double columnDepthMm;           // c_2
    Location location;
    double lambdaLightweight;       // 1.0 normalweight; ACI 19.2.4
    double factoredShearN;          // V_u
};

struct Result {
    double betaC;
    double alphaS;
    double criticalPerimeterMm;     // b_0
    double sqrtFcMPa;               // √f'_c
    double vc1MPa;                  // 0.33·λ·√f'_c
    double vc2MPa;                  // (0.17 + 0.33/β_c)·λ·√f'_c
    double vc3MPa;                  // (0.083·α_s·d/b_0 + 0.17)·λ·√f'_c
    double vcMPa;                   // governing
    double VcN;                     // nominal capacity
    double phiVcN;                  // design capacity (φ = 0.75)
    double demandCapacityRatio;     // V_u / φV_c
    bool   passes;
};

Result analyse(const Input& in);

}  // namespace forge::rcpunching
