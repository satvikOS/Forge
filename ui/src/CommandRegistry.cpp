#include "forge/ui/CommandRegistry.hpp"

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <map>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

namespace {

std::string lower(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (char c : s) out += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return out;
}

std::string toDecimal(std::size_t n) {
  if (n == static_cast<std::size_t>(-1)) return "n";
  std::string out;
  if (n == 0) return "0";
  while (n > 0) {
    out += static_cast<char>('0' + static_cast<int>(n % 10));
    n /= 10;
  }
  std::reverse(out.begin(), out.end());
  return out;
}

}  // namespace

// ── SelectionSignature ──────────────────────────────────────────────────────
bool SelectionSignature::satisfiedBy(const SelectionService& sel) const noexcept {
  if (kind == EntityKind::None) return true;  // command needs no selection at all

  const std::size_t total = sel.count();
  if (total < minCount) return false;
  if (maxCount != static_cast<std::size_t>(-1) && total > maxCount) return false;
  if (total == 0) return minCount == 0;

  if (requireHomogeneous && !sel.homogeneous()) return false;
  if (kind == EntityKind::Any) return true;

  // Every selected entity must be of the required kind — a fillet offered on a
  // selection that is two edges and a face must NOT run.
  return sel.countOf(kind) == total;
}

// The counted phrase a person reads. "1..n edge (homogeneous)" is notation: it
// was on the menu tooltip of every command in the shipped build, and a machinist
// reading "needs 1..n edge (homogeneous)" learns nothing they can act on.
std::string SelectionSignature::describeForUser() const {
  if (kind == EntityKind::None) return "nothing selected";
  const std::string noun = userText(kind);
  const std::string plural = noun + "s";
  const bool unbounded = maxCount == static_cast<std::size_t>(-1);
  std::string out;
  if (minCount == maxCount) {
    out = minCount == 1 ? ("one " + noun)
                        : (toDecimal(minCount) + " " + plural);
  } else if (unbounded) {
    out = minCount <= 1 ? ("one or more " + plural)
                        : (toDecimal(minCount) + " or more " + plural);
  } else {
    out = toDecimal(minCount) + " to " + toDecimal(maxCount) + " " + plural;
  }
  // "homogeneous" says the picks must all be the same kind. Only worth saying
  // when more than one pick is possible; on a one-pick command it is noise.
  if (requireHomogeneous && (unbounded || maxCount > 1)) out += ", all of the same kind";
  return out;
}

std::string SelectionSignature::describe() const {
  if (kind == EntityKind::None) return "no selection required";
  std::string out = toDecimal(minCount);
  out += "..";
  out += toDecimal(maxCount);
  out += " ";
  out += toString(kind);
  if (requireHomogeneous) out += " (homogeneous)";
  return out;
}

// ── CommandParams ───────────────────────────────────────────────────────────
std::optional<double> CommandParams::number(const std::string& name) const {
  auto it = numbers_.find(name);
  if (it == numbers_.end()) return std::nullopt;
  return it->second;
}

std::optional<std::string> CommandParams::text(const std::string& name) const {
  auto it = texts_.find(name);
  if (it == texts_.end()) return std::nullopt;
  return it->second;
}

std::optional<bool> CommandParams::flag(const std::string& name) const {
  auto it = flags_.find(name);
  if (it == flags_.end()) return std::nullopt;
  return it->second;
}

bool CommandParams::has(const std::string& name) const {
  return numbers_.count(name) != 0 || texts_.count(name) != 0 || flags_.count(name) != 0;
}

// ── parameter defaults ──────────────────────────────────────────────────────
CommandParams applyDefaults(const CommandDescriptor& command, CommandParams params) {
  for (const ParamSpec& spec : command.schema) {
    if (!spec.hasDefault) continue;      // no honest default: do NOT invent one
    if (params.has(spec.name)) continue; // an explicit argument always wins
    switch (spec.type) {
      case ParamType::Number: params.setNumber(spec.name, spec.defaultNumber); break;
      case ParamType::Text:   params.setText(spec.name, spec.defaultText); break;
      case ParamType::Flag:   params.setFlag(spec.name, spec.defaultNumber != 0.0); break;
    }
  }
  return params;
}

std::vector<std::string> missingRequired(const CommandDescriptor& command,
                                         const CommandParams& params) {
  std::vector<std::string> out;
  for (const ParamSpec& spec : command.schema) {
    if (spec.required && !params.has(spec.name)) out.push_back(spec.name);
  }
  return out;
}

const char* machineName(DispatchStatus status) noexcept {
  switch (status) {
    case DispatchStatus::Ok:                         return "ok";
    case DispatchStatus::UnknownCommand:             return "unknown_command";
    case DispatchStatus::SelectionSignatureMismatch: return "selection_signature_mismatch";
    case DispatchStatus::Disabled:                   return "disabled";
    case DispatchStatus::MissingRequiredParameter:   return "missing_required_parameter";
    case DispatchStatus::NoHandler:                  return "no_handler";
    case DispatchStatus::EditRefused:                return "edit_refused";
  }
  return "unknown_command";
}

