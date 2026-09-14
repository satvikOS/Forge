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

  // For rendering to a human, with everything that can move a cursor, reorder a
  // line or hide inside one neutralized: C0 controls and DEL, the bidi overrides
  // and isolates (U+202A..U+202E, U+2066..U+2069), the zero-width characters
  // (U+200B..U+200F, U+FEFF) and the line/paragraph separators. NBSP folds to a
  // plain space so a marker cannot hide behind an exotic blank.
  //
  // MEASURED 2026-09-14, before this was widened: U+202E survived display()
  // byte-for-byte, so a retrieved span could reverse the rendering of the
  // operator's own approval line. The operator is the LAST gate; text aimed at
  // them is worse than text aimed at the model.
  std::string display() const;

  // Escape hatch for storage/hashing ONLY. Named so that any use is visible in
  // review, and deliberately not an operator or a conversion.
  const std::string& rawForStorage() const { return bytes_; }

  // Heuristic report that this span is shaped like an instruction aimed at the
  // agent ("ignore previous instructions", "you must call", fenced tool blocks,
  // a forged chat-template frame such as <|im_start|>).
  //
  // THIS IS NOT A CONTROL AND NOTHING MAY DEPEND ON IT. Retrieval never obeys a
  // span either way; a positive result is recorded on the evidence so a reviewer
  // can see the source tried, and is carried onto any CitedCandidate so the
  // operator binding can refuse it. The structural defences live in PlanValue.hpp.
  //
  // The scan runs over a normalized form (case-folded, zero-width and bidi
  // characters removed, NBSP and full-width ASCII folded). MEASURED 2026-09-14
  // before that normalization existed: "ignore previous instructions" was
  // flagged, and the same bytes with one U+200B after the "i", or with the
  // spaces as U+00A0, were NOT. A marker list matched against raw bytes is
  // defeated by a character the reader cannot see.
  bool looksLikeInjectionAttempt() const;

private:
  std::string bytes_;
};

// The only route from retrieved text to a usable engineering number.
//
// A CitedCandidate is still UNTRUSTED. It is a parsed reading of an attacker-
// controlled page, not a fact and not a plan input. It becomes usable only after
// an operator binds it (see BoundCitation in PlanValue.hpp), and it is the
// operator's approval — never this struct — that authorizes a number.
struct CitedCandidate {
  double value = 0.0;
  std::string unit;                      // READ FROM THE PAGE, adjacent to the number
  std::string normalized_claim;
  std::string applicability_conditions;  // 12.3: candidates carry their conditions
  std::string source_url;
  std::string content_hash;
  SourceType source_type = SourceType::SecondaryTechnical;
  // True for community-led sources AND for any source that tried to issue
  // instructions, at any authority tier. Attempted injection is evidence about
  // the publisher: it costs them sole-authority standing.
  bool requires_corroboration = false;
  // The source's span was shaped like an instruction. Carried here so a binding
  // decision can see it; a flagged candidate is never silently discarded and
  // never silently accepted.
  bool from_flagged_source = false;
};

// A number found in retrieved text together with the unit token written NEXT TO
// IT ON THE PAGE. `unit` is empty when the number carries no adjacent unit.
//
// This exists because the unit has to be read from the source. A unit copied
// from the caller's own request and then compared against the caller's own
// expectation is a comparison of a value with itself, which is how a page
// reading "276 MPa" produced CitedCandidate{value=276, unit="furlongs"}.
struct NumericSpan {
  double value = 0.0;
  std::string unit;
  std::size_t begin = 0;   // byte offset of the first digit (or sign)
  std::size_t end = 0;     // byte offset one past the unit, or past the number
};

// Scans for every standalone number in `text` and the unit token adjacent to it.
// A digit run glued to a letter ("T6", "6061-T6") is an identifier, not a number,
// and is not reported.
std::vector<NumericSpan> scanNumericSpans(const std::string& text);

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
  // The unit READ OFF THE PAGE, next to the first number in the claim. Empty
  // when the claim states no unit. It is NEVER the unit the caller asked for:
  // see NumericSpan above for why that distinction is the whole check.
  std::string units;
  SourceType source_type = SourceType::SecondaryTechnical;
  std::string applicable_terms_note;  // licence/terms observed for this source
  std::string content_hash;           // hash of the retrieved bytes, where lawful
  std::string esg_assertion_id;
  AssertionRelation relation = AssertionRelation::Unrelated;
  bool quote_truncated = false;
  bool injection_attempt_flagged = false;

  // 12.3: turn this record into a usable number only via an explicit parse.
  //
  // THE CHECK READS THE PAGE. The unit is taken from the claim text next to the
  // number and compared against `expected_unit`; the record's own `units` field
  // is not consulted, because on the live path that field was being filled in
  // from the caller's own request.
  //
  // Returns nullopt when: the expectation is empty; the claim carries no
  // standalone number; the number has no adjacent unit; the adjacent unit is not
  // the expected one; or the claim is AMBIGUOUS — several numbers with differing
  // adjacent units, or several different values under the expected unit.
  // Ambiguity is not a value.
  std::optional<CitedCandidate> validateAsNumericFact(const std::string& expected_unit,
                                                      const std::string& applicability) const;

  // Same check against a set of acceptable units. A request declaring
  // {"MPa","ksi"} must not reject a legitimately-ksi source, which the
  // single-unit form did by only ever being handed expected_units.front().
  std::optional<CitedCandidate> validateAsNumericFact(const std::vector<std::string>& expected_units,
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
