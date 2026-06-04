#include "forge/MullionDeflection.hpp"

#include <stdexcept>

namespace forge::mullion {

Result analyse(const Input& in) {
    if (in.spanLengthMm <= 0) throw std::runtime_error("L > 0");
    if (in.windPressureKnM2 <= 0) throw std::runtime_error("w > 0");
    if (in.tributaryWidthMm <= 0) throw std::runtime_error("trib > 0");
    if (in.E_MPa <= 0) throw std::runtime_error("E > 0");
    if (in.momentOfInertiaMm4 <= 0) throw std::runtime_error("I > 0");
    if (in.deflectionLimitDivisor <= 0) throw std::runtime_error("divisor > 0");

    // w (kN/m²) × trib (mm) → linear load (kN/m)
    const double w_lin_kNm = in.windPressureKnM2 * in.tributaryWidthMm / 1000.0;
    // δ = 5·w·L⁴ / (384·E·I)   units: kN/m, mm, MPa, mm⁴
    // Convert: w in N/mm = w_kNm·1, L mm, E·I in N·mm²
    const double w_N_mm = w_lin_kNm;       // 1 kN/m = 1 N/mm
    const double L = in.spanLengthMm;
    const double delta = 5.0 * w_N_mm * L * L * L * L
                       / (384.0 * in.E_MPa * in.momentOfInertiaMm4);
    const double limit = L / in.deflectionLimitDivisor;

    Result r;
    r.linearLoadKnPerM      = w_lin_kNm;
    r.midspanDeflectionMm   = delta;
    r.deflectionLimitMm     = limit;
    r.passes                = delta <= limit;
    return r;
}

}  // namespace forge::mullion
