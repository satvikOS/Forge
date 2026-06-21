// forge/native/mesh/ProjectSilhouette.cpp
//
// Implementation of forge::native::mesh::ProjectSilhouette — orthographic
// projection of a triangle mesh along a view/pull direction and extraction of the
// outer-silhouette outline (the boundary of the union of the projected triangles)
// as closed, consistently-wound 2D contours. See ProjectSilhouette.hpp for the
// honest scope + projection-direction convention. Pure C++20, standard library
// plus the existing forge/native headers only. No OCCT, no WASM, no third-party.

#include "forge/native/mesh/ProjectSilhouette.hpp"

#include <algorithm>     // std::min, std::max, std::swap
#include <array>         // std::array
#include <cmath>         // std::sqrt, std::fabs, std::isfinite, std::floor, std::ceil
#include <cstddef>       // std::size_t, std::ptrdiff_t
#include <cstdint>       // std::uint32_t, std::uint64_t, std::int64_t
#include <cstring>       // (portability: explicit even if unused symbol-wise)
#include <functional>    // std::hash (unordered_map key hashing)
#include <limits>        // std::numeric_limits
#include <map>           // std::map (deterministic loop start ordering)
#include <numeric>       // (portability include)
#include <queue>         // (portability include)
#include <set>           // (portability include)
#include <string>        // (portability include)
#include <unordered_map> // std::unordered_map (directed-edge head lookup)
#include <unordered_set> // (portability include)
#include <utility>       // std::move
#include <vector>        // std::vector

