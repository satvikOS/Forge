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
    const double tol2 = tol * tol;
    const double sliverAreaEps = (opt.sliverAreaEps > 0.0) ? opt.sliverAreaEps : (tol * tol);
    const double aspectMax = (opt.aspectMax > 0.0) ? opt.aspectMax : 1e4;

    // --- before signature + measured invariants (on the raw defective input) ---
    rep.before = diagnoseShell(faces);
    rep.volumeBefore = shellSignedVolume(faces);
    rep.areaBefore   = shellSurfaceArea(faces);

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
    if (opt.weldDuplicateVertices || opt.fillGaps) {
        const double cell = tol;
        std::unordered_map<CellKey, std::vector<int>, CellKeyHash> grid;
        grid.reserve(nPts * 2);
        for (std::size_t i = 0; i < nPts; ++i) {
            const Point3& p = allPts[i];
            const long long cx = qcell(p.x, cell), cy = qcell(p.y, cell), cz = qcell(p.z, cell);
            for (long long dx = -1; dx <= 1; ++dx)
              for (long long dy = -1; dy <= 1; ++dy)
                for (long long dz = -1; dz <= 1; ++dz) {
                    auto it = grid.find({cx + dx, cy + dy, cz + dz});
                    if (it == grid.end()) continue;
                    for (int j : it->second)
                        if (dist2(allPts[i], allPts[j]) <= tol2) dsu.unite(static_cast<int>(i), j);
                }
            grid[{cx, cy, cz}].push_back(static_cast<int>(i));
        }
    }
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
    auto perpDistToSeg = [&](const Point3& c, const Point3& a, const Point3& b) -> double {
        Point3 ab = psub(b, a), ac = psub(c, a);
        double ab2 = pdot(ab, ab);
        if (ab2 <= 0.0) return plen(ac);                 // degenerate segment
        double t = pdot(ac, ab) / ab2;                   // projection parameter
        Point3 proj{a.x + ab.x * t, a.y + ab.y * t, a.z + ab.z * t};
        return plen(psub(c, proj));
    };
    auto cleanRing = [&](std::vector<Point3>& ring, bool count) {
        if (ring.empty()) return;
        // (a) consecutive + closing duplicates.
        {
            std::vector<Point3> out; out.reserve(ring.size());
            for (const Point3& p : ring) {
                if (!out.empty() && dist2(out.back(), p) <= tol2) { if (count) ++rep.shortEdgesCollapsed; continue; }
                out.push_back(p);
            }
            while (out.size() >= 2 && dist2(out.front(), out.back()) <= tol2) { out.pop_back(); if (count) ++rep.shortEdgesCollapsed; }
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
                    if (count) ++rep.shortEdgesCollapsed;
                    changed = true;
                    break;
                }
            }
        }
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

    rep.ok = true;
    rep.reason = "ok";
    return rep;
}

} // namespace brep
} // namespace native
} // namespace forge
