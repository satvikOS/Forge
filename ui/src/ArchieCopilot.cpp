#include "forge/ui/ArchieCopilot.hpp"

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

const char* toString(PlanSelect select) noexcept {
  switch (select) {
    case PlanSelect::Keep:          return "keep the live selection";
    case PlanSelect::None:          return "clear the selection";
    case PlanSelect::LatestProfile: return "the newest profile in the document";
    case PlanSelect::LatestSolid:   return "the newest solid in the document";
  }
  return "keep the live selection";
}

const char* toString(TranscriptRole role) noexcept {
  switch (role) {
    case TranscriptRole::User:    return "you";
    case TranscriptRole::Copilot: return "archie";
    case TranscriptRole::System:  return "system";
  }
  return "system";
}

const char* toString(PlanCheck check) noexcept {
  switch (check) {
    case PlanCheck::Ok:                       return "ok";
    case PlanCheck::StaleResponse:            return "stale_response";
    case PlanCheck::PlannerFailed:            return "planner_failed";
    case PlanCheck::EmptyPlan:                return "empty_plan";
    case PlanCheck::UnknownCommand:           return "unknown_command";
    case PlanCheck::OpMismatch:               return "op_mismatch";
    case PlanCheck::UndeclaredParameter:      return "undeclared_parameter";
    case PlanCheck::WrongParameterType:       return "wrong_parameter_type";
    case PlanCheck::MissingRequiredParameter: return "missing_required_parameter";
  }
  return "ok";
}

// ── PlanArg ─────────────────────────────────────────────────────────────────
PlanArg PlanArg::num(std::string name, double value) {
  PlanArg a;
  a.name = std::move(name);
  a.type = ParamType::Number;
  a.number = value;
  return a;
}

PlanArg PlanArg::str(std::string name, std::string value) {
  PlanArg a;
  a.name = std::move(name);
  a.type = ParamType::Text;
  a.text = std::move(value);
  return a;
}

PlanArg PlanArg::on(std::string name, bool value) {
  PlanArg a;
  a.name = std::move(name);
  a.type = ParamType::Flag;
  a.flag = value;
  return a;
}

std::string PlanArg::display() const {
  switch (type) {
    // formatIrNumber, not printf("%g"): the same formatter the emitted IR uses,
    // so a number the panel shows and the number the statement carries cannot
    // read differently.
    case ParamType::Number: return name + "=" + formatIrNumber(number);
    case ParamType::Text:   return name + "=" + text;
    case ParamType::Flag:   return name + "=" + (flag ? "on" : "off");
  }
  return name;
}

// ── PlanStep ────────────────────────────────────────────────────────────────
CommandParams PlanStep::params() const {
  CommandParams p;
  for (const PlanArg& a : args) {
    switch (a.type) {
      case ParamType::Number: p.setNumber(a.name, a.number); break;
      case ParamType::Text:   p.setText(a.name, a.text); break;
      case ParamType::Flag:   p.setFlag(a.name, a.flag); break;
    }
  }
  return p;
}

std::string PlanStep::display() const {
  std::string out = irOp.empty() ? std::string("-") : irOp;
  out += "  ";
  out += commandId;
  out += "(";
  for (std::size_t i = 0; i < args.size(); ++i) {
    if (i > 0) out += ", ";
    out += args[i].display();
  }
  out += ")";
  return out;
}

// ── the tool list handed to a planner ───────────────────────────────────────
std::vector<PlanTool> planTools(const CommandRegistry& registry,
                                const SelectionService& selection) {
  std::vector<PlanTool> out;
  for (const std::string& id : registry.ids()) {
    const CommandDescriptor* d = registry.find(id);
    if (d == nullptr) continue;
    PlanTool t;
    t.id = d->id;
    t.label = d->label;
    t.featureIrOp = d->featureIrOp;
    t.schema = d->schema;
    t.signature = d->signature;
    // The SAME evaluate() the dispatcher uses, so a planner is never told a tool
    // is callable that dispatch would then refuse. Every declared parameter is
    // supplied for the probe: availability here is about the SELECTION and the
    // enabled predicate, and a planner states its arguments itself.
    CommandParams probe;
    for (const ParamSpec& p : d->schema) {
      switch (p.type) {
        case ParamType::Number: probe.setNumber(p.name, p.defaultNumber); break;
        case ParamType::Text:   probe.setText(p.name, p.defaultText); break;
        case ParamType::Flag:   probe.setFlag(p.name, p.defaultNumber != 0.0); break;
      }
    }
    const DispatchResult r = registry.evaluate(id, selection, probe);
    t.callableNow = r.ok();
    t.reason = r.ok() ? std::string() : (std::string(toString(r.status)) +
                                         (r.detail.empty() ? "" : (": " + r.detail)));
    out.push_back(std::move(t));
  }
  return out;
}

