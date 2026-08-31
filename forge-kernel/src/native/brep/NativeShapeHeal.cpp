// forge/native/brep/NativeShapeHeal.cpp
//
// R4 — native SHAPE-HEALING subset (TKShHealing drop). See NativeShapeHeal.hpp
// for the honest scope + gap statement + the R1 overlap flag. This TU links ZERO
// TKShHealing symbols; it uses only surviving foundation toolkits
// (TKMath/TKG3d/TKBRep/TKTopAlgo) plus native math, exactly like StepReadOcct.cpp.

#include "forge/native/brep/NativeShapeHeal.hpp"

#ifdef FORGE_NATIVE_BREP

#include <algorithm>
#include <cmath>
#include <map>
#include <utility>
#include <vector>

#include <gp_Vec.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>

#include <Geom_Plane.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_Line.hxx>
#include <Geom_Circle.hxx>

#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>

#include <BRep_Tool.hxx>
#include <BRep_Builder.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepLib.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>

namespace forge {
namespace occtheal {

namespace {

constexpr double kTwoPi = 6.283185307179586476925286766559;

inline gp_Vec asVec(const gp_Dir& d) { return gp_Vec(d.X(), d.Y(), d.Z()); }

// Wrap an angle to [0, 2pi) — the analytic-U convention (caller re-anchors).
inline double wrap2pi(double a) {
    a = std::fmod(a, kTwoPi);
    if (a < 0.0) a += kTwoPi;
    return a;
}

inline double clampd(double x, double lo, double hi) {
    return x < lo ? lo : (x > hi ? hi : x);
}

// (u,v) inversion for the 5 analytic elementary surfaces. Returns true + fills
// (u,v) when `surf` is one of them; false to hand off to the Newton fallback.
bool analyticUV(const Handle(Geom_Surface)& surf, const gp_Pnt& p,
                double& u, double& v) {
    // Plane: u,v are the in-plane coordinates in the (X,Y) frame.
    if (Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(surf)) {
        const gp_Ax3 ax = pl->Position();
        const gp_Vec d(ax.Location(), p);
        u = d.Dot(asVec(ax.XDirection()));
        v = d.Dot(asVec(ax.YDirection()));
        return true;
    }
    // Cylinder: u = angle about axis in [0,2pi), v = height along axis.
    if (Handle(Geom_CylindricalSurface) cy = Handle(Geom_CylindricalSurface)::DownCast(surf)) {
        const gp_Ax3 ax = cy->Position();
        const gp_Vec d(ax.Location(), p);
        const double x = d.Dot(asVec(ax.XDirection()));
        const double y = d.Dot(asVec(ax.YDirection()));
        const double z = d.Dot(asVec(ax.Direction()));
        u = wrap2pi(std::atan2(y, x));
        v = z;
        return true;
    }
    // Cone: u = angle, v = signed distance along the generator (OCCT convention:
    // radius(v) = RefRadius + v*sin(SemiAngle), axialHeight(v) = v*cos(SemiAngle)).
    if (Handle(Geom_ConicalSurface) co = Handle(Geom_ConicalSurface)::DownCast(surf)) {
        const gp_Ax3 ax = co->Position();
        const gp_Vec d(ax.Location(), p);
        const double x = d.Dot(asVec(ax.XDirection()));
        const double y = d.Dot(asVec(ax.YDirection()));
        const double z = d.Dot(asVec(ax.Direction()));
        const double rho = std::sqrt(x * x + y * y);
        const double ang = co->SemiAngle();
        u = wrap2pi(std::atan2(y, x));
        // project (rho - RefRadius, z) onto the unit generator (sin, cos).
        v = (rho - co->RefRadius()) * std::sin(ang) + z * std::cos(ang);
        return true;
    }
    // Sphere: u = longitude in [0,2pi), v = latitude in [-pi/2, pi/2].
    if (Handle(Geom_SphericalSurface) sp = Handle(Geom_SphericalSurface)::DownCast(surf)) {
        const gp_Ax3 ax = sp->Position();
        const gp_Vec d(ax.Location(), p);
        const double x = d.Dot(asVec(ax.XDirection()));
        const double y = d.Dot(asVec(ax.YDirection()));
        const double z = d.Dot(asVec(ax.Direction()));
        u = wrap2pi(std::atan2(y, x));
        v = std::atan2(z, std::sqrt(x * x + y * y));   // = asin(z/r), latitude
        return true;
    }
    // Torus: u = angle about axis, v = angle around the tube in [0,2pi).
    if (Handle(Geom_ToroidalSurface) to = Handle(Geom_ToroidalSurface)::DownCast(surf)) {
        const gp_Ax3 ax = to->Position();
        const gp_Vec d(ax.Location(), p);
        const double x = d.Dot(asVec(ax.XDirection()));
        const double y = d.Dot(asVec(ax.YDirection()));
        const double z = d.Dot(asVec(ax.Direction()));
        u = wrap2pi(std::atan2(y, x));
        const double rho = std::sqrt(x * x + y * y) - to->MajorRadius();
        v = wrap2pi(std::atan2(z, rho));
        return true;
    }
    return false;
}

// Gauss-Newton inversion for a general Geom_Surface (B-spline / revolution /
// extrusion / offset ...). Seeds from a coarse parametric grid, then refines by
// solving the 2x2 normal equations J^T J du = -J^T r with J = [S_u, S_v],
// r = S(u,v) - p. Robust: clamps to the (finite-clamped) parameter box, keeps
// the best-seen foot, converges on |step| < preci or a small residual.
void newtonUV(const Handle(Geom_Surface)& surf, const gp_Pnt& p,
              double preci, double& uOut, double& vOut) {
    double u0, u1, v0, v1;
    surf->Bounds(u0, u1, v0, v1);
    // Clamp infinite/unbounded parameter ranges to a finite working window so a
    // periodic or ruled infinite surface still gets a sane seed grid.
    const double kBig = 1.0e4;
    if (Precision::IsInfinite(u0) || u0 < -kBig) u0 = -kBig;
    if (Precision::IsInfinite(u1) || u1 >  kBig) u1 =  kBig;
    if (Precision::IsInfinite(v0) || v0 < -kBig) v0 = -kBig;
    if (Precision::IsInfinite(v1) || v1 >  kBig) v1 =  kBig;
    if (u1 < u0) std::swap(u0, u1);
    if (v1 < v0) std::swap(v0, v1);

    // --- coarse seed grid ---
    const int N = 8;
    double bu = 0.5 * (u0 + u1), bv = 0.5 * (v0 + v1), bd = 1.0e300;
    for (int i = 0; i <= N; ++i) {
        const double uu = u0 + (u1 - u0) * (double(i) / N);
        for (int j = 0; j <= N; ++j) {
            const double vv = v0 + (v1 - v0) * (double(j) / N);
            const gp_Pnt s = surf->Value(uu, vv);
            const double dd = s.SquareDistance(p);
            if (dd < bd) { bd = dd; bu = uu; bv = vv; }
        }
    }

    // --- Gauss-Newton refine ---
    double u = bu, v = bv;
    const double tol = (preci > 0.0 ? preci : 1.0e-9);
    for (int it = 0; it < 40; ++it) {
        gp_Pnt s;
        gp_Vec su, sv;
        try {
            surf->D1(u, v, s, su, sv);
        } catch (const Standard_Failure&) { break; }
        const gp_Vec r(p, s);                       // r = s - p
        const double a = su.Dot(su), b = su.Dot(sv), c = sv.Dot(sv);
        const double det = a * c - b * b;
        if (std::abs(det) < 1.0e-18) break;         // degenerate parameterisation
        const double g1 = su.Dot(r), g2 = sv.Dot(r);
        // solve [[a b],[b c]] [du,dv] = [-g1,-g2]
        double du = -(c * g1 - b * g2) / det;
        double dv = -(a * g2 - b * g1) / det;
        // damped step + box clamp
        u = clampd(u + du, u0, u1);
        v = clampd(v + dv, v0, v1);
        const double dd = surf->Value(u, v).SquareDistance(p);
        if (dd < bd) { bd = dd; bu = u; bv = v; }
        if (std::abs(du) < tol && std::abs(dv) < tol) break;
    }
    uOut = bu;
    vOut = bv;
}

}  // namespace

// ---------------------------------------------------------------------------
// (1) valueOfUV / projectPointOnSurface
// ---------------------------------------------------------------------------
gp_Pnt2d projectPointOnSurface(const Handle(Geom_Surface)& surf, const gp_Pnt& p,
                               double preci, gp_Pnt* foot, double* dist) {
    double u = 0.0, v = 0.0;
    if (surf.IsNull() || !analyticUV(surf, p, u, v)) {
        if (!surf.IsNull()) newtonUV(surf, p, preci, u, v);
    }
    if (foot || dist) {
        const gp_Pnt s = surf.IsNull() ? p : surf->Value(u, v);
        if (foot) *foot = s;
        if (dist) *dist = s.Distance(p);
    }
    return gp_Pnt2d(u, v);
}

gp_Pnt2d valueOfUV(const Handle(Geom_Surface)& surf, const gp_Pnt& p, double preci) {
    return projectPointOnSurface(surf, p, preci, nullptr, nullptr);
}

// ---------------------------------------------------------------------------
// (2) projectPointOnCurve  (ShapeAnalysis_Curve::Project)
// ---------------------------------------------------------------------------
double projectPointOnCurve(const Handle(Geom_Curve)& c, const gp_Pnt& p,
                           double preci, gp_Pnt& proj, double& param,
                           bool adjustToEnds) {
    if (c.IsNull()) { proj = p; param = 0.0; return 0.0; }
    const double cf = c->FirstParameter();
    const double cl = c->LastParameter();
    double t = cf;

    // --- closed form for the common analytic curves ---
    bool analytic = false;
    if (Handle(Geom_Line) ln = Handle(Geom_Line)::DownCast(c)) {
        const gp_Ax1 ax = ln->Position();
        const gp_Vec d(ax.Location(), p);
        t = d.Dot(asVec(ax.Direction()));            // unit direction
        analytic = true;
    } else if (Handle(Geom_Circle) ci = Handle(Geom_Circle)::DownCast(c)) {
        const gp_Ax2 ax = ci->Position();
        const gp_Vec d(ax.Location(), p);
        const double x = d.Dot(asVec(ax.XDirection()));
        const double y = d.Dot(asVec(ax.YDirection()));
        double a = std::atan2(y, x);
        // bring the angle into the curve's own [cf,cl] span (circles are periodic)
        while (a < cf) a += kTwoPi;
        while (a > cl) a -= kTwoPi;
        t = a;
        analytic = true;
    }

    if (!analytic) {
        // --- sampled Newton for splines / bezier / everything else ---
        // g(t) = (C(t) - p) . C'(t) = 0 ; sample to seed, refine with D1.
        const int N = 32;
        double bt = cf, bd = 1.0e300;
        for (int i = 0; i <= N; ++i) {
            const double tt = cf + (cl - cf) * (double(i) / N);
            const double dd = c->Value(tt).SquareDistance(p);
            if (dd < bd) { bd = dd; bt = tt; }
        }
        t = bt;
        for (int it = 0; it < 30; ++it) {
            gp_Pnt s;
            gp_Vec d1;
            try { c->D1(t, s, d1); } catch (const Standard_Failure&) { break; }
            const gp_Vec r(p, s);                    // s - p
            const double g = d1.Dot(r);
            const double dg = d1.Dot(d1);            // Gauss-Newton (drop C'' term)
            if (dg < 1.0e-18) break;
            const double step = g / dg;
            t = clampd(t - step, cf, cl);
            if (std::abs(step) < (preci > 0.0 ? preci : 1.0e-9)) break;
        }
    }

    // clamp to the curve's own range (matches ShapeAnalysis_Curve on a bounded curve)
    t = clampd(t, cf, cl);
    proj = c->Value(t);
    double best = proj.Distance(p);

    // optional end-snap (the OCCT adjustToEnds flag): a foot within preci of an
    // end takes the exact end parameter.
    if (adjustToEnds) {
        const double dF = p.Distance(c->Value(cf));
        const double dL = p.Distance(c->Value(cl));
        const double snap = (preci > 0.0 ? preci : Precision::Confusion());
        if (dF <= best + snap && dF <= dL) { param = cf; proj = c->Value(cf); return dF; }
        if (dL <= best + snap)             { param = cl; proj = c->Value(cl); return dL; }
    }
    param = t;
    return best;
}

// ---------------------------------------------------------------------------
// (3) freeBounds  (ShapeAnalysis_FreeBounds)
// ---------------------------------------------------------------------------
namespace {

// Quantised vertex key for chaining free edges by coincident endpoints.
struct VKey {
    long long x, y, z;
    bool operator<(const VKey& o) const {
        if (x != o.x) return x < o.x;
        if (y != o.y) return y < o.y;
        return z < o.z;
    }
};
VKey keyOf(const gp_Pnt& p, double tol) {
    const double q = std::max(tol, 1.0e-9);
    return {static_cast<long long>(std::llround(p.X() / q)),
            static_cast<long long>(std::llround(p.Y() / q)),
            static_cast<long long>(std::llround(p.Z() / q))};
}
inline bool vkeyEq(const VKey& a, const VKey& b) {
    return !(a < b) && !(b < a);
}

}  // namespace

FreeBounds freeBounds(const TopoDS_Shape& shape, double tol) {
    FreeBounds out;
    BRep_Builder bb;
    bb.MakeCompound(out.closedWires);
    bb.MakeCompound(out.openWires);

    // Free edges = edges used by exactly one face (the ShapeAnalysis_FreeBounds
    // definition). Degenerate edges never bound a free wire.
    TopTools_IndexedDataMapOfShapeListOfShape e2f;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, e2f);

