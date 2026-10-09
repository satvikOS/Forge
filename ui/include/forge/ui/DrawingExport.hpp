// ui/include/forge/ui/DrawingExport.hpp
//
// THE DRAWING EGRESS — getting a 2-D engineering drawing of the part OUT of
// Forge as a file a shop, a checker or a customer can open.
//
// ── the gap this closes, MEASURED on origin/archdisc b609b41d ──────────────
// The Drawing workspace is real: it chooses a sheet (ISO 216 / ASME Y14.1), the
// largest ISO 5455 scale that fits, lays the views out by first- or third-angle
// projection, keeps a title block, notes, datums and geometric tolerances, and
// saves all of it in the .fpart. And then nothing could leave:
//
//   grep -rn 'svg\|SVG\|dxf\|DXF\|pdf\|PDF' ui/src/Drawing.cpp ui/include/forge/ui/Drawing.hpp \
//       forge-desktop/src/ForgeFrame.cpp                     -> no hits
//   ForgeFrame.cpp:120  isViewportPanel(): id == "sheet_canvas"  -> the Sheet tab
//                       draws the 3-D viewport texture, not a sheet
//
// so the directive's canonical fixture step "produce a drawing" had no artifact
// at all, while the kernel has carried a validated native hidden-line remover
// (forge::native::brep::hiddenLineRemoval, A/B'd against OCCT HLRBRep) since
// TKHLR was dropped.
//
// ── what is in this file and what is not ────────────────────────────────────
// forge::ui owns the SHEET: where each view goes, the frame, the title block,
// the notes, and the two text formats. It includes no kernel header. What it is
// handed is the VIEW GEOMETRY — visible and hidden polylines per view, in that
// view's own (right, up) frame in model millimetres — by a DrawingSource, the
// same separately-installed seam pattern MachineProgram.hpp uses and for the
// same reason: a headless forge::ui build has no kernel, and says so by leaving
// `file.export_drawing` DISABLED rather than by failing when it is pressed.
//
// The view axes are drawingViewAxes() and the placement is sheetCell(), the SAME
// two functions the View List panel prints from, so the file and the panel
// cannot disagree about where a view goes or which way is up on it.
//
// ── THE PROSE RULE ──────────────────────────────────────────────────────────
// Every sentence a user reads is written in drawingExportMessage() /
// drawingExportSuccessMessage(), and forge::ui::isUserReadable is applied to all
// of them by the gate, as it is to the exchange and machine-program sentences.
#ifndef FORGE_UI_DRAWINGEXPORT_HPP
#define FORGE_UI_DRAWINGEXPORT_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <iterator>
#include <string>
#include <vector>

#include "forge/ui/Drawing.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

// ── formats ─────────────────────────────────────────────────────────────────
// SVG for reading and printing; DXF (AutoCAD R12 ASCII, LINE and TEXT entities
// only) for every CAD and CAM program that imports a 2-D drawing. The format is
// chosen by the file's extension, because that is the one statement of intent
// a Save panel and a macro both make.
enum class DrawingFileFormat : std::uint8_t { Svg = 0, Dxf };
const char* toString(DrawingFileFormat format) noexcept;  // "svg" / "dxf"
// Canonical FIRST (".svg" is what a Save panel appends to a bare name). One
// owner, for the reason FileDialog.hpp gives about extensions.
const std::vector<std::string>& drawingExtensions();
// Reads the format off the path's extension, case-insensitively. False for any
// other extension, leaving `out` untouched.
bool drawingFormatFromPath(const std::string& path, DrawingFileFormat& out) noexcept;

// ── why a drawing was not written ───────────────────────────────────────────
// A CLOSED set: every value has a sentence and the gate walks the list.
enum class DrawingExportRefusal : std::uint8_t {
  None = 0,
  NoPath,         // invoked with an empty path
  NoSource,       // no drawing source is installed in this build
  NoDrawing,      // nothing is built, no sheet is chosen, or the views could not be made
  UnknownFormat,  // the file name does not end in .svg or .dxf
  WriteFailed,    // Forge could not put the bytes on disk
  // The two write-target refusals every Copy command carries (T-123, T-127).
  TargetIsDocument,
  TargetIsBound,
};

inline constexpr DrawingExportRefusal kAllDrawingExportRefusals[] = {
    DrawingExportRefusal::None,          DrawingExportRefusal::NoPath,
    DrawingExportRefusal::NoSource,      DrawingExportRefusal::NoDrawing,
    DrawingExportRefusal::UnknownFormat, DrawingExportRefusal::WriteFailed,
    DrawingExportRefusal::TargetIsDocument, DrawingExportRefusal::TargetIsBound,
};
static_assert(std::size(kAllDrawingExportRefusals) ==
                  static_cast<std::size_t>(DrawingExportRefusal::TargetIsBound) + 1,
              "kAllDrawingExportRefusals must list EVERY DrawingExportRefusal: the prose "
              "gate walks it, and a value missing from it is a sentence nobody checked.");

// The stable machine spelling, for a log's detail field. Never shown to a user.
const char* toString(DrawingExportRefusal refusal) noexcept;

// ── what the source hands over ──────────────────────────────────────────────
// One polyline of a view, in that view's own frame: x along ViewAxes::right and
// y along ViewAxes::up, in MODEL millimetres (unscaled). At least two points.
struct DrawingPolyline {
  std::vector<std::array<double, 2>> points;
};

