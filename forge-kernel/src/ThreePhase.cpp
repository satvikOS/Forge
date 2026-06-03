// Forge-244 — Three-phase power implementation.

#include "forge/ThreePhase.hpp"

#include <algorithm>
#include <cmath>
#include <numbers>
#include <stdexcept>

namespace forge::threephase {

namespace {
constexpr double pi = std::numbers::pi;
constexpr double sqrt3 = 1.7320508075688772;
}

PowerResult balancedPower(const PowerInput& in) {
    if (in.lineLineVoltageV <= 0.0 || in.lineCurrentA < 0.0)
        throw std::invalid_argument("V_LL must be positive, I_L ≥ 0");
    if (in.powerFactor < 0.0 || in.powerFactor > 1.0)
        throw std::invalid_argument("power factor must be in [0, 1]");
    PowerResult r{};
    if (in.connection == Connection::Star) {
        r.phaseVoltageV = in.lineLineVoltageV / sqrt3;
        r.phaseCurrentA = in.lineCurrentA;
    } else {
        r.phaseVoltageV = in.lineLineVoltageV;
        r.phaseCurrentA = in.lineCurrentA / sqrt3;
    }
    r.apparentVA = sqrt3 * in.lineLineVoltageV * in.lineCurrentA;
    r.realW = r.apparentVA * in.powerFactor;
    const double sinphi = std::sqrt(std::max(0.0, 1.0 - in.powerFactor * in.powerFactor));
    r.reactiveVAR = r.apparentVA * sinphi * (in.leading ? -1.0 : 1.0);
    return r;
}

PfCorrResult powerFactorCorrection(const PfCorrInput& in) {
    if (in.realPowerW <= 0.0)
        throw std::invalid_argument("P must be positive");
    if (in.powerFactor1 <= 0.0 || in.powerFactor1 > 1.0)
        throw std::invalid_argument("pf_1 must be in (0, 1]");
    if (in.powerFactor2 <= 0.0 || in.powerFactor2 > 1.0)
        throw std::invalid_argument("pf_2 must be in (0, 1]");
    if (in.powerFactor2 < in.powerFactor1)
        throw std::invalid_argument("pf_2 must be ≥ pf_1 (correction direction)");
    if (in.lineLineVoltageV <= 0.0 || in.frequencyHz <= 0.0)
        throw std::invalid_argument("V_LL, f must be positive");

    PfCorrResult r{};
    r.phi1Rad = std::acos(in.powerFactor1);
    r.phi2Rad = std::acos(in.powerFactor2);
    r.reactiveBeforeVAR = in.realPowerW * std::tan(r.phi1Rad);
    r.reactiveAfterVAR  = in.realPowerW * std::tan(r.phi2Rad);
    r.capacitorVAR = r.reactiveBeforeVAR - r.reactiveAfterVAR;
    const double omega = 2.0 * pi * in.frequencyHz;
    // Δ-connected bank: C = ΔQ / (ω · V_LL²) per leg-line-to-line treatment.
    r.capacitanceF = r.capacitorVAR / (omega * in.lineLineVoltageV * in.lineLineVoltageV);
    return r;
}

PerUnitResult perUnit(const PerUnitInput& in) {
    if (in.baseVA <= 0.0 || in.baseVoltageLineLineV <= 0.0)
        throw std::invalid_argument("base VA and V_LL must be positive");
    if (in.ohmicZ < 0.0)
        throw std::invalid_argument("Z must be ≥ 0");
    PerUnitResult r{};
    r.baseImpedanceOhm = in.baseVoltageLineLineV * in.baseVoltageLineLineV / in.baseVA;
    r.baseCurrentA = in.baseVA / (sqrt3 * in.baseVoltageLineLineV);
    r.zpu = in.ohmicZ / r.baseImpedanceOhm;
    return r;
}

}  // namespace forge::threephase
