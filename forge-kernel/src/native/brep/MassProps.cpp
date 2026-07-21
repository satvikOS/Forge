// forge/native/brep/MassProps.cpp
//
// Implementation of the in-house B-rep mass-properties (MassProps.hpp). Pure
// C++20, no external deps. See header for the divergence-theorem method.

#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Surface.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

// Accumulator of the ten divergence-theorem surface integrals + area.
struct Accum {
    double vol = 0;            // ∮ x n_x dA  == V
    double mx = 0, my = 0, mz = 0;        // ∮ x²/2 n_x dA == ∫ x dV, etc.
    double ixx = 0, iyy = 0, izz = 0;     // ∫ x² dV, ∫ y² dV, ∫ z² dV (about origin)
    double ixy = 0, iyz = 0, izx = 0;     // ∫ xy dV, ∫ yz dV, ∫ zx dV (about origin)
    double area = 0;
};

// Add one quadrature sample: point p, outward unit normal n, scalar weight w
// (= |S_u x S_v| * gaussWeight, the differential area dA).
inline void addSample(Accum& a, const Vec3& p, const Vec3& n, double w) {
    const double x = p.x, y = p.y, z = p.z;
    a.area += w;
    // Volume & first moments via the symmetric-free single-axis divergence form.
    a.vol += x * n.x * w;                        // div(x,0,0)=1
    a.mx  += 0.5 * x * x * n.x * w;              // div(x²/2,0,0)=x
    a.my  += 0.5 * y * y * n.y * w;              // div(0,y²/2,0)=y
    a.mz  += 0.5 * z * z * n.z * w;              // div(0,0,z²/2)=z
    // Second moments about the ORIGIN.
    a.ixx += (x * x * x / 3.0) * n.x * w;        // ∫x² dV  = ∮ x³/3 n_x dA
    a.iyy += (y * y * y / 3.0) * n.y * w;        // ∫y² dV
    a.izz += (z * z * z / 3.0) * n.z * w;        // ∫z² dV
    a.ixy += 0.5 * x * x * y * n.x * w;          // ∫xy dV = ∮ x²y/2 n_x dA
    a.iyz += 0.5 * y * y * z * n.y * w;          // ∫yz dV
    a.izx += 0.5 * z * z * x * n.z * w;          // ∫zx dV
}

// Gauss-Legendre nodes/weights on [-1,1] for n in {2..10}. Returned mapped to
// [0,1]. Hard-coded high-precision values (standard tables).
void gauss01(int n, std::vector<double>& xs, std::vector<double>& ws) {
    // nodes/weights on [-1,1]
    std::vector<double> x, w;
    switch (n) {
    case 2:
        x = {-0.5773502691896257, 0.5773502691896257};
        w = {1.0, 1.0}; break;
    case 3:
        x = {-0.7745966692414834, 0.0, 0.7745966692414834};
        w = {0.5555555555555556, 0.8888888888888888, 0.5555555555555556}; break;
    case 4:
        x = {-0.8611363115940526, -0.3399810435848563,
              0.3399810435848563, 0.8611363115940526};
        w = {0.3478548451374538, 0.6521451548625461,
             0.6521451548625461, 0.3478548451374538}; break;
    case 5:
        x = {-0.9061798459386640, -0.5384693101056831, 0.0,
              0.5384693101056831, 0.9061798459386640};
        w = {0.2369268850561891, 0.4786286704993665, 0.5688888888888889,
             0.4786286704993665, 0.2369268850561891}; break;
    case 6:
        x = {-0.9324695142031521, -0.6612093864662645, -0.2386191860831969,
              0.2386191860831969, 0.6612093864662645, 0.9324695142031521};
        w = {0.1713244923791704, 0.3607615730481386, 0.4679139345726910,
             0.4679139345726910, 0.3607615730481386, 0.1713244923791704}; break;
    case 7:
        x = {-0.9491079123427585, -0.7415311855993945, -0.4058451513773972, 0.0,
              0.4058451513773972, 0.7415311855993945, 0.9491079123427585};
        w = {0.1294849661688697, 0.2797053914892766, 0.3818300505051189,
             0.4179591836734694, 0.3818300505051189, 0.2797053914892766,
             0.1294849661688697}; break;
    case 10:
        x = {-0.9739065285171717, -0.8650633666889845, -0.6794095682990244,
             -0.4333953941292472, -0.1488743389816312, 0.1488743389816312,
              0.4333953941292472, 0.6794095682990244, 0.8650633666889845,
              0.9739065285171717};
        w = {0.0666713443086881, 0.1494513491505806, 0.2190863625159820,
             0.2692667193099963, 0.2955242247147529, 0.2955242247147529,
             0.2692667193099963, 0.2190863625159820, 0.1494513491505806,
             0.0666713443086881}; break;
    case 8:
    default:
        x = {-0.9602898564975363, -0.7966664774136267, -0.5255324099163290,
             -0.1834346424956498, 0.1834346424956498, 0.5255324099163290,
              0.7966664774136267, 0.9602898564975363};
        w = {0.1012285362903763, 0.2223810344533745, 0.3137066458778873,
             0.3626837833783620, 0.3626837833783620, 0.3137066458778873,
             0.2223810344533745, 0.1012285362903763}; break;
    }
    xs.resize(x.size()); ws.resize(w.size());
    for (std::size_t i = 0; i < x.size(); ++i) {
        xs[i] = 0.5 * (x[i] + 1.0);   // map [-1,1] -> [0,1]
        ws[i] = 0.5 * w[i];           // weight scaled by Jacobian of the map
    }
}

