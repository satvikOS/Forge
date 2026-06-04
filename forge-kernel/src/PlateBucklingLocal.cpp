#include "forge/PlateBucklingLocal.hpp"

#include <cmath>
#include <stdexcept>
#include <string>

namespace forge::platebuck {

Result analyse(const Input& in) {
    if (in.widthMm <= 0.0) throw std::runtime_error("width > 0");
    if (in.thicknessMm <= 0.0) throw std::runtime_error("thickness > 0");
    if (in.Fy_MPa <= 0.0) throw std::runtime_error("Fy > 0");
    if (in.E_MPa <= 0.0) throw std::runtime_error("E > 0");

    const double bt = in.widthMm / in.thicknessMm;
    const double EoverFy = in.E_MPa / in.Fy_MPa;
    const double sqrtR = std::sqrt(EoverFy);

    double lambda_r;
    if (in.elementType == "flange") {
        lambda_r = 0.56 * sqrtR;
    } else if (in.elementType == "web") {
        lambda_r = 1.49 * sqrtR;
    } else {
        throw std::runtime_error("elementType must be 'flange' or 'web'");
    }

    std::string cls = (bt <= lambda_r) ? "nonslender" : "slender";

    // Q_s only meaningful for unstiffened flanges (Case 1)
    double Qs = 1.0;
    if (in.elementType == "flange" && bt > lambda_r) {
        if (bt <= 1.03 * sqrtR) {
            Qs = 1.415 - 0.74 * bt * std::sqrt(in.Fy_MPa / in.E_MPa);
        } else {
            Qs = 0.69 * in.E_MPa / (in.Fy_MPa * bt * bt);
        }
    }

    Result r;
    r.slenderness    = bt;
    r.lambdaR        = lambda_r;
    r.classification = cls;
    r.Qs             = Qs;
    return r;
}

}  // namespace forge::platebuck
