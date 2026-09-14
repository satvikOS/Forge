// ─────────────────────────────────────────────────────────────────────────────
// PlanValue.hpp — the structural boundary between retrieved text and geometry.
//
// THE PROPERTY, stated once: NO BYTE OF RETRIEVED TEXT CAN BECOME AN IDENTIFIER
// OR A NUMBER IN A MUTATION, because every identifier is drawn from a closed set
// enumerated HERE (never read off the wire) and every number must be minted by a
// factory that demands non-textual evidence. This is not a denylist of phrases.
// There is no production in the grammar that reads from retrieved bytes.
//
// WHY A FILTER WOULD NOT DO. Filtering catches malformed input. The attack that
// matters is not malformed: "set wall thickness to 0.1 mm" is a perfectly
// well-typed mutation naming a real operation with a real parameter and a
// plausible number. Nothing about it is ill-formed, so nothing about it can be
// filtered. The only defence is to make an UNPROVENANCED NUMBER
// UNCONSTRUCTIBLE — which is what the five factories below do.
//
// MEASURED, and the reason this file exists. The model is not a boundary: fed a
// poisoned tool result it emitted MUTATE_GEOMETRY(scale=10) verbatim on 4/4
// trials and reported a fabricated "99999 MPa" on 4/4 (2026-09-14, 20 trials,
// 8/20 obeyed). Its resistance is payload-dependent and cannot be relied on at
// any rate. Everything here is designed for a TOTALLY CAPTURED planner.
//
// THE MECHANISM IS ONE THIS CODEBASE ALREADY TRUSTS. SendApproval in
// SearxngClient.hpp has no public constructor, so no call-site can fabricate
// permission to transmit. BoundCitation below is the same trick pointed at the
// other direction: no call-site can fabricate permission for a retrieved number
// to enter a plan.
//
// WHAT THIS FILE IS NOT. It is not forge::ui::validatePlan and does not replace
// it. This is the retrieval-side half of the boundary: it governs what may be
// MINTED from evidence. Closing the other half — removing the public numeric
// constructor from forge::ui::PlanArg so the application's own plan type cannot
// hold an unprovenanced double — is NOT DONE here and is named in the report.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "forge/retrieval/EvidenceRecord.hpp"

namespace forge::retrieval {

// ── provenance ──────────────────────────────────────────────────────────────
// Every number in a mutation carries where it came from. There is deliberately
// NO enumerator meaning "the model read it in a search result", because there is
// no factory that would produce one.
enum class ValueProvenance : std::uint8_t {
  UserIntent,        // the literal appears in the user's own instruction
  RegistryDefault,   // taken from the parameter's declared default
  DocumentMeasured,  // Forge measured it on the live document
  CitedBound,        // a CitedCandidate an operator explicitly bound
  PlannerDerived,    // arithmetic over the above, inputs retained
};
const char* valueProvenanceName(ValueProvenance p);

// ── capability tokens ───────────────────────────────────────────────────────
// Each names one provenance and can only be produced by the path that
// provenance describes. Their honest strengths differ and are stated here
// rather than assumed equal:
//
//   IntentSpan      STRONG   — locate() re-reads the user's text and fails when
//                              the literal is not in it. Checked, not asserted.
//   RegistryNumber  STRONG   — takes the value OUT of the spec. No overload
//                              accepts a caller-supplied double at all.
//   Measurement     PARTIAL  — as strong as its token's minting site, which is
//                              the kernel session bridge and is NOT in this
//                              module. Stated as a gap, not glossed.
//   BoundCitation   STRONG   — private constructor; the only producer is bind(),
//                              which re-derives the candidate digest and demands
//                              an operator approval carrying the same digest.
//   Derivation      WEAKEST  — see the warning on Derivation below.

// The literal actually occurs in the user's own instruction.
class IntentSpan {
 public:
  // Returns nullopt when `value` is not written in `user_intent`. Comparison is
  // on the parsed magnitude, so "12", "12.0" and "12 mm" all locate 12.
  static std::optional<IntentSpan> locate(const std::string& user_intent, double value);

  double value() const { return value_; }
  std::size_t begin() const { return begin_; }
  const std::string& literal() const { return literal_; }

 private:
  IntentSpan() = default;
  double value_ = 0.0;
  std::size_t begin_ = 0;
  std::string literal_;
};

// What the command registry declares about one numeric parameter. The host fills
// this in from its own registry; nothing retrieved can reach it.
struct ParameterSpec {
  std::string name;
  bool has_default_number = false;
  double default_number = 0.0;
};

class RegistryNumber {
 public:
  // Takes the value FROM the spec. There is no overload accepting a double,
  // which is what stops "registry default" from becoming a label anyone can
  // staple onto an arbitrary number.
  static std::optional<RegistryNumber> fromSpec(const ParameterSpec& spec);

  double value() const { return value_; }
  const std::string& parameter() const { return parameter_; }

