#include "forge/ui/Drawing.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

namespace forge::ui {
namespace {

// The international inch, exactly 25.4 mm by the 1959 international yard and
// pound agreement. Spelled as a definition, not as a decimal someone typed --
// the same rule forge/ui/Units.hpp states for every other conversion.
constexpr double kMmPerInch = 25.4;

// ISO 5457 frame widths. A4..A2 take a 10 mm border; A1 and A0 take 20 mm. The
// filing (binding) margin is 20 mm on the left edge of every size.
constexpr double kIsoSmallBorderMm = 10.0;
constexpr double kIsoLargeBorderMm = 20.0;
constexpr double kIsoFilingMm = 20.0;

// ASME Y14.1 permits the drawing format's margins to vary with the format. This
// build uses one half-inch on every edge for the ANSI sizes, and the panel
// prints the drawable area it produces beside the paper size, so the figure a
// scale is computed against is visible rather than assumed.
constexpr double kAnsiMarginMm = 0.5 * kMmPerInch;

std::string dimensionLabel(const std::string& id, double w, double h) {
  char buf[96];
  std::snprintf(buf, sizeof(buf), "%s  %.0f x %.0f mm", id.c_str(), w, h);
  return std::string(buf);
}

SheetSize isoSheet(const char* id, double w, double h) {
  SheetSize s;
  s.id = id;
  s.family = "ISO 216";
  s.widthMm = w;
  s.heightMm = h;
  s.borderMm = (h >= 594.0) ? kIsoLargeBorderMm : kIsoSmallBorderMm;
  s.filingMm = kIsoFilingMm;
  s.label = dimensionLabel(s.id, w, h);
  return s;
}

SheetSize ansiSheet(const char* id, double wInches, double hInches) {
  SheetSize s;
  s.id = id;
  s.family = "ASME Y14.1";
  s.widthMm = wInches * kMmPerInch;
  s.heightMm = hInches * kMmPerInch;
  s.borderMm = kAnsiMarginMm;
  s.filingMm = kAnsiMarginMm;
  s.label = dimensionLabel(s.id, s.widthMm, s.heightMm);
  return s;
}

void normalise(double v[3]) noexcept {
  const double n = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (!(n > 1e-12)) return;
  v[0] /= n;
  v[1] /= n;
  v[2] /= n;
}

void cross3(const double a[3], const double b[3], double out[3]) noexcept {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
}

double dot3(const double a[3], const double b[3]) noexcept {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Accumulates one projected point into an extent under construction.
struct ExtentAccumulator {
  bool any = false;
  double rMin = 0.0, rMax = 0.0, uMin = 0.0, uMax = 0.0, nMin = 0.0, nMax = 0.0;
  std::size_t count = 0;

  void add(double r, double u, double n) noexcept {
    ++count;
    if (!any) {
      any = true;
      rMin = rMax = r;
      uMin = uMax = u;
      nMin = nMax = n;
      return;
    }
    rMin = std::min(rMin, r);
    rMax = std::max(rMax, r);
    uMin = std::min(uMin, u);
    uMax = std::max(uMax, u);
    nMin = std::min(nMin, n);
    nMax = std::max(nMax, n);
  }

  ProjectedExtent finish(const ViewAxes&) const {
    ProjectedExtent e;
    e.points = count;
    if (!any) return e;
    e.ok = true;
    e.minRight = rMin;
    e.maxRight = rMax;
    e.minUp = uMin;
    e.maxUp = uMax;
    e.widthMm = rMax - rMin;
    e.heightMm = uMax - uMin;
    e.depthMm = nMax - nMin;
    return e;
  }
};

bool finitePoint(double x, double y, double z) noexcept {
  return std::isfinite(x) && std::isfinite(y) && std::isfinite(z);
}

}  // namespace

// ── SheetSize ───────────────────────────────────────────────────────────────
double SheetSize::drawableWidthMm() const noexcept {
  return std::max(0.0, widthMm - borderMm - filingMm);
}
double SheetSize::drawableHeightMm() const noexcept {
  return std::max(0.0, heightMm - 2.0 * borderMm);
}

const std::vector<SheetSize>& sheetSizes() {
  // ISO 216 A-series, landscape (width is the long edge), smallest first. The
  // dimensions are the standard's own, not derived by halving, so a rounding
  // rule cannot drift one of them.
  static const std::vector<SheetSize> kSizes = {
      isoSheet("A4", 297.0, 210.0),
      isoSheet("A3", 420.0, 297.0),
      isoSheet("A2", 594.0, 420.0),
      isoSheet("A1", 841.0, 594.0),
      isoSheet("A0", 1189.0, 841.0),
      ansiSheet("ANSI A", 11.0, 8.5),
      ansiSheet("ANSI B", 17.0, 11.0),
      ansiSheet("ANSI C", 22.0, 17.0),
      ansiSheet("ANSI D", 34.0, 22.0),
      ansiSheet("ANSI E", 44.0, 34.0),
  };
  return kSizes;
}

const SheetSize* findSheetSize(const std::string& id) {
  for (const SheetSize& s : sheetSizes()) {
    if (s.id == id) return &s;
  }
  return nullptr;
}

// ── Scale ───────────────────────────────────────────────────────────────────
double Scale::factor() const noexcept {
  if (model <= 0) return 0.0;
  return static_cast<double>(drawing) / static_cast<double>(model);
}

std::string Scale::text() const {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%d:%d", drawing, model);
  return std::string(buf);
}

bool operator==(const Scale& a, const Scale& b) noexcept {
  return a.drawing == b.drawing && a.model == b.model;
}
bool operator!=(const Scale& a, const Scale& b) noexcept { return !(a == b); }

const std::vector<Scale>& standardScales() {
  // ISO 5455:1979, the recommended series, LARGEST FIRST so that walking the
  // list and stopping at the first fit yields the largest scale that fits.
  static const std::vector<Scale> kScales = {
      {50, 1}, {20, 1}, {10, 1}, {5, 1},  {2, 1},   {1, 1},   {1, 2},
      {1, 5},  {1, 10}, {1, 20}, {1, 50}, {1, 100}, {1, 200}, {1, 500},
      {1, 1000}, {1, 2000}, {1, 5000}, {1, 10000},
  };
  return kScales;
}

bool scaleFromText(const std::string& text, Scale& out) {
  std::string t;
  for (char c : text) {
    if (c != ' ' && c != '\t') t.push_back(c);
  }
  if (t.empty()) return false;
  const std::size_t colon = t.find(':');
  long a = 0;
  long b = 1;
  if (colon == std::string::npos) {
    char* end = nullptr;
    a = std::strtol(t.c_str(), &end, 10);
    if (end == t.c_str() || *end != '\0') return false;
  } else {
    const std::string left = t.substr(0, colon);
    const std::string right = t.substr(colon + 1);
    if (left.empty() || right.empty()) return false;
    char* endL = nullptr;
    char* endR = nullptr;
    a = std::strtol(left.c_str(), &endL, 10);
    b = std::strtol(right.c_str(), &endR, 10);
    if (endL == left.c_str() || *endL != '\0') return false;
    if (endR == right.c_str() || *endR != '\0') return false;
  }
  if (a <= 0 || b <= 0 || a > 1000000 || b > 1000000) return false;
  out.drawing = static_cast<int>(a);
  out.model = static_cast<int>(b);
  return true;
}

const char* toString(ScaleMode mode) noexcept {
  return mode == ScaleMode::Automatic ? "automatic" : "fixed";
}

bool scaleModeFromName(const std::string& name, ScaleMode& out) noexcept {
  if (name == "automatic") { out = ScaleMode::Automatic; return true; }
  if (name == "fixed") { out = ScaleMode::Fixed; return true; }
  return false;
}

namespace {

ScaleFit makeFit(const Scale& scale, double mw, double mh, const SheetSize& sheet) {
  ScaleFit f;
  f.scale = scale;
  f.modelWidthMm = mw;
  f.modelHeightMm = mh;
  f.drawableWidthMm = sheet.drawableWidthMm();
  f.drawableHeightMm = sheet.drawableHeightMm();
  f.paperWidthMm = mw * scale.factor();
  f.paperHeightMm = mh * scale.factor();
  f.fits = f.paperWidthMm <= f.drawableWidthMm && f.paperHeightMm <= f.drawableHeightMm;
  return f;
}

}  // namespace

ScaleFit fitScale(double modelWidthMm, double modelHeightMm, const SheetSize& sheet) {
  ScaleFit none;
  none.drawableWidthMm = sheet.drawableWidthMm();
  none.drawableHeightMm = sheet.drawableHeightMm();
  none.modelWidthMm = modelWidthMm;
  none.modelHeightMm = modelHeightMm;
  if (!std::isfinite(modelWidthMm) || !std::isfinite(modelHeightMm) || modelWidthMm <= 0.0 ||
      modelHeightMm <= 0.0) {
    none.reason = "There is no built part to measure yet, so no scale can be chosen.";
    return none;
  }
  for (const Scale& s : standardScales()) {
    ScaleFit f = makeFit(s, modelWidthMm, modelHeightMm, sheet);
    if (f.fits) {
      f.ok = true;
      return f;
    }
  }
  ScaleFit smallest = makeFit(standardScales().back(), modelWidthMm, modelHeightMm, sheet);
  smallest.ok = false;
  smallest.reason =
      "This part is too large for the chosen sheet even at the smallest standard scale. "
      "Choose a larger sheet.";
  return smallest;
}

ScaleFit applyScale(const Scale& scale, double modelWidthMm, double modelHeightMm,
                    const SheetSize& sheet) {
  ScaleFit f = makeFit(scale, modelWidthMm, modelHeightMm, sheet);
  f.modelWidthMm = modelWidthMm;
  f.modelHeightMm = modelHeightMm;
  if (!scale.valid()) {
    f.reason = "A scale needs a whole number on each side of the colon.";
    return f;
  }
  if (!std::isfinite(modelWidthMm) || !std::isfinite(modelHeightMm) || modelWidthMm <= 0.0 ||
      modelHeightMm <= 0.0) {
    f.reason = "There is no built part to measure yet, so the drawn size is not known.";
    return f;
  }
  f.ok = true;
  if (!f.fits) {
    f.reason = "At this scale the views are larger than the sheet will hold.";
  }
  return f;
}

// ── projection ──────────────────────────────────────────────────────────────
const char* toString(ProjectionAngle angle) noexcept {
  return angle == ProjectionAngle::First ? "first" : "third";
}

const char* projectionLabel(ProjectionAngle angle) noexcept {
  return angle == ProjectionAngle::First ? "First angle (ISO 128-30)"
                                         : "Third angle (ASME Y14.3)";
}

bool projectionAngleFromName(const std::string& name, ProjectionAngle& out) noexcept {
  if (name == "first") { out = ProjectionAngle::First; return true; }
  if (name == "third") { out = ProjectionAngle::Third; return true; }
  return false;
}

ViewAxes drawingViewAxes(NamedView view) noexcept {
  ViewAxes a;
  switch (view) {
    case NamedView::Front:
      a.normal[0] = 0.0; a.normal[1] = -1.0; a.normal[2] = 0.0;
      a.up[0] = 0.0; a.up[1] = 0.0; a.up[2] = 1.0;
      break;
    case NamedView::Back:
      a.normal[0] = 0.0; a.normal[1] = 1.0; a.normal[2] = 0.0;
      a.up[0] = 0.0; a.up[1] = 0.0; a.up[2] = 1.0;
      break;
    case NamedView::Right:
      a.normal[0] = 1.0; a.normal[1] = 0.0; a.normal[2] = 0.0;
      a.up[0] = 0.0; a.up[1] = 0.0; a.up[2] = 1.0;
      break;
    case NamedView::Left:
      a.normal[0] = -1.0; a.normal[1] = 0.0; a.normal[2] = 0.0;
      a.up[0] = 0.0; a.up[1] = 0.0; a.up[2] = 1.0;
      break;
    case NamedView::Top:
      a.normal[0] = 0.0; a.normal[1] = 0.0; a.normal[2] = 1.0;
      a.up[0] = 0.0; a.up[1] = 1.0; a.up[2] = 0.0;
      break;
    case NamedView::Bottom:
      a.normal[0] = 0.0; a.normal[1] = 0.0; a.normal[2] = -1.0;
      a.up[0] = 0.0; a.up[1] = -1.0; a.up[2] = 0.0;
      break;
    case NamedView::Isometric: {
      // True isometric: the eye sits where the three axes foreshorten equally,
      // which is the (1, -1, 1)/sqrt(3) direction for this Z-up, front-on--Y
      // convention. `up` is world +Z with its component along the view removed,
      // which is what keeps a vertical edge of the part vertical on the paper.
      const double s = 1.0 / std::sqrt(3.0);
      a.normal[0] = s; a.normal[1] = -s; a.normal[2] = s;
      double up[3] = {0.0, 0.0, 1.0};
      const double d = dot3(up, a.normal);
      up[0] -= d * a.normal[0];
      up[1] -= d * a.normal[1];
      up[2] -= d * a.normal[2];
      normalise(up);
      a.up[0] = up[0]; a.up[1] = up[1]; a.up[2] = up[2];
      break;
    }
  }
  normalise(a.normal);
  normalise(a.up);
  cross3(a.up, a.normal, a.right);
  normalise(a.right);
  return a;
}

ProjectedExtent projectExtent(const std::vector<Point3>& points, const ViewAxes& axes) {
  ExtentAccumulator acc;
  for (const Point3& p : points) {
    if (!finitePoint(p.x, p.y, p.z)) continue;
    const double v[3] = {p.x, p.y, p.z};
    acc.add(dot3(v, axes.right), dot3(v, axes.up), dot3(v, axes.normal));
  }
  return acc.finish(axes);
}

ProjectedExtent projectExtent(const MeasureMesh& mesh, const ViewAxes& axes) {
  ExtentAccumulator acc;
  const std::vector<double>& xyz = mesh.coords();
  for (std::size_t i = 0; i + 2 < xyz.size(); i += 3) {
    if (!finitePoint(xyz[i], xyz[i + 1], xyz[i + 2])) continue;
    const double v[3] = {xyz[i], xyz[i + 1], xyz[i + 2]};
    acc.add(dot3(v, axes.right), dot3(v, axes.up), dot3(v, axes.normal));
  }
  return acc.finish(axes);
}

std::vector<Point3> facePoints(const MeasureMesh& mesh, std::uint32_t faceId) {
  // The stream is de-indexed: one B-rep vertex arrives once per triangle that
  // touches it, so the raw soup would weight a corner by its valence and hand a
  // least-squares fit a biased point set. The weld is MeasureModel's own
  // quantum, spelled there once, so the two agree about what one vertex is.
  std::vector<Point3> out;
  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();
  const double q = kMeasureWeldTolerance;
  std::vector<std::array<long long, 3>> keys;
  for (std::size_t t = 0; t < ids.size(); ++t) {
    if (ids[t] != faceId) continue;
    const std::size_t base = t * 9;
    if (base + 8 >= xyz.size()) break;
    for (int corner = 0; corner < 3; ++corner) {
      const double x = xyz[base + static_cast<std::size_t>(corner) * 3 + 0];
      const double y = xyz[base + static_cast<std::size_t>(corner) * 3 + 1];
      const double z = xyz[base + static_cast<std::size_t>(corner) * 3 + 2];
      if (!finitePoint(x, y, z)) continue;
      const std::array<long long, 3> key = {
          static_cast<long long>(std::llround(x / q)),
          static_cast<long long>(std::llround(y / q)),
          static_cast<long long>(std::llround(z / q))};
      bool seen = false;
      for (const std::array<long long, 3>& k : keys) {
        if (k == key) { seen = true; break; }
      }
      if (seen) continue;
      keys.push_back(key);
      out.push_back(Point3{x, y, z});
    }
  }
  return out;
}

SheetCell sheetCell(NamedView view, ProjectionAngle angle) noexcept {
  // In THIRD angle a view is placed on the side of the front view you looked
  // from: you look down at the top, so the top view goes above. In FIRST angle
  // the object is projected THROUGH itself onto the far plane, so every view
  // lands on the opposite side. Getting this backwards mirrors the part, which
  // is why the projection symbol is on every real drawing.
  const int s = (angle == ProjectionAngle::Third) ? 1 : -1;
  SheetCell c;
  switch (view) {
    case NamedView::Front:  c.column = 0;      c.row = 0;  break;
    case NamedView::Top:    c.column = 0;      c.row = s;  break;
    case NamedView::Bottom: c.column = 0;      c.row = -s; break;
    case NamedView::Right:  c.column = s;      c.row = 0;  break;
    case NamedView::Left:   c.column = -s;     c.row = 0;  break;
    // One more quarter turn in the same direction as the right-hand view.
    case NamedView::Back:   c.column = 2 * s;  c.row = 0;  break;
    case NamedView::Isometric:
      c.column = 0;
      c.row = 0;
      c.placedByProjection = false;
      break;
  }
  return c;
}

std::vector<DrawingView> buildViewList(const MeasureMesh& mesh, const Scale& scale,
                                       ProjectionAngle angle, const SheetSize& sheet) {
  static const NamedView kOrder[kNamedViewCount] = {
      NamedView::Front, NamedView::Back,   NamedView::Left,     NamedView::Right,
      NamedView::Top,   NamedView::Bottom, NamedView::Isometric};
  std::vector<DrawingView> out;
  out.reserve(kNamedViewCount);
  const double dw = sheet.drawableWidthMm();
  const double dh = sheet.drawableHeightMm();
  for (NamedView v : kOrder) {
    DrawingView row;
    row.view = v;
    row.axes = drawingViewAxes(v);
    row.extent = projectExtent(mesh, row.axes);
    row.cell = sheetCell(v, angle);
    if (row.extent.ok && scale.valid()) {
      row.paperWidthMm = row.extent.widthMm * scale.factor();
      row.paperHeightMm = row.extent.heightMm * scale.factor();
      row.fitsSheet = row.paperWidthMm <= dw && row.paperHeightMm <= dh;
    }
    out.push_back(row);
  }
  return out;
}

bool projectionGroupSize(const MeasureMesh& mesh, ProjectionAngle angle, double& widthMm,
                         double& heightMm) {
  (void)angle;  // the GROUP's overall size is the same either way: first and
                // third angle mirror WHERE each view goes, not how big it is.
  const ProjectedExtent front = projectExtent(mesh, drawingViewAxes(NamedView::Front));
  const ProjectedExtent side = projectExtent(mesh, drawingViewAxes(NamedView::Right));
  const ProjectedExtent top = projectExtent(mesh, drawingViewAxes(NamedView::Top));
  if (!front.ok || !side.ok || !top.ok) return false;
  // Front + one side across, front + top down. No gutter between the views and
  // no space reserved for the title block: the figure is the sum of the views,
  // and the panel says so beside it.
  widthMm = front.widthMm + side.widthMm;
  heightMm = front.heightMm + top.heightMm;
  return widthMm > 0.0 && heightMm > 0.0;
}

// ── title block ─────────────────────────────────────────────────────────────
const char* toString(FieldSource source) noexcept {
  switch (source) {
    case FieldSource::Unset: return "unset";
    case FieldSource::Document: return "document";
    case FieldSource::Model: return "model";
    case FieldSource::File: return "file";
  }
  return "unset";
}

bool TitleBlockData::operator==(const TitleBlockData& o) const {
  return partNumber == o.partNumber && title == o.title && revision == o.revision &&
         author == o.author && approvedBy == o.approvedBy && company == o.company &&
         material == o.material && finish == o.finish && sheetId == o.sheetId &&
         projection == o.projection && scaleMode == o.scaleMode && fixedScale == o.fixedScale;
}

namespace {

TitleBlockField typed(const char* key, const char* label, std::string value, FieldSource src,
                      const char* origin) {
  TitleBlockField f;
  f.key = key;
  f.label = label;
  f.value = std::move(value);
  f.source = src;
  f.origin = origin;
  if (f.value.empty()) {
    f.source = FieldSource::Unset;
    f.origin = "not filled in yet";
  }
  return f;
}

}  // namespace

std::string* titleBlockFieldByKey(TitleBlockData& data, const std::string& key) {
  if (key == "part_number") return &data.partNumber;
  if (key == "title") return &data.title;
  if (key == "revision") return &data.revision;
  if (key == "author") return &data.author;
  if (key == "approved_by") return &data.approvedBy;
  if (key == "company") return &data.company;
  if (key == "material") return &data.material;
  if (key == "finish") return &data.finish;
  return nullptr;
}

std::vector<TitleBlockField> titleBlockRows(const TitleBlockData& data,
                                            const TitleBlockContext& context) {
  std::vector<TitleBlockField> rows;
  // `editable` is DERIVED from the one table above, so a row a user can type
  // into and a row the file stores are the same set by construction.
  const auto markEditable = [](std::vector<TitleBlockField>& all) {
    TitleBlockData probe;
    for (TitleBlockField& f : all) f.editable = titleBlockFieldByKey(probe, f.key) != nullptr;
  };

  // The part number falls back to the DOCUMENT'S OWN NAME, which is the name of
  // the file it lives in -- a real value with a real source, not a guess.
  if (!data.partNumber.empty()) {
    rows.push_back(typed("part_number", "Part number", data.partNumber, FieldSource::Document, "you typed it"));
  } else if (!context.documentName.empty()) {
    rows.push_back(
        typed("part_number", "Part number", context.documentName, FieldSource::File,
                    "the name of this document"));
  } else {
    rows.push_back(typed("part_number", "Part number", std::string(), FieldSource::Unset, ""));
  }

  rows.push_back(typed("title", "Title", data.title, FieldSource::Document, "you typed it"));
  rows.push_back(typed("revision", "Revision", data.revision, FieldSource::Document, "you typed it"));
  rows.push_back(typed("author", "Drawn by", data.author, FieldSource::Document, "you typed it"));
  rows.push_back(typed("approved_by", "Approved by", data.approvedBy, FieldSource::Document, "you typed it"));
  rows.push_back(typed("company", "Company", data.company, FieldSource::Document, "you typed it"));
  rows.push_back(typed("material", "Material", data.material, FieldSource::Document, "you typed it"));
  rows.push_back(typed("finish", "Finish", data.finish, FieldSource::Document, "you typed it"));

  // ── the three rows that are NEVER typed ───────────────────────────────────
  // Date, units and scale are read off the file, off the document and off the
  // model that is built right now. A user cannot edit them, because a title
  // block whose scale can be typed independently of the drawing is the exact
  // defect this module exists to prevent.
  rows.push_back(typed("date", "Date", context.savedOn, FieldSource::File,
                       "when this document was last saved"));

  rows.push_back(typed("units", "Units", context.units, FieldSource::Document,
                       "the unit every length in this document is stored in"));

  if (context.sheet != nullptr) {
    rows.push_back(typed("sheet", "Sheet", context.sheet->label, FieldSource::Document,
                         "the sheet size you chose"));
    char area[96];
    std::snprintf(area, sizeof(area), "%.0f x %.0f mm inside the frame",
                  context.sheet->drawableWidthMm(), context.sheet->drawableHeightMm());
    rows.push_back(typed("drawing_area", "Drawing area", area, FieldSource::Document,
                         "the sheet less its border and filing margin"));
  } else {
    rows.push_back(typed("sheet", "Sheet", std::string(), FieldSource::Unset, ""));
  }

  rows.push_back(typed("projection", "Projection", projectionLabel(data.projection), FieldSource::Document,
                       "the projection this drawing is laid out in"));

  if (!context.modelBuilt) {
    rows.push_back(typed("scale", "Scale", std::string(), FieldSource::Unset, ""));
    rows.push_back(typed("part_size", "Part size", std::string(), FieldSource::Unset, ""));
    rows.push_back(typed("features", "Features", std::to_string(context.featureCount),
                         FieldSource::Document, "statements in this part"));
    markEditable(rows);
    return rows;
  }

  if (context.scale.ok) {
    std::string note = context.scale.scale.text();
    if (data.scaleMode == ScaleMode::Automatic) {
      note += "  (largest standard scale that fits this sheet)";
    } else {
      note += "  (you pinned this scale)";
    }
    if (!context.scale.fits) note += "  -- larger than the sheet";
    rows.push_back(typed("scale", "Scale", note, FieldSource::Model, "measured from the built part"));
    char drawn[96];
    std::snprintf(drawn, sizeof(drawn), "%.1f x %.1f mm on the paper", context.scale.paperWidthMm,
                  context.scale.paperHeightMm);
    rows.push_back(typed("drawn_size", "Drawn size", drawn, FieldSource::Model,
                         "the views at this scale"));
  } else {
    rows.push_back(typed("scale", "Scale", std::string(), FieldSource::Unset, ""));
  }

  char size[128];
  std::snprintf(size, sizeof(size), "%.2f x %.2f x %.2f mm", context.extentXmm, context.extentYmm,
                context.extentZmm);
  rows.push_back(typed("part_size", "Part size", size, FieldSource::Model, "measured from the built part"));
  rows.push_back(typed("features", "Features", std::to_string(context.featureCount),
                       FieldSource::Document, "statements in this part"));
  markEditable(rows);
  return rows;
}

// ── annotations ─────────────────────────────────────────────────────────────
const char* toString(AnnotationKind kind) noexcept {
  switch (kind) {
    case AnnotationKind::Note: return "note";
    case AnnotationKind::Leader: return "leader";
    case AnnotationKind::Balloon: return "balloon";
    case AnnotationKind::Datum: return "datum";
  }
  return "note";
}

const char* annotationLabel(AnnotationKind kind) noexcept {
  switch (kind) {
    case AnnotationKind::Note: return "Note";
    case AnnotationKind::Leader: return "Leader note";
    case AnnotationKind::Balloon: return "Balloon";
    case AnnotationKind::Datum: return "Datum symbol";
  }
  return "Note";
}

const std::vector<AnnotationKind>& allAnnotationKinds() {
  static const std::vector<AnnotationKind> kAll = {AnnotationKind::Note, AnnotationKind::Leader,
                                                   AnnotationKind::Balloon, AnnotationKind::Datum};
  return kAll;
}

bool annotationKindFromName(const std::string& name, AnnotationKind& out) noexcept {
  for (AnnotationKind k : allAnnotationKinds()) {
    if (name == toString(k)) { out = k; return true; }
  }
  return false;
}

// ── geometric tolerances ────────────────────────────────────────────────────
const char* toString(GdtCharacteristic c) noexcept {
  switch (c) {
    case GdtCharacteristic::Flatness: return "flatness";
    case GdtCharacteristic::Straightness: return "straightness";
    case GdtCharacteristic::Circularity: return "circularity";
    case GdtCharacteristic::Cylindricity: return "cylindricity";
    case GdtCharacteristic::Position: return "position";
    case GdtCharacteristic::Perpendicularity: return "perpendicularity";
    case GdtCharacteristic::Parallelism: return "parallelism";
    case GdtCharacteristic::Angularity: return "angularity";
    case GdtCharacteristic::ProfileOfASurface: return "profile_of_a_surface";
  }
  return "flatness";
}

const char* gdtLabel(GdtCharacteristic c) noexcept {
  switch (c) {
    case GdtCharacteristic::Flatness: return "Flatness";
    case GdtCharacteristic::Straightness: return "Straightness";
    case GdtCharacteristic::Circularity: return "Circularity";
    case GdtCharacteristic::Cylindricity: return "Cylindricity";
    case GdtCharacteristic::Position: return "Position";
    case GdtCharacteristic::Perpendicularity: return "Perpendicularity";
    case GdtCharacteristic::Parallelism: return "Parallelism";
    case GdtCharacteristic::Angularity: return "Angularity";
    case GdtCharacteristic::ProfileOfASurface: return "Profile of a surface";
  }
  return "Flatness";
}

const std::vector<GdtCharacteristic>& allGdtCharacteristics() {
  static const std::vector<GdtCharacteristic> kAll = {
      GdtCharacteristic::Flatness,        GdtCharacteristic::Straightness,
      GdtCharacteristic::Circularity,     GdtCharacteristic::Cylindricity,
      GdtCharacteristic::Position,        GdtCharacteristic::Perpendicularity,
      GdtCharacteristic::Parallelism,     GdtCharacteristic::Angularity,
      GdtCharacteristic::ProfileOfASurface};
  return kAll;
}

bool gdtCharacteristicFromName(const std::string& name, GdtCharacteristic& out) noexcept {
  for (GdtCharacteristic c : allGdtCharacteristics()) {
    if (name == toString(c)) { out = c; return true; }
  }
  return false;
}

bool isFormControl(GdtCharacteristic c) noexcept {
  return c == GdtCharacteristic::Flatness || c == GdtCharacteristic::Straightness ||
         c == GdtCharacteristic::Circularity || c == GdtCharacteristic::Cylindricity;
}

const char* toString(MaterialModifier m) noexcept {
  switch (m) {
    case MaterialModifier::RegardlessOfFeatureSize: return "rfs";
    case MaterialModifier::MaximumMaterial: return "mmc";
    case MaterialModifier::LeastMaterial: return "lmc";
  }
  return "rfs";
}

const char* materialModifierLabel(MaterialModifier m) noexcept {
  switch (m) {
    case MaterialModifier::RegardlessOfFeatureSize: return "regardless of feature size";
    case MaterialModifier::MaximumMaterial: return "at maximum material";
    case MaterialModifier::LeastMaterial: return "at least material";
  }
  return "regardless of feature size";
}

const std::vector<MaterialModifier>& allMaterialModifiers() {
  static const std::vector<MaterialModifier> kAll = {MaterialModifier::RegardlessOfFeatureSize,
                                                     MaterialModifier::MaximumMaterial,
                                                     MaterialModifier::LeastMaterial};
  return kAll;
}

bool materialModifierFromName(const std::string& name, MaterialModifier& out) noexcept {
  for (MaterialModifier m : allMaterialModifiers()) {
    if (name == toString(m)) { out = m; return true; }
  }
  return false;
}

const char* toString(ControlledFeatureKind k) noexcept {
  switch (k) {
    case ControlledFeatureKind::PlanarSurface: return "planar_surface";
    case ControlledFeatureKind::CylinderAxis: return "cylinder_axis";
    case ControlledFeatureKind::CylinderSurface: return "cylinder_surface";
    case ControlledFeatureKind::FeatureOfSize: return "feature_of_size";
    case ControlledFeatureKind::LineElement: return "line_element";
  }
  return "planar_surface";
}

const char* controlledFeatureLabel(ControlledFeatureKind k) noexcept {
  switch (k) {
    case ControlledFeatureKind::PlanarSurface: return "a flat face";
    case ControlledFeatureKind::CylinderAxis: return "the axis of a round feature";
    case ControlledFeatureKind::CylinderSurface: return "a round surface";
    case ControlledFeatureKind::FeatureOfSize: return "a hole or a boss";
    case ControlledFeatureKind::LineElement: return "one line across a face";
  }
  return "a flat face";
}

double basicAngleOf(const FeatureControlFrame& fcf) noexcept {
  switch (fcf.characteristic) {
    case GdtCharacteristic::Parallelism: return 0.0;
    case GdtCharacteristic::Perpendicularity: return 90.0;
    case GdtCharacteristic::Angularity: return fcf.basicAngleDeg;
    default: return 0.0;
  }
}

const std::vector<ControlledFeatureKind>& allControlledFeatureKinds() {
  static const std::vector<ControlledFeatureKind> kAll = {
      ControlledFeatureKind::PlanarSurface,   ControlledFeatureKind::CylinderAxis,
      ControlledFeatureKind::CylinderSurface, ControlledFeatureKind::FeatureOfSize,
      ControlledFeatureKind::LineElement};
  return kAll;
}

bool controlledFeatureKindFromName(const std::string& name, ControlledFeatureKind& out) noexcept {
  for (ControlledFeatureKind k : allControlledFeatureKinds()) {
    if (name == toString(k)) { out = k; return true; }
  }
  return false;
}

std::string describeFcf(const FeatureControlFrame& fcf) {
  std::string out = gdtLabel(fcf.characteristic);
  out += ' ';
  if (fcf.diametralZone) out += "dia ";
  char tol[32];
  std::snprintf(tol, sizeof(tol), "%.4g", fcf.toleranceMm);
  out += tol;
  out += " mm";
  if (fcf.characteristic == GdtCharacteristic::Angularity) {
    char ang[32];
    std::snprintf(ang, sizeof(ang), " at %.4g deg", fcf.basicAngleDeg);
    out += ang;
  }
  if (fcf.modifier != MaterialModifier::RegardlessOfFeatureSize) {
    out += ' ';
    out += materialModifierLabel(fcf.modifier);
  }
  if (!fcf.datumRefs.empty()) {
    out += " to ";
    for (std::size_t i = 0; i < fcf.datumRefs.size(); ++i) {
      if (i != 0) out += ' ';
      out.push_back(fcf.datumRefs[i]);
    }
  }
  return out;
}

// ── the drawing ─────────────────────────────────────────────────────────────
namespace {

bool legalDatumLetter(char c) noexcept {
  // Y14.5 excludes I, O and Q, which read as one, zero and a smudge on a print.
  if (c < 'A' || c > 'Z') return false;
  return c != 'I' && c != 'O' && c != 'Q';
}

}  // namespace

bool DrawingModel::addAnnotation(Annotation note, std::string& reason) {
  reason.clear();
  std::string trimmed;
  for (char c : note.text) {
    if (c == '\n' || c == '\r' || c == '\t') c = ' ';
    trimmed.push_back(c);
  }
  while (!trimmed.empty() && trimmed.back() == ' ') trimmed.pop_back();
  std::size_t begin = 0;
  while (begin < trimmed.size() && trimmed[begin] == ' ') ++begin;
  trimmed = trimmed.substr(begin);
  if (trimmed.empty()) {
    reason = "A note needs some text.";
    return false;
  }
  note.text = trimmed;
  if (note.id.empty()) note.id = nextAnnotationId();
  for (const Annotation& a : notes_) {
    if (a.id == note.id) {
      reason = "There is already a note with that number.";
      return false;
    }
  }
  notes_.push_back(std::move(note));
  return true;
}

bool DrawingModel::removeAnnotation(const std::string& id) {
  for (std::size_t i = 0; i < notes_.size(); ++i) {
    if (notes_[i].id == id) {
      notes_.erase(notes_.begin() + static_cast<std::ptrdiff_t>(i));
      return true;
    }
  }
  return false;
}

bool DrawingModel::addFrame(FeatureControlFrame frame, std::string& reason) {
  reason.clear();
  if (!(frame.toleranceMm > 0.0) || !std::isfinite(frame.toleranceMm)) {
    reason = "A tolerance has to be a positive size. A zone of zero width allows nothing.";
    return false;
  }
  if (frame.datumRefs.size() > 3) {
    reason = "A control can reference at most three datums: a primary, a secondary and a tertiary.";
    return false;
  }
  for (std::size_t i = 0; i < frame.datumRefs.size(); ++i) {
    if (!legalDatumLetter(frame.datumRefs[i])) {
      reason = "Datum letters run A to Z, leaving out I, O and Q.";
      return false;
    }
    for (std::size_t j = i + 1; j < frame.datumRefs.size(); ++j) {
      if (frame.datumRefs[i] == frame.datumRefs[j]) {
        reason = "A control cannot reference the same datum twice.";
        return false;
      }
    }
    if (datum(frame.datumRefs[i]) == nullptr) {
      reason = std::string("There is no datum ") + frame.datumRefs[i] +
               " on this part yet. Pick a face and add it as a datum first.";
      return false;
    }
  }
  if (frame.characteristic == GdtCharacteristic::Angularity) {
    if (!std::isfinite(frame.basicAngleDeg) || frame.basicAngleDeg <= 0.0 ||
        frame.basicAngleDeg >= 90.0) {
      reason =
          "An angularity control is measured at a basic angle between 0 and 90 degrees. "
          "Use parallelism for 0 and perpendicularity for 90.";
      return false;
    }
  }
  if (isFormControl(frame.characteristic) && !frame.datumRefs.empty()) {
    reason = std::string(gdtLabel(frame.characteristic)) +
             " is a form control: it is measured on the feature itself and takes no datum.";
    return false;
  }
  if (!isFormControl(frame.characteristic) && frame.datumRefs.empty()) {
    reason = std::string(gdtLabel(frame.characteristic)) +
             " has to be measured from at least one datum.";
    return false;
  }
  if (frame.id.empty()) frame.id = nextFrameId();
  for (const FeatureControlFrame& f : frames_) {
    if (f.id == frame.id) {
      reason = "There is already a control with that number.";
      return false;
    }
  }
  frames_.push_back(std::move(frame));
  return true;
}

bool DrawingModel::removeFrame(const std::string& id) {
  for (std::size_t i = 0; i < frames_.size(); ++i) {
    if (frames_[i].id == id) {
      frames_.erase(frames_.begin() + static_cast<std::ptrdiff_t>(i));
      return true;
    }
  }
  return false;
}

bool DrawingModel::addDatum(DatumFeature d, std::string& reason) {
  reason.clear();
  if (!legalDatumLetter(d.letter)) {
    reason = "Datum letters run A to Z, leaving out I, O and Q.";
    return false;
  }
  if (datum(d.letter) != nullptr) {
    reason = std::string("Datum ") + d.letter + " is already on another face.";
    return false;
  }
  if (!d.target.valid()) {
    reason = "A datum has to name a real face. Pick one in the 3D view first.";
    return false;
  }
  datums_.push_back(std::move(d));
  std::sort(datums_.begin(), datums_.end(),
            [](const DatumFeature& a, const DatumFeature& b) { return a.letter < b.letter; });
  return true;
}

bool DrawingModel::removeDatum(char letter) {
  for (std::size_t i = 0; i < datums_.size(); ++i) {
    if (datums_[i].letter == letter) {
      // A control that references this datum would become unmeasurable, so the
      // controls that name it go with it rather than being left dangling.
      std::vector<FeatureControlFrame> kept;
      for (FeatureControlFrame& f : frames_) {
        bool refs = false;
        for (char c : f.datumRefs) {
          if (c == letter) refs = true;
        }
        if (!refs) kept.push_back(std::move(f));
      }
      frames_ = std::move(kept);
      datums_.erase(datums_.begin() + static_cast<std::ptrdiff_t>(i));
      return true;
    }
  }
  return false;
}

const DatumFeature* DrawingModel::datum(char letter) const {
  for (const DatumFeature& d : datums_) {
    if (d.letter == letter) return &d;
  }
  return nullptr;
}

std::vector<char> DrawingModel::datumLetters() const {
  std::vector<char> out;
  out.reserve(datums_.size());
  for (const DatumFeature& d : datums_) out.push_back(d.letter);
  std::sort(out.begin(), out.end());
  return out;
}

void DrawingModel::restore(TitleBlockData title, std::vector<DatumFeature> datums,
                           std::vector<Annotation> notes,
                           std::vector<FeatureControlFrame> frames) {
  title_ = std::move(title);
  datums_ = std::move(datums);
  std::sort(datums_.begin(), datums_.end(),
            [](const DatumFeature& a, const DatumFeature& b) { return a.letter < b.letter; });
  notes_ = std::move(notes);
  frames_ = std::move(frames);
}

void DrawingModel::clear() {
  title_ = TitleBlockData{};
  notes_.clear();
  frames_.clear();
  datums_.clear();
}

bool DrawingModel::empty() const noexcept {
  return notes_.empty() && frames_.empty() && datums_.empty() && title_ == TitleBlockData{};
}

namespace {

std::string freshId(const char* prefix, std::size_t used,
                    const std::vector<std::string>& taken) {
  for (std::size_t n = used + 1; n < used + 4096; ++n) {
    std::string candidate = std::string(prefix) + std::to_string(n);
    bool clash = false;
    for (const std::string& t : taken) {
      if (t == candidate) clash = true;
    }
    if (!clash) return candidate;
  }
  return std::string(prefix) + std::to_string(used + 1);
}

}  // namespace

std::string DrawingModel::nextAnnotationId() const {
  std::vector<std::string> taken;
  taken.reserve(notes_.size());
  for (const Annotation& a : notes_) taken.push_back(a.id);
  return freshId("note", notes_.size(), taken);
}

std::string DrawingModel::nextFrameId() const {
  std::vector<std::string> taken;
  taken.reserve(frames_.size());
  for (const FeatureControlFrame& f : frames_) taken.push_back(f.id);
  return freshId("control", frames_.size(), taken);
}

}  // namespace forge::ui
