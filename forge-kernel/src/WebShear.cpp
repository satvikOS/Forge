// Forge-302 — implementation; see header for derivation references.

#include "forge/WebShear.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::webshear {

Result analyse(const Input& in) {
    if (in.overallDepthMm <= 0.0)
        throw std::runtime_error("overallDepthMm must be > 0");
    if (in.webThicknessMm <= 0.0)
        throw std::runtime_error("webThicknessMm must be > 0");
    if (in.flangeThicknessMm <= 0.0)
        throw std::runtime_error("flangeThicknessMm must be > 0");
    if (2.0 * in.flangeThicknessMm >= in.overallDepthMm)
        throw std::runtime_error("flange height fills the depth (2·t_f ≥ d)");
    if (in.Fy_MPa <= 0.0)
        throw std::runtime_error("Fy_MPa must be > 0");
    if (in.E_MPa <= 0.0)
        throw std::runtime_error("E_MPa must be > 0");
    if (in.stiffenerSpacingMm < 0.0)
        throw std::runtime_error("stiffenerSpacingMm must be ≥ 0");

    const double d  = in.overallDepthMm;
    const double tw = in.webThicknessMm;
    const double tf = in.flangeThicknessMm;
    const double Fy = in.Fy_MPa;
    const double E  = in.E_MPa;

    const double h  = d - 2.0 * tf;
    const double hw = h / tw;
    const double Aw = d * tw;  // mm²

    // k_v selection
    double kv;
    if (in.stiffenerSpacingMm <= 0.0 || in.stiffenerSpacingMm / h > 3.0) {
        kv = 5.34;
    } else {
        const double ah = in.stiffenerSpacingMm / h;
        kv = 5.0 + 5.0 / (ah * ah);
    }

    const double compact_limit   = 2.24  * std::sqrt(E / Fy);
    const double inelastic_limit = 1.10  * std::sqrt(kv * E / Fy);
    const double elastic_limit   = 1.37  * std::sqrt(kv * E / Fy);

    double Cv1;
    int regime;
    if (hw <= compact_limit || hw <= inelastic_limit) {
        Cv1 = 1.0;
        regime = 1;
    } else if (hw <= elastic_limit) {
        Cv1 = 1.10 * std::sqrt(kv * E / Fy) / hw;
        regime = 2;
    } else {
        Cv1 = 1.51 * kv * E / (hw * hw * Fy);
        regime = 3;
    }

    const double Vn = 0.6 * Fy * Aw * Cv1;  // MPa·mm² = N

    double phi, omega;
    if (in.compactRolled && hw <= compact_limit) {
        phi   = 1.0;
        omega = 1.50;
    } else {
        phi   = 0.9;
        omega = 1.67;
    }

    Result r;
    r.clearWebDepthMm  = h;
    r.webSlenderness   = hw;
    r.limitCompact     = compact_limit;
    r.limitInelastic   = inelastic_limit;
    r.limitElastic     = elastic_limit;
    r.k_v              = kv;
    r.C_v1             = Cv1;
    r.regime           = regime;
    r.nominalShearN    = Vn;
    r.LRFDshearN       = phi * Vn;
    r.ASDshearN        = Vn / omega;
    r.phi              = phi;
    r.omega            = omega;
    return r;
}

}  // namespace forge::webshear