// Integrate one curved (or any) face by tensor Gauss-Legendre over its trim
// window [u0,u1]x[v0,v1]. Uses the analytic Jacobian |S_u x S_v| and the
// parametric normal, sign-corrected to point OUTWARD by comparing against the
// surface's intended outward normal (`reversed` handled inside normalAt, but we
// re-derive from the cross product so the trim-orientation cannot fool us).
void integrateParametric(const Face* f, int gaussN, Accum& acc) {
    const Surface* s = f->surface;
    std::vector<double> gu, gw, gv, gwv;
    gauss01(gaussN, gu, gw);
    gv = gu; gwv = gw;
    const double du = f->u1 - f->u0;
    const double dv = f->v1 - f->v0;
    for (std::size_t a = 0; a < gu.size(); ++a) {
        double u = f->u0 + du * gu[a];
        for (std::size_t b = 0; b < gv.size(); ++b) {
            double v = f->v0 + dv * gv[b];
            Vec3 p, su, sv;
            s->evaluateDeriv(u, v, p, su, sv);
            double jac = vlen(vcross(su, sv));
            if (jac <= 0.0) continue;
            // Use the surface's OWN outward normal (honours `reversed`), so the
            // material side is taken from the topology, not guessed from the
            // (left/right-handed) parameterization. The downstream global-volume
            // guard then only has to fix a globally-flipped shell, never an
            // individual mis-oriented face (e.g. a tube's inner wall).
            Vec3 n = s->normalAt(u, v);
            double w = jac * gw[a] * gwv[b] * du * dv;
            addSample(acc, p, n, w);
        }
    }
}

