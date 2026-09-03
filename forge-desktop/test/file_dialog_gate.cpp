// forge-desktop/test/file_dialog_gate.cpp
//
// THE FILE-DIALOG GATE — can a MOUSE reach all six file commands?
//
// ── the defect this exists for, measured ────────────────────────────────────
// PR #206 registered six commands and the registry went 80 -> 84:
// file.open, file.save, file.import_step, file.export_step, file.import_brep,
// file.export_brep. Four of them declare `path` REQUIRED with no honest default,
// so clicking one answered DispatchStatus::MissingRequiredParameter and the
// application put up an ImGui text box: to open a part, the user typed an
// absolute path. Every existing gate stayed green, because every existing gate
// supplies the path itself -- file_exchange_gate.cpp does exactly
// `out.setText("path", path); shell.run(leg.exportId, out)`. A capability whose
// only caller is a test that hands it the missing argument is a capability no
// user has.
//
// ── WHAT THIS GATE ASSERTS, AND WHERE IT MEASURES IT ────────────────────────
// One claim: for each of the six, a GESTURE with no arguments ends with the
// command holding the path the panel produced. It is measured at the RECEIVING
// END, never at the frame builder that sent it -- a frame that asserted on its
// own variable would prove only that it can remember a string:
//
//   file.export_step / file.export_brep   the FileExchange implementation is
//   file.import_step / file.import_brep   handed that exact path, recorded by a
//                                         wrapper around the real
//                                         FileExchangeHost, and the bytes really
//                                         are written and read back.
//   file.save / file.open                 ForgeFrame::documentPath() -- the
//                                         DocumentHost's own record of where the
//                                         document went -- is that exact path,
//                                         and the file is on disk.
//
// ── AND THAT A CANCEL DOES NOTHING ──────────────────────────────────────────
// Every native panel can be cancelled and a cancel is not a failure. Phase A
// runs all six with the panel scripted to cancel and requires: the panel WAS
// shown (otherwise "nothing happened" is trivially true), no command was
// journalled, the exchange was not called, the document path did not move, and
// THE ERROR COUNT DID NOT RISE. The last one is the "not an error toast" half of
// the brief, as a number.
//
// ── the panel is SCRIPTED, and that is what makes this headless ─────────────
// forge::desktop::FileDialog is an interface for exactly this reason. The macOS
// implementation (FileDialogMac.mm, NSOpenPanel/NSSavePanel) is compiled into
// the application target only; this gate links forge_desktop_core, which has no
// AppKit in it, and drives the SHIPPING path -- ForgeFrame::invoke(), the
// deferral, ForgeFrame::runPendingFileDialog(), the one registry -- with a panel
// that answers from a script. What is NOT proven here is Cocoa itself: that a
// real NSOpenPanel returns a real path is a claim about AppKit, and it is stated
// as unverified rather than implied by a green gate.
//
// --mutate 1..3 proves the gate can fail. See kMutations below.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "imgui.h"

#include "FileDialog.hpp"
#include "FileExchangeHost.hpp"
#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FileExchange.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Keymap.hpp"

namespace {

int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

void check(bool ok, const std::string& what, const std::string& detail = {}) {
  ++g_checks;
  if (ok) return;
  ++g_failures;
  std::printf("  FAIL  %s%s%s\n", what.c_str(), detail.empty() ? "" : "  --  ", detail.c_str());
}

void checkEq(const std::string& got, const std::string& want, const std::string& what) {
  ++g_checks;
  if (got == want) return;
  ++g_failures;
  std::printf("  FAIL  %s\n          got  \"%s\"\n          want \"%s\"\n", what.c_str(),
              got.c_str(), want.c_str());
}

std::string tempDir() {
  const char* tmp = std::getenv("TMPDIR");
  std::string dir = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!dir.empty() && dir.back() == '/') dir.pop_back();
  return dir;
}

long long fileSize(const std::string& path) {
  std::FILE* f = std::fopen(path.c_str(), "rb");
  if (f == nullptr) return -1;
  std::fseek(f, 0, SEEK_END);
  const long long n = std::ftell(f);
  std::fclose(f);
  return n;
}

