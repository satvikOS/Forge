// forge/native/brep/NativeThickSolid.cpp
//
// Implementation of forge::occtoffset::makeThickSolid — the TKOffset-free,
// OCCT-TopoDS mirror of forge::native::brep::shellSolid (src/native/brep/Shell.cpp).
// See NativeThickSolid.hpp for the full specification and the honest scope boundary.
//
// This file references NO BRepOffset*/BRepOffsetAPI* symbol: it rebuilds the
// hollow solid from scratch on the SURVIVING toolkits (TKMath/TKG3d/TKBRep/
// TKTopAlgo/TKShHealing), exactly the way NativeSectionFill.cpp rebuilds a skin
// surface without GeomFill_NSections. A null TopoDS_Shape is an HONEST DEFER.
//
// ===========================================================================
// TWO PATHS
// ===========================================================================
//   planarThickSolid()   every face is a Geom_Plane. The offset-plane meet /
//                        mouth-pin / lip-quad construction (Shell.cpp mirror).
//                        UNCHANGED from the original increment.
//
//   quadricThickSolid()  QUADRIC extension (2026-07-31). Faces may be
//                        Geom_{Plane,CylindricalSurface,ConicalSurface,
//                        SphericalSurface,ToroidalSurface}. EVERY inner face
//                        keeps its EXACT analytic surface type — the offset of
//                        a cylinder is a cylinder, of a cone a cone, of a
//                        sphere a sphere, of a torus a torus. NOTHING is
//                        faceted, tessellated, or approximated by a B-spline.
//
// ===========================================================================
// WHY THE QUADRIC RE-TRIM IS CLOSED-FORM (the load-bearing derivation)
// ===========================================================================
// Offsetting a face inward by t moves its surface but ALSO moves every edge it
// shares with a neighbour: the new edge is the intersection of the two OFFSET
// surfaces. Doing that with a general surface-surface intersector would be a
// numeric marching scheme whose output is a spline — i.e. an approximation.
// It is not needed, because of this fact:
//
//   Let E be a CIRCLE edge with axis A. Every quadric that can contain a circle
//   contains it as a circle of revolution about A:
//       * a plane containing E is perpendicular to A,
//       * a cylinder/cone containing E is coaxial with A (a circle on a
//         cylinder/cone is a cross-section; any other planar section is an
//         ellipse),
//       * a sphere containing E has its centre ON A,
//       * a torus containing E as a "parallel" is coaxial with A.
//   So BOTH adjacent surfaces are surfaces of revolution about A. The normal of
//   a surface of revolution lies in the meridian half-plane, therefore its
//   offset is ALSO a surface of revolution about the SAME A, and offsetting the
//   surface by t is exactly offsetting its MERIDIAN curve by t in the (rho, z)
//   half-plane.
//
//   The meridian of each supported quadric is a LINE or a CIRCLE:
//       plane   _|_ A at height h      ->  line   z = h
//       cylinder radius R, axis A      ->  line   rho = R
//       cone     semi-angle a, axis A  ->  line   rho - s*tan(a)*z = const
//       sphere   centre on A at z0     ->  circle rho^2 + (z-z0)^2 = R^2
//       torus    axis A, centre z0     ->  circle (rho-Rmaj)^2 + (z-z0)^2 = r^2
//
//   line/line, line/circle and circle/circle intersection in the plane are all
//   CLOSED FORM. So the offset edge is obtained exactly, as a real circle
//   (centre on A, radius rho*, axis A) — never sampled, never fitted.
//
// The offset SURFACES themselves are equally closed-form (d = signed offset
// along the surface's own parametric normal):
//       plane     : location += d * normal
//       cylinder  : R  ->  R + d                       (same gp_Ax3)
//       sphere    : R  ->  R + d                       (same gp_Ax3)
//       torus     : r  ->  r + d                       (same gp_Ax3, same Rmaj)
//       cone      : Rref -> Rref + d/cos(a)            (same gp_Ax3, same a)
//   The cone case is derived in offsetSurfaceOf() below.
//
// ===========================================================================
// HONEST DEFER (returns a null TopoDS_Shape) — the quadric path declines when:
//   * any face is not one of the five supported analytic surfaces;
//   * a non-planar face is not a full revolution in u, or carries more than one
//     wire (a hole punched through a curved wall needs a real 2-D trim, not a
//     parametric rectangle);
//   * a non-planar face has a boundary edge that is not a circle coaxial with
//     the face;
//   * a planar face has a wire that is not exactly one full circle (the
//     ALL-planar polygonal case is handled by the other path; MIXED
//     polygon+quadric solids are declined);
//   * the OFFSET circles of a planar face stop nesting — a hole reaching past
//     the outer rim, or two holes overlapping, because the offset exceeded the
//     local feature size. Merging the openings is a real operation this engine
//     does not implement, and the area self-check is blind to it (see
//     circlesNest);
//   * two removed faces are adjacent (a zero-width lip);
//   * the offset collapses a radius, inverts a v-range, or the sew does not
//     close;
//   * the assembled solid fails its own volume identity self-check.
// A defer is never a wrong answer — the caller keeps OCCT's
// BRepOffsetAPI_MakeThickSolid as the fallback.
// ===========================================================================

#include "forge/native/brep/NativeThickSolid.hpp"

#ifdef FORGE_NATIVE_BREP

#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepGProp.hxx>
#include <BRepLib.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Circle.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_Surface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Precision.hxx>
#include "forge/native/brep/NativeShapeHeal.hpp"  // occtheal::solidFromShell
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopTools_MapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Lin.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <vector>