namespace {

const PlanTool* findTool(const std::vector<PlanTool>& tools, const std::string& id) {
  for (const PlanTool& t : tools) {
    if (t.id == id) return &t;
  }
  return nullptr;
}

const ParamSpec* findSpec(const std::vector<ParamSpec>& schema, const std::string& name) {
  for (const ParamSpec& s : schema) {
    if (s.name == name) return &s;
  }
  return nullptr;
}

// ── the LocalPlanner's vocabulary ───────────────────────────────────────────
// One row per word this planner will act on. `numeric` names the parameters the
// numbers in the sentence fill, IN ORDER; `absorb` is a following word the verb
// swallows so "circular pattern" does not also fire the bare "pattern" row.
struct Verb {
  const char* word;
  const char* commandId;
  PlanSelect select;
  const char* numeric[4];
  const char* absorb;
};

const Verb kVerbs[] = {
    {"extrude",     "part.extrude",          PlanSelect::LatestProfile, {"distance"},                         nullptr},
    {"pad",         "part.extrude",          PlanSelect::LatestProfile, {"distance"},                         nullptr},
    {"revolve",     "part.revolve",          PlanSelect::LatestProfile, {"angle"},                            nullptr},
    {"loft",        "part.loft",             PlanSelect::LatestProfile, {},                                   nullptr},
    {"fillet",      "part.fillet",           PlanSelect::LatestSolid,   {"radius"},                           nullptr},
    {"round",       "part.fillet",           PlanSelect::LatestSolid,   {"radius"},                           nullptr},
    {"chamfer",     "part.chamfer",          PlanSelect::LatestSolid,   {"distance"},                         nullptr},
    {"bevel",       "part.chamfer",          PlanSelect::LatestSolid,   {"distance"},                         nullptr},
    {"variable",    "part.variable_fillet",  PlanSelect::LatestSolid,   {"radius_start", "radius_end"},       "fillet"},
    {"blend",       "part.variable_fillet",  PlanSelect::LatestSolid,   {"radius_start", "radius_end"},       nullptr},
    {"shell",       "part.shell",            PlanSelect::LatestSolid,   {"thickness"},                        nullptr},
    {"hollow",      "part.shell",            PlanSelect::LatestSolid,   {"thickness"},                        nullptr},
    {"hole",        "part.hole",             PlanSelect::LatestSolid,   {"diameter"},                         nullptr},
    {"drill",       "part.hole",             PlanSelect::LatestSolid,   {"diameter"},                         nullptr},
    {"bore",        "part.hole",             PlanSelect::LatestSolid,   {"diameter"},                         nullptr},
    {"counterbore", "part.counterbore",      PlanSelect::LatestSolid,   {"diameter", "cbore_diameter", "cbore_depth"}, nullptr},
    {"cbore",       "part.counterbore",      PlanSelect::LatestSolid,   {"diameter", "cbore_diameter", "cbore_depth"}, nullptr},
    {"mirror",      "part.mirror",           PlanSelect::LatestSolid,   {},                                   nullptr},
    {"pattern",     "part.pattern_linear",   PlanSelect::LatestSolid,   {"count", "dx"},                      nullptr},
    {"array",       "part.pattern_linear",   PlanSelect::LatestSolid,   {"count", "dx"},                      nullptr},
    {"grid",        "part.pattern_grid",     PlanSelect::LatestSolid,   {"nx", "ny", "dx", "dy"},             "pattern"},
    {"circular",    "part.pattern_circular", PlanSelect::LatestSolid,   {"count", "total_angle"},             "pattern"},
    {"polar",       "part.pattern_circular", PlanSelect::LatestSolid,   {"count", "total_angle"},             "pattern"},
    {"undo",        "part.undo",             PlanSelect::Keep,          {},                                   nullptr},
    {"redo",        "part.redo",             PlanSelect::Keep,          {},                                   nullptr},
};

const Verb* findVerb(const std::string& word) {
  for (const Verb& v : kVerbs) {
    if (word == v.word) return &v;
  }
  return nullptr;
}

std::vector<std::string> tokenize(const std::string& text) {
  std::vector<std::string> out;
  std::string cur;
  for (char raw : text) {
    const unsigned char c = static_cast<unsigned char>(raw);
    // '.' and '-' stay INSIDE a token so "2.5" and "-3" survive; everything else
    // that is not a letter or a digit ends one.
    if (std::isalnum(c) != 0 || raw == '.' || raw == '-') {
      cur += static_cast<char>(std::tolower(c));
    } else if (!cur.empty()) {
      out.push_back(cur);
      cur.clear();
    }
  }
  if (!cur.empty()) out.push_back(cur);
  return out;
}

// A token is a number when strtod consumes a prefix of it and everything after
// that prefix is alphabetic — "20", "2.5" and "20mm" are numbers, "m20" is not.
bool numberToken(const std::string& token, double& value) {
  if (token.empty()) return false;
  const char* begin = token.c_str();
  char* end = nullptr;
  const double v = std::strtod(begin, &end);
  if (end == begin) return false;
  for (const char* p = end; *p != '\0'; ++p) {
    if (std::isalpha(static_cast<unsigned char>(*p)) == 0) return false;
  }
  value = v;
  return true;
}

}  // namespace

