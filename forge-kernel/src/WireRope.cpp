// Forge-301 — implementation; see header for derivation references.

#include "forge/WireRope.hpp"

#include <algorithm>
#include <stdexcept>
#include <string>

namespace forge::wirerope {

namespace {

struct ClassFit {
    double K;   // F_u = K·d²  [N, mm]
    double w;   // d_w = d/w
    double a;   // A_m = a·d²
    double dD;  // recommended D/d
};

ClassFit fitForClass(const std::string& c) {
    if (c == "6x19") return {660.0, 16.0, 0.314, 34.0};
    if (c == "6x37") return {600.0, 22.0, 0.306, 23.0};
    if (c == "6x61") return {580.0, 27.0, 0.298, 18.0};
    throw std::runtime_error("ropeClass must be 6x19, 6x37, or 6x61");
}

double fosForApp(const std::string& a) {
    if (a == "hoist")    return 5.0;
    if (a == "elevator") return 11.0;
    if (a == "haulage")  return 6.0;
    if (a == "guy")      return 3.5;
    if (a == "track")    return 3.0;
    if (a == "mine")     return 8.0;
    throw std::runtime_error(
        "applicationClass must be one of: hoist, elevator, haulage, guy, track, mine");
}

}  // namespace

Result analyse(const Input& in) {
    if (in.nominalDiameterMm <= 0.0)
        throw std::runtime_error("nominalDiameterMm must be > 0");
    if (in.workingLoadN <= 0.0)
        throw std::runtime_error("workingLoadN must be > 0");
    if (in.sheaveDiameterMm <= 0.0)
        throw std::runtime_error("sheaveDiameterMm must be > 0");
    if (in.accelerationG <= 0.0)
        throw std::runtime_error("accelerationG must be > 0 (static = 1.0)");

    const auto fit = fitForClass(in.ropeClass);
    const double recFOS = fosForApp(in.applicationClass);

    constexpr double E_r_MPa = 12000.0;  // Shigley reduced rope modulus

    const double d  = in.nominalDiameterMm;
    const double D  = in.sheaveDiameterMm;

    const double Fu = fit.K * d * d;                        // breaking strength N
    const double dw = d / fit.w;                            // outer wire dia mm
    const double Am = fit.a * d * d;                        // metallic area mm²
    const double sb = E_r_MPa * dw / D;                     // MPa
    const double Fb = sb * Am;                              // N

    const double nAccel = std::max(1.0, in.accelerationG);
    const double Fapp_dyn = in.workingLoadN * nAccel;
    const double Ftot = Fapp_dyn + Fb;

    const double FOSstatic = Fu / in.workingLoadN;
    const double FOSdyn    = Fu / Fapp_dyn;
    const double FOStot    = Fu / Ftot;
    const double Dd        = D / d;

    Result r;
    r.breakingStrengthN          = Fu;
    r.factorOfSafetyStatic       = FOSstatic;
    r.factorOfSafetyDynamic      = FOSdyn;
    r.outerWireDiameterMm        = dw;
    r.bendingStressMPa           = sb;
    r.metallicAreaMm2            = Am;
    r.equivalentBendingTensionN  = Fb;
    r.totalEffectiveTensionN     = Ftot;
    r.factorOfSafetyTotal        = FOStot;
    r.sheaveRatio                = Dd;
    r.recommendedMinSheaveRatio  = fit.dD;
    r.recommendedFOS             = recFOS;
    r.sheavePasses               = Dd >= fit.dD;
    r.strengthPasses             = FOStot >= recFOS;
    r.passes                     = r.sheavePasses && r.strengthPasses;
    return r;
}

}  // namespace forge::wirerope
