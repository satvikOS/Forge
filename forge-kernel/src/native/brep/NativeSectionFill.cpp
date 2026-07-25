// forge/native/brep/NativeSectionFill.cpp
//
// Implementation of forge::occtfill::sectionFillSurface — the TKGeomAlgo-free
// replacement for GeomFill_NSections (see NativeSectionFill.hpp for the scope,
// the drop-hygiene contract and the wiring plan).
//
// Construction re-implemented from the standard NURBS SKINNING definition (NOT
// copied source): Piegl & Tiller, "The NURBS Book" 2nd ed., §10.3 (skinned /
// lofted surfaces), building on §9.2.1 (global curve interpolation), eq. 10.8
// (averaged section parameters) and eq. 9.8 (averaged knots). Section-curve
// compatibility (common domain / degree / knot vector) is done with
// Geom_BSplineCurve's own exact member operations (IncreaseDegree / InsertKnots,
// both TKG3d); the v-direction interpolation is a plain native dense solve.
//
// WIRING PLAN (orchestrator wires + builds serially; this file is AUTHOR-ONLY).
//   Call site: src/Features.cpp forge::part::loftWithGuides(), the guided branch
//   (~L2302-2325) that today does:
//       TColGeom_SequenceOfCurve seqCurves;                 // filled from wires
//       ...
//       GeomFill_NSections filler(seqCurves);
//       filler.ComputeSurface();
//       Handle(Geom_BSplineSurface) skin = filler.BSplineSurface();
//       if (skin.IsNull()) throw ...;
//   Native swap (keep the OCCT path behind #else for the A/B window):
//       #ifdef FORGE_NATIVE_BREP
//       Handle(Geom_BSplineSurface) skin =
//           forge::occtfill::sectionFillSurface(seqCurves);   // interpolates all sections
//       if (skin.IsNull()) { /* honest defer */ ...OCCT path... }
//       #else
//       GeomFill_NSections filler(seqCurves); filler.ComputeSurface();
//       Handle(Geom_BSplineSurface) skin = filler.BSplineSurface();
//       #endif
//   Add this .cpp to CMakeLists.txt beside the other native/brep OCCT-boundary
//   sources (it is gated by the same FORGE_NATIVE_BREP whole-file #ifdef).
//   NOTE: loftWithGuides' section fit (wireToCurve, ~L2298) still calls
//   GeomAPI_PointsToBSpline — ALSO a TKGeomAlgo symbol. Swap it to the already-
//   native forge::occtconv::pointsToBSpline in the same window; both must go
//   before TKGeomAlgo can leave OCCT_LIBS. This file removes only the
//   GeomFill_NSections triplet.
//
// MATH VERIFICATION (reasoned, NOT built — per task constraints) at the bottom.

#include "forge/native/brep/NativeSectionFill.hpp"

#ifdef FORGE_NATIVE_BREP

#include "forge/native/geom/NativeNurbsConvert.hpp"   // forge::occtconv::curveToBSpline

#include <Geom_BSplineCurve.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_Curve.hxx>

#include <Standard_Failure.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColStd_Array2OfReal.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <cmath>
#include <vector>

