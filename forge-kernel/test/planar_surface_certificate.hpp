// ─────────────────────────────────────────────────────────────────────────────
// planar_surface_certificate.hpp — "is this face's surface THE plane P, to
// tolerance?" — the one predicate behind the SURFACE-KIND EQUIVALENCE rule.
//
// WHY THIS EXISTS. The flip gate's agreement term compares faces binned BY
// SURFACE KIND, because an engine that swaps an analytic quadric for a spline
// keeps every scalar and every count and changes only the TYPE. That term is
// load-bearing and must not be weakened. But it also reds two families where
// the substitution runs the OTHER way: on FILLING, 407 of 407 differing pairs
// are native `Plane` against OCCT `BSplineSurface` on the same single face with
// the same four line edges — OCCT's BRepOffsetAPI_MakeFilling builds a GeomPlate
// spline over a boundary that is exactly planar, and the native engine returns
// the exact plane.
//
// A BLANKET "ignore surface kind" WOULD BE THE WRONG FIX. It would also forgive
// cylinder->spline and sphere->spline, which is exactly what the kind histogram
// was added to catch. The narrow fix is a MEASURED CERTIFICATE: a non-Plane
// surface is treated as a Plane only when it is proved, by sampling ITS OWN
// geometry, to be planar AND to be the SAME plane. A quadric approximated by a
// spline fails that proof by construction — a cylinder is not planar anywhere
// on a patch that spans real curvature — and the negative controls in
// test/plane_spline_consumer_equivalence.cpp assert exactly that, on real
// NurbsConvert output rather than on a hand-built fixture.
//
// THE PREDICATE. Sample the face's surface on an N x N grid over the face's own
// UV bounds. At each sample take the point and the two partials, and form the
// unit normal. Then:
//
//   n_ref  = normalise(sum of sample normals, each aligned to the first)
//   p0     = centroid of the sample points
//   d      = -n_ref . p0
//   devMax = max over samples of |n_ref . p_i + d|          (a LENGTH)
//   angMax = max over samples of the angle between n_i and +-n_ref  (RADIANS)
//
// planar  iff  devMax <= tolLen  AND  angMax <= tolAng.
//
// BOTH TERMS ARE REQUIRED AND NEITHER IS REDUNDANT. devMax alone passes a
// shallow patch of a very large cylinder (curvature below tolerance over that
// patch) — but such a patch IS a plane to tolerance, so that is not the leak.
// The leak devMax alone leaves is a surface that oscillates about the plane at
// a sub-tolerance amplitude while its NORMALS swing: a corrugation. angMax
// closes it. Conversely angMax alone passes two parallel planes at different
// offsets, which devMax closes only together with the returned `d`. The caller
// compares (n, d), not merely the boolean.
//
// CANONICAL FORM, AND WHY IT IS NOT WHAT GETS COMPARED. (n, d) and (-n, -d) are
// the same plane. `canonicalise` picks one of the two for REPORTING — the first
// component of n whose magnitude exceeds 1e-12 is made positive — and that is
// all it is for. IT MUST NOT BE THE BASIS OF A COMPARISON: a normal whose
// leading component lands in the narrow band just either side of the 1e-12
// threshold can canonicalise one way on one arm and the other way on the other,
// and the two identical planes would then read as completely different. A
// canonicalisation that is stable for almost every input and unstable for a few
// is exactly the kind of gate that reds a valid part.
//
// `invariants()` is what a caller comparing two planes across a process
// boundary should use instead: ten quantities that are UNCHANGED by the
// (n,d) -> (-n,-d) flip and that together determine the plane —
//   nx^2 ny^2 nz^2  nx.ny nx.nz ny.nz   d^2   d.nx d.ny d.nz
// Every term is a product of two sign-flipping factors, so the sign cancels by
// construction and there is no threshold anywhere in it. Face orientation is a
// separate observable and stays separate (on a solid it is already caught by
// SIGNED volume, which is how family THICKEN is caught).
//
// NOT A TOLERANCE WIDENING. This header never relaxes an existing comparison.
// It is only ever consulted when two kind histograms already DISAGREE, and it
// can only convert a disagreement into an agreement when the geometry proves
// the two surfaces are the same plane. Every other disagreement is untouched.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <cmath>
#include <algorithm>

#include <BRepAdaptor_Surface.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

