// forge/native/implicit/SdfLibrary.hpp
//
// In-house EXPANDED analytic SDF primitive library + TPMS implicit fields —
// Stage 4 of KERNEL_INHOUSE_ROADMAP.md, libfive / PicoGK-class.
//
// This module ADDS to the small SdfTree.hpp core (sphere/box/plane + CSG) a
// catalogue of the analytic primitives an implicit-modeling kernel is expected
// to ship, plus the triply-periodic minimal-surface (TPMS) lattice fields used
// for additive-manufacturing infill (gyroid / Schwarz-P / Schwarz-D / Neovius).
//
// Everything composes with the existing Sdf value-handle (SdfTree.hpp) and can
// be meshed by implicit/IsoMesher.hpp without change.
//
// PRIMITIVES (each documents the closed form it realises)
// -------------------------------------------------------
//   torus(center, R, r)       — EXACT signed distance to a torus of major
//                               radius R (ring center -> tube center) and minor
//                               radius r (tube), axis = +z.
//   cone(apex, angle, h)      — bounded right circular cone, apex at `apex`,
//                               opening half-angle `angle` (radians), height h
//                               down the -z axis. Standard SDF cone (a bound
//                               that is exact on the lateral/base faces).
//   capsule(a, b, r)          — EXACT signed distance to a capsule (swept sphere)
//                               = segment(a,b) distance - r.
//   roundedBox(center, half,r)— EXACT-exterior rounded box: box(half) inflated
//                               by radius r (Minkowski sphere). Interior is the
//                               usual conservative bound (see SdfTree honesty).
//   hexPrism(center, h, r)    — regular hexagonal prism, axis +z, half-height h,
//                               circumradius-style half-width r across the flats.
//                               Standard SDF hex prism (exact exterior).
//
// TPMS FIELDS (implicit, NOT exact distance fields)
// -------------------------------------------------
//   gyroid / schwarzP / schwarzD / neovius, each as
//       f(p) = |trigField(p)| - t
//   with `period` the spatial period (the cell repeats every `period`) and
//   thickness `t > 0`. The {f <= 0} solid is a thin double-shell straddling the
//   minimal surface trigField = 0. These fields are TRIPLY PERIODIC by
//   construction: f(p + period*e_i) == f(p). They are deliberately NOT signed
//   distance fields — the trig field's gradient magnitude varies with position —
//   so they carry the correct ZERO SET / sign but |grad| != 1. We say so
//   honestly and the validation gate checks periodicity + a closed meshed shell
//   inside one cell, NOT a unit gradient.
//
// HONESTY (Bible §0/§9, roadmap Stage 4)
// --------------------------------------
//   * torus / capsule are EXACT Euclidean distance fields (|grad| == 1 to
//     floating tolerance everywhere outside).
//   * cone / hexPrism / roundedBox use the standard Quilez SDF forms: EXACT on
//     the flat/lateral faces and a Lipschitz-1 BOUND near edges/corners (the
//     usual SDF-modeling convention). |grad| <= 1, sign correct.
//   * TPMS fields are periodic scalar fields, |grad| != 1 by design.
//   * 0 FAKES: every builder returns ok=false (an empty/invalid Sdf via the
//     SdfResult below) on degenerate input (non-positive radius/height/period,
//     coincident capsule endpoints, thickness >= the field's amplitude so the
//     shell would fill the whole cell, etc.). No fabricated geometry.
//
// Pure C++20. No external dependencies. No OCCT, no WASM. Reuses ONLY
// implicit/SdfTree.hpp (and, via the .cpp, implicit/IsoMesher.hpp for the
// volume/periodicity helpers used in validation).

#ifndef FORGE_NATIVE_IMPLICIT_SDFLIBRARY_HPP
#define FORGE_NATIVE_IMPLICIT_SDFLIBRARY_HPP

#include <string>

#include "forge/native/implicit/SdfTree.hpp"

namespace forge {
namespace native {
namespace implicit {

// ---------------------------------------------------------------------------
// SdfResult — an Sdf plus an explicit ok / reason, so degenerate input is an
// honest failure rather than a thrown exception or a silently-wrong field.
// `ok == false` => `sdf` is an invalid (empty) handle and `reason` explains why.
// ---------------------------------------------------------------------------
struct SdfResult {
    bool        ok = false;
    Sdf         sdf;          // valid() == ok
    std::string reason;       // human-readable failure cause (empty on success)

