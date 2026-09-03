#include "PartFile.hpp"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace forge::desktop {
namespace {

std::string trimRight(const std::string& s) {
  std::size_t end = s.size();
  while (end > 0 && (s[end - 1] == ' ' || s[end - 1] == '\t' || s[end - 1] == '\r')) --end;
  return s.substr(0, end);
}

std::string trim(const std::string& s) {
  std::size_t begin = 0;
  while (begin < s.size() && (s[begin] == ' ' || s[begin] == '\t')) ++begin;
  return trimRight(s.substr(begin));
}

// Splits "KEY rest of the line" into the key and the REST VERBATIM, so a label
// keeps its interior spacing. A key with no value yields an empty rest.
void splitKey(const std::string& line, std::string& key, std::string& rest) {
  const std::size_t sp = line.find(' ');
  if (sp == std::string::npos) {
    key = line;
    rest = std::string();
    return;
  }
  key = line.substr(0, sp);
  rest = trim(line.substr(sp + 1));
}

const char* kindName(forge::ui::IrValueKind k) { return forge::ui::toString(k); }

// The inverse of kindName(), and it must stay the exact inverse. This was an
// if-chain over four literals while the writer emitted toString() for ANY kind,
// so a kind the chain did not list wrote a .fpart that would not load -- and
// neither half is a compile error. It now walks forge::ui::kAllIrValueKinds,
// comparing against the same toString() the writer uses.
bool kindFromName(const std::string& name, forge::ui::IrValueKind& out) {
  return forge::ui::irValueKindFromName(name, out);
}

// A POINT RING, written WITHOUT its brackets: `ARG pts2 -20 -10; 20 -10; 0 18`.
//
// IrArg::token() writes `[...]` for the IR statement; this file is a different
// encoding (one ARG per line, kind then value), and re-using the bracketed spelling
// would mean the reader had to strip them. The DIMENSION is in the kind name rather
// than inferred from the coordinate count, because `x y z` and a 2D point followed by
// junk are the same characters -- and a 3D ring silently re-read as 2D is a section
// that moves to z=0, which is a wrong part rather than a failed load.
//
// Round-trips exactly: formatIrNumber is "%.10g" and parseIrPoints reads with strtod,
// which is the pair the IR itself round-trips through.
std::string pointsLine(const forge::ui::IrArg& a) {
  std::string out = (a.dim == 3) ? "ARG pts3 " : "ARG pts2 ";
  for (std::size_t i = 0; i < a.pts.size(); ++i) {
    if (i != 0) out += "; ";
    out += forge::ui::formatIrNumber(a.pts[i].x);
    out += " ";
    out += forge::ui::formatIrNumber(a.pts[i].y);
    if (a.dim == 3) {
      out += " ";
      out += forge::ui::formatIrNumber(a.pts[i].z);
    }
  }
  return out;
}

std::string argLine(const forge::ui::IrArg& a) {
  switch (a.kind) {
    case forge::ui::IrArgKind::Number:
      return "ARG num " + forge::ui::formatIrNumber(a.number);
    case forge::ui::IrArgKind::Ref:
      return "ARG ref " + std::to_string(a.ref);
    case forge::ui::IrArgKind::Keyword:
      return "ARG kw " + a.word;
    case forge::ui::IrArgKind::Text:
      return "ARG str " + a.word;
    case forge::ui::IrArgKind::Points:
      return pointsLine(a);
  }
  return "ARG kw INVALID";
}

// Exactly `count` numbers, whitespace-separated, and no more: a
// MATERIAL-APPEARANCE line with a seventh value is a line this build does not
// understand, and reading the first six of it would be inventing a meaning for
// the rest. Each token goes through the format's OWN number parser, so what one
// writer wrote the other reads back to the last bit.
bool readNumbers(const std::string& text, double* out, std::size_t count) {
  std::istringstream in(text);
  std::string token;
  for (std::size_t i = 0; i < count; ++i) {
    if (!(in >> token)) return false;
    if (!forge::ui::parseRoundTripNumber(token, out[i])) return false;
  }
  return !(in >> token);
}

bool argFromLine(const std::string& rest, forge::ui::IrArg& out, std::string& error) {
  std::string kind, value;
  splitKey(rest, kind, value);
  if (kind == "num") {
    if (value.empty()) { error = "ARG num with no value"; return false; }
    const char* begin = value.c_str();
    char* end = nullptr;
    const double v = std::strtod(begin, &end);
    if (end == begin || *end != '\0') { error = "ARG num is not a number: " + value; return false; }
    out = forge::ui::IrArg::num(v);
    return true;
  }
  if (kind == "ref") {
    if (value.empty()) { error = "ARG ref with no value"; return false; }
    const char* begin = value.c_str();
    char* end = nullptr;
    const long v = std::strtol(begin, &end, 10);
    if (end == begin || *end != '\0' || v <= 0) {
      error = "ARG ref is not a positive statement id: " + value;
      return false;
    }
    out = forge::ui::IrArg::valueRef(static_cast<int>(v));
    return true;
  }
  if (kind == "kw") {
    if (value.empty()) { error = "ARG kw with no value"; return false; }
    out = forge::ui::IrArg::keyword(value);
    return true;
  }
  if (kind == "str") {
    out = forge::ui::IrArg::text(value);
    return true;
  }
  if (kind == "pts2" || kind == "pts3") {
    const int dim = (kind == "pts3") ? 3 : 2;
    std::vector<forge::ui::IrPoint> ring = forge::ui::parseIrPoints(value, dim);
    // parseIrPoints returns EMPTY for anything it cannot read completely -- a point
    // with too few coordinates, trailing junk, a non-finite value -- and an empty ring
    // renders as `[]`, which forge::ft's lexer refuses outright. So a truncated or
    // hand-edited file must FAIL THE LOAD here rather than produce a document holding
    // a statement that cannot compile.
    if (ring.empty()) {
      error = "ARG " + kind + " is not a `x y" + (dim == 3 ? " z" : "") +
              "; ...` point ring: " + value;
      return false;
    }
    out = forge::ui::IrArg::points(std::move(ring), dim);
    return true;
  }
  error = "unknown ARG kind '" + kind + "' (expected num|ref|kw|str|pts2|pts3)";
  return false;
}

}  // namespace

