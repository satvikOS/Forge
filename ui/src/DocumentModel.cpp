#include "forge/ui/DocumentModel.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/Units.hpp"

namespace forge::ui {
namespace {

// ── text hygiene ────────────────────────────────────────────────────────────
bool isSpace(char c) noexcept { return c == ' ' || c == '\t' || c == '\r'; }

std::string trim(const std::string& s) {
  std::size_t begin = 0;
  while (begin < s.size() && isSpace(s[begin])) ++begin;
  std::size_t end = s.size();
  while (end > begin && isSpace(s[end - 1])) --end;
  return s.substr(begin, end - begin);
}

// A stored value is one LINE, so a control byte inside it would end the record
// early and the file would come back a different document. Normalising on WRITE
// (rather than refusing on read) is what makes write(read(x)) == x hold for
// everything this writer can emit: the reader trims, so the writer must too.
std::string sanitise(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (char c : s) {
    const unsigned char u = static_cast<unsigned char>(c);
    out += (u < 0x20 || u == 0x7f) ? ' ' : c;
  }
  return trim(out);
}

void splitKey(const std::string& line, std::string& key, std::string& rest) {
  const std::size_t sp = line.find(' ');
  if (sp == std::string::npos) {
    key = line;
    rest.clear();
    return;
  }
  key = line.substr(0, sp);
  rest = trim(line.substr(sp + 1));
}

std::vector<std::string> words(const std::string& s) {
  std::vector<std::string> out;
  std::istringstream in(s);
  std::string w;
  while (in >> w) out.push_back(w);
  return out;
}

bool sameNumber(double a, double b) noexcept { return std::fabs(a - b) <= 1e-12; }

// ── EntityKind <-> text ─────────────────────────────────────────────────────
// Written against toString(EntityKind)'s own spellings. The gate asserts this
// mapping is TOTAL over every enumerator, so a kind added to Types.hpp without a
// row here is a red gate rather than a document that loses a name on save.
bool entityKindFromName(const std::string& name, EntityKind& out) noexcept {
  static const EntityKind kinds[] = {
      EntityKind::None,   EntityKind::Vertex,    EntityKind::Edge,   EntityKind::Face,
      EntityKind::Body,   EntityKind::Sketch,    EntityKind::SketchCurve, EntityKind::Wire,
      // Surface was MISSING, and the omission is the exact defect the comment
      // above describes: writeDocumentFile emits toString(ref.kind) for ANY kind,
      // so a named face of a SHEET saved a document this reader then refused with
      // "unknown KIND 'surface'". The two sketch-solver kinds are here for the
      // same reason, before a document can carry one.
      EntityKind::Surface, EntityKind::OpenSketch, EntityKind::SketchRef,
      EntityKind::Feature, EntityKind::Component, EntityKind::Datum,  EntityKind::Any};
  for (EntityKind k : kinds) {
    if (name == toString(k)) {
      out = k;
      return true;
    }
  }
  return false;
}

// TOTAL over IrValueKind, and it has to stay that way: a kind missing from this
// list is not a cosmetic gap, it is a document that will not open. `Surface` was
// missing -- this table was written when the IR had three value kinds, and the
// six ops that produce a SURFACE (SKIN / FACES / SEW / THICKEN / CAP /
// SURFCHECK) landed afterwards -- so every part containing one was refused on
// load with "unknown KIND 'surface'". document_round_trip_test.cpp now proves
// this mapping round-trips EVERY enumerator, so the next kind cannot repeat it.
bool valueKindFromName(const std::string& name, IrValueKind& out) noexcept {
  static const IrValueKind kinds[] = {IrValueKind::None, IrValueKind::Profile, IrValueKind::Wire,
                                      IrValueKind::Solid, IrValueKind::Surface};
  for (IrValueKind k : kinds) {
    if (name == toString(k)) {
      out = k;
      return true;
    }
  }
  return false;
}

// ── one IR argument, stored structurally ────────────────────────────────────
std::string argLine(const IrArg& a) {
  switch (a.kind) {
    // NOT formatIrNumber: see Units.hpp. A document that changes a value when it
    // is saved and reloaded has not round-tripped.
    case IrArgKind::Number: return "ARG num " + formatRoundTripNumber(a.number);
    case IrArgKind::Ref:    return "ARG ref " + std::to_string(a.ref);
    case IrArgKind::Keyword: return "ARG kw " + sanitise(a.word);
    case IrArgKind::Text:   return "ARG str " + sanitise(a.word);
    // A POINT RING, here for the same reason `Surface` is in valueKindFromName
    // above: an argument kind this writer can PRODUCE and this reader cannot READ
    // is a part that saves and will not open. This switch has no default on
    // purpose, so `Points` arriving in IrArgKind was a COMPILE ERROR rather than a
    // silent "ARG kw INVALID" three layers from the cause.
    //
    // `dim` is WRITTEN, never inferred. `[x y; ...]` and `[x y z; ...]` are
    // different tokens to forge::ft -- a 2D ring is lifted to z=0, a 3D one is
    // placed -- so a reader that guessed from the coordinate count would change
    // what the statement MEANS whenever a z rounded away.
    case IrArgKind::Points: {
      // THE SAME KIND TOKEN THE SHIPPED v1 WRITER USES (PartFile.cpp's
      // pointsLine): `pts2` / `pts3`, dimension IN THE NAME. A second spelling
      // here would read back as an unknown ARG kind on every v1 file that
      // contains a ring, which is this layer's whole failure mode. Only the
      // NUMBER FORMAT differs, and deliberately: v2 writes round-trip precision
      // where v1 wrote "%.10g", and parseIrPoints reads both with strtod.
      std::string line = (a.dim == 3) ? "ARG pts3 " : "ARG pts2 ";
      for (std::size_t i = 0; i < a.pts.size(); ++i) {
        if (i != 0) line += "; ";
        line += formatRoundTripNumber(a.pts[i].x);
        line += " " + formatRoundTripNumber(a.pts[i].y);
        if (a.dim == 3) line += " " + formatRoundTripNumber(a.pts[i].z);
      }
      return line;
    }
  }
  return "ARG kw INVALID";
}

bool argFromLine(const std::string& rest, IrArg& out, std::string& why) {
  std::string kind;
  std::string value;
  splitKey(rest, kind, value);
  if (kind == "num") {
    double v = 0.0;
    if (!parseRoundTripNumber(value, v)) {
      why = "ARG num is not a number: '" + value + "'";
      return false;
    }
    out = IrArg::num(v);
    return true;
  }
  if (kind == "ref") {
    double v = 0.0;
    if (!parseRoundTripNumber(value, v) || v < 1.0 || v != std::floor(v)) {
      why = "ARG ref is not a positive statement id: '" + value + "'";
      return false;
    }
    out = IrArg::valueRef(static_cast<int>(v));
    return true;
  }
  if (kind == "kw") {
    if (value.empty()) {
      why = "ARG kw with no value";
      return false;
    }
    out = IrArg::keyword(value);
    return true;
  }
  if (kind == "str") {
    out = IrArg::text(value);
    return true;
  }
  if (kind == "pts2" || kind == "pts3") {
    const int dim = (kind == "pts3") ? 3 : 2;
    const std::string& ring = value;
    // parseIrPoints returns EMPTY on anything it cannot read COMPLETELY -- a
    // short point, a non-finite coordinate -- so empty is the only failure signal
    // it has, and refusing here is what keeps a half-read ring out of the
    // document. An empty ring is also unwritable: forge::ft's lexer refuses the
    // literal `[]`, and the op-constraint bridge refuses it before that.
    std::vector<IrPoint> pts = parseIrPoints(ring, dim);
    if (pts.empty()) {
      why = "ARG " + kind + " ring is empty or unreadable: '" + ring + "'";
      return false;
    }
    out = IrArg::points(std::move(pts), dim);
    return true;
  }
  why = "unknown ARG kind '" + kind + "' (expected num|ref|kw|str|pts2|pts3)";
  return false;
}

// ── the per-key version table ───────────────────────────────────────────────
// Policy rule 5, made executable. `since` is the version that introduced the
// key; `until` is the last version that accepts it (0 = still current).
enum class KeyScope : std::uint8_t { Top, Feature, Parameter, Named };

struct KeySpec {
  const char* key;
  KeyScope scope;
  int since;
  int until;
};

const std::vector<KeySpec>& keyTable() {
  static const std::vector<KeySpec> table = {
      // v1
      {"NAME", KeyScope::Top, 1, 0},
      // v1 spelled the units as one word and meant BOTH storage and display by
      // it. Retired at v2, which separates the two; still readable in a v1 file.
      {"UNITS", KeyScope::Top, 1, 1},
      {"FEATURE", KeyScope::Top, 1, 0},
      {"ID", KeyScope::Feature, 1, 0},
      {"KIND", KeyScope::Feature, 1, 0},
      {"NODE", KeyScope::Feature, 1, 0},
      {"COMMAND", KeyScope::Feature, 1, 0},
      {"LABEL", KeyScope::Feature, 1, 0},
      {"OP", KeyScope::Feature, 1, 0},
      {"ARG", KeyScope::Feature, 1, 0},
      // END closes a block, and it is IN THIS TABLE for exactly the scopes a
      // block can be open in. It was missing entirely, which made findKey()
      // below refuse it in EVERY scope and turned the END handler at the bottom
      // of the reader into dead code: no file containing a single FEATURE block
      // -- that is, no file this writer has ever produced -- could be read back.
      // Absent from KeyScope::Top on purpose: an END at the top level closes
      // nothing, and that refusal is what the missing entry is supposed to mean.
      {"END", KeyScope::Feature, 1, 0},
      // v2
      {"STORAGE-LENGTH", KeyScope::Top, 2, 0},
      {"DISPLAY-LENGTH", KeyScope::Top, 2, 0},
      {"DISPLAY-ANGLE", KeyScope::Top, 2, 0},
      {"DISPLAY-MASS", KeyScope::Top, 2, 0},
      // ── the four material keys are `since = 1`, and that is not a typo ────
      // They were introduced here, at v2, and for a while only this writer
      // emitted them. The SHIPPED writer -- forge-desktop/src/PartFile.cpp, which
      // is what ForgeFrame::documentSave puts on a user's disk -- now stores the
      // part's material too, and it stores it under THESE names rather than a
      // second spelling of its own, because two vocabularies for one field is
      // exactly the drift ui/test/document_format_compat_test.cpp exists to
      // refuse. So a v1 file can carry them, and a reader that rejected them at
      // v1 would refuse a document the application had just written.
      //
      // Widening `since` is safe in the one direction that matters: a v1 file
      // written before the material existed simply has no such line, and the
      // reader's defaults already answer "no material chosen".
      {"MATERIAL-ID", KeyScope::Top, 1, 0},
      {"MATERIAL-NAME", KeyScope::Top, 1, 0},
      {"MATERIAL-DENSITY", KeyScope::Top, 1, 0},
      {"MATERIAL-APPEARANCE", KeyScope::Top, 1, 0},
      {"VIEW-EYE", KeyScope::Top, 2, 0},
      {"VIEW-TARGET", KeyScope::Top, 2, 0},
      {"VIEW-UP", KeyScope::Top, 2, 0},
      {"VIEW-FOV", KeyScope::Top, 2, 0},
      {"VIEW-ZOOM", KeyScope::Top, 2, 0},
      {"VIEW-PROJECTION", KeyScope::Top, 2, 0},
      {"VIEW-SHADING", KeyScope::Top, 2, 0},
      {"VIEW-GRID", KeyScope::Top, 2, 0},
      {"PARAMETER", KeyScope::Top, 2, 0},
      {"NAMED", KeyScope::Top, 2, 0},
      {"SUPPRESSED", KeyScope::Feature, 2, 0},
      {"PNAME", KeyScope::Parameter, 2, 0},
      {"PVALUE", KeyScope::Parameter, 2, 0},
      {"PEXPR", KeyScope::Parameter, 2, 0},
      {"PNOTE", KeyScope::Parameter, 2, 0},
      {"NNAME", KeyScope::Named, 2, 0},
      {"NBODY", KeyScope::Named, 2, 0},
      {"NKIND", KeyScope::Named, 2, 0},
      {"NPERSIST", KeyScope::Named, 2, 0},
      {"NGEN", KeyScope::Named, 2, 0},
      // The PARAMETER and NAMED blocks arrived in v2, so their END arrived with
      // them: an END inside a PARAMETER block in a file that declares v1 is a
      // v2 key in a v1 file, and rule 5 refuses it like any other.
      {"END", KeyScope::Parameter, 2, 0},
      {"END", KeyScope::Named, 2, 0},
  };
  return table;
}

const KeySpec* findKey(const std::string& key, KeyScope scope) {
  for (const KeySpec& s : keyTable()) {
    if (s.scope == scope && key == s.key) return &s;
  }
  return nullptr;
}

}  // namespace

// ── value-type comparisons ──────────────────────────────────────────────────
bool operator==(const Vec3& a, const Vec3& b) noexcept {
  return sameNumber(a.x, b.x) && sameNumber(a.y, b.y) && sameNumber(a.z, b.z);
}
bool operator!=(const Vec3& a, const Vec3& b) noexcept { return !(a == b); }

bool operator==(const DocumentUnits& a, const DocumentUnits& b) noexcept {
  return a.displayLength == b.displayLength && a.displayAngle == b.displayAngle &&
         a.displayMass == b.displayMass && a.storageLength == b.storageLength;
}
bool operator!=(const DocumentUnits& a, const DocumentUnits& b) noexcept { return !(a == b); }

bool operator==(const ViewState& a, const ViewState& b) noexcept {
  return a.eye == b.eye && a.target == b.target && a.up == b.up &&
         sameNumber(a.fieldOfViewDegrees, b.fieldOfViewDegrees) && sameNumber(a.zoom, b.zoom) &&
         a.orthographic == b.orthographic && a.wireframe == b.wireframe &&
         a.showGrid == b.showGrid;
}
bool operator!=(const ViewState& a, const ViewState& b) noexcept { return !(a == b); }

bool operator==(const DocumentParameter& a, const DocumentParameter& b) noexcept {
  return a.name == b.name && sameNumber(a.millimetres, b.millimetres) &&
         a.expression == b.expression && a.comment == b.comment;
}

bool operator==(const NamedEntity& a, const NamedEntity& b) noexcept {
  return a.name == b.name && a.ref == b.ref && a.ref.generation == b.ref.generation;
}

const char* toString(TreeEditStatus status) noexcept {
  switch (status) {
    case TreeEditStatus::Ok:                  return "ok";
    case TreeEditStatus::NoSuchFeature:       return "no_such_feature";
    case TreeEditStatus::DependencyViolation: return "dependency_violation";
    case TreeEditStatus::StillReferenced:     return "still_referenced";
    case TreeEditStatus::NoChange:            return "no_change";
    case TreeEditStatus::Refused:             return "refused";
    case TreeEditStatus::Deferred:            return "deferred to the end of the walk";
  }
  return "refused";
}

const std::vector<FormatVersionNote>& documentFormatHistory() {
  static const std::vector<FormatVersionNote> history = {
      {1,
       "FORGE-PART 1 -- NAME, UNITS (one word, meaning both storage and display), and "
       "FEATURE blocks (ID/KIND/NODE/COMMAND/LABEL/OP/ARG). No material, no view, no "
       "parameters, no named entities, no suppression."},
      {2,
       "FORGE-PART 2 -- adds STORAGE-LENGTH + DISPLAY-LENGTH/ANGLE/MASS (retiring UNITS), "
       "MATERIAL-ID/NAME/DENSITY/APPEARANCE, the VIEW-* block, PARAMETER and NAMED blocks, "
       "and per-feature SUPPRESSED. Upgrading a v1 file: UNITS <u> becomes STORAGE-LENGTH <u> "
       "and DISPLAY-LENGTH <u>; the material is 'unassigned' (density 0, so mass properties "
       "report unknown rather than 0 g); the view is the default camera; no parameters, no "
       "names, nothing suppressed."},
  };
  return history;
}

std::string DocumentIoError::describe() const {
  if (ok()) return "ok";
  if (line == 0) return message;
  return "line " + std::to_string(line) + ": " + message;
}

std::string DocumentFileData::irProgram() const {
  std::string out;
  for (const DocumentFeature& f : features) {
    out += f.record.line.text();
    out += "\n";
  }
  return out;
}

// ── the writer ──────────────────────────────────────────────────────────────
std::string writeDocumentFile(const DocumentFileData& data, const DocumentWriteOptions& options) {
  std::string out;
  out += std::string(kDocumentMagic) + " " + std::to_string(kDocumentFormatVersion) + "\n";
  const std::string name = sanitise(data.name);
  out += "NAME " + (name.empty() ? std::string("untitled") : name) + "\n";
  out += "STORAGE-LENGTH " + std::string(toString(data.units.storageLength)) + "\n";
  out += "DISPLAY-LENGTH " + std::string(toString(data.units.displayLength)) + "\n";
  out += "DISPLAY-ANGLE " + std::string(toString(data.units.displayAngle)) + "\n";
  out += "DISPLAY-MASS " + std::string(toString(data.units.displayMass)) + "\n";

  const std::string materialId = sanitise(data.material.id);
  out += "MATERIAL-ID " + (materialId.empty() ? std::string("unassigned") : materialId) + "\n";
  const std::string materialName = sanitise(data.material.name);
  if (!materialName.empty()) out += "MATERIAL-NAME " + materialName + "\n";
  out += "MATERIAL-DENSITY " + formatRoundTripNumber(data.material.densityKgPerM3) + "\n";
  out += "MATERIAL-APPEARANCE " + formatRoundTripNumber(data.material.appearance.red) + " " +
         formatRoundTripNumber(data.material.appearance.green) + " " +
         formatRoundTripNumber(data.material.appearance.blue) + " " +
         formatRoundTripNumber(data.material.appearance.metallic) + " " +
         formatRoundTripNumber(data.material.appearance.roughness) + " " +
         formatRoundTripNumber(data.material.appearance.opacity) + "\n";

  if (options.includeView) {
    const auto vec = [](const Vec3& v) {
      return formatRoundTripNumber(v.x) + " " + formatRoundTripNumber(v.y) + " " +
             formatRoundTripNumber(v.z);
    };
    out += "VIEW-EYE " + vec(data.view.eye) + "\n";
    out += "VIEW-TARGET " + vec(data.view.target) + "\n";
    out += "VIEW-UP " + vec(data.view.up) + "\n";
    out += "VIEW-FOV " + formatRoundTripNumber(data.view.fieldOfViewDegrees) + "\n";
    out += "VIEW-ZOOM " + formatRoundTripNumber(data.view.zoom) + "\n";
    out += std::string("VIEW-PROJECTION ") +
           (data.view.orthographic ? "orthographic" : "perspective") + "\n";
    out += std::string("VIEW-SHADING ") + (data.view.wireframe ? "wireframe" : "shaded") + "\n";
    out += std::string("VIEW-GRID ") + (data.view.showGrid ? "1" : "0") + "\n";
  }

  for (const DocumentParameter& p : data.parameters) {
    const std::string pname = sanitise(p.name);
    if (pname.empty()) continue;  // a nameless parameter is not a parameter
    out += "PARAMETER\n";
    out += "PNAME " + pname + "\n";
    out += "PVALUE " + formatRoundTripNumber(p.millimetres) + "\n";
    const std::string expression = sanitise(p.expression);
    if (!expression.empty()) out += "PEXPR " + expression + "\n";
    const std::string comment = sanitise(p.comment);
    if (!comment.empty()) out += "PNOTE " + comment + "\n";
    out += "END\n";
  }

  for (const NamedEntity& n : data.names) {
    const std::string label = sanitise(n.name);
    const std::string body = sanitise(n.ref.bodyId);
    if (label.empty() || body.empty()) continue;
    out += "NAMED\n";
    out += "NNAME " + label + "\n";
    out += "NBODY " + body + "\n";
    out += "NKIND " + std::string(toString(n.ref.kind)) + "\n";
    const std::string persistent = sanitise(n.ref.persistentName);
    if (!persistent.empty()) out += "NPERSIST " + persistent + "\n";
    out += "NGEN " + std::to_string(n.ref.generation) + "\n";
    out += "END\n";
  }

  for (const DocumentFeature& f : data.features) {
    out += "FEATURE\n";
    out += "ID " + std::to_string(f.record.irId) + "\n";
    out += "KIND " + std::string(toString(f.record.produces)) + "\n";
    const std::string node = sanitise(f.node);
    if (!node.empty()) out += "NODE " + node + "\n";
    const std::string command = sanitise(f.record.commandId);
    if (!command.empty()) out += "COMMAND " + command + "\n";
    const std::string label = sanitise(f.record.label);
    if (!label.empty()) out += "LABEL " + label + "\n";
    if (f.suppressed) out += "SUPPRESSED 1\n";
    out += "OP " + sanitise(f.record.line.op) + "\n";
    for (const IrArg& a : f.record.line.args) out += argLine(a) + "\n";
    out += "END\n";
  }
  return out;
}

// ── the reader ──────────────────────────────────────────────────────────────
bool readDocumentFile(const std::string& text, DocumentFileData& out, DocumentIoError& error) {
  DocumentFileData doc;
  std::istringstream in(text);
  std::string raw;
  std::size_t lineNo = 0;
  bool sawHeader = false;
  int version = 0;
  KeyScope scope = KeyScope::Top;

  DocumentFeature feature;
  DocumentParameter parameter;
  NamedEntity named;
  bool sawMaterialName = false;

  error = DocumentIoError{};
  const auto fail = [&error, &lineNo](const std::string& why) {
    error.message = why;
    error.line = lineNo;
    return false;
  };

  while (std::getline(in, raw)) {
    ++lineNo;
    const std::string line = trim(raw);
    if (line.empty() || line[0] == '#') continue;

    std::string key;
    std::string rest;
    splitKey(line, key, rest);

    if (!sawHeader) {
      if (key != kDocumentMagic) {
        return fail(std::string("not a ") + kDocumentExtension + " file (expected '" +
                    kDocumentMagic + " <version>', got '" + line + "')");
      }
      double raw_version = 0.0;
      if (!parseRoundTripNumber(rest, raw_version) || raw_version < 1.0 ||
          raw_version != std::floor(raw_version)) {
        return fail("the format version is not a positive integer: '" + rest + "'");
      }
      version = static_cast<int>(raw_version);
      error.fileVersion = version;
      // POLICY rules 2 and 3, stated in the refusal so the user knows what to do.
      if (version < kOldestReadableDocumentVersion) {
        return fail("file is version " + std::to_string(version) +
                    "; this build reads version " +
                    std::to_string(kOldestReadableDocumentVersion) + " and newer");
      }
      if (version > kDocumentFormatVersion) {
        return fail("file is version " + std::to_string(version) +
                    "; this build reads up to version " +
                    std::to_string(kDocumentFormatVersion) +
                    " -- open it with a newer Forge rather than losing what it holds");
      }
      sawHeader = true;
      doc.version = version;
      continue;
    }

    const KeySpec* spec = findKey(key, scope);
    if (spec == nullptr) {
      const char* where = scope == KeyScope::Top        ? "at the top level"
                          : scope == KeyScope::Feature  ? "inside a FEATURE block"
                          : scope == KeyScope::Parameter ? "inside a PARAMETER block"
                                                         : "inside a NAMED block";
      if (key == "END") return fail(std::string("END ") + where + " closes nothing");
      return fail("unknown key '" + key + "' " + where);
    }
    if (version < spec->since) {
      return fail("key '" + key + "' was introduced in format version " +
                  std::to_string(spec->since) + ", but this file declares version " +
                  std::to_string(version));
    }
    if (spec->until != 0 && version > spec->until) {
      return fail("key '" + key + "' was retired after format version " +
                  std::to_string(spec->until) + ", but this file declares version " +
                  std::to_string(version));
    }

    switch (scope) {
      case KeyScope::Top: {
        if (key == "NAME") {
          doc.name = rest;
        } else if (key == "UNITS") {
          // v1 upgrade rule: one word meant both.
          LengthUnit u = LengthUnit::Millimetre;
          if (!lengthUnitFromName(rest, u)) return fail("unknown length unit '" + rest + "'");
          doc.units.storageLength = u;
          doc.units.displayLength = u;
        } else if (key == "STORAGE-LENGTH" || key == "DISPLAY-LENGTH") {
          LengthUnit u = LengthUnit::Millimetre;
          if (!lengthUnitFromName(rest, u)) return fail("unknown length unit '" + rest + "'");
          if (key == "STORAGE-LENGTH") {
            doc.units.storageLength = u;
          } else {
            doc.units.displayLength = u;
          }
        } else if (key == "DISPLAY-ANGLE") {
          AngleUnit u = AngleUnit::Degree;
          if (!angleUnitFromName(rest, u)) return fail("unknown angle unit '" + rest + "'");
          doc.units.displayAngle = u;
        } else if (key == "DISPLAY-MASS") {
          MassUnit u = MassUnit::Gram;
          if (!massUnitFromName(rest, u)) return fail("unknown mass unit '" + rest + "'");
          doc.units.displayMass = u;
        } else if (key == "MATERIAL-ID") {
          doc.material.id = rest.empty() ? std::string("unassigned") : rest;
          if (!sawMaterialName) doc.material.name = doc.material.id;
        } else if (key == "MATERIAL-NAME") {
          doc.material.name = rest;
          sawMaterialName = true;
        } else if (key == "MATERIAL-DENSITY") {
          double v = 0.0;
          if (!parseRoundTripNumber(rest, v)) return fail("MATERIAL-DENSITY is not a number");
          if (v < 0.0) return fail("MATERIAL-DENSITY is negative");
          doc.material.densityKgPerM3 = v;
        } else if (key == "MATERIAL-APPEARANCE") {
          const std::vector<std::string> parts = words(rest);
          if (parts.size() != 6) {
            return fail("MATERIAL-APPEARANCE needs 6 numbers (r g b metallic roughness opacity), "
                        "got " + std::to_string(parts.size()));
          }
          double v[6] = {0, 0, 0, 0, 0, 0};
          for (std::size_t i = 0; i < 6; ++i) {
            if (!parseRoundTripNumber(parts[i], v[i])) {
              return fail("MATERIAL-APPEARANCE component " + std::to_string(i + 1) +
                          " is not a number: '" + parts[i] + "'");
            }
          }
          doc.material.appearance.red = v[0];
          doc.material.appearance.green = v[1];
          doc.material.appearance.blue = v[2];
          doc.material.appearance.metallic = v[3];
          doc.material.appearance.roughness = v[4];
          doc.material.appearance.opacity = v[5];
        } else if (key == "VIEW-EYE" || key == "VIEW-TARGET" || key == "VIEW-UP") {
          const std::vector<std::string> parts = words(rest);
          if (parts.size() != 3) {
            return fail(key + " needs 3 numbers, got " + std::to_string(parts.size()));
          }
          double v[3] = {0, 0, 0};
          for (std::size_t i = 0; i < 3; ++i) {
            if (!parseRoundTripNumber(parts[i], v[i])) {
              return fail(key + " component " + std::to_string(i + 1) + " is not a number: '" +
                          parts[i] + "'");
            }
          }
          Vec3& target = key == "VIEW-EYE"      ? doc.view.eye
                         : key == "VIEW-TARGET" ? doc.view.target
                                                : doc.view.up;
          target.x = v[0];
          target.y = v[1];
          target.z = v[2];
        } else if (key == "VIEW-FOV" || key == "VIEW-ZOOM") {
          double v = 0.0;
          if (!parseRoundTripNumber(rest, v)) return fail(key + " is not a number");
          if (key == "VIEW-FOV") {
            doc.view.fieldOfViewDegrees = v;
          } else {
            doc.view.zoom = v;
          }
        } else if (key == "VIEW-PROJECTION") {
          if (rest == "orthographic") {
            doc.view.orthographic = true;
          } else if (rest == "perspective") {
            doc.view.orthographic = false;
          } else {
            return fail("VIEW-PROJECTION must be 'perspective' or 'orthographic', got '" + rest +
                        "'");
          }
        } else if (key == "VIEW-SHADING") {
          if (rest == "wireframe") {
            doc.view.wireframe = true;
          } else if (rest == "shaded") {
            doc.view.wireframe = false;
          } else {
            return fail("VIEW-SHADING must be 'shaded' or 'wireframe', got '" + rest + "'");
          }
        } else if (key == "VIEW-GRID") {
          doc.view.showGrid = (rest == "1" || rest == "true");
        } else if (key == "FEATURE") {
          feature = DocumentFeature{};
          scope = KeyScope::Feature;
        } else if (key == "PARAMETER") {
          parameter = DocumentParameter{};
          scope = KeyScope::Parameter;
        } else if (key == "NAMED") {
          named = NamedEntity{};
          scope = KeyScope::Named;
        }
        break;
      }
      case KeyScope::Feature: {
        if (key == "ID") {
          double v = 0.0;
          if (!parseRoundTripNumber(rest, v) || v < 1.0 || v != std::floor(v)) {
            return fail("ID is not a positive statement id: '" + rest + "'");
          }
          feature.record.irId = static_cast<int>(v);
        } else if (key == "KIND") {
          if (!valueKindFromName(rest, feature.record.produces)) {
            return fail("unknown KIND '" + rest + "' (expected none|profile|wire|solid|surface)");
          }
        } else if (key == "NODE") {
          feature.node = rest;
        } else if (key == "COMMAND") {
          feature.record.commandId = rest;
        } else if (key == "LABEL") {
          feature.record.label = rest;
        } else if (key == "SUPPRESSED") {
          feature.suppressed = (rest == "1" || rest == "true");
        } else if (key == "OP") {
          if (rest.empty()) return fail("OP with no name");
          feature.record.line.op = rest;
        } else if (key == "ARG") {
          IrArg arg;
          std::string why;
          if (!argFromLine(rest, arg, why)) return fail(why);
          feature.record.line.args.push_back(arg);
        }
        break;
      }
      case KeyScope::Parameter: {
        if (key == "PNAME") {
          parameter.name = rest;
        } else if (key == "PVALUE") {
          double v = 0.0;
          if (!parseRoundTripNumber(rest, v)) return fail("PVALUE is not a number: '" + rest + "'");
          parameter.millimetres = v;
        } else if (key == "PEXPR") {
          parameter.expression = rest;
        } else if (key == "PNOTE") {
          parameter.comment = rest;
        }
        break;
      }
      case KeyScope::Named: {
        if (key == "NNAME") {
          named.name = rest;
        } else if (key == "NBODY") {
          named.ref.bodyId = rest;
        } else if (key == "NKIND") {
          if (!entityKindFromName(rest, named.ref.kind)) {
            return fail("unknown NKIND '" + rest + "'");
          }
        } else if (key == "NPERSIST") {
          named.ref.persistentName = rest;
        } else if (key == "NGEN") {
          double v = 0.0;
          if (!parseRoundTripNumber(rest, v) || v < 0.0 || v != std::floor(v)) {
            return fail("NGEN is not a non-negative integer: '" + rest + "'");
          }
          named.ref.generation = static_cast<std::uint64_t>(v);
        }
        break;
      }
    }

    // END closes whichever block is open. It is scope-checked above, so an END
    // at the top level is already a refusal.
    if (key == "END") {
      switch (scope) {
        case KeyScope::Feature:
          if (feature.record.line.op.empty()) return fail("FEATURE block has no OP");
          if (feature.record.irId <= 0) return fail("FEATURE block has no ID");
          feature.record.line.id = feature.record.irId;
          doc.features.push_back(feature);
          break;
        case KeyScope::Parameter:
          if (trim(parameter.name).empty()) return fail("PARAMETER block has no PNAME");
          doc.parameters.push_back(parameter);
          break;
        case KeyScope::Named:
          if (trim(named.name).empty()) return fail("NAMED block has no NNAME");
          if (trim(named.ref.bodyId).empty()) return fail("NAMED block has no NBODY");
          doc.names.push_back(named);
          break;
        case KeyScope::Top:
          break;  // unreachable: findKey refuses END at the top level
      }
      scope = KeyScope::Top;
    }
  }

  if (!sawHeader) {
    error.message = "empty file: no " + std::string(kDocumentMagic) + " header";
    error.line = 0;
    return false;
  }
  if (scope != KeyScope::Top) {
    error.message = "file ends inside an unterminated block (truncated write?)";
    error.line = lineNo;
    return false;
  }
  out = std::move(doc);
  error = DocumentIoError{};
  error.fileVersion = version;
  return true;
}

// ── the undoable edits ──────────────────────────────────────────────────────
// Both IGNORE the PartDocument& they are handed and mutate the DocumentModel
// they captured. That is what puts a units change and a fillet on ONE stack
// without changing the UndoableEdit contract or PartCommands.cpp.
class DocumentMetadataEdit final : public UndoableEdit {
 public:
  DocumentMetadataEdit(DocumentModel* model, DocumentModel::MetaState before,
                       DocumentModel::MetaState after, std::string label)
      : model_(model),
        before_(std::move(before)),
        after_(std::move(after)),
        label_(std::move(label)) {}

