// Forge-287 — Prismoidal earthwork volume between two cross-sections.
//
// Used universally for roadway cut/fill estimates, dam embankment volumes,
// canal excavation, mining stripping ratios, and stockpile measurement.
//
//   Prismoidal (Simpson's 1/3):
//     V = L / 6 · (A_1 + 4 · A_m + A_2)
//
//   Average end area (trapezoidal):
//     V_AEA = L · (A_1 + A_2) / 2
//
// where A_1 and A_2 are cross-section areas at the two end stations and A_m
// is the area at the midpoint. The prismoidal estimate is exact for any
// truncated prism, pyramid or frustum (third-degree polynomial of distance);
// AEA is exact only for prisms. Returns both plus the percentage error
// of AEA relative to the prismoidal.
//
// SI units throughout: length m, area m², volume m³.

#pragma once

namespace forge::prismoidal {

struct Input {
    double lengthM;
    double areaStartM2;
    double areaMiddleM2;
    double areaEndM2;
};

struct Result {
    double prismoidalVolumeM3;       // V (m³)
    double averageEndAreaVolumeM3;   // V_AEA (m³)
    double differenceM3;             // V − V_AEA
    double aeaErrorPct;              // 100·(V_AEA − V)/V
    double prismoidalVolumeCubicYards;
};

Result analyse(const Input& in);

}  // namespace forge::prismoidal
