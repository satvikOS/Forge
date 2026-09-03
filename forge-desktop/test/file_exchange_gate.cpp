// forge-desktop/test/file_exchange_gate.cpp — THE FILE-EXCHANGE GATE.
//
// Proves the whole edge, end to end, through the SHIPPING path:
//
//     a document  ->  file.export_step  ->  BYTES ON DISK
//                 ->  file.import_step  ->  a solid  ->  the document's INPUT()
//                 ->  forge::ft::compile  ->  the same geometry
//
// and it compares a VECTOR OF OBSERVABLES at the seam, never a volume. That is
// not caution, it is measurement: this programme has four recorded cases of a
// wrong solid reproducing a right volume, and one (a native quadric offset) where
// NO SINGLE observable caught the defect -- the centre of mass was clean on the
// sphere and the bounding box was clean on the cylinder.
//
// ── ★ IT CAN FAIL, AND IT IS RUN THAT WAY ───────────────────────────────────
//   ./forge_desktop_file_exchange_gate            the gate
//   ./forge_desktop_file_exchange_gate --mutate N break the write on purpose;
//                                                 the gate MUST then go red
// The five mutations are chosen so that no single observable catches all of them:
//   1 Truncate        the file no longer reads back
//   2 ZeroBody        header intact, body blanked -- the magic bytes still pass
//   3 EmptyFile       nothing on disk
//   4 Translate       volume, area and the face census are BIT-IDENTICAL; only
//                     the bounding box and the centre of mass move
//   5 SameVolumeCube  volume AND centre of mass identical; bounding box, area and
//                     the face census differ
// A gate that checked volume alone would pass 4 and 5. One that checked volume
// and centre of mass would still pass 5.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <ios>
#include <map>
#include <string>
#include <vector>

#include "FileExchangeHost.hpp"
#include "PartFile.hpp"

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/FileExchange.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"

#include "forge/ft/FeatureTree.hpp"

using forge::desktop::FileExchangeHost;
using forge::ui::CommandParams;
using forge::ui::DispatchResult;
using forge::ui::ExchangeFormat;
using forge::ui::ExchangeRefusal;
using forge::ui::ExchangeReport;
using forge::ui::ForgeShell;
using forge::ui::PartDocument;
using forge::ui::UndoStack;

namespace {

int g_checks = 0;
int g_failed = 0;

void report(bool ok, const std::string& what) {
  ++g_checks;
  if (!ok) {
    ++g_failed;
    std::printf("  FAIL #%d  %s\n", g_checks, what.c_str());
  }
}
#define CHECK(cond, what) report((cond), (what))

bool approxRel(double a, double b, double rel, double abs) {
  const double d = std::fabs(a - b);
  if (d <= abs) return true;
  const double scale = std::fabs(a) > std::fabs(b) ? std::fabs(a) : std::fabs(b);
  return scale > 0.0 && d / scale <= rel;
}

std::string join(const std::map<std::string, int>& census) {
  std::string out;
  for (const auto& entry : census) {
    if (!out.empty()) out += " ";
    out += entry.first + ":" + std::to_string(entry.second);
  }
  return out.empty() ? std::string("(none)") : out;
}

long long fileSize(const std::string& path) {
  std::ifstream in(path, std::ios::binary | std::ios::ate);
  if (!in) return -1;
  return static_cast<long long>(in.tellg());
}

std::string head(const std::string& path, std::size_t n) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return std::string();
  std::string b(n, '\0');
  in.read(&b[0], static_cast<std::streamsize>(n));
  b.resize(static_cast<std::size_t>(in.gcount()));
  return b;
}

