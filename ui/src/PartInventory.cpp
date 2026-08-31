// ui/src/PartInventory.cpp — the measured inventory, and the grounding built on it.
#include "forge/ui/PartInventory.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {
namespace {

// ── formatting ──────────────────────────────────────────────────────────────
// One spelling of a measured number everywhere, so the panel, the transcript and
// the gate all quote the SAME digits. %.3f is a millimetre model's honest
// resolution and, unlike %g, it never switches to exponent form mid-list.
std::string fmt(double v) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.3f", v);
  return std::string(buf);
}

std::string fmtTriple(const double v[3]) {
  return "(" + fmt(v[0]) + ", " + fmt(v[1]) + ", " + fmt(v[2]) + ")";
}

// "+Z" when the axis is a signed principal direction, the vector otherwise. A
// planner reading "along +Z" and a planner reading "along (0.000, 0.000, 1.000)"
// are reading the same fact; the first is the one a person can check at a glance.
std::string axisName(const double a[3]) {
  const char* names[3] = {"X", "Y", "Z"};
  for (int i = 0; i < 3; ++i) {
    const int j = (i + 1) % 3;
    const int k = (i + 2) % 3;
    if (std::fabs(std::fabs(a[i]) - 1.0) < 1e-6 && std::fabs(a[j]) < 1e-6 &&
        std::fabs(a[k]) < 1e-6) {
      return (a[i] > 0.0 ? "+" : "-") + std::string(names[i]);
    }
  }
  return fmtTriple(a);
}

// ── a minimal JSON reader for ONE schema ────────────────────────────────────
// forge_verify's response, and nothing else. It reads the keys PartInventory
// declares and ignores every other key, so a verifier that grows a field does
// not break the CoPilot. It executes nothing it reads, and it bounds its own
// recursion: a hostile 100k-deep array must fail the parse, not the stack.
constexpr int kMaxJsonDepth = 32;

struct JsonValue {
  enum class Type : std::uint8_t { Null, Bool, Number, String, Array, Object };
  Type type = Type::Null;
  bool boolean = false;
  double number = 0.0;
  std::string str;
  std::vector<JsonValue> items;                             // Array
  std::vector<std::pair<std::string, JsonValue>> members;   // Object

  const JsonValue* member(const std::string& key) const {
    if (type != Type::Object) return nullptr;
    for (const auto& kv : members) {
      if (kv.first == key) return &kv.second;
    }
    return nullptr;
  }
  double num(double fallback) const { return type == Type::Number ? number : fallback; }
};

struct JsonReader {
  const std::string& text;
  std::size_t i = 0;
  std::string error;

  explicit JsonReader(const std::string& t) : text(t) {}

