// ─────────────────────────────────────────────────────────────────────────────
// numeral_redaction_gate.cpp — TWO-SIDED gate for numerals that are not ASCII
// digits: numbers spelled in WORDS, digits spelled in other SCRIPTS, and words
// wearing a LOOK-ALIKE code point from another script.
//
// ROUND 2 — WHAT WAS WRONG WITH THIS FILE, and why the fix to the file matters
// more than the fix to the redactor.
//
//   THE NEGATIVE ARM RAN UNDER A CONDITION THAT NEVER HOLDS. Every row of it
//   called drive(s, {}) — NOTHING REGISTERED — so LAYER A, the context-free
//   value match that is the redactor's PRIMARY mechanism, never fired once in
//   the entire control set. "false positives introduced: 0" and "42 of 42
//   intact" were therefore true only for an empty secret lexicon, which is never
//   the production condition. Re-run at an ordinary secret set
//   {12, 3, 0.75, 47.625, 8.5, 2}, the same code damaged 15 of 47 control rows:
//   "what is the second moment of area" went to the wire as "what is the moment
//   of area". A gate that cannot see its own primary mechanism fire is not
//   measuring the thing it is named after.
//
// Two structural rules now make that unrepeatable, and they are the durable half
// of round 2:
//   1. kNegativeArmSecrets is asserted NON-EMPTY before the arm runs.
//   2. A WITNESS PAIR proves LAYER A actually fired somewhere in this suite: the
//      same query, with and without the value registered, must come out
//      DIFFERENTLY. Nothing but a context-free value match can produce that
//      difference, so the assertion cannot be satisfied by a redactor in which
//      Layer A is dead.
//
// RED PROOF, honestly counted. This file uses PUBLIC API ONLY so it compiles
// unchanged against pre-fix sources. Of its 140 assertions, 50 are new in round
// 2; 41 of those 50 FAIL on a pre-fix tree (70 of 140 fail at pristine
// 02de2e15, 26 of 140 at the round-1 fix d7a44ede). The 9 without a red are
// named rather than hidden: three control rows that were already intact, the
// "look-alike splitting a digit run" row that the old code happened to block,
// the non-empty-secret-set guard (an invariant, not a behaviour), the surviving
// half of the witness pair, the DIGIT-2 bound, "accented Latin is not flagged"
// (a false-positive guard on a new arm), and the HONEST row that records a
// vocabulary gap as still OPEN.
//
// THE TRADE-OFF IS DATA IN THIS FILE, NOT A CLAIM. Layer A is context-free on
// purpose and that same property is what strips "second" out of "second moment
// of area" when 2.0 is registered. The two properties cannot both be had in
// full. The line drawn — see detail::isValueExpression — leaves exactly two
// control rows damaged, and both are listed below as DECLARED COLLISIONS with
// the reason. They are ASSERTED TO BE DAMAGED, so the trade-off cannot silently
// widen and cannot silently be papered over either.
//
// WHY THIS FILE EXISTS. Measured at 02de2e15 on this exact path, 30 of the 42
// spellings below carried a REGISTERED secret dimension into the wire buffer
// with status=Ok. The redactor's numeric grammar was digit-only
// ([+-]?digits[.digits][e[+-]digits]); "thickness forty seven point six two
// five mm" is not a number to any code in Redactor.cpp, and neither is
// "thickness ４７．６２５ mm".
//
// BOTH ARMS ARE REQUIRED, and either alone is a false pass:
//
//   POSITIVE — a registered secret must not reach the wire in ANY spelling.
//              A redactor that misses one leaks it.
//   NEGATIVE — 42 ordinary engineering queries that contain number words
//              innocently must reach the wire with every word intact.
//              A redactor that mangles these destroys the retrieval result for
//              a reason no user can see, and nothing else in this suite would
//              notice. Measured, a blanket default-deny on number words damages
//              42 of 42; the unmerged WIP reader damaged 21 of 42.
//
// This gate asserts on the BYTES HttpRequest::serialize() hands the transport,
// reached through the real seam preview() -> SendApproval::grant() -> search(),
// not on any intermediate the classifier itself produced. No socket is opened:
// the transport is injected. Every dimension here is SYNTHETIC.
//
// PUBLIC API ONLY, on purpose: this file must compile unchanged against the
// pre-fix Redactor so the RED proof is a real one — the gate builds, runs, and
// FAILS on HEAD rather than failing to build.
// ─────────────────────────────────────────────────────────────────────────────
#include "forge/retrieval/HttpTransport.hpp"
#include "forge/retrieval/Redactor.hpp"
#include "forge/retrieval/SearchRequest.hpp"
#include "forge/retrieval/SearxngClient.hpp"

#include <cstdio>
#include <memory>
#include <string>
#include <vector>

using namespace forge::retrieval;

namespace {

int g_pass = 0;
int g_fail = 0;

void check(bool ok, const std::string& what, const std::string& detail = {}) {
  if (ok) {
    ++g_pass;
    std::printf("  ok   %s\n", what.c_str());
  } else {
    ++g_fail;
    std::printf("  FAIL %s\n", what.c_str());
    if (!detail.empty()) std::printf("       %s\n", detail.c_str());
  }
}

// Records the exact serialized request instead of writing it to a socket.
class CapturingTransport final : public HttpTransport {
 public:
  bool called = false;
  std::string wire;

