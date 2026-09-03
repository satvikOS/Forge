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
//   8  the viewport ignores the selection filter        -> "pick an edge" picks a
//                                                          face, and the three
//                                                          edge tools stay
//                                                          unreachable
//   9  the frame never pulls the shell's fit request    -> view.fit journals "ok"
//                                                          and the camera does
//                                                          not move
//  10  a session with a worker CONFIGURED is not        -> the isolation report is
//      distinguished from one without                      unconditional, so
//                                                          "isolation is off" is
//                                                          said whatever is true
//  11  the frame never dispatches the deferred Open     -> File > Open Recent
//      Recent request                                      records a click and
//                                                          opens nothing
//  12  a feature-tree statement row is never clicked    -> nothing can put a
//                                                          Sketch in the
//                                                          selection, so Extrude
//                                                          has nothing to consume
// <algorithm> for the same reason document_gate.cpp includes it beside <cstdio>:
// this file calls std::remove(const char*) to delete its temp .fpart, and
// `std::remove` is declared by BOTH headers -- the iterator algorithm and the C
// file-removal function. Including only one leaves which of them is meant
// resolvable by overload rules but not by a reader, and the missing-include
// preflight (forge-kernel/test/native/check_includes.sh) refuses that ambiguity
// by name. It refused this file, which is how the ambiguity was found.
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
#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/GuardedProcess.hpp"
#include "forge/ui/RecentDocuments.hpp"
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

