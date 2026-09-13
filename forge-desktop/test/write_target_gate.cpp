// forge-desktop/test/write_target_gate.cpp
//
// THE WRITE-TARGET GATE — WHAT DOES A *COPY* LAND ON, AND WHAT WILL FORGE
// REFUSE TO WRITE OVER?
//
// T-122 asked what a SAVE PANEL points at and pinned the answer in two gates.
// Both of them printed GREEN — 243 checks / 0 failures, and "7 populations, all
// green" — on the very tree where one Run in the TYPED-PATH BOX turned a user's
// part into a STEP file. That is not a gap in those gates' honesty; it is their
// SCOPE. They walk the panel route. T-123 lived one route over, at the edge:
//
//     three axes  {the typed box} x {an EXPORT command} x {a document that HAS
//     a file}, and every check that existed covered two of the three at a time.
//
// MEASURED on 5fb5ff59, with no panel installed, on an open bracket.fpart:
//
//   file.export_step   1 NOTE / 5 FEATURE / 661 B  ->  53903 B ISO-10303-21
//   file.export_brep                               ->  33491 B DBRep_DrawableShape
//   file.export_stl                                ->  73394 B 'solid forge'
//   file.export_gcode                              ->  22077 B Fanuc G-code
//
// with the status strip reading "<label> - done", one [info] line in the
// activity log, errors +0, no backup, and File > Open on the same path then
// refused with "not a .fpart file".
//
// ── WHAT THIS GATE ASSERTS, AND WHY IT IS TWO CLAIMS AND NOT ONE ───────────
// The fix is two things and they defend different routes, so the gate measures
// them separately and a mutation can tell them apart:
//
//   THE SEED   the typed box now holds exactly what the PANEL would open on,
//              because both go through forge::desktop::fileDialogSuggestedPath().
//              W1 asserts EQUALITY BETWEEN THE TWO ROUTES rather than a literal
//              "bracket.step": a check that names today's answer can be
//              satisfied by fixing one route again, which is how this family
//              reached its seventh member.
//   THE GUARD  ForgeShell::refuseTargetIsDocument() is the last line before
//              bytes in BOTH export handlers, so a path that names a Forge part
//              is refused however it arrived -- typed, panelled, from a macro,
//              from an Archie tool call or from --open. W2 is that route with no
//              box at all, and it stays green if somebody reverts the seed.
//
// ── THE WALK IS DERIVED, NEVER A LIST ──────────────────────────────────────
// W1 does not enumerate four command ids. It walks
// forge::desktop::fileDialogCommandIds(), keeps every SAVE-mode row that is not
// one of the two document saves, and REQUIRES the count to be 4. A tenth file
// command that writes a copy therefore arrives inside this walk by default and
// is red on arrival if it skipped the guard -- and `walked == 4` is load-bearing
// rather than decoration: file.export_gcode's box only opens once
// ForgeFrame::hasMachineProgram() is true, and a walk that silently skipped the
// worst of the four is the exact shape of the hole this file exists to close.
//
// ── RUN ONE POPULATION PER PROCESS ─────────────────────────────────────────
//     forge_desktop_write_target_gate --pop typed-box|typed-path|renamed|allows|native-panel
// With NO --pop the binary re-execs ITSELF once per population and fails if any
// child does. One per process for the reason save_target_gate gives: the OCCT
// path enforces a PROCESS-GLOBAL wall-clock window and every seeded application
// spends some of it.
//
// --mutate 1..6 proves the gate can fail; see kMutations in main().
#include <algorithm>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <optional>
#include <string>
#include <system_error>
#include <vector>

#include <stdlib.h>    // ::setenv, for the HOME redirect
#include <sys/wait.h>  // waitpid, WIFEXITED -- the status read FROM THE PROCESS
#include <unistd.h>    // fork, execv

#include "imgui.h"

#include "FileDialog.hpp"
#include "FileExchangeHost.hpp"
#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FileExchange.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/MachineProgram.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace {

int g_checks = 0;
int g_failures = 0;
// See the mutation list in main(). 0 is the shipping configuration.
int g_mutation = 0;

void check(bool ok, const std::string& what, const std::string& detail = std::string()) {
  ++g_checks;
  if (ok) return;
  ++g_failures;
  std::printf("  FAIL  %-62s  %s\n", what.c_str(), detail.c_str());
}

