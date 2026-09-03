#include "forge/ui/FeatureHistory.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {
namespace {

void addSorted(std::vector<int>& out, int v) {
  if (v <= 0) return;
  auto it = std::lower_bound(out.begin(), out.end(), v);
  if (it != out.end() && *it == v) return;
  out.insert(it, v);
}

std::string opOf(const PartDocument& doc, int irId) {
  const FeatureRecord* rec = doc.featureAt(irId);
  return rec == nullptr ? std::string() : rec->line.op;
}

std::string labelOf(const PartDocument& doc, int irId) {
  const FeatureRecord* rec = doc.featureAt(irId);
  if (rec == nullptr) return {};
  return rec->label.empty() ? rec->line.op : rec->label;
}

std::string named(const PartDocument& doc, int irId) {
  return "%" + std::to_string(irId) + " " + opOf(doc, irId);
}

// Why a statement is not in the emitted program, in the words a user needs. The
// reason ALONE is not enough: "operand unavailable" without the operand is the
// unactionable message this whole track exists to remove.
std::string omitDetail(const PartDocument& doc, PartDocument::OmitReason reason, int blocking) {
  switch (reason) {
    case PartDocument::OmitReason::None:
      return {};
    case PartDocument::OmitReason::Suppressed:
      return "suppressed";
    case PartDocument::OmitReason::Deleted:
      return "deleted";
    case PartDocument::OmitReason::RolledBack:
      return "after the rollback bar (statement " + std::to_string(doc.rollback()) + ")";
    case PartDocument::OmitReason::OperandUnavailable:
      return "operand " + named(doc, blocking) + " produces no value here";
    case PartDocument::OmitReason::Orphaned:
      return "nothing consumes it any more -- the feature that did is gone";
  }
  return {};
}

// The diff of two emission plans, which IS the consequence preview.
Impact diff(const PartDocument& before, const PartDocument& after, int irId) {
  Impact out;
  out.possible = true;
  const PartDocument::EmissionPlan a = before.emissionPlan();
  const PartDocument::EmissionPlan b = after.emissionPlan();
  out.program = b.program();
  out.clampedTo = irId;

  const std::size_t n = std::max(before.records().size(), after.records().size());
  for (std::size_t i = 1; i <= n; ++i) {
    const int id = static_cast<int>(i);
    const bool wasEmitted = a.emittedIdFor(id) != 0;
    const bool willEmit = b.emittedIdFor(id) != 0;
    const PartDocument::OmitReason beforeReason = a.omitReasonFor(id);
    const PartDocument::OmitReason afterReason = b.omitReasonFor(id);

    // A statement that is emitted before and after can still have CHANGED: a
    // pass-through rebase moves what it consumes. Detect it on the emitted text
    // rather than by re-deriving the rule, so the two cannot disagree.
    bool rebased = false;
    if (wasEmitted && willEmit) {
      const FeatureRecord* rb = after.featureAt(id);
      const FeatureRecord* ra = before.featureAt(id);
      if (rb != nullptr && ra != nullptr) {
        // Compare the OPERAND each one resolves to in its own plan.
        for (std::size_t k = 0; k < ra->line.args.size() && k < rb->line.args.size(); ++k) {
          if (ra->line.args[k].kind != IrArgKind::Ref) continue;
          if (rb->line.args[k].kind != IrArgKind::Ref) continue;
          const int wasTarget = a.emittedIdFor(ra->line.args[k].ref);
          const int nowTarget = b.emittedIdFor(rb->line.args[k].ref);
          // Both are emitted ids in DIFFERENT programs, so a bare inequality
          // would fire on every renumbering. What matters is whether the value
          // it lands on is a different DOCUMENT statement.
          if (a.documentIdFor(wasTarget) != b.documentIdFor(nowTarget)) rebased = true;
        }
      }
    }

    if (wasEmitted == willEmit && beforeReason == afterReason && !rebased) continue;

    ImpactRow row;
    row.irId = id;
    row.op = opOf(after, id).empty() ? opOf(before, id) : opOf(after, id);
    row.label = labelOf(after, id).empty() ? labelOf(before, id) : labelOf(after, id);
    row.wasEmitted = wasEmitted;
    row.willEmit = willEmit;
    row.before = beforeReason;
    row.after = afterReason;
    row.blockingId = b.blockingFor(id);
    row.rebased = rebased;
    if (wasEmitted && !willEmit) ++out.stops;
    if (!wasEmitted && willEmit) ++out.resumes;
    if (rebased) ++out.rebasedCount;
    out.rows.push_back(row);
  }
  return out;
}

std::string summarize(const Impact& impact, const PartDocument& doc, const char* verb, int irId) {
  std::string s = std::string(verb) + " " + named(doc, irId);
  if (impact.stops == 0 && impact.resumes == 0 && impact.rebasedCount == 0) {
    s += ": nothing else changes";
    return s;
  }
  if (impact.stops != 0) {
    s += ": " + std::to_string(impact.stops) + " statement(s) stop building";
  }
  if (impact.rebasedCount != 0) {
    s += (impact.stops != 0 ? ", " : ": ");
    s += std::to_string(impact.rebasedCount) + " rebase onto its operand";
  }
  if (impact.resumes != 0) {
    s += (impact.stops != 0 || impact.rebasedCount != 0) ? ", " : ": ";
    s += std::to_string(impact.resumes) + " resume";
  }
  return s;
}

}  // namespace

