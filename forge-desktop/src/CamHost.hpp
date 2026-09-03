// forge-desktop/src/CamHost.hpp
//
// THE MANUFACTURING SEAM — the one place in forge-desktop that reaches the
// kernel's CAM module, in exactly the way KernelScene is the one place that
// reaches its modelling module.
//
// WHY IT EXISTS. Four tabs in the Manufacturing workspace — Tool Library, Stock,
// Post Output and Materials — drew a sentence apologising for themselves. The
// kernel they sit on top of already had: a cutting-tool catalogue with real
// geometry and real chip loads (forge::camx::listTools), a 2.5-axis contour
// generator, three post-processors, a cycle-time estimator and a voxel stock
// simulation. None of it was reachable from the application, so a user could not
// see a tool, a toolpath, a program or a block of stock.
//
// ── WHAT IS AND IS NOT COMPUTED HERE ────────────────────────────────────────
// This file computes NO cutting geometry of its own. Every toolpath point, every
// line of machine code, every removed cubic millimetre comes back from a kernel
// call. What it DOES do is take the section through the part, because that is
// the one input the kernel's 2.5-axis generators need and nothing in the
// application had: `forge::camx::contourToolpath` consumes a planar boundary
// polygon, and the app holds the part as a triangle stream.
//
// ── WHY THE SECTION IS TAKEN FROM THE MESH AND NOT THE SOLID ────────────────
// forge::cam::profile() takes a ShapeHandle and would trace the exact B-rep
// wire. It cannot be used here, and the reason is the crash isolation: the
// shipped application compiles the part in forge_kernel_worker, so the handle
// lives in a CHILD PROCESS and the parent never holds one. Re-compiling the
// program in the parent purely to reach the handle would put the fault this
// application is built to survive back inside it.
//
// What DOES cross that boundary is the tessellation — the same vertex stream the
// viewport draws — so the section is taken from it. The consequence is stated to
// the user rather than hidden: the outline follows the display mesh, which
// forge::tessellate built to a 0.05 mm chord tolerance, so it is that close to
// the exact surface and no closer.
//
// ── NO ImGui, NO OCCT IN THE HEADER ─────────────────────────────────────────
// Everything below is plain data. The frame builder includes this header; only
// CamHost.cpp includes forge/CamExtended.hpp and forge/CamAdvanced.hpp.
#ifndef FORGE_DESKTOP_CAMHOST_HPP
#define FORGE_DESKTOP_CAMHOST_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "KernelScene.hpp"

namespace forge::desktop::cam {

// The chord tolerance forge::tessellate is asked for in KernelScene, restated
// here because it is the accuracy of every outline this file produces and the
// panel has to be able to say it. KernelScene.cpp holds the value; this
// constant is checked equal to it by the CAM gate, so the two cannot drift.
inline constexpr double kOutlineChordToleranceMm = 0.05;

// ── the cutting tools ───────────────────────────────────────────────────────
//
// One entry per tool in the kernel's catalogue. Every field is copied from
// forge::camx::Tool; the two derived readings are named as derived and their
// formulae are the two a machinist writes on a setup sheet:
//
//     feed         = spindle speed x flutes x chip load        (mm/min)
//     surface speed = pi x diameter x spindle speed / 1000     (m/min)
//
// They are functions rather than fields so a caller cannot store a feed computed
// at one speed and print it beside another.
struct CuttingTool {
  std::uint32_t id = 0;
  std::string name;          // "6 mm flat end mill"
  std::string kind;          // "Flat end mill", "Ball nose", "Drill", ...
  double diameterMm = 0.0;
  double fluteLengthMm = 0.0;
  double totalLengthMm = 0.0;
  int flutes = 0;
  std::string toolMaterial;  // "carbide" / "HSS", as the catalogue states it
  double maxSpindleRpm = 0.0;
  double chipLoadMm = 0.0;   // mm per tooth per revolution

  double feedAt(double spindleRpm) const;
  double surfaceSpeedAt(double spindleRpm) const;  // m/min
};

// The kernel's catalogue, in the kernel's own order. Built once.
const std::vector<CuttingTool>& toolLibrary();
const CuttingTool* findTool(std::uint32_t id);

// ── the section through the part ────────────────────────────────────────────
struct Pt2 {
  double x = 0.0;
  double y = 0.0;
};

struct OutlineLoop {
  std::vector<Pt2> points;   // closed by implication: the last point joins the first
  double areaMm2 = 0.0;      // SIGNED; positive is counter-clockwise
  double perimeterMm = 0.0;
};

struct PartOutline {
  bool ok = false;
  double zMm = 0.0;
  // Largest enclosed area first, so loops.front() is the outer boundary and
  // everything after it is an island inside it.
  std::vector<OutlineLoop> loops;
  std::size_t trianglesCut = 0;   // triangles the plane actually passed through
  std::size_t segments = 0;       // segments those triangles produced
  std::size_t openChains = 0;     // chains that did not close, and were dropped
  std::string advice;             // a sentence for the user; empty when ok

