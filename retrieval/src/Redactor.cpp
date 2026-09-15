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

// ── CLOSED LISTS OF REAL PUBLIC DESIGNATIONS ────────────────────────────────
// These exist because a SHAPE IS NOT A LICENCE. A rule of the form "'A' plus
// two-to-four digits is an ASTM spec" blesses A7213 — which is what an internal
// part number looks like — and default-deny then has a hole exactly the width of
// that pattern. Membership is the test: a token is a public designation because
// it IS one, not because it resembles one. Adding a designation is a deliberate,
// reviewable edit to this file.

// ASTM specifications an engineer actually types: structural steel, hollow
// sections, plate/pressure vessel, bar, fasteners, stainless/alloy, cast iron
// and coatings.
const StrSet& astmDesignations() {
  static const StrSet kAstm = {
      // structural steel
      "A36", "A242", "A283", "A514", "A529", "A572", "A588", "A709", "A852", "A913", "A992",
      // hollow sections, tube and pipe
      "A53", "A106", "A252", "A500", "A501", "A511", "A513", "A519", "A618", "A1085",
      // plate and pressure vessel
      "A285", "A387", "A515", "A516", "A517", "A537",
      // bar and reinforcement
      "A29", "A108", "A311", "A615", "A706",
      // fasteners
      "A193", "A194", "A307", "A320", "A325", "A354", "A449", "A490", "A563",
      // stainless, alloy and castings
      "A182", "A216", "A217", "A234", "A240", "A276", "A312", "A351", "A403", "A479", "A564",
      // cast and ductile iron
      "A48", "A126", "A395", "A536",
      // coatings
      "A123", "A153", "A653", "A780",
  };
  return kAstm;
}

// ISO 261 / ISO 262 metric thread nominal diameters.
const StrSet& metricThreadSizes() {
  static const StrSet kSizes = {"M1",  "M1.2", "M1.4", "M1.6", "M1.8", "M2",  "M2.2", "M2.5",
                                "M3",  "M3.5", "M4",   "M4.5", "M5",   "M6",  "M7",   "M8",
                                "M9",  "M10",  "M11",  "M12",  "M14",  "M16", "M18",  "M20",
                                "M22", "M24",  "M27",  "M30",  "M33",  "M36", "M39",  "M42",
                                "M45", "M48",  "M52",  "M56",  "M60",  "M64", "M68",  "M72",
                                "M76", "M80"};
  return kSizes;
}

// ISO 261 coarse and fine pitches, in millimetres.
const StrSet& metricThreadPitches() {
  static const StrSet kPitches = {"0.2",  "0.25", "0.3", "0.35", "0.4", "0.45", "0.5",  "0.6",
                                  "0.7",  "0.75", "0.8", "1",    "1.0", "1.25", "1.5",  "1.75",
                                  "2",    "2.0",  "2.5", "3",    "3.0", "3.5",  "4",    "4.0",
                                  "4.5",  "5",    "5.0", "5.5",  "6",   "6.0"};
  return kPitches;
}

// Aluminum Association wrought alloy numbers.
const StrSet& aluminumAlloys() {
  static const StrSet kAlloys = {
      "1050", "1060", "1100", "1350", "2011", "2014", "2017", "2024", "2219", "3003", "3004",
      "3103", "5005", "5052", "5083", "5086", "5154", "5251", "5454", "5456", "5754", "6005",
      "6060", "6061", "6063", "6082", "6101", "6262", "6351", "6463", "7005", "7050", "7068",
      "7075", "7175", "7475"};
  return kAlloys;
}

