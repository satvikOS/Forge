// ui/test/exchange_model_test.cpp — the import/export model gate.
//
// Every check asserts a VALUE against a reference (SR-3). The three that matter
// most, because they are the three rules a future change is most likely to break
// without noticing:
//
//   * THE CENSUS IS SELF-CONSISTENT. A direction that is unavailable must name a
//     reason and no backing; an available one must name a backing and give no
//     excuse. A row that claims IGES export works while carrying the sentence
//     saying it does not is exactly the kind of stale capability claim this
//     programme has shipped before.
//   * SNIFFING IS BY BYTES, NOT BY NAME. The binary-STL case is the one that has
//     actually cost a user a file: a valid binary STL whose 80-byte header begins
//     "solid " was classified ASCII by a header sniff and then rejected. The
//     gate feeds exactly that file in.
//   * TOLERATE, DO NOT REFUSE. A nonsense tolerance is CLAMPED and reported, not
//     rejected; an import with degenerate faces is ok=true with the faces named.
//     Both are asserted as behaviour, not as comments.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ExchangeModel.hpp"
#include "forge/ui/SelectionService.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// A file whose 80-byte binary-STL header BEGINS WITH "solid " — the case a
// header sniff gets wrong. Two triangles, so the file is 84 + 100 = 184 bytes.
std::string binaryStlHead(std::uint32_t triangles) {
  std::string head(80, ' ');
  const std::string name = "solid exported by a CAM package";
  for (std::size_t i = 0; i < name.size() && i < 80; ++i) head[i] = name[i];
  head.push_back(static_cast<char>(triangles & 0xFF));
  head.push_back(static_cast<char>((triangles >> 8) & 0xFF));
  head.push_back(static_cast<char>((triangles >> 16) & 0xFF));
  head.push_back(static_cast<char>((triangles >> 24) & 0xFF));
  return head;
}

// An 80-column IGES start record: 72 columns of text, 'S' in column 73, then a
// right-aligned sequence number.
std::string igesHead() {
  std::string line(72, ' ');
  const std::string text = "Produced by a CAD system";
  for (std::size_t i = 0; i < text.size() && i < 72; ++i) line[i] = text[i];
  line += "S";
  line += "0000001";
  line += "\n";
  return line;
}

Observables box(double v, double a, long faces, long edges, long genus, long shells,
                bool valid = true) {
  Observables o;
  o.measured = true;
  o.valid = valid;
  o.volume = v;
  o.area = a;
  o.faceCount = faces;
  o.edgeCount = edges;
  o.vertexCount = 8;
  o.genus = genus;
  o.shellCount = shells;
  o.bboxMin[0] = 0.0; o.bboxMin[1] = 0.0; o.bboxMin[2] = 0.0;
  o.bboxMax[0] = 10.0; o.bboxMax[1] = 10.0; o.bboxMax[2] = 10.0;
  o.com[0] = 5.0; o.com[1] = 5.0; o.com[2] = 5.0;
  return o;
}

// ── a host that records what the model asked it, and answers on script ──────
// It is NOT a mock that always says yes: the whole point of several checks below
// is that a host which reports a degenerate face still produces a body, and one
// that reports no body produces a NAMED error.
class ScriptedHost final : public ExchangeHost {
 public:
  bool importOk = true;
  bool exportOk = true;
  bool haveBody = true;
  std::size_t degenerateFaces = 0;
  std::size_t imports = 0;
  std::size_t exports = 0;
  ImportOptions sawImportOptions;
  ExportOptions sawExportOptions;
  std::string sawImportPath;
  std::string sawExportPath;
  bool driveProgress = true;

  ImportOutcome importFile(const std::string& path, const ImportOptions& opts,
                           ExchangeProgress& progress) override {
    ++imports;
    sawImportPath = path;
    sawImportOptions = opts;
    ImportOutcome out;
    out.path = path;
    out.format = ExchangeFormat::Step;
    out.fileBytes = 4096;
    if (driveProgress) {
      progress.begin(4096);
      progress.setBytesDone(4096);
      progress.enterPhase(ExchangePhase::Parsing);
      progress.enterPhase(ExchangePhase::Transferring);
      progress.enterPhase(ExchangePhase::Measuring);
    }
    for (std::size_t i = 0; i < degenerateFaces; ++i) {
      out.diagnostics.error("degenerate_face",
                            "face has zero area and was kept as imported",
                            "face#" + std::to_string(i + 1));
    }
    if (!importOk) {
      out.ok = false;
      out.error = "the reader produced no body";
      return out;
    }
    out.ok = true;
    out.observables = box(1000.0, 600.0, 6, 12, 0, 1);
    return out;
  }

  ExportOutcome exportFile(const std::string& path, const ExportOptions& opts,
                           ExchangeProgress& progress) override {
    ++exports;
    sawExportPath = path;
    sawExportOptions = opts;
    ExportOutcome out;
    out.path = path;
    out.format = opts.format;
    if (driveProgress) {
      progress.begin(0);
      progress.enterPhase(ExchangePhase::Writing);
    }
    if (!exportOk) {
      out.ok = false;
      out.error = "the writer declined";
      return out;
    }
    out.ok = true;
    out.analytic = opts.preferAnalytic;
    out.fileBytes = 2048;
    return out;
  }

  bool hasExportableBody() const override { return haveBody; }
};

}  // namespace