  void skipSpace() {
    while (i < text.size()) {
      const char c = text[i];
      if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
        ++i;
      } else {
        return;
      }
    }
  }

  bool literal(const char* word) {
    const std::size_t n = std::string(word).size();
    if (text.compare(i, n, word) != 0) return false;
    i += n;
    return true;
  }

  // Emits the code point as UTF-8. A surrogate half with no partner is written
  // as U+FFFD rather than dropped: a silently shortened string is a value that
  // no longer equals what was measured.
  static void appendUtf8(std::string& out, std::uint32_t cp) {
    if (cp < 0x80) {
      out.push_back(static_cast<char>(cp));
    } else if (cp < 0x800) {
      out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
      out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp < 0x10000) {
      out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
      out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
      out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
      out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
  }

  bool hex4(std::uint32_t& out) {
    if (i + 4 > text.size()) return false;
    out = 0;
    for (int k = 0; k < 4; ++k) {
      const char c = text[i + static_cast<std::size_t>(k)];
      std::uint32_t d = 0;
      if (c >= '0' && c <= '9') {
        d = static_cast<std::uint32_t>(c - '0');
      } else if (c >= 'a' && c <= 'f') {
        d = static_cast<std::uint32_t>(c - 'a' + 10);
      } else if (c >= 'A' && c <= 'F') {
        d = static_cast<std::uint32_t>(c - 'A' + 10);
      } else {
        return false;
      }
      out = (out << 4) | d;
    }
    i += 4;
    return true;
  }

  bool readString(std::string& out) {
    if (i >= text.size() || text[i] != '"') {
      error = "expected a string";
      return false;
    }
    ++i;
    out.clear();
    while (i < text.size()) {
      const char c = text[i++];
      if (c == '"') return true;
      if (c != '\\') {
        out.push_back(c);
        continue;
      }
      if (i >= text.size()) break;
      const char esc = text[i++];
      switch (esc) {
        case '"': out.push_back('"'); break;
        case '\\': out.push_back('\\'); break;
        case '/': out.push_back('/'); break;
        case 'b': out.push_back('\b'); break;
        case 'f': out.push_back('\f'); break;
        case 'n': out.push_back('\n'); break;
        case 'r': out.push_back('\r'); break;
        case 't': out.push_back('\t'); break;
        case 'u': {
          std::uint32_t cp = 0;
          if (!hex4(cp)) {
            error = "bad \\u escape";
            return false;
          }
          if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < text.size() && text[i] == '\\' &&
              text[i + 1] == 'u') {
            const std::size_t save = i;
            i += 2;
            std::uint32_t lo = 0;
            if (hex4(lo) && lo >= 0xDC00 && lo <= 0xDFFF) {
              cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            } else {
              i = save;
              cp = 0xFFFD;
            }
          } else if (cp >= 0xD800 && cp <= 0xDFFF) {
            cp = 0xFFFD;
          }
          appendUtf8(out, cp);
          break;
        }
        default:
          error = "unknown escape";
          return false;
      }
    }
    error = "unterminated string";
    return false;
  }

  bool readValue(JsonValue& out, int depth) {
    if (depth > kMaxJsonDepth) {
      error = "nesting deeper than " + std::to_string(kMaxJsonDepth);
      return false;
    }
    skipSpace();
    if (i >= text.size()) {
      error = "unexpected end of input";
      return false;
    }
    const char c = text[i];
    if (c == '{') {
      ++i;
      out.type = JsonValue::Type::Object;
      skipSpace();
      if (i < text.size() && text[i] == '}') {
        ++i;
        return true;
      }
      for (;;) {
        skipSpace();
        std::string key;
        if (!readString(key)) return false;
        skipSpace();
        if (i >= text.size() || text[i] != ':') {
          error = "expected ':'";
          return false;
        }
        ++i;
        JsonValue value;
        if (!readValue(value, depth + 1)) return false;
        out.members.emplace_back(std::move(key), std::move(value));
        skipSpace();
        if (i < text.size() && text[i] == ',') {
          ++i;
          continue;
        }
        if (i < text.size() && text[i] == '}') {
          ++i;
          return true;
        }
        error = "expected ',' or '}'";
        return false;
      }
    }
    if (c == '[') {
      ++i;
      out.type = JsonValue::Type::Array;
      skipSpace();
      if (i < text.size() && text[i] == ']') {
        ++i;
        return true;
      }
      for (;;) {
        JsonValue value;
        if (!readValue(value, depth + 1)) return false;
        out.items.push_back(std::move(value));
        skipSpace();
        if (i < text.size() && text[i] == ',') {
          ++i;
          continue;
        }
        if (i < text.size() && text[i] == ']') {
          ++i;
          return true;
        }
        error = "expected ',' or ']'";
        return false;
      }
    }
    if (c == '"') {
      out.type = JsonValue::Type::String;
      return readString(out.str);
    }
    if (literal("true")) {
      out.type = JsonValue::Type::Bool;
      out.boolean = true;
      return true;
    }
    if (literal("false")) {
      out.type = JsonValue::Type::Bool;
      out.boolean = false;
      return true;
    }
    if (literal("null")) {
      out.type = JsonValue::Type::Null;
      return true;
    }
    // A number. strtod is given the remaining text and its own end pointer, so a
    // malformed number is a parse failure rather than a silent zero.
    const char* begin = text.c_str() + i;
    char* end = nullptr;
    const double v = std::strtod(begin, &end);
    if (end == begin) {
      error = "not a JSON value";
      return false;
    }
    // NaN/Infinity are not JSON, and strtod accepts both spellings. A census
    // carrying "nan" is a broken measurement, not a face at nan.
    if (!std::isfinite(v)) {
      error = "non-finite number";
      return false;
    }
    i += static_cast<std::size_t>(end - begin);
    out.type = JsonValue::Type::Number;
    out.number = v;
    return true;
  }
};

bool parseJson(const std::string& text, JsonValue& out, std::string& why) {
  JsonReader r(text);
  if (!r.readValue(out, 0)) {
    why = r.error.empty() ? std::string("could not be parsed as JSON") : r.error;
    return false;
  }
  return true;
}