// Aluminum Association temper designations.
const StrSet& aluminumTempers() {
  static const StrSet kTempers = {
      "T1",    "T2",    "T3",    "T4",    "T5",    "T6",    "T7",    "T8",     "T9",
      "T31",   "T351",  "T3510", "T3511", "T36",   "T39",   "T42",   "T451",   "T4511",
      "T52",   "T54",   "T6151", "T62",   "T651",  "T6510", "T6511", "T652",   "T66",
      "T73",   "T732",  "T7351", "T73510", "T73511", "T736", "T74",   "T7451",  "T76",
      "T7651", "T81",   "T83",   "T851",  "T8510", "T8511", "T86",   "T87",    "T89"};
  return kTempers;
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
  // The grammar here must match isBoundedNumeric's -- [+-]?digits[.digits][e[+-]digits]
  // with thousands separators -- PLUS a leading-dot form. This is the independent
  // post-condition layer, so its whole value is catching what redact() missed, and a
  // value scan that only understands `digits[.digits]` is evadable by writing the same
  // number three other ways:
  //
  //     .5        yielded the literal "5"      -> a registered 0.5 never matched
  //     47,625    yielded "47" and "625"       -> a registered 47625 never matched
  //     4.7e1     yielded "4.7"                -> a registered 47 never matched
  //
  // Being generous here is the SAFE direction: an extra candidate can only cause a
  // spurious residue report, which refuses to send. A missed candidate sends a secret.
  std::vector<std::pair<std::string, double>> out;
  std::size_t i = 0;
  while (i < text.size()) {
    const unsigned char c = static_cast<unsigned char>(text[i]);
    // A literal starts at a digit, or at a '.' followed by a digit -- but only when that
    // '.' is not itself preceded by an alphanumeric, which would make it a member access
    // or the interior of a literal already consumed.
    bool starts = isAsciiDigit(c);
    if (!starts && c == '.' && i + 1 < text.size() &&
        isAsciiDigit(static_cast<unsigned char>(text[i + 1])) &&
        (i == 0 || !isAsciiAlnum(static_cast<unsigned char>(text[i - 1])))) {
      starts = true;
    }
    if (!starts) { ++i; continue; }

    std::size_t begin = i;
    // Keep a leading sign when it is not part of an identifier or a range like "a-5".
    if (begin > 0 && text[begin - 1] == '-' &&
        (begin == 1 || !isAsciiAlnum(static_cast<unsigned char>(text[begin - 2])))) {
      --begin;
    }

    std::string cleaned;
    if (text[begin] == '-') cleaned.push_back('-');

    std::size_t j = i;
    // Integer part. A comma counts as a thousands separator ONLY when a digit follows it
    // immediately: "47,625" is one value, while "47, 625" stays two.
    while (j < text.size()) {
      if (isAsciiDigit(static_cast<unsigned char>(text[j]))) { cleaned.push_back(text[j]); ++j; }
      else if (text[j] == ',' && j + 1 < text.size() &&
               isAsciiDigit(static_cast<unsigned char>(text[j + 1]))) { ++j; }
      else break;
    }
    // Fraction.
    if (j < text.size() && text[j] == '.' && j + 1 < text.size() &&
        isAsciiDigit(static_cast<unsigned char>(text[j + 1]))) {
      if (cleaned.empty() || cleaned == "-") cleaned.push_back('0');  // ".5" -> "0.5"
      cleaned.push_back('.');
      ++j;
      while (j < text.size() && isAsciiDigit(static_cast<unsigned char>(text[j]))) {
        cleaned.push_back(text[j]);
        ++j;
      }
    }
    // Exponent, accepted only when it is complete; otherwise the 'e' is just a letter.
    if (j < text.size() && (text[j] == 'e' || text[j] == 'E')) {
      const std::size_t save = j;
      std::string exp("e");
      ++j;
      if (j < text.size() && (text[j] == '+' || text[j] == '-')) { exp.push_back(text[j]); ++j; }
      if (j < text.size() && isAsciiDigit(static_cast<unsigned char>(text[j]))) {
        while (j < text.size() && isAsciiDigit(static_cast<unsigned char>(text[j]))) {
          exp.push_back(text[j]);
          ++j;
        }
        cleaned += exp;
      } else {
        j = save;
      }
    }

    double v = 0.0;
    const char* first = cleaned.data();
    const char* last = cleaned.data() + cleaned.size();
    if (std::from_chars(first, last, v).ec == std::errc()) {
      out.emplace_back(text.substr(begin, j - begin), v);
    }
    i = j > i ? j : i + 1;  // never fail to advance
  }

  return out;
}

// ── SHORT REGISTERED TERMS ───────────────────────────────────────────────────
// A registered term of one or two normalized characters used to be skipped by
// BOTH the classifier and the independent residue scan, so a one- or two-letter
// customer code, project codename or part prefix went to the wire AND the
// post-check called the buffer clean. Two layers with one blind spot is exactly
// the failure a default-deny design exists to prevent.
//
// The floor existed for precision, not for safety: a naive substring scan for
// "q" redacts "torque", "quality" and "sequence", and a redactor that destroys
// the question is useless in its own way. The fix keeps the precision and drops
// the hole: a SHORT term must match a COMPLETE alphanumeric run. "Zx" matches
// "Zx", "Zx-1" and "zx." — it does not match "zxy" or "azx".
constexpr std::size_t kShortTermMaxLen = 2;

// True when [begin, end) inside `s` is a whole alphanumeric run: neither
// neighbouring byte is an ASCII alphanumeric.
bool isWholeAlnumRun(const std::string& s, std::size_t begin, std::size_t end) {
  if (begin > 0 && isAsciiAlnum(static_cast<unsigned char>(s[begin - 1]))) return false;
  if (end < s.size() && isAsciiAlnum(static_cast<unsigned char>(s[end]))) return false;
  return true;
}

// ── THE LEXICON MATCH KEY: a UTS #39 skeleton over the folded ASCII ─────────
// Folding brings every modelled code point to ASCII, but ASCII has look-alikes
// of its own, and the Cyrillic/Greek table below has to pick ONE ASCII letter for
// a glyph that reads as two: PALOCHKA U+04C0 is a capital I to one reader and an
// l to the next. Written as the only Latin-free spelling of "apollo" it folded to
// "apoIIo" and met the lexicon as "apoiio". So registered terms are never
// compared letter-for-letter: BOTH the needle and the haystack are reduced to a
// skeleton, and two strings whose skeletons agree are the same term.
//
// Source: Unicode Technical Standard #39, Unicode Security Mechanisms, §4
// "Confusable Detection" (skeleton(X) = NFD, map each code point by
// confusables.txt, NFD again). confusables.txt 16.0.0 maps these ASCII code
// points, and only these letters, digits and marks, to other ASCII:
//     0030 '0' -> 004F 'O'        0049 'I' -> 006C 'l'      006D 'm' -> 0072 006E "rn"
//     0031 '1' -> 006C 'l'        007C '|' -> 006C 'l'
// (0022, 0025 and 0060 map to punctuation, which the key discards anyway.)
// This key is CASE-INSENSITIVE, so each class is closed under case before the
// mapping is applied: 'i' is the lower case of 'I' and joins {1, I, l, |}; 'o'
// joins {0, O}; 'M' joins 'm'. Merging classes can only make two different
// strings compare equal, which is a spurious redaction or refusal — never a
// secret that is missed.
void appendSkeleton(std::string& out, std::vector<std::size_t>* map, unsigned char c, std::size_t source) {
  auto put = [&](char k) {
    out.push_back(k);
    if (map) map->push_back(source);
  };
  if (c == '|') { put('l'); return; }
  if (!isAsciiAlnum(c)) return;
  const char lower = static_cast<char>(std::tolower(c));
  switch (lower) {
    case '1': case 'i': case 'l': put('l'); return;
    case '0': case 'o': put('o'); return;
    case 'm': put('r'); put('n'); return;
    default: put(lower); return;
  }
}

