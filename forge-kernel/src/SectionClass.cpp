// Forge-311 — implementation; see header for derivation references.

#include "forge/SectionClass.hpp"

#include <cmath>
#include <stdexcept>
#include <string>

namespace forge::sectclass {

namespace {

std::string classify(double lambda, double lp, double lr) {
    if (lambda <= lp) return "compact";
    if (lambda <= lr) return "non-compact";
    return "slender";
}

int classRank(const std::string& c) {
    if (c == "compact")     return 0;
    if (c == "non-compact") return 1;
    return 2;
}

}  // namespace

Result analyse(const Input& in) {
    if (in.bf_mm <= 0.0)
        throw std::runtime_error("bf_mm must be > 0");
    if (in.tf_mm <= 0.0)
        throw std::runtime_error("tf_mm must be > 0");
    if (in.d_mm <= 0.0)
        throw std::runtime_error("d_mm must be > 0");
    if (in.tw_mm <= 0.0)
        throw std::runtime_error("tw_mm must be > 0");
    if (2.0 * in.tf_mm >= in.d_mm)
        throw std::runtime_error("flanges fill the depth (2·t_f ≥ d)");
    if (in.Fy_MPa <= 0.0)
        throw std::runtime_error("Fy_MPa must be > 0");
    if (in.E_MPa <= 0.0)
        throw std::runtime_error("E_MPa must be > 0");

    const double EoverFy = in.E_MPa / in.Fy_MPa;
    const double sqrtR   = std::sqrt(EoverFy);

    const double lambda_f = (in.bf_mm / 2.0) / in.tf_mm;
    const double lpf = 0.38 * sqrtR;
    const double lrf = 1.00 * sqrtR;
    const std::string flangeCls = classify(lambda_f, lpf, lrf);

    const double h = in.d_mm - 2.0 * in.tf_mm;
    const double lambda_w = h / in.tw_mm;
    const double lpw = 3.76 * sqrtR;
    const double lrw = 5.70 * sqrtR;
    const std::string webCls = classify(lambda_w, lpw, lrw);

    const std::string overall =
        (classRank(flangeCls) >= classRank(webCls)) ? flangeCls : webCls;

    Result r;
    r.flangeSlenderness = lambda_f;
    r.flangeLambda_p    = lpf;
    r.flangeLambda_r    = lrf;
    r.flangeClass       = flangeCls;
    r.webSlenderness    = lambda_w;
    r.webLambda_p       = lpw;
    r.webLambda_r       = lrw;
    r.webClass          = webCls;
    r.overallClass      = overall;
    return r;
}

}  // namespace forge::sectclass
