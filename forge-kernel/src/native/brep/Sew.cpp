// forge/native/brep/Sew.cpp
//
// Implementation of the K1.4 native SEW / DIAGNOSE / HEAL ops (Sew.hpp).
// Pure C++20, no external dependencies. See header for honesty / scope.
//
// ALGORITHM OUTLINE
//   sewFaces:
//     0. collect boundary coedges/edges/vertices of every input face.
//     1. (heal) weld near-duplicate vertices with a tolerance spatial hash +
//        union-find; re-point edge endpoints at survivors.
//     2. bucket every boundary edge by a CANONICAL key of its two (welded)
//        endpoint vertices (order-independent); within each bucket confirm a
//        true geometric match by sampling mid-curve points, then MERGE the
//        matched edges into one surviving Edge carrying both coedges.
//     3. build connected-shell adjacency with a union-find over faces joined by
//        a shared (now-merged) edge; allocate one Shell per component.
//     4. diagnose: classify each surviving edge (free / manifold / non-manifold),
//        compute V/E/F, Euler characteristic, genus, closedness; detect
//        mis-oriented shared edges (two coedges agreeing in sense).

#include "forge/native/brep/Sew.hpp"
#include "forge/native/brep/Surface.hpp"   // Surface::evaluate (vertexUV mapping not needed; we use vertex positions)
#include "forge/native/brep/Curve.hpp"     // Edge::curve sampling when present

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

// -- small geometry helpers (local; do not collide with Surface.hpp's vadd etc.)
inline double dist2(const Point3& a, const Point3& b) {
    const double dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

// Sample a point along an edge's geometry at fraction f in [0,1], running from
// edge->start toward edge->end. When the edge carries an exact 3D Curve we use
// it (mapping f over [t0,t1] in the start->end sense); otherwise we linearly
// interpolate the two endpoint vertex positions (bare topology — the box gate).
Point3 sampleEdge(const Edge* e, double f) {
    if (e->curve != nullptr) {
        const Curve* c = e->curve;
        const double t = c->t0 + (c->t1 - c->t0) * f;
        const Vec3 p = c->evaluate(t);
        return {p.x, p.y, p.z};
    }
    const Point3& a = e->start->point;
    const Point3& b = e->end->point;
    return {a.x + (b.x - a.x) * f,
            a.y + (b.y - a.y) * f,
            a.z + (b.z - a.z) * f};
}

// Quantise a coordinate to an integer cell index on a grid of size `cell`.
inline long long qcell(double x, double cell) {
    return static_cast<long long>(std::floor(x / cell));
}

// A hashable 3-int spatial-hash cell key.
struct CellKey {
    long long x, y, z;
    bool operator==(const CellKey& o) const { return x == o.x && y == o.y && z == o.z; }
};
struct CellKeyHash {
    std::size_t operator()(const CellKey& k) const {
        // 64-bit mix of the three lattice coordinates.
        std::uint64_t h = 1469598103934665603ull;
        auto mix = [&](long long v) {
            h ^= static_cast<std::uint64_t>(v) + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2);
        };
        mix(k.x); mix(k.y); mix(k.z);
        return static_cast<std::size_t>(h);
    }
};

