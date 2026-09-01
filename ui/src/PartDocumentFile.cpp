// ui/src/PartDocumentFile.cpp — the .fpart writer and reader.
//
// The grammar, in full. Line-oriented, ASCII, one key per line, the key being
// everything up to the first space and the value everything after it, verbatim,
// so a label keeps its interior spacing. Blank lines and `#` comments are
// ignored. Blocks close with END.
//
//   FORGE-PART 2                 (line 1, mandatory -- see the version policy)
//   NAME <text>
//   UNITS <text>
//   ROLLBACK <int>               (omitted when the bar is at the end)
//   X-<anything> <text>          (a future version's line, preserved verbatim)
//   PARAM                        )
//     PNAME <identifier>         )
//     VALUE <number>             ) repeatable, emitted sorted by name
//     UNIT <text>                )
//     NOTE <text>                )
//   END                          )
//   MATERIAL                     )
//     MNAME <text>               )
//     DENSITY <number>           ) repeatable, emitted sorted by name
//     STANDARD <text>            )
//     APPEARANCE <text>          )
//   END                          )
//   ASSIGN <node> <material>     (repeatable; node is one token, material the rest)
//   FEATURE                      )
//     ID <int>                   )
//     KIND none|profile|wire|solid
//     TAG @<name>                ) the L4 persistent name, '@' included
//     NODE <node>                ) REPEATABLE -- bindings are many-to-one
//     COMMAND <id>               )
//     LABEL <text>               )
//     SUPPRESSED                 ) present == true
//     OP <NAME>                  )
//     ARG num|ref|kw|str <value> ) in order, one per argument
//     ARGPARAM <index> <param>   ) that argument slot is parameter-driven
//     DIAG <escaped text>        ) the kernel verifier's last word on this row
//     X-<anything> <text>        )
//   END                          )
//
// DIAG is the only escaped field: a verifier message can contain a newline, and
// a newline in a line-oriented format is a second record. `\` and `\n` are
// escaped on the way out and unescaped on the way in, symmetrically, so the
// round trip is exact.
#include "forge/ui/PartDocumentFile.hpp"

#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {
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

// Splits "KEY rest of the line" into the key and the REST VERBATIM. A key with
// no value yields an empty rest.
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

// Splits off the FIRST token and returns the remainder, for the two-value keys
// (ASSIGN, ARGPARAM) whose second value may contain spaces.
void splitFirst(const std::string& s, std::string& head, std::string& tail) {
  splitKey(s, head, tail);
}

bool isExtensionKey(const std::string& key) {
  return key.size() > 2 && key[0] == 'X' && key[1] == '-';
}

std::string escapeText(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (const char c : s) {
    if (c == '\\') { out += "\\\\"; continue; }
    if (c == '\n') { out += "\\n"; continue; }
    if (c == '\r') { out += "\\r"; continue; }
    out.push_back(c);
  }
  return out;
}

std::string unescapeText(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (std::size_t i = 0; i < s.size(); ++i) {
    if (s[i] != '\\' || i + 1 >= s.size()) { out.push_back(s[i]); continue; }
    switch (s[++i]) {
      case 'n':  out.push_back('\n'); break;
      case 'r':  out.push_back('\r'); break;
      case '\\': out.push_back('\\'); break;
      // An unknown escape keeps BOTH characters. Dropping the backslash would
      // make write(read(x)) differ from x on a message that legitimately
      // contains one, and the round-trip check is the only thing that would
      // ever notice.
      default:   out.push_back('\\'); out.push_back(s[i]); break;
    }
  }
  return out;
}

bool parseDouble(const std::string& value, double& out) {
  if (value.empty()) return false;
  const char* begin = value.c_str();
  char* end = nullptr;
  const double v = std::strtod(begin, &end);
  if (end == begin || *end != '\0') return false;
  out = v;
  return true;
}

bool parseInt(const std::string& value, long& out) {
  if (value.empty()) return false;
  const char* begin = value.c_str();
  char* end = nullptr;
  const long v = std::strtol(begin, &end, 10);
  if (end == begin || *end != '\0') return false;
  out = v;
  return true;
}

bool kindFromName(const std::string& name, IrValueKind& out) {
  if (name == "none")    { out = IrValueKind::None;    return true; }
  if (name == "profile") { out = IrValueKind::Profile; return true; }
  if (name == "wire")    { out = IrValueKind::Wire;    return true; }
  if (name == "solid")   { out = IrValueKind::Solid;   return true; }
  return false;
}

std::string argLine(const IrArg& a) {
  switch (a.kind) {
    case IrArgKind::Number:  return "ARG num " + formatIrNumber(a.number);
    case IrArgKind::Ref:     return "ARG ref " + std::to_string(a.ref);
    case IrArgKind::Keyword: return "ARG kw " + a.word;
    case IrArgKind::Text:    return "ARG str " + a.word;
  }
  return "ARG kw INVALID";
}