// The skeleton key plus the index map that carries a key offset back to the
// byte offset it came from. Both matching layers need the map, because the
// whole-run test above can only be made in the ORIGINAL bytes: the key deletes
// the very punctuation that marks a token boundary. Every key byte maps to the
// source byte that produced it ("m" produces two, both mapped to the 'm').
std::string normalizeWithMap(const std::string& s, std::vector<std::size_t>& map) {
  std::string out;
  out.reserve(s.size());
  map.clear();
  map.reserve(s.size());
  for (std::size_t i = 0; i < s.size(); ++i) {
    appendSkeleton(out, &map, static_cast<unsigned char>(s[i]), i);
  }
  return out;
}

// Find the next occurrence of `needle` in `norm` at or after `from` that the
// term's length is allowed to claim. Returns npos when there is none.
std::size_t findRegisteredTerm(const std::string& norm, const std::vector<std::size_t>& map,
                               const std::string& source, const std::string& needle,
                               std::size_t from) {
  const bool whole_run_only = needle.size() <= kShortTermMaxLen;
  for (std::size_t at = norm.find(needle, from); at != std::string::npos;
       at = norm.find(needle, at + 1)) {
    if (!whole_run_only) return at;
    const std::size_t begin = map[at];
    const std::size_t end = map[at + needle.size() - 1] + 1;
    if (isWholeAlnumRun(source, begin, end)) return at;
  }
  return std::string::npos;
}

// ═════════════════════════════════════════════════════════════════════════════
// THE UNICODE NORMALISER'S TABLES
//
// Every table below is written out from a Unicode data definition, cited at the
// table. No library, no copied code. unicode_fold_ucd_check.py cross-checks every
// modelled code point against the Unicode Character Database that ships with
// python3 (unicodedata), in the direction that matters: a fold must never map a
// code point to the WRONG ASCII. A code point MISSING from a table is not a hole —
// it is refused — so completeness costs usability, never privacy.
// ═════════════════════════════════════════════════════════════════════════════

using detail::FoldScript;

// (1) DECIMAL DIGITS. Unicode 16.0.0 UnicodeData.txt, every code point with
// General_Category=Nd. Each Nd range is exactly ten code points, digit values
// 0..9 in ascending order — a Unicode stability policy for Numeric_Type=Decimal
// (UAX #44 §5.7.4) — so each range is listed by its zero. 76 ranges, 760 digits.
constexpr char32_t kDecimalZeros[] = {
    0x0030,  0x0660,  0x06F0,  0x07C0,  0x0966,  0x09E6,  0x0A66,  0x0AE6,  0x0B66,  0x0BE6,
    0x0C66,  0x0CE6,  0x0D66,  0x0DE6,  0x0E50,  0x0ED0,  0x0F20,  0x1040,  0x1090,  0x17E0,
    0x1810,  0x1946,  0x19D0,  0x1A80,  0x1A90,  0x1B50,  0x1BB0,  0x1C40,  0x1C50,  0xA620,
    0xA8D0,  0xA900,  0xA9D0,  0xA9F0,  0xAA50,  0xABF0,  0xFF10,  0x104A0, 0x10D30, 0x10D40,
    0x11066, 0x110F0, 0x11136, 0x111D0, 0x112F0, 0x11450, 0x114D0, 0x11650, 0x116C0, 0x116D0,
    0x116DA, 0x11730, 0x118E0, 0x11950, 0x11BF0, 0x11C50, 0x11D50, 0x11DA0, 0x11F50, 0x16130,
    0x16A60, 0x16AC0, 0x16B50, 0x16D70, 0x1CCF0, 0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6,
    0x1E140, 0x1E2F0, 0x1E4F0, 0x1E5F1, 0x1E950, 0x1FBF0,
};

// (2) SUPERSCRIPT AND SUBSCRIPT DIGITS. UnicodeData.txt <super>/<sub>
// compatibility decompositions to a single ASCII digit (NFKC). "mm²".
struct DigitAlias {
  char32_t cp;
  char digit;
};
constexpr DigitAlias kDigitAliases[] = {
    {0x00B2, '2'}, {0x00B3, '3'}, {0x00B9, '1'}, {0x2070, '0'}, {0x2074, '4'}, {0x2075, '5'},
    {0x2076, '6'}, {0x2077, '7'}, {0x2078, '8'}, {0x2079, '9'}, {0x2080, '0'}, {0x2081, '1'},
    {0x2082, '2'}, {0x2083, '3'}, {0x2084, '4'}, {0x2085, '5'}, {0x2086, '6'}, {0x2087, '7'},
    {0x2088, '8'}, {0x2089, '9'},
};

// (3) FULLWIDTH ASCII VARIANTS. UnicodeData.txt: U+FF01..U+FF5E carry <wide>
// decompositions to U+0021..U+007E, offset 0xFEE0. (U+FF10..FF19 are Nd and fold
// through table 1.) No HALFWIDTH form decomposes to ASCII — U+FF61..U+FFEF are
// katakana, hangul and symbols — so none is modelled and all are refused.
constexpr char32_t kFullwidthFirst = 0xFF01;
constexpr char32_t kFullwidthLast = 0xFF5E;
constexpr char32_t kFullwidthOffset = 0xFEE0;

// (4) LATIN LETTERS WITH DIACRITICS, U+00C0..U+017F (Latin-1 Supplement letters
// and Latin Extended-A). UnicodeData.txt canonical decomposition (NFD) with the
// combining marks removed, where that leaves exactly one ASCII letter. '.' is
// "does not decompose to one ASCII letter" and is refused — Æ, Ð, Ø, Þ, Ł, Œ and
// the rest, which no Unicode decomposition maps to ASCII, and × ÷ which are not
// letters (× is folded by the confusable table instead).
constexpr char kLatinDecomposed[] =
    "AAAAAA.CEEEEIIII.NOOOOO..UUUUY.."  // U+00C0..U+00DF
    "aaaaaa.ceeeeiiii.nooooo..uuuuy.y"  // U+00E0..U+00FF
    "AaAaAaCcCcCcCcDd..EeEeEeEeEeGgGg"  // U+0100..U+011F
    "GgGgHh..IiIiIiIiI...JjKk.LlLlLl."  // U+0120..U+013F
    "...NnNnNn...OoOoOo..RrRrRrSsSsSs"  // U+0140..U+015F
    "SsTtTt..UuUuUuUuUuUuWwYyYZzZzZz.";  // U+0160..U+017F
