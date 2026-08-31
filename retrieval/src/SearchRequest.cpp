#include "forge/retrieval/SearchRequest.hpp"

#include <cctype>

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
  out += "  destination   : " + destination_class + " " + destination_origin + "\n";
  out += "  request       : " + http_method + " " + path + "\n";
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
  return out;
}

}  // namespace forge::retrieval
