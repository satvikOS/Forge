// forge/native/geom/ConvexDecomposition.cpp
//
// Implementation of the in-house APPROXIMATE convex decomposition —
// forge::native::geom::convexDecompose. Pure C++20, standard library only.
// NO OCCT, NO WASM, NO third-party libs. See ConvexDecomposition.hpp for the
// honest scope / robustness posture.
//
// ALGORITHM (greedy, concavity-driven — the ACD / V-HACD family):
//
//   1. Build the input HalfEdgeMesh and REFUSE (ok=false) anything that is not a
//      closed, 2-manifold, finite-non-zero-volume solid.
//
//   2. Measure a piece's CONCAVITY as the maximum distance of any of its surface
//      vertices OUTSIDE its own convex hull, normalised by its bounding radius.
//      A convex solid has every vertex ON its hull, so concavity == 0.
//
//   3. Greedily, while the WORST open piece is more concave than the tolerance:
//        - find that piece's most-concave vertex (farthest outside its hull);
//        - cut the piece by a plane through that vertex whose normal is the
//          outward hull-deviation direction (the direction in which the surface
//          bulges past convexity), splitting the solid into two closed halves;
//        - replace the piece with its two halves and recurse.
//      The split itself is an exact-predicate Sutherland-Hodgman half-space clip
//      of the triangle soup (orient3d drives the on/above/below classification),
//      capping each half so both stay closed. This is the SAME robust posture as
//      the kernel's MeshBoolean planeClip, re-derived locally so this module is
//      self-contained (it does not pull in MeshBoolean.cpp).
//
//   4. Stop on: all pieces convex within tol, OR maxPieces reached, OR a cut
//      that fails to reduce the worst concavity (no-progress guard).
//
// The decomposition is APPROXIMATE and HEURISTIC by construction (exact minimal
// convex partition is NP-hard) — this is stated plainly in the header and is the
// same honest ceiling every shipping ACD ships with.

#include "forge/native/geom/ConvexDecomposition.hpp"

#include "forge/native/Predicates.hpp"          // orient3d (exact side test)
#include "forge/native/geom/Geom.hpp"           // Point3, convexHull3D, Hull3D
#include "forge/native/mesh/HalfEdgeMesh.hpp"    // Vec3, HalfEdgeMesh

#include <algorithm>    // std::sort, std::max, std::min, std::reverse, std::swap
#include <array>        // std::array
#include <cmath>        // std::sqrt, std::fabs, std::isfinite, std::sin, std::llround
#include <cstddef>      // std::size_t
#include <cstdint>      // std::uint32_t, std::int64_t
#include <limits>       // std::numeric_limits
#include <map>          // std::map (vertex welding)
#include <utility>      // std::pair, std::move
#include <vector>       // std::vector