void checkStrEq(const std::string& got, const std::string& want, const std::string& what) {
  ++g_checks;
  if (got == want) return;
  ++g_failures;
  std::printf("  FAIL  %-62s\n    got  |%s|\n    want |%s|\n", what.c_str(), got.c_str(),
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
    io.BackendRendererName = "write_target_gate_null";
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
// It accepts the path it was handed. A panel that answered anything else would
// be measuring this gate's imagination instead of the application's suggestion.
class ReturnOnSeedDialog final : public forge::desktop::FileDialog {
 public:
  std::vector<forge::desktop::FileDialogRequest> requests;
  std::string defectPath;  // mutation 1 only; see run()

  forge::desktop::FileDialogResult run(
      const forge::desktop::FileDialogRequest& request) override {
    requests.push_back(request);
    forge::desktop::FileDialogResult out;
    out.accepted = true;
    // MUTATION 1: the panel answers THE USER'S OWN DOCUMENT rather than the path
    // it was seeded with -- T-122's shipped defect, injected at this gate's own
    // knob. The copy then never lands where the panel pointed and the export is
    // refused instead, so W5's "the copy landed there" and "errors +0" checks
    // must go red.
    out.path = (g_mutation == 1 && !defectPath.empty()) ? defectPath : request.suggestedPath;
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

bool writeWholeFile(const std::string& path, const std::string& text) {
  std::FILE* f = std::fopen(path.c_str(), "wb");
  if (f == nullptr) return false;
  const std::size_t n = std::fwrite(text.data(), 1, text.size(), f);
  std::fclose(f);
  return n == text.size();
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

// What a user's file holds, read as BYTES -- never a length alone. The .fpart
// writer opens an annotation block with "\nNOTE\n" and a feature block with
// "\nFEATURE\n", so a file that kept its size and lost its content still moves
// these numbers, and the first line says what KIND of file it is.
struct Seen {
  bool exists = false;
  std::size_t notes = 0;
  std::size_t features = 0;
  std::size_t bytes = 0;
  std::string text;
  std::string head;
};

Seen look(const std::string& path) {
  Seen s;
  s.text = readWholeFile(path);
  s.exists = !s.text.empty();
  s.bytes = s.text.size();
  s.notes = rawCount(s.text, "\nNOTE\n");
  s.features = rawCount(s.text, "\nFEATURE\n");
  const std::size_t nl = s.text.find('\n');
  s.head = s.text.substr(
      0, nl == std::string::npos ? std::min<std::size_t>(s.text.size(), 40) : nl);
  return s;
}

void say(const char* label, const std::string& path, const Seen& s) {
  std::printf("   [raw] %-38s %zu NOTE / %zu FEATURE / %zu bytes  |%s|  (%s)\n", label, s.notes,
              s.features, s.bytes, s.head.c_str(), path.c_str());
}

std::size_t logMark(const forge::ui::ForgeShell& shell) {
  const forge::ui::LogEntry* last = shell.log().last();
  return last == nullptr ? 0 : last->sequence;
}

void sayLog(const forge::ui::ForgeShell& shell, std::size_t mark, const std::string& label) {
  const std::vector<forge::ui::LogEntry> fresh = shell.log().since(mark);
  std::printf("   [said] %s -- %zu line(s) in the activity log\n", label.c_str(), fresh.size());
  for (const forge::ui::LogEntry& e : fresh) {
    std::printf("          %s\n", e.render().c_str());
  }
}

// The file the user owns did not move at all. BYTES, not a length.
void checkUntouched(const Seen& before, const Seen& after, const std::string& path,
                    const std::string& what) {
  check(before.exists, "the user's part was there to begin with", path);
  check(after.text == before.text, what,
        std::to_string(before.notes) + "/" + std::to_string(before.features) + "/" +
            std::to_string(before.bytes) + " -> " + std::to_string(after.notes) + "/" +
            std::to_string(after.features) + "/" + std::to_string(after.bytes) + " |" +
            after.head + "|");
}

// ── THE COMMANDS THIS GATE WALKS, DERIVED FROM THE POLICY TABLE ────────────
// Every SAVE-mode row that is not one of the two document saves: those two
// REPLACE the file you chose, which is what Save means, and every other one
// writes a SECOND file. Derived rather than listed so a seventh write command
// is inside this walk the day it is registered.
std::vector<std::string> copyCommands() {
  std::vector<std::string> out;
  for (const std::string& id : forge::desktop::fileDialogCommandIds()) {
    forge::desktop::FileDialogPolicy policy;
    if (!forge::desktop::fileDialogPolicyFor(id, policy)) continue;
    if (policy.mode != forge::desktop::FileDialogMode::Save) continue;
    if (id == "file.save" || id == "file.save_as") continue;
    out.push_back(id);
  }
  return out;
}

// One application: its own kernel scene, its own shell, its own frame builder,
// and the same FileExchangeHost main.cpp installs.
struct App {
  forge::desktop::KernelScene scene;
  forge::ui::ForgeShell shell;
  std::optional<forge::desktop::ForgeFrame> frame;
  std::optional<forge::desktop::FileExchangeHost> exchange;

  bool start() {
    if (!scene.build()) return false;
    frame.emplace(shell, scene);
    frame->wirePartCommands();
    // AFTER wirePartCommands(), exactly as main.cpp does it and for the reason
    // it gives: an Import states its body through a Part command.
    exchange.emplace(frame->document(), &scene);
    shell.setFileExchange(&*exchange);
    return true;
  }

  void oneFrame() {
    ImGui::NewFrame();
    frame->build(0, 1.0f);
    ImGui::Render();
  }

  // ── DID *THIS* ONE REFUSE? THE COUNTER, NEVER THE STRING ────────────────
  // shell.lastDocumentError() is STICKY -- only the file, undo/redo and reset
  // commands clear it -- so `r.ok() && error.empty()` answers "has anything ever
  // failed" once a population has deliberately provoked a refusal. Every leg
  // below provokes several. documentErrorSeq() is the discriminator ForgeShell's
  // own recordDispatch uses, for the same reason.
  bool ran(const std::string& id, const forge::ui::CommandParams& params) {
    const std::size_t before = shell.documentErrorSeq();
    const forge::ui::DispatchResult r = shell.run(id, params);
    return r.ok() && shell.documentErrorSeq() == before;
  }

  bool saveTo(const std::string& path) {
    forge::ui::CommandParams params;
    params.setText("path", path);
    return ran("file.save", params);
  }

  bool open(const std::string& path) {
    forge::ui::CommandParams params;
    params.setText("path", path);
    return ran("file.open", params);
  }

  bool note(const std::string& text) {
    return frame->drawingAddNote(text, forge::ui::AnnotationKind::Note,
                                 forge::ui::NamedView::Front, false);
  }

  // Brings `panelId` to the front of whichever tab group holds it and lets the
  // frame draw it, through the frame's OWN recorded tab hits -- which is how the
  // application itself addresses a tab. Same helper cam_panels_gate uses.
  bool showPanel(const std::string& panelId) {
    oneFrame();
    oneFrame();
    for (const forge::desktop::TabHit& hit : frame->tabHits()) {
      if (hit.panelId != panelId) continue;
      frame->setActiveTabAt(hit.path, hit.index);
      oneFrame();
      oneFrame();
      const std::vector<std::string>& drawn = frame->panelIdsDrawn();
      return std::find(drawn.begin(), drawn.end(), panelId) != drawn.end();
    }
    return false;
  }

  // ── MAKE file.export_gcode LIVE THE WAY A USER DOES ──────────────────────
  // hasMachineProgram() deliberately COMPUTES NOTHING ("and that is the
  // contract"), so the only way to a program is the Manufacturing workspace
  // actually drawing its panels. The section height seeds itself from the built
  // body's bounding box inside ensureCamPlan().
  bool wireMachineProgram() {
    // MUTATION 6: the CAM panels are never drawn, so there is no program,
    // file.export_gcode stays disabled, and the W1 walk finds three commands
    // instead of four. `walked == 4` is what refuses that.
    if (g_mutation == 6) return frame->hasMachineProgram();
    shell.setWorkspace(forge::ui::WorkspaceProfile::Manufacturing);
    const bool tools = showPanel("tool_library");
    const bool post = showPanel("post_output");
    std::printf("   [cam] tool library drawn=%s, post output drawn=%s, has a program=%s\n",
                tools ? "yes" : "no", post ? "yes" : "no",
                frame->hasMachineProgram() ? "true" : "false");
    return frame->hasMachineProgram();
  }

  void sayScene(const char* when) {
    const forge::desktop::IrBuildReport& r = scene.lastBuild();
    std::printf("   [scene] %-22s built=%s ok=%s parsed=%s compiled=%s tess=%s tris=%zu err=|%s| failedOp=%d\n",
                when, scene.built() ? "yes" : "no", r.ok() ? "yes" : "no",
                r.parsed ? "yes" : "no", r.compiled ? "yes" : "no",
                r.tessellated ? "yes" : "no", r.triangles, r.error.c_str(), r.failedOpId);
  }

  std::size_t warnings() const { return shell.log().count(forge::ui::Severity::Warning); }
  std::size_t errors() const { return shell.log().count(forge::ui::Severity::Error); }
};

// An application that did not start is not a failing check -- it is a gate that
// could not ask its question. Says so and ends the run, which flushes.
void started(App& app, const std::string& what) {
  check(app.start(), what, app.scene.error());
  if (app.frame) return;
  std::printf("\n[gate] %d checks, %d failures\n", g_checks, g_failures);
  std::printf("[gate] NO APPLICATION -- the kernel's reason: %s\n", app.scene.error().c_str());
  std::exit(1);
}

// Makes the part every population is about: the application's own part with a
// note on its sheet, saved where the user wants it -- through the ONE registry,
// never written by hand. 1 NOTE / 5 FEATURE, which is the shape the reproduce
// phase measured being destroyed.
//
// NO EXTRA SOLID ON TOP. MEASURED: part.primitive_box on a document that already
// holds a part states a SECOND independent body, and reopening that file then
// fails the kernel's own graph-quality gate ("unexplained_orphans=5 [%1..%5] --
// these ops contribute nothing to the result"). The document would not compile,
// so every export would refuse for a reason that has nothing to do with this
// gate's question and the allow branch could never be measured at all.
std::string makeUserPart(const std::string& work, const std::string& leaf,
                         const std::string& noteText) {
  std::error_code ec;
  std::filesystem::create_directories(work, ec);
  const std::string userPath = work + "/" + leaf;
  App a;
  started(a, "the launch that makes the part");
  check(a.note(noteText), "the user types a note on the sheet", a.frame->noteRefusal());
  check(a.saveTo(userPath), "saved where the user wants it", a.shell.lastDocumentError());
  return userPath;
}

// ── THE PRODUCER'S OWN RULES ───────────────────────────────────────────────
// fileDialogSuggestedPath() is the one body the panel and the box now share, and
// three of its branches cannot be reached through either UI today: no command
// with a `path` parameter is missing a policy row, and an Open box is never a
// Save. A branch nothing can reach is a branch nothing can falsify, so they are
// asserted here directly -- and so are the two properties that make routing the
// box through it safe: an empty seed stays empty (a blank box stays blank) and
// the transform is idempotent (the untitled seed already carries the suffix).
void checkTheProducer() {
  std::printf("\n   -- the producer itself --\n");
  const std::string part = "/w/bracket.fpart";
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.export_step", part),
             "/w/bracket.step", "a copy command names the file IT writes");
  // ★ A .fpart CANNOT ASK THIS QUESTION. file.open's policy row carries
  //   defaultExtension ".fpart" whatever its mode, so swapping the suffix onto a
  //   path that already ends .fpart is the identity and a check written that way
  //   passes with the mode test deleted -- MEASURED, it stayed green. A document
  //   is opened on its CONTENT, not its name (DocumentModel refuses anything
  //   whose line 1 is not the magic), so a part called bracket.txt is a document
  //   Forge really can open, and its Open box must not point at a file that does
  //   not exist.
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.open", "/w/bracket.txt"),
             "/w/bracket.txt",
             "an OPEN box keeps the path as given -- naming a file that exists is the point");
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.import_step", "/w/bracket.txt"),
             "/w/bracket.txt", "and so does an Import box");
  checkStrEq(forge::desktop::fileDialogSuggestedPath("part.primitive_box", part), part,
             "a command with no policy row is not a file command, and keeps its seed");
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.save_as", part), part,
             "Save As on a part is the identity, so what file.save writes cannot move");
  // ★ THE ONE BEHAVIOUR CHANGE BEYOND THE DEFECT, PINNED RATHER THAN LEFT TO BE
  //   DISCOVERED. A document is opened on its CONTENT, so a part called
  //   bracket.txt really can be open -- and a Save As box on it now starts on
  //   bracket.fpart. That is not a new opinion: it is exactly what the shipping
  //   native panel has always offered for file.save_as, and the direction is the
  //   safe one, because the box now names a file that is NOT the original.
  //   file.save is untouched: its `path` is optional, so it dispatches without
  //   ever raising a box.
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.save_as", "/w/bracket.txt"),
             "/w/bracket.fpart", "and Save As adopts the panel's own answer on a part "
             "whose file is not called .fpart");
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.export_step", std::string()),
             std::string(), "an empty seed stays empty -- a blank box stays blank");
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.export_step", "/w/bracket.step"),
             "/w/bracket.step", "and it is idempotent, so the untitled seed is untouched");
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.export_step", "/w.v1/bracket"),
             "/w.v1/bracket.step", "a dot in a FOLDER name is not an extension");
}

