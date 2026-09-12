// forge-desktop/test/quit_guard_gate.cpp
//
// THE QUIT GATE — does the application still have your work after you close it?
//
// ── WHAT WAS MEASURED, BEFORE ANY OF THIS EXISTED ──────────────────────────
// A headless probe drove the shipping API on a document holding one unsaved
// `part.fillet`:
//
//   [before] document has 6 features, dirty=YES, path=''
//   [before] requestQuit() -> wantsQuit()=TRUE   (the host loop stops on this)
//   [before] document still dirty after the quit was granted: YES
//   [before] autosave files found: 0 ; session markers found: 0
//
// `Window > Quit`'s entire body was `quit_ = true;`, the window's close box went
// straight to the host loop's `running = false`, and forge::ui::RecoveryService
// -- a complete, gated autosave and crash-recovery engine sitting in
// ui/src/DocumentStore.cpp -- was CONSTRUCTED ZERO TIMES by the application
// (`grep -rn RecoveryService forge-desktop` returned nothing). Every edit since
// the last manual Ctrl+S was discarded, silently, on every close.
//
// ── WHAT THIS GATE ASSERTS, HEADLESS ───────────────────────────────────────
// It drives the REAL quit path -- ForgeFrame::requestQuit(), the same call the
// menu item and the host loop make -- with a real dirty document, and asserts
// the work is still there afterwards, four different ways:
//
//   1. THE GUARD          a dirty document turns the quit into a QUESTION:
//                         wantsQuit() stays false and the prompt is up.
//   2. THE SNAPSHOT       an autosave is on disk BEFORE the question is
//                         answered, so a crash while it stands costs nothing.
//   3. THE RECOVERY       a SECOND session, opened over the same directory
//                         after the first one died, finds that autosave and
//                         reads it back into a live document whose feature-IR
//                         program is byte-identical to the one that was lost.
//   4. THE THREE ANSWERS  Save writes the document and closes; Discard closes
//                         and leaves the file alone; Keep Working closes
//                         nothing. A clean document is never asked at all.
//   5. THE HOST LOOP      main.cpp defines main(), so no gate can link it. It is
//                         READ, and asserted to hand the window's close box to
//                         the guard instead of stopping the loop itself -- half
//                         the measured defect lives on that one line.
//
// ...and the two file commands the same defect report named: Save is dispatchable
// on a document that has NOT changed, and Save As exists and writes a second
// file without disturbing the first.
//
// ── WHAT THE ADVERSARIAL REVIEW OF THE FIRST VERSION ADDED (sections 9-14) ──
// The first version of this change passed every check above and DESTROYED DATA
// the bug it fixed had only failed to save. Sections 9-14 are that review,
// turned into checks:
//
//   9.  THE SNAPSHOT IS THE WHOLE DOCUMENT. autosaveSnapshot() carried the
//       feature tree and the name; documentSave() writes the tree, the name, the
//       MATERIAL and the whole DRAWING. Proved by BYTES: the file Save writes
//       before the crash and the file Save writes after the recovery must be
//       identical.
//   10. AND A RECOVERY MAY NOT WRITE ITS OWN LOSSES INTO THE USER'S FILE.
//       recoverFromAutosave() points documentPath_ at the dead session's real
//       .fpart, dirty -- so one Ctrl+S makes anything the snapshot dropped
//       permanent. Driven three ways: with the drawing's snapshot, without it
//       (the drawing is then taken from the user's own file), and with neither
//       (the path itself is refused).
//   11. THE QUESTION CANNOT OUTLIVE ITS CONDITION. The prompt is a plain window,
//       so Ctrl+S works while it stands; MEASURED, it then held dirty=0 and
//       prompt=1.
//   12. SAVE AS WITH AN EMPTY NAME IS NOT SAVE. `required` is satisfied by a
//       present-and-empty parameter; MEASURED, path="" answered ok and
//       overwrote the open document.
//   13. SAVE AND CLOSE ON A DOCUMENT THAT WAS NEVER SAVED -- the commonest close
//       there is, and the one section 4 does not drive, because there the
//       document already had a name.
//   14. NEW AND OPEN REPLACE A DIRTY DOCUMENT WITHOUT ASKING. Not fixed, and
//       asserted as unfixed, with the snapshot they now take asserted too.
//   15. AND THE CADENCE KEEPS A DRAWING-ONLY EDIT. The other snapshot path:
//       the feature tree's digest does not move when a note is added, so the
//       service declines to rewrite its own autosave and nothing else used to
//       be written at all.
//
// Nothing here needs a window, a swapchain, MoltenVK or a display. The clock is
// the application's own frame time, stepped by this gate, so the autosave cadence
// is a VALUE rather than a wait.
//
// ── PROVING IT CAN FAIL: `--mutate <n>` ────────────────────────────────────
// Each mutation breaks ONE link in the chain from the gesture to the surviving
// work, the way study_gate breaks the set-up its production code is fed:
//
//   1  the recovery session is never opened    -> the measured before-state: the
//      (RecoveryService constructed zero          engine exists and the app does
//      times, exactly as shipped)                 not use it. No autosave, so
//                                                 nothing to recover.
//   2  the answer is recorded and no frame     -> a button that records intent
//      is built                                   nobody applies does nothing
//   3  "Save and Close" is answered with       -> the work never reaches the file
//      Discard
//   4  "Keep Working" is answered with         -> cancel closes the application
//      Discard
//   5  the dead session is closed cleanly      -> its marker and autosave are
//      before the next launch looks               removed, so the next launch
//                                                 cannot see that it died
//   6  the document is never edited, so the    -> the guard is fed a CLEAN
//      guard is asked about a clean part          document: proves the prompt is
//                                                 caused by unsaved work and not
//                                                 by the gesture alone
//   7  Save As is given the path Save already  -> proves "a second file, and the
//      used                                       first one untouched" is a real
//                                                 check and not a tautology
//   8  the drawing's snapshot is deleted       -> the state the first version of
//      from beside the autosave before the        this change shipped in, where
//      next launch looks                          nothing wrote one at all: the
//                                                 note, the title block and the
//                                                 saved bytes all come back wrong
//   9  the drawing is never drawn on, so the   -> proves the annotation checks in
//      user's file has nothing in it to lose      section 10 measure a real note
//                                                 and not an empty count
//  10  the user never saves by hand while the -> the question is then still TRUE,
//      question is up                             and section 11's two assertions
//                                                 must both go red
//  11  Save As is given a real name where the -> proves the refusal is about the
//      gate meant to give none                    EMPTY name and not about Save As
//  12  the file panel answers with a path      -> the application then closes on a
//      where the user cancelled                   cancel, which is the failure
//                                                 section 13c exists for
//  13  the document is never edited before     -> File > New throws nothing away,
//      File > New                                 so there is no snapshot to find
//  14  the drawing is never touched, so there  -> the cadence has nothing to keep,
//      is no drawing-only edit                    and section 15 measures that

#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

// setenv(), for the HOME redirect at the top of main(). Section 13 drives Save
// and Close on a document that has never been saved, which is the one path that
// writes into ~/.forge -- a gate must not do that to the machine it runs on.
#include <stdlib.h>

#include "imgui.h"

#include "FileDialog.hpp"
#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "PartFile.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DocumentModel.hpp"
#include "forge/ui/DocumentStore.hpp"
#include "forge/ui/Drawing.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace {

