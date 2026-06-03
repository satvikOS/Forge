// Forge-291 — implementation; see header for derivation references.

#include "forge/BevelGear.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::bevelgear {

constexpr double PI = 3.14159265358979323846;

Result analyse(const Input& in) {
    if (in.moduleMm <= 0.0)
        throw std::runtime_error("moduleMm must be > 0");
    if (in.pinionTeeth < 8 || in.pinionTeeth > 200)
        throw std::runtime_error("pinionTeeth must be in [8, 200]");
    if (in.gearTeeth < 8 || in.gearTeeth > 200)
        throw std::runtime_error("gearTeeth must be in [8, 200]");
    if (in.faceWidthMm <= 0.0)
        throw std::runtime_error("faceWidthMm must be > 0");
    if (in.pressureAngleDeg <= 0.0 || in.pressureAngleDeg >= 45.0)
        throw std::runtime_error("pressureAngleDeg must be in (0, 45)");
    if (in.pinionTorqueNm <= 0.0)
        throw std::runtime_error("pinionTorqueNm must be > 0");

    const double m  = in.moduleMm;
    const int    Np = in.pinionTeeth;
    const int    Ng = in.gearTeeth;
    const double F  = in.faceWidthMm;
    const double phi_n = in.pressureAngleDeg * PI / 180.0;
    const double Tp = in.pinionTorqueNm;

    const double dp = static_cast<double>(Np) * m;
    const double dg = static_cast<double>(Ng) * m;

    // 90° shafts: tan γ_p = N_p / N_g.
    const double gamma_p = std::atan(static_cast<double>(Np) / static_cast<double>(Ng));
    const double gamma_g = PI / 2.0 - gamma_p;

    // Cone distance R (= slant of the rolling cone).
    const double R = std::sqrt((dp / 2.0) * (dp / 2.0) + (dg / 2.0) * (dg / 2.0));

    if (F >= R)
        throw std::runtime_error("faceWidthMm must be < coneDistanceMm");

    // Mean cone radius at the centroid of the tooth.
    const double r_m_p = (R - F / 2.0) * std::sin(gamma_p);

    // Tredgold equivalent spur teeth (used for Lewis form factor lookup).
    const double N_ep = static_cast<double>(Np) / std::cos(gamma_p);
    const double N_eg = static_cast<double>(Ng) / std::cos(gamma_g);

    // Force components — convert T from N·m → N·mm to match r_m_p (mm).
    const double Wt = (Tp * 1000.0) / r_m_p;
    const double Wr = Wt * std::tan(phi_n) * std::cos(gamma_p);
    const double Wa = Wt * std::tan(phi_n) * std::sin(gamma_p);

    Result r;
    r.gearRatio                = static_cast<double>(Ng) / static_cast<double>(Np);
    r.pinionConeAngleDeg       = gamma_p * 180.0 / PI;
    r.gearConeAngleDeg         = gamma_g * 180.0 / PI;
    r.pinionPitchDiameterMm    = dp;
    r.gearPitchDiameterMm      = dg;
    r.coneDistanceMm           = R;
    r.pinionMeanRadiusMm       = r_m_p;
    r.equivalentPinionTeeth    = N_ep;
    r.equivalentGearTeeth      = N_eg;
    r.tangentialForceN         = Wt;
    r.radialForceN             = Wr;
    r.axialForceN              = Wa;
    return r;
}

}  // namespace forge::bevelgear
