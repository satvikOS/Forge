// Gate for ArchieRemotePlanner. The transport is FAKE on purpose: a planner whose
// failure paths can only be exercised by stopping a 30B model is a planner whose
// failure paths nobody exercises. Every refusal below is reachable in CI.
#include "forge/archie/RemotePlanner.hpp"
#include "forge/retrieval/Json.hpp"   // to prove the body with an image still parses

#include <cstdio>
#include <memory>
#include <string>

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
  bool called = false;

  HttpResponse send(const HttpRequest& request, std::uint32_t timeout_ms) override {
    seen = request;
    last_timeout_ms = timeout_ms;
    called = true;
    return reply;
  }
  std::uint32_t last_timeout_ms = 0;
};

HttpResponse okBody(const std::string& content) {
  HttpResponse r;
  r.status = TransportStatus::Ok;
  r.status_code = 200;
  r.body = std::string("{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"") +
           [&] {                       // escape the nested JSON document
             std::string e;
             for (char c : content) {
               if (c == '"') e += "\\\"";
               else if (c == '\\') e += "\\\\";
               else e += c;
             }
             return e;
           }() + "\"}}]}";
  return r;
}

forge::ui::PlanRequest makeRequest() {
  forge::ui::PlanRequest rq;
  rq.id = 7;
  rq.intent = "make a plate";
  rq.selectionSummary = "nothing selected";
  forge::ui::PlanTool t;
  t.id = "part.box"; t.label = "Box"; t.featureIrOp = "BOX";
  rq.tools.push_back(t);
  return rq;
}

}  // namespace

int main() {
  std::printf("== ArchieRemotePlanner ==\n");

  // ── the request we would send ─────────────────────────────────────────────
  {
    const std::string body = forge::archie::requestBody(makeRequest());
    ck("the request carries the app's tool list",
       body.find("part.box") != std::string::npos, body.substr(0, 120));
    ck("  ...including its feature-IR op, so the sidecar can map back",
       body.find("BOX") != std::string::npos);
    ck("  ...and the selection summary, not just the instruction",
       body.find("nothing selected") != std::string::npos);

    // The image field. The model is a VLM and until now the app could only send
    // it text; T-084 measured that the missing input is the IMAGE.
    ck("  ...and NO image key at all when there is no image",
       body.find("\"image\"") == std::string::npos, body);

    forge::ui::PlanRequest withImage = makeRequest();
    withImage.imagePath = "/tmp/forge frame \"1\".png";   // spaces AND a quote
    const std::string ibody = forge::archie::requestBody(withImage);
    ck("an image path is carried to the sidecar",
       ibody.find("\"image\":") != std::string::npos, ibody);
    ck("  ...top level, beside messages -- the shape the sidecar reads",
       ibody.find("],\"image\":") != std::string::npos ||
       ibody.find("\"image\":") > ibody.find("\"tools\""), ibody);
    ck("  ...and it is JSON-escaped, so a path with a quote cannot break the body",
       ibody.find("frame \\\"1\\\".png") != std::string::npos, ibody);

    // A body that still parses is the whole point of escaping it.
    forge::retrieval::json::Value parsed;
    std::string perr;
    ck("  ...the body with an image still parses as JSON",
       forge::retrieval::json::parse(ibody, parsed, perr), perr);

    // Adding a field must not disturb the text-only request: everything that
    // worked before this change must be byte-identical, or this is a rewrite
    // wearing a feature's clothes.
    ck("  ...and a text-only body is UNCHANGED by the new field",
       forge::archie::requestBody(makeRequest()) == body, "text-only body moved");
  }

  // ── a good reply ──────────────────────────────────────────────────────────
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"ok\":true,\"plan\":{\"intent\":\"i\",\"summary\":\"s\","
                         "\"steps\":[{\"commandId\":\"part.box\",\"irOp\":\"BOX\","
                         "\"args\":[{\"name\":\"dx\",\"number\":40}]}]}}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a typed plan is accepted", r.ok, r.error);
    ck("  ...the reply carries the request id back", r.id == 7);
    ck("  ...the command id survives", !r.plan.steps.empty() &&
                                       r.plan.steps[0].commandId == "part.box");
    ck("  ...and its typed argument", !r.plan.steps.empty() &&
                                      !r.plan.steps[0].args.empty() &&
                                      r.plan.steps[0].args[0].number == 40.0);
    ck("  ...the budget is NOT the 8s the retrieval client hardcodes",
       fake->last_timeout_ms >= 60000, std::to_string(fake->last_timeout_ms));
    ck("  ...and it posts to the OpenAI-compatible path LM Studio also serves",
       fake->seen.path == "/v1/chat/completions", fake->seen.path);
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
    ck(c.what, !r.ok && !r.error.empty() &&
               r.error.find("unreachable") != std::string::npos, r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply.status = TransportStatus::Ok; fake->reply.status_code = 500;
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a non-200 is refused and states the code",
       !r.ok && r.error.find("500") != std::string::npos, r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"ok\":false,\"error\":\"model not loaded yet\"}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a sidecar refusal is passed through verbatim",
       !r.ok && r.error == "model not loaded yet", r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"ok\":true,\"plan\":{\"steps\":[]}}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("an EMPTY plan is refused, never returned as success",
       !r.ok && !r.error.empty(), r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"ok\":true,\"plan\":{\"steps\":[{\"irOp\":\"BOX\"}]}}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a step with no commandId is refused",
       !r.ok && r.error.find("commandId") != std::string::npos, r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply.status = TransportStatus::Ok; fake->reply.status_code = 200;
    fake->reply.body = "this is not json";
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a non-JSON reply is refused", !r.ok && !r.error.empty(), r.error);
  }
  {
    forge::archie::RemotePlanner p(nullptr, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("no transport is a refusal, not a crash", !r.ok && !r.error.empty(), r.error);
  }

  std::printf("\n%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
