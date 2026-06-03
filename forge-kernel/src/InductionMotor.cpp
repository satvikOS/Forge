// Forge-246 — Induction motor implementation.

#include "forge/InductionMotor.hpp"

#include <cmath>
#include <complex>
#include <numbers>
#include <stdexcept>

namespace forge::inductionmotor {

namespace {
constexpr double pi = std::numbers::pi;

struct TheveninDecomp {
    double V;       // |V_th|
    double R;       // R_th
    double X;       // X_th
};

TheveninDecomp thevenin(double V_ph, double R1, double X1, double Xm) {
    using cd = std::complex<double>;
    const cd Z_stator(R1, X1);
    const cd Z_mag(0.0, Xm);
    const cd V_th = cd(V_ph, 0.0) * Z_mag / (Z_stator + Z_mag);
    const cd Z_th = Z_stator * Z_mag / (Z_stator + Z_mag);
    TheveninDecomp out{};
    out.V = std::abs(V_th);
    out.R = Z_th.real();
    out.X = Z_th.imag();
    return out;
}

double torqueAtSlip(double s, double V_th, double R_th, double X_th,
                    double R_2, double X_2, double omega_s) {
    if (s <= 0.0) return 0.0;
    const double R2_over_s = R_2 / s;
    const double denom = (R_th + R2_over_s) * (R_th + R2_over_s)
                       + (X_th + X_2) * (X_th + X_2);
    return (3.0 / omega_s) * V_th * V_th * R2_over_s / denom;
}

double rotorCurrent(double s, double V_th, double R_th, double X_th,
                    double R_2, double X_2) {
    if (s <= 0.0) return 0.0;
    const double R2_over_s = R_2 / s;
    const double denom = std::sqrt(
        (R_th + R2_over_s) * (R_th + R2_over_s)
        + (X_th + X_2) * (X_th + X_2));
    return V_th / denom;
}
}  // namespace

Result analyse(const Input& in) {
    if (in.phaseVoltageV <= 0.0) throw std::invalid_argument("V_ph must be positive");
    if (in.frequencyHz <= 0.0)   throw std::invalid_argument("f must be positive");
    if (in.poles <= 0 || (in.poles % 2) != 0)
        throw std::invalid_argument("poles must be even and positive");
    if (in.stator_R1 < 0.0 || in.stator_X1 < 0.0 || in.rotor_R2 <= 0.0
        || in.rotor_X2 < 0.0 || in.mag_Xm <= 0.0)
        throw std::invalid_argument("circuit elements must be ≥ 0 (R_2, X_m > 0)");
    if (in.slip <= 0.0 || in.slip > 1.0)
        throw std::invalid_argument("slip must be in (0, 1]");

    Result r{};
    r.synchronousRadPerS = 4.0 * pi * in.frequencyHz / static_cast<double>(in.poles);
    r.synchronousRpm = r.synchronousRadPerS * 60.0 / (2.0 * pi);
    r.mechanicalRpm = (1.0 - in.slip) * r.synchronousRpm;

    const auto th = thevenin(in.phaseVoltageV, in.stator_R1, in.stator_X1, in.mag_Xm);
    r.thevenin_V = th.V;
    r.thevenin_R = th.R;
    r.thevenin_X = th.X;

    r.developedTorqueNm = torqueAtSlip(in.slip, th.V, th.R, th.X,
                                        in.rotor_R2, in.rotor_X2,
                                        r.synchronousRadPerS);
    r.airGapPowerW = r.developedTorqueNm * r.synchronousRadPerS;
    r.mechPowerW = (1.0 - in.slip) * r.airGapPowerW;
    r.rotorCopperLossW = in.slip * r.airGapPowerW;
    r.rotorCurrentA = rotorCurrent(in.slip, th.V, th.R, th.X,
                                    in.rotor_R2, in.rotor_X2);

    r.breakdownSlip = in.rotor_R2
                    / std::sqrt(th.R * th.R + (th.X + in.rotor_X2) * (th.X + in.rotor_X2));
    r.breakdownTorqueNm = (3.0 / r.synchronousRadPerS) * 0.5 * th.V * th.V
                        / (th.R + std::sqrt(th.R * th.R
                            + (th.X + in.rotor_X2) * (th.X + in.rotor_X2)));

    r.startingTorqueNm = torqueAtSlip(1.0, th.V, th.R, th.X,
                                       in.rotor_R2, in.rotor_X2,
                                       r.synchronousRadPerS);
    r.startingCurrentA = rotorCurrent(1.0, th.V, th.R, th.X,
                                       in.rotor_R2, in.rotor_X2);
    return r;
}

}  // namespace forge::inductionmotor
