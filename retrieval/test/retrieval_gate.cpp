// ─────────────────────────────────────────────────────────────────────────────
// retrieval_gate.cpp — the SearXNG retrieval gate.
//
// NO NETWORK. Every test drives the code through an injected fixture transport;
// the one test that touches LoopbackHttpTransport asserts a POLICY REFUSAL that
// is decided before any socket is created. Run with the machine's network
// physically denied and this binary behaves identically (12.4 / 20.2).
//
// Exit 0 iff every check passes; the run prints "N passed, M failed".
// ─────────────────────────────────────────────────────────────────────────────
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "forge/retrieval/EvidenceRecord.hpp"
#include "forge/retrieval/HttpTransport.hpp"
#include "forge/retrieval/Json.hpp"
#include "forge/retrieval/Redactor.hpp"
#include "forge/retrieval/SearchRequest.hpp"
#include "forge/retrieval/SearxngClient.hpp"

using namespace forge::retrieval;

namespace {

int g_pass = 0;
int g_fail = 0;
std::string g_section;

void section(const char* name) {
  g_section = name;
  std::cout << "\n== " << name << " ==\n";
}

void check(bool cond, const std::string& what) {
  if (cond) {
    ++g_pass;
    std::cout << "  ok   " << what << "\n";
  } else {
    ++g_fail;
    std::cout << "  FAIL " << what << "   [" << g_section << "]\n";
  }
}

bool containsCI(const std::string& haystack, const std::string& needle) {
  if (needle.empty()) return true;
  std::string h = haystack, n = needle;
  for (char& c : h) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  for (char& c : n) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return h.find(n) != std::string::npos;
}

std::string readFixture(const std::string& dir, const std::string& name) {
  std::ifstream in(dir + "/" + name, std::ios::binary);
  if (!in) {
    std::cerr << "FATAL: cannot open fixture " << dir << "/" << name << "\n";
    std::exit(2);
  }
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

// ── fixture transports (no sockets anywhere) ────────────────────────────────

// Serves one canned HTTP response and counts how many times it was asked.
class FixtureTransport final : public HttpTransport {
public:
  explicit FixtureTransport(HttpResponse canned) : canned_(std::move(canned)) {}
  HttpResponse send(const HttpRequest& request, std::uint32_t) override {
    ++calls;
    last_wire = request.serialize();
    return canned_;
  }
  int calls = 0;
  std::string last_wire;

private:
  HttpResponse canned_;
};

// Stands in for a sidecar that is not running: connect always fails. Also
// records every attempt so the fail-closed test can prove there was exactly one.
class DeadSidecarTransport final : public HttpTransport {
public:
  HttpResponse send(const HttpRequest&, std::uint32_t) override {
    ++calls;
    HttpResponse r;
    r.status = TransportStatus::ConnectFailed;
    r.detail = "Connection refused";
    return r;
  }
  int calls = 0;
};

PrivateLexicon demoLexicon() {
  PrivateLexicon lex;
  lex.customer_names = {"Northwind Aerospace"};
  lex.project_names = {"Project Halcyon"};
  lex.supplier_names = {"Kestrel Precision Machining"};
  lex.part_numbers = {"ACME-4471-B"};
  lex.secret_terms = {"gradient lattice infill"};
  lex.secret_dimensions = {47.625, 0.0035};
  return lex;
}

SearchRequest demoRequest(const std::string& question) {
  SearchRequest r;
  r.engineering_question = question;
  r.retrieval_rationale = "local evidence index has no edition of this standard";
  r.esg_assertion_id = "ESG-114";
  r.jurisdiction = "EU";
  r.standard_edition = "ISO 2768";
  r.freshness = FreshnessWindow::PastYear;
  r.expected_fact_types = {FactType::DimensionalStandard, FactType::NumericLimit};
  r.expected_units = {"mm"};
  r.max_results = 10;
  r.min_distinct_publishers = 2;
  return r;
}

}  // namespace

int main(int argc, char** argv) {
  const std::string fixtures = (argc > 1) ? argv[1] : "retrieval/test/fixtures";
  std::cout << "SearXNG retrieval gate — fixtures at " << fixtures << "\n";

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. THE REDACTION TEST (SACROSANCT 12.1)
  //    One query carrying a customer name, a part number, and a secret
  //    dimension. All three must be gone, and the standard designation must
  //    survive so the query is still worth asking.
  // ═══════════════════════════════════════════════════════════════════════════
  section("12.1 redaction: customer name + part number + secret dimension");
  {
    Redactor redactor(demoLexicon());
    const std::string raw =
        "For Northwind Aerospace part ACME-4471-B, is a 47.625 mm bore with a "
        "0.0035 in wall acceptable under ISO 2768 medium class for 6061-T6?";

    const RedactionResult r = redactor.redact(raw);
    std::cout << "  raw   : " << raw << "\n";
    std::cout << "  wire  : " << r.wire_query << "\n";
    std::cout << "  shown : " << r.preview_form << "\n";

    // — the three named leaks —
    check(!containsCI(r.wire_query, "Northwind"), "customer name 'Northwind' is gone from the wire query");
    check(!containsCI(r.wire_query, "Aerospace"), "customer name 'Aerospace' is gone from the wire query");
    check(!containsCI(r.wire_query, "ACME-4471-B"), "part number 'ACME-4471-B' is gone from the wire query");
    check(!containsCI(r.wire_query, "4471"), "part number digits '4471' are gone from the wire query");
    check(!containsCI(r.wire_query, "47.625"), "secret dimension '47.625' is gone from the wire query");
    check(!containsCI(r.wire_query, "0.0035"), "secret dimension '0.0035' is gone from the wire query");

    // — the removals were classified, not merely dropped —
    check(r.removedAnyOf(RedactionKind::RegisteredCustomer), "a RegisteredCustomer removal was recorded");
    check(r.removedAnyOf(RedactionKind::PartNumber), "a PartNumber removal was recorded");
    check(r.countOf(RedactionKind::DimensionLiteral) >= 2, "both dimension literals were recorded as removals");

    // — the query is still useful —
    check(containsCI(r.wire_query, "bore"), "the engineering question survives ('bore')");
    check(containsCI(r.wire_query, "ISO"), "the standards body survives ('ISO')");
    check(containsCI(r.wire_query, "2768"), "the allowlisted standard number survives ('2768')");
    check(containsCI(r.wire_query, "6061-T6"), "the public material grade survives ('6061-T6')");

    // — the preview shows WHAT was removed and WHERE —
    check(containsCI(r.preview_form, "[CUSTOMER]"), "preview marks the customer removal");
    check(containsCI(r.preview_form, "[PART_NUMBER]"), "preview marks the part-number removal");
    check(containsCI(r.preview_form, "[DIM]"), "preview marks the dimension removals");

    // — the independent residue verifier agrees —
    std::vector<std::string> residue;
    check(redactor.verifyQueryFullyRedacted(r.wire_query, r.kept_designations, residue),
          "independent residue verifier finds the wire query clean");
    if (!residue.empty()) {
      for (const std::string& s : residue) std::cout << "     residue: " << s << "\n";
    }
  }

  // A redactor with an EMPTY lexicon must still strip the dimension and the part
  // number: default-deny on numbers is what protects a customer nobody registered.
  section("12.1 default-deny holds with an empty lexicon");
  {
    Redactor bare{};  // no lexicon at all
    const RedactionResult r =
        bare.redact("Is a 47.625 mm bore on WIDGET-9932-C within ISO 2768 medium?");
    std::cout << "  wire  : " << r.wire_query << "\n";
    check(!containsCI(r.wire_query, "47.625"), "unregistered secret dimension is stripped anyway");
    check(!containsCI(r.wire_query, "9932"), "unregistered part number is stripped anyway");
    check(containsCI(r.wire_query, "2768"), "the allowlisted standard number still survives");
  }

  section("12.1 encoded and split residue cannot hide from the verifier");
  {
    Redactor redactor(demoLexicon());
    std::vector<std::string> residue;
    // percent-encoded customer name
    check(!redactor.verifyNoResidue("q=Northwind%20Aerospace&format=json", residue),
          "percent-encoded customer name is caught as residue");
    // punctuation-split part number
    check(!redactor.verifyNoResidue("q=acme.4471.b", residue),
          "punctuation-split part number is caught as residue");
    // the secret dimension by VALUE, in a different textual context
    check(!redactor.verifyNoResidue("q=bore+of+47.625+mm", residue),
          "secret dimension is caught by parsed value");
    check(redactor.verifyNoResidue("q=ISO+2768+medium+bore+tolerance", residue),
          "a genuinely clean buffer passes the verifier");
    // the residue report must not echo the secret it found
    residue.clear();
    redactor.verifyNoResidue("q=Northwind%20Aerospace", residue);
    bool leaked = false;
    for (const std::string& s : residue) {
      if (containsCI(s, "Northwind")) leaked = true;
    }
    check(!leaked, "the residue report names the class, never the secret itself");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. REQUEST SERIALIZER (12.1) + PREVIEW GATE (20.2)
  // ═══════════════════════════════════════════════════════════════════════════
  section("12.1 request contract + serializer");
  {
    auto dead = std::make_shared<DeadSidecarTransport>();
    SearxngClient client(dead, Redactor(demoLexicon()));

    SearchRequest bad;
    bad.engineering_question = "what is the tolerance";
    std::string why;
    check(!bad.validate(why), "a request with no stated rationale fails validation");
    check(containsCI(why, "rationale"), "the validation message names the missing rationale");

    const SearchRequest good = demoRequest(
        "For Northwind Aerospace part ACME-4471-B, what is the general tolerance for a "
        "47.625 mm feature under ISO 2768 medium class?");
    const QueryPreview p = client.preview(good);
    std::cout << p.renderForOperator();

    check(p.sendable(), "a well-formed request produces a sendable preview");
    check(p.destination_origin == "http://127.0.0.1:8888", "destination defaults to the same-Mac sidecar");
    check(p.http_method == "POST" && p.path == "/search", "uses the documented POST /search API");

    bool has_format_json = false;
    bool has_lang = false;
    bool has_time_range = false;
    for (const auto& [k, v] : p.fields) {
      if (k == "format" && v == "json") has_format_json = true;
      if (k == "language" && v == "en") has_lang = true;
      if (k == "time_range" && v == "year") has_time_range = true;
    }
    check(has_format_json, "format=json is set (SearXNG JSON Search API)");
    check(has_lang, "language filter is serialized");
    check(has_time_range, "freshness window is serialized as time_range");

    // The encoded body is the ONLY thing that goes out, and it is clean.
    check(!containsCI(p.encoded_body, "Northwind"), "encoded body carries no customer name");
    check(!containsCI(p.encoded_body, "4471"), "encoded body carries no part number");
    check(!containsCI(p.encoded_body, "47.625"), "encoded body carries no secret dimension");
    check(containsCI(p.encoded_body, "2768"), "encoded body does carry the standard number");
    check(p.body_digest != 0 && p.body_digest == digestBytes(p.encoded_body),
          "preview digest binds to the encoded body bytes");
    check(!p.removals.empty(), "the preview lists what was removed");

    // A request whose privacy class forbids the network never builds a body.
    SearchRequest local = good;
    local.privacy_class = NetworkPrivacyClass::LocalIndexOnly;
    const QueryPreview lp = client.preview(local);
    check(!lp.sendable(), "LocalIndexOnly privacy class yields an unsendable preview");
    check(lp.status == RequestBuildStatus::PrivacyClassForbidsNetwork, "and says why");
    check(lp.encoded_body.empty(), "no body is even serialized for a local-only request");
  }

  section("20.2 the send path cannot be taken without a bound approval");
  {
    auto fixture = std::make_shared<FixtureTransport>([] {
      HttpResponse r;
      r.status = TransportStatus::Ok;
      r.status_code = 200;
      r.body = "{\"results\":[]}";
      return r;
    }());
    SearxngClient client(fixture, Redactor(demoLexicon()));
    const QueryPreview p = client.preview(demoRequest("What is ISO 2768 medium class for a bore?"));

    // an ungranted approval
    RetrievalResult r1 = client.search(p, SendApproval::grant(QueryPreview{}));
    check(r1.status == RetrievalStatus::REQUEST_REJECTED, "an unbound approval is rejected");
    check(fixture->calls == 0, "and nothing was transmitted");

    // an approval bound to a DIFFERENT preview
    QueryPreview other = p;
    other.encoded_body += "&injected=1";
    other.body_digest = digestBytes(other.encoded_body);
    RetrievalResult r2 = client.search(p, SendApproval::grant(other));
    check(r2.status == RetrievalStatus::REQUEST_REJECTED, "an approval for other bytes is rejected");
    check(fixture->calls == 0, "and still nothing was transmitted");

    // the correct approval
    RetrievalResult r3 = client.search(p, SendApproval::grant(p));
    check(fixture->calls == 1, "a correctly approved request is transmitted exactly once");
    check(r3.transmit_attempts == 1, "the result reports one transmit attempt");

    // and the bytes that reached the transport are the previewed bytes
    check(fixture->last_wire.find(p.encoded_body) != std::string::npos,
          "the transport received exactly the previewed body");
    check(!containsCI(fixture->last_wire, "Northwind"), "the full HTTP request carries no customer name");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. RESPONSE PARSER (12.2, 12.3)
  // ═══════════════════════════════════════════════════════════════════════════
  section("HTTP/1.1 response parser (content-length and chunked)");
  {
    HttpResponse r;
    const std::string cl = readFixture(fixtures, "http_response_content_length.txt");
    check(parseHttpResponse(cl, 1 << 20, r), "content-length response parses");
    check(r.status_code == 200, "status code is read");
    check(r.headers["content-type"] == "application/json", "headers are lower-cased and read");
    check(r.body == "{\"results\":[],\"n_results\":0}", "body is exactly the content-length bytes");

    const std::string ch = readFixture(fixtures, "http_response_chunked.txt");
    HttpResponse r2;
    check(parseHttpResponse(ch, 1 << 20, r2), "chunked response parses");
    check(r2.body == "{\"results\":[],\"number_of_results\":0}", "chunks are reassembled exactly");

    HttpResponse r3;
    check(!parseHttpResponse("garbage without a terminator", 1 << 20, r3),
          "a malformed response is rejected, not guessed at");
    check(r3.status == TransportStatus::MalformedResponse, "and reports MalformedResponse");

    HttpResponse r4;
    check(!parseHttpResponse(cl, 4, r4), "a body over the cap is refused");
    check(r4.status == TransportStatus::ResponseTooLarge, "and reports ResponseTooLarge");
  }

  section("12.3 retrieval is not execution — hostile response fixture");
  {
    const std::string body = readFixture(fixtures, "searxng_hostile.json");
    std::vector<EvidenceRecord> ev;
    std::string detail;
    ResultHandling h;
    h.max_results = 10;
    h.esg_assertion_id = "ESG-114";
    h.expected_units = {"MPa"};
    const RetrievalStatus st =
        SearxngClient::parseSearxngResults(body, h, "2026-08-28T00:00:00Z", ev, detail);
    check(st == RetrievalStatus::Ok, "a hostile-but-well-formed body still parses (it is only data)");
    std::cout << "  parsed " << ev.size() << " admissible records: " << detail << "\n";

    bool saw_js_scheme = false;
    for (const EvidenceRecord& e : ev) {
      if (e.url.rfind("javascript:", 0) == 0 || e.url.rfind("data:", 0) == 0) saw_js_scheme = true;
    }
    check(!saw_js_scheme, "javascript:/data: URLs are dropped, not stored as sources");

    bool flagged = false;
    for (const EvidenceRecord& e : ev) {
      if (e.injection_attempt_flagged) flagged = true;
    }
    check(flagged, "an instruction-shaped span is FLAGGED as an injection attempt");

    bool control_free = true;
    for (const EvidenceRecord& e : ev) {
      for (const unsigned char c : e.quoted_span.display()) {
        if (c < 0x20 && c != '\n') control_free = false;
      }
    }
    check(control_free, "display() neutralizes control characters from retrieved text");

    bool clamped = true;
    for (const EvidenceRecord& e : ev) {
      if (e.quoted_span.size() > kMaxQuotedSpanChars + 4) clamped = false;
    }
    check(clamped, "quoted spans are clamped to the fair-use budget");
    bool any_truncated = false;
    for (const EvidenceRecord& e : ev) {
      if (e.quote_truncated) any_truncated = true;
    }
    check(any_truncated, "and the record says the quote was truncated");

    // The ONLY route from retrieved text to a usable number is an explicit,
    // unit-checked parse. Prove it accepts the matching unit and refuses others.
    std::size_t matching = 0;
    std::size_t mismatched = 0;
    for (const EvidenceRecord& e : ev) {
      if (e.validateAsNumericFact("MPa", "as-received, room temperature").has_value()) ++matching;
      if (e.validateAsNumericFact("furlongs", "").has_value()) ++mismatched;
    }
    check(matching >= 1, "validateAsNumericFact yields a candidate for the expected unit");
    check(mismatched == 0, "and yields nothing at all for a mismatched unit");

    EvidenceRecord prose;
    prose.units = "MPa";
    prose.normalized_claim = UntrustedText("the allowable is not stated in this document");
    check(!prose.validateAsNumericFact("MPa", "").has_value(),
          "a claim with no number yields no candidate even when the unit matches");
    check(!prose.validateAsNumericFact("", "").has_value(),
          "an empty expected unit can never produce a candidate");
  }

  section("well-formed SearXNG body -> evidence records");
  {
    const std::string body = readFixture(fixtures, "searxng_ok.json");
    std::vector<EvidenceRecord> ev;
    std::string detail;
    ResultHandling h;
    h.max_results = 10;
    h.esg_assertion_id = "ESG-114";
    h.expected_units = {"mm"};
    check(SearxngClient::parseSearxngResults(body, h, "2026-08-28T00:00:00Z", ev, detail) ==
              RetrievalStatus::Ok,
          "well-formed body parses");
    check(ev.size() == 5, "all five admissible results become records");
    for (const EvidenceRecord& e : ev) {
      check(!e.content_hash.empty() && e.content_hash.size() == 16,
            "record for " + e.publisher + " carries a content hash");
    }
    check(ev.front().retrieval_time_utc == "2026-08-28T00:00:00Z", "retrieval time is stamped locally");
    check(!ev.front().applicable_terms_note.empty(), "records carry an applicable-terms note");
    check(distinctPublishers(ev) == 5, "publisher is derived per source");

    // a truncated / non-JSON body fails closed rather than yielding partial data
    std::vector<EvidenceRecord> ev2;
    std::string d2;
    check(SearxngClient::parseSearxngResults("{\"results\":[{\"url\"", h, "t", ev2, d2) ==
              RetrievalStatus::RETRIEVAL_UNAVAILABLE,
          "a truncated body yields RETRIEVAL_UNAVAILABLE");
    check(ev2.empty(), "and no partial evidence");
    check(SearxngClient::parseSearxngResults("{\"results\":{}}", h, "t", ev2, d2) ==
              RetrievalStatus::RETRIEVAL_UNAVAILABLE,
          "results-not-an-array yields RETRIEVAL_UNAVAILABLE");

    // bounded parser: a deeply nested body is refused, not recursed into
    std::string deep;
    for (int i = 0; i < 200; ++i) deep += "[";
    for (int i = 0; i < 200; ++i) deep += "]";
    forge::retrieval::json::Value v;
    std::string err;
    check(!forge::retrieval::json::parse(deep, v, err), "the JSON parser refuses 200-deep nesting");
    check(containsCI(err, "nesting"), "and says the depth limit was hit");
    check(!forge::retrieval::json::parse("{\"a\":1,\"a\":2}", v, err), "duplicate keys are refused");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. AUTHORITY RANKING (12.2)
  // ═══════════════════════════════════════════════════════════════════════════
  section("12.2 authority ranking — freshness does not beat authority");
  {
    EvidenceRecord regulation;
    regulation.url = "https://www.iso.org/standard/2768";
    regulation.publisher = "iso.org";
    regulation.source_type = SourceType::LawOrRegulator;
    regulation.publication_time_utc = "1989-01-01T00:00:00Z";  // ancient

    EvidenceRecord forum;
    forum.url = "https://forum.example.org/thread/1";
    forum.publisher = "forum.example.org";
    forum.source_type = SourceType::CommunityDiscussion;
    forum.publication_time_utc = "2026-08-01T00:00:00Z";  // yesterday

    check(rankBefore(regulation, forum), "a 1989 regulation outranks a 2026 forum post");
    check(!rankBefore(forum, regulation), "and the ordering is not symmetric");

    EvidenceRecord old_paper = regulation;
    old_paper.source_type = SourceType::PeerReviewed;
    old_paper.url = "https://doi.org/10.1000/old";
    old_paper.publication_time_utc = "2001-01-01T00:00:00Z";
    EvidenceRecord new_paper = old_paper;
    new_paper.url = "https://doi.org/10.1000/new";
    new_paper.publication_time_utc = "2024-01-01T00:00:00Z";
    check(rankBefore(new_paper, old_paper), "within one tier, the fresher source wins");

    std::vector<EvidenceRecord> all = {forum, old_paper, regulation, new_paper};
    rankEvidence(all);
    check(all[0].source_type == SourceType::LawOrRegulator, "ranked list leads with the regulator");
    check(all.back().source_type == SourceType::CommunityDiscussion, "and ends with the community lead");

    check(!mayBeSoleAuthorityForCriticalValue(SourceType::CommunityDiscussion),
          "community discussion may not be sole authority for a critical value");
    check(mayBeSoleAuthorityForCriticalValue(SourceType::LawOrRegulator),
          "a regulator may");

    forum.normalized_claim = UntrustedText("allowable is 250 MPa");
    forum.units = "MPa";
    const auto cand = forum.validateAsNumericFact("MPa", "room temperature");
    check(cand.has_value(), "a community claim can still become a candidate");
    check(cand && cand->requires_corroboration, "but it is marked as requiring corroboration");

    // host-derived classification
    check(SearxngClient::classifySource("https://www.iso.org/standard/1", "") ==
              SourceType::LawOrRegulator, "iso.org classifies as LawOrRegulator");
    check(SearxngClient::classifySource("https://ecfr.gov/title-14", "") ==
              SourceType::LawOrRegulator, ".gov classifies as LawOrRegulator");
    check(SearxngClient::classifySource("https://doi.org/10.1/x", "") == SourceType::PeerReviewed,
          "doi.org classifies as PeerReviewed");
    check(SearxngClient::classifySource("https://engineering.stackexchange.com/q/1", "") ==
              SourceType::CommunityDiscussion, "stackexchange classifies as CommunityDiscussion");
    check(SearxngClient::classifySource("https://docs.skf.com/bearing.pdf", "") ==
              SourceType::ManufacturerDocument, "docs.<vendor> classifies as ManufacturerDocument");
    check(SearxngClient::publisherFromUrl("https://www.iso.org:443/a/b") == "iso.org",
          "publisher strips scheme, www and port");

    // contradictions stay visible
    EvidenceRecord a = regulation;
    a.esg_assertion_id = "ESG-114";
    a.relation = AssertionRelation::Supports;
    EvidenceRecord b = new_paper;
    b.esg_assertion_id = "ESG-114";
    b.relation = AssertionRelation::Contradicts;
    const auto conflicts = findContradictions({a, b});
    check(conflicts.size() == 1, "a support/contradict pair on one assertion is reported");
    check(containsCI(conflicts.front().note, "ESG-114"), "and names the assertion");

    // dedup keeps the higher-ranked instance
    EvidenceRecord dup_low = forum;
    dup_low.content_hash = "deadbeefdeadbeef";
    EvidenceRecord dup_high = regulation;
    dup_high.content_hash = "deadbeefdeadbeef";
    std::vector<EvidenceRecord> dups = {dup_low, dup_high};
    deduplicateEvidence(dups);
    check(dups.size() == 1, "duplicate content hashes collapse to one record");
    check(dups.front().source_type == SourceType::LawOrRegulator,
          "and the surviving record is the higher-authority one");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. FAIL CLOSED (12.4, 20.2)
  // ═══════════════════════════════════════════════════════════════════════════
  section("12.4 / 20.2 fail closed — no fallback of any kind");
  {
    auto dead = std::make_shared<DeadSidecarTransport>();
    SearxngClient client(dead, Redactor(demoLexicon()));
    const QueryPreview p = client.preview(demoRequest("What is ISO 2768 medium class for a bore?"));
    const RetrievalResult r = client.search(p, SendApproval::grant(p));

    check(r.status == RetrievalStatus::RETRIEVAL_UNAVAILABLE,
          "a sidecar that is not listening yields RETRIEVAL_UNAVAILABLE");
    check(std::strcmp(retrievalStatusName(r.status), "RETRIEVAL_UNAVAILABLE") == 0,
          "the status renders with the name the spec uses");
    check(dead->calls == 1, "exactly ONE transport attempt was made");
    check(r.transmit_attempts == 1, "and the result reports exactly one");
    check(r.evidence.empty(), "no evidence is synthesized to paper over the failure");
    check(containsCI(r.detail, "ConnectFailed"), "the detail names the transport failure");

    // A non-200 sidecar is also unavailable, not a partial success.
    auto err500 = std::make_shared<FixtureTransport>([] {
      HttpResponse x;
      x.status = TransportStatus::Ok;
      x.status_code = 500;
      x.body = "internal error";
      return x;
    }());
    SearxngClient c500(err500, Redactor(demoLexicon()));
    const QueryPreview p5 = c500.preview(demoRequest("What is ISO 2768 medium class for a bore?"));
    const RetrievalResult r5 = c500.search(p5, SendApproval::grant(p5));
    check(r5.status == RetrievalStatus::RETRIEVAL_UNAVAILABLE, "HTTP 500 yields RETRIEVAL_UNAVAILABLE");
    check(err500->calls == 1, "and is not retried");

    // A client with NO transport does not construct one.
    SearxngClient orphan(nullptr, Redactor(demoLexicon()));
    const QueryPreview po = orphan.preview(demoRequest("What is ISO 2768 medium class for a bore?"));
    check(po.sendable(), "preview still works with no transport (it is an offline operation)");
    const RetrievalResult ro = orphan.search(po, SendApproval::grant(po));
    check(ro.status == RetrievalStatus::RETRIEVAL_UNAVAILABLE,
          "a missing transport is a fail-closed condition, not a reason to make one");
    check(ro.transmit_attempts == 0, "and nothing was attempted");
  }

  section("20.2 the transport refuses any non-loopback destination");
  {
    check(isLoopbackLiteral("127.0.0.1"), "127.0.0.1 is loopback");
    check(isLoopbackLiteral("127.1.2.3"), "the whole 127.0.0.0/8 block is loopback");
    check(isLoopbackLiteral("::1"), "::1 is loopback");
    check(!isLoopbackLiteral("localhost"),
          "'localhost' is REFUSED: a name needs a resolver, and a resolver is a way off the machine");
    check(!isLoopbackLiteral("10.0.0.5"), "a LAN address is not loopback");
    check(!isLoopbackLiteral("93.184.216.34"), "a public address is not loopback");
    check(!isLoopbackLiteral("127.0.0.1.evil.com"), "a lookalike hostname is not loopback");

    // Drive the REAL transport at a public address. The refusal is decided
    // before any socket is created, so this test opens no connection.
    LoopbackHttpTransport real;
    HttpRequest req;
    req.host = "93.184.216.34";
    req.port = 80;
    req.path = "/search";
    const HttpResponse resp = real.send(req, 10);
    check(resp.status == TransportStatus::RefusedNonLoopback,
          "the production transport refuses a public destination outright");
    check(containsCI(resp.detail, "loopback"), "and says why");

    HttpRequest named = req;
    named.host = "example.com";
    check(real.send(named, 10).status == TransportStatus::RefusedNonLoopback,
          "and refuses a hostname without resolving it");
  }

  section("12.1 source diversity is enforced, not just declared");
  {
    const std::string body = readFixture(fixtures, "searxng_single_publisher.json");
    auto fixture = std::make_shared<FixtureTransport>([&] {
      HttpResponse x;
      x.status = TransportStatus::Ok;
      x.status_code = 200;
      x.body = body;
      return x;
    }());
    SearxngClient client(fixture, Redactor(demoLexicon()));
    SearchRequest req = demoRequest("What is ISO 2768 medium class for a bore?");
    req.min_distinct_publishers = 3;
    const QueryPreview p = client.preview(req);
    const RetrievalResult r = client.search(p, SendApproval::grant(p));
    check(r.status == RetrievalStatus::INSUFFICIENT_DIVERSITY,
          "one publisher against a 3-publisher requirement is reported, not silently accepted");
    check(!r.evidence.empty(), "the evidence is still returned for the operator to see");
    check(containsCI(r.detail, "distinct publishers"), "and the detail explains the shortfall");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. THE GATES THEMSELVES (20.2) — a gate that inspects one field cannot
  //    certify a request, and an approval that compares a mutable field does
  //    not bind the bytes it approved.
  // ═══════════════════════════════════════════════════════════════════════════
  section("20.2 EVERY wire field is redacted and gated, not just q=");
  {
    auto fixture = std::make_shared<FixtureTransport>([] {
      HttpResponse r;
      r.status = TransportStatus::Ok;
      r.status_code = 200;
      r.body = "{\"results\":[]}";
      return r;
    }());
    SearxngClient client(fixture, Redactor(demoLexicon()));

    // An operator scopes the search to an internal wiki host. The host is NOT a
    // registered lexicon term, so the envelope scan (gate 3) is blind to it: the
    // only thing that can stop it is the same default-deny treatment q= gets.
    SearchRequest req = demoRequest("What is ISO 2768 medium class for a bore?");
    req.include_domains = {"halcyon-9931.internal.example.com"};
    const QueryPreview p = client.preview(req);
    std::cout << "  body  : " << p.encoded_body << "\n";

    check(!containsCI(p.encoded_body, "halcyon"),
          "an internal code name in include_domains never reaches the encoded body");
    check(!containsCI(p.encoded_body, "9931"),
          "an unallowlisted number in include_domains never reaches the encoded body");
    bool any_field_leaks = false;
    for (const auto& [k, v] : p.fields) {
      (void)k;
      if (containsCI(v, "halcyon")) any_field_leaks = true;
    }
    check(!any_field_leaks, "no previewed field carries the internal host");

    // A public standards host is legitimate scoping and must still survive, or
    // the fix would have bought privacy by removing the feature.
    SearchRequest ok = demoRequest("What is ISO 2768 medium class for a bore?");
    ok.include_domains = {"iso.org", "astm.org"};
    const QueryPreview p2 = client.preview(ok);
    check(p2.sendable(), "a domain filter naming public standards hosts still builds");
    check(containsCI(p2.encoded_body, "iso.org"), "and the public host is transmitted");

    // Gate 1 must certify the WHOLE body. A registered customer name arriving
    // through site= is exactly the field q='s gate cannot see.
    SearchRequest leak = demoRequest("What is ISO 2768 medium class for a bore?");
    leak.include_domains = {"Northwind-Aerospace.example.com"};
    const QueryPreview p3 = client.preview(leak);
    check(!containsCI(p3.encoded_body, "Northwind"),
          "a registered customer name in a domain filter does not reach the body either");
    const RetrievalResult r3 = client.search(p3, SendApproval::grant(p3));
    (void)r3;
    check(fixture->last_wire.find("Northwind") == std::string::npos,
          "and no such request is ever handed to the transport");
  }

  section("20.2 the approval binds the BYTES, not a mutable digest field");
  {
    auto fixture = std::make_shared<FixtureTransport>([] {
      HttpResponse r;
      r.status = TransportStatus::Ok;
      r.status_code = 200;
      r.body = "{\"results\":[]}";
      return r;
    }());
    SearxngClient client(fixture, Redactor(demoLexicon()));
    const QueryPreview p = client.preview(demoRequest("What is ISO 2768 medium class for a bore?"));
    const SendApproval approval = SendApproval::grant(p);
    check(p.sendable() && approval.granted(), "the operator approved a well-formed preview");

    // The bytes are changed AFTER approval; body_digest is left at its approved
    // value, which is exactly what a stale or hostile reference looks like. The
    // added field carries no lexicon term, so gate 3 cannot see it.
    QueryPreview tampered = p;
    tampered.encoded_body += "&site=halcyon-9931.internal.example.com";

    const RetrievalResult r = client.search(tampered, approval);
    check(r.status == RetrievalStatus::REQUEST_REJECTED,
          "bytes mutated after approval are REJECTED, not sent");
    check(fixture->calls == 0, "and nothing reached the transport");
    check(fixture->last_wire.find("halcyon") == std::string::npos,
          "the injected field never reached the socket path");

    // The honest path still works.
    const RetrievalResult good = client.search(p, SendApproval::grant(p));
    check(good.status == RetrievalStatus::Ok, "the unmutated approved request still sends");
    check(fixture->calls == 1, "exactly one transmit");
  }

  section("12.1 a shape is not a licence: designations come from a closed list");
  {
    Redactor bare{};  // no lexicon: only the allowlist decides

    const RedactionResult r1 = bare.redact("Does the A7213 housing meet ISO 2768 medium?");
    std::cout << "  wire  : " << r1.wire_query << "\n";
    check(!containsCI(r1.wire_query, "A7213"),
          "an invented 'A'+digits token is not blessed as an ASTM designation");
    bool blessed_a = false;
    for (const std::string& d : r1.kept_designations) {
      if (containsCI(d, "A7213")) blessed_a = true;
    }
    check(!blessed_a, "and gate 1's allow-set never receives it");

    const RedactionResult r2 = bare.redact("Check the M8675309 feature against the drawing");
    std::cout << "  wire  : " << r2.wire_query << "\n";
    check(!containsCI(r2.wire_query, "M8675309"),
          "an invented 'M'+digits token is not blessed as a thread callout");
    bool blessed_m = false;
    for (const std::string& d : r2.kept_designations) {
      if (containsCI(d, "M8675309")) blessed_m = true;
    }
    check(!blessed_m, "and gate 1's allow-set never receives that either");

    // The real designations must still survive, or the fix bought privacy by
    // making the query useless.
    const RedactionResult r3 =
        bare.redact("Yield of A36 plate and seating torque for an M12 bolt and an M8x1.25 stud");
    std::cout << "  wire  : " << r3.wire_query << "\n";
    check(containsCI(r3.wire_query, "A36"), "the real ASTM designation A36 survives");
    check(containsCI(r3.wire_query, "M12"), "the real metric thread callout M12 survives");
    check(containsCI(r3.wire_query, "M8x1.25"), "a real pitch-qualified callout survives");

    // Rule 3 is the same defect class: "four digits, dash, T, digits" is also
    // the shape of a vendor part number. Both halves must be real.
    const RedactionResult r4 = bare.redact("Housing 8842-T9 came back from the vendor");
    std::cout << "  wire  : " << r4.wire_query << "\n";
    check(!containsCI(r4.wire_query, "8842-T9"),
          "an invented alloy-temper shape is not blessed as an AA designation");
    const RedactionResult r5 = bare.redact("Bracket machined from 7075-T651 and 2024-T3 stock");
    std::cout << "  wire  : " << r5.wire_query << "\n";
    check(containsCI(r5.wire_query, "7075-T651"), "the real AA alloy-temper 7075-T651 survives");
    check(containsCI(r5.wire_query, "2024-T3"), "and 2024-T3 survives");
  }

  section("12.1 designation coverage is exact, not substring");
  {
    Redactor bare{};
    const std::vector<std::string> allowed = {"A36"};
    std::vector<std::string> residue;

    check(!bare.verifyQueryFullyRedacted("A36 plate 36 mm thick", allowed, residue),
          "keeping 'A36' does not bless the bare number '36'");
    residue.clear();
    check(!bare.verifyQueryFullyRedacted("A36 plate 3 holes", allowed, residue),
          "nor a single digit that is a substring of it");
    residue.clear();
    check(!bare.verifyQueryFullyRedacted("A36 plate A360 casting", allowed, residue),
          "nor a longer token that merely contains it");
    residue.clear();
    check(bare.verifyQueryFullyRedacted("A36 plate thickness", allowed, residue),
          "the designation actually allowed still passes");
  }

  std::cout << "\n" << g_pass << " passed, " << g_fail << " failed\n";
  return g_fail == 0 ? 0 : 1;
}