bool readTriple(const JsonValue* v, double out[3]) {
  if (v == nullptr || v->type != JsonValue::Type::Array || v->items.size() != 3) return false;
  for (std::size_t k = 0; k < 3; ++k) {
    if (v->items[k].type != JsonValue::Type::Number) return false;
    out[k] = v->items[k].number;
  }
  return true;
}

// ── vector helpers ──────────────────────────────────────────────────────────
double dot3(const double a[3], const double b[3]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

double norm3(const double a[3]) { return std::sqrt(dot3(a, a)); }

// Perpendicular distance from `p` to the line through `at` with direction `dir`.
// A bore's `at` is A point on its axis, not THE point a HOLE statement names, so
// comparing the two points directly would reject every hole whose statement
// placed it on a different face of the same wall. `degenerate` is set when the
// direction has no length and the answer falls back to a plain distance.
double distanceToAxis(const double p[3], const double at[3], const double dir[3],
                      bool& degenerate) {
  const double v[3] = {p[0] - at[0], p[1] - at[1], p[2] - at[2]};
  const double len = norm3(dir);
  if (!(len > 1e-12)) {
    degenerate = true;
    return norm3(v);
  }
  degenerate = false;
  const double u[3] = {dir[0] / len, dir[1] / len, dir[2] / len};
  const double t = dot3(v, u);
  const double perp[3] = {v[0] - t * u[0], v[1] - t * u[1], v[2] - t * u[2]};
  return norm3(perp);
}

// ── phrase tokens ───────────────────────────────────────────────────────────
std::string lower(const std::string& s) {
  std::string out = s;
  for (char& c : out) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return out;
}

// Splits on anything that is not a letter, a digit, a dot or a minus. "5mm"
// becomes {"5mm"} and numberPrefix() below reads the 5 out of it, because a user
// typing "by 5mm" is not making a mistake.
std::vector<std::string> words(const std::string& text) {
  std::vector<std::string> out;
  std::string cur;
  for (const char raw : text) {
    const char c = static_cast<char>((raw >= 'A' && raw <= 'Z') ? raw - 'A' + 'a' : raw);
    const bool keep = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-';
    if (keep) {
      cur.push_back(c);
    } else if (!cur.empty()) {
      out.push_back(cur);
      cur.clear();
    }
  }
  if (!cur.empty()) out.push_back(cur);
  return out;
}

// The leading number of a token, so "5mm" and "12.5" both read. Returns false
// when the token does not begin with a number at all.
bool numberPrefix(const std::string& token, double& value) {
  if (token.empty()) return false;
  const char* begin = token.c_str();
  char* end = nullptr;
  const double v = std::strtod(begin, &end);
  if (end == begin) return false;
  if (!std::isfinite(v)) return false;
  value = v;
  return true;
}

bool isOneOf(const std::string& w, const std::vector<std::string>& set) {
  return std::find(set.begin(), set.end(), w) != set.end();
}

// "3rd" / "3" -> 3, and the written forms up to tenth. 0 means "not an ordinal".
std::size_t ordinalWord(const std::string& w) {
  static const std::vector<std::string> kWritten = {
      "",       "first", "second", "third", "fourth", "fifth",
      "sixth",  "seventh", "eighth", "ninth", "tenth"};
  for (std::size_t k = 1; k < kWritten.size(); ++k) {
    if (w == kWritten[k]) return k;
  }
  double v = 0.0;
  if (!numberPrefix(w, v)) return 0;
  if (!(v >= 1.0) || v != std::floor(v) || v > 1e6) return 0;
  return static_cast<std::size_t>(v);
}

}  // namespace

// ── display ─────────────────────────────────────────────────────────────────
const char* toString(BoreRank rank) noexcept {
  switch (rank) {
    case BoreRank::Largest: return "largest";
    case BoreRank::Smallest: return "smallest";
    case BoreRank::Deepest: return "deepest";
    case BoreRank::Ordinal: return "ordinal";
  }
  return "largest";
}

std::string FaceRecord::display() const {
  std::string out = kind;
  out += " #" + std::to_string(index);
  out += " area " + fmt(area);
  out += " at " + fmtTriple(centroid);
  if (hasRadius) out += " r " + fmt(radius);
  if (kind == "torus") out += " minor " + fmt(minorRadius);
  if (hasAxis) out += (kind == "plane" ? " normal " : " axis ") + axisName(axis);
  if (concave) out += " concave";
  return out;
}

