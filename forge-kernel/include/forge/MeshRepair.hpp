#pragma once

// Forge-200 — mesh repair toolkit.
//
// A collection of cleanup + simplification passes that run over a
// triangle mesh given as parallel `positions` (3 floats per vertex) +
// `indices` (3 uint32 per triangle) arrays. Each pass returns a new
// mesh + a stats struct so the UI can show before/after.
//
// Operations:
//   * dedupeVertices(eps)        — spatial-hash welding of co-located verts
//   * removeDegenerate()         — drop zero-area triangles
//   * fillHoles(maxLoopLen)      — find boundary loops + fan-triangulate
//   * laplacianSmooth(iter,λ)    — move interior verts toward neighbour mean
//   * decimateEdgeCollapse(target)— greedy shortest-edge collapse to target tris
//
// Each pass is independent and can be chained.

#include <cstdint>
#include <vector>

namespace forge { namespace meshrepair {

struct Mesh {
    std::vector<float>         positions;
    std::vector<std::uint32_t> indices;
};

struct Stats {
    std::uint32_t vertexCount;
    std::uint32_t triangleCount;
    std::uint32_t boundaryEdgeCount;
    std::uint32_t nonManifoldEdgeCount;
};

Stats analyse(const Mesh& m);

Mesh dedupeVertices(const Mesh& in, double epsilon);
Mesh removeDegenerate(const Mesh& in);
Mesh fillHoles(const Mesh& in, std::uint32_t maxLoopLength);
Mesh laplacianSmooth(const Mesh& in, std::uint32_t iterations, double lambda);
Mesh decimateEdgeCollapse(const Mesh& in, std::uint32_t targetTriangles);

}} // namespace forge::meshrepair