namespace forge {
namespace occtoffset {

namespace {

constexpr double kPi   = 3.14159265358979323846;
constexpr double kPara = 1.0e-9;   // direction-parallelism slack (1 - |dot|)
constexpr double kGeo  = 1.0e-7;   // absolute geometric slack (mm)

// ===========================================================================
//                     PART 0 — shared small helpers
// ===========================================================================

// Unwrap a Geom_RectangularTrimmedSurface down to its analytic basis.
Handle(Geom_Surface) basisSurface(const Handle(Geom_Surface)& s) {
    Handle(Geom_Surface) cur = s;
    for (int guard = 0; guard < 8 && !cur.IsNull(); ++guard) {
        Handle(Geom_RectangularTrimmedSurface) rt =
            Handle(Geom_RectangularTrimmedSurface)::DownCast(cur);
        if (rt.IsNull()) break;
        cur = rt->BasisSurface();
    }
    return cur;
}

enum class SK { Plane, Cyl, Cone, Sph, Tor, Other };

SK surfKind(const Handle(Geom_Surface)& s) {
    if (s.IsNull()) return SK::Other;
    if (!Handle(Geom_Plane)::DownCast(s).IsNull())               return SK::Plane;
    if (!Handle(Geom_CylindricalSurface)::DownCast(s).IsNull())  return SK::Cyl;
    if (!Handle(Geom_ConicalSurface)::DownCast(s).IsNull())      return SK::Cone;
    if (!Handle(Geom_SphericalSurface)::DownCast(s).IsNull())    return SK::Sph;
    if (!Handle(Geom_ToroidalSurface)::DownCast(s).IsNull())     return SK::Tor;
    return SK::Other;
}

// The gp_Ax3 of any elementary surface we support (plane/cyl/cone/sphere/torus).
bool axesOf(const Handle(Geom_Surface)& s, SK k, gp_Ax3& ax) {
    switch (k) {
        case SK::Plane: ax = Handle(Geom_Plane)::DownCast(s)->Position();              return true;
        case SK::Cyl:   ax = Handle(Geom_CylindricalSurface)::DownCast(s)->Position(); return true;
        case SK::Cone:  ax = Handle(Geom_ConicalSurface)::DownCast(s)->Position();     return true;
        case SK::Sph:   ax = Handle(Geom_SphericalSurface)::DownCast(s)->Position();   return true;
        case SK::Tor:   ax = Handle(Geom_ToroidalSurface)::DownCast(s)->Position();    return true;
        default: return false;
    }
}

bool dirParallel(const gp_Dir& a, const gp_Dir& b) {
    return std::fabs(std::fabs(a.Dot(b)) - 1.0) < kPara;
}

// Distance from P to the infinite line (O, A).
double distToAxis(const gp_Pnt& O, const gp_Dir& A, const gp_Pnt& P) {
    gp_Vec w(O, P);
    return w.Crossed(gp_Vec(A)).Magnitude();
}

// Radial unit direction of P about the axis (O, A). false if P is ON the axis.
bool radialDir(const gp_Pnt& O, const gp_Dir& A, const gp_Pnt& P, gp_Dir& out) {
    gp_Vec w(O, P);
    gp_Vec av(A);
    gp_Vec r = w - av * w.Dot(av);
    if (r.Magnitude() < 1.0e-12) return false;
    out = gp_Dir(r);
    return true;
}

// The 3-D curve of an edge, unwrapped to its analytic basis (location applied).
Handle(Geom_Curve) edgeBasisCurve(const TopoDS_Edge& e, double& f, double& l) {
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    for (int guard = 0; guard < 8 && !c.IsNull(); ++guard) {
        Handle(Geom_TrimmedCurve) tc = Handle(Geom_TrimmedCurve)::DownCast(c);
        if (tc.IsNull()) break;
        c = tc->BasisCurve();
    }
    return c;
}

// Is `e` a FULL circle (a closed 2*pi arc)? Returns its gp_Circ.
bool edgeFullCircle(const TopoDS_Edge& e, gp_Circ& out) {
    if (BRep_Tool::Degenerated(e)) return false;
    double f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = edgeBasisCurve(e, f, l);
    if (c.IsNull()) return false;
    Handle(Geom_Circle) gc = Handle(Geom_Circle)::DownCast(c);
    if (gc.IsNull()) return false;
    if (std::fabs(std::fabs(l - f) - 2.0 * kPi) > 1.0e-6) return false;
    out = gc->Circ();
    return true;
}

// ===========================================================================
//   PART 1 — EXACT analytic offset of one quadric surface
// ===========================================================================
//
// `disp` is the 3-D displacement the surface must undergo at the sample point
// `P` (= -t * outward-normal-of-the-face, i.e. INTO the material). Each branch
// projects `disp` onto the direction in which that surface family actually
// moves under offsetting, verifies the projection really has magnitude t (this
// is what rejects a `disp` that is not normal to the surface — a silent-wrong-
// answer guard), and returns the offset surface of the SAME analytic type.
//
// CONE DERIVATION. OCCT parametrises a cone as
//     P(u,v) = L + (R + v*sin a)*(cos u * X + sin u * Y) + v*cos a * Z
// so with rho = distance from the axis and z = height along Z,
//     rho(v) = R + v*sin a,   z(v) = v*cos a.
// dP/du x dP/dv is proportional to cos a * rhat - sin a * zhat (a UNIT vector),
// so offsetting by a signed distance d along the normal maps
//     rho -> rho + d*cos a ,  z -> z - d*sin a .
// Requiring the image to be the same cone family with a new reference radius R'
// and a new parameter v': z' = v'*cos a gives v' = v - d*tan a, and then
//     R' = rho' - v'*sin a = R + d*cos a + d*sin^2 a / cos a = R + d/cos a .
// Same gp_Ax3, same semi-angle: an EXACT cone, not an approximation.
Handle(Geom_Surface) offsetSurfaceOf(const Handle(Geom_Surface)& s, SK k,
                                     const gp_Pnt& P, const gp_Vec& disp, double t) {
    const Handle(Geom_Surface) kNull;
    const double magTol = 1.0e-7 * std::max(1.0, t);

    switch (k) {
        case SK::Plane: {
            Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s);
            gp_Ax3 ax = pl->Position();
            const gp_Dir n = ax.Direction();
            const double d = disp.Dot(gp_Vec(n));
            if (std::fabs(std::fabs(d) - t) > magTol) return kNull;  // disp not normal
            ax.SetLocation(ax.Location().Translated(gp_Vec(n) * d));
            return new Geom_Plane(ax);
        }
        case SK::Cyl: {
            Handle(Geom_CylindricalSurface) cy = Handle(Geom_CylindricalSurface)::DownCast(s);
            const gp_Ax3 ax = cy->Position();
            gp_Dir rhat;
            if (!radialDir(ax.Location(), ax.Direction(), P, rhat)) return kNull;
            const double dR = disp.Dot(gp_Vec(rhat));
            if (std::fabs(std::fabs(dR) - t) > magTol) return kNull;
            const double R2 = cy->Radius() + dR;
            if (R2 < 1.0e-9) return kNull;                          // collapsed
            return new Geom_CylindricalSurface(ax, R2);
        }
        case SK::Cone: {
            Handle(Geom_ConicalSurface) co = Handle(Geom_ConicalSurface)::DownCast(s);
            const gp_Ax3 ax = co->Position();
            const double a = co->SemiAngle();
            const double ca = std::cos(a), sa = std::sin(a);
            if (std::fabs(ca) < 1.0e-9) return kNull;
            gp_Dir rhat;
            if (!radialDir(ax.Location(), ax.Direction(), P, rhat)) return kNull;
            const gp_Vec nhat = gp_Vec(rhat) * ca - gp_Vec(ax.Direction()) * sa;  // unit
            const double dn = disp.Dot(nhat);
            if (std::fabs(std::fabs(dn) - t) > magTol) return kNull;
            const double R2 = co->RefRadius() + dn / ca;
            if (R2 < 0.0) return kNull;   // Geom_ConicalSurface forbids a negative radius
            return new Geom_ConicalSurface(ax, a, R2);
        }
        case SK::Sph: {
            Handle(Geom_SphericalSurface) sp = Handle(Geom_SphericalSurface)::DownCast(s);
            const gp_Ax3 ax = sp->Position();
            gp_Vec w(ax.Location(), P);
            if (w.Magnitude() < 1.0e-12) return kNull;
            const double dR = disp.Dot(w.Normalized());
            if (std::fabs(std::fabs(dR) - t) > magTol) return kNull;
            const double R2 = sp->Radius() + dR;
            if (R2 < 1.0e-9) return kNull;
            return new Geom_SphericalSurface(ax, R2);
        }
        case SK::Tor: {
            Handle(Geom_ToroidalSurface) to = Handle(Geom_ToroidalSurface)::DownCast(s);
            const gp_Ax3 ax = to->Position();
            const double Rmaj = to->MajorRadius(), rmin = to->MinorRadius();
            gp_Dir rhat;
            if (!radialDir(ax.Location(), ax.Direction(), P, rhat)) return kNull;
            const gp_Pnt Cq = ax.Location().Translated(gp_Vec(rhat) * Rmaj);  // tube centre
            gp_Vec w(Cq, P);
            if (w.Magnitude() < 1.0e-12) return kNull;
            const double dr = disp.Dot(w.Normalized());
            if (std::fabs(std::fabs(dr) - t) > magTol) return kNull;
            const double r2 = rmin + dr;
            if (r2 < 1.0e-9 || r2 >= Rmaj - 1.0e-9) return kNull;  // collapsed / self-intersecting
            return new Geom_ToroidalSurface(ax, Rmaj, r2);
        }
        default: return kNull;
    }
}

// ===========================================================================
//   PART 2 — the MERIDIAN half-plane (the closed-form re-trim engine)
// ===========================================================================

// A meridian curve in the (rho, z) half-plane of an axis frame {O, A}.
// LINE:   a*rho + b*z = c        with (a,b) a UNIT vector
// CIRCLE: (rho-cr)^2 + (z-cz)^2 = r^2
struct Mer {
    bool   isLine = true;
    double a = 0.0, b = 0.0, c = 0.0;
    double cr = 0.0, cz = 0.0, r = 0.0;
};

// Reduce a supported surface to its meridian about {O, A}. Returns false when
// the surface is NOT a surface of revolution about that exact axis — which is
// the guard that makes the closed form legitimate rather than assumed.
bool meridianOf(const Handle(Geom_Surface)& s, SK k,
                const gp_Pnt& O, const gp_Dir& A, Mer& m) {
    gp_Ax3 ax;
    if (!axesOf(s, k, ax)) return false;

    switch (k) {
        case SK::Plane: {
            const gp_Dir n = ax.Direction();
            if (!dirParallel(n, A)) return false;           // not perpendicular to A
            m.isLine = true; m.a = 0.0; m.b = 1.0;
            m.c = gp_Vec(O, ax.Location()).Dot(gp_Vec(A));
            return true;
        }
        case SK::Cyl: {
            if (!dirParallel(ax.Direction(), A)) return false;
            if (distToAxis(O, A, ax.Location()) > kGeo) return false;   // not coaxial
            m.isLine = true; m.a = 1.0; m.b = 0.0;
            m.c = Handle(Geom_CylindricalSurface)::DownCast(s)->Radius();
            return true;
        }
        case SK::Cone: {
            if (!dirParallel(ax.Direction(), A)) return false;
            if (distToAxis(O, A, ax.Location()) > kGeo) return false;
            Handle(Geom_ConicalSurface) co = Handle(Geom_ConicalSurface)::DownCast(s);
            const double alpha = co->SemiAngle();
            const double ca = std::cos(alpha);
            if (std::fabs(ca) < 1.0e-9) return false;
            const double sgn = (ax.Direction().Dot(A) >= 0.0) ? 1.0 : -1.0;
            const double z0  = gp_Vec(O, ax.Location()).Dot(gp_Vec(A));
            const double tn  = sgn * std::tan(alpha);
            // rho = Rref + tn*(z - z0)  =>  rho - tn*z = Rref - tn*z0
            double a = 1.0, b = -tn, c = co->RefRadius() - tn * z0;
            const double h = std::hypot(a, b);
            m.isLine = true; m.a = a / h; m.b = b / h; m.c = c / h;
            return true;
        }
        case SK::Sph: {
            if (distToAxis(O, A, ax.Location()) > kGeo) return false;   // centre off-axis
            m.isLine = false;
            m.cr = 0.0;
            m.cz = gp_Vec(O, ax.Location()).Dot(gp_Vec(A));
            m.r  = Handle(Geom_SphericalSurface)::DownCast(s)->Radius();
            return true;
        }
        case SK::Tor: {
            if (!dirParallel(ax.Direction(), A)) return false;
            if (distToAxis(O, A, ax.Location()) > kGeo) return false;
            Handle(Geom_ToroidalSurface) to = Handle(Geom_ToroidalSurface)::DownCast(s);
            m.isLine = false;
            m.cr = to->MajorRadius();
            m.cz = gp_Vec(O, ax.Location()).Dot(gp_Vec(A));
            m.r  = to->MinorRadius();
            return true;
        }
        default: return false;
    }
}

// Does (rho, z) lie on the meridian (within kGeo)?
bool meridianContains(const Mer& m, double rho, double z) {
    if (m.isLine) return std::fabs(m.a * rho + m.b * z - m.c) < kGeo;
    return std::fabs(std::hypot(rho - m.cr, z - m.cz) - m.r) < kGeo;
}

// Closed-form meet of two meridians; picks the root nearest (rho0, z0).
bool meetMeridians(const Mer& m1, const Mer& m2, double rho0, double z0,
                   double& rho, double& z) {
    double cand[2][2];
    int n = 0;

    if (m1.isLine && m2.isLine) {
        const double det = m1.a * m2.b - m2.a * m1.b;
        if (std::fabs(det) < 1.0e-12) return false;          // parallel meridians
        cand[0][0] = (m1.c * m2.b - m2.c * m1.b) / det;
        cand[0][1] = (m1.a * m2.c - m2.a * m1.c) / det;
        n = 1;
    } else if (m1.isLine != m2.isLine) {
        const Mer& L = m1.isLine ? m1 : m2;
        const Mer& C = m1.isLine ? m2 : m1;
        // (a,b) is unit, so the signed distance from the centre to the line is
        // simply c - a*cr - b*cz, and the foot is centre + that * (a,b).
        const double sd = L.c - L.a * C.cr - L.b * C.cz;
        const double h2 = C.r * C.r - sd * sd;
        if (h2 < -1.0e-12) return false;                      // no intersection
        const double h  = std::sqrt(std::max(0.0, h2));
        const double fr = C.cr + sd * L.a, fz = C.cz + sd * L.b;   // foot point
        const double dr = -L.b, dz = L.a;                          // along the line
        cand[0][0] = fr + h * dr; cand[0][1] = fz + h * dz;
        cand[1][0] = fr - h * dr; cand[1][1] = fz - h * dz;
        n = 2;
    } else {
        // Two circles: radical-line construction.
        const double dx = m2.cr - m1.cr, dy = m2.cz - m1.cz;
        const double d  = std::hypot(dx, dy);
        if (d < 1.0e-12) return false;                        // concentric
        const double aa = (d * d + m1.r * m1.r - m2.r * m2.r) / (2.0 * d);
        const double h2 = m1.r * m1.r - aa * aa;
        if (h2 < -1.0e-12) return false;
        const double h  = std::sqrt(std::max(0.0, h2));
        const double mr = m1.cr + aa * dx / d, mz = m1.cz + aa * dy / d;
        cand[0][0] = mr + h * (-dy) / d; cand[0][1] = mz + h * (dx) / d;
        cand[1][0] = mr - h * (-dy) / d; cand[1][1] = mz - h * (dx) / d;
        n = 2;
    }

    int best = -1;
    double bestD = 0.0;
    for (int i = 0; i < n; ++i) {
        if (cand[i][0] < -kGeo) continue;                     // rho must be >= 0
        const double dd = std::hypot(cand[i][0] - rho0, cand[i][1] - z0);
        if (best < 0 || dd < bestD) { best = i; bestD = dd; }
    }
    if (best < 0) return false;
    rho = std::max(0.0, cand[best][0]);
    z   = cand[best][1];
    return true;
}

// ===========================================================================
//   PART 3 — per-face bookkeeping for the quadric path
// ===========================================================================

struct QF {
    TopoDS_Face          face;
    SK                   kind = SK::Other;
    Handle(Geom_Surface) surf;      // original analytic surface
    Handle(Geom_Surface) off;       // EXACT offset surface (null for removed faces)
    bool                 removed = false;
    double               u1 = 0, u2 = 0, v1 = 0, v2 = 0;   // original UV bounds
    double               nv1 = 0, nv2 = 0;                 // re-trimmed v bounds
    bool                 gotV1 = false, gotV2 = false;
};

// The surface a face contributes to a meridian meet: a RETAINED face offers its
// OFFSET surface, a REMOVED face offers its ORIGINAL surface. That single rule
// produces both the cavity re-trim and the mouth "pin" that lands the lip in the
// removed face's own plane.
const Handle(Geom_Surface)& contributing(const QF& q) { return q.removed ? q.surf : q.off; }

// Outward unit normal + a sample point of a face, from the PARAMETRIC normal
// (dP/du x dP/dv) flipped by TopAbs_REVERSED. Robust for every quadric: it never
// assumes gp_Ax3::Direct().
bool faceSample(const TopoDS_Face& f, const Handle(Geom_Surface)& s,
                double u1, double u2, double v1, double v2,
                gp_Pnt& P, gp_Dir& outward) {
    static const double fr[3] = {0.5, 0.25, 0.75};
    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) {
            const double u = u1 + fr[i] * (u2 - u1);
            const double v = v1 + fr[j] * (v2 - v1);
            gp_Pnt p; gp_Vec du, dv;
            s->D1(u, v, p, du, dv);
            const gp_Vec n = du.Crossed(dv);
            if (n.Magnitude() < 1.0e-10) continue;            // degenerate (pole/apex)
            gp_Dir N(n);
            if (f.Orientation() == TopAbs_REVERSED) N.Reverse();
            P = p; outward = N;
            return true;
        }
    }
    return false;
}