    std::vector<TopoDS_Edge> freeEdges;
    for (Standard_Integer i = 1; i <= e2f.Extent(); ++i) {
        if (e2f(i).Extent() != 1) continue;
        const TopoDS_Edge e = TopoDS::Edge(e2f.FindKey(i));
        if (BRep_Tool::Degenerated(e)) continue;
        freeEdges.push_back(e);
    }
    if (freeEdges.empty()) return out;

    // endpoint keys per edge
    const std::size_t n = freeEdges.size();
    std::vector<VKey> a(n), b(n);
    std::vector<char> used(n, 0);
    std::multimap<VKey, std::size_t> byEnd;   // vertex-key -> edge index
    for (std::size_t i = 0; i < n; ++i) {
        TopoDS_Vertex v1, v2;
        TopExp::Vertices(freeEdges[i], v1, v2);
        a[i] = keyOf(BRep_Tool::Pnt(v1), tol);
        b[i] = keyOf(BRep_Tool::Pnt(v2), tol);
        byEnd.emplace(a[i], i);
        byEnd.emplace(b[i], i);
    }

    // Grow one wire per connected chain: start at an unused edge, then repeatedly
    // attach an unused edge that shares the growing chain's open endpoint.
    auto findNext = [&](const VKey& end, std::size_t skip) -> std::size_t {
        auto range = byEnd.equal_range(end);
        for (auto it = range.first; it != range.second; ++it) {
            const std::size_t j = it->second;
            if (j == skip || used[j]) continue;
            return j;
        }
        return static_cast<std::size_t>(-1);
    };

