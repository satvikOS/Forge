// forge/native/brep/Pattern.hpp
//
// IN-HOUSE KERNEL — ANALYTIC FEATURE PATTERN (linear / circular / mirror) on the
// native B-rep. This is the feature-modeling op every mechanical part uses:
// replicate ONE rigid TOOL solid N times by a pattern of rigid transforms and
// boolean-CUT (or FUSE) all instances from a BASE solid in ONE feature, producing
// ONE native brep::Solid (closed 2-manifold, exact analytic mass).
//
// It is the in-house equivalent of a Parasolid/ACIS pattern feature
// (PK_BODY_pattern / BRepFeat array + BRepAlgoAPI_Cut per instance):
//   * LINEAR   — count N, step vector (bolt rows, hole arrays, slots);
//   * CIRCULAR — count N, axis line + angular step (a BOLT CIRCLE);
//   * MIRROR   — reflect the tool across a plane (a single mirrored instance).
//
// ============================ HONESTY (Bible §0/§9) ========================
// HOW IT WORKS (a real feature op, not a stub). The caller supplies:
//   * a BASE solid (the part being machined), and
//   * a TOOL BUILDER — a functor that stamps the cutter/boss onto a fresh
//     SolidFactory (e.g. `[](SolidFactory& f){ return f.buildCylinder(1,3); }`).
// applyPattern:
//   1. enumerates the pattern's rigid transforms (instance 0 is the IDENTITY
//      placement of the tool exactly where the builder put it, then the linear
//      steps / circular rotations / the mirror image follow);
//   2. for EACH transform: builds a FRESH tool via the builder (its own factory,
//      kept alive in the result so its topology outlives the boolean), applies the
//      RIGID transform to every vertex + every analytic-surface frame
//      (origin as a point; axis/refDir as directions; binormal = axis x refDir
//      rotates with them, so a transformed cylinder IS the same cylinder moved),
//      and for a MIRROR (improper, det -1) reverses every face loop so the result
//      stays OUTWARD-oriented (a bare reflection would invert the winding ->
//      non-manifold);
//   3. accumulates: result <- booleanSolid(result, instance_i, op) for every
//      instance, so all N cuts (or fuses) merge into ONE solid via the proven
//      analytic-first / flagged-mesh-fallback boolean.
//
// EXACTNESS. Each instance keeps its parent analytic surfaces (the transformed
// cylinder side stays a Cylinder Surface), so for NON-OVERLAPPING tool instances
// the patterned solid's volume is the EXACT analytic value:
//   base - sum_i V(tool_i ∩ base)   (CUT)   /   base + ... - overlaps   (FUSE).
// The pattern_test gate asserts a bolt circle of 6 holes and a linear row of 4
// holes hit  plate - N*pi*r^2*t  to the boolean's analytic tolerance, and that the
// result is a closed 2-manifold every step.
//
// TARGETED (NOT claimed here, honest follow-ups):
//   * OVERLAPPING tool instances whose cut regions intersect (the exact merged
//     volume needs inclusion-exclusion; this op still produces a valid solid via
//     the sequential boolean, but the simple N*Vtool volume identity no longer
//     holds — the gate uses non-overlapping spacing);
//   * pattern-of-FEATURE (e.g. patterning a fillet/draft already applied to the
//     base) — that is a feature-replay op, a separate increment;
//   * non-rigid (scaled) instances; sketch-driven curve patterns.
//
// Pure C++20, ZERO external deps (stdlib + forge native headers). No OCCT, no
// WASM. ADDITIVE: reuses booleanSolid + the SolidFactory primitives unchanged.

#ifndef FORGE_NATIVE_BREP_PATTERN_HPP
#define FORGE_NATIVE_BREP_PATTERN_HPP

#include <functional>
#include <memory>
#include <vector>

#include "forge/native/brep/Boolean.hpp"     // BoolOp, BooleanResult, BooleanOptions
#include "forge/native/brep/Primitives.hpp"  // SolidFactory (the tool builder target)
#include "forge/native/brep/Surface.hpp"     // Vec3 (+ vector helpers)

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// PatternKind — the three feature-pattern families.
// ---------------------------------------------------------------------------
enum class PatternKind {
    Linear,    // N instances stepped by `step` (instance k at k*step), k=0..N-1
    Circular,  // N instances rotated about (axisOrigin,axisDir) by k*angleStep
    Mirror     // 2 instances: the original + its reflection across a plane
};

// ---------------------------------------------------------------------------
// PatternSpec — the parameters of one pattern feature. Only the fields relevant
// to `kind` are read.
// ---------------------------------------------------------------------------
struct PatternSpec {
    PatternKind kind = PatternKind::Linear;

    // Common: how many instances of the tool (including instance 0, the as-built
    // tool). For Mirror this is forced to 2 (original + reflection).
    int count = 1;

