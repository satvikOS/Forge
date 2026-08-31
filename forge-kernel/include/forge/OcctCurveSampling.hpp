// forge/OcctCurveSampling.hpp — TKGeomBase-free curve discretisation.
//
// nativeQuasiUniformDeflectionParams is the in-house replacement for
// GCPnts_QuasiUniformDeflection, whose ctor + Value are TKGeomBase-EXCLUSIVE
// symbols (_ZN29GCPnts_QuasiUniformDeflectionC1E... / _ZNK29...5ValueEi) that
// block the K6 (OCCT-zero) TKGeomBase drop. It reproduces OCCT's QuasiFleche
// recursion: bisect [ua,ub], evaluate the curve midpoint Pm, and split the cell
// while the deflection (perpendicular distance of Pm to the chord Pa->Pb) exceeds
// the deflection tolerance — the exact GCPnts_QuasiUniformDeflection stop
// criterion — bounded by a max recursion depth and a minimum parameter span.
//
// It samples ONLY through the adaptor's virtual Value() (an Adaptor3d_Curve
// evaluator — TKBRep/TKG3d, NOT TKGeomBase), so no TKGeomBase symbol is
// referenced. Same family of in-house sampler as OcctImport.cpp's
// nativeUniformAbscissaParams (dropped GCPnts_UniformAbscissa) and
// DirectModeling.cpp's nativeTangentialDeflectionParams (dropped
// GCPnts_TangentialDeflection).
//
// Output: `params` is filled with monotone-increasing parameters over
// [FirstParameter, LastParameter], endpoints inclusive, >= 2 entries whenever the
// curve has a non-degenerate parameter range (matching sampler.NbPoints() >= 2 /
// Value(i) for i in 1..NbPoints). A degenerate (zero-span) range yields a single
// parameter; callers keep their existing endpoint fallback for that case.
#pragma once

#include <Adaptor3d_Curve.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <vector>

namespace forge {

namespace detail {

// Recursively bisect [ua,ub], appending the interior split parameters IN ORDER to
// `params`. A cell splits while the deflection (distance of the true curve midpoint
// Pm to the chord Pa->Pb) exceeds sqrt(defl2) — compared squared to skip the root.
// Bounded by `maxDepth` and the minimum parameter span `minStep`.
inline void quasiFleche(const Adaptor3d_Curve& C, double defl2,
                        double ua, const gp_Pnt& Pa,
                        double ub, const gp_Pnt& Pb,
                        double minStep, int depth, int maxDepth,
                        std::vector<double>& params) {
    if (depth >= maxDepth || (ub - ua) <= minStep) return;
    const double um = 0.5 * (ua + ub);
    const gp_Pnt Pm = C.Value(um);
    const gp_Vec Vab(Pa, Pb);
    const double n = Vab.Magnitude();
    double dist2;
    if (n > 1.0e-12) {
        const gp_Vec Vam(Pa, Pm);
        const double d = Vam.Crossed(Vab).Magnitude() / n;  // perpendicular dist
        dist2 = d * d;
    } else {
        const double d = Pm.Distance(Pa);                   // degenerate chord
        dist2 = d * d;
    }
    if (dist2 > defl2) {
        quasiFleche(C, defl2, ua, Pa, um, Pm, minStep, depth + 1, maxDepth, params);
        params.push_back(um);
        quasiFleche(C, defl2, um, Pm, ub, Pb, minStep, depth + 1, maxDepth, params);
    }
}

} // namespace detail

// Drop-in native equivalent of `GCPnts_QuasiUniformDeflection s(ad, deflection)`
// followed by reading s.Value(1..s.NbPoints()): fills `params` with the sample
// parameters (endpoints inclusive, monotone f->l). Point i of the OCCT sampler
// corresponds to `ad.Value(params[i-1])`.
inline void nativeQuasiUniformDeflectionParams(const Adaptor3d_Curve& ad,
                                               double deflection,
                                               std::vector<double>& params) {
    params.clear();
    const double f = ad.FirstParameter();
    const double l = ad.LastParameter();
    const double span = l - f;
    if (!(span > 0.0)) { params.push_back(f); return; }
    const double defl  = (deflection > 0.0) ? deflection : 1.0e-3;
    const double defl2 = defl * defl;
    const double minStep = span * 1.0e-4;
    const gp_Pnt Pa = ad.Value(f);
    const gp_Pnt Pb = ad.Value(l);
    params.reserve(8);
    params.push_back(f);
    detail::quasiFleche(ad, defl2, f, Pa, l, Pb, minStep, 0, 32, params);
    params.push_back(l);
}

} // namespace forge
