// ─────────────────────────────────────────────────────────────────────────────
// Redactor.hpp — query minimization and redaction (SACROSANCT 12.1, 20.2).
//
// 12.1 is unambiguous: "Raw user drawings, customer names, secret dimensions,
// part numbers, and proprietary text must not be sent to public search engines.
// Queries are minimized and redacted."
//
// DESIGN POSTURE — DEFAULT-DENY ON NUMBERS. The naive redactor is a denylist of
// bad patterns; that leaks the first time a customer is named something the list
// never saw. This redactor inverts it for the highest-risk class: EVERY numeric
// literal is stripped unless it is explicitly recognized as a PUBLIC designation
// (a standards-body number such as ISO 2768, a material grade such as 6061-T6, a
// bolt property class such as 8.8). A secret dimension does not have to be
// registered anywhere to be removed — it is removed because nothing allowed it
// to stay. Registered lexicon terms are a second, independent layer, not the
// primary defense.
//
// TWO OUTPUT FORMS:
//   wire_query   — what is actually transmitted. Redacted spans are DELETED, not
//                  replaced, because a placeholder is search noise and minimizing
//                  means sending less.
//   preview_form — the same redaction with [CUSTOMER]/[DIM]/[PART_NUMBER]
//                  markers left in place, so a human can see WHAT was removed and
//                  WHERE before approving transmission (20.2 preview duty).
//
// POST-CONDITION: verifyNoResidue() re-scans the fully serialized outgoing bytes
// (percent-decoded) for private residue using checks that do NOT depend on the
// classifier that produced them — a normalized substring scan for every lexicon
// term (a term of one or two normalized characters must match a whole
// alphanumeric run, so precision survives at length 1 without the term becoming
// exempt) and a parsed-value scan for every registered secret dimension. A bug in
// redact() therefore cannot silently leak a registered secret; the client refuses
// to write the socket when residue is found.
//
// Pure C++20 + the standard library.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace forge::retrieval {

enum class RedactionKind {
  RegisteredCustomer,   // customer/client organization from the project lexicon
  RegisteredProject,    // internal project or program code name
  RegisteredSupplier,   // supplier under NDA
  RegisteredSecret,     // free-form proprietary term registered by the ESG
  PartNumber,           // internal or supplier part/drawing identifier
  DimensionLiteral,     // any numeric value not allowlisted as a public designation
  DrawingReference,     // sheet/revision/drawing callout
  EmailAddress,
  FilesystemPath,
  Url,
  OpaqueIdentifier,     // serial, hash, ticket id, long alnum blob
  ProperNoun,           // heuristic: capitalized token outside the public vocabulary
};

const char* redactionKindName(RedactionKind kind);

// One removal, recorded for the local preview and audit trail.
// `matched` holds the ORIGINAL text: it exists only in-process for the operator's
// preview and MUST NOT be serialized into any outgoing buffer.
struct RedactionEvent {
  RedactionKind kind{};
  std::string matched;
  std::string marker;      // what preview_form shows in its place
  std::size_t offset = 0;  // byte offset into the raw input
  std::size_t length = 0;
};

// Terms the project/ESG has declared private. This is authoritative: anything
// listed here is removed no matter how it is spelled, cased, or punctuated.
struct PrivateLexicon {
  std::vector<std::string> customer_names;
  std::vector<std::string> project_names;
  std::vector<std::string> supplier_names;
  std::vector<std::string> part_numbers;
  std::vector<std::string> secret_terms;
  // Confidential numeric values (in whatever unit the ESG holds them). Matched
  // by parsed VALUE, so 47.625 is caught however it is formatted or encoded.
  std::vector<double> secret_dimensions;
};

struct RedactionPolicy {
  // Strip every numeric literal that is not an allowlisted public designation.
  // Turning this off is a policy downgrade and is never done in production.
  bool strip_unallowlisted_numbers = true;
  bool strip_part_numbers = true;
  bool strip_proper_nouns = true;
  // Coarse public thread callouts (M12, M8x1.25) are catalogue sizes, not design
  // secrets; allowing them keeps fastener queries answerable.
  bool allow_public_thread_designations = true;
  // Minimization budget for the outgoing query.
  std::size_t max_query_chars = 240;
  std::size_t max_query_terms = 24;
};

struct RedactionResult {
  std::string wire_query;    // transmitted (redacted spans deleted)
  std::string preview_form;  // shown to the operator (redacted spans marked)
  std::vector<RedactionEvent> events;
  // Public designations the redactor DELIBERATELY kept (e.g. "ISO 2768").
  // verifyNoResidue() consults this allow-set so a kept designation's digits are
  // not re-flagged as a leaked dimension.
  std::vector<std::string> kept_designations;
  bool truncated_by_budget = false;

  bool removedAnyOf(RedactionKind kind) const;
  std::size_t countOf(RedactionKind kind) const;
};

class Redactor {
public:
  Redactor() = default;
  explicit Redactor(PrivateLexicon lexicon, RedactionPolicy policy = {});

  const RedactionPolicy& policy() const { return policy_; }
  const PrivateLexicon& lexicon() const { return lexicon_; }

  // Minimize and redact a raw engineering question.
  RedactionResult redact(const std::string& raw) const;

  // ENVELOPE-SAFE post-condition scan. `wire` may be a COMPLETE HTTP request —
  // request line, headers, percent-encoded body and all. Checks that no
  // registered lexicon term and no registered secret dimension survives, using
  // logic independent of the classifier in redact(). Returns true when clean.
  //
  // `residue` entries name the VIOLATED CLASS and the lexicon index only. They
  // never contain the secret itself, because a residue report is exactly the
  // kind of string that ends up in a log (20.2: secrets never reach logs).
  bool verifyNoResidue(const std::string& wire,
                       std::vector<std::string>& residue) const;