// ── the panel, scripted ─────────────────────────────────────────────────────
// It records every request it is handed -- the mode, the title, the prompt, the
// filters and the seed -- because "the command got a path" is only half the
// claim: a Save panel filtering for the wrong suffix reaches the command with a
// path the command then refuses, and the user sees a failure they cannot
// explain.
class ScriptedDialog final : public forge::desktop::FileDialog {
 public:
  std::vector<forge::desktop::FileDialogRequest> requests;
  bool accept = true;      // false == the user pressed Cancel
  std::string nextPath;    // what they picked when they did not

  forge::desktop::FileDialogResult run(
      const forge::desktop::FileDialogRequest& request) override {
    requests.push_back(request);
    forge::desktop::FileDialogResult out;
    if (!accept) {
      // MUTATION 3: a cancel that reports the previous choice. This is the
      // regression the Phase A checks exist to catch -- it is what a picker
      // written with a bare std::string return value does, because "" and "the
      // user cancelled" are then the same value and the caller keeps the last
      // one it saw.
      if (g_mutation == 3 && !lastAccepted_.empty()) {
        out.accepted = true;
        out.path = lastAccepted_;
      }
      return out;
    }
    out.accepted = true;
    // MUTATION 2: the panel answers a DIFFERENT path from the one it was
    // scripted with. Every receiving-end comparison must then go red -- if any
    // of them stays green it was not comparing the path at all.
    out.path = (g_mutation == 2) ? nextPath + ".wrong" : nextPath;
    lastAccepted_ = out.path;
    return out;
  }

 private:
  std::string lastAccepted_;
};

// ── the exchange, recorded ──────────────────────────────────────────────────
// A WRAPPER around the real FileExchangeHost, not a stub in its place: the STEP
// and BREP files are genuinely written and genuinely read back by the kernel, so
// a path that arrives correctly and names something unwritable still fails here.
// What the wrapper adds is the one thing the report does not carry -- the path
// the command actually passed.
class RecordingExchange final : public forge::ui::FileExchange {
 public:
  RecordingExchange(const forge::ui::PartDocument& doc, forge::desktop::KernelScene* scene)
      : inner_(doc, scene) {}

  bool importFile(const std::string& path, forge::ui::ExchangeFormat format,
                  forge::ui::ExchangeReport& report) override {
    lastImportPath = path;
    ++imports;
    return inner_.importFile(path, format, report);
  }
  bool exportFile(const std::string& path, forge::ui::ExchangeFormat format,
                  forge::ui::ExchangeReport& report) override {
    lastExportPath = path;
    ++exports;
    return inner_.exportFile(path, format, report);
  }

  std::string lastImportPath;
  std::string lastExportPath;
  std::size_t imports = 0;
  std::size_t exports = 0;

 private:
  forge::desktop::FileExchangeHost inner_;
};

// A headless ImGui context, the same one frame_gate.cpp uses: a real context
// with a null renderer backend is all a frame needs, and the file panel is run
// by build() -- from OUTSIDE the dock walk -- so the gate exercises the deferral
// rather than a private entry point beside it.
struct HeadlessImGui {
  HeadlessImGui() {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(1600.0f, 1000.0f);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "file_dialog_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int w = 0, h = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &w, &h);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

bool hasExtension(const forge::desktop::FileDialogRequest& r, const std::string& ext) {
  for (const forge::desktop::FileFilter& f : r.filters) {
    for (const std::string& e : f.extensions) {
      if (e == ext) return true;
    }
  }
  return false;
}

// Every sentence a panel shows is subject to the same prose rule the exchange
// messages pass -- no qualified names, no snake_case, no interior capitals.
void checkProse(const forge::desktop::FileDialogRequest& r, const std::string& id) {
  check(forge::ui::isUserReadable(r.title), id + ": the panel title is not plain English",
        r.title);
  check(forge::ui::isUserReadable(r.prompt), id + ": the panel button is not plain English",
        r.prompt);
  for (const forge::desktop::FileFilter& f : r.filters) {
    check(forge::ui::isUserReadable(f.label), id + ": a filter label is not plain English",
          f.label);
  }
}

}  // namespace

int main(int argc, char** argv) {
  std::string dir = tempDir();
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
    if (std::strcmp(argv[i], "--dir") == 0 && i + 1 < argc) dir = argv[++i];
  }
  std::printf("=== Forge file-dialog gate ===\n");
  std::printf("  mutation: %d  (0 = none)\n", g_mutation);
  std::printf("  scratch:  %s\n", dir.c_str());

