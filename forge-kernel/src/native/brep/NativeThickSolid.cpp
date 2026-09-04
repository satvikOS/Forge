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
#include <Geom2d_Line.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2d.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Lin2d.hxx>
#include <gp_Pnt2d.hxx>
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
#include <cstdlib>
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

// ───────────────────────────────────────────────────────────────────────────
// ★ DIAGNOSTIC PROBE — FORGE_TS_PROBE_SKIP_WIREKIND. NOT A CAPABILITY SWITCH.
//
// THE QUESTION IT ANSWERS. 142 of 600 corpus parts stop at ONE rung, the planar
// wire rule, and 105 of them are the deletion bucket. Whether lifting that rule
// is worth one increment or three cannot be read off that number: this
// programme has already measured a case where suppressing the SAME rung freed
// exactly ZERO parts because a second rung bound immediately behind it
// (reports/TKOFFSET_GH_DEFER_CENSUS.md, "The prize — and the trap in reading a
// first-binding rung as one"). Guessing here would repeat that error.
//
// ★★ IT CANNOT PRODUCE A SHAPE, BY CONSTRUCTION. With the variable set, the
//   wire rule records its label and lets the ladder WALK ON so the next binding
//   rung can be read — and BOTH success returns of quadricThickSolid then defer
//   with `probe_would_have_built` instead of returning the solid. A relaxed
//   precondition without its downstream build produces a plausible WRONG
//   answer, so this probe is wired so that "plausible wrong answer" is not a
//   reachable state: the only outcomes are a defer label or the literal string
//   `probe_would_have_built`, which is a statement about the LADDER and never a
//   statement that the geometry is right.
//
// It is read once, cached, and defaults OFF, so an unset environment is exactly
// the shipping behaviour.
inline bool tsProbeSkipWireKind() {
    static const bool on = [] {
        const char* v = std::getenv("FORGE_TS_PROBE_SKIP_WIREKIND");
        return v && v[0] == '1';
    }();
    return on;
}
#define FK_PROBE_STOP() do { if (tsProbeSkipWireKind()) FK_DEFER("probe_would_have_built"); } while (0)

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
    // Family H only. A straight edge on a curved face is a RULING, so it pins a
    // U bound exactly as a circle edge pins a V bound. It is carried separately
    // from v because it moves only on the CROSS-SECTION MEET (see offsetRuling):
    // a co-surface split and a tangent seam both leave it at delta == 0, which is
    // why every result this engine already produced keeps its original u range to
    // the last bit rather than being re-derived through an atan2.
    double               nu1 = 0, nu2 = 0;                 // re-trimmed u bounds
    bool                 gotU1 = false, gotU2 = false;
    gp_Pnt               smp;       // a point KNOWN to be on the face (faceSample)
    bool                 notched = false;   // family H: >2 rulings => not a u-v rectangle
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
//
// ★ THE LABEL IS PART OF THE GUARD. This routine used to `return false` and let
//   the caller return a null face with NO reason recorded, so the whole class
//   surfaced in the corpus census as a bare `q_inner_face_null` — 28 of 600
//   parts, 23 of them in the deletion bucket, with nothing to say WHICH
//   constraint failed or by how much. That is the same defect the THICKSOLID
//   attribution report names as its own top lesson ("the cheapest attribution is
//   the engine's own guard text"), reproduced one level down. It now carries the
//   two distances that decided it, so a reader can tell a genuine merge from a
//   mis-signed offset radius without rebuilding anything.
//   BEHAVIOUR IS UNCHANGED: the same inputs return false, and a defer stays a
//   defer. Only the note string differs.
bool circlesNest(const gp_Circ& outer, const std::vector<gp_Circ>& holes) {
    static thread_local char lbl[160];
    for (std::size_t i = 0; i < holes.size(); ++i) {
        const double d = outer.Location().Distance(holes[i].Location());
        if (!(d + holes[i].Radius() < outer.Radius() - kGeo)) {
            std::snprintf(lbl, sizeof lbl,
                          "cn_hole_escapes_rim_d%.4g_rh%.4g_Ro%.4g_over%.4g",
                          d, holes[i].Radius(), outer.Radius(),
                          d + holes[i].Radius() - outer.Radius());
            tsReasonAdd(lbl);
            return false;
        }
        for (std::size_t j = i + 1; j < holes.size(); ++j) {
            const double dij = holes[i].Location().Distance(holes[j].Location());
            if (!(dij > holes[i].Radius() + holes[j].Radius() + kGeo)) {
                std::snprintf(lbl, sizeof lbl,
                              "cn_holes_overlap_d%.4g_ri%.4g_rj%.4g_over%.4g",
                              dij, holes[i].Radius(), holes[j].Radius(),
                              holes[i].Radius() + holes[j].Radius() - dij);
                tsReasonAdd(lbl);
                return false;
            }
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
        if (ow.IsNull()) { tsReasonAdd("pcf_outer_circle_wire_null"); return TopoDS_Face(); }
        BRepBuilderAPI_MakeFace mk(pl, ow, Standard_True);
        if (!mk.IsDone()) { tsReasonAdd("pcf_makeface_outer_fail"); return TopoDS_Face(); }
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
                if (wireKind(TopoDS::Wire(it.Value())) == WK::Other) {
                    if (!tsProbeSkipWireKind())
                        FK_DEFER("q_planar_wire_not_circle_or_polygon");
                    tsReasonAdd("probe_relaxed_q_planar_wire_not_circle_or_polygon");
                }
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
        FK_PROBE_STOP();
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
    FK_PROBE_STOP();
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

// One SEGMENT of a mixed offset loop: a straight run to `end`, or an ARC of
// `circ` to `end`. `ccw` is the traversal sense about the loop's face normal +N,
// which is what decides which of the two arcs of `circ` between the endpoints is
// meant. A segment is never sampled: `circ` is the EXACT offset supporting
// circle offsetCircle() returned, and both endpoints are EXACT vertex solves.
struct OffSeg {
    bool    isArc = false;
    gp_Circ circ;                  // supporting circle when isArc
    gp_Pnt  start;
    gp_Pnt  end;
    bool    ccw = true;            // arc sense about +N
    // The arc's EXACT sweep, carried from the original edge's own parameter
    // range. Recovering it from the chord is ambiguous at exactly pi — the two
    // endpoints of a semicircle are antiparallel about the centre, so the cross
    // product that decides the sense is ZERO and its sign is round-off. A full
    // circle split into two half-arcs is the commonest thing in a STEP file, so
    // that ambiguity is not a corner case; it is measured on ho137/ho310/ho627.
    double  sweep = 0.0;           // > 0 when known exactly
};

// One boundary loop of an offset planar face.
//
// THREE forms, and the third is why this struct grew. `isCircle` is one full
// circle (a drilled bore's rim); `poly` is a ring of corner points (a prismatic
// boundary); `segs` is a MIXED profile that alternates straight runs and arcs —
// the rounded-corner plate, the slot, and the full circle a coplanar imprint has
// split into two arcs. A mixed profile must NOT be flattened into `poly`: the
// chord of a rounded corner is a CHAMFER, a different solid whose volume is
// within a fraction of a percent of the right one, so a volume self-check would
// not see the substitution. It is carried as arcs or it is declined.
struct OffLoop {
    bool                isCircle = false;
    gp_Circ             circ;
    std::vector<gp_Pnt> poly;      // ordered, first point NOT repeated
    std::vector<OffSeg> segs;      // ordered mixed profile; empty unless isMixed
    bool                isMixed = false;
};

// Signed sweep of the arc from `start` to `end` about +N, in (0, 2*pi).
double arcSweep(const OffSeg& g, const gp_Dir& N) {
    if (g.sweep > 0.0) return g.sweep;          // exact, from the original edge
    const gp_Pnt  C = g.circ.Location();
    const gp_Dir  A = g.circ.Axis().Direction();
    gp_Vec u(C, g.start), v(C, g.end);
    const double du = u.Magnitude(), dv = v.Magnitude();
    if (du < 1.0e-12 || dv < 1.0e-12) return 0.0;
    u.Divide(du); v.Divide(dv);
    double c = u.Dot(v);
    if (c > 1.0) c = 1.0;
    if (c < -1.0) c = -1.0;
    double th = std::acos(c);                       // in [0, pi]
    // Which side of the chord does the arc run? The cross product's component
    // along the circle axis gives the sense of the SHORT arc; the requested
    // sense (`ccw` about +N) decides whether the long arc is meant instead.
    const double sgn = u.Crossed(v).Dot(gp_Vec(A));
    const bool shortIsCcwAboutA = sgn > 0.0;
    const bool axisWithN = A.Dot(gp_Vec(N)) >= 0.0;
    const bool shortIsCcwAboutN = axisWithN ? shortIsCcwAboutA : !shortIsCcwAboutA;
    if (shortIsCcwAboutN != g.ccw) th = 2.0 * kPi - th;
    return th;
}

// Signed area of a loop about +N (Newell for the polygon case, exact for the
// circle case). The SIGN is the winding, which is what the face builder needs.
double loopArea(const OffLoop& L, const gp_Dir& N) {
    if (L.isCircle) {
        const double a = kPi * L.circ.Radius() * L.circ.Radius();
        return (L.circ.Axis().Direction().Dot(N) >= 0.0) ? a : -a;
    }
    // Newell over the loop's CORNERS. For a mixed profile that is the area of
    // the polygon through the segment endpoints; each arc then contributes the
    // circular SEGMENT between its chord and itself, added below.
    std::vector<gp_Pnt> pts;
    if (L.isMixed) { pts.reserve(L.segs.size()); for (const OffSeg& g : L.segs) pts.push_back(g.start); }
    else           { pts = L.poly; }
    double nx = 0.0, ny = 0.0, nz = 0.0;
    const std::size_t n = pts.size();
    for (std::size_t i = 0; i < n; ++i) {
        const gp_Pnt& a = pts[i];
        const gp_Pnt& b = pts[(i + 1) % n];
        nx += (a.Y() - b.Y()) * (a.Z() + b.Z());
        ny += (a.Z() - b.Z()) * (a.X() + b.X());
        nz += (a.X() - b.X()) * (a.Y() + b.Y());
    }
    double area = 0.5 * (nx * N.X() + ny * N.Y() + nz * N.Z());
    if (L.isMixed) {
        // Exact circular-segment correction, 0.5*R^2*(theta - sin theta), signed
        // by whether the arc bulges along the traversal sense. This is what makes
        // the area self-check in planarMixedFace able to REJECT a chord that has
        // been substituted for an arc.
        for (const OffSeg& g : L.segs) {
            if (!g.isArc) continue;
            const double R  = g.circ.Radius();
            const double th = arcSweep(g, N);
            if (!(R > 0.0) || !(th > 0.0)) continue;
            const double seg = 0.5 * R * R * (th - std::sin(th));
            area += g.ccw ? seg : -seg;
        }
    }
    return area;
}

// The loop's own radius about its centroid — the scale a planarity residual has
// to be judged against, so a 1000 mm part is not held to a 1 mm part's slack.
double loopScale(const OffLoop& L) {
    if (L.isCircle) return L.circ.Radius();
    std::vector<gp_Pnt> pts;
    if (L.isMixed) { for (const OffSeg& g : L.segs) pts.push_back(g.start); }
    else           { pts = L.poly; }
    if (pts.empty()) return 0.0;
    double cx = 0, cy = 0, cz = 0;
    for (const gp_Pnt& p : pts) { cx += p.X(); cy += p.Y(); cz += p.Z(); }
    const double n = static_cast<double>(pts.size());
    const gp_Pnt c(cx / n, cy / n, cz / n);
    double r = 0.0;
    for (const gp_Pnt& p : pts) r = std::max(r, c.Distance(p));
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
    if (L.isMixed) {
        std::vector<OffSeg> segs = L.segs;
        // Reversing a mixed profile is not std::reverse: each segment's own
        // endpoints swap AND its arc sense flips, or the rebuilt wire would run
        // the OTHER arc of the same circle and enclose a different area.
        if ((loopArea(L, N) > 0.0) != ccwAboutN) {
            std::reverse(segs.begin(), segs.end());
            for (OffSeg& g : segs) { std::swap(g.start, g.end); g.ccw = !g.ccw; }
        }
        BRepBuilderAPI_MakeWire mw;
        for (const OffSeg& g : segs) {
            if (g.start.Distance(g.end) < 1.0e-12 && !g.isArc) continue;   // degenerate run
            TopoDS_Edge e;
            if (g.isArc) {
                // Orient the supporting circle so that p1 -> p2 in ITS parametric
                // direction is the arc actually wanted.
                gp_Dir a = g.circ.Axis().Direction();
                const bool axisWithN = a.Dot(gp_Vec(N)) >= 0.0;
                if (axisWithN != g.ccw) a.Reverse();
                const gp_Circ c(gp_Ax2(g.circ.Location(), a, g.circ.Position().XDirection()),
                                g.circ.Radius());
                BRepBuilderAPI_MakeEdge me(c, g.start, g.end);
                if (!me.IsDone()) return TopoDS_Wire();
                e = me.Edge();
            } else {
                BRepBuilderAPI_MakeEdge me(g.start, g.end);
                if (!me.IsDone()) return TopoDS_Wire();
                e = me.Edge();
            }
            mw.Add(e);
            if (!mw.IsDone()) return TopoDS_Wire();
        }
        if (!mw.IsDone()) return TopoDS_Wire();
        return mw.Wire();
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
        if (L.isMixed) {
            if (L.segs.size() < 2) return false;
            for (const OffSeg& g : L.segs) {
                if (pln.Distance(g.start) > slack || pln.Distance(g.end) > slack) return false;
                // An arc must lie IN the face's plane, so its supporting circle's
                // axis has to be the plane normal. A circle tilted out of the
                // plane would still have both endpoints on it.
                if (g.isArc && (!dirParallel(g.circ.Axis().Direction(), N) ||
                                pln.Distance(g.circ.Location()) > slack)) return false;
            }
            return true;
        }
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

// Is `e` an ARC of a circle -- a circular edge that is NOT a full revolution?
// (The basis curve, so a trimmed circle counts. Family H only.)
bool edgeArcCircle(const TopoDS_Edge& e, gp_Circ& out) {
    if (BRep_Tool::Degenerated(e)) return false;
    double f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = edgeBasisCurve(e, f, l);
    if (c.IsNull()) return false;
    Handle(Geom_Circle) gc = Handle(Geom_Circle)::DownCast(c);
    if (gc.IsNull()) return false;
    const double sweep = std::fabs(l - f);
    if (std::fabs(sweep - 2.0 * kPi) <= 1.0e-6) return false;   // that is edgeFullCircle's case
    if (!(sweep > 1.0e-9)) return false;                        // collapsed
    out = gc->Circ();
    return true;
}

// A wire's shape for the mixed guard: exactly one full circle, a ring of >=3
// straight lines, a MIXED profile of straight runs and arcs, or neither (a defer).
//
// MIXED is the rounded-corner plate, the slot, and the full bore rim that a
// coplanar imprint has split into two arcs -- 24 of the 27 parts in family H's
// deletion bucket. It is admitted only when EVERY edge is a line or an arc: one
// spline anywhere and the whole wire is declined, because a profile this engine
// cannot reproduce exactly is not one it may approximate.
enum class LoopKind { Circle, Polygon, Mixed, Neither };

LoopKind classifyWire(const TopoDS_Wire& w, gp_Circ& circOut) {
    int nE = 0, nLine = 0, nCirc = 0, nArc = 0;
    gp_Circ c, a;
    for (TopExp_Explorer ee(w, TopAbs_EDGE); ee.More(); ee.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ee.Current());
        ++nE;
        if (edgeIsLine(e)) ++nLine;
        else if (edgeFullCircle(e, c)) ++nCirc;
        else if (edgeArcCircle(e, a)) ++nArc;
    }
    if (nE == 1 && nCirc == 1) { circOut = c; return LoopKind::Circle; }
    if (nE >= 3 && nLine == nE) return LoopKind::Polygon;
    if (nE >= 2 && nArc >= 1 && (nLine + nArc) == nE) return LoopKind::Mixed;
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

// ---- family H: the offset of a vertex a CYLINDER helps pin ------------------
//
// A polyhedral corner is the meet of three offset planes and
// projectOntoOffsetPlanes solves it exactly. A MIXED profile introduces a second
// kind of vertex: where a straight run meets an arc. On a rounded plate that
// point is shared by the cap plane, the side-wall plane and the corner cylinder,
// so only TWO independent planes are available and the third constraint is
// QUADRATIC. It is still solved in closed form, never iterated: two independent
// offset planes give a LINE, and an offset cylinder cuts that line in at most two
// points.
//
// ★ EVERY candidate is VERIFIED against EVERY incident constraint -- all planes
//   and all cylinders, not merely the three it was built from. That is the same
//   contract the rank-3 solve carries, and it is what rejects the case where a
//   fourth face's offset surface does not pass through the point: such a vertex
//   has no exact sharp-join offset and is declined rather than approximated.
struct OffCyl {
    gp_Pnt loc;
    gp_Dir axis;
    double r = 0.0;
};

double distToAxis(const gp_Pnt& x, const OffCyl& c) {
    const gp_Vec a(c.axis);
    gp_Vec w(c.loc, x);
    return (w - a * w.Dot(a)).Magnitude();
}

bool solveOffsetVertexWithCyl(const std::vector<Plane>& planes,
                              const std::vector<OffCyl>& cyls,
                              const gp_Pnt& v0, double resTol, gp_Pnt& out) {
    if (cyls.empty() || planes.size() < 2) return false;
    int i0 = -1, i1 = -1;
    for (std::size_t i = 0; i < planes.size(); ++i) {
        if (i0 < 0) { i0 = static_cast<int>(i); continue; }
        const gp_Vec a(planes[static_cast<std::size_t>(i0)].nx,
                       planes[static_cast<std::size_t>(i0)].ny,
                       planes[static_cast<std::size_t>(i0)].nz);
        const gp_Vec b(planes[i].nx, planes[i].ny, planes[i].nz);
        if (a.Crossed(b).Magnitude() > 1.0e-6) { i1 = static_cast<int>(i); break; }
    }
    if (i0 < 0 || i1 < 0) return false;                 // no two independent planes
    const Plane& P0 = planes[static_cast<std::size_t>(i0)];
    const Plane& P1 = planes[static_cast<std::size_t>(i1)];
    const gp_Vec n0(P0.nx, P0.ny, P0.nz), n1(P1.nx, P1.ny, P1.nz);
    gp_Vec dir = n0.Crossed(n1);
    const double dn = dir.Magnitude();
    if (dn < 1.0e-9) return false;
    dir.Divide(dn);
    const double a00 = n0.Dot(n0), a01 = n0.Dot(n1), a11 = n1.Dot(n1);
    const double det = a00 * a11 - a01 * a01;
    if (std::fabs(det) < 1.0e-12) return false;
    const gp_Vec bv = n0 * ((P0.d * a11 - P1.d * a01) / det)
                    + n1 * ((P1.d * a00 - P0.d * a01) / det);
    const gp_Pnt L0(bv.X(), bv.Y(), bv.Z());

    std::vector<double> roots;
    for (const OffCyl& c : cyls) {
        const gp_Vec a(c.axis);
        gp_Vec w(c.loc, L0);
        const gp_Vec wp = w   - a * w.Dot(a);
        const gp_Vec dp = dir - a * dir.Dot(a);
        const double A = dp.Dot(dp);
        if (A < 1.0e-14) continue;                      // line parallel to the axis
        const double B = 2.0 * wp.Dot(dp);
        const double C = wp.Dot(wp) - c.r * c.r;
        const double disc = B * B - 4.0 * A * C;
        if (disc < 0.0) {
            // A TANGENCY missed only by round-off is still a tangency; anything
            // deeper is a genuine miss and contributes no candidate.
            if (-disc > 1.0e-9 * std::max(1.0, B * B)) continue;
            roots.push_back(-B / (2.0 * A));
        } else {
            const double sq = std::sqrt(disc);
            roots.push_back((-B + sq) / (2.0 * A));
            roots.push_back((-B - sq) / (2.0 * A));
        }
    }
    if (roots.empty()) return false;

    bool got = false;
    double best = 0.0;
    for (const double sroot : roots) {
        const gp_Pnt x(L0.X() + sroot * dir.X(),
                       L0.Y() + sroot * dir.Y(),
                       L0.Z() + sroot * dir.Z());
        bool ok = true;
        for (const Plane& pl : planes)
            if (std::fabs(pl.nx * x.X() + pl.ny * x.Y() + pl.nz * x.Z() - pl.d) > resTol) { ok = false; break; }
        if (ok) {
            for (const OffCyl& c : cyls) {
                const double tolC = std::max(resTol, 1.0e-7 * std::max(1.0, c.r));
                if (std::fabs(distToAxis(x, c) - c.r) > tolC) { ok = false; break; }
            }
        }
        if (!ok) continue;
        const double dd = v0.Distance(x);
        if (!got || dd < best) { best = dd; got = true; out = x; }
    }
    return got;
}

// ===========================================================================
// family H: THE OFFSET OF A STRAIGHT EDGE, solved in its CROSS-SECTION plane
// ===========================================================================
//
// WHAT WAS MISSING, MEASURED. Family H's deletion bucket at HEAD is 38 parts and
// 23 of them — the single largest column — decline on ONE label,
// `quadric/line_edge_not_between_two_planes`: a LINE edge shared by two
// CYLINDERS. The rule that produced it admitted a straight edge only between two
// PLANES, or on the TANGENT seam of a plane and a cylinder. A census of those 23
// parts (every one of them) finds both kinds of cylinder-cylinder line edge:
//
//   * a CO-SURFACE SPLIT — one cylindrical region carried as two or more faces
//     meeting along seam rulings (same axis, same radius, equal outward normals;
//     13 to 40 such edges per part). This is the cylindrical twin of the
//     coplanar split path (D) the thick-solid already handles: a split of one
//     smooth region is not a geometric edge and must be INVISIBLE in the answer.
//   * a TRANSVERSAL MEET — two cylinders with PARALLEL axes crossing along a
//     common ruling (e.g. r=1.716 against r=18.100 at axis distance 17.731: a
//     bore breaking out through a curved wall). Outward normals differ there, so
//     it is a genuine sharp edge with a genuine dihedral.
//
// THE CONSTRUCTION. A surface contains a straight line only as a RULING, and for
// every kind this engine supports that forces the surface to be PRISMATIC along
// that line: a plane containing it is parallel to it, and a cylinder containing
// it is coaxial-parallel to it. So the whole neighbourhood is a prism along the
// edge, and the offset edge is the meet of the two OFFSET surfaces' CROSS-
// SECTIONS in the plane perpendicular to the edge: a line/line, line/circle or
// circle/circle meet in 2-D. Closed form, no sampling, no marching intersector —
// the same standard this file's meridian re-trim already holds itself to.
//
// A plane/cylinder TANGENCY is the double root of that same line/circle meet, so
// this subsumes the tangent-seam rule rather than sitting beside it, and it also
// admits the plane that CUTS a cylinder (two rulings) which the tangency test
// deliberately declined because it had no construction for it.
//
// The CO-SURFACE case is the one degenerate one: two identical circles meet
// everywhere, so there is no isolated root to take. It is resolved the way path
// D resolves the coplanar split — the split is topological, so the offset ruling
// is the SAME ruling of the offset cylinder, i.e. the original translated by
// dist along the common outward normal. That is not a fallback: for equal
// outward normals it is exactly what the meet degenerates to.
//
// HONEST DEFER, never an approximation: a face whose surface is not prismatic
// along the edge (a cone, sphere or torus can contain a line only degenerately),
// a cross-section pair that does not actually pass through the original edge
// (which would mean the edge is not a ruling of both), and an offset pair whose
// cross-sections no longer meet at all — the last is a TOPOLOGY CHANGE (the two
// features have come apart under the offset) and there is no sharp-join answer
// to give.

// One surface's cross-section in the frame {O; ex, ey} perpendicular to an edge.
struct XSec {
    bool   isCircle = false;
    double a = 0, b = 0, c = 0;      // line   a*s + b*t = c, (a,b) UNIT
    double cs = 0, ct = 0, r = 0;    // circle (s-cs)^2 + (t-ct)^2 = r^2
};

// The cross-section of `s` (kind `k`) in the frame {O; ex, ey} whose third axis
// is `D`. Returns false iff `s` is not PRISMATIC along D — which is exactly the
// condition for it to be able to contain a straight edge in that direction.
bool crossSectionOf(const Handle(Geom_Surface)& s, SK k, const gp_Pnt& O,
                    const gp_Dir& ex, const gp_Dir& ey, const gp_Dir& D, XSec& out) {
    if (s.IsNull()) return false;
    if (k == SK::Plane) {
        Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s);
        if (pl.IsNull()) return false;
        const gp_Dir n = pl->Pln().Axis().Direction();
        if (std::fabs(n.Dot(D)) > 1.0e-7) return false;      // not prismatic along D
        const double a = n.Dot(ex), b = n.Dot(ey);
        const double len = std::sqrt(a * a + b * b);
        if (len < 1.0e-9) return false;
        gp_Vec w(O, pl->Pln().Location());
        out.isCircle = false;
        out.a = a / len; out.b = b / len;
        out.c = (w.Dot(gp_Vec(n))) / len;                    // n . (x - O) = n . (loc - O)
        return true;
    }
    if (k == SK::Cyl) {
        Handle(Geom_CylindricalSurface) cy = Handle(Geom_CylindricalSurface)::DownCast(s);
        if (cy.IsNull()) return false;
        if (!dirParallel(cy->Axis().Direction(), D)) return false;
        gp_Vec w(O, cy->Axis().Location());
        out.isCircle = true;
        out.cs = w.Dot(gp_Vec(ex));
        out.ct = w.Dot(gp_Vec(ey));
        out.r  = cy->Radius();
        return true;
    }
    return false;   // cone / sphere / torus: not prismatic, cannot carry a ruling
}

// Signed residual of the point (s,t) against a cross-section: 0 on the curve.
double xsecResidual(const XSec& x, double s, double t) {
    if (!x.isCircle) return x.a * s + x.b * t - x.c;
    const double ds = s - x.cs, dt = t - x.ct;
    return std::sqrt(ds * ds + dt * dt) - x.r;
}

// Do A and B coincide as curves? (Only circles can: two identical circles are
// the CO-SURFACE SPLIT, the one configuration with no isolated meet.)
bool xsecIdentical(const XSec& A, const XSec& B, double tol) {
    if (A.isCircle != B.isCircle) return false;
    if (A.isCircle)
        return std::fabs(A.cs - B.cs) < tol && std::fabs(A.ct - B.ct) < tol &&
               std::fabs(A.r - B.r) < tol;
    // Two lines coincide when their unit normals are parallel and c matches for
    // the matching sign. Not a configuration a solid boundary can present (two
    // coplanar faces sharing a straight edge is the coplanar split, and its edge
    // has no dihedral either), but it is checked rather than assumed.
    if (std::fabs(A.a * B.b - A.b * B.a) > tol) return false;
    const double sgn = (A.a * B.a + A.b * B.b) >= 0.0 ? 1.0 : -1.0;
    return std::fabs(A.c - sgn * B.c) < tol;
}

// Meet two cross-sections and return the root NEAREST the origin of the frame
// (which is where the ORIGINAL edge sits, so "nearest" is the root that is the
// continuation of this edge and not of a different one on the same pair of
// surfaces). Returns false iff they do not meet — under an offset that is a
// TOPOLOGY CHANGE, not a numerical problem, and it is declined.
bool meetXSec(const XSec& A, const XSec& B, double tol, double& os, double& ot) {
    double cand[2][2];
    int n = 0;
    if (!A.isCircle && !B.isCircle) {
        const double det = A.a * B.b - A.b * B.a;
        if (std::fabs(det) < 1.0e-9) return false;           // parallel lines
        cand[n][0] = (A.c * B.b - A.b * B.c) / det;
        cand[n][1] = (A.a * B.c - A.c * B.a) / det;
        ++n;
    } else if (A.isCircle != B.isCircle) {
        const XSec& L = A.isCircle ? B : A;
        const XSec& C = A.isCircle ? A : B;
        // Distance from the circle centre to the line, along the line's UNIT normal.
        const double h = L.a * C.cs + L.b * C.ct - L.c;      // signed
        const double disc = C.r * C.r - h * h;
        if (disc < 0.0) {
            if (-disc > 1.0e-9 * std::max(1.0, C.r * C.r)) return false;
            cand[n][0] = C.cs - h * L.a; cand[n][1] = C.ct - h * L.b; ++n;   // tangency
        } else {
            const double q = std::sqrt(disc);
            const double fs = C.cs - h * L.a, ft = C.ct - h * L.b;           // foot
            cand[n][0] = fs - q * L.b; cand[n][1] = ft + q * L.a; ++n;
            cand[n][0] = fs + q * L.b; cand[n][1] = ft - q * L.a; ++n;
        }
    } else {
        const double dx = B.cs - A.cs, dy = B.ct - A.ct;
        const double d2 = dx * dx + dy * dy;
        const double d  = std::sqrt(d2);
        if (d < tol) return false;                            // concentric (identical handled above)
        const double aa = (d2 + A.r * A.r - B.r * B.r) / (2.0 * d);
        const double disc = A.r * A.r - aa * aa;
        const double ux = dx / d, uy = dy / d;
        const double fs = A.cs + aa * ux, ft = A.ct + aa * uy;
        if (disc < 0.0) {
            if (-disc > 1.0e-9 * std::max(1.0, A.r * A.r)) return false;     // come apart
            cand[n][0] = fs; cand[n][1] = ft; ++n;                           // tangency
        } else {
            const double q = std::sqrt(disc);
            cand[n][0] = fs - q * uy; cand[n][1] = ft + q * ux; ++n;
            cand[n][0] = fs + q * uy; cand[n][1] = ft - q * ux; ++n;
        }
    }
    int best = -1;
    double bd = 0.0;
    for (int i = 0; i < n; ++i) {
        const double dd = cand[i][0] * cand[i][0] + cand[i][1] * cand[i][1];
        if (best < 0 || dd < bd) { bd = dd; best = i; }
    }
    if (best < 0) return false;
    os = cand[best][0];
    ot = cand[best][1];
    return true;
}

// The OUTWARD unit normal of a face at a point on it, for the two kinds that can
// carry a ruling. The cylinder's radial SIGN is read back from the offset radius
// rather than re-derived: offsetSurfaceOf already moved it the right way for this
// face's outward normal (r+t on a boss, r-t in a bore) and verified the
// displacement really was normal, so reading it cannot disagree with the surface
// that was actually built.
bool rulingOutwardNormal(const QF& q, const gp_Pnt& p, double dist, gp_Dir& out) {
    if (q.kind == SK::Plane) {
        Plane pl;
        if (!outwardPlaneOf(q.face, pl)) return false;
        out = gp_Dir(pl.nx, pl.ny, pl.nz);
        return true;
    }
    if (q.kind != SK::Cyl) return false;
    Handle(Geom_CylindricalSurface) c0 = Handle(Geom_CylindricalSurface)::DownCast(q.surf);
    Handle(Geom_CylindricalSurface) c1 = Handle(Geom_CylindricalSurface)::DownCast(q.off);
    if (c0.IsNull() || c1.IsNull()) return false;
    gp_Dir rhat;
    if (!radialDir(c0->Axis().Location(), c0->Axis().Direction(), p, rhat)) return false;
    const double dR = c1->Radius() - c0->Radius();
    if (std::fabs(dR) < 1.0e-12) return false;
    if ((dR / dist) < 0.0) rhat.Reverse();
    out = rhat;
    return true;
}

// THE OFFSET RULING. `L0` is the edge's supporting line; A and B are the two
// faces that share it. Fills `out` with the line the sharp join sends it to.
bool offsetRuling(const gp_Lin& L0, const gp_Pnt& onEdge, const QF& A, const QF& B,
                  double dist, gp_Lin& out, const char** why) {
    const gp_Dir D = L0.Direction();
    // A frame perpendicular to the edge, with the ORIGINAL edge at the origin.
    gp_Dir ex, ey;
    {
        const gp_Dir seed = (std::fabs(D.X()) < 0.9) ? gp_Dir(1, 0, 0) : gp_Dir(0, 1, 0);
        ex = gp_Dir(gp_Vec(D).Crossed(gp_Vec(seed)));
        ey = gp_Dir(gp_Vec(D).Crossed(gp_Vec(ex)));
    }
    const gp_Pnt O = onEdge;

    XSec oa, ob, na, nb;
    if (!crossSectionOf(A.surf, A.kind, O, ex, ey, D, oa) ||
        !crossSectionOf(B.surf, B.kind, O, ex, ey, D, ob)) {
        if (why) *why = "quadric/line_edge_face_not_prismatic";
        return false;
    }
    // The edge must really be a ruling of BOTH originals, or this whole prism
    // argument is about a different pair of surfaces than the ones on the shape.
    const double scale = std::max(1.0, std::max(oa.isCircle ? oa.r : 0.0,
                                                ob.isCircle ? ob.r : 0.0));
    const double onTol = 1.0e-6 * scale;
    if (std::fabs(xsecResidual(oa, 0.0, 0.0)) > onTol ||
        std::fabs(xsecResidual(ob, 0.0, 0.0)) > onTol) {
        if (why) *why = "quadric/line_edge_not_a_ruling_of_both";
        return false;
    }
    if (!crossSectionOf(A.off, surfKind(A.off), O, ex, ey, D, na) ||
        !crossSectionOf(B.off, surfKind(B.off), O, ex, ey, D, nb)) {
        if (why) *why = "quadric/line_edge_offset_not_prismatic";
        return false;
    }

    double s = 0.0, t = 0.0;
    if (xsecIdentical(oa, ob, onTol)) {
        // CO-SURFACE SPLIT. There is no isolated meet because there is no edge:
        // the two faces are the same smooth region. Its offset ruling is the same
        // ruling of the offset region — the original translated by dist along the
        // common outward normal — and it must be INVISIBLE in the answer, which is
        // what the u-retrim delta of exactly 0 below then makes it.
        gp_Dir n1, n2;
        if (!rulingOutwardNormal(A, O, dist, n1) || !rulingOutwardNormal(B, O, dist, n2)) {
            if (why) *why = "quadric/line_edge_split_normal_failed";
            return false;
        }
        if (n1.Dot(n2) < 1.0 - 1.0e-9) {
            // Same surface, OPPOSITE outward normals: the two faces bound the
            // material from opposite sides, which is a zero-thickness sliver, not
            // a split. Declined — its offset is not a sharp join at all.
            if (why) *why = "quadric/line_edge_split_normals_opposed";
            return false;
        }
        if (!xsecIdentical(na, nb, onTol)) {
            if (why) *why = "quadric/line_edge_split_offsets_differ";
            return false;
        }
        s = dist * gp_Vec(n1).Dot(gp_Vec(ex));
        t = dist * gp_Vec(n1).Dot(gp_Vec(ey));
    } else if (!meetXSec(na, nb, onTol, s, t)) {
        if (why) *why = "quadric/line_edge_offsets_do_not_meet";
        return false;
    }

    // VERIFY the answer against BOTH offset cross-sections, at the tolerance the
    // rest of this engine holds a closed form to. A root that does not satisfy
    // both is not the meet, and no result is given.
    const double vTol = std::max(1.0e-9, 1.0e-7 * std::max(1.0, std::fabs(dist)));
    if (std::fabs(xsecResidual(na, s, t)) > vTol ||
        std::fabs(xsecResidual(nb, s, t)) > vTol) {
        if (why) *why = "quadric/line_edge_offset_residual";
        return false;
    }
    out = gp_Lin(O.Translated(gp_Vec(ex) * s + gp_Vec(ey) * t), D);
    return true;
}

// The u parameter of a point about an elementary surface's own gp_Ax3 — the same
// angle OCCT's cylinder parametrisation uses (P = L + R(cos u X + sin u Y) + v Z).
bool uParamAbout(const gp_Ax3& ax, const gp_Pnt& p, double& u) {
    gp_Vec w(ax.Location(), p);
    const double x = w.Dot(gp_Vec(ax.XDirection()));
    const double y = w.Dot(gp_Vec(ax.YDirection()));
    if (x * x + y * y < 1.0e-24) return false;
    u = std::atan2(y, x);
    return true;
}

// Lift `u` into the branch nearest the middle of [lo, hi].
double liftU(double u, double lo, double hi) {
    const double mid = 0.5 * (lo + hi);
    while (u - mid >  kPi) u -= 2.0 * kPi;
    while (mid - u >  kPi) u += 2.0 * kPi;
    return u;
}

// ---- family H: the vertex an offset RULING pins ----------------------------
//
// A polyhedral corner is three offset planes; a line-meets-arc corner is two
// planes and a cylinder. A seam endpoint is neither: at the top of a split bore
// the incident faces are ONE cap plane and TWO faces of the SAME cylinder, so
// the surfaces alone leave a whole circle of solutions. What pins it is the
// EDGE — the offset ruling is known exactly, and the vertex is where that line
// crosses the offset cap plane.
//
// ★ Every candidate is verified against EVERY incident constraint — all planes,
//   all cylinders AND all rulings, not merely the two it was built from. That is
//   the same contract the other two solves carry, and it is what declines a
//   vertex that has no exact sharp-join offset instead of approximating one.
bool solveOffsetVertexWithRuling(const std::vector<Plane>& planes,
                                 const std::vector<OffCyl>& cyls,
                                 const std::vector<gp_Lin>& lines,
                                 const gp_Pnt& v0, double resTol, gp_Pnt& out) {
    if (lines.empty()) return false;
    const double geoTol = std::max(resTol, 1.0e-9 * std::max(1.0, v0.XYZ().Modulus()));

    std::vector<gp_Pnt> cand;
    for (const gp_Lin& L : lines) {
        const gp_Vec dir(L.Direction());
        for (const Plane& p : planes) {
            const gp_Vec n(p.nx, p.ny, p.nz);
            const double den = n.Dot(dir);
            if (std::fabs(den) < 1.0e-9) continue;            // ruling lies in / parallel to it
            const gp_Pnt L0 = L.Location();
            const double num = p.d - (p.nx * L0.X() + p.ny * L0.Y() + p.nz * L0.Z());
            cand.push_back(L0.Translated(dir * (num / den)));
        }
    }
    // Two non-parallel rulings meeting is also a corner; it is admitted only when
    // they REALLY meet (skew lines have a nearest pair and no intersection, and
    // taking the midpoint of that pair would fabricate a vertex).
    for (std::size_t i = 0; i < lines.size(); ++i)
        for (std::size_t j = i + 1; j < lines.size(); ++j) {
            const gp_Vec d1(lines[i].Direction()), d2(lines[j].Direction());
            const gp_Vec cr = d1.Crossed(d2);
            const double cn = cr.SquareMagnitude();
            if (cn < 1.0e-18) continue;                       // parallel
            const gp_Pnt p1 = lines[i].Location(), p2 = lines[j].Location();
            const gp_Vec w(p1, p2);
            const double s = w.Crossed(d2).Dot(cr) / cn;
            const gp_Pnt x = p1.Translated(d1 * s);
            if (lines[j].Distance(x) > geoTol) continue;      // skew, not a corner
            cand.push_back(x);
        }
    if (cand.empty()) return false;

    bool got = false;
    double best = 0.0;
    for (const gp_Pnt& x : cand) {
        bool ok = true;
        for (const Plane& p : planes)
            if (std::fabs(p.nx * x.X() + p.ny * x.Y() + p.nz * x.Z() - p.d) > resTol) { ok = false; break; }
        if (ok)
            for (const OffCyl& c : cyls) {
                const double tolC = std::max(resTol, 1.0e-7 * std::max(1.0, c.r));
                if (std::fabs(distToAxis(x, c) - c.r) > tolC) { ok = false; break; }
            }
        if (ok)
            for (const gp_Lin& L : lines)
                if (L.Distance(x) > geoTol) { ok = false; break; }
        if (!ok) continue;
        const double dd = v0.Distance(x);
        if (!got || dd < best) { best = dd; got = true; out = x; }
    }
    return got;
}

// ---- family H: a CYLINDRICAL offset face that is NOT a u-v rectangle --------
//
// MEASURED: with the cross-section ruling in place, 33 of the 600 corpus parts —
// and 10 of the 38 in family H's deletion bucket — stop on one thing: a
// cylindrical face carrying MORE THAN TWO rulings. Such a face is NOTCHED in u
// (a hole breaking out through a curved wall leaves a bite out of it), and
// MakeFace over a u-v rectangle would FILL THE NOTCH IN. That is a wrong answer
// whose volume is within a fraction of a percent of the right one, so it is
// built from the face's OWN BOUNDARY LOOP instead, or not at all.
//
// EVERY PIECE IS CLOSED FORM AND THE SURFACE TYPE IS KEPT. On a cylinder the
// boundary of any face this engine admits is isoparametric: a RULING is u =
// const and a coaxial ARC is v = const. So each offset edge is an exact 3-D
// line or an exact arc of the offset circle offsetCircle already returned, and
// its PCURVE is an exact Geom2d_Line — nothing is sampled, spline-fitted or
// tessellated, and no ShapeFix/Approx symbol is touched.
//
//   ruling A->B :  C3(t) = A + t*Zhat            t in [0, |AB|]
//                  C2(t) = (u0, v(A) + sgn * t)  a 2-D line, direction (0, ±1)
//   arc         :  the offset circle rebuilt on gp_Ax2(centre, Zhat, Xhat) — the
//                  cylinder's OWN angular frame, so the circle's parameter IS the
//                  cylinder's u — hence
//                  C2(t) = (t, v0)               a 2-D line, direction (1, 0)
//
// THE ARC'S SWEEP IS NOT READ OFF AN ORIENTATION FLAG. Its magnitude comes from
// the original edge's own parameter range, and its SIGN is the one that actually
// lands on the solved end vertex — checked, both ways, so an arc that runs the
// wrong way round the circle cannot be built.
//
// SELF-CHECK, and it is the one that can see a filled notch. The face's area has
// a closed form here: every boundary segment is axis-parallel in (u, v), so the
// shoelace of the (u, v) loop is EXACT, and the area of the cylindrical patch is
// R times it. A notch that has been filled in changes that number; a volume
// check would not have seen it.
TopoDS_Face cylTrimmedFace(const QF& q,
                           const TopTools_IndexedDataMapOfShapeListOfShape& vfMap,
                           const std::vector<gp_Pnt>& moved,
                           const std::vector<bool>& movedOk,
                           const TopTools_IndexedMapOfShape& edgeIdx,
                           const std::vector<gp_Circ>& offCirc,
                           const std::vector<bool>& offOk,
                           const std::vector<gp_Lin>& offLine,
                           const std::vector<bool>& offLineOk,
                           const char** why) {
    const TopoDS_Face kNull;
    auto fail = [&](const char* w) -> TopoDS_Face { if (why) *why = w; return kNull; };

    Handle(Geom_CylindricalSurface) oc = Handle(Geom_CylindricalSurface)::DownCast(q.off);
    if (oc.IsNull()) return fail("quadric/cyltrim_offset_not_cylinder");
    const gp_Ax3 ax = oc->Position();
    const double R  = oc->Radius();
    const gp_Pnt Lo = ax.Location();
    const gp_Dir Z  = ax.Direction();
    const gp_Dir X  = ax.XDirection();
    const gp_Dir Y  = ax.YDirection();
    const double geoTol = 1.0e-6 * std::max(1.0, R);

    auto uOf = [&](const gp_Pnt& p) {
        const gp_Vec w(Lo, p);
        return std::atan2(w.Dot(gp_Vec(Y)), w.Dot(gp_Vec(X)));
    };
    auto vOf = [&](const gp_Pnt& p) { return gp_Vec(Lo, p).Dot(gp_Vec(Z)); };

    const TopoDS_Wire w = BRepTools::OuterWire(q.face);
    if (w.IsNull()) return fail("quadric/cyltrim_no_outer_wire");

    struct Piece { TopoDS_Edge e; Handle(Geom2d_Curve) pc; double u0, v0, u1, v1; };
    std::vector<Piece> pieces;
    bool haveAnchor = false;
    double uCur = 0.0;

    for (BRepTools_WireExplorer wex(w, q.face); wex.More(); wex.Next()) {
        const TopoDS_Edge   we = wex.Current();
        const TopoDS_Vertex vA = wex.CurrentVertex();
        if (BRep_Tool::Degenerated(we)) return fail("quadric/cyltrim_degenerate_edge");
        TopoDS_Vertex va, vb;
        TopExp::Vertices(we, va, vb, Standard_True);
        const TopoDS_Vertex vB = vA.IsSame(va) ? vb : va;
        const int ia = vfMap.FindIndex(vA), ib = vfMap.FindIndex(vB);
        if (ia == 0 || ib == 0) return fail("quadric/cyltrim_vertex_not_indexed");
        if (!movedOk[static_cast<std::size_t>(ia) - 1] ||
            !movedOk[static_cast<std::size_t>(ib) - 1])
            return fail("quadric/cyltrim_vertex_not_solved");
        const gp_Pnt A = moved[static_cast<std::size_t>(ia) - 1];
        const gp_Pnt B = moved[static_cast<std::size_t>(ib) - 1];
        const int ei = edgeIdx.FindIndex(we);
        if (ei == 0) return fail("quadric/cyltrim_edge_not_indexed");
        const std::size_t e0 = static_cast<std::size_t>(ei) - 1;

        // The absolute u branch is arbitrary (the surface is periodic); what must
        // be consistent is the loop, so it is anchored ONCE and then threaded.
        if (!haveAnchor) { uCur = uOf(A); haveAnchor = true; }

        Piece pz;
        pz.u0 = uCur;
        pz.v0 = vOf(A);

        if (edgeIsLine(we)) {
            if (!offLineOk[e0]) return fail("quadric/cyltrim_ruling_missing");
            // The two solved vertices must sit on the OFFSET RULING this edge was
            // sent to. They were solved from surfaces, the ruling from the
            // cross-section meet, and the two answers are independent — so this
            // rejects a vertex that landed on a DIFFERENT ruling of the same pair
            // of cylinders, which is the one way a face here could close on the
            // wrong side and still look like a face.
            if (offLine[e0].Distance(A) > geoTol || offLine[e0].Distance(B) > geoTol)
                return fail("quadric/cyltrim_vertex_off_ruling");
            // ORDER MATTERS, AND IT IS THE CONTRACT. gp_Vec::Normalized() RAISES
            // gp_VectorWithNullMagnitude when the vector is shorter than
            // gp::Resolution(), so testing axiality by normalising FIRST would
            // throw out of an engine whose documented answer is a null shape —
            // an inward offset that drives a ruling's two ends together is
            // exactly the input that does it. The length is therefore measured
            // first, and the axiality test is then written on the UN-normalised
            // vector (|ab . Z| == |ab|), which is the same predicate with no
            // division in it at all.
            const double len = A.Distance(B);
            if (!(len > 1.0e-12)) return fail("quadric/cyltrim_ruling_degenerate");
            const gp_Vec ab(A, B);
            const double along = ab.Dot(gp_Vec(Z));
            if (std::fabs(std::fabs(along) - len) > 1.0e-7 * len)
                return fail("quadric/cyltrim_ruling_not_axial");
            const double sgn = along > 0.0 ? 1.0 : -1.0;
            BRepBuilderAPI_MakeEdge me(A, B);
            if (!me.IsDone()) return fail("quadric/cyltrim_ruling_edge_failed");
            pz.e  = me.Edge();
            pz.pc = new Geom2d_Line(gp_Pnt2d(uCur, pz.v0), gp_Dir2d(0.0, sgn));
            pz.u1 = uCur;
            pz.v1 = pz.v0 + sgn * len;
        } else {
            gp_Circ o0;
            const bool full = edgeFullCircle(we, o0);
            if (!full && !edgeArcCircle(we, o0)) return fail("quadric/cyltrim_edge_not_line_or_arc");
            if (full) return fail("quadric/cyltrim_full_circle_in_mixed_loop");
            if (!offOk[e0]) return fail("quadric/cyltrim_arc_offset_missing");
            const gp_Circ off = offCirc[e0];
            if (!dirParallel(off.Axis().Direction(), Z) ||
                std::fabs(off.Radius() - R) > geoTol ||
                distToAxis(Lo, Z, off.Location()) > geoTol)
                return fail("quadric/cyltrim_arc_not_coaxial");
            double f0 = 0.0, l0 = 0.0;
            (void)edgeBasisCurve(we, f0, l0);
            const double sweep = std::fabs(l0 - f0);
            if (!(sweep > 1.0e-9) || sweep >= 2.0 * kPi - 1.0e-9)
                return fail("quadric/cyltrim_arc_sweep_out_of_range");
            // The SIGN is the one that lands on the solved far vertex. Both are
            // tried and exactly one must fit, so a wrong-way arc cannot be built.
            const double uB = uOf(B);
            int hits = 0; double du = 0.0;
            for (int sgn = -1; sgn <= 1; sgn += 2) {
                double r = uCur + sgn * sweep - uB;
                while (r >  kPi) r -= 2.0 * kPi;
                while (r < -kPi) r += 2.0 * kPi;
                // ARC LENGTH, not radians: |r| * R is the distance on the
                // cylinder between where this sweep lands and the solved vertex,
                // which is the quantity geoTol is denominated in. The max(1, R)
                // that stood here cancelled against geoTol's own max(1, R) and so
                // silently made this a bare 1e-6 RADIAN test at every radius.
                if (std::fabs(r) * R < geoTol) { ++hits; du = sgn * sweep; }
            }
            if (hits != 1) return fail("quadric/cyltrim_arc_sense_ambiguous");
            const double vh = vOf(A);
            if (std::fabs(vh - vOf(B)) > geoTol) return fail("quadric/cyltrim_arc_not_isoparametric");
            const gp_Pnt ctr = Lo.Translated(gp_Vec(Z) * vh);
            const gp_Circ cc(gp_Ax2(ctr, Z, X), R);       // parameter == the cylinder's u
            const double lo = std::min(uCur, uCur + du), hi = std::max(uCur, uCur + du);
            BRepBuilderAPI_MakeEdge me(cc, lo, hi);
            if (!me.IsDone()) return fail("quadric/cyltrim_arc_edge_failed");
            pz.e  = me.Edge();
            pz.pc = new Geom2d_Line(gp_Pnt2d(0.0, vh), gp_Dir2d(1.0, 0.0));
            pz.u1 = uCur + du;
            pz.v1 = vh;
            // The rebuilt arc must actually run between the two solved vertices.
            auto onCirc = [&](double t) {
                return ctr.Translated(gp_Vec(X) * (R * std::cos(t)) + gp_Vec(Y) * (R * std::sin(t)));
            };
            const gp_Pnt pa = onCirc(lo), pb = onCirc(hi);
            const double d0 = std::min(pa.Distance(A) + pb.Distance(B),
                                       pa.Distance(B) + pb.Distance(A));
            if (d0 > geoTol) return fail("quadric/cyltrim_arc_endpoints_moved");
        }
        uCur = pz.u1;
        pieces.push_back(pz);
    }
    if (pieces.size() < 3) return fail("quadric/cyltrim_loop_under_3");
    // The loop must CLOSE in (u, v) — if threading the sweeps does not come back
    // to where it started, the boundary this face was read from is not a loop on
    // this cylinder and nothing is built.
    // ★ BOTH HALVES OF THIS CONDITION ARE MILLIMETRES AGAINST THE SAME BOUND.
    //   The u half was a bare 1.0e-7 RADIAN constant with no radius in it, sitting
    //   in the same `if` as a v half measured in mm against geoTol — and TIGHTER,
    //   by ten, than the arc-sense gate that produced the u values. A loop every
    //   piece of which passed its own gate could therefore still be declined here,
    //   which is a spurious DEFER (never a wrong shape: the area identity, the sew,
    //   the face count and BRepCheck all still stand behind it). |du| * R is the
    //   closure gap as a distance on the cylinder, which is what geoTol measures.
    if (std::fabs(pieces.back().u1 - pieces.front().u0) * R > geoTol ||
        std::fabs(pieces.back().v1 - pieces.front().v0) > geoTol)
        return fail("quadric/cyltrim_loop_does_not_close");

    // EXACT area, by the shoelace of an axis-parallel (u, v) loop, times R.
    double a2 = 0.0;
    for (const Piece& pz : pieces) a2 += pz.u0 * pz.v1 - pz.u1 * pz.v0;
    const double areaUV = 0.5 * a2;
    if (std::fabs(areaUV) < 1.0e-12) return fail("quadric/cyltrim_zero_area");

    BRepBuilderAPI_MakeWire mw;
    for (const Piece& pz : pieces) {
        mw.Add(pz.e);
        if (!mw.IsDone()) return fail("quadric/cyltrim_wire_add_failed");
    }
    if (!mw.IsDone()) return fail("quadric/cyltrim_wire_not_done");
    TopoDS_Wire ow = mw.Wire();
    // A FORWARD face carries its outer wire COUNTER-CLOCKWISE in (u, v); the
    // shoelace sign is what says so, and the caller then applies the original
    // face's own TopAbs orientation exactly as the rectangle path does.
    if (areaUV < 0.0) ow.Reverse();

    BRep_Builder bb;
    TopoDS_Face f;
    bb.MakeFace(f, q.off, Precision::Confusion());
    for (const Piece& pz : pieces) bb.UpdateEdge(pz.e, pz.pc, f, Precision::Confusion());
    bb.Add(f, ow);
    f.Orientation(TopAbs_FORWARD);

    GProp_GProps g;
    BRepGProp::SurfaceProperties(f, g);
    const double want = R * std::fabs(areaUV);
    if (std::fabs(g.Mass() - want) > 1.0e-6 * std::max(1.0, want))
        return fail("quadric/cyltrim_area_mismatch");
    return f;
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
        q.nu1 = q.u1; q.nu2 = q.u2;

        gp_Pnt P; gp_Dir outward;
        if (!faceSample(f, q.surf, q.u1, q.u2, q.v1, q.v2, P, outward)) return dfr("quadric/face_sample_failed");
        q.smp = P;
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
    // has always built), a ring of straight LINES (the polygon the PLANAR path's
    // corner solve already offsets exactly), or a MIXED line/arc profile. A
    // spline anywhere is still declined, never approximated.
    //
    // A CURVED face may now be a PARTIAL revolution, but only if it is a
    // CYLINDER. That restriction is not caution for its own sake: the offset of
    // a cylindrical band is the coaxial cylinder of radius r +/- t over the SAME
    // angular range, so MakeFace(off, u1, u2, ...) below rebuilds it with the
    // u-range untouched and the result is exact. A partial CONE, SPHERE or TORUS
    // has no such property here -- a partial sphere's offset band does not keep
    // its u-range under the v re-trim -- so those stay declined.
    for (const QF& q : qf) {
        int nWires = 0;
        for (TopoDS_Iterator it(q.face); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++nWires;

        if (q.kind != SK::Plane) {
            if (nWires != 1) return dfr("quadric/curved_face_has_hole");
            if (std::fabs((q.u2 - q.u1) - 2.0 * kPi) > 1.0e-7) {
                if (q.kind != SK::Cyl) return dfr("quadric/curved_face_not_full_revolution");
                if (!(q.u2 - q.u1 > 1.0e-9)) return dfr("quadric/cyl_band_u_range_collapsed");
            }
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
    std::vector<bool>    offIsArc(static_cast<std::size_t>(edgeIdx.Extent()), false);
    // The offset RULING of every straight edge (see offsetRuling). It is what
    // pins a seam-endpoint vertex, whose incident SURFACES leave a whole circle
    // of solutions.
    std::vector<gp_Lin>  offLine(static_cast<std::size_t>(edgeIdx.Extent()));
    std::vector<bool>    offLineOk(static_cast<std::size_t>(edgeIdx.Extent()), false);
    // Per CURVED face, every boundary ruling as (u of the original, delta the
    // offset moved it by). Resolved into a u domain once the whole loop is known.
    std::vector<std::vector<std::pair<double, double>>> faceRulings(qf.size());
    TopTools_IndexedMapOfShape cornerVerts;   // vertices that must be SOLVED

    for (int i = 1; i <= efMap.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(i));
        if (BRep_Tool::Degenerated(e)) continue;

        std::vector<QF*> nb;
        for (TopTools_ListIteratorOfListOfShape it(efMap.FindFromIndex(i)); it.More(); it.Next()) {
            QF* q = qOf(it.Value());
            if (!q) return dfr("quadric/edge_face_not_indexed");
            if (std::find(nb.begin(), nb.end(), q) == nb.end()) nb.push_back(q);
        }
        if (nb.size() == 1) {
            // THE SEAM OF A FULL-REVOLUTION FACE. The same face is on both sides,
            // so there is no dihedral and nothing to re-trim — but if it is a
            // STRAIGHT seam it is still the only thing that pins the vertex where
            // it meets a cap: one cap plane and one cylinder leave a whole CIRCLE
            // of solutions, and MEASURED on ho137 that is what 51 of the 600 parts
            // now stop on. The seam's offset is the co-surface case of
            // offsetRuling — the same face on both sides — so it is computed by
            // exactly the same code, not by a special rule.
            if (edgeIsLine(e)) {
                double sf = 0.0, sl = 0.0;
                Handle(Geom_Curve) sbc = edgeBasisCurve(e, sf, sl);
                Handle(Geom_Line) sgl = Handle(Geom_Line)::DownCast(sbc);
                if (!sgl.IsNull()) {
                    gp_Lin sol;
                    const char* swhy = nullptr;
                    if (offsetRuling(sgl->Lin(), sgl->Value(0.5 * (sf + sl)),
                                     *nb[0], *nb[0], dist, sol, &swhy)) {
                        offLine[static_cast<std::size_t>(i) - 1]   = sol;
                        offLineOk[static_cast<std::size_t>(i) - 1] = true;
                    }
                }
            }
            continue;                                  // seam
        }
        if (nb.size() != 2) return dfr("quadric/edge_non_manifold");              // non-manifold
        QF& A = *nb[0];
        QF& B = *nb[1];

        gp_Circ orig;
        bool isArcEdge = false;
        if (!edgeFullCircle(e, orig)) {
            // A straight edge between two PLANES is a polyhedral corner edge: its
            // offset is pinned by the vertex solve in step 3b, not by a circle
            // re-trim, so there is nothing to compute here.
            //
            // A straight edge between a PLANE and a CYLINDER is the TANGENT SEAM of
            // a fillet or a rounded corner. It is admitted, and it too needs no
            // circle: the cylindrical band is rebuilt from its own (u,v) box and the
            // planar face from its own loop, so the seam is implicit in both.
            // TANGENCY IS VERIFIED, never assumed -- a plane that CUTS a cylinder
            // meets it in an ellipse, not a line, and the offset of that seam is not
            // the translate of this one.
            if (edgeIsLine(e)) {
                const bool pp = (A.kind == SK::Plane && B.kind == SK::Plane);
                double ef = 0.0, el = 0.0;
                Handle(Geom_Curve) bc = edgeBasisCurve(e, ef, el);
                Handle(Geom_Line) gl = Handle(Geom_Line)::DownCast(bc);
                if (gl.IsNull()) return dfr("quadric/line_edge_basis_lost");
                // A point INSIDE the trimmed edge, so the cross-section frame is
                // centred on THIS ruling: "the root nearest the origin" then names
                // the continuation of this edge and not of another ruling the same
                // pair of surfaces also shares.
                const gp_Pnt onEdge = gl->Value(0.5 * (ef + el));

                gp_Lin ol;
                const char* lwhy = nullptr;
                const bool gotRuling = offsetRuling(gl->Lin(), onEdge, A, B, dist, ol, &lwhy);
                if (!gotRuling && !pp)
                    return dfr(lwhy ? lwhy : "quadric/line_edge_offset_failed");
                // PLANE/PLANE keeps the behaviour it has always had: the polyhedral
                // corner solve pins those vertices from the offset planes alone, and
                // the ruling is recorded only as an EXTRA constraint when it is
                // available. A pair of planes that declines to produce one therefore
                // cannot turn a part that builds today into a defer.
                if (gotRuling) {
                    offLine[static_cast<std::size_t>(i) - 1]   = ol;
                    offLineOk[static_cast<std::size_t>(i) - 1] = true;
                }
                for (TopExp_Explorer ev(e, TopAbs_VERTEX); ev.More(); ev.Next())
                    cornerVerts.Add(ev.Current());

                // ---- U RE-TRIM (collected here, RESOLVED after the edge loop).
                // A ruling is a u-isoparametric boundary of a cylindrical face,
                // so it pins a u bound exactly as a circle edge pins a v bound.
                // WHICH bound it pins cannot be decided one edge at a time: a
                // face may WRAP THROUGH THE SEAM (u = 0), and BRepTools::UVBounds
                // then reports [0, 2*pi] for a face that actually occupies, say,
                // [5.70, 1.48 + 2*pi] -- the COMPLEMENT of what a nearest-end test
                // would pick. So every ruling on a face is collected and the
                // domain is resolved once, against a point faceSample already
                // proved is ON the face.
                if (gotRuling) {
                    for (QF* q : nb) {
                        if (q->kind != SK::Cyl) continue;
                        gp_Ax3 ax;
                        if (!axesOf(q->surf, q->kind, ax)) return dfr("quadric/ruling_axes_failed");
                        double uOrig = 0.0, uOff = 0.0;
                        if (!uParamAbout(ax, onEdge, uOrig) ||
                            !uParamAbout(ax, ol.Location(), uOff))
                            return dfr("quadric/ruling_uparam_failed");
                        uOff = liftU(uOff, uOrig - kPi, uOrig + kPi);
                        double delta = uOff - uOrig;
                        // A ruling that geometry says did not move (a co-surface
                        // split, a tangent seam) must not move a bound by the last
                        // bits of an atan2.
                        if (std::fabs(delta) < 1.0e-12) delta = 0.0;
                        faceRulings[static_cast<std::size_t>(q - &qf[0])].push_back({uOrig, delta});
                    }
                }
                continue;
            }
            // An ARC of a circle: its supporting circle offsets by exactly the same
            // closed form a full circle does (offsetCircle validates that both
            // ORIGINAL surfaces really are surfaces of revolution about this axis and
            // contain this circle). Only the TRIM differs -- the arc's two endpoints
            // are vertex solves like any other.
            if (!edgeArcCircle(e, orig)) return dfr("quadric/edge_not_full_circle");
            isArcEdge = true;
            for (TopExp_Explorer ev(e, TopAbs_VERTEX); ev.More(); ev.Next())
                cornerVerts.Add(ev.Current());
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
        offCirc[static_cast<std::size_t>(i) - 1]  = oc;
        offOk[static_cast<std::size_t>(i) - 1]    = true;
        offIsArc[static_cast<std::size_t>(i) - 1] = isArcEdge;

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

    // ---- 3a. THE U DOMAIN OF EVERY CYLINDRICAL FACE -------------------------
    // A cylindrical face's u domain is bounded by its RULINGS, and offsetting
    // moves each ruling by the delta collected above. Two things make this more
    // than an assignment:
    //
    //   * A FACE THAT WRAPS THROUGH THE SEAM. BRepTools::UVBounds reports the
    //     min and max of the pcurve values, so a face occupying [5.70, 1.48+2pi]
    //     comes back as [0, 2pi] and a nearest-end test picks its COMPLEMENT --
    //     the same band of the cylinder, on the wrong side. MEASURED on ho1097's
    //     r=2.835 bore. The ambiguity is resolved against `smp`, a point
    //     faceSample already proved is on the face, so the domain is chosen and
    //     never guessed.
    //
    //   * A FACE WITH MORE THAN TWO RULINGS is NOT a u-v rectangle at all: it is
    //     notched, and MakeFace over a rectangle would fill the notch in. There
    //     is no closed-form rectangle to give, so it is an HONEST DEFER. That
    //     wants a trimmed cylindrical face built from its own boundary loop, and
    //     it is the measured next rung for this family.
    for (std::size_t fi = 0; fi < qf.size(); ++fi) {
        QF& q = qf[fi];
        if (q.kind != SK::Cyl) continue;
        std::vector<std::pair<double, double>>& rl = faceRulings[fi];
        if (rl.empty()) continue;                       // full revolution: unchanged
        // Two rulings that are the SAME angle are the same boundary carried as
        // two edges (a seam split by a vertex); collapse them before counting.
        std::sort(rl.begin(), rl.end(),
                  [](const std::pair<double, double>& a, const std::pair<double, double>& b) {
                      return a.first < b.first;
                  });
        std::vector<std::pair<double, double>> uniq;
        for (const std::pair<double, double>& r : rl) {
            if (!uniq.empty() && std::fabs(uniq.back().first - r.first) < 1.0e-9) {
                if (std::fabs(uniq.back().second - r.second) > 1.0e-9)
                    return dfr("quadric/ruling_u_bound_conflict");
                continue;
            }
            uniq.push_back(r);
        }
        if (uniq.size() == 1) {
            // One ruling on a face that still wraps a full turn (a tangent line
            // of contact, not a boundary). It may not MOVE, or the face is being
            // sheared and there is no rectangle for it.
            if (uniq[0].second != 0.0) return dfr("quadric/cyl_face_single_moving_ruling");
            continue;
        }
        if (uniq.size() > 2) {
            // NOT a u-v rectangle. It is built from its own boundary loop by
            // cylTrimmedFace instead — see that function's banner.
            q.notched = true;
            continue;
        }
        gp_Ax3 ax;
        if (!axesOf(q.surf, q.kind, ax)) return dfr("quadric/ruling_axes_failed");
        double us = 0.0;
        if (!uParamAbout(ax, q.smp, us)) return dfr("quadric/ruling_sample_uparam_failed");
        // The two arcs between the rulings; the face is the one holding `smp`.
        double a = uniq[0].first, b = uniq[1].first;
        double da = uniq[0].second, db = uniq[1].second;
        double sweep = b - a;
        while (sweep <= 0.0) sweep += 2.0 * kPi;
        const double usA = liftU(us, a, a + sweep);
        double uStart = a, uEnd = a + sweep, dStart = da, dEnd = db;
        if (!(usA > a && usA < a + sweep)) {            // `smp` is on the OTHER arc
            uStart = b; uEnd = b + (2.0 * kPi - sweep); dStart = db; dEnd = da;
            const double usB = liftU(us, uStart, uEnd);
            if (!(usB > uStart && usB < uEnd)) return dfr("quadric/cyl_face_u_domain_ambiguous");
        }
        // A face whose rulings reproduce the UVBounds interval keeps that
        // interval VERBATIM, so every result this engine already produces is
        // still built on the numbers it was built on.
        if (dStart == 0.0 && dEnd == 0.0 &&
            std::fabs(uStart - q.u1) < 1.0e-9 && std::fabs(uEnd - q.u2) < 1.0e-9) continue;
        q.nu1 = uStart + dStart;
        q.nu2 = uEnd + dEnd;
        if (!(q.nu2 - q.nu1 > 1.0e-9)) return dfr("quadric/cyl_face_u_domain_collapsed");
    }

    // ---- 3b. the polyhedral corner solve, for straight edges only -----------
    // Verbatim the construction planarOffsetShape uses: slide every incident
    // face's outward Hesse plane by `dist` and meet them. The meet is only the
    // offset corner if EVERY incident offset plane actually contains it, so an
    // over-determined apex (which generally has NO exact sharp-join offset) is
    // declined rather than approximated.
    TopTools_IndexedDataMapOfShapeListOfShape vfMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_FACE, vfMap);
    TopTools_IndexedDataMapOfShapeListOfShape veMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_EDGE, veMap);
    std::vector<gp_Pnt> moved(static_cast<std::size_t>(std::max(0, vfMap.Extent())));
    std::vector<bool>   movedOk(static_cast<std::size_t>(std::max(0, vfMap.Extent())), false);
    const double resTol = 1.0e-7 * std::max(1.0, std::fabs(dist));
    for (int i = 1; i <= vfMap.Extent(); ++i) {
        if (!cornerVerts.Contains(vfMap.FindKey(i))) continue;
        std::vector<Plane>  meet;
        std::vector<OffCyl> cyls;
        for (TopTools_ListIteratorOfListOfShape it(vfMap.FindFromIndex(i)); it.More(); it.Next()) {
            const TopoDS_Face nf = TopoDS::Face(it.Value());
            const QF* q = qOf(nf);
            if (!q) return dfr("quadric/corner_face_not_indexed");
            if (q->kind == SK::Plane) {
                Plane pl;
                if (!outwardPlaneOf(nf, pl)) return dfr("quadric/corner_plane_missing");
                pl.d += dist;                          // slide OUTWARD by signed dist
                meet.push_back(pl);
            } else if (q->kind == SK::Cyl) {
                // The OFFSET cylinder, whose radius offsetSurfaceOf already moved
                // the right way for this face's outward normal (r+t on a boss,
                // r-t in a bore). Read it back rather than re-deriving the sign.
                Handle(Geom_CylindricalSurface) oc =
                    Handle(Geom_CylindricalSurface)::DownCast(q->off);
                if (oc.IsNull()) return dfr("quadric/corner_offset_cyl_null");
                OffCyl c;
                c.loc  = oc->Axis().Location();
                c.axis = oc->Axis().Direction();
                c.r    = oc->Radius();
                cyls.push_back(c);
            } else {
                return dfr("quadric/corner_touches_curved_face");
            }
        }
        // The offset RULINGS incident to this vertex. At a seam endpoint they are
        // the only thing that pins it: one cap plane plus the two faces of ONE
        // split cylinder is two independent surface constraints, and their common
        // solution set is a circle.
        std::vector<gp_Lin> rulings;
        {
            const int vi = veMap.FindIndex(vfMap.FindKey(i));
            if (vi != 0)
                for (TopTools_ListIteratorOfListOfShape it(veMap.FindFromIndex(vi)); it.More(); it.Next()) {
                    const int ei = edgeIdx.FindIndex(it.Value());
                    if (ei != 0 && offLineOk[static_cast<std::size_t>(ei) - 1])
                        rulings.push_back(offLine[static_cast<std::size_t>(ei) - 1]);
                }
        }
        gp_Pnt corner;
        const gp_Pnt v0 = BRep_Tool::Pnt(TopoDS::Vertex(vfMap.FindKey(i)));
        // ★ THE ORDER IS THE OLD ORDER, and the ruling solve is only ever reached
        //   where the engine previously returned a DEFER. A vertex that has an
        //   exact corner today is still solved by the code that solved it, so this
        //   increment cannot move a result family H already produces.
        if (meet.empty()) {
            if (!solveOffsetVertexWithRuling(meet, cyls, rulings, v0, resTol, corner))
                return dfr("quadric/corner_no_incident_plane");
        } else if (cyls.empty()) {
            if (!projectOntoOffsetPlanes(meet, v0, resTol, corner))
                return dfr("quadric/corner_overdetermined_residual");
        } else if (!solveOffsetVertexWithCyl(meet, cyls, v0, resTol, corner)) {
            if (!solveOffsetVertexWithRuling(meet, cyls, rulings, v0, resTol, corner))
                return dfr("quadric/corner_cyl_solve_failed");
        }
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
            const gp_Dir N = opl->Position().Direction();   // offset plane normal
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
                } else if (classifyWire(w, ignored) == LoopKind::Mixed) {
                    // A MIXED profile: walk the wire IN ORDER and carry each edge as
                    // what it actually is. A straight run becomes a line between two
                    // solved corners; an arc keeps its EXACT offset supporting circle
                    // and is trimmed to the two solved corners.
                    //
                    // ★ The ORDER comes from BRepTools_WireExplorer, which also gives
                    //   the edge's own traversal direction, and the arc SENSE is read
                    //   from that rather than guessed: the two arcs of a circle
                    //   between the same endpoints enclose different areas, and only
                    //   one of them is this profile's boundary.
                    anyPoly = true;
                    L.isMixed = true;
                    for (BRepTools_WireExplorer wex(w, q.face); wex.More(); wex.Next()) {
                        const TopoDS_Edge  we = wex.Current();
                        const TopoDS_Vertex v0 = wex.CurrentVertex();
                        if (BRep_Tool::Degenerated(we)) return dfr("quadric/mixed_degenerate_edge");
                        const int vi0 = vfMap.FindIndex(v0);
                        if (vi0 == 0 || !movedOk[static_cast<std::size_t>(vi0) - 1])
                            return dfr("quadric/mixed_vertex_not_solved");
                        // the edge's far vertex, in the wire's traversal direction
                        TopoDS_Vertex va, vb;
                        TopExp::Vertices(we, va, vb, Standard_True);
                        const TopoDS_Vertex vfar = v0.IsSame(va) ? vb : va;
                        const int vi1 = vfMap.FindIndex(vfar);
                        if (vi1 == 0 || !movedOk[static_cast<std::size_t>(vi1) - 1])
                            return dfr("quadric/mixed_vertex_not_solved");
                        OffSeg g;
                        g.start = moved[static_cast<std::size_t>(vi0) - 1];
                        g.end   = moved[static_cast<std::size_t>(vi1) - 1];
                        if (!edgeIsLine(we)) {
                            const int ei = edgeIdx.FindIndex(we);
                            if (ei == 0 || !offOk[static_cast<std::size_t>(ei) - 1] ||
                                !offIsArc[static_cast<std::size_t>(ei) - 1])
                                return dfr("quadric/mixed_arc_no_offset_circle");
                            g.isArc = true;
                            g.circ  = offCirc[static_cast<std::size_t>(ei) - 1];
                            // Sense: run the ORIGINAL arc's own direction. The offset
                            // circle is coaxial with the original, so the traversal
                            // sense about the face normal is preserved exactly.
                            //
                            // ★ IT IS READ FROM THE EDGE'S OWN PARAMETRISATION, NOT
                            //   FROM THE CHORD. Increasing parameter on a circle is
                            //   counter-clockwise about ITS axis, and the wire
                            //   explorer says whether this traversal runs with the
                            //   parameter or against it. The chord test that stood
                            //   here is ZERO for a semicircle — its sign is round-off
                            //   — and a full circle carried as two half-arcs is what
                            //   a STEP file emits constantly. MEASURED: three parts
                            //   of family H's deletion bucket died on exactly that.
                            gp_Circ oc0;
                            if (!edgeArcCircle(we, oc0)) return dfr("quadric/mixed_arc_lost");
                            double f0 = 0.0, l0 = 0.0;
                            (void)edgeBasisCurve(we, f0, l0);
                            const bool fwd = (we.Orientation() != TopAbs_REVERSED);
                            const bool axisWithN = oc0.Axis().Direction().Dot(gp_Vec(N)) >= 0.0;
                            g.ccw   = (fwd == axisWithN);
                            g.sweep = std::fabs(l0 - f0);
                        }
                        L.segs.push_back(g);
                    }
                    if (L.segs.size() < 2) return dfr("quadric/mixed_ring_under_2");
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
            if (q.notched) {
                // A cylindrical face with more than two rulings is notched in u,
                // and a u-v rectangle would fill the notch in. Built from its own
                // offset boundary loop, with exact pcurves and an exact area
                // self-check that can SEE a filled notch.
                const char* cwhy = nullptr;
                nf = cylTrimmedFace(q, vfMap, moved, movedOk, edgeIdx, offCirc, offOk,
                                    offLine, offLineOk, &cwhy);
                if (nf.IsNull()) return dfr(cwhy ? cwhy : "quadric/cyltrim_failed");
            } else {
                double a = q.nv1, b = q.nv2;
                if (a > b) std::swap(a, b);
                if (!(b - a > 1.0e-9)) return dfr("quadric/vrange_collapsed");   // v-range inverted / collapsed
                // The u range is the ORIGINAL one unless a ruling moved it (see the U
                // RE-TRIM above), so a full revolution and every face whose seams are
                // co-surface splits or tangent seams rebuild on exactly the numbers
                // they rebuilt on before.
                double ua = q.nu1, ub = q.nu2;
                if (ua > ub) std::swap(ua, ub);
                if (!(ub - ua > 1.0e-9)) return dfr("quadric/urange_collapsed");
                BRepBuilderAPI_MakeFace mk(q.off, ua, ub, a, b, Precision::Confusion());
                if (!mk.IsDone()) return dfr("quadric/makeface_not_done");
                nf = mk.Face();
            }
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