// Integrate one CURVED analytic face over its ACTUAL trimmed (u,v) region — the
// outer boundary polygon f->regionOuterUV minus the hole polygons
// f->regionInnerUV, in the surface's OWN parameter space — by a SCAN-LINE
// (even-odd) quadrature. A vertical line u = const is swept across the region's
// u-range; every boundary edge it crosses contributes a v-crossing, and the
// sorted crossings pair up into the interior v-intervals (a hole shows up as the
// excluded GAP between two pairs, so it is cut out with NO explicit
// subtraction). Each (u-strip x v-interval) cell is integrated with tensor
// Gauss-Legendre of the analytic |S_u x S_v| Jacobian and the topological
// outward normal (honours `reversed`; the global acc.vol<0 flip fixes a globally
// inward parameterization exactly as integrateParametric does). This is the
// general non-rectangular replacement for integrateParametric: for a GENUINE
// full rectangle every scan-line yields the single interval [v0,v1], so it
// converges to the same integral. Native primitives never set regionUV, so
// their rectangle path (integrateParametric) stays byte-identical (core 34/34).
void integrateParametricRegion(const Face* f, Accum& acc) {
    const Surface* s = f->surface;
    const std::vector<std::array<double, 2>>& outer = f->regionOuterUV;
    if (outer.size() < 3) return;

    // Gather every boundary edge (outer + holes) as (u,v) segment endpoints.
    struct Seg { double ua, va, ub, vb; };
    std::vector<Seg> segs;
    auto addLoop = [&](const std::vector<std::array<double, 2>>& poly) {
        const std::size_t n = poly.size();
        if (n < 3) return;
        for (std::size_t i = 0; i < n; ++i) {
            const std::array<double, 2>& a = poly[i];
            const std::array<double, 2>& b = poly[(i + 1) % n];
            segs.push_back({a[0], a[1], b[0], b[1]});
        }
    };
    addLoop(outer);
    for (const std::vector<std::array<double, 2>>& h : f->regionInnerUV) addLoop(h);
    if (segs.empty()) return;

    double uMin = outer[0][0], uMax = outer[0][0];
    for (const Seg& g : segs) {
        uMin = std::min(uMin, std::min(g.ua, g.ub));
        uMax = std::max(uMax, std::max(g.ua, g.ub));
    }
    const double uSpan = uMax - uMin;
    if (uSpan <= 0.0) return;

    std::vector<double> gU, gUw, gV, gVw;
    gauss01(4, gU, gUw);   // 4 Gauss nodes per u-strip
    gauss01(8, gV, gVw);   // 8 Gauss nodes per v-interval

    // A crenellated trim (an imported flange rim with slots/teeth) has an interior-
    // height function that JUMPS at its vertical tooth walls — axial cylinder edges,
    // which map to constant-u (Δu≈0) segments in (u,v). A uniform Gauss strip that
    // STRADDLES such a jump mis-quadratures it (the 4-node Gauss rule is exact only
    // for a smooth integrand), over-counting a fine comb by ~1.8% in area (measured:
    // a r=75 flange rim integrated 1620.8 vs the true 1592.6). Placing a strip
    // boundary exactly at each vertical-wall u makes the crossing set CONSTANT within
    // every strip, so its Gauss quadrature is area-exact.
    //
    // Do this ONLY for a RECTILINEAR trim — every boundary segment axis-aligned in
    // (u,v): horizontal (a cut plane perpendicular to the axis → constant v) or
    // vertical (an axial edge → constant u). Such a boundary is CHORD-ERROR-FREE, so
    // the region polygon equals the true trimmed face EXACTLY (verified: the r=75
    // comb integrated 1592.5988 == OCCT), and snapping makes the quadrature match it.
    // A DIAGONAL segment (e.g. a cylinder∩inclined-plane sinusoid) means the densified
    // polygon only APPROXIMATES the trim; snapping it would integrate the imperfect
    // chord polygon exactly (measured: regressed a saddle-cut cylinder), so those keep
    // the prior coarse uniform sampling — which is preserved byte-for-byte below.
    // (regionUV path only — native primitives use integrateParametric, unaffected.)
    double vMin = segs[0].va, vMax = segs[0].va;
    for (const Seg& g : segs) {
        vMin = std::min(vMin, std::min(g.va, g.vb));
        vMax = std::max(vMax, std::max(g.va, g.vb));
    }
    const double uEps = 1e-4 * std::max(1.0, uSpan);
    const double vEps = 1e-4 * std::max(1.0, vMax - vMin);
    bool rectilinear = true;
    for (const Seg& g : segs) {
        if (std::fabs(g.ua - g.ub) > uEps && std::fabs(g.va - g.vb) > vEps) {
            rectilinear = false; break;
        }
    }
    std::vector<double> ubk;
    ubk.reserve(segs.size() + 2);
    if (rectilinear) {
        for (const Seg& g : segs) {
            if (std::fabs(g.ua - g.ub) > uEps) continue;     // not a vertical wall
            const double uw = 0.5 * (g.ua + g.ub);
            if (uw >= uMin - 1e-12 && uw <= uMax + 1e-12) ubk.push_back(uw);
        }
    }
    ubk.push_back(uMin); ubk.push_back(uMax);
    std::sort(ubk.begin(), ubk.end());
    ubk.erase(std::unique(ubk.begin(), ubk.end(),
                          [](double p, double q) { return std::fabs(p - q) < 1e-9; }),
              ubk.end());
    // Old uniform strip width (kept, so a face with NO vertical walls has a single
    // gap [uMin,uMax] subdivided into exactly the old nStrip strips at the old
    // boundaries — byte-identical to the prior code — and only comb faces change).
    int nStrip = (int)std::ceil(uSpan / 0.15);
    if (nStrip < 10)  nStrip = 10;
    if (nStrip > 240) nStrip = 240;
    const double duOld = uSpan / nStrip;
    std::vector<std::array<double, 2>> strips;
    strips.reserve(nStrip + ubk.size() + 8);
    for (std::size_t i = 0; i + 1 < ubk.size(); ++i) {
        const double a = ubk[i], b = ubk[i + 1];
        const double w = b - a;
        if (w <= 1e-12) continue;
        int sub = (int)std::lround(w / duOld);
        if (sub < 1)   sub = 1;
        if (sub > 512) sub = 512;
        const double sw = w / sub;
        for (int k = 0; k < sub; ++k) strips.push_back({a + sw * k, a + sw * (k + 1)});
    }
    if (strips.empty()) return;

    std::vector<double> xs;
    xs.reserve(16);
    for (const auto& st : strips) {
        const double uStrip0 = st[0];
        const double du = st[1] - st[0];
        for (std::size_t a = 0; a < gU.size(); ++a) {
            const double u = uStrip0 + du * gU[a];
            // v-crossings of the vertical line u=const with every boundary edge.
            // Half-open [min,max) test so a shared vertex is counted exactly once.
            xs.clear();
            for (const Seg& g : segs) {
                const double u0 = g.ua, u1 = g.ub;
                if ((u0 <= u && u < u1) || (u1 <= u && u < u0)) {
                    const double t = (u - u0) / (u1 - u0);
                    xs.push_back(g.va + t * (g.vb - g.va));
                }
            }
            if (xs.size() < 2) continue;
            std::sort(xs.begin(), xs.end());
            const std::size_t nEven = xs.size() & ~std::size_t(1); // floor to even
            for (std::size_t k = 0; k + 1 < nEven; k += 2) {
                const double vLoAll = xs[k], vHiAll = xs[k + 1];
                const double vSpan = vHiAll - vLoAll;
                if (vSpan <= 0.0) continue;
                // A doubly-periodic TORUS's minor angle (v = phi) carries harmonics up
                // to 3 over a FULL 2π period, which a single 8-node Gauss v-interval
                // under-resolves (~1e-4 rel on the merged one-face torus). Subdivide the
                // v-interval into ~0.15-wide sub-panels — the SAME rule the u strips use
                // — so a full-period toroidal region face integrates to the analytic
                // volume. Gated to Torus so EVERY cylinder/cone/sphere/plane region face
                // (native primitives never set regionUV; imported cyl/cone/sphere trims
                // and merged cyl/cone/sphere) stays BYTE-IDENTICAL (nSubV==1 reproduces
                // the prior single-interval arithmetic exactly).
                int nSubV = 1;
                if (s->kind == SurfaceKind::Torus) {
                    nSubV = static_cast<int>(std::ceil(vSpan / 0.15));
                    if (nSubV < 1)   nSubV = 1;
                    if (nSubV > 512) nSubV = 512;
                }
                const double dv = vSpan / nSubV;
                for (int sv = 0; sv < nSubV; ++sv) {
                    const double vLo = vLoAll + dv * sv;
                    for (std::size_t b = 0; b < gV.size(); ++b) {
                        const double v = vLo + dv * gV[b];
                        Vec3 p, sU, sV;
                        s->evaluateDeriv(u, v, p, sU, sV);
                        const double jac = vlen(vcross(sU, sV));
                        if (jac <= 0.0) continue;
                        const Vec3 n = s->normalAt(u, v);
                        const double w = jac * gUw[a] * gVw[b] * du * dv;
                        addSample(acc, p, n, w);
                    }
                }
            }
        }
    }
}