int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

void check(bool ok, const std::string& what, const std::string& detail = std::string()) {
  ++g_checks;
  if (!ok) {
    ++g_failures;
    std::printf("  FAIL  %-62s  %s\n", what.c_str(), detail.c_str());
  }
}

template <typename A, typename B>
void checkEq(const A& got, const B& want, const std::string& what) {
  ++g_checks;
  if (!(got == static_cast<A>(want))) {
    ++g_failures;
    std::printf("  FAIL  %-62s  got %s want %s\n", what.c_str(), std::to_string(got).c_str(),
                std::to_string(static_cast<A>(want)).c_str());
  }
}

void checkStrEq(const std::string& got, const std::string& want, const std::string& what) {
  ++g_checks;
  if (got != want) {
    ++g_failures;
    std::printf("  FAIL  %-62s\n    got  |%s|\n    want |%s|\n", what.c_str(), got.c_str(),
                want.c_str());
  }
}

// A headless ImGui context: a real context with a NULL renderer backend, which is
// all a frame needs. Same shape as every other desktop gate.
struct HeadlessImGui {
  HeadlessImGui() {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(1600.0f, 1000.0f);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "quit_guard_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int w = 0, h = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &w, &h);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

// One application: its own kernel scene, its own shell, its own frame builder.
// A separate instance per scenario, because a quit is not something you can undo
// and half of what is asserted below is about what a SECOND launch can see.
struct App {
  forge::desktop::KernelScene scene;
  forge::ui::ForgeShell shell;
  std::optional<forge::desktop::ForgeFrame> frame;

  bool start() {
    if (!scene.build()) return false;
    frame.emplace(shell, scene);
    frame->wirePartCommands();
    return true;
  }

  void oneFrame() {
    ImGui::NewFrame();
    frame->build(0, 1.0f);
    ImGui::Render();
  }

  // An edit a user really makes, through the ONE registry, so what this gate
  // drives is what a menu click drives.
  bool fillet() {
    forge::ui::EntityRef body;
    body.bodyId = frame->activeBodyNode();
    body.kind = forge::ui::EntityKind::Edge;
    body.persistentName = "edge@all";
    body.generation = 1;
    shell.selection().replaceWith({body});
    forge::ui::CommandParams params;
    params.setNumber("radius", 2.0);
    const forge::ui::DispatchResult r = shell.run("part.fillet", params);
    return r.ok() && shell.lastDocumentError().empty();
  }

  bool saveTo(const std::string& path) {
    forge::ui::CommandParams params;
    params.setText("path", path);
    const forge::ui::DispatchResult r = shell.run("file.save", params);
    return r.ok() && shell.lastDocumentError().empty();
  }

  // A BARE Ctrl+S: file.save with NO path at all, which is what the keyboard
  // sends -- and what a recovered document is one keystroke away from.
  bool save() {
    const forge::ui::DispatchResult r = shell.run("file.save", forge::ui::CommandParams{});
    return r.ok() && shell.lastDocumentError().empty();
  }

  // The drawing panel's own button, through the one body it calls: a note is a
  // document edit that touches no statement at all.
  bool note(const std::string& text) {
    return frame->drawingAddNote(text, forge::ui::AnnotationKind::Note,
                                 forge::ui::NamedView::Front, false);
  }

  bool setMaterial(const std::string& id) {
    forge::ui::CommandParams params;
    params.setText("material", id);
    const forge::ui::DispatchResult r = shell.run("part.set_material", params);
    return r.ok();
  }
};

// How many features a .fpart on disk actually holds. The file is the claim
// "the work survived", so it is read back through the shipping reader.
long featuresOnDisk(const std::string& path) {
  forge::desktop::PartFileDoc doc;
  std::string error;
  if (!forge::desktop::loadPartFile(path, doc, error)) return -1;
  return static_cast<long>(doc.features.size());
}

// Everything from `//` to the end of each line, removed. A C++ file in this
// repository explains itself at length, so its prose mentions the very
// identifiers a source-reading check is looking for -- in both directions.
std::string stripLineComments(const std::string& code) {
  std::string out;
  out.reserve(code.size());
  std::size_t i = 0;
  while (i < code.size()) {
    if (code[i] == '/' && i + 1 < code.size() && code[i + 1] == '/') {
      while (i < code.size() && code[i] != '\n') ++i;
      continue;
    }
    out.push_back(code[i]);
    ++i;
  }
  return out;
}

std::size_t countSuffix(const std::string& directory, const std::string& suffix) {
  forge::ui::FileSystemStorage storage;
  std::size_t n = 0;
  for (const std::string& entry : storage.list(directory)) {
    if (entry.size() >= suffix.size() &&
        entry.compare(entry.size() - suffix.size(), suffix.size(), suffix) == 0) {
      ++n;
    }
  }
  return n;
}

// Every line of a text, split on '\n'. Used only to NAME the first line at which
// two saved documents differ: a whole .fpart in a failure message is unreadable,
// and "the files differ" is not something a reader can act on.
std::vector<std::string> splitLines(const std::string& text) {
  std::vector<std::string> out;
  std::string line;
  for (const char c : text) {
    if (c == '\n') {
      out.push_back(line);
      line.clear();
      continue;
    }
    line.push_back(c);
  }
  if (!line.empty()) out.push_back(line);
  return out;
}

std::string firstDifference(const std::string& got, const std::string& want) {
  if (got == want) return std::string();
  const std::vector<std::string> a = splitLines(got);
  const std::vector<std::string> b = splitLines(want);
  const std::size_t n = a.size() > b.size() ? a.size() : b.size();
  for (std::size_t i = 0; i < n; ++i) {
    const std::string la = i < a.size() ? a[i] : std::string("<end of file>");
    const std::string lb = i < b.size() ? b[i] : std::string("<end of file>");
    if (la != lb) {
      return "line " + std::to_string(i + 1) + ": got |" + la + "| want |" + lb + "|";
    }
  }
  return "the two files differ in trailing bytes only";
}

std::string readWholeFile(const std::string& path) {
  std::string out;
  std::FILE* f = std::fopen(path.c_str(), "rb");
  if (f == nullptr) return out;
  char buffer[8192];
  std::size_t n = 0;
  while ((n = std::fread(buffer, 1, sizeof buffer, f)) > 0) out.append(buffer, n);
  std::fclose(f);
  return out;
}

// How many ANNOTATIONS a .fpart on disk holds. The drawing is half of what
// documentSave() writes, and until this gate grew a section for it nothing in
// this file ever read one back.
long annotationsOnDisk(const std::string& path) {
  forge::desktop::PartFileDoc doc;
  std::string error;
  if (!forge::desktop::loadPartFile(path, doc, error)) return -1;
  return static_cast<long>(doc.drawing.annotations().size());
}

// Deletes every autosaved DRAWING in a recovery directory, leaving the feature
// tree's autosave and the session marker alone -- the state the application is
// in when an autosave was written by a build that had no drawing snapshot, and
// the state MUTATION 8 puts the gate in deliberately.
std::size_t removeAutosaveDrawings(const std::string& directory) {
  forge::ui::FileSystemStorage storage;
  const std::string suffix = forge::desktop::kAutosaveDrawingSuffix;
  std::size_t removed = 0;
  for (const std::string& entry : storage.list(directory)) {
    if (entry.size() < suffix.size()) continue;
    if (entry.compare(entry.size() - suffix.size(), suffix.size(), suffix) != 0) continue;
    std::string why;
    if (storage.remove(entry, why)) ++removed;
  }
  return removed;
}

// ── the file panel, scripted ────────────────────────────────────────────────
// Save and Close on a document that has never been saved does not end at the
// button: `file.save` has nowhere to put the part, so a panel is owed and the
// close has to WAIT for it. Same shape as forge_desktop_file_dialog_gate's, kept
// to the two fields this gate needs.
class ScriptedDialog final : public forge::desktop::FileDialog {
 public:
  std::vector<forge::desktop::FileDialogRequest> requests;
  bool accept = true;    // false == the user pressed Cancel
  std::string nextPath;  // what they picked when they did not

  forge::desktop::FileDialogResult run(
      const forge::desktop::FileDialogRequest& request) override {
    requests.push_back(request);
    forge::desktop::FileDialogResult out;
    if (!accept) return out;  // a cancel is a VALUE, and it is a no-op
    out.accepted = true;
    out.path = nextPath;
    return out;
  }
};

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[quit-gate] MUTATION %d ACTIVE\n", g_mutation);

  const char* tmp = std::getenv("TMPDIR");
  std::string root = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!root.empty() && root.back() == '/') root.pop_back();
  root += "/forge_quit_guard_gate";
  std::error_code ec;
  std::filesystem::remove_all(root, ec);  // a rerun must not inherit yesterday's evidence
  std::filesystem::create_directories(root, ec);
  const std::string recoveryDir = root + "/recovery";
  std::printf("[quit-gate] working in %s\n", root.c_str());

