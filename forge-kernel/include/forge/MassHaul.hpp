// Forge-330d — Earthwork mass-haul (Average End Areas + prismoidal correction).
//   V_aea = L/2 · (A_1 + A_2)
//   V_pris = L/6 · (A_1 + 4·A_m + A_2)
//   Mass-haul ordinate Σ(cut − fill_swelled) → station of zero crossings = balance lines.

#pragma once

#include <vector>

namespace forge::masshaul {

struct Station {
    double station_m;        // running chainage
    double cutArea_m2;
    double fillArea_m2;
    double midCutArea_m2;    // optional; 0 → use AEA only
    double midFillArea_m2;
};

struct Input {
    std::vector<Station> stations;
    double swellFactor;      // 1.20 typ rock, 1.10 common soil
    double shrinkageFactor;  // 0.90 typ → compacted fill = loose · shrink
};

struct Result {
    std::vector<double> cumulativeOrdinate_m3;      // mass-haul curve
    double totalCut_m3;
    double totalFillCompacted_m3;
    double totalFillLoose_m3;
    double netBalance_m3;     // + waste, − borrow
    double maxOrdinate_m3;
    double minOrdinate_m3;
};

Result analyse(const Input& in);

}  // namespace forge::masshaul
