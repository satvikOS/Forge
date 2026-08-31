#include "forge/retrieval/SearxngClient.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <ctime>
#include <set>

#include "forge/retrieval/Json.hpp"

namespace forge::retrieval {
namespace {

std::string toLower(std::string s) {
  for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

bool endsWith(const std::string& s, const std::string& suffix) {
  return s.size() >= suffix.size() && s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool contains(const std::string& s, const char* needle) {
  return s.find(needle) != std::string::npos;
}

}  // namespace

const char* retrievalStatusName(RetrievalStatus s) {
  switch (s) {
    case RetrievalStatus::Ok: return "Ok";
    case RetrievalStatus::RETRIEVAL_UNAVAILABLE: return "RETRIEVAL_UNAVAILABLE";
    case RetrievalStatus::REDACTION_REFUSED: return "REDACTION_REFUSED";
    case RetrievalStatus::REQUEST_REJECTED: return "REQUEST_REJECTED";
    case RetrievalStatus::POLICY_LOCAL_ONLY: return "POLICY_LOCAL_ONLY";
    case RetrievalStatus::INSUFFICIENT_DIVERSITY: return "INSUFFICIENT_DIVERSITY";
  }
  return "Unknown";
}

std::string SearxngEndpoint::origin() const {
  return "http://" + host + ":" + std::to_string(port);
}

SendApproval SendApproval::grant(const QueryPreview& preview) {
  SendApproval a;
  // A preview that did not build cleanly cannot be approved at all: there is no
  // "approve anyway" path for a redaction residue or a privacy-class refusal.
  if (!preview.sendable()) return a;
  // Bind to the BYTES, not to body_digest. body_digest is a mutable field of a
  // struct the caller owns; encoded_body is the thing that reaches the socket.
  // Deriving the token from the payload is what makes it a capability over
  // those bytes rather than an assertion about a number next to them.
  a.digest_ = digestBytes(preview.encoded_body);
  a.granted_ = true;
  return a;
}

std::string utcTimestampNow() {
  const auto now = std::chrono::system_clock::now();
  const std::time_t t = std::chrono::system_clock::to_time_t(now);
  std::tm tm{};
#if defined(_WIN32)
  gmtime_s(&tm, &t);
#else
  gmtime_r(&t, &tm);
#endif
  char buf[32];
  std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
  return std::string(buf);
}

SearxngClient::SearxngClient(std::shared_ptr<HttpTransport> transport, Redactor redactor,
                             SearxngEndpoint endpoint)
    : transport_(std::move(transport)), redactor_(std::move(redactor)), endpoint_(std::move(endpoint)) {}

std::string SearxngClient::publisherFromUrl(const std::string& url) {
  std::size_t start = url.find("://");
  start = (start == std::string::npos) ? 0 : start + 3;
  std::size_t end = url.find('/', start);
  if (end == std::string::npos) end = url.size();
  std::string host = toLower(url.substr(start, end - start));
  const std::size_t at = host.find('@');
  if (at != std::string::npos) host = host.substr(at + 1);
  const std::size_t colon = host.find(':');
  if (colon != std::string::npos) host = host.substr(0, colon);
  if (host.rfind("www.", 0) == 0) host = host.substr(4);
  return host;
}

SourceType SearxngClient::classifySource(const std::string& url, const std::string& engine) {
  // Derived from the URL HOST, never from text the page supplied about itself.
  const std::string host = publisherFromUrl(url);
  (void)engine;  // engine name is a hint only; it is not authority evidence

  // 1. applicable law / regulator / authorized standard
  if (endsWith(host, ".gov") || endsWith(host, ".gov.uk") || endsWith(host, ".mil") ||
      endsWith(host, "europa.eu") || contains(host, "legislation.") || contains(host, "ecfr.") ||
      contains(host, "federalregister.") || host == "iso.org" || endsWith(host, ".iso.org") ||
      host == "asme.org" || host == "astm.org" || host == "ansi.org" || host == "iec.ch" ||
      host == "din.de" || host == "bsigroup.com" || host == "nfpa.org" || host == "sae.org" ||
      host == "cen.eu" || host == "aws.org") {
    return SourceType::LawOrRegulator;
  }
  // 3. peer-reviewed / official dataset
  if (contains(host, "doi.org") || contains(host, "arxiv.org") || contains(host, "sciencedirect") ||
      contains(host, "springer") || contains(host, "wiley") || contains(host, "ieee.org") ||
      contains(host, "nature.com") || contains(host, "acm.org") || contains(host, "pubmed") ||
      contains(host, "ncbi.nlm.nih.gov") || contains(host, "tandfonline")) {
    return SourceType::PeerReviewed;
  }
  // 6. community discussion — lead only
  if (contains(host, "stackexchange") || contains(host, "stackoverflow") ||
      contains(host, "reddit.com") || contains(host, "quora.com") ||
      contains(host, "eng-tips.com") || contains(host, "practicalmachinist") ||
      contains(host, "forum") || contains(host, "discourse.")) {
    return SourceType::CommunityDiscussion;
  }
  // 4. reputable institutional reference
  if (endsWith(host, ".edu") || endsWith(host, ".ac.uk") || endsWith(host, ".edu.au") ||
      contains(host, "nist.") || contains(host, "nasa.gov") || contains(host, "esa.int") ||
      contains(host, "wikipedia.org")) {
    return SourceType::InstitutionalReference;
  }
  // 2. original manufacturer / project documentation
  if (contains(host, "docs.") || contains(host, "support.") || contains(host, "catalog") ||
      contains(host, "datasheet") || endsWith(host, ".com") || endsWith(host, ".de") ||
      endsWith(host, ".co.jp")) {
    // A commercial host is manufacturer documentation only when the path or host
    // looks like product documentation; otherwise it is a secondary source.
    if (contains(host, "docs.") || contains(host, "support.") || contains(host, "catalog") ||
        contains(host, "datasheet")) {
      return SourceType::ManufacturerDocument;
    }
  }
  return SourceType::SecondaryTechnical;
}

QueryPreview SearxngClient::preview(const SearchRequest& request) const {
  QueryPreview p;
  p.destination_class = "same-Mac SearXNG sidecar (sole permitted egress, SACROSANCT 20.2)";
  p.destination_origin = endpoint_.origin();
  p.http_method = endpoint_.use_post ? "POST" : "GET";
  p.path = endpoint_.path;

  std::string why;
  if (!request.validate(why)) {
    p.status = RequestBuildStatus::InvalidRequest;
    p.status_detail = why;
    return p;
  }
  if (request.privacy_class != NetworkPrivacyClass::SameMacSearxng) {
    p.status = RequestBuildStatus::PrivacyClassForbidsNetwork;
    p.status_detail = "privacy class is LocalIndexOnly: this request must be served by the local index";
    return p;
  }

  p.handling.max_results = request.max_results;
  p.handling.min_distinct_publishers = request.min_distinct_publishers;
  p.handling.require_contradiction_check = request.require_contradiction_check;
  p.handling.esg_assertion_id = request.esg_assertion_id;
  p.handling.expected_units = request.expected_units;

  // ── redact ────────────────────────────────────────────────────────────────
  const RedactionResult red = redactor_.redact(request.engineering_question);
  p.redacted_query = red.wire_query;
  p.annotated_query = red.preview_form;
  p.removals = red.events;

  // Every designation any redaction pass deliberately kept. Gate 1 checks the
  // WHOLE q= value, so the scope terms' allowlisted numbers must be merged in
  // or "ISO 2768:1989" would be re-flagged as a leaked dimension.
  std::vector<std::string> allowed = red.kept_designations;

  // Scope terms are operator-authored policy, not user content, but they are put
  // through the same redactor so an edition string carrying a project code name
  // cannot ride along.
  std::string scope;
  auto appendScope = [&](const std::string& text) {
    if (text.empty()) return;
    const RedactionResult r = redactor_.redact(text);
    if (r.wire_query.empty()) return;
    scope += " " + r.wire_query;
    allowed.insert(allowed.end(), r.kept_designations.begin(), r.kept_designations.end());
    p.removals.insert(p.removals.end(), r.events.begin(), r.events.end());
  };
  appendScope(request.standard_edition);
  appendScope(request.jurisdiction);

  std::string q = p.redacted_query + scope;
  while (!q.empty() && q.back() == ' ') q.pop_back();

  if (q.empty()) {
    p.status = RequestBuildStatus::InvalidRequest;
    p.status_detail = "nothing survived redaction: the question was entirely proprietary";
    return p;
  }
  p.redacted_query = q;

  // The domain filter is user-supplied text that reaches the socket verbatim, so
  // it goes through the redactor exactly like the question does. A host name is
  // not prose: it is transmitted only if it survived the redactor BYTE FOR BYTE.
  // Anything the redactor touched is DROPPED rather than sent in a mangled form
  // that would still carry the shape of the original. Dropping a filter widens
  // the search rather than narrowing it, which is a scope change and not a leak;
  // the removal is recorded in p.removals and the missing field is visible in
  // the operator's preview, so it is never a SILENT widening.
  std::string sites;
  for (const std::string& d : request.include_domains) {
    const RedactionResult r = redactor_.redact(d);
    if (r.wire_query == d && r.events.empty()) {
      if (!sites.empty()) sites += ",";
      sites += d;
      allowed.insert(allowed.end(), r.kept_designations.begin(), r.kept_designations.end());
      continue;
    }
    p.removals.insert(p.removals.end(), r.events.begin(), r.events.end());
    if (r.events.empty()) {
      // The redactor rewrote it without classifying a removal (budget clamp);
      // it is still not the string the operator wrote, so it is not sent.
      RedactionEvent ev;
      ev.kind = RedactionKind::Url;
      ev.matched = d;
      ev.marker = "[URL]";
      ev.length = d.size();
      p.removals.push_back(std::move(ev));
    }
  }

  // ── serialize the documented SearXNG Search API parameters ────────────────
  // `operator_constant` marks a value this client itself authored: a literal
  // written in this file or the name of an enumerator. Everything else came from
  // the request and must clear the strict scan below. The flag is set HERE, at
  // the one place fields are created, so a new field cannot be added without
  // answering the question.
  struct WireField {
    std::string name;
    std::string value;
    bool operator_constant;
  };
  std::vector<WireField> wire;
  wire.push_back({"q", q, false});
  wire.push_back({"format", "json", true});
  wire.push_back({"language", request.language, false});
  wire.push_back({"pageno", "1", true});
  wire.push_back({"safesearch", "1", true});
  const std::string fresh = freshnessName(request.freshness);
  if (!fresh.empty()) wire.push_back({"time_range", fresh, true});
  if (!sites.empty()) wire.push_back({"site", sites, false});

  std::string body;
  for (const WireField& f : wire) {
    p.fields.emplace_back(f.name, f.value);
    if (!body.empty()) body.push_back('&');
    body += formEncode(f.name);
    body.push_back('=');
    body += formEncode(f.value);
  }

  // ── GATE 1: strict residue scan on the ENTIRE encoded body ────────────────
  // A gate that inspects one field cannot certify a request. This one certifies
  // the BYTES: it parses the body back out of the string that will actually be
  // sent, matches every pair to a field this client declared, refuses any pair
  // it cannot account for, and puts every non-constant value through the strict
  // default-deny scan. `site=` used to bypass all of this because the gate only
  // ever looked at `q=`.
  std::vector<std::string> residue;
  {
    std::vector<std::string> found;
    if (!redactor_.verifyNoResidue(body, found)) {
      residue.insert(residue.end(), found.begin(), found.end());
    }
    std::size_t at = 0;
    std::size_t seen = 0;
    while (at <= body.size()) {
      const std::size_t amp = body.find('&', at);
      const std::string pair = body.substr(at, amp == std::string::npos ? std::string::npos : amp - at);
      const std::size_t eq = pair.find('=');
      const std::string name =
          detail::decodeForResidueScan(eq == std::string::npos ? pair : pair.substr(0, eq));
      const std::string value =
          eq == std::string::npos ? std::string() : detail::decodeForResidueScan(pair.substr(eq + 1));
      const WireField* field = nullptr;
      for (const WireField& f : wire) {
        if (f.name == name) { field = &f; break; }
      }
      ++seen;
      if (field == nullptr) {
        residue.push_back("undeclared wire field '" + name + "' is present in the encoded body");
      } else if (field->value != value) {
        residue.push_back("wire field '" + name + "' does not decode back to the previewed value");
      } else if (!field->operator_constant) {
        found.clear();
        if (!redactor_.verifyQueryFullyRedacted(value, allowed, found)) {
          for (const std::string& s : found) residue.push_back("field '" + name + "': " + s);
        }
      }
      if (amp == std::string::npos) break;
      at = amp + 1;
    }
    if (seen != wire.size()) {
      residue.push_back("the encoded body does not carry exactly the declared fields");
    }
  }
  if (!residue.empty()) {
    // An unsendable preview carries NO bytes: there must be nothing for a caller
    // to pick up and hand to search().
    p.fields.clear();
    p.status = RequestBuildStatus::RedactionResidueDetected;
    p.status_detail = residue.front();
    for (std::size_t i = 1; i < residue.size(); ++i) p.status_detail += "; " + residue[i];
    return p;
  }

  p.encoded_body = body;
  p.body_digest = digestBytes(body);
  p.status = RequestBuildStatus::Ok;
  return p;
}

HttpRequest SearxngClient::buildHttpRequest(const QueryPreview& preview) const {
  HttpRequest req;
  req.host = endpoint_.host;
  req.port = endpoint_.port;
  req.method = endpoint_.use_post ? "POST" : "GET";
  req.path = endpoint_.use_post ? endpoint_.path : (endpoint_.path + "?" + preview.encoded_body);
  req.headers["Accept"] = "application/json";
  req.headers["User-Agent"] = "forge-retrieval/1.0";
  if (endpoint_.use_post) {
    req.headers["Content-Type"] = "application/x-www-form-urlencoded";
    req.body = preview.encoded_body;
  }
  return req;
}

RetrievalResult SearxngClient::search(const QueryPreview& preview,
                                      const SendApproval& approval) const {
  RetrievalResult result;
  const auto t0 = std::chrono::steady_clock::now();
  auto stamp = [&]() {
    result.elapsed_ms = static_cast<std::uint32_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count());
  };

  if (preview.status == RequestBuildStatus::PrivacyClassForbidsNetwork) {
    result.status = RetrievalStatus::POLICY_LOCAL_ONLY;
    result.detail = preview.status_detail;
    stamp();
    return result;
  }
  if (preview.status == RequestBuildStatus::RedactionResidueDetected) {
    result.status = RetrievalStatus::REDACTION_REFUSED;
    result.detail = preview.status_detail;
    stamp();
    return result;
  }
  if (!preview.sendable()) {
    result.status = RetrievalStatus::REQUEST_REJECTED;
    result.detail = preview.status_detail.empty() ? "preview is not sendable" : preview.status_detail;
    stamp();
    return result;
  }

  // ── GATE 2: the approval must bind to THESE bytes ─────────────────────────
  // The digest is RE-DERIVED from encoded_body here. Comparing the token against
  // preview.body_digest would compare it against a mutable field of the same
  // struct: mutate encoded_body after approval, leave body_digest alone, and the
  // check still passes while different bytes go to the socket. A capability
  // token has to be checked against the payload, not against a claim about it.
  const std::uint64_t actual_digest = digestBytes(preview.encoded_body);
  if (!approval.granted() || approval.digest() != actual_digest) {
    result.status = RetrievalStatus::REQUEST_REJECTED;
    result.detail = "no operator approval bound to the actual request bytes";
    stamp();
    return result;
  }
  if (preview.body_digest != actual_digest) {
    // The preview's own digest no longer describes its own bytes: the struct was
    // edited after it was built. Nothing here is trustworthy enough to send.
    result.status = RetrievalStatus::REQUEST_REJECTED;
    result.detail = "preview digest does not match its own encoded body";
    stamp();
    return result;
  }

  const HttpRequest req = buildHttpRequest(preview);

  // ── GATE 3: envelope-safe residue scan on the FINAL serialized request ────
  // This is the last thing before the socket. It re-derives its verdict from the
  // lexicon and from parsed numeric values, not from the classifier that built
  // the query, so a redactor bug cannot get a registered secret onto the wire.
  const std::string final_bytes = req.serialize();
  std::vector<std::string> residue;
  if (!redactor_.verifyNoResidue(final_bytes, residue)) {
    result.status = RetrievalStatus::REDACTION_REFUSED;
    result.detail = residue.front();
    for (std::size_t i = 1; i < residue.size(); ++i) result.detail += "; " + residue[i];
    stamp();
    return result;
  }

  if (!transport_) {
    // No transport is a fail-closed condition, not a reason to make one.
    result.status = RetrievalStatus::RETRIEVAL_UNAVAILABLE;
    result.detail = "no transport configured";
    stamp();
    return result;
  }

  result.transmit_attempts = 1;
  const HttpResponse resp = transport_->send(req, 8000);

  // ── fail closed. There is no second attempt and no alternate path below. ──
  if (resp.status != TransportStatus::Ok) {
    result.status = RetrievalStatus::RETRIEVAL_UNAVAILABLE;
    result.detail = std::string("transport ") + transportStatusName(resp.status) +
                    (resp.detail.empty() ? "" : ": " + resp.detail);
    stamp();
    return result;
  }
  if (resp.status_code != 200) {
    result.status = RetrievalStatus::RETRIEVAL_UNAVAILABLE;
    result.detail = "sidecar returned HTTP " + std::to_string(resp.status_code);
    stamp();
    return result;
  }

  std::string detail;
  const RetrievalStatus parsed =
      parseSearxngResults(resp.body, preview.handling, utcTimestampNow(), result.evidence, detail);
  if (parsed != RetrievalStatus::Ok) {
    result.status = parsed;
    result.detail = detail;
    result.evidence.clear();
    stamp();
    return result;
  }

  deduplicateEvidence(result.evidence);
  if (preview.handling.require_contradiction_check) {
    // 12.2: contradictions stay VISIBLE until resolved, so they are computed
    // and attached whether or not anyone downstream asks for them.
    result.contradictions = findContradictions(result.evidence);
  }
  result.distinct_publishers = distinctPublishers(result.evidence);

  // 12.1 source-diversity requirement. Evidence is RETAINED so the operator can
  // see what was found, but the status says it does not meet the bar it was
  // asked for — silently returning a single-publisher answer would be the
  // failure mode this clause exists to prevent.
  if (!result.evidence.empty() &&
      result.distinct_publishers < preview.handling.min_distinct_publishers) {
    result.status = RetrievalStatus::INSUFFICIENT_DIVERSITY;
    result.detail = detail + "; " + std::to_string(result.distinct_publishers) +
                    " distinct publishers, " +
                    std::to_string(preview.handling.min_distinct_publishers) + " required";
    stamp();
    return result;
  }

  result.status = RetrievalStatus::Ok;
  result.detail = detail;
  stamp();
  return result;
}

RetrievalStatus SearxngClient::parseSearxngResults(const std::string& json_body,
                                                   const ResultHandling& handling,
                                                   const std::string& retrieval_time_utc,
                                                   std::vector<EvidenceRecord>& out,
                                                   std::string& detail) {
  out.clear();
  detail.clear();

  // 12.3: the body is DATA. It is parsed by a bounded parser and every field is
  // lifted out by explicit key. Nothing in it can name a tool or a workflow node.
  json::Value root;
  std::string err;
  if (!json::parse(json_body, root, err)) {
    detail = "sidecar response is not valid JSON: " + err;
    return RetrievalStatus::RETRIEVAL_UNAVAILABLE;
  }
  if (!root.isObject()) {
    detail = "sidecar response is not a JSON object";
    return RetrievalStatus::RETRIEVAL_UNAVAILABLE;
  }
  const json::Value& results = root.at("results");
  if (!results.isArray()) {
    detail = "sidecar response has no results array";
    return RetrievalStatus::RETRIEVAL_UNAVAILABLE;
  }

  const std::size_t budget = handling.max_results == 0 ? 50 : handling.max_results;
  for (const json::Value& item : results.items()) {
    if (out.size() >= budget) break;
    if (!item.isObject()) continue;
    const std::string url = item.stringField("url");
    if (url.empty()) continue;
    // Only http(s) results are admissible; a javascript: or data: URL is not a
    // source, it is an execution attempt.
    const std::string lower_url = toLower(url);
    if (lower_url.rfind("http://", 0) != 0 && lower_url.rfind("https://", 0) != 0) continue;

    EvidenceRecord rec;
    rec.url = url;
    rec.title = UntrustedText(item.stringField("title"));
    rec.publisher = publisherFromUrl(url);
    rec.retrieval_time_utc = retrieval_time_utc;
    rec.publication_time_utc = item.stringField("publishedDate");
    bool truncated = false;
    rec.quoted_span = clampQuotedSpan(item.stringField("content"), truncated);
    rec.quote_truncated = truncated;
    rec.normalized_claim = rec.quoted_span;
    rec.source_type = classifySource(url, item.stringField("engine"));
    rec.applicable_terms_note =
        "retrieved via same-Mac SearXNG; quoted span capped at " +
        std::to_string(kMaxQuotedSpanChars) + " chars; standards remain protected publications";
    rec.content_hash = contentHashHex(url + "\n" + rec.quoted_span.rawForStorage());
    rec.esg_assertion_id = handling.esg_assertion_id;
    rec.relation = AssertionRelation::Unrelated;  // set by the ESG reconciler, not by the page
    rec.injection_attempt_flagged = rec.quoted_span.looksLikeInjectionAttempt() ||
                                    rec.title.looksLikeInjectionAttempt();
    if (!handling.expected_units.empty()) rec.units = handling.expected_units.front();
    out.push_back(std::move(rec));
  }

  if (out.empty()) {
    detail = "sidecar returned no admissible results";
    return RetrievalStatus::Ok;  // an empty result set is a valid answer, not a failure
  }
  detail = "parsed " + std::to_string(out.size()) + " results";
  return RetrievalStatus::Ok;
}

}  // namespace forge::retrieval