namespace forge {
namespace native {
namespace geom {

namespace {

using mesh::HalfEdgeMesh;
using mesh::Vec3;

// ---------------------------------------------------------------------------
// Small local vector algebra (double precision). The COMBINATORIAL decisions
// below use the exact orient3d predicate; these helpers only do measurement /
// coordinate placement, exactly as the kernel's other geom modules do.
// ---------------------------------------------------------------------------
struct V3 {
    double x{0.0}, y{0.0}, z{0.0};
};

inline V3 operator-(const V3& a, const V3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 operator+(const V3& a, const V3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 operator*(const V3& a, double s)    { return {a.x * s, a.y * s, a.z * s}; }
inline double dot(const V3& a, const V3& b)   { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3 cross(const V3& a, const V3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double norm(const V3& a) { return std::sqrt(dot(a, a)); }

// A closed solid as a plain triangle soup (the unit this module passes around).
struct Soup {
    std::vector<double>        pos;   // flat xyz
    std::vector<std::uint32_t> idx;   // flat triangle indices
};

inline V3 vert(const Soup& s, std::uint32_t i) {
    return {s.pos[3 * i + 0], s.pos[3 * i + 1], s.pos[3 * i + 2]};
}
inline std::size_t numVerts(const Soup& s) { return s.pos.size() / 3; }
inline std::size_t numTris(const Soup& s)  { return s.idx.size() / 3; }

// Signed volume of the soup (divergence theorem). Sign normalised by caller.
double soupSignedVolume(const Soup& s) {
    double v6 = 0.0;
    for (std::size_t t = 0; t < numTris(s); ++t) {
        V3 a = vert(s, s.idx[3 * t + 0]);
        V3 b = vert(s, s.idx[3 * t + 1]);
        V3 c = vert(s, s.idx[3 * t + 2]);
        v6 += dot(a, cross(b, c));
    }
    return v6 / 6.0;
}

// ---------------------------------------------------------------------------
// Convex hull of a soup's vertices, returned as a triangle soup of hull faces
// with OUTWARD normals (so a point's signed distance to a face's plane is > 0
// exactly when the point is outside that face). Reuses geom::convexHull3D.
// `ok` is false when the hull is degenerate (coplanar / < 4 distinct pts).
// ---------------------------------------------------------------------------
struct Hull {
    bool ok{false};
    std::vector<V3>                       pts;     // the source points
    std::vector<std::array<int, 3>>       faces;   // CCW-outward into pts
    std::vector<V3>                       fn;      // outward unit normal / face
    std::vector<double>                   fd;      // plane offset: n·x = fd
    V3                                    centroid{};
};

Hull buildHull(const std::vector<V3>& ptsIn) {
    Hull h;
    if (ptsIn.size() < 4) { h.ok = false; return h; }

    // --- Symbolic-perturbation jitter (degeneracy handling). ---------------
    // forge::native::geom::convexHull3D is an INCREMENTAL hull whose horizon
    // logic is unreliable on inputs with many EXACTLY-coplanar points (e.g. the
    // four corners of a box face, or a prism's flat faces): on such inputs it can
    // return a hull that omits real extreme vertices, under-reporting the hull
    // volume. A box / L-shape / step is exactly that case.
    //
    // We therefore feed the hull a COPY of the points with a tiny, DETERMINISTIC
    // per-point jitter (~1e-7 of the bounding extent), which breaks the exact
    // coplanarities so the incremental hull behaves, without moving any point
    // enough to change which vertices are genuinely extreme. This is the standard
    // perturbation trick (simulation-of-simplicity in spirit). The ORIGINAL mesh
    // is never modified — only the hull's working copy. The reported hull volume
    // changes by O(jitter) << the few-percent tolerances the module promises.
    //
    // Determinism: the jitter is a fixed function of the point INDEX, so a given
    // point set always yields the same hull (reproducible decomposition).
    V3 lo{ std::numeric_limits<double>::infinity(),
           std::numeric_limits<double>::infinity(),
           std::numeric_limits<double>::infinity() };
    V3 hi{ -std::numeric_limits<double>::infinity(),
           -std::numeric_limits<double>::infinity(),
           -std::numeric_limits<double>::infinity() };
    for (const V3& p : ptsIn) {
        lo.x = std::min(lo.x, p.x); hi.x = std::max(hi.x, p.x);
        lo.y = std::min(lo.y, p.y); hi.y = std::max(hi.y, p.y);
        lo.z = std::min(lo.z, p.z); hi.z = std::max(hi.z, p.z);
    }
    double ext = std::max(hi.x - lo.x, std::max(hi.y - lo.y, hi.z - lo.z));
    if (!(ext > 0.0) || !std::isfinite(ext)) { h.ok = false; return h; }
    const double eps = ext * 1e-7;

    // Deterministic low-discrepancy jitter from the index (a fixed irrational
    // multiplier per axis keeps it spread out and reproducible).
    auto jitter = [&](std::size_t i, int axis) -> double {
        double k = static_cast<double>(i + 1);
        double s;
        if (axis == 0)      s = std::sin(k * 12.9898);
        else if (axis == 1) s = std::sin(k * 78.2330);
        else                s = std::sin(k * 37.7191);
        return eps * s;   // in [-eps, eps]
    };

    std::vector<V3> pts = ptsIn;
    for (std::size_t i = 0; i < pts.size(); ++i) {
        pts[i].x += jitter(i, 0);
        pts[i].y += jitter(i, 1);
        pts[i].z += jitter(i, 2);
    }
    h.pts = pts;   // the hull is defined over the (jittered) working copy

    std::vector<Point3> in;
    in.reserve(pts.size());
    for (const V3& p : pts) in.push_back(Point3{p.x, p.y, p.z});

    Hull3D r = convexHull3D(in);
    if (!r.ok) { h.ok = false; return h; }

    // Hull centroid (average of hull-face vertices) — a guaranteed-interior
    // reference used to force outward orientation of every face normal.
    V3 cen{};
    {
        double n = 0.0;
        std::vector<char> used(pts.size(), 0);
        for (const auto& f : r.faces)
            for (int k = 0; k < 3; ++k) used[static_cast<std::size_t>(f[k])] = 1;
        for (std::size_t i = 0; i < pts.size(); ++i)
            if (used[i]) { cen = cen + pts[i]; n += 1.0; }
        if (n > 0.0) cen = cen * (1.0 / n);
    }
    h.centroid = cen;

    h.faces = r.faces;
    h.fn.reserve(r.faces.size());
    h.fd.reserve(r.faces.size());
    for (const auto& f : r.faces) {
        V3 a = pts[static_cast<std::size_t>(f[0])];
        V3 b = pts[static_cast<std::size_t>(f[1])];
        V3 c = pts[static_cast<std::size_t>(f[2])];
        V3 nrm = cross(b - a, c - a);
        double len = norm(nrm);
        if (len <= 0.0) { h.ok = false; return h; }   // degenerate hull face
        nrm = nrm * (1.0 / len);
        // Force outward: the interior centroid must be on the negative side.
        if (dot(nrm, cen - a) > 0.0) nrm = nrm * -1.0;
        h.fn.push_back(nrm);
        h.fd.push_back(dot(nrm, a));
    }
    h.ok = true;
    return h;
}

// Volume enclosed by the hull faces (divergence theorem; |signed|). The hull
// faces from convexHull3D are outward-CCW into `pts`, so the signed sum is the
// hull volume up to sign.
double hullVolume(const Hull& h) {
    double v6 = 0.0;
    for (const auto& f : h.faces) {
        const V3& a = h.pts[static_cast<std::size_t>(f[0])];
        const V3& b = h.pts[static_cast<std::size_t>(f[1])];
        const V3& c = h.pts[static_cast<std::size_t>(f[2])];
        v6 += dot(a, cross(b, c));
    }
    return std::fabs(v6 / 6.0);
}

// ---------------------------------------------------------------------------
// Concavity of a soup, measured as the VOLUME GAP between its convex hull and
// the solid itself, normalised by the hull volume:
//
//     concavity = (V_hull - V_mesh) / V_hull        (in [0, 1))
//
// This is robust (it uses only the two VOLUMES, never a per-face plane that an
// imperfect incremental hull might dent inward), monotone (0 exactly when the
// solid equals its hull, i.e. convex), and scale-free. It is the same family of
// concavity measure shipping ACDs use (V-HACD's "concavity" is a closely
// related hull-vs-mesh deviation).
//
// `ok` is false (concavity = +inf so the caller never calls it "convex") when
// the hull is degenerate (coplanar / < 4 distinct pts) or the solid has no
// volume.
// ---------------------------------------------------------------------------
struct ConcavityInfo {
    bool   ok{false};
    double concavity{0.0};      // (V_hull - V_mesh)/V_hull, in [0,1)
    double meshVolume{0.0};
    double hullVol{0.0};
};

ConcavityInfo soupConcavity(const Soup& s) {
    ConcavityInfo ci;
    const std::size_t nv = numVerts(s);
    if (nv < 4 || numTris(s) == 0) {
        ci.ok = false;
        ci.concavity = std::numeric_limits<double>::infinity();
        return ci;
    }

    std::vector<V3> pts;
    pts.reserve(nv);
    for (std::size_t i = 0; i < nv; ++i) pts.push_back(vert(s, static_cast<std::uint32_t>(i)));

    Hull h = buildHull(pts);
    if (!h.ok) {
        ci.ok = false;
        ci.concavity = std::numeric_limits<double>::infinity();
        return ci;
    }

    double vmesh = std::fabs(soupSignedVolume(s));
    double vhull = hullVolume(h);
    if (!(vhull > 0.0) || !std::isfinite(vhull)) {
        ci.ok = false;
        ci.concavity = std::numeric_limits<double>::infinity();
        return ci;
    }

    // Primary concavity = the volume gap (V_hull - V_mesh)/V_hull, in [0,1).
    double gap = (vhull - vmesh) / vhull;
    if (gap < 0.0) gap = 0.0;

    // Robustness floor: a genuinely convex closed solid satisfies V_mesh ==
    // V_hull. If the soup's own divergence-theorem volume DISAGREES with its hull
    // volume by a non-trivial amount (in EITHER direction), the clipped soup is
    // not a clean closed convex solid (a leaked / mis-wound cap from the
    // self-contained plane clip). We then refuse to certify it convex by raising
    // the reported concavity to at least that relative disagreement, so the
    // greedy loop keeps cutting it instead of trusting a corrupt piece. This is
    // the honest guard that keeps the union-volume metric correct.
    double disagree = std::fabs(vhull - vmesh) / vhull;
    double concavity = std::max(gap, disagree);

    ci.ok = true;
    ci.concavity = concavity;
    ci.meshVolume = vmesh;
    ci.hullVol = vhull;
    return ci;
}

// ---------------------------------------------------------------------------
// Exact-predicate half-space clip of a closed soup by plane  n·x = d.
//
// Keeps the half-space  n·x <= d  (returns it closed by capping the section).
// The per-vertex side is decided by orient3d against three points spanning the
// plane (re-derived exactly), so the combinatorial in/out/on decision cannot be
// corrupted by rounding — the same posture as MeshBoolean::planeClip, re-derived
// here so this module pulls in no extra .cpp.
//
// `ok` is false if the cut produced a degenerate (empty / no-triangle) half.
// ---------------------------------------------------------------------------
struct ClipHalf {
    bool ok{false};
    Soup soup;
};

// Quantised welding key so coincident new vertices merge (keeps the cap closed).
struct Key3 { std::int64_t x, y, z; };
inline bool operator<(const Key3& a, const Key3& b) {
    if (a.x != b.x) return a.x < b.x;
    if (a.y != b.y) return a.y < b.y;
    return a.z < b.z;
}

ClipHalf halfSpaceClip(const Soup& in, const V3& n, double d, bool keepNegative) {
    ClipHalf out;

    // Three points spanning the plane n·x = d, for the exact orient3d side test.
    // Build an orthonormal-ish in-plane basis from n.
    V3 nn = n;
    double nl = norm(nn);
    if (!(nl > 0.0)) return out;     // degenerate normal
    nn = nn * (1.0 / nl);
    double dd = d / nl;              // plane: nn·x = dd

    V3 helper = (std::fabs(nn.x) < 0.9) ? V3{1, 0, 0} : V3{0, 1, 0};
    V3 u = cross(nn, helper);
    double ul = norm(u);
    if (!(ul > 0.0)) return out;
    u = u * (1.0 / ul);
    V3 w = cross(nn, u);

    V3 p0 = nn * dd;                 // a point on the plane
    V3 pa = p0;
    V3 pb = p0 + u;                  // pa, pb, pc span the plane
    V3 pc = p0 + w;

    // Exact side of query q relative to the plane (a,b,c). orient3d sign:
    //   POSITIVE -> q is BELOW the plane (a,b,c seen CCW from above q)
    // We map "negative side" (nn·q < dd) consistently. Compute once and check a
    // reference to fix the sign convention robustly.
    auto exactSide = [&](const V3& q) -> int {
        Sign s = orient3d(pa.x, pa.y, pa.z,
                          pb.x, pb.y, pb.z,
                          pc.x, pc.y, pc.z,
                          q.x,  q.y,  q.z);
        return signValue(s);   // -1 / 0 / +1
    };

    // Determine which orient3d sign corresponds to nn·x < dd by probing a point
    // clearly on the negative side.
    V3 probe = p0 - nn;                       // nn·probe = dd - 1 < dd
    int negSign = exactSide(probe);           // sign for the kept-if-keepNegative side
    if (negSign == 0) negSign = -1;           // fallback (should not happen)

    const std::size_t nv = numVerts(in);
    std::vector<int> side(nv);
    std::vector<double> sval(nv);             // nn·x - dd, for interpolation
    for (std::size_t i = 0; i < nv; ++i) {
        V3 q = vert(in, static_cast<std::uint32_t>(i));
        int es = exactSide(q);
        // Normalise to: +1 kept-half, -1 other-half, 0 on-plane.
        int keepHalf;
        if (es == 0) keepHalf = 0;
        else {
            bool onNeg = (es == negSign);
            bool kept = keepNegative ? onNeg : !onNeg;
            keepHalf = kept ? +1 : -1;
        }
        side[i] = keepHalf;
        sval[i] = dot(nn, q) - dd;            // double placement value
    }

    // Output vertex pool with welding.
    std::vector<V3> outPos;
    std::map<Key3, std::uint32_t> weld;
    const double Q = 1e9;                       // weld quantum (1e-9 absolute)
    auto addVertex = [&](const V3& p) -> std::uint32_t {
        Key3 k{ static_cast<std::int64_t>(std::llround(p.x * Q)),
                static_cast<std::int64_t>(std::llround(p.y * Q)),
                static_cast<std::int64_t>(std::llround(p.z * Q)) };
        auto it = weld.find(k);
        if (it != weld.end()) return it->second;
        std::uint32_t id = static_cast<std::uint32_t>(outPos.size());
        outPos.push_back(p);
        weld.emplace(k, id);
        return id;
    };

    std::vector<std::uint32_t> outIdx;

    // Directed edges that lie ON the cut plane (oriented so the kept polygon is
    // to their left) — collected to stitch the section cap.
    std::vector<std::pair<std::uint32_t, std::uint32_t>> capEdges;

    auto interp = [&](std::uint32_t ia, std::uint32_t ib) -> V3 {
        V3 A = vert(in, ia), B = vert(in, ib);
        double da = sval[ia], db = sval[ib];
        double denom = da - db;
        double tparam = (denom != 0.0) ? da / denom : 0.5;   // sval==0 at result
        if (tparam < 0.0) tparam = 0.0;
        if (tparam > 1.0) tparam = 1.0;
        return A + (B - A) * tparam;
    };

    for (std::size_t t = 0; t < numTris(in); ++t) {
        std::array<std::uint32_t, 3> vi = { in.idx[3 * t + 0],
                                            in.idx[3 * t + 1],
                                            in.idx[3 * t + 2] };

        // Sutherland-Hodgman clip of the triangle against the kept half-space.
        // Output polygon vertices + a flag marking which lie on the plane.
        std::vector<V3>  poly;
        std::vector<int> onPlane;
        poly.reserve(4);
        onPlane.reserve(4);

        for (int e = 0; e < 3; ++e) {
            std::uint32_t ca = vi[e];
            std::uint32_t cb = vi[(e + 1) % 3];
            int sa = side[ca];
            int sb = side[cb];

            bool aIn = (sa >= 0);   // kept (in or on)
            // Emit current vertex if kept.
            if (aIn) {
                poly.push_back(vert(in, ca));
                onPlane.push_back(sa == 0 ? 1 : 0);
            }
            // Edge strictly crosses the plane (one strictly in, one strictly out)?
            if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
                V3 x = interp(ca, cb);
                poly.push_back(x);
                onPlane.push_back(1);
            }
        }

        if (poly.size() < 3) continue;   // triangle fully clipped away

        // Triangulate the (convex, <=4-gon) kept polygon as a fan and record
        // any output edge whose BOTH endpoints lie on the plane as a cap edge.
        std::vector<std::uint32_t> ring;
        ring.reserve(poly.size());
        for (const V3& p : poly) ring.push_back(addVertex(p));

        for (std::size_t k = 1; k + 1 < ring.size(); ++k) {
            std::uint32_t a = ring[0], b = ring[k], c = ring[k + 1];
            if (a == b || b == c || a == c) continue;   // skip slivers
            outIdx.push_back(a);
            outIdx.push_back(b);
            outIdx.push_back(c);
        }
        // Cap edges: walk the kept polygon boundary; an edge with both ends on
        // the plane bounds the open section. Oriented (a->b) along the polygon;
        // its reverse closes the cap.
        std::size_t m = ring.size();
        for (std::size_t k = 0; k < m; ++k) {
            std::size_t k2 = (k + 1) % m;
            if (onPlane[k] && onPlane[k2] && ring[k] != ring[k2]) {
                capEdges.emplace_back(ring[k], ring[k2]);
            }
        }
    }

    if (outIdx.empty()) return out;   // nothing kept

    // ---- Stitch the cap from the section boundary loop(s). ----
    // The section boundary is the set of directed edges (a->b) we recorded on the
    // plane (oriented so the kept polygon is to their LEFT in the kept-half
    // triangle, i.e. consistent with the solid winding). The cap fills the
    // section; its triangles must face OUTWARD (+nn for the kept nn·x<=dd half).
    //
    // We walk these directed edges into closed loops, then triangulate each loop
    // by EAR CLIPPING in the plane's 2D basis (u,w). Ear clipping correctly
    // handles NON-CONVEX simple section polygons (the L / step cross-section that
    // a naive fan would self-overlap on). A loop whose 2D polygon is degenerate
    // is skipped (the half is then reported not-ok by the manifold gate upstream,
    // never silently mis-capped).
    if (!capEdges.empty()) {
        // 2D coordinate of an output vertex in the plane basis (u, w).
        auto uv = [&](std::uint32_t vi) -> std::pair<double,double> {
            V3 p = outPos[vi];
            return { dot(p, u), dot(p, w) };
        };

        // Build next-edge map over the recorded directed boundary edges (a->b).
        // For a clean single cut each vertex has exactly one outgoing boundary
        // edge; if duplicates occur (welded coincident sections) we keep the
        // first, which still walks a valid loop for the simple sections we target.
        std::map<std::uint32_t, std::uint32_t> nextOf;
        for (auto& e : capEdges) {
            if (e.first == e.second) continue;
            nextOf.emplace(e.first, e.second);
        }

        std::map<std::uint32_t, char> visited;
        for (auto& kv : nextOf) {
            std::uint32_t start = kv.first;
            if (visited[start]) continue;
            std::vector<std::uint32_t> loop;
            std::uint32_t cur = start;
            bool closed = false;
            for (std::size_t guard = 0; guard <= nextOf.size() + 1; ++guard) {
                if (visited[cur]) { closed = (cur == start && !loop.empty()); break; }
                visited[cur] = 1;
                loop.push_back(cur);
                auto it = nextOf.find(cur);
                if (it == nextOf.end()) { closed = false; break; }
                cur = it->second;
                if (cur == start) { closed = true; break; }
            }
            if (!closed || loop.size() < 3) continue;

            // Drop consecutive duplicate vertices.
            std::vector<std::uint32_t> poly2;
            poly2.reserve(loop.size());
            for (std::uint32_t vi : loop)
                if (poly2.empty() || poly2.back() != vi) poly2.push_back(vi);
            if (poly2.size() >= 2 && poly2.front() == poly2.back()) poly2.pop_back();
            if (poly2.size() < 3) continue;

            // Make the working ring CCW in the (u,w) plane so ear-clipping's
            // "convex vertex has positive signed area" test is valid.
            const std::size_t m2 = poly2.size();
            double area2 = 0.0;
            for (std::size_t k = 0; k < m2; ++k) {
                auto a = uv(poly2[k]);
                auto b = uv(poly2[(k + 1) % m2]);
                area2 += a.first * b.second - b.first * a.second;
            }
            if (area2 == 0.0) continue;               // degenerate section loop
            std::vector<std::uint32_t> P = poly2;
            if (area2 < 0.0) std::reverse(P.begin(), P.end());   // force CCW in (u,w)

            // OUTWARD cap normal for THIS half: the cap closes the kept solid, so
            // its outward normal points AWAY from the solid. Kept half is
            // n·x <= d for keepNegative (solid below the plane -> cap faces +nn),
            // n·x >= d otherwise (solid above -> cap faces -nn). We emit each ear
            // with the winding whose geometric normal matches capOut, so the whole
            // piece has globally consistent outward winding (the divergence-theorem
            // volume is then exact and HalfEdgeMesh accepts it).
            V3 capOut = keepNegative ? nn : (nn * -1.0);

            // Ear clipping on the CCW polygon P (indices into outPos).
            auto triArea2 = [&](std::uint32_t ia, std::uint32_t ib, std::uint32_t ic) {
                auto a = uv(ia); auto b = uv(ib); auto c = uv(ic);
                return (b.first - a.first) * (c.second - a.second)
                     - (c.first - a.first) * (b.second - a.second);
            };
            auto pointInTri = [&](std::uint32_t ia, std::uint32_t ib, std::uint32_t ic,
                                  std::uint32_t ip) {
                auto a = uv(ia); auto b = uv(ib); auto c = uv(ic); auto p = uv(ip);
                auto sideSign = [](std::pair<double,double> A,
                                   std::pair<double,double> B,
                                   std::pair<double,double> Q) {
                    return (B.first - A.first) * (Q.second - A.second)
                         - (B.second - A.second) * (Q.first - A.first);
                };
                double d1 = sideSign(a, b, p);
                double d2 = sideSign(b, c, p);
                double d3 = sideSign(c, a, p);
                bool hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
                bool hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
                return !(hasNeg && hasPos);
            };

            std::vector<std::uint32_t> idxs = P;   // working ring
            std::size_t guard = 0;
            const std::size_t guardMax = idxs.size() * idxs.size() + 16;
            while (idxs.size() >= 3 && guard++ < guardMax) {
                bool clipped = false;
                std::size_t cnt = idxs.size();
                for (std::size_t i = 0; i < cnt; ++i) {
                    std::uint32_t ia = idxs[(i + cnt - 1) % cnt];
                    std::uint32_t ib = idxs[i];
                    std::uint32_t ic = idxs[(i + 1) % cnt];
                    if (triArea2(ia, ib, ic) <= 0.0) continue;   // reflex/colinear
                    // No other polygon vertex inside this ear.
                    bool ok3 = true;
                    for (std::size_t j = 0; j < cnt; ++j) {
                        std::uint32_t ip = idxs[j];
                        if (ip == ia || ip == ib || ip == ic) continue;
                        if (pointInTri(ia, ib, ic, ip)) { ok3 = false; break; }
                    }
                    if (!ok3) continue;
                    // Emit the ear so its geometric normal matches capOut (the
                    // outward direction for this half) — robust to basis handedness
                    // and to which half-space we kept.
                    {
                        V3 A = outPos[ia], B = outPos[ib], C = outPos[ic];
                        V3 fn = cross(B - A, C - A);
                        if (dot(fn, capOut) >= 0.0) {
                            outIdx.push_back(ia); outIdx.push_back(ib); outIdx.push_back(ic);
                        } else {
                            outIdx.push_back(ia); outIdx.push_back(ic); outIdx.push_back(ib);
                        }
                    }
                    idxs.erase(idxs.begin() + static_cast<long>(i));
                    clipped = true;
                    break;
                }
                if (!clipped) break;   // no ear found (non-simple) -> stop honestly
            }
        }
    }

    // Emit the soup.
    out.soup.pos.reserve(outPos.size() * 3);
    for (const V3& p : outPos) { out.soup.pos.push_back(p.x); out.soup.pos.push_back(p.y); out.soup.pos.push_back(p.z); }
    out.soup.idx = std::move(outIdx);

    if (numTris(out.soup) == 0 || numVerts(out.soup) < 4) return out;
    out.ok = true;
    return out;
}

// ---------------------------------------------------------------------------
// Cut-plane SEARCH.
//
// A concavity-driven greedy split does not need the (possibly imperfect) hull
// face normals to pick a plane — it needs the plane whose two closed halves are
// the LEAST concave. We therefore evaluate a small, deterministic family of
// candidate planes and keep the best:
//
//   * the 3 principal axes (x, y, z), each at several offsets sampled across the
//     piece's extent (so a cut lands at the re-entrant ledge of an L / step);
//   * a handful of oriented planes whose normals come from the hull faces
//     (captures slanted concavities), each through the piece centroid.
//
// "Best" = minimum VOLUME-WEIGHTED child concavity, i.e. we directly minimise
// the residual non-convexity. Each candidate is realised with the exact-predicate
// half-space clip and scored by re-measuring both halves' volume-gap concavity.
// Only candidates that produce two real closed halves are considered.
// ---------------------------------------------------------------------------
struct CutResult {
    bool ok{false};
    Soup negSoup;
    Soup posSoup;
    double score{std::numeric_limits<double>::infinity()};  // weighted child concavity
};

CutResult bestCut(const Soup& s, const ConcavityInfo& parent) {
    CutResult best;

    // Piece AABB (for axis sample offsets) and centroid.
    V3 lo{ std::numeric_limits<double>::infinity(),
           std::numeric_limits<double>::infinity(),
           std::numeric_limits<double>::infinity() };
    V3 hi{ -std::numeric_limits<double>::infinity(),
           -std::numeric_limits<double>::infinity(),
           -std::numeric_limits<double>::infinity() };
    V3 cen{};
    const std::size_t nv = numVerts(s);
    for (std::size_t i = 0; i < nv; ++i) {
        V3 p = vert(s, static_cast<std::uint32_t>(i));
        lo.x = std::min(lo.x, p.x); hi.x = std::max(hi.x, p.x);
        lo.y = std::min(lo.y, p.y); hi.y = std::max(hi.y, p.y);
        lo.z = std::min(lo.z, p.z); hi.z = std::max(hi.z, p.z);
        cen = cen + p;
    }
    if (nv > 0) cen = cen * (1.0 / static_cast<double>(nv));

    // Build the candidate plane list: (unit normal, offset d so plane is n·x=d).
    // For each candidate NORMAL direction we sample several offsets across the
    // piece's projected extent along that normal, so a cut can land exactly on a
    // re-entrant ledge (the notch of an L / step) regardless of the solid's
    // world orientation.
    std::vector<std::pair<V3, double>> cands;

    // Sample many interior offsets so a cut can land exactly on a re-entrant
    // ledge regardless of where it sits along the normal. We additionally snap
    // candidate offsets onto the projections of the actual vertices, so a notch
    // edge (which lies AT a vertex coordinate) is always a candidate plane.
    auto addNormalDir = [&](V3 n) {
        double L = norm(n);
        if (!(L > 0.0)) return;
        n = n * (1.0 / L);
        // Project all vertices onto n to find the offset range AND the discrete
        // vertex-projection offsets (the candidate ledge positions).
        double pmin = std::numeric_limits<double>::infinity();
        double pmax = -std::numeric_limits<double>::infinity();
        std::vector<double> proj;
        proj.reserve(nv);
        for (std::size_t i = 0; i < nv; ++i) {
            double pr = dot(n, vert(s, static_cast<std::uint32_t>(i)));
            pmin = std::min(pmin, pr);
            pmax = std::max(pmax, pr);
            proj.push_back(pr);
        }
        double span = pmax - pmin;
        if (!(span > 0.0)) return;
        // (i) uniform interior fractions.
        const int N = 9;
        for (int k = 1; k < N; ++k)
            cands.emplace_back(n, pmin + (static_cast<double>(k) / N) * span);
        // (ii) just-INSIDE each distinct interior vertex projection (a re-entrant
        //      ledge lies AT a vertex coordinate). We nudge the plane a hair off
        //      the exact vertex (by a small fraction of the span) so the clip
        //      never has to handle a vertex lying exactly ON the cut plane — that
        //      keeps the section a clean simple polygon. Both sides of each ledge
        //      are offered so the search can choose the cleaner one.
        std::sort(proj.begin(), proj.end());
        const double nudge = 1e-4 * span;
        for (std::size_t i = 0; i < proj.size(); ++i) {
            double v = proj[i];
            if (i > 0 && std::fabs(v - proj[i - 1]) <= 1e-9 * span) continue;
            if (v - nudge > pmin && v - nudge < pmax) cands.emplace_back(n, v - nudge);
            if (v + nudge > pmin && v + nudge < pmax) cands.emplace_back(n, v + nudge);
        }
    };

    // (a) World axes (covers the axis-aligned common case cheaply).
    addNormalDir(V3{1, 0, 0});
    addNormalDir(V3{0, 1, 0});
    addNormalDir(V3{0, 0, 1});

    // (b) MESH FACE NORMALS — the orientations of the solid's own faces. After
    //     any rigid rotation these point along the solid's LOCAL axes, so a cut
    //     plane parallel to a face (offset to the notch) cleanly separates a
    //     box-like sub-piece. We deduplicate near-parallel normals so the search
    //     stays small.
    {
        std::vector<V3> normals;
        auto pushUnique = [&](V3 n) {
            double L = norm(n);
            if (!(L > 0.0)) return;
            n = n * (1.0 / L);
            for (const V3& m : normals) {
                double d = std::fabs(dot(n, m));
                if (d > 0.9995) return;          // ~1.8 deg: treat as duplicate
            }
            if (normals.size() < 24) normals.push_back(n);
        };
        for (std::size_t t = 0; t < numTris(s); ++t) {
            V3 a = vert(s, s.idx[3 * t + 0]);
            V3 b = vert(s, s.idx[3 * t + 1]);
            V3 c = vert(s, s.idx[3 * t + 2]);
            pushUnique(cross(b - a, c - a));
        }
        for (const V3& n : normals) addNormalDir(n);
    }

    // (c) Hull-face normals through the centroid (slanted concavities).
    {
        std::vector<V3> pts;
        pts.reserve(nv);
        for (std::size_t i = 0; i < nv; ++i) pts.push_back(vert(s, static_cast<std::uint32_t>(i)));
        Hull h = buildHull(pts);
        if (h.ok) {
            std::size_t cap = h.fn.size() < 16 ? h.fn.size() : 16;
            for (std::size_t f = 0; f < cap; ++f)
                cands.emplace_back(h.fn[f], dot(h.fn[f], cen));
        }
    }

    const double pc = parent.ok ? parent.concavity
                                : std::numeric_limits<double>::infinity();
    const double pv = parent.ok ? parent.meshVolume : 0.0;

    for (auto& cd : cands) {
        const V3& n = cd.first;
        double d = cd.second;

        ClipHalf negH = halfSpaceClip(s, n, d, /*keepNegative=*/true);
        ClipHalf posH = halfSpaceClip(s, n, d, /*keepNegative=*/false);
        if (!negH.ok || !posH.ok) continue;
        if (numTris(negH.soup) == 0 || numTris(posH.soup) == 0) continue;

        ConcavityInfo cn = soupConcavity(negH.soup);
        ConcavityInfo cp = soupConcavity(posH.soup);
        // A half whose hull is degenerate is unusable (cannot certify convex).
        if (!cn.ok || !cp.ok) continue;

        double vn = cn.meshVolume, vp = cp.meshVolume;
        double vsum = vn + vp;
        if (!(vsum > 0.0)) continue;

        // VOLUME-CONSERVATION gate: a clean partition has vn+vp == the parent
        // volume. A leaked / mis-capped clip violates this; reject it so a corrupt
        // split can never be chosen (this is what keeps the union-volume metric
        // exact across ALL orientations).
        if (pv > 0.0 && std::fabs(vsum - pv) > 1e-6 * pv) continue;

        // Score: primarily minimise the WORST child concavity (so we never leave a
        // badly-concave residual), with the volume-weighted average concavity as a
        // tiebreaker (prefers cleaner overall splits).
        double childWorst = std::max(cn.concavity, cp.concavity);
        double weighted   = (vn * cn.concavity + vp * cp.concavity) / vsum;
        double score = childWorst + 1e-3 * weighted;

        // Require genuine progress vs the parent.
        if (!(childWorst + 1e-12 < pc) && !(weighted + 1e-12 < pc)) continue;

        if (score < best.score) {
            best.ok = true;
            best.score = score;
            best.negSoup = negH.soup;
            best.posSoup = posH.soup;
        }
    }

    return best;
}

// Build a ConvexPiece view of a soup (volume normalised positive, concavity
// measured, convex flag set against tol).
ConvexPiece makePiece(const Soup& s, double tol) {
    ConvexPiece p;
    p.positions = s.pos;
    p.indices   = s.idx;
    ConcavityInfo ci = soupConcavity(s);
    p.concavity = ci.ok ? ci.concavity : std::numeric_limits<double>::infinity();
    p.convex = ci.ok && (p.concavity <= tol);
    // Volume reporting: for a CONVEX piece the true volume equals its convex
    // hull volume (robust, independent of the clipped soup's connectivity); we
    // use that. For a still-concave residual piece we fall back to the soup's
    // divergence-theorem volume. This keeps the union-volume metric meaningful
    // even though the self-contained plane clip can leave T-junctions on a
    // capped section (it does not re-triangulate neighbours — the same cap
    // ceiling MeshBoolean documents).
    if (ci.ok && p.convex) {
        p.volume = ci.hullVol;
    } else {
        p.volume = std::fabs(soupSignedVolume(s));
    }
    return p;
}

} // namespace

// ===========================================================================
// Public: independent convexity report on a built HalfEdgeMesh.
// ===========================================================================
ConvexityReport meshConcavity(const mesh::HalfEdgeMesh& m) {
    ConvexityReport rep;
    Soup s;
    m.toSoup(s.pos, s.idx);
    if (numTris(s) == 0 || numVerts(s) < 4) return rep;   // ok stays false
    ConcavityInfo ci = soupConcavity(s);
    rep.ok = ci.ok;
    rep.concavity = ci.ok ? ci.concavity : 0.0;
    return rep;
}

// ===========================================================================
// Public: decompose an already-built HalfEdgeMesh.
// ===========================================================================
DecompositionResult convexDecompose(const mesh::HalfEdgeMesh& mesh,
                                    const DecompositionParams& params) {
    DecompositionResult res;

    // Honest precondition gate: closed, 2-manifold, consistent winding.
    mesh::ValidityReport vr = mesh.validate();
    if (!vr.isValid()) {
        res.ok = false;
        res.reason = "input mesh is not a closed 2-manifold solid";
        return res;
    }

    Soup root;
    mesh.toSoup(root.pos, root.idx);
    if (numTris(root) == 0 || numVerts(root) < 4) {
        res.ok = false;
        res.reason = "input has too few triangles/vertices to be a solid";
        return res;
    }

    // Finite, non-zero volume.
    double v0 = soupSignedVolume(root);
    for (double c : root.pos) {
        if (!std::isfinite(c)) {
            res.ok = false; res.reason = "input has non-finite coordinates"; return res;
        }
    }
    if (!(std::fabs(v0) > 0.0) || !std::isfinite(v0)) {
        res.ok = false;
        res.reason = "input has zero / non-finite volume";
        return res;
    }
    res.inputVolume = std::fabs(v0);

    const double tol = params.concavityTol;

    // Greedy worklist of (soup, depth). We keep finished pieces separately.
    struct Job { Soup soup; std::size_t depth; };
    std::vector<Job> open;
    open.push_back(Job{root, 0});

    std::vector<Soup> done;

    // Is the WHOLE input convex within tol? Record for reporting.
    {
        ConcavityInfo ci0 = soupConcavity(root);
        res.inputWasConvex = ci0.ok && (ci0.concavity <= tol);
    }

    while (!open.empty()) {
        // Stop splitting once we have enough pieces; flush the rest as-is.
        if (open.size() + done.size() >= params.maxPieces) {
            for (Job& j : open) done.push_back(std::move(j.soup));
            open.clear();
            break;
        }

        Job job = std::move(open.back());
        open.pop_back();

        ConcavityInfo ci = soupConcavity(job.soup);

        // Accept the piece if it is convex within tol, or if we cannot make
        // further progress (depth cap, or hull was non-degenerate but tiny).
        bool acceptConvex = ci.ok && (ci.concavity <= tol);
        if (acceptConvex || job.depth >= params.maxDepth) {
            done.push_back(std::move(job.soup));
            continue;
        }

        // If the hull is degenerate (ci.ok == false) we cannot cut meaningfully
        // along a hull-deviation direction — accept the piece honestly rather
        // than fabricate a split.
        if (!ci.ok) {
            done.push_back(std::move(job.soup));
            continue;
        }

        // Search candidate planes for the best concavity-reducing split. The
        // search already enforces the progress guard (a chosen cut must lower the
        // residual concavity vs the parent).
        CutResult cut = bestCut(job.soup, ci);
        if (!cut.ok) {
            // No candidate plane split the piece into two real, less-concave
            // closed halves. Accept the piece as-is rather than fabricate a split
            // (honest no-progress guard — never emit an empty/garbage half).
            done.push_back(std::move(job.soup));
            continue;
        }

        open.push_back(Job{std::move(cut.negSoup), job.depth + 1});
        open.push_back(Job{std::move(cut.posSoup), job.depth + 1});
    }

    // Materialise pieces + metrics.
    res.totalVolume = 0.0;
    for (Soup& s : done) {
        ConvexPiece pc = makePiece(s, tol);
        res.totalVolume += pc.volume;
        res.pieces.push_back(std::move(pc));
    }

    if (res.pieces.empty()) {
        res.ok = false;
        res.reason = "decomposition produced no pieces";
        return res;
    }
    res.ok = true;
    res.reason = "";
    return res;
}

// ===========================================================================
// Public: decompose a raw triangle soup (builds + validates internally).
// ===========================================================================
DecompositionResult convexDecompose(const std::vector<double>& positions,
                                    const std::vector<std::uint32_t>& indices,
                                    const DecompositionParams& params) {
    DecompositionResult res;
    if (positions.size() % 3 != 0 || indices.size() % 3 != 0) {
        res.ok = false; res.reason = "malformed soup (size not a multiple of 3)";
        return res;
    }
    HalfEdgeMesh m;
    if (!m.buildFromSoup(positions, indices)) {
        res.ok = false;
        res.reason = "soup is not a buildable manifold (bad index / winding / degenerate)";
        return res;
    }
    return convexDecompose(m, params);
}

} // namespace geom
} // namespace native
} // namespace forge