bool argFromLine(const std::string& rest, IrArg& out, std::string& error) {
  std::string kind, value;
  splitKey(rest, kind, value);
  if (kind == "num") {
    double v = 0.0;
    if (!parseDouble(value, v)) { error = "ARG num is not a number: '" + value + "'"; return false; }
    out = IrArg::num(v);
    return true;
  }
  if (kind == "ref") {
    long v = 0;
    if (!parseInt(value, v) || v <= 0) {
      error = "ARG ref is not a positive statement id: '" + value + "'";
      return false;
    }
    out = IrArg::valueRef(static_cast<int>(v));
    return true;
  }
  if (kind == "kw") {
    if (value.empty()) { error = "ARG kw with no value"; return false; }
    out = IrArg::keyword(value);
    return true;
  }
  if (kind == "str") {
    out = IrArg::text(value);
    return true;
  }
  error = "unknown ARG kind '" + kind + "' (expected num|ref|kw|str)";
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

// ── the writer ──────────────────────────────────────────────────────────────
std::string writePartFile(const PartFileDoc& doc) {
  std::string out;
  out += std::string(kPartFileMagic) + " " + std::to_string(kPartFileVersion) + "\n";
  out += "NAME " + (doc.name.empty() ? std::string("untitled") : doc.name) + "\n";
  out += "UNITS " + (doc.units.empty() ? std::string("mm") : doc.units) + "\n";
  if (doc.rollbackAfter != PartDocument::kRollbackEnd) {
    out += "ROLLBACK " + std::to_string(doc.rollbackAfter) + "\n";
  }
  for (const std::string& x : doc.extensions) out += x + "\n";

  for (const Parameter& p : doc.parameters) {
    out += "PARAM\n";
    out += "PNAME " + p.name + "\n";
    out += "VALUE " + formatIrNumber(p.value) + "\n";
    if (!p.unit.empty()) out += "UNIT " + p.unit + "\n";
    if (!p.comment.empty()) out += "NOTE " + escapeText(p.comment) + "\n";
    out += "END\n";
  }
  for (const Material& m : doc.materials) {
    out += "MATERIAL\n";
    out += "MNAME " + m.name + "\n";
    out += "DENSITY " + formatIrNumber(m.density) + "\n";
    if (!m.standard.empty()) out += "STANDARD " + m.standard + "\n";
    if (!m.appearance.empty()) out += "APPEARANCE " + m.appearance + "\n";
    out += "END\n";
  }
  for (const auto& kv : doc.materialAssignments) {
    out += "ASSIGN " + kv.first + " " + kv.second + "\n";
  }

  for (const PartFileFeature& f : doc.features) {
    out += "FEATURE\n";
    out += "ID " + std::to_string(f.record.irId) + "\n";
    out += "KIND " + std::string(toString(f.record.produces)) + "\n";
    if (!f.record.persistentName.empty()) out += "TAG " + f.record.persistentName + "\n";
    for (const std::string& node : f.nodes) {
      if (!node.empty()) out += "NODE " + node + "\n";
    }
    if (!f.record.commandId.empty()) out += "COMMAND " + f.record.commandId + "\n";
    if (!f.record.label.empty()) out += "LABEL " + f.record.label + "\n";
    if (f.record.suppressed) out += "SUPPRESSED\n";
    out += "OP " + f.record.line.op + "\n";
    for (const IrArg& a : f.record.line.args) out += argLine(a) + "\n";
    for (const ArgParamBinding& b : f.record.argParams) {
      out += "ARGPARAM " + std::to_string(b.argIndex) + " " + b.parameter + "\n";
    }
    if (!f.record.verifierMessage.empty()) {
      out += "DIAG " + escapeText(f.record.verifierMessage) + "\n";
    }
    out += "END\n";
  }
  return out;
}

// ── the reader ──────────────────────────────────────────────────────────────
int partFileVersion(const std::string& text) {
  std::istringstream in(text);
  std::string raw;
  while (std::getline(in, raw)) {
    const std::string line = trim(raw);
    if (line.empty() || line[0] == '#') continue;
    std::string key, rest;
    splitKey(line, key, rest);
    if (key != kPartFileMagic) return 0;
    long v = 0;
    return parseInt(rest, v) ? static_cast<int>(v) : 0;
  }
  return 0;
}

namespace {
// Which block the reader is inside. A key is only legal in one of them, which is
// what lets PNAME and MNAME be different keys rather than one shared "name".
enum class Block { None, Param, Material, Feature };
}  // namespace

bool readPartFile(const std::string& text, PartFileDoc& out, std::string& error) {
  PartFileDoc doc;
  std::istringstream in(text);
  std::string raw;
  int lineNo = 0;
  bool sawHeader = false;
  Block block = Block::None;
  PartFileFeature feature;
  Parameter param;
  Material material;

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
      long version = 0;
      if (!parseInt(rest, version)) {
        return fail("the version on line 1 is not an integer: '" + rest + "'");
      }
      // THE VERSION POLICY, enforced. Older is upgraded (every v1 key means the
      // same thing here); newer is refused by name, because opening it would
      // mean loading half of someone's part and saving the half back.
      if (version < kPartFileMinReadVersion) {
        return fail("version " + std::to_string(version) + " predates the format (readable: " +
                    std::to_string(kPartFileMinReadVersion) + ".." +
                    std::to_string(kPartFileVersion) + ")");
      }
      if (version > kPartFileVersion) {
        return fail("this file was written by a newer Forge (format version " +
                    std::to_string(version) + "); this build reads " +
                    std::to_string(kPartFileMinReadVersion) + ".." +
                    std::to_string(kPartFileVersion));
      }
      sawHeader = true;
      continue;
    }

    // A `X-` line is a FUTURE version's field: never an error, always preserved.
    if (isExtensionKey(key)) {
      // Held per DOCUMENT, wherever they were read. Re-emitting a feature's
      // extension line inside the feature it came from would need a per-record
      // list this build cannot interpret anyway; keeping them at document level
      // preserves the DATA, which is the whole promise, and keeps the writer's
      // output order deterministic.
      doc.extensions.push_back(line);
      continue;
    }

    switch (block) {
      case Block::None:
        if (key == "NAME")  { doc.name = rest; continue; }
        if (key == "UNITS") { doc.units = rest; continue; }
        if (key == "ROLLBACK") {
          long v = 0;
          if (!parseInt(rest, v)) return fail("ROLLBACK is not an integer: '" + rest + "'");
          doc.rollbackAfter = static_cast<int>(v);
          continue;
        }
        if (key == "ASSIGN") {
          std::string node, mat;
          splitFirst(rest, node, mat);
          if (node.empty() || mat.empty()) {
            return fail("ASSIGN needs a node and a material name");
          }
          doc.materialAssignments[node] = mat;
          continue;
        }
        if (key == "PARAM")    { block = Block::Param;    param = Parameter{};        continue; }
        if (key == "MATERIAL") { block = Block::Material; material = Material{};      continue; }
        if (key == "FEATURE")  { block = Block::Feature;  feature = PartFileFeature{}; continue; }
        return fail("unexpected '" + key + "' outside a block");

      case Block::Param:
        if (key == "END") {
          if (param.name.empty()) return fail("PARAM block has no PNAME");
          doc.parameters.push_back(param);
          block = Block::None;
          continue;
        }
        if (key == "PNAME") { param.name = rest; continue; }
        if (key == "VALUE") {
          if (!parseDouble(rest, param.value)) {
            return fail("PARAM VALUE is not a number: '" + rest + "'");
          }
          continue;
        }
        if (key == "UNIT") { param.unit = rest; continue; }
        if (key == "NOTE") { param.comment = unescapeText(rest); continue; }
        return fail("unknown key '" + key + "' inside a PARAM block");

      case Block::Material:
        if (key == "END") {
          if (material.name.empty()) return fail("MATERIAL block has no MNAME");
          doc.materials.push_back(material);
          block = Block::None;
          continue;
        }
        if (key == "MNAME") { material.name = rest; continue; }
        if (key == "DENSITY") {
          if (!parseDouble(rest, material.density)) {
            return fail("MATERIAL DENSITY is not a number: '" + rest + "'");
          }
          continue;
        }
        if (key == "STANDARD")   { material.standard = rest; continue; }
        if (key == "APPEARANCE") { material.appearance = rest; continue; }
        return fail("unknown key '" + key + "' inside a MATERIAL block");

      case Block::Feature:
        if (key == "END") {
          if (feature.record.line.op.empty()) return fail("FEATURE block has no OP");
          if (feature.record.irId <= 0) return fail("FEATURE block has no ID");
          feature.record.line.id = feature.record.irId;
          doc.features.push_back(feature);
          block = Block::None;
          continue;
        }
        if (key == "ID") {
          long v = 0;
          if (!parseInt(rest, v) || v <= 0) return fail("ID is not a positive integer: '" + rest + "'");
          feature.record.irId = static_cast<int>(v);
          continue;
        }
        if (key == "KIND") {
          if (!kindFromName(rest, feature.record.produces)) {
            return fail("unknown KIND '" + rest + "' (expected none|profile|wire|solid)");
          }
          continue;
        }
        if (key == "TAG") {
          if (rest.empty()) return fail("TAG with no name");
          // Stored with the '@' the kernel's TAG(%body, "@name", ...) uses. A
          // file that omitted it names the same feature, not a second one.
          feature.record.persistentName = (rest[0] == '@') ? rest : ("@" + rest);
          continue;
        }
        if (key == "NODE") {
          if (!rest.empty()) feature.nodes.push_back(rest);
          continue;
        }
        if (key == "COMMAND")    { feature.record.commandId = rest; continue; }
        if (key == "LABEL")      { feature.record.label = rest; continue; }
        if (key == "SUPPRESSED") { feature.record.suppressed = true; continue; }
        if (key == "OP") {
          if (rest.empty()) return fail("OP with no name");
          feature.record.line.op = rest;
          continue;
        }
        if (key == "ARG") {
          IrArg arg;
          std::string why;
          if (!argFromLine(rest, arg, why)) return fail(why);
          feature.record.line.args.push_back(arg);
          continue;
        }
        if (key == "ARGPARAM") {
          std::string idx, name;
          splitFirst(rest, idx, name);
          long v = 0;
          if (!parseInt(idx, v) || v < 0) {
            return fail("ARGPARAM index is not a non-negative integer: '" + idx + "'");
          }
          if (name.empty()) return fail("ARGPARAM names no parameter");
          feature.record.argParams.push_back(
              ArgParamBinding{static_cast<std::size_t>(v), name});
          continue;
        }
        if (key == "DIAG") { feature.record.verifierMessage = unescapeText(rest); continue; }
        return fail("unknown key '" + key + "' inside a FEATURE block");
    }
  }

  if (!sawHeader) {
    error = "empty file: no " + std::string(kPartFileMagic) + " header";
    return false;
  }
  if (block != Block::None) {
    error = "file ends inside a block (truncated write?)";
    return false;
  }
  out = std::move(doc);
  error.clear();
  return true;
}

