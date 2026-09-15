// Gate for forge::archie::RemotePlanner and ArchieLink.
//
// Two halves, deliberately:
//   * a FAKE transport for every failure path -- a planner whose failure paths
//     can only be exercised by stopping a 30B model is a planner whose failure
//     paths nobody exercises;
//   * a REAL loopback socket (LoopbackSidecarStub) for the wire itself -- the
//     fake alone is how the client came to POST a path, a body shape and a tool
//     list the sidecar did not read, with every check here green.
// The whole app path -- panel, validators, kernel -- is
// forge_desktop_archie_model_gate's subject; this one needs no kernel.
#include "forge/archie/ArchieLink.hpp"
#include "forge/archie/RemotePlanner.hpp"
#include "forge/retrieval/Json.hpp"

#include "LoopbackSidecarStub.hpp"

#include <chrono>
#include <cstdio>
#include <functional>
#include <memory>
#include <string>
#include <thread>

namespace {

int checks = 0, failures = 0;

void ck(const char* what, bool ok, const std::string& detail = {}) {
  ++checks;
  if (ok) { std::printf("  ok   %s\n", what); return; }
  ++failures;
  std::printf("  FAIL %s%s%s\n", what, detail.empty() ? "" : " -> ", detail.c_str());
}

using forge::retrieval::HttpRequest;
using forge::retrieval::HttpResponse;
using forge::retrieval::HttpTransport;
using forge::retrieval::TransportStatus;

// Replays a scripted reply and records what it was asked to send.
class FakeTransport final : public HttpTransport {
 public:
  HttpResponse reply;
  HttpRequest seen;
  std::uint32_t last_timeout_ms = 0;

