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
#include <cstdlib>
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

// G1/G2 surface-sampling tessellator (KERNEL_PARITY_PLAN). OFF by default; enabled
// by env FORGE_SURFACE_TESSELLATE=1. When on, a curved analytic face is triangulated
// by sampling its Surface over the (u,v) parameter window rather than fanning the
// loop corners — the foundation for single-analytic-face primitives and watertight
// periodic/curved tessellation. Watertightness is preserved by the shared vid weld
// grid: adjacent co-parametrised faces sample a shared edge at IDENTICAL params (so
// coincident positions weld), and a periodic face's u=u0 and u=u1 columns evaluate to
// the same points (cos u0 == cos u1) so the seam welds automatically.
inline bool surfaceTessEnabled() {
    // DEFAULT OFF (opt-in via FORGE_SURFACE_TESSELLATE=1). Default-ON was reverted:
    // it changed the native mesh density and CRASHED gdt/fcf_evaluator_test (exit
    // 133) in the C++ native-gate suite, which asserts on the legacy fan mesh. The
    // surface-sampling path stays available behind the flag until the downstream
    // mesh consumers (FCF evaluator, etc.) are made density-agnostic.
    static const bool on = []() {
        const char* e = std::getenv("FORGE_SURFACE_TESSELLATE");
        return e && e[0] == '1';
    }();
    return on;
}

