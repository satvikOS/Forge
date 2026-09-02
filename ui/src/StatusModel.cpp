#include "forge/ui/StatusModel.hpp"

#include <cstddef>
#include <sstream>
#include <string>
#include <utility>

#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

// ── progress ────────────────────────────────────────────────────────────────
double ProgressState::fraction() const noexcept {
  if (!active || total == 0) return 0.0;
  if (completed >= total) return 1.0;
  return static_cast<double>(completed) / static_cast<double>(total);
}

std::string ProgressState::text() const {
  if (!active) return {};
  std::ostringstream os;
  os << label;
  if (total == 0) {
    // No count means no percentage. Printing one would be inventing a number.
    os << "  (working)";
    return os.str();
  }
  os << "  " << completed << " / " << total << "  ("
     << static_cast<int>(fraction() * 100.0 + 0.5) << "%)";
  return os.str();
}

void ProgressTracker::begin(std::string label, std::size_t total) {
  // A begin over a live operation ENDS the old one rather than nesting: nested
  // progress with one bar is a bar that reports whichever operation happened to
  // write last, which is worse than reporting the outer one.
  if (state_.active) ++ended_;
  state_.active = true;
  state_.label = label.empty() ? std::string("Working") : std::move(label);
  state_.completed = 0;
  state_.total = total;
  ++begun_;
}

void ProgressTracker::step(std::size_t n) {
  if (!state_.active) return;  // a step outside an operation is not progress
  state_.completed += n;
  // Clamped, not wrapped: a step past the declared total is a miscount in the
  // caller, and showing 130% would advertise it as a state of the document.
  if (state_.total != 0 && state_.completed > state_.total) state_.completed = state_.total;
}

void ProgressTracker::setLabel(std::string label) {
  if (!state_.active) return;
  if (!label.empty()) state_.label = std::move(label);
}

void ProgressTracker::end() {
  if (!state_.active) return;
  state_.active = false;
  state_.label.clear();
  state_.completed = 0;
  state_.total = 0;
  ++ended_;
}

// ── the summary ─────────────────────────────────────────────────────────────
std::string selectionStatusText(const SelectionService& selection) {
  std::ostringstream os;
  os << describeSelection(selection);
  os << "  focus ";
  os << (selection.focus().has_value() ? selection.focus()->persistentName : std::string("-"));
  os << "  hover ";
  os << (selection.preselection().has_value() ? selection.preselection()->persistentName
                                              : std::string("-"));
  return os.str();
}

std::string StatusSummary::elidedMessage(std::size_t budget) const {
  if (message.size() <= budget) return message;
  // The ellipsis is part of the budget. The previous elide in ForgeFrame did not
  // count it, so a "fitted" string was three characters wider than the space it
  // was measured against — which is exactly how it came to overdraw the hints.
  const std::string ellipsis = "...";
  if (budget <= ellipsis.size()) return message.substr(message.size() - budget);
  return ellipsis + message.substr(message.size() - (budget - ellipsis.size()));
}

StatusSummary buildStatusSummary(const ForgeShell& shell, const ProgressTracker& progress,
                                 const std::string& measurement) {
  StatusSummary s;
  s.selection = selectionStatusText(shell.selection());
  s.measurement = measurement.empty() ? std::string("-") : measurement;

  const DocumentStats& doc = shell.document();
  std::ostringstream d;
  d << "features " << doc.features << "  undo " << doc.undoDepth << "  redo " << doc.redoDepth;
  if (doc.dirty) d << "  modified";
  s.document = d.str();

  s.workspace = toString(shell.workspace());
  s.inputProfile = toString(shell.inputProfile());
  s.filter = toString(shell.selection().filter());
  s.progress = progress.text();

  // WHAT WENT WRONG WINS. A warning or an error stays on the strip even after
  // six successful rebuilds have happened behind it, because the alternative is
  // the failure scrolling away before the user has read it. The activity log
  // still holds every line in order for anyone who wants the sequence.
  const LogEntry* worst = shell.log().lastAtLeast(Severity::Warning);
  const LogEntry* last = shell.log().last();
  const LogEntry* show = worst != nullptr ? worst : last;
  if (show != nullptr) {
    s.message = show->message;
    s.severity = show->severity;
  } else {
    s.message = "Ready";
    s.severity = Severity::Info;
  }
  return s;
}

}  // namespace forge::ui
