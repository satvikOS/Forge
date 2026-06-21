// forge/native/mesh/MeshBoolRobust_a.hpp
//
// ROBUST GENERAL mesh boolean — VARIANT A (per-triangle Constrained Delaunay
// arrangement with a GLOBAL shared intersection-vertex map). Stage 2 of
// KERNEL_INHOUSE_ROADMAP.md, the in-house manifold-3d / WASM replacement probe.
// Pure C++20, ZERO external dependencies, no OCCT, no WASM, no third-party libs.
//
// This is a NEW file. It does NOT modify any committed file. It exposes the
// UNIQUELY-named entry point  meshBoolRobust_a(...)  so it can coexist with the
// other parallel boolean variants without any symbol clash. It reuses, by
// #include ONLY (no duplicated types / predicates):
//   * forge/native/mesh/HalfEdgeMesh.hpp   (Vec3, HalfEdgeMesh, validate)
//   * forge/native/mesh/TriTriIntersect.hpp(exact triangle-triangle segments)
//   * forge/native/Predicates.hpp          (exact orient2d / orient3d / incircle)
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY PRIOR ATTEMPTS FAILED (KERNEL_PARITY.md round 3/4) AND THE CORE FIX
// ─────────────────────────────────────────────────────────────────────────────
//   Round 3 (`MeshBoolean2`) snap-rounded every new cut vertex onto a uniform
//   weld GRID. For a 45° rotated cube the SAME geometric intersection point,
//   computed once while imprinting A and once while imprinting B, rounded into
//   two DIFFERENT grid cells → A's cut and B's cut landed on different vertices
//   → a T-junction → non-manifold (detected, returned ok=false). Round 4 proved
//   that even EXACT cut coordinates don't fix it: the real blocker is the
//   surface ARRANGEMENT / re-triangulation closure, not coordinate precision.
//
//   VARIANT A's fix is structural, exactly as the task prescribes:
//
//     Every intersection point is the meeting of ONE mesh EDGE (an undirected
//     edge between two original vertices u<v) with ONE triangle's supporting
//     PLANE (an original face f). That (edge, face) pair is a STABLE, ORDER-
//     INDEPENDENT KEY. We compute the point ONCE, store it once, and hand back
//     the SAME global vertex id whenever EITHER surface asks for "the point
//     where edge(u,v) meets the plane of face f". Original vertices keep their
//     own ids. So when face A_i is re-triangulated and when face B_j is re-
//     triangulated, both receive the IDENTICAL sequence of vertex ids along the
//     shared cut polyline — they are guaranteed to meet edge-for-edge,
//     regardless of rotation. No grid. No tolerance on the shared id.
//
//   With the shared map in place, each cut face is re-triangulated by a
//   per-triangle 2D Constrained Delaunay Triangulation (exact orient2d +
//   incircle + the imprinted segments as constraints), projected to the
//   triangle's dominant-axis plane. Sub-triangles are then classified in/out of
//   the other solid by an exact orient3d ray-parity test, selected per op,
//   stitched, and the result is rebuilt + audited as a closed 2-manifold. If
//   anything is non-manifold the op returns ok=false — NEVER a fake.
//
// ROBUSTNESS CEILING (honest, Bible §0/§9 — do NOT overclaim):
//   robust-in-practice with an EXACT combinatorial CORE. Every sidedness /
//   in-circle / ray-crossing / in-solid decision is an exact predicate sign, so
//   the TOPOLOGY of the arrangement is proven-exact within the predicate domain.
//   The COORDINATES of the shared intersection vertices are double-precision
//   edge×plane solves — but they are computed ONCE and SHARED, so the two
//   surfaces are bit-identical along the cut by CONSTRUCTION (not by rounding to
//   a common grid). This removes the T-junction failure mode for clean rotated /
//   tilted general-position contact. It is NOT CGAL-exact rationals; pairs that
//   are genuinely degenerate (coincident-coplanar stacks of both solids on the
//   same patch, exact vertex-on-vertex pin-touches) remain a harder case and are
//   DETECTED + returned ok=false rather than faked. See meshBoolRobust_a's honest
//   envelope in the .cpp and the gate test.
//
// No external dependencies. No WASM. Pure C++20.

#ifndef FORGE_NATIVE_MESH_MESHBOOLROBUST_A_HPP
#define FORGE_NATIVE_MESH_MESHBOOLROBUST_A_HPP

#include "forge/native/mesh/HalfEdgeMesh.hpp"  // Vec3, HalfEdgeMesh (reused)

#include <cstdint>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

// The three regularized boolean operations.
enum class BoolOpA {
    UNION,         // A ∪ B
    INTERSECTION,  // A ∩ B
    DIFFERENCE     // A − B
};

// Result of meshBoolRobust_a.
//   ok     : true  => `mesh` is a genuine CLOSED 2-manifold result. The function
//                     NEVER sets ok=true on a self-intersecting / non-manifold /
//                     wrong-topology mesh (0 fakes — it returns ok=false instead).
//   mesh   : the boolean result (valid only when ok==true).
//   reason : a short human string describing success or the honest failure mode.
struct BoolResultA {
    bool          ok = false;
    HalfEdgeMesh  mesh;
    const char*   reason = "uninitialized";
};

// Compute A (op) B for two CLOSED 2-manifold triangle solids given as indexed
// triangle soups (positions = flat xyz triples; indices = flat CCW triangles).
//
// Strategy A — per-triangle Constrained Delaunay arrangement with a GLOBAL
// shared intersection-vertex map (see the file header). Returns a BoolResultA
// whose `ok` flag is an HONEST closed-2-manifold guarantee.
BoolResultA meshBoolRobust_a(const std::vector<double>&        aPositions,
                             const std::vector<std::uint32_t>& aIndices,
                             const std::vector<double>&        bPositions,
                             const std::vector<std::uint32_t>& bIndices,
                             BoolOpA op);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_MESHBOOLROBUST_A_HPP
