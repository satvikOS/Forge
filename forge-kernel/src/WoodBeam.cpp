// Forge-272 — implementation; see header for derivation references.

#include "forge/WoodBeam.hpp"

#include <cmath>
#include <stdexcept>
#include <string>

namespace forge::woodbeam {

Result analyse(const Input& in) {
    if (in.referenceFbMPa <= 0.0) throw std::runtime_error("referenceFbMPa must be > 0");
    if (in.emin_MPa <= 0.0)       throw std::runtime_error("emin_MPa must be > 0");
    if (in.widthMm <= 0.0)        throw std::runtime_error("widthMm must be > 0");
    if (in.depthMm <= 0.0)        throw std::runtime_error("depthMm must be > 0");
    if (in.effectiveLengthMm <= 0.0)
        throw std::runtime_error("effectiveLengthMm must be > 0");

    auto pos = [](double v, const char* name) {
        if (v <= 0.0) throw std::runtime_error(std::string(name) + " must be > 0");
    };
    pos(in.cD, "cD"); pos(in.cM, "cM"); pos(in.cT, "cT");
    pos(in.cF, "cF"); pos(in.cFu, "cFu"); pos(in.cI, "cI"); pos(in.cR, "cR");

    const double b  = in.widthMm;
    const double d  = in.depthMm;
    const double le = in.effectiveLengthMm;

    const double Sx = b * d * d / 6.0;

    // F*_b — all adjustments except C_L.
    const double Fb_star = in.referenceFbMPa * in.cD * in.cM * in.cT
                                              * in.cF * in.cFu * in.cI * in.cR;

    // Slenderness R_B = √(l_e·d / b²).
    const double Rb = std::sqrt(le * d / (b * b));

    // F_bE = 1.20·E'_min / R_B².
    const double FbE = 1.20 * in.emin_MPa / (Rb * Rb);

    // α = F_bE / F*_b.
    const double alpha = FbE / Fb_star;
    const double term  = (1.0 + alpha) / 1.9;
    const double inner = term * term - alpha / 0.95;
    if (inner < 0.0)
        throw std::runtime_error("C_L inner radical negative (input mismatch)");
    const double CL = term - std::sqrt(inner);

    const double Fb_prime = Fb_star * CL;
    const double Mallow   = Fb_prime * Sx;

    Result r;
    r.sectionModulusMm3 = Sx;
    r.fbStarMPa         = Fb_star;
    r.slendernessRb     = Rb;
    r.fbEMPa            = FbE;
    r.alphaRatio        = alpha;
    r.cL                = CL;
    r.fbPrimeMPa        = Fb_prime;
    r.mAllowNmm         = Mallow;
    return r;
}

}  // namespace forge::woodbeam
