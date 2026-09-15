// forge-kernel/src/ft/SketchAdmission.cpp — see forge/ft/SketchAdmission.hpp.
//
// Everything here is a COMPARISON of two solver readings. It computes no geometry
// and runs no repair of its own: both readings come from inspectSketches(), which
// builds the sketches through the real facade, diagnoses them and runs the same
// solveOrRepair() the compiler runs.

#include "forge/ft/SketchAdmission.hpp"

#include <algorithm>
#include <exception>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"
#include "forge/ft/SketchInspect.hpp"

namespace forge {
namespace ft {

const char* toString(SketchChangeRefusal refusal) noexcept {
  switch (refusal) {
    case SketchChangeRefusal::None: return "none";
    case SketchChangeRefusal::Conflicts: return "conflicts";
    case SketchChangeRefusal::NotApplied: return "not_applied";
    case SketchChangeRefusal::Unsolvable: return "unsolvable";
  }
  return "none";
}

namespace {

// Parse, then give every sketch that has no SOLVE a probe SOLVE at the end, so the
// numeric half of the judgement is measured on every sketch and not only on the
// ones the program happens to have closed. The probe exists only in this copy of
// the tree; nothing is written back.
bool readProbed(const std::string& text, SketchInspection& out) {
  FeatureTree tree;
  try {
    tree = parse(text);
  } catch (...) {
    return false;
  }
  int nextId = 0;
  std::vector<int> sketches;
  std::vector<int> solved;
  for (const Op& op : tree.ops) {
    nextId = std::max(nextId, op.id);
    if (op.code == OpCode::Sketch) sketches.push_back(op.id);
  }
  // A SOLVE names its sketch through a chain of CON pass-throughs; inspectSketches
  // resolves that chain, so ask it which sketches already have one.
  try {
    const SketchInspection plain = inspectSketches(tree);
    for (const SketchInfo& s : plain.sketches) {
      if (s.solveIrId != 0) solved.push_back(s.irId);
    }
  } catch (...) {
    return false;
  }
  for (const int sk : sketches) {
    if (std::find(solved.begin(), solved.end(), sk) != solved.end()) continue;
    Op probe;
    probe.id = ++nextId;
    probe.code = OpCode::Solve;
    probe.name = "SOLVE";
    Token ref;
    ref.kind = TokKind::Ref;
    ref.ref = sk;
    probe.args.push_back(ref);
    tree.ops.push_back(std::move(probe));
  }
  try {
    out = inspectSketches(tree);
  } catch (...) {
    return false;
  }
  return out.ok;
}

const SketchInfo* sketchById(const SketchInspection& insp, int irId) {
  for (const SketchInfo& s : insp.sketches) {
    if (s.irId == irId) return &s;
  }
  return nullptr;
}

const SketchConstraintInfo* constraintById(const SketchInfo& s, int irId) {
  for (const SketchConstraintInfo& c : s.constraints) {
    if (c.irId == irId) return &c;
  }
  return nullptr;
}

bool solvesCleanly(const SketchInfo& s) {
  if (!s.solved || !s.converged) return false;
  return std::none_of(s.constraints.begin(), s.constraints.end(),
                      [](const SketchConstraintInfo& c) { return c.demoted; });
}

std::string ids(const std::vector<int>& v) {
  std::string out;
  for (const int id : v) {
    if (!out.empty()) out += ", ";
    out += "%" + std::to_string(id);
  }
  return out;
}

}  // namespace

SketchChangeVerdict judgeSketchChange(const std::string& programBefore,
                                      const std::string& programAfter, int changedIrId) {
  SketchChangeVerdict v;
  v.statementIrId = changedIrId;

  SketchInspection after;
  if (!readProbed(programAfter, after)) {
    v.detail = "the changed program could not be read; the document's validator decides";
    return v;
  }
  v.sketchIrId = after.sketchOf(changedIrId);
  if (v.sketchIrId == 0) return v;
  const SketchInfo* sa = sketchById(after, v.sketchIrId);
  if (sa == nullptr) return v;
  v.dofAfter = sa->dof;
  v.fullyConstrainedAfter = (sa->health == SketchHealth::FullyConstrained);
  v.sketchAfter = *sa;

  const SketchConstraintInfo* ca = constraintById(*sa, changedIrId);
  if (ca == nullptr) {
    v.detail = "not a constraint";
    return v;
  }
  v.isConstraint = true;
  v.keyword = ca->keyword;

  SketchInspection before;
  const SketchInfo* sb = nullptr;
  const SketchConstraintInfo* cb = nullptr;
  if (readProbed(programBefore, before)) {
    sb = sketchById(before, v.sketchIrId);
    if (sb != nullptr) {
      v.dofBefore = sb->dof;
      cb = constraintById(*sb, changedIrId);
    }
  }

  // (1) it cannot hold at all
  if (ca->state != SketchConstraintState::Applied &&
      !(cb != nullptr && cb->state == ca->state)) {
    v.admitted = false;
    v.refusal = SketchChangeRefusal::NotApplied;
    v.detail = "CON %" + std::to_string(changedIrId) + " " + ca->keyword + " would hold nothing";
    return v;
  }

  // (2) it contradicts other constraints, and did not before
  if (ca->conflicting && !(cb != nullptr && cb->conflicting)) {
    v.admitted = false;
    v.refusal = SketchChangeRefusal::Conflicts;
    v.conflictsWith = ca->conflictsWith;
    if (v.conflictsWith.empty()) {
      // A conflict with no group attached cannot name a partner; say which other
      // constraints the solver marked, rather than inventing a pair.
      for (const SketchConstraintInfo& c : sa->constraints) {
        if (c.irId != changedIrId && c.conflicting) v.conflictsWith.push_back(c.irId);
      }
    }
    v.detail = "CON %" + std::to_string(changedIrId) + " " + ca->keyword + " conflicts with " +
               ids(v.conflictsWith);
    return v;
  }

  // (3) it leaves a sketch that solved cleanly unable to solve
  const bool cleanBefore = (sb == nullptr) || solvesCleanly(*sb);
  if (cleanBefore && !solvesCleanly(*sa)) {
    v.admitted = false;
    v.refusal = SketchChangeRefusal::Unsolvable;
    for (const SketchConstraintInfo& c : sa->constraints) {
      if (c.demoted) v.dropped.push_back(c.irId);
    }
    if (v.dropped.empty()) v.dropped.push_back(changedIrId);
    v.detail = "CON %" + std::to_string(changedIrId) + " " + ca->keyword +
               " leaves the sketch unsolvable (the solve drops " + ids(v.dropped) + ")";
    return v;
  }

  v.detail = "admitted";
  return v;
}

}  // namespace ft
}  // namespace forge
