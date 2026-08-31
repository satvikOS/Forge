#include "forge/ui/ExchangeModel.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"

namespace forge::ui {

// ── format names ────────────────────────────────────────────────────────────
const char* toString(ExchangeFormat f) noexcept {
  switch (f) {
    case ExchangeFormat::Unknown:   return "unknown";
    case ExchangeFormat::Step:      return "step";
    case ExchangeFormat::Iges:      return "iges";
    case ExchangeFormat::Brep:      return "brep";
    case ExchangeFormat::Stl:       return "stl";
    case ExchangeFormat::Obj:       return "obj";
    case ExchangeFormat::Dxf:       return "dxf";
    case ExchangeFormat::Jt:        return "jt";
    case ExchangeFormat::Parasolid: return "parasolid";
  }
  return "unknown";
}

ExchangeFormat formatFromString(const std::string& s) noexcept {
  if (s == "step" || s == "stp") return ExchangeFormat::Step;
  if (s == "iges" || s == "igs") return ExchangeFormat::Iges;
  if (s == "brep" || s == "brp") return ExchangeFormat::Brep;
  if (s == "stl") return ExchangeFormat::Stl;
  if (s == "obj") return ExchangeFormat::Obj;
  if (s == "dxf") return ExchangeFormat::Dxf;
  if (s == "jt") return ExchangeFormat::Jt;
  if (s == "parasolid") return ExchangeFormat::Parasolid;
  return ExchangeFormat::Unknown;
}

const char* toString(GeometryClass g) noexcept {
  switch (g) {
    case GeometryClass::None:        return "none";
    case GeometryClass::ExactBrep:   return "exact_brep";
    case GeometryClass::Tessellated: return "tessellated";
    case GeometryClass::Curves2d:    return "curves_2d";
  }
  return "none";
}

const char* toString(SniffConfidence c) noexcept {
  switch (c) {
    case SniffConfidence::None:      return "none";
    case SniffConfidence::Extension: return "extension";
    case SniffConfidence::Content:   return "content";
    case SniffConfidence::Certain:   return "certain";
  }
  return "none";
}

const char* toString(Severity s) noexcept {
  switch (s) {
    case Severity::Info:    return "info";
    case Severity::Warning: return "warning";
    case Severity::Error:   return "error";
  }
  return "info";
}

const char* toString(HealPolicy p) noexcept {
  switch (p) {
    case HealPolicy::None:       return "none";
    case HealPolicy::Standard:   return "standard";
    case HealPolicy::Aggressive: return "aggressive";
    case HealPolicy::Custom:     return "custom";
  }
  return "standard";
}

HealPolicy healPolicyFromString(const std::string& s) noexcept {
  if (s == "none") return HealPolicy::None;
  if (s == "aggressive") return HealPolicy::Aggressive;
  if (s == "custom") return HealPolicy::Custom;
  return HealPolicy::Standard;  // the default, and what an unrecognised word means
}

const char* toString(ExchangePhase p) noexcept {
  switch (p) {
    case ExchangePhase::Idle:         return "idle";
    case ExchangePhase::Reading:      return "reading";
    case ExchangePhase::Parsing:      return "parsing";
    case ExchangePhase::Transferring: return "transferring";
    case ExchangePhase::Healing:      return "healing";
    case ExchangePhase::Measuring:    return "measuring";
    case ExchangePhase::Writing:      return "writing";
    case ExchangePhase::Done:         return "done";
    case ExchangePhase::Failed:       return "failed";
    case ExchangePhase::Cancelled:    return "cancelled";
  }
  return "idle";
}

// ── THE CENSUS ──────────────────────────────────────────────────────────────
// Every row states what THIS BUILD does, established by reading the call chain
// and then MEASURING it, not by grepping for a symbol. Where a direction is
// unavailable the row says why in a sentence and names where to go instead.
//
// Two rows carry a caveat inside `importBacking` rather than a separate flag,
// because it is the same fact a user needs at the moment they read the backing:
// IGES and STL both REFUSE a body they cannot fully reconstruct, which is the
// one place this subsystem still contradicts the tolerate rule. The exchange
// service compensates where it can (it re-routes an STL export of an OCCT-backed
// body through the tessellator instead of throwing) and reports where it cannot.
const std::vector<FormatCapability>& formatCapabilities() {
  static const std::vector<FormatCapability> rows = [] {
    std::vector<FormatCapability> v;
    v.push_back(FormatCapability{
        ExchangeFormat::Step, "STEP (AP203/214/242)", ".step .stp .p21",
        GeometryClass::ExactBrep, true, true,
        "forge::io::importStep — native analytic codec, then the native foreign "
        "reader, then the in-house TKDESTEP-free OCCT transfer",
        "forge::io::exportStep — analytic writer (native or OCCT-backed), "
        "faceted MANIFOLD_SOLID_BREP fallback",
        "", "", ExchangeFormat::Unknown});
    v.push_back(FormatCapability{
        ExchangeFormat::Iges, "IGES 5.3", ".iges .igs",
        GeometryClass::ExactBrep, true, false,
        "forge::io::importIges — native readForeignIges (STRICT: refuses a body "
        "with any unreconstructed entity or an open sew)",
        "",
        "",
        "no IGES writer is linked in this build: OCCT's TKDEIGES ships a reader "
        "and no writer package, and the native kernel ships an analytic STEP "
        "writer rather than an IGES 5.3 S/G/D/P/T writer.",
        ExchangeFormat::Step});
    v.push_back(FormatCapability{
        ExchangeFormat::Brep, "OCCT BREP", ".brep .brp",
        GeometryClass::ExactBrep, true, true,
        "forge::io::importBrep — BRepTools::Read",
        "forge::io::exportBrep — BRepTools::Write",
        "", "", ExchangeFormat::Unknown});
    v.push_back(FormatCapability{
        ExchangeFormat::Stl, "STL", ".stl",
        GeometryClass::Tessellated, true, true,
        "forge::io::importStl — native ASCII codec with a binary transcode "
        "(discriminated by the 84 + 50n size rule, never by the header text); "
        "STRICT: refuses a non-manifold or inconsistently-wound soup",
        "forge::exchange — native tessellation through MeshExchange::writeSTL "
        "(ASCII; the binary and chord-tolerance switches are advisory)",
        "", "", ExchangeFormat::Unknown});
    v.push_back(FormatCapability{
        ExchangeFormat::Obj, "Wavefront OBJ", ".obj",
        GeometryClass::Tessellated, true, true,
        "forge::exchange — MeshExchange::readOBJ welded into a HalfEdgeMesh",
        "forge::exchange — tessellate then MeshExchange::writeOBJ",
        "", "", ExchangeFormat::Unknown});
    v.push_back(FormatCapability{
        ExchangeFormat::Dxf, "AutoCAD DXF", ".dxf",
        GeometryClass::Curves2d, false, false,
        "", "",
        "the DXF codec (forge::dxf::parse) reads LINE/CIRCLE/ARC/LWPOLYLINE and "
        "is reachable only from the node addon, which this application does not "
        "build; and a 2D entity list is not a solid, so there is no value kind "
        "in the feature IR for it to become.",
        "nothing in the document is a 2D curve set: the feature IR has PROFILE, "
        "WIRE and SOLID value kinds and no sketch/drawing kind to write out.",
        ExchangeFormat::Step});
    v.push_back(FormatCapability{
        ExchangeFormat::Jt, "Siemens JT", ".jt",
        GeometryClass::ExactBrep, false, false,
        "", "",
        "JT requires the proprietary Siemens JT Open Toolkit, which is not "
        "vendored. Re-export the file as STEP AP242 in the source CAD system.",
        "JT requires the proprietary Siemens JT Open Toolkit, which is not "
        "vendored.",
        ExchangeFormat::Step});
    v.push_back(FormatCapability{
        ExchangeFormat::Parasolid, "Parasolid", ".x_t .x_b .xmt_txt .xmt_bin",
        GeometryClass::ExactBrep, false, false,
        "", "",
        "Parasolid requires Siemens' proprietary kernel, which is not vendored. "
        "Export STEP (AP214 or AP242) from the source CAD; STEP is "
        "exact-precision and reads here without loss.",
        "Parasolid requires Siemens' proprietary kernel, which is not vendored.",
        ExchangeFormat::Step});
    v.push_back(FormatCapability{
        ExchangeFormat::Unknown, "Unrecognised", "",
        GeometryClass::None, false, false,
        "", "",
        "the file's bytes match no format this build reads, and its name did not "
        "name one either.",
        "no format was chosen.",
        ExchangeFormat::Step});
    return v;
  }();
  return rows;
}

const FormatCapability& capabilityOf(ExchangeFormat f) {
  const std::vector<FormatCapability>& rows = formatCapabilities();
  for (const FormatCapability& row : rows) {
    if (row.format == f) return row;
  }
  return rows.back();  // the Unknown row, which is always last
}

std::vector<ExchangeFormat> importableFormats() {
  std::vector<ExchangeFormat> v;
  for (const FormatCapability& row : formatCapabilities()) {
    if (row.canImport) v.push_back(row.format);
  }
  return v;
}

std::vector<ExchangeFormat> exportableFormats() {
  std::vector<ExchangeFormat> v;
  for (const FormatCapability& row : formatCapabilities()) {
    if (row.canExport) v.push_back(row.format);
  }
  return v;
}

// ── sniffing ────────────────────────────────────────────────────────────────
namespace {

std::string lowerAscii(const std::string& s) {
  std::string out = s;
  for (char& c : out) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return out;
}

// The extension, lowercased, WITHOUT the dot. "" when the name has none, or when
// the dot belongs to a directory component ("/a.b/file").
std::string extensionOf(const std::string& path) {
  const std::size_t slash = path.find_last_of("/\\");
  const std::string name = slash == std::string::npos ? path : path.substr(slash + 1);
  const std::size_t dot = name.find_last_of('.');
  if (dot == std::string::npos || dot + 1 >= name.size()) return std::string();
  return lowerAscii(name.substr(dot + 1));
}

bool contains(const std::string& hay, const char* needle) {
  return hay.find(needle) != std::string::npos;
}

bool startsWith(const std::string& s, const char* prefix) {
  return s.rfind(prefix, 0) == 0;
}

// The FIRST non-blank line, trimmed of leading spaces. DXF group codes are
// right-aligned in some writers ("  0") and left-aligned in others ("0").
std::string firstNonBlankLine(const std::string& head) {
  std::size_t i = 0;
  while (i < head.size()) {
    std::size_t end = head.find('\n', i);
    if (end == std::string::npos) end = head.size();
    std::string line = head.substr(i, end - i);
    while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
    std::size_t a = 0;
    while (a < line.size() && (line[a] == ' ' || line[a] == '\t')) ++a;
    line = line.substr(a);
    if (!line.empty()) return line;
    i = end + 1;
  }
  return std::string();
}

// THE BINARY-STL SIZE RULE, and it is the whole reason this function does not
// dispatch on the header text. A binary STL's 80-byte header is ARBITRARY bytes
// and many exporters write a part name beginning "solid " straight into it, so a
// header sniff classified those files as ASCII and the ASCII reader then rejected
// a perfectly valid file. The arithmetic rule is self-checking: the file is
// EXACTLY 84 + 50*n bytes where n is the little-endian uint32 at offset 80.
bool looksLikeBinaryStl(const std::string& head, std::uint64_t totalBytes) {
  if (head.size() < 84 || totalBytes < 84) return false;
  const unsigned char* p = reinterpret_cast<const unsigned char*>(head.data()) + 80;
  const std::uint64_t n = static_cast<std::uint64_t>(p[0]) |
                          (static_cast<std::uint64_t>(p[1]) << 8) |
                          (static_cast<std::uint64_t>(p[2]) << 16) |
                          (static_cast<std::uint64_t>(p[3]) << 24);
  return 84ull + 50ull * n == totalBytes;
}

// IGES is a fixed 80-column record format whose section letter sits in column 73.
// Testing that is far more specific than looking for the word "IGES", which
// appears in the global section of plenty of STEP files' comments.
bool looksLikeIges(const std::string& head) {
  if (head.size() < 80) return false;
  const char col73 = head[72];
  if (col73 != 'S' && col73 != 'F') return false;
  // The rest of the line must be the sequence number: digits and spaces only.
  for (std::size_t i = 73; i < 80; ++i) {
    const char c = head[i];
    if (!((c >= '0' && c <= '9') || c == ' ')) return false;
  }
  return true;
}

bool looksLikeObj(const std::string& head) {
  // A vertex line AND a face line. "v " alone also opens plenty of text files.
  bool sawV = false;
  bool sawF = false;
  std::size_t i = 0;
  while (i < head.size()) {
    std::size_t end = head.find('\n', i);
    if (end == std::string::npos) end = head.size();
    if (end > i + 1) {
      const char a = head[i];
      const char b = head[i + 1];
      if (a == 'v' && (b == ' ' || b == 't' || b == 'n')) sawV = true;
      if (a == 'f' && b == ' ') sawF = true;
    }
    i = end + 1;
  }
  return sawV && sawF;
}

}  // namespace

ExchangeFormat formatFromPath(const std::string& path) noexcept {
  const std::string ext = extensionOf(path);
  if (ext == "step" || ext == "stp" || ext == "p21") return ExchangeFormat::Step;
  if (ext == "iges" || ext == "igs") return ExchangeFormat::Iges;
  if (ext == "brep" || ext == "brp") return ExchangeFormat::Brep;
  if (ext == "stl") return ExchangeFormat::Stl;
  if (ext == "obj") return ExchangeFormat::Obj;
  if (ext == "dxf") return ExchangeFormat::Dxf;
  if (ext == "jt") return ExchangeFormat::Jt;
  if (ext == "x_t" || ext == "x_b" || ext == "xmt_txt" || ext == "xmt_bin") {
    return ExchangeFormat::Parasolid;
  }
  return ExchangeFormat::Unknown;
}

SniffResult sniffFormat(const std::string& path, const std::string& head,
                        std::uint64_t totalBytes) {
  SniffResult r;
  const ExchangeFormat byName = formatFromPath(path);

  ExchangeFormat byContent = ExchangeFormat::Unknown;
  std::string evidence;

  const std::string first = firstNonBlankLine(head);

  if (contains(head, "ISO-10303")) {
    byContent = ExchangeFormat::Step;
    evidence = "the ISO-10303 header token";
  } else if (startsWith(head, "DBRep_DrawableShape") || contains(head, "CASCADE Topology")) {
    byContent = ExchangeFormat::Brep;
    evidence = "the OCCT BREP header";
  } else if (looksLikeBinaryStl(head, totalBytes)) {
    byContent = ExchangeFormat::Stl;
    evidence = "the binary-STL size rule (84 + 50n bytes), not the header text";
  } else if (startsWith(head, "AutoCAD Binary DXF")) {
    byContent = ExchangeFormat::Dxf;
    evidence = "the binary DXF sentinel";
  } else if (looksLikeIges(head)) {
    byContent = ExchangeFormat::Iges;
    evidence = "an 80-column record with a section letter in column 73";
  } else if (startsWith(head, "solid") && (contains(head, "facet normal") ||
                                           contains(head, "endsolid"))) {
    byContent = ExchangeFormat::Stl;
    evidence = "an ASCII STL solid/facet body";
  } else if (first == "0" && contains(head, "SECTION")) {
    byContent = ExchangeFormat::Dxf;
    evidence = "a DXF group-code 0 SECTION opening";
  } else if (startsWith(head, "**") || (!head.empty() &&
                                        static_cast<unsigned char>(head[0]) == 0x83)) {
    byContent = ExchangeFormat::Parasolid;
    evidence = "the Parasolid x_t/x_b magic";
  } else if (startsWith(first, "Version 8") || startsWith(first, "Version 9")) {
    byContent = ExchangeFormat::Jt;
    evidence = "the JT version header";
  } else if (looksLikeObj(head)) {
    byContent = ExchangeFormat::Obj;
    evidence = "OBJ v/f records";
  }

  if (byContent != ExchangeFormat::Unknown) {
    r.format = byContent;
    r.confidence = (byName == byContent) ? SniffConfidence::Certain : SniffConfidence::Content;
    if (byName != ExchangeFormat::Unknown && byName != byContent) r.extensionSaid = byName;
    r.evidence = evidence;
    return r;
  }
  if (byName != ExchangeFormat::Unknown) {
    r.format = byName;
    r.confidence = SniffConfidence::Extension;
    r.evidence = "the file name only — nothing in the first bytes named a format";
    return r;
  }
  r.format = ExchangeFormat::Unknown;
  r.confidence = SniffConfidence::None;
  r.evidence = "neither the first bytes nor the file name named a format";
  return r;
}

// ── units ───────────────────────────────────────────────────────────────────
const char* toString(LengthUnit u) noexcept {
  switch (u) {
    case LengthUnit::Millimetre: return "mm";
    case LengthUnit::Centimetre: return "cm";
    case LengthUnit::Metre:      return "m";
    case LengthUnit::Micron:     return "um";
    case LengthUnit::Inch:       return "in";
    case LengthUnit::Foot:       return "ft";
  }
  return "mm";
}

LengthUnit unitFromString(const std::string& s) noexcept {
  if (s == "cm") return LengthUnit::Centimetre;
  if (s == "m") return LengthUnit::Metre;
  if (s == "um") return LengthUnit::Micron;
  if (s == "in") return LengthUnit::Inch;
  if (s == "ft") return LengthUnit::Foot;
  return LengthUnit::Millimetre;  // the document unit, and what a typo means
}

double unitInMillimetres(LengthUnit u) noexcept {
  switch (u) {
    case LengthUnit::Millimetre: return 1.0;
    case LengthUnit::Centimetre: return 10.0;
    case LengthUnit::Metre:      return 1000.0;
    case LengthUnit::Micron:     return 0.001;
    case LengthUnit::Inch:       return 25.4;
    case LengthUnit::Foot:       return 304.8;
  }
  return 1.0;
}

double unitScale(LengthUnit from, LengthUnit to) noexcept {
  if (from == to) return 1.0;  // EXACTLY 1, not 25.4/25.4
  return unitInMillimetres(from) / unitInMillimetres(to);
}

// ── diagnostics ─────────────────────────────────────────────────────────────
std::string ExchangeDiagnostic::format() const {
  std::string out = "[";
  out += toString(severity);
  out += "] ";
  out += code;
  out += ": ";
  out += message;
  if (!entity.empty()) {
    out += " (";
    out += entity;
    out += ")";
  }
  return out;
}

void DiagnosticLog::add(Severity s, std::string code, std::string message, std::string entity) {
  // The COUNT moves whether or not the item is kept. A cap that suppressed the
  // count as well as the string would make "3 errors, 2 listed" unrepresentable,
  // and a caller asking hasErrors() would get a false negative on the very files
  // that produce the most diagnostics.
  counts_[static_cast<std::size_t>(s)] += 1;
  if (cap_ != 0 && items_.size() >= cap_) {
    ++dropped_;
    return;
  }
  ExchangeDiagnostic d;
  d.severity = s;
  d.code = std::move(code);
  d.message = std::move(message);
  d.entity = std::move(entity);
  items_.push_back(std::move(d));
}

void DiagnosticLog::info(std::string code, std::string message, std::string entity) {
  add(Severity::Info, std::move(code), std::move(message), std::move(entity));
}
void DiagnosticLog::warn(std::string code, std::string message, std::string entity) {
  add(Severity::Warning, std::move(code), std::move(message), std::move(entity));
}
void DiagnosticLog::error(std::string code, std::string message, std::string entity) {
  add(Severity::Error, std::move(code), std::move(message), std::move(entity));
}

std::size_t DiagnosticLog::count(Severity s) const noexcept {
  return counts_[static_cast<std::size_t>(s)];
}

void DiagnosticLog::clear() noexcept {
  items_.clear();
  dropped_ = 0;
  counts_[0] = counts_[1] = counts_[2] = 0;
}

std::vector<ExchangeDiagnostic> DiagnosticLog::withCode(const std::string& code) const {
  std::vector<ExchangeDiagnostic> out;
  for (const ExchangeDiagnostic& d : items_) {
    if (d.code == code) out.push_back(d);
  }
  return out;
}

std::string DiagnosticLog::summary() const {
  const std::size_t e = count(Severity::Error);
  const std::size_t w = count(Severity::Warning);
  const std::size_t i = count(Severity::Info);
  std::string out = std::to_string(e) + (e == 1 ? " error, " : " errors, ") +
                    std::to_string(w) + (w == 1 ? " warning, " : " warnings, ") +
                    std::to_string(i) + (i == 1 ? " info" : " info");
  if (dropped_ != 0) {
    out += " (" + std::to_string(dropped_) + " not listed: log capped at " +
           std::to_string(cap_) + ")";
  }
  return out;
}

// ── options ─────────────────────────────────────────────────────────────────
namespace {

// Format a double for a diagnostic without dragging <sstream> or a locale in.
std::string num(double v) {
  char buf[48];
  std::snprintf(buf, sizeof buf, "%g", v);
  return std::string(buf);
}

// Clamp `v` into [lo, hi] and, if it moved, say so. Returns 1 when it clamped.
// NaN is treated as out of range and replaced with `fallback`: a NaN tolerance
// compares false against every bound, so a plain clamp would leave it NaN and it
// would reach the kernel as a silent poison value.
std::size_t clampWithDiagnostic(double& v, double lo, double hi, double fallback,
                                const char* what, DiagnosticLog& log) {
  if (std::isnan(v)) {
    const double asked = v;
    v = fallback;
    log.warn("tolerance_not_a_number",
             std::string(what) + " was not a number; using " + num(v) + " instead",
             std::string());
    (void)asked;
    return 1;
  }
  if (v < lo || v > hi) {
    const double asked = v;
    v = v < lo ? lo : hi;
    log.warn("tolerance_clamped",
             std::string(what) + " " + num(asked) + " is outside [" + num(lo) + ", " +
                 num(hi) + "]; using " + num(v) + ". The import is NOT refused.",
             std::string());
    return 1;
  }
  return 0;
}

}  // namespace

std::size_t normaliseImportOptions(ImportOptions& opts, DiagnosticLog& log) {
  std::size_t repairs = 0;
  repairs += clampWithDiagnostic(opts.sewTolerance, kMinTolerance, kMaxTolerance,
                                 kDefaultSewTolerance, "sew tolerance", log);
  if (opts.progressIntervalBytes == 0) {
    opts.progressIntervalBytes = 1u << 20;
    log.info("progress_interval_defaulted",
             "a progress interval of 0 bytes would call back per byte; using 1 MiB");
    ++repairs;
  }
  // A source unit is meaningless when the file is being believed. Say so rather
  // than silently applying it or silently dropping it.
  if (opts.autoDetectUnit && opts.sourceUnit != opts.documentUnit) {
    log.info("source_unit_ignored",
             std::string("auto-detect units is on, so the stated source unit '") +
                 toString(opts.sourceUnit) + "' is not applied; the file's own unit wins");
    ++repairs;
  }
  log.setCap(opts.maxDiagnostics);
  return repairs;
}

std::size_t normaliseExportOptions(ExportOptions& opts, DiagnosticLog& log) {
  std::size_t repairs = 0;
  repairs += clampWithDiagnostic(opts.linearTolerance, kMinTolerance, kMaxTolerance,
                                 kDefaultLinearTolerance, "linear tolerance", log);
  repairs += clampWithDiagnostic(opts.angularTolerance, kMinAngularTolerance,
                                 kMaxAngularTolerance, kDefaultAngularTolerance,
                                 "angular tolerance", log);
  if (opts.progressIntervalBytes == 0) {
    opts.progressIntervalBytes = 1u << 20;
    log.info("progress_interval_defaulted",
             "a progress interval of 0 bytes would call back per byte; using 1 MiB");
    ++repairs;
  }
  // ★ A FORMAT THIS BUILD CANNOT WRITE IS REPORTED, NOT SUBSTITUTED. Silently
  // rewriting the user's IGES request into a STEP write would put a file with
  // the wrong bytes at the path they chose. The alternative is NAMED so the UI
  // can offer it and a repair loop can take it.
  const FormatCapability& cap = capabilityOf(opts.format);
  if (!cap.canExport) {
    log.error("export_format_unavailable",
              std::string(cap.label) + " export is not available in this build: " +
                  cap.whyNoExport + " Try " +
                  toString(cap.exportAlternative) + " instead.",
              std::string(toString(opts.format)));
  }
  log.setCap(opts.maxDiagnostics);
  return repairs;
}

HealingPlan resolveHealing(const ImportOptions& opts) {
  HealingPlan p;
  p.tolerance = opts.sewTolerance;
  switch (opts.heal) {
    case HealPolicy::None:
      break;
    case HealPolicy::Standard:
      p.sew = true;
      p.harmoniseNormals = true;
      p.unifyCoplanarFaces = true;
      break;
    case HealPolicy::Aggressive:
      p.sew = true;
      p.harmoniseNormals = true;
      p.unifyCoplanarFaces = true;
      p.fillMissingFaces = true;
      p.repairSelfIntersections = true;
      break;
    case HealPolicy::Custom:
      p.sew = opts.sewShells;
      p.harmoniseNormals = opts.harmoniseNormals;
      p.unifyCoplanarFaces = opts.unifyCoplanarFaces;
      p.fillMissingFaces = opts.fillMissingFaces;
      p.repairSelfIntersections = opts.repairSelfIntersections;
      break;
  }
  return p;
}

double importScaleFactor(const ImportOptions& opts) noexcept {
  if (opts.autoDetectUnit) return 1.0;
  return unitScale(opts.sourceUnit, opts.documentUnit);
}

double exportScaleFactor(const ExportOptions& opts) noexcept {
  return unitScale(opts.documentUnit, opts.targetUnit);
}

// ── progress ────────────────────────────────────────────────────────────────
namespace {

// The cumulative fraction each WORKING phase spans. The numbers are a claim
// about where the time goes on a large STEP — reading bytes and transferring
// topology dominate — and they are here as one table rather than scattered
// through enterPhase(), so a gate can assert the whole thing is monotonic.
struct PhaseSpan {
  double begin;
  double end;
};

PhaseSpan spanOf(ExchangePhase p) noexcept {
  switch (p) {
    case ExchangePhase::Idle:         return PhaseSpan{0.00, 0.00};
    case ExchangePhase::Reading:      return PhaseSpan{0.00, 0.25};
    case ExchangePhase::Parsing:      return PhaseSpan{0.25, 0.50};
    case ExchangePhase::Transferring: return PhaseSpan{0.50, 0.75};
    case ExchangePhase::Healing:      return PhaseSpan{0.75, 0.85};
    case ExchangePhase::Measuring:    return PhaseSpan{0.85, 0.92};
    case ExchangePhase::Writing:      return PhaseSpan{0.92, 1.00};
    case ExchangePhase::Done:         return PhaseSpan{1.00, 1.00};
    case ExchangePhase::Failed:       return PhaseSpan{1.00, 1.00};
    case ExchangePhase::Cancelled:    return PhaseSpan{1.00, 1.00};
  }
  return PhaseSpan{0.0, 0.0};
}

bool isTerminal(ExchangePhase p) noexcept {
  return p == ExchangePhase::Done || p == ExchangePhase::Failed ||
         p == ExchangePhase::Cancelled;
}

std::string humanBytes(std::uint64_t b) {
  char buf[48];
  if (b >= (1ull << 30)) {
    std::snprintf(buf, sizeof buf, "%.1f GB", static_cast<double>(b) / 1073741824.0);
  } else if (b >= (1ull << 20)) {
    std::snprintf(buf, sizeof buf, "%.1f MB", static_cast<double>(b) / 1048576.0);
  } else if (b >= 1024) {
    std::snprintf(buf, sizeof buf, "%.1f kB", static_cast<double>(b) / 1024.0);
  } else {
    std::snprintf(buf, sizeof buf, "%llu B", static_cast<unsigned long long>(b));
  }
  return std::string(buf);
}

}  // namespace

void ExchangeProgress::begin(std::uint64_t totalBytes) {
  phase_ = ExchangePhase::Reading;
  fraction_ = 0.0;
  totalBytes_ = totalBytes;
  bytesDone_ = 0;
  cancelled_ = false;
  rewinds_ = 0;
  error_.clear();
}

void ExchangeProgress::enterPhase(ExchangePhase p) {
  if (!isTerminal(p) && !isTerminal(phase_)) {
    // A phase that comes BEFORE the current one is a rewind. Record it and keep
    // the fraction where it is: a bar that goes backwards is read as a hang, and
    // a caller that re-enters Healing after Measuring has a bug the count makes
    // visible instead of a display that flickers.
    if (static_cast<std::uint8_t>(p) < static_cast<std::uint8_t>(phase_)) {
      ++rewinds_;
      return;
    }
  }
  phase_ = p;
  const double b = spanOf(p).begin;
  if (b > fraction_) fraction_ = b;
}

void ExchangeProgress::setBytesDone(std::uint64_t bytes) {
  bytesDone_ = bytes;
  if (totalBytes_ == 0) return;
  double within = static_cast<double>(bytes) / static_cast<double>(totalBytes_);
  if (within < 0.0) within = 0.0;
  if (within > 1.0) within = 1.0;
  setPhaseFraction(within);
}

void ExchangeProgress::setPhaseFraction(double f) {
  if (std::isnan(f)) return;
  if (f < 0.0) f = 0.0;
  if (f > 1.0) f = 1.0;
  const PhaseSpan s = spanOf(phase_);
  const double want = s.begin + (s.end - s.begin) * f;
  if (want > fraction_) fraction_ = want;
}

void ExchangeProgress::finish() {
  phase_ = ExchangePhase::Done;
  fraction_ = 1.0;
}

void ExchangeProgress::fail(std::string why) {
  phase_ = ExchangePhase::Failed;
  fraction_ = 1.0;
  error_ = std::move(why);
}

void ExchangeProgress::cancel() {
  cancelled_ = true;
  // The phase does NOT move here. Cancellation is cooperative: the host notices
  // on its next poll and calls enterPhase(Cancelled) when it has actually
  // stopped. Flipping the phase from the canceller would report the work as
  // finished while it is still running.
}

std::string ExchangeProgress::label() const {
  std::string out = toString(phase_);
  if (!out.empty() && out[0] >= 'a' && out[0] <= 'z') {
    out[0] = static_cast<char>(out[0] - 'a' + 'A');
  }
  char pct[24];
  std::snprintf(pct, sizeof pct, " %d%%", static_cast<int>(fraction_ * 100.0 + 0.5));
  out += pct;
  if (totalBytes_ > 0) {
    out += " (" + humanBytes(bytesDone_) + " of " + humanBytes(totalBytes_) + ")";
  }
  if (cancelled_ && phase_ != ExchangePhase::Cancelled) out += " — cancelling";
  if (!error_.empty()) out += " — " + error_;
  return out;
}

// ── observables ─────────────────────────────────────────────────────────────
double Observables::bboxDiagonal() const noexcept {
  const double dx = bboxMax[0] - bboxMin[0];
  const double dy = bboxMax[1] - bboxMin[1];
  const double dz = bboxMax[2] - bboxMin[2];
  return std::sqrt(dx * dx + dy * dy + dz * dz);
}

double Observables::characteristicLength() const noexcept {
  const double d = bboxDiagonal();
  if (d > 1e-12 && !std::isnan(d)) return d;
  if (volume > 1e-30) return std::pow(volume, 1.0 / 3.0);
  return 1.0;
}

LossVector compareObservables(const Observables& a, const Observables& b,
                              const LossTolerance& tol) {
  LossVector L;
  if (!a.measured || !b.measured) {
    L.comparable = false;
    L.withinTolerance = false;
    L.violations.push_back("not_measured");
    return L;
  }
  L.comparable = true;

  const double eps = 1e-30;
  L.volumeRel = std::fabs(b.volume - a.volume) / std::max(std::fabs(a.volume), eps);
  L.areaRel = std::fabs(b.area - a.area) / std::max(std::fabs(a.area), eps);

  const double scale = a.characteristicLength();
  const double cdx = b.com[0] - a.com[0];
  const double cdy = b.com[1] - a.com[1];
  const double cdz = b.com[2] - a.com[2];
  L.comDistRel = std::sqrt(cdx * cdx + cdy * cdy + cdz * cdz) / scale;

  double worst = 0.0;
  for (int i = 0; i < 3; ++i) {
    worst = std::max(worst, std::fabs(b.bboxMin[i] - a.bboxMin[i]));
    worst = std::max(worst, std::fabs(b.bboxMax[i] - a.bboxMax[i]));
  }
  L.bboxMaxAbsDelta = worst;
  L.bboxRel = worst / scale;

  // ★ A SENTINEL IS NOT A COUNT. Every count here carries -1 for "could not be
  // taken", and subtracting one of those produces a number that LOOKS like a
  // topology change and is not one. MEASURED: a body whose face count came back
  // -1 against a body with 628 faces reported faceDelta = -629 and a shellDelta
  // of -3 — three fabricated findings in one comparison, and the run would have
  // read as catastrophic loss. So an unmeasured term reports NO delta and names
  // itself as unmeasured, which is a different fact from "it changed".
  const auto countTerm = [&L](long av, long bv, bool required, const char* name,
                              long& delta) {
    if (av < 0 || bv < 0) {
      delta = 0;
      if (required) L.violations.push_back(std::string(name) + "_unmeasured");
      return;
    }
    delta = bv - av;
    if (required && delta != 0) L.violations.push_back(name);
  };

  if (L.volumeRel > tol.volumeRel) L.violations.push_back("volume");
  if (L.areaRel > tol.areaRel) L.violations.push_back("area");
  if (L.comDistRel > tol.comRel) L.violations.push_back("com");
  if (L.bboxRel > tol.bboxRel) L.violations.push_back("bbox");
  countTerm(a.faceCount, b.faceCount, tol.requireSameFaceCount, "faces", L.faceDelta);
  countTerm(a.edgeCount, b.edgeCount, tol.requireSameEdgeCount, "edges", L.edgeDelta);
  // The vertex count has no `require` switch of its own — it is reported, not
  // gated, because a re-tessellation legitimately moves it. It still must not
  // fabricate a delta from a sentinel.
  countTerm(a.vertexCount, b.vertexCount, false, "vertices", L.vertexDelta);
  countTerm(a.genus, b.genus, tol.requireSameGenus, "genus", L.genusDelta);
  countTerm(a.shellCount, b.shellCount, tol.requireSameShellCount, "shells", L.shellDelta);
  L.validityLost = a.valid && !b.valid;
  if (tol.requireValidityPreserved && L.validityLost) L.violations.push_back("validity");

  L.withinTolerance = L.violations.empty();
  return L;
}

// ── the model ───────────────────────────────────────────────────────────────
bool ExchangeModel::runImport(const std::string& path) {
  ++importCount_;
  diagnostics_.clear();
  lastImport_ = ImportOutcome();
  lastImport_.path = path;

  normaliseImportOptions(import_, diagnostics_);
  lastImport_.scaleApplied = importScaleFactor(import_);
  lastImport_.healing = resolveHealing(import_);

  if (host_ == nullptr) {
    // The SAME shape as ForgeShell's document seam: with no host there is
    // genuinely nothing to import into, and saying so is the honest answer.
    // Silently succeeding is the failure mode the seam exists to remove.
    lastImport_.ok = false;
    lastImport_.error = "no exchange host is installed: this shell has no document to import into";
    diagnostics_.error("no_host", lastImport_.error);
    progress_.fail(lastImport_.error);
    return false;
  }

  progress_.begin(0);
  ImportOutcome out = host_->importFile(path, import_, progress_);
  // The host may not overwrite what the model already decided: the scale and the
  // healing plan are the model's answer, and two answers to one question is the
  // drift this seam exists to prevent.
  out.scaleApplied = lastImport_.scaleApplied;
  out.healing = lastImport_.healing;
  out.path = path;
  // The model's own diagnostics (clamps, unit notes) come FIRST, then the host's.
  for (const ExchangeDiagnostic& d : out.diagnostics.all()) {
    diagnostics_.add(d.severity, d.code, d.message, d.entity);
  }
  lastImport_ = std::move(out);
  if (!progress_.done()) {
    if (lastImport_.ok) {
      progress_.finish();
    } else {
      progress_.fail(lastImport_.error);
    }
  }
  return lastImport_.ok;
}

bool ExchangeModel::runExport(const std::string& path) {
  ++exportCount_;
  diagnostics_.clear();
  lastExport_ = ExportOutcome();
  lastExport_.path = path;
  lastExport_.format = export_.format;

  normaliseExportOptions(export_, diagnostics_);
  lastExport_.scaleApplied = exportScaleFactor(export_);

  if (host_ == nullptr) {
    lastExport_.ok = false;
    lastExport_.error = "no exchange host is installed: this shell has no body to export";
    diagnostics_.error("no_host", lastExport_.error);
    progress_.fail(lastExport_.error);
    return false;
  }
  if (!host_->hasExportableBody()) {
    lastExport_.ok = false;
    lastExport_.error = "the document has no body to export";
    diagnostics_.error("no_body", lastExport_.error);
    progress_.fail(lastExport_.error);
    return false;
  }

  progress_.begin(0);
  ExportOutcome out = host_->exportFile(path, export_, progress_);
  out.scaleApplied = lastExport_.scaleApplied;
  out.path = path;
  for (const ExchangeDiagnostic& d : out.diagnostics.all()) {
    diagnostics_.add(d.severity, d.code, d.message, d.entity);
  }
  lastExport_ = std::move(out);
  if (!progress_.done()) {
    if (lastExport_.ok) {
      progress_.finish();
    } else {
      progress_.fail(lastExport_.error);
    }
  }
  return lastExport_.ok;
}

// ── the commands ────────────────────────────────────────────────────────────
namespace {

std::string textParam(const CommandContext& ctx, const char* name, const char* fallback) {
  return ctx.params().text(name).value_or(std::string(fallback));
}
bool flagParam(const CommandContext& ctx, const char* name, bool fallback) {
  return ctx.params().flag(name).value_or(fallback);
}
double numParam(const CommandContext& ctx, const char* name, double fallback) {
  return ctx.params().number(name).value_or(fallback);
}

ParamSpec textSpec(const char* name, bool required, const char* def, bool hasDefault) {
  ParamSpec p;
  p.name = name;
  p.type = ParamType::Text;
  p.required = required;
  p.defaultText = def;
  p.hasDefault = hasDefault;
  return p;
}
ParamSpec flagSpec(const char* name, bool def) {
  ParamSpec p;
  p.name = name;
  p.type = ParamType::Flag;
  p.required = false;
  p.defaultNumber = def ? 1.0 : 0.0;
  p.hasDefault = true;
  return p;
}
ParamSpec numSpec(const char* name, double def) {
  ParamSpec p;
  p.name = name;
  p.type = ParamType::Number;
  p.required = false;
  p.defaultNumber = def;
  p.hasDefault = true;
  return p;
}

}  // namespace

std::size_t registerExchangeCommands(CommandRegistry& registry, ExchangeModel& model) {
  ExchangeModel* m = &model;
  std::size_t added = 0;
  const auto add = [&registry, &added](CommandDescriptor c) {
    if (registry.add(std::move(c))) ++added;
  };

  // ── IMPORT ────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c;
    c.id = "file.import";
    c.label = "Import…";
    c.category = "File";
    // NO featureIrOp. An import is not an IR statement; declaring one would put a
    // fictional op into the vocabulary the generator derives from this registry.
    c.sideEffect = SideEffectClass::Document;
    c.undo = UndoContract::Transaction;
    c.version = 1;
    // `path` is REQUIRED with NO default: "" is not a file. hasDefault=false is
    // what makes a keyboard gesture report promptFor={"path"} and open a dialog
    // instead of dying on missing_required_parameter.
    c.schema.push_back(textSpec("path", true, "", false));
    // Everything else has an honest default, so Ctrl+I -> pick a file -> go.
    c.schema.push_back(textSpec("format", false, "auto", true));
    c.schema.push_back(flagSpec("auto_units", true));
    c.schema.push_back(textSpec("source_units", false, "mm", true));
    c.schema.push_back(textSpec("document_units", false, "mm", true));
    c.schema.push_back(textSpec("heal", false, "standard", true));
    c.schema.push_back(numSpec("tolerance", kDefaultSewTolerance));
    c.schema.push_back(flagSpec("tolerate_degenerate", true));
    // ALWAYS OFFERED. "There is no host" is reported by the handler, with the
    // reason; a disabled Import that never says why is the shape the owner's
    // constraint forbids.
    c.enabled = [](const CommandContext&) { return true; };
    c.execute = [m](CommandContext& ctx) {
      ImportOptions& o = m->importOptions();
      const std::string fmt = textParam(ctx, "format", "auto");
      o.format = (fmt == "auto") ? ExchangeFormat::Unknown : formatFromString(fmt);
      o.autoDetectUnit = flagParam(ctx, "auto_units", true);
      o.sourceUnit = unitFromString(textParam(ctx, "source_units", "mm"));
      o.documentUnit = unitFromString(textParam(ctx, "document_units", "mm"));
      o.heal = healPolicyFromString(textParam(ctx, "heal", "standard"));
      o.sewTolerance = numParam(ctx, "tolerance", kDefaultSewTolerance);
      o.tolerateDegenerate = flagParam(ctx, "tolerate_degenerate", true);
      const std::string path = textParam(ctx, "path", "");
      if (!m->runImport(path)) {
        // NAME the reason. dispatch() answers Ok for anything that ran, so
        // without this a refused import is indistinguishable from a good one.
        ctx.fail(m->lastImport().error.empty() ? std::string("import failed")
                                               : m->lastImport().error);
      }
    };
    add(std::move(c));
  }