// ── the dependency graph ────────────────────────────────────────────────────
std::vector<int> featureOperands(const PartDocument& doc, int irId) {
  std::vector<int> out;
  const FeatureRecord* rec = doc.featureAt(irId);
  if (rec == nullptr) return out;
  for (const IrArg& a : rec->line.args) {
    if (a.kind == IrArgKind::Ref) addSorted(out, a.ref);
  }
  return out;
}

std::vector<int> featureDependents(const PartDocument& doc, int irId) {
  std::vector<int> out;
  if (doc.featureAt(irId) == nullptr) return out;
  for (const FeatureRecord& r : doc.records()) {
    if (r.irId == irId) continue;
    for (const IrArg& a : r.line.args) {
      if (a.kind == IrArgKind::Ref && a.ref == irId) {
        addSorted(out, r.irId);
        break;
      }
    }
  }
  return out;
}

std::vector<int> featureDependentClosure(const PartDocument& doc, int irId) {
  std::vector<int> out;
  if (doc.featureAt(irId) == nullptr) return out;
  // Creation order IS evaluation order, so one forward pass reaches the whole
  // closure: a dependent is always numbered above what it depends on.
  std::vector<bool> reached(doc.records().size() + 1, false);
  if (static_cast<std::size_t>(irId) < reached.size()) reached[static_cast<std::size_t>(irId)] = true;
  for (const FeatureRecord& r : doc.records()) {
    if (r.irId <= irId) continue;
    for (const IrArg& a : r.line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      if (a.ref >= 1 && static_cast<std::size_t>(a.ref) < reached.size() &&
          reached[static_cast<std::size_t>(a.ref)]) {
        reached[static_cast<std::size_t>(r.irId)] = true;
        addSorted(out, r.irId);
        break;
      }
    }
  }
  return out;
}

// ── persistent naming ───────────────────────────────────────────────────────
const char* persistentNameProblem(const std::string& name) noexcept {
  if (name.empty()) return "a persistent name may not be empty";
  if (name.front() != '@') return "a persistent name must start with '@'";
  if (name.size() == 1) return "a persistent name needs something after the '@'";
  for (std::size_t i = 1; i < name.size(); ++i) {
    const char c = name[i];
    const bool alnum = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    if (!alnum && c != '_') {
      // opTag() lowercases the key and then requires [a-z0-9_], so anything else
      // is refused by the kernel with the name in the message. Refuse it here,
      // where the user can still fix it, rather than at compile time.
      return "a persistent name may only hold letters, digits and '_'";
    }
  }
  return nullptr;
}

std::string toPersistentName(const std::string& raw) {
  if (!raw.empty() && raw.front() == '@') return raw;
  return "@" + raw;
}

std::vector<PersistentName> persistentNames(const PartDocument& doc) {
  std::vector<PersistentName> out;
  for (const FeatureRecord& r : doc.records()) {
    if (r.line.op != "TAG" || r.line.args.size() < 3) continue;
    if (r.line.args[0].kind != IrArgKind::Ref) continue;
    PersistentName p;
    p.irId = r.irId;
    p.taggedId = r.line.args[0].ref;
    p.name = r.line.args[1].word;
    p.declaredBy = r.line.args[2].word;
    out.push_back(p);
  }
  return out;
}

