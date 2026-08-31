// src/native/brep/NativeFilling.cpp — TKOffset-free BOUNDARY FILL (family C).
//
// Read include/forge/native/brep/NativeFilling.hpp first: it carries the scope,
// the measured comparison against OCCT, the HONEST-DEFER list, the drop hygiene
// and the gate. This file carries the derivation.
//
// ===========================================================================
// PART 1 — the planarity test, and why endpoints are not enough
// ===========================================================================
// A wire is planar iff every point of every edge lies in one plane. Testing only
// the VERTICES is unsound: four coplanar endpoints joined by a circular arc that
// leaves the plane give a wire with a planar vertex set and a non-planar
// boundary, and capping it with a planar face would silently move geometry. So
// each edge is SAMPLED across its whole parameter range with BRepAdaptor_Curve
// and every sample is tested.
//
// The plane itself is fitted, not guessed. With centroid c and the 3x3 scatter
// matrix M = sum_i (p_i - c)(p_i - c)^T over all samples, the best-fit plane
// normal is the eigenvector of M for its SMALLEST eigenvalue — the classical
// total-least-squares (orthogonal-distance) plane fit, which is the right
// estimator here because the residual being tested IS the orthogonal distance.
// (Least SQUARES on z would be the wrong estimator and would depend on the
// choice of axis.) The smallest eigenvalue is obtained in closed form from the
// symmetric 3x3 characteristic cubic, so no iterative solver is involved.
//
// The residual test is then MAX |(p_i - c) . n| <= tol over every sample — a
// worst-case bound, not an RMS, because one point off the plane is enough to
// make a planar cap wrong.
//
// ===========================================================================
// PART 2 — why the answer is EXACT once the boundary is planar
// ===========================================================================
// The call site asks for a C0 patch through the boundary and nothing else (see
// the header). For a planar boundary the plane region enclosed by the wire
// satisfies that specification exactly, and BRepBuilderAPI_MakeFace's
// plane-deriving overload produces precisely that: a Geom_Plane support trimmed
// by the wire itself. There is no fitting step and no sampling in the RESULT —
// the sampling above is only the admissibility TEST. Area, centre of mass and
// bounding box are therefore exact to machine epsilon, which is measurably
// better than the B-spline OCCT returns (header, MEASURED table).
//
// ===========================================================================
// DROP HYGIENE — no BRepOffset*, BRepOffsetAPI*, BRepFill* or GeomPlate_*
// symbol appears below; test/run_ab_native_filling.sh asserts it on this file's
// own object file.

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/NativeFilling.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdlib>
#include <vector>

#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepGProp.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

