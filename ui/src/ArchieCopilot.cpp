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
#include "forge/ui/OpConstraintBridge.hpp"
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
    case PlanSelect::LatestWire:    return "the newest section wire in the document";
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
    case PlanCheck::OpConstraintRefused:      return "op_constraint_refused";
  }
  return "ok";
}

// ── the verdict rows ────────────────────────────────────────────────────────
std::string StepVerdict::display() const {
  std::string out = std::to_string(index);
  out += "  ";
  out += irOp.empty() ? std::string("-") : irOp;
  out += "  ";
  out += accepted() ? "ACCEPT" : "REFUSE";
  if (!accepted()) {
    if (constraint != OpConstraint::Ok) {
      out += " ";
      out += toString(constraint);
    }
    if (!parameter.empty()) out += " (" + parameter + ")";
    out += ": ";
    out += reason;
  }
  return out;
}

std::size_t PlanVerdict::refusedSteps() const noexcept {
  std::size_t n = 0;
  for (const StepVerdict& s : steps) {
    if (!s.accepted()) ++n;
  }
  return n;
}

const StepVerdict* PlanVerdict::firstRefusal() const noexcept {
  for (const StepVerdict& s : steps) {
    if (!s.accepted()) return &s;
  }
  return nullptr;
}

std::string PlanVerdict::report() const {
  std::string out;
  for (const StepVerdict& s : steps) out += "  " + s.display() + "\n";
  out += "  " + std::to_string(steps.size() - refusedSteps()) + " accepted, " +
         std::to_string(refusedSteps()) + " refused";
  if (check != PlanCheck::Ok && !detail.empty()) {
    out += " -- " + std::string(toString(check)) + ": " + detail;
  }
  out += "\n";
  return out;
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
    // LOFT and SKIN consume WIRE, not PROFILE. The PlanSelect here is now only a
    // fallback -- wantedKind() reads the signature and answers Wire for both --
    // but it is written as LatestSolid rather than LatestProfile so the table
    // stops ASSERTING the very thing D-023 corrected.
    {"loft",        "part.loft",             PlanSelect::LatestSolid,   {},                                   nullptr},
    {"skin",        "part.skin",             PlanSelect::LatestSolid,   {},                                   nullptr},
    // The SURFACE ops. `thicken` and `cap` take a sheet and give a solid; `sew`
    // and `surfcheck` take a sheet and give one back.
    {"thicken",     "part.thicken",          PlanSelect::LatestSolid,   {"wall"},                             nullptr},
    {"cap",         "part.cap",              PlanSelect::LatestSolid,   {},                                   nullptr},
    {"sew",         "part.sew",              PlanSelect::LatestSolid,   {},                                   nullptr},
    {"surfcheck",   "part.surfcheck",        PlanSelect::LatestSolid,   {},                                   nullptr},
    {"faces",       "part.extract_faces",    PlanSelect::LatestSolid,   {},                                   nullptr},
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
    // edit.undo / edit.redo, NOT part.undo / part.redo. The Part workspace's own
    // pair was removed when ForgeShell::DocumentHost made edit.undo drive the
    // real stack: two Undo commands over ONE stack is the defect that removal
    // fixed, and a planner naming the retired id would be refused as an unknown
    // command on every request that used the word.
    {"undo",        "edit.undo",             PlanSelect::Keep,          {},                                   nullptr},
    {"redo",        "edit.redo",             PlanSelect::Keep,          {},                                   nullptr},
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
namespace {

// The feature-IR argument a command will build from one stated PARAMETER.
//
// This is the only place the CoPilot claims to know how a parameter becomes an
// argument, and the claim is deliberately the WEAKEST one that is still true of
// every command in the registry: a Text parameter becomes a WORD in the
// statement, and a Number becomes a NUMBER. Which slot it lands in, and whether
// it is quoted or bare, is the command's business -- and it is not knowable from
// out here, because the command decides inside its own execute() body.
//
// part.fillet is the case that matters and it does BOTH: `selector` is emitted
// as a bare keyword when it is one of ALL/VERTICAL/RIM/CONVEX and as a quoted
// string otherwise. So a Text value is judged TWICE, once as each, and refused
// if either reading refuses it. Judging only the quoted form would miss the bare
// keyword the command actually emits for exactly those four words -- and judging
// only the bare form would refuse every real face selector, which contains
// punctuation by design.
bool refuseValue(const OpConstraintBridge& bridge, const PlanArg& arg, OpConstraint& verdict,
                 std::string& reason) {
  switch (arg.type) {
    case ParamType::Flag:
      // A bool is emitted as a keyword the COMMAND chooses (RULED, OPEN, SMOOTH)
      // and never as the caller's word, so there is no caller value to judge.
      return false;
    case ParamType::Number: {
      verdict = bridge.checkValue(IrArg::num(arg.number), reason);
      return verdict != OpConstraint::Ok;
    }
    case ParamType::Text: {
      verdict = bridge.checkValue(IrArg::text(arg.text), reason);
      if (verdict != OpConstraint::Ok) return true;
      // The bare-keyword reading. A value that is not a bare keyword at all is
      // not refused here -- the command would quote it, and the quoted reading
      // above already passed.
      std::string bareReason;
      const OpConstraint bare = bridge.checkValue(IrArg::keyword(arg.text), bareReason);
      if (bare == OpConstraint::Ok || bare == OpConstraint::MalformedArgumentValue) return false;
      verdict = bare;
      reason = bareReason;
      return true;
    }
  }
  return false;
}

}  // namespace

PlanVerdict validatePlan(const Plan& plan, const CommandRegistry& registry,
                         const OpConstraintBridge& bridge) {
  PlanVerdict out;
  if (plan.steps.empty()) {
    out.check = PlanCheck::EmptyPlan;
    out.detail = "the plan has no steps";
    return out;
  }

  for (std::size_t i = 0; i < plan.steps.size(); ++i) {
    const PlanStep& step = plan.steps[i];
    const std::string where = "step " + std::to_string(i + 1) + " (" + step.commandId + ")";

    StepVerdict sv;
    sv.index = i + 1;
    sv.commandId = step.commandId;

    const CommandDescriptor* cmd = registry.find(step.commandId);
    if (cmd == nullptr) {
      sv.irOp = step.irOp;
      sv.refused = true;
      sv.reason = "no such command in the live registry";
      out.steps.push_back(std::move(sv));
      out.check = PlanCheck::UnknownCommand;
      out.detail = where + ": no such command in the live registry";
      return out;
    }
    // The COMMAND's op, never the plan's claim about it. The two are reconciled
    // immediately below; recording the plan's word here would put a lie in the
    // panel on the exact step whose lie is being caught.
    sv.irOp = cmd->featureIrOp;

    if (step.irOp != cmd->featureIrOp) {
      sv.refused = true;
      sv.reason = "the plan labels this step \"" + step.irOp + "\" and the command emits \"" +
                  cmd->featureIrOp + "\"";
      out.steps.push_back(std::move(sv));
      out.check = PlanCheck::OpMismatch;
      out.detail = where + ": names op \"" + step.irOp + "\" but the command emits \"" +
                   cmd->featureIrOp + "\"";
      return out;
    }

    // ── the OP the command will emit ────────────────────────────────────────
    // Structurally this cannot fail for a registered command -- the vocabulary
    // is GENERATED from this registry -- and it is checked anyway, because
    // "cannot fail" is a claim about a generated file staying in step with the
    // code, and that is exactly the drift the bridge reports rather than
    // assumes.
    if (!cmd->featureIrOp.empty() && !bridge.allows(cmd->featureIrOp)) {
      ProposedOp probe;
      probe.line.id = 1;
      probe.line.op = cmd->featureIrOp;
      const OpRuling ruling = bridge.check(probe);
      sv.refused = true;
      sv.constraint = ruling.verdict == OpConstraint::Ok ? OpConstraint::ForbiddenOp
                                                         : ruling.verdict;
      sv.reason = ruling.reason;
      out.steps.push_back(std::move(sv));
      out.check = PlanCheck::OpConstraintRefused;
      out.detail = where + ": " + ruling.reason;
      return out;
    }

    // ── every stated parameter: NAME, then TYPE, then VALUE ────────────────
    bool refused = false;
    for (const PlanArg& a : step.args) {
      const ParamSpec* spec = findSpec(cmd->schema, a.name);
      if (spec == nullptr) {
        sv.refused = true;
        sv.parameter = a.name;
        sv.reason = "the schema declares no parameter \"" + a.name + "\"";
        out.steps.push_back(std::move(sv));
        out.check = PlanCheck::UndeclaredParameter;
        out.detail = where + ": the schema declares no parameter \"" + a.name + "\"";
        return out;
      }
      if (spec->type != a.type) {
        sv.refused = true;
        sv.parameter = a.name;
        sv.reason = "parameter \"" + a.name + "\" is declared a different type";
        out.steps.push_back(std::move(sv));
        out.check = PlanCheck::WrongParameterType;
        out.detail = where + ": parameter \"" + a.name + "\" is declared a different type";
        return out;
      }

      // THE VALUE. Everything above this line read a parameter's NAME and its
      // TYPE and nothing else, and a name and a type are not a value: an op the
      // app forbids fits inside a `selector` of exactly the declared type under
      // exactly the declared name.
      OpConstraint verdict = OpConstraint::Ok;
      std::string reason;
      if (refuseValue(bridge, a, verdict, reason)) {
        sv.refused = true;
        sv.constraint = verdict;
        sv.parameter = a.name;
        sv.reason = "parameter \"" + a.name + "\" -- " + reason;
        refused = true;
        break;
      }
    }
    if (refused) {
      out.detail = where + ": " + sv.reason;
      out.steps.push_back(std::move(sv));
      out.check = PlanCheck::OpConstraintRefused;
      return out;
    }

    // Apply is the RAW dispatch path — ForgeShell::run fills nothing in — so a
    // required parameter the plan does not state can never be supplied later.
    const std::vector<std::string> missing = missingRequired(*cmd, step.params());
    if (!missing.empty()) {
      sv.refused = true;
      sv.parameter = missing.front();
      sv.reason = "required parameter \"" + missing.front() + "\" was not stated";
      out.steps.push_back(std::move(sv));
      out.check = PlanCheck::MissingRequiredParameter;
      out.detail = where + ": required parameter \"" + missing.front() + "\" was not stated";
      return out;
    }

    out.steps.push_back(std::move(sv));
  }
  return out;
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

// The value kind a step must bind is stated by the COMMAND'S OWN SIGNATURE, not
// guessed by the plan. This used to be
//     want = (select == LatestProfile) ? Profile : Solid
// which can name only two of the four kinds, so every command consuming a WIRE or
// a SURFACE was undrivable by the CoPilot: it got a ref whose bodyId names a
// SOLID, resolveValues() read kindOf() through that node, saw the wrong kind,
// returned {} and the command greyed out -- reported as a selection mismatch on a
// document that HELD the value the step asked for.
//
// That is the same defect D-023 records for part.loft itself ("part.loft was
// resolving PROFILE values"), left standing in the CoPilot's copy of the same
// decision, and it survived because the search that fixed the first one went
// looking for the command rather than for the CONCEPT.
//
// PlanSelect stays what it is -- a plan-level INTENT, and the only thing that can
// distinguish "the newest profile" from "the newest solid" for the two kinds an
// EntityKind cannot tell apart (Body and Face both mean SOLID). Where the
// signature names a kind outright, the signature wins, because it is what
// dispatch is going to check.
IrValueKind wantedKind(const CommandDescriptor& cmd, PlanSelect select) {
  switch (cmd.signature.kind) {
    case EntityKind::Sketch:  return IrValueKind::Profile;
    case EntityKind::Wire:    return IrValueKind::Wire;
    case EntityKind::Surface: return IrValueKind::Surface;
    // The two sketch-solver kinds. Without these rows the CoPilot would bind a
    // SOLID for every sketch-family step -- the D-023 defect this function was
    // rewritten to remove, reintroduced by the next value kind rather than by
    // the next command.
    case EntityKind::OpenSketch: return IrValueKind::Sketch;
    case EntityKind::SketchRef:  return IrValueKind::SketchRef;
    default: break;
  }
  // THE FALLBACK, and it is a switch rather than the ternary it replaces.
  // `select == LatestProfile ? Profile : Solid` answers SOLID for every value the
  // enum can name but the ternary cannot -- which is precisely how LatestWire's
  // absence stayed invisible before app/differential-gate-v2 measured it. The
  // signature above answers first and answers better; this is only reached when
  // the command's signature kind is generic (EntityKind::Any / Body / Face), and
  // there a plan step that SAYS wire must still get one.
  switch (select) {
    case PlanSelect::LatestProfile: return IrValueKind::Profile;
    case PlanSelect::LatestWire:    return IrValueKind::Wire;
    case PlanSelect::LatestSolid:
    case PlanSelect::Keep:
    case PlanSelect::None:          break;
  }
  return IrValueKind::Solid;
}

bool resolveSelection(const PlanStep& step, const CommandDescriptor& cmd, const PartDocument& doc,
                      std::vector<EntityRef>& refs, std::string& why) {
  refs.clear();
  why.clear();
  if (step.select == PlanSelect::None) return true;  // an empty selection IS the answer
  if (cmd.signature.kind == EntityKind::None) return true;  // needs nothing picked

  const IrValueKind want = wantedKind(cmd, step.select);
  // ── HOW MANY, and the step gets a say ────────────────────────────────────
  // This was `signature.minCount` unconditionally, and a PlanStep had no way to
  // state a count -- so every open-ended selection took the MINIMUM and no more.
  // `part.loft`'s signature is 2..n, so the three-ring nozzle was applied as
  // `LOFT(%2, %3, RULED)`: a two-section loft, built from a plan that named three
  // rings, with no error anywhere. A quietly different solid is worse than a
  // refusal, and it is exactly what the two-path differential exists to find.
  //
  // `selectCount == 0` keeps the old answer, so a step that states nothing is
  // byte-identical to before. A stated count is CLAMPED rather than refused --
  // REPRESENT / REPAIR / TOLERATE: below the signature's minimum it is raised to
  // the minimum, above its maximum it is capped there, and above what the
  // document actually holds it takes what there is. A planner asking for more
  // sections than exist gets every section, not a dead plan.
  const std::size_t minNeed = cmd.signature.minCount == 0 ? 1 : cmd.signature.minCount;
  const std::vector<std::pair<int, std::string>> bound = boundValues(doc, want);
  std::size_t need = minNeed;
  if (step.selectCount != 0) {
    need = step.selectCount < minNeed ? minNeed : step.selectCount;
    // maxCount's unbounded marker is (size_t)-1, not 0, so this caps a bounded
    // signature and is a no-op for `atLeast`. The `>= minNeed` guard keeps a
    // degenerate max from driving `need` BELOW the minimum the command requires.
    if (cmd.signature.maxCount >= minNeed && need > cmd.signature.maxCount) {
      need = cmd.signature.maxCount;
    }
    if (need > bound.size() && bound.size() >= minNeed) need = bound.size();
  }
  if (bound.size() < need) {
    why = "the document holds " + std::to_string(bound.size()) + " " +
          std::string(toString(want)) + " value(s); this step needs " + std::to_string(need);
    return false;
  }
  const EntityKind kind =
      cmd.signature.kind == EntityKind::Any ? EntityKind::Body : cmd.signature.kind;
  // ── OLDEST FIRST, and the order is LOAD-BEARING ──────────────────────────
  // boundValues() walks the document BACKWARDS, so bound[0] is the NEWEST value
  // and bound[need-1] the oldest of the ones this step will take. Handing those
  // to the selection in that order made every two-body boolean operate the wrong
  // way round: PartCommands.cpp registers the booleans with "selection ORDER is
  // load-bearing for CUT: the first pick is the target, the second is the tool",
  // so a plan that said "subtract" produced `CUT(%tool, %target)` -- the pin
  // minus the block instead of the block minus the pin. MEASURED by
  // ui/test/differential_gate_test.cpp against the planner's own text on three
  // corpus trees before this loop was reversed; CUT changed the SOLID, FUSE and
  // COMMON changed which document node survived.
  //
  // Reversing it is not a preference, it is what the two-argument form means in a
  // history modeller: the TOOL is the body you just made, so the TARGET is the
  // one that already existed. `need == 1` is unaffected -- bound[0] either way.
  for (std::size_t i = need; i > 0; --i) {
    EntityRef ref;
    ref.bodyId = bound[i - 1].second;
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
    if (s.blocked()) {
      // Named as a REFUSAL and not as a failed dispatch, because nothing was
      // dispatched: reporting a DispatchStatus here would describe a call that
      // was never made.
      out += "; " + s.commandId + " -> REFUSED BY THE OP-CONSTRAINT GATE";
      if (s.constraint != OpConstraint::Ok) {
        out += " (" + std::string(toString(s.constraint)) + ")";
      }
      if (!s.constraintReason.empty()) out += ": " + s.constraintReason;
      break;
    }
    out += "; " + s.commandId + " -> " + toString(s.dispatch.status);
    const std::string why = s.detail.empty() ? s.dispatch.detail : s.detail;
    if (!why.empty()) out += " (" + why + ")";
    break;  // the first refusal is the cause; everything after it never ran
  }
  return out;
}

ApplyOutcome applyPlan(const Plan& plan, ForgeShell& shell, const PartDocument& document,
                       const OpConstraintBridge& bridge) {
  ApplyOutcome out;
  out.requested = plan.steps.size();

  // THE GATE, RE-RUN AT THE DOOR. deliver() ran it already; nothing forces a
  // caller to have come through deliver().
  const PlanVerdict verdict = validatePlan(plan, shell.registry(), bridge);

  for (std::size_t i = 0; i < plan.steps.size(); ++i) {
    const PlanStep& step = plan.steps[i];
    StepOutcome so;
    so.commandId = step.commandId;

    // A step the gate refused is NEVER DISPATCHED. It is recorded, the plan
    // stops, and shell.run() is not reached -- so no journal entry, no undo
    // record and no document write can exist for it.
    if (i < verdict.steps.size() && !verdict.steps[i].accepted()) {
      const StepVerdict& sv = verdict.steps[i];
      so.gateRefused = true;
      so.constraint = sv.constraint;
      so.constraintReason = sv.reason;
      so.detail = sv.reason;
      ++out.blocked;
      out.steps.push_back(std::move(so));
      break;
    }
    // A plan whose STRUCTURE the gate refused (an empty plan, a step for a
    // command the registry does not hold) yields fewer verdict rows than steps.
    // Refuse rather than fall through: a missing verdict is not an acceptance.
    if (i >= verdict.steps.size()) {
      so.gateRefused = true;
      so.constraintReason = verdict.detail.empty()
                                ? std::string("the op-constraint gate returned no ruling for "
                                              "this step")
                                : verdict.detail;
      so.detail = so.constraintReason;
      ++out.blocked;
      out.steps.push_back(std::move(so));
      break;
    }

    const CommandDescriptor* cmd = shell.registry().find(step.commandId);
    if (cmd == nullptr) {
      // Structurally unreachable through deliver(), which refuses such a plan.
      // Checked anyway: this function is the door, and a door that trusts its
      // caller is not a door.
      so.ran = true;
      so.dispatch = DispatchResult{DispatchStatus::UnknownCommand, step.commandId};
      out.steps.push_back(std::move(so));
      break;
    }

    if (step.select != PlanSelect::Keep) {
      std::vector<EntityRef> refs;
      std::string why;
      if (!resolveSelection(step, *cmd, document, refs, why)) {
        so.ran = true;
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
        so.ran = true;
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
    so.ran = true;
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
  plan_ = Plan{};        // the old offer was made against an older document
  verdict_ = PlanVerdict{};  // ...and so was the ruling on it
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

  // THE GATE. The registry half rules on each parameter's name and type; the
  // op-constraint half rules on its VALUE. The verdict is KEPT either way, so a
  // refusal is something the panel can show line by line rather than a plan that
  // silently never appears.
  verdict_ = validatePlan(response.plan, registry, bridge_);
  if (!verdict_.accepted()) {
    ++refused_;
    std::string why = std::string("refused the plan (") + toString(verdict_.check) + "): " +
                      verdict_.detail;
    if (const StepVerdict* first = verdict_.firstRefusal();
        first != nullptr && first->constraint != OpConstraint::Ok) {
      // Name the CONSTRAINT as well as the category. "op_constraint_refused" is
      // a bucket; "forbidden_op_in_argument" is the fact a planner can act on.
      why += " [" + std::string(toString(first->constraint)) + "]";
    }
    say(TranscriptRole::System, why);
    return verdict_.check;
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
  verdict_ = PlanVerdict{};
  ++rejectedByUser_;
  say(TranscriptRole::User, "rejected the plan (" + std::to_string(n) + " step(s))");
}

ApplyOutcome ArchieCopilot::apply(ForgeShell& shell, const PartDocument& document) {
  ApplyOutcome out;
  if (plan_.empty()) {
    say(TranscriptRole::System, "there is no plan to apply");
    return out;
  }
  out = applyPlan(plan_, shell, document, bridge_);
  stepsApplied_ += out.applied;
  stepsBlocked_ += out.blocked;
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
  verdict_ = PlanVerdict{};
  pending_ = false;
  accepted_ = 0;
  refused_ = 0;
  stepsApplied_ = 0;
  stepsBlocked_ = 0;
}

}  // namespace forge::ui
