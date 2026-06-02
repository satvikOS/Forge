#pragma once

// Forge-203 — CPU path tracer preview.
//
// Single-bounce diffuse + sun renderer over a triangle mesh. The
// renderer is intentionally narrow: a tight inner loop that's good
// enough for publishing-quality previews on small (≤500 px) buffers
// in seconds, not a production raytracer.
//
// Pipeline (per pixel):
//   1. Shoot primary ray from the camera.
//   2. Find nearest hit via a simple median-split AABB BVH.
//   3. Compute Lambertian shading:
//        direct = max(0, n · L) · sunColor · shadowFactor
//        indirect = AO factor (N hemisphere visibility rays)
//        rgb = albedo · (ambient + sunIntensity·direct + aoStrength·indirect)
//   4. Background: solid colour when the ray misses.
//
// Output is a packed `Float32` RGB buffer in linear space (gamma is
// applied by the caller / display). Resolution caps at 1024×1024 to
// keep render time bounded.

#include <cstdint>
#include <vector>

namespace forge { namespace pathtrace {

struct Camera {
    double position[3];
    double lookAt[3];
    double up[3];
    double fovYDegrees;
};

struct SunLight {
    double direction[3];     // pointing from the surface toward the sun
    double colour[3];        // linear RGB intensity (0..many)
};

struct Material {
    double albedo[3];
    double emission[3];
};

struct Mesh {
    std::vector<float>         positions;     // 3 floats per vertex
    std::vector<float>         normals;       // 3 floats per vertex, optional
    std::vector<std::uint32_t> indices;       // 3 uint per triangle
    std::vector<std::uint32_t> materialIds;   // one entry per triangle
    std::vector<Material>      materials;
};

struct RenderInputs {
    Mesh mesh;
    Camera camera;
    SunLight sun;
    double ambient[3];
    double background[3];
    std::uint32_t width;
    std::uint32_t height;
    std::uint32_t aoSamples;       // hemisphere visibility samples per hit
    double        aoStrength;
    double        aoMaxDistance;
    unsigned long randomSeed;
};

struct RenderOutputs {
    std::vector<float> rgb;        // width·height·3, linear space
    std::uint32_t      width;
    std::uint32_t      height;
    std::uint64_t      rayCount;
    double             elapsedSec;
};

RenderOutputs render(const RenderInputs& in);

}} // namespace forge::pathtrace
