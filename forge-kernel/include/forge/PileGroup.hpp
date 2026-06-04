// Forge-319d — Pile-group efficiency (Converse-Labarre formula).
//
//   η = 1 − [θ · ((n−1)·m + (m−1)·n) / (90 · m · n)]
//     θ = atan(d / s)   °         pile diameter d, c-c spacing s
//
// Capacity of the group: Q_group = η · m · n · Q_single
// Standard for shallow-cap pile foundations in stiff clay.

#pragma once

namespace forge::pilegroup {

struct Input {
    double pileDiameterMm;        // d
    double spacingMm;             // s (centre-to-centre)
    int    rows_m;                // m
    int    columns_n;             // n
    double singlePileCapacityKn;  // Q_single
};

struct Result {
    double anglePhiDeg;           // atan(d/s)
    double efficiency;            // η
    double groupCapacityKn;       // η · m · n · Q_single
};

Result analyse(const Input& in);

}  // namespace forge::pilegroup
