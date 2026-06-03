// Forge-249 — Synchronous machine implementation.

#include "forge/SyncMachine.hpp"

#include <cmath>
#include <complex>
#include <numbers>
#include <stdexcept>

namespace forge::syncmachine {

namespace {
constexpr double pi = std::numbers::pi;
using cd = std::complex<double>;

cd polar(double mag, double rad) {
    return cd(mag * std::cos(rad), mag * std::sin(rad));
}
}  // namespace

Result analyse(const Input& in) {
    if (in.terminalPhaseVoltageV <= 0.0)
        throw std::invalid_argument("|V_t| must be positive");
    if (in.synchronousReactanceOhm <= 0.0)
        throw std::invalid_argument("X_s must be positive");
    if (in.armatureResistanceOhm < 0.0)
        throw std::invalid_argument("R_a must be ≥ 0");
    if (in.powerFactor <= 0.0 || in.powerFactor > 1.0)
        throw std::invalid_argument("power factor must be in (0, 1]");

    Result r{};
    const double V = in.terminalPhaseVoltageV;
    const cd V_t(V, 0.0);
    const cd Z(in.armatureResistanceOhm, in.synchronousReactanceOhm);

    const double phi = std::acos(in.powerFactor) * (in.leading ? +1.0 : -1.0);
    const double S = std::abs(in.realPowerPerPhaseW) / in.powerFactor;
    const double I_mag = S / V;
    cd I_a;
    if (in.mode == Mode::Generator) {
        // Generator current direction: I_a from machine to bus.
        I_a = polar(I_mag, phi);
        const cd E_f = V_t + Z * I_a;
        r.armatureCurrentA = std::abs(I_a);
        r.armatureCurrentAngDeg = std::atan2(I_a.imag(), I_a.real()) * 180.0 / pi;
        r.inducedEmfV = std::abs(E_f);
        r.inducedEmfAngDeg = std::atan2(E_f.imag(), E_f.real()) * 180.0 / pi;
    } else {
        // Motor: I_a from bus to machine; reverse sign of V_t equation:
        //   V_t = E_f + jX_s I_a  →  E_f = V_t − jX_s I_a
        I_a = polar(I_mag, phi);
        const cd E_f = V_t - Z * I_a;
        r.armatureCurrentA = std::abs(I_a);
        r.armatureCurrentAngDeg = std::atan2(I_a.imag(), I_a.real()) * 180.0 / pi;
        r.inducedEmfV = std::abs(E_f);
        r.inducedEmfAngDeg = std::atan2(E_f.imag(), E_f.real()) * 180.0 / pi;
    }

    const double delta = r.inducedEmfAngDeg * pi / 180.0;
    r.reactivePowerPerPhaseVar = V * (r.inducedEmfV * std::cos(delta) - V)
                                  / in.synchronousReactanceOhm;
    r.maxPullOutPowerW = V * r.inducedEmfV / in.synchronousReactanceOhm;
    return r;
}

}  // namespace forge::syncmachine
