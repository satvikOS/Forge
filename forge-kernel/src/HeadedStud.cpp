// Forge-296 — implementation; see header for derivation references.

#include "forge/HeadedStud.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::headedstud {

constexpr double PI = 3.14159265358979323846;

Result analyse(const Input& in) {
    if (in.studDiameterMm <= 0.0)
        throw std::runtime_error("studDiameterMm must be > 0");
    if (in.concreteStrengthMPa <= 0.0)
        throw std::runtime_error("concreteStrengthMPa must be > 0");
    if (in.concreteUnitWeightKgM3 <= 0.0)
        throw std::runtime_error("concreteUnitWeightKgM3 must be > 0");
    if (in.studUltimateStressMPa <= 0.0)
        throw std::runtime_error("studUltimateStressMPa must be > 0");
    if (in.groupFactorRg <= 0.0 || in.groupFactorRg > 1.0)
        throw std::runtime_error("groupFactorRg must be in (0, 1]");
    if (in.positionFactorRp <= 0.0 || in.positionFactorRp > 1.0)
        throw std::runtime_error("positionFactorRp must be in (0, 1]");
    if (in.studCount < 1)
        throw std::runtime_error("studCount must be ≥ 1");
    if (in.requiredHorizShearKN <= 0.0)
        throw std::runtime_error("requiredHorizShearKN must be > 0");

    const double A_sc = PI * in.studDiameterMm * in.studDiameterMm / 4.0;
    // ACI 318-19 §19.2.2.1.b: E_c = w_c^1.5 · 0.043 · √f'_c with w_c kg/m³.
    const double w15 = std::pow(in.concreteUnitWeightKgM3, 1.5);
    const double E_c = w15 * 0.043 * std::sqrt(in.concreteStrengthMPa);

    // Q_n,conc and Q_n,steel in N (A_sc in mm², stresses MPa → N).
    const double Q_conc  = 0.5 * A_sc
                          * std::sqrt(in.concreteStrengthMPa * E_c);
    const double Q_steel = in.groupFactorRg * in.positionFactorRp
                          * A_sc * in.studUltimateStressMPa;
    const double Q_n     = std::min(Q_conc, Q_steel);
    const double total_kN = Q_n * static_cast<double>(in.studCount) / 1000.0;
    const double dcr      = in.requiredHorizShearKN / total_kN;

    Result r;
    r.studAreaMm2            = A_sc;
    r.concreteModulusMPa     = E_c;
    r.qNominalConcreteN      = Q_conc;
    r.qNominalSteelN         = Q_steel;
    r.qNominalSingleN        = Q_n;
    r.totalCapacityKN        = total_kN;
    r.demandCapacityRatio    = dcr;
    r.passes                 = dcr <= 1.0;
    return r;
}

}  // namespace forge::headedstud