  // ── THIS GATE MUST NOT TOUCH THE USER'S OWN FILES ───────────────────────
  // Section 13 drives Save and Close on a document that has never been saved,
  // and documentSave() puts one in $HOME/.forge/<name>.fpart -- the application's
  // documented behaviour for a bare Ctrl+S with nowhere to go. HOME is
  // redirected for THIS PROCESS ONLY (the same fix, and the same reason, as
  // forge_desktop_click_gate's), and `.forge` is created inside it because
  // documentSave() writes into that directory and does not create it.
  const std::string fakeHome = root + "/home";
  std::filesystem::create_directories(fakeHome + "/.forge", ec);
  if (::setenv("HOME", fakeHome.c_str(), 1) != 0) {
    std::printf("[quit-gate] could not redirect HOME; refusing to write into the real one\n");
    return 1;
  }
  std::printf("[quit-gate] HOME redirected to %s for this process\n", fakeHome.c_str());

  HeadlessImGui imgui;

  // ═══ 1. THE GUARD, AND THE SNAPSHOT THAT COMES BEFORE THE QUESTION ═══════
  std::printf("\n-- 1. a dirty document turns Quit into a question ---------------------\n");
  App a;
  check(a.start(), "the starting part builds and the frame wires up", a.scene.error());
  if (!a.frame) {
    std::printf("[quit-gate] cannot continue without an application\n");
    return 1;
  }

  // MUTATION 1: the application as it SHIPPED -- the autosave engine exists in
  // ui/src and nothing constructs it.
  // ★ EVERY EXPECTATION BELOW IS THE TRUE ONE, WHATEVER THE MUTATION SAYS.
  // Writing `g_mutation == 1 ? 0 : 1` here was tried first and it made mutations
  // 1 and 5 STAY GREEN: a check that adjusts itself to the defect is agreeing
  // with the defect, which is the unfalsifiable-gate failure this repository has
  // shipped before. A mutation breaks the SET-UP; the assertions do not move.
  const bool autosaveOn = (g_mutation != 1) && a.frame->beginRecoverySession(recoveryDir);
  check(autosaveOn, "the recovery session opened", "beginRecoverySession(" + recoveryDir + ")");
  check(a.frame->recovery() != nullptr,
        "forge::ui::RecoveryService is CONSTRUCTED by the application", "it was not");
  checkEq(countSuffix(recoveryDir, forge::ui::kSessionMarkerSuffix), 1u,
          "a live session leaves exactly one marker on disk");

  const std::size_t seeded = a.frame->document().records().size();
  // MUTATION 6: never edit, so the guard is asked about a CLEAN document. Every
  // check below that says "the quit was stopped" must then go red -- which is
  // what proves the prompt is caused by unsaved work and not by the gesture.
  if (g_mutation != 6) check(a.fillet(), "an edit a user really makes was dispatched");
  checkEq(a.frame->document().records().size(), seeded + 1, "the edit is in the document");
  check(a.frame->documentDirty(), "the document has unsaved work in it",
        a.frame->documentDirty() ? "dirty" : "clean");
  checkStrEq(a.frame->documentPath(), std::string(),
             "this part has never been saved anywhere");

  const std::string programAtQuit = a.frame->document().irProgram();

  // THE REAL QUIT PATH. The same call Window > Quit makes, and the same call the
  // host loop makes when the window's close box is clicked.
  a.frame->requestQuit();

  check(!a.frame->wantsQuit(),
        "THE QUIT WAS STOPPED: the host loop is not told to close",
        a.frame->wantsQuit() ? "wantsQuit() is TRUE with unsaved work in the document" : "");
  check(a.frame->quitPromptOpen(), "the unsaved-changes question is on screen",
        "no prompt was raised");
  checkEq(a.frame->quitPromptsRaised(), 1u, "the guard recorded that it stopped one quit");
  check(a.frame->documentDirty(), "the work is still in the document");

  // THE SNAPSHOT, taken BEFORE the question was asked. This is what makes a
  // crash while the prompt stands cost nothing.
  checkEq(countSuffix(recoveryDir, forge::ui::kAutosaveSuffix), 1u,
          "an autosave is on disk BEFORE the user has answered");
  if (autosaveOn) {
    const forge::ui::RecoveryStats& stats = a.frame->recovery()->stats();
    checkEq(stats.autosavesWritten, 1u, "the service wrote exactly one autosave");
    check(stats.autosaveFailures == 0u, "no autosave failed", stats.lastError);
  }

  // A frame still builds, with the question in it, and the application is alive.
  a.oneFrame();
  check(a.frame->quitPromptOpen(), "the question is still up after a frame");
  check(!a.frame->wantsQuit(), "a drawn frame did not quietly grant the quit");

  // ═══ 2. THE NEXT LAUNCH FINDS THE WORK ══════════════════════════════════
  //
  // The session above is now ABANDONED -- nothing ends it, which is exactly what
  // a crash looks like. A second application opens over the same directory.
  std::printf("\n-- 2. a session that died, recovered by the next one ------------------\n");
  // MUTATION 5: the dying session closes cleanly anyway, removing its own
  // evidence. The next launch then has nothing to find.
  if (g_mutation == 5) a.frame->endRecoverySession();

