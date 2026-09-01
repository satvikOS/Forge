// ui/test/document_format_compat_test.cpp
//
// TWO IMPLEMENTATIONS, ONE FORMAT NAME — and the gate that makes that safe
// instead of merely true.
//
// `.fpart` is written by TWO independent pieces of code in this repository:
//
//   forge-desktop/src/PartFile.cpp   magic FORGE-PART, version 1   (the shipped
//                                    app: ForgeFrame::documentSave calls it)
//   ui/src/DocumentModel.cpp         magic FORGE-PART, version 2   (the document
//                                    layer, which also carries units, material,
//                                    view, parameters, named entities and
//                                    suppression -- none of which v1 can express)
//
// Same magic. Same `.fpart` extension. Different writers, different readers,
// different version numbers. That is the "one thing, two code paths" shape this
// codebase forbids everywhere else, and the half that drifts is always the one
// with fewer users.
//
// Rather than assert that nobody will ever notice, this gate pins the ONE
// property that makes the duplication survivable: **v1 must mean exactly the
// same thing to both of them**, so every file the shipped application has
// already written to a user's disk is read back by the new reader with nothing
// lost. It derives v1's key set FROM PartFile.cpp'S OWN SOURCE rather than from
// a transcription here, because a hand-copied key list is a third
// implementation and would drift from both.
//
// ── the consequence this gate does NOT hide ─────────────────────────────────
// Compatibility is ONE-WAY and that is a real cost, recorded here rather than
// discovered by a user. readPartFile refuses any version that is not exactly
// kPartFileVersion, so a v2 file is unreadable by the shipped build -- it says
// "unsupported version 2", which is at least honest, but it is still a document
// the old app cannot open. Section 4 asserts that refusal exists and is
// version-shaped, so the migration cost stays measured instead of assumed.
#include <cstddef>
#include <cstdio>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "forge/ui/DocumentModel.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/Units.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

std::string locate(const char* relative) {
  std::vector<std::string> candidates;
#ifdef FORGE_UI_REPO_ROOT
  candidates.push_back(std::string(FORGE_UI_REPO_ROOT) + "/" + relative);
#endif
  candidates.push_back(std::string(relative));
  candidates.push_back(std::string("../") + relative);
  candidates.push_back(std::string("../../") + relative);
  for (const std::string& p : candidates) {
    std::ifstream in(p);
    if (in.good()) return p;
  }
  return {};
}

std::string slurp(const std::string& path, bool& ok) {
  std::ifstream in(path);
  ok = in.good();
  if (!ok) return {};
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

// The value of `inline constexpr ... NAME = <value>;` in a header, as written.
std::string constantOf(const std::string& source, const std::string& name) {
  const std::size_t at = source.find(name + " = ");
  if (at == std::string::npos) return {};
  const std::size_t from = at + name.size() + 3;
  const std::size_t end = source.find(';', from);
  if (end == std::string::npos) return {};
  std::string value = source.substr(from, end - from);
  // strip surrounding quotes and whitespace
  std::string out;
  for (char c : value) {
    if (c == '"' || c == ' ') continue;
    out += c;
  }
  return out;
}

// Every KEY the writer in PartFile.cpp emits: the literals in `out += "KEY ...`
// and `out += "KEY\n"`. This is the v1 vocabulary, taken from the code that
// produces it.
std::set<std::string> writerKeys(const std::string& source) {
  std::set<std::string> keys;
  const std::string needle = "out += \"";
  std::size_t at = 0;
  while ((at = source.find(needle, at)) != std::string::npos) {
    at += needle.size();
    std::string token;
    for (std::size_t i = at; i < source.size(); ++i) {
      const char c = source[i];
      if (c == ' ' || c == '"' || c == '\\') break;
      token += c;
    }
    if (!token.empty()) keys.insert(token);
  }
  return keys;
}

// Every key the reader in PartFile.cpp accepts: the literals it compares
// against in `key == "X"`.
std::set<std::string> readerKeys(const std::string& source) {
  std::set<std::string> keys;
  const std::string needle = "key == \"";
  std::size_t at = 0;
  while ((at = source.find(needle, at)) != std::string::npos) {
    at += needle.size();
    const std::size_t end = source.find('"', at);
    if (end == std::string::npos) break;
    keys.insert(source.substr(at, end - at));
    at = end;
  }
  return keys;
}

std::string join(const std::set<std::string>& s) {
  std::string out;
  for (const std::string& k : s) {
    if (!out.empty()) out += " ";
    out += k;
  }
  return out;
}

}  // namespace

