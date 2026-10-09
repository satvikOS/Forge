// ui/src/DrawingSheetWriter.cpp
//
// The sheet half of forge/ui/DrawingExport.hpp (T-230): where each view goes on
// the paper, and the SVG and DXF text. Kept apart from DrawingExport.cpp, which
// holds only the formats, refusals and sentences, so a tool that needs the
// file-name policy (the AppKit panel probe) does not have to link the drawing
// model to get it.
#include "forge/ui/DrawingExport.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <map>
#include <string>
#include <vector>

namespace forge::ui {

namespace {

// Fixed precision, C locale digits: the same sheet always produces the same
// bytes, which is what lets a gate (or a reviewer with diff) compare two exports.
std::string num(double v) {
  if (!std::isfinite(v)) v = 0.0;
  if (std::fabs(v) < 5e-5) v = 0.0;  // never print "-0.0000"
  char buf[48];
  std::snprintf(buf, sizeof(buf), "%.4f", v);
  return buf;
}

const char* viewWord(NamedView v) noexcept {
  switch (v) {
    case NamedView::Front: return "FRONT";
    case NamedView::Back: return "BACK";
    case NamedView::Left: return "LEFT";
    case NamedView::Right: return "RIGHT";
    case NamedView::Top: return "TOP";
    case NamedView::Bottom: return "BOTTOM";
    case NamedView::Isometric: return "ISOMETRIC";
  }
  return "VIEW";
}

double polylineLength(const DrawingPolyline& p) {
  double len = 0.0;
  for (std::size_t i = 1; i < p.points.size(); ++i) {
    len += std::hypot(p.points[i][0] - p.points[i - 1][0], p.points[i][1] - p.points[i - 1][1]);
  }
  return len;
}

bool usable(const DrawingPolyline& p) {
  if (p.points.size() < 2) return false;
  for (const auto& q : p.points) {
    if (!std::isfinite(q[0]) || !std::isfinite(q[1])) return false;
  }
  return true;
}

// The reserved bottom-right block: the title block, and the notes stacked above it.
constexpr double kTitleRowMm = 5.0;
constexpr double kTitleMaxWidthMm = 180.0;  // ISO 7200's maximum title block width
constexpr double kLabelColumnMm = 38.0;
constexpr double kTextMm = 2.5;
constexpr double kViewLabelGapMm = 4.0;
constexpr double kMaxGapMm = 25.0;

std::string xmlEscape(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (char c : s) {
    switch (c) {
      case '&': out += "&amp;"; break;
      case '<': out += "&lt;"; break;
      case '>': out += "&gt;"; break;
      case '"': out += "&quot;"; break;
      case '\'': out += "&apos;"; break;
      default:
        // Control characters are not allowed in XML 1.0 text at all.
        if (static_cast<unsigned char>(c) < 0x20 && c != '\t') {
          out += ' ';
        } else {
          out += c;
        }
    }
  }
  return out;
}

// DXF R12 text is a single line of 8-bit text; anything outside printable ASCII
// is replaced rather than risked.
std::string dxfText(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (char c : s) {
    const unsigned char u = static_cast<unsigned char>(c);
    out += (u >= 0x20 && u < 0x7f) ? c : '?';
  }
  return out;
}

}  // namespace

DrawingLayoutResult layoutDrawing(const DrawingSheetContent& in) {
  DrawingLayoutResult out;
  const SheetSize& s = in.sheet;
  if (!(s.widthMm > 0.0) || !(s.heightMm > 0.0)) {
    out.reason = "There is no sheet to draw on. Choose a sheet size in the Title Block tab.";
    return out;
  }
  if (!in.scale.valid()) {
    out.reason = "The drawing has no scale yet. Build the part and a scale is chosen for it.";
    return out;
  }
  out.factor = in.scale.factor();
  out.frameMinX = s.filingMm;
  out.frameMinY = s.borderMm;
  out.frameMaxX = s.widthMm - s.borderMm;
  out.frameMaxY = s.heightMm - s.borderMm;
  const double frameW = out.frameMaxX - out.frameMinX;
  const double frameH = out.frameMaxY - out.frameMinY;

  // ── the reserved block: title block + notes, bottom right ──────────────
  const double tbW = std::min(kTitleMaxWidthMm, 0.5 * frameW);
  const double tbH = std::min(kTitleRowMm * static_cast<double>(in.titleBlock.size() + 1),
                              0.6 * frameH);
  out.titleMaxX = out.frameMaxX;
  out.titleMinX = out.frameMaxX - tbW;
  out.titleMinY = out.frameMinY;
  out.titleMaxY = out.frameMinY + tbH;
  const double notesH = kTitleRowMm * static_cast<double>(in.notes.size());
  const double reservedMaxY = std::min(out.frameMaxY, out.titleMaxY + notesH);
  const double reservedMinX = out.titleMinX;

  // ── the projection group ───────────────────────────────────────────────
  struct Item {
    const DrawingViewLines* lines;
    SheetCell cell;
    double w, h;  // on paper
  };
  std::vector<Item> items;
  for (const DrawingViewLines& v : in.views) {
    SheetCell cell = sheetCell(v.view, in.projection);
    if (!cell.placedByProjection) continue;  // an isometric is not part of the group
    const double w = std::max(0.0, v.maxRight - v.minRight) * out.factor;
    const double h = std::max(0.0, v.maxUp - v.minUp) * out.factor;
    if (!std::isfinite(w) || !std::isfinite(h)) continue;
    items.push_back(Item{&v, cell, w, h});
  }
  if (items.empty()) {
    out.reason = "There is nothing built to draw yet. Add a feature to the part and its views "
                 "can be saved.";
    return out;
  }

  std::map<int, double> colW;
  std::map<int, double> rowH;
  for (const Item& it : items) {
    colW[it.cell.column] = std::max(colW[it.cell.column], it.w);
    rowH[it.cell.row] = std::max(rowH[it.cell.row], it.h);
  }
  double sumW = 0.0;
  double sumH = 0.0;
  for (const auto& kv : colW) sumW += kv.second;
  for (const auto& kv : rowH) sumH += kv.second;
  // Room under each view for its label.
  sumH += kViewLabelGapMm * static_cast<double>(rowH.size());

  struct Region {
    double minX, minY, maxX, maxY;
  };
  const Region candidates[] = {
      {out.frameMinX, reservedMaxY, out.frameMaxX, out.frameMaxY},  // above the block
      {out.frameMinX, out.frameMinY, reservedMinX, out.frameMaxY},  // left of the block
  };
  Region chosen{out.frameMinX, out.frameMinY, out.frameMaxX, out.frameMaxY};
  bool fitted = false;
  for (const Region& r : candidates) {
    if (sumW <= (r.maxX - r.minX) && sumH <= (r.maxY - r.minY)) {
      chosen = r;
      fitted = true;
      break;
    }
  }
  out.crowded = !fitted;

  const double regionW = chosen.maxX - chosen.minX;
  const double regionH = chosen.maxY - chosen.minY;
  const double nCols = static_cast<double>(colW.size());
  const double nRows = static_cast<double>(rowH.size());
  const double gapX = std::clamp((regionW - sumW) / (nCols + 1.0), 0.0, kMaxGapMm);
  const double gapY = std::clamp((regionH - sumH) / (nRows + 1.0), 0.0, kMaxGapMm);
  const double groupW = sumW + gapX * (nCols - 1.0);
  const double groupH = sumH + gapY * (nRows - 1.0);
  const double startX = chosen.minX + 0.5 * (regionW - groupW);
  const double startY = chosen.minY + 0.5 * (regionH - groupH);

  // Columns left to right, rows bottom to top -- SheetCell's own orientation.
  std::map<int, double> colMin;
  std::map<int, double> rowMin;
  double x = startX;
  for (const auto& kv : colW) {
    colMin[kv.first] = x;
    x += kv.second + gapX;
  }
  double y = startY;
  for (const auto& kv : rowH) {
    rowMin[kv.first] = y + kViewLabelGapMm;
    y += kv.second + kViewLabelGapMm + gapY;
  }

  for (const Item& it : items) {
    PlacedView p;
    p.view = it.lines->view;
    p.cell = it.cell;
    // Aligned on the cell's LOW edge, not centred: views sharing a column share
    // the model's right-axis minimum (front and top both start at the part's
    // smallest x), so a common low edge IS projection alignment.
    p.cellMinX = colMin[it.cell.column];
    p.cellMinY = rowMin[it.cell.row];
    p.cellMaxX = p.cellMinX + it.w;
    p.cellMaxY = p.cellMinY + it.h;
    p.originX = p.cellMinX - it.lines->minRight * out.factor;
    p.originY = p.cellMinY - it.lines->minUp * out.factor;
    for (const DrawingPolyline& pl : it.lines->visible) {
      if (!usable(pl)) continue;
      ++p.visiblePolylines;
      p.visibleLengthMm += polylineLength(pl) * out.factor;
    }
    for (const DrawingPolyline& pl : it.lines->hidden) {
      if (!usable(pl)) continue;
      ++p.hiddenPolylines;
      p.hiddenLengthMm += polylineLength(pl) * out.factor;
    }
    if (p.cellMinX < out.frameMinX - 1e-6 || p.cellMaxX > out.frameMaxX + 1e-6 ||
        p.cellMinY < out.frameMinY - 1e-6 || p.cellMaxY > out.frameMaxY + 1e-6) {
      out.crowded = true;
    }
    out.views.push_back(p);
  }
  out.ok = true;
  return out;
}

namespace {

const DrawingViewLines* linesFor(const DrawingSheetContent& sheet, NamedView v) {
  for (const DrawingViewLines& l : sheet.views) {
    if (l.view == v) return &l;
  }
  return nullptr;
}

std::string svgPoints(const DrawingPolyline& pl, const PlacedView& p, double factor,
                      double sheetH) {
  std::string pts;
  for (std::size_t i = 0; i < pl.points.size(); ++i) {
    const double px = p.originX + pl.points[i][0] * factor;
    const double py = p.originY + pl.points[i][1] * factor;
    if (i != 0) pts += ' ';
    pts += num(px);
    pts += ',';
    pts += num(sheetH - py);
  }
  return pts;
}

}  // namespace

std::string writeDrawingSvg(const DrawingSheetContent& sheet, const DrawingLayoutResult& layout) {
  const double W = sheet.sheet.widthMm;
  const double H = sheet.sheet.heightMm;
  const double f = layout.factor;
  const auto Y = [H](double paperY) { return H - paperY; };
  std::string o;
  o.reserve(64 * 1024);
  o += "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>\n";
  o += "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" width=\"" + num(W) +
       "mm\" height=\"" + num(H) + "mm\" viewBox=\"0 0 " + num(W) + " " + num(H) +
       "\" data-forge-drawing=\"1\" data-sheet=\"" + xmlEscape(sheet.sheet.id) +
       "\" data-scale=\"" + xmlEscape(sheet.scale.text()) + "\" data-projection=\"" +
       toString(sheet.projection) + "\">\n";
  o += "<title>" + xmlEscape(sheet.sheet.label + "  " + sheet.scale.text() + "  " +
                             projectionLabel(sheet.projection)) +
       "</title>\n";
  o += "<rect id=\"paper\" x=\"0\" y=\"0\" width=\"" + num(W) + "\" height=\"" + num(H) +
       "\" fill=\"#ffffff\" stroke=\"none\"/>\n";
  o += "<rect id=\"frame\" x=\"" + num(layout.frameMinX) + "\" y=\"" + num(Y(layout.frameMaxY)) +
       "\" width=\"" + num(layout.frameMaxX - layout.frameMinX) + "\" height=\"" +
       num(layout.frameMaxY - layout.frameMinY) +
       "\" fill=\"none\" stroke=\"#000000\" stroke-width=\"0.7\"/>\n";

  for (const PlacedView& p : layout.views) {
    const DrawingViewLines* lines = linesFor(sheet, p.view);
    if (lines == nullptr) continue;
    o += "<g id=\"view-" + std::string(toString(p.view)) + "\" data-view=\"" + toString(p.view) +
         "\" data-column=\"" + std::to_string(p.cell.column) + "\" data-row=\"" +
         std::to_string(p.cell.row) + "\" data-cell=\"" + num(p.cellMinX) + " " + num(p.cellMinY) +
         " " + num(p.cellMaxX) + " " + num(p.cellMaxY) + "\">\n";
    o += "<g class=\"visible\" fill=\"none\" stroke=\"#000000\" stroke-width=\"0.5\" "
         "stroke-linecap=\"round\" stroke-linejoin=\"round\">\n";
    for (const DrawingPolyline& pl : lines->visible) {
      if (!usable(pl)) continue;
      o += "<polyline points=\"" + svgPoints(pl, p, f, H) + "\"/>\n";
    }
    o += "</g>\n";
    o += "<g class=\"hidden\" fill=\"none\" stroke=\"#000000\" stroke-width=\"0.25\" "
         "stroke-dasharray=\"3 1.5\">\n";
    for (const DrawingPolyline& pl : lines->hidden) {
      if (!usable(pl)) continue;
      o += "<polyline points=\"" + svgPoints(pl, p, f, H) + "\"/>\n";
    }
    o += "</g>\n";
    o += "<text x=\"" + num(0.5 * (p.cellMinX + p.cellMaxX)) + "\" y=\"" +
         num(Y(p.cellMinY - kViewLabelGapMm + 0.5)) +
         "\" font-family=\"Helvetica, Arial, sans-serif\" font-size=\"" + num(kTextMm) +
         "\" text-anchor=\"middle\">" + viewWord(p.view) + "</text>\n";
    o += "</g>\n";
  }

  // ── title block ─────────────────────────────────────────────────────────
  o += "<g id=\"title-block\" font-family=\"Helvetica, Arial, sans-serif\" font-size=\"" +
       num(kTextMm) + "\">\n";
  o += "<rect x=\"" + num(layout.titleMinX) + "\" y=\"" + num(Y(layout.titleMaxY)) +
       "\" width=\"" + num(layout.titleMaxX - layout.titleMinX) + "\" height=\"" +
       num(layout.titleMaxY - layout.titleMinY) +
       "\" fill=\"none\" stroke=\"#000000\" stroke-width=\"0.5\"/>\n";
  double rowTop = layout.titleMaxY;
  {
    const std::string head = "Forge drawing  " + sheet.scale.text() + "  " +
                             projectionLabel(sheet.projection);
    o += "<text x=\"" + num(layout.titleMinX + 2.0) + "\" y=\"" + num(Y(rowTop - 3.5)) +
         "\" font-weight=\"bold\">" + xmlEscape(head) + "</text>\n";
    rowTop -= kTitleRowMm;
  }
  for (const TitleBlockField& row : sheet.titleBlock) {
    if (rowTop - kTitleRowMm < layout.titleMinY - 1e-6) break;
    o += "<line x1=\"" + num(layout.titleMinX) + "\" y1=\"" + num(Y(rowTop)) + "\" x2=\"" +
         num(layout.titleMaxX) + "\" y2=\"" + num(Y(rowTop)) +
         "\" stroke=\"#000000\" stroke-width=\"0.25\"/>\n";
    o += "<text class=\"label\" data-key=\"" + xmlEscape(row.key) + "\" x=\"" +
         num(layout.titleMinX + 2.0) + "\" y=\"" + num(Y(rowTop - 3.5)) + "\">" +
         xmlEscape(row.label) + "</text>\n";
    o += "<text class=\"value\" data-key=\"" + xmlEscape(row.key) + "\" x=\"" +
         num(layout.titleMinX + kLabelColumnMm) + "\" y=\"" + num(Y(rowTop - 3.5)) + "\">" +
         xmlEscape(row.value) + "</text>\n";
    rowTop -= kTitleRowMm;
  }
  o += "</g>\n";

  // ── notes, stacked above the title block ────────────────────────────────
  o += "<g id=\"notes\" font-family=\"Helvetica, Arial, sans-serif\" font-size=\"" + num(kTextMm) +
       "\">\n";
  double noteY = layout.titleMaxY + 2.0;
  for (const std::string& note : sheet.notes) {
    o += "<text x=\"" + num(layout.titleMinX + 2.0) + "\" y=\"" + num(Y(noteY)) + "\">" +
         xmlEscape(note) + "</text>\n";
    noteY += kTitleRowMm;
  }
  o += "</g>\n";
  o += "</svg>\n";
  return o;
}

namespace {

void dxfPair(std::string& o, int code, const std::string& value) {
  o += std::to_string(code);
  o += '\n';
  o += value;
  o += '\n';
}

void dxfLine(std::string& o, const char* layer, double x1, double y1, double x2, double y2) {
  dxfPair(o, 0, "LINE");
  dxfPair(o, 8, layer);
  dxfPair(o, 10, num(x1));
  dxfPair(o, 20, num(y1));
  dxfPair(o, 30, num(0.0));
  dxfPair(o, 11, num(x2));
  dxfPair(o, 21, num(y2));
  dxfPair(o, 31, num(0.0));
}

void dxfTextAt(std::string& o, double x, double y, const std::string& text) {
  if (text.empty()) return;
  dxfPair(o, 0, "TEXT");
  dxfPair(o, 8, "TEXT");
  dxfPair(o, 10, num(x));
  dxfPair(o, 20, num(y));
  dxfPair(o, 30, num(0.0));
  dxfPair(o, 40, num(kTextMm));
  dxfPair(o, 1, dxfText(text));
}

void dxfRect(std::string& o, const char* layer, double x0, double y0, double x1, double y1) {
  dxfLine(o, layer, x0, y0, x1, y0);
  dxfLine(o, layer, x1, y0, x1, y1);
  dxfLine(o, layer, x1, y1, x0, y1);
  dxfLine(o, layer, x0, y1, x0, y0);
}

}  // namespace

std::string writeDrawingDxf(const DrawingSheetContent& sheet, const DrawingLayoutResult& layout) {
  const double f = layout.factor;
  std::string o;
  o.reserve(128 * 1024);
  // HEADER: the version and the extents. AC1009 is R12, the most widely read
  // ASCII DXF there is; everything below uses only R12 entities (LINE, TEXT).
  dxfPair(o, 0, "SECTION");
  dxfPair(o, 2, "HEADER");
  dxfPair(o, 9, "$ACADVER");
  dxfPair(o, 1, "AC1009");
  dxfPair(o, 9, "$EXTMIN");
  dxfPair(o, 10, num(0.0));
  dxfPair(o, 20, num(0.0));
  dxfPair(o, 9, "$EXTMAX");
  dxfPair(o, 10, num(sheet.sheet.widthMm));
  dxfPair(o, 20, num(sheet.sheet.heightMm));
  dxfPair(o, 0, "ENDSEC");

  // TABLES: a dashed linetype for hidden edges and one layer per line class.
  dxfPair(o, 0, "SECTION");
  dxfPair(o, 2, "TABLES");
  dxfPair(o, 0, "TABLE");
  dxfPair(o, 2, "LTYPE");
  dxfPair(o, 70, "2");
  dxfPair(o, 0, "LTYPE");
  dxfPair(o, 2, "CONTINUOUS");
  dxfPair(o, 70, "0");
  dxfPair(o, 3, "Solid line");
  dxfPair(o, 72, "65");
  dxfPair(o, 73, "0");
  dxfPair(o, 40, num(0.0));
  dxfPair(o, 0, "LTYPE");
  dxfPair(o, 2, "HIDDEN");
  dxfPair(o, 70, "0");
  dxfPair(o, 3, "Hidden __ __ __");
  dxfPair(o, 72, "65");
  dxfPair(o, 73, "2");
  dxfPair(o, 40, num(4.5));
  dxfPair(o, 49, num(3.0));
  dxfPair(o, 49, num(-1.5));
  dxfPair(o, 0, "ENDTAB");
  dxfPair(o, 0, "TABLE");
  dxfPair(o, 2, "LAYER");
  dxfPair(o, 70, "4");
  const char* layers[][2] = {{"FRAME", "CONTINUOUS"},
                             {"VISIBLE", "CONTINUOUS"},
                             {"HIDDEN", "HIDDEN"},
                             {"TEXT", "CONTINUOUS"}};
  for (const auto& l : layers) {
    dxfPair(o, 0, "LAYER");
    dxfPair(o, 2, l[0]);
    dxfPair(o, 70, "0");
    dxfPair(o, 62, "7");
    dxfPair(o, 6, l[1]);
  }
  dxfPair(o, 0, "ENDTAB");
  dxfPair(o, 0, "ENDSEC");

  dxfPair(o, 0, "SECTION");
  dxfPair(o, 2, "ENTITIES");
  dxfRect(o, "FRAME", layout.frameMinX, layout.frameMinY, layout.frameMaxX, layout.frameMaxY);
  for (const PlacedView& p : layout.views) {
    const DrawingViewLines* lines = linesFor(sheet, p.view);
    if (lines == nullptr) continue;
    const auto emit = [&](const std::vector<DrawingPolyline>& set, const char* layer) {
      for (const DrawingPolyline& pl : set) {
        if (!usable(pl)) continue;
        for (std::size_t i = 1; i < pl.points.size(); ++i) {
          dxfLine(o, layer, p.originX + pl.points[i - 1][0] * f,
                  p.originY + pl.points[i - 1][1] * f, p.originX + pl.points[i][0] * f,
                  p.originY + pl.points[i][1] * f);
        }
      }
    };
    emit(lines->visible, "VISIBLE");
    emit(lines->hidden, "HIDDEN");
    dxfTextAt(o, p.cellMinX, p.cellMinY - kViewLabelGapMm + 0.5, viewWord(p.view));
  }
  dxfRect(o, "FRAME", layout.titleMinX, layout.titleMinY, layout.titleMaxX, layout.titleMaxY);
  double rowTop = layout.titleMaxY;
  dxfTextAt(o, layout.titleMinX + 2.0, rowTop - 3.5,
            "Forge drawing  " + sheet.scale.text() + "  " + projectionLabel(sheet.projection));
  rowTop -= kTitleRowMm;
  for (const TitleBlockField& row : sheet.titleBlock) {
    if (rowTop - kTitleRowMm < layout.titleMinY - 1e-6) break;
    dxfLine(o, "FRAME", layout.titleMinX, rowTop, layout.titleMaxX, rowTop);
    dxfTextAt(o, layout.titleMinX + 2.0, rowTop - 3.5, row.label);
    dxfTextAt(o, layout.titleMinX + kLabelColumnMm, rowTop - 3.5, row.value);
    rowTop -= kTitleRowMm;
  }
  double noteY = layout.titleMaxY + 2.0;
  for (const std::string& note : sheet.notes) {
    dxfTextAt(o, layout.titleMinX + 2.0, noteY, note);
    noteY += kTitleRowMm;
  }
  dxfPair(o, 0, "ENDSEC");
  dxfPair(o, 0, "EOF");
  return o;
}

}  // namespace forge::ui
