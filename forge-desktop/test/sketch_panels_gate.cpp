// forge-desktop/test/sketch_panels_gate.cpp
//
// THE FOUR SKETCH PANELS, AGAINST A REAL SOLVED SKETCH — headless.
//
// Constraints, Dimensions, Relations and Curves are the tabs where parametric
// CAD actually starts, and the question this gate exists to answer is not "did
// they draw something". It is:
//
//   IS WHAT THEY SHOW THE MODEL, OR IS IT THE DRAWING?
//
// Those are different, and telling them apart is the whole job. A sketch is
// drawn with one set of numbers and SOLVED into another: a point typed at x=30
// under a Distance of 40 IS at 40, a circle drawn at r=4 under a Radius of 6 IS
// r=6. A panel that echoed the statement would print 30 and 4, look completely
// reasonable, and be wrong about the user's part. So the checks below are built
// around cases where the two answers DIFFER, and assert the solver's.
//
// The sketch is authored the way a user authors one: through the SAME command
// registry the menu dispatches, one command per gesture — New Sketch, Sketch
// Point, Sketch Line, Sketch Circle, Constrain, Solve — never by pasting IR.
//
// And the last check is the one that makes the Dimensions panel a feature rather
// than a display: it changes a dimension THROUGH THE PANEL'S OWN EDIT PATH and
// requires the compiled solid's bounding box to move by exactly that much. A
// number you can type into that does not move the part is a lie, and this is
// what makes that claim falsifiable.
//
// PROVING THE GATE CAN FAIL — `--mutate <n>`:
//   1  read the sketch from the STATEMENT instead of from the solver  -> the
//      "the solver moved it" checks go green on the wrong number
//   2  do not dispatch the dimension edit                             -> the
//      part does not change and "editing drives the model" goes red
//   3  never build a frame                                            -> the
//      panels draw no rows
//   4  inspect the sketch with the contradiction removed              -> the
//      conflict report has nothing to report
//   5  answer the label question with the raw keyword                 -> every
//      constraint would read as a shouted abbreviation
//   6  author the sketch without its constraints                      -> the
//      Constraints panel lists nothing and the sketch never solves
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
#include "forge/ui/PanelCatalog.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

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

void checkNear(double got, double want, double tol, const char* what) {
  ++g_checks;
  if (!(std::fabs(got - want) <= tol)) {
    ++g_failures;
    std::printf("  FAIL  %-58s  got %.6f want %.6f (+/- %.6f)\n", what, got, want, tol);
  }
}