// Map an offset latitude circle back to a v parameter on the offset surface.
bool vParamOf(const Handle(Geom_Surface)& s, SK k, const gp_Circ& c, double& v) {
    gp_Ax3 ax;
    if (!axesOf(s, k, ax)) return false;
    const gp_Dir A   = ax.Direction();
    const double z   = gp_Vec(ax.Location(), c.Location()).Dot(gp_Vec(A));
    const double rho = c.Radius();

    switch (k) {
        case SK::Cyl:
            v = z;                                            // P = L + R*rad(u) + v*Z
            return true;
        case SK::Cone: {
            Handle(Geom_ConicalSurface) co = Handle(Geom_ConicalSurface)::DownCast(s);
            const double sa = std::sin(co->SemiAngle());
            if (std::fabs(sa) < 1.0e-9) return false;
            v = (rho - co->RefRadius()) / sa;                  // rho = Rref + v*sin a
            // cross-check against the axial equation z = v*cos a
            if (std::fabs(v * std::cos(co->SemiAngle()) - z) > 1.0e-6) return false;
            return true;
        }
        case SK::Sph:
            v = std::atan2(z, rho);                            // rho = R cos v, z = R sin v
            return true;
        case SK::Tor: {
            Handle(Geom_ToroidalSurface) to = Handle(Geom_ToroidalSurface)::DownCast(s);
            v = std::atan2(z, rho - to->MajorRadius());        // rho = Rmaj + r cos v
            return true;
        }
        default: return false;
    }
}

// The CLOSED-FORM offset of a circle edge shared by two faces.
//   sa / sb : the surfaces each face CONTRIBUTES (see contributing()).
//   oa / ob : those faces' ORIGINAL surfaces — used only to VERIFY that the
//             original circle really lies on both, which validates the axis and
//             rejects any configuration the derivation does not cover.
bool offsetCircle(const gp_Circ& orig,
                  const Handle(Geom_Surface)& oa, SK ka,
                  const Handle(Geom_Surface)& ob, SK kb,
                  const Handle(Geom_Surface)& sa, SK ksa,
                  const Handle(Geom_Surface)& sb, SK ksb,
                  gp_Circ& out) {
    const gp_Pnt O = orig.Location();
    const gp_Dir A = orig.Axis().Direction();

    // 1. VALIDATE: both ORIGINAL surfaces must be surfaces of revolution about A
    //    and must actually contain the original circle (rho = R, z = 0).
    Mer moa, mob;
    if (!meridianOf(oa, ka, O, A, moa)) return false;
    if (!meridianOf(ob, kb, O, A, mob)) return false;
    if (!meridianContains(moa, orig.Radius(), 0.0)) return false;
    if (!meridianContains(mob, orig.Radius(), 0.0)) return false;

    // 2. Meet the two CONTRIBUTED meridians — exact, closed form.
    Mer ma, mb;
    if (!meridianOf(sa, ksa, O, A, ma)) return false;
    if (!meridianOf(sb, ksb, O, A, mb)) return false;
    double rho = 0.0, z = 0.0;
    if (!meetMeridians(ma, mb, orig.Radius(), 0.0, rho, z)) return false;
    if (rho < 1.0e-9) return false;                            // collapsed to the axis

    // 3. Rebuild the circle: same axis, new centre on it, new radius.
    const gp_Pnt ctr = O.Translated(gp_Vec(A) * z);
    out = gp_Circ(gp_Ax2(ctr, A, orig.Position().XDirection()), rho);
    return true;
}

TopoDS_Wire circleWire(const gp_Circ& c) {
    BRepBuilderAPI_MakeEdge me(c);
    if (!me.IsDone()) return TopoDS_Wire();
    BRepBuilderAPI_MakeWire mw(me.Edge());
    if (!mw.IsDone()) return TopoDS_Wire();
    return mw.Wire();
}

