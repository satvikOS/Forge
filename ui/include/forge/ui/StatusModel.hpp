// ui/include/forge/ui/StatusModel.hpp
//
// THE STATUS STRIP, AS A VALUE — what is selected, what it measures, what the
// application is doing right now, and what went wrong last.
//
// ── why it is a value and not a draw call ───────────────────────────────────
// The status strip was ~90 lines of inline ImGui in ForgeFrame.cpp: seven
// `ImGui::SameLine()` runs, a hand-rolled right-alignment that MEASURED WRONG
// (the first version computed ~1660 px of "available" width on a strip with
// ~800 px left, and drew the message straight through the navigation hints), and
// an elide written to paper over it. None of that could be tested, because the
// only artefact was pixels.
//
// A StatusSummary is six strings. The elide is arithmetic on a string, which a
// gate can check; the composition is a pure function of the shell, which a gate
// can check; and the frame builder is left with the one job it is good at.
//
// ── progress is not a spinner ───────────────────────────────────────────────
// The target parts are 14-op trees over 300-430 faces. A rebuild of one of those
// is not instantaneous, and an application that goes silent through it is
// indistinguishable from one that has hung. ProgressTracker is the model behind
// "Rebuilding 7/14" — it counts real steps, and it reports an INDETERMINATE
// state honestly rather than inventing a percentage nobody measured.
#ifndef FORGE_UI_STATUSMODEL_HPP
#define FORGE_UI_STATUSMODEL_HPP

#include <cstddef>
#include <string>

#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/SelectionService.hpp"

namespace forge::ui {

struct ProgressState {
  bool active = false;
  std::string label;
  std::size_t completed = 0;
  std::size_t total = 0;   // 0 => indeterminate: the work is real, the count is not

  bool indeterminate() const noexcept { return active && total == 0; }
  // 0..1. Zero when indeterminate, because a bar drawn at a made-up fraction is
  // a lie the user cannot detect.
  double fraction() const noexcept;
  std::string text() const;  // "Rebuilding  7 / 14  (50%)"
};

class ProgressTracker {
 public:
  // `total` == 0 declares the operation indeterminate.
  void begin(std::string label, std::size_t total = 0);
  void step(std::size_t n = 1);
  void setLabel(std::string label);
  void end();

  const ProgressState& state() const noexcept { return state_; }
  bool active() const noexcept { return state_.active; }
  std::string text() const { return state_.text(); }
  // Lifetime totals: how many operations have begun and how many have ended.
  // A gate asserts they are equal at rest, which is how a `begin` with no `end`
  // — the bug that leaves a progress bar on screen for ever — is caught.
  std::size_t begun() const noexcept { return begun_; }
  std::size_t ended() const noexcept { return ended_; }

 private:
  ProgressState state_;
  std::size_t begun_ = 0;
  std::size_t ended_ = 0;
};

// Everything the strip shows, already composed. Each field is independently
// renderable, so a narrow window can drop a field instead of overdrawing one.
struct StatusSummary {
  std::string selection;     // "2 Face  focus face@12  hover -"
  std::string measurement;   // supplied by the host; "-" when there is none
  std::string document;      // "features 14  undo 3  redo 0  modified"
  std::string workspace;
  std::string inputProfile;
  std::string filter;        // the selection filter, the control beside it
  std::string progress;      // "" when idle
  std::string message;       // the last log line worth showing
  Severity severity = Severity::Info;

  // The message elided to `budget` characters, tail-kept. The TAIL is what
  // matters: a path and a failure reason both say what happened at their end.
  // Returns the message unchanged when it already fits, and never returns more
  // than `budget` characters — including the ellipsis.
  std::string elidedMessage(std::size_t budget) const;
};

// `measurement` is passed in rather than computed: the measurement of a live
// selection comes from a tessellated mesh, which this layer does not own and
// must not reach for. Pass "" and the field reads "-".
StatusSummary buildStatusSummary(const ForgeShell& shell, const ProgressTracker& progress,
                                 const std::string& measurement = std::string());

// "2 Face  focus face@12  hover -" on its own, for a caller that wants only
// that. Shared with buildStatusSummary so the two cannot phrase it differently.
std::string selectionStatusText(const SelectionService& selection);

}  // namespace forge::ui

#endif  // FORGE_UI_STATUSMODEL_HPP
