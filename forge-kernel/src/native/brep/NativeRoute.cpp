// forge/native/brep/NativeRoute.cpp
//
// Implementation of the STEP-3a routing layer (NativeRoute.hpp): the runtime
// gate + transformSolid (the placement-gap fix). Pure C++20, no external deps.

#include "forge/native/brep/NativeRoute.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/geom/ConstrainedDelaunay2D.hpp"

#include <atomic>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <map>
#include <string>
#include <tuple>
#include <vector>

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// Runtime gate.
// ---------------------------------------------------------------------------
// PER-CAPABILITY gates (the migration flips native ON one PROVEN capability at a
// time). -1 = use env; 0 = off; 1 = on.
//   * CORE   = the analytic-exact ops (primitives minus ellipsoid, booleans with
//              OCCT fallback, transforms, massProps, tessellate). A/B-verified
//              (native_vs_occt 33/33). Default ON when compiled+env'd. — Wave 1.
//   * FEAT   = mesh-bridge / feature ops (fillet/chamfer/draft/loft/revolve/...)
//              that return a NativeMesh (a representation change). Default OFF. — Wave 2.
//   * STEP   = native STEP import/export. Default OFF. — Wave 3.
//   * INTERF = the assembly clash test (representation-NEUTRAL overlap volume via
//              the CORE booleanSolid(Common)+massProperties engine). Default ON
//              (its own opt-out FORGE_NATIVE_INTERFERENCE=0). — Wave 2.
// setForgeNativeBrepEnabled(on) sets ALL FOUR so the native_vs_occt A/B harness
// still exercises fillet/chamfer/draft/STEP/interference natively; the PRODUCTION
// default (env FORGE_NATIVE_BREP=1, no setter) turns on CORE + INTERF, leaving
// FEAT/STEP on OCCT.
namespace {
std::atomic<int> g_coreOverride{-1};
std::atomic<int> g_featOverride{-1};
std::atomic<int> g_stepOverride{-1};
std::atomic<int> g_interfOverride{-1};

bool readEnvFlag(const char* name) {
    const char* v = std::getenv(name);
    if (!v) return false;
    std::string s(v);
    for (auto& c : s) c = static_cast<char>(std::tolower((unsigned char)c));
    return s == "1" || s == "on" || s == "true" || s == "yes";
}
} // namespace

bool forgeNativeBrepEnabled() {
    int ov = g_coreOverride.load(std::memory_order_relaxed);
    if (ov >= 0) return ov != 0;
    // WAVE-1 FLIP (2026-06-23): analytic-core native is the PRODUCTION DEFAULT —
    // A/B-verified (native_vs_occt 33/33) + full kernel suite green. The env can
    // still force it either way: FORGE_NATIVE_BREP=0/off = OCCT baseline / rollback,
    // =1/on = native; UNSET = native (the new default). FEAT/STEP stay OFF (Wave 2/3).
    static const bool envSet = (std::getenv("FORGE_NATIVE_BREP") != nullptr);
    static const bool envOn  = readEnvFlag("FORGE_NATIVE_BREP");
    return envSet ? envOn : true;
}

bool forgeNativeFeaturesEnabled() {
    int ov = g_featOverride.load(std::memory_order_relaxed);
    if (ov >= 0) return ov != 0;
    // NOT triggered by FORGE_NATIVE_BREP — its own opt-in (kept OFF in Wave 1).
    static const bool envOn = readEnvFlag("FORGE_NATIVE_FEATURES");
    return envOn;
}

bool forgeNativeStepEnabled() {
    int ov = g_stepOverride.load(std::memory_order_relaxed);
    if (ov >= 0) return ov != 0;
    static const bool envOn = readEnvFlag("FORGE_NATIVE_STEP");
    return envOn;
}

