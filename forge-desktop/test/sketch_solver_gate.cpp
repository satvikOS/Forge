// forge-desktop/test/sketch_solver_gate.cpp
//
// THE SKETCH SOLVER, END TO END, THROUGH THE APPLICATION — headless.
//
// The three acceptance behaviours for Forge's constraint solver, each driven the
// way a user or Archie drives it: through the ONE command registry the menu, the
// keyboard and the CoPilot all dispatch into, on the real ForgeFrame, with the
// part compiled by the real kernel -- never by pasting IR, and never by calling
// the solver directly.
//
//   1. A 60 x 40 plate with two 10 mm holes, drawn deliberately WRONG (corners off,
//      holes the wrong size) and then pinned with a Fix, four Horizontal/Vertical
//      and eight dimensions, is FULLY CONSTRAINED: the solver's own rank analysis
//      reports 0 degrees of freedom, nothing conflicts or repeats, and the solved
//      geometry is the dimensioned plate rather than the drawing.
//   2. The extruded plate is the plate WITH ITS HOLES -- volume, bounding box and
//      face count all measured -- and changing the 60 mm width to 80 through the
//      Dimensions panel's own edit path re-solves the sketch and moves the solid:
//      80 wide, the same 40 tall, the holes where their dimensions put them.
//   3. A contradicting constraint -- a second width of 70 mm on the same two
//      corners -- is REFUSED: the command fails, the document and the undo stack
//      do not change, the part does not change, and the refusal names BOTH the
//      constraint it would have added and the one it contradicts.
//
// Plus the two edges of (3) that make it a judge rather than a blocklist: a
// repeated width that AGREES is accepted and reported as a repeat, and a kind that
// cannot hold on what it names is refused with that reason. The Solver tab is drawn
// against each state and must say what the solver says.
//
// PROVING THE GATE CAN FAIL — `--mutate <n>`:
//   1  dispatch the contradicting width through a copy of the document that has
//      NO judge installed                       -> "refused" goes red
//   2  do not dispatch the width edit           -> "the solid moved" goes red
//   3  leave out one hole dimension             -> "0 degrees of freedom" goes red
//   4  leave out the hole diameters             -> the plate's volume goes red
//   5  give the "contradicting" width the value the part already has
//                                               -> "refused" goes red
//   6  never build a frame                      -> the Solver tab draws nothing
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "imgui.h"

#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "forge/ft/SketchInspect.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace {

int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;
constexpr double kPi = 3.14159265358979323846;

void check(bool ok, const char* what, const std::string& detail) {
  ++g_checks;
  if (!ok) {
    ++g_failures;
    std::printf("  FAIL  %-62s  %s\n", what, detail.c_str());
  }
}

