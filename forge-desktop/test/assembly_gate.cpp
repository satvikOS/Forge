// forge-desktop/test/assembly_gate.cpp
//
// THE HEADLESS ASSEMBLY GATE — proof that the four assembly panels show a user
// REAL geometry and not a layout with numbers in it.
//
// THE DEFECT THIS EXISTS FOR, VERBATIM, FROM A SHIPPED BUILD:
//
//   Panel "mates" is docked and laid out by forge::ui::DockLayout, and its
//   position, tab order and active tab persist across restart. Its content is
//   not implemented in this segment.
//
// Twenty-seven tabs drew that. Four of them — Components, Mates, Contacts and
// BOM — are the assembly workflow, and this gate is what says they are finished.
// It does NOT assert "the panel drew something". Every check below compares a
// number the application shows against a reference computed HERE from the
// geometry of the model, by hand, from its dimensions:
//
//   a 4-up linear pattern of a 10 mm cube, 30 mm apart
//       -> 4 bodies, 1000.000 mm^3 and 600.000 mm^2 each, 4000.000 mm^3 in
//          total, 6 pairs, the closest of them exactly 20.000 mm apart
//   a 40x40x10 plate bored 10 mm through, with a 9 mm pin standing in the bore
//       -> 2 bodies, the plate 40*40*10 - pi*5^2*10 mm^3 and the pin
//          pi*4.5^2*30 mm^3, exactly 0.500 mm apart, sharing one axis
//   two 20 mm plates side by side with a 0.5 mm joint
//       -> 2 bodies, flush on four faces and 0.500 mm apart on the fifth
//   a 10 mm cube beside a 20 x 20 x 2.5 plate
//       -> 1000.000 mm^3 each and TWO items, which is the check that the parts
//          list reads more than one number (see the note below)
//   a 40-up pattern of the same cube
//       -> 40 bodies, 780 pairs, and more of them than the kernel will measure
//          exactly -- so it measures the closest 32 and SAYS it stopped
//
// Those references are ARITHMETIC ON THE DIMENSIONS, not numbers copied out of a
// previous run, so the gate cannot drift into agreeing with a regression.
//
// It also proves the three things a panel can get wrong that a number cannot
// catch:
//   * the inventory SURVIVES THE PROCESS BOUNDARY. The shipped application runs
//     the kernel in forge_kernel_worker, so an inventory that exists only in
//     process is an inventory no user ever sees. The same model is built twice,
//     once in process and once through a real worker, and the two must agree.
//   * hiding a body actually HIDES IT — from the drawn triangles, and from what
//     a picking ray can hit. A checkbox that greys a row out is not a filter.
//   * every panel draws a row per thing the kernel measured.
//
// PROVING THE GATE CAN FAIL: `--mutate <n>` injects a defect and the matching
// checks must go red. These are the regressions this code could plausibly make,
// not synthetic aborts:
//   1  the document is built from a single box       -> the multi-body checks lose
//                                                       their subject
//   2  the panels are never drawn                    -> no panel draws a row
//   3  hiding a body is not applied to the scene     -> the drawn triangle count
//                                                       does not move and the
//                                                       hidden body is still
//                                                       pickable
//   4  the two arms of the process-boundary check    -> the comparison stops
//      are given different models                        comparing anything
//
// The most realistic regression of all needs no mutation, because a MODEL
// catches it: a parts list that folded bodies together by VOLUME alone would be
// wrong, volume is the obvious key and it is the wrong key, and this programme
// has measured a wrong solid reproducing a right volume to ten significant
// figures more than once. The equal-volume model above is that check: a 10 mm
// cube beside a 20 x 20 x 2.5 plate, 1000.000 mm^3 each and two different parts,
// so "these are TWO items" is the assertion that the fold reads more than one
// number.
//
// THE PERFORMANCE BOUND IS ALSO ASSERTED, and it is the reason the 40-body model
// is here. One exact distance between two solids costs 8-12 ms, so 780 pairs
// would be 3.5 seconds of every rebuild. The kernel measures the 32 closest and
// reports that it stopped; BOTH halves are checked, because a ceiling that
// truncates silently is a panel quietly reporting a subset as the whole.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "imgui.h"

#include "Camera.hpp"
#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "PartFile.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/GuardedProcess.hpp"
#include "forge/ui/PanelCatalog.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace {

int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

void check(bool ok, const char* what, const std::string& detail) {
  ++g_checks;
  if (!ok) {
    ++g_failures;
    std::printf("  FAIL  %-58s  %s\n", what, detail.c_str());
  }
}

template <typename A, typename B>
void checkEq(const A& got, const B& want, const char* what) {
  ++g_checks;
  if (!(got == static_cast<A>(want))) {
    ++g_failures;
    std::printf("  FAIL  %-58s  got %s want %s\n", what, std::to_string(got).c_str(),
                std::to_string(want).c_str());
  }
}

