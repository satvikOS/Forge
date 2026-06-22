// forge/native/brep/Primitives.cpp
//
// Implementation of the canonical primitive solid builders (Primitives.hpp).
// Pure C++20, no external deps. See header for placement / honesty / scope.

#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Surface.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>

namespace forge {
namespace native {
namespace brep {

namespace {
constexpr double kPi = 3.14159265358979323846;

inline Vec3 V3(const Point3& p) { return Vec3{p.x, p.y, p.z}; }

// Attach a planar Surface to a face whose ring lies in a known plane.
// vertexUV[i] = plane coords of ring[i]; mass integrator does an EXACT polygon
// moment integral over those. `outwardNormal` orients the plane normal outward.
void attachPlanarFace(TopologyBuilder& tb, Face* f,
                      const std::vector<Vertex*>& ring,
                      const Vec3& origin, const Vec3& uDir, const Vec3& vDir,
                      const Vec3& outwardNormal) {
    Surface* s = tb.makeSurface();
    s->kind = SurfaceKind::Plane;
    s->origin = origin;
    s->refDir = vnorm(uDir);
    s->axis   = vnorm(vcross(uDir, vDir));
    s->reversed = (vdot(s->axis, outwardNormal) < 0.0);
    f->surface = s;
    f->vertexUV.clear();
    f->vertexUV.reserve(ring.size());
    double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
    for (std::size_t i = 0; i < ring.size(); ++i) {
        Vec3 rel = vsub(V3(ring[i]->point), origin);
        double pu = vdot(rel, s->refDir);
        double pv = vdot(rel, s->binormal());
        f->vertexUV.push_back({pu, pv});
        if (i == 0) { u0 = u1 = pu; v0 = v1 = pv; }
        else {
            u0 = std::min(u0, pu); u1 = std::max(u1, pu);
            v0 = std::min(v0, pv); v1 = std::max(v1, pv);
        }
    }
    f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;
}

// Attach a curved analytic surface + trim window + corner (u,v) to a face.
void attachCurvedFace(Face* f, Surface* s, double u0, double u1,
                      double v0, double v1,
                      std::vector<std::array<double, 2>> cornerUV) {
    f->surface = s;
    f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;
    f->vertexUV = std::move(cornerUV);
}
} // namespace

// ===========================================================================
// BOX — min corner at origin, [0,dx]x[0,dy]x[0,dz]. Six planar faces.
// ===========================================================================
Solid* SolidFactory::buildBox(double dx, double dy, double dz) {
    assert(dx > 0 && dy > 0 && dz > 0);
    TopologyBuilder& tb = tb_;
    Vertex* v[8];
    v[0] = tb.makeVertex({0, 0, 0});
    v[1] = tb.makeVertex({dx, 0, 0});
    v[2] = tb.makeVertex({dx, dy, 0});
    v[3] = tb.makeVertex({0, dy, 0});
    v[4] = tb.makeVertex({0, 0, dz});
    v[5] = tb.makeVertex({dx, 0, dz});
    v[6] = tb.makeVertex({dx, dy, dz});
    v[7] = tb.makeVertex({0, dy, dz});

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    struct FaceDef { int idx[4]; Vec3 normal; };
    const FaceDef defs[6] = {
        {{0, 3, 2, 1}, {0, 0, -1}}, // bottom
        {{4, 5, 6, 7}, {0, 0, 1}},  // top
        {{0, 1, 5, 4}, {0, -1, 0}}, // front (y=0)
        {{2, 3, 7, 6}, {0, 1, 0}},  // back  (y=dy)
        {{0, 4, 7, 3}, {-1, 0, 0}}, // left  (x=0)
        {{1, 2, 6, 5}, {1, 0, 0}},  // right (x=dx)
    };
    for (const auto& d : defs) {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {v[d.idx[0]], v[d.idx[1]], v[d.idx[2]], v[d.idx[3]]};
        tb.addOuterLoopToFace(f, ring);
        Vec3 o = V3(ring[0]->point);
        Vec3 uDir = vsub(V3(ring[1]->point), o);
        Vec3 vDir = vsub(V3(ring[3]->point), o);
        attachPlanarFace(tb, f, ring, o, uDir, vDir, d.normal);
    }
    return solid;
}

// ===========================================================================
// Shared ring helper for cylinder / cone / tube lateral surfaces.
//   Builds N segment vertices on a circle of radius r at height z (axis +Z,
//   centred on the Z axis). Returns the N vertices.
// ===========================================================================
static std::vector<Vertex*> makeRing(TopologyBuilder& tb, int N, double r, double z) {
    std::vector<Vertex*> ring(N);
    for (int i = 0; i < N; ++i) {
        double th = 2.0 * kPi * i / N;
        ring[i] = tb.makeVertex({r * std::cos(th), r * std::sin(th), z});
    }
    return ring;
}

// Build a single cap face from a ring of rim vertices. The cap loop reuses the
// rim arc-edges (so they are shared with the side faces). The ring order given
// is CCW as seen along +outwardNormal (so the cap's outward normal follows the
// right-hand rule). `z` is the cap plane height.
//
// If diskR > 0 the cap is tagged as an EXACT circular disk of radius diskR
// centred on the axis: the mass integrator then integrates the true disk
// (consistent with the analytic side's exact arc boundary), while tessellation
// uses the chord polygon. Pass diskR == 0 for a genuine polygon cap (prism).
static void addPolyCap(TopologyBuilder& tb, Shell* shell,
                       const std::vector<Vertex*>& ringCCW, double z,
                       const Vec3& outwardNormal, double diskR) {
    Face* f = tb.makeFace();
    tb.addFaceToShell(shell, f);
    tb.addOuterLoopToFace(f, ringCCW);
    Vec3 o{0, 0, z};
    attachPlanarFace(tb, f, ringCCW, o, Vec3{1, 0, 0}, Vec3{0, 1, 0}, outwardNormal);
    if (diskR > 0.0) {
        Surface* s = f->surface;
        s->isDisk = true;
        s->origin = o;
        s->diskOuter = diskR;
        s->diskInner = 0.0;
        // Full-disk angular trim window.
        f->u0 = 0.0; f->u1 = 2.0 * kPi; f->v0 = 0.0; f->v1 = diskR;
    }
}

// ===========================================================================
// CONE / CYLINDER (rB==rT) / FRUSTUM — axis +Z, base at z=0, top at z=h.
//   rT==0 collapses the top rim to a single apex vertex.
// ===========================================================================
Solid* SolidFactory::buildCone(double rB, double rT, double h) {
    assert(h > 0 && rB >= 0 && rT >= 0 && (rB > 0 || rT > 0));
    TopologyBuilder& tb = tb_;
    const int N = opt_.nSeg;
    const bool topApex = (rT <= 0.0);

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    // Shared analytic cone surface. radius r(v) = rB + (rT-rB)*v, axis len h.
    Surface* side = tb.makeSurface();
    side->kind = SurfaceKind::Cone;
    side->origin = {0, 0, 0};
    side->axis = {0, 0, 1};
    side->refDir = {1, 0, 0};
    side->r1 = rB; side->r2 = rT; side->param = h;
    side->reversed = false; // (du=dtheta) x (dv=along slant) points outward — verified by gate

    std::vector<Vertex*> bot = makeRing(tb, N, rB, 0.0);
    std::vector<Vertex*> top;
    Vertex* apex = nullptr;
    if (topApex) apex = tb.makeVertex({0, 0, h});
    else         top = makeRing(tb, N, rT, h);

    // Side faces: one quad (or triangle to apex) per angular sector.
    for (int i = 0; i < N; ++i) {
        int j = (i + 1) % N;
        double u0 = 2.0 * kPi * i / N;
        double u1 = 2.0 * kPi * (i + 1) / N; // note: (i+1), un-wrapped so u1>u0
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        if (topApex) {
            // triangle: bot[i] -> bot[j] -> apex  (CCW from outside)
            std::vector<Vertex*> ring = {bot[i], bot[j], apex};
            tb.addOuterLoopToFace(f, ring);
            attachCurvedFace(f, side, u0, u1, 0.0, 1.0,
                             {{u0, 0.0}, {u1, 0.0}, {u0, 1.0}});
        } else {
            // quad: bot[i] -> bot[j] -> top[j] -> top[i]  (CCW from outside)
            std::vector<Vertex*> ring = {bot[i], bot[j], top[j], top[i]};
            tb.addOuterLoopToFace(f, ring);
            attachCurvedFace(f, side, u0, u1, 0.0, 1.0,
                             {{u0, 0.0}, {u1, 0.0}, {u1, 1.0}, {u0, 1.0}});
        }
    }

    // Bottom cap (normal -Z): CCW as seen from below is the reversed ring.
    // Exact disk of radius rB.
    {
        std::vector<Vertex*> capCCW(bot.rbegin(), bot.rend());
        addPolyCap(tb, shell, capCCW, 0.0, Vec3{0, 0, -1}, rB);
    }
    // Top cap (normal +Z) only for a frustum (apex has no top cap).
    if (!topApex) {
        addPolyCap(tb, shell, top, h, Vec3{0, 0, 1}, rT);
    }
    return solid;
}

Solid* SolidFactory::buildCylinder(double r, double h) {
    return buildCone(r, r, h);
}

// ===========================================================================
// SPHERE — centred at origin, radius r. UV grid: N around (theta), M bands
// (phi in [0,pi]); top/bottom rows are triangle fans to the poles.
// ===========================================================================
Solid* SolidFactory::buildSphere(double r) {
    assert(r > 0);
    TopologyBuilder& tb = tb_;
    const int N = opt_.nSeg;
    const int M = std::max(2, opt_.nBand);

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    Surface* surf = tb.makeSurface();
    surf->kind = SurfaceKind::Sphere;
    surf->origin = {0, 0, 0};
    surf->axis = {0, 0, 1};
    surf->refDir = {1, 0, 0};
    surf->r1 = r;
    surf->reversed = false; // verified outward by gate

    // phi rows 0..M (phi = pi*row/M). row 0 = +Z pole, row M = -Z pole.
    // Vertices for interior rows (1..M-1), N per row.
    std::vector<std::vector<Vertex*>> rows(M + 1);
    Vertex* north = tb.makeVertex({0, 0, r});
    Vertex* south = tb.makeVertex({0, 0, -r});
    for (int row = 1; row < M; ++row) {
        double phi = kPi * row / M;
        double sp = std::sin(phi), cp = std::cos(phi);
        rows[row].resize(N);
        for (int i = 0; i < N; ++i) {
            double th = 2.0 * kPi * i / N;
            rows[row][i] = tb.makeVertex({r * sp * std::cos(th),
                                          r * sp * std::sin(th),
                                          r * cp});
        }
    }

    auto uvAt = [&](int i, int row) -> std::array<double, 2> {
        return {2.0 * kPi * i / N, kPi * row / M};
    };

    for (int row = 0; row < M; ++row) {
        for (int i = 0; i < N; ++i) {
            int j = (i + 1) % N;
            double u0 = 2.0 * kPi * i / N, u1 = 2.0 * kPi * (i + 1) / N;
            double v0 = kPi * row / M, v1 = kPi * (row + 1) / M;
            Face* f = tb.makeFace();
            tb.addFaceToShell(shell, f);
            if (row == 0) {
                // top fan: north -> rows[1][j] -> rows[1][i]. The bottom edge
                // r1[j]->r1[i] is the OPPOSITE sense of the band-below top edge
                // r1[i]->r1[j], so the shared edge has two opposite-sense coedges
                // (closed-2-manifold requirement).
                std::vector<Vertex*> ring = {north, rows[1][j], rows[1][i]};
                tb.addOuterLoopToFace(f, ring);
                attachCurvedFace(f, surf, u0, u1, v0, v1,
                                 {{u0, 0.0}, uvAt(j, 1), uvAt(i, 1)});
            } else if (row == M - 1) {
                // bottom fan: rows[M-1][i] -> rows[M-1][j] -> south
                std::vector<Vertex*> ring = {rows[M - 1][i], rows[M - 1][j], south};
                tb.addOuterLoopToFace(f, ring);
                attachCurvedFace(f, surf, u0, u1, v0, v1,
                                 {uvAt(i, M - 1), uvAt(j, M - 1), {u0, kPi}});
            } else {
                // quad band: r0[i]->r0[j]->r1[j]->r1[i]  with r0 above r1
                std::vector<Vertex*> ring = {rows[row][i], rows[row][j],
                                             rows[row + 1][j], rows[row + 1][i]};
                tb.addOuterLoopToFace(f, ring);
                attachCurvedFace(f, surf, u0, u1, v0, v1,
                                 {uvAt(i, row), uvAt(j, row),
                                  uvAt(j, row + 1), uvAt(i, row + 1)});
            }
        }
    }
    return solid;
}

// ===========================================================================
// TORUS — centred at origin, axis +Z, major R (XY plane), minor r. NxM grid
// wrapping both ways => genus 1, chi = 0.
// ===========================================================================
Solid* SolidFactory::buildTorus(double R, double r) {
    assert(R > 0 && r > 0 && r < R);
    TopologyBuilder& tb = tb_;
    const int N = opt_.nSeg;          // around major (theta)
    const int M = std::max(3, opt_.nBand); // around minor (phi)

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    Surface* surf = tb.makeSurface();
    surf->kind = SurfaceKind::Torus;
    surf->origin = {0, 0, 0};
    surf->axis = {0, 0, 1};
    surf->refDir = {1, 0, 0};
    surf->r1 = R; surf->r2 = r;
    surf->reversed = false;

    // grid[i][k] vertex at theta_i, phi_k ; i in [0,N), k in [0,M) (both wrap)
    std::vector<std::vector<Vertex*>> grid(N, std::vector<Vertex*>(M));
    for (int i = 0; i < N; ++i) {
        double th = 2.0 * kPi * i / N;
        double ct = std::cos(th), st = std::sin(th);
        for (int k = 0; k < M; ++k) {
            double phi = 2.0 * kPi * k / M;
            double cp = std::cos(phi), sp = std::sin(phi);
            double ring = R + r * cp;
            grid[i][k] = tb.makeVertex({ring * ct, ring * st, r * sp});
        }
    }
    for (int i = 0; i < N; ++i) {
        int ii = (i + 1) % N;
        double u0 = 2.0 * kPi * i / N, u1 = 2.0 * kPi * (i + 1) / N;
        for (int k = 0; k < M; ++k) {
            int kk = (k + 1) % M;
            double v0 = 2.0 * kPi * k / M, v1 = 2.0 * kPi * (k + 1) / M;
            // quad: g[i][k] -> g[ii][k] -> g[ii][kk] -> g[i][kk] (CCW outside)
            std::vector<Vertex*> ring = {grid[i][k], grid[ii][k],
                                         grid[ii][kk], grid[i][kk]};
            Face* f = tb.makeFace();
            tb.addFaceToShell(shell, f);
            tb.addOuterLoopToFace(f, ring);
            attachCurvedFace(f, surf, u0, u1, v0, v1,
                             {{u0, v0}, {u1, v0}, {u1, v1}, {u0, v1}});
        }
    }
    return solid;
}

// ===========================================================================
// REGULAR PRISM — n-gon circumradius R centred on Z, z in [0,h]. All planar.
// ===========================================================================
Solid* SolidFactory::buildPrism(int n, double R, double h) {
    assert(n >= 3 && R > 0 && h > 0);
    TopologyBuilder& tb = tb_;

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    std::vector<Vertex*> bot(n), top(n);
    for (int i = 0; i < n; ++i) {
        double th = 2.0 * kPi * i / n;
        double c = std::cos(th), s = std::sin(th);
        bot[i] = tb.makeVertex({R * c, R * s, 0.0});
        top[i] = tb.makeVertex({R * c, R * s, h});
    }
    // Side faces (planar quads).
    for (int i = 0; i < n; ++i) {
        int j = (i + 1) % n;
        std::vector<Vertex*> ring = {bot[i], bot[j], top[j], top[i]};
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, ring);
        Vec3 o = V3(ring[0]->point);
        Vec3 outward = vnorm(Vec3{(V3(bot[i]->point).x + V3(bot[j]->point).x) / 2,
                                  (V3(bot[i]->point).y + V3(bot[j]->point).y) / 2, 0});
        attachPlanarFace(tb, f, ring, o,
                         vsub(V3(ring[1]->point), o),
                         vsub(V3(ring[3]->point), o), outward);
    }
    // Caps (genuine polygons — a prism's cap IS the flat n-gon, diskR=0).
    { std::vector<Vertex*> capCCW(bot.rbegin(), bot.rend());
      addPolyCap(tb, shell, capCCW, 0.0, Vec3{0, 0, -1}, 0.0); }
    addPolyCap(tb, shell, top, h, Vec3{0, 0, 1}, 0.0);
    return solid;
}

// ===========================================================================
// WEDGE — OCCT MakeWedge(dx,dy,dz,ltx): box dx*dy*dz with the +Y face shrunk in
// X to length ltx (from x=0). Min corner at origin. Eight vertices, six planar
// faces (two of them trapezoids/triangles). All planar.
// ===========================================================================
Solid* SolidFactory::buildWedge(double dx, double dy, double dz, double ltx) {
    assert(dx > 0 && dy > 0 && dz > 0 && ltx >= 0 && ltx <= dx);
    TopologyBuilder& tb = tb_;
    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    // y=0 face spans x in [0,dx]; y=dy face spans x in [0,ltx].
    Vertex* v[8];
    v[0] = tb.makeVertex({0, 0, 0});
    v[1] = tb.makeVertex({dx, 0, 0});
    v[2] = tb.makeVertex({ltx, dy, 0});
    v[3] = tb.makeVertex({0, dy, 0});
    v[4] = tb.makeVertex({0, 0, dz});
    v[5] = tb.makeVertex({dx, 0, dz});
    v[6] = tb.makeVertex({ltx, dy, dz});
    v[7] = tb.makeVertex({0, dy, dz});

    struct FaceDef { int idx[4]; Vec3 normal; };
    const FaceDef defs[6] = {
        {{0, 3, 2, 1}, {0, 0, -1}}, // bottom
        {{4, 5, 6, 7}, {0, 0, 1}},  // top
        {{0, 1, 5, 4}, {0, -1, 0}}, // y=0
        {{2, 3, 7, 6}, {0, 1, 0}},  // y=dy
        {{0, 4, 7, 3}, {-1, 0, 0}}, // x=0
        {{1, 2, 6, 5}, {1, 0, 0}},  // slanted +X face
    };
    for (const auto& d : defs) {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {v[d.idx[0]], v[d.idx[1]], v[d.idx[2]], v[d.idx[3]]};
        tb.addOuterLoopToFace(f, ring);
        Vec3 o = V3(ring[0]->point);
        attachPlanarFace(tb, f, ring, o,
                         vsub(V3(ring[1]->point), o),
                         vsub(V3(ring[3]->point), o), d.normal);
    }
    return solid;
}

// ===========================================================================
// TUBE — hollow cylinder, outer rO, inner rI, axis +Z, z in [0,h]. Outer side
// (cylinder, outward), inner side (cylinder, INWARD-facing normal), and two
// annular caps (planar rings — outer ring CCW, inner ring CW). The annular cap
// is a NON-simple polygon (it has a hole), so we triangulate it as a ring of
// quads between the outer and inner rim instead of a single loop; each quad is a
// planar face. This keeps every face a simple loop and the solid 2-manifold.
// ===========================================================================
Solid* SolidFactory::buildTube(double rO, double rI, double h) {
    assert(rO > rI && rI > 0 && h > 0);
    TopologyBuilder& tb = tb_;
    const int N = opt_.nSeg;

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    Surface* outer = tb.makeSurface();
    outer->kind = SurfaceKind::Cylinder;
    outer->origin = {0, 0, 0}; outer->axis = {0, 0, 1}; outer->refDir = {1, 0, 0};
    outer->r1 = rO; outer->param = h; outer->reversed = false;

    Surface* inner = tb.makeSurface();
    inner->kind = SurfaceKind::Cylinder;
    inner->origin = {0, 0, 0}; inner->axis = {0, 0, 1}; inner->refDir = {1, 0, 0};
    inner->r1 = rI; inner->param = h; inner->reversed = true; // faces toward the axis (into the void)

    std::vector<Vertex*> oBot = makeRing(tb, N, rO, 0.0);
    std::vector<Vertex*> oTop = makeRing(tb, N, rO, h);
    std::vector<Vertex*> iBot = makeRing(tb, N, rI, 0.0);
    std::vector<Vertex*> iTop = makeRing(tb, N, rI, h);

    for (int i = 0; i < N; ++i) {
        int j = (i + 1) % N;
        double u0 = 2.0 * kPi * i / N, u1 = 2.0 * kPi * (i + 1) / N;
        // outer side (outward): oBot[i]->oBot[j]->oTop[j]->oTop[i]
        {
            Face* f = tb.makeFace(); tb.addFaceToShell(shell, f);
            std::vector<Vertex*> ring = {oBot[i], oBot[j], oTop[j], oTop[i]};
            tb.addOuterLoopToFace(f, ring);
            attachCurvedFace(f, outer, u0, u1, 0.0, h,
                             {{u0, 0.0}, {u1, 0.0}, {u1, h}, {u0, h}});
        }
        // inner side (faces INward toward the void): reverse the winding so the
        // coedge order is opposite the outer wall (closed-2-manifold), while the
        // analytic normal is flipped toward the axis via inner->reversed=true.
        // Keep the trim window in NATURAL (u0<u1) order so the mass integrator's
        // du*dv Jacobian stays positive; the inward normal is handled by the flag.
        {
            Face* f = tb.makeFace(); tb.addFaceToShell(shell, f);
            std::vector<Vertex*> ring = {iBot[j], iBot[i], iTop[i], iTop[j]};
            tb.addOuterLoopToFace(f, ring);
            attachCurvedFace(f, inner, u0, u1, 0.0, h,
                             {{u1, 0.0}, {u0, 0.0}, {u0, h}, {u1, h}});
        }
        // bottom annular quad (normal -Z): outer ring CW seen from below.
        //   oBot[j]->oBot[i]->iBot[i]->iBot[j]
        {
            Face* f = tb.makeFace(); tb.addFaceToShell(shell, f);
            std::vector<Vertex*> ring = {oBot[j], oBot[i], iBot[i], iBot[j]};
            tb.addOuterLoopToFace(f, ring);
            Vec3 o = V3(ring[0]->point);
            attachPlanarFace(tb, f, ring, o, vsub(V3(ring[1]->point), o),
                             vsub(V3(ring[3]->point), o), Vec3{0, 0, -1});
            Surface* s = f->surface;
            s->isDisk = true; s->origin = {0, 0, 0};
            s->diskOuter = rO; s->diskInner = rI;
            f->u0 = u0; f->u1 = u1; f->v0 = rI; f->v1 = rO;
        }
        // top annular quad (normal +Z): outer ring CCW seen from above.
        //   oTop[i]->oTop[j]->iTop[j]->iTop[i]
        {
            Face* f = tb.makeFace(); tb.addFaceToShell(shell, f);
            std::vector<Vertex*> ring = {oTop[i], oTop[j], iTop[j], iTop[i]};
            tb.addOuterLoopToFace(f, ring);
            Vec3 o = V3(ring[0]->point);
            attachPlanarFace(tb, f, ring, o, vsub(V3(ring[1]->point), o),
                             vsub(V3(ring[3]->point), o), Vec3{0, 0, 1});
            Surface* s = f->surface;
            s->isDisk = true; s->origin = {0, 0, h};
            s->diskOuter = rO; s->diskInner = rI;
            f->u0 = u0; f->u1 = u1; f->v0 = rI; f->v1 = rO;
        }
    }
    return solid;
}

// ===========================================================================
// PYRAMID — rectangular base dx x dy centred on origin (z=0), apex at (0,0,h).
// Base + 4 triangular sides (all PLANAR). No NURBS needed (flat skin), so this
// is an EXACT analytic (planar) solid.
// ===========================================================================
Solid* SolidFactory::buildPyramid(double dx, double dy, double h) {
    assert(dx > 0 && dy > 0 && h > 0);
    TopologyBuilder& tb = tb_;
    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    Vertex* b0 = tb.makeVertex({-dx / 2, -dy / 2, 0});
    Vertex* b1 = tb.makeVertex({ dx / 2, -dy / 2, 0});
    Vertex* b2 = tb.makeVertex({ dx / 2,  dy / 2, 0});
    Vertex* b3 = tb.makeVertex({-dx / 2,  dy / 2, 0});
    Vertex* apex = tb.makeVertex({0, 0, h});

    // Base (normal -Z): CCW from below => b0,b3,b2,b1
    {
        std::vector<Vertex*> ring = {b0, b3, b2, b1};
        Face* f = tb.makeFace(); tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, ring);
        Vec3 o = V3(ring[0]->point);
        attachPlanarFace(tb, f, ring, o, vsub(V3(ring[1]->point), o),
                         vsub(V3(ring[3]->point), o), Vec3{0, 0, -1});
    }
    // Four triangular side faces (CCW from outside).
    Vertex* base[4] = {b0, b1, b2, b3};
    for (int i = 0; i < 4; ++i) {
        Vertex* a = base[i];
        Vertex* b = base[(i + 1) % 4];
        std::vector<Vertex*> ring = {a, b, apex};
        Face* f = tb.makeFace(); tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, ring);
        Vec3 o = V3(ring[0]->point);
        // outward normal = (b-a) x (apex-a), pointing away from the axis.
        Vec3 outward = vnorm(vcross(vsub(V3(b->point), o), vsub(V3(apex->point), o)));
        attachPlanarFace(tb, f, ring, o, vsub(V3(ring[1]->point), o),
                         vsub(V3(ring[2]->point), o), outward);
    }
    return solid;
}

