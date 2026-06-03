// Forge-248 — Transmission line implementation.

#include "forge/TransmissionLine.hpp"

#include <cmath>
#include <complex>
#include <numbers>
#include <stdexcept>

namespace forge::tline {

namespace {
constexpr double pi = std::numbers::pi;
using cd = std::complex<double>;

cd polar(double mag, double rad) {
    return cd(mag * std::cos(rad), mag * std::sin(rad));
}

void writePolar(double& mag, double& ang, const cd& z) {
    mag = std::abs(z);
    ang = (mag > 1e-18) ? std::atan2(z.imag(), z.real()) * 180.0 / pi : 0.0;
}
}  // namespace

Abcd abcd(Model model, const LineParams& p) {
    if (p.lengthKm <= 0.0) throw std::invalid_argument("L must be positive");
    Abcd r{};
    const cd z(p.resistancePerKmOhm, p.reactancePerKmOhm);
    const cd y(p.conductancePerKmS, p.susceptancePerKmS);
    const cd Z = z * p.lengthKm;
    const cd Y = y * p.lengthKm;

    if (model == Model::Short) {
        writePolar(r.A_mag, r.A_ang, cd(1, 0));
        writePolar(r.B_mag, r.B_ang, Z);
        writePolar(r.C_mag, r.C_ang, cd(0, 0));
        writePolar(r.D_mag, r.D_ang, cd(1, 0));
    } else if (model == Model::MediumPi) {
        const cd A = 1.0 + Y * Z / 2.0;
        const cd D = A;
        const cd B = Z;
        const cd C = Y * (1.0 + Y * Z / 4.0);
        writePolar(r.A_mag, r.A_ang, A);
        writePolar(r.B_mag, r.B_ang, B);
        writePolar(r.C_mag, r.C_ang, C);
        writePolar(r.D_mag, r.D_ang, D);
    } else {
        // Long line: γ = √(z·y), Z_c = √(z/y).
        const cd gamma = std::sqrt(z * y);
        const cd Zc = std::sqrt(z / y);
        const cd gL = gamma * p.lengthKm;
        const cd A = std::cosh(gL);
        const cd D = A;
        const cd B = Zc * std::sinh(gL);
        const cd C = std::sinh(gL) / Zc;
        writePolar(r.A_mag, r.A_ang, A);
        writePolar(r.B_mag, r.B_ang, B);
        writePolar(r.C_mag, r.C_ang, C);
        writePolar(r.D_mag, r.D_ang, D);
    }
    return r;
}

Result analyse(Model model, const LineParams& p, const LoadInput& load) {
    if (load.receivingPhaseVoltageV <= 0.0)
        throw std::invalid_argument("|V_R| must be positive");
    if (load.receivingPowerW < 0.0)
        throw std::invalid_argument("P_R must be ≥ 0");
    if (load.receivingPowerFactor <= 0.0 || load.receivingPowerFactor > 1.0)
        throw std::invalid_argument("pf must be in (0, 1]");

    Result r{};
    r.abcd = abcd(model, p);

    // Receiving-end phasors, V_R taken as reference (∠0°).
    const double V_R_mag = load.receivingPhaseVoltageV;
    const cd V_R(V_R_mag, 0.0);
    const double S_R_mag = load.receivingPowerW / load.receivingPowerFactor;  // |S_R|
    const double I_R_mag = S_R_mag / V_R_mag;
    const double phi_R = std::acos(load.receivingPowerFactor)
                       * (load.leading ? +1.0 : -1.0);  // lag: I lags V → negative angle
    const cd I_R = polar(I_R_mag, phi_R);

    // Sending-end via ABCD.
    const cd A = polar(r.abcd.A_mag, r.abcd.A_ang * pi / 180.0);
    const cd B = polar(r.abcd.B_mag, r.abcd.B_ang * pi / 180.0);
    const cd C = polar(r.abcd.C_mag, r.abcd.C_ang * pi / 180.0);
    const cd D = polar(r.abcd.D_mag, r.abcd.D_ang * pi / 180.0);

    const cd V_S = A * V_R + B * I_R;
    const cd I_S = C * V_R + D * I_R;

    r.sendingVoltageV = std::abs(V_S);
    r.sendingVoltageAngDeg = std::atan2(V_S.imag(), V_S.real()) * 180.0 / pi;
    r.sendingCurrentA = std::abs(I_S);
    r.sendingCurrentAngDeg = std::atan2(I_S.imag(), I_S.real()) * 180.0 / pi;

    // Sending-end power: S_S = V_S · conj(I_S).
    const cd S_S = V_S * std::conj(I_S);
    r.sendingRealPowerW = S_S.real();
    r.sendingApparentVA = std::abs(S_S);
    r.sendingPowerFactor = (r.sendingApparentVA > 0.0)
                              ? r.sendingRealPowerW / r.sendingApparentVA : 0.0;

    // Regulation: (|V_S|/|A| − |V_R|) / |V_R|.
    const double V_R_noLoad = r.sendingVoltageV / r.abcd.A_mag;
    r.regulationPct = (V_R_noLoad - V_R_mag) / V_R_mag * 100.0;

    // Per-phase efficiency.
    r.efficiency = (r.sendingRealPowerW > 0.0)
                       ? load.receivingPowerW / r.sendingRealPowerW : 0.0;
    return r;
}

}  // namespace forge::tline
