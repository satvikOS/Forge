// Forge-327b — Stair design (IBC 2021 §1011).
//   Max riser 7 in (178 mm), min tread 11 in (279 mm).
//   Riser + tread (Blondel rule): 432-457 mm or 17-18 in.

#pragma once

namespace forge::stair {

struct Input {
    double floorToFloorHeightMm;
    double maxRiserMm;             // default 178
    double minTreadMm;              // default 279
};

struct Result {
    int    numberOfRisers;
    int    numberOfTreads;          // = risers − 1
    double actualRiserMm;
    double totalRunMm;
    double pitchAngleDeg;
    double riserPlusTreadMm;
    bool   riserCompliant;          // ≤ maxRiser
    bool   treadCompliant;          // ≥ minTread
    bool   blondelCompliant;        // 432 ≤ R+T ≤ 457
    bool   overallCompliant;
};

Result analyse(const Input& in);

}  // namespace forge::stair
