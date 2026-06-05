#pragma once

// PUSH-08 — forge::mold (draft / parting / cavity-core / cooling / runner)
//
// Tooling-side mould design helpers built on raw OCCT 7.9.3 topology.
// These complement the existing forge::mold::heleShawFill (Forge-172 flow
// simulation) by addressing the upstream geometric problem of getting a
// real cavity / core block + cooling channels + runner system out of a
// finished part body.
//
//   1. analyseDraft(part, pullDir, draftThreshDeg) — face-by-face draft
//      analysis. Sample each face's surface normal at its centroid via
//      BRepGProp_Face::Normal, take the angle versus pullDir using
//      gp_Dir::Angle(), and classify:
//        * positive (mould can release)        normal·pullDir > sin(thresh)
//        * negative (needs side-action)         normal·pullDir < -sin(thresh)
//        * vertical (sliver / parting candidate) angle in [90°-thresh, 90°+thresh]
//
//   2. computeParting(part, pullDir) — find silhouette edges where the
//      face normal flips sign relative to pullDir (the two faces sharing
//      the edge have opposite-sign dot products with pullDir). Stitch the
//      silhouette edges into closed wire(s) via BRepBuilderAPI_MakeWire,
//      then extrude the wire outward perpendicular to pullDir as the
//      parting surface using BRepPrimAPI_MakePrism.
//
//   3. splitCavityCore(moldBlock, part, partingSurface) — split a rough
//      mould block by the parting surface (BRepAlgoAPI_Splitter), subtract
//      the part from each half (BRepAlgoAPI_Cut), then classify the two
//      halves as cavity (upper, higher centroid Z) versus core (lower).
//
//   4. insertCoolingChannels(moldBlock, channels) — drill straight
//      cylindrical bores through the mould block. Each channel is a
//      (start, end, diameter) tuple. The cylinder axis is built from
//      gp_Ax2(start, gp_Dir(end - start)), and the resulting solid is
//      cut from the block via BRepAlgoAPI_Cut.
//
//   5. buildRunnerSystem(sprueTop, gateEntries, sprueDia, runnerDia, gateDia)
//      — build the sprue + runners + gates that deliver melt from the
//      injection nozzle into each cavity entry point.
//        * sprue: tapered cone (BRepPrimAPI_MakeCone) sprueDia at top,
//          70% of sprueDia at bottom, length sprueDia * 8 (industry
//          conventional 1:8 aspect)
//        * runner: cylinder from sprue bottom centre to each gate entry
//        * gate: short cylinder (length runnerDia, dia gateDia) at the
//          cavity inlet, axially aligned with its runner
//
// All inputs and outputs are raw OCCT topology — the N-API binding
// wraps these in ShapeRegistry handles.

#include <vector>

#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

namespace forge::mold {

// ---------------------------------------------------------------- draft

struct DraftFace {
    TopoDS_Face face;
    double      angleDeg;     // angle of face normal vs pullDir, [0, 180]
    bool        isPositive;   // can release upward (normal·pull > sin(thresh))
    bool        isNegative;   // needs side action (normal·pull < -sin(thresh))
    bool        isVertical;   // sliver (angle within [90-thresh, 90+thresh])
};

// Returns one DraftFace per TopoDS_Face in `part`. Face centroids are taken
// from BRepGProp::SurfaceProperties; surface normals from BRepGProp_Face::
// Normal at the parametric centroid (corrected for face orientation).
std::vector<DraftFace> analyseDraft(const TopoDS_Shape& part,
                                    const gp_Dir&       pullDir,
                                    double              draftThresholdDeg);

// ---------------------------------------------------------------- parting

struct PartingResult {
    std::vector<TopoDS_Edge> partingLines;   // silhouette edges
    TopoDS_Shape             partingSurface; // extruded patch (TopoDS_Shape)
};

// Detect silhouette edges where the two adjacent faces flip sign vs
// pullDir; build a wire from those edges (BRepBuilderAPI_MakeWire) and
// extrude it perpendicular to pullDir to produce the parting surface.
PartingResult computeParting(const TopoDS_Shape& part,
                             const gp_Dir&       pullDir);

// ---------------------------------------------------------------- cavity / core

struct CavityCoreResult {
    TopoDS_Shape cavity;   // upper half (higher centroid Z) with part cut
    TopoDS_Shape core;     // lower half (lower centroid Z)  with part cut
};

// Split `moldBlock` by `partingSurface` using BRepAlgoAPI_Splitter, subtract
// `part` from each resulting half via BRepAlgoAPI_Cut. The half with the
// higher Z centroid is returned as the cavity, the other as the core.
CavityCoreResult splitCavityCore(const TopoDS_Shape& moldBlock,
                                 const TopoDS_Shape& part,
                                 const TopoDS_Shape& partingSurface);

// ---------------------------------------------------------------- cooling

struct CoolingChannel {
    gp_Pnt start;
    gp_Pnt end;
    double diameter;
};

// Drill cylindrical channels through `moldBlock`. Each channel becomes a
// BRepPrimAPI_MakeCylinder built from gp_Ax2(start, end-start), then
// BRepAlgoAPI_Cut'd from the block in sequence.
TopoDS_Shape insertCoolingChannels(const TopoDS_Shape&                moldBlock,
                                   const std::vector<CoolingChannel>& channels);

// ---------------------------------------------------------------- runner

struct RunnerSystem {
    TopoDS_Shape              sprue;    // tapered vertical cone
    std::vector<TopoDS_Shape> runners;  // cylinders sprue-bottom -> gates
    std::vector<TopoDS_Shape> gates;    // short small cylinders at gate entries
};

// Build the melt-delivery hardware. sprue is a tapered downward cone
// (sprueDia at top, 70% at bottom), runners are cylinders from sprue
// bottom centre to each gate entry, gates are short cylinders at the
// cavity inlets.
RunnerSystem buildRunnerSystem(const gp_Pnt&              sprueTop,
                               const std::vector<gp_Pnt>& gateEntries,
                               double                     sprueDia,
                               double                     runnerDia,
                               double                     gateDia);

} // namespace forge::mold
