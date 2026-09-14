// forge-desktop/test/write_target_gate.cpp
//
// THE WRITE-TARGET GATE — WHAT DOES A *COPY* LAND ON, AND WHAT WILL FORGE
// REFUSE TO WRITE OVER?
//
// ★ AND THIS GATE HAS NOW BEEN THE BLIND ONE ITSELF. At 2b5e61d3 it printed
//   "9 populations run, all green / WRITE-TARGET GATE GREEN", 0 FAIL lines,
//   while one file.save_as from the shipping CoPilot Apply button turned a
//   hand-authored 173-byte STEP into 591 bytes of FORGE-PART with errors +0 --
//   because every population asked whether the target was a PART and none asked
//   whether it was merely TAKEN. W10 is that question, and it was measured RED
//   on the parent commit before the product was touched. When this file grows
//   again, the thing to ask is what a green run does NOT cover.
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
//     forge_desktop_write_target_gate --pop <one of kPopulations>
// The list is kPopulations, immediately above runEveryPopulation(); it is not
// repeated here, because a list in a comment is a list that goes stale -- this
// one already named five populations while the binary ran nine.
// With NO --pop the binary re-execs ITSELF once per population and fails if any
// child does. One per process for the reason save_target_gate gives: the OCCT
// path enforces a PROCESS-GLOBAL wall-clock window and every seeded application
// spends some of it.
//
// --mutate 1..15 proves the gate can fail; see the mutation list in main().
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
#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FileExchange.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/MachineProgram.hpp"
#include "forge/ui/OpConstraintBridge.hpp"
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

// ── the panel, answering with a path the POPULATION chooses ────────────────
// ReturnOnSeedDialog answers the SEED, and the seed is free by construction once
// the producer swerves -- so it cannot drive the case that matters here: a user
// steering a native Save panel onto a file that already exists, which is the one
// combination AppKit's own Replace sheet covers and nothing in this gate did.
class AnswerWithDialog final : public forge::desktop::FileDialog {
 public:
  std::string answer;
  std::size_t runs = 0;
  forge::desktop::FileDialogResult run(
      const forge::desktop::FileDialogRequest& request) override {
    ++runs;
    lastMode = request.mode;
    forge::desktop::FileDialogResult out;
    out.accepted = true;
    out.path = answer;
    return out;
  }
  forge::desktop::FileDialogMode lastMode = forge::desktop::FileDialogMode::Open;
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
  // ★ A LENGTH ALONE IS NOT AN OBSERVABLE. Two different STEP files can weigh
  //   the same; the entity count moves when the content does. T-127's measured
  //   destruction was 53903 B / 1991 entity lines -> 49327 / 1751, and both
  //   halves of that are reported.
  std::size_t iso = 0;
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
  s.iso = rawCount(s.text, "#");
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
//
// ── ★ AND A SECOND NOTE WHERE THE POPULATION NEEDS TWO SHAPES ──────────────
// W6 puts two parts in one folder and asks whether one replaced the other. With
// both made the same way, "replaced" and "untouched" are files of the same shape
// and a very similar length, and the check would be reading a coincidence. The
// reproduce phase hit exactly this: its first control seeded the occupant with a
// copy of what would replace it, so the two were identical bytes and the check
// printed NOT-REPRO for the wrong reason. `second` is what makes the two
// distinguishable by NOTE COUNT and not by length alone.
std::string makeUserPart(const std::string& work, const std::string& leaf,
                         const std::string& noteText, const std::string& second = std::string()) {
  std::error_code ec;
  std::filesystem::create_directories(work, ec);
  const std::string userPath = work + "/" + leaf;
  App a;
  started(a, "the launch that makes the part");
  check(a.note(noteText), "the user types a note on the sheet", a.frame->noteRefusal());
  // MUTATION 7: the second note is dropped, so W6's two parts are the SAME SHAPE
  // and its byte-identical checks cannot tell "replaced" from "untouched". It is
  // this gate's own note-on-method, injected.
  if (!second.empty() && g_mutation != 7) {
    check(a.note(second), "and a second one, so this part has a shape of its own",
          a.frame->noteRefusal());
  }
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
//
// ── ★★ AND THE OCCUPANCY HALF IS ASKED OF REAL FILES (T-128) ──────────────
// The check this replaces was a STRING check that pinned
//   fileDialogSuggestedPath("file.save_as", "/w/bracket.txt") == "/w/bracket.fpart"
// and its stated reason was "the direction is the safe one, because the box now
// names a file that is NOT the original". That is TRUE AND IRRELEVANT, and it is
// why T-123 could not merge: NOT-THE-ORIGINAL IS NOT NOT-SOMEONE'S-PART.
// MEASURED on the tree that check was green on -- a document opened from
// bracket.txt, a DIFFERENT part sitting at bracket.fpart, one Run with nothing
// typed: 2 NOTE / 5 FEATURE / 738 B -> 1 / 5 / 635 B, warnings +1, errors +0,
// status strip "Save Document As - done". The gate pinned the destructive value.
//
// A string check CANNOT ask this question at all: whether a name is free is a
// fact about a filesystem, so the occupancy assertions below make real files in
// the gate's own scratch and ask about those.
void checkTheProducer(const std::string& root) {
  std::printf("\n   -- the producer itself --\n");
  const std::string w = root + "/producer";
  std::error_code ec;
  std::filesystem::remove_all(w, ec);
  std::filesystem::create_directories(w, ec);

  // NOTHING is bound and NOTHING is open: the pure-transform context, which is
  // what the suffix rules below are about.
  const forge::desktop::SeedContext none;

  const std::string part = w + "/bracket.fpart";
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.export_step", part, none),
             w + "/bracket.step", "a copy command names the file IT writes");
  // ★ A .fpart CANNOT ASK THIS QUESTION. file.open's policy row carries
  //   defaultExtension ".fpart" whatever its mode, so swapping the suffix onto a
  //   path that already ends .fpart is the identity and a check written that way
  //   passes with the mode test deleted -- MEASURED, it stayed green. A document
  //   is opened on its CONTENT, not its name (DocumentModel refuses anything
  //   whose line 1 is not the magic), so a part called bracket.txt is a document
  //   Forge really can open, and its Open box must not point at a file that does
  //   not exist.
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.open", w + "/bracket.txt", none),
             w + "/bracket.txt",
             "an OPEN box keeps the path as given -- naming a file that exists is the point");
  checkStrEq(
      forge::desktop::fileDialogSuggestedPath("file.import_step", w + "/bracket.txt", none),
      w + "/bracket.txt", "and so does an Import box");
  checkStrEq(forge::desktop::fileDialogSuggestedPath("part.primitive_box", part, none), part,
             "a command with no policy row is not a file command, and keeps its seed");
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.export_step", std::string(), none),
             std::string(), "an empty seed stays empty -- a blank box stays blank");
  checkStrEq(
      forge::desktop::fileDialogSuggestedPath("file.export_step", w + "/bracket.step", none),
      w + "/bracket.step", "and it is idempotent, so the untitled seed is untouched");
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.export_step", "/w.v1/bracket", none),
             "/w.v1/bracket.step", "a dot in a FOLDER name is not an extension");

  // ── ★★ THE ASSERTION THAT WAS WRONG, ASKED ABOUT OCCUPANCY ──────────────
  // (i) NOTHING is sitting on the derived name -> the derived name stands. Save
  //     As on a part called bracket.txt really does offer bracket.fpart, which
  //     is what the native panel has always done and what a user expects.
  check(!std::filesystem::exists(part, ec), "nothing is at bracket.fpart yet", part);
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.save_as", w + "/bracket.txt", none),
             part,
             "Save As on a part whose file is not .fpart offers the derived name -- "
             "while it is FREE");

  // (ii) SOMEBODY'S PART is sitting on it -> the next free name in the series,
  //      and the name the box offers is one std::filesystem::exists() says is
  //      absent. This is T-128, asked of bytes.
  const std::string occupied =
      makeUserPart(w, "bracket.fpart", "SOMEONE ELSE -- RELEASED", "DO NOT DELETE");
  const Seen sitting = look(occupied);
  say("a DIFFERENT part is at bracket.fpart", occupied, sitting);
  const std::string swerved =
      forge::desktop::fileDialogSuggestedPath("file.save_as", w + "/bracket.txt", none);
  std::printf("   [seed] Save As on bracket.txt now offers: %s\n", swerved.c_str());
  check(swerved != part,
        "★ the Save As box does NOT offer a name another part is sitting on", swerved);
  checkStrEq(swerved, w + "/bracket-2.fpart",
             "★ it offers the next free name in the series instead");
  check(!std::filesystem::exists(swerved, ec),
        "★ and the name it offers is one nothing is on", swerved);
  check(look(occupied).text == sitting.text,
        "★ and asking the question moved nobody's bytes", occupied);

  // (iii) THE DOCUMENT'S OWN FILE IS THE ONE OCCUPIED PATH A SAVE BOX MAY OPEN
  //       ON. Replacing the file you chose is what Save means, and a swerve here
  //       would make Save As on a .fpart offer bracket-2.fpart every time.
  forge::desktop::SeedContext mine;
  mine.ownDocument = occupied;
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.save_as", occupied, mine), occupied,
             "★ Save As on THIS document's own file is still the identity");

  // (iv) A FILE THE OPEN DOCUMENT READS -- T-127, at the seed. The export box
  //      derived bracket.step from bracket.fpart and that is exactly the file
  //      `INPUT()` reads; one Run took it 53903 B -> 49327 B.
  const std::string reads = w + "/bracket.step";
  check(writeWholeFile(reads, "ISO-10303-21;\nthe file this part is built from\n"),
        "the file the open part is built from is on disk");
  forge::desktop::SeedContext bound;
  bound.ownDocument = occupied;
  bound.boundFiles.push_back(reads);
  const std::string away =
      forge::desktop::fileDialogSuggestedPath("file.export_step", occupied, bound);
  std::printf("   [seed] the export box on a part built from bracket.step: %s\n",
              away.c_str());
  check(away != reads, "★ an export box does NOT open on the file the part READS", away);
  check(!std::filesystem::exists(away, ec), "★ and it offers a free name", away);

  // (v) AND AN EXPORT ONTO A MERELY-OCCUPIED PATH STILL STANDS. "Export over my
  //     last export" is ordinary intent; a seed that swerved on occupancy would
  //     hand the user bracket-2.step, bracket-3.step, for ever. The Run-time
  //     question covers that case instead, and W4(b) pins the behaviour.
  forge::desktop::SeedContext plain;
  plain.ownDocument = occupied;
  checkStrEq(forge::desktop::fileDialogSuggestedPath("file.export_step", occupied, plain),
             reads, "★ but an export DOES still open on the user's own last export");
}

