// ─────────────────────────────────────────────────────────────────────────────
// HttpTransport.hpp — the minimal HTTP/1.1 transport for the SearXNG sidecar.
//
// DEPENDENCY CHOICE (justified, per the constraint to avoid a new dependency):
// a raw POSIX socket client, not libcurl. Three reasons, in order of weight.
//
//  1. SACROSANCT 20.2 requires that outbound network be DENIED except one call
//     to a same-Mac sidecar. LoopbackHttpTransport can only ever open an
//     AF_INET connection to 127.0.0.1 / ::1: the address is not taken from a
//     URL string, it is constructed numerically in connectLoopback() and the
//     host field is REJECTED if it is not a loopback literal. There is no
//     proxy env var, no redirect follower, no DNS resolver, and no TLS stack to
//     reach anything else. With libcurl the same guarantee would need
//     CURLOPT_PROTOCOLS, redirect suppression, proxy suppression and a resolver
//     override — four settings that a later edit can quietly drop. Here the
//     restriction is the code, not a configuration of it.
//  2. It keeps the dependency plane clean. forge-kernel is on an OCCT-to-zero
//     programme; adding libcurl (plus its TLS and zlib closure) to reach a
//     loopback port would move that number the wrong way.
//  3. Loopback HTTP/1.1 without TLS, redirects, chunked proxies or auth is a
//     small, fully testable surface. What we do implement — the request writer,
//     the status/header parser, chunked and content-length bodies, a byte cap
//     and a total-deadline timeout — is exercised by fixtures in the test binary.
//
// Cost, stated honestly: no TLS. That is acceptable and in fact required here,
// because the only permitted destination is a sidecar on the same machine's
// loopback interface, where TLS adds a certificate-management surface without
// adding a trust boundary. A non-loopback host is refused outright rather than
// being fetched insecurely.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <cstdint>
#include <map>
#include <string>

namespace forge::retrieval {

enum class TransportStatus {
  Ok,
  ConnectFailed,       // sidecar is not listening
  Timeout,
  WriteFailed,
  ReadFailed,
  MalformedResponse,
  ResponseTooLarge,
  RefusedNonLoopback,  // policy refusal: the destination was not 127.0.0.1/::1
};

const char* transportStatusName(TransportStatus s);

struct HttpRequest {
  std::string method = "POST";
  std::string path = "/search";
  std::string host = "127.0.0.1";
  std::uint16_t port = 8888;
  std::map<std::string, std::string> headers;
  std::string body;

  // The exact bytes that go on the socket. Deterministic header order so the
  // preview digest is reproducible.
  std::string serialize() const;
};

struct HttpResponse {
  TransportStatus status = TransportStatus::Ok;
  int status_code = 0;
  std::map<std::string, std::string> headers;
  std::string body;
  std::string detail;
};

// Injectable so tests never touch a socket (and so the fail-closed path can be
// exercised deterministically). Production uses LoopbackHttpTransport ONLY.
class HttpTransport {
public:
  virtual ~HttpTransport() = default;
  virtual HttpResponse send(const HttpRequest& request, std::uint32_t timeout_ms) = 0;
};

// True for "127.0.0.1", "::1", "localhost" is DELIBERATELY NOT accepted: a name
// requires a resolver, and a resolver is a way out of the machine.
bool isLoopbackLiteral(const std::string& host);

// Parses a raw HTTP/1.1 response. Handles Content-Length and chunked bodies,
// enforces `max_body_bytes`, and never throws. Exposed for fixture tests.
bool parseHttpResponse(const std::string& raw, std::size_t max_body_bytes, HttpResponse& out);

class LoopbackHttpTransport final : public HttpTransport {
public:
  explicit LoopbackHttpTransport(std::size_t max_body_bytes = 4u * 1024u * 1024u)
      : max_body_bytes_(max_body_bytes) {}

  HttpResponse send(const HttpRequest& request, std::uint32_t timeout_ms) override;

private:
  std::size_t max_body_bytes_;
};

}  // namespace forge::retrieval
