// forge/native/ExactReal.hpp
//
// K2 / Phase-B1 — EXACT-CONSTRUCTION number type for the Forge native kernel.
//
// The audit (docs/SCOPE_2026-06-24/kernel/predicates-geom.md §2.1, §4 and
// booleans.md §2-B §8) names ONE structural gap as the cause of the mesh
// boolean's residual ~0.12% failure class: Forge had exact PREDICATE SIGNS over
// DOUBLE coordinates, but no exact-CONSTRUCTION number type. Every intersection
// COORDINATE (edge×face, segment×segment) was plain IEEE-754 double, so three
// distinct double edge×plane hits that should be one geometric point land ~1e-5
// apart at a near-triple-point — producing a sliver / count!=2 edge / non-
// manifold output. Simulation-of-Simplicity patches SIGNS, never COORDINATES, so
// it cannot close that class.
//
// `ExactReal` is the in-house EPECK-class (CGAL `Lazy_exact_nt` paradigm) number
// that closes it: an EXACT rational p/q (sign + arbitrary-precision big-integer
// numerator & denominator) carried alongside a fast double INTERVAL [lo,hi] so
// the common case answers a sign query from the interval and only falls to the
// exact rational when the interval straddles 0. Because the rational is exact, a
// constructed intersection point re-intersects EXACTLY (idempotent under re-
// query), so a near-triple-point resolves to ONE point on every surface.
//
// Pure C++20, ZERO external dependencies — an in-house arbitrary-precision
// unsigned big integer (base-2^32 limbs) underneath; NO GMP, no WASM, no OCCT.
// Only +, -, *, / by an integer/exact, comparison and exact sign are needed by
// the K2 constructions, so the surface is deliberately small and self-contained.

#ifndef FORGE_NATIVE_EXACTREAL_HPP
#define FORGE_NATIVE_EXACTREAL_HPP

#include <cstdint>
#include <vector>

namespace forge {
namespace native {

// ── Arbitrary-precision SIGNED integer (sign-magnitude, base 2^32 limbs) ──────
// Minimal but complete for exact rational arithmetic: construct from int64 /
// double-as-exact-integer, add, sub, mul, compare, sign. No division on the
// integer itself (the rational keeps num/den separate and never reduces — a
// common-denominator comparison cross-multiplies, which needs only mul/sub/sign).
class BigInt {
public:
    BigInt() : neg_(false) {}
    BigInt(long long v);                       // exact
    static BigInt fromExactDouble(double d, int& shift);  // d = mantissa * 2^shift

    bool   isZero() const { return mag_.empty(); }
    int    sign()   const { return mag_.empty() ? 0 : (neg_ ? -1 : 1); }

    BigInt operator-() const;
    BigInt operator+(const BigInt& o) const;
    BigInt operator-(const BigInt& o) const;
    BigInt operator*(const BigInt& o) const;

    // shift left by k bits (multiply by 2^k) — exact.
    BigInt shl(unsigned k) const;

    // three-way compare: -1 if *this<o, 0 if ==, +1 if >.
    int cmp(const BigInt& o) const;

    // Convert to double (round-to-nearest, best effort; used only for the
    // interval reconstruction, never for a sign decision).
    double toDouble() const;

private:
    std::vector<std::uint32_t> mag_;  // little-endian limbs, no leading zeros
    bool neg_;
    static int  cmpMag(const std::vector<std::uint32_t>& a,
                       const std::vector<std::uint32_t>& b);
    static std::vector<std::uint32_t> addMag(const std::vector<std::uint32_t>& a,
                                             const std::vector<std::uint32_t>& b);
    static std::vector<std::uint32_t> subMag(const std::vector<std::uint32_t>& a,
                                             const std::vector<std::uint32_t>& b);  // a>=b
    static std::vector<std::uint32_t> mulMag(const std::vector<std::uint32_t>& a,
                                             const std::vector<std::uint32_t>& b);
    void trim();
};

// ── Lazy-exact REAL: an exact rational num/den + a double interval filter ─────
// Invariant: den_.sign() > 0 always (the sign lives entirely in num_). The
// interval [lo_,hi_] always brackets the true value num_/den_ (it is recomputed
// conservatively after every op). sign() answers from the interval when it does
// not straddle 0, else from the EXACT cross-multiplied big-integer comparison.
class ExactReal {
public:
    ExactReal() : num_(0LL), den_(1LL), lo_(0.0), hi_(0.0) {}
    ExactReal(double d);                       // exact (double is a dyadic rational)
    ExactReal(long long v) : num_(v), den_(1LL), lo_(double(v)), hi_(double(v)) {}

    ExactReal operator+(const ExactReal& o) const;
    ExactReal operator-(const ExactReal& o) const;
    ExactReal operator*(const ExactReal& o) const;
    ExactReal operator/(const ExactReal& o) const;   // o must be nonzero
    ExactReal operator-() const;

    // EXACT sign of (*this): -1 / 0 / +1. Interval-filtered, exact fallback.
    int sign() const;
    // EXACT three-way compare to o.
    int cmp(const ExactReal& o) const;
    bool operator==(const ExactReal& o) const { return cmp(o) == 0; }
    bool operator< (const ExactReal& o) const { return cmp(o) <  0; }

    // Best-effort double value of the exact rational (midpoint of the tight
    // interval). Used to MATERIALISE a constructed point's coordinates for the
    // half-edge mesh — the exactness lives in the canonical-id registry, the
    // emitted coordinate is the faithfully-rounded rational.
    double toDouble() const;

    const BigInt& num() const { return num_; }
    const BigInt& den() const { return den_; }

    // Conservative double bracket of the exact value: lo() <= num/den <= hi()
    // always (the same invariant sign()/cmp() already rely on). Exposed so
    // predicate-level interval FILTERS (ExactPredicates3D.cpp) can prove a sign
    // from double arithmetic before touching the big-integer path. A filter may
    // never decide from a bracket that straddles 0 — it must fall through to
    // the exact evaluation, so exactness never depends on these.
    double lo() const { return lo_; }
    double hi() const { return hi_; }

private:
    BigInt num_, den_;     // value = num_/den_, den_ > 0
    double lo_, hi_;       // interval bracketing num_/den_
    void recomputeInterval();
};

} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_EXACTREAL_HPP
