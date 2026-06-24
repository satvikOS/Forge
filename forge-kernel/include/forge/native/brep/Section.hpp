// forge/native/brep/Section.hpp
//
// PLANAR SECTION / CUT VIEW of a native B-rep Solid — the in-house analog of
// OCCT BRepAlgoAPI_Section (section curves) + a section-fill that returns the
// FILLED cross-section (the material region of the cutting plane inside the
// solid) together with its planar SECTION PROPERTIES (area + centroid), the
// numbers a beam / structural-section analysis consumes.
//
// ============================ HONESTY (Bible §0/§9) ========================
// This module intersects a closed brep::Solid (Topology.hpp / Surface.hpp,
// every face carrying an analytic quadric or a planar surface) with an
// arbitrary cutting PLANE and returns:
//
//   (a) the SECTION CURVES — the closed wires where the plane cuts the faces.
//       Each face is intersected with the plane and the result is clipped to
//       that face's extent, producing one chord/arc per cut face; the chords
//       are stitched (shared section vertices welded within tol) into closed
//       oriented WIRES. The section vertices are placed EXACTLY: for a planar
//       face the chord endpoints are the exact plane∩edge crossings; for a
//       quadric face the analytic plane∩surface intersection (SurfaceIntersect)
//       is sampled and clipped, so a transverse cylinder cut's wire is the true
//       circle (sampled densely), not a low-res chord polygon.
//
//   (b) the FILLED CROSS-SECTION — the planar region bounded by those wires,
//       i.e. the material the plane passes through, with:
//         * area     — the enclosed planar area (Green's theorem on the wires
//                      in the cut-plane frame; EXACT for straight-edged wires;
//                      for a wire flagged circular the exact π R² / annulus form
//                      is used instead of the chord-polygon underestimate),
//         * centroid — the area centroid (first moment / area), a 3D point in
//                      the cutting plane.
//
// What is in SCOPE (validated by section_test.cpp):
//   * planar cut of solids whose every face is a PLANE or a QUADRIC the
//     analytic SurfaceIntersect handles exactly (plane / cylinder / cone /
//     sphere). Box mid-cut, cylinder axial cut (rectangle), cylinder transverse
//     cut (circle), hollow tube transverse cut (annulus).
//
// What is explicitly TARGETED / FOLLOW-UP (NOT claimed here):
//   * FREEFORM (general trimmed-NURBS) face section curves — the SSI for a
//     general NURBS face is deferred (NurbsSurfaceIntersect owns that), so a
//     freeform-face solid's section is handed back ok=false honestly.
//   * NON-PLANAR cut surfaces (a curved cut) — only a flat plane is supported.
//   * Self-touching / non-manifold sections (a plane grazing along a whole
//     face) are reported honestly rather than faked into a wire.
//
// Pure C++20, ZERO external deps (stdlib + existing forge native brep headers).
// No OCCT, no WASM. CONVENTIONS: namespace forge::native::brep.

#ifndef FORGE_NATIVE_BREP_SECTION_HPP
#define FORGE_NATIVE_BREP_SECTION_HPP

#include <cstddef>
#include <vector>

#include "forge/native/brep/Surface.hpp"    // Surface, Vec3, vadd/vsub/...
#include "forge/native/brep/Topology.hpp"   // Solid, Face, ...

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// SectionPlane — the cutting plane: a point on the plane + a unit normal.
// ---------------------------------------------------------------------------
struct SectionPlane {
    Vec3 point{0, 0, 0};   // any point on the plane
    Vec3 normal{0, 0, 1};  // plane normal (need not be unit; normalised on use)
};

// ---------------------------------------------------------------------------
// SectionWire — one closed loop of the section, as an ordered 3D polyline lying
// in the cutting plane. `closed` is always true for a valid section wire (an
// open chain is a defect, reported via SectionResult::ok=false). `area` is the
// SIGNED planar area of this wire in the cut-plane CCW frame (about +normal);
// an outer (material) loop is positive, an inner (hole) loop is negative.
// `circular`/`circleRadius`/`circleCentre` are set when the wire was emitted
// from a single analytic CIRCLE (a transverse quadric cut), so the consumer /
// the area integral can use the exact π R² instead of the sampled polygon.
// ---------------------------------------------------------------------------
struct SectionWire {
    std::vector<Vec3> points;   // ordered, closed (last connects back to first)
    bool   closed = true;
    double area = 0.0;          // signed planar area (cut-plane CCW frame)

    bool   circular = false;    // emitted from an exact analytic circle
    double circleRadius = 0.0;
    Vec3   circleCentre{0, 0, 0};
};

// ---------------------------------------------------------------------------
// SectionResult — the full planar-section output.
//   * `wires`         : every closed section wire (outer loops + hole loops).
//   * `area`          : the FILLED cross-section area (material region) — the
//                       sum of the absolute outer-loop areas minus the holes,
//                       i.e. the net enclosed material the plane passes through.
//   * `centroid`      : the area centroid of that filled region (3D, in plane).
//   * `numWires`      : wires.size().
// ---------------------------------------------------------------------------
struct SectionResult {
    bool ok = false;
    const char* reason = "";

    std::vector<SectionWire> wires;
    std::size_t numWires = 0;

    double area = 0.0;            // net filled cross-section area (>= 0)
    Vec3   centroid{0, 0, 0};     // area centroid of the filled region (3D)
    double perimeter = 0.0;       // total wire length

    // The cut-plane frame actually used (unit). origin == the projection of the
    // solid's reference onto the plane; (uDir,vDir) span the plane, normal = uxv.
    Vec3 planeOrigin{0, 0, 0};
    Vec3 planeNormal{0, 0, 1};
    Vec3 uDir{1, 0, 0};
    Vec3 vDir{0, 1, 0};
};

// ---------------------------------------------------------------------------
// SectionOptions — tolerances / sampling.
// ---------------------------------------------------------------------------
struct SectionOptions {
    // Model-space distance under which two section vertices are welded into one
    // (the chord-stitching tolerance, scaled by the solid extent on use).
    double weldTol = 1e-7;

    // Number of points used to densely sample an analytic CIRCLE / arc segment
    // contributed by a quadric face (more => the sampled wire perimeter is
    // closer to the analytic; the AREA of a `circular` wire is exact regardless).
    int circleSamples = 256;
};

// ===========================================================================
// THE SECTION OP
// ===========================================================================
//
// Section the closed `solid` by `plane`. Returns the closed section wires, the
// filled cross-section area + centroid, and the cut-plane frame. `ok` is false
// (reason set) when the solid has a face the analytic section cannot handle
// (a general NURBS face), or the section is degenerate / non-manifold at the
// plane. An empty section (plane misses the solid) is ok=true with no wires.
SectionResult sectionSolid(const Solid& solid,
                           const SectionPlane& plane,
                           const SectionOptions& opt = {});

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_SECTION_HPP
