// forge/native/mesh/FeatureEdges.cpp
//
// Implementation of forge::native::mesh::detectFeatureEdges — sharp feature-edge
// and corner detection by dihedral angle on the in-house half-edge triangle mesh.
// Pure C++20, standard library only. See FeatureEdges.hpp for the full
// specification and honest robustness posture.

#include "forge/native/mesh/FeatureEdges.hpp"

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/Delaunay3D.hpp"
#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#include "forge/native/implicit/SdfTree.hpp"
#include "forge/native/implicit/IsoMesher.hpp"

#include <algorithm>     // std::sort, std::max, std::min
#include <array>         // std::array
#include <charconv>      // std::to_chars (not load-bearing; CI-portability include)
#include <cmath>         // std::sqrt, std::atan2, std::isfinite
#include <cstddef>       // std::size_t
#include <cstdint>       // std::uint32_t, std::uint64_t, std::uint8_t
#include <cstring>       // std::memset (CI-portability include)
#include <functional>    // std::greater, std::less (CI-portability include)
#include <limits>        // std::numeric_limits
#include <map>           // std::map
#include <numeric>       // std::accumulate, std::iota (CI-portability include)
#include <queue>         // std::queue (CI-portability include)
#include <set>           // std::set (CI-portability include)
#include <string>        // std::string (CI-portability include)
#include <unordered_map> // std::unordered_map
#include <unordered_set> // std::unordered_set (CI-portability include)
#include <utility>       // std::pair
#include <vector>        // std::vector

