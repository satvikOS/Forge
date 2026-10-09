// forge-desktop/test/drawing_export_gate.cpp
//
// THE DRAWING-EXPORT GATE (T-230) — headless, on the application's own part,
// through the ONE command registry, reading the files back off the disk.
//
// ── THE GAP, MEASURED on origin/archdisc b609b41d ───────────────────────────
// The Drawing workspace chose a sheet, a scale and a projection, and kept a
// title block -- and no command, writer or menu item produced a drawing in any
// format. The directive's canonical fixture step "produce a drawing" had no
// artifact. This gate, compiled against that tree, is RED on its first check:
// `file.export_drawing` is not a registered command.
//
// ── THE PART AND ITS ORACLE ─────────────────────────────────────────────────
// The starting part every new document opens on (PartFile.cpp makeDefaultPart):
//   %1 RECT(80, 50)   %2 EXTRUDE 20   %3 CYL r6 h40 at (0,0,-10)   %4 CUT   %5 FILLET r3
// so the drawing's every number is known BY HAND: an 80 x 50 x 20 plate,
// centred on the origin in X and Y, standing on z = 0, with a 12 mm through
// bore at (0, 0). The hand numbers are first checked against the kernel's own
// bounding box (a second, independent oracle), and the files are then judged
// against the hand numbers -- never against what the writer says it wrote.
//
// ── WHAT IS ASSERTED, on the SVG AND the DXF ────────────────────────────────
//   1. THE COMMAND EXISTS AND IS WIRED. Registered in File with one required
//      path; DISABLED in a shell with no drawing source; the frame installs
//      itself as that source.
//   2. EVERY VIEW IS THE PART AT THE CHOSEN SCALE. Each of the three views'
//      ink extents on paper equals the part's extent in that view times the
//      scale, rel <= 1e-3. The scale is the app's chosen one AND equals
//      fitScale() recomputed here from the hand numbers.
//   3. THE BORE IS HIDDEN, AND ONLY HIDDEN. In the front and side views the
//      bore's two silhouettes are dashed lines at +-6 mm from its axis spanning
//      the whole thickness; no visible vertical line stands there. In the top
//      view the bore is a visible circle of radius 6 about its axis.
//   4. THE VIEWS ARE WHERE THE DOCUMENT'S PROJECTION PUTS THEM. First angle:
//      top view below, side view left. Third angle: above and right. Both are
//      exported and both are checked, with the shared edges aligned.
//   5. THE TITLE BLOCK CARRIES THE SHEET, THE SCALE, THE PROJECTION AND THE
//      PART SIZE -- the part size it carries is the part being drawn.
//   6. THE DXF IS THE SAME DRAWING. Every LINE falls inside exactly one view of
//      the SVG, each view has the same extents and the same ink length per
//      line class, and hidden lines are on the HIDDEN layer.
//   7. ASSOCIATIVITY. The plate's width is edited 80 -> 100 and the bore is
//      moved 0 -> 20 mm, through part.edit_feature, and the drawing must move by
//      EXACTLY scale x delta: front and top grow by 20 x scale, the bore's
//      hidden lines and circle move by 20 x scale, and the side view -- which
//      looks along X -- does not change: its visible lines, and the hidden lines
//      no visible line covers, are compared after each edit as point sets, both
//      ways, to 1e-3 mm (a summed hidden length is NOT compared: it counts a
//      hidden edge lying under a visible one, which the HLR may report either
//      way). Two undos restore the first drawing BYTE FOR BYTE.
//   8. REFUSALS. A .pdf name, a folder that is not there and an empty name are
//      refused in plain words and write nothing.
//   9. A PART THE VIEWS CANNOT COVER. A round boss (the native importer defers a
//      circle extrusion) is refused in plain words, writes nothing, and logs the
//      technical cause -- the honest edge of what this export can draw today.
//
// ── PROVING IT CAN FAIL: --mutate <n> ───────────────────────────────────────
// The application carries no mutation switch. The gate installs its OWN
// forge::ui::DrawingSource in front of the frame's -- the shell accepts any --
// and corrupts what the frame hands over, one defect per number:
//   1  hidden edges handed over as visible      5  the FIRST sheet re-sent for
//   2  hidden edges dropped                         ever after (a stale drawing)
//   3  views at 1:1 while the title says the    6  every view mirrored left-right
//      chosen scale                             7  the title block's scale row
//   4  views placed by the OTHER projection         says 1:1
//      angle                                    8  top and side views swap cells
//   9  a part that CANNOT be drawn gets the last sheet that could be (the
//      previous part's drawing saved under the new name) -- section 9's refusal
// run_desktop.sh runs each and requires a non-zero exit.
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

#include <unistd.h>

#include "imgui.h"

#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/Drawing.hpp"
#include "forge/ui/FileExchange.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Types.hpp"

// The seam this gate's mutations go through. Probed rather than assumed so the
// SAME source compiles against a tree that predates the drawing egress, which
// is how its failing-first verdict was measured (RED: command not found). On
// such a tree there is nothing to corrupt and the mutations are inert -- every
// check is red anyway.
#if __has_include("forge/ui/DrawingExport.hpp")
#include "forge/ui/DrawingExport.hpp"
#define FORGE_GATE_HAS_DRAWING_EXPORT 1
#else
#define FORGE_GATE_HAS_DRAWING_EXPORT 0
#endif