// ── PartFileDoc ─────────────────────────────────────────────────────────────
std::string PartFileDoc::irProgram() const {
  std::string out;
  for (const PartFileFeature& f : features) {
    out += f.record.line.text();
    out += "\n";
  }
  return out;
}

// ── the format ──────────────────────────────────────────────────────────────
std::string writePartFile(const PartFileDoc& doc) {
  std::string out;
  out += std::string(kPartFileMagic) + " " + std::to_string(kPartFileVersion) + "\n";
  out += "NAME " + (doc.name.empty() ? std::string("untitled") : doc.name) + "\n";
  out += "UNITS " + (doc.units.empty() ? std::string("mm") : doc.units) + "\n";
  // ── the material, whole, and only when there is one ───────────────────────
  //
  // THE KEYS ARE NOT NEW. ui/src/DocumentModel.cpp -- the OTHER writer of this
  // same `.fpart` name -- already spells a stored material MATERIAL-ID,
  // MATERIAL-NAME, MATERIAL-DENSITY and MATERIAL-APPEARANCE. Inventing a second
  // spelling here would have been the "one thing, two code paths" shape this
  // format's own compatibility gate exists to refuse, and the new reader would
  // have rejected every file the shipped app wrote. So v1 gains the keys v2
  // already had, and both readers accept them (the version table in
  // DocumentModel.cpp records that they now start at v1).
  //
  // A document with no material chosen writes NOTHING here, so a file saved from
  // an unassigned document is byte-for-byte what the previous writer produced.
  // Numbers go through formatRoundTripNumber, which is the pair the other writer
  // uses and the one parseRoundTripNumber reads back exactly.
  if (doc.material.id != forge::ui::unassignedMaterial().id) {
    out += "MATERIAL-ID " + doc.material.id + "\n";
    out += "MATERIAL-NAME " + doc.material.name + "\n";
    out += "MATERIAL-DENSITY " + forge::ui::formatRoundTripNumber(doc.material.densityKgPerM3) +
           "\n";
    const forge::ui::Appearance& a = doc.material.appearance;
    out += "MATERIAL-APPEARANCE " + forge::ui::formatRoundTripNumber(a.red) + " " +
           forge::ui::formatRoundTripNumber(a.green) + " " +
           forge::ui::formatRoundTripNumber(a.blue) + " " +
           forge::ui::formatRoundTripNumber(a.metallic) + " " +
           forge::ui::formatRoundTripNumber(a.roughness) + " " +
           forge::ui::formatRoundTripNumber(a.opacity) + "\n";
  }
  for (const PartFileFeature& f : doc.features) {
    out += "FEATURE\n";
    out += "ID " + std::to_string(f.record.irId) + "\n";
    out += "KIND " + std::string(kindName(f.record.produces)) + "\n";
    if (!f.node.empty()) out += "NODE " + f.node + "\n";
    if (!f.record.commandId.empty()) out += "COMMAND " + f.record.commandId + "\n";
    if (!f.record.label.empty()) out += "LABEL " + f.record.label + "\n";
    out += "OP " + f.record.line.op + "\n";
    for (const forge::ui::IrArg& a : f.record.line.args) {
      out += argLine(a) + "\n";
    }
    out += "END\n";
  }
  return out;
}

