#include "forge/PipeRoute.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <queue>
#include <stdexcept>
#include <unordered_map>
#include <vector>

namespace forge { namespace piperoute {

namespace {

inline std::int32_t snap(double v, double spacing) {
    return static_cast<std::int32_t>(std::llround(v / spacing));
}

struct Cell {
    std::int32_t i, j, k;
    std::int8_t  dir;        // 0..5 → ±X, ±Y, ±Z (6 = "none", used for start)
    bool operator==(const Cell& o) const {
        return i == o.i && j == o.j && k == o.k && dir == o.dir;
    }
};
struct CellHash {
    std::size_t operator()(const Cell& c) const noexcept {
        auto h = static_cast<std::uint64_t>(c.i) * 73856093ull;
        h ^= static_cast<std::uint64_t>(c.j) * 19349663ull;
        h ^= static_cast<std::uint64_t>(c.k) * 83492791ull;
        h ^= static_cast<std::uint64_t>(c.dir + 1) * 2654435761ull;
        return static_cast<std::size_t>(h);
    }
};

constexpr std::int32_t kDirs[6][3] = {
    { 1, 0, 0}, {-1, 0, 0},
    { 0, 1, 0}, { 0,-1, 0},
    { 0, 0, 1}, { 0, 0,-1},
};

inline std::int8_t directionIndex(const double v[3]) {
    const double ax = std::fabs(v[0]), ay = std::fabs(v[1]), az = std::fabs(v[2]);
    if (ax >= ay && ax >= az) return v[0] >= 0 ? 0 : 1;
    if (ay >= az)             return v[1] >= 0 ? 2 : 3;
    return v[2] >= 0 ? 4 : 5;
}

bool aabbContains(const AABB& box, double x, double y, double z, double margin) {
    return x > box.min[0] - margin && x < box.max[0] + margin
        && y > box.min[1] - margin && y < box.max[1] + margin
        && z > box.min[2] - margin && z < box.max[2] + margin;
}

} // namespace

Outputs route(const Inputs& in) {
    if (in.gridSpacing <= 0) throw std::invalid_argument("piperoute.route: gridSpacing > 0");
    if (in.maxIterations == 0) throw std::invalid_argument("piperoute.route: maxIterations > 0");

    Outputs out{};
    out.found = false;

    const Cell startCell {
        snap(in.start.position[0], in.gridSpacing),
        snap(in.start.position[1], in.gridSpacing),
        snap(in.start.position[2], in.gridSpacing),
        directionIndex(in.start.direction),
    };
    const Cell goalCell {
        snap(in.end.position[0], in.gridSpacing),
        snap(in.end.position[1], in.gridSpacing),
        snap(in.end.position[2], in.gridSpacing),
        -1,        // any incoming direction at the goal cell counts
    };

    const double mn[3] = {
        std::min(in.start.position[0], in.end.position[0]) - in.bbMargin,
        std::min(in.start.position[1], in.end.position[1]) - in.bbMargin,
        std::min(in.start.position[2], in.end.position[2]) - in.bbMargin,
    };
    const double mx[3] = {
        std::max(in.start.position[0], in.end.position[0]) + in.bbMargin,
        std::max(in.start.position[1], in.end.position[1]) + in.bbMargin,
        std::max(in.start.position[2], in.end.position[2]) + in.bbMargin,
    };
    const std::int32_t iMin = snap(mn[0], in.gridSpacing);
    const std::int32_t iMax = snap(mx[0], in.gridSpacing);
    const std::int32_t jMin = snap(mn[1], in.gridSpacing);
    const std::int32_t jMax = snap(mx[1], in.gridSpacing);
    const std::int32_t kMin = snap(mn[2], in.gridSpacing);
    const std::int32_t kMax = snap(mx[2], in.gridSpacing);

    auto inBox = [&](std::int32_t i, std::int32_t j, std::int32_t k) {
        return i >= iMin && i <= iMax && j >= jMin && j <= jMax
            && k >= kMin && k <= kMax;
    };
    auto cellPos = [&](std::int32_t i, std::int32_t j, std::int32_t k, double p[3]) {
        p[0] = i * in.gridSpacing;
        p[1] = j * in.gridSpacing;
        p[2] = k * in.gridSpacing;
    };
    auto blocked = [&](std::int32_t i, std::int32_t j, std::int32_t k) {
        double p[3]; cellPos(i, j, k, p);
        for (const auto& b : in.obstacles) {
            if (aabbContains(b, p[0], p[1], p[2], 0.0)) return true;
        }
        return false;
    };

    struct PqEntry {
        double f;
        Cell c;
    };
    struct PqCmp {
        bool operator()(const PqEntry& a, const PqEntry& b) const {
            return a.f > b.f;
        }
    };

    std::priority_queue<PqEntry, std::vector<PqEntry>, PqCmp> open;
    std::unordered_map<Cell, double,   CellHash> gScore;
    std::unordered_map<Cell, Cell,     CellHash> cameFrom;

    auto heuristic = [&](const Cell& c) {
        return in.gridSpacing * (std::abs(c.i - goalCell.i)
                              + std::abs(c.j - goalCell.j)
                              + std::abs(c.k - goalCell.k));
    };

    gScore[startCell] = 0.0;
    open.push({ heuristic(startCell), startCell });

    Cell foundCell {};

    while (!open.empty() && out.iterationsUsed < in.maxIterations) {
        const PqEntry top = open.top(); open.pop();
        ++out.iterationsUsed;
        const Cell cur = top.c;
        if (cur.i == goalCell.i && cur.j == goalCell.j && cur.k == goalCell.k) {
            foundCell = cur;
            out.found = true;
            break;
        }
        const double gCur = gScore[cur];
        for (std::int8_t d = 0; d < 6; ++d) {
            // Don't reverse direction immediately.
            if ((cur.dir != 6) && (kDirs[d][0] == -kDirs[cur.dir][0]
                && kDirs[d][1] == -kDirs[cur.dir][1]
                && kDirs[d][2] == -kDirs[cur.dir][2])) continue;
            const std::int32_t ni = cur.i + kDirs[d][0];
            const std::int32_t nj = cur.j + kDirs[d][1];
            const std::int32_t nk = cur.k + kDirs[d][2];
            if (!inBox(ni, nj, nk)) continue;
            if (blocked(ni, nj, nk)) continue;
            double cost = in.gridSpacing;
            if (cur.dir != 6 && cur.dir != d) cost += in.elbowPenalty;
            const Cell nb { ni, nj, nk, d };
            const double tentative = gCur + cost;
            auto it = gScore.find(nb);
            if (it == gScore.end() || tentative < it->second) {
                gScore[nb] = tentative;
                cameFrom[nb] = cur;
                open.push({ tentative + heuristic(nb), nb });
            }
        }
    }

    if (!out.found) return out;

    std::vector<Cell> path;
    Cell cur = foundCell;
    path.push_back(cur);
    while (cameFrom.count(cur)) {
        cur = cameFrom[cur];
        path.push_back(cur);
    }
    std::reverse(path.begin(), path.end());

    // Polyline = collapse consecutive same-direction steps into one.
    std::vector<std::array<double, 3>> verts;
    verts.reserve(path.size());
    for (const auto& c : path) {
        double p[3]; cellPos(c.i, c.j, c.k, p);
        verts.push_back({ p[0], p[1], p[2] });
    }
    std::vector<std::array<double, 3>> simp;
    simp.push_back(verts.front());
    for (std::size_t i = 1; i + 1 < verts.size(); ++i) {
        const auto& a = simp.back();
        const auto& b = verts[i];
        const auto& c = verts[i + 1];
        const double d1x = b[0] - a[0], d1y = b[1] - a[1], d1z = b[2] - a[2];
        const double d2x = c[0] - b[0], d2y = c[1] - b[1], d2z = c[2] - b[2];
        // If collinear (all same axis), drop b.
        const bool collinear =
            (d1x != 0 && d2x != 0 && d1y == 0 && d2y == 0 && d1z == 0 && d2z == 0
              && ((d1x > 0) == (d2x > 0))) ||
            (d1y != 0 && d2y != 0 && d1x == 0 && d2x == 0 && d1z == 0 && d2z == 0
              && ((d1y > 0) == (d2y > 0))) ||
            (d1z != 0 && d2z != 0 && d1x == 0 && d2x == 0 && d1y == 0 && d2y == 0
              && ((d1z > 0) == (d2z > 0)));
        if (!collinear) simp.push_back(b);
    }
    simp.push_back(verts.back());

    out.polyline.reserve(simp.size() * 3);
    for (const auto& v : simp) {
        out.polyline.push_back(v[0]);
        out.polyline.push_back(v[1]);
        out.polyline.push_back(v[2]);
    }
    double L = 0;
    for (std::size_t i = 1; i < simp.size(); ++i) {
        const double dx = simp[i][0] - simp[i-1][0];
        const double dy = simp[i][1] - simp[i-1][1];
        const double dz = simp[i][2] - simp[i-1][2];
        L += std::sqrt(dx*dx + dy*dy + dz*dz);
    }
    out.totalLength = L;
    out.elbowCount  = simp.size() >= 2 ? static_cast<std::uint32_t>(simp.size() - 2) : 0u;
    return out;
}

}} // namespace forge::piperoute
