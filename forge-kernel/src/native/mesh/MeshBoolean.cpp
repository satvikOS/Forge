// forge/native/mesh/MeshBoolean.cpp
//
// The FIRST boolean operation of the in-house mesh engine (Stage 2 of
// KERNEL_INHOUSE_ROADMAP.md): a robust PLANE-CLIP of a closed triangle mesh.
//
// Pure C++20, no external dependencies.
//
// HONEST SCOPE (Bible §0/§9):
//   IMPLEMENTED + VALIDATED here: clip a closed, 2-manifold mesh by a plane,
//   keep the half-space n·p <= d, re-triangulate every crossed face, and CAP the
//   exposed cross-section so the output is closed (watertight) and 2-manifold
//   again. Validated against analytic truth (a unit cube clipped at z=0 keeps
//   exactly half its volume).
//
//   TARGETED (NOT done here — do not claim):
//     * General A∩B / A∪B / A−B between two arbitrary solids. That needs a full
//       triangle–triangle arrangement + in/out classification and is the hard
//       remainder of Stage 2. A plane is a special case (one of the operands is a
//       half-space with a single flat boundary), which is why it is tractable as
//       the first increment.
//     * Non-convex / multiply-connected cross-section loops. The capper here
//       stitches the section boundary edges into loops and fans each loop from
//       its centroid; that is correct for convex (or star-shaped-about-centroid)
//       loops — the unit-cube section is a square, which is convex. A non-convex
//       section (e.g. an L-section or a loop with a hole) is TARGETED: the fan
//       can self-intersect. Flagged, not hidden.
//
// ROBUSTNESS: the per-vertex side classification uses the re-derived exact
// predicate forge::native::orient3d so the combinatorial in/out/on decision is
// rounding-proof. Intersection-point coordinates are plain-double linear
// interpolation (robust-in-practice, NOT CGAL-exact — same ceiling Manifold
// ships).

#include "forge/native/mesh/HalfEdgeMesh.hpp"

// Use the re-derived exact predicates if present (parallel build). If the
// header is ever absent this TU will fail to compile loudly — we deliberately do
// NOT silently duplicate a non-robust orientation test here.
#include "forge/native/Predicates.hpp"

#include <cmath>
#include <cstdint>
#include <map>
#include <vector>
#include <array>