const char* userText(DispatchStatus status) noexcept {
  switch (status) {
    case DispatchStatus::Ok:                         return "ready";
    case DispatchStatus::UnknownCommand:             return "not in this version";
    case DispatchStatus::SelectionSignatureMismatch: return "needs a pick";
    case DispatchStatus::Disabled:                   return "not available now";
    case DispatchStatus::MissingRequiredParameter:   return "needs a value";
    case DispatchStatus::NoHandler:                  return "not finished yet";
    case DispatchStatus::EditRefused:                return "change not accepted";
  }
  return "not available now";
}

// ── CommandRegistry ─────────────────────────────────────────────────────────
bool CommandRegistry::add(CommandDescriptor descriptor) {
  if (descriptor.id.empty()) return false;
  if (!descriptor.execute) return false;
  if (byId_.count(descriptor.id) != 0) return false;  // duplicate stable ID: refuse
  const std::string id = descriptor.id;
  byId_.emplace(id, std::move(descriptor));
  order_.push_back(id);
  return true;
}

const CommandDescriptor* CommandRegistry::find(const std::string& id) const noexcept {
  auto it = byId_.find(id);
  return it == byId_.end() ? nullptr : &it->second;
}

std::vector<std::string> CommandRegistry::ids() const {
  std::vector<std::string> out;
  out.reserve(byId_.size());
  for (const auto& [id, cmd] : byId_) {
    (void)cmd;
    out.push_back(id);
  }
  return out;  // std::map iterates sorted: deterministic, order-independent
}

std::vector<std::string> CommandRegistry::idsInCategory(const std::string& category) const {
  std::vector<std::string> out;
  for (const auto& [id, cmd] : byId_) {
    if (cmd.category == category) out.push_back(id);
  }
  return out;
}

std::vector<std::string> CommandRegistry::categories() const {
  std::vector<std::string> out;
  for (const auto& [id, cmd] : byId_) {
    (void)id;
    if (std::find(out.begin(), out.end(), cmd.category) == out.end()) out.push_back(cmd.category);
  }
  std::sort(out.begin(), out.end());
  return out;
}

std::vector<std::string> CommandRegistry::search(const std::string& query,
                                                 std::size_t limit) const {
  const std::string q = lower(query);
  if (q.empty()) return {};

  struct Hit {
    std::size_t position;
    std::string id;
  };
  std::vector<Hit> hits;
  for (const auto& [id, cmd] : byId_) {
    const std::size_t inId = lower(id).find(q);
    const std::size_t inLabel = lower(cmd.label).find(q);
    const std::size_t best = std::min(inId, inLabel);
    if (best == std::string::npos) continue;
    hits.push_back(Hit{best, id});
  }
  std::sort(hits.begin(), hits.end(), [](const Hit& a, const Hit& b) {
    if (a.position != b.position) return a.position < b.position;
    return a.id < b.id;
  });
  std::vector<std::string> out;
  for (const Hit& h : hits) {
    if (out.size() >= limit) break;
    out.push_back(h.id);
  }
  return out;
}

DispatchResult CommandRegistry::evaluate(const std::string& id, const SelectionService& selection,
                                         const CommandParams& params) const {
  const CommandDescriptor* cmd = find(id);
  if (cmd == nullptr) return DispatchResult{DispatchStatus::UnknownCommand, id};

  if (!cmd->signature.satisfiedBy(selection)) {
    return DispatchResult{DispatchStatus::SelectionSignatureMismatch, cmd->signature.describe()};
  }

  for (const ParamSpec& spec : cmd->schema) {
    if (spec.required && !params.has(spec.name)) {
      return DispatchResult{DispatchStatus::MissingRequiredParameter, spec.name};
    }
  }

  CommandContext ctx(selection, params);
  if (cmd->enabled && !cmd->enabled(ctx)) {
    return DispatchResult{DispatchStatus::Disabled, cmd->id};
  }
  if (!cmd->execute) return DispatchResult{DispatchStatus::NoHandler, cmd->id};
  return DispatchResult{DispatchStatus::Ok, {}};
}

DispatchResult CommandRegistry::dispatch(const std::string& id, const SelectionService& selection,
                                         const CommandParams& params) const {
  DispatchResult gate = evaluate(id, selection, params);
  if (!gate.ok()) return gate;

  const CommandDescriptor* cmd = find(id);
  // evaluate() already proved the command exists and has a handler.
  CommandContext ctx(selection, params);
  ++dispatches_;
  cmd->execute(ctx);
  // A handler that ran and refused must not report Ok. Before this, every failure status was
  // decided above, so once execute() started the answer was always Ok -- and a refused edit
  // was a silent no-op reported as success.
  if (ctx.failed()) return DispatchResult{DispatchStatus::EditRefused, ctx.failureDetail()};
  return DispatchResult{DispatchStatus::Ok, {}};
}

}  // namespace forge::ui
