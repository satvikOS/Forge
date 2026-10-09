// forge-desktop/test/sheet_canvas_gate.cpp
//
// THE SHEET-CANVAS GATE (T-296) — headless, on the application's own part, in
// the Drawing workspace, reading the picture back out of Dear ImGui's draw list.
//
// ── THE GAP, MEASURED on work/T-230 6f2f9207 ────────────────────────────────
// The Drawing workspace's centre tab is "sheet_canvas", and PanelCatalog says it
// is "the drawing sheet itself, with the views, notes and title block laid out
// as they will print". ForgeFrame::drawPanel() sent it to drawViewportPanel()
// (isViewportPanel(): `|| id == "sheet_canvas"`), so the tab drew the 3-D
// viewport texture -- and File > Save the Drawing, which T-230 made real, wrote
// a sheet nobody could look at before opening the file. This gate, built on that
// tree, is RED on its first section: the viewport texture is in the tab.
//
// ── WHAT IS ASSERTED ────────────────────────────────────────────────────────
//   1. THE TAB IS NOT THE VIEWPORT. With the Drawing workspace up and a known
//      texture handed to build() as the 3-D viewport's, no draw command in the
//      frame samples that texture, the frame asks the renderer for no viewport,
//      and the tab has its own child window. Merely SHOWING the tab computes
//      nothing: no sheet is asked for until "Draw the sheet" is pressed.
//   2. AFTER "Draw the sheet" (pressed through the real ImGui input queue, on
//      the rectangle the frame published) THE TAB HOLDS THE SAME INK AS THE
//      SAVED DRAWING. The reference is File > Save the Drawing, run through the
//      ONE registry with the frame's own drawing source, read back off the disk
//      -- and cross-checked as forge::ui::layoutDrawing() of the sheet the tab
//      was handed, written by writeDrawingSvg(), byte for byte. The tab's draw
//      list is decoded quad by quad (see "READING THE DRAW LIST") and compared
//      with the SVG after the paper -> pixel transform read off the drawn paper:
//        * every frame, title-block and VISIBLE line of the SVG lies under drawn
//          ink, sampled every 0.25 px, within 0.5 px;
//        * every drawn line lies on a line of the SVG, within 0.5 px;
//        * the HIDDEN lines are drawn DASHED: the hidden ink no visible line
//          covers is inked only in part, with gaps no longer than the SVG's own
//          dash gap at this zoom, and every long one has at least one gap --
//          and no hidden line is missing for longer than that gap;
//        * the frame and the title block are there, and the title block's
//          sheet, scale, projection and part-size values and the view labels
//          are drawn (the glyphs are decoded back into characters through the
//          font atlas, not taken from the frame's word for it).
//   3. NEVER PER FRAME. Twenty more frames ask the source for nothing.
//   4. A CHANGE IS SAID IN WORDS. The plate is widened 80 -> 100 through
//      part.edit_feature: the tab still shows the OLD sheet, unchanged, and says
//      in plain words over it that the part has changed. A projection change and
//      a title-block edit each get their own sentence, and undoing them makes
//      the sentence go away -- the witness is the sheet's inputs, not a flag.
//   5. DRAWN AGAIN, IT IS THE NEW DRAWING. The bore is also moved off-centre in
//      Y (so the top view is no longer symmetric top-to-bottom and an upside-
//      down view cannot pass), the sheet is drawn again, the sentence is gone,
//      and the ink is the new export's.
//   6. A NEW DOCUMENT HAS NO SHEET until it is drawn: the last part's drawing is
//      never shown over a different part.
//
// ── PROVING IT CAN FAIL: --mutate <n> ───────────────────────────────────────
// The application carries no mutation switch. Mutations 1-3 go through the SAME
// seam drawing_export_gate uses: the gate installs its own forge::ui::
// DrawingSource in front of the frame's, and the Sheet tab -- which asks the
// SHELL's source, the one the Save writes from -- is handed a corrupted sheet,
// while the reference export is made with the frame's own source:
//   1  WRONG SCALE: the views are laid out at another standard scale than the
//      drawing's
//   2  HIDDEN DROPPED: the hidden lines are left out
//   3  Y NOT FLIPPED: every view drawn with its up axis reversed (upside down
//      in its cell)
//   4  STALE NOT FLAGGED: the tab after the edit is read as it was before it --
//      the picture of a tab that never re-reads its witnesses (this one breaks
//      the QUERY, as drawing_gate's mutation 5 does for a stale layout cache)
// run_desktop.sh runs each and requires a non-zero exit. The production lines
// these stand for -- the y flip in paintSheet(), the layout factor, the hidden
// loop and the witness comparison -- were also broken one at a time in
// ForgeFrame.cpp, rebuilt, and run against this gate; that sweep is recorded in
// the T-296 evidence.
//
// ── READING THE DRAW LIST ───────────────────────────────────────────────────
// Dear ImGui turns every stroke into triangles. With anti-aliased lines and
// fills OFF -- this gate turns them off in the style before every NewFrame; the
// shipped app draws the SAME segments with anti-aliasing on -- a stroke from p1
// to p2 is exactly one quad (p1+n, p2+n, p2-n, p1-n), indices (0,1,2, 0,2,3),
// and its centre line is recovered exactly as ((v0+v3)/2, (v1+v2)/2). Ink is
// told from everything else by its vertex colour (opaque black) and by sampling
// the atlas's white pixel; glyphs sample a glyph's rectangle in the atlas and
// are read back into characters by looking that rectangle up.
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include <unistd.h>

#include "imgui.h"
#include "imgui_internal.h"

#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/Drawing.hpp"
#include "forge/ui/DrawingExport.hpp"
#include "forge/ui/FileExchange.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace {

int g_mutation = 0;
std::size_t g_checks = 0;
std::size_t g_failures = 0;

void check(bool ok, const std::string& what, const std::string& detail = std::string()) {
  ++g_checks;
  if (ok) return;
  ++g_failures;
  std::printf("  FAIL  %-66s  %s\n", what.c_str(), detail.c_str());
}

