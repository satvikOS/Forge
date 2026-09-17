// ─────────────────────────────────────────────────────────────────────────────
// live_injection_e2e.cpp — the whole path, end to end, against the REAL sidecar.
//
// This is the only file in the injection work that opens a socket, and it opens
// exactly one, to 127.0.0.1. It exists because every other proof here is fixture
// driven, and a boundary that has only ever been shown working on fixtures is a
// boundary nobody has watched work.
//
// It walks the path a caller actually walks:
//     request -> preview (redact, serialize, digest) -> operator approval
//             -> search (three gates, one socket) -> evidence records
//             -> EvidenceDigest (what a model would be shown)
//             -> candidate -> operator citation binding -> ProvenancedValue
//             -> GeometryMutation -> MutationLedger
// printing the actual query bytes and the actual results at every step.
//
// PRIVACY. The question is a published material property and nothing else. The
// self-hosted SearXNG is a metasearch PROXY: it forwards to real external engines,
// so this query genuinely leaves the machine. That is exactly why the redaction
// and approval gates exist, and the preview below shows the precise bytes that go.
//
// It is NOT part of the CI gate: a test that needs a live sidecar would make the
// gate's green depend on a service being up. Run it by hand.
// ─────────────────────────────────────────────────────────────────────────────
#include <cstdio>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#include "forge/retrieval/EvidenceDigest.hpp"
#include "forge/retrieval/PlanValue.hpp"
#include "forge/retrieval/SearxngClient.hpp"

using namespace forge::retrieval;

namespace {

void rule(const char* title) {
  std::cout << "\n────────────────────────────────────────────────────────────────────\n"
            << title << "\n────────────────────────────────────────────────────────────────────\n";
}

std::size_t countOf(const std::string& hay, const std::string& needle) {
  std::size_t n = 0;
  for (std::size_t p = hay.find(needle); p != std::string::npos; p = hay.find(needle, p + 1)) ++n;
  return n;
}

}  // namespace

