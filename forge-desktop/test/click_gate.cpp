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
#include <map>
#include <string>
#include <vector>

#include "imgui.h"
#include "imgui_internal.h"

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

// ── THE WIDGET CENSUS ───────────────────────────────────────────────────────
// Everything below this line exists to answer ONE question with a number rather
// than with a list somebody maintains: which of the application's interactive
// surfaces does this gate actually drive?
//
// Dear ImGui is compiled here with IMGUI_ENABLE_TEST_ENGINE, which makes
// ItemAdd() and ItemInfo() call four extern hooks -- ONE CALL PER SUBMITTED
// WIDGET, carrying its ImGuiID, its screen rectangle, its label and its item
// flags. This file implements those four symbols itself; there is no
// imgui_test_engine dependency, and the app's own ImGui build carries no hook.
//
// Two consequences, both of which this gate needed:
//   1. The gate LOCATES widgets instead of guessing pixels. "Click the button
//      labelled Iso" is a lookup in this frame's census, so a layout change
//      moves the click with it and cannot silently miss.
//   2. Coverage becomes MEASURED and self-lowering. A new button that no
//      gesture touches raises the denominator on its own, and the residue is
//      printed by label at the end of every run.
struct CensusEntry {
  std::string label;
  std::string window;
  bool driven = false;      // the gate deliberately put the pointer on it and pressed
  bool becameActive = false;  // ImGui made it the ActiveId -- it RESPONDED
  bool everEnabled = false;
  // ImGui calls the ItemAdd hook BEFORE its clipping test, so a widget scrolled
  // out of its parent's clip rect is still announced. A rectangle nobody can
  // reach is not an interactive surface, and counting it would make the
  // denominator include the unreachable -- so visibility is recorded and
  // coverage is taken over the widgets that were BOTH enabled and on screen at
  // least once.
  bool everVisible = false;
  std::size_t frames = 0;
};

std::map<ImGuiID, CensusEntry> g_census;

// One submitted widget, as seen in the frame just drawn. Rebuilt every frame,
// because a rectangle from an older frame is exactly the stale-coordinate defect
// this gate's tab loop already refuses to make.
struct FrameItem {
  ImGuiID id = 0;
  std::string label;
  std::string window;
  float x0 = 0, y0 = 0, x1 = 0, y1 = 0;
  bool disabled = true;
  bool visible = false;
  float centreX() const noexcept { return 0.5f * (x0 + x1); }
  float centreY() const noexcept { return 0.5f * (y0 + y1); }
  bool reachable() const noexcept {
    return visible && !disabled && (x1 - x0) >= 1.0f && (y1 - y0) >= 1.0f;
  }
};

std::vector<FrameItem> g_frameItems;
bool g_censusArmed = false;
bool g_dumpWidgets = false;
std::size_t g_censusReachable = 0;
std::size_t g_censusResponded = 0;

CensusEntry& censusOf(ImGuiID id) { return g_census[id]; }

}  // namespace

// ── the four symbols Dear ImGui declares under IMGUI_ENABLE_TEST_ENGINE ──────
// Global linkage, matching imgui_internal.h exactly. ImGui calls ItemAdd's hook
// only while g.TestEngineHookItems is true, which main() sets once.
void ImGuiTestEngineHook_ItemAdd(ImGuiContext* ctx, ImGuiID id, const ImRect& bb,
                                 const ImGuiLastItemData* item_data) {
  // id == 0 is a non-addressable item (plain text, a separator, a dummy). A null
  // item_data is Begin() registering the WINDOW itself, not a widget in it.
  if (!g_censusArmed || id == 0 || item_data == nullptr) return;
  ImGuiWindow* w = (ctx != nullptr) ? ctx->CurrentWindow : nullptr;
  const char* win = (w != nullptr) ? w->Name : "?";
  // ImGui's implicit fallback window. It belongs to the library, not to the
  // application, and counting it would put two widgets Forge never wrote into
  // the denominator of Forge's own coverage.
  if (std::strcmp(win, "Debug##Default") == 0) return;
  const bool disabled = (item_data->ItemFlags & ImGuiItemFlags_Disabled) != 0;
  const bool visible = (w != nullptr) && bb.Overlaps(w->ClipRect);
  FrameItem f;
  f.id = id;
  f.window = win;
  f.x0 = bb.Min.x;
  f.y0 = bb.Min.y;
  f.x1 = bb.Max.x;
  f.y1 = bb.Max.y;
  f.disabled = disabled;
  f.visible = visible;
  g_frameItems.push_back(f);
  CensusEntry& e = censusOf(id);
  e.window = win;
  ++e.frames;
  if (!disabled) e.everEnabled = true;
  if (visible) e.everVisible = true;
}

void ImGuiTestEngineHook_ItemInfo(ImGuiContext*, ImGuiID id, const char* label,
                                  ImGuiItemStatusFlags) {
  if (!g_censusArmed || id == 0 || label == nullptr) return;
  censusOf(id).label = label;
  for (std::size_t i = g_frameItems.size(); i-- > 0;) {
    if (g_frameItems[i].id == id) {
      g_frameItems[i].label = label;
      return;
    }
  }
}

