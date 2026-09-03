// ui/include/forge/ui/Drawing.hpp
//
// THE DRAWING — the 2-D documentation half of a part, as a model rather than as
// a picture.
//
// ── what was here before, and why it was not a drawing ──────────────────────
// Four tabs of the Drawing workspace -- Title Block, View List, GD&T and
// Annotations -- fell through to the generic fallback panel. There was no sheet,
// no scale, no view, no note and no tolerance anywhere in the application: the
// panels were empty because the DATA did not exist, and no amount of rewording
// the empty panel was going to change that. This file is the data.
//
// ── the rule every value in here obeys ──────────────────────────────────────
// A drawing that lies about its scale is a manufacturing defect: a machinist who
// measures a printed feature and multiplies by the wrong ratio cuts the wrong
// part. So NOTHING in this module invents a number.
//
//   * The SHEET sizes are ISO 216 (A4..A0) and ASME Y14.1 (A..E, defined in
//     inches and converted at the exact 25.4 mm inch). They are published
//     constants, spelled once.
//   * The BORDERS are ISO 5457 (10 mm for A4..A2, 20 mm for A1/A0, plus the
//     20 mm filing margin on the binding edge) and ASME Y14.1's 0.5 in margin.
//   * The SCALE LADDER is ISO 5455's recommended series. `fitScale` picks the
//     largest RUNG at which the real projected size of the real model fits the
//     real drawable area -- it never manufactures a ratio, and when nothing on
//     the ladder fits it says so instead of returning the smallest one.
//   * The VIEW EXTENTS are computed by projecting the model's OWN vertices.
//     Not the bounding box: the projection of a box that contains the part is
//     larger than the projection of the part for every direction that is not
//     axis-aligned, and an isometric view sized from a box is simply a wrong
//     number.
//   * Every TITLE BLOCK row carries its PROVENANCE (`FieldSource`). A row the
//     document has no value for reads as unset and stays empty. A blank a user
//     must fill is honest; a plausible default in a title block is a drawing
//     that has been signed by nobody.
//
// ── what this file deliberately does NOT do ─────────────────────────────────
// It does not evaluate geometric tolerances. The FCF record lives here because a
// drawing owns its callouts, but MEASURING one needs the geometry, and the
// geometry lives behind the kernel seam (forge-desktop/src/DrawingGdt.hpp). This
// module is pure arithmetic over values a caller hands it, so every number it
// produces can be asserted headlessly -- which is what ui/test/drawing_test.cpp
// does.
#ifndef FORGE_UI_DRAWING_HPP
#define FORGE_UI_DRAWING_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

// ── a point, in millimetres ─────────────────────────────────────────────────
// The kernel works in millimetres and this module never converts: see
// forge/ui/Units.hpp, which states that rule for the whole application.
struct Point3 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

// ═══ SHEETS ═════════════════════════════════════════════════════════════════
//
// Landscape, which is how a mechanical sheet is drawn: width is the long edge.
// `border` and `filing` are the ISO 5457 frame -- the filing margin is the wider
// left-hand edge a drawing is punched and bound on -- so `drawable*()` is the
// area a view may actually occupy, not the paper.
struct SheetSize {
  std::string id;      // "A3", "ANSI-B"
  std::string label;   // "A3  420 x 297 mm"
  std::string family;  // "ISO 216" / "ASME Y14.1"
  double widthMm = 0.0;
  double heightMm = 0.0;
  double borderMm = 0.0;   // frame inset on the top, bottom and right edges
  double filingMm = 0.0;   // frame inset on the binding edge (the left)

  double drawableWidthMm() const noexcept;
  double drawableHeightMm() const noexcept;
};

// Every sheet this application knows, ISO first then ASME, largest last within
// each family. Deterministic order: a menu built from it is stable.
const std::vector<SheetSize>& sheetSizes();
// nullptr for an unknown id -- a document written by another build can name a
// sheet this one does not have, and inventing one would put a wrong paper size
// under a real scale.
const SheetSize* findSheetSize(const std::string& id);

// ═══ SCALE ══════════════════════════════════════════════════════════════════
struct Scale {
  int drawing = 1;  // the numerator: how many millimetres on the paper
  int model = 1;    // the denominator: per millimetre of the part

