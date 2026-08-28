#include "forge/retrieval/Redactor.hpp"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <set>
#include <string_view>
#include <unordered_set>

namespace forge::retrieval {
namespace {

using StrSet = std::unordered_set<std::string>;

bool isAsciiDigit(unsigned char c) { return c >= '0' && c <= '9'; }
bool isAsciiAlpha(unsigned char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
bool isAsciiAlnum(unsigned char c) { return isAsciiDigit(c) || isAsciiAlpha(c); }

std::string toLower(std::string s) {
  for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

std::string toUpper(std::string s) {
  for (char& c : s) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  return s;
}

// Standards and specification bodies whose numbers are PUBLIC designations.
const StrSet& standardsBodies() {
  static const StrSet kBodies = {
      "ISO", "ASME", "ASTM", "ANSI", "DIN", "EN", "JIS", "BS", "SAE", "AISI", "AWS", "API",
      "IEC", "NFPA", "UL", "MIL", "MILSTD", "MIL-STD", "GB", "CSA", "AGMA", "ABMA", "NEMA",
      "IPC", "ASHRAE", "ISA", "NACE", "VDI", "GOST", "NZS", "UNI", "ECSS", "AMS", "QQ",
      "UNS", "AA", "AISC", "ACI", "AASHTO", "ITU", "ETSI", "SEMI", "OSHA", "EASA", "FAA",
      "CFR", "EUROCODE", "EC", "PED", "ATEX", "REACH", "ROHS", "ISO/TS", "ISO/IEC",
  };
  return kBodies;
}

// Bolt property classes (ISO 898-1) — a public catalogue value, not a dimension.
const StrSet& boltPropertyClasses() {
  static const StrSet kClasses = {"4.6", "4.8", "5.6", "5.8", "6.8", "8.8", "9.8", "10.9", "12.9"};
  return kClasses;
}

// Material context words that license a bare grade number ("stainless 316L").
const StrSet& materialContextWords() {
  static const StrSet kWords = {"stainless", "steel", "ss", "grade", "alloy", "type", "aluminum",
                                "aluminium", "brass", "bronze", "copper", "titanium", "inconel",
                                "series", "temper", "cast", "iron"};
  return kWords;
}

// Bare unit words. A unit that directly follows a stripped dimension carries no
// information on its own and is dropped so the outgoing query stays minimal.
const StrSet& unitWords() {
  static const StrSet kUnits = {
      "mm", "cm", "m", "km", "um", "micron", "microns", "nm", "in", "inch", "inches", "ft",
      "feet", "mil", "mils", "thou", "deg", "degree", "degrees", "rad", "kg", "g", "mg", "lb",
      "lbs", "oz", "n", "kn", "mn", "nm", "lbf", "ftlb", "mpa", "gpa", "kpa", "pa", "psi",
      "ksi", "bar", "atm", "mm2", "mm3", "cm2", "cm3", "cc", "ml", "l", "hz", "khz", "rpm",
      "s", "sec", "ms", "min", "hr", "h", "c", "f", "k", "w", "kw", "v", "a", "ma", "j", "kj"};
  return kUnits;
}

// Capitalized words that are legitimately public: sentence openers, engineering
// vocabulary, standards bodies, and well-known eponymous/trade terms. The
// registered lexicon is the AUTHORITATIVE mechanism for private names; this
// heuristic is defense-in-depth for names nobody registered, and it deliberately
// fails toward over-redaction.
const StrSet& publicCapitalizedVocabulary() {
  static const StrSet kVocab = {
      // interrogatives / articles / prepositions that can open a query
      "what", "which", "how", "why", "when", "where", "who", "is", "are", "does", "do", "can",
      "the", "a", "an", "for", "in", "on", "of", "to", "per", "and", "or", "with", "without",
      "under", "over", "between", "give", "list", "find", "cite", "state", "define",
      // document structure
      "table", "annex", "clause", "section", "figure", "appendix", "part", "chapter", "note",
      // engineering vocabulary
      "class", "grade", "type", "series", "size", "torque", "preload", "thread", "bolt", "nut",
      "screw", "washer", "fastener", "weld", "fillet", "chamfer", "radius", "hole", "bore",
      "shaft", "bearing", "gear", "spline", "keyway", "flange", "gasket", "seal", "oring",
      "tolerance", "fit", "clearance", "interference", "surface", "roughness", "finish",
      "hardness", "yield", "ultimate", "strength", "stiffness", "modulus", "fatigue", "creep",
      "corrosion", "coating", "plating", "anodize", "anodizing", "passivation", "galvanizing",
      "steel", "stainless", "aluminum", "aluminium", "titanium", "copper", "brass", "bronze",
      "polymer", "composite", "ceramic", "casting", "forging", "extrusion", "machining",
      "milling", "turning", "grinding", "welding", "brazing", "soldering", "additive",
      "pressure", "vessel", "pipe", "tube", "valve", "pump", "compressor", "turbine", "motor",
      "datum", "feature", "control", "frame", "position", "flatness", "perpendicularity",
      "concentricity", "runout", "profile", "cylindricity", "straightness", "angularity",
      // eponymous and public trade terms
      "inconel", "hastelloy", "monel", "nitronic", "invar", "kovar", "teflon", "ptfe", "peek",
      "delrin", "nylon", "kevlar", "viton", "loctite", "belleville", "rockwell", "brinell",
      "vickers", "knoop", "charpy", "izod", "poisson", "young", "reynolds", "nusselt", "prandtl",
      "mach", "kelvin", "newton", "pascal", "celsius", "fahrenheit", "goodman", "miner",
      "neuber", "mises", "von", "tresca", "hertz", "weibull", "paris", "timoshenko", "euler",
      "bernoulli", "navier", "stokes", "coulomb", "mohr", "bauschinger", "archard", "arrhenius",
      "acme", "unified", "metric", "imperial", "whitworth", "unc", "unf", "npt", "bsp", "bspp"};
  return kVocab;
}

bool isBoundedNumeric(std::string_view t) {
  // [+-]?digits[.digits][e[+-]digits] with optional thousands separators.
  std::size_t i = 0;
  if (i < t.size() && (t[i] == '+' || t[i] == '-')) ++i;
  bool sawDigit = false;
  while (i < t.size() && (isAsciiDigit(static_cast<unsigned char>(t[i])) || t[i] == ',')) {
    if (t[i] != ',') sawDigit = true;
    ++i;
  }
  if (!sawDigit) return false;
  if (i < t.size() && t[i] == '.') {
    ++i;
    while (i < t.size() && isAsciiDigit(static_cast<unsigned char>(t[i]))) ++i;
  }
  if (i < t.size() && (t[i] == 'e' || t[i] == 'E')) {
    std::size_t save = i;
    ++i;
    if (i < t.size() && (t[i] == '+' || t[i] == '-')) ++i;
    if (i < t.size() && isAsciiDigit(static_cast<unsigned char>(t[i]))) {
      while (i < t.size() && isAsciiDigit(static_cast<unsigned char>(t[i]))) ++i;
    } else {
      i = save;
    }
  }
  return i == t.size();
}

// Diameter/radius sigils that can precede a value: Ø (C398 U+00D8), ⌀ (U+2300), R, D.
std::string stripDimensionSigils(const std::string& token) {
  static const char* kSigils[] = {"\xC3\x98", "\xC3\xB8", "\xE2\x8C\x80", "\xE2\x8C\x80"};
  std::string t = token;
  bool changed = true;
  while (changed) {
    changed = false;
    for (const char* sig : kSigils) {
      const std::size_t n = std::char_traits<char>::length(sig);
      if (t.size() > n && t.compare(0, n, sig) == 0) {
        t.erase(0, n);
        changed = true;
      }
    }
    if (t.size() > 1 && (t[0] == 'R' || t[0] == 'r' || t[0] == 'D' || t[0] == 'd') &&
        isAsciiDigit(static_cast<unsigned char>(t[1]))) {
      t.erase(0, 1);
      changed = true;
    }
  }
  return t;
}

// A numeric value carrying a unit or a sigil, a bare number, a fraction, or a
// numeric range — every shape a secret dimension can take in free text.
bool looksLikeDimension(const std::string& token) {
  const std::string bare = stripDimensionSigils(token);
  if (bare.empty()) return false;
  if (isBoundedNumeric(bare)) return true;
  // number + unit suffix, e.g. 47.625mm, 12deg, 1200rpm
  std::size_t split = 0;
  while (split < bare.size() &&
         (isAsciiDigit(static_cast<unsigned char>(bare[split])) || bare[split] == '.' ||
          bare[split] == ',' || bare[split] == '+' || bare[split] == '-')) {
    ++split;
  }
  if (split > 0 && split < bare.size()) {
    const std::string head = bare.substr(0, split);
    const std::string tail = toLower(bare.substr(split));
    if (isBoundedNumeric(head) && unitWords().count(tail)) return true;
    if (isBoundedNumeric(head) && (tail == "\"" || tail == "'")) return true;
  }
  // fraction 3/8 or 1-1/2, and ranges 12-15
  bool allNumericOrSep = true;
  bool sawDigit = false;
  for (const unsigned char c : bare) {
    if (isAsciiDigit(c)) { sawDigit = true; continue; }
    if (c == '/' || c == '-' || c == '.' || c == ',' || c == 0xC2 || c == 0xB1) continue;
    allNumericOrSep = false;
    break;
  }
  return allNumericOrSep && sawDigit;
}

// Prefixes that mark an internal document/order identifier.
bool looksLikeDrawingReference(const std::string& token) {
  static const StrSet kPrefixes = {"dwg", "drg", "drw", "pn", "p/n", "sk", "so", "po", "ecn",
                                   "eco", "mrb", "car", "ncr", "wo", "rev", "sheet", "assy",
                                   "asm", "doc", "spec"};
  const std::string lower = toLower(token);
  for (std::size_t cut = 1; cut <= lower.size() && cut <= 6; ++cut) {
    const std::string head = lower.substr(0, cut);
    if (!kPrefixes.count(head)) continue;
    if (cut == lower.size()) continue;  // bare word, not an identifier
    const char sep = lower[cut];
    if (sep == '-' || sep == '_' || sep == '/' || sep == '.' || isAsciiDigit(static_cast<unsigned char>(sep))) {
      return true;
    }
  }
  return false;
}

bool looksLikeEmail(const std::string& token) {
  const std::size_t at = token.find('@');
  if (at == std::string::npos || at == 0 || at + 1 >= token.size()) return false;
  return token.find('.', at + 1) != std::string::npos;
}

bool looksLikeUrl(const std::string& token) {
  const std::string lower = toLower(token);
  return lower.find("://") != std::string::npos || lower.rfind("www.", 0) == 0;
}

bool looksLikePath(const std::string& token) {
  if (token.rfind("~/", 0) == 0) return true;
  if (token.size() >= 3 && isAsciiAlpha(static_cast<unsigned char>(token[0])) && token[1] == ':' &&
      (token[2] == '\\' || token[2] == '/')) {
    return true;
  }
  if (token[0] != '/' && token.rfind("./", 0) != 0 && token.rfind("../", 0) != 0) return false;
  return std::count(token.begin(), token.end(), '/') >= 2;
}

bool hasDigitAndAlpha(const std::string& token) {
  bool d = false, a = false;
  for (const unsigned char c : token) {
    if (isAsciiDigit(c)) d = true;
    else if (isAsciiAlpha(c)) a = true;
  }
  return d && a;
}

bool allAlnum(const std::string& token) {
  for (const unsigned char c : token) {
    if (!isAsciiAlnum(c)) return false;
  }
  return !token.empty();
}

std::string trimPunctuation(const std::string& token, std::size_t& lead_out) {
  static const std::string kPunct = ".,;:!?()[]{}\"'`";
  std::size_t b = 0, e = token.size();
  while (b < e && kPunct.find(token[b]) != std::string::npos) ++b;
  while (e > b && kPunct.find(token[e - 1]) != std::string::npos) --e;
  lead_out = b;
  return token.substr(b, e - b);
}

struct Span {
  std::size_t begin = 0;
  std::size_t end = 0;
  RedactionKind kind{};
};

const char* markerFor(RedactionKind kind) {
  switch (kind) {
    case RedactionKind::RegisteredCustomer: return "[CUSTOMER]";
    case RedactionKind::RegisteredProject: return "[PROJECT]";
    case RedactionKind::RegisteredSupplier: return "[SUPPLIER]";
    case RedactionKind::RegisteredSecret: return "[PROPRIETARY]";
    case RedactionKind::PartNumber: return "[PART_NUMBER]";
    case RedactionKind::DimensionLiteral: return "[DIM]";
    case RedactionKind::DrawingReference: return "[DRAWING]";
    case RedactionKind::EmailAddress: return "[EMAIL]";
    case RedactionKind::FilesystemPath: return "[PATH]";
    case RedactionKind::Url: return "[URL]";
    case RedactionKind::OpaqueIdentifier: return "[ID]";
    case RedactionKind::ProperNoun: return "[NAME]";
  }
  return "[REDACTED]";
}

// Every numeric literal in a buffer, as (text, value) pairs.
std::vector<std::pair<std::string, double>> scanNumericLiterals(const std::string& text) {
  std::vector<std::pair<std::string, double>> out;
  std::size_t i = 0;
  while (i < text.size()) {
    if (!isAsciiDigit(static_cast<unsigned char>(text[i]))) { ++i; continue; }
    std::size_t begin = i;
    if (begin > 0 && (text[begin - 1] == '.' || text[begin - 1] == '-')) {
      // keep the sign/point so 47.625 is one literal, not "47" and "625"
      std::size_t back = begin - 1;
      if (text[back] == '.' && back > 0 && isAsciiDigit(static_cast<unsigned char>(text[back - 1]))) {
        ++i;
        continue;  // interior of a literal already emitted
      }
      if (text[back] == '-') begin = back;
    }
    std::size_t j = i;
    while (j < text.size() && isAsciiDigit(static_cast<unsigned char>(text[j]))) ++j;
    if (j < text.size() && text[j] == '.' && j + 1 < text.size() &&
        isAsciiDigit(static_cast<unsigned char>(text[j + 1]))) {
      ++j;
      while (j < text.size() && isAsciiDigit(static_cast<unsigned char>(text[j]))) ++j;
    }
    const std::string lit = text.substr(begin, j - begin);
    double v = 0.0;
    const char* first = lit.data();
    const char* last = lit.data() + lit.size();
    if (std::from_chars(first, last, v).ec == std::errc()) out.emplace_back(lit, v);
    i = j;
  }
  return out;
}

}  // namespace

const char* redactionKindName(RedactionKind kind) {
  switch (kind) {
    case RedactionKind::RegisteredCustomer: return "RegisteredCustomer";
    case RedactionKind::RegisteredProject: return "RegisteredProject";
    case RedactionKind::RegisteredSupplier: return "RegisteredSupplier";
    case RedactionKind::RegisteredSecret: return "RegisteredSecret";
    case RedactionKind::PartNumber: return "PartNumber";
    case RedactionKind::DimensionLiteral: return "DimensionLiteral";
    case RedactionKind::DrawingReference: return "DrawingReference";
    case RedactionKind::EmailAddress: return "EmailAddress";
    case RedactionKind::FilesystemPath: return "FilesystemPath";
    case RedactionKind::Url: return "Url";
    case RedactionKind::OpaqueIdentifier: return "OpaqueIdentifier";
    case RedactionKind::ProperNoun: return "ProperNoun";
  }
  return "Unknown";
}

bool RedactionResult::removedAnyOf(RedactionKind kind) const { return countOf(kind) > 0; }

std::size_t RedactionResult::countOf(RedactionKind kind) const {
  std::size_t n = 0;
  for (const RedactionEvent& e : events) {
    if (e.kind == kind) ++n;
  }
  return n;
}

namespace detail {

std::string normalizeForMatch(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (const unsigned char c : s) {
    if (isAsciiAlnum(c)) out.push_back(static_cast<char>(std::tolower(c)));
  }
  return out;
}

std::string decodeForResidueScan(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  auto hexVal = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  for (std::size_t i = 0; i < s.size();) {
    if (s[i] == '+') { out.push_back(' '); ++i; continue; }
    if (s[i] == '%' && i + 2 < s.size()) {
      const int hi = hexVal(s[i + 1]);
      const int lo = hexVal(s[i + 2]);
      if (hi >= 0 && lo >= 0) {
        out.push_back(static_cast<char>((hi << 4) | lo));
        i += 3;
        continue;
      }
    }
    if (s[i] == '\\' && i + 5 < s.size() && (s[i + 1] == 'u' || s[i + 1] == 'U')) {
      int v = 0;
      bool ok = true;
      for (int k = 0; k < 4; ++k) {
        const int d = hexVal(s[i + 2 + static_cast<std::size_t>(k)]);
        if (d < 0) { ok = false; break; }
        v = (v << 4) | d;
      }
      if (ok) {
        // Only ASCII matters for residue matching; wider code points are kept as
        // a placeholder byte so surrounding text still lines up.
        out.push_back(v < 0x80 ? static_cast<char>(v) : '?');
        i += 6;
        continue;
      }
    }
    out.push_back(s[i]);
    ++i;
  }
  return out;
}

bool isPublicDesignation(const std::string& token, const std::string& previous_token,
                         bool allow_thread_designations) {
  if (token.empty()) return false;
  const std::string upper = toUpper(token);
  const std::string lowerPrev = toLower(previous_token);
  const std::string upperPrev = toUpper(previous_token);

  // 1. body glued to its number: ISO2768, EN10025, MIL-STD-810
  for (std::size_t cut = 2; cut <= upper.size() && cut <= 8; ++cut) {
    const std::string head = upper.substr(0, cut);
    if (!standardsBodies().count(head)) continue;
    const std::string tail = upper.substr(cut);
    if (tail.empty()) continue;
    if (isAsciiDigit(static_cast<unsigned char>(tail[0])) || tail[0] == '-' || tail[0] == '/' ||
        tail[0] == ' ') {
      return true;
    }
  }
  // 2. body in the PREVIOUS token: "ISO 2768", "ASME Y14.5", "EN 10025-2"
  if (standardsBodies().count(upperPrev) && !upper.empty()) {
    if (isAsciiDigit(static_cast<unsigned char>(upper[0]))) return true;
    if (isAsciiAlpha(static_cast<unsigned char>(upper[0])) && hasDigitAndAlpha(upper)) return true;
  }
  // 3. aluminium temper designations: 6061-T6, 7075-T651, 2024-T3
  {
    const std::size_t dash = upper.find('-');
    if (dash == 4 && dash + 2 <= upper.size() && upper[dash + 1] == 'T') {
      bool digits = true;
      for (std::size_t k = 0; k < 4; ++k) {
        if (!isAsciiDigit(static_cast<unsigned char>(upper[k]))) { digits = false; break; }
      }
      if (digits) return true;
    }
  }
  // 4. bolt property class, licensed by an explicit class/grade context word
  if (boltPropertyClasses().count(upper) &&
      (lowerPrev == "class" || lowerPrev == "property" || lowerPrev == "grade")) {
    return true;
  }
  // 5. bare material grade licensed by a material context word: "stainless 316L"
  if (materialContextWords().count(lowerPrev)) {
    bool digitsThenOptionalLetter = !upper.empty();
    std::size_t k = 0;
    while (k < upper.size() && isAsciiDigit(static_cast<unsigned char>(upper[k]))) ++k;
    if (k == 0 || k > 5) digitsThenOptionalLetter = false;
    while (k < upper.size() && isAsciiAlpha(static_cast<unsigned char>(upper[k]))) ++k;
    if (k != upper.size()) digitsThenOptionalLetter = false;
    if (digitsThenOptionalLetter) return true;
  }
  // 6. ASTM structural steel shorthand: A36, A572, A992
  if (upper.size() >= 2 && upper.size() <= 5 && upper[0] == 'A') {
    bool rest = true;
    for (std::size_t k = 1; k < upper.size(); ++k) {
      if (!isAsciiDigit(static_cast<unsigned char>(upper[k]))) { rest = false; break; }
    }
    if (rest && upper.size() >= 3) return true;
  }
  // 7. public metric thread callout: M12, M8x1.25
  if (allow_thread_designations && upper.size() >= 2 && upper[0] == 'M' &&
      isAsciiDigit(static_cast<unsigned char>(upper[1]))) {
    bool ok = true;
    for (std::size_t k = 1; k < upper.size(); ++k) {
      const unsigned char c = static_cast<unsigned char>(upper[k]);
      if (!isAsciiDigit(c) && c != '.' && c != 'X') { ok = false; break; }
    }
    if (ok) return true;
  }
  // 8. unified-series thread callout carrying its series suffix: 1/4-20UNC
  if (allow_thread_designations) {
    for (const char* series : {"UNC", "UNF", "UNEF", "NPT", "NPTF", "BSPP", "BSPT"}) {
      const std::size_t n = std::char_traits<char>::length(series);
      if (upper.size() > n && upper.compare(upper.size() - n, n, series) == 0) return true;
    }
  }
  return false;
}

}  // namespace detail

Redactor::Redactor(PrivateLexicon lexicon, RedactionPolicy policy)
    : lexicon_(std::move(lexicon)), policy_(policy) {}

RedactionResult Redactor::redact(const std::string& raw) const {
  RedactionResult result;

  // ── phase 1: registered-phrase pass ────────────────────────────────────────
  // Match every lexicon term against a punctuation- and case-insensitive
  // normalization of the input, so "ACME-4471-B", "acme 4471 b" and "Acme4471B"
  // are all the same term. An index map carries matches back to raw offsets.
  std::string norm;
  std::vector<std::size_t> map;
  norm.reserve(raw.size());
  map.reserve(raw.size());
  for (std::size_t i = 0; i < raw.size(); ++i) {
    const unsigned char c = static_cast<unsigned char>(raw[i]);
    if (isAsciiAlnum(c)) {
      norm.push_back(static_cast<char>(std::tolower(c)));
      map.push_back(i);
    }
  }

  std::vector<Span> spans;
  auto markCategory = [&](const std::vector<std::string>& terms, RedactionKind kind) {
    for (const std::string& term : terms) {
      const std::string needle = detail::normalizeForMatch(term);
      if (needle.size() < 3) continue;  // too short to match without false hits
      std::size_t at = norm.find(needle, 0);
      while (at != std::string::npos) {
        const std::size_t begin = map[at];
        const std::size_t end = map[at + needle.size() - 1] + 1;
        spans.push_back(Span{begin, end, kind});
        at = norm.find(needle, at + 1);
      }
    }
  };
  markCategory(lexicon_.customer_names, RedactionKind::RegisteredCustomer);
  markCategory(lexicon_.project_names, RedactionKind::RegisteredProject);
  markCategory(lexicon_.supplier_names, RedactionKind::RegisteredSupplier);
  markCategory(lexicon_.part_numbers, RedactionKind::PartNumber);
  markCategory(lexicon_.secret_terms, RedactionKind::RegisteredSecret);

  // Longest-match-wins, then drop overlaps.
  std::sort(spans.begin(), spans.end(), [](const Span& a, const Span& b) {
    if (a.begin != b.begin) return a.begin < b.begin;
    return (a.end - a.begin) > (b.end - b.begin);
  });
  std::vector<Span> kept;
  std::size_t reach = 0;
  for (const Span& s : spans) {
    if (!kept.empty() && s.begin < reach) continue;
    kept.push_back(s);
    reach = s.end;
  }

  // Registered spans swallow any word they touch, so a partial hit inside a
  // longer token cannot leave the rest of that token on the wire.
  for (Span& s : kept) {
    while (s.begin > 0 && !std::isspace(static_cast<unsigned char>(raw[s.begin - 1]))) --s.begin;
    while (s.end < raw.size() && !std::isspace(static_cast<unsigned char>(raw[s.end]))) ++s.end;
  }

  // ── phase 2: segment into registered spans and free text ───────────────────
  struct Piece {
    bool registered = false;
    RedactionKind kind{};
    std::string text;
    std::size_t offset = 0;
  };
  std::vector<Piece> pieces;
  std::size_t cursor = 0;
  for (const Span& s : kept) {
    if (s.begin > cursor) {
      pieces.push_back(Piece{false, {}, raw.substr(cursor, s.begin - cursor), cursor});
    }
    pieces.push_back(Piece{true, s.kind, raw.substr(s.begin, s.end - s.begin), s.begin});
    cursor = s.end;
  }
  if (cursor < raw.size()) {
    pieces.push_back(Piece{false, {}, raw.substr(cursor), cursor});
  }

  // ── phase 3: classify every free token, default-deny on numbers ────────────
  std::vector<std::string> wire_terms;
  std::vector<std::string> preview_terms;
  std::string previous_kept;   // context for designation lookback
  bool previous_was_dimension = false;
  std::size_t global_token_index = 0;

  auto emitRedaction = [&](RedactionKind kind, const std::string& matched, std::size_t offset) {
    RedactionEvent ev;
    ev.kind = kind;
    ev.matched = matched;
    ev.marker = markerFor(kind);
    ev.offset = offset;
    ev.length = matched.size();
    result.events.push_back(std::move(ev));
    if (preview_terms.empty() || preview_terms.back() != markerFor(kind)) {
      preview_terms.emplace_back(markerFor(kind));
    }
    previous_kept.clear();
    previous_was_dimension = (kind == RedactionKind::DimensionLiteral);
  };

  for (const Piece& piece : pieces) {
    if (piece.registered) {
      emitRedaction(piece.kind, piece.text, piece.offset);
      ++global_token_index;
      continue;
    }
    std::size_t pos = 0;
    while (pos < piece.text.size()) {
      while (pos < piece.text.size() && std::isspace(static_cast<unsigned char>(piece.text[pos]))) ++pos;
      if (pos >= piece.text.size()) break;
      const std::size_t start = pos;
      while (pos < piece.text.size() && !std::isspace(static_cast<unsigned char>(piece.text[pos]))) ++pos;
      const std::string rawToken = piece.text.substr(start, pos - start);
      std::size_t lead = 0;
      const std::string token = trimPunctuation(rawToken, lead);
      const std::size_t offset = piece.offset + start + lead;
      if (token.empty()) continue;
      const std::size_t token_index = global_token_index++;
      const std::string lower = toLower(token);

      if (looksLikeEmail(token)) { emitRedaction(RedactionKind::EmailAddress, token, offset); continue; }
      if (looksLikeUrl(token)) { emitRedaction(RedactionKind::Url, token, offset); continue; }
      if (looksLikePath(token)) { emitRedaction(RedactionKind::FilesystemPath, token, offset); continue; }
      if (looksLikeDrawingReference(token)) {
        emitRedaction(RedactionKind::DrawingReference, token, offset);
        continue;
      }

      if (detail::isPublicDesignation(token, previous_kept, policy_.allow_public_thread_designations)) {
        result.kept_designations.push_back(token);
        wire_terms.push_back(token);
        preview_terms.push_back(token);
        previous_kept = token;
        previous_was_dimension = false;
        continue;
      }

      if (policy_.strip_unallowlisted_numbers && looksLikeDimension(token)) {
        emitRedaction(RedactionKind::DimensionLiteral, token, offset);
        continue;
      }

      // A bare unit right after a stripped dimension carries nothing on its own.
      if (previous_was_dimension && unitWords().count(lower)) {
        previous_was_dimension = false;
        continue;
      }

      if (policy_.strip_part_numbers && hasDigitAndAlpha(token) && token.size() >= 3) {
        emitRedaction(RedactionKind::PartNumber, token, offset);
        continue;
      }
      if (token.size() >= 16 && allAlnum(token)) {
        emitRedaction(RedactionKind::OpaqueIdentifier, token, offset);
        continue;
      }
      if (policy_.strip_proper_nouns && token_index > 0 && token.size() >= 3 &&
          std::isupper(static_cast<unsigned char>(token[0])) &&
          !publicCapitalizedVocabulary().count(lower) && !standardsBodies().count(toUpper(token))) {
        emitRedaction(RedactionKind::ProperNoun, token, offset);
        continue;
      }

      wire_terms.push_back(token);
      preview_terms.push_back(token);
      previous_kept = token;
      previous_was_dimension = false;
    }
  }

  // ── phase 4: minimization budget ───────────────────────────────────────────
  auto join = [](const std::vector<std::string>& terms) {
    std::string out;
    for (const std::string& t : terms) {
      if (!out.empty()) out.push_back(' ');
      out += t;
    }
    return out;
  };

  if (wire_terms.size() > policy_.max_query_terms) {
    wire_terms.resize(policy_.max_query_terms);
    result.truncated_by_budget = true;
  }
  result.wire_query = join(wire_terms);
  if (result.wire_query.size() > policy_.max_query_chars) {
    std::size_t cut = result.wire_query.rfind(' ', policy_.max_query_chars);
    if (cut == std::string::npos) cut = policy_.max_query_chars;
    result.wire_query.resize(cut);
    result.truncated_by_budget = true;
  }
  result.preview_form = join(preview_terms);
  return result;
}

bool Redactor::verifyNoResidue(const std::string& wire, std::vector<std::string>& residue) const {
  residue.clear();
  const std::string decoded = detail::decodeForResidueScan(wire);
  const std::string norm = detail::normalizeForMatch(decoded);

  // (a) registered terms, by normalized substring — independent of the classifier.
  auto scanCategory = [&](const std::vector<std::string>& terms, const char* label) {
    for (std::size_t i = 0; i < terms.size(); ++i) {
      const std::string needle = detail::normalizeForMatch(terms[i]);
      if (needle.size() < 3) continue;
      if (norm.find(needle) != std::string::npos) {
        // NEVER echo the secret itself into a diagnostic string.
        residue.push_back(std::string(label) + " lexicon entry #" + std::to_string(i) +
                          " survives in the outgoing buffer");
      }
    }
  };
  scanCategory(lexicon_.customer_names, "customer");
  scanCategory(lexicon_.project_names, "project");
  scanCategory(lexicon_.supplier_names, "supplier");
  scanCategory(lexicon_.part_numbers, "part-number");
  scanCategory(lexicon_.secret_terms, "proprietary-term");

  // (b) registered secret dimensions, by parsed VALUE — encoding-proof.
  if (!lexicon_.secret_dimensions.empty()) {
    const auto literals = scanNumericLiterals(decoded);
    for (std::size_t i = 0; i < lexicon_.secret_dimensions.size(); ++i) {
      const double secret = lexicon_.secret_dimensions[i];
      for (const auto& [text, value] : literals) {
        const double scale = std::max(1.0, std::fabs(secret));
        if (std::fabs(value - secret) <= 1e-9 * scale) {
          residue.push_back("secret-dimension lexicon entry #" + std::to_string(i) +
                            " survives in the outgoing buffer");
          break;
        }
      }
    }
  }
  return residue.empty();
}

bool Redactor::verifyQueryFullyRedacted(const std::string& query_text,
                                        const std::vector<std::string>& allowed_designations,
                                        std::vector<std::string>& residue) const {
  if (!verifyNoResidue(query_text, residue)) return false;
  if (!policy_.strip_unallowlisted_numbers) return residue.empty();

  const std::string decoded = detail::decodeForResidueScan(query_text);
  std::set<std::string> allowed;
  for (const std::string& d : allowed_designations) {
    allowed.insert(detail::normalizeForMatch(d));
  }
  // Tokenize the decoded query and require every numeric-bearing token to be
  // covered by a designation the redactor explicitly decided to keep.
  std::size_t pos = 0;
  while (pos < decoded.size()) {
    while (pos < decoded.size() && std::isspace(static_cast<unsigned char>(decoded[pos]))) ++pos;
    if (pos >= decoded.size()) break;
    const std::size_t start = pos;
    while (pos < decoded.size() && !std::isspace(static_cast<unsigned char>(decoded[pos]))) ++pos;
    std::size_t lead = 0;
    const std::string token = trimPunctuation(decoded.substr(start, pos - start), lead);
    if (token.empty()) continue;
    bool hasDigit = false;
    for (const unsigned char c : token) {
      if (isAsciiDigit(c)) { hasDigit = true; break; }
    }
    if (!hasDigit) continue;
    const std::string normTok = detail::normalizeForMatch(token);
    bool covered = allowed.count(normTok) > 0;
    if (!covered) {
      for (const std::string& a : allowed) {
        if (!a.empty() && (a.find(normTok) != std::string::npos || normTok.find(a) != std::string::npos)) {
          covered = true;
          break;
        }
      }
    }
    if (!covered) {
      residue.push_back("unallowlisted numeric token survives in the outgoing query");
    }
  }
  return residue.empty();
}

}  // namespace forge::retrieval
