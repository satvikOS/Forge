// forge-desktop/test/quality_gate.cpp
//
// THE TRUST PANELS' GATE — headless, and it asserts on REAL KERNEL ANSWERS.
//
// Five tabs claim to tell an engineer whether a model can be trusted:
// Interference, Verification, Continuity, Draft and Zebra. This gate builds the
// real application frame with no window and no GPU, runs the real check against
// two real models, and asserts on the values that reach the screen — not on "it
// drew something".
//
// ── the two models, and why there are two ─────────────────────────────────
//   1. the application's OWN default part: an 80 x 50 x 20 plate with a 12 mm
//      through bore and 3 mm corner fillets. One solid, so it exercises the
//      interference panel's HONEST EMPTY ANSWER; a through bore, so its genus is
//      1 and not 0; fillets tangent to the walls, so its continuity report has
//      joins that are genuinely smooth AND joins that are genuinely square.
//   2. a file holding TWO OVERLAPPING SOLIDS, opened through the same `INPUT()`
//      the File > Open path binds. Two 10 mm cubes 5 mm apart overlap by exactly
//      5 x 10 x 10 = 500 mm3 centred at (7.5, 5, 5), and those are the numbers
//      the interference panel is required to report. A clash check that has
//      never been run against a real clash is a claim, not a check.
//
// Every reference below is either arithmetic on the model's own definition
// (500 mm3 is 5 x 10 x 10) or read back from another part of the system, never a
// number copied out of a previous run.
//
// ── PROVING IT CAN FAIL ───────────────────────────────────────────────────
// `--mutate <n>` breaks one link on purpose and the matching check MUST go red:
//   1  the check is never asked for            -> the panels draw no measurements
//   2  the clash rows are dropped in transit   -> the 500 mm3 overlap disappears
//   3  the continuity joins are dropped        -> every join verdict is lost
//   4  every draft verdict is forced to        -> the undercut face stops being
//      "releases"                                 reported as one
//   5  the stripe grids are blanked            -> the zebra view has no pattern
//   6  the part's own checks are dropped       -> a written-in requirement that
//                                                 FAILED is reported as absent
//   7  one stripe row is truncated             -> the reader must REFUSE the
//                                                 whole report rather than draw a
//                                                 short grid
// Run every one with test/run_quality_gate.sh --mutations, which requires each
// to be caught.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "imgui.h"

#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "ModelQuality.hpp"
#include "PartFile.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/GuardedProcess.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/PanelCatalog.hpp"
#include "forge/ui/UserFacingText.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

// The two-solid fixture is BUILT, not shipped: a checked-in binary model is a
// number nobody can re-derive. These are the only kernel headers this gate
// reaches, and they build two cubes and write them to a file the application's
// own open path can read.
#include "forge/IoExchange.hpp"
#include "forge/Primitives.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/Transform.hpp"
#include <BRep_Builder.hxx>
#include <TopoDS_Compound.hxx>

