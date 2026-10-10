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
//
//   PART C  the MODAL study is real physics. The same steel cantilever is asked
//           for its eight lowest natural frequencies through the same seam
//           (forge::desktop::runStudy, StudyKind::Modal). Each mode is
//           identified from its OWN shape (bending along Y or Z, twisting,
//           stretching) and compared with its closed form: Euler-Bernoulli for
//           the first two bending pairs, Saint-Venant torsion of a square
//           section, and the axial bar. The first frequency is also checked
//           against the STATIC study's own tip stiffness (Part A) through the
//           Euler-Bernoulli effective mass, so the modal mass and the static
//           stiffness cannot be wrong together unnoticed. Doubling every
//           dimension must halve every frequency, and a material with the same
//           Poisson ratio must scale every frequency by sqrt(E / rho); both are
//           exact, and luck cannot produce them. Three mesh resolutions are
//           solved and the first frequency must converge.
//
//   PART D  the steady THERMAL study is real physics. A bar held at 100 C and
//           20 C must reproduce the straight-line temperature at EVERY node and
//           conduct k A dT / L through each end, read off the nodal reactions;
//           a bar generating heat with both ends at 20 C must peak at
//           T0 + q L^2 / 8k mid-way and send half the heat out of each end; and
//           a square plate with one hot side must converge towards the
//           superposition answer of a quarter of the difference at its centre.
//           In every case the heat in, the heat out and the heat generated must
//           balance.
//
//   7  the modal beam is built half as long again   -> every bending frequency
//      as the closed forms assume                      falls to about 0.44 of
//                                                      itself. Proves the real
//                                                      length reaches the modal
//                                                      solve. (150 mm, not 200:
//                                                      200 mm at 40 across lands
//                                                      in the size band the
//                                                      kernel solves slowly, and
//                                                      the mutation would go red
//                                                      on that refusal instead.)
//   8  the modal beam is made of nylon              -> frequencies fall to a
//                                                      third. Proves the chosen
//                                                      material's stiffness and
//                                                      density reach it.
//   9  the modal restraint holds the end along Z    -> the beam is free to slide
//      only                                            and swing in Y: no first
//                                                      bending pair at the beam
//                                                      frequency. Proves the
//                                                      restraint's directions
//                                                      reach the eigen-solve.
//  10  only two modes are asked for                 -> the second bending pair,
//                                                      the torsion and the axial
//                                                      mode are missing. Proves
//                                                      the mode count reaches it.
//  11  the thermal bar is built a thousand times    -> the conducted heat falls
//      larger                                          a thousandfold. Proves a
//                                                      millimetre / metre slip
//                                                      cannot pass.
//  12  the thermal bar is made of aluminium         -> about three times the
//                                                      heat. Proves the chosen
//                                                      conductivity reaches the
//                                                      solve.
//  13  both ends of the thermal bar are held at     -> nothing flows. Proves the
//      100 C                                           second side's temperature
//                                                      reaches the solve.
//  14  the generating bar is given no heat           -> it stays at 20 C. Proves
//                                                      the heat generated
//                                                      reaches the solve.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
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

// ── PART C/D helpers ────────────────────────────────────────────────────────
forge::ui::StudyOutcome solveKind(const std::string& program,
                                  const forge::ui::StudyDefinition& study) {
  forge::desktop::StudyRequest req;
  req.irProgram = program;
  req.study = study;
  std::string detail;
  const forge::ui::StudyOutcome out = forge::desktop::runStudy(req, detail);
  if (!out.solved && !detail.empty()) std::printf("      [detail] %s\n", detail.c_str());
  return out;
}

forge::ui::StudyDefinition modalStudy(const char* materialId, int divisions, int modes) {
  forge::ui::StudyDefinition s = steelStudy(materialId);
  s.kind = forge::ui::StudyKind::Modal;
  s.divisions = divisions;
  s.modeCount = modes;
  return s;
}

forge::ui::StudyDefinition thermalStudy(const char* materialId, int divisions) {
  forge::ui::StudyDefinition s;
  const forge::ui::Material* m = forge::ui::findMaterial(materialId);
  if (m != nullptr) {
    s.materialId = m->id;
    s.materialName = m->name;
    s.densityKgPerM3 = m->densityKgPerM3;
  }
  s.kind = forge::ui::StudyKind::Thermal;
  s.divisions = divisions;
  return s;
}

double rel(double got, double want) {
  return std::fabs(got - want) / std::max(std::fabs(want), 1e-300);
}

// Euler-Bernoulli cantilever roots beta_n L of cos(bL) cosh(bL) = -1.
constexpr double kBeta1L = 1.8751040687119611;
constexpr double kBeta2L = 4.6940911329741745;
constexpr double kPi = 3.14159265358979323846;

// The n-th Euler-Bernoulli bending frequency of a square-section cantilever.
double bernoulliHz(double betaL, double lengthM, double sideM, double E, double rho) {
  const double I = sideM * sideM * sideM * sideM / 12.0;
  const double A = sideM * sideM;
  return betaL * betaL / (2.0 * kPi * lengthM * lengthM) * std::sqrt(E * I / (rho * A));
}

// The first Saint-Venant torsion frequency of a fixed-free square bar:
//   f = (1 / 4L) sqrt(G J / (rho Ip)),  J = 0.1406 a^4,  Ip = a^4 / 6.
double torsionHz(double lengthM, double E, double nu, double rho) {
  const double G = E / (2.0 * (1.0 + nu));
  const double JoverIp = 0.1406 * 6.0;
  return std::sqrt(G * JoverIp / rho) / (4.0 * lengthM);
}

// The first axial frequency of a fixed-free bar: f = (1 / 4L) sqrt(E / rho).
double axialHz(double lengthM, double E, double rho) {
  return std::sqrt(E / rho) / (4.0 * lengthM);
}

