#pragma once

// PUSH-07 — CATIA ICEM / NX Studio-style Class-A surfacing diagnostics +
// guided sweeping, layered on top of the Forge NURBS module (Nurbs.hpp).
//
// The base Nurbs.hpp / Nurbs.cpp module covers patch authoring (build,
// trim, sew, refine, eval, project, intersect) plus a coarse classA
// summary. Real-world Class-A QA (automotive A-surfaces, free-form
// product styling, aerospace skins) requires the *visual diagnostics*
// that an ICEM Surf or NX Realize Shape reviewer drives by hand:
//
//   * Zebra-stripe shading — projects the surface normal onto a plane
//     perpendicular to a virtual light direction, buckets the resulting
//     angle into stripeCount evenly-spaced bands, and surfaces the
//     bucket index per UV sample. The stripe topology shows G2 / G3
//     defects ("kinks", "flat spots") that pure curvature plots miss.
//
//   * Curvature combs — sample an edge, take its curvature at each
//     sample, and lay a comb of normal vectors of length κ·scale so the
//     reviewer can see Bezier-handle artifacts and inflection ordering.
//
//   * G0-G3 continuity — sample two faces along their shared edge and
//     report position gap (G0), tangent angle (G1), curvature ratio
//     (G2) and torsion delta (G3) maxima. The four metrics are the
//     industry standard for surface joining QA.
//
//   * Gauss + mean curvature field — per-UV K, H, kappaMin, kappaMax
//     so the front end can paint a curvature color-map (the "rainbow"
//     overlay every Class-A workflow ships).
//
//   * G2 sewing — BRepBuilderAPI_Sewing + a continuity report on every
//     shared edge, so the kernel doesn't silently turn a G1 stitch into
//     a topologically-but-not-visually closed shell.
//
//   * Guide-curve sweep — drives BRepOffsetAPI_MakePipeShell with one
//     or more guide wires (binormal-from-guide mode), the real OCCT
//     guided-sweep entry point.
//
// Every entry point returns OCCT-derived data: BRepLProp_SLProps drives
// surface normal / curvature, BRepLProp_CLProps drives curve curvature
// + torsion, GeomLProp_SLProps backs the per-UV K/H field, and
// BRepOffsetAPI_MakePipeShell builds the swept solid/shell.

#include <array>
#include <cstdint>
#include <vector>

#include "forge/ShapeRegistry.hpp"

namespace forge { namespace classa {

// ---------- types --------------------------------------------------------

// Per-sample zebra entry. (u, v) is the parametric location, stripeIndex
// is the bucket [0, stripeCount), normalAngle is the projected angle in
// radians (in [-pi, pi]) before bucketing.
struct ZebraSample {
    double u;
    double v;
    std::uint32_t stripeIndex;
    double normalAngle;
};

// Per-sample curvature comb entry. `position3d` is the point on the
// edge at the sampled parameter, `combTip3d = position + curvature *
// combScale * normal` (normal is the curve's frenet normal, oriented to
// match the curvature radius).
struct CurvatureCombSample {
    double u;                       // curve parameter
    std::array<double, 3> position3d;
    std::array<double, 3> combTip3d;
    double curvature;               // signed curvature at u
};

// Continuity report between two faces along a shared edge. Each metric
// is the maximum over the sampled points along the edge:
//   g0_max_mm   = max ||p_A - p_B||                       (position gap)
//   g1_max_deg  = max angle between surface normals       (tangent dev)
//   g2_max_pct  = max |kA - kB| / max(|kA|, |kB|, eps)    (curvature)
//   g3_max_pct  = max torsion difference                  (osculating)
// `g3_continuity` is set when g0 < 1e-3 && g1 < 1.0 && g2 < 0.05.
struct ContinuityReport {
    double g0_max_mm;
    double g1_max_deg;
    double g2_max_pct;
    double g3_max_pct;
    bool   g3_continuity;
    std::uint32_t samples;
};

// Per-UV principal curvatures.
struct CurvatureSample {
    double u;
    double v;
    double K_gaussian;
    double H_mean;
    double kappaMax;
    double kappaMin;
};

// G2 sew result. `handle` is the sewn shell registered in
// ShapeRegistry, `reports` is per-shared-edge continuity (only filled
// when reportContinuity == true). `edgeCount` is the # of shared edges
// the report iterated over.
struct StitchReport {
    ShapeHandle handle;
    std::uint32_t edgeCount;
    std::vector<ContinuityReport> reports;
};

// ---------- public API ---------------------------------------------------

// Zebra-stripe analysis. Samples the face on a uSamples × vSamples grid
// (default 32×32). For each sample, evaluates the surface normal via
// BRepLProp_SLProps, projects it onto the plane perpendicular to
// `lightDir` (lightDir is normalised internally), takes the angle of
// the projection in that plane, and buckets the angle into stripeCount
// evenly-spaced bands over [-pi, pi]. Returns one sample per UV.
std::vector<ZebraSample> zebraStripes(ShapeHandle face,
                                      std::uint32_t stripeCount,
                                      double lightDirX,
                                      double lightDirY,
                                      double lightDirZ,
                                      std::uint32_t uSamples = 32,
                                      std::uint32_t vSamples = 32);

// Curvature comb along an edge. Samples the edge at `samples` evenly
// spaced parameters, computes curvature via BRepLProp_CLProps, and
// returns per-sample {position, combTip = position + kappa * combScale
// * normal}. The normal is taken from the curve's local frenet frame.
// `samples` must be >= 2.
std::vector<CurvatureCombSample> curvatureComb(ShapeHandle edge,
                                               std::uint32_t samples,
                                               double combScale);

// G0/G1/G2/G3 continuity check between two faces along a shared edge.
// Samples the edge at `samples` parameters; on each sample, projects
// the point onto both surfaces (UV via GeomAPI_ProjectPointOnSurf),
// evaluates position / tangent / normal / curvature on each face via
// BRepLProp_SLProps, and accumulates the worst-case G0..G3 metrics.
ContinuityReport continuityCheck(ShapeHandle face1, ShapeHandle face2,
                                 ShapeHandle sharedEdge,
                                 std::uint32_t samples = 32);

// Per-UV Gaussian + mean curvature, plus principal curvatures
// kappaMax/kappaMin. Real values via GeomLProp_SLProps.
std::vector<CurvatureSample> gaussianAndMeanCurvature(ShapeHandle face,
                                                      std::uint32_t uSamples,
                                                      std::uint32_t vSamples);

// G2 sew. Runs BRepBuilderAPI_Sewing over the supplied faces, then
// (when reportContinuity == true) discovers shared edges in the sewn
// shell and runs continuityCheck on each adjacent face pair.
StitchReport stitchG2(const std::vector<ShapeHandle>& faces,
                      double tolerance = 1e-3,
                      bool reportContinuity = true);

// Sweep with guide curves. Drives BRepOffsetAPI_MakePipeShell with the
// profile + spine + N guides (each guide added via SetMode(guide,
// CurvilinearEquivalence)). When isFrenet == true a Frenet-frame mode
// is set on the spine first. When isSolid == true and the swept result
// is closed, MakeSolid() is called.
ShapeHandle sweepWithGuides(ShapeHandle profileWire,
                            ShapeHandle spineCurve,
                            const std::vector<ShapeHandle>& guideCurves,
                            bool isFrenet = false,
                            bool isSolid  = false);

}}  // namespace forge::classa