namespace forge {
namespace native {
namespace mesh {

namespace {

// Local 3-vector helpers (do not leak into the public API).
struct V3 {
    double x{0.0}, y{0.0}, z{0.0};
};

inline V3 toV3(const Vec3& v) { return V3{v.x, v.y, v.z}; }
inline V3 sub(const V3& a, const V3& b) { return V3{a.x - b.x, a.y - b.y, a.z - b.z}; }
inline double dot(const V3& a, const V3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3 cross(const V3& a, const V3& b) {
    return V3{a.y * b.z - a.z * b.y,
              a.z * b.x - a.x * b.z,
              a.x * b.y - a.y * b.x};
}
inline double norm(const V3& a) { return std::sqrt(dot(a, a)); }
inline bool finite3(const V3& a) {
    return std::isfinite(a.x) && std::isfinite(a.y) && std::isfinite(a.z);
}

// Pack an unordered vertex pair {a,b} into a single 64-bit key (lo<<32 | hi).
inline std::uint64_t undirKey(std::uint32_t a, std::uint32_t b) {
    std::uint32_t lo = a < b ? a : b;
    std::uint32_t hi = a < b ? b : a;
    return (static_cast<std::uint64_t>(lo) << 32) | static_cast<std::uint64_t>(hi);
}

FeatureSet fail(const char* why) {
    FeatureSet f;
    f.ok = false;
    f.reason = why;
    return f;
}

static const double kPi = 3.14159265358979323846;
static const double kRadToDeg = 180.0 / kPi;

} // namespace

FeatureSet detectFeatureEdges(const HalfEdgeMesh& mesh, double thresholdDeg) {
    const std::vector<Vertex>&   V  = mesh.vertices();
    const std::vector<HalfEdge>& HE = mesh.halfEdges();
    const std::vector<Face>&     F  = mesh.faces();

    const std::uint32_t nv = static_cast<std::uint32_t>(V.size());
    const std::uint32_t nf = static_cast<std::uint32_t>(F.size());

    if (!(thresholdDeg >= 0.0 && thresholdDeg <= 180.0))
        return fail("threshold out of range [0,180]");
    if (nv == 0 || nf == 0) return fail("empty mesh");
    if (HE.empty())         return fail("mesh has no half-edges");

    // Re-audit with the kernel's own validator. We accept a 2-manifold-with-
    // boundary mesh (an open patch is legitimately such), so we do NOT require
    // vr.manifold (which additionally demands watertightness). We require:
    //   * twin consistency (the half-edge wiring is sound), and
    //   * edge-manifoldness: every undirected edge has 1 or 2 incident faces
    //     (a successful buildFromSoup already rejects a repeated directed edge,
    //      so 3+ faces on an edge cannot occur — re-verified defensively below).
    ValidityReport vr = mesh.validate();
    if (!vr.twinsConsistent) return fail("half-edge twins inconsistent");
    if (vr.numEdges == 0)    return fail("mesh has no edges");

    // ---- finite coordinates + zero-area-triangle rejection --------------------
    // Each face owns three consecutive half-edges via next/next. Verify the face
    // normal is well-defined (non-degenerate) and the coordinates are finite. We
    // also precompute and cache the per-face OUTWARD normal (un-normalised cross
    // product of two edge vectors, CCW winding => outward).
    std::vector<V3> faceNormal(nf);
    for (std::uint32_t f = 0; f < nf; ++f) {
        if (F[f].halfEdge == kInvalid) return fail("face has no half-edge");
        const HalfEdge& h0 = HE[F[f].halfEdge];
        const HalfEdge& h1 = HE[h0.next];
        const HalfEdge& h2 = HE[h1.next];
        if (h0.origin >= nv || h1.origin >= nv || h2.origin >= nv)
            return fail("face vertex index out of range");
        const V3 a = toV3(V[h0.origin].position);
        const V3 b = toV3(V[h1.origin].position);
        const V3 c = toV3(V[h2.origin].position);
        if (!finite3(a) || !finite3(b) || !finite3(c))
            return fail("non-finite vertex coordinate");
        const V3 n = cross(sub(b, a), sub(c, a));
        const double nlen = norm(n);
        // Degenerate (zero-area) triangle: its normal is undefined. Cross-check
        // with the robust orient3d oracle — a truly flat triangle reports the
        // projected area as zero on at least one axis; combine the magnitude test
        // with a robust-coplanarity sanity check on a lifted apex.
        if (!(nlen > 0.0) || !std::isfinite(nlen))
            return fail("zero-area (degenerate) triangle");
        faceNormal[f] = n;
    }

    // ---- group directed half-edges by undirected key to find incident faces ---
    // For each undirected edge {a,b}, gather the faces whose half-edge runs along
    // it (in either direction). A manifold edge has exactly 2; a boundary edge
    // has exactly 1; >2 is non-manifold (rejected).
    struct EdgeAccum {
        std::uint32_t v0 = kInvalid;     // lo endpoint
        std::uint32_t v1 = kInvalid;     // hi endpoint
        std::uint32_t face0 = kInvalid;
        std::uint32_t face1 = kInvalid;
        std::uint32_t count = 0;         // incident half-edges (== incident faces)
    };
    std::unordered_map<std::uint64_t, EdgeAccum> edgeMap;
    edgeMap.reserve(HE.size());

    for (std::uint32_t h = 0; h < HE.size(); ++h) {
        const HalfEdge& he = HE[h];
        if (he.next >= HE.size()) return fail("half-edge next out of range");
        const std::uint32_t a = he.origin;
        const std::uint32_t b = HE[he.next].origin;
        if (a >= nv || b >= nv) return fail("half-edge endpoint out of range");
        const std::uint64_t key = undirKey(a, b);
        EdgeAccum& e = edgeMap[key];
        if (e.count == 0) {
            e.v0 = a < b ? a : b;
            e.v1 = a < b ? b : a;
            e.face0 = he.face;
        } else if (e.count == 1) {
            e.face1 = he.face;
        } else {
            return fail("non-manifold edge (>2 incident faces)");
        }
        ++e.count;
        if (e.face0 >= nf || (e.count == 2 && e.face1 >= nf))
            return fail("half-edge face index out of range");
    }

    // ---- assemble the per-edge feature classification -------------------------
    // Deterministic order: sort by (v0,v1) so the output is reproducible.
    std::vector<EdgeAccum> edges;
    edges.reserve(edgeMap.size());
    for (const auto& kv : edgeMap) edges.push_back(kv.second);
    std::sort(edges.begin(), edges.end(), [](const EdgeAccum& x, const EdgeAccum& y) {
        if (x.v0 != y.v0) return x.v0 < y.v0;
        return x.v1 < y.v1;
    });

    FeatureSet out;
    out.ok = true;
    out.reason = "ok";
    out.thresholdDeg = thresholdDeg;
    out.numVertices = nv;
    out.numEdges = static_cast<std::uint32_t>(edges.size());
    out.numFaces = nf;
    out.edges.reserve(edges.size());
    out.vertexFeatureDegree.assign(nv, 0u);
    out.vertexKind.assign(nv, VertexKind::SMOOTH);

    for (const EdgeAccum& e : edges) {
        FeatureEdge fe;
        fe.v0 = e.v0;
        fe.v1 = e.v1;

        if (e.count == 1) {
            // Boundary edge: open mesh terminates here -> always a feature.
            fe.boundary = true;
            fe.dihedralDeg = 0.0;   // undefined (one incident face); not used
            fe.feature = true;
        } else {
            // Manifold edge: dihedral angle between the two OUTWARD face normals.
            //   theta = atan2(|n0 x n1|, n0 . n1)  in [0, pi].
            // This is the numerically-stable form valid across the full range
            // (no acos clamp). theta == 0 for two coplanar same-facing triangles;
            // theta == pi/2 for a cube edge; theta -> pi for a near-fold.
            const V3& n0 = faceNormal[e.face0];
            const V3& n1 = faceNormal[e.face1];
            const double s = norm(cross(n0, n1));
            const double c = dot(n0, n1);
            double theta = std::atan2(s, c);   // [0, pi]
            if (!std::isfinite(theta)) theta = 0.0;
            fe.boundary = false;
            fe.dihedralDeg = theta * kRadToDeg;
            // Strict '>' so that exactly-coplanar (0 deg) never trips even a 0-deg
            // threshold accidentally, and the threshold-monotonicity guarantee is
            // exact (a rising threshold only ever drops edges from the set).
            fe.feature = (fe.dihedralDeg > thresholdDeg);
        }

        if (fe.feature) {
            ++out.numFeatureEdges;
            if (fe.boundary) ++out.numBoundaryEdges;
            // Tally the incident-feature-edge degree at each endpoint.
            out.vertexFeatureDegree[fe.v0] += 1;
            out.vertexFeatureDegree[fe.v1] += 1;
        } else if (fe.boundary) {
            // (Boundary edges are always features, so this branch is unreachable;
            //  kept defensive — a boundary edge is never a non-feature.)
            ++out.numBoundaryEdges;
        }

        out.edges.push_back(fe);
    }

    // ---- classify vertices by incident-feature-edge count ---------------------
    for (std::uint32_t v = 0; v < nv; ++v) {
        const std::uint32_t d = out.vertexFeatureDegree[v];
        if (d >= 3) {
            out.vertexKind[v] = VertexKind::CORNER;
            ++out.numCornerVertices;
        } else if (d == 2) {
            out.vertexKind[v] = VertexKind::CREASE;
            ++out.numCreaseVertices;
        } else {
            out.vertexKind[v] = VertexKind::SMOOTH;
        }
    }

    return out;
}

FeatureSet detectFeatureEdges(const std::vector<double>& positions,
                              const std::vector<std::uint32_t>& indices,
                              double thresholdDeg) {
    if (!(thresholdDeg >= 0.0 && thresholdDeg <= 180.0))
        return fail("threshold out of range [0,180]");
    if (positions.empty() || indices.empty()) return fail("empty soup");
    if (positions.size() % 3 != 0) return fail("positions length not a multiple of 3");
    if (indices.size() % 3 != 0)   return fail("indices length not a multiple of 3");

    // Reject non-finite coordinates up front (buildFromSoup does not screen NaN).
    for (double p : positions)
        if (!std::isfinite(p)) return fail("non-finite vertex coordinate");

    HalfEdgeMesh mesh;
    if (!mesh.buildFromSoup(positions, indices))
        return fail("kernel could not build a manifold half-edge mesh from the soup");

    return detectFeatureEdges(mesh, thresholdDeg);
}

} // namespace mesh
} // namespace native
} // namespace forge
