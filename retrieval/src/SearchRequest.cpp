#include "forge/retrieval/SearchRequest.hpp"

#include <cctype>
#include <cstdint>

namespace forge::retrieval {

const char* factTypeName(FactType t) {
  switch (t) {
    case FactType::Definition: return "Definition";
    case FactType::NumericLimit: return "NumericLimit";
    case FactType::MaterialProperty: return "MaterialProperty";
    case FactType::DimensionalStandard: return "DimensionalStandard";
    case FactType::TestMethod: return "TestMethod";
    case FactType::RegulatoryRequirement: return "RegulatoryRequirement";
    case FactType::ProcessParameter: return "ProcessParameter";
    case FactType::SupplierAvailability: return "SupplierAvailability";
  }
  return "Unknown";
}

const char* freshnessName(FreshnessWindow f) {
  switch (f) {
    case FreshnessWindow::Any: return "";
    case FreshnessWindow::PastDay: return "day";
    case FreshnessWindow::PastWeek: return "week";
    case FreshnessWindow::PastMonth: return "month";
    case FreshnessWindow::PastYear: return "year";
  }
  return "";
}

const char* requestBuildStatusName(RequestBuildStatus s) {
  switch (s) {
    case RequestBuildStatus::Ok: return "Ok";
    case RequestBuildStatus::InvalidRequest: return "InvalidRequest";
    case RequestBuildStatus::PrivacyClassForbidsNetwork: return "PrivacyClassForbidsNetwork";
    case RequestBuildStatus::RedactionResidueDetected: return "RedactionResidueDetected";
  }
  return "Unknown";
}

bool SearchRequest::validate(std::string& why) const {
  why.clear();
  if (engineering_question.empty()) {
    why = "engineering_question is empty";
    return false;
  }
  if (retrieval_rationale.empty()) {
    // 12.1 asks for the question AND why retrieval is needed. A request that
    // cannot say why it needs the network does not get the network.
    why = "retrieval_rationale is empty: 12.1 requires a stated reason for egress";
    return false;
  }
  if (expected_fact_types.empty()) {
    why = "expected_fact_types is empty: 12.1 requires the expected fact types";
    return false;
  }
  if (max_results == 0 || max_pages == 0 || max_time_ms == 0) {
    why = "result/page/time budget must be non-zero";
    return false;
  }
  if (min_distinct_publishers > max_results) {
    why = "min_distinct_publishers exceeds max_results: diversity requirement is unsatisfiable";
    return false;
  }
  if (language.empty()) {
    why = "language is empty";
    return false;
  }
  return true;
}

std::uint64_t digestBytes(const std::string& bytes) {
  std::uint64_t h = 1469598103934665603ull;  // FNV-1a 64 offset basis
  for (const unsigned char c : bytes) {
    h ^= static_cast<std::uint64_t>(c);
    h *= 1099511628211ull;
  }
  return h;
}

// ── SHA-256, from FIPS 180-4 (Secure Hash Standard, August 2015) ─────────────
// §4.1.2 functions, §4.2.2 constants (the first 32 bits of the fractional parts
// of the cube roots of the first 64 primes), §5.1.1 padding, §5.3.3 initial hash
// value (square roots of the first 8 primes), §6.2.2 compression. FNV-1a is kept
// for body_digest because the executor's approval record has always carried it;
// it is NOT what binds a request, because an FNV collision can be constructed by
// anyone who controls part of the input — and the handling fields are free text.
namespace {

constexpr std::uint32_t kSha256K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

std::uint32_t rotr(std::uint32_t x, unsigned n) { return (x >> n) | (x << (32u - n)); }

void sha256Block(std::uint32_t h[8], const unsigned char* block) {
  std::uint32_t w[64];
  for (unsigned t = 0; t < 16; ++t) {
    w[t] = (static_cast<std::uint32_t>(block[4 * t]) << 24) |
           (static_cast<std::uint32_t>(block[4 * t + 1]) << 16) |
           (static_cast<std::uint32_t>(block[4 * t + 2]) << 8) | static_cast<std::uint32_t>(block[4 * t + 3]);
  }
  for (unsigned t = 16; t < 64; ++t) {
    const std::uint32_t s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >> 10);
    const std::uint32_t s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >> 3);
    w[t] = s1 + w[t - 7] + s0 + w[t - 16];
  }
  std::uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (unsigned t = 0; t < 64; ++t) {
    const std::uint32_t sigma1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const std::uint32_t ch = (e & f) ^ (~e & g);
    const std::uint32_t t1 = hh + sigma1 + ch + kSha256K[t] + w[t];
    const std::uint32_t sigma0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const std::uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    const std::uint32_t t2 = sigma0 + maj;
    hh = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d;
  h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

void appendLength64(std::string& out, std::uint64_t n) {
  for (int shift = 56; shift >= 0; shift -= 8) {
    out.push_back(static_cast<char>((n >> shift) & 0xFF));
  }
}

}  // namespace

std::string sha256Hex(const std::string& bytes) {
  std::uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  std::string padded = bytes;
  padded.push_back(static_cast<char>(0x80));
  while (padded.size() % 64 != 56) padded.push_back('\0');
  appendLength64(padded, static_cast<std::uint64_t>(bytes.size()) * 8u);
  for (std::size_t off = 0; off < padded.size(); off += 64) {
    sha256Block(h, reinterpret_cast<const unsigned char*>(padded.data() + off));
  }
  static const char* kHex = "0123456789abcdef";
  std::string out;
  out.reserve(64);
  for (const std::uint32_t word : h) {
    for (int shift = 28; shift >= 0; shift -= 4) out.push_back(kHex[(word >> shift) & 0xF]);
  }
  return out;
}

std::string manifestDigestHex(const RequestManifest& manifest) {
  // Length-prefixed, so no choice of item values can make two different
  // manifests encode to the same bytes ("a=b" + "c" vs "a" + "b=c").
  std::string encoded;
  appendLength64(encoded, manifest.size());
  for (const auto& [name, value] : manifest) {
    appendLength64(encoded, name.size());
    encoded += name;
    appendLength64(encoded, value.size());
    encoded += value;
  }
  return sha256Hex(encoded);
}

std::string escapeManifestValue(const std::string& value) {
  static const char* kHex = "0123456789ABCDEF";
  std::string out;
  out.reserve(value.size());
  for (const unsigned char c : value) {
    if (c == '\\') { out += "\\\\"; continue; }
    if (c == '\r') { out += "\\r"; continue; }
    if (c == '\n') { out += "\\n"; continue; }
    if (c == '\t') { out += "\\t"; continue; }
    if (c >= 0x20 && c < 0x7F) { out.push_back(static_cast<char>(c)); continue; }
    out += "\\x";
    out.push_back(kHex[(c >> 4) & 0xF]);
    out.push_back(kHex[c & 0xF]);
  }
  return out;
}

std::string formEncode(const std::string& raw) {
  static const char* kHex = "0123456789ABCDEF";
  std::string out;
  out.reserve(raw.size() * 3 / 2);
  for (const unsigned char c : raw) {
    const bool unreserved = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                            (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~';
    if (unreserved) {
      out.push_back(static_cast<char>(c));
    } else {
      out.push_back('%');
      out.push_back(kHex[(c >> 4) & 0xF]);
      out.push_back(kHex[c & 0xF]);
    }
  }
  return out;
}

std::string QueryPreview::renderForOperator() const {
  std::string out;
  out += "SearXNG retrieval preview\n";
  out += "  status        : ";
  out += requestBuildStatusName(status);
  if (!status_detail.empty()) {
    out += " (" + status_detail + ")";
  }
  out += "\n";
  // WHERE and HOW are read out of the approval manifest whenever there is one,
  // never out of the free-standing destination_origin / http_method / path
  // fields: those are not covered by the request digest, so a preview edited
  // after it was built could otherwise SUMMARISE one destination above an
  // itemised list that approves another. With no manifest (an unsendable
  // preview) there is nothing to approve, and the summary says so.
  auto item = [&](const char* name) -> const std::string* {
    for (const auto& [k, v] : approval_manifest) {
      if (k == name) return &v;
    }
    return nullptr;
  };
  const std::string* m_scheme = item("scheme");
  const std::string* m_host = item("connect.host");
  const std::string* m_port = item("connect.port");
  const std::string* m_method = item("http.method");
  const std::string* m_path = item("http.path");
  if (m_scheme && m_host && m_port && m_method && m_path) {
    out += "  destination   : " + destination_class + " " + escapeManifestValue(*m_scheme) + "://" +
           escapeManifestValue(*m_host) + ":" + escapeManifestValue(*m_port) + "\n";
    out += "  request       : " + escapeManifestValue(*m_method) + " " + escapeManifestValue(*m_path) + "\n";
  } else {
    out += "  destination   : (none: this preview describes no approvable request)\n";
    out += "  request       : (none)\n";
  }
  out += "  query sent    : " + redacted_query + "\n";
  out += "  query removed : " + annotated_query + "\n";
  out += "  removals      : " + std::to_string(removals.size()) + "\n";
  for (const RedactionEvent& e : removals) {
    // The operator's own screen is the one place the original may be shown; it
    // is never written into encoded_body and never leaves the process.
    out += "      - ";
    out += redactionKindName(e.kind);
    out += " at offset " + std::to_string(e.offset) + "\n";
  }
  out += "  fields        :\n";
  for (const auto& [k, v] : fields) {
    out += "      " + k + " = " + v + "\n";
  }
  out += "  body bytes    : " + std::to_string(encoded_body.size()) + "\n";
  out += "  body digest   : " + std::to_string(body_digest) + "\n";
  // The approval surface, printed FROM THE SAME VECTOR the digest is taken over,
  // one item per line, values in their lossless escaped form. Nothing an approval
  // covers is summarised away and nothing is shown that it does not cover.
  out += "  APPROVING THIS PREVIEW APPROVES EXACTLY THESE " + std::to_string(approval_manifest.size()) +
         " ITEMS (SHA-256 below is taken over them, in this order):\n";
  for (const auto& [item, value] : approval_manifest) {
    out += "    | " + item + " = " + escapeManifestValue(value) + "\n";
  }
  out += "  request digest: " + (request_digest.empty() ? std::string("(none: not approvable)") : request_digest) +
         "\n";
  out += "  valid on      : client instance #" + std::to_string(client_instance) +
         " only (a SendApproval does not transfer to another client object, or to a copy of this one)\n";
  return out;
}

}  // namespace forge::retrieval
