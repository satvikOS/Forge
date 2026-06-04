#include "forge/Lighting901LPD.hpp"

#include <stdexcept>
#include <string>

namespace forge::lpd {

Result analyse(const Input& in) {
    if (in.floorAreaM2 <= 0) throw std::runtime_error("A > 0");
    if (in.installedPowerW < 0) throw std::runtime_error("P ≥ 0");

    double allowance;
    if      (in.spaceType == "office")      allowance = 0.61;
    else if (in.spaceType == "retail")      allowance = 0.84;
    else if (in.spaceType == "classroom")   allowance = 0.71;
    else if (in.spaceType == "warehouse")   allowance = 0.49;
    else if (in.spaceType == "hospital")    allowance = 0.85;
    else if (in.spaceType == "garage")      allowance = 0.13;
    else if (in.spaceType == "restaurant")  allowance = 0.88;
    else if (in.spaceType == "hotel")       allowance = 0.50;
    else if (in.spaceType == "industrial")  allowance = 0.92;
    else throw std::runtime_error("spaceType must be office | retail | classroom | warehouse | hospital | garage | restaurant | hotel | industrial");

    const double allowed = allowance * in.floorAreaM2;
    const double overshoot = in.installedPowerW - allowed;
    const double overshoot_pct = (allowed > 0) ? 100.0 * overshoot / allowed : 0.0;

    Result r;
    r.allowanceWperM2  = allowance;
    r.allowedPowerW    = allowed;
    r.overshootW       = overshoot;
    r.overshootPercent = overshoot_pct;
    r.compliant        = in.installedPowerW <= allowed;
    return r;
}

}  // namespace forge::lpd
