// ─────────────────────────────────────────────────────────────────────────────
// forge_retrieve.cpp — the retrieval EXECUTOR: the one process allowed to hand a
// SearXNG query to a socket, and the only new send path this commit creates.
//
// WHY A SEPARATE BINARY AND NOT A PYTHON REIMPLEMENTATION.
// Archie is Python (mlx_vlm). The gated client is C++. The binding constraint is
// that a second send path must not exist, so the client is not reimplemented: it
// is WRAPPED. This file contains no socket code, no HTTP, no URL parser and no
// retry — it builds a SearchRequest out of JSON and then calls, verbatim:
//
//     preview  = client.preview(request);
//     approval = SendApproval::grant(preview);   // only after an EXTERNAL token matched
//     result   = client.search(preview, approval);
//
// Everything that makes that path safe (the three gates, the private
// SendApproval constructor, the fail-closed statuses, the single transport
// pointer) lives in retrieval/src and is UNTOUCHED by this commit.
//
// APPROVAL CANNOT BE SELF-MINTED HERE, AND THAT IS THE POINT.
// `preview` and `search` are SEPARATE INVOCATIONS. `preview` touches no socket,
// prints the operator render on stderr and the previewed bytes on stdout.
// `search` REFUSES unless it is handed an approval record from outside carrying
//   (a) the exact encoded body that was approved, and
//   (b) the digest of those bytes.
// It re-derives the preview from the request and rejects unless the re-derived
// bytes are byte-identical to the approved bytes AND the supplied digest matches
// the re-derived digest. So a request cannot be edited after approval, and a
// caller cannot approve a request it never previewed.
//
// STATED HONESTLY, BECAUSE OVER-CLAIMING IS THE FAILURE MODE THIS REPO KNOWS:
// this executor enforces that the bytes sent are the bytes approved. It cannot
// by itself prove a HUMAN did the approving — a process boundary is not a
// person. What it guarantees is that approving is a SEPARATE invocation whose
// input is the operator render, so the human gate has somewhere to stand.
// Making that gate mandatory is the UI's job, one layer up.
//
// EXIT STATUS IS THE PROCESS'S, never a pipeline's, and never 0 on a failure:
//   0 Ok   2 usage/parse   3 RETRIEVAL_UNAVAILABLE   4 REDACTION_REFUSED
//   5 REQUEST_REJECTED     6 POLICY_LOCAL_ONLY       7 INSUFFICIENT_DIVERSITY
// A caller that reads nothing but the exit code still cannot mistake a
// fail-closed result for a success.
// ─────────────────────────────────────────────────────────────────────────────
#include <cstdint>
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

// Exit codes. Named so a shell gate reads as the C++ does.
constexpr int kExitOk = 0;
constexpr int kExitUsage = 2;
constexpr int kExitUnavailable = 3;
constexpr int kExitRedactionRefused = 4;
constexpr int kExitRequestRejected = 5;
constexpr int kExitPolicyLocalOnly = 6;
constexpr int kExitInsufficientDiversity = 7;

int exitCodeFor(RetrievalStatus s) {
  switch (s) {
    case RetrievalStatus::Ok: return kExitOk;
    case RetrievalStatus::RETRIEVAL_UNAVAILABLE: return kExitUnavailable;
    case RetrievalStatus::REDACTION_REFUSED: return kExitRedactionRefused;
    case RetrievalStatus::REQUEST_REJECTED: return kExitRequestRejected;
    case RetrievalStatus::POLICY_LOCAL_ONLY: return kExitPolicyLocalOnly;
    case RetrievalStatus::INSUFFICIENT_DIVERSITY: return kExitInsufficientDiversity;
  }
  return kExitUsage;
}

