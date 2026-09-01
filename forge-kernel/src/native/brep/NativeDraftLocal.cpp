// src/native/brep/NativeDraftLocal.cpp — the GENERAL native DRAFT (family J).
//
// Read include/forge/native/brep/NativeDraftLocal.hpp first: it carries the
// measurement that demanded this engine, the construction, the drop hygiene and
// the HONEST-DEFER list. This file carries the derivation and the code.
//
// ===========================================================================
// THE ROTATION — identical to NativeDraft.cpp, and deliberately so
// ===========================================================================
// face plane    {n . x = d}      (n = OUTWARD normal, orientation-honoured)
// neutral plane {m . x = e}      (m flipped so m . pull > 0)
// c = n . m ;  axis dir a = (n x m)/|n x m| ;  |n x m|^2 = 1 - c^2
//     p0 = alpha n + beta m,  alpha = (d - c e)/(1 - c^2),  beta = (e - c d)/(1 - c^2)
//     u  = a x n   (unit, lies in the face plane, perpendicular to the axis)
//     n' = n cos(th) + u sin(th)      d' = n' . p0        th = +angleRad
// The SIGN is BRepOffsetAPI_DraftAngle's own and was MEASURED, not assumed —
// NativeDraft.cpp's first A/B run used -angleRad and came back exactly MIRRORED
// (cube 5 deg: 1185.18 grown against OCCT's 835.23 shrunk). This file reuses the
// same convention so the two engines cannot disagree about which way a wall
// leans, and the A/B compares the SOLIDS so a sign error cannot pass unnoticed.
//
// ===========================================================================
// WHAT IS NEW HERE: THE THREE TOPOLOGICAL CLASSES
// ===========================================================================
// Let W be the set of selected wall faces.
//     movedVertex(v)  :=  v is a vertex of some face in W
//     wallEdge(e)     :=  some face incident to e is in W
//     movedEdge(e)    :=  some vertex of e is moved
//     touchedFace(f)  :=  some vertex of f is moved
//
// Then, and this is the whole engine:
//
//   !touchedFace(f)                    -> the SAME TopoDS_Face, verbatim.
//   !movedEdge(e)                      -> the SAME TopoDS_Edge, verbatim.
//   movedEdge(e) && !wallEdge(e)       -> RE-TRIM: the identical curve and the
//                                         identical pcurves, a new parameter
//                                         range. Exact for any curve type,
//                                         because both surfaces meeting at e
//                                         are untouched, so their meet is too.
//   wallEdge(e)                        -> the meet of the ROTATED plane with the
//                                         neighbour. A line against a plane; a
//                                         DEFER against anything else, because a
//                                         conic section would need a new pcurve
//                                         on the non-planar neighbour and that
//                                         pcurve is an approximation.
//
// A face is rebuilt from f.EmptyCopied(), which keeps its surface, its location
// and its tolerance and drops only its wires; a wire with no moved vertex is
// re-added VERBATIM. That is how a face with a hole survives: the hole's inner
// wire is literally the same wire object.

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/NativeDraftLocal.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <string>
#include <vector>

#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <ElCLib.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Circle.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_Curve.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_Hyperbola.hxx>
#include <Geom_Line.hxx>
#include <Geom_Parabola.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_Surface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_DataMapOfShapeShape.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_MapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Dir.hxx>
#include <gp_Lin.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