// ── W1 ─────────────────────────────────────────────────────────────────────
// THE THREE AXES AT ONCE: the typed box, a copy command, and a document that HAS
// a file. This is the cell no existing check covers.
void popTypedBox(const std::string& root) {
  std::printf("\n== W1: the typed box, every copy command, on a document that HAS a file ==\n");
  checkTheProducer();
  const std::string work = root + "/work";
  const std::string userPath = makeUserPart(work, "bracket.fpart", "BRACKET -- RELEASED");
  const Seen before = look(userPath);
  say("bracket.fpart, as the user saved it", userPath, before);

  App b;
  started(b, "a later launch");
  check(b.open(userPath), "File > Open bracket.fpart", b.shell.lastDocumentError());
  checkStrEq(b.frame->documentPath(), userPath, "the document is bound to the user's file");
  // NO setFileDialog() at all: the configuration every headless build and any
  // future non-Apple port runs in, and the one with no confirmation of any kind.
  check(b.wireMachineProgram(), "the Manufacturing workspace has posted a program", "");

  const std::size_t warnings = b.warnings();
  const std::size_t errors = b.errors();
  std::size_t walked = 0;
  for (const std::string& id : copyCommands()) {
    const forge::ui::DispatchResult pre =
        b.shell.registry().evaluate(id, b.shell.selection(), forge::ui::CommandParams{});
    std::printf("\n   -- %s --  the registry says: %s %s\n", id.c_str(),
                std::string(forge::ui::machineName(pre.status)).c_str(), pre.detail.c_str());
    const std::size_t mark = logMark(b.shell);
    b.frame->invoke(id);
    b.oneFrame();
    check(b.frame->fileDialogsShown() == 0, "no panel: there is none to show in this build");
    if (!b.frame->promptOpen()) {
      check(false, id + ": the typed box is what asks instead", b.shell.lastDocumentError());
      continue;
    }
    checkStrEq(b.frame->promptCommand(), id, "and it is asking for this command");
    const std::string typed = b.frame->promptValue("path");
    std::printf("   [seed] the typed box arrived holding: %s\n", typed.c_str());

    // ★ THE ASSERTION IS AN EQUALITY BETWEEN THE TWO ROUTES, not a literal.
    //   A check that named bracket.step would be satisfied by fixing this one
    //   route again -- which is what the six fixes before this one did.
    forge::desktop::FileDialogRequest request;
    check(forge::desktop::fileDialogRequestFor(id, b.frame->pathSeedFor(id), request),
          id + ": the panel has a request to build from the same seed");
    checkStrEq(typed, request.suggestedPath,
               "★ " + id + ": the TYPED BOX holds what the PANEL opens on");
    check(typed != b.frame->documentPath(),
          "★ " + id + ": a copy box is NOT pre-filled with the user's own part", typed);

    // MUTATION 2: never press Run. Every seed check above still passes -- a gate
    // that only read the text box would stay green on a Forge that writes
    // nothing at all.
    if (g_mutation != 2) {
      check(b.frame->submitPrompt(), id + ": ONE Run, with nothing typed and nothing changed");
      b.oneFrame();
    }
    sayLog(b.shell, mark, "everything that gesture said");
    std::printf("   [strip] the status line now reads: %s\n", b.frame->lastStatus().c_str());

    const Seen now = look(userPath);
    checkUntouched(before, now, userPath,
                   "★ " + id + ": AND THE USER'S PART IS BYTE-IDENTICAL AFTERWARDS");
    const Seen landed = look(typed);
    say("what the copy command wrote", typed, landed);
    check(landed.exists, "★ " + id + ": and the copy WAS written, rather than refused", typed);
    check(landed.text != before.text, id + ": at a path that is not the user's part", typed);
    ++walked;
    b.frame->cancelPrompt();
  }

  // ★ LOAD-BEARING. file.export_gcode's box opens only once hasMachineProgram()
  //   is true; a walk that silently skipped the worst of the four is the exact
  //   shape of the hole this gate exists to close.
  check(walked == 4, "★ all four copy commands were walked", std::to_string(walked));
  std::printf("\n  [W1] the user's part: %zu NOTE / %zu FEATURE / %zu bytes, unchanged\n",
              before.notes, before.features, before.bytes);
  std::printf("  [W1] warnings +%zu, errors +%zu\n", b.warnings() - warnings,
              b.errors() - errors);
}