namespace forge {
namespace planarcert {

struct PlanarCert {
    bool   planar  = false;
    bool   sampled = false;   // false => the adaptor could not be built at all
    double n[3]    = {0, 0, 0};
    double d       = 0.0;
    double devMax  = 0.0;     // length, in the model's units
    double angMax  = 0.0;     // radians
    int    nsamp   = 0;
    int    rawKind = -1;      // GeomAbs_SurfaceType as read, before any rule
};

// N x N samples. 11 is not a free choice: it is odd (so the patch CENTRE is
// sampled, where a symmetric bulge is largest and a corner-only grid is blind),
// and 121 points cost microseconds against the milliseconds an arm already
// spends. A 2x2 grid would certify any bilinear patch through four coplanar
// corners as planar; that is the failure this constant exists to avoid.
inline constexpr int kGrid = 11;

inline void canonicalise(double n[3], double& d) {
    for (int i = 0; i < 3; ++i) {
        if (std::fabs(n[i]) > 1e-12) {
            if (n[i] < 0.0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; d = -d; }
            return;
        }
    }
}

// The ten sign-invariant plane moments, in the order documented above. Both
// arms accumulate these per planar face and the sums are compared; sums are an
// order-independent FINGERPRINT of the plane multiset, not a proof of set
// equality, and they sit behind the full observable vector rather than in front
// of it.
inline void invariants(const double n[3], double d, double out[10]) {
    out[0] = n[0] * n[0]; out[1] = n[1] * n[1]; out[2] = n[2] * n[2];
    out[3] = n[0] * n[1]; out[4] = n[0] * n[2]; out[5] = n[1] * n[2];
    out[6] = d * d;
    out[7] = d * n[0];    out[8] = d * n[1];    out[9] = d * n[2];
}

// tolLen is a LENGTH in model units; tolAng is in RADIANS. Both are supplied by
// the caller because the right value depends on the part's size and on what the
// caller's other comparisons already use — this header does not invent one.
inline PlanarCert certify(const TopoDS_Face& f, double tolLen, double tolAng) {
    PlanarCert c;

    double u1 = 0, u2 = 0, v1 = 0, v2 = 0;
    BRepAdaptor_Surface ad;
    try {
        ad = BRepAdaptor_Surface(f, Standard_False);
        c.rawKind = static_cast<int>(ad.GetType());
        BRepTools::UVBounds(f, u1, u2, v1, v2);
    } catch (...) {
        return c;                       // sampled == false: NOT planar, never assumed
    }
    if (!(u2 > u1) || !(v2 > v1)) return c;
    // An infinite or half-infinite parametric range cannot be gridded. Refusing
    // is the safe direction: an uncertified face stays a kind mismatch.
    if (!std::isfinite(u1) || !std::isfinite(u2) ||
        !std::isfinite(v1) || !std::isfinite(v2)) return c;

    double pts[kGrid * kGrid][3];
    double nrm[kGrid * kGrid][3];
    int    m = 0;
    for (int i = 0; i < kGrid; ++i) {
        const double u = u1 + (u2 - u1) * (static_cast<double>(i) / (kGrid - 1));
        for (int j = 0; j < kGrid; ++j) {
            const double v = v1 + (v2 - v1) * (static_cast<double>(j) / (kGrid - 1));
            gp_Pnt p; gp_Vec du, dv;
            try { ad.D1(u, v, p, du, dv); } catch (...) { continue; }
            const gp_Vec cr = du.Crossed(dv);
            const double mag = cr.Magnitude();
            if (!(mag > 1e-12)) continue;   // a degenerate seam/pole row: skipped,
                                            // and `m` records that it was skipped
            pts[m][0] = p.X(); pts[m][1] = p.Y(); pts[m][2] = p.Z();
            nrm[m][0] = cr.X() / mag; nrm[m][1] = cr.Y() / mag; nrm[m][2] = cr.Z() / mag;
            ++m;
        }
    }
    c.nsamp = m;
    // Fewer than 4 usable samples cannot pin a plane down; refuse rather than
    // certify on 3 points, which are ALWAYS coplanar.
    if (m < 4) return c;
    c.sampled = true;

    double acc[3] = {0, 0, 0};
    for (int k = 0; k < m; ++k) {
        const double s = (nrm[k][0] * nrm[0][0] + nrm[k][1] * nrm[0][1] +
                          nrm[k][2] * nrm[0][2]) < 0.0 ? -1.0 : 1.0;
        acc[0] += s * nrm[k][0]; acc[1] += s * nrm[k][1]; acc[2] += s * nrm[k][2];
    }
    const double an = std::sqrt(acc[0] * acc[0] + acc[1] * acc[1] + acc[2] * acc[2]);
    if (!(an > 1e-12)) return c;     // normals cancelled: emphatically not a plane
    c.n[0] = acc[0] / an; c.n[1] = acc[1] / an; c.n[2] = acc[2] / an;

    double ctr[3] = {0, 0, 0};
    for (int k = 0; k < m; ++k) { ctr[0] += pts[k][0]; ctr[1] += pts[k][1]; ctr[2] += pts[k][2]; }
    ctr[0] /= m; ctr[1] /= m; ctr[2] /= m;
    c.d = -(c.n[0] * ctr[0] + c.n[1] * ctr[1] + c.n[2] * ctr[2]);

    for (int k = 0; k < m; ++k) {
        const double dev = std::fabs(c.n[0] * pts[k][0] + c.n[1] * pts[k][1] +
                                     c.n[2] * pts[k][2] + c.d);
        c.devMax = std::max(c.devMax, dev);
        double dot = nrm[k][0] * c.n[0] + nrm[k][1] * c.n[1] + nrm[k][2] * c.n[2];
        dot = std::fabs(dot);
        if (dot > 1.0) dot = 1.0;
        c.angMax = std::max(c.angMax, std::acos(dot));
    }

    canonicalise(c.n, c.d);
    c.planar = (c.devMax <= tolLen) && (c.angMax <= tolAng);
    return c;
}

}  // namespace planarcert
}  // namespace forge