namespace forge {
namespace occtdraftlocal {

namespace {

const TopoDS_Shape kNull;

// WHY A DEFER IS NAMEABLE. Every early return below records the reason first and
// draftLocalLastDeferReason() reads it back. Same deferSlot()/defer() pair as
// NativeDraft.cpp and NativeThickenShell.cpp: a silent null tells a caller only
// THAT the engine declined, and a coverage measurement that cannot say WHICH
// guard fired cannot tell a narrow applicability predicate from a capability
// gap. Family J's 0/565 needed a dedicated probe for exactly that reason.
std::string& deferSlot() {
    static thread_local std::string r;
    return r;
}
TopoDS_Shape defer(const std::string& why) {
    deferSlot() = why;
    return kNull;
}

// The per-call path census. Same thread_local discipline as deferSlot(): the
// answer belongs to the ENGINE, so a measurement of it cannot drift from a
// replica of its own logic.
DraftLocalStats& statsSlot() {
    static thread_local DraftLocalStats s;
    return s;
}

constexpr double kPi = 3.14159265358979323846;

bool envOn(const char* name) {
    const char* v = std::getenv(name);
    return v && (*v == '1' || *v == 'y' || *v == 'Y' || *v == 't' || *v == 'T');
}

// ─────────────────────────────────────────────────────────── plane arithmetic
// A plane in Hesse form: n . x = d, with n a UNIT normal.
struct Plane {
    double nx = 0.0, ny = 0.0, nz = 0.0, d = 0.0;
    double residual(const gp_Pnt& p) const {
        return nx * p.X() + ny * p.Y() + nz * p.Z() - d;
    }
};

// Unwrap a Geom_RectangularTrimmedSurface down to its analytic basis. A trimmed
// surface is the SAME surface with a smaller natural parameter box, so drafting
// against it must see the basis or every downcast below fails on a shape that is
// geometrically ordinary.
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

Handle(Geom_Curve) basisCurve(const Handle(Geom_Curve)& c) {
    Handle(Geom_Curve) cur = c;
    for (int guard = 0; guard < 8 && !cur.IsNull(); ++guard) {
        Handle(Geom_TrimmedCurve) tc = Handle(Geom_TrimmedCurve)::DownCast(cur);
        if (tc.IsNull()) break;
        cur = tc->BasisCurve();
    }
    return cur;
}

// Outward unit normal + Hesse offset of a PLANAR face, honouring the face's
// TopAbs orientation (a REVERSED face's outward normal is the flipped plane
// normal). False iff the face is not a Geom_Plane. Same code and same intent as
// NativeDraft.cpp's outwardPlaneOf and NativeThickSolid.cpp's; kept local so the
// TU stays self-contained and the A/B can compile it alone.
bool outwardPlaneOf(const TopoDS_Face& f, Plane& out) {
    Handle(Geom_Surface) s = basisSurface(BRep_Tool::Surface(f));
    Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s);
    if (pl.IsNull()) return false;
    const gp_Pln& gpl = pl->Pln();
    const gp_Dir n = gpl.Axis().Direction();
    double nx = n.X(), ny = n.Y(), nz = n.Z();
    if (f.Orientation() == TopAbs_REVERSED) { nx = -nx; ny = -ny; nz = -nz; }
    const gp_Pnt& o = gpl.Location();
    out.nx = nx; out.ny = ny; out.nz = nz;
    out.d = nx * o.X() + ny * o.Y() + nz * o.Z();
    return true;
}

// Rotate the plane `p` about its intersection line with the neutral plane
// {m . x = e} by `theta`. False iff the two planes are parallel (no axis).
// Derivation in the file header; identical to NativeDraft.cpp.
bool rotatePlaneAboutNeutral(const Plane& p, const gp_Dir& m, double e,
                             double theta, Plane& out) {
    const gp_Vec n(p.nx, p.ny, p.nz);
    const gp_Vec mv(m);
    const double c = n.Dot(mv);
    const double s2 = 1.0 - c * c;                     // = |n x m|^2
    if (s2 < 1.0e-12) return false;                    // parallel: no axis

    const gp_Vec a = n.Crossed(mv) / std::sqrt(s2);    // unit axis direction
    const gp_Vec u = a.Crossed(n);                     // unit, lies IN the plane

    const double alpha = (p.d - c * e) / s2;
    const double beta  = (e - c * p.d) / s2;
    const gp_Vec p0v = n * alpha + mv * beta;          // axis point nearest origin

    const gp_Vec nn = n * std::cos(theta) + u * std::sin(theta);
    out.nx = nn.X(); out.ny = nn.Y(); out.nz = nn.Z();
    out.d  = nn.Dot(p0v);
    return true;
}

// Least-squares meet of k planes by the 3x3 normal equations, with the RANK
// reported rather than assumed. `rank` counts pivots that survive the pivot
// floor, so a caller can tell "no solution" from "a line of solutions" and pick
// a different solve instead of averaging a wrong corner.
// (Shell.cpp / NativeThickSolid.cpp intersectPlanes, plus the rank out-param.)
bool intersectPlanes(const std::vector<Plane>& planes, gp_Pnt& out, int& rank) {
    rank = 0;
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
    // The normal matrix is the sum of k unit outer products, so its pivots are
    // O(1) for independent normals; 1e-9 is a rank test on a NORMALISED system,
    // not a distance tolerance, and it is not the tolerance any assertion below
    // is measured against.
    for (int col = 0; col < 3; ++col) {
        int piv = col;
        for (int r = col + 1; r < 3; ++r)
            if (std::fabs(M[r][col]) > std::fabs(M[piv][col])) piv = r;
        if (std::fabs(M[piv][col]) < 1.0e-9) continue;
        ++rank;
        if (piv != col) for (int k = 0; k < 4; ++k) std::swap(M[col][k], M[piv][k]);
        for (int r = 0; r < 3; ++r) {
            if (r == col) continue;
            const double fct = M[r][col] / M[col][col];
            for (int k = col; k < 4; ++k) M[r][k] -= fct * M[col][k];
        }
    }
    if (rank < 3) return false;
    out.SetCoord(M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]);
    return true;
}

// The LINE of solutions of a rank-2 plane system: take the two most independent
// normals, cross them for the direction, and meet them for a point on it.
bool planeSystemLine(const std::vector<Plane>& planes, gp_Lin& out) {
    for (std::size_t i = 0; i < planes.size(); ++i) {
        const gp_Vec ni(planes[i].nx, planes[i].ny, planes[i].nz);
        for (std::size_t j = i + 1; j < planes.size(); ++j) {
            const gp_Vec nj(planes[j].nx, planes[j].ny, planes[j].nz);
            const gp_Vec dir = ni.Crossed(nj);
            const double s2 = dir.SquareMagnitude();
            if (s2 < 1.0e-12) continue;              // parallel pair, try another
            const double c = ni.Dot(nj);
            const double den = 1.0 - c * c;
            if (std::fabs(den) < 1.0e-12) continue;
            const double alpha = (planes[i].d - c * planes[j].d) / den;
            const double beta  = (planes[j].d - c * planes[i].d) / den;
            const gp_Vec p0 = ni * alpha + nj * beta;
            out = gp_Lin(gp_Pnt(p0.X(), p0.Y(), p0.Z()),
                         gp_Dir(dir.X(), dir.Y(), dir.Z()));
            return true;
        }
    }
    return false;
}

// ────────────────────────────────────────────────── analytic surface residuals
// The SIGNED implicit residual of a point against an analytic surface, in LENGTH
// units so one tolerance means the same thing on every kind. This is the whole
// verification apparatus: a moved vertex is accepted only if it is on EVERY
// surface it is supposed to be on, and "on" is measured here.
//
// kUnverifiable is not a failure — it is the honest answer for a B-spline or a
// surface of revolution, whose implicit form this file does not carry. A vertex
// touching one of those is accepted ONLY when an anchor edge lying on that very
// face produced it, which puts it on the surface by construction (see
// solveMovedVertex). It is never accepted on the strength of an unmeasured
// residual.
enum class SurfKind { Plane, Cylinder, Cone, Sphere, Torus, Unverifiable };

SurfKind classifySurface(const Handle(Geom_Surface)& raw) {
    const Handle(Geom_Surface) s = basisSurface(raw);
    if (s.IsNull()) return SurfKind::Unverifiable;
    if (!Handle(Geom_Plane)::DownCast(s).IsNull())               return SurfKind::Plane;
    if (!Handle(Geom_CylindricalSurface)::DownCast(s).IsNull())  return SurfKind::Cylinder;
    if (!Handle(Geom_ConicalSurface)::DownCast(s).IsNull())      return SurfKind::Cone;
    if (!Handle(Geom_SphericalSurface)::DownCast(s).IsNull())    return SurfKind::Sphere;
    if (!Handle(Geom_ToroidalSurface)::DownCast(s).IsNull())     return SurfKind::Torus;
    return SurfKind::Unverifiable;
}

// False iff the surface kind has no implicit form here.
bool surfaceResidual(const Handle(Geom_Surface)& raw, const gp_Pnt& p, double& res) {
    const Handle(Geom_Surface) s = basisSurface(raw);
    if (s.IsNull()) return false;

    if (Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s); !pl.IsNull()) {
        const gp_Pln& g = pl->Pln();
        const gp_Dir n = g.Axis().Direction();
        const gp_Pnt& o = g.Location();
        res = n.X() * (p.X() - o.X()) + n.Y() * (p.Y() - o.Y()) + n.Z() * (p.Z() - o.Z());
        return true;
    }
    if (Handle(Geom_CylindricalSurface) cy =
            Handle(Geom_CylindricalSurface)::DownCast(s); !cy.IsNull()) {
        const gp_Ax1 ax = cy->Axis();
        const gp_Vec w(ax.Location(), p);
        const gp_Vec a(ax.Direction());
        const gp_Vec perp = w - a * w.Dot(a);
        res = perp.Magnitude() - cy->Radius();
        return true;
    }
    if (Handle(Geom_ConicalSurface) co =
            Handle(Geom_ConicalSurface)::DownCast(s); !co.IsNull()) {
        // Geom_ConicalSurface: radius at axial coordinate v is RefRadius + v*tan(alpha),
        // v measured from Location along Axis. The residual is the RADIAL gap, which
        // is a length everywhere except at the apex where the cone is not a manifold.
        const gp_Ax1 ax = co->Axis();
        const gp_Vec w(ax.Location(), p);
        const gp_Vec a(ax.Direction());
        const double v = w.Dot(a);
        const gp_Vec perp = w - a * v;
        res = perp.Magnitude() - (co->RefRadius() + v * std::tan(co->SemiAngle()));
        return true;
    }
    if (Handle(Geom_SphericalSurface) sp =
            Handle(Geom_SphericalSurface)::DownCast(s); !sp.IsNull()) {
        res = p.Distance(sp->Location()) - sp->Radius();
        return true;
    }
    if (Handle(Geom_ToroidalSurface) to =
            Handle(Geom_ToroidalSurface)::DownCast(s); !to.IsNull()) {
        const gp_Ax1 ax = to->Axis();
        const gp_Vec w(ax.Location(), p);
        const gp_Vec a(ax.Direction());
        const double z = w.Dot(a);
        const gp_Vec perp = w - a * z;
        const double rho = perp.Magnitude() - to->MajorRadius();
        res = std::sqrt(rho * rho + z * z) - to->MinorRadius();
        return true;
    }
    return false;
}

