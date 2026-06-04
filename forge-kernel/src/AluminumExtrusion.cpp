#include "forge/AluminumExtrusion.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::adm {

// ADM 2020 Table A.3.4 minimum mechanical properties (MPa).
struct AlloyProperty {
    const char* tag;
    double Fy_MPa;
    double Fu_MPa;
    double E_MPa;
};

static AlloyProperty pick(const std::string& tag) {
    static const AlloyProperty table[] = {
        {"6061-T6", 240, 260, 69600},
        {"6063-T5", 110, 150, 69600},
        {"6063-T6", 170, 205, 69600},
        {"5052-H32", 180, 230, 69600},
        {"3003-H14", 145, 150, 69600},
    };
    for (const auto& a : table) if (tag == a.tag) return a;
    throw std::runtime_error("unknown alloy");
}

Result analyse(const Input& in) {
    if (in.effectiveLength_mm <= 0)      throw std::runtime_error("kL > 0");
    if (in.radiusOfGyration_mm <= 0)     throw std::runtime_error("r > 0");
    if (in.flatWidth_b_mm <= 0)          throw std::runtime_error("b > 0");
    if (in.flatThickness_t_mm <= 0)      throw std::runtime_error("t > 0");
    if (in.safetyFactor_Omega <= 0)      throw std::runtime_error("Ω > 0");

    AlloyProperty p = pick(in.alloy);
    const double lambda = in.effectiveLength_mm / in.radiusOfGyration_mm;

    // ADM Eq F.4-2 simplified column buckling parameters.
    const double B_c = p.Fy_MPa * (1.0 + std::pow(p.Fy_MPa / (1.5 * p.E_MPa), 1.0/3.0)
                                          * std::sqrt(p.Fy_MPa / 1000.0));
    const double D_c = (B_c / 10.0) * std::sqrt(B_c / p.E_MPa);
    const double S1 = (B_c - p.Fy_MPa) / D_c;
    const double S2 = std::sqrt(M_PI * M_PI * p.E_MPa / B_c);

    double Fa;
    if (lambda <= S1)               Fa = p.Fy_MPa / in.safetyFactor_Omega;
    else if (lambda <= S2)          Fa = (B_c - D_c * lambda) / in.safetyFactor_Omega;
    else                            Fa = (M_PI * M_PI * p.E_MPa) / (in.safetyFactor_Omega * lambda * lambda);

    const double bt = in.flatWidth_b_mm / in.flatThickness_t_mm;
    // ADM Table B.4.3 for unstiffened flat element: λ_p ≈ 0.43·√(E/F_y), λ_r ≈ 1.40·√(E/F_y)
    const double lambda_r = 1.40 * std::sqrt(p.E_MPa / p.Fy_MPa);

    Result r;
    r.yieldStrength_MPa            = p.Fy_MPa;
    r.ultimateStrength_MPa         = p.Fu_MPa;
    r.modulus_MPa                  = p.E_MPa;
    r.slenderness                  = lambda;
    r.allowableAxialStress_MPa     = Fa;
    r.btRatio                      = bt;
    r.localBucklingControlled      = bt > lambda_r;
    return r;
}

}  // namespace forge::adm
