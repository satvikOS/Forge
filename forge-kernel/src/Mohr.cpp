#include "forge/Mohr.hpp"

#include <algorithm>
#include <cmath>

#include <Eigen/Dense>

namespace forge { namespace mohr {

Principal2D principal2D(const Stress2D& s) {
    Principal2D out{};
    const double avg = 0.5 * (s.sx + s.sy);
    const double diff = 0.5 * (s.sx - s.sy);
    const double R = std::sqrt(diff * diff + s.txy * s.txy);
    out.sigma1 = avg + R;
    out.sigma2 = avg - R;
    out.tauMax = R;
    out.thetaPRad = 0.5 * std::atan2(2.0 * s.txy, s.sx - s.sy);
    return out;
}

StressOnPlane stressAtAngle(const Stress2D& s, double theta) {
    const double avg = 0.5 * (s.sx + s.sy);
    const double diff = 0.5 * (s.sx - s.sy);
    const double c = std::cos(2.0 * theta);
    const double n = std::sin(2.0 * theta);
    StressOnPlane out{};
    out.sigma = avg + diff * c + s.txy * n;
    out.tau   = -diff * n + s.txy * c;
    return out;
}

Principal3D principal3D(const Stress3D& s) {
    Eigen::Matrix3d T;
    T <<
        s.sx,  s.txy, s.tzx,
        s.txy, s.sy,  s.tyz,
        s.tzx, s.tyz, s.sz;
    Eigen::SelfAdjointEigenSolver<Eigen::Matrix3d> es(T);
    auto e = es.eigenvalues();   // ascending
    Principal3D out{};
    out.sigma3 = e(0);
    out.sigma2 = e(1);
    out.sigma1 = e(2);
    return out;
}

}} // namespace forge::mohr
