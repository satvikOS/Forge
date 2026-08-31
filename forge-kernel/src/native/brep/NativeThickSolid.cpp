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

#include <BRepCheck_Analyzer.hxx>
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
#include <Geom_Line.hxx>
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
#include <TopoDS_Compound.hxx>
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
#include <cstdio>
#include <cstring>
#include <vector>

namespace forge {
namespace occtoffset {

namespace {

// ---------------- DIAGNOSTIC-ONLY DEFER-REASON CHANNEL (behaviour-neutral) ---
// Copied in shape from src/native/brep/NativeLoftPipe.cpp, which added the same
// channel for the same reason. Every FK_DEFER below expands to "record a label,
// then do EXACTLY what the bare `return kNull` did". No predicate, no tolerance
// and no branch changes, and the returned value is the same null TopoDS_Shape it
// always was.
//
// It exists because the corpus A/B (reports/corpus_ab) measured this engine
// covering 7 of 600 THICKSOLID inputs against an OCCT baseline of 133, and a
// bare null shape says nothing about WHICH of the sixty-odd preconditions in
// this file declined. reports/CORPUS_AB_COVERAGE.md 3.2 records the lesson that
// made this necessary: a success rate cannot distinguish "the corpus has nothing
// this engine covers" from "the engine has a defect on the corpus's most common
// input", and THRUSECTIONS' 0.0% turned out to be the second.
//
// PROVED INERT: with the channel in and every site labelled, a full 600-part
// THICKSOLID re-run reproduces the pre-instrumentation run bucket-for-bucket and
// part-for-part -- every field but `note` byte-identical.
thread_local char g_tsReason[192] = {0};
void tsReasonClear() { g_tsReason[0] = '\0'; }
void tsReasonAdd(const char* label) {
    const std::size_t n = std::strlen(g_tsReason);
    // Collapse an immediately repeated label: a face with eleven wires that all
    // fail the same test says the same thing eleven times and then overflows the
    // buffer, hiding the label that actually differs.
    const std::size_t k = std::strlen(label);
    if (n >= k && std::strcmp(g_tsReason + n - k, label) == 0 &&
        (n == k || g_tsReason[n - k - 1] == '|')) return;
    if (n + 2 >= sizeof g_tsReason) return;
    std::snprintf(g_tsReason + n, sizeof g_tsReason - n, "%s%s", n ? "|" : "", label);
}
#define FK_DEFER(label) do { tsReasonAdd(label); return kNull; } while (0)

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

// ── family-H defer trail ────────────────────────────────────────────────────
// WHY did offsetSolidShape return a null shape? Every defer site records its own
// label here and then does EXACTLY what it did before — `dfr(l)` is
// `record(l); return kNull;` and nothing else, so this channel cannot change a
// predicate, a tolerance or a branch. It exists because a bare null cannot say
// WHICH precondition declined, and family H's 593-part defer column was
// unattributable without it. Same idiom, same buffer size and same read-out
// contract as occtloft::lastDeferReason (NativeLoftPipe.cpp:150).
// The string is meaningless (stale) after a call that SUCCEEDED.
thread_local char g_reason[192] = {0};
void reasonClear() { g_reason[0] = '\0'; }
void reasonAdd(const char* label) {
    const std::size_t n = std::strlen(g_reason);
    if (n + 2 >= sizeof g_reason) return;
    std::snprintf(g_reason + n, sizeof g_reason - n, "%s%s", n ? "|" : "", label);
}
TopoDS_Shape dfr(const char* label) { reasonAdd(label); return TopoDS_Shape(); }
TopoDS_Shape dfr2(const char* a, const char* b) {
    reasonAdd(a);
    if (b && *b) reasonAdd(b);
    return TopoDS_Shape();
}

enum class SK { Plane, Cyl, Cone, Sph, Tor, Other };

// One-character tag per surface kind, used only in diagnostic defer labels.
char skChar(SK k) {
    switch (k) {
        case SK::Plane: return 'P';
        case SK::Cyl:   return 'C';
        case SK::Cone:  return 'K';
        case SK::Sph:   return 'S';
        case SK::Tor:   return 'T';
        default:        return '?';
    }
}

SK surfKind(const Handle(Geom_Surface)& s) {
    if (s.IsNull()) return SK::Other;
    if (!Handle(Geom_Plane)::DownCast(s).IsNull())               return SK::Plane;
    if (!Handle(Geom_CylindricalSurface)::DownCast(s).IsNull())  return SK::Cyl;
    if (!Handle(Geom_ConicalSurface)::DownCast(s).IsNull())      return SK::Cone;
    if (!Handle(Geom_SphericalSurface)::DownCast(s).IsNull())    return SK::Sph;
    if (!Handle(Geom_ToroidalSurface)::DownCast(s).IsNull())     return SK::Tor;
    return SK::Other;
}

// Surface-kind names, for the defer trail only.
const char* skName(SK k) {
    switch (k) {
        case SK::Plane: return "plane";
        case SK::Cyl:   return "cyl";
        case SK::Cone:  return "cone";
        case SK::Sph:   return "sph";
        case SK::Tor:   return "tor";
        default:        return "other";
    }
}
const char* skPair(SK a, SK b) {
    static thread_local char buf[32];
    std::snprintf(buf, sizeof buf, "%s+%s", skName(a), skName(b));
    return buf;
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
        if (std::fabs(det) < 1.0e-12) {
            // PARALLEL. Two sub-cases, and only one of them is a defer.
            //
            // COINCIDENT lines mean the two surfaces contributing to this edge
            // are the SAME surface — which is what a circle imprinted across a
            // split coplanar face is. There is no crease to re-trim there: the
            // edge simply rides its own surface, so the offset edge is the
            // ORTHOGONAL PROJECTION of the original point onto the common
            // offset line, i.e. the original point slid along the surface
            // normal by the offset. That is exact, not a fallback.
            //
            // DISTINCT parallel lines have no meet and are still declined.
            double a2 = m2.a, b2 = m2.b, c2 = m2.c;
            if (m1.a * a2 + m1.b * b2 < 0.0) { a2 = -a2; b2 = -b2; c2 = -c2; }
            if (std::fabs(m1.a - a2) > kPara || std::fabs(m1.b - b2) > kPara ||
                std::fabs(m1.c - c2) > kGeo)
                return false;                                // parallel and distinct
            const double sd = m1.a * rho0 + m1.b * z0 - m1.c;
            cand[0][0] = rho0 - sd * m1.a;
            cand[0][1] = z0   - sd * m1.b;
            n = 1;
        } else {
            cand[0][0] = (m1.c * m2.b - m2.c * m1.b) / det;
            cand[0][1] = (m1.a * m2.c - m2.a * m1.c) / det;
            n = 1;
        }
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
                  gp_Circ& out, const char** why = nullptr) {
    // `why`, when non-null, receives a STATIC label for the clause that
    // declined. Diagnostic only: it is written on the false paths and read by
    // nobody who branches on it. A bare false could not distinguish "these two
    // surfaces are not surfaces of revolution about this circle's axis" from
    // "they are, and their offsets do not meet", which are different problems.
    auto no = [&](const char* w) { if (why) *why = w; return false; };
    const gp_Pnt O = orig.Location();
    const gp_Dir A = orig.Axis().Direction();

    // 1. VALIDATE: both ORIGINAL surfaces must be surfaces of revolution about A
    //    and must actually contain the original circle (rho = R, z = 0).
    // Sub-labels, same behaviour-neutral channel as FK_DEFER: this routine is the
    // single guard 228 corpus parts land on, and "offsetCircle said no" is not an
    // attribution.
    Mer moa, mob;
    if (!meridianOf(oa, ka, O, A, moa)) { tsReasonAdd("oc_orig_a_not_revolution"); return no("oc/orig_a_not_revolution_about_axis"); }
    if (!meridianOf(ob, kb, O, A, mob)) { tsReasonAdd("oc_orig_b_not_revolution"); return no("oc/orig_b_not_revolution_about_axis"); }
    if (!meridianContains(moa, orig.Radius(), 0.0)) { tsReasonAdd("oc_orig_a_off_circle"); return no("oc/orig_a_does_not_contain_circle"); }
    if (!meridianContains(mob, orig.Radius(), 0.0)) { tsReasonAdd("oc_orig_b_off_circle"); return no("oc/orig_b_does_not_contain_circle"); }

    // 2. Meet the two CONTRIBUTED meridians — exact, closed form.
    Mer ma, mb;
    if (!meridianOf(sa, ksa, O, A, ma)) { tsReasonAdd("oc_off_a_not_revolution"); return no("oc/off_a_not_revolution_about_axis"); }
    if (!meridianOf(sb, ksb, O, A, mb)) { tsReasonAdd("oc_off_b_not_revolution"); return no("oc/off_b_not_revolution_about_axis"); }
    double rho = 0.0, z = 0.0;
    if (!meetMeridians(ma, mb, orig.Radius(), 0.0, rho, z)) {
        // Name the PAIR: "two contributed meridians did not meet" is not an
        // attribution, and which pair it is decides whether a fix exists.
        static thread_local char lbl[64];
        const bool coincident = ma.isLine && mb.isLine &&
                                std::fabs(ma.a - mb.a) < 1.0e-9 &&
                                std::fabs(ma.b - mb.b) < 1.0e-9 &&
                                std::fabs(ma.c - mb.c) < kGeo;
        std::snprintf(lbl, sizeof lbl, "oc_nomeet_%c%c_%s", skChar(ksa), skChar(ksb),
                      coincident ? "coincident" : "parallel");
        tsReasonAdd(lbl);
        return no("oc/offset_meridians_do_not_meet");
    }
    if (rho < 1.0e-9) { tsReasonAdd("oc_collapsed_to_axis"); return no("oc/offset_radius_collapsed"); }

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

// Build a planar face on `pl` bounded by `outer` with `holes` punched out, and
// SELF-CHECK its area against the closed form pi*(Ro^2 - sum Rh^2). A wrong hole
// winding shows up as a wrong area, so this both fixes and verifies orientation.
TopoDS_Face planarCircularFace(const Handle(Geom_Plane)& pl,
                               const gp_Circ& outer,
                               const std::vector<gp_Circ>& holes) {
    double want = outer.Radius() * outer.Radius();
    for (const gp_Circ& h : holes) want -= h.Radius() * h.Radius();
    if (want <= 1.0e-12) {
        // Carry the numbers: "the annulus collapsed" cannot distinguish a wall
        // genuinely thicker than the face from a mis-signed offset radius.
        static thread_local char lbl[96];
        std::snprintf(lbl, sizeof lbl, "pcf_collapsed_Ro%.4g_nh%d_sumRh2%.4g",
                      outer.Radius(), static_cast<int>(holes.size()),
                      outer.Radius() * outer.Radius() - want);
        tsReasonAdd(lbl);
        return TopoDS_Face();
    }
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
        if (!inPlane(outer)) { tsReasonAdd("pcf_outer_off_plane"); return TopoDS_Face(); }
        for (const gp_Circ& h : holes)
            if (!inPlane(h)) { tsReasonAdd("pcf_hole_off_plane"); return TopoDS_Face(); }
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
    tsReasonAdd("pcf_area_disagrees_with_pi_R2_sum");
    return TopoDS_Face();
}

// ===========================================================================
//   PART 3b — MIXED planar faces: polygon wires alongside circular ones
// ===========================================================================
//
// WHY THIS EXISTS, measured rather than assumed. The quadric path above admits a
// PLANAR face only when every one of its wires is exactly one full circle — a
// disk or an annulus. A per-part defer census over the 600-part corpus A/B
// (reports/corpus_ab/THICKSOLID_ATTRIBUTION.md) attributes 370 of the engine's
// 593 deferrals to that single rule, INCLUDING ALL 126 PARTS OF THE DELETION
// BUCKET, and shows 228 of those 370 to be otherwise entirely within scope:
// every face analytic, every curved face a full revolution, every edge a line or
// a full circle. The corpus's shape is not "curved and beyond us" — it is a
// POLYGONAL PLATE WITH CYLINDRICAL HOLES, which needs polygon wires and nothing
// else.
//
// A polygon wire's offset boundary is NOT a new curve type: each of its LINE
// edges is shared by two PLANES, so the cavity edge is the meet of two offset
// planes, and each of its VERTICES is the meet of the offset planes of the faces
// around it — exactly the corner solve planarThickSolid has always used. The
// only new construction is a planar face bounded by a mix of polygons and
// circles, below, and it self-checks its own area the same way
// planarCircularFace does.

bool isLineEdge(const TopoDS_Edge& e) {
    if (BRep_Tool::Degenerated(e)) return false;
    double f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = edgeBasisCurve(e, f, l);
    return !c.IsNull() && !Handle(Geom_Line)::DownCast(c).IsNull();
}

// A planar face's wire is admissible in exactly two shapes.
enum class WK { Circle, Polygon, Other };

WK wireKind(const TopoDS_Wire& w) {
    int nE = 0, nLine = 0, nCirc = 0;
    gp_Circ c;
    for (TopExp_Explorer ee(w, TopAbs_EDGE); ee.More(); ee.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ee.Current());
        ++nE;
        if (isLineEdge(e)) ++nLine;
        else if (edgeFullCircle(e, c)) ++nCirc;
    }
    if (nE == 1 && nCirc == 1) return WK::Circle;
    if (nE >= 3 && nLine == nE) return WK::Polygon;
    return WK::Other;   // an arc, a spline, or a wire mixing lines and arcs
}

// Ordered vertices of ONE wire of a face, in wire order, each once.
std::vector<TopoDS_Vertex> ringOfWire(const TopoDS_Face& f, const TopoDS_Wire& w) {
    std::vector<TopoDS_Vertex> ring;
    for (BRepTools_WireExplorer wex(w, f); wex.More(); wex.Next())
        ring.push_back(wex.CurrentVertex());
    return ring;
}

// One boundary loop of a planar cavity face: an exact circle, or an ordered
// polygon of points that already lie in the target plane.
struct Loop {
    bool                 isCircle = false;
    gp_Circ              circ;
    std::vector<gp_Pnt>  pts;
};

// Unsigned area of a loop, projected on N. For a polygon this is the Newell /
// shoelace vector area, which is origin-independent because the loop is closed.
double loopArea(const Loop& L, const gp_Dir& N) {
    if (L.isCircle) return kPi * L.circ.Radius() * L.circ.Radius();
    gp_Vec acc(0.0, 0.0, 0.0);
    const std::size_t n = L.pts.size();
    for (std::size_t i = 0; i < n; ++i) {
        const gp_Pnt& a = L.pts[i];
        const gp_Pnt& b = L.pts[(i + 1) % n];
        acc += gp_Vec(a.X(), a.Y(), a.Z()).Crossed(gp_Vec(b.X(), b.Y(), b.Z()));
    }
    return std::fabs(0.5 * acc.Dot(gp_Vec(N)));
}

TopoDS_Wire polygonWire(const std::vector<gp_Pnt>& pts) {
    if (pts.size() < 3) return TopoDS_Wire();
    BRepBuilderAPI_MakePolygon mp;
    for (const gp_Pnt& p : pts) mp.Add(p);
    mp.Close();
    if (!mp.IsDone()) return TopoDS_Wire();
    return mp.Wire();
}

// Build a planar face on `pl` bounded by `outer` with `holes` punched out, and
// SELF-CHECK its measured area against the closed form (pi R^2 per circle, the
// shoelace area per polygon). Generalises planarCircularFace to polygonal loops;
// as there, a wrong winding shows up as a wrong area, so enumerating the four
// windings and keeping the one that measures right both fixes and VERIFIES the
// orientation rather than assuming it.
TopoDS_Face planarLoopFace(const Handle(Geom_Plane)& pl, const Loop& outer,
                           const std::vector<Loop>& holes) {
    const gp_Dir N = pl->Position().Direction();
    double want = loopArea(outer, N);
    for (const Loop& h : holes) want -= loopArea(h, N);
    if (want <= 1.0e-12) { tsReasonAdd("plf_offset_region_collapsed"); return TopoDS_Face(); }

    // Every bounding loop MUST lie in this plane, else the closed-form area is
    // a lie and the self-check below would ratify a non-planar "face".
    const gp_Pln pln = pl->Pln();
    auto inPlane = [&](const Loop& L) {
        if (L.isCircle)
            return dirParallel(L.circ.Axis().Direction(), N) &&
                   pln.Distance(L.circ.Location()) < kGeo;
        for (const gp_Pnt& p : L.pts) if (pln.Distance(p) > kGeo) return false;
        return true;
    };
    if (!inPlane(outer)) { tsReasonAdd("plf_outer_off_plane"); return TopoDS_Face(); }
    for (const Loop& h : holes)
        if (!inPlane(h)) { tsReasonAdd("plf_hole_off_plane"); return TopoDS_Face(); }

    auto wireOf = [&](const Loop& L, bool rev) -> TopoDS_Wire {
        if (L.isCircle) {
            gp_Dir n = N;
            if (rev) n.Reverse();
            const gp_Circ c(gp_Ax2(L.circ.Location(), n, L.circ.Position().XDirection()),
                            L.circ.Radius());
            return circleWire(c);
        }
        std::vector<gp_Pnt> p = L.pts;
        if (rev) std::reverse(p.begin(), p.end());
        return polygonWire(p);
    };

    for (int ow = 0; ow < 2; ++ow) {
        const TopoDS_Wire owire = wireOf(outer, ow != 0);
        if (owire.IsNull()) continue;
        for (int hw = 0; hw < 2; ++hw) {
            BRepBuilderAPI_MakeFace mk(pl, owire, Standard_True);
            if (!mk.IsDone()) continue;
            bool ok = true;
            for (const Loop& h : holes) {
                const TopoDS_Wire hwire = wireOf(h, hw != 0);
                if (hwire.IsNull()) { ok = false; break; }
                mk.Add(hwire);
            }
            if (!ok || !mk.IsDone()) continue;
            TopoDS_Face f = mk.Face();
            // Pin the convention: FORWARD means "outward normal == +N". The
            // wires define the region; the orientation only picks the side.
            f.Orientation(TopAbs_FORWARD);
            GProp_GProps g;
            BRepGProp::SurfaceProperties(f, g);
            if (std::fabs(g.Mass() - want) < 1.0e-6 * std::max(1.0, want)) return f;
            if (holes.empty()) break;   // no hole winding to vary
        }
    }
    tsReasonAdd("plf_no_winding_matched_the_area");
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
        if (q.kind == SK::Other) FK_DEFER("q_surface_unsupported");                 // unsupported surface
        BRepTools::UVBounds(f, q.u1, q.u2, q.v1, q.v2);
        q.nv1 = q.v1; q.nv2 = q.v2;

        if (!q.removed) {
            gp_Pnt P; gp_Dir outward;
            if (!faceSample(f, q.surf, q.u1, q.u2, q.v1, q.v2, P, outward)) FK_DEFER("q_face_sample_fail");
            const gp_Vec disp = gp_Vec(outward) * (-t);        // INTO the material
            q.off = offsetSurfaceOf(q.surf, q.kind, P, disp, t);
            if (q.off.IsNull()) FK_DEFER("q_offset_surface_fail");
        }
        qf.push_back(q);
    }
    if (qf.empty()) FK_DEFER("q_no_faces");

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
            if (nWires != 1) FK_DEFER("q_curved_face_multi_wire");                     // hole in a curved wall
            if (std::fabs((q.u2 - q.u1) - 2.0 * kPi) > 1.0e-7) FK_DEFER("q_curved_face_partial_revolution");  // partial revolution
        } else {
            // A planar wire is admissible as ONE FULL CIRCLE (a disk or annulus
            // boundary, rebuilt from the closed-form offset circle) or as a
            // POLYGON of line edges (rebuilt from the offset corner solve).
            // Anything else — an arc, a spline, or a wire mixing lines and arcs —
            // needs a real 2-D trim and is declined, never approximated.
            if (nWires < 1) FK_DEFER("q_planar_face_no_wire");
            for (TopoDS_Iterator it(q.face); it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                if (wireKind(TopoDS::Wire(it.Value())) == WK::Other)
                    FK_DEFER("q_planar_wire_not_circle_or_polygon");
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
    // Edges whose wall is closed by a CYLINDRICAL RISER rather than an in-plane
    // lip band — see the coplanar-split note in the loop below.
    std::vector<char> riser(static_cast<std::size_t>(edgeIdx.Extent()), 0);

    for (int i = 1; i <= efMap.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(i));
        if (BRep_Tool::Degenerated(e)) continue;

        // The distinct faces on this edge. One face twice == a SEAM: skip it,
        // the offset surface carries its own seam.
        std::vector<QF*> nb;
        for (TopTools_ListIteratorOfListOfShape it(efMap.FindFromIndex(i)); it.More(); it.Next()) {
            QF* q = qOf(it.Value());
            if (!q) FK_DEFER("q_edge_face_not_indexed");
            if (std::find(nb.begin(), nb.end(), q) == nb.end()) nb.push_back(q);
        }
        if (nb.size() == 1) continue;                          // seam
        if (nb.size() != 2) FK_DEFER("q_edge_non_manifold");                      // non-manifold
        QF& A = *nb[0];
        QF& B = *nb[1];
        if (A.removed && B.removed) FK_DEFER("q_adjacent_removed_faces");              // zero-width lip

        gp_Circ orig;
        if (!edgeFullCircle(e, orig)) {
            // A LINE edge shared by two PLANES is offset as the meet of the two
            // OFFSET PLANES, which the polygon corner solve (step 3b) performs
            // vertex by vertex. There is no circle to re-trim and no v-bound to
            // push, so the edge is simply not this loop's business. Any other
            // non-circular edge — an arc, a spline, or a line against a curved
            // face — is still declined.
            if (isLineEdge(e) && A.kind == SK::Plane && B.kind == SK::Plane) continue;
            FK_DEFER("q_edge_not_circle");
        }

        // ---- COPLANAR FACE SPLIT --------------------------------------------
        // A full circle shared by two PLANAR faces that both CONTAIN it is not a
        // geometric edge of the solid at all: it is a topological split of one
        // flat region. There is no dihedral, so there is nothing for the
        // meridian meet to solve — and indeed offsetCircle cannot answer here,
        // because the two contributed meridians are parallel (or identical)
        // lines. MEASURED: after the polygon rule is lifted this is where all
        // 228 in-scope corpus parts stop, 90 with both sides retained and 138
        // with one side the mouth.
        //
        // The offset circle is the SAME circle, translated onto the cavity
        // plane. When one side is the MOUTH the two sides land on DIFFERENT
        // planes — the mouth stays, the retained side drops by t — and the wall
        // is closed across that step by an exact cylindrical riser (built in 5b).
        if (A.kind == SK::Plane && B.kind == SK::Plane) {
            const gp_Pnt O  = orig.Location();
            const gp_Dir Ad = orig.Axis().Direction();
            Handle(Geom_Plane) pa = Handle(Geom_Plane)::DownCast(A.surf);
            Handle(Geom_Plane) pb = Handle(Geom_Plane)::DownCast(B.surf);
            // COPLANARITY IS VERIFIED, never inferred from the pair of kinds:
            // both planes perpendicular to the circle's axis AND both through
            // its centre is exactly "both of them contain this circle".
            const bool coplanar =
                !pa.IsNull() && !pb.IsNull() &&
                dirParallel(pa->Position().Direction(), Ad) &&
                dirParallel(pb->Position().Direction(), Ad) &&
                pa->Pln().Distance(O) < kGeo && pb->Pln().Distance(O) < kGeo;
            if (coplanar) {
                // The plane the CAVITY boundary lands on. Both sides retained =>
                // they must offset onto the SAME plane; one side removed => the
                // retained side's plane, with a riser spanning the step.
                Handle(Geom_Plane) target;
                bool needRiser = false;
                if (!A.removed && !B.removed) {
                    Handle(Geom_Plane) oa2 = Handle(Geom_Plane)::DownCast(A.off);
                    Handle(Geom_Plane) ob2 = Handle(Geom_Plane)::DownCast(B.off);
                    if (!oa2.IsNull() && !ob2.IsNull() &&
                        oa2->Pln().Distance(ob2->Position().Location()) < kGeo &&
                        dirParallel(oa2->Position().Direction(), ob2->Position().Direction()))
                        target = oa2;
                } else {
                    target = Handle(Geom_Plane)::DownCast((A.removed ? B : A).off);
                    needRiser = true;
                }
                if (!target.IsNull()) {
                    const double zoff =
                        gp_Vec(O, target->Position().Location()).Dot(gp_Vec(Ad));
                    // The cavity plane must be exactly one wall away, or the step
                    // this closes is not the wall and the shape would be WRONG,
                    // not approximate.
                    if (std::fabs(std::fabs(zoff) - t) <= 1.0e-7 * std::max(1.0, t)) {
                        const gp_Pnt ctr = O.Translated(gp_Vec(Ad) * zoff);
                        offCirc[static_cast<std::size_t>(i) - 1] =
                            gp_Circ(gp_Ax2(ctr, Ad, orig.Position().XDirection()),
                                    orig.Radius());
                        offOk[static_cast<std::size_t>(i) - 1] = true;
                        riser[static_cast<std::size_t>(i) - 1] = needRiser ? 1 : 0;
                        continue;
                    }
                }
                FK_DEFER("q_coplanar_split_not_one_wall");
            }
        }

        gp_Circ oc;
        if (!offsetCircle(orig, A.surf, A.kind, B.surf, B.kind,
                          contributing(A), A.removed ? A.kind : surfKind(A.off),
                          contributing(B), B.removed ? B.kind : surfKind(B.off), oc))
        {
            // Which side was REMOVED decides whether the configuration is a
            // mouth-boundary riser or a genuinely degenerate pair.
            static thread_local char lbl[64];
            std::snprintf(lbl, sizeof lbl, "q_offset_circle_fail_rm%d%d",
                          A.removed ? 1 : 0, B.removed ? 1 : 0);
            FK_DEFER(lbl);
        }
        offCirc[static_cast<std::size_t>(i) - 1] = oc;
        offOk[static_cast<std::size_t>(i) - 1]   = true;

        // Push the new v-bound onto each RETAINED curved neighbour.
        for (QF* q : nb) {
            if (q->removed || q->kind == SK::Plane) continue;
            double vOrig = 0.0, vNew = 0.0;
            if (!vParamOf(q->surf, q->kind, orig, vOrig)) FK_DEFER("q_vparam_orig_fail");
            if (!vParamOf(q->off,  q->kind, oc,   vNew))  FK_DEFER("q_vparam_offset_fail");
            const bool atLo = std::fabs(vOrig - q->v1) <= std::fabs(vOrig - q->v2);
            if (atLo) { q->nv1 = vNew; q->gotV1 = true; }
            else      { q->nv2 = vNew; q->gotV2 = true; }
        }
    }

    // ---- 3b. the offset CORNER of every POLYGON-wire vertex ----------------
    // A polygon wire's vertices lie on no circle, so step 3 says nothing about
    // them. Their cavity image is the meet of the OFFSET planes of the faces
    // around the vertex, with a REMOVED face pinning the corner into its
    // ORIGINAL plane so a mouth corner lands on the open rim — planarThickSolid's
    // rule, unchanged, applied to a mixed solid.
    //
    // EVERY face at such a vertex must be planar. A cylinder touching the corner
    // would put the exact corner on a quadric, and a least-squares plane meet
    // there is a WRONG point, not an approximate one — so that case is an honest
    // defer. There is deliberately NO averaged-normal fallback here: on a mixed
    // solid it would fabricate a corner the neighbouring cavity faces do not
    // share, and the sew would then close over the gap inside its own tolerance.
    TopTools_IndexedDataMapOfShapeListOfShape vfMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_FACE, vfMap);
    std::vector<gp_Pnt> cornerPnt(static_cast<std::size_t>(std::max(0, vfMap.Extent())));
    std::vector<char>   cornerState(static_cast<std::size_t>(std::max(0, vfMap.Extent())), 0);
    // 0 = not computed, 1 = computed ok, 2 = computed and declined
    auto cornerOf = [&](const TopoDS_Vertex& v, gp_Pnt& out) -> bool {
        const int idx = vfMap.FindIndex(v);
        if (idx == 0) { tsReasonAdd("corner_vertex_not_indexed"); return false; }
        const std::size_t k = static_cast<std::size_t>(idx) - 1;
        if (cornerState[k] == 1) { out = cornerPnt[k]; return true; }
        if (cornerState[k] == 2) return false;
        cornerState[k] = 2;
        const gp_Pnt vp = BRep_Tool::Pnt(TopoDS::Vertex(vfMap.FindKey(idx)));

        std::vector<Plane> meet;
        for (TopTools_ListIteratorOfListOfShape it(vfMap.FindFromIndex(idx)); it.More(); it.Next()) {
            QF* q = qOf(it.Value());
            if (!q) { tsReasonAdd("corner_face_not_indexed"); return false; }
            if (q->kind != SK::Plane) { tsReasonAdd("corner_nonplanar_incident_face"); return false; }
            Plane op;
            if (!outwardPlaneOf(q->face, op)) { tsReasonAdd("corner_outward_plane_fail"); return false; }
            if (q->removed) {
                meet.push_back(op);                      // pin into the mouth plane
            } else {
                // The inward plane MUST be the very surface step 1 offset this
                // face onto, or the corner would not lie on the cavity face that
                // is built from it. Verified, not assumed.
                Handle(Geom_Plane) opl = Handle(Geom_Plane)::DownCast(q->off);
                if (opl.IsNull()) { tsReasonAdd("corner_offset_not_plane"); return false; }
                Plane in = op;
                in.d = op.d - t;
                const gp_Pnt L = opl->Position().Location();
                if (std::fabs(in.nx * L.X() + in.ny * L.Y() + in.nz * L.Z() - in.d) > kGeo) {
                    tsReasonAdd("corner_offset_plane_mismatch");
                    return false;
                }
                meet.push_back(in);
            }
        }
        // DEDUPLICATE FIRST. Two coplanar faces contribute the SAME plane, and a
        // least-squares meet of duplicates is singular however many faces are
        // listed — which is exactly what a split flat region produces at every
        // vertex on the split edge.
        std::vector<Plane> uniq;
        for (const Plane& p : meet) {
            bool dup = false;
            for (const Plane& u : uniq) {
                const double dot = u.nx * p.nx + u.ny * p.ny + u.nz * p.nz;
                if (std::fabs(std::fabs(dot) - 1.0) < kPara &&
                    std::fabs((dot > 0.0 ? u.d : -u.d) - p.d) < kGeo) { dup = true; break; }
            }
            if (!dup) uniq.push_back(p);
        }

        gp_Pnt c;
        if (uniq.size() >= 3) {
            if (!intersectPlanes(uniq, c)) { tsReasonAdd("corner_planes_rank_deficient"); return false; }
        } else if (uniq.size() == 2) {
            // RANK 2: the two offset planes meet in a LINE parallel to the
            // original edge, and this vertex's image is its perpendicular
            // projection onto it — exact, and the same displacement for every
            // vertex on that edge, so the polygon keeps its shape.
            //   minimise |x - V|^2  subject to  n1.x = d1,  n2.x = d2
            //   =>  x = V + a*n1 + b*n2  with  [1 c; c 1][a b]^T = [r1 r2]^T
            const Plane& p1 = uniq[0];
            const Plane& p2 = uniq[1];
            const double dotc = p1.nx * p2.nx + p1.ny * p2.ny + p1.nz * p2.nz;
            const double det  = 1.0 - dotc * dotc;
            if (std::fabs(det) < 1.0e-12) { tsReasonAdd("corner_two_planes_parallel"); return false; }
            const double r1 = p1.d - (p1.nx * vp.X() + p1.ny * vp.Y() + p1.nz * vp.Z());
            const double r2 = p2.d - (p2.nx * vp.X() + p2.ny * vp.Y() + p2.nz * vp.Z());
            const double a  = (r1 - dotc * r2) / det;
            const double b  = (r2 - dotc * r1) / det;
            c.SetCoord(vp.X() + a * p1.nx + b * p2.nx,
                       vp.Y() + a * p1.ny + b * p2.ny,
                       vp.Z() + a * p1.nz + b * p2.nz);
        } else if (uniq.size() == 1) {
            // RANK 1: every face at this vertex lies in ONE plane, so the vertex
            // is a pure artefact of the face splitting — a junction of split
            // lines strictly inside a flat region. Its cavity image is the
            // perpendicular projection onto that single plane, which is the
            // same displacement the whole region gets, so the polygon keeps its
            // shape exactly.
            const Plane& p1 = uniq[0];
            const double a = p1.d - (p1.nx * vp.X() + p1.ny * vp.Y() + p1.nz * vp.Z());
            c.SetCoord(vp.X() + a * p1.nx, vp.Y() + a * p1.ny, vp.Z() + a * p1.nz);
        } else {
            tsReasonAdd("corner_no_incident_plane");
            return false;
        }
        cornerPnt[k]   = c;
        cornerState[k] = 1;
        out = c;
        return true;
    };