  const std::string& label() const noexcept override { return label_; }
  bool apply(PartDocument&) override {
    model_->installMeta(after_);
    return true;
  }
  void revert(PartDocument&) override { model_->installMeta(before_); }

 private:
  DocumentModel* model_;
  DocumentModel::MetaState before_;
  DocumentModel::MetaState after_;
  std::string label_;
};

class DocumentTreeEdit final : public UndoableEdit {
 public:
  DocumentTreeEdit(DocumentModel* model, DocumentModel::TreeState before,
                   DocumentModel::TreeState after, std::string label)
      : model_(model),
        before_(std::move(before)),
        after_(std::move(after)),
        label_(std::move(label)) {}

  const std::string& label() const noexcept override { return label_; }
  bool apply(PartDocument&) override {
    std::string why;
    // A refused apply is NOT pushed by UndoStack::perform, and installTree
    // builds the whole replacement before assigning it, so a refusal leaves the
    // document exactly as it was.
    return model_->installTree(after_, why);
  }
  void revert(PartDocument&) override {
    std::string why;
    model_->installTree(before_, why);
  }

 private:
  DocumentModel* model_;
  DocumentModel::TreeState before_;
  DocumentModel::TreeState after_;
  std::string label_;
};

// ── DocumentModel ───────────────────────────────────────────────────────────
DocumentModel::DocumentModel() { savedDigest_ = contentDigest(); }

DocumentModel::MetaState DocumentModel::captureMeta() const {
  MetaState s;
  s.name = name_;
  s.units = units_;
  s.material = material_;
  s.parameters = parameters_;
  s.names = names_;
  return s;
}

void DocumentModel::installMeta(const MetaState& state) {
  name_ = state.name;
  units_ = state.units;
  material_ = state.material;
  parameters_ = state.parameters;
  names_ = state.names;
}

DocumentModel::TreeState DocumentModel::captureTree() const {
  TreeState s;
  s.records = tree_.records();
  s.bindings = tree_.snapshot().bindings;
  s.suppressed = suppressed_;
  return s;
}

bool DocumentModel::installTree(const TreeState& state, std::string& error) {
  PartDocument fresh;
  for (std::size_t i = 0; i < state.records.size(); ++i) {
    FeatureRecord record = state.records[i];
    record.irId = static_cast<int>(i) + 1;
    record.line.id = record.irId;
    if (!fresh.appendFeature(record, {}, std::string())) {
      error = "statement %" + std::to_string(record.irId) + " (" + record.line.op +
              ") was refused by the document: " + toString(fresh.lastCheck());
      return false;
    }
  }
  // restore() with an unchanged record count rewrites the binding table and
  // nothing else -- the document's own published way to set one.
  PartDocument::Snapshot snapshot;
  snapshot.records = state.records.size();
  snapshot.bindings = state.bindings;
  fresh.restore(snapshot);

  tree_ = fresh;
  suppressed_ = state.suppressed;
  std::sort(suppressed_.begin(), suppressed_.end());
  suppressed_.erase(std::unique(suppressed_.begin(), suppressed_.end()), suppressed_.end());
  return true;
}

// A cheap, total identity for a state. Comparing serialised text rather than
// writing six operator== overloads means a field added to a state cannot be
// forgotten here -- it changes the text, so the comparison notices.
static std::string metaStateKey(const std::string& name, const DocumentUnits& units,
                                const Material& material,
                                const std::vector<DocumentParameter>& parameters,
                                const std::vector<NamedEntity>& names) {
  std::string key;
  key += name;
  key += "\x01";
  key += toString(units.storageLength);
  key += toString(units.displayLength);
  key += toString(units.displayAngle);
  key += toString(units.displayMass);
  key += "\x01";
  key += material.id;
  key += material.name;
  key += formatRoundTripNumber(material.densityKgPerM3);
  key += formatRoundTripNumber(material.appearance.red);
  key += formatRoundTripNumber(material.appearance.green);
  key += formatRoundTripNumber(material.appearance.blue);
  key += formatRoundTripNumber(material.appearance.metallic);
  key += formatRoundTripNumber(material.appearance.roughness);
  key += formatRoundTripNumber(material.appearance.opacity);
  for (const DocumentParameter& p : parameters) {
    key += "\x02";
    key += p.name;
    key += "=";
    key += formatRoundTripNumber(p.millimetres);
    key += "/";
    key += p.expression;
    key += "/";
    key += p.comment;
  }
  for (const NamedEntity& n : names) {
    key += "\x03";
    key += n.name;
    key += "=";
    key += n.ref.key();
    key += "/";
    key += std::to_string(n.ref.generation);
  }
  return key;
}

static std::string treeStateKey(const std::vector<FeatureRecord>& records,
                                const std::map<std::string, int>& bindings,
                                const std::vector<int>& suppressed) {
  std::string key;
  for (const FeatureRecord& r : records) {
    key += r.line.text();
    key += "\x01";
    key += r.commandId;
    key += "\x01";
    key += r.label;
    key += "\x01";
    key += toString(r.produces);
    key += "\n";
  }
  for (const auto& kv : bindings) {
    key += kv.first;
    key += "=";
    key += std::to_string(kv.second);
    key += ";";
  }
  key += "\x02";
  std::vector<int> ids = suppressed;
  std::sort(ids.begin(), ids.end());
  for (int id : ids) {
    key += std::to_string(id);
    key += ",";
  }
  return key;
}

bool DocumentModel::commitMeta(const MetaState& next) {
  const MetaState before = captureMeta();
  if (metaStateKey(before.name, before.units, before.material, before.parameters, before.names) ==
      metaStateKey(next.name, next.units, next.material, next.parameters, next.names)) {
    return false;  // a no-op edit is never pushed: Ctrl+Z must always do something
  }
  return undo_.perform(
      tree_, std::make_unique<DocumentMetadataEdit>(this, before, next, "Document Properties"));
}

bool DocumentModel::commitTree(const TreeState& next) {
  const TreeState before = captureTree();
  if (treeStateKey(before.records, before.bindings, before.suppressed) ==
      treeStateKey(next.records, next.bindings, next.suppressed)) {
    return false;
  }
  return undo_.perform(tree_,
                       std::make_unique<DocumentTreeEdit>(this, before, next, "Feature Tree"));
}

// ── metadata ────────────────────────────────────────────────────────────────
bool DocumentModel::setName(std::string value) {
  MetaState next = captureMeta();
  next.name = std::move(value);
  return commitMeta(next);
}

bool DocumentModel::setUnits(const DocumentUnits& value) {
  MetaState next = captureMeta();
  next.units = value;
  // The storage unit is not a user choice: this build stores millimetres, and a
  // document claiming otherwise would make every number in it mean something
  // else. Display units are entirely the user's.
  next.units.storageLength = kInternalLengthUnit;
  return commitMeta(next);
}

bool DocumentModel::setDisplayLengthUnit(LengthUnit unit) {
  DocumentUnits next = units_;
  next.displayLength = unit;
  return setUnits(next);
}

bool DocumentModel::setDisplayAngleUnit(AngleUnit unit) {
  DocumentUnits next = units_;
  next.displayAngle = unit;
  return setUnits(next);
}

bool DocumentModel::setDisplayMassUnit(MassUnit unit) {
  DocumentUnits next = units_;
  next.displayMass = unit;
  return setUnits(next);
}

bool DocumentModel::setMaterial(const Material& value) {
  MetaState next = captureMeta();
  next.material = value;
  return commitMeta(next);
}

bool DocumentModel::setMaterialById(const std::string& id) {
  const Material* found = findMaterial(id);
  if (found == nullptr) return false;
  return setMaterial(*found);
}

void DocumentModel::setView(const ViewState& value) { view_ = value; }

// ── unit-aware entry ────────────────────────────────────────────────────────
QuantityParse DocumentModel::parseLengthEntry(const std::string& text) const {
  return parseLength(text, units_.displayLength);
}

std::string DocumentModel::formatLengthForDisplay(double millimetres, int decimals) const {
  return formatLength(millimetres, units_.displayLength, decimals);
}

MassProperties DocumentModel::massProperties(double volumeMm3) const {
  return massPropertiesOf(material_, volumeMm3);
}

// ── parameters ──────────────────────────────────────────────────────────────
const DocumentParameter* DocumentModel::parameter(const std::string& name) const {
  for (const DocumentParameter& p : parameters_) {
    if (p.name == name) return &p;
  }
  return nullptr;
}

bool DocumentModel::setParameter(const std::string& name, const std::string& expression,
                                 std::string& error) {
  const std::string key = trim(name);
  if (key.empty()) {
    error = "a parameter needs a name";
    return false;
  }
  const QuantityParse parsed = parseLengthEntry(expression);
  if (!parsed.ok()) {
    error = std::string("cannot read '") + expression + "' as a length: " +
            toString(parsed.status);
    if (!parsed.offendingText.empty()) {
      error += " at offset " + std::to_string(parsed.offendingOffset) + " near '" +
               parsed.offendingText + "'";
    }
    return false;
  }
  MetaState next = captureMeta();
  DocumentParameter updated;
  updated.name = key;
  updated.millimetres = parsed.value;
  updated.expression = trim(expression);
  for (DocumentParameter& p : next.parameters) {
    if (p.name != key) continue;
    updated.comment = p.comment;  // an edit of the value keeps the note
    p = updated;
    error.clear();
    return commitMeta(next);
  }
  next.parameters.push_back(updated);
  std::sort(next.parameters.begin(), next.parameters.end(),
            [](const DocumentParameter& a, const DocumentParameter& b) { return a.name < b.name; });
  error.clear();
  return commitMeta(next);
}

bool DocumentModel::removeParameter(const std::string& name) {
  MetaState next = captureMeta();
  const std::size_t before = next.parameters.size();
  next.parameters.erase(std::remove_if(next.parameters.begin(), next.parameters.end(),
                                       [&name](const DocumentParameter& p) {
                                         return p.name == name;
                                       }),
                        next.parameters.end());
  if (next.parameters.size() == before) return false;
  return commitMeta(next);
}

// ── named entities ──────────────────────────────────────────────────────────
const EntityRef* DocumentModel::entityNamed(const std::string& name) const {
  for (const NamedEntity& n : names_) {
    if (n.name == name) return &n.ref;
  }
  return nullptr;
}

bool DocumentModel::nameEntity(const std::string& name, const EntityRef& ref) {
  const std::string key = trim(name);
  if (key.empty() || ref.bodyId.empty()) return false;
  MetaState next = captureMeta();
  for (NamedEntity& n : next.names) {
    if (n.name != key) continue;
    n.ref = ref;
    return commitMeta(next);
  }
  next.names.push_back(NamedEntity{key, ref});
  std::sort(next.names.begin(), next.names.end(),
            [](const NamedEntity& a, const NamedEntity& b) { return a.name < b.name; });
  return commitMeta(next);
}

bool DocumentModel::removeName(const std::string& name) {
  MetaState next = captureMeta();
  const std::size_t before = next.names.size();
  next.names.erase(
      std::remove_if(next.names.begin(), next.names.end(),
                     [&name](const NamedEntity& n) { return n.name == name; }),
      next.names.end());
  if (next.names.size() == before) return false;
  return commitMeta(next);
}

// ── feature-tree structure ──────────────────────────────────────────────────
bool DocumentModel::suppressed(int irId) const noexcept {
  return std::find(suppressed_.begin(), suppressed_.end(), irId) != suppressed_.end();
}

std::vector<int> DocumentModel::consumersOf(int irId) const {
  std::vector<int> out;
  for (const FeatureRecord& r : tree_.records()) {
    for (const IrArg& a : r.line.args) {
      if (a.kind == IrArgKind::Ref && a.ref == irId) {
        out.push_back(r.irId);
        break;
      }
    }
  }
  return out;
}

std::vector<int> DocumentModel::operandsOf(int irId) const {
  std::vector<int> out;
  const FeatureRecord* record = tree_.featureAt(irId);
  if (record == nullptr) return out;
  for (const IrArg& a : record->line.args) {
    if (a.kind == IrArgKind::Ref &&
        std::find(out.begin(), out.end(), a.ref) == out.end()) {
      out.push_back(a.ref);
    }
  }
  return out;
}

namespace {

// The transitive closure of a relation, breadth-first and duplicate-free.
template <typename Step>
std::vector<int> closure(int seed, Step step) {
  std::vector<int> found{seed};
  for (std::size_t i = 0; i < found.size(); ++i) {
    for (int next : step(found[i])) {
      if (std::find(found.begin(), found.end(), next) == found.end()) found.push_back(next);
    }
  }
  return found;
}

std::string describeStatement(const PartDocument& doc, int irId) {
  const FeatureRecord* r = doc.featureAt(irId);
  if (r == nullptr) return "%" + std::to_string(irId);
  return "%" + std::to_string(irId) + " (" + r->line.op + ")";
}

}  // namespace

// ── the walk, and the deferred structural edits ─────────────────────────────
void DocumentModel::beginWalk() noexcept { ++walkDepth_; }

std::size_t DocumentModel::endWalk() {
  if (walkDepth_ == 0) return 0;  // unbalanced close: never wrap below zero
  --walkDepth_;
  if (walkDepth_ != 0) return 0;  // an INNER walk closing applies nothing
  return applyPendingEdits();
}

void DocumentModel::noteWalkFailure(const char* what) noexcept {
  // Called from a destructor that is very possibly already unwinding. Recording
  // the failure allocates, so it can itself throw; letting that escape would be
  // the second throw and the terminate this whole path exists to avoid.
  try {
    pendingErrors_.push_back(std::string("closing the document walk failed: ") +
                             (what == nullptr ? "unknown" : what));
  } catch (...) {
    // Nothing further is safe to do here, and losing one message is strictly
    // better than losing the process.
  }
}

TreeEditStatus DocumentModel::defer(const PendingTreeEdit& edit) {
  pending_.push_back(edit);
  ++deferredTotal_;
  return TreeEditStatus::Deferred;
}

std::size_t DocumentModel::applyPendingEdits() {
  if (walkDepth_ != 0) return 0;  // never rebuild the tree while it is walked
  if (pending_.empty()) return 0;
  // SWAP FIRST. An edit that runs here can queue another (a cascade delete that
  // a listener responds to), and iterating the member vector while it grows is
  // the very defect this mechanism exists to prevent -- one level up.
  std::vector<PendingTreeEdit> queue;
  queue.swap(pending_);
  pendingErrors_.clear();
  std::size_t applied = 0;
  for (const PendingTreeEdit& e : queue) {
    TreeEditStatus status = TreeEditStatus::Ok;
    switch (e.kind) {
      case PendingTreeEdit::Kind::Suppress: status = setSuppressedNow(e.irId, e.flag); break;
      case PendingTreeEdit::Kind::Rename:   status = renameFeatureNow(e.irId, e.label); break;
      case PendingTreeEdit::Kind::Reorder:  status = reorderFeatureNow(e.irId, e.position); break;
      case PendingTreeEdit::Kind::Delete:   status = deleteFeatureNow(e.irId, e.policy); break;
    }
    if (status == TreeEditStatus::Ok) {
      ++applied;
      continue;
    }
    // The caller is no longer on the stack to be handed this, and a deferred
    // edit can still fail for a REAL reason -- a delete that strands a consumer,
    // a reorder that would put a statement before its operand. Dropping that
    // silently would make the deferral a lie, so it is recorded with the same
    // message the immediate call would have returned.
    pendingErrors_.push_back(describeStatement(tree_, e.irId) + ": " +
                             std::string(toString(status)) +
                             (treeError_.empty() ? std::string() : " -- " + treeError_));
  }
  return applied;
}

TreeEditStatus DocumentModel::setSuppressed(int irId, bool value) {
  if (walking()) {
    PendingTreeEdit e;
    e.kind = PendingTreeEdit::Kind::Suppress;
    e.irId = irId;
    e.flag = value;
    return defer(e);
  }
  return setSuppressedNow(irId, value);
}

TreeEditStatus DocumentModel::renameFeature(int irId, const std::string& label) {
  if (walking()) {
    PendingTreeEdit e;
    e.kind = PendingTreeEdit::Kind::Rename;
    e.irId = irId;
    e.label = label;
    return defer(e);
  }
  return renameFeatureNow(irId, label);
}

TreeEditStatus DocumentModel::reorderFeature(int irId, std::size_t toPosition) {
  if (walking()) {
    PendingTreeEdit e;
    e.kind = PendingTreeEdit::Kind::Reorder;
    e.irId = irId;
    e.position = toPosition;
    return defer(e);
  }
  return reorderFeatureNow(irId, toPosition);
}

TreeEditStatus DocumentModel::deleteFeature(int irId, DeletePolicy policy) {
  if (walking()) {
    PendingTreeEdit e;
    e.kind = PendingTreeEdit::Kind::Delete;
    e.irId = irId;
    e.policy = policy;
    return defer(e);
  }
  return deleteFeatureNow(irId, policy);
}

TreeEditStatus DocumentModel::setSuppressedNow(int irId, bool value) {
  treeError_.clear();
  cascade_.clear();
  if (tree_.featureAt(irId) == nullptr) {
    treeError_ = "%" + std::to_string(irId) + " names no statement in this document";
    return TreeEditStatus::NoSuchFeature;
  }

  // Suppressing takes every CONSUMER with it; unsuppressing brings back every
  // OPERAND. Either way the suppressed set stays dependency-closed, so
  // buildProgram() can never emit a reference to a statement that is not there.
  const std::vector<int> affected =
      value ? closure(irId, [this](int id) { return consumersOf(id); })
            : closure(irId, [this](int id) { return operandsOf(id); });

  TreeState next = captureTree();
  std::vector<int> updated = next.suppressed;
  for (int id : affected) {
    const bool present = std::find(updated.begin(), updated.end(), id) != updated.end();
    if (value && !present) {
      updated.push_back(id);
    } else if (!value && present) {
      updated.erase(std::remove(updated.begin(), updated.end(), id), updated.end());
    }
  }
  std::sort(updated.begin(), updated.end());
  next.suppressed = updated;

  for (int id : affected) {
    if (id != irId && suppressed(id) != value) cascade_.push_back(id);
  }

  if (!commitTree(next)) {
    cascade_.clear();
    treeError_ = describeStatement(tree_, irId) + " is already " +
                 (value ? "suppressed" : "active");
    return TreeEditStatus::NoChange;
  }
  return TreeEditStatus::Ok;
}

TreeEditStatus DocumentModel::renameFeatureNow(int irId, const std::string& label) {
  treeError_.clear();
  cascade_.clear();
  if (tree_.featureAt(irId) == nullptr) {
    treeError_ = "%" + std::to_string(irId) + " names no statement in this document";
    return TreeEditStatus::NoSuchFeature;
  }
  TreeState next = captureTree();
  for (FeatureRecord& r : next.records) {
    if (r.irId == irId) r.label = trim(label);
  }
  if (!commitTree(next)) return TreeEditStatus::NoChange;
  return TreeEditStatus::Ok;
}

bool DocumentModel::renumber(const std::vector<FeatureRecord>& ordered,
                             const std::map<std::string, int>& bindings,
                             const std::vector<int>& suppressedIds, TreeState& out,
                             std::string& error) const {
  std::map<int, int> remap;
  std::map<int, std::string> opOf;
  for (std::size_t i = 0; i < ordered.size(); ++i) {
    remap[ordered[i].irId] = static_cast<int>(i) + 1;
    opOf[ordered[i].irId] = ordered[i].line.op;
  }

  out = TreeState{};
  out.records.reserve(ordered.size());
  for (std::size_t i = 0; i < ordered.size(); ++i) {
    FeatureRecord record = ordered[i];
    const int oldId = record.irId;
    const int newId = static_cast<int>(i) + 1;
    for (IrArg& a : record.line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      const auto it = remap.find(a.ref);
      if (it == remap.end()) {
        // NAME the statement and the operand: a repair loop cannot act on
        // "invalid order".
        error = "%" + std::to_string(oldId) + " (" + record.line.op + ") references %" +
                std::to_string(a.ref) + ", which is not in the new order";
        return false;
      }
      if (it->second >= newId) {
        error = "%" + std::to_string(oldId) + " (" + record.line.op +
                ") would land at position " + std::to_string(newId) + ", at or before its operand %" +
                std::to_string(a.ref) + " (" + opOf[a.ref] + ") at position " +
                std::to_string(it->second) +
                "; a statement may only reference statements created before it";
        return false;
      }
      a.ref = it->second;
    }
    record.irId = newId;
    record.line.id = newId;
    out.records.push_back(record);
  }

  for (const auto& kv : bindings) {
    const auto it = remap.find(kv.second);
    if (it != remap.end()) out.bindings[kv.first] = it->second;
  }
  for (int id : suppressedIds) {
    const auto it = remap.find(id);
    if (it != remap.end()) out.suppressed.push_back(it->second);
  }
  std::sort(out.suppressed.begin(), out.suppressed.end());
  return true;
}

TreeEditStatus DocumentModel::reorderFeatureNow(int irId, std::size_t toPosition) {
  treeError_.clear();
  cascade_.clear();
  const std::vector<FeatureRecord>& records = tree_.records();
  std::size_t from = records.size();
  for (std::size_t i = 0; i < records.size(); ++i) {
    if (records[i].irId == irId) from = i;
  }
  if (from == records.size()) {
    treeError_ = "%" + std::to_string(irId) + " names no statement in this document";
    return TreeEditStatus::NoSuchFeature;
  }
  // TOLERATE an over-long position rather than refusing: "move it to the end" is
  // a perfectly clear request, and a refusal here would be a capability gate.
  std::size_t to = toPosition;
  if (to >= records.size()) to = records.size() - 1;
  if (to == from) {
    treeError_ = describeStatement(tree_, irId) + " is already at position " +
                 std::to_string(to);
    return TreeEditStatus::NoChange;
  }

  std::vector<FeatureRecord> ordered = records;
  const FeatureRecord moved = ordered[from];
  ordered.erase(ordered.begin() + static_cast<std::ptrdiff_t>(from));
  ordered.insert(ordered.begin() + static_cast<std::ptrdiff_t>(to), moved);

  TreeState next;
  if (!renumber(ordered, tree_.snapshot().bindings, suppressed_, next, treeError_)) {
    return TreeEditStatus::DependencyViolation;
  }
  if (!commitTree(next)) {
    treeError_ = "the reorder changed nothing";
    return TreeEditStatus::NoChange;
  }
  return TreeEditStatus::Ok;
}

TreeEditStatus DocumentModel::deleteFeatureNow(int irId, DeletePolicy policy) {
  treeError_.clear();
  cascade_.clear();
  if (tree_.featureAt(irId) == nullptr) {
    treeError_ = "%" + std::to_string(irId) + " names no statement in this document";
    return TreeEditStatus::NoSuchFeature;
  }

  const std::vector<int> consumers = consumersOf(irId);
  if (policy == DeletePolicy::RefuseIfReferenced && !consumers.empty()) {
    std::string names;
    for (std::size_t i = 0; i < consumers.size(); ++i) {
      if (i) names += ", ";
      names += describeStatement(tree_, consumers[i]);
    }
    treeError_ = describeStatement(tree_, irId) + " is consumed by " + names +
                 "; delete with cascade to remove them too";
    return TreeEditStatus::StillReferenced;
  }

  const std::vector<int> victims =
      policy == DeletePolicy::Cascade
          ? closure(irId, [this](int id) { return consumersOf(id); })
          : std::vector<int>{irId};

  std::vector<FeatureRecord> ordered;
  for (const FeatureRecord& r : tree_.records()) {
    if (std::find(victims.begin(), victims.end(), r.irId) == victims.end()) ordered.push_back(r);
  }

  TreeState next;
  if (!renumber(ordered, tree_.snapshot().bindings, suppressed_, next, treeError_)) {
    return TreeEditStatus::DependencyViolation;
  }
  for (int id : victims) {
    if (id != irId) cascade_.push_back(id);
  }
  std::sort(cascade_.begin(), cascade_.end());
  if (!commitTree(next)) {
    cascade_.clear();
    treeError_ = "the delete changed nothing";
    return TreeEditStatus::NoChange;
  }
  return TreeEditStatus::Ok;
}

// ── programs ────────────────────────────────────────────────────────────────
std::string DocumentModel::irProgram() const { return tree_.irProgram(); }

std::string DocumentModel::buildProgram() const {
  if (suppressed_.empty()) return tree_.irProgram();
  std::map<int, int> remap;
  int next = 0;
  for (const FeatureRecord& r : tree_.records()) {
    if (suppressed(r.irId)) continue;
    remap[r.irId] = ++next;
  }
  std::string out;
  for (const FeatureRecord& r : tree_.records()) {
    const auto it = remap.find(r.irId);
    if (it == remap.end()) continue;
    IrLine line = r.line;
    line.id = it->second;
    for (IrArg& a : line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      const auto ref = remap.find(a.ref);
      // Suppression is dependency-closed (setSuppressed cascades), so this
      // cannot fire from a live document; leaving the ref alone rather than
      // dropping the statement keeps a hand-built state debuggable.
      if (ref != remap.end()) a.ref = ref->second;
    }
    out += line.text();
    out += "\n";
  }
  return out;
}

// ── dirty ───────────────────────────────────────────────────────────────────
std::string DocumentModel::contentDigest() const {
  DocumentWriteOptions options;
  options.includeView = false;
  return writeDocumentFile(capture(), options);
}

bool DocumentModel::dirty() const { return contentDigest() != savedDigest_; }

void DocumentModel::markSaved() { savedDigest_ = contentDigest(); }

// ── whole-document moves ────────────────────────────────────────────────────
DocumentFileData DocumentModel::capture() const {
  DocumentFileData data;
  data.version = kDocumentFormatVersion;
  data.name = name_;
  data.units = units_;
  data.material = material_;
  data.view = view_;
  data.parameters = parameters_;
  data.names = names_;

  const std::map<std::string, int> bindings = tree_.snapshot().bindings;
  for (const FeatureRecord& r : tree_.records()) {
    DocumentFeature f;
    f.record = r;
    f.suppressed = suppressed(r.irId);
    for (const auto& kv : bindings) {
      if (kv.second == r.irId) {
        f.node = kv.first;  // std::map is ordered, so this choice is deterministic
        break;
      }
    }
    data.features.push_back(std::move(f));
  }
  return data;
}

bool DocumentModel::restore(const DocumentFileData& data, std::string& error) {
  TreeState state;
  for (std::size_t i = 0; i < data.features.size(); ++i) {
    const DocumentFeature& f = data.features[i];
    const int expected = static_cast<int>(i) + 1;
    if (f.record.irId != expected) {
      error = "statement %" + std::to_string(f.record.irId) +
              " is out of creation order (expected %" + std::to_string(expected) + ")";
      return false;
    }
    state.records.push_back(f.record);
    if (!f.node.empty()) state.bindings[f.node] = f.record.irId;
    if (f.suppressed) state.suppressed.push_back(f.record.irId);
  }

  // Built into a FRESH document first: a file that is well-formed but not a
  // legal document must not half-replace the one that is open.
  DocumentModel candidate;
  if (!candidate.installTree(state, error)) return false;

  tree_ = candidate.tree_;
  suppressed_ = candidate.suppressed_;
  name_ = data.name.empty() ? std::string("untitled") : data.name;
  units_ = data.units;
  units_.storageLength = kInternalLengthUnit;  // this build stores millimetres
  material_ = data.material;
  view_ = data.view;
  parameters_ = data.parameters;
  names_ = data.names;
  // Opening is not an edit: undoing past an Open into the previous document's
  // history is how a modeller loses a part.
  undo_.clear();
  treeError_.clear();
  cascade_.clear();
  markSaved();
  error.clear();
  return true;
}

void DocumentModel::reset() {
  tree_ = PartDocument{};
  undo_.clear();
  name_ = "untitled";
  units_ = DocumentUnits{};
  material_ = Material{};
  view_ = ViewState{};
  parameters_.clear();
  names_.clear();
  suppressed_.clear();
  treeError_.clear();
  cascade_.clear();
  markSaved();
}

bool DocumentModel::load(const std::string& text, DocumentIoError& error) {
  DocumentFileData data;
  if (!readDocumentFile(text, data, error)) return false;
  std::string why;
  if (!restore(data, why)) {
    error.message = why;
    error.line = 0;
    return false;
  }
  return true;
}

DocumentFileData captureDocument(const DocumentModel& model) { return model.capture(); }

bool restoreDocument(const DocumentFileData& data, DocumentModel& model, std::string& error) {
  return model.restore(data, error);
}

}  // namespace forge::ui
