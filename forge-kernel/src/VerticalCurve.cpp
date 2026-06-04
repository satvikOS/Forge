#include "forge/VerticalCurve.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::vcurve {

static double aashtoSSD(double V_kmh) {
    // AASHTO simplified SSD: brake reaction 2.5 s, deceleration 3.4 m/s².
    const double V_ms = V_kmh / 3.6;
    return 0.278 * V_kmh * 2.5 + V_ms * V_ms / (2.0 * 3.4);
}

Result analyse(const Input& in) {
    if (in.designSpeed_kmh <= 0)         throw std::runtime_error("V > 0");
    if (in.curveLength_m < 0)            throw std::runtime_error("L >= 0");
    if (in.Kvalue < 0)                   throw std::runtime_error("K >= 0");
    if (in.curveType < 0 || in.curveType > 1) throw std::runtime_error("type 0/1");

    const double A_pct = std::fabs(in.grade2_pct - in.grade1_pct);
    if (A_pct < 1e-9) throw std::runtime_error("A > 0");

    double L = in.curveLength_m;
    if (L <= 0 && in.Kvalue > 0) L = in.Kvalue * A_pct;
    if (L <= 0) throw std::runtime_error("L or K required");
    const double K = L / A_pct;

    const double S = aashtoSSD(in.designSpeed_kmh);

    // Crest curve (h1 = 1.08 m driver eye, h2 = 0.6 m object).
    // Sag curve headlight criterion.
    double L_min_AASHTO = 0;
    if (in.curveType == 0) {
        const double denom = 100.0 * std::pow(std::sqrt(2.0 * 1.08) + std::sqrt(2.0 * 0.60), 2.0);
        L_min_AASHTO = A_pct * S * S / denom;
        // S > L case (longer SSD than curve)
        const double L_long = 2.0 * S - denom / A_pct;
        if (S > L && L_long > 0) L_min_AASHTO = std::min(L_min_AASHTO, L_long);
    } else {
        L_min_AASHTO = A_pct * S * S / (120.0 + 3.5 * S);
        const double L_long = 2.0 * S - (120.0 + 3.5 * S) / A_pct;
        if (S > L && L_long > 0) L_min_AASHTO = std::min(L_min_AASHTO, L_long);
    }

    // High/low point station relative to PVC: dy/dx = 0 → x = g1·L / (g1 − g2).
    const double gradeDiff = in.grade1_pct - in.grade2_pct;
    const double x_hp = std::fabs(gradeDiff) > 1e-9
        ? in.grade1_pct * L / gradeDiff
        : 0.0;

    Result r;
    r.algebraicGradeChange_A_pct  = A_pct;
    r.computedLength_m            = L;
    r.Kvalue                      = K;
    r.assumedSSD_m                = S;
    r.minLength_AASHTO_m          = L_min_AASHTO;
    r.highOrLowPointStation_m     = x_hp;
    r.meetsSightDistance          = L >= L_min_AASHTO;
    return r;
}

}  // namespace forge::vcurve