// ── the DocumentHost the shell needs ────────────────────────────────────────
// export's enabled predicate reads doc_.features, which the shell pulls from a
// host. This is the same shape forge_shell_test's TestDocumentHost has: it owns
// nothing, it reports the real document.
class GateDocumentHost final : public forge::ui::DocumentHost {
 public:
  GateDocumentHost(PartDocument& doc, UndoStack& stack) : doc_(doc), stack_(stack) {}
  bool documentNew(std::string&) override { return true; }
  bool documentReset(std::string&) override {
    doc_.restore(PartDocument::Snapshot{});
    stack_.clear();
    return true;
  }
  bool documentOpen(const std::string&, std::string&) override { return true; }
  bool documentSave(const std::string&, std::string&) override { return true; }
  bool documentUndo() override { return stack_.undo(doc_); }
  bool documentRedo() override { return stack_.redo(doc_); }
  void documentChanged() override { ++changed_; }
  std::size_t documentFeatureCount() const override { return doc_.records().size(); }
  std::size_t documentUndoDepth() const override { return stack_.undoDepth(); }
  std::size_t documentRedoDepth() const override { return stack_.redoDepth(); }
  bool documentDirty() const override { return true; }
  std::string documentPath() const override { return std::string(); }
  std::size_t changed() const noexcept { return changed_; }

 private:
  PartDocument& doc_;
  UndoStack& stack_;
  std::size_t changed_ = 0;
};

void seedBracket(PartDocument& doc) {
  for (const forge::desktop::SeedStatement& st : forge::desktop::defaultPartStatements()) {
    forge::ui::FeatureRecord rec;
    rec.irId = doc.nextIrId();
    rec.label = st.label;
    rec.line = st.line;
    rec.line.id = rec.irId;
    rec.produces = st.produces;
    doc.appendFeature(rec, {}, st.node);
  }
}

// ── PART 1: the prose rule ──────────────────────────────────────────────────
void checkProse() {
  std::printf("\n-- 1. every sentence a user can be shown ---------------------------\n");
  std::size_t sentences = 0;
  for (const ExchangeFormat format : forge::ui::kAllExchangeFormats) {
    for (const ExchangeRefusal refusal : forge::ui::kAllExchangeRefusals) {
      for (const std::string& path : {std::string(), std::string("/Users/a_b/part_v2.step")}) {
        const std::string m = forge::ui::exchangeMessage(refusal, format, path);
        ++sentences;
        CHECK(!m.empty(), std::string("empty message for ") + forge::ui::toString(refusal));
        CHECK(forge::ui::isUserReadable(m),
              std::string("developer prose in refusal '") + forge::ui::toString(refusal) +
                  "' / " + forge::ui::formatName(format) + ": " + m);
      }
    }
    for (const bool imported : {true, false}) {
      const std::string m =
          forge::ui::exchangeSuccessMessage(imported, format, "/tmp/a_b/part_v2.step");
      ++sentences;
      CHECK(forge::ui::isUserReadable(m), "developer prose in a success message: " + m);
    }
  }
  std::printf("  %zu sentences, all plain\n", sentences);

  // ── THE POSITIVE CONTROL ────────────────────────────────────────────────
  // A predicate that has never said no is not a predicate. These are the
  // kernel's OWN strings, copied verbatim from forge-kernel/src/IoExchange.cpp
  // and forge-kernel/src/ft/FeatureTreeCompiler.cpp -- exactly the sentences a
  // user must never see. Every one of them MUST be rejected.
  const char* const leaks[] = {
      "forge.io: IGES export is not available in this build. No IGES writer is "
      "linked (OCCT TKDEIGES is read-only; the native kernel ships an analytic "
      "STEP writer, not an IGES 5.3 writer).",
      "forge.io: STEP read failed for /tmp/x.step",
      "forge.io: JT import requires the proprietary Siemens JT Open Toolkit.",
      "INPUT() used but no input STEP was supplied to the compiler",
      "is docked and laid out by forge::ui::DockLayout, and its position",
      "message from imgui, programmer error",
      "compile threw a non-std exception (an OCCT Standard_Failure)",
      "the document refused the statement: bad_statement_id",
  };
  std::size_t rejected = 0;
  for (const char* leak : leaks) {
    const bool refused = !forge::ui::isUserReadable(leak);
    if (refused) ++rejected;
    CHECK(refused, std::string("the prose rule ACCEPTED developer text: ") + leak);
  }
  std::printf("  %zu/%zu known developer sentences rejected\n", rejected,
              sizeof(leaks) / sizeof(leaks[0]));
}

