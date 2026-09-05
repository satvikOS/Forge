// forge/OcctPipeSweep.hpp — TKOffset-free analytic pipe sweep along a POLYLINE spine.
//
// The in-house replacement for BRepOffsetAPI_MakePipe (TKOffset family E) for the
// case every in-tree caller actually builds: a profile FACE swept along a spine that
// is a chain of straight segments (BRepBuilderAPI_MakePolygon). Built DIRECTLY on the
// surviving modeling toolkits — occtPrism's Geom_SurfaceOfLinearExtrusion laterals
// (TKG3d) + BRepBuilderAPI sewing (TKBRep/TKTopAlgo) + the boolean engine (TKBO,
// already in the closure) — so NO BRepOffsetAPI symbol is referenced.
//
// EXACTNESS / NO FACETING. Every emitted surface is analytic: each segment is an
// occtPrism of the exact profile face (a circular profile yields a true
// Geom_CylindricalSurface-equivalent surface-of-linear-extrusion of the exact circle,
// NOT a polygonised tube), and the corner joints are exact boolean unions of those
// analytic solids. Nothing is tessellated at any point.
//
// GEOMETRY. Segment i is the profile prism from spine[i] to spine[i+1]. The profile is
// carried between segments by the discrete rotation-minimising frame (the minimal
// rotation taking d[i-1] to d[i]), so a non-symmetric profile does not spuriously
// twist. The union of consecutive prisms is the standard sharp-corner ("mitred elbow")
// pipe: for two equal circular legs meeting at a corner the two lateral cylinders
// intersect exactly on the bisector planes, so the union boundary IS the miter.
//
// WHY THIS EXISTS BEYOND THE SYMBOL COUNT — a correctness fix, measured 2026-08-01.
// OCCT's BRepOffsetAPI_MakePipe silently produces a CORRUPT solid on a C0 (polyline)
// spine: past the first bend the body does not exist. Measured on the live kernel,
// pipeFromPolyline([0,0,0, 10,0,0, 10,40,0], r=2):
//     MakePipe  volume 125.664  (== leg 1 alone; closed form for the elbow is 617.652)
//     MakePipe  Ixx = -2259     (NEGATIVE — impossible for a real solid)
//     MakePipe  leg-2 lateral face comes back kind "other" — NOT a canonical analytic
//               surface (definitively not a B-spline: faceInventory reports those as
//               "bspline"), area 321.9 vs the true 502.7, and unmeshable:
//               "[K5] 1/4 faces DEFERRED (no BRepMesh — unresolvable trim)"
//     common(pipe, unit box at (10,20,0) — solidly inside leg 2) == 0.0 volume
// while BRepCheck still reports valid:true, faultyCount:0. This routine returns
// 617.6519 for that case, matching the closed form pi*r^2*(L1+L2) - 4r^3/3 to 4 dp,
// with an all-analytic 2-cylinder + 4-plane B-rep and positive inertia.
//
// HONEST LIMITS (throw — never a fake result):
//   * fewer than 2 distinct spine points, or a null / non-FACE profile.
//   * a 180-degree reversal between consecutive segments: the transport rotation axis
//     is undefined and the swept body would self-overlap.
//   * a boolean union that fails to produce a solid.
// A CURVED spine is NOT handled here and must not be routed to this function — see
// occtPipeSpineIsPolyline(). Discretising a curved spine to reach this path would be
// faceting and is forbidden.
#pragma once

#include <vector>

#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>

namespace forge {

// True iff every edge of `spine` is a straight line — i.e. the spine is a polyline
// and occtPipePolyline can reproduce MakePipe's intent exactly. A wire containing any
// arc / circle / spline edge returns false, and the caller MUST keep using OCCT: the
// only way to force such a spine through this builder would be to sample it into
// segments, which is faceting.
bool occtPipeSpineIsPolyline(const TopoDS_Wire& spine);

// Ordered vertices of a polyline `spine` wire (consecutive duplicates dropped).
// Empty if the wire is not a connected polyline chain.
std::vector<gp_Pnt> occtPipeSpinePoints(const TopoDS_Wire& spine);

// Sweep `profileFace` (positioned at spine[0], its plane normal to the first segment)
// along the polyline `spine`, returning a closed analytic TopoDS_Solid.
TopoDS_Shape occtPipePolyline(const TopoDS_Shape& profileFace,
                              const std::vector<gp_Pnt>& spine);

}  // namespace forge
