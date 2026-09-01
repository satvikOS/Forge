// ui/src/PartDocumentState.cpp
//
// THE DOCUMENT'S NON-GEOMETRIC HALF, and the one computation that decides what
// the feature tree shows and what the kernel is asked to build.
//
// PartCommands.cpp owns the receiver as a PROGRAM: append a statement, edit its
// arguments, undo. This file owns it as a DOCUMENT: named parameters, materials,
// persistent names, suppression, the rollback bar, reorder, and the per-row
// diagnostics that make every one of those legible when it goes wrong.
//
// ── the rule that shaped all of it ──────────────────────────────────────────
// "dont gate anything if you do that then how will Archie generate ultra long
// feature trees for Kernel to execute" -- the owner's constraint, and it is a
// design rule, not a slogan. A modeller that REFUSES the edit that would break
// the document leaves the user holding a tree they cannot fix and cannot see
// into. So every operation here is total where it can be: a reorder that creates
// a forward reference SUCCEEDS, and the document then says, per row, exactly
// what is wrong and what it took down with it. The only refusals left are the
// meaningless ones -- an unknown id, a position off the end, a material name
// nothing defines.
//
// ── one graph walk, two answers ─────────────────────────────────────────────
// resolveGraph() below is the single place that decides both "what colour is
// this row" and "what program does the kernel get". They MUST agree: a row shown
// green whose statement was silently dropped from the build is the exact defect
// this file exists to prevent. So there is one walk, and both answers fall out
// of it.
#include "forge/ui/PartCommands.hpp"

#include <algorithm>
#include <cstddef>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"