// ── the bands, and where each one comes from ───────────────────────────────
// MEASURED on the 100 x 10 x 10 mm mild-steel cantilever, 40 bricks along
// (T-340 evidence, study_gate_r1.log / r2.log):
//   first bending   812.802 Hz  / Euler-Bernoulli 814.344 Hz  = 0.99811
//   second bending 4888.37 Hz   / Euler-Bernoulli 5103.40 Hz  = 0.9579
//   first torsion  7404.36 Hz   / Saint-Venant    7206.0 Hz   = 1.0275
//   first axial   12645.12 Hz   / bar formula    12602.82 Hz  = 1.00336
//   static cross-check 812.802 / 813.651 Hz                   = 0.99896
// Each band holds the measured value with room, and refuses the errors that
// matter: a units slip is orders of magnitude, a wrong material a factor of
// three, a wrong length a factor of four.
//   * first bending: shear and rotary inertia LOWER a 10:1 beam's first mode
//     slightly below Euler-Bernoulli; a value above it by more than 1% would be
//     a stiffness or mass error, not a modelling choice.
//   * second bending: the same effects lower the second mode several per cent
//     (Timoshenko); it must sit BELOW Euler-Bernoulli and not far below.
//   * torsion: four bricks across the section over-stiffen the warping, and
//     the held end stops warping altogether; both raise the FE value above the
//     free-warping Saint-Venant one. Up to 5% above is accepted, below is not.
//   * axial: Poisson contraction is restrained at the held end, a small rise.
constexpr double kBend1Low = 0.97, kBend1High = 1.01;
constexpr double kBend2Low = 0.92, kBend2High = 0.99;
constexpr double kTwistLow = 0.99, kTwistHigh = 1.05;
constexpr double kAxialLow = 0.99, kAxialHigh = 1.02;
constexpr double kStaticCrossBand = 0.01;
// The square plate's centre, 40 across: measured -0.0228 K off 25 C.
constexpr double kPlateCentreBandK = 0.05;