bool forgeNativeInterferenceEnabled() {
    int ov = g_interfOverride.load(std::memory_order_relaxed);
    if (ov >= 0) return ov != 0;
    // WAVE-2 FLIP (2026-06-29): the assembly clash test is a CORE-class,
    // representation-NEUTRAL op (scalar overlap volume via the analytic-core
    // booleanSolid(Common)+massProperties engine, A/B-verified vs OCCT). It is the
    // PRODUCTION DEFAULT — env can force it either way: FORGE_NATIVE_INTERFERENCE=0/off
    // = OCCT BRepAlgoAPI_Common narrow phase (rollback), =1/on = native; UNSET = native.
    // OCCT remains the honest fallback for non-analytic operands (importOcctSolid defers).
    static const bool envSet = (std::getenv("FORGE_NATIVE_INTERFERENCE") != nullptr);
    static const bool envOn  = readEnvFlag("FORGE_NATIVE_INTERFERENCE");
    return envSet ? envOn : true;
}

void setForgeNativeBrepEnabled(bool on) {
    // The A/B harness toggles the WHOLE native surface (core + features + step) so
    // native_vs_occt can compare every op; production never calls this.
    const int v = on ? 1 : 0;
    g_coreOverride.store(v, std::memory_order_relaxed);
    g_featOverride.store(v, std::memory_order_relaxed);
    g_stepOverride.store(v, std::memory_order_relaxed);
    g_interfOverride.store(v, std::memory_order_relaxed);
}

// ---------------------------------------------------------------------------
// transformSolid — rigid clone (the placement-gap fix).
// ---------------------------------------------------------------------------
namespace {

inline Vec3 applyRT(const double R[9], const double t[3], const Vec3& p) {
    return Vec3{
        R[0] * p.x + R[1] * p.y + R[2] * p.z + t[0],
        R[3] * p.x + R[4] * p.y + R[5] * p.z + t[1],
        R[6] * p.x + R[7] * p.y + R[8] * p.z + t[2],
    };
}

// Rotate a DIRECTION (no translation) — for Surface axis/refDir frames.
inline Vec3 applyR(const double R[9], const Vec3& d) {
    return Vec3{
        R[0] * d.x + R[1] * d.y + R[2] * d.z,
        R[3] * d.x + R[4] * d.y + R[5] * d.z,
        R[6] * d.x + R[7] * d.y + R[8] * d.z,
    };
}

inline long long qz(double v, double tol) {
    return static_cast<long long>(std::llround(v / tol));
}

} // namespace

Solid* transformSolid(const Solid& src,
                      const double R[9], const double t[3],
                      std::shared_ptr<TopologyBuilder>& outOwner) {
    auto owner = std::make_shared<TopologyBuilder>();
    Solid* solid = owner->makeSolid();
    Shell* shell = owner->makeShell();
    owner->addShellToSolid(solid, shell);

    // Weld transformed vertex positions so shared edges stay shared (the clone
    // is closed iff the source was). Tolerance matches SolidTessellate's weld.
    const double weldTol = 1e-9;
    std::map<std::tuple<long long, long long, long long>, Vertex*> weld;
    auto vid = [&](const Vec3& p) -> Vertex* {
        auto key = std::make_tuple(qz(p.x, weldTol), qz(p.y, weldTol), qz(p.z, weldTol));
        auto it = weld.find(key);
        if (it != weld.end()) return it->second;
        Vertex* v = owner->makeVertex(Point3{p.x, p.y, p.z});
        weld.emplace(key, v);
        return v;
    };

    for (Shell* sh : src.shells) {
        for (Face* sf : sh->faces) {
            Loop* lp = sf->outerLoop;
            if (!lp || lp->coedgeCount < 3) continue;

            // Collect + transform the loop's ordered corner vertices.
            std::vector<Vertex*> ring;
            ring.reserve(lp->coedgeCount);
            Coedge* c = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
                Vertex* o = c->originVertex();
                Vec3 p = applyRT(R, t, Vec3{o->point.x, o->point.y, o->point.z});
                ring.push_back(vid(p));
                c = c->next;
            }

            Face* nf = owner->makeFace();
            owner->addFaceToShell(shell, nf);
            owner->addOuterLoopToFace(nf, ring);

            // Copy + transform the analytic surface frame (rigid: parameterisation
            // is unchanged, so trim windows / vertexUV / disk radii copy verbatim).
            if (sf->surface) {
                Surface* ns = owner->makeSurface();
                *ns = *sf->surface;  // copy radii, kind, reversed flag, disk annotation
                ns->origin = applyRT(R, t, sf->surface->origin);
                ns->axis   = vnorm(applyR(R, sf->surface->axis));
                ns->refDir = vnorm(applyR(R, sf->surface->refDir));
                nf->surface = ns;
            }
            nf->u0 = sf->u0; nf->u1 = sf->u1;
            nf->v0 = sf->v0; nf->v1 = sf->v1;
            nf->vertexUV = sf->vertexUV;
            nf->paramTri = sf->paramTri;
        }
    }

    outOwner = owner;
    return solid;
}

