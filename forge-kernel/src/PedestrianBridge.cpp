#include "forge/PedestrianBridge.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::pedvib {

Result analyse(const Input& in) {
    if (in.span_m <= 0)                  throw std::runtime_error("L > 0");
    if (in.EI_kNm2 <= 0)                 throw std::runtime_error("EI > 0");
    if (in.linearMass_kgM <= 0)          throw std::runtime_error("m > 0");
    if (in.pedestrianCountPerM2 <= 0)    throw std::runtime_error("d > 0");
    if (in.bridgeDeckWidth_m <= 0)       throw std::runtime_error("w > 0");

    const double EI_Nm2 = in.EI_kNm2 * 1.0e3;
    const double f1 = (M_PI / (2.0 * in.span_m * in.span_m))
                    * std::sqrt(EI_Nm2 / in.linearMass_kgM);
    const double N_ped = in.pedestrianCountPerM2 * in.bridgeDeckWidth_m * in.span_m;
    // SETRA equivalent walkers for dense crowd (≥ 1 ped/m²): n_eq = 10.8·√(N·ζ),
    // assume ζ = 0.005 → coefficient becomes 10.8·√0.005 = 0.7637·√N. Approximate:
    const double n_eq = 0.7637 * std::sqrt(N_ped);

    // SETRA simplified peak acceleration for vertical mode:
    //   a_max = (4 · n_eq · 0.4) / (π · m_total)
    const double m_total = in.linearMass_kgM * in.span_m;
    const double a_max = (4.0 * n_eq * 0.4) / (M_PI * m_total);

    Result r;
    r.firstFreq_Hz            = f1;
    r.resonantPedestrianCount = n_eq;
    r.peakAcceleration_mps2   = a_max;
    r.inVerticalResonance     = (f1 >= 1.6 && f1 <= 2.4);
    r.meetsComfortLimit       = a_max <= 0.5;
    return r;
}

}  // namespace forge::pedvib