namespace {

constexpr double kPi = 3.14159265358979323846;

int g_mutation = 0;
std::size_t g_checks = 0;
std::size_t g_failures = 0;

void check(bool ok, const std::string& what, const std::string& detail = std::string()) {
  ++g_checks;
  if (ok) return;
  ++g_failures;
  std::printf("  FAIL  %-62s  %s\n", what.c_str(), detail.c_str());
}

void checkNear(double got, double want, double tol, const std::string& what) {
  ++g_checks;
  if (std::isfinite(got) && std::fabs(got - want) <= tol) return;
  ++g_failures;
  std::printf("  FAIL  %-62s  got %.6f, want %.6f (tol %.3g)\n", what.c_str(), got, want, tol);
}

// rel <= 1e-3, the acceptance tolerance for an extent on paper.
void checkRel(double got, double want, const std::string& what) {
  checkNear(got, want, 1e-3 * std::max(1.0, std::fabs(want)), what);
}

struct HeadlessImGui {
  HeadlessImGui(float w, float h) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(w, h);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "drawing_export_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0;
    int th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

void step(forge::desktop::ForgeFrame& frame) {
  ImGui::NewFrame();
  frame.build(0, 1.0f);
  ImGui::Render();
}

// TMPDIR, and the PROCESS ID in the name: two copies of this gate (two agents,
// a ctest -j) must never read each other's half-written files.
std::string tempPath(const std::string& leaf) {
  const char* tmp = std::getenv("TMPDIR");
  std::string dir = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!dir.empty() && dir.back() != '/') dir += '/';
  return dir + std::to_string(static_cast<long long>(::getpid())) + "_" + leaf;
}

std::string readWholeFile(const std::string& path, bool& ok) {
  std::ifstream in(path, std::ios::binary);
  ok = static_cast<bool>(in);
  if (!ok) return std::string();
  std::ostringstream b;
  b << in.rdbuf();
  return b.str();
}

bool onDisk(const std::string& path) {
  std::error_code ec;
  return std::filesystem::exists(path, ec);
}

// FORGE_DRAWING_GATE_KEEP=<existing folder> keeps a copy of the first SVG and DXF
// the gate saved, so a reviewer can OPEN the drawing this gate judged. Off by
// default; never read back, so it cannot change a verdict.
void keepCopy(const char* leaf, const std::string& bytes) {
  const char* dir = std::getenv("FORGE_DRAWING_GATE_KEEP");
  if (dir == nullptr || dir[0] == 0) return;
  std::ofstream out(std::string(dir) + "/" + leaf, std::ios::binary | std::ios::trunc);
  out << bytes;
}

// ════════════════════════════════════════════════════════════════════════════
// READING THE FILES BACK. Deliberately small and deliberately strict: anything
// the reader does not find is a missing view or a missing row, never a guess.
// Paper coordinates are millimetres with y UP, as the DXF has them; the SVG's
// y is flipped once, here.
// ════════════════════════════════════════════════════════════════════════════
using Pt = std::array<double, 2>;
using Poly = std::vector<Pt>;

struct Box {
  bool valid = false;
  double minX = 0, minY = 0, maxX = 0, maxY = 0;
  void add(const Pt& p) {
    if (!valid) {
      minX = maxX = p[0];
      minY = maxY = p[1];
      valid = true;
      return;
    }
    minX = std::min(minX, p[0]);
    maxX = std::max(maxX, p[0]);
    minY = std::min(minY, p[1]);
    maxY = std::max(maxY, p[1]);
  }
  double w() const { return maxX - minX; }
  double h() const { return maxY - minY; }
  bool contains(const Pt& p, double slack) const {
    return valid && p[0] >= minX - slack && p[0] <= maxX + slack && p[1] >= minY - slack &&
           p[1] <= maxY + slack;
  }
};

double length(const Poly& p) {
  double l = 0.0;
  for (std::size_t i = 1; i < p.size(); ++i) {
    l += std::hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  }
  return l;
}

struct ViewInk {
  std::vector<Poly> visible;
  std::vector<Poly> hidden;
  Box box;  // over BOTH classes: the view's ink
  double visibleLen = 0.0;
  double hiddenLen = 0.0;
};

struct SvgDrawing {
  bool ok = false;
  std::string why;
  double W = 0.0, H = 0.0;
  std::string scale, sheet, projection;
  std::map<std::string, ViewInk> views;              // by data-view
  std::map<std::string, std::string> titleValues;    // by data-key
};

std::string attr(const std::string& tag, const std::string& name) {
  const std::string key = " " + name + "=\"";
  const std::size_t at = tag.find(key);
  if (at == std::string::npos) return std::string();
  const std::size_t start = at + key.size();
  const std::size_t end = tag.find('"', start);
  if (end == std::string::npos) return std::string();
  return tag.substr(start, end - start);
}

std::string xmlUnescape(std::string s) {
  const std::pair<const char*, const char*> table[] = {
      {"&lt;", "<"}, {"&gt;", ">"}, {"&quot;", "\""}, {"&apos;", "'"}, {"&amp;", "&"}};
  for (const auto& kv : table) {
    for (std::size_t at = s.find(kv.first); at != std::string::npos;
         at = s.find(kv.first, at + 1)) {
      s.replace(at, std::strlen(kv.first), kv.second);
    }
  }
  return s;
}

std::vector<Poly> polylinesIn(const std::string& block, double H) {
  std::vector<Poly> out;
  for (std::size_t at = block.find("<polyline points=\""); at != std::string::npos;
       at = block.find("<polyline points=\"", at + 1)) {
    const std::size_t start = at + std::strlen("<polyline points=\"");
    const std::size_t end = block.find('"', start);
    if (end == std::string::npos) break;
    std::istringstream in(block.substr(start, end - start));
    Poly p;
    std::string pair;
    while (in >> pair) {
      const std::size_t comma = pair.find(',');
      if (comma == std::string::npos) continue;
      p.push_back({std::atof(pair.substr(0, comma).c_str()),
                   H - std::atof(pair.substr(comma + 1).c_str())});
    }
    out.push_back(std::move(p));
  }
  return out;
}

// The text between `<g class="<cls>"` and the first `</g>` after it.
std::string groupBlock(const std::string& view, const char* cls) {
  const std::string open = std::string("<g class=\"") + cls + "\"";
  const std::size_t at = view.find(open);
  if (at == std::string::npos) return std::string();
  const std::size_t end = view.find("</g>", at);
  return view.substr(at, end == std::string::npos ? std::string::npos : end - at);
}

SvgDrawing readSvg(const std::string& text) {
  SvgDrawing d;
  const std::size_t root = text.find("<svg ");
  if (root == std::string::npos) {
    d.why = "no <svg> element";
    return d;
  }
  const std::string rootTag = text.substr(root, text.find('>', root) - root);
  {
    std::istringstream vb(attr(rootTag, "viewBox"));
    double x0 = 0, y0 = 0;
    vb >> x0 >> y0 >> d.W >> d.H;
  }
  if (!(d.W > 0.0) || !(d.H > 0.0)) {
    d.why = "no usable viewBox";
    return d;
  }
  d.scale = attr(rootTag, "data-scale");
  d.sheet = attr(rootTag, "data-sheet");
  d.projection = attr(rootTag, "data-projection");

  const std::string viewOpen = "<g id=\"view-";
  for (std::size_t at = text.find(viewOpen); at != std::string::npos;
       at = text.find(viewOpen, at + 1)) {
    const std::string tag = text.substr(at, text.find('>', at) - at);
    std::size_t end = text.find(viewOpen, at + 1);
    const std::size_t title = text.find("<g id=\"title-block\"", at);
    if (end == std::string::npos || (title != std::string::npos && title < end)) end = title;
    const std::string block = text.substr(at, end == std::string::npos ? std::string::npos
                                                                        : end - at);
    ViewInk v;
    v.visible = polylinesIn(groupBlock(block, "visible"), d.H);
    v.hidden = polylinesIn(groupBlock(block, "hidden"), d.H);
    for (const Poly& p : v.visible) {
      v.visibleLen += length(p);
      for (const Pt& q : p) v.box.add(q);
    }
    for (const Poly& p : v.hidden) {
      v.hiddenLen += length(p);
      for (const Pt& q : p) v.box.add(q);
    }
    d.views[attr(tag, "data-view")] = std::move(v);
  }

  const std::string valueOpen = "<text class=\"value\"";
  for (std::size_t at = text.find(valueOpen); at != std::string::npos;
       at = text.find(valueOpen, at + 1)) {
    const std::size_t close = text.find('>', at);
    const std::size_t endText = text.find("</text>", close);
    if (close == std::string::npos || endText == std::string::npos) break;
    const std::string tag = text.substr(at, close - at);
    d.titleValues[attr(tag, "data-key")] = xmlUnescape(text.substr(close + 1, endText - close - 1));
  }
  d.ok = true;
  return d;
}

struct DxfLine {
  std::string layer;
  Pt a{}, b{};
};
struct DxfText {
  std::string layer;
  std::string text;
};
struct DxfDrawing {
  bool ok = false;
  std::string version;
  std::vector<DxfLine> lines;
  std::vector<DxfText> texts;
};

DxfDrawing readDxf(const std::string& text) {
  DxfDrawing d;
  std::vector<std::string> rows;
  {
    std::istringstream in(text);
    std::string row;
    while (std::getline(in, row)) {
      if (!row.empty() && row.back() == '\r') row.pop_back();
      rows.push_back(row);
    }
  }
  if (rows.size() % 2 != 0) return d;
  std::string kind;
  DxfLine line;
  DxfText txt;
  bool sawVersionKey = false;
  const auto flush = [&]() {
    if (kind == "LINE") d.lines.push_back(line);
    if (kind == "TEXT") d.texts.push_back(txt);
    line = DxfLine{};
    txt = DxfText{};
  };
  bool eof = false;
  for (std::size_t i = 0; i + 1 < rows.size(); i += 2) {
    const int code = std::atoi(rows[i].c_str());
    const std::string& v = rows[i + 1];
    if (code == 0) {
      flush();
      kind = v;
      if (v == "EOF") eof = true;
      continue;
    }
    if (code == 9) sawVersionKey = (v == "$ACADVER");
    if (code == 1 && sawVersionKey && d.version.empty()) {
      d.version = v;
      sawVersionKey = false;
      continue;
    }
    if (kind == "LINE") {
      if (code == 8) line.layer = v;
      if (code == 10) line.a[0] = std::atof(v.c_str());
      if (code == 20) line.a[1] = std::atof(v.c_str());
      if (code == 11) line.b[0] = std::atof(v.c_str());
      if (code == 21) line.b[1] = std::atof(v.c_str());
    } else if (kind == "TEXT") {
      if (code == 8) txt.layer = v;
      if (code == 1) txt.text = v;
    }
  }
  flush();
  d.ok = eof;
  return d;
}

// ════════════════════════════════════════════════════════════════════════════
// WHAT THE DRAWING MUST BE, by hand.
// ════════════════════════════════════════════════════════════════════════════
struct Expect {
  double sx = 80.0, sy = 50.0, sz = 20.0;  // the plate, centred in X and Y, z in [0, sz]
  double holeX = 0.0, holeY = 0.0;         // the bore's axis
  double boreR = 6.0;
  double factor = 1.0;                     // the APP's chosen scale
  forge::ui::Scale scale{1, 1};
  forge::ui::ProjectionAngle projection = forge::ui::ProjectionAngle::First;
  std::string sheetId;
  std::string sheetLabel;
};

// Ink of one class lying on the vertical line x = `x` (paper) within `tol`,
// summed over every polyline segment that is itself vertical there.
double verticalInkAt(const std::vector<Poly>& set, double x, double tol) {
  double len = 0.0;
  for (const Poly& p : set) {
    for (std::size_t i = 1; i < p.size(); ++i) {
      if (std::fabs(p[i][0] - x) <= tol && std::fabs(p[i - 1][0] - x) <= tol) {
        len += std::fabs(p[i][1] - p[i - 1][1]);
      }
    }
  }
  return len;
}

// The leftmost hidden line that spans the view's whole height and that no
// visible line covers -- in a front or side view of this plate, that is the
// bore's near silhouette and nothing else. Paper mm from the view's left edge;
// -1 when there is none.
double leftmostBoreLine(const SvgDrawing& d, const char* name) {
  const auto it = d.views.find(name);
  if (it == d.views.end()) return -1.0;
  const ViewInk& v = it->second;
  double best = -1.0;
  for (const Poly& p : v.hidden) {
    for (std::size_t i = 1; i < p.size(); ++i) {
      const double x = p[i][0];
      if (std::fabs(p[i - 1][0] - x) > 1e-6) continue;
      if (std::fabs(p[i][1] - p[i - 1][1]) < v.box.h() * (1.0 - 1e-3)) continue;
      if (verticalInkAt(v.visible, x, 1e-3) > 0.0) continue;
      const double rel = x - v.box.minX;
      if (best < 0.0 || rel < best) best = rel;
    }
  }
  return best;
}

// ── THE DRAWN PICTURE, as a set ─────────────────────────────────────────────
// A summed ink length counts a hidden edge lying exactly under a visible one --
// the back outline of a plate seen square-on -- and the HLR may report such a
// coincident span either way (it is on the occluder's own outline). So "the view
// did not change" is asked of what a reader SEES: the visible ink, and the hidden
// ink that no visible line covers, each compared both ways as point sets sampled
// every 0.05 mm of paper and matched within 1e-3 mm. A line that moved, appeared
// or vanished anywhere is a failure; a duplicate under a visible line is not.
double distToSeg(const Pt& p, const Pt& a, const Pt& b) {
  const double ax = b[0] - a[0];
  const double ay = b[1] - a[1];
  const double l2 = ax * ax + ay * ay;
  double t = 0.0;
  if (l2 > 0.0) t = std::clamp(((p[0] - a[0]) * ax + (p[1] - a[1]) * ay) / l2, 0.0, 1.0);
  return std::hypot(a[0] + t * ax - p[0], a[1] + t * ay - p[1]);
}

bool onInk(const Pt& p, const std::vector<Poly>& set, double tol) {
  for (const Poly& q : set) {
    for (std::size_t i = 1; i < q.size(); ++i) {
      if (distToSeg(p, q[i - 1], q[i]) <= tol) return true;
    }
  }
  return false;
}

// Paper length of `a`'s ink that is NOT on `b` (and, when `unlessOn` is given,
// not on that either). `shift` moves `a` before the test, so two views placed
// at different spots on the sheet are compared from their own corners.
double inkNotOn(const std::vector<Poly>& a, const Pt& shift, const std::vector<Poly>& b,
                const std::vector<Poly>* unlessOn = nullptr) {
  constexpr double kStep = 0.05;
  constexpr double kTol = 1e-3;
  double missing = 0.0;
  for (const Poly& p : a) {
    for (std::size_t i = 1; i < p.size(); ++i) {
      const double len = std::hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      const int n = std::max(1, static_cast<int>(std::ceil(len / kStep)));
      for (int k = 0; k < n; ++k) {
        const double t = (k + 0.5) / n;
        const Pt q{p[i - 1][0] + t * (p[i][0] - p[i - 1][0]) + shift[0],
                   p[i - 1][1] + t * (p[i][1] - p[i - 1][1]) + shift[1]};
        if (onInk(q, b, kTol)) continue;
        if (unlessOn != nullptr && onInk(q, *unlessOn, kTol)) continue;
        missing += len / n;
      }
    }
  }
  return missing;
}

// Asserts view `name` of `x` draws the same picture as view `name` of `y`, each
// read from its own lower-left ink corner.
void checkSamePicture(const SvgDrawing& x, const SvgDrawing& y, const char* name,
                      const std::string& what) {
  const auto ix = x.views.find(name);
  const auto iy = y.views.find(name);
  check(ix != x.views.end() && iy != y.views.end(), what + ": the view is in both files", name);
  if (ix == x.views.end() || iy == y.views.end()) return;
  const ViewInk& a = ix->second;
  const ViewInk& b = iy->second;
  const Pt ab{b.box.minX - a.box.minX, b.box.minY - a.box.minY};
  const Pt ba{-ab[0], -ab[1]};
  const double visAB = inkNotOn(a.visible, ab, b.visible);
  const double visBA = inkNotOn(b.visible, ba, a.visible);
  // Hidden ink that a visible line covers is not part of the picture; compared
  // against the other file's hidden ink, a covered span is excused by EITHER
  // file's visible ink (shifted into the frame being tested).
  std::vector<Poly> bVisInA;
  for (const Poly& p : b.visible) {
    Poly q;
    for (const Pt& r : p) q.push_back({r[0] + ba[0], r[1] + ba[1]});
    bVisInA.push_back(std::move(q));
  }
  std::vector<Poly> aVisShiftedOut;
  for (const Poly& p : a.visible) {
    Poly q;
    for (const Pt& r : p) q.push_back({r[0] + ab[0], r[1] + ab[1]});
    aVisShiftedOut.push_back(std::move(q));
  }
  std::vector<Poly> visInB = b.visible;
  visInB.insert(visInB.end(), aVisShiftedOut.begin(), aVisShiftedOut.end());
  std::vector<Poly> visInA = a.visible;
  visInA.insert(visInA.end(), bVisInA.begin(), bVisInA.end());
  const double hidAB = inkNotOn(a.hidden, ab, b.hidden, &visInB);
  const double hidBA = inkNotOn(b.hidden, ba, a.hidden, &visInA);
  std::printf("[drawing_export_gate] %s view picture diff: visible %.4f / %.4f mm, uncovered "
              "hidden %.4f / %.4f mm\n",
              name, visAB, visBA, hidAB, hidBA);
  checkNear(visAB + visBA, 0.0, 1e-9, what + ": the same VISIBLE lines, both ways");
  checkNear(hidAB + hidBA, 0.0, 1e-9, what + ": the same uncovered HIDDEN lines, both ways");
}

// The view checks shared by the front and the side view: extent, and the bore's
// two silhouettes as hidden lines at axis +- r and nothing visible there.
void checkBoreView(const SvgDrawing& d, const char* name, double widthModel, double axisModel,
                   const Expect& e, const std::string& tag) {
  const auto it = d.views.find(name);
  check(it != d.views.end(), tag + ": the " + name + " view is in the file", "");
  if (it == d.views.end()) return;
  const ViewInk& v = it->second;
  const double f = e.factor;
  checkRel(v.box.w(), widthModel * f, tag + ": " + name + " view width = part x scale");
  checkRel(v.box.h(), e.sz * f, tag + ": " + name + " view height = part x scale");
  check(!v.hidden.empty(), tag + ": the " + name + " view HAS hidden lines (the bore)",
        std::to_string(v.hidden.size()) + " hidden polylines");
  // model coordinate along the view's right axis -> paper x
  const auto paperX = [&](double model) { return v.box.minX + (model + widthModel / 2.0) * f; };
  const double tol = 1e-3;
  for (const double side : {-1.0, 1.0}) {
    const double x = paperX(axisModel + side * e.boreR);
    const double hidden = verticalInkAt(v.hidden, x, tol);
    const double visible = verticalInkAt(v.visible, x, tol);
    char where[96];
    std::snprintf(where, sizeof(where), "%s view, bore silhouette at %+.1f mm", name,
                  axisModel + side * e.boreR);
    checkRel(hidden, e.sz * f, tag + ": " + where + " is a full-height HIDDEN line");
    checkNear(visible, 0.0, 1e-6, tag + ": " + where + " has NO visible line");
  }
}

void checkSheet(const SvgDrawing& d, const Expect& e, const std::string& tag) {
  check(d.ok, tag + ": the SVG reads back", d.why);
  if (!d.ok) return;
  const double f = e.factor;

  // ── the sheet, the scale, the projection ───────────────────────────────
  check(d.sheet == e.sheetId, tag + ": the file is on the sheet the document names",
        d.sheet + " vs " + e.sheetId);
  forge::ui::Scale fileScale{0, 0};
  check(forge::ui::scaleFromText(d.scale, fileScale) && fileScale == e.scale,
        tag + ": the file is drawn at the scale the app chose", d.scale + " vs " + e.scale.text());
  check(d.projection == forge::ui::toString(e.projection),
        tag + ": the file says the document's projection", d.projection);

  // ── 2/3. every view is the part at the scale; the bore is hidden ────────
  checkBoreView(d, "Front", e.sx, e.holeX, e, tag);
  checkBoreView(d, "Right", e.sy, e.holeY, e, tag);
  const auto top = d.views.find("Top");
  check(top != d.views.end(), tag + ": the Top view is in the file", "");
  if (top != d.views.end()) {
    const ViewInk& v = top->second;
    checkRel(v.box.w(), e.sx * f, tag + ": Top view width = part X x scale");
    checkRel(v.box.h(), e.sy * f, tag + ": Top view height = part Y x scale");
    // The bore, seen down its axis: a VISIBLE circle of radius r about the axis.
    const double cx = v.box.minX + (e.holeX + e.sx / 2.0) * f;
    const double cy = v.box.minY + (e.holeY + e.sy / 2.0) * f;
    double onCircle = 0.0;
    for (const Poly& p : v.visible) {
      bool all = p.size() >= 2;
      for (const Pt& q : p) {
        if (std::fabs(std::hypot(q[0] - cx, q[1] - cy) - e.boreR * f) > 1e-3) all = false;
      }
      if (all) onCircle += length(p);
    }
    // Chorded: a 64-gon is 0.04% short of the circle; 0.2% is the allowance.
    check(onCircle >= 2.0 * kPi * e.boreR * f * (1.0 - 2e-3),
          tag + ": the Top view shows the bore as a visible circle about its axis",
          std::to_string(onCircle) + " mm of circle vs " +
              std::to_string(2.0 * kPi * e.boreR * f));
  }

  // ── 4. placement by the DOCUMENT's projection ──────────────────────────
  const auto fr = d.views.find("Front");
  const auto rt = d.views.find("Right");
  if (fr != d.views.end() && top != d.views.end() && rt != d.views.end()) {
    const Box& F = fr->second.box;
    const Box& T = top->second.box;
    const Box& R = rt->second.box;
    if (e.projection == forge::ui::ProjectionAngle::Third) {
      check(T.minY > F.maxY, tag + ": third angle: the top view is ABOVE the front view", "");
      check(R.minX > F.maxX, tag + ": third angle: the side view is RIGHT of the front view", "");
    } else {
      check(T.maxY < F.minY, tag + ": first angle: the top view is BELOW the front view", "");
      check(R.maxX < F.minX, tag + ": first angle: the side view is LEFT of the front view", "");
    }
    checkNear(T.minX, F.minX, 1e-3, tag + ": top and front share a column edge (projected)");
    checkNear(R.minY, F.minY, 1e-3, tag + ": side and front share a row edge (projected)");
  }

  // ── 5. the title block ─────────────────────────────────────────────────
  const auto row = [&](const char* key) {
    const auto it = d.titleValues.find(key);
    return it == d.titleValues.end() ? std::string() : it->second;
  };
  check(row("sheet") == e.sheetLabel, tag + ": the title block names the sheet", row("sheet"));
  check(row("scale").rfind(e.scale.text() + " ", 0) == 0 || row("scale") == e.scale.text(),
        tag + ": the title block's scale is the scale the views are drawn at", row("scale"));
  check(row("projection") == forge::ui::projectionLabel(e.projection),
        tag + ": the title block names the projection", row("projection"));
  char size[128];
  std::snprintf(size, sizeof(size), "%.2f x %.2f x %.2f mm", e.sx, e.sy, e.sz);
  check(row("part_size") == size, tag + ": the title block's part size is the part drawn",
        row("part_size") + " vs " + size);
}

// The DXF against the SVG of the same sheet: same views, same extents, same
// ink per class, every line inside exactly one view.
void checkDxfMatchesSvg(const DxfDrawing& x, const SvgDrawing& s, const Expect& e,
                        const std::string& tag) {
  check(x.ok, tag + ": the DXF reads back to its EOF", "");
  check(x.version == "AC1009", tag + ": the DXF is R12 (AC1009)", x.version);
  struct Acc {
    Box box;
    double visibleLen = 0.0, hiddenLen = 0.0;
  };
  std::map<std::string, Acc> acc;
  std::size_t stray = 0;
  std::size_t ambiguous = 0;
  std::size_t inkLines = 0;
  for (const DxfLine& l : x.lines) {
    if (l.layer != "VISIBLE" && l.layer != "HIDDEN") continue;
    ++inkLines;
    std::string owner;
    std::size_t owners = 0;
    for (const auto& kv : s.views) {
      if (kv.second.box.contains(l.a, 1e-3) && kv.second.box.contains(l.b, 1e-3)) {
        owner = kv.first;
        ++owners;
      }
    }
    if (owners == 0) ++stray;
    if (owners > 1) ++ambiguous;
    if (owners != 1) continue;
    Acc& a = acc[owner];
    a.box.add(l.a);
    a.box.add(l.b);
    const double len = std::hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
    (l.layer == "HIDDEN" ? a.hiddenLen : a.visibleLen) += len;
  }
  check(inkLines > 0, tag + ": the DXF has drawn lines", "");
  check(stray == 0, tag + ": every DXF line lies inside a view of the drawing",
        std::to_string(stray) + " stray");
  check(ambiguous == 0, tag + ": no DXF line lies in two views", std::to_string(ambiguous));
  for (const auto& kv : s.views) {
    const Acc& a = acc[kv.first];
    checkNear(a.box.minX, kv.second.box.minX, 1e-3, tag + ": DXF " + kv.first + " left edge");
    checkNear(a.box.maxX, kv.second.box.maxX, 1e-3, tag + ": DXF " + kv.first + " right edge");
    checkNear(a.box.minY, kv.second.box.minY, 1e-3, tag + ": DXF " + kv.first + " bottom edge");
    checkNear(a.box.maxY, kv.second.box.maxY, 1e-3, tag + ": DXF " + kv.first + " top edge");
    checkRel(a.visibleLen, kv.second.visibleLen, tag + ": DXF " + kv.first + " visible ink");
    checkRel(a.hiddenLen, kv.second.hiddenLen, tag + ": DXF " + kv.first + " hidden ink");
  }
  bool sheetText = false;
  bool scaleText = false;
  for (const DxfText& t : x.texts) {
    if (t.text == e.sheetLabel) sheetText = true;
    if (t.text.rfind(e.scale.text(), 0) == 0) scaleText = true;
  }
  check(sheetText, tag + ": the DXF title block names the sheet", e.sheetLabel);
  check(scaleText, tag + ": the DXF title block names the scale", e.scale.text());
}

#if FORGE_GATE_HAS_DRAWING_EXPORT
// ── the mutation source ─────────────────────────────────────────────────────
// Sits in front of the frame's DrawingSource. With no mutation it hands the
// frame's sheet through untouched, so the clean run goes through exactly the
// path every mutated run does.
class MutatingSource final : public forge::ui::DrawingSource {
 public:
  MutatingSource(forge::ui::DrawingSource& inner, int mutation)
      : inner_(inner), mutation_(mutation) {}
  bool hasDrawing() override { return inner_.hasDrawing(); }
  bool drawingSheet(forge::ui::DrawingSheetContent& out) override {
    if (!inner_.drawingSheet(out)) {
      // MUTATION 9: when the part cannot be drawn, hand over the last sheet
      // that could be -- the previous part's drawing saved under this one's name.
      if (mutation_ == 9 && haveLast_) {
        out = last_;
        return true;
      }
      return false;
    }
    if (mutation_ == 9) {
      last_ = out;
      haveLast_ = true;
    }
    if (mutation_ == 5) {
      if (!haveFirst_) {
        first_ = out;
        haveFirst_ = true;
      } else {
        out = first_;
      }
    }
    switch (mutation_) {
      case 1:
        for (forge::ui::DrawingViewLines& v : out.views) {
          v.visible.insert(v.visible.end(), v.hidden.begin(), v.hidden.end());
          v.hidden.clear();
        }
        break;
      case 2:
        for (forge::ui::DrawingViewLines& v : out.views) v.hidden.clear();
        break;
      case 3:
        out.scale = forge::ui::Scale{1, 1};
        break;
      case 4:
        out.projection = out.projection == forge::ui::ProjectionAngle::First
                             ? forge::ui::ProjectionAngle::Third
                             : forge::ui::ProjectionAngle::First;
        break;
      case 6:
        for (forge::ui::DrawingViewLines& v : out.views) {
          const double lo = v.minRight;
          const double hi = v.maxRight;
          for (std::vector<forge::ui::DrawingPolyline>* set : {&v.visible, &v.hidden}) {
            for (forge::ui::DrawingPolyline& pl : *set) {
              for (std::array<double, 2>& q : pl.points) q[0] = lo + hi - q[0];
            }
          }
        }
        break;
      case 7:
        for (forge::ui::TitleBlockField& f : out.titleBlock) {
          if (f.key == "scale") f.value = "1:1";
        }
        break;
      case 8:
        for (forge::ui::DrawingViewLines& v : out.views) {
          if (v.view == forge::ui::NamedView::Top) {
            v.view = forge::ui::NamedView::Right;
          } else if (v.view == forge::ui::NamedView::Right) {
            v.view = forge::ui::NamedView::Top;
          }
        }
        break;
      default:
        break;
    }
    return true;
  }

