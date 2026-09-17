// ─────────────────────────────────────────────────────────────────────────────
// SearxngClient.hpp — the C++ SearXNG client (SACROSANCT 12, 20.2).
//
// Calls the documented SearXNG Search API: GET or POST to /search with
// format=json, against a self-hosted instance (default http://127.0.0.1:8888).
//
// THE SEND PATH IS GATED, NOT ADVISORY. search() cannot be called with a raw
// question. The only way to transmit is:
//      preview  = client.preview(request);      // redacts, serializes, digests
//      approval = SendApproval::grant(preview); // operator sees the exact bytes
//      result   = client.search(preview, approval);
// SendApproval has no public constructor and carries the preview's body digest,
// its SHA-256 request digest over the COMPLETE request (destination, method,
// path, headers, body and result handling) and the identity of the client that
// built it; search() re-derives all three from the request it is about to send
// and re-runs the redaction residue scan on the FINAL serialized request before
// the socket is written. Three independent gates, none of which a caller can
// skip by writing different call-site code.
//
// FAIL CLOSED (12.4, 20.2): every failure — sidecar down, timeout, non-200,
// unparseable JSON, residue detected — yields RETRIEVAL_UNAVAILABLE (or a
// redaction refusal). There is deliberately NO retry against another endpoint,
// NO second HTTP client, NO hosted embedding, NO remote index, and NO compute
// fallback anywhere in this file. The class holds exactly one transport pointer
// and never constructs another.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "forge/retrieval/EvidenceRecord.hpp"
#include "forge/retrieval/HttpTransport.hpp"
#include "forge/retrieval/Redactor.hpp"
#include "forge/retrieval/SearchRequest.hpp"

namespace forge::retrieval {

enum class RetrievalStatus {
  Ok,
  RETRIEVAL_UNAVAILABLE,      // 12.4 / 20.2 fail-closed result
  REDACTION_REFUSED,          // residue found; nothing was transmitted
  REQUEST_REJECTED,           // request did not validate, or approval mismatched
  POLICY_LOCAL_ONLY,          // privacy class forbids the network
  INSUFFICIENT_DIVERSITY,     // 12.1 diversity requirement unmet by the results
};

const char* retrievalStatusName(RetrievalStatus s);

struct SearxngEndpoint {
  std::string host = "127.0.0.1";
  std::uint16_t port = 8888;
  std::string path = "/search";
  bool use_post = true;   // POST keeps the query out of the sidecar's access log
  std::string origin() const;
};

// A capability token proving a specific previewed REQUEST was shown and approved.
// No public constructor: it can only come from grant(), which binds
//   * the FNV digest of the previewed body bytes (as it always did),
//   * the SHA-256 request digest over the preview's approval manifest — scheme,
//     host, port, method, path, query, every header, body, the serialized bytes
//     and every ResultHandling field — which is exactly what the render shows,
//   * the identity of the SearxngClient object that built the preview.
// search() re-derives the manifest from the request it is about to send, on its
// own endpoint, and refuses on any mismatch in any of the three.
class SendApproval {
public:
  static SendApproval grant(const QueryPreview& preview);
  std::uint64_t digest() const { return digest_; }
  const std::string& request_digest() const { return request_digest_; }
  std::uint64_t client_instance() const { return client_instance_; }
  bool granted() const { return granted_; }

private:
  SendApproval() = default;
  std::uint64_t digest_ = 0;
  std::string request_digest_;
  std::uint64_t client_instance_ = 0;
  bool granted_ = false;
};

struct RetrievalResult {
  RetrievalStatus status = RetrievalStatus::RETRIEVAL_UNAVAILABLE;
  std::string detail;                     // never contains a redacted secret
  std::vector<EvidenceRecord> evidence;
  std::vector<Contradiction> contradictions;
  std::size_t distinct_publishers = 0;
  std::uint32_t elapsed_ms = 0;
  // Number of times a socket write was attempted. The fail-closed test asserts
  // this is at most 1: no silent retry, no alternate destination.
  int transmit_attempts = 0;

  bool ok() const { return status == RetrievalStatus::Ok; }
};

class SearxngClient {
public:
  // `transport` must be the loopback transport in production. It is injectable
  // solely so tests can run with the network denied.
  SearxngClient(std::shared_ptr<HttpTransport> transport, Redactor redactor,
                SearxngEndpoint endpoint = {});

  const SearxngEndpoint& endpoint() const { return endpoint_; }
  const Redactor& redactor() const { return redactor_; }

  // Redact, serialize and digest. Touches no socket. Safe to call offline.
  QueryPreview preview(const SearchRequest& request) const;

  // Transmit an approved preview. See the header comment for the three gates.
  RetrievalResult search(const QueryPreview& preview, const SendApproval& approval) const;

  // 12.3 parse-and-validate boundary, exposed for fixture tests: turns a SearXNG
  // JSON body into evidence records. Never executes anything it reads.
  static RetrievalStatus parseSearxngResults(const std::string& json_body,
                                             const ResultHandling& handling,
                                             const std::string& retrieval_time_utc,
                                             std::vector<EvidenceRecord>& out,
                                             std::string& detail);

  // Classifies a result's source type from its URL host and SearXNG engine.
  // Host-derived, never taken from page-supplied text.
  static SourceType classifySource(const std::string& url, const std::string& engine);
  static std::string publisherFromUrl(const std::string& url);

  // The publisher IDENTITY that the "different publisher" corroboration rule in
  // BoundCitation::bind compares, or "" when the URL names no identifiable
  // registrant. Built on the SAME authority parse and host canonicaliser as
  // classifySource() — last '@', port stripped, trailing dot stripped, lower-
  // cased, IDN refused — then reduced to the registrant: the last two labels, or
  // three under a listed multi-label public suffix, so sibling subdomains of one
  // domain are one publisher. An IP literal, a single-label host and any host with
  // no canonical form return "", and bind() refuses to count them.
  static std::string corroborationPublisher(const std::string& url);

  // This object's identity for SendApproval binding. Unique per object in the
  // process; a copy is a new object and gets a new identity.
  std::uint64_t instanceId() const { return instance_.value(); }

private:
  class InstanceId {
  public:
    InstanceId();
    InstanceId(const InstanceId&);             // a copy is a NEW client
    InstanceId& operator=(const InstanceId&);  // and so is an assigned-over one
    std::uint64_t value() const { return value_; }

  private:
    std::uint64_t value_;
  };

  std::shared_ptr<HttpTransport> transport_;
  Redactor redactor_;
  SearxngEndpoint endpoint_;
  InstanceId instance_;

  HttpRequest buildHttpRequest(const QueryPreview& preview) const;
  // The approval manifest of `request` as the transport would receive it, judged
  // under `handling`. The ONE function both preview() and search() call.
  static RequestManifest describeRequest(const HttpRequest& request, const ResultHandling& handling);
};

// Local ISO-8601 UTC stamp, e.g. "2026-08-28T14:03:11Z".
std::string utcTimestampNow();

}  // namespace forge::retrieval
