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
  // ROLLED statements are excluded and TOMBSTONES ARE NOT, and the asymmetry is
  // the whole content of this pass.
  //
  //   * A ROLLED statement does not exist YET. The bar means "the tree stops
  //     here", so the last statement below it IS the result and must not be
  //     pruned for having no consumer above the bar. Counting rolled references
  //     made rolling back to feature 3 emit an EMPTY program.
  //   * A DELETED statement DID exist and its operand DID have a real consumer.
  //     Excluding tombstones made every such operand look like a deliberate
  //     standalone root, so deleting the EXTRUDE out of RECT -> EXTRUDE -> ...
  //     left the RECT emitted alone: a lone PROFILE, which builds nothing, and a
  //     program the s0.4 graph gate fails for unexplained orphans. MEASURED on
  //     the 71-statement fixture: 70 casualties where there are 71.
  //
  // The tail case the exclusion was protecting is NOT protected by it and never
  // was -- deleting the SHELL at the end of a chain leaves the HOLE emitted
  // because a deleted PASS-THROUGH rebases (mayRebase is true for a tombstone),
  // so the HOLE becomes the SHELL's stand-in and `standsInFor` below pins it.
  // Suppressed statements are counted for the same stand-in reason.
  std::vector<bool> consumedInFull(n + 1, false);
  for (const FeatureRecord& r : records_) {
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
      // NAME THE ROOT CAUSE, not the nearest broken neighbour. In a chain
      // %2 -> %3 -> %4 -> %5, deleting %2 leaves %3 blaming %2 but %4 blaming %3
      // and %5 blaming %4 -- three different answers to "what do I fix?", only
      // one of them actionable. Walking to the statement that actually went
      // missing makes every casualty name %2, which is what a repair loop acts on
      // and what the "name the op" half of the binding constraint asks for.
      //
      // Terminates: `root` strictly decreases (a %ref resolves backwards, so
      // blocking[root] < root), and every id below i already has its final
      // blocking value because this loop runs in increasing i.
      int root = missing;
      while (root >= 1 && static_cast<std::size_t>(root) <= n &&
             reason[static_cast<std::size_t>(root)] == OmitReason::OperandUnavailable &&
             blocking[static_cast<std::size_t>(root)] != 0) {
        root = blocking[static_cast<std::size_t>(root)];
      }
      blocking[i] = root;
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
// The Text half of hasNumber, and it exists for the same reason: an OPTIONAL
// argument is emitted only when the caller actually supplied one. VERIFY is
// variadic -- VERIFY(%body, "expr", ...) -- so "was a second assertion given?"
// is the question that decides between its two-argument and three-argument
// forms, and txt() alone cannot answer it (it returns the fallback either way).
bool hasText(const CommandContext& ctx, const char* name) {
  return ctx.params().text(name).has_value();
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

  // ── ROUNDED RECTANGLE ─────────────────────────────────────────────────────
  // The third PROFILE producer, and the first of the ten commands added to make the
  // KERNEL'S OWN PRIMITIVES reachable. The measured motivation, not a feature request:
  // across 600 held-out Archie emissions, 95.6% of the op uses the policy gate refuses
  // are REAL KERNEL OPS forbidden only because "no command in the forge::ui registry
  // emits it". `RRECT` is one of them, and it is the profile every bracket, cover plate
  // and gasket in the corpus starts from -- a rectangle with a sharp corner is the
  // exception in mechanical parts, not the rule.
  //
  // The kernel CLAMPS rather than refuses: profRRect computes
  // `rr = max(0.1, min(r, min(hw, hh) - 0.1))`, so RRECT(40, 30, 40) is RECORDED as a
  // 40 mm corner and BUILT as a 14.9 mm one. That is worse than a throw for a UI --
  // the statement in the history would say one thing and the solid be another -- so
  // the predicate refuses everything the clamp would touch, exactly as part.section_ring
  // refuses the p/seg values RING silently clamps.
  //
  // MEASURED through the pinned native verifier (forge::ft::compileText, the same
  // compiler the app links): `RRECT(40, 30, 5); EXTRUDE(%1, 10)` -> volume 11785.3982,
  // which is (40*30 - (4 - pi)*5^2) * 10 = 11785.3982 to ten significant figures, with
  // bbox 40 x 30 x 10 and genus 0. The centred form `RRECT(40, 30, 5, 3, 4)` moves the
  // bbox to [-17,-11,0]..[23,19,10] and leaves the volume unchanged -- so cx/cy are a
  // translation and not a size, which is the argument-order confusion this check exists
  // to rule out.
  {
    CommandDescriptor c = base("part.sketch_rounded_rect", "Rounded Rectangle", "RRECT",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "width", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 40.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "height", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 30.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "corner_radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 5.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      const double w = num(ctx, "width", 0.0);
      const double h = num(ctx, "height", 0.0);
      const double r = num(ctx, "corner_radius", 0.0);
      // The last two terms are the CLAMP BOUNDARY written out: profRRect keeps
      // `min(hw, hh) - 0.1`, so `2r <= w - 0.2` and `2r <= h - 0.2` are exactly the
      // radii it would leave alone. They read as `unparsed_terms` in the vocabulary
      // because the extractor reads comparisons against a parameter or a literal, not
      // against an expression -- recorded as unread rather than silently dropped.
      return w > 0.0 && h > 0.0 && r >= 0.1 && 2.0 * r <= w - 0.2 && 2.0 * r <= h - 0.2;
    };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args{IrArg::num(num(ctx, "width", 40.0)),
                              IrArg::num(num(ctx, "height", 30.0)),
                              IrArg::num(num(ctx, "corner_radius", 5.0))};
      // RRECT(w, h, r [, cx=0, cy=0]) -- one all-or-nothing optional group, because the
      // tail is POSITIONAL: emitting cy without cx would put the y centre in the x slot.
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
      }
      emit(ctx, *d, *s, "part.sketch_rounded_rect", "Rounded Rectangle", "RRECT", std::move(args),
           IrValueKind::Profile, {}, sketchNodeFor(d->nextIrId()));
    };
    add(std::move(c));
  }

  // ── REGULAR POLYGON ───────────────────────────────────────────────────────
  // The fourth PROFILE producer. Hex and square stock, spanner flats, nut bodies and
  // every n-gon boss start here, and none of them was authorable: REGPOLY was in the
  // kernel and in forge::ui::irOpTable() and reachable from no command.
  //
  // ARGUMENT ORDER IS THE TRAP and it is inverted from how the command reads: the
  // kernel writes REGPOLY(r, n, ...) -- the RADIUS first and the side COUNT second --
  // and `r` is the CIRCUMRADIUS (vertex distance), not the across-flats size. profRegPoly
  // places vertex i at `(cx + r*cos(rot + 2*pi*i/n), cy + r*sin(...))`, so a hexagon
  // asked for r = 20 measures 40 across corners and 34.64 across flats.
  //
  // MEASURED: `REGPOLY(20, 6); EXTRUDE(%1, 10)` -> volume 10392.3048, which is the exact
  // n-gon area 0.5*6*20^2*sin(60 deg) = 1039.23048 times 10, with bbox
  // 40.000 x 34.641 x 10 -- the across-corners/across-flats pair above. Emitting the two
  // in the other order would have built a 6 mm-radius 20-gon and still compiled.
  {
    CommandDescriptor c = base("part.sketch_polygon", "Polygon", "REGPOLY",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 20.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "sides", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 6.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"rotation", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      const double n = num(ctx, "sides", 0.0);
      // profRegPoly throws on n < 3, and it reads the count through
      // `static_cast<int>(num(op, 1))`, which TRUNCATES: 5.9 sides would be recorded as
      // 5.9 and built as 5. A count is a count only if it is whole -- the same rule the
      // three PATTERN commands already apply, for the same reason.
      return num(ctx, "radius", 0.0) > 0.0 && n >= 3.0 && wholeCount(n);
    };
    c.execute = [d, s](CommandContext& ctx) {
      // REGPOLY(r, n [, cx=0, cy=0, rotDeg=0]) -- radius FIRST. See the comment above.
      std::vector<IrArg> args{IrArg::num(num(ctx, "radius", 20.0)),
                              IrArg::num(num(ctx, "sides", 6.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "rotation")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "rotation", 0.0)));
      }
      emit(ctx, *d, *s, "part.sketch_polygon", "Polygon", "REGPOLY", std::move(args),
           IrValueKind::Profile, {}, sketchNodeFor(d->nextIrId()));
    };
    add(std::move(c));
  }

  // ── POLY ──────────────────────────────────────────────────────────────────
  // POLY([x y; x y; ...]) -- an ARBITRARY closed 2D silhouette, and by the count
  // recorded in D-038 the single largest refused op in the held-out sample (892
  // uses). Every profile above it draws one FAMILY of shape: RECT is axis-aligned,
  // CIRCLE is round, RRECT rounds its corners, REGPOLY is regular. A gasket
  // outline, a cam lobe, an L- or T-section bracket and a traced silhouette are
  // none of those, and until this command existed the app could not author one at
  // all -- the user's only route to an arbitrary outline was to union primitives
  // and hope.
  //
  // POLY IS PARSED UNLIKE EVERY OTHER OP, and the difference is load-bearing.
  // FeatureTreeCompiler's tokenizer branches on `op.code == OpCode::Poly` BEFORE
  // the generic argument loop and reads the ring into `op.poly`, leaving `op.args`
  // EMPTY. So the statement TEXT is what has to be right; there is no argument
  // slot to get wrong. D-038 recorded the hazard exactly: `POLY(5)` passes
  // validateIr (arity 1..1) and reaches profPoly, which finds `op.poly` empty and
  // builds an EMPTY SKETCH. That is why the points token had to exist before this
  // command could: IrArg::points2 carries the ring as a ring, and validateIr
  // answers MalformedPointList for a spec that would have become POLY(5).
  //
  // MEASURED through the pinned native verifier, each extruded 10 mm -- area is
  // volume/10, and the face count is the independent second observable (n sides
  // plus 2 caps), because area alone cannot tell a correct ring from a
  // self-intersecting one that happens to enclose the same measure:
  //     POLY([-20 -20; 20 -20; 20 20; -20 20])          vol 16000      6 faces
  //         = the 40x40 square, exactly; bbox -20..20 in x and y
  //     POLY([0 0; 40 0; 0 30])                         vol  6000      5 faces
  //         = 0.5*40*30*10, the right triangle, exactly
  //     POLY([0 0; 60 0; 60 20; 20 20; 20 50; 0 50])    vol 18000      8 faces
  //         = (60*20 + 20*30)*10, a re-entrant L-section, exactly; bbox 60 x 50
  // and both refusals are loud and named, not silent:
  //     POLY([0 0; 10 10])  -> "ft parse line 1: POLY needs >= 3 points"
  //     POLY(5)             -> "ft parse line 1: POLY expects [x y; x y; ...]"
  //
  // Two points are a line segment and three is the first ring that encloses area,
  // which is why the enabled predicate asks for 3 -- the same bound profPoly's own
  // caller enforces, asked on the same parser the emission uses so a greyed-out
  // command and a refused statement can never disagree.
  {
    CommandDescriptor c = base("part.sketch_poly", "Polygon Outline", "POLY",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "points",
                                 .type = ParamType::Text,
                                 .required = true,
                                 .defaultText = "-20 -20; 20 -20; 20 20; -20 20",
                                 .hasDefault = true});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      return irPointsWellFormed(txt(ctx, "points", ""), 2, 3);
    };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args{
          IrArg::points2(txt(ctx, "points", "-20 -20; 20 -20; 20 20; -20 20"))};
      emit(ctx, *d, *s, "part.sketch_poly", "Polygon Outline", "POLY", std::move(args),
           IrValueKind::Profile, {}, sketchNodeFor(d->nextIrId()));
    };
    add(std::move(c));
  }

  // ── SLOT IS DELIBERATELY ABSENT, AND THIS IS WHY ──────────────────────────
  // SLOT(len, wid [, cx, cy, angleDeg]) is the fifth profile the kernel implements and
  // it is the one command in this batch that is NOT being added, because the kernel
  // builds the wrong solid and a command that emits it would ship that silently.
  //
  // MEASURED through the pinned native verifier, four sizes, `SLOT(len, wid)` extruded
  // 10 mm and the area read back as volume/10:
  //     SLOT(40, 12)  area 222.9027   an obround is 449.0973   bbox x = -14.000..14.000
  //     SLOT(60, 10)  area 421.4602   an obround is 578.5398   bbox x = -25.000..25.000
  //     SLOT(30, 20)  area 114.1593   an obround is 514.1593   bbox x =  -5.000.. 5.000
  //     SLOT(100, 4)  area 371.4336   an obround is 396.5664   bbox x = -48.000..48.000
  // Every row is EXACTLY `|(len - wid)*wid - pi*(wid/2)^2|`, and every bbox is
  // +/-(len - wid)/2 rather than +/-len/2. Both semicircular end caps bow INWARD: the
  // shape is the straight section with a full circle's area REMOVED, not an obround with
  // it added. On the nominal case that is -50.4% of the volume the signature promises,
  // and the part is 28 mm long where the statement says 40.
  //
  // THE CAUSE, LOCATED -- and it is NOT what this note first said. The earlier reading
  // was "profSlot's source is right, so the defect is in how a 180-degree arc's
  // direction is resolved downstream", which implies an endpoint-order fix in profSlot
  // would settle it. It cannot, and the difference is the whole engineering decision.
  //
  //   * `forge::addArc(h, center, p0, p1)` (Sketcher.cpp) stores ONLY center, start and
  //     end, as atan2 angles. It records NO ORIENTATION BIT.
  //   * `profileFromSketch` normalises the sweep into (-pi, pi] and then trims
  //     `[min(sa, ea), max(sa, ea)]` -- which discards the sweep's SIGN and therefore
  //     always takes the MINOR arc.
  //
  // For a 180-degree cap the two candidate arcs are the same LENGTH, so "minor" is a
  // tie the `<=` in the normalisation breaks arbitrarily, and it breaks it inward for
  // BOTH caps. No argument order to addArc can change that: the information which
  // semicircle was meant is never stored. Re-deriving the trim span from the source in
  // Python and comparing against the four measured areas above agrees to 3.6e-05 on
  // every row, and the RRECT control comes out OUTWARD, as measured.
  //
  // THE FIX THAT FOLLOWS (analysed, NOT shipped here): build each cap as TWO 90-degree
  // arcs meeting at its outward apex -- (+/-(len-wid)/2 +/- wid/2, 0) -- exactly the
  // construction RRECT already uses and which is measured exact. Every resulting arc
  // is a true minor arc, so the tie never arises. Verified analytically over
  // (40,12), (60,10), (30,20), (100,4) and the degenerate (20,20): all four arcs span
  // 90.0 degrees and all four bow outward. It is NOT applied in this change because a
  // kernel geometry change must be re-measured through a kernel BUILD, and this run is
  // memory-capped to the app layer.
  //
  // One further measurement this note did not have: `SLOT(30, 20)` does not merely have
  // the wrong volume, it is an INVALID SOLID -- forge_verify reports genus 1,
  // "first invalid solid is produced by op %2 EXTRUDE (line 2): not consistently
  // oriented", because with len - wid < wid the two inward caps cross the centre-line
  // and the profile self-intersects.
  //
  // Adding the command would have made a broken solid one click away and, worse, put
  // SLOT into Archie's training vocabulary as a shape it is not. It stays in
  // `forbidden_ops` until the arc is fixed and re-measured.

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
  // RING came FIRST rather than WIRE because WIRE([x y z; ...]) needs a POINTS token that
  // FeatureIr.hpp did not model. That is no longer true -- `part.wire_section` below adds
  // the token and the second WIRE producer -- but RING keeps its place: it is all numbers,
  // so it emits through the plain IrArg::num path, and its `z` is the whole point, because
  // the Z=0 sketcher cannot express a section at another height and that is what makes a
  // loft a loft.
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

  // ── SOLID PRIMITIVES ──────────────────────────────────────────────────────
  // Seven commands, one per kernel primitive, and the reason they are here is the same
  // measured one that put RECT and CIRCLE here: the op existed, the kernel built it, and
  // NO USER COULD ASK FOR IT. `BOX` and `CYL` are the two most-used ops in the repo's own
  // feature-tree corpus (30 and 17 statements of 183) and both were in `forbidden_ops`.
  // The app SEEDS a BOX into every new document -- ForgeFrame's default part is one --
  // so the shipped product was showing the user a solid it gave them no way to author.
  //
  // Each one takes NO SELECTION, like the three creators above: a primitive consumes no
  // value, which is what makes it reachable from an empty document.
  //
  // TWO RULES HOLD FOR ALL SEVEN, and both are the difference between a command and a
  // silent wrong answer:
  //
  //   1. THE OPTIONAL TAIL IS ONE ALL-OR-NOTHING GROUP. Every kernel primitive reads its
  //      optional arguments POSITIONALLY through `numOpt(op, i, default)`, so emitting an
  //      axis without a centre would put `axx` in the `cx` slot: a statement the kernel
  //      accepts and reads as a completely different solid. The group is emitted whole or
  //      not at all, exactly as part.section_ring does for RING.
  //   2. THE PREDICATE REFUSES WHAT THE KERNEL THROWS ON. requirePositive() in
  //      Primitives.cpp raises on a zero or negative size; makeTorus refuses
  //      minor >= major ("self-intersecting otherwise"); makeTube refuses
  //      rInner >= rOuter; makePrism refuses n < 3. A command must not offer itself as
  //      callable where it cannot succeed, so each of those is a term below.
  //
  // ALL SEVEN WERE MEASURED through the pinned native verifier (forge::ft::compileText),
  // against closed form, in BOTH the minimal and the full-optional-group form. A VECTOR
  // of observables, never volume alone -- the divergence theorem gives a self-intersecting
  // shell the right volume, so volume agreeing proves nothing on its own:
  //
  //   BOX(40,30,20)          vol 24000.0000   want 24000.0000   6 faces  genus 0
  //                          bbox [-20,-15,0]..[20,15,20]  -- centred in XY, base at cz
  //   BOX(40,30,20,3,4,5)    vol 24000.0000   bbox [-17,-11,5]..[23,19,25]
  //   CYL(10,25)             vol  7853.9816   want pi*100*25 = 7853.9816   3 faces
  //                          bbox [-10,-10,0]..[10,10,25]
  //   CYL(10,25,0,0,0,1,0,0) vol  7853.9816   bbox [0,-10,-10]..[25,10,10]  -- re-aimed +X
  //   CONE(10,4,25)          vol  4084.0705   want pi*h/3*(r1^2+r1r2+r2^2) = 4084.0704
  //   CONE(10,0,25)          vol  2617.9939   want pi*r^2*h/3 = 2617.9939   2 faces (apex)
  //   SPHERE(10)             vol  4188.7902   want 4/3*pi*1000 = 4188.7902  1 face
  //   SPHERE(10,5,5,5)       vol  4188.7902   bbox [-5,-5,-5]..[15,15,15]  -- CENTRE, not base
  //   TORUS(30,8)            vol 37899.2809   want 2*pi^2*30*64 = 37899.2809  GENUS 1
  //                          bbox [-38,-38,-8]..[38,38,8]
  //   PRISM(6,15,20)         vol 11691.3430   want 0.5*6*15^2*sin(60 deg)*20 = 11691.3430
  //                          8 faces = 6 sides + 2 caps;  bbox 30.000 x 25.981 x 20
  //   TUBE(12,8,30)          vol  7539.8224   want pi*(144-64)*30 = 7539.8224  GENUS 1
  //                          4 faces;  bbox [-12,-12,0]..[12,12,30]
  //
  // The two genus-1 rows are the point of measuring a vector: a tube whose bore failed to
  // cut would have kept a plausible volume and reported genus 0.

  // ── BOX ───────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_box", "Box", "BOX",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "dx", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 40.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "dy", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 30.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "dz", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 20.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // makeBox calls requirePositive on all three: a zero side is not a solid.
      return num(ctx, "dx", 0.0) > 0.0 && num(ctx, "dy", 0.0) > 0.0 &&
             num(ctx, "dz", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      // BOX(dx, dy, dz [, cx=0, cy=0, cz=0]) -- primBox centres the box in XY on (cx, cy)
      // and puts its BASE at cz, which is why the minimal form's bbox is
      // [-dx/2, -dy/2, 0]..[dx/2, dy/2, dz] and not a corner at the origin.
      std::vector<IrArg> args{IrArg::num(num(ctx, "dx", 40.0)), IrArg::num(num(ctx, "dy", 30.0)),
                              IrArg::num(num(ctx, "dz", 20.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
      }
      emit(ctx, *d, *s, "part.primitive_box", "Box", "BOX", std::move(args), IrValueKind::Solid,
           {}, {});
    };
    add(std::move(c));
  }

  // ── CYLINDER ──────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_cylinder", "Cylinder", "CYL",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 10.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "height", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 25.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axz", ParamType::Number, false, 1.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // makeCylinder calls requirePositive on both. A zero-radius cylinder is not a solid.
      return num(ctx, "radius", 0.0) > 0.0 && num(ctx, "height", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      // CYL(r, h [, cx=0, cy=0, cz=0, axx=0, axy=0, axz=1]) -- SIX optional arguments in
      // ONE group. place() re-aims the +Z-based primitive onto (axx, axy, axz) and then
      // moves the base to (cx, cy, cz); a degenerate axis is re-defaulted to +Z there
      // rather than throwing, so the group's axz fallback of 1 is the honest default and
      // not a filler.
      std::vector<IrArg> args{IrArg::num(num(ctx, "radius", 10.0)),
                              IrArg::num(num(ctx, "height", 25.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz") ||
          hasNumber(ctx, "axx") || hasNumber(ctx, "axy") || hasNumber(ctx, "axz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axz", 1.0)));
      }
      emit(ctx, *d, *s, "part.primitive_cylinder", "Cylinder", "CYL", std::move(args),
           IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── CONE ──────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_cone", "Cone", "CONE",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "radius_base", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 10.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "radius_top", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "height", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 25.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axz", ParamType::Number, false, 1.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // makeCone accepts a ZERO radius at one end -- that is the apex, and CONE(10, 0, 25)
      // is the ordinary cone -- but not at BOTH, because it shims equal radii to
      // makeCylinder, which then throws on requirePositive. The `||` term is what forbids
      // the double zero; it is recorded in the vocabulary as an unparsed term, because the
      // constraint extractor reads conjunctions of comparisons and not disjunctions.
      return (num(ctx, "radius_base", 0.0) > 0.0 || num(ctx, "radius_top", 0.0) > 0.0) &&
             num(ctx, "radius_base", 0.0) >= 0.0 && num(ctx, "radius_top", 0.0) >= 0.0 &&
             num(ctx, "height", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      // CONE(r1, r2, h [, cx, cy, cz, axx, axy, axz]) -- r1 is the BASE radius (at cz) and
      // r2 the TOP. Swapping them compiles and builds the cone upside down.
      std::vector<IrArg> args{IrArg::num(num(ctx, "radius_base", 10.0)),
                              IrArg::num(num(ctx, "radius_top", 0.0)),
                              IrArg::num(num(ctx, "height", 25.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz") ||
          hasNumber(ctx, "axx") || hasNumber(ctx, "axy") || hasNumber(ctx, "axz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axz", 1.0)));
      }
      emit(ctx, *d, *s, "part.primitive_cone", "Cone", "CONE", std::move(args),
           IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── SPHERE ────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_sphere", "Sphere", "SPHERE",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 10.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) { return num(ctx, "radius", 0.0) > 0.0; };
    c.execute = [d, s](CommandContext& ctx) {
      // SPHERE(r [, cx=0, cy=0, cz=0]) -- primSphere TRANSLATES by (cx, cy, cz), so unlike
      // BOX and CYL the triple is the sphere's CENTRE and not a base point. MEASURED:
      // SPHERE(10, 5, 5, 5) has bbox [-5,-5,-5]..[15,15,15].
      std::vector<IrArg> args{IrArg::num(num(ctx, "radius", 10.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
      }
      emit(ctx, *d, *s, "part.primitive_sphere", "Sphere", "SPHERE", std::move(args),
           IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── TORUS ─────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_torus", "Torus", "TORUS",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "major_radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 30.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "minor_radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 8.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axz", ParamType::Number, false, 1.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // makeTorus: "torus.minorR must be < majorR (self-intersecting otherwise)". A
      // self-intersecting torus is the exact shape whose VOLUME still looks plausible, so
      // this term is refused here rather than left to be noticed downstream.
      return num(ctx, "major_radius", 0.0) > 0.0 && num(ctx, "minor_radius", 0.0) > 0.0 &&
             num(ctx, "minor_radius", 0.0) < num(ctx, "major_radius", 0.0);
    };
    c.execute = [d, s](CommandContext& ctx) {
      // TORUS(major, minor [, cx, cy, cz, axx, axy, axz]) -- MEASURED genus 1, which is
      // the observable a volume check would have missed.
      std::vector<IrArg> args{IrArg::num(num(ctx, "major_radius", 30.0)),
                              IrArg::num(num(ctx, "minor_radius", 8.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz") ||
          hasNumber(ctx, "axx") || hasNumber(ctx, "axy") || hasNumber(ctx, "axz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axz", 1.0)));
      }
      emit(ctx, *d, *s, "part.primitive_torus", "Torus", "TORUS", std::move(args),
           IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── PRISM ─────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_prism", "Prism", "PRISM",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "sides", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 6.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 15.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "height", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 20.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      const double n = num(ctx, "sides", 0.0);
      // makePrism throws on n < 3, and primPrism reads the count through
      // `static_cast<int>(num(op, 0))`, which truncates 5.9 to 5 while the statement
      // records 5.9. Whole numbers only, for the same reason the PATTERN counts are.
      return n >= 3.0 && wholeCount(n) && num(ctx, "radius", 0.0) > 0.0 &&
             num(ctx, "height", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      // PRISM(nSides, circumR, h [, cx, cy, cz]) -- the COUNT is first here and the radius
      // second, the opposite order to REGPOLY(r, n) two commands up. That is the kernel's
      // spelling, not a choice; getting it backwards builds a 6-sided prism of radius 15
      // as a 15-sided prism of radius 6 and compiles cleanly.
      std::vector<IrArg> args{IrArg::num(num(ctx, "sides", 6.0)),
                              IrArg::num(num(ctx, "radius", 15.0)),
                              IrArg::num(num(ctx, "height", 20.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
      }
      emit(ctx, *d, *s, "part.primitive_prism", "Prism", "PRISM", std::move(args),
           IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── TUBE ──────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_tube", "Tube", "TUBE",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "outer_radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 12.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "inner_radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 8.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "height", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 30.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // makeTube: requirePositive on all three, and "tube.rInner must be < rOuter".
      return num(ctx, "outer_radius", 0.0) > 0.0 && num(ctx, "inner_radius", 0.0) > 0.0 &&
             num(ctx, "inner_radius", 0.0) < num(ctx, "outer_radius", 0.0) &&
             num(ctx, "height", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      // TUBE(rOuter, rInner, h [, cx, cy, cz]) -- MEASURED genus 1 and 4 faces, which is
      // what says the bore really was cut. Volume alone could not.
      std::vector<IrArg> args{IrArg::num(num(ctx, "outer_radius", 12.0)),
                              IrArg::num(num(ctx, "inner_radius", 8.0)),
                              IrArg::num(num(ctx, "height", 30.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
      }
      emit(ctx, *d, *s, "part.primitive_tube", "Tube", "TUBE", std::move(args),
           IrValueKind::Solid, {}, {});
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

  // ── ROTATE ────────────────────────────────────────────────────────────────
  // The second half of placement. part.move made TRANSLATE reachable and left ROTATE
  // orphaned, which is not a cosmetic gap: with only translation, every solid a user
  // could author was axis-aligned, so an angled boss, a canted rib and a rotated flange
  // were all unauthorable and the booleans could only ever meet at right angles. ROTATE
  // is also 231 of the refused op uses in the held-out emission sample -- the third most
  // used op that no command emitted.
  //
  // It follows part.move EXACTLY, because it is the same kind of thing: one solid in,
  // the SAME document node out. The body keeps its identity and gains history rather
  // than becoming a new body, which is what stops a later fillet from naming a body
  // that no longer exists.
  //
  // ARITY: ROTATE's first five arguments are REQUIRED (forge::ui::irOpTable() says
  // 5..8), so the axis triple is emitted unconditionally -- it is not an optional tail
  // like CYL's. Only the pivot (ox, oy, oz) is a group, and it is all-or-nothing for the
  // usual positional reason.
  //
  // MEASURED through the pinned native verifier, and the observable that matters here is
  // the BBOX, not the volume -- a rigid motion cannot change the volume, so volume alone
  // could not tell a correct rotation from no rotation at all:
  //   BOX(20,10,4); ROTATE(%1, 90, 0, 1, 0)              vol 800.0000 (unchanged, as a
  //       rigid motion must be), bbox [0,-5,-10]..[4,5,10] -- the 20 mm X extent became
  //       the Z extent and the 4 mm Z extent became X: a real quarter turn about +Y.
  //   BOX(20,10,4); ROTATE(%1, 90, 0, 0, 1, 10, 0, 0)    vol 800.0000,
  //       bbox [5,-20,0]..[15,0,4] -- turned about the LINE x=10 rather than the origin,
  //       which is what the optional pivot is for and what its absence would hide.
  {
    CommandDescriptor c = base("part.rotate", "Rotate Body", "ROTATE",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    // hasDefault, so a keyboard gesture can invoke it: see part.extrude. A quarter turn
    // about +Z is the honest default -- it is the move a user means by "rotate this".
    c.schema.push_back(ParamSpec{.name = "angle", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 90.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"axx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axz", ParamType::Number, false, 1.0, ""});
    c.schema.push_back(ParamSpec{"ox", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"oy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"oz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      const double ax = num(ctx, "axx", 0.0);
      const double ay = num(ctx, "axy", 0.0);
      const double az = num(ctx, "axz", 1.0);
      // A zero rotation is a no-op statement in the history -- refused rather than
      // recorded, exactly as part.move refuses a zero move. A zero AXIS is worse: unlike
      // place(), which re-defaults a degenerate axis to +Z, opRotate hands (ax, ay, az)
      // straight to forge::rotate, which throws "zero axis" on the native path and builds
      // a gp_Dir from a null vector on the OCCT one. The magnitude term reads as an
      // unparsed term in the vocabulary -- the extractor reads comparisons against a
      // parameter or a literal, and this one is against an expression.
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "angle", 0.0) != 0.0 &&
             ax * ax + ay * ay + az * az > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      if (!t.ok) { ctx.fail("selection does not resolve to one solid"); return; }
      // ROTATE(%a, angleDeg, axx, axy, axz [, ox=0, oy=0, oz=0])
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::num(num(ctx, "angle", 90.0)),
                              IrArg::num(num(ctx, "axx", 0.0)), IrArg::num(num(ctx, "axy", 0.0)),
                              IrArg::num(num(ctx, "axz", 1.0))};
      if (hasNumber(ctx, "ox") || hasNumber(ctx, "oy") || hasNumber(ctx, "oz")) {
        args.push_back(IrArg::num(num(ctx, "ox", 0.0)));
        args.push_back(IrArg::num(num(ctx, "oy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "oz", 0.0)));
      }
      emit(ctx, *d, *s, "part.rotate", "Rotate Body", "ROTATE", std::move(args),
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

  // ══ THE DIRECT-MODELLING AND EDIT OPS ═════════════════════════════════════
  // Everything from here down emits an op the kernel has always had and that no
  // user could reach. They are the EDIT half of the Unified IR -- the half the
  // ground-truth fixtures are written in, where "shrink the diameter of the
  // largest bore by 5 mm" is ONE RESIZEBORE statement against the part in hand
  // and not a 14-op rebuild -- plus the two ops that make an edit tree
  // well-formed at all: INPUT, which binds the part being edited, and VERIFY,
  // which states what the edit must not break.
  //
  // Each of them names its face with a SELECTOR STRING, because that is what
  // forge::ft::resolveSelector reads, and its grammar is far wider than any
  // dropdown: "+Z", "plane:max-area", "face:12", "bore:largest", "bore:r=47.5",
  // "hole:at=21.75,0", "hole:at=21.75,0:r=4.02", "radial:2", "blade:all",
  // "fillet:r<=3", and "@name" / "@name|witness" for a TAG-bound persistent
  // feature. This layer does NOT enumerate that grammar and refuse everything
  // else: a selector the kernel grows tomorrow would become unreachable through
  // the app the day it was added, and a refusal that cannot name a face is the
  // capability gate this product must not have. One thing is refused -- an EMPTY
  // selector, which names no face under any grammar and which the compiler's own
  // strArg() would reject anyway. Everything else is emitted and answered by the
  // kernel, which names the face, the op and the reason so a repair loop can act.

  // ── HEAL ──────────────────────────────────────────────────────────────────
  // HEAL(%body), and that is the whole op. It is the REPAIR verb:
  // forge::heal::simplifyShape merges the slivers, duplicate faces and
  // near-tangent seams a long boolean chain leaves behind, and a 14-op tree over
  // a 400-face part is precisely the thing that leaves them. It needs no
  // parameters and no selection beyond the body, which is why it was reachable
  // for the price of twenty lines and stayed unreachable anyway.
  {
    CommandDescriptor c = base("part.heal", "Heal Body", "HEAL",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      if (!t.ok) { ctx.fail("selection does not resolve to one solid"); return; }
      std::vector<IrArg> args{IrArg::valueRef(t.value)};
      emit(ctx, *d, *s, "part.heal", "Heal Body", "HEAL", std::move(args), IrValueKind::Solid,
           {}, t.node);
    };
    add(std::move(c));
  }

  // ── DEFEATURE ─────────────────────────────────────────────────────────────
  // DEFEATURE(%body, "sel") -- delete the selected faces and heal the wound. The
  // simplify-for-analysis verb, and the one that answers "remove the small bolt
  // holes" in a single statement instead of reconstructing the part without them.
  //
  // The kernel refuses a DEFEATURE that changes NOTHING (opDefeature compares the
  // volume before and after and throws when they are identical), because a face
  // group that is really a whole solid protrusion cannot be deleted by face
  // removal -- it has to be CUT. That check lives there, on the live geometry,
  // where it can be made; this layer cannot know a blade from a chamfer without
  // the body, and guessing would only refuse legal edits.
  {
    CommandDescriptor c = base("part.defeature", "Remove Feature", "DEFEATURE",
                               SelectionSignature::atLeast(EntityKind::Face, 1));
    c.schema.push_back(ParamSpec{.name = "selector",
                                 .type = ParamType::Text,
                                 .required = true,
                                 .defaultText = "hole:smallest",
                                 .hasDefault = true});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && !txt(ctx, "selector", "").empty();
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      if (!t.ok) { ctx.fail("selection does not resolve to one solid"); return; }
      std::vector<IrArg> args{IrArg::valueRef(t.value),
                              IrArg::text(txt(ctx, "selector", "hole:smallest"))};
      emit(ctx, *d, *s, "part.defeature", "Remove Feature", "DEFEATURE", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── PUSHFACE ──────────────────────────────────────────────────────────────
  // PUSHFACE(%body, "sel", dist) -- move ONE planar face along its own outward
  // normal. This is direct modelling: "make the plate 3 mm thicker" without
  // knowing which statement built the plate, which is what an edit against an
  // IMPORTED solid always needs, since there are no statements to edit.
  //
  // `distance` is signed -- negative pulls the face inward -- so the only value
  // refused is zero, which would record a statement that moves nothing.
  {
    CommandDescriptor c = base("part.push_face", "Push Face", "PUSHFACE",
                               SelectionSignature::atLeast(EntityKind::Face, 1));
    c.schema.push_back(ParamSpec{.name = "selector",
                                 .type = ParamType::Text,
                                 .required = true,
                                 .defaultText = "+Z",
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "distance",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 5.0,
                                 .hasDefault = true});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && !txt(ctx, "selector", "").empty() &&
             num(ctx, "distance", 0.0) != 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      if (!t.ok) { ctx.fail("selection does not resolve to one solid"); return; }
      std::vector<IrArg> args{IrArg::valueRef(t.value),
                              IrArg::text(txt(ctx, "selector", "+Z")),
                              IrArg::num(num(ctx, "distance", 5.0))};
      emit(ctx, *d, *s, "part.push_face", "Push Face", "PUSHFACE", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── RESIZEBORE ────────────────────────────────────────────────────────────
  // RESIZEBORE(%body, "sel", newRadius) -- set a cylindrical bore's radius
  // EXACTLY. It is the single most load-bearing edit op in this file: the
  // owner's ground-truth edit fixtures are of the form "shrink the diameter of
  // the largest bore by 5 mm", and until now the app could express that only by
  // rebuilding the part, which is a different task with a different failure mode.
  //
  // `bore:largest` is the default because that is the phrase the fixtures use.
  // The radius must be positive -- opResizeBore throws on r <= 0 -- and the
  // remaining refusals (a convex boss, a non-cylindrical face, a selector that
  // matches more than one face) are made on the live inventory by the kernel,
  // which can see the geometry and can name the face it refused.
  {
    CommandDescriptor c = base("part.resize_bore", "Resize Bore", "RESIZEBORE",
                               SelectionSignature::atLeast(EntityKind::Face, 1));
    c.schema.push_back(ParamSpec{.name = "selector",
                                 .type = ParamType::Text,
                                 .required = true,
                                 .defaultText = "bore:largest",
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "radius",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 5.0,
                                 .hasDefault = true});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && !txt(ctx, "selector", "").empty() &&
             num(ctx, "radius", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      if (!t.ok) { ctx.fail("selection does not resolve to one solid"); return; }
      std::vector<IrArg> args{IrArg::valueRef(t.value),
                              IrArg::text(txt(ctx, "selector", "bore:largest")),
                              IrArg::num(num(ctx, "radius", 5.0))};
      emit(ctx, *d, *s, "part.resize_bore", "Resize Bore", "RESIZEBORE", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── TAG LIVES WITH THE HISTORY OPERATIONS, NOT HERE ───────────────────────
  // Two TAG commands were written independently -- one in the direct-edit batch
  // above, one with the history operations below -- and both claimed the id
  // `part.tag_feature`. CommandRegistry::add() refuses a duplicate id, so the
  // second would have silently NOT been registered and `added` would have been
  // one short of partCommandIds(); the registration count assertion in
  // part_commands_test is what makes that visible rather than mysterious.
  //
  // The surviving one is the history version, and it is the better of the two on
  // a checkable point: opTag() refuses a name containing anything outside
  // [a-z0-9_] ("so it survives lowercasing"), and only that version checks it --
  // through forge::ui::persistentNameProblem(), in BOTH the enabled predicate and
  // the handler. This one tested the leading '@' alone, so `@bore-main` would have
  // been offered as callable and then refused by the kernel. TAG also belongs
  // beside rollback/reorder/suppress: persistent naming is what makes a history
  // edit survive the renumbering the other three cause.


  // ── VERIFY ────────────────────────────────────────────────────────────────
  // VERIFY(%body, "expr", ...) is an ASSERTION, not a geometry op: opVerify
  // measures the LIVE body and returns it unchanged. Its UI is therefore not
  // "make something" but "state a property this part must have", and every
  // property it can state is measured by the kernel, never by this layer --
  // volume, faces/faceCount, edges/edgeCount, holes/bores, genus, shells,
  // blades/lugs/spokes, bbox.x|y|z extents, bbox.xmin|xmax and the +x|-x
  // position aliases.
  //
  // Until now NO USER COULD PRODUCE A SINGLE VERIFY STATEMENT -- so the app could
  // not demonstrate one, could not preview one, and the whole do-no-harm half of
  // the IR was trained on a form no human had ever authored through the product.
  // That is the claim being made here, and it is checkable from the registry.
  // (An earlier draft of this block carried a figure for the share of Archie's
  // failures that are unsatisfied VERIFY assertions. It is not reproduced: it was
  // not measured in the change that wrote it and the measurement it came from
  // could not be located, so it is not stated as a fact.) A failed assertion is a HARD
  // failure of the compile and never a warning, but it does not abort the tree:
  // opVerify records the first failure and lets the rest of the tree build, so a
  // part that mis-claims its own face count by one is still measured.
  //
  // `assertion` defaults to "volume>0" -- the minimal do-no-harm invariant, true
  // of every valid solid and false of every empty one -- and the optional
  // `assertion2` reaches the variadic form. Both are free text, because the
  // quantity list above is the KERNEL's and enumerating a copy of it here would
  // make every quantity the kernel adds unreachable from the app.
  {
    CommandDescriptor c = base("part.verify", "Assert Property", "VERIFY",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{.name = "assertion",
                                 .type = ParamType::Text,
                                 .required = true,
                                 .defaultText = "volume>0",
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{"assertion2", ParamType::Text, false, 0.0, "shells=1"});
    c.preview = PreviewPolicy::None;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && !txt(ctx, "assertion", "").empty();
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      if (!t.ok) { ctx.fail("selection does not resolve to one solid"); return; }
      std::vector<IrArg> args{IrArg::valueRef(t.value),
                              IrArg::text(txt(ctx, "assertion", "volume>0"))};
      if (hasText(ctx, "assertion2")) {
        args.push_back(IrArg::text(txt(ctx, "assertion2", "shells=1")));
      }
      emit(ctx, *d, *s, "part.verify", "Assert Property", "VERIFY", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── FOLD ──────────────────────────────────────────────────────────────────
  // FOLD(%body, hx, hy, hz, len, flangeH, thk, angleDeg [, runDeg=0]) -- the
  // sheet-metal flange macro: a BOX placed at the hinge point, rotated about the
  // hinge axis and FUSEd on. It is the only op in the kernel that speaks
  // sheet metal, and the whole family of bent-tab, bracket and enclosure parts
  // needs it; PATTERN and MIRROR then replicate the flange around the part.
  //
  // The three refusals here are the kernel's own, transcribed: opFold throws
  // unless len, flangeH and thk are all > 0. `angleDeg` is deliberately NOT
  // constrained -- 0 is a flat extension of the plate, negative folds the other
  // way, and both are things a user means.
  {
    CommandDescriptor c = base("part.fold", "Sheet-metal Fold", "FOLD",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{"hinge_x", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"hinge_y", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"hinge_z", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{.name = "length",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 40.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "flange_height",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 20.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "thickness",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 2.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "angle",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 90.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{"run_angle", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "length", 0.0) > 0.0 &&
             num(ctx, "flange_height", 0.0) > 0.0 && num(ctx, "thickness", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      if (!t.ok) { ctx.fail("selection does not resolve to one solid"); return; }
      // The hinge point is POSITIONAL and required by the kernel, so all three
      // components are emitted every time -- unlike RECT's centre, there is no
      // shorter legal form of FOLD to fall back to.
      std::vector<IrArg> args{IrArg::valueRef(t.value),
                              IrArg::num(num(ctx, "hinge_x", 0.0)),
                              IrArg::num(num(ctx, "hinge_y", 0.0)),
                              IrArg::num(num(ctx, "hinge_z", 0.0)),
                              IrArg::num(num(ctx, "length", 40.0)),
                              IrArg::num(num(ctx, "flange_height", 20.0)),
                              IrArg::num(num(ctx, "thickness", 2.0)),
                              IrArg::num(num(ctx, "angle", 90.0))};
      if (hasNumber(ctx, "run_angle")) {
        args.push_back(IrArg::num(num(ctx, "run_angle", 0.0)));
      }
      emit(ctx, *d, *s, "part.fold", "Sheet-metal Fold", "FOLD", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── INPUT ─────────────────────────────────────────────────────────────────
  // INPUT() -- bind the task's input solid. Zero arguments, no selection, and it
  // is the FOURTH creator in this registry and the first that produces a SOLID
  // from nothing: every other way into a solid runs through a sketch.
  //
  // It is what makes the EDIT half of the IR expressible at all. An edit tree
  // starts from the part you were given, not from a rectangle -- `%1 = INPUT()`
  // then TAG, RESIZEBORE, DEFEATURE, VERIFY -- and without this op every edit
  // Archie emitted named a %1 no user-invocable statement could have produced.
  // opInput sniffs the CONTENT rather than the extension and accepts STEP, BREP
  // and ASCII or binary STL, then unifies the faces, because face identity is
  // meaningless on a strip-faceted body.
  //
  // No enabled predicate: whether an input solid was supplied is a fact about the
  // compile, not about the UI, and opInput says so by name ("INPUT() used but no
  // input STEP was supplied to the compiler"). Greying the command out here would
  // mean guessing that answer from the wrong side of the seam.
  {
    CommandDescriptor c = base("part.input", "Load Input Solid", "INPUT",
                               SelectionSignature::none());
    c.preview = PreviewPolicy::OnDemand;
    // Written out rather than left null. CommandDescriptor documents an absent
    // predicate as "always enabled", so the two are the same behaviour -- but
    // part_commands_test asserts that every Part command carries the WHOLE s19.2
    // contract, and "this command can always run" is a claim worth making out
    // loud, not a field left blank. Nothing here can make it false: whether an
    // input solid was supplied is a fact about the compile, and opInput says so
    // by name ("INPUT() used but no input STEP was supplied to the compiler").
    c.enabled = [](const CommandContext&) { return true; };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args;
      emit(ctx, *d, *s, "part.input", "Load Input Solid", "INPUT", std::move(args),
           IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── WIRE ──────────────────────────────────────────────────────────────────
  // WIRE([x y z; x y z; ...]) -- an EXPLICIT closed 3D loft section, and the
  // second producer of a WIRE value after RING. RING can only draw a
  // superellipse; an airfoil, a volute, a cam lobe and every sharp-cornered
  // section are exactly the shapes it cannot draw, and they are the sections the
  // owner's ground-truth parts are made of (67 of one fixture's faces are
  // b-spline). LOFT then skins two or more of them.
  //
  // The points are typed as a spec string -- "x y z; x y z; ..." -- because that
  // IS the IR's own grammar for a point ring, minus the brackets the token adds.
  // Nothing about the ring is inferred: no closing point is appended (the kernel
  // closes it), no ordering is imposed, and no coordinate is rounded.
  {
    CommandDescriptor c = base("part.wire_section", "Wire Section", "WIRE",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "points",
                                 .type = ParamType::Text,
                                 .required = true,
                                 .defaultText = "20 0 0; 0 20 0; -20 0 0; 0 -20 0",
                                 .hasDefault = true});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // wireExplicit() throws "WIRE needs >= 3 points": two points are a line
      // segment, not a section, and no closed profile can be made from them.
      return irPointsWellFormed(txt(ctx, "points", ""), 3, 3);
    };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args{
          IrArg::points3(txt(ctx, "points", "20 0 0; 0 20 0; -20 0 0; 0 -20 0"))};
      emit(ctx, *d, *s, "part.wire_section", "Wire Section", "WIRE", std::move(args),
           IrValueKind::Wire, {}, wireNodeFor(d->nextIrId()));
    };
    add(std::move(c));
  }

  // ── SWEEP ─────────────────────────────────────────────────────────────────
  // SWEEP(r, [x y z; ...]) -- a circular pipe of radius r along a 3D polyline.
  // The tubing, conduit, hydraulic-line and handle family, none of which any
  // combination of the other ops can build: EXTRUDE goes in one direction and
  // LOFT skins sections that a user would have to place by hand along the path.
  //
  // It is a CREATOR -- no leading %ref, no selection -- which is why it produces
  // a new body rather than editing the selected one. The kernel routes it to
  // pipeFromPolyline rather than part::sweep, because part::sweep collapses when
  // the profile and the path are coplanar.
  //
  // ★ SWEEP IS EXACT ON A STRAIGHT PATH AND LOSES VOLUME ON A BEND. Measured
  // through the pinned native verifier, r = 5, expected volume = pi*r^2*len:
  //     path                        len      expect    measured     error
  //     [0 0 0; 0 0 100]         100.000    7853.982    7853.982     +0.0%
  //     [0 0 0; 0 0 50; 0 0 100] 100.000    7853.982    7853.982     +0.0%   collinear
  //     [0 0 0; 0 30 30]          42.426    3332.162    3332.162     +0.0%   tilted
  //     [0 0 0; 0 0 40; 0 30 40]  70.000    5497.787    3141.593    -42.9%   ONE bend
  //     [0 0 0; 0 0 40; 0 30 70]  82.426    6473.755    5497.787    -15.1%   ONE bend
  // The L-bend row also reports shellCount 2 -- not one solid. Straight, collinear
  // and tilted are exact to the last digit; every path that BENDS is short.
  //
  // WHERE IT COMES FROM, and it is one line away from this file: pipeFromPolyline
  // (Features.cpp) has TWO backends. The native one is described in its own
  // comment as "the native engine's mitre-trimmed cylinder chain" -- mitring is
  // exactly what a corner needs -- and it is taken only `if
  // (occtloft::pipeNativeEnabled())`. FeatureTreeCompiler::compile() calls
  // `setForgeNativeBrepEnabled(false)` for EVERY build, so no feature-tree SWEEP
  // ever reaches it; they all fall through to BRepOffsetAPI_MakePipe, which does
  // not mitre a sharp spine vertex. NOT fixed here: that is a kernel change and it
  // has to be re-measured through a kernel build.
  //
  // The command SHIPS, because refusing a whole op the kernel has is the one thing
  // this layer may not do, and because the app now has the instrument that catches
  // it -- `part.verify` can assert the pipe's own volume. What changed is the
  // DEFAULT: it was a bent path, so the out-of-the-box click emitted a statement
  // 15% short of the pipe it describes. It is now the straight path measured exact
  // above, and a user who bends it gets geometry the kernel is honest about.
  {
    CommandDescriptor c = base("part.sweep_pipe", "Sweep Pipe", "SWEEP",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "radius",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 5.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "path",
                                 .type = ParamType::Text,
                                 .required = true,
                                 .defaultText = "0 0 0; 0 0 100",
                                 .hasDefault = true});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [](const CommandContext& ctx) {
      // Both refusals are opSweep's own, transcribed: "SWEEP: pipe radius must be
      // > 0" and "SWEEP: path needs >= 2 points".
      return num(ctx, "radius", 0.0) > 0.0 && irPointsWellFormed(txt(ctx, "path", ""), 3, 2);
    };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args{IrArg::num(num(ctx, "radius", 5.0)),
                              IrArg::points3(txt(ctx, "path", "0 0 0; 0 0 100"))};
      emit(ctx, *d, *s, "part.sweep_pipe", "Sweep Pipe", "SWEEP", std::move(args),
           IrValueKind::Solid, {}, {});
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
      const int position = static_cast<int>(num(ctx, "position", 0.0));
      // THE CLAMP IS READ FROM THE PREVIEW, NOT OFF THE EDIT.
      //
      // This used to keep a raw MoveFeatureEdit* across the perform() call and
      // read blockedBy()/clampedTo() from it in the failure branch. That is a
      // USE-AFTER-FREE: UndoStack::perform takes the unique_ptr BY VALUE and
      // returns early on `if (!edit->apply(doc)) return false;` -- a refused edit
      // is never pushed, so it is destroyed at that return and the pointer
      // dangles. It read as a plausible wrong answer rather than a crash: the
      // pinning statement came back as 0 and the message degraded to a bare "the
      // feature cannot move there", silently dropping the one fact the user and a
      // repair loop need.
      //
      // previewMove() is the right instrument and it is already the module's
      // contract: it copies the document, performs the move on the copy and
      // reports where it lands and what stopped it, so the preview and the
      // outcome are the same computation by construction.
      const Impact preview = previewMove(*d, irId, position);
      auto edit = std::make_unique<MoveFeatureEdit>(
          irId, position, "Reorder " + rowName(*rec));
      if (!s->perform(*d, std::move(edit))) {
        // Not a silent no-op: name the statement that pinned it, which is what a
        // repair loop (and a user) needs to know.
        std::string why = "the feature cannot move there";
        if (preview.blockedBy != 0) {
          why += "; %" + std::to_string(preview.blockedBy) + " pins it at position " +
                 std::to_string(preview.clampedTo);
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
        "part.boolean_intersect",  "part.boolean_subtract",   "part.boolean_union",
        "part.chamfer",            "part.counterbore",        "part.defeature",
        "part.delete_feature",     "part.edit_feature",       "part.extrude",
        "part.fillet",             "part.fold",               "part.heal",
        "part.hole",               "part.input",              "part.loft",
        "part.mirror",             "part.move",               "part.pattern_circular",
        "part.pattern_grid",       "part.pattern_linear",     "part.primitive_box",
        "part.primitive_cone",     "part.primitive_cylinder", "part.primitive_prism",
        "part.primitive_sphere",   "part.primitive_torus",    "part.primitive_tube",
        "part.push_face",          "part.rename_feature",     "part.reorder_feature",
        "part.resize_bore",        "part.revolve",            "part.rollback_end",
        "part.rollback_to",        "part.rotate",             "part.section_ring",
        "part.shell",              "part.sketch_circle",      "part.sketch_poly",
        "part.sketch_polygon",     "part.sketch_rect",        "part.sketch_rounded_rect",
        "part.suppress_feature",   "part.sweep_pipe",         "part.tag_feature",
        "part.unsuppress_feature", "part.variable_fillet",    "part.verify",
        "part.wire_section",
    };
    std::sort(v.begin(), v.end());
    return v;
  }();
  return ids;
}

}  // namespace forge::ui