// A writable path for the .fpart this gate saves and reopens. Same rule as
// document_gate.cpp: TMPDIR where the platform sets one, /tmp otherwise.
std::string tempPath(const char* leaf) {
  const char* tmp = std::getenv("TMPDIR");
  std::string dir = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!dir.empty() && dir.back() != '/') dir += '/';
  return dir + leaf;
}

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

  // The Part commands went into THE SAME registry the shell dispatches. The
  // count is READ from partCommandIds(), never spelled here.
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

  // ── 5b. THE EXPANDER CLICK ──────────────────────────────────────────────
  //
  // A liveness probe cannot see this. The app presented 1165 frames and saved its
  // state cleanly, then ABORTED with an uncaught std::out_of_range from
  // FeatureTreeModel::rowAt() the moment a user clicked a tree expander:
  // setExpanded()+rebuild() ran INSIDE the ImGuiListClipper loop, changing
  // rows_.size() while the loop was still walking a range sized from the row count
  // taken at Begin(). This is the THIRD instance of one root cause in this frame
  // builder -- mutating a container mid-walk while indices into it are live (the
  // other two were tab activation and splitter drag, both dangling DockNode&).
  //
  // So the assertion is not "a frame was drawn"; it is that a real click on the
  // real widget leaves the model CONSISTENT and the walk INTACT.
  {
    const forge::desktop::ForgeFrame::WidgetRect r = frame.treeExpanderRect();
    check(r.valid, "a feature-tree expander was drawn and located", "");
    if (r.valid) {
      const std::size_t before = frame.treeRowCount();
      ImGuiIO& io = ImGui::GetIO();
      const float cx = (r.x0 + r.x1) * 0.5f, cy = (r.y0 + r.y1) * 0.5f;
      // ImGui buttons fire on RELEASE, so the click costs two frames.
      io.AddMousePosEvent(cx, cy);
      io.AddMouseButtonEvent(0, true);
      buildOneFrame(frame, 0);
      io.AddMouseButtonEvent(0, false);
      buildOneFrame(frame, 0);   // <-- pre-fix, this frame ABORTED the process
      const std::size_t after = frame.treeRowCount();
      std::printf("[gate] expander click at (%.0f,%.0f): %zu rows -> %zu rows\n", cx, cy,
                  before, after);
      // NON-VACUOUS: if the click changed nothing the gate would pass while testing
      // nothing, so require the collapse to have actually landed.
      check(after != before, "the expander click actually changed the row set",
            "click was a no-op -- the gate would be unfalsifiable");
      // And the walk must still be sound afterwards: every row the model now reports
      // must be addressable. This is the exact call that threw.
      bool addressable = true;
      for (std::size_t i2 = 0; i2 < frame.treeRowCount(); ++i2) {
        try {
          (void)frame.tree().rowAt(i2);
        } catch (...) {
          addressable = false;
          break;
        }
      }
      check(addressable, "every row the model reports is addressable after the click",
            "rowAt() threw -- the abort is back");
      buildOneFrame(frame, 0);
      io.AddMousePosEvent(-1.0f, -1.0f);   // park the cursor for the sections below
      buildOneFrame(frame, 0);
    }
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
    // part.shell, not model.shell: the ForgeShell counter stub that used to
    // carry this claim is retired, and the command asserted here is the one that
    // actually appends `SHELL(%body, 2)` to the document.
    const forge::ui::ToolEntry* shellTool = live.find("part.shell");
    check(shellTool != nullptr, "part.shell is listed", "");
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

  // ── 14. EDGE selection: the three edge tools become reachable ────────────
  //
  // The gap this closes, in one sentence: part.fillet, part.chamfer and
  // part.variable_fillet declare atLeast(EntityKind::Edge, 1), and until now the
  // application could produce NO EntityRef of kind Edge from any gesture — both
  // selection entry points wrote EntityKind::Face — so Edge Fillet was
  // permanently unreachable. Section 13 above is the NEGATIVE CONTROL for this
  // one: with two FACES picked it requires part.fillet to be NeedsSelection.
  //
  // MUTATION 8 reverts exactly the wiring under test: the viewport ignores the
  // selection filter and picks a face where the user asked for an edge. Every
  // check below is UNCONDITIONAL.
  {
    const forge::ui::EdgeSet& set = frame.edges();
    std::printf("[gate] edges: %zu recovered | segments %zu face-boundary / %zu interior "
                "/ %zu boundary / %zu non-manifold | kernel says %ld edges\n",
                set.size(), set.faceBoundarySegments, set.interiorSegments,
                set.boundarySegments, set.nonManifoldSegments, scene.lastBuild().edgeCount);

    checkGe(set.size(), 1u, "edges were recovered from the tessellation");
    // Cross-checked against MeasureModel, an independent module over the same
    // soup: it already reported this body watertight with no boundary and no
    // non-manifold edge, so the edge model must find none either. Two modules
    // agreeing on a census neither one could fake alone.
    checkEq(set.boundarySegments, 0u, "a watertight body has no boundary segment");
    checkEq(set.nonManifoldSegments, 0u, "a watertight body has no non-manifold segment");
    checkEq(set.segmentCount(),
            set.faceBoundarySegments + set.interiorSegments + set.boundarySegments +
                set.nonManifoldSegments,
            "the census partitions every undirected segment");

    // The recovered count is a LOWER BOUND on the B-rep's own edge count, never
    // an equal: a seam has the same face id on both sides and is invisible to a
    // face-pair construction. The reference is the KERNEL's number, read from
    // its build report rather than restated here.
    checkLe(static_cast<long>(set.size()), scene.lastBuild().edgeCount,
            "recovered edges cannot exceed the B-rep's own edge count");

    std::size_t ordered = 0;
    std::size_t named = 0;
    double totalLength = 0.0;
    for (const forge::ui::MeshEdge& e : set.edges) {
      if (e.faceA < e.faceB && e.faceA >= 1 && e.faceB <= scene.faceCount()) ++ordered;
      if (set.indexOf(e.key()) != forge::ui::kNoEdge) ++named;
      totalLength += e.length;
    }
    checkEq(ordered, set.size(), "every edge names two distinct faces of THIS body");
    checkEq(named, set.size(), "every edge is addressable by its own persistent name");
    // The plate is 80 x 50 x 20: its outline alone is 2*(80+50) top and bottom
    // plus four verticals, so the total edge length cannot be under a single
    // 80 mm side and cannot be a runaway sum over the whole triangle soup.
    checkGe(totalLength, 80.0, "total edge length is at least one side of the plate");
    checkLe(totalLength, 4.0 * (2.0 * (80.0 + 50.0) + 4.0 * 20.0),
            "total edge length is not a per-triangle runaway");

    // ── a ray down a known edge picks THAT edge ───────────────────────────
    // Aimed at the midpoint of edge 0's first segment, from outside the body
    // along the direction from the body centre, so the ray is a real sightline
    // and not a degenerate zero-length one.
    check(!set.edges.empty() && set.edges.front().points.size() >= 6,
          "edge 0 carries a polyline to aim at", "");
    if (!set.edges.empty() && set.edges.front().points.size() >= 6) {
      const std::vector<double>& p = set.edges.front().points;
      const double mid[3] = {0.5 * (p[0] + p[3]), 0.5 * (p[1] + p[4]), 0.5 * (p[2] + p[5])};
      float c[3];
      scene.bounds().centre(c);
      double away[3] = {mid[0] - c[0], mid[1] - c[1], mid[2] - c[2]};
      const double n = std::sqrt(away[0] * away[0] + away[1] * away[1] + away[2] * away[2]);
      check(n > 1e-6, "the aimed edge is off the body centre", std::to_string(n));
      for (int i = 0; i < 3; ++i) away[i] /= (n > 1e-6 ? n : 1.0);
      const double eye[3] = {mid[0] + 500.0 * away[0], mid[1] + 500.0 * away[1],
                             mid[2] + 500.0 * away[2]};
      const double dir[3] = {-away[0], -away[1], -away[2]};
      const forge::ui::EdgePick hit = forge::ui::pickEdge(set, eye, dir, 0.05);
      check(hit.hit(), "a ray down an edge picks an edge", "nothing within 0.05 mm");
      if (hit.hit()) {
        checkEq(hit.index, 0u, "and it is the edge the ray was aimed at");
        check(hit.distance < 1e-6, "the pick lands ON the edge", std::to_string(hit.distance));
        check(hit.along > 400.0, "the pick is in front of the eye", std::to_string(hit.along));
      } else {
        check(false, "and it is the edge the ray was aimed at", "no hit");
        check(false, "the pick lands ON the edge", "no hit");
        check(false, "the pick is in front of the eye", "no hit");
      }
      // A ray parallel to the sightline but a metre off the part must MISS, or
      // the tolerance is not a tolerance.
      const double offEye[3] = {eye[0] + 1000.0, eye[1], eye[2]};
      check(!forge::ui::pickEdge(set, offEye, dir, 0.05).hit(),
            "a ray a metre off the part picks nothing", "");
    }

    // ── the pick becomes a typed Edge selection ───────────────────────────
    shell.selection().clearSelection();
    // The user's own control: the status strip's filter. Setting it to Edge used
    // to make the app unable to pick ANYTHING, because clickFace's accepts(Face)
    // then refused every ray hit.
    shell.selection().setFilter(forge::ui::EntityKind::Edge);
    check(frame.edgePickMode(), "the Edge filter puts the viewport in edge-pick mode", "");
    if (g_mutation == 8) {
      // MUTATION 8: the viewport ignores the filter and picks a face.
      frame.clickFace(scene.vertices().front().faceId, false);
    } else {
      frame.clickEdge(0, false);
    }
    checkEq(shell.selection().count(), 1u, "an edge pick became one typed selection");
    check(shell.selection().focus().has_value(), "focus follows the edge pick", "");
    if (shell.selection().focus().has_value()) {
      const forge::ui::EntityRef& f = *shell.selection().focus();
      check(f.kind == forge::ui::EntityKind::Edge, "the focus is typed as an Edge",
            forge::ui::toString(f.kind));
      check(f.persistentName == set.edges.front().key(),
            "the selection stores the edge's PERSISTENT NAME", f.persistentName);
      // The bodyId must be the DOCUMENT's live node, or resolveValues() cannot
      // map it to an IR value and every solid command greys out.
      check(f.bodyId == frame.activeBodyNode(), "the ref names the document's live body",
            f.bodyId + " vs " + frame.activeBodyNode());
    } else {
      check(false, "the focus is typed as an Edge", "no focus");
      check(false, "the selection stores the edge's PERSISTENT NAME", "no focus");
      check(false, "the ref names the document's live body", "no focus");
    }

    // ── THE PAYOFF: the edge tools are now callable ───────────────────────
    // Same evaluate() the dispatcher uses, so what the panel offers and what
    // runs cannot disagree. Section 13 asserted the opposite state on a FACE
    // selection, which is this claim's negative control.
    const forge::ui::ToolCatalog live = frame.toolCatalog();
    const char* kEdgeTools[3] = {"part.fillet", "part.chamfer", "part.variable_fillet"};
    for (const char* id : kEdgeTools) {
      const forge::ui::ToolEntry* t = live.find(id);
      check(t != nullptr, "an edge tool is listed", id);
      if (t != nullptr) {
        // The SELECTION barrier is what edge picking removes, and it is the only
        // one it may claim. part.chamfer and part.variable_fillet still report
        // NeedsParameters, because `distance` and `radius_start` declare no
        // honest default and a dialog must supply them — asserting Available for
        // those three would be asserting a second gap closed that is not.
        check(t->availability != forge::ui::ToolAvailability::NeedsSelection,
              "an edge tool no longer refuses the SELECTION",
              std::string(id) + ": " + forge::ui::toString(t->availability) + "  " + t->reason);
      } else {
        check(false, "an edge tool no longer refuses the SELECTION", id);
      }
    }
    // part.fillet declares radius = 1 mm as an honest default, so for that one
    // the whole chain is now clear: it is CALLABLE.
    const forge::ui::ToolEntry* filletTool = live.find("part.fillet");
    check(filletTool != nullptr, "part.fillet is listed", "");
    if (filletTool != nullptr) {
      check(filletTool->callable(), "Edge Fillet is CALLABLE with an edge picked",
            filletTool->reason);
      checkEq(static_cast<int>(filletTool->availability),
              static_cast<int>(forge::ui::ToolAvailability::Available),
              "and the panel says Available by name");
    } else {
      check(false, "Edge Fillet is CALLABLE with an edge picked", "not listed");
      check(false, "and the panel says Available by name", "not listed");
    }
    // ...and a FACE tool must now be refused, or the signature means nothing.
    const forge::ui::ToolEntry* shellTool = live.find("part.shell");
    check(shellTool != nullptr, "part.shell is still listed", "");
    if (shellTool != nullptr) {
      checkEq(static_cast<int>(shellTool->availability),
              static_cast<int>(forge::ui::ToolAvailability::NeedsSelection),
              "a face tool is NOT offered on an edge pick");
    }

    // ── the Measure panel reports the edge, not a face ────────────────────
    const forge::ui::EdgeMeasure em = frame.edgeMeasure();
    checkEq(em.edges, 1u, "one picked edge is one measured edge");
    check(em.length > 0.0, "the picked edge has length", std::to_string(em.length));
    check(em.length <= totalLength + 1e-9, "one edge cannot out-length the whole body",
          std::to_string(em.length));
    shell.setWorkspace(forge::ui::WorkspaceProfile::Part);
    frame.setActiveTabAt({1, 1}, 1);  // Measure
    ImDrawData* d = buildOneFrame(frame, 0);
    check(d != nullptr && d->TotalVtxCount > 500, "the Measure panel draws a real frame", "");
    checkEq(frame.measureEdgeRowsDrawn(), 1u, "the Measure panel drew a row per picked edge");
    checkEq(frame.measureFaceRowsDrawn(), 0u, "and no face row, because no face is picked");
    frame.setActiveTabAt({1, 1}, 0);
    shell.selection().setFilter(forge::ui::EntityKind::Any);
  }

  // ── 15. view.fit actually MOVES THE CAMERA ───────────────────────────────
  //
  // Section 7 above already proves the F key reaches view.fit and journals it.
  // It proves nothing about the picture: `view.fit`'s whole execute body is
  // `++doc_.fitCount` (ForgeShell.cpp) and camera_.frame() was called EXACTLY
  // ONCE, in ForgeFrame's constructor, with nothing reading the counter. So the
  // key ran, journalled, printed "ok" and the camera did not move -- and the one
  // check that could have caught it was asserting the counter, which is the
  // thing that was already true.
  //
  // MUTATION 9 removes the pull. Every check below is UNCONDITIONAL.
  {
    shell.setInputProfile(forge::ui::InputProfile::ForgeNative);
    // Drive the camera somewhere a fit must undo: far too close, and aimed away
    // from the body, so BOTH the distance and the target have to be restored.
    for (int i = 0; i < 40; ++i) frame.camera().zoom(1.0f);
    frame.camera().pan(600.0f, 400.0f, 800.0f);
    const float tooClose = frame.camera().distance();
    const float radius = scene.bounds().radius();
    float centre[3];
    scene.bounds().centre(centre);
    const float driftedX = frame.camera().target()[0];
    check(tooClose < radius, "the camera really is inside the body's sphere",
          std::to_string(tooClose) + " < " + std::to_string(radius));
    check(std::fabs(driftedX - centre[0]) > 1.0f, "and its target really has drifted off",
          std::to_string(driftedX - centre[0]));

    const std::size_t fitsBefore = frame.fitsApplied();
    // Through the KEYBOARD, not by calling the camera: the claim is that the
    // user's gesture moves the picture, and every invoker shares this path.
    check(frame.onKey("F", 0), "F ran view.fit", "");
    if (g_mutation != 9) buildOneFrame(frame, 0);
    checkEq(frame.fitsApplied(), fitsBefore + 1, "the frame applied the pending fit");
    checkGe(frame.camera().distance(), radius,
            "the fit put the eye back outside the body's sphere");
    check(std::fabs(frame.camera().target()[0] - centre[0]) < 1e-3f,
          "and re-centred the target on the body",
          std::to_string(frame.camera().target()[0] - centre[0]));

    // Idempotent: a second frame with no new request must NOT re-fit, or an
    // orbit would be undone every frame and the viewport would be unusable.
    const float settled = frame.camera().distance();
    frame.camera().zoom(2.0f);
    buildOneFrame(frame, 0);
    checkEq(frame.fitsApplied(), fitsBefore + 1, "a frame with no new request does not re-fit");
    check(frame.camera().distance() < settled, "so a user zoom survives the next frame",
          std::to_string(frame.camera().distance()) + " vs " + std::to_string(settled));
  }

  // ── 10. THE REOPEN LEG, AND THE SAFETY NET A USER CAN SEE ────────────────
  //
  // Two facts the shipped app knew and never told anyone.
  //
  // (a) main.cpp probes forge_kernel_worker at startup and, when it will not
  //     launch, turns isolation OFF and prints "kernel isolation: UNAVAILABLE
  //     -- modelling runs IN PROCESS" to STDERR. A user who launches Forge.app
  //     from the Finder has no stderr. The single most consequential fact the
  //     startup path knows -- that an OCCT fault will now take the document
  //     with it -- reached nobody.
  //
  // (b) `file.open` needs a path and the prompt seeded that box from
  //     `documentPath_`, which is EMPTY on every launch. So Ctrl+O on a freshly
  //     started Forge opened an empty box, and the only way back to yesterday's
  //     part was to type its absolute path from memory -- while a part saved
  //     with a bare Ctrl+S had gone to ~/.forge, a directory the user never
  //     chose and cannot guess. Open, model, save, reopen is the loop this
  //     product is judged on, and its last step was unreachable without a
  //     terminal.
  {
    // ── (a) the isolation state reaches the ACTIVITY LOG ───────────────────
    // The log, not note(): the console panel filters by severity and the status
    // strip counts it, so it is still there when a user goes looking. A status
    // line is gone by the next frame.
    std::size_t isolationRows = 0;
    forge::ui::Severity isolationSeverity = forge::ui::Severity::Info;
    for (const forge::ui::LogEntry& e : shell.log().entries()) {
      if (e.source != "kernel.isolation") continue;
      ++isolationRows;
      isolationSeverity = e.severity;
    }
    checkEq(isolationRows, 1u, "kernel isolation is reported to the log exactly once");
    check(isolationSeverity == forge::ui::Severity::Warning,
          "with NO worker configured it is a WARNING, which the error filter keeps",
          std::string(forge::ui::toString(isolationSeverity)));

    // THE POSITIVE HALF, without which the check above passes for a report that
    // says "unavailable" unconditionally. A second scene with a worker
    // CONFIGURED must log the other answer. Nothing is built and nothing is
    // launched: workerConfigured() is set by useIsolatedWorker() itself, and no
    // geometry is compiled here, so this costs a document seed and no kernel.
    {
      forge::desktop::KernelScene isolatedScene;
      forge::ui::GuardLimits limits;
      limits.deadlineMs = 1000;
      if (g_mutation != 10) {
        isolatedScene.useIsolatedWorker({"/nonexistent/forge_kernel_worker"}, limits);
      }
      forge::ui::ForgeShell isolatedShell;
      forge::desktop::ForgeFrame isolatedFrame(isolatedShell, isolatedScene);
      isolatedFrame.wirePartCommands();
      std::size_t active = 0;
      std::size_t warned = 0;
      for (const forge::ui::LogEntry& e : isolatedShell.log().entries()) {
        if (e.source != "kernel.isolation") continue;
        if (e.severity == forge::ui::Severity::Info) {
          ++active;
        } else {
          ++warned;
        }
      }
      checkEq(active, 1u, "a session WITH a worker configured logs isolation as ACTIVE");
      checkEq(warned, 0u, "and does not also warn about it");
    }

    // ── (b) save -> Open Recent -> reopen, through the shipping host ────────
    // Nothing may be remembered that the user did not open or save.
    checkEq(shell.recentDocuments().size(), 0u,
            "Open Recent is empty until the user opens or saves something");

    // Save is offered only on a DIRTY document. Make it dirty through the ONE
    // registry rather than assuming the earlier sections left it that way: a
    // Save that was refused as unavailable would fail this section for a reason
    // that has nothing to do with what it is testing.
    frame.invoke("part.primitive_box");
    check(shell.document().dirty, "the document is dirty, so Save is offered", "");

    const std::string reopenPath = tempPath("recent_reopen.fpart");
    std::remove(reopenPath.c_str());
    forge::ui::CommandParams saveParams;
    saveParams.setText("path", reopenPath);
    const forge::ui::DispatchResult saved = shell.run("file.save", saveParams);
    check(saved.ok() && shell.lastDocumentError().empty(), "saved the document to a real .fpart",
          shell.lastDocumentError().empty() ? std::string(forge::ui::machineName(saved.status))
                                            : shell.lastDocumentError());
    checkEq(shell.recentDocuments().size(), 1u, "a successful save is remembered");
    check(shell.recentDocuments().mostRecent() == reopenPath,
          "and it is remembered by the path the HOST wrote to",
          shell.recentDocuments().mostRecent());

    // File > New is the state EVERY launch starts in: no open document, so no
    // documentPath_ to seed a path box from. This is where the old behaviour
    // handed the user an empty box.
    const forge::ui::DispatchResult fresh = shell.run("file.new");
    check(fresh.ok() && shell.lastDocumentError().empty(), "File > New",
          shell.lastDocumentError());
    check(frame.documentPath().empty(), "there is now no open document path",
          frame.documentPath());
    check(frame.pathPromptSeed() == reopenPath,
          "so the path seed falls back to the most recent document",
          frame.pathPromptSeed());

    // THE BOX ITSELF, not the helper that computes what goes in it: a gate that
    // only checked pathPromptSeed() would be checking a function the prompt is
    // free to stop calling.
    frame.invoke("file.open");
    check(frame.promptOpen(), "file.open with no path opens the prompt instead of failing", "");
    check(frame.promptValue("path") == reopenPath,
          "and the path box is PRE-FILLED with the most recent document",
          frame.promptValue("path"));
    frame.cancelPrompt();

    // ── the Open Recent click is DEFERRED, like every other document-replacing
    //    command. Dispatching inside the dock walk is what has already shipped
    //    three crashes in this class.
    //
    // MUTATION 11 removes the frame that dispatches it. Both checks after it are
    // unconditional.
    frame.requestOpenDocument(reopenPath);
    check(frame.pendingOpenPath() == reopenPath, "an Open Recent click is recorded, not dispatched",
          frame.pendingOpenPath());
    check(frame.documentPath().empty(), "and nothing has been opened yet", frame.documentPath());
    if (g_mutation != 11) buildOneFrame(frame, 0);
    check(frame.pendingOpenPath().empty(), "the next frame dispatched it",
          frame.pendingOpenPath());
    check(frame.documentPath() == reopenPath, "and the remembered document is open",
          frame.documentPath());

    // Re-opening the same document MOVES it in the list; it does not appear
    // twice. A user who works on one part all day must not lose the other nine.
    checkEq(shell.recentDocuments().size(), 1u, "reopening the same document does not duplicate it");

    // ── a remembered path that no longer opens must SAY SO ─────────────────
    // The entry is deliberately KEPT: this frame cannot tell "deleted" from "the
    // volume is not mounted today", and silently forgetting a part because a
    // share was asleep is the worse of the two mistakes.
    const std::string gonePath = tempPath("recent_gone.fpart");
    std::remove(gonePath.c_str());
    const std::size_t errorsBefore = shell.log().count(forge::ui::Severity::Error);
    frame.requestOpenDocument(gonePath);
    buildOneFrame(frame, 0);
    checkGe(shell.log().count(forge::ui::Severity::Error), errorsBefore + 1,
            "a remembered document that will not open raises an ERROR, not a silent no-op");
    bool namedThePath = false;
    for (const forge::ui::LogEntry& e : shell.log().entries()) {
      if (e.severity != forge::ui::Severity::Error) continue;
      if (e.message.find(gonePath) != std::string::npos) namedThePath = true;
    }
    check(namedThePath, "and the message NAMES the path that failed", gonePath);
    check(frame.documentPath() == reopenPath,
          "while the document that WAS open is left untouched", frame.documentPath());

    std::remove(reopenPath.c_str());
  }

  // ── 12. A USER CAN EXTRUDE A SKETCH ──────────────────────────────────────
  //
  // The claim the whole product rests on, and it was FALSE. ForgeFrame had two
  // producers of selection refs — clickFace (EntityKind::Face) and clickEdge
  // (EntityKind::Edge) — and SelectionSignature::satisfiedBy compares kinds
  // EXACTLY, with no subsumption. part.extrude's signature is
  // exactly(EntityKind::Sketch, 1). No surface in the application could produce
  // an EntityKind::Sketch, so Extrude was permanently greyed out, along with 27
  // other commands needing body / sketchref / opensketch / surface / wire. Every
  // gate was green: app_surface_reachability_test proves each surface OFFERS
  // every command, and says in its own header that this is "enumeration, not
  // pixels".
  //
  // This asserts the whole path against the REAL linked application: click the
  // statement row, get a typed ref of the right kind, dispatch Extrude through
  // the one registry, and find an EXTRUDE statement in the document.
  //
  // MUTATION 12 removes the click. Everything after it is unconditional.
  {
    // The seeded starter part's statement %1 is the RECT profile. It is READ
    // from the document rather than assumed to be 1: a change to
    // defaultPartStatements() must move this gate's subject, not silently give
    // it a different statement.
    int profileId = 0;
    for (const forge::ui::FeatureRecord& r : frame.document().records()) {
      if (r.produces == forge::ui::IrValueKind::Profile) { profileId = r.irId; break; }
    }
    checkGe(profileId, 1, "the document holds a PROFILE statement to extrude");

    // It carries NO node binding — only the last seeded statement does — so it
    // is exactly the row that could not be resolved back to an IR value by any
    // route. clickFeature binds one; that this used to be empty is the reason
    // the check exists.
    shell.selection().clearSelection();
    shell.selection().setFilter(forge::ui::EntityKind::Any);
    if (g_mutation != 12) frame.clickFeature(profileId, false);

    checkEq(shell.selection().count(), 1u, "clicking a statement row selects exactly it");
    forge::ui::EntityKind picked = forge::ui::EntityKind::None;
    std::string pickedNode;
    if (shell.selection().count() == 1) {
      picked = shell.selection().selection().front().kind;
      pickedNode = shell.selection().selection().front().bodyId;
    }
    check(picked == forge::ui::EntityKind::Sketch,
          "and a PROFILE statement is selected as a Sketch, which is what EXTRUDE wants",
          std::string(forge::ui::toString(picked)));
    check(!pickedNode.empty(), "the statement now has a node a command can resolve", pickedNode);
    check(frame.document().valueFor(pickedNode) == profileId,
          "and that node resolves back to the statement that was clicked",
          std::to_string(frame.document().valueFor(pickedNode)));

    const std::size_t before = frame.document().records().size();
    frame.invoke("part.extrude");
    const std::size_t after = frame.document().records().size();
    checkEq(after, before + 1, "Extrude, dispatched through the one registry, added a statement");
    std::string producedOp;
    if (after > before) producedOp = frame.document().records().back().line.op;
    check(producedOp == "EXTRUDE", "and the statement it added is an EXTRUDE", producedOp);

    // The filter is still the user's instruction. A tree click that ignored it
    // would make "set the filter to Edge" mean nothing in half the window.
    shell.selection().clearSelection();
    shell.selection().setFilter(forge::ui::EntityKind::Edge);
    frame.clickFeature(profileId, false);
    checkEq(shell.selection().count(), 0u,
            "a statement click obeys the selection filter instead of overriding it");
    shell.selection().setFilter(forge::ui::EntityKind::Any);
  }

  std::printf("\n[gate] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures == 0) {
    std::printf("[gate] ALL FORGE DESKTOP FRAME GATES PASS "
                "(headless: no window, no swapchain, no MoltenVK)\n");
    return 0;
  }
  return 1;
}