// ── PART 2: the commands exist, with the right contract ─────────────────────
void checkRegistry(const forge::ui::CommandRegistry& reg) {
  std::printf("\n-- 2. the commands, in the ONE registry ----------------------------\n");
  const char* const ids[] = {"file.import_step", "file.import_brep", "file.export_step",
                             "file.export_brep"};
  for (const char* id : ids) {
    const forge::ui::CommandDescriptor* d = reg.find(id);
    CHECK(d != nullptr, std::string("not registered: ") + id);
    if (d == nullptr) continue;
    CHECK(d->category == "File", std::string(id) + " is not in the File category");
    CHECK(d->featureIrOp.empty(), std::string(id) + " claims a feature-IR op");
    CHECK(d->schema.size() == 1 && d->schema[0].name == "path" &&
              d->schema[0].type == forge::ui::ParamType::Text && d->schema[0].required &&
              !d->schema[0].hasDefault,
          std::string(id) + " does not take exactly one required path with no default");
    CHECK(static_cast<bool>(d->execute), std::string(id) + " has no handler");
    CHECK(static_cast<bool>(d->enabled), std::string(id) + " has no enabled predicate");
  }
  // IGES export must NOT be a command: forge::io::exportIges refuses
  // unconditionally, and a capability that can never succeed is a manifest that
  // lies to the user and to the model trained from it.
  CHECK(reg.find("file.export_iges") == nullptr,
        "file.export_iges is registered, but Forge cannot write IGES");
  // And no Save-as-STL: forge::io::exportStl refuses every OCCT-backed body, and
  // every body forge::ft::compile produces is OCCT-backed. See ui/src/FileExchange.cpp.
  CHECK(reg.find("file.export_stl") == nullptr,
        "file.export_stl is registered, but Forge cannot write STL for a compiled body");
  CHECK(reg.find("file.import_stl") == nullptr,
        "file.import_stl is registered, but an STL body will not build (see section 4b)");
  CHECK(reg.find("file.import_iges") == nullptr,
        "file.import_iges is registered, but nothing here proves IGES read");
  CHECK(!forge::ui::canExport(ExchangeFormat::Stl) && !forge::ui::canExport(ExchangeFormat::Iges),
        "the capability table claims Forge can write STL or IGES");
  CHECK(forge::ui::canImport(ExchangeFormat::Step) && forge::ui::canImport(ExchangeFormat::Brep),
        "the capability table denies an import that IS registered");
  CHECK(!forge::ui::canImport(ExchangeFormat::Stl) && !forge::ui::canImport(ExchangeFormat::Iges),
        "the capability table offers an import that is NOT registered");
  // Every registered command must be BACKED by the table, and every table entry
  // must have a command. A capability claimed in one and absent in the other is
  // exactly the drift the manifest exists to catch.
  for (const ExchangeFormat f : forge::ui::kAllExchangeFormats) {
    const std::string in = std::string("file.import_") + forge::ui::toString(f);
    const std::string out = std::string("file.export_") + forge::ui::toString(f);
    CHECK(forge::ui::canImport(f) == (reg.find(in) != nullptr),
          "the import table and the registry disagree about " + in);
    CHECK(forge::ui::canExport(f) == (reg.find(out) != nullptr),
          "the export table and the registry disagree about " + out);
  }
  std::printf("  4 file-exchange commands; table and registry agree on all %zu formats\n",
              sizeof(forge::ui::kAllExchangeFormats) / sizeof(forge::ui::kAllExchangeFormats[0]));
}

