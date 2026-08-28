// ─────────────────────────────────────────────────────────────────────────────
// loopback_live.cpp — exercises the REAL POSIX socket transport against a stub
// SearXNG sidecar on 127.0.0.1.
//
// The main gate (retrieval_gate.cpp) never opens a socket, which means the
// LoopbackHttpTransport connect/write/read/parse path would otherwise ship
// unexecuted. This driver closes that gap. It is loopback-only — the same
// destination class SACROSANCT 20.2 permits — and is driven by
// loopback_live_check.sh, which starts and stops the stub itself.
//
// usage: loopback_live <port>
// exit 0 iff the client completed a full request/response against the stub and
// the evidence records came back as expected.
// ─────────────────────────────────────────────────────────────────────────────
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>

#include "forge/retrieval/Redactor.hpp"
#include "forge/retrieval/SearchRequest.hpp"
#include "forge/retrieval/SearxngClient.hpp"

using namespace forge::retrieval;

namespace {
int g_fail = 0;
void check(bool cond, const std::string& what) {
  std::cout << (cond ? "  ok   " : "  FAIL ") << what << "\n";
  if (!cond) ++g_fail;
}
}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "usage: loopback_live <port>\n";
    return 2;
  }
  const int port = std::atoi(argv[1]);
  if (port <= 0 || port > 65535) {
    std::cerr << "bad port\n";
    return 2;
  }

  PrivateLexicon lex;
  lex.customer_names = {"Northwind Aerospace"};
  lex.part_numbers = {"ACME-4471-B"};
  lex.secret_dimensions = {47.625};

  SearxngEndpoint ep;
  ep.host = "127.0.0.1";
  ep.port = static_cast<std::uint16_t>(port);
  ep.path = "/search";
  ep.use_post = true;

  SearxngClient client(std::make_shared<LoopbackHttpTransport>(), Redactor(lex), ep);

  SearchRequest req;
  req.engineering_question =
      "For Northwind Aerospace part ACME-4471-B, what general tolerance applies to a "
      "47.625 mm bore under ISO 2768 medium class?";
  req.retrieval_rationale = "local index lacks this edition";
  req.esg_assertion_id = "ESG-114";
  req.expected_fact_types = {FactType::DimensionalStandard};
  req.expected_units = {"mm"};
  req.max_results = 10;
  req.min_distinct_publishers = 2;

  const QueryPreview p = client.preview(req);
  std::cout << p.renderForOperator();
  check(p.sendable(), "preview built for the live loopback endpoint");
  check(p.destination_origin == "http://127.0.0.1:" + std::to_string(port),
        "destination is the loopback stub");

  const RetrievalResult r = client.search(p, SendApproval::grant(p));
  std::cout << "  status: " << retrievalStatusName(r.status) << " (" << r.detail << ")\n";
  std::cout << "  elapsed: " << r.elapsed_ms << " ms\n";

  check(r.status == RetrievalStatus::Ok, "the real socket transport completed the round trip");
  check(r.transmit_attempts == 1, "exactly one transmit attempt");
  check(r.evidence.size() == 2, "both stub results became evidence records");
  check(r.distinct_publishers == 2, "two distinct publishers were seen");
  if (!r.evidence.empty()) {
    check(r.evidence.front().source_type == SourceType::LawOrRegulator,
          "the iso.org result ranked first as LawOrRegulator");
    check(!r.evidence.front().content_hash.empty(), "records carry a content hash");
    std::cout << "  top: " << r.evidence.front().url << "\n";
    std::cout << "  quote: " << r.evidence.front().quoted_span.display() << "\n";
  }

  std::cout << (g_fail == 0 ? "\nLOOPBACK LIVE OK\n" : "\nLOOPBACK LIVE FAILED\n");
  return g_fail == 0 ? 0 : 1;
}
