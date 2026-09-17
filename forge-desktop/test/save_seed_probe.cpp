// forge-desktop/test/save_seed_probe.cpp
//
// T-122 REPRODUCTION PROBE — WHAT DOES A SAVE PANEL POINT AT?
//
// This is NOT a fix and NOT a gate. It is the instrument that answers one
// question on RAW BYTES, for each of the five populations named in the T-122
// report, through the application's own code paths:
//
//     when Forge asks "where should this part go?", does the answer it OFFERS
//     name a DIFFERENT document's file -- and does taking that answer destroy
//     it?
//
// Every leg below drives forge::ui::ForgeShell's registry and
// forge::desktop::ForgeFrame exactly as a menu click does. Nothing here writes a
// .fpart by hand: the files are made by file.save / file.save_as and read back
// as bytes, and the counts are of `\nNOTE\n` and `\nFEATURE\n` in those bytes,
// not of objects in a loader that shares a serialiser with the writer under
// test.
//
// ── THE ONE THING THAT IS MODELLED RATHER THAN MEASURED ────────────────────
// The native panel is forge::desktop::FileDialog, and the macOS implementation
// (NSSavePanel, FileDialogMac.mm) is compiled into the APPLICATION target only,
// so no headless binary can link it. ReturnOnSeedDialog below stands in for it,
// and it answers the ONE way that matters here: it accepts `suggestedPath`
// VERBATIM. That is a user pressing Return on the name the panel opened with --
// on macOS, plus the Replace sheet AppKit interposes when that name is a file
// that exists. Nothing in this repository can drive a real NSSavePanel to a
// click (test/panel_probe.mm stops one call short of runModal and says so), so
// the sheet is the one claim in the report this probe CANNOT measure. What it
// can and does measure is what the panel is POINTED AT, which is where the
// defect lives.
//
// ── RUN ONE POPULATION PER PROCESS ─────────────────────────────────────────
//     forge_desktop_save_seed_probe --pop S4|S4b|S4c|S5|sample|control-seed|control-reset
// One per process on purpose: forge-kernel's OCCT fillet path enforces a
// PROCESS-GLOBAL wall-clock window (see quit_guard_gate.cpp's App::addBox), and
// the seeded part of every application built here spends some of it.
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <stdlib.h>  // ::setenv, for the HOME redirect

#include "imgui.h"

#include "FileDialog.hpp"
#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "PartFile.hpp"
#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DocumentStore.hpp"
#include "forge/ui/Drawing.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Types.hpp"

namespace {

int g_checks = 0;
int g_failures = 0;

void check(bool ok, const std::string& what, const std::string& detail = std::string()) {
  ++g_checks;
  if (ok) return;
  ++g_failures;
  std::printf("  FAIL  %-58s  %s\n", what.c_str(), detail.c_str());
}

void checkStrEq(const std::string& got, const std::string& want, const std::string& what) {
  ++g_checks;
  if (got == want) return;
  ++g_failures;
  std::printf("  FAIL  %-58s\n    got  |%s|\n    want |%s|\n", what.c_str(), got.c_str(),
              want.c_str());
}

// A headless ImGui context: a real context with a null renderer backend, which
// is all a frame needs. Same shape as every other desktop gate.
struct HeadlessImGui {
  HeadlessImGui() {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(1600.0f, 1000.0f);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "save_seed_probe_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int w = 0;
    int h = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &w, &h);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

// ── the panel, answering the way a user does who presses Return ────────────
// It accepts the seed it was handed. A panel that answers anything else would
// be measuring this probe's imagination instead of the application's suggestion.
class ReturnOnSeedDialog final : public forge::desktop::FileDialog {
 public:
  std::vector<forge::desktop::FileDialogRequest> requests;
  bool accept = true;

