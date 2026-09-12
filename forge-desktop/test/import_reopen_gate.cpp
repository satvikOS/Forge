// forge-desktop/test/import_reopen_gate.cpp
//
// THE IMPORT–SAVE–REOPEN GATE — does an imported STEP survive a restart?
//
// ── THE DEFECT, MEASURED BEFORE THIS GATE EXISTED ───────────────────────────
// Import a STEP, Save, quit, come back. That is the most common workflow in CAD
// and on this tree it did not work, in silence:
//
//   .fpart on disk    FORGE-PART 3 / FEATURE / ... / OP INPUT / END
//                     — the op, and NO PATH. Nothing in the file named the STEP.
//   fresh process     file.open ok=1, err=''            <- reported SUCCESS
//                     program: %1 = INPUT()
//                     scene.inputFile()=''              <- nothing re-bound it
//                     scene build: compiled=0 volume=0.000000 faces=-1
//                     error: "op %1 (line 1): INPUT() used but no input STEP was
//                             supplied to the compiler"
//
// A Save that says it worked, an Open that says it worked, and an empty
// viewport. `INPUT()` has arity 0..0 in the kernel's op table and reads
// Builder::inputStep, so the path is DOCUMENT STATE beside the program — and
// the document format carried no trace of it. No gate covered any of this:
// file_exchange_gate proves an import reaches the document IN ONE PROCESS and
// document_gate round-trips a .fpart that has no INPUT() in it.
//
// ── WHAT THIS GATE ASSERTS ──────────────────────────────────────────────────
//   1. the fixture is DISCRIMINATING: the imported part's volume, face count and
//      edge count all differ from the starter part the app opens on, so a reopen
//      that silently fell back to the seed cannot read as a pass;
//   2. the import reaches the viewport in this process (the control);
//   3. the saved .fpart NAMES the source file, ABSOLUTELY and BYTE FOR BYTE;
//   4. A FRESH PROCESS opens that .fpart and rebuilds THE SAME SOLID — volume,
//      face count and edge count, not volume alone, because this programme has
//      four recorded cases of a wrong solid reproducing a right volume;
//   5. the reopened document can still be EXPORTED, which is the half a fix that
//      rebinds only the viewport leaves broken;
//   6. a source file that cannot be USED is REFUSED by name, in plain words, and
//      leaves the open document alone — not a silent empty part. FOUR ways:
//      moved away, overwritten with junk, truncated to nothing, and a path that
//      names a folder. The last three are PRESENT files, and an existence check
//      passes every one of them.
//
// ── AND THE SIX THINGS THE FIRST VERSION OF THIS FIX GOT WRONG ──────────────
// Each was MEASURED on the commit that introduced the key, and each has a check
// here now:
//   7. a version-3 .fpart — every file the shipped app ever wrote for an
//      imported part — carries `OP INPUT` and no path. It must OPEN, with a
//      warning. It was refused, which made an existing class of user documents
//      unopenable.
//   8. a source path containing a TAB was written through the format's free-text
//      writer, which maps control characters to spaces. The reopen then refused
//      a file that had never moved, naming a path no file has.
//   9. an import typed as a RELATIVE path was recorded verbatim, so the document
//      only opened from the directory the import happened in.
//  10. renaming the job folder broke the part, with the .step sitting right
//      beside the .fpart. The recorded name is now looked for BESIDE THE
//      DOCUMENT before anything is refused.
//  11. `import A, File > New, state an imported solid, Save` wrote A's path into
//      a document that had never seen it. The binding now has a LIFETIME.
//  12. a source that was PRESENT but unusable -- junk, empty, a folder -- opened
//      in silence into `%1 = INPUT()`, volume 0, faces -1.
//
// ── AND THE FIVE THE *SECOND* VERSION PRODUCED ──────────────────────────────
//  13. the look beside the document was skipped entirely for a BARE RELATIVE
//      document name -- which is how main.cpp dispatches a command-line path,
//      and how anyone opens a job folder they have just cd'd into.
//  14. an open that binds NOTHING did not clear a live binding, so a legacy part
//      naming no source built the LAST part's solid and an edit wrote that path
//      into it permanently. Three things had to be true at once and the gate
//      arranged none of them: this gate PASSED with that line broken.
//  15. a file that is PRESENT and cannot be READ was reported as absent, and told
//      the user to put back a file that had never left.
//  16. the sibling warning said "which is not there now" about a file that was
//      there and junk.
//  17. that same sentence ended "Save the part to record where it is now" and
//      file.save was `disabled` at that moment.
//
// Every claim about what a REOPEN does -- the rebuild, the export, the tab name,
// the relative import, the renamed folder, the bare name, and all five unusable
// sources -- runs in a REAL SECOND PROCESS (this binary, re-executed), because
// "survives a restart" is not a claim an in-process round trip can make: every
// binding the defect is about lives in memory a restart destroys. The claims
// about what happens WITHIN one session -- a live binding followed by a part that
// names none, the warning's words, the save it prescribes -- are in-process for
// the opposite reason: a second session could not hold the first part's binding.
//
// ── ★ IT CAN FAIL, AND IT IS RUN THAT WAY ───────────────────────────────────
//   ./forge_desktop_import_reopen_gate            the gate
//   ./forge_desktop_import_reopen_gate --mutate N inject one defect; MUST go red
//
//   1  the .fpart is written WITHOUT the path  -> exactly the shipped defect:
//      (the INPUT-FILE line is stripped)          `OP INPUT` and nothing else
//   2  nothing re-binds the SCENE on open      -> the second half of the defect:
//                                                 the file names the STEP and the
//                                                 rebuild is never told
//   3  the scene is re-bound and the EXCHANGE  -> the half fix that draws the
//      is not                                    right part and cannot save it
//   4  the path is re-bound to a DIFFERENT     -> the reopen builds A solid, just
//      file (the starter part, exported)         not the user's. A check that
//                                                only asked "did it build" passes.
//   5  the source file is NOT moved before the -> proves the refusal checks are
//      missing-source run                        falsifiable: the refusal they
//                                                require is one a present file
//                                                does not produce.
//   6  the recorded path is SANITISED the way  -> the defect measured on the tab
//      the free-text writer sanitises a value    fixture: the file never moved
//      (control bytes -> spaces, ends trimmed)   and the document cannot find it
//   7  the moved job folder's source file is   -> proves the "found beside the
//      DELETED after the rename                  document" check is falsifiable
//   8  the four UNUSABLE sources are left      -> proves the junk / empty /
//      intact                                    truncated / folder refusals are
//                                                falsifiable
//   9  the previous import is re-bound after   -> the staleness defect: File > New
//      File > New                                leaving the last part's source
//                                                bound to a brand new document
//  10  the file beside the BARE-NAME folder is  -> proves the bare-name open finds
//      deleted                                    the file BECAUSE it is there
//  11  the previous part's source is re-bound   -> the severe defect: a legacy part
//      after an open that binds nothing           naming no source building the
//                                                 LAST part's solid, and an edit
//                                                 then writing that path into it
//  12  the permission fixture is left readable  -> proves the unreadable checks are
//                                                 not testing an unlocked file
//  13  the recorded source is DELETED instead   -> proves "the warning must not
//      of junked                                  claim absence" can go red
//  14  a GOOD copy is left at the recorded path -> proves the dirty-on-open, and the
//                                                 Save it makes available, belong to
//                                                 a MOVED source and not to every
//                                                 Open
//  15  the file beside the bare-name folder is  -> a bare-name open that finds A
//      the DECOY solid                            file and builds the wrong part
//                                                 must not read as a pass either
//
// Mutations 5, 7, 8, 10, 12, 13 and 14 are controls on the gate's own expectations
// rather than on the application, and they are written down as that: they prove
// those assertions fire, and they do not prove the production checks are reachable
// by any other route. 1, 2, 3, 4, 6, 9, 11 and 15 are defects.
//
// ★ AND THE MUTATIONS ABOVE ARE NOT THE WHOLE PROOF. A --mutate flag can only
//   reach what the gate binary can stage; the production lines are proved by
//   breaking the SOURCE, one line at a time, rebuilding and re-running. That
//   sweep is in this commit's message, and it is what found the hole that let
//   `if (!boundInput.empty()) bindInputFile(boundInput)` pass with 96 checks and
//   0 failures.
#include <sys/stat.h>
#include <unistd.h>

#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <ios>
#include <sstream>
#include <string>
#include <vector>

#include "imgui.h"

#include "FileExchangeHost.hpp"
#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "PartFile.hpp"

#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/FileExchange.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace {

int g_checks = 0;
int g_failed = 0;

void report(bool ok, const std::string& what) {
  ++g_checks;
  if (!ok) {
    ++g_failed;
    std::printf("  FAIL  %s\n", what.c_str());
  }
}
#define CHECK(cond, what) report((cond), (what))

bool approxRel(double a, double b, double rel, double abs) {
  const double d = std::fabs(a - b);
  if (d <= abs) return true;
  const double scale = std::fabs(a) > std::fabs(b) ? std::fabs(a) : std::fabs(b);
  return scale > 0.0 && d / scale <= rel;
}

