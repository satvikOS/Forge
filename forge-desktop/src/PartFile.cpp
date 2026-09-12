#include "PartFile.hpp"

#include "forge/ui/Units.hpp"

#include <fcntl.h>
#include <unistd.h>

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <system_error>
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


// ── the drawing blocks (format version 2) ───────────────────────────────────
//
// One key per line, values written VERBATIM after the key, so a note keeps its
// interior spacing. Two rules make write(read(x)) == x byte for byte:
//   * every free-text value is SANITISED on the way out -- control characters
//     become spaces and the ends are trimmed -- because the reader trims, and a
//     value the reader would change is a value the file does not round-trip.
//   * an EMPTY value is not written at all, and reads back empty.
std::string sanitizeValue(const std::string& in) {
  std::string out;
  out.reserve(in.size());
  for (char c : in) {
    const unsigned char u = static_cast<unsigned char>(c);
    out.push_back(u < 0x20 || u == 0x7f ? ' ' : c);
  }
  return trim(out);
}

void writeField(std::string& out, const char* key, const std::string& value) {
  const std::string v = sanitizeValue(value);
  if (v.empty()) return;
  out += key;
  out += ' ';
  out += v;
  out += '\n';
}

// An entity reference, one key per field so a name containing a space is safe.
void writeRef(std::string& out, const forge::ui::EntityRef& ref) {
  if (!ref.valid()) return;
  writeField(out, "TARGETKIND", forge::ui::toString(ref.kind));
  writeField(out, "TARGETBODY", ref.bodyId);
  writeField(out, "TARGETNAME", ref.persistentName);
  // ADDITIVE. The durable geometric identity of the face, written only when known,
  // so a file saved by this build still opens on one that predates signatures and
  // a file saved before them still opens here. TARGETNAME stays the label; this is
  // what resolution actually prefers.
  writeField(out, "TARGETSIG", ref.signature);
  if (ref.generation != 0) {
    out += "TARGETGEN " + std::to_string(ref.generation) + "\n";
  }
}

// The inverse of forge::ui::toString(EntityKind), DERIVED from it rather than
// written out a second time: an if-chain over the spellings someone remembered
// is how a kind that stops loading gets shipped. `Any` is a signature wildcard
// and is deliberately not a storable reference kind.
bool entityKindFromName(const std::string& name, forge::ui::EntityKind& out) {
  for (int i = 0; i <= static_cast<int>(forge::ui::EntityKind::Any); ++i) {
    const forge::ui::EntityKind k = static_cast<forge::ui::EntityKind>(i);
    if (k == forge::ui::EntityKind::Any) continue;
    if (name == forge::ui::toString(k)) {
      out = k;
      return true;
    }
  }
  return false;
}

std::string drawingText(const forge::ui::DrawingModel& d) {
  std::string out;
  const forge::ui::TitleBlockData& t = d.titleBlock();
  out += "TITLEBLOCK\n";
  writeField(out, "PARTNUMBER", t.partNumber);
  writeField(out, "TITLE", t.title);
  writeField(out, "REVISION", t.revision);
  writeField(out, "AUTHOR", t.author);
  writeField(out, "APPROVED", t.approvedBy);
  writeField(out, "COMPANY", t.company);
  writeField(out, "MATERIAL", t.material);
  writeField(out, "FINISH", t.finish);
  writeField(out, "SHEET", t.sheetId);
  writeField(out, "PROJECTION", forge::ui::toString(t.projection));
  writeField(out, "SCALEMODE", forge::ui::toString(t.scaleMode));
  writeField(out, "SCALE", t.fixedScale.text());
  out += "END\n";

  for (const forge::ui::DatumFeature& dat : d.datums()) {
    out += "DATUM\n";
    out += std::string("LETTER ") + dat.letter + "\n";
    writeRef(out, dat.target);
    writeField(out, "LABEL", dat.targetLabel);
    out += "END\n";
  }
  for (const forge::ui::Annotation& a : d.annotations()) {
    out += "NOTE\n";
    writeField(out, "ID", a.id);
    writeField(out, "KIND", forge::ui::toString(a.kind));
    writeField(out, "VIEW", forge::ui::commandSuffix(a.view));
    writeField(out, "TEXT", a.text);
    writeRef(out, a.target);
    out += "END\n";
  }
  for (const forge::ui::FeatureControlFrame& f : d.frames()) {
    out += "CONTROL\n";
    writeField(out, "ID", f.id);
    writeField(out, "CHAR", forge::ui::toString(f.characteristic));
    out += "TOL " + forge::ui::formatIrNumber(f.toleranceMm) + "\n";
    if (f.characteristic == forge::ui::GdtCharacteristic::Angularity) {
      out += "BASIC " + forge::ui::formatIrNumber(f.basicAngleDeg) + "\n";
    }
    if (f.diametralZone) out += "ZONE diametral\n";
    writeField(out, "MOD", forge::ui::toString(f.modifier));
    writeField(out, "FEATURE", forge::ui::toString(f.feature));
    if (!f.datumRefs.empty()) {
      out += "DATUMS " + std::string(f.datumRefs.begin(), f.datumRefs.end()) + "\n";
    }
    writeRef(out, f.target);
    writeField(out, "LABEL", f.targetLabel);
    out += "END\n";
  }
  return out;
}

}  // namespace

