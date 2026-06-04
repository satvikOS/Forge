// Forge-325d — ASHRAE 62.2-2022 residential whole-house ventilation.
//   Q_total[cfm] = 0.03·A_floor[ft²] + 7.5·(N_bedrooms + 1)
//                = 0.15·A_floor[m²]  + 3.54·(N_br + 1)   approximate SI

#pragma once

namespace forge::ashrae62r {

struct Input {
    double conditionedFloorAreaM2;
    int    bedroomCount;
    double infiltrationCreditCfm;     // 62.2 §4.1.3 — subtracted
};

struct Result {
    double requiredVentilationCfm;     // before infiltration credit
    double netVentilationCfm;          // after credit (≥ 0)
    double netVentilationLps;
    bool   complies;                   // net > 0
};

Result analyse(const Input& in);

}  // namespace forge::ashrae62r
