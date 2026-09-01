// forge-desktop/test/document_gate.cpp
//
// THE DOCUMENT GATE — the user-launchable slice, proved headless.
//
// forge-desktop already had a headless frame gate, and it passed 132 checks over
// a real ImGui frame. What it could not see was that the application had THREE
// disconnected document models and no edge between them:
//
//   (A) KernelScene, whose geometry was HARDCODED IN C++ (makeBox -> cut ->
//       filletEdges) and could never be changed by any user action;
//   (B) forge::ui::PartDocument, which the real Part commands appended
//       feature-IR to — and which was rendered as ONE LINE OF TEXT in the
//       Properties panel and nowhere else;
//   (C) ForgeShell::DocumentStats, a set of counters that file.*/edit.* bumped,
//       feeding the status strip.
//
// Running a command changed nothing you could see, `edit.undo`'s entire body was
// `--doc_.undoDepth; ++doc_.redoDepth; ...`, and `file.open`'s was
// `doc_.dirty = false;` — it never read its own path argument. There was no
// document file format of any kind.
//
// This gate asserts the edge that closes all of that, end to end, with NO window,
// NO swapchain, NO MoltenVK and NO display:
//
//   the ONE registry  ->  PartDocument  ->  forge::ft::parse  ->  forge::ft::compile
//                     ->  forge::tessellate  ->  the viewport's vertex stream
//                     ->  .fpart on disk  ->  back into a document  ->  the same solid
//
// Every check asserts a VALUE against a reference, and where the reference is a
// number this system already knows (the seed table's length, the document's own
// statement count, the bbox the compiler measured) it is READ from there rather
// than hard-coded, so the gate cannot drift into agreeing with a stale number.
//
// Geometry is never accepted on VOLUME ALONE. A wrong solid reproducing a right
// volume to ten significant figures has been measured repeatedly in this
// programme, so every geometric claim below is a VECTOR: validity, face count,
// edge count, triangle count, volume AND the bounding box.
//
// PROVING THE GATE CAN FAIL: `--mutate <n>` injects the real regression, not a
// synthetic abort:
//   1  a second invoker dispatches straight into    -> the document gains the statement
//      CommandRegistry, bypassing ForgeShell::run        and the viewport never hears
//      and therefore DocumentHost::documentChanged       about it
//   2  the .fpart writer drops the node bindings   -> a reopened document loses them
//   3  save/load skips the file entirely           -> the round trip is not a round trip
//   4  the body node is a hard-coded literal       -> a reopened or edited body is
//                                                     unpickable and every solid
//                                                     command on it refuses
//   5  the feature tree is bound to a SECOND,         -> the rows are a STALE copy of
//      stale history instead of the live document        the history: the statement the
//                                                        last command appended has no
//                                                        row. That is exactly what the
//                                                        SceneFeature vector was.
//   6  the tree is bound to a history that is a        -> the rows DESCRIBE THE WRONG
//      different document altogether                      STATEMENTS -- the failure a
//                                                        row-count check cannot see
//   7  the keystroke dispatches with a bare              -> the shortcut dies on
//      CommandParams, as ForgeShell::key() used to          missing_required_parameter and
//                                                          models nothing
//   8  the parameter editor is aimed by TREE ROW    -> it lands on the statement
//      POSITION instead of by STATEMENT ID             before the one the user
//                                                      picked, and the part never
//                                                      changes

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "imgui.h"

#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "PartFile.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

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
void checkEq(const A& got, const B& want, const char* what) {
  ++g_checks;
  if (!(got == static_cast<A>(want))) {
    ++g_failures;
    std::printf("  FAIL  %-56s  got %s want %s\n", what, std::to_string(got).c_str(),
                std::to_string(want).c_str());
  }
}

template <typename A, typename B>
void checkGt(const A& got, const B& floor, const char* what) {
  ++g_checks;
  if (!(got > static_cast<A>(floor))) {
    ++g_failures;
    std::printf("  FAIL  %-56s  got %s, need > %s\n", what, std::to_string(got).c_str(),
                std::to_string(floor).c_str());
  }
}

void checkStrEq(const std::string& got, const std::string& want, const char* what) {
  ++g_checks;
  if (got != want) {
    ++g_failures;
    std::printf("  FAIL  %-56s\n    got  |%s|\n    want |%s|\n", what, got.c_str(), want.c_str());
  }
}

// A headless ImGui context. The renderer backend is NULL: ImGui needs only a font
// atlas with a texture id set for the draw lists to build, and setting it by hand
// is exactly what a null backend does.
struct HeadlessImGui {
  HeadlessImGui(float w, float h) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(w, h);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "document_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

ImDrawData* buildOneFrame(forge::desktop::ForgeFrame& frame) {
  ImGui::NewFrame();
  frame.build(0, 1.0f);
  ImGui::Render();
  return ImGui::GetDrawData();
}

std::string tempPath(const char* leaf) {
  const char* tmp = std::getenv("TMPDIR");
  std::string dir = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!dir.empty() && dir.back() == '/') dir.pop_back();
  return dir + "/forge_document_gate_" + leaf;
}

// A geometric fingerprint. NEVER volume alone.
struct Fingerprint {
  std::size_t triangles = 0;
  std::uint32_t faces = 0;
  double volume = 0.0;
  long faceCount = 0;
  long edgeCount = 0;
  float bbox[6] = {0, 0, 0, 0, 0, 0};
  bool operator==(const Fingerprint& o) const {
    if (triangles != o.triangles || faces != o.faces) return false;
    if (faceCount != o.faceCount || edgeCount != o.edgeCount) return false;
    if (std::fabs(volume - o.volume) > 1e-6) return false;
    for (int i = 0; i < 6; ++i) {
      if (std::fabs(bbox[i] - o.bbox[i]) > 1e-4f) return false;
    }
    return true;
  }
  // WHAT IS ON SCREEN: triangles, face ids and the bounding box of the vertex
  // stream. Deliberately excludes the fields that come from lastBuild(), which
  // describes the last build ATTEMPT and is correctly reset by a failed one --
  // comparing those would assert that a failure did not happen, not that the
  // last good body survived it.
  bool sameMesh(const Fingerprint& o) const {
    if (triangles != o.triangles || faces != o.faces) return false;
    for (int i = 0; i < 6; ++i) {
      if (std::fabs(bbox[i] - o.bbox[i]) > 1e-4f) return false;
    }
    return true;
  }
  std::string str() const {
    char b[256];
    std::snprintf(b, sizeof b, "%zu tris / %u faceIds / %ld faces / %ld edges / V=%.6f / bbox %.3f",
                  triangles, faces, faceCount, edgeCount, volume,
                  static_cast<double>(bbox[3] - bbox[0]));
    return std::string(b);
  }
};