bool partFileVersionIsReadable(int version) noexcept {
  return version == 1 || version == kPartFileDrawingVersion || version == kPartFileVersion;
}

namespace {

// The accepted set, spelled for a REFUSAL to quote. It used to be written into
// each message as "version 1 and version <current>", which was true while the
// set had two members and became a sentence that omits 3 the moment it had
// three -- a refusal that misstates what the build can read is worse than a
// terse one, because the user acts on it.
std::string readableVersions() {
  std::string out;
  for (int v = kOldestReadablePartFileVersion; v <= kPartFileVersion; ++v) {
    if (!partFileVersionIsReadable(v)) continue;
    if (!out.empty()) out += ", ";
    out += std::to_string(v);
  }
  return out;
}

}  // namespace

std::string absolutePartPath(const std::string& path) {
  if (path.empty() || path[0] == '/') return path;
  std::error_code ec;
  const std::filesystem::path cwd = std::filesystem::current_path(ec);
  if (ec) return path;  // nothing to resolve against; the caller keeps what it has
  std::string base = cwd.string();
  while (base.size() > 1 && base.back() == '/') base.pop_back();
  return base + "/" + path;
}

bool partFileBindsInput(const PartFileDoc& doc) noexcept {
  // The op name is spelled ONCE in this system outside the kernel's own table.
  // `INPUT()` is the only op that reads a file, and forge::ui::FeatureIr gives
  // it arity 0..0, so "does this document need an input file" is exactly "is
  // this op present".
  for (const PartFileFeature& f : doc.features) {
    if (f.record.line.op == "INPUT") return true;
  }
  return false;
}

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
  // ── WHERE AN IMPORTED BODY CAME FROM (format version 4) ───────────────────
  //
  // Written only when the document binds one, so a .fpart saved from a document
  // with no `INPUT()` is byte-identical to what the previous writer produced --
  // the same rule the material follows two blocks down.
  //
  // ── ★ AND WRITTEN VERBATIM, WHICH IS WHY IT IS NOT writeField ────────────
  // Every other free-text value in this format goes through sanitizeValue:
  // control characters become spaces and the ends are trimmed, because the
  // reader trims and a value the reader would change is a value the file does
  // not round-trip. A PATH is the one value where that rule is wrong, because
  // the value is not text the file is describing -- it is a NAME the app is
  // going to hand back to the operating system.
  //
  // MEASURED, on this tree, with the sanitised writer: a source file whose
  // folder name contained a TAB was written out with a SPACE in its place, and
  // the reopen refused the document with "Forge cannot read it any more",
  // naming a path no file has ever had, about a file that had never moved. The
  // only byte a line-based format truly cannot carry is the line break, and
  // FileExchangeHost refuses a path containing one before it can ever be bound
  // (pathIsOneLine), so what reaches here is already carriable as it stands.
  // The reader takes this value back off the raw line for the same reason.
  if (!doc.inputFile.empty()) {
    out += "INPUT-FILE ";
    out += doc.inputFile;
    out += '\n';
  }
  out += drawingText(doc.drawing);
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
  int fileVersion = kPartFileVersion;
  bool inFeature = false;
  PartFileFeature current;

  // The drawing, accumulated block by block. Held in locals rather than being
  // pushed into `doc.drawing` as it is read, because a file that fails halfway
  // must not half-replace anything -- the same rule the feature list follows.
  enum class Block { None, TitleBlock, Datum, Note, Control };
  Block block = Block::None;
  forge::ui::TitleBlockData title;
  std::vector<forge::ui::DatumFeature> datums;
  std::vector<forge::ui::Annotation> notes;
  std::vector<forge::ui::FeatureControlFrame> controls;
  forge::ui::DatumFeature curDatum;
  forge::ui::Annotation curNote;
  forge::ui::FeatureControlFrame curControl;
  forge::ui::EntityRef curRef;

  const auto refKey = [&curRef](const std::string& key, const std::string& rest,
                                std::string& why) -> int {
    // 1 = consumed, 0 = not a reference key, -1 = consumed but malformed.
    if (key == "TARGETKIND") {
      if (!entityKindFromName(rest, curRef.kind)) {
        why = "unknown TARGETKIND '" + rest + "'";
        return -1;
      }
      return 1;
    }
    if (key == "TARGETBODY") { curRef.bodyId = rest; return 1; }
    if (key == "TARGETNAME") { curRef.persistentName = rest; return 1; }
    if (key == "TARGETSIG") { curRef.signature = rest; return 1; }
    if (key == "TARGETGEN") {
      char* end = nullptr;
      const unsigned long long g = std::strtoull(rest.c_str(), &end, 10);
      if (end == rest.c_str() || *end != 0) {
        why = "TARGETGEN is not a whole number: " + rest;
        return -1;
      }
      curRef.generation = static_cast<std::uint64_t>(g);
      return 1;
    }
    return 0;
  };

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
      if (version == 2) {
        // Named rather than lumped in with "unsupported": a version 2 file under
        // this magic is a well-formed document written by the other layer, and
        // telling its owner it is corrupt would be false.
        return fail("this file is version 2, which is written by the document layer and uses "
                    "different records; this build reads versions " +
                    readableVersions());
      }
      if (!partFileVersionIsReadable(version)) {
        return fail("unsupported version " + rest + " (this build reads versions " +
                    readableVersions() + ")");
      }
      fileVersion = version;
      sawHeader = true;
      continue;
    }

    // ── the version-2 drawing blocks ────────────────────────────────────────
    if (block != Block::None) {
      if (key == "END") {
        switch (block) {
          case Block::Datum:
            curDatum.target = curRef;
            if (curDatum.letter == 0) return fail("DATUM block has no LETTER");
            datums.push_back(curDatum);
            break;
          case Block::Note:
            curNote.target = curRef;
            if (curNote.text.empty()) return fail("NOTE block has no TEXT");
            if (curNote.id.empty()) return fail("NOTE block has no ID");
            notes.push_back(curNote);
            break;
          case Block::Control:
            curControl.target = curRef;
            if (curControl.id.empty()) return fail("CONTROL block has no ID");
            if (!(curControl.toleranceMm > 0.0)) return fail("CONTROL block has no TOL");
            controls.push_back(curControl);
            break;
          case Block::TitleBlock:
          case Block::None:
            break;
        }
        block = Block::None;
        continue;
      }
      std::string why;
      const int consumed = refKey(key, rest, why);
      if (consumed < 0) return fail(why);
      if (consumed > 0) continue;

      if (block == Block::TitleBlock) {
        if (key == "PARTNUMBER") { title.partNumber = rest; continue; }
        if (key == "TITLE") { title.title = rest; continue; }
        if (key == "REVISION") { title.revision = rest; continue; }
        if (key == "AUTHOR") { title.author = rest; continue; }
        if (key == "APPROVED") { title.approvedBy = rest; continue; }
        if (key == "COMPANY") { title.company = rest; continue; }
        if (key == "MATERIAL") { title.material = rest; continue; }
        if (key == "FINISH") { title.finish = rest; continue; }
        if (key == "SHEET") { title.sheetId = rest; continue; }
        if (key == "PROJECTION") {
          if (!forge::ui::projectionAngleFromName(rest, title.projection)) {
            return fail("unknown PROJECTION '" + rest + "' (expected first|third)");
          }
          continue;
        }
        if (key == "SCALEMODE") {
          if (!forge::ui::scaleModeFromName(rest, title.scaleMode)) {
            return fail("unknown SCALEMODE '" + rest + "' (expected automatic|fixed)");
          }
          continue;
        }
        if (key == "SCALE") {
          if (!forge::ui::scaleFromText(rest, title.fixedScale)) {
            return fail("SCALE is not a ratio like 1:2: " + rest);
          }
          continue;
        }
        return fail("unknown key '" + key + "' inside a TITLEBLOCK block");
      }
      if (block == Block::Datum) {
        if (key == "LETTER") {
          if (rest.size() != 1) return fail("LETTER takes one letter: " + rest);
          curDatum.letter = rest[0];
          continue;
        }
        if (key == "LABEL") { curDatum.targetLabel = rest; continue; }
        return fail("unknown key '" + key + "' inside a DATUM block");
      }
      if (block == Block::Note) {
        if (key == "ID") { curNote.id = rest; continue; }
        if (key == "KIND") {
          if (!forge::ui::annotationKindFromName(rest, curNote.kind)) {
            return fail("unknown note KIND '" + rest + "'");
          }
          continue;
        }
        if (key == "VIEW") {
          if (!forge::ui::namedViewFromSuffix(rest, curNote.view)) {
            return fail("unknown VIEW '" + rest + "'");
          }
          continue;
        }
        if (key == "TEXT") { curNote.text = rest; continue; }
        return fail("unknown key '" + key + "' inside a NOTE block");
      }
      // Block::Control
      if (key == "ID") { curControl.id = rest; continue; }
      if (key == "CHAR") {
        if (!forge::ui::gdtCharacteristicFromName(rest, curControl.characteristic)) {
          return fail("unknown control CHAR '" + rest + "'");
        }
        continue;
      }
      if (key == "TOL" || key == "BASIC") {
        const char* begin = rest.c_str();
        char* end = nullptr;
        const double value = std::strtod(begin, &end);
        if (end == begin || *end != 0) return fail(key + " is not a number: " + rest);
        if (key == "TOL") {
          curControl.toleranceMm = value;
        } else {
          curControl.basicAngleDeg = value;
        }
        continue;
      }
      if (key == "ZONE") {
        if (rest != "diametral") return fail("unknown ZONE '" + rest + "' (expected diametral)");
        curControl.diametralZone = true;
        continue;
      }
      if (key == "MOD") {
        if (!forge::ui::materialModifierFromName(rest, curControl.modifier)) {
          return fail("unknown MOD '" + rest + "'");
        }
        continue;
      }
      if (key == "FEATURE") {
        if (!forge::ui::controlledFeatureKindFromName(rest, curControl.feature)) {
          return fail("unknown control FEATURE '" + rest + "'");
        }
        continue;
      }
      if (key == "DATUMS") {
        curControl.datumRefs.assign(rest.begin(), rest.end());
        continue;
      }
      if (key == "LABEL") { curControl.targetLabel = rest; continue; }
      return fail("unknown key '" + key + "' inside a CONTROL block");
    }

    if (!inFeature) {
      if (key == "NAME") { doc.name = rest; continue; }
      if (key == "UNITS") { doc.units = rest; continue; }
      if (key == "INPUT-FILE") {
        // ADDITIVE-ONLY, enforced the way the drawing blocks are: this key was
        // introduced in version 4, so a file that CLAIMS an older version and
        // carries one has been hand-edited or half-written.
        if (fileVersion < kPartFileInputVersion) {
          return fail("'INPUT-FILE' was added in format version " +
                      std::to_string(kPartFileInputVersion) +
                      ", but this file says it is version " + std::to_string(fileVersion));
        }
        // An empty value is a file that names no file, which is not the same
        // fact as omitting the key -- and it is not a path. The writer never
        // emits one, so reading it would be inventing a meaning.
        if (rest.empty()) return fail("INPUT-FILE with no path");
        // ── ★ TAKEN OFF THE RAW LINE, NOT OFF THE TRIMMED ONE ──────────────
        // `rest` has been through trim() twice by now, and a path is the one
        // value in this format that must come back exactly as it went in: see
        // the writer's note. Everything after the single space that follows the
        // key is the path, including tabs, including leading and trailing
        // spaces. A CR is the one byte taken off, because a file written on
        // another platform ends its lines with one and no bound path can
        // contain one (FileExchangeHost::pathIsOneLine refuses those outright).
        //
        // A line that does not START with the key is one somebody indented by
        // hand; there is no way to tell their indentation from the path, so
        // that case keeps the trimmed value it always had.
        std::string value = rest;
        const std::string marker = "INPUT-FILE ";
        if (raw.rfind(marker, 0) == 0) {
          value = raw.substr(marker.size());
          while (!value.empty() && value.back() == '\r') value.pop_back();
        }
        doc.inputFile = value;
        continue;
      }
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
      if (key == "TITLEBLOCK" || key == "DATUM" || key == "NOTE" || key == "CONTROL") {
        // ADDITIVE-ONLY, enforced rather than documented: these blocks were
        // introduced in version 2, so a file that CLAIMS version 1 and contains
        // one has been hand-edited or half-written, and reading it would produce
        // a document neither version describes.
        if (fileVersion < kPartFileDrawingVersion) {
          return fail("'" + key + "' was added in format version " +
                      std::to_string(kPartFileDrawingVersion) +
                      ", but this file says it is version " + std::to_string(fileVersion));
        }
        curRef = forge::ui::EntityRef{};
        if (key == "TITLEBLOCK") { block = Block::TitleBlock; title = forge::ui::TitleBlockData{}; }
        if (key == "DATUM") { block = Block::Datum; curDatum = forge::ui::DatumFeature{}; }
        if (key == "NOTE") { block = Block::Note; curNote = forge::ui::Annotation{}; }
        if (key == "CONTROL") { block = Block::Control; curControl = forge::ui::FeatureControlFrame{}; }
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
  if (block != Block::None) {
    error = "file ends inside a drawing block (truncated write?)";
    return false;
  }
  doc.version = fileVersion;
  doc.drawing.restore(std::move(title), std::move(datums), std::move(notes), std::move(controls));
  out = std::move(doc);
  error.clear();
  return true;
}

// ── document <-> file ───────────────────────────────────────────────────────
PartFileDoc capturePartDocument(const forge::ui::PartDocument& doc, const std::string& name,
                                const forge::ui::DrawingModel& drawing,
                                const std::string& inputFile) {
  PartFileDoc out;
  out.name = name.empty() ? std::string("untitled") : name;
  // THE UNIT, from the one place that owns it. forge/ui/Units.hpp states the
  // rule for the whole application -- every stored length is a millimetre -- and
  // writing the letters "mm" here as a literal would be a second place that could
  // come to disagree with it.
  out.units = forge::ui::toString(forge::ui::kInternalLengthUnit);
  out.drawing = drawing;
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
  // ── THE INPUT FILE: the document's own binding, made absolute ─────────────
  //
  // Two conditions, and they answer two different questions. `inputFile` is the
  // binding ForgeFrame keeps for THE DOCUMENT NOW OPEN -- set by an import or by
  // an open, and cleared by File > New and by anything else that empties the
  // document -- so a non-empty one is the fact that this part came from a file.
  // partFileBindsInput then asks whether the program has an INPUT() statement to
  // spend it on, because a file naming a source none of its features read is
  // making a claim it cannot support.
  //
  // MEASURED with only the second condition, and it is why the first exists:
  // import a part, File > New, state an imported solid in the fresh document,
  // Save -- and the .fpart named the file the FIRST part was built from.
  if (!inputFile.empty() && partFileBindsInput(out)) {
    out.inputFile = absolutePartPath(inputFile);
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
  // ATOMIC REPLACEMENT.
  //
  // This used to be `std::ofstream out(path, std::ios::trunc)`, which DESTROYS the
  // user's existing file at open -- before a single byte of the new content has
  // been written. Everything after that point is running against a file the user
  // can no longer get back: a crash, a kill, a full disk or a serialisation throw
  // all leave a truncated or empty part where the design was.
  //
  // The loader two hundred lines up already knows this state exists: it reports
  // "file ends inside a FEATURE block (truncated write?)". The reader was taught to
  // recognise the wreck while the writer went on producing it.
  //
  // Same shape as ui/src/DocumentStore.cpp, which had it right and is not in the
  // shipped app.
  const std::string text = writePartFile(doc);
  const std::string temporary = path + ".forge-tmp";
  {
    std::ofstream out(temporary, std::ios::trunc | std::ios::binary);
    if (!out) {
      error = "cannot open '" + temporary + "' for writing";
      return false;
    }
    out.write(text.data(), static_cast<std::streamsize>(text.size()));
    out.flush();
    // A write that failed halfway must not be reported as a save.
    if (!out) {
      error = "write to '" + temporary + "' failed";
      std::error_code ignored;
      std::filesystem::remove(std::filesystem::path(temporary), ignored);
      return false;
    }
  }

  // flush() only pushes the stream buffer into the OS. That is enough to survive
  // the PROCESS dying, which is the threat the truncation created, but not enough
  // to survive the machine losing power between the write and the rename -- the
  // rename would then commit a name onto blocks that were never written. A part
  // file is small and saves are user-initiated, so the fsync is not worth
  // optimising away.
  {
    const int fd = ::open(temporary.c_str(), O_RDONLY);
    if (fd >= 0) {
      ::fsync(fd);
      ::close(fd);
    }
  }

  std::error_code ec;
  std::filesystem::rename(std::filesystem::path(temporary), std::filesystem::path(path), ec);
  if (ec) {
    error = "cannot replace '" + path + "': " + ec.message();
    std::error_code ignored;
    std::filesystem::remove(std::filesystem::path(temporary), ignored);
    return false;
  }

  // Persist the DIRECTORY entry too, so the rename itself survives power loss and
  // cannot leave the target missing entirely.
  {
    std::filesystem::path parent = std::filesystem::path(path).parent_path();
    if (parent.empty()) parent = std::filesystem::path(".");
    const int dfd = ::open(parent.c_str(), O_RDONLY);
    if (dfd >= 0) {
      ::fsync(dfd);
      ::close(dfd);
    }
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