constexpr char32_t kLatinDecomposedFirst = 0x00C0;

struct StringFold {
  char32_t cp;
  const char* ascii;
  FoldScript script;
};

// (4b) Latin letters whose Unicode mapping to ASCII is not a canonical
// decomposition: U+00DF from CaseFolding.txt ("00DF; F; 0073 0073"), U+0132,
// U+0133 and U+017F from their <compat> decompositions (NFKC).
constexpr StringFold kLatinSpecial[] = {
    {0x00DF, "ss", FoldScript::Latin},
    {0x0132, "IJ", FoldScript::Latin},
    {0x0133, "ij", FoldScript::Latin},
    {0x017F, "s", FoldScript::Latin},
};

// (5) CONFUSABLE SKELETON, UTS #39 (Unicode Security Mechanisms) confusables.txt,
// version 16.0.0 (https://www.unicode.org/Public/security/16.0.0/confusables.txt):
// the Cyrillic, Greek and Armenian letters whose prototype is a single ASCII
// Latin letter. These are what let "bluefаlcon" (U+0430) look like "bluefalcon".
// Each entry's ASCII is the prototype, or a letter in the same skeleton class
// (appendSkeleton: {1 I i l |}, {0 O o}) where the prototype is 'l' and the glyph
// is a capital I. attack_regression_gate's UCD phase re-derives every entry from
// retrieval/test/fixtures/unicode/confusables-16.0.0-subset.txt.
// A token that mixes one of these with a Latin letter is REFUSED by the
// mixed-script rule before this skeleton is ever relied on; the skeleton is what
// lets a token written ENTIRELY in look-alikes meet the lexicon as the Latin
// word it imitates. Sorted by code point (binary search).
constexpr StringFold kConfusables[] = {
    {0x0391, "A", FoldScript::Greek},    {0x0392, "B", FoldScript::Greek},
    {0x0395, "E", FoldScript::Greek},    {0x0396, "Z", FoldScript::Greek},
    {0x0397, "H", FoldScript::Greek},    {0x0399, "I", FoldScript::Greek},
    {0x039A, "K", FoldScript::Greek},    {0x039C, "M", FoldScript::Greek},
    {0x039D, "N", FoldScript::Greek},    {0x039F, "O", FoldScript::Greek},
    {0x03A1, "P", FoldScript::Greek},    {0x03A4, "T", FoldScript::Greek},
    {0x03A5, "Y", FoldScript::Greek},    {0x03A7, "X", FoldScript::Greek},
    {0x03B1, "a", FoldScript::Greek},    {0x03B9, "i", FoldScript::Greek},
    {0x03BD, "v", FoldScript::Greek},    {0x03BF, "o", FoldScript::Greek},
    {0x03C1, "p", FoldScript::Greek},    {0x03C5, "u", FoldScript::Greek},
    {0x03F2, "c", FoldScript::Greek},    {0x03F3, "j", FoldScript::Greek},
    {0x03F9, "C", FoldScript::Greek},    {0x0405, "S", FoldScript::Cyrillic},
    {0x0406, "I", FoldScript::Cyrillic}, {0x0408, "J", FoldScript::Cyrillic},
    {0x0410, "A", FoldScript::Cyrillic}, {0x0412, "B", FoldScript::Cyrillic},
    {0x0415, "E", FoldScript::Cyrillic}, {0x041A, "K", FoldScript::Cyrillic},
    {0x041C, "M", FoldScript::Cyrillic}, {0x041D, "H", FoldScript::Cyrillic},
    {0x041E, "O", FoldScript::Cyrillic}, {0x0420, "P", FoldScript::Cyrillic},
    {0x0421, "C", FoldScript::Cyrillic}, {0x0422, "T", FoldScript::Cyrillic},
    {0x0423, "Y", FoldScript::Cyrillic}, {0x0425, "X", FoldScript::Cyrillic},
    {0x0430, "a", FoldScript::Cyrillic}, {0x0435, "e", FoldScript::Cyrillic},
    {0x043E, "o", FoldScript::Cyrillic}, {0x0440, "p", FoldScript::Cyrillic},
    {0x0441, "c", FoldScript::Cyrillic}, {0x0443, "y", FoldScript::Cyrillic},
    {0x0445, "x", FoldScript::Cyrillic}, {0x0455, "s", FoldScript::Cyrillic},
    {0x0456, "i", FoldScript::Cyrillic}, {0x0458, "j", FoldScript::Cyrillic},
    {0x0474, "V", FoldScript::Cyrillic}, {0x0475, "v", FoldScript::Cyrillic},
    {0x04AE, "Y", FoldScript::Cyrillic}, {0x04AF, "y", FoldScript::Cyrillic},
    {0x04BB, "h", FoldScript::Cyrillic}, {0x04C0, "I", FoldScript::Cyrillic},
    {0x04CF, "i", FoldScript::Cyrillic}, {0x0501, "d", FoldScript::Cyrillic},
    {0x050C, "G", FoldScript::Cyrillic}, {0x051B, "q", FoldScript::Cyrillic},
    {0x051C, "W", FoldScript::Cyrillic},
    {0x051D, "w", FoldScript::Cyrillic}, {0x054D, "U", FoldScript::Armenian},
    {0x0555, "O", FoldScript::Armenian}, {0x0570, "h", FoldScript::Armenian},
    {0x0578, "n", FoldScript::Armenian}, {0x057D, "u", FoldScript::Armenian},
    {0x0585, "o", FoldScript::Armenian},
};

