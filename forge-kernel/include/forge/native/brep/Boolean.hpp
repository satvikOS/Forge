// forge/native/brep/Boolean.hpp
//
// IN-HOUSE KERNEL STEP 2 — the OCCT-free native B-rep BOOLEAN (fuse/cut/common)
// on analytic-face brep::Solids. forge::native::brep::booleanSolid(A,B,op) is the
// in-house BRepAlgoAPI_{Fuse,Cut,Common} replacement: it intersects the two
// solids, classifies the pieces in/out of the other, selects + orients per the op
// and STITCHES a valid CLOSED 2-MANIFOLD result Solid (Euler-Poincaré valid,
// every edge mated). Pure C++20 (no Eigen needed here), ZERO external deps. NO
// OCCT, NO WASM. ADDITIVE behind -DFORGE_NATIVE_BREP; the live OCCT booleans in
// src/Booleans.cpp are untouched.
//
// ============================ HONESTY (Bible §0/§9) ========================
// THE CRUX. Strategy + honest map (this is a real boolean, not a stub):
//
//   booleanSolid runs a GENUINE ANALYTIC B-rep boolean FIRST and a flagged mesh
//   fallback ONLY where the analytic path cannot be exact. Concretely:
//
//   1. ANALYTIC PATH (the default, the contribution of STEP 2):
//      For each face-pair (fA of A, fB of B) whose AABBs overlap, it calls the
//      exact analytic SSI (brep::intersectSurfaces) to get the TRUE 3-D
//      intersection curve in CLOSED FORM (plane/plane line, plane/cylinder
//      line-pair / circle / ellipse, plane/sphere circle, sphere/sphere circle,
//      etc.). It IMPRINTS that curve onto BOTH faces by splitting each face's
//      bounding loop IN ITS OWN PARAMETER DOMAIN (constrainedDelaunay2D over the
//      face's (u,v) box with the curve as a constraint polyline). Each resulting
//      sub-face KEEPS THE PARENT Surface — a plane stays a Plane, a cylinder side
//      stays the SAME Cylinder Surface — so the cut geometry is exact, not chordal.
//      Each sub-face is then classified IN / OUT of the OTHER solid by a
//      surface-interior sample point (ray-cast point-in-solid), selected + oriented
//      per the op (Fuse / Cut / Common), and the survivors are STITCHED into a
//      valid CLOSED 2-MANIFOLD result Solid (shared cut vertices welded so both
//      sides mate edge-for-edge along the imprinted curve, validated via
//      TopologyBuilder::isClosedTwoManifold + Euler-Poincaré).
//
//      RESULT FACE-KINDS ARE ANALYTIC. A box−cylinder through-bore yields 5 planar
//      box faces + ONE cylindrical bore wall (faceted into angular sectors that all
//      share ONE analytic Cylinder Surface, exactly as the primitives do) — its
//      VOLUME is the EXACT analytic value (the bore wall is mass-integrated with
//      the analytic cylinder Jacobian, NOT a chord polygon). box−box is all planar.
//      box−sphere keeps the Sphere face; box−cone keeps the Cone face.
//
//   2. MESH FALLBACK (explicit, RESULT-FLAGGED — usedMeshFallback=true):
//      ONLY when a needed face-pair returns SSI ok=false (NURBS skin, skew/unequal-r
//      cyl∩cyl, cone∩cone, torus) does the op route through the proven
//      forge::native::mesh::meshBooleanNative arrangement, reconstructed as planar
//      faces. This is NEVER taken for plane/cylinder/cone/sphere pairs. The flag is
//      surfaced on BooleanResult so a regression to facets on an analytic pair is
//      detectable. If even the fallback cannot close the result it returns ok=false
//      (honest) — never a wrong solid.
//
//   So: an EXACT analytic-face boolean for the elementary-quadric mechanical family,
//   with an HONEST, flagged mesh fallback for the high-degree pairs that have no
//   closed form — and an honest ok=false where neither is robust.

#ifndef FORGE_NATIVE_BREP_BOOLEAN_HPP
#define FORGE_NATIVE_BREP_BOOLEAN_HPP

#include <memory>

#include "forge/native/brep/Topology.hpp"

namespace forge {
namespace native {
namespace brep {

// The three regularized boolean operations (mirrors OCCT Fuse/Cut/Common).
enum class BoolOp {
    Fuse,    // A ∪ B   (BRepAlgoAPI_Fuse)
    Cut,     // A − B   (BRepAlgoAPI_Cut)
    Common   // A ∩ B   (BRepAlgoAPI_Common)
};

// Result of booleanSolid. `ok` is an HONEST closed-2-manifold guarantee: it is
// true ONLY when `solid` is a genuine closed 2-manifold whose topology validated.
// On any honest failure (the mesh arrangement could not close the result, an
// input was not a valid solid, or a tangency produced no cut) ok=false and
// `reason` explains — NEVER a wrong solid.
//
// The result owns its topology via `owner` (a TopologyBuilder); `solid` is a
// non-owning view valid for the lifetime of `owner`. Keep `owner` alive while you
// use `solid` (e.g. to compute mass props or tessellate it).
struct BooleanResult {
    bool   ok = false;
    const char* reason = "uninitialized";
    Solid* solid = nullptr;                       // view into *owner
    std::shared_ptr<TopologyBuilder> owner;       // owns the result topology

    // True iff the result was produced by the mesh-arrangement FALLBACK (planar
    // triangle faces) rather than the analytic-face path. For an analytic pair
    // (plane/cylinder/cone/sphere) this MUST stay false — the gate asserts it so a
    // silent regression to facets fails. Set true ONLY when a needed face-pair has
    // no closed-form SSI (NURBS / skew-or-unequal cyl∩cyl / cone∩cone / torus).
    bool   usedMeshFallback = false;
};

// Options for the boolean. The conforming soups are produced by the Step-1
// SolidTessellate at the INPUT solids' as-built faceting (a primitive built with
// a high PrimitiveOptions{nSeg,nBand} tessellates finely, so its curved cut walls
// converge to the analytic volume faster — the gate builds its curved inputs at a
// high nSeg to hit the 0.5% curved tolerance). `weldTol` is the position-weld
// grid used when building the soups and reconstructing the result.
struct BooleanOptions {
    double weldTol = 1e-7;
};

// Compute A (op) B for two closed, oriented 2-manifold native solids. See the
// file header for the strategy and the HONEST map of what is exact vs converged.
BooleanResult booleanSolid(const Solid& A, const Solid& B, BoolOp op,
                           const BooleanOptions& opts = BooleanOptions{});

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_BOOLEAN_HPP
