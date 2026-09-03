#include "forge/ui/WorkspaceTrees.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/ModelTree.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/Units.hpp"

namespace forge::ui {

namespace {

constexpr std::size_t kNoIndex = static_cast<std::size_t>(-1);

// The numeric arguments of a statement, in order, with the %refs, keywords and
// quoted selectors dropped. Every "which number is the diameter" question below
// is asked of THIS vector, because the kernel's documented forms are written in
// terms of the numbers and a caller that counted raw argument positions would
// have to know whether the op leads with a %body.
std::vector<double> numbersOf(const IrLine& line) {
  std::vector<double> out;
  out.reserve(line.args.size());
  for (const IrArg& a : line.args) {
    if (a.kind == IrArgKind::Number) out.push_back(a.number);
  }
  return out;
}

// The first bare keyword a statement carries: PATTERN's LINEAR / POLAR / GRID,
// MIRROR's XY / YZ / XZ. "" when it carries none.
std::string keywordOf(const IrLine& line) {
  for (const IrArg& a : line.args) {
    if (a.kind == IrArgKind::Keyword) return a.word;
  }
  return {};
}

double numberAt(const std::vector<double>& v, std::size_t i) {
  return i < v.size() ? v[i] : 0.0;
}

std::string mm(double v) { return formatIrNumber(v) + " mm"; }

// A count argument is a COUNT: a positive whole number. PATTERN(%a, LINEAR, 2.5,
// 10) is a statement the kernel would take and whose instance count nothing here
// can honestly report, so it is refused rather than truncated.
bool wholeCount(double v, std::size_t& out) {
  if (!(v >= 1.0) || !std::isfinite(v)) return false;
  const double r = std::floor(v + 0.5);
  if (std::fabs(v - r) > 1e-9) return false;
  if (r > 1.0e9) return false;
  out = static_cast<std::size_t>(r);
  return true;
}

std::string labelOf(const FeatureRecord& rec) {
  return rec.label.empty() ? rec.line.op : rec.label;
}

// irId -> record, without scanning the vector per lookup. Same reason
// ModelTree.cpp carries one: a real document is long and the panels beside this
// one are virtualized precisely because of it.
class RecordIndex {
 public:
  explicit RecordIndex(const std::vector<FeatureRecord>& records) : records_(records) {
    int top = 0;
    for (const FeatureRecord& r : records) {
      if (r.irId > top) top = r.irId;
    }
    slot_.assign(static_cast<std::size_t>(top) + 1, kNoIndex);
    for (std::size_t i = 0; i < records.size(); ++i) {
      const int id = records[i].irId;
      if (id > 0) slot_[static_cast<std::size_t>(id)] = i;
    }
  }

  const FeatureRecord* find(int irId) const {
    if (irId <= 0 || static_cast<std::size_t>(irId) >= slot_.size()) return nullptr;
    const std::size_t at = slot_[static_cast<std::size_t>(irId)];
    return at == kNoIndex ? nullptr : &records_[at];
  }

