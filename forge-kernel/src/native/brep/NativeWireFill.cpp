// src/native/brep/NativeWireFill.cpp — TKOffset FAMILY B (BRepOffsetAPI_MakeFilling).
//
// See include/forge/native/brep/NativeWireFill.hpp for the symbol inventory this
// replaces and the drop-hygiene argument. This file implements the cap itself.
//
// ============================ THE CONSTRUCTION =============================
// A free-boundary wire is a closed loop of edges with exactly one face ancestor. To
// cap it we need a surface that CONTAINS the loop. For a PLANAR loop that surface is
// determined and exact — there is nothing to fit.
//
// PLANE FIT — NEWELL'S METHOD (Sunday, "Geometry Algorithms"; Foley & van Dam §12).
// For an ordered polygon (p_0 … p_{n-1}) the vector
//     N = Σ_i ( (y_i - y_{i+1})(z_i + z_{i+1}),
//               (z_i - z_{i+1})(x_i + x_{i+1}),
//               (x_i - x_{i+1})(y_i + y_{i+1}) )
// is exactly twice the vector area of the polygon. It is the right estimator here and
// a cross-product of two edges is not, because:
//   * it uses EVERY vertex, so a single near-degenerate edge cannot dominate it, and
//   * it is exact for a planar polygon regardless of convexity or vertex ordering
//     pathologies, where "cross the first two edges" fails outright on a loop whose
//     first two edges are collinear (extremely common — a circle sampled into arcs, or
//     a rectangle whose corner was split by a boolean).
//
// The samples come off the REAL curves via BRepAdaptor_Curve, not off the vertices:
// a circular free wire is ONE edge with TWO vertices, and two points define no plane.
// Sampling the curve gives a genuine polygon to fit. kSamplesPerEdge is 16, which for
// a full circle discretised as one edge yields a 16-gon — ample for a normal.
//
// VERIFY, DO NOT ASSUME. Newell returns a normal for any input, including a wildly
// non-planar loop. So after fitting we measure max_i |(p_i - c)·n̂| over the same
// samples and REQUIRE it <= tol. That residual is reported on both paths, so the
// caller (and the A/B gate) can see exactly how planar the loops in a corpus are.
//
// FACE BUILD. BRepBuilderAPI_MakeFace(Handle(Geom_Plane), wire, Inside=Standard_True)
// builds the face ON the supplied surface FROM the supplied wire, computing the pcurve
// of each edge by projection. The edges are reused as-is: an arc stays a Geom_Circle,
// a spline stays a Geom_BSplineCurve. There is no tessellation, no refit, no sampling
// in the output — the samples above are used ONLY to decide planarity and orientation.
//
// ============================ §BLOCKER — THE NON-PLANAR CASE ===============
// OCCT's BRepOffsetAPI_MakeFilling solves a constrained energy-minimisation over a
// GeomPlate_ surface and can cap an arbitrary 3-D loop. The native tree HAS the
// mathematics: SurfaceFill.cpp (bicubic-Hermite Coons/Gordon, 4-sided, exact boundary
// + cross-tangent interpolation) and GregoryFill.cpp (N-sided Gregory, N>=3, Boolean-sum
// sub-patches). NEITHER exports a Geom_BSplineSurface — GregoryPatch is an EVALUATOR
// (evaluateSub / evaluateSubWithDerivatives) and a Gregory patch is rational in a form
// that is not a tensor-product NURBS, so turning it into a Geom_ surface means SAMPLING
// IT AND REFITTING. That is an approximation of an approximation, and it is exactly the
// kind of silent substitution this kernel's Law 4 (no faceting) and Law 9 (no capability
// deletion) forbid doing quietly. So the non-planar branch DEFERS and says so.
//
// What would close it, precisely: a `nurbsExport(const GregoryPatch&)` that emits one
// Geom_BSplineSurface per sub-patch with a STATED and MEASURED deviation bound, plus a
// sew of the N sub-faces into the cap. That is a surfacing increment, not a wiring one,
// and it is not in scope for family B.

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/NativeWireFill.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRep_Tool.hxx>
#include <Geom_Plane.hxx>
#include <Precision.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <cmath>
#include <vector>