  HttpResponse send(const HttpRequest& req, std::uint32_t) override {
    called = true;
    wire = req.serialize();
    HttpResponse r;
    r.status = TransportStatus::Ok;
    r.status_code = 200;
    r.body =
        "{\"results\":[{\"url\":\"https://www.iso.org/x\",\"title\":\"a\",\"content\":\"b\"},"
        "{\"url\":\"https://www.astm.org/y\",\"title\":\"c\",\"content\":\"d\"}]}";
    return r;
  }
};

std::string lower(std::string s) {
  for (char& c : s) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return s;
}

// Percent-decode the q= value out of the captured wire bytes: what the FAR END
// would read, not what the client believes it sent.
std::string wireQ(const std::string& wire) {
  std::size_t at = wire.find("q=");
  while (at != std::string::npos) {
    if (at == 0 || wire[at - 1] == '?' || wire[at - 1] == '&' || wire[at - 1] == '\n') break;
    at = wire.find("q=", at + 1);
  }
  if (at == std::string::npos) return {};
  std::size_t end = at + 2;
  while (end < wire.size() && wire[end] != '&' && wire[end] != ' ' && wire[end] != '\r' &&
         wire[end] != '\n') {
    ++end;
  }
  const std::string enc = wire.substr(at + 2, end - at - 2);
  auto hex = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  std::string out;
  for (std::size_t i = 0; i < enc.size();) {
    if (enc[i] == '+') { out.push_back(' '); ++i; continue; }
    if (enc[i] == '%' && i + 2 < enc.size()) {
      const int h = hex(enc[i + 1]), l = hex(enc[i + 2]);
      if (h >= 0 && l >= 0) { out.push_back(static_cast<char>((h << 4) | l)); i += 3; continue; }
    }
    out.push_back(enc[i]);
    ++i;
  }
  return out;
}

struct Outcome {
  bool transmitted = false;
  std::string q;
  std::string status;
};

Outcome drive(const std::string& question, const std::vector<double>& secret_dims,
              const std::vector<std::string>& customers = {}) {
  PrivateLexicon lex;
  lex.secret_dimensions = secret_dims;
  lex.customer_names = customers;

  Redactor red(lex, RedactionPolicy{});  // production defaults, untouched
  auto tx = std::make_shared<CapturingTransport>();
  SearxngClient client(tx, red, SearxngEndpoint{});

  SearchRequest rq;
  rq.engineering_question = question;
  rq.retrieval_rationale = "local index has no answer";
  rq.esg_assertion_id = "ESG-NUMERAL-GATE";
  rq.privacy_class = NetworkPrivacyClass::SameMacSearxng;
  rq.min_distinct_publishers = 2;
  rq.expected_fact_types = {FactType::DimensionalStandard};
  rq.expected_units = {"mm"};

  const QueryPreview p = client.preview(rq);
  const SendApproval ap = SendApproval::grant(p);
  const RetrievalResult r = client.search(p, ap);

  Outcome o;
  o.transmitted = tx->called;
  o.status = retrievalStatusName(r.status);
  o.q = tx->called ? wireQ(tx->wire) : std::string();
  return o;
}

// ── POSITIVE ARM ────────────────────────────────────────────────────────────
// Every row registers its value in secret_dimensions and then writes it a
// different way. `marker` is the substring whose survival in the wire q= means
// the secret left the machine.
struct LeakCase {
  const char* cls;
  const char* label;
  const char* question;
  double secret;
  const char* marker;
};

const LeakCase kLeakCases[] = {
    // digit forms the shipped grammar already modelled — the regression floor
    {"digit", "47.625", "thickness 47.625 mm", 47.625, "47.625"},
    {"digit", "47,625 thousands sep", "thickness 47,625 mm", 47625.0, "47,625"},
    {"digit", "4.7625e1 exponent", "thickness 4.7625e1 mm", 47.625, "4.7625e1"},
    {"digit", ".5 leading dot", "clearance .5 mm", 0.5, ".5"},
    {"digit", "R47.625 sigil", "fillet R47.625 here", 47.625, "47.625"},
    {"digit", "47.625mm glued unit", "thickness 47.625mm nominal", 47.625, "47.625"},
    // English cardinals
    {"cardinal", "forty seven point six two five", "thickness forty seven point six two five mm",
     47.625, "forty seven point six two five"},
    {"cardinal", "four seven point six two five", "thickness four seven point six two five mm",
     47.625, "four seven point six two five"},
    {"cardinal", "forty seven", "web thickness forty seven mm", 47.0, "forty seven"},
    {"cardinal", "twelve", "bore twelve mm", 12.0, "twelve"},
    // hyphenated and run-on compounds
    {"hyphenated", "forty-seven", "web thickness forty-seven mm", 47.0, "forty-seven"},
    {"hyphenated", "twenty-three point five", "rib twenty-three point five mm", 23.5,
     "twenty-three point five"},
    {"hyphenated", "fortyseven run-on", "web thickness fortyseven mm", 47.0, "fortyseven"},
    // ordinals
    {"ordinal", "forty-seventh", "the forty-seventh station offset", 47.0, "forty-seventh"},
    {"ordinal", "twelfth", "the twelfth rib pitch", 12.0, "twelfth"},
    // word/digit mixes
    {"mixed", "47 point six two five", "thickness 47 point six two five mm", 47.625,
     "point six two five"},
    {"mixed", "forty 7", "thickness forty 7 mm", 47.0, "forty"},
    {"mixed", "forty seven point 625", "thickness forty seven point 625 mm", 47.625,
     "forty seven point"},
    // scale words
    {"scale", "one hundred and twelve", "span one hundred and twelve mm", 112.0,
     "one hundred and twelve"},
    {"scale", "two thousand five hundred", "length two thousand five hundred mm", 2500.0,
     "two thousand five hundred"},
    {"scale", "forty seven thousand", "load forty seven thousand n", 47000.0,
     "forty seven thousand"},
    // fractions, spelled and typeset
    {"fraction", "three quarters", "gap three quarters inch", 0.75, "three quarters"},
    {"fraction", "1/2 ascii", "gap 1/2 inch", 0.5, "1/2"},
    {"fraction", "U+00BD vulgar half", "gap \xC2\xBD inch", 0.5, "\xC2\xBD"},
    {"fraction", "U+215D five eighths", "gap \xE2\x85\x9D inch", 0.625, "\xE2\x85\x9D"},
    {"fraction", "bare half", "gap half a mm", 0.5, "half"},
    // separators
    {"separator", "4 7 . 6 2 5 spaced", "thickness 4 7 . 6 2 5 mm", 47.625, "4 7"},
    {"separator", "47<middot>625", "thickness 47\xC2\xB7"
                                   "625 mm",
     47.625, "47\xC2\xB7"
             "625"},
    {"separator", "47_625 underscore", "thickness 47_625 mm", 47.625, "47_625"},
    {"separator", "47<bullet>625", "thickness 47\xE2\x80\xA2"
                                   "625 mm",
     47.625, "625"},
    // digits in other scripts — class B
    {"script/digit", "fullwidth",
     "thickness \xEF\xBC\x94\xEF\xBC\x97\xEF\xBC\x8E\xEF\xBC\x96\xEF\xBC\x92\xEF\xBC\x95 mm",
     47.625, "\xEF\xBC\x94"},
    {"script/digit", "arabic-indic", "thickness \xD9\xA4\xD9\xA7.\xD9\xA6\xD9\xA2\xD9\xA5 mm",
     47.625, "\xD9\xA4"},
    {"script/digit", "devanagari", "thickness \xE0\xA5\xAA\xE0\xA5\xAD mm", 47.0, "\xE0\xA5\xAA"},
    // number words in other Latin-script languages
    {"script/word", "siebenundvierzig de", "dicke siebenundvierzig mm", 47.0, "siebenundvierzig"},
    {"script/word", "quarante-sept fr", "epaisseur quarante-sept mm", 47.0, "quarante-sept"},
    {"script/word", "sechsundneunzig de", "dicke sechsundneunzig mm", 96.0, "sechsundneunzig"},
    {"script/word", "siebzehn de", "dicke siebzehn mm", 17.0, "siebzehn"},
    // unit-adjacent forms
    {"unit-adjacent", "forty seven and five eighths inches",
     "thickness forty seven and five eighths inches", 47.625, "five eighths"},
    {"unit-adjacent", "spelled unit", "thickness forty seven point six two five millimetres",
     47.625, "forty seven point six two five"},
    // spelled decimals, including dictated forms
    {"spelled", "zero point five", "clearance zero point five mm", 0.5, "zero point five"},
    {"spelled", "nought point five", "clearance nought point five mm", 0.5, "nought point five"},
    {"spelled", "oh point five dictated", "clearance oh point five mm", 0.5, "oh point five"},
    // ── forms found by probing BEYOND the original census ────────────────────
    // The census is a sample, not the class. These were added after the fix
    // landed, by asking what else the same grammar admits; each one failed on
    // HEAD for the same root cause.
    {"cardinal", "all-hyphen compound", "thickness forty-seven-point-six-two-five mm", 47.625,
     "forty-seven-point"},
    {"cardinal", "extra whitespace", "thickness   forty    seven   mm", 47.0, "forty"},
    {"scale", "one thousand two hundred thirty four",
     "length one thousand two hundred thirty four mm", 1234.0, "one thousand two hundred"},
    {"spelled", "trailing zero decimal", "bore twelve point zero mm", 12.0, "twelve point zero"},
    {"fraction", "eight and a half", "hole diameter eight and a half mm", 8.5, "and a half"},
    {"script/digit", "bare fullwidth pair", "thickness \xEF\xBC\x94\xEF\xBC\x97 mm", 47.0,
     "\xEF\xBC\x94"},
};

// ── HOMOGLYPH ARM (round 2, defect 1) ───────────────────────────────────────
// One look-alike code point per numeral word. Every row below is visually
// identical to a plain English, German or French spelling of the registered
// secret and, measured on this seam before the fold became a confusable
// skeleton, 10 of these 16 transmitted VERBATIM with status=Ok while the clean
// spelling of the same query was reduced to one word.
//
// The last rows carry code points NO fold table names, which is the point: the
// safety property is not the confusable table's completeness — no curated table
// is ever complete — it is that an unmodelled code point now JOINS the numeral
// run instead of breaking it, and a run carrying one is refused.
#define CY_O "\xD0\xBE"      // U+043E CYRILLIC SMALL LETTER O
#define CY_E "\xD0\xB5"      // U+0435 CYRILLIC SMALL LETTER IE
#define CY_S "\xD1\x81"      // U+0441 CYRILLIC SMALL LETTER ES   (glyph: c)
#define CY_R "\xD1\x80"      // U+0440 CYRILLIC SMALL LETTER ER   (glyph: p)
#define CY_I "\xD1\x96"      // U+0456 CYRILLIC SMALL LETTER UKRAINIAN I
#define CY_H "\xD2\xBB"      // U+04BB CYRILLIC SMALL LETTER SHHA (glyph: h)
#define GR_O "\xCE\xBF"      // U+03BF GREEK SMALL LETTER OMICRON
#define FW_M "\xEF\xBD\x8D"  // U+FF4D FULLWIDTH LATIN SMALL LETTER M
#define ZWSP "\xE2\x80\x8B"  // U+200B ZERO WIDTH SPACE
// Code points deliberately OUTSIDE every confusable table in this build:
#define UNMODELLED_1 "\xE1\x8E\xAA"      // U+13AA CHEROKEE LETTER GO (glyph: A)
#define UNMODELLED_2 "\xEA\x93\xB3"      // U+A4F3 LISU LETTER O      (glyph: O)

const LeakCase kHomoglyphCases[] = {
    {"homoglyph", "one cyrillic look-alike per numeral word",
     "thickness f" CY_O "rty " CY_S "even " CY_R "oint " CY_S "ix tw" CY_O " f" CY_I "ve mm",
     47.625, "rty"},
    {"homoglyph", "cyrillic o in forty only", "web thickness f" CY_O "rty seven mm", 47.0, "seven"},
    {"homoglyph", "cyrillic in the german form", "dicke s" CY_I "ebenundv" CY_I "erzig mm", 47.0,
     "ebenundv"},
    {"homoglyph", "cyrillic in the french form", "epaisseur quarant" CY_E "-s" CY_E "pt mm", 47.0,
     "pt mm"},
    {"homoglyph", "cyrillic in a teen word", "b" CY_O "re twelv" CY_E " mm", 12.0, "twelv"},
    {"homoglyph", "cyrillic in the spelled fraction", "gap thr" CY_E "e quart" CY_E "rs inch", 0.75,
     "quart"},
    {"homoglyph", "greek omicron instead of cyrillic",
     "thickness f" GR_O "rty seven p" GR_O "int six two five mm", 47.625, "rty"},
    {"homoglyph", "two scripts inside one run",
     "thickness f" CY_O "rty s" GR_O "ven p" CY_O "int six tw" GR_O " five mm", 47.625, "ven"},
    {"homoglyph", "look-alike in the UNIT, numerals clean",
     "thickness forty seven point six two five " FW_M FW_M, 47.625, "forty seven point"},
    {"homoglyph", "look-alike in the DIMENSION NOUN, numerals clean",
     "thi" CY_S "kness forty seven point six two five mm", 47.625, "forty seven point"},
    {"homoglyph", "look-alike splitting a digit run", "thickness 47" CY_O "625 mm", 47.0, "47"},
    {"homoglyph", "cyrillic in a run-on compound", "web thickness f" CY_O "rtyseven mm", 47.0,
     "rtyseven"},
    {"homoglyph", "zero-width space inside the run",
     "thickness forty" ZWSP " seven point six two five mm", 47.625, "forty"},
    {"homoglyph", "cyrillic in every word of a scale form",
     "span " CY_O "ne hundr" CY_E "d and twelv" CY_E " mm", 112.0, "hundr"},
    {"homoglyph", "cyrillic in the ordinal", "the forty-sevent" CY_H " station offset", 47.0,
     "sevent"},
    {"homoglyph", "cyrillic in the fraction denominator",
     "thickness forty seven and five eight" CY_H "s inches", 47.625, "eight"},
    // ── the unmodelled half: NOT in any fold table in this build ─────────────
    {"unmodelled", "cherokee look-alike substituted for a letter",
     "web thickness f" UNMODELLED_1 "rty seven mm", 47.0, "rty"},
    {"unmodelled", "lisu look-alike substituted for a letter",
     "b" UNMODELLED_2 "re twelve mm", 12.0, "twelve"},
    {"unmodelled", "unmodelled code point INSERTED, not substituted",
     "web thickness forty" UNMODELLED_1 " seven mm", 47.0, "seven"},
    {"unmodelled", "unmodelled code point BETWEEN two numeral words",
     "thickness forty" UNMODELLED_2 "seven point six two five mm", 47.625, "six two five"},
};

// ── NEGATIVE ARM ────────────────────────────────────────────────────────────
// Ordinary engineering queries that contain number words innocently.
//
// ROUND 2: these run at kNegativeArmSecrets, a NON-EMPTY ordinary secret set, so
// LAYER A is live for every row. At an empty set this arm cannot fail for the
// one reason it exists to catch.
const std::vector<double> kNegativeArmSecrets = {12.0, 3.0, 0.75, 47.625, 8.5, 2.0};

const char* const kInnocent[] = {
    "one-piece housing stiffness",
    "no one reported a fatigue crack",
    "at one end of the shaft",
    "second surface mirror coating",
    "no fewer than three fasteners",
    "two-piece split bearing housing",
    "a one-to-one gear ratio",
    "one of the weld passes cracked",
    "the third angle projection convention",
    "four-jaw chuck runout procedure",
    "three-point bending test method",
    "one-way clutch torque rating",
    "a two-stage compressor map",
    "the first article inspection report",
    "one-sided tolerance interpretation",
    "second order bending mode",
    "the nine o'clock position on the flange",
    "ten to one safety factor convention",
    "tens of thousands of cycles to failure",
    "one-off prototype tooling cost",
    "half hard temper brass sheet",
    "a quarter turn valve actuator",
    "three quarters of the bolts were loose",
    "double shear versus single shear",
    "triple lip radial shaft seal",
    "a single point cutting tool",
    "one hundred percent radiographic inspection",
    "two hundred weight capacity",
    "thousands of hours of service life",
    "million cycle endurance limit",
    "eight-point socket versus six-point socket",
    "twelve-point flange head bolt",
    "four-bar linkage synthesis",
    "six degrees of freedom kinematics",
    "five axis machining strategy",
    "seven percent chromium tool steel",
    "nine to five duty cycle",
    "zero clearance insert design",
    "second surface anodize appearance",
    "one thousandth of an inch tolerance",
    "the fourth quadrant of the mohr circle",
    "eleventh hour design change control",
    // added with the extra POSITIVE rows above, from the same probing pass: the
    // control set must grow whenever the attack set does, or the two arms drift.
    "a one-piece six-bolt flange with twelve holes",
    "what is the second moment of area",
    "one in ten thousand failure rate",
    "a four-bar linkage with one degree of freedom",
    "forty seven percent duty cycle",
};

// ── DECLARED COLLISIONS ─────────────────────────────────────────────────────
// The rows of kInnocent that the chosen trade-off DOES damage at
// kNegativeArmSecrets, each with the reason. Both are the word "twelve" with
// 12.0 registered, in prose where nothing marks it as a measurement.
//
// They are asserted TO BE DAMAGED, not excused. If a later change saves one, this
// gate fails and the list must be shortened deliberately; if a later change
// damages a row that is not on this list, the gate fails too. The trade-off can
// therefore only ever move on purpose.
//
// WHY NOT SAVE THEM. Nothing structural separates "twelve-point flange head
// bolt" from the POSITIVE row "the twelfth rib pitch", which this same suite
// requires to be stripped when 12.0 is registered: article, one bare numeral
// word, a non-unit noun. Any context-free rule that saves one leaks the other.
// That is the trade-off, and this pair of rows is where you can see it.
const char* const kDeclaredCollisions[] = {
    "twelve-point flange head bolt",
    "a one-piece six-bolt flange with twelve holes",
};

bool isDeclaredCollision(const std::string& row) {
  for (const char* c : kDeclaredCollisions) {
    if (row == c) return true;
  }
  return false;
}

// Every alphabetic word of the input must still be on the wire. (Digits are
// legitimately stripped; this arm is about collateral damage to WORDS.)
bool everyWordSurvives(const std::string& input, const std::string& q, std::string& missing) {
  const std::string lq = lower(q);
  const std::string in = lower(input);
  std::string word;
  for (std::size_t i = 0; i <= in.size(); ++i) {
    const char ch = i < in.size() ? in[i] : ' ';
    if (ch >= 'a' && ch <= 'z') { word.push_back(ch); continue; }
    if (!word.empty()) {
      if (word.size() >= 2 && lq.find(word) == std::string::npos) {
        missing = word;
        return false;
      }
      word.clear();
    }
  }
  return true;
}

}  // namespace