 private:
  const std::vector<FeatureRecord>& records_;
  std::vector<std::size_t> slot_;
};

}  // namespace

// ── 1. THE ASSEMBLY READING ────────────────────────────────────────────────

const char* placementWord(PlacementKind kind) noexcept {
  switch (kind) {
    case PlacementKind::Moved: return "moved";
    case PlacementKind::Turned: return "turned";
    case PlacementKind::Mirrored: return "mirrored";
    case PlacementKind::RepeatedInLine: return "repeated in a line";
    case PlacementKind::RepeatedRound: return "repeated around a circle";
    case PlacementKind::RepeatedInGrid: return "repeated in a grid";
    case PlacementKind::Repeated: return "repeated";
  }
  return "placed";
}

bool isPlacementOp(const std::string& op) {
  return op == "TRANSLATE" || op == "ROTATE" || op == "MIRROR" || op == "PATTERN";
}

const AssemblyComponent* AssemblyTree::find(int irId) const noexcept {
  for (const AssemblyComponent& c : components) {
    if (c.irId == irId) return &c;
  }
  return nullptr;
}

namespace {

// A component is a body or a sheet: something a user would call a part. A
// profile, a wire and a sketch are what a body is MADE from and belong to the
// sketch tree; listing them as components would put a rectangle in the parts
// list of an assembly.
bool isComponentKind(IrValueKind kind) {
  return kind == IrValueKind::Solid || kind == IrValueKind::Surface;
}

AssemblyPlacement readPlacement(const FeatureRecord& rec, const RecordIndex& index) {
  AssemblyPlacement p;
  p.irId = rec.irId;
  p.op = rec.line.op;
  p.label = labelOf(rec);
  for (const IrArg& a : rec.line.args) {
    if (a.kind == IrArgKind::Ref) { p.source = a.ref; break; }
  }
  if (const FeatureRecord* from = index.find(p.source)) p.sourceLabel = labelOf(*from);

  const std::vector<double> n = numbersOf(rec.line);
  const std::string key = keywordOf(rec.line);

  if (rec.line.op == "TRANSLATE") {
    p.kind = PlacementKind::Moved;
    p.describe = "moved by " + formatIrNumber(numberAt(n, 0)) + ", " +
                 formatIrNumber(numberAt(n, 1)) + ", " + mm(numberAt(n, 2));
    return p;
  }
  if (rec.line.op == "ROTATE") {
    p.kind = PlacementKind::Turned;
    p.describe = "turned " + formatIrNumber(numberAt(n, 0)) + " degrees about " +
                 formatIrNumber(numberAt(n, 1)) + ", " + formatIrNumber(numberAt(n, 2)) + ", " +
                 formatIrNumber(numberAt(n, 3));
    return p;
  }
  if (rec.line.op == "MIRROR") {
    p.kind = PlacementKind::Mirrored;
    if (!key.empty()) {
      p.describe = "mirrored across the " + key + " plane";
    } else {
      p.describe = "mirrored across a plane through " + formatIrNumber(numberAt(n, 0)) + ", " +
                   formatIrNumber(numberAt(n, 1)) + ", " + mm(numberAt(n, 2));
    }
    return p;
  }

  // PATTERN, and the count is the whole reason this row is worth drawing.
  if (key == "GRID") {
    p.kind = PlacementKind::RepeatedInGrid;
    std::size_t nx = 1;
    std::size_t ny = 1;
    const bool okx = wholeCount(numberAt(n, 0), nx);
    const bool oky = wholeCount(numberAt(n, 1), ny);
    p.countKnown = okx && oky;
    p.copies = p.countKnown ? nx * ny : 1;
    p.describe = formatIrNumber(numberAt(n, 0)) + " by " + formatIrNumber(numberAt(n, 1)) +
                 " copies, " + formatIrNumber(numberAt(n, 2)) + " by " + mm(numberAt(n, 3)) +
                 " apart";
    return p;
  }
  if (key == "POLAR") {
    p.kind = PlacementKind::RepeatedRound;
    std::size_t count = 1;
    p.countKnown = wholeCount(numberAt(n, 0), count);
    p.copies = p.countKnown ? count : 1;
    p.describe = formatIrNumber(numberAt(n, 0)) + " copies around " +
                 formatIrNumber(numberAt(n, 1)) + " degrees";
    return p;
  }
  p.kind = key == "LINEAR" ? PlacementKind::RepeatedInLine : PlacementKind::Repeated;
  std::size_t count = 1;
  p.countKnown = wholeCount(numberAt(n, 0), count);
  p.copies = p.countKnown ? count : 1;
  // PATTERN(%a, LINEAR, n, dx [, dy=0, dz=0]) -- the step is a VECTOR and what a
  // user wants to read is the distance between neighbouring copies, so the three
  // components are combined rather than printed as "25, 0, 0".
  const double dx = numberAt(n, 1);
  const double dy = numberAt(n, 2);
  const double dz = numberAt(n, 3);
  const double step = std::sqrt(dx * dx + dy * dy + dz * dz);
  p.describe = formatIrNumber(numberAt(n, 0)) + " copies, " + mm(step) + " apart";
  return p;
}

}  // namespace

AssemblyTree buildAssemblyTree(const PartDocument& document) {
  const std::vector<FeatureRecord>& records = document.records();
  const RecordIndex index(records);
  const ModelBrowser browser = buildModelBrowser(document);

  AssemblyTree out;
  int topId = 0;
  for (const FeatureRecord& r : records) {
    if (r.irId > topId) topId = r.irId;
  }
  // irId -> position in `browser.values`, and irId -> position in the component
  // list once it is laid out depth-first.
  std::vector<std::size_t> valueSlot(static_cast<std::size_t>(topId) + 1, kNoIndex);
  for (std::size_t i = 0; i < browser.values.size(); ++i) {
    const int id = browser.values[i].irId;
    if (id > 0 && static_cast<std::size_t>(id) < valueSlot.size()) {
      valueSlot[static_cast<std::size_t>(id)] = i;
    }
  }

  const auto isComponent = [&](int irId) {
    if (irId <= 0 || static_cast<std::size_t>(irId) >= valueSlot.size()) return false;
    const std::size_t at = valueSlot[static_cast<std::size_t>(irId)];
    return at != kNoIndex && isComponentKind(browser.values[at].kind);
  };

  // THE NESTING. A component's parent is the statement that ABSORBED it, which
  // the browser already computed as `consumedBy` -- the receiver's own reading of
  // which value a later statement took. Re-deriving that rule here is how a
  // second answer to "where did my plate go" comes to exist and disagree.
  std::vector<int> parentOf(static_cast<std::size_t>(topId) + 1, 0);
  std::vector<std::vector<int>> childrenOf(static_cast<std::size_t>(topId) + 1);
  std::vector<int> rootIds;
  for (const ModelValue& v : browser.values) {
    if (!isComponentKind(v.kind)) continue;
    const bool nested = v.consumedBy != 0 && isComponent(v.consumedBy);
    if (nested) {
      parentOf[static_cast<std::size_t>(v.irId)] = v.consumedBy;
      childrenOf[static_cast<std::size_t>(v.consumedBy)].push_back(v.irId);
    } else {
      rootIds.push_back(v.irId);
    }
  }

  // Depth-first, parents before children, ids ascending at every level. The walk
  // terminates because an operand id is strictly smaller than the statement that
  // names it (IrCheck::ForwardValueRef), so `childrenOf` is a forest.
  struct Frame {
    int irId;
    std::size_t depth;
  };
  std::vector<Frame> stack;
  for (std::size_t i = rootIds.size(); i > 0; --i) stack.push_back(Frame{rootIds[i - 1], 0});

  std::vector<std::size_t> componentSlot(static_cast<std::size_t>(topId) + 1, kNoIndex);
  while (!stack.empty()) {
    const Frame f = stack.back();
    stack.pop_back();
    const std::size_t at = valueSlot[static_cast<std::size_t>(f.irId)];
    if (at == kNoIndex) continue;
    const ModelValue& v = browser.values[at];
    AssemblyComponent c;
    c.irId = v.irId;
    c.label = v.label;
    c.op = v.op;
    c.statement = v.statement;
    c.node = v.node;
    c.live = v.live;
    c.kind = v.kind;
    c.depth = f.depth;
    componentSlot[static_cast<std::size_t>(v.irId)] = out.components.size();
    if (v.live) ++out.liveComponents;
    out.components.push_back(std::move(c));
    const std::vector<int>& kids = childrenOf[static_cast<std::size_t>(f.irId)];
    for (std::size_t i = kids.size(); i > 0; --i) stack.push_back(Frame{kids[i - 1], f.depth + 1});
  }

  // The child index lists, filled once the positions are known.
  for (std::size_t i = 0; i < out.components.size(); ++i) {
    const int id = out.components[i].irId;
    for (int kid : childrenOf[static_cast<std::size_t>(id)]) {
      const std::size_t at = componentSlot[static_cast<std::size_t>(kid)];
      if (at != kNoIndex) out.components[i].children.push_back(at);
    }
  }
  for (int id : rootIds) {
    const std::size_t at = componentSlot[static_cast<std::size_t>(id)];
    if (at != kNoIndex) out.roots.push_back(at);
  }

  // THE PLACEMENTS, attached to the component they COPY rather than to the one
  // they produce: a user asking "how many of these are there" is asking about the
  // plate, not about the pattern that replicated it.
  for (const FeatureRecord& rec : records) {
    if (!isPlacementOp(rec.line.op)) continue;
    AssemblyPlacement p = readPlacement(rec, index);
    p.live = !document.nodeFor(rec.irId).empty();
    out.placedCopies += p.copies;
    const std::size_t here = out.placements.size();
    if (p.source > 0 && static_cast<std::size_t>(p.source) < componentSlot.size()) {
      const std::size_t at = componentSlot[static_cast<std::size_t>(p.source)];
      if (at != kNoIndex) out.components[at].placements.push_back(here);
    }
    out.placements.push_back(std::move(p));
  }

  return out;
}

// ── 2. THE MACHINING READING ───────────────────────────────────────────────

const char* machiningWord(MachiningKind kind) noexcept {
  switch (kind) {
    case MachiningKind::Drill: return "drilled hole";
    case MachiningKind::Counterbore: return "counterbored hole";
    case MachiningKind::Bore: return "bore";
    case MachiningKind::Cutout: return "cut-out";
    case MachiningKind::Hollow: return "hollowed pocket";
    case MachiningKind::EdgeRound: return "rounded edge";
    case MachiningKind::EdgeBreak: return "broken edge";
  }
  return "cut";
}

bool isMaterialRemovalOp(const std::string& op) {
  return op == "HOLE" || op == "CBORE" || op == "RESIZEBORE" || op == "CUT" || op == "SHELL" ||
         op == "FILLET" || op == "CHAMFER";
}

MachiningPlan buildMachiningPlan(const PartDocument& document) {
  const std::vector<FeatureRecord>& records = document.records();
  const RecordIndex index(records);
  MachiningPlan plan;

  for (const FeatureRecord& rec : records) {
    // A pass-through takes nothing away and adds nothing: it is a constraint, a
    // name or a recorded check. Counting one as a shaping statement would make
    // the census of what the model does to the material wrong in the other
    // direction.
    if (isPassThroughOp(rec.line.op)) continue;
    if (!isMaterialRemovalOp(rec.line.op)) {
      ++plan.shapingStatements;
      continue;
    }

    const std::vector<double> n = numbersOf(rec.line);
    MachiningOperation o;
    o.irId = rec.irId;
    o.order = plan.operations.size() + 1;
    o.op = rec.line.op;
    o.label = labelOf(rec);

    if (rec.line.op == "HOLE") {
      // HOLE(%body, dia, cx, cy, cz [, axx, axy, axz, depth<=0 => through])
      o.kind = MachiningKind::Drill;
      const double dia = numberAt(n, 0);
      const double depth = n.size() >= 8 ? n[7] : 0.0;
      o.through = !(n.size() >= 8 && depth > 0.0);
      o.depthMm = o.through ? 0.0 : depth;
      o.toolDiameterMm = dia > 0.0 ? dia : 0.0;
      o.action = "Drill a hole";
      o.evidence = mm(dia) + " across, " + (o.through ? "right through" : mm(depth) + " deep") +
                 ", centred at " + formatIrNumber(numberAt(n, 1)) + ", " +
                 formatIrNumber(numberAt(n, 2)) + ", " + mm(numberAt(n, 3));
      ++plan.holes;
    } else if (rec.line.op == "CBORE") {
      // CBORE(%body, dia, cboreDia, cboreDepth, cx, cy, cz [, axx, axy, axz])
      o.kind = MachiningKind::Counterbore;
      const double dia = numberAt(n, 0);
      const double cdia = numberAt(n, 1);
      const double cdepth = numberAt(n, 2);
      o.through = true;
      o.depthMm = cdepth;
      o.toolDiameterMm = dia > 0.0 ? dia : 0.0;
      o.action = "Drill and counterbore";
      o.evidence = mm(dia) + " through, opened to " + mm(cdia) + " for " + mm(cdepth);
      ++plan.holes;
    } else if (rec.line.op == "RESIZEBORE") {
      // RESIZEBORE(%body, "sel", newRadius)
      o.kind = MachiningKind::Bore;
      const double radius = numberAt(n, 0);
      o.toolDiameterMm = radius > 0.0 ? 2.0 * radius : 0.0;
      o.action = "Bore to size";
      o.evidence = "opened to " + mm(2.0 * radius) + " across";
      ++plan.holes;
    } else if (rec.line.op == "CUT") {
      // CUT(%a, %b) -- what is taken away is the SECOND body, and naming it is
      // the only useful thing this row can say: a boolean carries no dimension.
      o.kind = MachiningKind::Cutout;
      int second = 0;
      std::size_t seen = 0;
      for (const IrArg& a : rec.line.args) {
        if (a.kind != IrArgKind::Ref) continue;
        ++seen;
        if (seen == 2) { second = a.ref; break; }
      }
      const FeatureRecord* tool = index.find(second);
      o.action = "Cut a shape away";
      o.evidence = tool != nullptr ? "takes away " + labelOf(*tool)
                                 : "takes away the shape this statement names";
      ++plan.cutouts;
    } else if (rec.line.op == "SHELL") {
      // SHELL(%body, wall [, openAxx, openAxy, openAxz])
      o.kind = MachiningKind::Hollow;
      const double wall = numberAt(n, 0);
      o.action = "Hollow it out";
      o.evidence = "leaving a wall " + mm(std::fabs(wall)) + " thick";
      ++plan.cutouts;
    } else if (rec.line.op == "FILLET") {
      // FILLET(%body, radius [, sel=ALL])
      o.kind = MachiningKind::EdgeRound;
      const double radius = numberAt(n, 0);
      // An internal corner of radius r is cut by a tool whose corner radius is r,
      // which is a tool of diameter 2r. That is the number a shop needs, and it
      // is arithmetic on the statement's own argument.
      o.toolDiameterMm = radius > 0.0 ? 2.0 * radius : 0.0;
      o.action = "Round the edges";
      o.evidence = mm(radius) + " radius";
      ++plan.edgeOperations;
    } else {
      // CHAMFER(%body, dist [, sel=ALL])
      o.kind = MachiningKind::EdgeBreak;
      const double dist = numberAt(n, 0);
      o.action = "Break the edges";
      o.evidence = mm(dist) + " chamfer";
      ++plan.edgeOperations;
    }

    // The selector a FILLET or CHAMFER carries says WHICH edges, and dropping it
    // would make two different operations read identically.
    const std::string sel = keywordOf(rec.line);
    if (!sel.empty() && (o.kind == MachiningKind::EdgeRound || o.kind == MachiningKind::EdgeBreak)) {
      o.evidence += ", on the ";
      o.evidence += sel;
      o.evidence += " edges";
    }

    if (o.toolDiameterMm > 0.0 &&
        (!plan.smallestToolKnown || o.toolDiameterMm < plan.smallestToolMm)) {
      plan.smallestToolMm = o.toolDiameterMm;
      plan.smallestToolKnown = true;
    }
    plan.operations.push_back(std::move(o));
  }
  return plan;
}

// ── 3. THE DRAWING READING ─────────────────────────────────────────────────

const std::vector<SheetSize>& sheetSizeLibrary() {
  // ISO 216 trimmed sizes, landscape, smallest first.
  static const std::vector<SheetSize> table = {
      {"A4", 297.0, 210.0},  {"A3", 420.0, 297.0},   {"A2", 594.0, 420.0},
      {"A1", 841.0, 594.0},  {"A0", 1189.0, 841.0},
  };
  return table;
}

const std::vector<double>& drawingScaleLibrary() {
  // ISO 5455 preferred scales, largest first. The enlargement half is offered
  // and never chosen automatically -- see the header.
  static const std::vector<double> table = {
      50.0, 20.0, 10.0,  5.0,   2.0,   1.0,    0.5,    0.2,   0.1,
      0.05, 0.02, 0.01,  0.005, 0.002, 0.001,
  };
  return table;
}

std::string scaleLabel(double scale) {
  if (!(scale > 0.0) || !std::isfinite(scale)) return "";
  const auto whole = [](double v, long long& out) {
    const double r = std::floor(v + 0.5);
    if (std::fabs(v - r) > 1e-6 * std::max(1.0, std::fabs(v))) return false;
    out = static_cast<long long>(r);
    return true;
  };
  char buf[64];
  long long n = 0;
  if (scale >= 1.0) {
    if (whole(scale, n)) {
      std::snprintf(buf, sizeof(buf), "%lld:1", n);
      return std::string(buf);
    }
  } else if (whole(1.0 / scale, n)) {
    std::snprintf(buf, sizeof(buf), "1:%lld", n);
    return std::string(buf);
  }
  std::snprintf(buf, sizeof(buf), "%g:1", scale);
  return std::string(buf);
}

namespace {

// The projected extent of an axis-aligned box in an isometric view. The two
// horizontal axes each lie at 30 degrees to the paper's horizontal, so they
// contribute cos(30) to the width and sin(30) to the height, and the vertical
// axis contributes its whole length to the height.
void isometricExtent(double sx, double sy, double sz, double& w, double& h) {
  const double c = 0.86602540378443864676;  // cos(30 degrees)
  const double s = 0.5;                     // sin(30 degrees)
  w = (sx + sy) * c;
  h = (sx + sy) * s + sz;
}

}  // namespace

std::size_t DrawingSheetSet::rowCount() const noexcept {
  std::size_t n = sheets.size();
  for (const DrawingSheet& s : sheets) n += s.views.size();
  return n;
}

DrawingSheetSet buildDrawingSheets(const MeasureBox& box) {
  DrawingSheetSet out;
  if (!box.valid) return out;
  const double sx = box.size(0);
  const double sy = box.size(1);
  const double sz = box.size(2);
  // A box with no extent is not a small part: it is no part, and a sheet laid
  // out for it would be a sheet for nothing.
  if (!(box.diagonal() > 0.0)) return out;

  double isoW = 0.0;
  double isoH = 0.0;
  isometricExtent(sx, sy, sz, isoW, isoH);

  DrawingSheet sheet;
  sheet.name = "Sheet 1";
  sheet.marginMm = kSheetMarginMm;
  sheet.gapMm = kSheetViewGapMm;

  // The four-view general arrangement: the plan above the front view, the end
  // view beside it, the isometric in the corner the other three leave free.
  SheetView front;
  front.view = NamedView::Front;
  front.name = "Front";
  front.widthMm = sx;
  front.heightMm = sz;
  SheetView top;
  top.view = NamedView::Top;
  top.name = "Top";
  top.widthMm = sx;
  top.heightMm = sy;
  SheetView right;
  right.view = NamedView::Right;
  right.name = "Right";
  right.widthMm = sy;
  right.heightMm = sz;
  SheetView iso;
  iso.view = NamedView::Isometric;
  iso.name = "Isometric";
  iso.widthMm = isoW;
  iso.heightMm = isoH;
  sheet.views = {front, top, right, iso};

  // The footprint the arrangement occupies at full size: two columns and two
  // rows with one gap between each.
  const double fullWidth = std::max(front.widthMm, top.widthMm) + kSheetViewGapMm +
                           std::max(right.widthMm, iso.widthMm);
  const double fullHeight = std::max(top.heightMm, iso.heightMm) + kSheetViewGapMm +
                            std::max(front.heightMm, right.heightMm);

  const std::vector<SheetSize>& sizes = sheetSizeLibrary();
  const std::vector<double>& scales = drawingScaleLibrary();

  // THE SELECTION RULE, and the order of these two loops IS the rule. Scale is
  // the outer loop: a part is drawn as LARGE as the preferred series allows,
  // because the scale is what decides whether a person can read the drawing, and
  // the sheet is only the paper it takes to hold it. Reversing them would put a
  // two-metre casting on A4 at 1:20 because A4 came first in the table.
  bool chosen = false;
  for (double s : scales) {
    // Never larger than full size: enlarging is a decision about legibility and a
    // bounding box cannot make it.
    if (s > 1.0) continue;
    for (const SheetSize& size : sizes) {
      const double dw = size.widthMm - 2.0 * kSheetMarginMm;
      const double dh = size.heightMm - 2.0 * kSheetMarginMm;
      if (!(dw > 0.0) || !(dh > 0.0)) continue;
      if (fullWidth * s <= dw && fullHeight * s <= dh) {
        sheet.size = size;
        sheet.scale = s;
        sheet.drawableWidthMm = dw;
        sheet.drawableHeightMm = dh;
        sheet.fits = true;
        chosen = true;
        break;
      }
    }
    if (chosen) break;
  }
  if (!chosen) {
    // Bigger than the largest sheet at the smallest preferred reduction. Reported
    // as not fitting, at the sheet and scale that come closest, rather than at an
    // invented scale nobody could draw at.
    const SheetSize& size = sizes.back();
    sheet.size = size;
    sheet.scale = scales.back();
    sheet.drawableWidthMm = size.widthMm - 2.0 * kSheetMarginMm;
    sheet.drawableHeightMm = size.heightMm - 2.0 * kSheetMarginMm;
    sheet.fits = false;
  }

  sheet.scaleLabelText = scaleLabel(sheet.scale);
  sheet.usedWidthMm = fullWidth * sheet.scale;
  sheet.usedHeightMm = fullHeight * sheet.scale;
  for (SheetView& v : sheet.views) {
    v.paperWidthMm = v.widthMm * sheet.scale;
    v.paperHeightMm = v.heightMm * sheet.scale;
  }

  out.sheets.push_back(std::move(sheet));
  out.known = true;
  return out;
}

// ── 4. THE SIMULATION READING ──────────────────────────────────────────────

const char* toString(StudyItemState state) noexcept {
  switch (state) {
    case StudyItemState::Ready: return "ready";
    case StudyItemState::Missing: return "not set";
    case StudyItemState::Blocked: return "cannot be used";
  }
  return "not set";
}

const char* toString(StudyState state) noexcept {
  switch (state) {
    case StudyState::Answered: return "answered";
    case StudyState::Waiting: return "waiting for what it needs";
    case StudyState::Stopped: return "stopped";
  }
  return "waiting for what it needs";
}

std::size_t StudyPlan::rowCount() const noexcept {
  std::size_t n = studies.size();
  for (const Study& s : studies) n += s.setup.size();
  return n;
}

std::size_t StudyPlan::answered() const noexcept {
  std::size_t n = 0;
  for (const Study& s : studies) {
    if (s.state == StudyState::Answered) ++n;
  }
  return n;
}

namespace {

std::string number(double v, int decimals) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.*f", decimals, v);
  return std::string(buf);
}

// Every study's first input is the same one, and it is the one that decides
// whether any of them can run: a surface that does not close has no volume, so
// it cannot be balanced, weighed or meshed.
StudySetupItem shapeItem(const MeshMeasure& mesh, double volume, bool exact) {
  StudySetupItem item;
  item.name = "Shape";
  if (mesh.triangles == 0) {
    item.state = StudyItemState::Missing;
    item.evidence = "nothing has been built yet";
    return item;
  }
  if (!mesh.watertight || !(volume > 0.0)) {
    item.state = StudyItemState::Blocked;
    item.evidence = "the surface does not close: " + std::to_string(mesh.boundaryEdges) +
                  " edges are used once, " + std::to_string(mesh.nonManifoldEdges) +
                  " by more than two";
    return item;
  }
  item.state = StudyItemState::Ready;
  item.evidence = "a closed shape of " + number(volume, 3) + " mm3, " +
                std::to_string(mesh.triangles) + " triangles" +
                (exact ? ", measured exactly" : ", measured from the shape as drawn");
  return item;
}

void finish(Study& study) {
  study.missing = 0;
  study.blocked = 0;
  for (const StudySetupItem& i : study.setup) {
    if (i.state == StudyItemState::Missing) ++study.missing;
    if (i.state == StudyItemState::Blocked) ++study.blocked;
  }
  if (study.blocked > 0) {
    study.state = StudyState::Stopped;
    study.answer.clear();
  } else if (study.missing > 0) {
    study.state = StudyState::Waiting;
    study.answer.clear();
  } else {
    study.state = StudyState::Answered;
  }
}

}  // namespace