// Build a planar face on `pl` bounded by `outer` with `holes` punched out, and
// SELF-CHECK its area against the closed form pi*(Ro^2 - sum Rh^2). A wrong hole
// winding shows up as a wrong area, so this both fixes and verifies orientation.
// Do the bounding circles of a disk-with-holes actually NEST — every hole
// strictly inside the outer boundary, and no two holes overlapping?
//
// ★ THIS IS A GEOMETRIC PREDICATE AND THE AREA IDENTITY BELOW CANNOT STAND IN
//   FOR IT. planarCircularFace already self-checks the built face against the
//   closed form pi*(R^2 - sum r_i^2), and that check is BLIND to containment: it
//   is an algebraic identity in the radii alone, so it holds just as exactly
//   when a hole has moved OUTSIDE the outer circle. MEASURED on
//   expert3d_v5cap_e600/ho1041 (the corpus A/B's THICKSOLID derivation, wall
//   2.3808): the cavity face at z=135.119 came back with outer R=24.0192 and
//   eight holes of r=4.6848 centred 23.808 from the axis — reaching to 28.493,
//   i.e. 4.47 mm PAST the rim — and its measured area was 589.43237 against a
//   `want` of 589.4325. The identity passed to 2e-7 relative on a face whose
//   wires cross. So did the assembled solid's volume identity. Only
//   BRepCheck_Analyzer saw it, as IntersectingWires.
//
//   That is this programme's recorded lesson ("volume cannot validate
//   geometry") reproduced inside this engine, and it is why the guard is a
//   distance test rather than another measure.
//
// WHY IT HAPPENS. Offsetting is only injective while the offset stays below the
// local feature size. On ho1041 the original wall between each hole (r=2.304 at
// radius 23.808) and the outer cylinder (R=26.4) is 0.288 mm; a 2.3808 mm wall
// shrinks the rim by t and grows every hole by t, closing 2t = 4.76 mm across a
// 0.288 mm gap. Merging the two openings is a real geometric operation this
// engine does not implement, so the honest answer is the DEFER its own header
// promises ("never a plausible wrong shape") — not a self-intersecting face.
//
// Tangency is rejected along with crossing: a hole touching the rim or another
// hole makes a non-manifold vertex, which is not a face this engine may emit.
bool circlesNest(const gp_Circ& outer, const std::vector<gp_Circ>& holes) {
    for (std::size_t i = 0; i < holes.size(); ++i) {
        const double d = outer.Location().Distance(holes[i].Location());
        if (!(d + holes[i].Radius() < outer.Radius() - kGeo)) return false;
        for (std::size_t j = i + 1; j < holes.size(); ++j) {
            const double dij = holes[i].Location().Distance(holes[j].Location());
            if (!(dij > holes[i].Radius() + holes[j].Radius() + kGeo)) return false;
        }
    }
    return true;
}

TopoDS_Face planarCircularFace(const Handle(Geom_Plane)& pl,
                               const gp_Circ& outer,
                               const std::vector<gp_Circ>& holes) {
    double want = outer.Radius() * outer.Radius();
    for (const gp_Circ& h : holes) want -= h.Radius() * h.Radius();
    if (want <= 1.0e-12) return TopoDS_Face();
    want *= kPi;

    const gp_Dir N = pl->Position().Direction();
    // Every bounding circle MUST lie in this plane and be coaxial with it —
    // otherwise the "annulus" is not planar and the closed-form area is a lie.
    {
        const gp_Pln pln = pl->Pln();
        auto inPlane = [&](const gp_Circ& c) {
            return dirParallel(c.Axis().Direction(), N) &&
                   pln.Distance(c.Location()) < kGeo;
        };
        if (!inPlane(outer)) return TopoDS_Face();
        for (const gp_Circ& h : holes) if (!inPlane(h)) return TopoDS_Face();
    }

    // ...and they must NEST. See circlesNest above for why the area check that
    // follows cannot detect this and for the measured case that proves it.
    if (!circlesNest(outer, holes)) return TopoDS_Face();

    for (int flip = 0; flip < 2; ++flip) {
        // Outer wire wound about +N; holes wound the opposite way.
        gp_Circ o(gp_Ax2(outer.Location(), N, outer.Position().XDirection()), outer.Radius());
        TopoDS_Wire ow = circleWire(o);
        if (ow.IsNull()) return TopoDS_Face();
        BRepBuilderAPI_MakeFace mk(pl, ow, Standard_True);
        if (!mk.IsDone()) return TopoDS_Face();
        bool ok = true;
        for (const gp_Circ& h : holes) {
            gp_Dir hn = N;
            if (flip == 0) hn.Reverse();
            gp_Circ hc(gp_Ax2(h.Location(), hn, h.Position().XDirection()), h.Radius());
            TopoDS_Wire hw = circleWire(hc);
            if (hw.IsNull()) { ok = false; break; }
            mk.Add(hw);
        }
        if (!ok || !mk.IsDone()) continue;
        TopoDS_Face f = mk.Face();
        // Pin the convention: FORWARD means "outward normal == +N". The wires
        // define the region, the orientation only picks the side.
        f.Orientation(TopAbs_FORWARD);
        GProp_GProps gp;
        BRepGProp::SurfaceProperties(f, gp);
        if (std::fabs(gp.Mass() - want) < 1.0e-6 * std::max(1.0, want)) return f;
    }
    return TopoDS_Face();
}

// The wall lip at an open mouth: the REMOVED face itself, with the pinned inner
// circle punched out of it — an exact annulus in the removed face's own plane.
TopoDS_Face lipFace(const TopoDS_Face& removedFace,
                    const Handle(Geom_Plane)& pl,
                    const gp_Circ& outer,
                    const std::vector<gp_Circ>& inner) {
    TopoDS_Face f = planarCircularFace(pl, outer, inner);
    if (f.IsNull()) return f;
    f.Orientation(removedFace.Orientation());
    return f;
}

// ===========================================================================
//   PART 4 — the QUADRIC thick-solid
// ===========================================================================