    // Collect one Loop per wire of a PLANAR face: the offset circle for a
    // circular wire, the offset corners for a polygon one.
    auto loopsOfPlanarFace = [&](const QF& q, bool pinnedToOriginalPlane,
                                 Loop& outerL, std::vector<Loop>& holes) -> bool {
        const TopoDS_Wire outerW = BRepTools::OuterWire(q.face);
        if (outerW.IsNull()) { tsReasonAdd("mixed_no_outer_wire"); return false; }
        bool haveOuter = false;
        for (TopoDS_Iterator it(q.face); it.More(); it.Next()) {
            if (it.Value().ShapeType() != TopAbs_WIRE) continue;
            const TopoDS_Wire w = TopoDS::Wire(it.Value());
            Loop L;
            const WK wk = wireKind(w);
            if (wk == WK::Circle) {
                TopExp_Explorer ee(w, TopAbs_EDGE);
                if (!ee.More()) { tsReasonAdd("mixed_circle_wire_no_edge"); return false; }
                const int ei = edgeIdx.FindIndex(ee.Current());
                if (ei == 0 || !offOk[static_cast<std::size_t>(ei) - 1]) {
                    tsReasonAdd("mixed_circle_wire_no_offset_circle");
                    return false;
                }
                L.isCircle = true;
                L.circ = offCirc[static_cast<std::size_t>(ei) - 1];
            } else if (wk == WK::Polygon) {
                const std::vector<TopoDS_Vertex> ring = ringOfWire(q.face, w);
                if (ring.size() < 3) { tsReasonAdd("mixed_polygon_ring_short"); return false; }
                for (const TopoDS_Vertex& v : ring) {
                    gp_Pnt p;
                    if (!cornerOf(v, p)) return false;   // cornerOf already labelled
                    L.pts.push_back(p);
                }
            } else {
                tsReasonAdd("mixed_wire_kind_other");
                return false;
            }
            if (w.IsSame(outerW)) { outerL = L; haveOuter = true; }
            else                  { holes.push_back(L); }
        }
        (void)pinnedToOriginalPlane;
        return haveOuter;
    };

