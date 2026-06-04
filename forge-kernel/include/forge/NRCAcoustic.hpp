// Forge-327d — Noise Reduction Coefficient (ASTM C423).
//   NRC = (α_250 + α_500 + α_1000 + α_2000) / 4
//   rounded to nearest 0.05 (ASTM convention)

#pragma once

namespace forge::nrc {

struct Input {
    double alpha250;
    double alpha500;
    double alpha1000;
    double alpha2000;
};

struct Result {
    double nrcRaw;
    double nrcRounded;
    bool   meetsAbsorbentClass;     // ≥ 0.50
};

Result analyse(const Input& in);

}  // namespace forge::nrc