// ── a tiny JSON writer ──────────────────────────────────────────────────────
// json::Value::dump() exists, but building a Value tree merely to print a report
// is more machinery than a report needs. json::escape() does the part that is
// actually dangerous: a retrieved title full of quotes and control bytes.
struct Out {
  std::string s;
  void raw(const char* t) { s += t; }
  void key(const char* k) { s += json::escape(k); s += ":"; }
  void str(const std::string& v) { s += json::escape(v); }
  void num(double v) {
    std::ostringstream o;
    o << v;
    s += o.str();
  }
  void boolean(bool v) { s += v ? "true" : "false"; }
  void comma() { s += ","; }
};

std::string hex64(std::uint64_t v) {
  static const char* kHex = "0123456789abcdef";
  std::string out = "0x";
  for (int shift = 60; shift >= 0; shift -= 4) {
    out.push_back(kHex[(v >> shift) & 0xF]);
  }
  return out;
}

// Parses "0x…" or bare hex. Returns false on anything else — a malformed token
// must be a REJECTION, never a zero that then happens to compare equal to an
// empty field.
bool parseHex64(const std::string& text, std::uint64_t& out) {
  std::string t = text;
  if (t.rfind("0x", 0) == 0 || t.rfind("0X", 0) == 0) t = t.substr(2);
  if (t.empty() || t.size() > 16) return false;
  std::uint64_t v = 0;
  for (const char c : t) {
    v <<= 4;
    if (c >= '0' && c <= '9') {
      v |= static_cast<std::uint64_t>(c - '0');
    } else if (c >= 'a' && c <= 'f') {
      v |= static_cast<std::uint64_t>(c - 'a' + 10);
    } else if (c >= 'A' && c <= 'F') {
      v |= static_cast<std::uint64_t>(c - 'A' + 10);
    } else {
      return false;
    }
  }
  out = v;
  return true;
}

