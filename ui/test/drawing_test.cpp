// ui/test/drawing_test.cpp
//
// THE DRAWING MODEL, ASSERTED — every number the four drawing panels print,
// checked headlessly against an answer computed by hand.
//
// The panels themselves draw and do not compute; this is where the computation
// is proved. Five things it pins that a reader of the panel could not:
//
//   1. THE SHEETS AND SCALES ARE THE PUBLISHED ONES. The ISO 216 halving
//      relationship, the exact-inch ANSI sizes and the ISO 5455 ladder are all
//      checked against their definitions, so a sheet or a rung cannot be quietly
//      edited into a number nobody standardised.
//   2. THE VIEW AXES ARE EXACT, and their relationship to the interactive
//      camera's is pinned: identical for the four equatorial views, and
//      different at the poles by EXACTLY the camera's pole guard. That is a
//      documented divergence rather than a silent second table.
//   3. A VIEW IS SIZED FROM THE PART, NOT FROM ITS BOUNDING BOX. There is a
//      direct test that the two differ for a shape whose box is not tight, so
//      the cheaper wrong implementation cannot pass this file.
//   4. THE REFUSALS ARE REAL. Every rule DrawingModel enforces is exercised on
//      input that breaks it, and the reason it gives is checked.
//   5. THE PROSE IS FIT TO SHOW A USER. Every sentence this module can produce
//      is fed through scanUserFacingProse. The panel gate cannot see these --
//      they are not literals in the frame builder -- so they are scanned here,
//      at the place that writes them.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ui/CameraModel.hpp"
#include "forge/ui/Drawing.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/UserFacingText.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

Harness* gH = nullptr;

void addQuad(MeasureMesh& m, const double a[3], const double b[3], const double c[3],
             const double d[3], std::uint32_t face) {
  m.addTriangle(a, b, c, face);
  m.addTriangle(a, c, d, face);
}

// A closed, outward-wound box from (0,0,0) to (sx,sy,sz), one face id per side,
// exactly as a tessellator would hand it over.
MeasureMesh boxMesh(double sx, double sy, double sz) {
  MeasureMesh m;
  const double p000[3] = {0, 0, 0};
  const double p100[3] = {sx, 0, 0};
  const double p110[3] = {sx, sy, 0};
  const double p010[3] = {0, sy, 0};
  const double p001[3] = {0, 0, sz};
  const double p101[3] = {sx, 0, sz};
  const double p111[3] = {sx, sy, sz};
  const double p011[3] = {0, sy, sz};
  addQuad(m, p000, p010, p110, p100, 1);  // bottom, -Z
  addQuad(m, p001, p101, p111, p011, 2);  // top, +Z
  addQuad(m, p000, p100, p101, p001, 3);  // front, -Y
  addQuad(m, p010, p011, p111, p110, 4);  // back, +Y
  addQuad(m, p000, p001, p011, p010, 5);  // left, -X
  addQuad(m, p100, p110, p111, p101, 6);  // right, +X
  return m;
}

double dot3(const double a[3], const double b[3]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

void scanProse(Harness& H, const std::string& text, const char* where) {
  const std::vector<ProseFinding> f = scanUserFacingProse(text);
  if (!f.empty()) {
    std::printf("  FAIL  %s: \"%s\"\n        %s\n", where, text.c_str(),
                describeProseFindings(f).c_str());
  }
  CHECK(f.empty());
}

EntityRef faceRef(std::uint32_t id) {
  EntityRef r;
  r.bodyId = "body_1";
  r.kind = EntityKind::Face;
  r.persistentName = "face@" + std::to_string(id);
  return r;
}

}  // namespace

