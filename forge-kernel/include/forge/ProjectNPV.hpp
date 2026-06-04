// Forge-339e — Engineering project NPV / IRR / payback / LCOE (Park §5).
//   NPV = Σ_{t=0}^{N} CF_t / (1+r)^t
//   IRR: root of NPV(r) = 0 — bisection in [-0.99, 5.0].
//   Simple payback: smallest t such that Σ CF >= 0
//   LCOE = (CAPEX + Σ_t OPEX_t / (1+r)^t) / Σ_t Energy_t / (1+r)^t.

#pragma once

#include <vector>

namespace forge::npv {

struct Input {
    std::vector<double> cashflows_USD;          // CF_0, CF_1, ...
    std::vector<double> annualEnergy_kWh;       // optional
    std::vector<double> annualOpex_USD;          // optional
    double initialCapex_USD;                    // optional alt format
    double discountRate_pct;
};

struct Result {
    double NPV_USD;
    double IRR_pct;
    double paybackYears;          // -1 if never
    double LCOE_USDperKWh;        // 0 if no energy
};

Result analyse(const Input& in);

}  // namespace forge::npv
