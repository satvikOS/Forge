#include "CamHost.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <exception>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

// The kernel's manufacturing module. CamAdvanced.hpp reaches Cam.hpp, which
// reaches ShapeRegistry.hpp and therefore an OCCT header, so this translation
// unit joins KernelScene.cpp and FileExchangeHost.cpp as one of the three that
// see OCCT. The frame builder still sees none of it.
#include "forge/CamAdvanced.hpp"
#include "forge/CamExtended.hpp"

namespace forge::desktop::cam {
namespace {

// Two points are the same point when they are this close. The section points are
// computed in double from the mesh's floats, and two triangles sharing an edge
// interpolate that edge from opposite ends -- mathematically the same answer,
// not the same bits. The disagreement is around 1e-13 mm on a 100 mm part; this
// is nine orders of magnitude above it and six below any real feature.
constexpr double kWeldMm = 1.0e-4;

// A point is dropped from a loop when it sits this close to the straight line
// through its neighbours. A tessellated FLAT face arrives as a run of collinear
// points and this removes them; a tessellated CYLINDER arrives with a chord
// sagitta of up to the 0.05 mm tessellation tolerance, which is 50 times this,
// so real curvature survives.
constexpr double kFlattenMm = 1.0e-3;

// A loop bigger than this is not offered to the offsetter. The kernel's inset
// walks the polygon repeatedly while culling self-intersections, so a runaway
// point count is paid for quadratically; refusing with a sentence beats a frozen
// application. Nothing in a tessellated section of a real part comes close.
constexpr std::size_t kMaxLoopPoints = 4000;

const char* kindName(forge::camx::ToolType t) {
  switch (t) {
    case forge::camx::ToolType_EndMill:   return "Flat end mill";
    case forge::camx::ToolType_BallMill:  return "Ball nose";
    case forge::camx::ToolType_Drill:     return "Twist drill";
    case forge::camx::ToolType_FaceMill:  return "Face mill";
    case forge::camx::ToolType_SpotDrill: return "Spot drill";
  }
  return "Cutter";
}

// "6 mm flat end mill". Built from the catalogue's own diameter and type, so a
// tool added to the kernel names itself here with no edit to this file.
std::string toolName(const forge::camx::Tool& t) {
  char buf[64];
  const double d = t.diameter;
  if (std::fabs(d - std::round(d)) < 1e-9) {
    std::snprintf(buf, sizeof(buf), "%.0f mm ", d);
  } else {
    std::snprintf(buf, sizeof(buf), "%.2f mm ", d);
  }
  std::string name = buf;
  std::string kind = kindName(t.type);
  // Lower-case the first letter: "6 mm flat end mill" reads as one phrase.
  if (!kind.empty() && kind[0] >= 'A' && kind[0] <= 'Z') {
    kind[0] = static_cast<char>(kind[0] - 'A' + 'a');
  }
  return name + kind;
}

double signedAreaOf(const std::vector<Pt2>& p) {
  if (p.size() < 3) return 0.0;
  double s = 0.0;
  for (std::size_t i = 0; i < p.size(); ++i) {
    const Pt2& a = p[i];
    const Pt2& b = p[(i + 1) % p.size()];
    s += a.x * b.y - b.x * a.y;
  }
  return 0.5 * s;
}

double perimeterOf(const std::vector<Pt2>& p) {
  if (p.size() < 2) return 0.0;
  double s = 0.0;
  for (std::size_t i = 0; i < p.size(); ++i) {
    const Pt2& a = p[i];
    const Pt2& b = p[(i + 1) % p.size()];
    s += std::hypot(b.x - a.x, b.y - a.y);
  }
  return s;
}

// Perpendicular distance from `p` to the line through `a` and `b`. When a and b
// coincide it degenerates to the distance from a, which is what the caller
// wants: a point sitting on a doubled vertex is a point to drop.
double lineDistance(const Pt2& p, const Pt2& a, const Pt2& b) {
  const double ex = b.x - a.x;
  const double ey = b.y - a.y;
  const double len = std::hypot(ex, ey);
  if (len < 1e-12) return std::hypot(p.x - a.x, p.y - a.y);
  return std::fabs(ex * (a.y - p.y) - ey * (a.x - p.x)) / len;
}

// Drops doubled points, then drops points that add no shape. Both are conditions
// on the DATA, not counts: nothing is removed to hit a target size.
void simplifyLoop(std::vector<Pt2>& loop) {
  // Doubled points first, so the collinearity test never divides by a zero-
  // length edge.
  std::vector<Pt2> tight;
  tight.reserve(loop.size());
  for (const Pt2& p : loop) {
    if (!tight.empty() && std::hypot(p.x - tight.back().x, p.y - tight.back().y) < kWeldMm) {
      continue;
    }
    tight.push_back(p);
  }
  while (tight.size() > 3 &&
         std::hypot(tight.front().x - tight.back().x, tight.front().y - tight.back().y) < kWeldMm) {
    tight.pop_back();
  }
  loop.swap(tight);

  bool removed = true;
  while (removed && loop.size() > 3) {
    removed = false;
    for (std::size_t i = 0; i < loop.size(); ++i) {
      const Pt2& prev = loop[(i + loop.size() - 1) % loop.size()];
      const Pt2& next = loop[(i + 1) % loop.size()];
      if (lineDistance(loop[i], prev, next) < kFlattenMm) {
        loop.erase(loop.begin() + static_cast<std::ptrdiff_t>(i));
        removed = true;
        break;
      }
    }
  }
}

// A spatial bucket over the segment endpoints, so chaining is linear rather than
// quadratic in the segment count. The key is the welded cell; lookups sweep the
// 3x3 neighbourhood, because two points either side of a cell boundary are still
// one point.
struct Endpoint {
  std::size_t segment = 0;
  bool tail = false;  // false = the segment's first point
};

std::int64_t cellOf(double v) {
  return static_cast<std::int64_t>(std::floor(v / kWeldMm));
}

std::uint64_t keyOf(std::int64_t cx, std::int64_t cy) {
  return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(cx)) << 32) ^
         static_cast<std::uint64_t>(static_cast<std::uint32_t>(cy));
}

}  // namespace

