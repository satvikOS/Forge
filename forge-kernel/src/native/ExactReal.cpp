// forge/native/ExactReal.cpp
//
// Implementation of the lazy-exact EPECK-class number ExactReal and its in-house
// arbitrary-precision big integer (see ExactReal.hpp for the honesty statement +
// the audit citation). Pure C++20, no external dependencies.
//
// CORRECTNESS ARGUMENT (self-contained):
//   * BigInt is sign-magnitude base-2^32. add/sub/mul are the schoolbook
//     algorithms; every limb operation is done in 64-bit so there is no overflow
//     of a single limb-product (2^32-1)^2 + carry < 2^64. These are exact integer
//     identities.
//   * A double d is EXACTLY a dyadic rational: d = m * 2^e with m an integer
//     (|m| < 2^53) and e an integer exponent (std::frexp). fromExactDouble
//     recovers (m, e) bit-exactly, so ExactReal(double) is lossless.
//   * ExactReal keeps value = num/den with den>0. +,-,*,/ are the exact rational
//     formulas; no reduction is performed (gcd would cost more than it saves for
//     the bounded-depth K2 constructions — at most ~6 chained ops). Comparison
//     a/da ? b/db reduces to the integer compare (a*db) ? (b*da) with da,db>0,
//     which is EXACT and never divides. That is the only place a sign is decided.
//   * The double interval [lo,hi] is a cheap filter: after every op it is set to
//     a conservative outward-rounded bracket of num/den, so sign()/cmp() answer
//     from doubles when the interval is clear of 0 and only touch the big-integer
//     path at a genuine near-coincidence. The exactness of the ANSWER never
//     depends on the interval — only the SPEED does.

#include "forge/native/ExactReal.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