void checkNear(double got, double want, double tol, const std::string& what) {
  ++g_checks;
  if (std::isfinite(got) && std::fabs(got - want) <= tol) return;
  ++g_failures;
  std::printf("  FAIL  %-66s  got %.6f, want %.6f (tol %.3g)\n", what.c_str(), got, want, tol);
}

// The texture build() is told the 3-D viewport lives in. Any draw command that
// samples it is the viewport, drawn.
constexpr std::uint64_t kViewportTexture = 0x5EE7CA4Eu;
// The atlas texture id the headless context uses.
constexpr std::uint64_t kFontTexture = 1u;

struct HeadlessImGui {
  HeadlessImGui(float w, float h) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(w, h);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "sheet_canvas_gate_null";
    // A drawing has thousands of strokes; the real renderer honours vertex
    // offsets, and so does this gate's reader.
    io.BackendFlags |= ImGuiBackendFlags_RendererHasVtxOffset;
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0;
    int th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(kFontTexture));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

void step(forge::desktop::ForgeFrame& frame) {
  // One stroke = one quad, so the reader can recover its centre line exactly.
  ImGui::GetStyle().AntiAliasedLines = false;
  ImGui::GetStyle().AntiAliasedLinesUseTex = false;
  ImGui::GetStyle().AntiAliasedFill = false;
  ImGui::NewFrame();
  frame.build(kViewportTexture, 1.0f);
  ImGui::Render();
}

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

// "The sheet has  changed." -> "Thesheethaschanged." The decoder recovers the
// glyphs, not the spaces between them, so text is compared without spaces.
std::string squash(const std::string& s) {
  std::string out;
  for (char c : s) {
    if (c != ' ') out += c;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// GEOMETRY
// ════════════════════════════════════════════════════════════════════════════
using Pt = std::array<double, 2>;

struct Seg {
  Pt a{}, b{};
  double thickness = 0.0;
};

double segLen(const Seg& s) { return std::hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]); }

double distToSeg(const Pt& p, const Pt& a, const Pt& b) {
  const double ax = b[0] - a[0];
  const double ay = b[1] - a[1];
  const double l2 = ax * ax + ay * ay;
  double t = 0.0;
  if (l2 > 0.0) t = std::clamp(((p[0] - a[0]) * ax + (p[1] - a[1]) * ay) / l2, 0.0, 1.0);
  return std::hypot(a[0] + t * ax - p[0], a[1] + t * ay - p[1]);
}

// A uniform grid over segments, so "is this point within r of any segment" is a
// lookup in one cell rather than a walk over thousands.
class SegGrid {
 public:
  SegGrid(const std::vector<Seg>& segs, double reach) : segs_(segs), reach_(reach) {
    for (std::size_t i = 0; i < segs_.size(); ++i) {
      const Seg& s = segs_[i];
      const int x0 = cell(std::min(s.a[0], s.b[0]) - reach_);
      const int x1 = cell(std::max(s.a[0], s.b[0]) + reach_);
      const int y0 = cell(std::min(s.a[1], s.b[1]) - reach_);
      const int y1 = cell(std::max(s.a[1], s.b[1]) + reach_);
      for (int gx = x0; gx <= x1; ++gx) {
        for (int gy = y0; gy <= y1; ++gy) cells_[key(gx, gy)].push_back(i);
      }
    }
  }
  bool near(const Pt& p) const {
    const auto it = cells_.find(key(cell(p[0]), cell(p[1])));
    if (it == cells_.end()) return false;
    for (std::size_t i : it->second) {
      if (distToSeg(p, segs_[i].a, segs_[i].b) <= reach_) return true;
    }
    return false;
  }

 private:
  static constexpr double kCell = 8.0;
  static int cell(double v) { return static_cast<int>(std::floor(v / kCell)); }
  static long long key(int x, int y) {
    return (static_cast<long long>(x) << 32) ^ static_cast<long long>(static_cast<unsigned>(y));
  }
  const std::vector<Seg>& segs_;
  double reach_;
  std::map<long long, std::vector<std::size_t>> cells_;
};

// ════════════════════════════════════════════════════════════════════════════
// READING THE DRAW LIST
// ════════════════════════════════════════════════════════════════════════════
struct Glyph {
  char c = '?';
  double x0 = 0, y0 = 0, x1 = 0, y1 = 0;
  ImU32 colour = 0;
};

struct Canvas {
  bool found = false;
  std::string windowName;
  double winX0 = 0, winY0 = 0, winX1 = 0, winY1 = 0;
  // The paper: the white rectangle. Zero or several is a defect.
  std::size_t paperQuads = 0;
  double paperX0 = 0, paperY0 = 0, paperX1 = 0, paperY1 = 0;
  std::vector<Seg> ink;  // opaque black strokes, centre lines
  std::vector<Glyph> glyphs;
  std::size_t quads = 0;
  std::size_t otherTriangles = 0;
  std::size_t viewportCommands = 0;  // draw commands sampling the viewport texture
};

std::map<std::pair<float, float>, char> g_glyphByUv;

void buildGlyphMap() {
  g_glyphByUv.clear();
  ImFont* font = ImGui::GetIO().Fonts->Fonts[0];
  ImFontBaked* baked = font->GetFontBaked(font->LegacySize);
  if (baked == nullptr) return;
  for (int c = 33; c < 127; ++c) {
    const ImFontGlyph* g = baked->FindGlyphNoFallback(static_cast<ImWchar>(c));
    if (g == nullptr || !g->Visible) continue;
    g_glyphByUv[{g->U0, g->V0}] = static_cast<char>(c);
  }
}

ImGuiWindow* findCanvasWindow() {
  ImGuiContext& g = *ImGui::GetCurrentContext();
  ImGuiWindow* found = nullptr;
  for (ImGuiWindow* w : g.Windows) {
    if (w == nullptr || !w->Active) continue;
    if (std::strstr(w->Name, "/##sheet_canvas_") != nullptr) found = w;
  }
  return found;
}

std::uint64_t texOf(const ImDrawCmd& cmd) {
  return static_cast<std::uint64_t>(cmd.TexRef._TexID);
}