int main() {
  Harness H("document_format_compat");

  // ── 1. the two implementations claim the SAME format identity ─────────────
  const std::string headerPath = locate("forge-desktop/src/PartFile.hpp");
  const std::string sourcePath = locate("forge-desktop/src/PartFile.cpp");
  // A gate that cannot find its oracle FAILS. It does not pass quietly having
  // checked nothing, which is what makes an oracle worth having.
  CHECK(!headerPath.empty());
  CHECK(!sourcePath.empty());
  if (headerPath.empty() || sourcePath.empty()) return H.finish();

  bool okHeader = false;
  bool okSource = false;
  const std::string header = slurp(headerPath, okHeader);
  const std::string source = slurp(sourcePath, okSource);
  CHECK(okHeader);
  CHECK(okSource);

  const std::string appMagic = constantOf(header, "kPartFileMagic");
  const std::string appExtension = constantOf(header, "kPartFileExtension");
  const std::string appVersionText = constantOf(header, "kPartFileVersion");
  CHECK_EQ_STR(appMagic, "FORGE-PART");
  CHECK_EQ_STR(appExtension, ".fpart");
  CHECK_EQ_STR(appVersionText, "1");

  // THE COLLISION, asserted rather than described: these are the same format
  // name, so the compatibility rules below are not optional.
  CHECK_EQ_STR(appMagic, std::string(kDocumentMagic));
  CHECK_EQ_STR(appExtension, std::string(kDocumentExtension));

  const int appVersion = std::stoi(appVersionText.empty() ? std::string("0") : appVersionText);
  // The shipped app's version must be one this reader accepts. If the app ever
  // moves past kDocumentFormatVersion this fails, which is the correct moment
  // to notice.
  CHECK(appVersion >= kOldestReadableDocumentVersion);
  CHECK(appVersion <= kDocumentFormatVersion);

  // ── 2. v1 means the SAME THING to both, key for key ───────────────────────
  const std::set<std::string> emitted = writerKeys(source);
  const std::set<std::string> accepted = readerKeys(source);
  // The derivation itself has to be alive: if either came back empty the
  // extraction broke and every comparison below would pass vacuously.
  CHECK(emitted.size() >= 8);
  CHECK(accepted.size() >= 8);

  // ONE canonical v1 document exercising EVERY key the shipped writer can emit.
  // A separate probe per key was tried first and produced malformed fixtures (an
  // unterminated FEATURE block), which tested the probe builder rather than the
  // reader. So there is one well-formed document, and the claim that it covers
  // the whole v1 vocabulary is itself checked below rather than asserted.
  const std::string everyV1Key =
      "FORGE-PART 1\n"
      "NAME probe\n"
      "UNITS mm\n"
      "FEATURE\n"
      "ID 1\n"
      "KIND solid\n"
      "NODE body_1\n"
      "COMMAND part.box\n"
      "LABEL Box\n"
      "OP BOX\n"
      "ARG num 1\n"
      "ARG num 2\n"
      "ARG num 3\n"
      "END\n";
  {
    DocumentFileData f;
    DocumentIoError e;
    const bool read = readDocumentFile(everyV1Key, f, e);
    if (!read) std::printf("  note: canonical v1 document -> %s\n", e.describe().c_str());
    CHECK(read);
    CHECK_EQ_INT(f.features.size(), 1);
  }

  // Every key the SHIPPED WRITER emits, and every key its READER accepts, must
  // appear in that document -- otherwise this gate is not covering it, and a key
  // the app writes that the new reader refuses is a user's file that will not
  // open.
  const auto covered = [&everyV1Key](const std::string& key) {
    return everyV1Key.find("\n" + key + "\n") != std::string::npos ||
           everyV1Key.find("\n" + key + " ") != std::string::npos;
  };
  for (const std::string& key : emitted) {
    if (!covered(key)) {
      std::printf("  FAIL  the app WRITES key '%s', absent from the canonical v1 probe\n",
                  key.c_str());
    }
    CHECK(covered(key));
  }
  for (const std::string& key : accepted) {
    if (!covered(key)) {
      std::printf("  FAIL  the app READS key '%s', absent from the canonical v1 probe\n",
                  key.c_str());
    }
    CHECK(covered(key));
  }
  std::printf("[document_format_compat] PartFile.cpp v1: writer emits {%s}; reader accepts {%s}\n",
              join(emitted).c_str(), join(accepted).c_str());

  // ── 3. a REAL v1 file, in the app's own spelling, survives whole ──────────
  // This is the migration proof: the exact bytes ForgeFrame::documentSave puts
  // on a user's disk today, read by the new reader, with every field checked.
  const std::string appFile =
      "FORGE-PART 1\n"
      "NAME bracket\n"
      "UNITS mm\n"
      "FEATURE\n"
      "ID 1\n"
      "KIND profile\n"
      "NODE sketch_1\n"
      "LABEL Rectangle\n"
      "OP RECT\n"
      "ARG num 80\n"
      "ARG num 60\n"
      "END\n"
      "FEATURE\n"
      "ID 2\n"
      "KIND solid\n"
      "NODE body_2\n"
      "COMMAND part.extrude\n"
      "LABEL Extrude\n"
      "OP EXTRUDE\n"
      "ARG ref 1\n"
      "ARG num 20\n"
      "END\n"
      "FEATURE\n"
      "ID 3\n"
      "KIND solid\n"
      "NODE body_2\n"
      "COMMAND part.fillet\n"
      "LABEL Fillet\n"
      "OP FILLET\n"
      "ARG ref 2\n"
      "ARG num 4\n"
      "ARG kw ALL\n"
      "END\n";

  DocumentFileData legacy;
  DocumentIoError legacyError;
  CHECK(readDocumentFile(appFile, legacy, legacyError));
  CHECK_EQ_STR(legacyError.describe(), "ok");
  CHECK_EQ_INT(legacy.version, 1);
  CHECK_EQ_STR(legacy.name, "bracket");
  CHECK_EQ_INT(legacy.features.size(), 3);
  CHECK_EQ_STR(legacy.irProgram(),
               "%1 = RECT(80, 60)\n%2 = EXTRUDE(%1, 20)\n%3 = FILLET(%2, 4, ALL)\n");
  // A CHECK on a size must never be followed by an UNGUARDED index: when the
  // size check fails, indexing is undefined behaviour and the gate dies with a
  // signal instead of printing which contract broke. (It did exactly that once
  // while this file was being written.)
  if (legacy.features.size() == 3) {
    // the metadata that makes it a DOCUMENT and not a program came through too
    CHECK_EQ_STR(legacy.features[1].record.commandId, "part.extrude");
    CHECK_EQ_STR(legacy.features[1].record.label, "Extrude");
    CHECK_EQ_STR(legacy.features[1].node, "body_2");
    CHECK_EQ_INT(static_cast<int>(legacy.features[0].record.produces),
                 static_cast<int>(IrValueKind::Profile));
    CHECK_EQ_INT(static_cast<int>(legacy.features[2].record.produces),
                 static_cast<int>(IrValueKind::Solid));
    // the KEYWORD argument stayed a keyword and did not become a quoted selector
    CHECK_EQ_INT(legacy.features[2].record.line.args.size(), 3);
    if (legacy.features[2].record.line.args.size() == 3) {
      CHECK_EQ_INT(static_cast<int>(legacy.features[2].record.line.args[2].kind),
                   static_cast<int>(IrArgKind::Keyword));
      CHECK_EQ_STR(legacy.features[2].record.line.args[2].word, "ALL");
    }
  }

  // and it loads into a LIVE model, with its bindings intact -- a document that
  // opens but cannot be selected on is a picture, not a part
  DocumentModel model;
  DocumentIoError loadError;
  CHECK(model.load(appFile, loadError));
  CHECK_EQ_STR(loadError.describe(), "ok");
  CHECK_EQ_INT(model.tree().valueFor("body_2"), 3);
  CHECK_EQ_INT(model.tree().valueFor("sketch_1"), 1);
  CHECK_EQ_STR(model.buildProgram(), model.irProgram());  // nothing suppressed in a v1 file

  // ── 3b. the ARG kind vocabulary is SHARED ─────────────────────────────────
  // Both implementations spell an argument `ARG <num|ref|kw|str> <value>`. If
  // either renamed a kind, every argument of every statement in every existing
  // file would come back refused, so this is asserted against the shipped
  // source rather than assumed from the two files looking alike.
  for (const char* kind : {"num", "ref", "kw", "str"}) {
    const std::string needle = std::string("\"ARG ") + kind + " \"";
    CHECK(source.find(needle) != std::string::npos);
  }

  // ── 3c. THE APP'S OWN WRITER IS LOSSY, and this measures it ───────────────
  // PartFile.cpp formats numbers with formatIrNumber -- "%.10g", the right
  // answer for IR text, which a human and a VLM both read -- while the document
  // layer uses formatRoundTripNumber, the shortest form strtod maps back to the
  // IDENTICAL double. They differ at the 11th significant figure, so a v1 file
  // the shipped app wrote can ALREADY have lost precision that no reader can
  // restore. That is a property of the file on disk, not of the reader, and
  // migrating to v2 fixes it going forward but cannot repair an old file.
  const bool appUsesIrFormatter = source.find("formatIrNumber") != std::string::npos;
  CHECK(appUsesIrFormatter);
  const double awkward = 0.1 + 0.2;
  const std::string lossy = formatIrNumber(awkward);
  const std::string exact = formatRoundTripNumber(awkward);
  CHECK(lossy != exact);
  double back = 0.0;
  CHECK(parseRoundTripNumber(lossy, back));
  CHECK(back != awkward);  // the shipped writer cannot round-trip this value
  CHECK(parseRoundTripNumber(exact, back));
  CHECK(back == awkward);  // the document layer can
  std::printf("[document_format_compat] precision: the shipped v%d writer emits %s for "
              "0.1+0.2 and cannot read it back exactly; the v%d writer emits %s and can\n",
              appVersion, lossy.c_str(), kDocumentFormatVersion, exact.c_str());

  // ── 4. the migration COST, measured rather than assumed ───────────────────
  // The old reader pins its version with an equality, not a range, so it
  // refuses everything except exactly 1. Deriving that from the source keeps
  // this honest if the app is ever changed to accept a range.
  const bool pinsExactVersion = source.find("version != kPartFileVersion") != std::string::npos;
  CHECK(pinsExactVersion);
  if (pinsExactVersion) {
    std::printf("[document_format_compat] one-way: readPartFile pins `version != "
                "kPartFileVersion`, so the shipped v%d build cannot open the v%d files this "
                "layer writes. Old -> new is safe; new -> old is a refusal, not a corruption.\n",
                appVersion, kDocumentFormatVersion);
  }
  // The refusal must at least be VERSION-shaped rather than a parse crash: the
  // new writer's header line is exactly what the old reader tests.
  DocumentFileData sample;
  sample.name = "x";
  const std::string v2 = writeDocumentFile(sample);
  CHECK_EQ_STR(v2.substr(0, 12), "FORGE-PART 2");

  return H.finish();
}
