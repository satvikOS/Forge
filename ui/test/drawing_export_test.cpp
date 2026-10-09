// ui/test/drawing_export_test.cpp
//
// THE DRAWING SHEET, ASSERTED WITHOUT A KERNEL (T-230).
//
// forge_desktop_drawing_export_gate drives file.export_drawing end to end on the
// application's own part. This file pins the half of it that forge::ui owns and
// that a headless build can check in milliseconds, each against an answer worked
// out here by hand rather than read back from the module:
//
//   1. THE FILE NAME DECIDES THE FORMAT, and nothing else does: .svg and .dxf in
//      any case, anything else refused with `out` left alone.
//   2. THE LAYOUT IS THE PROJECTION RULE. For a hand-built 80 x 50 x 20 box the
//      cells land where ISO 128-30 (first angle) and ASME Y14.3 (third angle)
//      put them, views sharing a column share their left edge, views sharing a
//      row share their bottom edge, and every cell is the view's extent times
//      the scale -- to 1e-9 mm.
//   3. THE WRITERS WRITE THE LAYOUT. A model point is followed through to the
//      exact SVG coordinate (y flipped once) and the exact DXF LINE it becomes;
//      hidden lines go to the dashed group / HIDDEN layer and nowhere else;
//      the polyline and LINE counts are the input's.
//   4. WHAT A USER TYPED CANNOT BREAK THE FILE. Markup in a title block field is
//      escaped in the SVG; non-ASCII is replaced in the R12 DXF.
//   5. THE SAME SHEET IS THE SAME BYTES, twice.
//   6. EVERY SENTENCE IS PLAIN. Every refusal, with and without a path, and the
//      success sentence, through isUserReadable and scanUserFacingProse.
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <limits>
#include <string>
#include <vector>

#include "forge/ui/Drawing.hpp"
#include "forge/ui/DrawingExport.hpp"
#include "forge/ui/FileExchange.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/UserFacingText.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;

namespace {

std::size_t countOf(const std::string& hay, const std::string& needle) {
  std::size_t n = 0;
  for (std::size_t at = hay.find(needle); at != std::string::npos;
       at = hay.find(needle, at + needle.size())) {
    ++n;
  }
  return n;
}

DrawingPolyline line(double x0, double y0, double x1, double y1) {
  DrawingPolyline p;
  p.points.push_back({x0, y0});
  p.points.push_back({x1, y1});
  return p;
}

// A closed rectangle as ONE polyline of five points (four segments).
DrawingPolyline rect(double x0, double y0, double x1, double y1) {
  DrawingPolyline p;
  p.points = {{x0, y0}, {x1, y0}, {x1, y1}, {x0, y1}, {x0, y0}};
  return p;
}

// One orthographic view of a box centred on the origin in x and y, standing on
// z = 0: the same frame drawingViewAxes() defines (front: right=+X up=+Z; top:
// right=+X up=+Y; right: right=+Y up=+Z).
DrawingViewLines boxView(NamedView v, double sx, double sy, double sz) {
  DrawingViewLines out;
  out.view = v;
  double r0 = 0, r1 = 0, u0 = 0, u1 = 0;
  switch (v) {
    case NamedView::Top: r0 = -sx / 2; r1 = sx / 2; u0 = -sy / 2; u1 = sy / 2; break;
    case NamedView::Right: r0 = -sy / 2; r1 = sy / 2; u0 = 0; u1 = sz; break;
    default: r0 = -sx / 2; r1 = sx / 2; u0 = 0; u1 = sz; break;
  }
  out.visible.push_back(rect(r0, u0, r1, u1));
  // one hidden line down the middle, so the hidden set is never empty
  out.hidden.push_back(line(0.5 * (r0 + r1), u0, 0.5 * (r0 + r1), u1));
  out.minRight = r0;
  out.maxRight = r1;
  out.minUp = u0;
  out.maxUp = u1;
  return out;
}

DrawingSheetContent boxSheet(ProjectionAngle angle, Scale scale, const char* sheetId) {
  DrawingSheetContent s;
  const SheetSize* sheet = findSheetSize(sheetId);
  if (sheet != nullptr) s.sheet = *sheet;
  s.scale = scale;
  s.projection = angle;
  s.views = {boxView(NamedView::Front, 80, 50, 20), boxView(NamedView::Top, 80, 50, 20),
             boxView(NamedView::Right, 80, 50, 20)};
  TitleBlockField scaleRow;
  scaleRow.key = "scale";
  scaleRow.label = "Scale";
  scaleRow.value = scale.text();
  s.titleBlock.push_back(scaleRow);
  return s;
}

const PlacedView* placed(const DrawingLayoutResult& l, NamedView v) {
  for (const PlacedView& p : l.views) {
    if (p.view == v) return &p;
  }
  return nullptr;
}

void checkPlain(forge::uitest::Harness& H, const std::string& sentence) {
  CHECK(!sentence.empty());
  CHECK(isUserReadable(sentence));
  const std::vector<ProseFinding> f = scanUserFacingProse(sentence);
  if (!f.empty()) {
    std::printf("        \"%s\"\n        %s\n", sentence.c_str(),
                describeProseFindings(f).c_str());
  }
  CHECK(f.empty());
}

}  // namespace