    // ---- 4. build the INNER faces (exact analytic surfaces) ----------------
    std::vector<TopoDS_Face> innerFaces;
    for (const QF& q : qf) {
        if (q.removed) continue;

        TopoDS_Face inner;
        if (q.kind == SK::Plane) {
            // Rebuild the disk / annulus on the OFFSET plane from the offset circles.
            Handle(Geom_Plane) opl = Handle(Geom_Plane)::DownCast(q.off);
            if (opl.IsNull()) FK_DEFER("q_offset_plane_downcast_fail");
            TopoDS_Wire outerW = BRepTools::OuterWire(q.face);
            if (outerW.IsNull()) FK_DEFER("q_no_outer_wire");

            // ALL-CIRCULAR faces keep the original construction BYTE FOR BYTE.
            // The mixed builder is strictly additive: a face this branch already
            // handled must go on producing the identical shape, or the 7 parts
            // the engine covers today would move for a reason that is about the
            // refactor and not about the new capability.
            bool allCirc = true;
            for (TopoDS_Iterator it(q.face); allCirc && it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                if (wireKind(TopoDS::Wire(it.Value())) != WK::Circle) allCirc = false;
            }

            if (allCirc) {
                gp_Circ outerC;
                std::vector<gp_Circ> holes;
                bool haveOuter = false;
                for (TopoDS_Iterator it(q.face); it.More(); it.Next()) {
                    if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                    TopoDS_Wire w = TopoDS::Wire(it.Value());
                    TopExp_Explorer ee(w, TopAbs_EDGE);
                    if (!ee.More()) FK_DEFER("q_planar_rebuild_wire_no_edge");
                    const int ei = edgeIdx.FindIndex(ee.Current());
                    if (ei == 0 || !offOk[static_cast<std::size_t>(ei) - 1]) FK_DEFER("q_planar_rebuild_no_offset_circle");
                    const gp_Circ& c = offCirc[static_cast<std::size_t>(ei) - 1];
                    if (w.IsSame(outerW)) { outerC = c; haveOuter = true; }
                    else                  { holes.push_back(c); }
                }
                if (!haveOuter) FK_DEFER("q_planar_rebuild_no_outer_circle");
                inner = planarCircularFace(opl, outerC, holes);
            } else {
                Loop outerL;
                std::vector<Loop> holes;
                if (!loopsOfPlanarFace(q, false, outerL, holes)) FK_DEFER("q_planar_mixed_loops_fail");
                inner = planarLoopFace(opl, outerL, holes);
            }
        } else {
            double a = q.nv1, b = q.nv2;
            if (a > b) std::swap(a, b);
            if (!(b - a > 1.0e-9)) FK_DEFER("q_vrange_collapsed");               // v-range inverted / collapsed
            BRepBuilderAPI_MakeFace mk(q.off, q.u1, q.u2, a, b, Precision::Confusion());
            if (!mk.IsDone()) FK_DEFER("q_curved_makeface_fail");
            inner = mk.Face();
        }
        if (inner.IsNull()) FK_DEFER("q_inner_face_null");

        // The cavity face's normal must point INTO the cavity, i.e. opposite the
        // original face's outward normal. Same gp_Ax3 => same parametric normal
        // field, so flipping the topological orientation is exactly right.
        inner.Orientation(q.face.Orientation() == TopAbs_REVERSED ? TopAbs_FORWARD
                                                                  : TopAbs_REVERSED);
        innerFaces.push_back(inner);
    }
    if (innerFaces.empty()) FK_DEFER("q_no_inner_faces");

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
            if (sew.NbFreeEdges() != 0) FK_DEFER("q_closed_inner_sew_free_edges");
            TopoDS_Shape sewed = sew.SewedShape();
            int n = 0;
            for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
                innerShell = TopoDS::Shell(ex.Current());
                ++n;
            }
            if (n != 1 || innerShell.IsNull()) FK_DEFER("q_closed_inner_sew_shell_count");
        }

        TopoDS_Solid solid;
        bb.MakeSolid(solid);
        int nOuter = 0;
        for (TopExp_Explorer ex(shape, TopAbs_SHELL); ex.More(); ex.Next()) {
            bb.Add(solid, ex.Current());
            ++nOuter;
        }
        if (nOuter != 1) FK_DEFER("q_closed_outer_shell_count");
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
        if (!(want > 1.0e-9)) FK_DEFER("q_closed_wall_nonpositive");
        if (std::fabs(pw.Mass() - want) > 1.0e-6 * std::max(1.0, want)) FK_DEFER("q_closed_volume_identity");
        return solid;
    }

    // ---- 5b. OPEN MOUTH: outer skin + cavity + lip, sewn into one shell ----
    BRepBuilderAPI_Sewing sew(std::max(tol, 1.0e-6));
    for (const QF& q : qf) if (!q.removed) sew.Add(q.face);
    for (const TopoDS_Face& f : innerFaces) sew.Add(f);

    for (const QF& q : qf) {
        if (!q.removed) continue;
        if (q.kind != SK::Plane) FK_DEFER("q_mouth_face_curved");                 // curved mouth unsupported
        Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(q.surf);
        if (pl.IsNull()) FK_DEFER("q_mouth_plane_downcast_fail");
        for (TopoDS_Iterator it(q.face); it.More(); it.Next()) {
            if (it.Value().ShapeType() != TopAbs_WIRE) continue;
            TopoDS_Wire w = TopoDS::Wire(it.Value());

            // A POLYGONAL mouth rim: the lip is the band between the rim itself
            // and its PINNED image — the corner solve pins a mouth corner into
            // this face's ORIGINAL plane, so both loops are coplanar with it and
            // the band is an exact planar region. Which loop bounds the other is
            // decided by AREA, the polygon's analogue of the circular rim's
            // radius test below.
            if (wireKind(w) == WK::Polygon) {
                const std::vector<TopoDS_Vertex> ring = ringOfWire(q.face, w);
                if (ring.size() < 3) FK_DEFER("q_mouth_polygon_ring_short");
                Loop rimL, pinL;
                for (const TopoDS_Vertex& v : ring) {
                    gp_Pnt p;
                    if (!cornerOf(v, p)) FK_DEFER("q_mouth_polygon_corner_missing");
                    rimL.pts.push_back(BRep_Tool::Pnt(v));
                    pinL.pts.push_back(p);
                }
                const gp_Dir N = pl->Position().Direction();
                const bool rimIsOuter = loopArea(rimL, N) > loopArea(pinL, N);
                const Loop& bigL = rimIsOuter ? rimL : pinL;
                const Loop& smlL = rimIsOuter ? pinL : rimL;
                TopoDS_Face lip = planarLoopFace(pl, bigL, {smlL});
                if (lip.IsNull()) FK_DEFER("q_lip_polygon_face_fail");
                lip.Orientation(q.face.Orientation());
                sew.Add(lip);
                continue;
            }

            TopExp_Explorer ee(w, TopAbs_EDGE);
            if (!ee.More()) FK_DEFER("q_mouth_wire_no_edge");
            const TopoDS_Edge e = TopoDS::Edge(ee.Current());
            const int ei = edgeIdx.FindIndex(e);
            if (ei == 0 || !offOk[static_cast<std::size_t>(ei) - 1]) FK_DEFER("q_mouth_no_offset_circle");
            gp_Circ rim;
            if (!edgeFullCircle(e, rim)) FK_DEFER("q_mouth_rim_not_circle");

            // A RISER edge's lip band is degenerate — the rim and its image share
            // a radius — and the wall is closed by a cylinder instead. Step 3.
            if (riser[static_cast<std::size_t>(ei) - 1]) {
                const gp_Circ& top = offCirc[static_cast<std::size_t>(ei) - 1];
                const gp_Dir Ad = rim.Axis().Direction();
                const double zoff = gp_Vec(rim.Location(), top.Location()).Dot(gp_Vec(Ad));
                Handle(Geom_CylindricalSurface) cyl = new Geom_CylindricalSurface(
                    gp_Ax3(rim.Location(), Ad, rim.Position().XDirection()), rim.Radius());
                BRepBuilderAPI_MakeFace mkr(cyl, 0.0, 2.0 * kPi,
                                            std::min(0.0, zoff), std::max(0.0, zoff),
                                            Precision::Confusion());
                if (!mkr.IsDone()) FK_DEFER("q_riser_makeface_fail");
                TopoDS_Face rf = mkr.Face();

                // ORIENTATION IS DERIVED, not tried. A Geom_CylindricalSurface's
                // parametric normal dP/du x dP/dv is +rhat for every u, so a
                // FORWARD riser points AWAY from the axis. The wall sits under
                // the RETAINED coplanar face, so the material is inside the
                // circle exactly when that face's region is — that is, when the
                // circle is its OUTER wire.
                QF* ret = nullptr;
                for (TopTools_ListIteratorOfListOfShape rt(efMap.FindFromKey(e)); rt.More(); rt.Next()) {
                    QF* qq = qOf(rt.Value());
                    if (qq && !qq->removed) ret = qq;
                }
                if (!ret) FK_DEFER("q_riser_no_retained_neighbour");
                const TopoDS_Wire rw = BRepTools::OuterWire(ret->face);
                if (rw.IsNull()) FK_DEFER("q_riser_no_outer_wire");
                bool onOuter = false;
                for (TopExp_Explorer re(rw, TopAbs_EDGE); re.More(); re.Next())
                    if (re.Current().IsSame(e)) { onOuter = true; break; }
                rf.Orientation(onOuter ? TopAbs_FORWARD : TopAbs_REVERSED);
                sew.Add(rf);
                continue;
            }

            const gp_Circ& pin = offCirc[static_cast<std::size_t>(ei) - 1];
            // The band always runs between the rim and its pinned image; which of
            // the two is the outer boundary depends on whether this wire bounds
            // material from inside (an outer rim) or outside (a hole rim).
            const bool rimIsOuter = rim.Radius() > pin.Radius();
            const gp_Circ& big = rimIsOuter ? rim : pin;
            const gp_Circ& sml = rimIsOuter ? pin : rim;
            TopoDS_Face lip = lipFace(q.face, pl, big, {sml});
            if (lip.IsNull()) FK_DEFER("q_lip_face_fail");
            sew.Add(lip);
        }
    }

    sew.Perform();
    if (sew.NbFreeEdges() != 0) FK_DEFER("q_sew_free_edges");
    TopoDS_Shape sewed = sew.SewedShape();
    if (sewed.IsNull()) FK_DEFER("q_sew_null");

    TopoDS_Shell shell;
    int nShells = 0;
    for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
        shell = TopoDS::Shell(ex.Current());
        ++nShells;
    }
    if (nShells != 1 || shell.IsNull()) FK_DEFER("q_sew_shell_count");

    TopoDS_Solid solid = forge::occtheal::solidFromShell(shell);
    if (solid.IsNull()) FK_DEFER("q_solid_from_shell_fail");
    BRepLib::SameParameter(solid, std::max(tol, 1.0e-6), Standard_True);

    // SELF-CHECK: a wall is a strict subset of the original body.
    GProp_GProps pw, po;
    BRepGProp::VolumeProperties(solid, pw);
    BRepGProp::VolumeProperties(shape, po);
    const double vw = pw.Mass(), vo = std::fabs(po.Mass());
    if (!(vw > 1.0e-9) || vw > vo * (1.0 + 1.0e-9)) FK_DEFER("q_wall_volume_check");
    return solid;
}