namespace forge {
namespace occtfill {

namespace {

// Samples taken along EACH edge of the loop. 16 makes a single-edge circular wire a
// 16-gon (plenty for a Newell normal) while keeping a 300-edge loop under 5k points.
constexpr int    kSamplesPerEdge = 16;
// Below this the Newell vector carries no direction — the loop is degenerate (all
// samples collinear, or zero area). Scaled against the loop's own size below.
constexpr double kAreaEps        = 1e-12;

// Walk the wire's edges and sample each one's real 3-D curve. Returns false if the
// wire has no edge with a 3-D curve (a wire of purely degenerate edges).
bool sampleWire(const TopoDS_Wire& wire, std::vector<gp_Pnt>& pts, int& edgeCount) {
    pts.clear();
    edgeCount = 0;
    for (TopExp_Explorer ex(wire, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ex.Current());
        ++edgeCount;
        if (BRep_Tool::Degenerated(e)) continue;
        BRepAdaptor_Curve ac(e);
        const double f = ac.FirstParameter();
        const double l = ac.LastParameter();
        if (!(l > f) || !std::isfinite(f) || !std::isfinite(l)) continue;
        // Half-open sampling: take [f, l) so the shared vertex between consecutive
        // edges is contributed once, keeping the point sequence a proper polygon
        // (Newell double-counts nothing) and the loop implicitly closed.
        for (int i = 0; i < kSamplesPerEdge; ++i) {
            const double t = f + (l - f) * (static_cast<double>(i) / kSamplesPerEdge);
            pts.push_back(ac.Value(t));
        }
    }
    return pts.size() >= 3;
}

}  // namespace

WireFillResult fillFreeWire(const TopoDS_Wire& wire, double tol) {
    WireFillResult out;

    if (wire.IsNull()) { out.reason = "null wire"; return out; }

    std::vector<gp_Pnt> pts;
    if (!sampleWire(wire, pts, out.edgeCount)) {
        out.reason = "wire yielded fewer than 3 curve samples (degenerate loop)";
        return out;
    }

    // ---- centroid -------------------------------------------------------------
    double cx = 0.0, cy = 0.0, cz = 0.0;
    for (const auto& p : pts) { cx += p.X(); cy += p.Y(); cz += p.Z(); }
    const double inv = 1.0 / static_cast<double>(pts.size());
    const gp_Pnt centre(cx * inv, cy * inv, cz * inv);

    // ---- Newell normal (twice the polygon's vector area) -----------------------
    double nx = 0.0, ny = 0.0, nz = 0.0;
    // Also accumulate the loop's characteristic size so kAreaEps can be scale-relative:
    // a 0.001 mm part and a 5000 mm part must not share an absolute area floor.
    double extent = 0.0;
    for (std::size_t i = 0, n = pts.size(); i < n; ++i) {
        const gp_Pnt& a = pts[i];
        const gp_Pnt& b = pts[(i + 1) % n];
        nx += (a.Y() - b.Y()) * (a.Z() + b.Z());
        ny += (a.Z() - b.Z()) * (a.X() + b.X());
        nz += (a.X() - b.X()) * (a.Y() + b.Y());
        extent = std::max(extent, a.Distance(centre));
    }
    const double nlen = std::sqrt(nx * nx + ny * ny + nz * nz);
    // Vector area scales as length^2; compare against the loop's own radius^2.
    const double areaFloor = kAreaEps * std::max(extent * extent, 1.0);
    if (!(nlen > areaFloor) || !std::isfinite(nlen)) {
        out.reason = "degenerate loop: Newell vector area ~ 0 (samples collinear)";
        return out;
    }
    const gp_Dir normal(nx / nlen, ny / nlen, nz / nlen);

    // ---- planarity VERIFY (never assumed) --------------------------------------
    double residual = 0.0;
    for (const auto& p : pts) {
        const gp_Vec d(centre, p);
        residual = std::max(residual, std::abs(d.Dot(gp_Vec(normal))));
    }
    out.planeResidual = residual;

    // The budget is the caller's own tolerance, but never tighter than OCCT's
    // Confusion — a loop flat to 1e-9 mm is planar by any engineering standard and a
    // caller that passed tol=0 must not be told otherwise.
    const double budget = std::max(tol, Precision::Confusion());
    if (residual > budget) {
        out.reason = "loop is NOT planar (residual " + std::to_string(residual) +
                     " > tol " + std::to_string(budget) +
                     "); native cap declines — no Geom_ surface exists for an "
                     "arbitrary 3-D loop without refitting (see §BLOCKER)";
        return out;
    }
    out.planar = true;

    // ---- exact planar face -----------------------------------------------------
    Handle(Geom_Plane) plane = new Geom_Plane(gp_Ax3(centre, normal));
    BRepBuilderAPI_MakeFace mk(plane, wire, /*Inside*/ Standard_True);
    if (!mk.IsDone()) {
        out.reason = "planar loop but BRepBuilderAPI_MakeFace declined "
                     "(wire not a valid single closed boundary on the plane)";
        return out;
    }

    out.face = mk.Face();
    if (out.face.IsNull()) {
        out.reason = "face builder returned null";
        return out;
    }
    out.ok = true;
    return out;
}

}  // namespace occtfill
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
