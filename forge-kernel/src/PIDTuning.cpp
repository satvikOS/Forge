// Forge-264 — PID tuning implementation.

#include "forge/PIDTuning.hpp"

#include <stdexcept>

namespace forge::pidtuning {

ZieglerNicholsResult zieglerNichols(const ZieglerNicholsInput& in) {
    if (in.ultimateGainKu <= 0.0)
        throw std::invalid_argument("K_u must be > 0");
    if (in.ultimatePeriodPuSec <= 0.0)
        throw std::invalid_argument("P_u must be > 0");

    ZieglerNicholsResult r{};
    switch (in.controller) {
        case Controller::P:
            r.Kp = 0.5 * in.ultimateGainKu;
            break;
        case Controller::PI:
            r.Kp = 0.45 * in.ultimateGainKu;
            r.Ti = in.ultimatePeriodPuSec / 1.2;
            break;
        case Controller::PID:
            r.Kp = 0.6 * in.ultimateGainKu;
            r.Ti = in.ultimatePeriodPuSec / 2.0;
            r.Td = in.ultimatePeriodPuSec / 8.0;
            break;
    }
    return r;
}

CohenCoonResult cohenCoon(const CohenCoonInput& in) {
    if (in.processGainKp <= 0.0)
        throw std::invalid_argument("K_p must be > 0");
    if (in.timeConstantTau <= 0.0)
        throw std::invalid_argument("τ must be > 0");
    if (in.deadTimeTheta <= 0.0)
        throw std::invalid_argument("θ must be > 0");

    CohenCoonResult r{};
    const double tauOverTheta = in.timeConstantTau / in.deadTimeTheta;
    const double thetaOverTau = in.deadTimeTheta / in.timeConstantTau;

    switch (in.controller) {
        case Controller::P:
            r.Kp = (1.0 / in.processGainKp) * tauOverTheta
                   * (1.0 + thetaOverTau / 3.0);
            break;
        case Controller::PI:
            r.Kp = (1.0 / in.processGainKp) * tauOverTheta
                   * (0.9 + thetaOverTau / 12.0);
            r.Ti = in.deadTimeTheta
                   * (30.0 + 3.0 * thetaOverTau)
                   / (9.0 + 20.0 * thetaOverTau);
            break;
        case Controller::PID:
            r.Kp = (1.0 / in.processGainKp) * tauOverTheta
                   * (4.0 / 3.0 + thetaOverTau / 4.0);
            r.Ti = in.deadTimeTheta
                   * (32.0 + 6.0 * thetaOverTau)
                   / (13.0 + 8.0 * thetaOverTau);
            r.Td = in.deadTimeTheta * 4.0
                   / (11.0 + 2.0 * thetaOverTau);
            break;
    }
    return r;
}

}  // namespace forge::pidtuning
