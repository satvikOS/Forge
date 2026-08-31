#include "forge/ui/PartCommands.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureHistory.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

const char* toString(IrValueKind kind) noexcept {
  switch (kind) {
    case IrValueKind::None:    return "none";
    case IrValueKind::Profile: return "profile";
    case IrValueKind::Wire:    return "wire";
    case IrValueKind::Solid:   return "solid";
  }
  return "none";
}

const char* toString(EditCheck check) noexcept {
  switch (check) {
    case EditCheck::Ok:               return "ok";
    case EditCheck::NoSuchFeature:    return "no_such_feature";
    case EditCheck::OperandChanged:   return "operand_changed";
    case EditCheck::NoChange:         return "no_change";
    case EditCheck::InvalidStatement: return "invalid_statement";
  }
  return "no_such_feature";
}

// ── PartDocument ────────────────────────────────────────────────────────────
int PartDocument::seed(IrValueKind kind, const std::string& nodeId, const std::string& op,
                       std::vector<IrArg> args) {
  FeatureRecord rec;
  rec.irId = nextIrId();
  rec.label = nodeId;
  rec.line = IrLine{rec.irId, op, std::move(args)};
  rec.produces = kind;
  return appendFeature(rec, {}, nodeId) ? rec.irId : 0;
}

int PartDocument::valueFor(const std::string& nodeId) const noexcept {
  auto it = bindings_.find(nodeId);
  return it == bindings_.end() ? 0 : it->second;
}

IrValueKind PartDocument::kindOf(int irId) const noexcept {
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return IrValueKind::None;
  return records_[static_cast<std::size_t>(irId) - 1].produces;
}

std::size_t PartDocument::featureCount() const noexcept {
  std::size_t n = 0;
  for (const FeatureRecord& r : records_) {
    if (!r.commandId.empty()) ++n;
  }
  return n;
}

const FeatureRecord* PartDocument::lastFeature() const noexcept {
  for (std::size_t i = records_.size(); i > 0; --i) {
    const FeatureRecord& r = records_[i - 1];
    if (!r.commandId.empty()) return &r;
  }
  return nullptr;
}

// THE EMITTED PROGRAM IS DERIVED, and it is the plan's program: one code path,
// so what the kernel compiles and what the tree reports can never disagree.
// With no suppression, no tombstone and no rollback bar this is bit-identical to
// the old `for (r : records_) out += r.line.text()` -- the plan keeps every
// statement, in order, renumbered 1..N onto the ids they already had.
std::string PartDocument::irProgram() const {
  const EmissionPlan plan = emissionPlan();
  return plan.program();
}

bool PartDocument::appendFeature(const FeatureRecord& record,
                                 const std::vector<std::string>& consumedNodes,
                                 const std::string& producedNode) {
  // A statement must be numbered by creation order, or every `%N` in the
  // program after it means something different.
  if (record.irId != nextIrId() || record.line.id != record.irId) {
    lastCheck_ = IrCheck::BadStatementId;
    return false;
  }
  const IrCheck check = validateIr(record.line);
  lastCheck_ = check;
  if (check != IrCheck::Ok) return false;  // no partial mutation

  records_.push_back(record);
  // IDENTITY, assigned once. `irId` is a position and a reorder renumbers it;
  // `uid` is what a renumbering remaps THROUGH, so it may never be derived from
  // the position. A record arriving with a uid already set (a restored file, a
  // redo) keeps it, and the counter is pushed past it so nothing is reused.
  FeatureRecord& stored = records_.back();
  if (stored.uid == 0) stored.uid = nextUid_++;
  if (stored.uid >= nextUid_) nextUid_ = stored.uid + 1;
  for (const std::string& node : consumedNodes) bindings_.erase(node);
  if (!producedNode.empty()) bindings_[producedNode] = record.irId;
  return true;
}

const FeatureRecord* PartDocument::featureAt(int irId) const noexcept {
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return nullptr;
  return &records_[static_cast<std::size_t>(irId) - 1];
}

bool PartDocument::editFeatureArgs(int irId, const std::vector<IrArg>& args) {
  lastEdit_ = EditCheck::Ok;
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) {
    lastEdit_ = EditCheck::NoSuchFeature;
    return false;
  }
  FeatureRecord& rec = records_[static_cast<std::size_t>(irId) - 1];

  // THE INVARIANT: the set of (position, ref) pairs is identical. Comparing the
  // pairs rather than walking both lists in lockstep is what lets the arg COUNT
  // change -- dropping a trailing keyword must stay legal -- while still making
  // "%4 became %2" and "the ref moved from slot 0 to slot 1" both refusals.
  const auto refPairs = [](const std::vector<IrArg>& v) {
    std::vector<std::pair<std::size_t, int>> out;
    for (std::size_t i = 0; i < v.size(); ++i) {
      if (v[i].kind == IrArgKind::Ref) out.push_back({i, v[i].ref});
    }
    return out;
  };
  if (refPairs(args) != refPairs(rec.line.args)) {
    lastEdit_ = EditCheck::OperandChanged;
    return false;
  }

  // A no-op edit is refused rather than applied, so `perform()` never pushes an
  // undo step that undoes nothing -- a stack whose top entry does nothing when
  // you hit Ctrl+Z reads to a user as a broken undo.
  const IrLine candidate{rec.line.id, rec.line.op, args};
  if (candidate.text() == rec.line.text()) {
    lastEdit_ = EditCheck::NoChange;
    return false;
  }

  // The op table is the authority on arity, and it is DATA transcribed from
  // FeatureTree.hpp -- so this is reachable, not decoration: an edit that hands
  // FILLET six arguments is refused here and not by the compiler three layers
  // down, with the offending document unmutated.
  const IrCheck check = validateIr(candidate);
  lastCheck_ = check;
  if (check != IrCheck::Ok) {
    lastEdit_ = EditCheck::InvalidStatement;
    return false;
  }

  rec.line = candidate;  // no binding, no id and no produces-kind moved
  return true;
}

PartDocument::Snapshot PartDocument::snapshot() const {
  return Snapshot{records_.size(), bindings_};
}

void PartDocument::restore(const Snapshot& state) {
  if (state.records < records_.size()) {
    records_.resize(state.records);
  }
  bindings_ = state.bindings;
}
// ── history state ───────────────────────────────────────────────────────────
std::uint64_t PartDocument::uidOf(int irId) const noexcept {
  const FeatureRecord* rec = featureAt(irId);
  return rec == nullptr ? 0 : rec->uid;
}

int PartDocument::idOfUid(std::uint64_t uid) const noexcept {
  if (uid == 0) return 0;
  for (const FeatureRecord& r : records_) {
    if (r.uid == uid) return r.irId;
  }
  return 0;
}

bool PartDocument::setSuppressed(int irId, bool on) {
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return false;
  records_[static_cast<std::size_t>(irId) - 1].suppressed = on;
  return true;
}

bool PartDocument::setDeleted(int irId, bool on) {
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return false;
  records_[static_cast<std::size_t>(irId) - 1].deleted = on;
  return true;
}

bool PartDocument::setLabel(int irId, const std::string& label) {
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return false;
  records_[static_cast<std::size_t>(irId) - 1].label = label;
  return true;
}

void PartDocument::setRollback(int irId) noexcept {
  // CLAMPED, never refused. A bar dragged past the end of the tree means the end
  // of the tree, and a bar dragged above the first statement means "nothing
  // built" -- both are things a user does on purpose, and neither is an error.
  if (irId < 0) irId = 0;
  // A bar AT or PAST the last statement rolls nothing back, and 0 already means
  // that, so it normalises to 0. Without this the state has two spellings for
  // "off" and `rollback() != 0` -- which is what a menu greys out on and what a
  // rolled-back badge is drawn from -- would be true for a tree that is fully
  // built.
  if (static_cast<std::size_t>(irId) >= records_.size()) irId = 0;
  rollback_ = irId;
}

PartDocument::History PartDocument::captureHistory() const {
  History h;
  h.records = records_;
  h.bindings = bindings_;
  h.rollback = rollback_;
  h.nextUid = nextUid_;
  return h;
}

void PartDocument::restoreHistory(const History& state) {
  records_ = state.records;
  bindings_ = state.bindings;
  rollback_ = state.rollback;
  nextUid_ = state.nextUid;
}

// ── reorder ─────────────────────────────────────────────────────────────────
void PartDocument::moveWindow(int irId, int& first, int& last) const {
  first = 1;
  last = static_cast<int>(records_.size());
  const FeatureRecord* rec = featureAt(irId);
  if (rec == nullptr) {
    first = last = irId;
    return;
  }
  // A statement may not move above any value it reads...
  for (const IrArg& a : rec->line.args) {
    if (a.kind != IrArgKind::Ref) continue;
    if (a.ref + 1 > first) first = a.ref + 1;
  }
  // ...nor below any statement that reads it. TOMBSTONED dependents count: the
  // record is still in the document, its `%N` must still resolve backwards, and
  // un-deleting it must not produce a forward reference.
  for (const FeatureRecord& r : records_) {
    if (r.irId == irId) continue;
    for (const IrArg& a : r.line.args) {
      if (a.kind == IrArgKind::Ref && a.ref == irId && r.irId - 1 < last) last = r.irId - 1;
    }
  }
  if (last < first) last = first;  // a pinned statement: the window is one slot
}

