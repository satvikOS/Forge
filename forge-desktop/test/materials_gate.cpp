// forge-desktop/test/materials_gate.cpp
//
// THE MATERIAL LIBRARY AND MASS PROPERTIES, HEADLESS -- through the real
// ForgeFrame, the real command registry and a real kernel body, with no window.
//
// WHAT IT PROVES, EACH AGAINST AN INDEPENDENT ROUTE TO THE SAME NUMBER
//   A. A 100 x 50 x 10 mm block given aluminium through part.set_material weighs
//      0.135 kg -- compared with the closed form rho * V from the card's own text,
//      and with the kernel's bounding box for the size.
//   B. Changing it to steel moves the mass to 0.39 kg WITHOUT A REBUILD: the
//      rebuild counter, the triangle count and the volume stay put while the mass
//      changes by exactly the ratio of the densities.
//   C. An unknown material is REFUSED BY NAME: the dispatch fails, the refusal
//      quotes the name, and the part stays what it was.
//   D. part.mass_properties returns typed evidence (mass_kg=...) that round-trips
//      to the report's own numbers, the activity log records it, part.check_mass
//      passes a true budget and refuses a false one naming the measured mass, and
//      a shape edited since it was measured is REFUSED rather than weighed.
//   E. The inertia tensor of an L-shaped solid equals the parallel-axis sum of its
//      two boxes worked out HERE -- off-diagonals and their sign included -- and
//      the principal moments satisfy the triangle inequality.
//   F. The integrals cross the kernel-worker boundary bit for bit.
//   G. The Materials tab draws the report: rows for mass, centre and inertia, a
//      picker row for every material in both libraries, a filter that narrows it
//      to the cards whose name matches, and a pick that goes through the registry
//      and undoes.
//   H. The card set the reader loaded is exactly the file set the LGPL library
//      carries, every file's bytes match the file on disk, and a density written
//      in the wrong dimension is refused instead of relabelled.
//
// PROVING IT CAN FAIL: `--mutate <n>` breaks ONE input and the matching check
// must go red.
//   1  the expected density is a typed-in 2810 rather than the card's own figure
//   2  steel is never dispatched, so the "arms" are one material compared to itself
//   3  the unknown-material probe asks for a name that exists
//   4  the stale-measurement probe rebuilds before it asks, so nothing is stale
//   5  the budget check is asked for the real mass when it should be refused
//   6  the L-shape's products of inertia are worked out with the wrong sign
//   7  the filter's expected row count ignores case
//   8  the doctored card's density keeps the right unit, so there is nothing to refuse
//
// BASE PROBE: compiled with -DFORGE_MATERIALS_GATE_BASE_PROBE only sections A-C
// are built, using nothing but API that existed before the card library. That is
// how this gate is run against origin/archdisc to show it RED there.
#include <algorithm>
#include <array>
#include <cctype>
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
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Units.hpp"
#ifndef FORGE_MATERIALS_GATE_BASE_PROBE
#include "forge/ui/MassProperties.hpp"
#include "forge/ui/MaterialCards.hpp"
#include "forge_fcmat/fcmat_bundle.h"
#endif

