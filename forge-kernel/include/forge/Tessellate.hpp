#pragma once

#include "forge/ShapeRegistry.hpp"

#include <cstdint>
#include <vector>

namespace forge {

struct Mesh {
    std::vector<float> positions;   // x,y,z triplets
    std::vector<float> normals;     // per-vertex normals (averaged)
    std::vector<std::uint32_t> indices; // triangle indices
};

// Tessellate a shape using OCCT BRepMesh. `linearTol` is in model units
// (typically mm); `angularTol` is in radians; both are passed straight to
// BRepMesh_IncrementalMesh as Deflection and Angle.
Mesh tessellate(ShapeHandle h, double linearTol, double angularTol);

} // namespace forge
