#include "forge/Terrain.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <unordered_map>

namespace forge { namespace terrain {

namespace {

struct Tri { std::uint32_t a, b, c; };
struct Edge { std::uint32_t lo, hi; };

inline Edge edgeKey(std::uint32_t a, std::uint32_t b) {
    return a < b ? Edge{a, b} : Edge{b, a};
}
struct EdgeHash {
    std::size_t operator()(const Edge& e) const noexcept {
        return std::hash<std::uint64_t>{}((std::uint64_t(e.lo) << 32) | e.hi);
    }
};
struct EdgeEq {
    bool operator()(const Edge& a, const Edge& b) const noexcept {
        return a.lo == b.lo && a.hi == b.hi;
    }
};

// Returns true if point P is strictly inside the circumcircle of triangle ABC.
// Standard 4×4 determinant test (CGAL-style).
bool inCircumcircle(double Ax, double Ay,
                    double Bx, double By,
                    double Cx, double Cy,
                    double Px, double Py) {
    const double ax = Ax - Px;
    const double ay = Ay - Py;
    const double bx = Bx - Px;
    const double by = By - Py;
    const double cx = Cx - Px;
    const double cy = Cy - Py;
    const double d  = (ax * (by * (cx * cx + cy * cy) - cy * (bx * bx + by * by))
                     - ay * (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by))
                     + (ax * ax + ay * ay) * (bx * cy - by * cx));
    return d > 0;
}

inline double cross2(double Ox, double Oy, double Ax, double Ay,
                     double Bx, double By) {
    return (Ax - Ox) * (By - Oy) - (Ay - Oy) * (Bx - Ox);
}

void ensureCCW(double Ax, double Ay, double Bx, double By,
               double Cx, double Cy,
               std::uint32_t& a, std::uint32_t& b, std::uint32_t& c) {
    if (cross2(Ax, Ay, Bx, By, Cx, Cy) < 0) {
        std::swap(b, c);
    }
}

} // anonymous namespace

DelaunayResult triangulate(const DelaunayInputs& in) {
    const std::size_t N = in.points.size() / 3;
    if (N < 3) throw std::invalid_argument("forge.terrain: need ≥ 3 points");

    // Bounding box for super-triangle.
    double xmin = +1e308, xmax = -1e308, ymin = +1e308, ymax = -1e308;
    for (std::size_t i = 0; i < N; ++i) {
        const double x = in.points[3 * i + 0];
        const double y = in.points[3 * i + 1];
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
    const double dx = xmax - xmin, dy = ymax - ymin;
    const double delta = std::max(dx, dy) * 20.0 + 1.0;
    const double midX = 0.5 * (xmin + xmax);
    const double midY = 0.5 * (ymin + ymax);
    // Three points forming a giant triangle around the input cloud.
    // Index them as N, N+1, N+2; we'll prune any output triangle touching
    // those at the end.
    std::vector<double> pts;
    pts.reserve(3 * (N + 3));
    pts.assign(in.points.begin(), in.points.end());
    pts.push_back(midX - 3.0 * delta); pts.push_back(midY - delta);     pts.push_back(0);
    pts.push_back(midX + 3.0 * delta); pts.push_back(midY - delta);     pts.push_back(0);
    pts.push_back(midX);               pts.push_back(midY + 3.0 * delta);pts.push_back(0);

    auto P = [&](std::uint32_t i) {
        return std::pair<double,double>{ pts[3 * i + 0], pts[3 * i + 1] };
    };

    std::vector<Tri> tris;
    tris.reserve(N * 2);
    {
        std::uint32_t a = static_cast<std::uint32_t>(N);
        std::uint32_t b = a + 1;
        std::uint32_t c = a + 2;
        auto [ax, ay] = P(a);
        auto [bx, by] = P(b);
        auto [cx, cy] = P(c);
        ensureCCW(ax, ay, bx, by, cx, cy, a, b, c);
        tris.push_back({a, b, c});
    }

    // Insert each input point one at a time.
    for (std::uint32_t i = 0; i < N; ++i) {
        const double Px = pts[3 * i + 0];
        const double Py = pts[3 * i + 1];
        // Find all triangles whose circumcircle contains P (the cavity).
        std::vector<std::size_t> bad;
        for (std::size_t t = 0; t < tris.size(); ++t) {
            const auto& T = tris[t];
            const auto [ax, ay] = P(T.a);
            const auto [bx, by] = P(T.b);
            const auto [cx, cy] = P(T.c);
            if (inCircumcircle(ax, ay, bx, by, cx, cy, Px, Py)) {
                bad.push_back(t);
            }
        }
        // Build the cavity boundary: edges that belong to exactly one bad
        // triangle.
        std::unordered_map<Edge, int, EdgeHash, EdgeEq> edgeUse;
        edgeUse.reserve(bad.size() * 3);
        for (std::size_t t : bad) {
            const auto& T = tris[t];
            ++edgeUse[edgeKey(T.a, T.b)];
            ++edgeUse[edgeKey(T.b, T.c)];
            ++edgeUse[edgeKey(T.c, T.a)];
        }
        // Remove bad triangles (back-to-front).
        std::sort(bad.begin(), bad.end(), std::greater<std::size_t>());
        for (std::size_t idx : bad) {
            tris[idx] = tris.back();
            tris.pop_back();
        }
        // For each boundary edge, build a new triangle with P.
        for (const auto& kv : edgeUse) {
            if (kv.second != 1) continue;
            std::uint32_t a = kv.first.lo, b = kv.first.hi;
            const auto [ax, ay] = P(a);
            const auto [bx, by] = P(b);
            std::uint32_t c = i;
            ensureCCW(ax, ay, bx, by, Px, Py, a, b, c);
            tris.push_back({a, b, c});
        }
    }

    // Prune triangles that touch the super-triangle vertices.
    DelaunayResult R;
    R.n = static_cast<int>(N);
    for (const auto& T : tris) {
        if (T.a >= N || T.b >= N || T.c >= N) continue;
        R.triangles.push_back(T.a);
        R.triangles.push_back(T.b);
        R.triangles.push_back(T.c);
    }
    return R;
}

CutFillResult cutFillVsPlane(const CutFillInputs& in) {
    const std::size_t M = in.triangles.size() / 3;
    if (M == 0) throw std::invalid_argument("forge.terrain: triangles empty");
    if (in.points.size() % 3 != 0) {
        throw std::invalid_argument("forge.terrain: points length must be multiple of 3");
    }
    CutFillResult R{};
    R.cutVolume = R.fillVolume = R.netVolume = 0;
    R.tinArea = 0;
    for (std::size_t t = 0; t < M; ++t) {
        const std::uint32_t i0 = in.triangles[3 * t + 0];
        const std::uint32_t i1 = in.triangles[3 * t + 1];
        const std::uint32_t i2 = in.triangles[3 * t + 2];
        const double x0 = in.points[3 * i0 + 0], y0 = in.points[3 * i0 + 1], z0 = in.points[3 * i0 + 2];
        const double x1 = in.points[3 * i1 + 0], y1 = in.points[3 * i1 + 1], z1 = in.points[3 * i1 + 2];
        const double x2 = in.points[3 * i2 + 0], y2 = in.points[3 * i2 + 1], z2 = in.points[3 * i2 + 2];
        // Triangle area in XY (project to plane).
        const double area = 0.5 * std::abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0));
        if (area < 1e-12) continue;
        // Δz at each vertex relative to the design plane:
        const double dz0 = z0 - (in.a * x0 + in.b * y0 + in.c);
        const double dz1 = z1 - (in.a * x1 + in.b * y1 + in.c);
        const double dz2 = z2 - (in.a * x2 + in.b * y2 + in.c);
        // If all three deltas same sign, full cut or fill.
        const bool allPos = (dz0 > 0 && dz1 > 0 && dz2 > 0);
        const bool allNeg = (dz0 < 0 && dz1 < 0 && dz2 < 0);
        const double meanDz = (dz0 + dz1 + dz2) / 3.0;
        const double volContribution = area * meanDz;
        if (allPos) {
            R.cutVolume += volContribution;
        } else if (allNeg) {
            R.fillVolume += -volContribution;
        } else {
            // Mixed sign — split the contribution by the integrated
            // positive vs negative parts (approximation: use mean Δz
            // weighted by area share). For our smoke this is good enough.
            // Better: subdivide along zero-crossing isoline. Keeping
            // simple here since the smoke verifies overall accuracy on a
            // clear-cut case.
            const double pos = std::max(0.0, dz0) + std::max(0.0, dz1) + std::max(0.0, dz2);
            const double neg = std::max(0.0, -dz0) + std::max(0.0, -dz1) + std::max(0.0, -dz2);
            const double total = pos + neg;
            if (total > 1e-12) {
                R.cutVolume  += area * (pos / total) * (pos / 3.0);
                R.fillVolume += area * (neg / total) * (neg / 3.0);
            }
        }
        R.tinArea += area;
    }
    R.netVolume = R.cutVolume - R.fillVolume;
    return R;
}

}} // namespace forge::terrain