// ImGui's own debug windows call these two. They are never exercised here, but a
// symbol that does not exist is a link failure, and a gate that cannot link is a
// gate that cannot fail.
void ImGuiTestEngineHook_Log(ImGuiContext*, const char*, ...) {}

const char* ImGuiTestEngine_FindItemDebugLabel(ImGuiContext*, ImGuiID id) {
  auto it = g_census.find(id);
  return (it == g_census.end() || it->second.label.empty()) ? nullptr
                                                            : it->second.label.c_str();
}

namespace {

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
    // Arm the item hooks. Without this line ImGui never calls them and the
    // census is empty -- which would read as "this app has no widgets", the
    // silent-zero this programme keeps meeting.
    ImGui::GetCurrentContext()->TestEngineHookItems = true;
    g_censusArmed = true;
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

std::size_t g_frames = 0;

// A widget ImGui made ACTIVE is a widget that RESPONDED to the gesture -- the
// press reached it, its behaviour ran. ActiveId is live during the press frame
// and LastActiveId survives the release, so reading both after a frame catches
// either half of a click without the gate having to guess which frame fired.
void recordActivations() {
  ImGuiContext* g = ImGui::GetCurrentContext();
  if (g == nullptr) return;
  const ImGuiID ids[2] = {g->ActiveId, g->LastActiveId};
  for (ImGuiID id : ids) {
    if (id == 0) continue;
    auto it = g_census.find(id);
    if (it != g_census.end()) it->second.becameActive = true;
  }
}

// ONE real frame of the real application shell.
ImDrawData* step(forge::desktop::ForgeFrame& frame) {
  ++g_frames;
  g_frameItems.clear();
  ImGui::NewFrame();
  frame.build(0, 1.0f);
  ImGui::Render();
  recordActivations();
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


// ══════════════════════════════════════════════════════════════════════════
// PHASE 2 — EVERY OTHER INTERACTIVE SURFACE THE APPLICATION DRAWS
//
// Phase 1 (above) clicks dock tabs and drags splitter grips. MEASURED with the
// widget census, that reached 53 of the 233 interactive widgets this app puts on
// screen -- 22.7%. Everything the other 180 are attached to was, until this
// phase existed, driven by NO gate at all: the menu bar, the ribbon, the command
// palette, the selection filter, the viewport and its pick, the standard-view
// buttons, the context menu, the feature-tree expander and its rows, the whole
// Properties parameter editor, and the Archie Tools panel.
//
// frame_gate and document_gate do reach some of the SAME CODE -- they call
// frame.setActiveTabAt(), frame.clickFace(), frame.setEditTarget() and
// frame.applyFeatureEdit() straight through the API. That is exactly the
// blindness this file exists for: all three of the shipped defects were in the
// WIDGET that calls the API, not in the API, and a gate that calls the API
// cannot see them. Only a press on a real ImGui rectangle can.
//
// ★ THE FOURTH INSTANCE, FOUND BY THIS PHASE. The Archie Tools panel draws one
// ImGui::Button per registry command and calls invoke() from inside it. That
// panel is DOCKED, so the button is pressed in the middle of the dock walk --
// and "Next Workspace" (workspace.next) ends in ForgeShell::setWorkspace(),
// whose last act is `layout_ = std::move(restored)`. That is the identical
// re-seat that freed the DockNode the tab click used to free, in a code path
// nobody had ever pressed. The command dispatch is deferred now, by the same
// RECORD-INTENT-APPLY-AFTER-THE-WALK pattern as the other three; the gesture
// below is what keeps it that way.

void settle(forge::desktop::ForgeFrame& frame) {
  leftButton(false);
  pointerTo(-FLT_MAX, -FLT_MAX);
  step(frame);
  step(frame);
}

// ── locating a widget the application actually drew, this frame ─────────────
// Never a rectangle remembered from an earlier frame: a stale coordinate is the
// same class of defect the tab loop already refuses to make.
bool findItem(const char* windowNeedle, const char* label, FrameItem& out) {
  for (const FrameItem& f : g_frameItems) {
    if (!f.reachable()) continue;
    if (windowNeedle != nullptr && f.window.find(windowNeedle) == std::string::npos) continue;
    if (label != nullptr && f.label != label) continue;
    out = f;
    return true;
  }
  return false;
}

// A widget with no label of its own: a combo's preview box, a scrollbar, an
// invisible grip. `skip` walks past ones already driven.
bool findUnlabelled(const char* windowNeedle, FrameItem& out, std::size_t skip = 0) {
  for (const FrameItem& f : g_frameItems) {
    if (!f.reachable() || !f.label.empty()) continue;
    if (windowNeedle != nullptr && f.window.find(windowNeedle) == std::string::npos) continue;
    if (skip-- > 0) continue;
    out = f;
    return true;
  }
  return false;
}

std::size_t countItemsIn(const char* windowNeedle) {
  std::size_t n = 0;
  for (const FrameItem& f : g_frameItems) {
    if (f.reachable() && f.window.find(windowNeedle) != std::string::npos) ++n;
  }
  return n;
}

// ── the surface ledger ──────────────────────────────────────────────────────
// One counter per NAMED interactive surface. Every one is asserted non-zero at
// the end, UNCONDITIONALLY, so a gesture that silently stopped happening -- a
// widget that moved, a panel that stopped being drawn, a `return` added early --
// is red rather than quiet. This is the ratchet: the list only grows.
std::map<std::string, std::size_t> g_surface;
void drove(const char* s) { ++g_surface[s]; }

// ── the gesture ─────────────────────────────────────────────────────────────
// Hover, press, release, and THE FURTHER FRAME -- the frame built after whatever
// the widget did, which is the frame a crashed app never reaches and the only
// place a use-after-free can be observed as anything but luck.
ImDrawData* pressItem(forge::desktop::ForgeFrame& frame, const FrameItem& it,
                      int button = 0) {
  censusOf(it.id).driven = true;
  pointerTo(it.centreX(), it.centreY());
  step(frame);  // hover
  ImGui::GetIO().AddMouseButtonEvent(button, true);
  step(frame);  // press: the widget becomes ImGui's ActiveId
  ImGui::GetIO().AddMouseButtonEvent(button, false);
  step(frame);  // release: Button()/Selectable()/MenuItem() fires HERE
  return step(frame);  // THE FURTHER FRAME
}

// The invariants that must hold after EVERY gesture in this file, not just after
// a dock one. layoutReseatsDuringWalk() is a lifetime total, so this also
// re-asserts every earlier gesture on every later one.
void healthy(forge::ui::ForgeShell& shell, forge::desktop::ForgeFrame& frame, ImDrawData* dd,
             const std::string& where) {
  checkEq(frame.layoutReseatsDuringWalk(), 0u,
          "no DockLayout re-seat while the draw walked it", where);
  check(shell.layout().valid(), "the dock tree is still valid", where);
  check(dd != nullptr && dd->TotalVtxCount > 500, "the frame after the gesture is real", where);
  const std::string text = shell.layout().serialize();
  forge::ui::DockLayout reparsed;
  check(forge::ui::DockLayout::parse(text, reparsed), "the layout still serializes", where);
  check(reparsed == shell.layout(), "and parses back to the same tree", where);
}

// Find a labelled widget and press it. A widget that is NOT THERE is a FAILURE,
// never a skip: "the gesture could not be performed" and "the gesture passed"
// must not look the same.
bool pressLabelled(forge::ui::ForgeShell& shell, forge::desktop::ForgeFrame& frame,
                   const char* windowNeedle, const char* label, const char* surface,
                   const std::string& where, int button = 0) {
  FrameItem it;
  if (!findItem(windowNeedle, label, it)) {
    check(false, "the widget this gesture needs was drawn and reachable",
          where + "  <" + (label == nullptr ? "(unlabelled)" : label) + ">");
    return false;
  }
  ImDrawData* dd = pressItem(frame, it, button);
  drove(surface);
  healthy(shell, frame, dd, where);
  return true;
}

// Open one top-level menu-bar menu and assert its items actually came up. A menu
// that opens empty is a menu the user cannot use, and it is not visible from
// outside because nothing else in this app ever draws those items.
bool openMenu(forge::ui::ForgeShell& shell, forge::desktop::ForgeFrame& frame,
              const char* topLevel) {
  settle(frame);
  if (!pressLabelled(shell, frame, "##MainMenuBar", topLevel, "menu.top",
                     std::string("menu ") + topLevel)) {
    return false;
  }
  const std::size_t items = countItemsIn("###Menu_");
  checkGe(items, 1u, "the opened menu drew at least one item",
          std::string("menu ") + topLevel);
  return items > 0;
}

// Close whatever popup is open without choosing anything: Escape, the same key a
// user reaches for.
void pressEscape(forge::desktop::ForgeFrame& frame) {
  ImGui::GetIO().AddKeyEvent(ImGuiKey_Escape, true);
  step(frame);
  ImGui::GetIO().AddKeyEvent(ImGuiKey_Escape, false);
  step(frame);
  settle(frame);
}

void typeText(forge::desktop::ForgeFrame& frame, const char* text) {
  for (const char* c = text; *c != '\0'; ++c) {
    ImGui::GetIO().AddInputCharacter(static_cast<unsigned int>(*c));
  }
  step(frame);
  step(frame);
}

void driveEverySurface(forge::ui::ForgeShell& shell, forge::desktop::ForgeFrame& frame) {
  shell.setWorkspace(forge::ui::WorkspaceProfile::Part);
  settle(frame);

  // ── 1. THE MENU BAR ──────────────────────────────────────────────────────
  // Eight top-level menus, every one of them BUILT FROM THE REGISTRY. Nothing
  // had ever opened one, so until now no MenuItem in this application had been
  // drawn by any gate, let alone pressed.
  {
    const std::size_t fitsBefore = frame.fitsApplied();
    if (openMenu(shell, frame, "View")) {
      // MUTATION 6: the menu is opened and then abandoned. Everything below is
      // unconditional, so the surface ledger and this check both go red.
      if (g_mutation != 6) {
        pressLabelled(shell, frame, "###Menu_", "Fit View", "menu.command",
                      "menu View > Fit View");
      }
      checkGe(frame.fitsApplied(), fitsBefore + 1,
              "the MENU ITEM ran view.fit -- not the API, the widget", "View > Fit View");
    }
    settle(frame);
  }
  {
    // Reset Workspace Layout: a whole-layout replacement, driven from a widget.
    if (openMenu(shell, frame, "Window")) {
      pressLabelled(shell, frame, "###Menu_", "Reset Workspace Layout", "menu.reset_layout",
                    "menu Window > Reset Workspace Layout");
      forge::ui::DockLayout expected =
          forge::ui::defaultLayout(forge::ui::WorkspaceProfile::Part);
      check(shell.layout() == expected, "the menu item restored the default layout", "");
    }
    settle(frame);
  }
  {
    // A WORKSPACE switch from the menu -- the gesture that swaps the entire dock
    // tree out from under the frame builder.
    if (openMenu(shell, frame, "Window")) {
      pressLabelled(shell, frame, "###Menu_", "sketch", "menu.workspace",
                    "menu Window > sketch");
      checkEq(static_cast<int>(shell.workspace()),
              static_cast<int>(forge::ui::WorkspaceProfile::Sketch),
              "the menu item changed the workspace", "");
    }
    settle(frame);
  }
  {
    // ...and back, through the WORKSPACE TAB BUTTON, which is a different widget
    // in a different window reaching the same shell call.
    pressLabelled(shell, frame, "##workspace_tabs", "Part", "workspace.tab",
                  "workspace tab Part");
    checkEq(static_cast<int>(shell.workspace()),
            static_cast<int>(forge::ui::WorkspaceProfile::Part),
            "the workspace tab button changed the workspace", "");
    settle(frame);
  }
  {
    // Help > Check for Updates. The one menu item that decides whether a shipped
    // copy of Forge can ever reach the next version.
    check(!frame.updateCheckRequested(), "no update check is pending before the click", "");
    if (openMenu(shell, frame, "Help")) {
      pressLabelled(shell, frame, "###Menu_", "Check for Updates...", "menu.update_check",
                    "menu Help > Check for Updates...");
      check(frame.updateCheckRequested(), "the menu item raised the update-check request", "");
      frame.clearUpdateCheckRequest();
    }
    settle(frame);
  }
  {
    if (openMenu(shell, frame, "Input Profile")) {
      pressLabelled(shell, frame, "###Menu_", "nx-like", "menu.input_profile",
                    "menu Input Profile > nx-like");
      checkEq(static_cast<int>(shell.inputProfile()),
              static_cast<int>(forge::ui::InputProfile::NXLike),
              "the menu item changed the input profile", "");
    }
    settle(frame);
    if (openMenu(shell, frame, "Input Profile")) {
      pressLabelled(shell, frame, "###Menu_", "forge-native", "menu.input_profile",
                    "menu Input Profile > forge-native");
      checkEq(static_cast<int>(shell.inputProfile()),
              static_cast<int>(forge::ui::InputProfile::ForgeNative),
              "...and back", "");
    }
    settle(frame);
  }
  {
    // The remaining top-level menus are OPENED so their items are drawn and
    // censused. Application > Next Workspace is pressed from HERE as well as
    // from the Tools panel later, because the menu bar draws before the dock
    // walk and the Tools panel draws inside it -- same command, two very
    // different hazards.
    if (openMenu(shell, frame, "Application")) {
      pressLabelled(shell, frame, "###Menu_", "Next Workspace", "menu.command",
                    "menu Application > Next Workspace");
      check(shell.workspace() != forge::ui::WorkspaceProfile::Part,
            "the menu item advanced the workspace", "");
    }
    settle(frame);
    shell.setWorkspace(forge::ui::WorkspaceProfile::Part);
    settle(frame);
    if (openMenu(shell, frame, "File")) pressEscape(frame);
    if (openMenu(shell, frame, "Edit")) pressEscape(frame);
    if (openMenu(shell, frame, "Part")) pressEscape(frame);
  }

  // ── 2. THE TOOLBAR (the ribbon) ──────────────────────────────────────────
  {
    const bool wireBefore = shell.document().wireframe;
    pressLabelled(shell, frame, "##toolbar", "Wireframe Display", "toolbar.command",
                  "ribbon Wireframe Display");
    check(shell.document().wireframe != wireBefore,
          "the RIBBON BUTTON toggled wireframe through the one registry", "");
    settle(frame);
    pressLabelled(shell, frame, "##toolbar", "Wireframe Display", "toolbar.command",
                  "ribbon Wireframe Display (back)");
    checkEq(shell.document().wireframe, wireBefore, "...and back", "");
    settle(frame);
  }
  {
    check(!frame.paletteOpen(), "the palette is closed before the button is pressed", "");
    pressLabelled(shell, frame, "##toolbar", "Command Palette", "toolbar.palette",
                  "ribbon Command Palette");
    check(frame.paletteOpen(), "the ribbon button opened the command palette", "");
    // The palette's own two surfaces: the query field and a result row.
    FrameItem q;
    if (findItem("Command Palette", "##q", q)) {
      const std::size_t rowsBefore = countItemsIn("Command Palette");
      pressItem(frame, q);
      drove("palette.query");
      // MUTATION 11: the field is clicked but nothing is typed, so the result
      // list never narrows and the check below goes red.
      if (g_mutation != 11) typeText(frame, "wire");
      const std::size_t rowsAfter = countItemsIn("Command Palette");
      check(rowsAfter < rowsBefore, "typing in the palette NARROWED the result list",
            std::to_string(rowsBefore) + " -> " + std::to_string(rowsAfter));
    } else {
      check(false, "the palette drew its query field", "");
    }
    const bool wireBefore = shell.document().wireframe;
    pressLabelled(shell, frame, "Command Palette", "Wireframe Display", "palette.row",
                  "palette row Wireframe Display");
    check(shell.document().wireframe != wireBefore,
          "the PALETTE ROW ran the command through the one registry", "");
    check(!frame.paletteOpen(), "and the palette closed itself", "");
    settle(frame);
    // ...and back, so the rest of the run sees the display it started with.
    pressLabelled(shell, frame, "##toolbar", "Wireframe Display", "toolbar.command",
                  "ribbon Wireframe Display (restore)");
    checkEq(shell.document().wireframe, wireBefore, "wireframe restored", "");
    settle(frame);
  }

  // ── 3. THE STATUS STRIP'S SELECTION FILTER ───────────────────────────────
  // The control that decides what a viewport click picks. It is a BeginCombo, so
  // its options exist only while the popup is open -- which nothing had ever
  // done.
  {
    check(!frame.edgePickMode(), "picks start in face mode", "");
    FrameItem combo;
    if (findUnlabelled("##status", combo)) {
      pressItem(frame, combo);
      drove("status.filter_combo");
      checkGe(countItemsIn("##Popup_"), 1u, "the filter combo opened its option list", "");
      // MUTATION 10: the popup is opened and abandoned, so the filter never
      // moves and the check below goes red.
      if (g_mutation != 10) {
        pressLabelled(shell, frame, "##Popup_", "edge", "status.filter_option",
                      "filter combo > edge");
      }
      check(frame.edgePickMode(), "choosing 'edge' in the combo put picks in EDGE mode", "");
    } else {
      check(false, "the status strip drew its selection-filter combo", "");
    }
    settle(frame);
    if (findUnlabelled("##status", combo)) {
      pressItem(frame, combo);
      pressLabelled(shell, frame, "##Popup_", "any", "status.filter_option",
                    "filter combo > any");
      check(!frame.edgePickMode(), "...and back to face mode", "");
    }
    settle(frame);
  }

  // ── 4. THE VIEWPORT ──────────────────────────────────────────────────────
  {
    FrameItem vp;
    if (!findItem("##dock_", "##viewport", vp)) {
      check(false, "the viewport panel drew its pick surface", "");
    } else {
      // HOVER preselects.
      pointerTo(vp.centreX(), vp.centreY());
      step(frame);
      step(frame);
      censusOf(vp.id).driven = true;
      checkGe(frame.viewport().hoverFace, 1u,
              "hovering the viewport PRESELECTED a face through the real ray cast", "");

      // CLICK selects. MUTATION 7 stops at the hover.
      const std::size_t before = shell.selection().count();
      if (g_mutation != 7) {
        leftButton(true);
        step(frame);
        leftButton(false);
        step(frame);
        ImDrawData* dd = step(frame);
        healthy(shell, frame, dd, "viewport pick");
      }
      drove("viewport.pick");
      checkGe(shell.selection().count(), before + 1,
              "the viewport CLICK put a typed EntityRef in the selection", "");
    }
    settle(frame);
  }
  {
    // Middle-drag orbits and the wheel zooms. Neither is a widget, both are
    // input the app reads straight from the queue, and no gate had sent either.
    FrameItem vp;
    if (findItem("##dock_", "##viewport", vp)) {
      const float azBefore = frame.camera().azimuth();
      pointerTo(vp.centreX(), vp.centreY());
      step(frame);
      ImGui::GetIO().AddMouseButtonEvent(2, true);
      step(frame);
      pointerTo(vp.centreX() + 60.0f, vp.centreY() + 20.0f);
      step(frame);
      ImGui::GetIO().AddMouseButtonEvent(2, false);
      ImDrawData* dd = step(frame);
      drove("viewport.orbit");
      healthy(shell, frame, dd, "viewport orbit");
      check(frame.camera().azimuth() != azBefore, "the middle-drag ORBITED the camera",
            std::to_string(azBefore) + " -> " + std::to_string(frame.camera().azimuth()));

      const float distBefore = frame.camera().distance();
      pointerTo(vp.centreX(), vp.centreY());
      step(frame);
      ImGui::GetIO().AddMouseWheelEvent(0.0f, -2.0f);
      dd = step(frame);
      drove("viewport.zoom");
      healthy(shell, frame, dd, "viewport zoom");
      check(frame.camera().distance() != distBefore, "the wheel ZOOMED the camera",
            std::to_string(distBefore) + " -> " + std::to_string(frame.camera().distance()));
    }
    settle(frame);
  }
  {
    // The four standard-view buttons, drawn as an overlay ON TOP of the
    // geometry -- an ImGui item inside the viewport panel, so a click here also
    // proves the overlay takes input rather than only painting.
    const char* views[] = {"Iso", "Fr", "Tp", "Rt"};
    for (const char* v : views) {
      const float azBefore = frame.camera().azimuth();
      const float elBefore = frame.camera().elevation();
      pressLabelled(shell, frame, "##dock_", v, "viewport.view_preset",
                    std::string("view preset ") + v);
      check(frame.camera().azimuth() != azBefore || frame.camera().elevation() != elBefore,
            "the standard-view button moved the camera", v);
      settle(frame);
    }
  }
  {
    // THE CONTEXT MENU. Right-click over the viewport, which is where a user
    // right-clicks, and where BeginPopupContextItem is now attached.
    FrameItem vp;
    if (findItem("##dock_", "##viewport", vp)) {
      pressItem(frame, vp, ImGuiMouseButton_Right);
      drove("viewport.context_menu");
      checkGe(countItemsIn("##Popup_"), 1u,
              "right-clicking the VIEWPORT opened the context menu", "");
      const std::size_t selBefore = shell.selection().count();
      checkGe(selBefore, 1u, "there is a selection for the context menu to act on", "");
      pressLabelled(shell, frame, "##Popup_", "Clear Selection", "viewport.context_item",
                    "context menu > Clear Selection");
      checkEq(shell.selection().count(), 0u, "the context-menu item cleared the selection", "");
    }
    settle(frame);
  }

  // ── 5. THE FEATURE TREE ──────────────────────────────────────────────────
  // The third shipped defect lived here: the expander called tree_.rebuild()
  // from inside the ImGuiListClipper loop, resizing rows_ while the clipper
  // iterated a range sized from the PREVIOUS rowCount, and the next rowAt()
  // threw std::out_of_range and aborted the process. It is deferred now. Nothing
  // had ever pressed it.
  {
    FrameItem exp;
    const std::size_t rowsBefore = frame.treeRowCount();
    if (!findItem("##tree_rows", "-", exp) && !findItem("##tree_rows", "+", exp)) {
      check(false, "the feature tree drew an expander", "");
    } else {
      // MUTATION 8: the expander is never pressed, so the row count never moves.
      if (g_mutation != 8) {
        ImDrawData* dd = pressItem(frame, exp);
        healthy(shell, frame, dd, "tree expander");
      }
      drove("tree.expander");
      check(frame.treeRowCount() != rowsBefore,
            "the EXPANDER changed the row count -- and the process survived the clipper "
            "range it invalidated",
            std::to_string(rowsBefore) + " -> " + std::to_string(frame.treeRowCount()));
    }
    settle(frame);
  }
  {
    // A tree ROW. Clicking one either picks its face or aims the parameter
    // editor at its statement; both are state changes, and the row is a
    // Selectable inside a virtualized clipper, which is the container the third
    // defect corrupted.
    std::vector<std::string> labels;
    for (const FrameItem& f : g_frameItems) {
      if (!f.reachable() || f.window.find("##tree_rows") == std::string::npos) continue;
      if (f.label.empty() || f.label == "-" || f.label == "+") continue;
      labels.push_back(f.label);
      if (labels.size() >= 4) break;
    }
    checkGe(labels.size(), 1u, "the feature tree drew at least one clickable row", "");
    std::size_t changed = 0;
    for (const std::string& label : labels) {
      FrameItem row;
      // Re-found every time: the previous press rebuilt the frame's item list.
      if (!findItem("##tree_rows", label.c_str(), row)) continue;
      const std::size_t selBefore = shell.selection().count();
      const int editBefore = frame.editFeatureId();
      ImDrawData* dd = pressItem(frame, row);
      drove("tree.row");
      healthy(shell, frame, dd, "tree row " + label);
      if (shell.selection().count() != selBefore || frame.editFeatureId() != editBefore) {
        ++changed;
      }
    }
    checkGe(changed, 1u,
            "clicking a feature-tree row picked its face or aimed the parameter editor", "");
    settle(frame);
  }

  // ── 6. THE PROPERTIES PANEL ──────────────────────────────────────────────
  {
    FrameItem slider;
    if (findItem("##dock_", "##param", slider)) {
      censusOf(slider.id).driven = true;
      pointerTo(slider.x0 + 0.25f * (slider.x1 - slider.x0), slider.centreY());
      step(frame);
      leftButton(true);
      step(frame);
      pointerTo(slider.x0 + 0.75f * (slider.x1 - slider.x0), slider.centreY());
      step(frame);
      ImDrawData* dd = step(frame);
      leftButton(false);
      step(frame);
      drove("properties.param_slider");
      healthy(shell, frame, dd, "properties parameter slider");
      check(censusOf(slider.id).becameActive, "the parameter slider took the drag", "");
    } else {
      check(false, "the Properties panel drew its parameter slider", "");
    }
    settle(frame);
  }
  {
    // The feature-parameter editor: the control that makes the document
    // parametric. Choose a statement in the combo, choose which of its numbers,
    // nudge the value, press Apply -- four widgets, one dispatch through
    // part.edit_feature and the one registry.
    FrameItem combo;
    if (!findItem("##dock_", "##editfeature", combo)) {
      check(false, "the Properties panel drew its feature combo", "");
    } else {
      pressItem(frame, combo);
      drove("properties.feature_combo");
      checkGe(countItemsIn("##Popup_"), 1u, "the feature combo opened its statement list", "");
      // Pick the statement with the MOST numbers, so the radio row below is a
      // real choice rather than a single button.
      FrameItem best;
      bool haveBest = false;
      for (const FrameItem& f : g_frameItems) {
        if (!f.reachable() || f.window.find("##Popup_") == std::string::npos) continue;
        if (f.label.find("RECT") == std::string::npos) continue;
        best = f;
        haveBest = true;
        break;
      }
      if (!haveBest) {
        check(false, "the feature combo offered the RECT statement", "");
        pressEscape(frame);
      } else {
        ImDrawData* dd = pressItem(frame, best);
        drove("properties.feature_option");
        healthy(shell, frame, dd, "feature combo > " + best.label);
        checkGe(frame.editParamCount(), 2u,
                "the chosen statement has more than one editable number", best.label);
      }
    }
    settle(frame);
  }
  {
    pressLabelled(shell, frame, "##dock_", "#2", "properties.param_radio",
                  "properties parameter radio #2");
    checkEq(frame.editParamIndex(), 1u, "the radio button moved the edited parameter", "");
    settle(frame);
  }
  {
    // InputFloat draws a "+" and a "-" step button beside its field. Pressing "+"
    // is the smallest real edit a user can make.
    //
    // The window is looked up from ##editvalue rather than spelled: the feature
    // tree draws SmallButton("+") too, in a different dock window, and a label
    // match alone would press the wrong widget in the wrong panel and then
    // assert on the result -- a green that means nothing.
    const double valueBefore = frame.editParamValue();
    const std::size_t rebuildsBefore = frame.rebuilds();
    FrameItem field;
    if (!findItem("##dock_", "##editvalue", field)) {
      check(false, "the Properties panel drew its value field", "");
    } else {
      const std::string win = field.window;
      pressLabelled(shell, frame, win.c_str(), "+", "properties.value_input",
                    "properties value +");
    }
    pressLabelled(shell, frame, "##dock_", "Apply", "properties.apply", "properties Apply");
    check(frame.editParamValue() != valueBefore,
          "Apply rewrote the statement's number in the DOCUMENT",
          std::to_string(valueBefore) + " -> " + std::to_string(frame.editParamValue()));
    checkGe(frame.rebuilds(), rebuildsBefore + 1, "...and the viewport rebuilt from it", "");
    settle(frame);
  }
  {
    // "Commit snapshot" and "Focus next" are drawn only while something is
    // picked, so the selection is re-made through the viewport first -- itself
    // the second exercise of the pick path.
    FrameItem vp;
    if (findItem("##dock_", "##viewport", vp)) {
      pressItem(frame, vp);
      drove("viewport.pick");
    }
    checkGe(shell.selection().count(), 1u, "a face is picked for the snapshot buttons", "");
    pressLabelled(shell, frame, "##dock_", "Commit snapshot", "properties.commit",
                  "properties Commit snapshot");
    checkGe(shell.selection().committed().size(), 1u, "the button committed the selection", "");
    pressLabelled(shell, frame, "##dock_", "Focus next", "properties.focus_next",
                  "properties Focus next");
    settle(frame);
  }

  // ── 7. ★ THE ARCHIE TOOLS PANEL — the FOURTH mid-walk re-seat ────────────
  // A docked panel that draws one ImGui::Button per registry command. Pressing
  // one calls invoke() from INSIDE the dock walk, and "Next Workspace" ends in
  // ForgeShell::setWorkspace(), whose last line replaces the whole DockLayout --
  // freeing every DockNode drawNode()/drawTabGroup() are holding. Identical to
  // the tab-click crash, in a path no gate had ever pressed.
  {
    shell.setWorkspace(forge::ui::WorkspaceProfile::Archie);
    settle(frame);
    pressLabelled(shell, frame, "##dock_", "Tools", "dock.tab", "raise the Archie Tools tab");
    settle(frame);

    FrameItem q;
    if (findItem("##dock_", "##toolq", q)) {
      const std::size_t rowsBefore = frame.toolRowsDrawn();
      pressItem(frame, q);
      drove("tools.filter_input");
      // MUTATION 11 also lands here: no text is typed, so the catalog cannot
      // narrow and the check below goes red.
      if (g_mutation != 11) typeText(frame, "workspace");
      checkGe(rowsBefore, frame.toolRowsDrawn() + 1u,
              "typing in the tool filter NARROWED the catalog",
              std::to_string(rowsBefore) + " -> " + std::to_string(frame.toolRowsDrawn()));
    } else {
      check(false, "the Archie Tools panel drew its filter field", "");
    }

    // ★ THE GESTURE. MUTATION 9 skips it, which is what "this app is no longer
    // covered against the fourth instance" looks like as a red check.
    const forge::ui::WorkspaceProfile wsBefore = shell.workspace();
    if (g_mutation != 9) {
      pressLabelled(shell, frame, "##tool_rows", "Next Workspace", "tools.command",
                    "Archie Tools > Next Workspace  (the mid-walk re-seat)");
    }
    drove("tools.command");
    check(shell.workspace() != wsBefore,
          "the TOOLS-PANEL button ran workspace.next -- the deferral did not swallow it",
          "");
    checkEq(frame.layoutReseatsDuringWalk(), 0u,
            "...and the layout was NOT re-seated while the dock walk held it", "");
    check(shell.layout().valid(), "the dock tree survived the command dispatched mid-walk", "");
    settle(frame);
    shell.setWorkspace(forge::ui::WorkspaceProfile::Part);
    settle(frame);
  }
}

// Every named surface must have been driven at least once. This is the ratchet:
// a gesture that stops happening -- because a widget moved, a panel stopped
// being drawn, or an early return crept in -- is RED, not quiet.
void checkSurfaceLedger() {
  static const char* const kSurfaces[] = {
      "dock.tab",
      "dock.splitter",
      "menu.top",
      "menu.command",
      "menu.workspace",
      "menu.reset_layout",
      "menu.update_check",
      "menu.input_profile",
      "workspace.tab",
      "toolbar.command",
      "toolbar.palette",
      "status.filter_combo",
      "status.filter_option",
      "viewport.pick",
      "viewport.orbit",
      "viewport.zoom",
      "viewport.view_preset",
      "viewport.context_menu",
      "viewport.context_item",
      "tree.expander",
      "tree.row",
      "properties.param_slider",
      "properties.feature_combo",
      "properties.feature_option",
      "properties.param_radio",
      "properties.value_input",
      "properties.apply",
      "properties.commit",
      "properties.focus_next",
      "tools.filter_input",
      "tools.command",
      "palette.query",
      "palette.row",
  };
  std::printf("\n[gate] interactive surfaces driven:\n");
  for (const char* s : kSurfaces) {
    const std::size_t n = g_surface[s];
    std::printf("  %-26s %zu\n", s, n);
    checkGe(n, 1u, "this interactive surface was driven at least once", s);
  }
  std::printf("[gate] %zu named surfaces\n", sizeof(kSurfaces) / sizeof(kSurfaces[0]));
}

// ── the coverage report ─────────────────────────────────────────────────────
// Printed at the end of EVERY run, red or green, because a number nobody sees is
// a number nobody maintains. Three buckets, and the third one is the point:
//
//   driven      the gate put the pointer on it and pressed
//   responded   ImGui made it the ActiveId -- so it is not just a rectangle
//   untouched   drawn by the application, reached by no gesture in this gate
//
// DISABLED widgets are counted separately and are NOT held against coverage: a
// ribbon button greyed out by BeginDisabled cannot be pressed by a user either,
// so demanding a click on it would be demanding the impossible.
void reportCensus() {
  std::size_t total = 0, reachable = 0, driven = 0, responded = 0, unreachable = 0;
  for (const auto& kv : g_census) {
    ++total;
    if (!kv.second.everEnabled || !kv.second.everVisible) {
      ++unreachable;
      continue;
    }
    ++reachable;
    if (kv.second.driven) ++driven;
    if (kv.second.becameActive) ++responded;
  }
  g_censusReachable = reachable;
  g_censusResponded = responded;
  std::printf("\n[census] %zu distinct interactive widgets submitted by the app\n", total);
  std::printf("[census]   %zu REACHABLE (enabled and on screen at least once); %zu were "
              "disabled or clipped in every frame they appeared\n",
              reachable, unreachable);
  std::printf("[census]   %zu driven by this gate, %zu RESPONDED (ImGui made it the ActiveId)\n",
              driven, responded);
  if (reachable > 0) {
    std::printf("[census]   COVERAGE %.1f%% driven, %.1f%% responded\n",
                100.0 * static_cast<double>(driven) / static_cast<double>(reachable),
                100.0 * static_cast<double>(responded) / static_cast<double>(reachable));
  }
  if (!g_dumpWidgets) return;
  std::printf("[census] --- every reachable widget, and whether a gesture reached it ---\n");
  for (const auto& kv : g_census) {
    if (!kv.second.everEnabled || !kv.second.everVisible) continue;
    std::printf("[census] %-10s %-34s %-30s frames=%zu\n",
                kv.second.becameActive ? "RESPONDED" : (kv.second.driven ? "driven" : "UNTOUCHED"),
                kv.second.window.c_str(), kv.second.label.c_str(), kv.second.frames);
  }
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
    if (std::strcmp(argv[i], "--dump-widgets") == 0) g_dumpWidgets = true;
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
      drove("dock.tab");

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
      drove("dock.splitter");

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
  }

  // ── coverage: what was clicked is what the model said was there ──────────
  std::printf("[gate] %zu workspaces, %zu tabs clicked, %zu splitters dragged, %zu frames "
              "built\n",
              workspacesExercised, tabsClicked, splittersDragged, g_frames);

  // ── PHASE 2: every other interactive surface ─────────────────────────────
  driveEverySurface(shell, frame);
  checkSurfaceLedger();

  checkEq(workspacesExercised, profiles.size(), "every workspace was exercised", "");
  checkEq(tabsClicked, tabsExpected, "every tab in every workspace was clicked", "");
  checkEq(splittersDragged, splittersExpected, "every splitter in every workspace was dragged",
          "");
  checkEq(changingClicks, changingExpected,
          "every click on a non-active tab changed the active tab", "");
  checkGe(changingClicks, 1u, "at least one click was a real state change", "");
  checkGe(g_frames, tabsClicked * 4, "at least four frames were stepped per tab click", "");

  reportCensus();

  std::printf("\n[gate] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures == 0) {
    std::printf("[gate] ALL FORGE DESKTOP CLICK GATES PASS "
                "(headless: no window, no swapchain, no MoltenVK; -fsanitize=address)\n");
    return 0;
  }
  return 1;
}
