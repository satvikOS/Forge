// forge-desktop/test/drawing_gate.cpp
//
// THE DRAWING GATE — headless, over a REAL kernel body, asserting that the four
// drawing panels show real numbers and refuse to show wrong ones.
//
// The part is the application's own starting part, built through the shipping
// path (PartDocument -> forge::ft::parse -> compile -> tessellate): an 80 x 50
// plate 20 mm thick with a 12 mm through bore and 3 mm corner fillets. That
// gives the gate exactly the geometry it needs -- flat faces that are
// perpendicular to each other, flat faces that are parallel, and CURVED faces
// (the bore and the fillets) that a tolerance must not be measured on.
//
// WHAT IS ASSERTED, and why each one is not a tautology:
//
//   1. A VIEW IS SIZED FROM THE PART. The front view's width is checked against
//      the mesh's own measured bounding box, computed by a different module
//      (forge::ui::MeasureModel) from the same triangles. Two independent
//      derivations agreeing is evidence; one derivation agreeing with itself is
//      not.
//   2. THE SCALE IS THE LARGEST THAT FITS. Not "is a scale": the gate walks the
//      published ladder and requires every larger rung to overrun the sheet.
//   3. CHANGING THE SHEET CHANGES THE ANSWER. The layout is cached on four
//      witnesses, and a cache that missed one would print a scale chosen for a
//      sheet the user has already changed.
//   4. A TOLERANCE IS MEASURED WHERE IT CAN BE AND REFUSED WHERE IT CANNOT.
//      Flatness and perpendicularity on flat faces are measured against the real
//      coordinates; circularity on the bore is REFUSED, because the only
//      geometry the application holds after a rebuild is the flat-sided
//      approximation it draws, and measuring roundness on that would report the
//      flat sides as an error the part does not have.
//   5. A CALL-OUT THAT CONTRADICTS THE MODEL IS SAID SO. A perpendicularity
//      control between two faces the model has PARALLEL comes back naming both
//      angles, rather than as a silent zero.
//   6. THE DRAWING IS PART OF THE DOCUMENT. It round-trips through a real
//      .fpart on disk, byte for byte, and a version 1 file still opens.
//   7. NOTHING IT PRINTS IS DEVELOPER PROSE. Every sentence any verdict can
//      produce is scanned with forge::ui::scanUserFacingProse.
//
// PROVING THE GATE CAN FAIL: `--mutate <n>` breaks the QUERY, not the assertion.
//   1  the flatness control is placed on the CURVED bore instead of a flat face
//   2  datum A is placed on the CURVED bore instead of a flat face
//   3  the control names a face id that is not in the part
//   4  the document is saved WITHOUT its drawing
//   5  the layout is read once and re-used across a sheet change (a stale cache)
//   6  the scale is taken as a fixed 1:1 instead of the fit
// Each one turns exactly the check it breaks red. `run_desktop.sh` runs them all
// and requires each to fail.
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <unistd.h>

#include "imgui.h"

#include "DrawingGdt.hpp"
#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "PartFile.hpp"
#include "forge/ui/Drawing.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/UserFacingText.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace {

int g_mutation = 0;
std::size_t g_checks = 0;
std::size_t g_failures = 0;

void check(bool ok, const char* what, const std::string& detail = std::string()) {
  ++g_checks;
  if (ok) return;
  ++g_failures;
  std::printf("  FAIL  %-58s  %s\n", what, detail.c_str());
}

void checkNear(double got, double want, double tol, const char* what) {
  ++g_checks;
  if (std::fabs(got - want) <= tol) return;
  ++g_failures;
  std::printf("  FAIL  %-58s  got %.6f, want %.6f (tol %.4g)\n", what, got, want, tol);
}

void checkEq(long long got, long long want, const char* what) {
  ++g_checks;
  if (got == want) return;
  ++g_failures;
  std::printf("  FAIL  %-58s  got %lld, want %lld\n", what, got, want);
}

