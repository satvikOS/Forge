#include "forge/SlabOneWay.hpp"

#include <stdexcept>
#include <string>

namespace forge::slaboneway {

Result analyse(const Input& in) {
    if (in.spanLength_m <= 0) throw std::runtime_error("span > 0");
    if (in.slabThickness_mm <= 0) throw std::runtime_error("thickness > 0");
    if (in.effectiveDepth_d_mm <= 0) throw std::runtime_error("d > 0");
    if (in.areaSteelMm2PerM <= 0) throw std::runtime_error("A_s > 0");
    if (in.fc_MPa <= 0) throw std::runtime_error("f'_c > 0");
    if (in.fy_MPa <= 0) throw std::runtime_error("f_y > 0");

    double divisor;
    if (in.supportCondition == "simple") divisor = 20.0;
    else if (in.supportCondition == "one-cont") divisor = 24.0;
    else if (in.supportCondition == "both-cont") divisor = 28.0;
    else if (in.supportCondition == "cantilever") divisor = 10.0;
    else throw std::runtime_error("supportCondition must be simple | one-cont | both-cont | cantilever");

    const double t_min_mm = in.spanLength_m * 1000.0 / divisor;

    const double b = 1000.0;     // per-m strip
    const double a = in.areaSteelMm2PerM * in.fy_MPa / (0.85 * in.fc_MPa * b);
    const double Mn_Nmm = in.areaSteelMm2PerM * in.fy_MPa * (in.effectiveDepth_d_mm - a / 2.0);

    Result r;
    r.minimumThicknessMm      = t_min_mm;
    r.a_mm                    = a;
    r.nominalMoment_kNmPerM   = Mn_Nmm / 1.0e6;
    r.designMoment_kNmPerM    = 0.9 * Mn_Nmm / 1.0e6;
    r.thicknessAdequate       = in.slabThickness_mm >= t_min_mm;
    return r;
}

}  // namespace forge::slaboneway
