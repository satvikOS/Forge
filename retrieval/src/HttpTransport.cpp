#include "forge/retrieval/HttpTransport.hpp"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <chrono>
#include <cstring>

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

namespace forge::retrieval {
namespace {

std::string toLower(std::string s) {
  for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

std::string trim(const std::string& s) {
  std::size_t b = 0, e = s.size();
  while (b < e && std::isspace(static_cast<unsigned char>(s[b]))) ++b;
  while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) --e;
  return s.substr(b, e - b);
}

// Milliseconds remaining against a fixed deadline. A hung sidecar must not be
// able to hold the engineering session open for ever.
int remainingMs(const std::chrono::steady_clock::time_point& deadline) {
  const auto now = std::chrono::steady_clock::now();
  if (now >= deadline) return 0;
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now).count();
  return static_cast<int>(std::min<long long>(ms, 60000));
}

class Socket {
public:
  Socket() = default;
  ~Socket() { close_(); }
  Socket(const Socket&) = delete;
  Socket& operator=(const Socket&) = delete;

  int fd = -1;
  void reset(int f) { close_(); fd = f; }

private:
  void close_() {
    if (fd >= 0) {
      ::close(fd);
      fd = -1;
    }
  }
};

bool setNonBlocking(int fd) {
  const int flags = ::fcntl(fd, F_GETFL, 0);
  if (flags < 0) return false;
  return ::fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0;
}

}  // namespace

const char* transportStatusName(TransportStatus s) {
  switch (s) {
    case TransportStatus::RefusedMalformedRequest: return "RefusedMalformedRequest";
    case TransportStatus::Ok: return "Ok";
    case TransportStatus::ConnectFailed: return "ConnectFailed";
    case TransportStatus::Timeout: return "Timeout";
    case TransportStatus::WriteFailed: return "WriteFailed";
    case TransportStatus::ReadFailed: return "ReadFailed";
    case TransportStatus::MalformedResponse: return "MalformedResponse";
    case TransportStatus::ResponseTooLarge: return "ResponseTooLarge";
    case TransportStatus::RefusedNonLoopback: return "RefusedNonLoopback";
  }
  return "Unknown";
}

bool isLoopbackLiteral(const std::string& host) {
  // Numeric literals only. "localhost" is REFUSED on purpose: resolving a name
  // means consulting /etc/hosts, DNS, or mDNS, and any of those is a way off the
  // machine that this client must not have (SACROSANCT 20.2).
  // IPv4 ONLY, deliberately, and the allow-list says so rather than the connect path
  // discovering it later. send() creates an AF_INET socket and parses the host with
  // inet_pton(AF_INET, ...) -- there is no AF_INET6 path anywhere in this file -- so
  // admitting "::1" here let an IPv6 loopback pass the POLICY gate and then fail at connect
  // with the misleading reason "host is not an IPv4 literal". Nothing is lost by narrowing:
  // the capability never existed. If an IPv6 sidecar is ever needed, add the AF_INET6
  // connect path and this check in the SAME change, so the two cannot disagree again.
  in_addr addr{};
  if (::inet_pton(AF_INET, host.c_str(), &addr) != 1) return false;
  const std::uint32_t v = ntohl(addr.s_addr);
  return (v >> 24) == 127u;  // the whole 127.0.0.0/8 loopback block
}

// A header the CALLER supplied must not be able to rewrite the request block. serialize()
// concatenates `name: value` verbatim, so a value containing CR or LF ends the header block
// early and everything after it is read by the sidecar as a SECOND request. The destination
// is loopback-only, which bounds who receives it, but it is still an injected request.
//
// serialize() also ALWAYS emits Host, Content-Length and Connection, so a caller supplying
// any of those produces a duplicate header rather than an override -- ambiguous framing that
// a server may resolve either way.
//
// Returns true when every header is safe; otherwise fills `why` with the offending name.
bool headersAreWellFormed(const std::map<std::string, std::string>& headers, std::string& why) {
  for (const auto& [k, v] : headers) {
    if (k.empty()) { why = "a header name is empty"; return false; }
    if (k.find(':') != std::string::npos) { why = "header name contains ':': " + k; return false; }
    if (k.find('\r') != std::string::npos || k.find('\n') != std::string::npos) {
      why = "header name contains CR or LF: " + k; return false;
    }
    if (v.find('\r') != std::string::npos || v.find('\n') != std::string::npos) {
      why = "header value contains CR or LF (request splitting): " + k; return false;
    }
    const std::string lower = toLower(k);
    if (lower == "host" || lower == "content-length" || lower == "connection") {
      why = "header is emitted by serialize() and would be duplicated: " + k; return false;
    }
  }
  return true;
}

