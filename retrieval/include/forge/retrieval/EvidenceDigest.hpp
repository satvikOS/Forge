// ─────────────────────────────────────────────────────────────────────────────
// EvidenceDigest.hpp — the ONLY shape in which retrieved text may re-enter a
// model prompt.
//
// The loop injects a tool result. If that result were the retrieved prose, the
// page would be writing directly into the context window, and the measurement
// says what happens then: fed a poisoned tool result the model emitted
// MUTATE_GEOMETRY(scale=10) verbatim 4/4 and reported a fabricated 99999 MPa 4/4
// (2026-09-14). So what goes back is never the blob — it is this: typed fields,
// each one escaped, assembled by code the page cannot reach.
//
// THE ESCAPING RULE, and why it is this one. Every field VALUE is emitted as a
// JSON string literal, and additionally every '<' and every '[' is emitted as a
// \u escape. Those two extra rules are what defeat framing forgery:
//   • the chat-template frames this model is trained on are SINGLE VOCAB TOKENS
//     (the tool-call delimiters are ids 151657/151658), so a page that gets those
//     bytes into the context is not writing text, it is writing a frame. With '<'
//     escaped, none of them can be spelled at all;
//   • the digest's own record delimiter starts with '['. With '[' escaped in
//     values, a page cannot close the evidence block and open a turn of its own.
//
// render() therefore has a property a gate can assert in one line: THE OUTPUT
// CONTAINS NO '<' BYTE. Not "we filtered the known frames"; none of them can be
// spelled.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <string>
#include <vector>

#include "forge/retrieval/EvidenceRecord.hpp"

namespace forge::retrieval {

// One record, rendered for injection. Field order is fixed by the code, never by
// the page.
std::string renderEvidenceDigest(const EvidenceRecord& record, std::size_t ordinal);

// A whole result set, plus the counts an agent needs in order to reason about
// sufficiency (how many publishers, whether anything was flagged).
std::string renderEvidenceDigest(const std::vector<EvidenceRecord>& records);

// The delimiter that opens and closes a record in the rendered form. It is
// ASCII-safe and cannot appear in any escaped value.
inline constexpr const char* kEvidenceOpen = "[[EVIDENCE ";
inline constexpr const char* kEvidenceClose = "[[END EVIDENCE ";

// Escapes one untrusted value for inclusion in a digest: a JSON string literal
// with '<' and '[' additionally escaped. Exposed so a gate can test it
// directly rather than only through the assembled output.
std::string escapeForDigest(const std::string& raw);

}  // namespace forge::retrieval