std::string slurp(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

bool spill(const std::string& path, const std::string& text) {
  std::ofstream out(path, std::ios::trunc | std::ios::binary);
  if (!out) return false;
  out.write(text.data(), static_cast<std::streamsize>(text.size()));
  return static_cast<bool>(out);
}

// What writeField would have done to a value. The gate spells it out rather than
// calling the production one, because mutation 6 has to be able to re-apply the
// DEFECT after it has been removed from the writer.
std::string sanitiseLikeWriteField(const std::string& in) {
  std::string out;
  for (char c : in) {
    const unsigned char u = static_cast<unsigned char>(c);
    out.push_back(u < 0x20 || u == 0x7f ? ' ' : c);
  }
  std::size_t b = 0;
  while (b < out.size() && std::isspace(static_cast<unsigned char>(out[b])) != 0) ++b;
  std::size_t e = out.size();
  while (e > b && std::isspace(static_cast<unsigned char>(out[e - 1])) != 0) --e;
  return out.substr(b, e - b);
}

// Rewrites the INPUT-FILE line of a .fpart in place. Returns false when there is
// none, which is a mutation that silently did nothing and must not read as a
// pass.
bool rewriteInputFileLine(const std::string& fpart, const std::string& value) {
  std::string text = slurp(fpart);
  const std::size_t at = text.find("INPUT-FILE ");
  if (at == std::string::npos) return false;
  const std::size_t eol = text.find('\n', at);
  if (eol == std::string::npos) return false;
  text = text.substr(0, at) + "INPUT-FILE " + value + text.substr(eol);
  return spill(fpart, text);
}

std::string inputFileLine(const std::string& fpart) {
  std::istringstream in(slurp(fpart));
  std::string line;
  while (std::getline(in, line)) {
    if (line.rfind("INPUT-FILE ", 0) == 0) return line.substr(std::strlen("INPUT-FILE "));
  }
  return std::string();
}

std::string tempDir() {
  const char* t = std::getenv("TMPDIR");
  std::string d = (t != nullptr && t[0] != 0) ? std::string(t) : std::string("/tmp");
  while (d.size() > 1 && d.back() == '/') d.pop_back();
  return d;
}

// A real ImGui context with a null renderer backend. ForgeFrame is constructed
// in both halves of this gate and it holds one; no frame is drawn here.
struct HeadlessImGui {
  HeadlessImGui() {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(1600.0f, 1000.0f);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int w = 0;
    int h = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &w, &h);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

// The application, assembled the way main.cpp assembles it: one scene, one
// shell, one frame, and the file exchange that ties the document's INPUT() to a
// file. Nothing here is a test double.
struct App {
  HeadlessImGui gui;
  forge::desktop::KernelScene scene;
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame{shell, scene};
  forge::desktop::FileExchangeHost exchange{frame.document(), &scene};

  App() {
    frame.wirePartCommands();
    shell.setFileExchange(&exchange);
    // The app's first frame does this; wirePartCommands seeds the document and
    // leaves the scene unbuilt. Without it "the viewport still holds the part
    // that was open" below would be comparing two zeroes.
    frame.syncSceneToDocument();
  }

  forge::ui::DispatchResult run(const char* id, const std::string& path) {
    forge::ui::CommandParams p;
    p.setText("path", path);
    return shell.run(id, p);
  }
};

// ── the SOURCE PART: deliberately NOT the part the app opens on ─────────────
// A plate 64 x 44 x 12 with TWO d10 bores and r2 corners, against the starter
// part's 80 x 50 x 20 with ONE d12 bore and r3. The second bore is what makes
// the FACE COUNT differ as well as the volume: two parts of the same topology
// and different sizes would leave a face-count check unable to tell a reopen
// from a silent fallback to the seed, and this gate asserts both.
void seedSourcePart(forge::ui::PartDocument& doc) {
  using forge::ui::IrArg;
  using forge::ui::IrLine;
  using forge::ui::IrValueKind;
  struct Op {
    const char* op;
    std::vector<IrArg> args;
    IrValueKind produces;
  };
  const std::vector<Op> ops = {
      {"RECT", {IrArg::num(64.0), IrArg::num(44.0)}, IrValueKind::Profile},
      {"EXTRUDE", {IrArg::valueRef(1), IrArg::num(12.0)}, IrValueKind::Solid},
      {"CYL",
       {IrArg::num(5.0), IrArg::num(40.0), IrArg::num(-15.0), IrArg::num(0.0), IrArg::num(-4.0)},
       IrValueKind::Solid},
      {"CUT", {IrArg::valueRef(2), IrArg::valueRef(3)}, IrValueKind::Solid},
      {"CYL",
       {IrArg::num(5.0), IrArg::num(40.0), IrArg::num(15.0), IrArg::num(0.0), IrArg::num(-4.0)},
       IrValueKind::Solid},
      {"CUT", {IrArg::valueRef(4), IrArg::valueRef(5)}, IrValueKind::Solid},
      {"FILLET",
       {IrArg::valueRef(6), IrArg::num(2.0), IrArg::keyword("VERTICAL")},
       IrValueKind::Solid},
  };
  doc.restore(forge::ui::PartDocument::Snapshot{});
  for (const Op& o : ops) {
    forge::ui::FeatureRecord rec;
    rec.irId = doc.nextIrId();
    rec.label = o.op;
    rec.line = IrLine{rec.irId, o.op, o.args};
    rec.produces = o.produces;
    const bool added = doc.appendFeature(rec, {}, std::string("body_") + std::to_string(rec.irId));
    CHECK(added, std::string("the source document refused ") + o.op + " -- " +
                     forge::ui::toString(doc.lastCheck()));
  }
}

// The source part, exported to `path` as a real STEP file. The fixtures below
// need several of them in several folders, and every one comes from THIS
// document so that the volume / face / edge vector is the same fact everywhere.
bool writeSourceStep(const std::string& path) {
  forge::ui::PartDocument doc;
  seedSourcePart(doc);
  forge::desktop::FileExchangeHost writer(doc, nullptr);
  forge::ui::ExchangeReport rep;
  const bool ok = writer.exportFile(path, forge::ui::ExchangeFormat::Step, rep);
  CHECK(ok, "could not write a source STEP at " + path + ": " + rep.message);
  return ok;
}

// ── THE FRESH PROCESS ───────────────────────────────────────────────────────
//
// Everything below runs in a process that has never seen the import: the only
// thing carried across is the .fpart on disk, which is the whole point.
int reopen(int argc, char** argv) {
  // --reopen <fpart> <source> <volume> <faces> <edges> [--drop-scene-rebind]
  //                                                    [--drop-exchange-rebind]
  if (argc < 7) {
    std::printf("  FAIL  --reopen needs <fpart> <source> <volume> <faces> <edges>\n");
    return 1;
  }
  const std::string fpart = argv[2];
  const std::string source = argv[3];
  const double wantVolume = std::atof(argv[4]);
  const long wantFaces = std::atol(argv[5]);
  const long wantEdges = std::atol(argv[6]);
  bool dropSceneRebind = false;
  bool dropExchangeRebind = false;
  std::string enter;
  for (int i = 7; i < argc; ++i) {
    if (std::strcmp(argv[i], "--drop-scene-rebind") == 0) dropSceneRebind = true;
    if (std::strcmp(argv[i], "--drop-exchange-rebind") == 0) dropExchangeRebind = true;
    // ★ --chdir: open the document by the name it is given AFTER moving into a
    //   folder, so `fpart` above can be a BARE RELATIVE NAME. That is not an
    //   exotic way to open a part -- main.cpp dispatches a command-line path as
    //   typed, so `forge part.fpart` is exactly this -- and it is the case the
    //   look beside the document skipped entirely, because folderOf("part.fpart")
    //   is "".
    if (std::strcmp(argv[i], "--chdir") == 0 && i + 1 < argc) enter = argv[++i];
  }
  if (!enter.empty()) {
    if (::chdir(enter.c_str()) != 0) {
      std::printf("  FAIL  could not enter %s\n", enter.c_str());
      return 1;
    }
    std::printf("\n-- FRESH PROCESS in %s: open \"%s\" AS TYPED ----------\n", enter.c_str(),
                fpart.c_str());
  }

  std::printf("\n-- FRESH PROCESS: open the saved part ------------------------------\n");
  App app;
  const forge::ui::DispatchResult opened = app.run("file.open", fpart);
  CHECK(opened.ok() && app.shell.lastDocumentError().empty(),
        "the reopened part did not open: " + app.shell.lastDocumentError());
  if (!opened.ok()) return 1;

  // MUTATION 2: nothing re-binds the file the document names, which is the state
  // this gate was written for. The rebuild below is then handed no input.
  if (dropSceneRebind) {
    app.scene.setInputFile(std::string());
    app.scene.buildFromIr(app.frame.document().irProgram());
  }
  // MUTATION 3: the viewport is re-bound and the exchange is not -- the fix that
  // draws the right part and cannot save a copy of it.
  if (dropExchangeRebind) {
    app.exchange.bindInputFile(std::string());
    app.scene.setInputFile(source);
  }

  std::printf("  program: %s", app.frame.document().irProgram().c_str());
  std::printf("  bound:   scene=\"%s\" exchange=\"%s\"\n", app.scene.inputFile().c_str(),
              app.exchange.inputFile().c_str());

  CHECK(app.scene.inputFile() == source,
        "the viewport was not told which file the document's INPUT() means: \"" +
            app.scene.inputFile() + "\"");
  CHECK(app.exchange.inputFile() == source,
        "the file exchange was not told either: \"" + app.exchange.inputFile() + "\"");

  const forge::desktop::IrBuildReport& built = app.scene.lastBuild();
  std::printf("  rebuilt: compiled=%d volume=%.6f faces=%ld edges=%ld  \"%s\"\n",
              static_cast<int>(built.compiled), built.volume, built.faceCount, built.edgeCount,
              built.error.c_str());
  CHECK(built.compiled, "the reopened document did not rebuild: " + built.error);
  CHECK(built.error.empty(), "the rebuild reported: " + built.error);
  // A VECTOR, never a volume alone.
  CHECK(approxRel(built.volume, wantVolume, 1e-9, 1e-9),
        "VOLUME moved across save and reopen: " + std::to_string(built.volume) + " vs " +
            std::to_string(wantVolume));
  CHECK(built.faceCount == wantFaces, "FACE COUNT moved across save and reopen: " +
                                          std::to_string(built.faceCount) + " vs " +
                                          std::to_string(wantFaces));
  CHECK(built.edgeCount == wantEdges, "EDGE COUNT moved across save and reopen: " +
                                          std::to_string(built.edgeCount) + " vs " +
                                          std::to_string(wantEdges));
  CHECK(app.scene.triangleCount() > 0, "the reopened part put no triangles in the viewport");

  // ── AND IT CAN STILL BE SAVED ──────────────────────────────────────────
  // exportFile compiles the document with the EXCHANGE's binding, not the
  // scene's. A reopen that re-bound only the viewport passes every check above
  // and refuses here, which is why this is not folded into them.
  const std::string copy =
      tempDir() + "/forge_import_reopen_copy_" + std::to_string(::getpid()) + ".step";
  std::remove(copy.c_str());
  const forge::ui::DispatchResult saved = app.run("file.export_step", copy);
  CHECK(saved.ok(), "the reopened part could not be saved as STEP: " +
                        app.shell.lastExchange().message);
  CHECK(slurp(copy).rfind("ISO-10303-21", 0) == 0,
        "what the reopened part wrote is not a STEP file");
  std::remove(copy.c_str());

  std::printf("  %d checks, %d failed\n", g_checks, g_failed);
  return g_failed == 0 ? 0 : 1;
}

// ── THE FRESH PROCESS, WITH A SOURCE FILE IT CANNOT USE ─────────────────────
//
// FOUR fixtures come through here and the assertions are identical for all of
// them, which is the point: moved away, overwritten with junk, truncated to
// nothing, and a path that names a FOLDER. The last three are files that EXIST,
// and the first version of this check asked only whether the name could be
// opened -- so all three of them opened "successfully" into `%1 = INPUT()`,
// volume 0.000000, faces -1 and not one word to the user. Measured.
int reopenRefused(int argc, char** argv) {
  if (argc < 5) {
    std::printf("  FAIL  --reopen-refused needs <fpart> <name-in-message> <what>\n");
    return 1;
  }
  const std::string fpart = argv[2];
  const std::string source = argv[3];
  const std::string what = argv[4];
  // ★ --forbid <words>: a phrase the refusal must NOT contain. A refusal is held
  //   to what it SAYS as well as to the fact that it said something, and the
  //   failure this exists for is a true refusal carrying a false clause -- "there
  //   is no file at that name now", about a file sitting right there behind a
  //   permission.
  std::string forbid;
  // ★ --expect <words>, repeatable: a phrase the refusal MUST contain. This is
  //   what holds each refusal to ITS OWN sentence rather than to "it said
  //   something". MEASURED as a hole in the mutation sweep of this very commit:
  //   deleting the zero-bytes check, or collapsing the five remedies back into
  //   one, left the gate GREEN -- every fixture was still refused, just with the
  //   wrong words, which is the whole subject of failures 3 and 4.
  std::vector<std::string> expect;
  for (int i = 5; i < argc; ++i) {
    if (std::strcmp(argv[i], "--forbid") == 0 && i + 1 < argc) forbid = argv[++i];
    if (std::strcmp(argv[i], "--expect") == 0 && i + 1 < argc) expect.emplace_back(argv[++i]);
  }

  std::printf("\n-- FRESH PROCESS: the source file %s ----------\n", what.c_str());
  App app;
  // What the document holds BEFORE the open: the starter part. A refused open
  // must leave exactly this.
  const std::string before = app.frame.document().irProgram();
  const double volumeBefore = app.scene.lastBuild().volume;

  const forge::ui::DispatchResult opened = app.run("file.open", fpart);
  const std::string said = app.shell.lastDocumentError();
  std::printf("  file.open ok=%d\n  said: \"%s\"\n", static_cast<int>(opened.ok()), said.c_str());

  // ── ASSERTED ON THE CHANNEL THE USER ACTUALLY READS ─────────────────────
  // NOT on the dispatch status. MEASURED on this tree: file.open's handler sets
  // documentError_ and RETURNS without failing the context, so its DispatchResult
  // reports ok() == true for every refusal -- a missing file, a corrupt file,
  // this one. That is a pre-existing defect in the shell's own handler and it is
  // not this change's to fix; what matters here is that ForgeFrame::openPath
  // treats `r.ok() && why.empty()` as success and shows `why` in the activity
  // log, so the sentence below is the one a user is really given.
  CHECK(!said.empty(),
        "a part whose source file " + what + " opened in SILENCE -- into an empty viewport");
  CHECK(said.find(source) != std::string::npos,
        "the refusal does not name the file it cannot use: \"" + said + "\"");
  // The user's sentence, by the same predicate every file-exchange message is
  // held to: no namespaces, no snake_case, no interior-capital identifiers.
  CHECK(forge::ui::isUserReadable(said), "the refusal is not plain words: \"" + said + "\"");
  if (!forbid.empty()) {
    CHECK(said.find(forbid) == std::string::npos,
          "the refusal says \"" + forbid + "\" about a file that " + what + ": \"" + said + "\"");
  }
  for (const std::string& want : expect) {
    CHECK(said.find(want) != std::string::npos,
          "the refusal about a file that " + what + " does not say \"" + want + "\": \"" + said +
              "\"");
  }

  // AND THE DOCUMENT THAT WAS OPEN IS STILL OPEN. "a specific error rather than
  // an empty part" is two claims and this is the second one.
  CHECK(app.frame.document().irProgram() == before,
        "the refused open replaced the document that was already open");
  CHECK(app.scene.lastBuild().volume == volumeBefore && volumeBefore > 0.0,
        "the refused open emptied the viewport");

  std::printf("  %d checks, %d failed\n", g_checks, g_failed);
  return g_failed == 0 ? 0 : 1;
}

// Re-execute THIS binary. The child inherits stdout, so a FAIL line it prints is
// a FAIL line in this gate's transcript, which is what run_desktop.sh reads.
int spawn(const std::string& self, const std::string& args) {
  std::fflush(stdout);
  const std::string cmd = "\"" + self + "\" " + args;
  const int rc = std::system(cmd.c_str());
  std::fflush(stdout);
  return rc;
}

std::string number(double v) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.17g", v);
  return buf;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc > 1 && std::strcmp(argv[1], "--reopen") == 0) return reopen(argc, argv);
  if (argc > 1 && std::strcmp(argv[1], "--reopen-refused") == 0) return reopenRefused(argc, argv);

  int mutation = 0;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) mutation = std::atoi(argv[++i]);
  }
  std::printf("=== Forge import/save/reopen gate ===\n");
  std::printf("  mutation: %d  (0 = none)\n", mutation);

  // The fixture names carry THIS PROCESS'S id. run_desktop.sh runs the gate and
  // its five mutations one after another, but ctest is free to run them at once,
  // and six copies sharing one source.step would move each other's files -- a
  // flake that reads as a real failure. The child processes are handed these
  // paths on their command line, so they need no such rule of their own.
  const std::string dir = tempDir();
  const std::string tag = "/forge_import_reopen_" + std::to_string(::getpid());
  const std::string source = dir + tag + "_source.step";
  const std::string decoy = dir + tag + "_decoy.step";
  const std::string moved = source + ".moved";
  const std::string fpart = dir + tag + ".fpart";
  const std::string missingFpart = dir + tag + "_missing.fpart";
  // The fixtures for the five failures the first version of this fix produced.
  // This name carries BOTH bytes a free-text value loses: a TAB, which the
  // writer replaced with a space, and a TRAILING SPACE, which the reader trimmed
  // off. Both are legal in a file name on every platform Forge ships on, and a
  // path is not text the file is describing -- it is a name handed back to the
  // operating system, where one byte different is a different file.
  const std::string tabSource = dir + tag + "_a\tb.step ";
  const std::string tabFpart = dir + tag + "_tab.fpart";
  const std::string relDir = dir + tag + "_rel";
  const std::string relFpart = dir + tag + "_rel.fpart";
  const std::string jobDir = dir + tag + "_job";
  const std::string jobMoved = dir + tag + "_job_moved";
  const std::string folderFpart = dir + tag + "_folder.fpart";
  const std::string v3Fpart = dir + tag + "_v3.fpart";
  // The fixtures for the FIVE failures the SECOND version of this fix produced.
  const std::string bareDir = dir + tag + "_bare";
  const std::string bareMoved = dir + tag + "_bare_moved";
  const std::string staleFpart = dir + tag + "_stale_v4.fpart";
  const std::string staleV3 = dir + tag + "_stale_v3.fpart";
  const std::string lockedSource = dir + tag + "_locked.step";
  const std::string lockedFpart = dir + tag + "_locked.fpart";
  const std::string lockedDir = dir + tag + "_locked_dir";
  const std::string twinDir = dir + tag + "_twin";
  const std::string twinSrc = dir + tag + "_twin_src";
  // A file name with a LINE BREAK in it. Legal on every platform Forge ships
  // on, and the one byte a line-based format cannot carry back.
  const std::string newlineSource = dir + tag + "_a\nb.step";
  const std::string relBeside = dir + tag + "_relbeside";
  const std::string junkDir = dir + tag + "_junk_src";
  const std::string junkPart = dir + tag + "_junk_part";
  for (const std::string& p : {source, decoy, moved, fpart, missingFpart, tabSource, tabFpart,
                               relFpart, folderFpart, v3Fpart, relDir + "/rel.step",
                               jobDir + "/part.step", jobDir + "/part.fpart",
                               jobMoved + "/part.step", jobMoved + "/part.fpart",
                               staleFpart, staleV3, lockedSource, lockedFpart,
                               bareDir + "/part.step", bareDir + "/part.fpart",
                               bareMoved + "/part.step", bareMoved + "/part.fpart",
                               junkDir + "/thing.step", junkPart + "/thing.step",
                               junkPart + "/thing.fpart", lockedDir + "/inside.step",
                               twinDir + "/twin.step", twinDir + "/twin.fpart",
                               twinSrc + "/twin.step", newlineSource,
                               relBeside + "/part.step", relBeside + "/part.fpart"}) {
    std::remove(p.c_str());
  }
  for (const std::string& d : {relDir, jobDir, jobMoved, bareDir, bareMoved, junkDir, junkPart,
                               lockedDir, twinDir, twinSrc, relBeside}) {
    ::rmdir(d.c_str());
  }

  // ── 0. THE FORMAT RULE the new key carries ───────────────────────────────
  // INPUT-FILE was introduced in version 4, so a file that CLAIMS an older
  // version and carries one has been hand-edited or half-written and is refused
  // as the corruption it is -- the same additive-only rule the drawing blocks
  // are held to. Asserted here because this is the change that added the key.
  {
    // The version numbers are READ from the format's own constants, never
    // written down here: a probe that spells "3" and "4" is one that keeps
    // testing the right thing only until the next key is added.
    const int added = forge::desktop::kPartFileInputVersion;
    const int older = forge::desktop::kPartFileDrawingVersion;
    CHECK(older < added, "the version before INPUT-FILE is not older than it, so the "
                         "additive-only probe below tests nothing");
    const std::string body = "NAME probe\nUNITS mm\nINPUT-FILE /a/b.step\n";
    forge::desktop::PartFileDoc read;
    std::string why;
    CHECK(!forge::desktop::readPartFile(
              "FORGE-PART " + std::to_string(older) + "\n" + body, read, why),
          "a file older than version " + std::to_string(added) +
              " carrying INPUT-FILE was accepted");
    CHECK(why.find("version " + std::to_string(added)) != std::string::npos,
          "the refusal does not say which version added the key: " + why);
    CHECK(forge::desktop::readPartFile(
              "FORGE-PART " + std::to_string(added) + "\n" + body, read, why),
          "a current file carrying INPUT-FILE was refused: " + why);
    CHECK(read.inputFile == "/a/b.step", "the path did not survive the read: " + read.inputFile);
    // ★ AND THE REFUSAL LISTS WHAT THIS BUILD CAN READ. A build that reads {1,3,4}
    //   used to say "version 1 and version 4" -- a set with a hole in it, quoted
    //   as a range. The version numbers are read from the constants, never spelled
    //   here, so this keeps working when the next key is added. MEASURED as a hole
    //   in this commit's sweep: replacing the list with a single number stayed
    //   GREEN.
    {
      forge::desktop::PartFileDoc two;
      std::string twoWhy;
      CHECK(!forge::desktop::readPartFile("FORGE-PART 2\nNAME p\n", two, twoWhy),
            "a version-2 file was accepted by the part reader");
      for (const int v : {1, older, added}) {
        CHECK(twoWhy.find(std::to_string(v)) != std::string::npos,
              "the refusal does not say this build can read version " + std::to_string(v) + ": " +
                  twoWhy);
      }
      std::printf("  a version-2 file is refused with: \"%s\"\n", twoWhy.c_str());
    }
    CHECK(!forge::desktop::readPartFile(
              "FORGE-PART " + std::to_string(added) + "\nNAME p\nINPUT-FILE\n", read, why),
          "INPUT-FILE with no path was accepted");
    // write(read(x)) == x, with the key in it: a writer and a reader that
    // disagree about one line make every later save a lossy one.
    const std::string again = forge::desktop::writePartFile(read);
    forge::desktop::PartFileDoc back;
    CHECK(forge::desktop::readPartFile(again, back, why), "the writer's own output: " + why);
    CHECK(forge::desktop::writePartFile(back) == again,
          "write(read(x)) != x once the file names an input file");

    // ★ A PATH THAT IS NOT A PATH. Asked of inputFileState directly, because
    //   documentOpen cannot reach it -- the empty case is answered earlier and a
    //   line-based reader cannot carry a newline in a value. A guard no caller
    //   can reach today is still the guard the NEXT caller meets, and this is
    //   what proves it is there: the sweep of this commit found it green when
    //   deleted.
    CHECK(forge::desktop::inputFileState(std::string()) == forge::desktop::InputFileState::Missing,
          "an EMPTY input-file name was not refused");
    // ...and the same question asked of a file that REALLY EXISTS under a name
    // with a line break in it. That is the only form of this check that can
    // fail: for a name no file has, stat() answers ENOENT and the guard looks
    // redundant. MEASURED as a hole in the sweep when it was written the easy
    // way.
    // Written under an ordinary name and RENAMED into place: the STEP exporter
    // refuses a path with a line break in it -- correctly, and for this very
    // reason -- so the fixture has to be made the way an outside tool would make
    // it. rename(2) takes any bytes.
    const std::string nlTemp = dir + tag + "_nl_temp.step";
    CHECK(writeSourceStep(nlTemp), "could not write the line-break fixture's bytes");
    CHECK(std::rename(nlTemp.c_str(), newlineSource.c_str()) == 0,
          "could not name a file with a line break in it");
    CHECK(std::ifstream(newlineSource, std::ios::binary).good(),
          "the line-break fixture is not readable, so the check below tests nothing");
    CHECK(forge::desktop::inputFileState(newlineSource) ==
              forge::desktop::InputFileState::Missing,
          "a REAL, READABLE model file whose name contains a LINE BREAK was accepted -- no "
          ".fpart line can carry that name back, so binding it would record a path the file "
          "format cannot express");

    // ★ AND A DOCUMENT WITH NO INPUT() RECORDS NO PATH, however the session is
    //   bound. Asked of capturePartDocument directly for the same reason: the
    //   binding has a lifetime, and every route that empties the document also
    //   clears it, so no sequence of shipping commands can present this pair.
    //   The guard is what keeps that true if one ever can.
    {
      forge::ui::PartDocument plainDoc;
      seedSourcePart(plainDoc);  // RECT/EXTRUDE/CYL/CUT/FILLET -- no INPUT()
      const forge::desktop::PartFileDoc captured = forge::desktop::capturePartDocument(
          plainDoc, "plain", forge::ui::DrawingModel{}, "/somewhere/else.step");
      CHECK(captured.inputFile.empty(),
            "a document with no INPUT() statement recorded an input file anyway: \"" +
                captured.inputFile + "\"");
      CHECK(forge::desktop::writePartFile(captured).find("INPUT-FILE") == std::string::npos,
            "...and wrote it into the file");
    }
  }

  // ── 1. the fixtures: a source STEP, and a DECOY that is the starter part ──
  {
    writeSourceStep(source);

    forge::ui::PartDocument seedDoc;
    for (const forge::desktop::SeedStatement& s : forge::desktop::defaultPartStatements()) {
      forge::ui::FeatureRecord rec;
      rec.irId = s.line.id;
      rec.label = s.label;
      rec.line = s.line;
      rec.produces = s.produces;
      seedDoc.appendFeature(rec, {}, s.node);
    }
    forge::desktop::FileExchangeHost seedWriter(seedDoc, nullptr);
    forge::ui::ExchangeReport seedRep;
    CHECK(seedWriter.exportFile(decoy, forge::ui::ExchangeFormat::Step, seedRep),
          "could not write the decoy STEP: " + seedRep.message);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THE FIVE FAILURES THE FIRST VERSION OF THIS FIX PRODUCED.
  //
  // Each block below owns its own App and CLOSES IT before the next begins, so
  // that the application under test is only ever assembled once at a time --
  // and so that the long-lived `app` the rest of this gate uses is created
  // after they are all done with.
  // ─────────────────────────────────────────────────────────────────────────

  // ── 1b. A VERSION-3 FILE STILL OPENS ─────────────────────────────────────
  //
  // This is every .fpart the shipped app ever wrote for an imported part:
  // `OP INPUT` and no path, because version 3 had nowhere to put one. MEASURED
  // on the commit that added the key -- it was REFUSED, with a sentence telling
  // the user to import the file again, which EMPTIES THE DOCUMENT (measured:
  // `%1 = INPUT()` + `%2 = FILLET(%1, 1)` came back as `%1 = INPUT()`). A format
  // that predates a key is not a corrupt file, and a refusal must not prescribe
  // a step that destroys the work it is protecting.
  std::printf("\n-- a version-3 part, which names no source file ---------------------\n");
  {
    const std::string v3 = "FORGE-PART " +
                           std::to_string(forge::desktop::kPartFileDrawingVersion) +
                           "\nNAME imported\nUNITS mm\n"
                           "FEATURE\nID 1\nKIND solid\nCOMMAND part.input_solid\n"
                           "LABEL Imported Solid\nOP INPUT\nNODE body_1\nEND\n";
    CHECK(spill(v3Fpart, v3), "could not write the version-3 fixture");
    App old3;
    const std::size_t logBefore = old3.shell.log().size();
    const forge::ui::DispatchResult opened = old3.run("file.open", v3Fpart);
    const std::string said = old3.shell.lastDocumentError();
    std::printf("  file.open ok=%d said=\"%s\"\n  program: %s", static_cast<int>(opened.ok()),
                said.c_str(), old3.frame.document().irProgram().c_str());
    CHECK(opened.ok() && said.empty(),
          "a version-3 part -- the format the shipped app WROTE -- was refused: \"" + said + "\"");
    CHECK(old3.frame.document().irProgram() == "%1 = INPUT()\n",
          "the version-3 part did not become its own document: " +
              old3.frame.document().irProgram());
    CHECK(old3.scene.inputFile().empty(),
          "a part that records no source file left something bound: " + old3.scene.inputFile());
    // AND IT IS NOT SILENT. The body really is empty -- there is no path to
    // resolve -- so the one thing that must not happen is the original defect:
    // an open that says nothing at all.
    std::string warned;
    for (std::size_t i = logBefore; i < old3.shell.log().entries().size(); ++i) {
      const forge::ui::LogEntry& e = old3.shell.log().entries()[i];
      if (e.source == "document.open" && e.severity >= forge::ui::Severity::Warning) {
        warned = e.message;
      }
    }
    std::printf("  said in the log: \"%s\"\n", warned.c_str());
    CHECK(!warned.empty(),
          "a part whose source file was never recorded opened in SILENCE into an empty body");
    CHECK(forge::ui::isUserReadable(warned), "that warning is not plain words: \"" + warned + "\"");
    // ★ AND IT DOES NOT PRESCRIBE A STEP THAT DESTROYS WORK. Re-importing is
    //   the only way back, and it REPLACES the document; a sentence that
    //   recommends it without saying so is the sentence that was measured.
    CHECK(warned.find("replaces everything") != std::string::npos,
          "the warning recommends importing again without saying that importing replaces "
          "the part: \"" + warned + "\"");
  }

  // ── 1c. THE RECORDED PATH IS NOT REWRITTEN ───────────────────────────────
  //
  // MEASURED: the path went out through the format's free-text writer, which
  // maps every byte below 0x20 to a space. A source in a folder whose name
  // contains a TAB was therefore recorded under a name no file has, and the
  // reopen refused it with "Forge cannot read it any more" -- about a file that
  // had never moved. MUTATION 6 puts that rewrite back.
  std::printf("\n-- a source file whose name contains a TAB --------------------------\n");
  {
    CHECK(writeSourceStep(tabSource), "could not write the tab-named source");
    App tab;
    CHECK(tab.run("file.import_step", tabSource).ok(),
          "the tab-named source was not imported: " + tab.shell.lastExchange().message);
    const forge::desktop::IrBuildReport& b = tab.scene.lastBuild();
    const double v = b.volume;
    const long f = b.faceCount;
    const long e = b.edgeCount;
    CHECK(tab.run("file.save", tabFpart).ok(),
          "the tab-named part did not save: " + tab.shell.lastDocumentError());
    if (mutation == 6) {
      CHECK(rewriteInputFileLine(tabFpart, sanitiseLikeWriteField(tabSource)),
            "mutation 6 found no INPUT-FILE line to sanitise");
    }
    const std::string recorded = inputFileLine(tabFpart);
    std::printf("  recorded: ");
    for (char c : recorded) std::printf("%s", c == '\t' ? "<TAB>" : std::string(1, c).c_str());
    std::printf("<END>\n");
    CHECK(recorded == tabSource,
          "the writer changed the bytes of the path it intends to reopen -- the file has not "
          "moved and the document no longer names it");
    // write(read(x)) == x with a control character in the value, which is the
    // property the free-text writer was protecting and this value cannot pay for.
    forge::desktop::PartFileDoc back;
    std::string why;
    CHECK(forge::desktop::readPartFile(slurp(tabFpart), back, why),
          "the tab-named part does not read back: " + why);
    CHECK(back.inputFile == tabSource, "the reader changed the bytes back: \"" + back.inputFile +
                                           "\" instead of the file that is there");
    const int rc = spawn(argv[0], "--reopen \"" + tabFpart + "\" \"" + tabSource + "\" " +
                                      number(v) + " " + std::to_string(f) + " " +
                                      std::to_string(e));
    CHECK(rc == 0, "a part whose source file has a tab in its name did not reopen (exit " +
                       std::to_string(rc) + ")");
  }

  // ── 1d. THE RECORDED PATH IS ABSOLUTE ────────────────────────────────────
  //
  // MEASURED: an import typed as `rel.step` was recorded as `rel.step`, and the
  // header said the field was "absolute, exactly as the user chose it". The
  // document then opened only from the directory the import happened in. The
  // .fpart here is deliberately saved in ANOTHER folder from its source, so a
  // relative record cannot be rescued by the look beside the document either.
  std::printf("\n-- an import typed as a relative path -------------------------------\n");
  {
    ::mkdir(relDir.c_str(), 0755);
    CHECK(writeSourceStep(relDir + "/rel.step"), "could not write the relative fixture");
    char here[4096] = {0};
    const bool haveCwd = ::getcwd(here, sizeof here) != nullptr;
    CHECK(haveCwd, "could not read the working directory");
    double v = 0.0;
    long f = 0;
    long e = 0;
    if (haveCwd && ::chdir(relDir.c_str()) == 0) {
      App rel;
      CHECK(rel.run("file.import_step", "rel.step").ok(),
            "a relative import was refused: " + rel.shell.lastExchange().message);
      v = rel.scene.lastBuild().volume;
      f = rel.scene.lastBuild().faceCount;
      e = rel.scene.lastBuild().edgeCount;
      CHECK(rel.run("file.save", relFpart).ok(),
            "the relative part did not save: " + rel.shell.lastDocumentError());
      CHECK(::chdir(here) == 0, "could not return to the working directory");
    } else {
      CHECK(false, "could not enter the relative fixture's folder");
    }
    const std::string recorded = inputFileLine(relFpart);
    std::printf("  recorded: \"%s\"\n", recorded.c_str());
    CHECK(!recorded.empty() && recorded[0] == '/',
          "a relative import was recorded relative: \"" + recorded +
              "\" -- that path names the file only while the working directory does not move");
    CHECK(forge::desktop::inputFileState(recorded) == forge::desktop::InputFileState::Usable,
          "what was recorded does not name the source file at all: \"" + recorded + "\"");
    const int rc = spawn(argv[0], "--reopen \"" + relFpart + "\" \"" + recorded + "\" " +
                                      number(v) + " " + std::to_string(f) + " " +
                                      std::to_string(e));
    CHECK(rc == 0, "a part imported through a relative path did not reopen from another "
                   "directory (exit " + std::to_string(rc) + ")");
  }

  // ── 1e. THE JOB FOLDER IS RENAMED ────────────────────────────────────────
  //
  // The .step and the .fpart in one folder, and the folder renamed -- copying a
  // job folder, which is the ordinary case and not a recovery. MEASURED: the
  // open was refused, naming the OLD absolute path, with the source file
  // readable right beside the document that was refusing it. MUTATION 7 deletes
  // that file after the rename, which is the control: the check below passes
  // BECAUSE the file is beside the document.
  std::printf("\n-- the job folder is renamed, source and part together --------------\n");
  {
    ::mkdir(jobDir.c_str(), 0755);
    CHECK(writeSourceStep(jobDir + "/part.step"), "could not write the job fixture");
    double v = 0.0;
    long f = 0;
    long e = 0;
    {
      App job;
      CHECK(job.run("file.import_step", jobDir + "/part.step").ok(),
            "the job fixture was not imported: " + job.shell.lastExchange().message);
      v = job.scene.lastBuild().volume;
      f = job.scene.lastBuild().faceCount;
      e = job.scene.lastBuild().edgeCount;
      CHECK(job.run("file.save", jobDir + "/part.fpart").ok(),
            "the job fixture did not save: " + job.shell.lastDocumentError());
    }
    CHECK(std::rename(jobDir.c_str(), jobMoved.c_str()) == 0, "could not rename the job folder");
    if (mutation == 7) std::remove((jobMoved + "/part.step").c_str());
    const int rc = spawn(argv[0], "--reopen \"" + jobMoved + "/part.fpart\" \"" + jobMoved +
                                      "/part.step\" " + number(v) + " " + std::to_string(f) + " " +
                                      std::to_string(e));
    CHECK(rc == 0, "a part whose folder was renamed did not open from the file sitting beside "
                   "it (exit " + std::to_string(rc) + ")");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AND THE FIVE FAILURES THE *SECOND* VERSION OF THIS FIX PRODUCED.
  //
  // Every one of them was MEASURED on the commit that fixed the first five, and
  // three of them were invisible to this gate as it stood: it had 96 checks, 0
  // failed, and PASSED with the load-bearing bind in documentOpen mutated.
  // ─────────────────────────────────────────────────────────────────────────

  // ── 1f. ★ THE JOB FOLDER IS RENAMED AND OPENED BY ITS BARE NAME ──────────
  //
  // The SAME copied-job-folder case as 1e, entered the way main.cpp actually
  // enters it: a command-line path is dispatched to file.open AS TYPED, so
  // `cd job && forge part.fpart` reaches documentOpen as "part.fpart".
  // folderOf("part.fpart") is "", and the look beside the document was skipped
  // whenever that was so -- MEASURED: ok=1 and REFUSED, the document left as the
  // starter part, with part.step sitting in the working directory, while the
  // same part opened by ABSOLUTE path worked.
  //
  // MUTATION 10 deletes the file beside the document, which is the control: the
  // check below passes BECAUSE it is there. MUTATION 15 replaces it with the
  // DECOY solid, which is the other half -- a bare-name open that finds A file
  // and builds the wrong part must not read as a pass either.
  std::printf("\n-- the job folder is renamed and opened by its BARE NAME ------------\n");
  {
    ::mkdir(bareDir.c_str(), 0755);
    CHECK(writeSourceStep(bareDir + "/part.step"), "could not write the bare-name fixture");
    double v = 0.0;
    long f = 0;
    long e = 0;
    {
      App bare;
      CHECK(bare.run("file.import_step", bareDir + "/part.step").ok(),
            "the bare-name fixture was not imported: " + bare.shell.lastExchange().message);
      v = bare.scene.lastBuild().volume;
      f = bare.scene.lastBuild().faceCount;
      e = bare.scene.lastBuild().edgeCount;
      CHECK(bare.run("file.save", bareDir + "/part.fpart").ok(),
            "the bare-name fixture did not save: " + bare.shell.lastDocumentError());
    }
    CHECK(std::rename(bareDir.c_str(), bareMoved.c_str()) == 0,
          "could not rename the bare-name job folder");
    if (mutation == 10) std::remove((bareMoved + "/part.step").c_str());
    if (mutation == 15) {
      CHECK(spill(bareMoved + "/part.step", slurp(decoy)),
            "mutation 15 could not put the decoy beside the document");
    }
    // "part.fpart" and "./part.step" -- the names as the user would type them,
    // resolved by the application and not by this gate.
    const int rc = spawn(argv[0], "--reopen part.fpart ./part.step " + number(v) + " " +
                                      std::to_string(f) + " " + std::to_string(e) + " --chdir \"" +
                                      bareMoved + "\"");
    CHECK(rc == 0, "a part opened by its BARE NAME from inside its own folder did not find the "
                   "source file sitting in that folder (exit " + std::to_string(rc) + ")");
  }

  // ── 1g. ★ AN OPEN THAT BINDS NOTHING MUST CLEAR WHAT IS BOUND ────────────
  //
  // The line documentOpen calls load-bearing in its own comment -- "Set
  // UNCONDITIONALLY, including to '': a document that binds no input must CLEAR
  // whatever an earlier import left behind". It was guarded by NOTHING: check 6b
  // reaches its open with the binding ALREADY EMPTY (File > New cleared it), so
  // `if (!boundInput.empty()) bindInputFile(boundInput)` left this gate at 96
  // checks, 0 failed, PASSED.
  //
  // The defect it guards is severe and is asserted here in full. MEASURED with
  // the bind made conditional: open a version-4 part bound to X.step, then open a
  // LEGACY version-3 part that names no source at all -- and the legacy part
  // silently BUILT X's solid (compiled=1, volume 31865.840840, the imported
  // part's own numbers). An edit and a Save then wrote `INPUT-FILE <X>` into that
  // legacy file permanently: a document that had never seen X now claims to be
  // built from it, and will refuse to open the day X is deleted.
  //
  // THE FIXTURE'S ONLY REQUIREMENT is that the binding is NOT EMPTY before the
  // open, which is what 6b cannot arrange. MUTATION 11 puts the stale binding
  // back afterwards and rebuilds, which is that defect exactly.
  std::printf("\n-- a live binding, then a part that names no source -----------------\n");
  {
    App stale;
    CHECK(stale.run("file.import_step", source).ok(),
          "the staleness fixture was not imported: " + stale.shell.lastExchange().message);
    const double importedVolume = stale.scene.lastBuild().volume;
    CHECK(stale.run("file.save", staleFpart).ok(),
          "the staleness fixture did not save: " + stale.shell.lastDocumentError());
    // Re-open it, so the binding under test was set by documentOpen and not by
    // the import -- the open path is the one with the hole in it.
    CHECK(stale.run("file.open", staleFpart).ok() && stale.shell.lastDocumentError().empty(),
          "the staleness fixture did not reopen: " + stale.shell.lastDocumentError());
    CHECK(stale.scene.inputFile() == source,
          "the staleness fixture did not come back bound: \"" + stale.scene.inputFile() + "\"");

    // NOW the legacy part, in the same session. It names no source: version 3
    // had nowhere to put one.
    CHECK(spill(staleV3, "FORGE-PART " +
                             std::to_string(forge::desktop::kPartFileDrawingVersion) +
                             "\nNAME legacy\nUNITS mm\n"
                             "FEATURE\nID 1\nKIND solid\nCOMMAND part.input_solid\n"
                             "LABEL Imported Solid\nOP INPUT\nNODE body_1\nEND\n"),
          "could not write the legacy fixture");
    CHECK(stale.run("file.open", staleV3).ok() && stale.shell.lastDocumentError().empty(),
          "the legacy part did not open: " + stale.shell.lastDocumentError());
    if (mutation == 11) {
      stale.scene.setInputFile(source);
      stale.exchange.bindInputFile(source);
      stale.scene.buildFromIr(stale.frame.document().irProgram());
    }
    std::printf("  after opening the legacy part: scene=\"%s\" exchange=\"%s\"\n",
                stale.scene.inputFile().c_str(), stale.exchange.inputFile().c_str());
    std::printf("  it rebuilt: compiled=%d volume=%.6f (the LAST part was %.6f)\n",
                static_cast<int>(stale.scene.lastBuild().compiled), stale.scene.lastBuild().volume,
                importedVolume);
    CHECK(stale.scene.inputFile().empty(),
          "a part that names no source file opened with the PREVIOUS part's source still bound "
          "to the viewport: \"" + stale.scene.inputFile() + "\"");
    CHECK(stale.exchange.inputFile().empty(),
          "...and still bound in the file exchange: \"" + stale.exchange.inputFile() + "\"");
    // THE CONSEQUENCE, not just the mechanism: the legacy part must not be
    // showing the last part's solid. BOTH halves are asserted, because they fail
    // independently -- MEASURED, the binding was cleared correctly and the
    // viewport STILL held X's solid, because syncSceneToDocument's guard is the
    // program TEXT and both documents spell `%1 = INPUT()`, so no rebuild ran at
    // all. A cleared binding nothing rebuilds against is not a cleared binding.
    CHECK(!stale.scene.lastBuild().compiled,
          "a part that names no source file BUILT a solid anyway -- volume " +
              std::to_string(stale.scene.lastBuild().volume) + ", which is the PREVIOUS part's");
    CHECK(stale.scene.lastBuild().error.find("INPUT()") != std::string::npos,
          "and it did not say why: \"" + stale.scene.lastBuild().error + "\"");
    // ★ AND THE APP DOES NOT BELIEVE THE VIEWPORT IS UP TO DATE. builtProgram_ is
    //   "what is the scene showing", and both documents spell the same single
    //   line -- so a builtProgram_ carried over from the LAST document compares
    //   equal to this one's, and the staleness witness says "up to date" over a
    //   viewport showing another part.
    CHECK(stale.frame.documentProgram().empty(),
          "the app thinks the viewport is showing this document, but nothing built for it: \"" +
              stale.frame.documentProgram() + "\"");
    // AND THE FILE ON DISK IS NOT REWRITTEN. An edit and a Save into a document
    // carrying a borrowed binding stamps that path in permanently.
    forge::ui::EntityRef body;
    body.bodyId = stale.frame.activeBodyNode();
    body.kind = forge::ui::EntityKind::Edge;
    body.persistentName = "edge@all";
    body.generation = 1;
    stale.shell.selection().replaceWith({body});
    forge::ui::CommandParams radius;
    radius.setNumber("radius", 1.0);
    stale.shell.run("part.fillet", radius);
    stale.run("file.save", std::string());
    const std::string legacyText = slurp(staleV3);
    CHECK(legacyText.find("INPUT-FILE") == std::string::npos,
          "an edit and a Save wrote an INPUT-FILE into a legacy part that never named one -- it "
          "now claims to be built from a file it has never seen");
  }

  // ── 1g2. ★ AND EMPTYING THE DOCUMENT CLEARS IT TOO ───────────────────────
  //
  // ForgeFrame::documentReset says "The emptied document is bound to nothing",
  // and ForgeShell::runImport re-states the binding IMMEDIATELY after calling it
  // -- so through an import, that clear is invisible. It has a SECOND caller:
  // app.load_sample, which resets and then replays a command sequence and never
  // re-binds. MEASURED as a hole in this commit's sweep: deleting the clear left
  // the gate GREEN, because nothing here had ever emptied a document by the other
  // door.
  std::printf("\n-- an import, then Load Sample Part ---------------------------------\n");
  {
    App sample;
    CHECK(sample.run("file.import_step", source).ok(),
          "the sample fixture was not imported: " + sample.shell.lastExchange().message);
    CHECK(sample.scene.inputFile() == source, "the import did not bind: \"" +
                                                  sample.scene.inputFile() + "\"");
    forge::ui::CommandParams which;
    which.setText("sample", "bracket");
    const forge::ui::DispatchResult loaded = sample.shell.run("app.load_sample", which);
    std::printf("  app.load_sample: %s  bound after: \"%s\"\n",
                forge::ui::machineName(loaded.status), sample.scene.inputFile().c_str());
    CHECK(loaded.ok(), std::string("Load Sample Part was refused: ") +
                           forge::ui::machineName(loaded.status));
    CHECK(sample.scene.inputFile().empty(),
          "emptying the document for a sample part left the last import bound to it: \"" +
              sample.scene.inputFile() + "\"");
    CHECK(sample.exchange.inputFile().empty(),
          "...and bound in the file exchange: \"" + sample.exchange.inputFile() + "\"");
  }

  // ── 7c. ★ PRESENT AND UNREADABLE IS NOT ABSENT ───────────────────────────
  //
  // The enum had four non-usable states and none of them meant "it is there and
  // cannot be read", so a failed ifstream was folded into Missing -- whose
  // sentence is "there is no file at that name now" and whose remedy is "Put that
  // file back where it was". MEASURED with chmod 000: exactly that sentence,
  // about a file that had never moved, prescribing a step that cannot be
  // performed on a file that never left. Reachable on macOS with no exotic setup
  // at all: a TCC-protected ~/Documents, ~/Desktop or ~/Downloads, a file owned by
  // another user, a share that has gone.
  //
  // MUTATION 12 leaves the fixture READABLE, which is the control.
  std::printf("\n-- a source file that is there and cannot be read -------------------\n");
  {
    CHECK(writeSourceStep(lockedSource), "could not write the locked fixture");
    {
      App locked;
      CHECK(locked.run("file.import_step", lockedSource).ok(),
            "the locked fixture was not imported: " + locked.shell.lastExchange().message);
      CHECK(locked.run("file.save", lockedFpart).ok(),
            "the locked fixture did not save: " + locked.shell.lastDocumentError());
    }
    CHECK(::chmod(lockedSource.c_str(), mutation == 12 ? 0644 : 0000) == 0,
          "could not change the mode of the locked fixture");
    // ★ DID THE FIXTURE BITE? root reads anything, and a check that quietly
    //   tests nothing under a CI that runs as root is the failure this whole
    //   round is about. So it is ASSERTED, not assumed: either the file is
    //   really unreadable, or this process is root and says so.
    const bool bites = !std::ifstream(lockedSource, std::ios::binary).good();
    const bool root = ::geteuid() == 0;
    std::printf("  mode 0%o: unreadable=%d  euid=%u\n", mutation == 12 ? 0644 : 0000,
                static_cast<int>(bites), static_cast<unsigned>(::geteuid()));
    CHECK(bites || root,
          "the permission fixture did not make the file unreadable and this process is not "
          "root, so the checks below would be testing nothing");
    if (bites) {
      const forge::desktop::InputFileState st = forge::desktop::inputFileState(lockedSource);
      const std::string problem = forge::desktop::inputFileProblem(st);
      const std::string remedy = forge::desktop::inputFileRemedy(st);
      std::printf("  state -> \"%s\"\n  remedy -> \"%s\"\n", problem.c_str(), remedy.c_str());
      CHECK(st == forge::desktop::InputFileState::Unreadable,
            "a file that is PRESENT and cannot be read was not reported as such: \"" + problem +
                "\"");
      CHECK(problem.find("no file at that name") == std::string::npos,
            "a file that never moved was described as absent: \"" + problem + "\"");
      CHECK(remedy.find("Put that file back") == std::string::npos,
            "the remedy tells the user to put back a file that never left: \"" + remedy + "\"");
      CHECK(forge::ui::isUserReadable(problem) && forge::ui::isUserReadable(remedy),
            "the unreadable sentences are not plain words: \"" + problem + " " + remedy + "\"");
      // AND THROUGH THE SHIPPING PATH, in a fresh process: the refusal the user
      // reads must carry those words and not the absent ones.
      const int rc = spawn(argv[0], "--reopen-refused \"" + lockedFpart + "\" \"" + lockedSource +
                                        "\" \"is there and cannot be read\""
                                        " --forbid \"no file at that name\""
                                        " --forbid \"Put that file back where it was\""
                                        " --expect \"not allowed to read it\""
                                        " --expect \"Give yourself permission\"");
      CHECK(rc == 0, "a part whose source file is present and unreadable was not reported "
                     "properly (exit " + std::to_string(rc) + ")");
    }
    // ★ AND THE FOLDER ABOVE IT. The two failures are different system calls:
    //   a mode-000 FILE stats fine and fails to open, a file inside a mode-000
    //   FOLDER fails to stat at all (EACCES, not ENOENT). Both are "it is there
    //   and cannot be read" and one of them is how a TCC-protected ~/Documents
    //   presents itself. Without this the errno split was unguarded -- MEASURED
    //   in the sweep: collapsing every stat failure to Missing stayed GREEN.
    CHECK(::mkdir(lockedDir.c_str(), 0755) == 0, "could not make the locked folder");
    CHECK(writeSourceStep(lockedDir + "/inside.step"), "could not write inside the locked folder");
    CHECK(::chmod(lockedDir.c_str(), mutation == 12 ? 0755 : 0000) == 0,
          "could not shut the locked folder");
    {
      const bool shut = !std::ifstream(lockedDir + "/inside.step", std::ios::binary).good();
      CHECK(shut || ::geteuid() == 0,
            "a mode-000 FOLDER did not hide the file inside it and this process is not root");
      if (shut) {
        const forge::desktop::InputFileState st =
            forge::desktop::inputFileState(lockedDir + "/inside.step");
        std::printf("  behind a mode-000 folder -> \"%s\"\n",
                    forge::desktop::inputFileProblem(st).c_str());
        CHECK(st == forge::desktop::InputFileState::Unreadable,
              "a file behind a folder this process cannot enter was reported as \"" +
                  forge::desktop::inputFileProblem(st) + "\" -- the name is fine, the folder is "
                  "shut");
      }
    }
    CHECK(::chmod(lockedDir.c_str(), 0755) == 0, "could not reopen the locked folder");
    CHECK(::chmod(lockedSource.c_str(), 0644) == 0, "could not unlock the fixture again");
  }

  // ── 1h. ★ THE SIBLING WARNING SAYS WHAT IS TRUE, AND THE SAVE IT ─────────
  //         PRESCRIBES IS ONE THE APP WILL DO
  //
  // TWO failures in one fixture, because they are two halves of one sentence.
  //
  // (a) The warning fired on `boundInput != file.inputFile` and said "which is
  //     not there now" in every case -- but the loop falls through to the sibling
  //     for NotAModel, Nothing and Truncated too. MEASURED: overwrite the
  //     recorded source with junk, leave a good copy beside the part, and it
  //     opened bound to the sibling saying the junk file "is not there now". It
  //     was there. It was junk.
  // (b) The same sentence ends "Save the part to record where it is now", and
  //     documentOpen set the document CLEAN, while file.save's enabled predicate
  //     is `doc_.dirty` and there is no Save As. MEASURED: file.save answered
  //     `disabled` the instant the part opened, and the .fpart went on naming the
  //     old path until an unrelated edit happened to dirty the document.
  //
  // MUTATION 13 DELETES the recorded source instead of junking it, so "is not
  // there now" becomes the true sentence and (a) must go red. MUTATION 14 leaves
  // a GOOD copy at the recorded path, so the open is answered by the first
  // candidate, no sibling is used, and both halves must go red -- which is what
  // says (b) is specific to a moved source rather than a property of every Open.
  std::printf("\n-- the recorded source is present and junk, a good copy beside it ---\n");
  {
    ::mkdir(junkDir.c_str(), 0755);
    ::mkdir(junkPart.c_str(), 0755);
    CHECK(writeSourceStep(junkDir + "/thing.step"), "could not write the junk fixture's source");
    {
      App j;
      CHECK(j.run("file.import_step", junkDir + "/thing.step").ok(),
            "the junk fixture was not imported: " + j.shell.lastExchange().message);
      CHECK(j.run("file.save", junkPart + "/thing.fpart").ok(),
            "the junk fixture did not save: " + j.shell.lastDocumentError());
    }
    CHECK(spill(junkPart + "/thing.step", slurp(junkDir + "/thing.step")),
          "could not put a good copy beside the part");
    if (mutation == 13) {
      std::remove((junkDir + "/thing.step").c_str());
    } else if (mutation != 14) {
      CHECK(spill(junkDir + "/thing.step", "this is not a step file\n"),
            "could not junk the recorded source");
    }

    App j;
    const std::size_t logBefore = j.shell.log().size();
    const forge::ui::DispatchResult opened = j.run("file.open", junkPart + "/thing.fpart");
    CHECK(opened.ok() && j.shell.lastDocumentError().empty(),
          "the part did not open from the good copy beside it: " + j.shell.lastDocumentError());
    std::string warned;
    for (std::size_t i = logBefore; i < j.shell.log().entries().size(); ++i) {
      const forge::ui::LogEntry& en = j.shell.log().entries()[i];
      if (en.source == "document.open" && en.severity >= forge::ui::Severity::Warning) {
        warned = en.message;
      }
    }
    std::printf("  bound:   \"%s\"\n  warning: \"%s\"\n", j.scene.inputFile().c_str(),
                warned.c_str());
    CHECK(j.scene.inputFile() == junkPart + "/thing.step",
          "the part was not bound to the good copy beside it: \"" + j.scene.inputFile() + "\"");
    CHECK(!warned.empty(), "a part now built from a DIFFERENT file than the one it records "
                           "opened without saying so");
    CHECK(forge::ui::isUserReadable(warned), "that warning is not plain words: \"" + warned + "\"");
    // (a) IT MUST NOT CLAIM THE FILE IS GONE. It is there and it is junk, and
    //     inputFileProblem already has the right words for that.
    CHECK(warned.find("is not there now") == std::string::npos,
          "the warning says the recorded file \"is not there now\" -- it is there, and it is not "
          "a model file: \"" + warned + "\"");
    CHECK(warned.find("not a STEP, BREP or STL file") != std::string::npos,
          "the warning does not say what is actually wrong with the recorded file: \"" + warned +
              "\"");
    // (b) AND THE SAVE IT PRESCRIBES IS AVAILABLE *NOW*.
    CHECK(warned.find("Save the part") != std::string::npos,
          "the warning no longer prescribes a save, so the check below is testing nothing");
    const forge::ui::DispatchResult saved = j.run("file.save", std::string());
    std::printf("  file.save right after the open: %s\n", forge::ui::machineName(saved.status));
    CHECK(saved.ok(), std::string("the warning says \"Save the part to record where it is now\" "
                                  "and file.save answered \"") +
                          forge::ui::machineName(saved.status) + "\" at that very moment");
    const std::string after = inputFileLine(junkPart + "/thing.fpart");
    std::printf("  the .fpart now records: \"%s\"\n", after.c_str());
    CHECK(after == junkPart + "/thing.step",
          "the prescribed save did not record where the source actually is: \"" + after + "\"");
  }

  // ── 1i. ★ THE RECORDED FILE IS THERE *AND* A TWIN SITS BESIDE THE PART ───
  //
  // The hazard the candidate list's own comment names: "guessing at any file of
  // the right type nearby is how a part quietly opens against the wrong solid."
  // The recorded source is present and perfectly good, and a DIFFERENT solid of
  // the SAME NAME sits next to the document. The recorded one wins, and nothing
  // is said, because nothing happened.
  //
  // MEASURED as a hole in this commit's own mutation sweep: dropping the `break`
  // from the candidate loop left this gate GREEN, because no fixture had two
  // usable candidates. The loop then bound the LAST one -- the twin.
  std::printf("\n-- the recorded source is fine and a same-named twin sits beside it --\n");
  {
    // TWO folders, and the SAME LEAF NAME in both -- which is what makes the two
    // candidates different strings. The recorded source (twin_src/twin.step) is
    // the 64x44x12 plate; the file beside the document (twin/twin.step) is the
    // STARTER part, which differs in volume, faces AND edges. If the neighbour
    // were ever chosen, the numbers below could not agree.
    ::mkdir(twinDir.c_str(), 0755);
    ::mkdir(twinSrc.c_str(), 0755);
    CHECK(writeSourceStep(twinSrc + "/twin.step"), "could not write the twin fixture's source");
    double v = 0.0;
    long f = 0;
    long e = 0;
    {
      App t;
      CHECK(t.run("file.import_step", twinSrc + "/twin.step").ok(),
            "the twin fixture was not imported: " + t.shell.lastExchange().message);
      v = t.scene.lastBuild().volume;
      f = t.scene.lastBuild().faceCount;
      e = t.scene.lastBuild().edgeCount;
      CHECK(t.run("file.save", twinDir + "/twin.fpart").ok(),
            "the twin fixture did not save: " + t.shell.lastDocumentError());
    }
    CHECK(spill(twinDir + "/twin.step", slurp(decoy)),
          "could not put the decoy beside the part");

    App t;
    const std::size_t logBefore = t.shell.log().size();
    CHECK(t.run("file.open", twinDir + "/twin.fpart").ok() && t.shell.lastDocumentError().empty(),
          "the twin fixture did not open: " + t.shell.lastDocumentError());
    std::printf("  bound: \"%s\"\n", t.scene.inputFile().c_str());
    CHECK(t.scene.inputFile() == twinSrc + "/twin.step",
          "a part whose recorded source is PRESENT was bound to a same-named file beside it "
          "instead: \"" + t.scene.inputFile() + "\"");
    CHECK(approxRel(t.scene.lastBuild().volume, v, 1e-9, 1e-9) &&
              t.scene.lastBuild().faceCount == f && t.scene.lastBuild().edgeCount == e,
          "...and it built the wrong solid: volume " + std::to_string(t.scene.lastBuild().volume) +
              " faces " + std::to_string(t.scene.lastBuild().faceCount));
    std::string warned;
    for (std::size_t i = logBefore; i < t.shell.log().entries().size(); ++i) {
      const forge::ui::LogEntry& en = t.shell.log().entries()[i];
      if (en.source == "document.open" && en.severity >= forge::ui::Severity::Warning) {
        warned = en.message;
      }
    }
    CHECK(warned.empty(),
          "a part that opened from exactly the file it records warned the user anyway: \"" +
              warned + "\"");
    CHECK(!t.frame.documentDirty(),
          "a part that opened from exactly the file it records opened with unsaved changes");
  }

  // ── 1j. ★ A RELATIVE RECORD RESOLVED BESIDE ITS OWN DOCUMENT IS NOT A MOVE ─
  //
  // A .fpart whose INPUT-FILE is relative -- hand-written, or written by a build
  // before absolutePartPath existed -- names the file in the document's own
  // folder. That is the FIRST place looked, so the source did not move, nothing
  // should be said, and the document should not open with unsaved changes.
  //
  // MEASURED as a hole in the sweep: the warning used to fire on
  // `boundInput != file.inputFile`, which is a test of SPELLING, and a relative
  // record is spelled differently from the absolute path it resolves to. That
  // predicate warns "which is not there now" about a file found exactly where the
  // document said it would be -- and, now that such an open is deliberately
  // dirty, it would also mark an untouched part as changed.
  std::printf("\n-- a .fpart whose INPUT-FILE is relative, beside its own source -----\n");
  {
    ::mkdir(relBeside.c_str(), 0755);
    CHECK(writeSourceStep(relBeside + "/part.step"), "could not write the relative-beside source");
    {
      App r;
      CHECK(r.run("file.import_step", relBeside + "/part.step").ok(),
            "the relative-beside fixture was not imported: " + r.shell.lastExchange().message);
      CHECK(r.run("file.save", relBeside + "/part.fpart").ok(),
            "the relative-beside fixture did not save: " + r.shell.lastDocumentError());
    }
    // By hand, to the RELATIVE form -- which is what this fixture is about.
    CHECK(rewriteInputFileLine(relBeside + "/part.fpart", "part.step"),
          "could not make the record relative");

    App r;
    const std::size_t logBefore = r.shell.log().size();
    CHECK(r.run("file.open", relBeside + "/part.fpart").ok() &&
              r.shell.lastDocumentError().empty(),
          "a part with a relative record did not open beside its own source: " +
              r.shell.lastDocumentError());
    CHECK(r.scene.inputFile() == relBeside + "/part.step",
          "the relative record did not resolve against the document's own folder: \"" +
              r.scene.inputFile() + "\"");
    std::string warned;
    for (std::size_t i = logBefore; i < r.shell.log().entries().size(); ++i) {
      const forge::ui::LogEntry& en = r.shell.log().entries()[i];
      if (en.source == "document.open" && en.severity >= forge::ui::Severity::Warning) {
        warned = en.message;
      }
    }
    std::printf("  said: \"%s\"  dirty=%d\n", warned.c_str(),
                static_cast<int>(r.frame.documentDirty()));
    CHECK(warned.empty(),
          "the source was found in the FIRST place looked and the user was told it had moved: \"" +
              warned + "\"");
    CHECK(!r.frame.documentDirty(),
          "a part whose source was exactly where it said opened with unsaved changes");
  }

  // ── 1k. ★ THE BIND WORKS WITH NO FILE EXCHANGE ATTACHED ──────────────────
  //
  // ForgeFrame::bindInputFile sets the scene AND tells the exchange, and the
  // exchange sets the scene too -- so with an exchange attached, either half
  // alone looks sufficient. MEASURED in the sweep: deleting `scene_.setInputFile`
  // from ForgeFrame::bindInputFile left this gate GREEN. A null exchange is a
  // real configuration (the header says so and a headless host is one), and in it
  // the frame is the only thing that can bind the viewport.
  std::printf("\n-- a frame with no file exchange attached ---------------------------\n");
  {
    HeadlessImGui gui;
    forge::desktop::KernelScene bareScene;
    forge::ui::ForgeShell bareShell;  // setFileExchange is DELIBERATELY not called
    forge::desktop::ForgeFrame bareFrame{bareShell, bareScene};
    bareFrame.wirePartCommands();
    bareFrame.syncSceneToDocument();
    CHECK(bareShell.fileExchange() == nullptr, "this fixture is supposed to have no exchange");
    std::string why;
    CHECK(bareFrame.documentOpen(twinDir + "/twin.fpart", why),
          "a frame with no file exchange could not open a part: " + why);
    std::printf("  bound with no exchange: \"%s\"\n", bareScene.inputFile().c_str());
    CHECK(bareScene.inputFile() == twinSrc + "/twin.step",
          "with no file exchange attached, nothing told the viewport which file the document's "
          "INPUT() means: \"" + bareScene.inputFile() + "\"");
    CHECK(bareScene.lastBuild().compiled,
          "and it did not rebuild: " + bareScene.lastBuild().error);
  }

  // ── 2. import it, through the shipping command path ──────────────────────
  std::printf("\n-- import, then save ------------------------------------------------\n");
  App app;
  const double seedVolume = app.scene.lastBuild().volume;
  const long seedFaces = app.scene.lastBuild().faceCount;

  const forge::ui::DispatchResult imported = app.run("file.import_step", source);
  CHECK(imported.ok(), "the import was refused: " + app.shell.lastExchange().message);
  if (!imported.ok()) {
    std::printf("[import-reopen] cannot continue without an import\n");
    return 1;
  }
  const forge::desktop::IrBuildReport& live = app.scene.lastBuild();
  std::printf("  imported: volume=%.6f faces=%ld edges=%ld  (the starter part is %.6f / %ld)\n",
              live.volume, live.faceCount, live.edgeCount, seedVolume, seedFaces);
  CHECK(live.compiled, "the import did not reach the viewport: " + live.error);
  CHECK(app.frame.document().irProgram() == "%1 = INPUT()\n",
        "the import did not leave the document as one INPUT() statement: " +
            app.frame.document().irProgram());

  // ── THE FIXTURE HAS TO DISCRIMINATE ──────────────────────────────────────
  // A reopen that silently fell back to the part the app opens on would satisfy
  // every check below if the two parts measured the same. They must not.
  CHECK(!approxRel(live.volume, seedVolume, 0.01, 1e-9),
        "the source part and the starter part have the same volume, so this gate "
        "could not tell a reopen from a fallback");
  CHECK(live.faceCount != seedFaces,
        "the source part and the starter part have the same face count");

  const double wantVolume = live.volume;
  const long wantFaces = live.faceCount;
  const long wantEdges = live.edgeCount;

  // ── 3. save, and keep a SECOND COPY for the missing-source half ──────────
  // Copied on disk rather than saved twice: file.save is enabled only while the
  // document is dirty, so a second dispatch is refused as the no-op it is (and
  // refused with an EMPTY message, which is how that first read as a mystery).
  CHECK(app.run("file.save", fpart).ok(), "the part did not save: " + app.shell.lastDocumentError());
  CHECK(spill(missingFpart, slurp(fpart)), "could not copy the saved part");

  // ── 4. the mutations that live in the FILE ───────────────────────────────
  std::string text = slurp(fpart);
  if (mutation == 1) {
    // The shipped defect, exactly: the document records the op and not the file.
    std::string stripped;
    std::istringstream in(text);
    std::string line;
    while (std::getline(in, line)) {
      if (line.rfind("INPUT-FILE ", 0) == 0) continue;
      stripped += line + "\n";
    }
    text = stripped;
    CHECK(spill(fpart, text), "could not rewrite the part file for mutation 1");
  } else if (mutation == 4) {
    const std::size_t at = text.find("INPUT-FILE ");
    if (at != std::string::npos) {
      const std::size_t eol = text.find('\n', at);
      text = text.substr(0, at) + "INPUT-FILE " + decoy + text.substr(eol);
      CHECK(spill(fpart, text), "could not rewrite the part file for mutation 4");
    }
  }

  // ── 5. THE REGRESSION ASSERTION: the file names the file ─────────────────
  std::printf("  the saved .fpart:\n");
  {
    std::istringstream in(text);
    std::string line;
    while (std::getline(in, line)) {
      if (line.rfind("FEATURE", 0) == 0) break;
      std::printf("    %s\n", line.c_str());
    }
  }
  CHECK(text.find("\nINPUT-FILE " + source + "\n") != std::string::npos,
        "the saved part does not record the file it was imported from -- this is the "
        "defect: the format kept the op and threw the path away");

  // ── 6. A FRESH PROCESS OPENS IT ──────────────────────────────────────────
  std::string flags;
  if (mutation == 2) flags = " --drop-scene-rebind";
  if (mutation == 3) flags = " --drop-exchange-rebind";
  const int childRc =
      spawn(argv[0], "--reopen \"" + fpart + "\" \"" + source + "\" " + number(wantVolume) + " " +
                         std::to_string(wantFaces) + " " + std::to_string(wantEdges) + flags);
  CHECK(childRc == 0, "the fresh process could not reproduce the imported part (exit " +
                          std::to_string(childRc) + ")");

  // ── 6b. AND A DOCUMENT THAT NO LONGER HAS AN IMPORT MUST NOT CARRY ONE ───
  //
  // The failure mode this change could have INTRODUCED. KernelScene keeps the
  // last file an Import bound and documentNew does not clear it, so a Save that
  // recorded the scene's field unconditionally would stamp the old STEP into a
  // .fpart with no INPUT() in it -- and the open path treats a recorded path as
  // one the part cannot be built without, so that part would refuse to open the
  // day the STEP was deleted. Measured on the shipping path: import, New, edit,
  // Save.
  {
    const std::string plain = dir + tag + "_plain.fpart";
    std::remove(plain.c_str());
    CHECK(app.run("file.new", std::string()).ok(),
          "file.new was refused: " + app.shell.lastDocumentError());
    // ★ THE MECHANISM, ASSERTED DIRECTLY. A new document came from no file, so
    //   the binding is CLEARED -- that is what stops one part's source following
    //   the next part into its file, and it is a fact with a lifetime rather
    //   than an inference from the program text. MEASURED when it was an
    //   inference: import a part, File > New, state an imported solid, Save, and
    //   the .fpart named the file the FIRST part came from. MUTATION 9 re-binds
    //   it here, which is that defect exactly.
    if (mutation == 9) app.exchange.bindInputFile(source);
    CHECK(app.scene.inputFile().empty(),
          "File > New left the previous import bound to a brand new document: " +
              app.scene.inputFile());
    CHECK(app.exchange.inputFile().empty(),
          "File > New left the previous import bound in the file exchange: " +
              app.exchange.inputFile());
    // A real command, so the document is dirty and file.save is offered.
    forge::ui::EntityRef body;
    body.bodyId = app.frame.activeBodyNode();
    body.kind = forge::ui::EntityKind::Edge;
    body.persistentName = "edge@all";
    body.generation = 1;
    app.shell.selection().replaceWith({body});
    forge::ui::CommandParams radius;
    radius.setNumber("radius", 1.0);
    CHECK(app.shell.run("part.fillet", radius).ok(), "the starter part refused an edit");
    CHECK(app.run("file.save", plain).ok(),
          "the starter part did not save: " + app.shell.lastDocumentError());

    const std::string plainText = slurp(plain);
    CHECK(plainText.find("INPUT-FILE") == std::string::npos,
          "a part with no imported body recorded an input file anyway -- a stale path "
          "from an earlier import would make this document refuse to open once that "
          "file is deleted");
    // AND IT STILL OPENS. The refusal added for a missing source must not fire
    // on a document that binds no source at all.
    CHECK(app.run("file.open", plain).ok() && app.shell.lastDocumentError().empty(),
          "a part with no imported body would not open: " + app.shell.lastDocumentError());
    CHECK(app.scene.lastBuild().compiled && app.scene.lastBuild().volume > 0.0,
          "and it did not rebuild: " + app.scene.lastBuild().error);
    CHECK(app.scene.inputFile().empty(),
          "opening a part with no imported body left the previous import bound: " +
              app.scene.inputFile());
    std::remove(plain.c_str());
  }

  // ── 7. AND WITH A SOURCE FILE IT CANNOT USE ──────────────────────────────
  //
  // FOUR fixtures, and three of them are files that EXIST. The first version of
  // this check asked only whether the name could be opened for reading, so the
  // junk file, the empty file and the folder each reported a successful open and
  // then left the user with `%1 = INPUT()`, volume 0.000000 and faces -1 -- the
  // defect this whole gate exists for, reproduced through the guard meant to
  // prevent it. MUTATION 5 leaves the first one where it is and MUTATION 8
  // leaves the other three intact, which is the control saying these checks can
  // go red.
  const std::string sourceBytes = slurp(source);

  if (mutation != 5) {
    CHECK(std::rename(source.c_str(), moved.c_str()) == 0, "could not move the source file away");
  }
  {
    const int rc = spawn(argv[0], "--reopen-refused \"" + missingFpart + "\" \"" + source +
                                      "\" \"has been moved away\""
                                      " --expect \"there is no file at that name now\""
                                      " --expect \"Put that file back where it was\"");
    CHECK(rc == 0, "a part whose source file is missing was not reported properly (exit " +
                       std::to_string(rc) + ")");
  }
  if (mutation != 5) std::rename(moved.c_str(), source.c_str());

  // (a) PRESENT, and not a model file at all.
  if (mutation != 8) CHECK(spill(source, "this is not a step file\n"), "could not junk the source");
  {
    const int rc = spawn(argv[0], "--reopen-refused \"" + missingFpart + "\" \"" + source +
                                      "\" \"has been overwritten with junk\""
                                      " --expect \"it is not a STEP, BREP or STL file\""
                                      " --expect \"Put a good copy of that file back\""
                                      " --forbid \"no file at that name\"");
    CHECK(rc == 0, "a part whose source file is present and unreadable was not reported "
                   "properly (exit " + std::to_string(rc) + ")");
  }

  // (b) PRESENT, and zero bytes -- the emptiest corruption there is.
  if (mutation != 8) CHECK(spill(source, std::string()), "could not empty the source");
  {
    const int rc = spawn(argv[0], "--reopen-refused \"" + missingFpart + "\" \"" + source +
                                      "\" \"is empty\""
                                      " --expect \"there is nothing in it to read\""
                                      " --expect \"Put a good copy of that file back\""
                                      " --forbid \"no file at that name\"");
    CHECK(rc == 0, "a part whose source file is empty was not reported properly (exit " +
                       std::to_string(rc) + ")");
  }
  // (c) PRESENT, the RIGHT FORMAT, and cut short -- an interrupted download, or a
  //     copy that ran out of disk. The bytes sniff as a STEP, so a check that
  //     only asks "what format is this" passes it, and the completeness check is
  //     the only thing between the user and a reader that (for a BREP) SEGFAULTS
  //     on one. MEASURED as a hole in this commit's own sweep: making
  //     contentIsComplete's verdict Usable left the gate GREEN, because no
  //     fixture here was ever truncated.
  if (mutation != 8) {
    CHECK(spill(source, sourceBytes.substr(0, sourceBytes.size() / 2)),
          "could not truncate the source");
  }
  {
    const int rc = spawn(argv[0], "--reopen-refused \"" + missingFpart + "\" \"" + source +
                                      "\" \"stops part way through\""
                                      " --expect \"it stops part way through\""
                                      " --expect \"Put a good copy of that file back\""
                                      " --forbid \"no file at that name\"");
    CHECK(rc == 0, "a part whose source file is cut short was not reported properly (exit " +
                       std::to_string(rc) + ")");
  }
  CHECK(spill(source, sourceBytes), "could not put the source file back");

  // (d) The recorded path names a FOLDER. fopen succeeds on one.
  CHECK(spill(folderFpart, slurp(missingFpart)), "could not copy the part for the folder case");
  CHECK(rewriteInputFileLine(folderFpart, mutation == 8 ? source : jobMoved),
        "could not point the part at a folder");
  {
    const int rc = spawn(argv[0], "--reopen-refused \"" + folderFpart + "\" \"" +
                                      (mutation == 8 ? source : jobMoved) +
                                      "\" \"is a folder\""
                                      " --expect \"there is nothing in it to read\""
                                      " --expect \"Put a good copy of that file back\""
                                      " --forbid \"no file at that name\"");
    CHECK(rc == 0, "a part whose recorded path names a folder was not reported properly (exit " +
                       std::to_string(rc) + ")");
  }

  ::chmod(lockedSource.c_str(), 0644);
  for (const std::string& p : {source, decoy, moved, fpart, missingFpart, tabSource, tabFpart,
                               relFpart, folderFpart, v3Fpart, relDir + "/rel.step",
                               jobMoved + "/part.step", jobMoved + "/part.fpart",
                               staleFpart, staleV3, lockedSource, lockedFpart,
                               bareMoved + "/part.step", bareMoved + "/part.fpart",
                               junkDir + "/thing.step", junkPart + "/thing.step",
                               junkPart + "/thing.fpart", lockedDir + "/inside.step",
                               twinDir + "/twin.step", twinDir + "/twin.fpart",
                               twinSrc + "/twin.step", newlineSource,
                               relBeside + "/part.step", relBeside + "/part.fpart"}) {
    std::remove(p.c_str());
  }
  for (const std::string& d : {relDir, jobDir, jobMoved, bareDir, bareMoved, junkDir, junkPart,
                               lockedDir, twinDir, twinSrc, relBeside}) {
    ::rmdir(d.c_str());
  }

  std::printf("\n=== %d checks, %d failed ===\n", g_checks, g_failed);
  if (g_failed != 0) {
    std::printf("IMPORT/REOPEN GATE RED\n");
    return 1;
  }
  std::printf("IMPORT/REOPEN GATE PASSED\n");
  return 0;
}
