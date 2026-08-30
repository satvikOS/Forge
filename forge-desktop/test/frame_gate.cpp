// forge-desktop/test/frame_gate.cpp
//
// THE HEADLESS FRAME GATE. It builds REAL frames of the real application shell —
// the same ForgeFrame the windowed app builds, over the same forge::ui services
// and the same tessellated kernel body — with NO window, NO swapchain, NO
// MoltenVK and NO display, and asserts on what comes out.
//
// Every check asserts a VALUE against a reference, per SR-3. None of them assert
// "it did not crash". Where the reference is a count derived from another part of
// the system (the registry's own size, the mesh's own triangle count), it is READ
// from that part rather than hard-coded, so the gate cannot drift into agreeing
// with a stale number.
//
// PROVING THE GATE CAN FAIL: run with `--mutate <n>` to inject defect n and watch
// the corresponding check go red. The mutations are the real ones this code could
// plausibly regress into, not synthetic aborts:
//   1  the frame builder is never told to draw          -> draw data is empty
//   2  Part commands are not registered                 -> registry too small
//   3  the selection is not routed to the mesh          -> no vertex is flagged
//   4  the feature tree is materialized eagerly         -> cache cap exceeded
//   5  the projection loses its Vulkan Y-flip           -> ray/pick disagree
//   6  the Measure panel is not fed the live selection  -> it measures nothing
//   7  the Tools panel answers from a STALE selection   -> it offers what refuses
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
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/ToolCatalog.hpp"
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
    std::printf("  FAIL  %-52s  %s\n", what, detail.c_str());
  }
}

template <typename A, typename B>
void checkEq(const A& got, const B& want, const char* what) {
  ++g_checks;
  if (!(got == static_cast<A>(want))) {
    ++g_failures;
    std::printf("  FAIL  %-52s  got %s want %s\n", what, std::to_string(got).c_str(),
                std::to_string(want).c_str());
  }
}

template <typename A, typename B>
void checkGe(const A& got, const B& floor, const char* what) {
  ++g_checks;
  if (!(got >= static_cast<A>(floor))) {
    ++g_failures;
    std::printf("  FAIL  %-52s  got %s, need >= %s\n", what, std::to_string(got).c_str(),
                std::to_string(floor).c_str());
  }
}

template <typename A, typename B>
void checkLe(const A& got, const B& ceiling, const char* what) {
  ++g_checks;
  if (!(got <= static_cast<A>(ceiling))) {
    ++g_failures;
    std::printf("  FAIL  %-52s  got %s, need <= %s\n", what, std::to_string(got).c_str(),
                std::to_string(ceiling).c_str());
  }
}

