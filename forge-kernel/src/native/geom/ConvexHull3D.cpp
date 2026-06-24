// forge/native/geom/ConvexHull3D.cpp
//
// Implementation of forge::native::geom::convexHull3D_exact — see ConvexHull3D.hpp
// for the scope / honesty statement.  EVERY orientation decision goes through the
// EXACT predicate forge::native::exactOrient3D (rational ExactReal); nothing here
// re-derives an orientation, and no tolerance is used for any combinatorial
// decision.

#include "forge/native/geom/ConvexHull3D.hpp"

#include "forge/native/ExactPredicates3D.hpp"   // exactOrient3D (rational)

// The optional brep::Solid emitter (toSolid) pulls in the full B-rep topology
// (Topology.cpp + Surface/Curve). The mesh-returning hull needs NONE of that, so
// the solid path is compiled ONLY in the full kernel build (which links
// Topology.cpp); the standalone single-clang gate omits it. Define
// FORGE_CONVEXHULL3D_WITH_SOLID (the CMake/full build does, via the kernel target
// that already links Topology) to enable it. This keeps the per-module gate
// self-contained without dropping the toSolid API from the real build.
#ifndef FORGE_CONVEXHULL3D_NO_SOLID
#  define FORGE_CONVEXHULL3D_WITH_SOLID 1
#endif
#ifdef FORGE_CONVEXHULL3D_WITH_SOLID
#  include "forge/native/brep/Topology.hpp"      // toSolid only
#endif

#include <algorithm>
#include <cmath>
#include <map>
#include <unordered_map>
#include <utility>

