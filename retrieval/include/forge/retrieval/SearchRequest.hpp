// ─────────────────────────────────────────────────────────────────────────────
// SearchRequest.hpp — the typed search-request contract of SACROSANCT 12.1.
//
// The research node must state, in types rather than prose: the engineering
// question and why retrieval is needed; jurisdiction, standard edition,
// freshness, language and domain filters; primary-source preference; the
// permitted network/privacy class; expected fact types and units; the maximum
// results/pages/time; and the source-diversity and contradiction requirements.
//
// The raw question NEVER leaves this struct. serializeSearxngParams() takes the
// REDACTED query produced by Redactor and nothing else, so there is no code path
// on which a raw question can reach the socket.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/retrieval/Redactor.hpp"

namespace forge::retrieval {

// SACROSANCT 20.2: outbound network is denied by default and the SearXNG sidecar
// is the ONLY production exception. The privacy class is carried on the request
// so a caller cannot silently widen it.
enum class NetworkPrivacyClass {
  LocalIndexOnly,     // never touches a socket; same-Mac project/reference index
  SameMacSearxng,     // the one permitted production egress
};

enum class FreshnessWindow { Any, PastDay, PastWeek, PastMonth, PastYear };

enum class FactType {
  Definition,
  NumericLimit,       // an allowable, a threshold, a code minimum
  MaterialProperty,
  DimensionalStandard,
  TestMethod,
  RegulatoryRequirement,
  ProcessParameter,
  SupplierAvailability,
};

const char* factTypeName(FactType t);
const char* freshnessName(FreshnessWindow f);

struct SearchRequest {
  // — why this request exists —
  std::string engineering_question;   // RAW. Never serialized. Redacted first.
  std::string retrieval_rationale;    // why local evidence is insufficient
  std::string esg_assertion_id;       // the assertion this evidence will serve

  // — scoping —
  std::string jurisdiction;           // e.g. "US-federal", "EU", "IN"
  std::string standard_edition;       // e.g. "ISO 2768:1989"
  FreshnessWindow freshness = FreshnessWindow::Any;
  std::string language = "en";        // BCP-47-ish tag passed to SearXNG
  std::vector<std::string> include_domains;
  std::vector<std::string> exclude_domains;
  bool prefer_primary_sources = true;

  // — policy —
  NetworkPrivacyClass privacy_class = NetworkPrivacyClass::SameMacSearxng;

  // — what an acceptable answer looks like —
  std::vector<FactType> expected_fact_types;
  std::vector<std::string> expected_units;   // e.g. {"MPa", "mm"}

  // — budget —
  std::size_t max_results = 20;
  std::size_t max_pages = 2;
  std::uint32_t max_time_ms = 8000;

  // — 12.2 diversity / contradiction duty —
  std::size_t min_distinct_publishers = 2;
  bool require_contradiction_check = true;

  // Structural validation. Returns false with `why` filled when the request
  // could not be honoured as written (empty question, zero budget, a diversity
  // requirement larger than the result budget, ...).
  bool validate(std::string& why) const;
};

// A privacy-class violation, a validation failure, or a residue detection all
// have to be distinguishable from an ordinary empty result set.
enum class RequestBuildStatus {
  Ok,
  InvalidRequest,
  PrivacyClassForbidsNetwork,
  RedactionResidueDetected,
};

const char* requestBuildStatusName(RequestBuildStatus s);

// The parts of a SearchRequest that govern what happens to the RESPONSE. They
// are carried on the preview so the send path never needs the raw question
// again: after preview() there is no code path from the raw text to the socket.
struct ResultHandling {
  std::size_t max_results = 20;
  std::size_t min_distinct_publishers = 2;
  bool require_contradiction_check = true;
  std::string esg_assertion_id;
  std::vector<std::string> expected_units;
};

// Everything the operator must see BEFORE a byte is transmitted (20.2: "the UI
// previews the query, destination class, and fields before transmission").
struct QueryPreview {
  RequestBuildStatus status = RequestBuildStatus::Ok;
  std::string status_detail;

  std::string destination_class;   // human label, e.g. "same-Mac SearXNG sidecar"
  std::string destination_origin;  // e.g. "http://127.0.0.1:8888"
  std::string http_method;         // "POST"
  std::string path;                // "/search"

  std::string redacted_query;      // exactly the q= value that will be sent
  std::string annotated_query;     // the same redaction with [DIM]/[CUSTOMER] markers
  std::vector<RedactionEvent> removals;

  // Every parameter name/value pair that will be transmitted, in wire order.
  std::vector<std::pair<std::string, std::string>> fields;

  // Response-side policy, copied from the request. Never transmitted.
  ResultHandling handling;

  // The exact encoded body bytes. Showing this and nothing else is what makes
  // the preview honest: there is no second, unpreviewed buffer.
  std::string encoded_body;

  // Stable digest of encoded_body; approval is bound to this value so an
  // approved preview cannot be swapped for a different request before send.
  std::uint64_t body_digest = 0;

  bool sendable() const { return status == RequestBuildStatus::Ok; }
  std::string renderForOperator() const;
};

// FNV-1a 64. Not a security hash — an integrity binding between the previewed
// bytes and the bytes written to the socket.
std::uint64_t digestBytes(const std::string& bytes);

// Percent-encode for application/x-www-form-urlencoded.
std::string formEncode(const std::string& raw);

}  // namespace forge::retrieval
