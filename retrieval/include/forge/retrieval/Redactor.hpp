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
// UNICODE — NORMALISE FIRST, THEN DENY BY DEFAULT. Every scan in this file was
// ASCII-only, so a registered secret written as fullwidth "４７．６２５", as fullwidth
// "ＢＯＥＩＮＧ", or as "bluefаlcon" with ONE Cyrillic letter reached the wire with
// search=Ok (measured against 1dd9ed9b). There is now ONE normaliser,
// detail::foldForMatch(), and every scan goes through it:
//   * every General_Category=Nd code point folds to its ASCII digit;
//   * fullwidth ASCII variants fold to ASCII (their <wide> decompositions);
//   * Latin letters with diacritics fold by canonical decomposition;
//   * Cyrillic, Greek and Armenian letters that are Latin look-alikes fold
//     through a UTS #39 confusable skeleton;
//   * a small closed set of spaces, dashes, quotes and engineering symbols fold
//     to ASCII punctuation or a space.
// Then deny by default: malformed UTF-8, ANY code point outside those tables, and
// any token that MIXES scripts (or decimal-digit systems) is refused, and
// redact() returns a refusal instead of a query. The query that is sent is the
// FOLDED ASCII text, so what the classifier judged is byte-for-byte what leaves.
// verifyNoResidue() scans the raw form AND the folded form.
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
  // by parsed VALUE after Unicode folding, so 47.625, .47625e2, ４７．６２５ and
  // ٤٧.٦٢٥ are the same value. What folding cannot model is not "caught" — it is
  // refused before it can be sent (see UNICODE above). That is the honest form of
  // "however it is formatted": words ("forty-seven point six") are NOT caught.
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

  // DENY BY DEFAULT. Non-empty when the input could not be normalised: malformed
  // UTF-8, a code point the normaliser does not model, or a token mixing scripts
  // or decimal systems. When set, wire_query and preview_form are EMPTY and the
  // caller must refuse the request. Each entry names the class and byte offset
  // only — never the text, which is exactly what a refusal ends up logging.
  std::vector<std::string> refusals;
  bool refused() const { return !refusals.empty(); }

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

// Exposed for testing and for the request serializer.
namespace detail {

// ── the ONE Unicode normaliser ───────────────────────────────────────────────
enum class FoldScript : unsigned char { Common, Latin, Cyrillic, Greek, Armenian };

enum class FoldIssueKind {
  InvalidUtf8,          // not well-formed UTF-8 (Unicode §3.9, Table 3-7)
  UnmodelledCodePoint,  // no table below models it: refused, never guessed at
  MixedScript,          // one token carries letters from two scripts
  MixedDecimalSystems,  // one token carries digits from two Nd ranges
};
const char* foldIssueName(FoldIssueKind kind);

struct FoldIssue {
  FoldIssueKind kind{};
  std::size_t raw_offset = 0;  // byte offset of the offending code point in the input
};

struct Folded {
  std::string text;                    // ASCII only
  std::vector<std::size_t> raw_offset;  // raw byte offset for each text byte, plus a sentinel
  std::vector<FoldIssue> issues;        // empty = the whole input was modelled
  bool ok() const { return issues.empty(); }
};

// Fold `raw` (UTF-8) to ASCII. Tokens for the mixed-script rule are separated by
// whitespace (ASCII, or a code point that folds to a space).
Folded foldForMatch(const std::string& raw);

// The table lookup behind foldForMatch, for ONE code point. Returns false when
// the code point is not modelled. `ascii` receives 1..3 ASCII bytes; `script`
// the letter's script (Common for everything that is not a letter);
// `decimal_zero` the zero of the code point's Nd range, or 0 when it is not an
// Nd digit. Exposed so a gate can check every entry against the UCD.
bool foldCodePoint(char32_t cp, std::string& ascii, FoldScript& script, char32_t& decimal_zero);

// Fold (best effort, issues ignored), lowercase, drop every non-alphanumeric
// byte. "ACME-4471 B" -> "acme4471b", "ＡＣＭＥ-４４７１" -> "acme4471".
std::string normalizeForMatch(const std::string& s);
// Undo every encoding this codebase can emit (percent-encoding including '+'
// for space, and JSON \uXXXX escapes decoded to UTF-8, surrogate pairs joined)
// so residue cannot hide behind an encoder.
std::string decodeForResidueScan(const std::string& s);
// True when the token is a public standards/material/class designation.
bool isPublicDesignation(const std::string& token, const std::string& previous_token,
                         bool allow_thread_designations);
}  // namespace detail

}  // namespace forge::retrieval