namespace forge {
namespace native {
namespace mesh {

namespace {

struct DVec3 { double x, y, z; };

inline DVec3 cross(const DVec3& a, const DVec3& b) {
    return { a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x };
}
inline double dot(const DVec3& a, const DVec3& b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
inline double norm(const DVec3& a) { return std::sqrt(dot(a,a)); }

// Robust side-of-plane sign for point P, plane defined by normal n and offset d
// (plane = { x : n·x = d }). We build three points spanning the plane and use
// the exact orient3d so the combinatorial classification cannot flip due to
// rounding. p0 = closest point on plane to origin = (d/|n|^2) n. p1, p2 are p0
// plus two in-plane spanning directions.
struct PlaneFrame {
    DVec3 p0, p1, p2;
    DVec3 n;     // normalized-ish normal (only sign of dot used as fallback)
    double d;
};

PlaneFrame makeFrame(const Vec3& nin, double d) {
    DVec3 n{nin.x, nin.y, nin.z};
    double nn = dot(n, n);
    PlaneFrame fr;
    fr.n = n;
    fr.d = d;
    // base point on the plane
    if (nn > 0.0) {
        fr.p0 = { n.x * d / nn, n.y * d / nn, n.z * d / nn };
    } else {
        fr.p0 = {0,0,0};
    }
    // pick an axis least parallel to n to build a spanning vector
    DVec3 axis = (std::fabs(n.x) <= std::fabs(n.y) && std::fabs(n.x) <= std::fabs(n.z))
                     ? DVec3{1,0,0}
                     : (std::fabs(n.y) <= std::fabs(n.z) ? DVec3{0,1,0} : DVec3{0,0,1});
    DVec3 u = cross(n, axis);
    double ul = norm(u);
    if (ul == 0.0) u = DVec3{1,0,0}; else u = {u.x/ul, u.y/ul, u.z/ul};
    DVec3 v = cross(n, u);
    double vl = norm(v);
    if (vl == 0.0) v = DVec3{0,1,0}; else v = {v.x/vl, v.y/vl, v.z/vl};
    fr.p1 = { fr.p0.x + u.x, fr.p0.y + u.y, fr.p0.z + u.z };
    fr.p2 = { fr.p0.x + v.x, fr.p0.y + v.y, fr.p0.z + v.z };
    return fr;
}

// Returns: -1 inside (keep, n·P < d), 0 on the plane, +1 outside (cull).
// orient3d(p0,p1,p2,P) sign tells which side of the oriented plane (p0,p1,p2)
// the point P is on. We map that, with the analytic dot product fixing the
// orientation convention so that "inside" is exactly n·P < d.
int sideOf(const PlaneFrame& fr, const DVec3& P) {
    Sign s = orient3d(fr.p0.x, fr.p0.y, fr.p0.z,
                      fr.p1.x, fr.p1.y, fr.p1.z,
                      fr.p2.x, fr.p2.y, fr.p2.z,
                      P.x, P.y, P.z);
    if (s == Sign::ZERO) return 0;
    // Determine the sign that corresponds to n·P > d (outside) by testing a
    // probe point known to be outside: p0 + n  (n·(p0+n) = d + |n|^2 > d).
    DVec3 probe{ fr.p0.x + fr.n.x, fr.p0.y + fr.n.y, fr.p0.z + fr.n.z };
    Sign sp = orient3d(fr.p0.x, fr.p0.y, fr.p0.z,
                       fr.p1.x, fr.p1.y, fr.p1.z,
                       fr.p2.x, fr.p2.y, fr.p2.z,
                       probe.x, probe.y, probe.z);
    // sp is the sign of the OUTSIDE side. If P has the same sign -> outside.
    if (sp == Sign::ZERO) {
        // Degenerate frame (should not happen): fall back to analytic.
        double val = dot(fr.n, P) - fr.d;
        return val > 0 ? 1 : (val < 0 ? -1 : 0);
    }
    return (s == sp) ? 1 : -1;
}

// Linear intersection of segment A->B with the plane n·x = d.
DVec3 intersect(const PlaneFrame& fr, const DVec3& A, const DVec3& B) {
    double da = dot(fr.n, A) - fr.d;
    double db = dot(fr.n, B) - fr.d;
    double t = da / (da - db); // da != db because A,B on opposite sides
    return { A.x + t * (B.x - A.x),
             A.y + t * (B.y - A.y),
             A.z + t * (B.z - A.z) };
}

// Quantization key for welding coincident vertices (new intersection points
// produced independently on shared edges must merge). 1e-9 grid.
std::int64_t qkey(double v) {
    return static_cast<std::int64_t>(std::llround(v * 1e9));
}
struct Key3 {
    std::int64_t x, y, z;
    bool operator<(const Key3& o) const {
        if (x != o.x) return x < o.x;
        if (y != o.y) return y < o.y;
        return z < o.z;
    }
};
Key3 makeKey(const DVec3& p) { return { qkey(p.x), qkey(p.y), qkey(p.z) }; }

} // namespace

// Free builder so it can be a friend (declared in the header).
HalfEdgeMesh buildPlaneClip(const HalfEdgeMesh& in, const Vec3& nin, double d, bool& ok) {
    ok = false;
    HalfEdgeMesh empty;

    // Precondition: input must be a closed 2-manifold. Honest gate, not faked.
    ValidityReport vr = in.validate();
    if (!vr.isValid()) {
        return empty;
    }

    PlaneFrame fr = makeFrame(nin, d);

    const auto& V = in.vertices();

    // Classify every input vertex once.
    std::vector<int> side(V.size());
    for (std::size_t i = 0; i < V.size(); ++i) {
        DVec3 p{ V[i].position.x, V[i].position.y, V[i].position.z };
        side[i] = sideOf(fr, p);
    }

    // Output vertex pool with welding by quantized key.
    std::vector<DVec3> outPos;
    std::map<Key3, std::uint32_t> weld;
    auto addVertex = [&](const DVec3& p) -> std::uint32_t {
        Key3 k = makeKey(p);
        auto it = weld.find(k);
        if (it != weld.end()) return it->second;
        std::uint32_t idx = static_cast<std::uint32_t>(outPos.size());
        outPos.push_back(p);
        weld.emplace(k, idx);
        return idx;
    };

    std::vector<std::uint32_t> outIdx;

    // Section boundary edges: directed edges that lie ON the cut plane, oriented
    // so the kept polygon is on their left. We collect them to stitch the cap.
    // Each such edge (a->b) bounds the open cap; its reverse (b->a) closes it.
    std::vector<std::pair<std::uint32_t, std::uint32_t>> capEdges;

    const auto& HE = in.halfEdges();
    const auto& F  = in.faces();

    for (const Face& face : F) {
        if (face.halfEdge == kInvalid) continue;
        const HalfEdge& h0 = HE[face.halfEdge];
        const HalfEdge& h1 = HE[h0.next];
        const HalfEdge& h2 = HE[h1.next];
        std::array<std::uint32_t, 3> vi = { h0.origin, h1.origin, h2.origin };

        // Clip the triangle polygon against the half-space (keep side <= 0).
        // Sutherland–Hodgman producing a polygon in the kept half-space, plus we
        // record the edge that was created on the plane (for the cap).
        std::vector<DVec3> poly;      // output polygon vertices (kept region)
        std::vector<int>   polyOn;    // 1 if this output vertex lies on the plane
        poly.reserve(4);
        polyOn.reserve(4);

        for (int e = 0; e < 3; ++e) {
            std::uint32_t ci = vi[e];
            std::uint32_t ni = vi[(e + 1) % 3];
            DVec3 C{ V[ci].position.x, V[ci].position.y, V[ci].position.z };
            DVec3 N{ V[ni].position.x, V[ni].position.y, V[ni].position.z };
            int sc = side[ci];
            int sn = side[ni];

            bool cIn = (sc <= 0);
            if (cIn) {
                poly.push_back(C);
                polyOn.push_back(sc == 0 ? 1 : 0);
            }
            // edge strictly crosses the plane (one strictly in, one strictly out)
            if ((sc < 0 && sn > 0) || (sc > 0 && sn < 0)) {
                DVec3 X = intersect(fr, C, N);
                poly.push_back(X);
                polyOn.push_back(1);
            }
        }

        if (poly.size() < 3) {
            // Triangle entirely culled, or degenerated to an edge/point on the
            // plane — contributes no kept area. (A face lying exactly in the
            // plane is dropped; the cap re-creates the boundary.)
            continue;
        }

        // Map polygon vertices to output indices.
        std::vector<std::uint32_t> ring(poly.size());
        for (std::size_t k = 0; k < poly.size(); ++k) ring[k] = addVertex(poly[k]);

        // Fan-triangulate the (convex, since clipping a triangle by a half-space
        // yields a convex polygon of <=4 vertices) kept polygon.
        for (std::size_t k = 1; k + 1 < ring.size(); ++k) {
            outIdx.push_back(ring[0]);
            outIdx.push_back(ring[k]);
            outIdx.push_back(ring[k + 1]);
        }

        // Record cap edges: any polygon edge whose BOTH endpoints lie on the
        // plane is a boundary of the cut section. Oriented as it appears in the
        // kept polygon (CCW for the kept face) — the cap will reverse it.
        std::size_t M = ring.size();
        for (std::size_t k = 0; k < M; ++k) {
            std::size_t a = k, b = (k + 1) % M;
            if (polyOn[a] && polyOn[b] && ring[a] != ring[b]) {
                capEdges.emplace_back(ring[a], ring[b]);
            }
        }
    }

    // ---- Build the cap from the boundary edges ----------------------------
    // The cap fills the planar section. The section boundary is the set of
    // directed edges in capEdges; the cap triangles must use the REVERSED
    // orientation so their outward normal points opposite the kept faces (i.e.
    // toward +n, sealing the half-space). We stitch the directed edges into one
    // or more closed loops, then fan each loop about its centroid.
    if (!capEdges.empty()) {
        // adjacency: from -> to (each boundary vertex should have exactly one
        // outgoing and one incoming for a clean manifold section).
        std::map<std::uint32_t, std::uint32_t> nextOf;
        std::map<std::uint32_t, int> outdeg, indeg;
        bool cleanLoops = true;
        for (auto& e : capEdges) {
            if (nextOf.count(e.first)) { cleanLoops = false; }
            nextOf[e.first] = e.second;
            outdeg[e.first]++;
            indeg[e.second]++;
        }
        for (auto& [v, dgr] : outdeg) {
            if (dgr != 1 || indeg[v] != 1) { cleanLoops = false; break; }
        }

        if (!cleanLoops) {
            // Non-simple section (multiply-connected / non-manifold boundary):
            // TARGETED. Do NOT emit a bogus cap — fail honestly.
            return empty;
        }

        std::map<std::uint32_t, bool> visited;
        for (auto& e : capEdges) {
            std::uint32_t startV = e.first;
            if (visited[startV]) continue;
            // walk the loop
            std::vector<std::uint32_t> loop;
            std::uint32_t cur = startV;
            std::size_t guard = 0;
            bool closed = false;
            while (guard++ <= capEdges.size() + 1) {
                if (visited[cur]) { closed = (cur == startV); break; }
                visited[cur] = true;
                loop.push_back(cur);
                auto it = nextOf.find(cur);
                if (it == nextOf.end()) { closed = false; break; }
                cur = it->second;
                if (cur == startV) { closed = true; break; }
            }
            if (!closed || loop.size() < 3) {
                return empty; // open / degenerate loop -> honest failure
            }

            // centroid of the loop
            DVec3 cen{0,0,0};
            for (std::uint32_t lv : loop) {
                cen.x += outPos[lv].x; cen.y += outPos[lv].y; cen.z += outPos[lv].z;
            }
            double inv = 1.0 / static_cast<double>(loop.size());
            cen.x *= inv; cen.y *= inv; cen.z *= inv;
            std::uint32_t cIdx = addVertex(cen);

            // Fan with REVERSED winding so the cap faces outward (opposite the
            // kept side). Kept-face boundary edge was (a->b); cap uses (b->a)
            // closed by the centroid: triangle (centroid, b, a).
            std::size_t L = loop.size();
            for (std::size_t k = 0; k < L; ++k) {
                std::uint32_t a = loop[k];
                std::uint32_t b = loop[(k + 1) % L];
                outIdx.push_back(cIdx);
                outIdx.push_back(b);
                outIdx.push_back(a);
            }
        }
    }

    // Build the result half-edge mesh and verify it.
    std::vector<double> posFlat;
    posFlat.reserve(outPos.size() * 3);
    for (auto& p : outPos) { posFlat.push_back(p.x); posFlat.push_back(p.y); posFlat.push_back(p.z); }

    HalfEdgeMesh result;
    if (!result.buildFromSoup(posFlat, outIdx)) {
        return empty; // non-manifold output -> honest failure, no fake success
    }
    ValidityReport rr = result.validate();
    if (!rr.isValid()) {
        return empty;
    }

    ok = true;
    return result;
}

// Member thunk.
HalfEdgeMesh HalfEdgeMesh::planeClip(const Vec3& n, double d, bool& ok) const {
    return buildPlaneClip(*this, n, d, ok);
}

} // namespace mesh
} // namespace native
} // namespace forge