bool readPartFile(const std::string& text, PartFileDoc& out, std::string& error) {
  PartFileDoc doc;
  std::istringstream in(text);
  std::string raw;
  int lineNo = 0;
  bool sawHeader = false;
  bool inFeature = false;
  PartFileFeature current;

  const auto fail = [&error, &lineNo](const std::string& why) {
    error = "line " + std::to_string(lineNo) + ": " + why;
    return false;
  };

  while (std::getline(in, raw)) {
    ++lineNo;
    const std::string line = trim(raw);
    if (line.empty() || line[0] == '#') continue;

    std::string key, rest;
    splitKey(line, key, rest);

    if (!sawHeader) {
      if (key != kPartFileMagic) {
        return fail(std::string("not a ") + kPartFileExtension + " file (expected '" +
                    kPartFileMagic + " <version>', got '" + line + "')");
      }
      const int version = std::atoi(rest.c_str());
      if (version != kPartFileVersion) {
        return fail("unsupported version " + rest + " (this build reads " +
                    std::to_string(kPartFileVersion) + ")");
      }
      sawHeader = true;
      continue;
    }

    if (!inFeature) {
      if (key == "NAME") { doc.name = rest; continue; }
      if (key == "UNITS") { doc.units = rest; continue; }
      if (key == "MATERIAL-ID") {
        if (rest.empty()) return fail("MATERIAL-ID with no name");
        doc.material.id = rest;
        // The NAME falls back to the id until a MATERIAL-NAME line replaces it,
        // exactly as the other reader of this format does, so a hand-written
        // file that gives only the id still shows something a person can read.
        if (doc.material.name == forge::ui::unassignedMaterial().name) doc.material.name = rest;
        continue;
      }
      if (key == "MATERIAL-NAME") {
        if (rest.empty()) return fail("MATERIAL-NAME with no text");
        doc.material.name = rest;
        continue;
      }
      if (key == "MATERIAL-DENSITY") {
        double density = 0.0;
        if (!forge::ui::parseRoundTripNumber(rest, density)) {
          return fail("MATERIAL-DENSITY is not a number: " + rest);
        }
        if (density < 0.0) return fail("MATERIAL-DENSITY is negative: " + rest);
        doc.material.densityKgPerM3 = density;
        continue;
      }
      if (key == "MATERIAL-APPEARANCE") {
        double v[6] = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
        if (!readNumbers(rest, v, 6)) {
          return fail("MATERIAL-APPEARANCE needs six numbers, got '" + rest + "'");
        }
        doc.material.appearance.red = v[0];
        doc.material.appearance.green = v[1];
        doc.material.appearance.blue = v[2];
        doc.material.appearance.metallic = v[3];
        doc.material.appearance.roughness = v[4];
        doc.material.appearance.opacity = v[5];
        continue;
      }
      if (key == "FEATURE") {
        inFeature = true;
        current = PartFileFeature{};
        continue;
      }
      return fail("unexpected '" + key + "' outside a FEATURE block");
    }

    if (key == "END") {
      if (current.record.line.op.empty()) return fail("FEATURE block has no OP");
      if (current.record.irId <= 0) return fail("FEATURE block has no ID");
      current.record.line.id = current.record.irId;
      doc.features.push_back(current);
      inFeature = false;
      continue;
    }
    if (key == "ID") {
      current.record.irId = std::atoi(rest.c_str());
      continue;
    }
    if (key == "KIND") {
      if (!kindFromName(rest, current.record.produces)) {
        return fail("unknown KIND '" + rest + "' (expected none|profile|wire|solid)");
      }
      continue;
    }
    if (key == "NODE") { current.node = rest; continue; }
    if (key == "COMMAND") { current.record.commandId = rest; continue; }
    if (key == "LABEL") { current.record.label = rest; continue; }
    if (key == "OP") {
      if (rest.empty()) return fail("OP with no name");
      current.record.line.op = rest;
      continue;
    }
    if (key == "ARG") {
      forge::ui::IrArg arg;
      std::string why;
      if (!argFromLine(rest, arg, why)) return fail(why);
      current.record.line.args.push_back(arg);
      continue;
    }
    return fail("unknown key '" + key + "' inside a FEATURE block");
  }

  if (!sawHeader) {
    error = "empty file: no " + std::string(kPartFileMagic) + " header";
    return false;
  }
  if (inFeature) {
    error = "file ends inside a FEATURE block (truncated write?)";
    return false;
  }
  out = std::move(doc);
  error.clear();
  return true;
}