std::string BoreRecord::display() const {
  return "⌀" + fmt(diameter()) + " at " + fmtTriple(centre) + " span " + fmt(span) +
         " along " + axisName(axis);
}

// ── the census ──────────────────────────────────────────────────────────────
long PartInventory::kindCount(const std::string& kind) const noexcept {
  for (const auto& kv : kindHistogram) {
    if (kv.first == kind) return kv.second;
  }
  return 0;
}

std::vector<std::size_t> PartInventory::boresRanked(BoreRank rank) const {
  std::vector<std::size_t> order(bores.size());
  for (std::size_t k = 0; k < order.size(); ++k) order[k] = k;
  if (rank == BoreRank::Ordinal) return order;
  // stable_sort, and the comparator is STRICT: equal keys keep census order, so
  // the ranking is total and two runs of the same question rank identically.
  std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
    switch (rank) {
      case BoreRank::Largest: return bores[a].radius > bores[b].radius;
      case BoreRank::Smallest: return bores[a].radius < bores[b].radius;
      case BoreRank::Deepest: return bores[a].span > bores[b].span;
      case BoreRank::Ordinal: return false;
    }
    return false;
  });
  return order;
}

const BoreRecord* PartInventory::bore(BoreRank rank, std::size_t ordinal) const {
  if (!measured || bores.empty()) return nullptr;
  const std::vector<std::size_t> order = boresRanked(rank);
  const std::size_t want = rank == BoreRank::Ordinal ? ordinal : 1;
  if (want == 0 || want > order.size()) return nullptr;
  return &bores[order[want - 1]];
}

std::string PartInventory::summary() const {
  if (!measured) return "no measured census (nothing has been verified yet)";
  std::string out = std::to_string(faceCount) + " faces";
  if (!kindHistogram.empty()) {
    out += " (";
    for (std::size_t k = 0; k < kindHistogram.size(); ++k) {
      if (k != 0) out += ", ";
      out += kindHistogram[k].first + " " + std::to_string(kindHistogram[k].second);
    }
    out += ")";
  }
  out += ", " + std::to_string(bores.size()) + (bores.size() == 1 ? " bore" : " bores");
  return out;
}

std::string PartInventory::contextBlock(std::size_t maxBores) const {
  if (!measured) {
    return "MEASURED PART INVENTORY: none. Nothing has been verified, so no "
           "question about \"the largest bore\" can be grounded yet.\n";
  }
  std::string out = "MEASURED PART INVENTORY";
  if (!source.empty()) out += " (" + source + ")";
  out += "\n  faces: " + std::to_string(faceCount);
  if (!kindHistogram.empty()) {
    out += "  —  ";
    for (std::size_t k = 0; k < kindHistogram.size(); ++k) {
      if (k != 0) out += ", ";
      out += kindHistogram[k].first + " " + std::to_string(kindHistogram[k].second);
    }
  }
  out += "\n";
  if (hasBbox) {
    out += "  bbox:  min " + fmtTriple(bboxMin) + "  max " + fmtTriple(bboxMax) + "\n";
  }
  out += "  bores: " + std::to_string(bores.size()) + "\n";
  const std::vector<std::size_t> largest = boresRanked(BoreRank::Largest);
  const std::size_t shown = std::min(maxBores, bores.size());
  for (std::size_t k = 0; k < shown; ++k) {
    out += "    #" + std::to_string(k + 1) + "  " + bores[k].display();
    if (!largest.empty() && largest.front() == k) out += "   [largest]";
    if (!largest.empty() && largest.back() == k && largest.size() > 1) out += "   [smallest]";
    out += "\n";
  }
  if (shown < bores.size()) {
    out += "    … and " + std::to_string(bores.size() - shown) +
           " more (the count above is complete; this list is not)\n";
  }
  return out;
}