// ── the tools ───────────────────────────────────────────────────────────────
double CuttingTool::feedAt(double spindleRpm) const {
  if (spindleRpm <= 0.0 || flutes <= 0 || chipLoadMm <= 0.0) return 0.0;
  return spindleRpm * static_cast<double>(flutes) * chipLoadMm;
}

double CuttingTool::surfaceSpeedAt(double spindleRpm) const {
  if (spindleRpm <= 0.0 || diameterMm <= 0.0) return 0.0;
  return 3.14159265358979323846 * diameterMm * spindleRpm / 1000.0;
}

const std::vector<CuttingTool>& toolLibrary() {
  static const std::vector<CuttingTool> table = [] {
    std::vector<CuttingTool> out;
    const std::vector<forge::camx::Tool> kernelTools = forge::camx::listTools();
    out.reserve(kernelTools.size());
    for (const forge::camx::Tool& t : kernelTools) {
      CuttingTool c;
      c.id = t.id;
      c.name = toolName(t);
      c.kind = kindName(t.type);
      c.diameterMm = t.diameter;
      c.fluteLengthMm = t.fluteLength;
      c.totalLengthMm = t.totalLength;
      c.flutes = t.flutes;
      c.toolMaterial = t.material;
      c.maxSpindleRpm = t.maxRPM;
      c.chipLoadMm = t.feedPerTooth;
      out.push_back(std::move(c));
    }
    return out;
  }();
  return table;
}

const CuttingTool* findTool(std::uint32_t id) {
  for (const CuttingTool& t : toolLibrary()) {
    if (t.id == id) return &t;
  }
  return nullptr;
}

// ── the section ─────────────────────────────────────────────────────────────
double PartOutline::netAreaMm2() const noexcept {
  if (loops.empty()) return 0.0;
  double net = std::fabs(loops.front().areaMm2);
  for (std::size_t i = 1; i < loops.size(); ++i) net -= std::fabs(loops[i].areaMm2);
  return net;
}