// ===========================================================================
//   PART 5 — the ORIGINAL planar/prismatic path (unchanged)
// ===========================================================================

// Where does a vertex GO under the offset, when its incident offset planes do
// not pin a point? intersectPlanes answers only the rank-3 case (a polyhedral
// apex). Real imported solids also carry IMPRINT vertices, where a planar face
// has been split into coplanar patches and the vertex where those split lines
// meet touches ONE distinct plane, or lies interior to a straight crease and
// touches TWO. MEASURED on the 600-part corpus: 198 parts had such a vertex,
// every one of them rank 1.
//
// All three ranks are the same operation — the ORTHOGONAL PROJECTION of the
// original vertex onto the intersection of its incident OFFSET planes:
//   rank 3  a point   -> the unique apex, identical to intersectPlanes
//   rank 2  a line    -> the point of the offset crease nearest v, which is v
//                        carried across by the perpendicular translation that
//                        maps the straight crease to its offset
//   rank 1  a plane   -> v + dist * n, the vertex riding its own face
// and each is EXACT, not a fallback: an imprint vertex is not a corner, so it
// has no corner to solve.
//
// Computed by Gram-Schmidt from v, so every accepted constraint is satisfied by
// construction and the moves are mutually orthogonal (which is what makes the
// result the projection). A plane that is DEPENDENT on the ones already
// accepted must agree with them to `resTol` or the corner is over-determined —
// two parallel offset planes at different heights, say — and that is declined,
// never averaged. This is the same rejection intersectPlanes' caller made with
// its residual loop, now covering rank 1 and 2 as well.
bool projectOntoOffsetPlanes(const std::vector<Plane>& planes, const gp_Pnt& v,
                             double resTol, gp_Pnt& out) {
    if (planes.empty()) return false;
    double x[3] = {v.X(), v.Y(), v.Z()};
    double basis[3][3];
    int rank = 0;
    for (const Plane& p : planes) {
        double u[3] = {p.nx, p.ny, p.nz};
        for (int j = 0; j < rank; ++j) {
            const double dp = u[0] * basis[j][0] + u[1] * basis[j][1] + u[2] * basis[j][2];
            u[0] -= dp * basis[j][0]; u[1] -= dp * basis[j][1]; u[2] -= dp * basis[j][2];
        }
        const double un = std::sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]);
        const double t  = p.d - (p.nx * x[0] + p.ny * x[1] + p.nz * x[2]);
        if (un < 1.0e-6) {                 // dependent on what is already accepted
            if (std::fabs(t) > resTol) return false;   // and inconsistent with it
            continue;
        }
        if (rank == 3) return false;       // cannot happen: rank 3 spans R^3
        const double e[3] = {u[0] / un, u[1] / un, u[2] / un};
        const double step = t / un;        // p.n . e == un, by construction
        x[0] += step * e[0]; x[1] += step * e[1]; x[2] += step * e[2];
        basis[rank][0] = e[0]; basis[rank][1] = e[1]; basis[rank][2] = e[2];
        ++rank;
    }
    out.SetCoord(x[0], x[1], x[2]);
    return true;
}
TopoDS_Shape planarThickSolid(const TopoDS_Shape& shape, double t,
                              const TopTools_MapOfShape& removedSet, double tol) {
    const TopoDS_Shape kNull;

    // Zero openings => a fully-closed void (two-shell solid) — HONEST DEFER.
    if (removedSet.IsEmpty()) FK_DEFER("p_no_mouth_face");

    // ---- 1. gather faces; every one must be a Geom_Plane (else defer) ----
    std::vector<TopoDS_Face> allFaces;
    std::vector<Plane> outward;   // outward plane per face (parallel to allFaces)
    std::vector<bool> removed;    // is this face an opening?
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face f = TopoDS::Face(ex.Current());
        Plane pl;
        if (!outwardPlaneOf(f, pl)) FK_DEFER("p_face_not_plane");  // non-planar => defer
        allFaces.push_back(f);
        outward.push_back(pl);
        removed.push_back(removedSet.Contains(f));
    }
    if (allFaces.size() < 4) FK_DEFER("p_fewer_than_four_faces");  // not a solid we can hollow

    // ---- 1b. thickness guard vs the solid's minimum half-extent ----
    TopTools_IndexedMapOfShape vmapAll;
    TopExp::MapShapes(shape, TopAbs_VERTEX, vmapAll);
    if (vmapAll.Extent() == 0) FK_DEFER("p_no_vertices");
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
    if (t >= halfMin) FK_DEFER("p_wall_ge_half_extent");  // inner offset would collapse => defer

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
            if (nContrib == 0) FK_DEFER("p_corner_no_retained_face");
            double n = std::sqrt(navg[0]*navg[0] + navg[1]*navg[1] + navg[2]*navg[2]);
            if (n < 1e-12) FK_DEFER("p_corner_normal_degenerate");
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
        if (ring.size() < 3) FK_DEFER("p_ring_shorter_than_three");

        if (!removed[fi]) {
            // Outer face: unchanged (an inward hollow keeps the outer boundary).
            sew.Add(f);
            ++nOuter;
            // Inner face: the offset-plane meet corners, wound REVERSE so the
            // inner normal points into the cavity.
            BRepBuilderAPI_MakePolygon poly;
            for (auto it = ring.rbegin(); it != ring.rend(); ++it) {
                gp_Pnt ip;
                if (!innerOf(*it, ip)) FK_DEFER("p_inner_corner_missing");
                poly.Add(ip);
            }
            poly.Close();
            if (!poly.IsDone()) FK_DEFER("p_inner_polygon_fail");
            BRepBuilderAPI_MakeFace mkf(poly.Wire(), Standard_True);
            if (!mkf.IsDone()) FK_DEFER("p_inner_makeface_fail");
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
                if (!innerOf(va, ia) || !innerOf(vb, ib)) FK_DEFER("p_lip_corner_missing");
                BRepBuilderAPI_MakePolygon quad;
                quad.Add(oa); quad.Add(ob); quad.Add(ib); quad.Add(ia);
                quad.Close();
                if (!quad.IsDone()) FK_DEFER("p_lip_polygon_fail");
                BRepBuilderAPI_MakeFace mkq(quad.Wire(), Standard_True);
                if (!mkq.IsDone()) FK_DEFER("p_lip_makeface_fail");
                sew.Add(mkq.Face());
                ++nLip;
            }
        }
    }
    if (nInner == 0 || nOuter == 0) FK_DEFER("p_no_inner_or_no_outer");

    // ---- 5b. sew into one shell; must be watertight (no free edges) ----
    sew.Perform();
    if (sew.NbFreeEdges() != 0) FK_DEFER("p_sew_free_edges");  // not closed => honest defer
    TopoDS_Shape sewed = sew.SewedShape();
    if (sewed.IsNull()) FK_DEFER("p_sew_null");

    TopoDS_Shell shell;
    int nShells = 0;
    for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
        shell = TopoDS::Shell(ex.Current());
        ++nShells;
    }
    if (nShells != 1 || shell.IsNull()) FK_DEFER("p_sew_shell_count");  // want ONE connected wall

    // ---- 5c. orient into a valid positive-volume solid ----
    // Native ShapeFix_Solid::SolidFromShell subset (TKShHealing-free):
    // BRepBuilderAPI_MakeSolid + signed-volume outward flip.
    TopoDS_Solid solid = forge::occtheal::solidFromShell(shell);
    if (solid.IsNull()) FK_DEFER("p_solid_from_shell_fail");

    GProp_GProps props;
    BRepGProp::VolumeProperties(solid, props);
    double vol = props.Mass();
    if (std::fabs(vol) < 1e-12) FK_DEFER("p_zero_volume");  // degenerate volume -> honest defer
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