bool PartInventory::parseVerifyJson(const std::string& json, PartInventory& out,
                                    std::string& why) {
  why.clear();
  JsonValue root;
  if (!parseJson(json, root, why)) return false;
  if (root.type != JsonValue::Type::Object) {
    why = "the response is not a JSON object";
    return false;
  }

  const JsonValue* census = root.member("census");
  const JsonValue* boresValue = root.member("bores");
  if (census == nullptr && boresValue == nullptr) {
    // Name what was missing AND what would supply it. A parse failure that does
    // not say how to fix it makes the caller guess at the protocol.
    why =
        "the response carries neither \"census\" nor \"bores\": re-run forge_verify "
        "with {\"census\":\"full\"}";
    return false;
  }

  PartInventory built;
  built.measured = true;
  built.source = census != nullptr ? "forge_verify census=full" : "forge_verify bores";

  if (census != nullptr && census->type == JsonValue::Type::Object) {
    const JsonValue* fc = census->member("faceCount");
    if (fc != nullptr && fc->type == JsonValue::Type::Number && fc->number >= 0.0) {
      built.faceCount = static_cast<std::size_t>(fc->number);
    }
    const JsonValue* hist = census->member("kind_histogram");
    if (hist != nullptr && hist->type == JsonValue::Type::Object) {
      for (const auto& kv : hist->members) {
        if (kv.second.type != JsonValue::Type::Number) continue;
        built.kindHistogram.emplace_back(kv.first, static_cast<long>(kv.second.number));
      }
    }
    const JsonValue* bbox = census->member("bbox");
    if (bbox != nullptr) {
      const bool lo = readTriple(bbox->member("min"), built.bboxMin);
      const bool hi = readTriple(bbox->member("max"), built.bboxMax);
      built.hasBbox = lo && hi;
    }
    const JsonValue* faces = census->member("faces");
    if (faces != nullptr && faces->type == JsonValue::Type::Array) {
      built.faces.reserve(faces->items.size());
      for (const JsonValue& f : faces->items) {
        if (f.type != JsonValue::Type::Object) continue;
        FaceRecord rec;
        const JsonValue* kind = f.member("kind");
        if (kind != nullptr && kind->type == JsonValue::Type::String) rec.kind = kind->str;
        const JsonValue* area = f.member("area");
        rec.area = area != nullptr ? area->num(0.0) : 0.0;
        readTriple(f.member("centroid"), rec.centroid);
        const JsonValue* radius = f.member("radius");
        if (radius != nullptr && radius->type == JsonValue::Type::Number) {
          rec.radius = radius->number;
          rec.hasRadius = true;
        }
        const JsonValue* major = f.member("major");
        if (major != nullptr && major->type == JsonValue::Type::Number) {
          rec.radius = major->number;
          rec.hasRadius = true;
        }
        const JsonValue* minor = f.member("minor");
        if (minor != nullptr && minor->type == JsonValue::Type::Number) {
          rec.minorRadius = minor->number;
        }
        // A plane's direction arrives as "normal" and a quadric's as "axis".
        // Both land in `axis`; `kind` says which it is, and display() says so too.
        rec.hasAxis = readTriple(f.member("axis"), rec.axis);
        if (!rec.hasAxis) rec.hasAxis = readTriple(f.member("normal"), rec.axis);
        rec.hasAxisAt = readTriple(f.member("axisAt"), rec.axisAt);
        const JsonValue* concave = f.member("concave");
        rec.concave = concave != nullptr && concave->type == JsonValue::Type::Bool &&
                      concave->boolean;
        const JsonValue* index = f.member("index");
        rec.index = index != nullptr ? static_cast<int>(index->num(-1.0)) : -1;
        built.faces.push_back(std::move(rec));
      }
    }
  }

  if (boresValue != nullptr && boresValue->type == JsonValue::Type::Array) {
    built.bores.reserve(boresValue->items.size());
    for (const JsonValue& b : boresValue->items) {
      if (b.type != JsonValue::Type::Object) continue;
      BoreRecord rec;
      const JsonValue* r = b.member("r");
      rec.radius = r != nullptr ? r->num(0.0) : 0.0;
      const JsonValue* span = b.member("span");
      rec.span = span != nullptr ? span->num(0.0) : 0.0;
      const JsonValue* faces = b.member("faces");
      rec.faces = faces != nullptr ? static_cast<int>(faces->num(0.0)) : 0;
      if (!readTriple(b.member("at"), rec.centre)) {
        // Older callers get cx/cy and assume the Z axis; honour that form rather
        // than dropping the bore, and say nothing that is not measured: z stays 0.
        const JsonValue* cx = b.member("cx");
        const JsonValue* cy = b.member("cy");
        rec.centre[0] = cx != nullptr ? cx->num(0.0) : 0.0;
        rec.centre[1] = cy != nullptr ? cy->num(0.0) : 0.0;
        rec.centre[2] = 0.0;
      }
      if (!readTriple(b.member("axis"), rec.axis)) {
        rec.axis[0] = 0.0;
        rec.axis[1] = 0.0;
        rec.axis[2] = 1.0;
      }
      built.bores.push_back(rec);
    }
  }

  // faceCount is what the census STATES. When the face array is present it must
  // agree with it: a census whose header and body disagree is not a measurement,
  // and taking the larger of the two would invent faces nobody saw.
  if (!built.faces.empty() && built.faceCount != built.faces.size()) {
    why = "census faceCount " + std::to_string(built.faceCount) + " but " +
          std::to_string(built.faces.size()) + " face records";
    return false;
  }
  if (built.faces.empty() && built.faceCount == 0 && census != nullptr) {
    const JsonValue* fc = census->member("faceCount");
    if (fc == nullptr) {
      why = "the census states no faceCount";
      return false;
    }
  }

  out = std::move(built);
  return true;
}