  double factor() const noexcept;   // drawing / model
  std::string text() const;         // "1:1", "1:2", "5:1"
  bool valid() const noexcept { return drawing > 0 && model > 0; }
};

bool operator==(const Scale& a, const Scale& b) noexcept;
bool operator!=(const Scale& a, const Scale& b) noexcept;

// ISO 5455's recommended series, ordered LARGEST FIRST (10:1 ... 1:10000), so
// "the first rung that fits" is "the largest scale that fits".
const std::vector<Scale>& standardScales();
// Reads "1:2" / "2:1" / "1" back. Refuses anything else rather than guessing.
bool scaleFromText(const std::string& text, Scale& out);

// Whether the scale on the sheet is chosen by the fit or pinned by the user.
enum class ScaleMode : std::uint8_t { Automatic, Fixed };
const char* toString(ScaleMode mode) noexcept;
bool scaleModeFromName(const std::string& name, ScaleMode& out) noexcept;

// The arithmetic behind a scale, kept so a panel can show its working. A user
// who can see "380 x 277 mm of paper, 160 x 100 mm of part" can check the ratio
// themselves, which is the only real defence against a drawing that lies.
struct ScaleFit {
  bool ok = false;
  Scale scale{1, 1};
  double modelWidthMm = 0.0;
  double modelHeightMm = 0.0;
  double drawableWidthMm = 0.0;
  double drawableHeightMm = 0.0;
  double paperWidthMm = 0.0;   // modelWidth * factor
  double paperHeightMm = 0.0;  // modelHeight * factor
  bool fits = false;           // paper* <= drawable*
  std::string reason;          // a user sentence; empty when ok && fits
};

// The largest rung of standardScales() at which `modelWidthMm x modelHeightMm`
// fits inside the sheet's drawable area. `ok` is false when the model has no
// measurable size yet (nothing built) and `fits` is false when even the smallest
// published rung is too big -- both are reported, never rounded away.
ScaleFit fitScale(double modelWidthMm, double modelHeightMm, const SheetSize& sheet);
// The same arithmetic for a scale the user pinned. `fits` may be false: a fixed
// scale that overruns the paper is a real thing a drawing office does on
// purpose, and hiding it would be worse than saying it.
ScaleFit applyScale(const Scale& scale, double modelWidthMm, double modelHeightMm,
                    const SheetSize& sheet);

// ═══ PROJECTION ═════════════════════════════════════════════════════════════
//
// First angle (ISO 128-30, the European convention) and third angle (ASME
// Y14.3, the North American one) differ in WHERE a view is placed relative to
// the front view, and getting it wrong mirrors a part. The document stores which
// one it is drawn in and the view list says so on every row.
enum class ProjectionAngle : std::uint8_t { First, Third };
const char* toString(ProjectionAngle angle) noexcept;   // "first" / "third"
// Every ...FromName below reads exactly what its toString() wrote and REFUSES
// anything else, leaving `out` untouched. A document written by a newer build
// can name a value this one has never heard of, and quietly taking the first
// enumerator would put a third-angle drawing under a first-angle label.
bool projectionAngleFromName(const std::string& name, ProjectionAngle& out) noexcept;
const char* projectionLabel(ProjectionAngle angle) noexcept;  // for a user

// The exact orthographic axes of a drawing view, Z-up, matching the convention
// forge-kernel's primitives are authored in (FRONT looks along -Y at the part).
//
//   normal : unit vector from the part TOWARD the viewer (the projection normal)
//   up     : which way is up on the paper
//   right  : cross(up, normal) -- which way is right on the paper
//
// ── why this is not CameraModel::namedViewAngles ────────────────────────────
// The interactive camera clamps Top and Bottom SHORT OF THE POLE by
// kCameraPoleGuard, so its up vector cannot degenerate while a user orbits. A
// drawing has no such problem and cannot afford the guard: a top view tilted by
// a degree projects a part 1.7 mm wider than it is at 100 mm, and that number
// would be printed on a drawing. So the drawing's axes are exact. The two are
// not allowed to drift apart silently either -- ui/test/drawing_test.cpp asserts
// they agree for every view where the guard does not apply, and differ by
// exactly the guard where it does.
struct ViewAxes {
  double normal[3] = {0.0, -1.0, 0.0};
  double up[3] = {0.0, 0.0, 1.0};
  double right[3] = {1.0, 0.0, 0.0};
};
ViewAxes drawingViewAxes(NamedView view) noexcept;