// ---- MIXED planar+quadric support (family H only) --------------------------
//
// The quadric path admits a PLANAR face only when every one of its wires is a
// single full circle. That is an annulus, and it is why a plate with a drilled
// hole -- a polygon boundary plus a circular hole -- was declined even though
// every piece of its offset is already closed-form here: the polygon boundary
// is the PLANAR path's corner solve (intersectPlanes over the incident offset
// planes) and the hole is the quadric path's own offsetCircle. What was missing
// was a face builder that can carry BOTH kinds of loop, which is this.
//
// Nothing about the two solves changes. A loop is either an exact gp_Circ or an
// ordered ring of corner points each of which is the EXACT meet of three or more
// offset planes; no loop is ever sampled or fitted.

// One boundary loop of an offset planar face.
struct OffLoop {
    bool                isCircle = false;
    gp_Circ             circ;
    std::vector<gp_Pnt> poly;      // ordered, first point NOT repeated
};

// Signed area of a loop about +N (Newell for the polygon case, exact for the
// circle case). The SIGN is the winding, which is what the face builder needs.
double loopArea(const OffLoop& L, const gp_Dir& N) {
    if (L.isCircle) {
        const double a = kPi * L.circ.Radius() * L.circ.Radius();
        return (L.circ.Axis().Direction().Dot(N) >= 0.0) ? a : -a;
    }
    double nx = 0.0, ny = 0.0, nz = 0.0;
    const std::size_t n = L.poly.size();
    for (std::size_t i = 0; i < n; ++i) {
        const gp_Pnt& a = L.poly[i];
        const gp_Pnt& b = L.poly[(i + 1) % n];
        nx += (a.Y() - b.Y()) * (a.Z() + b.Z());
        ny += (a.Z() - b.Z()) * (a.X() + b.X());
        nz += (a.X() - b.X()) * (a.Y() + b.Y());
    }
    return 0.5 * (nx * N.X() + ny * N.Y() + nz * N.Z());
}

