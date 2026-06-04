#include "forge/ProjectNPV.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::npv {

static double npvAt(double r, const std::vector<double>& cf) {
    double total = 0.0;
    for (size_t t = 0; t < cf.size(); ++t)
        total += cf[t] / std::pow(1.0 + r, static_cast<double>(t));
    return total;
}

Result analyse(const Input& in) {
    if (in.cashflows_USD.empty())   throw std::runtime_error("cashflows empty");
    if (in.discountRate_pct <= -100) throw std::runtime_error("r > -100%");

    const double r = in.discountRate_pct / 100.0;
    const double npv = npvAt(r, in.cashflows_USD);

    // IRR via bisection.
    double lo = -0.99, hi = 5.0, irr = 0.0;
    double f_lo = npvAt(lo, in.cashflows_USD);
    double f_hi = npvAt(hi, in.cashflows_USD);
    bool found = false;
    if (f_lo * f_hi < 0) {
        for (int i = 0; i < 100; ++i) {
            const double mid = 0.5 * (lo + hi);
            const double f_mid = npvAt(mid, in.cashflows_USD);
            if (std::fabs(f_mid) < 1e-6 || (hi - lo) < 1e-9) { irr = mid; found = true; break; }
            if (f_lo * f_mid < 0) { hi = mid; f_hi = f_mid; }
            else                  { lo = mid; f_lo = f_mid; }
        }
        if (!found) irr = 0.5 * (lo + hi);
        found = true;
    }

    // Payback (simple, undiscounted).
    double cum = 0.0;
    double payback = -1.0;
    for (size_t t = 0; t < in.cashflows_USD.size(); ++t) {
        cum += in.cashflows_USD[t];
        if (cum >= 0.0) {
            const double prev = cum - in.cashflows_USD[t];
            if (in.cashflows_USD[t] > 0)
                payback = static_cast<double>(t - 1) + (-prev / in.cashflows_USD[t]);
            else
                payback = static_cast<double>(t);
            break;
        }
    }

    // LCOE.
    double lcoe = 0.0;
    if (!in.annualEnergy_kWh.empty() && !in.annualOpex_USD.empty()) {
        if (in.annualEnergy_kWh.size() != in.annualOpex_USD.size())
            throw std::runtime_error("energy/opex length mismatch");
        double cost_pv = in.initialCapex_USD;
        double energy_pv = 0.0;
        for (size_t t = 0; t < in.annualEnergy_kWh.size(); ++t) {
            const double df = std::pow(1.0 + r, static_cast<double>(t + 1));
            cost_pv   += in.annualOpex_USD[t] / df;
            energy_pv += in.annualEnergy_kWh[t] / df;
        }
        if (energy_pv > 0) lcoe = cost_pv / energy_pv;
    }

    Result rOut;
    rOut.NPV_USD         = npv;
    rOut.IRR_pct         = found ? irr * 100.0 : 0.0;
    rOut.paybackYears    = payback;
    rOut.LCOE_USDperKWh  = lcoe;
    return rOut;
}

}  // namespace forge::npv