TopoDS_Shape quadricThickSolid(const TopoDS_Shape& shape, double t,
                               const TopTools_MapOfShape& removedSet, double tol) {
    const TopoDS_Shape kNull;

    // ---- 1. classify every face; build the offset surface of every retained one
    std::vector<QF> qf;
    TopTools_IndexedMapOfShape faceIdx;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        if (faceIdx.Contains(f)) continue;
        faceIdx.Add(f);

        QF q;
        q.face    = f;
        q.surf    = basisSurface(BRep_Tool::Surface(f));
        q.kind    = surfKind(q.surf);
        q.removed = removedSet.Contains(f);
        if (q.kind == SK::Other) return kNull;                 // unsupported surface
        BRepTools::UVBounds(f, q.u1, q.u2, q.v1, q.v2);
        q.nv1 = q.v1; q.nv2 = q.v2;

        if (!q.removed) {
            gp_Pnt P; gp_Dir outward;
            if (!faceSample(f, q.surf, q.u1, q.u2, q.v1, q.v2, P, outward)) return kNull;
            const gp_Vec disp = gp_Vec(outward) * (-t);        // INTO the material
            q.off = offsetSurfaceOf(q.surf, q.kind, P, disp, t);
            if (q.off.IsNull()) return kNull;
        }
        qf.push_back(q);
    }
    if (qf.empty()) return kNull;

    auto qOf = [&](const TopoDS_Shape& f) -> QF* {
        const int i = faceIdx.FindIndex(f);
        if (i == 0) return nullptr;
        return &qf[static_cast<std::size_t>(i) - 1];
    };

    // ---- 2. structural admissibility of every face -------------------------
    // Non-planar: exactly one wire, full 2*pi in u (a parametric-rectangle trim).
    // Planar: every wire is exactly ONE full circle.
    for (const QF& q : qf) {
        int nWires = 0;
        for (TopoDS_Iterator it(q.face); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++nWires;

        if (q.kind != SK::Plane) {
            if (nWires != 1) return kNull;                     // hole in a curved wall
            if (std::fabs((q.u2 - q.u1) - 2.0 * kPi) > 1.0e-7) return kNull;  // partial revolution
        } else {
            if (nWires < 1) return kNull;
            for (TopoDS_Iterator it(q.face); it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                int nE = 0;
                gp_Circ c;
                for (TopExp_Explorer ee(it.Value(), TopAbs_EDGE); ee.More(); ee.Next()) {
                    ++nE;
                    if (!edgeFullCircle(TopoDS::Edge(ee.Current()), c)) return kNull;
                }
                if (nE != 1) return kNull;                      // polygonal planar wire
            }
        }
    }

    // ---- 3. the CLOSED-FORM re-trim, one circle edge at a time -------------
    TopTools_IndexedDataMapOfShapeListOfShape efMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, efMap);

    // offset circle per (edge, face) — the lip and the planar rebuild both read it
    TopTools_IndexedMapOfShape edgeIdx;
    std::vector<gp_Circ> offCirc;
    std::vector<bool>    offOk;
    for (int i = 1; i <= efMap.Extent(); ++i) edgeIdx.Add(efMap.FindKey(i));
    offCirc.resize(static_cast<std::size_t>(edgeIdx.Extent()));
    offOk.assign(static_cast<std::size_t>(edgeIdx.Extent()), false);

    for (int i = 1; i <= efMap.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(i));
        if (BRep_Tool::Degenerated(e)) continue;

        // The distinct faces on this edge. One face twice == a SEAM: skip it,
        // the offset surface carries its own seam.
        std::vector<QF*> nb;
        for (TopTools_ListIteratorOfListOfShape it(efMap.FindFromIndex(i)); it.More(); it.Next()) {
            QF* q = qOf(it.Value());
            if (!q) return kNull;
            if (std::find(nb.begin(), nb.end(), q) == nb.end()) nb.push_back(q);
        }
        if (nb.size() == 1) continue;                          // seam
        if (nb.size() != 2) return kNull;                      // non-manifold
        QF& A = *nb[0];
        QF& B = *nb[1];
        if (A.removed && B.removed) return kNull;              // zero-width lip

        gp_Circ orig;
        if (!edgeFullCircle(e, orig)) return kNull;            // only circle edges

        gp_Circ oc;
        if (!offsetCircle(orig, A.surf, A.kind, B.surf, B.kind,
                          contributing(A), A.removed ? A.kind : surfKind(A.off),
                          contributing(B), B.removed ? B.kind : surfKind(B.off), oc))
            return kNull;
        offCirc[static_cast<std::size_t>(i) - 1] = oc;
        offOk[static_cast<std::size_t>(i) - 1]   = true;

        // Push the new v-bound onto each RETAINED curved neighbour.
        for (QF* q : nb) {
            if (q->removed || q->kind == SK::Plane) continue;
            double vOrig = 0.0, vNew = 0.0;
            if (!vParamOf(q->surf, q->kind, orig, vOrig)) return kNull;
            if (!vParamOf(q->off,  q->kind, oc,   vNew))  return kNull;
            const bool atLo = std::fabs(vOrig - q->v1) <= std::fabs(vOrig - q->v2);
            if (atLo) { q->nv1 = vNew; q->gotV1 = true; }
            else      { q->nv2 = vNew; q->gotV2 = true; }
        }
    }

    // ---- 4. build the INNER faces (exact analytic surfaces) ----------------
    std::vector<TopoDS_Face> innerFaces;
    for (const QF& q : qf) {
        if (q.removed) continue;

        TopoDS_Face inner;
        if (q.kind == SK::Plane) {
            // Rebuild the disk / annulus on the OFFSET plane from the offset circles.
            Handle(Geom_Plane) opl = Handle(Geom_Plane)::DownCast(q.off);
            if (opl.IsNull()) return kNull;
            TopoDS_Wire outerW = BRepTools::OuterWire(q.face);
            if (outerW.IsNull()) return kNull;
            gp_Circ outerC;
            std::vector<gp_Circ> holes;
            bool haveOuter = false;
            for (TopoDS_Iterator it(q.face); it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                TopoDS_Wire w = TopoDS::Wire(it.Value());
                TopExp_Explorer ee(w, TopAbs_EDGE);
                if (!ee.More()) return kNull;
                const int ei = edgeIdx.FindIndex(ee.Current());
                if (ei == 0 || !offOk[static_cast<std::size_t>(ei) - 1]) return kNull;
                const gp_Circ& c = offCirc[static_cast<std::size_t>(ei) - 1];
                if (w.IsSame(outerW)) { outerC = c; haveOuter = true; }
                else                  { holes.push_back(c); }
            }
            if (!haveOuter) return kNull;
            inner = planarCircularFace(opl, outerC, holes);
        } else {
            double a = q.nv1, b = q.nv2;
            if (a > b) std::swap(a, b);
            if (!(b - a > 1.0e-9)) return kNull;               // v-range inverted / collapsed
            BRepBuilderAPI_MakeFace mk(q.off, q.u1, q.u2, a, b, Precision::Confusion());
            if (!mk.IsDone()) return kNull;
            inner = mk.Face();
        }
        if (inner.IsNull()) return kNull;

        // The cavity face's normal must point INTO the cavity, i.e. opposite the
        // original face's outward normal. Same gp_Ax3 => same parametric normal
        // field, so flipping the topological orientation is exactly right.
        inner.Orientation(q.face.Orientation() == TopAbs_REVERSED ? TopAbs_FORWARD
                                                                  : TopAbs_REVERSED);
        innerFaces.push_back(inner);
    }
    if (innerFaces.empty()) return kNull;

    // ---- 5a. CLOSED HOLLOW (no mouth): outer shell + reversed inner shell ---
    if (removedSet.IsEmpty()) {
        BRep_Builder bb;
        TopoDS_Shell innerShell;
        if (innerFaces.size() == 1) {
            bb.MakeShell(innerShell);
            bb.Add(innerShell, innerFaces[0]);
        } else {
            BRepBuilderAPI_Sewing sew(std::max(tol, 1.0e-6));
            for (const TopoDS_Face& f : innerFaces) sew.Add(f);
            sew.Perform();
            if (sew.NbFreeEdges() != 0) return kNull;
            TopoDS_Shape sewed = sew.SewedShape();
            int n = 0;
            for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
                innerShell = TopoDS::Shell(ex.Current());
                ++n;
            }
            if (n != 1 || innerShell.IsNull()) return kNull;
        }

        TopoDS_Solid solid;
        bb.MakeSolid(solid);
        int nOuter = 0;
        for (TopExp_Explorer ex(shape, TopAbs_SHELL); ex.More(); ex.Next()) {
            bb.Add(solid, ex.Current());
            ++nOuter;
        }
        if (nOuter != 1) return kNull;
        bb.Add(solid, innerShell);
        BRepLib::SameParameter(solid, std::max(tol, 1.0e-6), Standard_True);

        // SELF-CHECK: the wall must integrate to outer_volume - cavity_volume.
        GProp_GProps po, pi, pw;
        BRepGProp::VolumeProperties(shape, po);
        TopoDS_Solid cav;
        bb.MakeSolid(cav);
        bb.Add(cav, innerShell);
        BRepGProp::VolumeProperties(cav, pi);
        BRepGProp::VolumeProperties(solid, pw);
        const double want = std::fabs(po.Mass()) - std::fabs(pi.Mass());
        if (!(want > 1.0e-9)) return kNull;
        if (std::fabs(pw.Mass() - want) > 1.0e-6 * std::max(1.0, want)) return kNull;
        return solid;
    }

    // ---- 5b. OPEN MOUTH: outer skin + cavity + lip, sewn into one shell ----
    BRepBuilderAPI_Sewing sew(std::max(tol, 1.0e-6));
    for (const QF& q : qf) if (!q.removed) sew.Add(q.face);
    for (const TopoDS_Face& f : innerFaces) sew.Add(f);

    for (const QF& q : qf) {
        if (!q.removed) continue;
        if (q.kind != SK::Plane) return kNull;                 // curved mouth unsupported
        Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(q.surf);
        if (pl.IsNull()) return kNull;
        for (TopoDS_Iterator it(q.face); it.More(); it.Next()) {
            if (it.Value().ShapeType() != TopAbs_WIRE) continue;
            TopoDS_Wire w = TopoDS::Wire(it.Value());
            TopExp_Explorer ee(w, TopAbs_EDGE);
            if (!ee.More()) return kNull;
            const TopoDS_Edge e = TopoDS::Edge(ee.Current());
            const int ei = edgeIdx.FindIndex(e);
            if (ei == 0 || !offOk[static_cast<std::size_t>(ei) - 1]) return kNull;
            gp_Circ rim;
            if (!edgeFullCircle(e, rim)) return kNull;
            const gp_Circ& pin = offCirc[static_cast<std::size_t>(ei) - 1];
            // The band always runs between the rim and its pinned image; which of
            // the two is the outer boundary depends on whether this wire bounds
            // material from inside (an outer rim) or outside (a hole rim).
            const bool rimIsOuter = rim.Radius() > pin.Radius();
            const gp_Circ& big = rimIsOuter ? rim : pin;
            const gp_Circ& sml = rimIsOuter ? pin : rim;
            TopoDS_Face lip = lipFace(q.face, pl, big, {sml});
            if (lip.IsNull()) return kNull;
            sew.Add(lip);
        }
    }

    sew.Perform();
    if (sew.NbFreeEdges() != 0) return kNull;
    TopoDS_Shape sewed = sew.SewedShape();
    if (sewed.IsNull()) return kNull;

    TopoDS_Shell shell;
    int nShells = 0;
    for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
        shell = TopoDS::Shell(ex.Current());
        ++nShells;
    }
    if (nShells != 1 || shell.IsNull()) return kNull;

    TopoDS_Solid solid = forge::occtheal::solidFromShell(shell);
    if (solid.IsNull()) return kNull;
    BRepLib::SameParameter(solid, std::max(tol, 1.0e-6), Standard_True);

    // SELF-CHECK: a wall is a strict subset of the original body.
    GProp_GProps pw, po;
    BRepGProp::VolumeProperties(solid, pw);
    BRepGProp::VolumeProperties(shape, po);
    const double vw = pw.Mass(), vo = std::fabs(po.Mass());
    if (!(vw > 1.0e-9) || vw > vo * (1.0 + 1.0e-9)) return kNull;
    return solid;
}

// ===========================================================================
//   PART 5 — the ORIGINAL planar/prismatic path (unchanged)
// ===========================================================================

// A plane in Hesse form { n . x = d }, n a unit outward normal.
struct Plane {
    double nx, ny, nz, d;
};

// Outward unit normal + Hesse offset of a PLANAR face, honouring the face's
// TopAbs orientation (a REVERSED face's outward normal is the flipped plane
// normal). Returns false iff the face is not a Geom_Plane (=> caller defers).
bool outwardPlaneOf(const TopoDS_Face& f, Plane& out) {
    Handle(Geom_Surface) s = basisSurface(BRep_Tool::Surface(f));
    Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s);
    if (pl.IsNull()) return false;
    const gp_Pln& gpl = pl->Pln();
    gp_Dir n = gpl.Axis().Direction();
    double nx = n.X(), ny = n.Y(), nz = n.Z();
    if (f.Orientation() == TopAbs_REVERSED) { nx = -nx; ny = -ny; nz = -nz; }
    const gp_Pnt& o = gpl.Location();
    out.nx = nx; out.ny = ny; out.nz = nz;
    out.d = nx * o.X() + ny * o.Y() + nz * o.Z();
    return true;
}

