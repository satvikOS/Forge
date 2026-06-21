// forge/native/mesh/Curvature.cpp
//
// Implementation of forge::native::mesh::computeCurvature — discrete
// differential curvature (Meyer–Desbrun–Schröder–Barr operators) on the in-house
// half-edge triangle mesh. Pure C++20, standard library only. See Curvature.hpp
// for the full specification and honest robustness posture.

#include "forge/native/mesh/Curvature.hpp"

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/AABBTree.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>   // std::sort, std::max, std::min
#include <cmath>       // std::sqrt, std::atan2, std::isfinite
#include <cstddef>     // std::size_t
#include <cstdint>     // std::uint32_t, std::uint64_t
#include <utility>     // std::pair
#include <vector>      // std::vector

namespace forge {
namespace native {
namespace mesh {

namespace {

// ---- tiny local 3-vector helpers (do not leak into the public API) ----------
struct V3 {
    double x{0.0}, y{0.0}, z{0.0};
};

inline V3 toV3(const Vec3& v) { return V3{v.x, v.y, v.z}; }
inline V3 sub(const V3& a, const V3& b) { return V3{a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 add(const V3& a, const V3& b) { return V3{a.x + b.x, a.y + b.y, a.z + b.z}; }
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

// cot of the angle between vectors u and v sharing an apex:
//   cot(theta) = cos/sin = (u.v) / |u x v|.
inline double cotangent(const V3& u, const V3& v) {
    double c = dot(u, v);
    double s = norm(cross(u, v));
    if (s < 1e-300) return 0.0;        // degenerate apex guarded upstream
    return c / s;
}

CurvatureField fail(const char* why) {
    CurvatureField f;
    f.ok = false;
    f.reason = why;
    return f;
}

} // namespace

CurvatureField computeCurvature(const HalfEdgeMesh& mesh) {
    const std::vector<Vertex>&   V  = mesh.vertices();
    const std::vector<HalfEdge>& HE = mesh.halfEdges();
    const std::vector<Face>&     F  = mesh.faces();

    const std::uint32_t nv = static_cast<std::uint32_t>(V.size());
    const std::uint32_t nf = static_cast<std::uint32_t>(F.size());

    if (nv == 0 || nf == 0) return fail("empty mesh");

    // Re-audit with the kernel's own validator. We accept a 2-MANIFOLD-WITH-
    // BOUNDARY mesh (an open plane patch is legitimately such), so we do NOT
    // require vr.manifold — that kernel flag additionally demands every edge have
    // exactly two incident faces (i.e. watertightness), which a valid open patch
    // does not. Instead we require:
    //   * twin consistency (the half-edge wiring is sound), and
    //   * edge-manifoldness: every undirected edge has 1 or 2 incident faces
    //     (a successful buildFromSoup already rejects a repeated directed edge,
    //      so 3+ faces on an edge cannot occur — we re-verify defensively), and
    //   * vertex-manifoldness: the star of every vertex is a single fan
    //     (one cycle for an interior vertex, one open chain for a boundary
    //      vertex). A pinched "bowtie" vertex is rejected.
    ValidityReport vr = mesh.validate();
    if (!vr.twinsConsistent) return fail("half-edge twins inconsistent");
    if (vr.numEdges == 0)    return fail("mesh has no edges");

    // Edge-manifold defensive re-check: tally incident faces per undirected edge.
    // (Keyed by (min,max) endpoint pair.) Any count > 2 is non-manifold.
    {
        std::vector<std::pair<std::uint64_t, std::uint32_t>> edgeFaces;
        edgeFaces.reserve(HE.size());
        for (std::uint32_t h = 0; h < HE.size(); ++h) {
            std::uint32_t a = HE[h].origin;
            std::uint32_t b = HE[HE[h].next].origin;
            if (a >= nv || b >= nv) return fail("half-edge endpoint out of range");
            std::uint64_t lo = a < b ? a : b;
            std::uint64_t hi = a < b ? b : a;
            edgeFaces.emplace_back((lo << 32) | hi, 1u);
        }
        std::sort(edgeFaces.begin(), edgeFaces.end(),
                  [](const auto& x, const auto& y) { return x.first < y.first; });
        std::size_t i = 0;
        while (i < edgeFaces.size()) {
            std::size_t j = i;
            std::uint32_t cnt = 0;
            while (j < edgeFaces.size() && edgeFaces[j].first == edgeFaces[i].first) { ++cnt; ++j; }
            if (cnt > 2) return fail("non-manifold edge (>2 incident faces)");
            i = j;
        }
    }

    // Vertex-manifold (no-bowtie) re-check. The half-edges leaving a vertex must
    // form ONE connected fan. We walk the fan(s) at each vertex and require that
    // a single walk reaches every outgoing half-edge of that vertex.
    // Rotation around a vertex: from outgoing half-edge h, the previous-in-fan
    // outgoing half-edge is twin(prev(h)); we instead rotate forward via the
    // boundary-aware step  h -> twin(h).next  (which fails at a boundary), so we
    // root each fan at a BOUNDARY-incident outgoing half-edge when one exists,
    // else anywhere (closed fan). This mirrors the kernel's interior logic but
    // also accepts open fans.
    {
        std::vector<std::uint32_t> outCount(nv, 0);
        std::vector<std::uint32_t> anyOut(nv, kInvalid);   // any outgoing he
        std::vector<std::uint32_t> bndOut(nv, kInvalid);   // an outgoing boundary he
        for (std::uint32_t h = 0; h < HE.size(); ++h) {
            std::uint32_t o = HE[h].origin;
            if (o >= nv) return fail("half-edge origin out of range");
            ++outCount[o];
            anyOut[o] = h;
            if (HE[h].twin == kInvalid) bndOut[o] = h;     // h has no twin: open
        }
        for (std::uint32_t v = 0; v < nv; ++v) {
            if (outCount[v] == 0) continue;                // isolated vertex
            // Root: a boundary outgoing he if any (open fan), else any (closed).
            std::uint32_t start = (bndOut[v] != kInvalid) ? bndOut[v] : anyOut[v];
            bool open = (bndOut[v] != kInvalid);
            std::uint32_t cur = start;
            std::uint32_t walked = 0;
            // Walk forward: next outgoing he around v is twin(prev(cur)).
            // prev(cur) is the half-edge INTO v on cur's face; its twin leaves v.
            while (true) {
                ++walked;
                if (walked > outCount[v] + 1) { return fail("non-manifold (bowtie) vertex"); }
                std::uint32_t prevh = HE[cur].prev;
                std::uint32_t tw = HE[prevh].twin;
                if (tw == kInvalid) break;                 // hit boundary: open fan ends
                cur = tw;
                if (cur == start) break;                   // closed fan completed
            }
            if (walked != outCount[v]) return fail("non-manifold (bowtie) vertex");
            (void)open;
        }
    }

    // All coordinates must be finite.
    for (const Vertex& vv : V) {
        if (!finite3(toV3(vv.position))) return fail("non-finite vertex coordinate");
    }

    CurvatureField out;
    out.numVertices = nv;
    out.numFaces    = nf;

    out.mixedArea.assign(nv, 0.0);
    out.angleDefect.assign(nv, 0.0);
    out.isBoundary.assign(nv, 0u);
    out.meanH.assign(nv, 0.0);
    out.gaussianK.assign(nv, 0.0);
    out.k1.assign(nv, 0.0);
    out.k2.assign(nv, 0.0);

    // angleSum[i] accumulates the incident-triangle tip angles at vertex i.
    std::vector<double> angleSum(nv, 0.0);
    // Lvec[i] accumulates the cotangent-Laplacian mean-curvature-normal *2A:
    //   sum_j (cot a + cot b)(x_i - x_j).  (We divide by 2A_mixed at the end.)
    std::vector<V3> Lvec(nv, V3{});
    // areaWeightedNormal[i] accumulates face-area-weighted triangle normals so we
    // can SIGN the mean curvature (outward-convex => H>0).
    std::vector<V3> nrm(nv, V3{});

    // Mark boundary vertices: any half-edge with no twin is a boundary edge; both
    // of its endpoints are boundary vertices.
    for (std::uint32_t h = 0; h < HE.size(); ++h) {
        if (HE[h].twin == kInvalid) {
            std::uint32_t a = HE[h].origin;
            std::uint32_t b = HE[HE[h].next].origin;
            if (a < nv) out.isBoundary[a] = 1u;
            if (b < nv) out.isBoundary[b] = 1u;
        }
    }

    // ---- per-face accumulation ------------------------------------------------
    // For each triangle (i0,i1,i2): tip angles, Voronoi/mixed area split per
    // Meyer et al., and the cotangent contributions to each opposite edge.
    for (std::uint32_t fi = 0; fi < nf; ++fi) {
        std::uint32_t h0 = F[fi].halfEdge;
        if (h0 == kInvalid) return fail("face with no half-edge");
        std::uint32_t h1 = HE[h0].next;
        std::uint32_t h2 = HE[h1].next;
        if (HE[h2].next != h0) return fail("non-triangular face");

        std::uint32_t i0 = HE[h0].origin;
        std::uint32_t i1 = HE[h1].origin;
        std::uint32_t i2 = HE[h2].origin;
        if (i0 >= nv || i1 >= nv || i2 >= nv) return fail("face index out of range");

        V3 p0 = toV3(V[i0].position);
        V3 p1 = toV3(V[i1].position);
        V3 p2 = toV3(V[i2].position);

        // Edge vectors and squared lengths.
        V3 e01 = sub(p1, p0), e12 = sub(p2, p1), e20 = sub(p0, p2);
        double l0 = dot(e12, e12);   // squared length of edge OPPOSITE vertex 0 (p1-p2)
        double l1 = dot(e20, e20);   // opposite vertex 1
        double l2 = dot(e01, e01);   // opposite vertex 2

        // Triangle area via cross product.
        V3 fn = cross(e01, sub(p2, p0));
        double twoArea = norm(fn);
        double area = 0.5 * twoArea;
        if (!(area > 0.0) || !std::isfinite(area)) return fail("degenerate (zero-area) triangle");

        // Face normal (unit*area weighting accumulated for vertex normals).
        // fn already = 2*area * unitNormal, so adding fn weights by 2*area — fine
        // for a consistent sign/direction estimate.
        nrm[i0] = add(nrm[i0], fn);
        nrm[i1] = add(nrm[i1], fn);
        nrm[i2] = add(nrm[i2], fn);

        // Tip angles at each vertex (law of cosines from squared edge lengths).
        // angle at v0 is between edges (p1-p0) and (p2-p0).
        V3 a0u = sub(p1, p0), a0v = sub(p2, p0);
        V3 a1u = sub(p2, p1), a1v = sub(p0, p1);
        V3 a2u = sub(p0, p2), a2v = sub(p1, p2);
        double ang0 = std::atan2(norm(cross(a0u, a0v)), dot(a0u, a0v));
        double ang1 = std::atan2(norm(cross(a1u, a1v)), dot(a1u, a1v));
        double ang2 = std::atan2(norm(cross(a2u, a2v)), dot(a2u, a2v));
        angleSum[i0] += ang0;
        angleSum[i1] += ang1;
        angleSum[i2] += ang2;

        // Cotangents of the three angles.
        double cot0 = cotangent(a0u, a0v);  // angle at v0, opposite edge (1,2)
        double cot1 = cotangent(a1u, a1v);  // angle at v1, opposite edge (2,0)
        double cot2 = cotangent(a2u, a2v);  // angle at v2, opposite edge (0,1)

        // Cotangent-Laplacian: each edge (j,k) gets weight cot(angle opposite it)
        // distributed to its two endpoints with sign (x_endpoint - x_otherend).
        //   edge (1,2) opposite v0 -> weight cot0
        //   edge (2,0) opposite v1 -> weight cot1
        //   edge (0,1) opposite v2 -> weight cot2
        // Contribution to L[i] is sum over incident edges of w*(x_i - x_j); each
        // edge is shared by two triangles, and summing cot0 from both incident
        // triangles reproduces (cot a + cot b). We add the half from THIS face.
        // edge (1,2), weight cot0:
        Lvec[i1] = add(Lvec[i1], scale(sub(p1, p2), cot0));
        Lvec[i2] = add(Lvec[i2], scale(sub(p2, p1), cot0));
        // edge (2,0), weight cot1:
        Lvec[i2] = add(Lvec[i2], scale(sub(p2, p0), cot1));
        Lvec[i0] = add(Lvec[i0], scale(sub(p0, p2), cot1));
        // edge (0,1), weight cot2:
        Lvec[i0] = add(Lvec[i0], scale(sub(p0, p1), cot2));
        Lvec[i1] = add(Lvec[i1], scale(sub(p1, p0), cot2));

        // ---- Meyer mixed Voronoi area split --------------------------------
        // Non-obtuse triangle: each vertex gets its true Voronoi cell area
        //   A_voronoi(i) = 1/8 * sum over the two edges at i of |edge|^2 * cot(opposite angle).
        // Obtuse triangle: |T|/2 at the obtuse vertex, |T|/4 at the other two.
        const double pi = 3.14159265358979323846;
        bool obtuse = (ang0 > pi * 0.5) || (ang1 > pi * 0.5) || (ang2 > pi * 0.5);
        if (!obtuse) {
            // Voronoi area at v0: edges (0,1) and (0,2); opposite angles are at v2
            // (cot2) and v1 (cot1) respectively. |edge01|^2 = l2, |edge02|^2 = l1.
            double av0 = (l2 * cot2 + l1 * cot1) * 0.125;
            double av1 = (l0 * cot0 + l2 * cot2) * 0.125;
            double av2 = (l1 * cot1 + l0 * cot0) * 0.125;
            // Numerical guard: Voronoi cells of a non-obtuse triangle are >=0 and
            // sum to the triangle area. Clamp tiny negative round-off to 0.
            out.mixedArea[i0] += av0 > 0.0 ? av0 : 0.0;
            out.mixedArea[i1] += av1 > 0.0 ? av1 : 0.0;
            out.mixedArea[i2] += av2 > 0.0 ? av2 : 0.0;
        } else {
            double aq = area * 0.5;   // obtuse-vertex share
            double ah = area * 0.25;  // the other two
            if (ang0 > pi * 0.5)      { out.mixedArea[i0] += aq; out.mixedArea[i1] += ah; out.mixedArea[i2] += ah; }
            else if (ang1 > pi * 0.5) { out.mixedArea[i1] += aq; out.mixedArea[i0] += ah; out.mixedArea[i2] += ah; }
            else                      { out.mixedArea[i2] += aq; out.mixedArea[i0] += ah; out.mixedArea[i1] += ah; }
        }
    }

    // ---- finalise per-vertex curvature ---------------------------------------
    const double pi = 3.14159265358979323846;
    std::uint32_t nbound = 0;
    double totalDefect = 0.0;

    for (std::uint32_t i = 0; i < nv; ++i) {
        bool bnd = out.isBoundary[i] != 0u;
        if (bnd) ++nbound;

        // Angular defect: interior 2*pi - sum theta; boundary pi - sum theta.
        double defect = (bnd ? pi : 2.0 * pi) - angleSum[i];
        out.angleDefect[i] = defect;
        totalDefect += defect;

        double A = out.mixedArea[i];

        if (bnd) {
            // Pointwise H/K are not defined at a boundary vertex (the operator's
            // boundary correction is a line term, not a point density). We do NOT
            // fabricate one; the defect is still summed for Gauss–Bonnet above.
            out.gaussianK[i] = 0.0;
            out.meanH[i] = 0.0;
            out.k1[i] = 0.0;
            out.k2[i] = 0.0;
            continue;
        }

        if (!(A > 0.0)) {
            // Isolated/degenerate interior vertex — leave zero (cannot divide).
            continue;
        }

        // Gaussian curvature.
        double K = defect / A;
        out.gaussianK[i] = K;

        // Mean curvature normal: K_H = Lvec / (2 A). Its half-magnitude is |H|.
        V3 KH = scale(Lvec[i], 1.0 / (2.0 * A));
        double Hmag = 0.5 * norm(KH);

        // Sign H by the dot of the mean-curvature-normal with the (outward)
        // area-weighted vertex normal. For a convex OUTWARD surface (e.g. a
        // sphere) the apex x_i is the outermost point of its 1-ring, so the
        // Laplacian sum (x_i - x_j) has a positive OUTWARD component: K_H points
        // along +n and K_H . n > 0. We define H > 0 for such a convex outward
        // patch, so the sign is just sign(K_H . n).
        double sgn = dot(KH, nrm[i]);
        double H = (sgn >= 0.0) ? Hmag : -Hmag;
        out.meanH[i] = H;

        // Principal curvatures from invariants. Discriminant clamped at 0.
        double disc = H * H - K;
        double r = (disc > 0.0) ? std::sqrt(disc) : 0.0;
        out.k1[i] = H + r;
        out.k2[i] = H - r;
    }

    out.numBoundaryVertices = nbound;
    out.totalAngleDefect = totalDefect;
    out.ok = true;
    out.reason = "ok";
    return out;
}

CurvatureField computeCurvature(const std::vector<double>& positions,
                                const std::vector<std::uint32_t>& indices) {
    if (positions.empty() || indices.empty()) return fail("empty input soup");
    if (positions.size() % 3 != 0) return fail("positions length not a multiple of 3");
    if (indices.size() % 3 != 0)   return fail("indices length not a multiple of 3");

    for (double c : positions) {
        if (!std::isfinite(c)) return fail("non-finite vertex coordinate");
    }

    HalfEdgeMesh m;
    if (!m.buildFromSoup(positions, indices)) {
        return fail("buildFromSoup failed (out-of-range/repeated index or inconsistent winding)");
    }
    return computeCurvature(m);
}

} // namespace mesh
} // namespace native
} // namespace forge