  // STRICT scan for the q= value alone. Adds the default-deny numeric rule: any
  // numeric literal that is not inside `allowed_designations` is residue. This
  // cannot be run over a whole HTTP request, whose envelope legitimately carries
  // numbers (HTTP/1.1, Content-Length, pageno=1).
  bool verifyQueryFullyRedacted(const std::string& query_text,
                                const std::vector<std::string>& allowed_designations,
                                std::vector<std::string>& residue) const;

private:
  PrivateLexicon lexicon_;
  RedactionPolicy policy_;
};

// ─────────────────────────────────────────────────────────────────────────────
// NUMERALS WRITTEN IN WORDS, AND IN SCRIPTS THAT ARE NOT ASCII
//
// The numeric grammar above is DIGIT-ONLY. Measured at 02de2e15 on the real
// preview->search path, 30 of 42 spellings of a REGISTERED secret dimension
// reached the wire buffer with status Ok: every English number word
// ("thickness forty seven point six two five mm"), every ordinal, every
// word/digit mix, spelled fractions, other Latin-script languages, and every
// non-ASCII decimal digit (fullwidth, Arabic-Indic, Devanagari). Two classes:
//
//   A. NUMBER WORDS. The per-token classifier in redact() splits on whitespace
//      and decides one token at a time, so a six-token run can never be seen by
//      any rule living inside that loop. The fix is a SPAN PRODUCER that runs
//      before the longest-match sort, not another token rule.
//   B. NON-ASCII DIGITS. normalizeForMatch() keeps only isAsciiAlnum bytes, so
//      every other code point is DELETED before the value scan ever sees it.
//      The fix is a fold that runs UPSTREAM of normalization.
//
// MATCHING POLICY FOR WORDS — stated, because it differs from the digit stance.
// Default-deny is free on digits (no ordinary engineering question is made of
// bare numbers) and RUINOUS on words: measured, a blanket deny over the modelled
// numeral words destroys 42 of 42 ordinary queries ("one-piece housing",
// "six degrees of freedom", "nine to five duty cycle"). A numeral-word run is
// therefore stripped on either of two grounds, NOT on sight:
//   LAYER A — VALUE MATCH. The run composes to a value registered in
//             PrivateLexicon::secret_dimensions. Unconditional, context-free,
//             and re-checked independently in verifyNoResidue().
//   LAYER B — DIMENSIONAL CONTEXT. The run is immediately preceded by a
//             dimension noun or immediately followed by a unit word, and is not
//             one of a closed list of public numeric idioms. Heuristic
//             defence-in-depth for a secret nobody registered.
// Layer B's idiom exemptions never apply to Layer A: an exemption can weaken the
// heuristic layer, never the registered one.
//
// Non-ASCII DIGITS keep the digit stance — default-deny — because they cost
// nothing on the control set and are indistinguishable from an evasion attempt.
//
// RESIDUAL RISK, in one sentence: a secret dimension that is NOT registered and
// is spelled in a numeral word this generated lexicon does not model (a language
// outside en/de/fr, or a novel spelling) is stripped only if it lands in a
// dimensional context, so it can still reach the wire.
// ─────────────────────────────────────────────────────────────────────────────

// Exposed for testing and for the request serializer.
namespace detail {
// ASCII fold used ONLY by the numeral reader. Unicode decimal digits become
// their ASCII digit, fullwidth forms become their ASCII counterpart, and vulgar
// fractions expand to "n/d". Everything else is passed through byte for byte.
//
// THE SENTINEL IS LOAD-BEARING. A folded byte can come from a multi-byte code
// point and one code point can fold to several bytes, so `raw_offset` carries
// the RAW byte index each folded byte came from PLUS a terminal entry equal to
// raw.size(). A span's raw end is raw_offset[span.end] read DIRECTLY — never
// raw_offset[span.end - 1] + 1, which lands inside a UTF-8 sequence.
//
// This is deliberately NOT normalizeForMatch/normalizeWithMap. Those two are a
// strict 1:1 bijection on kept bytes and are the registered-term key; collapsing
// "forty seven" to "47" inside them would displace every registered-term offset
// they produce and make redaction delete the wrong bytes.
struct Folded {
  std::string text;
  std::vector<std::size_t> raw_offset;   // text.size() + 1 entries
  std::vector<unsigned char> synthetic;  // 1 when the byte came from a non-ASCII code point
};
Folded foldForMatch(const std::string& raw);

// One maximal run of adjacent numeral tokens, in FOLDED byte offsets. Offsets
// MUST be carried back through Folded::raw_offset before they touch any span
// vector that indexes the raw string; folded-space and raw-space offsets are
// both std::size_t and the compiler cannot tell them apart.
struct NumeralRun {
  std::size_t begin = 0;
  std::size_t end = 0;
  std::vector<double> values;   // every reading the run admits
  bool has_word = false;        // at least one token was a spelled numeral
  bool has_nonascii = false;    // at least one byte came from a folded code point
  bool dimension_context = false;
  bool public_idiom = false;    // exempt from LAYER B only
};
std::vector<NumeralRun> readNumerals(const Folded& folded);

// Lowercase, drop every non-alphanumeric byte. "ACME-4471 B" -> "acme4471b".
std::string normalizeForMatch(const std::string& s);
// Undo every encoding this codebase can emit (percent-encoding including '+'
// for space, and JSON \uXXXX escapes) so residue cannot hide behind an encoder.
std::string decodeForResidueScan(const std::string& s);
// True when the token is a public standards/material/class designation.
bool isPublicDesignation(const std::string& token, const std::string& previous_token,
                         bool allow_thread_designations);
}  // namespace detail

}  // namespace forge::retrieval