std::string persistentNameOf(const PartDocument& doc, int irId) {
  for (const PersistentName& p : persistentNames(doc)) {
    if (p.taggedId == irId) return p.name;
  }
  return {};
}

// ── consequence preview ─────────────────────────────────────────────────────
Impact previewSuppress(const PartDocument& doc, int irId, bool on) {
  Impact out;
  if (doc.featureAt(irId) == nullptr) {
    out.summary = "no statement %" + std::to_string(irId);
    return out;
  }
  PartDocument after = doc;
  after.setSuppressed(irId, on);
  out = diff(doc, after, irId);
  out.summary = summarize(out, doc, on ? "suppress" : "unsuppress", irId);
  return out;
}

Impact previewDelete(const PartDocument& doc, int irId) {
  Impact out;
  if (doc.featureAt(irId) == nullptr) {
    out.summary = "no statement %" + std::to_string(irId);
    return out;
  }
  PartDocument after = doc;
  after.setDeleted(irId, true);
  out = diff(doc, after, irId);
  out.summary = summarize(out, doc, "delete", irId);
  return out;
}

Impact previewRollback(const PartDocument& doc, int irId) {
  PartDocument after = doc;
  after.setRollback(irId);
  Impact out = diff(doc, after, irId);
  out.clampedTo = after.rollback();
  out.summary = "roll back to statement " + std::to_string(after.rollback()) + ": " +
                std::to_string(out.stops) + " statement(s) stop building, " +
                std::to_string(out.resumes) + " resume";
  return out;
}

Impact previewMove(const PartDocument& doc, int irId, int newPosition) {
  Impact out;
  if (doc.featureAt(irId) == nullptr) {
    out.summary = "no statement %" + std::to_string(irId);
    return out;
  }
  PartDocument after = doc;
  int clampedTo = irId;
  int blockedBy = 0;
  const bool moved = after.moveFeature(irId, newPosition, clampedTo, blockedBy);
  out = diff(doc, after, irId);
  out.clampedTo = clampedTo;
  out.blockedBy = blockedBy;
  if (!moved) {
    // Unreachable while the window arithmetic is right; it names the statement
    // rather than saying "cannot", so a repair loop has an operand to work on.
    out.summary = "cannot renumber: " + named(doc, blockedBy) + " would not resolve";
    return out;
  }
  if (clampedTo == irId) {
    out.summary = "%" + std::to_string(irId) + " is already at position " +
                  std::to_string(irId);
    if (blockedBy != 0) {
      out.summary = "%" + std::to_string(irId) + " cannot move past " +
                    named(doc, blockedBy) + "; it stays at " + std::to_string(irId);
    }
    return out;
  }
  out.summary = "move %" + std::to_string(irId) + " to position " + std::to_string(clampedTo);
  if (blockedBy != 0) {
    out.summary += " (clamped by " + named(doc, blockedBy) + ")";
  }
  return out;
}

// ── per-node diagnosis ──────────────────────────────────────────────────────
const char* toString(FeatureIssue issue) noexcept {
  switch (issue) {
    case FeatureIssue::None:          return "ok";
    case FeatureIssue::Suppressed:    return "suppressed";
    case FeatureIssue::Deleted:       return "deleted";
    case FeatureIssue::RolledBack:    return "rolled_back";
    case FeatureIssue::BrokenOperand: return "broken_operand";
    case FeatureIssue::Orphaned:      return "orphaned";
    case FeatureIssue::BuildFailed:   return "build_failed";
  }
  return "ok";
}