    // LINEAR: the translation between consecutive instances. Instance k is at
    // k*step from the as-built tool.
    Vec3 step{0, 0, 0};

    // CIRCULAR: a point on the rotation axis, the axis direction (need not be
    // unit), and the angle (RADIANS) between consecutive instances. A full bolt
    // circle of N holes uses angleStep = 2*pi/N.
    Vec3   axisOrigin{0, 0, 0};
    Vec3   axisDir{0, 0, 1};
    double angleStep = 0.0;

    // MIRROR: a point on the mirror plane and the plane's normal (need not be
    // unit). The reflection of the tool across this plane is the 2nd instance.
    Vec3 planeOrigin{0, 0, 0};
    Vec3 planeNormal{1, 0, 0};
};

// The functor the caller supplies to stamp ONE tool onto a fresh factory and
// return its Solid (e.g. a cylinder for a drilled hole). Called once per pattern
// instance so every instance is an INDEPENDENT solid that can be transformed and
// fed to the boolean. The factory is created and OWNED internally and is kept
// alive for the lifetime of the result (so the tool topology outlives the merge).
using ToolBuilder = std::function<Solid*(SolidFactory&)>;

// ---------------------------------------------------------------------------
// applyPattern — the feature op. Replicate `tool` by the pattern `spec` and merge
// every instance into `base` with `op` (Cut for holes/pockets, Fuse for bosses).
//
//   base       : the part being machined (a closed 2-manifold native solid).
//   toolBuilder: stamps the cutter/boss onto a fresh SolidFactory (instance 0 is
//                placed exactly where the builder puts it; the pattern transforms
//                are applied relative to that as-built placement).
//   spec       : the pattern parameters.
//   op          : BoolOp::Cut (drill the array of holes) or ::Fuse (array of bosses).
//   primOpt     : faceting resolution for each freshly-built tool (governs the
//                 curved-cut tessellation tolerance, exactly like the boolean gate
//                 builds its cylinders at a high nSeg).
//   boolOpts    : forwarded to each booleanSolid step.
//
// Returns a BooleanResult whose `solid`/`owner` hold the final merged solid. `ok`
// is an HONEST closed-2-manifold guarantee for every accumulated step; on the
// first boolean that cannot close, it returns ok=false with the failing reason
// (never a wrong solid). The result's `owner` retains every per-instance factory
// so the topology the result views remains valid.
BooleanResult applyPattern(const Solid& base,
                           const ToolBuilder& toolBuilder,
                           const PatternSpec& spec,
                           BoolOp op,
                           const PrimitiveOptions& primOpt = {},
                           const BooleanOptions& boolOpts = {});

// ---------------------------------------------------------------------------
// Rigid transform primitives (exposed for tests / reuse). A RigidTransform is a
// 3x3 linear map `r` (a row-major rotation, or a reflection for a mirror) plus a
// translation `t`: p' = r*p + t. `det` carries the sign of the linear part so the
// pattern feature knows to re-orient (loop-reverse) an improper (mirror) instance.
// ---------------------------------------------------------------------------
struct RigidTransform {
    double r[9] = {1, 0, 0, 0, 1, 0, 0, 0, 1}; // row-major 3x3 linear part
    Vec3   t{0, 0, 0};                           // translation
    double det = 1.0;                            // +1 proper rotation, -1 reflection

    // Apply to a POINT (origin/translation included).
    Vec3 applyPoint(const Vec3& p) const {
        return Vec3{r[0] * p.x + r[1] * p.y + r[2] * p.z + t.x,
                    r[3] * p.x + r[4] * p.y + r[5] * p.z + t.y,
                    r[6] * p.x + r[7] * p.y + r[8] * p.z + t.z};
    }
    // Apply to a DIRECTION (linear part only, no translation).
    Vec3 applyDir(const Vec3& d) const {
        return Vec3{r[0] * d.x + r[1] * d.y + r[2] * d.z,
                    r[3] * d.x + r[4] * d.y + r[5] * d.z,
                    r[6] * d.x + r[7] * d.y + r[8] * d.z};
    }
};

// Build the per-instance transforms a spec enumerates (instance 0 is always the
// identity = the as-built tool). Exposed so a test can inspect the placements.
std::vector<RigidTransform> patternTransforms(const PatternSpec& spec);

// Apply a rigid transform to a native Solid IN PLACE: every vertex point + every
// analytic-surface frame (origin/axis/refDir). For an improper transform
// (det < 0) every face loop is reversed so the solid stays outward-oriented. The
// Solid's topology must be owned by `tb` (the builder that minted it), which is
// required only to reverse loops; pass the SolidFactory's builder().
void transformSolidInPlace(const RigidTransform& xf, Solid* s, TopologyBuilder& tb);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_PATTERN_HPP
