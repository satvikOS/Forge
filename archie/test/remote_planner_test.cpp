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

  // ── THE SELECTION FIELDS, which were being SILENTLY DROPPED ──────────────
  // THIS BLOCK IS THE FALSIFIER. Against the code before this change every
  // check in it FAILS, because parseReply read neither "select" nor
  // "selectCount" -- `grep -c selectCount archie/src/RemotePlanner.cpp` was 0 --
  // so every step the sidecar produced reached applyPlan as the default
  // PlanSelect::Keep. applyPlan's whole selection branch is
  // `if (step.select != PlanSelect::Keep)`, so it never ran: the step dispatched
  // against whatever the user had picked in the viewport, on a document the plan
  // had just changed. Not a refusal, not a crash -- the wrong body, quietly.
  //
  // Which is why unlocking a value kind at the bridge is not the unlock. This is.
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody(
        "{\"ok\":true,\"plan\":{\"steps\":["
        "{\"commandId\":\"part.extract_faces\",\"irOp\":\"FACES\",\"select\":\"LatestSolid\","
        "\"selectCount\":1,\"args\":[{\"name\":\"selector\",\"text\":\"ALL\"}]},"
        "{\"commandId\":\"part.thicken\",\"irOp\":\"THICKEN\",\"select\":\"LatestSurface\","
        "\"selectCount\":1,\"args\":[{\"name\":\"wall\",\"number\":2}]}]}}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a reply carrying select/selectCount is accepted", r.ok, r.error);
    ck("  ...the first step's select survives the wire",
       r.plan.steps.size() == 2 && r.plan.steps[0].select == forge::ui::PlanSelect::LatestSolid,
       r.plan.steps.empty() ? "no steps"
                            : forge::ui::planSelectName(r.plan.steps[0].select));
    ck("  ...and its count, so an open-ended signature is not silently minimised",
       r.plan.steps.size() == 2 && r.plan.steps[0].selectCount == 1);
    // The reason this whole task exists: a SHEET named by a plan.
    ck("  ...and LatestSurface parses, so the surface lane reaches applyPlan",
       r.plan.steps.size() == 2 && r.plan.steps[1].select == forge::ui::PlanSelect::LatestSurface,
       r.plan.steps.size() < 2 ? "no second step"
                               : forge::ui::planSelectName(r.plan.steps[1].select));
  }
  {
    // A step that says nothing keeps today's answer EXACTLY. This is the
    // behaviour-preservation check for the three kinds that already worked: a
    // reply with no `select` field must still arrive as Keep, so nothing that
    // was passing before this change can be changed by it.
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"ok\":true,\"plan\":{\"steps\":[{\"commandId\":\"part.box\","
                         "\"irOp\":\"BOX\",\"args\":[{\"name\":\"dx\",\"number\":40}]}]}}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a step with no select field is still Keep, unchanged",
       r.ok && r.plan.steps.size() == 1 &&
           r.plan.steps[0].select == forge::ui::PlanSelect::Keep &&
           r.plan.steps[0].selectCount == 0, r.error);
  }
  {
    // AN UNKNOWN SPELLING IS A REFUSAL, NOT A FALLBACK. Coercing it to Keep is
    // the defect above wearing a default's clothes: a newer sidecar naming a
    // kind this build does not have would run every such step against the live
    // viewport selection instead of saying so.
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"ok\":true,\"plan\":{\"steps\":[{\"commandId\":\"part.box\","
                         "\"irOp\":\"BOX\",\"select\":\"LatestDatum\"}]}}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a select spelling this build does not know is refused, never coerced to Keep",
       !r.ok && r.error.find("LatestDatum") != std::string::npos, r.error);
  }
  {
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"ok\":true,\"plan\":{\"steps\":[{\"commandId\":\"part.box\","
                         "\"irOp\":\"BOX\",\"selectCount\":\"two\"}]}}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a selectCount that is not a count is refused", !r.ok && !r.error.empty(), r.error);
  }
  {
    // THE FLAG ARGUMENT, also dropped. ir_bridge.arg_json emits
    // {"name":..,"flag":true} for a Bool parameter and the old `else` turned it
    // into a Text arg holding "" -- a declared-Bool parameter arriving as an
    // empty string.
    auto fake = std::make_shared<FakeTransport>();
    fake->reply = okBody("{\"ok\":true,\"plan\":{\"steps\":[{\"commandId\":\"part.loft\","
                         "\"irOp\":\"LOFT\",\"args\":[{\"name\":\"ruled\",\"flag\":true}]}]}}");
    forge::archie::RemotePlanner p(fake, {});
    const forge::ui::PlanResponse r = p.plan(makeRequest());
    ck("a flag argument arrives as a flag, not as empty text",
       r.ok && r.plan.steps.size() == 1 && r.plan.steps[0].args.size() == 1 &&
           r.plan.steps[0].args[0].type == forge::ui::ParamType::Flag &&
           r.plan.steps[0].args[0].flag, r.error);
  }
  {
    // THE PROTOCOL HAS ONE OWNER, and this is what keeps it that way: every
    // value the enum holds must round-trip through its wire spelling. A value
    // appended to PlanSelect without a planSelectName arm fails here rather
    // than degrading to Keep in the field.
    std::size_t roundTripped = 0;
    for (const forge::ui::PlanSelect v :
         {forge::ui::PlanSelect::Keep, forge::ui::PlanSelect::None,
          forge::ui::PlanSelect::LatestProfile, forge::ui::PlanSelect::LatestSolid,
          forge::ui::PlanSelect::LatestWire, forge::ui::PlanSelect::LatestSurface}) {
      forge::ui::PlanSelect back = forge::ui::PlanSelect::Keep;
      if (forge::ui::planSelectFromName(forge::ui::planSelectName(v), back) && back == v) {
        ++roundTripped;
      }
    }
    ck("every PlanSelect round-trips through its wire spelling", roundTripped == 6,
       std::to_string(roundTripped) + " of 6");
    forge::ui::PlanSelect ignored = forge::ui::PlanSelect::LatestSolid;
    ck("  ...and an unknown spelling leaves the caller's value untouched",
       !forge::ui::planSelectFromName("nonsense", ignored) &&
           ignored == forge::ui::PlanSelect::LatestSolid);
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
