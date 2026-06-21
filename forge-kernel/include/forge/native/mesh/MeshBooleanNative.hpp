// forge/native/mesh/MeshBooleanNative.hpp
//
// THE CANONICAL general boundary-crossing mesh boolean for forge::native::mesh
// (combined-arrangement interior-face removal — the strategy verified as
// "Variant Q", promoted here as the single verified superset that SUPERSEDES the
// narrower MeshBoolean2 / MeshBoolRobust_a variants, which are removed). Stage 2
// of KERNEL_INHOUSE_ROADMAP.md, the in-house manifold-3d / WASM replacement.
// Pure C++20, ZERO external dependencies, no OCCT, no WASM, no third-party libs.
//
// It exposes the canonical entry point  meshBooleanNative(...)  and is the one
// general boolean wired into forge.native.meshBoolean (binding.cpp). It reuses,
// by #include ONLY (no duplicated types / predicates):
//   * forge/native/mesh/HalfEdgeMesh.hpp    (Vec3, HalfEdgeMesh, validate)
//   * forge/native/mesh/TriTriIntersect.hpp (exact triangle-triangle segments)
//   * forge/native/Predicates.hpp           (exact orient2d / orient3d / incircle)
//
// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY Q — COMBINED-ARRANGEMENT INTERIOR-FACE REMOVAL
// ─────────────────────────────────────────────────────────────────────────────
//   Build ONE combined arrangement = the surface of A ∪ B fully imprinted: every
//   face of A is cut by every crossing face of B and vice-versa, using the GLOBAL
//   shared intersection-vertex map (round-5 PROVEN fix #1) so the SAME geometric
//   cut point is ONE shared id handed to BOTH surfaces → a bit-identical cut
//   polyline with NO T-junction, plus the conforming edge-split registry (PROVEN
//   fix #2) so a cut point on a shared original edge splits BOTH adjacent same-mesh
//   faces at the SAME vertex.  After imprinting, every sub-face carries an EXACT
//   in/out label vs the OTHER solid (orient3d ray-parity).
//
//   The op is then a pure SELECTION over the combined arrangement — we DELETE the
//   sub-faces the op discards and KEEP the rest (flipping the kept B normals for
//   DIFFERENCE):
//       UNION        : keep A-outside-B  ∪  B-outside-A
//       INTERSECTION : keep A-inside-B   ∪  B-inside-A
//       DIFFERENCE   : keep A-outside-B  ∪  B-inside-A (B reversed)
//   Because BOTH surviving surfaces were imprinted with the SAME shared polyline
//   ids, the kept A-faces and kept B-faces meet edge-for-edge along that polyline
//   — exactly 2 faces per polyline edge — so the result is CLOSED by construction.
//   Coincident-coplanar contact walls (the 45° shared-face case) are net-cancelled
//   on a per-undirected-triangle basis at assembly so opposed duplicate walls
//   annihilate and aligned ones collapse to one.  Result is rebuilt + audited as a
//   closed 2-manifold; ok=false (NEVER a fake) if it is not.
//
// HOW Q DIFFERS FROM VARIANT A (and why it targets the harder cases):
//   Variant A's shipped gate proves only the ENCLOSED-cut envelope (B fully inside
//   A) and honestly returns ok=false on the boundary-crossing HALF-overlap and the
//   45° coplanar-contact cube.  Strategy Q keeps A's proven shared-vertex / CDT /
//   ray-parity core but reframes selection as combined-arrangement removal and adds
//   the coplanar-contact wall handling needed to CLOSE the boundary-crossing
//   half-overlap (T1) and the clean 45° contact cube (T2).  The honest measured
//   outcome on T1/T2/T3 is reported in the .cpp header and the gate test.
//
// ROBUSTNESS CEILING (honest, Bible §0/§9 — do NOT overclaim):
//   robust-in-practice with an EXACT combinatorial CORE. Every sidedness /
//   in-circle / ray-crossing / in-solid decision is an exact predicate sign, so the
//   TOPOLOGY of the arrangement is proven-exact within the predicate domain. The
//   COORDINATES of the shared intersection vertices are double-precision edge×plane
//   solves computed ONCE and SHARED, so the two surfaces are bit-identical along the
//   cut by CONSTRUCTION (not by rounding to a common grid). It is NOT CGAL-exact
//   rationals; genuinely degenerate pairs (exact vertex-on-vertex pin-touches,
//   coincident-coplanar stacks beyond a single contact facet) are DETECTED and
//   returned ok=false rather than faked.
//
// No external dependencies. No WASM. Pure C++20.

#ifndef FORGE_NATIVE_MESH_MESHBOOLEANNATIVE_HPP
#define FORGE_NATIVE_MESH_MESHBOOLEANNATIVE_HPP

#include "forge/native/mesh/HalfEdgeMesh.hpp"  // Vec3, HalfEdgeMesh (reused)

#include <cstdint>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

// The three regularized boolean operations.
enum class BoolOpN {
    UNION,         // A ∪ B
    INTERSECTION,  // A ∩ B
    DIFFERENCE     // A − B
};

// Result of meshBooleanNative.
//   ok     : true  => `mesh` is a genuine CLOSED 2-manifold result. The function
//                     NEVER sets ok=true on a self-intersecting / non-manifold /
//                     wrong-topology mesh (0 fakes — it returns ok=false instead).
//   mesh   : the boolean result (valid only when ok==true).
//   reason : a short human string describing success or the honest failure mode.
struct BoolResultN {
    bool          ok = false;
    HalfEdgeMesh  mesh;
    const char*   reason = "uninitialized";
};

// Compute A (op) B for two CLOSED 2-manifold triangle solids given as indexed
// triangle soups (positions = flat xyz triples; indices = flat CCW triangles).
//
// Strategy Q — combined-arrangement interior-face removal (see the file header).
// Returns a BoolResultN whose `ok` flag is an HONEST closed-2-manifold guarantee.
BoolResultN meshBooleanNative(const std::vector<double>&        aPositions,
                              const std::vector<std::uint32_t>& aIndices,
                              const std::vector<double>&        bPositions,
                              const std::vector<std::uint32_t>& bIndices,
                              BoolOpN op);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_MESHBOOLEANNATIVE_HPP