  forge::desktop::FileDialogResult run(
      const forge::desktop::FileDialogRequest& request) override {
    requests.push_back(request);
    forge::desktop::FileDialogResult out;
    if (!accept) return out;
    out.accepted = true;
    out.path = request.suggestedPath;  // ONE RETURN on the pre-filled name
    return out;
  }
};

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

std::size_t rawCount(const std::string& text, const std::string& needle) {
  if (needle.empty()) return 0;
  std::size_t n = 0;
  for (std::size_t at = text.find(needle); at != std::string::npos;
       at = text.find(needle, at + needle.size())) {
    ++n;
  }
  return n;
}

// What a user's file holds, read as BYTES. The .fpart writer opens an annotation
// block with "\nNOTE\n" and a feature block with "\nFEATURE\n"; the title
// block's `FEATURE <value>` line has a value after it and cannot be mistaken for
// either.
struct Seen {
  bool exists = false;
  std::size_t notes = 0;
  std::size_t features = 0;
  std::size_t bytes = 0;
  std::string text;
};

Seen look(const std::string& path) {
  Seen s;
  s.text = readWholeFile(path);
  s.exists = !s.text.empty();
  s.bytes = s.text.size();
  s.notes = rawCount(s.text, "\nNOTE\n");
  s.features = rawCount(s.text, "\nFEATURE\n");
  return s;
}

// ── WHAT THE USER IS TOLD, MEASURED RATHER THAN ASSUMED ────────────────────
// The activity log is the application's own record of everything it said, and
// `since(sequence)` is every line it added after a mark. A destructive gesture
// that produces no line here is a gesture the user was told nothing about --
// which is the second half of what this probe is for.
std::size_t logMark(const forge::ui::ForgeShell& shell) {
  const forge::ui::LogEntry* last = shell.log().last();
  return last == nullptr ? 0 : last->sequence;
}

void sayLog(const forge::ui::ForgeShell& shell, std::size_t mark, const char* label) {
  const std::vector<forge::ui::LogEntry> fresh = shell.log().since(mark);
  std::printf("   [said] %s -- %zu line(s) in the activity log\n", label, fresh.size());
  for (const forge::ui::LogEntry& e : fresh) {
    std::printf("          %s\n", e.render().c_str());
  }
}

void say(const char* label, const std::string& path, const Seen& s) {
  std::printf("   [raw] %-44s %zu NOTE / %zu FEATURE / %zu bytes   (%s)\n", label, s.notes,
              s.features, s.bytes, path.c_str());
}

// The verdict for one population, printed in ONE machine-readable line so a
// reader does not have to reconstruct it from the checks.
void verdict(const char* population, const std::string& path, const Seen& before,
             const Seen& after, const std::string& confirmation) {
  const bool destroyed = before.exists && after.text != before.text;
  std::printf("\n  [%s] %s\n", population, destroyed ? "REPRODUCED -- the user's file was "
                                                       "overwritten"
                                                     : "NOT reproduced -- the file is untouched");
  std::printf("  [%s] file        : %s\n", population, path.c_str());
  std::printf("  [%s] before      : %zu NOTE / %zu FEATURE / %zu bytes\n", population,
              before.notes, before.features, before.bytes);
  std::printf("  [%s] after       : %zu NOTE / %zu FEATURE / %zu bytes\n", population, after.notes,
              after.features, after.bytes);
  std::printf("  [%s] confirmation: %s\n", population, confirmation.c_str());
}

// One application: its own kernel scene, its own shell, its own frame builder.
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

  // A modelling edit, through the ONE registry. A BOX and never a fillet: the
  // OCCT fillet path's wall-clock window is process-global.
  bool addBox() {
    forge::ui::CommandParams params;
    params.setNumber("dx", 12.0);
    params.setNumber("dy", 8.0);
    params.setNumber("dz", 6.0);
    const forge::ui::DispatchResult r = shell.run("part.primitive_box", params);
    return r.ok() && shell.lastDocumentError().empty();
  }

  // A BARE Ctrl+S: file.save with no path at all, which is what the keyboard
  // sends.
  bool save() {
    const forge::ui::DispatchResult r = shell.run("file.save", forge::ui::CommandParams{});
    return r.ok() && shell.lastDocumentError().empty();
  }

  bool saveTo(const std::string& path) {
    forge::ui::CommandParams params;
    params.setText("path", path);
    const forge::ui::DispatchResult r = shell.run("file.save", params);
    return r.ok() && shell.lastDocumentError().empty();
  }

  bool open(const std::string& path) {
    forge::ui::CommandParams params;
    params.setText("path", path);
    const forge::ui::DispatchResult r = shell.run("file.open", params);
    return r.ok() && shell.lastDocumentError().empty();
  }

  bool newPart() {
    const forge::ui::DispatchResult r = shell.run("file.new", forge::ui::CommandParams{});
    return r.ok() && shell.lastDocumentError().empty();
  }