template <typename A, typename B>
void checkGe(const A& got, const B& floor, const char* what) {
  ++g_checks;
  if (!(got >= static_cast<A>(floor))) {
    ++g_failures;
    std::printf("  FAIL  %-58s  got %s, need >= %s\n", what, std::to_string(got).c_str(),
                std::to_string(floor).c_str());
  }
}

// A measured quantity against a reference computed from the model's dimensions.
// The tolerance is stated per call, in the unit of the thing, because "close
// enough" is a different number for a volume and for a clearance.
void checkNear(double got, double want, double tolerance, const char* what) {
  ++g_checks;
  if (!(std::fabs(got - want) <= tolerance)) {
    ++g_failures;
    std::printf("  FAIL  %-58s  got %.9f want %.9f (tolerance %.3g)\n", what, got, want,
                tolerance);
  }
}

const double kPi = 3.14159265358979323846;

// A headless ImGui context, styled exactly as the application styles its own —
// a style only the app applies is a style nobody tests.
struct HeadlessImGui {
  HeadlessImGui(float w, float h) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(w, h);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "assembly_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

// The four assembly panels do not share one workspace: Components, Mates and BOM
// live in Assembly and Contacts lives in Simulation. Rather than click through
// two workspaces to reach four tabs, the gate seats a layout of its own with all
// four in one tab group and steps the active tab across them. That is the
// SHIPPING draw path — ForgeFrame walks whatever layout the shell holds — and it
// makes "which panel was drawn" a fact the gate sets rather than one it hopes
// for.
void seatAssemblyLayout(forge::ui::ForgeShell& shell, std::size_t activeTab) {
  forge::ui::DockLayout layout;
  forge::ui::DockWindow window;
  window.id = 1;
  window.main = true;
  window.rect = forge::ui::Rect{0, 0, 1680, 1000};
  window.root = forge::ui::DockNode::split(
      forge::ui::SplitAxis::Horizontal, 0.45,
      forge::ui::DockNode::tabs({"viewport_3d"}),
      forge::ui::DockNode::tabs({"bom", "contacts", "component_filter", "mates"}, activeTab));
  layout.addWindow(window);
  shell.layout() = layout;
}

// One feature-IR statement, as a document record. The panels are fed by the
// DOCUMENT, through the same open path a user takes, so nothing here reaches
// past the application into the kernel to plant a model.
forge::desktop::PartFileFeature statement(int id, const char* op,
                                          std::vector<forge::ui::IrArg> args,
                                          const char* node = "") {
  forge::desktop::PartFileFeature feature;
  feature.record.irId = id;
  feature.record.label = op;
  feature.record.produces = forge::ui::IrValueKind::Solid;
  feature.record.line = forge::ui::IrLine{id, op, std::move(args)};
  feature.node = node;
  return feature;
}

forge::ui::IrArg num(double v) { return forge::ui::IrArg::num(v); }
forge::ui::IrArg ref(int id) { return forge::ui::IrArg::valueRef(id); }
forge::ui::IrArg word(const char* w) { return forge::ui::IrArg::keyword(w); }

std::string tempPath(const char* leaf) {
  const char* tmp = std::getenv("TMPDIR");
  std::string dir = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!dir.empty() && dir.back() != '/') dir += '/';
  return dir + leaf;
}

// Writes `doc` to disk and opens it through the application's own File > Open.
bool openModel(forge::desktop::ForgeFrame& frame, const forge::desktop::PartFileDoc& doc,
               const char* leaf, std::string& error) {
  const std::string path = tempPath(leaf);
  if (!forge::desktop::savePartFile(path, doc, error)) return false;
  const bool ok = frame.documentOpen(path, error);
  std::remove(path.c_str());
  return ok;
}

// ── the three models, and their references ────────────────────────────────
// A 4-up linear pattern of a 10 mm cube spaced 30 mm along X. Four separate
// bodies, because a pattern whose copies do not meet does not fuse into one.
forge::desktop::PartFileDoc patternModel() {
  forge::desktop::PartFileDoc doc;
  doc.name = "pattern";
  doc.features.push_back(statement(1, "BOX", {num(10), num(10), num(10), num(0), num(0), num(0)}));
  doc.features.push_back(
      statement(2, "PATTERN", {ref(1), word("LINEAR"), num(4), num(30), num(0), num(0)},
                "body.pattern"));
  return doc;
}

// A 40 x 40 x 10 plate bored 10 mm through, with a 9 mm pin standing in the
// bore. Two bodies, 0.5 mm apart all the way round, sharing one axis.
forge::desktop::PartFileDoc pinInPlateModel() {
  forge::desktop::PartFileDoc doc;
  doc.name = "pin_in_plate";
  doc.features.push_back(statement(1, "BOX", {num(40), num(40), num(10), num(0), num(0), num(0)}));
  doc.features.push_back(statement(2, "CYL", {num(5), num(20), num(0), num(0), num(-5)}));
  doc.features.push_back(statement(3, "CUT", {ref(1), ref(2)}));
  doc.features.push_back(statement(4, "CYL", {num(4.5), num(30), num(0), num(0), num(-5)}));
  doc.features.push_back(statement(5, "FUSE", {ref(3), ref(4)}, "body.assembly"));
  return doc;
}

