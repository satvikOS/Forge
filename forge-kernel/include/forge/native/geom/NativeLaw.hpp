// forge/native/geom/NativeLaw.hpp
//
// Native, OCCT-free 1-D parametric evolution laws — drop-in replacements for
// OCCT's Law_Linear and Law_S (Law_Function subclasses). These are the two
// laws the variable-radius fillet needs (see src/VarFillet.cpp), and they are
// the last two Law_* blockers standing between us and dropping TKGeomAlgo
// (otool 9 -> 8).
//
// Pure C++20, standard library only — ZERO OCCT (no Law_*, no gp_, no Handle).
// It is 1-D scalar math, so it does NOT sit on the OCCT geometry boundary and
// therefore is NOT wrapped in #ifdef FORGE_NATIVE_BREP (mirrors the other pure
// std sibling in this directory, LineGeometry.hpp). The fillet call site that
// consumes it may be OCCT-bounded; the law itself is not.
//
// EXACT semantics we reproduce (verified against the OCCT headers):
//   * Law_Linear::Set(Pdeb, Valdeb, Pfin, Valfin) — straight linear
//       interpolation f(t) = v1 + (v2-v1)*(t-t1)/(t2-t1).
//   * Law_S::Set(Pdeb, Valdeb, Pfin, Valfin) — the S-shaped law that "gives the
//       same bound values but with the first derivative equal to 0 at BOTH
//       Pdeb and Pfin" (Law_S.hxx). The unique cubic through two points with
//       zero end slopes is the classic cubic Hermite smoothstep
//       h(s) = 3s^2 - 2s^3, f(t) = v1 + (v2-v1)*h(s), s = (t-t1)/(t2-t1).
//       This matches OCCT's Law_S at the endpoints (values + zero slope) and at
//       the midpoint ((v1+v2)/2), and is C^1 across [t1,t2].
//
// Interface parity with Law_Function (only what our call sites use):
//   Value(t)              — Law_Function::Value(X)
//   D1(t, f&, d&)         — Law_Function::D1(X, F&, D&)
//   Bounds(first&, last&) — Law_Function::Bounds(PFirst&, PLast&)
// (D2/Trim/Continuity/NbIntervals are unused by forge::varfillet, so omitted.)

#pragma once

namespace forge::occtlaw {

// Which 1-D law a Law instance evaluates.
enum class LawKind {
  Linear,  // f(t) = v1 + (v2-v1)*(t-t1)/(t2-t1)          (replaces Law_Linear)
  S        // cubic smoothstep, zero slope at both ends   (replaces Law_S)
};

// A tiny value-type law: copyable, no heap, no Handle/RefCount. Mirrors the
// OCCT idiom of a default-constructed law followed by Set(Pdeb,Valdeb,Pfin,
// Valfin), but is also constructible in one shot via the Linear()/S() factories.
//
// If a native fillet wants a bare callable instead of this struct, prefer
// binding this via a lambda `[law](double t){ return law.Value(t); }` — the
// struct carries the (t1,v1,t2,v2) state a plain double(*)(double) cannot.
struct Law {
  LawKind kind = LawKind::Linear;
  double  t1   = 0.0;  // Pdeb   — start parameter
  double  v1   = 0.0;  // Valdeb — value at t1
  double  t2   = 1.0;  // Pfin   — end parameter
  double  v2   = 0.0;  // Valfin — value at t2

  // One-shot factories (equivalent to default-ctor + Set(...)).
  static Law Linear(double t1, double v1, double t2, double v2);
  static Law S(double t1, double v1, double t2, double v2);

  // OCCT-style mutating setters: Law l; l.SetLinear(0,r0,1,r1);
  void SetLinear(double t1_, double v1_, double t2_, double v2_);
  void SetS(double t1_, double v1_, double t2_, double v2_);

  // Law_Function::Value — evaluate f(t).
  double Value(double t) const;

  // Law_Function::D1 — f = f(t), d = f'(t). For the S law the slope is 0 at both
  // ends (and clamped-flat outside [t1,t2]).
  void D1(double t, double& f, double& d) const;

  // Law_Function::Bounds — the parameter interval [t1, t2] (Pdeb, Pfin), as set.
  void Bounds(double& first, double& last) const;
};

}  // namespace forge::occtlaw