int main() {
  std::printf("== 12.1 POSITIVE: a registered secret dimension leaves in NO spelling ==\n");
  for (const LeakCase& c : kLeakCases) {
    const Outcome o = drive(c.question, {c.secret});
    const bool leaked = o.transmitted && lower(o.q).find(lower(c.marker)) != std::string::npos;
    check(!leaked, std::string(c.cls) + ": " + c.label,
          "wire q=[" + o.q + "] status=" + o.status);
  }

  std::printf("\n== 12.1 HOMOGLYPH: a look-alike code point is not a spelling we accept ==\n");
  for (const LeakCase& c : kHomoglyphCases) {
    const Outcome o = drive(c.question, {c.secret});
    const bool leaked = o.transmitted && lower(o.q).find(lower(c.marker)) != std::string::npos;
    check(!leaked, std::string(c.cls) + ": " + c.label,
          "wire q=[" + o.q + "] status=" + o.status);
  }

  std::printf("\n== THE NEGATIVE ARM CANNOT RUN BLIND ==\n");
  {
    // RULE 1. An empty secret set makes LAYER A — the context-free value match
    // that is the redactor's primary mechanism — unable to fire at all, and the
    // whole control arm below then measures nothing. It ran that way for a full
    // round and reported "0 false positives"; at an ordinary secret set the same
    // code damaged 15 of these 47 rows.
    check(!kNegativeArmSecrets.empty(),
          "the control arm's secret set is NON-EMPTY (Layer A is live for every row)",
          "kNegativeArmSecrets.size()=" + std::to_string(kNegativeArmSecrets.size()));

    // RULE 2. THE WITNESS PAIR. The same query, driven with and without the value
    // registered, must come out DIFFERENTLY. There is no dimension noun before
    // the run and no unit after it, so LAYER B cannot touch it and the digit
    // classifier cannot see it: only a context-free VALUE MATCH can produce a
    // difference here. A redactor whose Layer A is dead — or whose control arm
    // is run at an empty lexicon — cannot satisfy both halves.
    const std::string witness = "the answer is forty seven point six two five";
    const Outcome registered = drive(witness, kNegativeArmSecrets);
    const Outcome unregistered = drive(witness, {});
    check(registered.transmitted &&
              lower(registered.q).find("forty seven point") == std::string::npos,
          "witness: the run IS removed when its value is in kNegativeArmSecrets",
          "wire q=[" + registered.q + "] status=" + registered.status);
    check(unregistered.transmitted &&
              lower(unregistered.q).find("forty seven point") != std::string::npos,
          "witness: the SAME run survives when nothing is registered — so the removal",
          "wire q=[" + unregistered.q + "] status=" + unregistered.status);
    check(registered.q != unregistered.q,
          "witness: ...was LAYER A, and Layer A demonstrably fired in this suite",
          "registered=[" + registered.q + "] unregistered=[" + unregistered.q + "]");
  }

  std::printf("\n== 12.1 NEGATIVE: ordinary number words are NOT collateral damage ==\n");
  std::printf("   (driven at a NON-EMPTY secret set: {12, 3, 0.75, 47.625, 8.5, 2})\n");
  for (const char* s : kInnocent) {
    const Outcome o = drive(s, kNegativeArmSecrets);
    std::string missing;
    const bool intact = o.transmitted && everyWordSurvives(s, o.q, missing);
    if (isDeclaredCollision(s)) {
      // Asserted DAMAGED. See kDeclaredCollisions for why this cannot be saved
      // without leaking the positive row it is structurally identical to.
      check(!intact, std::string("declared collision, still damaged: ") + s,
            "wire q=[" + o.q + "] status=" + o.status +
                " — if this now PASSES, the trade-off moved; update kDeclaredCollisions");
      continue;
    }
    check(intact, std::string("intact: ") + s,
          "wire q=[" + o.q + "] status=" + o.status +
              (missing.empty() ? "" : " lost word: " + missing));
  }

  std::printf("\n== THE TRADE-OFF, PINNED IN BOTH DIRECTIONS ==\n");
  {
    // What the chosen line COSTS, stated as an assertion so it cannot widen in
    // silence: a bare numeral word for a value of 3 or less, in prose, with no
    // unit and no dimension noun, is NOT removed even when that value is
    // registered. An attacker can use this, and the next two checks bound
    // exactly how far: one small value per query, and only while nothing marks
    // it as a measurement.
    const Outcome prose = drive("the recommended count is two", {2.0});
    check(prose.transmitted && lower(prose.q).find("two") != std::string::npos,
          "COST: a bare 'two' in prose survives even with 2.0 registered",
          "wire q=[" + prose.q + "] status=" + prose.status);

    const Outcome measured = drive("bore two mm", {2.0});
    check(measured.transmitted && lower(measured.q).find("two") == std::string::npos,
          "BOUND: the same word in measurement context is still removed",
          "wire q=[" + measured.q + "] status=" + measured.status);

    const Outcome composed = drive("the recommended value is two point zero", {2.0});
    check(composed.transmitted && lower(composed.q).find("two point") == std::string::npos,
          "BOUND: and a DECIMAL composition of the same value is still removed",
          "wire q=[" + composed.q + "] status=" + composed.status);

    const Outcome idiom = drive("six degrees of freedom kinematics", {6.0});
    check(idiom.transmitted && lower(idiom.q).find("six") == std::string::npos,
          "BOUND: Layer B's idiom exemption is still powerless against a registered value",
          "wire q=[" + idiom.q + "] status=" + idiom.status);

    // THE EXEMPTION IS FOR WORDS ONLY. It must never reach the digit path, whose
    // stance is unconditional default-deny, nor the non-ASCII path. If either of
    // these ever passes, the prose bound has leaked out of the class it was
    // measured on and into the two classes that have no false-positive cost.
    const Outcome digits = drive("the recommended count is 2", {2.0});
    check(digits.transmitted && digits.q.find('2') == std::string::npos,
          "BOUND: the DIGIT 2 in the same sentence is still default-denied",
          "wire q=[" + digits.q + "] status=" + digits.status);

    const Outcome disguised = drive("the recommended count is tw\xD0\xBE", {2.0});
    check(disguised.transmitted && lower(disguised.q).find("tw") == std::string::npos,
          "BOUND: and 'two' wearing a look-alike cannot borrow the prose exemption",
          "wire q=[" + disguised.q + "] status=" + disguised.status);

    const Outcome fullwidth = drive("the recommended count is \xEF\xBC\x92", {2.0});
    check(fullwidth.transmitted && fullwidth.q.find("\xEF\xBC\x92") == std::string::npos,
          "BOUND: nor can a fullwidth digit for the same value",
          "wire q=[" + fullwidth.q + "] status=" + fullwidth.status);

    // A SECOND, OLDER RESIDUAL, pinned here so nobody reads the row above as the
    // whole story. LAYER B reads only the token IMMEDIATELY before the run, so a
    // dimension noun separated from it by any word is not measurement context —
    // "thickness two" is caught and "the thickness we use is two" is not. That
    // gap predates round 2; what round 2 changed is that Layer A no longer backs
    // it up for values of 3 or less. Widening the window is a separate change
    // with its own false-positive cost and has NOT been measured, so it is
    // recorded as open rather than quietly assumed shut.
    const Outcome far_noun = drive("the thickness we use is two", {2.0});
    check(far_noun.transmitted && lower(far_noun.q).find("two") != std::string::npos,
          "RESIDUAL (open): a non-adjacent dimension noun is not measurement context",
          "wire q=[" + far_noun.q + "] status=" + far_noun.status);
    const Outcome near_noun = drive("thickness two", {2.0});
    check(near_noun.transmitted && lower(near_noun.q).find("two") == std::string::npos,
          "RESIDUAL: ...but an ADJACENT one is, and still removes the same value",
          "wire q=[" + near_noun.q + "] status=" + near_noun.status);
  }

  std::printf("\n== 20.2 a folded multi-byte numeral does not displace its neighbours ==\n");
  {
    // THE OFFSET HAZARD, as an assertion. "½" is two raw bytes that fold to the
    // three ASCII bytes "1/2". Reading the span's raw end as (map[end-1] + 1)
    // instead of from the sentinel map lands INSIDE the UTF-8 sequence, and the
    // slice then deletes the wrong bytes: the secret survives AND the query is
    // silently mangled. Both neighbours must come through untouched.
    const Outcome o = drive("flange \xC2\xBD ACME bushing detail", {0.5}, {"ACME"});
    check(o.transmitted, "the request is still sent", "status=" + o.status);
    check(o.q.find("flange") != std::string::npos, "the word BEFORE the folded numeral survives",
          "wire q=[" + o.q + "]");
    check(o.q.find("bushing") != std::string::npos, "the word AFTER the neighbouring term survives",
          "wire q=[" + o.q + "]");
    check(o.q.find("\xC2\xBD") == std::string::npos, "the folded numeral itself is gone",
          "wire q=[" + o.q + "]");
    check(lower(o.q).find("acme") == std::string::npos,
          "and the registered term beside it is still removed", "wire q=[" + o.q + "]");
  }

  std::printf("\n== 20.2 the independent residue layer sees a spelled secret too ==\n");
  {
    // GATE 1 and GATE 3 run verifyNoResidue over the whole outgoing buffer with
    // logic that does not depend on the classifier. Force the classifier's hand
    // by asking for a value the redactor has no context clue for, and require
    // that the buffer is clean either way — stripped, or refused.
    PrivateLexicon lex;
    lex.secret_dimensions = {47.625};
    const Redactor red(lex, RedactionPolicy{});
    std::vector<std::string> residue;
    const bool clean = red.verifyNoResidue("q=thickness%20forty%20seven%20point%20six%20two%20five",
                                           residue);
    check(!clean, "a spelled secret in an ALREADY-ENCODED buffer is reported as residue",
          clean ? "verifyNoResidue called it clean" : residue.front());
    residue.clear();
    const bool clean2 = red.verifyNoResidue("q=thickness%20bracket%20stiffness", residue);
    check(clean2, "and a buffer with no secret in it is not falsely flagged",
          clean2 ? "" : residue.front());
  }

  std::printf("\n== 20.2 the residue layer has ONE arm that is independent of the VOCABULARY ==\n");
  {
    // THE CORRECTION. verifyNoResidue's value arm calls readNumerals over the
    // SAME closed lexicon the classifier uses. It is independent of the
    // classifier's CODE and NOT of its WORDS, so it cannot catch a vocabulary
    // gap — and round 1 called it "independent" without that qualification.
    //
    // "quarantasette" is Italian for 47. This build models en/de/fr only, so it
    // is a REAL vocabulary gap, and the first check below is the honest proof
    // that the gap is still open rather than a claim that it is closed.
    PrivateLexicon lex;
    lex.secret_dimensions = {47.0};
    const Redactor red(lex, RedactionPolicy{});
    std::vector<std::string> residue;

    const bool plain_clean = red.verifyNoResidue("q=thickness+quarantasette+mm", residue);
    check(plain_clean,
          "HONEST: a numeral word outside the lexicon is NOT caught by the value arm",
          plain_clean ? "vocabulary gap is open, as documented" : residue.front());

    // What the NEW arm adds is orthogonal: it catches the DISGUISE, not the
    // word. It shares nothing with the numeral lexicon — it asks whether the
    // outgoing bytes contain a token mixing ASCII letters with look-alike code
    // points from another script — so it fires here even though no layer in this
    // build can read "quarantasette" as a number.
    residue.clear();
    const bool disguised_clean =
        red.verifyNoResidue("q=thickness+quarantas\xD0\xB5tte+mm", residue);
    check(!disguised_clean,
          "a mixed-script look-alike IS caught, on a word no numeral layer can read",
          disguised_clean ? "verifyNoResidue called it clean" : residue.front());

    residue.clear();
    const bool fw_clean = red.verifyNoResidue("q=thickness+\xEF\xBC\x94\xEF\xBC\x97+mm", residue);
    check(!fw_clean, "and a decimal digit that is not an ASCII digit is caught the same way",
          fw_clean ? "verifyNoResidue called it clean" : residue.front());

    residue.clear();
    const bool zw_clean = red.verifyNoResidue("q=thickness+for\xE2\x80\x8Bty+mm", residue);
    check(!zw_clean, "and a zero-width code point wedged inside a word is caught too",
          zw_clean ? "verifyNoResidue called it clean" : residue.front());

    // AND IT MUST NOT FIRE ON ORDINARY TEXT. Accented Latin is a spelling, not a
    // disguise: flagging it would turn every French or German query into a
    // refused send, which is over-redaction wearing a security badge.
    residue.clear();
    const bool accented_clean =
        red.verifyNoResidue("q=\xC3\xA9paisseur+de+la+t\xC3\xB4le+et+H\xC3\xB6he", residue);
    check(accented_clean, "accented Latin is NOT flagged as a look-alike",
          accented_clean ? "" : residue.front());
  }

  // ── ROUND 3, defect 1: THE POST-CONDITION MUST NOT SCAN ITS OWN ENVELOPE ──
  // THE FIXTURE THAT WOULD HAVE CAUGHT THIS. Every row registers a secret that
  // appears ONLY in the transport frame the client wraps around the query, and
  // NEVER in the question. The frame is not the operator's text: pageno=1 and
  // safesearch=1 are literals in SearxngClient.cpp, HTTP/1.1 is the protocol,
  // 127.0.0.1:8888 is the sidecar, forge-retrieval/1.0 is this client's name,
  // and Content-Length is a count of the bytes, not a number anybody wrote.
  //
  // Measured identically at pristine HEAD, at round 1 and at round 2: a
  // registered 1.0 REFUSED EVERY QUERY IN EXISTENCE, because pageno=1 is always
  // present. Eight of eight rows here failed; at the three-value set {1, 2, 3}
  // all 127 honest control queries refused and nothing transmitted at all.
  //
  // THE RULE THIS PINS (see THE PAYLOAD BOUNDARY in SearxngClient.cpp): the
  // protected payload is the percent-decoded value of every request-derived wire
  // field, and nothing else. The frame is out of scope, and what licenses that is
  // GATE 3's byte-for-byte reconstruction of the frame — not an assumption.
  {
    std::printf("\nROUND 3 / DEFECT 1 — the envelope is not the payload\n");
    struct Row { const char* why; std::vector<double> secrets; const char* q; };
    const Row kRows[] = {
        {"pageno=1 is in every request", {1.0}, "flange face finish for a raised face joint"},
        {"safesearch=1 is in every request", {1.0}, "weld symbol for a fillet all around"},
        {"the HTTP/1.1 minor version", {1.1}, "what surface finish suits a dynamic seal"},
        {"the loopback host 127.0.0.1", {127.0}, "dowel pin press fit allowance guidance"},
        {"the sidecar port 8888", {8888.0}, "keyway width tolerance for a parallel key"},
        {"the User-Agent forge-retrieval/1.0", {1.0}, "helicoil insert tap drill guidance"},
        // THIS ROW IS THE PROOF THAT THE FRAME IS NOT THE PAYLOAD. The question
        // contains no "100" anywhere; the request it produces is 100 bytes long.
        {"Content-Length of this very body", {100.0},
         "schedule eighty pipe versus schedule forty"},
        {"the worst realistic set, {1, 2, 3}", {1.0, 2.0, 3.0},
         "flange face finish for a raised face joint"},
    };
    for (const Row& r : kRows) {
      const Outcome o = drive(r.q, r.secrets);
      check(o.transmitted, std::string("envelope value is not payload: ") + r.why,
            "status=" + o.status);
    }
    // And the boundary still BITES where it should: the same value written in
    // the QUESTION is payload, and is refused or stripped.
    const Outcome in_query = drive("the bore is one hundred mm", {100.0});
    check(!in_query.transmitted || lower(in_query.q).find("hundred") == std::string::npos,
          "the same value in the QUESTION is still caught", "wire q=" + in_query.q);
  }

  // ── ROUND 3, defect 2: DIGITS THAT ARE NOT CATEGORY Nd ────────────────────
  // The Nd sweep closed the decimal-digit case and these are not Nd. Measured at
  // round 2: `thickness <circled 4><circled 7>.<circled 6><circled 2><circled 5>
  // mm` reached the wire VERBATIM with status=Ok and verifyNoResidue reporting
  // CLEAN, with 47.625 registered. Six of ten such forms transmitted.
  {
    std::printf("\nROUND 3 / DEFECT 2 — circled, superscript and parenthesised digits\n");
    const std::vector<double> s = {47.625, 47.0, 8.5};
    struct Row { const char* label; const char* q; const char* must_go; };
    const Row kRows[] = {
        {"circled digits, unit context",
         "thickness \xE2\x91\xA3\xE2\x91\xA6.\xE2\x91\xA5\xE2\x91\xA1\xE2\x91\xA4 mm",
         "\xE2\x91\xA3"},
        {"circled digits, ASCII decimal point",
         "the bore is \xE2\x91\xA3\xE2\x91\xA6.\xE2\x91\xA5\xE2\x91\xA1\xE2\x91\xA4",
         "\xE2\x91\xA3"},
        {"circled digits glued to the unit", "thickness \xE2\x91\xA3\xE2\x91\xA6mm",
         "\xE2\x91\xA3"},
        {"superscript digits",
         "thickness \xE2\x81\xB4\xE2\x81\xB7.\xE2\x81\xB6\xC2\xB2\xE2\x81\xB5 mm",
         "\xE2\x81\xB4"},
        {"subscript digits", "thickness \xE2\x82\x84\xE2\x82\x87 mm", "\xE2\x82\x84"},
        {"parenthesised digits", "thickness \xE2\x91\xB7\xE2\x91\xBA mm", "\xE2\x91\xB7"},
        {"dingbat negative circled digits", "bore \xE2\x9D\xB9\xE2\x9D\xBC mm", "\xE2\x9D\xB9"},
        {"digit-with-full-stop forms", "bore \xE2\x92\x8B\xE2\x92\x8E mm", "\xE2\x92\x8B"},
        {"circled mixed with ASCII digits", "thickness 4\xE2\x91\xA6.625 mm", "\xE2\x91\xA6"},
    };
    for (const Row& r : kRows) {
      const Outcome o = drive(r.q, s);
      const bool leaked = o.transmitted && o.q.find(r.must_go) != std::string::npos;
      check(!leaked, std::string("non-Nd digit form is blocked: ") + r.label,
            "wire q=" + o.q);
    }
    // DERIVED, NOT LISTED: the same must hold for a decomposable digit class
    // nobody wrote a row for. Enclosed alphanumeric supplement U+1F10B DINGBAT
    // CIRCLED SANS-SERIF DIGIT ZERO is reached by the numeric-property rule only.
    const Outcome exotic = drive("bore \xF0\x9F\x84\x8B\xE2\x9D\xBC mm", s);
    check(!exotic.transmitted || exotic.q.find("\xE2\x9D\xBC") == std::string::npos,
          "a decomposable digit class with no hand-written row is blocked too",
          "wire q=" + exotic.q);
  }

  // ── ROUND 3, defect 3: ORDINARY ENGINEERING TYPOGRAPHY SURVIVES ───────────
  // Round 2 bounded the mixed-script arm's cost as "0 damage across the 47-row
  // control set" — a control set NONE of whose rows contains a non-ASCII code
  // point. The instrument could not see the cost it was used to bound. These
  // rows are that instrument.
  {
    std::printf("\nROUND 3 / DEFECT 3 — typography is not a disguise\n");
    const std::vector<double> s = kNegativeArmSecrets;

    // 3b. GREEK MU beside ASCII 'm' must behave like MICRO SIGN U+00B5, which
    // already passed — not because U+00B5 is safer, but because it happens to be
    // unmodelled. Two spellings of the same micrometre cannot differ.
    const Outcome greek_mu = drive("\xCE\xBCm surface finish on the ground journal", s);
    const Outcome micro = drive("\xC2\xB5m surface finish on the ground journal", s);
    check(greek_mu.transmitted && lower(greek_mu.q).find("surface finish") != std::string::npos,
          "GREEK MU beside ASCII m is technical typography, not a disguise",
          "status=" + greek_mu.status + " wire q=" + greek_mu.q);
    check(micro.transmitted == greek_mu.transmitted,
          "MICRO SIGN and GREEK MU get the SAME verdict", "micro=" + micro.status +
              " greek=" + greek_mu.status);

    // 3a. THE VERDICT MUST NOT DEPEND ON WORD ORDER. At round 2 the residue scan
    // was handed `q=<query>` and tokenized on whitespace, so the prefix glued an
    // ASCII 'q' onto the first token: "<alpha> taper" was REFUSED and "taper
    // <alpha> angle" was SENT.
    const Outcome first = drive("\xCE\xB1 taper on the mating face", s);
    const Outcome later = drive("taper \xCE\xB1 angle on the mating face", s);
    check(first.transmitted == later.transmitted,
          "the same token gets the same verdict at the START and in the MIDDLE",
          "first=" + first.status + " later=" + later.status);
    check(first.transmitted, "a lone Greek symbol in first position transmits",
          "status=" + first.status);

    // 3c. A DEGREE SIGN AND AN EN DASH MUST NOT BREAK OR CAPTURE A NUMERAL RUN.
    // Both rows are asserted against their ASCII spellings, which is the whole
    // property: a typeset mark is judged exactly as the ASCII mark is.
    const Outcome deg = drive("a ninety\xC2\xB0 elbow in the pipe run", s);
    const Outcome deg_ascii = drive("a ninety elbow in the pipe run", s);
    check(deg.transmitted && lower(deg.q).find("ninety") != std::string::npos,
          "a trailing degree sign does not capture the numeral before it",
          "status=" + deg.status + " wire q=" + deg.q);
    check(lower(deg.q).find("ninety") != std::string::npos ==
              (lower(deg_ascii.q).find("ninety") != std::string::npos),
          "the degree spelling matches the ASCII spelling");
    // The intactness claim is made at a secret set that does NOT register 1, 2 or
    // 12, because at kNegativeArmSecrets the ASCII spelling is stripped too — by
    // LAYER A, correctly, and the point here is the DASH, not the value.
    const std::vector<double> no_small = {47.625, 8.5, 0.75};
    const Outcome dash = drive("a one\xE2\x80\x93two punch of tolerance stackup", no_small);
    const Outcome dash_ascii = drive("a one-two punch of tolerance stackup", no_small);
    check(dash.transmitted && lower(dash.q).find("one") != std::string::npos &&
              lower(dash.q).find("two") != std::string::npos,
          "an en dash between numeral words reads as the ASCII hyphen",
          "status=" + dash.status + " wire q=" + dash.q);
    check((lower(dash_ascii.q).find("one") != std::string::npos) ==
              (lower(dash.q).find("one") != std::string::npos),
          "the en-dash spelling matches the ASCII spelling");
    // And where the ASCII spelling IS stripped, so is the en-dash spelling: the
    // dash fold must not become a way to carry a registered value past LAYER A.
    const Outcome dash_secret = drive("a one\xE2\x80\x93two punch of tolerance stackup", s);
    const Outcome dash_secret_ascii = drive("a one-two punch of tolerance stackup", s);
    check((lower(dash_secret.q).find("one") != std::string::npos) ==
              (lower(dash_secret_ascii.q).find("one") != std::string::npos),
          "and it matches the ASCII spelling when the value IS registered",
          "dash=" + dash_secret.q + " ascii=" + dash_secret_ascii.q);

    // An EXPONENT is not a value: mm2 and mm4 must survive whole.
    const Outcome sq = drive("area in mm\xC2\xB2 for the third section", s);
    const Outcome quart = drive("second moment in mm\xE2\x81\xB4 units", s);
    check(sq.transmitted && sq.q.find("mm\xC2\xB2") != std::string::npos,
          "a superscript exponent on a unit survives", "status=" + sq.status + " wire q=" + sq.q);
    check(quart.transmitted && quart.q.find("mm\xE2\x81\xB4") != std::string::npos,
          "and so does a fourth-power unit", "status=" + quart.status + " wire q=" + quart.q);
    // ...but a superscripted NUMBER is still a number. The exponent exemption is
    // POSITIONAL — after a letter — and must not become a channel.
    const Outcome sup_value =
        drive("thickness \xE2\x81\xB4\xE2\x81\xB7.\xE2\x81\xB6\xC2\xB2\xE2\x81\xB5 mm",
              {47.625, 8.5});
    check(!sup_value.transmitted || sup_value.q.find("\xE2\x81\xB4") == std::string::npos,
          "a superscripted NUMBER is still stripped", "wire q=" + sup_value.q);
    const Outcome sup_glued = drive("thickness \xE2\x81\xB4\xE2\x81\xB7mm", {47.0, 8.5});
    check(!sup_glued.transmitted || sup_glued.q.find("\xE2\x81\xB4") == std::string::npos,
          "and so is a superscripted number glued to its unit", "wire q=" + sup_glued.q);

    // THE HOMOGLYPH CHANNEL IS STILL CLOSED. Narrowing the mixed-script rule must
    // not reopen it; the value layer carries the short leading-look-alike forms.
    const Outcome cyr_six = drive("the bore is \xD1\x95" "ix point five mm", {6.5});
    check(!cyr_six.transmitted || lower(cyr_six.q).find("ix") == std::string::npos,
          "a SHORT leading look-alike carrying a registered value is still blocked",
          "wire q=" + cyr_six.q);
    const Outcome cyr_forty =
        drive("thickness f\xD0\xBE" "rty \xD1\x81" "even p\xD0\xBE" "int six two five mm", {47.625});
    check(!cyr_forty.transmitted || lower(cyr_forty.q).find("even") == std::string::npos,
          "and the full one-look-alike-per-word spelling is still blocked",
          "wire q=" + cyr_forty.q);
  }

  std::printf("\n%d passed, %d failed\n", g_pass, g_fail);
  return g_fail == 0 ? 0 : 1;
}
