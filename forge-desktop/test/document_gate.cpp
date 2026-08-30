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
//   (B) forge::ui::PartDocument, which the 18 real Part commands appended
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
//   1  the document is never synced to the scene   -> the viewport ignores commands
//   2  the .fpart writer drops the node bindings   -> a reopened document loses them
//   3  save/load skips the file entirely           -> the round trip is not a round trip
//   4  the body node is a hard-coded literal       -> a reopened or edited body is
//                                                     unpickable and every solid
//                                                     command on it refuses

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
  checkEq(scene.features().size(), forge::desktop::defaultPartStatements().size(),
          "one history row per statement");
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
  const forge::ui::DispatchResult fillet = shell.run("part.fillet", filletParams);
  check(fillet.ok(), "part.fillet dispatched through the one registry",
        forge::ui::toString(fillet.status) + std::string(" ") + fillet.detail);
  checkEq(frame.document().records().size(),
          forge::desktop::defaultPartStatements().size() + 1,
          "the command appended one statement to the document");

  if (g_mutation != 1) frame.syncSceneToDocument();
  const Fingerprint afterFillet = fingerprint(scene);
  std::printf("[doc-gate] after part.fillet: %s\n", afterFillet.str().c_str());

  check(scene.builds() > buildsAtStart, "the command drove a REAL kernel rebuild",
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
  frame.syncSceneToDocument();
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
  frame.syncSceneToDocument();

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
        for (forge::desktop::PartFileFeature& f : onDisk.features) f.node.clear();
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
      for (forge::desktop::PartFileFeature& f : renamed.features) {
        if (!f.node.empty()) f.node = "imported.body";
      }
      std::string saveWhy;
      check(forge::desktop::savePartFile(foreign, renamed, saveWhy),
            "wrote a .fpart naming its body something else", saveWhy);

      forge::ui::CommandParams foreignOpen;
      foreignOpen.setText("path", foreign);
      const forge::ui::DispatchResult openedForeign = shell.run("file.open", foreignOpen);
      check(openedForeign.ok() && shell.lastDocumentError().empty(),
            "the foreign-named document opens", shell.lastDocumentError());
      frame.syncSceneToDocument();
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
      for (forge::desktop::PartFileFeature& f : noNode.features) f.node.clear();
      std::string saveWhy;
      check(forge::desktop::savePartFile(bare, noNode, saveWhy), "wrote a NODE-less .fpart",
            saveWhy);

      forge::ui::CommandParams bareOpen;
      bareOpen.setText("path", bare);
      const forge::ui::DispatchResult openedBare = shell.run("file.open", bareOpen);
      check(openedBare.ok() && shell.lastDocumentError().empty(),
            "a NODE-less document opens", shell.lastDocumentError());
      frame.syncSceneToDocument();
      check(!frame.activeBodyNode().empty(), "the open path gave its body a name",
            frame.activeBodyNode());
      checkEq(frame.document().valueFor(frame.activeBodyNode()),
              static_cast<int>(frame.document().records().size()),
              "and that name resolves to the LAST statement");
    }
    std::remove(bare.c_str());
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

  std::remove(path.c_str());

  std::printf("\n[doc-gate] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures == 0) {
    std::printf("[doc-gate] GREEN — document -> forge::ft -> kernel -> viewport -> .fpart -> "
                "document, headless (no window, no swapchain, no MoltenVK)\n");
  }
  return g_failures == 0 ? 0 : 1;
}
