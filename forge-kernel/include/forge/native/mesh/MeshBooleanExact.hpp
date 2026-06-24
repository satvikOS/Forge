// forge/native/mesh/MeshBooleanExact.hpp
//
// K2 — ROBUST EXACT-PREDICATE / EXACT-CONSTRUCTION mesh boolean (Manifold/CGAL-
// grade). This is the additive robustness layer that wires the ExactReal
// exact-construction kernel (forge/native/ExactReal.hpp +
// forge/native/ExactPredicates3D.hpp) into the native mesh-boolean path so the
// tricky degenerate classes — coplanar shared faces, shared edges, single-point
// tangencies, near-degenerate touching, coplanar-faced stacks — produce a
// WATERTIGHT 2-manifold result with NO double-precision tie-break on the topology
// and NO silent failure.
//
// RELATION TO THE EXISTING ENGINE (booleans.md §1b, §C1.1):
//   forge::native::mesh::meshBooleanNative (Strategy Q + Simulation-of-Simplicity)
//   is the fast general boundary-crossing engine; it carries an honest ~0.12%
//   ceiling because its intersection COORDINATES are double (a coordinate problem
//   SoS cannot fix). meshBooleanExact KEEPS that fast analytic/SoS path as the
//   first attempt (so the common general-position case stays fast — the audit's
//   "keep the analytic-SSI quadric fast-path" requirement), and when it returns
//   ok=false (the residual sliver class) runs a FULLY-EXACT arrangement built on
//   ExactReal constructions: every cut point is an exact rational, registered
//   through a CANONICAL exact-point registry so three near-coincident double hits
//   that should be one geometric point collapse to ONE exact vertex — which is
//   exactly what removes the crack / count!=2 edge.
//
//   The result is rebuilt + validate()'d as a closed 2-manifold; ok=true ONLY
//   then (0 fakes, identical discipline to meshBooleanNative).
//
// Pure C++20, ZERO external dependencies. No OCCT, no WASM.

#ifndef FORGE_NATIVE_MESH_MESHBOOLEANEXACT_HPP
#define FORGE_NATIVE_MESH_MESHBOOLEANEXACT_HPP

#include "forge/native/mesh/MeshBooleanNative.hpp"   // BoolOpN, BoolResultN, HalfEdgeMesh

namespace forge {
namespace native {
namespace mesh {

// Compute A (op) B with the exact-construction robustness layer. Returns a
// BoolResultN whose `ok` is an HONEST closed-2-manifold guarantee. The result
// volume is exact-construction accurate; for the analytic battery it matches the
// closed form to round-off.
BoolResultN meshBooleanExact(const std::vector<double>&        aPositions,
                             const std::vector<std::uint32_t>& aIndices,
                             const std::vector<double>&        bPositions,
                             const std::vector<std::uint32_t>& bIndices,
                             BoolOpN op);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_MESHBOOLEANEXACT_HPP