// ── document <-> file ───────────────────────────────────────────────────────
PartFileDoc capturePartDocument(const PartDocument& doc, const std::string& name) {
  PartFileDoc out;
  out.name = name.empty() ? doc.name() : name;
  if (out.name.empty()) out.name = "untitled";
  out.units = doc.units();
  out.rollbackAfter = doc.rollbackAfter();
  out.parameters = doc.parameters();
  out.materials = doc.materials();
  out.materialAssignments = doc.materialAssignments();

  // The reverse index of node -> value, built ONCE. std::map is ordered, so the
  // node list per feature is deterministic, and EVERY node is kept: a value two
  // nodes name is a value two nodes name.
  std::map<int, std::vector<std::string>> nodesOf;
  for (const auto& kv : doc.bindings()) nodesOf[kv.second].push_back(kv.first);

  for (const FeatureRecord& r : doc.records()) {
    PartFileFeature f;
    f.record = r;
    auto it = nodesOf.find(r.irId);
    if (it != nodesOf.end()) f.nodes = it->second;
    out.features.push_back(std::move(f));
  }
  return out;
}

bool restorePartDocument(const PartFileDoc& file, PartDocument& doc, std::string& error) {
  // One settle for the whole load. Without it a 100,000-statement file walks the
  // document 100,000 times on the way in.
  {
    PartDocument::BatchEdit hold(doc);
    doc.setName(file.name);
    if (!file.units.empty()) doc.setUnits(file.units);

    for (const Parameter& p : file.parameters) {
      if (!doc.setParameter(p)) {
        error = "parameter '" + p.name + "' is not a legal identifier";
        return false;
      }
    }
    for (const Material& m : file.materials) {
      if (!doc.setMaterial(m)) {
        error = "material block with an empty name";
        return false;
      }
    }

    for (const PartFileFeature& f : file.features) {
      if (f.record.irId != doc.nextIrId()) {
        // The ONE unrecoverable structural rule: ids are positions, so a file
        // whose statements arrive out of creation order does not describe the
        // program its own `%N`s spell. There is nothing to represent here -- the
        // meaning is gone, not broken.
        error = "statement %" + std::to_string(f.record.irId) +
                " is out of creation order (expected %" + std::to_string(doc.nextIrId()) + ")";
        return false;
      }
      if (!doc.adoptFeature(f.record, f.nodes)) {
        error = "statement %" + std::to_string(f.record.irId) + " (" + f.record.line.op +
                ") was refused: " + toString(doc.lastCheck());
        return false;
      }
    }

    // After the features, so a bar position and an assignment can both be
    // validated against a document that has its statements.
    if (file.rollbackAfter != PartDocument::kRollbackEnd) {
      doc.setRollbackAfter(file.rollbackAfter);
    }
    for (const auto& kv : file.materialAssignments) {
      if (!doc.assignMaterial(kv.first, kv.second)) {
        error = "'" + kv.first + "' is assigned material '" + kv.second +
                "', which this file does not define";
        return false;
      }
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

}  // namespace forge::ui