  App b;
  check(b.start(), "a second application starts", b.scene.error());
  const bool secondSession = (g_mutation != 1) && b.frame->beginRecoverySession(recoveryDir);
  const std::vector<forge::ui::RecoveryCandidate> dead =
      secondSession ? b.frame->recoverableSessions()
                    : std::vector<forge::ui::RecoveryCandidate>{};
  checkEq(dead.size(), 1u, "the next launch sees exactly the session that did not end");
  if (!dead.empty()) {
    check(dead[0].hasAutosave, "that session left an autosave to recover", dead[0].sessionId);
    std::string error;
    const bool recovered = b.frame->recoverFromAutosave(dead[0], error);
    check(recovered, "the autosave READ BACK into a live document", error);
    if (recovered) {
      // ★ THE CLAIM OF THIS WHOLE GATE. Not "a file exists" and not "a count
      // matches": the recovered document spells the SAME feature-IR program,
      // statement for statement, as the one that was about to be thrown away.
      checkStrEq(b.frame->document().irProgram(), programAtQuit,
                 "THE WORK SURVIVED: the recovered program is the lost one");
      checkEq(b.frame->document().records().size(), seeded + 1,
              "every statement came back");
      check(b.frame->documentDirty(),
            "recovered work is NOT saved work -- the document is still dirty");
      check(b.scene.lastBuild().ok(), "the recovered document rebuilt into a real solid",
            b.scene.lastBuild().error);
    }
  }
  b.frame->endRecoverySession();

  // ═══ 3. KEEP WORKING ════════════════════════════════════════════════════
  std::printf("\n-- 3. Keep Working keeps working -------------------------------------\n");
  {
    const std::size_t records = a.frame->document().records().size();
    // MUTATION 4: cancel wired to the destructive answer.
    if (g_mutation == 4) {
      a.frame->answerQuitDiscard();
    } else {
      a.frame->answerQuitCancel();
    }
    a.oneFrame();
    check(!a.frame->wantsQuit(), "cancelling a close does not close the application");
    check(!a.frame->quitPromptOpen(), "the question is gone once it is answered");
    checkEq(a.frame->document().records().size(), records, "the document is untouched");
    check(a.frame->documentDirty(), "and the unsaved work is still unsaved");
  }

  // ═══ 4. SAVE AND CLOSE ══════════════════════════════════════════════════
  std::printf("\n-- 4. Save and Close writes the work and then closes ------------------\n");
  const std::string partPath = root + "/bracket.fpart";
  {
    check(a.saveTo(partPath), "the part is given a name", a.shell.lastDocumentError());
    checkStrEq(a.frame->documentPath(), partPath, "the document now lives in a file");
    check(!a.frame->documentDirty(), "saving cleared the unsaved-work flag");
    const long onDiskBefore = featuresOnDisk(partPath);
    checkEq(onDiskBefore, static_cast<long>(seeded + 1), "the file holds what was in the part");

    // ...and now the user edits again and closes without saving by hand. This is
    // the exact sequence that used to lose the edit.
    check(a.fillet(), "a second edit, after the save");
    check(a.frame->documentDirty(), "the part is dirty again");
    a.frame->requestQuit();
    check(!a.frame->wantsQuit(), "the guard stopped this quit too");
    checkEq(a.frame->quitPromptsRaised(), 2u, "two quits stopped in this session");

    // MUTATION 3: the Save button wired to the Discard answer.
    if (g_mutation == 3) {
      a.frame->answerQuitDiscard();
    } else {
      a.frame->answerQuitSave();
    }
    // MUTATION 2: the answer is recorded and no frame is built, so nothing
    // applies it -- a button that does nothing.
    if (g_mutation != 2) a.oneFrame();

    check(a.frame->wantsQuit(), "the application closed once the question was answered");
    check(!a.frame->documentDirty(), "nothing is left unsaved");
    checkEq(featuresOnDisk(partPath), static_cast<long>(seeded + 2),
            "THE SECOND EDIT REACHED THE FILE ON DISK");
    // A clean exit removes the evidence: whatever is left in the recovery
    // directory after this belongs to a session that died.
    checkEq(countSuffix(recoveryDir, forge::ui::kAutosaveSuffix), 0u,
            "a clean exit took its autosave with it");
    checkEq(countSuffix(recoveryDir, forge::ui::kSessionMarkerSuffix), 0u,
            "a clean exit took its session marker with it");
  }

  // ═══ 5. CLOSE WITHOUT SAVING, AND A CLEAN DOCUMENT ══════════════════════
  std::printf("\n-- 5. Discard is the only answer that loses anything ------------------\n");
  const std::string discardPath = root + "/discard.fpart";
  {
    App c;
    check(c.start(), "a third application starts", c.scene.error());
    check(c.fillet(), "an edit");
    check(c.saveTo(discardPath), "saved to a file", c.shell.lastDocumentError());
    const long kept = featuresOnDisk(discardPath);
    checkEq(kept, static_cast<long>(seeded + 1), "the file holds the saved part");

    // A CLEAN document is never asked. Nagging a user who has nothing to lose is
    // how a guard gets turned off.
    c.frame->requestQuit();
    check(!c.frame->quitPromptOpen(), "a clean document is not asked about");
    check(c.frame->wantsQuit(), "a clean document closes immediately");
    checkEq(c.frame->quitPromptsRaised(), 0u, "no question was raised for a clean part");
  }
  {
    App d;
    check(d.start(), "a fourth application starts", d.scene.error());
    check(d.fillet(), "an edit nobody will save");
    d.frame->requestQuit();
    check(d.frame->quitPromptOpen(), "the guard asked");
    d.frame->answerQuitDiscard();
    d.oneFrame();
    check(d.frame->wantsQuit(), "Close Without Saving closes");
    // The file the user did NOT save into is untouched: discarding loses the
    // edit and nothing else.
    checkEq(featuresOnDisk(discardPath), static_cast<long>(seeded + 1),
            "discarding did not write over anybody's file");
  }

  // ═══ 6. SAVE ON A CLEAN DOCUMENT, AND SAVE AS ═══════════════════════════
  std::printf("\n-- 6. Save is reachable on a clean part, and Save As exists -----------\n");
  {
    App e;
    check(e.start(), "a fifth application starts", e.scene.error());
    const std::string first = root + "/first.fpart";
    const std::string second = root + "/second.fpart";
    check(e.fillet(), "an edit");
    check(e.saveTo(first), "saved once", e.shell.lastDocumentError());
    check(!e.frame->documentDirty(), "the document is clean");

    // ── SAVE, ON A DOCUMENT THAT HAS NOT CHANGED ────────────────────────
    // `file.save`'s enabled predicate used to be `doc_.dirty`, so this was
    // DISABLED -- a saved part could not be written anywhere, by any gesture,
    // including into a new name.
    const forge::ui::DispatchResult evaluated =
        e.shell.registry().evaluate("file.save", e.shell.selection(), forge::ui::CommandParams{});
    check(evaluated.status != forge::ui::DispatchStatus::Disabled,
          "Save is OFFERED on a document with no unsaved changes",
          forge::ui::machineName(evaluated.status));
    check(e.saveTo(first), "and a clean document really saves",
          e.shell.lastDocumentError());

    // ── SAVE AS ──────────────────────────────────────────────────────────
    const forge::ui::CommandDescriptor* saveAs = e.shell.registry().find("file.save_as");
    check(saveAs != nullptr, "file.save_as is a registered command");
    if (saveAs != nullptr) {
      checkStrEq(saveAs->category, std::string("File"), "Save As is in the File menu");
      bool requiresPath = false;
      for (const forge::ui::ParamSpec& p : saveAs->schema) {
        if (p.name == "path" && p.required) requiresPath = true;
      }
      check(requiresPath, "Save As REQUIRES a name -- Save As without one is Save");
      // The native panel has to be able to answer it, or the command is
      // unreachable with a mouse.
      forge::desktop::FileDialogPolicy policy;
      check(forge::desktop::fileDialogPolicyFor("file.save_as", policy),
            "a file panel opens for Save As");
      check(policy.mode == forge::desktop::FileDialogMode::Save, "and it is a SAVE panel");
    }
    forge::ui::CommandParams params;
    // MUTATION 7: Save As aimed at the file Save already wrote.
    params.setText("path", g_mutation == 7 ? first : second);
    const forge::ui::DispatchResult r = e.shell.run("file.save_as", params);
    check(r.ok() && e.shell.lastDocumentError().empty(), "Save As dispatched",
          forge::ui::machineName(r.status) + std::string(" ") + e.shell.lastDocumentError());
    checkStrEq(e.frame->documentPath(), second,
               "the document now IS the new file -- the next Save goes there");
    checkEq(featuresOnDisk(second), static_cast<long>(seeded + 1),
            "Save As wrote the part to the new name");
    checkEq(featuresOnDisk(first), static_cast<long>(seeded + 1),
            "and the file it came from is still there, unchanged");
    // The two are different files, which `documentPath()` alone cannot say.
    check(std::filesystem::exists(first) && std::filesystem::exists(second) && first != second,
          "two files, not one renamed");
  }