  HeadlessImGui imgui;

  forge::desktop::KernelScene scene;
  const bool built = scene.build();
  check(built, "the kernel body builds", scene.error());
  if (!built) {
    std::printf("[gate] cannot continue without geometry\n");
    return 1;
  }

  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  const std::size_t partCommands = frame.wirePartCommands();
  check(partCommands > 0, "Part commands registered");

  RecordingExchange exchange(frame.document(), &scene);
  shell.setFileExchange(&exchange);

  ScriptedDialog dialog;
  // MUTATION 1: the state this whole change exists to end -- the six commands
  // registered, and nothing in the application able to produce a path.
  if (g_mutation != 1) frame.setFileDialog(&dialog);

  auto oneFrame = [&]() {
    ImGui::NewFrame();
    frame.build(0, 1.0f);
    ImGui::Render();
  };
  // A GESTURE: no arguments, exactly what a menu click is. The panel is raised
  // and DEFERRED by invoke(); the frame that follows is what shows it.
  auto gesture = [&](const std::string& id) {
    frame.invoke(id);
    oneFrame();
  };
  // The request THIS gesture raised. It takes the count from before the gesture
  // rather than reading requests.back(), because back() on an empty vector is
  // undefined behaviour and "no panel was raised at all" is precisely what
  // mutation 1 produces -- the gate segfaulted on its own negative control
  // before this existed, and a crash is not a detection.
  auto raised = [&](const std::string& id, std::size_t before) {
    ++g_checks;
    if (dialog.requests.size() != before + 1) {
      ++g_failures;
      std::printf("  FAIL  %s: NO PANEL WAS RAISED for a gesture with no arguments\n",
                  id.c_str());
      return forge::desktop::FileDialogRequest{};
    }
    return dialog.requests.back();
  };

  // ── 1. the policy covers every file command that needs a path ────────────
  std::printf("\n-- 1. the six commands, and the policy that reaches them -------------\n");
  {
    const std::vector<std::string>& ids = forge::desktop::fileDialogCommandIds();
    check(ids.size() == 6, "the policy table names six commands",
          "it names " + std::to_string(ids.size()));
    for (const std::string& id : ids) {
      check(shell.registry().find(id) != nullptr, "policy names a registered command: " + id);
    }
    // The other direction, which is the half that catches a SEVENTH file command
    // landing later with no way to reach it: every registered file command that
    // declares a `path` must have a policy.
    std::size_t pathCommands = 0;
    for (const std::string& id : shell.registry().ids()) {
      if (id.rfind("file.", 0) != 0) continue;
      const forge::ui::CommandDescriptor* d = shell.registry().find(id);
      if (d == nullptr) continue;
      bool takesPath = false;
      for (const forge::ui::ParamSpec& p : d->schema) {
        if (p.name == "path") takesPath = true;
      }
      if (!takesPath) continue;
      ++pathCommands;
      forge::desktop::FileDialogPolicy policy;
      check(forge::desktop::fileDialogPolicyFor(id, policy),
            "every file command that takes a path opens a panel: " + id);
    }
    check(pathCommands == 6, "six registered file commands take a path",
          "found " + std::to_string(pathCommands));
  }