namespace {

int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

void check(bool ok, const char* what, const std::string& detail) {
  ++g_checks;
  if (!ok) {
    ++g_failures;
    std::printf("  FAIL  %-60s  %s\n", what, detail.c_str());
  }
}

void checkNear(double got, double want, double tol, const char* what) {
  ++g_checks;
  if (!(std::fabs(got - want) <= tol)) {
    ++g_failures;
    std::printf("  FAIL  %-60s  got %.12g want %.12g (tolerance %.3g)\n", what, got, want, tol);
  }
}

template <typename A, typename B>
void checkEq(const A& got, const B& want, const char* what) {
  ++g_checks;
  if (!(got == static_cast<A>(want))) {
    ++g_failures;
    std::printf("  FAIL  %-60s  got %s want %s\n", what, std::to_string(got).c_str(),
                std::to_string(want).c_str());
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
    io.BackendRendererName = "materials_gate_null";
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

#ifndef FORGE_MATERIALS_GATE_BASE_PROBE
bool showPanel(forge::desktop::ForgeFrame& frame, const std::string& panelId) {
  step(frame);
  step(frame);
  for (const forge::desktop::TabHit& hit : frame.tabHits()) {
    if (hit.panelId != panelId) continue;
    frame.setActiveTabAt(hit.path, hit.index);
    step(frame);
    step(frame);
    const std::vector<std::string>& drawn = frame.panelIdsDrawn();
    return std::find(drawn.begin(), drawn.end(), panelId) != drawn.end();
  }
  return false;
}
#endif

std::string repoRoot() {
  std::string here = __FILE__;
  const std::size_t at = here.rfind("/forge-desktop/test/");
  if (at == std::string::npos) return std::string(".");
  return here.substr(0, at);
}

std::string readWholeFile(const std::string& path, bool& ok) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    ok = false;
    return std::string();
  }
  std::ostringstream ss;
  ss << in.rdbuf();
  ok = true;
  return ss.str();
}

// The density a card states, read out of its RAW TEXT with nothing but string
// search -- the independent route the reader's answer is compared against. Only
// the "<number> kg/m^3" spelling is accepted here; anything else returns -1 and
// the comparison fails loudly.
double rawCardDensityKgPerM3(const std::string& text) {
  const std::size_t key = text.find("Density: \"");
  if (key == std::string::npos) return -1.0;
  const std::size_t begin = key + std::strlen("Density: \"");
  const std::size_t end = text.find('"', begin);
  if (end == std::string::npos) return -1.0;
  const std::string value = text.substr(begin, end - begin);
  const std::size_t unit = value.find(" kg/m^3");
  if (unit == std::string::npos || unit + 7 != value.size()) return -1.0;
  return std::strtod(value.substr(0, unit).c_str(), nullptr);
}

const char* kAluminiumCard = "/third_party/freecad-derived/materials/Resources/Materials/"
                             "Standard/Metal/Aluminum/Aluminum-Generic.FCMat";
const char* kSteelCard = "/third_party/freecad-derived/materials/Resources/Materials/"
                         "Standard/Metal/Steel/Steel-S235JR.FCMat";

forge::ui::DispatchResult setMaterial(forge::ui::ForgeShell& shell, const std::string& id) {
  forge::ui::CommandParams params;
  params.setText("material", id);
  return shell.run("part.set_material", params);
}

#ifndef FORGE_MATERIALS_GATE_BASE_PROBE
// "mass_kg=0.135" -> 0.135, from an evidence line.
bool evidenceNumber(const std::string& evidence, const char* key, double& out) {
  const std::string needle = std::string(key) + "=";
  std::size_t at = evidence.find(needle);
  while (at != std::string::npos && at > 0 && evidence[at - 1] != ' ') {
    at = evidence.find(needle, at + 1);
  }
  if (at == std::string::npos) return false;
  const std::size_t begin = at + needle.size();
  std::size_t end = evidence.find(' ', begin);
  if (end == std::string::npos) end = evidence.size();
  return forge::ui::parseRoundTripNumber(evidence.substr(begin, end - begin), out);
}

// The central inertia tensor (unit density, mm^5) of an axis-aligned box of sides
// a, b, c: diag(V (b^2+c^2)/12, V (a^2+c^2)/12, V (a^2+b^2)/12).
std::array<double, 9> boxCentral(double a, double b, double c) {
  const double v = a * b * c;
  return {v * (b * b + c * c) / 12.0, 0.0, 0.0, 0.0, v * (a * a + c * c) / 12.0, 0.0, 0.0, 0.0,
          v * (a * a + b * b) / 12.0};
}
#endif

}  // namespace