std::string HttpRequest::serialize() const {
  std::string out;
  out.reserve(body.size() + 256);
  out += method + " " + path + " HTTP/1.1\r\n";
  out += "Host: " + host + ":" + std::to_string(port) + "\r\n";
  // Deterministic header order so the previewed digest is reproducible.
  for (const auto& [k, v] : headers) {
    out += k + ": " + v + "\r\n";
  }
  out += "Content-Length: " + std::to_string(body.size()) + "\r\n";
  out += "Connection: close\r\n";
  out += "\r\n";
  out += body;
  return out;
}

bool parseHttpResponse(const std::string& raw, std::size_t max_body_bytes, HttpResponse& out) {
  out = HttpResponse{};
  const std::size_t header_end = raw.find("\r\n\r\n");
  if (header_end == std::string::npos) {
    out.status = TransportStatus::MalformedResponse;
    out.detail = "no header terminator";
    return false;
  }
  const std::string head = raw.substr(0, header_end);
  std::size_t line_end = head.find("\r\n");
  const std::string status_line = head.substr(0, line_end == std::string::npos ? head.size() : line_end);
  if (status_line.rfind("HTTP/1.", 0) != 0) {
    out.status = TransportStatus::MalformedResponse;
    out.detail = "not an HTTP/1.x status line";
    return false;
  }
  const std::size_t sp = status_line.find(' ');
  if (sp == std::string::npos || sp + 4 > status_line.size()) {
    out.status = TransportStatus::MalformedResponse;
    out.detail = "malformed status line";
    return false;
  }
  int code = 0;
  const char* cfirst = status_line.data() + sp + 1;
  if (std::from_chars(cfirst, cfirst + 3, code).ec != std::errc()) {
    out.status = TransportStatus::MalformedResponse;
    out.detail = "unparseable status code";
    return false;
  }
  out.status_code = code;

  std::size_t pos = (line_end == std::string::npos) ? head.size() : line_end + 2;
  while (pos < head.size()) {
    std::size_t eol = head.find("\r\n", pos);
    if (eol == std::string::npos) eol = head.size();
    const std::string line = head.substr(pos, eol - pos);
    const std::size_t colon = line.find(':');
    if (colon != std::string::npos) {
      out.headers[toLower(trim(line.substr(0, colon)))] = trim(line.substr(colon + 1));
    }
    pos = eol + 2;
  }

  const std::string body_raw = raw.substr(header_end + 4);
  const auto te = out.headers.find("transfer-encoding");
  if (te != out.headers.end() && toLower(te->second).find("chunked") != std::string::npos) {
    std::string decoded;
    std::size_t i = 0;
    bool saw_terminator = false;
    while (i < body_raw.size()) {
      const std::size_t eol = body_raw.find("\r\n", i);
      if (eol == std::string::npos) {
        out.status = TransportStatus::MalformedResponse;
        out.detail = "truncated chunk header";
        return false;
      }
      std::size_t size = 0;
      const std::string size_line = body_raw.substr(i, eol - i);
      const std::size_t semi = size_line.find(';');
      const std::string hex = trim(semi == std::string::npos ? size_line : size_line.substr(0, semi));
      if (hex.empty()) {
        out.status = TransportStatus::MalformedResponse;
        out.detail = "empty chunk size";
        return false;
      }
      const char* hf = hex.data();
      if (std::from_chars(hf, hf + hex.size(), size, 16).ec != std::errc()) {
        out.status = TransportStatus::MalformedResponse;
        out.detail = "unparseable chunk size";
        return false;
      }
      i = eol + 2;
      if (size == 0) { saw_terminator = true; break; }
      // COMPARE AGAINST WHAT REMAINS; never compute a sum. `size` is a std::size_t parsed
      // from hex, so a chunk header of "fffffffffffffff0" parses fine and then makes
      // `i + size`, `decoded.size() + size` and `i += size + 2` all WRAP -- every guard
      // passes and the decoder walks off into the buffer. Subtraction cannot wrap here:
      // the loop condition gives i <= body_raw.size(), and decoded never exceeds the cap.
      if (size > body_raw.size() - i) {
        out.status = TransportStatus::MalformedResponse;
        out.detail = "truncated chunk body";
        return false;
      }
      if (size > max_body_bytes - decoded.size()) {
        out.status = TransportStatus::ResponseTooLarge;
        out.detail = "chunked body exceeds cap";
        return false;
      }
      decoded.append(body_raw, i, size);
      i += size;
      // The chunk's trailing CRLF must actually be there. Skipping two bytes on faith is
      // how a truncated frame becomes a silently short body.
      if (body_raw.compare(i, 2, "\r\n") != 0) {
        out.status = TransportStatus::MalformedResponse;
        out.detail = "chunk not terminated by CRLF";
        return false;
      }
      i += 2;
    }
    // A body that simply RAN OUT is not a complete body. Without this the loop exits on
    // `i >= body_raw.size()` and the caller sets Ok, so a response truncated exactly at a
    // chunk boundary is reported as a whole one -- the quietest way to lose data.
    if (!saw_terminator) {
      out.status = TransportStatus::MalformedResponse;
      out.detail = "chunked body ended without a final 0 chunk";
      return false;
    }
    out.body = std::move(decoded);
  } else {
    const auto cl = out.headers.find("content-length");
    if (cl != out.headers.end()) {
      std::size_t want = 0;
      const char* f = cl->second.data();
      if (std::from_chars(f, f + cl->second.size(), want).ec != std::errc()) {
        out.status = TransportStatus::MalformedResponse;
        out.detail = "unparseable content-length";
        return false;
      }
      if (want > max_body_bytes) {
        out.status = TransportStatus::ResponseTooLarge;
        out.detail = "content-length exceeds cap";
        return false;
      }
      if (body_raw.size() < want) {
        out.status = TransportStatus::MalformedResponse;
        out.detail = "body shorter than content-length";
        return false;
      }
      out.body = body_raw.substr(0, want);
    } else {
      if (body_raw.size() > max_body_bytes) {
        out.status = TransportStatus::ResponseTooLarge;
        out.detail = "body exceeds cap";
        return false;
      }
      out.body = body_raw;
    }
  }
  out.status = TransportStatus::Ok;
  return true;
}