namespace forge {
namespace occtfill {
namespace {

const TopoDS_Shape kNull;

// Samples per edge for the planarity test. 24 is well past what any conic or
// cubic needs to reveal an out-of-plane excursion, and the test is O(edges).
constexpr int kSamplesPerEdge = 24;

bool envOn(const char* name) {
    const char* v = std::getenv(name);
    return v && (*v == '1' || *v == 'y' || *v == 'Y' || *v == 't' || *v == 'T');
}

// Every sample point of every edge of `w`. False if the wire has no edge or an
// edge carries no 3-D curve.
bool wireSamples(const TopoDS_Wire& w, std::vector<gp_Pnt>& out) {
    out.clear();
    int nEdge = 0;
    for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ex.Current());
        ++nEdge;
        if (BRep_Tool::Degenerated(e)) continue;
        BRepAdaptor_Curve c(e);
        const double f = c.FirstParameter(), l = c.LastParameter();
        if (!(l > f) && !(f > l)) return false;          // NaN or empty range
        for (int i = 0; i <= kSamplesPerEdge; ++i) {
            const double t = f + (l - f) * static_cast<double>(i) /
                                     static_cast<double>(kSamplesPerEdge);
            out.push_back(c.Value(t));
        }
    }
    return nEdge > 0 && out.size() >= 3;
}

// Smallest-eigenvalue eigenvector of the symmetric 3x3 scatter matrix — the
// total-least-squares plane normal. Closed form via the characteristic cubic
// (the standard symmetric-3x3 analytic eigen-decomposition), then the null
// space of (M - lambda I) taken as the largest cross product of its rows, which
// is numerically the stable choice.
//
// RANK GUARD. A COLLINEAR sample set has a rank-1 scatter matrix, so its null
//   space is a 2-D PENCIL of planes: every plane containing the line fits it
//   with zero residual, and a residual test alone cannot tell them apart. A
//   well-defined plane needs rank >= 2, i.e. the SECOND-smallest eigenvalue must
//   be non-negligible. Eigenvalues are normalised by the trace, so they sum to 1
//   and the threshold is scale-free.
//
//   ★ HONEST STATUS OF THIS GUARD — it is DEFENCE IN DEPTH, not the gate the
//     test suite proves. MEASURED 2026-08-28 by mutation: disabling this guard
//     leaves run_ab_native_filling.sh fully GREEN (80/80), because the
//     positive-area guard at the end of fillC0Boundary is what actually rejects
//     the collinear defer control — disabling THAT one turns the suite red.
//     Both are kept: they reject different things (a degenerate SAMPLE SET
//     versus a degenerate TRIMMED REGION), and the cost is a few flops. But this
//     comment does not claim the suite isolates this guard, because it does not,
//     and no case has been found that isolates it.
bool planeFit(const std::vector<gp_Pnt>& p, gp_Pnt& centroid, gp_Dir& normal) {
    const std::size_t n = p.size();
    if (n < 3) return false;
    double cx = 0.0, cy = 0.0, cz = 0.0;
    for (const gp_Pnt& q : p) { cx += q.X(); cy += q.Y(); cz += q.Z(); }
    cx /= static_cast<double>(n); cy /= static_cast<double>(n); cz /= static_cast<double>(n);
    centroid = gp_Pnt(cx, cy, cz);

    double a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0;
    for (const gp_Pnt& q : p) {
        const double x = q.X() - cx, y = q.Y() - cy, z = q.Z() - cz;
        a00 += x * x; a01 += x * y; a02 += x * z;
        a11 += y * y; a12 += y * z; a22 += z * z;
    }
    // Scale-invariant guard: a degenerate (collinear or coincident) sample set
    // has no plane, and must not be given one.
    const double scale = a00 + a11 + a22;
    if (scale <= 0.0) return false;
    a00 /= scale; a01 /= scale; a02 /= scale; a11 /= scale; a12 /= scale; a22 /= scale;

    // Analytic symmetric eigenvalues (Smith 1961; the form used by Eigen's
    // SelfAdjointEigenSolver 3x3 closed-form path).
    const double q = (a00 + a11 + a22) / 3.0;
    const double b00 = a00 - q, b11 = a11 - q, b22 = a22 - q;
    const double p2 = (b00 * b00 + b11 * b11 + b22 * b22 +
                       2.0 * (a01 * a01 + a02 * a02 + a12 * a12)) / 6.0;
    double lambda = q;                                   // p2 == 0 -> isotropic
    double mid = q;                                      // second-smallest eigenvalue
    if (p2 > 1.0e-300) {
        const double pp = std::sqrt(p2);
        // det((A - qI)/pp) / 2
        const double c00 = b00 / pp, c11 = b11 / pp, c22 = b22 / pp;
        const double c01 = a01 / pp, c02 = a02 / pp, c12 = a12 / pp;
        const double det = c00 * (c11 * c22 - c12 * c12) -
                           c01 * (c01 * c22 - c12 * c02) +
                           c02 * (c01 * c12 - c11 * c02);
        double r = det / 2.0;
        r = std::max(-1.0, std::min(1.0, r));
        const double phi = std::acos(r) / 3.0;
        // eig1 >= eig2 >= eig3; the SMALLEST is the plane normal's eigenvalue.
        const double eig1 = q + 2.0 * pp * std::cos(phi);
        const double eig3 = q + 2.0 * pp * std::cos(phi + 2.0 * M_PI / 3.0);
        const double eig2 = 3.0 * q - eig1 - eig3;
        double e[3] = {eig1, eig2, eig3};
        std::sort(e, e + 3);                             // e[0] <= e[1] <= e[2]
        lambda = e[0];
        mid = e[1];
    }
    // RANK GUARD (see the banner above this function): rank < 2 means a pencil of
    // planes fits equally well, so there is no plane to return.
    if (mid <= 1.0e-12) return false;

    // Null space of (A - lambda I): the largest cross product of its rows.
    const double r0[3] = {a00 - lambda, a01, a02};
    const double r1[3] = {a01, a11 - lambda, a12};
    const double r2[3] = {a02, a12, a22 - lambda};
    auto cross = [](const double u[3], const double v[3], double o[3]) {
        o[0] = u[1] * v[2] - u[2] * v[1];
        o[1] = u[2] * v[0] - u[0] * v[2];
        o[2] = u[0] * v[1] - u[1] * v[0];
    };
    double c01v[3], c02v[3], c12v[3];
    cross(r0, r1, c01v); cross(r0, r2, c02v); cross(r1, r2, c12v);
    auto norm2 = [](const double v[3]) { return v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; };
    const double* best = c01v;
    double bestN = norm2(c01v);
    if (norm2(c02v) > bestN) { best = c02v; bestN = norm2(c02v); }
    if (norm2(c12v) > bestN) { best = c12v; bestN = norm2(c12v); }
    if (bestN <= 1.0e-24) return false;                  // no well-defined normal
    const double inv = 1.0 / std::sqrt(bestN);
    normal = gp_Dir(best[0] * inv, best[1] * inv, best[2] * inv);
    return true;
}

}  // namespace

bool fillingNativeEnabled() {
#ifdef FORGE_FILLING_DROP_NATIVE
    return true;   // the OCCT fallback is compiled out; this is the only path
#else
    static const bool on = envOn("FORGE_FILLING_NATIVE");
    return on;
#endif
}

TopoDS_Shape fillC0Boundary(const TopoDS_Wire& w, double tol) {
    const double t = std::max(tol, 1.0e-12);
    if (w.IsNull()) return kNull;
    if (!BRep_Tool::IsClosed(w)) return kNull;   // an open boundary bounds nothing

    std::vector<gp_Pnt> pts;
    if (!wireSamples(w, pts)) return kNull;

    gp_Pnt c;
    gp_Dir n;
    if (!planeFit(pts, c, n)) return kNull;

    // WORST-CASE orthogonal residual, not RMS: one point off the plane is enough
    // to make a planar cap the wrong answer.
    for (const gp_Pnt& q : pts) {
        if (std::fabs(gp_Vec(c, q).Dot(gp_Vec(n))) > t) return kNull;
    }

    // Exact: a Geom_Plane support trimmed by the wire itself.
    BRepBuilderAPI_MakeFace mkf(w, /*OnlyPlane*/ Standard_True);
    if (!mkf.IsDone()) return kNull;
    const TopoDS_Face f = mkf.Face();
    if (f.IsNull()) return kNull;

    // A cap that encloses no area is not a cap. Independent of the rank guard
    // above on purpose: that one rejects a degenerate SAMPLE SET, this one
    // rejects a degenerate TRIMMED REGION (a self-cancelling or slit boundary
    // whose samples span a plane perfectly well).
    GProp_GProps g;
    BRepGProp::SurfaceProperties(f, g);
    if (!(std::fabs(g.Mass()) > 0.0)) return kNull;
    return f;
}

}  // namespace occtfill
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