  // ── 2. CANCEL DOES NOTHING ───────────────────────────────────────────────
  // Five of the six here; file.save is checked with the other five below, in the
  // ONE state it can raise a panel in. This is not a convenience: a freshly
  // seeded document is NOT dirty (ForgeFrame seeds the starter part and sets
  // builtProgram_ to it in the same breath), and file.save's enabled predicate
  // IS `doc_.dirty`, so Save here is correctly disabled and correctly raises
  // nothing. Manufacturing a dirty document to force the case was tried and it
  // measured something else: `part.primitive_box` on top of the starter part
  // gives a program the KERNEL refuses -- two unconnected solids, "the part has
  // not rebuilt, so there is nothing to save" -- which then failed the export
  // legs for a reason that has nothing to do with a file panel. The document is
  // left exactly as the application seeds it, and Save is exercised where a user
  // reaches it: after an edit that really happened.
  std::printf("\n-- 2. cancel is a no-op ----------------------------------------------\n");
  auto checkCancelIsNoOp = [&](const std::string& id) {
    const bool acceptBefore = dialog.accept;
    dialog.accept = false;
    const std::size_t shownBefore = frame.fileDialogsShown();
    const std::size_t cancelledBefore = frame.fileDialogsCancelled();
    const std::size_t journalBefore = shell.journal().size();
    const std::size_t errorsBefore = shell.log().count(forge::ui::Severity::Error);
    const std::size_t warningsBefore = shell.log().count(forge::ui::Severity::Warning);
    const std::size_t importsBefore = exchange.imports;
    const std::size_t exportsBefore = exchange.exports;
    const std::string pathBefore = frame.documentPath();
    const std::size_t recordsBefore = frame.document().records().size();
    const std::size_t requestsBefore = dialog.requests.size();

    gesture(id);

    check(frame.fileDialogsShown() == shownBefore + 1,
          id + ": a panel was NOT shown for a gesture with no arguments");
    check(frame.fileDialogsCancelled() == cancelledBefore + 1,
          id + ": the cancel was not recorded as one");
    check(shell.journal().size() == journalBefore,
          id + ": a cancelled panel still dispatched the command");
    check(exchange.imports == importsBefore && exchange.exports == exportsBefore,
          id + ": a cancelled panel still reached the file exchange");
    checkEq(frame.documentPath(), pathBefore, id + ": a cancelled panel moved the document");
    check(frame.document().records().size() == recordsBefore,
          id + ": a cancelled panel changed the document");
    check(shell.log().count(forge::ui::Severity::Error) == errorsBefore,
          id + ": CANCEL WAS REPORTED AS AN ERROR");
    check(shell.log().count(forge::ui::Severity::Warning) == warningsBefore,
          id + ": cancel was reported as a warning");
    if (dialog.requests.size() == requestsBefore + 1) checkProse(dialog.requests.back(), id);
    dialog.accept = acceptBefore;
  };
  {
    for (const std::string& id : forge::desktop::fileDialogCommandIds()) {
      if (id == "file.save") continue;  // checked below, in the state it applies to
      checkCancelIsNoOp(id);
    }
    std::printf("  five panels shown, five cancelled, %zu dispatches, %zu errors\n",
                shell.journal().size(), shell.log().count(forge::ui::Severity::Error));
  }

  // ── 3. the chosen path reaches the command ───────────────────────────────
  std::printf("\n-- 3. the chosen path reaches all six --------------------------------\n");
  dialog.accept = true;

  const std::string stepPath = dir + "/forge_dialog_gate.step";
  const std::string brepPath = dir + "/forge_dialog_gate.brep";
  const std::string partPath = dir + "/forge_dialog_gate.fpart";
  std::remove(stepPath.c_str());
  std::remove(brepPath.c_str());
  std::remove(partPath.c_str());

  // ---- export STEP -------------------------------------------------------
  {
    dialog.nextPath = stepPath;
    const std::size_t before = exchange.exports;
    const std::size_t reqBefore = dialog.requests.size();
    gesture("file.export_step");
    const forge::desktop::FileDialogRequest r = raised("file.export_step", reqBefore);
    check(r.mode == forge::desktop::FileDialogMode::Save, "file.export_step raises a SAVE panel");
    check(hasExtension(r, ".step"), "file.export_step filters for .step");
    checkEq(r.defaultExtension, ".step", "file.export_step appends .step to a bare name");
    check(exchange.exports == before + 1, "file.export_step reached the exchange");
    checkEq(exchange.lastExportPath, stepPath, "file.export_step RECEIVED THE CHOSEN PATH");
    check(fileSize(stepPath) > 0, "file.export_step wrote bytes to the chosen path");
    checkEq(shell.lastDocumentError(), std::string(), "file.export_step was not refused");
  }

