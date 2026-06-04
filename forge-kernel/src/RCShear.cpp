// Forge-307 — implementation; see header for derivation references.

#include "forge/RCShear.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::rcshear {

Result analyse(const Input& in) {
    if (in.widthMm <= 0.0)
        throw std::runtime_error("widthMm must be > 0");
    if (in.effectiveDepthMm <= 0.0)
        throw std::runtime_error("effectiveDepthMm must be > 0");
    if (in.fc_MPa <= 0.0)
        throw std::runtime_error("fc_MPa must be > 0");
    if (in.fyt_MPa <= 0.0)
        throw std::runtime_error("fyt_MPa must be > 0");
    if (in.lambda <= 0.0 || in.lambda > 1.0)
        throw std::runtime_error("lambda must be in (0,1]");
    if (in.shearReinfAreaMm2 < 0.0)
        throw std::runtime_error("shearReinfAreaMm2 must be ≥ 0");
    if (in.shearReinfAreaMm2 > 0.0 && in.stirrupSpacingMm <= 0.0)
        throw std::runtime_error("stirrupSpacingMm must be > 0 when reinforced");

    const double b    = in.widthMm;
    const double d    = in.effectiveDepthMm;
    const double fc   = in.fc_MPa;
    const double Av   = in.shearReinfAreaMm2;
    const double s    = in.stirrupSpacingMm;
    const double fyt  = in.fyt_MPa;
    const double lam  = in.lambda;
    const double sfc  = std::sqrt(fc);

    const double Vc_N = 0.17 * lam * sfc * b * d;
    const double Vs_N = (Av > 0.0 && s > 0.0) ? (Av * fyt * d / s) : 0.0;
    double Vn_N = Vc_N + Vs_N;
    const double VnMax_N = Vc_N + 0.66 * sfc * b * d;
    bool crushing = false;
    if (Vn_N > VnMax_N) {
        Vn_N = VnMax_N;
        crushing = true;
    }

    const double phi = 0.75;

    // §9.7.6.2.2 spacing limit (only meaningful if steel is present)
    const double Vs_threshold = 0.33 * sfc * b * d;
    double s_max;
    if (Vs_N <= Vs_threshold) {
        s_max = std::min(d / 2.0, 600.0);
    } else {
        s_max = std::min(d / 4.0, 300.0);
    }
    const bool meets = (Av <= 0.0) || (s <= s_max);

    Result r;
    r.Vc_kN               = Vc_N / 1000.0;
    r.Vs_kN               = Vs_N / 1000.0;
    r.Vn_kN               = Vn_N / 1000.0;
    r.VnMax_kN            = VnMax_N / 1000.0;
    r.phi                 = phi;
    r.phiVn_kN            = phi * Vn_N / 1000.0;
    r.maxStirrupSpacingMm = s_max;
    r.spacingMeetsLimit   = meets;
    r.crushingControls    = crushing;
    return r;
}

}  // namespace forge::rcshear