std::vector<FeatureDiagnosis> diagnoseFeatures(const PartDocument& doc, int failedEmittedId,
                                               const std::string& kernelError) {
  std::vector<FeatureDiagnosis> out;
  const PartDocument::EmissionPlan plan = doc.emissionPlan();
  // THE MAPPING. The kernel blames an EMITTED id; the tree draws DOCUMENT rows.
  // Suppress one feature and the two stop being the same number, so a UI that
  // compares them directly starts blaming the wrong row -- silently, and exactly
  // when the document is already in trouble.
  const int failedDocId = failedEmittedId > 0 ? plan.documentIdFor(failedEmittedId) : 0;

  out.reserve(doc.records().size());
  for (const FeatureRecord& r : doc.records()) {
    FeatureDiagnosis d;
    d.irId = r.irId;
    const PartDocument::OmitReason reason = plan.omitReasonFor(r.irId);
    switch (reason) {
      case PartDocument::OmitReason::Suppressed:  d.issue = FeatureIssue::Suppressed; break;
      case PartDocument::OmitReason::Deleted:     d.issue = FeatureIssue::Deleted; break;
      case PartDocument::OmitReason::RolledBack:  d.issue = FeatureIssue::RolledBack; break;
      case PartDocument::OmitReason::Orphaned:    d.issue = FeatureIssue::Orphaned; break;
      case PartDocument::OmitReason::OperandUnavailable:
        d.issue = FeatureIssue::BrokenOperand;
        d.blockingId = plan.blockingFor(r.irId);
        break;
      case PartDocument::OmitReason::None:        d.issue = FeatureIssue::None; break;
    }
    if (reason != PartDocument::OmitReason::None) {
      d.detail = omitDetail(doc, reason, plan.blockingFor(r.irId));
    } else if (failedDocId == r.irId) {
      d.issue = FeatureIssue::BuildFailed;
      // VERBATIM. "VERIFY failed: holes=36 (got 30)" is the actionable text and
      // paraphrasing it loses the numbers a repair loop reads.
      d.detail = kernelError;
    }
    out.push_back(d);
  }
  return out;
}

FeatureDiagnosis diagnoseFeature(const PartDocument& doc, int irId, int failedEmittedId,
                                 const std::string& kernelError) {
  for (const FeatureDiagnosis& d : diagnoseFeatures(doc, failedEmittedId, kernelError)) {
    if (d.irId == irId) return d;
  }
  return FeatureDiagnosis{};
}

// ── the ConcreteCommands ────────────────────────────────────────────────────
bool HistoryEdit::apply(PartDocument& doc) {
  before_ = doc.captureHistory();
  // Captured on EVERY apply, not only the first, because redo runs apply()
  // again -- the same reason EditFeatureArgsEdit re-reads its `before_`.
  if (!mutate(doc)) {
    doc.restoreHistory(before_);  // a refused mutate leaves nothing half-done
    return false;
  }
  return true;
}

void HistoryEdit::revert(PartDocument& doc) { doc.restoreHistory(before_); }

SuppressFeatureEdit::SuppressFeatureEdit(int irId, bool on, std::string label)
    : HistoryEdit(std::move(label)), irId_(irId), on_(on) {}

bool SuppressFeatureEdit::mutate(PartDocument& doc) {
  const FeatureRecord* rec = doc.featureAt(irId_);
  if (rec == nullptr || rec->suppressed == on_) return false;
  return doc.setSuppressed(irId_, on_);
}

DeleteFeatureEdit::DeleteFeatureEdit(int irId, std::string label)
    : HistoryEdit(std::move(label)), irId_(irId) {}

bool DeleteFeatureEdit::mutate(PartDocument& doc) {
  const FeatureRecord* rec = doc.featureAt(irId_);
  if (rec == nullptr || rec->deleted) return false;
  return doc.setDeleted(irId_, true);
}

RenameFeatureEdit::RenameFeatureEdit(int irId, std::string name, std::string label)
    : HistoryEdit(std::move(label)), irId_(irId), name_(std::move(name)) {}

bool RenameFeatureEdit::mutate(PartDocument& doc) {
  const FeatureRecord* rec = doc.featureAt(irId_);
  if (rec == nullptr || rec->label == name_) return false;
  return doc.setLabel(irId_, name_);
}

RollbackEdit::RollbackEdit(int position, std::string label)
    : HistoryEdit(std::move(label)), position_(position) {}

bool RollbackEdit::mutate(PartDocument& doc) {
  const int was = doc.rollback();
  doc.setRollback(position_);
  return doc.rollback() != was;
}

MoveFeatureEdit::MoveFeatureEdit(int irId, int newPosition, std::string label)
    : HistoryEdit(std::move(label)), irId_(irId), newPosition_(newPosition) {}

bool MoveFeatureEdit::mutate(PartDocument& doc) {
  clampedTo_ = irId_;
  blockedBy_ = 0;
  if (!doc.moveFeature(irId_, newPosition_, clampedTo_, blockedBy_)) return false;
  // A clamped move that lands where it started is a no-op, and the caller reads
  // clampedTo()/blockedBy() to tell the user WHY -- which is not the same as
  // pretending the gesture never happened.
  return clampedTo_ != irId_;
}

}  // namespace forge::ui