const std::vector<std::string>& LocalPlanner::vocabulary() {
  static const std::vector<std::string> words = [] {
    std::vector<std::string> v;
    for (const Verb& verb : kVerbs) v.push_back(verb.word);
    std::sort(v.begin(), v.end());
    return v;
  }();
  return words;
}

PlanResponse LocalPlanner::plan(const PlanRequest& request) {
  PlanResponse response;
  response.id = request.id;
  response.plan.intent = request.intent;

  const std::vector<std::string> tokens = tokenize(request.intent);
  std::vector<std::string> unregistered;

  std::size_t i = 0;
  while (i < tokens.size()) {
    const Verb* verb = findVerb(tokens[i]);
    if (verb == nullptr) {
      ++i;
      continue;
    }
    ++i;
    if (verb->absorb != nullptr && i < tokens.size() && tokens[i] == verb->absorb) ++i;

    // Everything up to the next verb belongs to this one.
    std::vector<double> numbers;
    std::vector<std::string> words;
    while (i < tokens.size() && findVerb(tokens[i]) == nullptr) {
      double v = 0.0;
      if (numberToken(tokens[i], v)) {
        numbers.push_back(v);
      } else {
        words.push_back(tokens[i]);
      }
      ++i;
    }

    // A planner may only name a tool the LIVE registry handed it.
    const PlanTool* tool = findTool(request.tools, verb->commandId);
    if (tool == nullptr) {
      unregistered.push_back(verb->commandId);
      continue;
    }

    PlanStep step;
    step.commandId = tool->id;
    step.irOp = tool->featureIrOp;  // read from the descriptor, never invented
    step.select = verb->select;

    std::size_t used = 0;
    std::string fromText;
    for (const char* slot : verb->numeric) {
      if (slot == nullptr || used >= numbers.size()) break;
      const ParamSpec* spec = findSpec(tool->schema, slot);
      if (spec == nullptr || spec->type != ParamType::Number) continue;
      step.args.push_back(PlanArg::num(slot, numbers[used]));
      if (!fromText.empty()) fromText += ", ";
      fromText += std::string(slot) + "=" + formatIrNumber(numbers[used]);
      ++used;
    }
    // A principal plane named in the sentence ("mirror about YZ").
    for (const std::string& w : words) {
      if (w != "xy" && w != "yz" && w != "xz") continue;
      const ParamSpec* spec = findSpec(tool->schema, "plane");
      if (spec == nullptr || spec->type != ParamType::Text) continue;
      std::string upper = w;
      for (char& c : upper) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
      step.args.push_back(PlanArg::str("plane", upper));
      if (!fromText.empty()) fromText += ", ";
      fromText += "plane=" + upper;
      break;
    }

    // Every REQUIRED parameter the sentence did not state is filled from the
    // command's OWN declared default. Not from a number this file invented: the
    // schema is the source, and the note says which values came from where —
    // dispatch is the raw path, so a plan that omits a required argument can
    // never run (ParamSpec::hasDefault is false on these, deliberately).
    std::string fromSchema;
    for (const ParamSpec& spec : tool->schema) {
      if (!spec.required) continue;
      bool stated = false;
      for (const PlanArg& a : step.args) {
        if (a.name == spec.name) stated = true;
      }
      if (stated) continue;
      switch (spec.type) {
        case ParamType::Number:
          step.args.push_back(PlanArg::num(spec.name, spec.defaultNumber));
          break;
        case ParamType::Text:
          step.args.push_back(PlanArg::str(spec.name, spec.defaultText));
          break;
        case ParamType::Flag:
          step.args.push_back(PlanArg::on(spec.name, spec.defaultNumber != 0.0));
          break;
      }
      if (!fromSchema.empty()) fromSchema += ", ";
      fromSchema += step.args.back().display();
    }

    step.note = "from your words: " + (fromText.empty() ? std::string("nothing") : fromText) +
                "; from the schema: " + (fromSchema.empty() ? std::string("nothing") : fromSchema);
    response.plan.steps.push_back(std::move(step));
  }

  if (response.plan.steps.empty()) {
    response.ok = false;
    if (!unregistered.empty()) {
      response.error = "this workspace's registry does not hold " + unregistered.front() +
                       ", so the CoPilot will not offer it";
    } else {
      std::string vocab;
      for (const std::string& w : vocabulary()) {
        if (!vocab.empty()) vocab += " ";
        vocab += w;
      }
      response.error =
          "no word in that request is in the local planner's vocabulary. It understands: " + vocab;
    }
    return response;
  }

  std::string ops;
  for (const PlanStep& s : response.plan.steps) {
    if (!ops.empty()) ops += " -> ";
    ops += s.irOp.empty() ? s.commandId : s.irOp;
  }
  response.plan.summary = std::to_string(response.plan.steps.size()) +
                          (response.plan.steps.size() == 1 ? " op: " : " ops: ") + ops;
  response.ok = true;
  return response;
}

