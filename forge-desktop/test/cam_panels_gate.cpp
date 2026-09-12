// forge-desktop/test/cam_panels_gate.cpp
//
// THE MANUFACTURING PANELS, HEADLESS — Tool Library, Post Output, Stock and
// Materials, driven through the REAL ForgeFrame over a REAL kernel body, with no
// window, no swapchain and no display.
//
// WHAT THIS GATE IS FOR. Those four tabs used to fall through to a fallback that
// apologised for them. Replacing an apology with a layout full of plausible
// numbers would be worse than the apology, so every check below compares what
// the PANEL HOLDS against an INDEPENDENT call into the same kernel, made here,
// from the tool catalogue and the post-processor themselves. None of them
// asserts "the panel drew something": the row counters are checked as well as
// the values, because a model holding the right numbers and a panel drawing none
// of them is the same defect wearing a different coat.
//
// The one cross-check worth pointing at: the section this file takes through the
// part is used to compute an AREA, that area is multiplied by the part's height,
// and the answer is compared against the volume the KERNEL measured on the same
// solid. Two entirely separate routes to one number -- a triangle-plane
// intersection here, a B-rep integration there -- and they agree to 0.02%. A
// wrong outline could not do that.
//
// PROVING IT CAN FAIL: `--mutate <n>` breaks ONE query and the matching check
// must go red.
//   1  the tool table is a hand-written copy rather than the kernel's catalogue
//   2  the section is taken above the part, so there is no outline to cut
//   3  the weight is computed from a written-in density, not the document's
//   4  the stock is a fixed block rather than the part's measured extent
//   5  the machine program is a canned sample rather than the post-processor's
//   6  the shared-measurement scan is pointed at a panel that does not share it
//   7  the removed volume is added rather than subtracted
//   8  the exported file is a canned program rather than the posted one
//   9  the export keeps writing the program the panel FIRST had
//  10  a save into a folder that is not there is allowed to invent it
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

#include "imgui.h"

#include "CamHost.hpp"
#include "Camera.hpp"
#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "PartFile.hpp"
// The kernel's manufacturing module, included DIRECTLY. This is what makes the
// checks independent: the panel's answer is compared against a second call this
// file makes itself, not against a helper the panel also uses. CamExtended.hpp
// reaches no OCCT header, so including it here costs nothing.
#include "forge/CamExtended.hpp"
#include "forge/ui/FileExchange.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/MachineProgram.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Units.hpp"

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