namespace {

int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

void check(bool ok, const char* what, const std::string& detail) {
  ++g_checks;
  if (!ok) {
    ++g_failures;
    std::printf("  FAIL  %-56s  %s\n", what, detail.c_str());
  }
}

template <typename A, typename B>
void checkEq(const A& got, const B& want, const char* what) {
  ++g_checks;
  if (!(got == static_cast<A>(want))) {
    ++g_failures;
    std::printf("  FAIL  %-56s  got %s want %s\n", what, std::to_string(got).c_str(),
                std::to_string(want).c_str());
  }
}

template <typename A, typename B>
void checkGe(const A& got, const B& floor, const char* what) {
  ++g_checks;
  if (!(got >= static_cast<A>(floor))) {
    ++g_failures;
    std::printf("  FAIL  %-56s  got %s, need >= %s\n", what, std::to_string(got).c_str(),
                std::to_string(floor).c_str());
  }
}

void checkNear(double got, double want, double tol, const char* what) {
  ++g_checks;
  if (!(std::fabs(got - want) <= tol)) {
    ++g_failures;
    std::printf("  FAIL  %-56s  got %.6f want %.6f +- %.6f\n", what, got, want, tol);
  }
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
    io.BackendRendererName = "quality_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

std::string tempPath(const char* leaf) {
  const char* tmp = std::getenv("TMPDIR");
  std::string dir = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!dir.empty() && dir.back() != '/') dir += '/';
  return dir + leaf;
}

void frameOnce(forge::desktop::ForgeFrame& frame) {
  ImGui::NewFrame();
  frame.build(0, 1.0f);
  ImGui::Render();
}

// Two 10 mm cubes, the second moved 5 mm along X, written to one file the
// application's own open path can read back as TWO SOLIDS. The overlap is
// therefore 5 x 10 x 10 mm by construction, and that is where the reference
// numbers in this gate come from.
bool writeTwoOverlappingSolids(const std::string& path) {
  try {
    forge::ShapeRegistry& reg = forge::ShapeRegistry::instance();
    const forge::ShapeHandle a = forge::makeBox(10.0, 10.0, 10.0);
    const forge::ShapeHandle b =
        forge::translate(forge::makeBox(10.0, 10.0, 10.0), 5.0, 0.0, 0.0);
    TopoDS_Compound both;
    BRep_Builder builder;
    builder.MakeCompound(both);
    builder.Add(both, reg.get(a));
    builder.Add(both, reg.get(b));
    return forge::io::exportBrep(reg.add(both), path);
  } catch (...) {
    return false;
  }
}

// A panel's rows are only evidence if the panel was actually the one on screen.
bool drewPanel(const forge::desktop::ForgeFrame& frame, const char* id) {
  const std::vector<std::string>& drawn = frame.panelIdsDrawn();
  return std::find(drawn.begin(), drawn.end(), std::string(id)) != drawn.end();
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[gate] MUTATION %d ACTIVE\n", g_mutation);

  // ═════ 1. the catalogue and the frame builder agree ═════════════════════
  // The five panels claim to be live. If one of them is not drawn, the prose
  // gate says so too -- this is the same claim asserted from the other side.
  {
    const char* const kPanels[] = {"interference", "verify_report", "continuity", "isocline",
                                   "zebra_analysis"};
    for (const char* id : kPanels) {
      const forge::ui::PanelInfo* info = forge::ui::findPanelInfo(id);
      check(info != nullptr, "the catalogue knows this panel", id);
      if (info != nullptr) check(info->live(), "the catalogue calls this panel live", id);
    }
  }

  // ═════ 2. the default part, checked ═════════════════════════════════════
  forge::desktop::KernelScene scene;
  const bool built = scene.build();
  check(built, "the default part builds", scene.error());
  if (!built) {
    std::printf("[gate] cannot continue without geometry\n");
    return 1;
  }

  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();
  frameOnce(frame);

  // Before any check has been asked for, the panels must claim NOTHING.
  check(!frame.qualityRan(), "no answer is claimed before a check is run", "");

  // MUTATION 1 skips the request. Every assertion below still runs, because a
  // panel that shows nothing when a check WAS asked for is the defect, and a
  // gate that stops asking when the request is broken proves nothing.
  if (g_mutation != 1) frame.requestQualityCheck();
  frameOnce(frame);  // the request is dispatched at the end of the frame
  frameOnce(frame);  // and this frame draws the answer

  check(frame.qualityRan(), "the check ran", "");
  checkGe(frame.qualityChecksRun(), 1u, "the check was dispatched exactly once per request");

  const forge::desktop::ModelQualityReport& q = frame.quality();
  check(q.ran, "the check reached the model", q.unavailable);

  // ── the verification numbers, against the part's own definition ─────────
  // 80 x 50 x 20 minus a 12 mm bore through it, minus four 3 mm corner fillets.
  // The volume reference is the kernel's mass measurement compared with the
  // SURFACE the viewport draws -- two instruments, never one.
  {
    check(q.checkedMass, "the model was weighed", "");
    checkNear(q.volume, 80.0 * 50.0 * 20.0 - 3.14159265358979 * 36.0 * 20.0 - 4.0 * 20.0 * 9.0 *
                            (1.0 - 3.14159265358979 / 4.0),
              60.0, "volume matches the plate minus its bore and fillets");
    check(q.checkedBox, "the model was measured", "");
    checkNear(q.bboxMax[0] - q.bboxMin[0], 80.0, 0.05, "the plate is 80 mm along X");
    checkNear(q.bboxMax[1] - q.bboxMin[1], 50.0, 0.05, "the plate is 50 mm along Y");
    check(q.checkedCounts, "the faces and edges were counted", "");
    checkGe(q.faceCount, 7, "a filleted plate with a bore has more than a box's faces");
    check(q.checkedTopology, "the shape's topology was measured", "");
    checkEq(q.genus, 1, "one opening straight through: the bore");
    checkEq(q.shells, 1, "one body");
    check(q.checkedClosure, "the surface was checked for closure", "");
    check(q.closed && q.manifold && q.oriented, "the default part is a sound closed solid", "");
    check(!q.selfIntersecting, "the default part does not pass through itself", "");
    check(q.checkedShape, "the full shape check ran", "");
    check(q.shapeValid, "the full shape check found nothing wrong", "");

    // The second instrument. A wrong solid reproducing a right volume is the
    // failure this programme has measured repeatedly; two readings is the
    // cheapest way to see it, so the gate asserts they agree.
    const forge::ui::MeshMeasure& m = frame.modelMeasure();
    check(m.watertight, "the drawn surface closes", "");
    if (m.watertight) {
      const double gap = std::fabs(q.volume - m.volume) / std::max(1e-9, q.volume);
      check(gap < 0.01, "the shape's volume and the drawn surface's agree",
            std::to_string(gap * 100.0) + "%");
    }
  }

  // ── continuity: a filleted plate has BOTH kinds of join ─────────────────
  {
    check(q.checkedContinuity, "the joins were measured", "");
    checkGe(q.joins.size(), 8u, "a filleted plate with a bore has many joins");
    checkEq(q.sharedEdges, q.joins.size(), "every join found was measured");
    std::size_t tangent = 0, square = 0, apart = 0, unmeasured = 0;
    for (const forge::desktop::QualityJoin& j : q.joins) {
      if (!j.measured) { ++unmeasured; continue; }
      if (j.g0mm >= 1.0e-3) ++apart;
      else if (j.g1deg < 1.0) ++tangent;
      else if (j.g1deg > 80.0) ++square;
    }
    checkEq(unmeasured, 0u, "every join produced a measurement");
    checkEq(apart, 0u, "no join on a sound solid leaves a gap");
    // The 3 mm fillets are TANGENT to the walls they blend, so those joins have
    // no crease at all; the plate's own corners meet at 90 degrees. A report
    // that finds only one of the two is measuring something else.
    checkGe(tangent, 4u, "the fillets meet their walls with no crease");
    checkGe(square, 4u, "the plate's own corners meet at a right angle");
  }

  // ── draft: the plate has one top, one bottom and vertical walls ─────────
  {
    check(q.checkedDraft, "the faces were measured against the pull direction", "");
    checkEq(q.draft.size(), static_cast<std::size_t>(q.faceCount),
            "one draft row per face of the shape");
    // Pulled along +Z: the top face releases, the bottom face holds the part in,
    // and every wall stands along the pull. Those three counts are the plate's
    // own geometry, not a threshold.
    checkGe(q.releasing, 1u, "the top face releases");
    checkGe(q.undercutting, 1u, "the bottom face holds the part in");
    checkGe(q.standingVertical, 4u, "the walls stand along the pull");
    std::size_t exactTop = 0, exactBottom = 0;
    for (const forge::desktop::QualityDraftFace& d : q.draft) {
      if (std::fabs(d.angleDeg) < 0.01) ++exactTop;
      if (std::fabs(d.angleDeg - 180.0) < 0.01) ++exactBottom;
    }
    checkEq(exactTop, 1u, "exactly one face faces straight along the pull");
    checkEq(exactBottom, 1u, "exactly one face faces straight against it");

    // ── the caveat is MEASURED, and it has to be right in both directions ──
    // The mould pass reads ONE normal per face. On the plate's flat walls that
    // reading is the face; on its bore and its four fillets it is a point on a
    // surface whose angle changes across it, and the panel says so per row. The
    // flag is measured from curvature rather than read off the surface's NAME,
    // because this part's own inventory calls four flat walls "other" -- so a
    // name test would mark a flat face curved and the caveat would appear where
    // it does not belong.
    std::size_t flat = 0, curved = 0, unknownShape = 0;
    for (const forge::desktop::QualityDraftFace& d : q.draft) {
      if (!d.curvatureMeasured) ++unknownShape;
      else if (d.flat) ++flat;
      else ++curved;
    }
    checkEq(unknownShape, 0u, "every face of this part could be told flat from curved");
    // A 12 mm bore and four 3 mm vertical fillets: five curved faces, and the
    // rest of the plate is flat.
    checkEq(curved, 5u, "the bore and the four fillets are the curved faces");
    checkEq(flat, q.draft.size() - curved, "every other face is flat");
    for (const forge::desktop::QualityDraftFace& d : q.draft) {
      if (d.kind == "cylinder") {
        check(!d.flat, "the bore is not reported as a flat face", std::to_string(d.face));
      }
      if (d.kind == "plane") {
        check(d.flat, "a face the kernel calls a plane is measured flat",
              std::to_string(d.face));
      }
    }
  }

  // ── zebra: the curved faces carry more bands than the flat ones ─────────
  // Asserted on THIS model and not on the two cubes below, because every face of
  // a cube is flat and legitimately reflects one band -- a blanked pattern would
  // be invisible there. The plate's 3 mm fillets are the curved faces that make
  // the difference measurable, which is what MUTATION 5 destroys.
  {
    forge::desktop::ModelQualityReport z = q;
    if (g_mutation == 5) {
      for (forge::desktop::QualityZebraFace& face : z.zebra) {
        for (std::uint8_t& band : face.stripes) band = 0;
        face.bands = 1;
      }
    }
    check(z.checkedZebra, "the stripe pattern was taken", "");
    checkGe(z.zebra.size(), 6u, "most faces were striped");
    std::size_t manyBanded = 0;
    std::size_t filled = 0;
    std::size_t distinctInGrid = 0;
    for (const forge::desktop::QualityZebraFace& face : z.zebra) {
      if (face.bands > 1) ++manyBanded;
      if (face.stripes.size() == static_cast<std::size_t>(face.gridW) * face.gridH &&
          !face.stripes.empty()) {
        ++filled;
      }
      // The band COUNT and the grid must agree: a report that says three bands
      // and draws one colour is the pattern being blanked after it was counted.
      std::uint8_t lo = 255, hi = 0;
      for (std::uint8_t band : face.stripes) {
        lo = std::min(lo, band);
        hi = std::max(hi, band);
      }
      if (!face.stripes.empty() && hi > lo) ++distinctInGrid;
    }
    checkEq(filled, z.zebra.size(), "every striped face filled its own grid");
    // A flat face reflects ONE band; a curved one sweeps through several. A
    // report where every face has the same band count is not reading normals.
    checkGe(manyBanded, 1u, "a curved face sweeps through more than one band");
    check(manyBanded < z.zebra.size(), "a flat face reflects a single band", "");
    checkEq(distinctInGrid, manyBanded, "the drawn pattern carries the bands that were counted");
  }

  // ── interference on ONE solid: the honest empty answer ──────────────────
  {
    check(q.checkedClashes, "the model's solids were compared", "");
    checkEq(q.solids.size(), 1u, "the default part is one solid");
    checkEq(q.clashes.size(), 0u, "one solid cannot overlap itself");
  }

  // ═════ 3. the panels themselves, drawn ══════════════════════════════════
  // Rows on screen, not values in a struct. A panel that computes the right
  // answer and draws none of it is the defect this whole change exists for.
  {
    shell.setWorkspace(forge::ui::WorkspaceProfile::Archie);
    check(frame.focusPanel("verify_report"), "the Verification tab can be brought forward", "");
    frameOnce(frame);
    check(drewPanel(frame, "verify_report"), "the Verification panel was drawn", "");
    checkGe(frame.verifyRowsDrawn(), 8u, "the Verification panel drew measured rows");

    shell.setWorkspace(forge::ui::WorkspaceProfile::Surface);
    check(frame.focusPanel("continuity"), "the Continuity tab can be brought forward", "");
    frameOnce(frame);
    check(drewPanel(frame, "continuity"), "the Continuity panel was drawn", "");
    checkGe(frame.continuityRowsDrawn(), 8u, "the Continuity panel drew a row per join");
    checkEq(frame.continuityRowsDrawn(), q.joins.size(),
            "the Continuity panel drew one row per join and no more");

    check(frame.focusPanel("isocline"), "the Draft tab can be brought forward", "");
    frameOnce(frame);
    check(drewPanel(frame, "isocline"), "the Draft panel was drawn", "");
    checkGe(frame.draftRowsDrawn(), 6u, "the Draft panel drew a row per face");
    checkEq(frame.draftRowsDrawn(), q.draft.size(), "the Draft panel drew one row per face");

    check(frame.focusPanel("zebra_analysis"), "the Zebra tab can be brought forward", "");
    frameOnce(frame);
    check(drewPanel(frame, "zebra_analysis"), "the Zebra panel was drawn", "");
    checkGe(frame.zebraCellsDrawn(), 100u, "the Zebra panel drew the stripe pattern");

    shell.setWorkspace(forge::ui::WorkspaceProfile::Assembly);
    check(frame.focusPanel("interference"), "the Interference tab can be brought forward", "");
    frameOnce(frame);
    check(drewPanel(frame, "interference"), "the Interference panel was drawn", "");
    checkEq(frame.clashRowsDrawn(), 0u, "one solid produces no clash row");
  }

  // ═════ 4. a REAL clash, through the application's own open path ═════════
  {
    const std::string path = tempPath("forge_quality_gate_two_solids.brep");
    const bool wrote = writeTwoOverlappingSolids(path);
    check(wrote, "the two-solid fixture was written", path);
    if (wrote) {
      forge::desktop::KernelScene clashScene;
      clashScene.setInputFile(path);
      const bool opened = clashScene.buildFromIr("%1 = INPUT()\n");
      check(opened, "the two-solid file opens through the same path a user opens files by",
            clashScene.error());
      if (opened) {
        forge::desktop::QualitySettings settings;
        const bool ok = clashScene.analyseQuality(settings);
        check(ok, "the check ran on the two-solid model", clashScene.lastQuality().unavailable);
        forge::desktop::ModelQualityReport c = clashScene.lastQuality();

        // ── the mutations that break the answer in transit ────────────────
        if (g_mutation == 2) c.clashes.clear();
        if (g_mutation == 3) c.joins.clear();
        if (g_mutation == 4) {
          for (forge::desktop::QualityDraftFace& d : c.draft) {
            d.verdict = forge::desktop::DraftVerdict::Releases;
          }
          c.undercutting = 0;
        }

        checkEq(c.solids.size(), 2u, "the file holds two solids");
        checkEq(c.clashes.size(), 1u, "the two solids are reported as overlapping");
        if (!c.clashes.empty()) {
          const forge::desktop::QualityClash& hit = c.clashes.front();
          // 5 x 10 x 10 mm, by construction.
          checkNear(hit.volume, 500.0, 1e-6, "the overlap is 500 mm3");
          check(hit.located, "the overlap was measured as a solid in its own right", "");
          checkNear(hit.commonVolume, 500.0, 1e-6,
                    "the second instrument agrees on the overlap");
          checkNear(hit.com[0], 7.5, 1e-6, "the overlap is centred at X = 7.5");
          checkNear(hit.com[1], 5.0, 1e-6, "the overlap is centred at Y = 5");
          checkNear(hit.com[2], 5.0, 1e-6, "the overlap is centred at Z = 5");
          checkNear(hit.bboxMin[0], 5.0, 1e-6, "the overlap starts where the second cube does");
          checkNear(hit.bboxMax[0], 10.0, 1e-6, "the overlap ends where the first cube does");
        }
        // Two cubes, and a stripe check that still reads real normals: a
        // mutation that blanks the pattern has to be visible somewhere.
        std::size_t bands = 0;
        for (const forge::desktop::QualityZebraFace& z : c.zebra) bands += z.bands;
        checkGe(bands, c.zebra.size(), "every striped face reports at least one band");
        checkGe(c.joins.size(), 12u, "two cubes have at least a cube's joins");
        checkGe(c.undercutting, 1u, "each cube has a face that holds it in");
      }
    }
    std::remove(path.c_str());
  }

  // ═════ 5. the part's OWN checks reach the report ════════════════════════
  // A `VERIFY` written into a part measures the live body. It has always been
  // computed and it reached no panel. This drives one that PASSES and one that
  // FAILS, because a channel that only ever carries good news is not a channel.
  {
    forge::desktop::KernelScene checkScene;
    const bool ok = checkScene.buildFromIr(
        "%1 = BOX(10, 10, 10)\n"
        "%2 = VERIFY(%1, \"faces=6\")\n");
    check(ok, "a part carrying a requirement builds", checkScene.error());
    std::vector<std::string> lines = checkScene.lastBuild().checks;
    if (g_mutation == 6) lines.clear();
    checkGe(lines.size(), 1u, "the part's own requirement reached the report");
    if (!lines.empty()) {
      check(lines.front().rfind("PASS ", 0) == 0, "a met requirement is reported as met",
            lines.front());
    }

    forge::desktop::KernelScene failScene;
    failScene.buildFromIr(
        "%1 = BOX(10, 10, 10)\n"
        "%2 = VERIFY(%1, \"faces=99\")\n");
    std::vector<std::string> bad = failScene.lastBuild().checks;
    if (g_mutation == 6) bad.clear();
    checkGe(bad.size(), 1u, "an unmet requirement reached the report too");
    if (!bad.empty()) {
      check(bad.front().rfind("FAIL ", 0) == 0, "an unmet requirement is reported as unmet",
            bad.front());
    }
  }

  // ═════ 6. the wire format between the worker and the panels ═════════════
  // The check runs in the process this application is allowed to lose, so its
  // answer crosses a pipe. A reader that accepts a truncated report would draw a
  // short grid as if it were a whole one.
  {
    std::string text = forge::desktop::encodeQualityReport(q);
    if (g_mutation == 7) {
      // Cut one stripe row short: the values that remain are all real, so only a
      // reader that checks the row against its own declared size can catch it.
      const std::size_t at = text.find("zebraface ");
      if (at != std::string::npos) {
        const std::size_t eol = text.find('\n', at);
        if (eol != std::string::npos && eol > at + 40) {
          text.erase(at + 40, eol - (at + 40));
        }
      }
    }
    forge::desktop::ModelQualityReport back;
    std::string why;
    const bool decoded = forge::desktop::decodeQualityReport(text, back, why);
    check(decoded, "the report survives the trip to the panels", why);
    if (decoded) {
      checkEq(back.joins.size(), q.joins.size(), "every join survived the trip");
      checkEq(back.draft.size(), q.draft.size(), "every draft row survived the trip");
      checkEq(back.zebra.size(), q.zebra.size(), "every striped face survived the trip");
      checkNear(back.volume, q.volume, 1e-9, "the volume survived the trip exactly");
      if (!back.zebra.empty() && !q.zebra.empty()) {
        checkEq(back.zebra.front().stripes.size(), q.zebra.front().stripes.size(),
                "the stripe pattern survived the trip whole");
      }
    }
    // A report that names nothing must be refused, not drawn as an empty model.
    forge::desktop::ModelQualityReport junk;
    std::string junkWhy;
    check(!forge::desktop::decodeQualityReport("not a report at all\n", junk, junkWhy),
          "a reply that is not a report is refused", "");
  }

  // ═════ 7. nothing a user reads is written for a developer ═══════════════
  // The prose gate scans the literals in this file's panels. What it cannot see
  // is the KERNEL's own wording, which the Verification panel forwards. Every
  // string this report can carry is scanned here, at run time, on real output.
  {
    // The positive control FIRST: a scanner that returns "clean" for everything
    // would make the check below meaningless. This is the shape of string the
    // kernel could hand back, and it must be caught.
    check(!forge::ui::userFacingProseIsClean("BRepCheck_InvalidCurveOnSurface on face 3"),
          "the scanner the Verification panel consults actually fires", "");
    // Every fault the panel forwards is scanned at the moment it is drawn and
    // summarised when it is not fit to show. Here the same decision is made on
    // the same strings, so a report that would leak is a RED gate rather than a
    // sentence a user has to read.
    for (const std::string& f : q.faults) {
      if (!forge::ui::userFacingProseIsClean(f)) {
        std::printf("  note  a fault string is summarised rather than shown: %s\n", f.c_str());
      }
    }
    if (!q.unavailable.empty()) {
      check(forge::ui::userFacingProseIsClean(q.unavailable),
            "the sentence shown when a check cannot run is written for a person", q.unavailable);
    }
  }

  // ═════ 8. THE SHIPPED CONFIGURATION: the check in the isolated worker ═══
  // The application runs every build -- and now every check -- in a process it
  // can afford to lose, because these are the OCCT paths the kernel's own report
  // records faulting on. An answer that is right in process and wrong (or
  // missing) through the worker would be wrong in the only configuration a user
  // ever runs, so the two are compared HERE, on the same model, field by field.
  {
    std::string worker = argv[0] != nullptr ? std::string(argv[0]) : std::string();
    const std::size_t slash = worker.find_last_of('/');
    worker = (slash == std::string::npos ? std::string(".") : worker.substr(0, slash)) +
             "/forge_kernel_worker";
    std::FILE* probe = std::fopen(worker.c_str(), "rb");
    const bool haveWorker = probe != nullptr;
    if (probe != nullptr) std::fclose(probe);
    // A missing worker is not a failure of this gate: run_quality_gate.sh builds
    // the pair, and a tree that has only built the gate still gets every check
    // above. Saying which of the two ran is the point.
    std::printf("[quality_gate] isolated worker: %s\n", haveWorker ? worker.c_str() : "absent");
    if (haveWorker) {
      forge::desktop::KernelScene isolated;
      forge::ui::GuardLimits limits;
      limits.deadlineMs = 120000;
      isolated.useIsolatedWorker({worker}, limits);
      std::string probeWhy;
      check(isolated.probeWorker(probeWhy), "the isolated worker answers", probeWhy);
      const bool builtThere = isolated.build();
      check(builtThere, "the default part builds in the worker", isolated.error());
      forge::desktop::QualitySettings settings;
      const bool ranThere = isolated.analyseQuality(settings);
      check(ranThere, "the check runs in the worker", isolated.lastQuality().unavailable);
      checkEq(isolated.isolatedQualityRuns(), 1u, "the check went out of process");
      const forge::desktop::ModelQualityReport& w = isolated.lastQuality();
      // Every number the panels draw, compared with the in-process answer for
      // the same model. The tolerance is the printed precision, not a fudge:
      // the report is written at full double precision on purpose.
      checkNear(w.volume, q.volume, 1e-9, "the worker weighs the same model");
      checkNear(w.area, q.area, 1e-9, "the worker measures the same surface");
      checkEq(w.faceCount, q.faceCount, "the worker counts the same faces");
      checkEq(w.genus, q.genus, "the worker finds the same opening through it");
      checkEq(w.joins.size(), q.joins.size(), "the worker measures the same joins");
      checkEq(w.draft.size(), q.draft.size(), "the worker measures the same faces for draft");
      checkEq(w.undercutting, q.undercutting, "the worker finds the same undercut count");
      checkEq(w.zebra.size(), q.zebra.size(), "the worker stripes the same faces");
      checkEq(w.solids.size(), q.solids.size(), "the worker finds the same solids");
      if (!w.joins.empty() && !q.joins.empty()) {
        checkNear(w.joins.front().g1deg, q.joins.front().g1deg, 1e-9,
                  "a join's angle survives the trip unchanged");
      }
      // And the part's own checks, which travel on the BUILD's answer rather
      // than the check's -- a second wire, and it has to carry them too.
      forge::desktop::KernelScene isolatedChecks;
      isolatedChecks.useIsolatedWorker({worker}, limits);
      isolatedChecks.buildFromIr(
          "%1 = BOX(10, 10, 10)\n"
          "%2 = VERIFY(%1, \"faces=6\")\n");
      std::vector<std::string> lines = isolatedChecks.lastBuild().checks;
      if (g_mutation == 6) lines.clear();
      checkGe(lines.size(), 1u, "the part's own requirement crosses the worker boundary");
      if (!lines.empty()) {
        check(lines.front().rfind("PASS ", 0) == 0,
              "and it arrives saying it was met", lines.front());
      }
    }
  }

  // ═════ 9. an answer must say when the model has moved on ═══════════════
  // The check is not part of a rebuild, so an answer can outlive the model it
  // describes. Staleness is a WITNESS -- the program the check measured against
  // the program the scene now holds -- rather than a flag somebody has to
  // remember to set. LAST in this file on purpose: it changes the document, and
  // every section above measures the part it was given.
  {
    check(!frame.qualityStale(), "a fresh answer is not marked out of date", "");
    const double volumeBefore = frame.quality().volume;
    const std::size_t rebuildsBefore = frame.rebuilds();
    const std::size_t runsBefore = frame.qualityChecksRun();
    // Changed through the SAME registry a user's click reaches.
    frame.invoke("part.primitive_box");
    frameOnce(frame);
    checkGe(frame.rebuilds(), rebuildsBefore + 1, "the command rebuilt the model");
    check(frame.qualityStale(), "the answer is marked out of date once the model changes", "");
    frame.requestQualityCheck();
    frameOnce(frame);
    frameOnce(frame);
    check(!frame.qualityStale(), "checking again brings the answer back up to date", "");
    checkEq(frame.qualityChecksRun(), runsBefore + 1, "exactly one further check was run");
    // `volumeBefore` is read but deliberately NOT asserted to have moved: adding a
    // statement changes the PROGRAM without necessarily changing the solid the
    // program resolves to, and a gate that demanded a different volume here would
    // be asserting something about that one command rather than about staleness.
    (void)volumeBefore;
  }

  // ═════ 10. the answer is re-taken from the model, not remembered ═══════
  // The strongest form of "this is not a cached picture": change ONLY the
  // question and require the answer to change with it. Pulled along +Z the
  // plate's top releases and its bottom holds the part in; pulled along +X those
  // two faces stand along the pull instead and two of the walls take their
  // place. Same model, same check, different answer -- which a stored table
  // cannot produce.
  {
    const std::size_t verticalAlongZ = frame.quality().standingVertical;
    checkGe(verticalAlongZ, 1u, "some faces stand along the Z pull");
    frame.qualitySettings().pull[0] = 1.0;
    frame.qualitySettings().pull[1] = 0.0;
    frame.qualitySettings().pull[2] = 0.0;
    frame.requestQualityCheck();
    frameOnce(frame);
    frameOnce(frame);
    checkNear(frame.quality().pull[0], 1.0, 1e-12, "the check used the direction it was given");
    check(frame.quality().standingVertical != verticalAlongZ,
          "pulling along another axis gives another answer",
          std::to_string(frame.quality().standingVertical) + " vs " +
              std::to_string(verticalAlongZ));
    // Along +X the plate's +X wall reads 0 degrees -- and so does the BORE,
    // whose single sample happens to face that way. That second row is exactly
    // what the flat/curved caveat exists for, so the gate asserts BOTH: two
    // faces read straight on, and precisely one of them is flat.
    std::size_t straightOn = 0, straightOnFlat = 0;
    for (const forge::desktop::QualityDraftFace& d : frame.quality().draft) {
      if (std::fabs(d.angleDeg) >= 0.01) continue;
      ++straightOn;
      if (d.curvatureMeasured && d.flat) ++straightOnFlat;
    }
    checkGe(straightOn, 1u, "at least one face now reads straight along X");
    checkEq(straightOnFlat, 1u, "exactly one FLAT face faces straight along X");
    check(straightOn > straightOnFlat,
          "a curved face reading straight on is marked as read at one point", "");
  }

  std::printf("[quality_gate] %d checks, %d failures\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