  // ── EXPORT ────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c;
    c.id = "file.export";
    c.label = "Export…";
    c.category = "File";
    c.sideEffect = SideEffectClass::Application;  // writes a file, not the document
    c.undo = UndoContract::NotUndoable;
    c.version = 1;
    c.schema.push_back(textSpec("path", true, "", false));
    c.schema.push_back(textSpec("format", false, "step", true));
    c.schema.push_back(textSpec("document_units", false, "mm", true));
    c.schema.push_back(textSpec("target_units", false, "mm", true));
    c.schema.push_back(flagSpec("analytic", true));
    c.schema.push_back(flagSpec("ascii", true));
    c.schema.push_back(numSpec("linear_tolerance", kDefaultLinearTolerance));
    c.schema.push_back(numSpec("angular_tolerance", kDefaultAngularTolerance));
    // This one IS conditional, and honestly so: there is nothing to write.
    c.enabled = [m](const CommandContext&) {
      return m->host() != nullptr && m->host()->hasExportableBody();
    };
    c.execute = [m](CommandContext& ctx) {
      ExportOptions& o = m->exportOptions();
      o.format = formatFromString(textParam(ctx, "format", "step"));
      o.documentUnit = unitFromString(textParam(ctx, "document_units", "mm"));
      o.targetUnit = unitFromString(textParam(ctx, "target_units", "mm"));
      o.preferAnalytic = flagParam(ctx, "analytic", true);
      o.ascii = flagParam(ctx, "ascii", true);
      o.linearTolerance = numParam(ctx, "linear_tolerance", kDefaultLinearTolerance);
      o.angularTolerance = numParam(ctx, "angular_tolerance", kDefaultAngularTolerance);
      const std::string path = textParam(ctx, "path", "");
      if (!m->runExport(path)) {
        ctx.fail(m->lastExport().error.empty() ? std::string("export failed")
                                               : m->lastExport().error);
      }
    };
    add(std::move(c));
  }

  return added;
}

const std::vector<std::string>& exchangeCommandIds() {
  static const std::vector<std::string> ids = [] {
    std::vector<std::string> v{"file.export", "file.import"};
    std::sort(v.begin(), v.end());
    return v;
  }();
  return ids;
}

}  // namespace forge::ui
