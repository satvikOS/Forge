// Forge-299 — implementation; see header for derivation references.

#include "forge/Catenary.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::catenary {

Result analyse(const Input& in) {
    if (in.spanM <= 0.0)
        throw std::runtime_error("spanM must be > 0");
    if (in.horizontalTensionN <= 0.0)
        throw std::runtime_error("horizontalTensionN must be > 0");
    if (in.linearWeightNPerM <= 0.0)
        throw std::runtime_error("linearWeightNPerM must be > 0");

    const double L = in.spanM;
    const double H = in.horizontalTensionN;
    const double w = in.linearWeightNPerM;
    const double c = H / w;

    const double halfL = L / 2.0;
    const double sag      = c * (std::cosh(halfL / c) - 1.0);
    const double sag_par  = w * L * L / (8.0 * H);
    const double Tmax     = H * std::cosh(halfL / c);
    const double Lcable   = 2.0 * c * std::sinh(halfL / c);
    const double Lcable_p = L + 8.0 * sag_par * sag_par / (3.0 * L);

    Result r;
    r.catenaryParameterM      = c;
    r.sagM                    = sag;
    r.sagParabolicM           = sag_par;
    r.maxTensionN             = Tmax;
    r.cableLengthM            = Lcable;
    r.cableLengthParabolicM   = Lcable_p;
    r.sagRatio                = sag / L;
    return r;
}

}  // namespace forge::catenary
