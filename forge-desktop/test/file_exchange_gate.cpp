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
#include "forge/ui/CommandSurface.hpp"
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

// ── MORE THAN ONE PART, AND THAT IS THE POINT ───────────────────────────────
// A round trip proven on ONE part is a result with n = 1. The app's default
// bracket is planes, one cylindrical bore and four b-spline fillets; it says
// nothing about the surfaces where an exchange actually goes wrong. STEP writes
// analytic quadrics, and quadrics are where this programme has repeatedly
// measured a wrong solid surviving a right volume -- so a sphere, a TORUS (the
// hardest of them, and a single periodic face), a cone and a 26-face chamfered
// prism are round-tripped too. Each is a different face-kind census, which is
// the observable a tessellated or re-fitted surface would break first.
struct SeedOp {
  const char* op;
  std::vector<forge::ui::IrArg> args;
  forge::ui::IrValueKind produces;
};

struct Part {
  const char* tag;
  std::vector<SeedOp> ops;  // EMPTY means the app's own default bracket
};

void seedPart(PartDocument& doc, const Part& part) {
  doc.restore(PartDocument::Snapshot{});
  if (part.ops.empty()) {
    seedBracket(doc);
    return;
  }
  for (const SeedOp& op : part.ops) {
    forge::ui::FeatureRecord rec;
    rec.irId = doc.nextIrId();
    rec.commandId.clear();
    rec.label = op.op;
    rec.line = forge::ui::IrLine{rec.irId, op.op, op.args};
    rec.produces = op.produces;
    const bool added =
        doc.appendFeature(rec, {}, std::string("body_") + std::to_string(rec.irId));
    CHECK(added, std::string(part.tag) + ": the document refused " + op.op + " -- " +
                     forge::ui::toString(doc.lastCheck()));
  }
}

// The sphere is NOT in the round-trip list, and section 4c is why: a STEP file
// Forge writes with a SPHERICAL_SURFACE in it does not come back as a sphere.
// It is kept as a named part so that section can drive it.
Part spherePart() {
  using forge::ui::IrArg;
  const forge::ui::IrValueKind solid = forge::ui::IrValueKind::Solid;
  return Part{"sphere",
              {{"SPHERE", {IrArg::num(20.0)}, solid},
               {"CYL",
                {IrArg::num(6.0), IrArg::num(60.0), IrArg::num(0.0), IrArg::num(0.0),
                 IrArg::num(-30.0)},
                solid},
               {"CUT", {IrArg::valueRef(1), IrArg::valueRef(2)}, solid}}};
}