// ── validation ──────────────────────────────────────────────────────────────
PlanCheck validatePlan(const Plan& plan, const CommandRegistry& registry, std::string& detail) {
  detail.clear();
  if (plan.steps.empty()) {
    detail = "the plan has no steps";
    return PlanCheck::EmptyPlan;
  }
  for (std::size_t i = 0; i < plan.steps.size(); ++i) {
    const PlanStep& step = plan.steps[i];
    const std::string where = "step " + std::to_string(i + 1) + " (" + step.commandId + ")";
    const CommandDescriptor* cmd = registry.find(step.commandId);
    if (cmd == nullptr) {
      detail = where + ": no such command in the live registry";
      return PlanCheck::UnknownCommand;
    }
    if (step.irOp != cmd->featureIrOp) {
      detail = where + ": names op \"" + step.irOp + "\" but the command emits \"" +
               cmd->featureIrOp + "\"";
      return PlanCheck::OpMismatch;
    }
    for (const PlanArg& a : step.args) {
      const ParamSpec* spec = findSpec(cmd->schema, a.name);
      if (spec == nullptr) {
        detail = where + ": the schema declares no parameter \"" + a.name + "\"";
        return PlanCheck::UndeclaredParameter;
      }
      if (spec->type != a.type) {
        detail = where + ": parameter \"" + a.name + "\" is declared a different type";
        return PlanCheck::WrongParameterType;
      }
    }
    // Apply is the RAW dispatch path — ForgeShell::run fills nothing in — so a
    // required parameter the plan does not state can never be supplied later.
    const std::vector<std::string> missing = missingRequired(*cmd, step.params());
    if (!missing.empty()) {
      detail = where + ": required parameter \"" + missing.front() + "\" was not stated";
      return PlanCheck::MissingRequiredParameter;
    }
  }
  return PlanCheck::Ok;
}