// The real size of the model as THIS view sees it.
struct ProjectedExtent {
  bool ok = false;          // false when there were no points to project
  std::size_t points = 0;
  double widthMm = 0.0;     // along `right`
  double heightMm = 0.0;    // along `up`
  double depthMm = 0.0;     // along `normal` -- how deep the view is
  double minRight = 0.0, maxRight = 0.0;
  double minUp = 0.0, maxUp = 0.0;
};

// Projects real points. Takes the vertices, NOT a bounding box: see the header.
ProjectedExtent projectExtent(const std::vector<Point3>& points, const ViewAxes& axes);
// The tessellation vertices belonging to ONE face of the built part, welded on
// the same quantum MeasureModel uses so a shared B-rep vertex is one point and
// not three. This is the sample set a geometric tolerance is measured on.
std::vector<Point3> facePoints(const MeasureMesh& mesh, std::uint32_t faceId);
// The same over the triangle soup the viewport is already drawing, so a caller
// with a MeasureMesh does not have to build a second copy of the model.
ProjectedExtent projectExtent(const MeasureMesh& mesh, const ViewAxes& axes);

// Where a view sits relative to the front view on the sheet, in whole cells:
// `column` grows to the right, `row` grows UPWARD. Front is {0,0}.
struct SheetCell {
  int column = 0;
  int row = 0;
  // False for a view that the projection rules do not place -- the isometric,
  // which every drawing office drops in whatever corner is free. Saying so beats
  // inventing a rule for it.
  bool placedByProjection = true;
};
SheetCell sheetCell(NamedView view, ProjectionAngle angle) noexcept;

// One row of the view list: a real view, of the real model, at the real scale.
struct DrawingView {
  NamedView view = NamedView::Front;
  ViewAxes axes{};
  ProjectedExtent extent{};
  SheetCell cell{};
  double paperWidthMm = 0.0;   // extent.widthMm * scale.factor()
  double paperHeightMm = 0.0;
  bool fitsSheet = false;      // this view alone fits the drawable area
};

// Every standard view of a real model at a real scale, in NamedView order.
// `mesh` is the tessellation the viewport is drawing; when it is empty every row
// comes back with `extent.ok == false` and the caller shows the empty state.
std::vector<DrawingView> buildViewList(const MeasureMesh& mesh, const Scale& scale,
                                       ProjectionAngle angle, const SheetSize& sheet);

// The overall size of the PROJECTION GROUP (front + top + side laid out in their
// cells) at 1:1, which is what a scale has to be chosen to fit. Returns false
// when the model has no measurable size.
bool projectionGroupSize(const MeasureMesh& mesh, ProjectionAngle angle, double& widthMm,
                         double& heightMm);

// ═══ TITLE BLOCK ════════════════════════════════════════════════════════════
//
// Where a value came from. This is the honesty device of the whole module: a
// title block is a legal document about a part, and a field whose value the
// program made up is worse than a blank one.
enum class FieldSource : std::uint8_t {
  // The document has no value. The field is EMPTY and the user fills it.
  Unset,
  // The user typed it and it is saved in the document.
  Document,
  // Computed from the model that is built right now (scale, extents, units).
  Model,
  // Read from the file on disk (its path, when it was last written).
  File,
};
const char* toString(FieldSource source) noexcept;

struct TitleBlockField {
  std::string key;     // "part_number" -- stable, so a panel can bind to a row
  std::string label;   // "Part number", "Revision", ...
  std::string value;   // empty exactly when source == Unset
  FieldSource source = FieldSource::Unset;
  std::string origin;  // one short phrase saying where the value came from
  // True for the rows a user types. The DERIVED rows -- date, units, sheet,
  // scale, part size -- are false, and that is not a UI preference: a title
  // block whose scale can be typed independently of the drawing is exactly the
  // defect this module exists to prevent.
  bool editable = false;
};