 private:
  forge::ui::DrawingSource& inner_;
  int mutation_ = 0;
  bool haveFirst_ = false;
  forge::ui::DrawingSheetContent first_;
  bool haveLast_ = false;
  forge::ui::DrawingSheetContent last_;
};
#endif

struct Export {
  bool ran = false;
  bool onDisk = false;
  std::string bytes;
  std::string error;
};

Export exportTo(forge::ui::ForgeShell& shell, const std::string& path) {
  Export out;
  std::remove(path.c_str());
  forge::ui::CommandParams p;
  p.setText("path", path);
  const forge::ui::DispatchResult r = shell.run("file.export_drawing", p);
  out.ran = r.ok();
  out.error = std::string(forge::ui::machineName(r.status)) + " " + r.detail + " " +
              shell.lastDocumentError();
  out.bytes = readWholeFile(path, out.onDisk);
  return out;
}

bool editFeature(forge::ui::ForgeShell& shell, int feature, int index, double value,
                 std::string& why) {
  forge::ui::CommandParams p;
  p.setNumber("feature", feature);
  p.setNumber("index", index);
  p.setNumber("value", value);
  const forge::ui::DispatchResult r = shell.run("part.edit_feature", p);
  why = std::string(forge::ui::machineName(r.status)) + " " + r.detail;
  return r.ok();
}

void printViews(const SvgDrawing& d, const char* tag) {
  for (const auto& kv : d.views) {
    std::printf("[drawing_export_gate] %-10s %-5s paper %8.3f x %8.3f mm at (%8.3f, %8.3f); "
                "%2zu visible / %2zu hidden polylines, hidden ink %8.3f mm\n",
                tag, kv.first.c_str(), kv.second.box.w(), kv.second.box.h(), kv.second.box.minX,
                kv.second.box.minY, kv.second.visible.size(), kv.second.hidden.size(),
                kv.second.hiddenLen);
  }
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[drawing_export_gate] MUTATION %d ACTIVE\n", g_mutation);

  // ── the real part, the real frame ────────────────────────────────────────
  forge::desktop::KernelScene scene;
  const bool built = scene.build();
  check(built, "the kernel built the starting part", scene.error());
  if (!built) {
    std::printf("[drawing_export_gate] cannot continue without geometry\n");
    return 1;
  }
  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();
  step(frame);

  // ── the hand oracle, checked against the kernel's own box ────────────────
  Expect e;
  {
    const std::string program = frame.document().irProgram();
    check(program.find("RECT(80, 50)") != std::string::npos &&
              program.find("EXTRUDE(%1, 20)") != std::string::npos &&
              program.find("CYL(6, 40, 0, 0, -10)") != std::string::npos,
          "the document is the starting part this gate's hand numbers describe", program);
    const auto& b = scene.lastBuild();
    checkNear(b.bboxMax[0] - b.bboxMin[0], e.sx, 1e-6, "kernel box X = 80 (hand)");
    checkNear(b.bboxMax[1] - b.bboxMin[1], e.sy, 1e-6, "kernel box Y = 50 (hand)");
    checkNear(b.bboxMax[2] - b.bboxMin[2], e.sz, 1e-6, "kernel box Z = 20 (hand)");
    checkNear(b.bboxMin[0], -e.sx / 2, 1e-6, "the plate is centred in X");
    checkNear(b.bboxMin[2], 0.0, 1e-6, "the plate stands on z = 0");
  }
  const forge::ui::TitleBlockData& tb = frame.drawing().titleBlock();
  const forge::ui::SheetSize* sheet = forge::ui::findSheetSize(tb.sheetId);
  check(sheet != nullptr, "the document names a sheet this build has", tb.sheetId);
  if (sheet == nullptr) return 1;
  e.sheetId = sheet->id;
  e.sheetLabel = sheet->label;
  e.projection = tb.projection;
  check(tb.scaleMode == forge::ui::ScaleMode::Automatic, "the starting document fits its scale",
        forge::ui::toString(tb.scaleMode));
  // THE SCALE, TWICE: the app's choice, and fitScale over the projection group
  // (front + side wide, front + top tall) computed from the HAND numbers.
  const auto fitFor = [&](const Expect& x) {
    return forge::ui::fitScale(x.sx + x.sy, x.sz + x.sy, *sheet);
  };
  {
    const forge::ui::ScaleFit fit = fitFor(e);
    check(fit.ok && fit.fits, "the part fits its sheet at a standard scale", fit.reason);
    check(frame.drawingLayout().scale.scale == fit.scale,
          "the app's scale is the largest that fits, recomputed by hand",
          frame.drawingLayout().scale.scale.text() + " vs " + fit.scale.text());
    e.scale = fit.scale;
    e.factor = fit.scale.factor();
  }
  std::printf("[drawing_export_gate] part 80 x 50 x 20, bore d12 at (0, 0); sheet %s, scale %s, "
              "%s\n",
              e.sheetLabel.c_str(), e.scale.text().c_str(),
              forge::ui::projectionLabel(e.projection));

  // ══ 1. THE COMMAND EXISTS AND IS WIRED ══════════════════════════════════
  const forge::ui::CommandDescriptor* d = shell.registry().find("file.export_drawing");
  check(d != nullptr, "file.export_drawing is a registered command",
        "command not found in the ONE registry");
  if (d == nullptr) {
    std::printf("[drawing_export_gate] %zu checks, %zu failures — FAIL (no drawing command)\n",
                g_checks, g_failures);
    return 1;
  }
  check(d->category == "File", "it sits in the File menu", d->category);
  check(d->featureIrOp.empty(), "it emits no feature-IR op", d->featureIrOp);
  check(d->schema.size() == 1 && d->schema[0].name == "path" && d->schema[0].required &&
            !d->schema[0].hasDefault,
        "it takes exactly one required path with no default", "");
  check(d->writes == forge::ui::WriteIntent::Copy,
        "it declares a COPY write, so the write-target guard covers it", "");
  {
    forge::ui::ForgeShell bare;
    forge::ui::CommandParams withPath;
    withPath.setText("path", tempPath("never_written.svg"));
    const forge::ui::DispatchResult pre =
        bare.registry().evaluate("file.export_drawing", bare.selection(), withPath);
    check(pre.status == forge::ui::DispatchStatus::Disabled,
          "a shell with no drawing source has it DISABLED, not failing",
          forge::ui::machineName(pre.status));
  }
#if FORGE_GATE_HAS_DRAWING_EXPORT
  check(shell.drawingSource() == &frame, "the frame installed itself as the drawing source", "");
  MutatingSource source(frame, g_mutation);
  shell.setDrawingSource(&source);
#endif

  // ══ 2-6. THE FIRST EXPORT ═══════════════════════════════════════════════
  const std::string svgPath = tempPath("forge_drawing_export_gate.svg");
  const std::string dxfPath = tempPath("forge_drawing_export_gate.dxf");
  const auto t0 = std::chrono::steady_clock::now();
  const Export first = exportTo(shell, svgPath);
  const double exportMs =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  // MEASURED, not asserted: the export compiles the history and runs three HLR
  // passes on the thread that dispatched it, as the STEP export does.
  std::printf("[drawing_export_gate] first export: %.1f ms on the dispatching thread, %zu bytes\n",
              exportMs, first.bytes.size());
  check(first.ran, "File > Save the Drawing ran through the ONE registry", first.error);
  check(first.onDisk && !first.bytes.empty(), "an SVG is on disk", svgPath);
  const SvgDrawing svg0 = readSvg(first.bytes);
  keepCopy("starting_part.svg", first.bytes);
  printViews(svg0, "first");
  checkSheet(svg0, e, "first");
#if FORGE_GATE_HAS_DRAWING_EXPORT
  {
    const forge::ui::DrawingExportReport& rep = shell.lastDrawingExport();
    check(rep.ok, "the shell reports the drawing saved", rep.message);
    check(rep.bytes == static_cast<long long>(first.bytes.size()),
          "the report's byte count is what is on disk",
          std::to_string(rep.bytes) + " vs " + std::to_string(first.bytes.size()));
    check(rep.views == 3, "the report counts three views", std::to_string(rep.views));
    check(forge::ui::isUserReadable(rep.message), "the success sentence is plain", rep.message);
    check(rep.message.find(e.scale.text()) != std::string::npos,
          "the success sentence names the scale", rep.message);
    std::printf("[drawing_export_gate] \"%s\"\n", rep.message.c_str());
    // Where the time went, as the frame logged it (measured, not asserted).
    for (const forge::ui::LogEntry& le : shell.log().entries()) {
      if (le.source == "Drawing") std::printf("[drawing_export_gate] log: %s\n", le.render().c_str());
    }
  }
#endif
  // The same part, the same sheet: the same bytes.
  {
    const Export again = exportTo(shell, svgPath);
    check(again.ran && again.bytes == first.bytes, "exporting the same part twice is byte-identical",
          std::to_string(again.bytes.size()) + " vs " + std::to_string(first.bytes.size()));
  }
  // ── the DXF of the same sheet ──────────────────────────────────────────
  {
    const Export dx = exportTo(shell, dxfPath);
    check(dx.ran, "the DXF export ran", dx.error);
    keepCopy("starting_part.dxf", dx.bytes);
    check(dx.onDisk && !dx.bytes.empty(), "a DXF is on disk", dxfPath);
    const DxfDrawing dxf = readDxf(dx.bytes);
    std::printf("[drawing_export_gate] DXF: %zu bytes, %zu LINE, %zu TEXT\n", dx.bytes.size(),
                dxf.lines.size(), dxf.texts.size());
    checkDxfMatchesSvg(dxf, svg0, e, "first");
  }

  // ══ 4b. THE OTHER PROJECTION ════════════════════════════════════════════
  {
    const forge::ui::ProjectionAngle was = tb.projection;
    frame.drawing().titleBlock().projection = was == forge::ui::ProjectionAngle::First
                                                  ? forge::ui::ProjectionAngle::Third
                                                  : forge::ui::ProjectionAngle::First;
    Expect other = e;
    other.projection = frame.drawing().titleBlock().projection;
    const Export flipped = exportTo(shell, svgPath);
    check(flipped.ran, "the export ran in the other projection", flipped.error);
    const SvgDrawing svgF = readSvg(flipped.bytes);
    printViews(svgF, "other-proj");
    checkSheet(svgF, other, "other projection");
    frame.drawing().titleBlock().projection = was;
  }

  // ══ 7. ASSOCIATIVITY ════════════════════════════════════════════════════
  const auto boxOf = [](const SvgDrawing& d, const char* v) {
    const auto it = d.views.find(v);
    return it == d.views.end() ? Box{} : it->second.box;
  };
  // ── the plate's width, 80 -> 100 ───────────────────────────────────────
  Expect wide = e;
  wide.sx = 100.0;
  SvgDrawing svg1;
  {
    std::string why;
    check(editFeature(shell, 1, 0, 100.0, why), "the plate's width was edited 80 -> 100", why);
    step(frame);
    const auto& b = scene.lastBuild();
    checkNear(b.bboxMax[0] - b.bboxMin[0], 100.0, 1e-6, "the kernel rebuilt it 100 wide");
    const forge::ui::ScaleFit fit = fitFor(wide);
    check(fit.scale == e.scale, "the wider part still takes the same scale (so the delta is "
                                "exactly scale x 20)",
          fit.scale.text());
    const Export ex = exportTo(shell, svgPath);
    check(ex.ran, "the drawing was saved again after the edit", ex.error);
    svg1 = readSvg(ex.bytes);
    printViews(svg1, "width 100");
    checkSheet(svg1, wide, "after width edit");
    const double f = e.factor;
    checkNear(boxOf(svg1, "Front").w() - boxOf(svg0, "Front").w(), 20.0 * f, 1e-3,
              "the front view grew by EXACTLY scale x 20 mm");
    checkNear(boxOf(svg1, "Top").w() - boxOf(svg0, "Top").w(), 20.0 * f, 1e-3,
              "the top view grew by EXACTLY scale x 20 mm");
    checkNear(boxOf(svg1, "Right").w() - boxOf(svg0, "Right").w(), 0.0, 1e-6,
              "the side view's width did not change (Y did not)");
    checkNear(boxOf(svg1, "Right").h() - boxOf(svg0, "Right").h(), 0.0, 1e-6,
              "the side view's height did not change (Z did not)");
    // The plate grew along X, which the side view looks along: not one of its
    // lines may move.
    checkSamePicture(svg0, svg1, "Right", "the side view did not change when the plate widened");
  }
  // ── the bore's location, x 0 -> 20 ─────────────────────────────────────
  {
    Expect moved = wide;
    moved.holeX = 20.0;
    std::string why;
    check(editFeature(shell, 3, 2, 20.0, why), "the bore was moved 0 -> 20 mm in X", why);
    step(frame);
    const auto& b = scene.lastBuild();
    checkNear(b.bboxMax[0] - b.bboxMin[0], 100.0, 1e-6, "moving the bore left the plate 100 wide");
    const Export ex = exportTo(shell, svgPath);
    check(ex.ran, "the drawing was saved again after the move", ex.error);
    const SvgDrawing svg2 = readSvg(ex.bytes);
    printViews(svg2, "bore x20");
    checkSheet(svg2, moved, "after bore move");
    // Relative to the front view's own left edge, the bore's hidden lines moved
    // by exactly scale x 20 -- MEASURED on the ink (the leftmost full-height
    // hidden line that no visible line covers), not read off the expectation.
    const double f = e.factor;
    const double before = leftmostBoreLine(svg1, "Front");
    const double after = leftmostBoreLine(svg2, "Front");
    std::printf("[drawing_export_gate] front view bore silhouette: %.4f -> %.4f mm from the "
                "view's left edge\n",
                before, after);
    checkNear(after - before, 20.0 * f, 1e-3,
              "the front view's bore moved by EXACTLY scale x 20 mm");
    const auto r1 = svg1.views.find("Right");
    const auto r2 = svg2.views.find("Right");
    if (r1 != svg1.views.end() && r2 != svg2.views.end()) {
      checkNear(r2->second.box.w(), r1->second.box.w(), 1e-6, "the side view did not change size");
    }
    // The bore moved along X only, and the side view looks along X: its picture
    // must not change at all -- not one line moved, gained or lost.
    checkSamePicture(svg1, svg2, "Right", "the side view did not change when the bore moved in X");

    // A DXF of the moved part follows too.
    const Export dx = exportTo(shell, dxfPath);
    check(dx.ran, "the DXF was saved after the move", dx.error);
    checkDxfMatchesSvg(readDxf(dx.bytes), svg2, moved, "after bore move");
  }
  // ── two undos: the first drawing, byte for byte ────────────────────────
  {
    const forge::ui::DispatchResult u1 = shell.run("edit.undo");
    step(frame);
    const forge::ui::DispatchResult u2 = shell.run("edit.undo");
    step(frame);
    check(u1.ok() && u2.ok(), "both edits were undone", forge::ui::machineName(u2.status));
    const Export ex = exportTo(shell, svgPath);
    check(ex.ran, "the drawing was saved after the undos", ex.error);
    check(ex.bytes == first.bytes, "after undo the drawing is the FIRST drawing, byte for byte",
          std::to_string(ex.bytes.size()) + " vs " + std::to_string(first.bytes.size()));
  }

  // ══ 8. REFUSALS ═════════════════════════════════════════════════════════
  {
    const std::string pdf = tempPath("forge_drawing_export_gate.pdf");
    const Export r = exportTo(shell, pdf);
    check(!r.ran, "a .pdf name is refused (SVG and DXF only)", r.error);
    check(!onDisk(pdf), "and nothing was written", pdf);
    check(forge::ui::isUserReadable(shell.lastDocumentError()) &&
              shell.lastDocumentError().find(".svg") != std::string::npos,
          "the refusal says which names work, in plain words", shell.lastDocumentError());

    const std::string missingDir = tempPath("forge_drawing_export_gate_no_such_folder");
    const std::string nowhere = missingDir + "/drawing.svg";
    const Export m = exportTo(shell, nowhere);
    check(!m.ran, "a save into a folder that is not there is refused", m.error);
    check(!onDisk(nowhere) && !onDisk(missingDir), "and no file or folder was invented", "");
    check(forge::ui::isUserReadable(shell.lastDocumentError()), "that refusal is plain",
          shell.lastDocumentError());

    forge::ui::CommandParams empty;
    empty.setText("path", "");
    check(!shell.run("file.export_drawing", empty).ok(), "an empty file name is refused", "");
    check(forge::ui::isUserReadable(shell.lastDocumentError()), "that refusal is plain too",
          shell.lastDocumentError());
  }
  std::remove(svgPath.c_str());
  std::remove(dxfPath.c_str());

  // ══ 9. A PART THE DRAWING VIEWS CANNOT COVER ════════════════════════════
  // MEASURED on this tree: the native importer the HLR reads through DECLINES a
  // circle extrusion ("extrusion native/OCCT round-trip mismatch ... deferred,
  // not facet-faked"), so a round boss -- the shipped "flange" sample starts with
  // one -- cannot be drawn yet. Run last, because it replaces the document. The
  // export must say so in plain words, write NOTHING, and put the technical cause
  // in the activity log; it must never save a blank sheet, or the drawing of the
  // part that was there before (mutation 9 does exactly that).
  {
    std::string err;
    check(frame.documentReset(err), "the document was emptied for a round part", err);
    step(frame);
    forge::ui::CommandParams circle;
    circle.setNumber("radius", 15.0);
    const forge::ui::DispatchResult r1 = shell.run("part.sketch_circle", circle);
    check(r1.ok(), "a circle was sketched through the registry",
          std::string(forge::ui::machineName(r1.status)) + " " + r1.detail);
    const std::vector<forge::ui::FeatureRecord>& recs = frame.document().records();
    const std::string sketchNode =
        recs.empty() ? std::string() : frame.document().nodeFor(recs.back().irId);
    forge::ui::EntityRef sketch;
    sketch.bodyId = sketchNode;
    sketch.kind = forge::ui::EntityKind::Sketch;
    sketch.persistentName = sketchNode;
    sketch.generation = 1;
    shell.selection().replaceWith({sketch});
    forge::ui::CommandParams ext;
    ext.setNumber("distance", 10.0);
    const forge::ui::DispatchResult r2 = shell.run("part.extrude", ext);
    check(r2.ok(), "...and extruded into a round boss",
          std::string(forge::ui::machineName(r2.status)) + " " + r2.detail);
    step(frame);
    check(frame.rebuildError().empty() && scene.triangleCount() > 0,
          "the round boss really built (it is on screen)", frame.rebuildError());
    std::printf("[drawing_export_gate] round part: %s", frame.document().irProgram().c_str());

    const std::size_t logBefore = shell.log().entries().size();
    const std::string roundPath = tempPath("forge_drawing_export_gate_round.svg");
    const Export round = exportTo(shell, roundPath);
    const std::string said = shell.lastDocumentError();
    std::printf("[drawing_export_gate] round part refused: \"%s\"\n", said.c_str());
    check(!round.ran, "a part the drawing views cannot cover is REFUSED", round.error);
    check(!onDisk(roundPath), "...and NOTHING was written, not a blank sheet and not the "
                              "last part's drawing",
          roundPath);
#if FORGE_GATE_HAS_DRAWING_EXPORT
    check(shell.lastDrawingExport().refusal == forge::ui::DrawingExportRefusal::NoDrawing,
          "...for the reason the closed set has a value for",
          forge::ui::toString(shell.lastDrawingExport().refusal));
#endif
    check(forge::ui::isUserReadable(said) && said.find("cannot draw") != std::string::npos,
          "...and says why in plain words", said);
    bool causeLogged = false;
    const std::vector<forge::ui::LogEntry>& log = shell.log().entries();
    for (std::size_t i = logBefore; i < log.size(); ++i) {
      if (log[i].source == "Drawing" && log[i].severity == forge::ui::Severity::Warning &&
          log[i].detail.find("native import declined") != std::string::npos) {
        causeLogged = true;
        std::printf("[drawing_export_gate] log: %s\n", log[i].render().c_str());
      }
    }
    check(causeLogged, "...and the technical cause is in the activity log", "");
    std::remove(roundPath.c_str());
  }

  std::printf("[drawing_export_gate] %zu checks, %zu failures — %s\n", g_checks, g_failures,
              g_failures == 0 ? "PASS" : "FAIL");
  return g_failures == 0 ? 0 : 1;
}