// ---- union-find ----------------------------------------------------------
struct DSU {
    std::vector<int> parent;
    void init(std::size_t n) { parent.resize(n); for (std::size_t i = 0; i < n; ++i) parent[i] = static_cast<int>(i); }
    int find(int a) { while (parent[a] != a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    void unite(int a, int b) { int ra = find(a), rb = find(b); if (ra != rb) parent[ra] = rb; }
};

// Walk all coedges of a face's loops (outer + inner) into `out`.
void collectFaceCoedges(Face* f, std::vector<Coedge*>& out) {
    auto walk = [&](Loop* lp) {
        if (lp == nullptr || lp->first == nullptr) return;
        Coedge* c = lp->first;
        for (std::size_t i = 0; i < lp->coedgeCount && c != nullptr; ++i) {
            out.push_back(c);
            c = c->next;
        }
    };
    walk(f->outerLoop);
    for (Loop* il : f->innerLoops) walk(il);
}

} // anonymous namespace

// ===========================================================================
// weldNearVertices — HEAL (light), standalone.
// ===========================================================================
std::size_t weldNearVertices(const std::vector<Vertex*>& verts,
                             const std::vector<Edge*>& edges,
                             double tol) {
    const std::size_t n = verts.size();
    if (n == 0) return 0;

    // Index lookup for the union-find.
    std::unordered_map<Vertex*, int> idx;
    idx.reserve(n * 2);
    for (std::size_t i = 0; i < n; ++i) idx[verts[i]] = static_cast<int>(i);

    DSU dsu;
    dsu.init(n);

    // Spatial hash: bucket vertices into cells of side `tol`; coincidence is
    // tested against the 27-cell neighbourhood so a pair straddling a cell wall
    // is still found.
    const double cell = (tol > 0.0) ? tol : 1e-12;
    std::unordered_map<CellKey, std::vector<int>, CellKeyHash> grid;
    grid.reserve(n * 2);
    const double tol2 = tol * tol;

    for (std::size_t i = 0; i < n; ++i) {
        const Point3& p = verts[i]->point;
        const long long cx = qcell(p.x, cell), cy = qcell(p.y, cell), cz = qcell(p.z, cell);
        for (long long dx = -1; dx <= 1; ++dx)
            for (long long dy = -1; dy <= 1; ++dy)
                for (long long dz = -1; dz <= 1; ++dz) {
                    auto it = grid.find({cx + dx, cy + dy, cz + dz});
                    if (it == grid.end()) continue;
                    for (int j : it->second) {
                        if (dist2(verts[i]->point, verts[j]->point) <= tol2) {
                            dsu.unite(static_cast<int>(i), j);
                        }
                    }
                }
        grid[{cx, cy, cz}].push_back(static_cast<int>(i));
    }

    // Survivor per component = the representative vertex.
    std::vector<Vertex*> survivor(n, nullptr);
    for (std::size_t i = 0; i < n; ++i) {
        int r = dsu.find(static_cast<int>(i));
        if (survivor[r] == nullptr) survivor[r] = verts[r];
    }

    // Re-point every edge endpoint at its component survivor.
    auto remap = [&](Vertex*& vp) {
        auto it = idx.find(vp);
        if (it == idx.end()) return;
        Vertex* s = survivor[dsu.find(it->second)];
        if (s != nullptr) vp = s;
    };
    for (Edge* e : edges) {
        remap(e->start);
        remap(e->end);
    }

    // Count how many distinct vertices were absorbed (n - distinct survivors).
    std::size_t distinct = 0;
    for (std::size_t i = 0; i < n; ++i) {
        if (dsu.find(static_cast<int>(i)) == static_cast<int>(i)) ++distinct;
    }
    return n - distinct;
}

// ===========================================================================
// diagnoseShell — DIAGNOSE only.
// ===========================================================================
SewDiagnosis diagnoseShell(const std::vector<Face*>& faces) {
    SewDiagnosis d;
    d.faces = faces.size();

    // Gather every distinct edge and every distinct vertex referenced by the
    // faces' loops, plus the per-edge coedge use count (counting only coedges
    // that actually belong to these faces, so a shell sharing edges with a
    // neighbour not in `faces` is still classified from THIS set's uses).
    std::unordered_map<Edge*, std::size_t> edgeUse;
    std::unordered_map<Vertex*, char> vertSet;
    edgeUse.reserve(faces.size() * 8);
    vertSet.reserve(faces.size() * 8);

    std::vector<Coedge*> ces;
    for (Face* f : const_cast<std::vector<Face*>&>(faces)) {
        ces.clear();
        collectFaceCoedges(f, ces);
        for (Coedge* c : ces) {
            if (c->edge == nullptr) continue;
            ++edgeUse[c->edge];
            if (c->edge->start) vertSet[c->edge->start] = 1;
            if (c->edge->end)   vertSet[c->edge->end] = 1;
        }
    }

    d.vertices = vertSet.size();
    d.edges    = edgeUse.size();

    for (const auto& kv : edgeUse) {
        const std::size_t uses = kv.second;
        if (uses == 1) {
            ++d.freeEdges;
            d.freeEdgeIds.push_back(kv.first->id);
        } else if (uses == 2) {
            ++d.manifoldEdges;
        } else {
            ++d.nonManifoldEdges;
            d.nonManifoldEdgeIds.push_back(kv.first->id);
        }
    }
    std::sort(d.freeEdgeIds.begin(), d.freeEdgeIds.end());
    std::sort(d.nonManifoldEdgeIds.begin(), d.nonManifoldEdgeIds.end());

    d.closed = (d.freeEdges == 0 && d.nonManifoldEdges == 0);

    d.eulerCharacteristic =
        static_cast<long long>(d.vertices) -
        static_cast<long long>(d.edges) +
        static_cast<long long>(d.faces);

    // Genus only for a closed orientable shell: chi = 2 - 2g.
    if (d.closed) {
        d.genus = (2 - d.eulerCharacteristic) / 2;
    } else {
        d.genus = -1;
    }
    return d;
}

// ===========================================================================
// sewFaces — THE SEW OP (sew + heal + adjacency + diagnose).
// ===========================================================================
SewResult sewFaces(TopologyBuilder& tb,
                   const std::vector<Face*>& faces,
                   const SewOptions& opt) {
    SewResult res;
    if (faces.empty()) { res.reason = "empty face set"; return res; }
    for (Face* f : faces) {
        if (f == nullptr || f->outerLoop == nullptr) {
            res.reason = "a face has no outer loop";
            return res;
        }
    }

    const double tol = (opt.tol > 0.0) ? opt.tol : 1e-12;
    const double tol2 = tol * tol;

    // --- 0. collect boundary coedges / edges / vertices --------------------
    std::vector<Coedge*> allCoedges;
    std::vector<Edge*>   allEdges;     // distinct
    std::vector<Vertex*> allVertices;  // distinct
    {
        std::unordered_map<Edge*, char> seenE;
        std::unordered_map<Vertex*, char> seenV;
        std::vector<Coedge*> tmp;
        for (Face* f : faces) {
            tmp.clear();
            collectFaceCoedges(f, tmp);
            for (Coedge* c : tmp) {
                allCoedges.push_back(c);
                Edge* e = c->edge;
                if (e == nullptr) continue;
                if (!seenE.count(e)) { seenE[e] = 1; allEdges.push_back(e); }
                if (e->start && !seenV.count(e->start)) { seenV[e->start] = 1; allVertices.push_back(e->start); }
                if (e->end   && !seenV.count(e->end))   { seenV[e->end]   = 1; allVertices.push_back(e->end); }
            }
        }
    }

    // --- 1. HEAL: weld near-duplicate vertices -----------------------------
    if (opt.weldVertices) {
        res.weldedVertices = weldNearVertices(allVertices, allEdges, tol);
    }

    // --- 2. MATCH + MERGE coincident edges ---------------------------------
    // Bucket every edge by a canonical spatial key derived from its two (welded)
    // endpoint MIDPOINT cell — orientation-independent because we key on the
    // unordered pair of endpoint cells AND probe the 27-neighbourhood. Within a
    // bucket we confirm a real curve match by sampling.
    //
    // We use the edge MIDPOINT cell as the primary bucket (two coincident edges
    // have the same midpoint within tol), which is order-free by construction.
    std::unordered_map<CellKey, std::vector<Edge*>, CellKeyHash> bucket;
    bucket.reserve(allEdges.size() * 2);
    const double cell = tol;

    auto edgeMid = [&](const Edge* e) -> Point3 { return sampleEdge(e, 0.5); };

    // Confirm two edges are the SAME curve within tol: endpoints coincide (in
    // either pairing) AND interior samples coincide in the matching direction.
    auto sameCurve = [&](const Edge* a, const Edge* b, bool& opposite) -> bool {
        const Point3 a0 = a->start->point, a1 = a->end->point;
        const Point3 b0 = b->start->point, b1 = b->end->point;
        const bool forwardMatch = (dist2(a0, b0) <= tol2 && dist2(a1, b1) <= tol2);
        const bool reverseMatch = (dist2(a0, b1) <= tol2 && dist2(a1, b0) <= tol2);
        if (!forwardMatch && !reverseMatch) return false;
        // Sample the interior; b is sampled in the matching direction.
        const std::size_t m = opt.midSamples;
        for (std::size_t i = 1; i <= m; ++i) {
            const double fa = static_cast<double>(i) / static_cast<double>(m + 1);
            const Point3 pa = sampleEdge(a, fa);
            // If endpoints matched forward, b runs same dir; if reverse, flip f.
            const double fb = forwardMatch ? fa : (1.0 - fa);
            const Point3 pb = sampleEdge(b, fb);
            if (dist2(pa, pb) > tol2) {
                // forward sample failed; if BOTH pairings nominally matched
                // endpoints (degenerate tiny edge), try the other direction once.
                if (forwardMatch && reverseMatch) {
                    const Point3 pb2 = sampleEdge(b, 1.0 - fa);
                    if (dist2(pa, pb2) <= tol2) continue;
                }
                return false;
            }
        }
        // `opposite`: the two coedge USES will run opposite around their loops
        // when the shared edge is traversed start->end by one face and end->start
        // by the other. We report the geometric sense match (forward vs reverse)
        // so the caller / merge step can wire the coedge `forward` flag.
        opposite = forwardMatch;  // (see merge below for how this drives `forward`)
        return true;
    };

    // Build buckets keyed on the midpoint cell; probe neighbourhood at merge time.
    std::unordered_map<Edge*, char> consumed;  // edges already merged away
    for (Edge* e : allEdges) {
        const Point3 mid = edgeMid(e);
        bucket[{qcell(mid.x, cell), qcell(mid.y, cell), qcell(mid.z, cell)}].push_back(e);
    }

    // For each edge, search its 27-neighbourhood bucket span for an unconsumed
    // matching partner and merge. Merging: keep `survivor` = e; move the
    // partner's coedge(s) onto e; re-point them; mate; mark partner consumed.
    auto mergeEdges = [&](Edge* survivor, Edge* dead, bool forwardGeom) {
        // The dead edge has one coedge (its face's boundary use). Re-home it onto
        // the survivor edge. Determine the dead coedge.
        Coedge* dc = (dead->coedgeA != nullptr) ? dead->coedgeA : dead->coedgeB;
        if (dc == nullptr) return;  // nothing to move (shouldn't happen)

        // The dead coedge currently runs dead->start -> dead->end if dc->forward.
        // After re-homing onto survivor we must keep that GEOMETRIC direction. If
        // the survivor edge is oriented the SAME way (forwardGeom == true:
        // survivor.start==dead.start geometrically) then dc keeps its sense
        // relative to the survivor; else it flips.
        const bool deadGeomForward = dc->forward;  // dead's traversal start->end
        // survivor.start corresponds to dead.start when forwardGeom.
        const bool newForward = forwardGeom ? deadGeomForward : !deadGeomForward;

        dc->edge = survivor;
        dc->forward = newForward;

        // Attach to a free coedge slot on the survivor and mate.
        if (survivor->coedgeA == nullptr) {
            survivor->coedgeA = dc;
        } else if (survivor->coedgeB == nullptr) {
            survivor->coedgeB = dc;
            survivor->coedgeA->mate = dc;
            dc->mate = survivor->coedgeA;
        } else {
            // 3rd+ use -> non-manifold; record both as mates of A for now and let
            // the diagnosis flag it. We chain via coedgeB staying the last; the
            // per-edge use count in diagnosis handles 3+.
            // (Keep dc pointing at survivor; mate to A so it is not dangling.)
            dc->mate = survivor->coedgeA;
        }
        dead->coedgeA = nullptr;
        dead->coedgeB = nullptr;
        consumed[dead] = 1;
    };

    for (Edge* e : allEdges) {
        if (consumed.count(e)) continue;
        if (e->coedgeA != nullptr && e->coedgeB != nullptr) continue; // already 2-used
        const Point3 mid = edgeMid(e);
        const long long cx = qcell(mid.x, cell), cy = qcell(mid.y, cell), cz = qcell(mid.z, cell);
        for (long long dx = -1; dx <= 1; ++dx) {
            for (long long dy = -1; dy <= 1; ++dy) {
                for (long long dz = -1; dz <= 1; ++dz) {
                    auto it = bucket.find({cx + dx, cy + dy, cz + dz});
                    if (it == bucket.end()) continue;
                    for (Edge* cand : it->second) {
                        if (cand == e || consumed.count(cand)) continue;
                        if (cand->coedgeA != nullptr && cand->coedgeB != nullptr) continue;
                        // Don't merge an edge into another that already has 2 uses.
                        bool forwardGeom = false;
                        if (sameCurve(e, cand, forwardGeom)) {
                            mergeEdges(e, cand, forwardGeom);
                            ++res.mergedEdgePairs;
                            if (e->coedgeA != nullptr && e->coedgeB != nullptr) goto next_edge;
                        }
                    }
                }
            }
        }
        next_edge:;
    }

    // Surviving distinct edges = those not consumed.
    std::vector<Edge*> liveEdges;
    liveEdges.reserve(allEdges.size());
    for (Edge* e : allEdges) if (!consumed.count(e)) liveEdges.push_back(e);

    // --- 3. SHELL ADJACENCY via union-find over faces ----------------------
    std::unordered_map<Face*, int> faceIdx;
    for (std::size_t i = 0; i < faces.size(); ++i) faceIdx[faces[i]] = static_cast<int>(i);
    DSU fdsu;
    fdsu.init(faces.size());

    // For each surviving edge with two coedges from different faces, unite them.
    auto coedgeFace = [](Coedge* c) -> Face* {
        return (c && c->loop) ? c->loop->face : nullptr;
    };
    for (Edge* e : liveEdges) {
        if (e->coedgeA && e->coedgeB) {
            Face* fa = coedgeFace(e->coedgeA);
            Face* fb = coedgeFace(e->coedgeB);
            if (fa && fb) {
                auto ia = faceIdx.find(fa), ib = faceIdx.find(fb);
                if (ia != faceIdx.end() && ib != faceIdx.end()) fdsu.unite(ia->second, ib->second);
            }
        }
    }

    // Allocate one Shell per connected component; assign faces.
    std::unordered_map<int, Shell*> compShell;
    for (std::size_t i = 0; i < faces.size(); ++i) {
        int r = fdsu.find(static_cast<int>(i));
        Shell* sh = nullptr;
        auto it = compShell.find(r);
        if (it == compShell.end()) {
            sh = tb.makeShell();
            compShell[r] = sh;
            res.shells.push_back(sh);
        } else {
            sh = it->second;
        }
        tb.addFaceToShell(sh, faces[i]);
    }
    // Largest shell first (deterministic "primary" shell = the one with most faces).
    std::sort(res.shells.begin(), res.shells.end(),
              [](Shell* a, Shell* b) { return a->faces.size() > b->faces.size(); });
    res.shell = res.shells.empty() ? nullptr : res.shells.front();

    // --- 4. DIAGNOSE -------------------------------------------------------
    res.diagnosis = diagnoseShell(faces);
    res.diagnosis.shellCount = res.shells.size();
    // Single-shell genus only when one connected shell AND closed.
    if (!(res.diagnosis.closed && res.diagnosis.shellCount == 1)) {
        res.diagnosis.genus = -1;
    }

    // --- 4b. ORIENTATION DEFECTS: shared edges whose two coedges agree in sense.
    // After merge, a properly-sewn manifold edge has its two coedges OPPOSITE
    // (one forward, one reverse). If both run the same way the two faces were
    // mis-oriented across that edge (cannot bound a consistent solid).
    for (Edge* e : liveEdges) {
        if (e->coedgeA && e->coedgeB) {
            if (e->coedgeA->forward == e->coedgeB->forward) {
                MisorientedPair mp;
                mp.edgeId = e->id;
                mp.faceA = coedgeFace(e->coedgeA);
                mp.faceB = coedgeFace(e->coedgeB);
                res.misoriented.push_back(mp);
            }
        }
    }

    res.ok = true;
    res.reason = "";
    return res;
}

} // namespace brep
} // namespace native
} // namespace forge
