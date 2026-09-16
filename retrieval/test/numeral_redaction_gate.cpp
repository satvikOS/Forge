// ─────────────────────────────────────────────────────────────────────────────
// numeral_redaction_gate.cpp — TWO-SIDED gate for numerals that are not ASCII
// digits: numbers spelled in WORDS, and digits spelled in other SCRIPTS.
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

// ── NEGATIVE ARM ────────────────────────────────────────────────────────────
// Ordinary engineering queries that contain number words innocently. NOTHING is
// registered, so nothing here may be touched. These are the control; if the
// numeral reader learns to fire on sight, this is what it destroys.
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

  std::printf("\n== 12.1 NEGATIVE: ordinary number words are NOT collateral damage ==\n");
  for (const char* s : kInnocent) {
    const Outcome o = drive(s, {});
    std::string missing;
    const bool intact = o.transmitted && everyWordSurvives(s, o.q, missing);
    check(intact, std::string("intact: ") + s,
          "wire q=[" + o.q + "] status=" + o.status +
              (missing.empty() ? "" : " lost word: " + missing));
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

  std::printf("\n%d passed, %d failed\n", g_pass, g_fail);
  return g_fail == 0 ? 0 : 1;
}