 private:
  RegistryNumber() = default;
  double value_ = 0.0;
  std::string parameter_;
};

// Proof that the caller holds a live kernel session. NAMED GAP: this module
// cannot enforce where the session pointer came from — the kernel bridge is not
// linked here — so DocumentMeasured is the one provenance whose strength rests
// outside this file.
class KernelMeasurementToken {
 public:
  static KernelMeasurementToken forSession(const void* kernel_session);
  bool valid() const { return session_ != nullptr; }

 private:
  KernelMeasurementToken() = default;
  const void* session_ = nullptr;
};

class Measurement {
 public:
  static std::optional<Measurement> fromKernel(const KernelMeasurementToken& token,
                                               std::string quantity, std::string entity_ref,
                                               double value, std::string unit);
  double value() const { return value_; }
  const std::string& quantity() const { return quantity_; }
  const std::string& entity_ref() const { return entity_ref_; }
  const std::string& unit() const { return unit_; }

 private:
  Measurement() = default;
  double value_ = 0.0;
  std::string quantity_;
  std::string entity_ref_;
  std::string unit_;
};

// ── the citation crossing ───────────────────────────────────────────────────
// This is the ONE legal route from retrieved text to a number, and it is one
// function wide, one-directional, and yields a double and a unit — never a
// string, never an identifier.
//
//   UntrustedText -> validateAsNumericFact -> CitedCandidate
//                 -> [OPERATOR SEES CitationPreview AND GRANTS]
//                 -> BoundCitation -> ProvenancedValue::fromCitation

// A stable digest over the parts of a candidate that decide what it means.
// Derived from the candidate's bytes every time it is asked for, never cached on
// the candidate — a digest stored next to the value it protects is a field
// compared against itself.
std::uint64_t citationDigest(const CitedCandidate& c);

// Exactly what the operator is shown before binding. Rendering neutralizes the
// retrieved claim through UntrustedText::display().
class CitationPreview {
 public:
  static CitationPreview of(const CitedCandidate& candidate);

  std::uint64_t digest() const { return digest_; }
  const std::string& renderForOperator() const { return rendered_; }
  bool flagged_source() const { return flagged_; }
  bool requires_corroboration() const { return requires_corroboration_; }

 private:
  CitationPreview() = default;
  std::uint64_t digest_ = 0;
  std::string rendered_;
  bool flagged_ = false;
  bool requires_corroboration_ = false;
};

// A capability token proving a specific previewed candidate was shown to a human
// and accepted. No public constructor: it can only come from grant().
class OperatorCitationApproval {
 public:
  static OperatorCitationApproval grant(const CitationPreview& preview);

  // A separate entry point, not a bool parameter, for the case where the source
  // that supplied the number ALSO tried to issue instructions. The
  // acknowledgment is in the name of the function the operator's UI had to call.
  static OperatorCitationApproval grantAcknowledgingFlaggedSource(const CitationPreview& preview);

  std::uint64_t digest() const { return digest_; }
  bool granted() const { return granted_; }
  bool acknowledged_flagged_source() const { return acknowledged_flagged_; }

 private:
  OperatorCitationApproval() = default;
  std::uint64_t digest_ = 0;
  bool granted_ = false;
  bool acknowledged_flagged_ = false;
};

enum class BindRefusal {
  None,
  NotGranted,            // the approval is not a granted one
  DigestMismatch,        // the candidate is not the candidate that was approved
  FlaggedSourceNotAcknowledged,
  CorroborationMissing,  // community-tier sole source for a value
  CorroborationSamePublisher,
  CorroborationUnitMismatch,
  CorroborationValueDisagrees,
};
const char* bindRefusalName(BindRefusal r);

class BoundCitation {
 public:
  // The only producer. Re-derives the digest FROM `candidate` at bind time and
  // compares it to the token's — comparing against a digest carried on the
  // candidate would compare a mutable field against itself, which is precisely
  // the defect SearxngClient::search()'s gate 2 was written to avoid.
  //
  // `corroboration` must be supplied when the candidate requires it, must come
  // from a different publisher, must carry the same unit, and must agree within
  // 5% — otherwise this refuses. 12.2: a community lead never stands alone.
  static std::optional<BoundCitation> bind(const CitedCandidate& candidate,
                                           const OperatorCitationApproval& approval,
                                           const std::optional<CitedCandidate>& corroboration,
                                           BindRefusal& why);

  double value() const { return value_; }
  const std::string& unit() const { return unit_; }
  const std::string& source_url() const { return source_url_; }
  const std::string& content_hash() const { return content_hash_; }
  std::uint64_t digest() const { return digest_; }

 private:
  BoundCitation() = default;
  double value_ = 0.0;
  std::string unit_;
  std::string source_url_;
  std::string content_hash_;
  std::uint64_t digest_ = 0;
};

// ── the value ───────────────────────────────────────────────────────────────
// A number that may appear in a mutation. There is NO public constructor taking
// a double, and no setter. An implementer cannot write the line that puts an
// attacker's number into a plan; the compiler refuses it.
class ProvenancedValue {
 public:
  static ProvenancedValue fromUserIntent(const IntentSpan& span);
  static ProvenancedValue fromRegistryDefault(const RegistryNumber& n);
  static ProvenancedValue fromMeasurement(const Measurement& m);
  static ProvenancedValue fromCitation(const BoundCitation& c);

