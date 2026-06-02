#include "forge/SeismicLoad.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge { namespace seismic {

StructuralSystem systemFromString(const std::string& s) {
    if (s == "steel-mrf"      || s == "steel")    return StructuralSystem::SteelMomentFrame;
    if (s == "concrete-mrf"   || s == "concrete") return StructuralSystem::ConcreteMomentFrame;
    if (s == "steel-ebf"      || s == "ebf")      return StructuralSystem::SteelEccentricBraced;
    if (s == "other")                              return StructuralSystem::Other;
    throw std::invalid_argument("seismic: system must be steel-mrf|concrete-mrf|steel-ebf|other");
}

namespace {
struct PeriodParams { double Ct; double x; };
PeriodParams params(StructuralSystem sys) {
    switch (sys) {
        case StructuralSystem::SteelMomentFrame:    return { 0.0724, 0.8  };
        case StructuralSystem::ConcreteMomentFrame: return { 0.0466, 0.9  };
        case StructuralSystem::SteelEccentricBraced:return { 0.0731, 0.75 };
        case StructuralSystem::Other:               return { 0.0488, 0.75 };
    }
    return { 0.0488, 0.75 };
}
} // namespace

double approximateFundamentalPeriod(StructuralSystem sys, double heightM) {
    if (heightM <= 0) throw std::invalid_argument("T_a: height > 0");
    const auto p = params(sys);
    return p.Ct * std::pow(heightM, p.x);
}

CsOutputs seismicResponseCoefficient(const CsInputs& in) {
    if (in.SDS <= 0)  throw std::invalid_argument("Cs: S_DS > 0");
    if (in.SD1 <= 0)  throw std::invalid_argument("Cs: S_D1 > 0");
    if (in.T <= 0)    throw std::invalid_argument("Cs: T > 0");
    if (in.TL <= 0)   throw std::invalid_argument("Cs: T_L > 0");
    if (in.R <= 0)    throw std::invalid_argument("Cs: R > 0");
    if (in.Ie <= 0)   throw std::invalid_argument("Cs: I_e > 0");

    const double rOverIe = in.R / in.Ie;
    CsOutputs out{};
    out.CsBasic = in.SDS / rOverIe;
    if (in.T <= in.TL) {
        out.CsMax = in.SD1 / (in.T * rOverIe);
    } else {
        out.CsMax = in.SD1 * in.TL / (in.T * in.T * rOverIe);
    }
    out.CsMin = std::max(0.044 * in.SDS * in.Ie, 0.01);

    double Cs = out.CsBasic;
    if (Cs > out.CsMax) Cs = out.CsMax;
    if (Cs < out.CsMin) Cs = out.CsMin;
    out.CsGoverning = Cs;
    return out;
}

double baseShear(double Cs, double W) {
    if (Cs <= 0) throw std::invalid_argument("baseShear: C_s > 0");
    if (W <= 0)  throw std::invalid_argument("baseShear: W > 0");
    return Cs * W;
}

}} // namespace forge::seismic