void checkNear(double got, double want, double tol, const char* what) {
  ++g_checks;
  if (!(std::fabs(got - want) <= tol)) {
    ++g_failures;
    std::printf("  FAIL  %-62s  got %.6f want %.6f (+/- %.6f)\n", what, got, want, tol);
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
    io.BackendRendererName = "sketch_solver_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

void buildOneFrame(forge::desktop::ForgeFrame& frame) {
  ImGui::NewFrame();
  if (g_mutation != 6) frame.build(0, 1.0f);
  ImGui::Render();
}

forge::ui::EntityRef ref(const std::string& node, forge::ui::EntityKind kind) {
  forge::ui::EntityRef r;
  r.bodyId = node;
  r.kind = kind;
  r.persistentName = node;
  return r;
}

const forge::ft::SketchEntityInfo* entityAt(const forge::ft::SketchInfo& s, int irId) {
  for (const forge::ft::SketchEntityInfo& e : s.entities) {
    if (e.irId == irId) return &e;
  }
  return nullptr;
}

bool contains(const std::string& hay, const std::string& needle) {
  return hay.find(needle) != std::string::npos;
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[gate] MUTATION %d ACTIVE\n", g_mutation);

  forge::desktop::KernelScene scene;
  const bool built = scene.build();
  check(built, "the starting part builds", scene.error());
  if (!built) return 1;

  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();
  forge::ui::SelectionService& sel = shell.selection();
  shell.setWorkspace(forge::ui::WorkspaceProfile::Sketch);
  {
    std::string err;
    check(frame.documentReset(err), "the document can be emptied to start from a sketch", err);
  }
  check(frame.document().records().empty(), "an emptied document holds no statements", "");

  // ── authoring, one gesture per command ─────────────────────────────────────
  const auto run = [&](const char* id, const forge::ui::CommandParams& p, const char* what) {
    const forge::ui::DispatchResult r = shell.run(id, p);
    check(r.ok(), what, r.detail);
    return static_cast<int>(frame.document().records().size());
  };
  const auto pick = [&](std::initializer_list<int> ids) {
    std::vector<forge::ui::EntityRef> refs;
    for (int id : ids) refs.push_back(ref("sketchref_" + std::to_string(id), forge::ui::EntityKind::SketchRef));
    sel.replaceWith(refs);
  };
  const auto pickSketch = [&](int id) {
    sel.replaceWith({ref("opensketch_" + std::to_string(id), forge::ui::EntityKind::OpenSketch)});
  };
  const auto point = [&](int sk, double x, double y) {
    pickSketch(sk);
    forge::ui::CommandParams p;
    p.setNumber("x", x);
    p.setNumber("y", y);
    return run("part.sketch_entity_point", p, "Sketch Point");
  };
  const auto line = [&](int a, int b) {
    pick({a, b});
    return run("part.sketch_entity_line", {}, "Sketch Line");
  };
  const auto circle = [&](int centre, double r) {
    pick({centre});
    forge::ui::CommandParams p;
    p.setNumber("radius", r);
    return run("part.sketch_entity_circle", p, "Sketch Circle");
  };
  const auto constrain1 = [&](int e, const char* kind) {
    pick({e});
    forge::ui::CommandParams p;
    p.setText("kind", kind);
    return run("part.sketch_constrain_single", p, kind);
  };
  const auto dimension2 = [&](int a, int b, const char* kind, double v) {
    pick({a, b});
    forge::ui::CommandParams p;
    p.setText("kind", kind);
    p.setNumber("value", v);
    return run("part.sketch_dimension", p, kind);
  };
  const auto dimension1 = [&](int e, const char* kind, double v) {
    pick({e});
    forge::ui::CommandParams p;
    p.setText("kind", kind);
    p.setNumber("value", v);
    return run("part.sketch_dimension_single", p, kind);
  };

  sel.clearSelection();
  const int sk = run("part.sketch_new", {}, "New Sketch");
  // DRAWN WRONG ON PURPOSE: no corner is where the dimensions put it, and both
  // holes are drawn at the wrong size. A reading that echoed the drawing fails.
  const int p0 = point(sk, 0.0, 0.0);
  const int p1 = point(sk, 57.0, 1.5);
  const int p2 = point(sk, 62.0, 43.0);
  const int p3 = point(sk, -1.0, 38.0);
  const int h1 = point(sk, 13.0, 22.0);
  const int h2 = point(sk, 47.0, 18.0);
  const int bottom = line(p0, p1);
  const int right = line(p1, p2);
  const int top = line(p2, p3);
  const int left = line(p3, p0);
  const int c1 = circle(h1, 3.5);
  const int c2 = circle(h2, 6.5);

  constrain1(p0, "FIX");
  constrain1(bottom, "HORIZ");
  constrain1(top, "HORIZ");
  constrain1(right, "VERT");
  constrain1(left, "VERT");
  const int width = dimension2(p0, p1, "DISTX", 60.0);
  dimension2(p0, p3, "DISTY", 40.0);
  dimension2(p0, h1, "DISTX", 15.0);
  if (g_mutation != 3) dimension2(p0, h1, "DISTY", 20.0);
  dimension2(p0, h2, "DISTX", 45.0);
  dimension2(p0, h2, "DISTY", 20.0);
  if (g_mutation != 4) {
    dimension1(c1, "DIAM", 10.0);
    dimension1(c2, "DIAM", 10.0);
  }

  pickSketch(sk);
  const int solved = run("part.sketch_solve", {}, "Solve Sketch");
  sel.replaceWith({ref("sketch_" + std::to_string(solved), forge::ui::EntityKind::Sketch)});
  forge::ui::CommandParams ex;
  ex.setNumber("distance", 10.0);
  run("part.extrude", ex, "Extrude the plate");
  const std::size_t authored = frame.document().records().size();
  std::printf("[gate] %zu statements authored through the registry\n", authored);

  // ── 1. FULLY CONSTRAINED, by the solver's own rank analysis ────────────────
  buildOneFrame(frame);
  {
    const forge::ft::SketchInfo* s = frame.activeSketch();
    check(s != nullptr, "the plate sketch reads back", "");
    if (s == nullptr) {
      std::printf("=== %d checks, %d failed ===\n", g_checks, g_failures);
      return 1;
    }
    std::printf("[gate] sketch %%%d: %zu entities, %zu constraints, dof %d, health %d\n", s->irId,
                s->entities.size(), s->constraints.size(), s->dof, static_cast<int>(s->health));
    check(s->dof == 0, "the solver reports 0 degrees of freedom", std::to_string(s->dof));
    check(s->health == forge::ft::SketchHealth::FullyConstrained,
          "and calls the sketch fully constrained", std::to_string(static_cast<int>(s->health)));
    check(s->conflictGroups.empty(), "nothing in it contradicts anything", "");
    for (const forge::ft::SketchConstraintInfo& c : s->constraints) {
      check(c.state == forge::ft::SketchConstraintState::Applied && !c.redundant &&
                !c.partiallyRedundant && !c.demoted,
            "every constraint is applied, needed, and kept", c.keyword);
      check(c.hasResidual && std::fabs(c.residual) < 1e-6, "and satisfied after the solve",
            c.keyword + " " + std::to_string(c.residual));
    }
    check(s->solved && s->converged, "the sketch solved and converged", "");
    const forge::ft::SketchEntityInfo* far = entityAt(*s, p2);
    const forge::ft::SketchEntityInfo* hole1 = entityAt(*s, c1);
    const forge::ft::SketchEntityInfo* hole2 = entityAt(*s, c2);
    check(far != nullptr && hole1 != nullptr && hole2 != nullptr, "the solved geometry reads back", "");
    if (far != nullptr) {
      checkNear(far->x0, 60.0, 1e-6, "the far corner is at x 60, not the 62 it was drawn at");
      checkNear(far->y0, 40.0, 1e-6, "and at y 40, not 43");
    }
    if (hole1 != nullptr) {
      checkNear(hole1->cx, 15.0, 1e-6, "the first hole centre is 15 from the corner");
      checkNear(hole1->radius, 5.0, 1e-6, "and 10 mm across, not the 7 it was drawn");
    }
    if (hole2 != nullptr) checkNear(hole2->radius, 5.0, 1e-6, "the second hole is 10 mm across too");
  }

  // ── 2. THE PLATE, WITH ITS HOLES, AND THE DIMENSION DRIVES IT ─────────────
  const auto plateVolume = [](double w) { return w * 40.0 * 10.0 - 2.0 * kPi * 25.0 * 10.0; };
  {
    const forge::desktop::IrBuildReport& r = scene.lastBuild();
    check(r.ok(), "the plate built from the solved sketch", r.error);
    std::printf("[gate] plate: volume %.3f, %ld faces, bbox %.3f x %.3f x %.3f\n", r.volume,
                r.faceCount, r.bboxMax[0] - r.bboxMin[0], r.bboxMax[1] - r.bboxMin[1],
                r.bboxMax[2] - r.bboxMin[2]);
    checkNear(r.bboxMax[0] - r.bboxMin[0], 60.0, 1e-3, "the plate is 60 wide");
    checkNear(r.bboxMax[1] - r.bboxMin[1], 40.0, 1e-3, "40 tall");
    checkNear(r.bboxMax[2] - r.bboxMin[2], 10.0, 1e-3, "and 10 thick");
    checkNear(r.volume, plateVolume(60.0), 0.5, "its volume is the plate MINUS two 10 mm holes");
    check(r.faceCount == 8, "six plane faces and two hole walls", std::to_string(r.faceCount));
  }

  if (g_mutation != 2) {
    check(frame.applySketchDimensionEdit(width, 80.0),
          "the Dimensions panel's edit path changes the width to 80", frame.lastSketchRefusal());
  }
  buildOneFrame(frame);
  {
    const forge::desktop::IrBuildReport& r = scene.lastBuild();
    check(r.ok(), "the plate rebuilt after the edit", r.error);
    std::printf("[gate] after the width edit: volume %.3f, bbox %.3f x %.3f\n", r.volume,
                r.bboxMax[0] - r.bboxMin[0], r.bboxMax[1] - r.bboxMin[1]);
    checkNear(r.bboxMax[0] - r.bboxMin[0], 80.0, 1e-3, "the solid MOVED: it is 80 wide");
    checkNear(r.bboxMax[1] - r.bboxMin[1], 40.0, 1e-3, "and still 40 tall");
    checkNear(r.volume, plateVolume(80.0), 0.5, "with the same two holes cut from it");
    const forge::ft::SketchInfo* s = frame.activeSketch();
    if (s != nullptr) {
      check(s->dof == 0, "the re-solved sketch is still fully constrained", std::to_string(s->dof));
      const forge::ft::SketchEntityInfo* far = entityAt(*s, p2);
      const forge::ft::SketchEntityInfo* hole2 = entityAt(*s, c2);
      if (far != nullptr) checkNear(far->x0, 80.0, 1e-6, "the far corner followed the width");
      if (hole2 != nullptr) {
        checkNear(hole2->cx, 45.0, 1e-6, "the second hole stayed where ITS dimension puts it");
      }
    }
  }

  // ── 3. A CONTRADICTION IS REFUSED, AND NAMED ──────────────────────────────
  const std::size_t recordsBefore = frame.document().records().size();
  const std::size_t undoBefore = shell.document().undoDepth;
  const double volumeBefore = scene.lastBuild().volume;
  const double contradicting = (g_mutation == 5) ? 80.0 : 70.0;
  std::string refusal;
  bool refused = false;
  if (g_mutation == 1) {
    // THE DEFECT, re-created: the same command against the same program, on a
    // document with no judge.
    forge::ui::PartDocument bare = frame.document();
    bare.setChangeJudge({});
    forge::ui::UndoStack bareUndo;
    forge::ui::CommandRegistry bareRegistry;
    forge::ui::registerPartCommands(bareRegistry, bare, bareUndo);
    pick({p0, p1});
    forge::ui::CommandParams p;
    p.setText("kind", "DISTX");
    p.setNumber("value", contradicting);
    const forge::ui::DispatchResult r = bareRegistry.dispatch("part.sketch_dimension", sel, p);
    refused = !r.ok();
    refusal = r.detail;
  } else {
    pick({p0, p1});
    forge::ui::CommandParams p;
    p.setText("kind", "DISTX");
    p.setNumber("value", contradicting);
    const forge::ui::DispatchResult r = shell.run("part.sketch_dimension", p);
    refused = !r.ok();
    refusal = r.detail;
  }
  std::printf("[gate] the contradicting width: %s\n", refused ? refusal.c_str() : "ACCEPTED");
  check(refused, "a second, contradicting width is REFUSED", refusal);
  check(contains(refusal, "Horizontal distance 70 mm"), "the refusal names the constraint it would add",
        refusal);
  check(contains(refusal, "Horizontal distance 80 mm") &&
            contains(refusal, "constraint " + std::to_string(width)),
        "and the constraint it contradicts, by value and by number", refusal);
  check(frame.document().records().size() == recordsBefore, "the document did not change",
        std::to_string(frame.document().records().size()));
  check(shell.document().undoDepth == undoBefore, "nothing was pushed onto the undo stack", "");
  buildOneFrame(frame);
  checkNear(scene.lastBuild().volume, volumeBefore, 1e-6, "and the part is untouched");

  // The Solver tab, drawn on the refused state: it says fully constrained and
  // shows what was refused.
  frame.setActiveTabAt({1, 0, 1}, 0);
  buildOneFrame(frame);
  {
    const std::vector<std::string>& drawn = frame.panelIdsDrawn();
    check(std::find(drawn.begin(), drawn.end(), std::string("solver_status")) != drawn.end(),
          "the Solver tab is on screen", "");
    check(frame.solverRowsDrawn() >= 5, "and draws the verdict, the freedom and the refusal",
          std::to_string(frame.solverRowsDrawn()));
    check(!frame.lastSketchRefusal().empty() || g_mutation == 1,
          "the refusal is still there for the user to read", "");
  }

  // ── the two edges that make it a judge ────────────────────────────────────
  // A REPEAT THAT AGREES is not a contradiction: accepted, and reported.
  {
    pick({p0, p1});
    forge::ui::CommandParams p;
    p.setText("kind", "DISTX");
    p.setNumber("value", 80.0);
    const forge::ui::DispatchResult r = shell.run("part.sketch_dimension", p);
    check(r.ok(), "a repeated width that AGREES is accepted", r.detail);
    const forge::ft::SketchInfo* s = frame.activeSketch();
    bool reported = false;
    if (s != nullptr) {
      for (const forge::ft::SketchConstraintInfo& c : s->constraints) {
        if (c.irId == static_cast<int>(frame.document().records().size()) &&
            (c.redundant || c.partiallyRedundant)) {
          reported = true;
        }
      }
    }
    check(reported, "and reported as repeating what is already there", "");
    check(shell.run("edit.undo").ok(), "and it can be undone like any edit", "");
  }
  // A KIND THAT CANNOT HOLD on what it names: Parallel on two points.
  {
    pick({p0, p1});
    forge::ui::CommandParams p;
    p.setText("kind", "PARA");
    const forge::ui::DispatchResult r = shell.run("part.sketch_constrain", p);
    check(!r.ok(), "Parallel on two points is refused", r.detail);
    check(contains(r.detail, "cannot hold"), "because it cannot hold on what it names", r.detail);
  }
  // UNDO still reaches the width edit, past both refusals: they left no step.
  check(shell.run("edit.undo").ok(), "undo reaches the width edit", "");
  buildOneFrame(frame);
  checkNear(scene.lastBuild().bboxMax[0] - scene.lastBuild().bboxMin[0], 60.0, 1e-3,
            "and puts the plate back to 60");

  std::printf("=== sketch solver gate: %d checks, %d failed ===\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
