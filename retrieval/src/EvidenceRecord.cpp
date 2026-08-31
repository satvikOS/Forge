#include "forge/retrieval/EvidenceRecord.hpp"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <cmath>
#include <set>

namespace forge::retrieval {
namespace {

std::string toLower(std::string s) {
  for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

bool isDigit(unsigned char c) { return c >= '0' && c <= '9'; }

}  // namespace

const char* sourceTypeName(SourceType t) {
  switch (t) {
    case SourceType::LawOrRegulator: return "LawOrRegulator";
    case SourceType::ManufacturerDocument: return "ManufacturerDocument";
    case SourceType::PeerReviewed: return "PeerReviewed";
    case SourceType::InstitutionalReference: return "InstitutionalReference";
    case SourceType::SecondaryTechnical: return "SecondaryTechnical";
    case SourceType::CommunityDiscussion: return "CommunityDiscussion";
  }
  return "Unknown";
}

int authorityRank(SourceType t) { return static_cast<int>(t); }

bool mayBeSoleAuthorityForCriticalValue(SourceType t) {
  return t != SourceType::CommunityDiscussion;
}

const char* assertionRelationName(AssertionRelation r) {
  switch (r) {
    case AssertionRelation::Supports: return "Supports";
    case AssertionRelation::Contradicts: return "Contradicts";
    case AssertionRelation::Unrelated: return "Unrelated";
  }
  return "Unknown";
}

std::string UntrustedText::display() const {
  std::string out;
  out.reserve(bytes_.size());
  for (const unsigned char c : bytes_) {
    // Neutralize C0 controls and DEL: retrieved text must not be able to move a
    // cursor, clear a screen, or forge a log line.
    if (c == '\t') { out += "    "; continue; }
    if (c < 0x20 || c == 0x7F) { out.push_back(' '); continue; }
    out.push_back(static_cast<char>(c));
  }
  return out;
}

bool UntrustedText::looksLikeInjectionAttempt() const {
  static const char* kMarkers[] = {
      "ignore previous", "ignore all previous", "disregard the above",
      "system:", "assistant:", "you must now", "new instructions",
      "override your", "tool_call", "<tool", "```tool", "run the following command",
      "execute the following", "act as", "developer mode",
  };
  const std::string lower = toLower(bytes_);
  for (const char* m : kMarkers) {
    if (lower.find(m) != std::string::npos) return true;
  }
  return false;
}

UntrustedText clampQuotedSpan(const std::string& raw, bool& truncated_out) {
  truncated_out = false;
  if (raw.size() <= kMaxQuotedSpanChars) return UntrustedText(raw);
  std::size_t cut = raw.rfind(' ', kMaxQuotedSpanChars);
  if (cut == std::string::npos || cut < kMaxQuotedSpanChars / 2) cut = kMaxQuotedSpanChars;
  truncated_out = true;
  return UntrustedText(raw.substr(0, cut) + " ...");
}

std::string contentHashHex(const std::string& bytes) {
  std::uint64_t h = 1469598103934665603ull;
  for (const unsigned char c : bytes) {
    h ^= static_cast<std::uint64_t>(c);
    h *= 1099511628211ull;
  }
  static const char* kHex = "0123456789abcdef";
  std::string out(16, '0');
  for (int i = 15; i >= 0; --i) {
    out[static_cast<std::size_t>(i)] = kHex[h & 0xF];
    h >>= 4;
  }
  return out;
}

std::optional<CitedCandidate> EvidenceRecord::validateAsNumericFact(
    const std::string& expected_unit, const std::string& applicability) const {
  // 12.3: this is the ONLY route from retrieved text to a usable number, and it
  // is an explicit parse with an explicit unit check — never a coercion.
  if (expected_unit.empty()) return std::nullopt;
  if (toLower(units) != toLower(expected_unit)) return std::nullopt;

  const std::string& claim = normalized_claim.rawForStorage();
  std::size_t i = 0;
  while (i < claim.size() && !isDigit(static_cast<unsigned char>(claim[i])) && claim[i] != '-') ++i;
  if (i >= claim.size()) return std::nullopt;
  std::size_t begin = i;
  if (claim[begin] == '-') {
    if (begin + 1 >= claim.size() || !isDigit(static_cast<unsigned char>(claim[begin + 1]))) {
      return std::nullopt;
    }
    ++i;
  }
  while (i < claim.size() && isDigit(static_cast<unsigned char>(claim[i]))) ++i;
  if (i < claim.size() && claim[i] == '.') {
    ++i;
    while (i < claim.size() && isDigit(static_cast<unsigned char>(claim[i]))) ++i;
  }
  double value = 0.0;
  const char* first = claim.data() + begin;
  const char* last = claim.data() + i;
  if (std::from_chars(first, last, value).ec != std::errc()) return std::nullopt;
  if (!std::isfinite(value)) return std::nullopt;

  CitedCandidate c;
  c.value = value;
  c.unit = expected_unit;
  c.normalized_claim = normalized_claim.display();
  c.applicability_conditions = applicability.empty() ? applicable_terms_note : applicability;
  c.source_url = url;
  c.content_hash = content_hash;
  c.source_type = source_type;
  // 12.2: a community lead can never stand alone for a critical value.
  c.requires_corroboration = !mayBeSoleAuthorityForCriticalValue(source_type);
  return c;
}

bool rankBefore(const EvidenceRecord& a, const EvidenceRecord& b) {
  const int ra = authorityRank(a.source_type);
  const int rb = authorityRank(b.source_type);
  // AUTHORITY FIRST. A 2026 forum post never outranks a 1998 regulation.
  if (ra != rb) return ra < rb;
  // Freshness is a tie-break WITHIN one authority tier only. ISO-8601 strings
  // compare lexicographically in chronological order; a missing date sorts last.
  const bool ha = !a.publication_time_utc.empty();
  const bool hb = !b.publication_time_utc.empty();
  if (ha != hb) return ha;
  if (ha && a.publication_time_utc != b.publication_time_utc) {
    return a.publication_time_utc > b.publication_time_utc;
  }
  return a.url < b.url;
}

void rankEvidence(std::vector<EvidenceRecord>& records) {
  std::stable_sort(records.begin(), records.end(), rankBefore);
}

void deduplicateEvidence(std::vector<EvidenceRecord>& records) {
  rankEvidence(records);
  std::set<std::string> seen_hash;
  std::set<std::string> seen_url;
  std::vector<EvidenceRecord> kept;
  kept.reserve(records.size());
  for (EvidenceRecord& r : records) {
    if (!r.content_hash.empty() && !seen_hash.insert(r.content_hash).second) continue;
    if (!r.url.empty() && !seen_url.insert(r.url).second) continue;
    kept.push_back(std::move(r));
  }
  records = std::move(kept);
}

std::vector<Contradiction> findContradictions(const std::vector<EvidenceRecord>& records) {
  std::vector<Contradiction> out;
  for (std::size_t i = 0; i < records.size(); ++i) {
    for (std::size_t j = i + 1; j < records.size(); ++j) {
      const EvidenceRecord& a = records[i];
      const EvidenceRecord& b = records[j];
      if (a.esg_assertion_id.empty() || a.esg_assertion_id != b.esg_assertion_id) continue;
      if (a.relation == AssertionRelation::Unrelated || b.relation == AssertionRelation::Unrelated) {
        continue;
      }
      if (a.relation == b.relation) continue;
      // 12.2: stays VISIBLE until resolved — recorded, never silently dropped.
      out.push_back(Contradiction{i, j,
                                  std::string("assertion ") + a.esg_assertion_id + ": " +
                                      sourceTypeName(a.source_type) + " " +
                                      assertionRelationName(a.relation) + " vs " +
                                      sourceTypeName(b.source_type) + " " +
                                      assertionRelationName(b.relation)});
    }
  }
  return out;
}

std::size_t distinctPublishers(const std::vector<EvidenceRecord>& records) {
  std::set<std::string> p;
  for (const EvidenceRecord& r : records) {
    if (!r.publisher.empty()) p.insert(r.publisher);
  }
  return p.size();
}

}  // namespace forge::retrieval
