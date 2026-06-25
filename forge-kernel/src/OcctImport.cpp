// forge/OcctImport.cpp — see include/forge/OcctImport.hpp for scope / honesty.
//
// Strategy (mirrors the proven Boolean.cpp "faceted topology over EXACT analytic
// geometry" model): every OCCT analytic face becomes the SAME analytic surface
// in the native model, triangulated in its own (u,v) domain by the in-house
// constrained-Delaunay triangulator. The wire loops (outer + holes) are the CDT
// constraint loops, so a bored cap imports as the correct annulus; curved faces
// get interior Steiner points so the boundary mesh is fine enough for a
// watertight tessellation + Betti analysis. Mass stays EXACT — a planar sub-face
// integrates its exact polygon, a curved sub-face integrates the parent quadric
// over its (u,v) parameter triangle (paramTri). All 3-D corners are welded
// GLOBALLY by position so the shells stitch into a closed 2-manifold.

#ifdef FORGE_NATIVE_BREP

#include "forge/OcctImport.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
#include <vector>

// --- OCCT (read side only) -------------------------------------------------
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>
#include <TopAbs_Orientation.hxx>
#include <BRep_Tool.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <Geom_Curve.hxx>
#include <Geom2d_Curve.hxx>
#include <gp_Pnt2d.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp_Face.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <gp_Pln.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Cone.hxx>
#include <gp_Sphere.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax3.hxx>

// --- native (emit side) ----------------------------------------------------
#include "forge/native/brep/Surface.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/ConstrainedDelaunay2D.hpp"

