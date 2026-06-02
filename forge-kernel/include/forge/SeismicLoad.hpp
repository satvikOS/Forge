#pragma once

// Forge-234 — Seismic Equivalent Lateral Force (ASCE 7-22 §12.8).
//
// Approximate fundamental period (Eq. 12.8-7):
//   T_a = C_t · h_n^x
//   Steel MRF:        C_t = 0.028, x = 0.8
//   Concrete MRF:     C_t = 0.016, x = 0.9
//   Eccentric braced: C_t = 0.030, x = 0.75
//   Other:            C_t = 0.020, x = 0.75
//
// Seismic response coefficient (Eq. 12.8-2 with bounds 12.8-3..6):
//   C_s     = S_DS / (R / I_e)
//   C_s_max = S_D1 / (T · (R / I_e))            for T ≤ T_L
//           = S_D1 · T_L / (T² · (R / I_e))     for T > T_L
//   C_s_min = max(0.044 · S_DS · I_e, 0.01)
//
// Seismic base shear:
//   V = C_s · W
//
// All inputs SI: heights in metres, S_DS / S_D1 dimensionless g
// (i.e. fractions of gravity), W in N. R and I_e dimensionless.

#include <string>

namespace forge { namespace seismic {

enum class StructuralSystem {
    SteelMomentFrame,
    ConcreteMomentFrame,
    SteelEccentricBraced,
    Other,
};

StructuralSystem systemFromString(const std::string& s);

double approximateFundamentalPeriod(StructuralSystem sys, double heightM);

struct CsInputs {
    double SDS;
    double SD1;
    double T;        // s
    double TL;       // s
    double R;
    double Ie;
};

struct CsOutputs {
    double CsBasic;      // S_DS / (R/I_e), before bounds
    double CsMax;        // upper bound from S_D1 branch
    double CsMin;        // minimum clause
    double CsGoverning;  // basic clamped to [min, max]
};

CsOutputs seismicResponseCoefficient(const CsInputs& in);

double baseShear(double Cs, double seismicWeight);

}} // namespace forge::seismic