// The loop's own radius about its centroid — the scale a planarity residual has
// to be judged against, so a 1000 mm part is not held to a 1 mm part's slack.
double loopScale(const OffLoop& L) {
    if (L.isCircle) return L.circ.Radius();
    if (L.poly.empty()) return 0.0;
    double cx = 0, cy = 0, cz = 0;
    for (const gp_Pnt& p : L.poly) { cx += p.X(); cy += p.Y(); cz += p.Z(); }
    const double n = static_cast<double>(L.poly.size());
    const gp_Pnt c(cx / n, cy / n, cz / n);
    double r = 0.0;
    for (const gp_Pnt& p : L.poly) r = std::max(r, c.Distance(p));
    return r;
}

TopoDS_Wire loopWire(const OffLoop& L, const gp_Dir& N, bool ccwAboutN) {
    if (L.isCircle) {
        gp_Dir a = N;
        if (!ccwAboutN) a.Reverse();
        const gp_Circ c(gp_Ax2(L.circ.Location(), a, L.circ.Position().XDirection()),
                        L.circ.Radius());
        return circleWire(c);
    }
    std::vector<gp_Pnt> pts = L.poly;
    if ((loopArea(L, N) > 0.0) != ccwAboutN) std::reverse(pts.begin(), pts.end());
    BRepBuilderAPI_MakePolygon mp;
    for (const gp_Pnt& p : pts) mp.Add(p);
    mp.Close();
    if (!mp.IsDone()) return TopoDS_Wire();
    return mp.Wire();
}

// Build a planar face on `pl` bounded by `outer` with `holes` punched out, where
// each loop is a circle or a polygon, and SELF-CHECK its area against the closed
// form |A(outer)| - sum |A(hole)|. A wrong hole winding shows up as a wrong area,
// so this both fixes and verifies orientation — the same contract as
// planarCircularFace, which stays the path for the all-circle case so that
// family H's existing successes are built by byte-identical code.
TopoDS_Face planarMixedFace(const Handle(Geom_Plane)& pl,
                            const OffLoop& outer,
                            const std::vector<OffLoop>& holes) {
    const gp_Dir N = pl->Position().Direction();
    const gp_Pln pln = pl->Pln();

    auto inPlane = [&](const OffLoop& L) {
        const double slack = kGeo * std::max(1.0, loopScale(L));
        if (L.isCircle)
            return dirParallel(L.circ.Axis().Direction(), N) &&
                   pln.Distance(L.circ.Location()) < slack;
        if (L.poly.size() < 3) return false;
        for (const gp_Pnt& p : L.poly)
            if (pln.Distance(p) > slack) return false;
        return true;
    };
    if (!inPlane(outer)) return TopoDS_Face();
    for (const OffLoop& h : holes) if (!inPlane(h)) return TopoDS_Face();

    double want = std::fabs(loopArea(outer, N));
    for (const OffLoop& h : holes) want -= std::fabs(loopArea(h, N));
    if (want <= 1.0e-12) return TopoDS_Face();

    for (int flip = 0; flip < 2; ++flip) {
        const TopoDS_Wire ow = loopWire(outer, N, true);
        if (ow.IsNull()) return TopoDS_Face();
        BRepBuilderAPI_MakeFace mk(pl, ow, Standard_True);
        if (!mk.IsDone()) return TopoDS_Face();
        bool ok = true;
        for (const OffLoop& h : holes) {
            const TopoDS_Wire hw = loopWire(h, N, flip == 1);
            if (hw.IsNull()) { ok = false; break; }
            mk.Add(hw);
        }
        if (!ok || !mk.IsDone()) continue;
        TopoDS_Face f = mk.Face();
        f.Orientation(TopAbs_FORWARD);   // FORWARD == outward normal is +N
        GProp_GProps g;
        BRepGProp::SurfaceProperties(f, g);
        if (std::fabs(g.Mass() - want) < 1.0e-6 * std::max(1.0, want)) return f;
    }
    return TopoDS_Face();
}

// Is `e` a straight LINE segment? (The basis curve, so a trimmed line counts.)
bool edgeIsLine(const TopoDS_Edge& e) {
    if (BRep_Tool::Degenerated(e)) return false;
    double f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = edgeBasisCurve(e, f, l);
    return !c.IsNull() && !Handle(Geom_Line)::DownCast(c).IsNull();
}

// Ordered vertices of ONE wire of a face (wire order, each vertex once).
std::vector<TopoDS_Vertex> orderedRingOfWire(const TopoDS_Wire& w, const TopoDS_Face& f) {
    std::vector<TopoDS_Vertex> ring;
    for (BRepTools_WireExplorer wex(w, f); wex.More(); wex.Next())
        ring.push_back(wex.CurrentVertex());
    return ring;
}

// A wire's shape for the mixed guard: exactly one full circle, a ring of >=3
// straight lines, or neither (which is a defer).
enum class LoopKind { Circle, Polygon, Neither };

LoopKind classifyWire(const TopoDS_Wire& w, gp_Circ& circOut) {
    int nE = 0, nLine = 0, nCirc = 0;
    gp_Circ c;
    for (TopExp_Explorer ee(w, TopAbs_EDGE); ee.More(); ee.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ee.Current());
        ++nE;
        if (edgeIsLine(e)) ++nLine;
        else if (edgeFullCircle(e, c)) ++nCirc;
    }
    if (nE == 1 && nCirc == 1) { circOut = c; return LoopKind::Circle; }
    if (nE >= 3 && nLine == nE) return LoopKind::Polygon;
    return LoopKind::Neither;
}


// ---- family H's final gate: a self-intersecting offset is a WRONG ANSWER ----
// The sharp join slides every face by `dist` and re-meets. On a solid whose
// features are closer together than 2*dist that construction is exact face by
// face and yet the assembled shape overlaps itself -- two boss circles on one
// planar face grow past each other, and the face's area self-check still passes
// because Green's theorem sums the loops regardless of whether they cross.
// MEASURED: 12 of 36 corpus results were BRepCheck INVALID with
// IntersectingWires, from inputs that were all valid. This engine's contract is
// that a defer is never a wrong answer, so those become defers.
// BRepCheck_Analyzer is TKTopAlgo, the same toolkit this file already calls
// BRepBuilderAPI_Sewing in, so the OCCT closure is unchanged.
bool offsetResultIsSound(const TopoDS_Shape& s) {
    try { return BRepCheck_Analyzer(s).IsValid() == Standard_True; }
    catch (...) { return false; }
}