namespace forge::ui {

const char* toString(FeatureStatus status) noexcept {
  switch (status) {
    case FeatureStatus::Ok:         return "ok";
    case FeatureStatus::Suppressed: return "suppressed";
    case FeatureStatus::RolledBack: return "rolled_back";
    case FeatureStatus::Blocked:    return "blocked";
    case FeatureStatus::Error:      return "error";
  }
  return "error";
}

namespace {

bool isIdentifier(const std::string& s) {
  if (s.empty()) return false;
  const char c0 = s[0];
  if (!((c0 >= 'A' && c0 <= 'Z') || (c0 >= 'a' && c0 <= 'z') || c0 == '_')) return false;
  for (std::size_t i = 1; i < s.size(); ++i) {
    const char c = s[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')) {
      return false;
    }
  }
  return true;
}

// A row's label for a message, falling back to the op so a message is never
// "input %14 () is suppressed".
std::string rowName(const FeatureRecord& r) {
  if (!r.persistentName.empty()) return r.persistentName;
  if (!r.label.empty()) return r.label;
  return r.line.op;
}

const char* statusWord(FeatureStatus s) {
  switch (s) {
    case FeatureStatus::Suppressed: return "suppressed";
    case FeatureStatus::RolledBack: return "rolled back";
    case FeatureStatus::Blocked:    return "blocked";
    case FeatureStatus::Error:      return "in error";
    case FeatureStatus::Ok:         return "built";
  }
  return "unavailable";
}

}  // namespace

// ── one walk ────────────────────────────────────────────────────────────────
//
// Indexed 1..n by irId. `resolved[i]` is the id of the statement whose VALUE a
// consumer of %i must use: i itself when %i builds, the value %i passes through
// when it is suppressed, and 0 when there is nothing to hand on.
//
// THE PASS-THROUGH IS WHY SUPPRESSION IS USABLE AT ALL. Suppressing one fillet
// in a chain of forty must not orphan the other thirty-nine; a suppressed op
// hands its own first value reference down, so `%18 = SHELL(%17, 2)` keeps
// building off whatever %17 was built from. An op with no value input (a BOX, a
// RECT) has nothing to hand on, and its consumers are told exactly that.
PartDocument::GraphResolution PartDocument::resolveGraph() const {
  const std::size_t n = records_.size();
  GraphResolution g;
  g.status.assign(n + 1, FeatureStatus::Ok);
  g.message.assign(n + 1, std::string());
  g.fromVerifier.assign(n + 1, false);
  g.resolved.assign(n + 1, 0);
  g.emitted.reserve(n);

  for (std::size_t i = 0; i < n; ++i) {
    const FeatureRecord& r = records_[i];
    const int id = static_cast<int>(i) + 1;  // POSITION, which is what irId means

    // 1. Is the statement itself legal? An illegal statement is illegal whatever
    //    is true of its neighbours, and validateIr's reason is the kernel's own
    //    rule set (FeatureIr.hpp transcribes FeatureTree.hpp), not a house rule.
    const IrCheck chk = validateIr(r.line);
    if (chk != IrCheck::Ok) {
      g.status[static_cast<std::size_t>(id)] = FeatureStatus::Error;
      g.message[static_cast<std::size_t>(id)] =
          std::string("not legal feature-IR: ") + toString(chk) + " -- " + r.line.text();
      continue;
    }

    // 2. Did the kernel verifier reject it? Its text, verbatim.
    if (!r.verifierMessage.empty()) {
      g.status[static_cast<std::size_t>(id)] = FeatureStatus::Error;
      g.message[static_cast<std::size_t>(id)] = r.verifierMessage;
      g.fromVerifier[static_cast<std::size_t>(id)] = true;
      continue;
    }

    // 3. Rolled back BEFORE suppressed: the bar is a statement about how far the
    //    document is being built at all, and a suppressed row past the bar is
    //    past the bar first.
    if (rollback_ != kRollbackEnd && id > rollback_) {
      g.status[static_cast<std::size_t>(id)] = FeatureStatus::RolledBack;
      g.message[static_cast<std::size_t>(id)] =
          rollback_ <= 0 ? std::string("rolled back: the bar is above the first statement")
                         : ("rolled back: the bar is after %" + std::to_string(rollback_));
      continue;
    }

    // 4. Are its inputs available? The first unavailable one is named -- naming
    //    all of them turns a repairable message into a wall of text, and the
    //    first is the one to fix.
    int blockedBy = 0;
    for (const IrArg& a : r.line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      const std::size_t ref = static_cast<std::size_t>(a.ref);
      if (ref == 0 || ref > n || g.resolved[ref] == 0) {
        blockedBy = a.ref;
        break;
      }
    }

    if (r.suppressed) {
      g.status[static_cast<std::size_t>(id)] = FeatureStatus::Suppressed;
      g.message[static_cast<std::size_t>(id)] = "suppressed: this feature is not built";
      // Pass through the FIRST value reference, if it has one and it resolves.
      for (const IrArg& a : r.line.args) {
        if (a.kind != IrArgKind::Ref) continue;
        const std::size_t ref = static_cast<std::size_t>(a.ref);
        if (ref >= 1 && ref <= n) g.resolved[static_cast<std::size_t>(id)] = g.resolved[ref];
        break;
      }
      continue;
    }

    if (blockedBy != 0) {
      const std::size_t src = static_cast<std::size_t>(blockedBy);
      std::string why;
      if (src >= 1 && src <= n) {
        why = "its input %" + std::to_string(blockedBy) + " (" + rowName(records_[src - 1]) +
              ") is " + statusWord(g.status[src]);
        if (g.status[src] == FeatureStatus::Suppressed) {
          why += " and has no value to pass through";
        }
      } else {
        why = "it names %" + std::to_string(blockedBy) + ", which this document has no statement for";
      }
      g.status[static_cast<std::size_t>(id)] = FeatureStatus::Blocked;
      g.message[static_cast<std::size_t>(id)] = "cannot build: " + why;
      continue;
    }

    g.status[static_cast<std::size_t>(id)] = FeatureStatus::Ok;
    g.resolved[static_cast<std::size_t>(id)] = id;
    g.emitted.push_back(id);
  }

  // 5. ORPHAN PRUNE, and the narrow reason for it.
  //
  // forge::ft::compile runs an s0.4 graph-quality gate that FAILS THE WHOLE
  // PROGRAM when any op "contributes nothing to the result" (the measured text
  // is quoted in PartFile.hpp: "unexplained_orphans=1 [%1] ... The required
  // value for each is ZERO"). Suppressing a boolean orphans its tool: suppress
  // `%4 = CUT(%2, %3)` and the cylinder %3 that only ever fed it now feeds
  // nothing, so a program that was fine becomes one the kernel refuses in full.
  //
  // So statements orphaned BY THIS SUPPRESSION are dropped and told so. A
  // statement that was ALREADY an orphan in the document as written is left
  // exactly where it was: that is the author's business, it is what the kernel
  // saw before, and silently changing it would make activeIrProgram() differ
  // from irProgram() on a document nobody has suppressed anything in.
  if (!g.emitted.empty()) {
    const std::vector<bool> liveNow = reachable(g.emitted, g.resolved);
    const std::vector<bool> liveFull = reachableFull();
    std::vector<int> kept;
    kept.reserve(g.emitted.size());
    for (const int id : g.emitted) {
      const std::size_t u = static_cast<std::size_t>(id);
      if (liveNow[u] || !liveFull[u]) {
        kept.push_back(id);
        continue;
      }
      g.status[u] = FeatureStatus::Blocked;
      g.message[u] =
          "cannot build: nothing consumes its value any more -- the statement that did is "
          "suppressed or rolled back, and the kernel refuses a program with an unused result";
      g.resolved[u] = 0;
    }
    g.emitted.swap(kept);
  }
  return g;
}

// Backward reachability over the SUBSTITUTED graph -- the edges a consumer will
// actually have once refs are healed -- from ONE root.
std::vector<bool> PartDocument::reachableFrom(int root, const std::vector<int>& emitted,
                                              const std::vector<int>& resolved) const {
  std::vector<bool> live(records_.size() + 1, false);
  if (root <= 0 || static_cast<std::size_t>(root) >= live.size()) return live;
  live[static_cast<std::size_t>(root)] = true;
  for (std::size_t k = emitted.size(); k > 0; --k) {
    const int id = emitted[k - 1];
    if (!live[static_cast<std::size_t>(id)]) continue;
    const FeatureRecord& r = records_[static_cast<std::size_t>(id) - 1];
    for (const IrArg& a : r.line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      const std::size_t ref = static_cast<std::size_t>(a.ref);
      if (ref == 0 || ref >= resolved.size()) continue;
      const int sub = resolved[ref];
      if (sub > 0) live[static_cast<std::size_t>(sub)] = true;
    }
  }
  return live;
}

// WHICH SURVIVING STATEMENT IS THE RESULT, and why it is not simply the last one.
//
// MEASURED DEFECT. This used to seed the backward walk from `emitted.back()`,
// which is right exactly when the last surviving statement is the accumulated
// body -- and catastrophically wrong when it is a TOOL. Put the rollback bar
// after %68 in the 71-statement bracket fixture and %68 is the dimple's
// TRANSLATE: a sphere on its way to a CUT that is now past the bar. The prune
// then walked back from the sphere, declared all sixty-six statements of the
// actual bracket "orphaned", and handed the kernel
//
//     %1 = SPHERE(9)
//     %2 = TRANSLATE(%1, 30, 0, 20)
//
// A user who rolls the history back three steps got a floating sphere and a tree
// in which every row of their part said "nothing consumes its value any more".
// Rolling back is not an exotic gesture, and a tool authored before the boolean
// that consumes it is the ordinary shape of every CUT in every feature tree.
//
// THE ROOT IS THE SINK WITH THE LARGEST BACKWARD CONE; ties go to the later id.
// A sink is a surviving statement whose value no other surviving statement
// consumes -- forge::ft's s0.4 gate is about to refuse all but one of them, so
// this is choosing WHICH result to keep, not inventing a rule. "The largest
// cone" is "the thing the most of this document went into", which is what a
// history modeller means by the result. It degrades EXACTLY to the old
// behaviour whenever there is one sink, which is every document nobody has
// suppressed or rolled anything back in -- there, the single sink is the last
// statement and its cone is the whole program.
//
// Cost is (number of sinks) x (statements). A sink is an unused result, so the
// count is small in any document a user would recognise; the pathological case
// is bounded by the same n the rest of resolveGraph already walks.
std::vector<bool> PartDocument::reachable(const std::vector<int>& emitted,
                                          const std::vector<int>& resolved) const {
  if (emitted.empty()) return std::vector<bool>(records_.size() + 1, false);

  // A statement is CONSUMED when some other surviving statement names the value
  // it resolved to. Refs are compared through `resolved` because that is the
  // graph the kernel will see once a suppressed row's pass-through is applied.
  std::vector<bool> consumed(records_.size() + 1, false);
  for (const int id : emitted) {
    const FeatureRecord& r = records_[static_cast<std::size_t>(id) - 1];
    for (const IrArg& a : r.line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      const std::size_t ref = static_cast<std::size_t>(a.ref);
      if (ref == 0 || ref >= resolved.size()) continue;
      const int sub = resolved[ref];
      if (sub > 0 && sub != id) consumed[static_cast<std::size_t>(sub)] = true;
    }
  }

  int bestRoot = 0;
  std::size_t bestCone = 0;
  std::vector<bool> best;
  for (const int id : emitted) {
    if (consumed[static_cast<std::size_t>(id)]) continue;
    const std::vector<bool> cone = reachableFrom(id, emitted, resolved);
    std::size_t size = 0;
    for (const bool live : cone) {
      if (live) ++size;
    }
    // `>=` so a tie goes to the LATER id: `emitted` is in document order, and
    // between two results of equal weight the more recent one is the one the
    // user was working on.
    if (bestRoot == 0 || size >= bestCone) {
      bestRoot = id;
      bestCone = size;
      best = cone;
    }
  }
  // Every surviving statement is consumed by another: a cycle is impossible in
  // SSA, so this can only mean `emitted` is empty of sinks because it is a
  // single self-referencing row. Fall back to the last one rather than return
  // nothing live, which would blank the document.
  if (bestRoot == 0) return reachableFrom(emitted.back(), emitted, resolved);
  return best;
}

// The same walk over the document AS WRITTEN, so "was it already an orphan?" is
// answerable without a second notion of the graph.
std::vector<bool> PartDocument::reachableFull() const {
  const std::size_t n = records_.size();
  std::vector<bool> live(n + 1, false);
  if (n == 0) return live;
  live[n] = true;
  for (std::size_t k = n; k > 0; --k) {
    if (!live[k]) continue;
    for (const IrArg& a : records_[k - 1].line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      const std::size_t ref = static_cast<std::size_t>(a.ref);
      if (ref >= 1 && ref <= n) live[ref] = true;
    }
  }
  return live;
}

void PartDocument::recompute() {
  if (holdRecompute_ > 0) return;  // a BatchEdit is open; it will run this once on the way out
  const GraphResolution g = resolveGraph();
  diags_.clear();
  diags_.reserve(records_.size());
  for (std::size_t i = 0; i < records_.size(); ++i) {
    const std::size_t id = i + 1;
    FeatureDiagnostic d;
    d.irId = static_cast<int>(id);
    d.status = g.status[id];
    d.message = g.message[id];
    d.fromVerifier = g.fromVerifier[id];
    diags_.push_back(std::move(d));
  }
}

FeatureStatus PartDocument::statusOf(int irId) const noexcept {
  if (irId <= 0 || static_cast<std::size_t>(irId) > diags_.size()) return FeatureStatus::Error;
  return diags_[static_cast<std::size_t>(irId) - 1].status;
}

std::string PartDocument::diagnosticOf(int irId) const {
  if (irId <= 0 || static_cast<std::size_t>(irId) > diags_.size()) {
    return "no statement %" + std::to_string(irId) + " in this document";
  }
  return diags_[static_cast<std::size_t>(irId) - 1].message;
}

void PartDocument::setVerifierDiagnostic(int irId, const std::string& message) {
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return;
  records_[static_cast<std::size_t>(irId) - 1].verifierMessage = message;
  recompute();
}

void PartDocument::clearVerifierDiagnosticsFor(const std::vector<int>& irIds) {
  bool touched = false;
  for (const int id : irIds) {
    if (id <= 0 || static_cast<std::size_t>(id) > records_.size()) continue;
    FeatureRecord& r = records_[static_cast<std::size_t>(id) - 1];
    if (r.verifierMessage.empty()) continue;
    r.verifierMessage.clear();
    touched = true;
  }
  if (touched) recompute();
}

void PartDocument::clearVerifierDiagnostics() {
  for (FeatureRecord& r : records_) r.verifierMessage.clear();
  recompute();
}

std::size_t PartDocument::errorCount() const noexcept {
  std::size_t n = 0;
  for (const FeatureDiagnostic& d : diags_) {
    if (d.status == FeatureStatus::Error || d.status == FeatureStatus::Blocked) ++n;
  }
  return n;
}

std::size_t PartDocument::builtCount() const noexcept {
  std::size_t n = 0;
  for (const FeatureDiagnostic& d : diags_) {
    if (d.status == FeatureStatus::Ok) ++n;
  }
  return n;
}

std::vector<FeatureDiagnostic> PartDocument::blockedFeatures() const {
  std::vector<FeatureDiagnostic> out;
  for (const FeatureDiagnostic& d : diags_) {
    if (d.status != FeatureStatus::Ok) out.push_back(d);
  }
  return out;
}

std::vector<int> PartDocument::emittedFeatures() const { return resolveGraph().emitted; }

// ── the program the kernel is asked to build ────────────────────────────────
std::string PartDocument::activeIrProgram() const {
  const GraphResolution g = resolveGraph();
  // Renumber the survivors 1..m. A program whose ids are not 1..m in creation
  // order is not a program forge::ft will accept, and leaving gaps to "keep the
  // ids stable" would make the emitted text disagree with itself.
  std::vector<int> renumber(records_.size() + 1, 0);
  for (std::size_t k = 0; k < g.emitted.size(); ++k) {
    renumber[static_cast<std::size_t>(g.emitted[k])] = static_cast<int>(k) + 1;
  }
  std::string out;
  for (std::size_t k = 0; k < g.emitted.size(); ++k) {
    const int id = g.emitted[k];
    IrLine line = records_[static_cast<std::size_t>(id) - 1].line;
    line.id = static_cast<int>(k) + 1;
    for (IrArg& a : line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      const std::size_t ref = static_cast<std::size_t>(a.ref);
      const int sub = (ref < g.resolved.size()) ? g.resolved[ref] : 0;
      a.ref = (sub > 0) ? renumber[static_cast<std::size_t>(sub)] : 0;
    }
    out += line.text();
    out += "\n";
  }
  return out;
}

// ── identity and units ──────────────────────────────────────────────────────
void PartDocument::setName(std::string value) {
  name_ = value.empty() ? std::string("untitled") : std::move(value);
}

bool PartDocument::setUnits(std::string value) {
  if (value.empty()) return false;
  units_ = std::move(value);
  return true;
}

// ── parameters ──────────────────────────────────────────────────────────────
const Parameter* PartDocument::parameter(const std::string& name) const noexcept {
  for (const Parameter& p : params_) {
    if (p.name == name) return &p;
  }
  return nullptr;
}

bool PartDocument::driveArg(int irId, std::size_t argIndex, double value) {
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return false;
  FeatureRecord& rec = records_[static_cast<std::size_t>(irId) - 1];
  if (argIndex >= rec.line.args.size()) return false;
  if (rec.line.args[argIndex].kind != IrArgKind::Number) return false;
  std::vector<IrArg> args = rec.line.args;
  args[argIndex] = IrArg::num(value);
  // Already holding the value is SUCCESS here, not EditCheck::NoChange. A
  // parameter that drives three slots and finds one of them already correct has
  // still done its job; reporting failure would make setParameter's answer
  // depend on how many slots happened to be stale.
  const IrLine candidate{rec.line.id, rec.line.op, args};
  if (candidate.text() == rec.line.text()) return true;
  return editFeatureArgs(irId, args);
}

bool PartDocument::setParameter(const Parameter& p) {
  if (!isIdentifier(p.name)) return false;
  // One settle for the whole edit: driving twenty slots must not walk the
  // document twenty times.
  BatchEdit hold(*this);
  Parameter* existing = nullptr;
  for (Parameter& q : params_) {
    if (q.name == p.name) { existing = &q; break; }
  }
  if (existing != nullptr) {
    *existing = p;
  } else {
    params_.push_back(p);
    std::sort(params_.begin(), params_.end(),
              [](const Parameter& a, const Parameter& b) { return a.name < b.name; });
  }
  // Push the value into every slot that names it. A slot that refuses (the
  // statement is invalid, the slot is not a number any more) does not stop the
  // others: the parameter is the authority, and a slot that cannot take it is a
  // per-row diagnostic, not a reason to abandon the edit.
  for (FeatureRecord& r : records_) {
    for (const ArgParamBinding& b : r.argParams) {
      if (b.parameter == p.name) driveArg(r.irId, b.argIndex, p.value);
    }
  }
  return true;
}

bool PartDocument::removeParameter(const std::string& name) {
  const std::size_t before = params_.size();
  params_.erase(std::remove_if(params_.begin(), params_.end(),
                               [&name](const Parameter& q) { return q.name == name; }),
                params_.end());
  if (params_.size() == before) return false;
  for (FeatureRecord& r : records_) {
    r.argParams.erase(std::remove_if(r.argParams.begin(), r.argParams.end(),
                                     [&name](const ArgParamBinding& b) {
                                       return b.parameter == name;
                                     }),
                      r.argParams.end());
  }
  return true;
}

bool PartDocument::bindArgToParameter(int irId, std::size_t argIndex,
                                      const std::string& parameter) {
  const Parameter* p = this->parameter(parameter);
  if (p == nullptr) return false;
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return false;
  FeatureRecord& rec = records_[static_cast<std::size_t>(irId) - 1];
  if (argIndex >= rec.line.args.size()) return false;
  // Only a NUMBER slot can be parameter-driven. A ref slot is the dependency
  // graph and a keyword slot is a mode; driving either from a double would be a
  // reparent or a nonsense keyword, dressed up as a dimension change.
  if (rec.line.args[argIndex].kind != IrArgKind::Number) return false;
  for (ArgParamBinding& b : rec.argParams) {
    if (b.argIndex == argIndex) { b.parameter = parameter; driveArg(irId, argIndex, p->value); recompute(); return true; }
  }
  rec.argParams.push_back(ArgParamBinding{argIndex, parameter});
  std::sort(rec.argParams.begin(), rec.argParams.end(),
            [](const ArgParamBinding& a, const ArgParamBinding& b) {
              return a.argIndex < b.argIndex;
            });
  driveArg(irId, argIndex, p->value);
  recompute();
  return true;
}

bool PartDocument::unbindArg(int irId, std::size_t argIndex) {
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return false;
  FeatureRecord& rec = records_[static_cast<std::size_t>(irId) - 1];
  const std::size_t before = rec.argParams.size();
  rec.argParams.erase(std::remove_if(rec.argParams.begin(), rec.argParams.end(),
                                     [argIndex](const ArgParamBinding& b) {
                                       return b.argIndex == argIndex;
                                     }),
                      rec.argParams.end());
  return rec.argParams.size() != before;
}

std::size_t PartDocument::drivenArgCount() const noexcept {
  std::size_t n = 0;
  for (const FeatureRecord& r : records_) n += r.argParams.size();
  return n;
}

// ── materials ───────────────────────────────────────────────────────────────
const Material* PartDocument::material(const std::string& name) const noexcept {
  for (const Material& m : materials_) {
    if (m.name == name) return &m;
  }
  return nullptr;
}

bool PartDocument::setMaterial(const Material& m) {
  if (m.name.empty()) return false;
  for (Material& q : materials_) {
    if (q.name == m.name) { q = m; return true; }
  }
  materials_.push_back(m);
  std::sort(materials_.begin(), materials_.end(),
            [](const Material& a, const Material& b) { return a.name < b.name; });
  return true;
}

bool PartDocument::removeMaterial(const std::string& name) {
  const std::size_t before = materials_.size();
  materials_.erase(std::remove_if(materials_.begin(), materials_.end(),
                                  [&name](const Material& q) { return q.name == name; }),
                   materials_.end());
  if (materials_.size() == before) return false;
  // An assignment naming a material nobody defines is how a BOM gets a blank
  // row, so the assignments go with it.
  for (auto it = materialOfNode_.begin(); it != materialOfNode_.end();) {
    it = (it->second == name) ? materialOfNode_.erase(it) : std::next(it);
  }
  return true;
}

bool PartDocument::assignMaterial(const std::string& node, const std::string& materialName) {
  if (node.empty()) return false;
  if (material(materialName) == nullptr) return false;
  materialOfNode_[node] = materialName;
  return true;
}

bool PartDocument::clearMaterial(const std::string& node) {
  return materialOfNode_.erase(node) != 0;
}

std::string PartDocument::materialOf(const std::string& node) const {
  auto it = materialOfNode_.find(node);
  return it == materialOfNode_.end() ? std::string() : it->second;
}

// ── named entities ──────────────────────────────────────────────────────────
bool PartDocument::setPersistentName(int irId, const std::string& name) {
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return false;
  if (name.empty()) {
    records_[static_cast<std::size_t>(irId) - 1].persistentName.clear();
    return true;
  }
  // Stored WITH the '@', so the string in the document is the string a kernel
  // selector would use. "@rim" and "rim" must not become two names for one
  // feature, and normalising on the way in is the only place that can be true
  // for every caller.
  const std::string canonical = (name[0] == '@') ? name : ("@" + name);
  for (std::size_t i = 0; i < records_.size(); ++i) {
    if (static_cast<int>(i) + 1 == irId) continue;
    if (records_[i].persistentName == canonical) return false;
  }
  records_[static_cast<std::size_t>(irId) - 1].persistentName = canonical;
  return true;
}

int PartDocument::featureNamed(const std::string& persistentName) const noexcept {
  if (persistentName.empty()) return 0;
  const std::string canonical =
      (persistentName[0] == '@') ? persistentName : ("@" + persistentName);
  for (std::size_t i = 0; i < records_.size(); ++i) {
    if (records_[i].persistentName == canonical) return static_cast<int>(i) + 1;
  }
  return 0;
}

// ── suppression and rollback ────────────────────────────────────────────────
bool PartDocument::setSuppressed(int irId, bool suppressed) {
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return false;
  records_[static_cast<std::size_t>(irId) - 1].suppressed = suppressed;
  recompute();
  return true;
}

bool PartDocument::setRollbackAfter(int irId) {
  if (irId != kRollbackEnd && (irId < 0 || static_cast<std::size_t>(irId) > records_.size())) {
    return false;
  }
  rollback_ = irId;
  recompute();
  return true;
}

// ── REORDER ─────────────────────────────────────────────────────────────────
bool PartDocument::moveFeature(int irId, int newPosition) {
  const int n = static_cast<int>(records_.size());
  if (irId <= 0 || irId > n) return false;
  if (newPosition <= 0 || newPosition > n) return false;
  if (irId == newPosition) return false;  // a no-op is not an edit, so undo never holds one

  FeatureRecord moving = records_[static_cast<std::size_t>(irId) - 1];
  records_.erase(records_.begin() + (irId - 1));
  records_.insert(records_.begin() + (newPosition - 1), std::move(moving));
  reindexAfterMove();
  recompute();
  return true;
}

// After a move the vector order IS the truth; ids and every `%N` are rebuilt
// from it. The map is keyed by the id each record CARRIED before renumbering,
// which is exactly what the refs still spell.
void PartDocument::reindexAfterMove() {
  const std::size_t n = records_.size();
  std::map<int, int> oldToNew;
  for (std::size_t i = 0; i < n; ++i) oldToNew[records_[i].irId] = static_cast<int>(i) + 1;

  for (std::size_t i = 0; i < n; ++i) {
    FeatureRecord& r = records_[i];
    const int newId = static_cast<int>(i) + 1;
    r.irId = newId;
    r.line.id = newId;
    for (IrArg& a : r.line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      auto it = oldToNew.find(a.ref);
      // A ref to an id the document never had is left ALONE. Rewriting it to 0
      // would destroy the only evidence of what the author meant, and
      // validateIr already reports it as the error it is.
      if (it != oldToNew.end()) a.ref = it->second;
    }
  }
  // The node bindings name VALUES, and a value moved with its statement.
  for (auto& kv : bindings_) {
    auto it = oldToNew.find(kv.second);
    if (it != oldToNew.end()) kv.second = it->second;
  }
  // The rollback bar names a POSITION in the built order, so it stays where it
  // is on screen -- it is a line between rows, not a handle on a statement.
}

// ── the tolerant append ─────────────────────────────────────────────────────
bool PartDocument::adoptFeature(const FeatureRecord& record,
                                const std::vector<std::string>& nodes) {
  if (record.irId != nextIrId()) {
    lastCheck_ = IrCheck::BadStatementId;
    return false;
  }
  FeatureRecord copy = record;
  copy.line.id = record.irId;  // the file's ID line is the authority on both
  lastCheck_ = validateIr(copy.line);
  records_.push_back(std::move(copy));
  for (const std::string& node : nodes) {
    if (!node.empty()) bindings_[node] = record.irId;
  }
  recompute();
  return true;
}

// ── SetSuppressedEdit ───────────────────────────────────────────────────────
SetSuppressedEdit::SetSuppressedEdit(int irId, bool suppressed, std::string label)
    : irId_(irId), after_(suppressed), label_(std::move(label)) {}

bool SetSuppressedEdit::apply(PartDocument& doc) {
  const FeatureRecord* rec = doc.featureAt(irId_);
  if (rec == nullptr) return false;
  if (rec->suppressed == after_) return false;  // refused, so undo never holds a no-op
  // Captured on EVERY apply, not once at construction: redo runs apply() again,
  // and a `before_` frozen at construction would put back a state the document
  // no longer had after undo-redo-undo. Same reason EditFeatureArgsEdit does it.
  before_ = rec->suppressed;
  return doc.setSuppressed(irId_, after_);
}

void SetSuppressedEdit::revert(PartDocument& doc) { doc.setSuppressed(irId_, before_); }

// ── MoveFeatureEdit ─────────────────────────────────────────────────────────
MoveFeatureEdit::MoveFeatureEdit(int irId, int newPosition, std::string label)
    : from_(irId), to_(newPosition), label_(std::move(label)) {}

bool MoveFeatureEdit::apply(PartDocument& doc) { return doc.moveFeature(from_, to_); }

void MoveFeatureEdit::revert(PartDocument& doc) { doc.moveFeature(to_, from_); }

// ── SetParameterEdit ────────────────────────────────────────────────────────
SetParameterEdit::SetParameterEdit(Parameter after, std::string label)
    : after_(std::move(after)), label_(std::move(label)) {}

bool SetParameterEdit::apply(PartDocument& doc) {
  const Parameter* existing = doc.parameter(after_.name);
  existed_ = existing != nullptr;
  if (existed_) {
    before_ = *existing;
    if (before_.value == after_.value && before_.unit == after_.unit &&
        before_.comment == after_.comment) {
      return false;
    }
  }
  return doc.setParameter(after_);
}

void SetParameterEdit::revert(PartDocument& doc) {
  if (existed_) {
    doc.setParameter(before_);
  } else {
    // Undoing the CREATION of a parameter must remove it, or the next Save
    // writes a name the user undid into the file.
    doc.removeParameter(after_.name);
  }
}

}  // namespace forge::ui