int main() {
  Harness H("drawing");
  gH = &H;
  (void)gH;

  // ══ 1. SHEETS ═══════════════════════════════════════════════════════════
  {
    CHECK(sheetSizes().size() >= 10);
    const SheetSize* a4 = findSheetSize("A4");
    const SheetSize* a3 = findSheetSize("A3");
    const SheetSize* a0 = findSheetSize("A0");
    CHECK(a4 != nullptr && a3 != nullptr && a0 != nullptr);
    if (a4 != nullptr && a3 != nullptr && a0 != nullptr) {
      // ISO 216: the next size up is the previous one turned and doubled.
      CHECK_NEAR(a3->widthMm, a4->heightMm * 2.0, 1.0);
      CHECK_NEAR(a3->heightMm, a4->widthMm, 0.5);
      CHECK_NEAR(a0->widthMm * a0->heightMm, 1.0e6, 3000.0);  // A0 is one square metre
      // Landscape: the long edge is the width, for every sheet.
      for (const SheetSize& s : sheetSizes()) CHECK(s.widthMm > s.heightMm);
      // ISO 5457 frames: 10 mm to A2, 20 mm above, 20 mm filing edge throughout.
      CHECK_NEAR(a3->borderMm, 10.0, 1e-9);
      CHECK_NEAR(a0->borderMm, 20.0, 1e-9);
      CHECK_NEAR(a3->filingMm, 20.0, 1e-9);
      // The drawable area is the paper less the frame, and nothing else.
      CHECK_NEAR(a3->drawableWidthMm(), 420.0 - 10.0 - 20.0, 1e-9);
      CHECK_NEAR(a3->drawableHeightMm(), 297.0 - 20.0, 1e-9);
    }
    // ANSI sizes are defined in inches; the conversion is the exact 25.4.
    const SheetSize* b = findSheetSize("ANSI B");
    CHECK(b != nullptr);
    if (b != nullptr) {
      CHECK_NEAR(b->widthMm, 17.0 * 25.4, 1e-9);
      CHECK_NEAR(b->heightMm, 11.0 * 25.4, 1e-9);
      CHECK_NEAR(b->borderMm, 12.7, 1e-9);
    }
    CHECK(findSheetSize("A9") == nullptr);   // refused, not invented
    for (const SheetSize& s : sheetSizes()) scanProse(H, s.label, "sheet label");
  }

  // ══ 2. SCALE ════════════════════════════════════════════════════════════
  {
    // The ladder is ordered largest first, strictly decreasing.
    const std::vector<Scale>& rungs = standardScales();
    CHECK(rungs.size() >= 12);
    for (std::size_t i = 1; i < rungs.size(); ++i) {
      CHECK(rungs[i].factor() < rungs[i - 1].factor());
    }
    // and 1:1 is on it, because a full-size drawing is the commonest one there is
    bool hasFull = false;
    for (const Scale& s : rungs) {
      if (s.drawing == 1 && s.model == 1) hasFull = true;
    }
    CHECK(hasFull);

    const SheetSize* a3 = findSheetSize("A3");
    CHECK(a3 != nullptr);
    if (a3 != nullptr) {
      // A 100 x 80 part on A3: the drawable area is 390 x 277, so 2:1 gives
      // 200 x 160 and fits, and 5:1 gives 500 x 400 and does not. The largest
      // rung that fits is therefore 2:1 -- computed by hand, not by running it.
      const ScaleFit f = fitScale(100.0, 80.0, *a3);
      CHECK(f.ok);
      CHECK(f.fits);
      CHECK_EQ_STR(f.scale.text(), "2:1");
      CHECK_NEAR(f.paperWidthMm, 200.0, 1e-9);
      CHECK_NEAR(f.paperHeightMm, 160.0, 1e-9);
      CHECK_NEAR(f.drawableWidthMm, 390.0, 1e-9);

      // A part far larger than the smallest rung can shrink: refused, and the
      // refusal says what to do rather than silently returning 1:10000.
      const ScaleFit huge = fitScale(1.0e9, 1.0e9, *a3);
      CHECK(!huge.ok);
      CHECK(!huge.fits);
      CHECK(!huge.reason.empty());
      scanProse(H, huge.reason, "fitScale refusal");

      // Nothing built yet: no scale, and a different sentence, because "too big
      // for the sheet" and "there is no part" are different problems.
      const ScaleFit none = fitScale(0.0, 0.0, *a3);
      CHECK(!none.ok);
      CHECK(none.reason != huge.reason);
      scanProse(H, none.reason, "fitScale empty");

      // A pinned scale that overruns the paper is REPORTED, not corrected.
      const ScaleFit pinned = applyScale(Scale{10, 1}, 100.0, 80.0, *a3);
      CHECK(pinned.ok);
      CHECK(!pinned.fits);
      CHECK_NEAR(pinned.paperWidthMm, 1000.0, 1e-9);
      scanProse(H, pinned.reason, "applyScale overrun");
    }

    Scale parsed;
    CHECK(scaleFromText("1:2", parsed));
    CHECK_EQ_INT(parsed.drawing, 1);
    CHECK_EQ_INT(parsed.model, 2);
    CHECK(scaleFromText(" 5 : 1 ", parsed) && parsed.drawing == 5 && parsed.model == 1);
    CHECK(scaleFromText("1", parsed) && parsed.drawing == 1 && parsed.model == 1);
    CHECK(!scaleFromText("1:0", parsed));    // a zero denominator is not a scale
    CHECK(!scaleFromText("-1:2", parsed));
    CHECK(!scaleFromText("half", parsed));
    CHECK(!scaleFromText("1:2x", parsed));   // trailing junk is refused, not taken
    // and every rung round-trips through its own text
    for (const Scale& s : standardScales()) {
      Scale back;
      CHECK(scaleFromText(s.text(), back));
      CHECK(back == s);
    }
  }

  // ══ 3. THE VIEW AXES ════════════════════════════════════════════════════
  {
    for (std::size_t i = 0; i < kNamedViewCount; ++i) {
      const NamedView v = static_cast<NamedView>(static_cast<std::uint8_t>(i));
      const ViewAxes a = drawingViewAxes(v);
      // orthonormal, right-handed: right = up x normal
      CHECK_NEAR(std::sqrt(dot3(a.normal, a.normal)), 1.0, 1e-12);
      CHECK_NEAR(std::sqrt(dot3(a.up, a.up)), 1.0, 1e-12);
      CHECK_NEAR(std::sqrt(dot3(a.right, a.right)), 1.0, 1e-12);
      CHECK_NEAR(dot3(a.normal, a.up), 0.0, 1e-12);
      CHECK_NEAR(dot3(a.normal, a.right), 0.0, 1e-12);
      CHECK_NEAR(dot3(a.up, a.right), 0.0, 1e-12);
    }
    // Z-up, front on -Y: the convention Types.hpp states for the whole app.
    const ViewAxes front = drawingViewAxes(NamedView::Front);
    CHECK_NEAR(front.normal[1], -1.0, 1e-12);
    CHECK_NEAR(front.right[0], 1.0, 1e-12);
    CHECK_NEAR(front.up[2], 1.0, 1e-12);
    const ViewAxes top = drawingViewAxes(NamedView::Top);
    CHECK_NEAR(top.normal[2], 1.0, 1e-12);   // EXACTLY down the axis
    // True isometric: the three axes foreshorten equally, so every component of
    // the view direction has the same magnitude.
    const ViewAxes iso = drawingViewAxes(NamedView::Isometric);
    CHECK_NEAR(std::fabs(iso.normal[0]), std::fabs(iso.normal[1]), 1e-12);
    CHECK_NEAR(std::fabs(iso.normal[1]), std::fabs(iso.normal[2]), 1e-12);
    CHECK_NEAR(std::fabs(iso.normal[0]), 1.0 / std::sqrt(3.0), 1e-12);

    // ── the documented divergence from the interactive camera ─────────────
    // Same direction for the four equatorial views; different at the poles by
    // EXACTLY kCameraPoleGuard, which is the camera's up-vector guard and has no
    // business on a drawing. If either table moves this fails.
    for (const NamedView v :
         {NamedView::Front, NamedView::Back, NamedView::Left, NamedView::Right}) {
      double az = 0.0;
      double el = 0.0;
      namedViewAngles(v, az, el);
      const double eye[3] = {std::cos(el) * std::cos(az), std::cos(el) * std::sin(az),
                             std::sin(el)};
      const ViewAxes a = drawingViewAxes(v);
      CHECK_NEAR(dot3(eye, a.normal), 1.0, 1e-9);
    }
    for (const NamedView v : {NamedView::Top, NamedView::Bottom}) {
      double az = 0.0;
      double el = 0.0;
      namedViewAngles(v, az, el);
      const double eye[3] = {std::cos(el) * std::cos(az), std::cos(el) * std::sin(az),
                             std::sin(el)};
      const ViewAxes a = drawingViewAxes(v);
      const double between = std::acos(std::fmin(1.0, dot3(eye, a.normal)));
      CHECK_NEAR(between, kCameraPoleGuard, 1e-9);
    }
  }

  // ══ 4. PROJECTING A REAL PART ═══════════════════════════════════════════
  {
    const MeasureMesh box = boxMesh(160.0, 100.0, 40.0);
    const ProjectedExtent front = projectExtent(box, drawingViewAxes(NamedView::Front));
    CHECK(front.ok);
    CHECK_NEAR(front.widthMm, 160.0, 1e-9);   // X across
    CHECK_NEAR(front.heightMm, 40.0, 1e-9);   // Z up
    CHECK_NEAR(front.depthMm, 100.0, 1e-9);   // Y into the page
    const ProjectedExtent top = projectExtent(box, drawingViewAxes(NamedView::Top));
    CHECK_NEAR(top.widthMm, 160.0, 1e-9);
    CHECK_NEAR(top.heightMm, 100.0, 1e-9);
    const ProjectedExtent right = projectExtent(box, drawingViewAxes(NamedView::Right));
    CHECK_NEAR(right.widthMm, 100.0, 1e-9);
    CHECK_NEAR(right.heightMm, 40.0, 1e-9);

    // ── the bounding-box shortcut is WRONG, and here is the proof ─────────
    // Four points whose bounding box is the WHOLE 100 mm cube -- they reach
    // every face of it -- but which seen isometrically are only half as wide as
    // that cube is. The isometric line of sight puts the horizontal axis along
    // x+y, and no point of this shape reaches the far corner where both are
    // 100. An implementation that projected the bounding box would report
    // 141.42 mm where the part measures 70.71, and print the larger number on a
    // drawing.
    std::vector<Point3> tet = {Point3{0, 0, 0}, Point3{100, 0, 50}, Point3{0, 100, 50},
                               Point3{0, 0, 100}};
    std::vector<Point3> corners;
    for (int i = 0; i < 8; ++i) {
      corners.push_back(Point3{(i & 1) ? 100.0 : 0.0, (i & 2) ? 100.0 : 0.0,
                               (i & 4) ? 100.0 : 0.0});
    }
    const ViewAxes iso = drawingViewAxes(NamedView::Isometric);
    const ProjectedExtent shape = projectExtent(tet, iso);
    const ProjectedExtent bound = projectExtent(corners, iso);
    CHECK(shape.ok && bound.ok);
    CHECK_NEAR(bound.widthMm, 200.0 / std::sqrt(2.0), 1e-9);
    CHECK_NEAR(shape.widthMm, 100.0 / std::sqrt(2.0), 1e-9);
    CHECK(shape.widthMm < bound.widthMm - 1.0);
    CHECK(shape.heightMm <= bound.heightMm + 1e-9);

    // An empty model answers "no", it does not answer zero.
    const MeasureMesh nothing;
    CHECK(!projectExtent(nothing, iso).ok);
    double gw = 0.0;
    double gh = 0.0;
    CHECK(!projectionGroupSize(nothing, ProjectionAngle::First, gw, gh));
    CHECK(projectionGroupSize(box, ProjectionAngle::First, gw, gh));
    CHECK_NEAR(gw, 160.0 + 100.0, 1e-9);  // front beside the side view
    CHECK_NEAR(gh, 40.0 + 100.0, 1e-9);   // front above the top view

    // facePoints WELDS: a box side is two triangles over four corners, and the
    // shared edge must not weight two of them twice.
    const std::vector<Point3> facePts = facePoints(box, 1);
    CHECK_EQ_INT(facePts.size(), 4);
    CHECK(facePoints(box, 999).empty());
  }

  // ══ 5. WHERE A VIEW GOES ════════════════════════════════════════════════
  {
    // First and third angle put every view on OPPOSITE sides of the front one.
    // Getting this backwards mirrors a part, which is why it is checked.
    for (const NamedView v :
         {NamedView::Top, NamedView::Bottom, NamedView::Left, NamedView::Right}) {
      const SheetCell first = sheetCell(v, ProjectionAngle::First);
      const SheetCell third = sheetCell(v, ProjectionAngle::Third);
      CHECK_EQ_INT(first.column, -third.column);
      CHECK_EQ_INT(first.row, -third.row);
      CHECK(first.placedByProjection);
    }
    CHECK_EQ_INT(sheetCell(NamedView::Top, ProjectionAngle::Third).row, 1);   // above
    CHECK_EQ_INT(sheetCell(NamedView::Top, ProjectionAngle::First).row, -1);  // below
    CHECK_EQ_INT(sheetCell(NamedView::Right, ProjectionAngle::Third).column, 1);
    CHECK_EQ_INT(sheetCell(NamedView::Front, ProjectionAngle::First).column, 0);
    CHECK_EQ_INT(sheetCell(NamedView::Front, ProjectionAngle::First).row, 0);
    // The isometric is NOT placed by the projection rules, and says so.
    CHECK(!sheetCell(NamedView::Isometric, ProjectionAngle::First).placedByProjection);

    const SheetSize* a3 = findSheetSize("A3");
    CHECK(a3 != nullptr);
    if (a3 != nullptr) {
      const MeasureMesh box = boxMesh(160.0, 100.0, 40.0);
      const std::vector<DrawingView> views =
          buildViewList(box, Scale{1, 2}, ProjectionAngle::First, *a3);
      CHECK_EQ_INT(views.size(), kNamedViewCount);
      for (const DrawingView& v : views) {
        CHECK(v.extent.ok);
        CHECK_NEAR(v.paperWidthMm, v.extent.widthMm * 0.5, 1e-9);
        CHECK(v.fitsSheet);
      }
      // and at a scale that does not fit, the row says so rather than clipping
      const std::vector<DrawingView> big =
          buildViewList(box, Scale{10, 1}, ProjectionAngle::First, *a3);
      bool anyOverrun = false;
      for (const DrawingView& v : big) {
        if (!v.fitsSheet) anyOverrun = true;
      }
      CHECK(anyOverrun);
    }
  }

  // ══ 6. THE DRAWING'S OWN RULES ══════════════════════════════════════════
  {
    DrawingModel d;
    std::string why;

    // A note needs text, and gets an id it did not have to supply.
    Annotation blank;
    CHECK(!d.addAnnotation(blank, why));
    scanProse(H, why, "blank note refusal");
    Annotation note;
    note.text = "  break sharp edges  ";
    CHECK(d.addAnnotation(note, why));
    CHECK_EQ_INT(d.annotations().size(), 1);
    CHECK_EQ_STR(d.annotations().front().text, "break sharp edges");  // trimmed
    CHECK(!d.annotations().front().id.empty());
    CHECK(!d.removeAnnotation("nope"));
    CHECK(d.removeAnnotation(d.annotations().front().id));
    CHECK(d.annotations().empty());

    // Datum letters: A..Z without I, O or Q, one face each, and a datum has to
    // name a real face.
    DatumFeature bad;
    bad.letter = 'I';
    bad.target = faceRef(1);
    CHECK(!d.addDatum(bad, why));
    scanProse(H, why, "datum letter refusal");
    DatumFeature loose;
    loose.letter = 'A';
    CHECK(!d.addDatum(loose, why));  // no face
    scanProse(H, why, "unattached datum refusal");
    DatumFeature a;
    a.letter = 'A';
    a.target = faceRef(1);
    a.targetLabel = "face 1";
    CHECK(d.addDatum(a, why));
    DatumFeature again;
    again.letter = 'A';
    again.target = faceRef(2);
    CHECK(!d.addDatum(again, why));
    scanProse(H, why, "duplicate datum refusal");
    DatumFeature b;
    b.letter = 'B';
    b.target = faceRef(2);
    CHECK(d.addDatum(b, why));
    CHECK_EQ_INT(d.datumLetters().size(), 2);
    CHECK(d.datum('A') != nullptr && d.datum('C') == nullptr);

    // A tolerance of zero allows nothing, so it is not a tolerance.
    FeatureControlFrame zero;
    zero.characteristic = GdtCharacteristic::Flatness;
    zero.target = faceRef(3);
    CHECK(!d.addFrame(zero, why));
    scanProse(H, why, "zero tolerance refusal");

    // A form control takes no datum; an orientation control needs one.
    FeatureControlFrame flatWithDatum;
    flatWithDatum.characteristic = GdtCharacteristic::Flatness;
    flatWithDatum.toleranceMm = 0.05;
    flatWithDatum.datumRefs = {'A'};
    flatWithDatum.target = faceRef(3);
    CHECK(!d.addFrame(flatWithDatum, why));
    scanProse(H, why, "form control with datum");

    FeatureControlFrame perpNoDatum;
    perpNoDatum.characteristic = GdtCharacteristic::Perpendicularity;
    perpNoDatum.toleranceMm = 0.05;
    perpNoDatum.target = faceRef(3);
    CHECK(!d.addFrame(perpNoDatum, why));
    scanProse(H, why, "orientation without datum");

    // A datum that is not on the part cannot be referenced.
    FeatureControlFrame ghost = perpNoDatum;
    ghost.datumRefs = {'C'};
    CHECK(!d.addFrame(ghost, why));
    scanProse(H, why, "unknown datum reference");

    // At most three, and never the same one twice.
    FeatureControlFrame twice = perpNoDatum;
    twice.datumRefs = {'A', 'A'};
    CHECK(!d.addFrame(twice, why));
    scanProse(H, why, "duplicate reference");
    FeatureControlFrame four = perpNoDatum;
    four.datumRefs = {'A', 'B', 'A', 'B'};
    CHECK(!d.addFrame(four, why));
    scanProse(H, why, "four datums");

    // Angularity is measured at a basic angle strictly between the two that
    // already have their own control.
    FeatureControlFrame ang = perpNoDatum;
    ang.characteristic = GdtCharacteristic::Angularity;
    ang.datumRefs = {'A'};
    ang.basicAngleDeg = 90.0;
    CHECK(!d.addFrame(ang, why));
    scanProse(H, why, "angularity at 90");
    ang.basicAngleDeg = 30.0;
    CHECK(d.addFrame(ang, why));

    FeatureControlFrame good = perpNoDatum;
    good.datumRefs = {'A', 'B'};
    CHECK(d.addFrame(good, why));
    CHECK_EQ_INT(d.frames().size(), 2);

    // ── removing a datum takes the controls that need it ─────────────────
    // The alternative is a control referencing a datum that is not there, which
    // is unmeasurable and would sit on the drawing looking valid.
    CHECK(d.removeDatum('A'));
    CHECK_EQ_INT(d.frames().size(), 0);
    CHECK_EQ_INT(d.datumLetters().size(), 1);
  }

  // ══ 7. HOW A CONTROL READS ══════════════════════════════════════════════
  {
    FeatureControlFrame f;
    f.characteristic = GdtCharacteristic::Flatness;
    f.toleranceMm = 0.05;
    CHECK_EQ_STR(describeFcf(f), "Flatness 0.05 mm");
    f.characteristic = GdtCharacteristic::Position;
    f.diametralZone = true;
    f.toleranceMm = 0.2;
    f.modifier = MaterialModifier::MaximumMaterial;
    f.datumRefs = {'A', 'B', 'C'};
    CHECK_EQ_STR(describeFcf(f), "Position dia 0.2 mm at maximum material to A B C");
    f.characteristic = GdtCharacteristic::Angularity;
    f.diametralZone = false;
    f.modifier = MaterialModifier::RegardlessOfFeatureSize;
    f.basicAngleDeg = 30.0;
    f.datumRefs = {'A'};
    CHECK_EQ_STR(describeFcf(f), "Angularity 0.2 mm at 30 deg to A");
    CHECK_NEAR(basicAngleOf(f), 30.0, 1e-12);
    f.characteristic = GdtCharacteristic::Perpendicularity;
    CHECK_NEAR(basicAngleOf(f), 90.0, 1e-12);
    f.characteristic = GdtCharacteristic::Parallelism;
    CHECK_NEAR(basicAngleOf(f), 0.0, 1e-12);

    // Every label the panels print is scanned, because none of them is a literal
    // in the frame builder where the panel prose gate could see it.
    for (GdtCharacteristic c : allGdtCharacteristics()) {
      scanProse(H, gdtLabel(c), "gdt label");
      GdtCharacteristic back;
      CHECK(gdtCharacteristicFromName(toString(c), back));
      CHECK_EQ_INT(static_cast<int>(back), static_cast<int>(c));
    }
    for (MaterialModifier m : allMaterialModifiers()) {
      scanProse(H, materialModifierLabel(m), "modifier label");
      MaterialModifier back;
      CHECK(materialModifierFromName(toString(m), back));
      CHECK_EQ_INT(static_cast<int>(back), static_cast<int>(m));
    }
    for (ControlledFeatureKind k : allControlledFeatureKinds()) {
      scanProse(H, controlledFeatureLabel(k), "feature label");
      ControlledFeatureKind back;
      CHECK(controlledFeatureKindFromName(toString(k), back));
      CHECK_EQ_INT(static_cast<int>(back), static_cast<int>(k));
    }
    for (AnnotationKind k : allAnnotationKinds()) {
      scanProse(H, annotationLabel(k), "annotation label");
      AnnotationKind back;
      CHECK(annotationKindFromName(toString(k), back));
      CHECK_EQ_INT(static_cast<int>(back), static_cast<int>(k));
    }
    GdtCharacteristic junk = GdtCharacteristic::Position;
    CHECK(!gdtCharacteristicFromName("wobbliness", junk));
    CHECK_EQ_INT(static_cast<int>(junk), static_cast<int>(GdtCharacteristic::Position));
    ProjectionAngle pa = ProjectionAngle::Third;
    CHECK(projectionAngleFromName("first", pa) && pa == ProjectionAngle::First);
    CHECK(!projectionAngleFromName("second", pa));
    CHECK(pa == ProjectionAngle::First);  // untouched by the refusal
    ScaleMode sm = ScaleMode::Fixed;
    CHECK(scaleModeFromName("automatic", sm) && sm == ScaleMode::Automatic);
    CHECK(!scaleModeFromName("clever", sm));
    scanProse(H, projectionLabel(ProjectionAngle::First), "projection label");
    scanProse(H, projectionLabel(ProjectionAngle::Third), "projection label");
  }

  // ══ 8. THE TITLE BLOCK, AND ITS PROVENANCE ══════════════════════════════
  {
    TitleBlockData data;
    TitleBlockContext ctx;

    // Nothing typed, nothing saved, nothing built: every row that has no source
    // is UNSET and EMPTY. Not "N/A", not a placeholder date, not 1:1.
    {
      const std::vector<TitleBlockField> rows = titleBlockRows(data, ctx);
      CHECK(rows.size() >= 12);
      std::size_t unset = 0;
      for (const TitleBlockField& f : rows) {
        scanProse(H, f.label, "title row label");
        scanProse(H, f.origin, "title row origin");
        scanProse(H, f.value, "title row value");
        // The invariant the whole module rests on.
        CHECK((f.source == FieldSource::Unset) == f.value.empty());
        if (f.source == FieldSource::Unset) ++unset;
        // A derived row is never editable, and an editable row is exactly one
        // the file stores.
        TitleBlockData probe;
        CHECK(f.editable == (titleBlockFieldByKey(probe, f.key) != nullptr));
      }
      CHECK(unset >= 8);
      bool sawScale = false;
      for (const TitleBlockField& f : rows) {
        if (f.key == "scale") {
          sawScale = true;
          CHECK(f.value.empty());   // no part, no scale. NOT "1:1".
        }
      }
      CHECK(sawScale);
    }

    // With a document, a file and a built model, the same rows carry real
    // values and say where each one came from.
    data.partNumber = "BRK-001";
    data.revision = "B";
    data.author = "S. Rao";
    ctx.documentName = "bracket";
    ctx.documentPath = "/tmp/bracket.fpart";
    ctx.savedOn = "2026-09-03 11:20";
    ctx.units = "millimetre (mm)";
    ctx.featureCount = 7;
    ctx.modelBuilt = true;
    ctx.extentXmm = 160.0;
    ctx.extentYmm = 100.0;
    ctx.extentZmm = 40.0;
    const SheetSize* a3 = findSheetSize("A3");
    ctx.sheet = a3;
    if (a3 != nullptr) ctx.scale = fitScale(260.0, 140.0, *a3);
    {
      const std::vector<TitleBlockField> rows = titleBlockRows(data, ctx);
      for (const TitleBlockField& f : rows) {
        scanProse(H, f.value, "filled title row");
        CHECK((f.source == FieldSource::Unset) == f.value.empty());
      }
      const auto find = [&rows](const char* key) {
        for (const TitleBlockField& f : rows) {
          if (f.key == key) return f;
        }
        return TitleBlockField{};
      };
      CHECK_EQ_STR(find("part_number").value, "BRK-001");
      CHECK_EQ_INT(static_cast<int>(find("part_number").source),
                   static_cast<int>(FieldSource::Document));
      CHECK_EQ_STR(find("revision").value, "B");
      CHECK_EQ_STR(find("date").value, "2026-09-03 11:20");
      CHECK_EQ_INT(static_cast<int>(find("date").source), static_cast<int>(FieldSource::File));
      CHECK_EQ_INT(static_cast<int>(find("units").source),
                   static_cast<int>(FieldSource::Document));
      CHECK_EQ_INT(static_cast<int>(find("scale").source), static_cast<int>(FieldSource::Model));
      CHECK(find("scale").value.find("1:1") == 0);
      CHECK(find("part_size").value.find("160.00 x 100.00 x 40.00 mm") == 0);
      CHECK_EQ_STR(find("features").value, "7");
      // A field the user did not type stays unset even when the model is built.
      CHECK_EQ_INT(static_cast<int>(find("company").source),
                   static_cast<int>(FieldSource::Unset));
    }

    // The part number FALLS BACK to the document's own name -- a real value with
    // a real source -- rather than to a made-up string.
    data.partNumber.clear();
    {
      const std::vector<TitleBlockField> rows = titleBlockRows(data, ctx);
      for (const TitleBlockField& f : rows) {
        if (f.key != "part_number") continue;
        CHECK_EQ_STR(f.value, "bracket");
        CHECK_EQ_INT(static_cast<int>(f.source), static_cast<int>(FieldSource::File));
      }
    }
  }

  return H.finish();
}