// ── W2 ─────────────────────────────────────────────────────────────────────
// THE GUARD WITHOUT THE SEED: the path is supplied, so neither a box nor a panel
// is raised at all. That is what a macro, an Archie tool call and --open do (and
// it is why T-124's `overrides.has("path")` route cannot destroy a part either).
// This population stays green if somebody reverts the seed fix and goes red if
// somebody removes the guard -- which is how the two are told apart.
void popTypedPath(const std::string& root) {
  std::printf("\n== W2: the path is TYPED (or sent by a macro): no box, no panel =========\n");
  const std::string work = root + "/work";
  const std::string userPath = makeUserPart(work, "bracket.fpart", "BRACKET -- RELEASED");
  const Seen before = look(userPath);
  say("bracket.fpart, as the user saved it", userPath, before);

  App b;
  started(b, "a later launch");
  check(b.open(userPath), "File > Open bracket.fpart", b.shell.lastDocumentError());
  check(b.wireMachineProgram(), "the Manufacturing workspace has posted a program", "");

  for (const std::string& id : copyCommands()) {
    // MUTATION 3: the command is sent the COPY's own name instead of the part's,
    // so nothing destructive is asked for and every refusal check below must go
    // red. It is what stops this population passing on a Forge that refuses
    // every export.
    std::string target = userPath;
    if (g_mutation == 3) target = forge::desktop::fileDialogSuggestedPath(id, userPath);
    forge::ui::CommandParams params;
    params.setText("path", target);
    const std::size_t errorsBefore = b.errors();
    const std::size_t seqBefore = b.shell.documentErrorSeq();
    const std::size_t mark = logMark(b.shell);
    const forge::ui::DispatchResult r = b.shell.run(id, params);
    sayLog(b.shell, mark, "what " + id + " said");
    std::printf("   [ask] %s -> %s   |%s|\n", id.c_str(),
                r.ok() ? "dispatch ok" : "dispatch not ok", b.shell.lastDocumentError().c_str());

    check(b.shell.documentErrorSeq() != seqBefore, "★ " + id + ": the command REFUSED",
          b.shell.lastDocumentError());
    check(b.errors() == errorsBefore + 1,
          "★ " + id + ": and said so where a user reads -- errors +1",
          std::to_string(b.errors() - errorsBefore));
    check(b.shell.lastDocumentError().find(userPath) != std::string::npos,
          id + ": the sentence names the file it would not write over",
          b.shell.lastDocumentError());
    if (id == "file.export_gcode") {
      check(b.shell.lastMachineProgram().refusal ==
                forge::ui::MachineProgramRefusal::TargetIsDocument,
            id + ": for the reason the closed set has a value for",
            forge::ui::toString(b.shell.lastMachineProgram().refusal));
    } else {
      check(b.shell.lastExchange().refusal == forge::ui::ExchangeRefusal::TargetIsDocument,
            id + ": for the reason the closed set has a value for",
            forge::ui::toString(b.shell.lastExchange().refusal));
    }
    const Seen now = look(userPath);
    checkUntouched(before, now, userPath,
                   "★ " + id + ": AND THE USER'S PART IS BYTE-IDENTICAL AFTERWARDS");
  }

  // ── AND THE TWO CASES ONLY *IDENTITY* CAN ANSWER ────────────────────────
  // Everything above is caught twice over: the target IS the open document and
  // it also HOLDS a part. These two are the isolating cases, and they are what
  // makes the identity half of the guard falsifiable rather than decorative.
  //
  // (e) THE PART IS MOVED OUT FROM UNDER THE DOCUMENT. The file is gone, so
  //     there are no bytes to recognise -- and a copy written to the path this
  //     document still calls its own is how a bracket.fpart full of STEP appears
  //     where the user expects their part.
  {
    std::error_code ec;
    std::filesystem::remove(userPath, ec);
    check(!std::filesystem::exists(userPath, ec), "the user moves their part away", userPath);
    forge::ui::CommandParams params;
    params.setText("path", userPath);
    const std::size_t seqBefore = b.shell.documentErrorSeq();
    b.shell.run("file.export_step", params);
    std::printf("   [gone] the document still calls %s its own; nothing is there\n",
                userPath.c_str());
    std::printf("   [ask] file.export_step onto it -> |%s|\n",
                b.shell.lastDocumentError().c_str());
    check(b.shell.documentErrorSeq() != seqBefore,
          "★ a copy still may not take the open document's own name", b.shell.lastDocumentError());
    check(!std::filesystem::exists(userPath, ec),
          "★ and nothing was created where the part used to be", userPath);
  }

  // (f) THE SAME FILE UNDER A DIFFERENT SPELLING, holding something Forge did
  //     not write. "/w/./bracket.fpart" and "/w/bracket.fpart" are two strings
  //     and one file; the content clause has nothing to recognise here, and a
  //     plain string compare calls them different.
  {
    check(writeWholeFile(userPath, "something else entirely\n"),
          "something that is not a part is at the document's own path");
    const std::string spelled = work + "/./bracket.fpart";
    forge::ui::CommandParams params;
    params.setText("path", spelled);
    const std::size_t seqBefore = b.shell.documentErrorSeq();
    b.shell.run("file.export_step", params);
    std::printf("   [same] %s  and  %s\n", userPath.c_str(), spelled.c_str());
    std::printf("   [ask] file.export_step onto the second spelling -> |%s|\n",
                b.shell.lastDocumentError().c_str());
    check(b.shell.documentErrorSeq() != seqBefore,
          "★ two names for one file are one file", b.shell.lastDocumentError());
    check(readWholeFile(userPath) == "something else entirely\n",
          "★ and that file was not written over either", readWholeFile(userPath));
  }
}