// ───────────────────────────────────────────────────── curve parameter solving
// Where on `c` is `target`? Exact by ElCLib for the elementary curves (TKMath),
// and a bracketed Newton with a sampled start for everything else. `dist` is
// returned so the CALLER decides whether the answer is good enough — this
// function never decides that, because a projection that quietly accepts a
// far-away foot is how a wrong vertex gets a plausible parameter.
bool curveParamAt(const Handle(Geom_Curve)& c, double lo, double hi,
                  const gp_Pnt& target, double& t, double& dist) {
    if (c.IsNull() || !(hi > lo)) return false;
    const Handle(Geom_Curve) b = basisCurve(c);
    if (b.IsNull()) return false;

    bool haveAnalytic = false;
    double period = 0.0;
    if (Handle(Geom_Line) ln = Handle(Geom_Line)::DownCast(b); !ln.IsNull()) {
        t = ElCLib::Parameter(ln->Lin(), target);
        haveAnalytic = true;
    } else if (Handle(Geom_Circle) ci = Handle(Geom_Circle)::DownCast(b); !ci.IsNull()) {
        t = ElCLib::Parameter(ci->Circ(), target);
        period = 2.0 * kPi;
        haveAnalytic = true;
    } else if (Handle(Geom_Ellipse) el = Handle(Geom_Ellipse)::DownCast(b); !el.IsNull()) {
        t = ElCLib::Parameter(el->Elips(), target);
        period = 2.0 * kPi;
        haveAnalytic = true;
    } else if (Handle(Geom_Hyperbola) hy = Handle(Geom_Hyperbola)::DownCast(b); !hy.IsNull()) {
        t = ElCLib::Parameter(hy->Hypr(), target);
        haveAnalytic = true;
    } else if (Handle(Geom_Parabola) pa = Handle(Geom_Parabola)::DownCast(b); !pa.IsNull()) {
        t = ElCLib::Parameter(pa->Parab(), target);
        haveAnalytic = true;
    }

    if (haveAnalytic) {
        // A periodic parameter must be lifted into the EDGE's own range, not
        // into [0, 2pi): an arc from 5.9 to 6.5 rad is a real edge and its
        // parameters are not reduced.
        if (period > 0.0) t = ElCLib::InPeriod(t, lo, lo + period);
        dist = c->Value(t).Distance(target);
        return true;
    }

    // General curve: seed by sampling, then Newton on f(t) = (C(t) - P) . C'(t),
    // which is the stationary condition of the squared distance. Clamped to the
    // edge's own range throughout, so it can only return a point of THIS edge.
    const int kSamples = 96;
    double bestT = lo, bestD = 1.0e300;
    for (int i = 0; i <= kSamples; ++i) {
        const double u = lo + (hi - lo) * (static_cast<double>(i) / kSamples);
        const double dd = b->Value(u).Distance(target);
        if (dd < bestD) { bestD = dd; bestT = u; }
    }
    double u = bestT;
    for (int it = 0; it < 40; ++it) {
        gp_Pnt pnt; gp_Vec d1, d2;
        b->D2(u, pnt, d1, d2);
        const gp_Vec w(target, pnt);            // C(u) - P  is -w; sign cancels below
        const double f  = -(w.Dot(d1));
        const double fp = -(w.Dot(d2)) + d1.Dot(d1);
        if (std::fabs(fp) < 1.0e-18) break;
        double next = u - f / fp;
        if (next < lo) next = lo;
        if (next > hi) next = hi;
        if (std::fabs(next - u) < 1.0e-15 * std::max(1.0, std::fabs(u))) { u = next; break; }
        u = next;
    }
    t = u;
    dist = b->Value(t).Distance(target);
    return true;
}