PartOutline sectionOutline(const std::vector<SceneVertex>& vertices, double zMm) {
  PartOutline out;
  out.zMm = zMm;
  if (vertices.size() < 3 || vertices.size() % 3 != 0) {
    out.advice = "There is no part in this document to take a section through.";
    return out;
  }

  // ── 1. cut every triangle ────────────────────────────────────────────────
  // A vertex sitting exactly on the plane is treated as being ABOVE it, always
  // the same way. That one decision removes every degenerate case: a triangle
  // lying in the plane has all three vertices above and contributes nothing, and
  // no zero-length segment is ever produced.
  struct Seg {
    Pt2 a;
    Pt2 b;
  };
  std::vector<Seg> segs;
  for (std::size_t t = 0; t + 2 < vertices.size(); t += 3) {
    double px[3];
    double py[3];
    double d[3];
    for (int k = 0; k < 3; ++k) {
      px[k] = static_cast<double>(vertices[t + static_cast<std::size_t>(k)].px);
      py[k] = static_cast<double>(vertices[t + static_cast<std::size_t>(k)].py);
      d[k] = static_cast<double>(vertices[t + static_cast<std::size_t>(k)].pz) - zMm;
      if (d[k] == 0.0) d[k] = 1.0;  // on the plane counts as above
    }
    Pt2 hit[3];
    int n = 0;
    for (int k = 0; k < 3 && n < 3; ++k) {
      const int m = (k + 1) % 3;
      if ((d[k] > 0.0) == (d[m] > 0.0)) continue;
      const double f = d[k] / (d[k] - d[m]);
      hit[n].x = px[k] + f * (px[m] - px[k]);
      hit[n].y = py[k] + f * (py[m] - py[k]);
      ++n;
    }
    if (n != 2) continue;
    if (std::hypot(hit[1].x - hit[0].x, hit[1].y - hit[0].y) < kWeldMm) continue;
    ++out.trianglesCut;
    segs.push_back(Seg{hit[0], hit[1]});
  }
  out.segments = segs.size();
  if (segs.size() < 3) {
    out.advice =
        "This height is above or below the part. Move the section down into the "
        "material to see an outline.";
    return out;
  }

  // ── 2. chain the segments into closed loops ──────────────────────────────
  std::unordered_map<std::uint64_t, std::vector<Endpoint>> buckets;
  buckets.reserve(segs.size() * 2);
  const auto record = [&buckets](const Pt2& p, std::size_t segment, bool tail) {
    buckets[keyOf(cellOf(p.x), cellOf(p.y))].push_back(Endpoint{segment, tail});
  };
  for (std::size_t i = 0; i < segs.size(); ++i) {
    record(segs[i].a, i, false);
    record(segs[i].b, i, true);
  }

  std::vector<bool> used(segs.size(), false);
  // Finds an unused segment with an endpoint on `p`, and reports which end
  // matched so the walk continues from the other one.
  const auto findNext = [&](const Pt2& p, std::size_t& segment, bool& matchedTail) {
    const std::int64_t cx = cellOf(p.x);
    const std::int64_t cy = cellOf(p.y);
    for (std::int64_t dx = -1; dx <= 1; ++dx) {
      for (std::int64_t dy = -1; dy <= 1; ++dy) {
        auto it = buckets.find(keyOf(cx + dx, cy + dy));
        if (it == buckets.end()) continue;
        for (const Endpoint& e : it->second) {
          if (used[e.segment]) continue;
          const Pt2& q = e.tail ? segs[e.segment].b : segs[e.segment].a;
          if (std::hypot(q.x - p.x, q.y - p.y) > kWeldMm) continue;
          segment = e.segment;
          matchedTail = e.tail;
          return true;
        }
      }
    }
    return false;
  };

  for (std::size_t start = 0; start < segs.size(); ++start) {
    if (used[start]) continue;
    used[start] = true;
    std::vector<Pt2> loop{segs[start].a, segs[start].b};
    Pt2 head = segs[start].a;
    Pt2 tail = segs[start].b;
    bool closed = false;
    while (true) {
      if (std::hypot(tail.x - head.x, tail.y - head.y) < kWeldMm && loop.size() >= 4) {
        closed = true;
        break;
      }
      std::size_t next = 0;
      bool matchedTail = false;
      if (!findNext(tail, next, matchedTail)) break;
      used[next] = true;
      tail = matchedTail ? segs[next].a : segs[next].b;
      loop.push_back(tail);
      if (loop.size() > segs.size() + 2) break;  // cannot happen; not left to chance
    }
    if (!closed) {
      ++out.openChains;
      continue;
    }
    simplifyLoop(loop);
    if (loop.size() < 3) continue;
    OutlineLoop l;
    l.areaMm2 = signedAreaOf(loop);
    l.perimeterMm = perimeterOf(loop);
    l.points = std::move(loop);
    if (std::fabs(l.areaMm2) < 1e-6) continue;
    out.loops.push_back(std::move(l));
  }

  if (out.loops.empty()) {
    out.advice =
        "The section at this height did not close into a boundary. Move it a "
        "little and it will.";
    return out;
  }
  std::sort(out.loops.begin(), out.loops.end(),
            [](const OutlineLoop& a, const OutlineLoop& b) {
              return std::fabs(a.areaMm2) > std::fabs(b.areaMm2);
            });
  out.ok = true;
  return out;
}