  // ---- export BREP -------------------------------------------------------
  {
    dialog.nextPath = brepPath;
    const std::size_t before = exchange.exports;
    const std::size_t reqBefore = dialog.requests.size();
    gesture("file.export_brep");
    const forge::desktop::FileDialogRequest r = raised("file.export_brep", reqBefore);
    check(r.mode == forge::desktop::FileDialogMode::Save, "file.export_brep raises a SAVE panel");
    check(hasExtension(r, ".brep"), "file.export_brep filters for .brep");
    check(exchange.exports == before + 1, "file.export_brep reached the exchange");
    checkEq(exchange.lastExportPath, brepPath, "file.export_brep RECEIVED THE CHOSEN PATH");
    check(fileSize(brepPath) > 0, "file.export_brep wrote bytes to the chosen path");
    checkEq(shell.lastDocumentError(), std::string(), "file.export_brep was not refused");
  }

  // ---- import STEP -------------------------------------------------------
  // Reads back the file the export leg just wrote, so a path that arrives
  // correctly and names nothing still fails here.
  {
    dialog.nextPath = stepPath;
    const std::size_t before = exchange.imports;
    const std::size_t reqBefore = dialog.requests.size();
    gesture("file.import_step");
    const forge::desktop::FileDialogRequest r = raised("file.import_step", reqBefore);
    check(r.mode == forge::desktop::FileDialogMode::Open, "file.import_step raises an OPEN panel");
    check(hasExtension(r, ".step"), "file.import_step filters for .step");
    check(exchange.imports == before + 1, "file.import_step reached the exchange");
    checkEq(exchange.lastImportPath, stepPath, "file.import_step RECEIVED THE CHOSEN PATH");
    checkEq(shell.lastDocumentError(), std::string(), "file.import_step was not refused");
  }

  // ---- import BREP -------------------------------------------------------
  {
    dialog.nextPath = brepPath;
    const std::size_t before = exchange.imports;
    const std::size_t reqBefore = dialog.requests.size();
    gesture("file.import_brep");
    const forge::desktop::FileDialogRequest r = raised("file.import_brep", reqBefore);
    check(r.mode == forge::desktop::FileDialogMode::Open, "file.import_brep raises an OPEN panel");
    check(hasExtension(r, ".brep"), "file.import_brep filters for .brep");
    check(exchange.imports == before + 1, "file.import_brep reached the exchange");
    checkEq(exchange.lastImportPath, brepPath, "file.import_brep RECEIVED THE CHOSEN PATH");
    checkEq(shell.lastDocumentError(), std::string(), "file.import_brep was not refused");
  }

  // ---- save --------------------------------------------------------------
  // The document has never been saved, so the application has nowhere to put it
  // and the panel is owed. That is the ONLY case a Save panel is raised in --
  // a document that came from a file is saved back to it, silently.
  {
    checkEq(frame.documentPath(), std::string(),
            "the document is still untitled, so Save must ask where");
    check(shell.document().dirty, "the document is dirty, so Save is offered at all");
    // The sixth cancel, in the one state file.save can raise a panel in: an
    // edited document that has never been given a name.
    checkCancelIsNoOp("file.save");
    checkEq(frame.documentPath(), std::string(), "a cancelled Save did not name the document");
    dialog.nextPath = partPath;
    const std::size_t reqBefore = dialog.requests.size();
    gesture("file.save");
    const forge::desktop::FileDialogRequest r = raised("file.save", reqBefore);
    check(r.mode == forge::desktop::FileDialogMode::Save, "file.save raises a SAVE panel");
    check(hasExtension(r, ".fpart"), "file.save filters for .fpart");
    checkEq(frame.documentPath(), partPath, "file.save RECEIVED THE CHOSEN PATH");
    check(fileSize(partPath) > 0, "file.save wrote bytes to the chosen path");
    checkEq(shell.lastDocumentError(), std::string(), "file.save was not refused");

    // ...and now that it HAS a path, a second Save must not ask again. A picker
    // on every Ctrl+S is its own defect, and it is one this policy could easily
    // have shipped.
    const std::size_t shown = frame.fileDialogsShown();
    gesture("file.save");
    check(frame.fileDialogsShown() == shown,
          "a document with a path is saved SILENTLY -- no panel on every save");
  }

