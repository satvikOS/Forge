// Forge-241 — Pile capacity implementation.

#include "forge/PileCapacity.hpp"

#include <algorithm>
#include <cmath>
#include <numbers>
#include <stdexcept>

namespace forge::pilecap {

namespace {
constexpr double pi = std::numbers::pi;
}

Result analyse(const Input& in) {
    if (in.diameterM <= 0.0)
        throw std::invalid_argument("pile diameter must be positive");
    if (in.layers.empty())
        throw std::invalid_argument("at least one soil layer required");
    if (in.factorOfSafety <= 0.0)
        throw std::invalid_argument("FS must be positive");

    Result r{};
    const double Ap = pi * 0.25 * in.diameterM * in.diameterM;
    const double perim = pi * in.diameterM;

    double depthTop = 0.0;
    double sigmaVAtTop = 0.0;  // effective vertical stress at top of layer

    for (const auto& L : in.layers) {
        if (L.thicknessM <= 0.0)
            throw std::invalid_argument("layer thickness must be positive");
        if (L.effectiveUnitWeightNPerM3 <= 0.0)
            throw std::invalid_argument("layer γ' must be positive");

        const double depthBot = depthTop + L.thicknessM;
        const double depthMid = depthTop + 0.5 * L.thicknessM;
        const double sigmaVAtMid = sigmaVAtTop
                                + L.effectiveUnitWeightNPerM3 * (0.5 * L.thicknessM);

        double f_s = 0.0;
        if (L.type == SoilType::Clay) {
            if (L.undrainedShearStrengthPa < 0.0)
                throw std::invalid_argument("c_u must be ≥ 0");
            const double alpha = (L.alpha > 0.0) ? L.alpha : 1.0;
            f_s = alpha * L.undrainedShearStrengthPa;
        } else {
            const double phi = L.frictionAngleDeg * pi / 180.0;
            const double sinphi = std::sin(phi);
            const double tanphi = std::tan(phi);
            const double beta = (L.beta > 0.0) ? L.beta
                                                : (1.0 - sinphi) * tanphi;
            f_s = beta * sigmaVAtMid;
        }

        LayerResult lr{};
        lr.topDepthM = depthTop;
        lr.bottomDepthM = depthBot;
        lr.effectiveStressAtMidPa = sigmaVAtMid;
        lr.skinFrictionPa = f_s;
        lr.skinForceN = f_s * perim * L.thicknessM;
        r.layers.push_back(lr);
        r.shaftForceN += lr.skinForceN;

        sigmaVAtTop += L.effectiveUnitWeightNPerM3 * L.thicknessM;
        depthTop = depthBot;
    }

    r.effectiveStressAtTipPa = sigmaVAtTop;  // bottom of last layer

    const Layer& tipLayer = in.layers.back();
    if (tipLayer.type == SoilType::Clay) {
        r.tipBearingPa = 9.0 * tipLayer.undrainedShearStrengthPa;
    } else {
        const double q_p_raw = in.Nq_tip * r.effectiveStressAtTipPa;
        r.tipBearingPa = (in.limitTipBearingPa > 0.0)
                            ? std::min(q_p_raw, in.limitTipBearingPa)
                            : q_p_raw;
    }
    r.tipForceN = r.tipBearingPa * Ap;
    r.ultimateCapacityN = r.shaftForceN + r.tipForceN;
    r.allowableCapacityN = r.ultimateCapacityN / in.factorOfSafety;
    return r;
}

}  // namespace forge::pilecap
