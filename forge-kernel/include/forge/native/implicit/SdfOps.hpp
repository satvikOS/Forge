// forge/native/implicit/SdfOps.hpp
//
// In-house scalar SDF FIELD OPERATORS — Stage 4 of KERNEL_INHOUSE_ROADMAP.md,
// libfive / PicoGK-class. Where SdfTree.hpp gives the primitives + CSG and
// SdfLibrary.hpp gives the expanded primitive catalogue, this module gives the
// FIELD-LEVEL editing operators an implicit-modeling kernel is expected to ship:
// they take an existing Sdf (the "evaluable") and return a NEW Sdf.
//
// Two kinds of operator, kept honestly distinct:
//
//   VALUE TRANSFORMS — re-map the scalar f(p) returned by the source field.
//   These preserve the gradient DIRECTION, so if the source is a 1-Lipschitz
//   distance field the result is too (|grad| unchanged):
//     offset(d)  : f' = f - d        grow (d>0) / shrink (d<0) the solid by d.
//     round (r)  : f' = f - r        identical formula to offset for r>=0; named
//                                    separately because the modeling INTENT is
//                                    "round sharp convex edges by radius r" (the
//                                    Minkowski sum with a sphere of radius r,
//                                    which on a distance field is exactly f - r).
//     shell (t)  : f' = |f| - t/2    hollow: the solid becomes the thin wall of
//                                    thickness t straddling the original surface.
//
//   DOMAIN WARPS — re-map the QUERY POINT p before evaluating the source field.
//   A warp p -> w(p) gives f'(p) = f(w(p)). The result's gradient is
//   J(w)^T * grad f, so a NON-isometric warp (twist/bend/elongate) changes
//   |grad| and the field is no longer an exact distance field — it stays a
//   correct-sign BOUND. We say so honestly (the libfive/PicoGK convention).
//     elongate(h): stretch the solid by 2*h.x / 2*h.y / 2*h.z along each axis by
//                  splitting space along a slab of half-widths h (Quilez
//                  opElongate). For an EXACT source this elongation is EXACT
//                  (|grad| stays == 1) because it is a piecewise translation.
//     twist(k)   : rotate the xy-plane by angle k*z about +z (a helical shear).
//                  NON-isometric -> |grad| != 1, correct sign (a BOUND).
//     bend (k)   : bend the x-axis into an arc of curvature k about +z (Quilez
//                  opCheapBend). NON-isometric -> |grad| != 1, correct sign.
//
//   BLENDS — combine two fields with a smooth (C1) seam (polynomial smin/smax,
//   Quilez). The zero set is the rounded union / subtraction; the field is
//   intentionally NOT an exact distance (it is rounded near the seam) but it is
//   1-LIPSCHITZ when both inputs are (|grad| <= 1), which we VALIDATE:
//     smoothUnion(a,b,k) : rounded OR  — volume strictly between the hard union
//                          and the sum of the two solids (the bridge adds mass).
//     smoothSub  (a,b,k) : rounded a AND NOT b — smooth-subtract b from a.
//
// EXACTNESS / HONESTY (Bible §0/§9, roadmap Stage 4)
// --------------------------------------------------
//   * offset / round / shell preserve the source field's gradient magnitude
//     EXACTLY (a pure value re-map), so on an EXACT distance source they are
//     themselves exact distance fields. shell uses |f| which is non-smooth on
//     the original surface (the medial of the wall) — the usual shell behaviour.
//   * elongate is EXACT on an exact source (piecewise translation, |grad|==1).
//   * twist / bend are deliberately non-distance domain warps: correct sign and
//     zero set, |grad| varies. We do NOT claim |grad|==1 for them.
//   * smoothUnion / smoothSub are 1-Lipschitz blends (|grad|<=1 when inputs are),
//     NOT exact distance; the test SAMPLES |grad|<=1+eps to prove the Lipschitz
//     bound and the volume bracket (hard-union <= smooth <= sum).
//   * 0 FAKES: every builder returns ok=false (an invalid Sdf) on degenerate /
//     unsupported input — empty source handle, non-positive shell thickness,
//     negative round radius, non-positive blend radius, etc. No fabricated field.
//
// Pure C++20. No external dependencies. No OCCT, no WASM. Reuses ONLY
// implicit/SdfTree.hpp (and, via the .cpp, implicit/IsoMesher.hpp +
// mesh/HalfEdgeMesh.hpp for the volume / closed-surface validation helpers).

#ifndef FORGE_NATIVE_IMPLICIT_SDFOPS_HPP
#define FORGE_NATIVE_IMPLICIT_SDFOPS_HPP

#include <string>

#include "forge/native/implicit/SdfTree.hpp"

