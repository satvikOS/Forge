#pragma once

#include "forge/ShapeRegistry.hpp"

#include <cstdint>
#include <functional>
#include <vector>

namespace forge {

struct Mesh {
    std::vector<float> positions;   // x,y,z triplets
    std::vector<float> normals;     // per-vertex normals (averaged)
    std::vector<std::uint32_t> indices; // triangle indices
    // Per-TRIANGLE 1-based OCCT face id (same ordering as TopExp_Explorer
    // over TopAbs_FACE — i.e. the ids inferFeature / faceById / direct.*
    // use). Length == indices.size()/3. Lets the viewport map a raycast
    // triangle hit back to the BREP face for face picking / sketch-on-face.
    std::vector<std::uint32_t> faceIds;
};

// Tessellate a shape using OCCT BRepMesh. `linearTol` is in model units
// (typically mm); `angularTol` is in radians; both are passed straight to
// BRepMesh_IncrementalMesh as Deflection and Angle.
Mesh tessellate(ShapeHandle h, double linearTol, double angularTol);

// Submit a tessellation job to the kernel's worker pool. `done(mesh)` is
// invoked on a worker thread once OCCT finishes. The pool size is
// `hardware_concurrency() - 1` (always ≥1), shared across calls so 100
// queued shapes finish in roughly N / pool-size × per-shape time.
//
// OCCT's BRepMesh_IncrementalMesh isn't fully thread-safe across shapes
// that share underlying topology, but distinct top-level shapes can be
// safely tessellated in parallel and that's how the bench uses it.
void tessellateAsync(ShapeHandle h, double linearTol, double angularTol,
                     std::function<void(Mesh)> done);

// Block until every queued tessellation completes — used by tests/perf
// smokes to gate timing measurements.
void waitForTessellationIdle();

// Pool diagnostics for the perf smoke test.
std::size_t tessellationPoolSize();
std::size_t tessellationQueued();
std::size_t tessellationCompletedSinceLaunch();

} // namespace forge
