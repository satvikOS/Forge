// forge/native/Predicates.hpp
//
// Robust, adaptive-precision geometric predicates for the in-house Forge kernel.
//
// These are the bedrock orientation / in-circle / in-sphere tests that every
// robust mesh / boolean / Delaunay routine depends on. They return the *sign*
// of an algebraic determinant exactly, so that the combinatorial structure of
// downstream geometry code can never be corrupted by floating-point rounding.
//
// DESIGN / PROVENANCE
// -------------------
// Re-derived from first principles. The machinery here is classical
// floating-point error-free-transformation (EFT) arithmetic:
//
//   * Knuth/Dekker TwoSum and Dekker/FMA TwoProduct produce, for any two IEEE
//     doubles, an EXACT representation (hi + lo) of their sum / product as an
//     unevaluated pair. These are mathematical identities for round-to-nearest
//     binary64, not heuristics.
//
//   * Non-overlapping "expansions" (sorted arrays of doubles whose exact sum is
//     the represented value) are combined with grow / scale / fast-expansion-sum
//     so that the determinant is accumulated with NO rounding error at all.
//
//   * An adaptive filter first evaluates the determinant in plain double with a
//     forward error bound (computed from machine epsilon). If the approximate
//     value is provably larger in magnitude than its own error bound, its sign
//     is returned immediately. Only otherwise do we fall back to the exact
//     expansion path. This keeps the common case as fast as a naive evaluation
//     while guaranteeing a correct sign in every case.
//
// We use Shewchuk's PUBLISHED reference sign values ONLY as an independent
// oracle in the test suite. No third-party source is copied here.
//
// GUARANTEE (read honestly):
//   For inputs whose coordinates are exact IEEE-754 binary64 values and whose
//   intermediate expansion terms neither overflow to +/-inf nor underflow into
//   the denormal range, the returned sign is the EXACT mathematical sign of the
//   determinant ( -1 / 0 / +1 ). This is "proven-exact" within that domain.
//   It is NOT a claim of exactness for coordinates that themselves came from a
//   lossy conversion, nor under overflow/underflow of the expansion. See
//   Predicates.cpp for the error-bound derivation.
//
// KNOWN LIMIT (honest):
//   If a coordinate or intermediate term is SUBNORMAL (|x| < DBL_MIN ~ 2.2e-308),
//   the error-free-transformation identities can themselves underflow (the
//   product error term rounds to +-0), so the exact path may collapse a tiny
//   true determinant to ZERO. The validation suite exercises this boundary and
//   reports it explicitly. TODO: add a denormal-safe scaling pre-pass (scale all
//   inputs by a common power of two into the normal range, sign-invariant) to
//   extend the proven-exact domain down to subnormal coordinates.
//
// No external dependencies. No WASM. Pure C++20.

#ifndef FORGE_NATIVE_PREDICATES_HPP
#define FORGE_NATIVE_PREDICATES_HPP

namespace forge {
namespace native {

// Sign result: the exact sign of the underlying determinant.
//   POSITIVE  (+1)
//   ZERO      ( 0)
//   NEGATIVE  (-1)
enum class Sign : int {
    NEGATIVE = -1,
    ZERO     = 0,
    POSITIVE = 1
};

inline int signValue(Sign s) { return static_cast<int>(s); }

// orient2d:
//   Sign of the determinant | ax-cx  ay-cy |
//                           | bx-cx  by-cy |
//   POSITIVE  -> (a,b,c) are in counter-clockwise order
//   NEGATIVE  -> clockwise
//   ZERO      -> collinear
Sign orient2d(double ax, double ay,
              double bx, double by,
              double cx, double cy);

// orient3d:
//   Sign of the determinant of (a-d, b-d, c-d).
//   POSITIVE  -> d lies BELOW the plane of (a,b,c) (a,b,c seen CCW from above d)
//   NEGATIVE  -> d lies ABOVE that plane
//   ZERO      -> the four points are coplanar
Sign orient3d(double ax, double ay, double az,
              double bx, double by, double bz,
              double cx, double cy, double cz,
              double dx, double dy, double dz);

// incircle:
//   For a,b,c given in COUNTER-CLOCKWISE order, sign of the 4x4 determinant
//   testing whether d lies inside their circumcircle.
//   POSITIVE  -> d is strictly INSIDE the circle through (a,b,c)
//   NEGATIVE  -> d is strictly OUTSIDE
//   ZERO      -> d is exactly ON the circle (cocircular)
//   (If a,b,c are clockwise the inside/outside sense is reversed.)
Sign incircle(double ax, double ay,
              double bx, double by,
              double cx, double cy,
              double dx, double dy);

// insphere:
//   For a,b,c,d given in POSITIVE (orient3d > 0) order, sign of the 5x5
//   determinant testing whether e lies inside their circumsphere.
//   POSITIVE  -> e is strictly INSIDE the sphere through (a,b,c,d)
//   NEGATIVE  -> e is strictly OUTSIDE
//   ZERO      -> e is exactly ON the sphere (cospherical)
//   (If (a,b,c,d) have negative orientation the inside/outside sense is reversed.)
Sign insphere(double ax, double ay, double az,
              double bx, double by, double bz,
              double cx, double cy, double cz,
              double dx, double dy, double dz,
              double ex, double ey, double ez);

// ---------------------------------------------------------------------------
// Naive (non-robust) reference implementations.
//
// These evaluate the SAME determinants directly in double precision with no
// error compensation. They exist ONLY so the test suite can demonstrate the
// near-degenerate cases where naive evaluation returns the WRONG sign while the
// robust predicates above return the correct one. Do not use in production.
// ---------------------------------------------------------------------------
Sign orient2dNaive(double ax, double ay,
                   double bx, double by,
                   double cx, double cy);

Sign orient3dNaive(double ax, double ay, double az,
                   double bx, double by, double bz,
                   double cx, double cy, double cz,
                   double dx, double dy, double dz);

Sign incircleNaive(double ax, double ay,
                   double bx, double by,
                   double cx, double cy,
                   double dx, double dy);

Sign insphereNaive(double ax, double ay, double az,
                   double bx, double by, double bz,
                   double cx, double cy, double cz,
                   double dx, double dy, double dz,
                   double ex, double ey, double ez);

} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_PREDICATES_HPP