// ── applying ────────────────────────────────────────────────────────────────
namespace {

// Every still-bound value of `kind`, NEWEST FIRST, as (ir id, document node).
std::vector<std::pair<int, std::string>> boundValues(const PartDocument& doc, IrValueKind kind) {
  std::vector<std::pair<int, std::string>> out;
  const std::vector<FeatureRecord>& records = doc.records();
  for (std::size_t i = records.size(); i > 0; --i) {
    const FeatureRecord& r = records[i - 1];
    if (r.produces != kind) continue;
    const std::string node = doc.nodeFor(r.irId);
    // A value whose node is gone was CONSUMED (a boolean absorbs its tool body).
    // Selecting it would name a body the document no longer has.
    if (node.empty()) continue;
    out.emplace_back(r.irId, node);
  }
  return out;
}

// The persistent name the CoPilot gives an entity it resolved from the DOCUMENT.
// It names a SET, not a pick. The CoPilot has no viewport and picks no geometry,
// and writing "edge@7" here would be a fabricated topology reference — the one
// thing an EntityRef must never be. The Part commands that take an Edge or Face
// selection use it only to find the ONE body it belongs to (solidTarget, in
// PartCommands.cpp) and take the actual sub-set from their own `selector`
// parameter, so a set name is both honest and sufficient.
std::string setName(EntityKind kind) {
  if (kind == EntityKind::Body) return std::string();  // whole-body refs carry no name
  return std::string("all-") + toString(kind);
}

bool resolveSelection(const PlanStep& step, const CommandDescriptor& cmd, const PartDocument& doc,
                      std::vector<EntityRef>& refs, std::string& why) {
  refs.clear();
  why.clear();
  if (step.select == PlanSelect::None) return true;  // an empty selection IS the answer
  if (cmd.signature.kind == EntityKind::None) return true;  // needs nothing picked

  const IrValueKind want =
      step.select == PlanSelect::LatestProfile ? IrValueKind::Profile : IrValueKind::Solid;
  const std::size_t need = cmd.signature.minCount == 0 ? 1 : cmd.signature.minCount;
  const std::vector<std::pair<int, std::string>> bound = boundValues(doc, want);
  if (bound.size() < need) {
    why = "the document holds " + std::to_string(bound.size()) + " " +
          std::string(toString(want)) + " value(s); this step needs " + std::to_string(need);
    return false;
  }
  const EntityKind kind =
      cmd.signature.kind == EntityKind::Any ? EntityKind::Body : cmd.signature.kind;
  for (std::size_t i = 0; i < need; ++i) {
    EntityRef ref;
    ref.bodyId = bound[i].second;
    ref.kind = kind;
    ref.persistentName = setName(kind);
    refs.push_back(ref);
  }
  return true;
}

std::string describeRefs(const std::vector<EntityRef>& refs) {
  if (refs.empty()) return "nothing";
  std::string out;
  for (const EntityRef& r : refs) {
    if (!out.empty()) out += " + ";
    out += toString(r.kind);
    out += " on ";
    out += r.bodyId;
  }
  return out;
}

}  // namespace

std::string ApplyOutcome::summary() const {
  std::string out = std::to_string(applied) + "/" + std::to_string(requested) + " step(s) applied";
  for (const StepOutcome& s : steps) {
    if (s.ok()) continue;
    out += "; " + s.commandId + " -> " + toString(s.dispatch.status);
    const std::string why = s.detail.empty() ? s.dispatch.detail : s.detail;
    if (!why.empty()) out += " (" + why + ")";
    break;  // the first refusal is the cause; everything after it never ran
  }
  return out;
}

ApplyOutcome applyPlan(const Plan& plan, ForgeShell& shell, const PartDocument& document) {
  ApplyOutcome out;
  out.requested = plan.steps.size();
  for (const PlanStep& step : plan.steps) {
    StepOutcome so;
    so.commandId = step.commandId;

    const CommandDescriptor* cmd = shell.registry().find(step.commandId);
    if (cmd == nullptr) {
      // Structurally unreachable through deliver(), which refuses such a plan.
      // Checked anyway: this function is the door, and a door that trusts its
      // caller is not a door.
      so.dispatch = DispatchResult{DispatchStatus::UnknownCommand, step.commandId};
      out.steps.push_back(std::move(so));
      break;
    }

    if (step.select != PlanSelect::Keep) {
      std::vector<EntityRef> refs;
      std::string why;
      if (!resolveSelection(step, *cmd, document, refs, why)) {
        so.detail = why;
        so.selection = "unresolved";
        so.dispatch = DispatchResult{DispatchStatus::SelectionSignatureMismatch, why};
        out.steps.push_back(std::move(so));
        break;
      }
      // THE SAME service a viewport pick writes through, so the CoPilot's
      // selection is indistinguishable from a user's downstream.
      shell.selection().replaceWith(refs);
      if (shell.selection().count() != refs.size()) {
        so.detail = "the live selection filter rejects a " +
                    std::string(toString(cmd->signature.kind));
        so.selection = "filtered out";
        so.dispatch = DispatchResult{DispatchStatus::SelectionSignatureMismatch, so.detail};
        out.steps.push_back(std::move(so));
        break;
      }
      so.selection = describeRefs(refs);
    } else {
      so.selection = describeRefs(shell.selection().selection());
    }

    // THE ONE DOOR. Not a handler call, not a document write: the same
    // ForgeShell::run a menu item, a shortcut and a macro step go through, which
    // is why this run lands in the same journal and under the same undo stack.
    so.dispatch = shell.run(step.commandId, step.params());
    const bool ok = so.dispatch.ok();
    out.steps.push_back(std::move(so));
    if (!ok) break;  // a plan is a SEQUENCE; later steps consume earlier ones
    ++out.applied;
  }
  return out;
}

