// forge-desktop/test/click_gate.cpp
//
// THE HEADLESS CLICK GATE. Its siblings render frames; this one INTERACTS with
// them. It drives the real ImGui input queue -- io.AddMousePosEvent and
// io.AddMouseButtonEvent, the same two calls the SDL2 backend makes -- with no
// window, no swapchain, no MoltenVK and no display, then asserts on what the
// application did about it.
//
// ── the defect it exists for ────────────────────────────────────────────────
// Clicking a dock tab SIGSEGV'd the installed app on the FIRST click. Three
// crash reports, byte-identical, EXC_BAD_ACCESS at 0x17 inside
// ForgeFrame::drawPanel. drawTabGroup() holds `const forge::ui::DockNode& node`
// into the LIVE layout while it walks; the tab button called setActiveTabAt(),
// whose last line is `shell_.layout() = std::move(rebuilt)`, which replaces the
// whole DockLayout and destroys every node the recursion is holding. The very
// next statement reads node.panels[active] out of freed memory. 0x17 is 23 bytes
// into a libc++ std::string -- the size byte of the short-string form -- so the
// fault was a dangling string header, not a null this.
//
// frame_gate and document_gate both PASSED throughout, because neither clicks
// anything. frame_gate calls frame.setActiveTabAt() DIRECTLY, from outside the
// walk, which is the one way to change a tab that was never broken.
//
// ── why a click alone is not enough, and the further frame is the point ─────
// The re-seat leaves a dangling reference; the CRASH is the NEXT READ through
// it. A gate that clicked and stopped would have gone green on an app that was
// already broken. So every click here is followed by at least one FURTHER frame,
// and the assertions are made after it: the panel behind the clicked tab must
// have been drawn, the dock tree must still be valid, and no panel may have been
// lost.
//
// ── two independent instruments, because one can go quiet ───────────────────
//   1. A VALUE. ForgeFrame counts layoutReseatsDuringWalk() -- how many times the
//      DockLayout was re-seated while drawNode()/drawTabGroup() were still
//      walking it. The only correct value is zero. This is deterministic in any
//      build: it does not depend on whether freed memory happened to fault.
//   2. THE SANITIZER. This gate is built with -fsanitize=address, so the read
//      through the dangling node is a reported heap-use-after-free rather than a
//      coin flip. `--mutate 3` is the positive control for it: the gate performs
//      the historical sequence itself, and if the process SURVIVES, the
//      sanitizer is not armed and the mutation reports itself green -- which is
//      run_desktop.sh's word for "this check is unfalsifiable".
//
// The same hazard existed on the OTHER dock gesture and is covered here too: a
// splitter drag called setRatioAt() from inside drawSplitter(), and drawNode()
// reads node.children[1] on the line AFTER the splitter is drawn.
//
// PROVING THE GATE CAN FAIL: `--mutate <n>` injects defect n.
//   1  the pointer never reaches the tab        -> no tab activates
//   2  no FURTHER frame after the click         -> the clicked panel never comes up
//   3  the historical use-after-free, on purpose-> the sanitizer must catch it
//   4  only the first workspace is exercised    -> the tab census goes unmet
//   5  the splitter is pressed but not dragged  -> no ratio moves
#include <cfloat>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "imgui.h"

#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/ForgeShell.hpp"
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

template <typename A, typename B>
void checkEq(const A& got, const B& want, const char* what, const std::string& where) {
  ++g_checks;
  if (!(got == static_cast<A>(want))) {
    ++g_failures;
    std::printf("  FAIL  %-56s  got %s want %s   [%s]\n", what, std::to_string(got).c_str(),
                std::to_string(want).c_str(), where.c_str());
  }
}

template <typename A, typename B>
void checkGe(const A& got, const B& floor, const char* what, const std::string& where) {
  ++g_checks;
  if (!(got >= static_cast<A>(floor))) {
    ++g_failures;
    std::printf("  FAIL  %-56s  got %s, need >= %s   [%s]\n", what, std::to_string(got).c_str(),
                std::to_string(floor).c_str(), where.c_str());
  }
}

