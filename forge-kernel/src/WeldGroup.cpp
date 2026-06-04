#include "forge/WeldGroup.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::weldgroup {

static double segmentLength(const WeldSegment& s) {
    const double dx = s.x1_mm - s.x0_mm;
    const double dy = s.y1_mm - s.y0_mm;
    return std::sqrt(dx * dx + dy * dy);
}

Result analyse(const Input& in) {
    if (in.segments.size() < 1)            throw std::runtime_error("≥ 1 segment");
    if (in.loadP_kN <= 0)                  throw std::runtime_error("P > 0");
    if (in.legSize_mm <= 0)                throw std::runtime_error("leg > 0");
    if (in.electrodeFu_MPa <= 0)           throw std::runtime_error("F_EXX > 0");

    // Centroid by linear weld treated as wire of equal density.
    double L_tot = 0.0, mx = 0.0, my = 0.0;
    for (const auto& s : in.segments) {
        const double L = segmentLength(s);
        L_tot += L;
        mx += L * 0.5 * (s.x0_mm + s.x1_mm);
        my += L * 0.5 * (s.y0_mm + s.y1_mm);
    }
    if (L_tot <= 0) throw std::runtime_error("Σ L > 0");
    const double cx = mx / L_tot;
    const double cy = my / L_tot;

    // Treat each weld as line: I_x = ∫(y−cy)²·dL (about centroid).
    // For segment from (x0,y0)→(x1,y1) length L, parameterise t∈[0,L]:
    //   x(t)=x0+(x1-x0)/L·t, y(t)=y0+(y1-y0)/L·t
    // ∫₀^L (y(t)-cy)² dt = L·(y0-cy)² + L·(y0-cy)·(y1-y0) + L·(y1-y0)²/3
    auto segIxy = [&](double a0, double a1, double L)->double {
        const double da = a1 - a0;
        return L * (a0 * a0 + a0 * da + da * da / 3.0);
    };

    double Ix = 0.0, Iy = 0.0;
    double r_max2 = 0.0;
    double r_max_xCentroid = 0.0, r_max_yCentroid = 0.0;
    for (const auto& s : in.segments) {
        const double L = segmentLength(s);
        const double y0 = s.y0_mm - cy, y1 = s.y1_mm - cy;
        const double x0 = s.x0_mm - cx, x1 = s.x1_mm - cx;
        Ix += segIxy(y0, y1, L);
        Iy += segIxy(x0, x1, L);
        // Critical points are segment ends.
        for (auto [xp, yp] : {std::pair{x0, y0}, std::pair{x1, y1}}) {
            const double r2 = xp * xp + yp * yp;
            if (r2 > r_max2) {
                r_max2 = r2;
                r_max_xCentroid = xp;
                r_max_yCentroid = yp;
            }
        }
    }
    const double J = Ix + Iy;            // mm³ (line-treatment)
    const double r_max = std::sqrt(r_max2);

    // Direct shear assumed vertical (along −y).
    const double P_N = in.loadP_kN * 1.0e3;
    const double f_direct = P_N / L_tot;                            // N/mm direct
    const double T_Nmm = P_N * in.eccentricity_mm;
    const double f_tor = T_Nmm * r_max / J;                          // N/mm torsional
    const double f_tor_x = -f_tor * r_max_yCentroid / r_max;        // perp to radius vector
    const double f_tor_y =  f_tor * r_max_xCentroid / r_max;
    const double f_x_total = f_tor_x;
    const double f_y_total = f_direct + f_tor_y;
    const double f_res = std::sqrt(f_x_total * f_x_total + f_y_total * f_y_total);

    // Throat = 0.707·leg.  Throat stress = f_res / throat.
    const double throat_mm = 0.707 * in.legSize_mm;
    const double sigma_throat = f_res / throat_mm;
    const double sigma_allow  = 0.6 * in.electrodeFu_MPa;

    Result r;
    r.centroidX_mm           = cx;
    r.centroidY_mm           = cy;
    r.totalLength_mm         = L_tot;
    r.polarSecondMoment_mm3  = J;
    r.maxStress_MPa          = sigma_throat;
    r.allowableStress_MPa    = sigma_allow;
    r.utilisation            = sigma_throat / sigma_allow;
    r.passes                 = r.utilisation <= 1.0;
    return r;
}

}  // namespace forge::weldgroup
