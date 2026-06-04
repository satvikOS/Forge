#include "forge/Clarifier.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::clarifier {

Result analyse(const Input& in) {
    if (in.designFlow_m3d <= 0)       throw std::runtime_error("Q > 0");
    if (in.tankDiameter_m <= 0)       throw std::runtime_error("D > 0");
    if (in.tankDepth_m <= 0)          throw std::runtime_error("SWD > 0");
    if (in.weirLength_m <= 0)         throw std::runtime_error("L_w > 0");
    if (in.returnSludgeRatio < 0)     throw std::runtime_error("R >= 0");
    if (in.mixedLiquorMLSS_kgM3 < 0)  throw std::runtime_error("MLSS >= 0");
    if (in.clarifierType < 0 || in.clarifierType > 1) throw std::runtime_error("type 0/1");

    const double A_s = M_PI * in.tankDiameter_m * in.tankDiameter_m / 4.0;
    const double V   = A_s * in.tankDepth_m;
    const double SOR = in.designFlow_m3d / A_s;
    const double WLR = in.designFlow_m3d / in.weirLength_m;
    const double HRT = V / in.designFlow_m3d * 24.0;        // hours
    const double Q_T = in.designFlow_m3d * (1.0 + in.returnSludgeRatio);
    const double SLR = Q_T * in.mixedLiquorMLSS_kgM3 / A_s;

    const double sorLimit = in.clarifierType == 0 ? 40.0 : 24.0;
    const double wlrLimit = 250.0;

    Result r;
    r.surfaceArea_m2  = A_s;
    r.tankVolume_m3   = V;
    r.SOR_mPerD       = SOR;
    r.WLR_m3PerMpD    = WLR;
    r.HRT_h           = HRT;
    r.SLR_kgPerM2D    = SLR;
    r.meetsSOR        = SOR <= sorLimit;
    r.meetsWLR        = WLR <= wlrLimit;
    return r;
}

}  // namespace forge::clarifier