bool PartDocument::moveFeature(int irId, int newPosition, int& clampedTo, int& blockedBy) {
  clampedTo = irId;
  blockedBy = 0;
  const FeatureRecord* rec = featureAt(irId);
  if (rec == nullptr) return false;

  int first = 1;
  int last = static_cast<int>(records_.size());
  moveWindow(irId, first, last);
  int target = newPosition;
  if (target < first) {
    target = first;
    // Name the statement that stopped it. Going UP the blocker is the LAST
    // operand this statement reads; going down it is the FIRST that reads it.
    for (const IrArg& a : rec->line.args) {
      if (a.kind == IrArgKind::Ref && a.ref > blockedBy) blockedBy = a.ref;
    }
  } else if (target > last) {
    target = last;
    for (const FeatureRecord& r : records_) {
      if (r.irId == irId) continue;
      for (const IrArg& a : r.line.args) {
        if (a.kind == IrArgKind::Ref && a.ref == irId &&
            (blockedBy == 0 || r.irId < blockedBy)) {
          blockedBy = r.irId;
        }
      }
    }
  }
  clampedTo = target;
  if (target == irId) return true;  // legal, and a no-op: nothing to renumber

  // Everything below works on a COPY. A renumbering that half-applied would
  // leave the document holding statements whose `%N` mean nothing, and there is
  // no honest way back from that.
  std::vector<FeatureRecord> moved = records_;
  std::map<std::string, int> movedBindings = bindings_;
  const std::uint64_t rollbackUid = rollback_ == 0 ? 0 : uidOf(rollback_);

  // old id -> uid, taken BEFORE anything renumbers.
  std::vector<std::uint64_t> uidAt(records_.size() + 1, 0);
  for (const FeatureRecord& r : records_) {
    uidAt[static_cast<std::size_t>(r.irId)] = r.uid;
  }

  const std::size_t from = static_cast<std::size_t>(irId) - 1;
  const std::size_t to = static_cast<std::size_t>(target) - 1;
  const FeatureRecord carried = moved[from];
  moved.erase(moved.begin() + static_cast<std::ptrdiff_t>(from));
  moved.insert(moved.begin() + static_cast<std::ptrdiff_t>(to), carried);

  // Renumber by position, then remap every reference THROUGH the uid.
  std::map<std::uint64_t, int> newIdOfUid;
  for (std::size_t k = 0; k < moved.size(); ++k) {
    moved[k].irId = static_cast<int>(k) + 1;
    moved[k].line.id = moved[k].irId;
    newIdOfUid[moved[k].uid] = moved[k].irId;
  }
  const auto remap = [&](int oldId) -> int {
    if (oldId <= 0 || static_cast<std::size_t>(oldId) >= uidAt.size()) return 0;
    auto it = newIdOfUid.find(uidAt[static_cast<std::size_t>(oldId)]);
    return it == newIdOfUid.end() ? 0 : it->second;
  };
  for (FeatureRecord& r : moved) {
    for (IrArg& a : r.line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      const int mapped = remap(a.ref);
      if (mapped != 0) a.ref = mapped;
    }
  }
  for (auto& binding : movedBindings) binding.second = remap(binding.second);

  // The window arithmetic above makes every reference backward by construction.
  // This is the check that the arithmetic is right, and it REFUSES rather than
  // committing a document whose statements do not resolve -- naming the
  // statement, so a repair loop has something to act on.
  for (const FeatureRecord& r : moved) {
    if (validateIr(r.line) != IrCheck::Ok) {
      blockedBy = r.irId;
      clampedTo = irId;
      return false;
    }
  }

  records_ = std::move(moved);
  bindings_ = std::move(movedBindings);
  if (rollbackUid != 0) {
    auto it = newIdOfUid.find(rollbackUid);
    rollback_ = it == newIdOfUid.end() ? rollback_ : it->second;
  }
  return true;
}

// ── emission ────────────────────────────────────────────────────────────────
const char* PartDocument::toString(OmitReason reason) noexcept {
  switch (reason) {
    case OmitReason::None:               return "none";
    case OmitReason::Suppressed:         return "suppressed";
    case OmitReason::Deleted:            return "deleted";
    case OmitReason::RolledBack:         return "rolled_back";
    case OmitReason::OperandUnavailable: return "operand_unavailable";
    case OmitReason::Orphaned:           return "orphaned";
  }
  return "none";
}

int PartDocument::EmissionPlan::emittedIdFor(int documentId) const noexcept {
  for (const Emitted& e : emitted_) {
    if (e.documentId == documentId) return e.emittedId;
  }
  return 0;
}

int PartDocument::EmissionPlan::documentIdFor(int emittedId) const noexcept {
  for (const Emitted& e : emitted_) {
    if (e.emittedId == emittedId) return e.documentId;
  }
  return 0;
}

PartDocument::OmitReason PartDocument::EmissionPlan::omitReasonFor(int documentId) const noexcept {
  for (const Omitted& o : omitted_) {
    if (o.documentId == documentId) return o.reason;
  }
  return OmitReason::None;
}

int PartDocument::EmissionPlan::blockingFor(int documentId) const noexcept {
  for (const Omitted& o : omitted_) {
    if (o.documentId == documentId) return o.blockingId;
  }
  return 0;
}

PartDocument::EmissionPlan PartDocument::emissionPlan() const {
  EmissionPlan plan;
  const std::size_t n = records_.size();
  if (n == 0) return plan;

  // Pass 0 -- who has a CONSUMER AT ALL, before suppression is taken into
  // account. A statement nothing consumes is a ROOT: a deliberate standalone body
  // (two bodies in one document, never fused), or the last feature under the
  // rollback bar. A root must NEVER be pruned as an orphan, and without this
  // distinction suppressing anything in a two-body document silently deleted the
  // other body, and rolling back to feature 3 emitted an empty program.
  //
  // TOMBSTONES and ROLLED statements are excluded, because a consumer that is
  // itself gone is not a consumer: deleting the SHELL at the end of a chain makes
  // the HOLE before it the new result, and counting the dead SHELL's reference
  // would prune the whole tree from the tail backwards. Suppressed ones ARE
  // counted, because a suppressed pass-through still forwards a value, and the
  // stand-in protection below is what keeps its operand alive.
  std::vector<bool> consumedInFull(n + 1, false);
  for (const FeatureRecord& r : records_) {
    if (r.deleted) continue;
    if (rollback_ != 0 && r.irId > rollback_) continue;
    for (const IrArg& a : r.line.args) {
      if (a.kind == IrArgKind::Ref && a.ref >= 1 && static_cast<std::size_t>(a.ref) <= n) {
        consumedInFull[static_cast<std::size_t>(a.ref)] = true;
      }
    }
  }

  // `stand[i]` = the DOCUMENT id whose emitted value stands in for statement i.
  // For a kept statement that is itself; for a suppressed or deleted PASS-THROUGH
  // it is whatever its own operand resolved to -- which is what makes suppressing
  // a fillet leave the body it was filleting, rather than deleting the body.
  // 0 means "no value": every consumer of it is broken, and says why.
  std::vector<int> stand(n + 1, 0);
  std::vector<OmitReason> reason(n + 1, OmitReason::None);
  std::vector<int> blocking(n + 1, 0);
  std::vector<int> kept;
  kept.reserve(n);

  for (std::size_t i = 1; i <= n; ++i) {
    const FeatureRecord& rec = records_[i - 1];
    OmitReason why = OmitReason::None;
    if (rec.deleted) {
      why = OmitReason::Deleted;
    } else if (rollback_ != 0 && static_cast<int>(i) > rollback_) {
      why = OmitReason::RolledBack;
    } else if (rec.suppressed) {
      why = OmitReason::Suppressed;
    }

    if (why != OmitReason::None) {
      // A ROLLED statement has no value at all -- the bar means "the tree stops
      // here", not "this feature is transparent" -- so only a suppression or a
      // tombstone rebases.
      const bool mayRebase = (why != OmitReason::RolledBack);
      // PASS-THROUGH REBASE. An op that consumes a value and produces the SAME
      // KIND returns its operand when it is not there -- FILLET, HOLE, SHELL,
      // PATTERN, TRANSLATE, TAG, and CUT/FUSE/COMMON, whose first operand is the
      // target body. An op whose kind CHANGES (EXTRUDE: profile -> solid, LOFT:
      // wire -> solid) has no such operand, so its value genuinely ceases to
      // exist, and every consumer of it is reported broken rather than silently
      // rewired to a profile the kernel would throw on.
      const bool passThrough = mayRebase && !rec.line.args.empty() &&
                               rec.line.args.front().kind == IrArgKind::Ref &&
                               kindOf(rec.line.args.front().ref) == rec.produces &&
                               rec.produces != IrValueKind::None;
      if (passThrough) {
        const int operand = rec.line.args.front().ref;
        if (operand >= 1 && static_cast<std::size_t>(operand) <= n) {
          stand[i] = stand[static_cast<std::size_t>(operand)];
        }
      }
      reason[i] = why;
      continue;
    }

    int missing = 0;
    for (const IrArg& a : rec.line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      if (a.ref < 1 || static_cast<std::size_t>(a.ref) > n ||
          stand[static_cast<std::size_t>(a.ref)] == 0) {
        missing = a.ref;
        break;
      }
    }
    if (missing != 0) {
      reason[i] = OmitReason::OperandUnavailable;
      blocking[i] = missing;
      continue;
    }
    kept.push_back(static_cast<int>(i));
    stand[i] = static_cast<int>(i);
  }

  // Pass 2 -- ORPHAN PRUNE, to a fixpoint. Suppressing an EXTRUDE leaves the
  // RECT it consumed with no consumer, and forge::ft's s0.4 graph-quality gate
  // fails the WHOLE program on "unexplained_orphans". Only statements that WERE
  // consumed before the history state was applied are prunable, so a deliberate
  // second body is never touched.
  //
  // A statement that is the STAND-IN for a later one is also protected. Suppress
  // the SHELL at the end of a chain and the HOLE before it has no consumer left
  // among the kept statements -- but it IS the body the user is looking at,
  // because the suppressed shell forwards to it. Without this the prune walked
  // the whole chain backwards and emitted nothing.
  std::vector<bool> standsInFor(n + 1, false);
  for (std::size_t i = 1; i <= n; ++i) {
    const int target = stand[i];
    if (target >= 1 && static_cast<std::size_t>(target) != i) {
      standsInFor[static_cast<std::size_t>(target)] = true;
    }
  }

  bool changed = true;
  while (changed) {
    changed = false;
    std::vector<bool> consumedNow(n + 1, false);
    for (int k : kept) {
      for (const IrArg& a : records_[static_cast<std::size_t>(k) - 1].line.args) {
        if (a.kind != IrArgKind::Ref) continue;
        const int target = (a.ref >= 1 && static_cast<std::size_t>(a.ref) <= n)
                               ? stand[static_cast<std::size_t>(a.ref)]
                               : 0;
        if (target >= 1) consumedNow[static_cast<std::size_t>(target)] = true;
      }
    }
    for (std::size_t idx = kept.size(); idx > 0; --idx) {
      const int k = kept[idx - 1];
      if (consumedNow[static_cast<std::size_t>(k)]) continue;
      if (standsInFor[static_cast<std::size_t>(k)]) continue;      // it IS the result
      if (!consumedInFull[static_cast<std::size_t>(k)]) continue;  // a root by design
      kept.erase(kept.begin() + static_cast<std::ptrdiff_t>(idx) - 1);
      reason[static_cast<std::size_t>(k)] = OmitReason::Orphaned;
      stand[static_cast<std::size_t>(k)] = 0;
      changed = true;
    }
  }

  // Pass 3 -- number the survivors 1..N and rewrite every reference.
  std::vector<int> emittedIdOf(n + 1, 0);
  int next = 1;
  for (int k : kept) emittedIdOf[static_cast<std::size_t>(k)] = next++;

  std::string out;
  for (int k : kept) {
    const FeatureRecord& rec = records_[static_cast<std::size_t>(k) - 1];
    IrLine line = rec.line;
    line.id = emittedIdOf[static_cast<std::size_t>(k)];
    for (IrArg& a : line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      a.ref = emittedIdOf[static_cast<std::size_t>(stand[static_cast<std::size_t>(a.ref)])];
    }
    out += line.text();
    out += "\n";
    plan.emitted_.push_back(Emitted{k, line.id});
  }
  for (std::size_t i = 1; i <= n; ++i) {
    if (reason[i] == OmitReason::None) continue;
    plan.omitted_.push_back(Omitted{static_cast<int>(i), reason[i], blocking[i]});
  }
  plan.program_ = std::move(out);
  return plan;
}