// ---- planar / prismatic: offset the Hesse planes, re-meet at every vertex ----
TopoDS_Shape planarOffsetShape(const TopoDS_Shape& shape, double dist, double tol) {
    const TopoDS_Shape kNull;

    std::vector<TopoDS_Face> faces;
    std::vector<Plane>       outward;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        Plane pl;
        if (!outwardPlaneOf(f, pl)) return dfr("planar/non_planar_face");      // non-planar => caller's quadric path
        int nWires = 0;
        for (TopoDS_Iterator it(f); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++nWires;
        if (nWires != 1) return dfr("planar/face_has_hole");                 // face with a hole => defer
        faces.push_back(f);
        outward.push_back(pl);
    }
    if (faces.size() < 4) return dfr("planar/fewer_than_4_faces");                // not a closed polyhedron

    // SHRINK GUARD: an inward offset at least as deep as the smallest half-extent
    // collapses the body. A grow has no such bound.
    if (dist < 0.0) {
        TopTools_IndexedMapOfShape vmapAll;
        TopExp::MapShapes(shape, TopAbs_VERTEX, vmapAll);
        if (vmapAll.Extent() == 0) return dfr("planar/no_vertices");
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
        if (-dist >= halfMin) return dfr("planar/shrink_exceeds_half_extent");
    }

    TopTools_IndexedDataMapOfShapeListOfShape vfMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_FACE, vfMap);
    TopTools_IndexedMapOfShape faceIndex;
    for (const TopoDS_Face& f : faces) faceIndex.Add(f);

    const int nV = vfMap.Extent();
    if (nV == 0) return dfr("planar/no_vertex_face_map");
    std::vector<gp_Pnt> moved(static_cast<std::size_t>(nV));
    const double resTol = 1.0e-7 * std::max(1.0, std::fabs(dist));
    for (int i = 1; i <= nV; ++i) {
        std::vector<Plane> meet;
        for (TopTools_ListIteratorOfListOfShape it(vfMap.FindFromIndex(i)); it.More(); it.Next()) {
            const int fi = faceIndex.FindIndex(it.Value());
            if (fi == 0) return dfr("planar/vertex_face_not_indexed");
            Plane p = outward[static_cast<std::size_t>(fi) - 1];
            p.d += dist;                               // slide OUTWARD by signed dist
            meet.push_back(p);
        }
        if (meet.size() < 3) return dfr("planar/corner_under_3_planes");             // no exact corner to meet
        gp_Pnt corner;
        if (!intersectPlanes(meet, corner)) return dfr("planar/corner_rank_deficient");   // rank-deficient
        // EXACTNESS: the least-squares meet is only the offset corner if EVERY
        // incident offset plane actually contains it. An over-determined apex
        // where it does not is declined, never approximated.
        for (const Plane& p : meet) {
            const double r = p.nx * corner.X() + p.ny * corner.Y() + p.nz * corner.Z() - p.d;
            if (std::fabs(r) > resTol) return dfr("planar/corner_overdetermined_residual");
        }
        moved[static_cast<std::size_t>(i) - 1] = corner;
    }

    // Rebuild every face over its own ring of moved corners. Orientation is left
    // to the sew + solidFromShell pair (as planarThickSolid does): the wires fix
    // the region, the signed-volume flip fixes the side.
    BRepBuilderAPI_Sewing sew(std::max(tol, 1.0e-6));
    for (const TopoDS_Face& f : faces) {
        const std::vector<TopoDS_Vertex> ring = orderedRing(f);
        if (ring.size() < 3) return dfr("planar/face_ring_under_3");
        BRepBuilderAPI_MakePolygon poly;
        for (const TopoDS_Vertex& v : ring) {
            const int idx = vfMap.FindIndex(v);
            if (idx == 0) return dfr("planar/ring_vertex_not_indexed");
            poly.Add(moved[static_cast<std::size_t>(idx) - 1]);
        }
        poly.Close();
        if (!poly.IsDone()) return dfr("planar/polygon_not_done");
        BRepBuilderAPI_MakeFace mkf(poly.Wire(), Standard_True);
        if (!mkf.IsDone()) return dfr("planar/face_collapsed");               // face collapsed under the offset
        sew.Add(mkf.Face());
    }

    sew.Perform();
    if (sew.NbFreeEdges() != 0) return dfr("planar/sew_free_edges");          // not watertight => defer
    const TopoDS_Shape sewed = sew.SewedShape();
    if (sewed.IsNull()) return dfr("planar/sew_null");
    TopoDS_Shell shell;
    int nShells = 0;
    for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
        shell = TopoDS::Shell(ex.Current());
        ++nShells;
    }
    if (nShells != 1 || shell.IsNull()) return dfr("planar/not_single_shell");

    TopoDS_Solid solid = forge::occtheal::solidFromShell(shell);
    if (solid.IsNull()) return dfr("planar/solid_from_shell_failed");
    BRepLib::SameParameter(solid, std::max(tol, 1.0e-6), Standard_True);

    // SELF-CHECK: the sharp join preserves the face count, and the volume must
    // move in the direction of the sign of `dist`.
    int nFaceOut = 0;
    for (TopExp_Explorer ex(solid, TopAbs_FACE); ex.More(); ex.Next()) ++nFaceOut;
    if (nFaceOut != static_cast<int>(faces.size())) return dfr("planar/face_count_changed");

    GProp_GProps pn, po;
    BRepGProp::VolumeProperties(solid, pn);
    BRepGProp::VolumeProperties(shape, po);
    const double vn = std::fabs(pn.Mass()), vo = std::fabs(po.Mass());
    if (!(vn > 1.0e-12)) return dfr("planar/zero_volume");
    if (dist > 0.0 && !(vn > vo)) return dfr("planar/grow_did_not_increase_volume");
    if (dist < 0.0 && !(vn < vo)) return dfr("planar/shrink_did_not_decrease_volume");
    if (!offsetResultIsSound(solid)) return dfr("planar/result_not_valid");
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
        if (q.kind == SK::Other) return dfr("quadric/unsupported_surface");
        BRepTools::UVBounds(f, q.u1, q.u2, q.v1, q.v2);
        q.nv1 = q.v1; q.nv2 = q.v2;

        gp_Pnt P; gp_Dir outward;
        if (!faceSample(f, q.surf, q.u1, q.u2, q.v1, q.v2, P, outward)) return dfr("quadric/face_sample_failed");
        const gp_Vec disp = gp_Vec(outward) * dist;    // ALONG the outward normal
        q.off = offsetSurfaceOf(q.surf, q.kind, P, disp, t);
        if (q.off.IsNull()) return dfr("quadric/offset_surface_null");
        qf.push_back(q);
    }
    if (qf.empty()) return dfr("quadric/no_faces");

    auto qOf = [&](const TopoDS_Shape& f) -> QF* {
        const int i = faceIdx.FindIndex(f);
        if (i == 0) return nullptr;
        return &qf[static_cast<std::size_t>(i) - 1];
    };

    // ---- 2. structural admissibility ---------------------------------------
    // A planar face's wire may be a single full CIRCLE (the annulus this path
    // has always built) or a ring of straight LINES (the polygon the PLANAR
    // path's corner solve already offsets exactly). Anything else -- an arc, a
    // spline, a mixed line/arc profile -- is still declined, never approximated.
    for (const QF& q : qf) {
        int nWires = 0;
        for (TopoDS_Iterator it(q.face); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++nWires;

        if (q.kind != SK::Plane) {
            if (nWires != 1) return dfr("quadric/curved_face_has_hole");
            if (std::fabs((q.u2 - q.u1) - 2.0 * kPi) > 1.0e-7) return dfr("quadric/curved_face_not_full_revolution");
        } else {
            if (nWires < 1) return dfr("quadric/planar_face_no_wire");
            for (TopoDS_Iterator it(q.face); it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                gp_Circ c;
                if (classifyWire(TopoDS::Wire(it.Value()), c) == LoopKind::Neither)
                    return dfr("quadric/planar_wire_not_polygon_or_circle");
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
    TopTools_IndexedMapOfShape cornerVerts;   // vertices a straight corner edge ends at

    for (int i = 1; i <= efMap.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(i));
        if (BRep_Tool::Degenerated(e)) continue;

        std::vector<QF*> nb;
        for (TopTools_ListIteratorOfListOfShape it(efMap.FindFromIndex(i)); it.More(); it.Next()) {
            QF* q = qOf(it.Value());
            if (!q) return dfr("quadric/edge_face_not_indexed");
            if (std::find(nb.begin(), nb.end(), q) == nb.end()) nb.push_back(q);
        }
        if (nb.size() == 1) continue;                  // seam
        if (nb.size() != 2) return dfr("quadric/edge_non_manifold");              // non-manifold
        QF& A = *nb[0];
        QF& B = *nb[1];

        gp_Circ orig;
        if (!edgeFullCircle(e, orig)) {
            // A straight edge between two PLANES is a polyhedral corner edge: its
            // offset is pinned by the vertex solve in step 3b, not by a circle
            // re-trim, so there is nothing to compute here. A straight edge with a
            // curved neighbour (a tangent seam) has no closed-form offset in this
            // machinery and is declined.
            if (edgeIsLine(e)) {
                if (A.kind != SK::Plane || B.kind != SK::Plane)
                    return dfr("quadric/line_edge_not_between_two_planes");
                for (TopExp_Explorer ev(e, TopAbs_VERTEX); ev.More(); ev.Next())
                    cornerVerts.Add(ev.Current());
                continue;
            }
            return dfr("quadric/edge_not_full_circle");
        }

        gp_Circ oc;
        const char* ocWhy = nullptr;
        if (!offsetCircle(orig, A.surf, A.kind, B.surf, B.kind,
                          A.off, surfKind(A.off), B.off, surfKind(B.off), oc, &ocWhy))
        {
            reasonAdd("quadric/offset_circle_failed");
            if (ocWhy && *ocWhy) reasonAdd(ocWhy);
            return dfr(skPair(A.kind, B.kind));
        }
        offCirc[static_cast<std::size_t>(i) - 1] = oc;
        offOk[static_cast<std::size_t>(i) - 1]   = true;

        for (QF* q : nb) {
            if (q->kind == SK::Plane) continue;
            double vOrig = 0.0, vNew = 0.0;
            if (!vParamOf(q->surf, q->kind, orig, vOrig)) return dfr("quadric/vparam_orig_failed");
            if (!vParamOf(q->off,  q->kind, oc,   vNew))  return dfr("quadric/vparam_offset_failed");
            const bool atLo = std::fabs(vOrig - q->v1) <= std::fabs(vOrig - q->v2);
            if (atLo) { q->nv1 = vNew; q->gotV1 = true; }
            else      { q->nv2 = vNew; q->gotV2 = true; }
        }
    }

    // ---- 3b. the polyhedral corner solve, for straight edges only -----------
    // Verbatim the construction planarOffsetShape uses: slide every incident
    // face's outward Hesse plane by `dist` and meet them. The meet is only the
    // offset corner if EVERY incident offset plane actually contains it, so an
    // over-determined apex (which generally has NO exact sharp-join offset) is
    // declined rather than approximated.
    TopTools_IndexedDataMapOfShapeListOfShape vfMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_FACE, vfMap);
    std::vector<gp_Pnt> moved(static_cast<std::size_t>(std::max(0, vfMap.Extent())));
    std::vector<bool>   movedOk(static_cast<std::size_t>(std::max(0, vfMap.Extent())), false);
    const double resTol = 1.0e-7 * std::max(1.0, std::fabs(dist));
    for (int i = 1; i <= vfMap.Extent(); ++i) {
        if (!cornerVerts.Contains(vfMap.FindKey(i))) continue;
        std::vector<Plane> meet;
        for (TopTools_ListIteratorOfListOfShape it(vfMap.FindFromIndex(i)); it.More(); it.Next()) {
            const TopoDS_Face nf = TopoDS::Face(it.Value());
            const QF* q = qOf(nf);
            if (!q) return dfr("quadric/corner_face_not_indexed");
            if (q->kind != SK::Plane) return dfr("quadric/corner_touches_curved_face");
            Plane pl;
            if (!outwardPlaneOf(nf, pl)) return dfr("quadric/corner_plane_missing");
            pl.d += dist;                              // slide OUTWARD by signed dist
            meet.push_back(pl);
        }
        if (meet.empty()) return dfr("quadric/corner_no_incident_plane");
        gp_Pnt corner;
        const gp_Pnt v0 = BRep_Tool::Pnt(TopoDS::Vertex(vfMap.FindKey(i)));
        if (!projectOntoOffsetPlanes(meet, v0, resTol, corner))
            return dfr("quadric/corner_overdetermined_residual");
        moved[static_cast<std::size_t>(i) - 1] = corner;
        movedOk[static_cast<std::size_t>(i) - 1] = true;
    }

    // ---- 4. build the offset faces on the EXACT offset surfaces -------------
    BRepBuilderAPI_Sewing sew(std::max(tol, 1.0e-6));
    std::vector<TopoDS_Face> built;
    int nAdded = 0;
    for (const QF& q : qf) {
        TopoDS_Face nf;
        if (q.kind == SK::Plane) {
            Handle(Geom_Plane) opl = Handle(Geom_Plane)::DownCast(q.off);
            if (opl.IsNull()) return dfr("quadric/offset_plane_null");
            const TopoDS_Wire outerW = BRepTools::OuterWire(q.face);
            if (outerW.IsNull()) return dfr("quadric/no_outer_wire");
            OffLoop outerL;
            std::vector<OffLoop> holeL;
            bool haveOuter = false, anyPoly = false;
            for (TopoDS_Iterator it(q.face); it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                const TopoDS_Wire w = TopoDS::Wire(it.Value());
                gp_Circ ignored;
                OffLoop L;
                if (classifyWire(w, ignored) == LoopKind::Circle) {
                    TopExp_Explorer ee(w, TopAbs_EDGE);
                    if (!ee.More()) return dfr("quadric/wire_has_no_edge");
                    const int ei = edgeIdx.FindIndex(ee.Current());
                    if (ei == 0 || !offOk[static_cast<std::size_t>(ei) - 1])
                        return dfr("quadric/wire_edge_no_offset_circle");
                    L.isCircle = true;
                    L.circ = offCirc[static_cast<std::size_t>(ei) - 1];
                } else {
                    // A polygon loop: its offset ring is the corner solve's output,
                    // in this wire's own order.
                    anyPoly = true;
                    const std::vector<TopoDS_Vertex> ring = orderedRingOfWire(w, q.face);
                    if (ring.size() < 3) return dfr("quadric/polygon_ring_under_3");
                    for (const TopoDS_Vertex& v : ring) {
                        const int vi = vfMap.FindIndex(v);
                        if (vi == 0 || !movedOk[static_cast<std::size_t>(vi) - 1])
                            return dfr("quadric/polygon_vertex_not_solved");
                        L.poly.push_back(moved[static_cast<std::size_t>(vi) - 1]);
                    }
                }
                if (w.IsSame(outerW)) { outerL = L; haveOuter = true; }
                else                  { holeL.push_back(L); }
            }
            if (!haveOuter) return dfr("quadric/outer_wire_not_found");
            // The all-circle case keeps planarCircularFace, so every result this
            // engine already produced is built by exactly the code that built it.
            if (!anyPoly) {
                std::vector<gp_Circ> holes;
                for (const OffLoop& h : holeL) holes.push_back(h.circ);
                nf = planarCircularFace(opl, outerL.circ, holes);
            } else {
                nf = planarMixedFace(opl, outerL, holeL);
            }
        } else {
            double a = q.nv1, b = q.nv2;
            if (a > b) std::swap(a, b);
            if (!(b - a > 1.0e-9)) return dfr("quadric/vrange_collapsed");       // v-range inverted / collapsed
            BRepBuilderAPI_MakeFace mk(q.off, q.u1, q.u2, a, b, Precision::Confusion());
            if (!mk.IsDone()) return dfr("quadric/makeface_not_done");
            nf = mk.Face();
        }
        if (nf.IsNull()) return dfr("quadric/face_null");
        // Same gp_Ax3 => same parametric normal field, so the ORIGINAL topological
        // orientation still points outward on the offset surface. (The hollow flips
        // here because its cavity normal points the other way; this does not.)
        nf.Orientation(q.face.Orientation());
        built.push_back(nf);
        sew.Add(nf);
        ++nAdded;
    }
    if (nAdded == 0) return dfr("quadric/nothing_built");

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
        if (sew.NbFreeEdges() != 0) return dfr("quadric/sew_free_edges");
        const TopoDS_Shape sewed = sew.SewedShape();
        if (sewed.IsNull()) return dfr("quadric/sew_null");
        int nShells = 0;
        for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
            shell = TopoDS::Shell(ex.Current());
            ++nShells;
        }
        if (nShells != 1 || shell.IsNull()) return dfr("quadric/not_single_shell");
    }

    TopoDS_Solid solid = forge::occtheal::solidFromShell(shell);
    if (solid.IsNull()) return dfr("quadric/solid_from_shell_failed");
    BRepLib::SameParameter(solid, std::max(tol, 1.0e-6), Standard_True);

    int nFaceOut = 0;
    for (TopExp_Explorer ex(solid, TopAbs_FACE); ex.More(); ex.Next()) ++nFaceOut;
    if (nFaceOut != nAdded) return dfr("quadric/face_count_changed");

    GProp_GProps pn, po;
    BRepGProp::VolumeProperties(solid, pn);
    BRepGProp::VolumeProperties(shape, po);
    const double vn = std::fabs(pn.Mass()), vo = std::fabs(po.Mass());
    if (!(vn > 1.0e-12)) return dfr("quadric/zero_volume");
    if (dist > 0.0 && !(vn > vo)) return dfr("quadric/grow_did_not_increase_volume");
    if (dist < 0.0 && !(vn < vo)) return dfr("quadric/shrink_did_not_decrease_volume");
    if (!offsetResultIsSound(solid)) return dfr("quadric/result_not_valid");
    return solid;
}

}  // namespace