// Two 20 x 20 x 10 plates side by side with a 0.5 mm joint between them: flush
// on four faces, 0.5 mm apart on the fifth.
forge::desktop::PartFileDoc sideBySideModel() {
  forge::desktop::PartFileDoc doc;
  doc.name = "side_by_side";
  doc.features.push_back(
      statement(1, "BOX", {num(20), num(20), num(10), num(-10.25), num(0), num(0)}));
  doc.features.push_back(
      statement(2, "BOX", {num(20), num(20), num(10), num(10.25), num(0), num(0)}));
  doc.features.push_back(statement(3, "FUSE", {ref(1), ref(2)}, "body.plates"));
  return doc;
}

// A 10 mm cube beside a 20 x 20 x 2.5 plate. Both displace 1000.000 mm^3 and
// they are NOT the same part: this is the model that catches a parts list which
// folds bodies together by volume alone.
forge::desktop::PartFileDoc equalVolumeModel() {
  forge::desktop::PartFileDoc doc;
  doc.name = "equal_volume";
  doc.features.push_back(statement(1, "BOX", {num(10), num(10), num(10), num(0), num(0), num(0)}));
  doc.features.push_back(
      statement(2, "BOX", {num(20), num(20), num(2.5), num(60), num(0), num(0)}));
  doc.features.push_back(statement(3, "FUSE", {ref(1), ref(2)}, "body.equal"));
  return doc;
}

// A 40-up pattern: 40 bodies, 780 pairs, and more of them than the kernel will
// measure exactly. This is the model that exercises the ceiling and the "and it
// says so" half of it -- see the timing note at the check that uses it.
forge::desktop::PartFileDoc crowdedModel() {
  forge::desktop::PartFileDoc doc;
  doc.name = "crowded";
  doc.features.push_back(statement(1, "BOX", {num(10), num(10), num(10), num(0), num(0), num(0)}));
  doc.features.push_back(
      statement(2, "PATTERN", {ref(1), word("LINEAR"), num(40), num(30), num(0), num(0)},
                "body.crowded"));
  return doc;
}

// A single 20 mm cube: the one-body case every panel has to answer honestly
// rather than by drawing an empty table.
forge::desktop::PartFileDoc singleBodyModel() {
  forge::desktop::PartFileDoc doc;
  doc.name = "one_body";
  doc.features.push_back(
      statement(1, "BOX", {num(20), num(20), num(20), num(0), num(0), num(0)}, "body.one"));
  return doc;
}

// Draws every one of the four panels once and returns the row counts. Each panel
// gets its own frame, because only the ACTIVE tab of a group is drawn — which is
// the same reason a user sees one of them at a time.
struct PanelRows {
  std::size_t bom = 0;
  std::size_t contacts = 0;
  std::size_t components = 0;
  std::size_t mates = 0;
};

PanelRows drawAllAssemblyPanels(forge::ui::ForgeShell& shell,
                                forge::desktop::ForgeFrame& frame) {
  PanelRows rows;
  for (std::size_t tab = 0; tab < 4; ++tab) {
    seatAssemblyLayout(shell, tab);
    ImGui::NewFrame();
    if (g_mutation != 2) frame.build(0, 1.0f);
    ImGui::Render();
  }
  rows.bom = frame.bomRowsDrawn();
  rows.contacts = frame.contactRowsDrawn();
  rows.components = frame.componentRowsDrawn();
  rows.mates = frame.mateRowsDrawn();
  return rows;
}

// The counters are per-draw, so reading all four after four frames only works if
// each panel's counter survives the frames that did not draw it. It does -- a
// counter is reset at the top of ITS OWN draw -- and this is the function that
// depends on that, so it is stated here rather than assumed.

// The gap the panels would report for a given pair, straight out of the report.
const forge::desktop::SceneBodyPair* pairOf(const forge::desktop::IrBuildReport& report,
                                            std::uint32_t a, std::uint32_t b) {
  for (const forge::desktop::SceneBodyPair& p : report.bodyPairs) {
    if ((p.a == a && p.b == b) || (p.a == b && p.b == a)) return &p;
  }
  return nullptr;
}

double smallestGap(const forge::desktop::IrBuildReport& report) {
  double best = 1e30;
  for (const forge::desktop::SceneBodyPair& p : report.bodyPairs) best = std::min(best, p.gap);
  return best;
}

}  // namespace