// Least-squares meet of k planes { n_i . x = d_i } by the 3x3 normal equations
// (Shell.cpp intersectPlanes, verbatim). Exact for >=3 independent planes (a
// convex corner). Returns false iff the system is rank-deficient.
bool intersectPlanes(const std::vector<Plane>& planes, gp_Pnt& out) {
    double A[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};
    double b[3] = {0, 0, 0};
    for (const Plane& p : planes) {
        A[0][0] += p.nx * p.nx; A[0][1] += p.nx * p.ny; A[0][2] += p.nx * p.nz;
        A[1][0] += p.ny * p.nx; A[1][1] += p.ny * p.ny; A[1][2] += p.ny * p.nz;
        A[2][0] += p.nz * p.nx; A[2][1] += p.nz * p.ny; A[2][2] += p.nz * p.nz;
        b[0] += p.d * p.nx; b[1] += p.d * p.ny; b[2] += p.d * p.nz;
    }
    double M[3][4] = {
        {A[0][0], A[0][1], A[0][2], b[0]},
        {A[1][0], A[1][1], A[1][2], b[1]},
        {A[2][0], A[2][1], A[2][2], b[2]},
    };
    for (int col = 0; col < 3; ++col) {
        int piv = col;
        for (int r = col + 1; r < 3; ++r)
            if (std::fabs(M[r][col]) > std::fabs(M[piv][col])) piv = r;
        if (std::fabs(M[piv][col]) < 1e-12) return false;
        if (piv != col) for (int k = 0; k < 4; ++k) std::swap(M[col][k], M[piv][k]);
        for (int r = 0; r < 3; ++r) {
            if (r == col) continue;
            double fct = M[r][col] / M[col][col];
            for (int k = col; k < 4; ++k) M[r][k] -= fct * M[col][k];
        }
    }
    out.SetCoord(M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]);
    return true;
}

// Ordered outer-wire vertices of a face (wire order, each vertex once).
std::vector<TopoDS_Vertex> orderedRing(const TopoDS_Face& f) {
    std::vector<TopoDS_Vertex> ring;
    TopoDS_Wire w = BRepTools::OuterWire(f);
    if (w.IsNull()) return ring;
    for (BRepTools_WireExplorer wex(w, f); wex.More(); wex.Next())
        ring.push_back(wex.CurrentVertex());
    return ring;
}

TopoDS_Shape planarThickSolid(const TopoDS_Shape& shape, double t,
                              const TopTools_MapOfShape& removedSet, double tol) {
    const TopoDS_Shape kNull;

    // Zero openings => a fully-closed void (two-shell solid) — HONEST DEFER.
    if (removedSet.IsEmpty()) return kNull;

    // ---- 1. gather faces; every one must be a Geom_Plane (else defer) ----
    std::vector<TopoDS_Face> allFaces;
    std::vector<Plane> outward;   // outward plane per face (parallel to allFaces)
    std::vector<bool> removed;    // is this face an opening?
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face f = TopoDS::Face(ex.Current());
        Plane pl;
        if (!outwardPlaneOf(f, pl)) return kNull;  // non-planar => defer
        allFaces.push_back(f);
        outward.push_back(pl);
        removed.push_back(removedSet.Contains(f));
    }
    if (allFaces.size() < 4) return kNull;  // not a solid we can hollow

    // ---- 1b. thickness guard vs the solid's minimum half-extent ----
    TopTools_IndexedMapOfShape vmapAll;
    TopExp::MapShapes(shape, TopAbs_VERTEX, vmapAll);
    if (vmapAll.Extent() == 0) return kNull;
    double lo[3] = {0, 0, 0}, hi[3] = {0, 0, 0};
    for (int i = 1; i <= vmapAll.Extent(); ++i) {
        gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vmapAll.FindKey(i)));
        double c[3] = {p.X(), p.Y(), p.Z()};
        for (int k = 0; k < 3; ++k) {
            if (i == 1) { lo[k] = hi[k] = c[k]; }
            else { lo[k] = std::min(lo[k], c[k]); hi[k] = std::max(hi[k], c[k]); }
        }
    }
    double halfMin = 0.5 * std::min(std::min(hi[0] - lo[0], hi[1] - lo[1]), hi[2] - lo[2]);
    if (t >= halfMin) return kNull;  // inner offset would collapse => defer

    // ---- 2. vertex -> incident faces (indexed) ----
    TopTools_IndexedDataMapOfShapeListOfShape vfMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_FACE, vfMap);
    // Face -> its index in allFaces (IsSame lookup via an indexed map).
    TopTools_IndexedMapOfShape faceIndex;
    for (const TopoDS_Face& f : allFaces) faceIndex.Add(f);

    // ---- 3. inner corner per vertex (offset-plane meet, mouth-pinned) ----
    // innerPnt[i] is the cavity corner for vmap vertex i (1-based -> [i-1]).
    const int nV = vfMap.Extent();
    std::vector<gp_Pnt> innerPnt(nV);
    std::vector<bool> haveInner(nV, false);
    for (int i = 1; i <= nV; ++i) {
        const TopTools_ListOfShape& faces = vfMap.FindFromIndex(i);
        std::vector<Plane> meet;
        gp_Pnt vpnt = BRep_Tool::Pnt(TopoDS::Vertex(vfMap.FindKey(i)));
        double navg[3] = {0, 0, 0};
        int nContrib = 0;
        for (TopTools_ListIteratorOfListOfShape it(faces); it.More(); it.Next()) {
            int fi = faceIndex.FindIndex(it.Value());
            if (fi == 0) continue;
            const Plane& op = outward[static_cast<std::size_t>(fi) - 1];
            if (removed[static_cast<std::size_t>(fi) - 1]) {
                // Pin the mouth corner into the removed face's ORIGINAL plane.
                meet.push_back(op);
            } else {
                // Retained face: offset its plane INWARD by t (d -> d - t).
                Plane in = op; in.d = op.d - t;
                meet.push_back(in);
                navg[0] += op.nx; navg[1] += op.ny; navg[2] += op.nz; ++nContrib;
            }
        }
        gp_Pnt corner;
        if (!intersectPlanes(meet, corner)) {
            // Rank-deficient (edge-only vertex): push inward along the averaged
            // retained normal by t (Shell.cpp degenerate fallback).
            if (nContrib == 0) return kNull;
            double n = std::sqrt(navg[0]*navg[0] + navg[1]*navg[1] + navg[2]*navg[2]);
            if (n < 1e-12) return kNull;
            corner.SetCoord(vpnt.X() - t * navg[0] / n,
                            vpnt.Y() - t * navg[1] / n,
                            vpnt.Z() - t * navg[2] / n);
        }
        innerPnt[static_cast<std::size_t>(i) - 1] = corner;
        haveInner[static_cast<std::size_t>(i) - 1] = true;
    }
    auto innerOf = [&](const TopoDS_Vertex& v, gp_Pnt& out) -> bool {
        int idx = vfMap.FindIndex(v);
        if (idx == 0 || !haveInner[static_cast<std::size_t>(idx) - 1]) return false;
        out = innerPnt[static_cast<std::size_t>(idx) - 1];
        return true;
    };

    // ---- 4/5. assemble outer(unchanged) + inner + lip faces ----
    BRepBuilderAPI_Sewing sew(std::max(tol, 1.0e-6));
    int nInner = 0, nLip = 0, nOuter = 0;

    for (std::size_t fi = 0; fi < allFaces.size(); ++fi) {
        const TopoDS_Face& f = allFaces[fi];
        std::vector<TopoDS_Vertex> ring = orderedRing(f);
        if (ring.size() < 3) return kNull;

        if (!removed[fi]) {
            // Outer face: unchanged (an inward hollow keeps the outer boundary).
            sew.Add(f);
            ++nOuter;
            // Inner face: the offset-plane meet corners, wound REVERSE so the
            // inner normal points into the cavity.
            BRepBuilderAPI_MakePolygon poly;
            for (auto it = ring.rbegin(); it != ring.rend(); ++it) {
                gp_Pnt ip;
                if (!innerOf(*it, ip)) return kNull;
                poly.Add(ip);
            }
            poly.Close();
            if (!poly.IsDone()) return kNull;
            BRepBuilderAPI_MakeFace mkf(poly.Wire(), Standard_True);
            if (!mkf.IsDone()) return kNull;
            sew.Add(mkf.Face());
            ++nInner;
        } else {
            // Removed face: one lip quad per rim edge (outer_a, outer_b, inner_b,
            // inner_a), bridging the outer rim to the inner rim.
            const std::size_t n = ring.size();
            for (std::size_t k = 0; k < n; ++k) {
                const TopoDS_Vertex& va = ring[k];
                const TopoDS_Vertex& vb = ring[(k + 1) % n];
                gp_Pnt oa = BRep_Tool::Pnt(va), ob = BRep_Tool::Pnt(vb);
                gp_Pnt ia, ib;
                if (!innerOf(va, ia) || !innerOf(vb, ib)) return kNull;
                BRepBuilderAPI_MakePolygon quad;
                quad.Add(oa); quad.Add(ob); quad.Add(ib); quad.Add(ia);
                quad.Close();
                if (!quad.IsDone()) return kNull;
                BRepBuilderAPI_MakeFace mkq(quad.Wire(), Standard_True);
                if (!mkq.IsDone()) return kNull;
                sew.Add(mkq.Face());
                ++nLip;
            }
        }
    }
    if (nInner == 0 || nOuter == 0) return kNull;

    // ---- 5b. sew into one shell; must be watertight (no free edges) ----
    sew.Perform();
    if (sew.NbFreeEdges() != 0) return kNull;  // not closed => honest defer
    TopoDS_Shape sewed = sew.SewedShape();
    if (sewed.IsNull()) return kNull;

    TopoDS_Shell shell;
    int nShells = 0;
    for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
        shell = TopoDS::Shell(ex.Current());
        ++nShells;
    }
    if (nShells != 1 || shell.IsNull()) return kNull;  // want ONE connected wall

    // ---- 5c. orient into a valid positive-volume solid ----
    // Native ShapeFix_Solid::SolidFromShell subset (TKShHealing-free):
    // BRepBuilderAPI_MakeSolid + signed-volume outward flip.
    TopoDS_Solid solid = forge::occtheal::solidFromShell(shell);
    if (solid.IsNull()) return kNull;

    GProp_GProps props;
    BRepGProp::VolumeProperties(solid, props);
    double vol = props.Mass();
    if (std::fabs(vol) < 1e-12) return kNull;  // degenerate volume -> honest defer
    // solidFromShell already oriented the solid to positive (outward) volume.

    (void)nLip;
    return solid;
}