// ── document <-> file ───────────────────────────────────────────────────────
PartFileDoc capturePartDocument(const forge::ui::PartDocument& doc, const std::string& name) {
  PartFileDoc out;
  out.name = name.empty() ? std::string("untitled") : name;
  out.material = doc.material();
  // snapshot() is the document's own published view of its node bindings; the
  // reverse index is built here rather than kept in a second place that could
  // fall behind it.
  const std::map<std::string, int> bindings = doc.snapshot().bindings;
  for (const forge::ui::FeatureRecord& r : doc.records()) {
    PartFileFeature f;
    f.record = r;
    for (const auto& kv : bindings) {
      if (kv.second == r.irId) {
        f.node = kv.first;  // std::map is ordered, so this choice is deterministic
        break;
      }
    }
    out.features.push_back(std::move(f));
  }
  return out;
}

bool restorePartDocument(const PartFileDoc& file, forge::ui::PartDocument& doc,
                         std::string& error) {
  // The material FIRST, and its return value is deliberately not checked:
  // setMaterial refuses a no-op, and restoring "no material chosen" into a fresh
  // document is exactly that. A refusal here means the document already agreed.
  doc.setMaterial(file.material);
  for (const PartFileFeature& f : file.features) {
    if (f.record.irId != doc.nextIrId()) {
      error = "statement %" + std::to_string(f.record.irId) +
              " is out of creation order (expected %" + std::to_string(doc.nextIrId()) + ")";
      return false;
    }
    if (!doc.appendFeature(f.record, {}, f.node)) {
      error = "statement %" + std::to_string(f.record.irId) + " (" + f.record.line.op +
              ") was refused: " + forge::ui::toString(doc.lastCheck());
      return false;
    }
  }
  error.clear();
  return true;
}

// ── disk ────────────────────────────────────────────────────────────────────
bool savePartFile(const std::string& path, const PartFileDoc& doc, std::string& error) {
  if (path.empty()) {
    error = "no path";
    return false;
  }
  std::ofstream out(path, std::ios::trunc | std::ios::binary);
  if (!out) {
    error = "cannot open '" + path + "' for writing";
    return false;
  }
  const std::string text = writePartFile(doc);
  out.write(text.data(), static_cast<std::streamsize>(text.size()));
  out.flush();
  // A write that failed halfway must not be reported as a save.
  if (!out) {
    error = "write to '" + path + "' failed";
    return false;
  }
  error.clear();
  return true;
}

bool loadPartFile(const std::string& path, PartFileDoc& out, std::string& error) {
  if (path.empty()) {
    error = "no path";
    return false;
  }
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    error = "cannot open '" + path + "'";
    return false;
  }
  std::ostringstream ss;
  ss << in.rdbuf();
  return readPartFile(ss.str(), out, error);
}

// ── the default part ────────────────────────────────────────────────────────
namespace {

using forge::ui::IrArg;
using forge::ui::IrLine;
using forge::ui::IrValueKind;

const char* const kBodyNode = "body.bracket";

std::vector<SeedStatement> makeDefaultPart() {
  std::vector<SeedStatement> s;
  s.push_back(SeedStatement{IrLine{1, "RECT", {IrArg::num(80.0), IrArg::num(50.0)}},
                            IrValueKind::Profile, "", "Base Sketch  80 x 50",
                            "rectangular profile on XY"});
  s.push_back(SeedStatement{IrLine{2, "EXTRUDE", {IrArg::valueRef(1), IrArg::num(20.0)}},
                            IrValueKind::Solid, "", "Plate  extrude 20", "distance=20 along +Z"});
  s.push_back(SeedStatement{IrLine{3,
                                   "CYL",
                                   {IrArg::num(6.0), IrArg::num(40.0), IrArg::num(0.0),
                                    IrArg::num(0.0), IrArg::num(-10.0)}},
                            IrValueKind::Solid, "", "Bore Tool  d12 x 40",
                            "cylinder r=6 h=40 at (0, 0, -10)"});
  s.push_back(SeedStatement{IrLine{4, "CUT", {IrArg::valueRef(2), IrArg::valueRef(3)}},
                            IrValueKind::Solid, "", "Through Bore  d12",
                            "plate minus the bore tool"});
  s.push_back(SeedStatement{
      IrLine{5, "FILLET", {IrArg::valueRef(4), IrArg::num(3.0), IrArg::keyword("VERTICAL")}},
      IrValueKind::Solid, kBodyNode, "Corner Fillet  r3", "r=3 on the vertical corner edges"});
  return s;
}

}  // namespace

const std::vector<SeedStatement>& defaultPartStatements() {
  static const std::vector<SeedStatement> table = makeDefaultPart();
  return table;
}

std::string defaultPartIr() {
  std::string out;
  for (const SeedStatement& s : defaultPartStatements()) {
    out += s.line.text();
    out += "\n";
  }
  return out;
}

const char* defaultPartBodyNode() { return kBodyNode; }

}  // namespace forge::desktop