// ── PART 3: the defect this fixes, measured ─────────────────────────────────
void checkInputWasUnreachable(const std::string& stepPath) {
  std::printf("\n-- 3. what INPUT() did before a file could be bound ----------------\n");
  const forge::ft::FeatureTree tree = forge::ft::parse("%1 = INPUT()\n");
  const forge::ft::CompileResult without = forge::ft::compile(tree);
  CHECK(!without.ok, "INPUT() compiled with no input file bound");
  std::printf("  with no file bound: ok=%d  error=\"%s\"\n", without.ok ? 1 : 0,
              without.error.c_str());
  CHECK(!forge::ui::isUserReadable(without.error),
        "the kernel's INPUT() error is already plain -- the premise of the leak stop is wrong");
  const forge::ft::CompileResult with = forge::ft::compile(tree, stepPath);
  CHECK(with.ok, std::string("INPUT() failed WITH a file bound: ") + with.error);
  CHECK(with.volume > 0.0, "INPUT() produced no volume with a file bound");
  std::printf("  with the file bound : ok=%d  volume=%.6f  faces=%ld\n", with.ok ? 1 : 0,
              with.volume, with.faceCount);
}

// ── PART 4: the round trip ──────────────────────────────────────────────────
// Compares SIX observables, and names which one moved.
void compareReports(const char* tag, const ExchangeReport& wrote, const ExchangeReport& read,
                    double rel, double abs) {
  std::printf("  [%s] volume %.6f -> %.6f   faces %ld -> %ld   edges %ld -> %ld\n", tag,
              wrote.volume, read.volume, wrote.faceCount, read.faceCount, wrote.edgeCount,
              read.edgeCount);
  std::printf("        com  (%.4f %.4f %.4f) -> (%.4f %.4f %.4f)\n", wrote.centreOfMass[0],
              wrote.centreOfMass[1], wrote.centreOfMass[2], read.centreOfMass[0],
              read.centreOfMass[1], read.centreOfMass[2]);
  std::printf("        bbox (%.4f %.4f %.4f)-(%.4f %.4f %.4f) -> (%.4f %.4f %.4f)-(%.4f %.4f %.4f)\n",
              wrote.bboxMin[0], wrote.bboxMin[1], wrote.bboxMin[2], wrote.bboxMax[0],
              wrote.bboxMax[1], wrote.bboxMax[2], read.bboxMin[0], read.bboxMin[1],
              read.bboxMin[2], read.bboxMax[0], read.bboxMax[1], read.bboxMax[2]);
  std::printf("        faces by kind  %s  ->  %s\n", join(wrote.faceKinds).c_str(),
              join(read.faceKinds).c_str());

  CHECK(approxRel(wrote.volume, read.volume, rel, abs),
        std::string(tag) + ": VOLUME moved across the round trip");
  CHECK(approxRel(wrote.area, read.area, rel, abs),
        std::string(tag) + ": SURFACE AREA moved across the round trip");
  for (int k = 0; k < 3; ++k) {
    CHECK(approxRel(wrote.centreOfMass[k], read.centreOfMass[k], rel, abs),
          std::string(tag) + ": CENTRE OF MASS moved on axis " + std::to_string(k));
    CHECK(approxRel(wrote.bboxMin[k], read.bboxMin[k], rel, abs),
          std::string(tag) + ": BOUNDING BOX minimum moved on axis " + std::to_string(k));
    CHECK(approxRel(wrote.bboxMax[k], read.bboxMax[k], rel, abs),
          std::string(tag) + ": BOUNDING BOX maximum moved on axis " + std::to_string(k));
  }
  CHECK(wrote.faceKinds == read.faceKinds,
        std::string(tag) + ": the FACE-KIND CENSUS changed: " + join(wrote.faceKinds) + " -> " +
            join(read.faceKinds));
  CHECK(wrote.faceCount == read.faceCount,
        std::string(tag) + ": the FACE COUNT changed");
}