namespace {

// ===========================================================================
//  Small pure-native numerics (no OCCT) — B-spline basis + dense LU solve for
//  the v-direction global interpolation (P&T The NURBS Book, A2.1/A2.2/A9.1).
// ===========================================================================

// P&T A2.1 — knot span index for a clamped knot vector U (last ctrl index n).
int findSpan(int n, int p, double u, const std::vector<double>& U) {
    if (u >= U[n + 1]) return n;
    if (u <= U[p]) return p;
    int low = p, high = n + 1, mid = (low + high) / 2;
    while (u < U[mid] || u >= U[mid + 1]) {
        if (u < U[mid]) high = mid; else low = mid;
        mid = (low + high) / 2;
    }
    return mid;
}

// P&T A2.2 — the p+1 nonzero basis functions N[0..p] at u in span i.
void basisFuns(int i, double u, int p, const std::vector<double>& U,
               std::vector<double>& N) {
    N.assign(p + 1, 0.0);
    N[0] = 1.0;
    std::vector<double> left(p + 1, 0.0), right(p + 1, 0.0);
    for (int j = 1; j <= p; ++j) {
        left[j]  = u - U[i + 1 - j];
        right[j] = U[i + j] - u;
        double saved = 0.0;
        for (int r = 0; r < j; ++r) {
            double denom = right[r + 1] + left[j - r];
            double temp  = (denom != 0.0) ? N[r] / denom : 0.0;
            N[r]  = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        N[j] = saved;
    }
}

// Dense LU (partial pivot) of the m x m collocation matrix A (row-major). The
// same factorisation drives every RHS column of the skin. Returns false on a
// singular pivot => caller defers. Mutates A -> LU, records the permutation.
bool luFactor(std::vector<double>& A, int m, std::vector<int>& piv) {
    piv.resize(m);
    for (int i = 0; i < m; ++i) piv[i] = i;
    for (int col = 0; col < m; ++col) {
        int best = col; double bestv = std::fabs(A[col * m + col]);
        for (int rr = col + 1; rr < m; ++rr) {
            double v = std::fabs(A[rr * m + col]);
            if (v > bestv) { bestv = v; best = rr; }
        }
        if (bestv < 1e-14) return false;
        if (best != col) {
            for (int cc = 0; cc < m; ++cc) std::swap(A[col * m + cc], A[best * m + cc]);
            std::swap(piv[col], piv[best]);
        }
        for (int rr = col + 1; rr < m; ++rr) {
            double f = A[rr * m + col] / A[col * m + col];
            A[rr * m + col] = f;
            for (int cc = col + 1; cc < m; ++cc) A[rr * m + cc] -= f * A[col * m + cc];
        }
    }
    return true;
}
// Solve (LU x = P b) in place; b is permuted per `piv` then forward/back-substituted.
void luSolve(const std::vector<double>& LU, int m, const std::vector<int>& piv,
             std::vector<double>& b) {
    std::vector<double> y(m);
    for (int i = 0; i < m; ++i) y[i] = b[piv[i]];
    for (int i = 0; i < m; ++i)
        for (int k = 0; k < i; ++k) y[i] -= LU[i * m + k] * y[k];
    for (int i = m - 1; i >= 0; --i) {
        for (int k = i + 1; k < m; ++k) y[i] -= LU[i * m + k] * y[k];
        y[i] /= LU[i * m + i];
    }
    b = y;
}

// Reparametrise a clamped B-spline to the [0,1] u-domain (affine knot rescale).
// Exact: an affine reparametrisation leaves poles/weights unchanged. Skips the
// rebuild when the curve is already on [0,1].
Handle(Geom_BSplineCurve) normalizeTo01(const Handle(Geom_BSplineCurve)& bs) {
    const int nk = bs->NbKnots();
    const double f = bs->Knot(1), l = bs->Knot(nk);
    if (l - f <= 1e-15) return Handle(Geom_BSplineCurve)();
    if (std::fabs(f) < 1e-12 && std::fabs(l - 1.0) < 1e-12) return bs;
    const int np  = bs->NbPoles();
    const int deg = bs->Degree();
    TColgp_Array1OfPnt      P(1, np);
    TColStd_Array1OfReal    K(1, nk);
    TColStd_Array1OfInteger M(1, nk);
    for (int i = 1; i <= np; ++i) P.SetValue(i, bs->Pole(i));
    for (int i = 1; i <= nk; ++i) {
        K.SetValue(i, (bs->Knot(i) - f) / (l - f));
        M.SetValue(i, bs->Multiplicity(i));
    }
    if (bs->IsRational()) {
        TColStd_Array1OfReal W(1, np);
        for (int i = 1; i <= np; ++i) W.SetValue(i, bs->Weight(i));
        return new Geom_BSplineCurve(P, W, K, M, deg, Standard_False);
    }
    return new Geom_BSplineCurve(P, K, M, deg, Standard_False);
}

}  // namespace

namespace forge {
namespace occtfill {

Handle(Geom_BSplineSurface)
sectionFillSurface(const std::vector<Handle(Geom_Curve)>& sections, int vDegreeMax) {
    const int K = static_cast<int>(sections.size());
    if (K < 2) return Handle(Geom_BSplineSurface)();

    try {
        // ---- 1) each section -> normalised clamped Geom_BSplineCurve ----------
        std::vector<Handle(Geom_BSplineCurve)> sec(K);
        bool anyRational = false;
        for (int k = 0; k < K; ++k) {
            if (sections[k].IsNull()) return Handle(Geom_BSplineSurface)();
            Handle(Geom_BSplineCurve) bs = forge::occtconv::curveToBSpline(sections[k]);
            if (bs.IsNull()) return Handle(Geom_BSplineSurface)();      // honest defer
            if (bs->IsPeriodic()) bs->SetNotPeriodic();
            bs = normalizeTo01(bs);
            if (bs.IsNull()) return Handle(Geom_BSplineSurface)();
            if (bs->IsRational()) anyRational = true;
            sec[k] = bs;
        }

        // ---- 2a) common degree p (elevate every section to it) ----------------
        int p = 0;
        for (int k = 0; k < K; ++k) p = std::max(p, sec[k]->Degree());
        for (int k = 0; k < K; ++k)
            if (sec[k]->Degree() < p) sec[k]->IncreaseDegree(p);

        // ---- 2b) common u-knot vector: union of distinct interior knots at the
        //          MAX multiplicity across sections; InsertKnots(Add=false) raises
        //          each section to it -> all share one identical u-knot vector.
        std::vector<std::pair<double, int>> uni;   // (value, maxMult), sorted
        const double kTol = 1e-7;
        for (int k = 0; k < K; ++k) {
            const int nk = sec[k]->NbKnots();
            for (int i = 2; i <= nk - 1; ++i) {     // interior only (skip clamped ends)
                const double v = sec[k]->Knot(i);
                const int    m = sec[k]->Multiplicity(i);
                bool merged = false;
                for (auto& e : uni)
                    if (std::fabs(e.first - v) <= kTol) { e.second = std::max(e.second, m); merged = true; break; }
                if (!merged) uni.emplace_back(v, m);
            }
        }
        std::sort(uni.begin(), uni.end(),
                  [](const std::pair<double,int>& a, const std::pair<double,int>& b){ return a.first < b.first; });
        if (!uni.empty()) {
            TColStd_Array1OfReal    UK(1, static_cast<int>(uni.size()));
            TColStd_Array1OfInteger UM(1, static_cast<int>(uni.size()));
            for (int i = 0; i < static_cast<int>(uni.size()); ++i) {
                UK.SetValue(i + 1, uni[i].first);
                UM.SetValue(i + 1, uni[i].second);
            }
            for (int k = 0; k < K; ++k)
                sec[k]->InsertKnots(UK, UM, kTol, Standard_False);   // Add=false => raise-to-max
        }

        // All sections must now agree on pole count; any mismatch => honest defer.
        const int nU = sec[0]->NbPoles();
        for (int k = 1; k < K; ++k)
            if (sec[k]->NbPoles() != nU) return Handle(Geom_BSplineSurface)();

        // Common u-knot vector / multiplicities / degree, read from section 0.
        const int uKn = sec[0]->NbKnots();
        std::vector<double> uKnots(uKn);
        std::vector<int>    uMults(uKn);
        for (int i = 1; i <= uKn; ++i) { uKnots[i - 1] = sec[0]->Knot(i); uMults[i - 1] = sec[0]->Multiplicity(i); }
        const int uDeg = p;

        // ---- 3a) v-parameters vbar[0..K-1]: averaged chord length over all u
        //          control columns (P&T eq 10.8), falling back to equal spacing.
        std::vector<double> vbar(K, 0.0);
        {
            std::vector<std::vector<double>> cum(nU, std::vector<double>(K, 0.0));
            std::vector<double> total(nU, 0.0);
            int good = 0;
            for (int i = 0; i < nU; ++i) {
                for (int k = 1; k < K; ++k) {
                    double d = sec[k]->Pole(i + 1).Distance(sec[k - 1]->Pole(i + 1));
                    cum[i][k] = cum[i][k - 1] + d;
                }
                total[i] = cum[i][K - 1];
                if (total[i] > 1e-12) ++good;
            }
            if (good == 0) {
                for (int k = 0; k < K; ++k) vbar[k] = double(k) / double(K - 1);   // degenerate: uniform
            } else {
                for (int k = 1; k < K - 1; ++k) {
                    double s = 0.0;
                    for (int i = 0; i < nU; ++i) if (total[i] > 1e-12) s += cum[i][k] / total[i];
                    vbar[k] = s / good;
                }
                vbar[0] = 0.0; vbar[K - 1] = 1.0;
                for (int k = 1; k < K; ++k) if (vbar[k] <= vbar[k - 1]) vbar[k] = vbar[k - 1] + 1e-9;
                if (vbar[K - 1] < 1.0) vbar[K - 1] = 1.0;
            }
        }

        // ---- 3b) v-degree and averaged v-knot vector (P&T eq 9.8, clamped) -----
        const int q = std::min(std::max(1, vDegreeMax), K - 1);
        const int nV = K;                       // full interpolation => K v-control points
        std::vector<double> V(nV + q + 1, 0.0);
        for (int j = nV; j <= nV + q; ++j) V[j] = 1.0;
        for (int j = 1; j <= nV - q - 1; ++j) {
            double s = 0.0;
            for (int i = j; i <= j + q - 1; ++i) s += vbar[i];
            V[q + j] = s / q;
        }

        // ---- 3c) build the K x K v-collocation matrix, factor once ------------
        std::vector<double> A(nV * nV, 0.0);
        std::vector<double> Nb;
        for (int k = 0; k < K; ++k) {
            int span = findSpan(nV - 1, q, vbar[k], V);
            basisFuns(span, vbar[k], q, V, Nb);
            for (int t = 0; t <= q; ++t) A[k * nV + (span - q + t)] = Nb[t];
        }
        std::vector<int> piv;
        if (!luFactor(A, nV, piv)) return Handle(Geom_BSplineSurface)();

        // ---- 3d) solve for the surface control net Q[i][j] (i in u, j in v) ---
        //          Rational sections skin in homogeneous (w*x,w*y,w*z,w) coords.
        std::vector<std::vector<gp_Pnt>> Q(nU, std::vector<gp_Pnt>(nV));
        std::vector<std::vector<double>> Wt;
        if (anyRational) Wt.assign(nU, std::vector<double>(nV, 1.0));

        std::vector<double> bx(K), by(K), bz(K), bw(K);
        for (int i = 0; i < nU; ++i) {
            for (int k = 0; k < K; ++k) {
                const gp_Pnt P = sec[k]->Pole(i + 1);
                const double w = anyRational ? sec[k]->Weight(i + 1) : 1.0;
                bx[k] = P.X() * w; by[k] = P.Y() * w; bz[k] = P.Z() * w; bw[k] = w;
            }
            luSolve(A, nV, piv, bx);
            luSolve(A, nV, piv, by);
            luSolve(A, nV, piv, bz);
            if (anyRational) luSolve(A, nV, piv, bw);
            for (int j = 0; j < nV; ++j) {
                const double w = anyRational ? bw[j] : 1.0;
                if (anyRational && std::fabs(w) < 1e-300) return Handle(Geom_BSplineSurface)();
                Q[i][j] = gp_Pnt(bx[j] / w, by[j] / w, bz[j] / w);
                if (anyRational) Wt[i][j] = w;
            }
        }

        // ---- 4) assemble the Geom_BSplineSurface (u = sections, v = across) ----
        // distinct v-knots + multiplicities from the clamped vector V.
        std::vector<double> vKnots; std::vector<int> vMults;
        for (double v : V) {
            if (vKnots.empty() || std::fabs(v - vKnots.back()) > 1e-12) { vKnots.push_back(v); vMults.push_back(1); }
            else vMults.back()++;
        }

        TColgp_Array2OfPnt P2(1, nU, 1, nV);
        for (int i = 0; i < nU; ++i)
            for (int j = 0; j < nV; ++j) P2.SetValue(i + 1, j + 1, Q[i][j]);

        TColStd_Array1OfReal    UK(1, static_cast<int>(uKnots.size()));
        TColStd_Array1OfInteger UM(1, static_cast<int>(uMults.size()));
        for (int i = 0; i < static_cast<int>(uKnots.size()); ++i) { UK.SetValue(i + 1, uKnots[i]); UM.SetValue(i + 1, uMults[i]); }
        TColStd_Array1OfReal    VK(1, static_cast<int>(vKnots.size()));
        TColStd_Array1OfInteger VM(1, static_cast<int>(vMults.size()));
        for (int i = 0; i < static_cast<int>(vKnots.size()); ++i) { VK.SetValue(i + 1, vKnots[i]); VM.SetValue(i + 1, vMults[i]); }

        if (anyRational) {
            TColStd_Array2OfReal W2(1, nU, 1, nV);
            for (int i = 0; i < nU; ++i)
                for (int j = 0; j < nV; ++j) W2.SetValue(i + 1, j + 1, Wt[i][j]);
            return new Geom_BSplineSurface(P2, W2, UK, VK, UM, VM, uDeg, q,
                                           Standard_False, Standard_False);
        }
        return new Geom_BSplineSurface(P2, UK, VK, UM, VM, uDeg, q,
                                       Standard_False, Standard_False);
    } catch (const Standard_Failure&) {
        return Handle(Geom_BSplineSurface)();   // honest defer on any OCCT failure
    }
}

Handle(Geom_BSplineSurface)
sectionFillSurface(const TColGeom_SequenceOfCurve& sections, int vDegreeMax) {
    std::vector<Handle(Geom_Curve)> v;
    v.reserve(sections.Length());
    for (int i = sections.Lower(); i <= sections.Upper(); ++i) v.push_back(sections.Value(i));
    return sectionFillSurface(v, vDegreeMax);
}

}  // namespace occtfill
}  // namespace forge

// ===========================================================================
//  MATH-VERIFICATION NOTE (task item 3 — reasoned, NOT built).
//
//  CASE: two identical circle sections of radius R (e.g. z=0 and z=h copies).
//   * curveToBSpline(circle) -> the exact rational quadratic (ref NativeNurbs-
//     Convert sec 2): 9 poles, weights {1, c, 1, c, ...} (c=cos45 = sqrt2/2),
//     distinct u-knots {0,1/4,1/2,3/4,1}, mults {3,2,2,2,3}, degree 2. BOTH
//     sections yield the identical u-basis, so anyRational = true.
//   * Compatibility is a no-op: same degree (2), same knots, same 9 poles.
//     nU = 9, p = uDeg = 2.
//   * K = 2 -> q = min(vDegreeMax, K-1) = min(3,1) = 1 (RULED in v). nV = 2.
//     V = {0,0,1,1}. vbar = {0,1}. Collocation A = [[1,0],[0,1]] (basisFuns at
//     v=0 = {1,0}, at v=1 = {0,1}) -> IDENTITY -> luFactor trivially ok.
//   * Homogeneous solve per column i is the identity map: v-control points
//     Qw[i][0] = row0 homogeneous pole, Qw[i][1] = row1 homogeneous pole. Since
//     the two circles are identical up to the z-translation, every column's two
//     poles differ only in z -> the cartesian net is the two circle pole rings
//     and Wt[i][j] = the circle weight (constant in j).
//   * Assembled surface: bidegree (2,1), rational in u, u-knots {0,1/4,1/2,3/4,1}
//     mults {3,2,2,2,3}, v-knots {0,1} mults {2,2} — which is EXACTLY the
//     canonical cylinder B-spline form emitted by occtconv::surfaceToBSpline for
//     a Geom_CylindricalSurface (NativeNurbsConvert sec 5: bidegree (2,1),
//     rational in u, linear in v). => a CYLINDER of radius R, height h. VERIFIED.
//
//  GENERAL K>2: full v-interpolation (nV=K control points, averaged params &
//  knots) makes the surface pass through EVERY section curve exactly (the
//  collocation rows evaluate the v-basis to the section poles at vbar_k), i.e.
//  a loft THROUGH the N sections — the GeomFill_NSections contract, sharpened
//  from approximation to interpolation. Rational sections are exact because the
//  interpolation is linear in the homogeneous poles, and IncreaseDegree/
//  InsertKnots are exact rational operations in homogeneous form (TKG3d).
// ===========================================================================

#endif  // FORGE_NATIVE_BREP
