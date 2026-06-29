// forge/native/brep/SolidTessellate.cpp
//
// Implementation of the watertight Solid->mesh tessellator (SolidTessellate.hpp).
// Pure C++20, no external deps.

#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/geom/ConstrainedDelaunay2D.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <map>
#include <tuple>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {
// Quantize a coordinate to a weld grid so coincident face-boundary vertices map
// to the same key.
inline long long qz(double v, double tol) {
    return static_cast<long long>(std::llround(v / tol));
}

// Orthonormal in-plane basis from a (unit) normal — for embedding a planar holed
// face into 2-D so its annulus can be CDT-triangulated (hole excluded).
inline void planeBasis(const Vec3& n, Vec3& e1, Vec3& e2) {
    Vec3 a = (std::fabs(n.x) <= std::fabs(n.y) && std::fabs(n.x) <= std::fabs(n.z))
                 ? Vec3{1, 0, 0}
                 : (std::fabs(n.y) <= std::fabs(n.z) ? Vec3{0, 1, 0} : Vec3{0, 0, 1});
    e1 = vnorm(vsub(a, vscale(n, vdot(a, n))));
    e2 = vcross(n, e1);
}

// Ordered 3-D points of a loop's coedge ring (origin vertices, ring order).
inline std::vector<Vec3> loopPts(const Loop* lp) {
    std::vector<Vec3> pts;
    if (!lp || !lp->first) return pts;
    const Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount; ++i, c = c->next) {
        const Vertex* o = c->originVertex();
        pts.push_back(Vec3{o->point.x, o->point.y, o->point.z});
    }
    return pts;
}
} // namespace

void tessellateSolid(const Solid& solid,
                     std::vector<double>& positions,
                     std::vector<std::uint32_t>& indices,
                     double weldTol) {
    positions.clear();
    indices.clear();

    std::map<std::tuple<long long, long long, long long>, std::uint32_t> weld;
    auto vid = [&](const Vec3& p) -> std::uint32_t {
        auto key = std::make_tuple(qz(p.x, weldTol), qz(p.y, weldTol), qz(p.z, weldTol));
        auto it = weld.find(key);
        if (it != weld.end()) return it->second;
        std::uint32_t id = static_cast<std::uint32_t>(positions.size() / 3);
        positions.push_back(p.x);
        positions.push_back(p.y);
        positions.push_back(p.z);
        weld.emplace(key, id);
        return id;
    };

    for (Shell* sh : solid.shells) {
        for (Face* f : sh->faces) {
            Loop* lp = f->outerLoop;
            if (!lp || lp->coedgeCount < 3) continue;

            // Collect the loop's ordered 3D corner points (origin vertices).
            std::vector<Vec3> pts;
            pts.reserve(lp->coedgeCount);
            Coedge* c = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
                Vertex* o = c->originVertex();
                pts.push_back(Vec3{o->point.x, o->point.y, o->point.z});
                c = c->next;
            }

            // Determine an outward reference normal for consistent winding.
            Vec3 refN{0, 0, 0};
            if (f->surface) {
                refN = f->surface->normalAt(0.5 * (f->u0 + f->u1),
                                            0.5 * (f->v0 + f->v1));
            }

            // HOLED ANALYTIC FACE (native boolean): triangulate the ANNULUS between
            // the outer loop and the inner (hole) loops via a constrained Delaunay
            // over all loops, keeping only the even-odd INSIDE triangles (so the
            // hole is NOT filled). The loop vertices ARE the bore-wall rim vertices,
            // so the welded soup stays watertight. Gated on `boolHoled` so only
            // boolean-emitted holed faces take this path — every other face keeps the
            // byte-identical fan below. A CDT miss falls through to the fan (which at
            // worst fills the hole, but the boolean only sets boolHoled on clean
            // inner-loop faces, so the CDT succeeds in practice).
            if (f->boolHoled && !f->innerLoops.empty() && f->surface) {
                Vec3 e1, e2; planeBasis(refN, e1, e2);
                const Vec3 o = pts[0];
                std::vector<geom::Point2> P2;
                std::vector<Vec3> P3;
                std::vector<geom::ConstraintEdge> cons;
                auto addRing = [&](const std::vector<Vec3>& ring) {
                    if (ring.size() < 3) return;
                    int base = static_cast<int>(P2.size());
                    for (const Vec3& p : ring) {
                        Vec3 d = vsub(p, o);
                        P2.push_back(geom::Point2{vdot(d, e1), vdot(d, e2)});
                        P3.push_back(p);
                    }
                    int m = static_cast<int>(ring.size());
                    for (int i = 0; i < m; ++i) cons.push_back({base + i, base + ((i + 1) % m)});
                };
                addRing(pts);                                   // outer loop
                for (Loop* il : f->innerLoops) addRing(loopPts(il)); // hole loops

                geom::CDTResult cdt = geom::constrainedDelaunay2D(P2, cons);
                if (cdt.ok && cdt.closedLoops && !cdt.triangles.empty()) {
                    for (std::size_t t = 0; t < cdt.triangles.size(); ++t) {
                        if (t < cdt.inside.size() && !cdt.inside[t]) continue; // skip hole
                        const auto& tr = cdt.triangles[t];
                        Vec3 q[3]; bool good = true;
                        for (int kk = 0; kk < 3; ++kk) {
                            int li = tr[kk];
                            if (li < 0 || li >= static_cast<int>(cdt.inputIndex.size())) { good = false; break; }
                            int orig = cdt.inputIndex[li];
                            if (orig < 0 || orig >= static_cast<int>(P3.size())) { good = false; break; }
                            q[kk] = P3[orig];
                        }
                        if (!good) continue;
                        std::uint32_t a = vid(q[0]), b = vid(q[1]), c2 = vid(q[2]);
                        if (a == b || b == c2 || a == c2) continue;
                        Vec3 triN = vcross(vsub(q[1], q[0]), vsub(q[2], q[0]));
                        if (vdot(triN, refN) < 0.0) {
                            indices.push_back(a); indices.push_back(c2); indices.push_back(b);
                        } else {
                            indices.push_back(a); indices.push_back(b); indices.push_back(c2);
                        }
                    }
                    continue; // holed face done; do NOT fan-triangulate (would fill the hole)
                }
                // CDT miss: fall through to the fan (best-effort, keeps the gate honest).
            }

            // Fan-triangulate the (convex-or-simple) loop polygon.
            std::uint32_t i0 = vid(pts[0]);
            for (std::size_t t = 1; t + 1 < pts.size(); ++t) {
                std::uint32_t i1 = vid(pts[t]);
                std::uint32_t i2 = vid(pts[t + 1]);
                if (i0 == i1 || i1 == i2 || i0 == i2) continue; // degenerate
                // Orient the triangle so its normal agrees with refN (outward).
                Vec3 a = pts[0], b = pts[t], cc = pts[t + 1];
                Vec3 triN = vcross(vsub(b, a), vsub(cc, a));
                if (f->surface && vdot(triN, refN) < 0.0) {
                    indices.push_back(i0); indices.push_back(i2); indices.push_back(i1);
                } else {
                    indices.push_back(i0); indices.push_back(i1); indices.push_back(i2);
                }
            }
        }
    }
}

mesh::HalfEdgeMesh tessellateSolidToMesh(const Solid& solid, bool& ok, double weldTol) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    tessellateSolid(solid, pos, idx, weldTol);
    mesh::HalfEdgeMesh m;
    ok = m.buildFromSoup(pos, idx);
    return m;
}

} // namespace brep
} // namespace native
} // namespace forge