    SdfResult() = default;
    static SdfResult success(Sdf s) {
        SdfResult r; r.ok = true; r.sdf = std::move(s); return r;
    }
    static SdfResult failure(std::string why) {
        SdfResult r; r.ok = false; r.reason = std::move(why); return r;
    }
};

// ---------------------------------------------------------------------------
// SdfLibrary — the expanded primitive catalogue. All static; pure functions
// of their parameters. Each returns an SdfResult (ok=false on degenerate input).
// ---------------------------------------------------------------------------
class SdfLibrary {
public:
    // ---- analytic primitives ----------------------------------------------

    // Torus: major radius R (ring radius, center->tube center), minor radius r
    // (tube radius). Axis = +z through `center`. EXACT signed distance:
    //   q = ( length(p.xy) - R , p.z )
    //   f = length(q) - r
    // Degenerate: R <= 0, r <= 0, or r > R (self-intersecting tube) -> ok=false.
    static SdfResult torus(const Vec3& center, double R, double r);

    // Bounded right circular cone. Apex at `apex`, opening half-angle `angle`
    // (radians, 0 < angle < pi/2), height `h` measured down the -z axis from the
    // apex (the base circle is at z = apex.z - h). Standard SDF cone (Quilez):
    // exact on the lateral surface and the flat base, Lipschitz-1 near the rim.
    // Degenerate: h <= 0 or angle outside (0, pi/2) -> ok=false.
    static SdfResult cone(const Vec3& apex, double angle, double h);

    // Capsule (swept sphere): the set of points within distance r of the segment
    // [a,b]. EXACT signed distance = dist(p, segment(a,b)) - r.
    // Degenerate: r <= 0, or a == b (the capsule degenerates to a sphere — we
    // still accept it but require r > 0; coincident endpoints with r>0 is a
    // valid sphere, so that is allowed). Only r <= 0 fails.
    static SdfResult capsule(const Vec3& a, const Vec3& b, double r);

    // Rounded box: axis-aligned box of half-extents `half` centered at `center`,
    // its surface offset OUTWARD by radius r (rounded edges/corners). EXACT
    // exterior distance; interior is the conservative box bound minus r.
    // Degenerate: any half-extent < 0, or r < 0 -> ok=false. (r == 0 reduces to
    // the sharp box and is allowed; all-zero half with r>0 reduces to a sphere.)
    static SdfResult roundedBox(const Vec3& center, const Vec3& half, double r);

    // Regular hexagonal prism, axis +z through `center`. `h` is the half-height
    // along z; `r` is the half-distance across the flats (apothem). Standard SDF
    // hex prism (Quilez): exact on the six side faces and the two caps.
    // Degenerate: h <= 0 or r <= 0 -> ok=false.
    static SdfResult hexPrism(const Vec3& center, double h, double r);

    // ---- TPMS lattice fields ----------------------------------------------
    // Each builds f(p) = |trigField(2*pi*p/period)| - t. `period` > 0 is the
    // spatial repeat; `t` in (0, amplitude) is the half-thickness of the shell.
    // amplitude is the max |trigField| (gyroid/schwarzP -> ~the field's own max).
    // Degenerate: period <= 0, t <= 0, or t >= the field amplitude (the shell
    // would swallow the whole cell, leaving no surface) -> ok=false.

    static SdfResult gyroid  (const Vec3& center, double period, double thickness);
    static SdfResult schwarzP(const Vec3& center, double period, double thickness);
    static SdfResult schwarzD(const Vec3& center, double period, double thickness);
    static SdfResult neovius (const Vec3& center, double period, double thickness);

    // The maximum amplitude of each TPMS trig field, used both internally (for
    // the thickness sanity check) and by the validation gate. These are the
    // analytic max-|trigField| values:
    //   gyroid   amplitude = 1 + 1                       (sum of three products,
    //            actual analytic max of sin*cos sum)     -> see .cpp note.
    static double gyroidAmplitude();
    static double schwarzPAmplitude();
    static double schwarzDAmplitude();
    static double neoviusAmplitude();
};

} // namespace implicit
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_IMPLICIT_SDFLIBRARY_HPP