// What the document stores. Every string here is typed by a user; none of them
// has a default that reads as data.
struct TitleBlockData {
  std::string partNumber;
  std::string title;
  std::string revision;
  std::string author;
  std::string approvedBy;
  std::string company;
  std::string material;
  std::string finish;
  std::string sheetId = "A3";  // a sheet is a CHOICE, and A3 is this build's
                               // starting choice; it is saved, shown with its
                               // real dimensions, and changed from the panel.
  ProjectionAngle projection = ProjectionAngle::First;
  ScaleMode scaleMode = ScaleMode::Automatic;
  Scale fixedScale{1, 1};

  bool operator==(const TitleBlockData& other) const;
};

// What the title block is built FROM: the parts of the answer that are not the
// user's own words.
struct TitleBlockContext {
  std::string documentName;    // the open document's name
  std::string documentPath;    // "" until it has been saved
  std::string savedOn;         // the file's modification time, "" when unsaved
  std::string units;           // the document's stored unit -- never a literal
  std::size_t featureCount = 0;
  bool modelBuilt = false;
  ScaleFit scale{};
  double extentXmm = 0.0, extentYmm = 0.0, extentZmm = 0.0;  // the real bbox
  const SheetSize* sheet = nullptr;
};

// The rows a title block panel draws, in drawing order. Total: it answers for an
// empty document, an unsaved one and one whose model has not built.
std::vector<TitleBlockField> titleBlockRows(const TitleBlockData& data,
                                            const TitleBlockContext& context);

// The member of `data` a row key names, or nullptr when the key names a derived
// row. ONE place decides which rows a user may type into, so a panel cannot
// grow a text box over a computed value.
std::string* titleBlockFieldByKey(TitleBlockData& data, const std::string& key);

// ═══ ANNOTATIONS ════════════════════════════════════════════════════════════
enum class AnnotationKind : std::uint8_t {
  Note,     // free text on the sheet
  Leader,   // text with a leader line to a feature
  Balloon,  // an item number, for a parts list
  Datum,    // a datum feature symbol: this face IS datum A
};
const char* toString(AnnotationKind kind) noexcept;
const char* annotationLabel(AnnotationKind kind) noexcept;  // for a user
bool annotationKindFromName(const std::string& name, AnnotationKind& out) noexcept;
const std::vector<AnnotationKind>& allAnnotationKinds();

struct Annotation {
  std::string id;      // stable within a document; generated, never re-used
  AnnotationKind kind = AnnotationKind::Note;
  std::string text;
  EntityRef target{};  // the geometry it points at; invalid for a sheet note
  NamedView view = NamedView::Front;

  bool attached() const noexcept { return target.valid(); }
};

// ═══ GEOMETRIC TOLERANCES ═══════════════════════════════════════════════════
//
// The ASME Y14.5-2018 characteristics the kernel's evaluator implements. The
// names are spelled in WORDS, not in the Y14.5 symbols: the application's font
// has no glyph for the flatness or position symbol, and a title block full of
// empty boxes is worse than a title block full of English.
enum class GdtCharacteristic : std::uint8_t {
  Flatness,
  Straightness,
  Circularity,
  Cylindricity,
  Position,
  Perpendicularity,
  Parallelism,
  Angularity,
  ProfileOfASurface,
};
const char* toString(GdtCharacteristic c) noexcept;
const char* gdtLabel(GdtCharacteristic c) noexcept;
bool gdtCharacteristicFromName(const std::string& name, GdtCharacteristic& out) noexcept;
const std::vector<GdtCharacteristic>& allGdtCharacteristics();
// Y14.5 section 5 form controls take NO datum; the rest reference at least one.
bool isFormControl(GdtCharacteristic c) noexcept;

enum class MaterialModifier : std::uint8_t { RegardlessOfFeatureSize, MaximumMaterial, LeastMaterial };
const char* toString(MaterialModifier m) noexcept;
const char* materialModifierLabel(MaterialModifier m) noexcept;
bool materialModifierFromName(const std::string& name, MaterialModifier& out) noexcept;
const std::vector<MaterialModifier>& allMaterialModifiers();