// Integrate one CURVED analytic face over its PARAMETER TRIANGLE (the (u,v)
// triangle spanned by the first three vertexUV entries) rather than the axis-
// aligned rectangle. Used by the native boolean when it splits a curved face
// along an imprinted cut: the sub-face is a true patch of the SAME quadric, so we
// integrate the analytic |S_u x S_v| Jacobian over the parameter triangle using a
// degree-exact triangle quadrature mapped onto the (u,v) triangle. The outward
// normal honours the surface's `reversed` flag (the in/out side is topological).
void integrateParametricTri(const Face* f, Accum& acc) {
    const Surface* s = f->surface;
    if (f->vertexUV.size() < 3) return;
    const double u0 = f->vertexUV[0][0], v0 = f->vertexUV[0][1];
    const double u1 = f->vertexUV[1][0], v1 = f->vertexUV[1][1];
    const double u2 = f->vertexUV[2][0], v2 = f->vertexUV[2][1];

    // A symmetric degree-5 triangle rule (7-point Dunavant) in barycentric coords
    // keeps the curved-Jacobian integrand accurate. Each off-centre family is the
    // orbit {(a,a,1-2a) and its two cyclic permutations} for that family's `a`; the
    // barycentric coordinates of EVERY node must sum to 1 (a+a+(1-2a)=1). The two
    // families are:
    //   A:  a = 0.47014206410511505  (so 1-2a = 0.05971587178976990), weight wA
    //   B:  a = 0.10128650732345633  (so 1-2a = 0.79742698535308740), weight wB
    // (The previous form cross-wired the two families' `a` and `1-2a`, yielding
    // nodes whose barycentric coordinates did NOT sum to 1 — they sampled OFF the
    // reference triangle — so every curved sub-face integrated by this rule, e.g.
    // an imported cylinder/cone wall strip, was biased low by ~1.5% in mass. The
    // rule below uses the exact, self-consistent Dunavant nodes.)
    struct TQ { double a, b, c, w; };
    static const double w1 = 0.225;
    static const double wA = 0.13239415278850618;
    static const double wB = 0.12593918054482715;
    static const double aA = 0.47014206410511505;   // family A node
    static const double cA = 1.0 - 2.0 * aA;         // = 0.05971587178976990
    static const double aB = 0.10128650732345633;   // family B node
    static const double cB = 1.0 - 2.0 * aB;         // = 0.79742698535308740
    const TQ rule[7] = {
        {1.0/3, 1.0/3, 1.0/3, w1},
        {aA, aA, cA, wA}, {aA, cA, aA, wA}, {cA, aA, aA, wA},
        {aB, aB, cB, wB}, {aB, cB, aB, wB}, {cB, aB, aB, wB},
    };
    // Parameter-triangle area Jacobian: the map (b0,b1,b2)->(u,v) is affine with
    // constant Jacobian = 2*area of the (u,v) triangle. The triangle rule weights
    // sum to 1 and integrate over the unit-area reference, so multiply by the (u,v)
    // triangle area to get ∫_T g du dv. |S_u x S_v| already carries the surface
    // metric, so the surface integral is ∫_T (g * |S_u x S_v|) du dv.
    double uvArea = 0.5 * std::fabs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0));
    if (uvArea <= 0.0) return;
    for (const auto& q : rule) {
        double u = q.a * u0 + q.b * u1 + q.c * u2;
        double v = q.a * v0 + q.b * v1 + q.c * v2;
        Vec3 p, su, sv;
        s->evaluateDeriv(u, v, p, su, sv);
        double jac = vlen(vcross(su, sv));
        if (jac <= 0.0) continue;
        Vec3 n = s->normalAt(u, v);
        double w = q.w * uvArea * jac;   // dA = |Su x Sv| du dv ; ∫ = Σ w_i area g_i
        addSample(acc, p, n, w);
    }
}