// ── the stock ───────────────────────────────────────────────────────────────
StockBlock stockAround(const double partMinMm[3], const double partMaxMm[3],
                       double sideAllowanceMm, double topAllowanceMm) {
  StockBlock s;
  const double side = std::max(0.0, sideAllowanceMm);
  const double top = std::max(0.0, topAllowanceMm);
  s.minMm[0] = partMinMm[0] - side;
  s.minMm[1] = partMinMm[1] - side;
  s.minMm[2] = partMinMm[2];
  s.maxMm[0] = partMaxMm[0] + side;
  s.maxMm[1] = partMaxMm[1] + side;
  s.maxMm[2] = partMaxMm[2] + top;
  for (int i = 0; i < 3; ++i) s.sizeMm[i] = s.maxMm[i] - s.minMm[i];
  s.ok = s.sizeMm[0] > 0.0 && s.sizeMm[1] > 0.0 && s.sizeMm[2] > 0.0;
  s.volumeMm3 = s.ok ? s.sizeMm[0] * s.sizeMm[1] * s.sizeMm[2] : 0.0;
  return s;
}

// ── the operation ───────────────────────────────────────────────────────────
const char* toString(ContourSide side) noexcept {
  switch (side) {
    case ContourSide::Inside:  return "inside the outline";
    case ContourSide::Outside: return "outside the outline";
    case ContourSide::On:      return "on the outline";
  }
  return "on the outline";
}

const char* toString(PostFlavour post) noexcept {
  switch (post) {
    case PostFlavour::Fanuc:      return "Fanuc";
    case PostFlavour::Heidenhain: return "Heidenhain";
    case PostFlavour::Siemens:    return "Siemens";
  }
  return "Fanuc";
}

CamPlan planContour(const OutlineLoop& loop, const CutParameters& params) {
  CamPlan plan;
  plan.params = params;
  const CuttingTool* tool = findTool(params.toolId);
  if (tool == nullptr) {
    plan.advice = "Choose a tool in the Tool Library and this operation will use it.";
    return plan;
  }
  plan.tool = *tool;

  if (loop.points.size() < 3) {
    plan.advice = "There is no closed outline at this height to follow.";
    return plan;
  }
  if (loop.points.size() > kMaxLoopPoints) {
    plan.advice =
        "The outline at this height has too many points to cut in one pass. Take "
        "the section at a simpler height.";
    return plan;
  }

  plan.spindleRpm = params.spindleRpm > 0.0 ? params.spindleRpm : tool->maxSpindleRpm;
  plan.feedMmPerMin = tool->feedAt(plan.spindleRpm);
  plan.stepdownMm = params.stepdownMm > 0.0 ? params.stepdownMm : tool->diameterMm * 0.5;
  if (plan.feedMmPerMin <= 0.0) {
    plan.advice = "This tool has no cutting speed recorded, so no feed can be worked out for it.";
    return plan;
  }
  if (!(params.depthMm > 0.0)) {
    plan.advice = "Set a depth greater than zero and the passes will appear here.";
    return plan;
  }
  if (plan.stepdownMm > params.depthMm) plan.stepdownMm = params.depthMm;

  forge::camx::Polygon boundary;
  boundary.reserve(loop.points.size());
  for (const Pt2& p : loop.points) boundary.push_back(forge::camx::Pt2{p.x, p.y});

  forge::camx::ContourParams cp{};
  cp.depth = params.depthMm;
  cp.stepdown = plan.stepdownMm;
  cp.climb = true;

  forge::camx::ContourSide side = forge::camx::ContourSide_Outside;
  if (params.side == ContourSide::Inside) side = forge::camx::ContourSide_Inside;
  if (params.side == ContourSide::On) side = forge::camx::ContourSide_On;

  std::vector<forge::camx::Polyline3> passes;
  try {
    passes = forge::camx::contourToolpath(boundary, params.toolId, side, cp);
  } catch (const std::exception&) {
    // The kernel refuses when the offset collapses -- a 50 mm face mill cannot
    // cut inside a 12 mm bore. That is a real answer about the tool and the
    // shape, and it is said as one.
    plan.advice =
        "This tool is too big for the outline on that side. Pick a smaller tool, "
        "or cut on the other side of the line.";
    return plan;
  } catch (...) {
    plan.advice = "The machining engine could not follow this outline.";
    return plan;
  }
  if (passes.empty()) {
    plan.advice = "This tool is too big for the outline on that side.";
    return plan;
  }

  plan.passes = passes.size();
  for (const forge::camx::Polyline3& pass : passes) {
    plan.points += pass.size();
    for (std::size_t i = 0; i < pass.size(); ++i) {
      CamMove m;
      m.x = pass[i].x;
      m.y = pass[i].y;
      m.z = pass[i].z;
      // The first point of a pass is arrived at; every later point is cut.
      m.cutting = i != 0;
      plan.moves.push_back(m);
    }
  }

  forge::camx::PostParams pp{};
  pp.spindleRPM = plan.spindleRpm;
  pp.feed = plan.feedMmPerMin;
  pp.safeZ = params.safeZMm;
  pp.toolId = params.toolId;

  forge::camx::PostFlavour flavour = forge::camx::Post_Fanuc;
  if (params.post == PostFlavour::Heidenhain) flavour = forge::camx::Post_Heidenhain;
  if (params.post == PostFlavour::Siemens) flavour = forge::camx::Post_Siemens;

  try {
    plan.program = forge::camx::postProcess(passes, flavour, pp);
    const forge::camx::CycleTime ct = forge::camx::estimateCycleTime(passes, plan.feedMmPerMin);
    plan.pathLengthMm = ct.totalLengthMm;
    plan.cutSeconds = ct.timeSec;
  } catch (const std::exception&) {
    plan.advice = "The machine code for this operation could not be written.";
    return plan;
  } catch (...) {
    plan.advice = "The machine code for this operation could not be written.";
    return plan;
  }

  plan.programLines = 0;
  for (char c : plan.program) {
    if (c == '\n') ++plan.programLines;
  }
  plan.ok = !plan.program.empty() && plan.programLines > 0;
  if (!plan.ok) plan.advice = "This operation produced no machine code.";
  return plan;
}