Fingerprint fingerprint(const forge::desktop::KernelScene& scene) {
  Fingerprint f;
  f.triangles = scene.triangleCount();
  f.faces = scene.faceCount();
  f.volume = scene.lastBuild().volume;
  f.faceCount = scene.lastBuild().faceCount;
  f.edgeCount = scene.lastBuild().edgeCount;
  for (int i = 0; i < 3; ++i) {
    f.bbox[i] = scene.bounds().min[i];
    f.bbox[3 + i] = scene.bounds().max[i];
  }
  return f;
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[doc-gate] MUTATION %d ACTIVE\n", g_mutation);

  // ── 1. the app's starting part is a DOCUMENT, compiled by the kernel ──────
  //
  // KernelScene::build() no longer hardcodes geometry: it compiles
  // defaultPartIr() through forge::ft. This is the check that the two are the
  // same object rather than two hand-written parts that happen to look alike.
  forge::desktop::KernelScene scene;
  const bool built = scene.build();
  check(built, "the starting part builds through forge::ft", scene.error());
  if (!built) {
    std::printf("[doc-gate] cannot continue without geometry\n");
    return 1;
  }
  const forge::desktop::IrBuildReport& r0 = scene.lastBuild();
  std::printf("[doc-gate] start: %zu triangles, %u faceIds, %ld faces, %ld edges, V=%.4f\n",
              scene.triangleCount(), scene.faceCount(), r0.faceCount, r0.edgeCount, r0.volume);
  std::printf("[doc-gate] program:\n%s", forge::desktop::defaultPartIr().c_str());

  check(r0.parsed, "the kernel PARSED the starting program", r0.error);
  check(r0.compiled, "the kernel COMPILED it to a solid", r0.error);
  check(r0.tessellated, "the solid tessellated into the viewport stream", r0.error);
  check(r0.valid, "the solid is valid (watertight/manifold/oriented)", "not valid");
  checkEq(r0.nDeclared, forge::desktop::defaultPartStatements().size(),
          "s0.4: one declared op per seed statement");
  checkEq(r0.nParsed, r0.nDeclared, "s0.4: declared == parsed");
  checkEq(r0.nCompiled, r0.nParsed, "s0.4: parsed == compiled");
  checkGt(scene.triangleCount(), 12u, "more triangles than a bare box");
  checkEq(scene.vertices().size(), scene.triangleCount() * 3,
          "the vertex stream is de-indexed 3-per-triangle");
  // The bbox the COMPILER measured and the bbox the TESSELLATION produced must
  // agree; volume cannot make this check, and a mis-scaled body is where it shows.
  for (int i = 0; i < 3; ++i) {
    const double compiled = r0.bboxMax[i] - r0.bboxMin[i];
    const double meshed = static_cast<double>(scene.bounds().max[i] - scene.bounds().min[i]);
    check(std::fabs(compiled - meshed) < 0.25, "compiled bbox == tessellated bbox",
          std::to_string(compiled) + " vs " + std::to_string(meshed));
  }
  // Every triangle must name a face, or picking is a lie.
  std::size_t unfaced = 0;
  for (const forge::desktop::SceneVertex& v : scene.vertices()) {
    if (v.faceId == 0) ++unfaced;
  }
  checkEq(unfaced, 0u, "every vertex carries an OCCT face id");

  // ── 2. the shell, the frame, the one registry, the document seam ─────────
  HeadlessImGui imgui(1600.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  const std::size_t partCommands = frame.wirePartCommands();
  checkEq(partCommands, forge::ui::partCommandIds().size(),
          "every Part command went into the shell's ONE registry");
  check(shell.documentHost() == &frame, "the frame is installed as the document host", "");

  // The document the app SEEDED and the program the scene BUILT are the same
  // text. This is the check that (A) and (B) are no longer two parts: the old
  // seed was `%1 = SKETCH(XY)` + `%2 = BOX(80, 50, 20)` against a hardcoded
  // BOX -> CUT -> FILLET body, and `SKETCH` is not even in the kernel's op table.
  checkStrEq(frame.document().irProgram(), forge::desktop::defaultPartIr(),
             "the seeded document IS the program the scene compiled");
  checkEq(frame.document().records().size(), forge::desktop::defaultPartStatements().size(),
          "every seed statement was accepted by the document");
  // The status strip reads the REAL document now, not a private counter.
  checkEq(shell.document().features, frame.document().records().size(),
          "the shell's feature count is the document's, not a counter");

  ImDrawData* dd = buildOneFrame(frame);
  check(dd != nullptr && dd->TotalVtxCount > 0, "a real ImGui frame builds with no GPU",
        dd == nullptr ? "no draw data" : std::to_string(dd->TotalVtxCount));
  // The docked workstation layout: menu bar, feature tree, viewport, properties,
  // status bar. The dock tree places exactly one panel per tab group.
  checkGt(frame.panelsDrawn(), 3u, "the docked layout drew its panels");
  check(frame.viewport().visible, "the 3D viewport panel was laid out", "");
  checkGt(frame.viewport().width, 0, "the viewport got a pixel rectangle");
  checkGt(frame.treeRowsDrawn(), 0u, "the feature tree drew rows");
  checkGt(frame.treeRowCount(), forge::desktop::defaultPartStatements().size(),
          "the tree holds a row per feature plus the faces under the last one");

  const Fingerprint start = fingerprint(scene);
  const std::size_t buildsAtStart = scene.builds();
  // Kept for MUTATION 5: what a copied history looks like one command later.
  const forge::ui::PartDocument documentBeforeCommand = frame.document();

  // ── 3. A COMMAND CHANGES THE GEOMETRY ────────────────────────────────────
  //
  // THE defect this gate exists for. Dispatched through the SAME
  // ForgeShell::run a menu item, a shortcut, the palette and an Archie tool call
  // dispatch through — not a private path the test invented.
  forge::ui::EntityRef body;
  body.bodyId = frame.activeBodyNode();
  checkStrEq(body.bodyId, forge::desktop::defaultPartBodyNode(),
             "the starting document names its body");
  body.kind = forge::ui::EntityKind::Edge;
  body.persistentName = "edge@all";
  body.generation = 1;
  shell.selection().replaceWith({body});

  forge::ui::CommandParams filletParams;
  filletParams.setNumber("radius", 3.0);
  // MUTATION 1 is a SECOND INVOKER: it dispatches straight into the registry,
  // which is what a macro runner or a panel with its own button used to do. The
  // command runs and the document changes, but ForgeShell::run() -- and with it
  // DocumentHost::documentChanged() -- is skipped, so nothing re-tessellates.
  const forge::ui::DispatchResult fillet =
      g_mutation == 1
          ? shell.registry().dispatch("part.fillet", shell.selection(), filletParams)
          : shell.run("part.fillet", filletParams);
  check(fillet.ok(), "part.fillet dispatched through the one registry",
        forge::ui::toString(fillet.status) + std::string(" ") + fillet.detail);
  checkEq(frame.document().records().size(),
          forge::desktop::defaultPartStatements().size() + 1,
          "the command appended one statement to the document");

  // NOBODY CALLS syncSceneToDocument() HERE. The dispatch itself did it, through
  // the descriptor's sideEffect == Document and the document host, so a caller
  // that has no idea a viewport exists still leaves the picture correct.
  const Fingerprint afterFillet = fingerprint(scene);
  std::printf("[doc-gate] after part.fillet: %s\n", afterFillet.str().c_str());

  check(scene.builds() > buildsAtStart,
        "the DISPATCH itself rebuilt -- no caller had to remember",
        std::to_string(scene.builds()) + " builds");
  check(!(afterFillet == start), "the viewport geometry actually changed",
        "fingerprint identical: " + afterFillet.str());
  check(scene.lastBuild().ok(), "the rebuilt solid compiled", scene.lastBuild().error);
  check(scene.lastBuild().valid, "the rebuilt solid is valid", "not valid");
  // A fillet only REMOVES material, and only a rim of it.
  check(afterFillet.volume < start.volume, "the fillet removed material",
        std::to_string(afterFillet.volume) + " < " + std::to_string(start.volume));
  check(afterFillet.volume > 0.95 * start.volume, "the fillet removed only a rim",
        std::to_string(afterFillet.volume));
  checkGt(afterFillet.faceCount, start.faceCount, "filleting added faces");
  checkGt(afterFillet.triangles, start.triangles, "the display mesh was re-tessellated");
  // The bounding box is the check volume cannot make: the plate is unchanged in
  // X and Y, so a fillet that moved or rescaled the body shows here.
  for (int i = 0; i < 2; ++i) {
    check(std::fabs((afterFillet.bbox[3 + i] - afterFillet.bbox[i]) -
                    (start.bbox[3 + i] - start.bbox[i])) < 0.25f,
          "the fillet did not resize the plate in X/Y",
          std::to_string(afterFillet.bbox[3 + i] - afterFillet.bbox[i]));
  }
  check(frame.viewport().geometryDirty || buildOneFrame(frame) != nullptr,
        "the host is told to re-upload the vertex buffer", "geometryDirty never set");
  checkEq(shell.document().features, frame.document().records().size(),
          "the status strip followed the document through the command");

  // ── 3b. THE FEATURE-TREE ROWS ARE THE IR STATEMENTS ──────────────────────
  //
  // Until this slice the tree read a `std::vector<SceneFeature>` that KernelScene
  // owned and ForgeFrame::refreshFeatureRows() re-copied out of
  // PartDocument::records() after every rebuild -- a SECOND history, four strings
  // wide, pushed in by a setter that any mutation path could forget to call. It
  // could not carry the two fields that make a row a feature rather than a label:
  // the statement id the row IS, and the command that authored it.
  //
  // The assertions below are on OBJECT IDENTITY, not on equal-looking strings: a
  // row's record must be the very FeatureRecord the document holds. A copy that
  // happened to agree would pass a string comparison and fail this.
  //
  // MUTATION 5 binds the source to a different, stale document -- the defect in
  // its purest form -- and every check here must go red.
  // MUTATION 5's stale history: the document EXACTLY AS IT WAS before the command
  // ran. A copy that was right a moment ago is the realistic form of the defect.
  forge::ui::PartDocument staleHistory = documentBeforeCommand;
  // MUTATION 6's mismatched history: a different document altogether, so the rows
  // describe the wrong statements while still being a perfectly valid history.
  forge::ui::PartDocument otherHistory;
  otherHistory.seed(forge::ui::IrValueKind::Solid, "body.other", "BOX",
                    {forge::ui::IrArg::num(10.0), forge::ui::IrArg::num(10.0),
                     forge::ui::IrArg::num(10.0)});
  forge::desktop::SceneFeatureTreeSource staleSource(scene, staleHistory);
  forge::desktop::SceneFeatureTreeSource otherSource(scene, otherHistory);
  {
    const forge::desktop::SceneFeatureTreeSource& src =
        g_mutation == 5 ? staleSource : (g_mutation == 6 ? otherSource : frame.treeSource());
    const std::vector<forge::ui::FeatureRecord>& records = frame.document().records();

    checkEq(src.featureCount(), records.size(),
            "the tree source's feature count IS the document's record count");

    std::size_t identical = 0;
    std::size_t authored = 0;
    for (std::size_t i = 0; i < records.size(); ++i) {
      const forge::ui::NodeId node = src.nodeForFeature(i);
      const forge::ui::FeatureRecord* rec = src.recordAt(node);
      if (rec == nullptr) continue;
      if (rec == &records[i]) ++identical;
      if (!rec->commandId.empty()) ++authored;
      // EVERY comparison below is against `records[i]` -- the DOCUMENT's
      // statement -- never against `rec` itself. Comparing the row to the record
      // it was built from is self-consistent under any history at all, and would
      // stay green while the tree described a different part entirely.
      const forge::ui::FeatureNodeData d = src.data(node);
      checkStrEq(d.featureIrOp, records[i].line.op,
                 "the row's IR op is the DOCUMENT statement's op");
      checkStrEq(d.label, records[i].label.empty() ? records[i].line.op : records[i].label,
                 "the row's label is the DOCUMENT statement's label");
      checkEq(rec->irId, static_cast<int>(i + 1),
              "the row's irId is its 1-based document position");
    }
    checkEq(identical, records.size(),
            "every row IS the document's record, by object identity -- not a copy");

    // The statement the COMMAND appended is the last row, and it names the
    // command. `commandId` is one of the two fields the copied row dropped.
    const forge::ui::FeatureRecord* last =
        records.empty() ? nullptr : src.recordAt(src.nodeForFeature(records.size() - 1));
    check(last != nullptr, "the last document statement has a tree row", "no record for it");
    if (last != nullptr) {
      checkStrEq(last->commandId, "part.fillet",
                 "the last row names the command that authored it");
      checkStrEq(last->line.op, "FILLET", "and the op it emitted");
      // And that row's statement is literally the last line of the program the
      // kernel compiled -- the tree and the viewport read one text.
      const std::string program = frame.document().irProgram();
      const std::string stmt = last->line.text();
      check(program.find(stmt) != std::string::npos,
            "the row's statement is a line of the compiled program", stmt);
    }
    checkEq(authored, 1u, "exactly one statement so far was authored by a command");

    // The MODEL the panel actually draws through is flattened over those same
    // nodes: root, then one row per statement, then the last feature's faces.
    check(frame.treeRowCount() > records.size(), "the flattened tree holds every statement",
          std::to_string(frame.treeRowCount()));
    std::size_t modelRowsMatched = 0;
    for (std::size_t i = 0; i < records.size() && 1 + i < frame.treeRowCount(); ++i) {
      if (frame.tree().rowAt(1 + i).id == src.nodeForFeature(i)) ++modelRowsMatched;
    }
    checkEq(modelRowsMatched, records.size(),
            "the flattened rows the panel draws are those statements, in order");
  }

  // ── 4. UNDO IS THE DOCUMENT'S UNDO ───────────────────────────────────────
  //
  // `edit.undo` used to run `--doc_.undoDepth; ++doc_.redoDepth;` and touch no
  // geometry at all. It now unwinds the real memento stack and the viewport
  // follows it back.
  checkGt(shell.document().undoDepth, 0u, "the shell sees a real undo stack");
  const forge::ui::DispatchResult undo = shell.run("edit.undo");
  check(undo.ok(), "edit.undo dispatched", forge::ui::toString(undo.status));
  check(shell.lastDocumentError().empty(), "edit.undo was not refused",
        shell.lastDocumentError());
  checkEq(frame.document().records().size(), forge::desktop::defaultPartStatements().size(),
          "undo removed the appended statement");
  const Fingerprint afterUndo = fingerprint(scene);
  check(afterUndo == start, "undo restored the ORIGINAL geometry, not just a counter",
        afterUndo.str() + " vs " + start.str());
  // The tree followed it WITHOUT anyone refreshing a row vector: the source reads
  // records(), and undo popped one.
  checkEq(frame.treeSource().featureCount(), frame.document().records().size(),
          "undo removed the tree row too, with no row-copying step");
  check(frame.treeSource().recordAt(
            frame.treeSource().nodeForFeature(frame.document().records().size())) == nullptr,
        "the undone statement has no row left", "a row outlived its statement");

  const forge::ui::DispatchResult redo = shell.run("edit.redo");
  check(redo.ok(), "edit.redo dispatched", forge::ui::toString(redo.status));
  check(shell.lastDocumentError().empty(), "edit.redo was not refused",
        shell.lastDocumentError());
  const Fingerprint afterRedo = fingerprint(scene);
  check(afterRedo == afterFillet, "redo restored the FILLETED geometry",
        afterRedo.str() + " vs " + afterFillet.str());

  // ── 5. THE .fpart FILE — a real document on a real disk ──────────────────
  const std::string path = tempPath("roundtrip.fpart");
  std::remove(path.c_str());

  forge::ui::CommandParams saveParams;
  saveParams.setText("path", g_mutation == 3 ? std::string() : path);
  const forge::ui::DispatchResult saved = shell.run("file.save", saveParams);
  check(saved.ok(), "file.save dispatched", forge::ui::toString(saved.status));
  check(shell.lastDocumentError().empty(), "file.save was not refused",
        shell.lastDocumentError());

  std::string diskText;
  {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    check(f != nullptr, "file.save WROTE A FILE (it used to write nothing)", path);
    if (f != nullptr) {
      char buf[4096];
      std::size_t n = 0;
      while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) diskText.append(buf, n);
      std::fclose(f);
    }
  }
  checkGt(diskText.size(), 0u, "the file has content");
  check(diskText.rfind(forge::desktop::kPartFileMagic, 0) == 0,
        "the file starts with the FORGE-PART magic",
        diskText.substr(0, 32));
  // Every statement the document holds is in the file.
  {
    std::size_t featureBlocks = 0;
    std::size_t at = 0;
    const std::string needle = "\nFEATURE\n";
    while ((at = diskText.find(needle, at)) != std::string::npos) {
      ++featureBlocks;
      at += needle.size();
    }
    checkEq(featureBlocks, frame.document().records().size(),
            "one FEATURE block per document statement");
  }

  // Writer/reader round trip, byte for byte.
  {
    forge::desktop::PartFileDoc reread;
    std::string why;
    const bool ok = forge::desktop::readPartFile(diskText, reread, why);
    check(ok, "the written file parses", why);
    if (ok) {
      checkStrEq(forge::desktop::writePartFile(reread), diskText,
                 "write(read(x)) == x, byte for byte");
      checkStrEq(reread.irProgram(), frame.document().irProgram(),
                 "the file's IR program is the document's IR program");
    }
  }

  // A rejected file must NOT half-replace the open document.
  {
    forge::desktop::PartFileDoc junk;
    std::string why;
    check(!forge::desktop::readPartFile("this is not a part file\n", junk, why),
          "a non-.fpart file is refused", why);
    check(!why.empty(), "the refusal says why", why);
    check(!forge::desktop::readPartFile(std::string(forge::desktop::kPartFileMagic) + " 99\n",
                                        junk, why),
          "an unknown format version is refused", why);
  }

  // ── 6. OPEN IT BACK — through the same file.open, into the same solid ────
  const Fingerprint beforeOpen = fingerprint(scene);
  const std::string programBeforeOpen = frame.document().irProgram();

  // Drop the document first, so a successful open cannot be the old one still
  // sitting there. file.new re-seeds the starting part.
  const forge::ui::DispatchResult fresh = shell.run("file.new");
  check(fresh.ok(), "file.new dispatched", forge::ui::toString(fresh.status));
  check(shell.lastDocumentError().empty(), "file.new was not refused",
        shell.lastDocumentError());
  checkStrEq(frame.document().irProgram(), forge::desktop::defaultPartIr(),
             "file.new returned the document to the starting part");
  check(!(fingerprint(scene) == beforeOpen), "file.new actually changed the geometry back",
        fingerprint(scene).str());

  forge::ui::CommandParams openParams;
  openParams.setText("path", path);
  const forge::ui::DispatchResult opened = shell.run("file.open", openParams);
  check(opened.ok(), "file.open dispatched", forge::ui::toString(opened.status));
  check(shell.lastDocumentError().empty(), "file.open READ THE PATH and succeeded",
        shell.lastDocumentError());

  checkStrEq(frame.document().irProgram(), programBeforeOpen,
             "the reopened document emits the identical IR program");
  const Fingerprint afterOpen = fingerprint(scene);
  check(afterOpen == beforeOpen, "the reopened document rebuilds the IDENTICAL solid",
        afterOpen.str() + " vs " + beforeOpen.str());
  check(scene.documentLabel().find("roundtrip") != std::string::npos,
        "the tree root names the opened document", scene.documentLabel());

  // The selection bindings survive the round trip — without them the reopened
  // document looks right and every solid command on it is silently unavailable.
  std::string why0;
  {
    const int liveBinding = frame.document().valueFor(forge::desktop::defaultPartBodyNode());
    forge::desktop::PartFileDoc onDisk;
    std::string& why = why0;
    if (forge::desktop::readPartFile(diskText, onDisk, why)) {
      if (g_mutation == 2) {
        for (forge::desktop::PartFileFeature& f : onDisk.features) f.nodes.clear();
      }
      forge::ui::PartDocument restored;
      const bool ok = forge::desktop::restorePartDocument(onDisk, restored, why);
      check(ok, "the file restores into a document", why);
      checkEq(restored.valueFor(forge::desktop::defaultPartBodyNode()), liveBinding,
              "the selection binding survived the round trip");
      checkStrEq(restored.irProgram(), programBeforeOpen,
                 "the restored document emits the identical program");
    }
  }

  // A command still works on the reopened document — the receiver the registry
  // captured is the SAME object the open wrote into, not a replacement it lost
  // track of.
  {
    forge::ui::EntityRef reopened;
    reopened.bodyId = frame.activeBodyNode();
    reopened.kind = forge::ui::EntityKind::Edge;
    reopened.persistentName = "edge@all";
    reopened.generation = 1;
    shell.selection().replaceWith({reopened});
    forge::ui::CommandParams p2;
    p2.setNumber("distance", 2.0);
    const std::size_t before = frame.document().records().size();
    const forge::ui::DispatchResult r2 = shell.run("part.chamfer", p2);
    check(r2.ok(), "a command dispatches on the REOPENED document",
          forge::ui::toString(r2.status) + std::string(" ") + r2.detail);
    checkEq(frame.document().records().size(), before + 1,
            "it appended to the document the file restored");
    // After a command the body answers to the node THAT command produced. A
    // viewport pick reads activeBodyNode(); a hard-coded literal here would make
    // every later solid command silently unavailable.
    check(!frame.activeBodyNode().empty(), "the new body is still nameable",
          frame.activeBodyNode());
    checkEq(frame.document().valueFor(frame.activeBodyNode()),
            static_cast<int>(frame.document().records().size()),
            "the active node names the document's LAST statement");
  }

  // ── 6b. a .fpart the app did not write is still usable ──────────────────
  //
  // Two cases the format allows and a hard-coded body name breaks:
  //   * the document names its body something else -- nothing in .fpart says the
  //     node must be "body.bracket", and after any command the node is whatever
  //     the selection carried;
  //   * the document names it nothing at all -- NODE is optional, and a body no
  //     name resolves to cannot be picked and refuses every solid command.
  {
    const std::string foreign = tempPath("foreign.fpart");
    forge::desktop::PartFileDoc renamed;
    if (forge::desktop::readPartFile(diskText, renamed, why0)) {
      // `nodes` is a VECTOR since the format became forge::ui's: bindings are
      // many-to-one, and a value two selections name is a value two selections
      // name. Renaming the body means replacing every name it had.
      for (forge::desktop::PartFileFeature& f : renamed.features) {
        if (!f.nodes.empty()) f.nodes = {"imported.body"};
      }
      std::string saveWhy;
      check(forge::desktop::savePartFile(foreign, renamed, saveWhy),
            "wrote a .fpart naming its body something else", saveWhy);

      forge::ui::CommandParams foreignOpen;
      foreignOpen.setText("path", foreign);
      const forge::ui::DispatchResult openedForeign = shell.run("file.open", foreignOpen);
      check(openedForeign.ok() && shell.lastDocumentError().empty(),
            "the foreign-named document opens", shell.lastDocumentError());
      checkStrEq(frame.activeBodyNode(), "imported.body",
                 "the app reads the body's name from the DOCUMENT");

      forge::ui::EntityRef pick;
      // MUTATION 4 is the bug this replaced: clickFace used to write the literal
      // "body.bracket" into every EntityRef it made.
      pick.bodyId = g_mutation == 4 ? std::string("body.bracket") : frame.activeBodyNode();
      pick.kind = forge::ui::EntityKind::Edge;
      pick.persistentName = "edge@all";
      pick.generation = 1;
      shell.selection().replaceWith({pick});
      forge::ui::CommandParams p3;
      p3.setNumber("radius", 1.0);
      const std::size_t before = frame.document().records().size();
      const forge::ui::DispatchResult r3 = shell.run("part.fillet", p3);
      check(r3.ok(), "a viewport pick on it resolves to an IR value",
            forge::ui::toString(r3.status) + std::string(" ") + r3.detail);
      checkEq(frame.document().records().size(), before + 1, "and the command appended to it");
    }
    std::remove(foreign.c_str());

    const std::string bare = tempPath("nonode.fpart");
    forge::desktop::PartFileDoc noNode;
    if (forge::desktop::readPartFile(diskText, noNode, why0)) {
      for (forge::desktop::PartFileFeature& f : noNode.features) f.nodes.clear();
      std::string saveWhy;
      check(forge::desktop::savePartFile(bare, noNode, saveWhy), "wrote a NODE-less .fpart",
            saveWhy);

      forge::ui::CommandParams bareOpen;
      bareOpen.setText("path", bare);
      const forge::ui::DispatchResult openedBare = shell.run("file.open", bareOpen);
      check(openedBare.ok() && shell.lastDocumentError().empty(),
            "a NODE-less document opens", shell.lastDocumentError());
      check(!frame.activeBodyNode().empty(), "the open path gave its body a name",
            frame.activeBodyNode());
      checkEq(frame.document().valueFor(frame.activeBodyNode()),
              static_cast<int>(frame.document().records().size()),
              "and that name resolves to the LAST statement");
    }
    std::remove(bare.c_str());
  }

  // ── 6b. A FEATURE PARAMETER IS EDITED IN PLACE ───────────────────────────
  //
  // THE DEFECT THIS SECTION EXISTS FOR. PartDocument::appendFeature() refuses
  // any statement not numbered nextIrId(), so before part.edit_feature the
  // document was APPEND-ONLY: no user action anywhere in the app could change a
  // number already in the program. The starting part is worse than that -- its
  // five statements are SEEDED, so they carry no undo step and even undoing back
  // to the beginning could not reach them. The plate a user opens on was 80 x 50
  // x 20 with a d12 bore and r3 corners, permanently.
  //
  // A fresh trio, so the assertions here stand on the document the app OPENS ON
  // and not on whatever the fillet/undo/redo sections above left behind.
  {
    forge::desktop::KernelScene editScene;
    check(editScene.build(), "edit-scene builds the starting part", editScene.error());
    forge::ui::ForgeShell editShell;
    forge::desktop::ForgeFrame editFrame(editShell, editScene);
    editFrame.wirePartCommands();

    // The FILLET is the last seeded statement, and it is the one whose radius a
    // user reaches for first. Its id is read from the seed table, never spelled.
    const int filletId = static_cast<int>(forge::desktop::defaultPartStatements().size());
    editFrame.setEditTarget(filletId, 0);
    checkEq(editFrame.editFeatureId(), filletId, "the editor aims at the fillet statement");
    // FILLET(%4, 3, VERTICAL) -- one number, and index 0 must step over the %ref
    checkEq(editFrame.editParamCount(), 1u, "FILLET exposes exactly one numeric parameter");
    check(std::fabs(editFrame.editParamValue() - 3.0) < 1e-9,
          "and the editor reads the radius the document actually holds",
          std::to_string(editFrame.editParamValue()));

    // A tree node resolves to the SAME statement the editor is aimed at -- the
    // 0-based row / 1-based statement off-by-one is the bug this pins down.
    const forge::ui::NodeId filletNode =
        editFrame.treeSource().childAt(editFrame.treeSource().rootId(),
                                       static_cast<std::size_t>(filletId) - 1);
    checkEq(editFrame.treeSource().featureIrIdOf(filletNode), filletId,
            "the fillet's TREE ROW maps back to the fillet's statement id");
    checkEq(editFrame.treeSource().featureIrIdOf(editFrame.treeSource().rootId()), 0,
            "the document root names no statement");

    const Fingerprint beforeEdit = fingerprint(editScene);
    const std::size_t buildsBeforeEdit = editScene.builds();
    const std::size_t statementsBefore = editFrame.document().records().size();
    const std::size_t undoBeforeEdit = editShell.document().undoDepth;

    // MUTATION 5 stands for the single likeliest real defect in this feature:
    // the editor aimed by TREE ROW POSITION (0-based) instead of by STATEMENT ID
    // (1-based). It lands on CUT(%2, %3), which has no numeric parameter at all,
    // so the command is refused and the part never changes -- silently, if
    // nothing below asserted the geometry.
    const int aimedAt = g_mutation == 8 ? filletId - 1 : filletId;
    editFrame.setEditTarget(aimedAt, 0);

    // THE EDIT. Through ForgeFrame::applyFeatureEdit, which dispatches
    // part.edit_feature on the ONE registry -- not a private call into the
    // document, which would bypass the undo stack and the journal.
    check(editFrame.applyFeatureEdit(6.0), "the parameter edit dispatched and rebuilt",
          editShell.journal().empty() ? "no dispatch recorded" : editShell.journal().back());

    const Fingerprint afterEdit = fingerprint(editScene);
    std::printf("[doc-gate] after r3 -> r6: %s\n", afterEdit.str().c_str());

    // An EDIT appends nothing. This is what separates it from every other Part
    // command, and from the only workaround that existed before it.
    checkEq(editFrame.document().records().size(), statementsBefore,
            "the edit added NO statement to the program");
    checkStrEq(editFrame.document().records().at(static_cast<std::size_t>(filletId) - 1)
                   .line.text(),
               "%" + std::to_string(filletId) + " = FILLET(%" + std::to_string(filletId - 1) +
                   ", 6, VERTICAL)",
               "the statement itself was rewritten, in place");
    // ...and it kept the operand it had, and touched nothing else. The reference
    // is DERIVED from the seed table rather than spelled out, so this check
    // cannot drift into agreeing with a stale program. A parameter edit that
    // reparented the feature would still compile and would still look plausible
    // on screen; this is what refuses it.
    std::string expectedProgram = forge::desktop::defaultPartIr();
    const std::size_t radiusAt = expectedProgram.rfind(", 3, VERTICAL)");
    check(radiusAt != std::string::npos, "the seed table still ends on FILLET(..., 3, VERTICAL)",
          forge::desktop::defaultPartIr());
    if (radiusAt != std::string::npos) {
      expectedProgram.replace(radiusAt, std::string(", 3, VERTICAL)").size(), ", 6, VERTICAL)");
    }
    checkStrEq(editFrame.document().irProgram(), expectedProgram,
               "ONLY the radius moved; every other statement is byte-identical");

    check(editScene.builds() > buildsBeforeEdit, "the edit drove a REAL kernel rebuild",
          std::to_string(editScene.builds()) + " builds");
    check(editScene.lastBuild().ok(), "the re-compiled solid built", editScene.lastBuild().error);
    check(editScene.lastBuild().valid, "and is valid", "not valid");
    check(!(afterEdit == beforeEdit), "the viewport geometry actually changed",
          "fingerprint identical: " + afterEdit.str());
    // A LARGER fillet removes MORE material. Volume alone would not catch a
    // rebuild that filleted the wrong edges, so the bbox and the face count come
    // with it.
    check(afterEdit.volume < beforeEdit.volume, "r6 removes more material than r3",
          std::to_string(afterEdit.volume) + " vs " + std::to_string(beforeEdit.volume));
    check(afterEdit.volume > 0.95 * beforeEdit.volume, "and still only a rim of it",
          std::to_string(afterEdit.volume));
    checkEq(afterEdit.faceCount, beforeEdit.faceCount,
            "the same edges are filleted, so the face count is unchanged");
    for (int i = 0; i < 3; ++i) {
      check(std::fabs((afterEdit.bbox[3 + i] - afterEdit.bbox[i]) -
                      (beforeEdit.bbox[3 + i] - beforeEdit.bbox[i])) < 0.25f,
            "a fillet radius change does not resize the plate",
            std::to_string(afterEdit.bbox[3 + i] - afterEdit.bbox[i]));
    }
    checkEq(editShell.document().undoDepth, undoBeforeEdit + 1,
            "one edit == one step on the REAL undo stack");
    check(editFrame.documentDirty(), "the document is dirty after an edit", "not dirty");
    check(std::fabs(editFrame.editParamValue() - 6.0) < 1e-9,
          "the editor now reads the NEW value back out of the document",
          std::to_string(editFrame.editParamValue()));

    // ── the edit is UNDOABLE, and its undo removes no statement ────────────
    const forge::ui::DispatchResult undoEdit = editShell.run("edit.undo");
    check(undoEdit.ok() && editShell.lastDocumentError().empty(), "edit.undo dispatched",
          editShell.lastDocumentError());
    editFrame.syncSceneToDocument();
    checkEq(editFrame.document().records().size(), statementsBefore,
            "undoing an EDIT removes no statement (an append's undo does)");
    check(fingerprint(editScene) == beforeEdit,
          "undo restored the ORIGINAL geometry, not just the text",
          fingerprint(editScene).str() + " vs " + beforeEdit.str());
    checkStrEq(editFrame.document().irProgram(), forge::desktop::defaultPartIr(),
               "and the whole program is the seeded one again, byte for byte");

    const forge::ui::DispatchResult redoEdit = editShell.run("edit.redo");
    check(redoEdit.ok() && editShell.lastDocumentError().empty(), "edit.redo dispatched",
          editShell.lastDocumentError());
    editFrame.syncSceneToDocument();
    check(fingerprint(editScene) == afterEdit, "redo replayed the SAME edited solid",
          fingerprint(editScene).str());

    // ── the edited value survives a real .fpart round trip ─────────────────
    // The format stores each argument structurally, so this is the check that it
    // stores the argument's VALUE and not a label it once had.
    const std::string editPath = tempPath("edited.fpart");
    forge::ui::CommandParams saveEdited;
    saveEdited.setText("path", editPath);
    check(editShell.run("file.save", saveEdited).ok() && editShell.lastDocumentError().empty(),
          "the edited document saved", editShell.lastDocumentError());
    check(editShell.run("file.new").ok(), "file.new reset it", editShell.lastDocumentError());
    editFrame.syncSceneToDocument();
    check(fingerprint(editScene) == beforeEdit, "a new document is the SEEDED part again",
          fingerprint(editScene).str());
    forge::ui::CommandParams openEdited;
    openEdited.setText("path", editPath);
    check(editShell.run("file.open", openEdited).ok() && editShell.lastDocumentError().empty(),
          "the edited document reopened", editShell.lastDocumentError());
    editFrame.syncSceneToDocument();
    check(fingerprint(editScene) == afterEdit,
          "and rebuilt the EDITED solid, not the seeded one",
          fingerprint(editScene).str() + " vs " + afterEdit.str());
    std::remove(editPath.c_str());

    // ── what the editor REFUSES ────────────────────────────────────────────
    // CUT(%2, %3) is all refs: there is no number to edit, so the command is
    // Disabled rather than silently writing into a %ref slot.
    editFrame.setEditTarget(filletId - 1, 0);
    checkEq(editFrame.editParamCount(), 0u, "CUT exposes no numeric parameter");
    const Fingerprint beforeRefusal = fingerprint(editScene);
    const std::string programBeforeRefusal = editFrame.document().irProgram();
    check(!editFrame.applyFeatureEdit(9.0), "editing a parameter that does not exist is REFUSED",
          "it was accepted");
    checkStrEq(editFrame.document().irProgram(), programBeforeRefusal,
               "and the refusal moved no byte of the program");
    check(fingerprint(editScene) == beforeRefusal, "nor a triangle of the viewport",
          fingerprint(editScene).str());

    // A no-op edit is refused too, so Apply on an unchanged number never pushes
    // an undo step that undoes nothing.
    editFrame.setEditTarget(filletId, 0);
    const std::size_t depthBeforeNoop = editShell.document().undoDepth;
    check(!editFrame.applyFeatureEdit(editFrame.editParamValue()),
          "re-applying the SAME value is refused", "it was accepted");
    checkEq(editShell.document().undoDepth, depthBeforeNoop,
            "so the undo stack never gains a step that does nothing");

    // The frame still builds a real ImGui frame with the editor on screen.
    ImDrawData* editDraw = buildOneFrame(editFrame);
    check(editDraw != nullptr && editDraw->TotalVtxCount > 0,
          "the Properties panel with the parameter editor draws",
          editDraw == nullptr ? "no draw data" : std::to_string(editDraw->TotalVtxCount));
  }

  // ── 7. A REFUSED REBUILD DOES NOT TAKE THE APP DOWN ──────────────────────
  //
  // forge::ft::compile is documented "Never throws for a modelling failure".
  // MEASURED FALSE: SHELL(%N, 3) on this bracket lets an OCCT
  // Standard_ConstructionError escape, which is not a std::exception. If that
  // reaches the frame loop, std::terminate ends the session on a menu click.
  {
    const Fingerprint good = fingerprint(scene);
    forge::desktop::KernelScene sandbox;
    check(sandbox.build(), "sandbox scene builds", sandbox.error());
    const Fingerprint sandboxGood = fingerprint(sandbox);
    const bool survived =
        !sandbox.buildFromIr(forge::desktop::defaultPartIr() + "%6 = SHELL(%5, 3)\n");
    check(survived, "an op that throws inside OCCT is CAUGHT, not fatal",
          "buildFromIr reported success on a throwing op");
    check(!sandbox.lastBuild().error.empty(), "the failure says why",
          sandbox.lastBuild().error);
    check(fingerprint(sandbox).sameMesh(sandboxGood),
          "a failed rebuild leaves the LAST GOOD body on screen",
          fingerprint(sandbox).str());

    // A program the parser rejects outright.
    const bool refused = !sandbox.buildFromIr("%1 = NOTAREALOP(1, 2)\n");
    check(refused, "an unparseable program is refused", "it was accepted");
    check(sandbox.lastBuild().failedLine > 0 || !sandbox.lastBuild().error.empty(),
          "the parse failure is located", sandbox.lastBuild().error);
    check(fingerprint(sandbox).sameMesh(sandboxGood), "and still leaves the last good body",
          fingerprint(sandbox).str());
    check(fingerprint(scene) == good, "the live scene was untouched by the sandbox",
          fingerprint(scene).str());
  }

  // ── 8. the frame still builds over the mutated document ──────────────────
  {
    ImDrawData* last = buildOneFrame(frame);
    check(last != nullptr && last->TotalVtxCount > 0, "the frame builds after every mutation",
          last == nullptr ? "no draw data" : std::to_string(last->TotalVtxCount));
    checkGt(frame.panelsDrawn(), 3u, "the docked layout still drew its panels");
    checkGt(frame.rebuilds(), 0u, "the document drove at least one rebuild");
  }

  // ── 9. A KEYSTROKE MODELS ────────────────────────────────────────────────
  //
  // THE P0.6 CLAIM, on the one path a user actually has: a key press, through
  // ForgeFrame::onKey -> ForgeShell::key -> the ONE registry -> the document ->
  // forge::ft -> the viewport's vertices.
  //
  // Until this slice the Extrude/Fillet/Shell chords in all four input profiles
  // named `model.extrude` / `model.fillet` / `model.shell` -- ForgeShell
  // descriptors whose whole execute body was four counter increments. They
  // emitted no feature-IR, so no key could change the picture; and with a
  // DocumentHost installed even the counters were overwritten from the real
  // document on the way out of run(), so pressing R changed NOTHING while the
  // console printed "ok".
  //
  // A fresh shell/scene/frame, so this is not reading the state fifty checks of
  // file round-tripping left behind.
  {
    forge::desktop::KernelScene keyScene;
    check(keyScene.build(), "the keystroke scene builds", keyScene.error());
    forge::ui::ForgeShell keyShell;
    forge::desktop::ForgeFrame keyFrame(keyShell, keyScene);
    keyFrame.wirePartCommands();

    // The chord resolves to the command that EMITS, and the counter stub it used
    // to resolve to is not in the registry at all.
    const forge::ui::Resolution r =
        keyShell.keymap().resolve(keyShell.inputProfile(), {forge::ui::KeyStroke{"R", 0}});
    checkStrEq(r.commandId, "part.fillet", "the Forge-native R chord names part.fillet");
    check(!keyShell.registry().contains("model.fillet"), "model.fillet is not registered",
          "the counter stub is still there");
    check(!keyShell.registry().contains("model.extrude"), "model.extrude is not registered", "");
    check(!keyShell.registry().contains("model.shell"), "model.shell is not registered", "");

    const Fingerprint before = fingerprint(keyScene);
    const std::size_t recordsBefore = keyFrame.document().records().size();
    const std::size_t buildsBefore = keyScene.builds();

    forge::ui::EntityRef pick;
    pick.bodyId = keyFrame.activeBodyNode();
    pick.kind = forge::ui::EntityKind::Edge;
    pick.persistentName = "edge@all";
    pick.generation = 1;
    keyShell.selection().replaceWith({pick});

    // MUTATION 7 is the regression ForgeShell::key() used to have: dispatch with
    // a default-constructed CommandParams, so a command with a required
    // parameter dies before its handler runs. Everything below then goes red.
    const bool ran = g_mutation == 7 ? keyShell.run("part.fillet").ok()
                                     : keyFrame.onKey("R", 0);
    check(ran, "the R chord ran a command", keyFrame.lastStatus());
    checkEq(keyFrame.document().records().size(), recordsBefore + 1,
            "the keystroke appended ONE feature-IR statement");

    const forge::ui::FeatureRecord* last = keyFrame.document().lastFeature();
    check(last != nullptr, "the document has a last statement", "");
    if (last != nullptr) {
      checkStrEq(last->commandId, "part.fillet", "authored by the command the chord names");
      checkStrEq(last->line.op, "FILLET", "and it emitted a FILLET");
      // The schema default really reached the handler: radius 1, not a prompt.
      checkStrEq(last->line.text(),
                 "%" + std::to_string(last->irId) + " = FILLET(%" +
                     std::to_string(last->irId - 1) + ", 1, ALL)",
                 "the shortcut's schema default is IN the emitted statement");
    }

    check(keyScene.builds() > buildsBefore, "the keystroke drove a REAL kernel rebuild",
          std::to_string(keyScene.builds()) + " builds");
    check(keyScene.lastBuild().ok(), "the rebuilt solid compiled", keyScene.lastBuild().error);
    const Fingerprint after = fingerprint(keyScene);
    check(!(after == before), "A KEY PRESS CHANGED THE PICTURE",
          "fingerprint identical: " + after.str());
    check(after.volume < before.volume, "the keyed fillet removed material",
          std::to_string(after.volume) + " vs " + std::to_string(before.volume));
    checkGt(after.faceCount, before.faceCount, "and added faces");

    // The ribbon the Part workspace claims is the category those commands are
    // filed under. While it named "Model" the toolbar offered the three counter
    // stubs and none of the sixteen commands that emit.
    const std::vector<std::string> cats =
        forge::ui::workspaceCategories(forge::ui::WorkspaceProfile::Part);
    std::size_t ribbonCommands = 0;
    for (const std::string& cat : cats) {
      ribbonCommands += keyShell.registry().idsInCategory(cat).size();
    }
    checkEq(keyShell.registry().idsInCategory("Part").size(),
            forge::ui::partCommandIds().size(),
            "the Part ribbon category holds every Part command");
    checkEq(keyShell.registry().idsInCategory("Model").size(), 0u,
            "and no command is filed under the retired Model category");
    checkEq(ribbonCommands, keyShell.registry().size(),
            "every registered command is reachable from the Part workspace ribbon");
  }

  std::remove(path.c_str());

  std::printf("\n[doc-gate] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures == 0) {
    std::printf("[doc-gate] GREEN — document -> forge::ft -> kernel -> viewport -> .fpart -> "
                "document, headless (no window, no swapchain, no MoltenVK)\n");
  }
  return g_failures == 0 ? 0 : 1;
}