// ── matching a bore to the statement that made it ───────────────────────────
std::string BoreFeatureMatch::display() const {
  if (!matched) return "unmatched: " + why;
  std::string out = "%" + std::to_string(irId) + " " + op + " ⌀" + fmt(currentDiameter) +
                    " (arg " + std::to_string(numericIndex) + ")";
  out += ", Δ⌀ " + fmt(diameterError) + ", off-axis " + fmt(centreDistance);
  if (!why.empty()) out += " — " + why;
  return out;
}

namespace {

// Where a HOLE / CBORE statement states its diameter and its centre.
//
// Positional, and CHECKED against the arity the emitting command produces, so a
// statement of another shape is skipped rather than read at the wrong offset.
// The layouts are the two the registry emits (ui/src/PartCommands.cpp):
//   HOLE (%body, d, x, y, z [, ax, ay, az, depth])
//   CBORE(%body, d, cbore_d, cbore_depth, x, y, z)
struct BoreStatementShape {
  bool ok = false;
  std::size_t diameterArg = 0;   // index into IrLine::args
  std::size_t centreArg = 0;     // index of x; y and z follow it
};

BoreStatementShape boreShape(const IrLine& line) {
  BoreStatementShape s;
  if (line.op == "HOLE") {
    if (line.args.size() != 5 && line.args.size() != 9) return s;
    s.diameterArg = 1;
    s.centreArg = 2;
  } else if (line.op == "CBORE") {
    if (line.args.size() != 7) return s;
    s.diameterArg = 1;
    s.centreArg = 4;
  } else {
    return s;
  }
  if (line.args[0].kind != IrArgKind::Ref) return s;
  for (std::size_t k = s.diameterArg; k < s.centreArg + 3; ++k) {
    if (line.args[k].kind != IrArgKind::Number) return s;
  }
  s.ok = true;
  return s;
}

// part.edit_feature's `index` counts NUMBER arguments only, skipping the leading
// %ref. Derived here rather than assumed, so a change to the statement's shape
// cannot silently point the edit at the wrong argument.
std::size_t numericIndexOf(const IrLine& line, std::size_t argIndex) {
  std::size_t seen = 0;
  for (std::size_t k = 0; k < line.args.size() && k < argIndex; ++k) {
    if (line.args[k].kind == IrArgKind::Number) ++seen;
  }
  return seen;
}

}  // namespace

