#include "forge/PolygonSection.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace polysec {

namespace {

struct LoopResult {
    double area;
    double cxSum;     // 6·A·Cx for the loop
    double cySum;
    double Ixx;
    double Iyy;
    double Ixy;
};

LoopResult loopMoments(const std::vector<Vec2>& v) {
    LoopResult out{};
    const std::size_t n = v.size();
    if (n < 3) return out;
    for (std::size_t i = 0; i < n; ++i) {
        const auto& p0 = v[i];
        const auto& p1 = v[(i + 1) % n];
        const double cross = p0.x * p1.y - p1.x * p0.y;
        out.area  += cross * 0.5;
        out.cxSum += (p0.x + p1.x) * cross;
        out.cySum += (p0.y + p1.y) * cross;
        out.Ixx   += (p0.y * p0.y + p0.y * p1.y + p1.y * p1.y) * cross / 12.0;
        out.Iyy   += (p0.x * p0.x + p0.x * p1.x + p1.x * p1.x) * cross / 12.0;
        out.Ixy   += (p0.x * p1.y + 2.0 * p0.x * p0.y + 2.0 * p1.x * p1.y + p1.x * p0.y) * cross / 24.0;
    }
    return out;
}

} // namespace

Outputs analyse(const Inputs& in) {
    if (in.outer.size() < 3)
        throw std::invalid_argument("polysec.analyse: outer polygon needs ≥ 3 vertices");

    LoopResult o = loopMoments(in.outer);
    double area  = o.area;
    double cxSum = o.cxSum;
    double cySum = o.cySum;
    double Ixx   = o.Ixx;
    double Iyy   = o.Iyy;
    double Ixy   = o.Ixy;
    for (const auto& h : in.holes) {
        LoopResult hl = loopMoments(h);
        // Holes contribute with opposite signed area; verify orientation.
        // The math is identical: subtract hole moments.
        area  += hl.area;       // hole loop is already CW → hl.area negative
        cxSum += hl.cxSum;
        cySum += hl.cySum;
        Ixx   += hl.Ixx;
        Iyy   += hl.Iyy;
        Ixy   += hl.Ixy;
    }
    if (std::fabs(area) < 1e-20)
        throw std::invalid_argument("polysec.analyse: zero net area");

    Outputs out{};
    out.area = std::fabs(area);
    out.centroid.x = cxSum / (6.0 * area);
    out.centroid.y = cySum / (6.0 * area);
    // Parallel-axis to centroid:
    out.IxxCentroid = Ixx - out.area * out.centroid.y * out.centroid.y;
    out.IyyCentroid = Iyy - out.area * out.centroid.x * out.centroid.x;
    out.IxyCentroid = Ixy - out.area * out.centroid.x * out.centroid.y;
    if (area < 0) {
        // Outer was clockwise. The math handles this transparently via the
        // signed area, but the centroid signs flip — already absorbed.
        out.IxxCentroid = -out.IxxCentroid;
        out.IyyCentroid = -out.IyyCentroid;
        out.IxyCentroid = -out.IxyCentroid;
    }
    out.radiusOfGyrationX = std::sqrt(std::fabs(out.IxxCentroid) / out.area);
    out.radiusOfGyrationY = std::sqrt(std::fabs(out.IyyCentroid) / out.area);
    return out;
}

}} // namespace forge::polysec