  bool loadSample(const std::string& id) {
    forge::ui::CommandParams params;
    params.setText("sample", id);
    const forge::ui::DispatchResult r = shell.run("app.load_sample", params);
    return r.ok() && shell.lastDocumentError().empty();
  }

  // The drawing panel's own button: a note is a document edit that touches no
  // statement at all.
  bool note(const std::string& text) {
    return frame->drawingAddNote(text, forge::ui::AnnotationKind::Note,
                                 forge::ui::NamedView::Front, false);
  }

  std::size_t warnings() const { return shell.log().count(forge::ui::Severity::Warning); }
  std::size_t errors() const { return shell.log().count(forge::ui::Severity::Error); }
};

// An application that did not start is not a failing check -- it is a probe that
// could not ask its question. Says so and ends the run, which flushes.
void started(App& app, const std::string& what) {
  check(app.start(), what, app.scene.error());
  if (app.frame) return;
  std::printf("\n[probe] %d checks, %d failures\n", g_checks, g_failures);
  std::printf("[probe] NO APPLICATION -- the kernel's reason: %s\n", app.scene.error().c_str());
  std::exit(1);
}

// Puts the autosave and its drawing `seconds` further into the past, so the
// user's next hand-save is genuinely NEWER than the snapshot. A value, not a
// sleep. Same helper the quit-guard gate uses.
std::size_t ageAutosaveFiles(const std::string& directory, int seconds) {
  forge::ui::FileSystemStorage storage;
  const std::string tree = forge::ui::kAutosaveSuffix;
  const std::string sheet = forge::desktop::kAutosaveDrawingSuffix;
  const auto endsWith = [](const std::string& s, const std::string& suffix) {
    return s.size() >= suffix.size() &&
           s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;
  };
  std::size_t aged = 0;
  for (const std::string& entry : storage.list(directory)) {
    if (!endsWith(entry, tree) && !endsWith(entry, sheet)) continue;
    std::error_code ec;
    const auto was = std::filesystem::last_write_time(entry, ec);
    if (ec) continue;
    std::filesystem::last_write_time(entry, was - std::chrono::seconds(seconds), ec);
    if (!ec) ++aged;
  }
  return aged;
}

// ── S4 ─────────────────────────────────────────────────────────────────────
// Ctrl+S, Ctrl+N, model, and then File > Save FROM THE MENU.
void popS4(const std::string& root) {
  (void)root;  // S4 lives entirely in $HOME/.forge, which main() redirected
  std::printf("\n== S4: Ctrl+S, Ctrl+N, model, File > Save (menu) =====================\n");
  App a;
  started(a, "Forge starts");

  check(a.note("PART ONE -- DO NOT DELETE"), "the user types a note on the sheet",
        a.frame->noteRefusal());
  check(a.save(), "a BARE Ctrl+S -- the only kind this user has pressed",
        a.shell.lastDocumentError());
  const std::string userPath = a.frame->documentPath();
  check(!userPath.empty(), "so Forge chose a file for them", userPath);
  const Seen before = look(userPath);
  say("part one, as the user saved it", userPath, before);

  check(a.newPart(), "Ctrl+N", a.shell.lastDocumentError());
  checkStrEq(a.frame->documentPath(), std::string(), "the new document has no file of its own");
  check(a.addBox(), "the user models the second part");

  // File > Save, with the native panel installed -- the shipping configuration.
  ReturnOnSeedDialog dialog;
  a.frame->setFileDialog(&dialog);
  const std::size_t shown = a.frame->fileDialogsShown();
  const std::size_t warnings = a.warnings();
  const std::size_t errors = a.errors();
  const std::size_t mark = logMark(a.shell);
  a.frame->invoke("file.save");
  a.oneFrame();
  sayLog(a.shell, mark, "everything File > Save said");
  std::printf("   [strip] the status line now reads: %s\n", a.frame->lastStatus().c_str());

  check(a.frame->fileDialogsShown() == shown + 1, "File > Save raised a panel");
  check(!dialog.requests.empty(), "and the probe saw the request it was built from");
  std::string seed;
  if (!dialog.requests.empty()) seed = dialog.requests.back().suggestedPath;
  std::printf("   [seed] the Save panel opened pointing at: %s\n", seed.c_str());
  // What a user actually SEES: seedPanel() in FileDialogMac.mm sends the panel
  // to the seed's directory and puts the leaf in the name box.
  std::printf("   [seen] name box \"%s\", in folder %s\n",
              forge::desktop::fileDialogNameField(seed).c_str(),
              std::filesystem::path(seed).parent_path().string().c_str());
  checkStrEq(seed, userPath, "★ THE SAVE PANEL POINTS AT THE OTHER DOCUMENT'S FILE");
  checkStrEq(a.shell.recentDocuments().mostRecent(), userPath,
             "and that is the most recent document, which is where the seed comes from");

  const Seen after = look(userPath);
  say("the same file, one Return later", userPath, after);
  std::string confirmation = "the app raised 1 panel and asked nothing else";
  confirmation += "; warnings +" + std::to_string(a.warnings() - warnings);
  confirmation += ", errors +" + std::to_string(a.errors() - errors);
  verdict("S4", userPath, before, after, confirmation);
}

// ── S4b ────────────────────────────────────────────────────────────────────
// The panel pre-fills the very path refusedSavePath_ is remembering.
void popS4b(const std::string& root) {
  std::printf("\n== S4b: the refused path, offered back by the panel ==================\n");
  const std::string work = root + "/work";
  std::error_code ec;
  std::filesystem::create_directories(work, ec);
  const std::string userPath = work + "/gearbox-cover.fpart";
  const std::string recoveryDir = root + "/recovery";

  // A launch that ends CLEANLY, so its session file -- recents included -- is
  // what the launch after the crash reads. main.cpp writes shell.saveState() on
  // the way out and reads it back at start-up; this is that file.
  std::string sessionFile;
  {
    App a;
    started(a, "the first launch");
    check(a.addBox(), "the user models");
    check(a.saveTo(userPath), "and saves their part where they want it",
          a.shell.lastDocumentError());
    sessionFile = a.shell.saveState();
  }
  check(sessionFile.find(userPath) != std::string::npos,
        "the session file remembers that document", userPath);

  // The launch that dies, with its work half in a snapshot and half in the file.
  {
    App b;
    started(b, "the launch that is going to die");
    check(b.shell.loadState(sessionFile), "it restores the session file at start-up");
    check(b.open(userPath), "the user opens their part", b.shell.lastDocumentError());
    check(b.frame->beginRecoverySession(recoveryDir), "autosave is on", recoveryDir);
    check(b.addBox(), "work that only the snapshot will hold");
    check(b.frame->autosaveNow(), "THE SNAPSHOT: the cadence fires");
    check(ageAutosaveFiles(recoveryDir, 60) == 2,
          "and it is a minute older than the save that comes next");
    check(b.note("KEEP THIS NOTE -- IT IS THE ONLY COPY"), "the user types a note",
          b.frame->noteRefusal());
    check(b.save(), "and saves it into their own file", b.shell.lastDocumentError());
    // The session dies here. Nothing ends it.
  }
  const Seen before = look(userPath);
  say("the user's file, as they last saved it", userPath, before);

  App c;
  started(c, "the next launch");
  check(c.shell.loadState(sessionFile), "which restores the same session file");
  check(c.frame->beginRecoverySession(recoveryDir), "and opens its own session");
  const std::vector<forge::ui::RecoveryCandidate> dead = c.frame->recoverableSessions();
  check(dead.size() == 1, "exactly one session did not end",
        std::to_string(dead.size()) + " found");
  if (dead.empty()) {
    std::printf("  [S4b] NOT REACHED -- no dead session to recover\n");
    return;
  }
  std::string why;
  const std::size_t recoveryMark = logMark(c.shell);
  check(c.frame->recoverFromAutosave(dead[0], why), "the autosave read back", why);
  sayLog(c.shell, recoveryMark, "what the recovery told the user");
  check(c.frame->recoveryRefusedStalePath(),
        "★ THE GUARD FIRES: the file is newer than the snapshot, so the path is REFUSED");
  checkStrEq(c.frame->documentPath(), std::string(), "and the document is left untitled");

  ReturnOnSeedDialog dialog;
  c.frame->setFileDialog(&dialog);
  const std::size_t shown = c.frame->fileDialogsShown();
  const std::size_t warnings = c.warnings();
  const std::size_t errors = c.errors();
  const std::size_t mark = logMark(c.shell);
  c.frame->invoke("file.save");
  c.oneFrame();
  sayLog(c.shell, mark, "everything File > Save said");
  std::printf("   [strip] the status line now reads: %s\n", c.frame->lastStatus().c_str());
  check(c.frame->fileDialogsShown() == shown + 1, "File > Save raised a panel");
  std::string seed;
  if (!dialog.requests.empty()) seed = dialog.requests.back().suggestedPath;
  std::printf("   [seed] the Save panel opened pointing at: %s\n", seed.c_str());
  // What a user actually SEES: seedPanel() in FileDialogMac.mm sends the panel
  // to the seed's directory and puts the leaf in the name box.
  std::printf("   [seen] name box \"%s\", in folder %s\n",
              forge::desktop::fileDialogNameField(seed).c_str(),
              std::filesystem::path(seed).parent_path().string().c_str());
  checkStrEq(seed, userPath,
             "★ THE PANEL OFFERS THE VERY FILE THE GUARD REFUSED TO WRITE");

  const Seen after = look(userPath);
  say("the same file, one Return later", userPath, after);
  std::string confirmation = "the app raised 1 panel and asked nothing else";
  confirmation += "; warnings +" + std::to_string(c.warnings() - warnings);
  confirmation += ", errors +" + std::to_string(c.errors() - errors);
  verdict("S4b", userPath, before, after, confirmation);
  c.frame->endRecoverySession();
}

// ── S4c ────────────────────────────────────────────────────────────────────
// File > Open, Ctrl+N, File > Save.
void popS4c(const std::string& root) {
  std::printf("\n== S4c: Open bracket.fpart, Ctrl+N, File > Save ======================\n");
  const std::string work = root + "/work";
  std::error_code ec;
  std::filesystem::create_directories(work, ec);
  const std::string userPath = work + "/bracket.fpart";
  {
    App a;
    started(a, "the launch that makes the part");
    check(a.note("BRACKET REV C -- DO NOT DELETE"), "a note on the sheet",
          a.frame->noteRefusal());
    check(a.saveTo(userPath), "saved where the user wants it", a.shell.lastDocumentError());
  }
  const Seen before = look(userPath);
  say("bracket.fpart, as the user saved it", userPath, before);

  App b;
  started(b, "a later launch, with nothing remembered");
  check(b.open(userPath), "File > Open bracket.fpart", b.shell.lastDocumentError());
  check(b.newPart(), "Ctrl+N", b.shell.lastDocumentError());
  checkStrEq(b.frame->documentPath(), std::string(), "the new document has no file of its own");
  check(!b.frame->documentDirty(), "and it is NOT dirty -- nothing has been modelled");

  ReturnOnSeedDialog dialog;
  b.frame->setFileDialog(&dialog);
  const std::size_t shown = b.frame->fileDialogsShown();
  const std::size_t warnings = b.warnings();
  const std::size_t errors = b.errors();
  const std::size_t mark = logMark(b.shell);
  b.frame->invoke("file.save");
  b.oneFrame();
  sayLog(b.shell, mark, "everything File > Save said");
  std::printf("   [strip] the status line now reads: %s\n", b.frame->lastStatus().c_str());
  check(b.frame->fileDialogsShown() == shown + 1,
        "File > Save raises a panel even on a document nothing has changed");
  std::string seed;
  if (!dialog.requests.empty()) seed = dialog.requests.back().suggestedPath;
  std::printf("   [seed] the Save panel opened pointing at: %s\n", seed.c_str());
  // What a user actually SEES: seedPanel() in FileDialogMac.mm sends the panel
  // to the seed's directory and puts the leaf in the name box.
  std::printf("   [seen] name box \"%s\", in folder %s\n",
              forge::desktop::fileDialogNameField(seed).c_str(),
              std::filesystem::path(seed).parent_path().string().c_str());
  checkStrEq(seed, userPath, "★ THE PANEL POINTS AT THE FILE THE USER JUST CLOSED");

  const Seen after = look(userPath);
  say("the same file, one Return later", userPath, after);
  std::string confirmation = "the app raised 1 panel and asked nothing else";
  confirmation += "; warnings +" + std::to_string(b.warnings() - warnings);
  confirmation += ", errors +" + std::to_string(b.errors() - errors);
  verdict("S4c", userPath, before, after, confirmation);
}

// ── S5 ─────────────────────────────────────────────────────────────────────
// NO native panel: the typed-path prompt, which is what a build with no picker
// falls back to. Save As is the command whose `path` is REQUIRED, so this is the
// route a user takes when they mean "somewhere else".
void popS5(const std::string& root) {
  std::printf("\n== S5: no native panel -- the typed-path box =========================\n");
  const std::string work = root + "/work";
  std::error_code ec;
  std::filesystem::create_directories(work, ec);
  const std::string userPath = work + "/housing.fpart";
  {
    App a;
    started(a, "the launch that makes the part");
    check(a.note("HOUSING -- MACHINED, DO NOT DELETE"), "a note on the sheet",
          a.frame->noteRefusal());
    check(a.saveTo(userPath), "saved where the user wants it", a.shell.lastDocumentError());
  }
  const Seen before = look(userPath);
  say("housing.fpart, as the user saved it", userPath, before);

  App b;
  started(b, "a later launch");
  check(b.open(userPath), "File > Open housing.fpart", b.shell.lastDocumentError());
  check(b.newPart(), "Ctrl+N", b.shell.lastDocumentError());
  // NO setFileDialog() call at all: this is the configuration where
  // makeNativeFileDialog() answered nullptr.
  const std::size_t warnings = b.warnings();
  const std::size_t errors = b.errors();
  const std::size_t mark = logMark(b.shell);
  b.frame->invoke("file.save_as");
  b.oneFrame();
  sayLog(b.shell, mark, "what asking for the name said");
  check(b.frame->fileDialogsShown() == 0, "no panel: there is none to show");
  check(b.frame->promptOpen(), "the typed-path box is what asks instead");
  checkStrEq(b.frame->promptCommand(), "file.save_as", "and it is asking for Save As");
  const std::string typed = b.frame->promptValue("path");
  std::printf("   [seed] the typed box arrived holding: %s\n", typed.c_str());
  checkStrEq(typed, userPath, "★ THE BOX IS PRE-FILLED WITH THE USER'S OTHER FILE");

  const std::size_t runMark = logMark(b.shell);
  check(b.frame->submitPrompt(), "ONE Run, with nothing typed and nothing changed");
  b.oneFrame();
  sayLog(b.shell, runMark, "everything the Run said");
  std::printf("   [strip] the status line now reads: %s\n", b.frame->lastStatus().c_str());

  const Seen after = look(userPath);
  say("the same file, one Run later", userPath, after);
  std::string confirmation = "no panel, no sheet, no question";
  confirmation += "; warnings +" + std::to_string(b.warnings() - warnings);
  confirmation += ", errors +" + std::to_string(b.errors() - errors);
  verdict("S5", userPath, before, after, confirmation);
}

// ── THE MIRROR ─────────────────────────────────────────────────────────────
// app.load_sample -> documentReset(), which keeps documentPath_ ON PURPOSE.
void popSample(const std::string& root) {
  std::printf("\n== MIRROR: app.load_sample onto an opened part =======================\n");
  const std::string work = root + "/work2";
  std::error_code ec;
  std::filesystem::create_directories(work, ec);
  const std::string userPath = work + "/flange.fpart";
  {
    App a;
    started(a, "the launch that makes the part");
    check(a.note("FLANGE -- RELEASED, DO NOT DELETE"), "a note on the sheet",
          a.frame->noteRefusal());
    check(a.saveTo(userPath), "saved where the user wants it", a.shell.lastDocumentError());
  }
  const Seen before = look(userPath);
  say("flange.fpart, as the user saved it", userPath, before);

  App b;
  started(b, "a later launch");
  check(b.open(userPath), "File > Open flange.fpart", b.shell.lastDocumentError());
  checkStrEq(b.frame->documentPath(), userPath, "the document is bound to the user's file");

  ReturnOnSeedDialog dialog;  // installed so "no panel" is a MEASURED zero
  b.frame->setFileDialog(&dialog);
  const std::size_t shown = b.frame->fileDialogsShown();
  const std::size_t warnings = b.warnings();
  const std::size_t errors = b.errors();

  const std::size_t sampleMark = logMark(b.shell);
  check(b.loadSample("bracket"), "the user clicks a sample part", b.shell.lastDocumentError());
  sayLog(b.shell, sampleMark, "what loading the sample said");
  checkStrEq(b.frame->documentPath(), userPath,
             "★ THE SAMPLE INHERITED THE OPEN PART'S FILE");
  check(b.frame->documentDirty(), "and the document is dirty: one keystroke writes it there");
  // ── IS THERE A WAY BACK? ASKED, NOT ASSUMED ────────────────────────────
  // documentReset() clears partUndo_ and app.load_sample is NotUndoable, but the
  // sample's own steps go through the registry and each pushes an entry -- so
  // the depth here is NOT zero. What matters is where those entries LEAD, which
  // is measured below by actually pressing undo until it stops.
  std::printf("   [undo] the undo stack is %zu deep after the sample loaded\n",
              b.frame->documentUndoDepth());

  const std::size_t mark = logMark(b.shell);
  check(b.save(), "a BARE Ctrl+S", b.shell.lastDocumentError());
  sayLog(b.shell, mark, "everything the keystroke said");
  std::printf("   [strip] the status line now reads: %s\n", b.frame->lastStatus().c_str());
  check(b.frame->fileDialogsShown() == shown, "NO panel was raised -- the document has a path");
  check(dialog.requests.empty(), "and the panel was not even asked for");

  const Seen after = look(userPath);
  say("the same file, one Ctrl+S later", userPath, after);

  // Every undo the user has, spent. If the flange comes back, the loss is
  // recoverable in the application; if the document empties instead, it is not.
  std::size_t undos = 0;
  while (b.frame->documentUndoDepth() > 0 && undos < 64) {
    if (!b.shell.run("edit.undo", forge::ui::CommandParams{}).ok()) break;
    ++undos;
  }
  std::printf("   [undo] %zu undos spent; the document now holds %zu features "
              "(the user's file held %zu)\n",
              undos, b.frame->documentFeatureCount(), before.features);
  check(b.frame->documentFeatureCount() != before.features,
        "★ UNDOING EVERYTHING DOES NOT BRING THE OPENED PART BACK",
        std::to_string(b.frame->documentFeatureCount()));

  std::string confirmation = "no panel, no sheet, no question";
  confirmation += "; warnings +" + std::to_string(b.warnings() - warnings);
  confirmation += ", errors +" + std::to_string(b.errors() - errors);
  verdict("mirror", userPath, before, after, confirmation);
}

// ── CONTROL 1: the seed is what does the damage ────────────────────────────
// The SAME gesture and the SAME panel-accepts-its-seed user, on an application
// that has neither opened nor saved anything -- so there is nothing in the
// recent list for the seed to come from. If this destroys a file too, then this
// probe destroys files by itself and S4/S4b/S4c prove nothing.
void popControlSeed(const std::string& root) {
  std::printf("\n== CONTROL: same gesture, empty recent list ==========================\n");
  const std::string work = root + "/work";
  std::error_code ec;
  std::filesystem::create_directories(work, ec);
  const std::string userPath = work + "/untouched.fpart";
  {
    App a;
    started(a, "the launch that makes the part");
    check(a.note("UNTOUCHED -- NOTHING SHOULD REACH THIS"), "a note on the sheet",
          a.frame->noteRefusal());
    check(a.saveTo(userPath), "saved where the user wants it", a.shell.lastDocumentError());
  }
  const Seen before = look(userPath);
  say("untouched.fpart, as the user saved it", userPath, before);

  App b;
  started(b, "a launch that never opens or saves anything");
  checkStrEq(b.shell.recentDocuments().mostRecent(), std::string(),
             "its recent list is empty");
  check(b.addBox(), "the user models something");
  ReturnOnSeedDialog dialog;
  b.frame->setFileDialog(&dialog);
  b.frame->invoke("file.save");
  b.oneFrame();
  std::string seed;
  if (!dialog.requests.empty()) seed = dialog.requests.back().suggestedPath;
  std::printf("   [seed] the Save panel opened pointing at: %s\n", seed.c_str());
  // What a user actually SEES: seedPanel() in FileDialogMac.mm sends the panel
  // to the seed's directory and puts the leaf in the name box.
  std::printf("   [seen] name box \"%s\", in folder %s\n",
              forge::desktop::fileDialogNameField(seed).c_str(),
              std::filesystem::path(seed).parent_path().string().c_str());
  check(seed != userPath, "the panel does NOT point at the user's file", seed);

  const Seen after = look(userPath);
  say("untouched.fpart, after the same gesture", userPath, after);
  verdict("control-seed", userPath, before, after, "n/a -- this is the negative control");
}

// ── CONTROL 2: documentReset's kept path is what does the damage ───────────
// The mirror with File > New in place of the sample. documentNew() CLEARS
// documentPath_, so the same bare Ctrl+S must land somewhere else and leave the
// user's file alone.
void popControlReset(const std::string& root) {
  std::printf("\n== CONTROL: File > New in place of the sample ========================\n");
  const std::string work = root + "/work2";
  std::error_code ec;
  std::filesystem::create_directories(work, ec);
  const std::string userPath = work + "/flange.fpart";
  {
    App a;
    started(a, "the launch that makes the part");
    check(a.note("FLANGE -- RELEASED, DO NOT DELETE"), "a note on the sheet",
          a.frame->noteRefusal());
    check(a.saveTo(userPath), "saved where the user wants it", a.shell.lastDocumentError());
  }
  const Seen before = look(userPath);
  say("flange.fpart, as the user saved it", userPath, before);

  App b;
  started(b, "a later launch");
  check(b.open(userPath), "File > Open flange.fpart", b.shell.lastDocumentError());
  check(b.newPart(), "File > New -- not the sample", b.shell.lastDocumentError());
  checkStrEq(b.frame->documentPath(), std::string(), "which DOES clear the document's path");
  check(b.addBox(), "the user models something");
  check(b.save(), "a BARE Ctrl+S", b.shell.lastDocumentError());
  std::printf("   [went] the save landed on: %s\n", b.frame->documentPath().c_str());
  check(b.frame->documentPath() != userPath, "and it did NOT land on the user's file",
        b.frame->documentPath());

  const Seen after = look(userPath);
  say("flange.fpart, after the same keystroke", userPath, after);
  verdict("control-reset", userPath, before, after, "n/a -- this is the negative control");
}

}  // namespace