  // ═══ 7. THE HOST LOOP, WHICH NO BINARY CAN LINK ═════════════════════════
  //
  // Half of the measured defect is in main.cpp: the window's close box latched
  // PlatformSDL2::quit_ and the loop turned it straight into `running = false`,
  // so Cmd-Q and the red button bypassed the frame builder entirely. main.cpp
  // defines main(), so no gate can link it and nothing here can execute that
  // line -- reading the file is the only way to bind the guard to its caller,
  // which is the same argument forge_desktop_imgui_recovery_gate's section F
  // makes for the error policy.
  std::printf("\n-- 7. the window's close box goes through the guard -------------------\n");
  {
    std::string repoRoot;
    if (const char* env = std::getenv("FORGE_DESKTOP_ROOT"); env != nullptr && *env != '\0') {
      repoRoot = env;
    } else {
#ifdef FORGE_DESKTOP_REPO_ROOT
      repoRoot = FORGE_DESKTOP_REPO_ROOT;
#endif
    }
    const std::string mainPath = repoRoot + "/forge-desktop/src/main.cpp";
    std::string code;
    {
      std::FILE* f = std::fopen(mainPath.c_str(), "rb");
      if (f != nullptr) {
        char buffer[8192];
        std::size_t n = 0;
        while ((n = std::fread(buffer, 1, sizeof buffer, f)) > 0) code.append(buffer, n);
        std::fclose(f);
      }
    }
    // A check that cannot read its subject must be RED, not quietly green.
    check(!code.empty(), "the application's entry point is readable", mainPath);
    if (!code.empty()) {
      // COMMENTS STRIPPED FIRST, and this is not tidiness. main.cpp explains the
      // change by QUOTING the line it replaced, so a raw text search found the
      // old disjunction in a comment and called the fix absent -- and the
      // reverse mistake is the dangerous one: a positive check satisfied by a
      // sentence describing code that is not there. Only executable text counts.
      const std::string source = stripLineComments(code);
      const auto has = [&source](const char* needle) {
        return source.find(needle) != std::string::npos;
      };
      check(has("frame.requestQuit()"),
            "the host loop asks the GUARD, it does not close by itself", mainPath);
      check(has("platform.clearQuitRequest()"),
            "and it TAKES the latched close request rather than only reading it", mainPath);
      // THE LINE THAT WAS THERE. A disjunction here means the close box can end
      // the process without the frame builder ever seeing it.
      check(!has("platform.quitRequested() || frame.wantsQuit()"),
            "the close box no longer bypasses the frame builder",
            "main.cpp still stops the loop on platform.quitRequested() directly");
      check(has("frame.beginRecoverySession("),
            "the application CONSTRUCTS the recovery service", mainPath);
      check(has("frame.endRecoverySession()"),
            "and closes the session on the way out, so a leftover marker means a crash",
            mainPath);
    }
  }

  // ═══ 8. WHAT AN AUTOSAVE IS, STATED RATHER THAN ASSUMED ═════════════════
  //
  // The autosave is written by forge::ui, in the DocumentModel dialect, which
  // declares itself `FORGE-PART 2`. forge::desktop's own reader accepts {1, 3}
  // and REFUSES 2 by number, on purpose (see PartFile.hpp). So an autosave is
  // NOT something a user can reach with File > Open, and the only way back is
  // ForgeFrame::recoverFromAutosave(), which section 2 above drives. This is
  // pinned so that nobody later reads "it is a plain .fpart" and believes the
  // application can open one.
  std::printf("\n-- 8. an autosave is a forge::ui document, not a desktop one ----------\n");
  {
    check(!forge::desktop::partFileVersionIsReadable(forge::ui::kDocumentFormatVersion),
          "the desktop reader REFUSES the dialect the autosave is written in",
          "kDocumentFormatVersion = " + std::to_string(forge::ui::kDocumentFormatVersion));
    check(forge::desktop::partFileVersionIsReadable(forge::desktop::kPartFileVersion),
          "while it reads its own");
  }


