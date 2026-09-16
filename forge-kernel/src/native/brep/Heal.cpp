// forge/native/brep/Heal.cpp
//
// Implementation of the K5-heal native B-rep HEALING op (Heal.hpp). Pure C++20,
// stdlib only, no external deps. See header for honesty / scope / the five ops.
//
// ALGORITHM OUTLINE
//   healBRep:
//     0. EXTRACT each face's loops to ordered VERTEX-POSITION RINGS (outer + inner)
//        — the geometry-light face representation the box/faceted gate carries. The
//        before-signature is taken now (diagnoseShell on the raw input).
//     (4) WELD: cluster all ring vertex POSITIONS within tol (the same tolerance
//        spatial-hash + union-find as Sew's weldNearVertices, applied to positions)
//        so every ring corner snaps to its cluster representative. This de-dups
//        coincident vertices across faces.
//     (2) COLLAPSE short edges: walk each ring; a consecutive pair whose welded
//        representatives are EQUAL (a zero-length / sub-tol edge) is collapsed by
//        dropping the duplicate corner. A ring that falls below 3 distinct corners
//        is itself degenerate (its face becomes a sliver, handled in (3)).
//     (1) GAP-FILL: build the welded-position set; any two ring corners within tol
//        already share a representative from (4), so the gap is already closed at
//        the ring level — the snap count is the number of distinct input vertices
//        that merged into a shared representative used by >1 face boundary.
//     (3) SLIVER removal: an outer ring whose polygon area < sliverAreaEps OR whose
//        aspect ratio is degenerate is dropped (its face removed from the set).
//     5. REBUILD: from the cleaned outer rings, construct FRESH independent faces in
//        `tb` (private vertices/edges per ring) and SEW them (REUSE sewFaces) so the
//        coincident boundaries re-mate into shared-edge coedges — this is the single
//        place new topology is minted, and it goes through the validated sewer.
//     6. DIAGNOSE after (REUSE diagnoseShell) + measure volume/area + fill the
//        unfixed* lists from what the after-signature still shows open.
//
// Why rings-then-resew (vs in-place coedge surgery): collapsing an edge / dropping a
// sliver / closing a gap each perturb the loop ring; rebuilding the rings cleanly and
// handing them to the PROVEN sewer is the robust, no-duplicate path the spec asks for
// (it reuses Sew's matcher rather than re-deriving a second edge-merge). The original
// input entities are left owned-but-unreferenced by `tb` (never freed here).

#include "forge/native/brep/Heal.hpp"

#include "forge/native/brep/Sew.hpp"        // sewFaces, diagnoseShell, weldNearVertices
#include "forge/native/brep/Topology.hpp"
#include "forge/native/ExactPredicates3D.hpp" // exact triangle/segment tests for self-intersection (7)

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <queue>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

// ---- geometry helpers (local; do not collide with Surface.hpp / Sew.cpp) -----
inline double dist2(const Point3& a, const Point3& b) {
    const double dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}