// Every sentence a panel can put on screen goes through here. The frame
// builder's own literals are scanned by ui/test/user_facing_text_test.cpp; these
// are built at run time out of the geometry and cannot be, so they are scanned
// where they are produced.
void checkProse(const std::string& text, const char* where) {
  ++g_checks;
  const std::vector<forge::ui::ProseFinding> f = forge::ui::scanUserFacingProse(text);
  if (f.empty()) return;
  ++g_failures;
  std::printf("  FAIL  %-58s  \"%s\"\n        %s\n", where, text.c_str(),
              forge::ui::describeProseFindings(f).c_str());
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
    io.BackendRendererName = "drawing_gate_null";
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

void step(forge::desktop::ForgeFrame& frame);

// Bring a panel up the way a user does: find the tab button the frame recorded,
// put the pointer on it and press, through the real ImGui input queue. Calling
// the private draw function instead would prove the panel compiles, not that it
// is reachable.
bool clickTab(forge::desktop::ForgeFrame& frame, const char* panelId) {
  std::size_t which = frame.tabHits().size();
  for (std::size_t i = 0; i < frame.tabHits().size(); ++i) {
    if (frame.tabHits()[i].panelId == panelId) which = i;
  }
  if (which >= frame.tabHits().size()) return false;
  const forge::desktop::TabHit hit = frame.tabHits()[which];
  ImGui::GetIO().AddMousePosEvent(hit.centreX(), hit.centreY());
  step(frame);
  ImGui::GetIO().AddMouseButtonEvent(0, true);
  step(frame);
  ImGui::GetIO().AddMouseButtonEvent(0, false);
  step(frame);
  step(frame);
  const std::vector<std::string>& drawn = frame.panelIdsDrawn();
  return std::find(drawn.begin(), drawn.end(), std::string(panelId)) != drawn.end();
}

void step(forge::desktop::ForgeFrame& frame) {
  ImGui::NewFrame();
  frame.build(0, 1.0f);
  ImGui::Render();
}

// A writable path for the .fpart this gate saves and reopens. TMPDIR where the
// platform sets one, /tmp otherwise -- and the PROCESS ID in the name, because
// two copies of this gate running at once (two checkouts, two agents, a ctest
// -j) would otherwise write and read one file and each would see the other's
// half-written bytes as its own corruption.
std::string tempPath(const char* leaf) {
  const char* tmp = std::getenv("TMPDIR");
  std::string dir = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!dir.empty() && dir.back() != '/') dir += '/';
  return dir + std::to_string(static_cast<long long>(::getpid())) + "_" + leaf;
}

// A face of the built part, found by what its measured normal actually is.
struct FoundFaces {
  std::uint32_t top = 0;     // planar, +Z
  std::uint32_t bottom = 0;  // planar, -Z
  std::uint32_t side = 0;    // planar, horizontal normal
  std::uint32_t curved = 0;  // not planar: the bore or a corner fillet
  std::size_t planar = 0;
  std::size_t total = 0;
};