// The lines of one orthographic view.
struct DrawingViewLines {
  NamedView view = NamedView::Front;
  std::vector<DrawingPolyline> visible;  // drawn continuous
  std::vector<DrawingPolyline> hidden;   // drawn dashed
  // The view's extent in model mm in the same frame, as the View List measured
  // it. The cell a view occupies is sized from THIS, so a view whose lines fall
  // outside it is visible in the file as exactly that.
  double minRight = 0.0, maxRight = 0.0;
  double minUp = 0.0, maxUp = 0.0;
};

// Everything one sheet needs. Views are expected in the order Front, Top, Right
// -- the projection group projectionGroupSize() sizes the scale for -- and are
// placed by sheetCell(view, projection).
//
// NOT `DrawingSheet`: forge/ui/WorkspaceTrees.hpp already owns that name for the
// Sheet tree's one-row summary of a sheet (its size and scale label), which is a
// different thing from the ink that goes on it. Two types with one name in one
// namespace is an ODR violation the linker does not report.
struct DrawingSheetContent {
  SheetSize sheet{};
  Scale scale{1, 1};
  ProjectionAngle projection = ProjectionAngle::First;
  std::vector<DrawingViewLines> views;
  // The title block as the Title Block panel shows it: label and value per row.
  std::vector<TitleBlockField> titleBlock;
  // Notes and geometric tolerances, one line each, in the user's words.
  std::vector<std::string> notes;
  // Set when there is NO drawing, and only then: the source's own sentence for
  // why. Checked against isUserReadable before it is shown.
  std::string advice;
};

// ── the layout, exposed so a gate can check the file against it ─────────────
// Paper coordinates are millimetres from the sheet's BOTTOM-LEFT corner, y up.
// The SVG writer flips y once, at the end; nothing else does.
struct PlacedView {
  NamedView view = NamedView::Front;
  SheetCell cell{};
  // Paper position of the view's model origin: paper = origin + model * factor.
  double originX = 0.0, originY = 0.0;
  // The cell rectangle on paper (the view's extent at scale).
  double cellMinX = 0.0, cellMinY = 0.0, cellMaxX = 0.0, cellMaxY = 0.0;
  std::size_t visiblePolylines = 0;
  std::size_t hiddenPolylines = 0;
  double visibleLengthMm = 0.0;  // ON PAPER
  double hiddenLengthMm = 0.0;   // ON PAPER
};

struct DrawingLayoutResult {
  bool ok = false;
  std::string reason;  // a user sentence when !ok
  double factor = 1.0;
  // Frame (border) rectangle and title-block rectangle, on paper.
  double frameMinX = 0.0, frameMinY = 0.0, frameMaxX = 0.0, frameMaxY = 0.0;
  double titleMinX = 0.0, titleMinY = 0.0, titleMaxX = 0.0, titleMaxY = 0.0;
  std::vector<PlacedView> views;
  // True when the projection group, at this scale, cannot be placed without
  // touching the title block or leaving the frame. The drawing is still written
  // -- a fixed scale that overruns is a real choice -- and the success sentence
  // says so.
  bool crowded = false;
};

// Pure: the same sheet always lays out the same way.
DrawingLayoutResult layoutDrawing(const DrawingSheetContent& sheet);

// Pure writers. Deterministic: fixed precision, fixed element order, no clock.
std::string writeDrawingSvg(const DrawingSheetContent& sheet, const DrawingLayoutResult& layout);
std::string writeDrawingDxf(const DrawingSheetContent& sheet, const DrawingLayoutResult& layout);

// What an export did. `message` is ALWAYS set and ALWAYS user-readable.
struct DrawingExportReport {
  bool ok = false;
  DrawingExportRefusal refusal = DrawingExportRefusal::None;
  DrawingFileFormat format = DrawingFileFormat::Svg;
  std::string message;
  std::string sheetLabel;  // "A3  420 x 297 mm"
  std::string scaleText;   // "1:2"
  std::size_t views = 0;
  std::size_t visiblePolylines = 0;
  std::size_t hiddenPolylines = 0;
  bool crowded = false;
  // How many bytes were handed to the write, -1 when nothing was written. NOT
  // re-read from the file, so a gate comparing it with the disk compares two
  // independent things.
  long long bytes = -1;
};

// ── the ONE place a sentence the user reads is written ──────────────────────
std::string drawingExportMessage(DrawingExportRefusal refusal, const std::string& path);
std::string drawingExportSuccessMessage(const DrawingExportReport& report,
                                        const std::string& path);

// ── the seam ────────────────────────────────────────────────────────────────
// PURE, for the reason MachineProgramSource gives: a default that answered "here
// is an empty drawing" would let a build ship a File menu that writes a blank
// sheet.
class DrawingSource {
 public:
  virtual ~DrawingSource() = default;

  // Is there a drawing to write at all? CHEAP BY CONTRACT: this is the command's
  // `enabled` predicate, evaluated for every command on every frame. It must
  // report what is already known and compute nothing -- no compile, no HLR.
  virtual bool hasDrawing() = 0;

  // The sheet itself, brought up to date with the document AS IT IS NOW: the
  // views are projected from the current feature history, never from a cached
  // body, so "the drawing I saved is not the part on screen" cannot happen.
  // Returns false and fills `out.advice` when there is none.
  virtual bool drawingSheet(DrawingSheetContent& out) = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_DRAWINGEXPORT_HPP