// ── what it takes out of the block ──────────────────────────────────────────
StockCutReport simulateCut(const StockBlock& stock, const CamPlan& plan) {
  StockCutReport report;
  if (!stock.ok) {
    report.advice = "Give the stock a size in all three directions and this will fill in.";
    return report;
  }
  if (!plan.ok || plan.moves.size() < 2) {
    report.advice = "There is no toolpath to run through this block yet.";
    return report;
  }

  forge::cam::StockAABB box{};
  box.minX = stock.minMm[0];
  box.minY = stock.minMm[1];
  box.minZ = stock.minMm[2];
  box.maxX = stock.maxMm[0];
  box.maxY = stock.maxMm[1];
  box.maxZ = stock.maxMm[2];

  // The plan is in WORK coordinates: Z is measured down from the top of the
  // block. The block is in PART coordinates. One shift, here, so the simulation
  // never sees two frames.
  forge::cam::Toolpath tp;
  tp.toolId = plan.tool.id;
  tp.moves.reserve(plan.moves.size());
  for (const CamMove& m : plan.moves) {
    forge::cam::Move k{};
    k.x = m.x;
    k.y = m.y;
    k.z = m.z + stock.maxMm[2];
    k.cutting = m.cutting;
    k.feedrate = plan.feedMmPerMin;
    tp.moves.push_back(k);
  }

  forge::cam::Tool cutter{};
  cutter.id = plan.tool.id;
  cutter.name = plan.tool.name;
  cutter.diameter = plan.tool.diameterMm;
  cutter.fluteLength = plan.tool.fluteLengthMm;
  // The catalogue records no helix angle and the simulation never reads one --
  // it sweeps the cutting diameter along the path. Nothing displays this field.
  cutter.helix = 0.0;
  cutter.flutes = plan.tool.flutes;
  cutter.type = forge::cam::Tool::EndMill;

  forge::cam::StockSimReport sim{};
  try {
    sim = forge::cam::simulateStock(box, tp, cutter, 50);
  } catch (const std::exception&) {
    report.advice = "This block could not be run through the machining preview.";
    return report;
  } catch (...) {
    report.advice = "This block could not be run through the machining preview.";
    return report;
  }

  report.startVolumeMm3 = sim.initialVolume;
  report.leftVolumeMm3 = sim.remainingVolume;
  report.removedVolumeMm3 = sim.initialVolume - sim.remainingVolume;
  report.deepestCutMm = sim.maxCutDepth;
  report.gridCells = sim.gridResolution;
  for (int i = 0; i < 3; ++i) {
    report.cellSizeMm[i] =
        sim.gridResolution > 0 ? stock.sizeMm[i] / static_cast<double>(sim.gridResolution) : 0.0;
  }
  report.ok = sim.gridResolution > 0;
  if (!report.ok) report.advice = "This block could not be run through the machining preview.";
  return report;
}

}  // namespace forge::desktop::cam