// ── AppendFeatureEdit (GoF ConcreteCommand + Memento) ───────────────────────
AppendFeatureEdit::AppendFeatureEdit(FeatureRecord record, std::vector<std::string> consumedNodes,
                                     std::string producedNode)
    : record_(std::move(record)),
      consumed_(std::move(consumedNodes)),
      produced_(std::move(producedNode)) {}

bool AppendFeatureEdit::apply(PartDocument& doc) {
  before_ = doc.snapshot();
  // On redo the record keeps its ORIGINAL ir id. An id that drifted on redo
  // would silently rewrite every later `%N` in the program.
  return doc.appendFeature(record_, consumed_, produced_);
}

void AppendFeatureEdit::revert(PartDocument& doc) { doc.restore(before_); }

// ── EditFeatureArgsEdit (GoF ConcreteCommand, self-inverse) ─────────────────
EditFeatureArgsEdit::EditFeatureArgsEdit(int irId, std::vector<IrArg> args, std::string label)
    : irId_(irId), after_(std::move(args)), label_(std::move(label)) {}

bool EditFeatureArgsEdit::apply(PartDocument& doc) {
  const FeatureRecord* rec = doc.featureAt(irId_);
  if (rec == nullptr) return false;
  // Captured on EVERY apply, not only the first, because redo runs apply()
  // again: a `before_` frozen at construction would, after undo-redo-undo,
  // restore an argument list the document no longer had.
  before_ = rec->line.args;
  return doc.editFeatureArgs(irId_, after_);
}

void EditFeatureArgsEdit::revert(PartDocument& doc) {
  // revert() returns void by the UndoableEdit contract, so a refusal here would
  // be unhearable -- which is exactly why apply() had to succeed first: the
  // arguments being put back are the ones the document itself held, so they pass
  // the same ref-pinning and validateIr checks the forward edit passed, and they
  // differ (or editFeatureArgs would have answered NoChange and apply() would
  // have returned false, so this edit would never have been pushed).
  doc.editFeatureArgs(irId_, before_);
}

// ── UndoStack (GoF Caretaker) ───────────────────────────────────────────────
bool UndoStack::perform(PartDocument& doc, std::unique_ptr<UndoableEdit> edit) {
  if (!edit) return false;
  if (!edit->apply(doc)) return false;  // a refused edit is never pushed
  done_.push_back(std::move(edit));
  undone_.clear();  // linear undo: a new edit abandons the redo branch
  return true;
}

bool UndoStack::undo(PartDocument& doc) {
  if (done_.empty()) return false;
  std::unique_ptr<UndoableEdit> edit = std::move(done_.back());
  done_.pop_back();
  edit->revert(doc);
  undone_.push_back(std::move(edit));
  return true;
}

bool UndoStack::redo(PartDocument& doc) {
  if (undone_.empty()) return false;
  std::unique_ptr<UndoableEdit> edit = std::move(undone_.back());
  undone_.pop_back();
  if (!edit->apply(doc)) {
    // The pop above happened BEFORE the outcome was known. Returning here without
    // putting the edit back destructs it: the redo step vanishes from the stack
    // with no message, and the user cannot get that feature back. apply() really
    // does refuse -- AppendFeatureEdit replays its ORIGINAL ir id, and any append
    // that bypassed this stack (PartDocument::seed is public) has taken it.
    undone_.push_back(std::move(edit));
    return false;
  }
  done_.push_back(std::move(edit));
  return true;
}

std::string UndoStack::undoLabel() const {
  return done_.empty() ? std::string() : done_.back()->label();
}

std::string UndoStack::redoLabel() const {
  return undone_.empty() ? std::string() : undone_.back()->label();
}

void UndoStack::clear() noexcept {
  done_.clear();
  undone_.clear();
}