// (6) SPACES, DASHES, QUOTES AND ENGINEERING SYMBOLS — script Common, and none
// can contribute a letter or a digit, so none can spell a name or a number.
//   * General_Category=Zs spaces whose NFKC form is U+0020.
//   * Dashes U+2010..U+2015 and MINUS SIGN U+2212: UTS #39 confusables
//     prototype (or the Pd category) HYPHEN-MINUS. Kept as '-' rather than a
//     space so "A2–70" stays ONE token, exactly like its ASCII spelling.
//   * Quotation marks and primes: ASCII apostrophe / quotation mark.
//   * U+00D7 MULTIPLICATION SIGN: UTS #39 confusables prototype 'x' ("M8×1.25").
//   * U+2026 HORIZONTAL ELLIPSIS: NFKC "...".
//   * ° ± · ÷ © ® ™ • ⌀ ≈ ≤ ≥ ≠ : folded to a space. A space ends a token, which
//     can only split an identifier; a split identifier is still matched by the
//     lexicon (its match ignores separators) and each half still meets the
//     classifier — the same exposure as typing the space in ASCII.
// Sorted by code point (binary search).
constexpr StringFold kSymbols[] = {
    {0x00A0, " ", FoldScript::Common},  {0x00A9, " ", FoldScript::Common},
    {0x00AB, "\"", FoldScript::Common}, {0x00AE, " ", FoldScript::Common},
    {0x00B0, " ", FoldScript::Common},  {0x00B1, " ", FoldScript::Common},
    {0x00B4, "'", FoldScript::Common},  {0x00B7, " ", FoldScript::Common},
    {0x00BB, "\"", FoldScript::Common}, {0x00D7, "x", FoldScript::Common},
    {0x00F7, " ", FoldScript::Common},  {0x2000, " ", FoldScript::Common},
    {0x2001, " ", FoldScript::Common},  {0x2002, " ", FoldScript::Common},
    {0x2003, " ", FoldScript::Common},  {0x2004, " ", FoldScript::Common},
    {0x2005, " ", FoldScript::Common},  {0x2006, " ", FoldScript::Common},
    {0x2007, " ", FoldScript::Common},  {0x2008, " ", FoldScript::Common},
    {0x2009, " ", FoldScript::Common},  {0x200A, " ", FoldScript::Common},
    {0x2010, "-", FoldScript::Common},  {0x2011, "-", FoldScript::Common},
    {0x2012, "-", FoldScript::Common},  {0x2013, "-", FoldScript::Common},
    {0x2014, "-", FoldScript::Common},  {0x2015, "-", FoldScript::Common},
    {0x2018, "'", FoldScript::Common},  {0x2019, "'", FoldScript::Common},
    {0x201A, "'", FoldScript::Common},  {0x201B, "'", FoldScript::Common},
    {0x201C, "\"", FoldScript::Common}, {0x201D, "\"", FoldScript::Common},
    {0x201E, "\"", FoldScript::Common}, {0x201F, "\"", FoldScript::Common},
    {0x2022, " ", FoldScript::Common},  {0x2026, "...", FoldScript::Common},
    {0x202F, " ", FoldScript::Common},  {0x2032, "'", FoldScript::Common},
    {0x2033, "\"", FoldScript::Common}, {0x205F, " ", FoldScript::Common},
    {0x2122, " ", FoldScript::Common},  {0x2212, "-", FoldScript::Common},
    {0x2248, " ", FoldScript::Common},  {0x2260, " ", FoldScript::Common},
    {0x2264, " ", FoldScript::Common},  {0x2265, " ", FoldScript::Common},
    {0x2300, " ", FoldScript::Common},  {0x3000, " ", FoldScript::Common},
};

const StringFold* findFold(const StringFold* first, const StringFold* last, char32_t cp) {
  const StringFold* it =
      std::lower_bound(first, last, cp, [](const StringFold& f, char32_t v) { return f.cp < v; });
  return (it != last && it->cp == cp) ? it : nullptr;
}

// Strict UTF-8 decode of one code point at `i` (Unicode §3.9, Table 3-7:
// shortest form only, no surrogates, nothing above U+10FFFF). Returns the byte
// length, or 0 when the sequence is ill-formed.
std::size_t decodeUtf8(const std::string& s, std::size_t i, char32_t& cp) {
  const auto b = [&](std::size_t k) { return static_cast<unsigned char>(s[k]); };
  const unsigned char c0 = b(i);
  if (c0 < 0x80) { cp = c0; return 1; }
  const std::size_t n = s.size() - i;
  auto cont = [&](std::size_t k) { return k < s.size() && (b(k) & 0xC0) == 0x80; };
  if (c0 >= 0xC2 && c0 <= 0xDF) {
    if (n < 2 || !cont(i + 1)) return 0;
    cp = (static_cast<char32_t>(c0 & 0x1F) << 6) | (b(i + 1) & 0x3F);
    return 2;
  }
  if (c0 >= 0xE0 && c0 <= 0xEF) {
    if (n < 3 || !cont(i + 1) || !cont(i + 2)) return 0;
    const unsigned char c1 = b(i + 1);
    if (c0 == 0xE0 && c1 < 0xA0) return 0;  // overlong
    if (c0 == 0xED && c1 > 0x9F) return 0;  // UTF-16 surrogate
    cp = (static_cast<char32_t>(c0 & 0x0F) << 12) | (static_cast<char32_t>(c1 & 0x3F) << 6) |
         (b(i + 2) & 0x3F);
    return 3;
  }
  if (c0 >= 0xF0 && c0 <= 0xF4) {
    if (n < 4 || !cont(i + 1) || !cont(i + 2) || !cont(i + 3)) return 0;
    const unsigned char c1 = b(i + 1);
    if (c0 == 0xF0 && c1 < 0x90) return 0;  // overlong
    if (c0 == 0xF4 && c1 > 0x8F) return 0;  // above U+10FFFF
    cp = (static_cast<char32_t>(c0 & 0x07) << 18) | (static_cast<char32_t>(c1 & 0x3F) << 12) |
         (static_cast<char32_t>(b(i + 2) & 0x3F) << 6) | (b(i + 3) & 0x3F);
    return 4;
  }
  return 0;
}

