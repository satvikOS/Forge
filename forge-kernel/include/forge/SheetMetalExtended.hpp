#pragma once

// PUSH-06 — forge::sheetextend
//
// Extends the Forge sheet-metal module toward SolidWorks parity:
//
//   1. gaugeProperties(material, gauge) → {thickness_mm, density_kgPerM3,
//      kFactor_default} using real SAE / ASTM gauge thicknesses (steel
//      cold-rolled 7..22 ga and aluminium 5052-H32 nominal 0.025"..0.125").
//
//   2. bendAllowance(angleDeg, R, t, K) returning
//        BA = (π/180) · θ · (R + K · t)
//        BD = 2 · (R + t) · tan(θ/2) − BA
//
//   3. flatten(solidPart, bends) — multi-bend BRep unfold. Walks the bend
//      list in order; for each bend the downstream face group (everything on
//      the +outward side of the bend axis at z = thickness) is rotated by
//      -θ around the bend axis using gp_Trsf + BRepBuilderAPI_Transform.
//      Returns a flat planar TopoDS_Shape.
//
//   4. exportDxf(flatShape, filePath) — writes a real DXF (SECTION/HEADER +
//      SECTION/TABLES/LAYER + SECTION/ENTITIES with LINE/LWPOLYLINE/ARC
//      entities for the outer boundary, hole loops, and bend lines on
//      distinct layers/colours). Returns the absolute bytes written.
//
//   5. cornerRelief(bentPart, reliefWidth, reliefDepth, type) — does a real
//      OCCT BRepAlgoAPI_Cut at every recorded bend endpoint with the chosen
//      relief geometry (round / rectangular / tear-drop). Returns the new
//      ShapeHandle.
//
//   6. cost(flatPart, pricePerKgUSD, laserCutSpeedMmPerS, pierceCount)
//      returns { mass_kg, cutTime_s, totalUSD } from the BRep volume,
//      gauge density, and laser perimeter from BRepGProp.
//
// All inputs and outputs are concrete numbers / handles / strings — no
// stub paths, no fallback returns. Missing data throws std::invalid_argument
// which the binding layer surfaces as a JS Error via safe().

#include "forge/ShapeRegistry.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace forge::sheetextend {

// ---------------------------------------------------------------- gauges

struct GaugeProperties {
    double thickness_mm;       // sheet nominal thickness, mm
    double density_kgPerM3;    // bulk density at room temp
    double kFactor_default;    // recommended K-factor for the alloy/temper
    double yieldStrength_MPa;  // tensile yield (informational)
};

// Material codes:
//   "steel"       — AISI 1010 cold-rolled, density 7860 kg/m³
//   "aluminium"   — 5052-H32, density 2680 kg/m³
//   "stainless"   — 304, density 8000 kg/m³ (informational — gauge table
//                   identical to steel ga for the SAE/SI series)
//
// Steel "gauge" inputs are SAE gauge numbers (7, 9, 11, 12, 14, 16, 18, 20,
// 22). Aluminium "gauge" inputs encode 1000·inches  (25, 32, 40, 50, 63,
// 80, 90, 125) which is the conventional way to talk about 0.025" .. 0.125"
// 5052-H32. Throws std::invalid_argument for unknown material / gauge.
GaugeProperties gaugeProperties(const std::string& material, int gauge);

// ---------------------------------------------------------------- bend math

struct BendMath {
    double bendAllowance_mm;   // BA = (π/180) θ (R + K t)
    double bendDeduction_mm;   // BD = 2 (R+t) tan(θ/2) − BA
    double neutralRadius_mm;   // R + K t
    double outsideSetback_mm;  // (R+t) tan(θ/2)
};

BendMath bendAllowance(double angleDeg, double innerRadius_mm,
                       double thickness_mm, double kFactor);

// ---------------------------------------------------------------- unfold

// One bend instruction: identifies the bend axis on the formed BRep + which
// kFactor to use when computing developed length. bendLineEdgeIndex is the
// TopExp_Explorer EDGE index (matches the convention used by Cam.cpp /
// SheetMetal.cpp). angleDeg is the included bend angle (e.g. 90 for an L
// flange); positive angles fold downstream up out of the base plane.
struct BendDef {
    std::uint32_t bendLineEdgeIndex;
    double        angleDeg;
    double        innerRadius_mm;
    double        kFactor;
};

// Flatten a multi-bend BRep part. For every BendDef:
//   * locate the edge by index
//   * compute the bend axis (gp_Ax1: midpoint of the edge, direction =
//     edge tangent)
//   * partition the part into "upstream" (already-flat) and "downstream"
//     groups using the midpoint of the bend line and the edge's outward
//     normal (the existing topology gives us a clean +Z direction)
//   * rotate the downstream group by -θ around the bend axis using
//     gp_Trsf::SetRotation + BRepBuilderAPI_Transform
//   * fuse the two groups back together so subsequent bends operate on the
//     already-partially-unfolded shape
// Returns a new ShapeHandle whose BRep is planar (z-span = thickness).
ShapeHandle flatten(ShapeHandle solidPart, const std::vector<BendDef>& bends,
                    double thickness_mm);

// ---------------------------------------------------------------- DXF

// Writes a fully valid AutoCAD DXF (R12 / AC1009 baseline) to filePath
// describing the flat pattern projected onto z=0:
//   * outer boundary edges as LWPOLYLINE on layer "OUTER" colour 7
//   * inner / hole loops as LWPOLYLINE on layer "HOLES" colour 5
//   * bend lines as LINE on layer "BEND" colour 1
//
// Returns the number of bytes written. Throws on file-open failure or
// if the input shape has no faces.
std::size_t exportDxf(ShapeHandle flatShape, const std::string& filePath,
                      const std::vector<BendDef>& bendLines = {});

// ---------------------------------------------------------------- reliefs

enum class ReliefType : std::uint8_t {
    Round       = 0,
    Rectangular = 1,
    Tear        = 2,
};

// Auto-cut a corner relief at every recorded bend endpoint. The relief
// geometry is built in world coordinates from the bend line endpoints and
// the outward normal recorded at unfold time, then BRepAlgoAPI_Cut'd from
// the part. reliefWidth is along the bend line, reliefDepth is across it.
// Returns the new ShapeHandle.
ShapeHandle cornerRelief(ShapeHandle bentPart, double reliefWidth_mm,
                         double reliefDepth_mm, ReliefType type);

// ---------------------------------------------------------------- cost

struct CostBreakdown {
    double mass_kg;       // BRep volume × material density
    double cutTime_s;     // perimeter / cut speed + pierce penalty
    double materialUSD;   // mass × price/kg
    double cutUSD;        // cut time × shop rate (assumed $1.50 / min)
    double totalUSD;
};

// Estimate sheet metal manufacturing cost. density_kgPerM3 is read from
// gaugeProperties; passed in here directly so the caller doesn't have to
// re-look-up. pierceCount adds 0.25 s per pierce (standard fibre-laser).
CostBreakdown cost(ShapeHandle flatPart, double density_kgPerM3,
                   double pricePerKgUSD, double laserCutSpeedMmPerS,
                   double pierceCount);

} // namespace forge::sheetextend