BoreFeatureMatch matchBoreToFeature(const BoreRecord& bore, const PartDocument& document,
                                    double diameterTol, double centreTol) {
  BoreFeatureMatch out;
  const double wanted = bore.diameter();

  struct Candidate {
    int irId = 0;
    std::string op;
    std::size_t numericIndex = 0;
    double stated = 0.0;
    double diameterError = 0.0;
    double centreDistance = 0.0;
  };
  std::vector<Candidate> byDiameter;
  double nearestDiameterError = -1.0;
  bool anyDegenerate = false;

  for (const FeatureRecord& rec : document.records()) {
    const BoreStatementShape shape = boreShape(rec.line);
    if (!shape.ok) continue;
    out.candidates.push_back(rec.line.id);

    Candidate c;
    c.irId = rec.line.id;
    c.op = rec.line.op;
    c.numericIndex = numericIndexOf(rec.line, shape.diameterArg);
    c.stated = rec.line.args[shape.diameterArg].number;
    c.diameterError = std::fabs(c.stated - wanted);
    const double centre[3] = {rec.line.args[shape.centreArg].number,
                              rec.line.args[shape.centreArg + 1].number,
                              rec.line.args[shape.centreArg + 2].number};
    bool degenerate = false;
    c.centreDistance = distanceToAxis(centre, bore.centre, bore.axis, degenerate);
    anyDegenerate = anyDegenerate || degenerate;

    if (nearestDiameterError < 0.0 || c.diameterError < nearestDiameterError) {
      nearestDiameterError = c.diameterError;
    }
    if (c.diameterError <= diameterTol) byDiameter.push_back(c);
  }

  if (out.candidates.empty()) {
    out.why = "the document holds no HOLE or CBORE statement to edit";
    return out;
  }
  if (byDiameter.empty()) {
    out.why = "no HOLE/CBORE states diameter " + fmt(wanted) + " within " + fmt(diameterTol) +
              " mm (nearest is off by " + fmt(nearestDiameterError) + " mm)";
    return out;
  }

  // Best by centre, ties broken by the LOWEST statement id so the choice is
  // deterministic. Ambiguity is REPORTED rather than refused: the step is shown
  // to the user with the note attached, which is the whole point of a plan that
  // must be read before it runs.
  std::stable_sort(byDiameter.begin(), byDiameter.end(), [](const Candidate& a, const Candidate& b) {
    if (a.centreDistance != b.centreDistance) return a.centreDistance < b.centreDistance;
    return a.irId < b.irId;
  });
  const Candidate& best = byDiameter.front();
  if (best.centreDistance > centreTol) {
    out.why = "a HOLE/CBORE states diameter " + fmt(wanted) + " but the nearest one is " +
              fmt(best.centreDistance) + " mm off this bore's axis (tolerance " + fmt(centreTol) +
              " mm)";
    return out;
  }

  out.matched = true;
  out.irId = best.irId;
  out.op = best.op;
  out.numericIndex = best.numericIndex;
  out.currentDiameter = best.stated;
  out.diameterError = best.diameterError;
  out.centreDistance = best.centreDistance;
  if (byDiameter.size() > 1 && byDiameter[1].centreDistance <= centreTol) {
    out.why = "ambiguous: %" + std::to_string(byDiameter[1].irId) +
              " matches this bore too; chose the lowest statement id";
  }
  if (anyDegenerate) {
    out.why += (out.why.empty() ? "" : "; ");
    out.why += "a bore axis had no direction, so distance was measured point-to-point";
  }
  return out;
}

// ── the grounded edit ───────────────────────────────────────────────────────
GroundedEdit groundBoreDiameterEdit(const PartInventory& inventory, const PartDocument& document,
                                    BoreRank rank, double delta, bool absolute,
                                    std::size_t ordinal) {
  GroundedEdit out;
  const std::string what =
      rank == BoreRank::Ordinal ? "bore " + std::to_string(ordinal) : std::string(toString(rank)) + " bore";

  if (!inventory.measured) {
    out.why = "no measured census: run forge_verify with {\"census\":\"full\"} before asking "
              "about the " + what;
    return out;
  }
  const BoreRecord* bore = inventory.bore(rank, ordinal);
  if (bore == nullptr) {
    out.why = "the census measured " + std::to_string(inventory.bores.size()) +
              " bores, so there is no " + what;
    return out;
  }
  out.match = matchBoreToFeature(*bore, document);
  if (!out.match.matched) {
    out.why = "the " + what + " is " + bore->display() + ", but " + out.match.why;
    return out;
  }

  out.fromDiameter = out.match.currentDiameter;
  out.toDiameter = absolute ? delta : out.fromDiameter + delta;
  if (!(out.toDiameter > 0.0)) {
    // The ONE refusal in this file, and it is a representability fact, not a
    // policy: a diameter of zero or less is not a bore in any kernel.
    out.why = "that would make the " + what + " ⌀" + fmt(out.toDiameter) +
              ", which is not a bore";
    return out;
  }

  PlanStep step;
  step.commandId = "part.edit_feature";
  step.irOp.clear();  // the command rewrites a statement; it emits no new op
  step.select = PlanSelect::Keep;
  step.args.push_back(PlanArg::num("feature", static_cast<double>(out.match.irId)));
  step.args.push_back(PlanArg::num("index", static_cast<double>(out.match.numericIndex)));
  step.args.push_back(PlanArg::num("value", out.toDiameter));

  out.grounding = "the " + what + " measures " + bore->display() + "; it was made by %" +
                  std::to_string(out.match.irId) + " " + out.match.op + " ⌀" +
                  fmt(out.fromDiameter) + " (Δ⌀ " + fmt(out.match.diameterError) +
                  " mm, off-axis " + fmt(out.match.centreDistance) + " mm); " +
                  (absolute ? "set to " : (delta < 0.0 ? "shrink to " : "grow to ")) +
                  "⌀" + fmt(out.toDiameter);
  if (!out.match.why.empty()) out.grounding += " [" + out.match.why + "]";
  step.note = out.grounding;

  out.step = std::move(step);
  out.ok = true;
  return out;
}