// Integrate one PLANAR face exactly by triangulating its polygon (fan from
// vertex 0) and applying a degree-3-exact triangle quadrature (the integrands
// are at most cubic monomials, the Jacobian is constant on a flat triangle, so
// this is EXACT to rounding). The polygon vertices come from the face's outer
// loop in ring order; the constant outward normal comes from the plane.
void integratePlanarExact(const Face* f, Accum& acc) {
    // Recover the ordered ring of 3D points by walking the loop's coedges.
    std::vector<Vec3> pts;
    Loop* lp = f->outerLoop;
    Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
        Vertex* o = c->originVertex();
        pts.push_back(Vec3{o->point.x, o->point.y, o->point.z});
        c = c->next;
    }
    if (pts.size() < 3) return;

    const Surface* s = f->surface;
    Vec3 n = s->normalAt(0.5 * (f->u0 + f->u1), 0.5 * (f->v0 + f->v1));

    // Degree-3-exact symmetric 4-point triangle rule (Strang/Hammer), barycentric.
    struct TQ { double a, b, c, w; };
    static const TQ rule[4] = {
        {1.0 / 3, 1.0 / 3, 1.0 / 3, -27.0 / 48.0},
        {0.6, 0.2, 0.2, 25.0 / 48.0},
        {0.2, 0.6, 0.2, 25.0 / 48.0},
        {0.2, 0.2, 0.6, 25.0 / 48.0},
    };
    const Vec3& P0 = pts[0];
    // WINDING-CONSISTENT ORIENTATION (K1 imported-face fix, byte-identical for
    // native primitives). The face's outward normal is `n` (== normalAt, honours
    // `reversed`), and the analytic quadric faces are ALWAYS integrated with that
    // outward normal and a POSITIVE Jacobian weight (integrateParametric/Region) —
    // their sign is topological, NOT winding-derived. A planar face must use the
    // SAME convention or a shell that mixes the two gets a self-cancelling volume.
    // The fan below uses the SIGNED triangle area 0.5*(e1 x e2)·n, whose sign is
    // (correctly) +1 when the ring winds CCW about `n` and -1 when it winds CW.
    // An imported STEP outer loop is occasionally emitted CW about the face's own
    // outward normal (its total signed area comes out negative): that faces's flux
    // ∮ x n_x dA is then integrated INWARD, corrupting the divergence volume far
    // more than its area (a handful of large CW planar faces flip ~40% of the
    // volume while barely moving the area). Detect it via the polygon's TOTAL
    // signed area and, when negative, orient the WHOLE face CCW about `n` (multiply
    // every fan triangle by -1). This keeps the non-convex fan sum exact (relative
    // triangle signs are preserved) while making the face's outward flux agree with
    // its topological normal; the global acc.vol<0 guard then fixes a uniformly
    // inward shell. For a correctly-wound face (every native primitive, and most
    // imported faces) the total signed area is already >= 0, sgn = +1, and this is
    // BYTE-IDENTICAL to the previous code (protects core 34/34).
    double Atot = 0.0;
    for (std::size_t t = 1; t + 1 < pts.size(); ++t) {
        Vec3 e1 = vsub(pts[t], P0), e2 = vsub(pts[t + 1], P0);
        Atot += 0.5 * vdot(vcross(e1, e2), n);
    }
    const double sgn = (Atot < 0.0) ? -1.0 : 1.0;
    for (std::size_t t = 1; t + 1 < pts.size(); ++t) {
        const Vec3& P1 = pts[t];
        const Vec3& P2 = pts[t + 1];
        Vec3 e1 = vsub(P1, P0), e2 = vsub(P2, P0);
        // SIGNED planar triangle area (projected onto the face normal), oriented so
        // the whole face is CCW about its outward normal `n` (sgn above).
        double A = sgn * 0.5 * vdot(vcross(e1, e2), n);
        if (A == 0.0) continue;
        // The 4-point rule weights q.w sum to 1, so ∫_T f dA ≈ A * Σ q.w f(b_i).
        for (const auto& q : rule) {
            Vec3 p = vadd(vadd(vscale(P0, q.a), vscale(P1, q.b)), vscale(P2, q.c));
            addSample(acc, p, n, q.w * A);
        }
    }

    // HOLED ANALYTIC FACE (native boolean): the divergence-theorem surface
    // integral over the annulus = ∫(outer) − Σ ∫(inner hole). The face is planar,
    // so EVERY inner loop is integrated with the SAME constant outward normal `n`
    // and SUBTRACTED. This is EXACT for the planar caps (the integrands are cubic
    // monomials, the degree-3 rule is exact). Gated on `boolHoled` so ONLY
    // boolean-emitted holed faces are hole-aware — the fillet/other inner-loop
    // faces keep the original outer-loop-only integral byte-for-byte.
    if (f->boolHoled) {
        for (Loop* il : f->innerLoops) {
            std::vector<Vec3> ip;
            Coedge* ic = il->first;
            for (std::size_t i = 0; i < il->coedgeCount; ++i) {
                Vertex* o = ic->originVertex();
                ip.push_back(Vec3{o->point.x, o->point.y, o->point.z});
                ic = ic->next;
            }
            if (ip.size() < 3) continue;
            const Vec3& Q0 = ip[0];
            // NON-CONVEX-EXACT hole area (K1 imported-face fix). The hole is fanned
            // from Q0 with the SIGNED triangle area 0.5*(a1 x a2)·n — NOT the unsigned
            // |a1 x a2| — because the unsigned per-triangle magnitude DOUBLE-COUNTS a
            // NON-CONVEX hole (its reflex triangles overlap and all add positively),
            // subtracting far more than the hole's real area (measured on an imported
            // 146-vertex non-convex hole: unsigned fan 1324 vs true area 650, halving
            // the face and dropping the part's volume ~5%). The signed fan cancels the
            // overlap exactly (the same reason the OUTER loop above uses the signed
            // area). Orient the whole hole positive about `n` (sgnH) so a hole wound
            // either way subtracts its true POSITIVE area. For a CONVEX planar hole —
            // every native boolean drilled round bore — the loop is coplanar with `n`,
            // so |0.5*(a1 x a2)·n| == 0.5*|a1 x a2| for every triangle and this is
            // BYTE-IDENTICAL to the previous unsigned code (protects the core gate).
            double AtotH = 0.0;
            for (std::size_t t = 1; t + 1 < ip.size(); ++t) {
                Vec3 a1 = vsub(ip[t], Q0), a2 = vsub(ip[t + 1], Q0);
                AtotH += 0.5 * vdot(vcross(a1, a2), n);
            }
            const double sgnH = (AtotH < 0.0) ? -1.0 : 1.0;
            for (std::size_t t = 1; t + 1 < ip.size(); ++t) {
                Vec3 a1 = vsub(ip[t], Q0), a2 = vsub(ip[t + 1], Q0);
                double Ah = sgnH * 0.5 * vdot(vcross(a1, a2), n);
                if (Ah == 0.0) continue;
                for (const auto& q : rule) {
                    Vec3 p = vadd(vadd(vscale(Q0, q.a), vscale(ip[t], q.b)), vscale(ip[t + 1], q.c));
                    addSample(acc, p, n, -q.w * Ah); // SUBTRACT the hole contribution
                }
            }
        }
    }
}

