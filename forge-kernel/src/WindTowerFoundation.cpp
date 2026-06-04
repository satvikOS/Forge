#include "forge/WindTowerFoundation.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::wtbase {

Result analyse(const Input& in) {
    if (in.thrustForce_kN <= 0)         throw std::runtime_error("F > 0");
    if (in.hubHeight_m <= 0)            throw std::runtime_error("h_hub > 0");
    if (in.towerWeight_kN <= 0)         throw std::runtime_error("W_tower > 0");
    if (in.foundationWidth_m <= 0)      throw std::runtime_error("B > 0");
    if (in.foundationDepth_m <= 0)      throw std::runtime_error("t > 0");
    if (in.concreteDensity_kgM3 <= 0)   throw std::runtime_error("ρ_c > 0");
    if (in.soilDensity_kgM3 <= 0)       throw std::runtime_error("ρ_soil > 0");
    if (in.soilCapDepth_m < 0)          throw std::runtime_error("cap depth >= 0");
    if (in.allowableBearing_kPa <= 0)   throw std::runtime_error("σ_allow > 0");

    constexpr double g = 9.80665;
    const double Wf = in.foundationWidth_m * in.foundationWidth_m * in.foundationDepth_m
                    * in.concreteDensity_kgM3 * g / 1000.0;                       // kN
    const double Wsoil = in.foundationWidth_m * in.foundationWidth_m * in.soilCapDepth_m
                       * in.soilDensity_kgM3 * g / 1000.0;
    const double W_total = in.towerWeight_kN + Wf + Wsoil;

    const double M_OT = in.thrustForce_kN * in.hubHeight_m;
    const double M_R  = W_total * in.foundationWidth_m / 2.0;
    const double SF   = M_OT > 0 ? M_R / M_OT : 0.0;

    // Eccentricity of resultant at base from moment about centroid:
    //   e = M_OT / W_total
    const double e = M_OT / W_total;
    const double B = in.foundationWidth_m;
    const double sigma_avg = W_total / (B * B);
    double sigma_max;
    if (e <= B / 6.0) {
        sigma_max = sigma_avg * (1.0 + 6.0 * e / B);
    } else {
        // Triangular pressure region: σ_max = 2·W / (3·B·(B/2 − e))
        const double lever = B / 2.0 - e;
        sigma_max = lever > 0 ? 2.0 * W_total / (3.0 * B * lever) : 1.0e9;
    }

    Result r;
    r.foundationWeight_kN       = Wf;
    r.soilCapWeight_kN          = Wsoil;
    r.totalGravity_kN           = W_total;
    r.overturningMoment_kNm     = M_OT;
    r.restoringMoment_kNm       = M_R;
    r.overturningSF             = SF;
    r.eccentricity_m            = e;
    r.maxBearingPressure_kPa    = sigma_max;
    r.sizeOK = (SF >= 1.5) && (e <= B / 6.0) && (sigma_max <= in.allowableBearing_kPa);
    return r;
}

}  // namespace forge::wtbase
