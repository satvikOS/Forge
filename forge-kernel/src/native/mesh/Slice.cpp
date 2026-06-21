// forge/native/mesh/Slice.cpp
//
// Implementation of forge::native::mesh::Slice — the planar cross-section of a
// closed triangle mesh into closed contour loops. See Slice.hpp for the honest
// scope statement. Pure C++20, standard library plus the existing forge/native
// headers only. No OCCT, no WASM, no third-party libs.

#include "forge/native/mesh/Slice.hpp"

#include <algorithm>     // std::sort, std::min, std::max, std::find, std::swap
#include <array>         // std::array
#include <cmath>         // std::sqrt, std::fabs, std::isfinite, std::atan2
#include <cstddef>       // std::size_t
#include <cstdint>       // std::uint32_t, std::uint64_t
#include <limits>        // std::numeric_limits
#include <unordered_map> // std::unordered_map
#include <vector>        // std::vector

namespace forge {
namespace native {
namespace mesh {

namespace {

// ── tiny 3D vector helpers (local; we do not pull in a Vec3 algebra header) ──
inline Vec3 sub(const Vec3& a, const Vec3& b) { return Vec3{a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 add(const Vec3& a, const Vec3& b) { return Vec3{a.x + b.x, a.y + b.y, a.z + b.z}; }
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

// Pack an UNORDERED vertex-index pair into one 64-bit key (smaller index first),
// so the two triangles sharing a mesh edge agree on the same crossing point.
inline std::uint64_t edgeKey(std::uint32_t a, std::uint32_t b) {
    if (a > b) std::swap(a, b);
    return (static_cast<std::uint64_t>(a) << 32) | static_cast<std::uint64_t>(b);
}

// A directed segment in the cut plane, given as a pair of crossing-vertex ids
// (indices into the deduplicated contour-vertex list). Oriented so the solid
// interior stays on the left of a -> b.
struct Seg {
    std::uint32_t a;
    std::uint32_t b;
};

} // namespace

double fitCircleRadius(const std::vector<Vec3>& pts, const Vec3& normal, bool& ok) {
    ok = false;
    if (pts.size() < 3) return 0.0;

    // Build an orthonormal (u, v) frame in the plane (u, v perpendicular to N).
    const double nl = len(normal);
    if (!(nl > 0.0) || !finite3(normal)) return 0.0;
    Vec3 N = mul(normal, 1.0 / nl);
    Vec3 ref = (std::fabs(N.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    Vec3 U = cross(N, ref);
    const double ul = len(U);
    if (!(ul > 0.0)) return 0.0;
    U = mul(U, 1.0 / ul);
    Vec3 V = cross(N, U);   // already unit (N, U unit & orthogonal)

    // Project to 2D, then Kåsa algebraic circle fit: minimise
    //   sum (x²+y² - (2cx·x + 2cy·y + (r²-cx²-cy²)))²  ->  linear normal equations.
    // Solve the 3x3 symmetric system  M [A B C]^T = rhs  where
    //   A=2cx, B=2cy, C=r²-cx²-cy².
    double Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0;
    double Sxz = 0, Syz = 0, Sz = 0;   // z = x²+y²
    const double n = static_cast<double>(pts.size());
    std::vector<std::array<double, 2>> p2(pts.size());
    for (std::size_t i = 0; i < pts.size(); ++i) {
        Vec3 d = sub(pts[i], pts[0]);   // recentre near data for conditioning
        const double x = dot(d, U);
        const double y = dot(d, V);
        p2[i] = {x, y};
        const double z = x * x + y * y;
        Sx += x; Sy += y; Sz += z;
        Sxx += x * x; Syy += y * y; Sxy += x * y;
        Sxz += x * z; Syz += y * z;
    }
    // Normal-equation matrix (symmetric):
    //   [ Sxx Sxy Sx ] [A]   [Sxz]
    //   [ Sxy Syy Sy ] [B] = [Syz]
    //   [ Sx  Sy  n  ] [C]   [Sz ]
    const double m00 = Sxx, m01 = Sxy, m02 = Sx;
    const double m10 = Sxy, m11 = Syy, m12 = Sy;
    const double m20 = Sx,  m21 = Sy,  m22 = n;
    const double r0 = Sxz, r1 = Syz, r2 = Sz;

    // Determinant via cofactor expansion.
    const double det =
        m00 * (m11 * m22 - m12 * m21) -
        m01 * (m10 * m22 - m12 * m20) +
        m02 * (m10 * m21 - m11 * m20);
    if (std::fabs(det) < 1e-18) return 0.0;   // collinear / degenerate fit

    // Cramer's rule for A, B, C.
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

    const double cx = 0.5 * A;
    const double cy = 0.5 * B;
    const double rr = C + cx * cx + cy * cy;
    if (!(rr > 0.0)) return 0.0;
    ok = true;
    return std::sqrt(rr);
}

SliceResult slice(const std::vector<double>& positions,
                  const std::vector<std::uint32_t>& indices,
                  const Plane& plane) {
    SliceResult res;

    // ── input validation (honest ok=false, never silent repair) ──────────────
    if (positions.size() % 3 != 0) { res.reason = "positions length not a multiple of 3"; return res; }
    if (indices.size()   % 3 != 0) { res.reason = "indices length not a multiple of 3";   return res; }

    const std::uint32_t numV = static_cast<std::uint32_t>(positions.size() / 3);
    const std::uint32_t numF = static_cast<std::uint32_t>(indices.size()   / 3);

    for (double c : positions) {
        if (!std::isfinite(c)) { res.reason = "non-finite vertex coordinate"; return res; }
    }
    if (!finite3(plane.point) || !finite3(plane.normal)) {
        res.reason = "non-finite plane"; return res;
    }

    const double nl = len(plane.normal);
    if (!(nl > 0.0)) { res.reason = "degenerate plane normal (zero length)"; return res; }
    const Vec3 N = mul(plane.normal, 1.0 / nl);     // unit normal
    const Vec3 P = plane.point;

    // Vertex positions + signed distances to the plane.
    std::vector<Vec3> pos(numV);
    std::vector<double> sdist(numV);
    for (std::uint32_t v = 0; v < numV; ++v) {
        pos[v] = Vec3{positions[3 * v + 0], positions[3 * v + 1], positions[3 * v + 2]};
        sdist[v] = dot(sub(pos[v], P), N);
    }

    // A scale-aware zero band: treat |s| <= eps as exactly ON the plane, so a
    // vertex that should lie in the plane is not split by float noise into a
    // hair-thin crossing. eps scales with the mesh extent so it is unit-agnostic.
    double extent = 0.0;
    for (std::uint32_t v = 0; v < numV; ++v) extent = std::max(extent, len(sub(pos[v], P)));
    const double eps = (extent > 0.0 ? extent : 1.0) * 1e-9;
    auto sideOf = [&](double s) -> int {            // -1 below, +1 above, 0 on
        if (s >  eps) return  1;
        if (s < -eps) return -1;
        return 0;
    };

    // ── build per-edge crossing points + per-triangle segments ────────────────
    // Each unordered straddling mesh edge gets ONE contour vertex (shared by both
    // incident triangles). On-plane vertices become contour vertices keyed by a
    // self-pair so duplicates collapse.
    std::unordered_map<std::uint64_t, std::uint32_t> xvert;   // edge/vertex key -> contour-vertex id
    std::vector<Vec3> cpts;                                   // deduplicated contour vertices
    cpts.reserve(numF);

    auto getOnVertex = [&](std::uint32_t vi) -> std::uint32_t {
        const std::uint64_t key = edgeKey(vi, vi);
        auto it = xvert.find(key);
        if (it != xvert.end()) return it->second;
        const std::uint32_t id = static_cast<std::uint32_t>(cpts.size());
        cpts.push_back(pos[vi]);
        xvert.emplace(key, id);
        return id;
    };
    auto getEdgeCross = [&](std::uint32_t va, std::uint32_t vb) -> std::uint32_t {
        const std::uint64_t key = edgeKey(va, vb);
        auto it = xvert.find(key);
        if (it != xvert.end()) return it->second;
        // Linear interpolation by signed distance: point where s == 0.
        const double sa = sdist[va], sb = sdist[vb];
        const double denom = (sa - sb);
        const double t = (denom != 0.0) ? sa / denom : 0.5;   // fraction from a->b
        const Vec3 X = add(pos[va], mul(sub(pos[vb], pos[va]), t));
        const std::uint32_t id = static_cast<std::uint32_t>(cpts.size());
        cpts.push_back(X);
        xvert.emplace(key, id);
        return id;
    };

    std::vector<Seg> segs;
    segs.reserve(numF);

    for (std::uint32_t f = 0; f < numF; ++f) {
        const std::uint32_t i0 = indices[3 * f + 0];
        const std::uint32_t i1 = indices[3 * f + 1];
        const std::uint32_t i2 = indices[3 * f + 2];
        if (i0 >= numV || i1 >= numV || i2 >= numV) {
            res.reason = "triangle index out of range"; return res;
        }

        const std::array<std::uint32_t, 3> vi = {i0, i1, i2};
        const std::array<int, 3> sg = {sideOf(sdist[i0]), sideOf(sdist[i1]), sideOf(sdist[i2])};

        const int nPlus  = (sg[0] > 0) + (sg[1] > 0) + (sg[2] > 0);
        const int nMinus = (sg[0] < 0) + (sg[1] < 0) + (sg[2] < 0);
        const int nZero  = (sg[0] == 0) + (sg[1] == 0) + (sg[2] == 0);

        // Coplanar face (all three on the plane): its outline is its own boundary,
        // not a transversal cut — report honestly and skip (no spurious loop).
        if (nZero == 3) { ++res.coplanarFaces; continue; }

        // No transversal: the triangle lies entirely on one side (touching with 1
        // or 2 on-plane vertices is NOT a crossing — it grazes). Produces no
        // segment, hence no duplicate / degenerate loop.
        if (nPlus == 0 || nMinus == 0) continue;

        // Collect the (at most two) distinct on-plane crossing points of this
        // triangle: interpolated points on strictly-straddling edges plus any
        // on-plane vertex. The triangle's intersection with the plane is the chord
        // between these two points.
        std::array<std::uint32_t, 3> hit{};
        int nHit = 0;
        auto pushHit = [&](std::uint32_t id) {
            for (int k = 0; k < nHit; ++k) if (hit[k] == id) return;   // dedup
            if (nHit < 3) hit[nHit++] = id;
        };
        // On-plane vertices are crossing points.
        for (int k = 0; k < 3; ++k) if (sg[k] == 0) pushHit(getOnVertex(vi[k]));
        // Edges with strictly opposite-sign endpoints carry an interpolated point.
        const std::array<std::array<int, 2>, 3> edges = {{ {0, 1}, {1, 2}, {2, 0} }};
        for (const auto& e : edges) {
            const int sA = sg[e[0]], sB = sg[e[1]];
            if (sA * sB < 0) pushHit(getEdgeCross(vi[e[0]], vi[e[1]]));
        }

        if (nHit != 2) continue;   // tangent vertex only / degenerate -> no chord

        std::uint32_t a = hit[0], b = hit[1];

        // Orient the segment so the SOLID interior (s<0 half-space) is on its left
        // in the plane's CCW frame about +N. The triangle's own outward normal is
        // Ntri = (p1-p0) x (p2-p0). The chord, traversed so material is on the
        // left, satisfies  N x (cpts[b]-cpts[a])  pointing toward the solid side.
        // Equivalently: pick direction so that (chord) crosses from the +side edge
        // to the -side edge with the face normal agreeing. We use the robust rule:
        // the boundary of the solid cross-section is wound CCW about +N, i.e. for
        // the in-plane segment dir = cpts[b]-cpts[a], we need N·(Ntri x dir) >= 0
        // is NOT generally meaningful per-tri; instead orient by the requirement
        // that the solid (s<0) lies to the LEFT, decided per triangle below.
        const Vec3 Ntri = cross(sub(pos[i1], pos[i0]), sub(pos[i2], pos[i0]));
        const Vec3 dir = sub(cpts[b], cpts[a]);
        // "Left" of a->b in the plane is the +90° (about +N) direction: N x dir.
        // The interior of the solid bounded by this contour edge must be on the
        // left, so (N x dir) must point INTO the solid, i.e. toward decreasing s.
        // The triangle straddles the plane; its outward normal Ntri points OUT of
        // the solid. Therefore (N x dir) should point OPPOSITE to the in-plane
        // component of Ntri. If it does not, swap a/b.
        const Vec3 leftDir = cross(N, dir);
        if (dot(leftDir, Ntri) > 0.0) std::swap(a, b);

        if (a != b) { segs.push_back(Seg{a, b}); ++res.crossedTris; }
    }

    // ── stitch oriented segments into closed loops ───────────────────────────
    // Build outgoing adjacency: for a watertight mesh every contour vertex has
    // exactly one outgoing and one incoming segment, so a greedy next-walk closes
    // each loop deterministically.
    const std::uint32_t M = static_cast<std::uint32_t>(cpts.size());
    std::vector<std::uint32_t> nextOf(M, kInvalid);   // a -> b
    std::vector<std::uint32_t> indeg(M, 0), outdeg(M, 0);
    bool branchy = false;
    for (const Seg& s : segs) {
        if (nextOf[s.a] != kInvalid) branchy = true;  // >1 outgoing: non-simple
        nextOf[s.a] = s.b;
        ++outdeg[s.a];
        ++indeg[s.b];
    }
    // On a clean watertight slice every used vertex has in==out==1. If a vertex
    // has a different degree the contour graph is not a disjoint union of simple
    // cycles (self-touching / non-manifold-at-the-plane) — surface honestly.
    for (std::uint32_t v = 0; v < M; ++v) {
        if (outdeg[v] != indeg[v]) branchy = true;
        if (outdeg[v] > 1 || indeg[v] > 1) branchy = true;
    }

    if (segs.empty()) {
        // Plane misses the mesh (or only grazes): legitimately empty, ok=true.
        res.ok = true;
        res.numContours = 0;
        return res;
    }

    if (branchy) {
        res.reason = "contour graph is not a union of simple closed loops "
                     "(self-touching / non-manifold section)";
        return res;
    }

    std::vector<bool> visited(M, false);
    auto inPlaneUV = [&](const Vec3& p, double& u, double& v) {
        Vec3 ref = (std::fabs(N.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
        Vec3 U = cross(N, ref); U = mul(U, 1.0 / len(U));
        Vec3 V = cross(N, U);
        Vec3 d = sub(p, P);
        u = dot(d, U); v = dot(d, V);
    };

    for (const Seg& s : segs) {
        if (visited[s.a]) continue;
        // Walk the cycle starting at s.a.
        Contour c;
        std::uint32_t start = s.a;
        std::uint32_t cur = start;
        std::size_t guard = 0;
        bool closed = false;
        while (guard++ <= M) {
            if (visited[cur]) { closed = (cur == start); break; }
            visited[cur] = true;
            c.points.push_back(cpts[cur]);
            std::uint32_t nx = nextOf[cur];
            if (nx == kInvalid) { closed = false; break; }   // open chain
            if (nx == start) { closed = true; break; }
            cur = nx;
        }
        if (!closed || c.points.size() < 3) {
            res.reason = "open or degenerate contour chain (mesh not watertight "
                         "across the cut)";
            return res;
        }

        // Signed area + perimeter in the plane's (u,v) frame.
        double areaSum = 0.0, peri = 0.0;
        const std::size_t np = c.points.size();
        for (std::size_t k = 0; k < np; ++k) {
            const Vec3& p0 = c.points[k];
            const Vec3& p1 = c.points[(k + 1) % np];
            double u0, v0, u1, v1;
            inPlaneUV(p0, u0, v0);
            inPlaneUV(p1, u1, v1);
            areaSum += (u0 * v1 - u1 * v0);
            peri += len(sub(p1, p0));
        }
        c.area = 0.5 * areaSum;
        c.perimeter = peri;
        res.totalArea += std::fabs(c.area);
        res.totalPerimeter += c.perimeter;
        res.contours.push_back(std::move(c));
    }

    res.ok = true;
    res.numContours = static_cast<std::uint32_t>(res.contours.size());
    return res;
}

SliceResult slice(const HalfEdgeMesh& mesh, const Plane& plane) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    mesh.toSoup(pos, idx);
    return slice(pos, idx, plane);
}

} // namespace mesh
} // namespace native
} // namespace forge
