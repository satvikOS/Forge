// forge/native/brep/Query.hpp
//
// Geometric QUERIES on the in-house Forge native B-rep Solid (the OCCT-free
// kernel, KERNEL_INHOUSE_ROADMAP Stage 6 brep/). This is the native analogue of
// OCCT's BRepExtrema_DistShapeShape (minimum distance / clearance) and
// BRepClass3d_SolidClassifier (point-in-solid classification):
//
//   (1) minDistance(solidA, solidB)
//       The minimum gap (CLEARANCE) between the BOUNDARIES of two solids, plus
//       the closest-point pair realising it. Two evaluation paths:
//         * ANALYTIC closed form for the canonical quadric primitive pairs
//           (sphere-sphere, sphere-plane-cap-free sphere-vs-box, box-vs-box on
//           their analytic faces, etc.) — exact to round-off, e.g. two spheres
//           with centres D apart and radii r1,r2 give gap = D - r1 - r2 exactly.
//         * TESSELLATED-BOUNDARY fallback otherwise: the two solids' watertight
//           boundary triangle meshes (SolidTessellate) are taken and the minimum
//           triangle-pair distance (vertex / edge / face nearest point) is
//           computed. The result converges to the true boundary distance as the
//           faceting refines; for the canonical primitives the analytic path is
//           preferred so curved-curved closest points stay exact.
//       Returns 0 (or a negative penetration estimate) when the solids touch or
//       overlap.
//
//   (2) pointInSolid(solid, p)
//       Classify a point as INSIDE / OUTSIDE / ON the solid by an EVEN-ODD ray
//       cast against the watertight boundary triangles. Several jittered ray
//       directions are cast and the MAJORITY crossing parity is taken (the
//       standard robust even-odd guard against a ray grazing a shared edge or
//       vertex), so the in/out answer is stable. ON is reported when the point
//       lies within `onTol` of any boundary triangle.
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL algorithms only, pure C++20 + stdlib + existing forge native headers
// (Topology / Surface / SolidTessellate / Predicates). No OCCT, no WASM, no new
// deps. ADDITIVE: a brand-new header + TU; the native build / binding / gate are
// untouched.
//
// HONEST SCOPE: the analytic minimum-distance path covers the elementary quadric
// pairs that have a closed form (sphere-sphere, sphere-vs-box, box-vs-box). Any
// other pair (cone, torus, NURBS skin, curved-vs-curved that is not a quadric
// special case) routes to the TESSELLATED-boundary distance, whose error is the
// faceting chord error — refinable by raising the primitive nSeg/nBand, NOT a
// closed-form curved-curved minimisation. That exact curved-curved nearest-point
// solve is explicitly TARGETED (a later refinement). The point-in-solid even-odd
// ray cast classifies against the watertight triangulated shell it is given; the
// jittered-ray majority guard makes the parity robust to grazing edge/vertex
// hits.

#ifndef FORGE_NATIVE_BREP_QUERY_HPP
#define FORGE_NATIVE_BREP_QUERY_HPP

#include "forge/native/brep/Surface.hpp"    // Vec3 + vadd/vsub/... helpers
#include "forge/native/brep/Topology.hpp"   // Solid

#include <string>
#include <vector>

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// (1) MINIMUM DISTANCE / CLEARANCE
// ---------------------------------------------------------------------------

// How the reported minimum distance was obtained.
enum class DistanceMethod {
    Analytic,     // closed-form quadric/box result (exact to round-off)
    Tessellated   // min triangle-pair distance over the boundary meshes
};

struct MinDistanceResult {
    bool   ok = false;          // false only on an empty / invalid solid
    double distance = 0.0;      // minimum gap (clearance); 0 if touching,
                                // negative => estimated penetration depth
    bool   overlapping = false; // true when the boundaries touch / interpenetrate
    Vec3   pointA{};            // closest point on solid A's boundary
    Vec3   pointB{};            // closest point on solid B's boundary
    DistanceMethod method = DistanceMethod::Tessellated;
    const char* reason = "";
};

// Minimum distance between the BOUNDARIES of two solids (clearance). Uses the
// analytic closed form for the canonical quadric/box pairs (exact), otherwise the
// tessellated-boundary minimum triangle-pair distance. `tessTol` welds coincident
// tessellation vertices. When the solids overlap, `distance` is 0 (boundaries
// touch) or a negative penetration estimate and `overlapping` is set.
MinDistanceResult minDistance(const Solid& a, const Solid& b,
                              double tessTol = 1e-9);

// ---------------------------------------------------------------------------
// (2) POINT-IN-SOLID CLASSIFICATION
// ---------------------------------------------------------------------------

enum class PointClass {
    Inside,
    Outside,
    On
};

// Classify `p` against the solid's boundary by an even-odd +X ray cast over the
// triangulated boundary shell. ON is reported when `p` is within `onTol`
// (model-space units) of a boundary triangle. The crossing parity is taken from
// the robust orient3d predicate so the in/out decision is stable away from ON.
PointClass pointInSolid(const Solid& solid, const Vec3& p,
                        double onTol = 1e-9, double tessTol = 1e-9);

// ---------------------------------------------------------------------------
// (3) ANALYTIC FACE INVENTORY — the native G1 face-identity query
// ---------------------------------------------------------------------------
// The native builders emit each smooth analytic surface as N angular STRIP faces
// that all share ONE Surface object (buildCone/buildSphere "Shared analytic
// surface"). Grouping the strip faces by that Surface identity reports the solid's
// CANONICAL analytic faces (a cylinder = 3: lateral + two caps), matching OCCT's
// faceInventory WITHOUT OCCT and without changing topology. Two distinct planar
// faces have distinct Surface objects, so the box still reports 6.
struct AnalyticFaceInfo {
    std::string kind;          // plane|cylinder|cone|sphere|torus|other
    double radius = 0.0;       // cyl/sphere radius, cone base r, torus major R
    double minorRadius = 0.0;  // cone top r, torus minor r
    Vec3   origin{};           // a point on the axis / on the plane
    Vec3   axis{};             // surface axis (cyl/cone/torus) or plane normal
    double area = 0.0;         // summed strip-face area (chordal for curved faces)
    Vec3   centroid{};         // area-weighted centroid of the merged strips
    int    stripFaceCount = 0; // underlying strip faces merged into this one
};

std::vector<AnalyticFaceInfo> analyticFaceInventory(const Solid& solid);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_QUERY_HPP