  const OutlineLoop* outer() const noexcept {
    return loops.empty() ? nullptr : &loops.front();
  }
  std::size_t islands() const noexcept { return loops.empty() ? 0 : loops.size() - 1; }
  // Outer area minus every island: the material actually present at this height.
  double netAreaMm2() const noexcept;
};

// Slices the de-indexed viewport vertex stream with the plane z = zMm and chains
// the result into closed loops. `vertices` is KernelScene::vertices().
PartOutline sectionOutline(const std::vector<SceneVertex>& vertices, double zMm);

// ── the stock ───────────────────────────────────────────────────────────────
//
// A rectangular block around the part. `sideAllowanceMm` is added on all four
// sides in X and Y; `topAllowanceMm` is added ABOVE the part only, because the
// part's own underside is the fixture datum and material below it would have to
// be cut through the table.
struct StockBlock {
  double minMm[3] = {0.0, 0.0, 0.0};
  double maxMm[3] = {0.0, 0.0, 0.0};
  double sizeMm[3] = {0.0, 0.0, 0.0};
  double volumeMm3 = 0.0;
  bool ok = false;
};

StockBlock stockAround(const double partMinMm[3], const double partMaxMm[3],
                       double sideAllowanceMm, double topAllowanceMm);

// ── the operation ───────────────────────────────────────────────────────────
//
// Z IS MEASURED FROM THE TOP OF THE STOCK. The kernel's contour generator emits
// its passes at negative Z below zero, which is the ordinary machining
// convention: the work offset is set on the top face of the block and every
// depth is a distance below it. The panel says so; nothing here silently shifts
// a coordinate.
enum class ContourSide : std::uint8_t { Inside, Outside, On };
enum class PostFlavour : std::uint8_t { Fanuc, Heidenhain, Siemens };

const char* toString(ContourSide side) noexcept;
const char* toString(PostFlavour post) noexcept;

struct CutParameters {
  std::uint32_t toolId = 1;
  double spindleRpm = 0.0;      // 0 asks for the tool's own maximum
  double depthMm = 0.0;         // total descent below the top of the stock
  double stepdownMm = 0.0;      // 0 asks for half the tool diameter
  double safeZMm = 5.0;         // rapid height above the top of the stock
  ContourSide side = ContourSide::Outside;
  PostFlavour post = PostFlavour::Fanuc;
};

// One point of the toolpath in work coordinates. `cutting` is false for the
// rapid that joins one pass to the next, which is what makes the stock
// simulation able to tell a cut from a reposition.
struct CamMove {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
  bool cutting = false;
};

struct CamPlan {
  bool ok = false;
  CuttingTool tool;
  CutParameters params;
  double spindleRpm = 0.0;      // resolved: what was actually used
  double feedMmPerMin = 0.0;    // resolved from the tool at that speed
  double stepdownMm = 0.0;      // resolved
  std::size_t passes = 0;       // Z levels the kernel produced
  std::size_t points = 0;       // toolpath points across every pass
  std::vector<CamMove> moves;
  double pathLengthMm = 0.0;    // kernel's own cutting-length estimate
  double cutSeconds = 0.0;      // kernel's own cycle-time estimate
  std::string program;          // the posted machine code, as the kernel wrote it
  std::size_t programLines = 0;
  std::string advice;           // a sentence for the user; empty when ok
};

// Runs the kernel's contour generator over `loop`, posts it in the requested
// dialect, and asks the kernel for the cycle time. Nothing here writes a line of
// machine code itself.
CamPlan planContour(const OutlineLoop& loop, const CutParameters& params);

// ── what the operation takes out of the block ───────────────────────────────
struct StockCutReport {
  bool ok = false;
  double startVolumeMm3 = 0.0;  // the simulation's own view of the full block
  double leftVolumeMm3 = 0.0;
  double removedVolumeMm3 = 0.0;
  double deepestCutMm = 0.0;
  std::uint32_t gridCells = 0;  // N of the N x N x N grid the kernel actually used
  double cellSizeMm[3] = {0.0, 0.0, 0.0};
  std::string advice;
};

// `stock` is in PART coordinates; the plan is in WORK coordinates (Z measured
// down from the top of the stock). This shifts the plan into part coordinates
// before handing it to the kernel, so the two are compared in one frame.
StockCutReport simulateCut(const StockBlock& stock, const CamPlan& plan);

}  // namespace forge::desktop::cam

#endif  // FORGE_DESKTOP_CAMHOST_HPP
