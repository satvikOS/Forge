#include "forge/CraneRunway.hpp"

#include <stdexcept>

namespace forge::cranerunway {

Result analyse(const Input& in) {
    if (in.maxWheelLoadKn <= 0) throw std::runtime_error("P > 0");
    if (in.spanLengthM <= 0) throw std::runtime_error("span > 0");
    if (in.impactFactor < 0 || in.impactFactor > 1) throw std::runtime_error("impact in [0,1]");
    if (in.lateralFraction < 0 || in.lateralFraction > 1) throw std::runtime_error("lateral in [0,1]");

    const double P_imp = in.maxWheelLoadKn * (1.0 + in.impactFactor);
    const double P_lat = in.maxWheelLoadKn * in.lateralFraction;
    const double Mv = P_imp * in.spanLengthM / 4.0;
    const double Ml = P_lat * in.spanLengthM / 4.0;
    const double Mcomb = Mv + Ml;   // simplified, formal §H1 needs M_y inputs

    Result r;
    r.wheelLoadWithImpactKn      = P_imp;
    r.lateralLoadKn              = P_lat;
    r.verticalMomentKnm          = Mv;
    r.lateralMomentKnm           = Ml;
    r.combinedDesignMomentKnm    = Mcomb;
    return r;
}

}  // namespace forge::cranerunway
