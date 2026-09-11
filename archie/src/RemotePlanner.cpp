#include "forge/archie/RemotePlanner.hpp"

#include <utility>

#include "forge/retrieval/Json.hpp"

namespace forge::archie {

using forge::ui::Plan;
using forge::ui::PlanArg;
using forge::ui::PlanRequest;
using forge::ui::PlanResponse;
using forge::ui::PlanStep;
using forge::ui::PlanTool;

namespace {

// escape() returns the literal WITH its quotes, so this must not add its own.
std::string jstr(const std::string& raw) {
  return forge::retrieval::json::escape(raw);
}

}  // namespace

// The request carries the app's OWN tool list, so the model is TOLD the vocabulary
// it must conform to rather than trusted to remember one. Without this the sidecar
// cannot map a feature-IR op back to a command id, and a planner that names a
// command the app does not have is refused downstream anyway -- late, and with a
// worse message.
std::string requestBody(const PlanRequest& request) {
  std::string tools;
  for (std::size_t i = 0; i < request.tools.size(); ++i) {
    const PlanTool& t = request.tools[i];
    if (i != 0) tools += ",";
    tools += "{\"id\":" + jstr(t.id) +
             ",\"label\":" + jstr(t.label) +
             ",\"featureIrOp\":" + jstr(t.featureIrOp) + "}";
  }
  // The panel's text is `intent`; selection and document summaries give the model
  // the state it is planning against, which a bare instruction does not carry.
  std::string text = request.intent;
  if (!request.selectionSummary.empty()) text += "\nSelection: " + request.selectionSummary;
  if (!request.documentSummary.empty()) text += "\nDocument: " + request.documentSummary;
  return std::string("{\"messages\":[{\"role\":\"user\",\"content\":") +
         jstr(text) + "}],\"tools\":[" + tools + "]}";
}

// The sidecar answers in the OpenAI shape; the payload we care about is the
// assistant message's content, which is itself a JSON object carrying either a
// typed plan or a reason it refused. Anything else is a malformed reply and is
// reported as one rather than being coerced into an empty plan -- a silent empty
// plan is the lie PlanResponse::error exists to prevent.
bool parseReply(const std::string& body, Plan& out, std::string& error) {
  using forge::retrieval::json::Value;
  Value root;
  std::string perr;
  if (!forge::retrieval::json::parse(body, root, perr)) {
    error = "sidecar reply is not JSON: " + perr; return false;
  }

  const Value& choices = root.at("choices");
  if (!choices.isArray() || choices.items().empty()) {
    error = "sidecar reply carries no choices"; return false;
  }
  const std::string content =
      choices.items().front().at("message").stringField("content", "");
  if (content.empty()) { error = "sidecar reply carries no message content"; return false; }

  Value inner;
  if (!forge::retrieval::json::parse(content, inner, perr)) {
    error = "sidecar content is not JSON: " + perr; return false;
  }

  if (!inner.at("ok").boolean(false)) {
    error = inner.stringField("error", "sidecar refused without saying why");
    return false;
  }
  const Value& plan = inner.at("plan");
  const Value& steps = plan.at("steps");
  if (!steps.isArray() || steps.items().empty()) {
    error = "sidecar returned a plan with no steps"; return false;
  }

  out.intent = plan.stringField("intent", "");
  out.summary = plan.stringField("summary", "");
  out.steps.clear();
  for (const Value& s : steps.items()) {
    PlanStep step;
    step.commandId = s.stringField("commandId", "");
    step.irOp = s.stringField("irOp", "");
    if (step.commandId.empty()) {
      error = "sidecar returned a step with no commandId"; return false;
    }
    const Value& args = s.at("args");
    if (args.isArray()) {
      for (const Value& arg : args.items()) {
        const std::string name = arg.stringField("name", "");
        if (name.empty()) continue;
        const Value& num = arg.at("number");
        if (num.isNumber()) {
          step.args.push_back(PlanArg::num(name, num.number(0.0)));
        } else {
          step.args.push_back(PlanArg::str(name, arg.stringField("text", "")));
        }
      }
    }
    out.steps.push_back(std::move(step));
  }
  return true;
}

RemotePlanner::RemotePlanner(
    std::shared_ptr<forge::retrieval::HttpTransport> transport, Endpoint endpoint)
    : transport_(std::move(transport)), endpoint_(std::move(endpoint)) {}

PlanResponse RemotePlanner::plan(const PlanRequest& request) {
  PlanResponse response;
  response.id = request.id;
  response.ok = false;
  last_error_.clear();

  if (!transport_) {
    last_error_ = "no transport";
    response.error = last_error_;
    return response;
  }

  forge::retrieval::HttpRequest http;
  http.method = "POST";
  http.path = endpoint_.path;
  http.host = endpoint_.host;
  http.port = endpoint_.port;
  http.headers["Content-Type"] = "application/json";
  http.body = requestBody(request);

  const forge::retrieval::HttpResponse reply =
      transport_->send(http, endpoint_.timeout_ms);

  // EVERY FAILURE NAMES ITSELF. "Archie is unavailable" with no cause is how a
  // sidecar that is merely not running gets mistaken for a model that is broken.
  if (reply.status != forge::retrieval::TransportStatus::Ok) {
    last_error_ = std::string("sidecar unreachable: ") +
                  forge::retrieval::transportStatusName(reply.status);
    if (!reply.detail.empty()) last_error_ += " (" + reply.detail + ")";
    response.error = last_error_;
    return response;
  }
  if (reply.status_code != 200) {
    last_error_ = "sidecar answered HTTP " + std::to_string(reply.status_code);
    response.error = last_error_;
    return response;
  }

  Plan plan;
  std::string why;
  if (!parseReply(reply.body, plan, why)) {
    last_error_ = why;
    response.error = last_error_;
    return response;
  }

  response.ok = true;
  response.plan = std::move(plan);
  return response;
}

}  // namespace forge::archie
