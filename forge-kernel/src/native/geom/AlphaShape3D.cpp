// forge/native/geom/AlphaShape3D.cpp
//
// Implementation of the in-house 3D alpha shape / alpha complex.
// See forge/native/geom/AlphaShape3D.hpp for the contract and robustness posture.
//
// The combinatorial skeleton (which tets exist, which faces they share) comes
// entirely from the EXACT-predicate Delaunay tetrahedralization. The only double
// that this file introduces is the circumradius compared against alpha; a point
// at r == alpha is included (closed alpha complex).

#include "forge/native/geom/AlphaShape3D.hpp"

#include <algorithm>      // std::sort, std::swap, std::min, std::max
#include <array>          // std::array
#include <cmath>          // std::sqrt, std::fabs, std::isfinite
#include <cstdint>        // std::uint32_t, std::uint64_t
#include <limits>         // std::numeric_limits
#include <unordered_map>  // std::unordered_map (shared-face dedup)
#include <vector>         // std::vector

#include "forge/native/Predicates.hpp"        // orient3d (exact)
#include "forge/native/geom/Delaunay3D.hpp"   // delaunay3D, Delaunay3DResult

namespace forge {
namespace native {
namespace geom {

namespace {

// ---- Undirected triangle key: the three vertex indices sorted ascending, so a
//      face shared by two tets (in opposite winding) hashes to one key. --------
struct FaceKey {
    int a, b, c;  // a < b < c
    bool operator==(const FaceKey& o) const {
        return a == o.a && b == o.b && c == o.c;
    }
};

struct FaceKeyHash {
    std::size_t operator()(const FaceKey& k) const {
        std::uint64_t h = static_cast<std::uint32_t>(k.a);
        h = h * 1000003ull + static_cast<std::uint32_t>(k.b);
        h = h * 1000003ull + static_cast<std::uint32_t>(k.c);
        // final mix
        h ^= h >> 33;
        h *= 0xFF51AFD7ED558CCDull;
        h ^= h >> 33;
        return static_cast<std::size_t>(h);
    }
};

inline FaceKey faceKey(int x, int y, int z) {
    if (x > y) std::swap(x, y);
    if (y > z) std::swap(y, z);
    if (x > y) std::swap(x, y);
    return FaceKey{x, y, z};
}

// The four ORIENTED faces of a POSITIVE tet (a,b,c,d), each wound so its outward
// normal points AWAY from the tet (the opposite vertex lies below the face:
// orient3d(face, w) > 0). Identical convention to Delaunay3D's internal
// orientedFaces — for a tet on the boundary of the kept region, "outward from the
// tet" == "outward from the region", which is exactly the boundary orientation
// we want to emit.
inline std::array<std::array<int,3>,4> outwardFaces(const std::array<int,4>& t) {
    return {{
        {{t[0], t[1], t[2]}},   // opposite t[3]
        {{t[0], t[3], t[1]}},   // opposite t[2]
        {{t[0], t[2], t[3]}},   // opposite t[1]
        {{t[1], t[3], t[2]}},   // opposite t[0]
    }};
}

inline double dot(const Point3& a, const Point3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

inline Point3 cross(const Point3& a, const Point3& b) {
    return Point3{a.y * b.z - a.z * b.y,
                  a.z * b.x - a.x * b.z,
                  a.x * b.y - a.y * b.x};
}

inline Point3 sub(const Point3& a, const Point3& b) {
    return Point3{a.x - b.x, a.y - b.y, a.z - b.z};
}

} // namespace

double alphaInfinity() {
    return std::numeric_limits<double>::infinity();
}

double tetCircumradius(const Point3& a, const Point3& b,
                       const Point3& c, const Point3& d) {
    // Circumcenter x solves, relative to a:
    //   2 (b-a).x = |b|^2-|a|^2  ... for b,c,d.
    // In offset coordinates u=b-a, v=c-a, w=d-a, the center offset o = x-a is the
    // solution of the classic formula
    //   o = ( |u|^2 (v x w) + |v|^2 (w x u) + |w|^2 (u x v) ) / (2 (u . (v x w)))
    // and the circumradius is |o|. The denominator is 2 * 6 * tetVolume, so it is
    // nonzero exactly when the tet is non-degenerate. A coplanar / degenerate tet
    // yields an (ill-conditioned) huge or non-finite radius -> reported as +inf so
    // it is only ever kept by an unbounded alpha.
    const Point3 u = sub(b, a);
    const Point3 v = sub(c, a);
    const Point3 w = sub(d, a);

    const Point3 vxw = cross(v, w);
    const double denom = 2.0 * dot(u, vxw);
    if (denom == 0.0 || !std::isfinite(denom)) {
        return std::numeric_limits<double>::infinity();
    }

    const double u2 = dot(u, u);
    const double v2 = dot(v, v);
    const double w2 = dot(w, w);

    const Point3 wxu = cross(w, u);
    const Point3 uxv = cross(u, v);

    Point3 o{
        (u2 * vxw.x + v2 * wxu.x + w2 * uxv.x) / denom,
        (u2 * vxw.y + v2 * wxu.y + w2 * uxv.y) / denom,
        (u2 * vxw.z + v2 * wxu.z + w2 * uxv.z) / denom,
    };

    const double r = std::sqrt(dot(o, o));
    if (!std::isfinite(r)) return std::numeric_limits<double>::infinity();
    return r;
}

AlphaShape3DResult alphaShape3DFromDelaunay(const Delaunay3DResult& del,
                                            double alpha) {
    AlphaShape3DResult R;
    R.alpha = alpha;
    R.points = del.points;
    R.inputIndex = del.inputIndex;

    if (!del.ok) {
        R.ok = false;
        R.reason = del.reason && del.reason[0] ? del.reason
                                               : "delaunay3D failed (degenerate input)";
        return R;
    }
    R.ok = true;

    const std::vector<Point3>& P = R.points;

    // Negative alpha is meaningless for a radius threshold; clamp to 0 (which, for
    // any real tet with positive circumradius, keeps nothing).
    double effAlpha = alpha;
    if (effAlpha < 0.0) effAlpha = 0.0;

    // ---- 1. Circumradius of every Delaunay tet; record the max and select the
    //         alpha-interior tets (r <= alpha). ---------------------------------
    const std::vector<std::array<int,4>>& tets = del.tetrahedra;
    std::vector<double> radius(tets.size(), 0.0);
    double maxR = 0.0;
    for (std::size_t i = 0; i < tets.size(); ++i) {
        const std::array<int,4>& t = tets[i];
        double r = tetCircumradius(P[t[0]], P[t[1]], P[t[2]], P[t[3]]);
        radius[i] = r;
        if (std::isfinite(r) && r > maxR) maxR = r;
    }
    R.maxCircumradius = maxR;

    R.keptTets.reserve(tets.size());
    for (std::size_t i = 0; i < tets.size(); ++i) {
        // r <= alpha keeps the tet (closed alpha complex). An infinite alpha keeps
        // every tet, including any (non-finite-radius) degenerate one, recovering
        // the full Delaunay region == the convex hull.
        if (radius[i] <= effAlpha) {
            R.keptTets.push_back(tets[i]);
        }
    }

    // ---- 2. Boundary = faces incident to exactly ONE kept tet. Each kept tet
    //         contributes its 4 outward-oriented faces; a face shared by two kept
    //         tets cancels (count 2, interior), a face on the region boundary is
    //         seen once. We keep the outward-oriented triple of the (unique) kept
    //         tet that owns it. -----------------------------------------------
    struct FaceRec {
        int count{0};
        std::array<int,3> oriented{{0,0,0}};
    };
    std::unordered_map<FaceKey, FaceRec, FaceKeyHash> faces;
    faces.reserve(R.keptTets.size() * 4 + 1);

    for (const std::array<int,4>& t : R.keptTets) {
        for (const std::array<int,3>& f : outwardFaces(t)) {
            FaceKey k = faceKey(f[0], f[1], f[2]);
            FaceRec& rec = faces[k];
            ++rec.count;
            if (rec.count == 1) rec.oriented = f;  // remember the first (kept-tet)
                                                   // winding; if a second kept tet
                                                   // shares it the face is interior
                                                   // and is dropped below.
        }
    }

    R.boundary.reserve(faces.size());
    for (const auto& kv : faces) {
        if (kv.second.count == 1) {
            R.boundary.push_back(kv.second.oriented);
        }
    }

    return R;
}

AlphaShape3DResult alphaShape3D(const std::vector<Point3>& pts,
                                double alpha,
                                std::uint64_t seed) {
    Delaunay3DResult del = delaunay3D(pts, seed);
    return alphaShape3DFromDelaunay(del, alpha);
}

bool alphaBoundaryIsClosed(const AlphaShape3DResult& R) {
    if (R.boundary.empty()) return false;

    // Directed-edge bookkeeping: a closed, orientable triangle surface uses every
    // directed edge exactly once and contains the reverse of every directed edge.
    struct EKey {
        int u, v;
        bool operator==(const EKey& o) const { return u == o.u && v == o.v; }
    };
    struct EHash {
        std::size_t operator()(const EKey& k) const {
            std::uint64_t h = static_cast<std::uint32_t>(k.u);
            h = h * 1000003ull + static_cast<std::uint32_t>(k.v);
            h ^= h >> 29;
            return static_cast<std::size_t>(h);
        }
    };
    std::unordered_map<EKey, int, EHash> dir;
    dir.reserve(R.boundary.size() * 3 + 1);

    for (const std::array<int,3>& f : R.boundary) {
        const int e[3][2] = {{f[0], f[1]}, {f[1], f[2]}, {f[2], f[0]}};
        for (const auto& ed : e) {
            EKey k{ed[0], ed[1]};
            if (++dir[k] > 1) return false;  // a directed edge used twice -> not
                                             // orientable / non-manifold
        }
    }
    for (const auto& kv : dir) {
        EKey rev{kv.first.v, kv.first.u};
        if (dir.find(rev) == dir.end()) return false;  // unmatched edge -> open
    }
    return true;
}

double alphaEnclosedVolume(const AlphaShape3DResult& R) {
    const std::vector<Point3>& P = R.points;
    double vol = 0.0;
    for (const std::array<int,3>& f : R.boundary) {
        const Point3& a = P[f[0]];
        const Point3& b = P[f[1]];
        const Point3& c = P[f[2]];
        const Point3 bc = cross(b, c);
        vol += dot(a, bc);
    }
    return vol / 6.0;
}

double alphaKeptTetVolume(const AlphaShape3DResult& R) {
    const std::vector<Point3>& P = R.points;
    double vol = 0.0;
    for (const std::array<int,4>& t : R.keptTets) {
        const Point3& A = P[t[0]];
        const Point3& B = P[t[1]];
        const Point3& C = P[t[2]];
        const Point3& D = P[t[3]];
        // Signed volume of a POSITIVE tet is +|det[A-D, B-D, C-D]|/6.
        const double ax = A.x - D.x, ay = A.y - D.y, az = A.z - D.z;
        const double bx = B.x - D.x, by = B.y - D.y, bz = B.z - D.z;
        const double cx = C.x - D.x, cy = C.y - D.y, cz = C.z - D.z;
        const double det = ax * (by * cz - bz * cy)
                         - ay * (bx * cz - bz * cx)
                         + az * (bx * cy - by * cx);
        vol += det / 6.0;
    }
    return vol;
}

} // namespace geom
} // namespace native
} // namespace forge