  // ═══ 9. EVERYTHING documentSave() WRITES HAS TO CROSS THE AUTOSAVE ══════
  //
  // ★ THE DEFECT THIS SECTION EXISTS FOR WAS IN THE FIRST VERSION OF THIS VERY
  //   CHANGE. ForgeFrame::autosaveSnapshot() copied TWO things -- the feature
  //   tree and the name -- while documentSave() writes capturePartDocument(
  //   partDoc_, documentName_, drawing_): the tree, the name, the MATERIAL, and
  //   the whole DRAWING (title block, datums, notes, geometric tolerances).
  //   Eight document operations mark a document dirty by touching the drawing
  //   alone, so the autosave dropped exactly the work it existed to keep.
  //
  // The check is NOT an annotation count. It is the BYTES: the same document is
  // written by documentSave() before the session dies, and written again by the
  // same function after the next session recovers it, and the two files must be
  // IDENTICAL. Anything the snapshot drops -- a note, a datum, a tolerance
  // frame, the material, a node binding -- is a difference, whether or not
  // anybody thought to assert on it.
  std::printf("\n-- 9. the file Save writes survives a crash, byte for byte ------------\n");
  const std::string recoveryDir9 = root + "/recovery-drawing";
  const std::string refPath = root + "/ref/part.fpart";
  // The SAME LEAF NAME on purpose: the document's name is stored IN the file, so
  // two different names would make the comparison below fail for a reason that
  // has nothing to do with what crossed the autosave.
  const std::string cmpPath = root + "/cmp/part.fpart";
  std::filesystem::create_directories(root + "/ref", ec);
  std::filesystem::create_directories(root + "/cmp", ec);
  std::string referenceBytes;
  {
    App f;
    check(f.start(), "an application whose document also carries a DRAWING", f.scene.error());
    check(f.frame->beginRecoverySession(recoveryDir9), "its recovery session opened",
          recoveryDir9);
    check(f.fillet(), "a modelling edit");
    check(f.note("MACHINE ALL OVER 1.6 Ra"), "a note the user typed onto the sheet",
          f.frame->noteRefusal());
    check(f.setMaterial("aluminium-6061"), "the part is made of something");
    forge::ui::TitleBlockData& block = f.frame->drawing().titleBlock();
    block.partNumber = "BRK-1042";
    block.revision = "C";
    block.title = "MOUNTING BRACKET";
    checkEq(f.frame->drawing().annotations().size(), 1u, "the drawing holds the note");

    // THE SNAPSHOT, of a document carrying all four kinds of content.
    check(f.frame->autosaveNow(), "the autosave was written");
    // ...and the file documentSave() writes for that same document, which has not
    // changed since. This is the reference the recovery is measured against.
    check(f.saveTo(refPath), "and Save wrote the reference file",
          f.shell.lastDocumentError());
    referenceBytes = readWholeFile(refPath);
    check(!referenceBytes.empty(), "the reference file has bytes in it", refPath);
    checkEq(annotationsOnDisk(refPath), 1L, "the note is IN the file Save wrote");
    // The session dies here. Nothing ends it.
  }
  {
    App g;
    check(g.start(), "the next launch", g.scene.error());
    check(g.frame->beginRecoverySession(recoveryDir9), "its own session opened");
    // MUTATION 8: THE DRAWING NEVER CROSSED. The snapshot of the drawing is
    // deleted from beside the autosave before this launch looks -- which is
    // precisely the state the first version of this change shipped in, where
    // nothing wrote one at all. Every check below about the drawing must go red.
    if (g_mutation == 8) removeAutosaveDrawings(recoveryDir9);
    const std::vector<forge::ui::RecoveryCandidate> dead9 = g.frame->recoverableSessions();
    checkEq(dead9.size(), 1u, "it sees the session that died with a drawing open");
    if (!dead9.empty()) {
      std::string why;
      check(g.frame->recoverFromAutosave(dead9[0], why), "the autosave read back", why);
      checkEq(g.frame->drawing().annotations().size(), 1u,
              "THE NOTE CAME BACK: the drawing crossed the autosave");
      checkStrEq(g.frame->drawing().titleBlock().partNumber, std::string("BRK-1042"),
                 "and the title block came with it");
      checkStrEq(g.frame->document().material().id, std::string("aluminium-6061"),
                 "and the MATERIAL -- the other thing Save writes and the snapshot dropped");
      check(g.saveTo(cmpPath), "the recovered document is saved by the same function",
            g.shell.lastDocumentError());
      const std::string recoveredBytes = readWholeFile(cmpPath);
      check(recoveredBytes == referenceBytes,
            "★ THE SNAPSHOT CARRIES EVERYTHING documentSave() WRITES",
            firstDifference(recoveredBytes, referenceBytes));
    }
    g.frame->endRecoverySession();
  }

  // ═══ 10. A RECOVERY MUST NOT WRITE ITS OWN LOSSES INTO THE USER'S FILE ══
  //
  // ★ THE SERIOUS ONE, and the reason section 9 is not enough on its own.
  //   recoverFromAutosave() points documentPath_ at the dead session's REAL
  //   .fpart and marks the document dirty. The very next Ctrl+S -- one
  //   keystroke, no panel, no confirmation -- therefore writes the recovered
  //   document OVER the user's own file, and everything the snapshot dropped is
  //   DELETED FROM DISK by the feature that exists to prevent loss. MEASURED on
  //   the first version of this change: a file holding 6 features and 1
  //   annotation recovered with 0 annotations, and a bare Ctrl+S made that
  //   permanent. The bug it was fixing only ever FAILED TO SAVE work; this
  //   destroyed work that was already on disk.
  std::printf("\n-- 10. recovery + one Ctrl+S must not blank the user's own file -------\n");
  std::filesystem::create_directories(root + "/user", ec);

  // Leaves a DEAD session behind over `path`: the user's file is saved (with a
  // note in it), one further edit is made that never reaches the file, the quit
  // is requested so the snapshot is taken, and the session is abandoned. Returns
  // how many features the user's FILE holds at that point.
  //
  // One application object serves all three scenarios below: each call points it
  // at a fresh recovery directory, which mints a new session id and a new marker
  // and abandons the previous session exactly as a crash abandons it.
  auto dieOver = [&](App& app, const std::string& dir, const std::string& path) -> long {
    check(app.saveTo(path), "the user saves their own file", app.shell.lastDocumentError());
    const long onDisk = featuresOnDisk(path);
    check(app.frame->beginRecoverySession(dir), "a recovery session over that document", dir);
    check(app.fillet(), "one more edit, which never reaches the file");
    app.frame->requestQuit();
    check(app.frame->quitPromptOpen(), "the guard asked");
    checkEq(countSuffix(dir, forge::ui::kAutosaveSuffix), 1u, "and the snapshot is on disk");
    app.frame->answerQuitCancel();
    app.oneFrame();
    return onDisk;
  };

  // Recovers the one dead session in `dir` into `app`. Returns false when there
  // was nothing to recover, so the caller's own checks are not run on a document
  // that was never replaced.
  auto recoverOne = [&](App& app, const std::string& dir) -> bool {
    check(app.frame->beginRecoverySession(dir), "the next launch opens its own session", dir);
    const std::vector<forge::ui::RecoveryCandidate> dead = app.frame->recoverableSessions();
    checkEq(dead.size(), 1u, "exactly one session did not end");
    if (dead.empty()) return false;
    std::string why;
    const bool ok = app.frame->recoverFromAutosave(dead[0], why);
    check(ok, "the autosave read back into a live document", why);
    return ok;
  };

  App dying;
  check(dying.start(), "an application that will die three times", dying.scene.error());
  App living;
  check(living.start(), "and one that keeps finding what it left", living.scene.error());

  // ── 10a. THE ORDINARY CASE ──────────────────────────────────────────────
  {
    const std::string userPath = root + "/user/bracket.fpart";
    const std::string dir = root + "/recovery-user";
    check(dying.fillet(), "a modelling edit");
    // MUTATION 9: the drawing is never drawn on, so the file the user saves has
    // nothing in it to destroy and every check about the note must go red.
    if (g_mutation != 9) {
      check(dying.note("DEBURR ALL EDGES"), "a note on the sheet", dying.frame->noteRefusal());
    }
    const long saved = dieOver(dying, dir, userPath);
    checkEq(annotationsOnDisk(userPath), 1L, "the user's file holds the note they wrote");

    if (recoverOne(living, dir)) {
      checkStrEq(living.frame->documentPath(), userPath,
                 "the recovered document points at the user's OWN file");
      check(living.frame->documentDirty(), "and it is dirty: one keystroke writes it there");
      checkEq(living.frame->drawing().annotations().size(), 1u,
              "the drawing came back with it");
      // THE KEYSTROKE. No path, no panel, no confirmation -- file.save exactly as
      // the keyboard sends it.
      check(living.save(), "a bare Ctrl+S", living.shell.lastDocumentError());
      checkStrEq(living.frame->documentPath(), userPath, "went to the user's file");
      checkEq(featuresOnDisk(userPath), saved + 1, "the recovered work reached it");
      checkEq(annotationsOnDisk(userPath), 1L,
              "★ AND THE USER'S ANNOTATION IS STILL IN THEIR FILE");
    }
  }