std::vector<Part> parts() {
  using forge::ui::IrArg;
  const forge::ui::IrValueKind solid = forge::ui::IrValueKind::Solid;
  std::vector<Part> out;
  // The part the application itself starts on: planes + one cylinder + four
  // b-spline fillets. Seeded from PartFile.cpp so it cannot drift from the app.
  out.push_back(Part{"bracket", {}});
  // ONE periodic toroidal face, and the surface an exchange is most likely to
  // re-fit into something else.
  out.push_back(Part{"torus", {{"TORUS", {IrArg::num(20.0), IrArg::num(6.0)}, solid}}});
  // A cone fused to a box: a conical face plus planes, and a non-trivial boolean seam.
  out.push_back(Part{"cone",
                     {{"BOX", {IrArg::num(30.0), IrArg::num(30.0), IrArg::num(10.0)}, solid},
                      {"CONE",
                       {IrArg::num(12.0), IrArg::num(4.0), IrArg::num(20.0), IrArg::num(0.0),
                        IrArg::num(0.0), IrArg::num(10.0)},
                       solid},
                      {"FUSE", {IrArg::valueRef(1), IrArg::valueRef(2)}, solid}}});
  // 26 faces and 48 edges: the largest topology here, all planar, so a census
  // that survives it is not surviving by being small.
  out.push_back(Part{"chamfered",
                     {{"BOX", {IrArg::num(40.0), IrArg::num(30.0), IrArg::num(20.0)}, solid},
                      {"CHAMFER", {IrArg::valueRef(1), IrArg::num(3.0)}, solid}}});
  return out;
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

  // ── AND THEY REACH THE FILE MENU ────────────────────────────────────────
  // ForgeFrame::drawMenuBar builds no table: "a group is a registry CATEGORY, an
  // item is a registry COMMAND ... Register a command and it appears here, with
  // no edit to this file." That is the claim; this is the check. The surface is
  // built here from the same forge::ui::buildMenuSurface the frame calls, so a
  // command that is registered and somehow not surfaced is caught in a headless
  // gate rather than by looking at a screenshot.
  //
  // opensDialog() must be TRUE for all four: each needs a `path` the caller has
  // to supply, which is what makes the menu draw them with the trailing "..."
  // every menu since 1984 has used to mean "this one will ask you something".
  // With no file dialog yet that ellipsis IS the whole interaction contract.
  {
    forge::ui::SelectionService selection;
    forge::ui::SurfaceContext sctx;
    sctx.registry = &reg;
    sctx.selection = &selection;
    const forge::ui::CommandSurface menu = forge::ui::buildMenuSurface(sctx);
    for (const char* id : ids) {
      const forge::ui::SurfaceItem* item = menu.find(id);
      CHECK(item != nullptr, std::string("the File menu does not surface ") + id);
      if (item == nullptr) continue;
      CHECK(item->opensDialog(),
            std::string(id) + " is surfaced without the ellipsis that says it will ask for a path");
      CHECK(item->prompts.size() == 1 && item->prompts.front() == "path",
            std::string(id) + " does not prompt for exactly one thing, the path");
    }
    std::printf("  all 4 appear in the menu surface, each marked as opening a dialog\n");
  }
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
      // `abs` is a NANOMETRE, not zero: a centre of mass or a bounding-box face
      // that sits on the origin comes back as +/-1e-9 rather than exactly 0, and
      // a purely RELATIVE tolerance on a quantity whose true value is 0 can never
      // be satisfied. Three checks failed that way on the torus and the cone --
      // the geometry was right and the comparison was wrong.
      {"step", "file.export_step", "file.import_step", ".step", 1e-6, 1e-6},
      // BREP is the kernel's own format: lossless by construction.
      {"brep", "file.export_brep", "file.import_brep", ".brep", 1e-9, 1e-6},
      // STL IS NOT HERE, and the absence is a measurement rather than an
      // omission. forge::io::exportStl is native-backed-bodies-only and throws
      // "this handle is OCCT-backed and has no native tessellation" for anything
      // forge::ft::compile produces -- and compile forces the native backend OFF
      // for the whole build, so EVERY solid this app can save is OCCT-backed.
      // There is therefore no Save-as-STL command to exercise. STL IMPORT is
      // real and is proven below, from a file this gate writes by hand.
  };

  std::string firstStep;
  const std::vector<Part> allParts = parts();
  for (const Part& part : allParts) {
  for (const Leg& leg : legs) {
    const std::string tag = std::string(part.tag) + "/" + leg.tag;
    const std::string path = dir + "/" + part.tag + "_" + leg.tag + leg.extension;
    std::remove(path.c_str());

    // Every (part, leg) starts from the part again. Import REPLACES the document
    // (it must: see runImport), so without this the second leg would be exporting
    // the first leg's imported body instead of the part.
    stack.clear();
    seedPart(doc, part);
    CHECK(!doc.records().empty(), tag + ": the document was not re-seeded");

    // ── the INDEPENDENT reference ──────────────────────────────────────────
    // The kernel's own ANALYTIC volume, measured by forge::ft::compile from
    // inside its own backend guard. The exchange integrates its observables over
    // the tessellation instead (forge::massProperties answers differently
    // depending on whether a compile has ever run in this process -- see the
    // comment on FileExchangeHost's measure()). Agreeing to the tessellation
    // deflection is what says the mesh instrument is not quietly wrong.
    const forge::ft::FeatureTree seedTree = forge::ft::parse(doc.irProgram());
    const forge::ft::CompileResult truth = forge::ft::compile(seedTree);
    CHECK(truth.ok, tag + ": the seeded part did not compile: " + truth.error);
    if (!truth.ok) continue;

    exchange.setWriteMutation(mutation);
    CommandParams out;
    out.setText("path", path);
    const DispatchResult wroteResult = shell.run(leg.exportId, out);
    CHECK(wroteResult.ok(), tag + ": export refused: " + wroteResult.detail);
    const ExchangeReport wrote = shell.lastExchange();
    CHECK(forge::ui::isUserReadable(wrote.message),
          tag + ": the export message is not plain: " + wrote.message);
    const long long bytes = fileSize(path);
    std::printf("  [%s] wrote %lld bytes  \"%s\"\n", tag.c_str(), bytes, wrote.message.c_str());
    CHECK(bytes > 0, tag + ": nothing was written to disk");
    if (mutation == FileExchangeHost::WriteMutation::None) {
      // TWO INSTRUMENTS, ONE SHAPE: forge::ft::compile's analytic integral against
      // the exchange's mesh integral. 1% is the tessellation's own worst error at
      // the deflection FileExchangeHost uses (-0.80% on a torus, measured and
      // recorded there), not a tolerance widened until this passed.
      CHECK(approxRel(truth.volume, wrote.volume, 1e-2, 1e-6),
            tag + ": the mesh integral (" + std::to_string(wrote.volume) +
                ") disagrees with the analytic volume (" + std::to_string(truth.volume) + ")");
      CHECK(truth.faceCount == wrote.faceCount,
            tag + ": the face count disagrees with the kernel's");
    }
    if (std::strcmp(leg.tag, "step") == 0) {
      CHECK(head(path, 12) == "ISO-10303-21",
            tag + ": the STEP file does not start with the ISO-10303-21 header");
      if (firstStep.empty()) firstStep = path;
    }

    // ── read it back, through the SAME registry a user would ──────────────
    exchange.setWriteMutation(FileExchangeHost::WriteMutation::None);
    const std::size_t before = doc.records().size();
    CommandParams in;
    in.setText("path", path);
    const DispatchResult readResult = shell.run(leg.importId, in);
    CHECK(readResult.ok(), tag + ": import refused: " + readResult.detail +
                               " -- " + shell.lastDocumentError());
    const ExchangeReport read = shell.lastExchange();
    if (!readResult.ok()) continue;
    CHECK(forge::ui::isUserReadable(read.message),
          tag + ": the import message is not plain: " + read.message);

    // The imported body reached the DOCUMENT: one more statement, and it is the
    // op that binds an input file.
    (void)before;
    CHECK(doc.records().size() == 1,
          tag + ": import did not REPLACE the document with one statement (" +
              std::to_string(doc.records().size()) + " statements)");
    const forge::ui::FeatureRecord* last = doc.lastFeature();
    CHECK(last != nullptr && last->line.op == "INPUT",
          tag + ": the statement import added is not INPUT()");
    CHECK(exchange.inputFile() == path,
          tag + ": the exchange did not bind the file it read");

    compareReports(tag.c_str(), wrote, read, leg.rel, leg.abs);

    // ── and the DOCUMENT now builds it ────────────────────────────────────
    // The last statement is INPUT(); compiling the document with the bound file
    // must reproduce the same solid. This is the step that proves the file
    // reached the GEOMETRY and not merely a report.
    const forge::ft::FeatureTree tree = forge::ft::parse(doc.irProgram());
    const forge::ft::CompileResult built = forge::ft::compile(tree, exchange.inputFile());
    CHECK(built.ok, tag + ": the document did not compile after import: " +
                        built.error);
    // ANALYTIC against MESH, so the tolerance is the tessellation's, not the
    // format's: built.volume is forge::ft::compile's exact integral and
    // read.volume is the exchange's mesh integral. Comparing them at 1e-6 was
    // asserting that a triangulation is exact, which it is not and must not be.
    CHECK(approxRel(built.volume, read.volume, 1e-2, 1e-6),
          tag + ": the compiled document (" + std::to_string(built.volume) +
              ") disagrees with the imported body (" + std::to_string(read.volume) + ")");
    std::printf("  [%s] document recompiled: %zu statements, volume %.6f\n", tag.c_str(),
                doc.records().size(), built.volume);
  }
  }

  // ── ★ 4c. A STEP FILE FORGE WRITES, AND CANNOT READ BACK ─────────────────
  //
  // MEASURED on this tree, and it is why the sphere is not in the round-trip list
  // above. Forge exports a sphere correctly -- the file carries
  // SPHERICAL_SURFACE, ADVANCED_FACE and a CLOSED_SHELL, and the same body
  // round-trips through BREP with its two analytic faces intact. Re-importing the
  // STEP through the app's own path gives back 900 PLANAR FACETS and a volume
  // 18.6% too large.
  //
  // The cause is named, outside this process, by the reader gate:
  //     forge::io::importStep(sphere.step)                 faces=1800  plane:1800
  //     FORGE_NATIVE_STEP=0 forge::io::importStep(same)     faces=2  cylinder:1 sphere:1
  // The native analytic STEP reader (production default ON) tessellates spherical
  // faces; OCCT's reader does not. That is a kernel defect, reported and NOT fixed
  // here -- this track is the app's file exchange, and the native STEP reader is
  // not its file to rewrite.
  //
  // The three checks below PIN THE CURRENT BEHAVIOUR. If any of them goes red the
  // defect has changed -- most likely it was fixed -- and the sphere should be
  // promoted into parts() rather than left refused out of habit.
  {
    std::printf("\n-- 4c. a STEP file Forge writes and cannot read back (defect) -------\n");
    const Part sphere = spherePart();
    const std::string stepPath = dir + "/sphere_step.step";
    const std::string brepPath = dir + "/sphere_brep.brep";

    ExchangeReport wroteStep;
    ExchangeReport readStep;
    ExchangeReport wroteBrep;
    ExchangeReport readBrep;
    stack.clear();
    seedPart(doc, sphere);
    exchange.setWriteMutation(FileExchangeHost::WriteMutation::None);
    CHECK(exchange.exportFile(stepPath, ExchangeFormat::Step, wroteStep), "sphere: STEP save failed");
    CHECK(exchange.exportFile(brepPath, ExchangeFormat::Brep, wroteBrep), "sphere: BREP save failed");

    // FACT 1 -- the WRITER is not the problem. The file says SPHERICAL_SURFACE.
    std::string all;
    {
      std::ifstream in(stepPath, std::ios::binary);
      all.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    }
    CHECK(all.find("SPHERICAL_SURFACE") != std::string::npos,
          "the exported STEP does not even contain a SPHERICAL_SURFACE -- the defect has moved "
          "into the writer");
    CHECK(all.find("CYLINDRICAL_SURFACE") != std::string::npos,
          "the exported STEP does not contain a CYLINDRICAL_SURFACE");

    // FACT 2 -- BREP round-trips the SAME body exactly, so the shape, the census
    // and this gate's machinery are all fine.
    CHECK(exchange.importFile(brepPath, ExchangeFormat::Brep, readBrep), "sphere: BREP open failed");
    std::printf("  BREP: %s  ->  %s   volume %.4f -> %.4f\n", join(wroteBrep.faceKinds).c_str(),
                join(readBrep.faceKinds).c_str(), wroteBrep.volume, readBrep.volume);
    CHECK(wroteBrep.faceKinds == readBrep.faceKinds,
          "the BREP round trip ALSO loses the sphere -- the defect is wider than STEP");
    CHECK(approxRel(wroteBrep.volume, readBrep.volume, 1e-6, 1e-6),
          "the BREP round trip moved the volume");

    // FACT 3 -- and STEP does not.
    CHECK(exchange.importFile(stepPath, ExchangeFormat::Step, readStep), "sphere: STEP open failed");
    const double err = wroteStep.volume > 0.0
                           ? 100.0 * (readStep.volume - wroteStep.volume) / wroteStep.volume
                           : 0.0;
    std::printf("  STEP: %s  ->  %s   volume %.4f -> %.4f  (%+.2f%%)\n",
                join(wroteStep.faceKinds).c_str(), join(readStep.faceKinds).c_str(),
                wroteStep.volume, readStep.volume, err);
    CHECK(wroteStep.faceKinds != readStep.faceKinds,
          "the STEP round trip now PRESERVES the sphere -- the defect is fixed; move the sphere "
          "into parts() and delete this section");
    CHECK(readStep.faceKinds.count("sphere") == 0,
          "the re-imported STEP now has a spherical face -- the defect is fixed");
    CHECK(std::fabs(err) > 10.0,
          "the STEP round trip's volume error is no longer large -- re-measure this defect");
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
    // Saving into a folder that is not there -- the most ordinary Save error there
    // is once a path is typed by hand rather than picked. forge::io::exportStep
    // throws "forge.io: cannot write <path>"; the user must get a sentence about a
    // folder, and no half-written file may be left behind.
    const std::string nowhere = dir + "/no_such_folder/bracket.step";
    doc.restore(PartDocument::Snapshot{});
    stack.clear();
    seedBracket(doc);
    CommandParams p;
    p.setText("path", nowhere);
    const DispatchResult r = shell.run("file.export_step", p);
    CHECK(!r.ok(), "a save into a missing folder reported success");
    CHECK(shell.lastExchange().refusal == ExchangeRefusal::WriteFailed,
          "a save into a missing folder was not refused as a failed write");
    CHECK(fileSize(nowhere) < 0, "a file appeared inside a folder that does not exist");
    std::printf("  save to no folder   : \"%s\"\n", shell.lastExchange().message.c_str());
    CHECK(forge::ui::isUserReadable(shell.lastExchange().message), "that refusal is not plain");
  }
  {
    // A STEP file that is WELL FORMED AND EMPTY: header, schema, an empty DATA
    // section, and its own END marker, so the magic matches and the completeness
    // check passes. The kernel refuses it ("empty DATA section"); the point of
    // the check is that the refusal arrives as a REFUSAL with a plain sentence,
    // and that the document is not disturbed by it. A real one of these comes
    // out of a CAD system that exported with nothing selected.
    const std::string emptyStep = dir + "/empty.step";
    {
      std::ofstream f(emptyStep, std::ios::trunc);
      f << "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'\'),\'2;1\');\n"
        << "FILE_NAME(\'empty.step\',\'2026-01-01T00:00:00\',(\'\'),(\'\'),\'\',\'\',\'\');\n"
        << "FILE_SCHEMA((\'AUTOMOTIVE_DESIGN\'));\n"
        << "ENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";
    }
    const std::size_t recordsBefore = doc.records().size();
    CommandParams p;
    p.setText("path", emptyStep);
    const DispatchResult r = shell.run("file.import_step", p);
    CHECK(!r.ok(), "an empty STEP file was accepted");
    CHECK(shell.lastExchange().refusal == ExchangeRefusal::NoSolid,
          "an empty STEP file was not refused as holding no solid");
    CHECK(doc.records().size() == recordsBefore,
          "a refused import still changed the document");
    std::printf("  empty STEP file     : \"%s\"\n", shell.lastExchange().message.c_str());
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
  // ── THE EXIT CONVENTION IS NOT INVERTED UNDER --mutate ──────────────────
  // A caught mutation exits NON-ZERO, exactly as an ordinary failure does, and
  // that is deliberate: forge-desktop/test/run_desktop.sh drives every gate here
  // through one `run_gate` helper that reads "mutation N: STAYED GREEN" off an
  // exit code of ZERO. A gate that inverted its own status would report every
  // caught mutation to that runner as an unfalsifiable check. update_gate keeps
  // the same convention for the same reason, and CMake marks the mutation tests
  // WILL_FAIL rather than asking the binary to lie about what happened.
  if (mutate != 0 && rc == 0) {
    std::printf("\n*** MUTATION %d WENT UNDETECTED — THE GATE IS NOT A GATE ***\n", mutate);
  }
  return rc;
}