// The kind of geometry a control is applied to. Y14.5 legality depends on it --
// flatness on an axis is not a legal frame -- and the kernel's checker takes it.
enum class ControlledFeatureKind : std::uint8_t {
  PlanarSurface,
  CylinderAxis,
  CylinderSurface,
  FeatureOfSize,
  LineElement,
};
const char* toString(ControlledFeatureKind k) noexcept;
const char* controlledFeatureLabel(ControlledFeatureKind k) noexcept;
bool controlledFeatureKindFromName(const std::string& name, ControlledFeatureKind& out) noexcept;
const std::vector<ControlledFeatureKind>& allControlledFeatureKinds();

// One feature control frame, as the drawing carries it.
struct FeatureControlFrame {
  std::string id;
  GdtCharacteristic characteristic = GdtCharacteristic::Flatness;
  double toleranceMm = 0.0;
  // The BASIC angle an angularity control is measured against, in degrees.
  // Meaningless for every other characteristic (perpendicularity is 90 and
  // parallelism is 0 by definition, and neither is stored twice).
  double basicAngleDeg = 0.0;
  bool diametralZone = false;
  MaterialModifier modifier = MaterialModifier::RegardlessOfFeatureSize;
  ControlledFeatureKind feature = ControlledFeatureKind::PlanarSurface;
  std::vector<char> datumRefs;  // 'A','B','C' in precedence order
  EntityRef target{};           // the face the frame controls
  std::string targetLabel;      // what that face was called when it was authored
};

// The basic angle this control is measured at: 0 for parallelism, 90 for
// perpendicularity, the stored value for angularity, and 0 (unused) otherwise.
double basicAngleOf(const FeatureControlFrame& fcf) noexcept;

// The frame read aloud: "flatness 0.05" / "position dia 0.2 at maximum material
// to A B C". This is what a panel prints, so it is prose a user can act on.
std::string describeFcf(const FeatureControlFrame& fcf);

// A datum feature: one letter, bound to one real face.
struct DatumFeature {
  char letter = 'A';
  EntityRef target{};
  std::string targetLabel;
};

// ═══ THE DRAWING ════════════════════════════════════════════════════════════
//
// The container the document saves. Validation is here rather than at the call
// site so a file, a panel and a gate all get the same refusals.
class DrawingModel {
 public:
  TitleBlockData& titleBlock() noexcept { return title_; }
  const TitleBlockData& titleBlock() const noexcept { return title_; }

  const std::vector<Annotation>& annotations() const noexcept { return notes_; }
  const std::vector<FeatureControlFrame>& frames() const noexcept { return frames_; }
  const std::vector<DatumFeature>& datums() const noexcept { return datums_; }

  // Adds a note. `id` is filled in when empty. Refuses blank text, and refuses a
  // duplicate id, naming the reason in `reason`.
  bool addAnnotation(Annotation note, std::string& reason);
  bool removeAnnotation(const std::string& id);

  // Refuses a non-positive tolerance (a zone of zero width is not a tolerance),
  // a form control carrying datums, a control that references a datum letter no
  // face carries, and more than three datum references (Y14.5 allows at most a
  // primary, a secondary and a tertiary).
  bool addFrame(FeatureControlFrame frame, std::string& reason);
  bool removeFrame(const std::string& id);

  // Refuses a letter outside A..Z, the letters I, O and Q (Y14.5 excludes them
  // because they read as 1, 0 and a smudge), and a letter already taken.
  bool addDatum(DatumFeature datum, std::string& reason);
  bool removeDatum(char letter);
  const DatumFeature* datum(char letter) const;
  // The letters that exist on the part, sorted -- what an FCF may reference.
  std::vector<char> datumLetters() const;

  // Used by the file reader, which has already validated the block it read and
  // must not have a legal document refused by a rule the writer never applied.
  void restore(TitleBlockData title, std::vector<DatumFeature> datums,
               std::vector<Annotation> notes, std::vector<FeatureControlFrame> frames);

  void clear();
  bool empty() const noexcept;

  // A fresh id for a note or a frame, unique within this drawing.
  std::string nextAnnotationId() const;
  std::string nextFrameId() const;

 private:
  TitleBlockData title_{};
  std::vector<Annotation> notes_;
  std::vector<FeatureControlFrame> frames_;
  std::vector<DatumFeature> datums_;
};

}  // namespace forge::ui

#endif  // FORGE_UI_DRAWING_HPP