namespace forge {

namespace nb = native::brep;
namespace ng = native::geom;
using nb::Vec3;

namespace {

constexpr double kPi = 3.14159265358979323846;

inline Vec3 toV3(const gp_Pnt& p) { return Vec3{p.X(), p.Y(), p.Z()}; }
inline Vec3 toV3(const gp_Dir& d) { return Vec3{d.X(), d.Y(), d.Z()}; }

// A native analytic-surface descriptor for ONE OCCT face, with the frame matched
// to OCCT's elementary parameterization so the native (u,v) == OCCT's (u,v).
struct FaceSurf {
    nb::SurfaceKind kind = nb::SurfaceKind::Plane;
    Vec3 origin{}, axis{0, 0, 1}, refDir{1, 0, 0};
    double r1 = 0, r2 = 0, param = 0;
    bool reversed = false;     // flip native normal so it points OUT of the solid
    bool angular = false;      // u is an angle (cylinder/cone/sphere) -> unwrap
    bool sphere = false;       // v maps as native_v = pi/2 - occt_v
};

// native partials dS/du, dS/dv at (u,v) (mirror of brep::Surface::evaluateDeriv).
void evalDeriv(const FaceSurf& s, double u, double v, Vec3& du, Vec3& dv) {
    const Vec3 b = nb::vcross(s.axis, s.refDir);
    switch (s.kind) {
    case nb::SurfaceKind::Plane:
        du = s.refDir; dv = b; return;
    case nb::SurfaceKind::Cylinder: {
        double c = std::cos(u), si = std::sin(u);
        du = nb::vadd(nb::vscale(s.refDir, -s.r1 * si), nb::vscale(b, s.r1 * c));
        dv = s.axis; return;
    }
    case nb::SurfaceKind::Cone: {
        double c = std::cos(u), si = std::sin(u);
        double r = s.r1 + (s.r2 - s.r1) * v, dr = (s.r2 - s.r1);
        du = nb::vadd(nb::vscale(s.refDir, -r * si), nb::vscale(b, r * c));
        dv = nb::vadd(nb::vadd(nb::vscale(s.refDir, dr * c), nb::vscale(b, dr * si)),
                      nb::vscale(s.axis, s.param));
        return;
    }
    case nb::SurfaceKind::Sphere: {
        double ct = std::cos(u), st = std::sin(u), cp = std::cos(v), sp = std::sin(v);
        du = nb::vadd(nb::vscale(s.refDir, -s.r1 * sp * st), nb::vscale(b, s.r1 * sp * ct));
        dv = nb::vadd(nb::vscale(s.refDir, s.r1 * cp * ct),
             nb::vadd(nb::vscale(b, s.r1 * cp * st), nb::vscale(s.axis, -s.r1 * sp)));
        return;
    }
    default: du = s.refDir; dv = b; return;
    }
}

// evaluate native S(u,v) (mirror of brep::Surface::evaluate for these 4 kinds).
Vec3 evalUV(const FaceSurf& s, double u, double v) {
    const Vec3 b = nb::vcross(s.axis, s.refDir);
    switch (s.kind) {
    case nb::SurfaceKind::Plane:
        return nb::vadd(s.origin, nb::vadd(nb::vscale(s.refDir, u), nb::vscale(b, v)));
    case nb::SurfaceKind::Cylinder: {
        double c = std::cos(u), si = std::sin(u);
        return nb::vadd(s.origin, nb::vadd(nb::vadd(nb::vscale(s.refDir, s.r1 * c),
                                                    nb::vscale(b, s.r1 * si)),
                                           nb::vscale(s.axis, v)));
    }
    case nb::SurfaceKind::Cone: {
        double c = std::cos(u), si = std::sin(u);
        double r = s.r1 + (s.r2 - s.r1) * v;
        return nb::vadd(s.origin, nb::vadd(nb::vadd(nb::vscale(s.refDir, r * c),
                                                    nb::vscale(b, r * si)),
                                           nb::vscale(s.axis, s.param * v)));
    }
    case nb::SurfaceKind::Sphere: {
        double ct = std::cos(u), st = std::sin(u), cp = std::cos(v), sp = std::sin(v);
        return nb::vadd(s.origin, nb::vadd(nb::vscale(s.refDir, s.r1 * sp * ct),
                       nb::vadd(nb::vscale(b, s.r1 * sp * st),
                                nb::vscale(s.axis, s.r1 * cp))));
    }
    default:
        return s.origin;
    }
}

// Build the native FaceSurf from an OCCT analytic face. Returns false (with
// `why` set) for a non-analytic surface type.
bool readSurface(const TopoDS_Face& face, FaceSurf& out, std::string& why) {
    BRepAdaptor_Surface ad(face, Standard_True);
    GeomAbs_SurfaceType t = ad.GetType();
    switch (t) {
    case GeomAbs_Plane: {
        gp_Pln pl = ad.Plane();
        const gp_Ax3& ax = pl.Position();
        out.kind = nb::SurfaceKind::Plane;
        out.origin = toV3(ax.Location());
        out.axis   = toV3(ax.Direction());     // plane normal
        out.refDir = toV3(ax.XDirection());
        break;
    }
    case GeomAbs_Cylinder: {
        gp_Cylinder cy = ad.Cylinder();
        const gp_Ax3& ax = cy.Position();
        out.kind = nb::SurfaceKind::Cylinder;
        out.origin = toV3(ax.Location());
        out.axis   = toV3(ax.Direction());
        out.refDir = toV3(ax.XDirection());
        out.r1 = cy.Radius();
        out.angular = true;
        break;
    }
    case GeomAbs_Cone: {
        gp_Cone co = ad.Cone();
        const gp_Ax3& ax = co.Position();
        double semi = co.SemiAngle();           // signed half-angle
        double Rref = co.RefRadius();           // radius at the Location plane (v=0)
        // We re-anchor the cone to the face's actual v-window after UV bounds are
        // known (origin -> circle centre at vmin); here keep the OCCT reference.
        out.kind = nb::SurfaceKind::Cone;
        out.origin = toV3(ax.Location());
        out.axis   = toV3(ax.Direction());
        out.refDir = toV3(ax.XDirection());
        out.r1 = Rref;                          // placeholder; fixed up below
        out.r2 = semi;                          // stash semi-angle (re-used below)
        out.param = 0.0;
        out.angular = true;
        break;
    }
    case GeomAbs_Sphere: {
        gp_Sphere sp = ad.Sphere();
        const gp_Ax3& ax = sp.Position();
        out.kind = nb::SurfaceKind::Sphere;
        out.origin = toV3(ax.Location());
        out.axis   = toV3(ax.Direction());
        out.refDir = toV3(ax.XDirection());
        out.r1 = sp.Radius();
        out.angular = true;
        out.sphere  = true;
        break;
    }
    default: {
        const char* n = "other";
        switch (t) {
            case GeomAbs_BSplineSurface:  n = "BSpline";     break;
            case GeomAbs_BezierSurface:   n = "Bezier";      break;
            case GeomAbs_Torus:           n = "Torus";       break;
            case GeomAbs_SurfaceOfRevolution: n = "Revolution"; break;
            case GeomAbs_SurfaceOfExtrusion:  n = "Extrusion";  break;
            case GeomAbs_OffsetSurface:   n = "Offset";      break;
            default: break;
        }
        why = std::string("non-analytic face ") + n;
        return false;
    }
    }
    // Re-orthonormalize the frame defensively (OCCT dirs are already unit + ortho,
    // but guard against a non-unit XDirection feeding the parameterization).
    out.axis   = nb::vnorm(out.axis);
    out.refDir = nb::vnorm(nb::vsub(out.refDir, nb::vscale(out.axis,
                              nb::vdot(out.refDir, out.axis))));
    return true;
}

// Number of intermediate samples per boundary edge. Both faces sharing an OCCT
// edge sample its SAME 3-D curve at the SAME arc fractions, so their boundary
// vertices are bit-identical (after the global position weld) => every shared
// edge is used by exactly two faces => the assembled shell is a closed 2-manifold.
// 64 keeps a circular cap's chordal polygon area within ~0.06% of the true disk
// (the curved SIDE walls integrate EXACTLY via paramTri regardless of N) so the
// whole import lands well inside the 0.5% volume/area A/B gate.
constexpr int kEdgeSamples = 64;

// One boundary sample on a wire edge: the 3-D point (canonical, shared across the
// two faces using this edge) AND this face's (u,v) at the same point.
struct BSample {
    Vec3 p3;                       // 3-D point on the edge's curve
    std::array<double, 2> uv;      // this face's NATIVE (u,v) at that point
};

} // namespace

// TEST-ONLY PROBE counter (see OcctImport.hpp). Process-wide; bumped on entry to every
// importOcctSolid call. Relaxed atomic so a concurrent assembly scan can't trip TSan;
// production never reads it.
static std::atomic<unsigned long long> g_importCallCount{0};

unsigned long long importOcctSolidCallCount() {
    return g_importCallCount.load(std::memory_order_relaxed);
}

ImportResult importOcctSolid(const TopoDS_Shape& shape) {
    g_importCallCount.fetch_add(1, std::memory_order_relaxed);
    ImportResult res;
    if (shape.IsNull()) { res.reason = "null shape"; return res; }

    // Pick the faces to import: prefer a TopoDS_Solid; else use the shape's faces.
    TopExp_Explorer solidEx(shape, TopAbs_SOLID);
    TopoDS_Shape src = shape;
    if (solidEx.More()) src = solidEx.Current();

    std::vector<TopoDS_Face> faces;
    for (TopExp_Explorer fe(src, TopAbs_FACE); fe.More(); fe.Next())
        faces.push_back(TopoDS::Face(fe.Current()));
    if (faces.empty()) { res.reason = "no faces in shape"; return res; }

    // ---- global vertex weld: one native Vertex per unique 3-D position --------
    auto owner = std::make_shared<nb::TopologyBuilder>();
    nb::Solid* solid = owner->makeSolid();
    nb::Shell* shell = owner->makeShell();
    owner->addShellToSolid(solid, shell);

    // model-scale weld tolerance from the shape's overall extent.
    double diag = 1.0;
    {
        double lo[3] = {1e300, 1e300, 1e300}, hi[3] = {-1e300, -1e300, -1e300};
        for (const auto& f : faces)
            for (TopExp_Explorer ve(f, TopAbs_VERTEX); ve.More(); ve.Next()) {
                Vec3 p = toV3(BRep_Tool::Pnt(TopoDS::Vertex(ve.Current())));
                lo[0] = std::min(lo[0], p.x); hi[0] = std::max(hi[0], p.x);
                lo[1] = std::min(lo[1], p.y); hi[1] = std::max(hi[1], p.y);
                lo[2] = std::min(lo[2], p.z); hi[2] = std::max(hi[2], p.z);
            }
        diag = std::sqrt((hi[0]-lo[0])*(hi[0]-lo[0]) + (hi[1]-lo[1])*(hi[1]-lo[1]) +
                         (hi[2]-lo[2])*(hi[2]-lo[2]));
        if (!(diag > 0)) diag = 1.0;
    }
    const double weld = 1e-7 * std::max(1.0, diag);
    std::map<std::array<long long, 3>, int> vmap;     // welded position -> vid
    std::vector<Vec3> vpos;                           // vid -> position
    std::vector<nb::Vertex*> verts;                   // vid -> native Vertex (built later)
    auto key = [&](const Vec3& p) {
        return std::array<long long, 3>{
            (long long)std::llround(p.x / weld),
            (long long)std::llround(p.y / weld),
            (long long)std::llround(p.z / weld)};
    };
    auto weldId = [&](const Vec3& p) -> int {
        auto k = key(p);
        auto it = vmap.find(k);
        if (it != vmap.end()) return it->second;
        int id = (int)vpos.size();
        vmap.emplace(k, id);
        vpos.push_back(p);
        return id;
    };

    // One triangle sub-face (planar polygon or paramTri curved) staged before the
    // manifold pre-check + build (CDT path).
    struct StagedFace {
        std::array<int, 3> vid;          // welded vertex ids
        nb::SurfaceKind kind = nb::SurfaceKind::Plane;
        Vec3 origin{}, axis{0,0,1}, refDir{1,0,0};
        double r1 = 0, r2 = 0, param = 0;
        bool reversed = false, paramTri = false;
        std::array<std::array<double, 2>, 3> uv{};
    };
    std::vector<StagedFace> staged;

    // An n-gon curved sector band (periodic-wall path) integrated EXACTLY over its
    // full [u0,u1]x[v0,v1] rectangle (paramTri=false), like the native primitives.
    struct StagedPoly {
        std::vector<int> vids;
        nb::SurfaceKind kind = nb::SurfaceKind::Plane;
        Vec3 origin{}, axis{0,0,1}, refDir{1,0,0};
        double r1 = 0, r2 = 0, param = 0;
        bool reversed = false, paramTri = false;
        std::vector<std::array<double, 2>> uv;
        double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
    };
    std::vector<StagedPoly> stagedPoly;

    // Per-face import: triangulate the (u,v) domain (wires + Steiner grid for
    // curvature) and STAGE one native triangle sub-face per inside CDT triangle.
    for (const TopoDS_Face& face : faces) {
        FaceSurf fs;
        std::string why;
        if (!readSurface(face, fs, why)) { res.reason = why; return res; }

        // OCCT UV bounds (in OCCT's elementary parameterization, which we matched).
        double umin, umax, vmin, vmax;
        BRepTools::UVBounds(face, umin, umax, vmin, vmax);

        // For a CONE, re-anchor the native surface so native t in [0,1] spans the
        // face's OCCT v-window [vmin,vmax]. OCCT cone: radius(v)=Rref+v*sin(semi),
        // axial offset = v*cos(semi). Native cone: r(t)=r1+(r2-r1)t over axis*param*t.
        double coneSemi = 0.0, coneCos = 1.0;
        if (fs.kind == nb::SurfaceKind::Cone) {
            coneSemi = fs.r2;                   // stashed semi-angle
            double Rref = fs.r1;
            coneCos = std::cos(coneSemi);
            double rA = Rref + vmin * std::sin(coneSemi);
            double rB = Rref + vmax * std::sin(coneSemi);
            fs.origin = nb::vadd(fs.origin, nb::vscale(fs.axis, vmin * coneCos));
            fs.r1 = rA; fs.r2 = rB;
            fs.param = (vmax - vmin) * coneCos;
        }

        const bool curved = (fs.kind != nb::SurfaceKind::Plane);

        // ============ FULL-REVOLUTION (periodic) CURVED FACE — WRAP GRID =========
        // A cylinder/cone/sphere side spanning a full 2*pi in u has a SEAM: a CDT of
        // the flat [0,2pi] rectangle would duplicate it (two boundary columns weld to
        // the same 3-D line => a non-manifold/duplicated directed edge). Instead build
        // a STRUCTURED grid whose u index WRAPS (column nu == column 0, SHARED
        // vertices) — exactly how the native primitives segment a curved side. The
        // rim rows (v = vmin / vmax) sample at the SAME nu angles the bounding cap
        // circles use (kEdgeSamples), so wall-rim and cap-rim vertices weld => the
        // wall stitches watertight to its caps. Mass stays EXACT (paramTri quads).
        if (curved && std::fabs((umax - umin) - 2.0 * kPi) < 1e-6) {
            // `faceReversed`: native du x dv vs OCCT's OUTWARD normal, compared at the
            // SAME physical point (a curved face's outward direction varies with u, so
            // both MUST be sampled at the same (u,v) — here OCCT u=umin / native u=0).
            double ov = 0.5 * (vmin + vmax);
            Vec3 faceOutward{0, 0, 1};
            {
                BRepGProp_Face gf(face);
                gp_Pnt op; gp_Vec on;
                gf.Normal(umin, ov, op, on);     // outward at native u=0
                faceOutward = nb::vnorm(Vec3{on.X(), on.Y(), on.Z()});
            }
            double nv_mid = (fs.kind == nb::SurfaceKind::Sphere) ? (0.5 * kPi - ov)
                          : (fs.kind == nb::SurfaceKind::Cone)   ? 0.5 : ov;
            Vec3 ndu, ndv; evalDeriv(fs, 0.0, nv_mid, ndu, ndv);
            Vec3 nNat = nb::vnorm(nb::vcross(ndu, ndv));
            bool faceReversed = (nb::vlen(faceOutward) > 0.5 && nb::vlen(nNat) > 0.5)
                                ? (nb::vdot(nNat, faceOutward) < 0.0) : false;

            const int nu = kEdgeSamples;                 // matches cap-circle sampling
            // native v-rows. cylinder: [vmin,vmax]; cone: t in [0,1]; sphere: phi in
            // [phi(vmax)..phi(vmin)] = colatitude rows. We sample nv rows + handle the
            // sphere poles (radius 0) by emitting triangles instead of quads.
            double nv0, nv1;
            if (fs.kind == nb::SurfaceKind::Sphere) { nv0 = 0.5 * kPi - vmax; nv1 = 0.5 * kPi - vmin; }
            else if (fs.kind == nb::SurfaceKind::Cone) { nv0 = 0.0; nv1 = 1.0; }
            else { nv0 = vmin; nv1 = vmax; }
            int nv = (fs.kind == nb::SurfaceKind::Sphere) ? 16
                   : (fs.kind == nb::SurfaceKind::Cone)   ? 8 : 4;

            auto vidAt = [&](int iu, int iv) -> int {
                double u = (2.0 * kPi * (iu % nu)) / nu;   // wraps: nu -> 0
                double v = nv0 + (nv1 - nv0) * iv / nv;
                return weldId(evalUV(fs, u, v));
            };
            auto uPar = [&](int iu) { return (2.0 * kPi * iu) / nu; };     // un-wrapped u
            auto vPar = [&](int iv) { return nv0 + (nv1 - nv0) * iv / nv; };

            // Emit each cell as a native FACE over its FULL [u_iu,u_{iu+1}]x[v0,v1]
            // RECTANGLE band (paramTri=false), integrated EXACTLY by the rectangle
            // parametric quadrature — identical to how the native primitives build a
            // curved side. A sphere/cone pole row collapses to a triangle (the rect
            // domain still integrates the analytic taper exactly). The ring is wound
            // by parameter orientation, flipped uniformly by `faceReversed` so the
            // shell is consistently outward (=> mates with the caps).
            auto emitCell = [&](std::vector<int> ring,
                                std::vector<std::array<double,2>> uv) {
                // drop welded-duplicate consecutive corners (pole collapse).
                std::vector<int> r; std::vector<std::array<double,2>> u2;
                for (std::size_t i = 0; i < ring.size(); ++i) {
                    int prev = r.empty() ? ring.back() : r.back();
                    if (ring[i] != prev) { r.push_back(ring[i]); u2.push_back(uv[i]); }
                }
                if (r.size() < 3) return;
                // parameter-orientation signed area of the (u,v) polygon.
                double cr = 0;
                for (std::size_t i = 0; i < u2.size(); ++i) {
                    auto& p = u2[i]; auto& q = u2[(i + 1) % u2.size()];
                    cr += p[0] * q[1] - q[0] * p[1];
                }
                bool ccw = cr > 0.0;
                if (ccw == faceReversed) {
                    std::reverse(r.begin() + 1, r.end());
                    std::reverse(u2.begin() + 1, u2.end());
                }
                StagedPoly sp;
                sp.vids = r;
                sp.kind = fs.kind; sp.origin = fs.origin; sp.axis = fs.axis;
                sp.refDir = fs.refDir; sp.r1 = fs.r1; sp.r2 = fs.r2; sp.param = fs.param;
                sp.reversed = faceReversed; sp.paramTri = false;
                sp.uv = u2;
                sp.u0 = uPar(0); sp.u1 = uPar(0); sp.v0 = nv0; sp.v1 = nv1;
                // exact rectangle trim window for this cell:
                stagedPoly.push_back(std::move(sp));
            };
            for (int iu = 0; iu < nu; ++iu)
                for (int iv = 0; iv < nv; ++iv) {
                    std::vector<int> ring = {vidAt(iu, iv), vidAt(iu + 1, iv),
                                             vidAt(iu + 1, iv + 1), vidAt(iu, iv + 1)};
                    std::vector<std::array<double,2>> uv = {
                        {uPar(iu), vPar(iv)}, {uPar(iu + 1), vPar(iv)},
                        {uPar(iu + 1), vPar(iv + 1)}, {uPar(iu), vPar(iv + 1)}};
                    emitCell(ring, uv);
                    // set the rectangle trim window on the just-pushed cell.
                    if (!stagedPoly.empty()) {
                        auto& sp = stagedPoly.back();
                        sp.u0 = uPar(iu); sp.u1 = uPar(iu + 1);
                        sp.v0 = vPar(iv); sp.v1 = vPar(iv + 1);
                    }
                }
            continue;   // periodic curved face fully staged; next face.
        }

        // unwrap reference for the angular (u) coordinate: the UV-bounds u-centre.
        const double uref = 0.5 * (umin + umax);
        auto unwrapU = [&](double u) {
            while (u - uref > kPi) u -= 2.0 * kPi;
            while (uref - u > kPi) u += 2.0 * kPi;
            return u;
        };
        // OCCT (u,v) -> native (u_n,v_n). u is the same angle (unwrapped) for the
        // angular kinds; native v differs: sphere uses colatitude phi = pi/2 - v_occt,
        // cone uses t = (v_occt - vmin)/(vmax-vmin).
        auto occtToNative = [&](double uo, double vo, double& un, double& vn) {
            switch (fs.kind) {
            case nb::SurfaceKind::Plane:
                un = uo; vn = vo; return;
            case nb::SurfaceKind::Cylinder:
                un = unwrapU(uo); vn = vo; return;
            case nb::SurfaceKind::Cone: {
                un = unwrapU(uo);
                double span = (vmax - vmin);
                vn = (span != 0.0) ? (vo - vmin) / span : 0.0;
                return;
            }
            case nb::SurfaceKind::Sphere:
                un = unwrapU(uo); vn = 0.5 * kPi - vo; return; // colatitude
            default: un = uo; vn = vo; return;
            }
        };

        // ---- boundary loops: each wire edge sampled on BOTH its 3-D curve (the
        // CANONICAL point, identical for both faces using the edge) and this face's
        // p-curve (the (u,v) at the same point). The 3-D points weld across faces,
        // so every shared edge ends up used by exactly two faces => closed manifold.
        TopoDS_Wire outer = BRepTools::OuterWire(face);
        std::vector<std::vector<BSample>> rings;
        auto addRing = [&](const TopoDS_Wire& w) {
            std::vector<BSample> ring;
            for (BRepTools_WireExplorer ex(w, face); ex.More(); ex.Next()) {
                TopoDS_Edge e = ex.Current();
                Standard_Real p2a, p2b, p3a, p3b;
                Handle(Geom2d_Curve) pc = BRep_Tool::CurveOnSurface(e, face, p2a, p2b);
                Handle(Geom_Curve)   c3 = BRep_Tool::Curve(e, p3a, p3b);
                if (pc.IsNull() || c3.IsNull()) continue;
                const bool rev = (ex.Current().Orientation() == TopAbs_REVERSED);
                // sample [0,1) along the edge in its wire-traversal sense; the next
                // edge contributes the shared end vertex.
                for (int i = 0; i < kEdgeSamples; ++i) {
                    double s = (double)i / kEdgeSamples;
                    double f2 = rev ? (p2b + (p2a - p2b) * s) : (p2a + (p2b - p2a) * s);
                    double f3 = rev ? (p3b + (p3a - p3b) * s) : (p3a + (p3b - p3a) * s);
                    gp_Pnt2d q2 = pc->Value(f2);
                    gp_Pnt   q3 = c3->Value(f3);
                    double un, vn; occtToNative(q2.X(), q2.Y(), un, vn);
                    ring.push_back({toV3(q3), {un, vn}});
                }
            }
            if (ring.size() >= 3) rings.push_back(std::move(ring));
        };
        addRing(outer);
        for (TopExp_Explorer we(face, TopAbs_WIRE); we.More(); we.Next()) {
            TopoDS_Wire w = TopoDS::Wire(we.Current());
            if (w.IsSame(outer)) continue;
            addRing(w);
        }
        if (rings.empty()) { res.reason = "no usable face wire"; return res; }

        // native (u,v) window extent (for grid sizing + dedup tolerance).
        double pu0 = 1e300, pu1 = -1e300, pv0 = 1e300, pv1 = -1e300;
        for (const auto& r : rings)
            for (const auto& bs : r) {
                pu0 = std::min(pu0, bs.uv[0]); pu1 = std::max(pu1, bs.uv[0]);
                pv0 = std::min(pv0, bs.uv[1]); pv1 = std::max(pv1, bs.uv[1]);
            }
        double du = pu1 - pu0, dv = pv1 - pv0;
        if (!(du > 0) || !(dv > 0)) { res.reason = "degenerate face param window"; return res; }

        // ---- build the CDT PSLG in native (u,v). Each `pts` entry also carries
        // its CANONICAL 3-D point (from the edge curve) for BOUNDARY points, or a
        // sentinel for interior Steiner points (whose 3-D comes from evalUV). -----
        std::vector<ng::Point2> pts;
        std::vector<Vec3>       pts3D;     // canonical 3-D for boundary, else sentinel
        std::vector<char>       isBoundary;
        std::vector<ng::ConstraintEdge> cons;
        const double tu = 1e-7 * std::max(1.0, du), tv = 1e-7 * std::max(1.0, dv);
        const Vec3 kSentinel{1e308, 1e308, 1e308};
        auto addBoundaryP = [&](double u, double v, const Vec3& p3) -> int {
            for (std::size_t i = 0; i < pts.size(); ++i)
                if (std::fabs(pts[i].x - u) < tu && std::fabs(pts[i].y - v) < tv)
                    return (int)i;
            pts.push_back({u, v}); pts3D.push_back(p3); isBoundary.push_back(1);
            return (int)pts.size() - 1;
        };
        auto addInteriorP = [&](double u, double v) -> int {
            for (std::size_t i = 0; i < pts.size(); ++i)
                if (std::fabs(pts[i].x - u) < tu && std::fabs(pts[i].y - v) < tv)
                    return (int)i;
            pts.push_back({u, v}); pts3D.push_back(kSentinel); isBoundary.push_back(0);
            return (int)pts.size() - 1;
        };
        for (const auto& r : rings) {
            std::vector<int> idx;
            idx.reserve(r.size());
            for (const BSample& bs : r) idx.push_back(addBoundaryP(bs.uv[0], bs.uv[1], bs.p3));
            for (std::size_t i = 0; i < idx.size(); ++i) {
                int a = idx[i], b = idx[(i + 1) % idx.size()];
                if (a != b) cons.push_back({a, b});
            }
        }

        // CURVED faces (non-periodic — e.g. a cut wall): interior Steiner grid so the
        // boundary triangulation is fine enough for a watertight tessellation + Betti
        // (mass is exact via paramTri regardless of grid). Planar faces need none.
        if (curved) {
            int nu = std::max(2, (int)std::ceil(du / (2.0 * kPi) * 48.0));
            int nv = std::max(2, (int)std::ceil(dv / std::max(dv, 1e-9) * 6.0));
            if (fs.kind == nb::SurfaceKind::Sphere) nv = std::max(8, nv);
            nu = std::min(nu, 96); nv = std::min(nv, 24);
            for (int iu = 1; iu < nu; ++iu)
                for (int iv = 1; iv < nv; ++iv)
                    addInteriorP(pu0 + du * iu / nu, pv0 + dv * iv / nv);
        }

        ng::CDTResult cdt = ng::constrainedDelaunay2D(pts, cons);
        if (!cdt.ok) { res.reason = std::string("face CDT failed: ") + cdt.reason; return res; }

        // ---- per-face OUTWARD orientation, via OCCT's oriented normal ----------
        // OCCT's BRepGProp_Face::Normal folds in the face's TopAbs orientation, so
        // it points OUT of the solid. We wind each triangle ring CCW about that
        // outward normal (=> mated, opposite-sense shared coedges => closed
        // manifold) and set `reversed` so native normalAt also points OUTWARD.
        // Compare native du x dv vs OCCT's outward normal AT THE SAME physical point
        // (curved faces vary; planar are constant). Sample at OCCT UV-midpoint, and
        // the native (u,v) of that same OCCT point.
        bool faceReversed = false;
        {
            double ou = 0.5 * (umin + umax), ov = 0.5 * (vmin + vmax);
            BRepGProp_Face gf(face);
            gp_Pnt occtP; gp_Vec occtN;
            gf.Normal(ou, ov, occtP, occtN);
            Vec3 faceOutward = nb::vnorm(Vec3{occtN.X(), occtN.Y(), occtN.Z()});
            double un, vn; occtToNative(ou, ov, un, vn);
            Vec3 ndu, ndv; evalDeriv(fs, un, vn, ndu, ndv);
            Vec3 nNat = nb::vnorm(nb::vcross(ndu, ndv));
            if (nb::vlen(faceOutward) > 0.5 && nb::vlen(nNat) > 0.5)
                faceReversed = (nb::vdot(nNat, faceOutward) < 0.0);
        }

        // 3-D point of a CDT mesh point: boundary -> the canonical edge point (so
        // it welds across faces); interior -> evalUV on the exact surface.
        auto meshPoint3D = [&](int mi) -> Vec3 {
            int orig = (mi < (int)cdt.inputIndex.size()) ? cdt.inputIndex[mi] : -1;
            if (orig >= 0 && orig < (int)isBoundary.size() && isBoundary[orig])
                return pts3D[orig];
            const ng::Point2& P = cdt.points[mi];
            return evalUV(fs, P.x, P.y);
        };

        // even-odd `inside` over the closed constraint loops == the annulus for a
        // bored cap. Stage one native sub-face per inside triangle (built below).
        for (std::size_t t = 0; t < cdt.triangles.size(); ++t) {
            if (t < cdt.inside.size() && !cdt.inside[t]) continue;
            const auto& tri = cdt.triangles[t];
            ng::Point2 A = cdt.points[tri[0]];
            ng::Point2 B = cdt.points[tri[1]];
            ng::Point2 C = cdt.points[tri[2]];
            Vec3 pA = meshPoint3D(tri[0]);
            Vec3 pB = meshPoint3D(tri[1]);
            Vec3 pC = meshPoint3D(tri[2]);

            // Wind by PARAMETER orientation (native du x dv), flipped uniformly by
            // `faceReversed` so the winding is OUTWARD — the SAME convention the
            // periodic wall path uses, so wall-rim and cap-rim coedges mate exactly.
            double cr = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
            bool ccw = cr > 0.0;
            if (ccw == faceReversed) { std::swap(pB, pC); std::swap(B, C); }

            int ia = weldId(pA), ib = weldId(pB), ic = weldId(pC);
            if (ia == ib || ib == ic || ia == ic) continue; // degenerate after weld

            StagedFace sfc;
            sfc.vid = {ia, ib, ic};
            sfc.kind = fs.kind; sfc.origin = fs.origin; sfc.axis = fs.axis;
            sfc.refDir = fs.refDir; sfc.r1 = fs.r1; sfc.r2 = fs.r2; sfc.param = fs.param;
            sfc.reversed = faceReversed;
            sfc.uv = {{{{A.x, A.y}}, {{B.x, B.y}}, {{C.x, C.y}}}};
            sfc.paramTri = curved;
            staged.push_back(std::move(sfc));
        }
    }

    if (staged.empty() && stagedPoly.empty()) { res.reason = "no faces produced triangles"; return res; }

    // ---- COMBINATORIAL 2-MANIFOLD PRE-CHECK (mirrors Boolean.cpp's stitch) -----
    // Build only AFTER proving every directed edge (a->b) is matched by exactly
    // one opposite (b->a) and no undirected edge appears more than twice, so we
    // never hit TopologyBuilder's non-manifold assert. On failure -> honest defer.
    {
        std::map<std::pair<int, int>, int> directed, undirected;
        for (const StagedFace& sf : staged)
            for (int i = 0; i < 3; ++i) {
                int a = sf.vid[i], b = sf.vid[(i + 1) % 3];
                directed[{a, b}]++;
                undirected[{std::min(a, b), std::max(a, b)}]++;
            }
        for (const StagedPoly& sp : stagedPoly) {
            std::size_t n = sp.vids.size();
            for (std::size_t i = 0; i < n; ++i) {
                int a = sp.vids[i], b = sp.vids[(i + 1) % n];
                directed[{a, b}]++;
                undirected[{std::min(a, b), std::max(a, b)}]++;
            }
        }
        for (const auto& kv : undirected)
            if (kv.second != 2) {
                res.reason = "import not 2-manifold (edge shared by != 2 faces)"; return res; }
        for (const auto& kv : directed) {
            if (kv.second != 1) {
                res.reason = "import not 2-manifold (duplicated directed edge)"; return res; }
            auto opp = directed.find({kv.first.second, kv.first.first});
            if (opp == directed.end() || opp->second != 1) {
                res.reason = "import not 2-manifold (edge not oppositely mated)"; return res;
            }
        }
    }

    // ---- BUILD the native topology (proven manifold above) ---------------------
    verts.assign(vpos.size(), nullptr);
    for (std::size_t i = 0; i < vpos.size(); ++i)
        verts[i] = owner->makeVertex({vpos[i].x, vpos[i].y, vpos[i].z});

    for (const StagedFace& sf : staged) {
        nb::Face* f = owner->makeFace();
        owner->addFaceToShell(shell, f);
        std::vector<nb::Vertex*> ring = {verts[sf.vid[0]], verts[sf.vid[1]], verts[sf.vid[2]]};
        owner->addOuterLoopToFace(f, ring);

        nb::Surface* surf = owner->makeSurface();
        surf->kind = sf.kind; surf->origin = sf.origin; surf->axis = sf.axis;
        surf->refDir = sf.refDir; surf->r1 = sf.r1; surf->r2 = sf.r2;
        surf->param = sf.param; surf->reversed = sf.reversed;
        f->surface = surf;
        f->vertexUV = {sf.uv[0], sf.uv[1], sf.uv[2]};
        f->u0 = std::min({sf.uv[0][0], sf.uv[1][0], sf.uv[2][0]});
        f->u1 = std::max({sf.uv[0][0], sf.uv[1][0], sf.uv[2][0]});
        f->v0 = std::min({sf.uv[0][1], sf.uv[1][1], sf.uv[2][1]});
        f->v1 = std::max({sf.uv[0][1], sf.uv[1][1], sf.uv[2][1]});
        f->paramTri = sf.paramTri;
    }

    for (const StagedPoly& sp : stagedPoly) {
        nb::Face* f = owner->makeFace();
        owner->addFaceToShell(shell, f);
        std::vector<nb::Vertex*> ring;
        ring.reserve(sp.vids.size());
        for (int id : sp.vids) ring.push_back(verts[id]);
        owner->addOuterLoopToFace(f, ring);

        nb::Surface* surf = owner->makeSurface();
        surf->kind = sp.kind; surf->origin = sp.origin; surf->axis = sp.axis;
        surf->refDir = sp.refDir; surf->r1 = sp.r1; surf->r2 = sp.r2;
        surf->param = sp.param; surf->reversed = sp.reversed;
        f->surface = surf;
        f->vertexUV = sp.uv;
        f->u0 = sp.u0; f->u1 = sp.u1; f->v0 = sp.v0; f->v1 = sp.v1;
        f->paramTri = sp.paramTri;     // false -> exact rectangle parametric integral
    }

    if (!owner->isClosedTwoManifold()) {
        res.reason = "not a closed 2-manifold after import";
        return res;
    }
    nb::EulerCounts c = owner->counts();
    if (c.faces == 0 || c.edges == 0 || c.vertices == 0) {
        res.reason = "empty topology after import";
        return res;
    }

    res.ok = true;
    res.solid = solid;
    res.owner = owner;
    return res;
}

}  // namespace forge

#endif  // FORGE_NATIVE_BREP