int main(int argc, char** argv) {
  // THE WORKER IS FOUND BESIDE THIS BINARY, exactly as the application finds it
  // beside itself. It is not optional: the shipped app always runs the kernel out
  // of process, so a run that skipped the process-boundary check would be a run
  // that proved the panels work in the one configuration no user has. CMake makes
  // this target depend on the worker so it is always there.
  std::string workerPath;
  if (argc > 0 && argv[0] != nullptr) {
    const std::string self = argv[0];
    const std::size_t slash = self.find_last_of('/');
    workerPath = (slash == std::string::npos ? std::string(".") : self.substr(0, slash)) +
                 "/forge_kernel_worker";
  }
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
    if (std::strcmp(argv[i], "--worker") == 0 && i + 1 < argc) workerPath = argv[++i];
  }
  {
    // A check that could not run is not a check that passed.
    std::FILE* probe = workerPath.empty() ? nullptr : std::fopen(workerPath.c_str(), "rb");
    if (probe == nullptr) {
      std::printf("[gate] no kernel worker at \"%s\" -- the process-boundary check cannot "
                  "run, and the panels are only proved in a configuration no user has\n",
                  workerPath.c_str());
      return 1;
    }
    std::fclose(probe);
  }
  if (g_mutation != 0) std::printf("[gate] MUTATION %d ACTIVE\n", g_mutation);

  forge::desktop::KernelScene scene;
  if (!scene.build()) {
    std::printf("[gate] the kernel could not build the default part: %s\n", scene.error().c_str());
    return 1;
  }

  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();

  // ── 0. the catalogue's claim ─────────────────────────────────────────────
  // The four panels claim to be Live. ui/test/user_facing_text_test.cpp already
  // proves the claim matches the frame builder's dispatch; what is asserted here
  // is that the claim is TRUE OF THE RUNNING APPLICATION, which is a different
  // question and the one a user cares about.
  for (const char* id : {"bom", "contacts", "component_filter", "mates"}) {
    const forge::ui::PanelInfo* info = forge::ui::findPanelInfo(id);
    check(info != nullptr, "the catalogue knows this panel", id);
    if (info != nullptr) check(info->live(), "the catalogue calls this panel finished", id);
  }

  // ── 1. FOUR BODIES: the pattern ──────────────────────────────────────────
  std::printf("[gate] model 1: a 4-up pattern of a 10 mm cube, 30 mm apart\n");
  {
    std::string error;
    const forge::desktop::PartFileDoc doc =
        g_mutation == 1 ? singleBodyModel() : patternModel();
    check(openModel(frame, doc, "forge_assembly_pattern.fpart", error), "the pattern model opens",
          error);
    frame.syncSceneToDocument();

    const forge::desktop::IrBuildReport& report = scene.lastBuild();
    check(report.ok(), "the pattern model builds", report.error);
    check(report.bodiesAnalysed, "the kernel took an inventory of it", "");
    checkEq(report.bodies.size(), 4u, "a 4-up pattern is 4 separate bodies");

    // Each copy is the cube it was patterned from. Reference: 10^3 mm^3 and
    // 6 * 10^2 mm^2, arithmetic on the dimensions in the document above.
    double total = 0.0;
    for (const forge::desktop::SceneBody& body : report.bodies) {
      checkNear(body.volume, 1000.0, 1e-6, "each copy displaces 10 x 10 x 10 mm3");
      checkNear(body.area, 600.0, 1e-6, "each copy has six 10 x 10 mm faces");
      checkNear(body.sizeX(), 10.0, 1e-9, "each copy is 10 mm across X");
      checkEq(body.faceCount, 6u, "each copy is a six-faced box");
      total += body.volume;
    }
    checkNear(total, 4000.0, 1e-6, "the four copies total 4000 mm3");
    // TWO INDEPENDENT MEASUREMENTS of the same model, by two different kernel
    // paths: the per-body integration above and the whole-shape volume the
    // compiler reported. A body walk that dropped or double-counted a solid
    // shows up here and nowhere else.
    checkNear(total, report.volume, 1e-6, "the bodies add up to the whole model");

    // 4 bodies is 6 pairs, and the closest of them is 30 mm of spacing less
    // 10 mm of cube.
    checkEq(report.bodyPairs.size(), 6u, "4 bodies make 6 pairs");
    checkEq(report.pairsEvaluated, 6u, "all 6 were measured exactly");
    check(!report.pairsTruncated, "nothing was left unmeasured", "");
    checkNear(smallestGap(report), 20.0, 1e-9, "neighbouring copies are 20.000 mm apart");
    // Nothing in this model touches anything, and the panels must not claim so.
    for (const forge::desktop::SceneBodyPair& pair : report.bodyPairs) {
      check(!pair.touching(), "no pair of a spaced pattern touches", std::to_string(pair.gap));
      check(!pair.interfering(), "no pair of a spaced pattern overlaps",
            std::to_string(pair.overlapVolume));
    }

    // Every face names exactly one body, and the counts close.
    std::uint32_t faced = 0;
    for (std::uint32_t id = 1; id < report.bodyOfFace.size(); ++id) {
      if (report.bodyOfFace[id] != 0) ++faced;
    }
    checkEq(faced, 24u, "all 24 faces of the four cubes name a body");
    checkGe(report.bodyOfFace.size(), 1u, "the face-to-body map has its unused entry 0");
    checkEq(report.bodyOfFace.empty() ? 0u : report.bodyOfFace.size() - 1,
            static_cast<std::size_t>(scene.faceCount()),
            "the face-to-body map covers exactly the faces the viewport picks");

    // ── the panels ─────────────────────────────────────────────────────────
    const PanelRows rows = drawAllAssemblyPanels(shell, frame);
    std::printf("[gate] rows drawn: parts list %zu, contacts %zu, components %zu, mates %zu\n",
                rows.bom, rows.contacts, rows.components, rows.mates);
    // FOUR identical cubes are ONE part with a quantity of four. That is the
    // whole point of a parts list and it is the check that says so.
    checkEq(rows.bom, 1u, "four identical copies are ONE item in the parts list");
    checkEq(rows.contacts, 6u, "the contacts panel draws a row per measured pair");
    checkEq(rows.components, 4u, "the components panel draws a row per body");
    checkEq(rows.mates, 0u, "nothing lines up in a model where nothing meets");

    // ── hiding a body actually hides it ────────────────────────────────────
    const std::size_t drawnBefore = scene.triangleCount();
    const std::size_t totalTris = scene.totalTriangleCount();
    checkEq(drawnBefore, totalTris, "nothing is hidden to start with");
    checkEq(scene.hiddenBodyCount(), 0u, "no body starts hidden");

    // ★ EVERYTHING BELOW INDEXES BODY 3, so it is guarded on the model really
    // having four. An unguarded report.bodies[2] on a one-body model is a read
    // past the end -- undefined, and observed BOTH crashing and quietly reading
    // rubbish on this build, which is the worse of the two because it makes a
    // gate report on memory instead of on geometry.
    if (report.bodies.size() < 4) {
      std::printf("[gate] fewer than four bodies: the hide/pick checks have no subject\n");
    } else {
    // Aim a ray straight down the middle of body 3 -- the copy at the origin --
    // BEFORE hiding it, so the miss afterwards is a change and not a bad aim.
    const forge::desktop::SceneBody& target = report.bodies[2];
    const float from[3] = {static_cast<float>(target.centroid[0]),
                           static_cast<float>(target.centroid[1]),
                           static_cast<float>(target.bboxMax[2] + 50.0)};
    const float down[3] = {0.0f, 0.0f, -1.0f};
    const forge::desktop::PickResult before = scene.pick(from, down);
    check(before.hit(), "a ray down the third copy hits it", "");
    checkEq(report.bodyForFace(before.faceId), 3u, "and the face it hit belongs to that body");

    // Through the SAME verb the checkbox calls, so what is proved here is what a
    // click does -- including that the host is told to re-upload.
    if (g_mutation != 3) check(frame.showBody(3, false), "body 3 can be hidden", "");
    checkEq(scene.hiddenBodyCount(), 1u, "exactly one body is hidden");
    checkEq(scene.totalTriangleCount(), totalTris, "hiding destroys no geometry");
    check(scene.triangleCount() < drawnBefore, "hiding a body removes it from what is drawn",
          std::to_string(scene.triangleCount()) + " of " + std::to_string(drawnBefore));
    // A quarter of four identical cubes.
    checkEq(scene.triangleCount(), drawnBefore - drawnBefore / 4,
            "one of four identical bodies is a quarter of the triangles");
    const forge::desktop::PickResult after = scene.pick(from, down);
    check(!after.hit(), "a hidden body cannot be picked", "");

    // The panel still lists it, because hidden is not deleted.
    // The panel still lists it, because hidden is not deleted -- and the FIRST
    // frame after the hide must carry the re-upload request, which is read
    // before the next four frames clear it.
    seatAssemblyLayout(shell, 2);
    ImGui::NewFrame();
    if (g_mutation != 2) frame.build(0, 1.0f);
    ImGui::Render();
    check(frame.viewport().visibilityDirty, "the host is told to re-upload the vertex stream",
          "");
    const PanelRows hiddenRows = drawAllAssemblyPanels(shell, frame);
    checkEq(hiddenRows.components, 4u, "a hidden body is still listed");
    checkEq(hiddenRows.bom, 1u, "a hidden body is still in the parts list");

    frame.showEveryBody();
    checkEq(scene.triangleCount(), totalTris, "showing everything restores every triangle");
    checkEq(scene.hiddenBodyCount(), 0u, "nothing is hidden again");
    check(scene.pick(from, down).hit(), "and the body is pickable again", "");

    // The list filter narrows the LIST, not the model.
    frame.setComponentFilterText("Body 2");
    const PanelRows filtered = drawAllAssemblyPanels(shell, frame);
    checkEq(filtered.components, 1u, "the filter narrows the list to one part");
    checkEq(scene.triangleCount(), totalTris, "filtering the list hides nothing");
    frame.setComponentFilterText("");
    }
  }

  // ── 2. TWO BODIES SHARING AN AXIS: the pin in the plate ──────────────────
  std::printf("[gate] model 2: a 9 mm pin standing in a 10 mm bore\n");
  {
    std::string error;
    check(openModel(frame, pinInPlateModel(), "forge_assembly_pin.fpart", error),
          "the pin-in-plate model opens", error);
    frame.syncSceneToDocument();
    const forge::desktop::IrBuildReport& report = scene.lastBuild();
    check(report.ok(), "the pin-in-plate model builds", report.error);
    checkEq(report.bodies.size(), 2u, "a pin standing in a bore is two bodies");

    // References, from the dimensions in the document: the pin is a 9 mm
    // cylinder 30 mm long, the plate is 40 x 40 x 10 less a 10 mm bore through.
    const double pinVolume = kPi * 4.5 * 4.5 * 30.0;
    const double plateVolume = 40.0 * 40.0 * 10.0 - kPi * 5.0 * 5.0 * 10.0;
    double smallest = 1e30;
    double largest = 0.0;
    for (const forge::desktop::SceneBody& body : report.bodies) {
      smallest = std::min(smallest, body.volume);
      largest = std::max(largest, body.volume);
    }
    checkNear(smallest, pinVolume, 1e-6, "the pin displaces pi * 4.5^2 * 30 mm3");
    checkNear(largest, plateVolume, 1e-6, "the plate displaces its box less its bore");
    checkNear(smallest + largest, report.volume, 1e-6, "the two bodies are the whole model");

    // 4.5 mm of pin inside a 5 mm bore is 0.5 mm of clearance, all the way round.
    checkEq(report.bodyPairs.size(), 1u, "two bodies make one pair");
    const forge::desktop::SceneBodyPair* pair = pairOf(report, 1, 2);
    check(pair != nullptr, "the pair was measured", "");
    if (pair != nullptr) {
      checkNear(pair->gap, 0.5, 1e-9, "the pin clears the bore by exactly 0.500 mm");
      check(!pair->touching(), "0.5 mm of clearance is not a contact", "");
      check(!pair->interfering(), "a pin in a bore does not overlap the plate", "");
    }

    // ── the alignment: one axis, shared ────────────────────────────────────
    std::size_t concentric = 0;
    // Guarded the same way: an alignment list built over a model that came back
    // with the wrong number of bodies would be asserting on the wrong thing.

    for (const forge::desktop::SceneBodyAlignment& al : report.alignments) {
      if (al.kind != forge::desktop::BodyAlignment::Concentric) continue;
      ++concentric;
      checkNear(al.deviation, 0.0, 1e-9, "the pin and the bore share their axis exactly");
      checkNear(std::fabs(al.direction[2]), 1.0, 1e-9, "and that axis is the Z axis");
      checkNear(al.point[0], 0.0, 1e-9, "which passes through the origin in X");
      checkNear(al.point[1], 0.0, 1e-9, "and through the origin in Y");
      check(report.bodyForFace(al.faceA) == al.a, "the first face belongs to the first body", "");
      check(report.bodyForFace(al.faceB) == al.b, "the second face belongs to the second body",
            "");
    }
    checkGe(concentric, 1u, "the shared axis was found");

    const PanelRows rows = drawAllAssemblyPanels(shell, frame);
    checkEq(rows.bom, 2u, "a pin and a plate are two different items");
    checkEq(rows.contacts, 1u, "one measured pair is one row");
    checkEq(rows.components, 2u, "two bodies are two components");
    checkEq(rows.mates, report.alignments.size(), "every alignment the kernel found is shown");
    checkGe(rows.mates, 1u, "the shared axis reaches the user");
  }

  // ── 3. TWO BODIES LYING FLUSH: the side-by-side plates ───────────────────
  std::printf("[gate] model 3: two plates with a 0.5 mm joint\n");
  {
    std::string error;
    check(openModel(frame, sideBySideModel(), "forge_assembly_plates.fpart", error),
          "the side-by-side model opens", error);
    frame.syncSceneToDocument();
    const forge::desktop::IrBuildReport& report = scene.lastBuild();
    check(report.ok(), "the side-by-side model builds", report.error);
    checkEq(report.bodies.size(), 2u, "two plates that do not meet stay two bodies");
    const forge::desktop::SceneBodyPair* pair = pairOf(report, 1, 2);
    check(pair != nullptr, "the pair was measured", "");
    if (pair != nullptr) checkNear(pair->gap, 0.5, 1e-9, "the joint is exactly 0.500 mm");

    std::size_t flush = 0;
    std::size_t exact = 0;
    for (const forge::desktop::SceneBodyAlignment& al : report.alignments) {
      if (al.kind != forge::desktop::BodyAlignment::Coplanar) continue;
      ++flush;
      if (al.deviation < 1e-9) ++exact;
    }
    // Both plates are 10 mm tall, 20 mm deep and sit on Z = 0: their bases,
    // their tops and their two ends are each one plane. Four exact ones.
    checkGe(flush, 4u, "the flush faces were found");
    checkGe(exact, 4u, "four of them are flush to the last digit");

    const PanelRows rows = drawAllAssemblyPanels(shell, frame);
    checkEq(rows.mates, report.alignments.size(), "every alignment reaches the user");
    checkEq(rows.bom, 1u, "two identical plates are one item");
  }

  // ── 3b. EQUAL VOLUME, DIFFERENT PART ─────────────────────────────────────
  // The check the parts list exists to pass. A 10 mm cube and a 20 x 20 x 2.5
  // plate displace the same 1000.000 mm^3 and are two different parts; a fold
  // keyed on volume alone would draw ONE row with a quantity of two, which is a
  // parts list that would send a shop the wrong order.
  std::printf("[gate] model 3b: two different parts of identical volume\n");
  {
    std::string error;
    check(openModel(frame, equalVolumeModel(), "forge_assembly_equal.fpart", error),
          "the equal-volume model opens", error);
    frame.syncSceneToDocument();
    const forge::desktop::IrBuildReport& report = scene.lastBuild();
    checkEq(report.bodies.size(), 2u, "the two shapes stay two bodies");
    if (report.bodies.size() == 2) {
      checkNear(report.bodies[0].volume, report.bodies[1].volume, 1e-6,
                "the two bodies really do displace the same material");
      check(std::fabs(report.bodies[0].area - report.bodies[1].area) > 1.0,
            "and really are different shapes",
            std::to_string(report.bodies[0].area) + " vs " +
                std::to_string(report.bodies[1].area));
    }
    const PanelRows rows = drawAllAssemblyPanels(shell, frame);
    checkEq(rows.bom, 2u, "equal volume is NOT the same part");
  }

  // ── 3c. MORE PAIRS THAN CAN BE MEASURED ──────────────────────────────────
  // ★ THE PERFORMANCE BOUND, ASSERTED RATHER THAN INTENDED. One exact distance
  // between two solids costs 8-12 ms on this build, so 40 bodies -- 780 pairs --
  // would cost 3.5 SECONDS of every rebuild if they were all measured. The
  // kernel measures the 32 closest and SAYS SO, and both halves are checked
  // here: that it stopped, and that it told the user it stopped. A ceiling that
  // silently truncates is a panel quietly reporting a subset as the whole.
  std::printf("[gate] model 3c: 40 bodies, more pairs than can be measured\n");
  {
    std::string error;
    check(openModel(frame, crowdedModel(), "forge_assembly_crowded.fpart", error),
          "the 40-body model opens", error);
    frame.syncSceneToDocument();
    const forge::desktop::IrBuildReport& report = scene.lastBuild();
    check(report.ok(), "the 40-body model builds", report.error);
    checkEq(report.bodies.size(), 40u, "a 40-up pattern is 40 separate bodies");
    check(report.pairsTruncated, "the kernel says it did not measure every pair", "");
    check(report.bodyPairs.size() < 780u, "and it really did stop short of all 780",
          std::to_string(report.bodyPairs.size()));
    checkEq(report.bodyPairs.size(), report.pairsEvaluated,
            "every pair it reports is one it measured");
    // The ones it kept are the CLOSEST, which is what makes the truncation safe:
    // a contact can never be dropped in favour of a distant pair.
    double worst = 0.0;
    for (const forge::desktop::SceneBodyPair& pair : report.bodyPairs) {
      worst = std::max(worst, pair.gap);
    }
    checkNear(smallestGap(report), 20.0, 1e-9, "the closest pairs were the ones measured");
    check(worst < 240.0, "and none of the far ones was measured in their place",
          std::to_string(worst));

    const PanelRows rows = drawAllAssemblyPanels(shell, frame);
    checkEq(rows.components, 40u, "every one of the 40 bodies is listed");
    checkEq(rows.bom, 1u, "and all 40 are one item with a quantity of 40");
    checkEq(rows.contacts, report.bodyPairs.size(),
            "the contacts panel draws exactly the pairs that were measured");
  }

  // ── 4. ONE BODY: the honest empty answer ─────────────────────────────────
  std::printf("[gate] model 4: a single body -- what the panels say when there is no assembly\n");
  {
    std::string error;
    check(openModel(frame, singleBodyModel(), "forge_assembly_one.fpart", error),
          "the single-body model opens", error);
    frame.syncSceneToDocument();
    const forge::desktop::IrBuildReport& report = scene.lastBuild();
    checkEq(report.bodies.size(), 1u, "a box is one body");
    checkEq(report.bodyPairs.size(), 0u, "one body pairs with nothing");
    checkEq(report.alignments.size(), 0u, "and lines up with nothing");
    const PanelRows rows = drawAllAssemblyPanels(shell, frame);
    // The parts list still has a row -- one part, quantity one, is a true parts
    // list. Contacts and Mates have none, and must say WHY rather than draw an
    // empty table; that they draw no row is what is asserted here, and the
    // wording is what ui/test/user_facing_text_test.cpp scans.
    checkEq(rows.bom, 1u, "one part is still a parts list");
    checkEq(rows.contacts, 0u, "one body has no contacts");
    checkEq(rows.mates, 0u, "one body has no alignments");
    checkEq(rows.components, 1u, "one body is one component");
  }

  // ── 5. THE PROCESS BOUNDARY ──────────────────────────────────────────────
  // The shipped application ALWAYS runs the kernel in forge_kernel_worker. An
  // inventory that exists only in process is an inventory no user ever sees, so
  // the same model is built both ways and the two answers are compared field by
  // field. This is the check that would have caught shipping the panels with a
  // worker protocol that did not carry them.
  {
    std::printf("[gate] model 5: the same model through a real worker process\n");
    forge::desktop::KernelScene inProcess;
    forge::desktop::KernelScene isolated;
    forge::ui::GuardLimits limits;
    limits.deadlineMs = 120000;
    isolated.useIsolatedWorker({workerPath}, limits);

    const std::string program = pinInPlateModel().irProgram();
    // MUTATION 4 gives the two arms different models, which is what a comparison
    // that has stopped comparing looks like from the outside.
    const std::string otherProgram =
        g_mutation == 4 ? patternModel().irProgram() : program;
    check(inProcess.buildFromIr(program), "the model builds in process", inProcess.error());
    check(isolated.buildFromIr(otherProgram), "the model builds in a worker", isolated.error());
    // A worker that could not be LAUNCHED falls back to this process, and the
    // comparison would then be one build against itself -- green, and proving
    // nothing. So the fallback counter is asserted, not just the submission.
    checkGe(isolated.isolatedBuilds(), 1u, "the build really went through the worker");
    checkEq(isolated.isolatedFallbacks(), 0u, "and never quietly fell back to this process");

    const forge::desktop::IrBuildReport& here = inProcess.lastBuild();
    const forge::desktop::IrBuildReport& there = isolated.lastBuild();
    checkEq(there.bodiesAnalysed ? 1 : 0, here.bodiesAnalysed ? 1 : 0,
            "the worker took an inventory too");
    checkEq(there.bodies.size(), here.bodies.size(), "both builds found the same bodies");
    checkEq(there.bodyPairs.size(), here.bodyPairs.size(), "both measured the same pairs");
    checkEq(there.alignments.size(), here.alignments.size(), "both found the same alignments");
    checkEq(there.bodyOfFace.size(), here.bodyOfFace.size(),
            "both mapped the same number of faces");
    // BIT-FOR-BIT, not "close": the worker writes each double with enough digits
    // to round-trip, so a volume that differs at all is a protocol defect and not
    // a rounding one.
    for (std::size_t i = 0; i < here.bodies.size() && i < there.bodies.size(); ++i) {
      check(there.bodies[i].volume == here.bodies[i].volume,
            "a body's volume crosses the boundary exactly",
            std::to_string(there.bodies[i].volume));
      check(there.bodies[i].area == here.bodies[i].area,
            "a body's area crosses the boundary exactly", std::to_string(there.bodies[i].area));
      checkEq(there.bodies[i].faceCount, here.bodies[i].faceCount,
              "a body's face count crosses the boundary");
    }
    for (std::size_t i = 0; i < here.bodyPairs.size() && i < there.bodyPairs.size(); ++i) {
      check(there.bodyPairs[i].gap == here.bodyPairs[i].gap,
            "a measured gap crosses the boundary exactly",
            std::to_string(there.bodyPairs[i].gap));
    }
    for (std::size_t i = 0; i < here.bodyOfFace.size() && i < there.bodyOfFace.size(); ++i) {
      check(there.bodyOfFace[i] == here.bodyOfFace[i], "the face-to-body map crosses intact",
            std::to_string(i));
    }
  }

  std::printf("\n[gate] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures == 0) {
    if (g_mutation != 0) {
      // run_desktop.sh reads the EXIT CODE: a mutation it injected must turn the
      // gate red, so exiting 0 here is the "unfalsifiable check" verdict and the
      // runner prints it as one. Saying so twice costs nothing and the silent
      // version of this has shipped before.
      std::printf("[gate] MUTATION %d WAS NOT CAUGHT -- the checks it targets do not bite\n",
                  g_mutation);
      return 1;
    }
    std::printf("[gate] ALL FORGE ASSEMBLY GATES PASS "
                "(headless: no window, no swapchain, real multi-body geometry)\n");
    return 0;
  }
  return 1;
}