void checkNear(double got, double want, double tol, const char* what) {
  ++g_checks;
  if (!(std::fabs(got - want) <= tol)) {
    ++g_failures;
    char buf[192];
    std::snprintf(buf, sizeof(buf), "got %.6f want %.6f (tolerance %.6f)", got, want, tol);
    std::printf("  FAIL  %-56s  %s\n", what, buf);
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

void checkEqStr(const std::string& got, const std::string& want, const char* what) {
  ++g_checks;
  if (got != want) {
    ++g_failures;
    std::printf("  FAIL  %-56s  got \"%s\" want \"%s\"\n", what, got.substr(0, 48).c_str(),
                want.substr(0, 48).c_str());
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
    io.BackendRendererName = "cam_panels_gate_null";
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

// Brings `panelId` to the front of whichever tab group holds it, and returns
// whether the frame then drew it. The tab paths come from the frame's OWN
// recorded hit boxes, which is how the application itself addresses a tab.
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

std::string tempPath(const char* leaf) {
  const char* tmp = std::getenv("TMPDIR");
  std::string dir = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!dir.empty() && dir.back() != '/') dir += '/';
  return dir + leaf;
}

// Is there anything at this path -- a file OR a folder? Both halves matter: the
// refusal check has to say that no file was written AND that no folder was
// invented, and a reader that opens a directory successfully cannot tell them
// apart.
bool onDiskExists(const std::string& path) {
  std::error_code ec;
  return std::filesystem::exists(std::filesystem::path(path), ec) && !ec;
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

// The body of a C++ member function, by brace matching from its signature. The
// same technique ui/test/app_surface_reachability_test.cpp uses, and for the same
// purpose: some claims are about WHICH CALL a function makes, and no run-time
// observable can see that.
std::string functionBody(const std::string& src, const std::string& signature) {
  const std::size_t at = src.find(signature);
  if (at == std::string::npos) return std::string();
  const std::size_t open = src.find('{', at);
  if (open == std::string::npos) return std::string();
  int depth = 0;
  for (std::size_t i = open; i < src.size(); ++i) {
    if (src[i] == '{') ++depth;
    if (src[i] == '}') {
      --depth;
      if (depth == 0) return src.substr(open, i - open + 1);
    }
  }
  return std::string();
}

std::string repoRoot() {
  // The gate binary lives in <root>/build-app or <root>/forge-desktop/build; the
  // source it reads is addressed from the compile-time path of this file, which
  // is the only anchor that survives either.
  std::string here = __FILE__;
  const std::size_t at = here.rfind("/forge-desktop/test/");
  if (at == std::string::npos) return std::string(".");
  return here.substr(0, at);
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[gate] MUTATION %d ACTIVE\n", g_mutation);

  namespace cam = forge::desktop::cam;

  // ── 1. the real body ─────────────────────────────────────────────────────
  forge::desktop::KernelScene scene;
  if (!scene.build()) {
    std::printf("[gate] the kernel could not build the default part: %s\n", scene.error().c_str());
    return 1;
  }
  const forge::desktop::IrBuildReport& report = scene.lastBuild();
  std::printf("[gate] part: %.3f mm3, %ld faces, %zu triangles\n", report.volume,
              report.faceCount, scene.triangleCount());

  HeadlessImGui gui(1600.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  // The document, the Part commands and the DocumentHost seam. Without this the
  // shell has no part.set_material to dispatch and no document to hold a
  // material -- the same call every other desktop gate makes first.
  const std::size_t wired = frame.wirePartCommands();
  check(wired > 0, "the Part commands are registered", std::to_string(wired));
  // BEFORE A SINGLE FRAME IS DRAWN. hasMachineProgram() is called from
  // file.export_gcode's enabled predicate, which the menu evaluates for every
  // command on every frame, so its contract is that it COMPUTES NOTHING and
  // reports what the Manufacturing panels have already worked out. This is that
  // contract measured: the part exists and compiles, the source is installed, and
  // there is still no program because no operation has been set up yet.
  check(!frame.hasMachineProgram(),
        "with no panel yet drawn there is no machine program to export", "");
  check(shell.machineProgramSource() == &frame,
        "the frame installed itself as the machine-program source", "");

  // ── 2. THE TOOL LIBRARY IS THE KERNEL'S ──────────────────────────────────
  // Compared entry by entry against forge::camx::listTools(), called here. A
  // table written into the panel would pass a size check and fail this one.
  {
    std::vector<forge::camx::Tool> kernelTools = forge::camx::listTools();
    if (g_mutation == 1 && !kernelTools.empty()) {
      // The defect: somebody types the catalogue into the panel and one number
      // is not what the kernel holds.
      kernelTools[0].diameter += 0.5;
    }
    const std::vector<cam::CuttingTool>& panelTools = cam::toolLibrary();
    checkEq(panelTools.size(), kernelTools.size(), "the panel offers every tool the kernel has");
    check(!panelTools.empty(), "the tool catalogue is not empty", "");
    for (std::size_t i = 0; i < panelTools.size() && i < kernelTools.size(); ++i) {
      const cam::CuttingTool& p = panelTools[i];
      const forge::camx::Tool& k = kernelTools[i];
      checkEq(p.id, k.id, "tool id comes from the catalogue");
      checkNear(p.diameterMm, k.diameter, 1e-12, "tool diameter comes from the catalogue");
      checkNear(p.fluteLengthMm, k.fluteLength, 1e-12, "cutting length comes from the catalogue");
      checkNear(p.totalLengthMm, k.totalLength, 1e-12, "overall length comes from the catalogue");
      checkEq(p.flutes, k.flutes, "flute count comes from the catalogue");
      checkEqStr(p.toolMaterial, k.material, "what the tool is made of comes from the catalogue");
      checkNear(p.maxSpindleRpm, k.maxRPM, 1e-12, "maximum speed comes from the catalogue");
      checkNear(p.chipLoadMm, k.feedPerTooth, 1e-12, "chip load comes from the catalogue");
      // The two derived readings, against their stated formulae.
      checkNear(p.feedAt(k.maxRPM), k.maxRPM * k.flutes * k.feedPerTooth, 1e-9,
                "feed is speed x flutes x chip load");
      checkNear(p.surfaceSpeedAt(k.maxRPM), 3.14159265358979323846 * k.diameter * k.maxRPM / 1000.0,
                1e-9, "surface speed is pi x diameter x speed / 1000");
    }
    // A tool the catalogue does not hold is refused rather than silently kept.
    check(!frame.setCamToolId(9999), "an unknown tool is refused", "");
    check(frame.setCamToolId(panelTools.front().id), "a catalogue tool is accepted", "");
  }

  // ── 3. THE PANELS DRAW, IN THE WORKSPACES THAT HOLD THEM ─────────────────
  shell.setWorkspace(forge::ui::WorkspaceProfile::Manufacturing);
  {
    const bool shown = showPanel(frame, "tool_library");
    check(shown, "the Tool Library tab draws its own panel", "");
    checkEq(frame.camToolRowsDrawn(), cam::toolLibrary().size(),
            "one row drawn per tool in the catalogue");
  }

  // ── 4. THE SECTION IS THE PART'S OWN GEOMETRY ────────────────────────────
  // The whole claim, in one number: the area enclosed by the outline, times the
  // part's height, is the volume the KERNEL measured. Two independent routes.
  {
    double z = 0.5 * (report.bboxMin[2] + report.bboxMax[2]);
    if (g_mutation == 2) z = report.bboxMax[2] + 10.0;  // above the part entirely
    frame.setCamSectionZ(static_cast<float>(z));
    const bool shown = showPanel(frame, "post_output");
    check(shown, "the Post Output tab draws its own panel", "");

    const cam::PartOutline& outline = frame.camOutline();
    check(outline.ok, "the section closed into a boundary", outline.advice);
    checkEq(outline.openChains, 0u, "every chain of the section closed");
    check(outline.trianglesCut > 0, "the plane passed through real triangles",
          std::to_string(outline.trianglesCut));
    // The default part is a plate with ONE through bore, so a section through its
    // middle is an outer boundary and exactly one island.
    checkEq(outline.loops.size(), 2u, "the section finds the outside and the bore");
    checkEq(outline.islands(), 1u, "the bore is reported as an island, not cut into the outline");

    const double height = report.bboxMax[2] - report.bboxMin[2];
    const double fromSection = outline.netAreaMm2() * height;
    // 1% of the kernel's own volume. The parts of the section that are curved --
    // the corner fillets and the bore -- arrive as chords, so the two routes
    // cannot agree exactly; they agree to about 0.02% in practice, and a
    // tolerance ten times looser than that still refuses any wrong outline.
    checkNear(fromSection, report.volume, report.volume * 0.01,
              "section area x height == the volume the kernel measured");
    std::printf("[gate] section: %zu loops, net area %.4f mm2, x %.3f mm = %.3f mm3 "
                "(kernel says %.3f, %.4f%%)\n",
                outline.loops.size(), outline.netAreaMm2(), height, fromSection, report.volume,
                report.volume == 0.0 ? 0.0
                                     : 100.0 * (fromSection - report.volume) / report.volume);

    // And the outline sits where the part does.
    const cam::OutlineLoop* outer = outline.outer();
    check(outer != nullptr, "the section has an outer boundary", "");
    if (outer != nullptr) {
      double lo[2] = {1e300, 1e300};
      double hi[2] = {-1e300, -1e300};
      for (const cam::Pt2& p : outer->points) {
        lo[0] = std::min(lo[0], p.x);
        lo[1] = std::min(lo[1], p.y);
        hi[0] = std::max(hi[0], p.x);
        hi[1] = std::max(hi[1], p.y);
      }
      checkNear(lo[0], report.bboxMin[0], 0.2, "the outline starts where the part does in X");
      checkNear(hi[0], report.bboxMax[0], 0.2, "the outline ends where the part does in X");
      checkNear(lo[1], report.bboxMin[1], 0.2, "the outline starts where the part does in Y");
      checkNear(hi[1], report.bboxMax[1], 0.2, "the outline ends where the part does in Y");
    }
  }

  // ── 5. THE MACHINE CODE IS THE POST-PROCESSOR'S ──────────────────────────
  {
    const cam::CamPlan& plan = frame.camPlan();
    check(plan.ok, "the operation produced a program", plan.advice);
    check(plan.passes > 0, "the operation has passes", std::to_string(plan.passes));
    check(plan.programLines > 0, "the program has lines", std::to_string(plan.programLines));
    checkEq(frame.camProgramRowsDrawn(), plan.programLines,
            "every line of the program reached the panel");

    // Re-post the SAME toolpath here, through the kernel, and require the text to
    // match byte for byte. A canned sample cannot survive this.
    if (plan.ok && frame.camOutline().outer() != nullptr) {
      const cam::OutlineLoop& loop = *frame.camOutline().outer();
      forge::camx::Polygon boundary;
      for (const cam::Pt2& p : loop.points) boundary.push_back(forge::camx::Pt2{p.x, p.y});
      forge::camx::ContourParams cp{};
      cp.depth = plan.params.depthMm;
      cp.stepdown = plan.stepdownMm;
      cp.climb = true;
      const std::vector<forge::camx::Polyline3> passes = forge::camx::contourToolpath(
          boundary, plan.tool.id, forge::camx::ContourSide_Outside, cp);
      checkEq(passes.size(), plan.passes, "the panel has the passes the kernel generated");
      forge::camx::PostParams pp{};
      pp.spindleRPM = plan.spindleRpm;
      pp.feed = plan.feedMmPerMin;
      pp.safeZ = plan.params.safeZMm;
      pp.toolId = plan.tool.id;
      std::string expected =
          forge::camx::postProcess(passes, forge::camx::Post_Fanuc, pp);
      if (g_mutation == 5) {
        // The defect: a sample program shipped in place of the real one.
        expected = "%\nO0001 (SAMPLE)\nG0 X0 Y0\nM30\n%\n";
      }
      check(plan.program == expected, "the program is what the post-processor wrote",
            "length " + std::to_string(plan.program.size()) + " vs " +
                std::to_string(expected.size()));
      const forge::camx::CycleTime ct = forge::camx::estimateCycleTime(passes, plan.feedMmPerMin);
      checkNear(plan.pathLengthMm, ct.totalLengthMm, 1e-9,
                "the cutting length is the kernel's estimate");
      checkNear(plan.cutSeconds, ct.timeSec, 1e-9, "the cutting time is the kernel's estimate");
    }

    // The dialect is not decoration: each post writes a different first line.
    check(plan.program.rfind("%", 0) == 0, "the Fanuc program opens the way Fanuc programs open",
          plan.program.substr(0, 24));
    // Every cutting move names the feed the tool library derived.
    char feedWord[32];
    std::snprintf(feedWord, sizeof(feedWord), "F%.1f", plan.feedMmPerMin);
    check(plan.program.find(feedWord) != std::string::npos,
          "the program cuts at the feed the tool library derived", feedWord);
    std::printf("[gate] program: %zu lines, %zu passes, %.1f mm of cutting, %.1f s\n",
                plan.programLines, plan.passes, plan.pathLengthMm, plan.cutSeconds);
  }

  // ── 6. THE STOCK IS MEASURED FROM THE PART ───────────────────────────────
  {
    const bool shown = showPanel(frame, "stock");
    check(shown, "the Stock tab draws its own panel", "");
    check(frame.camStockRowsDrawn() > 0, "the Stock panel drew rows",
          std::to_string(frame.camStockRowsDrawn()));

    cam::StockBlock block = frame.camStock();
    if (g_mutation == 4) {
      // The defect: a block of a written-in size instead of the part's own.
      block = cam::stockAround((const double[3]){0.0, 0.0, 0.0},
                               (const double[3]){100.0, 100.0, 100.0}, 0.0, 0.0);
    }
    check(block.ok, "the block has a size", "");
    for (int i = 0; i < 3; ++i) {
      check(block.minMm[i] <= report.bboxMin[i] + 1e-9, "the block reaches past the part",
            "axis " + std::to_string(i));
      check(block.maxMm[i] >= report.bboxMax[i] - 1e-9, "the block covers the part",
            "axis " + std::to_string(i));
    }
    // Nothing is added underneath: the part's underside is the fixture datum.
    checkNear(block.minMm[2], report.bboxMin[2], 1e-9, "the block sits on the part's underside");
    checkNear(block.volumeMm3, block.sizeMm[0] * block.sizeMm[1] * block.sizeMm[2], 1e-6,
              "the block's volume is its own three sides");
    check(block.volumeMm3 > report.volume, "the block is bigger than the finished part",
          std::to_string(block.volumeMm3));

    const cam::StockCutReport& cut = frame.camCut();
    check(cut.ok, "the operation was run through the block", cut.advice);
    double removed = cut.startVolumeMm3 - cut.leftVolumeMm3;
    if (g_mutation == 7) removed = cut.startVolumeMm3 + cut.leftVolumeMm3;
    checkNear(cut.removedVolumeMm3, removed, 1e-6, "removed is what went missing from the block");
    check(cut.removedVolumeMm3 > 0.0, "the operation removed material",
          std::to_string(cut.removedVolumeMm3));
    check(cut.leftVolumeMm3 > 0.0, "the operation did not remove the whole block",
          std::to_string(cut.leftVolumeMm3));
    check(cut.deepestCutMm <= frame.camStock().sizeMm[2] + 1e-6,
          "the deepest cut is inside the block", std::to_string(cut.deepestCutMm));
    check(cut.gridCells > 0, "the simulation says how finely it measured",
          std::to_string(cut.gridCells));
    std::printf("[gate] stock: %.2f x %.2f x %.2f mm, removed %.3f of %.3f mm3 on a %u cell grid\n",
                frame.camStock().sizeMm[0], frame.camStock().sizeMm[1], frame.camStock().sizeMm[2],
                cut.removedVolumeMm3, cut.startVolumeMm3, cut.gridCells);
  }

  // ── 7. ONE WEIGHT, TWO PANELS ────────────────────────────────────────────
  // The defect this exists for is the one that would matter most: the Properties
  // tab and the Materials tab both report what the part weighs, and two readouts
  // of one physical quantity that can disagree will.
  {
    shell.setWorkspace(forge::ui::WorkspaceProfile::Simulation);
    const bool shown = showPanel(frame, "materials");
    check(shown, "the Materials tab draws its own panel", "");
    check(frame.camMaterialRowsDrawn() > 0, "the Materials panel drew rows",
          std::to_string(frame.camMaterialRowsDrawn()));

    // A fresh document has no material, and a part with no density reports no
    // weight rather than 0 g.
    check(!frame.partMass().known, "a part with no material has no weight", "");
    checkEqStr(forge::ui::describeMass(frame.partMass(), forge::ui::MassUnit::Gram),
               "-- (no density)", "an unknown weight says so");

    // Assign one THROUGH THE REGISTRY, the way the panel does.
    forge::ui::CommandParams params;
    params.setText("material", "aluminium-6061");
    const forge::ui::DispatchResult r = shell.run("part.set_material", params);
    check(r.ok(), "part.set_material ran", forge::ui::machineName(r.status));

    const forge::ui::Material* library = forge::ui::findMaterial("aluminium-6061");
    check(library != nullptr, "the library holds the material that was chosen", "");
    double density = library == nullptr ? 0.0 : library->densityKgPerM3;
    if (g_mutation == 3) density = 2810.0;  // the defect: a written-in density

    const forge::ui::MassProperties mass = frame.partMass();
    check(mass.known, "the part now has a weight", "");
    checkNear(mass.volumeMm3, report.volume, 1e-9, "the weight is taken on the kernel's volume");
    checkNear(mass.densityKgPerM3, density, 1e-9, "the weight uses the document's own density");
    checkNear(mass.massGrams, report.volume * density / 1.0e6, 1e-9,
              "weight is volume x density, in grams");
    std::printf("[gate] mass: %.4f mm3 of %s at %.0f kg/m3 = %s\n", mass.volumeMm3,
                library == nullptr ? "?" : library->name.c_str(), mass.densityKgPerM3,
                forge::ui::describeMass(mass, forge::ui::MassUnit::Gram).c_str());

    // ── the two panels read the SAME call ──────────────────────────────────
    // No run-time observable can see WHICH function a panel called, so this is
    // read out of the frame builder's own source, the way the reachability gate
    // reads the dispatch. partMass() is the one place the weight is worked out.
    const std::string framePath = repoRoot() + "/forge-desktop/src/ForgeFrame.cpp";
    bool readable = false;
    const std::string src = readWholeFile(framePath, readable);
    check(readable, "the frame builder's source can be read", framePath);
    if (readable) {
      const char* propertiesFn = g_mutation == 6 ? "void ForgeFrame::drawConsolePanel("
                                                 : "void ForgeFrame::drawPropertiesPanel(";
      const std::string properties = functionBody(src, propertiesFn);
      const std::string materials = functionBody(src, "void ForgeFrame::drawMaterialsPanel(");
      check(!properties.empty(), "the Properties panel is in the source", propertiesFn);
      check(!materials.empty(), "the Materials panel is in the source", "");
      check(properties.find("partMass()") != std::string::npos,
            "the Properties panel reads the shared weight", propertiesFn);
      check(materials.find("partMass()") != std::string::npos,
            "the Materials panel reads the shared weight", "");
    }

    // ── it survives a save and a reopen ────────────────────────────────────
    const std::string path = tempPath("forge_cam_panels_gate.fpart");
    std::string why;
    check(frame.documentSave(path, why), "the document saved", why);
    bool haveText = false;
    const std::string onDisk = readWholeFile(path, haveText);
    check(haveText, "the saved file can be read back", path);
    // The keys are the ones the OTHER writer of this same format already used --
    // see the comment in PartFile.cpp -- so a document saved here is a document
    // the newer reader understands.
    check(onDisk.find("MATERIAL-ID aluminium-6061") != std::string::npos,
          "the file records which material", "");
    // The DENSITY line is compared against the format's own number spelling
    // rather than a transcription of it: formatRoundTripNumber writes 2700 as
    // "2.7e+03", and a gate that pinned "2700" would be asserting a spelling
    // this format does not use.
    const std::string densityLine =
        "MATERIAL-DENSITY " + forge::ui::formatRoundTripNumber(density);
    check(onDisk.find(densityLine) != std::string::npos,
          "the file records the density, not just the name", densityLine);

    forge::desktop::PartFileDoc reloaded;
    check(forge::desktop::loadPartFile(path, reloaded, why), "the file loads again", why);
    checkEqStr(reloaded.material.id, "aluminium-6061", "the material comes back");
    checkNear(reloaded.material.densityKgPerM3, density, 1e-9, "the density comes back");
    forge::ui::PartDocument restored;
    check(forge::desktop::restorePartDocument(reloaded, restored, why), "the document restores",
          why);
    checkNear(restored.massProperties(report.volume).massGrams, mass.massGrams, 1e-9,
              "the reopened part weighs what the saved one did");
    std::remove(path.c_str());

    // ── and Ctrl+Z puts the old one back ───────────────────────────────────
    check(frame.documentUndo(), "the material change can be undone", "");
    check(!frame.partMass().known, "undo took the weight away again", "");
    check(frame.documentRedo(), "and redone", "");
    checkNear(frame.partMass().massGrams, mass.massGrams, 1e-9, "redo put the weight back");

    // ── a NEW document has not been given a material ───────────────────────
    // PartDocument::Snapshot does not carry the material -- deliberately, so
    // undoing a fillet cannot change what the part is made of -- which means
    // restore() alone would leave the last document's material on the new one.
    // A part nobody has chosen a material for must not arrive weighing 209 g.
    check(frame.documentNew(why), "a new document opens", why);
    check(!frame.partMass().known, "a new document has no material", "");
    checkEqStr(frame.partDocumentMaterialId(), "unassigned",
               "a new document says it has no material, by name");
  }

  // ── 8. THE CACHE DOES NOT GO STALE, AND DOES NOT THRASH ──────────────────
  {
    shell.setWorkspace(forge::ui::WorkspaceProfile::Manufacturing);
    (void)showPanel(frame, "stock");
    const std::size_t settled = frame.camRecomputes();
    step(frame);
    step(frame);
    checkEq(frame.camRecomputes(), settled, "an unchanged frame recomputes nothing");
    const std::uint32_t other = cam::toolLibrary().back().id;
    check(frame.setCamToolId(other), "a second tool can be chosen", "");
    step(frame);
    checkEq(frame.camRecomputes(), settled + 1, "changing the tool recomputes once");
    checkEq(frame.camPlan().tool.id, other, "the operation now uses the tool that was chosen");
  }

  // ── 9. THE PROGRAM CAN LEAVE THE APPLICATION ─────────────────────────────
  // Everything above proves the Manufacturing workspace computes a real program.
  // NOTHING above proves a machinist can ever get it, and until file.export_gcode
  // existed nobody could: the only egress was ImGui::SetClipboardText behind the
  // Copy button, and a shop cannot paste a clipboard into a machine.
  //
  // The claim asserted here is the strongest one available and it is one line:
  // THE BYTES ON DISK ARE THE PROGRAM THIS GATE ALREADY PROVED, byte for byte --
  // check 5 above re-posted the same toolpath through forge::camx::postProcess
  // and required an exact match, so a file equal to camPlan().program is a file
  // equal to the post-processor's own output.
  {
    std::printf("\n-- 9. the machine program reaches a file ----------------------------\n");

    // ── EVERY SENTENCE THIS FEATURE CAN SHOW ───────────────────────────────
    // The closed refusal set, walked, because a value added to the enum with no
    // sentence written for it is the defect the set exists to prevent. The
    // predicate's own positive control -- proof that isUserReadable has ever said
    // no -- lives in forge_desktop_file_exchange_gate, which feeds it the
    // kernel's real leaked strings; this is the other half, over the sentences
    // this feature owns.
    {
      std::size_t sentences = 0;
      for (const forge::ui::MachineProgramRefusal refusal :
           forge::ui::kAllMachineProgramRefusals) {
        for (const std::string& path : {std::string(), std::string("/Users/a_b/part_v2.nc")}) {
          const std::string m = forge::ui::machineProgramMessage(refusal, path);
          ++sentences;
          check(!m.empty(), "every refusal has a sentence", forge::ui::toString(refusal));
          check(forge::ui::isUserReadable(m),
                "every refusal is in plain words", std::string(forge::ui::toString(refusal)) +
                                                       ": " + m);
        }
      }
      // And the success sentence, in every dialect the post-processor writes.
      for (const cam::PostFlavour post : {cam::PostFlavour::Fanuc, cam::PostFlavour::Heidenhain,
                                          cam::PostFlavour::Siemens}) {
        const std::string m = forge::ui::machineProgramSuccessMessage(cam::toString(post), 578,
                                                                     "/Users/a_b/part_v2.nc");
        ++sentences;
        check(forge::ui::isUserReadable(m), "the success sentence is in plain words", m);
        check(m.find(cam::toString(post)) != std::string::npos,
              "the success sentence names the dialect", m);
      }
      // A SOURCE THAT HANDS OVER AN IDENTIFIER does not get to put it in front of
      // a machinist: the dialect is the one word of that sentence this layer did
      // not write, so it is checked before it is pasted in.
      const std::string leaked = forge::ui::machineProgramSuccessMessage(
          "TopoDS_Shape", 1, "/Users/a_b/part_v2.nc");
      check(forge::ui::isUserReadable(leaked),
            "a leaked dialect name is kept out of the success sentence", leaked);
      std::printf("[gate] %zu machine-program sentences, all plain\n", sentences);
    }

    const forge::ui::CommandRegistry& reg = shell.registry();
    const forge::ui::CommandDescriptor* d = reg.find("file.export_gcode");
    check(d != nullptr, "file.export_gcode is registered", "");
    if (d != nullptr) {
      checkEqStr(d->category, "File", "the export sits in the File category");
      check(d->featureIrOp.empty(), "the export claims no feature-IR op", d->featureIrOp);
      check(d->schema.size() == 1 && d->schema[0].name == "path" &&
                d->schema[0].type == forge::ui::ParamType::Text && d->schema[0].required &&
                !d->schema[0].hasDefault,
            "the export takes exactly one required path with no default", "");
      check(static_cast<bool>(d->execute) && static_cast<bool>(d->enabled),
            "the export has a handler and an enabled predicate", "");
    }

    // A SHELL WITH NO CAM BEHIND IT SAYS SO BY BEING DISABLED, rather than by
    // failing when it is pressed -- the contract every other file command keeps.
    // Every headless forge::ui gate is exactly this configuration.
    {
      forge::ui::ForgeShell bare;
      check(bare.machineProgramSource() == nullptr, "a bare shell has no machine-program source",
            "");
      // WITH a path supplied, so the only question left is availability:
      // evaluate() reports a missing required parameter before it reports
      // anything else, and "you did not give me a file name" is not the answer
      // being checked here.
      forge::ui::CommandParams withPath;
      withPath.setText("path", tempPath("forge_cam_gate_never_written.nc"));
      const forge::ui::DispatchResult pre =
          bare.registry().evaluate("file.export_gcode", bare.selection(), withPath);
      check(pre.status == forge::ui::DispatchStatus::Disabled,
            "with no source installed the export is DISABLED, not merely failing",
            forge::ui::machineName(pre.status));
    }

    // And in THIS shell, where the Manufacturing panels have run, the only thing
    // standing between the command and running is the path.
    const cam::CamPlan& plan = frame.camPlan();
    check(plan.ok && !plan.program.empty(), "there is a program to export", plan.advice);
    {
      const forge::ui::DispatchResult pre =
          shell.registry().evaluate("file.export_gcode", shell.selection());
      check(pre.status == forge::ui::DispatchStatus::MissingRequiredParameter &&
                pre.detail == "path",
            "with a program set up the export waits only for a file name",
            std::string(forge::ui::machineName(pre.status)) + " " + pre.detail);
    }

    // ── THE EXPORT ─────────────────────────────────────────────────────────
    const std::string programPath = tempPath("forge_cam_panels_gate_program.nc");
    std::remove(programPath.c_str());
    const std::string firstProgram = plan.program;
    const std::size_t firstLines = plan.programLines;
    const std::string firstDialect = cam::toString(plan.params.post);

    forge::ui::CommandParams params;
    params.setText("path", programPath);
    const forge::ui::DispatchResult wrote = shell.run("file.export_gcode", params);
    check(wrote.ok(), "the export ran",
          std::string(forge::ui::machineName(wrote.status)) + " " + shell.lastDocumentError());

    bool onDiskOk = false;
    std::string onDisk = readWholeFile(programPath, onDiskOk);
    check(onDiskOk, "the program is on disk and can be read back", programPath);
    // THE CHECK THIS SECTION EXISTS FOR. Mutation 8 replaces the expectation with
    // a canned program, exactly as mutation 5 does for the panel.
    std::string wantProgram = firstProgram;
    if (g_mutation == 8) wantProgram = "%\nO0002 (CANNED)\nG0 X0 Y0\nM30\n%\n";
    check(onDisk == wantProgram, "the FILE is the program the post-processor wrote",
          "on disk " + std::to_string(onDisk.size()) + " bytes vs " +
              std::to_string(wantProgram.size()));
    // And the file really holds the lines the panel counted -- a byte comparison
    // alone would pass on two identically-wrong strings.
    std::size_t newlines = 0;
    for (const char c : onDisk) {
      if (c == '\n') ++newlines;
    }
    checkEq(newlines, firstLines, "the file holds one line per line the panel counted");

    // ── WHAT THE SHELL REPORTS ABOUT WHAT IT DID ───────────────────────────
    const forge::ui::MachineProgramReport& rep = shell.lastMachineProgram();
    check(rep.ok, "the shell reports the export succeeded", rep.message);
    checkEq(rep.lines, firstLines, "the report names the lines the panel counted");
    checkEqStr(rep.dialect, firstDialect, "the report names the dialect the panel chose");
    checkEq(static_cast<std::size_t>(rep.bytes), onDisk.size(),
            "the report names the bytes that are on disk");
    check(forge::ui::isUserReadable(rep.message), "the success sentence is plain", rep.message);
    check(rep.message.find(firstDialect) != std::string::npos,
          "the success sentence names the dialect", rep.message);
    std::printf("[gate] exported: %zu bytes, %zu lines, %s -- \"%s\"\n", onDisk.size(), rep.lines,
                rep.dialect.c_str(), rep.message.c_str());

    // ── IT FOLLOWS THE PANEL, IT IS NOT A CACHED FIRST ANSWER ──────────────
    // "The file I saved is not the program on screen" is the worst defect a Save
    // can have. Change the tool -- which changes the feed, and therefore every
    // cutting line of the program -- and export again.
    const std::uint32_t otherTool = cam::toolLibrary().front().id;
    check(otherTool != plan.tool.id, "a second tool is available to switch to",
          std::to_string(otherTool));
    check(frame.setCamToolId(otherTool), "the second tool was accepted", "");
    step(frame);
    const std::string secondProgram = frame.camPlan().program;
    check(secondProgram != firstProgram, "changing the tool changed the program",
          std::to_string(secondProgram.size()) + " vs " + std::to_string(firstProgram.size()));

    std::remove(programPath.c_str());
    const forge::ui::DispatchResult wroteAgain = shell.run("file.export_gcode", params);
    check(wroteAgain.ok(), "the second export ran", shell.lastDocumentError());
    onDisk = readWholeFile(programPath, onDiskOk);
    check(onDiskOk, "the second program is on disk", programPath);
    // MUTATION 9: the defect is an export that keeps writing the program the
    // panel FIRST had. Pinning the old text here is what that defect looks like,
    // and it must go red against a file that correctly holds the new one.
    const std::string wantSecond = (g_mutation == 9) ? firstProgram : secondProgram;
    check(onDisk == wantSecond, "the file follows the panel rather than the first export",
          "on disk " + std::to_string(onDisk.size()) + " bytes vs " +
              std::to_string(wantSecond.size()));
    std::printf("[gate] re-exported after a tool change: %zu bytes, %zu lines (was %zu bytes, "
                "%zu lines)\n",
                onDisk.size(), frame.camPlan().programLines, firstProgram.size(), firstLines);

    // ── THE BYTES ARE THE POST-PROCESSOR'S, NOT THE PANEL'S STRING ─────────
    // Every comparison above is against camPlan().program, and check 5 is what
    // says that string is the post-processor's own output. That is a CHAIN, and a
    // chain has a link in it that this section did not test. So the link is
    // removed: the toolpath is generated and posted a SECOND time, here, from the
    // kernel, and the bytes on disk are compared against THAT. A panel that had
    // quietly started holding something else would break this and not the others.
    {
      const cam::OutlineLoop* outer = frame.camOutline().outer();
      check(outer != nullptr, "the section still has an outer boundary", "");
      if (outer != nullptr) {
        const cam::CamPlan& now = frame.camPlan();
        forge::camx::Polygon boundary;
        for (const cam::Pt2& p : outer->points) boundary.push_back(forge::camx::Pt2{p.x, p.y});
        forge::camx::ContourParams cp{};
        cp.depth = now.params.depthMm;
        cp.stepdown = now.stepdownMm;
        cp.climb = true;
        const std::vector<forge::camx::Polyline3> passes = forge::camx::contourToolpath(
            boundary, now.tool.id, forge::camx::ContourSide_Outside, cp);
        forge::camx::PostParams pp{};
        pp.spindleRPM = now.spindleRpm;
        pp.feed = now.feedMmPerMin;
        pp.safeZ = now.params.safeZMm;
        pp.toolId = now.tool.id;
        const std::string posted = forge::camx::postProcess(passes, forge::camx::Post_Fanuc, pp);
        check(!posted.empty(), "the kernel posted a program for this gate to compare against",
              std::to_string(passes.size()) + " passes");
        check(onDisk == posted, "the FILE is byte-for-byte what the post-processor wrote",
              "on disk " + std::to_string(onDisk.size()) + " bytes vs a fresh post of " +
                  std::to_string(posted.size()));
      }
    }
    std::remove(programPath.c_str());

    // ── AND IT REFUSES, IN PLAIN WORDS ─────────────────────────────────────
    // A folder that is not there is the most ordinary Save error once a path is
    // typed rather than picked. Save a Copy as STEP refuses it; this must refuse
    // it the same way rather than inventing the folder, and it must leave nothing
    // behind. MUTATION 10 points the same check at a folder that DOES exist.
    {
      const std::string missingDir = tempPath("forge_cam_panels_gate_no_such_folder");
      const std::string nowhere =
          g_mutation == 10 ? tempPath("forge_cam_gate_here.nc") : (missingDir + "/program.nc");
      std::remove(nowhere.c_str());
      forge::ui::CommandParams bad;
      bad.setText("path", nowhere);
      const forge::ui::DispatchResult refused = shell.run("file.export_gcode", bad);
      check(!refused.ok(), "a save into a folder that is not there was refused", nowhere);
      check(!onDiskExists(nowhere), "nothing was written where the folder does not exist",
            nowhere);
      check(!onDiskExists(missingDir), "no folder was invented", missingDir);
      const forge::ui::MachineProgramReport& badRep = shell.lastMachineProgram();
      check(!badRep.ok, "the report says the export did not happen", badRep.message);
      check(forge::ui::isUserReadable(badRep.message), "the refusal is in plain words",
            badRep.message);
      std::printf("[gate] refused  : \"%s\"\n", badRep.message.c_str());
      std::remove(nowhere.c_str());
    }
    // A path with nothing in it is its own refusal and its own sentence.
    {
      forge::ui::CommandParams empty;
      empty.setText("path", "");
      const forge::ui::DispatchResult refused = shell.run("file.export_gcode", empty);
      check(!refused.ok(), "an empty file name was refused", "");
      check(shell.lastMachineProgram().refusal == forge::ui::MachineProgramRefusal::NoPath,
            "an empty file name was refused as a missing name",
            forge::ui::toString(shell.lastMachineProgram().refusal));
      check(forge::ui::isUserReadable(shell.lastMachineProgram().message),
            "that refusal is in plain words too", shell.lastMachineProgram().message);
    }
  }

  std::printf("\n[gate] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures == 0) {
    std::printf("[gate] ALL MANUFACTURING PANEL GATES PASS (headless: no window, no display)\n");
  }
  return g_failures == 0 ? 0 : 1;
}