  HttpResponse send(const HttpRequest& request, std::uint32_t timeout_ms) override {
    seen = request;
    last_timeout_ms = timeout_ms;
    return reply;
  }
};

HttpResponse okBody(const std::string& body) {
  HttpResponse r;
  r.status = TransportStatus::Ok;
  r.status_code = 200;
  r.body = body;
  return r;
}

forge::ui::PlanRequest makeRequest() {
  forge::ui::PlanRequest rq;
  rq.id = 7;
  rq.intent = "make a plate";
  rq.selectionSummary = "nothing selected";
  forge::ui::PlanTool box;
  box.id = "part.primitive_box"; box.label = "Box"; box.featureIrOp = "BOX";
  box.schema.push_back(forge::ui::ParamSpec{"dx", forge::ui::ParamType::Number, true, 10.0, ""});
  box.signature = forge::ui::SelectionSignature::none();
  rq.tools.push_back(box);
  forge::ui::PlanTool fillet;
  fillet.id = "part.fillet"; fillet.label = "Edge Fillet"; fillet.featureIrOp = "FILLET";
  fillet.schema.push_back(
      forge::ui::ParamSpec{"radius", forge::ui::ParamType::Number, true, 1.0, ""});
  fillet.schema.push_back(
      forge::ui::ParamSpec{"selector", forge::ui::ParamType::Text, false, 0.0, "ALL"});
  fillet.schema.push_back(forge::ui::ParamSpec{"smooth", forge::ui::ParamType::Flag, false, 0.0, ""});
  fillet.signature = forge::ui::SelectionSignature::atLeast(forge::ui::EntityKind::Edge, 1);
  rq.tools.push_back(fillet);
  return rq;
}

const char* kGoodPlan =
    "{\"id\":7,\"ok\":true,\"plan\":{\"intent\":\"i\",\"summary\":\"s\",\"steps\":["
    "{\"commandId\":\"part.primitive_box\",\"irOp\":\"BOX\",\"args\":[{\"name\":\"dx\",\"number\":40}]},"
    "{\"commandId\":\"part.fillet\",\"irOp\":\"FILLET\",\"args\":[{\"name\":\"radius\",\"number\":2},"
    "{\"name\":\"smooth\",\"number\":1}]}]}}";

bool waitFor(const std::function<bool()>& cond, int ms) {
  const auto t0 = std::chrono::steady_clock::now();
  while (!cond()) {
    if (std::chrono::steady_clock::now() - t0 > std::chrono::milliseconds(ms)) return false;
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  return true;
}

}  // namespace

int main() {
  std::printf("== Archie RemotePlanner + ArchieLink ==\n");

  // ── the request body: serve.py's /plan fields ─────────────────────────────
  {
    const std::string body = forge::archie::requestBody(makeRequest());
    forge::retrieval::json::Value v;
    std::string perr;
    ck("the request body is JSON", forge::retrieval::json::parse(body, v, perr), perr);
    ck("  ...with the request id serve.py echoes", v.at("id").number(0) == 7.0, body.substr(0, 80));
    ck("  ...the typed words as `text`, with the selection summary",
       v.stringField("text", "").find("make a plate") == 0 &&
           v.stringField("text", "").find("nothing selected") != std::string::npos);
    ck("  ...the tool list, with each feature-IR op",
       v.at("tools").items().size() == 2 &&
           v.at("tools").items()[1].stringField("featureIrOp", "") == "FILLET");
    const auto& schema = v.at("tools").items()[1].at("schema").items();
    ck("  ...and each tool's SCHEMA, names in declared order, so ir_bridge can name values",
       schema.size() == 3 && schema[0].stringField("name", "") == "radius" &&
           schema[1].stringField("name", "") == "selector" &&
           schema[0].stringField("type", "") == "number" &&
           schema[0].at("required").boolean(false) &&
           schema[1].stringField("default", "") == "ALL",
       body);
    ck("  ...and NO image key when there is no image", !v.has("image"), body);

    forge::ui::PlanRequest withImage = makeRequest();
    withImage.imagePath = "/tmp/forge frame \"1\".png";   // spaces AND a quote
    const std::string ibody = forge::archie::requestBody(withImage);
    forge::retrieval::json::Value iv;
    ck("an image path is carried, JSON-escaped",
       forge::retrieval::json::parse(ibody, iv, perr) &&
           iv.stringField("image", "") == withImage.imagePath,
       ibody.substr(ibody.size() > 80 ? ibody.size() - 80 : 0));
  }

  // ── a good reply ──────────────────────────────────────────────────────────
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody(kGoodPlan);
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a typed plan is accepted", r.ok, r.error);
    ck("  ...the reply carries the request id back", r.id == 7);
    ck("  ...it POSTs /plan, the sidecar's plan contract", fake->seen.path == "/plan",
       fake->seen.path);
    ck("  ...on 127.0.0.1:8731", fake->seen.host == "127.0.0.1" && fake->seen.port == 8731);
    ck("  ...the budget is not the 8 s the retrieval client uses",
       fake->last_timeout_ms >= 120000, std::to_string(fake->last_timeout_ms));
    ck("  ...the command ids survive", r.plan.steps.size() == 2 &&
                                       r.plan.steps[0].commandId == "part.primitive_box");
    ck("  ...with typed arguments", r.plan.steps.size() == 2 &&
                                   r.plan.steps[0].args.size() == 1 &&
                                   r.plan.steps[0].args[0].number == 40.0);
    ck("  ...a number stated for a FLAG parameter becomes the flag",
       r.plan.steps.size() == 2 && r.plan.steps[1].args.size() == 2 &&
           r.plan.steps[1].args[1].type == forge::ui::ParamType::Flag &&
           r.plan.steps[1].args[1].flag);
    ck("  ...a step whose command needs nothing picked clears the selection",
       r.plan.steps.size() == 2 && r.plan.steps[0].select == forge::ui::PlanSelect::None);
    ck("  ...a step on an edge-consuming command works on the newest solid",
       r.plan.steps.size() == 2 && r.plan.steps[1].select == forge::ui::PlanSelect::LatestSolid);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"id\":7,\"ok\":true,\"plan\":{\"steps\":[{\"commandId\":\"part.fillet\","
                         "\"select\":\"keep\",\"args\":[]}]}}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a reply that STATES select wins over the inference",
       r.ok && r.plan.steps[0].select == forge::ui::PlanSelect::Keep, r.error);
  }

  // ── every failure names itself ────────────────────────────────────────────
  struct Case { TransportStatus st; const char* what; };
  for (const Case& c : {Case{TransportStatus::ConnectFailed, "sidecar not listening"},
                        Case{TransportStatus::Timeout, "sidecar too slow"},
                        Case{TransportStatus::RefusedNonLoopback, "non-loopback refused"}}) {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply.status = c.st;
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck(c.what, !r.ok && r.error.find("unreachable") != std::string::npos &&
                   p.lastTransportFailed(), r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"ok\": false, \"error\": \"body is not JSON\"}");
    fake->reply.status_code = 400;
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a non-200 is refused, states the code and carries serve.py's sentence",
       !r.ok && r.error.find("400") != std::string::npos &&
           r.error.find("body is not JSON") != std::string::npos && !p.lastTransportFailed(),
       r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"id\":7,\"ok\":false,\"error\":\"model not loaded yet\"}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a sidecar refusal is passed through verbatim, and is NOT a transport failure",
       !r.ok && r.error == "model not loaded yet" && !p.lastTransportFailed(), r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody(std::string(kGoodPlan).replace(6, 1, "8"));
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a reply for a DIFFERENT request id is refused", !r.ok &&
       r.error.find("different request") != std::string::npos, r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"id\":7,\"ok\":true,\"plan\":{\"steps\":[]}}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("an EMPTY plan is refused, never returned as success", !r.ok && !r.error.empty(), r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"id\":7,\"ok\":true,\"plan\":{\"steps\":[{\"irOp\":\"BOX\"}]}}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a step with no commandId is refused",
       !r.ok && r.error.find("commandId") != std::string::npos, r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"id\":7,\"ok\":true,\"plan\":{\"steps\":[{\"commandId\":\"part.fillet\","
                         "\"select\":\"whatever\"}]}}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("an unknown select is refused, not guessed", !r.ok, r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("this is not json");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a non-JSON reply is refused", !r.ok && !r.error.empty(), r.error);
  }
  {
    forge::archie::RemotePlanner p(nullptr, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("no transport is a refusal, not a crash", !r.ok && !r.error.empty(), r.error);
  }

  // ── /health ───────────────────────────────────────────────────────────────
  {
    const forge::archie::Health h = forge::archie::parseHealth(
        "{\"ok\": true, \"model\": \"m\", \"adapter\": null, \"loaded\": true, \"load_error\": null}");
    ck("a loaded health reply reads as loaded", h.reachable && h.loaded && h.model == "m");
    const forge::archie::Health l = forge::archie::parseHealth(
        "{\"ok\": true, \"model\": null, \"adapter\": null, \"loaded\": false, "
        "\"load_error\": \"adapter refused before load: x\"}");
    ck("a service that failed to load says why, and is not loaded",
       l.reachable && !l.loaded && l.loadError.find("refused") != std::string::npos);
    ck("a non-JSON health reply is not a model service",
       !forge::archie::parseHealth("<html>").reachable);
  }

  // ── the environment override ──────────────────────────────────────────────
  {
    ck("unset: look on 127.0.0.1:8731", !forge::archie::configFromEnvironment(nullptr).off);
    ck("off: never look", forge::archie::configFromEnvironment("off").off);
    ck("a remote host is refused", forge::archie::configFromEnvironment("192.168.1.2:8731").off);
    ck("a name is refused (a resolver is a way off the machine)",
       forge::archie::configFromEnvironment("localhost:8731").off);
    const forge::archie::LinkConfig c = forge::archie::configFromEnvironment("127.0.0.1:9001");
    ck("a loopback override is used", !c.off && c.endpoint.port == 9001, c.why);
  }

  // ── THE WIRE: a real socket, a real server ────────────────────────────────
  {
    forge::archie::test::LoopbackSidecarStub stub;
    std::string why;
    ck("the loopback stub sidecar is listening", stub.start(0, why), why);
    stub.setLoaded(true);
    stub.setPlanReply("{\"ok\":true,\"plan\":{\"intent\":\"i\",\"summary\":\"s\",\"steps\":["
                      "{\"commandId\":\"part.fillet\",\"irOp\":\"FILLET\","
                      "\"args\":[{\"name\":\"radius\",\"number\":2}]}]}}");
    stub.setPlanDelayMs(300);

    forge::archie::LinkConfig cfg = forge::archie::configFromEnvironment(nullptr);
    cfg.endpoint.port = stub.port();
    cfg.probeEveryMs = 50;
    cfg.recheckEveryMs = 100;
    forge::archie::ArchieLink link(cfg);
    ck("the link discovers the model over GET /health",
       waitFor([&] { return link.state() == forge::ui::ModelState::Ready; }, 5000),
       forge::ui::machineName(link.state()));

    const auto t0 = std::chrono::steady_clock::now();
    const bool started = link.start(makeRequest());
    const double startMs = std::chrono::duration<double, std::milli>(
                               std::chrono::steady_clock::now() - t0).count();
    ck("start() returns without waiting for the model", started && startMs < 100.0,
       std::to_string(startMs) + " ms");
    ck("  ...and a second start while one is in flight is refused", !link.start(makeRequest()));
    forge::ui::PlanResponse out;
    bool failed = true;
    ck("poll() hands the answer back once it is in",
       waitFor([&] { return link.poll(out, failed); }, 10000));
    ck("  ...a plan, parsed from the bytes a real socket carried",
       out.ok && !failed && out.plan.steps.size() == 1 &&
           out.plan.steps[0].args[0].number == 2.0, out.error);
    const std::string body = stub.lastPlanBody();
    ck("the server received the schema-carrying body",
       body.find("\"schema\":[{\"name\":\"radius\"") != std::string::npos, body.substr(0, 160));

    const std::uint16_t port = stub.port();
    stub.stop();
    ck("a stopped service is noticed by the prober",
       waitFor([&] { return link.state() == forge::ui::ModelState::NotRunning; }, 3000),
       forge::ui::machineName(link.state()));
    ck("  ...and nothing is started against it", !link.start(makeRequest()));
    (void)port;
  }
  {
    forge::archie::LinkConfig cfg = forge::archie::configFromEnvironment("off");
    forge::archie::ArchieLink link(cfg);
    ck("a link switched off reports Off and starts nothing",
       link.state() == forge::ui::ModelState::Off && !link.start(makeRequest()));
  }

  std::printf("\n%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
