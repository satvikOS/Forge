#include "forge/MasonryWall.hpp"

#include <stdexcept>

namespace forge::masonry {

Result analyse(const Input& in) {
    if (in.wallWidthB_mm <= 0.0) throw std::runtime_error("b > 0");
    if (in.effectiveDepth_d_mm <= 0.0) throw std::runtime_error("d > 0");
    if (in.steelAreaAs_mm2 <= 0.0) throw std::runtime_error("A_s > 0");
    if (in.factoredAxialPu_kN < 0.0) throw std::runtime_error("P_u ≥ 0");
    if (in.fm_MPa <= 0.0) throw std::runtime_error("f'_m > 0");
    if (in.fy_MPa <= 0.0) throw std::runtime_error("f_y > 0");

    const double Pu_N = in.factoredAxialPu_kN * 1000.0;
    const double Ase = in.steelAreaAs_mm2 + Pu_N / in.fy_MPa;
    const double a = (Ase * in.fy_MPa + Pu_N) / (0.80 * in.fm_MPa * in.wallWidthB_mm);
    const double Mn_Nmm = Ase * in.fy_MPa * (in.effectiveDepth_d_mm - a / 2.0);

    Result r;
    r.aMm                  = a;
    r.Ase_mm2              = Ase;
    r.nominalMoment_kNm    = Mn_Nmm / 1.0e6;
    r.designMoment_kNm     = 0.9 * Mn_Nmm / 1.0e6;
    return r;
}

}  // namespace forge::masonry
