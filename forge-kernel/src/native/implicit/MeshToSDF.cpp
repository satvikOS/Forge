// forge/native/src/implicit/MeshToSDF.cpp
//
// Implementation of the mesh -> signed-distance-field voxelizer declared in
// forge/native/implicit/MeshToSDF.hpp. Pure C++20, standard library only.
// ZERO external deps, no OCCT, no WASM. See the header for the honest scope /
// robustness posture (brute-force unsigned distance + ray-parity sign).

#include "forge/native/implicit/MeshToSDF.hpp"

#include <cmath>
#include <limits>
#include <vector>
#include <cstdint>
#include <algorithm>

namespace forge {
namespace native {
namespace implicit {

namespace {

// --- minimal local vector arithmetic on native::Vec3 ----------------------
// (native::Vec3 — from VoxelGrid.hpp — is a bare POD with no operators. We keep
// these helpers file-local and minimal; a shared math header is a future
// consolidation, not duplicated logic. // TODO(shared-math))
using V3 = native::Vec3;

inline V3 sub(const V3& a, const V3& b) { return V3{a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 add(const V3& a, const V3& b) { return V3{a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 mul(const V3& a, double s)    { return V3{a.x * s, a.y * s, a.z * s}; }
inline double dot(const V3& a, const V3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3 cross(const V3& a, const V3& b) {
    return V3{a.y * b.z - a.z * b.y,
              a.z * b.x - a.x * b.z,
              a.x * b.y - a.y * b.x};
}
inline double lengthSq(const V3& a) { return dot(a, a); }
inline double clamp01(double t) { return t < 0.0 ? 0.0 : (t > 1.0 ? 1.0 : t); }

inline bool finite3(const V3& v) {
    return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}

} // namespace

// ---------------------------------------------------------------------------
// Exact closed-form point-to-triangle distance.
//
// Standard region-classified projection (Ericson, "Real-Time Collision
// Detection", §5.1.5 — the geometry is textbook, the code is re-derived). The
// nearest point on a triangle to p is found by computing barycentric-region
// membership from edge dot-products; the result is the exact Euclidean distance
// to the closest point, whether that lies in the face interior, on an edge, or
// at a vertex.
// ---------------------------------------------------------------------------
double MeshToSDF::pointTriangleDistance(const native::Vec3& p,
                                        const native::Vec3& a,
                                        const native::Vec3& b,
                                        const native::Vec3& c) {
    const V3 ab = sub(b, a);
    const V3 ac = sub(c, a);
    const V3 ap = sub(p, a);

    const double d1 = dot(ab, ap);
    const double d2 = dot(ac, ap);
    // Region: vertex a.
    if (d1 <= 0.0 && d2 <= 0.0) {
        return std::sqrt(lengthSq(ap));
    }

    const V3 bp = sub(p, b);
    const double d3 = dot(ab, bp);
    const double d4 = dot(ac, bp);
    // Region: vertex b.
    if (d3 >= 0.0 && d4 <= d3) {
        return std::sqrt(lengthSq(bp));
    }

    // Region: edge ab.
    const double vc = d1 * d4 - d3 * d2;
    if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
        const double denom = (d1 - d3);
        const double v = denom != 0.0 ? d1 / denom : 0.0;
        const V3 proj = add(a, mul(ab, v));
        return std::sqrt(lengthSq(sub(p, proj)));
    }

    const V3 cp = sub(p, c);
    const double d5 = dot(ab, cp);
    const double d6 = dot(ac, cp);
    // Region: vertex c.
    if (d6 >= 0.0 && d5 <= d6) {
        return std::sqrt(lengthSq(cp));
    }

    // Region: edge ac.
    const double vb = d5 * d2 - d1 * d6;
    if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
        const double denom = (d2 - d6);
        const double w = denom != 0.0 ? d2 / denom : 0.0;
        const V3 proj = add(a, mul(ac, w));
        return std::sqrt(lengthSq(sub(p, proj)));
    }

    // Region: edge bc.
    const double va = d3 * d6 - d5 * d4;
    if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
        const double num = (d4 - d3);
        const double den = (d4 - d3) + (d5 - d6);
        const double w = den != 0.0 ? num / den : 0.0;
        const V3 bc = sub(c, b);
        const V3 proj = add(b, mul(bc, clamp01(w)));
        return std::sqrt(lengthSq(sub(p, proj)));
    }

    // Region: face interior. Project onto the triangle plane.
    const double denom = va + vb + vc;
    if (denom != 0.0) {
        const double v = vb / denom;
        const double w = vc / denom;
        const V3 proj = add(add(a, mul(ab, v)), mul(ac, w));
        return std::sqrt(lengthSq(sub(p, proj)));
    }

    // Degenerate (zero-area) triangle: fall back to nearest of the three verts.
    const double da = std::sqrt(lengthSq(ap));
    const double db = std::sqrt(lengthSq(bp));
    const double dc = std::sqrt(lengthSq(cp));
    return std::min(da, std::min(db, dc));
}

namespace {

// Flat triangle soup pulled once from the half-edge mesh, as native::Vec3 verts
// plus index triples. (HalfEdgeMesh::toSoup hands us flat doubles + uint32.)
struct Soup {
    std::vector<V3> verts;
    std::vector<std::array<std::uint32_t, 3>> tris;
};

Soup extractSoup(const mesh::HalfEdgeMesh& m) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    m.toSoup(pos, idx);

    Soup s;
    s.verts.reserve(pos.size() / 3);
    for (std::size_t i = 0; i + 2 < pos.size(); i += 3)
        s.verts.push_back(V3{pos[i], pos[i + 1], pos[i + 2]});
    s.tris.reserve(idx.size() / 3);
    for (std::size_t f = 0; f + 2 < idx.size(); f += 3)
        s.tris.push_back({idx[f], idx[f + 1], idx[f + 2]});
    return s;
}

// Unsigned distance from p to the whole soup (brute force min over triangles).
double unsignedDistSoup(const Soup& s, const V3& p) {
    double best = std::numeric_limits<double>::infinity();
    for (const auto& t : s.tris) {
        const double d = MeshToSDF::pointTriangleDistance(
            p, s.verts[t[0]], s.verts[t[1]], s.verts[t[2]]);
        if (d < best) best = d;
    }
    return best;
}

// Ray-triangle crossing test (Moller-Trumbore) restricted to a HALF-LINE:
// does the ray from `orig` along unit-ish `dir` cross triangle (a,b,c) at
// parameter t > eps? Returns true on a strictly-forward crossing.
//
// We use a small epsilon to reject grazing (parallel) hits; the CALLER picks a
// slightly off-axis `dir` so an edge/vertex graze is measure-zero. This is the
// honest ray-parity sign — robust-in-practice, not proven-exact (see header
// // TODO(exact-sign)).
bool rayCrossesTriangle(const V3& orig, const V3& dir,
                        const V3& a, const V3& b, const V3& c) {
    constexpr double kEps = 1e-12;
    const V3 e1 = sub(b, a);
    const V3 e2 = sub(c, a);
    const V3 pv = cross(dir, e2);
    const double det = dot(e1, pv);
    if (std::fabs(det) < kEps) return false;          // ray parallel to triangle
    const double inv = 1.0 / det;
    const V3 tv = sub(orig, a);
    const double u = dot(tv, pv) * inv;
    if (u < 0.0 || u > 1.0) return false;
    const V3 qv = cross(tv, e1);
    const double v = dot(dir, qv) * inv;
    if (v < 0.0 || u + v > 1.0) return false;
    const double t = dot(e2, qv) * inv;
    return t > kEps;                                  // strictly forward half-line
}

// Inside test by ray-parity: shoot a (slightly perturbed) +x ray from p and
// count forward crossings. ODD => inside. The perturbation dodges the
// measure-zero set of rays that graze a shared edge/vertex (which would be
// double-counted by Moller-Trumbore otherwise).
bool insideByParity(const Soup& s, const V3& p) {
    // Near-axis +x direction with tiny y/z tilt (deterministic, not random, so
    // the field is reproducible). The tilt is far below voxel scale.
    const V3 dir{1.0, 7.3e-4, 3.1e-4};
    int crossings = 0;
    for (const auto& t : s.tris) {
        if (rayCrossesTriangle(p, dir, s.verts[t[0]], s.verts[t[1]], s.verts[t[2]]))
            ++crossings;
    }
    return (crossings & 1) != 0;
}

} // namespace

double MeshToSDF::unsignedDistance(const mesh::HalfEdgeMesh& mesh,
                                   const native::Vec3& p) {
    const Soup s = extractSoup(mesh);
    if (s.tris.empty()) return std::numeric_limits<double>::infinity();
    return unsignedDistSoup(s, p);
}

MeshSdfResult MeshToSDF::build(const mesh::HalfEdgeMesh& mesh,
                               const MeshToSdfSpec& spec) {
    MeshSdfResult r;

    // --- validate spec ----------------------------------------------------
    if (!(spec.spacing > 0.0)) { r.reason = "spacing must be > 0"; return r; }
    if (spec.marginCells < 1)  { r.reason = "marginCells must be >= 1"; return r; }

    // --- pull soup, reject empty / degenerate -----------------------------
    const Soup s = extractSoup(mesh);
    r.numTriangles = s.tris.size();
    if (s.tris.empty()) { r.reason = "empty mesh (no triangles)"; return r; }

    // --- axis-aligned bounding box ----------------------------------------
    V3 lo{ std::numeric_limits<double>::infinity(),
           std::numeric_limits<double>::infinity(),
           std::numeric_limits<double>::infinity() };
    V3 hi{ -std::numeric_limits<double>::infinity(),
           -std::numeric_limits<double>::infinity(),
           -std::numeric_limits<double>::infinity() };
    for (const auto& v : s.verts) {
        if (!finite3(v)) { r.reason = "non-finite vertex coordinate"; return r; }
        lo.x = std::min(lo.x, v.x); hi.x = std::max(hi.x, v.x);
        lo.y = std::min(lo.y, v.y); hi.y = std::max(hi.y, v.y);
        lo.z = std::min(lo.z, v.z); hi.z = std::max(hi.z, v.z);
    }
    const double ext = std::max(hi.x - lo.x, std::max(hi.y - lo.y, hi.z - lo.z));
    if (!(ext > 0.0) || !std::isfinite(ext)) {
        r.reason = "degenerate (zero-extent or non-finite) bounding box";
        return r;
    }

    // --- padded grid origin + node counts ---------------------------------
    const double h = spec.spacing;
    const double pad = double(spec.marginCells) * h;
    const V3 origin{ lo.x - pad, lo.y - pad, lo.z - pad };
    // Span we must cover on each axis, plus padding on BOTH sides.
    auto nodesFor = [&](double span) {
        const std::size_t n =
            std::size_t(std::ceil((span + 2.0 * pad) / h)) + 1;
        return n < 2 ? std::size_t(2) : n;
    };
    const std::size_t nx = nodesFor(hi.x - lo.x);
    const std::size_t ny = nodesFor(hi.y - lo.y);
    const std::size_t nz = nodesFor(hi.z - lo.z);

    // --- closure flag (parity sign only trustworthy on a closed mesh) -----
    const mesh::ValidityReport rep = mesh.validate();
    r.closed = rep.watertight;

    // --- allocate + fill the signed field ---------------------------------
    native::VoxelGrid<float> grid(nx, ny, nz, native::Vec3{origin.x, origin.y, origin.z}, h);
    for (std::size_t k = 0; k < nz; ++k)
        for (std::size_t j = 0; j < ny; ++j)
            for (std::size_t i = 0; i < nx; ++i) {
                const native::Vec3 np = grid.nodePosition(i, j, k);
                const V3 p{np.x, np.y, np.z};
                double d = unsignedDistSoup(s, p);
                if (insideByParity(s, p)) d = -d;     // inside => negative
                grid.at(i, j, k) = static_cast<float>(d);
            }

    r.grid = std::move(grid);
    r.ok = true;
    r.reason = "";
    return r;
}

} // namespace implicit
} // namespace native
} // namespace forge
