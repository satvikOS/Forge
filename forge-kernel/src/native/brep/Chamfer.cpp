// forge/native/brep/Chamfer.cpp
//
// Implementation of forge::native::brep::chamferEdges — a MESH edge chamfer on
// the in-house half-edge triangle mesh. Pure C++20, standard library only. See
// Chamfer.hpp for the full specification and the honest validated envelope.
//
// METHOD (vertex-split + face-offset chamfer):
//   * Build the half-edge mesh; require a closed 2-manifold (validate()).
//   * Detect sharp feature edges by dihedral angle (reuse detectFeatureEdges),
//     then keep only the CONVEX ones (the surface folds outward across them).
//   * For every (face f, corner vertex v) pair, emit ONE new vertex displaced
//     from v, in the plane of f, inward by `d` away from each CHAMFERED edge of
//     f incident to v (the two in-face edges at v). This single shared vertex is
//     reused by: the shrunk face f, the two chamfer facets of f's chamfered
//     edges at v, and the corner fan at v — which is what keeps the result
//     watertight and 2-manifold.
//   * Emit shrunk original faces, one chamfer quad (2 tris) per chamfered edge,
//     and one corner fan per original vertex whose incident faces were trimmed.
//   * Rebuild the soup and re-validate; ok==true only if it is a valid closed
//     2-manifold (never fake a broken solid).

#include "forge/native/brep/Chamfer.hpp"

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/AABBTree.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#include "forge/native/mesh/FeatureEdges.hpp"
#include "forge/native/mesh/TriTriIntersect.hpp"

#include <algorithm>      // std::sort, std::min, std::max
#include <array>          // std::array
#include <cmath>          // std::sqrt, std::fabs, std::isfinite, std::llround
#include <cstddef>        // std::size_t
#include <cstdint>        // std::uint32_t, std::uint64_t
#include <cstring>        // std::memcpy (CI-portability include)
#include <functional>     // std::function, std::greater
#include <limits>         // std::numeric_limits
#include <map>            // std::map
#include <numeric>        // std::accumulate (CI-portability include)
#include <queue>          // std::queue (CI-portability include)
#include <set>            // std::set
#include <string>         // std::string
#include <unordered_map>  // std::unordered_map
#include <unordered_set>  // std::unordered_set
#include <utility>        // std::move
#include <vector>         // std::vector

