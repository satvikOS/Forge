// ─────────────────────────────────────────────────────────────────────────────
// attack_regression_gate.cpp — the three attacks that broke PR #246, as cases.
//
// An adversarial review of work/retrieval-land @ 1dd9ed9b proved three defects
// by compiling a harness against the real sources and driving the real gated
// send path. Every proof below is one of those, or the same shape one step on:
//
//   R  REDACTION BYPASS. The residue scan and the classifier were ASCII-only, so
//      a registered secret written in fullwidth forms (47.625 as U+FF14.., Boeing
//      as U+FF22..) or with ONE Cyrillic letter (bluefalcon with U+0430) was
//      transmitted: search=Ok, one send, the secret on the wire.
//   A  APPROVAL INTEGRITY. SendApproval bound the encoded body only. An approval
//      minted on client A for POST 127.0.0.1:8888/search executed on client B as
//      GET 127.0.0.1:9/autocompleter, and ResultHandling could be rewritten after
//      approval (min_distinct_publishers=0) with status=Ok.
//   H  A SECOND URL PARSER. PlanValue.cpp::hostOf() split at the first '@', kept
//      a trailing dot and ignored the port, and it decided the "different
//      publisher" corroboration rule — so one attacker host corroborated itself.
//
// THIS FILE USES ONLY THE API THAT EXISTED AT 1dd9ed9b, deliberately, so the
// SAME SOURCE builds against the defective tree and must go RED there
// (run_attack_regression_gate.sh --red-against 1dd9ed9b). A regression test that
// only compiles against the fix cannot show it would have caught the defect.
//
// THE ORACLE IS NOT THE CODE UNDER TEST. Whether a secret reached the transport
// is judged by wireLeaks() below, on the bytes a capturing transport received,
// with its own percent-decoder — never by asking the redactor whether it thinks
// it redacted.
//
// NO NETWORK. Every transport is an in-process capture.
// ─────────────────────────────────────────────────────────────────────────────
#include <algorithm>
#include <cstdio>
#include <iostream>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "forge/retrieval/EvidenceRecord.hpp"
#include "forge/retrieval/HttpTransport.hpp"
#include "forge/retrieval/PlanValue.hpp"
#include "forge/retrieval/Redactor.hpp"
#include "forge/retrieval/SearchRequest.hpp"
#include "forge/retrieval/SearxngClient.hpp"

using namespace forge::retrieval;

namespace {

int g_pass = 0;
int g_fail = 0;

// "  FAIL [ID] ..." is the line run_attack_regression_gate.sh greps for, so a
// RED proof can require that a SPECIFIC case failed, not merely that something did.
void check(bool cond, const char* id, const std::string& what) {
  if (cond) {
    ++g_pass;
    std::cout << "  ok   [" << id << "] " << what << "\n";
  } else {
    ++g_fail;
    std::cout << "  FAIL [" << id << "] " << what << "\n";
  }
}

void section(const char* name) { std::cout << "\n== " << name << " ==\n"; }

// Captures the exact request handed to the transport, AFTER every gate.
class CaptureTransport final : public HttpTransport {
 public:
  HttpResponse send(const HttpRequest& request, std::uint32_t) override {
    sent.push_back(request.serialize());
    HttpResponse r;
    r.status = TransportStatus::Ok;
    r.status_code = 200;
    r.body = "{\"results\":[]}";
    return r;
  }
  std::vector<std::string> sent;
};

// ── the oracle ──────────────────────────────────────────────────────────────
std::string percentDecode(const std::string& s) {
  auto hex = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  std::string out;
  for (std::size_t i = 0; i < s.size(); ++i) {
    if (s[i] == '+') { out.push_back(' '); continue; }
    if (s[i] == '%' && i + 2 < s.size() && hex(s[i + 1]) >= 0 && hex(s[i + 2]) >= 0) {
      out.push_back(static_cast<char>(hex(s[i + 1]) * 16 + hex(s[i + 2])));
      i += 2;
      continue;
    }
    out.push_back(s[i]);
  }
  return out;
}

std::string alnumLower(const std::string& s) {
  std::string out;
  for (const unsigned char c : s) {
    if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z')) out.push_back(static_cast<char>(c));
    if (c >= 'A' && c <= 'Z') out.push_back(static_cast<char>(c - 'A' + 'a'));
  }
  return out;
}

// How a HUMAN reading the search log reads ASCII: case-blind, punctuation-blind,
// and unable to tell 1/I/l/| or 0/O apart, or "rn" from "m". Written here from
// the UTS #39 description, independently of the redactor's own key, because the
// oracle must not share the failure modes of the code it is judging.
std::string readerSkeleton(const std::string& s) {
  std::string out;
  for (const unsigned char c : s) {
    char k = 0;
    if (c >= 'A' && c <= 'Z') k = static_cast<char>(c - 'A' + 'a');
    else if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) k = static_cast<char>(c);
    else if (c == '|') k = 'l';
    else continue;
    if (k == '1' || k == 'i') k = 'l';
    if (k == '0') k = 'o';
    if (k == 'm') { out += "rn"; continue; }
    out.push_back(k);
  }
  return out;
}