// ── ArchieCopilot ───────────────────────────────────────────────────────────
void ArchieCopilot::say(TranscriptRole role, std::string text) {
  TranscriptLine line;
  line.role = role;
  line.text = std::move(text);
  transcript_.push_back(std::move(line));
  // Bounded like the frame's own log: a transcript that grows without limit is a
  // leak with a scrollbar.
  if (transcript_.size() > 500) {
    transcript_.erase(transcript_.begin(), transcript_.begin() + 100);
  }
}

std::uint64_t ArchieCopilot::submit(std::string intent, std::vector<PlanTool> tools,
                                    std::string selectionSummary, std::string documentSummary) {
  // Trim: a line of spaces is not an intent, and " " would otherwise open a
  // request no planner can answer.
  const std::size_t first = intent.find_first_not_of(" \t\r\n");
  const std::size_t last = intent.find_last_not_of(" \t\r\n");
  if (first == std::string::npos) return 0;
  intent = intent.substr(first, last - first + 1);
  if (pending_) return 0;  // one ask per input line; a double press queues nothing

  request_ = PlanRequest{};
  request_.id = nextId_++;
  request_.intent = intent;
  request_.tools = std::move(tools);
  request_.selectionSummary = std::move(selectionSummary);
  request_.documentSummary = std::move(documentSummary);
  pending_ = true;
  plan_ = Plan{};  // the old offer was made against an older document
  say(TranscriptRole::User, intent);
  return request_.id;
}

PlanCheck ArchieCopilot::deliver(const PlanResponse& response, const CommandRegistry& registry) {
  if (!pending_ || response.id != request_.id) {
    ++refused_;
    say(TranscriptRole::System,
        "refused a reply for request " + std::to_string(response.id) + ": " +
            (pending_ ? "the request in flight is " + std::to_string(request_.id)
                      : "no request is in flight"));
    return PlanCheck::StaleResponse;
  }
  pending_ = false;

  if (!response.ok) {
    ++refused_;
    say(TranscriptRole::Copilot,
        response.error.empty() ? std::string("the planner refused, and did not say why")
                               : response.error);
    return PlanCheck::PlannerFailed;
  }

  std::string detail;
  const PlanCheck check = validatePlan(response.plan, registry, detail);
  if (check != PlanCheck::Ok) {
    ++refused_;
    say(TranscriptRole::System,
        std::string("refused the plan (") + toString(check) + "): " + detail);
    return check;
  }

  plan_ = response.plan;
  ++accepted_;
  say(TranscriptRole::Copilot, plan_.summary.empty()
                                   ? (std::to_string(plan_.size()) + " step(s) planned")
                                   : plan_.summary);
  return PlanCheck::Ok;
}

void ArchieCopilot::failRequest(std::string why) {
  if (!pending_) return;
  pending_ = false;
  ++refused_;
  say(TranscriptRole::System, "the planner could not be reached: " + why);
}

void ArchieCopilot::discardPlan() {
  if (plan_.empty()) return;
  const std::size_t n = plan_.size();
  plan_ = Plan{};
  say(TranscriptRole::System, "discarded a plan of " + std::to_string(n) + " step(s)");
}

ApplyOutcome ArchieCopilot::apply(ForgeShell& shell, const PartDocument& document) {
  ApplyOutcome out;
  if (plan_.empty()) {
    say(TranscriptRole::System, "there is no plan to apply");
    return out;
  }
  out = applyPlan(plan_, shell, document);
  stepsApplied_ += out.applied;
  // The plan is CONSUMED whether or not every step landed: the document has
  // moved, so a plan made against the old one is no longer that plan.
  plan_ = Plan{};
  say(TranscriptRole::Copilot, out.summary());
  return out;
}

void ArchieCopilot::clear() {
  transcript_.clear();
  request_ = PlanRequest{};
  plan_ = Plan{};
  pending_ = false;
  accepted_ = 0;
  refused_ = 0;
  stepsApplied_ = 0;
}

}  // namespace forge::ui