// Slide along `c` to the plane {n . x = d}: the root of g(t) = n . C(t) - d.
// Bisection FIRST (a sign change on the edge's own range is a guarantee), then
// Newton polish. Falls back to a widened bracket only when the root lies just
// outside the range, which is the ordinary case for a vertex that moves OFF the
// end of its edge — and the caller still verifies the point afterwards.
bool curveMeetPlane(const Handle(Geom_Curve)& c, double lo, double hi,
                    const Plane& pl, const gp_Pnt& near, double& t) {
    if (c.IsNull()) return false;
    const Handle(Geom_Curve) b = basisCurve(c);
    if (b.IsNull()) return false;
    auto g = [&](double u) {
        const gp_Pnt p = b->Value(u);
        return pl.nx * p.X() + pl.ny * p.Y() + pl.nz * p.Z() - pl.d;
    };
    // Search a bracket over the edge's range, then over a range widened by half
    // its own length on each side. Never wider: a root two edges away is not
    // this vertex's root.
    const double span = hi - lo;
    for (int pass = 0; pass < 2; ++pass) {
        const double a0 = (pass == 0) ? lo : lo - 0.5 * span;
        const double a1 = (pass == 0) ? hi : hi + 0.5 * span;
        const int kSteps = 128;
        double prevU = a0, prevG = g(a0);
        double bestLo = 0.0, bestHi = 0.0, bestScore = 1.0e300;
        bool found = false;
        for (int i = 1; i <= kSteps; ++i) {
            const double u = a0 + (a1 - a0) * (static_cast<double>(i) / kSteps);
            const double gu = g(u);
            if ((prevG <= 0.0 && gu >= 0.0) || (prevG >= 0.0 && gu <= 0.0)) {
                // Several roots can bracket on a wavy curve; take the one whose
                // midpoint is nearest the vertex being moved.
                const double mid = 0.5 * (prevU + u);
                const double score = b->Value(mid).Distance(near);
                if (score < bestScore) { bestScore = score; bestLo = prevU; bestHi = u; found = true; }
            }
            prevU = u; prevG = gu;
        }
        if (!found) continue;
        double x0 = bestLo, x1 = bestHi;
        double g0 = g(x0);
        for (int it = 0; it < 200; ++it) {
            const double xm = 0.5 * (x0 + x1);
            const double gm = g(xm);
            if ((g0 <= 0.0) == (gm <= 0.0)) { x0 = xm; g0 = gm; } else { x1 = xm; }
            if (std::fabs(x1 - x0) < 1.0e-16 * std::max(1.0, std::fabs(xm))) break;
        }
        t = 0.5 * (x0 + x1);
        return true;
    }
    return false;
}

// ─────────────────────────────────────────────── line versus analytic quadric
// The two real roots of a line against a cylinder / sphere / cone, in closed
// form, with the root NEAREST the original vertex returned. Torus is not solved
// here (it is a quartic); a torus reaches this path only through the residual
// check, which will decline it.
bool lineMeetQuadric(const gp_Lin& L, const Handle(Geom_Surface)& raw,
                     const gp_Pnt& near, gp_Pnt& out) {
    const Handle(Geom_Surface) s = basisSurface(raw);
    if (s.IsNull()) return false;
    const gp_Pnt P = L.Location();
    const gp_Vec D(L.Direction());

    double A = 0.0, B = 0.0, C = 0.0;
    if (Handle(Geom_SphericalSurface) sp =
            Handle(Geom_SphericalSurface)::DownCast(s); !sp.IsNull()) {
        const gp_Vec w(sp->Location(), P);
        A = D.Dot(D);
        B = 2.0 * w.Dot(D);
        C = w.Dot(w) - sp->Radius() * sp->Radius();
    } else if (Handle(Geom_CylindricalSurface) cy =
            Handle(Geom_CylindricalSurface)::DownCast(s); !cy.IsNull()) {
        const gp_Ax1 ax = cy->Axis();
        const gp_Vec a(ax.Direction());
        const gp_Vec w(ax.Location(), P);
        const gp_Vec wp = w - a * w.Dot(a);
        const gp_Vec dp = D - a * D.Dot(a);
        A = dp.Dot(dp);
        B = 2.0 * wp.Dot(dp);
        C = wp.Dot(wp) - cy->Radius() * cy->Radius();
    } else if (Handle(Geom_ConicalSurface) co =
            Handle(Geom_ConicalSurface)::DownCast(s); !co.IsNull()) {
        // |perp(w + tD)|^2 = (R0 + tan(alpha) * axial(w + tD))^2
        const gp_Ax1 ax = co->Axis();
        const gp_Vec a(ax.Direction());
        const gp_Vec w(ax.Location(), P);
        const double k  = std::tan(co->SemiAngle());
        const double wz = w.Dot(a), dz = D.Dot(a);
        const gp_Vec wp = w - a * wz;
        const gp_Vec dp = D - a * dz;
        const double r0 = co->RefRadius();
        A = dp.Dot(dp) - k * k * dz * dz;
        B = 2.0 * (wp.Dot(dp) - k * dz * (r0 + k * wz));
        C = wp.Dot(wp) - (r0 + k * wz) * (r0 + k * wz);
    } else {
        return false;
    }

    if (std::fabs(A) < 1.0e-15) {
        if (std::fabs(B) < 1.0e-15) return false;
        out = P.Translated(D * (-C / B));
        return true;
    }
    const double disc = B * B - 4.0 * A * C;
    if (disc < 0.0) return false;
    const double sq = std::sqrt(disc);
    const double t1 = (-B - sq) / (2.0 * A);
    const double t2 = (-B + sq) / (2.0 * A);
    const gp_Pnt p1 = P.Translated(D * t1);
    const gp_Pnt p2 = P.Translated(D * t2);
    out = (p1.Distance(near) <= p2.Distance(near)) ? p1 : p2;
    return true;
}

// ─────────────────────────────────────────────────────────── per-vertex record
struct MovedVertex {
    gp_Pnt pos;                    // the solved new position
    bool solved = false;
    // The anchor edge the solve used, if it used one, together with the
    // parameter it found there. The RE-TRIM reads this back rather than
    // re-projecting, so the edge and the vertex cannot disagree.
    TopoDS_Edge anchor;
    double anchorParam = 0.0;
    bool haveAnchor = false;
};

}  // namespace

bool draftLocalEnabled() {
#ifdef FORGE_DRAFT_DROP_NATIVE
    return true;   // the OCCT fallback is compiled out; this is part of the only path
#else
    static const bool on = envOn("FORGE_DRAFT_NATIVE");
    return on;
#endif
}

const char* draftLocalLastDeferReason() {
    return deferSlot().c_str();
}

const DraftLocalStats& draftLocalLastStats() {
    return statsSlot();
}