StudyPlan buildStudyPlan(const MeshMeasure& mesh, double exactVolumeMm3, const Material& material,
                         MassUnit massDisplay, const SelectionMeasure& picked) {
  const bool exact = exactVolumeMm3 > 0.0;
  const double volume = exact ? exactVolumeMm3 : (mesh.watertight ? mesh.volume : 0.0);
  StudyPlan plan;

  // ── the one that can be answered ────────────────────────────────────────
  // A homogeneous body balances about its VOLUME centroid, and no material
  // property enters that. So this study needs the shape and nothing else, and
  // where the shape is closed it has a real answer rather than a promise.
  {
    Study s;
    s.name = "Balance point";
    s.solvesFor = "the point this part balances about, and how much space it fills";
    s.setup.push_back(shapeItem(mesh, volume, exact));
    finish(s);
    if (s.state == StudyState::Answered) {
      s.answer = "balances at " + number(mesh.centroid[0], 3) + ", " +
                 number(mesh.centroid[1], 3) + ", " + number(mesh.centroid[2], 3) + " mm, " +
                 "filling " + number(volume, 3) + " mm3";
    }
    plan.studies.push_back(std::move(s));
  }

  // ── weight: the shape plus one choice the document does not carry ───────
  {
    Study s;
    s.name = "Weight";
    s.solvesFor = "what this part weighs once you say what it is made of";
    s.setup.push_back(shapeItem(mesh, volume, exact));
    StudySetupItem m;
    m.name = "Material";
    if (material.hasDensity()) {
      m.state = StudyItemState::Ready;
      m.evidence = material.name + ", " + number(material.densityKgPerM3, 0) + " kg/m3";
    } else {
      m.state = StudyItemState::Missing;
      // The range is REAL: it is the library this application already ships,
      // measured, so "not set" carries the size of the answer it is holding up.
      std::size_t withDensity = 0;
      double lo = 0.0;
      double hi = 0.0;
      for (const Material& lib : materialLibrary()) {
        if (!lib.hasDensity()) continue;
        if (withDensity == 0 || lib.densityKgPerM3 < lo) lo = lib.densityKgPerM3;
        if (withDensity == 0 || lib.densityKgPerM3 > hi) hi = lib.densityKgPerM3;
        ++withDensity;
      }
      m.evidence = "no material chosen yet; " + std::to_string(withDensity) +
                 " in the list carry a density, from " + number(lo, 0) + " to " + number(hi, 0) +
                 " kg/m3";
    }
    s.setup.push_back(std::move(m));
    finish(s);
    if (s.state == StudyState::Answered) {
      s.answer = describeMass(massPropertiesOf(material, volume), massDisplay);
    }
    plan.studies.push_back(std::move(s));
  }

  // ── stress: what is missing, named one input at a time ──────────────────
  {
    Study s;
    s.name = "Stress under load";
    s.solvesFor = "how far this part moves under load, and where it is worked hardest";
    s.setup.push_back(shapeItem(mesh, volume, exact));
    StudySetupItem stiffness;
    stiffness.name = "Stiffness";
    stiffness.state = StudyItemState::Missing;
    stiffness.evidence =
        "the material list carries a density and a colour, and a stiffness has to be added before "
        "this can be worked out";
    s.setup.push_back(std::move(stiffness));
    // Both of these are FACES, so both read the live selection: what a user has
    // picked is what they would apply, and a row that cannot see it can only ever
    // say the same sentence.
    const std::string pickedFaces =
        std::to_string(picked.faces) + (picked.faces == 1 ? " face is picked, " : " faces are picked, ") +
        number(picked.area, 3) + " mm2 in all";
    StudySetupItem held;
    held.name = "Held by";
    held.state = StudyItemState::Missing;
    held.evidence = picked.faces == 0
                      ? "nothing holds this part still yet: pick the faces it is bolted or "
                        "clamped by"
                      : pickedFaces + ", and none of them is holding it yet";
    s.setup.push_back(std::move(held));
    StudySetupItem loads;
    loads.name = "Loaded by";
    loads.state = StudyItemState::Missing;
    loads.evidence = picked.faces == 0
                       ? "nothing pushes or pulls on it yet: pick a face and give it a force"
                       : pickedFaces + ", and nothing is pushing on them yet";
    s.setup.push_back(std::move(loads));
    finish(s);
    plan.studies.push_back(std::move(s));
  }

  return plan;
}

}  // namespace forge::ui