void appendUtf8(std::string& out, char32_t cp) {
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

const char* foldIssueName(FoldIssueKind kind) {
  switch (kind) {
    case FoldIssueKind::InvalidUtf8: return "InvalidUtf8";
    case FoldIssueKind::UnmodelledCodePoint: return "UnmodelledCodePoint";
    case FoldIssueKind::MixedScript: return "MixedScript";
    case FoldIssueKind::MixedDecimalSystems: return "MixedDecimalSystems";
  }
  return "Unknown";
}

bool foldCodePoint(char32_t cp, std::string& ascii, FoldScript& script, char32_t& decimal_zero) {
  ascii.clear();
  script = FoldScript::Common;
  decimal_zero = 0;
  if (cp < 0x80) {
    ascii.push_back(static_cast<char>(cp));
    if (isAsciiAlpha(static_cast<unsigned char>(cp))) script = FoldScript::Latin;
    if (isAsciiDigit(static_cast<unsigned char>(cp))) decimal_zero = 0x30;
    return true;
  }
  // (1) Nd: the greatest range zero <= cp, if cp lies within its ten.
  {
    const auto* end = std::end(kDecimalZeros);
    const auto* it = std::upper_bound(std::begin(kDecimalZeros), end, cp);
    if (it != std::begin(kDecimalZeros)) {
      const char32_t zero = *(it - 1);
      if (cp - zero < 10) {
        ascii.push_back(static_cast<char>('0' + (cp - zero)));
        decimal_zero = zero;
        return true;
      }
    }
  }
  // (2) superscript / subscript digits
  for (const DigitAlias& d : kDigitAliases) {
    if (d.cp == cp) {
      ascii.push_back(d.digit);
      return true;
    }
  }
  // (3) fullwidth ASCII variants
  if (cp >= kFullwidthFirst && cp <= kFullwidthLast) {
    const char c = static_cast<char>(cp - kFullwidthOffset);
    ascii.push_back(c);
    if (isAsciiAlpha(static_cast<unsigned char>(c))) script = FoldScript::Latin;
    return true;
  }
  // (4) Latin letters with diacritics, and the four special Latin folds
  if (cp >= kLatinDecomposedFirst && cp < kLatinDecomposedFirst + (sizeof(kLatinDecomposed) - 1)) {
    const char c = kLatinDecomposed[cp - kLatinDecomposedFirst];
    if (c != '.') {
      ascii.push_back(c);
      script = FoldScript::Latin;
      return true;
    }
  }
  if (const StringFold* f = findFold(std::begin(kLatinSpecial), std::end(kLatinSpecial), cp)) {
    ascii = f->ascii;
    script = f->script;
    return true;
  }
  // (5) confusable skeleton
  if (const StringFold* f = findFold(std::begin(kConfusables), std::end(kConfusables), cp)) {
    ascii = f->ascii;
    script = f->script;
    return true;
  }
  // (6) spaces, dashes, quotes, symbols
  if (const StringFold* f = findFold(std::begin(kSymbols), std::end(kSymbols), cp)) {
    ascii = f->ascii;
    script = f->script;
    return true;
  }
  return false;  // NOT MODELLED. The caller refuses; nothing here guesses.
}

Folded foldForMatch(const std::string& raw) {
  Folded f;
  f.text.reserve(raw.size());
  f.raw_offset.reserve(raw.size() + 1);

  // Per-token state for the mixed-script and mixed-decimal-system rules.
  FoldScript token_script = FoldScript::Common;
  char32_t token_zero = 0;
  bool token_script_flagged = false;
  bool token_zero_flagged = false;
  auto endToken = [&]() {
    token_script = FoldScript::Common;
    token_zero = 0;
    token_script_flagged = false;
    token_zero_flagged = false;
  };

  std::string ascii;
  std::size_t i = 0;
  while (i < raw.size()) {
    char32_t cp = 0;
    const std::size_t len = decodeUtf8(raw, i, cp);
    if (len == 0) {
      f.issues.push_back(FoldIssue{FoldIssueKind::InvalidUtf8, i});
      ++i;
      continue;
    }
    FoldScript script = FoldScript::Common;
    char32_t zero = 0;
    if (!foldCodePoint(cp, ascii, script, zero)) {
      f.issues.push_back(FoldIssue{FoldIssueKind::UnmodelledCodePoint, i});
      i += len;
      continue;
    }
    const bool is_space = ascii.size() == 1 && std::isspace(static_cast<unsigned char>(ascii[0]));
    if (is_space) {
      endToken();
    } else {
      if (script != FoldScript::Common) {
        if (token_script == FoldScript::Common) {
          token_script = script;
        } else if (token_script != script && !token_script_flagged) {
          f.issues.push_back(FoldIssue{FoldIssueKind::MixedScript, i});
          token_script_flagged = true;
        }
      }
      if (zero != 0) {
        if (token_zero == 0) {
          token_zero = zero;
        } else if (token_zero != zero && !token_zero_flagged) {
          f.issues.push_back(FoldIssue{FoldIssueKind::MixedDecimalSystems, i});
          token_zero_flagged = true;
        }
      }
    }
    for (const char c : ascii) {
      f.text.push_back(c);
      f.raw_offset.push_back(i);
    }
    i += len;
  }
  f.raw_offset.push_back(raw.size());  // sentinel: the end of the input
  return f;
}

std::string normalizeForMatch(const std::string& s) {
  // Through the ONE normaliser, so a lexicon term registered as "ＢＯＥＩＮＧ" or
  // "Böhler" means the same letters the scans are looking at.
  const std::string folded = foldForMatch(s).text;
  std::string out;
  out.reserve(folded.size());
  for (const unsigned char c : folded) {
    if (isAsciiAlnum(c)) out.push_back(static_cast<char>(std::tolower(c)));
  }
  return out;
}

std::string lexiconKey(const std::string& s) {
  // Same fold, then the skeleton key the haystack is reduced to (see
  // appendSkeleton). A registered term and the text it is looked for in MUST go
  // through the same two steps, or a class merged on one side only is a miss.
  const std::string folded = foldForMatch(s).text;
  std::string out;
  out.reserve(folded.size());
  for (const unsigned char c : folded) appendSkeleton(out, nullptr, c, 0);
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
      auto hex4 = [&](std::size_t at, int& v) {
        if (at + 4 > s.size()) return false;
        v = 0;
        for (std::size_t k = 0; k < 4; ++k) {
          const int d = hexVal(s[at + k]);
          if (d < 0) return false;
          v = (v << 4) | d;
        }
        return true;
      };
      int v = 0;
      if (hex4(i + 2, v)) {
        // Decoded to REAL UTF-8, not to a placeholder. This used to write '?' for
        // every code point >= 0x80, which made "ＢＯ..." — fullwidth
        // BOEING — invisible to every scan. The normaliser has to see the code
        // point to fold it or refuse it.
        char32_t cp = static_cast<char32_t>(v);
        std::size_t consumed = 6;
        if (v >= 0xD800 && v <= 0xDBFF) {
          int lo = 0;
          if (i + 7 < s.size() && s[i + 6] == '\\' && (s[i + 7] == 'u' || s[i + 7] == 'U') &&
              hex4(i + 8, lo) && lo >= 0xDC00 && lo <= 0xDFFF) {
            cp = 0x10000 + ((static_cast<char32_t>(v) - 0xD800) << 10) + (static_cast<char32_t>(lo) - 0xDC00);
            consumed = 12;
          } else {
            cp = 0xFFFD;  // a lone surrogate: U+FFFD, which is not modelled and so refused
          }
        } else if (v >= 0xDC00 && v <= 0xDFFF) {
          cp = 0xFFFD;
        }
        appendUtf8(out, cp);
        i += consumed;
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
  // 3. aluminium alloy-temper designations: 6061-T6, 7075-T651, 2024-T3.
  //    BOTH halves must be real: the alloy number in the AA register and the
  //    temper in the AA temper list. "8842-T9" has the shape and is not one.
  {
    const std::size_t dash = upper.find('-');
    if (dash != std::string::npos && dash + 1 < upper.size() &&
        aluminumAlloys().count(upper.substr(0, dash)) &&
        aluminumTempers().count(upper.substr(dash + 1))) {
      return true;
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
  // 6. ASTM specification shorthand: A36, A572, A992. CLOSED LIST — the shape
  //    "A" + digits is also the shape of an internal part number, so membership
  //    is the only thing that licenses it.
  if (astmDesignations().count(upper)) return true;
  // 7. public metric thread callout: M12, M8x1.25. CLOSED LIST on both halves —
  //    the nominal diameter must be an ISO 261 size and the pitch, when one is
  //    written, an ISO 261 pitch. "M8675309" is neither.
  if (allow_thread_designations) {
    const std::size_t x = upper.find('X');
    if (x == std::string::npos) {
      if (metricThreadSizes().count(upper)) return true;
    } else if (x + 1 < upper.size() && metricThreadSizes().count(upper.substr(0, x)) &&
               metricThreadPitches().count(upper.substr(x + 1))) {
      return true;
    }
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

RedactionResult Redactor::redact(const std::string& input) const {
  RedactionResult result;

  // ── phase 0: normalise, or refuse ──────────────────────────────────────────
  // Everything below reads the FOLDED ASCII text and nothing else, and the wire
  // query is assembled from it. So the classifier judges exactly the bytes that
  // leave, and a spelling it cannot read never reaches it at all.
  const detail::Folded folded = detail::foldForMatch(input);
  if (!folded.ok()) {
    for (const detail::FoldIssue& issue : folded.issues) {
      result.refusals.push_back(std::string(detail::foldIssueName(issue.kind)) + " at byte " +
                                std::to_string(issue.raw_offset));
    }
    return result;  // no wire_query, no preview_form: there is nothing to send
  }
  const std::string& raw = folded.text;
  // Offsets and matched text in events refer to the operator's ORIGINAL input.
  auto toInput = [&](std::size_t folded_offset) {
    return folded.raw_offset[std::min(folded_offset, folded.raw_offset.size() - 1)];
  };

  // ── phase 1: registered-phrase pass ────────────────────────────────────────
  // Match every lexicon term against a punctuation- and case-insensitive
  // normalization of the input, so "ACME-4471-B", "acme 4471 b" and "Acme4471B"
  // are all the same term. An index map carries matches back to raw offsets.
  std::vector<std::size_t> map;
  const std::string norm = normalizeWithMap(raw, map);

  std::vector<Span> spans;
  auto markCategory = [&](const std::vector<std::string>& terms, RedactionKind kind) {
    for (const std::string& term : terms) {
      const std::string needle = detail::lexiconKey(term);
      // An empty term would match everywhere; a SHORT one matches whole
      // alphanumeric runs only. Length never buys a term an exemption.
      if (needle.empty()) continue;
      std::size_t at = findRegisteredTerm(norm, map, raw, needle, 0);
      while (at != std::string::npos) {
        const std::size_t begin = map[at];
        const std::size_t end = map[at + needle.size() - 1] + 1;
        spans.push_back(Span{begin, end, kind});
        at = findRegisteredTerm(norm, map, raw, needle, at + 1);
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

  auto emitRedaction = [&](RedactionKind kind, const std::string& matched, std::size_t offset) {
    RedactionEvent ev;
    ev.kind = kind;
    const std::size_t begin = toInput(offset);
    const std::size_t end = std::max(begin, toInput(offset + matched.size()));
    ev.matched = input.substr(begin, end - begin);
    ev.marker = markerFor(kind);
    ev.offset = begin;
    ev.length = end - begin;
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
      // NO FIRST-TOKEN EXEMPTION. This condition used to require the token index to be
      // non-zero, which exempted the FIRST token of the whole query from the proper-noun
      // rule -- and a user question very often OPENS with the customer or project name:
      // "Acme bearing preload tolerance" sent "Acme" to the public search engine.
      // The guard was also unnecessary: publicCapitalizedVocabulary() already lists the
      // sentence openers (what/which/how/why/when/where/who/is/are/does/do/can/the/a),
      // so a normal opening word is kept without it. POSITION MUST NOT LICENSE A TERM
      // THE RULE WOULD REDACT ANYWHERE ELSE.
      if (policy_.strip_proper_nouns && token.size() >= 3 &&
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
  const detail::Folded folded = detail::foldForMatch(decoded);

  // (0) DENY BY DEFAULT. A buffer carrying a code point the normaliser cannot
  //     model, or a token mixing scripts, is residue in itself: this layer cannot
  //     certify bytes it cannot read, and "no match found" over an unreadable
  //     spelling is exactly the false clean that sent fullwidth BOEING to the wire.
  if (!folded.ok()) {
    residue.push_back(std::string("the outgoing buffer is not fully readable by the normaliser (") +
                      detail::foldIssueName(folded.issues.front().kind) + " at byte " +
                      std::to_string(folded.issues.front().raw_offset) + ")");
  }

  auto note = [&](const std::string& line) {
    if (std::find(residue.begin(), residue.end(), line) == residue.end()) residue.push_back(line);
  };

  // Every check below runs on the RAW decoded form AND on the FOLDED form. The
  // folded form is what catches ４７．６２５ and ＢＯＥＩＮＧ; the raw form is kept so
  // this layer never depends on the normaliser being right about ASCII either.
  for (const std::string* form : {&decoded, &folded.text}) {
    std::vector<std::size_t> map;
    const std::string norm = normalizeWithMap(*form, map);

    // (a) registered terms, by normalized substring — independent of the classifier.
    //     Short terms use the same whole-alphanumeric-run rule as the classifier,
    //     so this layer's reach matches what redact() is expected to have removed.
    //     Note the deliberate consequence for a ONE-character term: `wire` may be a
    //     whole HTTP request, whose envelope carries runs like "q" and "1", so such
    //     a term makes the client refuse to send. That is fail-CLOSED, and the only
    //     honest answer when a registered secret is a single character.
    auto scanCategory = [&](const std::vector<std::string>& terms, const char* label) {
      for (std::size_t i = 0; i < terms.size(); ++i) {
        const std::string needle = detail::lexiconKey(terms[i]);
        if (needle.empty()) continue;
        if (findRegisteredTerm(norm, map, *form, needle, 0) != std::string::npos) {
          // NEVER echo the secret itself into a diagnostic string.
          note(std::string(label) + " lexicon entry #" + std::to_string(i) + " survives in the outgoing buffer");
        }
      }
    };
    scanCategory(lexicon_.customer_names, "customer");
    scanCategory(lexicon_.project_names, "project");
    scanCategory(lexicon_.supplier_names, "supplier");
    scanCategory(lexicon_.part_numbers, "part-number");
    scanCategory(lexicon_.secret_terms, "proprietary-term");

    // (b) registered secret dimensions, by parsed VALUE.
    if (!lexicon_.secret_dimensions.empty()) {
      const auto literals = scanNumericLiterals(*form);
      for (std::size_t i = 0; i < lexicon_.secret_dimensions.size(); ++i) {
        const double secret = lexicon_.secret_dimensions[i];
        for (const auto& [text, value] : literals) {
          const double scale = std::max(1.0, std::fabs(secret));
          if (std::fabs(value - secret) <= 1e-9 * scale) {
            note("secret-dimension lexicon entry #" + std::to_string(i) + " survives in the outgoing buffer");
            break;
          }
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

  const std::string decoded = detail::decodeForResidueScan(query_text);
  // Every transmitted value is FOLDED TO ASCII by redact() before it is sent. A
  // byte >= 0x80 in the decoded value therefore means some path skipped the
  // normaliser — and a value that skipped it is refused here, however harmless
  // the normaliser might have judged the code point. This is the independent
  // form of the fold contract, and it does not share the fold tables' failure
  // modes.
  for (const unsigned char c : decoded) {
    if (c >= 0x80) {
      residue.push_back("a non-ASCII byte survives in the outgoing value: it did not pass the normaliser");
      return false;
    }
  }
  if (!policy_.strip_unallowlisted_numbers) return residue.empty();
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
    // EXACT membership only. A substring test would let keeping "A36" bless the
    // bare number "36", the digit "3", and "A360" — none of which the redactor
    // ever decided to keep. An allow-set entry licenses ITSELF and nothing else.
    const std::string normTok = detail::normalizeForMatch(token);
    const bool covered = allowed.count(normTok) > 0;
    if (!covered) {
      residue.push_back("unallowlisted numeric token survives in the outgoing query");
    }
  }
  return residue.empty();
}

}  // namespace forge::retrieval
