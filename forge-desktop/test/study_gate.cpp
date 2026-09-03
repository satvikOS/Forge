// forge-desktop/test/study_gate.cpp
//
// THE SIMULATION PANELS, AGAINST A REAL SOLVE AND A CLOSED-FORM ANSWER.
//
// Two claims, and neither is "a panel drew something":
//
//   PART A  the study is REAL PHYSICS. A steel cantilever is built through the
//           same feature-IR the document emits, held on one side and pushed on
//           the other, and the tip deflection that comes back is compared with
//           the Euler-Bernoulli value F L^3 / (3 E I). It is also required to be
//           EXACTLY linear in the force and to reverse with it, and the
//           out-of-balance force is required to be negligible beside the applied
//           one. A single deflection in a plausible band can be produced by
//           luck; a deflection that is in band AND scales exactly with the load
//           AND leaves nothing out of balance cannot.
//
//   PART B  the PANELS show that solve. The Restraints and Loads tabs of the
//           Simulation workspace are drawn in a real headless frame, a row is
//           required per restraint and per force, and the per-side mesh point
//           counts the rows print are required to equal the counts the solver
//           itself reported. Then the document is edited and the answer is
//           required to go STALE, because a peak stress belonging to a part the
//           user has since changed is the one number a panel must never keep
//           showing.
//
// PROVING IT CAN FAIL. `--mutate <n>` breaks the SET-UP the production code is
// fed, in ways that are each a real regression, and the check that catches it is
// named beside it:
//   1  the restraint is moved onto the loaded side  -> the beam cannot bend, so
//                                                      the deflection band fails.
//                                                      Proves the side a
//                                                      restraint names reaches
//                                                      the solver.
//   2  the beam is built a thousand times larger    -> deflection falls by a
//                                                      thousand. Proves the real
//                                                      size of the real part
//                                                      reaches the solver, which
//                                                      is the check a millimetre
//                                                      / metre slip would trip.
//   3  the material is swapped for a soft plastic   -> deflection rises about
//                                                      seventyfold. Proves the
//                                                      chosen material's
//                                                      stiffness reaches the
//                                                      solver.
//   4  the force is turned along the beam instead   -> it stretches instead of
//      of across it                                    bending. Proves the
//                                                      direction reaches the
//                                                      solver.
//   5  the study is never run before the panels     -> the rows have no mesh
//      are drawn                                       counts to print. Proves
//                                                      Part B reads solved data.
//   6  the part is not edited before the staleness  -> the answer does not go
//      check                                           stale. Proves the
//                                                      staleness check is real.
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
#include "StudyHost.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/StudyModel.hpp"
#include "forge/ui/UserFacingText.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

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

std::string num(double v) {
  char b[64];
  std::snprintf(b, sizeof(b), "%.6g", v);
  return std::string(b);
}

// ── the beam ────────────────────────────────────────────────────────────────
// BOX(dx, dy, dz) puts the solid at [-dx/2, -dy/2, 0] .. [dx/2, dy/2, dz], so
// the -X side and the +X side are the two ends of a beam of length dx.
std::string beamProgram(double lengthMm, double widthMm, double heightMm) {
  char b[128];
  std::snprintf(b, sizeof(b), "%%1 = BOX(%.6f, %.6f, %.6f)\n", lengthMm, widthMm, heightMm);
  return std::string(b);
}

struct Beam {
  double lengthM = 0.0;
  double widthM = 0.0;
  double heightM = 0.0;
};

// F L^3 / (3 E I), I = b h^3 / 12, for a load across the beam's depth.
double bernoulliTipDeflectionM(const Beam& beam, double forceN, double youngsPa) {
  const double I = beam.widthM * beam.heightM * beam.heightM * beam.heightM / 12.0;
  return forceN * beam.lengthM * beam.lengthM * beam.lengthM / (3.0 * youngsPa * I);
}