// ===========================================================================
//   PART 5b — WHOLE-SOLID OFFSET (TKOffset family H, BRepOffsetAPI_MakeOffsetShape)
// ===========================================================================
//
// Slide EVERY boundary face along its OWN outward normal by the signed `dist`
// and re-trim adjacent faces to their new mutual intersections — the SHARP
// (GeomAbs_Intersection) join. This is NOT the hollow: the hollow KEEPS the
// original boundary and adds an inset cavity; the offset REPLACES the boundary
// and keeps nothing of it.
//
// Both paths are the thick-solid's own machinery with two substitutions, and
// nothing else:
//   * the retained/removed split disappears — every face is "retained", so
//     contributing() is the OFFSET surface on BOTH sides of every edge and no
//     rim is ever pinned;
//   * the displacement is +dist along the outward normal instead of -t into
//     the material, so a positive `dist` GROWS and a negative one SHRINKS.
// Consequently the corner solve (intersectPlanes) and the closed-form circle
// re-trim (offsetCircle over the meridian meet) are reused verbatim, and the
// exactness they already carry — a box grown by d is exactly (L+2d)(W+2d)(H+2d),
// a cylinder grown by d is exactly a cylinder of R+d and height H+2d — carries
// with them.
//
// HONEST DEFER (null TopoDS_Shape) adds, on top of the thick-solid's list:
//   * any planar face carrying more than one wire — the hole ring offsets too,
//     and rebuilding it with the right winding is not covered here, so the face
//     is declined rather than silently emitted without its hole;
//   * a vertex whose incident faces do not pin an exact corner: fewer than three
//     independent offset planes (rank-deficient), or an over-determined corner
//     whose residual against any incident offset plane exceeds 1e-7*max(1,|dist|)
//     — a 4-plane apex generally has NO exact sharp-join offset, and an
//     approximate one is a wrong shape, not an offset;
//   * an inward offset at least as deep as the solid's smallest half-extent;
//   * a result that loses a face, fails to sew closed, or moves the volume the
//     wrong way for the sign of `dist`.

// ---- planar / prismatic: offset the Hesse planes, re-meet at every vertex ----
TopoDS_Shape planarOffsetShape(const TopoDS_Shape& shape, double dist, double tol) {
    const TopoDS_Shape kNull;

    std::vector<TopoDS_Face> faces;
    std::vector<Plane>       outward;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        Plane pl;
        if (!outwardPlaneOf(f, pl)) return kNull;      // non-planar => caller's quadric path
        int nWires = 0;
        for (TopoDS_Iterator it(f); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++nWires;
        if (nWires != 1) return kNull;                 // face with a hole => defer
        faces.push_back(f);
        outward.push_back(pl);
    }
    if (faces.size() < 4) return kNull;                // not a closed polyhedron

    // SHRINK GUARD: an inward offset at least as deep as the smallest half-extent
    // collapses the body. A grow has no such bound.
    if (dist < 0.0) {
        TopTools_IndexedMapOfShape vmapAll;
        TopExp::MapShapes(shape, TopAbs_VERTEX, vmapAll);
        if (vmapAll.Extent() == 0) return kNull;
        double lo[3] = {0, 0, 0}, hi[3] = {0, 0, 0};
        for (int i = 1; i <= vmapAll.Extent(); ++i) {
            const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vmapAll.FindKey(i)));
            const double c[3] = {p.X(), p.Y(), p.Z()};
            for (int k = 0; k < 3; ++k) {
                if (i == 1) { lo[k] = hi[k] = c[k]; }
                else { lo[k] = std::min(lo[k], c[k]); hi[k] = std::max(hi[k], c[k]); }
            }
        }
        const double halfMin =
            0.5 * std::min(std::min(hi[0] - lo[0], hi[1] - lo[1]), hi[2] - lo[2]);
        if (-dist >= halfMin) return kNull;
    }

    TopTools_IndexedDataMapOfShapeListOfShape vfMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_FACE, vfMap);
    TopTools_IndexedMapOfShape faceIndex;
    for (const TopoDS_Face& f : faces) faceIndex.Add(f);

    const int nV = vfMap.Extent();
    if (nV == 0) return kNull;
    std::vector<gp_Pnt> moved(static_cast<std::size_t>(nV));
    const double resTol = 1.0e-7 * std::max(1.0, std::fabs(dist));
    for (int i = 1; i <= nV; ++i) {
        std::vector<Plane> meet;
        for (TopTools_ListIteratorOfListOfShape it(vfMap.FindFromIndex(i)); it.More(); it.Next()) {
            const int fi = faceIndex.FindIndex(it.Value());
            if (fi == 0) return kNull;
            Plane p = outward[static_cast<std::size_t>(fi) - 1];
            p.d += dist;                               // slide OUTWARD by signed dist
            meet.push_back(p);
        }
        if (meet.size() < 3) return kNull;             // no exact corner to meet
        gp_Pnt corner;
        if (!intersectPlanes(meet, corner)) return kNull;   // rank-deficient
        // EXACTNESS: the least-squares meet is only the offset corner if EVERY
        // incident offset plane actually contains it. An over-determined apex
        // where it does not is declined, never approximated.
        for (const Plane& p : meet) {
            const double r = p.nx * corner.X() + p.ny * corner.Y() + p.nz * corner.Z() - p.d;
            if (std::fabs(r) > resTol) return kNull;
        }
        moved[static_cast<std::size_t>(i) - 1] = corner;
    }

    // Rebuild every face over its own ring of moved corners. Orientation is left
    // to the sew + solidFromShell pair (as planarThickSolid does): the wires fix
    // the region, the signed-volume flip fixes the side.
    BRepBuilderAPI_Sewing sew(std::max(tol, 1.0e-6));
    for (const TopoDS_Face& f : faces) {
        const std::vector<TopoDS_Vertex> ring = orderedRing(f);
        if (ring.size() < 3) return kNull;
        BRepBuilderAPI_MakePolygon poly;
        for (const TopoDS_Vertex& v : ring) {
            const int idx = vfMap.FindIndex(v);
            if (idx == 0) return kNull;
            poly.Add(moved[static_cast<std::size_t>(idx) - 1]);
        }
        poly.Close();
        if (!poly.IsDone()) return kNull;
        BRepBuilderAPI_MakeFace mkf(poly.Wire(), Standard_True);
        if (!mkf.IsDone()) return kNull;               // face collapsed under the offset
        sew.Add(mkf.Face());
    }

    sew.Perform();
    if (sew.NbFreeEdges() != 0) return kNull;          // not watertight => defer
    const TopoDS_Shape sewed = sew.SewedShape();
    if (sewed.IsNull()) return kNull;
    TopoDS_Shell shell;
    int nShells = 0;
    for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
        shell = TopoDS::Shell(ex.Current());
        ++nShells;
    }
    if (nShells != 1 || shell.IsNull()) return kNull;

    TopoDS_Solid solid = forge::occtheal::solidFromShell(shell);
    if (solid.IsNull()) return kNull;
    BRepLib::SameParameter(solid, std::max(tol, 1.0e-6), Standard_True);

    // SELF-CHECK: the sharp join preserves the face count, and the volume must
    // move in the direction of the sign of `dist`.
    int nFaceOut = 0;
    for (TopExp_Explorer ex(solid, TopAbs_FACE); ex.More(); ex.Next()) ++nFaceOut;
    if (nFaceOut != static_cast<int>(faces.size())) return kNull;

    GProp_GProps pn, po;
    BRepGProp::VolumeProperties(solid, pn);
    BRepGProp::VolumeProperties(shape, po);
    const double vn = std::fabs(pn.Mass()), vo = std::fabs(po.Mass());
    if (!(vn > 1.0e-12)) return kNull;
    if (dist > 0.0 && !(vn > vo)) return kNull;
    if (dist < 0.0 && !(vn < vo)) return kNull;
    return solid;
}