// ── W1 ─────────────────────────────────────────────────────────────────────
// THE THREE AXES AT ONCE: the typed box, a copy command, and a document that HAS
// a file. This is the cell no existing check covers.
void popTypedBox(const std::string& root) {
  std::printf("\n== W1: the typed box, every copy command, on a document that HAS a file ==\n");
  checkTheProducer(root);
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
    check(forge::desktop::fileDialogRequestFor(id, b.frame->pathSeedFor(id),
                                              b.frame->seedContext(), request),
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
    if (g_mutation == 3) {
      target = forge::desktop::fileDialogSuggestedPath(id, userPath, b.frame->seedContext());
    }
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

  // (c) a file Forge has no opinion about is still written over BY A COPY.
  //     STATED here, because it is the surviving limit: for an EXPORT the guard
  //     asks whether the target is a Forge part, not whether it is occupied.
  //     ★ T-130 CLOSED THE OTHER HALF -- a DOCUMENT SAVE onto this same shape of
  //       target is now refused unless a surface asked a person first. The split
  //       is intent-shaped, and W10 pins both halves in one body: widening the
  //       new clause from DocumentSave to every intent reddens THIS check and
  //       W10(e) together. MEASURED by source mutation, both populations red.
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


// ── W6 ─────────────────────────────────────────────────────────────────────
// T-128 END TO END, ON RAW BYTES. The population this gate was missing: the
// question is OCCUPANCY, so it is asked of two real parts in one folder.
//
// MEASURED at 646d761f, which is what these numbers are: bracket.fpart held
// 2 NOTE / 5 FEATURE / 738 B; a document opened from bracket.txt put
// bracket.fpart in its Save As box; ONE Run with nothing typed left 1 / 5 / 635 B,
// warnings +1, errors +0, strip "Save Document As - done".
//
// FOUR LEGS, and the last three are what stop "refuse everything" passing:
//   (a) the box does not offer it, and one Run does not take it;
//   (b) the SYMMETRIC ALLOW -- with nothing in the way, Save As writes;
//   (c) the CONSENT arm -- a person answers Replace and it writes, because
//       replacing an old part deliberately is a thing a user does;
//   (d) the TOKEN IS ONE-SHOT -- the next occupied target is refused again.
void popOccupied(const std::string& root) {
  std::printf("\n== W6: TWO PARTS IN ONE FOLDER -- what does the Save As box take? ======\n");
  const std::string work = root + "/work";
  const std::string victim =
      makeUserPart(work, "bracket.fpart", "SOMEONE ELSE -- RELEASED", "DO NOT DELETE");
  App maker;
  started(maker, "the launch that makes the user's own part");
  check(maker.note("MINE -- IN PROGRESS"), "a second, different part",
        maker.frame->noteRefusal());
  const std::string mine = work + "/bracket.txt";
  check(maker.saveTo(mine), "saved under a name that does not say .fpart",
        maker.shell.lastDocumentError());

  const Seen before = look(victim);
  say("bracket.fpart -- SOMEBODY ELSE'S", victim, before);
  say("bracket.txt -- the one being worked on", mine, look(mine));
  check(before.notes == 2 && before.features == 5,
        "★ the two parts are DIFFERENT SHAPES, so 'replaced' is not a same-size control",
        std::to_string(before.notes) + " NOTE / " + std::to_string(before.features));

  App b;
  started(b, "a later launch");
  check(b.open(mine), "File > Open bracket.txt", b.shell.lastDocumentError());
  checkStrEq(b.frame->documentPath(), mine, "a part is opened on its CONTENT, not its name");
  // NO setFileDialog(): the configuration with no confirmation of any kind, and
  // the one T-128 was measured in.

  // ── (a) the box, and one Run ────────────────────────────────────────────
  const std::size_t warnings = b.warnings();
  const std::size_t errors = b.errors();
  b.frame->invoke("file.save_as");
  b.oneFrame();
  check(b.frame->fileDialogsShown() == 0, "no panel: there is none to show in this build");
  check(b.frame->promptOpen(), "the typed box is what asks instead",
        b.shell.lastDocumentError());
  const std::string typed = b.frame->promptValue("path");
  std::printf("   [seed] the Save As box arrived holding: %s\n", typed.c_str());
  check(typed != victim, "★ the box is NOT pre-filled with another user's part", typed);
  check(typed != mine, "and it is not the original either -- Save As means a new name",
        typed);
  std::error_code ec;
  check(!std::filesystem::exists(typed, ec), "★ and nothing is sitting on what it offers",
        typed);
  // MUTATION 8: never press Run. Every seed check above still passes, so a gate
  // that only read the text box would call a Forge that writes nothing green.
  if (g_mutation != 8) {
    check(b.frame->submitPrompt(), "ONE Run, with nothing typed and nothing changed",
          b.shell.lastDocumentError());
    b.oneFrame();
  }
  checkUntouched(before, look(victim), victim,
                 "★ AND THE OTHER PART IS BYTE-IDENTICAL AFTERWARDS");
  // ★ AND THE SAVE ACTUALLY HAPPENED. This is what mutation 8 targets, and it is
  //   the check the first version of this population did not have: "the other
  //   part is byte-identical" is TRUE OF A FORGE THAT WROTE NOTHING AT ALL once
  //   the seed swerves, so on its own it could not tell a fix from a Save As
  //   that silently does nothing. MEASURED: mutation 8 STAYED GREEN against that
  //   version, which is the gate reporting its own hole.
  const Seen landed = look(typed);
  say("what Save As wrote", typed, landed);
  check(landed.exists && landed.head.rfind("FORGE-PART", 0) == 0,
        "★ and the part WAS saved, at the free name the box offered", typed);
  check(landed.text != before.text, "and it is not the other part's bytes", typed);
  std::printf("   [W6] warnings +%zu, errors +%zu\n", b.warnings() - warnings,
              b.errors() - errors);
  b.frame->cancelPrompt();

  // ── (b) TYPING IT ANYWAY IS A QUESTION, NOT A SILENT RUN ────────────────
  b.frame->invoke("file.save_as");
  b.oneFrame();
  check(b.frame->promptOpen(), "the box is up again");
  check(b.frame->setPromptValue("path", victim), "the user types the other part's name");
  const std::size_t raised = b.frame->replacePromptsRaised();
  const std::size_t seqBefore = b.shell.documentErrorSeq();
  const std::size_t mark = logMark(b.shell);
  b.frame->submitPrompt();
  b.oneFrame();
  sayLog(b.shell, mark, "what Run said with an occupied name typed");
  check(b.frame->replacePromptsRaised() == raised + 1,
        "★ Forge ASKS before it replaces -- the question the typed route never had",
        std::to_string(b.frame->replacePromptsRaised() - raised));
  check(b.frame->replacePromptOpen(), "and it is standing there now");
  checkStrEq(b.frame->replacePromptPath(), victim, "about the file it would replace");
  check(b.shell.documentErrorSeq() == seqBefore,
        "and NOTHING was dispatched while the question stands",
        b.shell.lastDocumentError());
  checkUntouched(before, look(victim), victim, "★ the other part is STILL byte-identical");

  // "Keep the Old File" leaves the user where they were.
  b.frame->answerReplaceCancel();
  b.oneFrame();
  check(!b.frame->replacePromptOpen(), "Keep the Old File takes the question down");
  checkUntouched(before, look(victim), victim, "★ and keeps the file");

  // ── (c) THE CONSENT ARM -- a person says Replace, and it writes ─────────
  b.frame->invoke("file.save_as");
  b.oneFrame();
  check(b.frame->setPromptValue("path", victim), "the user types it again");
  b.frame->submitPrompt();
  b.oneFrame();
  check(b.frame->replacePromptOpen(), "the question comes up again");
  // MUTATION 9: the answer is recorded for a DIFFERENT path, so the consent can
  // never match the file being written and "Replace goes through" must go red.
  // This is what proves the consent is PATH-SCOPED and not a global yes.
  if (g_mutation == 9) {
    b.shell.consentToReplace(work + "/somewhere-else.fpart");
    b.frame->answerReplaceCancel();
    b.oneFrame();
    b.frame->invoke("file.save_as");
    b.oneFrame();
    b.frame->setPromptValue("path", victim);
    b.frame->submitPrompt();
    b.oneFrame();
    b.frame->answerReplaceCancel();
  } else {
    b.frame->answerReplaceYes();
  }
  b.oneFrame();
  const Seen replaced = look(victim);
  say("bracket.fpart after the user said Replace", victim, replaced);
  check(replaced.exists && replaced.head.rfind("FORGE-PART", 0) == 0 &&
            replaced.text != before.text,
        "★ a person CAN still replace an old part deliberately -- it was written",
        std::to_string(before.bytes) + " -> " + std::to_string(replaced.bytes));

  // ── (d) AND THE TOKEN IS ONE-SHOT ───────────────────────────────────────
  // ── ★ THE SPEND, MEASURED ON ITS OWN ────────────────────────────────────
  // The consent has TWO properties and they need two checks, because either one
  // alone hides the other:
  //
  //   PATH SCOPE  a token for file X does not authorise a write to file Y.
  //   THE SPEND   a token is consumed by the NEXT dispatch, asked for or not,
  //               so it cannot be banked for a later gesture.
  //
  // MEASURED, and this is why the leg is written this way: with only the
  // different-file check below, deleting `consentedPath_.clear()` from
  // ForgeShell::run() left this gate GREEN -- the path scope refused the other
  // file whether or not the token had ever been spent. And re-asking about the
  // SAME file cannot measure it either: a successful Save As makes the document
  // OWN that file, so the next save to it is ordinary Save and is allowed by
  // the first clause of the judgement, correctly.
  //
  // So: a token is minted for a part this document does not own, an UNRELATED
  // command is dispatched, and the write is then attempted. Nothing about the
  // gesture changes except that one dispatch went by.
  {
    const std::string banked =
        makeUserPart(work, "banked.fpart", "BANKED -- RELEASED", "DO NOT DELETE");
    const Seen bankedBefore = look(banked);
    say("banked.fpart", banked, bankedBefore);
    b.shell.consentToReplace(banked);
    const forge::ui::DispatchResult unrelated = b.shell.run("view.fit");
    std::printf("   [spend] one unrelated dispatch went by (view.fit -> %s)\n",
                unrelated.ok() ? "ok" : "not ok");
    forge::ui::CommandParams banking;
    banking.setText("path", banked);
    const std::size_t seq3 = b.shell.documentErrorSeq();
    b.shell.run("file.save_as", banking);
    std::printf("   [ask] file.save_as on the banked answer -> |%s|\n",
                b.shell.lastDocumentError().c_str());
    check(b.shell.documentErrorSeq() != seq3,
          "★ a consent cannot be BANKED -- the next dispatch spends it, asked for or not",
          b.shell.lastDocumentError());
    checkUntouched(bankedBefore, look(banked), banked,
                   "★ AND banked.fpart IS BYTE-IDENTICAL");
  }

  // A second part, a second caller-route save onto it, with no new answer: the
  // PATH SCOPE, which is a different property from the spend above.
  const std::string second =
      makeUserPart(work, "housing.fpart", "HOUSING -- RELEASED", "DO NOT DELETE");
  const Seen secondBefore = look(second);
  say("housing.fpart", second, secondBefore);
  forge::ui::CommandParams params;
  params.setText("path", second);
  const std::size_t seq2 = b.shell.documentErrorSeq();
  const forge::ui::DispatchResult again = b.shell.run("file.save_as", params);
  std::printf("   [ask] file.save_as onto a SECOND part -> %s  |%s|\n",
              again.ok() ? "dispatch ok" : "dispatch not ok",
              b.shell.lastDocumentError().c_str());
  check(b.shell.documentErrorSeq() != seq2,
        "★ the consent was SPENT -- the next occupied target is refused again",
        b.shell.lastDocumentError());
  check(forge::ui::isUserReadable(b.shell.lastDocumentError()),
        "and the sentence is one a user can read", b.shell.lastDocumentError());
  check(b.shell.lastDocumentError().find(second) != std::string::npos,
        "and it names the file it would not write over", b.shell.lastDocumentError());
  checkUntouched(secondBefore, look(second), second, "★ AND housing.fpart IS BYTE-IDENTICAL");

  // ── (e) AND SAVE AS ON YOUR OWN FILE IS NOT INTERROGATED ────────────────
  // The document's own file is OCCUPIED -- by the document. A question there
  // would put a sheet in front of every Save As on an already-saved part, which
  // is the "refuse everything" failure wearing a dialog. MUTATION-SWEPT: without
  // this leg, deleting the own-file line from ForgeFrame::wantsReplaceQuestion()
  // turned nothing red.
  {
    App d;
    started(d, "a launch whose part already has a file");
    check(d.note("MINE -- ALREADY SAVED"), "a part", d.frame->noteRefusal());
    const std::string ownFile = work + "/own.fpart";
    check(d.saveTo(ownFile), "saved once", d.shell.lastDocumentError());
    checkStrEq(d.frame->documentPath(), ownFile, "so the document owns that file");
    const std::size_t asked = d.frame->replacePromptsRaised();
    d.frame->invoke("file.save_as");
    d.oneFrame();
    check(d.frame->promptOpen(), "the Save As box is up");
    checkStrEq(d.frame->promptValue("path"), ownFile,
               "seeded on the document's own file -- the one occupied path a Save box may "
               "open on");
    check(d.frame->submitPrompt(), "★ and ONE Run goes straight through",
          d.shell.lastDocumentError());
    d.oneFrame();
    check(d.frame->replacePromptsRaised() == asked,
          "★ with NO question: replacing the file you chose is what Save means",
          std::to_string(d.frame->replacePromptsRaised() - asked));
    check(look(ownFile).exists, "★ and the part is still there", ownFile);
  }

  // ── (f) THE NATIVE PANEL IS THE OTHER MINTER ────────────────────────────
  // The combination no population covered: a user steering a native Save panel
  // onto a file that already exists. An NSSavePanel cannot return ACCEPTED on an
  // existing path without having shown its own Replace sheet, so that IS a
  // person having been asked -- and if Forge refused it anyway, Save As through
  // the panel onto an old part would stop working, which is a capability the
  // product has today.
  //
  // Driven with a panel that answers a path this population chose, because the
  // seed is free by construction now and the shipped ReturnOnSeedDialog can only
  // answer the seed.
  {
    App c;
    started(c, "a launch with a native panel installed");
    check(c.note("REPLACING AN OLD PART ON PURPOSE"), "a part to save",
          c.frame->noteRefusal());
    AnswerWithDialog panel;
    panel.answer = second;  // housing.fpart, which is still a part on disk
    c.frame->setFileDialog(&panel);
    const Seen panelBefore = look(second);
    say("housing.fpart, before the panel route", second, panelBefore);
    const std::size_t mark2 = logMark(c.shell);
    c.frame->invoke("file.save_as");
    c.oneFrame();
    sayLog(c.shell, mark2, "what the panel route said");
    std::printf("   [panel] runs=%zu mode=%s\n", panel.runs,
                panel.lastMode == forge::desktop::FileDialogMode::Save ? "Save" : "Open");
    check(panel.runs == 1, "the panel was raised exactly once", std::to_string(panel.runs));
    check(!c.frame->replacePromptOpen(),
          "★ and Forge does NOT ask a second time -- the platform already did");
    const Seen panelAfter = look(second);
    say("housing.fpart, after", second, panelAfter);
    check(panelAfter.exists && panelAfter.head.rfind("FORGE-PART", 0) == 0 &&
              panelAfter.text != panelBefore.text,
          "★ a native Save panel accepting an EXISTING part still writes it -- the "
          "platform's own Replace sheet is what asked",
          std::to_string(panelBefore.bytes) + " -> " + std::to_string(panelAfter.bytes));
  }
}

// ── W7 ─────────────────────────────────────────────────────────────────────
// T-127 END TO END: the EIGHTH shape. The target is NOT a Forge part and NOT the
// open document, so neither of T-123's two clauses can see it -- it is the STEP
// the open part was IMPORTED FROM, which `INPUT()` reads on every rebuild.
//
// MEASURED at 646d761f: bracket.step 53903 B / 1991 entity lines -> 49327 /
// 1751, errors +0, with the box AND the native panel both opening on it.
void popBoundInput(const std::string& root) {
  std::printf("\n== W7: the file the open document READS ================================\n");
  const std::string work = root + "/work";
  std::error_code ec;
  std::filesystem::create_directories(work, ec);
  const std::string source = work + "/bracket.step";
  {
    App a;
    started(a, "the launch that writes the STEP");
    a.oneFrame();
    forge::ui::CommandParams p;
    p.setText("path", source);
    check(a.ran("file.export_step", p), "Forge writes a STEP of its own part",
          a.shell.lastDocumentError());
  }
  const Seen before = look(source);
  say("bracket.step, before", source, before);
  check(before.exists && before.head.rfind("ISO-10303-21", 0) == 0,
        "and it really is STEP text", before.head);

  App b;
  started(b, "a later launch");
  {
    forge::ui::CommandParams p;
    p.setText("path", source);
    check(b.ran("file.import_step", p), "the user imports it",
          b.shell.lastDocumentError());
  }
  const std::string doc = work + "/bracket.fpart";
  {
    forge::ui::CommandParams p;
    p.setText("path", doc);
    check(b.ran("file.save_as", p), "and saves the part as bracket.fpart",
          b.shell.lastDocumentError());
  }
  checkStrEq(b.frame->documentPath(), doc, "the document is bracket.fpart");
  // MUTATION 10: the interface's getter answers "" -- T-127's blindness, restored
  // at the one line that removed it. The bound checks below go red and NOTHING
  // ELSE does, which is what proves they measure the BINDING and not occupancy.
  const std::vector<std::string> bindings =
      g_mutation == 10 ? std::vector<std::string>{} : b.shell.documentBindings();
  std::printf("   [bind] the shell can see %zu binding(s):\n", bindings.size());
  for (const std::string& one : bindings) std::printf("          %s\n", one.c_str());
  bool sees = false;
  for (const std::string& one : bindings) sees = sees || one == source;
  check(sees, "★ the shell can SEE the file this part is built from", source);
  checkStrEq(b.exchange->inputFile(), source,
             "★ and it reaches it through the interface's own getter");

  // ── the SEED ────────────────────────────────────────────────────────────
  forge::desktop::SeedContext context;
  context.ownDocument = doc;
  context.boundFiles = bindings;
  const std::string suggested =
      forge::desktop::fileDialogSuggestedPath("file.export_step", doc, context);
  forge::desktop::FileDialogRequest request;
  check(forge::desktop::fileDialogRequestFor("file.export_step", doc, context, request),
        "the panel has a request to build from the same seed");
  std::printf("   [seed] box=%s\n   [seed] panel=%s\n", suggested.c_str(),
              request.suggestedPath.c_str());
  checkStrEq(suggested, request.suggestedPath,
             "★ the TYPED BOX holds what the PANEL opens on -- still one producer");
  check(suggested != source, "★ and NEITHER opens on the file the part is built from",
        suggested);

  // ── the GUARD, with the path supplied: no box, no panel ────────────────
  const std::size_t errorsBefore = b.errors();
  const std::size_t seqBefore = b.shell.documentErrorSeq();
  const std::size_t mark = logMark(b.shell);
  forge::ui::CommandParams params;
  params.setText("path", source);
  const forge::ui::DispatchResult r = b.shell.run("file.export_step", params);
  sayLog(b.shell, mark, "what Save a Copy as STEP said");
  std::printf("   [ask] file.export_step onto bracket.step -> %s  |%s|\n",
              r.ok() ? "dispatch ok" : "dispatch not ok", b.shell.lastDocumentError().c_str());
  check(b.shell.documentErrorSeq() != seqBefore,
        "★ a copy may not replace the file the part READS", b.shell.lastDocumentError());
  check(b.errors() == errorsBefore + 1, "★ and said so where a user reads -- errors +1",
        std::to_string(b.errors() - errorsBefore));
  check(b.shell.lastExchange().refusal == forge::ui::ExchangeRefusal::TargetIsBound,
        "for the reason the closed set has a value for -- and it is NOT TargetIsDocument",
        forge::ui::toString(b.shell.lastExchange().refusal));
  check(forge::ui::isUserReadable(b.shell.lastDocumentError()),
        "the sentence is one a user can read", b.shell.lastDocumentError());
  check(b.shell.lastDocumentError().find(source) != std::string::npos,
        "and it names the file", b.shell.lastDocumentError());
  const Seen after = look(source);
  say("bracket.step, after", source, after);
  check(after.text == before.text, "★ AND IT IS BYTE-IDENTICAL AFTERWARDS",
        std::to_string(before.bytes) + " B / " + std::to_string(before.iso) + " entities -> " +
            std::to_string(after.bytes) + " B / " + std::to_string(after.iso));

  // ── AND NO CONSENT LIFTS IT ─────────────────────────────────────────────
  // A binding is not an occupancy question. The panel's own Replace sheet, and
  // the frame's Replace answer, both mint the same token; neither may authorise
  // a write onto the file the document is compiled from.
  b.shell.consentToReplace(source);
  const std::size_t seqConsented = b.shell.documentErrorSeq();
  b.shell.run("file.export_step", params);
  check(b.shell.documentErrorSeq() != seqConsented,
        "★ consent lifts OCCUPANCY and never lifts a BINDING",
        b.shell.lastDocumentError());
  check(look(source).text == before.text, "★ and the file is byte-identical again", source);
}

// ── W8 ─────────────────────────────────────────────────────────────────────
// T-124: the SAVE waist, and the CoPilot route that reaches it TODAY.
//
// MEASURED at 646d761f: file.export_step / _brep / _stl on a path all REFUSED
// and left it byte-identical, while file.save_as ON THAT IDENTICAL PATH replaced
// it -- 2 NOTE / 5 FEATURE / 718 B -> 0 / 5 / 586 B, dispatch ok, errors +0 --
// and applyPlan did it again through the shipping Apply button.
//
// ★ ZERO LINES OF ArchieCopilot ARE TOUCHED BY THE FIX, and that is the point of
//   the assertion: planTools still offers ten file commands, validatePlan still
//   accepts the step, and the bytes still do not move -- because the dispatch it
//   makes is the dispatch the waist now guards.
void popSaveWaist(const std::string& root) {
  std::printf("\n== W8: file.save_as from a CALLER, and from the CoPilot ================\n");
  const std::string work = root + "/work";
  const std::string victim =
      makeUserPart(work, "housing.fpart", "HOUSING -- RELEASED", "DO NOT DELETE");
  const Seen before = look(victim);
  say("housing.fpart", victim, before);
  check(before.notes == 2 && before.features == 5,
        "★ the victim has a shape of its own, so 'byte-identical' is not a coincidence",
        std::to_string(before.notes) + " NOTE / " + std::to_string(before.features));

  App b;
  started(b, "a launch with its own UNTITLED part");
  b.oneFrame();
  checkStrEq(b.frame->documentPath(), std::string(),
             "the document is untitled, so the victim is not its own file");

  // ── the four commands, one path ─────────────────────────────────────────
  for (const char* id : {"file.export_step", "file.export_brep", "file.export_stl",
                         "file.save_as"}) {
    const std::size_t seq = b.shell.documentErrorSeq();
    const std::size_t mark = logMark(b.shell);
    forge::ui::CommandParams params;
    // MUTATION 11: the caller is handed a consent, so "a caller cannot replace a
    // part" must go red. It is what proves the caller/human distinction is
    // load-bearing rather than decorative.
    if (g_mutation == 11) b.shell.consentToReplace(victim);
    params.setText("path", victim);
    const forge::ui::DispatchResult r = b.shell.run(id, params);
    sayLog(b.shell, mark, std::string("what ") + id + " said");
    const Seen now = look(victim);
    std::printf("   [ask] %-18s dispatch %-7s refused=%-3s  file %s\n", id,
                r.ok() ? "ok" : "NOT-ok", b.shell.documentErrorSeq() != seq ? "yes" : "no",
                now.text == before.text ? "byte-identical" : "REPLACED");
    check(b.shell.documentErrorSeq() != seq,
          std::string("★ ") + id + ": a CALLER may not replace another user's part",
          b.shell.lastDocumentError());
    checkUntouched(before, now, victim,
                   std::string("★ ") + id + ": AND IT IS BYTE-IDENTICAL AFTERWARDS");
  }

  // ── the CoPilot route, on the LIVE registry ─────────────────────────────
  const std::vector<forge::ui::PlanTool> tools =
      forge::ui::planTools(b.shell.registry(), b.shell.selection());
  std::size_t fileTools = 0;
  bool saveAsOffered = false;
  for (const forge::ui::PlanTool& t : tools) {
    if (t.id.rfind("file.", 0) != 0) continue;
    ++fileTools;
    if (t.id == "file.save_as") saveAsOffered = t.callableNow;
  }
  std::printf("   [plan] planTools offers %zu file.* commands; file.save_as callableNow=%s\n",
              fileTools, saveAsOffered ? "true" : "false");
  check(fileTools >= 9, "the planner is still offered the file commands it was",
        std::to_string(fileTools));
  check(saveAsOffered, "★ and file.save_as is still one of them -- nothing was hidden");

  forge::ui::Plan plan;
  forge::ui::PlanStep step;
  step.commandId = "file.save_as";
  step.args.push_back(forge::ui::PlanArg::str("path", victim));
  plan.steps.push_back(step);
  const forge::ui::OpConstraintBridge bridge;
  const forge::ui::PlanVerdict verdict =
      forge::ui::validatePlan(plan, b.shell.registry(), bridge);
  std::printf("   [plan] validatePlan accepted=%s |%s|\n",
              verdict.accepted() ? "true" : "false", verdict.explanation.c_str());
  check(verdict.accepted(),
        "★ validatePlan still accepts it -- the fix is at the WRITE, not the plan",
        verdict.explanation);
  const forge::ui::ApplyOutcome applied =
      forge::ui::applyPlan(plan, b.shell, b.frame->document(), bridge);
  std::printf("   [plan] applyPlan: %s\n", applied.summary().c_str());
  check(applied.applied == 0, "★ Applied 0 of 1 step", std::to_string(applied.applied));
  checkUntouched(before, look(victim), victim,
                 "★ AND THE PART IS BYTE-IDENTICAL AFTER THE SHIPPING APPLY BUTTON");

  // ── AND A CALLER STILL WRITES A FREE NAME ───────────────────────────────
  // Without this, "refuse every save from a caller" would pass everything above.
  const std::string fresh = work + "/fresh.fpart";
  check(!std::filesystem::exists(fresh), "nothing is at fresh.fpart");
  {
    forge::ui::CommandParams params;
    params.setText("path", fresh);
    check(b.ran("file.save_as", params), "★ a caller CAN still save to a free name",
          b.shell.lastDocumentError());
  }
  const Seen wrote = look(fresh);
  say("fresh.fpart", fresh, wrote);
  check(wrote.exists && wrote.head.rfind("FORGE-PART", 0) == 0,
        "★ and what landed is a Forge part", wrote.head);
  // AND SAVE BACK OVER ITSELF, which is what Save means.
  {
    forge::ui::CommandParams params;
    params.setText("path", fresh);
    check(b.ran("file.save", params), "★ and Save writes it back over its own file",
          b.shell.lastDocumentError());
  }
  check(look(fresh).exists, "★ which still exists afterwards", fresh);

  // ── ★ ALSO-3: A SAVE THAT WROTE NOTHING MAY NOT REPORT SUCCESS ──────────
  // MEASURED at 646d761f: runSave set documentError_ and returned WITHOUT
  // calling ctx.fail(), so DispatchResult::ok() was TRUE on a save whose bytes
  // never landed. Anything that keys "did bytes land?" off dispatch status reads
  // that as a success -- and this round added exactly such a caller, because
  // applyPlan counts an applied step by its dispatch.
  //
  // The failure is induced at the HOST, not at the guard: a folder that is not
  // there. savePartFile's atomic write cannot create its temporary, documentSave
  // answers false, and that is the branch the missing ctx.fail() was in.
  {
    const std::string nowhere = work + "/no-such-folder/part.fpart";
    check(!std::filesystem::exists(work + "/no-such-folder"),
          "the folder really is not there", work + "/no-such-folder");
    const std::size_t mark = logMark(b.shell);
    forge::ui::CommandParams params;
    params.setText("path", nowhere);
    const forge::ui::DispatchResult failed = b.shell.run("file.save_as", params);
    sayLog(b.shell, mark, "what a save into a missing folder said");
    std::printf("   [ask] file.save_as into a folder that is not there -> %s\n",
                failed.ok() ? "dispatch ok" : "dispatch not ok");
    check(!failed.ok(),
          "★ a save whose bytes never landed reports NOT ok -- dispatch status can be "
          "trusted to answer 'did bytes land'",
          forge::ui::machineName(failed.status));
    check(!std::filesystem::exists(nowhere), "★ and nothing was created there", nowhere);
  }
}

// ── W9 ─────────────────────────────────────────────────────────────────────
// ALSO-2: A FAILED EXPORT MAY NOT DESTROY THE TARGET.
//
// MEASURED at 646d761f by making the write fail with RLIMIT_FSIZE: a
// hand-authored 258-byte STEP was 100 BYTES afterwards, and the dispatch had
// REFUSED (errors +1). Every geometry writer opens the target with
// std::ios::trunc, so the file is emptied before anything can go wrong.
//
// Induced here WITHOUT setrlimit, which is a process-global knob this gate's
// own scratch writing would trip: the target's PARENT is made read-only, so the
// staging sibling cannot be created and the write fails exactly as late. What is
// asserted is the same fact -- the user's bytes are still there.
void popFailedExport(const std::string& root) {
  std::printf("\n== W9: a REFUSED export leaves the target's bytes alone ================\n");
  const std::string work = root + "/readonly";
  std::error_code ec;
  std::filesystem::remove_all(work, ec);
  std::filesystem::create_directories(work, ec);
  const std::string hand = work + "/handauthored.step";
  const std::string handText =
      "ISO-10303-21;\nHEADER;\n/* bracket fixture, hand-written by the shop, 2019. "
      "DO NOT REGENERATE. */\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";
  check(writeWholeFile(hand, handText), "a hand-authored STEP the shop wrote");
  const Seen before = look(hand);
  say("handauthored.step, before", hand, before);

  App b;
  started(b, "a launch with a part to export");
  b.oneFrame();
  check(b.scene.lastBuild().ok(), "the part COMPILES, so the refusal below is about the WRITE",
        b.scene.lastBuild().error);

  // MUTATION 12: the folder is left writable, so the export SUCCEEDS and the
  // "it was refused" and "the bytes survived" checks both go red -- which is what
  // stops this population passing on a Forge that never attempted the write.
  if (g_mutation != 12) {
    std::filesystem::permissions(work, std::filesystem::perms::owner_read |
                                           std::filesystem::perms::owner_exec,
                                 std::filesystem::perm_options::replace, ec);
    std::printf("   [setup] the folder is read-only now (%s)\n",
                ec ? ec.message().c_str() : "ok");
  }

  const std::size_t errorsBefore = b.errors();
  const std::size_t mark = logMark(b.shell);
  forge::ui::CommandParams params;
  params.setText("path", hand);
  const forge::ui::DispatchResult r = b.shell.run("file.export_step", params);
  sayLog(b.shell, mark, "what the export said");
  std::printf("   [ask] file.export_step -> %s  errors +%zu  |%s|\n",
              r.ok() ? "dispatch ok" : "dispatch not ok", b.errors() - errorsBefore,
              b.shell.lastDocumentError().c_str());

  // Restore before reading, so the read itself cannot be the thing that fails.
  std::filesystem::permissions(work,
                               std::filesystem::perms::owner_read |
                                   std::filesystem::perms::owner_write |
                                   std::filesystem::perms::owner_exec,
                               std::filesystem::perm_options::replace, ec);
  const Seen after = look(hand);
  say("handauthored.step, after", hand, after);
  check(!r.ok(), "★ the export REFUSED", forge::ui::machineName(r.status));
  check(after.text == before.text,
        "★ AND THE HAND-AUTHORED FILE IS BYTE-IDENTICAL -- a refusal destroys nothing",
        std::to_string(before.bytes) + " B -> " + std::to_string(after.bytes) + " B");
  check(!std::filesystem::exists(hand + ".forge-tmp", ec),
        "★ and no staging sibling is left beside it", hand + ".forge-tmp");
}

// ── THE DOCUMENT-SAVE COMMANDS, DERIVED FROM THE REGISTRY ──────────────────
// Not a list of two ids. `writes == WriteIntent::DocumentSave` is the SAME
// declaration ForgeShell::writeTarget() judges a target by, so a third
// document-save command is inside this walk THE DAY IT IS REGISTERED -- which
// is the whole of what T-124 was: a third handler nobody remembered to add a
// call to, twenty lines above the guard the other two used.
std::vector<std::string> documentSaveCommands(const forge::ui::CommandRegistry& registry) {
  std::vector<std::string> out;
  for (const std::string& id : registry.ids()) {
    const forge::ui::CommandDescriptor* d = registry.find(id);
    if (d == nullptr) continue;
    if (d->writes != forge::ui::WriteIntent::DocumentSave) continue;
    out.push_back(id);
  }
  return out;
}

// ── W10 ────────────────────────────────────────────────────────────────────
// T-130: A SAVE ONTO A FILE THAT IS NOT A PART AT ALL.
//
// writeTarget() refuses a target that IS a Forge part -- by IDENTITY (the open
// document), by CONTENT (the first bytes are the document magic) and by BINDING
// (a file the document reads). It did not ask whether the target was merely
// OCCUPIED, and 2b5e61d3 wrote that down as clause (5), a STATED LIMIT, with
// one reason: "refusing would break 'export over my last export' for every
// script". THAT IS AN EXPORT'S REASON. A re-export over yesterday's out.step is
// idempotent re-export and a script naming a path is its author naming it; a
// Save As has no "my last save_as" to overwrite, so nothing legitimate needs
// the hole on the SAVE side.
//
// ★ AND THIS GATE PRINTED "9 populations run, all green / WRITE-TARGET GATE
//   GREEN", 0 FAIL lines, WHILE THAT HAPPENED -- the third time in this family
//   that a gate inherited its guard's blind spot. So this population is written
//   to be RED on the parent commit, and it was MEASURED red there.
//
// MEASURED at 2b5e61d3 BY THIS POPULATION, before the clause existed -- and
// nothing else in the gate moved:
//   file.save / file.save_as, from a CALLER, on an untitled document:
//     handauthored.step  |ISO-10303-21;|                    -> |FORGE-PART 4|
//     thesis.txt         |MY MEASUREMENTS -- DO NOT DELETE| -> |FORGE-PART 4|
//     notes.md           |# notes|                          -> |FORGE-PART 4|
//   and through the SHIPPING CoPilot Apply button:
//     plot.csv           |x,y|                              -> "Applied 1 of 1 step"
//   each with dispatch ok, documentErrorSeq UNCHANGED and an EMPTY error string.
//   The exact byte counts are in the commit message; they are printed by the
//   [raw] lines below on every run, so they are never a number in prose.
//
// SIX LEGS, and three of them exist so "refuse every occupied save" -- the
// cheapest wrong fix available -- cannot pass:
//   (a) the DERIVED walk of every DocumentSave command x three real victims
//   (b) the shipping Apply button, on the LIVE registry
//   (c) the SYMMETRIC ALLOWS -- a caller saving to a FREE name, and Save
//       writing the document back over ITS OWN occupied file
//   (d) the CONSENT arm through the shipping typed box, whose question already
//       asked about a non-part and whose answer is now load-bearing
//   (e) ★ THE SPLIT ITSELF: a COPY onto that same shape of target STILL
//       WRITES. Asserted here, beside the half that closed, so a later
//       widening to every intent reddens the population that OWNS the split
//       rather than a check three hundred lines away
//   (f) the OTHER MINTER: a native Save panel accepting an occupied NON-PART
//       still writes -- a class W6(f) never covered, because it only ever
//       steered the panel onto a part
void popStrangerFile(const std::string& root) {
  std::printf("\n== W10: a SAVE onto a file that is NOT a part ==========================\n");
  const std::string work = root + "/work";
  std::error_code ec;
  std::filesystem::create_directories(work, ec);

  // Three victims with DISTINCT bytes and distinct first lines, so
  // "byte-identical" is a fact about CONTENT and never about two files that
  // happen to weigh the same -- the note-on-method W6 pays for with mutation 7.
  struct Victim {
    const char* leaf;
    const char* text;
  };
  const Victim victims[] = {
      {"handauthored.step",
       "ISO-10303-21;\n/* HAND AUTHORED -- DO NOT REGENERATE */\nHEADER;\n"
       "FILE_NAME('bracket','2026-09-13');\nENDSEC;\nDATA;\n"
       "#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n"},
      {"thesis.txt", "MY MEASUREMENTS -- DO NOT DELETE\n"},
      {"notes.md", "# notes\nbracket, rev C\n"},
  };

  App b;
  started(b, "a launch with its own UNTITLED part");
  b.oneFrame();
  checkStrEq(b.frame->documentPath(), std::string(),
             "the document is untitled, so no victim is its own file");

  // ── (a) EVERY DOCUMENT-SAVE COMMAND, DERIVED, ON EVERY VICTIM ──────────
  const std::vector<std::string> saves = documentSaveCommands(b.shell.registry());
  std::printf("   [walk] document-save commands, DERIVED from descriptor.writes:");
  for (const std::string& id : saves) std::printf(" %s", id.c_str());
  std::printf("  (%zu)\n", saves.size());
  // Load-bearing rather than decoration, the way W1's `walked == 4` is: a walk
  // that silently skipped one of the two saves is the exact shape of the hole
  // this file exists to close, and a THIRD document-save command must be looked
  // at rather than absorbed.
  check(saves.size() == 2, "★ the walk finds BOTH document saves and no others",
        std::to_string(saves.size()));

  for (const std::string& id : saves) {
    for (const Victim& v : victims) {
      const std::string path = work + "/" + v.leaf;
      // RE-SEEDED BEFORE EVERY DISPATCH. On a tree without the fix the first
      // command replaces the file with a Forge part, and the second would then
      // be refused by the PART clause -- a green check for a reason that has
      // nothing to do with this population's question.
      check(writeWholeFile(path, v.text), "the user's own file is on disk", path);
      const Seen before = look(path);
      const std::size_t seq = b.shell.documentErrorSeq();
      const std::size_t mark = logMark(b.shell);
      // MUTATION 13: the caller is handed a consent before the dispatch, so
      // every refusal below must go red. Mutation 11's shape for the target
      // class T-130 is about, and it is what proves the rule turns on WHO WAS
      // ASKED and not merely on occupancy.
      if (g_mutation == 13) b.shell.consentToReplace(path);
      forge::ui::CommandParams params;
      params.setText("path", path);
      const forge::ui::DispatchResult r = b.shell.run(id, params);
      sayLog(b.shell, mark, std::string("what ") + id + " said about " + v.leaf);
      const Seen now = look(path);
      std::printf("   [ask] %-13s %-18s dispatch %-7s refused=%-3s  file %s\n", id.c_str(),
                  v.leaf, r.ok() ? "ok" : "NOT-ok",
                  b.shell.documentErrorSeq() != seq ? "yes" : "no",
                  now.text == before.text ? "byte-identical" : "REPLACED");
      say(v.leaf, path, now);
      check(!r.ok(),
            std::string("★ ") + id + " on " + v.leaf + ": a CALLER may not write over it",
            forge::ui::machineName(r.status));
      check(b.shell.documentErrorSeq() != seq,
            std::string("★ ") + id + " on " + v.leaf + ": and it SAID so",
            b.shell.lastDocumentError());
      check(now.text == before.text,
            std::string("★ ") + id + " on " + v.leaf + ": AND IT IS BYTE-IDENTICAL",
            std::to_string(before.bytes) + " B |" + before.head + "| -> " +
                std::to_string(now.bytes) + " B |" + now.head + "|");
    }
  }
  check(forge::ui::isUserReadable(b.shell.lastDocumentError()),
        "and the sentence is one a user can read", b.shell.lastDocumentError());
  check(b.shell.lastDocumentError().find(victims[2].leaf) != std::string::npos,
        "and it NAMES the file it would not write over", b.shell.lastDocumentError());

  // ── (b) THE SHIPPING APPLY BUTTON, ON THE LIVE REGISTRY ────────────────
  // ZERO LINES OF ArchieCopilot ARE TOUCHED BY THE FIX, which is the point of
  // asserting it here: validatePlan still accepts the step, and the bytes still
  // do not move, because the dispatch it makes is the dispatch the waist guards.
  const std::string plot = work + "/plot.csv";
  check(writeWholeFile(plot, "x,y\n0,0\n1,1\n"), "a CSV the user plotted from", plot);
  const Seen plotBefore = look(plot);
  say("plot.csv, before the Apply button", plot, plotBefore);
  {
    forge::ui::Plan plan;
    forge::ui::PlanStep step;
    step.commandId = "file.save_as";
    step.args.push_back(forge::ui::PlanArg::str("path", plot));
    plan.steps.push_back(step);
    const forge::ui::OpConstraintBridge bridge;
    const forge::ui::PlanVerdict verdict =
        forge::ui::validatePlan(plan, b.shell.registry(), bridge);
    std::printf("   [plan] validatePlan accepted=%s |%s|\n",
                verdict.accepted() ? "true" : "false", verdict.explanation.c_str());
    check(verdict.accepted(),
          "★ validatePlan still accepts it -- the fix is at the WRITE, not the plan",
          verdict.explanation);
    const forge::ui::ApplyOutcome applied =
        forge::ui::applyPlan(plan, b.shell, b.frame->document(), bridge);
    std::printf("   [plan] applyPlan: %s\n", applied.summary().c_str());
    check(applied.applied == 0, "★ Applied 0 of 1 step", std::to_string(applied.applied));
  }
  checkUntouched(plotBefore, look(plot), plot,
                 "★ AND plot.csv IS BYTE-IDENTICAL AFTER THE SHIPPING APPLY BUTTON");

  // ── (c) THE SYMMETRIC ALLOWS ───────────────────────────────────────────
  // Without these two, a Forge that refused EVERY save from a caller passes
  // everything above.
  const std::string fresh = work + "/fresh.fpart";
  check(!std::filesystem::exists(fresh, ec), "nothing is at fresh.fpart", fresh);
  {
    forge::ui::CommandParams params;
    params.setText("path", fresh);
    check(b.ran("file.save_as", params), "★ a caller CAN still save to a FREE name",
          b.shell.lastDocumentError());
  }
  const Seen wrote = look(fresh);
  say("fresh.fpart", fresh, wrote);
  check(wrote.exists && wrote.head.rfind("FORGE-PART", 0) == 0,
        "★ and what landed is a Forge part", wrote.head);
  check(b.note("A SECOND NOTE"), "the user edits the part", b.frame->noteRefusal());
  {
    forge::ui::CommandParams params;
    params.setText("path", fresh);
    check(b.ran("file.save", params),
          "★ and Save still writes the part back over ITS OWN occupied file",
          b.shell.lastDocumentError());
  }
  const Seen againSaved = look(fresh);
  say("fresh.fpart, saved again", fresh, againSaved);
  check(againSaved.exists && againSaved.head.rfind("FORGE-PART", 0) == 0 &&
            againSaved.notes > wrote.notes,
        "★ and it is a BIGGER part than before, not a refusal",
        std::to_string(wrote.notes) + " NOTE -> " + std::to_string(againSaved.notes));

  // ── (d) THE CONSENT ARM, THROUGH THE SHIPPING TYPED BOX ────────────────
  // ★ NO UI CHANGE WAS NEEDED FOR THIS, AND THAT IS THE FINDING.
  //   ForgeFrame::wantsReplaceQuestion() has ALWAYS tested pathIsOccupied()
  //   rather than part-ness, and drawReplacePrompt already has the sentence "a
  //   file Forge did not write". The question existed, the consent was minted
  //   and the token was accepted -- writeTarget() simply never CONSULTED it for
  //   a target that was not a part. The fix makes an existing answer
  //   load-bearing; it does not build a new one.
  {
    App d;
    started(d, "a launch that will replace a file of its own ON PURPOSE");
    check(d.note("REPLACING MY OWN NOTES ON PURPOSE"), "a part to save",
          d.frame->noteRefusal());
    const std::string mine = work + "/my-notes.txt";
    check(writeWholeFile(mine, "MY OLD NOTES -- I WILL REPLACE THESE MYSELF\n"),
          "a file of the user's own is in the way", mine);
    const Seen beforeAsk = look(mine);
    say("my-notes.txt, before the box", mine, beforeAsk);
    const std::size_t raised = d.frame->replacePromptsRaised();
    const std::size_t seq = d.shell.documentErrorSeq();
    d.frame->invoke("file.save_as");
    d.oneFrame();
    check(d.frame->promptOpen(), "the typed Save As box is up", d.shell.lastDocumentError());
    check(d.frame->setPromptValue("path", mine), "the user types their own file's name");
    d.frame->submitPrompt();
    d.oneFrame();
    check(d.frame->replacePromptsRaised() == raised + 1,
          "★ Forge ASKS before it replaces a file it did not write",
          std::to_string(d.frame->replacePromptsRaised() - raised));
    checkStrEq(d.frame->replacePromptWhat(), "a file Forge did not write",
               "★ and the question says WHAT is sitting there -- not 'another Forge part'");
    check(d.shell.documentErrorSeq() == seq,
          "and NOTHING was dispatched while the question stands", d.shell.lastDocumentError());
    checkUntouched(beforeAsk, look(mine), mine,
                   "★ and the file is untouched while the question stands");
    // MUTATION 14: the answer is "Keep the Old File", so nothing is written and
    // the check below goes red. This leg is what refuses a Forge that simply
    // refuses everything -- and the mutation is what proves the leg is live.
    if (g_mutation == 14) {
      d.frame->answerReplaceCancel();
    } else {
      d.frame->answerReplaceYes();
    }
    d.oneFrame();
    const Seen afterAnswer = look(mine);
    say("my-notes.txt, after the answer", mine, afterAnswer);
    check(afterAnswer.exists && afterAnswer.head.rfind("FORGE-PART", 0) == 0 &&
              afterAnswer.text != beforeAsk.text,
          "★ a person CAN still save over their own file -- it was WRITTEN",
          std::to_string(beforeAsk.bytes) + " B -> " + std::to_string(afterAnswer.bytes) +
              " B |" + afterAnswer.head + "|");
  }

  // ── (e) ★ THE SPLIT, PINNED IN THE POPULATION THAT OWNS IT ─────────────
  // WriteIntent::Copy onto the SAME shape of target -- occupied, not a part,
  // not bound, named by a CALLER with nobody there to ask -- STILL WRITES.
  // That is clause (6)'s stated limit and it is kept ON PURPOSE. Widening the
  // new clause from DocumentSave to every intent turns THIS check red, here,
  // instead of turning W4(c) red three hundred lines away.
  {
    const std::string source = makeUserPart(work, "bracket.fpart", "BRACKET -- RELEASED");
    App e;
    started(e, "a launch that will export a copy");
    check(e.open(source), "File > Open bracket.fpart", e.shell.lastDocumentError());
    e.oneFrame();
    e.sayScene("the part this copy is made from");
    check(e.scene.lastBuild().ok(), "the part COMPILES, so nothing below can refuse for that",
          e.scene.lastBuild().error);
    const std::string keep = work + "/keep.txt";
    check(writeWholeFile(keep, "AN ORDINARY FILE, IN THE WAY OF AN EXPORT\n"),
          "an ordinary file is in the way", keep);
    const Seen keepBefore = look(keep);
    say("keep.txt, before the export", keep, keepBefore);
    forge::ui::CommandParams params;
    params.setText("path", keep);
    check(e.ran("file.export_step", params),
          "★ THE EXPORT HALF IS UNCHANGED: a COPY onto an occupied non-part is STILL "
          "WRITTEN",
          e.shell.lastDocumentError());
    const Seen keepAfter = look(keep);
    say("keep.txt, after the export", keep, keepAfter);
    check(keepAfter.exists && keepAfter.head.rfind("ISO-10303-21", 0) == 0,
          "★ and what landed is STEP text -- the stated limit, kept on purpose",
          std::to_string(keepBefore.bytes) + " B -> " + std::to_string(keepAfter.bytes) +
              " B |" + keepAfter.head + "|");
  }

  // ── (f) THE OTHER MINTER, ON A CLASS W6(f) NEVER COVERED ───────────────
  // W6(f) steers a native panel onto an existing PART. Nothing steered one onto
  // an existing NON-PART, which is the class this round is about: an NSSavePanel
  // cannot come back ACCEPTED on a path that already exists without having shown
  // its own Replace sheet, so that IS a person having been asked -- and if the
  // new clause refused it, Save As through the panel onto a file of the user's
  // own would stop working.
  {
    App f;
    started(f, "a launch with a native panel installed");
    check(f.note("SAVED THROUGH THE PLATFORM'S OWN PANEL"), "a part to save",
          f.frame->noteRefusal());
    const std::string steered = work + "/steered.txt";
    check(writeWholeFile(steered, "THE USER STEERED THE PANEL ONTO THIS\n"),
          "an ordinary file for the panel to land on", steered);
    AnswerWithDialog panel;
    // MUTATION 15: the panel is steered onto a FREE name instead, so the
    // occupied file is never written and the check below goes red -- which is
    // what proves this leg is about an OCCUPIED target and not merely about a
    // panel that ran.
    panel.answer = (g_mutation == 15) ? (work + "/steered-free.fpart") : steered;
    f.frame->setFileDialog(&panel);
    const Seen panelBefore = look(steered);
    say("steered.txt, before the panel route", steered, panelBefore);
    f.frame->invoke("file.save_as");
    f.oneFrame();
    std::printf("   [panel] runs=%zu shown=%zu\n", panel.runs, f.frame->fileDialogsShown());
    check(panel.runs == 1, "the panel was raised exactly once", std::to_string(panel.runs));
    check(!f.frame->replacePromptOpen(),
          "★ and Forge does NOT ask a second time -- the platform already did");
    const Seen panelAfter = look(steered);
    say("steered.txt, after", steered, panelAfter);
    check(panelAfter.exists && panelAfter.head.rfind("FORGE-PART", 0) == 0 &&
              panelAfter.text != panelBefore.text,
          "★ a native Save panel accepting an EXISTING NON-PART still writes it",
          std::to_string(panelBefore.bytes) + " B -> " + std::to_string(panelAfter.bytes) +
              " B |" + panelAfter.head + "|");
  }
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
const char* const kPopulations[] = {"typed-box",   "typed-path",   "renamed",
                                    "allows",      "native-panel", "occupied",
                                    "bound-input", "save-waist",   "failed-export",
                                    "stranger-file"};

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
  //   7  W6's two parts are made the SAME SHAPE, so "replaced" and "untouched"
  //      are the same bytes and the byte-identical checks cannot tell them
  //      apart. It is this gate's own note-on-method as a mutation: the
  //      reproduce phase's first control was degenerate for exactly this reason
  //      and printed NOT-REPRO for the wrong one.
  //   8  W6 never presses Run. "The other part is byte-identical" is true of a
  //      Forge that wrote nothing, so what goes red is "the part WAS saved, at
  //      the free name the box offered" -- the check that tells a fix from a
  //      Save As that silently does nothing. MEASURED: against the first version
  //      of W6, which lacked that check, this mutation STAYED GREEN.
  //   9  W6's Replace answer is recorded for a DIFFERENT path, so the consent
  //      can never match the file being written and "a person CAN still replace
  //      an old part" goes red -- which proves the consent is PATH-SCOPED.
  //  10  W7 is handed an EMPTY binding list -- T-127's blindness restored at the
  //      one line that removed it. Its bound checks go red and NOTHING ELSE
  //      does, which is what proves they measure the BINDING, not occupancy.
  //  11  W8's caller route is handed a consent, so "a caller may not replace
  //      another user's part" goes red -- the caller/human distinction.
  //  12  W9 leaves the folder writable, so the export succeeds and both "it
  //      refused" and "the bytes survived" go red.
  //  13  W10's caller walk is handed a consent before EVERY dispatch, so every
  //      refusal in leg (a) goes red. Mutation 11's shape for the target class
  //      T-130 is about -- it is what proves the OCCUPANCY clause turns on WHO
  //      WAS ASKED and not merely on the file being there.
  //  14  W10's typed box answers "Keep the Old File" instead of "Replace the
  //      File", so "a person CAN still save over their own file" goes red. This
  //      is the one that refuses a Forge which simply refuses EVERYTHING -- the
  //      cheapest wrong fix available for this round.
  //  15  W10's native panel is steered onto a FREE name, so "a panel accepting
  //      an EXISTING non-part still writes it" goes red -- which proves that leg
  //      is about an OCCUPIED target and not merely about a panel that ran.
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
  } else if (population == "occupied") {
    popOccupied(root);
  } else if (population == "bound-input") {
    popBoundInput(root);
  } else if (population == "save-waist") {
    popSaveWaist(root);
  } else if (population == "failed-export") {
    popFailedExport(root);
  } else if (population == "stranger-file") {
    popStrangerFile(root);
  } else {
    std::printf("[gate] unknown population '%s'\n", population.c_str());
    return 2;
  }

  std::printf("\n[gate] %d checks, %d failures\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