  // ── 10b. AN AUTOSAVE WITH NO DRAWING BESIDE IT ──────────────────────────
  // The drawing's snapshot can be missing for reasons the application does not
  // control: an autosave written by a build that had none, a half-deleted
  // recovery directory, a disk that filled between the two writes. The recovery
  // must STILL not be able to blank the drawing in the file it is about to point
  // at, so with no snapshot of the drawing it reads the one in the USER'S OWN
  // FILE. That is the last SAVED drawing rather than the newest -- but it is the
  // user's, and an empty one is nobody's.
  {
    const std::string userPath = root + "/user/no-sidecar.fpart";
    const std::string dir = root + "/recovery-no-sidecar";
    const long saved = dieOver(dying, dir, userPath);
    checkEq(annotationsOnDisk(userPath), 1L, "the user's file holds a note");
    checkEq(removeAutosaveDrawings(dir), 1u, "the drawing's snapshot is deleted");
    if (recoverOne(living, dir)) {
      checkStrEq(living.frame->documentPath(), userPath, "the document still points at the file");
      checkEq(living.frame->drawing().annotations().size(), 1u,
              "the drawing came from the USER'S FILE, since the snapshot had none");
      check(living.save(), "a bare Ctrl+S", living.shell.lastDocumentError());
      checkEq(featuresOnDisk(userPath), saved + 1, "the recovered work reached the file");
      checkEq(annotationsOnDisk(userPath), 1L, "and the note is still there");
    }
  }

  // ── 10c. NO DRAWING SNAPSHOT, AND NO FILE TO READ ONE FROM ──────────────
  // Now there is no honest way to know what the drawing was. Adopting the path
  // anyway is the destructive answer, so the recovery REFUSES the path instead:
  // the work is still recovered, but the document is untitled and Save cannot
  // reach the user's file without them naming it.
  {
    const std::string userPath = root + "/user/gone.fpart";
    const std::string dir = root + "/recovery-gone";
    dieOver(dying, dir, userPath);
    checkEq(removeAutosaveDrawings(dir), 1u, "the drawing's snapshot is deleted");
    std::filesystem::remove(userPath, ec);
    check(!std::filesystem::exists(userPath), "and the user's file is gone too");
    if (recoverOne(living, dir)) {
      checkStrEq(living.frame->documentPath(), std::string(),
                 "the recovery REFUSES a file whose drawing it cannot account for");
      check(living.save(), "a bare Ctrl+S", living.shell.lastDocumentError());
      check(!std::filesystem::exists(userPath),
            "so the keystroke did NOT recreate the user's file from a half-document",
            userPath);
    }
  }
  living.frame->endRecoverySession();

  // ═══ 11. THE QUESTION CANNOT OUTLIVE THE THING IT ASKS ABOUT ════════════
  //
  // The unsaved-changes prompt is a plain window and not a modal, deliberately:
  // the user may want to look at the part they are being asked about. That means
  // every other gesture still works while it stands -- including Ctrl+S. Nothing
  // re-read documentDirty_ afterwards, so MEASURED: save by hand with the
  // question up and the application held dirty=0 and prompt=1, a window insisting
  // on unsaved changes that no longer existed.
  std::printf("\n-- 11. saving by hand takes the question away -------------------------\n");
  {
    App j;
    check(j.start(), "an application with unsaved work", j.scene.error());
    check(j.fillet(), "an edit");
    j.frame->requestQuit();
    check(j.frame->quitPromptOpen(), "the guard asked");
    // MUTATION 10: the save never happens, so the question is still TRUE and both
    // assertions below must go red.
    if (g_mutation != 10) {
      check(j.saveTo(root + "/answered.fpart"), "the user saves BY HAND, question still up",
            j.shell.lastDocumentError());
    }
    j.oneFrame();
    check(!j.frame->documentDirty(), "there are no unsaved changes any more");
    check(!j.frame->quitPromptOpen(),
          "so the question is GONE -- it cannot go on claiming otherwise");
    check(!j.frame->wantsQuit(),
          "and it did not close the application behind the user's back");
    // The counter, because "it withdrew" and "it was never raised" are two
    // different things and quitPromptOpen() answers false for both.
    checkEq(j.frame->quitPromptsRaised(), 1u, "the question WAS raised");
    checkEq(j.frame->quitPromptsWithdrawn(), 1u, "and it is recorded as WITHDRAWN, not answered");
  }

  // ═══ 12. SAVE AS WITH NO NAME IS NOT A SILENT SAVE ══════════════════════
  //
  // `path` is declared required on file.save_as, and a required parameter is
  // satisfied by one that is PRESENT AND EMPTY -- CommandRegistry::evaluate asks
  // `params.has(name)` and nothing more. So "" reached the shared handler, where
  // `path.empty() ? documentPath_ : path` turned Save As into Save. MEASURED: no
  // path at all was correctly refused; path="" answered ok and OVERWROTE the
  // open document.
  std::printf("\n-- 12. Save As with an empty name refuses -----------------------------\n");
  {
    App k;
    check(k.start(), "an application with a named document", k.scene.error());
    const std::string named = root + "/named.fpart";
    check(k.fillet(), "an edit");
    check(k.saveTo(named), "saved once, under a name", k.shell.lastDocumentError());
    const long onDisk = featuresOnDisk(named);
    check(k.fillet(), "a second edit that is NOT saved");
    forge::ui::CommandParams params;
    // MUTATION 11: a real name where the gate meant to give none, which must turn
    // every check below red -- Save As with a name is supposed to work.
    params.setText("path", g_mutation == 11 ? (root + "/eleven.fpart") : std::string());
    const forge::ui::DispatchResult r = k.shell.run("file.save_as", params);
    check(!(r.ok() && k.shell.lastDocumentError().empty()),
          "Save As with an empty name REFUSES", forge::ui::machineName(r.status));
    check(!k.shell.lastDocumentError().empty(), "and says why in the user's own words",
          k.shell.lastDocumentError());
    check(k.frame->documentDirty(), "the document is still unsaved -- it did not quietly save");
    checkEq(featuresOnDisk(named), onDisk, "and it did NOT overwrite the open document");
  }