// ---- quadric: exact offset surface per face + closed-form meridian re-trim ----
TopoDS_Shape quadricOffsetShape(const TopoDS_Shape& shape, double dist, double tol) {
    const TopoDS_Shape kNull;
    const double t = std::fabs(dist);

    // ---- 1. every face moves; build its EXACT offset surface ----------------
    std::vector<QF> qf;
    TopTools_IndexedMapOfShape faceIdx;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        if (faceIdx.Contains(f)) continue;
        faceIdx.Add(f);

        QF q;
        q.face    = f;
        q.surf    = basisSurface(BRep_Tool::Surface(f));
        q.kind    = surfKind(q.surf);
        q.removed = false;                             // nothing is pinned
        if (q.kind == SK::Other) return kNull;
        BRepTools::UVBounds(f, q.u1, q.u2, q.v1, q.v2);
        q.nv1 = q.v1; q.nv2 = q.v2;

        gp_Pnt P; gp_Dir outward;
        if (!faceSample(f, q.surf, q.u1, q.u2, q.v1, q.v2, P, outward)) return kNull;
        const gp_Vec disp = gp_Vec(outward) * dist;    // ALONG the outward normal
        q.off = offsetSurfaceOf(q.surf, q.kind, P, disp, t);
        if (q.off.IsNull()) return kNull;
        qf.push_back(q);
    }
    if (qf.empty()) return kNull;

    auto qOf = [&](const TopoDS_Shape& f) -> QF* {
        const int i = faceIdx.FindIndex(f);
        if (i == 0) return nullptr;
        return &qf[static_cast<std::size_t>(i) - 1];
    };

    // ---- 2. structural admissibility (identical to the hollow) --------------
    for (const QF& q : qf) {
        int nWires = 0;
        for (TopoDS_Iterator it(q.face); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++nWires;

        if (q.kind != SK::Plane) {
            if (nWires != 1) return kNull;
            if (std::fabs((q.u2 - q.u1) - 2.0 * kPi) > 1.0e-7) return kNull;
        } else {
            if (nWires < 1) return kNull;
            for (TopoDS_Iterator it(q.face); it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                int nE = 0;
                gp_Circ c;
                for (TopExp_Explorer ee(it.Value(), TopAbs_EDGE); ee.More(); ee.Next()) {
                    ++nE;
                    if (!edgeFullCircle(TopoDS::Edge(ee.Current()), c)) return kNull;
                }
                if (nE != 1) return kNull;
            }
        }
    }

    // ---- 3. closed-form re-trim, one circle edge at a time ------------------
    TopTools_IndexedDataMapOfShapeListOfShape efMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, efMap);

    TopTools_IndexedMapOfShape edgeIdx;
    for (int i = 1; i <= efMap.Extent(); ++i) edgeIdx.Add(efMap.FindKey(i));
    std::vector<gp_Circ> offCirc(static_cast<std::size_t>(edgeIdx.Extent()));
    std::vector<bool>    offOk(static_cast<std::size_t>(edgeIdx.Extent()), false);

    for (int i = 1; i <= efMap.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(i));
        if (BRep_Tool::Degenerated(e)) continue;

        std::vector<QF*> nb;
        for (TopTools_ListIteratorOfListOfShape it(efMap.FindFromIndex(i)); it.More(); it.Next()) {
            QF* q = qOf(it.Value());
            if (!q) return kNull;
            if (std::find(nb.begin(), nb.end(), q) == nb.end()) nb.push_back(q);
        }
        if (nb.size() == 1) continue;                  // seam
        if (nb.size() != 2) return kNull;              // non-manifold
        QF& A = *nb[0];
        QF& B = *nb[1];

        gp_Circ orig;
        if (!edgeFullCircle(e, orig)) return kNull;

        gp_Circ oc;
        if (!offsetCircle(orig, A.surf, A.kind, B.surf, B.kind,
                          A.off, surfKind(A.off), B.off, surfKind(B.off), oc))
            return kNull;
        offCirc[static_cast<std::size_t>(i) - 1] = oc;
        offOk[static_cast<std::size_t>(i) - 1]   = true;

        for (QF* q : nb) {
            if (q->kind == SK::Plane) continue;
            double vOrig = 0.0, vNew = 0.0;
            if (!vParamOf(q->surf, q->kind, orig, vOrig)) return kNull;
            if (!vParamOf(q->off,  q->kind, oc,   vNew))  return kNull;
            const bool atLo = std::fabs(vOrig - q->v1) <= std::fabs(vOrig - q->v2);
            if (atLo) { q->nv1 = vNew; q->gotV1 = true; }
            else      { q->nv2 = vNew; q->gotV2 = true; }
        }
    }

    // ---- 4. build the offset faces on the EXACT offset surfaces -------------
    BRepBuilderAPI_Sewing sew(std::max(tol, 1.0e-6));
    std::vector<TopoDS_Face> built;
    int nAdded = 0;
    for (const QF& q : qf) {
        TopoDS_Face nf;
        if (q.kind == SK::Plane) {
            Handle(Geom_Plane) opl = Handle(Geom_Plane)::DownCast(q.off);
            if (opl.IsNull()) return kNull;
            const TopoDS_Wire outerW = BRepTools::OuterWire(q.face);
            if (outerW.IsNull()) return kNull;
            gp_Circ outerC;
            std::vector<gp_Circ> holes;
            bool haveOuter = false;
            for (TopoDS_Iterator it(q.face); it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                const TopoDS_Wire w = TopoDS::Wire(it.Value());
                TopExp_Explorer ee(w, TopAbs_EDGE);
                if (!ee.More()) return kNull;
                const int ei = edgeIdx.FindIndex(ee.Current());
                if (ei == 0 || !offOk[static_cast<std::size_t>(ei) - 1]) return kNull;
                const gp_Circ& c = offCirc[static_cast<std::size_t>(ei) - 1];
                if (w.IsSame(outerW)) { outerC = c; haveOuter = true; }
                else                  { holes.push_back(c); }
            }
            if (!haveOuter) return kNull;
            nf = planarCircularFace(opl, outerC, holes);
        } else {
            double a = q.nv1, b = q.nv2;
            if (a > b) std::swap(a, b);
            if (!(b - a > 1.0e-9)) return kNull;       // v-range inverted / collapsed
            BRepBuilderAPI_MakeFace mk(q.off, q.u1, q.u2, a, b, Precision::Confusion());
            if (!mk.IsDone()) return kNull;
            nf = mk.Face();
        }
        if (nf.IsNull()) return kNull;
        // Same gp_Ax3 => same parametric normal field, so the ORIGINAL topological
        // orientation still points outward on the offset surface. (The hollow flips
        // here because its cavity normal points the other way; this does not.)
        nf.Orientation(q.face.Orientation());
        built.push_back(nf);
        sew.Add(nf);
        ++nAdded;
    }
    if (nAdded == 0) return kNull;

    // ---- 5. one closed shell, oriented, self-checked ------------------------
    // A self-closed single face (full sphere / full torus: the seam is shared
    // with itself) has no edge for the sewer to join, so it is shelled directly
    // — the same special case the closed-hollow branch of quadricThickSolid makes.
    TopoDS_Shell shell;
    if (nAdded == 1) {
        BRep_Builder bb;
        bb.MakeShell(shell);
        bb.Add(shell, built[0]);
    } else {
        sew.Perform();
        if (sew.NbFreeEdges() != 0) return kNull;
        const TopoDS_Shape sewed = sew.SewedShape();
        if (sewed.IsNull()) return kNull;
        int nShells = 0;
        for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
            shell = TopoDS::Shell(ex.Current());
            ++nShells;
        }
        if (nShells != 1 || shell.IsNull()) return kNull;
    }

    TopoDS_Solid solid = forge::occtheal::solidFromShell(shell);
    if (solid.IsNull()) return kNull;
    BRepLib::SameParameter(solid, std::max(tol, 1.0e-6), Standard_True);

    int nFaceOut = 0;
    for (TopExp_Explorer ex(solid, TopAbs_FACE); ex.More(); ex.Next()) ++nFaceOut;
    if (nFaceOut != nAdded) return kNull;

    GProp_GProps pn, po;
    BRepGProp::VolumeProperties(solid, pn);
    BRepGProp::VolumeProperties(shape, po);
    const double vn = std::fabs(pn.Mass()), vo = std::fabs(po.Mass());
    if (!(vn > 1.0e-12)) return kNull;
    if (dist > 0.0 && !(vn > vo)) return kNull;
    if (dist < 0.0 && !(vn < vo)) return kNull;
    return solid;
}

}  // namespace

// ===========================================================================
//   PART 6 — the public entry point: dispatch planar vs quadric
// ===========================================================================

TopoDS_Shape makeThickSolid(const TopoDS_Shape& shape, double t,
                            const TopTools_ListOfShape& facesToRemove,
                            double tol) {
    const TopoDS_Shape kNull;  // IsNull() == honest defer
    if (shape.IsNull() || t <= 0.0) return kNull;

    TopTools_MapOfShape removedSet;
    for (TopTools_ListIteratorOfListOfShape it(facesToRemove); it.More(); it.Next())
        removedSet.Add(it.Value());

    // ALL-PLANAR solids keep the proven prismatic construction; anything with a
    // quadric face goes to the exact-surface path.
    bool allPlanar = true;
    int nFaces = 0;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        ++nFaces;
        if (surfKind(basisSurface(BRep_Tool::Surface(TopoDS::Face(ex.Current())))) != SK::Plane) {
            allPlanar = false;
            break;
        }
    }
    if (nFaces == 0) return kNull;

    if (allPlanar) return planarThickSolid(shape, t, removedSet, tol);
    return quadricThickSolid(shape, t, removedSet, tol);
}

// ===========================================================================
//   PART 7 — the public entry point for family H: dispatch planar vs quadric
// ===========================================================================

TopoDS_Shape offsetSolidShape(const TopoDS_Shape& shape, double dist, double tol) {
    const TopoDS_Shape kNull;   // IsNull() == honest defer
    if (shape.IsNull() || std::fabs(dist) < 1.0e-12) return kNull;

    bool allPlanar = true;
    int nFaces = 0;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        ++nFaces;
        if (surfKind(basisSurface(BRep_Tool::Surface(TopoDS::Face(ex.Current())))) != SK::Plane) {
            allPlanar = false;
            break;
        }
    }
    if (nFaces == 0) return kNull;

    if (allPlanar) return planarOffsetShape(shape, dist, tol);
    return quadricOffsetShape(shape, dist, tol);
}

}  // namespace occtoffset
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
