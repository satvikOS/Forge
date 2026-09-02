#include "forge/ui/ActivityLog.hpp"

#include <algorithm>
#include <cstddef>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {
namespace {

std::string joinNames(const std::vector<std::string>& names) {
  std::string out;
  for (std::size_t i = 0; i < names.size(); ++i) {
    if (i != 0) out += (i + 1 == names.size() ? " and " : ", ");
    out += names[i];
  }
  return out;
}

std::string labelOf(const std::string& id, const CommandDescriptor* command) {
  if (command != nullptr && !command->label.empty()) return command->label;
  return id;
}

}  // namespace

const char* toString(Severity severity) noexcept {
  switch (severity) {
    case Severity::Info:    return "info";
    case Severity::Warning: return "warning";
    case Severity::Error:   return "error";
  }
  return "info";
}

bool severityFromString(const std::string& name, Severity& out) noexcept {
  for (Severity s : {Severity::Info, Severity::Warning, Severity::Error}) {
    if (name == toString(s)) {
      out = s;
      return true;
    }
  }
  return false;
}

std::string LogEntry::render() const {
  std::ostringstream os;
  os << '[' << toString(severity) << "] ";
  if (!source.empty()) os << source << "  ";
  os << message;
  if (!detail.empty()) os << "  (" << detail << ')';
  return os.str();
}

// ── ActivityLog ─────────────────────────────────────────────────────────────
ActivityLog::ActivityLog(std::size_t capacity)
    // A zero capacity would make add() a silent no-op, which is the one
    // behaviour a log must never have. One entry is the smallest honest log.
    : capacity_(capacity == 0 ? 1 : capacity) {}

void ActivityLog::add(Severity severity, std::string source, std::string message,
                      std::string detail) {
  LogEntry e;
  e.sequence = ++recorded_;  // 1-based: 0 means "nothing yet" to since()
  e.severity = severity;
  e.source = std::move(source);
  // A blank line in a log is worse than no line: it takes a row and says
  // nothing. Name the shape of the problem instead.
  e.message = message.empty() ? std::string("(no message supplied)") : std::move(message);
  e.detail = std::move(detail);
  entries_.push_back(std::move(e));
  while (entries_.size() > capacity_) {
    entries_.erase(entries_.begin());
    ++dropped_;
  }
}

void ActivityLog::info(std::string source, std::string message, std::string detail) {
  add(Severity::Info, std::move(source), std::move(message), std::move(detail));
}

void ActivityLog::warning(std::string source, std::string message, std::string detail) {
  add(Severity::Warning, std::move(source), std::move(message), std::move(detail));
}

void ActivityLog::error(std::string source, std::string message, std::string detail) {
  add(Severity::Error, std::move(source), std::move(message), std::move(detail));
}

std::size_t ActivityLog::count(Severity severity) const noexcept {
  std::size_t n = 0;
  for (const LogEntry& e : entries_) {
    if (e.severity == severity) ++n;
  }
  return n;
}

std::vector<LogEntry> ActivityLog::atLeast(Severity severity) const {
  std::vector<LogEntry> out;
  for (const LogEntry& e : entries_) {
    if (static_cast<int>(e.severity) >= static_cast<int>(severity)) out.push_back(e);
  }
  return out;
}

std::vector<LogEntry> ActivityLog::since(std::size_t sequence) const {
  std::vector<LogEntry> out;
  for (const LogEntry& e : entries_) {
    if (e.sequence > sequence) out.push_back(e);
  }
  return out;
}

const LogEntry* ActivityLog::last() const noexcept {
  return entries_.empty() ? nullptr : &entries_.back();
}

const LogEntry* ActivityLog::lastAtLeast(Severity severity) const noexcept {
  for (std::size_t i = entries_.size(); i > 0; --i) {
    const LogEntry& e = entries_[i - 1];
    if (static_cast<int>(e.severity) >= static_cast<int>(severity)) return &e;
  }
  return nullptr;
}

void ActivityLog::clear() noexcept {
  entries_.clear();
  // recorded_ and dropped_ are NOT reset: they are lifetime totals, and a
  // sequence number that restarts would make an old `since` cursor read entries
  // it has already seen.
}