    for (std::size_t i = 0; i < n; ++i) {
        if (used[i]) continue;
        TopoDS_Wire wire;
        bb.MakeWire(wire);
        used[i] = 1;
        bb.Add(wire, freeEdges[i]);
        VKey headKey = a[i];   // the two dangling ends of the chain
        VKey tailKey = b[i];

        // extend at the tail: attach edge j sharing tailKey, advance to j's FAR end.
        for (;;) {
            const std::size_t j = findNext(tailKey, static_cast<std::size_t>(-1));
            if (j == static_cast<std::size_t>(-1)) break;
            used[j] = 1;
            bb.Add(wire, freeEdges[j]);
            tailKey = vkeyEq(a[j], tailKey) ? b[j] : a[j];
            if (vkeyEq(tailKey, headKey)) break;   // closed the loop
        }
        // extend at the head: attach edge j sharing headKey, advance to j's FAR end.
        for (;;) {
            const std::size_t j = findNext(headKey, static_cast<std::size_t>(-1));
            if (j == static_cast<std::size_t>(-1)) break;
            used[j] = 1;
            bb.Add(wire, freeEdges[j]);
            headKey = vkeyEq(a[j], headKey) ? b[j] : a[j];
            if (vkeyEq(headKey, tailKey)) break;   // closed the loop
        }

        const bool closed = vkeyEq(headKey, tailKey);
        if (closed) bb.Add(out.closedWires, wire);
        else        bb.Add(out.openWires, wire);
    }
    return out;
}

// ---------------------------------------------------------------------------
// (4) solidFromShell / orientSolidOutward  (ShapeFix_Solid)
// ---------------------------------------------------------------------------
TopoDS_Solid solidFromShell(const TopoDS_Shell& shell) {
    TopoDS_Solid solid;
    BRepBuilderAPI_MakeSolid mk(shell);
    if (!mk.IsDone()) return solid;            // null solid
    solid = mk.Solid();
    // orient outward: negative signed volume => reverse.
    GProp_GProps vp;
    BRepGProp::VolumeProperties(solid, vp);
    if (vp.Mass() < 0.0) solid = TopoDS::Solid(solid.Reversed());
    return solid;
}

TopoDS_Shape orientSolidOutward(const TopoDS_Shape& s) {
    if (s.IsNull()) return s;
    GProp_GProps vp;
    BRepGProp::VolumeProperties(s, vp);
    if (vp.Mass() < 0.0) return s.Reversed();
    return s;
}

// ---------------------------------------------------------------------------
// (5) shellOrientationConsistent  (ShapeAnalysis_Shell)
// ---------------------------------------------------------------------------
bool shellOrientationConsistent(const TopoDS_Shell& shell) {
    // For every manifold edge (shared by exactly 2 faces) the edge must appear
    // FORWARD in one face's boundary and REVERSED in the other. If any shared
    // edge has the SAME orientation in both faces, the shell is inconsistently
    // oriented. Free edges (1 face) and non-manifold edges (3+) are ignored here
    // (they are the province of freeBounds / the validity checker).
    TopTools_IndexedDataMapOfShapeListOfShape e2f;
    TopExp::MapShapesAndAncestors(shell, TopAbs_EDGE, TopAbs_FACE, e2f);
    for (Standard_Integer i = 1; i <= e2f.Extent(); ++i) {
        if (e2f(i).Extent() != 2) continue;
        const TopoDS_Edge edge = TopoDS::Edge(e2f.FindKey(i));
        if (BRep_Tool::Degenerated(edge)) continue;
        int seen = 0;
        TopAbs_Orientation ori[2] = {TopAbs_FORWARD, TopAbs_FORWARD};
        for (const TopoDS_Shape& fsh : e2f(i)) {
            for (TopExp_Explorer ex(fsh, TopAbs_EDGE); ex.More(); ex.Next()) {
                if (ex.Current().IsSame(edge)) {
                    if (seen < 2) ori[seen] = ex.Current().Orientation();
                    ++seen;
                    break;
                }
            }
        }
        if (seen == 2 && ori[0] == ori[1]) return false;   // same sense => bad
    }
    return true;
}

// ---------------------------------------------------------------------------
// (6) finalizeShape  (ShapeFix_Shape light-heal subset)
// ---------------------------------------------------------------------------
FinalizeResult finalizeShape(const TopoDS_Shape& shape, double precision, double maxTol) {
    FinalizeResult r;
    r.shape = shape;
    if (shape.IsNull()) return r;

    // (a) SameParameter reconcile — the dominant real effect of a defensive
    // ShapeFix_Shape pass on boolean output / a freshly built STEP shell. Ceiling
    // the tolerance at maxTol (parity with SetMaxTolerance). Never throws out.
    double prec = (precision > 0.0 ? precision : 1.0e-7);
    if (maxTol > 0.0 && prec > maxTol) prec = maxTol;
    try {
        BRepLib::SameParameter(r.shape, prec, Standard_True);
        r.sameParamApplied = true;
    } catch (const Standard_Failure&) {
        r.sameParamApplied = false;
    }

    // (b) outward orientation by signed volume (only meaningful for solids/closed
    // shells; a negative mass means the shape faces inward).
    try {
        GProp_GProps vp;
        BRepGProp::VolumeProperties(r.shape, vp);
        if (vp.Mass() < 0.0) {
            r.shape = r.shape.Reversed();
            r.orientationFlipped = true;
        }
    } catch (const Standard_Failure&) {}

    // (c) promote a closed bare shell to a solid.
    if (r.shape.ShapeType() == TopAbs_SHELL) {
        const TopoDS_Shell sh = TopoDS::Shell(r.shape);
        if (BRep_Tool::IsClosed(sh)) {
            TopoDS_Solid solid = solidFromShell(sh);
            if (!solid.IsNull()) {
                r.shape = solid;
                r.promotedToSolid = true;
            }
        }
    }
    return r;
}

// ---------------------------------------------------------------------------
// (7) finalizeShapeCurvedSafe  (curved-preserving light heal — the first
//     tractable chunk of the surface-exact OCCT-zero heal path)
// ---------------------------------------------------------------------------
namespace {

// True iff EVERY face of `shape` is one of the five elementary analytic surfaces
// (Plane / Cylinder / Cone / Sphere / Torus) — precisely the surfaces
// occtFromNativeSolid's reconstructors rebuild EXACTLY. A Geom_RectangularTrimmed
// wrapper is unwrapped to its basis (a trim does not change the surface TYPE); any
// BSpline / Bezier / SurfaceOfRevolution / SurfaceOfLinearExtrusion / OffsetSurface
// / OtherSurface face makes the body NON-elementary (return false), so the caller
// keeps its own faceting-tolerant path rather than risk the round-trip. Uses only
// TKG3d Geom_ DownCasts (identical to analyticUV above) + TKBRep BRep_Tool — ZERO
// TKShHealing symbols. A shape with no faces is NOT an analytic solid (false).
bool isAllAnalyticElementary(const TopoDS_Shape& shape) {
    bool sawFace = false;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        sawFace = true;
        Handle(Geom_Surface) s = BRep_Tool::Surface(TopoDS::Face(ex.Current()));
        // Unwrap any rectangular-trim wrapper down to the underlying basis surface.
        for (;;) {
            Handle(Geom_RectangularTrimmedSurface) rt =
                Handle(Geom_RectangularTrimmedSurface)::DownCast(s);
            if (rt.IsNull()) break;
            s = rt->BasisSurface();
        }
        if (s.IsNull()) return false;
        const bool elementary =
            !Handle(Geom_Plane)::DownCast(s).IsNull()             ||
            !Handle(Geom_CylindricalSurface)::DownCast(s).IsNull() ||
            !Handle(Geom_ConicalSurface)::DownCast(s).IsNull()     ||
            !Handle(Geom_SphericalSurface)::DownCast(s).IsNull()   ||
            !Handle(Geom_ToroidalSurface)::DownCast(s).IsNull();
        if (!elementary) return false;
    }
    return sawFace;
}

}  // namespace