namespace forge {
namespace native {
namespace mesh {

namespace {

// ── tiny 3D vector helpers (local; no Vec3 algebra header pulled in) ─────────
inline Vec3 sub(const Vec3& a, const Vec3& b) { return Vec3{a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 mul(const Vec3& a, double s)       { return Vec3{a.x * s, a.y * s, a.z * s}; }
inline double dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return Vec3{a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x};
}
inline double len(const Vec3& a) { return std::sqrt(dot(a, a)); }
inline bool finite3(const Vec3& a) {
    return std::isfinite(a.x) && std::isfinite(a.y) && std::isfinite(a.z);
}

// A projected triangle in the (u,v) frame.
struct Tri2 {
    double ux[3];
    double uy[3];
    // axis-aligned bbox (in cell-index space, filled later)
    double minu, maxu, minv, maxv;
};

// Robust point-in-triangle test by orient2d sign agreement (exact combinatorial
// decision; a point on an edge counts as inside via the ZERO branch handled by
// the inclusive sign accumulation). Returns true iff (px,py) is inside or on the
// closed triangle (a0,a1,a2) regardless of its winding.
inline bool pointInTri(double px, double py,
                       double ax, double ay,
                       double bx, double by,
                       double cx, double cy) {
    const int d0 = signValue(orient2d(ax, ay, bx, by, px, py));
    const int d1 = signValue(orient2d(bx, by, cx, cy, px, py));
    const int d2 = signValue(orient2d(cx, cy, ax, ay, px, py));
    // Inside (or on boundary) iff all non-zero signs agree (no strict mix of + and -).
    const bool hasNeg = (d0 < 0) || (d1 < 0) || (d2 < 0);
    const bool hasPos = (d0 > 0) || (d1 > 0) || (d2 > 0);
    return !(hasNeg && hasPos);
}

// Directed boundary edge on the grid lattice, keyed by integer lattice node ids.
// We pack (i,j) lattice node (0..W, 0..H) into one 64-bit id.
inline std::uint64_t nodeId(std::int64_t i, std::int64_t j) {
    // i in [0, W], j in [0, H]; offset-free pack (both non-negative here).
    return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(i)) << 32)
         |  static_cast<std::uint64_t>(static_cast<std::uint32_t>(j));
}

// Perpendicular distance from point p to the (a->b) line (2D). For a==b returns
// the point distance. Used by the closed-ring Douglas-Peucker simplifier.
inline double perpDist(const Point2D& p, const Point2D& a, const Point2D& b) {
    const double dx = b.u - a.u, dy = b.v - a.v;
    const double l2 = dx * dx + dy * dy;
    if (!(l2 > 0.0)) {
        const double ex = p.u - a.u, ey = p.v - a.v;
        return std::sqrt(ex * ex + ey * ey);
    }
    // |cross((p-a),(b-a))| / |b-a|
    const double cr = (p.u - a.u) * dy - (p.v - a.v) * dx;
    return std::fabs(cr) / std::sqrt(l2);
}

// Iterative Douglas-Peucker on an OPEN polyline P[lo..hi] (inclusive endpoints
// kept). Marks keep[k]=true for retained vertices. Tolerance `tol` is the max
// allowed perpendicular deviation. Iterative (explicit stack) to avoid deep
// recursion on long staircase rings.
inline void douglasPeuckerOpen(const std::vector<Point2D>& P, std::size_t lo,
                               std::size_t hi, double tol,
                               std::vector<char>& keep) {
    std::vector<std::array<std::size_t, 2>> stack;
    stack.push_back({lo, hi});
    while (!stack.empty()) {
        const std::size_t a = stack.back()[0];
        const std::size_t b = stack.back()[1];
        stack.pop_back();
        if (b <= a + 1) continue;          // no interior points
        double maxd = -1.0;
        std::size_t mid = a;
        for (std::size_t k = a + 1; k < b; ++k) {
            const double d = perpDist(P[k], P[a], P[b]);
            if (d > maxd) { maxd = d; mid = k; }
        }
        if (maxd > tol) {
            keep[mid] = 1;
            stack.push_back({a, mid});
            stack.push_back({mid, b});
        }
    }
}

} // namespace

double fitCircleRadius2D(const std::vector<Point2D>& pts, bool& ok) {
    ok = false;
    if (pts.size() < 3) return 0.0;
    // Kåsa algebraic circle fit (same normal-equation system as Slice.cpp's 3D
    // variant, but the points are already 2D). Recentre near the data for
    // conditioning by subtracting the first point.
    const double ox = pts[0].u, oy = pts[0].v;
    double Sx = 0, Sy = 0, Sz = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0;
    const double n = static_cast<double>(pts.size());
    for (const auto& p : pts) {
        const double x = p.u - ox, y = p.v - oy;
        const double z = x * x + y * y;
        Sx += x; Sy += y; Sz += z;
        Sxx += x * x; Syy += y * y; Sxy += x * y;
        Sxz += x * z; Syz += y * z;
    }
    const double m00 = Sxx, m01 = Sxy, m02 = Sx;
    const double m10 = Sxy, m11 = Syy, m12 = Sy;
    const double m20 = Sx,  m21 = Sy,  m22 = n;
    const double r0 = Sxz, r1 = Syz, r2 = Sz;
    const double det =
        m00 * (m11 * m22 - m12 * m21) -
        m01 * (m10 * m22 - m12 * m20) +
        m02 * (m10 * m21 - m11 * m20);
    if (std::fabs(det) < 1e-18) return 0.0;
    const double A =
        (r0 * (m11 * m22 - m12 * m21) -
         m01 * (r1 * m22 - m12 * r2) +
         m02 * (r1 * m21 - m11 * r2)) / det;
    const double B =
        (m00 * (r1 * m22 - m12 * r2) -
         r0  * (m10 * m22 - m12 * m20) +
         m02 * (m10 * r2 - r1 * m20)) / det;
    const double C =
        (m00 * (m11 * r2 - r1 * m21) -
         m01 * (m10 * r2 - r1 * m20) +
         r0  * (m10 * m21 - m11 * m20)) / det;
    const double cx = 0.5 * A, cy = 0.5 * B;
    const double rr = C + cx * cx + cy * cy;
    if (!(rr > 0.0)) return 0.0;
    ok = true;
    return std::sqrt(rr);
}

SilhouetteResult projectSilhouette(const std::vector<double>& positions,
                                   const std::vector<std::uint32_t>& indices,
                                   const Vec3& dir,
                                   const Vec3& origin,
                                   std::uint32_t resolution) {
    SilhouetteResult res;

    // ── input validation (honest ok=false, never silent repair) ──────────────
    if (positions.size() % 3 != 0) { res.reason = "positions length not a multiple of 3"; return res; }
    if (indices.size()   % 3 != 0) { res.reason = "indices length not a multiple of 3";   return res; }
    if (resolution < 2)            { res.reason = "resolution must be >= 2";               return res; }

    const std::uint32_t numV = static_cast<std::uint32_t>(positions.size() / 3);
    const std::uint32_t numF = static_cast<std::uint32_t>(indices.size()   / 3);
    if (numV == 0 || numF == 0) { res.reason = "empty mesh (no vertices or no faces)"; return res; }

    for (double c : positions) {
        if (!std::isfinite(c)) { res.reason = "non-finite vertex coordinate"; return res; }
    }
    if (!finite3(dir) || !finite3(origin)) { res.reason = "non-finite direction or origin"; return res; }

    const double dl = len(dir);
    if (!(dl > 0.0)) { res.reason = "degenerate view/pull direction (zero length)"; return res; }

    // ── build the right-handed (U, V, N) projection frame ─────────────────────
    // N is the view/pull direction; U,V span the projection plane with U×V = N.
    const Vec3 N = mul(dir, 1.0 / dl);
    Vec3 ref = (std::fabs(N.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    Vec3 U = cross(ref, N);                 // ⟂ N
    const double ul = len(U);
    if (!(ul > 0.0)) { res.reason = "could not form projection frame"; return res; }
    U = mul(U, 1.0 / ul);
    Vec3 V = cross(N, U);                    // unit, and U × V = N (right-handed)

    res.frame.origin = origin;
    res.frame.U = U; res.frame.V = V; res.frame.N = N;

    // ── project every vertex into the (u,v) frame ─────────────────────────────
    std::vector<double> pu(numV), pv(numV);
    for (std::uint32_t i = 0; i < numV; ++i) {
        const Vec3 p{positions[3 * i + 0], positions[3 * i + 1], positions[3 * i + 2]};
        const Vec3 d = sub(p, origin);
        pu[i] = dot(d, U);
        pv[i] = dot(d, V);
    }

    // ── projected bbox + degeneracy check ─────────────────────────────────────
    double minu = std::numeric_limits<double>::infinity();
    double minv = std::numeric_limits<double>::infinity();
    double maxu = -std::numeric_limits<double>::infinity();
    double maxv = -std::numeric_limits<double>::infinity();
    for (std::uint32_t i = 0; i < numV; ++i) {
        minu = std::min(minu, pu[i]); maxu = std::max(maxu, pu[i]);
        minv = std::min(minv, pv[i]); maxv = std::max(maxv, pv[i]);
    }
    double extu = maxu - minu, extv = maxv - minv;
    const double diag = std::sqrt(extu * extu + extv * extv);
    // A silhouette needs a 2D REGION (positive area). If the projected bbox
    // collapses to (near) a line — one extent vanishes relative to the other — the
    // shadow has no area and there is no outline to bound. Reject honestly. The
    // threshold is a relative one (thin axis < 1e-9 of the diagonal) so it fires
    // only for a genuinely flat projection, never for a merely thin-but-real shape.
    if (!(diag > 0.0) ||
        std::min(extu, extv) <= 1e-9 * diag) {
        res.reason = "projected mesh has zero 2D extent (degenerate projection along dir)";
        return res;
    }

    // ── grid sizing: `resolution` cells across the longer axis, plus a 1-cell
    //    margin so the union never touches the grid border (a boundary that hugs
    //    the frame edge would leave the trace open). ───────────────────────────
    const double longExt = std::max(extu, extv);
    const double cell = longExt / static_cast<double>(resolution);
    // Guard tiny-but-nonzero degenerate axes: a near-line projection still gets a
    // valid (thin) grid; only an EXACTLY zero diag was rejected above.
    if (!(cell > 0.0)) { res.reason = "non-positive grid cell size"; return res; }

    // 1-cell border margin on every side.
    const double gx0 = minu - cell;
    const double gy0 = minv - cell;
    const int W = static_cast<int>(std::ceil(extu / cell)) + 2;   // +2 for the two margins
    const int H = static_cast<int>(std::ceil(extv / cell)) + 2;
    if (W < 3 || H < 3) {
        // Pathologically thin projection: still honest, but the grid cannot
        // resolve an interior — fall through with a minimal grid is unsafe, so we
        // bump to a minimum that can hold a 1-cell-thick band.
        // (We never fabricate: just ensure the lattice is large enough to trace.)
    }
    const int gw = std::max(3, W);
    const int gh = std::max(3, H);

    res.gridW = static_cast<std::uint32_t>(gw);
    res.gridH = static_cast<std::uint32_t>(gh);
    res.cellSize = cell;

    // ── rasterize the UNION: occ[j*gw + i] = any projected triangle covers the
    //    centre of cell (i,j). Cell (i,j) centre is at
    //        cx = gx0 + (i + 0.5) * cell,  cy = gy0 + (j + 0.5) * cell. ─────────
    std::vector<unsigned char> occ(static_cast<std::size_t>(gw) * static_cast<std::size_t>(gh), 0);

    for (std::uint32_t f = 0; f < numF; ++f) {
        const std::uint32_t i0 = indices[3 * f + 0];
        const std::uint32_t i1 = indices[3 * f + 1];
        const std::uint32_t i2 = indices[3 * f + 2];
        if (i0 >= numV || i1 >= numV || i2 >= numV) {
            res.reason = "triangle index out of range"; return res;
        }
        const double ax = pu[i0], ay = pv[i0];
        const double bx = pu[i1], by = pv[i1];
        const double cx = pu[i2], cy = pv[i2];

        // Skip triangles that project to a zero-area sliver (a line/point along
        // dir): they contribute no coverage. Exactness of *coverage* comes from
        // the per-cell orient2d test; this is just a cheap skip, not a tolerance
        // decision on the silhouette.
        if (orient2d(ax, ay, bx, by, cx, cy) == Sign::ZERO) continue;

        // Conservative cell-index bbox of this triangle (clamp to grid).
        const double tminu = std::min({ax, bx, cx});
        const double tmaxu = std::max({ax, bx, cx});
        const double tminv = std::min({ay, by, cy});
        const double tmaxv = std::max({ay, by, cy});
        int ci0 = static_cast<int>(std::floor((tminu - gx0) / cell));
        int ci1 = static_cast<int>(std::floor((tmaxu - gx0) / cell));
        int cj0 = static_cast<int>(std::floor((tminv - gy0) / cell));
        int cj1 = static_cast<int>(std::floor((tmaxv - gy0) / cell));
        ci0 = std::max(0, ci0); ci1 = std::min(gw - 1, ci1);
        cj0 = std::max(0, cj0); cj1 = std::min(gh - 1, cj1);

        for (int j = cj0; j <= cj1; ++j) {
            const double cyc = gy0 + (j + 0.5) * cell;
            for (int i = ci0; i <= ci1; ++i) {
                std::size_t idx = static_cast<std::size_t>(j) * static_cast<std::size_t>(gw)
                                + static_cast<std::size_t>(i);
                if (occ[idx]) continue;            // already covered
                const double cxc = gx0 + (i + 0.5) * cell;
                if (pointInTri(cxc, cyc, ax, ay, bx, by, cx, cy)) occ[idx] = 1;
            }
        }
    }

    std::uint32_t occCount = 0;
    for (unsigned char o : occ) occCount += o;
    res.occupiedCells = occCount;

    if (occCount == 0) {
        // The mesh projects to no resolvable area at this resolution. This is an
        // honest legitimately-empty silhouette (e.g. a mesh thinner than one cell
        // along both axes). ok=true, zero contours.
        res.ok = true;
        return res;
    }

    // ── marching boundary trace ───────────────────────────────────────────────
    // The boundary lives on the grid LATTICE (nodes at integer (i,j), 0..gw,
    // 0..gh; lattice node (i,j) is the lower-left corner of cell (i,j)). For each
    // occupied cell we emit its 4 directed boundary half-edges ONLY where the
    // neighbour across that edge is empty (or off-grid). We orient each half-edge
    // so the FILLED cell is on its LEFT — this makes every outer loop CCW and
    // every hole loop CW automatically. Lattice point (i,j) world coord:
    //     x = gx0 + i * cell,  y = gy0 + j * cell.
    auto filled = [&](int i, int j) -> bool {
        if (i < 0 || j < 0 || i >= gw || j >= gh) return false;
        return occ[static_cast<std::size_t>(j) * static_cast<std::size_t>(gw)
                 + static_cast<std::size_t>(i)] != 0;
    };

    // Directed edge: from lattice node A=(ai,aj) to node B=(bi,bj). Stored as a
    // map keyed by the SOURCE node so we can walk head-to-tail. On a clean binary
    // grid every boundary node has out-degree == in-degree (1 for a simple
    // boundary); junction nodes (a checkerboard touch) can have degree 2 — handled
    // by the "turn so filled stays left" disambiguation below.
    struct DEdge { std::int64_t bi, bj; };
    std::unordered_map<std::uint64_t, std::vector<DEdge>> out;
    out.reserve(static_cast<std::size_t>(occCount) * 2 + 16);

    auto addEdge = [&](std::int64_t ai, std::int64_t aj,
                       std::int64_t bi, std::int64_t bj) {
        out[nodeId(ai, aj)].push_back(DEdge{bi, bj});
    };

    // For each occupied cell (i,j), the 4 boundary half-edges, each emitted with
    // the filled cell on its LEFT:
    //   left  edge (neighbour i-1 empty): go from (i, j+1) down to (i, j)
    //   right edge (neighbour i+1 empty): go from (i+1, j)   up to (i+1, j+1)
    //   bottom edge(neighbour j-1 empty): go from (i, j)   right to (i+1, j)
    //   top   edge (neighbour j+1 empty): go from (i+1, j+1) left to (i, j+1)
    // (Check the winding: bottom-right-top-left of a single filled cell traverses
    //  CCW, leaving the cell interior on the left — correct for an outer loop.)
    for (int j = 0; j < gh; ++j) {
        for (int i = 0; i < gw; ++i) {
            if (!filled(i, j)) continue;
            if (!filled(i - 1, j)) addEdge(i, j + 1, i, j);             // left
            if (!filled(i + 1, j)) addEdge(i + 1, j, i + 1, j + 1);     // right
            if (!filled(i, j - 1)) addEdge(i, j, i + 1, j);             // bottom
            if (!filled(i, j + 1)) addEdge(i + 1, j + 1, i, j + 1);     // top
        }
    }

    // ── stitch directed edges into closed loops ───────────────────────────────
    // Walk from each unused edge, always choosing at a junction the outgoing edge
    // that turns most CLOCKWISE relative to the incoming direction (keeps the
    // filled region on the left — the standard "wall follower" for grid contours,
    // resolving checkerboard junctions consistently).
    auto lattice = [&](std::int64_t i, std::int64_t j) -> Point2D {
        return Point2D{gx0 + static_cast<double>(i) * cell,
                       gy0 + static_cast<double>(j) * cell};
    };

    // Track consumed edges by (src,dst) pair.
    auto edgeKey2 = [](std::uint64_t a, std::uint64_t b) -> std::uint64_t {
        // 64+64 -> a single key via a cheap mix (src already unique per dst in a
        // simple boundary; for junctions we additionally store the dst). Use a
        // composed key in a set keyed on the pair through string-free hashing.
        // We instead store consumption in a parallel structure below.
        (void)a; (void)b; return 0;
    };
    (void)edgeKey2;

    // Consumption flags per directed edge: we mark by erasing from `out` lists.
    // To pick the next edge at node B that came from direction (B - A), prefer the
    // one whose turn keeps filled-on-left: choose the outgoing edge with the
    // SMALLEST left-turn (most clockwise) — for a 4-connected lattice the turn is
    // one of {straight, left, right, back}; "most clockwise" = right > straight >
    // left > back, which is the wall-follower that traces simple loops cleanly.
    auto turnRank = [](std::int64_t indx, std::int64_t indy,
                       std::int64_t outdx, std::int64_t outdy) -> int {
        // 2D cross (in) x (out) and dot.
        const std::int64_t crs = indx * outdy - indy * outdx;
        const std::int64_t dt  = indx * outdx + indy * outdy;
        // Lower rank = preferred (most clockwise turn first).
        if (crs < 0) return 0;            // right turn
        if (crs == 0 && dt > 0) return 1; // straight
        if (crs > 0) return 2;            // left turn
        return 3;                         // back (dt<0, crs==0)
    };

    // Deterministic loop start order: iterate lattice nodes in sorted key order.
    std::map<std::uint64_t, std::size_t> remaining;  // node -> #unused out edges
    for (auto& kv : out) if (!kv.second.empty()) remaining[kv.first] = kv.second.size();

    std::vector<SilhouetteContour> rawLoops;

    while (!remaining.empty()) {
        // Pick the lowest-keyed node that still has an unused outgoing edge.
        auto rit = remaining.begin();
        std::uint64_t startKey = rit->first;
        const std::int64_t startI = static_cast<std::int64_t>(static_cast<std::uint32_t>(startKey >> 32));
        const std::int64_t startJ = static_cast<std::int64_t>(static_cast<std::uint32_t>(startKey & 0xFFFFFFFFu));

        // Take any unused outgoing edge from the start.
        auto& sv = out[startKey];
        std::size_t pick = sv.size();
        for (std::size_t k = 0; k < sv.size(); ++k) {
            if (sv[k].bi != std::numeric_limits<std::int64_t>::min()) { pick = k; break; }
        }
        if (pick == sv.size()) { remaining.erase(rit); continue; }

        std::int64_t curI = startI, curJ = startJ;
        std::int64_t nxtI = sv[pick].bi, nxtJ = sv[pick].bj;
        // consume
        sv[pick].bi = std::numeric_limits<std::int64_t>::min();
        if (--remaining[startKey] == 0) remaining.erase(startKey);

        SilhouetteContour loop;
        loop.points.push_back(lattice(curI, curJ));

        std::int64_t prevI = curI, prevJ = curJ;
        curI = nxtI; curJ = nxtJ;
        std::size_t guard = 0;
        const std::size_t guardMax = static_cast<std::size_t>(gw) * static_cast<std::size_t>(gh) * 4 + 16;
        bool closed = false;

        while (guard++ <= guardMax) {
            if (curI == startI && curJ == startJ) { closed = true; break; }
            loop.points.push_back(lattice(curI, curJ));

            std::uint64_t curKey = nodeId(curI, curJ);
            auto oit = out.find(curKey);
            if (oit == out.end()) { break; }   // dead end (shouldn't happen on a closed boundary)
            // incoming direction
            const std::int64_t indx = curI - prevI, indy = curJ - prevJ;
            // choose the unused outgoing edge with the best (lowest) turn rank.
            std::size_t best = oit->second.size();
            int bestRank = 99;
            for (std::size_t k = 0; k < oit->second.size(); ++k) {
                const DEdge& e = oit->second[k];
                if (e.bi == std::numeric_limits<std::int64_t>::min()) continue;  // used
                const std::int64_t odx = e.bi - curI, ody = e.bj - curJ;
                const int r = turnRank(indx, indy, odx, ody);
                if (r < bestRank) { bestRank = r; best = k; }
            }
            if (best == oit->second.size()) { break; }   // no continuation

            std::int64_t bI = oit->second[best].bi, bJ = oit->second[best].bj;
            oit->second[best].bi = std::numeric_limits<std::int64_t>::min();  // consume
            auto rem = remaining.find(curKey);
            if (rem != remaining.end()) { if (--rem->second == 0) remaining.erase(rem); }

            prevI = curI; prevJ = curJ;
            curI = bI; curJ = bJ;
        }

        if (closed && loop.points.size() >= 3) {
            rawLoops.push_back(std::move(loop));
        }
        // An unclosed walk (only possible on a corrupt boundary) is dropped; its
        // edges were consumed so the outer while-loop still terminates. We never
        // fabricate a loop — see the ok-classification below.
    }

    if (rawLoops.empty()) {
        // Occupied cells existed but no closed boundary could be traced — this is
        // an honest failure of the trace (not an empty silhouette). Report it.
        res.reason = "boundary trace produced no closed loop despite occupied cells";
        return res;
    }

    // ── simplify the staircase + compute signed area / perimeter / winding ─────
    // The raw marching boundary is an axis-aligned lattice staircase. We reduce it
    // to a clean polygon in two stages:
    //   (1) drop EXACTLY collinear lattice points (lossless — the long horizontal
    //       / vertical runs of the staircase). Area is UNCHANGED by this.
    //   (2) closed-ring Douglas-Peucker with a ~1-cell tolerance to collapse the
    //       diagonal staircase of a slanted silhouette edge into the straight edge
    //       it approximates. This is exactly the documented "accurate to ~1 cell"
    //       envelope; it turns the cube-body-diagonal staircase into a clean
    //       6-corner hexagon and a slanted box edge into one segment, while leaving
    //       axis-aligned edges (the rectangle, the L) bit-identical.
    const double dpTol = cell * 1.5;     // ~1 cell of allowed deviation
    auto simplifyAndMeasure = [&](SilhouetteContour& c) {
        std::vector<Point2D>& P = c.points;

        // (1) lossless collinear collapse around the closed ring.
        if (P.size() >= 3) {
            std::vector<Point2D> out2;
            out2.reserve(P.size());
            const std::size_t n = P.size();
            for (std::size_t k = 0; k < n; ++k) {
                const Point2D& a = P[(k + n - 1) % n];
                const Point2D& b = P[k];
                const Point2D& d = P[(k + 1) % n];
                const double e0x = b.u - a.u, e0y = b.v - a.v;
                const double e1x = d.u - b.u, e1y = d.v - b.v;
                const double crs = e0x * e1y - e0y * e1x;
                if (std::fabs(crs) > 0.0) out2.push_back(b);   // genuine turn only
            }
            if (out2.size() >= 3) P.swap(out2);
        }

        // (2) closed-ring Douglas-Peucker. Split the ring at its two farthest-apart
        //     vertices (the diameter endpoints i<j) — both are guaranteed extreme
        //     (on the convex hull) so they are NEVER dropped; this avoids the
        //     degenerate "anchor a chord across the closing edge" mistake. DP each
        //     of the two open arcs (i..j) and (j..i, wrapping through the end).
        if (P.size() >= 4 && dpTol > 0.0) {
            const std::size_t n = P.size();
            std::size_t ai = 0, aj = 0; double bestD = -1.0;
            for (std::size_t a = 0; a < n; ++a)
                for (std::size_t b = a + 1; b < n; ++b) {
                    const double dx = P[b].u - P[a].u, dy = P[b].v - P[a].v;
                    const double d2 = dx * dx + dy * dy;
                    if (d2 > bestD) { bestD = d2; ai = a; aj = b; }
                }
            if (aj > ai + 1 || (n - (aj - ai)) > 2) {
                std::vector<char> keep(n, 0);
                keep[ai] = 1; keep[aj] = 1;
                // arc 1: ai .. aj (no wrap) — DP directly.
                douglasPeuckerOpen(P, ai, aj, dpTol, keep);
                // arc 2: aj .. (wrap) .. ai. Build a contiguous copy so the open
                // DP sees real neighbours across the wrap, then map kept indices
                // back to the original ring.
                std::vector<Point2D> arc2;
                std::vector<std::size_t> map2;
                for (std::size_t k = aj; k < n; ++k) { arc2.push_back(P[k]); map2.push_back(k); }
                for (std::size_t k = 0; k <= ai; ++k) { arc2.push_back(P[k]); map2.push_back(k); }
                if (arc2.size() >= 3) {
                    std::vector<char> keep2(arc2.size(), 0);
                    keep2.front() = 1; keep2.back() = 1;
                    douglasPeuckerOpen(arc2, 0, arc2.size() - 1, dpTol, keep2);
                    for (std::size_t k = 0; k < arc2.size(); ++k)
                        if (keep2[k]) keep[map2[k]] = 1;
                }
                std::vector<Point2D> out3;
                out3.reserve(n);
                for (std::size_t k = 0; k < n; ++k) if (keep[k]) out3.push_back(P[k]);
                if (out3.size() >= 3) P.swap(out3);
            }

            // (3) post-DP near-collinear cleanup. The two forced diameter anchors
            //     can sit mid-edge, leaving a sub-tolerance kink that splits one
            //     straight silhouette edge into two near-collinear segments. Remove
            //     any vertex whose perpendicular deviation from the chord through
            //     its two ring neighbours is below the cell tolerance — this is the
            //     same ~1-cell accuracy bound, applied to kill anchor artefacts
            //     without touching genuine corners. Iterate to a fixed point.
            bool changed = true;
            while (changed && P.size() > 3) {
                changed = false;
                const std::size_t m = P.size();
                for (std::size_t k = 0; k < m; ++k) {
                    const Point2D& a = P[(k + m - 1) % m];
                    const Point2D& b = P[k];
                    const Point2D& d = P[(k + 1) % m];
                    if (perpDist(b, a, d) < dpTol) {
                        P.erase(P.begin() + static_cast<std::ptrdiff_t>(k));
                        changed = true;
                        break;   // ring indices shifted; restart the scan
                    }
                }
            }
        }

        // measure on the simplified ring
        double area2 = 0.0, peri = 0.0;
        const std::size_t n = P.size();
        for (std::size_t k = 0; k < n; ++k) {
            const Point2D& p0 = P[k];
            const Point2D& p1 = P[(k + 1) % n];
            area2 += (p0.u * p1.v - p1.u * p0.v);
            const double dx = p1.u - p0.u, dy = p1.v - p0.v;
            peri += std::sqrt(dx * dx + dy * dy);
        }
        c.signedArea = 0.5 * area2;
        c.perimeter = peri;
        c.isHole = (c.signedArea < 0.0);
    };

    for (auto& c : rawLoops) simplifyAndMeasure(c);

    // Drop any degenerate zero-area loop (cannot arise from a clean trace, but a
    // single-cell speckle could; never report a zero-area "loop").
    std::vector<SilhouetteContour> loops;
    loops.reserve(rawLoops.size());
    for (auto& c : rawLoops) {
        if (c.points.size() >= 3 && std::fabs(c.signedArea) > 0.0) loops.push_back(std::move(c));
    }
    if (loops.empty()) {
        res.reason = "all traced loops were degenerate (zero area)";
        return res;
    }

    // ── assemble result ───────────────────────────────────────────────────────
    res.contours = std::move(loops);
    res.numContours = static_cast<std::uint32_t>(res.contours.size());
    for (const auto& c : res.contours) {
        if (c.signedArea > 0.0) ++res.numOuter; else ++res.numHoles;
        res.netArea += c.signedArea;
        res.totalPerimeter += c.perimeter;
    }
    res.ok = true;
    return res;
}

SilhouetteResult projectSilhouette(const std::vector<double>& positions,
                                   const std::vector<std::uint32_t>& indices,
                                   const Vec3& dir,
                                   std::uint32_t resolution) {
    // Default origin = mesh-bbox centre (only translates the output).
    if (positions.size() % 3 != 0 || positions.empty()) {
        // Defer the honest error reporting to the main overload by passing a
        // benign origin; it will reject the malformed input.
        return projectSilhouette(positions, indices, dir, Vec3{0, 0, 0}, resolution);
    }
    double minx = std::numeric_limits<double>::infinity();
    double miny = std::numeric_limits<double>::infinity();
    double minz = std::numeric_limits<double>::infinity();
    double maxx = -std::numeric_limits<double>::infinity();
    double maxy = -std::numeric_limits<double>::infinity();
    double maxz = -std::numeric_limits<double>::infinity();
    bool anyFinite = false;
    for (std::size_t i = 0; i + 2 < positions.size(); i += 3) {
        const double x = positions[i], y = positions[i + 1], z = positions[i + 2];
        if (std::isfinite(x) && std::isfinite(y) && std::isfinite(z)) {
            anyFinite = true;
            minx = std::min(minx, x); maxx = std::max(maxx, x);
            miny = std::min(miny, y); maxy = std::max(maxy, y);
            minz = std::min(minz, z); maxz = std::max(maxz, z);
        }
    }
    Vec3 origin{0, 0, 0};
    if (anyFinite) {
        origin = Vec3{0.5 * (minx + maxx), 0.5 * (miny + maxy), 0.5 * (minz + maxz)};
    }
    return projectSilhouette(positions, indices, dir, origin, resolution);
}

SilhouetteResult projectSilhouette(const HalfEdgeMesh& mesh,
                                   const Vec3& dir,
                                   std::uint32_t resolution) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    mesh.toSoup(pos, idx);
    return projectSilhouette(pos, idx, dir, resolution);
}

} // namespace mesh
} // namespace native
} // namespace forge