// Every draw command of this frame, every window: does any sample the viewport?
std::size_t viewportCommandsInFrame() {
  std::size_t n = 0;
  const ImDrawData* dd = ImGui::GetDrawData();
  if (dd == nullptr) return 0;
  for (int i = 0; i < dd->CmdListsCount; ++i) {
    for (const ImDrawCmd& cmd : dd->CmdLists[i]->CmdBuffer) {
      if (cmd.UserCallback == nullptr && texOf(cmd) == kViewportTexture) ++n;
    }
  }
  return n;
}

Canvas readCanvas() {
  Canvas out;
  ImGuiWindow* w = findCanvasWindow();
  if (w == nullptr) return out;
  out.found = true;
  out.windowName = w->Name;
  out.winX0 = w->Pos.x;
  out.winY0 = w->Pos.y;
  out.winX1 = w->Pos.x + w->Size.x;
  out.winY1 = w->Pos.y + w->Size.y;
  const ImVec2 white = ImGui::GetIO().Fonts->TexUvWhitePixel;
  const ImDrawList* dl = w->DrawList;
  double bestPaper = -1.0;
  for (const ImDrawCmd& cmd : dl->CmdBuffer) {
    if (cmd.UserCallback != nullptr) continue;
    if (texOf(cmd) == kViewportTexture) ++out.viewportCommands;
    const unsigned first = cmd.IdxOffset;
    const unsigned end = cmd.IdxOffset + cmd.ElemCount;
    unsigned k = first;
    while (k + 3 <= end) {
      const bool quad =
          k + 6 <= end && dl->IdxBuffer[k + 1] == dl->IdxBuffer[k] + 1 &&
          dl->IdxBuffer[k + 2] == dl->IdxBuffer[k] + 2 && dl->IdxBuffer[k + 3] == dl->IdxBuffer[k] &&
          dl->IdxBuffer[k + 4] == dl->IdxBuffer[k] + 2 && dl->IdxBuffer[k + 5] == dl->IdxBuffer[k] + 3;
      if (!quad) {
        ++out.otherTriangles;
        k += 3;
        continue;
      }
      const unsigned base = cmd.VtxOffset + dl->IdxBuffer[k];
      k += 6;
      ++out.quads;
      const ImDrawVert& v0 = dl->VtxBuffer[static_cast<int>(base)];
      const ImDrawVert& v1 = dl->VtxBuffer[static_cast<int>(base + 1)];
      const ImDrawVert& v2 = dl->VtxBuffer[static_cast<int>(base + 2)];
      const ImDrawVert& v3 = dl->VtxBuffer[static_cast<int>(base + 3)];
      const bool solid = v0.uv.x == white.x && v0.uv.y == white.y && v2.uv.x == white.x &&
                         v2.uv.y == white.y;
      if (!solid) {
        Glyph g;
        const auto it = g_glyphByUv.find({v0.uv.x, v0.uv.y});
        g.c = it == g_glyphByUv.end() ? '?' : it->second;
        g.x0 = v0.pos.x;
        g.y0 = v0.pos.y;
        g.x1 = v2.pos.x;
        g.y1 = v2.pos.y;
        g.colour = v0.col;
        out.glyphs.push_back(g);
        continue;
      }
      if (v0.col == IM_COL32(255, 255, 255, 255)) {
        // A filled rectangle: a, (c.x, a.y), c, (a.x, c.y).
        const double area = std::fabs((v2.pos.x - v0.pos.x) * (v2.pos.y - v0.pos.y));
        ++out.paperQuads;
        if (area > bestPaper) {
          bestPaper = area;
          out.paperX0 = v0.pos.x;
          out.paperY0 = v0.pos.y;
          out.paperX1 = v2.pos.x;
          out.paperY1 = v2.pos.y;
        }
        continue;
      }
      if (v0.col != IM_COL32(0, 0, 0, 255)) continue;
      Seg s;
      s.a = {0.5 * (static_cast<double>(v0.pos.x) + v3.pos.x),
             0.5 * (static_cast<double>(v0.pos.y) + v3.pos.y)};
      s.b = {0.5 * (static_cast<double>(v1.pos.x) + v2.pos.x),
             0.5 * (static_cast<double>(v1.pos.y) + v2.pos.y)};
      s.thickness = std::hypot(v0.pos.x - v3.pos.x, v0.pos.y - v3.pos.y);
      out.ink.push_back(s);
    }
  }
  return out;
}

// The glyphs, read back into lines of text, ordered left to right. A glyph's
// quad is only as tall as its own bitmap -- a full stop is a dot on the
// baseline, a capital reaches the cap height -- so a line is grown from its
// tallest glyphs first and a smaller one joins the line whose band holds its
// centre. Spaces are not recovered; compare squashed.
std::vector<std::string> textLines(const std::vector<Glyph>& glyphs, double x0, double y0,
                                   double x1, double y1) {
  std::vector<Glyph> in;
  for (const Glyph& g : glyphs) {
    const double cx = 0.5 * (g.x0 + g.x1);
    const double cy = 0.5 * (g.y0 + g.y1);
    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) in.push_back(g);
  }
  std::stable_sort(in.begin(), in.end(), [](const Glyph& a, const Glyph& b) {
    return (a.y1 - a.y0) > (b.y1 - b.y0);
  });
  struct Row {
    double top = 0.0, bottom = 0.0;
    std::vector<Glyph> glyphs;
  };
  std::vector<Row> rows;
  for (const Glyph& g : in) {
    const double cy = 0.5 * (g.y0 + g.y1);
    Row* home = nullptr;
    for (Row& r : rows) {
      const double rc = 0.5 * (r.top + r.bottom);
      if ((cy >= r.top && cy <= r.bottom) || (rc >= g.y0 && rc <= g.y1)) {
        home = &r;
        break;
      }
    }
    if (home == nullptr) {
      rows.push_back(Row{g.y0, g.y1, {}});
      home = &rows.back();
    }
    home->top = std::min(home->top, g.y0);
    home->bottom = std::max(home->bottom, g.y1);
    home->glyphs.push_back(g);
  }
  std::vector<std::string> out;
  for (Row& r : rows) {
    std::sort(r.glyphs.begin(), r.glyphs.end(),
              [](const Glyph& a, const Glyph& b) { return a.x0 < b.x0; });
    std::string s;
    for (const Glyph& g : r.glyphs) s += g.c;
    out.push_back(s);
  }
  return out;
}