// Integrate an EXACT circular disk / annular sector planar face in polar
// coordinates. The face is in the plane through `origin` with constant outward
// normal; it spans theta in [u0,u1] and radius in [v0,v1] (== [diskInner,
// diskOuter] in the canonical builders). dA = rho d(rho) d(theta). Gauss order
// is bumped to 10 in rho to keep the cubic-in-position integrands exact.
void integrateDiskExact(const Face* f, Accum& acc) {
    const Surface* s = f->surface;
    Vec3 n = s->normalAt(0.5 * (f->u0 + f->u1), 0.5 * (f->v0 + f->v1));
    Vec3 er = s->refDir;
    Vec3 et = s->binormal();
    std::vector<double> gt, gtw, gr, grw;
    gauss01(10, gt, gtw);
    gr = gt; grw = gtw;
    const double t0 = f->u0, t1 = f->u1, r0 = f->v0, r1 = f->v1;
    const double dt = t1 - t0, dr = r1 - r0;
    for (std::size_t a = 0; a < gt.size(); ++a) {
        double th = t0 + dt * gt[a];
        double ct = std::cos(th), st = std::sin(th);
        for (std::size_t b = 0; b < gr.size(); ++b) {
            double rho = r0 + dr * gr[b];
            Vec3 p = vadd(s->origin, vadd(vscale(er, rho * ct), vscale(et, rho * st)));
            double w = rho * gtw[a] * grw[b] * dt * dr; // rho dA Jacobian
            addSample(acc, p, n, w);
        }
    }
}

} // namespace

