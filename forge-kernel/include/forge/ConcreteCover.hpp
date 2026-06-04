// Forge-326a — Concrete cover requirements (ACI 318-19 §20.6.1 Table 20.6.1.3.1).
//   Exposure: cast-in-place not exposed (20/40), exposed to weather (40/50),
//             cast against earth (75 permanent / 50 with formwork).
//   Bar size adjustment: #5 and smaller use lower cover, #6+ use upper.

#pragma once

#include <string>

namespace forge::cover {

struct Input {
    std::string exposureCondition;   // "interior" | "weather" | "earth-formed" | "earth-direct"
    std::string barSize;             // "small" (≤ #5 / Ø16) | "large" (≥ #6 / Ø20)
};

struct Result {
    double minimumCoverMm;
    bool   exteriorFireRated;        // weather + earth bumps fire rating
};

Result analyse(const Input& in);

}  // namespace forge::cover