// ── W3 ─────────────────────────────────────────────────────────────────────
// CONTENT, NOT NAME. A part the user renamed is still a part, and it is not the
// document that is open either. Any guard written about the extension passes W1
// and W2 and fails here.
void popRenamed(const std::string& root) {
  std::printf("\n== W3: a Forge part that is NOT called .fpart, and is NOT the open one ===\n");
  const std::string work = root + "/work";
  const std::string userPath = makeUserPart(work, "bracket.fpart", "BRACKET -- RELEASED");
  const std::string decoy = work + "/bracket.step";
  // MUTATION 4: the decoy is ordinary STEP text rather than a renamed part, so
  // the content clause has nothing to find and the refusal checks below must go
  // red -- which is what proves this population reads the CONTENT.
  if (g_mutation == 4) {
    check(writeWholeFile(decoy, "ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n"),
          "an ordinary STEP file is at that name");
  } else {
    check(writeWholeFile(decoy, readWholeFile(userPath)),
          "the user's part, under a name that says STEP");
  }
  const Seen before = look(decoy);
  say("bracket.step, before", decoy, before);

  App b;
  started(b, "a launch with a DIFFERENT document open");
  check(b.note("ANOTHER PART"), "the user is working on something else",
        b.frame->noteRefusal());
  const std::string other = work + "/other.fpart";
  check(b.saveTo(other), "and saves it", b.shell.lastDocumentError());
  checkStrEq(b.frame->documentPath(), other, "so the open document is NOT the decoy");

  forge::ui::CommandParams params;
  params.setText("path", decoy);
  const std::size_t seqBefore = b.shell.documentErrorSeq();
  const std::size_t mark = logMark(b.shell);
  const forge::ui::DispatchResult r = b.shell.run("file.export_step", params);
  sayLog(b.shell, mark, "what Save a Copy as STEP said");
  std::printf("   [ask] file.export_step onto bracket.step -> %s  |%s|\n",
              r.ok() ? "dispatch ok" : "dispatch not ok", b.shell.lastDocumentError().c_str());
  check(b.shell.documentErrorSeq() != seqBefore,
        "★ a part is a part whatever it is called -- REFUSED", b.shell.lastDocumentError());
  check(b.shell.lastExchange().refusal == forge::ui::ExchangeRefusal::TargetIsDocument,
        "for the reason the closed set has a value for",
        forge::ui::toString(b.shell.lastExchange().refusal));
  const Seen after = look(decoy);
  say("bracket.step, after", decoy, after);
  check(after.text == before.text, "★ AND IT IS BYTE-IDENTICAL AFTERWARDS",
        std::to_string(before.bytes) + " -> " + std::to_string(after.bytes));
}

