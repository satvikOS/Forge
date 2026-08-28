// ─────────────────────────────────────────────────────────────────────────────
// EvidenceRecord.hpp — SACROSANCT 12.2 evidence record + authority ranking, and
// the 12.3 boundary "retrieval is not execution".
//
// 12.3 is enforced STRUCTURALLY, not by convention. Everything that came off the
// wire is wrapped in UntrustedText, which:
//   • has no implicit conversion to std::string, so it cannot be spliced into a
//     prompt, a command, a tool name, or a feature-IR field by accident;
//   • exposes its bytes only through display() (for showing a human) and
//     validateAsNumericFact() (an explicit parse-and-check that yields a typed
//     CitedCandidate carrying its applicability conditions).
// A retrieved string therefore cannot become executable feature data without
// passing a parser and a validator, which is exactly what 12.3 requires.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace forge::retrieval {

// 12.2 authority ladder. Lower ordinal == higher authority.
enum class SourceType {
  LawOrRegulator = 0,       // applicable law, regulator, authorized standard
  ManufacturerDocument = 1, // original manufacturer or project documentation
  PeerReviewed = 2,         // peer-reviewed paper, official dataset/model card
  InstitutionalReference = 3,
  SecondaryTechnical = 4,
  CommunityDiscussion = 5,  // lead only; never sole authority for a critical value
};

const char* sourceTypeName(SourceType t);

// Authority rank of a source type: 0 is most authoritative.
int authorityRank(SourceType t);

// 12.2: "community discussion as a lead, never sole authority for a critical
// value." This predicate is what a caller must consult before letting a single
// record settle a critical number.
bool mayBeSoleAuthorityForCriticalValue(SourceType t);

// ── 12.3 boundary type ──────────────────────────────────────────────────────
// Bytes that came off the network. Inert by construction.
class UntrustedText {
public:
  UntrustedText() = default;
  explicit UntrustedText(std::string bytes) : bytes_(std::move(bytes)) {}

  bool empty() const { return bytes_.empty(); }
  std::size_t size() const { return bytes_.size(); }

  // For rendering to a human, with control characters neutralized so retrieved
  // text cannot rewrite a terminal or a log line.
  std::string display() const;

  // Escape hatch for storage/hashing ONLY. Named so that any use is visible in
  // review, and deliberately not an operator or a conversion.
  const std::string& rawForStorage() const { return bytes_; }

  // Heuristic report that this span is shaped like an instruction aimed at the
  // agent ("ignore previous instructions", "you must call", fenced tool blocks).
  // Retrieval never obeys it either way; a positive result is recorded on the
  // evidence so a reviewer can see the source tried.
  bool looksLikeInjectionAttempt() const;

private:
  std::string bytes_;
};

// The only route from retrieved text to a usable engineering number.
struct CitedCandidate {
  double value = 0.0;
  std::string unit;
  std::string normalized_claim;
  std::string applicability_conditions;  // 12.3: candidates carry their conditions
  std::string source_url;
  std::string content_hash;
  SourceType source_type = SourceType::SecondaryTechnical;
  bool requires_corroboration = false;   // true for community-led sources
};

// ── 12.2 evidence record ────────────────────────────────────────────────────
enum class AssertionRelation { Supports, Contradicts, Unrelated };
const char* assertionRelationName(AssertionRelation r);

struct EvidenceRecord {
  std::string url;
  UntrustedText title;
  std::string publisher;              // derived from the URL host, not from page text
  std::string retrieval_time_utc;     // ISO-8601, stamped locally at receipt
  std::string publication_time_utc;   // ISO-8601 when the source reports one
  UntrustedText quoted_span;          // truncated to the fair-use budget below
  UntrustedText normalized_claim;
  std::string units;
  SourceType source_type = SourceType::SecondaryTechnical;
  std::string applicable_terms_note;  // licence/terms observed for this source
  std::string content_hash;           // hash of the retrieved bytes, where lawful
  std::string esg_assertion_id;
  AssertionRelation relation = AssertionRelation::Unrelated;
  bool quote_truncated = false;
  bool injection_attempt_flagged = false;

  // 12.3: turn this record into a usable number only via an explicit parse.
  // Returns nullopt when the claim does not parse as `expected_unit`.
  std::optional<CitedCandidate> validateAsNumericFact(const std::string& expected_unit,
                                                      const std::string& applicability) const;
};

// 12.2 "quoted span within copyright limits": a hard cap on how much of a source
// is retained, applied at parse time, not left to the caller's discretion.
inline constexpr std::size_t kMaxQuotedSpanChars = 320;

// Truncates on a word boundary and reports whether it had to.
UntrustedText clampQuotedSpan(const std::string& raw, bool& truncated_out);

// FNV-1a 64 rendered as 16 lowercase hex digits.
std::string contentHashHex(const std::string& bytes);

// ── ranking ─────────────────────────────────────────────────────────────────
// 12.2: "Freshness does not automatically beat authority." Ordering is authority
// first; publication recency is only a TIE-BREAK WITHIN one authority tier.
// Returns true when `a` should be ranked before `b`.
bool rankBefore(const EvidenceRecord& a, const EvidenceRecord& b);

// Stable sort into presentation order.
void rankEvidence(std::vector<EvidenceRecord>& records);

// Deduplicate by content hash, then by URL. Keeps the highest-ranked instance.
void deduplicateEvidence(std::vector<EvidenceRecord>& records);

// 12.2: "Contradictory current sources remain visible until resolved."
struct Contradiction {
  std::size_t index_a = 0;
  std::size_t index_b = 0;
  std::string note;
};
std::vector<Contradiction> findContradictions(const std::vector<EvidenceRecord>& records);

// Source diversity: number of distinct publishers present.
std::size_t distinctPublishers(const std::vector<EvidenceRecord>& records);

}  // namespace forge::retrieval