// A headless ImGui context, byte-identical in setup to the one frame_gate uses:
// a real context with a NULL renderer backend is all a frame needs.
struct HeadlessImGui {
  HeadlessImGui(float w, float h) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(w, h);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "sketch_panels_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

ImDrawData* buildOneFrame(forge::desktop::ForgeFrame& frame) {
  ImGui::NewFrame();
  if (g_mutation != 3) frame.build(0, 1.0f);
  ImGui::Render();
  return ImGui::GetDrawData();
}

forge::ui::EntityRef ref(const std::string& node, forge::ui::EntityKind kind,
                         const std::string& name) {
  forge::ui::EntityRef r;
  r.bodyId = node;
  r.kind = kind;
  r.persistentName = name;
  return r;
}

void selectOnly(forge::ui::SelectionService& sel, const std::vector<forge::ui::EntityRef>& refs) {
  sel.replaceWith(refs);
}

const forge::ft::SketchConstraintInfo* constraintAt(const forge::ft::SketchInfo& s, int irId) {
  for (const forge::ft::SketchConstraintInfo& c : s.constraints) {
    if (c.irId == irId) return &c;
  }
  return nullptr;
}

const forge::ft::SketchEntityInfo* entityAt(const forge::ft::SketchInfo& s, int irId) {
  for (const forge::ft::SketchEntityInfo& e : s.entities) {
    if (e.irId == irId) return &e;
  }
  return nullptr;
}

const forge::ft::SketchDimensionInfo* dimensionAt(const forge::ft::SketchInfo& s, int irId) {
  for (const forge::ft::SketchDimensionInfo& d : s.dimensions) {
    if (d.irId == irId) return &d;
  }
  return nullptr;
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[gate] MUTATION %d ACTIVE\n", g_mutation);

  // ── 0. every keyword the kernel dispatches is a word a person can read ───
  {
    const std::vector<forge::ft::ConKeyword>& kws = forge::ft::conKeywords();
    checkGe(kws.size(), 19u, "the kernel dispatches the whole census keyword set");
    for (const forge::ft::ConKeyword& k : kws) {
      const std::string word = k.word;
      const std::string label =
          g_mutation == 5 ? word : forge::desktop::sketchConstraintLabel(word);
      if (label == word) {
        std::printf("  the constraint keyword %s has no words a user can read\n", word.c_str());
      }
      check(label != word, "every constraint keyword reads as words", word);
    }
    std::printf("[gate] %zu constraint keywords, each with a name a user reads\n", kws.size());
  }

  // ── 0b. the panels tell the user what to press, BY ITS REAL NAME ─────────
  // The empty states say "Start one with New Sketch" and the header says "Use
  // Solve Sketch". Those are command LABELS, and a label that has been renamed
  // leaves a panel telling a user to press something that is not there. Pinned
  // against the registry so a rename turns this red rather than turning the
  // instruction into a dead end.
  {
    forge::ui::ForgeShell probeShell;
    forge::ui::PartDocument probeDoc;
    forge::ui::UndoStack probeStack;
    forge::ui::registerPartCommands(probeShell.registry(), probeDoc, probeStack);
    const std::pair<const char*, const char*> named[] = {
        {"part.sketch_new", "New Sketch"},
        {"part.sketch_solve", "Solve Sketch"},
        {"part.sketch_entity_point", "Sketch Point"},
        {"part.sketch_entity_line", "Sketch Line"},
        {"part.sketch_constrain_single", "Constrain Entity"},
        {"part.sketch_constrain", "Constrain Entity Pair"},
    };
    for (const auto& n : named) {
      const forge::ui::CommandDescriptor* d = probeShell.registry().find(n.first);
      check(d != nullptr && d->label == n.second,
            "the panels name this command as the registry does",
            std::string(n.first) + " -> " + (d == nullptr ? "(absent)" : d->label));
    }
  }

  // ── 1. the application, exactly as it starts ─────────────────────────────
  forge::desktop::KernelScene scene;
  const bool built = scene.build();
  check(built, "the starting part builds", scene.error());
  if (!built) {
    std::printf("[gate] cannot continue without a kernel\n");
    return 1;
  }

  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();
  forge::ui::SelectionService& sel = shell.selection();

  // A document with no sketch in it is a state the panels must SAY, not fake.
  checkEq(frame.activeSketchIrId(), 0, "no sketch yet: the panels have nothing to describe");
  shell.setWorkspace(forge::ui::WorkspaceProfile::Sketch);
  buildOneFrame(frame);
  checkEq(frame.sketchConstraintRowsDrawn(), 0u, "no sketch: the Constraints panel invents none");
  checkEq(frame.sketchDimensionRowsDrawn(), 0u, "no sketch: the Dimensions panel invents none");
  checkEq(frame.sketchCurveRowsDrawn(), 0u, "no sketch: the Curves panel invents none");

  // ── 2. author a sketch THROUGH THE REGISTRY, one gesture at a time ───────
  //
  // Every number typed below is DELIBERATELY NOT the number the part ends up
  // with. The rectangle is drawn 30 x 18 and constrained 40 x 25; the circle is
  // drawn at r4 and constrained to r6. If any panel echoed the statement instead
  // of reading the solver, every check after this would catch it.
  // START FROM AN EMPTY DOCUMENT. The application opens on a seeded plate, and a
  // sketch extruded beside it leaves those five statements contributing nothing
  // to the result -- which the kernel's own graph audit refuses outright
  // ("unexplained_orphans"). Emptying first is what a user does when they start
  // a part from a sketch, and it is the only way this gate can measure the SOLID
  // the sketch produced rather than a box standing next to it.
  {
    std::string err;
    check(frame.documentReset(err), "the document can be emptied to start from a sketch", err);
  }
  // READ, not assumed: the statement numbering below is relative to whatever the
  // document already holds, so this gate does not quietly depend on the reset
  // having left it at exactly zero.
  const int base = static_cast<int>(frame.document().records().size());
  checkEq(base, 0, "an emptied document holds no statements");
  const auto irId = [base](int n) { return base + n; };
  const auto sketchNode = [&](int n) { return "opensketch_" + std::to_string(irId(n)); };
  const auto ok = [&](const char* id, const forge::ui::CommandParams& p, const char* what) {
    const forge::ui::DispatchResult r = shell.run(id, p);
    check(r.ok(), what, r.detail);
    return r.ok();
  };
  const auto num2 = [](const char* a, double av, const char* b, double bv) {
    forge::ui::CommandParams p;
    p.setNumber(a, av);
    p.setNumber(b, bv);
    return p;
  };

  sel.clearSelection();
  ok("part.sketch_new", {}, "New Sketch");
  const int sketchIr = irId(1);

  // Four corners, drawn 30 x 18.
  selectOnly(sel, {ref(sketchNode(1), forge::ui::EntityKind::OpenSketch, "sk")});
  ok("part.sketch_entity_point", num2("x", 0, "y", 0), "Sketch Point 1");
  selectOnly(sel, {ref(sketchNode(1), forge::ui::EntityKind::OpenSketch, "sk")});
  ok("part.sketch_entity_point", num2("x", 30, "y", 0), "Sketch Point 2");
  selectOnly(sel, {ref(sketchNode(1), forge::ui::EntityKind::OpenSketch, "sk")});
  ok("part.sketch_entity_point", num2("x", 30, "y", 18), "Sketch Point 3");
  selectOnly(sel, {ref(sketchNode(1), forge::ui::EntityKind::OpenSketch, "sk")});
  ok("part.sketch_entity_point", num2("x", 0, "y", 18), "Sketch Point 4");
  const int p0 = irId(2), p1 = irId(3), p2 = irId(4), p3 = irId(5);

  const auto line = [&](int a, int b, const char* what) {
    selectOnly(sel, {ref("sketchref_" + std::to_string(a), forge::ui::EntityKind::SketchRef, "a"),
                     ref("sketchref_" + std::to_string(b), forge::ui::EntityKind::SketchRef, "b")});
    ok("part.sketch_entity_line", {}, what);
  };
  line(p0, p1, "Sketch Line bottom");
  line(p1, p2, "Sketch Line right");
  line(p2, p3, "Sketch Line top");
  line(p3, p0, "Sketch Line left");
  const int lBottom = irId(6), lRight = irId(7), lTop = irId(8), lLeft = irId(9);

  // A circle on the far corner, DRAWN AT 4.
  selectOnly(sel, {ref("sketchref_" + std::to_string(p2), forge::ui::EntityKind::SketchRef, "c")});
  forge::ui::CommandParams rad;
  rad.setNumber("radius", 4.0);
  ok("part.sketch_entity_circle", rad, "Sketch Circle");
  const int circle = irId(10);

  // The constraints. MUTATION 6 skips them, which is what makes "the panel lists
  // the constraints" a claim about the panel rather than about the number zero.
  int conDistX = 0, conDistY = 0;
  (void)conDistY;
  if (g_mutation != 6) {
    const auto single = [&](int e, const char* kind, const char* what) {
      selectOnly(sel,
                 {ref("sketchref_" + std::to_string(e), forge::ui::EntityKind::SketchRef, "e")});
      forge::ui::CommandParams p;
      p.setText("kind", kind);
      ok("part.sketch_constrain_single", p, what);
    };
    const auto pair = [&](int a, int b, const char* kind, bool withValue, double value,
                          const char* what) {
      selectOnly(sel,
                 {ref("sketchref_" + std::to_string(a), forge::ui::EntityKind::SketchRef, "a"),
                  ref("sketchref_" + std::to_string(b), forge::ui::EntityKind::SketchRef, "b")});
      forge::ui::CommandParams p;
      p.setText("kind", kind);
      if (withValue) p.setNumber("distance", value);
      ok("part.sketch_constrain", p, what);
    };
    single(lBottom, "HORIZ", "Constrain bottom horizontal");
    single(lTop, "HORIZ", "Constrain top horizontal");
    single(lRight, "VERT", "Constrain right vertical");
    single(lLeft, "VERT", "Constrain left vertical");
    // 30 x 18 as drawn, 40 x 25 as constrained.
    pair(p0, p1, "DIST", true, 40.0, "Constrain width 40");
    conDistX = static_cast<int>(frame.document().records().size());
    pair(p0, p3, "DIST", true, 25.0, "Constrain height 25");
    conDistY = static_cast<int>(frame.document().records().size());
  }

  selectOnly(sel, {ref(sketchNode(1), forge::ui::EntityKind::OpenSketch, "sk")});
  ok("part.sketch_solve", {}, "Solve Sketch");

  // ── 3. the panels describe THIS sketch ───────────────────────────────────
  checkEq(frame.activeSketchIrId(), sketchIr, "the panels are looking at the sketch just drawn");
  const forge::ft::SketchInfo* s = frame.activeSketch();
  check(s != nullptr, "the sketch reads back", "");
  if (s == nullptr) {
    std::printf("=== %d checks, %d failed ===\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
  }
  std::printf("[gate] sketch %%%d: %zu entities, %zu constraints, %zu dimensions, dof %d\n",
              s->irId, s->entities.size(), s->constraints.size(), s->dimensions.size(), s->dof);

  checkEq(s->entities.size(), 9u, "every point, line and circle is listed");
  if (g_mutation != 6) {
    checkEq(s->constraints.size(), 6u, "every constraint is listed");
    checkEq(s->dimensions.size(), 3u, "two distances and the circle's radius are dimensions");
  }

  // ── 4. WHAT THE SOLVER DID, not what was typed ───────────────────────────
  //
  // This is the load-bearing block. Every number here differs from the statement
  // that produced it, so a panel echoing the drawing cannot pass it.
  if (g_mutation != 6) {
    // WHAT IS ASSERTED IS THE CONSTRAINED QUANTITY, not a coordinate. This
    // rectangle carries no anchor, so the solver is free to satisfy 40 x 25
    // anywhere on the plane and at any orientation -- and it does: the corner
    // typed at (30, 0) comes back at x = 32.3. Asserting the coordinate would be
    // asserting a solution the solver never promised, and it would go red on any
    // planegcs update for a sketch that is perfectly correct. The LENGTH is what
    // the constraint says, so the length is what this checks.
    const forge::ft::SketchEntityInfo* bottom = entityAt(*s, lBottom);
    check(bottom != nullptr && bottom->hasLength, "a line reports the length it now has", "");
    if (bottom != nullptr) {
      checkNear((g_mutation == 1) ? 30.0 : bottom->length, 40.0, 1e-6,
                "the bottom line measures the constrained 40, not the drawn 30");
    }
    const forge::ft::SketchEntityInfo* left = entityAt(*s, lLeft);
    check(left != nullptr && left->hasLength, "the second line reports its length", "");
    if (left != nullptr) {
      checkNear((g_mutation == 1) ? 18.0 : left->length, 25.0, 1e-6,
                "the left line measures the constrained 25, not the drawn 18");
    }
    // The SOLVED distance the dimension reached, computed from the two solved
    // points -- the number the Dimensions panel prints beside the one that was
    // asked for.
    const forge::ft::SketchDimensionInfo* dx = dimensionAt(*s, conDistX);
    check(dx != nullptr && dx->hasSolvedValue, "the width dimension reports what it reached", "");
    if (dx != nullptr && dx->hasSolvedValue) {
      checkNear((g_mutation == 1) ? dx->value : dx->solvedValue, 40.0, 1e-6,
                "and it reached the 40 it asked for");
    }
    // Every applied constraint is satisfied. The residual is the solver's own,
    // so this is the solver reporting on itself rather than the gate re-deriving
    // geometry it has no business re-deriving.
    for (const forge::ft::SketchConstraintInfo& c : s->constraints) {
      if (c.state != forge::ft::SketchConstraintState::Applied || c.demoted) continue;
      check(c.hasResidual && std::fabs(c.residual) < 1e-6,
            "every applied constraint is satisfied after the solve",
            c.keyword + " residual " + (c.hasResidual ? std::to_string(c.residual) : "-"));
    }
    // Two Distances plus four Horizontal/Vertical do NOT pin a rectangle: it can
    // still slide and it can still rotate as a whole. The solver says how much,
    // and it is not a number this gate is allowed to guess -- so what is asserted
    // is that the answer is REPORTED and that it is the answer for a sketch that
    // is not yet fully held.
    checkGe(s->dof, 1, "the solver reports the freedom this sketch really has");
    check(s->health == forge::ft::SketchHealth::UnderConstrained,
          "a rectangle with no anchor is reported as still able to move",
          std::to_string(static_cast<int>(s->health)));
    check(s->solved && s->converged, "the sketch solved", "");
  }

  // The circle: DRAWN at 4, and nothing constrains it, so it stays 4 -- and the
  // panel reports the radius it READ, with the drawn value beside it. The
  // Radius-constraint case (drawn 4, driven to 6) is the second sketch below.
  const forge::ft::SketchEntityInfo* circ = entityAt(*s, circle);
  check(circ != nullptr && circ->hasRadius, "a circle reports the radius it now has", "");
  if (circ != nullptr) {
    checkNear(circ->radius, 4.0, 1e-9, "an unconstrained circle keeps the radius it was drawn at");
    checkNear(circ->length, 2.0 * 3.14159265358979323846 * 4.0, 1e-6,
              "its circumference is measured from that radius");
  }

  // ── 5. THE PANELS DRAW IT ────────────────────────────────────────────────
  // The Sketch workspace puts Constraints beside the sketch tree on the left and
  // Dimensions / Relations on the right. Each tab is made active and a real frame
  // is built, so the assertion is about the panel the user sees.
  const auto drawPanel = [&](const std::vector<std::size_t>& path, std::size_t tab,
                             const char* panelId) {
    frame.setActiveTabAt(path, tab);
    ImDrawData* d = buildOneFrame(frame);
    const std::vector<std::string>& drawn = frame.panelIdsDrawn();
    check(d != nullptr && d->TotalVtxCount > 500, "the frame draws", panelId);
    check(std::find(drawn.begin(), drawn.end(), panelId) != drawn.end(), "the tab is on screen",
          panelId);
  };

  drawPanel({0}, 1, "constraints");
  if (g_mutation != 6) {
    checkEq(frame.sketchConstraintRowsDrawn(), s->constraints.size(),
            "the Constraints panel draws one row per constraint");
  }
  drawPanel({1, 1}, 0, "dimensions");
  if (g_mutation != 6) {
    checkEq(frame.sketchDimensionRowsDrawn(), s->dimensions.size(),
            "the Dimensions panel draws one row per dimension");
  }
  drawPanel({1, 1}, 2, "relations");
  checkGe(frame.sketchRelationRowsDrawn(), 1u, "the Relations panel draws what can move");
  // Curves lives in the Surface workspace, beside the feature tree.
  shell.setWorkspace(forge::ui::WorkspaceProfile::Surface);
  drawPanel({0}, 1, "curve_list");
  checkEq(frame.sketchCurveRowsDrawn(), s->entities.size(),
          "the Curves panel draws one row per entity");
  shell.setWorkspace(forge::ui::WorkspaceProfile::Sketch);

  // The catalogue and the frame builder agree that these four have content.
  for (const char* id : {"constraints", "dimensions", "relations", "curve_list"}) {
    const forge::ui::PanelInfo* info = forge::ui::findPanelInfo(id);
    check(info != nullptr && info->live(), "the catalogue calls this panel live", id);
  }

  // ── 6. A DIMENSION EDIT MOVES THE PART ───────────────────────────────────
  //
  // The claim under test is not "the field accepts a number". It is that the
  // number drives GEOMETRY, so the reference is the SOLID: a second sketch is
  // authored, solved, extruded, and the box measured before and after.
  //
  // WHY A SECOND SKETCH RATHER THAN THE ONE ABOVE. That one carries a circle,
  // and a solved profile with a circle in it has TWO closed loops; the extrude
  // consumes the first, which is the circle, so the box it produces measures the
  // circle and not the rectangle. Measuring it anyway would have been a check
  // that passed for the wrong reason -- it was 8.000 mm, the circle's diameter,
  // and it looked like a rectangle's width being wrong. The rectangle gets a
  // document of its own so the number under test is unambiguous.
  //
  // The four Horizontal / Vertical constraints are what make the measurement
  // valid at all: they hold the rectangle axis-aligned, so its X extent IS the
  // constrained width whatever the remaining freedom does with its position.
  if (g_mutation != 6) {
    std::string err;
    check(frame.documentReset(err), "a second document, for the measurement", err);
    sel.clearSelection();
    ok("part.sketch_new", {}, "New Sketch (rectangle only)");
    const std::string sk = "opensketch_1";
    for (const auto& xy : std::vector<std::pair<double, double>>{
             {0, 0}, {30, 0}, {30, 18}, {0, 18}}) {
      selectOnly(sel, {ref(sk, forge::ui::EntityKind::OpenSketch, "sk")});
      ok("part.sketch_entity_point", num2("x", xy.first, "y", xy.second), "Sketch Point");
    }
    const int q0 = 2, q1 = 3, q2 = 4, q3 = 5;
    const auto line2 = [&](int a, int b) {
      selectOnly(sel,
                 {ref("sketchref_" + std::to_string(a), forge::ui::EntityKind::SketchRef, "a"),
                  ref("sketchref_" + std::to_string(b), forge::ui::EntityKind::SketchRef, "b")});
      ok("part.sketch_entity_line", {}, "Sketch Line");
    };
    line2(q0, q1);
    line2(q1, q2);
    line2(q2, q3);
    line2(q3, q0);
    const auto single2 = [&](int e, const char* kind) {
      selectOnly(sel,
                 {ref("sketchref_" + std::to_string(e), forge::ui::EntityKind::SketchRef, "e")});
      forge::ui::CommandParams p;
      p.setText("kind", kind);
      ok("part.sketch_constrain_single", p, "Constrain");
    };
    single2(6, "HORIZ");
    single2(8, "HORIZ");
    single2(7, "VERT");
    single2(9, "VERT");
    const auto dist2 = [&](int a, int b, double v) {
      selectOnly(sel,
                 {ref("sketchref_" + std::to_string(a), forge::ui::EntityKind::SketchRef, "a"),
                  ref("sketchref_" + std::to_string(b), forge::ui::EntityKind::SketchRef, "b")});
      forge::ui::CommandParams p;
      p.setText("kind", "DIST");
      p.setNumber("distance", v);
      ok("part.sketch_constrain", p, "Constrain Distance");
    };
    dist2(q0, q1, 40.0);
    const int widthCon = static_cast<int>(frame.document().records().size());
    dist2(q0, q3, 25.0);
    selectOnly(sel, {ref(sk, forge::ui::EntityKind::OpenSketch, "sk")});
    ok("part.sketch_solve", {}, "Solve Sketch");
    const int profile = static_cast<int>(frame.document().records().size());
    selectOnly(sel, {ref("sketch_" + std::to_string(profile), forge::ui::EntityKind::Sketch, "p")});
    forge::ui::CommandParams ex;
    ex.setNumber("distance", 5.0);
    ok("part.extrude", ex, "Extrude the solved sketch");
    buildOneFrame(frame);

    check(scene.lastBuild().ok(), "the part built from the solved sketch",
          scene.lastBuild().error);
    const float widthBefore = scene.bounds().max[0] - scene.bounds().min[0];
    const float heightBefore = scene.bounds().max[1] - scene.bounds().min[1];
    checkNear(widthBefore, 40.0, 0.2, "the solid is as wide as the constrained sketch");
    checkNear(heightBefore, 25.0, 0.2, "and as tall");

    const int index = frame.sketchDimensionNumberIndex(widthCon);
    checkEq(index, 0, "the width dimension has exactly one number to change");
    const forge::ft::SketchInfo* live = frame.activeSketch();
    check(live != nullptr, "the second sketch reads back", "");
    const forge::ft::SketchDimensionInfo* dim =
        live == nullptr ? nullptr : dimensionAt(*live, widthCon);
    check(dim != nullptr && dim->driving, "the width dimension is driving the part", "");
    if (dim != nullptr) {
      checkNear(dim->value, 40.0, 1e-9, "the panel shows the width that is in the part");
    }

    if (g_mutation != 2) {
      check(frame.applySketchDimensionEdit(widthCon, 60.0),
            "the Dimensions panel's edit path runs", "");
    }
    buildOneFrame(frame);
    const float widthAfter = scene.bounds().max[0] - scene.bounds().min[0];
    const float heightAfter = scene.bounds().max[1] - scene.bounds().min[1];
    std::printf("[gate] the solid: %.3f x %.3f mm  ->  %.3f x %.3f mm after the edit\n",
                static_cast<double>(widthBefore), static_cast<double>(heightBefore),
                static_cast<double>(widthAfter), static_cast<double>(heightAfter));
    checkNear(widthAfter, 60.0, 0.2, "editing the dimension MOVED THE SOLID");
    // The other axis is UNTOUCHED. Without this the check above would pass for a
    // rebuild that scaled the whole part, which is a different bug wearing the
    // same number.
    checkNear(heightAfter, 25.0, 0.2, "and moved only the dimension that was edited");

    // The panel now reports the new number, because the reading is re-taken from
    // the program rather than cached behind a flag somebody has to set.
    const forge::ft::SketchInfo* after = frame.activeSketch();
    check(after != nullptr, "the sketch still reads back after the edit", "");
    if (after != nullptr) {
      const forge::ft::SketchDimensionInfo* d2 = dimensionAt(*after, widthCon);
      check(d2 != nullptr, "the edited dimension is still listed", "");
      if (d2 != nullptr) {
        checkNear(d2->value, 60.0, 1e-9, "the panel shows the number that is now in the part");
        check(d2->hasSolvedValue, "and the distance the solver actually reached", "");
        if (d2->hasSolvedValue) checkNear(d2->solvedValue, 60.0, 1e-6, "which is the same 60");
      }
    }
    // Undo reaches it: the edit went through the one registry, so it is on the
    // one stack -- a panel that wrote to the document itself would not be.
    check(shell.run("edit.undo").ok(), "undo reaches a dimension edit", "");
    buildOneFrame(frame);
    checkNear(scene.bounds().max[0] - scene.bounds().min[0], 40.0, 0.2,
              "undo puts the part back");
  }

  // ── 7. A SECOND SKETCH, WHERE A CONSTRAINT OVERRIDES A DRAWN NUMBER ──────
  // Drawn r4, constrained RADIUS 6. This is the case the Dimensions panel's
  // "the part uses 6" line exists for, and it is unreachable from the command
  // registry (which offers nine keywords, not RADIUS) — so it is driven through
  // the kernel reader directly, on the same program text a document holds.
  {
    const std::string program =
        "%1 = SKETCH(XY)\n"
        "%2 = SPT(%1, 0, 0)\n"
        "%3 = SCIRC(%2, 4)\n"
        "%4 = CON(%3, RADIUS, 6)\n"
        "%5 = SOLVE(%1)\n";
    const forge::ft::SketchInspection insp = forge::ft::inspectSketchesText(program);
    check(insp.ok && insp.sketches.size() == 1, "the reader reads a constrained radius",
          insp.error);
    if (insp.sketches.size() == 1) {
      const forge::ft::SketchInfo& s2 = insp.sketches.front();
      const forge::ft::SketchEntityInfo* c2 = entityAt(s2, 3);
      check(c2 != nullptr && c2->hasRadius && c2->hasWrittenRadius, "the circle reads back", "");
      if (c2 != nullptr) {
        checkNear(c2->writtenRadius, 4.0, 1e-9, "the statement still says 4");
        checkNear((g_mutation == 1) ? c2->writtenRadius : c2->radius, 6.0, 1e-6,
                  "and the part is 6, because a constraint drives it");
      }
      const forge::ft::SketchDimensionInfo* d2 = dimensionAt(s2, 3);
      check(d2 != nullptr && d2->hasSolvedValue, "the drawn radius is listed as a dimension", "");
      if (d2 != nullptr) {
        checkNear(d2->value, 4.0, 1e-9, "listed at what the statement says");
        checkNear((g_mutation == 1) ? d2->value : d2->solvedValue, 6.0, 1e-6,
                  "beside what the part actually measures");
      }
    }
  }

  // ── 8. A CONTRADICTION IS REPORTED, NOT SWALLOWED ────────────────────────
  // Two points made Coincident AND 10 mm apart. The repair drops one so the rest
  // of the sketch still solves, and the Constraints panel has to say which and
  // why — a repair the user cannot see is a part that quietly is not what they
  // asked for.
  {
    const std::string clash =
        "%1 = SKETCH(XY)\n"
        "%2 = SPT(%1, 0, 0)\n"
        "%3 = SPT(%1, 5, 0)\n"
        "%4 = CON(%2, COINC, %3)\n" +
        std::string(g_mutation == 4 ? "" : "%5 = CON(%2, DIST, %3, 10)\n") +
        (g_mutation == 4 ? "%5 = SOLVE(%1)\n" : "%6 = SOLVE(%1)\n");
    const forge::ft::SketchInspection insp = forge::ft::inspectSketchesText(clash);
    check(insp.ok && insp.sketches.size() == 1, "the contradictory sketch reads back", insp.error);
    if (insp.sketches.size() == 1) {
      const forge::ft::SketchInfo& s3 = insp.sketches.front();
      std::size_t flagged = 0, dropped = 0;
      for (const forge::ft::SketchConstraintInfo& c : s3.constraints) {
        if (c.conflicting) ++flagged;
        if (c.demoted) ++dropped;
      }
      checkGe(flagged, 2u, "both sides of the contradiction are named");
      checkEq(dropped, 1u, "exactly one was dropped so the rest could solve");
      for (const forge::ft::SketchConstraintInfo& c : s3.constraints) {
        if (!c.demoted) continue;
        check(c.demotedForConflict, "and it says the reason was a contradiction", c.keyword);
      }
    }
  }

  // ── 9. A CONSTRAINT THE SOLVER NEVER SAW IS SAID SO ──────────────────────
  // The compiler tolerates an unknown keyword and a mistyped operand -- one bad
  // statement must not cost a 200-statement tree -- so both are states a live
  // sketch can be in, and both have to be visible rather than looking applied.
  {
    const std::string odd =
        "%1 = SKETCH(XY)\n"
        "%2 = SPT(%1, 0, 0)\n"
        "%3 = SPT(%1, 5, 0)\n"
        "%4 = CON(%2, FLANGE, %3)\n"
        "%5 = CON(%2, PTON, %3)\n"
        "%6 = SOLVE(%1)\n";
    const forge::ft::SketchInspection insp = forge::ft::inspectSketchesText(odd);
    check(insp.sketches.size() == 1, "the tolerated sketch reads back", insp.error);
    if (insp.sketches.size() == 1) {
      const forge::ft::SketchInfo& s4 = insp.sketches.front();
      const forge::ft::SketchConstraintInfo* unknown = constraintAt(s4, 4);
      const forge::ft::SketchConstraintInfo* refused = constraintAt(s4, 5);
      check(unknown != nullptr &&
                unknown->state == forge::ft::SketchConstraintState::UnknownKind,
            "an unknown constraint is listed as not applied", "");
      check(refused != nullptr && refused->state == forge::ft::SketchConstraintState::Rejected,
            "a constraint the solver refused is listed as not applied", "");
      check(unknown != nullptr && !unknown->hasResidual,
            "and neither is given an error it never had", "");
    }
  }

  std::printf("=== %d checks, %d failed ===\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
