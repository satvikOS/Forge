// forge/native/brep/SolidTessellate.cpp
//
// Implementation of the watertight Solid->mesh tessellator (SolidTessellate.hpp).
// Pure C++20, no external deps.

#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/Surface.hpp"

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