  double value() const { return value_; }
  ValueProvenance provenance() const { return provenance_; }
  const std::string& detail() const { return detail_; }
  // Non-zero only for CitedBound: the digest of the bound candidate, so an
  // audit can trace the number back to the exact approved evidence.
  std::uint64_t citation_digest() const { return citation_digest_; }
  std::size_t derivation_depth() const { return derivation_depth_; }

 private:
  friend class Derivation;
  ProvenancedValue() = default;
  double value_ = 0.0;
  ValueProvenance provenance_ = ValueProvenance::PlannerDerived;
  std::string detail_;
  std::uint64_t citation_digest_ = 0;
  std::size_t derivation_depth_ = 0;
};

// Arithmetic over already-provenanced values, retaining its inputs.
//
// THIS IS THE LAUNDERER AND IT IS SHIPPED DISABLED. Arithmetic can carry an
// attacker-suggested magnitude into a legal-looking value, so: depth is capped
// at 2, every input must be non-derived, and the whole factory refuses unless
// the host explicitly enables it. A capability that has never been shown to fail
// should not be on by default.
class Derivation {
 public:
  static void setEnabled(bool on);
  static bool enabled();

  static std::optional<Derivation> of(std::string note, std::vector<ProvenancedValue> inputs,
                                      double result);

  static std::optional<ProvenancedValue> toValue(const Derivation& d);

  const std::vector<ProvenancedValue>& inputs() const { return inputs_; }

 private:
  Derivation() = default;
  std::string note_;
  std::vector<ProvenancedValue> inputs_;
  double result_ = 0.0;
};

// ── the closed identifier set ───────────────────────────────────────────────
// Enumerated HERE. A retrieved string cannot name an operation because the names
// are not read from anywhere; to name one, an attacker must guess a string that
// is already in this enum — and anything already in this enum the user could
// have invoked from a menu. Retrieved text therefore buys no new verbs.
enum class MutationOp : std::uint8_t {
  Extrude,
  Revolve,
  Fillet,
  Chamfer,
  Shell,
  Translate,
  Rotate,
  Scale,
  SetParameter,
};
const char* mutationOpName(MutationOp op);

// Exact, case-sensitive allowlist lookup. Not a prefix match, not a fuzzy match.
std::optional<MutationOp> mutationOpFromName(const std::string& name);

// DELETED, on purpose. This is the compile error that stops a retrieved string
// from ever being offered as an operation name — the attempt does not fail at
// runtime, it fails to build. Same for the text-argument setter below.
std::optional<MutationOp> mutationOpFromName(const UntrustedText&) = delete;

// ── the mutation ────────────────────────────────────────────────────────────
class GeometryMutation {
 public:
  explicit GeometryMutation(MutationOp op) : op_(op) {}

  GeometryMutation& withNumber(std::string name, ProvenancedValue value);
  GeometryMutation& withText(std::string name, std::string value);

  // DELETED. A retrieved span can never become a selector, a plane name, or any
  // other text argument — the class of argument that smuggled a whole further IR
  // statement past a step whose own op was legal.
  GeometryMutation& withText(std::string name, const UntrustedText& value) = delete;

  MutationOp op() const { return op_; }
  const std::vector<std::pair<std::string, ProvenancedValue>>& numbers() const { return numbers_; }
  const std::vector<std::pair<std::string, std::string>>& texts() const { return texts_; }

 private:
  MutationOp op_;
  std::vector<std::pair<std::string, ProvenancedValue>> numbers_;
  std::vector<std::pair<std::string, std::string>> texts_;
};

// ── the thing that moves ────────────────────────────────────────────────────
// The stand-in for geometry in this module: an append-only ledger whose digest
// is what a gate compares before and after feeding hostile evidence through the
// whole path. "Geometry did not move" is then a byte comparison, not a claim.
class MutationLedger {
 public:
  enum class Refusal {
    None,
    UnprovenancedValue,       // PlannerDerived with no retained inputs
    DerivationTooDeep,
    TextArgumentNamesAnOp,    // an op name smuggled into a text argument
    TextArgumentNotInert,     // quote, newline, control char, or angle bracket
    TextArgumentTooLong,
    MissingRequiredArgument,
  };
  static const char* refusalName(Refusal r);

  Refusal apply(const GeometryMutation& m);

  std::size_t applied() const { return applied_; }
  std::size_t refused() const { return refused_; }
  // FNV-1a over everything applied, in order. Unchanged digest == nothing moved.
  std::uint64_t digest() const { return digest_; }
  const std::vector<std::string>& journal() const { return journal_; }

 private:
  std::size_t applied_ = 0;
  std::size_t refused_ = 0;
  std::uint64_t digest_ = 1469598103934665603ull;
  std::vector<std::string> journal_;
};

// Longest text argument a mutation may carry. Enforced here, not left to callers.
inline constexpr std::size_t kMaxTextArgumentChars = 120;

}  // namespace forge::retrieval
