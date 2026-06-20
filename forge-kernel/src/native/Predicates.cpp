// forge/native/Predicates.cpp
//
// Implementation of the robust geometric predicates declared in
// forge/native/Predicates.hpp.
//
// Re-derived from first principles. See the header for the honesty statement
// of the guarantee. Below, every helper is documented with the identity it
// realises so the correctness argument is self-contained.
//
// The exact-arithmetic engine is a small floating-point "expansion" library:
// an expansion is a sequence e[0..n-1] of nonzero (mostly non-overlapping)
// doubles whose EXACT sum is the value it represents, stored smallest-magnitude
// first. All combinators below preserve the invariant that the exact sum of the
// output equals the exact sum of the inputs combined with the requested
// operation -- i.e. they are error-free.
//
// Pure C++20. No external dependencies.

#include "forge/native/Predicates.hpp"

#include <cmath>   // std::fma, std::fabs
#include <cstddef> // std::size_t

namespace forge {
namespace native {

namespace {

// ===========================================================================
// 1. Error-free transformations (EFTs)
// ===========================================================================
//
// All of these are exact identities under IEEE-754 round-to-nearest binary64,
// assuming no overflow and no underflow into the denormal range. They are the
// foundation of every higher routine.

// twoSum: x = round(a+b), err = (a+b) - x, EXACTLY, with x + err == a + b.
// Knuth's classic 6-flop algorithm; works for arbitrary a,b (no ordering
// requirement). Branch-free.
inline void twoSum(double a, double b, double& x, double& err) {
    x = a + b;
    double bv = x - a;
    double av = x - bv;
    double br = b - bv;
    double ar = a - av;
    err = ar + br;
}

// twoDiff: x = round(a-b), err = (a-b) - x exactly. Same idea as twoSum.
// (Reference EFT primitive of the expansion library; kept for completeness even
// though the current predicates route subtraction through twoProductDifference.)
[[maybe_unused]] inline void twoDiff(double a, double b, double& x, double& err) {
    x = a - b;
    double bv = a - x;
    double av = x + bv;
    double br = bv - b;
    double ar = a - av;
    err = ar + br;
}

// twoProduct: x = round(a*b), err = a*b - x exactly.
// Realised with a fused multiply-add: std::fma(a,b,-x) yields the exact
// rounding error of the product in one rounded operation (the FMA computes
// a*b - x with a single rounding, and a*b - x is exactly representable, so the
// result is exact). This avoids Dekker's splitting entirely and is exact on any
// platform with a correctly-rounded FMA (Apple arm64 has hardware FMA).
inline void twoProduct(double a, double b, double& x, double& err) {
    x = a * b;
    err = std::fma(a, b, -x);
}

// ===========================================================================
// 2. Expansion arithmetic
// ===========================================================================
//
// Expansions are stored in fixed-size stack buffers (no heap) because every
// determinant here has a statically bounded number of terms. Components are
// kept smallest-first and (mostly) non-overlapping; trailing/zero components
// are allowed and harmless because routines only ever read the exact sum.

// growExpansion: h = e + b, where e is an n-term expansion and b a single
// double. Returns the new length. h may alias e. Output length <= n+1.
// This is Shewchuk's grow-expansion, re-derived: sweep b through the
// components with twoSum, carrying the running remainder.
// (Reference primitive; the predicates use scaleExpansion + fastExpansionSum.)
[[maybe_unused]] inline int growExpansion(const double* e, int n, double b, double* h) {
    double q = b;
    int hi = 0;
    for (int i = 0; i < n; ++i) {
        double qnew, hh;
        twoSum(q, e[i], qnew, hh);
        q = qnew;
        if (hh != 0.0) h[hi++] = hh;
    }
    if (q != 0.0 || hi == 0) h[hi++] = q;
    return hi;
}

// fastExpansionSum: h = e + f, where e (len n) and f (len m) are expansions.
// Re-derived merge: walk both sorted-by-magnitude inputs in a merge, threading
// a running compensation term q through twoSum. Output length <= n+m. h must be
// distinct from e and f. Produces a non-overlapping expansion (zeros dropped).
inline int fastExpansionSum(const double* e, int n,
                            const double* f, int m,
                            double* h) {
    int i = 0, j = 0, hi = 0;
    // enow / fnow: next component of each input (smallest first).
    double enow = (n > 0) ? e[0] : 0.0;
    double fnow = (m > 0) ? f[0] : 0.0;
    double q, hh;

    // Seed q with the smaller-magnitude leading component.
    if (n == 0 && m == 0) { h[0] = 0.0; return 1; }
    if (m == 0) { for (int k = 0; k < n; ++k) h[k] = e[k]; return n; }
    if (n == 0) { for (int k = 0; k < m; ++k) h[k] = f[k]; return m; }

    if (std::fabs(fnow) > std::fabs(enow)) {
        q = enow; ++i; enow = (i < n) ? e[i] : 0.0;
    } else {
        q = fnow; ++j; fnow = (j < m) ? f[j] : 0.0;
    }

    while (i < n && j < m) {
        if (std::fabs(fnow) > std::fabs(enow)) {
            twoSum(q, enow, q, hh);
            ++i; enow = (i < n) ? e[i] : 0.0;
        } else {
            twoSum(q, fnow, q, hh);
            ++j; fnow = (j < m) ? f[j] : 0.0;
        }
        if (hh != 0.0) h[hi++] = hh;
    }
    while (i < n) {
        twoSum(q, enow, q, hh);
        ++i; enow = (i < n) ? e[i] : 0.0;
        if (hh != 0.0) h[hi++] = hh;
    }
    while (j < m) {
        twoSum(q, fnow, q, hh);
        ++j; fnow = (j < m) ? f[j] : 0.0;
        if (hh != 0.0) h[hi++] = hh;
    }
    if (q != 0.0 || hi == 0) h[hi++] = q;
    return hi;
}

// scaleExpansion: h = e * b, e an n-term expansion, b a double.
// Re-derived: multiply each component by b with twoProduct, accumulating the
// products into a running sum with twoSum so no bits are lost. Output length
// <= 2n. h must be distinct from e.
inline int scaleExpansion(const double* e, int n, double b, double* h) {
    if (n == 0) { h[0] = 0.0; return 1; }
    int hi = 0;
    double q, hh;
    twoProduct(e[0], b, q, hh);
    if (hh != 0.0) h[hi++] = hh;
    for (int i = 1; i < n; ++i) {
        double pi, plo;
        twoProduct(e[i], b, pi, plo);
        double sum, serr;
        twoSum(q, plo, sum, serr);
        if (serr != 0.0) h[hi++] = serr;
        twoSum(pi, sum, q, hh);
        if (hh != 0.0) h[hi++] = hh;
    }
    if (q != 0.0 || hi == 0) h[hi++] = q;
    return hi;
}

// estimate: the rounded double value of an expansion (its components summed
// large-to-small order is not necessary because they are sorted small-first;
// plain accumulation recovers the leading term to full accuracy for our use).
// (Reference helper for a float-estimate of an expansion; not on the hot path.)
[[maybe_unused]] inline double estimate(const double* e, int n) {
    double s = 0.0;
    for (int i = 0; i < n; ++i) s += e[i];
    return s;
}

// signOfExpansion: exact sign of an expansion's value. Because the components
// are non-overlapping and sorted smallest-first, the sign is the sign of the
// LARGEST-magnitude (last nonzero) component.
inline Sign signOfExpansion(const double* e, int n) {
    for (int i = n - 1; i >= 0; --i) {
        if (e[i] > 0.0) return Sign::POSITIVE;
        if (e[i] < 0.0) return Sign::NEGATIVE;
    }
    return Sign::ZERO;
}

inline Sign signOfDouble(double d) {
    if (d > 0.0) return Sign::POSITIVE;
    if (d < 0.0) return Sign::NEGATIVE;
    return Sign::ZERO;
}

// twoTwoProduct-style helper: exact expansion of (a*b - c*d), a 2-component or
// up-to-4-component result depending on cancellation. Returns length.
// Build a*b as a 2-term expansion, c*d as a 2-term expansion, then subtract.
inline int twoProductDifference(double a, double b, double c, double d,
                                double* h) {
    double ab_hi, ab_lo, cd_hi, cd_lo;
    twoProduct(a, b, ab_hi, ab_lo);
    twoProduct(c, d, cd_hi, cd_lo);
    // negate cd
    double negcd[2] = { -cd_lo, -cd_hi };
    double ab[2] = { ab_lo, ab_hi };
    return fastExpansionSum(ab, 2, negcd, 2, h);
}

// ===========================================================================
// 3. Machine-epsilon error bounds for the adaptive filters
// ===========================================================================
//
// epsilon = 2^-53 is the unit roundoff for round-to-nearest binary64. The
// orientation/incircle/insphere static filter constants below are the standard
// Shewchuk forward-error bounds, re-derived from epsilon:
//   - each product introduces a relative error <= epsilon,
//   - each sum introduces <= epsilon,
// accumulated through the determinant's flop graph. We keep one extra ulp of
// slack. If |det_approx| > errbound * permanent, the sign of det_approx is
// certified correct; otherwise we escalate to the exact path.
constexpr double kEpsilon = 1.1102230246251565e-16; // 2^-53
// (1 + 2*eps) style growth factors, conservative:
constexpr double o2dErrBoundA = (3.0 + 16.0 * kEpsilon) * kEpsilon;
constexpr double o3dErrBoundA = (7.0 + 56.0 * kEpsilon) * kEpsilon;
constexpr double icErrBoundA  = (10.0 + 96.0 * kEpsilon) * kEpsilon;
constexpr double isErrBoundA  = (16.0 + 224.0 * kEpsilon) * kEpsilon;

} // namespace

// ===========================================================================
// 4. orient2d
// ===========================================================================

Sign orient2d(double ax, double ay,
              double bx, double by,
              double cx, double cy) {
    // det = (ax-cx)(by-cy) - (ay-cy)(bx-cx)
    double acx = ax - cx;
    double bcx = bx - cx;
    double acy = ay - cy;
    double bcy = by - cy;

    double left  = acx * bcy;
    double right = acy * bcx;
    double det = left - right;

    // Static filter: if the determinant is clearly far from zero, trust it.
    double detsum;
    if (left > 0.0) {
        if (right <= 0.0) return signOfDouble(det);
        detsum = left + right;
    } else if (left < 0.0) {
        if (right >= 0.0) return signOfDouble(det);
        detsum = -left - right;
    } else {
        return signOfDouble(det);
    }
    double errbound = o2dErrBoundA * detsum;
    if (det > errbound || -det > errbound) return signOfDouble(det);

    // Exact path: det = acx*bcy - acy*bcx, evaluated with no rounding error.
    double D[8];
    int n = twoProductDifference(acx, bcy, acy, bcx, D);
    return signOfExpansion(D, n);
}

// ===========================================================================
// 5. orient3d
// ===========================================================================

Sign orient3d(double ax, double ay, double az,
              double bx, double by, double bz,
              double cx, double cy, double cz,
              double dx, double dy, double dz) {
    double adx = ax - dx, ady = ay - dy, adz = az - dz;
    double bdx = bx - dx, bdy = by - dy, bdz = bz - dz;
    double cdx = cx - dx, cdy = cy - dy, cdz = cz - dz;

    // 2x2 minors
    double bdxcdy = bdx * cdy, cdxbdy = cdx * bdy;
    double cdxady = cdx * ady, adxcdy = adx * cdy;
    double adxbdy = adx * bdy, bdxady = bdx * ady;

    double det = adz * (bdxcdy - cdxbdy)
               + bdz * (cdxady - adxcdy)
               + cdz * (adxbdy - bdxady);

    double permanent =
        (std::fabs(bdxcdy) + std::fabs(cdxbdy)) * std::fabs(adz)
      + (std::fabs(cdxady) + std::fabs(adxcdy)) * std::fabs(bdz)
      + (std::fabs(adxbdy) + std::fabs(bdxady)) * std::fabs(cdz);

    double errbound = o3dErrBoundA * permanent;
    if (det > errbound || -det > errbound) return signOfDouble(det);

    // Exact path. det = adz*(bdx*cdy - cdx*bdy)
    //                 + bdz*(cdx*ady - adx*cdy)
    //                 + cdz*(adx*bdy - bdx*ady)
    // Each parenthesised term is an exact expansion (twoProductDifference),
    // scaled by the corresponding ad?/bd?/cd? and summed.
    double m1[8]; int n1 = twoProductDifference(bdx, cdy, cdx, bdy, m1);
    double m2[8]; int n2 = twoProductDifference(cdx, ady, adx, cdy, m2);
    double m3[8]; int n3 = twoProductDifference(adx, bdy, bdx, ady, m3);

    double t1[16]; int s1 = scaleExpansion(m1, n1, adz, t1);
    double t2[16]; int s2 = scaleExpansion(m2, n2, bdz, t2);
    double t3[16]; int s3 = scaleExpansion(m3, n3, cdz, t3);

    double sum12[32]; int ns = fastExpansionSum(t1, s1, t2, s2, sum12);
    double total[64]; int nt = fastExpansionSum(sum12, ns, t3, s3, total);

    return signOfExpansion(total, nt);
}

// ===========================================================================
// 6. incircle
// ===========================================================================

Sign incircle(double ax, double ay,
              double bx, double by,
              double cx, double cy,
              double dx, double dy) {
    double adx = ax - dx, ady = ay - dy;
    double bdx = bx - dx, bdy = by - dy;
    double cdx = cx - dx, cdy = cy - dy;

    double bdxcdy = bdx * cdy, cdxbdy = cdx * bdy;
    double cdxady = cdx * ady, adxcdy = adx * cdy;
    double adxbdy = adx * bdy, bdxady = bdx * ady;

    double alift = adx * adx + ady * ady;
    double blift = bdx * bdx + bdy * bdy;
    double clift = cdx * cdx + cdy * cdy;

    double det = alift * (bdxcdy - cdxbdy)
               + blift * (cdxady - adxcdy)
               + clift * (adxbdy - bdxady);

    double permanent =
        (std::fabs(bdxcdy) + std::fabs(cdxbdy)) * alift
      + (std::fabs(cdxady) + std::fabs(adxcdy)) * blift
      + (std::fabs(adxbdy) + std::fabs(bdxady)) * clift;

    double errbound = icErrBoundA * permanent;
    if (det > errbound || -det > errbound) return signOfDouble(det);

    // Exact path. The lifted coordinates alift = adx^2 + ady^2 are themselves
    // exact 4-term expansions; the cross-minors are exact 4-term expansions;
    // we multiply expansion-by-expansion. To keep buffers bounded and code
    // simple we expand alift/blift/clift exactly and use scaleExpansion twice
    // (once per factor of the lift) -- i.e. lift*minor is computed as
    //   ((minor scaled by adx) scaled by adx) + ((minor scaled by ady) scaled by ady)
    // which is exact because each scaleExpansion is exact.
    auto liftTimesMinor = [](double mx, double my,
                             const double* minor, int mn,
                             double* out) -> int {
        // out = (mx*mx + my*my) * minor, exactly.
        double sx[16]; int snx = scaleExpansion(minor, mn, mx, sx);
        double sxx[32]; int snxx = scaleExpansion(sx, snx, mx, sxx);
        double sy[16]; int sny = scaleExpansion(minor, mn, my, sy);
        double syy[32]; int snyy = scaleExpansion(sy, sny, my, syy);
        return fastExpansionSum(sxx, snxx, syy, snyy, out);
    };

    double minBC[8]; int nbc = twoProductDifference(bdx, cdy, cdx, bdy, minBC);
    double minCA[8]; int nca = twoProductDifference(cdx, ady, adx, cdy, minCA);
    double minAB[8]; int nab = twoProductDifference(adx, bdy, bdx, ady, minAB);

    double termA[96]; int na = liftTimesMinor(adx, ady, minBC, nbc, termA);
    double termB[96]; int nb = liftTimesMinor(bdx, bdy, minCA, nca, termB);
    double termC[96]; int nc = liftTimesMinor(cdx, cdy, minAB, nab, termC);

    double sumAB[192]; int nsab = fastExpansionSum(termA, na, termB, nb, sumAB);
    double total[288]; int nt = fastExpansionSum(sumAB, nsab, termC, nc, total);

    return signOfExpansion(total, nt);
}

// ===========================================================================
// 7. insphere
// ===========================================================================

Sign insphere(double ax, double ay, double az,
              double bx, double by, double bz,
              double cx, double cy, double cz,
              double dx, double dy, double dz,
              double ex, double ey, double ez) {
    double aex = ax - ex, aey = ay - ey, aez = az - ez;
    double bex = bx - ex, bey = by - ey, bez = bz - ez;
    double cex = cx - ex, cey = cy - ey, cez = cz - ez;
    double dex = dx - ex, dey = dy - ey, dez = dz - ez;

    // 2x2 minors for the 3x3 sub-determinants.
    double ab = aex * bey - bex * aey;
    double bc = bex * cey - cex * bey;
    double cd = cex * dey - dex * cey;
    double da = dex * aey - aex * dey;
    double ac = aex * cey - cex * aey;
    double bd = bex * dey - dex * bey;

    double abc = aez * bc - bez * ac + cez * ab;
    double bcd = bez * cd - cez * bd + dez * bc;
    double cda = cez * da + dez * ac + aez * cd;
    double dab = dez * ab + aez * bd + bez * da;

    double alift = aex * aex + aey * aey + aez * aez;
    double blift = bex * bex + bey * bey + bez * bez;
    double clift = cex * cex + cey * cey + cez * cez;
    double dlift = dex * dex + dey * dey + dez * dez;

    double det = (dlift * abc - clift * dab) + (blift * cda - alift * bcd);

    double aezplus = std::fabs(aez), bezplus = std::fabs(bez);
    double cezplus = std::fabs(cez), dezplus = std::fabs(dez);
    double aexbeyplus = std::fabs(aex * bey), bexaeyplus = std::fabs(bex * aey);
    double bexceyplus = std::fabs(bex * cey), cexbeyplus = std::fabs(cex * bey);
    double cexdeyplus = std::fabs(cex * dey), dexceyplus = std::fabs(dex * cey);
    double dexaeyplus = std::fabs(dex * aey), aexdeyplus = std::fabs(aex * dey);
    double aexceyplus = std::fabs(aex * cey), cexaeyplus = std::fabs(cex * aey);
    double bexdeyplus = std::fabs(bex * dey), dexbeyplus = std::fabs(dex * bey);

    double permanent =
        ((cexdeyplus + dexceyplus) * bezplus
       + (dexbeyplus + bexdeyplus) * cezplus
       + (bexceyplus + cexbeyplus) * dezplus) * alift
      + ((dexaeyplus + aexdeyplus) * cezplus
       + (aexceyplus + cexaeyplus) * dezplus
       + (cexdeyplus + dexceyplus) * aezplus) * blift
      + ((aexbeyplus + bexaeyplus) * dezplus
       + (bexdeyplus + dexbeyplus) * aezplus
       + (dexaeyplus + aexdeyplus) * bezplus) * clift
      + ((bexceyplus + cexbeyplus) * aezplus
       + (cexaeyplus + aexceyplus) * bezplus
       + (aexbeyplus + bexaeyplus) * cezplus) * dlift;

    double errbound = isErrBoundA * permanent;
    if (det > errbound || -det > errbound) return signOfDouble(det);

    // -----------------------------------------------------------------------
    // Exact path. We rebuild the SAME polynomial that the approximate 'det'
    // above evaluates, but with no rounding error. This is important: the exact
    // path must be the identical algebraic expression as the filtered estimate,
    // so the two can never disagree on which polynomial they represent -- only
    // on rounding, which the exact path eliminates.
    //
    //   det = (dlift*abc - clift*dab) + (blift*cda - alift*bcd)
    //
    // where the six exact 2x2 minors are
    //   ab = aex*bey - bex*aey,  bc = bex*cey - cex*bey,
    //   cd = cex*dey - dex*cey,  da = dex*aey - aex*dey,
    //   ac = aex*cey - cex*aey,  bd = bex*dey - dex*bey,
    // and the four exact 3x3 terms are
    //   abc = aez*bc - bez*ac + cez*ab,
    //   bcd = bez*cd - cez*bd + dez*bc,
    //   cda = cez*da + dez*ac + aez*cd,
    //   dab = dez*ab + aez*bd + bez*da.
    // -----------------------------------------------------------------------

    // exact 2x2 minors as expansions (each up to 4 terms).
    double eAB[8]; int nAB = twoProductDifference(aex, bey, bex, aey, eAB);
    double eBC[8]; int nBC = twoProductDifference(bex, cey, cex, bey, eBC);
    double eCD[8]; int nCD = twoProductDifference(cex, dey, dex, cey, eCD);
    double eDA[8]; int nDA = twoProductDifference(dex, aey, aex, dey, eDA);
    double eAC[8]; int nAC = twoProductDifference(aex, cey, cex, aey, eAC);
    double eBD[8]; int nBD = twoProductDifference(bex, dey, dex, bey, eBD);

    // combine3 : out = s1*x*p1 + s2*x*p2 + s3*x*p3 form is not general enough;
    // we need w1*P1 + w2*P2 + w3*P3 where Pk are expansions and wk are doubles.
    auto scaleAdd3 = [](const double* p1, int n1, double w1,
                        const double* p2, int n2, double w2,
                        const double* p3, int n3, double w3,
                        double* out) -> int {
        double t1[16]; int s1 = scaleExpansion(p1, n1, w1, t1);
        double t2[16]; int s2 = scaleExpansion(p2, n2, w2, t2);
        double t3[16]; int s3 = scaleExpansion(p3, n3, w3, t3);
        double s12[32]; int ns = fastExpansionSum(t1, s1, t2, s2, s12);
        return fastExpansionSum(s12, ns, t3, s3, out);
    };

    double eABC[64]; int nABC = scaleAdd3(eBC,nBC, aez, eAC,nAC, -bez, eAB,nAB, cez, eABC);
    double eBCD[64]; int nBCD = scaleAdd3(eCD,nCD, bez, eBD,nBD, -cez, eBC,nBC, dez, eBCD);
    double eCDA[64]; int nCDA = scaleAdd3(eDA,nDA, cez, eAC,nAC,  dez, eCD,nCD, aez, eCDA);
    double eDAB[64]; int nDAB = scaleAdd3(eAB,nAB, dez, eBD,nBD,  aez, eDA,nDA, bez, eDAB);

    // liftTimesExpansion : multiply expansion by (mx^2+my^2+mz^2) exactly.
    auto liftTimesExpansion = [](double mx,double my,double mz,
                                 const double* in, int n,
                                 double* out) -> int {
        double sx[128];  int snx  = scaleExpansion(in, n, mx, sx);
        double sxx[256]; int snxx = scaleExpansion(sx, snx, mx, sxx);
        double sy[128];  int sny  = scaleExpansion(in, n, my, sy);
        double syy[256]; int snyy = scaleExpansion(sy, sny, my, syy);
        double sz[128];  int snz  = scaleExpansion(in, n, mz, sz);
        double szz[256]; int snzz = scaleExpansion(sz, snz, mz, szz);
        double t[512];   int nt = fastExpansionSum(sxx, snxx, syy, snyy, t);
        return fastExpansionSum(t, nt, szz, snzz, out);
    };

    // dlift*abc, clift*dab, blift*cda, alift*bcd  (each exact).
    double Td[1024]; int nTd = liftTimesExpansion(dex,dey,dez, eABC, nABC, Td);
    double Tc[1024]; int nTc = liftTimesExpansion(cex,cey,cez, eDAB, nDAB, Tc);
    double Tb[1024]; int nTb = liftTimesExpansion(bex,bey,bez, eCDA, nCDA, Tb);
    double Ta[1024]; int nTa = liftTimesExpansion(aex,aey,aez, eBCD, nBCD, Ta);

    // det = (Td - Tc) + (Tb - Ta).
    for (int i = 0; i < nTc; ++i) Tc[i] = -Tc[i];
    for (int i = 0; i < nTa; ++i) Ta[i] = -Ta[i];

    double left[2048];  int nL = fastExpansionSum(Td, nTd, Tc, nTc, left);
    double right[2048]; int nR = fastExpansionSum(Tb, nTb, Ta, nTa, right);
    double total[4096]; int nt = fastExpansionSum(left, nL, right, nR, total);

    return signOfExpansion(total, nt);
}

// ===========================================================================
// 8. Naive (non-robust) references -- used ONLY by the test suite.
// ===========================================================================

Sign orient2dNaive(double ax, double ay,
                   double bx, double by,
                   double cx, double cy) {
    double det = (ax - cx) * (by - cy) - (ay - cy) * (bx - cx);
    return signOfDouble(det);
}

Sign orient3dNaive(double ax, double ay, double az,
                   double bx, double by, double bz,
                   double cx, double cy, double cz,
                   double dx, double dy, double dz) {
    double adx = ax - dx, ady = ay - dy, adz = az - dz;
    double bdx = bx - dx, bdy = by - dy, bdz = bz - dz;
    double cdx = cx - dx, cdy = cy - dy, cdz = cz - dz;
    double det = adz * (bdx * cdy - cdx * bdy)
               + bdz * (cdx * ady - adx * cdy)
               + cdz * (adx * bdy - bdx * ady);
    return signOfDouble(det);
}

Sign incircleNaive(double ax, double ay,
                   double bx, double by,
                   double cx, double cy,
                   double dx, double dy) {
    double adx = ax - dx, ady = ay - dy;
    double bdx = bx - dx, bdy = by - dy;
    double cdx = cx - dx, cdy = cy - dy;
    double alift = adx * adx + ady * ady;
    double blift = bdx * bdx + bdy * bdy;
    double clift = cdx * cdx + cdy * cdy;
    double det = alift * (bdx * cdy - cdx * bdy)
               + blift * (cdx * ady - adx * cdy)
               + clift * (adx * bdy - bdx * ady);
    return signOfDouble(det);
}

Sign insphereNaive(double ax, double ay, double az,
                   double bx, double by, double bz,
                   double cx, double cy, double cz,
                   double dx, double dy, double dz,
                   double ex, double ey, double ez) {
    double aex = ax - ex, aey = ay - ey, aez = az - ez;
    double bex = bx - ex, bey = by - ey, bez = bz - ez;
    double cex = cx - ex, cey = cy - ey, cez = cz - ez;
    double dex = dx - ex, dey = dy - ey, dez = dz - ez;
    double ab = aex * bey - bex * aey;
    double bc = bex * cey - cex * bey;
    double cd = cex * dey - dex * cey;
    double da = dex * aey - aex * dey;
    double ac = aex * cey - cex * aey;
    double bd = bex * dey - dex * bey;
    double abc = aez * bc - bez * ac + cez * ab;
    double bcd = bez * cd - cez * bd + dez * bc;
    double cda = cez * da + dez * ac + aez * cd;
    double dab = dez * ab + aez * bd + bez * da;
    double alift = aex * aex + aey * aey + aez * aez;
    double blift = bex * bex + bey * bey + bez * bez;
    double clift = cex * cex + cey * cey + cez * cez;
    double dlift = dex * dex + dey * dey + dez * dez;
    double det = (dlift * abc - clift * dab) + (blift * cda - alift * bcd);
    return signOfDouble(det);
}

} // namespace native
} // namespace forge