std::string ActivityLog::render(Severity atLeastSeverity) const {
  std::ostringstream os;
  if (dropped_ != 0) {
    os << "... " << dropped_ << " earlier entr" << (dropped_ == 1 ? "y" : "ies")
       << " dropped (log holds " << capacity_ << ")\n";
  }
  for (const LogEntry& e : entries_) {
    if (static_cast<int>(e.severity) < static_cast<int>(atLeastSeverity)) continue;
    os << e.sequence << "  " << e.render() << '\n';
  }
  return os.str();
}

// ── explanation ─────────────────────────────────────────────────────────────
Severity severityOf(DispatchStatus status) noexcept {
  switch (status) {
    case DispatchStatus::Ok:
      return Severity::Info;
    case DispatchStatus::SelectionSignatureMismatch:
    case DispatchStatus::Disabled:
    case DispatchStatus::MissingRequiredParameter:
      return Severity::Warning;
    case DispatchStatus::UnknownCommand:
    case DispatchStatus::NoHandler:
    case DispatchStatus::EditRefused:
      return Severity::Error;
  }
  return Severity::Error;
}

std::string describeSelection(const SelectionService& selection) {
  if (selection.count() == 0) return "nothing selected";
  // Counted per kind rather than printed per entity: a 400-face part selected
  // whole would otherwise render four hundred names into a status strip.
  const EntityKind kinds[] = {EntityKind::Vertex, EntityKind::Edge,    EntityKind::Face,
                              EntityKind::Body,   EntityKind::Sketch,  EntityKind::SketchCurve,
                              EntityKind::Wire,   EntityKind::Surface, EntityKind::OpenSketch,
                              EntityKind::SketchRef,
                              EntityKind::Feature, EntityKind::Component,
                              EntityKind::Datum};
  std::vector<std::string> parts;
  for (EntityKind k : kinds) {
    const std::size_t n = selection.countOf(k);
    if (n == 0) continue;
    parts.push_back(std::to_string(n) + " " + toString(k));
  }
  if (parts.empty()) return std::to_string(selection.count()) + " selected";
  return joinNames(parts);
}

std::string explainUnavailable(const std::string& commandId, const CommandDescriptor* command,
                               DispatchStatus status, const std::string& detail,
                               const std::vector<std::string>& missingParameters,
                               const SelectionService* selection) {
  const std::string label = labelOf(commandId, command);
  std::ostringstream os;
  switch (status) {
    case DispatchStatus::Ok:
      os << label << " ran";
      break;
    case DispatchStatus::UnknownCommand:
      os << "there is no command with the id \"" << commandId
         << "\" — nothing in the registry answers to it";
      break;
    case DispatchStatus::SelectionSignatureMismatch:
      os << label << " needs " << (command != nullptr ? command->signature.describe() : "a selection")
         << "; " << (selection != nullptr ? describeSelection(*selection) : std::string("the selection"))
         << " is picked";
      if (command != nullptr && command->signature.kind != EntityKind::None &&
          command->signature.kind != EntityKind::Any) {
        os << ". Set the selection filter to " << toString(command->signature.kind)
           << " and pick in the viewport";
      }
      break;
    case DispatchStatus::Disabled:
      os << label << " is not available right now";
      if (!detail.empty()) os << ": " << detail;
      else if (command != nullptr && !command->schema.empty())
        os << " — its enabled predicate refused the current parameters";
      break;
    case DispatchStatus::MissingRequiredParameter:
      os << label << " needs a value for "
         << (missingParameters.empty() ? (detail.empty() ? std::string("a required parameter")
                                                         : detail)
                                       : joinNames(missingParameters))
         << " before it can run";
      break;
    case DispatchStatus::NoHandler:
      os << label << " is registered with no handler — this is an application defect, not "
                     "something the document can fix";
      break;
    case DispatchStatus::EditRefused:
      os << label << " ran and the document refused the edit";
      if (!detail.empty()) os << ": " << detail;
      break;
  }
  if (command != nullptr && !command->featureIrOp.empty() &&
      status != DispatchStatus::Ok && status != DispatchStatus::UnknownCommand) {
    os << " [op " << command->featureIrOp << ']';
  }
  return os.str();
}

std::string explainDispatch(const std::string& commandId, const CommandDescriptor* command,
                            const DispatchResult& result,
                            const std::vector<std::string>& missingParameters,
                            const SelectionService* selection) {
  if (result.ok()) return {};
  return explainUnavailable(commandId, command, result.status, result.detail, missingParameters,
                            selection);
}

}  // namespace forge::ui