// A secret reached the wire when, after percent-decoding what the transport
// received: any non-ASCII byte survives (the only bytes this oracle cannot read,
// so they are a leak by definition — a spelling nobody folded), OR a registered
// term appears in the reader's skeleton, OR the secret dimension does.
bool wireLeaks(const CaptureTransport& cap, std::string& why) {
  static const char* kTerms[] = {"boeing", "bluefalcon", "acme4471b", "lockheed", "apollo"};
  for (const std::string& wire : cap.sent) {
    const std::string decoded = percentDecode(wire);
    for (const unsigned char c : decoded) {
      if (c >= 0x80) {
        why = "a non-ASCII byte reached the transport";
        return true;
      }
    }
    const std::string skel = readerSkeleton(decoded);
    const std::string numerals = alnumLower(decoded);
    for (const char* t : kTerms) {
      if (skel.find(readerSkeleton(t)) != std::string::npos) {
        why = std::string("registered term '") + t + "' reached the transport";
        return true;
      }
    }
    if (decoded.find("47.625") != std::string::npos || numerals.find("47625") != std::string::npos) {
      why = "the secret dimension 47.625 reached the transport";
      return true;
    }
  }
  why.clear();
  return false;
}

PrivateLexicon attackLexicon() {
  PrivateLexicon lex;
  lex.customer_names = {"Boeing"};
  lex.project_names = {"BlueFalcon", "Apollo"};
  lex.part_numbers = {"ACME-4471-B"};
  lex.secret_dimensions = {47.625};
  return lex;
}

SearchRequest request(const std::string& q) {
  SearchRequest r;
  r.engineering_question = q;
  r.retrieval_rationale = "need a public value";
  r.expected_fact_types = {FactType::MaterialProperty};
  r.privacy_class = NetworkPrivacyClass::SameMacSearxng;
  return r;
}

struct Sent {
  bool sendable = false;
  RetrievalStatus status = RetrievalStatus::RETRIEVAL_UNAVAILABLE;
  std::size_t sends = 0;
  bool leaked = false;
  std::string why;
  std::string wire;
};

// preview -> SendApproval::grant -> search: the ONE gated path, exactly as the
// attack drove it.
Sent drive(const SearchRequest& req) {
  auto cap = std::make_shared<CaptureTransport>();
  const SearxngClient client(cap, Redactor(attackLexicon()));
  const QueryPreview p = client.preview(req);
  Sent s;
  s.sendable = p.sendable();
  const RetrievalResult r = client.search(p, SendApproval::grant(p));
  s.status = r.status;
  s.sends = cap->sent.size();
  s.leaked = wireLeaks(*cap, s.why);
  if (!cap->sent.empty()) s.wire = percentDecode(cap->sent.front());
  return s;
}

std::string describe(const Sent& s) {
  return std::string("sendable=") + (s.sendable ? "yes" : "no") + " status=" +
         retrievalStatusName(s.status) + " sends=" + std::to_string(s.sends) +
         (s.leaked ? " LEAK: " + s.why : "");
}

bool refusedNothingSent(const Sent& s) {
  return (s.status == RetrievalStatus::REDACTION_REFUSED ||
          s.status == RetrievalStatus::REQUEST_REJECTED) &&
         s.sends == 0;
}

// ── corroboration fixtures ──────────────────────────────────────────────────
CitedCandidate candidateAt(const std::string& url) {
  CitedCandidate c;
  c.value = 500.0;
  c.unit = "MPa";
  c.normalized_claim = "yield 500 MPa";
  c.source_url = url;
  c.content_hash = alnumLower(url).substr(0, 16);
  c.source_type = SearxngClient::classifySource(url, "");
  c.requires_corroboration = true;
  return c;
}

// true when BoundCitation::bind accepted `second` as an independent publisher.
bool binds(const std::string& primary_url, const std::string& second_url, std::string& why_name) {
  const CitedCandidate primary = candidateAt(primary_url);
  const CitedCandidate second = candidateAt(second_url);
  BindRefusal why = BindRefusal::None;
  const auto bound = BoundCitation::bind(
      primary, OperatorCitationApproval::grant(CitationPreview::of(primary)), second, why);
  why_name = bindRefusalName(why);
  return bound.has_value();
}

}  // namespace

