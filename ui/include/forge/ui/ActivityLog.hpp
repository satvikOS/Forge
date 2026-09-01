// ui/include/forge/ui/ActivityLog.hpp
//
// WHY DID THAT NOT WORK? — the readable record of what the application did, and
// the one place a refusal is turned into a sentence a user can act on.
//
// ── the defect this replaces ────────────────────────────────────────────────
// ForgeShell kept a `journal_` of command IDs, appended ONLY on success:
//
//     if (result.ok()) journal_.push_back(id);
//
// So the entire record of a session was a list of things that WORKED. A fillet
// that was refused because the selection was a face and not an edge left no
// trace anywhere: the dispatch status went back to the caller, the caller (a key
// press) dropped it, and the user was left with a command that did nothing and
// said nothing. "Find out why without a debugger" was not possible, because the
// reason was never written down.
//
// This log records EVERY dispatch, successful or not, with the status, the
// detail the dispatcher gave, and an explanation naming the missing thing.
//
// ── the explanation is not a status string ──────────────────────────────────
// `selection_signature_mismatch` is the dispatcher's vocabulary. It is correct
// and it is useless to a user. explainUnavailable() turns the SAME facts into
// "Edge Fillet needs 1..n Edge (homogeneous) selected; 2 Face are picked" —
// which names the face, the edge and the op, so a repair loop (or a person) can
// act on it. That is the owner's constraint applied to error text: represent the
// refusal precisely enough to repair it, never just refuse.
//
// No global state: a log is an object, and ForgeShell owns one.
#ifndef FORGE_UI_ACTIVITYLOG_HPP
#define FORGE_UI_ACTIVITYLOG_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/SelectionService.hpp"

namespace forge::ui {

enum class Severity : std::uint8_t { Info = 0, Warning, Error };

const char* toString(Severity severity) noexcept;
bool severityFromString(const std::string& name, Severity& out) noexcept;

struct LogEntry {
  // MONOTONIC across the log's whole life and never reused, so `since(seq)` is
  // meaningful after the ring has discarded older entries. An index into
  // entries() would not be: it changes meaning every time one is dropped.
  std::size_t sequence = 0;
  Severity severity = Severity::Info;
  std::string source;   // the command ID, or a subsystem name like "document"
  std::string message;  // one line, always non-empty
  std::string detail;   // the machine-readable status, "" when there is none

  std::string render() const;  // "[error] part.fillet — <message> (<detail>)"
};

// A bounded, ordered log. Bounded because a 14-op tree rebuilt a thousand times
// is a plausible session and an unbounded vector of strings is a memory leak
// with a nice name; the number DROPPED is reported rather than hidden, because
// a log that silently forgets is a log you cannot reason from.
class ActivityLog {
 public:
  explicit ActivityLog(std::size_t capacity = 512);

  void add(Severity severity, std::string source, std::string message, std::string detail = {});
  void info(std::string source, std::string message, std::string detail = {});
  void warning(std::string source, std::string message, std::string detail = {});
  void error(std::string source, std::string message, std::string detail = {});

  const std::vector<LogEntry>& entries() const noexcept { return entries_; }
  std::size_t size() const noexcept { return entries_.size(); }
  std::size_t capacity() const noexcept { return capacity_; }
  std::size_t dropped() const noexcept { return dropped_; }
  std::size_t recorded() const noexcept { return recorded_; }

  std::size_t count(Severity severity) const noexcept;
  // Entries with severity >= `atLeast`, oldest first.
  std::vector<LogEntry> atLeast(Severity severity) const;
  // Entries whose sequence is strictly greater than `sequence`.
  std::vector<LogEntry> since(std::size_t sequence) const;

  const LogEntry* last() const noexcept;
  // The last entry at or above `severity` — what a status strip shows when
  // something went wrong, so the failure does not scroll away behind six
  // successful rebuilds.
  const LogEntry* lastAtLeast(Severity severity) const noexcept;

  void clear() noexcept;

  // The whole log as text, one entry per line. This is what a user copies into a
  // bug report, so it carries the sequence numbers and the dropped count.
  std::string render(Severity atLeast = Severity::Info) const;

 private:
  std::vector<LogEntry> entries_;
  std::size_t capacity_;
  std::size_t dropped_ = 0;
  std::size_t recorded_ = 0;
};

// ── turning a refusal into a sentence ───────────────────────────────────────
// `command` may be null (an unknown ID); `missingParameters` is what
// missingRequired() answered for the parameters the caller actually supplied.
// The result is ALWAYS non-empty and always names the command.
std::string explainUnavailable(const std::string& commandId, const CommandDescriptor* command,
                               DispatchStatus status, const std::string& detail,
                               const std::vector<std::string>& missingParameters,
                               const SelectionService* selection);

// The same, for a completed dispatch. Returns "" when `result` is Ok — a caller
// logging a success needs no explanation, and returning a sentence anyway is how
// a log fills with noise nobody reads.
std::string explainDispatch(const std::string& commandId, const CommandDescriptor* command,
                            const DispatchResult& result,
                            const std::vector<std::string>& missingParameters,
                            const SelectionService* selection);

// The severity a dispatch outcome deserves. Ok is Info; a refusal the user can
// fix by picking something (SelectionSignatureMismatch, Disabled,
// MissingRequiredParameter) is a Warning; a refusal that means the app is wrong
// (UnknownCommand, NoHandler) or that the document rejected the edit
// (EditRefused) is an Error.
Severity severityOf(DispatchStatus status) noexcept;

// "2 Face, 1 Edge" / "nothing selected" — the selection in the words the
// explanation needs. Public because the status strip wants the same phrasing.
std::string describeSelection(const SelectionService& selection);

}  // namespace forge::ui

#endif  // FORGE_UI_ACTIVITYLOG_HPP