// ── W4 ─────────────────────────────────────────────────────────────────────
// THE ALLOW BRANCH STILL ALLOWS. Without this population a Forge that refused
// every export would pass W1, W2 and W3 -- and "refuse everything" is the
// cheapest wrong fix available.
void popAllows(const std::string& root) {
  std::printf("\n== W4: what a copy command must STILL do =================================\n");
  const std::string work = root + "/work";
  const std::string userPath = makeUserPart(work, "bracket.fpart", "BRACKET -- RELEASED");
  const Seen partBefore = look(userPath);

  App b;
  started(b, "a later launch");
  check(b.open(userPath), "File > Open bracket.fpart", b.shell.lastDocumentError());

  b.oneFrame();
  b.sayScene("the part this copy is made from");
  check(b.scene.lastBuild().ok(), "the part COMPILES, so nothing below can refuse for that",
        b.scene.lastBuild().error);

  // (a) a free name.
  const std::string copyPath = work + "/bracket.step";
  {
    forge::ui::CommandParams params;
    params.setText("path", copyPath);
    check(b.ran("file.export_step", params), "★ a copy to a free name is WRITTEN",
          b.shell.lastDocumentError());
  }
  const Seen firstCopy = look(copyPath);
  say("the copy", copyPath, firstCopy);
  check(firstCopy.exists && firstCopy.head.rfind("ISO-10303-21", 0) == 0,
        "and it really is STEP text", firstCopy.head);

  // (b) RE-EXPORTING OVER YESTERDAY'S COPY IS ORDINARY INTENT. The file is
  //     stubbed first so "it was replaced" is a fact about bytes rather than
  //     about two identical writes.
  check(writeWholeFile(copyPath, "stub\n"), "the earlier copy is stubbed to 5 bytes");
  {
    // MUTATION 5: the re-export goes to a FRESH name, so the stub is never
    // replaced and the check below must go red.
    const std::string target = (g_mutation == 5) ? (work + "/bracket-2.step") : copyPath;
    forge::ui::CommandParams params;
    params.setText("path", target);
    check(b.ran("file.export_step", params), "a re-export is WRITTEN",
          b.shell.lastDocumentError());
  }
  const Seen secondCopy = look(copyPath);
  say("the copy, re-exported", copyPath, secondCopy);
  check(secondCopy.bytes == firstCopy.bytes && secondCopy.head.rfind("ISO-10303-21", 0) == 0,
        "★ and re-exporting over the earlier copy REPLACED it",
        std::to_string(firstCopy.bytes) + " -> " + std::to_string(secondCopy.bytes));

  // (c) a file Forge has no opinion about is still written over. STATED here,
  //     because it is the limit of this fix: the guard asks whether the target
  //     is a Forge part, not whether it is occupied. See the commit message.
  const std::string notes = work + "/notes.txt";
  check(writeWholeFile(notes, "the user's own notes\n"), "an ordinary file is in the way");
  {
    forge::ui::CommandParams params;
    params.setText("path", notes);
    check(b.ran("file.export_step", params),
          "a copy onto a file that is NOT a part is still written -- the stated limit",
          b.shell.lastDocumentError());
  }

  // (d) AND SAVE IS NOT AN EXPORT. The guard must not have leaked into the one
  //     command whose whole job is to replace the file you chose.
  check(b.note("AND A SECOND NOTE"), "the user edits the part", b.frame->noteRefusal());
  check(b.saveTo(userPath), "★ File > Save still writes the part back over its own file",
        b.shell.lastDocumentError());
  const Seen partAfter = look(userPath);
  say("the part, saved again", userPath, partAfter);
  check(partAfter.exists && partAfter.head.rfind("FORGE-PART", 0) == 0 &&
            partAfter.notes > partBefore.notes,
        "★ and it is a bigger Forge part than before, not a refusal",
        std::to_string(partBefore.notes) + " -> " + std::to_string(partAfter.notes));
}

