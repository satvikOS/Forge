// Forge-253 — Lighting design implementation.

#include "forge/Lighting.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::lighting {

double roomCavityRatio(const RoomGeom& g) {
    if (g.lengthM <= 0.0 || g.widthM <= 0.0)
        throw std::invalid_argument("room L, W must be positive");
    if (g.mountingHeightM <= 0.0)
        throw std::invalid_argument("cavity height must be positive");
    return 5.0 * g.mountingHeightM * (g.lengthM + g.widthM)
           / (g.lengthM * g.widthM);
}

double coefficientOfUtilization(double rcr) {
    if (rcr < 0.0) throw std::invalid_argument("RCR must be ≥ 0");
    double cu = 0.85 - 0.045 * rcr + 0.0015 * rcr * rcr;
    if (cu < 0.05) cu = 0.05;
    if (cu > 0.95) cu = 0.95;
    return cu;
}

LumenMethodResult lumenMethod(const LumenMethodInput& in) {
    if (in.lumensPerLuminaire <= 0.0)
        throw std::invalid_argument("lumensPerLuminaire must be > 0");
    if (in.lightLossFactor <= 0.0 || in.lightLossFactor > 1.0)
        throw std::invalid_argument("LLF must be in (0, 1]");

    LumenMethodResult r{};
    r.rcr = roomCavityRatio(in.room);
    r.cu = (in.cuOverride > 0.0) ? in.cuOverride : coefficientOfUtilization(r.rcr);

    const double area = in.room.lengthM * in.room.widthM;
    if (in.luminaireCount > 0) {
        r.illuminanceLux = in.luminaireCount * in.lumensPerLuminaire
                          * r.cu * in.lightLossFactor / area;
        r.computedTotalLumens = static_cast<double>(in.luminaireCount)
                              * in.lumensPerLuminaire;
        r.requiredLuminaires = in.luminaireCount;
    } else {
        if (in.targetIlluminanceLux <= 0.0)
            throw std::invalid_argument("E_target must be > 0 when N == 0");
        const double N_exact = in.targetIlluminanceLux * area
                             / (in.lumensPerLuminaire * r.cu * in.lightLossFactor);
        r.requiredLuminaires = static_cast<int>(std::ceil(N_exact));
        if (r.requiredLuminaires < 1) r.requiredLuminaires = 1;
        r.illuminanceLux = r.requiredLuminaires * in.lumensPerLuminaire
                          * r.cu * in.lightLossFactor / area;
        r.computedTotalLumens = static_cast<double>(r.requiredLuminaires)
                              * in.lumensPerLuminaire;
    }
    return r;
}

}  // namespace forge::lighting
