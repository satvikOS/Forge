// Forge-319e — see header.

#include "forge/BasementUplift.hpp"

#include <stdexcept>

namespace forge::buoyancy {

Result analyse(const Input& in) {
    if (in.basementWidthB_m <= 0.0 || in.basementLengthN_m <= 0.0)
        throw std::runtime_error("basement dimensions must be > 0");
    if (in.waterHeadAboveSlabM <= 0.0)
        throw std::runtime_error("waterHeadAboveSlabM must be > 0");
    if (in.slabSelfWeightKnPerM2 <= 0.0)
        throw std::runtime_error("slabSelfWeightKnPerM2 must be > 0");
    if (in.overburdenKnPerM2 < 0.0)
        throw std::runtime_error("overburdenKnPerM2 must be ≥ 0");
    if (in.waterUnitWeightKnPerM3 <= 0.0)
        throw std::runtime_error("waterUnitWeightKnPerM3 must be > 0");

    const double A = in.basementWidthB_m * in.basementLengthN_m;
    const double F_buoy = in.waterUnitWeightKnPerM3 * in.waterHeadAboveSlabM * A;
    const double W = (in.slabSelfWeightKnPerM2 + in.overburdenKnPerM2) * A;
    const double FOS = (F_buoy > 0.0) ? W / F_buoy : 0.0;

    Result r;
    r.slabAreaM2       = A;
    r.upliftForceKn    = F_buoy;
    r.weightForceKn    = W;
    r.netUpliftKn      = F_buoy - W;
    r.factorOfSafety   = FOS;
    r.passes           = FOS >= 1.10;
    return r;
}

}  // namespace forge::buoyancy
