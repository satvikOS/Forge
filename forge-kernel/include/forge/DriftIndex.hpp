// Forge-329e — Tall-building inter-storey drift (ASCE 7 §12.12, IBC §1604.3).
//   Δ_storey / h ≤ Δ_allow / h        Δ_allow = h/400 (essential) to h/500 (normal)

#pragma once

namespace forge::drift {

struct Input {
    double topDeflectionMm;
    double buildingHeightM;
    int    numberOfStories;
    double driftLimitDivisor;       // 500 typ, 400 essential
};

struct Result {
    double overallDriftIndex;       // δ / H (dimensionless)
    double overallLimit;            // 1 / divisor
    double storeyDriftAverageMm;
    bool   meetsOverallLimit;
};

Result analyse(const Input& in);

}  // namespace forge::drift