// ── registration ────────────────────────────────────────────────────────────
namespace {

// Resolve the live selection to DISTINCT feature-IR value ids, in selection
// order. An empty result means "this selection does not name IR values of the
// required kind" — which is the question every Part enabled-predicate is really
// asking, and the reason a command can be greyed out even with a signature-legal
// selection (a face of a body that is not in this document, say).
std::vector<int> resolveValues(const PartDocument& doc, const SelectionService& sel,
                               IrValueKind required) {
  std::vector<int> ids;
  for (const EntityRef& ref : sel.selection()) {
    const int id = doc.valueFor(ref.bodyId);
    if (id == 0 || doc.kindOf(id) != required) return {};
    if (std::find(ids.begin(), ids.end(), id) == ids.end()) ids.push_back(id);
  }
  return ids;
}

// The document node the selection belongs to (all refs must agree — a single
// FILLET op takes ONE %body, so two bodies is not one command).
std::string singleNode(const SelectionService& sel) {
  if (sel.selection().empty()) return {};
  const std::string node = sel.selection().front().bodyId;
  for (const EntityRef& ref : sel.selection()) {
    if (ref.bodyId != node) return {};
  }
  return node;
}

// A count is a count only if it is a WHOLE number. Written once because it was
// already written twice -- LINEAR and CIRCULAR each carried their own copy -- and
// then forgotten a third time, which is how GRID came to accept `nx = 1.5`.
// The magnitude test is what makes the cast DEFINED: static_cast<long long> of a
// double outside long long's range is undefined behaviour, and these values come
// straight from user-supplied parameters. It also rejects NaN, since every
// comparison against NaN is false.
bool wholeCount(double v) {
  constexpr double kTwoPow63 = 9223372036854775808.0;  // exactly representable
  if (!(v > -kTwoPow63 && v < kTwoPow63)) return false;
  return v == static_cast<double>(static_cast<long long>(v));
}

double num(const CommandContext& ctx, const char* name, double fallback) {
  return ctx.params().number(name).value_or(fallback);
}
bool flagOn(const CommandContext& ctx, const char* name) {
  return ctx.params().flag(name).value_or(false);
}
std::string txt(const CommandContext& ctx, const char* name, const char* fallback) {
  return ctx.params().text(name).value_or(std::string(fallback));
}
bool hasNumber(const CommandContext& ctx, const char* name) {
  return ctx.params().number(name).has_value();
}

std::string bodyNodeFor(int irId) { return "body_" + std::to_string(irId); }

// Profiles get their own node prefix so a selection can tell a sketch from a solid:
// resolveValues() maps EntityRef::bodyId -> valueFor() -> kindOf(), and a created
// PROFILE has to be addressable by the same route a seeded one is.
std::string sketchNodeFor(int irId) { return "sketch_" + std::to_string(irId); }

// And WIRE sections get a third prefix, for the same reason PROFILE got a second: a
// selection has to be able to tell a 3D loft section from a Z=0 sketch, because LOFT
// consumes the one and EXTRUDE the other and the kernel throws on the swap.
std::string wireNodeFor(int irId) { return "wire_" + std::to_string(irId); }

// One emission == one undoable transaction.
void emit(CommandContext& ctx, PartDocument& doc, UndoStack& stack, const char* commandId,
          const char* label, const char* op, std::vector<IrArg> args, IrValueKind produces,
          const std::vector<std::string>& consumed, const std::string& producedNode) {
  FeatureRecord rec;
  rec.irId = doc.nextIrId();
  rec.commandId = commandId;
  rec.label = label;
  rec.line = IrLine{rec.irId, op, std::move(args)};
  rec.produces = produces;
  const std::string node = producedNode.empty() ? bodyNodeFor(rec.irId) : producedNode;
  // perform() returns whether the edit applied. Discarding it is how a refused feature became
  // a command that reported success and did nothing; appendFeature() is documented to refuse
  // and mutate NOTHING, and it was doing exactly that, unheard.
  if (!stack.perform(doc, std::make_unique<AppendFeatureEdit>(rec, consumed, node))) {
    ctx.fail(std::string("the document refused the statement: ") + toString(doc.lastCheck()));
  }
}

// Shared shape of every solid-editing command: exactly one solid in, the same
// document node out (a fillet does not give you a new body — the body keeps its
// identity and gains history, as it does in every parametric modeller).
struct SolidTarget {
  bool ok = false;
  int value = 0;
  std::string node;
};

SolidTarget solidTarget(const PartDocument& doc, const SelectionService& sel) {
  SolidTarget t;
  const std::vector<int> ids = resolveValues(doc, sel, IrValueKind::Solid);
  const std::string node = singleNode(sel);
  if (ids.size() != 1 || node.empty()) return t;
  t.ok = true;
  t.value = ids.front();
  t.node = node;
  return t;
}

// ── which NUMBER of which statement an edit names ───────────────────────────
// `feature` is a 1-based statement id, and 0 means THE LAST STATEMENT -- the
// feature you just made, which is the one a bare "edit parameters" means in
// every history modeller. `index` counts only the NUMBER arguments, so index 0
// of `CYL(6, 40, 0, 0, -10)` is the radius and index 0 of
// `FILLET(%4, 3, VERTICAL)` is the radius too: the caller never has to know that
// one statement leads with a `%ref` and the other does not.
//
// ONE resolver, used by `enabled` AND by `execute`, so a greyed-out menu item
// and the dispatcher can never disagree about whether a parameter exists.
struct ParamTarget {
  bool ok = false;
  int irId = 0;
  std::size_t argIndex = 0;
};

ParamTarget paramTarget(const PartDocument& doc, const CommandContext& ctx) {
  ParamTarget t;
  const std::vector<FeatureRecord>& recs = doc.records();
  if (recs.empty()) return t;

  const double feature = num(ctx, "feature", 0.0);
  if (!wholeCount(feature)) return t;
  int irId = static_cast<int>(feature);
  if (irId == 0) irId = static_cast<int>(recs.size());
  if (irId < 1 || static_cast<std::size_t>(irId) > recs.size()) return t;

  const double index = num(ctx, "index", 0.0);
  if (!wholeCount(index) || index < 0.0) return t;

  const std::vector<IrArg>& args = recs[static_cast<std::size_t>(irId) - 1].line.args;
  std::size_t numbersSeen = 0;
  for (std::size_t i = 0; i < args.size(); ++i) {
    if (args[i].kind != IrArgKind::Number) continue;
    if (numbersSeen == static_cast<std::size_t>(index)) {
      t.ok = true;
      t.irId = irId;
      t.argIndex = i;
      return t;
    }
    ++numbersSeen;
  }
  return t;  // that statement has no such numeric parameter: not editable
}

// ── which STATEMENT a history operation names ───────────────────────────────
// The same convention paramTarget() uses, and deliberately so: `feature` is a
// 1-based statement id, and 0 means THE LAST STATEMENT -- the feature you just
// made, which is what a bare "suppress this" means. Returns 0 for "no such
// statement", which is what both the enabled predicate and the handler read, so
// a greyed-out menu item and the dispatcher can never disagree.
int historyTarget(const PartDocument& doc, const CommandContext& ctx) {
  const std::vector<FeatureRecord>& recs = doc.records();
  if (recs.empty()) return 0;
  const double feature = num(ctx, "feature", 0.0);
  if (!wholeCount(feature)) return 0;
  int irId = static_cast<int>(feature);
  if (irId == 0) irId = static_cast<int>(recs.size());
  if (irId < 1 || static_cast<std::size_t>(irId) > recs.size()) return 0;
  return irId;
}

// What an undo entry calls a feature. The label if it has one, the op otherwise.
std::string rowName(const FeatureRecord& rec) {
  return rec.label.empty() ? rec.line.op : rec.label;
}

// The FAIL-CLOSED read of a selection-derived value list. solidTarget() already
// gives every solid command this discipline -- it returns ok=false rather than
// indexing -- but three handlers indexed the raw vector instead and relied
// entirely on their enabled predicate having run first. dispatch() does run it,
// but CommandRegistry::find() hands out the descriptor with its public execute,
// so the predicate is a convention, not an enforcement. MEASURED on the code
// before this guard: calling execute() directly with an empty selection exits
// 139 (SIGSEGV) -- resolveValues returns a default-constructed vector whose data
// pointer is null, and front() dereferences it. Not a wrong answer: a crash.
bool requireValues(CommandContext& ctx, const std::vector<int>& ids, std::size_t want) {
  if (ids.size() == want) return true;
  ctx.fail("selection does not resolve to " + std::to_string(want) +
           " feature-IR value(s) of the required kind");
  return false;
}

CommandDescriptor base(const char* id, const char* label, const char* irOp,
                       SelectionSignature signature) {
  CommandDescriptor c;
  c.id = id;
  c.label = label;
  c.category = "Part";
  c.featureIrOp = irOp;
  c.signature = signature;
  c.sideEffect = SideEffectClass::Document;
  c.undo = UndoContract::Transaction;
  c.version = 1;
  return c;
}

}  // namespace