int main(int argc, char** argv) {
  std::string population;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--pop") == 0 && i + 1 < argc) population = argv[++i];
  }
  if (population.empty()) {
    std::printf("usage: %s --pop S4|S4b|S4c|S5|sample|control-seed|control-reset\n", argv[0]);
    return 2;
  }

  const char* tmp = std::getenv("TMPDIR");
  std::string root = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!root.empty() && root.back() == '/') root.pop_back();
  root += "/forge_save_seed_probe/" + population;
  std::error_code ec;
  std::filesystem::remove_all(root, ec);  // a rerun must not inherit yesterday's evidence
  std::filesystem::create_directories(root, ec);

  // ── THIS PROBE MUST NOT TOUCH THE USER'S OWN FILES ─────────────────────
  // A bare Ctrl+S with nowhere to go writes $HOME/.forge/<name>.fpart, and
  // documentSave() does not create that directory. HOME is redirected for THIS
  // PROCESS ONLY, once, before any kernel work starts.
  const std::string fakeHome = root + "/home";
  std::filesystem::create_directories(fakeHome + "/.forge", ec);
  if (::setenv("HOME", fakeHome.c_str(), 1) != 0) {
    std::printf("[probe] could not redirect HOME; refusing to write into the real one\n");
    return 1;
  }
  // A bare name accepted from a Save panel lands in the working directory, so
  // the working directory is the probe's own scratch too.
  std::filesystem::current_path(root, ec);

  std::printf("=== Forge T-122 save-seed probe ===\n");
  std::printf("  population: %s\n", population.c_str());
  std::printf("  scratch   : %s\n", root.c_str());
  std::printf("  HOME      : %s\n", fakeHome.c_str());

  HeadlessImGui imgui;

  if (population == "S4") {
    popS4(root);
  } else if (population == "S4b") {
    popS4b(root);
  } else if (population == "S4c") {
    popS4c(root);
  } else if (population == "S5") {
    popS5(root);
  } else if (population == "sample") {
    popSample(root);
  } else if (population == "control-seed") {
    popControlSeed(root);
  } else if (population == "control-reset") {
    popControlReset(root);
  } else {
    std::printf("[probe] unknown population '%s'\n", population.c_str());
    return 2;
  }

  std::printf("\n[probe] %d checks, %d failures\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