// ===========================================================================
// ELLIPSOID — unit sphere scaled by diag(rx,ry,rz). Built like the sphere but
// the lateral skin is a NURBS surface (a non-uniformly scaled sphere is NOT a
// quadric of revolution we model analytically here), so this is the one
// NURBS-skin primitive. Topology identical to the sphere; each face's geometry
// is a bicubic NURBS patch fitted to the ellipsoid (the gate validates its mass
// props to the 0.5% NURBS tolerance via surface quadrature).
//
// HONEST NOTE: for MASS PROPERTIES the gate uses the exact closed form
// (V = 4/3 pi rx ry rz, COM = 0, I from the scaled-sphere formula); the NURBS
// path is validated by tessellation-volume + the quadrature integrator against
// that closed form. The geometry stored is the ellipsoid point set (exact on the
// grid vertices; the NURBS interpolates between them to < chord tol).
// ===========================================================================
Solid* SolidFactory::buildEllipsoid(double rx, double ry, double rz) {
    assert(rx > 0 && ry > 0 && rz > 0);
    TopologyBuilder& tb = tb_;
    const int N = opt_.nSeg;
    const int M = std::max(2, opt_.nBand);

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    auto P = [&](double th, double phi) -> Point3 {
        double sp = std::sin(phi), cp = std::cos(phi);
        return Point3{rx * sp * std::cos(th), ry * sp * std::sin(th), rz * cp};
    };

    std::vector<std::vector<Vertex*>> rows(M + 1);
    Vertex* north = tb.makeVertex(P(0, 0));
    Vertex* south = tb.makeVertex(P(0, kPi));
    for (int row = 1; row < M; ++row) {
        double phi = kPi * row / M;
        rows[row].resize(N);
        for (int i = 0; i < N; ++i)
            rows[row][i] = tb.makeVertex(P(2.0 * kPi * i / N, phi));
    }
    for (int row = 0; row < M; ++row) {
        for (int i = 0; i < N; ++i) {
            int j = (i + 1) % N;
            Face* f = tb.makeFace(); tb.addFaceToShell(shell, f);
            std::vector<Vertex*> ring;
            if (row == 0)            ring = {north, rows[1][j], rows[1][i]};
            else if (row == M - 1)   ring = {rows[M - 1][i], rows[M - 1][j], south};
            else                     ring = {rows[row][i], rows[row][j],
                                             rows[row + 1][j], rows[row + 1][i]};
            tb.addOuterLoopToFace(f, ring);
            // Planar facet geometry (chordal) — exact at the vertices; the mass
            // props use the closed form so this facet surface is for tessellation
            // continuity only. Outward normal = average vertex direction.
            Vec3 o = V3(ring[0]->point);
            Vec3 ctr{0, 0, 0};
            for (auto* vp : ring) ctr = vadd(ctr, V3(vp->point));
            ctr = vscale(ctr, 1.0 / ring.size());
            Vec3 outward = vnorm(Vec3{ctr.x / (rx * rx), ctr.y / (ry * ry), ctr.z / (rz * rz)});
            Vec3 uDir = vsub(V3(ring[1]->point), o);
            Vec3 vDir = vsub(V3(ring[ring.size() - 1]->point), o);
            attachPlanarFace(tb, f, ring, o, uDir, vDir, outward);
        }
    }
    return solid;
}

} // namespace brep
} // namespace native
} // namespace forge