// A headless ImGui context. The renderer backend is NULL: ImGui only needs a font
// atlas with a texture id set for the draw lists to be built, and setting it by
// hand is exactly what a null backend does.
struct HeadlessImGui {
  HeadlessImGui(float w, float h) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(w, h);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "frame_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

ImDrawData* buildOneFrame(forge::desktop::ForgeFrame& frame, std::uint64_t tex) {
  ImGui::NewFrame();
  if (g_mutation != 1) frame.build(tex, 1.0f);
  ImGui::Render();
  return ImGui::GetDrawData();
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[gate] MUTATION %d ACTIVE\n", g_mutation);

  // ── 1. the kernel body ───────────────────────────────────────────────────
  std::printf("[gate] building the kernel body...\n");
  forge::desktop::KernelScene scene;
  const bool built = scene.build();
  check(built, "kernel body builds", scene.error());
  if (!built) {
    std::printf("[gate] cannot continue without geometry\n");
    return 1;
  }
  std::printf("[gate] %zu triangles, %u faces, %zu ops  [%s]\n", scene.triangleCount(),
              scene.faceCount(), scene.lastBuild().nCompiled, scene.backend().c_str());

  checkGe(scene.triangleCount(), 12u, "tessellation yields at least a box's triangles");
  checkGe(scene.faceCount(), 6u, "the body has at least a box's faces");
  checkEq(scene.vertices().size(), scene.triangleCount() * 3,
          "vertex stream is de-indexed 3-per-triangle");
  // The reference is READ from the seed table rather than hard-coded, so the
  // gate cannot drift into agreeing with a stale number. The SCENE no longer
  // keeps a history of its own -- it keeps geometry -- so the claim is on the
  // compiler's own op reconciliation; the history itself is asserted against the
  // document below, and against the tree source in the document gate.
  checkEq(scene.lastBuild().nCompiled, forge::desktop::defaultPartStatements().size(),
          "one compiled op per statement in the default part program");
  check(scene.lastBuild().ok(), "the default part compiled through forge::ft",
        scene.lastBuild().error);
  checkEq(scene.lastBuild().nDeclared, scene.lastBuild().nParsed,
          "s0.4: declared == parsed");
  checkEq(scene.lastBuild().nParsed, scene.lastBuild().nCompiled,
          "s0.4: parsed == compiled");
  check(scene.bounds().valid, "bounds computed", "");
  // The plate is 80 x 50 x 20 with a 3 mm fillet: the bounding box must be the
  // plate's, to within the tessellation deflection.
  const float dx = scene.bounds().max[0] - scene.bounds().min[0];
  const float dy = scene.bounds().max[1] - scene.bounds().min[1];
  const float dz = scene.bounds().max[2] - scene.bounds().min[2];
  check(std::fabs(dx - 80.0f) < 0.2f, "bounding box X == 80mm", std::to_string(dx));
  check(std::fabs(dy - 50.0f) < 0.2f, "bounding box Y == 50mm", std::to_string(dy));
  check(std::fabs(dz - 20.0f) < 0.2f, "bounding box Z == 20mm", std::to_string(dz));

  // Every triangle must name a face, or picking is a lie.
  std::size_t unfaced = 0;
  for (const forge::desktop::SceneVertex& v : scene.vertices()) {
    if (v.faceId == 0) ++unfaced;
  }
  checkEq(unfaced, 0u, "every vertex carries an OCCT face id");

  // ── 2. the camera and the picking ray ────────────────────────────────────
  {
    forge::desktop::Camera cam;
    cam.setAspect(1.6f);
    float c[3];
    scene.bounds().centre(c);
    cam.setIsometric();
    cam.frame(c, scene.bounds().radius());
    checkGe(cam.distance(), scene.bounds().radius(), "fit places the eye outside the body");

    // A ray through the viewport CENTRE must hit the part that the fit framed.
    float ro[3], rd[3];
    cam.ray(640.0f, 400.0f, 1280.0f, 800.0f, ro, rd);
    if (g_mutation == 5) {
      rd[1] = -rd[1];  // the classic Vulkan Y-flip regression
    }
    const forge::desktop::PickResult hit = scene.pick(ro, rd);
    check(hit.hit(), "centre ray hits the framed body", "no triangle intersected");
    checkGe(hit.faceId, 1u, "the hit names a face");

    // A ray aimed far off the part must MISS. A picker that hits everything is
    // worse than one that hits nothing, because it looks like it works.
    float away[3] = {-rd[0], -rd[1], -rd[2]};
    const forge::desktop::PickResult miss = scene.pick(ro, away);
    check(!miss.hit(), "a ray pointing away from the body misses", "");

    // Standard views are distinct: front, top and right must not coincide.
    cam.setFront();
    const float frontEl = cam.elevation();
    cam.setTop();
    const float topEl = cam.elevation();
    check(std::fabs(topEl - frontEl) > 1.0f, "top view differs from front view",
          std::to_string(topEl - frontEl));

    // Orbit must clamp at the poles rather than flipping the up vector.
    for (int i = 0; i < 200; ++i) cam.orbit(0.0f, 0.5f);
    checkLe(cam.elevation(), 1.5708f, "elevation clamps below the north pole");
    for (int i = 0; i < 400; ++i) cam.orbit(0.0f, -0.5f);
    checkGe(cam.elevation(), -1.5708f, "elevation clamps above the south pole");

    // Zoom is multiplicative and bounded.
    const float d0 = cam.distance();
    cam.zoom(1.0f);
    check(cam.distance() < d0, "wheel-forward zooms in", std::to_string(cam.distance()));
    for (int i = 0; i < 500; ++i) cam.zoom(1.0f);
    checkGe(cam.distance(), 1e-3f, "zoom cannot reach or pass the target");
  }

  // ── 3. the four navigation profiles are genuinely different ──────────────
  {
    using forge::ui::InputProfile;
    forge::desktop::NavInput mid;
    mid.middle = true;
    checkEq(static_cast<int>(forge::desktop::navVerbFor(InputProfile::ForgeNative, mid)),
            static_cast<int>(forge::desktop::NavVerb::Orbit), "Forge: MMB orbits");
    checkEq(static_cast<int>(forge::desktop::navVerbFor(InputProfile::NXLike, mid)),
            static_cast<int>(forge::desktop::NavVerb::Orbit), "NX: MB2 rotates");
    // The one that actually differs, and the reason four profiles exist.
    checkEq(static_cast<int>(forge::desktop::navVerbFor(InputProfile::CATIALike, mid)),
            static_cast<int>(forge::desktop::NavVerb::Pan), "CATIA: MMB alone PANS");
    forge::desktop::NavInput midRight = mid;
    midRight.right = true;
    checkEq(static_cast<int>(forge::desktop::navVerbFor(InputProfile::CATIALike, midRight)),
            static_cast<int>(forge::desktop::NavVerb::Orbit), "CATIA: MMB+RMB rotates");
    forge::desktop::NavInput shiftMid = mid;
    shiftMid.shift = true;
    checkEq(static_cast<int>(forge::desktop::navVerbFor(InputProfile::BlenderLike, shiftMid)),
            static_cast<int>(forge::desktop::NavVerb::Pan), "Blender: Shift+MMB pans");
    forge::desktop::NavInput altLeft;
    altLeft.alt = true;
    altLeft.left = true;
    checkEq(static_cast<int>(forge::desktop::navVerbFor(InputProfile::BlenderLike, altLeft)),
            static_cast<int>(forge::desktop::NavVerb::Orbit), "Blender: Alt+LMB orbits");
    forge::desktop::NavInput none;
    checkEq(static_cast<int>(forge::desktop::navVerbFor(InputProfile::CATIALike, none)),
            static_cast<int>(forge::desktop::NavVerb::None), "no button, no navigation verb");
  }

  // ── 4. the shell, the registry and the frame ─────────────────────────────
  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  const std::size_t shellCommands = shell.registry().size();
  forge::desktop::ForgeFrame frame(shell, scene);
  if (g_mutation != 2) frame.wirePartCommands();

  // The 18 Part commands went into THE SAME registry the shell dispatches.
  checkEq(shell.registry().size(), shellCommands + forge::ui::partCommandIds().size(),
          "Part commands joined the shell's one registry");
  for (const std::string& id : forge::ui::partCommandIds()) {
    check(shell.registry().contains(id), "registry holds a Part command", id);
  }

  ImDrawData* dd = buildOneFrame(frame, 0);
  check(dd != nullptr, "ImGui produced draw data", "");
  if (dd != nullptr) {
    std::printf("[gate] frame 1: %d vtx / %d idx across %d draw lists, %zu panels\n",
                dd->TotalVtxCount, dd->TotalIdxCount, dd->CmdListsCount, frame.panelsDrawn());
    checkGe(dd->TotalVtxCount, 1000, "the shell frame draws real geometry");
    checkGe(dd->TotalIdxCount, 1500, "the shell frame emits real indices");
    checkGe(dd->CmdListsCount, 4, "menu, chrome and docked panels each draw");
  }
  // The Part workspace's default layout has 8 panels in 4 tab groups; exactly one
  // panel per group is drawn, so 4 is the count the dock tree implies.
  checkEq(frame.panelsDrawn(), 4u, "one panel per tab group was drawn");
  check(frame.viewport().visible, "the 3D viewport panel was laid out", "");
  checkGe(frame.viewport().width, 100, "the viewport got real pixels");
  checkGe(frame.viewport().height, 100, "the viewport got real pixels");

  // ── 5. the feature tree virtualizes ──────────────────────────────────────
  //
  // forge::ui's own gate proves FeatureTreeModel bounds a 100,000-row tree. What
  // is asserted HERE is the APP'S WIRING of it: that the panel reads through
  // window() and therefore re-uses the cache, instead of calling the source's
  // expensive data() once per row per frame. That claim is only visible across
  // two frames, so it takes two.
  std::printf("[gate] tree: %zu rows, %zu materialized, peak %zu, %zu fetches\n",
              frame.treeRowCount(), frame.treeMaterialized(), frame.treePeakMaterialized(),
              frame.treeFetches());
  checkGe(frame.treeRowCount(), frame.document().records().size(),
          "the tree has a row per DOCUMENT statement");
  checkLe(frame.treePeakMaterialized(), 256u,
          "never more rows materialized than the cache holds");
  checkGe(frame.treeRowsDrawn(), 1u, "tree rows were actually drawn");
  {
    const std::size_t after1 = frame.treeFetches();
    checkGe(after1, 1u, "the first frame materialized the rows it drew");
    if (g_mutation == 4) {
      // MUTATION 4: the panel is rewritten to call the SOURCE's expensive fetch
      // per row instead of going through the model's window(). That is the exact
      // regression virtualization exists to prevent, and it is invisible to any
      // check that only looks at what the frame drew.
      for (std::size_t i = 0; i < frame.treeRowCount(); ++i) {
        frame.treeSource().data(frame.tree().rowAt(i).id);
      }
    }
    buildOneFrame(frame, 0);
    checkEq(frame.treeFetches(), after1,
            "a second frame costs the source NO new expensive fetch");
  }

  // ── 6. selection: pick -> typed EntityRef -> flagged vertices ────────────
  {
    // MUTATION 3 skips the routing. The assertions below are UNCONDITIONAL: a
    // check that relaxes itself when the mutation is active proves nothing, which
    // is how a gate ends up unfalsifiable.
    const std::uint32_t face = scene.vertices().front().faceId;
    if (g_mutation != 3) frame.clickFace(face, false);
    checkEq(shell.selection().count(), 1u, "a viewport click became one typed selection");
    std::size_t flagged = 0;
    for (const forge::desktop::SceneVertex& v : scene.vertices()) {
      if ((v.flags & 1u) != 0u) ++flagged;
    }
    checkGe(flagged, 3u, "the picked face's vertices are flagged for the shader");
    check(shell.selection().focus().has_value(), "focus follows the pick", "");
    if (shell.selection().focus().has_value()) {
      check(shell.selection().focus()->kind == forge::ui::EntityKind::Face,
            "the focus is typed as a Face",
            forge::ui::toString(shell.selection().focus()->kind));
      check(shell.selection().focus()->persistentName == "face@" + std::to_string(face),
            "the selection stores a PERSISTENT NAME, not an index",
            shell.selection().focus()->persistentName);
    } else {
      check(false, "the focus is typed as a Face", "no focus");
      check(false, "the selection stores a PERSISTENT NAME, not an index", "no focus");
    }

    // The selection FILTER refuses what it is set to refuse.
    shell.selection().clearSelection();
    shell.selection().setFilter(forge::ui::EntityKind::Edge);
    frame.clickFace(face, false);
    checkEq(shell.selection().count(), 0u, "an Edge filter refuses a Face pick");
    shell.selection().setFilter(forge::ui::EntityKind::Any);
  }

  // ── 7. the keymap reaches commands through the one dispatch path ─────────
  {
    const std::size_t before = shell.journal().size();
    // "F" is view.fit in the Forge-native profile: no selection needed, always on.
    const bool ran = frame.onKey("F", 0);
    check(ran, "an unmodified key ran its bound command", "");
    checkEq(shell.journal().size(), before + 1, "the run was journalled");
    check(!shell.journal().empty() && shell.journal().back() == "view.fit",
          "the journalled command is the bound one",
          shell.journal().empty() ? "" : shell.journal().back());

    // A multi-stroke sequence must report Pending, not fire, and not eat the key.
    forge::ui::ModMask ctrl = forge::ui::maskOf(forge::ui::Mod::Ctrl);
    const std::size_t j2 = shell.journal().size();
    check(!frame.onKey("K", ctrl), "Ctrl+K alone does not fire (it is a prefix)", "");
    checkEq(shell.journal().size(), j2, "a pending prefix journals nothing");
    check(frame.onKey("P", ctrl), "Ctrl+K Ctrl+P completes the sequence", "");
    check(frame.paletteOpen(), "the completed sequence opened the palette", "");
    frame.togglePalette();

    // Switching input profile switches which keys work, over the SAME commands.
    shell.setInputProfile(forge::ui::InputProfile::NXLike);
    const std::size_t j3 = shell.journal().size();
    check(!frame.onKey("F", 0), "bare F is unbound in the NX profile", "");
    checkEq(shell.journal().size(), j3, "an unbound key runs nothing");
    check(frame.onKey("F", ctrl), "Ctrl+F is view.fit in the NX profile", "");
    shell.setInputProfile(forge::ui::InputProfile::ForgeNative);
  }

  // ── 8. every workspace lays out and draws ────────────────────────────────
  for (forge::ui::WorkspaceProfile p : forge::ui::allWorkspaceProfiles()) {
    shell.setWorkspace(p);
    ImDrawData* d = buildOneFrame(frame, 0);
    const std::string name = forge::ui::toString(p);
    check(d != nullptr && d->TotalVtxCount > 500, "workspace draws a real frame", name);
    checkEq(frame.panelsDrawn(), 4u, ("panels drawn in workspace " + name).c_str());
  }
  shell.setWorkspace(forge::ui::WorkspaceProfile::Part);

  // ── 8b. the dock model is the source of truth for the layout ─────────────
  // A splitter drag and a tab click write into forge::ui::DockLayout, and the
  // frame reads the rectangles back OUT of it. If they diverged, the layout the
  // user arranged and the layout that gets saved would be different objects.
  {
    const forge::ui::DockWindow* w = shell.layout().mainWindow();
    check(w != nullptr, "the Part workspace has a main window", "");
    if (w != nullptr) {
      const double before = w->root.ratio;
      frame.setRatioAt({}, before + 0.10);
      const double after = shell.layout().mainWindow()->root.ratio;
      check(std::fabs(after - (before + 0.10)) < 1e-9,
            "a splitter drag writes the new ratio into the dock TREE",
            std::to_string(before) + " -> " + std::to_string(after));

      // Clamped, not free: a ratio of 0 or 1 makes a panel unreachable, which is
      // indistinguishable from a deleted panel to the user.
      frame.setRatioAt({}, 5.0);
      checkLe(shell.layout().mainWindow()->root.ratio, 0.92, "ratio clamps at the high end");
      frame.setRatioAt({}, -5.0);
      checkGe(shell.layout().mainWindow()->root.ratio, 0.08, "ratio clamps at the low end");
      frame.setRatioAt({}, before);

      // The left column is a Tabs node at path {0}: feature_tree, model_browser.
      frame.setActiveTabAt({0}, 1);
      const forge::ui::DockNode& left = shell.layout().mainWindow()->root.children[0];
      checkEq(left.activeTab, 1u, "a tab click writes activeTab into the dock TREE");
      ImDrawData* d = buildOneFrame(frame, 0);
      check(d != nullptr && d->TotalVtxCount > 500, "the frame redraws on the new tab", "");
      // Out of range is refused rather than making the tab index unreachable.
      frame.setActiveTabAt({0}, 99);
      checkEq(shell.layout().mainWindow()->root.children[0].activeTab, 1u,
              "an out-of-range tab index is refused");
      frame.setActiveTabAt({0}, 0);
    }
  }

  // ── 9. the layout survives a save/load round trip ────────────────────────
  {
    const std::string saved = shell.saveState();
    forge::ui::ForgeShell restored;
    check(restored.loadState(saved), "saved shell state parses back", "");
    check(restored.saveState() == saved, "save -> load -> save is byte-identical", "");
    check(restored.layout() == shell.layout(), "the dock tree itself round-trips", "");
    checkEq(restored.layout().panelCount(), shell.layout().panelCount(),
            "no panel is lost in the round trip");
  }

  // ── 10. multi-monitor recovery loses no panel ────────────────────────────
  {
    const std::size_t before = shell.layout().panelCount();
    std::vector<forge::ui::MonitorInfo> one;
    forge::ui::MonitorInfo laptop;
    laptop.id = 7;  // NOT the id the default layout was authored against
    laptop.workArea = forge::ui::Rect{0.0, 0.0, 1512.0, 945.0};
    laptop.primary = true;
    one.push_back(laptop);
    const forge::ui::RecoveryReport rep = shell.monitorsChanged(one);
    check(rep.panelsPreserved(), "unplugging a monitor loses no panel",
          std::to_string(rep.panelsBefore) + " -> " + std::to_string(rep.panelsAfter));
    checkEq(shell.layout().panelCount(), before, "panel count survives recovery");
    ImDrawData* d = buildOneFrame(frame, 0);
    check(d != nullptr && d->TotalVtxCount > 500, "the recovered layout still draws", "");
  }

  // ── 11. a frame with a live viewport texture behaves the same ────────────
  {
    ImDrawData* d = buildOneFrame(frame, 0xABCDEF01u);
    check(d != nullptr && d->TotalVtxCount > 500, "frame with a bound viewport texture", "");
  }

  // ── 12. the Measure panel measures the REAL body ─────────────────────────
  // The references are read from the scene itself (its triangle count, its face
  // count, its bounds), so this cannot drift into agreeing with a stale number.
  {
    const forge::ui::MeasureMesh& mm = frame.measureMesh();
    checkEq(mm.triangleCount(), scene.triangleCount(),
            "the measure mesh IS the scene's tessellation");
    const forge::ui::MeshMeasure model = frame.modelMeasure();
    checkEq(model.faces, static_cast<std::size_t>(scene.faceCount()),
            "one measured face per B-rep face");
    for (int a = 0; a < 3; ++a) {
      const double want = static_cast<double>(scene.bounds().max[a] - scene.bounds().min[a]);
      check(std::fabs(model.box.size(static_cast<std::size_t>(a)) - want) < 1e-3,
            "measured extent agrees with the scene bounds",
            std::to_string(model.box.size(static_cast<std::size_t>(a))) + " vs " +
                std::to_string(want));
    }
    std::printf("[gate] measure: area %.3f mm2, watertight %d, volume %.3f mm3, "
                "%zu boundary / %zu non-manifold / %zu reversed edges\n",
                model.area, model.watertight ? 1 : 0, model.volume, model.boundaryEdges,
                model.nonManifoldEdges, model.reversedEdges);

    // The plate is 80 x 50 x 20 with a through bore and a fillet, so its area is
    // bounded BELOW by the two 80x50 faces it still has and ABOVE by the whole
    // bounding box's surface. A measure that returned a bounding-box number, or
    // zero, or a per-triangle sum in the wrong units, falls outside that band.
    checkGe(model.area, 2.0 * 80.0 * 50.0 - 4000.0, "surface area is at least the plate's faces");
    checkLe(model.area, 2.0 * (80.0 * 50.0 + 80.0 * 20.0 + 50.0 * 20.0) * 1.5,
            "surface area is not a runaway sum");
    // A tessellated solid must CLOSE, and its volume must be under the box it
    // fits in and over half of it for a plate with one bore.
    check(model.watertight, "the tessellated body closes",
          std::to_string(model.boundaryEdges) + " boundary edges");
    checkLe(model.volume, 80.0 * 50.0 * 20.0, "volume is under the bounding box");
    checkGe(model.volume, 0.5 * 80.0 * 50.0 * 20.0, "volume is a plate's, not a sliver's");

    // MUTATION 6 skips the routing of the pick into the panel. The checks below
    // are UNCONDITIONAL: the panel must report what is picked, not a constant.
    shell.selection().clearSelection();
    const std::uint32_t f0 = scene.vertices().front().faceId;
    std::uint32_t f1 = f0;
    for (const forge::desktop::SceneVertex& v : scene.vertices()) {
      if (v.faceId != f0) { f1 = v.faceId; break; }
    }
    if (g_mutation != 6) {
      frame.clickFace(f0, false);
      frame.clickFace(f1, true);
    }
    const forge::ui::SelectionMeasure sel = frame.selectionMeasure();
    checkEq(sel.faces, 2u, "two picked faces are two measured faces");
    check(sel.area > 0.0, "the picked faces have area", std::to_string(sel.area));
    checkLe(sel.area, model.area, "part of a body cannot out-area the body");
    check(sel.hasPair, "exactly two faces yield the pair measure", "");
    check(sel.centreDistance > 0.0, "two distinct faces are apart",
          std::to_string(sel.centreDistance));
    check(sel.angleDegrees >= 0.0 && sel.angleDegrees <= 180.0, "the angle is an angle",
          std::to_string(sel.angleDegrees));

    // ...and the PANEL draws a row per picked face. The Part workspace's right
    // column is the tab group at path {1,1}; Measure is its second tab.
    shell.setWorkspace(forge::ui::WorkspaceProfile::Part);
    frame.setActiveTabAt({1, 1}, 1);
    ImDrawData* d = buildOneFrame(frame, 0);
    check(d != nullptr && d->TotalVtxCount > 500, "the Measure panel draws a real frame", "");
    checkEq(frame.measureFaceRowsDrawn(), 2u, "the Measure panel drew a row per picked face");
    frame.setActiveTabAt({1, 1}, 0);
  }

  // ── 13. the Archie Tools panel offers the LIVE registry ──────────────────
  {
    const forge::ui::ToolCatalog cat = frame.toolCatalog();
    checkEq(cat.size(), shell.registry().size(), "every registered command is a listed tool");
    checkEq(cat.available + cat.needsSelection + cat.needsParameters + cat.disabled +
                cat.unavailable,
            cat.size(), "every tool is accounted for in exactly one bucket");

    // Two faces are still picked from section 12. A face-consuming command with
    // a defaulted parameter must therefore be CALLABLE, and the panel must say
    // so through the same evaluate() the dispatcher uses.
    forge::ui::SelectionService stale;  // what a panel caching its selection would hold
    const forge::ui::ToolCatalog live =
        g_mutation == 7 ? forge::ui::buildToolCatalog(shell.registry(), stale) : cat;
    const forge::ui::ToolEntry* shellTool = live.find("model.shell");
    check(shellTool != nullptr, "model.shell is listed", "");
    if (shellTool != nullptr) {
      check(shellTool->callable(), "a face-consuming tool is callable with faces picked",
            shellTool->reason);
      checkEq(static_cast<int>(shellTool->availability),
              static_cast<int>(forge::ui::ToolAvailability::Available), "and says so by name");
    }
    // A tool that needs edges must NOT be offered on a face selection, or the
    // panel is inviting a refusal.
    const forge::ui::ToolEntry* filletTool = live.find("part.fillet");
    check(filletTool != nullptr, "part.fillet is listed", "");
    if (filletTool != nullptr) {
      checkEq(static_cast<int>(filletTool->availability),
              static_cast<int>(forge::ui::ToolAvailability::NeedsSelection),
              "an edge tool is not offered on a face pick");
    }

    // The panel must actually DRAW a row per tool. Archie's right column is the
    // tab group at path {1,1}; Tools is its third tab.
    shell.setWorkspace(forge::ui::WorkspaceProfile::Archie);
    frame.setActiveTabAt({1, 1}, 2);
    ImDrawData* d = buildOneFrame(frame, 0);
    check(d != nullptr && d->TotalVtxCount > 500, "the Tools panel draws a real frame", "");
    checkEq(frame.toolRowsDrawn(), shell.registry().size(),
            "the Tools panel drew a row per registered command");
    shell.setWorkspace(forge::ui::WorkspaceProfile::Part);
  }

  std::printf("\n[gate] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures == 0) {
    std::printf("[gate] ALL FORGE DESKTOP FRAME GATES PASS "
                "(headless: no window, no swapchain, no MoltenVK)\n");
    return 0;
  }
  return 1;
}