// CURVATURE-ADAPTIVE segment count for the v (non-angular) direction of a curved
// face, driven by CHORD ERROR (sagitta) rather than arc LENGTH. Sampled at the
// face's u-midpoint over [va,vb] (interior 1/4,1/2,3/4 points, worst sagitta):
//
//   * A RULED generator — a cylinder or cone axial line — has ZERO sagitta, so
//     this returns 1 segment (the quad is geometrically exact along the axis).
//     That is the fix for the surface-tessellator's cost blow-up: the old
//     arcSegs(|dS/dv|*vSpan, 0.5) sliced a straight cylinder/cone wall into
//     height/0.5 axial strips (a 12-unit bore wall -> 24 rows), inflating the
//     watertight tessellation AND the boolean's point-in-solid validation soup
//     (buildSoup -> pointInSoup is O(triangles) PER classified point), which is
//     exactly what timed native_boolean_test out with FORGE_SURFACE_TESSELLATE on.
//   * A genuinely curved param (e.g. a NURBS' linear direction) subdivides only
//     as much as the chord tolerance `tol` demands: for an arc-like bulge the
//     sagitta falls ~1/n^2 under n subdivisions, so n = ceil(sqrt(sag/tol)).
//
// WATERTIGHT: every strip of ONE analytic surface shares the same kind + v-span,
// so nv is identical across the strips that meet on a shared vertical edge — the
// weld grid still stitches them crack-free (a ruled wall is nv=1 everywhere).
inline int chordSegs(const Surface& S, double uMid, double va, double vb, double tol) {
    const Vec3 p0 = S.evaluate(uMid, va);
    const Vec3 p1 = S.evaluate(uMid, vb);
    double sag = 0.0;
    for (double f : {0.25, 0.5, 0.75}) {
        const Vec3 pm = S.evaluate(uMid, va + (vb - va) * f);
        const Vec3 onChord{p0.x + (p1.x - p0.x) * f,
                           p0.y + (p1.y - p0.y) * f,
                           p0.z + (p1.z - p0.z) * f};
        sag = std::max(sag, vlen(vsub(pm, onChord)));
    }
    if (sag <= tol) return 1;
    int n = static_cast<int>(std::ceil(std::sqrt(sag / std::max(tol, 1e-12))));
    return std::max(1, std::min(n, 512));
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

            // G1/G2 SURFACE-SAMPLING (flag-gated, off by default): sample a curved
            // analytic face over its (u,v) window into a conforming grid mesh, rather
            // than fanning the loop corners. Skips planar faces (the fan is exact for
            // them) and holed/boolean faces (handled by the CDT path below).
            if (surfaceTessEnabled() && f->surface &&
                f->surface->kind != SurfaceKind::Plane &&
                f->innerLoops.empty() && !f->boolHoled) {
                const Surface& S = *f->surface;
                const double uu0 = f->u0, uu1 = f->u1, vv0 = f->v0, vv1 = f->v1;
                // Segment counts MUST be conforming across shared edges: two faces
                // meeting on an edge must subdivide it identically or the weld grid
                // leaves a crack. For an ANGULAR parameter direction we therefore base
                // the count on the ANGLE span alone (constant per band) — NOT on arc
                // length |dS/du|, which for a torus varies with v (radius R+r·cos v)
                // and would give neighbouring bands different nu (the torus crack).
                // The non-angular v direction (cylinder/cone axial GENERATOR, or a
                // NURBS linear param) is sized by the CURVATURE-ADAPTIVE chord ERROR
                // (chordSegs): a ruled generator has zero sagitta -> nv=1 (exact),
                // which stops a straight wall exploding into height/chord axial strips.
                const SurfaceKind kd = S.kind;
                const bool angV = (kd == SurfaceKind::Sphere || kd == SurfaceKind::Torus);
                const double angDensity = 32.0 / M_PI;  // full 2*pi -> 64 segments (angular dir)
                const double chordTol = 0.5;             // model-unit chord-ERROR tolerance
                const double uMid = 0.5 * (uu0 + uu1);
                const double uSpan = std::fabs(uu1 - uu0), vSpan = std::fabs(vv1 - vv0);
                // u is angular for every curved quadric here: size it by ANGLE span
                // (constant per band = conforming). Do NOT use arc length |dS/du| or a
                // torus's v-varying ring radius (R+r*cos v) cracks adjacent bands.
                const int nu = std::max(1, (int)std::lround(uSpan * angDensity));
                // v: angular for sphere/torus (angle span, conforming); otherwise a
                // cylinder/cone axial GENERATOR (or a NURBS linear param) sized by the
                // CURVATURE-ADAPTIVE chord error -> a ruled wall is nv=1 (exact), no
                // longer exploding into height/chord strips.
                const int nv = angV ? std::max(1, (int)std::lround(vSpan * angDensity))
                                    : chordSegs(S, uMid, vv0, vv1, chordTol);
                for (int iu = 0; iu < nu; ++iu) {
                    const double ua = uu0 + (uu1 - uu0) * (double(iu) / nu);
                    const double ub = uu0 + (uu1 - uu0) * (double(iu + 1) / nu);
                    for (int iv = 0; iv < nv; ++iv) {
                        const double va = vv0 + (vv1 - vv0) * (double(iv) / nv);
                        const double vb = vv0 + (vv1 - vv0) * (double(iv + 1) / nv);
                        const Vec3 p00 = S.evaluate(ua, va);
                        const Vec3 p10 = S.evaluate(ub, va);
                        const Vec3 p11 = S.evaluate(ub, vb);
                        const Vec3 p01 = S.evaluate(ua, vb);
                        const Vec3 nrm = S.normalAt(0.5 * (ua + ub), 0.5 * (va + vb));
                        auto emitTri = [&](const Vec3& A, const Vec3& B, const Vec3& C) {
                            std::uint32_t a = vid(A), b = vid(B), c2 = vid(C);
                            if (a == b || b == c2 || a == c2) return;  // degenerate (pole)
                            Vec3 tn = vcross(vsub(B, A), vsub(C, A));
                            if (vdot(tn, nrm) < 0.0) {
                                indices.push_back(a); indices.push_back(c2); indices.push_back(b);
                            } else {
                                indices.push_back(a); indices.push_back(b); indices.push_back(c2);
                            }
                        };
                        emitTri(p00, p10, p11);
                        emitTri(p00, p11, p01);
                    }
                }
                continue;
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

            // FULL-PERIOD curved face (a native-merged / imported periodic cylinder):
            // its outer loop WRAPS a full 2*pi turn (bottom ring + seam + top ring +
            // seam), so the corner FAN is geometrically invalid (a cylinder cannot be
            // fanned from one vertex). Surface-SAMPLE it instead — sampling the ANGULAR
            // (u) direction at the loop's OWN rim resolution nu = (coedgeCount-2)/2 so
            // the rim sample points coincide with the neighbouring cap polygons (the
            // caps reuse the same rim vertices → the weld grid stitches them crack-free),
            // and the axial (v) direction curvature-adaptively (a ruled cylinder wall is
            // nv=1, exact). This runs ONLY when the flagged surface-tessellator above did
            // not (default OFF) AND only for the rare full-period single face: every
            // primitive strip has a SMALL u-span (2*pi/nSeg), so this never perturbs the
            // box/primitive/fillet meshes the C++ native gates assert on. It is the
            // tessellation counterpart of unifySameDomainCurved (UnifyFaces.cpp).
            if (f->surface && f->surface->kind != SurfaceKind::Plane &&
                f->innerLoops.empty() && !f->boolHoled &&
                lp->coedgeCount >= 6 && (lp->coedgeCount % 2) == 0 &&
                std::fabs(std::fabs(f->u1 - f->u0) - 2.0 * M_PI) <= 1e-6) {
                const Surface& S = *f->surface;
                const double uu0 = f->u0, uu1 = f->u1, vv0 = f->v0, vv1 = f->v1;
                // Angular resolution from the loop rim. A cylinder / cone-frustum loop
                // is [botRing(n), seam, topRing(n), seam] -> coedgeCount = 2n+2, so
                // nu = (coedgeCount-2)/2 == n == the cap rim (conforming). A pointed
                // cone's top ring COLLAPSES to the apex, so its loop is [botRing(n),
                // seam, apex] -> coedgeCount = n+2 and the base rim is n = coedgeCount-2
                // (NOT halved) — sampling at n keeps it conforming with the single cap.
                // A sphere has BOTH ends degenerate (poles) and no adjacent cap, so the
                // halved count is left unchanged (self-contained, watertight either way).
                const double uMid = 0.5 * (uu0 + uu1);
                auto endDegenerate = [&](double vEnd) {
                    const Vec3 a = S.evaluate(uu0, vEnd);
                    const Vec3 b = S.evaluate(uMid, vEnd);
                    return vlen(vsub(b, a)) <= 1e-9 * std::max(1.0, vlen(a));
                };
                const bool degBot = endDegenerate(vv0);
                const bool degTop = endDegenerate(vv1);
                const int nu = (degBot != degTop)
                                   ? static_cast<int>(lp->coedgeCount - 2)       // apex cone
                                   : static_cast<int>((lp->coedgeCount - 2) / 2); // cyl/frustum/sphere
                const int nv = chordSegs(S, uMid, vv0, vv1, 0.5);
                for (int iu = 0; iu < nu; ++iu) {
                    const double ua = uu0 + (uu1 - uu0) * (double(iu) / nu);
                    const double ub = uu0 + (uu1 - uu0) * (double(iu + 1) / nu);
                    for (int iv = 0; iv < nv; ++iv) {
                        const double va = vv0 + (vv1 - vv0) * (double(iv) / nv);
                        const double vb = vv0 + (vv1 - vv0) * (double(iv + 1) / nv);
                        const Vec3 p00 = S.evaluate(ua, va);
                        const Vec3 p10 = S.evaluate(ub, va);
                        const Vec3 p11 = S.evaluate(ub, vb);
                        const Vec3 p01 = S.evaluate(ua, vb);
                        const Vec3 nrm = S.normalAt(0.5 * (ua + ub), 0.5 * (va + vb));
                        auto emitTri = [&](const Vec3& A, const Vec3& B, const Vec3& C) {
                            std::uint32_t a = vid(A), b = vid(B), c2 = vid(C);
                            if (a == b || b == c2 || a == c2) return;   // degenerate
                            Vec3 tn = vcross(vsub(B, A), vsub(C, A));
                            if (vdot(tn, nrm) < 0.0) {
                                indices.push_back(a); indices.push_back(c2); indices.push_back(b);
                            } else {
                                indices.push_back(a); indices.push_back(b); indices.push_back(c2);
                            }
                        };
                        emitTri(p00, p10, p11);
                        emitTri(p00, p11, p01);
                    }
                }
                continue;
            }

            // Fan-triangulate the loop polygon IN ITS OWN WINDING — do NOT re-orient
            // the triangles against the face's surface normal.
            //
            // A fan emitted in the loop's winding has boundary == the loop, EXACTLY:
            // the interior diagonals (0,t) each appear once forward and once reversed
            // and cancel, whatever the polygon's convexity. Every edge of the B-rep is
            // traversed by its two coedges in OPPOSITE directions, so the loops then
            // cancel across the solid and the welded soup is a CLOSED surface. That
            // closure is the property the whole faceted pipeline rests on: it is what
            // makes the divergence-theorem volume well defined (independent of the
            // integration origin), what lets OCCT's BRepGProp integral of the rebuilt
            // B-rep agree with it, and what NativeOcctBridge's self-check tests.
            //
            // The removed rule re-wound each fan triangle on its own to agree with
            // refN. On a NON-CONVEX loop that is wrong twice over: the opposite-wound
            // triangles are SUBTRACTING the reflex pockets, so re-winding one both
            // turns it additive AND leaves its two diagonals uncancelled — the chain's
            // boundary is no longer the loop and the soup is no longer closed.
            // Re-winding the WHOLE face instead is no better: it inverts the loop, so
            // that face's edges stop cancelling against the neighbours that were not
            // inverted (measured — it costs three other bodies, see below).
            //
            // MEASURED on mmcad_b tractable_pool/00000_117.step (29 faces, 1004 fan
            // triangles, 15 of the 29 mixed-winding): the old rule gave
            // sum(area*n) = (44.926, -49.636, -11.697) instead of 0, every face
            // individually correct (1003/1003 exact areas, all FORWARD, manual flux ==
            // the polyhedron volume) and yet BRepGProp integrating the assembled solid
            // 3.05% low — "OCCT 33266.9651 vs native polyhedron 34315.2659", which is
            // the bridge REFUSING a body it should accept. Emitting the loop winding
            // gives sum(area*n) = (0,0,0) and the two integrals agree to every digit.
            // Over a 215-file stride sample of that 4296-file pool, STEP import goes
            // 110/215 -> 134/215 (mis-integration refusals 98 -> 74); the three
            // whole-face-reversal variants all scored worse or equal and none beat it.
            //
            // A globally INVERTED solid (every loop wound the other way) is still fine:
            // it stays closed, and NativeOcctBridge's own `if (vp.Mass() < 0) Reverse()`
            // puts the sign right. Only a solid whose loops disagree WITH EACH OTHER is
            // unfixable here, and that is a malformed B-rep the self-check must reject.
            std::uint32_t i0 = vid(pts[0]);
            for (std::size_t t = 1; t + 1 < pts.size(); ++t) {
                std::uint32_t i1 = vid(pts[t]);
                std::uint32_t i2 = vid(pts[t + 1]);
                if (i0 == i1 || i1 == i2 || i0 == i2) continue; // degenerate
                indices.push_back(i0); indices.push_back(i1); indices.push_back(i2);
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
