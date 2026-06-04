#include "forge/PierScour.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::pierscour {

Result analyse(const Input& in) {
    if (in.approachVelocity_mps <= 0) throw std::runtime_error("V_1 > 0");
    if (in.approachDepth_m <= 0)      throw std::runtime_error("y_1 > 0");
    if (in.pierWidth_m <= 0)          throw std::runtime_error("a > 0");
    if (in.pierLength_m <= 0)         throw std::runtime_error("L > 0");
    if (in.attackAngleDeg < 0 || in.attackAngleDeg >= 90)
        throw std::runtime_error("θ in [0, 90)");
    if (in.pierShape < 0 || in.pierShape > 2)         throw std::runtime_error("shape 0-2");
    if (in.bedCondition < 0 || in.bedCondition > 2)   throw std::runtime_error("bed 0-2");
    if (in.K4_armoring <= 0)          throw std::runtime_error("K_4 > 0");

    constexpr double g = 9.80665;
    const double Fr1 = in.approachVelocity_mps / std::sqrt(g * in.approachDepth_m);
    const double K1 = in.pierShape == 0 ? 1.0 : in.pierShape == 1 ? 1.1 : 0.9;
    const double theta = in.attackAngleDeg * M_PI / 180.0;
    const double K2 = std::pow(std::cos(theta)
                             + (in.pierLength_m / in.pierWidth_m) * std::sin(theta), 0.65);
    const double K3 = in.bedCondition == 0 ? 1.1 :
                      in.bedCondition == 1 ? 1.2 : 1.3;
    const double ratio = 2.0 * K1 * K2 * K3 * in.K4_armoring
                       * std::pow(in.pierWidth_m / in.approachDepth_m, 0.65)
                       * std::pow(Fr1, 0.43);
    const double y_s = ratio * in.approachDepth_m;

    Result r;
    r.approachFroude_Fr1   = Fr1;
    r.K1_shape             = K1;
    r.K2_angle             = K2;
    r.K3_bed               = K3;
    r.scourDepth_ys_m      = y_s;
    r.scourRatio_ysOverY1  = ratio;
    return r;
}

}  // namespace forge::pierscour