std::size_t registerPartCommands(CommandRegistry& registry, PartDocument& doc,
                                 UndoStack& stack) {
  PartDocument* d = &doc;
  UndoStack* s = &stack;
  std::size_t added = 0;
  const auto add = [&registry, &added](CommandDescriptor c) {
    if (registry.add(std::move(c))) ++added;
  };

  // ── RECTANGLE ─────────────────────────────────────────────────────────────
  // The FIRST value-CREATING command in this registry, and the reason it exists is a
  // measured closure gap rather than a feature request. archie_op_vocabulary.json
  // computes `value_kind_closure.gaps` about itself and reports that PROFILE is consumed
  // by EXTRUDE and REVOLVE while NO user-invocable op produces one -- every one of the 14
  // allowed ops takes a value reference first, and the only kind any of them produces is
  // SOLID. From an empty document no legal program existed: the constraint "emit only what
  // a user can invoke" described an EMPTY LANGUAGE.
  //
  // One profile producer closes it. Seeding RECT alone and driving the existing commands
  // yields RECT -> EXTRUDE -> FUSE -> FILLET -> HOLE -> SHELL -> PATTERN, so this single
  // command makes the whole existing registry reachable from nothing.
  //
  // Takes NO selection (SelectionSignature::none()) because it consumes no value. That is
  // what makes it a creator, and it is the property the registry did not have.
  {
    CommandDescriptor c = base("part.sketch_rect", "Rectangle", "RECT",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{"width", ParamType::Number, true, 40.0, ""});
    c.schema.push_back(ParamSpec{"height", ParamType::Number, true, 30.0, ""});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // A zero or negative side is not a rectangle; the kernel would refuse it and the
      // command must not offer itself as callable when it cannot succeed.
      return num(ctx, "width", 0.0) > 0.0 && num(ctx, "height", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      // The IrArg::num(num(ctx, ...)) calls are INLINE on purpose. The vocabulary
      // generator derives each emitted argument by parsing this lambda and matching
      // `num(ctx, "name", default)`; hoisting them into locals makes it see a bare `w`
      // and REFUSE with "unparsed numeric argument" rather than guess. Refusing is the
      // right behaviour, so the command is written the way the tool can read.
      std::vector<IrArg> args{IrArg::num(num(ctx, "width", 40.0)),
                              IrArg::num(num(ctx, "height", 30.0))};
      // RECT(w, h [, cx=0, cy=0]) -- emit the centre only when it is not the default, so
      // the emitted form matches what the vocabulary records as this command's minimal
      // argument count and Archie is not trained to pad every statement.
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
      }
      emit(ctx, *d, *s, "part.sketch_rect", "Rectangle", "RECT", std::move(args),
           IrValueKind::Profile, {}, sketchNodeFor(d->nextIrId()));
    };
    add(std::move(c));
  }

  // ── CIRCLE ────────────────────────────────────────────────────────────────
  // The second PROFILE producer. RECT alone makes the language non-empty; it does not
  // make it expressive -- every revolve, every round boss and every cylindrical part
  // starts from a circle, and with only RECT reachable none of them could be authored.
  {
    CommandDescriptor c = base("part.sketch_circle", "Circle", "CIRCLE",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{"radius", ParamType::Number, true, 10.0, ""});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) { return num(ctx, "radius", 0.0) > 0.0; };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args{IrArg::num(num(ctx, "radius", 10.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
      }
      emit(ctx, *d, *s, "part.sketch_circle", "Circle", "CIRCLE", std::move(args),
           IrValueKind::Profile, {}, sketchNodeFor(d->nextIrId()));
    };
    add(std::move(c));
  }

  // ── SECTION RING ──────────────────────────────────────────────────────────
  // The WIRE producer, and the second half of a two-part fix. WIRE was the last open
  // value-kind gap in `archie_op_vocabulary.json`: LOFT consumes it and nothing a user
  // could invoke produced one. But a producer ALONE would not have made LOFT reachable,
  // because `part.loft` was resolving PROFILE values -- the defect the vocabulary already
  // recorded as `command_feeds_the_wrong_value_kind`. The kernel settles which of the two
  // is wrong, and it is not ambiguous: FeatureTreeCompiler.cpp's opLoft() takes every
  // %ref through refWire(), which throws unless the value's kind is Val::Wire, and
  // Builder::kindOf() gives Val::Wire to exactly two ops -- Ring and Wire. MEASURED
  // through the native verifier (forge_verify -> forge::ft::compileText):
  //     RECT(40,40); CIRCLE(10); LOFT(%1,%2)   -> ok=false,
  //         "LOFT: %1 is not a WIRE section (use RING(...) or WIRE([...]))"
  //     RING(20,20,0); RING(10,10,30); LOFT(%1,%2) -> ok=true, volume 21928.4
  // So this is NOT the command being deliberately widened; it is a statement forge::ui
  // called well-formed and forge::ft refused. `part.loft` is corrected below.
  //
  // RING rather than WIRE because WIRE([x y z; ...]) needs a POINTS token, and FeatureIr.hpp
  // deliberately does not model IrArgKind::Points ("a token kind nothing produces is a
  // liability, not coverage"). RING is all numbers, so it emits through the existing
  // IrArg::num path -- and its `z` is the whole point: the Z=0 sketcher cannot express a
  // section at another height, which is what makes a loft a loft.
  //
  // Takes NO selection, like the other two creators: it consumes no value.
  {
    CommandDescriptor c = base("part.section_ring", "Section Ring", "RING",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{"rx", ParamType::Number, true, 20.0, ""});
    c.schema.push_back(ParamSpec{"ry", ParamType::Number, true, 20.0, ""});
    c.schema.push_back(ParamSpec{"z", ParamType::Number, true, 0.0, ""});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"p", ParamType::Number, false, 2.0, ""});
    c.schema.push_back(ParamSpec{"seg", ParamType::Number, false, 48.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // wireRing() throws on rx <= 0 or ry <= 0, so the command must not offer itself
      // as callable there. It also SILENTLY CLAMPS p to >= 2 and seg to >= 8, which is
      // worse than a throw for a UI: the statement would be recorded saying one thing
      // and the kernel would build another. Refuse those instead of emitting a lie.
      return num(ctx, "rx", 0.0) > 0.0 && num(ctx, "ry", 0.0) > 0.0 &&
             num(ctx, "p", 2.0) >= 2.0 && num(ctx, "seg", 48.0) >= 8.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args{IrArg::num(num(ctx, "rx", 20.0)), IrArg::num(num(ctx, "ry", 20.0)),
                              IrArg::num(num(ctx, "z", 0.0))};
      // RING(rx, ry, z [, cx=0, cy=0, p=2, seg=48]) -- the four optional arguments are
      // POSITIONAL, so they are emitted as ONE group or not at all. Emitting `p` without
      // cx/cy would put the superellipse exponent in the cx slot: a statement the kernel
      // accepts and reads as a different ring.
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "p") ||
          hasNumber(ctx, "seg")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "p", 2.0)));
        args.push_back(IrArg::num(num(ctx, "seg", 48.0)));
      }
      emit(ctx, *d, *s, "part.section_ring", "Section Ring", "RING", std::move(args),
           IrValueKind::Wire, {}, wireNodeFor(d->nextIrId()));
    };
    add(std::move(c));
  }

  // ── MOVE ──────────────────────────────────────────────────────────────────
  // TRANSLATE was ORPHAN, and that is more serious than one missing command: with no
  // way to POSITION a body, every boolean in this registry operated on solids coincident
  // at the origin. FUSE, CUT and COMMON were reachable but not USEFUL -- two boxes both
  // at the origin have nothing interesting to subtract. This is also the op class behind
  // the derived-placement sub-task this programme measured as the hardest thing Archie
  // has to learn, so leaving it unreachable made that failure permanent by construction.
  //
  // Like every other solid-editing command it keeps the body's IDENTITY: the node is
  // consumed and reproduced, so the body gains history rather than becoming a new body.
  {
    CommandDescriptor c = base("part.move", "Move Body", "TRANSLATE",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{"dx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"dy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"dz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      // A zero move is a no-op statement in the history; refuse it rather than record it.
      return solidTarget(*d, ctx.selection()).ok &&
             (num(ctx, "dx", 0.0) != 0.0 || num(ctx, "dy", 0.0) != 0.0 ||
              num(ctx, "dz", 0.0) != 0.0);
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      if (!t.ok) { ctx.fail("selection does not resolve to one solid"); return; }
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::num(num(ctx, "dx", 0.0)),
                              IrArg::num(num(ctx, "dy", 0.0)), IrArg::num(num(ctx, "dz", 0.0))};
      emit(ctx, *d, *s, "part.move", "Move Body", "TRANSLATE", std::move(args),
           IrValueKind::Solid, {t.node}, t.node);
    };
    add(std::move(c));
  }

  // ── EXTRUDE ───────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.extrude", "Extrude", "EXTRUDE",
                               SelectionSignature::exactly(EntityKind::Sketch, 1));
    // hasDefault, so a GESTURE can run this command. ForgeShell::invoke() fills
    // only the parameters whose spec says the default MEANS something, and the
    // braced-positional ParamSpec form below stops before that flag, so every
    // required Part parameter defaulted to hasDefault=false and every keyboard
    // shortcut for a Part command died on missing_required_parameter before the
    // handler ran. The three values here are not invented: they are the honest
    // defaults the retired ForgeShell model.* stubs already declared and shipped
    // (distance 10, radius 1, thickness 2), moved onto the commands that emit IR.
    c.schema.push_back(ParamSpec{.name = "distance",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 10.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{"dirx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"diry", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"dirz", ParamType::Number, false, 1.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      return resolveValues(*d, ctx.selection(), IrValueKind::Profile).size() == 1 &&
             num(ctx, "distance", 0.0) != 0.0;  // a zero-height extrude is not a solid
    };
    c.execute = [d, s](CommandContext& ctx) {
      const std::vector<int> profiles = resolveValues(*d, ctx.selection(), IrValueKind::Profile);
      if (!requireValues(ctx, profiles, 1)) return;
      const int profile = profiles.front();
      std::vector<IrArg> args{IrArg::valueRef(profile), IrArg::num(num(ctx, "distance", 10.0))};
      if (hasNumber(ctx, "dirx") || hasNumber(ctx, "diry") || hasNumber(ctx, "dirz")) {
        args.push_back(IrArg::num(num(ctx, "dirx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "diry", 0.0)));
        args.push_back(IrArg::num(num(ctx, "dirz", 1.0)));
      }
      emit(ctx, *d, *s, "part.extrude", "Extrude", "EXTRUDE", std::move(args), IrValueKind::Solid,
           {}, {});
    };
    add(std::move(c));
  }

  // ── REVOLVE ───────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.revolve", "Revolve", "REVOLVE",
                               SelectionSignature::exactly(EntityKind::Sketch, 1));
    c.schema.push_back(ParamSpec{"angle", ParamType::Number, true, 360.0, ""});
    c.schema.push_back(ParamSpec{"axx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axy", ParamType::Number, false, 1.0, ""});
    c.schema.push_back(ParamSpec{"axz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      const double a = num(ctx, "angle", 0.0);
      // REVOLVE's documented domain is 0 < a <= 360.
      return resolveValues(*d, ctx.selection(), IrValueKind::Profile).size() == 1 && a > 0.0 &&
             a <= 360.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const std::vector<int> profiles = resolveValues(*d, ctx.selection(), IrValueKind::Profile);
      if (!requireValues(ctx, profiles, 1)) return;
      const int profile = profiles.front();
      std::vector<IrArg> args{IrArg::valueRef(profile), IrArg::num(num(ctx, "angle", 360.0))};
      if (hasNumber(ctx, "axx") || hasNumber(ctx, "axy") || hasNumber(ctx, "axz")) {
        args.push_back(IrArg::num(0.0));  // ox, oy, oz — origin of the axis line
        args.push_back(IrArg::num(0.0));
        args.push_back(IrArg::num(0.0));
        args.push_back(IrArg::num(num(ctx, "axx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axy", 1.0)));
        args.push_back(IrArg::num(num(ctx, "axz", 0.0)));
      }
      emit(ctx, *d, *s, "part.revolve", "Revolve", "REVOLVE", std::move(args), IrValueKind::Solid,
           {}, {});
    };
    add(std::move(c));
  }

  // ── LOFT ──────────────────────────────────────────────────────────────────
  // This command used to resolve PROFILE and emit LOFT(%sketch, %sketch). That statement
  // passes validateIr() and is REFUSED BY THE KERNEL: opLoft() reads every %ref through
  // refWire(), which throws "%N is not a WIRE section (use RING(...) or WIRE([...]))"
  // unless Builder::kindOf() made the value Val::Wire -- and only Ring and Wire do.
  // Reproduced through forge_verify on the real compiler (see part.section_ring above):
  // the profile form fails at op %3, the ring form builds a solid. So the value kind is
  // corrected here to the one the kernel documents and enforces, and part.section_ring
  // supplies the sections. Fixing one without the other leaves LOFT unreachable either
  // way -- a wrong-kind command with a producer, or a right-kind command with nothing
  // to select.
  {
    CommandDescriptor c = base("part.loft", "Loft", "LOFT",
                               SelectionSignature::atLeast(EntityKind::Wire, 2));
    c.schema.push_back(ParamSpec{"ruled", ParamType::Flag, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"open", ParamType::Flag, false, 0.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return resolveValues(*d, ctx.selection(), IrValueKind::Wire).size() >= 2;
    };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args;
      for (int section : resolveValues(*d, ctx.selection(), IrValueKind::Wire)) {
        args.push_back(IrArg::valueRef(section));
      }
      if (flagOn(ctx, "ruled")) args.push_back(IrArg::keyword("RULED"));
      if (flagOn(ctx, "open")) args.push_back(IrArg::keyword("OPEN"));
      emit(ctx, *d, *s, "part.loft", "Loft", "LOFT", std::move(args), IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── HOLE ──────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.hole", "Hole", "HOLE",
                               SelectionSignature::atLeast(EntityKind::Face, 1));
    c.schema.push_back(ParamSpec{"diameter", ParamType::Number, true, 6.0, ""});
    c.schema.push_back(ParamSpec{"x", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"y", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"z", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"depth", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "diameter", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::num(num(ctx, "diameter", 6.0)),
                              IrArg::num(num(ctx, "x", 0.0)), IrArg::num(num(ctx, "y", 0.0)),
                              IrArg::num(num(ctx, "z", 0.0))};
      if (hasNumber(ctx, "depth")) {
        args.push_back(IrArg::num(0.0));  // axis: +Z
        args.push_back(IrArg::num(0.0));
        args.push_back(IrArg::num(1.0));
        args.push_back(IrArg::num(num(ctx, "depth", 0.0)));  // <= 0 => through
      }
      emit(ctx, *d, *s, "part.hole", "Hole", "HOLE", std::move(args), IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── COUNTERBORE ───────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.counterbore", "Counterbore Hole", "CBORE",
                               SelectionSignature::atLeast(EntityKind::Face, 1));
    c.schema.push_back(ParamSpec{"diameter", ParamType::Number, true, 6.0, ""});
    c.schema.push_back(ParamSpec{"cbore_diameter", ParamType::Number, true, 11.0, ""});
    c.schema.push_back(ParamSpec{"cbore_depth", ParamType::Number, true, 6.0, ""});
    c.schema.push_back(ParamSpec{"x", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"y", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"z", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      // A counterbore narrower than its own through-hole is not a counterbore.
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "diameter", 0.0) > 0.0 &&
             num(ctx, "cbore_diameter", 0.0) > num(ctx, "diameter", 0.0) &&
             num(ctx, "cbore_depth", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value),
                              IrArg::num(num(ctx, "diameter", 6.0)),
                              IrArg::num(num(ctx, "cbore_diameter", 11.0)),
                              IrArg::num(num(ctx, "cbore_depth", 6.0)),
                              IrArg::num(num(ctx, "x", 0.0)),
                              IrArg::num(num(ctx, "y", 0.0)),
                              IrArg::num(num(ctx, "z", 0.0))};
      emit(ctx, *d, *s, "part.counterbore", "Counterbore Hole", "CBORE", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── FILLET ────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.fillet", "Edge Fillet", "FILLET",
                               SelectionSignature::atLeast(EntityKind::Edge, 1));
    // hasDefault: see part.extrude above -- 1 mm is the fillet radius the retired
    // model.fillet stub declared, and it is what makes R / Ctrl+B run.
    c.schema.push_back(ParamSpec{.name = "radius",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 1.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{"selector", ParamType::Text, false, 0.0, "ALL"});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "radius", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      const std::string sel = txt(ctx, "selector", "ALL");
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::num(num(ctx, "radius", 1.0))};
      // ALL|VERTICAL|RIM|CONVEX are bare keywords; anything else is a quoted
      // face/edge selector resolved against the live inventory at compile time.
      args.push_back(sel == "ALL" || sel == "VERTICAL" || sel == "RIM" || sel == "CONVEX"
                         ? IrArg::keyword(sel)
                         : IrArg::text(sel));
      emit(ctx, *d, *s, "part.fillet", "Edge Fillet", "FILLET", std::move(args), IrValueKind::Solid,
           {}, t.node);
    };
    add(std::move(c));
  }

  // ── CHAMFER ───────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.chamfer", "Edge Chamfer", "CHAMFER",
                               SelectionSignature::atLeast(EntityKind::Edge, 1));
    c.schema.push_back(ParamSpec{"distance", ParamType::Number, true, 1.0, ""});
    c.schema.push_back(ParamSpec{"selector", ParamType::Text, false, 0.0, "ALL"});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "distance", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      const std::string sel = txt(ctx, "selector", "ALL");
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::num(num(ctx, "distance", 1.0))};
      args.push_back(sel == "ALL" || sel == "VERTICAL" || sel == "RIM" || sel == "CONVEX"
                         ? IrArg::keyword(sel)
                         : IrArg::text(sel));
      emit(ctx, *d, *s, "part.chamfer", "Edge Chamfer", "CHAMFER", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── VARIABLE FILLET ───────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.variable_fillet", "Variable Fillet", "BLEND",
                               SelectionSignature::atLeast(EntityKind::Edge, 1));
    c.schema.push_back(ParamSpec{"radius_start", ParamType::Number, true, 1.0, ""});
    c.schema.push_back(ParamSpec{"radius_end", ParamType::Number, true, 3.0, ""});
    c.schema.push_back(ParamSpec{"smooth", ParamType::Flag, false, 0.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "radius_start", 0.0) > 0.0 &&
             num(ctx, "radius_end", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value),
                              IrArg::num(num(ctx, "radius_start", 1.0)),
                              IrArg::num(num(ctx, "radius_end", 3.0))};
      // BLEND's args are positional: SMOOTH cannot be reached without naming the
      // selector slot before it.
      if (flagOn(ctx, "smooth")) {
        args.push_back(IrArg::keyword("ALL"));
        args.push_back(IrArg::keyword("SMOOTH"));
      }
      emit(ctx, *d, *s, "part.variable_fillet", "Variable Fillet", "BLEND", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── SHELL ─────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.shell", "Shell Body", "SHELL",
                               SelectionSignature::atLeast(EntityKind::Face, 1));
    // hasDefault: see part.extrude above -- 2 mm is the wall the retired
    // model.shell stub declared, and it is what makes Ctrl+Shift+H run.
    c.schema.push_back(ParamSpec{.name = "thickness",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 2.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{"open_axx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"open_axy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"open_axz", ParamType::Number, false, -1.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "thickness", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::num(num(ctx, "thickness", 2.0))};
      if (hasNumber(ctx, "open_axx") || hasNumber(ctx, "open_axy") ||
          hasNumber(ctx, "open_axz")) {
        args.push_back(IrArg::num(num(ctx, "open_axx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "open_axy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "open_axz", -1.0)));
      }
      emit(ctx, *d, *s, "part.shell", "Shell Body", "SHELL", std::move(args), IrValueKind::Solid, {},
           t.node);
    };
    add(std::move(c));
  }

  // ── LINEAR PATTERN ────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.pattern_linear", "Linear Pattern", "PATTERN",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{"count", ParamType::Number, true, 2.0, ""});
    c.schema.push_back(ParamSpec{"dx", ParamType::Number, true, 10.0, ""});
    c.schema.push_back(ParamSpec{"dy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"dz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      const double n = num(ctx, "count", 0.0);
      // A one-instance pattern is a no-op feature, and a fractional count is not
      // a count: both are refused rather than emitted and left to the kernel.
      return solidTarget(*d, ctx.selection()).ok && n >= 2.0 && wholeCount(n);
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::keyword("LINEAR"),
                              IrArg::num(num(ctx, "count", 2.0)),
                              IrArg::num(num(ctx, "dx", 10.0))};
      if (hasNumber(ctx, "dy") || hasNumber(ctx, "dz")) {
        args.push_back(IrArg::num(num(ctx, "dy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "dz", 0.0)));
      }
      emit(ctx, *d, *s, "part.pattern_linear", "Linear Pattern", "PATTERN", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── CIRCULAR PATTERN ──────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.pattern_circular", "Circular Pattern", "PATTERN",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{"count", ParamType::Number, true, 4.0, ""});
    c.schema.push_back(ParamSpec{"total_angle", ParamType::Number, false, 360.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      const double n = num(ctx, "count", 0.0);
      const double a = num(ctx, "total_angle", 360.0);
      return solidTarget(*d, ctx.selection()).ok && n >= 2.0 && wholeCount(n) && a > 0.0 &&
             a <= 360.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::keyword("POLAR"),
                              IrArg::num(num(ctx, "count", 4.0)),
                              IrArg::num(num(ctx, "total_angle", 360.0))};
      emit(ctx, *d, *s, "part.pattern_circular", "Circular Pattern", "PATTERN", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── GRID PATTERN ──────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.pattern_grid", "Grid Pattern", "PATTERN",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{"nx", ParamType::Number, true, 2.0, ""});
    c.schema.push_back(ParamSpec{"ny", ParamType::Number, true, 2.0, ""});
    c.schema.push_back(ParamSpec{"dx", ParamType::Number, true, 10.0, ""});
    c.schema.push_back(ParamSpec{"dy", ParamType::Number, true, 10.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      const double nx = num(ctx, "nx", 0.0);
      const double ny = num(ctx, "ny", 0.0);
      return solidTarget(*d, ctx.selection()).ok && nx >= 1.0 && ny >= 1.0 &&
             wholeCount(nx) && wholeCount(ny) && nx * ny >= 2.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value),   IrArg::keyword("GRID"),
                              IrArg::num(num(ctx, "nx", 2.0)), IrArg::num(num(ctx, "ny", 2.0)),
                              IrArg::num(num(ctx, "dx", 10.0)), IrArg::num(num(ctx, "dy", 10.0))};
      emit(ctx, *d, *s, "part.pattern_grid", "Grid Pattern", "PATTERN", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── MIRROR ────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.mirror", "Mirror Body", "MIRROR",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{"plane", ParamType::Text, true, 0.0, "XY"});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      const std::string p = txt(ctx, "plane", "");
      // MIRROR's keyword form accepts exactly these three principal planes.
      return solidTarget(*d, ctx.selection()).ok && (p == "XY" || p == "YZ" || p == "XZ");
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::keyword(txt(ctx, "plane", "XY"))};
      emit(ctx, *d, *s, "part.mirror", "Mirror Body", "MIRROR", std::move(args), IrValueKind::Solid,
           {}, t.node);
    };
    add(std::move(c));
  }

  // ── BOOLEANS ──────────────────────────────────────────────────────────────
  // Selection ORDER is load-bearing for CUT: the first pick is the target, the
  // second is the tool. The tool body is consumed — its node stops resolving,
  // which is what stops a later command from filleting a body that no longer
  // exists.
  struct BoolSpec {
    const char* id;
    const char* label;
    const char* op;
  };
  const BoolSpec booleans[] = {
      {"part.boolean_union", "Union", "FUSE"},
      {"part.boolean_subtract", "Subtract", "CUT"},
      {"part.boolean_intersect", "Intersect", "COMMON"},
  };
  for (const BoolSpec& b : booleans) {
    CommandDescriptor c = base(b.id, b.label, b.op,
                               SelectionSignature::exactly(EntityKind::Body, 2));
    c.preview = PreviewPolicy::None;
    c.enabled = [d](const CommandContext& ctx) {
      return resolveValues(*d, ctx.selection(), IrValueKind::Solid).size() == 2;
    };
    const std::string id = b.id;
    const std::string label = b.label;
    const std::string op = b.op;
    c.execute = [d, s, id, label, op](CommandContext& ctx) {
      const std::vector<int> ids = resolveValues(*d, ctx.selection(), IrValueKind::Solid);
      if (!requireValues(ctx, ids, 2)) return;
      // front() below is safe ONLY because of the line above: resolveValues walks
      // the selection, so two distinct ids cannot come from an empty selection.
      const std::string targetNode = ctx.selection().selection().front().bodyId;
      std::string toolNode;
      for (const EntityRef& ref : ctx.selection().selection()) {
        if (ref.bodyId != targetNode) {
          toolNode = ref.bodyId;
          break;
        }
      }
      FeatureRecord rec;
      rec.irId = d->nextIrId();
      rec.commandId = id;
      rec.label = label;
      rec.line = IrLine{rec.irId, op, {IrArg::valueRef(ids[0]), IrArg::valueRef(ids[1])}};
      rec.produces = IrValueKind::Solid;
      if (!s->perform(*d, std::make_unique<AppendFeatureEdit>(
                              rec, std::vector<std::string>{toolNode}, targetNode))) {
        ctx.fail(std::string("the document refused the statement: ") + toString(d->lastCheck()));
      }
    };
    add(std::move(c));
  }

  // ── UNDO / REDO ARE NOT REGISTERED HERE ───────────────────────────────────
  // There used to be `part.undo` and `part.redo` in this list, driving the very
  // stack `s` points at. They were registered here when ForgeShell's own
  // `edit.undo` was a counter stub (`--doc_.undoDepth; ++doc_.redoDepth; ...`)
  // that touched no document at all.
  //
  // ForgeShell::DocumentHost closed that: `edit.undo` now calls
  // documentUndo() on whoever owns the document, and in the application that is
  // ForgeFrame, whose documentUndo() runs THIS UndoStack and then re-tessellates.
  // So the registry held TWO Undo commands over ONE stack -- two menu entries
  // both labelled "Undo", only one of them carrying Ctrl+Z, and only one of them
  // driving the viewport rebuild. One undo stack means one Undo command, and the
  // one that survives is the one the keyboard, the status strip and the geometry
  // already go through.
  //
  // The caretaker itself is unchanged and still public: UndoStack::undo/redo are
  // what documentUndo()/documentRedo() call.
  // ── EDIT FEATURE PARAMETER ────────────────────────────────────────────────
  // The command that makes the document PARAMETRIC. Every other Part command
  // appends; appendFeature() refuses anything not numbered nextIrId(), so before
  // this the only way to change the plate from 80 x 50 to 120 x 50 was to build
  // a new document. Worse, the app's starting part is five SEEDED statements, so
  // undo could not reach them at all -- the bore diameter of the part the user
  // opens on was unreachable by any user action.
  //
  // Takes NO selection: a feature is named by its statement id, which is what
  // the feature tree, a macro, a .fpart and Archie all already have. Requiring a
  // viewport pick would make the tree row -- the thing a user actually clicks to
  // edit a feature -- the one place that could not invoke it.
  //
  // `featureIrOp` is empty for the same reason part.undo's is: it emits no new
  // statement, it rewrites one that is already there.
  {
    CommandDescriptor c = base("part.edit_feature", "Edit Feature Parameter", "",
                               SelectionSignature::none());
    // `feature` and `index` HAVE honest defaults (the last statement, its first
    // number) so a bare invocation is meaningful. `value` has none: there is no
    // default new value for a parameter, and inventing one would let a menu click
    // silently resize the part.
    c.schema.push_back(ParamSpec{.name = "feature", .type = ParamType::Number,
                                 .required = false, .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "index", .type = ParamType::Number,
                                 .required = false, .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "value", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 0.0, .hasDefault = false});
    c.preview = PreviewPolicy::Live;
    // STRUCTURE only, never the value. "Is there a number here to edit?" is the
    // question a greyed menu item answers; "does 0 make a solid?" is the
    // modeller's, and answering it here would grey out a legal keystroke.
    c.enabled = [d](const CommandContext& ctx) { return paramTarget(*d, ctx).ok; };
    c.execute = [d, s](CommandContext& ctx) {
      const ParamTarget t = paramTarget(*d, ctx);
      const FeatureRecord* rec = t.ok ? d->featureAt(t.irId) : nullptr;
      if (rec == nullptr) {
        ctx.fail("no numeric parameter at that feature/index");
        return;
      }
      std::vector<IrArg> args = rec->line.args;
      args[t.argIndex] = IrArg::num(num(ctx, "value", 0.0));
      std::string label = "Edit " + (rec->label.empty() ? rec->line.op : rec->label);
      if (!s->perform(*d, std::make_unique<EditFeatureArgsEdit>(t.irId, std::move(args),
                                                               std::move(label)))) {
        ctx.fail(std::string("the document refused the edit: ") + toString(d->lastEdit()));
      }
    };
    add(std::move(c));
  }

  // ── HISTORY OPERATIONS ────────────────────────────────────────────────────
  // Everything below turns the record list into a HISTORY. None of them emits a
  // statement -- they change which statements the document EMITS, and in one case
  // what order it emits them in -- so `featureIrOp` is empty for the same reason
  // part.edit_feature's is.
  //
  // They all take the feature by STATEMENT ID rather than by selection, because
  // the thing a user clicks to suppress a feature is its TREE ROW, and a row
  // knows its id. Requiring a viewport pick would make the tree the one surface
  // that could not drive them.
  //
  // THE BINDING CONSTRAINT applies hardest here: not one of these refuses an
  // edit because of its consequences. FeatureHistory.hpp's preview* functions
  // report what breaks, the UI shows it, and the user proceeds.

  // ── SUPPRESS ──────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.suppress_feature", "Suppress Feature", "",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "feature", .type = ParamType::Number,
                                 .required = false, .defaultNumber = 0.0, .hasDefault = true});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      const int irId = historyTarget(*d, ctx);
      const FeatureRecord* rec = irId == 0 ? nullptr : d->featureAt(irId);
      return rec != nullptr && !rec->suppressed && !rec->deleted;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const int irId = historyTarget(*d, ctx);
      const FeatureRecord* rec = irId == 0 ? nullptr : d->featureAt(irId);
      if (rec == nullptr) { ctx.fail("no such feature"); return; }
      if (!s->perform(*d, std::make_unique<SuppressFeatureEdit>(
                              irId, true, "Suppress " + rowName(*rec)))) {
        ctx.fail("that feature is already suppressed");
      }
    };
    add(std::move(c));
  }

  // ── UNSUPPRESS ────────────────────────────────────────────────────────────
  // A separate command, not a flag on the one above. A menu shows one of the two
  // greyed out, which is the state a user reads; a single toggle whose label
  // depends on the target is a control that means two things.
  {
    CommandDescriptor c = base("part.unsuppress_feature", "Unsuppress Feature", "",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "feature", .type = ParamType::Number,
                                 .required = false, .defaultNumber = 0.0, .hasDefault = true});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      const int irId = historyTarget(*d, ctx);
      const FeatureRecord* rec = irId == 0 ? nullptr : d->featureAt(irId);
      return rec != nullptr && rec->suppressed;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const int irId = historyTarget(*d, ctx);
      const FeatureRecord* rec = irId == 0 ? nullptr : d->featureAt(irId);
      if (rec == nullptr) { ctx.fail("no such feature"); return; }
      if (!s->perform(*d, std::make_unique<SuppressFeatureEdit>(
                              irId, false, "Unsuppress " + rowName(*rec)))) {
        ctx.fail("that feature is not suppressed");
      }
    };
    add(std::move(c));
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  // A TOMBSTONE, not an erasure, and the difference is the whole safety property:
  // `irId` is a position and every later `%N` is written against it, so compacting
  // the list would rewrite what every surviving statement means. The record stays,
  // the row leaves the tree, and the emitted program renumbers around it.
  //
  // It does NOT refuse a delete whose dependents break. FeatureHistory::
  // previewDelete() reports exactly which ones and why, the app shows it before
  // the click, and afterwards each broken row says which operand went missing.
  {
    CommandDescriptor c = base("part.delete_feature", "Delete Feature", "",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "feature", .type = ParamType::Number,
                                 .required = false, .defaultNumber = 0.0, .hasDefault = true});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      const int irId = historyTarget(*d, ctx);
      const FeatureRecord* rec = irId == 0 ? nullptr : d->featureAt(irId);
      return rec != nullptr && !rec->deleted;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const int irId = historyTarget(*d, ctx);
      const FeatureRecord* rec = irId == 0 ? nullptr : d->featureAt(irId);
      if (rec == nullptr) { ctx.fail("no such feature"); return; }
      if (!s->perform(*d, std::make_unique<DeleteFeatureEdit>(
                              irId, "Delete " + rowName(*rec)))) {
        ctx.fail("that feature is already deleted");
      }
    };
    add(std::move(c));
  }

  // ── RENAME ────────────────────────────────────────────────────────────────
  // The TREE-ROW name. It is not the persistent name: this is a label a human
  // reads, and part.tag_feature below is the one that binds a name the KERNEL
  // resolves through face signatures. Both exist because they answer different
  // questions -- "which row is this" and "which face did I mean".
  {
    CommandDescriptor c = base("part.rename_feature", "Rename Feature", "",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "feature", .type = ParamType::Number,
                                 .required = false, .defaultNumber = 0.0, .hasDefault = true});
    // No default: there is no honest default name for a feature, and inventing
    // one would let a menu click rewrite a row the user did not mean to touch.
    c.schema.push_back(ParamSpec{.name = "name", .type = ParamType::Text,
                                 .required = true, .defaultNumber = 0.0, .hasDefault = false});
    c.preview = PreviewPolicy::None;
    c.enabled = [d](const CommandContext& ctx) {
      return historyTarget(*d, ctx) != 0 && !txt(ctx, "name", "").empty();
    };
    c.execute = [d, s](CommandContext& ctx) {
      const int irId = historyTarget(*d, ctx);
      if (irId == 0) { ctx.fail("no such feature"); return; }
      if (!s->perform(*d, std::make_unique<RenameFeatureEdit>(
                              irId, txt(ctx, "name", ""), "Rename Feature"))) {
        ctx.fail("that feature already has that name");
      }
    };
    add(std::move(c));
  }

  // ── ROLLBACK ──────────────────────────────────────────────────────────────
  // The rollback bar: build the tree up to and including this statement, and stop.
  // Everything after it is ROLLED, not lost, and comes back when the bar moves.
  // The position CLAMPS into the tree rather than being refused -- a bar dragged
  // past the end means the end, in every modeller that has one.
  {
    CommandDescriptor c = base("part.rollback_to", "Roll Back To Feature", "",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "feature", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 0.0, .hasDefault = false});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return !d->records().empty() && wholeCount(num(ctx, "feature", -1.0)) &&
             num(ctx, "feature", -1.0) >= 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      if (!s->perform(*d, std::make_unique<RollbackEdit>(
                              static_cast<int>(num(ctx, "feature", 0.0)), "Roll Back"))) {
        ctx.fail("the rollback bar is already there");
      }
    };
    add(std::move(c));
  }

  // ── ROLL FORWARD ──────────────────────────────────────────────────────────
  // Put the bar back at the end of the tree. Its own command rather than
  // `rollback_to(0)` because 0 means "before the first statement" there, and a
  // single control whose extremes both mean "off" is a control nobody can aim.
  {
    CommandDescriptor c = base("part.rollback_end", "Roll Forward To End", "",
                               SelectionSignature::none());
    c.preview = PreviewPolicy::None;
    c.enabled = [d](const CommandContext& ctx) {
      (void)ctx;
      return d->rollback() != 0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      if (!s->perform(*d, std::make_unique<RollbackEdit>(
                              static_cast<int>(d->records().size()), "Roll Forward"))) {
        ctx.fail("the tree is not rolled back");
      }
    };
    add(std::move(c));
  }

  // ── REORDER ───────────────────────────────────────────────────────────────
  // The one history operation that renumbers, because in this IR a statement's
  // POSITION is its `%N`. `position` is 1-based and is CLAMPED into the window the
  // dependency graph allows: a feature cannot move above a value it reads, nor
  // below a statement that reads it, because a forward `%N` is not expressible.
  // The gesture is never ignored -- it does as much as it can, and MoveFeatureEdit
  // reports where it landed and which statement stopped it.
  {
    CommandDescriptor c = base("part.reorder_feature", "Reorder Feature", "",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "feature", .type = ParamType::Number,
                                 .required = false, .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "position", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 0.0, .hasDefault = false});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return historyTarget(*d, ctx) != 0 && wholeCount(num(ctx, "position", 0.0)) &&
             num(ctx, "position", 0.0) >= 1.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const int irId = historyTarget(*d, ctx);
      const FeatureRecord* rec = irId == 0 ? nullptr : d->featureAt(irId);
      if (rec == nullptr) { ctx.fail("no such feature"); return; }
      auto edit = std::make_unique<MoveFeatureEdit>(
          irId, static_cast<int>(num(ctx, "position", 0.0)), "Reorder " + rowName(*rec));
      MoveFeatureEdit* raw = edit.get();
      if (!s->perform(*d, std::move(edit))) {
        // Not a silent no-op: name the statement that pinned it, which is what a
        // repair loop (and a user) needs to know.
        std::string why = "the feature cannot move there";
        if (raw->blockedBy() != 0) {
          why += "; %" + std::to_string(raw->blockedBy()) + " pins it at position " +
                 std::to_string(raw->clampedTo());
        }
        ctx.fail(why);
      }
    };
    add(std::move(c));
  }

  // ── NAME A FEATURE PERSISTENTLY (TAG) ─────────────────────────────────────
  // The op that makes an edit SURVIVE the tree changing under it. FeatureTree.hpp:
  // TAG "binds a PERSISTENT name to a feature ... Afterwards "@name" is legal
  // anywhere a selector is legal, and survives ops that renumber faces — which
  // every edit does."  Until now it was a FORBIDDEN op purely because no command
  // emitted it, so the app's own selectors were all positional ("bore:max",
  // "face:12") and every one of them retargets the moment a feature is added
  // above it. That is precisely the failure "shrink the diameter of the largest
  // bore by 5 mm" hits on the second edit.
  //
  // The kernel does the hard half (FeatureTreeCompiler.cpp::resolveSelector):
  // it re-finds the named face by SIGNATURE, refuses a candidate that has moved
  // further than its own diameter rather than silently retargeting to a different
  // hole, refuses an ambiguous match, and cross-checks the optional
  // "@name|witness" form against an independent predicate. This command is the UI
  // half: bind the name, so those guarantees are reachable from the app.
  //
  // Pass-through, so the body keeps its identity: the node is consumed and
  // reproduced exactly as FILLET's is.
  {
    CommandDescriptor c = base("part.tag_feature", "Name Feature (Persistent)", "TAG",
                               SelectionSignature::atLeast(EntityKind::Face, 1));
    // REQUIRED, and hasDefault stays false (the braced-positional form stops
    // before it), so a bare keyboard gesture prompts for a name instead of
    // silently binding one -- the same shape part.mirror's `plane` has. The
    // recorded default text is what a worked example uses; it is a legal
    // persistent name, because an example the app would refuse is not an example.
    c.schema.push_back(ParamSpec{"name", ParamType::Text, true, 0.0, "@feature"});
    // "bore:max" is the kernel's own rank-based bore selector and it resolves to
    // exactly ONE face, which is what opTag() requires ("a name must denote
    // exactly ONE feature"). It is also the selector the ground-truth edit
    // ("shrink the diameter of the largest bore") starts from.
    c.schema.push_back(ParamSpec{"selector", ParamType::Text, false, 0.0, "bore:max"});
    c.preview = PreviewPolicy::None;
    c.enabled = [d](const CommandContext& ctx) {
      // The `name` parameter IS the emitted name, '@' and all. A command that
      // silently rewrote it would make the statement in the tree differ from the
      // thing the user typed, and the '@' is not decoration -- opTag() refuses a
      // name without it. Callers that collect a bare word run it through
      // forge::ui::toPersistentName() before dispatching.
      return solidTarget(*d, ctx.selection()).ok &&
             persistentNameProblem(txt(ctx, "name", "")) == nullptr &&
             !txt(ctx, "selector", "bore:max").empty();
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      if (!t.ok) { ctx.fail("selection does not resolve to one solid"); return; }
      if (const char* problem = persistentNameProblem(txt(ctx, "name", ""))) {
        ctx.fail(problem);
        return;
      }
      std::vector<IrArg> args{IrArg::valueRef(t.value),
                              IrArg::text(txt(ctx, "name", "@feature")),
                              IrArg::text(txt(ctx, "selector", "bore:max"))};
      emit(ctx, *d, *s, "part.tag_feature", "Name Feature (Persistent)", "TAG",
           std::move(args), IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── UNDO / REDO ARE NOT REGISTERED HERE ───────────────────────────────────
  // There used to be `part.undo` and `part.redo` beside `edit.undo` / `edit.redo`,
  // two pairs of buttons driving ONE stack. Whichever a user pressed, the other
  // pair's enabled state was still computed from the same depth, so the UI showed
  // two controls for one piece of state and a keystroke bound to the "wrong" pair
  // silently worked. One undo stack means one Undo command. They were also the
  // only Part commands with no feature-IR op, which is why removing them makes
  // "every registered Part command emits an IR op" literally true.

  return added;
}

const std::vector<std::string>& partCommandIds() {
  static const std::vector<std::string> ids = [] {
    std::vector<std::string> v{
        "part.boolean_intersect", "part.boolean_subtract", "part.boolean_union",
        "part.chamfer",           "part.counterbore",       "part.edit_feature",
        "part.extrude",           "part.fillet",            "part.hole",
        "part.loft",              "part.mirror",            "part.move",
        "part.pattern_circular",  "part.pattern_grid",      "part.pattern_linear",
        "part.revolve",           "part.section_ring",      "part.shell",
        "part.sketch_circle",     "part.sketch_rect",
        "part.variable_fillet",
        // the history operations -- see the HISTORY OPERATIONS block above
        "part.delete_feature",    "part.rename_feature",    "part.reorder_feature",
        "part.rollback_end",      "part.rollback_to",       "part.suppress_feature",
        "part.tag_feature",       "part.unsuppress_feature",
    };
    std::sort(v.begin(), v.end());
    return v;
  }();
  return ids;
}

}  // namespace forge::ui