std::string readAll(std::istream& in) {
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

// The request JSON arrives from stdin and is NOT trusted to be well shaped: this
// is the boundary between an LLM's tool-call arguments and a typed struct. Every
// field is lifted by explicit key, never by iterating what the caller sent.
bool factTypeFromName(const std::string& name, FactType& out) {
  if (name == "definition" || name == "Definition") { out = FactType::Definition; return true; }
  if (name == "numeric_limit" || name == "NumericLimit") { out = FactType::NumericLimit; return true; }
  if (name == "material_property" || name == "MaterialProperty") { out = FactType::MaterialProperty; return true; }
  if (name == "dimensional_standard" || name == "DimensionalStandard") { out = FactType::DimensionalStandard; return true; }
  if (name == "test_method" || name == "TestMethod") { out = FactType::TestMethod; return true; }
  if (name == "regulatory_requirement" || name == "RegulatoryRequirement") { out = FactType::RegulatoryRequirement; return true; }
  if (name == "process_parameter" || name == "ProcessParameter") { out = FactType::ProcessParameter; return true; }
  if (name == "supplier_availability" || name == "SupplierAvailability") { out = FactType::SupplierAvailability; return true; }
  return false;
}

bool freshnessFromName(const std::string& name, FreshnessWindow& out) {
  if (name.empty() || name == "any" || name == "Any") { out = FreshnessWindow::Any; return true; }
  if (name == "past_day" || name == "day") { out = FreshnessWindow::PastDay; return true; }
  if (name == "past_week" || name == "week") { out = FreshnessWindow::PastWeek; return true; }
  if (name == "past_month" || name == "month") { out = FreshnessWindow::PastMonth; return true; }
  if (name == "past_year" || name == "year") { out = FreshnessWindow::PastYear; return true; }
  return false;
}

std::vector<std::string> stringArray(const json::Value& v) {
  std::vector<std::string> out;
  if (!v.isArray()) return out;
  for (const json::Value& item : v.items()) {
    if (item.isString() && !item.str().empty()) out.push_back(item.str());
  }
  return out;
}

std::size_t sizeField(const json::Value& obj, const char* key, std::size_t fallback) {
  const json::Value& v = obj.at(key);
  if (!v.isNumber()) return fallback;
  const double d = v.number(static_cast<double>(fallback));
  if (d < 0.0) return 0;
  return static_cast<std::size_t>(d);
}

// Builds the typed request. `why` is filled and false returned on ANY shape the
// caller declared incorrectly. An unknown fact type is a REJECTION, not a silent
// drop: a silently dropped fact type produces a request whose scope the operator
// never approved.
bool buildRequest(const json::Value& root, SearchRequest& req, std::string& why) {
  if (!root.isObject()) {
    why = "request is not a JSON object";
    return false;
  }

  req.engineering_question = root.stringField("engineering_question");
  req.retrieval_rationale = root.stringField("retrieval_rationale");
  req.esg_assertion_id = root.stringField("esg_assertion_id");
  req.jurisdiction = root.stringField("jurisdiction");
  req.standard_edition = root.stringField("standard_edition");
  req.language = root.stringField("language", "en");

  if (!freshnessFromName(root.stringField("freshness"), req.freshness)) {
    why = "unknown freshness '" + root.stringField("freshness") + "'";
    return false;
  }

  for (const std::string& name : stringArray(root.at("expected_fact_types"))) {
    FactType t{};
    if (!factTypeFromName(name, t)) {
      why = "unknown expected_fact_type '" + name + "'";
      return false;
    }
    req.expected_fact_types.push_back(t);
  }
  req.expected_units = stringArray(root.at("expected_units"));
  req.include_domains = stringArray(root.at("include_domains"));
  req.exclude_domains = stringArray(root.at("exclude_domains"));

  const std::string privacy = root.stringField("privacy_class", "same_mac_searxng");
  if (privacy == "local_index_only" || privacy == "LocalIndexOnly") {
    req.privacy_class = NetworkPrivacyClass::LocalIndexOnly;
  } else if (privacy == "same_mac_searxng" || privacy == "SameMacSearxng") {
    req.privacy_class = NetworkPrivacyClass::SameMacSearxng;
  } else {
    why = "unknown privacy_class '" + privacy + "'";
    return false;
  }

  if (root.has("prefer_primary_sources")) {
    req.prefer_primary_sources = root.at("prefer_primary_sources").boolean(true);
  }
  req.max_results = sizeField(root, "max_results", 20);
  req.max_pages = sizeField(root, "max_pages", 2);
  req.max_time_ms = static_cast<std::uint32_t>(sizeField(root, "max_time_ms", 8000));
  req.min_distinct_publishers = sizeField(root, "min_distinct_publishers", 2);
  if (root.has("require_contradiction_check")) {
    req.require_contradiction_check = root.at("require_contradiction_check").boolean(true);
  }
  return true;
}

// The lexicon is LOCAL POLICY carried alongside the request so the executor stays
// stateless: whatever the caller declares private is stripped. It is never
// serialized into any output — see the note on `matched` in writePreview.
PrivateLexicon buildLexicon(const json::Value& root) {
  PrivateLexicon lex;
  const json::Value& l = root.at("lexicon");
  if (!l.isObject()) return lex;
  lex.customer_names = stringArray(l.at("customer_names"));
  lex.project_names = stringArray(l.at("project_names"));
  lex.supplier_names = stringArray(l.at("supplier_names"));
  lex.part_numbers = stringArray(l.at("part_numbers"));
  lex.secret_terms = stringArray(l.at("secret_terms"));
  const json::Value& dims = l.at("secret_dimensions");
  if (dims.isArray()) {
    for (const json::Value& d : dims.items()) {
      if (d.isNumber()) lex.secret_dimensions.push_back(d.number());
    }
  }
  return lex;
}

SearxngEndpoint buildEndpoint(const json::Value& root) {
  SearxngEndpoint ep;
  const json::Value& e = root.at("endpoint");
  if (!e.isObject()) return ep;
  const std::string host = e.stringField("host");
  if (!host.empty()) ep.host = host;
  const json::Value& port = e.at("port");
  if (port.isNumber()) ep.port = static_cast<std::uint16_t>(port.number(8888));
  const std::string path = e.stringField("path");
  if (!path.empty()) ep.path = path;
  if (e.has("use_post")) ep.use_post = e.at("use_post").boolean(true);
  return ep;
}

// ── preview serialization ───────────────────────────────────────────────────
// THE ONE THING THIS FUNCTION MUST NOT DO is emit RedactionEvent::matched.
// Redactor.hpp: "`matched` holds the ORIGINAL text: it exists only in-process for
// the operator's preview and MUST NOT be serialized into any outgoing buffer."
// This process's stdout is consumed by Archie, is logged, and may be shown back
// to a model — which makes it exactly such a buffer. The kind, the marker and the
// offset let a human see WHAT was removed and WHERE; the secret itself does not
// have to travel with them.
void writePreview(Out& o, const QueryPreview& p, bool include_operator_render) {
  o.raw("{");
  o.key("status"); o.str(requestBuildStatusName(p.status)); o.comma();
  o.key("sendable"); o.boolean(p.sendable()); o.comma();
  o.key("status_detail"); o.str(p.status_detail); o.comma();
  o.key("destination_class"); o.str(p.destination_class); o.comma();
  o.key("destination_origin"); o.str(p.destination_origin); o.comma();
  o.key("http_method"); o.str(p.http_method); o.comma();
  o.key("path"); o.str(p.path); o.comma();
  o.key("redacted_query"); o.str(p.redacted_query); o.comma();
  o.key("annotated_query"); o.str(p.annotated_query); o.comma();

  o.key("removals"); o.raw("[");
  for (std::size_t i = 0; i < p.removals.size(); ++i) {
    if (i) o.comma();
    const RedactionEvent& e = p.removals[i];
    o.raw("{");
    o.key("kind"); o.str(redactionKindName(e.kind)); o.comma();
    o.key("marker"); o.str(e.marker); o.comma();
    o.key("offset"); o.num(static_cast<double>(e.offset)); o.comma();
    o.key("length"); o.num(static_cast<double>(e.length));
    // `matched` is DELIBERATELY ABSENT. See the comment above this function.
    o.raw("}");
  }
  o.raw("],");

  o.key("fields"); o.raw("[");
  for (std::size_t i = 0; i < p.fields.size(); ++i) {
    if (i) o.comma();
    o.raw("{");
    o.key("name"); o.str(p.fields[i].first); o.comma();
    o.key("value"); o.str(p.fields[i].second);
    o.raw("}");
  }
  o.raw("],");

  o.key("encoded_body"); o.str(p.encoded_body); o.comma();
  o.key("body_digest"); o.str(hex64(p.body_digest));
  if (include_operator_render) {
    o.comma();
    o.key("operator_render"); o.str(p.renderForOperator());
  }
  o.raw("}");
}

// ── result serialization ────────────────────────────────────────────────────
// Every retrieved string leaves through UntrustedText::display(), which
// neutralizes control characters, and NEVER through rawForStorage(). A title
// carrying a fake tool-call delimiter or an ANSI escape therefore cannot rewrite
// the log line, the terminal, or the framing of the message Archie builds.
void writeEvidence(Out& o, const EvidenceRecord& r) {
  o.raw("{");
  o.key("url"); o.str(r.url); o.comma();
  o.key("title"); o.str(r.title.display()); o.comma();
  o.key("publisher"); o.str(r.publisher); o.comma();
  o.key("source_type"); o.str(sourceTypeName(r.source_type)); o.comma();
  o.key("authority_rank"); o.num(authorityRank(r.source_type)); o.comma();
  o.key("may_be_sole_authority"); o.boolean(mayBeSoleAuthorityForCriticalValue(r.source_type)); o.comma();
  o.key("retrieval_time_utc"); o.str(r.retrieval_time_utc); o.comma();
  o.key("publication_time_utc"); o.str(r.publication_time_utc); o.comma();
  o.key("quoted_span"); o.str(r.quoted_span.display()); o.comma();
  o.key("quote_truncated"); o.boolean(r.quote_truncated); o.comma();
  o.key("units"); o.str(r.units); o.comma();
  o.key("content_hash"); o.str(r.content_hash); o.comma();
  o.key("esg_assertion_id"); o.str(r.esg_assertion_id); o.comma();
  o.key("relation"); o.str(assertionRelationName(r.relation)); o.comma();
  // 12.3: the flag is RECORDED, never obeyed either way. A reviewer must be able
  // to see that the source tried.
  o.key("injection_attempt_flagged"); o.boolean(r.injection_attempt_flagged);
  o.raw("}");
}

void writeResult(Out& o, const RetrievalResult& res) {
  o.raw("{");
  o.key("status"); o.str(retrievalStatusName(res.status)); o.comma();
  o.key("ok"); o.boolean(res.ok()); o.comma();
  o.key("detail"); o.str(res.detail); o.comma();
  o.key("elapsed_ms"); o.num(res.elapsed_ms); o.comma();
  o.key("transmit_attempts"); o.num(res.transmit_attempts); o.comma();
  o.key("distinct_publishers"); o.num(static_cast<double>(res.distinct_publishers)); o.comma();
  o.key("evidence"); o.raw("[");
  for (std::size_t i = 0; i < res.evidence.size(); ++i) {
    if (i) o.comma();
    writeEvidence(o, res.evidence[i]);
  }
  o.raw("],");
  o.key("contradictions"); o.raw("[");
  for (std::size_t i = 0; i < res.contradictions.size(); ++i) {
    if (i) o.comma();
    const Contradiction& c = res.contradictions[i];
    o.raw("{");
    o.key("index_a"); o.num(static_cast<double>(c.index_a)); o.comma();
    o.key("index_b"); o.num(static_cast<double>(c.index_b)); o.comma();
    o.key("note"); o.str(c.note);
    o.raw("}");
  }
  o.raw("]}");
}

// A refusal is emitted in the SAME shape as a result, so a caller never has to
// parse two schemas and never sees a bare non-zero exit with no explanation.
int emitRefusal(RetrievalStatus status, const std::string& detail) {
  RetrievalResult res;
  res.status = status;
  res.detail = detail;
  res.transmit_attempts = 0;
  Out o;
  writeResult(o, res);
  std::cout << o.s << "\n";
  return exitCodeFor(status);
}

int usage() {
  std::cerr <<
      "forge_retrieve — the gated SearXNG executor.\n"
      "\n"
      "  forge_retrieve preview  < request.json   > preview.json    (no socket is opened)\n"
      "  forge_retrieve search   < approved.json  > result.json     (the ONLY send path)\n"
      "\n"
      "approved.json is {\"request\": <the same request>, \"approval\":\n"
      "   {\"body_digest\": \"0x...\", \"encoded_body\": \"q=...\"}}\n"
      "The approval must come from OUTSIDE this process: search re-derives the preview\n"
      "and refuses unless the approved bytes are byte-identical to the re-derived bytes\n"
      "and the digest matches. There is no flag that makes search approve its own request.\n"
      "\n"
      "exit: 0 Ok  2 usage  3 RETRIEVAL_UNAVAILABLE  4 REDACTION_REFUSED\n"
      "      5 REQUEST_REJECTED  6 POLICY_LOCAL_ONLY  7 INSUFFICIENT_DIVERSITY\n";
  return kExitUsage;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) return usage();
  const std::string mode = argv[1];
  if (mode != "preview" && mode != "search") return usage();

  const std::string input = readAll(std::cin);
  if (input.empty()) {
    std::cerr << "forge_retrieve: empty stdin. A request that was never read is not a request.\n";
    return kExitUsage;
  }

  json::Value root;
  std::string err;
  if (!json::parse(input, root, err)) {
    std::cerr << "forge_retrieve: stdin is not valid JSON: " << err << "\n";
    return kExitUsage;
  }

  // `search` takes {request, approval}; `preview` takes the request itself.
  const json::Value& request_node = (mode == "search") ? root.at("request") : root;

  SearchRequest req;
  std::string why;
  if (!buildRequest(request_node, req, why)) {
    return emitRefusal(RetrievalStatus::REQUEST_REJECTED, "request did not build: " + why);
  }

  const Redactor redactor(buildLexicon(request_node), RedactionPolicy{});
  const SearxngEndpoint endpoint = buildEndpoint(request_node);

  // ONE transport, constructed once, never replaced. LoopbackHttpTransport
  // refuses any non-loopback destination by construction, so a request naming a
  // public host is a policy refusal decided before a socket exists.
  auto transport = std::make_shared<LoopbackHttpTransport>();
  const SearxngClient client(transport, redactor, endpoint);

  // ── redact, serialize, digest. No socket is opened by preview(). ───────────
  const QueryPreview preview = client.preview(req);

  if (mode == "preview") {
    Out o;
    writePreview(o, preview, /*include_operator_render=*/true);
    std::cout << o.s << "\n";
    // The render also goes to STDERR so an operator watching the terminal sees
    // the bytes even when stdout is being piped into a program.
    std::cerr << preview.renderForOperator();
    if (!preview.sendable()) {
      // An unsendable preview is neither a usage error nor a success: it is the
      // refusal it names, and the exit code says which.
      switch (preview.status) {
        case RequestBuildStatus::PrivacyClassForbidsNetwork: return kExitPolicyLocalOnly;
        case RequestBuildStatus::RedactionResidueDetected: return kExitRedactionRefused;
        default: return kExitRequestRejected;
      }
    }
    return kExitOk;
  }

  // ── search ────────────────────────────────────────────────────────────────
  if (!preview.sendable()) {
    switch (preview.status) {
      case RequestBuildStatus::PrivacyClassForbidsNetwork:
        return emitRefusal(RetrievalStatus::POLICY_LOCAL_ONLY, preview.status_detail);
      case RequestBuildStatus::RedactionResidueDetected:
        return emitRefusal(RetrievalStatus::REDACTION_REFUSED, preview.status_detail);
      default:
        return emitRefusal(RetrievalStatus::REQUEST_REJECTED, preview.status_detail);
    }
  }

  // THE EXTERNAL APPROVAL. Absent, malformed, or describing different bytes —
  // all three give the same answer: nothing is transmitted.
  const json::Value& approval_node = root.at("approval");
  if (!approval_node.isObject()) {
    return emitRefusal(RetrievalStatus::REQUEST_REJECTED,
                       "no approval record: search will not approve its own request");
  }
  const std::string approved_body = approval_node.stringField("encoded_body");
  const std::string approved_digest_text = approval_node.stringField("body_digest");
  if (approved_body.empty() || approved_digest_text.empty()) {
    return emitRefusal(RetrievalStatus::REQUEST_REJECTED,
                       "approval record must carry both encoded_body and body_digest");
  }
  std::uint64_t approved_digest = 0;
  if (!parseHex64(approved_digest_text, approved_digest)) {
    // A malformed token must never decay to 0 and then compare equal to
    // something. It is a rejection outright.
    return emitRefusal(RetrievalStatus::REQUEST_REJECTED,
                       "approval body_digest is not a hex value");
  }

  // The bytes the operator saw must be the bytes this request produces NOW. This
  // catches a request edited after approval — the cross-process form of the
  // time-of-check/time-of-use attack SearxngClient::search already defends
  // against in-process.
  if (approved_body != preview.encoded_body) {
    return emitRefusal(RetrievalStatus::REQUEST_REJECTED,
                       "the approved bytes are not the bytes this request now produces");
  }
  if (approved_digest != digestBytes(preview.encoded_body)) {
    return emitRefusal(RetrievalStatus::REQUEST_REJECTED,
                       "approval digest does not match the previewed bytes");
  }

  // Only now. grant() is reached on exactly one line in this binary, and only
  // after an externally supplied token described these exact bytes.
  const SendApproval approval = SendApproval::grant(preview);
  const RetrievalResult result = client.search(preview, approval);

  Out o;
  writeResult(o, result);
  std::cout << o.s << "\n";
  return exitCodeFor(result.status);
}
