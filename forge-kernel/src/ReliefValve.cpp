#include "forge/ReliefValve.hpp"

#include <cmath>
#include <stdexcept>
#include <string>

namespace forge::prv {

namespace {

// API 526 standard orifice areas (mm² ≈ in² × 645.16)
struct Std { const char* letter; double mm2; };
const Std API526[] = {
    {"D",   71.0}, {"E",  126.5}, {"F",  198.1}, {"G",  324.5},
    {"H",  506.5}, {"J",  830.3}, {"K", 1186.2}, {"L", 1840.6},
    {"M", 2322.6}, {"N", 2800.0}, {"P", 4116.1}, {"Q", 7129.0},
    {"R", 10322.6},{"T", 16774.2},
};
constexpr int N526 = sizeof(API526) / sizeof(API526[0]);

double C_of_k(double k) {
    // API 520 Eq 5.6: C = 520·sqrt(k·(2/(k+1))^((k+1)/(k-1)))
    return 520.0 * std::sqrt(k * std::pow(2.0 / (k + 1.0), (k + 1.0) / (k - 1.0)));
}

}  // namespace

Result analyse(const Input& in) {
    if (in.inletPressureKpaAbs <= 0.0)
        throw std::runtime_error("inletPressure > 0");
    if (in.dischargeCoeffKd <= 0.0 || in.dischargeCoeffKd > 1.0)
        throw std::runtime_error("Kd in (0, 1]");

    double A_mm2 = 0.0;
    double C = 0.0;

    if (in.mode == "gas") {
        if (in.massFlowKgPerH <= 0.0)
            throw std::runtime_error("massFlow > 0");
        if (in.inletTempK <= 0.0) throw std::runtime_error("T > 0");
        if (in.molecularWeight <= 0.0) throw std::runtime_error("M > 0");
        if (in.kRatio <= 1.0) throw std::runtime_error("k > 1");
        C = C_of_k(in.kRatio);
        // API 520 Eq 3.2 (metric): A_mm² = (W / (C·Kd·P_1)) · sqrt(T·Z/M) · 1000
        // W in kg/h, P_1 in kPa abs, T in K, Z assumed 1.0
        A_mm2 = (in.massFlowKgPerH / (C * in.dischargeCoeffKd * in.inletPressureKpaAbs))
              * std::sqrt(in.inletTempK / in.molecularWeight) * 1000.0;
    } else if (in.mode == "liquid") {
        if (in.volumeFlowLpm <= 0.0) throw std::runtime_error("Q > 0");
        if (in.specificGravity <= 0.0) throw std::runtime_error("G > 0");
        if (in.backPressureKpaAbs < 0.0) throw std::runtime_error("P_2 ≥ 0");
        if (in.backPressureKpaAbs >= in.inletPressureKpaAbs)
            throw std::runtime_error("inletPressure > backPressure");
        const double dP_bar = (in.inletPressureKpaAbs - in.backPressureKpaAbs) / 100.0;
        // API 520 Eq 5.13 SI: A_mm² = 11.78·Q·sqrt(G / dP[bar]) / Kd
        // Q in L/min
        A_mm2 = 11.78 * in.volumeFlowLpm
              * std::sqrt(in.specificGravity / dP_bar)
              / in.dischargeCoeffKd;
    } else {
        throw std::runtime_error("mode must be 'gas' or 'liquid'");
    }

    // Pick next standard
    std::string letter;
    double std_area = 0.0;
    for (int i = 0; i < N526; ++i) {
        if (API526[i].mm2 >= A_mm2) {
            letter = API526[i].letter;
            std_area = API526[i].mm2;
            break;
        }
    }
    if (letter.empty()) {
        letter = "ABOVE-T";
        std_area = API526[N526-1].mm2;
    }

    Result r;
    r.gasCoefficientC          = C;
    r.requiredOrificeAreaMm2   = A_mm2;
    r.standardLetterOrificeMm2 = std_area;
    r.nextStandardOrifice      = letter;
    return r;
}

}  // namespace forge::prv
