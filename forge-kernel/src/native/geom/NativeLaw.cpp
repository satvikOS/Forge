// forge/native/geom/NativeLaw.cpp
//
// Implementation of the native 1-D evolution laws declared in
// forge/native/geom/NativeLaw.hpp. Pure C++20, standard library only — zero
// OCCT (no Law_*, no gp_). Drop-in replacement for Law_Linear + Law_S, the two
// remaining Law_* blockers for dropping TKGeomAlgo.
//
// Correctness of the two closed forms (reasoned, no build):
//
//   LINEAR  f(t) = v1 + (v2-v1) * (t-t1)/(t2-t1)
//     - endpoints: f(t1)=v1, f(t2)=v2 (exact).
//     - midpoint : f((t1+t2)/2) = v1 + (v2-v1)*0.5 = (v1+v2)/2.  ✓
//     - slope    : f'(t) = (v2-v1)/(t2-t1) (constant).
//
//   S (cubic smoothstep on the normalized parameter s = (t-t1)/(t2-t1)):
//     h(s)  = 3s^2 - 2s^3          (= s*s*(3 - 2s))
//     f(t)  = v1 + (v2-v1)*h(s)
//     h'(s) = 6s - 6s^2 = 6 s (1-s)
//     - endpoints: h(0)=0 -> f=v1 ;  h(1)=1 -> f=v2 (exact bound values).
//     - end slope: h'(0)=0 and h'(1)=0 -> f'(t1)=f'(t2)=0  (the S property). ✓
//     - midpoint : s=0.5 -> h = 0.25*(3-1) = 0.5 -> f = (v1+v2)/2. ✓
//     - C^1 across (t1,t2); outside [t1,t2] we clamp s to [0,1] so the law holds
//       flat at the bound value (slope 0) rather than extrapolating an S past
//       its shoulders. The fillet samples strictly within [0,1], so this only
//       hardens robustness and never changes the sampled anchors.

#include "forge/native/geom/NativeLaw.hpp"

#include <algorithm>  // std::clamp
#include <cmath>      // std::fabs

namespace forge::occtlaw {

namespace {

// Degenerate-interval guard: if t2 == t1 the law collapses to a constant v1.
constexpr double kDegenerate = 0.0;  // exact-equality check; see spanIsDegenerate
inline bool spanIsDegenerate(double t1, double t2) {
  return std::fabs(t2 - t1) <= kDegenerate;  // i.e. t1 == t2 exactly
}

}  // namespace

Law Law::Linear(double t1, double v1, double t2, double v2) {
  Law l;
  l.SetLinear(t1, v1, t2, v2);
  return l;
}

Law Law::S(double t1, double v1, double t2, double v2) {
  Law l;
  l.SetS(t1, v1, t2, v2);
  return l;
}

void Law::SetLinear(double t1_, double v1_, double t2_, double v2_) {
  kind = LawKind::Linear;
  t1 = t1_; v1 = v1_; t2 = t2_; v2 = v2_;
}

void Law::SetS(double t1_, double v1_, double t2_, double v2_) {
  kind = LawKind::S;
  t1 = t1_; v1 = v1_; t2 = t2_; v2 = v2_;
}

double Law::Value(double t) const {
  if (spanIsDegenerate(t1, t2)) return v1;

  if (kind == LawKind::Linear) {
    // Straight line; extrapolates outside [t1,t2] exactly like Law_Linear.
    return v1 + (v2 - v1) * (t - t1) / (t2 - t1);
  }

  // S: cubic smoothstep on s in [0,1], clamped-flat outside the interval.
  const double s = std::clamp((t - t1) / (t2 - t1), 0.0, 1.0);
  const double h = s * s * (3.0 - 2.0 * s);  // 3s^2 - 2s^3
  return v1 + (v2 - v1) * h;
}

void Law::D1(double t, double& f, double& d) const {
  if (spanIsDegenerate(t1, t2)) {
    f = v1;
    d = 0.0;
    return;
  }

  const double span = t2 - t1;

  if (kind == LawKind::Linear) {
    f = v1 + (v2 - v1) * (t - t1) / span;
    d = (v2 - v1) / span;
    return;
  }

  // S: value from the clamped smoothstep; derivative uses the RAW s so that the
  // slope is exactly 0 at (and beyond) both shoulders.
  const double sRaw = (t - t1) / span;
  const double s = std::clamp(sRaw, 0.0, 1.0);
  const double h = s * s * (3.0 - 2.0 * s);
  f = v1 + (v2 - v1) * h;

  if (sRaw <= 0.0 || sRaw >= 1.0) {
    d = 0.0;  // zero end slope (the defining S property) + flat outside range
  } else {
    const double hp = 6.0 * s * (1.0 - s);  // 6s - 6s^2
    d = (v2 - v1) * hp / span;
  }
}

void Law::Bounds(double& first, double& last) const {
  // OCCT returns (Pdeb, Pfin) as set — preserve caller order (t1, t2).
  first = t1;
  last = t2;
}

}  // namespace forge::occtlaw