// ---------------------------------------------------------------------------
// tessellateSolidForViewport — Solid -> OCCT viewport contract (Float32 pos +
// smooth normals + per-tri faceIds). Mirrors src/Tessellate.cpp's smooth-normal
// accumulation; faceId is the 1-based analytic-Face index in shell/face order.
// ---------------------------------------------------------------------------
// Orthonormal in-plane basis from a (unit) normal — for embedding a planar holed
// face into 2-D so its annulus can be CDT-triangulated (hole excluded). Mirrors
// SolidTessellate.cpp so the viewport mesh matches the analytic tessellator.
static inline void viewportPlaneBasis(const Vec3& n, Vec3& e1, Vec3& e2) {
    Vec3 a = (std::fabs(n.x) <= std::fabs(n.y) && std::fabs(n.x) <= std::fabs(n.z))
                 ? Vec3{1, 0, 0}
                 : (std::fabs(n.y) <= std::fabs(n.z) ? Vec3{0, 1, 0} : Vec3{0, 0, 1});
    e1 = vnorm(vsub(a, vscale(n, vdot(a, n))));
    e2 = vcross(n, e1);
}

// Ordered 3-D points of a loop's coedge ring (origin vertices, ring order).
static inline std::vector<Vec3> viewportLoopPts(const Loop* lp) {
    std::vector<Vec3> pts;
    if (!lp || !lp->first) return pts;
    const Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount; ++i, c = c->next) {
        const Vertex* o = c->originVertex();
        pts.push_back(Vec3{o->point.x, o->point.y, o->point.z});
    }
    return pts;
}