  // ═══ 13. SAVE AND CLOSE ON A PART THAT WAS NEVER SAVED ══════════════════
  //
  // THE COMMONEST CLOSE THERE IS, and the one section 4 does not drive: there,
  // the document already had a name, so `file.save` finished inside
  // applyPendingQuitAnswer() and the close completed on the same line. Here it
  // has nowhere to put the part, so the answer to the question is NOT finished
  // when the button is clicked -- either a file panel is owed and
  // resolveQuitAfterSave() must wait for it, or the application falls back to the
  // directory it owns.
  std::printf("\n-- 13. Save and Close on a document with no name ----------------------\n");
  {
    // (a) NO PANEL -- every headless build, and any platform this application has
    // no native picker for. documentSave() writes $HOME/.forge/<name>.fpart; HOME
    // is this gate's own directory, redirected at the top of main().
    App l;
    check(l.start(), "an application whose part has never been saved", l.scene.error());
    check(l.fillet(), "an edit");
    checkStrEq(l.frame->documentPath(), std::string(), "it has no name yet");
    l.frame->requestQuit();
    check(l.frame->quitPromptOpen(), "the guard asked about a part with no name");
    l.frame->answerQuitSave();
    l.oneFrame();
    check(l.frame->wantsQuit(), "Save and Close CLOSED it");
    check(!l.frame->documentDirty(), "with nothing left unsaved");
    const std::string fallback = fakeHome + "/.forge/" + l.frame->documentName() + ".fpart";
    checkStrEq(l.frame->documentPath(), fallback,
               "into the one directory the application owns");
    checkEq(featuresOnDisk(fallback), static_cast<long>(seeded + 1), "and the work is in it");
  }
  {
    // (b) A PANEL, ANSWERED. What a user on macOS actually sees.
    App m;
    check(m.start(), "a second one, with a file panel installed", m.scene.error());
    ScriptedDialog panel;
    panel.accept = true;
    panel.nextPath = root + "/panel.fpart";
    m.frame->setFileDialog(&panel);
    check(m.fillet(), "an edit");
    m.frame->requestQuit();
    check(m.frame->quitPromptOpen(), "the guard asked");
    m.frame->answerQuitSave();
    m.oneFrame();
    checkEq(panel.requests.size(), 1u, "the answer RAISED the file panel");
    check(m.frame->wantsQuit(), "and the application closed once the panel was answered");
    checkStrEq(m.frame->documentPath(), panel.nextPath, "into the file the user picked");
    checkEq(featuresOnDisk(panel.nextPath), static_cast<long>(seeded + 1),
            "which holds the work");
  }
  {
    // (c) A PANEL, CANCELLED -- the answer that is not an answer. Nothing was
    // saved, so nothing may close: resolveQuitAfterSave() puts the question back.
    App n;
    check(n.start(), "a third one, whose user changes their mind", n.scene.error());
    ScriptedDialog panel;
    // MUTATION 12: the panel answers with a path where the user cancelled. The
    // application then closes, and every check below must go red.
    panel.accept = (g_mutation == 12);
    panel.nextPath = root + "/cancelled.fpart";
    n.frame->setFileDialog(&panel);
    check(n.fillet(), "an edit");
    n.frame->requestQuit();
    n.frame->answerQuitSave();
    n.oneFrame();
    checkEq(panel.requests.size(), 1u, "the panel was raised");
    check(!n.frame->wantsQuit(), "a CANCELLED panel does not close the application");
    check(n.frame->quitPromptOpen(), "the question is put back up");
    check(n.frame->documentDirty(), "and the work is still unsaved");
    check(!std::filesystem::exists(panel.nextPath), "nothing was written anywhere",
          panel.nextPath);
  }

  // ═══ 14. NEW AND OPEN: WHAT IS GUARDED HERE, AND WHAT IS NOT ════════════
  //
  // File > New and File > Open REPLACE the open document, and NEITHER ASKS. That
  // is the same silent discard this whole change is about, one gesture over, and
  // this change does NOT close it: there is no prompt on New and none on Open.
  // It is asserted here rather than left unsaid, because a gate that says nothing
  // about a hole is how the next reader comes to assume it is covered.
  //
  // What this change does add is the SNAPSHOT: both take one before they replace
  // anything, so the discarded work is on disk instead of gone at the instant of
  // the click. It is recoverable only until the replacement document is edited
  // and the cadence writes over it -- which is a smaller promise than a prompt,
  // and it is the one that is true.
  std::printf("\n-- 14. New replaces a dirty document without asking -------------------\n");
  {
    App o;
    check(o.start(), "an application with unsaved work", o.scene.error());
    const std::string dir14 = root + "/recovery-new";
    check(o.frame->beginRecoverySession(dir14), "a recovery session", dir14);
    // MUTATION 13: nothing is edited, so File > New throws nothing away and there
    // is no snapshot for the checks below to find.
    if (g_mutation != 13) check(o.fillet(), "unsaved work in the document");
    const std::string discarded = o.frame->document().irProgram();
    const std::string autosavePath =
        o.frame->recovery() != nullptr ? o.frame->recovery()->autosavePath() : std::string();
    const forge::ui::DispatchResult r = o.shell.run("file.new", forge::ui::CommandParams{});
    check(r.ok() && o.shell.lastDocumentError().empty(), "File > New replaced the document",
          o.shell.lastDocumentError());
    check(!o.frame->quitPromptOpen(),
          "New does NOT ask -- stated, because this change did not close that hole");
    forge::ui::DocumentFileData kept;
    forge::ui::DocumentIoError whyNot;
    check(forge::ui::loadDocumentFile(autosavePath, kept, whyNot),
          "but the work New threw away IS in an autosave", whyNot.describe());
    checkStrEq(kept.irProgram(), discarded, "and it is the program that was discarded");
    o.frame->endRecoverySession();
  }


  // ═══ 15. A DRAWING-ONLY EDIT REACHES THE CADENCE ════════════════════════
  //
  // Sections 9 and 10 drive the snapshot the QUIT takes. This one drives the
  // other path -- the fifteen-second cadence, which is what actually holds a
  // user's work while they are working -- with an edit that touches the drawing
  // and NOTHING ELSE. That is the case the cadence is most likely to be asked
  // about and the one it was least able to answer: the feature tree's digest
  // does not move, so forge::ui::RecoveryService correctly declines to rewrite
  // its autosave, and before this change nothing else was written either.
  std::printf("\n-- 15. the cadence keeps a drawing-only edit --------------------------\n");
  {
    App p;
    check(p.start(), "an application on the cadence", p.scene.error());
    const std::string dir15 = root + "/recovery-cadence";
    check(p.frame->beginRecoverySession(dir15), "a recovery session", dir15);
    // MUTATION 14: the drawing is never touched, so there is no drawing-only
    // edit for the cadence to keep and every check below must go red.
    if (g_mutation != 14) {
      check(p.note("DO NOT SCALE FROM THIS DRAWING"), "a note, and no model edit at all",
            p.frame->noteRefusal());
    }
    check(p.frame->documentDirty(), "a drawing edit makes the document dirty");
    checkEq(p.frame->document().records().size(), seeded,
            "and it changed NO statement -- the feature tree is untouched");
    // The application's own clock, stepped by a value rather than waited on.
    // One tick past the policy interval is what a user sitting still for fifteen
    // seconds produces.
    // `|| true` was written here first, and it would have been a check that
    // cannot fail -- the defect shape this whole gate exists to refuse. The
    // return value IS meaningful: this is the session's first autosave, so the
    // service has nothing to compare against and really does write.
    check(p.frame->autosaveTick(16.0), "the cadence ran and wrote a snapshot");
    const std::string sidecar =
        p.frame->recovery() != nullptr
            ? forge::desktop::autosaveDrawingPath(p.frame->recovery()->autosavePath())
            : std::string();
    check(!sidecar.empty(), "the drawing's snapshot has a path beside the autosave");
    checkEq(annotationsOnDisk(sidecar), 1L,
            "THE NOTE IS ON DISK, written by the cadence and not by a quit");
    checkEq(featuresOnDisk(sidecar), 0L,
            "and it carries NO features -- it cannot disagree about which part it is");
    p.frame->endRecoverySession();
    check(!std::filesystem::exists(sidecar),
          "a clean exit takes the drawing's snapshot with it, leaving no orphan", sidecar);
  }

  std::printf("\n[quit-gate] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures != 0) {
    std::printf("[quit-gate] FAILED\n");
    return 1;
  }
  std::printf("[quit-gate] THE QUIT PATH KEEPS YOUR WORK\n");
  return 0;
}
