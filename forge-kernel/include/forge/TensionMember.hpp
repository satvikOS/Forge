// Forge-329b — Bolted steel tension member with shear lag (AISC 360-22 §D3 + Table D3.1).
//   P_n,yield = F_y · A_g                  φ_t = 0.90
//   P_n,rupture = F_u · A_e                φ_t = 0.75
//   A_e = U · A_n
//   U from Table D3.1 (Case 7 for plates/angles ≥ 2 fasteners in line):
//       U = 1 − x̄ / L         where x̄ is connection-eccentricity
//                              L is connection length

#pragma once

namespace forge::tension {

struct Input {
    double grossArea_mm2;            // A_g
    double netArea_mm2;              // A_n (after bolt holes)
    double xBar_mm;                  // shear-lag eccentricity
    double connectionLength_mm;      // L between first and last fastener
    double Fy_MPa;
    double Fu_MPa;
};

struct Result {
    double shearLag_U;
    double effectiveArea_mm2;         // A_e
    double yieldCapacity_kN;
    double ruptureCapacity_kN;
    double designCapacity_kN;         // governing min(0.9·Py, 0.75·Pr)
};

Result analyse(const Input& in);

}  // namespace forge::tension