NativeTessOut tessellateSolidForViewport(const Solid& solid) {
    NativeTessOut out;

    const double weldTol = 1e-9;
    std::map<std::tuple<long long, long long, long long>, std::uint32_t> weld;
    std::vector<double> nx, ny, nz; // double accumulators per welded vertex
    auto vid = [&](const Vec3& p) -> std::uint32_t {
        auto key = std::make_tuple(qz(p.x, weldTol), qz(p.y, weldTol), qz(p.z, weldTol));
        auto it = weld.find(key);
        if (it != weld.end()) return it->second;
        std::uint32_t id = static_cast<std::uint32_t>(out.positions.size() / 3);
        out.positions.push_back(static_cast<float>(p.x));
        out.positions.push_back(static_cast<float>(p.y));
        out.positions.push_back(static_cast<float>(p.z));
        nx.push_back(0.0); ny.push_back(0.0); nz.push_back(0.0);
        weld.emplace(key, id);
        return id;
    };

    std::uint32_t faceId = 0;
    for (Shell* sh : solid.shells) {
        for (Face* f : sh->faces) {
            Loop* lp = f->outerLoop;
            if (!lp || lp->coedgeCount < 3) continue;
            ++faceId; // 1-based, contiguous over analytic faces

            std::vector<Vec3> pts;
            pts.reserve(lp->coedgeCount);
            Coedge* c = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
                Vertex* o = c->originVertex();
                pts.push_back(Vec3{o->point.x, o->point.y, o->point.z});
                c = c->next;
            }

            Vec3 refN{0, 0, 0};
            if (f->surface)
                refN = f->surface->normalAt(0.5 * (f->u0 + f->u1),
                                            0.5 * (f->v0 + f->v1));

            // Emit one oriented triangle (outward per refN) + accumulate its
            // area-weighted normal onto the 3 welded verts + tag the faceId.
            auto emitTri = [&](const Vec3& A, const Vec3& B, const Vec3& C) {
                std::uint32_t a = vid(A), b = vid(B), c2 = vid(C);
                if (a == b || b == c2 || a == c2) return;
                Vec3 triN = vcross(vsub(B, A), vsub(C, A));
                std::uint32_t t0 = a, t1 = b, t2 = c2;
                if (f->surface && vdot(triN, refN) < 0.0) { std::swap(t1, t2); triN = vscale(triN, -1.0); }
                out.indices.push_back(t0);
                out.indices.push_back(t1);
                out.indices.push_back(t2);
                out.faceIds.push_back(faceId);
                nx[t0] += triN.x; ny[t0] += triN.y; nz[t0] += triN.z;
                nx[t1] += triN.x; ny[t1] += triN.y; nz[t1] += triN.z;
                nx[t2] += triN.x; ny[t2] += triN.y; nz[t2] += triN.z;
            };

            // HOLED ANALYTIC FACE (native boolean, e.g. a through-bore cap): the
            // face carries inner (hole) loops, so a plain fan of the OUTER loop
            // would FILL the hole and weld the through-bore shut (χ=2/genus 0). We
            // triangulate the ANNULUS between the outer loop and the inner (hole)
            // loops via a constrained Delaunay over all loops, keeping only the
            // even-odd INSIDE triangles (hole excluded). The loop vertices ARE the
            // bore-wall rim vertices, so the welded soup stays watertight with the
            // correct genus. Mirrors brep::tessellateSolid's holed path (the two
            // tessellators must agree). A CDT miss falls through to the fan.
            if (f->boolHoled && !f->innerLoops.empty() && f->surface) {
                Vec3 e1, e2; viewportPlaneBasis(refN, e1, e2);
                const Vec3 origin = pts[0];
                std::vector<geom::Point2> P2;
                std::vector<Vec3> P3;
                std::vector<geom::ConstraintEdge> cons;
                auto addRing = [&](const std::vector<Vec3>& ring) {
                    if (ring.size() < 3) return;
                    int base = static_cast<int>(P2.size());
                    for (const Vec3& p : ring) {
                        Vec3 d = vsub(p, origin);
                        P2.push_back(geom::Point2{vdot(d, e1), vdot(d, e2)});
                        P3.push_back(p);
                    }
                    int m = static_cast<int>(ring.size());
                    for (int i = 0; i < m; ++i) cons.push_back({base + i, base + ((i + 1) % m)});
                };
                addRing(pts);                                        // outer loop
                for (Loop* il : f->innerLoops) addRing(viewportLoopPts(il)); // holes

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
                        emitTri(q[0], q[1], q[2]);
                    }
                    continue; // holed face done; do NOT fan (would fill the hole)
                }
                // CDT miss: fall through to the fan (best-effort).
            }

            std::uint32_t i0 = vid(pts[0]);
            for (std::size_t k = 1; k + 1 < pts.size(); ++k) {
                std::uint32_t i1 = vid(pts[k]);
                std::uint32_t i2 = vid(pts[k + 1]);
                if (i0 == i1 || i1 == i2 || i0 == i2) continue;
                Vec3 a = pts[0], b = pts[k], cc = pts[k + 1];
                Vec3 triN = vcross(vsub(b, a), vsub(cc, a));
                bool flip = (f->surface && vdot(triN, refN) < 0.0);
                std::uint32_t t0 = i0, t1 = i1, t2 = i2;
                if (flip) { std::swap(t1, t2); triN = vscale(triN, -1.0); }
                out.indices.push_back(t0);
                out.indices.push_back(t1);
                out.indices.push_back(t2);
                out.faceIds.push_back(faceId);
                // area-weighted face normal accumulated onto the 3 verts
                nx[t0] += triN.x; ny[t0] += triN.y; nz[t0] += triN.z;
                nx[t1] += triN.x; ny[t1] += triN.y; nz[t1] += triN.z;
                nx[t2] += triN.x; ny[t2] += triN.y; nz[t2] += triN.z;
            }
        }
    }

    const std::size_t nv = out.positions.size() / 3;
    out.normals.resize(3 * nv, 0.0f);
    for (std::size_t i = 0; i < nv; ++i) {
        double l = std::sqrt(nx[i] * nx[i] + ny[i] * ny[i] + nz[i] * nz[i]);
        if (l > 1e-20) {
            out.normals[3 * i + 0] = static_cast<float>(nx[i] / l);
            out.normals[3 * i + 1] = static_cast<float>(ny[i] / l);
            out.normals[3 * i + 2] = static_cast<float>(nz[i] / l);
        } else {
            out.normals[3 * i + 2] = 1.0f;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// tessellateMeshForViewport — fillet/chamfer RESULT mesh -> viewport contract.
// faceId = mesh face index + 1 (no analytic-face grouping for a mesh result).
// ---------------------------------------------------------------------------
NativeTessOut tessellateMeshForViewport(const mesh::HalfEdgeMesh& m) {
    NativeTessOut out;
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    m.toSoup(pos, idx);

    const std::size_t nv = pos.size() / 3;
    out.positions.resize(pos.size());
    for (std::size_t i = 0; i < pos.size(); ++i)
        out.positions[i] = static_cast<float>(pos[i]);

    std::vector<double> nx(nv, 0.0), nyv(nv, 0.0), nz(nv, 0.0);
    out.indices.reserve(idx.size());
    out.faceIds.reserve(idx.size() / 3);
    for (std::size_t f = 0; f + 2 < idx.size(); f += 3) {
        std::uint32_t a = idx[f], b = idx[f + 1], cc = idx[f + 2];
        out.indices.push_back(a);
        out.indices.push_back(b);
        out.indices.push_back(cc);
        out.faceIds.push_back(static_cast<std::uint32_t>(f / 3) + 1);
        Vec3 pa{pos[3*a], pos[3*a+1], pos[3*a+2]};
        Vec3 pb{pos[3*b], pos[3*b+1], pos[3*b+2]};
        Vec3 pc{pos[3*cc], pos[3*cc+1], pos[3*cc+2]};
        Vec3 nn = vcross(vsub(pb, pa), vsub(pc, pa));
        nx[a] += nn.x; nyv[a] += nn.y; nz[a] += nn.z;
        nx[b] += nn.x; nyv[b] += nn.y; nz[b] += nn.z;
        nx[cc] += nn.x; nyv[cc] += nn.y; nz[cc] += nn.z;
    }
    out.normals.resize(3 * nv, 0.0f);
    for (std::size_t i = 0; i < nv; ++i) {
        double l = std::sqrt(nx[i]*nx[i] + nyv[i]*nyv[i] + nz[i]*nz[i]);
        if (l > 1e-20) {
            out.normals[3*i+0] = static_cast<float>(nx[i] / l);
            out.normals[3*i+1] = static_cast<float>(nyv[i] / l);
            out.normals[3*i+2] = static_cast<float>(nz[i] / l);
        } else {
            out.normals[3*i+2] = 1.0f;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// meshMassProperties — volume / area / COM / inertia(about COM) of a closed
// triangle mesh via signed-tetra decomposition from the origin. Unit density.
// HONEST: the inertia of a fillet/chamfer RESULT mesh, not an analytic tensor.
// ---------------------------------------------------------------------------
MeshMassOut meshMassProperties(const mesh::HalfEdgeMesh& m) {
    MeshMassOut out;
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    m.toSoup(pos, idx);

    // Origin-tetra accumulation of the volume integrals. Standard formulae
    // (Eberly / Mirtich) for the polyhedron mass tensor at unit density.
    double vol = 0.0;
    double mx = 0.0, my = 0.0, mz = 0.0;            // first moments * 6 -> handled below
    // Second moments accumulators (about the ORIGIN): integrals of x^2, y^2, z^2,
    // xy, yz, zx over the solid volume.
    double ixx = 0, iyy = 0, izz = 0, ixy = 0, iyz = 0, izx = 0;
    double area = 0.0;

    for (std::size_t f = 0; f + 2 < idx.size(); f += 3) {
        const std::uint32_t ia = idx[f], ib = idx[f + 1], ic = idx[f + 2];
        const Vec3 a{pos[3*ia], pos[3*ia+1], pos[3*ia+2]};
        const Vec3 b{pos[3*ib], pos[3*ib+1], pos[3*ib+2]};
        const Vec3 c{pos[3*ic], pos[3*ic+1], pos[3*ic+2]};

        // signed volume of tetra (O,a,b,c) = det[a b c]/6
        const double det =
            a.x * (b.y * c.z - b.z * c.y)
          - a.y * (b.x * c.z - b.z * c.x)
          + a.z * (b.x * c.y - b.y * c.x);
        const double vTet = det / 6.0;
        vol += vTet;

        // surface area of the triangle
        Vec3 cr = vcross(vsub(b, a), vsub(c, a));
        area += 0.5 * std::sqrt(cr.x*cr.x + cr.y*cr.y + cr.z*cr.z);

        // centroid of the tetra (O,a,b,c) is (a+b+c)/4
        mx += vTet * (a.x + b.x + c.x) / 4.0;
        my += vTet * (a.y + b.y + c.y) / 4.0;
        mz += vTet * (a.z + b.z + c.z) / 4.0;

        // Second moments of the tetra (O,a,b,c) about the ORIGIN, unit density.
        // For a tetra with one vertex at the origin and the others p1,p2,p3,
        // ∫ x_i x_j dV = (vTet/20) * ( Σ_k p_k.i p_k.j + (Σ p_k.i)(Σ p_k.j) ).
        auto sec = [&](double a0, double a1, double a2,
                       double b0, double b1, double b2) {
            const double sumA = a0 + a1 + a2;
            const double sumB = b0 + b1 + b2;
            return (vTet / 20.0) *
                   (a0*b0 + a1*b1 + a2*b2 + sumA * sumB);
        };
        const double Ixx = sec(a.x, b.x, c.x, a.x, b.x, c.x);
        const double Iyy = sec(a.y, b.y, c.y, a.y, b.y, c.y);
        const double Izz = sec(a.z, b.z, c.z, a.z, b.z, c.z);
        const double Ixy = sec(a.x, b.x, c.x, a.y, b.y, c.y);
        const double Iyz = sec(a.y, b.y, c.y, a.z, b.z, c.z);
        const double Izx = sec(a.z, b.z, c.z, a.x, b.x, c.x);
        ixx += Ixx; iyy += Iyy; izz += Izz;
        ixy += Ixy; iyz += Iyz; izx += Izx;
    }

    out.volume = vol;
    out.area = area;
    if (std::abs(vol) < 1e-300) return out;

    const double cx = mx / vol, cy = my / vol, cz = mz / vol;
    out.com[0] = cx; out.com[1] = cy; out.com[2] = cz;

    // Inertia tensor about the ORIGIN (mass moments):
    //   Ixx = ∫(y^2+z^2), Iyy = ∫(x^2+z^2), Izz = ∫(x^2+y^2)
    //   Ixy = -∫xy, etc.
    double Oxx = iyy + izz;
    double Oyy = ixx + izz;
    double Ozz = ixx + iyy;
    double Oxy = -ixy;
    double Oyz = -iyz;
    double Ozx = -izx;

    // Parallel-axis shift to the COM (mass == vol at unit density). With
    //   I_xx^O = I_xx^G + m*(cy^2+cz^2)   ->   I_xx^G = I_xx^O - m*(cy^2+cz^2)
    //   I_xy^O = I_xy^G - m*cx*cy         ->   I_xy^G = I_xy^O + m*cx*cy
    // (I_xy = -∫xy, so the product-of-inertia shift adds +m*cx*cy at the COM.)
    const double mtot = vol;
    Oxx -= mtot * (cy*cy + cz*cz);
    Oyy -= mtot * (cx*cx + cz*cz);
    Ozz -= mtot * (cx*cx + cy*cy);
    Oxy += mtot * (cx*cy);
    Oyz += mtot * (cy*cz);
    Ozx += mtot * (cz*cx);

    out.inertiaCom[0] = Oxx; out.inertiaCom[1] = Oxy; out.inertiaCom[2] = Ozx;
    out.inertiaCom[3] = Oxy; out.inertiaCom[4] = Oyy; out.inertiaCom[5] = Oyz;
    out.inertiaCom[6] = Ozx; out.inertiaCom[7] = Oyz; out.inertiaCom[8] = Ozz;
    return out;
}

} // namespace brep
} // namespace native
} // namespace forge