namespace forge {
namespace native {
namespace implicit {

// ---------------------------------------------------------------------------
// OpResult — an Sdf plus an explicit ok / reason, mirroring SdfLibrary's
// SdfResult so a degenerate / unsupported operand is an honest failure rather
// than a thrown exception or a silently-wrong field. (We define our own type to
// keep this module's only header dependency SdfTree.hpp.)
// `ok == false` => `sdf` is an invalid (empty) handle and `reason` says why.
// ---------------------------------------------------------------------------
struct OpResult {
    bool        ok = false;
    Sdf         sdf;          // valid() == ok
    std::string reason;       // human-readable failure cause (empty on success)

    OpResult() = default;
    static OpResult success(Sdf s) {
        OpResult r; r.ok = true; r.sdf = std::move(s); return r;
    }
    static OpResult failure(std::string why) {
        OpResult r; r.ok = false; r.reason = std::move(why); return r;
    }
};

// ---------------------------------------------------------------------------
// SdfOps — the field-operator catalogue. All static; pure functions of an
// existing Sdf (the evaluable) + parameters. Each returns an OpResult
// (ok=false on degenerate / unsupported input).
// ---------------------------------------------------------------------------
class SdfOps {
public:
    // ---- value transforms --------------------------------------------------

    // Offset: f'(p) = f(p) - d. d>0 GROWS the solid by d (the {f<=d} level set),
    // d<0 SHRINKS it. Preserves |grad| exactly. d may be any finite value.
    // Degenerate: empty source, or non-finite d -> ok=false.
    static OpResult offset(const Sdf& f, double d);

    // Round convex edges by radius r: f'(p) = f(p) - r, r >= 0. On a distance
    // field this is exactly the Minkowski sum with a sphere of radius r, which
    // rounds every convex edge/corner to fillet radius r (and grows the solid).
    // Identical arithmetic to offset(+r); distinct name for the modeling intent.
    // Degenerate: empty source, or r < 0 (negative round radius) -> ok=false.
    static OpResult round(const Sdf& f, double r);

    // Shell / hollow with WALL THICKNESS t (t>0): f'(p) = |f(p)| - t/2. The new
    // solid is the thin wall of total thickness t centered on the original
    // surface {f=0} (t/2 inward, t/2 outward). Hollows a solid into a shell.
    // Degenerate: empty source, or t <= 0 -> ok=false.
    static OpResult shell(const Sdf& f, double t);

    // ---- domain warps ------------------------------------------------------

    // Elongate (stretch) by half-widths h = (hx,hy,hz), each >= 0. Splits space
    // along an axis-aligned slab of half-widths h and translates the two halves
    // apart, stretching the solid by 2*h along each axis (Quilez opElongate).
    // EXACT on an exact source (piecewise translation, |grad| preserved).
    // Degenerate: empty source, any h component < 0, or all zero (no-op asked
    // for as a "stretch" is allowed only if at least one component > 0) ->
    // ok=false on negative; all-zero is allowed (identity) but flagged success.
    static OpResult elongate(const Sdf& f, const Vec3& h);

    // Twist about +z by rate k (radians per unit z): rotate (x,y) by angle k*z
    // before evaluating. A helical shear (Quilez opTwist). NON-isometric ->
    // the result is a correct-sign BOUND, not an exact distance.
    // Degenerate: empty source -> ok=false. (k==0 is the identity, allowed.)
    static OpResult twist(const Sdf& f, double k);

    // Bend the +x axis into an arc of curvature k (1/radius) about +z (Quilez
    // opCheapBend): rotate (x,y) by angle k*x before evaluating. NON-isometric
    // -> correct-sign BOUND, not exact distance.
    // Degenerate: empty source -> ok=false. (k==0 is the identity, allowed.)
    static OpResult bend(const Sdf& f, double k);

    // ---- smooth blends -----------------------------------------------------

    // Smooth union ("blend") of a and b with blend radius k>0 (polynomial smin,
    // Quilez). Rounded OR; the seam is filleted over a band of width ~k and the
    // blend ADDS a little mass, so the result's volume is strictly between the
    // hard union and the sum of the two solids. 1-Lipschitz when a,b are.
    // Degenerate: empty operand, or k <= 0 -> ok=false. (k->0 is the hard union;
    // for k==0 callers should use the hard unionOp, so we require k>0 here.)
    static OpResult smoothUnion(const Sdf& a, const Sdf& b, double k);

    // Smooth subtraction (a AND NOT b) with blend radius k>0 (polynomial smax on
    // a and -b). Rounded difference; the carved seam is filleted over width ~k.
    // 1-Lipschitz when a,b are.
    // Degenerate: empty operand, or k <= 0 -> ok=false.
    static OpResult smoothSub(const Sdf& a, const Sdf& b, double k);
};

} // namespace implicit
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_IMPLICIT_SDFOPS_HPP