int main() {
  Harness H("exchange_model");

  // ── 1. THE CENSUS IS SELF-CONSISTENT ──────────────────────────────────────
  {
    const std::vector<FormatCapability>& rows = formatCapabilities();
    CHECK(rows.size() >= 8);
    std::size_t importable = 0;
    std::size_t exportable = 0;
    for (const FormatCapability& row : rows) {
      const std::string label(row.label);
      CHECK(!label.empty());
      // An AVAILABLE direction names its implementation and offers no excuse.
      if (row.canImport) {
        ++importable;
        CHECK(std::string(row.importBacking).size() > 0);
        CHECK_EQ_STR(std::string(row.whyNoImport), std::string(""));
      } else {
        // An UNAVAILABLE one is the reverse: a reason, and no backing to point at.
        CHECK(std::string(row.whyNoImport).size() > 0);
        CHECK_EQ_STR(std::string(row.importBacking), std::string(""));
      }
      if (row.canExport) {
        ++exportable;
        CHECK(std::string(row.exportBacking).size() > 0);
        CHECK_EQ_STR(std::string(row.whyNoExport), std::string(""));
      } else {
        CHECK(std::string(row.whyNoExport).size() > 0);
        CHECK_EQ_STR(std::string(row.exportBacking), std::string(""));
        // Nowhere to send the user is allowed only for the Unknown row.
        if (row.format != ExchangeFormat::Unknown) {
          CHECK(row.exportAlternative != ExchangeFormat::Unknown);
        }
      }
      // Every real format declares a geometry class and at least one extension.
      if (row.format != ExchangeFormat::Unknown) {
        CHECK(row.geometry != GeometryClass::None);
        CHECK(std::string(row.extensions).size() > 0);
      }
    }
    CHECK_EQ_INT(importableFormats().size(), importable);
    CHECK_EQ_INT(exportableFormats().size(), exportable);

    // The MEASURED state of this build, pinned. These are not aspirations: each
    // was established by reading the call chain and then running it.
    CHECK(capabilityOf(ExchangeFormat::Step).canImport);
    CHECK(capabilityOf(ExchangeFormat::Step).canExport);
    CHECK(capabilityOf(ExchangeFormat::Iges).canImport);
    CHECK(!capabilityOf(ExchangeFormat::Iges).canExport);
    CHECK(capabilityOf(ExchangeFormat::Iges).exportAlternative == ExchangeFormat::Step);
    CHECK(capabilityOf(ExchangeFormat::Brep).canImport);
    CHECK(capabilityOf(ExchangeFormat::Brep).canExport);
    CHECK(capabilityOf(ExchangeFormat::Stl).canImport);
    CHECK(capabilityOf(ExchangeFormat::Stl).canExport);
    CHECK(capabilityOf(ExchangeFormat::Obj).canImport);
    CHECK(capabilityOf(ExchangeFormat::Obj).canExport);
    CHECK(!capabilityOf(ExchangeFormat::Dxf).canImport);
    CHECK(!capabilityOf(ExchangeFormat::Jt).canImport);
    CHECK(!capabilityOf(ExchangeFormat::Parasolid).canImport);
    // Geometry class is the reason DXF can never make a solid, so it is asserted
    // rather than left as prose.
    CHECK(capabilityOf(ExchangeFormat::Dxf).geometry == GeometryClass::Curves2d);
    CHECK(capabilityOf(ExchangeFormat::Stl).geometry == GeometryClass::Tessellated);
    CHECK(capabilityOf(ExchangeFormat::Step).geometry == GeometryClass::ExactBrep);
    // A format never asked about still answers, with the Unknown row.
    CHECK(capabilityOf(static_cast<ExchangeFormat>(200)).format == ExchangeFormat::Unknown);
  }

  // ── 2. format name round trip ─────────────────────────────────────────────
  {
    const ExchangeFormat all[] = {
        ExchangeFormat::Unknown, ExchangeFormat::Step, ExchangeFormat::Iges,
        ExchangeFormat::Brep,    ExchangeFormat::Stl,  ExchangeFormat::Obj,
        ExchangeFormat::Dxf,     ExchangeFormat::Jt,   ExchangeFormat::Parasolid};
    for (ExchangeFormat f : all) {
      CHECK(formatFromString(toString(f)) == f);
    }
    // A word that is not a format is Unknown, never a neighbouring format.
    CHECK(formatFromString("stepp") == ExchangeFormat::Unknown);
    CHECK(formatFromString("") == ExchangeFormat::Unknown);
    CHECK(formatFromString("STEP") == ExchangeFormat::Unknown);  // case-sensitive by design
  }

  // ── 3. extension parsing ──────────────────────────────────────────────────
  {
    CHECK(formatFromPath("/a/b/part.step") == ExchangeFormat::Step);
    CHECK(formatFromPath("part.STP") == ExchangeFormat::Step);
    CHECK(formatFromPath("part.IgS") == ExchangeFormat::Iges);
    CHECK(formatFromPath("x.brep") == ExchangeFormat::Brep);
    CHECK(formatFromPath("x.stl") == ExchangeFormat::Stl);
    CHECK(formatFromPath("x.obj") == ExchangeFormat::Obj);
    CHECK(formatFromPath("x.dxf") == ExchangeFormat::Dxf);
    CHECK(formatFromPath("x.jt") == ExchangeFormat::Jt);
    CHECK(formatFromPath("x.x_t") == ExchangeFormat::Parasolid);
    CHECK(formatFromPath("x.x_b") == ExchangeFormat::Parasolid);
    CHECK(formatFromPath("noextension") == ExchangeFormat::Unknown);
    // A dot in a DIRECTORY must not be read as the file's extension.
    CHECK(formatFromPath("/home/v1.2/model") == ExchangeFormat::Unknown);
    CHECK(formatFromPath("/home/v1.2/model.step") == ExchangeFormat::Step);
    // A trailing dot names nothing.
    CHECK(formatFromPath("model.") == ExchangeFormat::Unknown);
  }

  // ── 4. SNIFFING IS BY BYTES ───────────────────────────────────────────────
  {
    // STEP, name and bytes agreeing.
    const std::string step = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\n";
    SniffResult s = sniffFormat("/p/part.step", step, step.size());
    CHECK(s.format == ExchangeFormat::Step);
    CHECK(s.confidence == SniffConfidence::Certain);
    CHECK(s.extensionSaid == ExchangeFormat::Unknown);

    // ★ THE CASE THAT COST A FILE: a BINARY STL whose header begins "solid ".
    // A header sniff calls this ASCII; the size rule calls it binary, which is
    // what it is. The file is 84 + 50*2 = 184 bytes.
    const std::string bin = binaryStlHead(2);
    SniffResult b = sniffFormat("/p/scan.stl", bin, 184);
    CHECK(b.format == ExchangeFormat::Stl);
    CHECK(b.confidence == SniffConfidence::Certain);
    CHECK(b.evidence.find("size rule") != std::string::npos);
    // …and the same bytes with a WRONG size are NOT claimed as binary STL. The
    // rule is arithmetic and must not fire on a file it does not describe. The
    // header text still says "solid", but with no facet/endsolid body it is not
    // ASCII STL either — so only the extension is left to speak.
    SniffResult b2 = sniffFormat("/p/scan.stl", bin, 185);
    CHECK(b2.confidence == SniffConfidence::Extension);
    CHECK(b2.format == ExchangeFormat::Stl);

    // THE BYTES WIN over a lying name, and the conflict is REPORTED, not refused.
    SniffResult liar = sniffFormat("/p/part.stp", bin, 184);
    CHECK(liar.format == ExchangeFormat::Stl);
    CHECK(liar.confidence == SniffConfidence::Content);
    CHECK(liar.extensionSaid == ExchangeFormat::Step);

    // ASCII STL.
    const std::string ascii = "solid part\nfacet normal 0 0 1\nouter loop\n";
    SniffResult a = sniffFormat("/p/part.stl", ascii, ascii.size());
    CHECK(a.format == ExchangeFormat::Stl);
    CHECK(a.confidence == SniffConfidence::Certain);

    // IGES by column 73, not by the word "IGES".
    const std::string ig = igesHead();
    SniffResult i = sniffFormat("/p/part.igs", ig, ig.size());
    CHECK(i.format == ExchangeFormat::Iges);
    CHECK(i.confidence == SniffConfidence::Certain);
    // A STEP file that merely MENTIONS iges in a comment is still STEP.
    const std::string stepMentioningIges =
        "ISO-10303-21;\nHEADER;\n/* converted from IGES by a translator */\n";
    SniffResult si = sniffFormat("/p/x.step", stepMentioningIges, stepMentioningIges.size());
    CHECK(si.format == ExchangeFormat::Step);

    // OCCT BREP.
    const std::string brep = "DBRep_DrawableShape\n\nCASCADE Topology V3, (c) Open Cascade\n";
    SniffResult br = sniffFormat("/p/x.brep", brep, brep.size());
    CHECK(br.format == ExchangeFormat::Brep);

    // OBJ needs BOTH a v and an f line; a bare vertex list is not enough.
    const std::string obj = "# exported\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
    SniffResult o = sniffFormat("/p/mesh.obj", obj, obj.size());
    CHECK(o.format == ExchangeFormat::Obj);
    CHECK(o.confidence == SniffConfidence::Certain);
    const std::string notObj = "v 0 0 0\nv 1 0 0\n";
    SniffResult no = sniffFormat("/p/points.txt", notObj, notObj.size());
    CHECK(no.format == ExchangeFormat::Unknown);

    // DXF.
    const std::string dxf = "  0\nSECTION\n  2\nHEADER\n";
    SniffResult d = sniffFormat("/p/x.dxf", dxf, dxf.size());
    CHECK(d.format == ExchangeFormat::Dxf);

    // Parasolid, both dialects.
    const std::string ptext = "**ABCDEFGHIJKLMNOPQRSTUVWXYZ**";
    CHECK(sniffFormat("/p/x.x_t", ptext, ptext.size()).format == ExchangeFormat::Parasolid);
    std::string pbin;
    pbin.push_back(static_cast<char>(0x83));
    pbin += "binary parasolid";
    CHECK(sniffFormat("/p/x.x_b", pbin, pbin.size()).format == ExchangeFormat::Parasolid);

    // JT.
    const std::string jt = "Version 9.5 JT\n";
    CHECK(sniffFormat("/p/x.jt", jt, jt.size()).format == ExchangeFormat::Jt);

    // ★ NEVER REFUSES. Empty bytes, empty name, zero length: an answer, not a throw.
    SniffResult none = sniffFormat("", "", 0);
    CHECK(none.format == ExchangeFormat::Unknown);
    CHECK(none.confidence == SniffConfidence::None);
    CHECK(!none.evidence.empty());
    // A name with no readable bytes still gets the name's answer.
    SniffResult nameOnly = sniffFormat("/p/thing.step", "", 0);
    CHECK(nameOnly.format == ExchangeFormat::Step);
    CHECK(nameOnly.confidence == SniffConfidence::Extension);
    // Bytes shorter than every magic must not read past the end.
    SniffResult tiny = sniffFormat("/p/x", "s", 1);
    CHECK(tiny.format == ExchangeFormat::Unknown);
  }

  // ── 5. units ──────────────────────────────────────────────────────────────
  {
    CHECK_NEAR(unitInMillimetres(LengthUnit::Millimetre), 1.0, 0.0);
    CHECK_NEAR(unitInMillimetres(LengthUnit::Centimetre), 10.0, 0.0);
    CHECK_NEAR(unitInMillimetres(LengthUnit::Metre), 1000.0, 0.0);
    CHECK_NEAR(unitInMillimetres(LengthUnit::Micron), 0.001, 0.0);
    CHECK_NEAR(unitInMillimetres(LengthUnit::Inch), 25.4, 0.0);
    CHECK_NEAR(unitInMillimetres(LengthUnit::Foot), 304.8, 0.0);
    // An inch part read as mm is 25.4x too small; the scale is what fixes it.
    CHECK_NEAR(unitScale(LengthUnit::Inch, LengthUnit::Millimetre), 25.4, 1e-12);
    CHECK_NEAR(unitScale(LengthUnit::Millimetre, LengthUnit::Inch), 1.0 / 25.4, 1e-15);
    // Identity is EXACTLY 1, not 25.4/25.4 — a round trip through a ratio is how
    // a "no-op" import ends up moving every vertex by an ulp.
    CHECK(unitScale(LengthUnit::Inch, LengthUnit::Inch) == 1.0);
    CHECK(unitScale(LengthUnit::Foot, LengthUnit::Foot) == 1.0);
    // Composition: ft -> in -> mm equals ft -> mm.
    CHECK_NEAR(unitScale(LengthUnit::Foot, LengthUnit::Inch) *
                   unitScale(LengthUnit::Inch, LengthUnit::Millimetre),
               unitScale(LengthUnit::Foot, LengthUnit::Millimetre), 1e-9);
    for (const char* s : {"mm", "cm", "m", "um", "in", "ft"}) {
      CHECK_EQ_STR(std::string(toString(unitFromString(s))), std::string(s));
    }
    // An unrecognised unit falls back to mm — the document unit — never to a
    // silently different scale.
    CHECK(unitFromString("furlong") == LengthUnit::Millimetre);
  }

  // ── 6. healing policies ───────────────────────────────────────────────────
  {
    ImportOptions o;
    o.heal = HealPolicy::None;
    HealingPlan p = resolveHealing(o);
    CHECK(!p.any());

    o.heal = HealPolicy::Standard;
    p = resolveHealing(o);
    CHECK(p.sew);
    CHECK(p.harmoniseNormals);
    CHECK(p.unifyCoplanarFaces);
    CHECK(!p.fillMissingFaces);
    CHECK(!p.repairSelfIntersections);

    o.heal = HealPolicy::Aggressive;
    p = resolveHealing(o);
    CHECK(p.fillMissingFaces);
    CHECK(p.repairSelfIntersections);

    // ★ A NAMED POLICY OVERRIDES THE FLAGS. If it did not, a UI showing greyed
    // checkboxes would be showing values the import does not use.
    o.heal = HealPolicy::Standard;
    o.fillMissingFaces = true;
    o.sewShells = false;
    p = resolveHealing(o);
    CHECK(!p.fillMissingFaces);
    CHECK(p.sew);

    // …and Custom is the escape hatch that honours them exactly.
    o.heal = HealPolicy::Custom;
    p = resolveHealing(o);
    CHECK(p.fillMissingFaces);
    CHECK(!p.sew);

    o.sewTolerance = 0.02;
    CHECK_NEAR(resolveHealing(o).tolerance, 0.02, 0.0);

    for (const char* s : {"none", "standard", "aggressive", "custom"}) {
      CHECK_EQ_STR(std::string(toString(healPolicyFromString(s))), std::string(s));
    }
    CHECK(healPolicyFromString("banana") == HealPolicy::Standard);
  }

  // ── 7. ★ TOLERATE: options are CLAMPED AND REPORTED, never refused ────────
  {
    ImportOptions o;
    DiagnosticLog log;
    o.sewTolerance = 1e9;  // absurd
    const std::size_t repairs = normaliseImportOptions(o, log);
    CHECK(repairs >= 1);
    CHECK_NEAR(o.sewTolerance, kMaxTolerance, 0.0);
    CHECK_EQ_INT(log.withCode("tolerance_clamped").size(), 1);
    // The diagnostic is a WARNING, not an error: the import proceeds.
    CHECK(!log.hasErrors());
    CHECK(log.withCode("tolerance_clamped")[0].message.find("NOT refused") !=
          std::string::npos);

    // Below the floor clamps up, not to zero.
    ImportOptions o2;
    DiagnosticLog log2;
    o2.sewTolerance = -5.0;
    normaliseImportOptions(o2, log2);
    CHECK_NEAR(o2.sewTolerance, kMinTolerance, 0.0);

    // NaN is out of range in a way a bare clamp cannot fix: every comparison
    // against it is false, so it would survive and reach the kernel as a poison
    // value. It is replaced, and named.
    ImportOptions o3;
    DiagnosticLog log3;
    o3.sewTolerance = std::nan("");
    normaliseImportOptions(o3, log3);
    CHECK(!std::isnan(o3.sewTolerance));
    CHECK_EQ_INT(log3.withCode("tolerance_not_a_number").size(), 1);

    // A legal tolerance is left EXACTLY alone and produces no noise.
    ImportOptions o4;
    DiagnosticLog log4;
    o4.sewTolerance = 0.005;
    CHECK_EQ_INT(normaliseImportOptions(o4, log4), 0);
    CHECK(o4.sewTolerance == 0.005);
    CHECK_EQ_INT(log4.size(), 0);

    // Export: both tolerances, and their own bounds.
    ExportOptions e;
    DiagnosticLog elog;
    e.linearTolerance = 0.0;
    e.angularTolerance = 99.0;
    const std::size_t erepairs = normaliseExportOptions(e, elog);
    CHECK_EQ_INT(erepairs, 2);
    CHECK_NEAR(e.linearTolerance, kMinTolerance, 0.0);
    CHECK_NEAR(e.angularTolerance, kMaxAngularTolerance, 0.0);

    // ★ AN UNAVAILABLE EXPORT FORMAT IS REPORTED, NOT SUBSTITUTED. Silently
    // writing STEP bytes to the .igs path the user chose would be worse than
    // refusing; naming the alternative is what lets a repair loop take it.
    ExportOptions ig;
    DiagnosticLog iglog;
    ig.format = ExchangeFormat::Iges;
    normaliseExportOptions(ig, iglog);
    CHECK(ig.format == ExchangeFormat::Iges);  // NOT rewritten
    CHECK_EQ_INT(iglog.withCode("export_format_unavailable").size(), 1);
    CHECK(iglog.hasErrors());
    CHECK(iglog.withCode("export_format_unavailable")[0].message.find("step") !=
          std::string::npos);

    // A source unit stated while auto-detect is on is a contradiction, and it is
    // reported rather than half-applied.
    ImportOptions u;
    DiagnosticLog ulog;
    u.autoDetectUnit = true;
    u.sourceUnit = LengthUnit::Inch;
    normaliseImportOptions(u, ulog);
    CHECK_EQ_INT(ulog.withCode("source_unit_ignored").size(), 1);
    CHECK_NEAR(importScaleFactor(u), 1.0, 0.0);
    u.autoDetectUnit = false;
    CHECK_NEAR(importScaleFactor(u), 25.4, 1e-12);
  }

  // ── 8. the diagnostic log, and its cap ────────────────────────────────────
  {
    DiagnosticLog log;
    log.info("a", "an info");
    log.warn("b", "a warning", "face#3");
    log.error("c", "an error", "edge#9");
    CHECK_EQ_INT(log.size(), 3);
    CHECK_EQ_INT(log.count(Severity::Info), 1);
    CHECK_EQ_INT(log.count(Severity::Warning), 1);
    CHECK_EQ_INT(log.count(Severity::Error), 1);
    CHECK(log.hasErrors());
    CHECK_EQ_STR(log.all()[1].format(), std::string("[warning] b: a warning (face#3)"));
    CHECK_EQ_STR(log.all()[0].format(), std::string("[info] a: an info"));
    CHECK_EQ_STR(log.summary(), std::string("1 error, 1 warning, 1 info"));
    log.clear();
    CHECK(log.empty());
    CHECK(!log.hasErrors());

    // ★ THE CAP MUST NOT LIE ABOUT THE TOTAL. A 400-face part with a systemic
    // defect produces one diagnostic per face; the log keeps `cap` of them and
    // still COUNTS all of them, so hasErrors() cannot go false on exactly the
    // files that produce the most errors.
    DiagnosticLog capped;
    capped.setCap(4);
    for (int i = 0; i < 50; ++i) {
      capped.error("degenerate_face", "zero area", "face#" + std::to_string(i));
    }
    CHECK_EQ_INT(capped.size(), 4);
    CHECK_EQ_INT(capped.dropped(), 46);
    CHECK_EQ_INT(capped.count(Severity::Error), 50);
    CHECK(capped.hasErrors());
    CHECK(capped.summary().find("46 not listed") != std::string::npos);
    // withCode reads the KEPT items, and the kept ones are the FIRST — which is
    // what a user wants: the first faces to go wrong, not a random four.
    CHECK_EQ_INT(capped.withCode("degenerate_face").size(), 4);
    CHECK_EQ_STR(capped.withCode("degenerate_face")[0].entity, std::string("face#0"));

    // cap 0 means unlimited.
    DiagnosticLog uncapped;
    uncapped.setCap(0);
    for (int i = 0; i < 50; ++i) uncapped.info("x", "y");
    CHECK_EQ_INT(uncapped.size(), 50);
    CHECK_EQ_INT(uncapped.dropped(), 0);
  }

  // ── 9. progress is MONOTONIC ──────────────────────────────────────────────
  {
    ExchangeProgress p;
    CHECK(p.phase() == ExchangePhase::Idle);
    CHECK_NEAR(p.fraction(), 0.0, 0.0);
    p.begin(1000);
    CHECK(p.phase() == ExchangePhase::Reading);
    CHECK_EQ_INT(p.totalBytes(), 1000);

    double last = p.fraction();
    p.setBytesDone(500);
    CHECK(p.fraction() > last);
    last = p.fraction();

    // ★ A BAR THAT RETREATS READS AS A HANG. Reporting fewer bytes than before
    // must not move it back, and the attempt is not silently discarded either —
    // it stays where it was.
    p.setBytesDone(100);
    CHECK(p.fraction() == last);
    CHECK_EQ_INT(p.bytesDone(), 100);  // the raw counter is still honest

    p.enterPhase(ExchangePhase::Parsing);
    CHECK(p.fraction() >= last);
    last = p.fraction();
    p.enterPhase(ExchangePhase::Transferring);
    p.setPhaseFraction(0.5);
    CHECK(p.fraction() > last);
    last = p.fraction();

    // Re-entering an EARLIER phase is a rewind: counted, and refused.
    CHECK_EQ_INT(p.rewindAttempts(), 0);
    p.enterPhase(ExchangePhase::Reading);
    CHECK_EQ_INT(p.rewindAttempts(), 1);
    CHECK(p.phase() == ExchangePhase::Transferring);
    CHECK(p.fraction() == last);

    // A NaN phase fraction is ignored rather than poisoning the bar.
    p.setPhaseFraction(std::nan(""));
    CHECK(!std::isnan(p.fraction()));
    CHECK(p.fraction() == last);
    // Out-of-range fractions clamp.
    p.setPhaseFraction(9.0);
    CHECK(p.fraction() <= 1.0);

    p.enterPhase(ExchangePhase::Healing);
    p.enterPhase(ExchangePhase::Measuring);
    p.enterPhase(ExchangePhase::Writing);
    p.finish();
    CHECK(p.phase() == ExchangePhase::Done);
    CHECK_NEAR(p.fraction(), 1.0, 0.0);
    CHECK(p.done());

    // A failure is terminal, carries its reason, and is reachable from anywhere.
    ExchangeProgress q;
    q.begin(0);
    q.fail("the reader threw");
    CHECK(q.phase() == ExchangePhase::Failed);
    CHECK(q.done());
    CHECK_EQ_STR(q.error(), std::string("the reader threw"));

    // ★ CANCEL DOES NOT LIE. cancel() raises the flag and leaves the phase
    // alone: the work is still running until the host says it stopped. Flipping
    // the phase here would report a running import as finished.
    ExchangeProgress r;
    r.begin(100);
    r.enterPhase(ExchangePhase::Transferring);
    r.cancel();
    CHECK(r.cancelled());
    CHECK(r.phase() == ExchangePhase::Transferring);
    CHECK(!r.done());
    CHECK(r.label().find("cancelling") != std::string::npos);
    r.enterPhase(ExchangePhase::Cancelled);
    CHECK(r.done());

    // The label is one printable line with real byte figures.
    ExchangeProgress s;
    s.begin(29ull * 1024 * 1024);
    s.enterPhase(ExchangePhase::Transferring);
    s.setPhaseFraction(1.0);
    const std::string lbl = s.label();
    CHECK(lbl.find("Transferring") == 0);
    CHECK(lbl.find("MB") != std::string::npos);
    CHECK(lbl.find("%") != std::string::npos);

    // With an UNKNOWN total, bytes do not move the bar (0/0 is not 100%) but the
    // phase still does.
    ExchangeProgress t;
    t.begin(0);
    t.setBytesDone(999999);
    CHECK_NEAR(t.fraction(), 0.0, 0.0);
    t.enterPhase(ExchangePhase::Writing);
    CHECK(t.fraction() > 0.0);
  }

  // ── 10. observables and the loss vector ───────────────────────────────────
  {
    const Observables a = box(1000.0, 600.0, 6, 12, 0, 1);
    CHECK_NEAR(a.bboxDiagonal(), std::sqrt(300.0), 1e-9);
    CHECK_NEAR(a.characteristicLength(), std::sqrt(300.0), 1e-9);

    // An identical body loses nothing.
    LossVector same = compareObservables(a, a);
    CHECK(same.comparable);
    CHECK(same.withinTolerance);
    CHECK_EQ_INT(same.violations.size(), 0);
    CHECK_NEAR(same.volumeRel, 0.0, 0.0);

    // ★ VOLUME ALONE CANNOT VALIDATE GEOMETRY. This body matches volume, area,
    // bbox and centre of mass EXACTLY and has lost 24 holes. A volume-only test
    // passes it; the vector catches it on genus.
    Observables holed = a;
    holed.genus = 24;
    LossVector g = compareObservables(a, holed);
    CHECK_NEAR(g.volumeRel, 0.0, 0.0);
    CHECK(!g.withinTolerance);
    CHECK_EQ_INT(g.violations.size(), 1);
    CHECK_EQ_STR(forge::uitest::at(g.violations, 0), std::string("genus"));
    CHECK_EQ_INT(g.genusDelta, 24);

    // A body that moved but kept every count. bbox and com catch it.
    Observables moved = a;
    for (int i = 0; i < 3; ++i) {
      moved.bboxMin[i] += 1.0;
      moved.bboxMax[i] += 1.0;
      moved.com[i] += 1.0;
    }
    LossVector m = compareObservables(a, moved);
    CHECK(!m.withinTolerance);
    CHECK_NEAR(m.bboxMaxAbsDelta, 1.0, 1e-12);
    CHECK(m.comDistRel > 0.0);
    bool sawCom = false;
    bool sawBbox = false;
    for (const std::string& v : m.violations) {
      if (v == "com") sawCom = true;
      if (v == "bbox") sawBbox = true;
    }
    CHECK(sawCom);
    CHECK(sawBbox);

    // Face-count drift alone is a violation, and it is NAMED.
    Observables refaced = a;
    refaced.faceCount = 5;
    LossVector f = compareObservables(a, refaced);
    CHECK_EQ_INT(f.faceDelta, -1);
    CHECK(!f.withinTolerance);
    CHECK_EQ_STR(forge::uitest::at(f.violations, 0), std::string("faces"));
    // …but a caller who is measuring a route that legitimately re-faces the body
    // can say so, and then only the geometry terms speak.
    LossTolerance loose;
    loose.requireSameFaceCount = false;
    CHECK(compareObservables(a, refaced, loose).withinTolerance);

    // Validity loss is directional: valid -> invalid is a loss, the reverse is
    // an improvement and must not be reported as damage.
    Observables invalid = a;
    invalid.valid = false;
    CHECK(compareObservables(a, invalid).validityLost);
    CHECK(!compareObservables(invalid, a).validityLost);

    // An unmeasured side is not comparable, and says so rather than reporting 0.
    Observables none;
    LossVector nl = compareObservables(a, none);
    CHECK(!nl.comparable);
    CHECK(!nl.withinTolerance);
    CHECK_EQ_STR(forge::uitest::at(nl.violations, 0), std::string("not_measured"));

    // ★ A SENTINEL IS NOT A COUNT. This is a MEASURED defect, not a
    // hypothetical: in the first run of the 600-part round-trip the re-imported
    // body's B-rep census was unavailable (-1) and the comparison reported
    // faceDelta -629, edgeDelta -1864 and shellDelta -3 against a body with 628
    // faces — three fabricated findings in one line. An unmeasured term must say
    // it is unmeasured, which is a different fact from "it changed".
    Observables blind = a;
    blind.faceCount = -1;
    blind.edgeCount = -1;
    blind.shellCount = -1;
    LossVector bl = compareObservables(a, blind);
    CHECK_EQ_INT(bl.faceDelta, 0);
    CHECK_EQ_INT(bl.edgeDelta, 0);
    CHECK_EQ_INT(bl.shellDelta, 0);
    CHECK(!bl.withinTolerance);
    bool sawUnmeasured = false;
    bool sawPlainFaces = false;
    for (const std::string& v : bl.violations) {
      if (v == "faces_unmeasured") sawUnmeasured = true;
      if (v == "faces") sawPlainFaces = true;
    }
    CHECK(sawUnmeasured);
    CHECK(!sawPlainFaces);
    // …and a caller that does not require the term gets no violation from it at
    // all, rather than a violation it cannot act on.
    LossTolerance noFaces;
    noFaces.requireSameFaceCount = false;
    noFaces.requireSameEdgeCount = false;
    noFaces.requireSameShellCount = false;
    CHECK(compareObservables(a, blind, noFaces).withinTolerance);
    // The vertex count is REPORTED, never gated — a re-tessellation legitimately
    // moves it — but it must not fabricate a delta either.
    Observables blindV = a;
    blindV.vertexCount = -1;
    CHECK_EQ_INT(compareObservables(a, blindV).vertexDelta, 0);
    CHECK(compareObservables(a, blindV).withinTolerance);

    // A zero-volume body must not divide by zero.
    Observables empty;
    empty.measured = true;
    LossVector el = compareObservables(empty, empty);
    CHECK(!std::isnan(el.volumeRel));
    CHECK(el.comparable);
    // characteristicLength falls back rather than returning 0.
    CHECK(empty.characteristicLength() >= 1.0);
  }

  // ── 11. the model with no host FAILS, and says why ────────────────────────
  {
    ExchangeModel model;
    CHECK(!model.runImport("/p/x.step"));
    CHECK(!model.lastImport().ok);
    CHECK(model.lastImport().error.find("no exchange host") != std::string::npos);
    CHECK(model.progress().phase() == ExchangePhase::Failed);
    CHECK(model.diagnostics().withCode("no_host").size() == 1);
    CHECK_EQ_INT(model.importCount(), 1);

    CHECK(!model.runExport("/p/x.step"));
    CHECK(model.lastExport().error.find("no exchange host") != std::string::npos);
  }

  // ── 12. the model drives the host, and does not let it re-decide ──────────
  {
    ExchangeModel model;
    ScriptedHost host;
    model.setHost(&host);

    ImportOptions& o = model.importOptions();
    o.autoDetectUnit = false;
    o.sourceUnit = LengthUnit::Inch;
    o.documentUnit = LengthUnit::Millimetre;
    o.heal = HealPolicy::Aggressive;
    o.sewTolerance = 500.0;  // absurd; must be clamped BEFORE the host sees it

    CHECK(model.runImport("/p/part.step"));
    CHECK_EQ_INT(host.imports, 1);
    CHECK_EQ_STR(host.sawImportPath, std::string("/p/part.step"));
    // ★ The host receives NORMALISED options. A host that had to clamp for
    // itself would be a second place the rule lives, and the two would drift.
    CHECK_NEAR(host.sawImportOptions.sewTolerance, kMaxTolerance, 0.0);
    // …and the model's answers survive whatever the host filled in.
    CHECK_NEAR(model.lastImport().scaleApplied, 25.4, 1e-12);
    CHECK(model.lastImport().healing.fillMissingFaces);
    CHECK(model.lastImport().observables.measured);
    CHECK(model.progress().done());
    CHECK(model.progress().phase() == ExchangePhase::Done);
    // The clamp diagnostic AND the host's diagnostics are both in the log.
    CHECK_EQ_INT(model.diagnostics().withCode("tolerance_clamped").size(), 1);

    // Export is offered only when there is something to write.
    CHECK(host.hasExportableBody());
    model.exportOptions().format = ExchangeFormat::Stl;
    model.exportOptions().targetUnit = LengthUnit::Inch;
    CHECK(model.runExport("/p/part.stl"));
    CHECK_EQ_INT(host.exports, 1);
    CHECK_NEAR(model.lastExport().scaleApplied, 1.0 / 25.4, 1e-15);
    CHECK(model.lastExport().ok);

    host.haveBody = false;
    CHECK(!model.runExport("/p/part.stl"));
    CHECK(model.lastExport().error.find("no body") != std::string::npos);
    CHECK_EQ_INT(host.exports, 1);  // the host was never called
  }

  // ── 13. ★ TOLERATE: a body with degenerate faces IMPORTS ─────────────────
  {
    ExchangeModel model;
    ScriptedHost host;
    host.degenerateFaces = 3;
    model.setHost(&host);

    CHECK(model.runImport("/p/broken.step"));
    // ok == "a body exists", NOT "nothing went wrong".
    CHECK(model.lastImport().ok);
    CHECK(model.lastImport().observables.measured);
    // …and the faces are NAMED, one diagnostic each, so a repair loop can act.
    CHECK(model.diagnostics().hasErrors());
    const std::vector<ExchangeDiagnostic> bad =
        model.diagnostics().withCode("degenerate_face");
    CHECK_EQ_INT(bad.size(), 3);
    CHECK_EQ_STR(bad[0].entity, std::string("face#1"));
    CHECK_EQ_STR(bad[2].entity, std::string("face#3"));

    // The refusing case is different and looks different: no body at all.
    ScriptedHost dead;
    dead.importOk = false;
    ExchangeModel m2;
    m2.setHost(&dead);
    CHECK(!m2.runImport("/p/empty.step"));
    CHECK(!m2.lastImport().observables.measured);
    CHECK(!m2.lastImport().error.empty());
  }

  // ── 14. the commands ──────────────────────────────────────────────────────
  {
    CommandRegistry registry;
    ExchangeModel model;
    ScriptedHost host;
    model.setHost(&host);

    const std::size_t added = registerExchangeCommands(registry, model);
    CHECK_EQ_INT(added, exchangeCommandIds().size());
    for (const std::string& id : exchangeCommandIds()) {
      CHECK(registry.contains(id));
    }
    // A second registration adds NOTHING — one ID, one implementation.
    CHECK_EQ_INT(registerExchangeCommands(registry, model), 0);

    const CommandDescriptor* imp = registry.find("file.import");
    CHECK(imp != nullptr);
    if (imp != nullptr) {
      // ★ NO featureIrOp. An import is not an IR statement, and claiming one
      // would put a fictional op into the derived vocabulary.
      CHECK_EQ_STR(imp->featureIrOp, std::string(""));
      CHECK_EQ_STR(imp->category, std::string("File"));
      CHECK(imp->signature.kind == EntityKind::None);
      // `path` is required with NO default; everything else HAS one, so a
      // keyboard gesture prompts for the path and nothing else.
      std::size_t required = 0;
      std::size_t withDefault = 0;
      for (const ParamSpec& p : imp->schema) {
        if (p.required) ++required;
        if (p.hasDefault) ++withDefault;
        if (p.name == "path") {
          CHECK(p.required);
          CHECK(!p.hasDefault);
        } else {
          CHECK(p.hasDefault);
        }
      }
      CHECK_EQ_INT(required, 1);
      CHECK_EQ_INT(withDefault, imp->schema.size() - 1);
    }

    SelectionService selection;
    // A gesture with no path reports EXACTLY that, and reports it as the
    // promptable parameter rather than as a mute failure.
    const CommandDescriptor* cmd = registry.find("file.import");
    CHECK(cmd != nullptr);
    if (cmd != nullptr) {
      const CommandParams filled = applyDefaults(*cmd, CommandParams());
      const std::vector<std::string> missing = missingRequired(*cmd, filled);
      CHECK_EQ_INT(missing.size(), 1);
      CHECK_EQ_STR(forge::uitest::at(missing, 0), std::string("path"));
    }

    // A full dispatch runs the import through the ONE registry.
    CommandParams params;
    params.setText("path", "/p/from_command.step");
    params.setText("heal", "aggressive");
    params.setFlag("auto_units", false);
    params.setText("source_units", "in");
    params.setNumber("tolerance", 0.25);
    const DispatchResult dr = registry.dispatch("file.import", selection, params);
    CHECK(dr.ok());
    CHECK_EQ_INT(host.imports, 1);
    CHECK_EQ_STR(host.sawImportPath, std::string("/p/from_command.step"));
    CHECK(model.importOptions().heal == HealPolicy::Aggressive);
    CHECK_NEAR(model.lastImport().scaleApplied, 25.4, 1e-12);
    CHECK_NEAR(host.sawImportOptions.sewTolerance, 0.25, 1e-15);

    // A host that produces no body makes the DISPATCH fail with the reason, not
    // with an Ok that hid it.
    host.importOk = false;
    CommandParams p2;
    p2.setText("path", "/p/dead.step");
    const DispatchResult dr2 = registry.dispatch("file.import", selection, p2);
    CHECK(!dr2.ok());
    CHECK(dr2.status == DispatchStatus::EditRefused);
    CHECK(dr2.detail.find("no body") != std::string::npos);

    // Export is DISABLED when there is nothing to write, and the menu greys out
    // on the same answer the dispatcher gives.
    host.haveBody = false;
    CommandParams p3;
    p3.setText("path", "/p/out.step");
    const DispatchResult ev = registry.evaluate("file.export", selection, p3);
    CHECK(ev.status == DispatchStatus::Disabled);
    const DispatchResult dr3 = registry.dispatch("file.export", selection, p3);
    CHECK(dr3.status == DispatchStatus::Disabled);
    CHECK_EQ_INT(host.exports, 0);

    host.haveBody = true;
    CHECK(registry.evaluate("file.export", selection, p3).ok());
    CHECK(registry.dispatch("file.export", selection, p3).ok());
    CHECK_EQ_INT(host.exports, 1);
    CHECK_EQ_STR(host.sawExportPath, std::string("/p/out.step"));
    CHECK(host.sawExportOptions.format == ExchangeFormat::Step);
  }

  // ── 15. a host that never touches progress still leaves it consistent ─────
  // A host is allowed to be simple. The MODEL is what guarantees the bar ends up
  // somewhere terminal, because a bar stuck at 0 after a finished import is the
  // same bug to a user as a hang.
  {
    ExchangeModel model;
    ScriptedHost host;
    host.driveProgress = false;
    model.setHost(&host);
    CHECK(model.runImport("/p/x.step"));
    CHECK(model.progress().done());
    CHECK(model.progress().phase() == ExchangePhase::Done);

    host.importOk = false;
    CHECK(!model.runImport("/p/x.step"));
    CHECK(model.progress().phase() == ExchangePhase::Failed);
    CHECK(!model.progress().error().empty());
  }

  return H.finish();
}
