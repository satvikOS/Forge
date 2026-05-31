#pragma once

// Weldments (Forge-24) — structural members, end caps, gussets, weld beads.
//
// A weldment is a tree of structural members (extruded profiles swept along
// a path) plus secondary parts (caps, gussets, beads). Each member carries
// metadata (profile kind, dimensions, length, alignment) that the cut-list
// aggregator reads back to produce a BOM.
//
// Like SheetMetal, weldments live in a small registry keyed by ShapeHandle.
// `structuralMember` returns a fused TopoDS_Shape; the JS layer treats the
// handle as the "weldment root". Subsequent operations (endCap / gusset /
// weldBead / trimMember) re-use the same root handle and update the
// metadata so cutList can walk every member.
//
// SCOPE / LIMITATIONS
// -------------------
//   * `structuralMember`: straight-path members are modelled by extruding
//     the profile face along the path's bounding direction. Curved paths
//     (arcs, splines) fall back to a single linear segment that joins the
//     path's endpoints; a follow-up will replace this with
//     BRepOffsetAPI_MakePipeShell.
//   * `trimMember`: butt mode does nothing (members butt by default in our
//     straight-path approximation). Miter and coped modes record the trim
//     in the member metadata; the JS layer can use that to drive
//     downstream documentation (cut list now also reports miter angle).
//   * `weldBead`: modelled as a thin fillet brick at the joint — enough for
//     visualisation and for the cut list bead-length accounting.

#include "forge/ShapeRegistry.hpp"

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace forge::weld {

enum class ProfileKind : std::uint32_t {
    IBeam     = 0,
    CBeam     = 1,
    RectTube  = 2,
    RoundTube = 3,
    Angle     = 4,
    Channel   = 5,
    FlatBar   = 6,
};

enum class Alignment : std::uint32_t {
    Centroid  = 0,
    TopLeft   = 1,
    TopRight  = 2,
    BottomLeft= 3,
    BottomRight=4,
    MidLeft   = 5,
    MidRight  = 6,
    TopCenter = 7,
    BottomCenter=8,
};

enum class TrimMode : std::uint32_t { Butt = 0, Miter = 1, Coped = 2 };
enum class BeadKind : std::uint32_t { Fillet = 0, SquareGroove = 1, VGroove = 2 };

struct StructuralProfile {
    ProfileKind kind = ProfileKind::RectTube;
    // Dimension map. Required keys per kind:
    //   IBeam     : w (flange width), h (depth), tw (web thickness), tf (flange thickness)
    //   CBeam     : w, h, tw, tf
    //   RectTube  : w (outer width), h (outer height), t (wall thickness)
    //   RoundTube : d (outer diameter), t (wall thickness)
    //   Angle     : w (leg1), h (leg2), t (leg thickness)
    //   Channel   : w, h, t
    //   FlatBar   : w, t
    std::map<std::string, double> dims;
    std::string name;  // optional cosmetic name (e.g. "HSS-50x50x3").
};

// Member metadata — what cutList reports per member.
struct MemberRecord {
    std::uint32_t       memberId    = 0;
    std::string         profileName;
    double              length      = 0.0;   // mm
    std::uint32_t       qty         = 1;
    double              weight      = 0.0;   // kg (estimated; rho*area*length)
    TrimMode            trim        = TrimMode::Butt;
    double              miterDeg    = 0.0;   // populated when trim != Butt
};

struct WeldmentRoot {
    ShapeHandle handle = kInvalidHandle;
    std::vector<MemberRecord> members;
};

class WeldmentRegistry {
public:
    static WeldmentRegistry& instance();
    WeldmentRoot&       get(ShapeHandle h);
    const WeldmentRoot& cget(ShapeHandle h) const;
    bool                has(ShapeHandle h) const;
    void                attach(ShapeHandle h, WeldmentRoot r);
    std::size_t         size() const;

private:
    WeldmentRegistry() = default;
    std::vector<std::pair<ShapeHandle, WeldmentRoot>> roots_;
};

// ----- API -----

// Helper: build a single line edge as a path seed for structuralMember.
// Returned as a ShapeHandle to a TopoDS_Edge.
ShapeHandle makePathEdge(double x0, double y0, double z0,
                         double x1, double y1, double z1);

// Sweep `profile` along the path's straight-segment approximation. Returns
// a new shape and registers a MemberRecord. The path is any TopoDS_Shape
// whose first WIRE / EDGE defines the centerline.
ShapeHandle structuralMember(ShapeHandle pathSketchHandle,
                             const StructuralProfile& profile,
                             Alignment alignment);

// Cap a tube end. Modelled as a small plate fused at the picked edge.
ShapeHandle endCap(ShapeHandle shape,
                   std::uint32_t openingEdgeId,
                   double capThickness,
                   double offsetMm);

// Triangular reinforcement at a joint vertex.
ShapeHandle gusset(ShapeHandle shape,
                   std::uint32_t vertexId,
                   double gussetSize,
                   double thickness);

// Add a weld bead along the given edges.
ShapeHandle weldBead(ShapeHandle shape,
                     const std::vector<std::uint32_t>& edgeIds,
                     double beadSize,
                     BeadKind beadKind);

// Trim one member against another.
ShapeHandle trimMember(ShapeHandle memberA,
                       ShapeHandle memberB,
                       TrimMode mode);

// Aggregate the BOM. Returns a copy so the JS layer can safely transform it.
std::vector<MemberRecord> cutList(ShapeHandle weldmentRoot);

} // namespace forge::weld