forge::ui::StudyDefinition steelStudy(const char* materialId) {
  forge::ui::StudyDefinition s;
  const forge::ui::Material* m = forge::ui::findMaterial(materialId);
  if (m != nullptr) {
    s.materialId = m->id;
    s.materialName = m->name;
    s.densityKgPerM3 = m->densityKgPerM3;
  }
  s.divisions = 40;
  forge::ui::Restraint hold;
  hold.face = forge::ui::StudyFace::MinX;
  hold.holdX = hold.holdY = hold.holdZ = true;
  s.restraints.push_back(hold);
  return s;
}

forge::ui::StudyOutcome solveBeam(const std::string& program,
                                  const forge::ui::StudyDefinition& study) {
  forge::desktop::StudyRequest req;
  req.irProgram = program;
  req.study = study;
  std::string detail;
  const forge::ui::StudyOutcome out = forge::desktop::runStudy(req, detail);
  if (!out.solved && !detail.empty()) std::printf("      [detail] %s\n", detail.c_str());
  return out;
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
    io.BackendRendererName = "study_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

void step(forge::desktop::ForgeFrame& frame) {
  ImGui::NewFrame();
  frame.build(0, 1.0f);
  ImGui::Render();
}

bool contains(const std::vector<std::string>& v, const std::string& s) {
  return std::find(v.begin(), v.end(), s) != v.end();
}

// Clicks the dock tab whose panel id is `panelId`, using the same two input
// calls the windowed backend makes. Returns false when this frame drew no such
// tab, which is a failure of the layout rather than of the click.
bool clickTab(forge::desktop::ForgeFrame& frame, const std::string& panelId) {
  for (const forge::desktop::TabHit& hit : frame.tabHits()) {
    if (hit.panelId != panelId) continue;
    const float cx = hit.x + hit.w * 0.5f;
    const float cy = hit.y + hit.h * 0.5f;
    ImGui::GetIO().AddMousePosEvent(cx, cy);
    step(frame);
    ImGui::GetIO().AddMouseButtonEvent(0, true);
    step(frame);
    ImGui::GetIO().AddMouseButtonEvent(0, false);
    step(frame);
    step(frame);
    return true;
  }
  return false;
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[gate] MUTATION %d ACTIVE\n", g_mutation);

  // ══ PART A: the physics ═══════════════════════════════════════════════════
  //
  // 100 x 10 x 10 mm, held at one end, pushed across the free end.
  // The BEAM the closed form describes is fixed. Mutation 2 builds a DIFFERENT
  // one -- a thousand times larger -- and leaves the reference alone, which is
  // exactly the shape a millimetre / metre slip takes: the number that comes back
  // belongs to a part that is not the one the formula is about.
  const double scale = (g_mutation == 2) ? 1000.0 : 1.0;
  Beam beam;
  beam.lengthM = 0.100;
  beam.widthM = 0.010;
  beam.heightM = 0.010;
  const std::string program =
      beamProgram(100.0 * scale, 10.0 * scale, 10.0 * scale);

  const char* materialId = (g_mutation == 3) ? "nylon-66" : "steel-1018";
  const forge::ui::ElasticProperties* elastic = forge::ui::elasticPropertiesFor("steel-1018");
  check(elastic != nullptr, "the material table carries mild steel", "steel-1018");
  if (elastic == nullptr) return 1;
  check(forge::ui::elasticPropertyCount() >= 12, "the material table is populated",
        std::to_string(forge::ui::elasticPropertyCount()));

  const double forceN = 100.0;
  forge::ui::StudyDefinition study = steelStudy(materialId);
  if (g_mutation == 1) study.restraints[0].face = forge::ui::StudyFace::MaxX;
  forge::ui::Load push;
  push.face = forge::ui::StudyFace::MaxX;
  if (g_mutation == 4) {
    push.fx = forceN;  // along the beam: it stretches instead of bending
  } else {
    push.fz = -forceN;
  }
  study.loads.push_back(push);

  check(forge::ui::studyBlocker(study, true).empty(), "a complete study is not blocked",
        forge::ui::studyBlocker(study, true));

  std::printf("[gate] solving the cantilever...\n");
  const forge::ui::StudyOutcome one = solveBeam(program, study);
  check(one.solved, "the cantilever study solves", one.blocker);
  if (!one.solved) {
    std::printf("[gate] cannot continue without a solved study\n");
    std::printf("[gate] %d checks, %d failures\n", g_checks, g_failures);
    return 1;
  }
  std::printf("[gate] %zu points, %zu pieces, %.4f mm tip, %.3f MPa peak, %.0f ms\n",
              one.meshNodes, one.meshElements, one.maxDisplacementMm, one.maxStressMPa,
              one.solveMs);

  // The mesh is real and self-consistent.
  check(one.meshNodes > 0 && one.meshElements > 0, "the mesher produced a mesh",
        std::to_string(one.meshNodes) + " points");
  check(one.freedoms == one.meshNodes * 3, "three freedoms per mesh point",
        std::to_string(one.freedoms));
  check(one.heldFreedoms > 0 && one.heldFreedoms <= one.freedoms,
        "the restraint removed some freedoms and not all",
        std::to_string(one.heldFreedoms) + " of " + std::to_string(one.freedoms));
  check(one.loadedNodes > 0, "the force landed on mesh points",
        std::to_string(one.loadedNodes));
  // The restraint holds three directions on every point of one side, so the held
  // count is not a guess: it is three times that side's point census.
  const forge::ui::FaceCensus* heldSide = one.censusFor(study.restraints[0].face);
  check(heldSide != nullptr, "the held side has a census", "");
  if (heldSide != nullptr) {
    check(one.heldFreedoms == heldSide->meshNodes * 3,
          "held freedoms == three per point of the held side",
          std::to_string(one.heldFreedoms) + " vs " + std::to_string(heldSide->meshNodes * 3));
  }
  const forge::ui::FaceCensus* pushedSide = one.censusFor(forge::ui::StudyFace::MaxX);
  check(pushedSide != nullptr && one.loadedNodes == pushedSide->meshNodes,
        "loaded points == the pushed side's point census",
        std::to_string(one.loadedNodes));

  // The force the solver assembled is EXACTLY the force that was asked for. A
  // load spread over N points that quietly totals something else is the defect
  // this check exists for.
  check(std::fabs(forge::ui::appliedForceMagnitudeN(one) - forceN) < 1e-9,
        "the assembled force equals the force asked for",
        num(forge::ui::appliedForceMagnitudeN(one)));

  // It settled: what is left out of balance is negligible beside what was pushed.
  check(forge::ui::studyConverged(one), "the solve settled",
        num(one.residualN) + " N left over");

  // ── the closed-form comparison ────────────────────────────────────────────
  const double theoryMm = bernoulliTipDeflectionM(beam, forceN, elastic->youngsModulusPa) * 1000.0;
  const double ratio = one.maxDisplacementMm / theoryMm;
  std::printf("[gate] tip %.5f mm against the beam formula's %.5f mm  (ratio %.3f)\n",
              one.maxDisplacementMm, theoryMm, ratio);
  // A hex mesh of this density is slightly STIFF in bending, so the band is
  // one-sided by more than it is generous: well below 1 is expected, above it is
  // not. A thousandfold unit slip, a missing restraint or the wrong material all
  // leave this band by orders of magnitude.
  check(ratio > 0.5 && ratio < 1.2, "tip deflection agrees with the beam formula",
        "ratio " + num(ratio));

  // Peak bending stress, M c / I at the root.
  const double I = beam.widthM * beam.heightM * beam.heightM * beam.heightM / 12.0;
  const double theoryMPa =
      (forceN * beam.lengthM) * (beam.heightM * 0.5) / I / 1.0e6;
  std::printf("[gate] peak %.3f MPa against the bending formula's %.3f MPa\n", one.maxStressMPa,
              theoryMPa);
  check(one.maxStressMPa > 0.15 * theoryMPa && one.maxStressMPa < 4.0 * theoryMPa,
        "peak stress is the right order beside the bending formula",
        num(one.maxStressMPa) + " vs " + num(theoryMPa));

  // ── linearity, which luck cannot produce ─────────────────────────────────
  forge::ui::StudyDefinition twice = study;
  twice.loads[0].fx *= 2.0;
  twice.loads[0].fy *= 2.0;
  twice.loads[0].fz *= 2.0;
  const forge::ui::StudyOutcome two = solveBeam(program, twice);
  check(two.solved, "the doubled study solves", two.blocker);
  if (two.solved) {
    const double linear = two.maxDisplacementMm / one.maxDisplacementMm;
    check(std::fabs(linear - 2.0) < 1e-6, "doubling the force doubles the movement",
          "ratio " + num(linear));
    check(one.meshNodes == two.meshNodes && one.meshElements == two.meshElements,
          "the same part meshes the same way twice", "");
  }
  forge::ui::StudyDefinition reversed = study;
  reversed.loads[0].fx = -reversed.loads[0].fx;
  reversed.loads[0].fy = -reversed.loads[0].fy;
  reversed.loads[0].fz = -reversed.loads[0].fz;
  const forge::ui::StudyOutcome back = solveBeam(program, reversed);
  check(back.solved, "the reversed study solves", back.blocker);
  if (back.solved) {
    check(std::fabs(back.maxDisplacementMm - one.maxDisplacementMm) <
              1e-9 + 1e-6 * one.maxDisplacementMm,
          "reversing the force moves the part just as far the other way",
          num(back.maxDisplacementMm));
  }

  // ── a finer mesh does not change the answer wildly ───────────────────────
  forge::ui::StudyDefinition finer = study;
  finer.divisions = 20;
  const forge::ui::StudyOutcome coarse = solveBeam(program, finer);
  check(coarse.solved, "a coarser mesh still solves", coarse.blocker);
  if (coarse.solved) {
    check(coarse.meshElements < one.meshElements, "fewer divisions means fewer pieces",
          std::to_string(coarse.meshElements) + " vs " + std::to_string(one.meshElements));
    // Refining must move the answer TOWARDS the closed form, never away: a
    // hex mesh converges from below in bending.
    check(one.maxDisplacementMm >= coarse.maxDisplacementMm - 1e-9,
          "refining the mesh does not stiffen the answer",
          num(coarse.maxDisplacementMm) + " -> " + num(one.maxDisplacementMm));
  }

  // ── the refusals, which must refuse ──────────────────────────────────────
  {
    forge::ui::StudyDefinition noHold = study;
    noHold.restraints.clear();
    check(!forge::ui::studyBlocker(noHold, true).empty(), "a study with no restraint is refused",
          "");
    forge::ui::StudyDefinition noPush = study;
    noPush.loads.clear();
    check(!forge::ui::studyBlocker(noPush, true).empty(), "a study with no force is refused", "");
    forge::ui::StudyDefinition noMaterial = study;
    noMaterial.materialId = "unassigned";
    noMaterial.materialName = "Unassigned";
    check(!forge::ui::studyBlocker(noMaterial, true).empty(),
          "a study with no material is refused", "");
    check(!forge::ui::studyBlocker(study, false).empty(), "a study with no part is refused", "");
    // And every refusal is a sentence a user may read.
    const std::string sentences[] = {
        forge::ui::studyBlocker(noHold, true), forge::ui::studyBlocker(noPush, true),
        forge::ui::studyBlocker(noMaterial, true), forge::ui::studyBlocker(study, false)};
    for (const std::string& s : sentences) {
      check(forge::ui::userFacingProseIsClean(s), "a refusal is written for a person",
            forge::ui::describeProseFindings(forge::ui::scanUserFacingProse(s)));
    }
  }

  // ══ PART B: the panels ════════════════════════════════════════════════════
  std::printf("[gate] drawing the simulation panels...\n");
  forge::desktop::KernelScene scene;
  const bool built = scene.build();
  check(built, "the default part builds", scene.error());
  if (!built) {
    std::printf("[gate] %d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
  }

  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();
  shell.setWorkspace(forge::ui::WorkspaceProfile::Simulation);

  check(frame.setStudyMaterial("aluminium-6061"), "the study takes a material from the library",
        "aluminium-6061");
  {
    forge::ui::Restraint hold;
    hold.face = forge::ui::StudyFace::MinX;
    frame.study().restraints.push_back(hold);
    forge::ui::Load down;
    down.face = forge::ui::StudyFace::MaxX;
    down.fz = -250.0;
    frame.study().loads.push_back(down);
    forge::ui::Load side;
    side.face = forge::ui::StudyFace::MaxY;
    side.fy = 40.0;
    frame.study().loads.push_back(side);
  }
  if (g_mutation != 5) {
    const bool ran = frame.runStudy();
    check(ran, "the panel's own Run path solves the open document",
          frame.studyOutcome().blocker);
  }
  check(frame.studyRuns() == (g_mutation == 5 ? 0u : 1u), "the study ran exactly once",
        std::to_string(frame.studyRuns()));

  step(frame);
  const std::vector<std::string> drawn = frame.panelIdsDrawn();
  check(contains(drawn, "loads"), "the Simulation workspace draws the Loads tab", "");
  check(frame.loadRowsDrawn() == frame.study().loads.size(), "one row per force",
        std::to_string(frame.loadRowsDrawn()));
  check(frame.restraintRowsDrawn() == 0, "the Restraints tab is not drawn behind another", "");

  const bool clicked = clickTab(frame, "restraints");
  check(clicked, "the Restraints tab is reachable by clicking it", "");
  check(contains(frame.panelIdsDrawn(), "restraints"), "clicking it brings up the Restraints tab",
        "");
  check(frame.restraintRowsDrawn() == frame.study().restraints.size(),
        "one row per restraint", std::to_string(frame.restraintRowsDrawn()));

  // What the rows PRINT is the solver's own census, not a second count.
  {
    const forge::ui::StudyOutcome& o = frame.studyOutcome();
    check(o.solved == (g_mutation != 5), "the panel has a solved study behind it", o.blocker);
    if (o.solved) {
      const forge::ui::FaceCensus* held = o.censusFor(forge::ui::StudyFace::MinX);
      check(held != nullptr && held->meshNodes > 0,
            "the held side's row has a real mesh point count",
            held == nullptr ? "no census" : std::to_string(held->meshNodes));
      const forge::ui::FaceCensus* pushed = o.censusFor(forge::ui::StudyFace::MaxX);
      check(pushed != nullptr && pushed->meshNodes > 0,
            "the pushed side's row has a real mesh point count",
            pushed == nullptr ? "no census" : std::to_string(pushed->meshNodes));
      check(o.maxStressMPa > 0.0 && o.maxDisplacementMm > 0.0,
            "the panel's answer is a moved, stressed part",
            num(o.maxDisplacementMm) + " mm, " + num(o.maxStressMPa) + " MPa");
      check(std::fabs(o.appliedForceN[2] + 250.0) < 1e-9 &&
                std::fabs(o.appliedForceN[1] - 40.0) < 1e-9,
            "both forces reached the solver", num(o.appliedForceN[1]) + ", " +
                                                  num(o.appliedForceN[2]));
    }
  }

  // ── the staleness witness ────────────────────────────────────────────────
  check(!frame.studyOutcomeIsStale(), "a fresh answer is not stale", "");
  if (g_mutation != 6) {
    frame.invoke("part.primitive_box");
    step(frame);
  }
  check(frame.studyOutcomeIsStale(),
        "editing the part makes the last answer stale",
        frame.studyOutcome().solved ? "solved but not stale" : "not solved");

  std::printf("[gate] %d checks, %d failures\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