int main() {
  forge::uitest::Harness H("drawing_export_test");

  // ══ 1. the file name decides the format ═════════════════════════════════
  {
    DrawingFileFormat f = DrawingFileFormat::Dxf;
    CHECK(drawingFormatFromPath("/a/b/part.svg", f));
    CHECK(f == DrawingFileFormat::Svg);
    CHECK(drawingFormatFromPath("C:\\work\\PART.DXF", f));
    CHECK(f == DrawingFileFormat::Dxf);
    CHECK(drawingFormatFromPath("x.SvG", f));
    CHECK(f == DrawingFileFormat::Svg);
    // Refused, and `out` untouched: set it to a sentinel first.
    for (const char* bad : {"part.pdf", "part", "part.svg.bak", "/a/dir.svg/part", "part.sv",
                            "part.svgz", ".", ""}) {
      f = DrawingFileFormat::Dxf;
      CHECK(!drawingFormatFromPath(bad, f));
      CHECK(f == DrawingFileFormat::Dxf);
    }
    CHECK_EQ_INT(drawingExtensions().size(), 2);
    CHECK_EQ_STR(forge::uitest::at(drawingExtensions(), 0), std::string(".svg"));
    CHECK_EQ_STR(forge::uitest::at(drawingExtensions(), 1), std::string(".dxf"));
    CHECK_EQ_STR(std::string(toString(DrawingFileFormat::Svg)), std::string("svg"));
    CHECK_EQ_STR(std::string(toString(DrawingFileFormat::Dxf)), std::string("dxf"));
  }

  // ══ 2. the layout is the projection rule ════════════════════════════════
  for (const ProjectionAngle angle : {ProjectionAngle::First, ProjectionAngle::Third}) {
    const Scale scale{2, 1};
    const DrawingSheetContent sheet = boxSheet(angle, scale, "A3");
    CHECK(sheet.sheet.widthMm == 420.0);
    const DrawingLayoutResult l = layoutDrawing(sheet);
    CHECK(l.ok);
    CHECK(!l.crowded);
    CHECK_NEAR(l.factor, 2.0, 0.0);
    CHECK_EQ_INT(l.views.size(), 3);
    const PlacedView* fr = placed(l, NamedView::Front);
    const PlacedView* tp = placed(l, NamedView::Top);
    const PlacedView* rt = placed(l, NamedView::Right);
    CHECK(fr != nullptr && tp != nullptr && rt != nullptr);
    if (fr == nullptr || tp == nullptr || rt == nullptr) continue;
    // Cells are the extents times the scale, BY HAND: front 80 x 20, top 80 x 50,
    // right 50 x 20, at 2:1.
    CHECK_NEAR(fr->cellMaxX - fr->cellMinX, 160.0, 1e-9);
    CHECK_NEAR(fr->cellMaxY - fr->cellMinY, 40.0, 1e-9);
    CHECK_NEAR(tp->cellMaxX - tp->cellMinX, 160.0, 1e-9);
    CHECK_NEAR(tp->cellMaxY - tp->cellMinY, 100.0, 1e-9);
    CHECK_NEAR(rt->cellMaxX - rt->cellMinX, 100.0, 1e-9);
    CHECK_NEAR(rt->cellMaxY - rt->cellMinY, 40.0, 1e-9);
    // Projection alignment: a shared column is a shared left edge, a shared row
    // a shared bottom edge.
    CHECK_NEAR(tp->cellMinX, fr->cellMinX, 1e-9);
    CHECK_NEAR(rt->cellMinY, fr->cellMinY, 1e-9);
    // WHERE: third angle puts the top view above and the right view to the
    // right; first angle puts each on the opposite side.
    if (angle == ProjectionAngle::Third) {
      CHECK(tp->cellMinY > fr->cellMaxY);
      CHECK(rt->cellMinX > fr->cellMaxX);
    } else {
      CHECK(tp->cellMaxY < fr->cellMinY);
      CHECK(rt->cellMaxX < fr->cellMinX);
    }
    // The model origin lands where the cell says: model (-40, 0) is the front
    // view's bottom-left corner.
    CHECK_NEAR(fr->originX + (-40.0) * 2.0, fr->cellMinX, 1e-9);
    CHECK_NEAR(fr->originY + 0.0 * 2.0, fr->cellMinY, 1e-9);
    // Ink on paper: the rectangle's perimeter and the one hidden line, at 2:1.
    CHECK_NEAR(fr->visibleLengthMm, 2.0 * (2 * 80 + 2 * 20), 1e-9);
    CHECK_NEAR(fr->hiddenLengthMm, 2.0 * 20, 1e-9);
    CHECK_EQ_INT(fr->visiblePolylines, 1);
    CHECK_EQ_INT(fr->hiddenPolylines, 1);
    // Everything inside the frame, and clear of the title block.
    for (const PlacedView& p : l.views) {
      CHECK(p.cellMinX >= l.frameMinX - 1e-9 && p.cellMaxX <= l.frameMaxX + 1e-9);
      CHECK(p.cellMinY >= l.frameMinY - 1e-9 && p.cellMaxY <= l.frameMaxY + 1e-9);
      const bool clearOfTitle = p.cellMaxX <= l.titleMinX + 1e-9 ||
                                p.cellMinY >= l.titleMaxY - 1e-9;
      CHECK(clearOfTitle);
    }
  }

  // ══ 2b. the layout refuses, and says so in plain words ══════════════════
  {
    DrawingSheetContent noScale = boxSheet(ProjectionAngle::First, Scale{0, 1}, "A3");
    DrawingLayoutResult l = layoutDrawing(noScale);
    CHECK(!l.ok);
    checkPlain(H, l.reason);

    DrawingSheetContent noPaper = boxSheet(ProjectionAngle::First, Scale{1, 1}, "A3");
    noPaper.sheet = SheetSize{};
    l = layoutDrawing(noPaper);
    CHECK(!l.ok);
    checkPlain(H, l.reason);

    DrawingSheetContent onlyIso = boxSheet(ProjectionAngle::First, Scale{1, 1}, "A3");
    onlyIso.views = {boxView(NamedView::Front, 80, 50, 20)};
    onlyIso.views[0].view = NamedView::Isometric;  // not placed by projection
    l = layoutDrawing(onlyIso);
    CHECK(!l.ok);
    checkPlain(H, l.reason);

    // A pinned scale that overruns is still written -- and called crowded.
    DrawingSheetContent big = boxSheet(ProjectionAngle::Third, Scale{10, 1}, "A4");
    l = layoutDrawing(big);
    CHECK(l.ok);
    CHECK(l.crowded);
  }

  // ══ 3/4/5. the writers write the layout ═════════════════════════════════
  {
    DrawingSheetContent sheet = boxSheet(ProjectionAngle::Third, Scale{2, 1}, "A3");
    TitleBlockField hostile;
    hostile.key = "title";
    hostile.label = "Title";
    hostile.value = "<bracket> & \"arm\" \xC3\xA9";  // markup, quotes, a UTF-8 e-acute
    sheet.titleBlock.push_back(hostile);
    sheet.notes.push_back("Break sharp edges < 0.2");
    // A polyline with a NaN in it is not ink and must not reach either file.
    DrawingPolyline poison = line(0, 0, 1, 1);
    poison.points[1][0] = std::numeric_limits<double>::quiet_NaN();
    sheet.views[0].visible.push_back(poison);

    const DrawingLayoutResult l = layoutDrawing(sheet);
    CHECK(l.ok);
    const PlacedView* fr = placed(l, NamedView::Front);
    CHECK(fr != nullptr);
    CHECK_EQ_INT(fr == nullptr ? 0 : fr->visiblePolylines, 1);  // the NaN one was not counted

    const std::string svg = writeDrawingSvg(sheet, l);
    CHECK(svg.rfind("<?xml", 0) == 0);
    CHECK(svg.find("</svg>\n") == svg.size() - 7);
    // 3 visible rectangles + 3 hidden lines; the poisoned polyline is absent.
    CHECK_EQ_INT(countOf(svg, "<polyline "), 6);
    CHECK_EQ_INT(countOf(svg, "class=\"hidden\""), 3);
    CHECK_EQ_INT(countOf(svg, "stroke-dasharray"), 3);
    CHECK(svg.find("nan") == std::string::npos);
    CHECK(svg.find("data-scale=\"2:1\"") != std::string::npos);
    CHECK(svg.find("data-projection=\"third\"") != std::string::npos);
    // ONE POINT FOLLOWED BY HAND: the front view's model (-40, 0) is paper
    // (cellMinX, cellMinY); SVG y runs DOWN from the top of a 297 mm sheet.
    if (fr != nullptr) {
      char want[64];
      std::snprintf(want, sizeof(want), "%.4f,%.4f", fr->cellMinX, 297.0 - fr->cellMinY);
      CHECK(svg.find(std::string("points=\"") + want) != std::string::npos);
    }
    // Escaped, never raw.
    CHECK(svg.find("&lt;bracket&gt; &amp; &quot;arm&quot;") != std::string::npos);
    CHECK(svg.find("<bracket>") == std::string::npos);
    CHECK(svg.find("Break sharp edges &lt; 0.2") != std::string::npos);
    CHECK(writeDrawingSvg(sheet, l) == svg);

    const std::string dxf = writeDrawingDxf(sheet, l);
    CHECK(dxf.rfind("0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n", 0) == 0);
    CHECK(dxf.size() >= 6 && dxf.compare(dxf.size() - 6, 6, "0\nEOF\n") == 0);
    // LINE entities: 3 rectangles x 4 segments + 3 hidden lines + the frame (4)
    // + the title-block box (4) + one rule per title-block row (2 rows).
    CHECK_EQ_INT(countOf(dxf, "0\nLINE\n"), 3 * 4 + 3 + 4 + 4 + 2);
    CHECK_EQ_INT(countOf(dxf, "0\nLINE\n8\nHIDDEN\n"), 3);
    CHECK_EQ_INT(countOf(dxf, "0\nLINE\n8\nVISIBLE\n"), 12);
    CHECK(dxf.find("nan") == std::string::npos);
    // Non-ASCII replaced, markup left as text (DXF has none).
    CHECK(dxf.find("<bracket> & \"arm\" ??") != std::string::npos);
    // The same model point, in DXF's y-UP paper frame.
    if (fr != nullptr) {
      char want[96];
      std::snprintf(want, sizeof(want), "10\n%.4f\n20\n%.4f\n", fr->cellMinX, fr->cellMinY);
      CHECK(dxf.find(want) != std::string::npos);
    }
    CHECK(writeDrawingDxf(sheet, l) == dxf);
  }

  // ══ 6. every sentence is plain ══════════════════════════════════════════
  {
    for (const DrawingExportRefusal r : kAllDrawingExportRefusals) {
      for (const std::string& path : {std::string(), std::string("/Users/ab/bracket-v2.svg")}) {
        checkPlain(H, drawingExportMessage(r, path));
      }
      // A user's own file name may be snake_case, which the prose scanner flags
      // as an identifier by design; the sentence around it must still pass the
      // layer's own rule, the one the exchange and machine-program sentences
      // are held to with the same kind of path.
      CHECK(isUserReadable(drawingExportMessage(r, "/Users/a_b/part_v2.svg")));
      CHECK(std::string(toString(r)).find(' ') == std::string::npos);
    }
    DrawingExportReport rep;
    rep.ok = true;
    rep.format = DrawingFileFormat::Dxf;
    rep.views = 3;
    rep.sheetLabel = "A3  420 x 297 mm";
    rep.scaleText = "2:1";
    const std::string ok = drawingExportSuccessMessage(rep, "/Users/ab/bracket.dxf");
    checkPlain(H, ok);
    CHECK(ok.find("DXF") != std::string::npos);
    CHECK(ok.find("2:1") != std::string::npos);
    CHECK(ok.find("A3") != std::string::npos);
    rep.crowded = true;
    const std::string crowded = drawingExportSuccessMessage(rep, "/Users/ab/bracket.dxf");
    checkPlain(H, crowded);
    CHECK(crowded.size() > ok.size());
    // A source that hands over an identifier does not get it into the sentence.
    rep.sheetLabel = "TopoDS_Shape";
    const std::string leaked = drawingExportSuccessMessage(rep, "/Users/ab/bracket.dxf");
    checkPlain(H, leaked);
    CHECK(leaked.find("TopoDS") == std::string::npos);
  }

  return H.finish();
}