// ── W5 ─────────────────────────────────────────────────────────────────────
// THE NEGATIVE CONTROL: the native panel route, which was already safe. A guard
// that fired here would break the one route a macOS user actually takes.
void popNativePanel(const std::string& root) {
  std::printf("\n== W5: the native panel route -- unchanged ===============================\n");
  const std::string work = root + "/work";
  const std::string userPath = makeUserPart(work, "bracket.fpart", "BRACKET -- RELEASED");
  const Seen before = look(userPath);
  say("bracket.fpart, as the user saved it", userPath, before);

  App b;
  started(b, "a later launch");
  check(b.open(userPath), "File > Open bracket.fpart", b.shell.lastDocumentError());
  check(b.wireMachineProgram(), "the Manufacturing workspace has posted a program", "");
  ReturnOnSeedDialog dialog;
  dialog.defectPath = userPath;  // mutation 1 only
  b.frame->setFileDialog(&dialog);

  const std::size_t warnings = b.warnings();
  const std::size_t errors = b.errors();
  for (const std::string& id : copyCommands()) {
    const std::size_t shown = b.frame->fileDialogsShown();
    const std::size_t mark = logMark(b.shell);
    b.frame->invoke(id);
    b.oneFrame();
    sayLog(b.shell, mark, "what " + id + " said");
    check(b.frame->fileDialogsShown() == shown + 1, id + ": raised exactly one panel",
          std::to_string(b.frame->fileDialogsShown() - shown));
    check(!b.frame->promptOpen(), id + ": and no typed box as well");
    std::string seed;
    if (!dialog.requests.empty()) seed = dialog.requests.back().suggestedPath;
    std::printf("   [panel] opened on: %s   (name box \"%s\")\n", seed.c_str(),
                forge::desktop::fileDialogNameField(seed).c_str());
    check(seed != userPath, "★ " + id + ": the panel does NOT open on the user's own part",
          seed);
    const Seen landed = look(seed);
    say("what accepting the panel wrote", seed, landed);
    check(landed.exists, "★ " + id + ": and the copy landed there", seed);
    const Seen now = look(userPath);
    checkUntouched(before, now, userPath,
                   "★ " + id + ": AND THE USER'S PART IS BYTE-IDENTICAL AFTERWARDS");
  }
  std::printf("\n  [W5] warnings +%zu, errors +%zu\n", b.warnings() - warnings,
              b.errors() - errors);
  check(b.warnings() == warnings, "★ the panel route asks nothing and complains about nothing",
        std::to_string(b.warnings() - warnings));
  check(b.errors() == errors, "★ and refuses nothing on this route",
        std::to_string(b.errors() - errors));
}

}  // namespace

// Every population, one per process. See the file header for why.
const char* const kPopulations[] = {"typed-box", "typed-path", "renamed", "allows",
                                    "native-panel"};

