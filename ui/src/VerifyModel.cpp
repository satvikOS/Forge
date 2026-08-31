#include "forge/ui/VerifyModel.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ShapeReport.hpp"

namespace forge::ui {
namespace {

bool isSpace(char c) noexcept {
  return c == ' ' || c == '\t' || c == '\n' || c == '\v' || c == '\f' || c == '\r';
}

// forge::ft's trim(), reproduced. Not std::isspace on a signed char: that is UB
// for a byte above 127, and an assertion pasted from a document with a
// non-breaking space is exactly the input that would hit it.
std::string trimText(const std::string& s) {
  std::size_t a = 0;
  std::size_t b = s.size();
  while (a < b && isSpace(s[a])) ++a;
  while (b > a && isSpace(s[b - 1])) --b;
  return s.substr(a, b - a);
}

std::string lowerText(std::string s) {
  for (char& c : s) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return s;
}

// forge::ft's parseDouble(): strtod, and the WHOLE remainder must be blank.
// "12abc" is not a number, and accepting it would let the UI show a value the
// kernel refuses to parse.
bool parseNumber(const std::string& s, double& out) {
  if (s.empty()) return false;
  const char* p = s.c_str();
  char* end = nullptr;
  out = std::strtod(p, &end);
  if (end == p) return false;
  while (*end != '\0' && isSpace(*end)) ++end;
  return *end == '\0';
}

struct ComparatorSpec {
  const char* token;
  VerifyComparator cmp;
};

// THE ORDER IS THE KERNEL'S, and it is load-bearing. opVerify does
// `for (const char* c : {"<=", ">=", "=", "<", ">"})` and takes the first token
// that occurs ANYWHERE in the string. Searching for "=" before "<=" would read
// "volume<=100" as the key "volume<", which the kernel does not accept —
// so this table must not be sorted, tidied or alphabetised.
const ComparatorSpec kComparators[] = {
    {"<=", VerifyComparator::Le},
    {">=", VerifyComparator::Ge},
    {"=", VerifyComparator::Eq},
    {"<", VerifyComparator::Lt},
    {">", VerifyComparator::Gt},
};

std::string formatValue(double v) { return formatIrNumber(v); }

}  // namespace

const char* toString(VerifyComparator cmp) noexcept {
  switch (cmp) {
    case VerifyComparator::Le: return "<=";
    case VerifyComparator::Ge: return ">=";
    case VerifyComparator::Eq: return "=";
    case VerifyComparator::Lt: return "<";
    case VerifyComparator::Gt: return ">";
  }
  return "=";
}

const char* toString(VerifyStatus status) noexcept {
  switch (status) {
    case VerifyStatus::Pass:        return "pass";
    case VerifyStatus::Fail:        return "fail";
    case VerifyStatus::Unparsable:  return "unparsable";
    case VerifyStatus::Unsupported: return "unsupported";
    case VerifyStatus::Unmeasured:  return "unmeasured";
  }
  return "unparsable";
}

double verifyTolerance(double want) noexcept {
  return std::max(1e-6, 1e-3 * std::fabs(want));
}

// ── the vocabulary ──────────────────────────────────────────────────────────
const std::vector<VerifyQuantitySpec>& verifyVocabulary() {
  static const std::vector<VerifyQuantitySpec> table = {
      {"faces", {"facecount", "nfaces"}, VerifyQuantity::FaceCount, "count",
       "B-rep faces in the built solid", true},
      {"edges", {"edgecount"}, VerifyQuantity::EdgeCount, "count",
       "B-rep edges in the built solid", true},
      {"vertices", {"vertexcount"}, VerifyQuantity::VertexCount, "count",
       "welded vertices of the tessellation (the third census number beside "
       "faces and edges)", true},
      {"volume", {"vol"}, VerifyQuantity::Volume, "mm3", "solid volume", true},
      {"area", {"surfacearea"}, VerifyQuantity::SurfaceArea, "mm2",
       "total surface area of the solid", true},
      {"holes", {"bores"}, VerifyQuantity::HoleCount, "count",
       "distinct holes, one per axis line — a wall split at a seam or into "
       "pilot + counterbore is still one hole", true},
      {"blades", {"radial", "lugs", "spokes"}, VerifyQuantity::RadialCount, "count",
       "fold count of the dominant radial feature group", false},
      {"genus", {}, VerifyQuantity::Genus, "count",
       "topological genus — through-holes the volume cannot see", true},
      {"shells", {"shellcount"}, VerifyQuantity::ShellCount, "count",
       "connected components of the solid", true},
      // The bbox family is spelled out rather than treated as a pattern,
      // because a panel has to be able to LIST what may be written, and
      // "bbox.<axis>[min|max]" is not something a user can click.
      {"bbox.x", {"bbox.xmin", "bbox.xmax", "+x", "-x"}, VerifyQuantity::Bbox, "mm",
       "extent along X, or the extreme X coordinate (bbox.xmin / -x, "
       "bbox.xmax / +x)", true},
      {"bbox.y", {"bbox.ymin", "bbox.ymax", "+y", "-y"}, VerifyQuantity::Bbox, "mm",
       "extent along Y, or the extreme Y coordinate", true},
      {"bbox.z", {"bbox.zmin", "bbox.zmax", "+z", "-z"}, VerifyQuantity::Bbox, "mm",
       "extent along Z, or the extreme Z coordinate", true},
      {"com.x", {}, VerifyQuantity::CentreOfMass, "mm", "centre of mass, X", true},
      {"com.y", {}, VerifyQuantity::CentreOfMass, "mm", "centre of mass, Y", true},
      {"com.z", {}, VerifyQuantity::CentreOfMass, "mm", "centre of mass, Z", true},
      // Radius AND diameter, both named, because a drawing states a diameter
      // and the face inventory stores a radius. "the largest bore" without a
      // unit is how a 5 mm edit silently becomes a 10 mm edit.
      {"bore.maxdia", {}, VerifyQuantity::BoreExtreme, "mm",
       "diameter of the LARGEST hole — what \"shrink the largest bore\" means",
       true},
      {"bore.mindia", {}, VerifyQuantity::BoreExtreme, "mm",
       "diameter of the smallest hole", true},
      {"bore.maxr", {}, VerifyQuantity::BoreExtreme, "mm",
       "radius of the largest hole", true},
      {"bore.minr", {}, VerifyQuantity::BoreExtreme, "mm",
       "radius of the smallest hole", true},
  };
  return table;
}

std::vector<std::string> verifyQuantityNames() {
  std::vector<std::string> out;
  for (const VerifyQuantitySpec& spec : verifyVocabulary()) {
    out.push_back(spec.canonical);
    for (const std::string& alias : spec.aliases) out.push_back(alias);
  }
  std::sort(out.begin(), out.end());
  out.erase(std::unique(out.begin(), out.end()), out.end());
  return out;
}

// ── parse ───────────────────────────────────────────────────────────────────
namespace {

// Resolve a lower-cased key onto a quantity plus its family parameters.
// Returns false for a key no spelling in the vocabulary matches — the caller
// then produces an Unsupported assertion rather than refusing the text.
bool resolveKey(const std::string& key, VerifyAssertion& out) {
  // The bbox / position family first: it is the only one with structure, and
  // resolving it by table lookup would need 18 rows to say one rule.
  //
  //   bbox.z                 EXTENT along z          (key.size() == 6)
  //   bbox.zmin / bbox.zmax  the extreme COORDINATE  (key.size() == 9)
  //   -z / +z                aliases for zmin / zmax (key.size() == 2)
  //
  // The size tests are the kernel's own; reproducing them means "bbox.zz" is
  // rejected here for exactly the reason the kernel rejects it.
  if (key.size() == 2 && (key[0] == '+' || key[0] == '-') && key[1] >= 'x' && key[1] <= 'z') {
    out.quantity = VerifyQuantity::Bbox;
    out.axis = static_cast<std::size_t>(key[1] - 'x');
    out.aspect = (key[0] == '+') ? BboxAspect::Max : BboxAspect::Min;
    return true;
  }
  if (key.rfind("bbox.", 0) == 0 && (key.size() == 6 || key.size() == 9)) {
    const char ax = key[5];
    if (ax < 'x' || ax > 'z') return false;
    out.quantity = VerifyQuantity::Bbox;
    out.axis = static_cast<std::size_t>(ax - 'x');
    if (key.size() == 6) {
      out.aspect = BboxAspect::Extent;
      return true;
    }
    const std::string suffix = key.substr(6);
    if (suffix == "min") out.aspect = BboxAspect::Min;
    else if (suffix == "max") out.aspect = BboxAspect::Max;
    else return false;
    return true;
  }
  if (key.size() == 5 && key.rfind("com.", 0) == 0 && key[4] >= 'x' && key[4] <= 'z') {
    out.quantity = VerifyQuantity::CentreOfMass;
    out.axis = static_cast<std::size_t>(key[4] - 'x');
    return true;
  }
  if (key == "bore.maxdia" || key == "bore.mindia" || key == "bore.maxr" ||
      key == "bore.minr") {
    out.quantity = VerifyQuantity::BoreExtreme;
    if (key == "bore.maxdia")      out.boreKind = BoreExtremeKind::MaxDiameter;
    else if (key == "bore.mindia") out.boreKind = BoreExtremeKind::MinDiameter;
    else if (key == "bore.maxr")   out.boreKind = BoreExtremeKind::MaxRadius;
    else                           out.boreKind = BoreExtremeKind::MinRadius;
    return true;
  }

  for (const VerifyQuantitySpec& spec : verifyVocabulary()) {
    if (spec.quantity == VerifyQuantity::Bbox || spec.quantity == VerifyQuantity::CentreOfMass ||
        spec.quantity == VerifyQuantity::BoreExtreme) {
      continue;  // handled structurally above
    }
    if (spec.canonical == key) {
      out.quantity = spec.quantity;
      return true;
    }
    for (const std::string& alias : spec.aliases) {
      if (alias == key) {
        out.quantity = spec.quantity;
        return true;
      }
    }
  }
  return false;
}

}  // namespace

VerifyAssertion parseVerifyAssertion(const std::string& text) {
  VerifyAssertion a;
  a.source = text;

  std::size_t found = std::string::npos;
  std::size_t tokenLen = 0;
  for (const ComparatorSpec& spec : kComparators) {
    const std::string token(spec.token);
    const std::size_t p = text.find(token);
    if (p == std::string::npos) continue;
    found = p;
    tokenLen = token.size();
    a.comparator = spec.cmp;
    break;
  }
  if (found == std::string::npos) {
    a.error =
        "no comparator — an assertion is <quantity><=|>=|=|<|><value>, e.g. "
        "\"faces=42\"";
    return a;
  }

  a.key = lowerText(trimText(text.substr(0, found)));
  const std::string valueText = trimText(text.substr(found + tokenLen));
  if (a.key.empty()) {
    a.error = "no quantity before the comparator";
    return a;
  }
  if (!parseNumber(valueText, a.want)) {
    a.error = valueText.empty() ? std::string("no value after the comparator")
                                : ("\"" + valueText + "\" is not a number");
    return a;
  }

  a.parsed = true;
  if (!resolveKey(a.key, a)) {
    a.quantity = VerifyQuantity::Unknown;
    // NOT an error: the kernel is the authority on its own vocabulary, and this
    // model must not refuse a quantity the kernel gained since it was written.
    // The assertion still parses and is still emitted; evaluateVerify() reports
    // Unsupported so the panel can say it cannot preview this one.
  }
  return a;
}

std::string VerifyAssertion::text() const {
  if (!parsed) return source;
  return key + toString(comparator) + formatValue(want);
}

// ── evaluate ────────────────────────────────────────────────────────────────
namespace {

// `got` for a quantity, or false when this report has no value for it.
bool measureQuantity(const VerifyAssertion& a, const ShapeReport& r, double& got,
                     std::string& why) {
  const auto fromCount = [&got, &why](long v, const char* what) {
    if (v == kUnmeasuredCount) {
      why = std::string(what) + " was not measured on this body";
      return false;
    }
    got = static_cast<double>(v);
    return true;
  };

  switch (a.quantity) {
    case VerifyQuantity::FaceCount:   return fromCount(r.faceCount, "the face count");
    case VerifyQuantity::EdgeCount:   return fromCount(r.edgeCount, "the edge count");
    case VerifyQuantity::VertexCount: return fromCount(r.vertexCount, "the vertex count");
    case VerifyQuantity::Genus:       return fromCount(r.genus, "the genus");
    case VerifyQuantity::ShellCount:  return fromCount(r.shellCount, "the shell count");
    case VerifyQuantity::Volume:
      got = r.volume;
      return true;
    case VerifyQuantity::SurfaceArea:
      // Prefer the kernel's own figure; fall back to the census sum, which is
      // the same quantity summed a different way. Refuse only when there is
      // neither — a zero here would be a fabricated area.
      if (r.surfaceArea > 0.0) { got = r.surfaceArea; return true; }
      if (r.hasCensus()) { got = r.censusArea(); return true; }
      why = "no surface area and no face census on this body";
      return false;
    case VerifyQuantity::HoleCount:
      if (!r.boresDegraded.empty()) {
        // The list is an OVER-COUNT and forge_verify said so. Reporting it as a
        // measurement would put a number in front of a user that the kernel has
        // already disclaimed.
        why = "the hole census was degraded (" + r.boresDegraded + ") — it over-counts";
        return false;
      }
      got = static_cast<double>(r.bores.size());
      return true;
    case VerifyQuantity::Bbox: {
      if (!r.bboxValid) {
        why = "no bounding box on this body";
        return false;
      }
      if (a.axis > 2) {
        why = "bad bbox axis";
        return false;
      }
      switch (a.aspect) {
        case BboxAspect::Extent: got = r.bboxSize(a.axis); break;
        case BboxAspect::Min:    got = r.bboxMin[a.axis];  break;
        case BboxAspect::Max:    got = r.bboxMax[a.axis];  break;
      }
      return true;
    }
    case VerifyQuantity::CentreOfMass: {
      // The centre of mass is NOT the bbox centre, and substituting one for the
      // other would be a plausible wrong number — exactly the failure this
      // programme keeps paying for. KernelScene fills `centreOfMass` from
      // forge::massProperties; without it there is nothing to report.
      if (!r.measured) {
        why = "no measured body";
        return false;
      }
      if (a.axis > 2) {
        why = "bad centre-of-mass axis";
        return false;
      }
      if (!r.hasCentreOfMass) {
        why = "the centre of mass was not measured on this body";
        return false;
      }
      got = r.centreOfMass[a.axis];
      return true;
    }
    case VerifyQuantity::BoreExtreme: {
      if (!r.boresDegraded.empty()) {
        why = "the hole census was degraded (" + r.boresDegraded + ")";
        return false;
      }
      if (r.bores.empty()) {
        why = "this body has no holes";
        return false;
      }
      const bool wantMax = a.boreKind == BoreExtremeKind::MaxDiameter ||
                           a.boreKind == BoreExtremeKind::MaxRadius;
      const std::size_t idx = wantMax ? largestBore(r) : smallestBore(r);
      if (idx == kNoBore) {
        why = "this body has no holes";
        return false;
      }
      const bool wantDia = a.boreKind == BoreExtremeKind::MaxDiameter ||
                           a.boreKind == BoreExtremeKind::MinDiameter;
      got = wantDia ? r.bores[idx].diameter() : r.bores[idx].radius;
      return true;
    }
    case VerifyQuantity::RadialCount:
      // The kernel measures this by angular clustering over the face centroids
      // of a UNIFIED body. forge::ui has the census but not the unification, and
      // clustering an un-unified census would give a DIFFERENT answer than the
      // kernel's — a preview that disagrees with the build is worse than no
      // preview. Declared not previewable in the vocabulary, and declined here.
      why =
          "the radial fold count is measured on the unified body by the kernel; "
          "the app cannot preview it";
      return false;
    case VerifyQuantity::Unknown:
      why = "unknown quantity";
      return false;
  }
  why = "unknown quantity";
  return false;
}

}  // namespace

VerifyResult evaluateVerify(const VerifyAssertion& a, const ShapeReport& report) {
  VerifyResult out;
  if (!a.parsed) {
    out.status = VerifyStatus::Unparsable;
    out.note = a.error;
    return out;
  }
  if (a.quantity == VerifyQuantity::Unknown) {
    out.status = VerifyStatus::Unsupported;
    out.note = "`" + a.key + "` is not a quantity this app can measure — the kernel decides";
    return out;
  }
  if (!report.measured) {
    out.status = VerifyStatus::Unmeasured;
    out.note = report.error.empty() ? "no measured body" : report.error;
    return out;
  }

  double got = 0.0;
  std::string why;
  if (!measureQuantity(a, report, got, why)) {
    out.status = (a.quantity == VerifyQuantity::RadialCount) ? VerifyStatus::Unsupported
                                                             : VerifyStatus::Unmeasured;
    out.note = why;
    return out;
  }
  out.got = got;
  out.hasGot = true;

  const double tol = verifyTolerance(a.want);
  bool pass = false;
  switch (a.comparator) {
    case VerifyComparator::Eq: pass = std::fabs(got - a.want) <= tol; break;
    case VerifyComparator::Le: pass = got <= a.want + tol; break;
    case VerifyComparator::Ge: pass = got >= a.want - tol; break;
    case VerifyComparator::Lt: pass = got < a.want; break;   // strict: no tolerance
    case VerifyComparator::Gt: pass = got > a.want; break;   // strict: no tolerance
  }
  out.status = pass ? VerifyStatus::Pass : VerifyStatus::Fail;
  return out;
}

VerifyResult checkVerify(const std::string& text, const ShapeReport& report) {
  return evaluateVerify(parseVerifyAssertion(text), report);
}

VerifyAssertion measuredAssertion(const VerifyAssertion& a, const ShapeReport& report) {
  VerifyAssertion out = a;
  out.parsed = false;
  if (!a.parsed) {
    out.error = a.error;
    return out;
  }
  const VerifyResult r = evaluateVerify(a, report);
  if (!r.hasGot) {
    out.error = r.note.empty() ? "nothing measured for this quantity" : r.note;
    return out;
  }
  out.parsed = true;
  out.error.clear();
  out.want = r.got;
  out.source = out.text();
  return out;
}

// ── the statement ───────────────────────────────────────────────────────────
std::vector<IrArg> verifyIrArgs(int bodyRef, const std::vector<std::string>& assertions) {
  std::vector<IrArg> args;
  args.reserve(assertions.size() + 1);
  args.push_back(IrArg::valueRef(bodyRef));
  for (const std::string& text : assertions) args.push_back(IrArg::text(text));
  return args;
}

// ── the kernel's own log ────────────────────────────────────────────────────
VerifyLogEntry parseVerifyLogLine(const std::string& line) {
  VerifyLogEntry e;
  e.raw = line;
  // "PASS <expr> (got <n>)" / "FAIL <expr> (got <n>)".
  if (line.rfind("PASS ", 0) == 0)      e.pass = true;
  else if (line.rfind("FAIL ", 0) == 0) e.pass = false;
  else return e;

  const std::string rest = line.substr(5);
  // rfind, not find: an expression may legitimately contain "(got " if a future
  // selector spelling does, and the suffix is what this format guarantees.
  const std::size_t gotAt = rest.rfind(" (got ");
  if (gotAt == std::string::npos) {
    e.recognised = true;
    e.expression = trimText(rest);
    return e;
  }
  e.recognised = true;
  e.expression = trimText(rest.substr(0, gotAt));
  std::string value = rest.substr(gotAt + 6);
  if (!value.empty() && value.back() == ')') value.pop_back();
  e.hasGot = parseNumber(trimText(value), e.got);
  return e;
}

std::vector<VerifyLogEntry> parseVerifyLog(const std::vector<std::string>& lines) {
  std::vector<VerifyLogEntry> out;
  out.reserve(lines.size());
  for (const std::string& line : lines) out.push_back(parseVerifyLogLine(line));
  return out;
}

// ── the authoring session ───────────────────────────────────────────────────
bool VerifyDraft::add(const std::string& text) {
  const VerifyAssertion a = parseVerifyAssertion(text);
  if (!a.parsed) return false;
  texts_.push_back(trimText(text));
  return true;
}

bool VerifyDraft::replace(std::size_t index, const std::string& text) {
  if (index >= texts_.size()) return false;
  const VerifyAssertion a = parseVerifyAssertion(text);
  if (!a.parsed) return false;
  texts_[index] = trimText(text);
  return true;
}

bool VerifyDraft::remove(std::size_t index) {
  if (index >= texts_.size()) return false;
  texts_.erase(texts_.begin() + static_cast<std::ptrdiff_t>(index));
  return true;
}

void VerifyDraft::clear() noexcept { texts_.clear(); }

std::vector<VerifyDraft::Row> VerifyDraft::rows(const ShapeReport& report) const {
  std::vector<Row> out;
  out.reserve(texts_.size());
  for (const std::string& text : texts_) {
    Row row;
    row.text = text;
    row.assertion = parseVerifyAssertion(text);
    row.result = evaluateVerify(row.assertion, report);
    out.push_back(std::move(row));
  }
  return out;
}

std::size_t VerifyDraft::failingCount(const ShapeReport& report) const {
  std::size_t n = 0;
  for (const std::string& text : texts_) {
    if (checkVerify(text, report).status == VerifyStatus::Fail) ++n;
  }
  return n;
}

std::size_t VerifyDraft::repairFailing(const ShapeReport& report) {
  std::size_t changed = 0;
  for (std::string& text : texts_) {
    const VerifyAssertion a = parseVerifyAssertion(text);
    if (evaluateVerify(a, report).status != VerifyStatus::Fail) continue;
    const VerifyAssertion fixed = measuredAssertion(a, report);
    if (!fixed.parsed) continue;  // nothing measured: leave the claim as written
    const std::string next = fixed.text();
    if (next == text) continue;
    text = next;
    ++changed;
  }
  return changed;
}

std::vector<IrArg> VerifyDraft::irArgs(int bodyRef) const {
  return verifyIrArgs(bodyRef, texts_);
}

std::string VerifyDraft::exportText(const ShapeReport& report) const {
  std::string out;
  for (const Row& row : rows(report)) {
    out += toString(row.result.status);
    out += "\t";
    out += row.text;
    if (row.result.hasGot) out += "\tgot " + measureNumber(row.result.got);
    else if (!row.result.note.empty()) out += "\t" + row.result.note;
    out += "\n";
  }
  return out;
}

// ── seeding from a measurement ──────────────────────────────────────────────
std::vector<std::string> describeAssertions(const ShapeReport& report) {
  std::vector<std::string> out;
  if (!report.measured) return out;
  const auto push = [&out, &report](const char* key) {
    const VerifyAssertion a = parseVerifyAssertion(std::string(key) + "=0");
    const VerifyAssertion fixed = measuredAssertion(a, report);
    // Only emit what was actually measured. An assertion produced here must
    // pass by construction — that is the entire value of the button.
    if (fixed.parsed) out.push_back(fixed.text());
  };
  push("faces");
  push("edges");
  push("vertices");
  push("genus");
  push("shells");
  push("volume");
  push("holes");
  push("bore.maxdia");
  push("bbox.x");
  push("bbox.y");
  push("bbox.z");
  return out;
}

}  // namespace forge::ui