FoundFaces findFaces(const forge::ui::MeasureMesh& mesh) {
  FoundFaces out;
  for (std::uint32_t id : mesh.faces()) {
    forge::ui::FaceMeasure f{};
    if (!forge::ui::measureFace(mesh, id, f)) continue;
    ++out.total;
    if (!f.planar) {
      if (out.curved == 0) out.curved = id;
      continue;
    }
    ++out.planar;
    if (f.normal[2] > 0.99 && out.top == 0) out.top = id;
    if (f.normal[2] < -0.99 && out.bottom == 0) out.bottom = id;
    if (std::fabs(f.normal[2]) < 0.01 && out.side == 0) out.side = id;
  }
  return out;
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[drawing_gate] MUTATION %d ACTIVE\n", g_mutation);

  // ── the real part ────────────────────────────────────────────────────────
  forge::desktop::KernelScene scene;
  const bool built = scene.build();
  check(built, "the kernel built the starting part", scene.error());
  if (!built) {
    std::printf("[drawing_gate] cannot continue without geometry\n");
    return 1;
  }

  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();
  step(frame);

  const forge::ui::MeasureMesh& mesh = frame.measureMesh();
  const forge::ui::MeshMeasure& model = frame.modelMeasure();
  check(mesh.triangleCount() > 0, "the part tessellated into real triangles", "");
  check(model.box.valid, "the part has a measured bounding box", "");
  std::printf("[drawing_gate] part: %zu triangles, %zu faces, box %.3f x %.3f x %.3f mm\n",
              mesh.triangleCount(), model.faces, model.box.size(0), model.box.size(1),
              model.box.size(2));

  const FoundFaces faces = findFaces(mesh);
  std::printf("[drawing_gate] faces: %zu total, %zu planar; top=%u bottom=%u side=%u curved=%u\n",
              faces.total, faces.planar, faces.top, faces.bottom, faces.side, faces.curved);
  check(faces.top != 0, "the part has a flat top face", "");
  check(faces.bottom != 0, "the part has a flat bottom face", "");
  check(faces.side != 0, "the part has a flat upright face", "");
  check(faces.curved != 0, "the part has a curved face (the bore or a fillet)", "");

  // ══ 1. A VIEW IS SIZED FROM THE PART ════════════════════════════════════
  {
    const forge::desktop::ForgeFrame::DrawingLayout& layout = frame.drawingLayout();
    check(layout.modelBuilt, "the drawing found a built model to measure", "");
    check(layout.sheet != nullptr, "the document names a sheet this build has", "");
    checkEq(static_cast<long long>(layout.views.size()), forge::ui::kNamedViewCount,
            "every standard view is listed");

    // The reference is the box MeasureModel computed from the same triangles --
    // an independent derivation, not this file's opinion.
    const double sx = model.box.size(0);
    const double sy = model.box.size(1);
    const double sz = model.box.size(2);
    for (const forge::ui::DrawingView& v : layout.views) {
      if (v.view == forge::ui::NamedView::Front) {
        checkNear(v.extent.widthMm, sx, 1e-6, "the front view is as wide as the part is in X");
        checkNear(v.extent.heightMm, sz, 1e-6, "the front view is as tall as the part is in Z");
        checkNear(v.extent.depthMm, sy, 1e-6, "the front view is as deep as the part is in Y");
      }
      if (v.view == forge::ui::NamedView::Top) {
        checkNear(v.extent.widthMm, sx, 1e-6, "the top view is as wide as the part is in X");
        checkNear(v.extent.heightMm, sy, 1e-6, "the top view is as deep as the part is in Y");
      }
      if (v.view == forge::ui::NamedView::Right) {
        checkNear(v.extent.widthMm, sy, 1e-6, "the side view is as wide as the part is in Y");
        checkNear(v.extent.heightMm, sz, 1e-6, "the side view is as tall as the part is in Z");
      }
      check(v.extent.points == mesh.triangleCount() * 3,
            "every vertex of the part was projected, not just its box corners", "");
    }
    // The projection group is the front beside the side and above the top.
    checkNear(layout.groupWidthMm, sx + sy, 1e-6, "the view group is front + side wide");
    checkNear(layout.groupHeightMm, sz + sy, 1e-6, "the view group is front + top tall");
  }

  // ══ 2. THE SCALE IS THE LARGEST THAT FITS ═══════════════════════════════
  {
    const forge::desktop::ForgeFrame::DrawingLayout& layout = frame.drawingLayout();
    check(layout.scale.ok, "a scale was chosen", layout.scale.reason);
    check(layout.scale.fits, "the chosen scale fits the sheet", "");
    const forge::ui::Scale chosen =
        g_mutation == 6 ? forge::ui::Scale{1, 1} : layout.scale.scale;
    std::printf("[drawing_gate] sheet %s, drawable %.0f x %.0f mm, views %.2f x %.2f mm, scale %s\n",
                layout.sheet == nullptr ? "?" : layout.sheet->label.c_str(),
                layout.scale.drawableWidthMm, layout.scale.drawableHeightMm,
                layout.groupWidthMm, layout.groupHeightMm, chosen.text().c_str());
    // EVERY LARGER RUNG MUST OVERRUN. This is what makes it "the largest that
    // fits" rather than merely "a scale that fits".
    bool everyLargerOverruns = true;
    bool sawChosen = false;
    for (const forge::ui::Scale& s : forge::ui::standardScales()) {
      if (s == chosen) {
        sawChosen = true;
        break;
      }
      const double w = layout.groupWidthMm * s.factor();
      const double h = layout.groupHeightMm * s.factor();
      if (w <= layout.scale.drawableWidthMm && h <= layout.scale.drawableHeightMm) {
        everyLargerOverruns = false;
        std::printf("        %s would also have fitted (%.1f x %.1f mm)\n", s.text().c_str(), w,
                    h);
      }
    }
    check(sawChosen, "the chosen scale is on the published ladder", chosen.text());
    check(everyLargerOverruns, "no larger standard scale would have fitted", chosen.text());
    // and the drawn size really is the part times the ratio
    checkNear(layout.scale.paperWidthMm, layout.groupWidthMm * layout.scale.scale.factor(), 1e-9,
              "the drawn size is the part size times the scale");
  }

  // ══ 3. CHANGING THE SHEET CHANGES THE ANSWER ════════════════════════════
  {
    // MUTATION 5: the layout is read ONCE, before the sheet changes, and the
    // stale copy is compared -- which is exactly what a cache missing a witness
    // would hand a panel.
    const forge::desktop::ForgeFrame::DrawingLayout beforeCopy = frame.drawingLayout();
    frame.drawing().titleBlock().sheetId = "A4";
    const forge::desktop::ForgeFrame::DrawingLayout afterCopy =
        g_mutation == 5 ? beforeCopy : frame.drawingLayout();
    check(afterCopy.sheet != nullptr && afterCopy.sheet->id == "A4",
          "the layout followed the sheet the user chose", "");
    check(afterCopy.scale.drawableWidthMm < beforeCopy.scale.drawableWidthMm,
          "a smaller sheet has a smaller drawing area", "");
    check(afterCopy.scale.scale.factor() <= beforeCopy.scale.scale.factor(),
          "a smaller sheet cannot take a larger scale", "");
    frame.drawing().titleBlock().sheetId = "A3";
    check(frame.drawingLayout().sheet != nullptr && frame.drawingLayout().sheet->id == "A3",
          "and back again", "");
  }

  // ══ 4/5. THE TOLERANCES ═════════════════════════════════════════════════
  {
    // Datum A on the top face. MUTATION 2 puts it on the bore instead, which is
    // curved and cannot be a datum plane.
    frame.clickFace(g_mutation == 2 ? faces.curved : faces.top, false);
    const bool datumAdded = frame.drawingAddDatum();
    check(datumAdded, "datum A was placed on the picked face", frame.drawingRefusal());
    checkProse(frame.drawingRefusal(), "datum refusal prose");
    checkEq(static_cast<long long>(frame.drawing().datums().size()), 1, "the drawing has one datum");

    // ── FLATNESS on a flat face: measured, and it passes ─────────────────
    // MUTATION 1 places it on the bore instead.
    frame.clickFace(g_mutation == 1 ? faces.curved : faces.side, false);
    if (g_mutation == 3) frame.clickFace(9999, false);  // a face that is not there
    check(frame.drawingAddControl(forge::ui::GdtCharacteristic::Flatness, 0.05, 0.0,
                                  forge::ui::ControlledFeatureKind::PlanarSurface,
                                  forge::ui::MaterialModifier::RegardlessOfFeatureSize, {}),
          "a flatness control was added", frame.drawingRefusal());
    check(!frame.drawing().frames().empty(), "the drawing holds the control", "");
    if (!frame.drawing().frames().empty()) {
      const forge::desktop::GdtVerdict v = frame.gdtVerdict(frame.drawing().frames().back());
      checkProse(v.legality, "flatness legality prose");
      checkProse(v.refusal, "flatness refusal prose");
      check(v.legal, "the flatness frame is a legal control", v.legality);
      check(v.targetFound, "the face it controls is in the built part", v.refusal);
      check(v.facePlanar, "the face it controls is flat", v.refusal);
      check(v.measured, "flatness on a flat face is MEASURED", v.refusal);
      check(v.samples >= 3, "it was measured over real points", "");
      // The modelled face is a plane, so its tessellation lies in that plane and
      // the peak-to-valley band is zero to floating-point noise. That is the
      // truthful answer for a nominal model, and it is checked as a NUMBER
      // rather than assumed.
      checkNear(v.deviationMm, 0.0, 1e-6, "a modelled flat face measures flat");
      checkNear(v.allowedMm, 0.05, 1e-12, "the allowed zone is the tolerance");
      check(v.pass, "and it is within tolerance", "");
    }

    // ── PERPENDICULARITY of an upright face to the top: measured, passes ──
    frame.clickFace(faces.side, false);
    check(frame.drawingAddControl(forge::ui::GdtCharacteristic::Perpendicularity, 0.1, 0.0,
                                  forge::ui::ControlledFeatureKind::PlanarSurface,
                                  forge::ui::MaterialModifier::RegardlessOfFeatureSize, {'A'}),
          "a perpendicularity control was added", frame.drawingRefusal());
    if (!frame.drawing().frames().empty()) {
      const forge::desktop::GdtVerdict v = frame.gdtVerdict(frame.drawing().frames().back());
      checkProse(v.refusal, "perpendicularity refusal prose");
      check(v.legal, "the perpendicularity frame is legal", v.legality);
      check(v.haveAngle, "the angle to the datum was measured", "");
      checkNear(v.nominalAngleDeg, 90.0, 0.01, "the upright face IS square to the top face");
      check(v.measured, "perpendicularity between two flat faces is MEASURED", v.refusal);
      check(v.pass, "and it is within tolerance", "");
    }

    // ── PARALLELISM of the bottom face to the top: measured, passes ───────
    frame.clickFace(faces.bottom, false);
    check(frame.drawingAddControl(forge::ui::GdtCharacteristic::Parallelism, 0.1, 0.0,
                                  forge::ui::ControlledFeatureKind::PlanarSurface,
                                  forge::ui::MaterialModifier::RegardlessOfFeatureSize, {'A'}),
          "a parallelism control was added", frame.drawingRefusal());
    if (!frame.drawing().frames().empty()) {
      const forge::desktop::GdtVerdict v = frame.gdtVerdict(frame.drawing().frames().back());
      check(v.measured, "parallelism between two flat faces is MEASURED", v.refusal);
      checkNear(v.nominalAngleDeg, 0.0, 0.01, "the bottom face IS parallel to the top face");
      checkNear(v.deviationMm, 0.0, 1e-6, "a modelled parallel face measures parallel");
      check(v.pass, "and it is within tolerance", "");
    }

    // ── A CALL-OUT THAT CONTRADICTS THE MODEL ────────────────────────────
    // Perpendicularity of the bottom face to the top face: the model has them
    // PARALLEL. The right answer is not a zero, it is a sentence naming both
    // angles, and it must not claim to have measured anything.
    frame.clickFace(faces.bottom, false);
    check(frame.drawingAddControl(forge::ui::GdtCharacteristic::Perpendicularity, 0.1, 0.0,
                                  forge::ui::ControlledFeatureKind::PlanarSurface,
                                  forge::ui::MaterialModifier::RegardlessOfFeatureSize, {'A'}),
          "a contradicting control was added", frame.drawingRefusal());
    if (!frame.drawing().frames().empty()) {
      const forge::desktop::GdtVerdict v = frame.gdtVerdict(frame.drawing().frames().back());
      checkProse(v.refusal, "contradiction prose");
      check(!v.measured, "a control the model contradicts is NOT reported as measured", "");
      check(v.refusal.find("90.00") != std::string::npos,
            "the refusal names the angle the control calls for", v.refusal);
      check(v.refusal.find("0.00") != std::string::npos,
            "and the angle the model actually has", v.refusal);
      frame.drawingRemoveControl(frame.drawing().frames().back().id);
    }

    // ── CIRCULARITY on the bore: REFUSED, not measured off the facets ────
    frame.clickFace(faces.curved, false);
    check(frame.drawingAddControl(forge::ui::GdtCharacteristic::Circularity, 0.02, 0.0,
                                  forge::ui::ControlledFeatureKind::CylinderSurface,
                                  forge::ui::MaterialModifier::RegardlessOfFeatureSize, {}),
          "a circularity control was added to the bore", frame.drawingRefusal());
    if (!frame.drawing().frames().empty()) {
      const forge::desktop::GdtVerdict v = frame.gdtVerdict(frame.drawing().frames().back());
      checkProse(v.refusal, "circularity refusal prose");
      check(v.legal, "circularity on a round surface is a legal control", v.legality);
      check(v.targetFound, "the bore face is in the built part", v.refusal);
      check(!v.facePlanar, "the bore face is correctly seen as curved", "");
      check(!v.measured, "roundness is NOT measured off the display approximation", "");
      check(!v.refusal.empty(), "and the reason is given in full", "");
      checkNear(v.deviationMm, 0.0, 1e-12, "a refused control reports no deviation at all");
      frame.drawingRemoveControl(frame.drawing().frames().back().id);
    }

    // ── AN ILLEGAL FRAME, caught by the kernel's own Y14.5 checker ───────
    // Cylindricity applies to a round surface. Applied to a flat one it is not a
    // legal control, and the reason comes from forge::native::gdt, TRANSLATED.
    frame.clickFace(faces.side, false);
    check(frame.drawingAddControl(forge::ui::GdtCharacteristic::Cylindricity, 0.05, 0.0,
                                  forge::ui::ControlledFeatureKind::PlanarSurface,
                                  forge::ui::MaterialModifier::RegardlessOfFeatureSize, {}),
          "an illegal frame can still be authored", frame.drawingRefusal());
    if (!frame.drawing().frames().empty()) {
      const forge::desktop::GdtVerdict v = frame.gdtVerdict(frame.drawing().frames().back());
      check(!v.legal, "the kernel's Y14.5 checker refused the frame", "");
      check(!v.legality.empty(), "and the refusal is a sentence", "");
      checkProse(v.legality, "illegal-frame prose");
      // The evaluator's own wording must NOT be what the user reads.
      check(v.legality != v.internalDetail, "the panel shows a translation, not the raw answer",
            v.internalDetail);
      frame.drawingRemoveControl(frame.drawing().frames().back().id);
    }

    // ── A CONTROL WHOSE FACE HAS GONE ────────────────────────────────────
    {
      forge::ui::FeatureControlFrame ghost;
      ghost.id = "ghost";
      ghost.characteristic = forge::ui::GdtCharacteristic::Flatness;
      ghost.toleranceMm = 0.05;
      ghost.target.bodyId = "body";
      ghost.target.kind = forge::ui::EntityKind::Face;
      ghost.target.persistentName = "face@99999";
      const forge::desktop::GdtVerdict v = frame.gdtVerdict(ghost);
      check(!v.targetFound, "a control on a face that is gone says so", "");
      check(!v.measured, "and measures nothing", "");
      checkProse(v.refusal, "missing-face prose");
    }
  }

  // ══ 6. NOTES ON REAL GEOMETRY ═══════════════════════════════════════════
  {
    frame.clickFace(faces.top, false);
    check(frame.drawingAddNote("break sharp edges", forge::ui::AnnotationKind::Leader,
                               forge::ui::NamedView::Front, true),
          "a note was attached to the picked face", frame.noteRefusal());
    check(!frame.drawingAddNote("   ", forge::ui::AnnotationKind::Note,
                                forge::ui::NamedView::Front, false),
          "a blank note is refused", "");
    checkProse(frame.noteRefusal(), "blank note prose");
    checkEq(static_cast<long long>(frame.drawing().annotations().size()), 1,
            "the drawing holds exactly the note that was accepted");
    if (!frame.drawing().annotations().empty()) {
      const forge::ui::Annotation& a = frame.drawing().annotations().front();
      check(a.attached(), "the note points at a face", "");
      checkEq(forge::desktop::faceIdOfRef(a.target), faces.top,
              "and it is the face that was picked");
      forge::ui::FaceMeasure f{};
      check(forge::ui::measureFace(mesh, forge::desktop::faceIdOfRef(a.target), f),
            "that face is measurable in the part that is built now", "");
    }
  }

  // ══ 7. THE TITLE BLOCK ══════════════════════════════════════════════════
  {
    frame.drawing().titleBlock().revision = "B";
    const std::vector<forge::ui::TitleBlockField> rows = frame.titleBlockRows();
    check(rows.size() >= 12, "the title block has its rows", "");
    std::string partSize;
    std::string scaleRow;
    std::size_t unset = 0;
    for (const forge::ui::TitleBlockField& r : rows) {
      checkProse(r.value, "title block value");
      checkProse(r.origin, "title block origin");
      check((r.source == forge::ui::FieldSource::Unset) == r.value.empty(),
            "an unset row is empty and an empty row is unset", r.label);
      if (r.source == forge::ui::FieldSource::Unset) ++unset;
      if (r.key == "part_size") partSize = r.value;
      if (r.key == "scale") scaleRow = r.value;
      if (r.key == "revision") check(r.value == "B", "the revision is the one typed", r.value);
      if (r.key == "units") {
        check(r.value.find("millimetre") != std::string::npos,
              "the units row names the unit the document stores", r.value);
      }
    }
    // The part size row must be the MEASURED box, to the digit.
    char expect[96];
    std::snprintf(expect, sizeof(expect), "%.2f x %.2f x %.2f mm", model.box.size(0),
                  model.box.size(1), model.box.size(2));
    check(partSize == std::string(expect), "the part size row is the measured bounding box",
          partSize + " vs " + expect);
    check(scaleRow.find(frame.drawingLayout().scale.scale.text()) == 0,
          "the scale row is the scale that was chosen", scaleRow);
    check(unset >= 4, "rows the document has no value for stay empty", "");
    std::printf("[drawing_gate] title block: %zu rows, %zu still unset, part size %s, scale %s\n",
                rows.size(), unset, partSize.c_str(), scaleRow.c_str());
  }

  // ══ 8. THE PANELS DRAW IT ═══════════════════════════════════════════════
  {
    std::string why;
    check(shell.setWorkspace(forge::ui::WorkspaceProfile::Drawing),
          "the Drawing workspace opened", why);
    step(frame);
    const std::vector<std::string>& drawn = frame.panelIdsDrawn();
    const auto drew = [&drawn](const char* id) {
      return std::find(drawn.begin(), drawn.end(), std::string(id)) != drawn.end();
    };
    check(drew("title_block"), "the Title Block panel was drawn", "");
    check(drew("annotation"), "the Annotations panel was drawn", "");
    check(frame.titleBlockRowsDrawn() >= 12, "the title block drew a row per field", "");
    checkEq(static_cast<long long>(frame.annotationRowsDrawn()),
            static_cast<long long>(frame.drawing().annotations().size()),
            "the annotations panel drew a row per note");

    // The View List and the GD&T panels share their groups with another tab, so
    // they come up the way a user brings them up: by clicking the tab.
    check(clickTab(frame, "view_list"), "clicking the tab brought the View List up", "");
    checkEq(static_cast<long long>(frame.viewListRowsDrawn()), forge::ui::kNamedViewCount,
            "the view list drew a row per view");
    check(clickTab(frame, "gdt"), "clicking the tab brought the GD&T panel up", "");
    check(frame.gdtRowsDrawn() >=
              frame.drawing().datums().size() + frame.drawing().frames().size(),
          "it drew a row per datum and per control", "");
    std::printf("[drawing_gate] panels: title %zu rows, views %zu rows, notes %zu rows, "
                "tolerances %zu rows\n",
                frame.titleBlockRowsDrawn(), frame.viewListRowsDrawn(),
                frame.annotationRowsDrawn(), frame.gdtRowsDrawn());
    check(frame.layoutReseatsDuringWalk() == 0,
          "no drawing panel re-seated the dock layout while it was being walked", "");
  }

  // ══ 9. THE DRAWING IS PART OF THE DOCUMENT ══════════════════════════════
  {
    // MUTATION 4 saves an EMPTY drawing, which is what forgetting to pass it
    // through capturePartDocument would do.
    const forge::ui::DrawingModel empty;
    const forge::desktop::PartFileDoc file = forge::desktop::capturePartDocument(
        frame.document(), "bracket", g_mutation == 4 ? empty : frame.drawing());
    const std::string text = forge::desktop::writePartFile(file);
    check(text.rfind("FORGE-PART ", 0) == 0, "the file starts with the format's own magic", "");

    const std::string path = tempPath("forge_drawing_gate.fpart");
    std::string err;
    check(forge::desktop::savePartFile(path, file, err), "the document saved to a real file", err);
    forge::desktop::PartFileDoc back;
    check(forge::desktop::loadPartFile(path, back, err), "and read back", err);
    check(forge::desktop::writePartFile(back) == text,
          "write(read(x)) == x, byte for byte, with the drawing in it", "");
    checkEq(static_cast<long long>(back.drawing.annotations().size()),
            static_cast<long long>(frame.drawing().annotations().size()),
            "every note survived the round trip");
    checkEq(static_cast<long long>(back.drawing.datums().size()),
            static_cast<long long>(frame.drawing().datums().size()),
            "every datum survived the round trip");
    checkEq(static_cast<long long>(back.drawing.frames().size()),
            static_cast<long long>(frame.drawing().frames().size()),
            "every geometric tolerance survived the round trip");
    check(back.drawing.titleBlock() == frame.drawing().titleBlock(),
          "and so did every title block field", "");
    if (!back.drawing.annotations().empty() && !frame.drawing().annotations().empty()) {
      check(back.drawing.annotations().front().text == frame.drawing().annotations().front().text,
            "the note came back with its own words", "");
      check(forge::desktop::faceIdOfRef(back.drawing.annotations().front().target) ==
                forge::desktop::faceIdOfRef(frame.drawing().annotations().front().target),
            "and still pointing at the same face", "");
    }
    std::remove(path.c_str());

    // ── the version policy, exercised rather than described ──────────────
    const std::string v1 =
        "FORGE-PART 1\nNAME old\nUNITS mm\n"
        "FEATURE\nID 1\nKIND solid\nOP BOX\nARG num 1\nARG num 2\nARG num 3\nEND\n";
    forge::desktop::PartFileDoc old;
    check(forge::desktop::readPartFile(v1, old, err),
          "a version 1 file written by the shipped app still opens", err);
    checkEq(old.version, 1, "and it is recognised as a version 1 file");
    check(old.drawing.empty(), "an older file opens with an empty drawing, not a made-up one", "");

    forge::desktop::PartFileDoc refused;
    const std::string hybrid =
        "FORGE-PART 1\nNAME old\nUNITS mm\nTITLEBLOCK\nREVISION A\nEND\n";
    check(!forge::desktop::readPartFile(hybrid, refused, err),
          "a version 1 file carrying a later key is refused", err);
    check(err.find("version") != std::string::npos, "and the refusal says why", err);

    check(!forge::desktop::readPartFile("FORGE-PART 2\nNAME x\n", refused, err),
          "a version 2 file belongs to the other document layer and is refused", err);
    check(err.find("document layer") != std::string::npos,
          "and it is told whose it is rather than called corrupt", err);
    check(!forge::desktop::readPartFile("FORGE-PART 99\nNAME x\n", refused, err),
          "an unknown version is refused", err);
    check(forge::desktop::partFileVersionIsReadable(1) &&
              forge::desktop::partFileVersionIsReadable(forge::desktop::kPartFileVersion) &&
              !forge::desktop::partFileVersionIsReadable(2),
          "the accepted set is exactly {1, the current version}", "");
  }

  std::printf("[drawing_gate] %zu checks, %zu failures — %s\n", g_checks, g_failures,
              g_failures == 0 ? "PASS" : "FAIL");
  return g_failures == 0 ? 0 : 1;
}
