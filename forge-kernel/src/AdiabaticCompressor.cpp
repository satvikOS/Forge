#include "forge/AdiabaticCompressor.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::adicomp {

Result analyse(const Input& in) {
    if (in.inletPressureKpaAbs <= 0) throw std::runtime_error("P_1 > 0");
    if (in.dischargePressureKpaAbs <= in.inletPressureKpaAbs)
        throw std::runtime_error("P_2 > P_1");
    if (in.kRatio <= 1.0) throw std::runtime_error("k > 1");
    if (in.isentropicEfficiency <= 0 || in.isentropicEfficiency > 1)
        throw std::runtime_error("η in (0, 1]");
    if (in.molecularWeight <= 0) throw std::runtime_error("M > 0");

    constexpr double R_univ = 8.314;     // J/mol·K
    const double T1_K = in.inletTempC + 273.15;
    const double ratio = in.dischargePressureKpaAbs / in.inletPressureKpaAbs;
    const double expo = (in.kRatio - 1.0) / in.kRatio;
    const double T2s_K = T1_K * std::pow(ratio, expo);
    const double T2_K = T1_K + (T2s_K - T1_K) / in.isentropicEfficiency;
    const double cp_kJpkgK = in.kRatio * R_univ / (in.molecularWeight * (in.kRatio - 1.0));
    const double w_in = cp_kJpkgK * (T2_K - T1_K);

    Result r;
    r.pressureRatio              = ratio;
    r.isentropicDischargeTempC   = T2s_K - 273.15;
    r.actualDischargeTempC       = T2_K - 273.15;
    r.specificHeatCpKJpkgK       = cp_kJpkgK;
    r.specificWorkKJpkg          = w_in;
    return r;
}

}  // namespace forge::adicomp