int run(FileExchangeHost::WriteMutation mutation, const std::string& dir) {
  std::printf("=== Forge file-exchange gate ===\n");
  std::printf("  mutation: %d  (0 = none)\n", static_cast<int>(mutation));

  checkProse();

  PartDocument doc;
  UndoStack stack;
  seedBracket(doc);
  ForgeShell shell;
  const std::size_t partAdded = forge::ui::registerPartCommands(shell.registry(), doc, stack);
  CHECK(partAdded > 0, "no Part commands registered");
  GateDocumentHost host(doc, stack);
  shell.setDocumentHost(&host);
  FileExchangeHost exchange(doc, nullptr);
  shell.setFileExchange(&exchange);

  checkRegistry(shell.registry());

  std::printf("\n-- 4. save, then open again ----------------------------------------\n");
  const std::size_t seeded = doc.records().size();
  std::printf("  document: %zu statements\n", seeded);

  struct Leg {
    const char* tag;
    const char* exportId;
    const char* importId;
    const char* extension;
    double rel;
    double abs;
  };
  const Leg legs[] = {
      // STEP is the analytic exchange: an exact round trip is the contract.
      {"step", "file.export_step", "file.import_step", ".step", 1e-6, 1e-9},
      // BREP is the kernel's own format: lossless by construction.
      {"brep", "file.export_brep", "file.import_brep", ".brep", 1e-9, 1e-9},
      // STL IS NOT HERE, and the absence is a measurement rather than an
      // omission. forge::io::exportStl is native-backed-bodies-only and throws
      // "this handle is OCCT-backed and has no native tessellation" for anything
      // forge::ft::compile produces -- and compile forces the native backend OFF
      // for the whole build, so EVERY solid this app can save is OCCT-backed.
      // There is therefore no Save-as-STL command to exercise. STL IMPORT is
      // real and is proven below, from a file this gate writes by hand.
  };

  std::string firstStep;
  for (const Leg& leg : legs) {
    const std::string path = dir + "/bracket_" + leg.tag + leg.extension;
    std::remove(path.c_str());

    // Each leg starts from the SAME part. Import REPLACES the document (it must:
    // see runImport), so without this the second leg would be exporting the first
    // leg's imported body instead of the bracket.
    doc.restore(PartDocument::Snapshot{});
    stack.clear();
    seedBracket(doc);
    CHECK(doc.records().size() == seeded,
          std::string(leg.tag) + ": the document was not re-seeded");

    // ── the INDEPENDENT reference ──────────────────────────────────────────
    // The kernel's own ANALYTIC volume, measured by forge::ft::compile from
    // inside its own backend guard. The exchange integrates its observables over
    // the tessellation instead (forge::massProperties answers differently
    // depending on whether a compile has ever run in this process -- see the
    // comment on FileExchangeHost's measure()). Agreeing to the tessellation
    // deflection is what says the mesh instrument is not quietly wrong.
    const forge::ft::FeatureTree seedTree = forge::ft::parse(doc.irProgram());
    const forge::ft::CompileResult truth = forge::ft::compile(seedTree);
    CHECK(truth.ok, std::string(leg.tag) + ": the seeded bracket did not compile");

    exchange.setWriteMutation(mutation);
    CommandParams out;
    out.setText("path", path);
    const DispatchResult wroteResult = shell.run(leg.exportId, out);
    CHECK(wroteResult.ok(), std::string(leg.tag) + ": export refused: " + wroteResult.detail);
    const ExchangeReport wrote = shell.lastExchange();
    CHECK(forge::ui::isUserReadable(wrote.message),
          std::string(leg.tag) + ": the export message is not plain: " + wrote.message);
    const long long bytes = fileSize(path);
    std::printf("  [%s] wrote %lld bytes  \"%s\"\n", leg.tag, bytes, wrote.message.c_str());
    CHECK(bytes > 0, std::string(leg.tag) + ": nothing was written to disk");
    if (mutation == FileExchangeHost::WriteMutation::None) {
      // Two instruments, one shape. 0.5% is the tessellation deflection's worth
      // on a part with a d12 bore and r3 fillets at linear 0.3 / angular 0.6.
      CHECK(approxRel(truth.volume, wrote.volume, 5e-3, 1e-6),
            std::string(leg.tag) + ": the mesh integral (" + std::to_string(wrote.volume) +
                ") disagrees with the analytic volume (" + std::to_string(truth.volume) + ")");
      CHECK(truth.faceCount == wrote.faceCount,
            std::string(leg.tag) + ": the face count disagrees with the kernel's");
    }
    if (std::strcmp(leg.tag, "step") == 0) {
      CHECK(head(path, 12) == "ISO-10303-21",
            "the STEP file does not start with the ISO-10303-21 header");
      firstStep = path;
    }

    // ── read it back, through the SAME registry a user would ──────────────
    exchange.setWriteMutation(FileExchangeHost::WriteMutation::None);
    const std::size_t before = doc.records().size();
    CommandParams in;
    in.setText("path", path);
    const DispatchResult readResult = shell.run(leg.importId, in);
    CHECK(readResult.ok(), std::string(leg.tag) + ": import refused: " + readResult.detail +
                               " -- " + shell.lastDocumentError());
    const ExchangeReport read = shell.lastExchange();
    if (!readResult.ok()) continue;
    CHECK(forge::ui::isUserReadable(read.message),
          std::string(leg.tag) + ": the import message is not plain: " + read.message);

    // The imported body reached the DOCUMENT: one more statement, and it is the
    // op that binds an input file.
    (void)before;
    CHECK(doc.records().size() == 1,
          std::string(leg.tag) + ": import did not REPLACE the document with one statement (" +
              std::to_string(doc.records().size()) + " statements)");
    const forge::ui::FeatureRecord* last = doc.lastFeature();
    CHECK(last != nullptr && last->line.op == "INPUT",
          std::string(leg.tag) + ": the statement import added is not INPUT()");
    CHECK(exchange.inputFile() == path,
          std::string(leg.tag) + ": the exchange did not bind the file it read");

    compareReports(leg.tag, wrote, read, leg.rel, leg.abs);

    // ── and the DOCUMENT now builds it ────────────────────────────────────
    // The last statement is INPUT(); compiling the document with the bound file
    // must reproduce the same solid. This is the step that proves the file
    // reached the GEOMETRY and not merely a report.
    const forge::ft::FeatureTree tree = forge::ft::parse(doc.irProgram());
    const forge::ft::CompileResult built = forge::ft::compile(tree, exchange.inputFile());
    CHECK(built.ok, std::string(leg.tag) + ": the document did not compile after import: " +
                        built.error);
    // ANALYTIC against MESH, so the tolerance is the tessellation's, not the
    // format's: built.volume is forge::ft::compile's exact integral and
    // read.volume is the exchange's mesh integral. Comparing them at 1e-6 was
    // asserting that a triangulation is exact, which it is not and must not be.
    CHECK(approxRel(built.volume, read.volume, 5e-3, 1e-6),
          std::string(leg.tag) + ": the compiled document (" + std::to_string(built.volume) +
              ") disagrees with the imported body (" + std::to_string(read.volume) + ")");
    std::printf("  [%s] document recompiled: %zu statements, volume %.6f\n", leg.tag,
                doc.records().size(), built.volume);
  }

  // ── WHY STL IS NOT OFFERED: the measurement, kept ─────────────────────────
  // Not an omission and not an opinion. The file is written here as literal ASCII
  // STL -- a 10 mm cube at the origin, twelve triangles -- so the expected volume,
  // centre of mass and bounding box are ARITHMETIC, not Forge's own output.
  // Three facts are asserted, and together they are the whole reason there is no
  // Import STL command. If any of them stops being true, this goes red and the
  // capability should be reconsidered rather than left refused out of habit.
  const std::string stlPath = dir + "/cube.stl";
  {
    std::printf("\n-- 4b. why STL is not offered (measured) ----------------------------\n");
    static const double kCube[12][3][3] = {
        {{0,0,0},{10,10,0},{10,0,0}},   {{0,0,0},{0,10,0},{10,10,0}},     // z = 0
        {{0,0,10},{10,0,10},{10,10,10}},{{0,0,10},{10,10,10},{0,10,10}},  // z = 10
        {{0,0,0},{10,0,0},{10,0,10}},   {{0,0,0},{10,0,10},{0,0,10}},     // y = 0
        {{0,10,0},{0,10,10},{10,10,10}},{{0,10,0},{10,10,10},{10,10,0}},  // y = 10
        {{0,0,0},{0,0,10},{0,10,10}},   {{0,0,0},{0,10,10},{0,10,0}},     // x = 0
        {{10,0,0},{10,10,0},{10,10,10}},{{10,0,0},{10,10,10},{10,0,10}},  // x = 10
    };
    std::ofstream stl(stlPath, std::ios::trunc);
    stl << "solid cube\n";
    for (const auto& tri : kCube) {
      stl << "  facet normal 0 0 0\n    outer loop\n";
      for (const auto& v : tri) {
        stl << "      vertex " << v[0] << " " << v[1] << " " << v[2] << "\n";
      }
      // "endloop" / "endfacet", ONE word each: the native reader tokenises on
      // keywords and answers "STL: unexpected keyword 'end'" to the two-word
      // spelling. Measured, not assumed.
      stl << "    endloop\n  endfacet\n";
    }
    stl << "endsolid cube\n";
    stl.close();
    CHECK(fileSize(stlPath) > 0, "the hand-written STL was not written");

    // FACT 1 — the READ is exact. forge::io::importStl is not the problem.
    ExchangeReport stlRead;
    const bool readOk = exchange.importFile(stlPath, ExchangeFormat::Stl, stlRead);
    CHECK(readOk, std::string("STL read failed: ") + stlRead.message);
    std::printf("  read : volume %.6f (want 1000)  com (%.6f %.6f %.6f) (want 5 5 5)\n",
                stlRead.volume, stlRead.centreOfMass[0], stlRead.centreOfMass[1],
                stlRead.centreOfMass[2]);
    std::printf("         bbox (%.4f %.4f %.4f)-(%.4f %.4f %.4f) (want 0,0,0 - 10,10,10)\n",
                stlRead.bboxMin[0], stlRead.bboxMin[1], stlRead.bboxMin[2], stlRead.bboxMax[0],
                stlRead.bboxMax[1], stlRead.bboxMax[2]);
    CHECK(approxRel(stlRead.volume, 1000.0, 1e-6, 1e-6), "the STL cube's volume is not 1000");
    for (int k = 0; k < 3; ++k) {
      CHECK(approxRel(stlRead.centreOfMass[k], 5.0, 1e-6, 1e-6),
            "the STL cube's centre of mass is not (5,5,5) on axis " + std::to_string(k));
      CHECK(approxRel(stlRead.bboxMin[k], 0.0, 1e-6, 1e-6),
            "the STL cube's bounding box minimum is wrong on axis " + std::to_string(k));
      CHECK(approxRel(stlRead.bboxMax[k], 10.0, 1e-6, 1e-6),
            "the STL cube's bounding box maximum is wrong on axis " + std::to_string(k));
    }

    // FACT 2 — the body has no B-rep face census. A mesh-backed handle has no
    // analytic TopoDS_Shape, so faceCount / faceInventory cannot answer at all.
    std::printf("  body : faceCount=%ld  faceKinds=%s\n", stlRead.faceCount,
                join(stlRead.faceKinds).c_str());
    CHECK(stlRead.faceCount < 0 && stlRead.faceKinds.empty(),
          "an STL body now HAS a face census -- re-examine whether STL can be offered");

    // FACT 3 — and this is the disqualifying one: the document will not build it.
    const forge::ft::FeatureTree t = forge::ft::parse("%1 = INPUT()\n");
    const forge::ft::CompileResult built = forge::ft::compile(t, stlPath);
    std::printf("  build: ok=%d volume=%.4f error=\"%s\"\n", built.ok ? 1 : 0, built.volume,
                built.error.c_str());
    CHECK(!built.ok,
          "an STL document NOW COMPILES -- Import STL should be offered again");
    CHECK(built.volume > 0.0,
          "the STL body carried no volume at all, which is a different failure");
  }

  // ── PART 5: the refusals a user can actually reach ────────────────────────
  std::printf("\n-- 5. refusals, in plain words -------------------------------------\n");
  {
    CommandParams p;
    p.setText("path", stlPath);
    const DispatchResult r = shell.run("file.import_step", p);
    CHECK(!r.ok(), "an STL file was accepted by Import STEP");
    CHECK(shell.lastExchange().refusal == ExchangeRefusal::WrongContents,
          "an STL handed to Import STEP was not refused as the wrong contents");
    std::printf("  STL into Import STEP : \"%s\"\n", shell.lastExchange().message.c_str());
    CHECK(forge::ui::isUserReadable(shell.lastExchange().message), "that refusal is not plain");
  }
  {
    CommandParams p;
    p.setText("path", dir + "/there_is_no_such_file.step");
    const DispatchResult r = shell.run("file.import_step", p);
    CHECK(!r.ok(), "a missing file was accepted");
    CHECK(shell.lastExchange().refusal == ExchangeRefusal::FileMissing,
          "a missing file was not refused as missing");
    std::printf("  missing file         : \"%s\"\n", shell.lastExchange().message.c_str());
    CHECK(forge::ui::isUserReadable(shell.lastExchange().message), "that refusal is not plain");
  }
  {
    // The IGES refusal, where a user can really reach it: an .igs path typed
    // into a Save. It must be plain, AND no file may be left behind claiming to
    // be IGES.
    const std::string igs = dir + "/bracket.igs";
    std::remove(igs.c_str());
    CommandParams p;
    p.setText("path", igs);
    const DispatchResult r = shell.run("file.export_step", p);
    CHECK(!r.ok(), "an .igs path was accepted by Save as STEP");
    CHECK(shell.lastExchange().refusal == ExchangeRefusal::CannotWrite,
          "an .igs path was not refused as an unwritable format");
    CHECK(fileSize(igs) < 0, "a file was written at an .igs path Forge cannot write");
    std::printf("  .igs into Save STEP  : \"%s\"\n", shell.lastExchange().message.c_str());
    CHECK(forge::ui::isUserReadable(shell.lastExchange().message), "that refusal is not plain");
    CHECK(shell.lastExchange().message.find("IGES") != std::string::npos &&
              shell.lastExchange().message.find("STEP") != std::string::npos,
          "the IGES refusal does not name IGES and point at STEP");
  }

  if (!firstStep.empty()) checkInputWasUnreachable(firstStep);

  std::printf("\n=== %d checks, %d failed ===\n", g_checks, g_failed);
  return g_failed == 0 ? 0 : 1;
}

}  // namespace

