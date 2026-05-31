#pragma once

// Forge-22 — Native part features.
//
// Every function here returns a fresh ShapeHandle (no in-place mutation of
// the input). Face/edge ids passed in from JS are 0-based indices into the
// shape's TopExp_Explorer(TopAbs_FACE / TopAbs_EDGE) traversal order; the
// ordering is deterministic for a given TopoDS_Shape so JS callers can
// derive ids from the same enumeration.
//
// All functions throw std::invalid_argument or std::runtime_error on bad
// inputs (zero distance, missing face id, non-planar profile, …). The
// safe() wrapper in binding.cpp converts those to JS Errors so the
// renderer can catch them uniformly.

#include <array>
#include <cstdint>
#include <vector>

#include "forge/ShapeRegistry.hpp"
#include "forge/Sketcher.hpp"

namespace forge { namespace part {

// ---------- profile-driven solids -----------------------------------------
ShapeHandle extrudeProfile(SketchHandle sketch, double distance,
                           double dirX, double dirY, double dirZ);

ShapeHandle revolveProfile(SketchHandle sketch,
                           double ox, double oy, double oz,
                           double dx, double dy, double dz,
                           double angleRad);

// `pathSketch`'s first wire is used as the spine. When withGuides is true
// every other wire in `sketch` after the first profile becomes a guide;
// otherwise the simpler MakePipe API is used.
ShapeHandle sweep(SketchHandle profileSketch, SketchHandle pathSketch,
                  bool withGuides);

// `sections` is a list of SketchHandles whose first wire becomes a
// cross-section. `guides` (optional) supplies guide curves taken from the
// first wire of each guide sketch.
ShapeHandle loft(const std::vector<SketchHandle>& sections,
                 const std::vector<SketchHandle>& guides,
                 bool ruled, bool closed);

// ---------- thick / shelled / filleted bodies -----------------------------
struct FaceThickness {
    std::uint32_t faceId;
    double        thickness;
};

ShapeHandle shell(ShapeHandle shape,
                  const std::vector<std::uint32_t>& faceIdsToRemove,
                  double thickness,
                  const std::vector<FaceThickness>& multiThickness);

ShapeHandle filletEdges(ShapeHandle shape,
                        const std::vector<std::uint32_t>& edgeIds,
                        double radius);

struct VariableRadiusAnchor {
    double u;  // parameter along edge in [0,1]
    double r;  // radius at this u
};

ShapeHandle variableFilletEdge(ShapeHandle shape, std::uint32_t edgeId,
                               const std::vector<VariableRadiusAnchor>& anchors);

// distance2 < 0 means symmetric chamfer (use `distance` on both sides).
ShapeHandle chamferEdges(ShapeHandle shape,
                         const std::vector<std::uint32_t>& edgeIds,
                         double distance, double distance2);

struct DraftPlane {
    double ox, oy, oz;
    double nx, ny, nz;
};

ShapeHandle draftFaces(ShapeHandle shape, const DraftPlane& neutral,
                       const std::vector<std::uint32_t>& faceIds,
                       double angleRad);

// ---------- hole wizard ---------------------------------------------------
//
// `kind`: 0 = simple, 1 = counterbore, 2 = countersink, 3 = tapped.
// `spec` fields used:
//   diameter       — through-hole diameter (all kinds)
//   depth          — through-hole depth (all kinds)
//   headDiameter   — counterbore/countersink head diameter
//   headDepth      — counterbore depth (countersink ignores; uses angle)
//   headAngle      — countersink angle (rad) — 0 ⇒ default 90°
//   tappedPitch    — tapped pitch metadata (stored on result, no geometry change)
//
// The result Shape's metadata (recorded in JS via PartOps) carries the
// hole kind + spec so drawings can call it out.
struct HoleSpec {
    double diameter;
    double depth;
    double headDiameter;
    double headDepth;
    double headAngle;
    double tappedPitch;
};

ShapeHandle holeWizard(ShapeHandle shape,
                       double px, double py, double pz,
                       double ax, double ay, double az,
                       std::uint32_t kind,
                       const HoleSpec& spec);

// ---------- rib + patterns ------------------------------------------------
ShapeHandle rib(SketchHandle profileSketch, double depth, double thickness,
                std::uint32_t neutralFaceId);

ShapeHandle linearPattern(ShapeHandle shape, std::uint32_t count,
                          double dx, double dy, double dz);

ShapeHandle circularPattern(ShapeHandle shape, std::uint32_t count,
                            double ox, double oy, double oz,
                            double ax, double ay, double az,
                            double totalAngleRad);

ShapeHandle mirrorPattern(ShapeHandle shape,
                          double ox, double oy, double oz,
                          double nx, double ny, double nz);

ShapeHandle onCurvePattern(ShapeHandle shape, SketchHandle pathSketch,
                           std::uint32_t count);

}}  // namespace forge::part