int main() {
  std::cout << "attack regression gate — the three defects proved against 1dd9ed9b\n";

  // ═══════════════════════════════════════════════════════════════════════════
  section("R. redaction: a registered secret in a non-ASCII spelling");
  // ═══════════════════════════════════════════════════════════════════════════
  {
    // ASCII control first: if this leaks, nothing below means anything.
    const Sent c = drive(request("6061-T6 yield strength for Boeing BlueFalcon ACME-4471-B shaft 47.625 mm"));
    std::cout << "  control : " << describe(c) << "\n";
    check(!c.leaked && c.sends == 1 && c.status == RetrievalStatus::Ok, "R00",
          "ASCII control: every registered secret is stripped and the rest is sent (" + describe(c) + ")");

    // The proved attack, verbatim: 47.625 in fullwidth digits and a fullwidth full stop.
    const Sent r01 = drive(request(
        "6061-T6 yield strength shaft \xef\xbc\x94\xef\xbc\x97\xef\xbc\x8e\xef\xbc\x96\xef\xbc\x92\xef\xbc\x95 mm"));
    check(!r01.leaked, "R01", "fullwidth 47.625 does not reach the transport (" + describe(r01) + ")");
    // A refusal would also keep it off the wire. This pins the BETTER answer —
    // fullwidth digits are modelled, so they are folded and stripped and the rest
    // of the question still goes — so a normaliser that stopped folding and just
    // refused everything non-ASCII would be caught here.
    check(r01.sends == 1 && r01.wire.find("shaft") != std::string::npos, "R02",
          "and the fullwidth number is FOLDED, not merely refused: the rest of the question is sent");

    // The proved attack: Boeing in fullwidth capitals.
    const Sent r03 = drive(request(
        "6061-T6 yield strength \xef\xbc\xa2\xef\xbc\xaf\xef\xbc\xa5\xef\xbc\xa9\xef\xbc\xae\xef\xbc\xa7 shaft"));
    check(!r03.leaked, "R03", "fullwidth BOEING does not reach the transport (" + describe(r03) + ")");
    check(r03.sends == 1 && r03.wire.find("shaft") != std::string::npos, "R04",
          "and it is folded and stripped, not refused: the rest of the question is sent");
    const Sent r03b = drive(request(
        "6061-T6 yield strength \xef\xbd\x82\xef\xbd\x8f\xef\xbd\x85\xef\xbd\x89\xef\xbd\x8e\xef\xbd\x87 shaft"));
    check(!r03b.leaked, "R03b", "lower-case fullwidth boeing (which no proper-noun rule sees) is caught too (" +
                                    describe(r03b) + ")");

    // The proved attack: ONE Cyrillic letter (U+0430) inside bluefalcon.
    const Sent r05 = drive(request("6061-T6 yield bluef\xd0\xb0lcon shaft"));
    check(!r05.leaked, "R05a", "bluefalcon with a Cyrillic a does not reach the transport (" + describe(r05) + ")");
    check(refusedNothingSent(r05), "R05",
          "a token MIXING Latin and Cyrillic is REDACTION_REFUSED, never transmitted on a guess (" +
              describe(r05) + ")");

    const Sent r06 = drive(request(
        "6061-T6 yield \xef\xbc\xa1\xef\xbc\xa3\xef\xbc\xad\xef\xbc\xa5-\xef\xbc\x94\xef\xbc\x94\xef\xbc\x97\xef\xbc\x91-\xef\xbc\xa2 shaft"));
    check(!r06.leaked, "R06", "fullwidth ACME-4471-B does not reach the transport (" + describe(r06) + ")");

    // Arabic-Indic digits with the ARABIC DECIMAL SEPARATOR (U+066B), which the
    // normaliser does not model: refused.
    const Sent r07 = drive(request("6061-T6 yield shaft \xd9\xa4\xd9\xa7\xd9\xab\xd9\xa6\xd9\xa2\xd9\xa5 mm"));
    check(!r07.leaked, "R07", "Arabic-Indic 47.625 does not reach the transport (" + describe(r07) + ")");
    check(refusedNothingSent(r07), "R07b",
          "and a code point the normaliser does not model (U+066B) is REFUSED (" + describe(r07) + ")");

    // Devanagari digits with an ASCII full stop: every Nd code point is modelled.
    const Sent r08 = drive(request("6061-T6 yield shaft \xe0\xa5\xaa\xe0\xa5\xad.\xe0\xa5\xac\xe0\xa5\xa8\xe0\xa5\xab mm"));
    check(!r08.leaked, "R08", "Devanagari 47.625 does not reach the transport (" + describe(r08) + ")");

    // Greek capital omicron inside BOEING.
    const Sent r09 = drive(request("6061-T6 yield B\xce\x9f" "EING shaft"));
    check(refusedNothingSent(r09), "R09", "a Latin/Greek mixed token is REFUSED (" + describe(r09) + ")");

    // Invisible and combining code points: not modelled, so refused outright.
    const Sent r10 = drive(request("6061-T6 yield Boe\xe2\x80\x8bing shaft"));
    check(refusedNothingSent(r10), "R10", "a zero-width space inside Boeing is REFUSED (" + describe(r10) + ")");
    const Sent r11 = drive(request("6061-T6 yield Blue\xc2\xad" "Falcon shaft"));
    check(refusedNothingSent(r11), "R11", "a soft hyphen inside BlueFalcon is REFUSED (" + describe(r11) + ")");
    const Sent r12 = drive(request("6061-T6 yield boe\xcc\x81ing shaft"));
    check(refusedNothingSent(r12), "R12", "a combining acute inside boeing is REFUSED (" + describe(r12) + ")");

    // A token written ENTIRELY in Cyrillic look-alikes is not mixed. It is folded
    // through the confusable skeleton and meets the lexicon as ACME-4471-B.
    const Sent r13 = drive(request("6061-T6 yield \xd0\x90\xd0\xa1\xd0\x9c\xd0\x95-4471-\xd0\x92 shaft"));
    check(!r13.leaked, "R13", "an all-Cyrillic ACME-4471-B does not reach the transport (" + describe(r13) + ")");

    // Superscript digits (NFKC <super>).
    const Sent r14 = drive(request("6061-T6 yield shaft \xe2\x81\xb4\xe2\x81\xb7.\xe2\x81\xb6\xc2\xb2\xe2\x81\xb5 mm"));
    check(!r14.leaked, "R14", "superscript 47.625 does not reach the transport (" + describe(r14) + ")");

    // Mathematical bold letters: not modelled, so refused.
    const Sent r15 = drive(request(
        "6061-T6 yield \xf0\x9d\x90\x81\xf0\x9d\x90\xa8\xf0\x9d\x90\x9e\xf0\x9d\x90\xa2\xf0\x9d\x90\xa7\xf0\x9d\x90\xa0 shaft"));
    check(!r15.leaked, "R15", "mathematical-bold Boeing does not reach the transport (" + describe(r15) + ")");

    // A Latin letter with a diacritic folds by canonical decomposition.
    const Sent r16 = drive(request("6061-T6 yield bluef\xc3\xa4lcon shaft"));
    check(!r16.leaked, "R16", "bluefalcon with a-umlaut does not reach the transport (" + describe(r16) + ")");

    // The language field used to be sent without ever meeting the redactor's
    // classifier: an unregistered proper noun there went to the wire verbatim.
    SearchRequest lang = request("6061-T6 yield strength");
    lang.language = "Lockheed";
    const Sent r18 = drive(lang);
    check(!r18.leaked, "R18", "a proper noun in the language field does not reach the transport (" +
                                  describe(r18) + ")");

    // The independent post-condition layer, called directly: it must reach its
    // verdict on the non-ASCII spellings too, or a classifier bug leaks them.
    const Redactor red(attackLexicon());
    std::vector<std::string> residue;
    check(!red.verifyNoResidue("q=%EF%BC%A2%EF%BC%AF%EF%BC%A5%EF%BC%A9%EF%BC%AE%EF%BC%A7", residue), "R20",
          "verifyNoResidue reports fullwidth BOEING in an encoded buffer as residue");
    residue.clear();
    check(!red.verifyNoResidue("q=bluef%D0%B0lcon+shaft", residue), "R21",
          "verifyNoResidue reports a Cyrillic-spelled bluefalcon as residue");
    residue.clear();
    check(!red.verifyNoResidue("q=shaft+%EF%BC%94%EF%BC%97%EF%BC%8E%EF%BC%96%EF%BC%92%EF%BC%95+mm", residue),
          "R22", "verifyNoResidue reports a fullwidth 47.625 as residue, by value");
    residue.clear();
    check(red.verifyNoResidue("q=6061-T6+yield+strength+shaft&format=json", residue), "R23",
          "and a genuinely clean ASCII buffer still passes (precision control)");
    // JSON \uXXXX escapes were decoded to '?' for every code point >= 0x80, which
    // made an escaped fullwidth BOEING invisible to the scan that claims to undo
    // "every encoding this codebase can emit".
    residue.clear();
    check(!red.verifyNoResidue("q=\\uFF22\\uFF2F\\uFF25\\uFF29\\uFF2E\\uFF27", residue), "R24",
          "verifyNoResidue decodes \\uXXXX escapes to real code points: escaped fullwidth BOEING is residue");

    // ONE GLYPH, TWO READINGS. PALOCHKA U+04C0 is a capital I to the fold table
    // and an l to a reader. "аpoӀӀo" — every letter Cyrillic, so not mixed — folds
    // to "apoIIo", which a letter-for-letter lexicon match does not call Apollo.
    const Sent r25 = drive(request("6061-T6 yield \xd0\xb0\xd1\x80\xd0\xbe\xd3\x80\xd3\x80\xd0\xbe shaft"));
    check(!r25.leaked, "R25", "an all-Cyrillic apollo spelled with PALOCHKA does not reach the transport (" +
                                  describe(r25) + ")");
    // ASCII has look-alikes of its own (UTS #39: I and 1 -> l, 0 -> O, m -> rn).
    // Lower-case, digit-free and not a proper noun, so no classifier rule sees it.
    const Sent r26 = drive(request("6061-T6 yield boelng shaft"));
    check(!r26.leaked, "R26", "boeing spelled boelng (l for i) does not reach the transport (" + describe(r26) + ")");
    residue.clear();
    check(!red.verifyNoResidue("q=b1uefa1con+shaft", residue), "R27",
          "verifyNoResidue reads b1uefa1con as the registered BlueFalcon (1 for l)");
    residue.clear();
    check(!red.verifyNoResidue("q=acrne+447l+b", residue), "R28",
          "verifyNoResidue reads 'acrne 447l b' as the registered ACME-4471-B (rn for m, l for 1)");

    // USABILITY CONTROL: modelled engineering typography is folded, not refused.
    const Sent r19 = drive(request("M8\xc3\x97" "1.25 bolt preload \xe2\x80\x93 A2-70 stainless"));
    check(r19.sends == 1 && !r19.leaked && r19.wire.find("M8x1.25") != std::string::npos, "R19",
          "a multiplication sign and an en dash are folded (M8x1.25 is sent), not refused (" + describe(r19) + ")");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("A. approval integrity: an approval covers the COMPLETE request");
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const Redactor red(attackLexicon());
    auto capA = std::make_shared<CaptureTransport>();
    const SearxngClient clientA(capA, red);  // POST http://127.0.0.1:8888/search
    SearchRequest req = request("6061-T6 yield strength");
    req.esg_assertion_id = "ESG-1";
    req.expected_units = {"MPa"};
    const QueryPreview pA = clientA.preview(req);
    const SendApproval apA = SendApproval::grant(pA);
    check(pA.sendable() && apA.granted(), "A00", "the operator approved a well-formed preview on client A");

    auto spendOn = [&](const SearxngEndpoint& ep, const char* id, const std::string& what) {
      auto capB = std::make_shared<CaptureTransport>();
      const SearxngClient clientB(capB, red, ep);
      const RetrievalResult r = clientB.search(pA, apA);
      check(r.status == RetrievalStatus::REQUEST_REJECTED && capB->sent.empty(), id,
            what + " (status=" + retrievalStatusName(r.status) + " sends=" +
                std::to_string(capB->sent.size()) + ")");
    };

    SearxngEndpoint b;
    b.port = 9;
    b.path = "/autocompleter";
    b.use_post = false;
    spendOn(b, "A01", "the PROVED attack: approval for POST :8888/search spent on GET :9/autocompleter is rejected");
    SearxngEndpoint port_only;
    port_only.port = 9;
    spendOn(port_only, "A02", "an approval does not transfer to another PORT");
    SearxngEndpoint path_only;
    path_only.path = "/autocompleter";
    spendOn(path_only, "A03", "an approval does not transfer to another PATH");
    SearxngEndpoint method_only;
    method_only.use_post = false;
    spendOn(method_only, "A04", "an approval does not transfer to another METHOD (GET puts the query in the log)");
    SearxngEndpoint host_only;
    host_only.host = "127.0.0.2";
    spendOn(host_only, "A05", "an approval does not transfer to another HOST");
    spendOn(SearxngEndpoint{}, "A06",
            "an approval does not transfer to a second client INSTANCE with an identical endpoint");

    auto mutated = [&](void (*edit)(QueryPreview&), const char* id, const std::string& what) {
      QueryPreview m = pA;
      edit(m);
      const std::size_t before = capA->sent.size();
      const RetrievalResult r = clientA.search(m, apA);
      check(r.status == RetrievalStatus::REQUEST_REJECTED && capA->sent.size() == before, id,
            what + " (status=" + retrievalStatusName(r.status) + ")");
    };
    mutated([](QueryPreview& m) { m.handling.min_distinct_publishers = 0; }, "A07",
            "the PROVED attack: min_distinct_publishers rewritten to 0 after approval is rejected");
    mutated([](QueryPreview& m) { m.handling.require_contradiction_check = !m.handling.require_contradiction_check; },
            "A08", "require_contradiction_check flipped after approval is rejected");
    mutated([](QueryPreview& m) { m.handling.max_results = 50; }, "A09",
            "max_results changed after approval is rejected");
    mutated([](QueryPreview& m) { m.handling.esg_assertion_id = "ESG-OTHER"; }, "A10",
            "esg_assertion_id changed after approval is rejected");
    mutated([](QueryPreview& m) { m.handling.expected_units = {"furlongs"}; }, "A11",
            "expected_units changed after approval is rejected");

    // A copy of the client is a different instance: a copied object with a
    // swapped transport must not inherit the original's approvals.
    {
      const SearxngClient copy = clientA;  // NOLINT(performance-unnecessary-copy-initialization)
      const RetrievalResult r = copy.search(pA, apA);
      check(r.status == RetrievalStatus::REQUEST_REJECTED, "A14",
            std::string("an approval does not transfer to a COPY of the client (status=") +
                retrievalStatusName(r.status) + ")");
    }

    // The honest path still sends, or every rejection above proves only a wall.
    const std::size_t before = capA->sent.size();
    const RetrievalResult ok = clientA.search(pA, apA);
    check(ok.status == RetrievalStatus::Ok && capA->sent.size() == before + 1, "A12",
          std::string("positive control: the approved request on the approving client sends once (") +
              retrievalStatusName(ok.status) + ")");

    const std::string render = pA.renderForOperator();
    check(render.find("127.0.0.1") != std::string::npos && render.find("8888") != std::string::npos &&
              render.find("POST") != std::string::npos && render.find("/search") != std::string::npos &&
              render.find(pA.encoded_body) != std::string::npos,
          "A13", "the operator render names the host, port, method, path and the exact body");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("H. corroboration: one publisher cannot corroborate itself");
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const std::string primary = "https://forum.evil.example/t/1";
    struct Case {
      const char* id;
      const char* primary;
      const char* second;
      bool must_bind;
      const char* what;
    };
    const Case cases[] = {
        {"H01", nullptr, "https://iso.org:1@forum.evil.example/t/2", false,
         "PROVED: userinfo 'iso.org:1@' does not make forum.evil.example a second publisher"},
        {"H02", nullptr, "https://forum.evil.example./t/2", false,
         "PROVED: a trailing dot does not make a second publisher"},
        {"H03", nullptr, "https://x@forum.evil.example/t/2", false,
         "PROVED: userinfo 'x@' does not make a second publisher"},
        {"H04", nullptr, "https://FORUM.evil.example/t/2", false, "case does not make a second publisher"},
        {"H05", nullptr, "https://forum.evil.example:8443/t/2", false, "a port does not make a second publisher"},
        {"H06", nullptr, "https://other.evil.example/t/2", false,
         "a sibling subdomain of the same registrant is the same publisher"},
        {"H07", nullptr, "https://forum.evil.example\\@iso.org/t/2", false,
         "a backslash-smuggled '@iso.org' does not make a second publisher"},
        {"H08", nullptr, "https://forum.evil.example#@nist.gov", false,
         "a fragment-smuggled '@nist.gov' does not make a second publisher"},
        {"H09", nullptr, "https://forum.evil.example%2e/t/2", false,
         "a host that has no canonical form cannot count as an independent publisher"},
        {"H10", "https://203.0.113.8/a", "https://203.0.113.7/b", false,
         "two IP literals are not two registrants"},
        {"H13", "https://iso.org@forum.evil.example/t/1", "https://forum.evil.example/t/2", false,
         "userinfo on the PRIMARY does not make it a different publisher either"},
        {"H14", nullptr, "https://Forum.Evil.Example./t/2", false, "case plus trailing dot together"},
        {"H15", "https://a.evil.co.uk/1", "https://b.evil.co.uk/2", false,
         "siblings under a multi-label public suffix are one registrant"},
        {"H11", "https://docs.example-alloys.com/6061-t6", "https://docs.other-alloys.example/al-6061", true,
         "positive control: two genuinely different registrants DO corroborate"},
        {"H12", "https://www.legislation.gov.uk/a", "https://www.hse.gov.uk/b", true,
         "positive control: two registrants under gov.uk are two publishers"},
    };
    for (const Case& c : cases) {
      std::string why;
      const bool bound = binds(c.primary ? c.primary : primary, c.second, why);
      check(bound == c.must_bind, c.id,
            std::string(c.what) + " (bind=" + (bound ? "BOUND" : "refused") + " " + why + ")");
    }

    // min_distinct_publishers is the SAME rule applied to a result set. It used to
    // count display hosts, so one registrant met a 3-publisher requirement with
    // three spellings of itself.
    auto diversityOf = [](const std::vector<const char*>& urls, std::size_t required, std::size_t& counted) {
      std::string body = "{\"results\":[";
      for (std::size_t i = 0; i < urls.size(); ++i) {
        if (i) body += ",";
        body += std::string("{\"url\":\"") + urls[i] + "\",\"title\":\"t\",\"content\":\"yield 276 MPa\"}";
      }
      body += "]}";
      class Fixed final : public HttpTransport {
       public:
        explicit Fixed(std::string b) : body_(std::move(b)) {}
        HttpResponse send(const HttpRequest&, std::uint32_t) override {
          HttpResponse r;
          r.status = TransportStatus::Ok;
          r.status_code = 200;
          r.body = body_;
          return r;
        }
       private:
        std::string body_;
      };
      const SearxngClient client(std::make_shared<Fixed>(body), Redactor(attackLexicon()));
      SearchRequest req = request("6061-T6 yield strength");
      req.min_distinct_publishers = required;
      const QueryPreview p = client.preview(req);
      const RetrievalResult r = client.search(p, SendApproval::grant(p));
      counted = r.distinct_publishers;
      return r.status;
    };
    std::size_t n = 0;
    RetrievalStatus st = diversityOf({"https://a.evil.example/1", "https://b.evil.example/2",
                                      "https://evil.example./3", "https://x@EVIL.example:8443/4"},
                                     3, n);
    check(st == RetrievalStatus::INSUFFICIENT_DIVERSITY && n == 1, "H17",
          std::string("one registrant spelled four ways does not meet min_distinct_publishers=3 (status=") +
              retrievalStatusName(st) + " counted=" + std::to_string(n) + ")");
    st = diversityOf({"https://203.0.113.7/a", "https://203.0.113.8/b", "https://www.iso.org/x"}, 2, n);
    check(st == RetrievalStatus::INSUFFICIENT_DIVERSITY && n == 1, "H18",
          std::string("IP-literal results are not publishers (status=") + retrievalStatusName(st) +
              " counted=" + std::to_string(n) + ")");
    st = diversityOf({"https://www.iso.org/standard/6392.html", "https://docs.example-machining.com/h"}, 2, n);
    check(st == RetrievalStatus::Ok && n == 2, "H19",
          std::string("positive control: two registrants meet a 2-publisher requirement (status=") +
              retrievalStatusName(st) + " counted=" + std::to_string(n) + ")");

    // The operator is shown the publisher the rule decided on — not the host an
    // attacker wrote into the userinfo.
    const std::string render =
        CitationPreview::of(candidateAt("https://iso.org:1@forum.evil.example/t/2")).renderForOperator();
    const std::size_t at = render.find("publisher");
    const std::string line = at == std::string::npos ? "" : render.substr(at, render.find('\n', at) - at);
    std::cout << "  preview " << line << "\n";
    check(line.find("evil.example") != std::string::npos && line.find("iso.org") == std::string::npos, "H16",
          "the citation preview names evil.example as the publisher, never the userinfo's iso.org");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THE MECHANISMS, one layer down. The sections above prove the attacks fail
  // end to end; these pin the parts that make them fail, so a RED proof can
  // remove one part and watch a NAMED case go red rather than hoping some
  // end-to-end case happens to notice. They use API that did not exist at
  // 1dd9ed9b, so against that tree they report the API as absent — RED, honestly.
  // ═══════════════════════════════════════════════════════════════════════════
#ifdef FORGE_RETRIEVAL_HAS_REQUEST_MANIFEST
  section("M. the request manifest, its digest, and the render");
  {
    // FIPS 180-4 / NIST CSRC example values for SHA-256.
    const bool kat = sha256Hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" &&
                     sha256Hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" &&
                     sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") ==
                         "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1" &&
                     sha256Hex(std::string(1000000, 'a')) ==
                         "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0";
    check(kat, "M01", "SHA-256 reproduces the FIPS 180-4 example digests (empty, abc, 448-bit, one million a)");

    const Redactor red(attackLexicon());
    SearchRequest req = request("6061-T6 yield strength");
    req.esg_assertion_id = "ESG-1";
    req.expected_units = {"MPa", "ksi"};
    auto previewOn = [&](const SearxngEndpoint& ep, const SearchRequest& r) {
      return SearxngClient(std::make_shared<CaptureTransport>(), red, ep).preview(r);
    };
    const QueryPreview base = previewOn(SearxngEndpoint{}, req);

    // Every item the render prints re-derives the digest: the render IS the
    // approval surface, not a summary of it.
    RequestManifest parsed;
    {
      const std::string render = base.renderForOperator();
      std::size_t pos = 0;
      while ((pos = render.find("\n    | ", pos)) != std::string::npos) {
        pos += 7;
        const std::size_t eol = render.find('\n', pos);
        const std::string line = render.substr(pos, eol - pos);
        const std::size_t eq = line.find(" = ");
        std::string value;
        const std::string esc = eq == std::string::npos ? "" : line.substr(eq + 3);
        for (std::size_t i = 0; i < esc.size(); ++i) {
          if (esc[i] != '\\' || i + 1 >= esc.size()) { value.push_back(esc[i]); continue; }
          const char k = esc[++i];
          if (k == 'r') value.push_back('\r');
          else if (k == 'n') value.push_back('\n');
          else if (k == 't') value.push_back('\t');
          else if (k == 'x' && i + 2 < esc.size()) {
            value.push_back(static_cast<char>(std::stoi(esc.substr(i + 1, 2), nullptr, 16)));
            i += 2;
          } else value.push_back(k);
        }
        parsed.emplace_back(eq == std::string::npos ? line : line.substr(0, eq), value);
        pos = eol;
      }
    }
    check(!parsed.empty() && parsed == base.approval_manifest &&
              manifestDigestHex(parsed) == base.request_digest &&
              base.renderForOperator().find(base.request_digest) != std::string::npos,
          "M02", "the operator render lists every manifest item losslessly, and they re-derive the request digest (" +
                     std::to_string(parsed.size()) + " items)");

    auto has = [&](const char* item) {
      for (const auto& [k, v] : base.approval_manifest) {
        (void)v;
        if (k == item) return true;
      }
      return false;
    };
    check(has("scheme") && has("connect.host") && has("connect.port") && has("http.method") && has("http.path") &&
              has("http.query") && has("http.body") && has("http.wire_bytes") && has("handling.max_results") &&
              has("handling.min_distinct_publishers") && has("handling.require_contradiction_check") &&
              has("handling.esg_assertion_id") && has("handling.expected_units[1]"),
          "M03", "the manifest names scheme, host, port, method, path, query, body, wire bytes and every handling field");

    // Coverage, isolated from the instance check: the digest of each single-field
    // variation differs from the base. In-process the instance check would catch
    // a transferred approval first, so only this proves the DIGEST covers it —
    // which is what the executor's cross-process approval rests on.
    auto differs = [&](const char* id, const std::string& what, const QueryPreview& v) {
      check(v.sendable() && v.request_digest != base.request_digest, id, "the request digest covers " + what);
    };
    SearxngEndpoint e;
    e = SearxngEndpoint{}; e.port = 9;                differs("M04", "the port", previewOn(e, req));
    e = SearxngEndpoint{}; e.host = "127.0.0.2";      differs("M05", "the host", previewOn(e, req));
    e = SearxngEndpoint{}; e.path = "/autocompleter"; differs("M06", "the path", previewOn(e, req));
    e = SearxngEndpoint{}; e.use_post = false;        differs("M07", "the method", previewOn(e, req));
    SearchRequest v = req; v.min_distinct_publishers = 3;           differs("M08", "min_distinct_publishers", previewOn(SearxngEndpoint{}, v));
    v = req; v.require_contradiction_check = false;                 differs("M09", "require_contradiction_check", previewOn(SearxngEndpoint{}, v));
    v = req; v.max_results = 7;                                     differs("M10", "max_results", previewOn(SearxngEndpoint{}, v));
    v = req; v.esg_assertion_id = "ESG-2";                          differs("M11", "esg_assertion_id", previewOn(SearxngEndpoint{}, v));
    v = req; v.expected_units = {"MPa"};                            differs("M12", "expected_units", previewOn(SearxngEndpoint{}, v));
    v = req; v.engineering_question = "6061-T6 tensile strength";   differs("M13", "the body", previewOn(SearxngEndpoint{}, v));

    // Two clients, identical configuration, identical request: the request
    // digest is the SAME (that is what makes the executor's cross-process record
    // possible) and the instance is not.
    const QueryPreview twin = previewOn(SearxngEndpoint{}, req);
    check(twin.request_digest == base.request_digest && twin.client_instance != base.client_instance &&
              base.client_instance != 0,
          "M14", "an identical request on another client has the same request digest and a different instance");

    // grant() re-derives, and refuses what does not describe itself.
    QueryPreview edited = base;
    edited.approval_manifest.back().second = "furlongs";
    check(!SendApproval::grant(edited).granted(), "M15",
          "grant() refuses a preview whose manifest was edited without its digest (the render would lie)");
    check(!SendApproval::grant(QueryPreview{}).granted(), "M16",
          "grant() refuses a default-constructed preview that describes no request");

    SearxngEndpoint get;
    get.use_post = false;
    const QueryPreview pg = previewOn(get, req);
    std::string q, body;
    for (const auto& [k, val] : pg.approval_manifest) {
      if (k == "http.query") q = val;
      if (k == "http.body") body = val;
    }
    check(q == pg.encoded_body && body.empty(), "M17", "for GET the manifest records the query in http.query");

    // The summary lines at the top of the render are not a second, uncovered
    // description of the destination: edit the free-standing fields to claim
    // another endpoint and the render still names the one the digest covers.
    QueryPreview liar = base;
    liar.destination_origin = "http://127.0.0.1:9";
    liar.http_method = "GET";
    liar.path = "/autocompleter";
    const std::string lr = liar.renderForOperator();
    check(lr.find("127.0.0.1:9\n") == std::string::npos && lr.find("/autocompleter") == std::string::npos &&
              lr.find("http://127.0.0.1:8888\n") != std::string::npos && lr.find("request       : POST /search\n") != std::string::npos,
          "M18", "the render's destination and request lines are read from the digested manifest, not from editable fields");
  }

  section("F. the one Unicode normaliser");
  {
    const detail::Folded fw = detail::foldForMatch("\xef\xbc\xa2\xef\xbc\xaf\xef\xbc\xa5\xef\xbc\xa9\xef\xbc\xae\xef\xbc\xa7 \xef\xbc\x94\xef\xbc\x97\xef\xbc\x8e\xef\xbc\x96\xef\xbc\x92\xef\xbc\x95");
    check(fw.ok() && fw.text == "BOEING 47.625", "F01", "fullwidth letters and digits fold to ASCII ('" + fw.text + "')");
    check(fw.raw_offset.size() == fw.text.size() + 1 && fw.raw_offset[1] == 3, "F02",
          "every folded byte maps back to the input byte it came from");

    auto issue = [](const std::string& s) {
      const detail::Folded f = detail::foldForMatch(s);
      return f.ok() ? std::string("ok") : std::string(detail::foldIssueName(f.issues.front().kind));
    };
    check(issue("bluef\xd0\xb0lcon") == "MixedScript", "F03", "Latin+Cyrillic in one token is MixedScript");
    check(issue("\xd0\x90\xd0\xa1\xd0\x9c\xd0\x95") == "ok" &&
              detail::foldForMatch("\xd0\x90\xd0\xa1\xd0\x9c\xd0\x95").text == "ACME",
          "F04", "an all-Cyrillic look-alike token is NOT mixed and skeletons to ACME");
    check(issue("4\xef\xbc\x97") == "MixedDecimalSystems", "F05", "ASCII and fullwidth digits in one token are refused");
    check(issue("Boe\xe2\x80\x8bing") == "UnmodelledCodePoint", "F06", "U+200B is not modelled");
    check(issue("\xc0\xaf") == "InvalidUtf8" && issue("\xed\xa0\x80") == "InvalidUtf8" &&
              issue("\xf5\x80\x80\x80") == "InvalidUtf8" && issue("\xe2\x82") == "InvalidUtf8",
          "F07", "overlong, surrogate, out-of-range and truncated UTF-8 are InvalidUtf8");
    check(issue("bluefalcon \xd0\x90\xd0\xa1\xd0\x9c\xd0\x95") == "ok", "F08",
          "scripts are judged PER TOKEN: a Latin word beside a Cyrillic word is not mixed");
    check(detail::normalizeForMatch("\xef\xbc\xa1\xef\xbc\xa3\xef\xbc\xad\xef\xbc\xa5-4471") == "acme4471" &&
              detail::normalizeForMatch("B\xc3\xb6hler") == "bohler",
          "F09", "lexicon terms normalise through the same fold");
    check(detail::decodeForResidueScan("\\uD835\\uDC01") == "\xf0\x9d\x90\x81" &&
              issue(detail::decodeForResidueScan("\\uD835")) == "UnmodelledCodePoint",
          "F10", "a \\u surrogate pair decodes to one code point; a lone surrogate becomes a refused U+FFFD");
    std::string a;
    detail::FoldScript s = detail::FoldScript::Common;
    char32_t z = 0;
    check(detail::foldCodePoint(0x0966 + 7, a, s, z) && a == "7" && z == 0x0966 &&
              detail::foldCodePoint(0x1FBF9, a, s, z) && a == "9" && !detail::foldCodePoint(0x1FBFA, a, s, z),
          "F11", "Nd ranges fold by value and end exactly at their tenth code point");
#ifndef FORGE_RETRIEVAL_HAS_LEXICON_SKELETON
    check(false, "F13", "this tree has no lexicon skeleton key");
#else
    check(detail::lexiconKey("Boeing") == detail::lexiconKey("B0EING") &&
              detail::lexiconKey("BlueFalcon") == detail::lexiconKey("b1uefa|con") &&
              detail::lexiconKey("Amco") == detail::lexiconKey("ARNCO") &&
              detail::lexiconKey("Apollo") == detail::lexiconKey("\xd0\xb0\xd1\x80\xd0\xbe\xd3\x80\xd3\x80\xd0\xbe") &&
              detail::lexiconKey("Boeing") != detail::lexiconKey("Boring"),
          "F13", "the lexicon key is a case-blind UTS #39 skeleton: 0/O, 1/I/i/l/|, m/rn meet; other letters do not");
#endif
    const Redactor bare{};
    std::vector<std::string> residue;
    check(!bare.verifyQueryFullyRedacted("caf\xc3\xa9", {}, residue), "F12",
          "the strict query scan refuses any byte >= 0x80 that skipped the normaliser");
  }

  section("P. publisher identity for corroboration");
  {
    const struct {
      const char* url;
      const char* want;
    } cases[] = {
        {"https://www.iso.org/a", "iso.org"},
        {"https://iso.org:1@forum.evil.example/t/2", "evil.example"},
        {"https://FORUM.evil.example./t", "evil.example"},
        {"https://hse.gov.uk/x", "hse.gov.uk"},
        {"https://www.legislation.gov.uk/x", "legislation.gov.uk"},
        {"https://gov.uk/x", ""},
        {"https://203.0.113.7/x", ""},
        {"https://localhost/x", ""},
        {"https://xn--nst-jhd.gov/x", ""},
        {"ftp://iso.org/x", ""},
        {"https://forum.evil.example%2e/t", ""},
    };
    std::string bad;
    for (const auto& c : cases) {
      const std::string got = SearxngClient::corroborationPublisher(c.url);
      if (got != c.want) bad += std::string(" ") + c.url + " -> '" + got + "' (want '" + c.want + "');";
    }
    check(bad.empty(), "P01", "corroborationPublisher reduces canonical hosts to their registrant, or refuses" + bad);
  }
#else
  section("M/F/P. mechanisms");
  check(false, "M00", "this tree has no request manifest, no SHA-256 request digest, no Unicode normaliser "
                      "and no corroborationPublisher — the mechanisms the fix consists of are absent");
#endif

  std::cout << "\n" << g_pass << " passed, " << g_fail << " failed\n";
  return g_fail == 0 ? 0 : 1;
}