namespace forge {
namespace native {
namespace geom {

namespace {

// EXACT orientation sign of (a,b,c,d): +1 if d is BELOW plane(a,b,c) (a,b,c CCW
// seen from above d), -1 above, 0 coplanar.  IDENTICAL convention to
// forge::native::orient3d / exactOrient3D.  We route geom::Point3 through Vec3
// (the exact predicate's point type) and take the rational sign.
//
// WINDING CONVENTION used throughout (matches the documented CCW-OUTWARD
// convention of geom::Hull3D / Delaunay3D, and makes the divergence-theorem
// volume POSITIVE): a facet (a,b,c) is OUTWARD when the hull INTERIOR lies BELOW
// its plane, i.e. exactOrient3D(a,b,c, interiorPoint) > 0.  Equivalently every
// other hull point is below-or-on an outward facet (orient >= 0), and a point is
// strictly OUTSIDE (above) a facet when orient < 0.
inline int orientE(const Point3& a, const Point3& b,
                   const Point3& c, const Point3& d) {
    const Vec3 av{a.x, a.y, a.z};
    const Vec3 bv{b.x, b.y, b.z};
    const Vec3 cv{c.x, c.y, c.z};
    const Vec3 dv{d.x, d.y, d.z};
    return exactOrient3D(av, bv, cv, dv);
}

inline bool sameP3(const Point3& a, const Point3& b) {
    return a.x == b.x && a.y == b.y && a.z == b.z;
}

// Plain-double signed distance proxy of point p to the plane of (a,b,c), used
// ONLY to choose WHICH outside point is farthest (never to decide a sign / a
// combinatorial fact).  Returns dot((p-a), n) where n = (b-a)x(c-a); larger
// magnitude == farther.  Not normalized (we only compare distances to the SAME
// face within a call, and across faces the chosen point is re-validated exactly).
inline double planeDistProxy(const Point3& a, const Point3& b,
                             const Point3& c, const Point3& p) {
    const double ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const double vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const double nx = uy * vz - uz * vy;
    const double ny = uz * vx - ux * vz;
    const double nz = ux * vy - uy * vx;
    const double wx = p.x - a.x, wy = p.y - a.y, wz = p.z - a.z;
    return nx * wx + ny * wy + nz * wz;
}

// A live hull facet: vertex indices (into the working point array P) wound so
// the outward normal points away from the interior, plus the set of yet-unclaimed
// input points strictly above it (their indices into P).
struct Facet {
    int a, b, c;
    bool alive{true};
    std::vector<int> outside;   // indices of points strictly above this facet
};

} // namespace

ConvexHull3DResult convexHull3D_exact(const std::vector<Point3>& ptsIn) {
    ConvexHull3DResult result;

    // ---- 1. Deduplicate exact-coincident points; remember original indices. --
    // P holds the unique points; origOf[i] is the FIRST original index that
    // produced P[i]; rep[k] is the unique-array index that original point k maps
    // to (so duplicates inherit their representative's hull classification).
    std::vector<Point3> P;
    std::vector<int>     origOf;
    std::vector<int>     rep(ptsIn.size(), -1);
    {
        // Exact-equality dedup via a string-free map keyed on the bit pattern is
        // overkill; the clouds here are modest and exactness only needs ==.
        for (std::size_t k = 0; k < ptsIn.size(); ++k) {
            int found = -1;
            for (std::size_t j = 0; j < P.size(); ++j) {
                if (sameP3(P[j], ptsIn[k])) { found = static_cast<int>(j); break; }
            }
            if (found < 0) {
                rep[k] = static_cast<int>(P.size());
                P.push_back(ptsIn[k]);
                origOf.push_back(static_cast<int>(k));
            } else {
                rep[k] = found;
            }
        }
    }
    const int n = static_cast<int>(P.size());

    result.isHullVertex.assign(ptsIn.size(), 0);

    if (n < 4) { result.reason = "fewer than 4 unique points"; return result; }

    // ---- 2. Build an initial non-degenerate tetrahedron (all exact-checked). --
    // i0,i1: two distinct points (guaranteed: n>=4 unique).
    int i0 = 0, i1 = 1;
    // i2: not collinear with (i0,i1).  Collinear <=> the cross product (i1-i0)x
    // (i-i0) is the zero vector.  We use the EXACT orient3D of (i0,i1,i, i+lift)
    // off-plane test indirectly: a robust collinearity check is that for SOME
    // apex off the line, orient3D differs; simpler and exact-enough here is the
    // double cross product == 0 only as a CANDIDATE filter, then we confirm the
    // tetrahedron's non-degeneracy exactly below.  To stay fully exact we instead
    // find i2 maximizing the (double) triangle area and confirm i0,i1,i2 are not
    // collinear by requiring a later i3 with exactOrient3D != 0.
    int i2 = -1;
    {
        double best = 0.0;
        for (int i = 0; i < n; ++i) {
            if (i == i0 || i == i1) continue;
            const double ux = P[i1].x - P[i0].x, uy = P[i1].y - P[i0].y, uz = P[i1].z - P[i0].z;
            const double vx = P[i].x  - P[i0].x, vy = P[i].y  - P[i0].y, vz = P[i].z  - P[i0].z;
            const double cx = uy * vz - uz * vy;
            const double cy = uz * vx - ux * vz;
            const double cz = ux * vy - uy * vx;
            const double area2 = cx * cx + cy * cy + cz * cz;
            if (area2 > best) { best = area2; i2 = i; }
        }
        if (i2 < 0 || best == 0.0) { result.reason = "all points collinear"; return result; }
    }

    // i3: not coplanar with (i0,i1,i2) — exactOrient3D != 0.  Pick the point
    // farthest off the plane (largest exact-signed proxy) for a fat seed tetra.
    int i3 = -1;
    {
        double best = 0.0;
        for (int i = 0; i < n; ++i) {
            if (i == i0 || i == i1 || i == i2) continue;
            if (orientE(P[i0], P[i1], P[i2], P[i]) == 0) continue;  // coplanar: skip
            const double d = std::fabs(planeDistProxy(P[i0], P[i1], P[i2], P[i]));
            if (d > best) { best = d; i3 = i; }
        }
        if (i3 < 0) {
            // Every point is coplanar with (i0,i1,i2): the whole set is coplanar.
            result.reason  = "all points coplanar";
            result.coplanar = true;
            return result;
        }
    }

    // ---- 3. Seed 4 outward-oriented facets of the tetrahedron. ----------------
    // For an OUTWARD facet (a,b,c) the FOURTH (apex, an interior reference) must
    // lie BELOW its plane: exactOrient3D(a,b,c,apex) > 0.  We orient each seed
    // facet so the apex is POSITIVE (swap b,c when it is NEGATIVE).
    std::vector<Facet> facets;
    auto makeFacet = [&](int a, int b, int c, int apex) {
        if (orientE(P[a], P[b], P[c], P[apex]) < 0) std::swap(b, c);
        // Post-condition (exact): apex is now strictly below (a,b,c) — orient > 0
        // (the documented CCW-outward winding; divergence volume is positive).
        facets.push_back(Facet{a, b, c, true, {}});
        return static_cast<int>(facets.size()) - 1;
    };
    makeFacet(i1, i2, i3, i0);
    makeFacet(i0, i2, i3, i1);
    makeFacet(i0, i1, i3, i2);
    makeFacet(i0, i1, i2, i3);

    auto isSeed = [&](int i){ return i == i0 || i == i1 || i == i2 || i == i3; };

    // A point p is strictly ABOVE (outside) facet f iff exactOrient3D(f.a,f.b,
    // f.c,p) < 0 — p is on the opposite side of the outward face from the
    // interior (the interior is BELOW => positive; outside => negative).
    auto above = [&](const Facet& f, int p) -> bool {
        return orientE(P[f.a], P[f.b], P[f.c], P[p]) < 0;
    };

    // ---- 4. Assign every remaining point to the outside set of ONE facet. -----
    // Each point goes to the first facet it is strictly above (it may be above
    // several; one claim suffices — Quickhull processes it when that facet is
    // chosen).  Interior points are above none and are dropped.
    for (int p = 0; p < n; ++p) {
        if (isSeed(p)) continue;
        for (auto& f : facets) {
            if (above(f, p)) { f.outside.push_back(p); break; }
        }
    }

    // ---- 5. Quickhull main loop. ----------------------------------------------
    // Repeatedly take a facet with a non-empty outside set, find its farthest
    // outside point, carve the visible region, and cone the point to the horizon.
    auto undirKey = [](int u, int v) {
        return std::make_pair(std::min(u, v), std::max(u, v));
    };

    while (true) {
        // Find a live facet with outside points.
        int fi = -1;
        for (int i = 0; i < static_cast<int>(facets.size()); ++i) {
            if (facets[i].alive && !facets[i].outside.empty()) { fi = i; break; }
        }
        if (fi < 0) break;  // no facet has outside points => hull complete

        // Farthest outside point of facet fi (double distance proxy; the choice
        // of WHICH point cannot corrupt the exact combinatorics).
        const Facet& F = facets[fi];
        int p = F.outside.front();
        double bestd = std::fabs(planeDistProxy(P[F.a], P[F.b], P[F.c], P[p]));
        for (int q : F.outside) {
            double d = std::fabs(planeDistProxy(P[F.a], P[F.b], P[F.c], P[q]));
            if (d > bestd) { bestd = d; p = q; }
        }

        // Visible set: all live facets p is strictly above (flood / scan).  Since
        // visibility is decided exactly, this is the exact connected region below
        // p; we scan all live facets (clouds here are modest) which is simplest
        // and equally exact.
        std::vector<int> visible;
        for (int i = 0; i < static_cast<int>(facets.size()); ++i) {
            if (facets[i].alive && above(facets[i], p)) visible.push_back(i);
        }
        // p must see at least the facet that claimed it.
        // (If numerical-free exactness held, this is guaranteed; assert-by-skip
        //  keeps us honest if a claimed point is exactly coplanar after dedup.)
        if (visible.empty()) {
            // p lies on facet fi's plane (orient == 0) rather than above it: it is
            // not a hull-expanding point.  Drop it from fi's outside set and move
            // on (it is inside-or-on the current hull, which is correct).
            auto& os = facets[fi].outside;
            os.erase(std::remove(os.begin(), os.end(), p), os.end());
            continue;
        }

        // Horizon edges: each undirected edge of the visible facets that is shared
        // with a NON-visible (or no) facet.  We count, per visible facet, each of
        // its 3 directed edges; a horizon edge appears exactly once across all
        // visible facets in one direction with its reverse NOT present in any
        // visible facet.  Because the visible region is a connected topological
        // disk, the horizon is a single closed loop and each horizon edge is the
        // boundary of exactly one visible facet; we keep the DIRECTED edge as it
        // appears in its visible facet so the new cone facet inherits the correct
        // outward winding without needing a centroid.
        std::map<std::pair<int,int>, int> edgeUseCount;          // undirected count
        std::map<std::pair<int,int>, std::pair<int,int>> dirOf;  // undir -> directed
        for (int vfi : visible) {
            const Facet& vf = facets[vfi];
            const int e[3][2] = {{vf.a, vf.b}, {vf.b, vf.c}, {vf.c, vf.a}};
            for (auto& ed : e) {
                auto k = undirKey(ed[0], ed[1]);
                edgeUseCount[k]++;
                dirOf[k] = {ed[0], ed[1]};   // last writer; for a horizon edge it
                                             // is used by exactly ONE visible facet
            }
        }

        // Collect orphaned outside points from the visible facets (to re-assign).
        std::vector<int> orphans;
        for (int vfi : visible) {
            for (int q : facets[vfi].outside) {
                if (q != p) orphans.push_back(q);
            }
            facets[vfi].outside.clear();
            facets[vfi].alive = false;
        }

        // Cone p to each horizon edge (count == 1 => boundary of the disk).  The
        // directed edge (u->v) came from a now-deleted visible facet wound CCW-
        // outward; the new facet (u, v, p) keeps the outward winding if we form it
        // as (v, u, p) so its normal faces outward (the deleted facet had the
        // interior below edge u->v; coning to p on the far side flips the edge).
        // We CONFIRM the winding exactly using one interior reference: the seed
        // tetra centroid is always strictly interior to the (convex) hull.
        const Point3 interior{
            (P[i0].x + P[i1].x + P[i2].x + P[i3].x) * 0.25,
            (P[i0].y + P[i1].y + P[i2].y + P[i3].y) * 0.25,
            (P[i0].z + P[i1].z + P[i2].z + P[i3].z) * 0.25};

        std::vector<int> newFacets;
        for (auto& kv : edgeUseCount) {
            if (kv.second != 1) continue;        // interior edge of the disk
            auto de = dirOf[kv.first];
            int u = de.first, v = de.second;
            int fa = u, fb = v, fc = p;
            // Orient so the interior reference is strictly BELOW (positive) — the
            // documented CCW-outward winding.  (Degenerate orient==0 cannot
            // happen: p is strictly above the deleted facet, so it is off the
            // edge's plane.)
            if (orientE(P[fa], P[fb], P[fc], interior) < 0) std::swap(fb, fc);
            facets.push_back(Facet{fa, fb, fc, true, {}});
            newFacets.push_back(static_cast<int>(facets.size()) - 1);
        }

        // Re-assign orphaned outside points (and p is now a hull vertex, not
        // outside anything) to the new facets they are above.
        for (int q : orphans) {
            if (q == p) continue;
            for (int nf : newFacets) {
                if (above(facets[nf], q)) { facets[nf].outside.push_back(q); break; }
            }
        }
    }

    // ---- 6. Collect the live facets, dedup hull vertices, emit the mesh. ------
    std::unordered_map<int,int> local;   // P-index -> compact hull-vertex index
    auto vid = [&](int pidx) -> int {
        auto it = local.find(pidx);
        if (it != local.end()) return it->second;
        int id = static_cast<int>(result.vertices.size());
        local.emplace(pidx, id);
        result.vertices.push_back(P[pidx]);
        result.hullVertexInput.push_back(origOf[pidx]);
        return id;
    };
    for (const Facet& f : facets) {
        if (!f.alive) continue;
        result.faces.push_back({vid(f.a), vid(f.b), vid(f.c)});
    }

    if (result.faces.empty()) { result.reason = "no faces produced"; return result; }

    // Mark hull-vertex classification on the ORIGINAL inputs (via dedup map):
    // an original point k is a hull vertex iff its representative P-index appears
    // in `local` (was used by a surviving facet).
    for (std::size_t k = 0; k < ptsIn.size(); ++k) {
        const int r = rep[k];
        result.isHullVertex[k] = (local.find(r) != local.end()) ? 1 : 0;
    }

    result.volume = hullVolume(result);
    result.ok = true;
    return result;
}

// ---------------------------------------------------------------------------
// Verification helpers.
// ---------------------------------------------------------------------------

bool allPointsInsideOrOn(const ConvexHull3DResult& hull,
                         const std::vector<Point3>& pts) {
    if (!hull.ok) return false;
    for (const Point3& p : pts) {
        for (const auto& f : hull.faces) {
            const Point3& a = hull.vertices[f[0]];
            const Point3& b = hull.vertices[f[1]];
            const Point3& c = hull.vertices[f[2]];
            // p must be below-or-on every outward face: with the CCW-outward
            // winding the interior side is BELOW => exactOrient3D >= 0.  A point
            // strictly OUTSIDE the hull would be above some face (orient < 0).
            if (orientE(a, b, c, p) < 0) return false;
        }
    }
    return true;
}

bool everyFaceOutwardConvex(const ConvexHull3DResult& hull) {
    if (!hull.ok) return false;
    const int nv = static_cast<int>(hull.vertices.size());
    for (const auto& f : hull.faces) {
        const Point3& a = hull.vertices[f[0]];
        const Point3& b = hull.vertices[f[1]];
        const Point3& c = hull.vertices[f[2]];
        for (int v = 0; v < nv; ++v) {
            if (v == f[0] || v == f[1] || v == f[2]) continue;
            // Every other hull vertex must be strictly below (or, for a coplanar
            // facet, exactly on) this outward face.  With CCW-outward winding the
            // interior side is BELOW => exactOrient3D >= 0; a vertex above the
            // face (orient < 0) would mean the facet is not a supporting plane.
            if (orientE(a, b, c, hull.vertices[v]) < 0) return false;
        }
    }
    return true;
}

double hullVolume(const ConvexHull3DResult& hull) {
    double vol = 0.0;
    for (const auto& f : hull.faces) {
        const Point3& a = hull.vertices[f[0]];
        const Point3& b = hull.vertices[f[1]];
        const Point3& c = hull.vertices[f[2]];
        // dot(a, cross(b, c)) / 6, summed over outward faces.
        const double cx = b.y * c.z - b.z * c.y;
        const double cy = b.z * c.x - b.x * c.z;
        const double cz = b.x * c.y - b.y * c.x;
        vol += (a.x * cx + a.y * cy + a.z * cz);
    }
    return vol / 6.0;
}

#ifdef FORGE_CONVEXHULL3D_WITH_SOLID
brep::Solid* toSolid(const ConvexHull3DResult& hull,
                     brep::TopologyBuilder& builder) {
    if (!hull.ok) return nullptr;
    using namespace brep;

    Solid* solid = builder.makeSolid();
    Shell* shell = builder.makeShell();
    builder.addShellToSolid(solid, shell);

    // One Vertex per hull vertex (shared across faces so edges mate correctly).
    // NB: brep::Point3 (the topology vertex position) is a DIFFERENT type from
    // geom::Point3 (the hull input/output point); qualify to disambiguate.
    std::vector<Vertex*> verts(hull.vertices.size(), nullptr);
    for (std::size_t i = 0; i < hull.vertices.size(); ++i) {
        verts[i] = builder.makeVertex(
            brep::Point3{hull.vertices[i].x, hull.vertices[i].y, hull.vertices[i].z});
    }

    // One triangular Face per outward triangle; addOuterLoopToFace shares edges
    // and mates coedges, so a closed 2-manifold shell results.
    for (const auto& f : hull.faces) {
        Face* face = builder.makeFace();
        builder.addOuterLoopToFace(face, {verts[f[0]], verts[f[1]], verts[f[2]]});
        builder.addFaceToShell(shell, face);
    }
    return solid;
}
#endif // FORGE_CONVEXHULL3D_WITH_SOLID

} // namespace geom
} // namespace native
} // namespace forge
