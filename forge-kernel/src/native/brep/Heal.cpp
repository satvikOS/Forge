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

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <unordered_map>
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

    // --- 5. REBUILD fresh independent faces from the cleaned outer rings + SEW. ---
    // Each surviving face becomes a brand-new Face with PRIVATE vertices/edges built
    // from its cleaned outer ring (inner rings re-added as inner loops). Then the
    // PROVEN sewer (sewFaces) re-mates the coincident boundaries. This is the single
    // site of new-topology minting and it goes through the validated matcher.
    auto buildRingVerts = [&](const std::vector<Point3>& ring) -> std::vector<Vertex*> {
        std::vector<Vertex*> vs; vs.reserve(ring.size());
        for (const Point3& p : ring) vs.push_back(tb.makeVertex(p));
        return vs;
    };
    std::vector<Face*> healed;
    healed.reserve(frs.size());
    for (std::size_t fi = 0; fi < frs.size(); ++fi) {
        if (removed[fi]) continue;
        if (frs[fi].outer.size() < 3) continue;  // safety (cannot face a <3-gon)
        Face* nf = tb.makeFace();
        tb.addOuterLoopToFace(nf, buildRingVerts(frs[fi].outer));
        for (const auto& ir : frs[fi].inners) {
            if (ir.size() >= 3) tb.addInnerLoopToFace(nf, buildRingVerts(ir));
        }
        healed.push_back(nf);
    }

    if (healed.empty()) {
        // Everything was a sliver — honest report, nothing to sew.
        rep.after = SewDiagnosis{};
        rep.faces = healed;
        rep.ok = true;
        rep.reason = "all faces removed as slivers";
        return rep;
    }

    SewOptions sopt;
    sopt.tol = tol;
    sopt.midSamples = opt.sewMidSamples;
    sopt.weldVertices = true;
    SewResult sr = sewFaces(tb, healed, sopt);
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
        // Re-build including the slivers and re-diagnose.
        std::vector<Face*> withSlivers;
        for (std::size_t fi = 0; fi < frs.size(); ++fi) {
            if (frs[fi].outer.size() < 3) continue;
            Face* nf = tb.makeFace();
            tb.addOuterLoopToFace(nf, buildRingVerts(frs[fi].outer));
            for (const auto& ir : frs[fi].inners)
                if (ir.size() >= 3) tb.addInnerLoopToFace(nf, buildRingVerts(ir));
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