int main(int argc, char** argv) {
  std::string workerPath;
  {
    const std::string self = argc > 0 ? argv[0] : "";
    const std::size_t slash = self.rfind('/');
    workerPath = (slash == std::string::npos ? std::string(".") : self.substr(0, slash)) +
                 "/forge_kernel_worker";
  }
  // --root names the tree the material cards are read from. It defaults to the
  // tree this file was compiled from; the base probe points it at a tree that has
  // the cards while the build under test does not.
  std::string root = repoRoot();
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
    if (std::strcmp(argv[i], "--worker") == 0 && i + 1 < argc) workerPath = argv[++i];
    if (std::strcmp(argv[i], "--root") == 0 && i + 1 < argc) root = argv[++i];
  }
  if (g_mutation != 0) std::printf("[gate] MUTATION %d ACTIVE\n", g_mutation);

  bool haveAl = false;
  bool haveSteel = false;
  const std::string alText = readWholeFile(root + kAluminiumCard, haveAl);
  const std::string steelText = readWholeFile(root + kSteelCard, haveSteel);
  check(haveAl && haveSteel, "the aluminium and steel cards are in the source tree", root);
  double alDensity = rawCardDensityKgPerM3(alText);
  const double steelDensity = rawCardDensityKgPerM3(steelText);
  check(alDensity > 0.0 && steelDensity > 0.0, "both cards state a density in kg/m^3",
        std::to_string(alDensity) + " / " + std::to_string(steelDensity));
  if (g_mutation == 1) alDensity = 2810.0;

  forge::desktop::KernelScene scene;
  if (!scene.build()) {
    std::printf("[gate] the kernel could not build the default part: %s\n", scene.error().c_str());
    return 1;
  }
  HeadlessImGui gui(1600.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  check(frame.wirePartCommands() > 0, "the Part commands are registered", "");

  // ── A. THE 100 x 50 x 10 mm ALUMINIUM BLOCK ──────────────────────────────
  std::string why;
  check(frame.documentReset(why), "the document empties", why);
  {
    forge::ui::CommandParams box;
    box.setNumber("dx", 100.0);
    box.setNumber("dy", 50.0);
    box.setNumber("dz", 10.0);
    const forge::ui::DispatchResult r = shell.run("part.primitive_box", box);
    check(r.ok(), "part.primitive_box ran", r.detail);
  }
  step(frame);
  const forge::desktop::IrBuildReport& built = scene.lastBuild();
  check(built.ok(), "the block built", scene.error());
  const double sx = built.bboxMax[0] - built.bboxMin[0];
  const double sy = built.bboxMax[1] - built.bboxMin[1];
  const double sz = built.bboxMax[2] - built.bboxMin[2];
  checkNear(sx, 100.0, 1e-6, "the block is 100 mm long");
  checkNear(sy, 50.0, 1e-6, "the block is 50 mm wide");
  checkNear(sz, 10.0, 1e-6, "the block is 10 mm high");
  checkNear(built.volume, sx * sy * sz, 1e-6, "the kernel's volume is its own three sides");

  {
    const forge::ui::DispatchResult r = setMaterial(shell, "aluminum-generic");
    check(r.ok(), "part.set_material accepts the aluminium card", r.detail);
  }
  const std::size_t rebuildsAfterAluminium = frame.rebuilds();
  const std::size_t trianglesAfterAluminium = scene.triangleCount();
  const forge::ui::MassProperties alMass = frame.partMass();
  check(alMass.known, "the aluminium block has a weight", "");
  checkNear(alMass.massGrams / 1000.0, built.volume * alDensity * 1e-9, 1e-12,
            "its mass is rho x V from the card's own density");
  checkNear(alMass.massGrams / 1000.0, 0.135, 1e-12, "a 100 x 50 x 10 mm aluminium block is 0.135 kg");
  std::printf("[gate] block %.3f x %.3f x %.3f mm, %.3f mm3 of %s: %.9g kg\n", sx, sy, sz,
              built.volume, frame.partDocumentMaterialId().c_str(), alMass.massGrams / 1000.0);
#ifndef FORGE_MATERIALS_GATE_BASE_PROBE
  std::printf("[gate] integrals measured by %s\n",
              built.massIntegrator == forge::desktop::MassIntegrator::NativeExact ? "native exact"
              : built.massIntegrator == forge::desktop::MassIntegrator::Engine    ? "engine"
              : built.massIntegrator == forge::desktop::MassIntegrator::Faceted   ? "faceted"
                                                                                  : "nothing");
#endif

  // ── B. STEEL, WITHOUT A REBUILD ──────────────────────────────────────────
  if (g_mutation != 2) {
    const forge::ui::DispatchResult r = setMaterial(shell, "steel-s235jr");
    check(r.ok(), "part.set_material accepts the steel card", r.detail);
  }
  step(frame);
  const forge::ui::MassProperties steelMass = frame.partMass();
  checkEq(frame.rebuilds(), rebuildsAfterAluminium, "changing the material rebuilt nothing");
  checkEq(scene.triangleCount(), trianglesAfterAluminium, "the geometry on screen is untouched");
  checkNear(steelMass.volumeMm3, alMass.volumeMm3, 0.0, "the volume did not move");
  check(steelMass.known, "the steel block has a weight", "");
  checkNear(steelMass.massGrams / 1000.0, built.volume * steelDensity * 1e-9, 1e-12,
            "its mass is rho x V from the steel card's density");
  checkNear(steelMass.massGrams / alMass.massGrams, steelDensity / alDensity, 1e-12,
            "the mass moved by exactly the ratio of the densities");
  check(std::fabs(steelMass.massGrams - alMass.massGrams) > 1.0,
        "the two materials really give two different masses", "");

  // ── C. AN UNKNOWN MATERIAL IS REFUSED BY NAME ────────────────────────────
  {
    const std::string asked = g_mutation == 3 ? "aluminum-generic" : "unobtanium-9000";
    const std::string before = frame.partDocumentMaterialId();
    const forge::ui::DispatchResult r = setMaterial(shell, asked);
    check(!r.ok(), "an unknown material is refused", forge::ui::machineName(r.status));
    check(r.detail.find("unobtanium-9000") != std::string::npos,
          "the refusal names what was asked for", r.detail);
    check(frame.partDocumentMaterialId() == before, "the part is still made of what it was",
          frame.partDocumentMaterialId());
    checkNear(frame.partMass().massGrams, steelMass.massGrams, 0.0, "its mass did not move");
  }

#ifndef FORGE_MATERIALS_GATE_BASE_PROBE
  // ── D. THE TYPED OPS ARCHIE CITES A MASS THROUGH ─────────────────────────
  {
    const forge::ui::MassPropertiesReport report = frame.partMassReport();
    check(report.known, "the report knows the mass", report.refusal);
    // THE NATIVE KERNEL'S INTEGRALS. The block is built by the engine; its mass
    // properties must still come from the native divergence-theorem integrator,
    // checked against the engine's integration of the same solid.
    check(built.massIntegrator == forge::desktop::MassIntegrator::NativeExact,
          "the block's mass properties are the native kernel's integration", "");
    checkNear(built.massVolume, built.volume, 1e-6 * built.volume,
              "the native volume agrees with the engine's");
    // 1e-6 and not exact: the Properties tab multiplies the build's volume and the
    // report the native integration's, and the two agree to that bound by rule.
    checkNear(report.massKg * 1000.0, frame.partMass().massGrams, 1e-6 * frame.partMass().massGrams,
              "the report and the shared weight agree");
    checkNear(report.centreOfMassMm[0], 0.5 * (built.bboxMin[0] + built.bboxMax[0]), 1e-9,
              "a block's centre of mass is the middle of its box (x)");
    checkNear(report.centreOfMassMm[1], 0.5 * (built.bboxMin[1] + built.bboxMax[1]), 1e-9,
              "a block's centre of mass is the middle of its box (y)");
    checkNear(report.centreOfMassMm[2], 0.5 * (built.bboxMin[2] + built.bboxMax[2]), 1e-9,
              "a block's centre of mass is the middle of its box (z)");
    const double m = report.massKg;
    checkNear(report.inertiaKgMm2[0], m * (sy * sy + sz * sz) / 12.0, 1e-9, "Ixx = m(b2+c2)/12");
    checkNear(report.inertiaKgMm2[4], m * (sx * sx + sz * sz) / 12.0, 1e-9, "Iyy = m(a2+c2)/12");
    checkNear(report.inertiaKgMm2[8], m * (sx * sx + sy * sy) / 12.0, 1e-9, "Izz = m(a2+b2)/12");
    for (int i : {1, 2, 3, 5, 6, 7}) {
      checkNear(report.inertiaKgMm2[static_cast<std::size_t>(i)], 0.0, 1e-9,
                "a centred block has no product of inertia");
    }

    std::size_t logBefore = shell.log().recorded();
    const forge::ui::DispatchResult q = shell.run("part.mass_properties", {});
    check(q.ok(), "part.mass_properties runs", q.detail);
    double mass = 0.0, volume = 0.0, density = 0.0;
    check(evidenceNumber(q.evidence, "mass_kg", mass), "the evidence carries mass_kg", q.evidence);
    check(evidenceNumber(q.evidence, "volume_mm3", volume), "the evidence carries volume_mm3", "");
    check(evidenceNumber(q.evidence, "density_kg_m3", density),
          "the evidence carries density_kg_m3", "");
    checkNear(mass, report.massKg, 0.0, "mass_kg round-trips to the report exactly");
    checkNear(volume, built.massVolume, 0.0, "volume_mm3 is the integration's own volume");
    checkNear(density, steelDensity, 0.0, "density_kg_m3 is the steel card's");
    check(q.evidence.find("material=steel-s235jr") != std::string::npos,
          "the evidence names the material", q.evidence);
    check(q.evidence.find("inertia_com_kg_mm2=[") != std::string::npos,
          "the evidence carries the inertia", q.evidence);
    bool logged = false;
    for (const forge::ui::LogEntry& e : shell.log().since(logBefore)) {
      if (e.source == "part.mass_properties" && e.detail == q.evidence) logged = true;
    }
    check(logged, "the activity log records the measurement", "");
    std::printf("[gate] evidence: %s\n", q.evidence.c_str());

    forge::ui::CommandParams budget;
    budget.setNumber("kilograms", report.massKg);
    const forge::ui::DispatchResult pass = shell.run("part.check_mass", budget);
    check(pass.ok(), "part.check_mass passes the true mass", pass.detail);
    forge::ui::CommandParams wrong;
    wrong.setNumber("kilograms", g_mutation == 5 ? report.massKg : 0.2);
    const forge::ui::DispatchResult fail = shell.run("part.check_mass", wrong);
    check(!fail.ok(), "part.check_mass refuses a budget the part does not meet", "");
    check(fail.detail.find("0.39") != std::string::npos,
          "the refusal says what the part actually weighs", fail.detail);

    // A shape edited and NOT yet rebuilt. registry().dispatch bypasses the shell's
    // document notification, which is how a raw caller reaches the registry.
    // The block's height goes from 10 mm to 20 mm: BOX's third number (index 2)
    // of the last statement, the feature part.edit_feature aims at by default.
    forge::ui::CommandParams taller;
    taller.setNumber("index", 2.0);
    taller.setNumber("value", 20.0);
    const forge::ui::DispatchResult edit =
        shell.registry().dispatch("part.edit_feature", shell.selection(), taller);
    check(edit.ok(), "the block is made taller without a rebuild", edit.detail);
    if (g_mutation == 4) step(frame);
    const forge::ui::DispatchResult stale =
        shell.registry().dispatch("part.mass_properties", shell.selection(), {});
    check(!stale.ok(), "a shape changed since it was measured is not weighed", stale.evidence);
    check(stale.detail.find("changed since it was last measured") != std::string::npos,
          "the refusal says the measurement is out of date", stale.detail);
    step(frame);
    const forge::ui::DispatchResult fresh = shell.run("part.mass_properties", {});
    check(fresh.ok(), "after the rebuild it is weighed again", fresh.detail);
    double freshMass = 0.0;
    check(evidenceNumber(fresh.evidence, "mass_kg", freshMass), "and cites a mass", fresh.evidence);
    checkNear(freshMass, scene.lastBuild().massVolume * steelDensity * 1e-9, 1e-12,
              "the new mass is the rebuilt shape's volume in steel");
    checkNear(freshMass, 2.0 * steelMass.massGrams / 1000.0, 1e-9,
              "twice the height is twice the mass");
    check(std::fabs(freshMass - steelMass.massGrams / 1000.0) > 1e-6,
          "and it is not the old shape's mass", fresh.evidence);
    check(frame.documentUndo(), "the height change can be undone", "");
    step(frame);
  }

  // ── E. THE INERTIA OF AN L, AGAINST THE PARALLEL-AXIS THEOREM ────────────
  const std::string lProgram =
      "%1 = BOX(100, 20, 10)\n%2 = BOX(20, 60, 10, 40, 40, 0)\n%3 = FUSE(%1, %2)\n";
  forge::desktop::KernelScene lScene;
  check(lScene.buildFromIr(lProgram), "the L-shaped solid builds", lScene.error());
  const forge::desktop::IrBuildReport& lr = lScene.lastBuild();
  check(lr.massIntegralsKnown, "its volume integrals were measured", "");
  check(lr.massIntegrator == forge::desktop::MassIntegrator::NativeExact,
        "the L's integrals are the native kernel's, agreeing with the engine's", "");
  {
    struct Box { double a, b, c, x, y, z; };
    const Box boxes[] = {{100.0, 20.0, 10.0, 0.0, 0.0, 5.0}, {20.0, 60.0, 10.0, 40.0, 40.0, 5.0}};
    double vTotal = 0.0;
    std::array<double, 3> com{};
    for (const Box& b : boxes) {
      const double v = b.a * b.b * b.c;
      vTotal += v;
      com[0] += v * b.x;
      com[1] += v * b.y;
      com[2] += v * b.z;
    }
    for (double& c : com) c /= vTotal;
    std::array<double, 9> want{};
    for (const Box& b : boxes) {
      const double v = b.a * b.b * b.c;
      const std::array<double, 9> own = boxCentral(b.a, b.b, b.c);
      const std::array<double, 3> d = {b.x - com[0], b.y - com[1], b.z - com[2]};
      const double d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) {
          double shift = (i == j ? d2 : 0.0) - d[static_cast<std::size_t>(i)] *
                                                   d[static_cast<std::size_t>(j)];
          if (g_mutation == 6 && i != j) shift = -shift;
          want[static_cast<std::size_t>(i * 3 + j)] +=
              own[static_cast<std::size_t>(i * 3 + j)] + v * shift;
        }
      }
    }
    checkNear(lr.volume, vTotal, 1e-6, "the L's volume is its two boxes");
    for (int i = 0; i < 3; ++i) {
      checkNear(lr.centroid[i], com[static_cast<std::size_t>(i)], 1e-6,
                "the L's centroid is the volume-weighted mean of its boxes");
    }
    for (std::size_t k = 0; k < 9; ++k) {
      checkNear(lr.inertiaUnitDensity[k], want[k], 1e-6 * std::fabs(want[4]),
                "the L's inertia tensor entry matches the parallel-axis sum");
    }
    check(std::fabs(want[1]) > 1.0, "the L really has a product of inertia to get wrong",
          std::to_string(want[1]));
    std::printf("[gate] L inertia (mm^5): Ixx %.6g Iyy %.6g Izz %.6g Ixy %.6g (kernel %.6g)\n",
                want[0], want[4], want[8], want[1], lr.inertiaUnitDensity[1]);

    forge::ui::GeometricIntegrals g;
    g.known = true;
    g.program = lProgram;
    g.volumeMm3 = lr.massVolume;
    for (std::size_t i = 0; i < 3; ++i) g.centroidMm[i] = lr.centroid[i];
    for (std::size_t i = 0; i < 9; ++i) g.inertiaUnitDensityMm5[i] = lr.inertiaUnitDensity[i];
    const forge::ui::Material* al = frame.materialCards().findMaterial("aluminum-generic");
    check(al != nullptr, "the aluminium card is in the catalogue", "");
    if (al != nullptr) {
      const forge::ui::MassPropertiesReport lReport = forge::ui::massPropertiesFor(*al, g, lProgram);
      check(lReport.known, "the L has mass properties", lReport.refusal);
      const auto& p = lReport.principalMomentsKgMm2;
      check(p[0] > 0.0 && p[0] <= p[1] && p[1] <= p[2] && p[0] + p[1] >= p[2],
            "its principal moments are ordered and obey the triangle inequality", "");
      double trace = lReport.inertiaKgMm2[0] + lReport.inertiaKgMm2[4] + lReport.inertiaKgMm2[8];
      checkNear(p[0] + p[1] + p[2], trace, 1e-9 * trace, "principal moments keep the trace");
    }
  }

  // ── F. ACROSS THE WORKER BOUNDARY ────────────────────────────────────────
  {
    std::FILE* probe = std::fopen(workerPath.c_str(), "rb");
    check(probe != nullptr, "the kernel worker binary is beside this gate", workerPath);
    if (probe != nullptr) {
      std::fclose(probe);
      forge::desktop::KernelScene isolated;
      forge::ui::GuardLimits limits;
      limits.deadlineMs = 120000;
      isolated.useIsolatedWorker({workerPath}, limits);
      check(isolated.buildFromIr(lProgram), "the L builds in a worker", isolated.error());
      checkEq(isolated.isolatedBuilds(), 1u, "the build really went through the worker");
      const forge::desktop::IrBuildReport& wr = isolated.lastBuild();
      check(wr.massIntegralsKnown == lr.massIntegralsKnown, "the worker says the same about them", "");
      check(wr.massIntegrator == lr.massIntegrator, "and names the same integration", "");
      bool same = true;
      for (int i = 0; i < 3; ++i) same = same && wr.centroid[i] == lr.centroid[i];
      for (int i = 0; i < 9; ++i) same = same && wr.inertiaUnitDensity[i] == lr.inertiaUnitDensity[i];
      same = same && wr.massVolume == lr.massVolume;
      check(same, "the integrals cross the process boundary bit for bit", "");
    }
  }

  // ── G. THE MATERIALS TAB ─────────────────────────────────────────────────
  {
    shell.setWorkspace(forge::ui::WorkspaceProfile::Simulation);
    check(showPanel(frame, "materials"), "the Materials tab draws its own panel", "");
    check(frame.massPropertyRowsDrawn() >= 10, "it prints mass, centre and inertia rows",
          std::to_string(frame.massPropertyRowsDrawn()));
    check(frame.materialCardPropertyRowsDrawn() >= 3, "it prints the steel card's own figures",
          std::to_string(frame.materialCardPropertyRowsDrawn()));
    checkEq(frame.materialPickerRowsDrawn(),
            forge::ui::materialLibrary().size() + frame.materialCards().cards().size(),
            "one picker row per material in both libraries");

    frame.setMaterialFilter("S235");
    step(frame);
    std::size_t matching = 0;
    for (const forge::ui::MaterialCard& c : frame.materialCards().cards()) {
      // Mutation 7 compares case-sensitively against the display name alone, which
      // is the reference a filter that forgot to fold case would agree with.
      std::string hay = g_mutation == 7 ? c.name : c.name + " " + c.id;
      if (g_mutation != 7) {
        for (char& ch : hay) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
      }
      if (hay.find("s235") != std::string::npos) ++matching;
    }
    check(matching >= 3, "the library holds the S235 steels", std::to_string(matching));
    checkEq(frame.materialPickerRowsDrawn(), matching, "the filter narrows the list to them");
    frame.setMaterialFilter("");

    const std::size_t rebuilds = frame.rebuilds();
    frame.pickMaterial("copper-510");
    step(frame);
    check(frame.partDocumentMaterialId() == "copper-510", "a pick in the panel changes the material",
          frame.partDocumentMaterialId());
    checkEq(frame.rebuilds(), rebuilds, "and rebuilds nothing");
    check(frame.documentUndo(), "the pick can be undone", "");
    check(frame.partDocumentMaterialId() == "steel-s235jr", "undo puts steel back",
          frame.partDocumentMaterialId());
  }

  // ── H. THE LIBRARY IS THE LIBRARY ────────────────────────────────────────
  {
    bool haveRecord = false;
    const std::string record =
        readWholeFile(root + "/third_party/freecad-derived/materials/component.json", haveRecord);
    check(haveRecord, "the component record is readable", "");
    std::size_t recorded = 0;
    std::size_t recordedCards = 0;
    for (std::size_t at = record.find("\"path\": \"Resources/"); at != std::string::npos;
         at = record.find("\"path\": \"Resources/", at + 1)) {
      ++recorded;
      if (record.compare(at + 9, 20, "Resources/Materials/") == 0) ++recordedCards;
    }
    checkEq(forge_fcmat_file_count(), recorded, "the library carries every recorded file");
    std::size_t sameBytes = 0;
    for (std::size_t i = 0; i < forge_fcmat_file_count(); ++i) {
      forge_fcmat_file f{};
      if (forge_fcmat_file_at(i, &f) != 0) continue;
      bool ok = false;
      const std::string disk =
          readWholeFile(root + "/third_party/freecad-derived/materials/" + f.path, ok);
      if (ok && disk.size() == f.size && disk.compare(0, disk.size(), f.bytes, f.size) == 0) {
        ++sameBytes;
      }
    }
    checkEq(sameBytes, forge_fcmat_file_count(), "every file in the library is the file on disk");
    checkEq(frame.materialCards().cards().size(), recordedCards, "every recorded card was read");
    checkEq(frame.materialCards().refusals().size(), 0u, "no file in the library was refused");
    check(frame.materialLibraryProblem().empty(), "the library loaded without a problem",
          frame.materialLibraryProblem());
    const forge::ui::Material* al = frame.materialCards().findMaterial("aluminum-generic");
    checkNear(al == nullptr ? -1.0 : al->densityKgPerM3, alDensity, 0.0,
              "the reader's aluminium density is the card's own");

    // A density written in the WRONG DIMENSION. FreeCAD would keep 2700 and call
    // it kg/m^3; this reader must refuse it, and the card must not be offered.
    std::string doctored = alText;
    const std::size_t at = doctored.find("\"2700 kg/m^3\"");
    check(at != std::string::npos, "the card spells its density the way this test edits it", "");
    if (at != std::string::npos && g_mutation != 8) doctored.replace(at, 13, "\"2700 MPa\"");
    std::vector<forge::ui::MaterialLibraryFile> files;
    for (std::size_t i = 0; i < forge_fcmat_file_count(); ++i) {
      forge_fcmat_file f{};
      if (forge_fcmat_file_at(i, &f) != 0) continue;
      const std::string path(f.path);
      if (path.rfind("Resources/Models/", 0) == 0) files.push_back({path, std::string(f.bytes, f.size)});
    }
    files.push_back({"Resources/Materials/Standard/Metal/Aluminum/Aluminum-Generic.FCMat", doctored});
    const auto bad = forge::ui::MaterialCatalogue::build(files);
    check(bad->findCard("aluminum-generic") == nullptr,
          "a density in the wrong dimension is not offered", "");
    check(bad->refusals().size() == 1 &&
              bad->refusals().front().reason.find("MPa") != std::string::npos,
          "the refusal names the unit it was given", bad->refusals().empty() ? "" :
                                                      bad->refusals().front().reason);

    // And the same value in a CONVERTIBLE unit is read, converted.
    std::string converted = alText;
    const std::size_t at2 = converted.find("\"2700 kg/m^3\"");
    if (at2 != std::string::npos) converted.replace(at2, 13, "\"2.7 g/cm^3\"");
    files.back().bytes = converted;
    const auto good = forge::ui::MaterialCatalogue::build(files);
    const forge::ui::Material* g = good->findMaterial("aluminum-generic");
    checkNear(g == nullptr ? -1.0 : g->densityKgPerM3, 2700.0, 1e-9,
              "2.7 g/cm^3 is read as 2700 kg/m^3");
  }
#endif

  std::printf("[gate] materials: %d checks, %d failed\n", g_checks, g_failures);
  if (g_failures != 0) {
    std::printf("[gate] materials gate FAILED\n");
    return 1;
  }
  std::printf("[gate] materials gate PASS\n");
  return 0;
}