HttpResponse LoopbackHttpTransport::send(const HttpRequest& request, std::uint32_t timeout_ms) {
  HttpResponse resp;

  // ── policy gate: the destination is constructed numerically, never resolved ─
  if (!isLoopbackLiteral(request.host)) {
    resp.status = TransportStatus::RefusedNonLoopback;
    resp.detail = "destination is not a loopback literal; SACROSANCT 20.2 permits only the same-Mac sidecar";
    return resp;
  }

  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);

  Socket sock;
  sock.reset(::socket(AF_INET, SOCK_STREAM, 0));
  if (sock.fd < 0) {
    resp.status = TransportStatus::ConnectFailed;
    resp.detail = std::string("socket(): ") + std::strerror(errno);
    return resp;
  }
  const int one = 1;
  ::setsockopt(sock.fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
  if (!setNonBlocking(sock.fd)) {
    resp.status = TransportStatus::ConnectFailed;
    resp.detail = "fcntl(O_NONBLOCK) failed";
    return resp;
  }

  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(request.port);
  // The address is parsed from a literal that isLoopbackLiteral() already
  // proved to be inside 127.0.0.0/8. No name is ever resolved.
  if (::inet_pton(AF_INET, request.host.c_str(), &addr.sin_addr) != 1) {
    resp.status = TransportStatus::RefusedNonLoopback;
    resp.detail = "host is not an IPv4 literal";
    return resp;
  }

  if (::connect(sock.fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
    if (errno != EINPROGRESS) {
      resp.status = TransportStatus::ConnectFailed;
      resp.detail = std::string("connect(): ") + std::strerror(errno);
      return resp;
    }
    pollfd pfd{sock.fd, POLLOUT, 0};
    const int rc = ::poll(&pfd, 1, remainingMs(deadline));
    if (rc == 0) {
      resp.status = TransportStatus::Timeout;
      resp.detail = "connect timed out";
      return resp;
    }
    if (rc < 0) {
      resp.status = TransportStatus::ConnectFailed;
      resp.detail = std::string("poll(connect): ") + std::strerror(errno);
      return resp;
    }
    int soerr = 0;
    socklen_t len = sizeof(soerr);
    if (::getsockopt(sock.fd, SOL_SOCKET, SO_ERROR, &soerr, &len) != 0 || soerr != 0) {
      resp.status = TransportStatus::ConnectFailed;
      resp.detail = std::string("connect(): ") + std::strerror(soerr ? soerr : errno);
      return resp;
    }
  }

  // Refuse BEFORE serialising: the previewed digest and the wire bytes must describe the
  // same request, so a header that cannot be sent safely must not reach either.
  {
    std::string why;
    if (!headersAreWellFormed(request.headers, why)) {
      resp.status = TransportStatus::RefusedMalformedRequest;
      resp.detail = why;
      return resp;
    }
  }
  const std::string wire = request.serialize();
  std::size_t sent = 0;
  while (sent < wire.size()) {
    if (remainingMs(deadline) == 0) {
      resp.status = TransportStatus::Timeout;
      resp.detail = "write timed out";
      return resp;
    }
    pollfd pfd{sock.fd, POLLOUT, 0};
    const int rc = ::poll(&pfd, 1, remainingMs(deadline));
    if (rc == 0) {
      resp.status = TransportStatus::Timeout;
      resp.detail = "write timed out";
      return resp;
    }
    if (rc < 0) {
      if (errno == EINTR) continue;
      resp.status = TransportStatus::WriteFailed;
      resp.detail = std::string("poll(write): ") + std::strerror(errno);
      return resp;
    }
    const ssize_t n = ::send(sock.fd, wire.data() + sent, wire.size() - sent, 0);
    if (n < 0) {
      if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) continue;
      resp.status = TransportStatus::WriteFailed;
      resp.detail = std::string("send(): ") + std::strerror(errno);
      return resp;
    }
    sent += static_cast<std::size_t>(n);
  }

  std::string raw;
  char buf[16384];
  while (true) {
    if (remainingMs(deadline) == 0) {
      resp.status = TransportStatus::Timeout;
      resp.detail = "read timed out";
      return resp;
    }
    pollfd pfd{sock.fd, POLLIN, 0};
    const int rc = ::poll(&pfd, 1, remainingMs(deadline));
    if (rc == 0) {
      resp.status = TransportStatus::Timeout;
      resp.detail = "read timed out";
      return resp;
    }
    if (rc < 0) {
      if (errno == EINTR) continue;
      resp.status = TransportStatus::ReadFailed;
      resp.detail = std::string("poll(read): ") + std::strerror(errno);
      return resp;
    }
    const ssize_t n = ::recv(sock.fd, buf, sizeof(buf), 0);
    if (n == 0) break;  // Connection: close — the sidecar finished
    if (n < 0) {
      if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) continue;
      resp.status = TransportStatus::ReadFailed;
      resp.detail = std::string("recv(): ") + std::strerror(errno);
      return resp;
    }
    // Cap the total INCLUDING headers so a hostile sidecar cannot exhaust RAM.
    if (raw.size() + static_cast<std::size_t>(n) > max_body_bytes_ + 65536u) {
      resp.status = TransportStatus::ResponseTooLarge;
      resp.detail = "response exceeds cap";
      return resp;
    }
    raw.append(buf, static_cast<std::size_t>(n));
  }

  parseHttpResponse(raw, max_body_bytes_, resp);
  return resp;
}

}  // namespace forge::retrieval
