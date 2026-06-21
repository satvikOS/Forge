// forge/native/brep/Fillet.cpp
//
// Implementation of forge::native::brep::filletConvexEdges — a MESH edge fillet
// (rounded edge) on the in-house half-edge triangle mesh. Pure C++20, standard
// library only. See Fillet.hpp for the full specification, the validated
// envelope, and the honest robustness posture. This is a MESH fillet (rolling-
// ball strip approximation), NOT an analytic B-rep fillet.
//
// CONSTRUCTION (convex rolling-ball envelope)
// -------------------------------------------
// 1. Reuse mesh::detectFeatureEdges to get the sharp edges + their dihedrals.
// 2. Classify each sharp manifold edge convex/concave by the SIGN of its signed
//    dihedral (exact orient3d against the opposite-face apex). Convex edges are
//    rounded; concave edges are skipped (left sharp).
// 3. Each ORIGINAL face is rebuilt as a CONTACT POLYGON: every face-corner vertex
//    is pulled inward so each convex edge of the face is offset a distance r into
//    the face plane (along the in-face perpendicular to the edge). The corner of
//    the contact polygon is the in-face intersection of the two offset edge lines
//    meeting at that face corner. The contact polygon is fan-triangulated as the
//    flat top of the rounded solid.
// 4. Each convex edge becomes a FILLET STRIP: the rolling-ball axis is the line
//    parallel to the edge at the ball centre (offset r along each face's inward
//    normal direction). nSeg arc rings sweep the ball surface from face-0's
//    contact line to face-1's contact line, stitched as 2*nSeg triangles per
//    edge.
// 5. Each convex corner (a vertex all of whose incident sharp edges are convex)
//    becomes a rounded VERTEX: a spherical-cap fan of radius r about the corner
//    ball centre, filling the curved triangular gap so the solid closes.
//
// Every emitted strip/cap vertex is welded by spatial hashing so the soup builds
// into a clean watertight half-edge mesh, which is re-validated before ok=true.

#include "forge/native/brep/Fillet.hpp"

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/AABBTree.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#include "forge/native/mesh/FeatureEdges.hpp"
#include "forge/native/mesh/TriTriIntersect.hpp"

#include <algorithm>     // std::sort, std::min, std::max, std::find
#include <array>         // std::array
#include <cmath>         // std::sqrt, std::sin, std::cos, std::atan2, std::isfinite
#include <cstddef>       // std::size_t
#include <cstdint>       // std::uint32_t, std::uint64_t
#include <cstring>       // std::memcpy (CI-portability include)
#include <functional>    // std::hash (CI-portability include)
#include <limits>        // std::numeric_limits
#include <map>           // std::map (CI-portability include)
#include <numeric>       // std::iota (CI-portability include)
#include <queue>         // std::queue (CI-portability include)
#include <set>           // std::set (CI-portability include)
#include <string>        // std::string
#include <unordered_map> // std::unordered_map
#include <unordered_set> // std::unordered_set (CI-portability include)
#include <vector>        // std::vector

