// Forge-310 — implementation; see header for derivation references.

#include "forge/BlockShear.hpp"

#include <stdexcept>

namespace forge::blockshear {

Result analyse(const Input& in) {
    if (in.A_gv_mm2 <= 0.0)
        throw std::runtime_error("A_gv_mm2 must be > 0");
    if (in.A_nv_mm2 <= 0.0 || in.A_nv_mm2 > in.A_gv_mm2)
        throw std::runtime_error("A_nv_mm2 must be in (0, A_gv]");
    if (in.A_nt_mm2 <= 0.0)
        throw std::runtime_error("A_nt_mm2 must be > 0");
    if (in.U_bs != 1.0 && in.U_bs != 0.5)
        throw std::runtime_error("U_bs must be 1.0 (uniform) or 0.5 (non-uniform)");
    if (in.Fy_MPa <= 0.0)
        throw std::runtime_error("Fy_MPa must be > 0");
    if (in.Fu_MPa <= 0.0)
        throw std::runtime_error("Fu_MPa must be > 0");
    if (in.Fu_MPa < in.Fy_MPa)
        throw std::runtime_error("Fu_MPa must be ≥ Fy_MPa");

    const double shearRupt   = 0.6 * in.Fu_MPa * in.A_nv_mm2;          // N
    const double shearYield  = 0.6 * in.Fy_MPa * in.A_gv_mm2;          // N
    const double tensionRupt = in.U_bs * in.Fu_MPa * in.A_nt_mm2;      // N

    double govShear;
    int    path;
    if (shearRupt <= shearYield) {
        govShear = shearRupt;
        path = 1;
    } else {
        govShear = shearYield;
        path = 2;
    }

    const double Rn   = govShear + tensionRupt;
    const double phi  = 0.75;
    const double omega = 2.00;

    Result r;
    r.shearRuptureCapN   = shearRupt;
    r.shearYieldingCapN  = shearYield;
    r.tensionRuptureN    = tensionRupt;
    r.governingShearN    = govShear;
    r.nominalCapN        = Rn;
    r.LRFDcapN           = phi * Rn;
    r.ASDcapN            = Rn / omega;
    r.governingPath      = path;
    return r;
}

}  // namespace forge::blockshear
