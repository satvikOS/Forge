// Forge-274 — implementation; see header for derivation references.

#include "forge/WoodColumn.hpp"

#include <cmath>
#include <stdexcept>
#include <string>

namespace forge::woodcolumn {

Result analyse(const Input& in) {
    if (in.referenceFcMPa <= 0.0)    throw std::runtime_error("referenceFcMPa must be > 0");
    if (in.emin_MPa <= 0.0)          throw std::runtime_error("emin_MPa must be > 0");
    if (in.areaMm2 <= 0.0)           throw std::runtime_error("areaMm2 must be > 0");
    if (in.effectiveLengthMm <= 0.0) throw std::runtime_error("effectiveLengthMm must be > 0");
    if (in.leastDimensionMm <= 0.0)  throw std::runtime_error("leastDimensionMm must be > 0");

    auto pos = [](double v, const char* n) {
        if (v <= 0.0) throw std::runtime_error(std::string(n) + " must be > 0");
    };
    pos(in.cD, "cD"); pos(in.cM, "cM"); pos(in.cT, "cT");
    pos(in.cF, "cF"); pos(in.cI, "cI");

    const double lambda = in.effectiveLengthMm / in.leastDimensionMm;
    if (lambda > 50.0)
        throw std::runtime_error("l_e/d > 50 — NDS slenderness limit exceeded");

    double c = 0.8;
    if (in.columnType == ColumnType::RoundTimber) c = 0.85;
    else if (in.columnType == ColumnType::Glulam) c = 0.9;

    const double FstarC = in.referenceFcMPa * in.cD * in.cM * in.cT * in.cF * in.cI;
    const double FcE    = 0.822 * in.emin_MPa / (lambda * lambda);
    const double alpha  = FcE / FstarC;

    const double term  = (1.0 + alpha) / (2.0 * c);
    const double inner = term * term - alpha / c;
    if (inner < 0.0)
        throw std::runtime_error("C_p inner radical negative (input mismatch)");
    const double Cp = term - std::sqrt(inner);

    const double FcPrime = FstarC * Cp;
    const double Pallow  = FcPrime * in.areaMm2;

    Result r;
    r.slendernessLeOverD = lambda;
    r.fStarCMPa          = FstarC;
    r.fcEMPa             = FcE;
    r.alphaRatio         = alpha;
    r.cFactor            = c;
    r.cP                 = Cp;
    r.fcPrimeMPa         = FcPrime;
    r.pAllowN            = Pallow;
    return r;
}

}  // namespace forge::woodcolumn