namespace forge {
namespace native {

// ═══════════════════════════════════ BigInt ═════════════════════════════════

void BigInt::trim() {
    while (!mag_.empty() && mag_.back() == 0u) mag_.pop_back();
    if (mag_.empty()) neg_ = false;   // canonical zero is +0
}

BigInt::BigInt(long long v) : neg_(v < 0) {
    unsigned long long u = neg_ ? (unsigned long long)(-(v + 1)) + 1ull
                                : (unsigned long long)v;
    while (u) { mag_.push_back((std::uint32_t)(u & 0xFFFFFFFFull)); u >>= 32; }
}

// d = mantissa * 2^shift, mantissa an exact integer. Returns |mantissa| with the
// sign folded in; `shift` receives the power-of-two exponent.
BigInt BigInt::fromExactDouble(double d, int& shift) {
    shift = 0;
    if (d == 0.0 || !std::isfinite(d)) { shift = 0; return BigInt(0LL); }
    bool neg = std::signbit(d);
    double a = std::fabs(d);
    int e;
    double m = std::frexp(a, &e);     // a = m * 2^e, 0.5 <= m < 1
    // scale m up to an exact 53-bit integer.
    double mi = std::ldexp(m, 53);    // exact integer in [2^52, 2^53)
    e -= 53;
    unsigned long long mant = (unsigned long long)mi;
    // drop trailing zero bits so the rational stays as small as possible.
    while (mant && (mant & 1ull) == 0ull) { mant >>= 1; ++e; }
    BigInt r;
    unsigned long long u = mant;
    while (u) { r.mag_.push_back((std::uint32_t)(u & 0xFFFFFFFFull)); u >>= 32; }
    r.neg_ = neg && !r.mag_.empty();
    shift = e;
    return r;
}

BigInt BigInt::operator-() const { BigInt r = *this; if (!r.mag_.empty()) r.neg_ = !r.neg_; return r; }

int BigInt::cmpMag(const std::vector<std::uint32_t>& a, const std::vector<std::uint32_t>& b) {
    if (a.size() != b.size()) return a.size() < b.size() ? -1 : 1;
    for (std::size_t i = a.size(); i-- > 0; )
        if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
}

std::vector<std::uint32_t> BigInt::addMag(const std::vector<std::uint32_t>& a,
                                          const std::vector<std::uint32_t>& b) {
    std::vector<std::uint32_t> r;
    std::size_t n = std::max(a.size(), b.size());
    r.reserve(n + 1);
    unsigned long long carry = 0;
    for (std::size_t i = 0; i < n; ++i) {
        unsigned long long s = carry;
        if (i < a.size()) s += a[i];
        if (i < b.size()) s += b[i];
        r.push_back((std::uint32_t)(s & 0xFFFFFFFFull));
        carry = s >> 32;
    }
    if (carry) r.push_back((std::uint32_t)carry);
    return r;
}

// a - b, requires magnitude(a) >= magnitude(b).
std::vector<std::uint32_t> BigInt::subMag(const std::vector<std::uint32_t>& a,
                                          const std::vector<std::uint32_t>& b) {
    std::vector<std::uint32_t> r;
    r.reserve(a.size());
    long long borrow = 0;
    for (std::size_t i = 0; i < a.size(); ++i) {
        long long s = (long long)a[i] - borrow - (i < b.size() ? (long long)b[i] : 0);
        if (s < 0) { s += (1ll << 32); borrow = 1; } else borrow = 0;
        r.push_back((std::uint32_t)(s & 0xFFFFFFFFll));
    }
    while (!r.empty() && r.back() == 0u) r.pop_back();
    return r;
}

std::vector<std::uint32_t> BigInt::mulMag(const std::vector<std::uint32_t>& a,
                                          const std::vector<std::uint32_t>& b) {
    if (a.empty() || b.empty()) return {};
    std::vector<std::uint64_t> acc(a.size() + b.size(), 0);
    for (std::size_t i = 0; i < a.size(); ++i) {
        unsigned long long carry = 0;
        unsigned long long ai = a[i];
        for (std::size_t j = 0; j < b.size(); ++j) {
            unsigned long long cur = acc[i + j] + ai * (unsigned long long)b[j] + carry;
            acc[i + j] = cur & 0xFFFFFFFFull;
            carry = cur >> 32;
        }
        acc[i + b.size()] += carry;
    }
    std::vector<std::uint32_t> r(acc.size());
    for (std::size_t i = 0; i < acc.size(); ++i) r[i] = (std::uint32_t)acc[i];
    while (!r.empty() && r.back() == 0u) r.pop_back();
    return r;
}

BigInt BigInt::operator+(const BigInt& o) const {
    BigInt r;
    if (neg_ == o.neg_) { r.mag_ = addMag(mag_, o.mag_); r.neg_ = neg_; }
    else {
        int c = cmpMag(mag_, o.mag_);
        if (c == 0) return BigInt(0LL);
        if (c > 0) { r.mag_ = subMag(mag_, o.mag_); r.neg_ = neg_; }
        else       { r.mag_ = subMag(o.mag_, mag_); r.neg_ = o.neg_; }
    }
    r.trim();
    return r;
}

BigInt BigInt::operator-(const BigInt& o) const { return *this + (-o); }

BigInt BigInt::operator*(const BigInt& o) const {
    BigInt r;
    r.mag_ = mulMag(mag_, o.mag_);
    r.neg_ = (neg_ != o.neg_);
    r.trim();
    return r;
}

BigInt BigInt::shl(unsigned k) const {
    if (mag_.empty()) return *this;
    BigInt r;
    unsigned limbShift = k / 32, bitShift = k % 32;
    r.mag_.assign(mag_.size() + limbShift + 1, 0u);
    for (std::size_t i = 0; i < mag_.size(); ++i) {
        unsigned long long v = (unsigned long long)mag_[i] << bitShift;
        r.mag_[i + limbShift]     |= (std::uint32_t)(v & 0xFFFFFFFFull);
        r.mag_[i + limbShift + 1] |= (std::uint32_t)(v >> 32);
    }
    r.neg_ = neg_;
    r.trim();
    return r;
}

int BigInt::cmp(const BigInt& o) const {
    int sa = sign(), sb = o.sign();
    if (sa != sb) return sa < sb ? -1 : 1;
    if (sa == 0) return 0;
    int c = cmpMag(mag_, o.mag_);
    return sa > 0 ? c : -c;   // both negative: larger magnitude is smaller value
}

double BigInt::toDouble() const {
    double r = 0.0;
    for (std::size_t i = mag_.size(); i-- > 0; ) r = r * 4294967296.0 + (double)mag_[i];
    return neg_ ? -r : r;
}

// ═══════════════════════════════════ ExactReal ══════════════════════════════

ExactReal::ExactReal(double d) {
    int shift = 0;
    BigInt m = BigInt::fromExactDouble(d, shift);
    if (shift >= 0) { num_ = m.shl((unsigned)shift); den_ = BigInt(1LL); }
    else            { num_ = m;                       den_ = BigInt(1LL).shl((unsigned)(-shift)); }
    recomputeInterval();
}

// Conservative double interval bracketing num/den. We compute num.toDouble() and
// den.toDouble() (each rounded), then widen by 4 ulps on each side to guarantee
// the true value is inside regardless of the two rounding errors. This is only a
// FILTER — correctness of sign()/cmp() falls through to the exact path when the
// widened interval still straddles 0.
void ExactReal::recomputeInterval() {
    double n = num_.toDouble();
    double d = den_.toDouble();
    if (d == 0.0) { lo_ = -1.0; hi_ = 1.0; return; }     // never happens (den>0)
    double q = n / d;
    if (!std::isfinite(q)) { lo_ = -std::numeric_limits<double>::infinity();
                             hi_ =  std::numeric_limits<double>::infinity(); return; }
    double w = std::fabs(q) * 1e-12 + 1e-300;            // generous outward pad
    lo_ = q - w; hi_ = q + w;
}

ExactReal ExactReal::operator-() const {
    ExactReal r;
    r.num_ = -num_; r.den_ = den_;
    r.lo_ = -hi_; r.hi_ = -lo_;
    return r;
}

ExactReal ExactReal::operator+(const ExactReal& o) const {
    ExactReal r;
    r.num_ = num_ * o.den_ + o.num_ * den_;
    r.den_ = den_ * o.den_;
    r.recomputeInterval();
    return r;
}

ExactReal ExactReal::operator-(const ExactReal& o) const { return *this + (-o); }

ExactReal ExactReal::operator*(const ExactReal& o) const {
    ExactReal r;
    r.num_ = num_ * o.num_;
    r.den_ = den_ * o.den_;
    r.recomputeInterval();
    return r;
}

// (a/b)/(c/d) = (a*d)/(b*c). Keep den positive by folding the sign of (b*c) into
// num: since b>0 always, the sign of the new denominator is the sign of c==o.num.
ExactReal ExactReal::operator/(const ExactReal& o) const {
    ExactReal r;
    BigInt n = num_ * o.den_;
    BigInt d = den_ * o.num_;
    if (d.sign() < 0) { n = -n; d = -d; }   // restore den>0 invariant
    r.num_ = n; r.den_ = d;
    r.recomputeInterval();
    return r;
}

int ExactReal::sign() const {
    // Interval filter: if [lo,hi] is strictly on one side of 0, that is the sign.
    if (lo_ > 0.0) return 1;
    if (hi_ < 0.0) return -1;
    // Exact: den_ > 0 by invariant, so sign(num/den) == sign(num).
    return num_.sign();
}

int ExactReal::cmp(const ExactReal& o) const {
    // Interval filter first.
    if (hi_ < o.lo_) return -1;
    if (lo_ > o.hi_) return 1;
    // Exact: a/b ? c/d  with b,d>0  <=>  a*d ? c*b.
    BigInt l = num_ * o.den_;
    BigInt r = o.num_ * den_;
    return l.cmp(r);
}

double ExactReal::toDouble() const {
    double d = den_.toDouble();
    if (d == 0.0) return 0.0;
    return num_.toDouble() / d;
}

} // namespace native
} // namespace forge