namespace forge {
namespace native {
namespace brep {

namespace {

using mesh::HalfEdge;
using mesh::HalfEdgeMesh;
using Vec3 = ::forge::native::mesh::Vec3;   // disambiguate from brep::Vec3 (Nurbs.hpp)
using mesh::Vertex;
using mesh::Face;
using mesh::kInvalid;

// ---- local 3-vector helpers (do not leak into the public API) ---------------
struct V3 {
    double x{0.0}, y{0.0}, z{0.0};
};
inline V3 toV3(const Vec3& v) { return V3{v.x, v.y, v.z}; }
inline V3 add(const V3& a, const V3& b) { return V3{a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 sub(const V3& a, const V3& b) { return V3{a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 scale(const V3& a, double s) { return V3{a.x * s, a.y * s, a.z * s}; }
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

ChamferResult fail(const char* why) {
    ChamferResult r;
    r.ok = false;
    r.reason = why;
    return r;
}

// Pack an unordered vertex pair into a single 64-bit key (lo<<32 | hi).
inline std::uint64_t undirKey(std::uint32_t a, std::uint32_t b) {
    std::uint32_t lo = a < b ? a : b;
    std::uint32_t hi = a < b ? b : a;
    return (static_cast<std::uint64_t>(lo) << 32) | static_cast<std::uint64_t>(hi);
}

} // namespace

ChamferResult chamferEdges(const mesh::HalfEdgeMesh& mesh,
                           double d,
                           double angleThresholdDeg) {
    ChamferResult R;
    R.angleThresholdDeg = angleThresholdDeg;
    R.setback = d;

    const std::vector<Vertex>&   V  = mesh.vertices();
    const std::vector<HalfEdge>& HE = mesh.halfEdges();
    const std::vector<Face>&     F  = mesh.faces();

    const std::uint32_t nv = static_cast<std::uint32_t>(V.size());
    const std::uint32_t nf = static_cast<std::uint32_t>(F.size());
    R.inputVertices = nv;
    R.inputFaces = nf;

    if (!(angleThresholdDeg >= 0.0 && angleThresholdDeg <= 180.0))
        return fail("angle threshold out of range [0,180]");
    if (nv == 0 || nf == 0 || HE.empty()) return fail("empty mesh");

    // ---- the input must be a closed, watertight 2-manifold ------------------
    const mesh::ValidityReport vr = mesh.validate();
    if (!vr.isValid())
        return fail("input is not a closed 2-manifold (validate().isValid() failed)");

    // Finite coordinates + cache the per-face OUTWARD normal (un-normalised).
    std::vector<V3> faceNormal(nf);
    for (std::uint32_t f = 0; f < nf; ++f) {
        if (F[f].halfEdge == kInvalid) return fail("face has no half-edge");
        const HalfEdge& h0 = HE[F[f].halfEdge];
        const HalfEdge& h1 = HE[h0.next];
        const HalfEdge& h2 = HE[h1.next];
        const V3 a = toV3(V[h0.origin].position);
        const V3 b = toV3(V[h1.origin].position);
        const V3 c = toV3(V[h2.origin].position);
        if (!finite3(a) || !finite3(b) || !finite3(c))
            return fail("non-finite vertex coordinate");
        const V3 n = cross(sub(b, a), sub(c, a));
        const double nlen = norm(n);
        if (!(nlen > 0.0) || !std::isfinite(nlen))
            return fail("zero-area (degenerate) triangle");
        faceNormal[f] = n;
    }

    R.inputVolume = mesh.signedVolume();

    // ---- shortest mesh edge + the setback admissibility limit ---------------
    double shortest = std::numeric_limits<double>::infinity();
    for (std::uint32_t h = 0; h < HE.size(); ++h) {
        const std::uint32_t a = HE[h].origin;
        const std::uint32_t b = HE[HE[h].next].origin;
        if (a >= nv || b >= nv) return fail("half-edge endpoint out of range");
        const double L = norm(sub(toV3(V[b].position), toV3(V[a].position)));
        if (!(L > 0.0)) return fail("zero-length edge");
        shortest = std::min(shortest, L);
    }
    R.shortestEdge = shortest;

    if (!(d > 0.0)) return fail("setback d must be > 0");
    // d larger than half the shortest edge would collapse / overrun a face.
    if (!(d < 0.5 * shortest))
        return fail("setback d >= half the shortest edge (would collapse/overrun)");

    // ---- sharp feature edges by dihedral angle (reuse the detector) ---------
    const mesh::FeatureSet fs = mesh::detectFeatureEdges(mesh, angleThresholdDeg);
    if (!fs.ok) return fail(fs.reason);

    // Determine, per undirected edge {a,b}: is it a CHAMFERED edge (sharp AND
    // convex)? Convexity: the edge is convex when, moving from face0 to face1,
    // the surface folds outward. With outward face normals n0,n1 and the edge
    // direction e (a->b on face0's CCW loop), the signed turn
    //   s = (n0 x n1) . e
    // is > 0 for a convex ridge and < 0 for a concave valley (this is the same
    // convention TriTriIntersect/Repair use; an exact-in-double reflex test).
    //
    // We need, per undirected edge, both incident faces and the two half-edges.
    struct EdgeInfo {
        std::uint32_t v0 = kInvalid, v1 = kInvalid;   // lo,hi endpoints
        std::uint32_t he0 = kInvalid, he1 = kInvalid; // the two directed half-edges
        std::uint32_t f0 = kInvalid, f1 = kInvalid;
        bool sharp = false;
        bool chamfered = false;   // sharp AND convex
    };
    std::unordered_map<std::uint64_t, EdgeInfo> emap;
    emap.reserve(HE.size());
    for (std::uint32_t h = 0; h < HE.size(); ++h) {
        const std::uint32_t a = HE[h].origin;
        const std::uint32_t b = HE[HE[h].next].origin;
        const std::uint64_t key = undirKey(a, b);
        EdgeInfo& e = emap[key];
        if (e.he0 == kInvalid) {
            e.v0 = a < b ? a : b;
            e.v1 = a < b ? b : a;
            e.he0 = h;
            e.f0 = HE[h].face;
        } else if (e.he1 == kInvalid) {
            e.he1 = h;
            e.f1 = HE[h].face;
        } else {
            return fail("non-manifold edge (>2 incident faces)");
        }
    }

    // Map the detector's per-edge sharpness onto our edge map, and decide
    // convexity exactly-in-double.
    for (const mesh::FeatureEdge& fe : fs.edges) {
        if (fe.boundary) return fail("input has a boundary edge (not closed)");
        const std::uint64_t key = undirKey(fe.v0, fe.v1);
        auto it = emap.find(key);
        if (it == emap.end()) return fail("feature edge missing from edge map");
        EdgeInfo& e = it->second;
        e.sharp = fe.feature;
        if (!fe.feature) continue;
        ++R.numSharpEdges;

        // Convexity sign s = (n0 x n1) . e_dir, with e_dir along he0 (a->b).
        const std::uint32_t a = HE[e.he0].origin;
        const std::uint32_t b = HE[HE[e.he0].next].origin;
        const V3 edir = sub(toV3(V[b].position), toV3(V[a].position));
        const V3& n0 = faceNormal[e.f0];
        const V3& n1 = faceNormal[e.f1];
        const double s = dot(cross(n0, n1), edir);
        e.chamfered = (s > 0.0);   // strictly convex ridge
        if (e.chamfered) ++R.numChamferedEdges;
    }

    // No sharp convex edges -> faithful no-op (return the mesh unchanged).
    if (R.numChamferedEdges == 0) {
        R.mesh = mesh;
        R.outputVertices = nv;
        R.outputFaces = nf;
        R.outputVolume = R.inputVolume;
        R.removedVolume = 0.0;
        R.ok = true;
        R.reason = "ok (no sharp convex edges; mesh unchanged)";
        return R;
    }

    // Helper: edge classification by undirected key.
    auto edgeChamfered = [&](std::uint32_t a, std::uint32_t b) -> bool {
        auto it = emap.find(undirKey(a, b));
        return it != emap.end() && it->second.chamfered;
    };

    // ---- planar FACE-GROUPS (coplanar connected triangles) ------------------
    // A flat input face is several coplanar triangles meeting across NON-sharp
    // (coplanar) interior edges. Those triangles must be trimmed and re-stitched
    // as ONE polygon, sharing a SINGLE offset vertex per corner — otherwise the
    // hidden diagonal would (a) miss a chamfered polygon-edge behind it and (b)
    // split the corner. We union triangles across every non-sharp manifold edge.
    const std::size_t nhe = HE.size();
    std::vector<std::uint32_t> parent(nf);
    for (std::uint32_t f = 0; f < nf; ++f) parent[f] = f;
    std::function<std::uint32_t(std::uint32_t)> findRoot =
        [&](std::uint32_t x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    auto unite = [&](std::uint32_t a, std::uint32_t b) {
        a = findRoot(a); b = findRoot(b); if (a != b) parent[a] = b;
    };
    for (auto& kv : emap) {
        const EdgeInfo& e = kv.second;
        if (e.f1 == kInvalid) continue;        // (defensive; closed mesh has both)
        if (!e.sharp) unite(e.f0, e.f1);       // coplanar interior edge -> same group
    }

    // ---- per (group, corner-vertex) new offset vertex -----------------------
    // The offset of vertex v on planar group g trims v IN g's PLANE inward by d
    // away from EVERY chamfered group-boundary (sharp) edge of g incident to v.
    // All triangles of g at v share this one offset vertex.
    std::vector<double> outPos;
    outPos.reserve((nhe + nv) * 3);
    auto pushVertex = [&](const V3& p) -> std::uint32_t {
        const std::uint32_t id = static_cast<std::uint32_t>(outPos.size() / 3);
        outPos.push_back(p.x); outPos.push_back(p.y); outPos.push_back(p.z);
        return id;
    };

    // groupVertId[(root,vertex)] -> offset vid (created lazily).
    std::unordered_map<std::uint64_t, std::uint32_t> groupVertId;
    std::vector<std::uint32_t> cornerVid(nhe, kInvalid); // per half-edge: its (group,origin) offset vid

    for (std::uint32_t h = 0; h < nhe; ++h) {
        const std::uint32_t f = HE[h].face;
        const std::uint32_t g = findRoot(f);
        const std::uint32_t v = HE[h].origin;
        const std::uint64_t gvKey =
            (static_cast<std::uint64_t>(g) << 32) | static_cast<std::uint64_t>(v);
        auto it = groupVertId.find(gvKey);
        if (it != groupVertId.end()) { cornerVid[h] = it->second; continue; }

        // Compute the offset for (group g, vertex v): the GROUP normal is f's
        // normal (all triangles of g are coplanar). Find the chamfered sharp
        // edges of g at v by walking the one-ring of v and keeping the boundary
        // edges of g (sharp edges whose other side leaves g). For a convex planar
        // polygon corner there are exactly two such edges; we trim away from each.
        const V3 P = toV3(V[v].position);
        const V3 nUnit = scale(faceNormal[f], 1.0 / norm(faceNormal[f]));

        // Collect the chamfered SHARP edges (v - w) that BORDER group g, deduped:
        // walk every triangle of g around v and inspect BOTH its edges at v (the
        // outgoing v->next and the incoming prev->v). A group-boundary edge may be
        // an INCOMING half-edge in g (its outgoing twin lives in the neighbour
        // group), so we must check both — an outgoing-only scan misses half of
        // them. Each unique chamfered border edge contributes ONE inward trim.
        std::set<std::uint32_t> trimNbr;
        {
            std::uint32_t hh = h;
            std::uint32_t guard = 0;
            const std::uint32_t guardMax = static_cast<std::uint32_t>(nhe) + 1u;
            do {
                const std::uint32_t fa = HE[hh].face;
                if (findRoot(fa) == g) {
                    const std::uint32_t wn = HE[HE[hh].next].origin;  // outgoing v->wn
                    const std::uint32_t wp = HE[HE[hh].prev].origin;  // incoming wp->v
                    if (edgeChamfered(v, wn)) trimNbr.insert(wn);
                    if (edgeChamfered(v, wp)) trimNbr.insert(wp);
                }
                const std::uint32_t hp = HE[hh].prev;
                const std::uint32_t ht = HE[hp].twin;
                if (ht == kInvalid) break;
                hh = ht;
                if (++guard > guardMax) break;
            } while (hh != h);
        }

        // Apply one inward trim of distance d per unique chamfered border edge.
        // Interior reference for "inward": the centroid of group g's triangles at
        // v is reliable; but a single in-g face centroid already lies on g's side
        // of every border edge, so we reuse f's centroid.
        V3 fc;
        {
            const std::uint32_t h1 = F[f].halfEdge;
            const std::uint32_t h2 = HE[h1].next;
            const std::uint32_t h3 = HE[h2].next;
            fc = scale(add(add(toV3(V[HE[h1].origin].position),
                               toV3(V[HE[h2].origin].position)),
                           toV3(V[HE[h3].origin].position)), 1.0 / 3.0);
        }
        V3 disp{0.0, 0.0, 0.0};
        for (std::uint32_t w : trimNbr) {
            V3 e = sub(toV3(V[w].position), P);
            e = scale(e, 1.0 / norm(e));
            V3 perp = cross(nUnit, e);
            if (dot(perp, sub(fc, P)) < 0.0) perp = scale(perp, -1.0);
            disp = add(disp, scale(perp, d / norm(perp)));
        }

        const std::uint32_t vid = pushVertex(add(P, disp));
        groupVertId.emplace(gvKey, vid);
        cornerVid[h] = vid;
    }

    std::vector<std::uint32_t> outIdx;

    // Track every emitted DIRECTED edge (a->b). A consistently-wound closed
    // 2-manifold never repeats a directed edge; we use this to orient the corner
    // fans so their boundary edges OPPOSE the already-emitted chamfer facets.
    std::unordered_set<std::uint64_t> usedDirected;
    auto dkey = [](std::uint32_t a, std::uint32_t b) -> std::uint64_t {
        return (static_cast<std::uint64_t>(a) << 32) | static_cast<std::uint64_t>(b);
    };
    auto recordTri = [&](std::uint32_t a, std::uint32_t b, std::uint32_t c) {
        outIdx.push_back(a); outIdx.push_back(b); outIdx.push_back(c);
        usedDirected.insert(dkey(a, b));
        usedDirected.insert(dkey(b, c));
        usedDirected.insert(dkey(c, a));
    };

    // ---- (A) shrunk original faces -----------------------------------------
    // Each triangular face f, with its three corners replaced by the per-corner
    // offset vertices (cornerVid of f's three half-edges), keeping the winding.
    for (std::uint32_t f = 0; f < nf; ++f) {
        const std::uint32_t h0 = F[f].halfEdge;
        const std::uint32_t h1 = HE[h0].next;
        const std::uint32_t h2 = HE[h1].next;
        recordTri(cornerVid[h0], cornerVid[h1], cornerVid[h2]);
    }

    // ---- (B) chamfer facets (one quad per chamfered edge, split into 2 tris) -
    // For chamfered edge with half-edges he0 (a->b on f0) and he1 (b->a on f1):
    //   on f0 the offset edge runs  A0 = corner(a on f0) -> B0 = corner(b on f0)
    //   on f1 the offset edge runs  A1 = corner(a on f1) -> B1 = corner(b on f1)
    // The chamfer quad bridges these two offset edges. With he0 = a->b, corner at
    // origin a is cornerVid[he0]; corner at b is cornerVid[HE[he0].next] (the
    // half-edge whose origin is b on f0 — that is he0.next, since the loop is a,b,c
    // and the edge a->b means next origin is b). Likewise on f1, he1 = b->a, so
    // corner at b is cornerVid[he1], corner at a is cornerVid[HE[he1].next].
    // Helper: emit a planar quad (4 corner vids) as two triangles, oriented so
    // the facet's outward normal agrees with the reference direction `refOut`.
    auto emitQuadOutward = [&](std::uint32_t q0, std::uint32_t q1,
                               std::uint32_t q2, std::uint32_t q3,
                               const V3& refOut) {
        const V3 p0{outPos[3 * q0], outPos[3 * q0 + 1], outPos[3 * q0 + 2]};
        const V3 p1{outPos[3 * q1], outPos[3 * q1 + 1], outPos[3 * q1 + 2]};
        const V3 p2{outPos[3 * q2], outPos[3 * q2 + 1], outPos[3 * q2 + 2]};
        const V3 nrm = cross(sub(p1, p0), sub(p2, p0));
        if (dot(nrm, refOut) >= 0.0) {
            // (q0,q1,q2,q3) already CCW about refOut.
            recordTri(q0, q1, q2);
            recordTri(q0, q2, q3);
        } else {
            // reverse the loop -> (q0,q3,q2,q1).
            recordTri(q0, q3, q2);
            recordTri(q0, q2, q1);
        }
    };

    for (auto& kv : emap) {
        EdgeInfo& e = kv.second;
        if (!e.chamfered) continue;
        const std::uint32_t he0 = e.he0;     // a -> b on f0
        const std::uint32_t he1 = e.he1;     // b -> a on f1
        const std::uint32_t A0 = cornerVid[he0];               // a on f0
        const std::uint32_t B0 = cornerVid[HE[he0].next];      // b on f0
        const std::uint32_t B1 = cornerVid[he1];               // b on f1
        const std::uint32_t A1 = cornerVid[HE[he1].next];      // a on f1
        // The chamfer quad bridges the two offset edges A0-B0 (on f0) and A1-B1
        // (on f1). Its outward normal points roughly along the bisector of the
        // two face normals (n0 + n1). Emit it outward-oriented so its shared
        // edges automatically OPPOSE the outward-wound shrunk faces / corner fans.
        const V3 refOut = add(scale(faceNormal[e.f0], 1.0 / norm(faceNormal[e.f0])),
                              scale(faceNormal[e.f1], 1.0 / norm(faceNormal[e.f1])));
        // Quad loop order around the bevel band: A0 -> B0 (f0 side) then B1 -> A1
        // (f1 side). emitQuadOutward fixes the winding to match refOut.
        emitQuadOutward(A0, B0, B1, A1, refOut);
        ++R.numChamferFaces;
    }

    // ---- (C) corner fans (one per original vertex that was trimmed) ---------
    // At an original vertex v, the incident faces' offset corners form a ring.
    // We walk the one-ring of v in consistent order (around v via twin/next) and
    // collect the per-face offset vertex for each incident face, then fan it.
    // The ring is traversed using the half-edge structure: starting from any
    // outgoing half-edge h with origin v, the next outgoing half-edge around v is
    //   nextAround = HE[ HE[h].prev ].twin    (rotate to the adjacent face).
    // Only emit a fan for a vertex that actually got trimmed (>=1 chamfered edge
    // incident); a fully-smooth vertex is unchanged (its single shared offset ==
    // itself, already woven by the shrunk faces meeting there).
    std::vector<bool> trimmed(nv, false);
    for (auto& kv : emap) {
        const EdgeInfo& e = kv.second;
        if (e.chamfered) { trimmed[e.v0] = true; trimmed[e.v1] = true; }
    }

    // For each vertex, one outgoing half-edge to seed the ring walk.
    std::vector<std::uint32_t> outHE(nv, kInvalid);
    for (std::uint32_t h = 0; h < nhe; ++h) {
        const std::uint32_t v = HE[h].origin;
        if (outHE[v] == kInvalid) outHE[v] = h;
    }

    for (std::uint32_t v = 0; v < nv; ++v) {
        if (!trimmed[v]) continue;
        // Walk the closed one-ring of v, collecting cornerVid of each incident
        // half-edge whose origin is v, in rotation order. Multiple coplanar
        // triangles of the SAME group at v share ONE offset vid, so COLLAPSE
        // consecutive duplicates: the corner polygon has one vertex per GROUP.
        std::vector<std::uint32_t> ring;
        const std::uint32_t start = outHE[v];
        std::uint32_t h = start;
        std::uint32_t guard = 0;
        const std::uint32_t guardMax = static_cast<std::uint32_t>(nhe) + 1u;
        do {
            const std::uint32_t cv = cornerVid[h];
            if (ring.empty() || ring.back() != cv) ring.push_back(cv);
            const std::uint32_t hp = HE[h].prev;     // its origin is the prev vertex; ends at v
            const std::uint32_t ht = HE[hp].twin;    // twin -> next outgoing around v
            if (ht == kInvalid) { ring.clear(); break; } // boundary (shouldn't happen on closed)
            h = ht;
            if (++guard > guardMax) { ring.clear(); break; }
        } while (h != start);

        // Collapse the wrap-around duplicate (last == first after the loop close).
        while (ring.size() >= 2 && ring.front() == ring.back()) ring.pop_back();

        if (ring.size() < 3) continue; // a 2-ring corner does not need a facet

        // Orient the corner fan so its BOUNDARY edges OPPOSE the chamfer-facet rung
        // edges already emitted (a closed 2-manifold never repeats a directed
        // edge). The ring's boundary, in collected order, is the closed loop
        // ring[0]->ring[1]->...->ring[k-1]->ring[0]. If that forward direction
        // collides with an already-emitted directed edge, the fan must be wound the
        // OTHER way. We decide from the first boundary edge that is decisive (one
        // of the two directions is already used by a chamfer rung).
        const std::size_t k = ring.size();
        bool flip = false;
        for (std::size_t i = 0; i < k; ++i) {
            const std::uint32_t u = ring[i];
            const std::uint32_t w = ring[(i + 1) % k];
            const bool fwdUsed = usedDirected.count(dkey(u, w)) != 0;
            const bool revUsed = usedDirected.count(dkey(w, u)) != 0;
            if (fwdUsed && !revUsed) { flip = true; break; }   // forward collides
            if (revUsed && !fwdUsed) { flip = false; break; }  // forward is free
        }

        // Fan from ring[0]. Un-flipped boundary direction is ring[i]->ring[i+1];
        // flipped reverses the whole loop (fan from ring[0] over the reversed ring).
        for (std::size_t i = 1; i + 1 < k; ++i) {
            const std::uint32_t a = ring[0];
            const std::uint32_t b = ring[i];
            const std::uint32_t cc = ring[i + 1];
            if (!flip) recordTri(a, b, cc);
            else       recordTri(a, cc, b);
        }
        ++R.numCornerFaces;
    }

    // ---- weld coincident vertices ------------------------------------------
    // A flat input face is several coplanar triangles sharing corners; their
    // per-corner offset vertices land at the SAME position and must be ONE vertex
    // for the result to close. Weld by position with a tolerance scaled to the
    // model so coplanar duplicates merge while genuinely distinct offset corners
    // (separated by ~d) stay apart. d is bounded below by nothing, but distinct
    // corners differ by at least a fraction of the shortest edge; we snap on a
    // grid far finer than d yet coarse enough to fuse float-identical duplicates.
    {
        double bb = 0.0;
        for (double c : outPos) bb = std::max(bb, std::fabs(c));
        const double snap = (bb > 0.0 ? bb : 1.0) * 1e-9;   // ~1e-9 relative
        const double inv = 1.0 / snap;
        auto qkey = [&](double v) -> long long {
            return static_cast<long long>(std::llround(v * inv));
        };
        std::map<std::array<long long, 3>, std::uint32_t> grid;
        std::vector<double> weldedPos;
        std::vector<std::uint32_t> remap(outPos.size() / 3, kInvalid);
        weldedPos.reserve(outPos.size());
        for (std::uint32_t i = 0; i < outPos.size() / 3; ++i) {
            const std::array<long long, 3> key{qkey(outPos[3 * i]),
                                               qkey(outPos[3 * i + 1]),
                                               qkey(outPos[3 * i + 2])};
            auto it = grid.find(key);
            if (it == grid.end()) {
                const std::uint32_t nid =
                    static_cast<std::uint32_t>(weldedPos.size() / 3);
                grid.emplace(key, nid);
                weldedPos.push_back(outPos[3 * i]);
                weldedPos.push_back(outPos[3 * i + 1]);
                weldedPos.push_back(outPos[3 * i + 2]);
                remap[i] = nid;
            } else {
                remap[i] = it->second;
            }
        }
        for (std::uint32_t& id : outIdx) id = remap[id];
        outPos.swap(weldedPos);
    }

    // ---- rebuild + re-validate (never fake a closed solid) ------------------
    // On failure we KEEP the populated diagnostics (numSharpEdges /
    // numChamferedEdges / facet counts) so the caller can see what was attempted;
    // only `ok` and `mesh` reflect the honest refusal.
    HalfEdgeMesh out;
    if (!out.buildFromSoup(outPos, outIdx)) {
        R.ok = false;
        R.reason = "chamfered soup is not a consistently-wound 2-manifold "
                   "(non-convex / self-intersecting offset)";
        return R;
    }
    const mesh::ValidityReport orep = out.validate();
    if (!orep.isValid()) {
        R.ok = false;
        R.reason = "chamfered solid is not a closed 2-manifold";
        return R;
    }

    R.mesh = std::move(out);
    R.outputVertices = static_cast<std::uint32_t>(R.mesh.vertexCount());
    R.outputFaces = static_cast<std::uint32_t>(R.mesh.faceCount());
    R.outputVolume = R.mesh.signedVolume();
    R.removedVolume = R.inputVolume - R.outputVolume;
    R.ok = true;
    R.reason = "ok";
    return R;
}

ChamferResult chamferEdges(const std::vector<double>& positions,
                           const std::vector<std::uint32_t>& indices,
                           double d,
                           double angleThresholdDeg) {
    ChamferResult R;
    R.setback = d;
    R.angleThresholdDeg = angleThresholdDeg;
    if (positions.empty() || indices.empty()) { R.reason = "empty soup"; return R; }
    if (positions.size() % 3 != 0) { R.reason = "positions length not a multiple of 3"; return R; }
    if (indices.size() % 3 != 0)   { R.reason = "indices length not a multiple of 3"; return R; }
    for (double p : positions)
        if (!std::isfinite(p)) { R.reason = "non-finite vertex coordinate"; return R; }

    HalfEdgeMesh m;
    if (!m.buildFromSoup(positions, indices)) {
        R.reason = "kernel could not build a 2-manifold half-edge mesh from the soup";
        return R;
    }
    return chamferEdges(m, d, angleThresholdDeg);
}

void makeCubeSoup(double L, const ::forge::native::mesh::Vec3& origin,
                  std::vector<double>& positions,
                  std::vector<std::uint32_t>& indices) {
    positions.clear();
    indices.clear();
    // 8 corners of [0,L]^3 + origin.
    const double O[3] = {origin.x, origin.y, origin.z};
    auto add = [&](double x, double y, double z) {
        positions.push_back(O[0] + x);
        positions.push_back(O[1] + y);
        positions.push_back(O[2] + z);
    };
    add(0, 0, 0); // 0
    add(L, 0, 0); // 1
    add(L, L, 0); // 2
    add(0, L, 0); // 3
    add(0, 0, L); // 4
    add(L, 0, L); // 5
    add(L, L, L); // 6
    add(0, L, L); // 7

    // Six faces, two CCW-outward triangles each.
    auto quad = [&](std::uint32_t a, std::uint32_t b, std::uint32_t c, std::uint32_t dd) {
        indices.push_back(a); indices.push_back(b); indices.push_back(c);
        indices.push_back(a); indices.push_back(c); indices.push_back(dd);
    };
    quad(0, 3, 2, 1); // bottom  z=0, normal -z
    quad(4, 5, 6, 7); // top     z=L, normal +z
    quad(0, 1, 5, 4); // front   y=0, normal -y
    quad(2, 3, 7, 6); // back    y=L, normal +y
    quad(1, 2, 6, 5); // right   x=L, normal +x
    quad(0, 4, 7, 3); // left    x=0, normal -x
}

} // namespace brep
} // namespace native
} // namespace forge
