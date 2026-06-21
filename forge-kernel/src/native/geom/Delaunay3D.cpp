// forge/native/geom/Delaunay3D.cpp
//
// Implementation of the in-house 3D Delaunay tetrahedralization declared in
// forge/native/geom/Delaunay3D.hpp. See that header for the algorithm,
// robustness posture, and the TARGETED remainder. Pure C++20 + stdlib only.
//
// Every combinatorial decision is taken from the EXACT predicates orient3d /
// insphere (forge/native/Predicates.hpp); no tolerance is used anywhere.

#include "forge/native/geom/Delaunay3D.hpp"

#include <algorithm>
#include <unordered_map>
#include <cstdint>
#include <cmath>
#include <limits>
#include <bit>

namespace forge {
namespace native {
namespace geom {

namespace {

// A tetrahedron as four indices into a working point array (super vertices use
// the highest four indices). Stored ALWAYS in POSITIVE orientation
// (orient3d(a,b,c,d) > 0). `alive` lets us tombstone instead of erasing.
struct Tet {
    int a, b, c, d;
    bool alive;
};

inline Sign orient(const std::vector<Point3>& P, int a, int b, int c, int d) {
    return orient3d(P[a].x, P[a].y, P[a].z,
                    P[b].x, P[b].y, P[b].z,
                    P[c].x, P[c].y, P[c].z,
                    P[d].x, P[d].y, P[d].z);
}

// Force (a,b,c,d) into POSITIVE orientation. Returns false iff the four points
// are coplanar (orient3d == ZERO) — the caller must never store such a tet.
inline bool makePositive(const std::vector<Point3>& P,
                         int& a, int& b, int& c, int& d) {
    Sign s = orient(P, a, b, c, d);
    if (s == Sign::ZERO) return false;
    if (s == Sign::NEGATIVE) std::swap(c, d);  // swapping two verts flips sign
    return true;
}

// EXACT "is p strictly inside the circumsphere of POSITIVE tet (a,b,c,d)?".
// insphere() requires (a,b,c,d) to have POSITIVE orientation; every stored tet
// satisfies that by construction.
inline bool strictlyInCircumsphere(const std::vector<Point3>& P,
                                   int a, int b, int c, int d, int p) {
    return insphere(P[a].x, P[a].y, P[a].z,
                    P[b].x, P[b].y, P[b].z,
                    P[c].x, P[c].y, P[c].z,
                    P[d].x, P[d].y, P[d].z,
                    P[p].x, P[p].y, P[p].z) == Sign::POSITIVE;
}

// Key for an UNDIRECTED triangular face (the three vertex indices, sorted), so
// that a face shared by two tets collides regardless of its orientation.
struct FaceKey {
    int u, v, w;  // sorted ascending
};
struct FaceKeyHash {
    std::size_t operator()(const FaceKey& k) const {
        std::uint64_t h = static_cast<std::uint64_t>(static_cast<std::uint32_t>(k.u));
        h = h * 0x9E3779B97F4A7C15ull + static_cast<std::uint32_t>(k.v);
        h = h * 0x9E3779B97F4A7C15ull + static_cast<std::uint32_t>(k.w);
        h ^= (h >> 29);
        return static_cast<std::size_t>(h);
    }
};
struct FaceKeyEq {
    bool operator()(const FaceKey& a, const FaceKey& b) const {
        return a.u == b.u && a.v == b.v && a.w == b.w;
    }
};
inline FaceKey faceKey(int x, int y, int z) {
    // sort three ints ascending
    if (x > y) std::swap(x, y);
    if (y > z) std::swap(y, z);
    if (x > y) std::swap(x, y);
    return FaceKey{x, y, z};
}

// The four ORIENTED faces of a POSITIVE tet (a,b,c,d). Each returned triple is
// wound so its outward normal points AWAY from the tet's fourth vertex, i.e. the
// opposite vertex w lies BELOW the face: orient3d(face, w) > 0. These are
// exactly the faces that, when glued to a newly inserted interior point p,
// produce a POSITIVE tet (face, p).
//
// For a POSITIVE tet (a,b,c,d) [orient3d(a,b,c,d) > 0 => d below plane abc]:
//   * face opposite d : (a,b,c)   — d below it          -> orient3d(a,b,c,d) > 0
//   * face opposite c : (a,d,b)   — c below it          -> orient3d(a,d,b,c) > 0
//   * face opposite b : (a,c,d)   — b below it          -> orient3d(a,c,d,b) > 0
//   * face opposite a : (b,d,c)   — a below it          -> orient3d(b,d,c,a) > 0
// These windings are fixed combinatorially from the positive ordering; we also
// re-affirm each with the exact predicate when we build a new tet, so a wrong
// constant could never corrupt the output (it would be caught and flipped).
inline std::array<std::array<int,3>,4> orientedFaces(const Tet& t) {
    return {{
        {{t.a, t.b, t.c}},   // opposite d
        {{t.a, t.d, t.b}},   // opposite c
        {{t.a, t.c, t.d}},   // opposite b
        {{t.b, t.d, t.c}},   // opposite a
    }};
}

// Small deterministic LCG for the randomized insertion order (matches the 2D
// engine's generator so the kernel keeps one shuffling convention).
struct Lcg {
    std::uint64_t s;
    explicit Lcg(std::uint64_t seed) : s(seed ? seed : 0x9E3779B97F4A7C15ull) {}
    std::uint64_t next() {
        s = s * 6364136223846793005ull + 1442695040888963407ull;
        return s;
    }
};

} // namespace

Delaunay3DResult delaunay3D(const std::vector<Point3>& ptsIn, std::uint64_t seed) {
    Delaunay3DResult R;

    // ---- 1. De-duplicate input EXACTLY (a duplicate has no well-defined
    //         circumsphere membership). Keep first-occurrence order. -----------
    {
        struct Key { double x, y, z; };
        struct KeyHash {
            std::size_t operator()(const Key& k) const {
                auto bx = std::bit_cast<std::uint64_t>(k.x);
                auto by = std::bit_cast<std::uint64_t>(k.y);
                auto bz = std::bit_cast<std::uint64_t>(k.z);
                std::uint64_t h = bx * 0x9E3779B97F4A7C15ull;
                h ^= (by + 0x9E3779B97F4A7C15ull + (h << 6) + (h >> 2));
                h ^= (bz + 0x9E3779B97F4A7C15ull + (h << 6) + (h >> 2));
                return static_cast<std::size_t>(h);
            }
        };
        struct KeyEq {
            bool operator()(const Key& a, const Key& b) const {
                return a.x == b.x && a.y == b.y && a.z == b.z;
            }
        };
        std::unordered_map<Key, int, KeyHash, KeyEq> seen;
        seen.reserve(ptsIn.size() * 2 + 1);
        for (int i = 0; i < static_cast<int>(ptsIn.size()); ++i) {
            // normalize -0.0 -> +0.0 so signed zeros de-dup together
            double x = ptsIn[i].x == 0.0 ? 0.0 : ptsIn[i].x;
            double y = ptsIn[i].y == 0.0 ? 0.0 : ptsIn[i].y;
            double z = ptsIn[i].z == 0.0 ? 0.0 : ptsIn[i].z;
            Key k{x, y, z};
            if (seen.find(k) == seen.end()) {
                seen.emplace(k, static_cast<int>(R.points.size()));
                R.points.push_back(Point3{x, y, z});
                R.inputIndex.push_back(i);
            }
        }
    }

    const int n = static_cast<int>(R.points.size());
    if (n < 4) {
        R.ok = false;
        R.reason = "fewer than 4 unique points";
        R.tetrahedra.clear();
        R.hullFaces.clear();
        return R;
    }

    // ---- All-coplanar (and all-collinear) check via the EXACT predicate. ------
    //      A 3D tetrahedralization exists iff the cloud has AFFINE DIMENSION 3,
    //      i.e. there exist four points with orient3d != 0. We certify this
    //      exactly, in O(n): fix the first point A=0, find a second point B that
    //      differs from A (always exists, points are distinct), then find a third
    //      point C with A,B,C non-collinear, then a fourth D off the plane ABC.
    //      Each search scans the remaining points once; if any stage fails the
    //      whole cloud collapses to a lower-dimensional flat and we report it.
    {
        const int A = 0;
        // Find B != A. (All de-duped points are distinct, so B = 1 works, but we
        // keep the explicit search so the dimension argument is self-evident.)
        int B = -1;
        for (int j = 1; j < n; ++j) {
            const Point3& a = R.points[A];
            const Point3& b = R.points[j];
            if (a.x != b.x || a.y != b.y || a.z != b.z) { B = j; break; }
        }
        // Find C with (A,B,C) NON-COLLINEAR. Exact collinearity test without a
        // new predicate: (A,B,C) are collinear iff the cross product
        // (B-A) x (C-A) is the zero vector. That cross product's components are
        // exactly 2x2 determinants; we test each component's sign with orient2d
        // (an EXACT kernel predicate) on the three coordinate-plane projections:
        //   z-component: orient2d(Ax,Ay, Bx,By, Cx,Cy)
        //   y-component: orient2d(Az,Ax, Bz,Bx, Cz,Cx)
        //   x-component: orient2d(Ay,Az, By,Bz, Cy,Cz)
        // The triple is non-collinear iff ANY of the three is nonzero.
        int C = -1;
        if (B >= 0) {
            const Point3& a = R.points[A];
            const Point3& b = R.points[B];
            for (int k = 0; k < n; ++k) {
                if (k == A || k == B) continue;
                const Point3& c = R.points[k];
                bool collinear =
                    orient2d(a.x, a.y, b.x, b.y, c.x, c.y) == Sign::ZERO &&
                    orient2d(a.z, a.x, b.z, b.x, c.z, c.x) == Sign::ZERO &&
                    orient2d(a.y, a.z, b.y, b.z, c.y, c.z) == Sign::ZERO;
                if (!collinear) { C = k; break; }
            }
        }
        // Find D off the plane (A,B,C): orient3d(A,B,C,D) != 0.
        bool foundNonCoplanar = false;
        if (C >= 0) {
            for (int d = 0; d < n; ++d) {
                if (d == A || d == B || d == C) continue;
                if (orient(R.points, A, B, C, d) != Sign::ZERO) {
                    foundNonCoplanar = true;
                    break;
                }
            }
        }
        if (!foundNonCoplanar) {
            R.ok = false;
            R.reason = (C < 0) ? "all unique points are collinear"
                               : "all unique points are coplanar";
            R.tetrahedra.clear();
            R.hullFaces.clear();
            return R;
        }
    }

    // ---- 2. Build the working point array: input points + 4 super vertices. --
    double minx = R.points[0].x, maxx = R.points[0].x;
    double miny = R.points[0].y, maxy = R.points[0].y;
    double minz = R.points[0].z, maxz = R.points[0].z;
    for (int i = 1; i < n; ++i) {
        minx = std::min(minx, R.points[i].x);  maxx = std::max(maxx, R.points[i].x);
        miny = std::min(miny, R.points[i].y);  maxy = std::max(maxy, R.points[i].y);
        minz = std::min(minz, R.points[i].z);  maxz = std::max(maxz, R.points[i].z);
    }
    double dx = maxx - minx, dy = maxy - miny, dz = maxz - minz;
    double dmax = std::max(dx, std::max(dy, dz));
    if (dmax <= 0.0) dmax = 1.0;  // degenerate guard (unreached after checks)
    double cx = 0.5 * (minx + maxx);
    double cy = 0.5 * (miny + maxy);
    double cz = 0.5 * (minz + maxz);
    // A super-tetrahedron whose interior strictly contains the bounding box with
    // a wide margin. Only has to be "large enough"; the gate verifies the result
    // tiles the hull (no super vertex survives, tet volumes == hull volume).
    const double M = 1000.0 * dmax;
    std::vector<Point3> P = R.points;  // working copy; super verts appended
    const int s0 = n + 0, s1 = n + 1, s2 = n + 2, s3 = n + 3;
    // A large regular-ish tetra centered at (cx,cy,cz): apex high in +z, base
    // triangle low in -z spread wide in x,y. These coordinates are deliberately
    // far apart so every input point sits strictly inside.
    P.push_back(Point3{cx,             cy,             cz + 3.0 * M});  // s0 apex
    P.push_back(Point3{cx - 3.0 * M,   cy - 2.0 * M,   cz - 2.0 * M}); // s1
    P.push_back(Point3{cx + 3.0 * M,   cy - 2.0 * M,   cz - 2.0 * M}); // s2
    P.push_back(Point3{cx,             cy + 4.0 * M,   cz - 2.0 * M}); // s3

    std::vector<Tet> tets;
    tets.reserve(static_cast<std::size_t>(6 * n) + 16);
    {
        int a = s0, b = s1, c = s2, d = s3;
        // The super-tet must be non-degenerate; force positive orientation.
        if (!makePositive(P, a, b, c, d)) {
            R.ok = false;
            R.reason = "internal: degenerate super-tetrahedron";
            return R;  // unreachable for the chosen coordinates
        }
        tets.push_back(Tet{a, b, c, d, true});
    }

    // ---- 3. Randomized insertion order (deterministic). --------------------
    std::vector<int> order(n);
    for (int i = 0; i < n; ++i) order[i] = i;
    {
        Lcg rng(seed);
        for (int i = n - 1; i > 0; --i) {
            int j = static_cast<int>(rng.next() % static_cast<std::uint64_t>(i + 1));
            std::swap(order[i], order[j]);
        }
    }

    // Reusable scratch.
    std::vector<int> bad;  // indices into tets
    // For each undirected cavity face: count of incident bad tets, and (for the
    // boundary faces, count==1) the ORIENTED outward triple to glue to p.
    std::unordered_map<FaceKey, int, FaceKeyHash, FaceKeyEq> faceCount;
    std::unordered_map<FaceKey, std::array<int,3>, FaceKeyHash, FaceKeyEq> faceTriple;

    // ---- 4. Bowyer-Watson insertion. ---------------------------------------
    for (int oi = 0; oi < n; ++oi) {
        const int p = order[oi];

        // (a) Collect bad tetrahedra (p strictly inside their circumsphere).
        bad.clear();
        for (int t = 0; t < static_cast<int>(tets.size()); ++t) {
            if (!tets[t].alive) continue;
            if (strictlyInCircumsphere(P, tets[t].a, tets[t].b, tets[t].c,
                                       tets[t].d, p))
                bad.push_back(t);
        }
        // With an EXACT insphere and a point strictly inside the super-tet, `bad`
        // is non-empty and forms a single star-shaped cavity. (If a point sat
        // exactly ON every relevant sphere, `bad` could be empty; then the point
        // already lies on existing circumspheres so the mesh stays Delaunay and
        // we skip it — such a point is cospherical/on-face, not a hull omission.)
        if (bad.empty()) continue;

        // (b) Cavity boundary: outward faces incident to exactly one bad tet.
        //     Tombstone bad tets as we accumulate their oriented faces.
        faceCount.clear();
        faceTriple.clear();
        for (int t : bad) {
            const Tet& T = tets[t];
            for (const auto& f : orientedFaces(T)) {
                FaceKey k = faceKey(f[0], f[1], f[2]);
                auto it = faceCount.find(k);
                if (it == faceCount.end()) {
                    faceCount.emplace(k, 1);
                    faceTriple.emplace(k, f);   // keep this outward orientation
                } else {
                    ++it->second;               // shared by 2 bad tets -> interior
                }
            }
            tets[t].alive = false;
        }

        // (c) Re-tetrahedralize: glue p to every boundary face (count == 1),
        //     wound POSITIVE via the exact predicate.
        for (auto& kv : faceCount) {
            if (kv.second != 1) continue;       // interior cavity face -> drop
            const std::array<int,3>& f = faceTriple[kv.first];
            int a = f[0], b = f[1], c = f[2], d = p;
            // The outward face (a,b,c) has the bad tet's apex below it; gluing p
            // (which is inside the cavity, i.e. above this face) yields a tet that
            // we re-affirm POSITIVE. A coplanar (p on the face's plane) tet is
            // exactly degenerate and is skipped — this cannot drop volume because
            // a star-shaped cavity around an interior p never has p on a boundary
            // face's plane unless p is exactly on that supporting plane, in which
            // case the adjacent boundary faces already cover the cell.
            if (!makePositive(P, a, b, c, d)) continue;  // degenerate -> skip
            tets.push_back(Tet{a, b, c, d, true});
        }
    }

    // ---- 5. Drop tets touching a super vertex; emit the finite tets. --------
    R.tetrahedra.clear();
    R.tetrahedra.reserve(tets.size());
    for (const Tet& T : tets) {
        if (!T.alive) continue;
        if (T.a >= n || T.b >= n || T.c >= n || T.d >= n) continue;  // super vtx
        int a = T.a, b = T.b, c = T.c, d = T.d;
        // Re-affirm POSITIVE orientation (the contract) with the exact predicate.
        if (!makePositive(P, a, b, c, d)) continue;  // never for a finite tet
        R.tetrahedra.push_back(std::array<int,4>{a, b, c, d});
    }

    R.ok = !R.tetrahedra.empty();
    if (!R.ok) {
        R.reason = "no finite tetrahedra produced";
        R.hullFaces.clear();
        return R;
    }

    // ---- 6. Convex-hull faces = boundary faces of the finite tet mesh -------
    //         (triangular faces incident to exactly ONE finite tet). Each is
    //         emitted in its outward orientation (the orientation it carried in
    //         the single tet it belongs to, which already points away from that
    //         tet's apex => outward of the whole convex mesh).
    {
        // Map: undirected face -> (count, outward oriented triple).
        std::unordered_map<FaceKey, int, FaceKeyHash, FaceKeyEq> bcount;
        std::unordered_map<FaceKey, std::array<int,3>, FaceKeyHash, FaceKeyEq> btri;
        bcount.reserve(R.tetrahedra.size() * 4 + 1);
        for (const auto& q : R.tetrahedra) {
            Tet T{q[0], q[1], q[2], q[3], true};
            for (const auto& f : orientedFaces(T)) {
                FaceKey k = faceKey(f[0], f[1], f[2]);
                auto it = bcount.find(k);
                if (it == bcount.end()) {
                    bcount.emplace(k, 1);
                    btri.emplace(k, f);
                } else {
                    ++it->second;
                }
            }
        }
        R.hullFaces.clear();
        for (auto& kv : bcount) {
            if (kv.second != 1) continue;   // interior face shared by two tets
            R.hullFaces.push_back(btri[kv.first]);
        }
    }

    return R;
}

// ===========================================================================
// Verification helpers.
// ===========================================================================

bool isDelaunay3D(const Delaunay3DResult& result) {
    const auto& P = result.points;
    const int n = static_cast<int>(P.size());
    for (const auto& t : result.tetrahedra) {
        int a = t[0], b = t[1], c = t[2], d = t[3];
        // Must be POSITIVE for insphere() to have its documented meaning.
        if (orient3d(P[a].x,P[a].y,P[a].z, P[b].x,P[b].y,P[b].z,
                     P[c].x,P[c].y,P[c].z, P[d].x,P[d].y,P[d].z) != Sign::POSITIVE)
            return false;
        for (int p = 0; p < n; ++p) {
            if (p == a || p == b || p == c || p == d) continue;
            if (insphere(P[a].x,P[a].y,P[a].z, P[b].x,P[b].y,P[b].z,
                         P[c].x,P[c].y,P[c].z, P[d].x,P[d].y,P[d].z,
                         P[p].x,P[p].y,P[p].z) == Sign::POSITIVE)
                return false;  // a point strictly inside a circumsphere
        }
    }
    return true;
}

bool isValidTetrahedralization(const Delaunay3DResult& result) {
    const auto& P = result.points;
    // All tets POSITIVE-oriented (no inversion).
    for (const auto& t : result.tetrahedra) {
        int a = t[0], b = t[1], c = t[2], d = t[3];
        if (orient3d(P[a].x,P[a].y,P[a].z, P[b].x,P[b].y,P[b].z,
                     P[c].x,P[c].y,P[c].z, P[d].x,P[d].y,P[d].z) != Sign::POSITIVE)
            return false;
    }
    // Face-manifoldness: every undirected triangular face is shared by exactly 1
    // (boundary) or 2 (interior) tetrahedra. Overlapping tets would force a face
    // to be used 3+ times. We also check each DIRECTED (oriented-outward) face
    // appears at most once: two POSITIVE tets sharing a face must traverse it in
    // OPPOSITE outward directions, so an outward face repeated identically would
    // signal an overlap / duplicate cell.
    std::unordered_map<FaceKey, int, FaceKeyHash, FaceKeyEq> undirected;
    // Directed key folds vertex order INTO the hash (kept ordered, not sorted).
    auto dirHash = [](int x, int y, int z) {
        std::uint64_t h = static_cast<std::uint32_t>(x);
        h = h * 1000003ull + static_cast<std::uint32_t>(y);
        h = h * 1000003ull + static_cast<std::uint32_t>(z);
        return h;
    };
    std::unordered_map<std::uint64_t, int> directed;
    for (const auto& t : result.tetrahedra) {
        Tet T{t[0], t[1], t[2], t[3], true};
        for (const auto& f : orientedFaces(T)) {
            if (++undirected[faceKey(f[0], f[1], f[2])] > 2) return false;
            if (++directed[dirHash(f[0], f[1], f[2])] > 1) return false; // overlap
        }
    }
    return true;
}

double totalTetVolume(const Delaunay3DResult& result) {
    const auto& P = result.points;
    double vol = 0.0;
    for (const auto& t : result.tetrahedra) {
        const Point3& A = P[t[0]];
        const Point3& B = P[t[1]];
        const Point3& C = P[t[2]];
        const Point3& D = P[t[3]];
        // Signed volume of a POSITIVE tet (a,b,c,d) is + |det[a-d,b-d,c-d]| / 6.
        double ax = A.x - D.x, ay = A.y - D.y, az = A.z - D.z;
        double bx = B.x - D.x, by = B.y - D.y, bz = B.z - D.z;
        double cx = C.x - D.x, cy = C.y - D.y, cz = C.z - D.z;
        double det = ax * (by * cz - bz * cy)
                   - ay * (bx * cz - bz * cx)
                   + az * (bx * cy - by * cx);
        vol += det / 6.0;  // positive because tets are POSITIVE-oriented
    }
    return vol;
}

double hullVolume(const Delaunay3DResult& result) {
    const auto& P = result.points;
    // Divergence theorem: V = (1/6) * sum over outward CCW faces of
    // dot(a, cross(b, c)).
    double vol = 0.0;
    for (const auto& f : result.hullFaces) {
        const Point3& a = P[f[0]];
        const Point3& b = P[f[1]];
        const Point3& c = P[f[2]];
        double cx = b.y * c.z - b.z * c.y;
        double cy = b.z * c.x - b.x * c.z;
        double cz = b.x * c.y - b.y * c.x;
        vol += (a.x * cx + a.y * cy + a.z * cz);
    }
    return vol / 6.0;
}

} // namespace geom
} // namespace native
} // namespace forge