// ── THE SELF-EXEC LOOP ─────────────────────────────────────────────────────
// fork + execv + waitpid, and the status is read FROM THE PROCESS. A system()
// here would hand back a shell's status, and this repository has already drawn
// wrong conclusions from a status that belonged to something other than the
// thing being measured.
int runEveryPopulation(const char* self, int mutation) {
  int worst = 0;
  for (const char* pop : kPopulations) {
    std::printf("\n########## %s ##########\n", pop);
    std::fflush(stdout);
    const pid_t pid = ::fork();
    if (pid < 0) {
      std::printf("[gate] could not fork for population %s\n", pop);
      return 1;
    }
    if (pid == 0) {
      const std::string m = std::to_string(mutation);
      char* args[6];
      args[0] = const_cast<char*>(self);
      args[1] = const_cast<char*>("--pop");
      args[2] = const_cast<char*>(pop);
      args[3] = const_cast<char*>("--mutate");
      args[4] = const_cast<char*>(m.c_str());
      args[5] = nullptr;
      ::execv(self, args);
      std::printf("[gate] could not exec %s\n", self);
      std::_Exit(127);
    }
    int status = 0;
    if (::waitpid(pid, &status, 0) != pid) {
      std::printf("[gate] lost the child running %s\n", pop);
      return 1;
    }
    // A signal is not a pass. A gate that crashed measured nothing.
    const int rc = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
    std::printf("[gate] population %-14s exit %d\n", pop, rc);
    if (rc != 0) worst = rc;
  }
  std::printf("\n[gate] %zu populations run, %s\n", sizeof kPopulations / sizeof kPopulations[0],
              worst == 0 ? "all green" : "AT LEAST ONE RED");
  if (worst != 0) {
    std::printf("WRITE-TARGET GATE RED\n");
    return worst;
  }
  std::printf("WRITE-TARGET GATE GREEN\n");
  return 0;
}

int main(int argc, char** argv) {
  std::string population;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--pop") == 0 && i + 1 < argc) population = argv[++i];
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  // ── THE MUTATIONS, AND WHAT EACH ONE PROVES CAN FAIL ─────────────────────
  // Every one of them perturbs the HARNESS, never the product: a test-only
  // switch that disables the guard would trade one gate bit for four, which this
  // repository has already paid for once. The product lines are proved
  // falsifiable by source mutations recorded in the commit message.
  //
  //   1  W5's panel answers the user's own document instead of the path it was
  //      seeded with -- T-122's shipped defect at this gate's knob. The copy no
  //      longer lands where the panel pointed and the export is refused, so "the
  //      copy landed there" and "errors +0" go red.
  //   2  W1 never presses Run. Every seed check still passes; "the copy WAS
  //      written" goes red -- which stops a gate that only reads a text box from
  //      calling a Forge that writes nothing green.
  //   3  W2 asks for the copy's own name instead of the part's, so nothing
  //      destructive is requested and every refusal check goes red.
  //   4  W3's decoy is ordinary STEP text rather than a renamed part, so the
  //      content clause has nothing to find and its refusal checks go red.
  //   5  W4's re-export goes to a fresh name, so the stubbed earlier copy is
  //      never replaced and "re-exporting REPLACED it" goes red.
  //   6  W1 skips the Manufacturing panels, so hasMachineProgram() is false,
  //      file.export_gcode's box never opens and `walked == 4` goes red.
  if (population.empty()) return runEveryPopulation(argv[0], g_mutation);

  const char* tmp = std::getenv("TMPDIR");
  std::string root = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!root.empty() && root.back() == '/') root.pop_back();
  root += "/forge_write_target_gate/" + population;
  std::error_code ec;
  std::filesystem::remove_all(root, ec);  // a rerun must not inherit yesterday's evidence
  std::filesystem::create_directories(root, ec);

  // THIS PROBE MUST NOT TOUCH THE USER'S OWN FILES. A save with nowhere to go
  // writes $HOME/.forge/<name>.fpart, so HOME is redirected for THIS PROCESS
  // ONLY, once, before any kernel work starts.
  const std::string fakeHome = root + "/home";
  std::filesystem::create_directories(fakeHome + "/.forge", ec);
  if (::setenv("HOME", fakeHome.c_str(), 1) != 0) {
    std::printf("[gate] could not redirect HOME; refusing to write into the real one\n");
    return 1;
  }
  // A bare name accepted from a panel lands in the working directory, so the
  // working directory is this gate's own scratch too.
  std::filesystem::current_path(root, ec);

  std::printf("=== Forge write-target gate ===\n");
  std::printf("  population: %s\n", population.c_str());
  std::printf("  mutation  : %d  (0 = the shipping configuration)\n", g_mutation);
  std::printf("  scratch   : %s\n", root.c_str());
  std::printf("  HOME      : %s\n", fakeHome.c_str());

  HeadlessImGui imgui;

  if (population == "typed-box") {
    popTypedBox(root);
  } else if (population == "typed-path") {
    popTypedPath(root);
  } else if (population == "renamed") {
    popRenamed(root);
  } else if (population == "allows") {
    popAllows(root);
  } else if (population == "native-panel") {
    popNativePanel(root);
  } else {
    std::printf("[gate] unknown population '%s'\n", population.c_str());
    return 2;
  }

  std::printf("\n[gate] %d checks, %d failures\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
