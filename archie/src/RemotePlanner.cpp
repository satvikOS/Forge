#include "forge/archie/RemotePlanner.hpp"

#include <cmath>
#include <utility>

#include "forge/retrieval/Json.hpp"

namespace forge::archie {

using forge::ui::ParamSpec;
using forge::ui::ParamType;
using forge::ui::Plan;
using forge::ui::PlanArg;
using forge::ui::PlanRequest;
using forge::ui::PlanResponse;
using forge::ui::PlanSelect;
using forge::ui::PlanStep;
using forge::ui::PlanTool;

namespace json = forge::retrieval::json;

namespace {

// escape() returns the literal WITH its quotes, so this must not add its own.
std::string jstr(const std::string& raw) { return json::escape(raw); }

std::string jnum(double v) {
  // A NaN or an infinity is not JSON. No declared default is either, but a body
  // that fails to parse on the far side is a failure nobody would trace here.
  if (!std::isfinite(v)) v = 0.0;
  return json::Value::makeNumber(v).dump();
}

const char* typeName(ParamType t) {
  switch (t) {
    case ParamType::Number: return "number";
    case ParamType::Text:   return "text";
    case ParamType::Flag:   return "flag";
  }
  return "number";
}

std::string schemaJson(const std::vector<ParamSpec>& schema) {
  std::string out = "[";
  for (std::size_t i = 0; i < schema.size(); ++i) {
    const ParamSpec& p = schema[i];
    if (i != 0) out += ",";
    out += "{\"name\":" + jstr(p.name) + ",\"type\":\"" + typeName(p.type) + "\"" +
           ",\"required\":" + (p.required ? "true" : "false");
    switch (p.type) {
      case ParamType::Number: out += ",\"default\":" + jnum(p.defaultNumber); break;
      case ParamType::Text:   out += ",\"default\":" + jstr(p.defaultText); break;
      case ParamType::Flag:   out += std::string(",\"default\":") +
                                     (p.defaultNumber != 0.0 ? "true" : "false");
                              break;
    }
    out += "}";
  }
  return out + "]";
}

const PlanTool* findTool(const PlanRequest& request, const std::string& id) {
  for (const PlanTool& t : request.tools) {
    if (t.id == id) return &t;
  }
  return nullptr;
}

const ParamSpec* findSpec(const PlanTool* tool, const std::string& name) {
  if (tool == nullptr) return nullptr;
  for (const ParamSpec& s : tool->schema) {
    if (s.name == name) return &s;
  }
  return nullptr;
}

// ── WHAT A STEP WORKS ON, when the reply does not say ────────────────────────
// A feature-IR statement names its inputs as %refs -- `%7 = HOLE(%6, 8, ...)` --
// and the sidecar's bridge drops them, because a PlanStep cannot carry a ref to a
// value an EARLIER step has not created yet. Left at PlanSelect::Keep, every such
// step ran on whatever the user happened to have picked: nothing, and dispatch
// refused the whole plan on a selection mismatch; or something unrelated, and the
// hole went into it.
//
// The command's own selection signature says what KIND of value it consumes, and
// a statement in a tree consumes the newest values of that kind -- the chain the
// IR spelled out. resolveSelection() then takes the NEWEST n, oldest first, which
// is the operand order the two-body booleans are registered with. A reply that
// states `select` itself wins.
PlanSelect inferSelect(const PlanTool* tool) {
  if (tool == nullptr) return PlanSelect::Keep;
  switch (tool->signature.kind) {
    case forge::ui::EntityKind::None:   return PlanSelect::None;
    case forge::ui::EntityKind::Sketch: return PlanSelect::LatestProfile;
    case forge::ui::EntityKind::Wire:   return PlanSelect::LatestWire;
    default:                            return PlanSelect::LatestSolid;
  }
}

bool selectFromText(const std::string& text, PlanSelect& out) {
  if (text == "keep") { out = PlanSelect::Keep; return true; }
  if (text == "none") { out = PlanSelect::None; return true; }
  if (text == "latest_profile") { out = PlanSelect::LatestProfile; return true; }
  if (text == "latest_solid") { out = PlanSelect::LatestSolid; return true; }
  if (text == "latest_wire") { out = PlanSelect::LatestWire; return true; }
  return false;
}

}  // namespace

// The request carries the app's OWN tool list WITH ITS SCHEMAS, so the model is
// TOLD the vocabulary it must conform to rather than trusted to remember one, and
// the sidecar can put a statement's values under the parameter names this app
// declares. Field names are serve.py's: id, text, tools, image.
std::string requestBody(const PlanRequest& request) {
  std::string tools;
  for (std::size_t i = 0; i < request.tools.size(); ++i) {
    const PlanTool& t = request.tools[i];
    if (i != 0) tools += ",";
    tools += "{\"id\":" + jstr(t.id) + ",\"label\":" + jstr(t.label) +
             ",\"featureIrOp\":" + jstr(t.featureIrOp) + ",\"schema\":" + schemaJson(t.schema) +
             "}";
  }
  // The panel's text is `intent`; selection and document summaries give the model
  // the state it is planning against, which a bare instruction does not carry.
  std::string text = request.intent;
  if (!request.selectionSummary.empty()) text += "\nSelection: " + request.selectionSummary;
  if (!request.documentSummary.empty()) text += "\nDocument: " + request.documentSummary;
  // "image" is a PATH, read by the sidecar on this same machine (serve.py checks
  // os.path.isfile). Omitted entirely when there is none: serve.py refuses a
  // request naming an image that does not exist, and "" is not a file.
  std::string image;
  if (!request.imagePath.empty()) image = ",\"image\":" + jstr(request.imagePath);
  return "{\"id\":" + std::to_string(request.id) + ",\"text\":" + jstr(text) + ",\"tools\":[" +
         tools + "]" + image + "}";
}

// serve.py's /plan reply: {"id", "ok", "plan"} or {"id", "ok":false, "error"}.
// Anything else is a malformed reply and is reported as one rather than being
// coerced into an empty plan -- a silent empty plan is the lie
// PlanResponse::error exists to prevent.
bool parseReply(const std::string& body, const PlanRequest& request, Plan& out,
                std::string& error) {
  json::Value root;
  std::string perr;
  if (!json::parse(body, root, perr)) {
    error = "the model service's reply is not JSON: " + perr;
    return false;
  }
  if (!root.isObject()) {
    error = "the model service's reply is not a JSON object";
    return false;
  }

  // THE REPLY MUST BE FOR THIS REQUEST. serve.py echoes the id it was sent. A
  // reply carrying a different one answers some other ask -- a retried request,
  // a second window -- and a plan made for a different sentence is a wrong part.
  if (root.has("id")) {
    const json::Value& id = root.at("id");
    const std::string want = std::to_string(request.id);
    const bool same = (id.isNumber() && id.number(-1.0) == static_cast<double>(request.id)) ||
                      (id.isString() && id.str() == want);
    if (!same) {
      error = "the model service answered a different request (id " +
              (id.isString() ? id.str() : id.dump()) + ", expected " + want + ")";
      return false;
    }
  }

  if (!root.at("ok").boolean(false)) {
    error = root.stringField("error", "the model declined without saying why");
    return false;
  }
  const json::Value& plan = root.at("plan");
  const json::Value& steps = plan.at("steps");
  if (!steps.isArray() || steps.items().empty()) {
    error = "the model returned a plan with no steps";
    return false;
  }

  out.intent = plan.stringField("intent", request.intent);
  out.summary = plan.stringField("summary", "");
  out.steps.clear();
  for (const json::Value& s : steps.items()) {
    PlanStep step;
    step.commandId = s.stringField("commandId", "");
    step.irOp = s.stringField("irOp", "");
    step.note = s.stringField("note", "");
    if (step.commandId.empty()) {
      error = "the model returned a step with no commandId";
      return false;
    }
    const PlanTool* tool = findTool(request, step.commandId);

    step.select = inferSelect(tool);
    if (s.has("select")) {
      if (!selectFromText(s.stringField("select", ""), step.select)) {
        error = "the model returned a step with an unknown select \"" +
                s.stringField("select", "") + "\"";
        return false;
      }
    }
    const double count = s.numberField("selectCount", 0.0);
    if (count >= 1.0 && count < 1.0e6) step.selectCount = static_cast<std::size_t>(count);

    const json::Value& args = s.at("args");
    if (args.isArray()) {
      for (const json::Value& arg : args.items()) {
        const std::string name = arg.stringField("name", "");
        if (name.empty()) continue;
        const json::Value& num = arg.at("number");
        const json::Value& flag = arg.at("flag");
        const ParamSpec* spec = findSpec(tool, name);
        // The TYPE is the schema's, where the value converts without inventing
        // anything: a number stated for a flag is 0 or not-0, and a flag is a
        // flag. A number for a TEXT parameter is left a number, and validatePlan
        // refuses it by name -- guessing a spelling for it here would be the
        // client choosing a value the model did not state.
        if (flag.kind() == json::Kind::Bool) {
          step.args.push_back(PlanArg::on(name, flag.boolean(false)));
        } else if (num.isNumber()) {
          if (spec != nullptr && spec->type == ParamType::Flag) {
            step.args.push_back(PlanArg::on(name, num.number(0.0) != 0.0));
          } else {
            step.args.push_back(PlanArg::num(name, num.number(0.0)));
          }
        } else {
          step.args.push_back(PlanArg::str(name, arg.stringField("text", "")));
        }
      }
    }
    out.steps.push_back(std::move(step));
  }
  return true;
}

Health parseHealth(const std::string& body) {
  Health h;
  json::Value root;
  std::string perr;
  if (!json::parse(body, root, perr) || !root.isObject()) {
    h.detail = "the health reply is not a JSON object";
    return h;
  }
  h.reachable = true;
  h.loaded = root.at("ok").boolean(false) && root.at("loaded").boolean(false);
  h.model = root.stringField("model", "");
  h.adapter = root.stringField("adapter", "");
  h.loadError = root.stringField("load_error", "");
  h.detail = h.loaded ? "loaded" : (h.loadError.empty() ? "not loaded yet" : h.loadError);
  return h;
}

Health probeHealth(forge::retrieval::HttpTransport& transport, const Endpoint& endpoint) {
  forge::retrieval::HttpRequest http;
  http.method = "GET";
  http.path = endpoint.healthPath;
  http.host = endpoint.host;
  http.port = endpoint.port;
  const forge::retrieval::HttpResponse reply = transport.send(http, endpoint.health_timeout_ms);
  if (reply.status != forge::retrieval::TransportStatus::Ok) {
    Health h;
    h.detail = std::string("health probe: ") +
               forge::retrieval::transportStatusName(reply.status) +
               (reply.detail.empty() ? "" : " (" + reply.detail + ")");
    return h;
  }
  if (reply.status_code != 200) {
    Health h;
    h.detail = "health probe answered HTTP " + std::to_string(reply.status_code);
    return h;
  }
  return parseHealth(reply.body);
}

RemotePlanner::RemotePlanner(std::shared_ptr<forge::retrieval::HttpTransport> transport,
                             Endpoint endpoint)
    : transport_(std::move(transport)), endpoint_(std::move(endpoint)) {}

PlanResponse RemotePlanner::plan(const PlanRequest& request) {
  PlanResponse response;
  response.id = request.id;
  response.ok = false;
  last_error_.clear();
  last_transport_failed_ = false;

  if (!transport_) {
    last_error_ = "no transport";
    last_transport_failed_ = true;
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

  const forge::retrieval::HttpResponse reply = transport_->send(http, endpoint_.timeout_ms);

  // EVERY FAILURE NAMES ITSELF. "Archie is unavailable" with no cause is how a
  // sidecar that is merely not running gets mistaken for a model that is broken.
  if (reply.status != forge::retrieval::TransportStatus::Ok) {
    last_error_ = std::string("sidecar unreachable: ") +
                  forge::retrieval::transportStatusName(reply.status);
    if (!reply.detail.empty()) last_error_ += " (" + reply.detail + ")";
    last_transport_failed_ = true;
    response.error = last_error_;
    return response;
  }
  if (reply.status_code != 200) {
    // serve.py answers 400 for a body it cannot read and 404 for a path it does
    // not serve, each with {"ok":false,"error"}; carry that sentence when present.
    last_error_ = "sidecar answered HTTP " + std::to_string(reply.status_code);
    json::Value root;
    std::string perr;
    if (json::parse(reply.body, root, perr) && root.isObject() && root.has("error")) {
      last_error_ += ": " + root.stringField("error", "");
    }
    response.error = last_error_;
    return response;
  }

  Plan plan;
  std::string why;
  if (!parseReply(reply.body, request, plan, why)) {
    last_error_ = why;
    response.error = last_error_;
    return response;
  }

  response.ok = true;
  response.plan = std::move(plan);
  return response;
}

}  // namespace forge::archie