// ── the phrase ──────────────────────────────────────────────────────────────
BoreEditPhrase parseBoreEditPhrase(const std::string& text) {
  BoreEditPhrase out;
  const std::vector<std::string> w = words(lower(text));
  if (w.empty()) {
    out.why = "empty";
    return out;
  }

  static const std::vector<std::string> kShrink = {"shrink", "reduce", "decrease", "narrow"};
  static const std::vector<std::string> kGrow = {"enlarge", "grow", "increase", "widen", "open"};
  static const std::vector<std::string> kSet = {"set", "change", "make", "resize"};
  static const std::vector<std::string> kNoun = {"bore", "bores", "hole", "holes"};
  static const std::vector<std::string> kLargest = {"largest", "biggest", "widest", "greatest",
                                                    "largest-diameter"};
  static const std::vector<std::string> kSmallest = {"smallest", "tightest", "narrowest",
                                                     "least"};
  static const std::vector<std::string> kDeepest = {"deepest", "longest"};

  int sign = 0;
  bool sawSet = false;
  bool sawNoun = false;
  bool sawRank = false;
  for (const std::string& t : w) {
    if (isOneOf(t, kShrink)) sign = -1;
    if (isOneOf(t, kGrow)) sign = +1;
    if (isOneOf(t, kSet)) sawSet = true;
    if (isOneOf(t, kNoun)) sawNoun = true;
    if (isOneOf(t, kLargest)) { out.rank = BoreRank::Largest; sawRank = true; }
    if (isOneOf(t, kSmallest)) { out.rank = BoreRank::Smallest; sawRank = true; }
    if (isOneOf(t, kDeepest)) { out.rank = BoreRank::Deepest; sawRank = true; }
  }
  if (!sawNoun) {
    out.why = "no \"bore\" or \"hole\" in the request";
    return out;
  }

  // "bore 3" / "the 3rd bore" -> an ordinal. Read only ADJACENT to the noun, so
  // the 5 in "by 5 mm" can never be mistaken for a bore number.
  if (!sawRank) {
    for (std::size_t k = 0; k < w.size(); ++k) {
      if (!isOneOf(w[k], kNoun)) continue;
      std::size_t n = 0;
      if (k + 1 < w.size()) n = ordinalWord(w[k + 1]);
      if (n == 0 && k > 0) n = ordinalWord(w[k - 1]);
      if (n != 0) {
        out.rank = BoreRank::Ordinal;
        out.ordinal = n;
        sawRank = true;
        break;
      }
    }
  }
  if (!sawRank) {
    out.why = "the request names no bore: say \"the largest bore\", \"the smallest hole\", "
              "\"the deepest bore\" or \"bore 3\"";
    return out;
  }

  // The amount, and WHICH PREPOSITION introduced it. "to 12" is an absolute
  // diameter and "by 5" is a delta; reading the number without its preposition
  // is how a 5 mm shrink becomes a 5 mm bore.
  bool haveAmount = false;
  for (std::size_t k = 0; k + 1 < w.size(); ++k) {
    if (w[k] != "by" && w[k] != "to") continue;
    double v = 0.0;
    if (!numberPrefix(w[k + 1], v)) continue;
    out.absolute = (w[k] == "to");
    out.delta = v;
    haveAmount = true;
    break;
  }
  if (!haveAmount) {
    out.why = "the request states no amount: say \"by 5 mm\" or \"to 12 mm\"";
    return out;
  }

  if (out.absolute) {
    if (!(out.delta > 0.0)) {
      out.why = "a diameter of " + fmt(out.delta) + " mm is not a bore";
      return out;
    }
    // "to 12 mm" needs no verb: an absolute diameter is not ambiguous about
    // direction, so `sign` and `sawSet` are not consulted here.
    (void)sawSet;
  } else {
    if (sign == 0) {
      out.why = "the request does not say whether to shrink or enlarge";
      return out;
    }
    out.delta = std::fabs(out.delta) * static_cast<double>(sign);
  }

  out.recognised = true;
  return out;
}

}  // namespace forge::ui