TopoDS_Shape draftFacesLocal(const TopoDS_Shape& shape,
                             const TopTools_ListOfShape& faces,
                             const gp_Dir& pull,
                             double angleRad,
                             const gp_Pln& neutral,
                             double tol) {
    deferSlot().clear();
    statsSlot() = DraftLocalStats();
    if (shape.IsNull()) return defer("input shape is null");
    if (faces.IsEmpty()) return defer("no faces selected");
    if (!(std::fabs(angleRad) > 1.0e-12))
        return defer("angle is zero (a no-op is not a draft)");
    if (std::fabs(angleRad) >= 0.5 * kPi - 1.0e-9)
        return defer("|angle| >= 90 degrees");

    // ---- 0. the neutral plane, oriented along the PULL direction -----------
    gp_Dir m = neutral.Axis().Direction();
    if (gp_Vec(m).Dot(gp_Vec(pull)) < 0.0) m.Reverse();
    const gp_Pnt no = neutral.Location();
    const double e = m.X() * no.X() + m.Y() * no.Y() + m.Z() * no.Z();
    const double theta = angleRad;   // SIGN: see the file header. MEASURED.

    // ---- 1. topology maps --------------------------------------------------
    TopTools_IndexedMapOfShape faceMap, edgeMap, vertMap;
    TopExp::MapShapes(shape, TopAbs_FACE, faceMap);
    TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);
    TopExp::MapShapes(shape, TopAbs_VERTEX, vertMap);
    if (faceMap.IsEmpty()) return defer("the shape has no faces");

    // A non-identity Location on a face would make its wires live in a composed
    // frame, and a silently mis-composed frame is a wrong part. Declined, named.
    for (int i = 1; i <= faceMap.Extent(); ++i)
        if (!faceMap(i).Location().IsIdentity())
            return defer("a face carries a non-identity location");

    TopTools_IndexedDataMapOfShapeListOfShape edgeFaces, vertFaces, vertEdges;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_FACE, vertFaces);
    TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_EDGE, vertEdges);

    // ---- 2. the walls, and their ROTATED planes ----------------------------
    TopTools_MapOfShape wantFaces;
    for (TopTools_ListIteratorOfListOfShape it(faces); it.More(); it.Next())
        wantFaces.Add(it.Value());

    // wallPlane[i] is the rotated OUTWARD plane of face i, for wall faces only.
    std::vector<Plane> wallPlane(static_cast<std::size_t>(faceMap.Extent()));
    std::vector<char>  isWall(static_cast<std::size_t>(faceMap.Extent()), 0);
    int nWalls = 0;
    for (int i = 1; i <= faceMap.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(faceMap(i));
        if (!wantFaces.Contains(f)) continue;
        Plane pl;
        if (!outwardPlaneOf(f, pl))
            return defer("a selected face is not a plane");
        Plane rot;
        if (!rotatePlaneAboutNeutral(pl, m, e, theta, rot))
            return defer("a selected face is parallel to the neutral plane (no rotation axis)");
        wallPlane[static_cast<std::size_t>(i) - 1] = rot;
        isWall[static_cast<std::size_t>(i) - 1] = 1;
        ++nWalls;
    }
    // Every requested face must have been found. A face silently dropped here
    // would emit a HALF-DRAFTED part that looks plausible.
    if (nWalls != wantFaces.Extent())
        return defer("a requested face is not present on the shape");
    if (nWalls == 0) return defer("no face selected");

    // ---- 2b. the capability precondition, checked BEFORE anything is solved -
    // A drafted wall's edges become the meet of its ROTATED plane with each
    // neighbour. Against a plane that is a line; against a cylinder, cone,
    // sphere or spline it is a conic or worse, which would need a NEW pcurve on
    // that non-planar neighbour — and a fitted pcurve is an approximation this
    // engine will not make silently. Detected here, at its cause, so the defer
    // reason names the capability gap instead of the downstream symptom it
    // produces three stages later (a vertex that misses one of its own planes).
    for (int ei = 1; ei <= edgeMap.Extent(); ++ei) {
        bool onWall = false, curvedNeighbour = false;
        for (TopTools_ListIteratorOfListOfShape it(edgeFaces.FindFromIndex(ei));
             it.More(); it.Next()) {
            const int fi = faceMap.FindIndex(it.Value());
            if (fi == 0) return defer("an edge is incident to a face not on the shape");
            if (isWall[static_cast<std::size_t>(fi) - 1]) { onWall = true; continue; }
            if (classifySurface(BRep_Tool::Surface(TopoDS::Face(it.Value()))) != SurfKind::Plane)
                curvedNeighbour = true;
        }
        if (onWall && curvedNeighbour)
            return defer("a drafted wall meets a non-planar face (the new edge would be "
                         "a conic needing a new pcurve)");
    }

    // ---- 3. the three topological classes ----------------------------------
    auto faceIsWall = [&](const TopoDS_Shape& f) {
        const int idx = faceMap.FindIndex(f);
        return idx != 0 && isWall[static_cast<std::size_t>(idx) - 1] != 0;
    };

    std::vector<char> movedVert(static_cast<std::size_t>(vertMap.Extent()), 0);
    for (int i = 1; i <= faceMap.Extent(); ++i) {
        if (!isWall[static_cast<std::size_t>(i) - 1]) continue;
        for (TopExp_Explorer vx(faceMap(i), TopAbs_VERTEX); vx.More(); vx.Next()) {
            const int vi = vertMap.FindIndex(vx.Current());
            if (vi != 0) movedVert[static_cast<std::size_t>(vi) - 1] = 1;
        }
    }

    auto vertexMoved = [&](const TopoDS_Shape& v) {
        const int vi = vertMap.FindIndex(v);
        return vi != 0 && movedVert[static_cast<std::size_t>(vi) - 1] != 0;
    };
    auto edgeIsWall = [&](const TopoDS_Shape& ed) {
        const int ei = edgeMap.FindIndex(ed);
        if (ei == 0) return false;
        for (TopTools_ListIteratorOfListOfShape it(edgeFaces.FindFromKey(edgeMap(ei)));
             it.More(); it.Next())
            if (faceIsWall(it.Value())) return true;
        return false;
    };
    auto edgeMoved = [&](const TopoDS_Shape& ed) {
        for (TopExp_Explorer vx(ed, TopAbs_VERTEX); vx.More(); vx.Next())
            if (vertexMoved(vx.Current())) return true;
        return false;
    };

    // The residual bound scales with the model so it means the same thing on a
    // 1 mm part and a 1 m one. It is DERIVED from the input's own extent and is
    // never widened to make a part fit — a tolerance widened until the last part
    // fits is not a tolerance.
    double extent = 1.0;
    for (int i = 1; i <= vertMap.Extent(); ++i) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vertMap(i)));
        extent = std::max(extent, std::max(std::fabs(p.X()),
                          std::max(std::fabs(p.Y()), std::fabs(p.Z()))));
    }
    const double resTol = 1.0e-7 * extent;

    // ---- 4. solve every moved vertex ---------------------------------------
    std::vector<MovedVertex> moved(static_cast<std::size_t>(vertMap.Extent()));

    for (int vi = 1; vi <= vertMap.Extent(); ++vi) {
        if (!movedVert[static_cast<std::size_t>(vi) - 1]) continue;
        const TopoDS_Vertex v = TopoDS::Vertex(vertMap(vi));
        const gp_Pnt oldP = BRep_Tool::Pnt(v);

        // Constraints, split by what this file can verify.
        std::vector<Plane> planes;                    // rotated walls + still planes
        std::vector<Handle(Geom_Surface)> quadrics;   // analytic, non-planar
        std::vector<TopoDS_Face> unverifiable;        // no implicit form here
        for (TopTools_ListIteratorOfListOfShape it(vertFaces.FindFromKey(v));
             it.More(); it.Next()) {
            const TopoDS_Face f = TopoDS::Face(it.Value());
            const int fi = faceMap.FindIndex(f);
            if (fi == 0) return defer("a vertex is incident to a face not on the shape");
            if (isWall[static_cast<std::size_t>(fi) - 1]) {
                planes.push_back(wallPlane[static_cast<std::size_t>(fi) - 1]);
                continue;
            }
            const Handle(Geom_Surface) s = BRep_Tool::Surface(f);
            switch (classifySurface(s)) {
                case SurfKind::Plane: {
                    Plane pl;
                    if (!outwardPlaneOf(f, pl))
                        return defer("a planar neighbour would not yield its plane");
                    planes.push_back(pl);
                    break;
                }
                case SurfKind::Unverifiable: unverifiable.push_back(f); break;
                default:                     quadrics.push_back(s);     break;
            }
        }

        // Anchor edges: incident edges NOT on any wall. Their curve is untouched,
        // so the vertex slides along one of them.
        std::vector<TopoDS_Edge> anchors;
        for (TopTools_ListIteratorOfListOfShape it(vertEdges.FindFromKey(v));
             it.More(); it.Next()) {
            if (edgeIsWall(it.Value())) continue;
            if (BRep_Tool::Degenerated(TopoDS::Edge(it.Value()))) continue;
            anchors.push_back(TopoDS::Edge(it.Value()));
        }

        MovedVertex& rec = moved[static_cast<std::size_t>(vi) - 1];

        // ── solve 1: rank-3 linear meet. Closed form, no iteration. ─────────
        int rank = 0;
        gp_Pnt cand;
        bool have = false;
        ++statsSlot().movedVertices;
        if (planes.size() >= 3 && intersectPlanes(planes, cand, rank)) {
            have = true;
            ++statsSlot().solvedByPlaneMeet;
        }

        // ── solve 2: slide along an anchor curve onto ONE rotated plane. ────
        if (!have && !anchors.empty() && !planes.empty()) {
            for (const TopoDS_Edge& a : anchors) {
                double lo = 0.0, hi = 0.0;
                const Handle(Geom_Curve) c = BRep_Tool::Curve(a, lo, hi);
                if (c.IsNull()) continue;
                double t = 0.0;
                if (!curveMeetPlane(c, lo, hi, planes[0], oldP, t)) continue;
                const gp_Pnt p = basisCurve(c)->Value(t);
                cand = p;
                rec.anchor = a;
                rec.anchorParam = t;
                rec.haveAnchor = true;
                have = true;
                ++statsSlot().solvedByAnchor;
                break;
            }
        }

        // ── solve 3: two rotated planes meet in a line; cut it with the one
        //    incident quadric, taking the root nearest the original vertex. ──
        if (!have && planes.size() >= 2 && quadrics.size() == 1) {
            gp_Lin L;
            if (planeSystemLine(planes, L) && lineMeetQuadric(L, quadrics[0], oldP, cand)) {
                have = true;
                ++statsSlot().solvedByQuadric;
            }
        }

        if (!have)
            return defer("a moved vertex has no solvable constraint set (" +
                         std::to_string(planes.size()) + " planes, " +
                         std::to_string(quadrics.size()) + " quadrics, " +
                         std::to_string(anchors.size()) + " anchors)");

        // ── VERIFY against EVERY constraint, whichever solve produced it. ───
        for (const Plane& pl : planes)
            if (std::fabs(pl.residual(cand)) > resTol)
                return defer("a moved vertex misses one of its own planes");
        for (const Handle(Geom_Surface)& q : quadrics) {
            double r = 0.0;
            if (!surfaceResidual(q, cand, r))
                return defer("an incident analytic surface has no implicit form");
            if (std::fabs(r) > resTol)
                return defer("a moved vertex misses one of its own analytic surfaces");
        }
        // A face this file cannot verify is accepted ONLY when the anchor edge
        // that produced the point lies on it — then the point is on that surface
        // by construction and not by an unmeasured claim.
        for (const TopoDS_Face& f : unverifiable) {
            bool onIt = false;
            if (rec.haveAnchor) {
                for (TopTools_ListIteratorOfListOfShape it(edgeFaces.FindFromKey(rec.anchor));
                     it.More(); it.Next())
                    if (it.Value().IsSame(f)) { onIt = true; break; }
            }
            if (!onIt)
                return defer("a moved vertex touches a surface this engine cannot verify it is on");
        }

        rec.pos = cand;
        rec.solved = true;
    }

    // ---- 5. build the replacement vertices ---------------------------------
    BRep_Builder bb;
    TopTools_DataMapOfShapeShape newVert, newEdgeMap, newFaceMap;
    for (int vi = 1; vi <= vertMap.Extent(); ++vi) {
        if (!movedVert[static_cast<std::size_t>(vi) - 1]) continue;
        const TopoDS_Vertex v = TopoDS::Vertex(vertMap(vi));
        TopoDS_Vertex nv;
        bb.MakeVertex(nv, moved[static_cast<std::size_t>(vi) - 1].pos,
                      std::max(BRep_Tool::Tolerance(v), tol));
        newVert.Bind(v.Oriented(TopAbs_FORWARD), nv);
    }
    auto vertexFor = [&](const TopoDS_Vertex& v) {
        const TopoDS_Shape key = v.Oriented(TopAbs_FORWARD);
        return newVert.IsBound(key) ? TopoDS::Vertex(newVert.Find(key)) : v;
    };

    // ---- 6. build the replacement edges ------------------------------------
    // `rebuiltNotRetrim` marks the edges whose CURVE changed. A non-planar face
    // carrying one of those cannot be rebuilt without a new pcurve, and that is
    // the one thing this engine will not approximate.
    TopTools_MapOfShape rebuiltNotRetrim;

    for (int ei = 1; ei <= edgeMap.Extent(); ++ei) {
        const TopoDS_Edge oldE = TopoDS::Edge(edgeMap(ei).Oriented(TopAbs_FORWARD));
        if (!edgeMoved(oldE)) { ++statsSlot().edgesVerbatim; continue; }   // verbatim

        if (BRep_Tool::Degenerated(oldE))
            return defer("a degenerate edge would have to move");

        TopoDS_Vertex v0, v1;
        TopExp::Vertices(oldE, v0, v1);
        if (v0.IsNull() || v1.IsNull())
            return defer("a moved edge has no vertices");
        const TopoDS_Vertex n0 = vertexFor(v0);
        const TopoDS_Vertex n1 = vertexFor(v1);
        const gp_Pnt p0 = BRep_Tool::Pnt(n0);
        const gp_Pnt p1 = BRep_Tool::Pnt(n1);

        double lo = 0.0, hi = 0.0;
        const Handle(Geom_Curve) c3d = BRep_Tool::Curve(oldE, lo, hi);
        if (c3d.IsNull())
            return defer("a moved edge has no 3-D curve");

        TopoDS_Edge ne;
        double t0 = 0.0, t1 = 0.0;

        if (!edgeIsWall(oldE)) {
            // ── RE-TRIM. Both surfaces meeting here are untouched, so the curve
            // and every pcurve on it are untouched too. EmptyCopied keeps all of
            // them; only the range and the vertices change. Exact for ANY curve.
            ne = TopoDS::Edge(oldE.EmptyCopied());
            ++statsSlot().edgesRetrimmed;
            double d0 = 0.0, d1 = 0.0;
            // A vertex that did not move keeps its own parameter exactly; only a
            // moved one is re-solved, and if the SOLVE used this very edge the
            // parameter is the one it already found.
            const MovedVertex* r0 = nullptr;
            const MovedVertex* r1 = nullptr;
            {
                const int i0 = vertMap.FindIndex(v0), i1 = vertMap.FindIndex(v1);
                if (i0 != 0 && movedVert[static_cast<std::size_t>(i0) - 1])
                    r0 = &moved[static_cast<std::size_t>(i0) - 1];
                if (i1 != 0 && movedVert[static_cast<std::size_t>(i1) - 1])
                    r1 = &moved[static_cast<std::size_t>(i1) - 1];
            }
            if (r0 == nullptr) { t0 = lo; d0 = 0.0; }
            else if (r0->haveAnchor && r0->anchor.IsSame(oldE)) { t0 = r0->anchorParam; d0 = 0.0; }
            else if (!curveParamAt(c3d, lo, hi, p0, t0, d0))
                return defer("a re-trimmed edge would not yield a parameter");
            if (r1 == nullptr) { t1 = hi; d1 = 0.0; }
            else if (r1->haveAnchor && r1->anchor.IsSame(oldE)) { t1 = r1->anchorParam; d1 = 0.0; }
            else if (!curveParamAt(c3d, lo, hi, p1, t1, d1))
                return defer("a re-trimmed edge would not yield a parameter");
            if (d0 > resTol || d1 > resTol)
                return defer("a re-trimmed edge does not pass through its own new vertex");
            if (!(t1 > t0))
                return defer("a re-trimmed edge would have a non-increasing range");
        } else {
            // ── WALL EDGE. Its curve is the meet of the ROTATED plane with the
            // neighbour. Only the plane/plane case is exact without a new
            // pcurve on a curved surface, so only that case is built.
            std::vector<Plane> two;
            bool neighbourNonPlanar = false;
            for (TopTools_ListIteratorOfListOfShape it(edgeFaces.FindFromKey(edgeMap(ei)));
                 it.More(); it.Next()) {
                const TopoDS_Face f = TopoDS::Face(it.Value());
                const int fi = faceMap.FindIndex(f);
                if (fi == 0) return defer("an edge is incident to a face not on the shape");
                if (isWall[static_cast<std::size_t>(fi) - 1]) {
                    two.push_back(wallPlane[static_cast<std::size_t>(fi) - 1]);
                } else {
                    Plane pl;
                    if (!outwardPlaneOf(f, pl)) { neighbourNonPlanar = true; break; }
                    two.push_back(pl);
                }
            }
            if (neighbourNonPlanar)
                return defer("a drafted wall meets a non-planar face (the new edge would be a conic needing a new pcurve)");
            gp_Lin L;
            if (two.size() < 2 || !planeSystemLine(two, L))
                return defer("a wall edge's two planes do not meet in a line");

            // The two new vertices were solved against these same planes, so
            // they MUST lie on this line. Checking it is what makes the line a
            // cross-check of the vertex solve rather than a restatement of it.
            const gp_Vec w0(L.Location(), p0), w1(L.Location(), p1);
            const gp_Vec dirv(L.Direction());
            if ((w0 - dirv * w0.Dot(dirv)).Magnitude() > resTol ||
                (w1 - dirv * w1.Dot(dirv)).Magnitude() > resTol)
                return defer("a rebuilt wall edge does not pass through its own new vertices");

            // The edge's own line runs FROM p0 TOWARDS p1, so its parameter
            // order is fixed by construction and cannot depend on which pair of
            // planes planeSystemLine happened to cross. The meet direction stays
            // a cross-check: the built direction must be parallel to it.
            const gp_Vec seg(p0, p1);
            if (seg.Magnitude() <= resTol)
                return defer("a rebuilt wall edge collapsed to a point");
            const gp_Dir segDir(seg);
            if (std::fabs(segDir.Dot(L.Direction())) < 1.0 - 1.0e-9)
                return defer("a rebuilt wall edge is not parallel to its own plane meet");
            const gp_Lin edgeLin(p0, segDir);
            const Handle(Geom_Line) nl = new Geom_Line(edgeLin);
            bb.MakeEdge(ne, nl, std::max(tol, BRep_Tool::Tolerance(oldE)));
            t0 = 0.0;
            t1 = seg.Magnitude();
            ++statsSlot().edgesRebuilt;
            rebuiltNotRetrim.Add(edgeMap(ei));
        }

        bb.Add(ne, n0.Oriented(TopAbs_FORWARD));
        bb.Add(ne, n1.Oriented(TopAbs_REVERSED));
        bb.UpdateVertex(TopoDS::Vertex(n0.Oriented(TopAbs_FORWARD)), t0, ne, tol);
        bb.UpdateVertex(TopoDS::Vertex(n1.Oriented(TopAbs_REVERSED)), t1, ne, tol);
        bb.Range(ne, t0, t1);
        newEdgeMap.Bind(edgeMap(ei), ne);
    }
    auto edgeFor = [&](const TopoDS_Shape& ed) {
        const TopoDS_Shape key = ed.Oriented(TopAbs_FORWARD);
        return newEdgeMap.IsBound(key) ? newEdgeMap.Find(key).Oriented(ed.Orientation())
                                       : ed;
    };

    // ---- 7. build the replacement faces ------------------------------------
    for (int fi = 1; fi <= faceMap.Extent(); ++fi) {
        const TopoDS_Face oldF = TopoDS::Face(faceMap(fi).Oriented(TopAbs_FORWARD));
        bool touched = false;
        for (TopExp_Explorer vx(oldF, TopAbs_VERTEX); vx.More(); vx.Next())
            if (vertexMoved(vx.Current())) { touched = true; break; }
        if (!touched) { ++statsSlot().facesVerbatim; continue; }   // any surface, any wires
        ++statsSlot().facesRebuilt;

        const bool wall = isWall[static_cast<std::size_t>(fi) - 1] != 0;
        const bool planar = (classifySurface(BRep_Tool::Surface(oldF)) == SurfKind::Plane);

        // A NON-PLANAR face may be rebuilt only when every edge of it that
        // changes is a pure RE-TRIM: then its pcurves are the same curves on the
        // same surface and only their range moves, which EmptyCopied already
        // carried. A new curve would need a new pcurve, and that is an
        // approximation this engine will not make silently.
        if (!planar) {
            for (TopExp_Explorer ex(oldF, TopAbs_EDGE); ex.More(); ex.Next())
                if (rebuiltNotRetrim.Contains(ex.Current().Oriented(TopAbs_FORWARD)))
                    return defer("a non-planar face would need a new pcurve for a rebuilt edge");
        }

        TopoDS_Face nf;
        if (wall) {
            // The surface normal must compose with the face's own orientation to
            // give the OUTWARD normal, exactly as it did before, so the shell's
            // orientation bookkeeping is untouched.
            const Plane& rp = wallPlane[static_cast<std::size_t>(fi) - 1];
            gp_Dir nrm(rp.nx, rp.ny, rp.nz);
            if (faceMap(fi).Orientation() == TopAbs_REVERSED) nrm.Reverse();
            const gp_Pnt origin(rp.nx * rp.d, rp.ny * rp.d, rp.nz * rp.d);
            bb.MakeFace(nf, new Geom_Plane(gp_Pln(origin, nrm)),
                        std::max(tol, BRep_Tool::Tolerance(oldF)));
        } else {
            nf = TopoDS::Face(oldF.EmptyCopied());   // same surface, same tolerance
        }

        for (TopoDS_Iterator wit(oldF); wit.More(); wit.Next()) {
            if (wit.Value().ShapeType() != TopAbs_WIRE) {
                bb.Add(nf, wit.Value());             // a vertex on the face, verbatim
                continue;
            }
            const TopoDS_Wire w = TopoDS::Wire(wit.Value());
            bool wireTouched = false;
            for (TopExp_Explorer vx(w, TopAbs_VERTEX); vx.More(); vx.Next())
                if (vertexMoved(vx.Current())) { wireTouched = true; break; }
            if (!wireTouched && !wall) {
                bb.Add(nf, w);                       // THE hole-carrying case: verbatim
                ++statsSlot().wiresVerbatim;
                continue;
            }
            TopoDS_Wire nw = TopoDS::Wire(w.EmptyCopied());
            for (TopoDS_Iterator eit(w); eit.More(); eit.Next())
                bb.Add(nw, edgeFor(eit.Value()));
            bb.Add(nf, nw.Oriented(w.Orientation()));
        }
        newFaceMap.Bind(faceMap(fi), nf);
    }

    // ---- 8. re-assemble the shape, structure for structure ------------------
    // Recursive so a SOLID, a SHELL, a COMPSOLID or a COMPOUND all rebuild the
    // same way, with every child keeping the orientation it had.
    struct Rebuild {
        BRep_Builder& b;
        const TopTools_DataMapOfShapeShape& faceRepl;
        TopoDS_Shape run(const TopoDS_Shape& s) const {
            if (s.ShapeType() == TopAbs_FACE) {
                const TopoDS_Shape key = s.Oriented(TopAbs_FORWARD);
                return faceRepl.IsBound(key)
                         ? faceRepl.Find(key).Oriented(s.Orientation())
                         : s;
            }
            if (s.ShapeType() >= TopAbs_WIRE) return s;   // nothing below a face moves here
            TopoDS_Shape out = s.EmptyCopied();
            for (TopoDS_Iterator it(s); it.More(); it.Next())
                b.Add(out, run(it.Value()));
            return out.Oriented(s.Orientation());
        }
    } rebuild{bb, newFaceMap};

    const TopoDS_Shape out = rebuild.run(shape);
    if (out.IsNull()) return defer("re-assembly produced a null shape");

    // ---- 9. the self-check vector ------------------------------------------
    // Counts FIRST: this construction changes geometry and never topology, so a
    // count that moved is a defect in the rebuild and not a property of the
    // input. VOLUME ALONE CANNOT VALIDATE GEOMETRY, so it is one entry here and
    // not the check.
    TopTools_IndexedMapOfShape of, oe, ov, os;
    TopExp::MapShapes(out, TopAbs_FACE, of);
    TopExp::MapShapes(out, TopAbs_EDGE, oe);
    TopExp::MapShapes(out, TopAbs_VERTEX, ov);
    TopTools_IndexedMapOfShape is;
    TopExp::MapShapes(shape, TopAbs_SHELL, is);
    TopExp::MapShapes(out, TopAbs_SHELL, os);
    if (of.Extent() != faceMap.Extent())  return defer("the rebuilt solid has a different face count");
    if (oe.Extent() != edgeMap.Extent())  return defer("the rebuilt solid has a different edge count");
    if (ov.Extent() != vertMap.Extent())  return defer("the rebuilt solid has a different vertex count");
    if (os.Extent() != is.Extent())       return defer("the rebuilt solid has a different shell count");

    GProp_GProps pn;
    BRepGProp::VolumeProperties(out, pn);
    if (!(std::fabs(pn.Mass()) > 1.0e-12))
        return defer("the rebuilt solid has zero volume");

    BRepCheck_Analyzer an(out);
    if (!an.IsValid())
        return defer("the rebuilt solid is not BRepCheck-valid");

    return out;
}

}  // namespace occtdraftlocal
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