bool anyLineHas(const std::vector<std::string>& lines, const std::string& text) {
  const std::string want = squash(text);
  for (const std::string& l : lines) {
    if (l.find(want) != std::string::npos) return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// READING THE SAVED SVG -- in SVG units (paper mm, y DOWN, which is the
// screen's direction, so no flip is needed on the way to pixels).
// ════════════════════════════════════════════════════════════════════════════
struct SvgSheet {
  bool ok = false;
  std::string why;
  double W = 0.0, H = 0.0;
  std::vector<Seg> solid;   // frame, title block, title rows, visible view lines
  std::vector<std::vector<Pt>> hidden;  // hidden polylines
  double dashMm = 0.0, gapMm = 0.0;
  std::map<std::string, std::string> values;  // title block values by data-key
  double titleX0 = 0, titleY0 = 0, titleX1 = 0, titleY1 = 0;
  std::size_t visiblePolylines = 0;
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

double num(const std::string& tag, const char* name) {
  return std::atof(attr(tag, name).c_str());
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

std::vector<std::vector<Pt>> polylinesIn(const std::string& block) {
  std::vector<std::vector<Pt>> out;
  const char* open = "<polyline points=\"";
  for (std::size_t at = block.find(open); at != std::string::npos; at = block.find(open, at + 1)) {
    const std::size_t start = at + std::strlen(open);
    const std::size_t end = block.find('"', start);
    if (end == std::string::npos) break;
    std::istringstream in(block.substr(start, end - start));
    std::vector<Pt> p;
    std::string pair;
    while (in >> pair) {
      const std::size_t comma = pair.find(',');
      if (comma == std::string::npos) continue;
      p.push_back({std::atof(pair.substr(0, comma).c_str()),
                   std::atof(pair.substr(comma + 1).c_str())});
    }
    out.push_back(std::move(p));
  }
  return out;
}

std::string groupBlock(const std::string& view, const char* cls, std::string* tag = nullptr) {
  const std::string open = std::string("<g class=\"") + cls + "\"";
  const std::size_t at = view.find(open);
  if (at == std::string::npos) return std::string();
  if (tag != nullptr) *tag = view.substr(at, view.find('>', at) - at);
  const std::size_t end = view.find("</g>", at);
  return view.substr(at, end == std::string::npos ? std::string::npos : end - at);
}

void addRect(std::vector<Seg>& out, double x, double y, double w, double h) {
  const Pt c[4] = {{x, y}, {x + w, y}, {x + w, y + h}, {x, y + h}};
  for (int i = 0; i < 4; ++i) out.push_back(Seg{c[i], c[(i + 1) % 4], 0.0});
}

SvgSheet readSvg(const std::string& text) {
  SvgSheet d;
  const std::size_t root = text.find("<svg ");
  if (root == std::string::npos) {
    d.why = "no <svg> element";
    return d;
  }
  {
    const std::string rootTag = text.substr(root, text.find('>', root) - root);
    std::istringstream vb(attr(rootTag, "viewBox"));
    double x0 = 0, y0 = 0;
    vb >> x0 >> y0 >> d.W >> d.H;
  }
  if (!(d.W > 0.0) || !(d.H > 0.0)) {
    d.why = "no usable viewBox";
    return d;
  }
  // The frame.
  {
    const std::size_t at = text.find("<rect id=\"frame\"");
    if (at == std::string::npos) {
      d.why = "no frame";
      return d;
    }
    const std::string tag = text.substr(at, text.find('>', at) - at);
    addRect(d.solid, num(tag, "x"), num(tag, "y"), num(tag, "width"), num(tag, "height"));
  }
  // The views.
  const std::string viewOpen = "<g id=\"view-";
  for (std::size_t at = text.find(viewOpen); at != std::string::npos;
       at = text.find(viewOpen, at + 1)) {
    std::size_t end = text.find(viewOpen, at + 1);
    const std::size_t title = text.find("<g id=\"title-block\"", at);
    if (end == std::string::npos || (title != std::string::npos && title < end)) end = title;
    const std::string block =
        text.substr(at, end == std::string::npos ? std::string::npos : end - at);
    for (const std::vector<Pt>& p : polylinesIn(groupBlock(block, "visible"))) {
      ++d.visiblePolylines;
      for (std::size_t i = 1; i < p.size(); ++i) d.solid.push_back(Seg{p[i - 1], p[i], 0.0});
    }
    std::string hiddenTag;
    for (std::vector<Pt>& p : polylinesIn(groupBlock(block, "hidden", &hiddenTag))) {
      d.hidden.push_back(std::move(p));
    }
    if (!hiddenTag.empty()) {
      std::istringstream da(attr(hiddenTag, "stroke-dasharray"));
      da >> d.dashMm >> d.gapMm;
    }
  }
  // The title block: its rectangle, its row rules, its values.
  {
    const std::size_t at = text.find("<g id=\"title-block\"");
    if (at == std::string::npos) {
      d.why = "no title block";
      return d;
    }
    const std::size_t end = text.find("</g>", at);
    const std::string block = text.substr(at, end == std::string::npos ? std::string::npos
                                                                        : end - at);
    const std::size_t r = block.find("<rect ");
    if (r == std::string::npos) {
      d.why = "no title block rectangle";
      return d;
    }
    const std::string tag = block.substr(r, block.find('>', r) - r);
    d.titleX0 = num(tag, "x");
    d.titleY0 = num(tag, "y");
    d.titleX1 = d.titleX0 + num(tag, "width");
    d.titleY1 = d.titleY0 + num(tag, "height");
    addRect(d.solid, d.titleX0, d.titleY0, num(tag, "width"), num(tag, "height"));
    for (std::size_t l = block.find("<line "); l != std::string::npos;
         l = block.find("<line ", l + 1)) {
      const std::string lt = block.substr(l, block.find('>', l) - l);
      d.solid.push_back(
          Seg{{num(lt, "x1"), num(lt, "y1")}, {num(lt, "x2"), num(lt, "y2")}, 0.0});
    }
    const std::string valueOpen = "<text class=\"value\"";
    for (std::size_t v = block.find(valueOpen); v != std::string::npos;
         v = block.find(valueOpen, v + 1)) {
      const std::size_t close = block.find('>', v);
      const std::size_t endText = block.find("</text>", close);
      if (close == std::string::npos || endText == std::string::npos) break;
      d.values[attr(block.substr(v, close - v), "data-key")] =
          xmlUnescape(block.substr(close + 1, endText - close - 1));
    }
  }
  d.ok = true;
  return d;
}

// ════════════════════════════════════════════════════════════════════════════
// THE COMPARISON
// ════════════════════════════════════════════════════════════════════════════
struct Comparison {
  double scale = 0.0;           // pixels per paper mm
  double solidMissing = 0.0;    // px of frame/title/visible line with no ink on it
  double strayInk = 0.0;        // px of drawn ink on no line of the drawing
  double hiddenLength = 0.0;    // px of hidden line no visible line covers
  double hiddenInked = 0.0;     // ...of which inked
  double longestHiddenGap = 0.0;  // px, along any hidden line
  double gapAllowance = 0.0;    // px: the SVG's gap at this zoom, plus slack
  std::size_t longHidden = 0;   // hidden polylines long enough to need a gap
  std::size_t longHiddenWithoutGap = 0;
};

constexpr double kTol = 0.5;     // px, the acceptance tolerance
constexpr double kSample = 0.25;  // px between samples

Comparison compare(const Canvas& cv, const SvgSheet& svg) {
  Comparison r;
  const double s = (cv.paperX1 - cv.paperX0) / svg.W;
  r.scale = s;
  const auto P = [&](const Pt& q) { return Pt{cv.paperX0 + q[0] * s, cv.paperY0 + q[1] * s}; };
  std::vector<Seg> solid;
  for (const Seg& g : svg.solid) solid.push_back(Seg{P(g.a), P(g.b), 0.0});
  std::vector<Seg> hidden;
  for (const std::vector<Pt>& p : svg.hidden) {
    for (std::size_t i = 1; i < p.size(); ++i) hidden.push_back(Seg{P(p[i - 1]), P(p[i]), 0.0});
  }
  std::vector<Seg> every = solid;
  every.insert(every.end(), hidden.begin(), hidden.end());
  const SegGrid inkGrid(cv.ink, kTol);
  const SegGrid solidGrid(solid, kTol);
  const SegGrid everyGrid(every, kTol);

  const auto walk = [&](const Seg& g, const auto& visit) {
    const double len = segLen(g);
    const int n = std::max(1, static_cast<int>(std::ceil(len / kSample)));
    for (int k = 0; k < n; ++k) {
      const double t = (k + 0.5) / n;
      visit(Pt{g.a[0] + t * (g.b[0] - g.a[0]), g.a[1] + t * (g.b[1] - g.a[1])}, len / n);
    }
  };
  // Every solid line of the drawing is under ink.
  for (const Seg& g : solid) {
    walk(g, [&](const Pt& q, double step) {
      if (!inkGrid.near(q)) r.solidMissing += step;
    });
  }
  // Every stroke drawn is on a line of the drawing.
  for (const Seg& g : cv.ink) {
    walk(g, [&](const Pt& q, double step) {
      if (!everyGrid.near(q)) r.strayInk += step;
    });
  }
  // Hidden lines: inked in part, in dashes, with bounded gaps.
  r.gapAllowance = std::max(svg.gapMm * s, 3.0) + 1.0;
  const double period = (svg.dashMm + svg.gapMm) * s;
  for (const std::vector<Pt>& pl : svg.hidden) {
    double run = 0.0;
    double length = 0.0;
    std::size_t gaps = 0;
    bool inGap = false;
    for (std::size_t i = 1; i < pl.size(); ++i) {
      walk(Seg{P(pl[i - 1]), P(pl[i]), 0.0}, [&](const Pt& q, double step) {
        const bool inked = inkGrid.near(q);
        if (!solidGrid.near(q)) {
          r.hiddenLength += step;
          if (inked) r.hiddenInked += step;
          length += step;
        }
        if (inked) {
          run = 0.0;
          inGap = false;
        } else {
          run += step;
          r.longestHiddenGap = std::max(r.longestHiddenGap, run);
          if (!inGap) ++gaps;
          inGap = true;
        }
      });
    }
    if (period > 0.0 && length > 3.0 * period) {
      ++r.longHidden;
      if (gaps == 0) ++r.longHiddenWithoutGap;
    }
  }
  return r;
}

// The whole judgement of one drawn sheet against one saved SVG.
void checkSheetMatches(const Canvas& cv, const SvgSheet& svg, const std::string& tag) {
  check(svg.ok, tag + ": the saved SVG reads back", svg.why);
  check(cv.found, tag + ": the Sheet tab has its own window", "");
  if (!svg.ok || !cv.found) return;
  check(cv.paperQuads == 1, tag + ": exactly one sheet of paper is drawn",
        std::to_string(cv.paperQuads) + " white rectangles");
  const double pw = cv.paperX1 - cv.paperX0;
  const double ph = cv.paperY1 - cv.paperY0;
  check(pw > 100.0 && ph > 100.0, tag + ": the paper is big enough to read",
        std::to_string(pw) + " x " + std::to_string(ph) + " px");
  checkNear(ph / pw, svg.H / svg.W, 1e-4, tag + ": the paper has the sheet's proportions");
  check(cv.paperX0 >= cv.winX0 - 0.5 && cv.paperX1 <= cv.winX1 + 0.5 &&
            cv.paperY0 >= cv.winY0 - 0.5 && cv.paperY1 <= cv.winY1 + 0.5,
        tag + ": the whole sheet is inside the tab", "");
  check(!cv.ink.empty(), tag + ": there is ink on the paper", "");
  const Comparison r = compare(cv, svg);
  std::printf("[sheet_canvas_gate] %-12s %.4f px/mm, %zu strokes, %zu glyphs; solid line "
              "without ink %.3f px, stray ink %.3f px; hidden %.1f px, %.1f%% inked, longest "
              "gap %.2f px (allowed %.2f), %zu long hidden lines, %zu without a gap\n",
              tag.c_str(), r.scale, cv.ink.size(), cv.glyphs.size(), r.solidMissing, r.strayInk,
              r.hiddenLength, r.hiddenLength > 0.0 ? 100.0 * r.hiddenInked / r.hiddenLength : 0.0,
              r.longestHiddenGap, r.gapAllowance, r.longHidden, r.longHiddenWithoutGap);
  checkNear(r.solidMissing, 0.0, 1e-9,
            tag + ": every frame, title-block and visible line is drawn (0.5 px)");
  checkNear(r.strayInk, 0.0, 1e-9, tag + ": every drawn line is a line of the drawing (0.5 px)");
  check(!svg.hidden.empty() && r.hiddenLength > 0.0, tag + ": the drawing has hidden lines",
        std::to_string(svg.hidden.size()));
  const double inked = r.hiddenLength > 0.0 ? r.hiddenInked / r.hiddenLength : 0.0;
  check(inked > 0.45 && inked < 0.9, tag + ": hidden lines are drawn DASHED (part inked)",
        std::to_string(100.0 * inked) + "% inked");
  check(r.longestHiddenGap <= r.gapAllowance,
        tag + ": no hidden line is missing for longer than a dash gap",
        std::to_string(r.longestHiddenGap) + " px");
  check(r.longHidden > 0 && r.longHiddenWithoutGap == 0,
        tag + ": every long hidden line has gaps in it",
        std::to_string(r.longHiddenWithoutGap) + " of " + std::to_string(r.longHidden));

  // The words on the sheet, read back out of the glyphs.
  const double s = r.scale;
  const std::vector<std::string> onPaper =
      textLines(cv.glyphs, cv.paperX0, cv.paperY0, cv.paperX1, cv.paperY1);
  const std::vector<std::string> inTitle =
      textLines(cv.glyphs, cv.paperX0 + svg.titleX0 * s - 1.0, cv.paperY0 + svg.titleY0 * s - 1.0,
                cv.paperX0 + svg.titleX1 * s + 1.0, cv.paperY0 + svg.titleY1 * s + 1.0);
  for (const char* label : {"FRONT", "TOP", "RIGHT"}) {
    check(anyLineHas(onPaper, label), tag + ": the view label " + label + " is on the sheet", "");
  }
  check(anyLineHas(inTitle, "Forge drawing"), tag + ": the title block's heading is drawn", "");
  for (const char* key : {"sheet", "scale", "projection", "part_size"}) {
    const auto it = svg.values.find(key);
    const std::string want = it == svg.values.end() ? std::string() : it->second;
    check(!want.empty() && anyLineHas(inTitle, want),
          tag + ": the title block shows the drawing's " + key, "\"" + want + "\"");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// THE SEAM
// ════════════════════════════════════════════════════════════════════════════
// Sits in front of the frame's DrawingSource. It counts every request, keeps
// the sheet the frame handed over BEFORE any corruption, and corrupts it per the
// mutation. With no mutation it hands the frame's sheet through untouched.
class MutatingSource final : public forge::ui::DrawingSource {
 public:
  MutatingSource(forge::ui::DrawingSource& inner, int mutation)
      : inner_(inner), mutation_(mutation) {}
  bool hasDrawing() override { return inner_.hasDrawing(); }
  bool drawingSheet(forge::ui::DrawingSheetContent& out) override {
    ++calls;
    if (!inner_.drawingSheet(out)) return false;
    lastClean = out;
    switch (mutation_) {
      case 1: {
        // Another rung of the standard ladder than the drawing's own.
        const forge::ui::Scale other =
            out.scale == forge::ui::Scale{1, 1} ? forge::ui::Scale{1, 2} : forge::ui::Scale{1, 1};
        out.scale = other;
        break;
      }
      case 2:
        for (forge::ui::DrawingViewLines& v : out.views) v.hidden.clear();
        break;
      case 3:
        for (forge::ui::DrawingViewLines& v : out.views) {
          for (std::vector<forge::ui::DrawingPolyline>* set : {&v.visible, &v.hidden}) {
            for (forge::ui::DrawingPolyline& pl : *set) {
              for (std::array<double, 2>& q : pl.points) q[1] = v.minUp + v.maxUp - q[1];
            }
          }
        }
        break;
      default:
        break;
    }
    return true;
  }
  std::size_t calls = 0;
  forge::ui::DrawingSheetContent lastClean;

 private:
  forge::ui::DrawingSource& inner_;
  int mutation_ = 0;
};

struct Export {
  bool ran = false;
  std::string bytes;
  std::string error;
};

// File > Save the Drawing, through the ONE registry, with the FRAME's own
// source -- the reference is never the corrupted sheet.
Export exportClean(forge::ui::ForgeShell& shell, forge::desktop::ForgeFrame& frame,
                   MutatingSource& seam, const std::string& path) {
  Export out;
  std::remove(path.c_str());
  shell.setDrawingSource(&frame);
  forge::ui::CommandParams p;
  p.setText("path", path);
  const forge::ui::DispatchResult r = shell.run("file.export_drawing", p);
  shell.setDrawingSource(&seam);
  out.ran = r.ok();
  out.error = std::string(forge::ui::machineName(r.status)) + " " + r.detail + " " +
              shell.lastDocumentError();
  bool ok = false;
  out.bytes = readWholeFile(path, ok);
  if (!ok) out.ran = false;
  std::remove(path.c_str());
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

// ── the frame's Sheet-tab instrumentation, PROBED ───────────────────────────
// So the SAME source compiles against a tree that predates the Sheet tab, which
// is how its failing-first verdict was measured. On such a tree there is no
// button to press and every one of these reads as "nothing": the gate goes red
// on what the tab actually draws, not on a missing symbol.
#if defined(FORGE_FRAME_HAS_SHEET_CANVAS)
forge::desktop::ForgeFrame::WidgetRect drawButton(forge::desktop::ForgeFrame& f) {
  return f.sheetDrawButtonRect();
}
std::size_t drawRequests(forge::desktop::ForgeFrame& f) { return f.sheetDrawRequests(); }
bool sheetDrawn(forge::desktop::ForgeFrame& f) { return f.sheetDrawn(); }
std::string notice(forge::desktop::ForgeFrame& f) { return f.sheetNotice(); }
double drawMs(forge::desktop::ForgeFrame& f) { return f.sheetDrawMilliseconds(); }
#else
forge::desktop::ForgeFrame::WidgetRect drawButton(forge::desktop::ForgeFrame&) { return {}; }
std::size_t drawRequests(forge::desktop::ForgeFrame&) { return 0; }
bool sheetDrawn(forge::desktop::ForgeFrame&) { return false; }
std::string notice(forge::desktop::ForgeFrame&) { return std::string(); }
double drawMs(forge::desktop::ForgeFrame&) { return 0.0; }
#endif

// Press the Sheet tab's "Draw the sheet" the way a user does: the pointer on the
// rectangle the frame published, down, up, through the real ImGui input queue.
bool pressDraw(forge::desktop::ForgeFrame& frame) {
  const forge::desktop::ForgeFrame::WidgetRect r = drawButton(frame);
  if (!r.valid) return false;
  ImGuiIO& io = ImGui::GetIO();
  io.AddMousePosEvent(0.5f * (r.x0 + r.x1), 0.5f * (r.y0 + r.y1));
  step(frame);
  io.AddMouseButtonEvent(0, true);
  step(frame);
  io.AddMouseButtonEvent(0, false);
  step(frame);
  // Off the tab, so no tooltip and no hover stays on the paper.
  io.AddMousePosEvent(2.0f, 2.0f);
  step(frame);
  step(frame);
  return true;
}

std::vector<std::string> headerLines(const Canvas& cv) {
  // Everything in the tab above the paper: the button, the status, the notices.
  const double bottom = cv.paperQuads > 0 ? cv.paperY0 : cv.winY1;
  return textLines(cv.glyphs, cv.winX0, cv.winY0, cv.winX1, bottom);
}

void printLines(const char* tag, const std::vector<std::string>& lines) {
  for (const std::string& l : lines) std::printf("[sheet_canvas_gate] %s text: %s\n", tag, l.c_str());
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[sheet_canvas_gate] MUTATION %d ACTIVE\n", g_mutation);

  // ── the real part, the real frame ────────────────────────────────────────
  forge::desktop::KernelScene scene;
  const bool built = scene.build();
  check(built, "the kernel built the starting part", scene.error());
  if (!built) {
    std::printf("[sheet_canvas_gate] cannot continue without geometry\n");
    return 1;
  }
  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();
  step(frame);
  buildGlyphMap();
  check(g_glyphByUv.size() > 80, "the font atlas maps glyphs back to characters",
        std::to_string(g_glyphByUv.size()));
  {
    const std::string program = frame.document().irProgram();
    check(program.find("RECT(80, 50)") != std::string::npos &&
              program.find("CYL(6, 40, 0, 0, -10)") != std::string::npos,
          "the document is the starting part", program);
  }
  MutatingSource seam(frame, g_mutation);
  check(shell.drawingSource() == &frame, "the frame installed itself as the drawing source", "");
  shell.setDrawingSource(&seam);

  // ══ 1. THE TAB IS NOT THE VIEWPORT ══════════════════════════════════════
  check(shell.setWorkspace(forge::ui::WorkspaceProfile::Drawing), "the Drawing workspace opened",
        "");
  for (int i = 0; i < 5; ++i) step(frame);
  {
    const std::vector<std::string>& drawn = frame.panelIdsDrawn();
    check(std::find(drawn.begin(), drawn.end(), std::string("sheet_canvas")) != drawn.end(),
          "the Sheet tab is drawn in the Drawing workspace", "");
    const std::size_t viewport = viewportCommandsInFrame();
    check(viewport == 0, "NO draw command samples the 3-D viewport's texture",
          std::to_string(viewport) + " do");
    check(!frame.viewport().visible, "the frame asks the renderer for no 3-D viewport", "");
    const Canvas cv = readCanvas();
    check(cv.found, "the Sheet tab has its own window", "no /##sheet_canvas_ child");
    check(cv.viewportCommands == 0, "the Sheet tab's window draws no viewport texture", "");
    check(cv.ink.empty() && cv.paperQuads == 0, "before Draw the sheet there is no sheet",
          std::to_string(cv.ink.size()) + " strokes");
    const std::vector<std::string> head = headerLines(cv);
    printLines("before", head);
    check(anyLineHas(head, "Draw the sheet"), "the tab offers Draw the sheet", "");
    check(anyLineHas(head, "Not drawn yet."), "the tab says the sheet is not drawn yet", "");
    check(seam.calls == 0 && drawRequests(frame) == 0,
          "showing the tab computed nothing (no sheet was asked for)",
          std::to_string(seam.calls) + " requests");
    check(drawButton(frame).valid, "the frame published the button's rectangle", "");
  }

  // ══ 2. DRAW THE SHEET: THE SAME INK AS THE SAVED DRAWING ════════════════
  const std::string svgPath = tempPath("forge_sheet_canvas_gate.svg");
  const Export first = exportClean(shell, frame, seam, svgPath);
  check(first.ran, "File > Save the Drawing wrote the reference SVG", first.error);
  const SvgSheet svg0 = readSvg(first.bytes);
  Canvas before;
  {
    const auto t0 = std::chrono::steady_clock::now();
    check(pressDraw(frame), "Draw the sheet was pressed", "");
    const double ms =
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    std::printf("[sheet_canvas_gate] first draw: %.0f ms (the frame measured %.0f ms)\n", ms,
                drawMs(frame));
    check(seam.calls == 1, "the tab asked the SHELL's drawing source, once",
          std::to_string(seam.calls) + " requests");
    check(sheetDrawn(frame), "the frame has a sheet", notice(frame));
    // The tab was handed exactly what the Save wrote: the same sheet, laid out
    // by layoutDrawing() and written by writeDrawingSvg(), is the file's bytes.
    const forge::ui::DrawingLayoutResult L = forge::ui::layoutDrawing(seam.lastClean);
    check(L.ok && forge::ui::writeDrawingSvg(seam.lastClean, L) == first.bytes,
          "layoutDrawing() of the sheet the tab was handed IS the saved file, byte for byte",
          L.reason);
    before = readCanvas();
    checkSheetMatches(before, svg0, "first sheet");
    check(viewportCommandsInFrame() == 0, "still no viewport texture anywhere in the frame", "");
    const std::vector<std::string> head = headerLines(before);
    printLines("drawn", head);
    check(notice(frame).empty(), "a freshly drawn sheet carries no warning",
          notice(frame));
  }

  // ══ 3. NEVER PER FRAME ══════════════════════════════════════════════════
  {
    const std::size_t calls = seam.calls;
    const std::size_t requests = drawRequests(frame);
    for (int i = 0; i < 20; ++i) step(frame);
    check(seam.calls == calls && drawRequests(frame) == requests,
          "twenty more frames asked the source for nothing",
          std::to_string(seam.calls - calls) + " requests");
    check(notice(frame).empty(), "and nothing went stale on its own", notice(frame));
  }

  // ══ 4. A CHANGE IS SAID IN WORDS ════════════════════════════════════════
  // The LAYOUT and the WORDS first, on the fresh sheet: each change gets its own
  // sentence, and undoing it takes the sentence away -- the witness is what the
  // sheet was drawn from, not a flag that only ever gets set.
  {
    forge::ui::TitleBlockData& t = frame.drawing().titleBlock();
    const forge::ui::ProjectionAngle was = t.projection;
    t.projection = was == forge::ui::ProjectionAngle::First ? forge::ui::ProjectionAngle::Third
                                                             : forge::ui::ProjectionAngle::First;
    step(frame);
    const std::vector<std::string> proj = headerLines(readCanvas());
    check(anyLineHas(proj, "the scale or the projection has changed"),
          "a projection change is said in words", notice(frame));
    t.projection = was;
    step(frame);
    check(notice(frame).empty(), "putting the projection back makes the sentence go away",
          notice(frame));
    const std::string author = t.author;
    t.author = "A. Checker";
    step(frame);
    const std::vector<std::string> words = headerLines(readCanvas());
    check(anyLineHas(words, "The title block or the notes have changed"),
          "a title-block edit is said in words", notice(frame));
    t.author = author;
    step(frame);
    check(notice(frame).empty(), "undoing the title-block edit makes it go away",
          notice(frame));
  }

  const std::string kPartChanged = "The part has changed since this sheet was drawn";
  {
    std::string why;
    check(editFeature(shell, 1, 0, 100.0, why), "the plate's width was edited 80 -> 100", why);
    step(frame);
    step(frame);
    const auto& b = scene.lastBuild();
    checkNear(b.bboxMax[0] - b.bboxMin[0], 100.0, 1e-6, "the kernel rebuilt it 100 wide");
    // MUTATION 4 reads the tab as it was before the edit: the picture of a tab
    // that never re-reads what its sheet was drawn from.
    const Canvas cv = g_mutation == 4 ? before : readCanvas();
    const std::vector<std::string> head = headerLines(cv);
    printLines("after edit", head);
    check(anyLineHas(head, kPartChanged), "the tab SAYS the part has changed since it was drawn",
          "");
    check(forge::ui::isUserReadable(notice(frame)), "in plain words", notice(frame));
    check(seam.calls == 1, "the edit did not silently redraw the sheet",
          std::to_string(seam.calls) + " requests");
    // The old sheet is still the old sheet: shown, labelled, not altered.
    checkSheetMatches(cv, svg0, "stale sheet");
  }
  // ══ 5. DRAWN AGAIN, IT IS THE NEW DRAWING ═══════════════════════════════
  {
    std::string why;
    // Off-centre in Y: the top view is no longer symmetric top-to-bottom.
    check(editFeature(shell, 3, 3, 12.0, why), "the bore was moved to y = 12", why);
    step(frame);
    step(frame);
    check(anyLineHas(headerLines(readCanvas()), kPartChanged), "the move is said in words too",
          notice(frame));
    const Export second = exportClean(shell, frame, seam, svgPath);
    check(second.ran, "the drawing was saved again after the edits", second.error);
    const SvgSheet svg1 = readSvg(second.bytes);
    check(second.bytes != first.bytes, "the new drawing differs from the first", "");
    const std::size_t calls = seam.calls;
    check(pressDraw(frame), "Draw the sheet was pressed again", "");
    check(seam.calls == calls + 1, "...and asked the source once more", "");
    const Canvas cv = readCanvas();
    const std::vector<std::string> head = headerLines(cv);
    printLines("redrawn", head);
    check(!anyLineHas(head, kPartChanged) && notice(frame).empty(),
          "drawn again, the sentence is gone", notice(frame));
    const forge::ui::DrawingLayoutResult L = forge::ui::layoutDrawing(seam.lastClean);
    check(L.ok && forge::ui::writeDrawingSvg(seam.lastClean, L) == second.bytes,
          "the redrawn tab was handed the new saved file's sheet, byte for byte", L.reason);
    checkSheetMatches(cv, svg1, "redrawn");
  }

  // ══ 6. A NEW DOCUMENT HAS NO SHEET YET ══════════════════════════════════
  // The sheet on the tab is of the part it was drawn from. A new part must not
  // be shown under the old part's drawing, labelled or not.
  {
    std::string err;
    // File > New's own body (the DocumentHost call the shell's file.new makes).
    check(frame.documentNew(err), "a new document was started", err);
    step(frame);
    step(frame);
    const Canvas cv = readCanvas();
    check(cv.found && cv.paperQuads == 0 && cv.ink.empty(),
          "the new document's Sheet tab shows no sheet",
          std::to_string(cv.ink.size()) + " strokes");
    check(!sheetDrawn(frame) && anyLineHas(headerLines(cv), "Not drawn yet."),
          "...and says it is not drawn yet", notice(frame));
  }

  check(frame.layoutReseatsDuringWalk() == 0, "no layout was re-seated during a dock walk", "");
  std::printf("[sheet_canvas_gate] %zu checks, %zu failures — %s\n", g_checks, g_failures,
              g_failures == 0 ? "PASS" : "FAIL");
  return g_failures == 0 ? 0 : 1;
}
