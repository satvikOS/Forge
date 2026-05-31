#pragma once

// LOD — 3-level Level-of-Detail tessellation cache + per-instance picker.
//
// Each unique ShapeHandle gets three pre-tessellated meshes cached on
// first request (low / med / high), with proportional deflection
// tolerances: high uses linTol = 0.05 mm, med uses 5×, low uses 25×.
// In the limit, low ≈ 200 tris on a unit cube, high ≈ 20k tris on a
// dense organic body — exactly what the renderer wants at different
// screen footprints.
//
// `selectLOD(instanceId, eye, fov, screenH)` picks the right level for an
// instance by projecting its AABB diameter into screen-space pixels:
//   px > 256  → High
//   64..256   → Med
//   < 64      → Low
// These thresholds match the heuristics SolidWorks / Inventor publish
// for their AMD-driver LOD; the constants are exposed in the header so
// tests can verify boundary behaviour without hardcoding them twice.

#include "forge/ShapeRegistry.hpp"
#include "forge/Tessellate.hpp"
#include "forge/ComponentRegistry.hpp"

#include <array>
#include <cstdint>

namespace forge {

enum class LODLevel : std::uint8_t {
    Low  = 0,
    Med  = 1,
    High = 2,
};

constexpr double kLodPxLowHi = 256.0;  // boundary med ↔ high
constexpr double kLodPxLowMd =  64.0;  // boundary low ↔ med

// Linear deflection tolerances. The high level deliberately uses the same
// constant as the renderer's default (matching ForgeBodyMesh) so the
// existing tessellate() call paths produce identical geometry to LOD::High.
constexpr double kLodLinTolHigh = 0.05;
constexpr double kLodLinTolMed  = 0.25;
constexpr double kLodLinTolLow  = 1.25;
constexpr double kLodAngTol     = 0.5;

// Returns the cached mesh at the requested level; tessellates on the
// first request per (shape, level) pair and reuses it from then on.
// Thread-safe; calls block other callers on the same shape while one
// thread is performing the OCCT meshing.
const Mesh& tessellateLOD(ShapeHandle handle, LODLevel level);

// Picks an LOD level for `instanceId` given a camera. `eyeWorld` is the
// camera position in world units, `fovRad` the vertical field of view,
// `screenHeightPx` the pixel height of the viewport. The math is the
// standard "AABB diameter → pixels" projection:
//   px = (diameter * screenH) / (2 * dist * tan(fov/2))
LODLevel selectLOD(InstanceId instanceId,
                   double eyeX, double eyeY, double eyeZ,
                   double fovRad, double screenHeightPx);

// Drop every cached mesh — used when a shape is mutated, or by smoke
// tests that want a clean slate. O(n) in the number of cached entries.
void clearLODCache();
std::size_t lodCacheEntries();

} // namespace forge