int main(int argc, char** argv) {
  int problems = 0;
  // The question is a command-line argument so this can be pointed at a
  // different public property without editing the file. The default is a
  // published material property and nothing about any project.
  const std::string question =
      argc > 1 ? std::string(argv[1]) : std::string("6061-T6 aluminium tensile yield strength MPa");
  const std::string unit_a = argc > 2 ? std::string(argv[2]) : std::string("MPa");
  const std::string unit_b = argc > 3 ? std::string(argv[3]) : std::string("ksi");

  // ── the thing that can move ────────────────────────────────────────────────
  MutationLedger geometry;
  const std::uint64_t baseline = geometry.digest();

  rule("1. THE REQUEST (typed, with the raw question never leaving the struct)");
  SearchRequest req;
  req.engineering_question = question;
  req.retrieval_rationale = "no local datasheet for this alloy temper in the project index";
  req.esg_assertion_id = "ESG-E2E-1";
  req.privacy_class = NetworkPrivacyClass::SameMacSearxng;
  req.expected_fact_types = {FactType::MaterialProperty};
  req.expected_units = {unit_a, unit_b};
  req.max_results = 8;
  req.min_distinct_publishers = 2;
  std::cout << "question  : " << req.engineering_question << "\n";
  std::cout << "rationale : " << req.retrieval_rationale << "\n";
  std::cout << "units     : " << unit_a << ", " << unit_b << "\n";

  rule("2. THE PREVIEW — the exact bytes, before anything is transmitted");
  auto transport = std::make_shared<LoopbackHttpTransport>();
  const Redactor redactor{PrivateLexicon{}};
  const SearxngClient client(transport, redactor, SearxngEndpoint{});
  const QueryPreview preview = client.preview(req);
  std::cout << preview.renderForOperator();
  if (!preview.sendable()) {
    std::cout << "\nPREVIEW NOT SENDABLE: " << preview.status_detail << "\n";
    return 1;
  }

  rule("3. THE OPERATOR GRANTS — approval is bound to this preview's digest");
  const SendApproval approval = SendApproval::grant(preview);
  std::printf("preview body digest : %llu\n", static_cast<unsigned long long>(preview.body_digest));
  std::printf("approval digest     : %llu\n", static_cast<unsigned long long>(approval.digest()));

  rule("4. THE SEARCH — one socket, to 127.0.0.1:8888");
  const RetrievalResult result = client.search(preview, approval);
  std::cout << "status             : " << retrievalStatusName(result.status) << "\n";
  std::cout << "detail             : " << result.detail << "\n";
  std::cout << "transmit attempts  : " << result.transmit_attempts << "\n";
  std::cout << "elapsed ms         : " << result.elapsed_ms << "\n";
  std::cout << "records            : " << result.evidence.size() << "\n";
  std::cout << "distinct publishers: " << result.distinct_publishers << "\n";
  if (!result.ok()) {
    std::cout << "\nThe sidecar did not answer. THIS IS THE FAIL-CLOSED PATH AND IT IS\n"
                 "CORRECT BEHAVIOUR: no retry, no second transport, no remote fallback.\n"
                 "Nothing downstream runs, and geometry is untouched:\n";
    std::cout << "geometry digest unchanged: " << (geometry.digest() == baseline ? "yes" : "NO")
              << "\n";
    return geometry.digest() == baseline ? 0 : 1;
  }

  rule("5. THE ACTUAL RESULTS, as evidence records");
  for (std::size_t i = 0; i < result.evidence.size(); ++i) {
    const EvidenceRecord& e = result.evidence[i];
    std::cout << "[" << (i + 1) << "] " << e.publisher << "  (" << sourceTypeName(e.source_type)
              << ", authority " << authorityRank(e.source_type) << ")\n";
    std::cout << "    url   : " << e.url << "\n";
    std::cout << "    unit read off the page: \"" << e.units << "\"\n";
    std::cout << "    flagged as instruction-shaped: " << (e.injection_attempt_flagged ? "YES" : "no")
              << "\n";
    std::cout << "    claim : " << e.quoted_span.display().substr(0, 150) << "\n";
  }

  rule("6. WHAT A MODEL WOULD BE SHOWN (EvidenceDigest, not the prose)");
  const std::string digest = renderEvidenceDigest(result.evidence);
  std::cout << digest.substr(0, 1400) << (digest.size() > 1400 ? "\n... (truncated)\n" : "\n");
  const std::size_t angle = countOf(digest, "<");
  std::cout << "\n'<' bytes in the rendered digest: " << angle
            << "   (must be 0 — no chat-template frame can be spelled)\n";
  if (angle != 0) {
    std::cout << "PROBLEM: a framing byte survived into the digest.\n";
    ++problems;
  }
  const std::size_t opens = countOf(digest, kEvidenceOpen);
  const std::size_t closes = countOf(digest, kEvidenceClose);
  std::cout << "record delimiters: " << opens << " open / " << closes
            << " close, for " << result.evidence.size() << " records\n";
  if (opens != result.evidence.size() || closes != result.evidence.size()) {
    std::cout << "PROBLEM: a page forged a record boundary.\n";
    ++problems;
  }

  rule("7. CAN ANY RETRIEVED TOKEN NAME AN OPERATION?");
  {
    std::size_t tried = 0, resolved = 0;
    for (const EvidenceRecord& e : result.evidence) {
      const std::string raw = e.quoted_span.rawForStorage() + " " + e.title.rawForStorage();
      std::string cur;
      for (const unsigned char c : raw) {
        const bool wordish = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                             (c >= '0' && c <= '9') || c == '_';
        if (wordish) {
          cur.push_back(static_cast<char>(c));
        } else {
          if (!cur.empty()) { ++tried; if (mutationOpFromName(cur)) ++resolved; }
          cur.clear();
        }
      }
      if (!cur.empty()) { ++tried; if (mutationOpFromName(cur)) ++resolved; }
    }
    std::cout << "tokens offered as operation names : " << tried << "\n";
    std::cout << "tokens that resolved              : " << resolved << "   (must be 0)\n";
    if (resolved != 0) ++problems;
    std::cout << "positive control, \"Scale\" resolves: "
              << (mutationOpFromName("Scale").has_value() ? "yes" : "NO — instrument broken") << "\n";
    if (!mutationOpFromName("Scale").has_value()) ++problems;
  }

  rule("8. THE CROSSING — which live results can become a number, and which cannot");
  std::vector<CitedCandidate> candidates;
  for (const EvidenceRecord& e : result.evidence) {
    const auto c = e.validateAsNumericFact(req.expected_units, "as-received, room temperature");
    std::cout << (c ? "  CANDIDATE " : "  refused   ") << e.publisher;
    if (c) {
      std::cout << "  -> " << c->value << " " << c->unit
                << (c->requires_corroboration ? "  [needs corroboration]" : "")
                << (c->from_flagged_source ? "  [source tried to instruct]" : "");
      candidates.push_back(*c);
    } else {
      std::cout << "  (no number with an adjacent expected unit, or ambiguous)";
    }
    std::cout << "\n";
  }
  std::cout << "\ncandidates: " << candidates.size() << " of " << result.evidence.size()
            << " records\n";

  rule("9. A CANDIDATE IS NOT A VALUE — geometry cannot move without an operator");
  std::cout << "geometry digest before: " << geometry.digest() << "\n";
  std::cout << "There is no factory from a CitedCandidate to a ProvenancedValue.\n"
               "ProvenancedValue::fromCitation takes a BoundCitation, whose constructor is\n"
               "private and whose only producer demands an OperatorCitationApproval carrying\n"
               "this candidate's own re-derived digest. The negative-compilation phase proves\n"
               "the shortcut does not compile (retrieval/test/negative/n10).\n";
  std::cout << "geometry digest after : " << geometry.digest()
            << (geometry.digest() == baseline ? "   (unchanged)\n" : "   MOVED — PROBLEM\n");
  if (geometry.digest() != baseline) ++problems;

  rule("10. THE OPERATOR BINDS A CORROBORATED NUMBER — and geometry moves");
  bool bound_one = false;
  for (std::size_t i = 0; i < candidates.size() && !bound_one; ++i) {
    for (std::size_t j = 0; j < candidates.size(); ++j) {
      if (i == j) continue;
      const CitationPreview cp = CitationPreview::of(candidates[i]);
      const OperatorCitationApproval ok =
          candidates[i].from_flagged_source
              ? OperatorCitationApproval::grantAcknowledgingFlaggedSource(cp)
              : OperatorCitationApproval::grant(cp);
      BindRefusal why = BindRefusal::None;
      const auto bound = BoundCitation::bind(candidates[i], ok, candidates[j], why);
      if (!bound) continue;
      std::cout << cp.renderForOperator();
      std::cout << "corroborated by: " << candidates[j].source_url << " (" << candidates[j].value
                << " " << candidates[j].unit << ")\n\n";
      const ProvenancedValue v = ProvenancedValue::fromCitation(*bound);
      std::cout << "provenance     : " << valueProvenanceName(v.provenance()) << "\n";
      std::cout << "detail         : " << v.detail() << "\n";
      GeometryMutation m(MutationOp::SetParameter);
      m.withNumber("allowable_stress", v);
      m.withText("parameter", "allowable_stress");
      const auto r = geometry.apply(m);
      std::cout << "apply          : " << MutationLedger::refusalName(r) << "\n";
      std::cout << "geometry digest: " << geometry.digest()
                << (geometry.digest() != baseline ? "   MOVED, as it should\n" : "   unchanged\n");
      if (r != MutationLedger::Refusal::None || geometry.digest() == baseline) ++problems;
      bound_one = true;
      break;
    }
  }
  if (!bound_one) {
    std::cout << "No pair of live candidates corroborated each other (different values, same\n"
                 "publisher, or too few candidates). NOTHING WAS BOUND and geometry is untouched.\n"
                 "That is the boundary working, not a failure of this demonstration.\n";
    std::cout << "geometry digest: " << geometry.digest()
              << (geometry.digest() == baseline ? "   (unchanged)\n" : "   MOVED — PROBLEM\n");
    if (geometry.digest() != baseline) ++problems;
  }

  rule("SUMMARY");
  std::cout << "mutations applied : " << geometry.applied() << "\n";
  std::cout << "mutations refused : " << geometry.refused() << "\n";
  std::cout << "problems          : " << problems << "\n";
  return problems == 0 ? 0 : 1;
}