// A headless ImGui context. The renderer backend is NULL: ImGui only needs a font
// atlas with a texture id set for the draw lists to be built, and setting it by
// hand is exactly what a null backend does. Identical to frame_gate's, because
// the point is that this gate runs in the same nothing.
struct HeadlessImGui {
  HeadlessImGui(float w, float h) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(w, h);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "click_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

std::size_t g_frames = 0;

// ONE real frame of the real application shell.
ImDrawData* step(forge::desktop::ForgeFrame& frame) {
  ++g_frames;
  ImGui::NewFrame();
  frame.build(0, 1.0f);
  ImGui::Render();
  return ImGui::GetDrawData();
}

// The two calls the SDL2 backend makes. A position change and a button change are
// never queued in the same frame: ImGui's event queue defers a button change that
// would otherwise be coalesced away, and a gate that relied on that ordering
// would be testing the queue rather than the app.
void pointerTo(float x, float y) { ImGui::GetIO().AddMousePosEvent(x, y); }
void leftButton(bool down) { ImGui::GetIO().AddMouseButtonEvent(0, down); }

// Address a node from the main window's root, one child index per step.
const forge::ui::DockNode* nodeAt(const forge::ui::DockNode& root,
                                  const std::vector<std::size_t>& path) {
  const forge::ui::DockNode* n = &root;
  for (std::size_t s : path) {
    if (n->kind != forge::ui::DockNodeKind::Split || n->children.size() != 2 || s > 1) {
      return nullptr;
    }
    n = &n->children[s];
  }
  return n;
}

// What the DOCK MODEL says is there, so every reference below is READ from the
// tree rather than spelled here and left to drift.
struct Census {
  std::size_t tabGroups = 0;
  std::size_t tabs = 0;
  std::size_t splits = 0;
};

void censusNode(const forge::ui::DockNode& n, Census& out) {
  if (n.kind == forge::ui::DockNodeKind::Tabs) {
    ++out.tabGroups;
    out.tabs += n.panels.size();
    return;
  }
  ++out.splits;
  for (const forge::ui::DockNode& c : n.children) censusNode(c, out);
}

Census censusOf(const forge::ui::ForgeShell& shell) {
  Census c;
  const forge::ui::DockWindow* w = shell.layout().mainWindow();
  if (w != nullptr) censusNode(w->root, c);
  return c;
}

std::string pathText(const std::vector<std::size_t>& p) {
  std::string s = "{";
  for (std::size_t i = 0; i < p.size(); ++i) {
    if (i > 0) s += ",";
    s += std::to_string(p[i]);
  }
  return s + "}";
}

bool contains(const std::vector<std::string>& v, const std::string& s) {
  for (const std::string& e : v) {
    if (e == s) return true;
  }
  return false;
}

// MUTATION 3: the historical defect, performed on purpose through the public API.
// A DockNode reference is taken into the live layout, the layout is re-seated
// underneath it, and the reference is read. Under -fsanitize=address this is a
// reported heap-use-after-free and the process dies. If it SURVIVES, the gate is
// running without the sanitizer and says so -- returning 0, so run_desktop.sh
// prints "STAYED GREEN -- the check it targets is unfalsifiable", which is the
// correct verdict for a memory-safety gate whose instrument is switched off.
int sanitizerPositiveControl(forge::ui::ForgeShell& shell, forge::desktop::ForgeFrame& frame) {
  const forge::ui::DockWindow* w = shell.layout().mainWindow();
  if (w == nullptr || w->root.children.size() != 2) {
    std::printf("  FAIL  mutation 3 needs a split root\n");
    return 1;
  }
  // Exactly what drawTabGroup() held: a const reference into the live tree.
  const forge::ui::DockNode& held = w->root.children[0];
  const std::size_t before = held.panels.size();
  std::printf("[gate] MUTATION 3: holding a DockNode with %zu panels, then re-seating the "
              "layout under it\n",
              before);
  // ...and exactly what the tab button did: re-seat the whole DockLayout.
  frame.setActiveTabAt({0}, held.activeTab == 0 ? 1 : 0);
  // ...and exactly the read that faulted at 0x17.
  const volatile std::size_t after = held.panels.size();
  std::printf("[gate] MUTATION 3 SURVIVED the use-after-free read (%zu panels): the address "
              "sanitizer is NOT ARMED in this build, so this gate's memory-safety half is "
              "silent.\n",
              static_cast<std::size_t>(after));
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[gate] MUTATION %d ACTIVE\n", g_mutation);

  // ── the real application, headless ───────────────────────────────────────
  forge::desktop::KernelScene scene;
  const bool built = scene.build();
  check(built, "kernel body builds", scene.error());
  if (!built) {
    std::printf("[gate] cannot continue without geometry\n");
    return 1;
  }

  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();

  if (g_mutation == 3) {
    step(frame);
    return sanitizerPositiveControl(shell, frame);
  }

  const std::vector<forge::ui::WorkspaceProfile> profiles = forge::ui::allWorkspaceProfiles();
  check(!profiles.empty(), "there is at least one workspace to exercise", "");

  std::size_t tabsClicked = 0;
  std::size_t tabsExpected = 0;
  std::size_t changingClicks = 0;
  std::size_t changingExpected = 0;
  std::size_t splittersDragged = 0;
  std::size_t splittersExpected = 0;
  std::size_t workspacesExercised = 0;
  std::size_t expandersClicked = 0;

  for (std::size_t wsIndex = 0; wsIndex < profiles.size(); ++wsIndex) {
    // MUTATION 4: the loop is trimmed to the first workspace. The census
    // assertions at the end are UNCONDITIONAL, so this cannot hide.
    if (g_mutation == 4 && wsIndex > 0) break;
    const forge::ui::WorkspaceProfile p = profiles[wsIndex];
    const std::string ws = forge::ui::toString(p);
    ++workspacesExercised;

    shell.setWorkspace(p);
    // Two settling frames: ImGui sizes a window on the frame after it first
    // appears, so the tab rectangles are only final on the second.
    pointerTo(-FLT_MAX, -FLT_MAX);
    step(frame);
    step(frame);

    const Census census = censusOf(shell);
    tabsExpected += census.tabs;
    splittersExpected += census.splits;

    // ── every panel in the workspace has a tab the user can hit ───────────
    // The reference is the dock MODEL's own count, read from the tree, so a tab
    // strip that silently dropped or clipped a tab fails here.
    checkEq(frame.tabHits().size(), census.tabs, "every docked panel drew a clickable tab", ws);
    checkEq(frame.splitterHits().size(), census.splits, "every split drew a splitter grip", ws);
    checkEq(frame.panelsDrawn(), census.tabGroups, "one panel body per tab group", ws);
    const std::size_t panelsBefore = shell.layout().panelCount();

    // ── click every tab, and step a FURTHER frame after each ──────────────
    const std::size_t tabCount = frame.tabHits().size();
    for (std::size_t t = 0; t < tabCount; ++t) {
      // Re-read the hit box from the LAST frame drawn, never from a snapshot
      // taken before the clicking started: a stale rectangle is the same class of
      // defect this gate is about.
      if (t >= frame.tabHits().size()) {
        check(false, "the tab strip did not shrink between clicks", ws);
        break;
      }
      const forge::desktop::TabHit hit = frame.tabHits()[t];
      const std::string where =
          ws + " " + pathText(hit.path) + "[" + std::to_string(hit.index) + "] " + hit.panelId;

      const forge::ui::DockWindow* w = shell.layout().mainWindow();
      const forge::ui::DockNode* before = w == nullptr ? nullptr : nodeAt(w->root, hit.path);
      check(before != nullptr, "the tab's path addresses a live node", where);
      if (before == nullptr) continue;
      const std::size_t activeBefore = before->activeTab;
      const std::size_t panelsInGroup = before->panels.size();
      if (activeBefore != hit.index) ++changingExpected;

      // MUTATION 1: the pointer never reaches the tab, so nothing is hovered and
      // the press lands on empty air. Every check below stays UNCONDITIONAL.
      if (g_mutation != 1) pointerTo(hit.centreX(), hit.centreY());
      step(frame);  // hover
      leftButton(true);
      step(frame);  // press: the button becomes active
      leftButton(false);
      step(frame);  // release: ImGui::Button() fires HERE

      // ── THE FURTHER FRAME ────────────────────────────────────────────────
      // The crash was the next read through a reference the click had freed, so
      // the assertions below are worthless without this line. MUTATION 2 removes
      // it and nothing else.
      ImDrawData* dd = nullptr;
      if (g_mutation != 2) dd = step(frame);

      ++tabsClicked;

      // 1. THE INVARIANT: the layout was never re-seated mid-walk.
      checkEq(frame.layoutReseatsDuringWalk(), 0u,
              "no DockLayout re-seat while the draw walked it", where);

      // 2. The click reached the dock MODEL: the tab the user hit is active.
      const forge::ui::DockWindow* w2 = shell.layout().mainWindow();
      const forge::ui::DockNode* after = w2 == nullptr ? nullptr : nodeAt(w2->root, hit.path);
      check(after != nullptr, "the node still exists after the click", where);
      if (after != nullptr) {
        checkEq(after->activeTab, hit.index, "the clicked tab is the active tab", where);
        checkEq(after->panels.size(), panelsInGroup, "the tab group kept every one of its panels",
                where);
        if (after->activeTab != activeBefore) ++changingClicks;
      }

      // 3. THE APP IS ALIVE AND THE FRAME IS REAL. `dd` is the frame built AFTER
      //    the layout was re-seated -- the one the crashed app never reached.
      check(dd != nullptr, "the frame after the click produced draw data", where);
      if (dd != nullptr) {
        checkGe(dd->TotalVtxCount, 500, "and it drew real geometry", where);
        checkGe(dd->CmdListsCount, 4, "and menu, chrome and docked panels each drew", where);
      }

      // 4. The panel BEHIND the clicked tab came up. This is the read that faulted
      //    (drawPanel(node.panels[active])), asserted as a value.
      check(contains(frame.panelIdsDrawn(), hit.panelId),
            "the panel behind the clicked tab was drawn", where);
      checkEq(frame.panelsDrawn(), census.tabGroups, "still one panel body per tab group", where);

      // 5. Nothing was lost, and the tree is still a tree.
      check(shell.layout().valid(), "the dock tree is still valid", where);
      checkEq(shell.layout().panelCount(), panelsBefore, "no panel was lost by the click", where);

      // 6. ...and it is still SAVEABLE. A torn tree can still answer panelCount();
      //    what it cannot do is round-trip through its own serializer.
      const std::string text = shell.layout().serialize();
      forge::ui::DockLayout reparsed;
      check(forge::ui::DockLayout::parse(text, reparsed), "the layout still serializes", where);
      check(reparsed == shell.layout(), "and parses back to the same tree", where);
    }

    // ── drag every splitter, and step a FURTHER frame after each ──────────
    // Same hazard, other gesture: drawSplitter() wrote the new ratio through
    // setRatioAt() from INSIDE the walk, and drawNode() reads node.children[1]
    // on the very next line.
    const std::size_t splitCount = frame.splitterHits().size();
    for (std::size_t s = 0; s < splitCount; ++s) {
      if (s >= frame.splitterHits().size()) break;
      const forge::desktop::SplitterHit grip = frame.splitterHits()[s];
      const std::string where = ws + " split " + pathText(grip.path);

      const forge::ui::DockWindow* w = shell.layout().mainWindow();
      const forge::ui::DockNode* before = w == nullptr ? nullptr : nodeAt(w->root, grip.path);
      check(before != nullptr, "the splitter's path addresses a live node", where);
      if (before == nullptr) continue;
      const double ratioBefore = before->ratio;

      // 24 px, comfortably past ImGui's 6 px drag threshold, in the axis the grip
      // actually moves along.
      const float dx = grip.vertical ? 0.0f : 24.0f;
      const float dy = grip.vertical ? 24.0f : 0.0f;
      pointerTo(grip.centreX(), grip.centreY());
      step(frame);  // hover
      leftButton(true);
      step(frame);  // press: the grip becomes active
      // MUTATION 5: pressed, never moved. A press that does not drag must not move
      // a ratio, so the assertion below goes red.
      if (g_mutation != 5) pointerTo(grip.centreX() + dx, grip.centreY() + dy);
      step(frame);  // drag: the ratio is recorded and applied after the walk
      step(frame);  // THE FURTHER FRAME
      leftButton(false);
      ImDrawData* dd = step(frame);
      ++splittersDragged;

      checkEq(frame.layoutReseatsDuringWalk(), 0u,
              "no DockLayout re-seat while the draw walked it (drag)", where);
      const forge::ui::DockWindow* w2 = shell.layout().mainWindow();
      const forge::ui::DockNode* after = w2 == nullptr ? nullptr : nodeAt(w2->root, grip.path);
      check(after != nullptr, "the node still exists after the drag", where);
      if (after != nullptr) {
        check(after->ratio != ratioBefore, "the drag moved the ratio in the dock TREE",
              std::to_string(ratioBefore) + " -> " + std::to_string(after->ratio));
        check(after->ratio >= 0.08 && after->ratio <= 0.92, "and the ratio stayed clamped",
              std::to_string(after->ratio));
        checkEq(after->children.size(), 2u, "the split still has both children", where);
      }
      check(dd != nullptr && dd->TotalVtxCount > 500, "the frame after the drag is real", where);
      check(shell.layout().valid(), "the dock tree is still valid after a drag", where);
      checkEq(shell.layout().panelCount(), panelsBefore, "no panel was lost by the drag", where);
    }

    leftButton(false);
    pointerTo(-FLT_MAX, -FLT_MAX);
    step(frame);

    // ── THE THIRD CONTAINER: click a real feature-tree expander ───────────
    // The dock's two mid-walk crashes are exercised above. The THIRD one -- the
    // feature tree, where tree_.rebuild() resized rows_ while ImGuiListClipper
    // iterated a range sized from the previous rowCount, and rowAt() threw
    // std::out_of_range -- was fixed and never tested. ForgeFrame has carried
    // treeExpanderRect() the whole time, documented as "so a headless gate can
    // click the real widget instead of guessing pixels", and NOTHING CALLED IT.
    // A fix with no gate is a fix until someone edits that loop.
    //
    // Clicking the real widget matters here more than anywhere: the defect is
    // ordering, so it only appears when the mutation happens at the point in the
    // frame the gesture actually puts it.
    const forge::desktop::ForgeFrame::WidgetRect exp = frame.treeExpanderRect();
    if (exp.valid) {
      const std::size_t rowsBefore = frame.treeRowCount();
      const std::size_t reseatsBefore = frame.layoutReseatsDuringWalk();
      pointerTo((exp.x0 + exp.x1) * 0.5f, (exp.y0 + exp.y1) * 0.5f);
      step(frame);            // hover
      leftButton(true);
      step(frame);            // press
      leftButton(false);
      step(frame);            // release: SmallButton() fires HERE, and RECORDS

      // ── THE FURTHER FRAME ──────────────────────────────────────────────
      // Same reason as the tab click: the deferred rebuild is applied at the END
      // of the frame the click landed in, so the row count only moves on the
      // frame after. MUTATION 6 removes this line and nothing else, which makes
      // the row-count assertion below fail -- proving the assertion is load
      // bearing rather than incidentally true.
      ImDrawData* td = nullptr;
      if (g_mutation != 6) td = step(frame);
      ++expandersClicked;

      // 1. THE INVARIANT, for the container it did not used to cover.
      //    setTreeExpandedAt() reports into the same counter, so a rebuild under
      //    the clipper would move this number instead of aborting silently.
      checkEq(frame.layoutReseatsDuringWalk(), 0u,
              "no container mutated while the draw walked it (feature tree)", ws);
      checkEq(frame.layoutReseatsDuringWalk(), reseatsBefore,
              "the expander click added no mid-walk mutation", ws);

      // 2. The click reached the tree MODEL. An expander that toggles nothing is
      //    the other way this could pass: no crash, and no effect either.
      check(frame.treeRowCount() != rowsBefore,
            "the expander click changed the tree's row count", ws);

      // 3. The process survived to draw a real frame afterwards, which is what
      //    the std::out_of_range abort denied it.
      check(td != nullptr && td->TotalVtxCount > 500,
            "the frame after the expander click is real", ws);

      pointerTo(-FLT_MAX, -FLT_MAX);
      step(frame);
    }
  }

  // ── coverage: what was clicked is what the model said was there ──────────
  std::printf("[gate] %zu workspaces, %zu tabs clicked, %zu splitters dragged, "
              "%zu tree expanders clicked, %zu frames built\n",
              workspacesExercised, tabsClicked, splittersDragged, expandersClicked, g_frames);
  checkEq(workspacesExercised, profiles.size(), "every workspace was exercised", "");
  checkEq(tabsClicked, tabsExpected, "every tab in every workspace was clicked", "");
  checkEq(splittersDragged, splittersExpected, "every splitter in every workspace was dragged",
          "");
  checkEq(changingClicks, changingExpected,
          "every click on a non-active tab changed the active tab", "");
  checkGe(changingClicks, 1u, "at least one click was a real state change", "");
  // UNCONDITIONAL, like every other census line here. The expander section is
  // guarded by `exp.valid`, and a guarded section that stops finding its widget
  // stops running and reports nothing -- silence that looks exactly like a pass.
  // This is the line that makes that loud.
  checkGe(expandersClicked, 1u,
          "at least one feature-tree expander was found and clicked", "");
  checkGe(g_frames, tabsClicked * 4, "at least four frames were stepped per tab click", "");

  std::printf("\n[gate] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures == 0) {
    std::printf("[gate] ALL FORGE DESKTOP CLICK GATES PASS "
                "(headless: no window, no swapchain, no MoltenVK; -fsanitize=address)\n");
    return 0;
  }
  return 1;
}