CurvedSafeResult finalizeShapeCurvedSafe(const TopoDS_Shape& shape,
                                         double precision, double maxTol) {
    CurvedSafeResult r;
    r.shape = shape;
    if (shape.IsNull()) { r.reason = "null input shape"; return r; }

    // Classify BEFORE touching anything: any non-elementary face => DEFER, returning
    // the input UNCHANGED (the caller keeps its OCCT / fixShapeGeneral path). This is
    // the honest boundary — we never facet a body we cannot heal surface-exactly.
    if (!isAllAnalyticElementary(shape)) {
        r.deferred = true;
        r.reason   = "non-elementary (freeform / swept / offset) or face-less shape — "
                     "deferred to caller path to avoid a faceting round-trip";
        return r;
    }
    r.allAnalytic = true;

    // All faces are elementary analytic surfaces: heal IN PLACE on the OCCT B-rep.
    // finalizeShape does SameParameter + outward-orient + shell->solid — none of them
    // tessellate, so every Geom_ surface survives bit-exact (no import/heal/export
    // round-trip; a cylinder stays a cylinder). This is the curved-safe light heal.
    FinalizeResult fr = finalizeShape(shape, precision, maxTol);
    r.shape              = fr.shape;
    r.sameParamApplied   = fr.sameParamApplied;
    r.orientationFlipped = fr.orientationFlipped;
    r.promotedToSolid    = fr.promotedToSolid;
    r.healApplied        = true;
    r.reason             = "curved-safe heal (analytic surfaces preserved; no faceting)";
    return r;
}