int main(int argc, char** argv) {
  // LINE-BUFFERED, and it is not cosmetic. A mutation that KILLS the process --
  // and one of them did, on the first run of this battery -- takes a fully
  // buffered stdout with it, so the log is zero bytes and the crash is
  // indistinguishable from a silent pass. Announce before doing, as the kernel
  // worker's op trail already does for the same reason.
  std::setvbuf(stdout, nullptr, _IOLBF, 0);
  int mutate = 0;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) {
      mutate = std::atoi(argv[++i]);
    }
  }
  const char* tmp = std::getenv("TMPDIR");
  std::string dir = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!dir.empty() && dir.back() == '/') dir.pop_back();
  dir += "/forge_file_exchange_gate";
  std::system(("mkdir -p " + dir).c_str());

  int rc = 1;
  try {
    rc = run(static_cast<FileExchangeHost::WriteMutation>(mutate), dir);
  } catch (const std::exception& e) {
    std::printf("THREW: %s\n", e.what());
    rc = 2;
  } catch (...) {
    std::printf("THREW a non-std exception\n");
    rc = 2;
  }
  if (mutate != 0) {
    // Under a mutation the gate is REQUIRED to be red. A mutation that passes is
    // the gate failing to be a gate, and it exits 0 here only when it went red.
    if (rc == 0) {
      std::printf("\n*** MUTATION %d WENT UNDETECTED — THE GATE IS NOT A GATE ***\n", mutate);
      return 1;
    }
    std::printf("\nmutation %d was caught (the gate went red, as required)\n", mutate);
    return 0;
  }
  return rc;
}
