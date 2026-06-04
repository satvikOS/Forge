#include "forge/SlipCritical.hpp"

#include <stdexcept>

namespace forge::sccrit {

Result analyse(const Input& in) {
    if (in.slipCoefficient_mu <= 0)        throw std::runtime_error("μ > 0");
    if (in.fillerCount_hf < 0)             throw std::runtime_error("filler count >= 0");
    if (in.pretension_Tb_kN <= 0)          throw std::runtime_error("T_b > 0");
    if (in.slipPlaneCount_ns <= 0)         throw std::runtime_error("n_s > 0");
    if (in.boltCount_nb <= 0)              throw std::runtime_error("n_b > 0");
    if (in.Tu_per_bolt_kN < 0)             throw std::runtime_error("T_u >= 0");
    if (in.phi_for_holeType <= 0)          throw std::runtime_error("φ > 0");

    constexpr double Du = 1.13;
    const double hf = in.fillerCount_hf == 0 ? 1.0 : 0.85;
    const double total_pretension = Du * in.pretension_Tb_kN * in.boltCount_nb;
    const double ksc = total_pretension > 0
                     ? (1.0 - in.Tu_per_bolt_kN * in.boltCount_nb / total_pretension)
                     : 0.0;
    const double Rn_bolt = in.slipCoefficient_mu * Du * hf * in.pretension_Tb_kN
                          * in.slipPlaneCount_ns * ksc;
    const double Rn_total = Rn_bolt * in.boltCount_nb;
    const double phiRn = in.phi_for_holeType * Rn_total;

    Result r;
    r.Du               = Du;
    r.hf               = hf;
    r.Ksc_reduction    = ksc;
    r.Rn_per_bolt_kN   = Rn_bolt;
    r.Rn_total_kN      = Rn_total;
    r.phiRn_total_kN   = phiRn;
    return r;
}

}  // namespace forge::sccrit
