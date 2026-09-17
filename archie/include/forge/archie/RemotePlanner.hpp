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
//   plan(). LocalPlanner is its only other implementation. Everything downstream
//   -- validatePlan() at two doors, the op-constraint bridge, the registry
//   dispatch, appendFeature's validateIr -- is unchanged and still refuses.
//
// ── THE WIRE CONTRACT IS THE SIDECAR'S /plan, AND NOTHING ELSE ──────────────
// archdisc-Models/tools/archie_sidecar/serve.py documents it:
//
//   POST /plan   {"id", "text", "tools":[{id,label,featureIrOp,schema}], "image"?}
//             -> {"id", "ok":true,  "plan":{intent,summary,steps:[...]}}
//             -> {"id", "ok":false, "error":"..."}
//   GET /health  -> {"ok", "model", "adapter", "loaded", "load_error"}
//
// This client used to POST /v1/chat/completions and read a plan out of the
// assistant message's content, on the argument that LM Studio and Ollama speak
// that dialect. They do -- and what they would put in the content is feature-IR
// TEXT, never the {"ok","plan"} JSON this parser required, so the claimed
// portability did not exist. It also sent every tool WITHOUT its schema, and the
// sidecar's ir_bridge maps an IR statement's literal values onto the schema's
// parameter NAMES: with no schema it had no names, dropped every value, and
// handed back steps with no arguments. Those were refused as missing required
// values at best, and filled from declared defaults at worst -- a hole of the
// default diameter where the model said 8 mm.
#pragma once

#include <cstdint>
#include <memory>
#include <string>

#include "forge/retrieval/HttpTransport.hpp"
#include "forge/ui/ArchieCopilot.hpp"

namespace forge::archie {

struct Endpoint {
  std::string host = "127.0.0.1";   // loopback ONLY; the transport refuses the rest
  std::uint16_t port = 8731;        // serve.py's default --port
  std::string path = "/plan";
  std::string healthPath = "/health";
  // A 30B VLM measured 21.1 s for one generation on this machine and serve.py's
  // own --budget defaults to 120 s. The retrieval client's 8000 ms would time
  // out every real request.
  std::uint32_t timeout_ms = 150000;
  // /health answers from a dict in memory. A port that takes longer than this to
  // accept and answer is not a model service this app can talk to.
  std::uint32_t health_timeout_ms = 1000;
};

class RemotePlanner final : public forge::ui::Planner {
 public:
  // The transport is injected for the same reason SearxngClient injects it: a
  // fail-closed path that cannot be exercised deterministically is a path nobody
  // has checked.
  RemotePlanner(std::shared_ptr<forge::retrieval::HttpTransport> transport,
                Endpoint endpoint);

  forge::ui::PlanResponse plan(const forge::ui::PlanRequest& request) override;

  // Why the LAST call failed. Empty after a success.
  const std::string& lastError() const noexcept { return last_error_; }
  // True when the last call never reached a model service at all (not
  // listening, timed out, refused). A model that ANSWERED with a refusal is not
  // this: that is Archie saying no, and it must be shown as Archie's answer
  // rather than papered over with the built-in commands.
  bool lastTransportFailed() const noexcept { return last_transport_failed_; }

 private:
  std::shared_ptr<forge::retrieval::HttpTransport> transport_;
  Endpoint endpoint_;
  std::string last_error_;
  bool last_transport_failed_ = false;
};

// ── what GET /health said ───────────────────────────────────────────────────
struct Health {
  bool reachable = false;   // something answered HTTP 200 with a JSON object
  bool loaded = false;      // ...and said its model is loaded
  std::string model;        // the model PATH the service loaded
  std::string adapter;      // the adapter path, or empty for a fused/base model
  std::string loadError;    // why the service could not load its model
  std::string detail;       // why this probe decided what it decided (logs only)
};

Health probeHealth(forge::retrieval::HttpTransport& transport, const Endpoint& endpoint);

// Exposed for the gate: the request body this planner sends, the plan it reads
// out of a reply, and the health reading. A wire format that can only be checked
// by standing up a model is a wire format nobody checks.
std::string requestBody(const forge::ui::PlanRequest& request);
bool parseReply(const std::string& body, const forge::ui::PlanRequest& request,
                forge::ui::Plan& out, std::string& error);
Health parseHealth(const std::string& body);

}  // namespace forge::archie