  // ---- open --------------------------------------------------------------
  {
    dialog.nextPath = partPath;
    const std::size_t reqBefore = dialog.requests.size();
    gesture("file.open");
    const forge::desktop::FileDialogRequest r = raised("file.open", reqBefore);
    check(r.mode == forge::desktop::FileDialogMode::Open, "file.open raises an OPEN panel");
    check(hasExtension(r, ".fpart"), "file.open filters for .fpart");
    checkEq(frame.documentPath(), partPath, "file.open RECEIVED THE CHOSEN PATH");
    checkEq(shell.lastDocumentError(), std::string(), "file.open was not refused");
    check(frame.document().records().size() > 0, "file.open produced a document with statements");
  }

  // ── 4. THE KEYBOARD REACHES THE PANEL TOO ────────────────────────────────
  // A menu click and a keystroke are DIFFERENT INVOKERS: a click ends in
  // ForgeFrame::invoke(), a keystroke goes ForgeFrame::onKey ->
  // ForgeShell::key -> ForgeShell::invoke, and that second route never touched
  // this frame builder's parameter machinery at all. MEASURED before this
  // change: Ctrl+O resolved to file.open, came back MissingRequiredParameter,
  // and the whole visible result was a status line naming the enum -- no panel,
  // no text box, nothing. Ctrl+O is a SHIPPED binding in all four input
  // profiles (Keymap.cpp), so this drives the real one.
  std::printf("\n-- 4. Ctrl+O reaches the panel ---------------------------------------\n");
  {
    dialog.accept = false;
    const std::size_t shown = frame.fileDialogsShown();
    const std::size_t reqBefore = dialog.requests.size();
    frame.onKey("O", forge::ui::maskOf(forge::ui::Mod::Ctrl));
    oneFrame();
    check(frame.fileDialogsShown() == shown + 1,
          "Ctrl+O raises the file panel -- the keyboard is an invoker too");
    const forge::desktop::FileDialogRequest r = raised("file.open (Ctrl+O)", reqBefore);
    check(r.mode == forge::desktop::FileDialogMode::Open, "Ctrl+O raises an OPEN panel");
    check(hasExtension(r, ".fpart"), "Ctrl+O filters for .fpart");
    dialog.accept = true;
  }

  // ── 5. THE LIMIT, PINNED ─────────────────────────────────────────────────
  // Ctrl+S does NOT raise a panel and that is a documented consequence, not an
  // oversight: file.save declares `path` OPTIONAL so a bare keyboard save
  // dispatches, which means ForgeShell::key has already run the command by the
  // time onKey sees the outcome. Asserted here so the asymmetry between File >
  // Save (asks) and Ctrl+S (writes to the document's own path, or ~/.forge when
  // it has none) cannot change in either direction without a red check.
  std::printf("\n-- 5. Ctrl+S does not, and that is pinned ---------------------------\n");
  {
    const std::size_t shown = frame.fileDialogsShown();
    frame.onKey("S", forge::ui::maskOf(forge::ui::Mod::Ctrl));
    oneFrame();
    check(frame.fileDialogsShown() == shown,
          "Ctrl+S raises no panel -- see wantsFileDialog(), PathRole::SaveTarget");
  }

  // ── 6. the seed, which is what makes the panel usable ────────────────────
  // A Save panel seeded with the OPEN document's name and the COMMAND's suffix.
  // Without the suffix swap, "Save a Copy as STEP" on bracket.fpart starts on
  // bracket.fpart, and the one-click answer writes STEP bytes into a file named
  // like a Forge document.
  std::printf("\n-- 6. the panel opens somewhere useful -------------------------------\n");
  {
    dialog.accept = false;
    const std::size_t reqBefore = dialog.requests.size();
    gesture("file.export_step");
    const forge::desktop::FileDialogRequest r = raised("file.export_step", reqBefore);
    check(r.suggestedPath.find(dir) == 0, "the Save panel opens in the document's directory",
          r.suggestedPath);
    check(r.suggestedPath.size() > 5 &&
              r.suggestedPath.compare(r.suggestedPath.size() - 5, 5, ".step") == 0,
          "the Save panel starts on a name ending .step, not .fpart", r.suggestedPath);
    dialog.accept = true;
  }

  std::printf("\n[gate] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures != 0) {
    std::printf("FILE-DIALOG GATE RED\n");
    return 1;
  }
  std::printf("FILE-DIALOG GATE GREEN\n");
  return 0;
}
