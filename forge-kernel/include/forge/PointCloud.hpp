#pragma once

// Forge-202 — point cloud utilities for reverse engineering / scan
// post-processing.
//
// Inputs/outputs use packed Float32 / Uint32 arrays so the JS layer
// can pass scanner data (PLY, XYZ, OBJ) straight through.
//
// Operations:
//   * stats(points)              — bbox, centroid, density, count
//   * voxelDownsample(points,leaf)  — uniform downsample on a grid
//   * estimateNormals(points,k)   — per-point normals via PCA on
//                                    k-nearest-neighbour set, with
//                                    consistent orientation flip
//                                    against a viewpoint hint.
//   * voxelMesh(points,leaf)      — emit a triangle mesh of the voxel
//                                    shell (one cube per occupied
//                                    voxel, shared external faces).

#include <cstdint>
#include <vector>

namespace forge { namespace pointcloud {

struct Stats {
    std::uint32_t pointCount;
    float bboxMin[3];
    float bboxMax[3];
    float centroid[3];
    float density;          // points per unit volume of the bbox
};

Stats stats(const std::vector<float>& points);

std::vector<float> voxelDownsample(const std::vector<float>& points,
                                   double leafSize);

std::vector<float> estimateNormals(const std::vector<float>& points,
                                   std::uint32_t k,
                                   const double viewpoint[3]);

struct Mesh {
    std::vector<float>         positions;
    std::vector<std::uint32_t> indices;
};

Mesh voxelMesh(const std::vector<float>& points, double leafSize);

}} // namespace forge::pointcloud