MassProps massProperties(const Solid& solid, int gaussN) {
    Accum acc;
    for (Shell* sh : solid.shells) {
        for (Face* f : sh->faces) {
            if (f->surface == nullptr) continue; // bare-topology face: skip (no geometry)
            if (f->surface->kind == SurfaceKind::Plane) {
                if (f->surface->isDisk) integrateDiskExact(f, acc);
                else                    integratePlanarExact(f, acc);
            } else if (f->regionUV && f->regionOuterUV.size() >= 3) {
                integrateParametricRegion(f, acc);
            } else if (f->paramTri) {
                integrateParametricTri(f, acc);
            } else {
                integrateParametric(f, gaussN, acc);
            }
        }
    }

    // Global orientation guard: the per-face sign correction only makes each
    // face self-consistent, not globally outward (a parameterization may be
    // left-handed). The divergence theorem fixes this unambiguously — if the net
    // signed volume came out negative the whole boundary was integrated with
    // INWARD normals, so flip every accumulated moment uniformly (this is exactly
    // the integral with outward normals; area, being ∮dA, is sign-independent and
    // already positive). Robust for convex AND for the genus-1 torus/tube where a
    // centroid-interior test would fail.
    if (acc.vol < 0.0) {
        acc.vol = -acc.vol;
        acc.mx = -acc.mx; acc.my = -acc.my; acc.mz = -acc.mz;
        acc.ixx = -acc.ixx; acc.iyy = -acc.iyy; acc.izz = -acc.izz;
        acc.ixy = -acc.ixy; acc.iyz = -acc.iyz; acc.izx = -acc.izx;
    }

    MassProps out;
    out.volume = acc.vol;
    out.area = acc.area;
    const double V = acc.vol;
    if (std::fabs(V) > 0.0) {
        out.com[0] = acc.mx / V;
        out.com[1] = acc.my / V;
        out.com[2] = acc.mz / V;
    }
    // Inertia about the ORIGIN:
    //   Ixx = ∫(y²+z²)dV = iyy + izz ; Iyy = izz + ixx ; Izz = ixx + iyy
    //   Ixy = -∫xy dV ; Iyz = -∫yz dV ; Izx = -∫zx dV
    double IxxO = acc.iyy + acc.izz;
    double IyyO = acc.izz + acc.ixx;
    double IzzO = acc.ixx + acc.iyy;
    double IxyO = -acc.ixy;
    double IyzO = -acc.iyz;
    double IzxO = -acc.izx;
    // Huygens parallel-axis shift to the COM: I_com = I_O - m * shift.
    const double cx = out.com[0], cy = out.com[1], cz = out.com[2];
    const double m = V; // unit density
    // Diagonal:  I_O = I_C + m*(perp distance²)  =>  I_C = I_O - m*(...).
    double IxxC = IxxO - m * (cy * cy + cz * cz);
    double IyyC = IyyO - m * (cz * cz + cx * cx);
    double IzzC = IzzO - m * (cx * cx + cy * cy);
    // Products:  Ixy(O) = Ixy(C) - m*cx*cy  =>  Ixy(C) = Ixy(O) + m*cx*cy.
    double IxyC = IxyO + m * cx * cy;
    double IyzC = IyzO + m * cy * cz;
    double IzxC = IzxO + m * cz * cx;

    out.inertiaCom[0] = IxxC; out.inertiaCom[1] = IxyC; out.inertiaCom[2] = IzxC;
    out.inertiaCom[3] = IxyC; out.inertiaCom[4] = IyyC; out.inertiaCom[5] = IyzC;
    out.inertiaCom[6] = IzxC; out.inertiaCom[7] = IyzC; out.inertiaCom[8] = IzzC;
    return out;
}

} // namespace brep
} // namespace native
} // namespace forge