namespace forge {
namespace native {
namespace brep {

namespace {

using mesh::HalfEdgeMesh;
using mesh::kInvalid;

constexpr double kPi = 3.14159265358979323846;

// ----- minimal 3-vector algebra (local; does not leak into the public API) ---
struct V3 { double x = 0.0, y = 0.0, z = 0.0; };

inline V3 toV3(const mesh::Vec3& v) { return V3{v.x, v.y, v.z}; }
inline V3 add(const V3& a, const V3& b) { return V3{a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 sub(const V3& a, const V3& b) { return V3{a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 mul(const V3& a, double s) { return V3{a.x * s, a.y * s, a.z * s}; }
inline double dot(const V3& a, const V3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3 cross(const V3& a, const V3& b) {
    return V3{a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline double norm(const V3& a) { return std::sqrt(dot(a, a)); }
inline V3 normalize(const V3& a) {
    const double n = norm(a);
    return (n > 0.0) ? mul(a, 1.0 / n) : V3{0.0, 0.0, 0.0};
}
inline bool finite3(const V3& a) {
    return std::isfinite(a.x) && std::isfinite(a.y) && std::isfinite(a.z);
}

FilletResult fail(const char* why) {
    FilletResult r;
    r.ok = false;
    r.reason = why;
    return r;
}

// Spatial weld: snap near-coincident vertices to a single index. Robust enough
// for the constructive soup we emit (all coordinates are placed exactly from the
// same analytic formulas, so coincident corners are bit-identical or within a few
// ulps). We hash on a quantised grid and search the 27 neighbour cells.
struct VertexWelder {
    double cell;
    std::vector<double> pos;  // flat xyz
    std::unordered_map<std::uint64_t, std::vector<std::uint32_t>> grid;

    explicit VertexWelder(double weldTol) : cell(weldTol > 0.0 ? weldTol : 1e-9) {}

    static std::uint64_t key(long long i, long long j, long long k) {
        // Mix three signed grid coords into one 64-bit key.
        const std::uint64_t ux = static_cast<std::uint64_t>(static_cast<std::int64_t>(i)) * 0x9E3779B97F4A7C15ull;
        const std::uint64_t uy = static_cast<std::uint64_t>(static_cast<std::int64_t>(j)) * 0xC2B2AE3D27D4EB4Full;
        const std::uint64_t uz = static_cast<std::uint64_t>(static_cast<std::int64_t>(k)) * 0x165667B19E3779F9ull;
        return ux ^ (uy + 0x9E3779B97F4A7C15ull + (ux << 6) + (ux >> 2)) ^ uz;
    }

    std::uint32_t insert(const V3& p) {
        const long long ci = static_cast<long long>(std::floor(p.x / cell));
        const long long cj = static_cast<long long>(std::floor(p.y / cell));
        const long long ck = static_cast<long long>(std::floor(p.z / cell));
        const double tol2 = (cell) * (cell);
        for (long long di = -1; di <= 1; ++di)
            for (long long dj = -1; dj <= 1; ++dj)
                for (long long dk = -1; dk <= 1; ++dk) {
                    auto it = grid.find(key(ci + di, cj + dj, ck + dk));
                    if (it == grid.end()) continue;
                    for (std::uint32_t idx : it->second) {
                        const double dx = pos[3 * idx + 0] - p.x;
                        const double dy = pos[3 * idx + 1] - p.y;
                        const double dz = pos[3 * idx + 2] - p.z;
                        if (dx * dx + dy * dy + dz * dz <= tol2)
                            return idx;
                    }
                }
        const std::uint32_t id = static_cast<std::uint32_t>(pos.size() / 3);
        pos.push_back(p.x); pos.push_back(p.y); pos.push_back(p.z);
        grid[key(ci, cj, ck)].push_back(id);
        return id;
    }
};

// Pack an unordered vertex pair into a 64-bit key (lo<<32 | hi).
inline std::uint64_t undirKey(std::uint32_t a, std::uint32_t b) {
    const std::uint32_t lo = a < b ? a : b;
    const std::uint32_t hi = a < b ? b : a;
    return (static_cast<std::uint64_t>(lo) << 32) | static_cast<std::uint64_t>(hi);
}

// Per-original-face data we need to build contact polygons.
struct FaceRec {
    std::array<std::uint32_t, 3> v{kInvalid, kInvalid, kInvalid};  // CCW vertices
    V3 normal{};        // unit outward normal
    V3 nIn{};           // -normal (inward), unit
};

// For one (original vertex, original face) corner we compute its CONTACT point:
// the original corner pulled inward so each incident convex edge of that face is
// offset r into the face plane. We solve it as the in-face intersection of the
// two offset edge-lines meeting at the corner. Returns false if the corner is
// degenerate (edges parallel / r too large so the offset lines do not meet
// inside the face).
//
// pCorner : the corner position; eA, eB : unit in-face directions of the two
// face edges leaving the corner (toward the next/prev face vertices); inA, inB :
// unit in-face inward-perpendiculars of those edges (pointing into the face);
// offA, offB : the offset distance for edge A / B (r if that edge is convex &
// rounded, else 0 -> the contact line stays on the original edge).
bool solveContact(const V3& pCorner, const V3& eA, const V3& inA, double offA,
                  const V3& inB, double offB, V3& out) {
    // Offset line A: points q with dot(q - pCorner, inA) == offA, direction eA.
    // Offset line B: points q with dot(q - pCorner, inB) == offB, direction eB.
    // Solve in the face plane (2D) using basis (eA, inA).
    // Represent q = pCorner + u*eA + w*inA. Then:
    //   line A: w == offA.
    //   line B: dot(q - pCorner, inB) == offB
    //       => u*dot(eA,inB) + w*dot(inA,inB) == offB.
    const double a11 = dot(eA, inB);
    const double a12 = dot(inA, inB);
    if (std::fabs(a11) < 1e-14) return false;  // edges parallel: no intersection
    const double w = offA;
    const double u = (offB - w * a12) / a11;
    out = add(pCorner, add(mul(eA, u), mul(inA, w)));
    if (!finite3(out)) return false;
    return true;
}

} // namespace

void makeCubeSoupForFillet(double L, const mesh::Vec3& origin,
                           std::vector<double>& positions,
                           std::vector<std::uint32_t>& indices) {
    positions.clear();
    indices.clear();
    const double ox = origin.x, oy = origin.y, oz = origin.z;
    const double X = ox + L, Y = oy + L, Z = oz + L;
    // 8 corners.
    const double P[8][3] = {
        {ox, oy, oz}, {X, oy, oz}, {X, Y, oz}, {ox, Y, oz},
        {ox, oy, Z}, {X, oy, Z}, {X, Y, Z}, {ox, Y, Z}};
    for (auto& p : P) { positions.push_back(p[0]); positions.push_back(p[1]); positions.push_back(p[2]); }
    // 6 quad faces (CCW outward), each split into 2 triangles.
    const std::uint32_t Q[6][4] = {
        {0, 3, 2, 1},  // bottom  z = oz, outward -Z
        {4, 5, 6, 7},  // top     z = Z,  outward +Z
        {0, 1, 5, 4},  // front   y = oy, outward -Y
        {1, 2, 6, 5},  // right   x = X,  outward +X
        {2, 3, 7, 6},  // back    y = Y,  outward +Y
        {3, 0, 4, 7}}; // left    x = ox, outward -X
    for (auto& q : Q) {
        indices.push_back(q[0]); indices.push_back(q[1]); indices.push_back(q[2]);
        indices.push_back(q[0]); indices.push_back(q[2]); indices.push_back(q[3]);
    }
}

FilletResult filletConvexEdges(const std::vector<double>& positions,
                               const std::vector<std::uint32_t>& indices,
                               double r, std::uint32_t nSeg,
                               double thresholdDeg) {
    // ---- input screening ---------------------------------------------------
    if (!(r > 0.0) || !std::isfinite(r)) return fail("radius must be positive and finite");
    if (nSeg == 0) return fail("nSeg must be >= 1");
    if (!(thresholdDeg >= 0.0 && thresholdDeg <= 180.0)) return fail("threshold out of range [0,180]");
    if (positions.empty() || indices.empty()) return fail("empty soup");
    if (positions.size() % 3 != 0) return fail("positions length not a multiple of 3");
    if (indices.size() % 3 != 0) return fail("indices length not a multiple of 3");
    for (double p : positions) if (!std::isfinite(p)) return fail("non-finite vertex coordinate");

    // ---- build half-edge mesh + detect features (REUSE) --------------------
    HalfEdgeMesh in;
    if (!in.buildFromSoup(positions, indices))
        return fail("kernel could not build a closed 2-manifold from the soup");
    mesh::ValidityReport vr = in.validate();
    if (!vr.isValid()) return fail("input is not a closed 2-manifold");

    mesh::FeatureSet feat = mesh::detectFeatureEdges(in, thresholdDeg);
    if (!feat.ok) return fail("feature detection failed (boundary / non-manifold input)");

    const std::uint32_t nv = static_cast<std::uint32_t>(in.vertexCount());
    const std::uint32_t nf = static_cast<std::uint32_t>(in.faceCount());

    // ---- per-face records (vertices in CCW order + outward normal) ---------
    std::vector<FaceRec> faces(nf);
    {
        const auto& HE = in.halfEdges();
        const auto& F = in.faces();
        const auto& V = in.vertices();
        for (std::uint32_t f = 0; f < nf; ++f) {
            const std::uint32_t h0 = F[f].halfEdge;
            const std::uint32_t h1 = HE[h0].next;
            const std::uint32_t h2 = HE[h1].next;
            faces[f].v = {HE[h0].origin, HE[h1].origin, HE[h2].origin};
            const V3 a = toV3(V[faces[f].v[0]].position);
            const V3 b = toV3(V[faces[f].v[1]].position);
            const V3 c = toV3(V[faces[f].v[2]].position);
            const V3 n = cross(sub(b, a), sub(c, a));
            const double nl = norm(n);
            if (!(nl > 0.0)) return fail("degenerate (zero-area) face in input");
            faces[f].normal = mul(n, 1.0 / nl);
            faces[f].nIn = mul(faces[f].normal, -1.0);
        }
    }

    // ---- map undirected edge -> its two incident faces ---------------------
    struct EdgeFaces { std::uint32_t f0 = kInvalid, f1 = kInvalid; };
    std::unordered_map<std::uint64_t, EdgeFaces> edgeFaces;
    edgeFaces.reserve(nf * 3);
    for (std::uint32_t f = 0; f < nf; ++f) {
        const auto& v = faces[f].v;
        for (int e = 0; e < 3; ++e) {
            const std::uint64_t k = undirKey(v[e], v[(e + 1) % 3]);
            EdgeFaces& ef = edgeFaces[k];
            if (ef.f0 == kInvalid) ef.f0 = f; else ef.f1 = f;
        }
    }

    // ---- classify each SHARP edge convex/concave; collect convex set -------
    // Signed dihedral sign via orient3d: for edge (a,b) with the two adjacent
    // apexes pA (on face f0) and pB (on face f1), the edge is CONVEX when pB lies
    // BELOW the plane through (a,b,pA) on the outward side — equivalently when the
    // outward normals "open up". We use the robust orient3d sign of (a,b,pA,pB):
    // for a convex solid edge the fourth point is on the inner side.
    struct ConvexEdge {
        std::uint32_t v0 = kInvalid, v1 = kInvalid;  // v0<v1
        std::uint32_t f0 = kInvalid, f1 = kInvalid;
        double dihedralDeg = 0.0;
    };
    std::vector<ConvexEdge> convexEdges;
    std::unordered_set<std::uint64_t> convexKeySet;
    std::vector<FilletEdgeInfo> skipped;

    const auto& Vpos = in.vertices();
    auto apexOf = [&](std::uint32_t f, std::uint32_t a, std::uint32_t b) -> std::uint32_t {
        for (std::uint32_t vid : faces[f].v) if (vid != a && vid != b) return vid;
        return kInvalid;
    };

    for (const auto& fe : feat.edges) {
        if (!fe.feature) continue;
        if (fe.boundary) return fail("input has a boundary edge (open mesh)");
        const std::uint64_t k = undirKey(fe.v0, fe.v1);
        const EdgeFaces ef = edgeFaces[k];
        if (ef.f0 == kInvalid || ef.f1 == kInvalid)
            return fail("sharp edge is not shared by exactly two faces");
        const std::uint32_t apB = apexOf(ef.f1, fe.v0, fe.v1);
        if (apB == kInvalid) return fail("could not find edge apex");
        const V3 A = toV3(Vpos[fe.v0].position);
        const V3 B = toV3(Vpos[fe.v1].position);
        const V3 PB = toV3(Vpos[apB].position);
        // Convex test (direction-INDEPENDENT): does the apex of face1 lie on the
        // INNER side of face0's plane? Using face0's own CCW-outward winding,
        // orient3d(v0a,v0b,v0c, PB) is POSITIVE when PB is BELOW that plane (the
        // inner side, since CCW-outward => "above" is the outward half-space).
        // Convex => apex inside => POSITIVE; concave => apex outside => NEGATIVE;
        // coplanar (flat) => ZERO. This is robust (exact orient3d) and does not
        // depend on the arbitrary (v0,v1) endpoint ordering.
        const auto& f0v = faces[ef.f0].v;
        const V3 q0 = toV3(Vpos[f0v[0]].position);
        const V3 q1 = toV3(Vpos[f0v[1]].position);
        const V3 q2 = toV3(Vpos[f0v[2]].position);
        forge::native::Sign s = forge::native::orient3d(
            q0.x, q0.y, q0.z, q1.x, q1.y, q1.z, q2.x, q2.y, q2.z, PB.x, PB.y, PB.z);
        FilletEdgeInfo info;
        info.v0 = fe.v0; info.v1 = fe.v1;
        info.length = norm(sub(B, A));
        info.dihedralDeg = fe.dihedralDeg;
        if (s == forge::native::Sign::POSITIVE) {
            ConvexEdge ce;
            ce.v0 = fe.v0; ce.v1 = fe.v1; ce.f0 = ef.f0; ce.f1 = ef.f1;
            ce.dihedralDeg = fe.dihedralDeg;
            convexEdges.push_back(ce);
            convexKeySet.insert(k);
        } else {
            // Concave (or flat/degenerate-sharp) edge -> skipped, left sharp.
            skipped.push_back(info);
        }
    }

    if (convexEdges.empty())
        return fail("no convex sharp edges to fillet");

    // Diagnostic-preserving fail: when the op cannot complete (e.g. the input is
    // outside the validated convex-corner envelope), STILL surface the honest
    // concave-edge accounting so callers see that concave edges were detected and
    // skipped (not faked as rounded). ok stays false.
    auto failDiag = [&](const char* why) {
        FilletResult res;
        res.ok = false;
        res.reason = why;
        res.radius = r;
        res.nSeg = nSeg;
        res.numSkippedConcaveEdges = static_cast<std::uint32_t>(skipped.size());
        res.skippedConcaveEdges = skipped;
        return res;
    };

    // ======================================================================
    //  PLANAR REGION MERGING.
    //
    //  A real face of a box-like solid is split into several coplanar triangles
    //  (a square is 2). We MUST treat each maximal coplanar region as one face,
    //  or the contact-polygon offset at a shared boundary vertex disagrees across
    //  the internal diagonal and the flat top tears. We union triangles across
    //  every SMOOTH (non-feature) edge into regions, then extract each region's
    //  ordered boundary loop (its sequence of feature/convex boundary edges).
    // ======================================================================
    // Full FEATURE edge key set (every >threshold sharp edge — convex + concave).
    // A SMOOTH edge (not in this set) is an internal edge of a planar region.
    std::unordered_set<std::uint64_t> featureKeySet;
    for (const auto& fe : feat.edges)
        if (fe.feature) featureKeySet.insert(undirKey(fe.v0, fe.v1));
    auto edgeIsSmooth = [&](std::uint32_t a, std::uint32_t b) -> bool {
        return featureKeySet.count(undirKey(a, b)) == 0;
    };

    // Union-find over triangles, merging across smooth edges.
    std::vector<std::uint32_t> uf(nf);
    std::iota(uf.begin(), uf.end(), 0u);
    std::function<std::uint32_t(std::uint32_t)> find =
        [&](std::uint32_t x) { while (uf[x] != x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    auto unite = [&](std::uint32_t a, std::uint32_t b) { uf[find(a)] = find(b); };
    for (const auto& kv : edgeFaces) {
        const EdgeFaces& ef = kv.second;
        if (ef.f0 == kInvalid || ef.f1 == kInvalid) continue;
        // decode the key back to endpoints to test smoothness.
        const std::uint32_t lo = static_cast<std::uint32_t>(kv.first >> 32);
        const std::uint32_t hi = static_cast<std::uint32_t>(kv.first & 0xFFFFFFFFu);
        if (edgeIsSmooth(lo, hi)) unite(ef.f0, ef.f1);
    }
    // Compact region ids.
    std::unordered_map<std::uint32_t, std::uint32_t> regId;
    std::vector<std::uint32_t> regOf(nf);
    for (std::uint32_t f = 0; f < nf; ++f) {
        const std::uint32_t root = find(f);
        auto it = regId.find(root);
        if (it == regId.end()) { const std::uint32_t id = static_cast<std::uint32_t>(regId.size()); regId[root] = id; regOf[f] = id; }
        else regOf[f] = it->second;
    }
    const std::uint32_t nreg = static_cast<std::uint32_t>(regId.size());

    // Region normal (area-weighted; all triangles coplanar so they agree).
    std::vector<V3> regNormal(nreg, V3{0, 0, 0});
    std::vector<double> regArea(nreg, 0.0);
    for (std::uint32_t f = 0; f < nf; ++f) {
        const auto& fv = faces[f].v;
        const V3 a = toV3(Vpos[fv[0]].position), b = toV3(Vpos[fv[1]].position), c = toV3(Vpos[fv[2]].position);
        const V3 n = cross(sub(b, a), sub(c, a));
        regNormal[regOf[f]] = add(regNormal[regOf[f]], n);
        regArea[regOf[f]] += 0.5 * norm(n);
    }
    for (std::uint32_t g = 0; g < nreg; ++g) regNormal[g] = normalize(regNormal[g]);

    // Region boundary loop: ordered cycle of vertices around each region, walking
    // only FEATURE boundary edges (edges between two different regions). We build,
    // per region, a directed boundary half-edge adjacency: for each triangle in
    // the region, any edge whose opposite face is in a DIFFERENT region is a
    // boundary edge, directed CCW (as the triangle winds). Chain them into loops.
    // For the convex box envelope each region has exactly ONE boundary loop.
    struct RegBoundary {
        std::vector<std::uint32_t> loop;   // ordered vertices, CCW about regNormal
        bool simple = false;               // single closed loop found
    };
    std::vector<RegBoundary> regBound(nreg);
    {
        // directed boundary edge a->b within each region; next[a] = b.
        std::vector<std::unordered_map<std::uint32_t, std::uint32_t>> nextMap(nreg);
        std::vector<int> loopCount(nreg, 0);
        for (std::uint32_t f = 0; f < nf; ++f) {
            const std::uint32_t g = regOf[f];
            const auto& fv = faces[f].v;
            for (int e = 0; e < 3; ++e) {
                const std::uint32_t a = fv[e], b = fv[(e + 1) % 3];
                const EdgeFaces ef = edgeFaces[undirKey(a, b)];
                const std::uint32_t other = (ef.f0 == f) ? ef.f1 : ef.f0;
                if (other == kInvalid) continue;
                if (regOf[other] != g) {        // boundary edge of the region
                    nextMap[g][a] = b;          // directed a->b (CCW)
                    loopCount[g]++;
                }
            }
        }
        for (std::uint32_t g = 0; g < nreg; ++g) {
            auto& nm = nextMap[g];
            if (nm.empty()) { regBound[g].simple = false; continue; }
            // Walk from an arbitrary start; require a single full cycle.
            const std::uint32_t start = nm.begin()->first;
            std::vector<std::uint32_t> loop;
            std::uint32_t cur = start;
            std::unordered_set<std::uint32_t> seen;
            bool ok = true;
            for (std::size_t guard = 0; guard <= nm.size() + 1; ++guard) {
                loop.push_back(cur);
                if (seen.count(cur)) { ok = false; break; }
                seen.insert(cur);
                auto it = nm.find(cur);
                if (it == nm.end()) { ok = false; break; }
                cur = it->second;
                if (cur == start) break;
            }
            if (ok && cur == start && loop.size() == nm.size()) {
                regBound[g].loop = std::move(loop);
                regBound[g].simple = true;
            } else {
                regBound[g].simple = false;
            }
        }
    }

    // Map (region, vertex) -> position in that region's boundary loop.
    std::vector<std::unordered_map<std::uint32_t, std::uint32_t>> regVertPos(nreg);
    for (std::uint32_t g = 0; g < nreg; ++g)
        for (std::uint32_t i = 0; i < regBound[g].loop.size(); ++i)
            regVertPos[g][regBound[g].loop[i]] = i;

    // Regions incident at a vertex (replaces face incidence for corner solves).
    std::vector<std::vector<std::uint32_t>> vRegions(nv);
    for (std::uint32_t g = 0; g < nreg; ++g)
        for (std::uint32_t vv : regBound[g].loop)
            if (std::find(vRegions[vv].begin(), vRegions[vv].end(), g) == vRegions[vv].end())
                vRegions[vv].push_back(g);

    // ======================================================================
    //  ASSEMBLY (index-shared rolling-ball topology).
    //
    //  The output is built so that every vertex shared between a flat top, a
    //  fillet strip and a corner sphere patch is the SAME welded vertex — there
    //  is no tolerance guesswork at the seams. The geometry is:
    //
    //    * Each ORIGINAL vertex v that is a 3-edge / 3-face CONVEX CORNER gets a
    //      rolling-ball sphere centre C_v (distance r from its 3 face planes) and
    //      a spherical-octant PATCH. The patch is bounded by 3 quarter-arcs, one
    //      per incident convex edge, each arc subdivided into nSeg points lying on
    //      the sphere — these arc points are SHARED with the adjacent strip.
    //    * Each CONVEX EDGE (v0,v1) gets a cylinder STRIP. The strip runs along
    //      the edge between the two CUT points (a distance r in from each endpoint
    //      that is a corner), so its two end rings coincide exactly with the two
    //      corner patches' boundary arcs. nSeg arc points across, 1 quad ring
    //      along (the two cut rings).
    //    * Each FACE gets a flat-top contact polygon: the original face shrunk so
    //      every convex edge is offset r inward; its corner vertices are the SAME
    //      points T(f,v) that the corner patches and strips reference.
    //
    //  Everything is keyed by (semantic id -> welded index) so the soup closes.
    // ======================================================================

    // Geometric tolerance to reject an over-large r before building overlap.
    // For a unit-cube face the two opposite contact lines collide at r == L/2;
    // we detect this generally below by checking each face's shrunk contact
    // polygon stays correctly wound (positive area, same normal). The strict
    // check is done per face when we build the flat tops.

    auto edgeIsConvex = [&](std::uint32_t a, std::uint32_t b) -> bool {
        return convexKeySet.count(undirKey(a, b)) != 0;
    };

    // incident convex edges per vertex (list of indices into convexEdges).
    std::vector<std::vector<std::uint32_t>> vConvex(nv);
    for (std::uint32_t i = 0; i < convexEdges.size(); ++i) {
        vConvex[convexEdges[i].v0].push_back(i);
        vConvex[convexEdges[i].v1].push_back(i);
    }
    // A vertex is a ROUNDED CORNER iff it lies on exactly 3 planar regions and has
    // exactly 3 incident convex edges (the canonical convex corner this envelope
    // handles — e.g. a cube vertex). The sphere centre is r from the 3 region
    // planes on their inner side.
    std::vector<bool> isCorner(nv, false);
    std::vector<V3>   cornerCentre(nv);     // sphere centre C_v (valid if isCorner)
    for (std::uint32_t v = 0; v < nv; ++v) {
        if (vConvex[v].size() != 3 || vRegions[v].size() != 3) continue;
        const V3 P = toV3(Vpos[v].position);
        const V3 n0 = regNormal[vRegions[v][0]];
        const V3 n1 = regNormal[vRegions[v][1]];
        const V3 n2 = regNormal[vRegions[v][2]];
        // Solve [n0;n1;n2] C = (n.P - r). Columns for Cramer:
        const V3 col0{n0.x, n1.x, n2.x};
        const V3 col1{n0.y, n1.y, n2.y};
        const V3 col2{n0.z, n1.z, n2.z};
        const V3 rhs{dot(n0, P) - r, dot(n1, P) - r, dot(n2, P) - r};
        auto det3 = [](const V3& a, const V3& b, const V3& c) {
            return a.x * (b.y * c.z - b.z * c.y) -
                   a.y * (b.x * c.z - b.z * c.x) +
                   a.z * (b.x * c.y - b.y * c.x);
        };
        const double D = det3(col0, col1, col2);
        if (std::fabs(D) < 1e-12) continue;
        const V3 C{det3(rhs, col1, col2) / D,
                   det3(col0, rhs, col2) / D,
                   det3(col0, col1, rhs) / D};
        if (!finite3(C)) continue;
        isCorner[v] = true;
        cornerCentre[v] = C;
    }

    // --- flat-top contact corner T(g,v): region g shrunk at boundary vertex v --
    // Using region g's boundary loop, take the two boundary edges incident to v
    // (prev->v and v->next), offset each inward by r if convex (else 0), and
    // intersect the offset lines in the region plane. Returns false if degenerate
    // (parallel / r too large so the offset lines miss inside the region).
    auto contactCorner = [&](std::uint32_t g, std::uint32_t v, V3& out) -> bool {
        const auto& loop = regBound[g].loop;
        auto itp = regVertPos[g].find(v);
        if (itp == regVertPos[g].end()) return false;
        const std::uint32_t i = itp->second;
        const std::uint32_t L = static_cast<std::uint32_t>(loop.size());
        if (L < 3) return false;
        const std::uint32_t vn = loop[(i + 1) % L];          // next boundary vertex
        const std::uint32_t vp = loop[(i + L - 1) % L];      // prev boundary vertex
        const V3 corner = toV3(Vpos[v].position);
        const V3 Pn = toV3(Vpos[vn].position);
        const V3 Pp = toV3(Vpos[vp].position);
        const V3& nrm = regNormal[g];
        // edge A: corner -> next ; edge B: corner -> prev (both in region plane).
        const V3 eA = normalize(sub(Pn, corner));
        const V3 eB = normalize(sub(Pp, corner));
        V3 inA = normalize(cross(nrm, eA));
        if (dot(inA, sub(Pp, corner)) < 0.0) inA = mul(inA, -1.0);
        V3 inB = normalize(cross(eB, nrm));
        if (dot(inB, sub(Pn, corner)) < 0.0) inB = mul(inB, -1.0);
        const double offA = edgeIsConvex(v, vn) ? r : 0.0;
        const double offB = edgeIsConvex(v, vp) ? r : 0.0;
        return solveContact(corner, eA, inA, offA, inB, offB, out);
    };

    // --- output soup + welder ----------------------------------------------
    // All shared seam vertices are produced by IDENTICAL formulas (the strip and
    // the corner patch both evaluate the same sphere/cylinder arc), so a tight
    // weld coalesces them exactly. Tolerance scaled to the model size (r).
    VertexWelder W(std::max(1e-9, r * 1e-6));
    std::vector<std::uint32_t> outIdx;

    auto idxOf = [&](const V3& p) { return W.insert(p); };
    auto emitTriI = [&](std::uint32_t a, std::uint32_t b, std::uint32_t c) {
        if (a == b || b == c || a == c) return;
        outIdx.push_back(a); outIdx.push_back(b); outIdx.push_back(c);
    };

    // Solid centroid (mean of input vertices) — strictly INTERIOR for the convex
    // box-like envelope. Every emitted triangle is oriented so its outward normal
    // points AWAY from this centroid, giving ONE globally-consistent winding at
    // every seam (strip<->patch<->top) without per-piece guesswork. (For a convex
    // solid this is exact; a strongly non-convex solid is outside the validated
    // envelope and is surfaced by the final 2-manifold validate().)
    V3 centroid{0, 0, 0};
    for (std::uint32_t v = 0; v < nv; ++v) centroid = add(centroid, toV3(Vpos[v].position));
    centroid = mul(centroid, 1.0 / static_cast<double>(nv));
    auto emitOriented = [&](std::uint32_t a, std::uint32_t b, std::uint32_t c) {
        if (a == b || b == c || a == c) return;
        const V3 pa{W.pos[3 * a], W.pos[3 * a + 1], W.pos[3 * a + 2]};
        const V3 pb{W.pos[3 * b], W.pos[3 * b + 1], W.pos[3 * b + 2]};
        const V3 pc{W.pos[3 * c], W.pos[3 * c + 1], W.pos[3 * c + 2]};
        const V3 n = cross(sub(pb, pa), sub(pc, pa));
        const V3 outward = sub(mul(add(add(pa, pb), pc), 1.0 / 3.0), centroid);
        if (dot(n, outward) >= 0.0) emitTriI(a, b, c);
        else                        emitTriI(a, c, b);
    };

    // region adjacent to a convex edge on each side (f0/f1 -> their regions).
    auto regionOfEdgeFace = [&](std::uint32_t ei, int side) -> std::uint32_t {
        const ConvexEdge& ce = convexEdges[ei];
        return regOf[side == 0 ? ce.f0 : ce.f1];
    };

    // ---- CANONICAL equal-angle arc on the sphere about C -------------------
    // Returns nSeg+1 points sweeping from unit dir d0 to unit dir d1 by equal
    // angle (cos/sin in the (d0,e2) orthonormal basis), each at radius r about C.
    // Used IDENTICALLY by both the strip end ring and the corner patch boundary,
    // so the shared seam welds exactly.
    auto sphereArc = [&](const V3& C, V3 d0, V3 d1, std::vector<V3>& arc) -> bool {
        arc.clear();
        const double l0 = norm(d0), l1 = norm(d1);
        if (!(l0 > 0.0) || !(l1 > 0.0)) return false;
        d0 = mul(d0, 1.0 / l0);
        d1 = mul(d1, 1.0 / l1);
        const double arcAng = std::atan2(norm(cross(d0, d1)), dot(d0, d1));
        if (!(arcAng > 0.0)) return false;
        V3 e2 = sub(d1, mul(d0, dot(d0, d1)));
        const double e2n = norm(e2);
        if (!(e2n > 0.0)) return false;
        e2 = mul(e2, 1.0 / e2n);
        for (std::uint32_t k = 0; k <= nSeg; ++k) {
            const double a = arcAng * (static_cast<double>(k) / static_cast<double>(nSeg));
            const V3 dir = add(mul(d0, std::cos(a)), mul(e2, std::sin(a)));
            arc.push_back(add(C, mul(dir, r)));
        }
        return true;
    };

    // ---- CANONICAL region-pair arc at corner v between regions ga,gb. Always
    // sweeps from the SMALLER region id's contact corner to the larger's, so the
    // corner sphere patch and the adjacent strip — which both call this with the
    // same {ga,gb} — produce IDENTICAL points and the seam welds exactly. The
    // returned `flipped` flag tells the caller whether ga>gb (i.e. the arc runs
    // gb->ga) so it can re-orient its own indexing.
    auto regionPairArc = [&](std::uint32_t v, std::uint32_t ga, std::uint32_t gb,
                             std::vector<V3>& arc, bool& flipped) -> bool {
        flipped = (ga > gb);
        const std::uint32_t lo = flipped ? gb : ga;
        const std::uint32_t hi = flipped ? ga : gb;
        const V3 C = cornerCentre[v];
        V3 Tlo, Thi;
        if (!contactCorner(lo, v, Tlo)) return false;
        if (!contactCorner(hi, v, Thi)) return false;
        return sphereArc(C, sub(Tlo, C), sub(Thi, C), arc);
    };
    // Strip end ring at corner v for edge ei: region(f0)->region(f1) order, but
    // sampled via the canonical region-pair arc (reversed if needed).
    auto cornerEdgeArc = [&](std::uint32_t v, std::uint32_t ei,
                             std::vector<V3>& arc) -> bool {
        const std::uint32_t g0 = regionOfEdgeFace(ei, 0);
        const std::uint32_t g1 = regionOfEdgeFace(ei, 1);
        bool flipped = false;
        if (!regionPairArc(v, g0, g1, arc, flipped)) return false;
        if (flipped) std::reverse(arc.begin(), arc.end());   // make it g0->g1
        return true;
    };

    std::vector<FilletEdgeInfo> roundedInfo;
    double totalConvexLen = 0.0;

    // ---- (a) CORNER PATCHES: spherical-octant tessellation -----------------
    // For corner v with sphere centre C and its 3 incident convex edges, the
    // patch is the spherical triangle whose 3 corner directions are the 3 contact
    // corners' directions D0,D1,D2 and whose 3 boundary edges ARE the 3 strip
    // arcs (cornerEdgeArc), so the seam welds to the strips exactly. We build a
    // triangular grid P(i,j), i+j<=M: the 3 boundaries take their points straight
    // from the arcs; interior points are a normalized barycentric blend of D.
    {
        for (std::uint32_t v = 0; v < nv; ++v) {
            if (!isCorner[v]) continue;
            const V3 C = cornerCentre[v];
            // The 3 incident convex edges of this corner, and the region on each
            // side that touches v. We order corners (D0,D1,D2) and build the 3
            // boundary arcs between consecutive corners using the SAME sphereArc
            // the strips use, so welds line up.
            const auto& es = vConvex[v];                  // exactly 3 (isCorner)
            if (es.size() != 3) continue;
            // The 3 regions at v (each between two of the 3 edges).
            const auto& regs = vRegions[v];               // exactly 3
            std::array<V3, 3> T, D;
            bool okT = true;
            for (int i = 0; i < 3; ++i) okT = okT && contactCorner(regs[i], v, T[i]);
            if (!okT) return fail("corner contact unsolvable (r too large at a corner)");
            for (int i = 0; i < 3; ++i) {
                D[i] = sub(T[i], C);
                const double l = norm(D[i]);
                if (!(l > 0.0)) return fail("degenerate corner radius");
                D[i] = mul(D[i], 1.0 / l);
            }
            const std::uint32_t M = nSeg;
            // The 3 boundary arcs between region corners, taken from the CANONICAL
            // region-pair arc so they are bit-identical to the adjacent strips'
            // end rings. arcAB runs regs[A] -> regs[B].
            auto boundaryArc = [&](int A, int B, std::vector<V3>& out) -> bool {
                bool fl = false;
                if (!regionPairArc(v, regs[A], regs[B], out, fl)) return false;
                if (fl) std::reverse(out.begin(), out.end());  // ensure regs[A]->regs[B]
                return true;
            };
            std::vector<V3> arc01, arc12, arc20;
            if (!boundaryArc(0, 1, arc01)) return fail("corner arc 01 degenerate");
            if (!boundaryArc(1, 2, arc12)) return fail("corner arc 12 degenerate");
            if (!boundaryArc(2, 0, arc20)) return fail("corner arc 20 degenerate");
            // Ordered boundary LOOP of the spherical-triangle patch, on the sphere:
            //   arc01[0..M] then arc12[1..M] then arc20[1..M-1]
            // (each corner appears once; the loop closes back to arc01[0]==arc20[M]).
            // These boundary points are bit-identical to the adjacent strips' end
            // rings (same regionPairArc), so the seam welds exactly.
            std::vector<V3> bnd;
            for (std::uint32_t k = 0; k <= M; ++k) bnd.push_back(arc01[k]);
            for (std::uint32_t k = 1; k <= M; ++k) bnd.push_back(arc12[k]);
            for (std::uint32_t k = 1; k < M;  ++k) bnd.push_back(arc20[k]);
            const std::uint32_t Bn = static_cast<std::uint32_t>(bnd.size());  // == 3*M
            // Concentric rings from the boundary toward the apex (sphere point in
            // the direction of the patch centroid), so the patch is a smooth fan
            // and refines with nSeg. Ring t (t=0 boundary .. t=M-1 near apex):
            // blend each boundary direction toward the apex direction by t/M, then
            // re-project to the sphere. The apex (t=M) is a single point.
            const V3 apexDir = normalize(add(add(D[0], D[1]), D[2]));
            auto ringDir = [&](std::uint32_t t, std::uint32_t b) -> V3 {
                const double s = static_cast<double>(t) / static_cast<double>(M);
                const V3 bd = normalize(sub(bnd[b], C));
                return normalize(add(mul(bd, 1.0 - s), mul(apexDir, s)));
            };
            auto ringPt = [&](std::uint32_t t, std::uint32_t b) {
                return idxOf(add(C, mul(ringDir(t, b), r)));
            };
            // Stitch rings 0..M-1 (each has Bn points) as quad bands; the last band
            // (t=M-1 -> apex) is a triangle fan to the single apex vertex.
            const std::uint32_t apex = idxOf(add(C, mul(apexDir, r)));
            for (std::uint32_t t = 0; t + 1 < M; ++t) {
                for (std::uint32_t b = 0; b < Bn; ++b) {
                    const std::uint32_t a0 = ringPt(t, b);
                    const std::uint32_t a1 = ringPt(t, (b + 1) % Bn);
                    const std::uint32_t b0 = ringPt(t + 1, b);
                    const std::uint32_t b1 = ringPt(t + 1, (b + 1) % Bn);
                    emitOriented(a0, a1, b1);
                    emitOriented(a0, b1, b0);
                }
            }
            // innermost band -> apex fan.
            const std::uint32_t tlast = M - 1;
            for (std::uint32_t b = 0; b < Bn; ++b) {
                const std::uint32_t a0 = ringPt(tlast, b);
                const std::uint32_t a1 = ringPt(tlast, (b + 1) % Bn);
                emitOriented(a0, a1, apex);
            }
        }
    }

    // ---- (b) FILLET STRIPS along each convex edge --------------------------
    // The strip's two end rings are the corner arcs cornerEdgeArc(v0,ei) and
    // cornerEdgeArc(v1,ei) — both ordered region(f0)->region(f1), and both shared
    // (bit-identical, via the canonical region-pair arc) with the adjacent corner
    // sphere patches. We stitch the two rings into nSeg quad rings. (This envelope
    // requires BOTH endpoints to be rounded corners — a non-corner convex vertex
    // is outside the validated envelope and surfaced via the final validate().)
    for (std::uint32_t ei = 0; ei < convexEdges.size(); ++ei) {
        const ConvexEdge& ce = convexEdges[ei];
        const V3 A = toV3(Vpos[ce.v0].position);
        const V3 B = toV3(Vpos[ce.v1].position);
        if (!isCorner[ce.v0] || !isCorner[ce.v1])
            return failDiag("convex edge endpoint is not a 3-region corner (outside envelope)");

        std::vector<V3> ring0, ring1;
        if (!cornerEdgeArc(ce.v0, ei, ring0)) return fail("corner arc unsolvable at v0");
        if (!cornerEdgeArc(ce.v1, ei, ring1)) return fail("corner arc unsolvable at v1");
        if (ring0.size() != ring1.size() || ring0.size() != nSeg + 1)
            return fail("strip ring size mismatch");

        // Index both rings (shared welds with the corner patches).
        std::vector<std::uint32_t> i0(ring0.size()), i1(ring1.size());
        for (std::size_t k = 0; k < ring0.size(); ++k) i0[k] = idxOf(ring0[k]);
        for (std::size_t k = 0; k < ring1.size(); ++k) i1[k] = idxOf(ring1[k]);

        for (std::uint32_t k = 0; k < nSeg; ++k) {
            emitOriented(i0[k], i0[k + 1], i1[k]);
            emitOriented(i0[k + 1], i1[k + 1], i1[k]);
        }

        FilletEdgeInfo ri;
        ri.v0 = ce.v0; ri.v1 = ce.v1; ri.length = norm(sub(B, A)); ri.dihedralDeg = ce.dihedralDeg;
        roundedInfo.push_back(ri);
        totalConvexLen += ri.length;
    }

    // ---- (c) FLAT TOPS: shrink each region to its contact polygon ----------
    // For each planar region, the contact polygon is its boundary loop with every
    // vertex pulled to its contact corner T(region,v). It is planar and convex for
    // the box envelope, so a triangle fan from vertex 0 is valid. Reject the whole
    // op if the contact polygon inverts (r too large -> the region collapses).
    for (std::uint32_t g = 0; g < nreg; ++g) {
        if (!regBound[g].simple) return fail("region boundary loop not simple (unsupported topology)");
        const auto& loop = regBound[g].loop;
        const std::uint32_t L = static_cast<std::uint32_t>(loop.size());
        if (L < 3) return fail("region boundary too small");
        std::vector<V3> T(L);
        for (std::uint32_t i = 0; i < L; ++i)
            if (!contactCorner(g, loop[i], T[i]))
                return fail("region contact polygon unsolvable (r too large)");
        // Verify the shrunk polygon keeps the region's orientation (no inversion):
        // its Newell normal must face the same way as the region normal, and every
        // fan triangle must be non-degenerate and same-facing.
        const V3& nrmOrig = regNormal[g];
        // Newell area vector of the contact loop.
        V3 area{0, 0, 0};
        for (std::uint32_t i = 0; i < L; ++i) area = add(area, cross(T[i], T[(i + 1) % L]));
        if (dot(area, nrmOrig) <= 0.0)
            return fail("contact polygon inverted (r too large for a region)");
        // Fan-triangulate from vertex 0 (orientation by the global centroid rule).
        const std::uint32_t a0 = idxOf(T[0]);
        for (std::uint32_t i = 1; i + 1 < L; ++i) {
            const std::uint32_t bi = idxOf(T[i]), ci = idxOf(T[i + 1]);
            emitOriented(a0, bi, ci);
        }
    }

    // ---- build + validate the emitted solid --------------------------------
    if (outIdx.empty()) return fail("no geometry emitted");

    HalfEdgeMesh out;
    if (!out.buildFromSoup(W.pos, outIdx))
        return fail("filleted soup did not build into a manifold half-edge mesh");
    mesh::ValidityReport ovr = out.validate();
    if (!ovr.isValid())
        return fail("filleted result is not a closed 2-manifold (envelope exceeded)");

    // ---- success: fill the result -------------------------------------------
    FilletResult res;
    res.ok = true;
    res.reason = "";
    res.mesh = std::move(out);
    res.radius = r;
    res.nSeg = nSeg;
    res.numConvexEdgesRounded = static_cast<std::uint32_t>(roundedInfo.size());
    res.numSkippedConcaveEdges = static_cast<std::uint32_t>(skipped.size());
    res.roundedEdges = std::move(roundedInfo);
    res.skippedConcaveEdges = std::move(skipped);
    res.totalConvexEdgeLength = totalConvexLen;
    res.inputVolume = std::fabs(in.signedVolume());
    res.outputVolume = std::fabs(res.mesh.signedVolume());
    res.analyticTargetVolume =
        res.inputVolume - (1.0 - kPi / 4.0) * r * r * totalConvexLen;
    return res;
}

} // namespace brep
} // namespace native
} // namespace forge