// The index of the first mode of a character (and, for bending, a direction),
// or -1.
int findMode(const forge::ui::StudyOutcome& o, forge::ui::ModeCharacter c, int direction,
             int startAt) {
  for (std::size_t i = static_cast<std::size_t>(startAt); i < o.modes.size(); ++i) {
    if (o.modes[i].motion.character != c) continue;
    if (direction >= 0 && o.modes[i].motion.direction != direction) continue;
    return static_cast<int>(i);
  }
  return -1;
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
  // THE BAND WAS 0.15x .. 4.0x -- 26.7-fold, wide enough that a stress number
  // three times wrong passes, which is exactly the error class a staircase voxel
  // mesh produces at a fillet or a bore. A user reads the MPa figure this gate is
  // the only check on.
  //
  // MEASURED, five consecutive runs, identical to four decimals:
  //
  //   peak 43.402 MPa   theory (M c / I) 60.000 MPa   ratio 0.7234
  //
  // 28% UNDER is expected and is not the defect: a coarse hex mesh under-predicts
  // peak stress at a stress concentration, while displacement converges fast --
  // the tip ratio above is 1.002. So the band is one-sided on purpose. Below 1 has
  // room for the mesh to coarsen; ABOVE 1 has almost none, because a coarse mesh
  // over-predicting the peak is a defect rather than a modelling choice.
  //
  // 0.60 .. 1.10 is 1.83-fold. It still passes today's 0.7234 with ~17% of headroom
  // beneath it, and it now REFUSES the 2x and 3x errors the old band accepted.
  const double stressRatio = one.maxStressMPa / theoryMPa;
  check(stressRatio > 0.60 && stressRatio < 1.10,
        "peak stress agrees with the bending formula",
        num(one.maxStressMPa) + " vs " + num(theoryMPa) + "  ratio " + num(stressRatio));

  // WHAT THE TIGHTENING BUYS, asserted rather than claimed. Each of these is a
  // value the OLD band accepted; a band is only worth changing if the change is
  // shown to reject something.
  {
    auto oldBand = [&](double mpa) { return mpa > 0.15 * theoryMPa && mpa < 4.0 * theoryMPa; };
    auto newBand = [&](double mpa) {
      const double r = mpa / theoryMPa;
      return r > 0.60 && r < 1.10;
    };
    check(oldBand(3.0 * theoryMPa) && !newBand(3.0 * theoryMPa),
          "a 3x OVER-prediction passed the old band and is refused now", "ratio 3.00");
    check(oldBand(0.25 * theoryMPa) && !newBand(0.25 * theoryMPa),
          "a 4x UNDER-prediction passed the old band and is refused now", "ratio 0.25");
    check(oldBand(2.0 * theoryMPa) && !newBand(2.0 * theoryMPa),
          "a 2x OVER-prediction passed the old band and is refused now", "ratio 2.00");
    check(newBand(one.maxStressMPa),
          "and the value this solver actually produces still passes", num(stressRatio));
  }

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

  // ══ PART C: the modal study ══════════════════════════════════════════════
  //
  // The cantilever of Part A -- 100 x 10 x 10 mm mild steel held on its -X end
  // -- asked for its eight lowest natural frequencies. The CLOSED FORMS are
  // about the beam the comparison names (100 mm long). Mutation 7 builds a
  // different one and leaves the reference alone.
  {
    std::printf("[gate] PART C: solving the cantilever's natural frequencies...\n");
    const double L = 0.100, a = 0.010;
    const forge::ui::ElasticProperties* st = forge::ui::elasticPropertiesFor("steel-1018");
    const forge::ui::Material* stm = forge::ui::findMaterial("steel-1018");
    check(st != nullptr && stm != nullptr, "mild steel carries stiffness and density", "");
    if (st == nullptr || stm == nullptr) return 1;
    const double E = st->youngsModulusPa, nu = st->poissonRatio, rho = stm->densityKgPerM3;

    const std::string modalProgram =
        g_mutation == 7 ? beamProgram(150.0, 10.0, 10.0) : beamProgram(100.0, 10.0, 10.0);
    forge::ui::StudyDefinition modal =
        modalStudy(g_mutation == 8 ? "nylon-66" : "steel-1018", 40, g_mutation == 10 ? 2 : 8);
    if (g_mutation == 9) {
      modal.restraints[0].holdX = false;
      modal.restraints[0].holdY = false;
    }
    check(forge::ui::studyBlocker(modal, true).empty(), "a complete modal study is not blocked",
          forge::ui::studyBlocker(modal, true));
    // A modal study needs no force: the set-up above has none.
    check(modal.loads.empty(), "the modal study carries no force", "");

    const forge::ui::StudyOutcome m = solveKind(modalProgram, modal);
    check(m.solved, "the modal study solves", m.blocker);
    check(m.kind == forge::ui::StudyKind::Modal, "the answer says it is a modal one", "");
    if (m.solved) {
      std::printf("[gate] %zu points, %zu pieces, %zu freedoms (%zu held), %.1f ms, mass %.6f kg\n",
                  m.meshNodes, m.meshElements, m.freedoms, m.heldFreedoms, m.solveMs,
                  m.meshMassKg);
      for (std::size_t i = 0; i < m.modes.size(); ++i) {
        const forge::ui::NaturalMode& md = m.modes[i];
        std::printf("[gate]   mode %zu  %10.2f Hz  %-22s share x %.3f y %.3f z %.3f twist %.3f\n",
                    i + 1, md.frequencyHz, md.motion.describe().c_str(), md.motion.share[0],
                    md.motion.share[1], md.motion.share[2], md.motion.twist);
      }
    }
    if (m.solved) {
      check(m.modesRequested == modal.modeCount, "the answer records how many modes were asked",
            std::to_string(m.modesRequested));
      check(m.modes.size() == 8, "eight modes came back", std::to_string(m.modes.size()));
      check(m.modeShapes.size() == m.modes.size(), "one shape per mode",
            std::to_string(m.modeShapes.size()));
      bool ascending = true, positive = true;
      for (std::size_t i = 0; i < m.modes.size(); ++i) {
        if (!(m.modes[i].frequencyHz > 0.0)) positive = false;
        if (i > 0 && m.modes[i].frequencyHz < m.modes[i - 1].frequencyHz) ascending = false;
        // f = sqrt(omega^2) / 2 pi, exactly as the solver's value says.
        check(std::fabs(m.modes[i].frequencyHz - std::sqrt(m.modes[i].eigenvalue) / (2.0 * kPi)) <=
                  1e-12 * m.modes[i].frequencyHz,
              "each frequency is the solver's own omega^2 converted", num(m.modes[i].frequencyHz));
      }
      check(ascending, "the modes come lowest first", "");
      check(positive, "every frequency of a held part is above zero", "");

      // The mass that vibrates is the mass of the part: a box meshes exactly.
      // 1e-6, not round-off: the mesher sizes its bricks off the kernel's bounding
      // box, which carries the shape's 1e-7 mm tolerance on each side.
      check(rel(m.meshMassKg, rho * L * a * a) < 1e-6, "the vibrating mass is the beam's mass",
            num(m.meshMassKg) + " kg vs " + num(rho * L * a * a));
      check(rel(m.meshVolumeMm3, m.partVolumeMm3) < 1e-6,
            "a box's bricks fill exactly the box", num(m.meshVolumeMm3) + " vs " +
                                                       num(m.partVolumeMm3));

      // ── every shape is fixed where the beam is held, and scaled to 1 ──────
      // The held side's nodes are read off the solved surface's coordinates: the
      // -X end is the smallest x of the mesh.
      const std::vector<double>& xyz = m.surface.nodesMm;
      check(xyz.size() == m.meshNodes * 3, "the drawn surface carries every mesh node",
            std::to_string(xyz.size() / 3));
      double xMin = 1e300;
      for (std::size_t n = 0; n < xyz.size() / 3; ++n) xMin = std::min(xMin, xyz[3 * n]);
      for (std::size_t k = 0; k < m.modeShapes.size(); ++k) {
        const std::vector<double>& sh = m.modeShapes[k];
        double heldMax = 0.0, peak = 0.0;
        for (std::size_t n = 0; n < sh.size() / 3; ++n) {
          const double mag = std::sqrt(sh[3 * n] * sh[3 * n] + sh[3 * n + 1] * sh[3 * n + 1] +
                                       sh[3 * n + 2] * sh[3 * n + 2]);
          peak = std::max(peak, mag);
          if (std::fabs(xyz[3 * n] - xMin) < 1e-9) heldMax = std::max(heldMax, mag);
        }
        check(heldMax == 0.0, "a mode shape does not move the held end", num(heldMax));
        check(std::fabs(peak - 1.0) < 1e-12, "a mode shape's furthest point moves exactly 1",
              num(peak));
      }

      // ── the first bending pair: Euler-Bernoulli ────────────────────────────
      // A square section bends equally in Y and in Z, so the two lowest modes are
      // one of each at one frequency. Euler-Bernoulli ignores shear and rotary
      // inertia, which lower a 10:1 beam's first frequency by well under 1%; the
      // band is therefore tight above 1 and allows that below.
      const double eb1 = bernoulliHz(kBeta1L, L, a, E, rho);
      const double eb2 = bernoulliHz(kBeta2L, L, a, E, rho);
      // The pair: the two lowest modes both bend, at one frequency, and between
      // them they move the beam along Y and along Z. Which mixture of the two
      // directions each one is, the solver is free to choose -- any mixture of
      // two modes at one frequency is a mode -- so it is the PAIR that is
      // checked, not each member's direction.
      auto pairAt = [&](int first, const char* what, double ref, double lowBand,
                        double highBand) -> bool {
        if (first < 0 || first + 1 >= static_cast<int>(m.modes.size())) {
          check(false, what, "not found");
          return false;
        }
        const forge::ui::NaturalMode& p = m.modes[static_cast<std::size_t>(first)];
        const forge::ui::NaturalMode& q = m.modes[static_cast<std::size_t>(first + 1)];
        const bool bothBend = p.motion.character == forge::ui::ModeCharacter::Bending &&
                              q.motion.character == forge::ui::ModeCharacter::Bending;
        const double spanY = p.motion.share[1] + q.motion.share[1];
        const double spanZ = p.motion.share[2] + q.motion.share[2];
        std::printf("[gate] %s %.3f / %.3f Hz against Euler-Bernoulli %.3f Hz (ratio %.5f); "
                    "the pair moves Y %.3f, Z %.3f\n",
                    what, p.frequencyHz, q.frequencyHz, ref, p.frequencyHz / ref, spanY, spanZ);
        check(bothBend, what, "both members bend");
        check(rel(p.frequencyHz, q.frequencyHz) < 1e-3,
              "a square beam bends at one frequency either way",
              num(p.frequencyHz) + " vs " + num(q.frequencyHz));
        check(spanY > forge::ui::kModeShareThreshold && spanZ > forge::ui::kModeShareThreshold,
              "the pair moves the beam along both Y and Z", num(spanY) + ", " + num(spanZ));
        check(p.frequencyHz / ref > lowBand && p.frequencyHz / ref < highBand, what,
              "ratio " + num(p.frequencyHz / ref));
        return true;
      };
      const int first = findMode(m, forge::ui::ModeCharacter::Bending, -1, 0);
      check(first == 0, "the lowest mode of a cantilever bends", std::to_string(first));
      pairAt(first, "first bending", eb1, kBend1Low, kBend1High);
      const int second =
          first >= 0 ? findMode(m, forge::ui::ModeCharacter::Bending, -1, first + 2) : -1;
      pairAt(second, "second bending", eb2, kBend2Low, kBend2High);
      const int y1 = first;
      // ── torsion and stretching ─────────────────────────────────────────────
      const int tw = findMode(m, forge::ui::ModeCharacter::Twisting, 0, 0);
      const int ax = findMode(m, forge::ui::ModeCharacter::Stretching, 0, 0);
      check(tw >= 0, "a twisting mode about the beam's axis is found", "");
      check(ax >= 0, "a stretching mode along the beam's axis is found", "");
      if (tw >= 0) {
        const double f = m.modes[static_cast<std::size_t>(tw)].frequencyHz;
        const double ref = torsionHz(L, E, nu, rho);
        std::printf("[gate] torsion %.3f Hz against Saint-Venant %.3f Hz (ratio %.5f)\n", f, ref,
                    f / ref);
        check(f / ref > kTwistLow && f / ref < kTwistHigh,
              "the torsion frequency agrees with Saint-Venant", "ratio " + num(f / ref));
      }
      if (ax >= 0) {
        const double f = m.modes[static_cast<std::size_t>(ax)].frequencyHz;
        const double ref = axialHz(L, E, rho);
        std::printf("[gate] axial %.3f Hz against the bar formula %.3f Hz (ratio %.5f)\n", f, ref,
                    f / ref);
        check(f / ref > kAxialLow && f / ref < kAxialHigh,
              "the axial frequency agrees with the bar formula", "ratio " + num(f / ref));
      }

      // ── the modal mass against the STATIC stiffness ────────────────────────
      // Part A's own path, unmutated: k = F / tip. For an Euler-Bernoulli
      // cantilever omega1^2 = k / m_eff with m_eff = 3 m / (beta1 L)^4.
      if (y1 >= 0) {
        forge::ui::StudyDefinition stat = steelStudy("steel-1018");
        forge::ui::Load tip;
        tip.face = forge::ui::StudyFace::MaxX;
        tip.fz = -100.0;
        stat.loads.push_back(tip);
        const forge::ui::StudyOutcome so = solveBeam(beamProgram(100.0, 10.0, 10.0), stat);
        // (the same 40 bricks along, so stiffness and mass come off one mesh)
        check(so.solved, "the cross-check's static study solves", so.blocker);
        if (so.solved) {
          const double k = 100.0 / (so.maxDisplacementMm / 1000.0);
          const double meff = 3.0 * rho * L * a * a / std::pow(kBeta1L, 4.0);
          const double fs = std::sqrt(k / meff) / (2.0 * kPi);
          const double f1 = m.modes[static_cast<std::size_t>(y1)].frequencyHz;
          std::printf("[gate] first frequency from the static tip stiffness %.3f Hz, modal %.3f Hz "
                      "(ratio %.5f)\n", fs, f1, f1 / fs);
          check(rel(f1, fs) < kStaticCrossBand,
                "the modal answer agrees with the static study's stiffness",
                "ratio " + num(f1 / fs));
        }
      }

      // ── similarity: twice the size, half the frequency ─────────────────────
      {
        const forge::ui::StudyOutcome big =
            solveKind(beamProgram(200.0, 20.0, 20.0), modalStudy("steel-1018", 40, 8));
        check(big.solved && big.modes.size() == m.modes.size(),
              "the doubled beam solves to as many modes", big.blocker);
        if (big.solved && big.modes.size() == m.modes.size()) {
          double worst = 0.0;
          for (std::size_t i = 0; i < m.modes.size(); ++i) {
            worst = std::max(worst, rel(big.modes[i].frequencyHz, 0.5 * m.modes[i].frequencyHz));
          }
          std::printf("[gate] doubled beam: worst relative miss of half the frequency %.3g\n",
                      worst);
          check(worst < 1e-6, "doubling every dimension halves every frequency", num(worst));
        }
      }
      // ── material: same Poisson ratio, every frequency scales by sqrt(E/rho) ─
      {
        const forge::ui::ElasticProperties* s2 = forge::ui::elasticPropertiesFor("steel-4140");
        const forge::ui::Material* s2m = forge::ui::findMaterial("steel-4140");
        check(s2 != nullptr && s2m != nullptr && s2->poissonRatio == nu,
              "alloy steel has mild steel's Poisson ratio", "");
        if (s2 != nullptr && s2m != nullptr) {
          const double factor =
              std::sqrt((s2->youngsModulusPa / s2m->densityKgPerM3) / (E / rho));
          const forge::ui::StudyOutcome alloy =
              solveKind(beamProgram(100.0, 10.0, 10.0), modalStudy("steel-4140", 40, 8));
          check(alloy.solved && alloy.modes.size() == m.modes.size(),
                "the alloy beam solves to as many modes", alloy.blocker);
          if (alloy.solved && alloy.modes.size() == m.modes.size()) {
            double worst = 0.0;
            for (std::size_t i = 0; i < m.modes.size(); ++i) {
              worst = std::max(worst, rel(alloy.modes[i].frequencyHz,
                                          factor * m.modes[i].frequencyHz));
            }
            std::printf("[gate] alloy steel: factor %.6f, worst relative miss %.3g\n", factor,
                        worst);
            check(worst < 1e-6, "every frequency scales by sqrt(E / rho)", num(worst));
          }
        }
      }

      // ── the surface the mode shape is drawn on ─────────────────────────────
      // 40 x 4 x 4 bricks: 2 (40*4 + 4*4 + 40*4) outside faces, 4 (40 + 4 + 4)
      // crease segments along the box's twelve edges, and by Euler's formula
      // V - E + F = 2 the outside edges are V + F - 2 with V = 41*5*5 - 39*3*3.
      check(m.surface.quadCount() == 672, "the drawn surface is the mesh's outside",
            std::to_string(m.surface.quadCount()));
      check(m.surface.creaseCount() == 192, "its corners are the box's twelve edges",
            std::to_string(m.surface.creaseCount()));
      check(m.surface.edgeCount() == 674 + 672 - 2, "its edges satisfy Euler's formula",
            std::to_string(m.surface.edgeCount()));
      if (!m.modeShapes.empty()) {
        const double amp = forge::ui::modeDisplayAmplitudeMm(100.0);
        const std::vector<forge::ui::Segment3> rest =
            forge::ui::modeShapeSegments(m.surface, m.modeShapes[0], amp, 0.0, true);
        const std::vector<forge::ui::Segment3> peak =
            forge::ui::modeShapeSegments(m.surface, m.modeShapes[0], amp, kPi / 2.0, true);
        check(rest.size() == 192 && peak.size() == 192, "one drawn segment per crease",
              std::to_string(peak.size()));
        double moved = 0.0, heldMoved = 0.0;
        for (std::size_t i = 0; i < rest.size() && i < peak.size(); ++i) {
          for (int e = 0; e < 2; ++e) {
            const double* p0 = e == 0 ? rest[i].a : rest[i].b;
            const double* p1 = e == 0 ? peak[i].a : peak[i].b;
            const double d = std::sqrt((p1[0] - p0[0]) * (p1[0] - p0[0]) +
                                       (p1[1] - p0[1]) * (p1[1] - p0[1]) +
                                       (p1[2] - p0[2]) * (p1[2] - p0[2]));
            moved = std::max(moved, d);
            if (std::fabs(p0[0] - xMin) < 1e-9) heldMoved = std::max(heldMoved, d);
          }
        }
        check(std::fabs(moved - amp) < 1e-9, "the drawn shape moves its tip by the stated amount",
              num(moved) + " vs " + num(amp));
        check(heldMoved == 0.0, "the drawn shape leaves the held end where it is", num(heldMoved));
      }
    }

    // ── three resolutions ──────────────────────────────────────────────────
    // 10, 34 and 40 bricks along the beam: 1, 3 and 4 through its depth (20, the
    // natural middle, lands in the band the kernel solves slowly and is refused
    // below). MEASURED (T-340 evidence): 815.045, 813.135, 812.802 Hz, and at 20
    // across 814.710 Hz. The change does NOT shrink geometrically as the mesh
    // refines (10 -> 20 moved it 0.335 Hz, 20 -> 40 moved it 1.908 Hz), so these
    // are not in the asymptotic range and no order of convergence is claimed: the
    // fully held end is a corner singularity of 3-D elasticity, and each
    // refinement releases more of it. What is asserted is what holds: refining
    // never STIFFENS the beam (the static gate's rule), and every level stays
    // inside the Euler-Bernoulli band above. The study's own limit is 40 across,
    // so a finer level is not reachable through this seam.
    {
      double f[3] = {0.0, 0.0, 0.0};
      const int divs[3] = {10, 34, 40};
      bool all = true;
      for (int r = 0; r < 3; ++r) {
        const forge::ui::StudyOutcome o =
            solveKind(beamProgram(100.0, 10.0, 10.0), modalStudy("steel-1018", divs[r], 2));
        if (!o.solved || o.modes.empty()) {
          all = false;
          std::printf("[gate] %2d across did not solve: %s\n", divs[r], o.blocker.c_str());
          continue;
        }
        f[r] = o.modes[0].frequencyHz;
        std::printf("[gate] %2d bricks along: %zu freedoms, first frequency %.3f Hz, %.1f ms\n",
                    divs[r], o.freedoms, f[r], o.solveMs);
      }
      check(all, "all three resolutions solve", "");
      if (all) {
        check(f[1] <= f[0] + 1e-9 && f[2] <= f[1] + 1e-9,
              "refining the mesh never stiffens the beam",
              num(f[0]) + " -> " + num(f[1]) + " -> " + num(f[2]));
        const double eb1 = bernoulliHz(kBeta1L, 0.100, 0.010, E, rho);
        for (int r = 0; r < 3; ++r) {
          check(f[r] / eb1 > kBend1Low && f[r] / eb1 < kBend1High,
                "every resolution stays inside the Euler-Bernoulli band", num(f[r] / eb1));
        }
      }
    }

    // ── the sizes the kernel solves slowly are refused, with a way out ──────
    {
      // The band's top IS the kernel's switch-over, read from the kernel's own
      // source, so the refusal cannot outlive a kernel fix unnoticed.
      std::string fea;
      {
        std::string root = __FILE__;
        const std::string tail = "forge-desktop/test/study_gate.cpp";
        if (root.size() >= tail.size() && root.compare(root.size() - tail.size(), tail.size(), tail) == 0) {
          root.erase(root.size() - tail.size());
        } else {
          root = "./";
        }
        std::ifstream in(root + "forge-kernel/src/Fea.cpp");
        std::ostringstream ss;
        ss << in.rdbuf();
        fea = ss.str();
      }
      const std::string pin = "constexpr int kDenseModalCap = " +
                              std::to_string(forge::desktop::kKernelDenseModalDof) + ";";
      check(!fea.empty() && fea.find(pin) != std::string::npos,
            "the slow band's top is the kernel's own dense-solver cap", pin);

      const forge::ui::StudyOutcome slow =
          solveKind(beamProgram(100.0, 10.0, 10.0), modalStudy("steel-1018", 20, 6));
      check(!slow.solved && slow.freedoms > forge::desktop::kModalQuickDenseDof &&
                slow.freedoms <= forge::desktop::kKernelDenseModalDof,
            "a modal study the kernel would solve slowly is refused, not started",
            slow.solved ? "it ran" : std::to_string(slow.freedoms) + " freedoms");
      check(slow.suggestedDivisions > 20, "the refusal offers a finer count that is quick",
            std::to_string(slow.suggestedDivisions));
      check(forge::ui::userFacingProseIsClean(slow.blocker) &&
                slow.blocker.find(std::to_string(slow.suggestedDivisions)) != std::string::npos,
            "and says which count, in words a person may read", slow.blocker);
      std::printf("[gate] 20 across: %zu freedoms refused: \"%s\"\n", slow.freedoms,
                  slow.blocker.c_str());
      if (slow.suggestedDivisions > 0) {
        const forge::ui::StudyOutcome taken = solveKind(
            beamProgram(100.0, 10.0, 10.0), modalStudy("steel-1018", slow.suggestedDivisions, 6));
        check(taken.solved && taken.freedoms > forge::desktop::kKernelDenseModalDof,
              "following the advice solves, outside the slow band",
              taken.solved ? std::to_string(taken.freedoms) : taken.blocker);
        std::printf("[gate] at the suggested %d across: %zu freedoms, %.1f ms\n",
                    slow.suggestedDivisions, taken.freedoms, taken.solveMs);
      }
    }

    // ── the refusals ───────────────────────────────────────────────────────
    {
      forge::ui::StudyDefinition free = modalStudy("steel-1018", 40, 8);
      free.restraints.clear();
      forge::ui::StudyDefinition none = modalStudy("steel-1018", 40, 0);
      forge::ui::StudyDefinition many = modalStudy("steel-1018", 40, forge::ui::kMaxStudyModes + 1);
      const std::string why[3] = {forge::ui::studyBlocker(free, true),
                                  forge::ui::studyBlocker(none, true),
                                  forge::ui::studyBlocker(many, true)};
      for (const std::string& w : why) {
        check(!w.empty(), "an incomplete modal study is refused", "");
        check(forge::ui::userFacingProseIsClean(w), "the refusal is written for a person",
              forge::ui::describeProseFindings(forge::ui::scanUserFacingProse(w)));
      }
      // The seam refuses what the panel refuses.
      const forge::ui::StudyOutcome r = solveKind(beamProgram(100.0, 10.0, 10.0), free);
      check(!r.solved && r.blocker == why[0] && r.kind == forge::ui::StudyKind::Modal,
            "the seam refuses a modal study held nowhere, in the panel's words", r.blocker);
      // A part held along ONE direction only, coarse enough for the kernel's
      // dense path: it can slide and swing freely, and the answer must say so
      // rather than list 0 Hz "frequencies" (measured before T-340's check:
      // 0, 0, 0.0032 and 0.159 Hz came back as modes).
      for (int variant = 0; variant < 2; ++variant) {
        forge::ui::StudyDefinition loose = modalStudy("steel-1018", 10, 6);
        loose.restraints[0].holdX = false;
        if (variant == 0) loose.restraints[0].holdY = false;  // Z only; else Y and Z
        const forge::ui::StudyOutcome lo = solveKind(beamProgram(100.0, 10.0, 10.0), loose);
        check(!lo.solved && lo.modes.empty() && lo.freedoms <= forge::desktop::kModalQuickDenseDof,
              "a part that can still slide is refused, not given 0 Hz frequencies",
              lo.solved ? "solved with " + num(lo.modes.empty() ? 0.0 : lo.modes[0].frequencyHz) +
                              " Hz first"
                        : lo.blocker);
        check(forge::ui::userFacingProseIsClean(lo.blocker) &&
                  lo.blocker.find("held firmly") != std::string::npos,
              "and the refusal says the part is not held firmly enough", lo.blocker);
      }
      // A part too finely divided for an eigen-solve is refused, not started.
      forge::ui::StudyDefinition cube = modalStudy("steel-1018", 40, 6);
      const forge::ui::StudyOutcome c = solveKind(beamProgram(100.0, 100.0, 100.0), cube);
      check(!c.solved && !c.blocker.empty() && c.meshElements == 0,
            "a modal study finer than the modal limit is refused before it meshes",
            c.solved ? "it ran" : c.blocker);
    }
  }

  // ══ PART D: the steady thermal study ══════════════════════════════════════
  {
    std::printf("[gate] PART D: solving steady heat conduction...\n");
    const forge::ui::ThermalProperties* steelK = forge::ui::thermalPropertiesFor("steel-1018");
    check(steelK != nullptr, "mild steel carries a heat conductivity", "");
    if (steelK == nullptr) return 1;
    const double k = steelK->conductivityWPerMK;
    const double L = 0.100, A = 0.010 * 0.010;

    // ── D1: a bar between two temperatures ────────────────────────────────
    {
      const double scaleT = g_mutation == 11 ? 1000.0 : 1.0;
      forge::ui::StudyDefinition bar =
          thermalStudy(g_mutation == 12 ? "aluminium-6061" : "steel-1018", 40);
      forge::ui::FixedTemperature hot;
      hot.face = forge::ui::StudyFace::MinX;
      hot.temperatureC = 100.0;
      forge::ui::FixedTemperature cold;
      cold.face = forge::ui::StudyFace::MaxX;
      cold.temperatureC = g_mutation == 13 ? 100.0 : 20.0;
      bar.temperatures = {hot, cold};
      check(forge::ui::studyBlocker(bar, true).empty(), "a complete thermal study is not blocked",
            forge::ui::studyBlocker(bar, true));
      const forge::ui::StudyOutcome t = solveKind(
          beamProgram(100.0 * scaleT, 10.0 * scaleT, 10.0 * scaleT), bar);
      check(t.solved, "the bar between two temperatures solves", t.blocker);
      check(t.kind == forge::ui::StudyKind::Thermal, "the answer says it is a thermal one", "");
      if (t.solved) {
        const double Q = k * A * 80.0 / L;
        std::printf("[gate] %zu points, %zu pieces, %.1f ms; heat in at -X %.6f W, at +X %.6f W "
                    "(k A dT / L = %.6f W); %.3f..%.3f C\n",
                    t.meshNodes, t.meshElements, t.solveMs,
                    t.heatFlows.empty() ? 0.0 : t.heatFlows[0].heatInW,
                    t.heatFlows.size() < 2 ? 0.0 : t.heatFlows[1].heatInW, Q,
                    t.minTemperatureC, t.maxTemperatureC);
        check(t.heldNodes == 2 * 25, "both ends are held at every node", std::to_string(t.heldNodes));
        check(t.nodeTemperatureC.size() == t.meshNodes, "one temperature per mesh node",
              std::to_string(t.nodeTemperatureC.size()));
        // The straight line, at EVERY node.
        double worst = 0.0;
        const std::vector<double>& xyz = t.surface.nodesMm;
        double xMin = 1e300, xMax = -1e300;
        for (std::size_t n = 0; n < xyz.size() / 3; ++n) {
          xMin = std::min(xMin, xyz[3 * n]);
          xMax = std::max(xMax, xyz[3 * n]);
        }
        for (std::size_t n = 0; n < t.nodeTemperatureC.size() && 3 * n < xyz.size(); ++n) {
          const double exact = 100.0 - 80.0 * (xyz[3 * n] - xMin) / (xMax - xMin);
          worst = std::max(worst, std::fabs(t.nodeTemperatureC[n] - exact));
        }
        std::printf("[gate] worst departure from the straight line %.3g K\n", worst);
        check(worst < 1e-9, "the temperature falls in a straight line at every node", num(worst));
        check(t.heatFlows.size() == 2, "a heat flow per held end", std::to_string(t.heatFlows.size()));
        if (t.heatFlows.size() == 2) {
          check(rel(t.heatFlows[0].heatInW, Q) < 1e-6, "the hot end conducts k A dT / L in",
                num(t.heatFlows[0].heatInW) + " vs " + num(Q));
          check(rel(t.heatFlows[1].heatInW, -Q) < 1e-6, "the cold end lets the same heat out",
                num(t.heatFlows[1].heatInW) + " vs " + num(-Q));
        }
        check(forge::ui::thermalBalanced(t), "heat in equals heat out",
              num(t.heatImbalanceW) + " W unaccounted, " + num(t.maxResidualW) + " W at a node");
        check(std::fabs(t.heatImbalanceW) < 1e-9 * Q, "to round-off", num(t.heatImbalanceW));
        check(rel(t.maxHeatFluxWPerM2, k * 80.0 / L) < 1e-6,
              "the heat flux density is k dT / L throughout", num(t.maxHeatFluxWPerM2));
        check(std::fabs(t.maxTemperatureC - 100.0) < 1e-9 && std::fabs(t.minTemperatureC - 20.0) < 1e-9,
              "the hottest and coldest points are the held ends", "");
        check(t.surface.quadCount() == 672, "the temperature is drawn on the mesh's outside",
              std::to_string(t.surface.quadCount()));
      }
    }

    // ── D2: a bar generating heat, both ends at 20 C ───────────────────────
    {
      const double P = g_mutation == 14 ? 0.0 : 10.0;
      forge::ui::StudyDefinition gen = thermalStudy("steel-1018", 40);
      forge::ui::FixedTemperature left, right;
      left.face = forge::ui::StudyFace::MinX;
      left.temperatureC = 20.0;
      right.face = forge::ui::StudyFace::MaxX;
      right.temperatureC = 20.0;
      gen.temperatures = {left, right};
      gen.heatGeneratedW = P;
      const forge::ui::StudyOutcome t = solveKind(beamProgram(100.0, 10.0, 10.0), gen);
      check(t.solved, "the bar generating heat solves", t.blocker);
      if (t.solved) {
        const double Pref = 10.0;
        const double q = Pref / (L * A);
        const double peakRef = 20.0 + q * L * L / (8.0 * k);
        std::printf("[gate] generating %.6f W: peak %.6f C against T0 + q L^2 / 8k = %.6f C; "
                    "out of each end %.6f / %.6f W\n",
                    t.heatGeneratedW, t.maxTemperatureC, peakRef,
                    t.heatFlows.empty() ? 0.0 : t.heatFlows[0].heatInW,
                    t.heatFlows.size() < 2 ? 0.0 : t.heatFlows[1].heatInW);
        check(rel(t.heatGeneratedW, Pref) < 1e-12, "the heat assembled is the heat asked for",
              num(t.heatGeneratedW));
        check(rel(t.maxTemperatureC - 20.0, peakRef - 20.0) < 1e-6,
              "the peak rise is q L^2 / 8k", num(t.maxTemperatureC - 20.0) + " vs " +
                                                 num(peakRef - 20.0));
        // The parabola at every node -- on the MESH's own length and volume, so
        // that what is compared is the solve and not the 1e-7 mm the mesher's
        // bounding box adds to each side (that difference is what the peak
        // check above absorbs, at 1e-6).
        double worst = 0.0;
        const std::vector<double>& xyz = t.surface.nodesMm;
        double xMin = 1e300, xMax = -1e300;
        for (std::size_t n = 0; n < xyz.size() / 3; ++n) {
          xMin = std::min(xMin, xyz[3 * n]);
          xMax = std::max(xMax, xyz[3 * n]);
        }
        const double Lm = (xMax - xMin) / 1000.0;
        const double qm = Pref / (t.meshVolumeMm3 * 1e-9);
        for (std::size_t n = 0; n < t.nodeTemperatureC.size() && 3 * n < xyz.size(); ++n) {
          const double x = (xyz[3 * n] - xMin) / 1000.0;
          const double exact = 20.0 + qm * x * (Lm - x) / (2.0 * k);
          worst = std::max(worst, std::fabs(t.nodeTemperatureC[n] - exact));
        }
        std::printf("[gate] worst departure from the parabola %.3g K\n", worst);
        check(worst < 1e-9 * (peakRef - 20.0), "the temperature is the parabola at every node",
              num(worst));
        check(t.heatFlows.size() == 2, "a heat flow per held end", "");
        if (t.heatFlows.size() == 2) {
          check(rel(t.heatFlows[0].heatInW, -Pref / 2.0) < 1e-6 &&
                    rel(t.heatFlows[1].heatInW, -Pref / 2.0) < 1e-6,
                "half the heat leaves through each end",
                num(t.heatFlows[0].heatInW) + ", " + num(t.heatFlows[1].heatInW));
        }
        check(forge::ui::thermalBalanced(t), "the heat generated all leaves",
              num(t.heatImbalanceW) + " W unaccounted");
      }
    }

    // ── D3: a square plate with one hot side, at three resolutions ────────
    // Laplace's equation on a square with one side at T1 and three at T0: by
    // superposing the four rotations of the problem, which add up to the whole
    // boundary at T1, the CENTRE is at exactly T0 + (T1 - T0) / 4. The mesh
    // cannot reproduce that exactly -- the corner nodes belong to two sides at
    // once -- so it is a convergence check, not an identity.
    {
      const int divs[3] = {10, 20, 40};
      double err[3] = {0.0, 0.0, 0.0};
      bool all = true;
      for (int r = 0; r < 3; ++r) {
        forge::ui::StudyDefinition plate = thermalStudy("aluminium-6061", divs[r]);
        forge::ui::FixedTemperature s;
        s.temperatureC = 0.0;
        s.face = forge::ui::StudyFace::MaxX;
        plate.temperatures.push_back(s);
        s.face = forge::ui::StudyFace::MinY;
        plate.temperatures.push_back(s);
        s.face = forge::ui::StudyFace::MaxY;
        plate.temperatures.push_back(s);
        s.face = forge::ui::StudyFace::MinX;
        s.temperatureC = 100.0;
        plate.temperatures.push_back(s);
        const forge::ui::StudyOutcome t = solveKind(beamProgram(100.0, 100.0, 5.0), plate);
        if (!t.solved) {
          all = false;
          std::printf("[gate] plate at %d did not solve: %s\n", divs[r], t.blocker.c_str());
          continue;
        }
        // The centre: the node closest to (0, 0) in x and y (BOX is centred).
        const std::vector<double>& xyz = t.surface.nodesMm;
        double best = 1e300, tc = 0.0;
        for (std::size_t n = 0; n < xyz.size() / 3; ++n) {
          const double d = xyz[3 * n] * xyz[3 * n] + xyz[3 * n + 1] * xyz[3 * n + 1];
          if (d < best) {
            best = d;
            tc = t.nodeTemperatureC[n];
          }
        }
        err[r] = tc - 25.0;
        std::printf("[gate] plate %2d across: centre %.6f C (error %+.4f K), %zu shared corner "
                    "nodes, balance %.3g W\n",
                    divs[r], tc, err[r], t.sharedHeldNodes, t.heatImbalanceW);
        check(best < 1e-12, "the plate has a node at its centre", num(best));
        check(forge::ui::thermalBalanced(t), "the plate's heat balances", num(t.heatImbalanceW));
        // The three cold sides were listed first, so the corners where the hot
        // side meets them stay cold and are counted.
        check(t.sharedHeldNodes > 0, "the corners two held sides share are counted",
              std::to_string(t.sharedHeldNodes));
        double cornerT = -1.0;
        for (std::size_t n = 0; n < xyz.size() / 3; ++n) {
          if (std::fabs(xyz[3 * n] + 50.0) < 1e-6 && std::fabs(xyz[3 * n + 1] + 50.0) < 1e-6) {
            cornerT = std::max(cornerT, t.nodeTemperatureC[n]);
          }
        }
        check(cornerT == 0.0, "a corner two held sides share keeps the side listed first",
              num(cornerT) + " C");
      }
      check(all, "the plate solves at all three resolutions", "");
      if (all) {
        check(std::fabs(err[2]) < std::fabs(err[1]) && std::fabs(err[1]) < std::fabs(err[0]),
              "the centre converges towards a quarter of the difference",
              num(err[0]) + " -> " + num(err[1]) + " -> " + num(err[2]));
        check(std::fabs(err[2]) < kPlateCentreBandK, "and the finest mesh is close to it",
              num(err[2]) + " K");
        // Monotone, with a refinement ratio of exactly 2 in-plane: the observed
        // order may be read off, and it is the second order a linear brick
        // should show for a smooth interior value.
        const double p1 = std::log2(err[0] / err[1]);
        const double p2 = std::log2(err[1] / err[2]);
        std::printf("[gate] plate centre: observed order %.3f then %.3f\n", p1, p2);
        check(p1 > 1.8 && p1 < 2.2 && p2 > 1.8 && p2 < 2.2,
              "the centre converges at second order", num(p1) + ", " + num(p2));
      }
    }

    // ── the refusals ───────────────────────────────────────────────────────
    {
      forge::ui::StudyDefinition nothingHeld = thermalStudy("steel-1018", 20);
      forge::ui::StudyDefinition belowZero = thermalStudy("steel-1018", 20);
      forge::ui::FixedTemperature t;
      t.temperatureC = -300.0;
      belowZero.temperatures.push_back(t);
      forge::ui::StudyDefinition noMaterial = thermalStudy("steel-1018", 20);
      noMaterial.materialId = "unassigned";
      noMaterial.temperatures.push_back(forge::ui::FixedTemperature{});
      const std::string why[3] = {forge::ui::studyBlocker(nothingHeld, true),
                                  forge::ui::studyBlocker(belowZero, true),
                                  forge::ui::studyBlocker(noMaterial, true)};
      for (const std::string& w : why) {
        check(!w.empty(), "an incomplete thermal study is refused", "");
        check(forge::ui::userFacingProseIsClean(w), "the refusal is written for a person",
              forge::ui::describeProseFindings(forge::ui::scanUserFacingProse(w)));
      }
      const forge::ui::StudyOutcome r = solveKind(beamProgram(100.0, 10.0, 10.0), nothingHeld);
      check(!r.solved && r.blocker == why[0] && r.kind == forge::ui::StudyKind::Thermal,
            "the seam refuses a thermal study with nothing held, in the panel's words", r.blocker);
      // A cube at 40 across is 64000 cells: measured at 231 s. Refused unmeshed.
      forge::ui::StudyDefinition cube = thermalStudy("steel-1018", 40);
      cube.temperatures.push_back(forge::ui::FixedTemperature{});
      const forge::ui::StudyOutcome c = solveKind(beamProgram(100.0, 100.0, 100.0), cube);
      check(!c.solved && !c.blocker.empty() && c.meshElements == 0,
            "a thermal study finer than the thermal limit is refused before it meshes",
            c.solved ? "it ran" : c.blocker);
      // A thermal study needs no restraint and no force: neither is set above.
      forge::ui::StudyDefinition bare = thermalStudy("steel-1018", 20);
      bare.temperatures.push_back(forge::ui::FixedTemperature{});
      check(bare.restraints.empty() && bare.loads.empty() &&
                forge::ui::studyBlocker(bare, true).empty(),
            "a thermal study with no restraint and no force is complete", "");
      // One side at 20 C and nothing generated: the whole part sits at 20 C, no
      // heat flows, and that answer balances (its reactions are round-off).
      const forge::ui::StudyOutcome still = solveKind(beamProgram(100.0, 10.0, 10.0), bare);
      check(still.solved && still.maxTemperatureC - still.minTemperatureC < 1e-9 &&
                forge::ui::thermalBalanced(still),
            "a part at one temperature conducts nothing, and balances",
            still.solved ? num(still.maxTemperatureC - still.minTemperatureC) + " K spread, " +
                               num(still.heatImbalanceW) + " W"
                         : still.blocker);
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
    // BOTH HALVES OF THE GESTURE. A click on a command that declares parameters
    // opens a sheet prefilled with the values it was about to use; Run is the
    // rest of the same action. Pressed with nothing typed, so this still edits
    // the part with the schema's own 40x30x20 -- what the bare click did before.
    frame.invoke("part.primitive_box");
    if (frame.promptOpen()) frame.submitPrompt();
    step(frame);
  }
  check(frame.studyOutcomeIsStale(),
        "editing the part makes the last answer stale",
        frame.studyOutcome().solved ? "solved but not stale" : "not solved");

  std::printf("[gate] %d checks, %d failures\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
