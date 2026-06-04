#include "forge/MohrCoulomb.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::mc {

Result analyse(const Input& in) {
    if (in.cohesionKpa < 0.0) throw std::runtime_error("c ≥ 0");
    if (in.frictionAngleDeg < 0.0 || in.frictionAngleDeg >= 90.0)
        throw std::runtime_error("φ in [0, 90)");
    if (in.normalStressKpa < 0.0) throw std::runtime_error("σ_n ≥ 0");

    const double phi = in.frictionAngleDeg * 3.141592653589793 / 180.0;
    const double f_contrib = in.normalStressKpa * std::tan(phi);
    const double tau = in.cohesionKpa + f_contrib;

    Result r;
    r.cohesionContributionKpa = in.cohesionKpa;
    r.frictionContributionKpa = f_contrib;
    r.shearStrengthKpa        = tau;
    return r;
}

}  // namespace forge::mc