// Diagnostic-only. See the FK_DEFER banner at the top of the anonymous
// namespace: reading this cannot change any result, and the string is stale and
// meaningless after a call that SUCCEEDED.
const char* lastThickSolidDeferReason() { return g_tsReason; }

// ===========================================================================
//   PART 6 — the public entry point: dispatch planar vs quadric
// ===========================================================================

TopoDS_Shape makeThickSolid(const TopoDS_Shape& shape, double t,
                            const TopTools_ListOfShape& facesToRemove,
                            double tol) {
    const TopoDS_Shape kNull;  // IsNull() == honest defer
    tsReasonClear();           // diagnostic channel only; see the FK_DEFER banner
    if (shape.IsNull() || t <= 0.0) FK_DEFER("entry_null_shape_or_nonpositive_wall");

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
    if (nFaces == 0) FK_DEFER("entry_no_faces");

    if (allPlanar) return planarThickSolid(shape, t, removedSet, tol);
    return quadricThickSolid(shape, t, removedSet, tol);
}

// ===========================================================================
//   PART 7 — the public entry point for family H: dispatch planar vs quadric
// ===========================================================================

// ONE body: the planar/quadric dispatch. Does NOT clear the defer trail, so the
// multi-body path above can report which body declined and why.
TopoDS_Shape offsetOneBody(const TopoDS_Shape& shape, double dist, double tol) {
    const TopoDS_Shape kNull;
    bool allPlanar = true;
    int nFaces = 0;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        ++nFaces;
        if (surfKind(basisSurface(BRep_Tool::Surface(TopoDS::Face(ex.Current())))) != SK::Plane) {
            allPlanar = false;
            break;
        }
    }
    if (nFaces == 0) return dfr("entry/no_faces");

    if (allPlanar) return planarOffsetShape(shape, dist, tol);
    return quadricOffsetShape(shape, dist, tol);
}

// Vertex-derived bounding box (NOT Bnd_Box, which inflates by the shape
// tolerance and would make a separation test read as satisfied when it is not).
bool bodyBox(const TopoDS_Shape& s, double lo[3], double hi[3]) {
    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        const double c[3] = {p.X(), p.Y(), p.Z()};
        for (int k = 0; k < 3; ++k) {
            if (first) { lo[k] = hi[k] = c[k]; }
            else { lo[k] = std::min(lo[k], c[k]); hi[k] = std::max(hi[k], c[k]); }
        }
        first = false;
    }
    return !first;
}

// MANY bodies in one shape. 271 of the 600 corpus parts import as a compound of
// two or three solids, and the single-shell assembly could never express that:
// the sew produced one shell per body and the "exactly one shell" self-check
// declined every one of them.
//
// Each body is offset on its own and the results are returned as a compound.
// That is the offset of the whole ONLY while the bodies stay apart, so the
// bodies must be SEPARATED by more than 2*|dist| on some axis — the most either
// pair can close by. Bodies that touch, nest, or merely have overlapping boxes
// are DECLINED: their union's offset is a boolean this engine does not do, and
// growing them independently would return interpenetrating bodies, which is a
// wrong answer, not an offset.
TopoDS_Shape offsetManyBodies(const TopTools_IndexedMapOfShape& bodies,
                              double dist, double tol) {
    const TopoDS_Shape kNull;
    const int n = bodies.Extent();
    std::vector<double> lo(static_cast<std::size_t>(3 * n)), hi(static_cast<std::size_t>(3 * n));
    for (int i = 0; i < n; ++i) {
        if (!bodyBox(bodies.FindKey(i + 1), &lo[static_cast<std::size_t>(3 * i)],
                     &hi[static_cast<std::size_t>(3 * i)]))
            return dfr("entry/body_has_no_vertices");
    }
    const double need = 2.0 * std::fabs(dist);
    for (int i = 0; i < n; ++i) {
        for (int j = i + 1; j < n; ++j) {
            double gap = -1.0;
            for (int k = 0; k < 3; ++k) {
                const double a = lo[static_cast<std::size_t>(3 * j + k)] - hi[static_cast<std::size_t>(3 * i + k)];
                const double b = lo[static_cast<std::size_t>(3 * i + k)] - hi[static_cast<std::size_t>(3 * j + k)];
                gap = std::max(gap, std::max(a, b));
            }
            if (!(gap > need)) return dfr("entry/bodies_not_separated_by_2dist");
        }
    }

    BRep_Builder bb;
    TopoDS_Compound comp;
    bb.MakeCompound(comp);
    double vIn = 0.0, vOut = 0.0;
    for (int i = 1; i <= n; ++i) {
        const TopoDS_Shape& body = bodies.FindKey(i);
        const TopoDS_Shape r = offsetOneBody(body, dist, tol);
        if (r.IsNull()) return kNull;             // the trail already names the guard
        GProp_GProps gi, go;
        BRepGProp::VolumeProperties(body, gi);
        BRepGProp::VolumeProperties(r, go);
        vIn  += std::fabs(gi.Mass());
        vOut += std::fabs(go.Mass());
        bb.Add(comp, r);
    }
    if (!(vOut > 1.0e-12)) return dfr("entry/multibody_zero_volume");
    if (dist > 0.0 && !(vOut > vIn)) return dfr("entry/multibody_grow_did_not_increase_volume");
    if (dist < 0.0 && !(vOut < vIn)) return dfr("entry/multibody_shrink_did_not_decrease_volume");
    return comp;
}

TopoDS_Shape offsetSolidShape(const TopoDS_Shape& shape, double dist, double tol) {
    const TopoDS_Shape kNull;   // IsNull() == honest defer
    reasonClear();              // one trail per public call, never a stale one
    if (shape.IsNull()) return dfr("entry/null_shape");
    if (std::fabs(dist) < 1.0e-12) return dfr("entry/zero_distance");

    TopTools_IndexedMapOfShape bodies;
    TopExp::MapShapes(shape, TopAbs_SOLID, bodies);
    if (bodies.Extent() > 1) return offsetManyBodies(bodies, dist, tol);

    return offsetOneBody(shape, dist, tol);
}

const char* lastOffsetDeferReason() { return g_reason; }

}  // namespace occtoffset
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