// ===========================================================================
// PER-CALL-SITE WIRING PLAN (the serial integrator applies these; this TU adds
// no edits to any call site). Each keeps the existing OCCT path under an #else /
// #ifndef so a red gate reverts instantly.
//
//  StepReadOcct.cpp
//    :963  ShapeAnalysis_Curve sac; d = sac.Project(c,P,conf,proj,u,false);
//          ->  d = forge::occtheal::projectPointOnCurve(c, P, Precision::Confusion(),
//                                                       proj, u, /*adjustToEnds*/false);
//          (paramOnCurve then keeps its own exact endpoint snap — unchanged.)
//    :1233 Handle(ShapeAnalysis_Surface) sas = new ShapeAnalysis_Surface(surf);
//    :1286 gp_Pnt2d uvF = sas->ValueOfUV(Pf3, prec);  uvL = sas->ValueOfUV(Pl3, prec);
//          ->  drop the sas handle; call forge::occtheal::valueOfUV(surf, Pf3, prec)
//              and (surf, Pl3, prec) directly. `surf` is captured already.
//    :1570 Handle(ShapeFix_Shape) sfs = new ShapeFix_Shape(raw);
//          SetPrecision(max(1e-6,tol)); SetMaxTolerance(1.0); Perform(); raw->Shape().
//          ->  auto fin = forge::occtheal::finalizeShape(raw, std::max(1e-6,X.tol), 1.0);
//              TopoDS_Shape fixed = fin.shape;   // then the existing SameParameter +
//              volume-sign block at :1575-1583 is REDUNDANT with finalizeShape and can
//              be trimmed, or kept (idempotent). ★RESIDUAL: for a non-planar face that
//              arrived with NO file pcurve, ShapeFix_Shape synthesised the 2D pcurve;
//              finalizeShape does not. Verify on the STEP corpus (Models-OS 13/13) —
//              if a fixture regresses, gate finalizeShape behind planar-only and leave
//              the spline-pcurve case on ShapeFix until R1/R2 land pcurve synthesis.
//
//  Healing.cpp
//    :407  ShapeAnalysis_FreeBounds analyzer(s,tol,false,false); analyzer.GetClosedWires();
//          ->  auto fb = forge::occtheal::freeBounds(s, tolerance);
//              const TopoDS_Compound& closedWires = fb.closedWires;   // rest unchanged
//    :446  Handle(ShapeFix_Solid) fix = new ShapeFix_Solid(mk.Solid()); fix->Perform();
//          result = fix->Solid();
//          ->  result = forge::occtheal::orientSolidOutward(mk.Solid());
//    :488  autoRepairSelfIntersection OCCT fallback (ShapeFix_Shape + Status DONE1..6).
//          ->  KEEP as-is for now. The honest native replacement is healBRep, already
//              wired AHEAD of this (tryNativeHeal) behind the FEAT gate. Dropping the
//              symbol needs that native path promoted to UNCONDITIONAL (delete the OCCT
//              fallback) — build-iteration + Models-OS gate, NOT this authoring pass.
//    :517  harmonizeNormals: ShapeFix_Shape + ShapeAnalysis_Shell + ShapeFix_Solid.
//          ->  fixer(s)+Perform  ->  forge::occtheal::finalizeShape(s,0,0).shape
//              ShapeAnalysis_Shell CheckOrientedShells (result discarded)
//                                  ->  forge::occtheal::shellOrientationConsistent(sh) (ignore/log)
//              ShapeFix_Solid::SolidFromShell(sh)
//                                  ->  forge::occtheal::solidFromShell(sh)
//
//  ShapeFix.cpp
//    :295  general repair with Status DONE/FAIL 1..8. -> KEEP (same as Healing:488):
//          native healBRep is wired ahead behind the gate; unconditional-native +
//          fallback-delete is the drop step, done serially with the corpus gate.
//
//  DirectEdit.cpp
//    :57   ShapeFix_Shape fixer(s); fixer.Perform(); return fixer.Shape();
//          ->  return forge::occtheal::finalizeShape(s, 0, 0).shape;
//
//  DirectModeling.cpp  (light post-boolean heal, default Perform, no status reads)
//    :505 :552 :600 :698  Handle(ShapeFix_Shape) fixer = new ShapeFix_Shape(x);
//          fixer->Perform(); ...add(fixer->Shape());
//          ->  ...add(forge::occtheal::finalizeShape(x, 0, 0).shape);
//          These four are boolean outputs that are ALREADY valid solids, so the heal is
//          defensive; finalizeShape's SameParameter+orient covers them with high
//          confidence (verify via test/directedit.mjs 9/9 + run_native).
//
//  NOT covered by this file (separate residuals for a full TKShHealing drop):
//    * ShapeUpgrade_UnifySameDomain (DirectEdit.cpp:122 / Healing.cpp:387) — native
//      unifySameDomain{Planar,Curved,Bored} covers eligible native solids; the general
//      OCCT fallback stays until UnifyFaces.cpp generalises or those fallbacks are cut.
//    * The two RICH autoRepair entries above (ShapeFix.cpp:295 / Healing.cpp:488) whose
//      native replacement (healBRep) is gated — promote-to-unconditional is the drop.
//
//  CMake: add `src/native/brep/NativeShapeHeal.cpp` to the forge_kernel source list
//  (alongside Heal.cpp / UnifyFaces.cpp, ~CMakeLists.txt:609/648).
// ===========================================================================

}  // namespace occtheal
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