inline Point3 psub(const Point3& a, const Point3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Point3 pcross(const Point3& a, const Point3& b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline double pdot(const Point3& a, const Point3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline double plen(const Point3& a) { return std::sqrt(pdot(a, a)); }

inline long long qcell(double x, double cell) {
    return static_cast<long long>(std::floor(x / cell));
}
struct CellKey { long long x, y, z; bool operator==(const CellKey& o) const { return x == o.x && y == o.y && z == o.z; } };
struct CellKeyHash {
    std::size_t operator()(const CellKey& k) const {
        std::uint64_t h = 1469598103934665603ull;
        auto mix = [&](long long v) { h ^= static_cast<std::uint64_t>(v) + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2); };
        mix(k.x); mix(k.y); mix(k.z);
        return static_cast<std::size_t>(h);
    }
};
struct DSU {
    std::vector<int> parent;
    void init(std::size_t n) { parent.resize(n); for (std::size_t i = 0; i < n; ++i) parent[i] = static_cast<int>(i); }
    int find(int a) { while (parent[a] != a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    void unite(int a, int b) { int ra = find(a), rb = find(b); if (ra != rb) parent[ra] = rb; }
};

// Cluster corner POSITIONS within tol (tolerance spatial hash + union-find, the
// same scheme as Sew::weldNearVertices applied to raw positions). THE single
// implementation of "which of these corner positions are the same point": both
// healBRep's weld pass (4)/(1) and shellClosure call it, so the destruction
// guard's notion of coincidence cannot drift from the healer's own. Cells are
// tol-sided and the 27-cell neighbourhood is searched, so a pair straddling a cell
// wall is still found.
void clusterPositionsWithin(const std::vector<Point3>& pts, double tol, DSU& dsu) {
    const std::size_t n = pts.size();
    dsu.init(n);
    if (n == 0) return;
    const double cell = (tol > 0.0) ? tol : 1e-12;
    const double t2 = cell * cell;
    std::unordered_map<CellKey, std::vector<int>, CellKeyHash> grid;
    grid.reserve(n * 2);
    for (std::size_t i = 0; i < n; ++i) {
        const Point3& p = pts[i];
        const long long cx = qcell(p.x, cell), cy = qcell(p.y, cell), cz = qcell(p.z, cell);
        for (long long dx = -1; dx <= 1; ++dx)
          for (long long dy = -1; dy <= 1; ++dy)
            for (long long dz = -1; dz <= 1; ++dz) {
                auto it = grid.find({cx + dx, cy + dy, cz + dz});
                if (it == grid.end()) continue;
                for (int j : it->second)
                    if (dist2(pts[i], pts[j]) <= t2) dsu.unite(static_cast<int>(i), j);
            }
        grid[{cx, cy, cz}].push_back(static_cast<int>(i));
    }
}

// A face decomposed into its boundary VERTEX-POSITION rings: outer first, then any
// inner (hole) rings. Each ring is the ordered corner positions of one loop.
struct FaceRings {
    std::vector<Point3>              outer;   // outer-loop corner positions, in ring order
    std::vector<std::vector<Point3>> inners;  // inner-loop corner positions
    Face* src = nullptr;
};

// Extract a loop's ordered corner positions by walking its coedge ring in traversal
// order (origin vertex of each coedge).
std::vector<Point3> loopRing(const Loop* lp) {
    std::vector<Point3> ring;
    if (lp == nullptr || lp->first == nullptr) return ring;
    const Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount && c != nullptr; ++i) {
        const Vertex* o = c->originVertex();
        if (o) ring.push_back(o->point);
        c = c->next;
    }
    return ring;
}

FaceRings extractFace(Face* f) {
    FaceRings fr;
    fr.src = f;
    fr.outer = loopRing(f->outerLoop);
    for (Loop* il : f->innerLoops) fr.inners.push_back(loopRing(il));
    return fr;
}

// Signed area vector of a 3D polygon (Newell). |result| = 2*area; direction = normal.
Point3 newellAreaVec(const std::vector<Point3>& ring) {
    Point3 n{0, 0, 0};
    const std::size_t L = ring.size();
    for (std::size_t i = 0; i < L; ++i) {
        const Point3& a = ring[i];
        const Point3& b = ring[(i + 1) % L];
        n.x += (a.y - b.y) * (a.z + b.z);
        n.y += (a.z - b.z) * (a.x + b.x);
        n.z += (a.x - b.x) * (a.y + b.y);
    }
    return {n.x * 0.5, n.y * 0.5, n.z * 0.5};
}
inline double polyArea(const std::vector<Point3>& ring) {
    if (ring.size() < 3) return 0.0;
    return plen(newellAreaVec(ring));
}

// Volume contribution of one polygonal face by the divergence theorem: fan the
// ring from its first vertex and sum the signed tetra volumes (1/6) v0·(vi×vi+1).
double polyVolumeContribution(const std::vector<Point3>& ring) {
    if (ring.size() < 3) return 0.0;
    const Point3& v0 = ring[0];
    double vol = 0.0;
    for (std::size_t i = 1; i + 1 < ring.size(); ++i) {
        vol += pdot(v0, pcross(ring[i], ring[i + 1]));
    }
    return vol / 6.0;
}

// Degenerate-aspect test for an outer ring: longest edge over mean altitude
// (= 2*area / longest edge) exceeds aspectMax, i.e. longest^2 / (2*area) > aspectMax.
bool degenerateAspect(const std::vector<Point3>& ring, double area, double aspectMax) {
    if (ring.size() < 3 || area <= 0.0) return true;
    double longest2 = 0.0;
    const std::size_t L = ring.size();
    for (std::size_t i = 0; i < L; ++i) {
        double d2 = dist2(ring[i], ring[(i + 1) % L]);
        if (d2 > longest2) longest2 = d2;
    }
    const double longest = std::sqrt(longest2);
    if (longest <= 0.0) return true;
    const double meanAltitude = (2.0 * area) / longest;  // area = 0.5 * longest * altitude
    return (longest / meanAltitude) > aspectMax;
}

// Perpendicular distance from c to the segment a-b (a T-vertex test).
double perpDistToSeg(const Point3& c, const Point3& a, const Point3& b) {
    Point3 ab = psub(b, a), ac = psub(c, a);
    double ab2 = pdot(ab, ab);
    if (ab2 <= 0.0) return plen(ac);                 // degenerate segment
    double t = pdot(ac, ab) / ab2;                   // projection parameter
    Point3 proj{a.x + ab.x * t, a.y + ab.y * t, a.z + ab.z * t};
    return plen(psub(c, proj));
}

// Normalise one boundary ring, exactly as heal pass (2) does — the two
// topology-faithful sub-steps, extracted here so shellClosure can ask its
// closedness question about the ring the heal will ACTUALLY work on:
//   (a) consecutive/closing duplicate drop: a corner within tol of the previous
//       surviving corner is a ZERO-LENGTH / sub-tol edge and is removed;
//   (b) collinear T-vertex removal: a corner whose perpendicular distance to the
//       segment between its two ring neighbours is < tol adds no geometry — it is
//       the artefact of a SPLIT EDGE, and removing it re-merges the two collinear
//       edges so the face re-mates with its neighbour across the FULL edge.
//       Never taken below a triangle.
// `collapsed`, when non-null, is incremented once per removed corner.
void cleanRingPositions(std::vector<Point3>& ring, double tol, std::size_t* collapsed) {
    if (ring.empty()) return;
    const double tol2 = tol * tol;
    {   // (a) consecutive + closing duplicates.
        std::vector<Point3> out; out.reserve(ring.size());
        for (const Point3& p : ring) {
            if (!out.empty() && dist2(out.back(), p) <= tol2) { if (collapsed) ++*collapsed; continue; }
            out.push_back(p);
        }
        while (out.size() >= 2 && dist2(out.front(), out.back()) <= tol2) { out.pop_back(); if (collapsed) ++*collapsed; }
        ring.swap(out);
    }
    // (b) collinear corners (iterate until stable; never below a triangle).
    bool changed = true;
    while (changed && ring.size() > 3) {
        changed = false;
        const std::size_t L = ring.size();
        for (std::size_t i = 0; i < L; ++i) {
            const Point3& a = ring[(i + L - 1) % L];
            const Point3& c = ring[i];
            const Point3& b = ring[(i + 1) % L];
            if (perpDistToSeg(c, a, b) < tol) {
                ring.erase(ring.begin() + static_cast<long>(i));
                if (collapsed) ++*collapsed;
                changed = true;
                break;
            }
        }
    }
}

// ---- (7) self-intersection helpers ---------------------------------------
// A fan-triangulated outer ring (each tri = ring[0], ring[i], ring[i+1]) as the
// tessellated boundary the EXACT tri-tri test runs against.
using Tri3 = std::array<Point3, 3>;
void fanTriangulate(const std::vector<Point3>& ring, std::vector<Tri3>& out) {
    if (ring.size() < 3) return;
    for (std::size_t i = 1; i + 1 < ring.size(); ++i)
        out.push_back({ring[0], ring[i], ring[i + 1]});
}

inline forge::native::ExactPoint3 EP(const Point3& p) {
    return forge::native::ExactPoint3(forge::native::ExactReal(p.x),
                                      forge::native::ExactReal(p.y),
                                      forge::native::ExactReal(p.z));
}

// Do triangles A and B PROPERLY interpenetrate? True iff some edge of one
// triangle pierces the OTHER triangle's interior in a single point (the exact
// `crosses` verdict of segmentTriangleClassify). Coplanar/edge-on contact (two
// faces meeting cleanly along a shared boundary) is deliberately NOT counted —
// only a transversal interior pierce, which is a real interpenetration. The signs
// are all taken through ExactReal, so the verdict is exact (never a float tie).
bool trisInterpenetrate(const Tri3& A, const Tri3& B) {
    const forge::native::ExactPoint3 a0 = EP(A[0]), a1 = EP(A[1]), a2 = EP(A[2]);
    const forge::native::ExactPoint3 b0 = EP(B[0]), b1 = EP(B[1]), b2 = EP(B[2]);
    auto edgePierces = [](const forge::native::ExactPoint3& p0,
                          const forge::native::ExactPoint3& p1,
                          const forge::native::ExactPoint3& q0,
                          const forge::native::ExactPoint3& q1,
                          const forge::native::ExactPoint3& q2) -> bool {
        forge::native::SegTriResult r =
            forge::native::segmentTriangleClassify(p0, p1, q0, q1, q2);
        return r.crosses;  // strict interior pierce in ONE point
    };
    // Three edges of A against triangle B.
    if (edgePierces(a0, a1, b0, b1, b2)) return true;
    if (edgePierces(a1, a2, b0, b1, b2)) return true;
    if (edgePierces(a2, a0, b0, b1, b2)) return true;
    // Three edges of B against triangle A.
    if (edgePierces(b0, b1, a0, a1, a2)) return true;
    if (edgePierces(b1, b2, a0, a1, a2)) return true;
    if (edgePierces(b2, b0, a0, a1, a2)) return true;
    return false;
}

} // anonymous namespace

// ===========================================================================
// shellSignedVolume / shellSurfaceArea — measured invariants (also used in A/B).
// ===========================================================================
double shellSignedVolume(const std::vector<Face*>& faces) {
    double vol = 0.0;
    for (Face* f : faces) {
        if (f == nullptr) continue;
        vol += polyVolumeContribution(loopRing(f->outerLoop));
        for (Loop* il : f->innerLoops) vol -= polyVolumeContribution(loopRing(il));
    }
    return vol;
}

double shellSurfaceArea(const std::vector<Face*>& faces) {
    double area = 0.0;
    for (Face* f : faces) {
        if (f == nullptr) continue;
        area += polyArea(loopRing(f->outerLoop));
        for (Loop* il : f->innerLoops) area -= polyArea(loopRing(il));
    }
    return area;
}

// ===========================================================================
// shellClosure — THE ARMING INSTRUMENT: is this soup a closed body, and how
// much material does it bound? See Heal.hpp for the contract and for the
// measured reason the Newell-sum test below cannot answer this question.
// ===========================================================================
namespace {

// [face][ring][corner] — one face's rings, outer first then inners.
using WeldedRings = std::vector<std::vector<std::vector<Point3>>>;

// Steps 0-2 of the closedness question, isolated so they can be asked at TWO
// different tolerances in one verdict (see closureAt's `volTol` below): extract
// every face's boundary rings, weld the corner positions at `tol` the way heal
// pass (4)/(1) does, and normalise each ring the way heal pass (2) does.
WeldedRings weldedRings(const std::vector<Face*>& faces, double tol) {
    if (!(tol > 0.0)) tol = 1e-12;

    // --- 0. every face to its boundary rings (outer first, then inners) --------
    // Inner (hole) loops are boundary too: their edges must pair like any other,
    // and a flip flips a whole FACE — outer and inners together — which is why the
    // owning face index travels with every edge use below.
    WeldedRings frs;
    frs.reserve(faces.size());
    for (Face* f : faces) {
        std::vector<std::vector<Point3>> rings;
        if (f != nullptr) {
            rings.push_back(loopRing(f->outerLoop));
            for (Loop* il : f->innerLoops) rings.push_back(loopRing(il));
        }
        frs.push_back(std::move(rings));
    }

    // --- 1. WELD the corner positions at tol (the healer's own coincidence) ----
    struct Ref { std::size_t f, r, k; };
    std::vector<Point3> pts;
    std::vector<Ref> refs;
    for (std::size_t fi = 0; fi < frs.size(); ++fi)
        for (std::size_t ri = 0; ri < frs[fi].size(); ++ri)
            for (std::size_t k = 0; k < frs[fi][ri].size(); ++k) {
                pts.push_back(frs[fi][ri][k]);
                refs.push_back({fi, ri, k});
            }
    if (pts.empty()) return frs;

    DSU dsu;
    clusterPositionsWithin(pts, tol, dsu);
    {   // rewrite every corner to its cluster's survivor position
        std::vector<int> firstOf(pts.size(), -1);
        for (std::size_t i = 0; i < pts.size(); ++i) {
            const int r = dsu.find(static_cast<int>(i));
            if (firstOf[r] < 0) firstOf[r] = static_cast<int>(i);
        }
        for (std::size_t i = 0; i < pts.size(); ++i) {
            const Ref& r = refs[i];
            frs[r.f][r.r][r.k] = pts[firstOf[dsu.find(static_cast<int>(i))]];
        }
    }

    // --- 2. NORMALISE each ring the way heal pass (2) does ---------------------
    // Without this a split edge (a collinear T-vertex on one side of a shared
    // boundary) would read as two edges against one, i.e. as an OPEN body — the
    // healer would then be unguarded on exactly the defect class it repairs.
    for (auto& rings : frs)
        for (auto& ring : rings)
            cleanRingPositions(ring, tol, nullptr);
    return frs;
}

// One closedness verdict, with TWO tolerances (shellClosure below drives it):
//
//   pairTol — the coincidence tolerance the TOPOLOGY is decided at: which corners
//             are one point, and therefore which directed boundary edges pair.
//             The verdict, the edge counts and `boundedVolume` are all at pairTol.
//   volTol  — the coincidence tolerance the RESOLVED volume is measured at, i.e.
//             the heal's own opt.tol. Same pairing (same faces, same orientation
//             propagation), but the ring GEOMETRY is re-welded at volTol first, so
//             `resolvedVolume` is how much material the soup bounds AS THE HEAL AT
//             opt.tol SEES IT. When the two tolerances are equal — which is every
//             case where the sweep did not fire — this is the identical arithmetic
//             on the identical rings and resolvedVolume == boundedVolume exactly.
//
// See Heal.hpp (ShellClosure::resolvedVolume) for the measured defect that made
// two tolerances necessary.
ShellClosure closureAt(const std::vector<Face*>& faces, double pairTol, double volTol) {
    ShellClosure sc;
    sc.pairingTol = pairTol;
    double tol = pairTol;
    if (!(tol > 0.0)) tol = 1e-12;
    if (faces.empty()) return sc;

    WeldedRings frs = weldedRings(faces, tol);
    std::size_t nCorners = 0;
    for (const auto& rings : frs) for (const auto& r : rings) nCorners += r.size();
    if (nCorners == 0) return sc;

    // --- 3. compact ids for the surviving positions ---------------------------
    // Every remaining corner is a bit-identical copy of a survivor position, so
    // exact equality is the right (and only correct) key here.
    struct PKey {
        double x, y, z;
        bool operator==(const PKey& o) const { return x == o.x && y == o.y && z == o.z; }
    };
    struct PKeyHash {
        std::size_t operator()(const PKey& k) const {
            std::uint64_t h = 1469598103934665603ull;
            auto mix = [&](double v) {
                std::uint64_t b = 0;
                std::memcpy(&b, &v, sizeof(double));
                h ^= b + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2);
            };
            mix(k.x); mix(k.y); mix(k.z);
            return static_cast<std::size_t>(h);
        }
    };
    std::unordered_map<PKey, std::uint32_t, PKeyHash> idOf;
    idOf.reserve(nCorners * 2);
    auto idFor = [&](const Point3& p) -> std::uint32_t {
        PKey k{p.x, p.y, p.z};
        auto it = idOf.find(k);
        if (it != idOf.end()) return it->second;
        const std::uint32_t id = static_cast<std::uint32_t>(idOf.size());
        idOf.emplace(k, id);
        return id;
    };

    // --- 4. PAIR the directed boundary edges ----------------------------------
    struct Use { std::size_t face; bool forward; };
    struct EdgeRec { int uses = 0; Use u[2]{}; };
    std::unordered_map<std::uint64_t, EdgeRec> em;
    em.reserve(nCorners * 2);
    for (std::size_t fi = 0; fi < frs.size(); ++fi) {
        for (const auto& ring : frs[fi]) {
            const std::size_t L = ring.size();
            if (L < 3) continue;                    // collapsed away — carries no boundary
            for (std::size_t i = 0; i < L; ++i) {
                const std::uint32_t a = idFor(ring[i]);
                const std::uint32_t b = idFor(ring[(i + 1) % L]);
                if (a == b) continue;               // (2) already removed these; belt and braces
                const std::uint32_t lo = (a < b) ? a : b;
                const std::uint32_t hi = (a < b) ? b : a;
                const std::uint64_t key = (static_cast<std::uint64_t>(lo) << 32) | hi;
                EdgeRec& rec = em[key];
                if (rec.uses < 2) rec.u[rec.uses] = Use{fi, (a < b)};
                ++rec.uses;
            }
        }
    }
    sc.edges = em.size();
    if (sc.edges == 0) return sc;                   // nothing bounded (Open, the default)

    for (const auto& kv : em) {
        const EdgeRec& rec = kv.second;
        if (rec.uses == 1)      ++sc.freeEdges;
        else if (rec.uses >= 3) ++sc.nonManifoldEdges;
        else if (rec.u[0].forward == rec.u[1].forward) ++sc.misorientedEdges;
    }
    if (sc.freeEdges > 0)             { sc.verdict = ShellClosureVerdict::Open;          return sc; }
    if (sc.nonManifoldEdges > 0)      { sc.verdict = ShellClosureVerdict::NonManifold;   return sc; }
    sc.verdict = (sc.misorientedEdges > 0) ? ShellClosureVerdict::InconsistentlyWound
                                           : ShellClosureVerdict::Closed;

    // --- 5. PROPAGATE a consistent orientation across the pairing --------------
    // Every edge is used exactly twice, so the dual graph is well defined. rel[f]
    // is +1 to keep face f's input winding and -1 to flip it; two uses of an edge
    // are consistent iff they run OPPOSITE ways, so rel[b] = rel[a] * (opposite ? +1 : -1).
    // A conflict means the 2-cycle is non-orientable (no volume is defined) — we
    // then bound nothing and stand down, which is the no-false-refusal direction.
    const std::size_t nF = frs.size();
    std::vector<std::vector<std::pair<std::size_t, int>>> adj(nF);
    bool conflict = false;
    for (const auto& kv : em) {
        const EdgeRec& rec = kv.second;
        const int sgn = (rec.u[0].forward != rec.u[1].forward) ? +1 : -1;
        if (rec.u[0].face == rec.u[1].face) { if (sgn < 0) conflict = true; continue; }
        adj[rec.u[0].face].push_back({rec.u[1].face, sgn});
        adj[rec.u[1].face].push_back({rec.u[0].face, sgn});
    }
    std::vector<int> rel(nF, 0);

    // The CONNECTED COMPONENTS of the dual graph, and the per-face relative
    // orientation inside each. Both are properties of the PAIRING alone — they do
    // not depend on where the corners ended up — which is what lets the same
    // 2-cycle be measured at a second tolerance below.
    std::vector<std::vector<std::size_t>> comps;
    for (std::size_t seed = 0; seed < nF && !conflict; ++seed) {
        if (rel[seed] != 0) continue;
        std::vector<std::size_t> comp;
        std::queue<std::size_t> q;
        rel[seed] = +1; q.push(seed); comp.push_back(seed);
        while (!q.empty()) {
            const std::size_t cur = q.front(); q.pop();
            for (const auto& e : adj[cur]) {
                const int want = rel[cur] * e.second;
                if (rel[e.first] == 0) { rel[e.first] = want; q.push(e.first); comp.push_back(e.first); }
                else if (rel[e.first] != want) { conflict = true; }
            }
        }
        comps.push_back(std::move(comp));
    }
    if (conflict) return sc;                        // non-orientable: no volume is defined

    // How much material this 2-cycle bounds when its corners sit where a weld at
    // ONE given tolerance put them. Per-face volume contribution and area weight
    // are measured about that ring set's own BOUNDING-BOX CENTRE: for a closed
    // surface the divergence sum is translation-invariant, and recentring minimises
    // the per-face magnitudes, so `scaleOut` is a position-free scale to judge "is
    // there any material here" against.
    auto measure = [&](const WeldedRings& rs, double* scaleOut) -> double {
        Point3 lo{0,0,0}, hi{0,0,0};
        bool first = true;
        for (const auto& rings : rs)
            for (const auto& ring : rings)
                for (const Point3& p : ring) {
                    if (first) { lo = hi = p; first = false; continue; }
                    lo.x = std::min(lo.x, p.x); lo.y = std::min(lo.y, p.y); lo.z = std::min(lo.z, p.z);
                    hi.x = std::max(hi.x, p.x); hi.y = std::max(hi.y, p.y); hi.z = std::max(hi.z, p.z);
                }
        const Point3 c{(lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5, (lo.z + hi.z) * 0.5};
        auto recentred = [&](const std::vector<Point3>& ring) {
            std::vector<Point3> out; out.reserve(ring.size());
            for (const Point3& p : ring) out.push_back(Point3{p.x - c.x, p.y - c.y, p.z - c.z});
            return out;
        };
        std::vector<double> vOf(nF, 0.0), wOf(nF, 0.0);
        double scale = 0.0;
        for (std::size_t fi = 0; fi < nF && fi < rs.size(); ++fi) {
            for (std::size_t ri = 0; ri < rs[fi].size(); ++ri) {
                if (rs[fi][ri].size() < 3) continue;
                const std::vector<Point3> r = recentred(rs[fi][ri]);
                const double v = polyVolumeContribution(r);
                const double w = polyArea(r);
                if (ri == 0) { vOf[fi] += v; wOf[fi] += w; }
                else         { vOf[fi] -= v; wOf[fi] -= w; }   // inner loops subtract
            }
            scale += std::fabs(vOf[fi]);
        }
        if (scaleOut != nullptr) *scaleOut = scale;
        double total = 0.0;
        for (const auto& comp : comps) {
            // The component's GLOBAL sign is free (a closed shell may be read either
            // way round). Choose it to agree, BY AREA, with the input's own winding:
            // that makes a minority of backwards faces read as the error they are,
            // while a hollow enclosure's deliberately inward-wound void still subtracts.
            double agree = 0.0, vol = 0.0;
            for (std::size_t f : comp) { agree += rel[f] * wOf[f]; vol += rel[f] * vOf[f]; }
            total += (agree < 0.0) ? -vol : vol;
        }
        return std::fabs(total);
    };

    sc.boundedVolume = measure(frs, &sc.volumeScale);
    sc.boundsMaterial = (sc.volumeScale > 0.0) && (sc.boundedVolume > 1e-9 * sc.volumeScale);

    // The SECOND measurement: the same 2-cycle, its corners welded at the heal's own
    // tolerance instead. Skipped (and simply copied) when the two tolerances are the
    // same number, so the common path costs nothing and is bit-identical; skipped
    // entirely when this rung bounds nothing, because nothing downstream reads a
    // resolved volume for a body the guard does not arm on.
    if (volTol == pairTol || !sc.boundsMaterial) {
        sc.resolvedVolume = sc.boundedVolume;
    } else {
        sc.resolvedVolume = measure(weldedRings(faces, volTol), nullptr);
    }
    // Judged against the SAME scale as boundedVolume — the scale of the body that is
    // really there — so that a collapsed ring set's floating-point residue reads as
    // the zero it is, rather than as material relative to its own vanished scale.
    sc.resolvesMaterial = (sc.volumeScale > 0.0) && (sc.resolvedVolume > 1e-9 * sc.volumeScale);
    return sc;
}

} // anonymous namespace

ShellClosure shellClosure(const std::vector<Face*>& faces, double tol) {
    if (!(tol > 0.0)) tol = 1e-12;

    // The verdict AT the heal's own tolerance is the primary one, and the one
    // reported when nothing arms: it is the input as the healer will see it.
    ShellClosure atTol = closureAt(faces, tol, tol);
    if (atTol.boundsMaterial) return atTol;

    // ---- THE TOLERANCE SWEEP, and the measured reason it is here -------------
    // A single scalar tolerance cannot separate "close this 1e-4 gap" from "do not
    // merge this 0.001 wall thickness". When opt.tol reaches the part's own
    // thickness the weld folds the body flat before it can be paired, and the
    // verdict comes back NonManifold (coincident faces) or Open — which would
    // stand the guard down on exactly the input that is about to be destroyed.
    // MEASURED: the T-137 plate (100 x 100 x 0.001) at the production quiet
    // setting precision=0.001 read NONMANIFOLD and returned ok=true with 100% of
    // the material gone, and the whole sub-tolerance-gap sweep (nudge 1e-4 at
    // tol 1e-3) read NONMANIFOLD 12/12 and was silent 12/12.
    //
    // So the predicate is stated over the whole range instead of one point: THE
    // INPUT BOUNDED A BODY IF ITS FACES FORM A MATERIAL-ENCLOSING CLOSED 2-CYCLE
    // AT SOME COINCIDENCE TOLERANCE NO COARSER THAN THE HEAL'S OWN. Going FINER
    // can only ever un-merge things the coarse tolerance fused — it can never
    // close a gap that tol left open — so the sweep adds arming in exactly one
    // situation (the tolerance dissolved the body) and in no other. It therefore
    // cannot manufacture a false refusal on a genuinely open input: an open tube
    // is open at every tolerance.
    //
    // The floor is 1e-9 of the bounding-box diagonal — the scale at which two
    // corner positions are the same point to double precision — so the sweep is
    // units-free and stops rather than running away.
    double lo3[3] = {0, 0, 0}, hi3[3] = {0, 0, 0};
    bool first = true;
    auto seePt = [&](const Point3& p) {
        const double v[3] = {p.x, p.y, p.z};
        if (first) { for (int i = 0; i < 3; ++i) { lo3[i] = hi3[i] = v[i]; } first = false; return; }
        for (int i = 0; i < 3; ++i) { lo3[i] = std::min(lo3[i], v[i]); hi3[i] = std::max(hi3[i], v[i]); }
    };
    for (Face* f : faces) {
        if (f == nullptr) continue;
        for (const Point3& p : loopRing(f->outerLoop)) seePt(p);
        for (Loop* il : f->innerLoops) for (const Point3& p : loopRing(il)) seePt(p);
    }
    const double dx = hi3[0] - lo3[0], dy = hi3[1] - lo3[1], dz = hi3[2] - lo3[2];
    const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    const double floorTol = (diag > 0.0) ? (1e-9 * diag) : 1e-12;

    // HALVING, not decades: the gap that has to be closed and the thickness that
    // must NOT be merged can sit inside one decade of each other, and a decade
    // ladder then steps straight over the window between them. MEASURED with a
    // x0.1 ladder on the sub-tolerance sweep (nudge 1e-4 at tol 1e-3, where 1e-4
    // is not exactly representable so the single rung at 1e-4 misses by an ulp):
    // 8 of 12 armed, 4 still silent. Halving closes the window.
    //
    // EARLY EXIT: making the tolerance finer can only ever un-merge, so free edges
    // do not decrease as it falls — once two consecutive rungs come back OPEN,
    // every finer rung is open too and the walk is pointless. This keeps the sweep
    // off the hot path for the common case (a genuinely open soup costs two extra
    // linear passes; a healthy closed one costs none, because it armed at `tol`).
    double t = tol;
    int consecutiveOpen = 0;
    for (int step = 0; step < 24; ++step) {
        t *= 0.5;
        if (t < floorTol) break;
        // pairTol = t (the rung that can see the body), volTol = tol (the heal's own
        // coincidence). The rung decides WHETHER a body is there; the heal's own
        // tolerance decides HOW MUCH OF IT the heal is able to see — which is the
        // only "before" the material leg may legitimately subtract its output from.
        ShellClosure c = closureAt(faces, t, tol);
        if (c.boundsMaterial) return c;
        // Only a RIM (freeEdges > 0) counts toward the early exit. A verdict of Open
        // with NO edges at all is the opposite signal — the tolerance collapsed every
        // ring below a triangle, so there is nothing left to pair and the walk must
        // keep going. MEASURED: a 0.01 x 0.01 x 1e-7 body at tol 0.05 (the gate's
        // total-destruction fixture) reports edges=0 for the first ~19 rungs and only
        // then pairs; bailing on it left the guard unarmed on an emptied part.
        if (c.verdict == ShellClosureVerdict::Open && c.freeEdges > 0) {
            if (++consecutiveOpen >= 2) break;
        } else {
            consecutiveOpen = 0;
        }
    }
    return atTol;
}

bool shellBoundsVolume(const std::vector<Face*>& faces, double relEps) {
    // SUM of the signed area vectors vs the SUM of their magnitudes. Gauss says the
    // first is exactly zero for a closed surface; the second is the scale the
    // comparison is made relative to, so the verdict is units- and size-free.
    Point3 total{0, 0, 0};
    double magnitude = 0.0;
    for (Face* f : faces) {
        if (f == nullptr) continue;
        const Point3 a = newellAreaVec(loopRing(f->outerLoop));
        total.x += a.x; total.y += a.y; total.z += a.z;
        magnitude += plen(a);
        for (Loop* il : f->innerLoops) {
            // Inner loops are wound opposite the outer, so their Newell vector
            // already points the other way — ADD it (matching the subtraction
            // shellSurfaceArea/shellSignedVolume perform on the magnitudes).
            const Point3 b = newellAreaVec(loopRing(il));
            total.x += b.x; total.y += b.y; total.z += b.z;
            magnitude += plen(b);
        }
    }
    if (!(magnitude > 0.0)) return false;   // empty / zero-area: nothing to conserve
    if (relEps <= 0.0) relEps = 1e-9;
    return plen(total) <= relEps * magnitude;
}

// ===========================================================================
// healBRep — THE HEAL OP.
// ===========================================================================
HealReport healBRep(TopologyBuilder& tb,
                    const std::vector<Face*>& faces,
                    const HealOptions& opt) {
    HealReport rep;
    if (faces.empty()) { rep.reason = "empty face set"; return rep; }
    for (Face* f : faces) {
        if (f == nullptr || f->outerLoop == nullptr) {
            rep.reason = "a face has no outer loop";
            return rep;
        }
    }

    const double tol  = (opt.tol > 0.0) ? opt.tol : 1e-12;
    [[maybe_unused]] const double tol2 = tol * tol;
    const double sliverAreaEps = (opt.sliverAreaEps > 0.0) ? opt.sliverAreaEps : (tol * tol);
    const double aspectMax = (opt.aspectMax > 0.0) ? opt.aspectMax : 1e4;

    // --- before signature + measured invariants (on the raw defective input) ---
    rep.before = diagnoseShell(faces);
    rep.volumeBefore = shellSignedVolume(faces);
    rep.areaBefore   = shellSurfaceArea(faces);
    // (9) Does the INPUT enclose material? Asked TOPOLOGICALLY on the welded soup,
    // at the heal's own tolerance, because `before.closed` cannot answer it for any
    // real caller (they all hand in an independently-cloned fragment soup) and
    // because the divergence residual cannot answer it either (an open tube passes
    // it; one backwards face fails it). This is what arms the destruction
    // post-condition at the bottom of this function.
    const ShellClosure inputClosure = shellClosure(faces, tol);
    rep.inputClosure        = inputClosure.verdict;
    rep.boundedVolumeBefore  = inputClosure.boundedVolume;
    rep.inputBoundsVolume    = inputClosure.boundsMaterial;
    rep.resolvedVolumeBefore = inputClosure.resolvedVolume;
    rep.inputResolvesVolume  = inputClosure.resolvesMaterial;

    // --- 0. extract every face to vertex-position rings ------------------------
    std::vector<FaceRings> frs;
    frs.reserve(faces.size());
    for (Face* f : faces) frs.push_back(extractFace(f));

    // --- (4)+(1) WELD all ring corner POSITIONS within tol ---------------------
    // Collect every corner position, cluster within tol (tolerance spatial-hash +
    // union-find — the same scheme as Sew::weldNearVertices, here on raw positions
    // so faces that never shared a Vertex* still snap). Each cluster's survivor is
    // its first-seen position. This is BOTH the duplicate-vertex weld (4) AND the
    // gap-fill snap (1): two free-edge endpoints within tol land in one cluster.
    std::vector<Point3> allPts;
    // remember per-corner index back-references so we can rewrite rings.
    struct Ref { std::size_t face; int ring; std::size_t k; }; // ring=-1 outer, >=0 inner
    std::vector<Ref> refs;
    for (std::size_t fi = 0; fi < frs.size(); ++fi) {
        for (std::size_t k = 0; k < frs[fi].outer.size(); ++k) { allPts.push_back(frs[fi].outer[k]); refs.push_back({fi, -1, k}); }
        for (std::size_t ri = 0; ri < frs[fi].inners.size(); ++ri)
            for (std::size_t k = 0; k < frs[fi].inners[ri].size(); ++k) { allPts.push_back(frs[fi].inners[ri][k]); refs.push_back({fi, static_cast<int>(ri), k}); }
    }
    const std::size_t nPts = allPts.size();

    DSU dsu; dsu.init(nPts);
    // The SHARED coincidence clustering (clusterPositionsWithin) — the same call
    // shellClosure makes, so the destruction guard and the healer agree by
    // construction on which corners are one point.
    if (opt.weldDuplicateVertices || opt.fillGaps) clusterPositionsWithin(allPts, tol, dsu);
    // Survivor position per cluster (representative = lowest index in the cluster).
    std::vector<Point3> survivorPos(nPts);
    {
        std::vector<int> rep(nPts, -1);
        for (std::size_t i = 0; i < nPts; ++i) {
            int r = dsu.find(static_cast<int>(i));
            if (rep[r] < 0) rep[r] = static_cast<int>(i);
        }
        for (std::size_t i = 0; i < nPts; ++i) survivorPos[i] = allPts[rep[dsu.find(static_cast<int>(i))]];
    }
    // Rewrite every ring corner to its cluster survivor position.
    for (std::size_t i = 0; i < nPts; ++i) {
        const Ref& r = refs[i];
        Point3 sp = survivorPos[i];
        if (r.ring < 0) frs[r.face].outer[r.k] = sp;
        else            frs[r.face].inners[static_cast<std::size_t>(r.ring)][r.k] = sp;
    }
    // Count fixes: distinct input clusters that absorbed >1 corner are "welds".
    {
        std::unordered_map<int, int> clusterSize;
        for (std::size_t i = 0; i < nPts; ++i) ++clusterSize[dsu.find(static_cast<int>(i))];
        // verticesWelded = how many corners merged away across the WHOLE soup.
        std::size_t distinctClusters = clusterSize.size();
        rep.verticesWelded = (nPts >= distinctClusters) ? (nPts - distinctClusters) : 0;
        // gapsClosed = clusters that merge corners from MORE THAN ONE face boundary
        // (a true cross-face gap closure, not a within-ring duplicate).
        if (opt.fillGaps) {
            std::unordered_map<int, std::vector<std::size_t>> clusterFaces;
            for (std::size_t i = 0; i < nPts; ++i) clusterFaces[dsu.find(static_cast<int>(i))].push_back(refs[i].face);
            for (auto& kv : clusterFaces) {
                std::sort(kv.second.begin(), kv.second.end());
                kv.second.erase(std::unique(kv.second.begin(), kv.second.end()), kv.second.end());
                if (kv.second.size() > 1) ++rep.gapsClosed;
            }
        }
    }

    // --- (2) COLLAPSE short edges + merge collinear corners in each ring. -------
    // Two sub-steps, both topology-faithful:
    //   (a) consecutive-duplicate drop: a ring corner within tol of the previous
    //       surviving corner is a ZERO-LENGTH / sub-tol edge — removed (the spec's
    //       short-edge collapse / zero-length-edge removal).
    //   (b) collinear T-vertex removal: a corner C whose PERPENDICULAR distance to
    //       the straight segment between its two ring neighbours A,B is < tol adds no
    //       geometry — it is the artefact of a SPLIT EDGE (a box edge written as two
    //       collinear edges around a mid-vertex). Removing it re-merges the two
    //       collinear edges into one, so the face re-mates with the neighbour across
    //       the FULL edge (the spec's merge-collinear / same-domain-edge heal). Only
    //       removed while the ring stays >= 3 corners (never pinch a face away here;
    //       a genuinely degenerate ring falls to the sliver pass).
    // The SHARED ring normalisation (cleanRingPositions) — the same call
    // shellClosure makes, so a SPLIT EDGE reads the same way to both.
    auto cleanRing = [&](std::vector<Point3>& ring, bool count) {
        cleanRingPositions(ring, tol, count ? &rep.shortEdgesCollapsed : nullptr);
    };
    if (opt.collapseShortEdges) {
        for (auto& fr : frs) { cleanRing(fr.outer, true); for (auto& ir : fr.inners) cleanRing(ir, true); }
    } else {
        // still drop exact duplicates so the sewer gets clean rings; do NOT count.
        for (auto& fr : frs) { cleanRing(fr.outer, false); for (auto& ir : fr.inners) cleanRing(ir, false); }
    }

    // --- (3) SLIVER-FACE removal: drop faces whose outer ring is degenerate. -----
    // We mark a face removable when its outer ring collapsed below 3 corners
    // (degenerate), OR area < sliverAreaEps, OR aspect ratio is degenerate. We then
    // verify the drop re-closes (the re-sew below reports the free-edge delta); a
    // sliver whose removal would OPEN the shell is restored and reported kept.
    std::vector<char> removed(frs.size(), 0);
    std::vector<std::uint32_t> sliverCandidateIds;
    if (opt.removeSliverFaces) {
        for (std::size_t fi = 0; fi < frs.size(); ++fi) {
            const auto& ring = frs[fi].outer;
            bool degenerate = (ring.size() < 3);
            double area = 0.0;
            if (!degenerate) {
                area = polyArea(ring);
                if (area < sliverAreaEps) degenerate = true;
                else if (degenerateAspect(ring, area, aspectMax)) degenerate = true;
            }
            if (degenerate) {
                removed[fi] = 1;
                rep.sliverFacesRemoved++;
                sliverCandidateIds.push_back(frs[fi].src ? frs[fi].src->id : 0);
            }
        }
    } else {
        // Faces that collapsed below a triangle cannot be rebuilt; they must be
        // dropped regardless (a 0/1/2-corner ring is not a face). Report them kept-
        // as-unfixed only if removeSliverFaces is off, since we still can't sew them.
        for (std::size_t fi = 0; fi < frs.size(); ++fi)
            if (frs[fi].outer.size() < 3) { removed[fi] = 1; rep.keptSliverFaceIds.push_back(frs[fi].src ? frs[fi].src->id : 0); }
    }

    // --- (7) SELF-INTERSECTION REPAIR (runs on the cleaned rings, before rebuild). --
    // Fan-tessellate every surviving face's outer ring; classify each non-adjacent
    // triangle pair across DIFFERENT faces with the EXACT tri-tri test. Where a face
    // PROPERLY interpenetrates another:
    //   * if one offender is a small/removable sliver (area below selfIntersectSmallFrac
    //     of the largest face) -> drop that sliver (honest "trim a tiny self-overlap"),
    //   * else -> report the FACE-ID pair UNFIXED (a structural self-intersection the
    //     general arrangement repair — the follow-up — must handle; never papered over).
    // Adjacency: faces that share ANY welded ring-corner position are NOT tested
    // against each other (a fan meeting cleanly along a shared boundary is legitimate),
    // mirroring SelfIntersect.cpp's shared-vertex skip rule.
    if (opt.repairSelfIntersection) {
        // Build per-face tessellations + a coarse area for the small/large gauge,
        // and the set of welded corner positions per face (adjacency key).
        struct FaceTess { std::vector<Tri3> tris; double area; bool live; };
        std::vector<FaceTess> ft(frs.size());
        std::vector<std::unordered_set<long long>> cornerKeys(frs.size());
        double maxArea = 0.0;
        const double keyCell = (tol > 0.0) ? tol : 1e-12;
        auto cornerKey = [&](const Point3& p) -> long long {
            // Hash the tol-snapped lattice cell to an id; coincident corners share it.
            const long long cx = qcell(p.x, keyCell), cy = qcell(p.y, keyCell), cz = qcell(p.z, keyCell);
            std::uint64_t h = 1469598103934665603ull;
            auto mix = [&](long long v) { h ^= static_cast<std::uint64_t>(v) + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2); };
            mix(cx); mix(cy); mix(cz);
            return static_cast<long long>(h);
        };
        for (std::size_t fi = 0; fi < frs.size(); ++fi) {
            ft[fi].live = (!removed[fi] && frs[fi].outer.size() >= 3);
            ft[fi].area = ft[fi].live ? polyArea(frs[fi].outer) : 0.0;
            if (ft[fi].live) {
                fanTriangulate(frs[fi].outer, ft[fi].tris);
                for (const Point3& p : frs[fi].outer) cornerKeys[fi].insert(cornerKey(p));
                maxArea = std::max(maxArea, ft[fi].area);
            }
        }
        const double smallAreaCut = maxArea * opt.selfIntersectSmallFrac;
        auto sharesCorner = [&](std::size_t i, std::size_t j) -> bool {
            const auto& a = cornerKeys[i]; const auto& b = cornerKeys[j];
            const auto& small = (a.size() <= b.size()) ? a : b;
            const auto& big   = (a.size() <= b.size()) ? b : a;
            for (long long k : small) if (big.count(k)) return true;
            return false;
        };
        for (std::size_t i = 0; i < frs.size(); ++i) {
            if (!ft[i].live) continue;
            for (std::size_t j = i + 1; j < frs.size(); ++j) {
                if (!ft[j].live) continue;
                if (sharesCorner(i, j)) continue;          // legitimate shared boundary
                bool hit = false;
                for (const Tri3& ta : ft[i].tris) {
                    for (const Tri3& tb2 : ft[j].tris) {
                        if (trisInterpenetrate(ta, tb2)) { hit = true; break; }
                    }
                    if (hit) break;
                }
                if (!hit) continue;
                // A real interpenetration. Is EITHER offender a small/removable sliver?
                const bool iSmall = (ft[i].area <= smallAreaCut);
                const bool jSmall = (ft[j].area <= smallAreaCut);
                if (iSmall || jSmall) {
                    const std::size_t drop = (iSmall && (!jSmall || ft[i].area <= ft[j].area)) ? i : j;
                    removed[drop] = 1;
                    ft[drop].live = false;
                    rep.selfIntersectingFacesRemoved++;
                } else {
                    // Structural self-intersection between two full-size faces: honest.
                    rep.unfixedSelfIntersectionFacePairs.push_back(
                        {frs[i].src ? frs[i].src->id : 0u, frs[j].src ? frs[j].src->id : 0u});
                }
            }
        }
    }

    // --- 5. REBUILD fresh independent faces from the cleaned outer rings + SEW. ---
    // Each surviving face becomes a brand-new Face with PRIVATE vertices/edges built
    // from its cleaned outer ring (inner rings re-added as inner loops). Then the
    // PROVEN sewer (sewFaces) re-mates the coincident boundaries. This is the single
    // site of new-topology minting and it goes through the validated matcher.
    //
    // To support the ORIENTATION (6) and NON-MANIFOLD (8) passes — each of which must
    // re-sew after flipping / dropping rings — the rebuild+sew is a reusable closure
    // over a per-ring FLIP flag (reverse the outer ring's corner order). flip[fi] only
    // ever applies to a surviving face.
    SewOptions sopt;
    sopt.tol = tol;
    sopt.midSamples = opt.sewMidSamples;
    sopt.weldVertices = true;

    auto buildRingVerts = [&](const std::vector<Point3>& ring, bool flip) -> std::vector<Vertex*> {
        std::vector<Vertex*> vs; vs.reserve(ring.size());
        if (!flip) { for (const Point3& p : ring) vs.push_back(tb.makeVertex(p)); }
        else       { for (std::size_t k = ring.size(); k-- > 0; ) vs.push_back(tb.makeVertex(ring[k])); }
        return vs;
    };
    // ---- CHUNK 2 (curved-preserving heal): carry the source face's ANALYTIC ------
    // SURFACE + parameter-domain trim window onto every REBUILT face, so a healed
    // curved/analytic solid keeps its EXACT geometry on export instead of faceting.
    //
    // WHY: healBRep rebuilds each face as a fresh bare polygon (surface==null). On
    // export, occtFromNativeSolid mis-classifies a null-surface curved face as
    // "planarSimple" (NativeOcctBridge.cpp:1483-1484 skips the kind test when
    // surface==null) and rebuilds it as planar polygons — the measured
    // 28.2289-vs-28.2743 cylinder regression. Re-attaching `surface` makes the
    // analytic reconstructors (occtAnalytic/Cone/Sphere/Torus-FromNativeSolid) fire
    // (they key off face->surface + its kind, and re-derive the trim from the 3D
    // ring points), and makes the export VOLUME CROSS-CHECK pass: that check
    // compares the rebuilt OCCT volume against native massProperties, whose
    // curved-face integrator integrates the analytic surface over [u0,u1]x[v0,v1]
    // (MassProps.cpp:116-121) — so u0..v1 must be carried too, else it integrates
    // the default [0,1]^2 domain and the cross-check declines back to faceted.
    //
    // LIFETIME: the source faces are cloneFaceIndependent clones owned by THIS same
    // builder `tb` (NativeShapeHealBridge.cpp:44), and their Surface objects live in
    // tb->surfaces_; we still CLONE (makeSurface + copy) rather than share, matching
    // cloneFaceIndependent, so the rebuilt face aliases nothing.
    //
    // FLIP / SLIVER-MERGE (the honest conservative part): `surface` and the trim
    // window [u0,u1]x[v0,v1] are the surface's PARAMETER DOMAIN — invariant under a
    // 3D-ring winding flip or a sub-tol weld-snap, so they are ALWAYS carried. The
    // ORDER/COUNT-SENSITIVE parameter-space data (vertexUV param-triangle + regionUV
    // trimmed-region polygons, both in 1:1 correspondence with the ORIGINAL outer
    // ring) is carried ONLY when the rebuilt ring is that ring VERBATIM — no
    // orientation flip AND unchanged corner count. When pass (6)/(8) flipped the ring
    // or the weld/collapse changed its cardinality, that correspondence is broken, so
    // those fields are DROPPED and massProperties falls back to the flip-invariant
    // [u0,u1]x[v0,v1] rectangle integral (correct for a full analytic patch). This is
    // the ring-flip/face-merge interaction the Chunk-1 header flagged as needing the
    // core.mjs 34/34 curved-solid gate to validate (main-thread build-gated).
    auto carryFaceGeometry = [&tb](Face* nf, const FaceRings& fr, bool fl) {
        Face* sf = fr.src;
        if (sf == nullptr) return;
        if (sf->surface != nullptr) {
            Surface* ns = tb.makeSurface();
            *ns = *sf->surface;          // deep copy into tb (no aliasing)
            nf->surface = ns;
        }
        nf->u0 = sf->u0; nf->u1 = sf->u1; nf->v0 = sf->v0; nf->v1 = sf->v1;
        const bool ringVerbatim =
            !fl && (sf->vertexUV.empty() || sf->vertexUV.size() == fr.outer.size());
        if (ringVerbatim) {
            nf->paramTri      = sf->paramTri;
            nf->vertexUV      = sf->vertexUV;
            nf->regionUV      = sf->regionUV;
            nf->regionOuterUV = sf->regionOuterUV;
            nf->regionInnerUV = sf->regionInnerUV;
            nf->boolHoled     = sf->boolHoled;
        }
    };

    // Rebuild every surviving (non-removed, >=3-gon) ring into a fresh face and sew.
    // `flip` is indexed by frs position; `faceOfRing` maps each built face back to its
    // frs index so the orientation/non-manifold passes can act per source ring.
    auto rebuildAndSew = [&](const std::vector<char>& flip,
                             std::vector<Face*>& healedOut,
                             std::vector<std::size_t>& faceOfRing) -> SewResult {
        healedOut.clear(); faceOfRing.clear();
        healedOut.reserve(frs.size());
        for (std::size_t fi = 0; fi < frs.size(); ++fi) {
            if (removed[fi]) continue;
            if (frs[fi].outer.size() < 3) continue;
            const bool fl = (fi < flip.size()) ? (flip[fi] != 0) : false;
            Face* nf = tb.makeFace();
            tb.addOuterLoopToFace(nf, buildRingVerts(frs[fi].outer, fl));
            for (const auto& ir : frs[fi].inners) {
                // inner loops are oriented opposite the outer, so flip them WITH it.
                if (ir.size() >= 3) tb.addInnerLoopToFace(nf, buildRingVerts(ir, fl));
            }
            carryFaceGeometry(nf, frs[fi], fl);   // CHUNK 2: keep analytic geometry
            healedOut.push_back(nf);
            faceOfRing.push_back(fi);
        }
        if (healedOut.empty()) return SewResult{};
        return sewFaces(tb, healedOut, sopt);
    };

    std::vector<char> flip(frs.size(), 0);   // per-ring orientation flip (pass 6/8 mutate)
    std::vector<Face*> healed;
    std::vector<std::size_t> faceOfRing;
    SewResult sr = rebuildAndSew(flip, healed, faceOfRing);

    if (healed.empty()) {
        // Everything was a sliver — honest report, nothing to sew.
        rep.after = SewDiagnosis{};
        rep.faces = healed;
        rep.volumeAfter = 0.0;
        rep.areaAfter   = 0.0;
        if (rep.inputBoundsVolume) {
            // (9) TOTAL DESTRUCTION of a body that bounded a volume. This branch used
            // to return ok=TRUE — a successful repair that produced nothing at all.
            rep.ok = false;
            rep.destructionRefused = true;
            rep.reason = "repair emptied the body: every face of a solid was classified a "
                         "sliver and dropped (a thin-walled part — foil, gasket, membrane — "
                         "whose walls exceed the aspect-ratio limit) — refusing rather than "
                         "returning an empty shell";
            return rep;
        }
        rep.ok = true;
        rep.reason = "all faces removed as slivers";
        return rep;
    }

    // --- (6) FACE-ORIENTATION REPAIR. ----------------------------------------------
    // Across the sewn shell, 2-colour the face-adjacency graph by ORIENTATION
    // PROPAGATION: walking a CONSISTENT shared edge (its two coedges run opposite)
    // keeps a neighbour's colour; walking a MIS-ORIENTED shared edge (both coedges
    // agree in sense — the misoriented signal the sewer reports) flips it. The
    // resulting colour partitions each connected component into {keep, flip}; the
    // minority colour is the wrongly-wound set. Reversing those rings makes every
    // shared edge a clean opposite-sense manifold pair. Then gauge the whole shell to
    // the OUTWARD sense via the sign of its divergence-theorem volume (Check.cpp's
    // robust global outward test): a globally-inverted-but-consistent shell is flipped
    // wholesale. Reuses sewFaces only — no second matcher.
    if (opt.repairOrientation && !healed.empty()) {
        const std::size_t nF = healed.size();
        std::unordered_map<Face*, std::size_t> faceIndex;
        for (std::size_t k = 0; k < nF; ++k) faceIndex[healed[k]] = k;

        // Adjacency over shared (2-coedge) edges: (neighbour, sameOrientation?).
        // sameOrientation == true when the edge is already CONSISTENT (coedges
        // opposite); false when MIS-ORIENTED (coedges agree -> neighbour must flip).
        std::vector<std::vector<std::pair<std::size_t, bool>>> adj(nF);
        std::unordered_set<Edge*> seenE;
        auto coedgeFace = [](Coedge* c) -> Face* { return (c && c->loop) ? c->loop->face : nullptr; };
        for (Face* f : healed) {
            std::vector<Coedge*> ces;
            // walk outer + inner loops to reach every shared edge of this face.
            auto walk = [&](Loop* lp) {
                if (!lp || !lp->first) return;
                Coedge* c = lp->first;
                for (std::size_t i = 0; i < lp->coedgeCount && c; ++i) { ces.push_back(c); c = c->next; }
            };
            walk(f->outerLoop);
            for (Loop* il : f->innerLoops) walk(il);
            for (Coedge* c : ces) {
                Edge* e = c->edge;
                if (!e || !e->coedgeA || !e->coedgeB) continue;   // free / non-manifold: skip here
                if (!seenE.insert(e).second) continue;
                Face* fa = coedgeFace(e->coedgeA);
                Face* fb = coedgeFace(e->coedgeB);
                auto ia = faceIndex.find(fa), ib = faceIndex.find(fb);
                if (ia == faceIndex.end() || ib == faceIndex.end() || ia->second == ib->second) continue;
                const bool consistent = (e->coedgeA->forward != e->coedgeB->forward);
                adj[ia->second].push_back({ib->second, consistent});
                adj[ib->second].push_back({ia->second, consistent});
            }
        }

        // BFS 2-colour: colour[k] == 0 keep, 1 flip-relative-to-root. A consistent
        // edge keeps the neighbour's colour; a mis-oriented edge flips it.
        std::vector<int> colour(nF, -1);
        bool consistentColourable = true;
        for (std::size_t s = 0; s < nF; ++s) {
            if (colour[s] != -1) continue;
            colour[s] = 0;
            std::queue<std::size_t> q; q.push(s);
            while (!q.empty()) {
                std::size_t u = q.front(); q.pop();
                for (auto [v, consistent] : adj[u]) {
                    const int want = consistent ? colour[u] : (colour[u] ^ 1);
                    if (colour[v] == -1) { colour[v] = want; q.push(v); }
                    else if (colour[v] != want) consistentColourable = false; // odd cycle: unresolvable
                }
            }
        }

        if (consistentColourable) {
            // Within each connected component flip the MINORITY colour (fewest faces),
            // so the smallest set of rings is reversed. Component id via union of the
            // adjacency (a second BFS over the same graph, ignoring orientation).
            std::vector<int> comp(nF, -1);
            int nComp = 0;
            for (std::size_t s = 0; s < nF; ++s) {
                if (comp[s] != -1) continue;
                std::queue<std::size_t> q; q.push(s); comp[s] = nComp;
                while (!q.empty()) { std::size_t u = q.front(); q.pop();
                    for (auto [v, c] : adj[u]) { (void)c; if (comp[v] == -1) { comp[v] = nComp; q.push(v); } } }
                ++nComp;
            }
            // Per component, tally colour-0 vs colour-1 face counts.
            std::vector<std::array<std::size_t,2>> tally(nComp, {0,0});
            for (std::size_t k = 0; k < nF; ++k) tally[comp[k]][colour[k]]++;
            std::vector<char> wantFlip(nF, 0);
            for (std::size_t k = 0; k < nF; ++k) {
                const int mino = (tally[comp[k]][1] < tally[comp[k]][0]) ? 1 : 0;
                if (colour[k] == mino && tally[comp[k]][0] != tally[comp[k]][1]) wantFlip[k] = 1;
                // exact tie (a 2-face component split 1-1): flip colour-1 deterministically.
                else if (tally[comp[k]][0] == tally[comp[k]][1] && colour[k] == 1) wantFlip[k] = 1;
            }
            // Translate per-face flips back to per-RING flips and rebuild+resew.
            bool anyFlip = false;
            std::vector<char> ringFlip(frs.size(), 0);
            for (std::size_t k = 0; k < nF; ++k) {
                if (wantFlip[k]) { ringFlip[faceOfRing[k]] = 1; anyFlip = true; }
            }
            if (anyFlip) {
                std::vector<Face*> healed2; std::vector<std::size_t> for2;
                SewResult sr2 = rebuildAndSew(ringFlip, healed2, for2);
                if (!healed2.empty()) {
                    healed.swap(healed2); faceOfRing.swap(for2); sr = sr2;
                    for (char c : ringFlip) if (c) ++rep.facesFlipped;
                    flip = ringFlip;
                }
            }
            // GLOBAL outward gauge: if the (now consistent) shell winds INWARD
            // (signed volume < 0), reverse EVERY surviving ring so the outward normal
            // sense is correct, then rebuild+resew once more. Only meaningful for a
            // CLOSED shell (outward sense is undefined for an open sheet with boundary),
            // so we gate the wholesale flip on closure — an open shell is left as-is.
            const double vol = shellSignedVolume(healed);
            if (sr.diagnosis.closed && vol < 0.0) {
                std::vector<char> allFlip = flip;
                for (std::size_t fi = 0; fi < frs.size(); ++fi)
                    if (!removed[fi] && frs[fi].outer.size() >= 3) allFlip[fi] ^= 1;
                std::vector<Face*> healed3; std::vector<std::size_t> for3;
                SewResult sr3 = rebuildAndSew(allFlip, healed3, for3);
                if (!healed3.empty()) {
                    healed.swap(healed3); faceOfRing.swap(for3); sr = sr3; flip = allFlip;
                    // facesFlipped counts faces whose FINAL orientation differs from input.
                    rep.facesFlipped = 0;
                    for (char c : flip) if (c) ++rep.facesFlipped;
                }
            }
        }
    }

    // --- (8) NON-MANIFOLD RESOLUTION (detect + duplicate-face drop + report). -------
    // After the (possibly re-oriented) sew, an edge with 3+ coedges is non-manifold.
    // Where the surplus use is an EXACT DUPLICATE face (same welded outer ring up to
    // rotation/reflection) the duplicate is dropped to restore a manifold edge, then
    // we rebuild+resew. Any remaining 3+-coedge edge, and any non-manifold VERTEX
    // (incident-face fan not a single cycle), is reported UNFIXED (honest: the
    // 2-manifold model cannot represent the join).
    if (opt.resolveNonManifold && !healed.empty()) {
        // Detect duplicate source rings among the SURVIVING faces (canonical key of
        // the welded outer-ring corner multiset, rotation/reflection invariant).
        auto canonKeyOfRing = [&](const std::vector<Point3>& ring) -> std::string {
            // Quantise every corner to the tol lattice, build the rotation/reflection-
            // canonical string so two identical rings (any start, either winding) match.
            const double cell = (tol > 0.0) ? tol : 1e-12;
            std::vector<std::array<long long,3>> q; q.reserve(ring.size());
            for (const Point3& p : ring) q.push_back({qcell(p.x, cell), qcell(p.y, cell), qcell(p.z, cell)});
            const std::size_t n = q.size();
            if (n == 0) return std::string();
            auto serialise = [&](const std::vector<std::array<long long,3>>& v) -> std::string {
                std::string s; s.reserve(v.size() * 24);
                for (auto& a : v) { s += std::to_string(a[0]); s += ','; s += std::to_string(a[1]); s += ','; s += std::to_string(a[2]); s += ';'; }
                return s;
            };
            std::string best;
            for (int refl = 0; refl < 2; ++refl) {
                std::vector<std::array<long long,3>> base = q;
                if (refl) std::reverse(base.begin(), base.end());
                for (std::size_t r = 0; r < n; ++r) {
                    std::vector<std::array<long long,3>> rot; rot.reserve(n);
                    for (std::size_t i = 0; i < n; ++i) rot.push_back(base[(r + i) % n]);
                    std::string s = serialise(rot);
                    if (best.empty() || s < best) best = s;
                }
            }
            return best;
        };
        // Map canonical-ring-key -> surviving frs indices carrying that ring.
        std::unordered_map<std::string, std::vector<std::size_t>> byRing;
        for (std::size_t fi = 0; fi < frs.size(); ++fi) {
            if (removed[fi] || frs[fi].outer.size() < 3) continue;
            byRing[canonKeyOfRing(frs[fi].outer)].push_back(fi);
        }
        bool droppedDup = false;
        for (auto& kv : byRing) {
            // keep the first, drop the rest (exact-duplicate faces).
            for (std::size_t k = 1; k < kv.second.size(); ++k) {
                removed[kv.second[k]] = 1;
                rep.duplicateFacesRemoved++;
                droppedDup = true;
            }
        }
        if (droppedDup) {
            std::vector<Face*> healed4; std::vector<std::size_t> for4;
            SewResult sr4 = rebuildAndSew(flip, healed4, for4);
            if (!healed4.empty()) { healed.swap(healed4); faceOfRing.swap(for4); sr = sr4; }
        }

        // Report any REMAINING non-manifold edges (genuine 3+-face joins) — detected
        // GEOMETRICALLY rather than via the sewer's coedge count. The sewer mates only
        // TWO coedges per Edge (a 3rd coincident boundary is left as a distinct unmerged
        // free Edge), so a 3-faces-on-an-edge join shows up as several Edges sharing one
        // welded endpoint-position pair, NOT as a single 3-coedge Edge. We group every
        // surviving boundary edge by the unordered pair of its welded endpoint lattice
        // cells; any position-edge carried by 3+ distinct faces is non-manifold. We emit
        // the surviving Edge ids on that join so the caller can locate it. This is the
        // honest "cannot represent in a 2-manifold" report — never a forced split.
        {
            const double cell = (tol > 0.0) ? tol : 1e-12;
            auto vkey = [&](const Point3& p) -> std::array<long long,3> {
                return {qcell(p.x, cell), qcell(p.y, cell), qcell(p.z, cell)};
            };
            // position-edge key (unordered endpoint cell pair) -> {faces, edgeIds}.
            struct Join { std::unordered_set<Face*> faces; std::vector<std::uint32_t> edgeIds; };
            std::unordered_map<std::string, Join> joins;
            auto pairKey = [&](const std::array<long long,3>& A, const std::array<long long,3>& B) -> std::string {
                const std::array<long long,3>* lo = &A; const std::array<long long,3>* hi = &B;
                if (B < A) { lo = &B; hi = &A; }
                std::string s;
                for (long long v : *lo) { s += std::to_string(v); s += ','; }
                s += '|';
                for (long long v : *hi) { s += std::to_string(v); s += ','; }
                return s;
            };
            std::unordered_set<Edge*> seenE;
            for (Face* f : healed) {
                auto walk = [&](Loop* lp) {
                    if (!lp || !lp->first) return;
                    Coedge* c = lp->first;
                    for (std::size_t i = 0; i < lp->coedgeCount && c; ++i) {
                        Edge* e = c->edge;
                        if (e && e->start && e->end) {
                            const std::string k = pairKey(vkey(e->start->point), vkey(e->end->point));
                            Join& j = joins[k];
                            j.faces.insert(f);
                            if (seenE.insert(e).second) j.edgeIds.push_back(e->id);
                        }
                        c = c->next;
                    }
                };
                walk(f->outerLoop);
                for (Loop* il : f->innerLoops) walk(il);
            }
            for (auto& kv : joins) {
                if (kv.second.faces.size() >= 3) {
                    for (std::uint32_t id : kv.second.edgeIds)
                        rep.unfixedNonManifoldEdgeReport.push_back(id);
                }
            }
            std::sort(rep.unfixedNonManifoldEdgeReport.begin(), rep.unfixedNonManifoldEdgeReport.end());
            rep.unfixedNonManifoldEdgeReport.erase(
                std::unique(rep.unfixedNonManifoldEdgeReport.begin(), rep.unfixedNonManifoldEdgeReport.end()),
                rep.unfixedNonManifoldEdgeReport.end());
            // Also fold in any genuine 3-coedge Edges the sewer DID flag (defensive).
            for (std::uint32_t id : sr.diagnosis.nonManifoldEdgeIds)
                rep.unfixedNonManifoldEdgeReport.push_back(id);
            std::sort(rep.unfixedNonManifoldEdgeReport.begin(), rep.unfixedNonManifoldEdgeReport.end());
            rep.unfixedNonManifoldEdgeReport.erase(
                std::unique(rep.unfixedNonManifoldEdgeReport.begin(), rep.unfixedNonManifoldEdgeReport.end()),
                rep.unfixedNonManifoldEdgeReport.end());
        }

        // Non-manifold VERTEX detection: a vertex of the rebuilt shell whose incident
        // boundary/edge fan is not a single cycle (two cones / sheets touching at one
        // point). We build, per vertex, the graph whose nodes are the incident faces
        // and whose links join two faces sharing a manifold edge AT that vertex; a
        // single connected fan is manifold, >1 component is a non-manifold pinch.
        {
            // For each vertex, collect the faces touching it and the (vertex-local)
            // manifold-edge links between consecutive coedges.
            std::unordered_map<Vertex*, std::vector<Coedge*>> vertCoedges;
            for (Face* f : healed) {
                auto walk = [&](Loop* lp) {
                    if (!lp || !lp->first) return;
                    Coedge* c = lp->first;
                    for (std::size_t i = 0; i < lp->coedgeCount && c; ++i) {
                        if (c->originVertex()) vertCoedges[c->originVertex()].push_back(c);
                        c = c->next;
                    }
                };
                walk(f->outerLoop);
                for (Loop* il : f->innerLoops) walk(il);
            }
            for (auto& kv : vertCoedges) {
                Vertex* v = kv.first;
                const auto& ces = kv.second;
                if (ces.size() < 3) continue;   // a 2-edge corner cannot pinch
                // Faces incident at v.
                std::vector<Face*> incFaces;
                for (Coedge* c : ces) if (c->loop && c->loop->face) incFaces.push_back(c->loop->face);
                std::sort(incFaces.begin(), incFaces.end());
                incFaces.erase(std::unique(incFaces.begin(), incFaces.end()), incFaces.end());
                if (incFaces.size() < 3) continue;
                std::unordered_map<Face*, int> fidx;
                for (std::size_t i = 0; i < incFaces.size(); ++i) fidx[incFaces[i]] = static_cast<int>(i);
                DSU d; d.init(incFaces.size());
                // Link two faces that share a MANIFOLD edge incident to v.
                for (Coedge* c : ces) {
                    Edge* e = c->edge;
                    if (!e || !e->coedgeA || !e->coedgeB) continue;
                    Face* fa = (e->coedgeA->loop) ? e->coedgeA->loop->face : nullptr;
                    Face* fb = (e->coedgeB->loop) ? e->coedgeB->loop->face : nullptr;
                    if (!fa || !fb) continue;
                    auto ia = fidx.find(fa), ib = fidx.find(fb);
                    if (ia != fidx.end() && ib != fidx.end()) d.unite(ia->second, ib->second);
                }
                // Count components of the incident-face graph.
                std::unordered_set<int> roots;
                for (std::size_t i = 0; i < incFaces.size(); ++i) roots.insert(d.find(static_cast<int>(i)));
                if (roots.size() > 1) {
                    // The fan splits into >1 cone -> non-manifold vertex (honest report).
                    rep.nonManifoldVertexIds.push_back(v->id);
                }
            }
            std::sort(rep.nonManifoldVertexIds.begin(), rep.nonManifoldVertexIds.end());
            rep.nonManifoldVertexIds.erase(
                std::unique(rep.nonManifoldVertexIds.begin(), rep.nonManifoldVertexIds.end()),
                rep.nonManifoldVertexIds.end());
        }
    }

    rep.edgePairsMerged = sr.mergedEdgePairs;
    rep.shell = sr.shell;

    // --- 6. DIAGNOSE after + measure invariants + fill unfixed lists -----------
    rep.after = sr.diagnosis;
    rep.faces = healed;
    rep.volumeAfter = shellSignedVolume(healed);
    rep.areaAfter   = shellSurfaceArea(healed);

    rep.unfixedFreeEdgeIds        = rep.after.freeEdgeIds;
    rep.unfixedNonManifoldEdgeIds = rep.after.nonManifoldEdgeIds;

    // Honesty: if a sliver was removed but the result is now OPEN where the input was
    // closed, the drop opened a hole we could not heal — report those slivers kept-
    // unfixed. (We cannot un-drop after the fact without re-sewing; instead we re-sew
    // WITH the slivers restored and pick whichever result is closed, preferring the
    // healed/no-sliver shell when both close.)
    if (opt.removeSliverFaces && rep.sliverFacesRemoved > 0 &&
        rep.before.closed && !rep.after.closed) {
        // Re-build including the slivers and re-diagnose (respecting the final flips).
        std::vector<Face*> withSlivers;
        for (std::size_t fi = 0; fi < frs.size(); ++fi) {
            if (frs[fi].outer.size() < 3) continue;
            const bool fl = (fi < flip.size()) ? (flip[fi] != 0) : false;
            Face* nf = tb.makeFace();
            tb.addOuterLoopToFace(nf, buildRingVerts(frs[fi].outer, fl));
            for (const auto& ir : frs[fi].inners)
                if (ir.size() >= 3) tb.addInnerLoopToFace(nf, buildRingVerts(ir, fl));
            carryFaceGeometry(nf, frs[fi], fl);   // CHUNK 2: keep analytic geometry
            withSlivers.push_back(nf);
        }
        if (!withSlivers.empty()) {
            SewResult sr2 = sewFaces(tb, withSlivers, sopt);
            if (sr2.diagnosis.closed) {
                // Removing the sliver(s) opened the shell — keep them.
                rep.keptSliverFaceIds = sliverCandidateIds;
                rep.sliverFacesRemoved = 0;
                rep.edgePairsMerged = sr2.mergedEdgePairs;
                rep.shell = sr2.shell;
                rep.after = sr2.diagnosis;
                rep.faces = withSlivers;
                rep.volumeAfter = shellSignedVolume(withSlivers);
                rep.areaAfter   = shellSurfaceArea(withSlivers);
                rep.unfixedFreeEdgeIds        = rep.after.freeEdgeIds;
                rep.unfixedNonManifoldEdgeIds = rep.after.nonManifoldEdgeIds;
            }
        }
    }

    // --- 7. (9) DESTRUCTION POST-CONDITION — refuse on the OUTPUT (T-137). -----
    // Every other refusal in this file is about the INPUT, or about a stage that
    // failed to run; none of them looks at what the heal actually produced. That is
    // how a 100 x 100 x 0.001 plate (a VALID closed solid, V = 10) came back empty
    // with reason "ok". So, in the house style of Chamfer/Draft/Boolean — build the
    // answer, validate it, and DECLINE it if it is not one:
    //
    //   ARMED ONLY WHEN THE INPUT ENCLOSED MATERIAL (rep.inputBoundsVolume, i.e.
    //   shellClosure says every welded boundary edge is used exactly twice AND the
    //   body so bounded is not empty). If the caller handed in an open patch, an
    //   incomplete body, a non-manifold join or a zero-thickness degenerate,
    //   volumeBefore is an origin-dependent surface integral, not an amount of
    //   material, and there is nothing here to conserve — we do not invent a claim
    //   about it. NOTE that an INCONSISTENTLY WOUND closed body IS armed: one face
    //   wound backwards is a defect pass (6) exists to repair, not a licence to
    //   destroy the part, and it was the measured disarm of the previous predicate.
    //
    //   LEG A — CLOSURE. A body that came in closed must not go out open. This is
    //   what the sliver-restore net at lines above was FOR; it keys off
    //   before.closed, which no caller can ever make true, so it has never run.
    //   Leg A asks the same question with the instrument that works on a soup.
    //
    //   LEG B — MATERIAL. |volumeAfter| must be within maxMaterialLossFrac of what
    //   the input actually bounded. ABSOLUTE values and LOSS ONLY, deliberately:
    //   pass (6) may flip a globally-inverted shell (|V| unchanged) or repair a
    //   partly-misoriented one (where the delta is a GAIN), and neither of those is
    //   destruction. The "before" is shellClosure's ORIENTATION-INDEPENDENT
    //   boundedVolume, not the raw signed sum, precisely so that a backwards face
    //   cannot make the part look smaller than it is and thereby hide a loss; the
    //   two are identical whenever the input winding is already consistent. Leg B
    //   is the only leg that can see the quiet version of this defect — the variant
    //   that loses 83% of the material and still returns a CLOSED, BRepCheck-VALID
    //   body with zero unfixed residuals.
    //
    // A refusal is a routing decision: ok=false makes all three callers return the
    // input, so the OCCT ShapeFix fallback answers. Coverage falls, validity rises.
    // The diagnostics above stay fully populated — only `ok`/`reason` refuse.
    if (rep.inputBoundsVolume) {
        if (!rep.after.closed) {
            rep.ok = false;
            rep.destructionRefused = true;
            rep.reason = "repair opened a closed body: the healed shell is no longer watertight "
                         "(walls of a thin-walled part dropped as slivers) — refusing rather "
                         "than returning a solid that is not one";
            return rep;
        }
        // THE BEFORE MUST BE MEASURED AT THE TOLERANCE THE HEAL RAN AT (T-137 r3).
        // `volumeAfter` is what the heal produced at opt.tol, so the only volume it
        // may be subtracted from is the input as opt.tol sees it —
        // `resolvedVolumeBefore`. `boundedVolumeBefore` is measured at the sweep's
        // pairing tolerance, which may be hundreds of times finer, and a volume
        // measured at a finer tolerance is a volume of a DIFFERENT body: two pieces
        // rather than one welded piece, or a feature the heal's own coincidence
        // cannot represent. Subtracting across that gap refused a correct result
        // (see ShellClosure::resolvedVolume for the measured case) and, worse,
        // decided it by a 0.001 gap 250x below the tolerance: the same body with the
        // parts touching exactly was accepted with the identical output.
        //
        // THE ONE EXCEPTION, and it is the T-137 headline itself: when opt.tol
        // dissolves the WHOLE part (`inputResolvesVolume` false — the 100x100x0.001
        // plate healed at precision 0.001 welds its own two faces together), there
        // is no tolerance-consistent comparison to make, and "the tolerance cannot
        // represent this part" is emphatically not a licence to hand back nothing.
        // The material that is really there is then the honest measure, and the
        // refusal routes the part to the OCCT fallback, which is the whole point.
        //
        // WHAT THIS LETS THROUGH, stated plainly: material that lies entirely below
        // opt.tol is now free, however much of it there is — a 1x1x1 box carrying a
        // 100x100x0.0005 sheet healed at tol=0.001 may lose the sheet (83% of the
        // total) without refusal. That is a property of the tolerance, not a hole in
        // the guard: a heal asked to treat 0.001 as coincident cannot represent a
        // 0.0005-thick sheet at all, and pass (3) reports what it dropped in
        // `sliverFacesRemoved`. The guard keeps its opinion where it is meaningful —
        // the body opt.tol CAN see must survive, and leg A's closure is unconditional.
        const double before = rep.inputResolvesVolume ? rep.resolvedVolumeBefore
                                                      : rep.boundedVolumeBefore;
        const double after  = std::fabs(rep.volumeAfter);
        if (opt.maxMaterialLossFrac > 0.0 && before > 0.0 &&
            (before - after) > opt.maxMaterialLossFrac * before) {
            rep.ok = false;
            rep.destructionRefused = true;
            rep.reason = "repair consumed the body: a closed solid lost most of its material "
                         "(a thin-walled feature — foil, gasket, web, whisker — removed as "
                         "slivers) — refusing rather than returning a hollowed solid";
            return rep;
        }
    }

    rep.ok = true;
    rep.reason = "ok";
    return rep;
}

} // namespace brep
} // namespace native
} // namespace forge
