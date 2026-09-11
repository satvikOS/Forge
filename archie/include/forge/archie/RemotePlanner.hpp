// forge::archie::RemotePlanner — a Planner backed by the local Archie sidecar.
//
// WHY IT LIVES IN ITS OWN MODULE AND NOT IN ui/src
//   ui/test/run_ui.sh builds `SRCS=(ui/src/*.cpp)` as a GLOB with only
//   `-I ui/include`. A file there that includes forge/retrieval/* fails to
//   compile and takes every ui gate down with it -- measured, not supposed. So
//   this mirrors retrieval/: its own include/src/test tree, built by its own
//   gate, coupling nothing that does not ask for it.
//
// WHY IT IS A PLANNER AND NOT A NEW PATH
//   forge::ui::Planner already exists as an abstract base with one pure virtual
//   plan(). LocalPlanner is its only implementation. This is the second, so the
//   app gains a model-backed planner WITHOUT any new seam: everything downstream
//   -- validatePlan() at two doors, the op-constraint bridge, the registry
//   dispatch, appendFeature's validateIr -- is unchanged and still refuses.
//
// WHY IT FAILS OPEN TO THE DETERMINISTIC PLANNER
//   The sidecar is OPTIONAL (doc 09: "an optional localhost sidecar"). When it is
//   not listening, or is slow, or answers with something unusable, this returns a
//   refusal carrying the reason and the caller keeps the deterministic
//   LocalPlanner it shipped with. A CAD app that stops working because a model is
//   down is a worse app than one that plans deterministically.
//
// WHY THE DIALECT IS OpenAI-SHAPED
//   The sidecar speaks POST /v1/chat/completions, the same dialect LM Studio and
//   Ollama expose. After the adapters are fused, the fused model IS the base and
//   LM Studio can serve it: this client then changes a PORT, not a line of code.
#pragma once

#include <cstdint>
#include <memory>
#include <string>

#include "forge/retrieval/HttpTransport.hpp"
#include "forge/ui/ArchieCopilot.hpp"

namespace forge::archie {

struct Endpoint {
  std::string host = "127.0.0.1";   // loopback ONLY; the transport refuses the rest
  std::uint16_t port = 8731;
  std::string path = "/v1/chat/completions";
  // A 30B VLM measured 21.1 s for one generation on this machine. The existing
  // retrieval client hardcodes 8000 ms, which would time out every real request.
  std::uint32_t timeout_ms = 120000;
};

class RemotePlanner final : public forge::ui::Planner {
 public:
  // The transport is injected for the same reason SearxngClient injects it: a
  // fail-closed path that cannot be exercised deterministically is a path nobody
  // has checked.
  RemotePlanner(std::shared_ptr<forge::retrieval::HttpTransport> transport,
                Endpoint endpoint);

  forge::ui::PlanResponse plan(const forge::ui::PlanRequest& request) override;

  // Why the LAST call failed, for the panel to show. Empty after a success.
  const std::string& lastError() const noexcept { return last_error_; }

 private:
  std::shared_ptr<forge::retrieval::HttpTransport> transport_;
  Endpoint endpoint_;
  std::string last_error_;
};

// Exposed for the gate: the request body this planner would send, and the plan it
// would read out of a reply. A wire format that can only be checked by standing up
// a model is a wire format nobody checks.
std::string requestBody(const forge::ui::PlanRequest& request);
bool parseReply(const std::string& body, forge::ui::Plan& out, std::string& error);

}  // namespace forge::archie
