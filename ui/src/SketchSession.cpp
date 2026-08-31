#include "forge/ui/SketchSession.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/SelectionService.hpp"
#include "forge/ui/SketchAssist.hpp"
#include "forge/ui/SketchScene.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {
namespace {

constexpr double kDegPerRad = 57.295779513082320876798154814105;

bool isCircular(SketchEntityKind k) noexcept {
  return k == SketchEntityKind::Circle || k == SketchEntityKind::Arc;
}

std::string num(double v) {
  char buf[40];
  std::snprintf(buf, sizeof(buf), "%.4g", v);
  return std::string(buf);
}

template <typename T>
void toggleInto(std::vector<T>& v, const T& value, bool additive) {
  if (!additive) {
    v.clear();
    v.push_back(value);
    return;
  }
  const auto it = std::find(v.begin(), v.end(), value);
  if (it == v.end()) v.push_back(value);
  else v.erase(it);
}

void mix(std::size_t& h, std::uint64_t v) {
  h ^= static_cast<std::size_t>(v + 0x9E3779B97F4A7C15ULL + (h << 6) + (h >> 2));
}

void mixDouble(std::size_t& h, double d) {
  std::uint64_t bits = 0;
  std::memcpy(&bits, &d, sizeof(bits));
  mix(h, bits);
}

}  // namespace

// ── tools ───────────────────────────────────────────────────────────────────
const char* toString(SketchTool tool) noexcept {
  switch (tool) {
    case SketchTool::Select:    return "select";
    case SketchTool::Point:     return "point";
    case SketchTool::Line:      return "line";
    case SketchTool::Polyline:  return "polyline";
    case SketchTool::Rectangle: return "rectangle";
    case SketchTool::Circle:    return "circle";
    case SketchTool::Arc:       return "arc";
    case SketchTool::Dimension: return "dimension";
  }
  return "select";
}

std::vector<SketchTool> allSketchTools() {
  std::vector<SketchTool> out;
  out.reserve(kSketchToolCount);
  for (std::size_t i = 0; i < kSketchToolCount; ++i) out.push_back(static_cast<SketchTool>(i));
  return out;
}

bool sketchToolFromString(const std::string& name, SketchTool& out) noexcept {
  for (SketchTool t : allSketchTools()) {
    if (name == toString(t)) { out = t; return true; }
  }
  return false;
}

std::size_t sketchToolPickCount(SketchTool tool) noexcept {
  switch (tool) {
    case SketchTool::Point:     return 1;
    case SketchTool::Line:      return 2;
    case SketchTool::Rectangle: return 2;
    case SketchTool::Circle:    return 2;
    case SketchTool::Arc:       return 3;
    case SketchTool::Select:
    case SketchTool::Polyline:
    case SketchTool::Dimension: return 0;  // dynamic; see the header
  }
  return 0;
}

// ── intents ─────────────────────────────────────────────────────────────────
const char* toString(SketchIntentKind kind) noexcept {
  switch (kind) {
    case SketchIntentKind::None:                return "none";
    case SketchIntentKind::Enter:               return "enter";
    case SketchIntentKind::Exit:                return "exit";
    case SketchIntentKind::SetTool:             return "set_tool";
    case SketchIntentKind::PointerMove:         return "pointer_move";
    case SketchIntentKind::PointerDown:         return "pointer_down";
    case SketchIntentKind::PointerUp:           return "pointer_up";
    case SketchIntentKind::Cancel:              return "cancel";
    case SketchIntentKind::Complete:            return "complete";
    case SketchIntentKind::Backtrack:           return "backtrack";
    case SketchIntentKind::ToggleConstruction:  return "toggle_construction";
    case SketchIntentKind::ApplyConstraint:     return "apply_constraint";
    case SketchIntentKind::DeleteConstraint:    return "delete_constraint";
    case SketchIntentKind::DeleteSelection:     return "delete_selection";
    case SketchIntentKind::SetConstraintValue:  return "set_constraint_value";
    case SketchIntentKind::SetConstraintDriving:return "set_constraint_driving";
    case SketchIntentKind::SelectEntity:        return "select_entity";
    case SketchIntentKind::SelectPoint:         return "select_point";
    case SketchIntentKind::SelectConstraint:    return "select_constraint";
    case SketchIntentKind::ClearSelection:      return "clear_selection";
    case SketchIntentKind::SetSnap:             return "set_snap";
    case SketchIntentKind::SetGridSpacing:      return "set_grid_spacing";
    case SketchIntentKind::SetGridVisible:      return "set_grid_visible";
    case SketchIntentKind::SetPickRadius:       return "set_pick_radius";
    case SketchIntentKind::SetAutoConstrain:    return "set_auto_constrain";
  }
  return "none";
}

SketchIntent SketchIntent::enter(const SketchPlane& p, bool reopen) {
  SketchIntent i;
  i.kind = SketchIntentKind::Enter;
  i.plane = p;
  i.flag = reopen;
  return i;
}
SketchIntent SketchIntent::exit(bool keep) {
  SketchIntent i;
  i.kind = SketchIntentKind::Exit;
  i.flag = keep;
  return i;
}
SketchIntent SketchIntent::setTool(SketchTool t) {
  SketchIntent i;
  i.kind = SketchIntentKind::SetTool;
  i.intA = static_cast<int>(t);
  return i;
}
SketchIntent SketchIntent::move(double x, double y) {
  SketchIntent i;
  i.kind = SketchIntentKind::PointerMove;
  i.x = x; i.y = y;
  return i;
}
SketchIntent SketchIntent::down(double x, double y, bool additive) {
  SketchIntent i;
  i.kind = SketchIntentKind::PointerDown;
  i.x = x; i.y = y; i.flag = additive;
  return i;
}
SketchIntent SketchIntent::up(double x, double y) {
  SketchIntent i;
  i.kind = SketchIntentKind::PointerUp;
  i.x = x; i.y = y;
  return i;
}
SketchIntent SketchIntent::cancel() {
  SketchIntent i;
  i.kind = SketchIntentKind::Cancel;
  return i;
}
SketchIntent SketchIntent::complete() {
  SketchIntent i;
  i.kind = SketchIntentKind::Complete;
  return i;
}
SketchIntent SketchIntent::backtrack() {
  SketchIntent i;
  i.kind = SketchIntentKind::Backtrack;
  return i;
}
SketchIntent SketchIntent::apply(SketchConstraintKind kind) {
  SketchIntent i;
  i.kind = SketchIntentKind::ApplyConstraint;
  i.intA = static_cast<int>(kind);
  return i;
}
SketchIntent SketchIntent::deleteConstraint(int id) {
  SketchIntent i;
  i.kind = SketchIntentKind::DeleteConstraint;
  i.intA = id;
  return i;
}
SketchIntent SketchIntent::selectEntity(int id, bool additive) {
  SketchIntent i;
  i.kind = SketchIntentKind::SelectEntity;
  i.intA = id; i.flag = additive;
  return i;
}
SketchIntent SketchIntent::selectPoint(int entity, SketchPointRole role, bool additive) {
  SketchIntent i;
  i.kind = SketchIntentKind::SelectPoint;
  i.intA = entity; i.intB = static_cast<int>(role); i.flag = additive;
  return i;
}
SketchIntent SketchIntent::selectConstraint(int id, bool additive) {
  SketchIntent i;
  i.kind = SketchIntentKind::SelectConstraint;
  i.intA = id; i.flag = additive;
  return i;
}
SketchIntent SketchIntent::setConstraintValue(int id, double value) {
  SketchIntent i;
  i.kind = SketchIntentKind::SetConstraintValue;
  i.intA = id; i.value = value;
  return i;
}
SketchIntent SketchIntent::setSnap(SnapKind kind, bool on) {
  SketchIntent i;
  i.kind = SketchIntentKind::SetSnap;
  i.intA = static_cast<int>(kind); i.flag = on;
  return i;
}
SketchIntent SketchIntent::setAutoConstrain(bool on) {
  SketchIntent i;
  i.kind = SketchIntentKind::SetAutoConstrain;
  i.flag = on;
  return i;
}

std::string SketchIntent::describe() const {
  std::string s = toString(kind);
  switch (kind) {
    case SketchIntentKind::Enter:
      return s + " " + toString(plane.kind) + (flag ? " (reopen)" : " (new)");
    case SketchIntentKind::Exit:
      return s + (flag ? " keep" : " discard");
    case SketchIntentKind::SetTool:
      return s + " " + toString(static_cast<SketchTool>(intA));
    case SketchIntentKind::PointerMove:
    case SketchIntentKind::PointerDown:
    case SketchIntentKind::PointerUp:
      return s + " " + num(x) + "," + num(y);
    case SketchIntentKind::ApplyConstraint:
      return s + " " + toString(static_cast<SketchConstraintKind>(intA));
    case SketchIntentKind::SetSnap:
      return s + " " + toString(static_cast<SnapKind>(intA)) + (flag ? " on" : " off");
    case SketchIntentKind::DeleteConstraint:
    case SketchIntentKind::SelectEntity:
    case SketchIntentKind::SelectConstraint:
      return s + " " + std::to_string(intA);
    case SketchIntentKind::SelectPoint:
      return s + " " + std::to_string(intA) + "." +
             toString(static_cast<SketchPointRole>(intB));
    case SketchIntentKind::SetConstraintValue:
      return s + " " + std::to_string(intA) + " = " + num(value);
    case SketchIntentKind::SetGridSpacing:
    case SketchIntentKind::SetPickRadius:
      return s + " " + num(value);
    default:
      return s;
  }
}

// ── the session ─────────────────────────────────────────────────────────────
SketchSession::SketchSession(const SketchSolver& solver) : solver_(&solver) {}

void SketchSession::setSolver(const SketchSolver& solver) {
  solver_ = &solver;
  dofDirty_ = true;
}

void SketchSession::setDriver(SketchSolveDriver* driver) noexcept { driver_ = driver; }

void SketchSession::attachSelection(SelectionService* selection, const std::string& bodyId) {
  selectionService_ = selection;
  selectionBodyId_ = bodyId;
}

// ── the walk ────────────────────────────────────────────────────────────────
void SketchSession::beginWalk() noexcept {
  if (walkDepth_ == 0) walkFingerprint_ = fingerprint();
  ++walkDepth_;
}

void SketchSession::endWalk() {
  if (walkDepth_ == 0) return;
  --walkDepth_;
  if (walkDepth_ != 0) return;
  // THE SECOND INSTRUMENT. The counter below catches a mutation that came
  // through flush(); this catches one that arrived by any path at all, including
  // one nobody anticipated. Checked BEFORE the drain, because the drain is
  // supposed to move it.
  if (fingerprint() != walkFingerprint_) ++mutationsDuringWalk_;
  flush();
}

void SketchSession::post(const SketchIntent& intent) {
  if (intent.kind == SketchIntentKind::None) return;
  pending_.push_back(intent);
}

std::size_t SketchSession::flush() {
  if (walkDepth_ != 0) {
    // THE SAFETY NET, and the same shape as ForgeFrame's: a caller inside the
    // walk gets its work deferred rather than a container mutated under an
    // iterator, and the violation is COUNTED so a gate can see the sloppy call
    // site the net just caught.
    ++mutationsDuringWalk_;
    return 0;
  }
  std::size_t n = 0;
  // Index-walked, not iterator-walked: applying an intent may post another
  // (nothing does today, and a range-for over a vector that grows is undefined
  // behaviour, so the loop is written to survive it rather than to assume it).
  for (std::size_t i = 0; i < pending_.size(); ++i) {
    const SketchIntent intent = pending_[i];
    if (applyOne(intent)) ++n;
  }
  pending_.clear();
  applied_ += n;
  return n;
}

std::size_t SketchSession::fingerprint() const noexcept {
  std::size_t h = 14695981039346656037ULL;
  mix(h, active_ ? 1u : 0u);
  mix(h, static_cast<std::uint64_t>(tool_));
  mix(h, construction_ ? 1u : 0u);
  mix(h, autoConstrain_ ? 1u : 0u);
  mixDouble(h, snap_.gridSpacing);
  mixDouble(h, snap_.pickRadius);
  for (std::size_t i = 0; i < kSnapKindCount; ++i) mix(h, snap_.enabled[i] ? 1u : 0u);
  mixDouble(h, cursorX_);
  mixDouble(h, cursorY_);
  mix(h, picks_.size());
  for (const SketchEntity& e : scene_.entities()) {
    mix(h, static_cast<std::uint64_t>(e.id));
    mix(h, static_cast<std::uint64_t>(e.kind));
    mix(h, e.construction ? 1u : 0u);
    for (std::size_t i = 0; i < 5; ++i) mixDouble(h, e.v[i]);
  }
  for (const SketchConstraint& c : scene_.constraints()) {
    mix(h, static_cast<std::uint64_t>(c.id));
    mix(h, static_cast<std::uint64_t>(c.kind));
    mix(h, static_cast<std::uint64_t>(c.entityA));
    mix(h, static_cast<std::uint64_t>(c.entityB));
    mix(h, static_cast<std::uint64_t>(c.entityC));
    mix(h, static_cast<std::uint64_t>(c.pointA.entity));
    mix(h, static_cast<std::uint64_t>(c.pointA.role));
    mix(h, static_cast<std::uint64_t>(c.pointB.entity));
    mix(h, static_cast<std::uint64_t>(c.pointB.role));
    mix(h, c.driving ? 1u : 0u);
    mixDouble(h, c.value);
  }
  for (int id : selEntities_) mix(h, static_cast<std::uint64_t>(id));
  for (const SketchPointId& p : selPoints_) {
    mix(h, static_cast<std::uint64_t>(p.entity));
    mix(h, static_cast<std::uint64_t>(p.role));
  }
  for (int id : selConstraints_) mix(h, static_cast<std::uint64_t>(id));
  return h;
}

void SketchSession::touchScene() noexcept { dofDirty_ = true; }

void SketchSession::note(const std::string& line) { journal_.push_back(line); }

void SketchSession::resetGesture() noexcept { picks_.clear(); }

void SketchSession::resolveWithDriver() {
  if (driver_ == nullptr) {
    solveDetail_ = "no solver driver installed: the constraint is recorded, the geometry has "
                   "not been moved to satisfy it";
    return;
  }
  std::string detail;
  if (driver_->solve(scene_, detail)) {
    solveDetail_ = detail.empty() ? "solved" : detail;
  } else {
    solveDetail_ = detail.empty() ? "the solver could not satisfy the constraints" : detail;
  }
  touchScene();
}

void SketchSession::syncSelectionService() {
  if (selectionService_ == nullptr) return;
  std::vector<EntityRef> refs;
  refs.reserve(selEntities_.size());
  for (int id : selEntities_) {
    EntityRef r;
    r.bodyId = selectionBodyId_;
    r.kind = EntityKind::SketchCurve;
    r.persistentName = "e" + std::to_string(id);
    refs.push_back(std::move(r));
  }
  selectionService_->replaceWith(refs);
}

// ── the one mutator ─────────────────────────────────────────────────────────
bool SketchSession::applyOne(const SketchIntent& intent) {
  if (walkDepth_ != 0) {
    // Unreachable by construction -- flush() is the only caller and it refuses
    // during the walk -- and counted anyway, because "unreachable by
    // construction" is a claim and this is the measurement of it.
    ++mutationsDuringWalk_;
    return false;
  }
  refusal_.clear();

  switch (intent.kind) {
    case SketchIntentKind::None:
      return false;

    case SketchIntentKind::Enter: {
      if (!intent.plane.orthonormal(1.0e-6)) {
        refusal_ = "the sketch plane's axes are not orthonormal, so every sketch coordinate "
                   "would land somewhere else in the model";
        note("enter REFUSED: " + refusal_);
        return false;
      }
      plane_ = intent.plane;
      if (!intent.flag) scene_.clear();
      entrySnapshot_ = scene_;
      active_ = true;
      resetGesture();
      selEntities_.clear();
      selPoints_.clear();
      selConstraints_.clear();
      touchScene();
      note(intent.describe());
      return true;
    }

    case SketchIntentKind::Exit: {
      if (!active_) {
        refusal_ = "not in sketch mode";
        return false;
      }
      if (!intent.flag) scene_ = entrySnapshot_;
      active_ = false;
      resetGesture();
      touchScene();
      note(intent.describe());
      return true;
    }

    case SketchIntentKind::SetTool: {
      if (intent.intA < 0 || static_cast<std::size_t>(intent.intA) >= kSketchToolCount) {
        refusal_ = "no such sketch tool: " + std::to_string(intent.intA);
        return false;
      }
      tool_ = static_cast<SketchTool>(intent.intA);
      resetGesture();
      note(intent.describe());
      return true;
    }

    case SketchIntentKind::PointerMove:
      cursorX_ = intent.x;
      cursorY_ = intent.y;
      return true;

    case SketchIntentKind::PointerDown:
      if (!active_) { refusal_ = "not in sketch mode"; return false; }
      applyPointerDown(intent.x, intent.y, intent.flag);
      return true;

    case SketchIntentKind::PointerUp:
      cursorX_ = intent.x;
      cursorY_ = intent.y;
      return true;

    case SketchIntentKind::Cancel:
      if (picks_.empty()) {
        selEntities_.clear();
        selPoints_.clear();
        selConstraints_.clear();
        syncSelectionService();
      } else {
        resetGesture();
      }
      note("cancel");
      return true;

    case SketchIntentKind::Complete:
      if (tool_ == SketchTool::Polyline || tool_ == SketchTool::Dimension) {
        resetGesture();
        note("complete");
        return true;
      }
      resetGesture();
      note("complete");
      return true;

    case SketchIntentKind::Backtrack:
      if (picks_.empty()) return false;
      picks_.pop_back();
      note("backtrack");
      return true;

    case SketchIntentKind::ToggleConstruction: {
      construction_ = !construction_;
      for (int id : selEntities_) {
        if (SketchEntity* e = scene_.mutableEntity(id)) e->construction = !e->construction;
      }
      touchScene();
      note(std::string("toggle_construction -> ") + (construction_ ? "on" : "off"));
      return true;
    }

    case SketchIntentKind::ApplyConstraint: {
      if (intent.intA < 0 ||
          static_cast<std::size_t>(intent.intA) >= kSketchConstraintKindCount) {
        refusal_ = "no such constraint kind: " + std::to_string(intent.intA);
        return false;
      }
      applyConstraintKind(static_cast<SketchConstraintKind>(intent.intA));
      return refusal_.empty();
    }

    case SketchIntentKind::DeleteConstraint: {
      if (!scene_.removeConstraint(intent.intA)) {
        refusal_ = "constraint " + std::to_string(intent.intA) + " does not exist";
        return false;
      }
      selConstraints_.erase(
          std::remove(selConstraints_.begin(), selConstraints_.end(), intent.intA),
          selConstraints_.end());
      touchScene();
      resolveWithDriver();
      note(intent.describe());
      return true;
    }

    case SketchIntentKind::DeleteSelection: {
      std::size_t constraints = 0;
      for (int id : selConstraints_) {
        if (scene_.removeConstraint(id)) ++constraints;
      }
      std::size_t entities = 0;
      for (int id : selEntities_) {
        std::size_t withIt = 0;
        if (scene_.removeEntity(id, &withIt)) {
          ++entities;
          constraints += withIt;
        }
      }
      selEntities_.clear();
      selPoints_.clear();
      selConstraints_.clear();
      syncSelectionService();
      touchScene();
      note("delete_selection: " + std::to_string(entities) + " entities, " +
           std::to_string(constraints) + " constraints");
      return entities + constraints > 0;
    }

    case SketchIntentKind::SetConstraintValue: {
      SketchConstraint* c = scene_.mutableConstraint(intent.intA);
      if (c == nullptr) {
        refusal_ = "constraint " + std::to_string(intent.intA) + " does not exist";
        return false;
      }
      if (!isSketchDimension(c->kind)) {
        refusal_ = std::string(toString(c->kind)) + " carries no value to set";
        return false;
      }
      c->value = intent.value;
      touchScene();
      resolveWithDriver();
      note(intent.describe());
      return true;
    }

    case SketchIntentKind::SetConstraintDriving: {
      SketchConstraint* c = scene_.mutableConstraint(intent.intA);
      if (c == nullptr) {
        refusal_ = "constraint " + std::to_string(intent.intA) + " does not exist";
        return false;
      }
      c->driving = intent.flag;
      touchScene();
      note(std::string("set_constraint_driving ") + std::to_string(intent.intA) +
           (intent.flag ? " driving" : " reference"));
      return true;
    }

    case SketchIntentKind::SelectEntity: {
      if (scene_.entity(intent.intA) == nullptr) {
        refusal_ = "entity " + std::to_string(intent.intA) + " does not exist";
        return false;
      }
      toggleInto(selEntities_, intent.intA, intent.flag);
      syncSelectionService();
      note(intent.describe());
      return true;
    }

    case SketchIntentKind::SelectPoint: {
      SketchPointId p{intent.intA, static_cast<SketchPointRole>(intent.intB)};
      double px = 0.0, py = 0.0;
      if (!scene_.pointPosition(p, px, py)) {
        refusal_ = "entity " + std::to_string(intent.intA) + " has no " +
                   toString(p.role) + " point";
        return false;
      }
      toggleInto(selPoints_, p, intent.flag);
      note(intent.describe());
      return true;
    }

    case SketchIntentKind::SelectConstraint: {
      if (scene_.constraint(intent.intA) == nullptr) {
        refusal_ = "constraint " + std::to_string(intent.intA) + " does not exist";
        return false;
      }
      toggleInto(selConstraints_, intent.intA, intent.flag);
      note(intent.describe());
      return true;
    }

    case SketchIntentKind::ClearSelection:
      selEntities_.clear();
      selPoints_.clear();
      selConstraints_.clear();
      syncSelectionService();
      note("clear_selection");
      return true;

    case SketchIntentKind::SetSnap: {
      if (intent.intA < 0 || static_cast<std::size_t>(intent.intA) >= kSnapKindCount) {
        refusal_ = "no such snap kind: " + std::to_string(intent.intA);
        return false;
      }
      snap_.setOn(static_cast<SnapKind>(intent.intA), intent.flag);
      note(intent.describe());
      return true;
    }

    case SketchIntentKind::SetGridSpacing:
      if (!(intent.value > 0.0)) {
        refusal_ = "a grid spacing of " + num(intent.value) + " is not positive";
        return false;
      }
      snap_.gridSpacing = intent.value;
      note(intent.describe());
      return true;

    case SketchIntentKind::SetGridVisible:
      snap_.gridVisible = intent.flag;
      note(intent.describe());
      return true;

    case SketchIntentKind::SetPickRadius:
      if (!(intent.value > 0.0)) {
        refusal_ = "a pick radius of " + num(intent.value) + " is not positive";
        return false;
      }
      snap_.pickRadius = intent.value;
      note(intent.describe());
      return true;

    case SketchIntentKind::SetAutoConstrain:
      autoConstrain_ = intent.flag;
      note(intent.describe());
      return true;
  }
  return false;
}

// ── picking ─────────────────────────────────────────────────────────────────
void SketchSession::selectAt(double x, double y, bool additive) {
  // Characteristic points beat entity bodies: clicking a line's end must select
  // the END, because that is what a coincidence or a dimension is applied to.
  SnapSettings points = snap_;
  points.setOn(SnapKind::Grid, false);
  points.setOn(SnapKind::OnEntity, false);
  points.setOn(SnapKind::Intersection, false);
  points.setOn(SnapKind::Quadrant, false);
  const SnapResult s = snapCursor(scene_, points, x, y);
  if (s.hit() && s.point.valid()) {
    toggleInto(selPoints_, s.point, additive);
    note("select point " + s.point.key());
    return;
  }
  const int id = hitTestEntity(scene_, x, y, snap_.pickRadius);
  if (id != 0) {
    toggleInto(selEntities_, id, additive);
    syncSelectionService();
    note("select entity " + std::to_string(id));
    return;
  }
  if (!additive) {
    selEntities_.clear();
    selPoints_.clear();
    selConstraints_.clear();
    syncSelectionService();
    note("select nothing");
  }
}

void SketchSession::applyPointerDown(double x, double y, bool additive) {
  cursorX_ = x;
  cursorY_ = y;
  if (tool_ == SketchTool::Select) {
    selectAt(x, y, additive);
    return;
  }
  picks_.push_back(snapCursor(scene_, snap_, x, y));

  if (tool_ == SketchTool::Dimension) {
    commitDimension();
    return;
  }
  if (tool_ == SketchTool::Polyline) {
    if (picks_.size() >= 2) commitPicks();
    return;
  }
  const std::size_t want = sketchToolPickCount(tool_);
  if (want != 0 && picks_.size() >= want) commitPicks();
}

// ── committing geometry ─────────────────────────────────────────────────────
void SketchSession::commitPicks() {
  std::vector<SketchEntity> shapes;
  std::vector<std::pair<std::size_t, SketchPointRole>> bindShape;  // into `shapes`
  std::vector<std::size_t> bindPick;
  std::vector<std::pair<std::size_t, std::size_t>> chainCoincident;  // shape i end -> shape j start

  const auto px = [this](std::size_t i) { return picks_[i].x; };
  const auto py = [this](std::size_t i) { return picks_[i].y; };

  switch (tool_) {
    case SketchTool::Point:
      shapes.push_back(makeSketchPoint(px(0), py(0)));
      bindShape.push_back({0, SketchPointRole::Start});
      bindPick.push_back(0);
      break;

    case SketchTool::Line:
    case SketchTool::Polyline: {
      const std::size_t a = picks_.size() - 2, b = picks_.size() - 1;
      if (std::hypot(px(b) - px(a), py(b) - py(a)) < 1.0e-9) {
        refusal_ = "a line of zero length: the two picks landed on the same point";
        note("commit REFUSED: " + refusal_);
        if (tool_ == SketchTool::Polyline) picks_.pop_back();
        else resetGesture();
        return;
      }
      shapes.push_back(makeSketchLine(px(a), py(a), px(b), py(b)));
      bindShape.push_back({0, SketchPointRole::Start});
      bindPick.push_back(a);
      bindShape.push_back({0, SketchPointRole::End});
      bindPick.push_back(b);
      break;
    }

    case SketchTool::Rectangle: {
      const double x0 = px(0), y0 = py(0), x1 = px(1), y1 = py(1);
      if (std::fabs(x1 - x0) < 1.0e-9 || std::fabs(y1 - y0) < 1.0e-9) {
        refusal_ = "a rectangle with a zero side: the two corners share an axis";
        note("commit REFUSED: " + refusal_);
        resetGesture();
        return;
      }
      shapes.push_back(makeSketchLine(x0, y0, x1, y0));
      shapes.push_back(makeSketchLine(x1, y0, x1, y1));
      shapes.push_back(makeSketchLine(x1, y1, x0, y1));
      shapes.push_back(makeSketchLine(x0, y1, x0, y0));
      for (std::size_t i = 0; i < 4; ++i) chainCoincident.push_back({i, (i + 1) % 4});
      bindShape.push_back({0, SketchPointRole::Start});
      bindPick.push_back(0);
      bindShape.push_back({1, SketchPointRole::End});
      bindPick.push_back(1);
      break;
    }

    case SketchTool::Circle: {
      const double r = std::hypot(px(1) - px(0), py(1) - py(0));
      if (!(r > 1.0e-9)) {
        refusal_ = "a circle of zero radius: the rim pick landed on the centre";
        note("commit REFUSED: " + refusal_);
        resetGesture();
        return;
      }
      shapes.push_back(makeSketchCircle(px(0), py(0), r));
      bindShape.push_back({0, SketchPointRole::Centre});
      bindPick.push_back(0);
      break;
    }

    case SketchTool::Arc: {
      const double r = std::hypot(px(1) - px(0), py(1) - py(0));
      if (!(r > 1.0e-9)) {
        refusal_ = "an arc of zero radius: the start pick landed on the centre";
        note("commit REFUSED: " + refusal_);
        resetGesture();
        return;
      }
      const double a0 = std::atan2(py(1) - py(0), px(1) - px(0));
      const double a1 = std::atan2(py(2) - py(0), px(2) - px(0));
      if (std::fabs(a1 - a0) < 1.0e-9) {
        refusal_ = "an arc of zero sweep: the end pick is on the same ray as the start";
        note("commit REFUSED: " + refusal_);
        resetGesture();
        return;
      }
      shapes.push_back(makeSketchArc(px(0), py(0), r, a0, a1));
      bindShape.push_back({0, SketchPointRole::Centre});
      bindPick.push_back(0);
      bindShape.push_back({0, SketchPointRole::Start});
      bindPick.push_back(1);
      bindShape.push_back({0, SketchPointRole::End});
      bindPick.push_back(2);
      break;
    }

    case SketchTool::Select:
    case SketchTool::Dimension:
      return;
  }

  std::vector<int> ids;
  ids.reserve(shapes.size());
  for (SketchEntity& e : shapes) {
    e.construction = construction_;
    const int id = scene_.add(e);
    if (id == 0) {
      refusal_ = "the sketch refused a degenerate " + std::string(toString(e.kind));
      note("commit REFUSED: " + refusal_);
      for (int done : ids) scene_.removeEntity(done);  // no partial geometry
      resetGesture();
      return;
    }
    ids.push_back(id);
  }

  std::vector<SketchPickBinding> bindings;
  for (std::size_t i = 0; i < bindShape.size() && i < bindPick.size(); ++i) {
    const std::size_t shape = bindShape[i].first;
    if (shape >= ids.size()) continue;
    SketchPickBinding b;
    b.point = SketchPointId{ids[shape], bindShape[i].second};
    b.snap = picks_[bindPick[i]];
    // THE BINDING MUST BE TRUE. An arc's end lands on the ray through the third
    // pick but at the arc's RADIUS, not at the pick itself, so binding it
    // unconditionally would assert a coincidence with geometry the point is not
    // actually on. Verify, then bind.
    double bx = 0.0, by = 0.0;
    if (!scene_.pointPosition(b.point, bx, by)) continue;
    const double scale = 1.0 + std::max(std::fabs(bx), std::fabs(by));
    if (std::hypot(bx - b.snap.x, by - b.snap.y) > 1.0e-7 * scale) continue;
    bindings.push_back(b);
  }

  std::vector<SketchConstraint> structural;
  for (const std::pair<std::size_t, std::size_t>& link : chainCoincident) {
    if (link.first >= ids.size() || link.second >= ids.size()) continue;
    SketchConstraint c;
    c.kind = SketchConstraintKind::Coincident;
    c.pointA = SketchPointId{ids[link.first], SketchPointRole::End};
    c.pointB = SketchPointId{ids[link.second], SketchPointRole::Start};
    structural.push_back(c);
  }
  // A polyline's new segment starts where the previous one ended. That is the
  // tool's own construction, not an inference, so it is applied whether or not
  // auto-constrain is on -- a chain that comes apart when you drag it was never
  // a chain.
  if (tool_ == SketchTool::Polyline && !ids.empty() && scene_.entityCount() >= 2) {
    for (std::size_t i = scene_.entities().size(); i > 0; --i) {
      const SketchEntity& prev = scene_.entities()[i - 1];
      if (prev.id == ids.front() || prev.kind != SketchEntityKind::Line) continue;
      double ex = 0.0, ey = 0.0, sx = 0.0, sy = 0.0;
      prev.point(SketchPointRole::End, ex, ey);
      scene_.pointPosition(SketchPointId{ids.front(), SketchPointRole::Start}, sx, sy);
      if (std::hypot(ex - sx, ey - sy) <= 1.0e-9) {
        SketchConstraint c;
        c.kind = SketchConstraintKind::Coincident;
        c.pointA = SketchPointId{prev.id, SketchPointRole::End};
        c.pointB = SketchPointId{ids.front(), SketchPointRole::Start};
        structural.push_back(c);
      }
      break;
    }
  }

  finishEntities(ids, bindings, structural);

  if (tool_ == SketchTool::Polyline) {
    // The chain continues from the point just placed.
    const SnapResult last = picks_.back();
    picks_.clear();
    picks_.push_back(last);
  } else {
    resetGesture();
  }
}

void SketchSession::finishEntities(const std::vector<int>& newIds,
                                   const std::vector<SketchPickBinding>& bindings,
                                   const std::vector<SketchConstraint>& structural) {
  std::vector<ConstraintProposal> offered;
  for (const SketchConstraint& c : structural) {
    ConstraintProposal p;
    p.constraint = c;
    p.constraint.inferred = false;  // the tool's own construction, not a guess
    p.confidence = 1.0;
    p.reason = std::string(toString(tool_)) + " tool construction";
    offered.push_back(std::move(p));
  }
  if (autoConstrain_) {
    for (int id : newIds) {
      std::vector<SketchPickBinding> mine;
      for (const SketchPickBinding& b : bindings) {
        if (b.point.entity == id) mine.push_back(b);
      }
      const std::vector<ConstraintProposal> more =
          inferConstraints(scene_, id, mine, inference_);
      offered.insert(offered.end(), more.begin(), more.end());
    }
  }

  const std::vector<ConstraintProposal> kept =
      solver_ != nullptr ? retainIndependent(*solver_, scene_, offered) : offered;
  std::size_t added = 0;
  for (const ConstraintProposal& p : kept) {
    std::string why;
    if (scene_.addConstraint(p.constraint, &why) != 0) ++added;
  }
  autoApplied_ += added;
  autoDeclined_ += offered.size() - added;

  touchScene();
  std::string line = std::string(toString(tool_)) + ": " + std::to_string(newIds.size()) +
                     " entities, " + std::to_string(added) + " of " +
                     std::to_string(offered.size()) + " offered constraints applied";
  note(line);
}

// ── dimensions ──────────────────────────────────────────────────────────────
void SketchSession::commitDimension() {
  const SnapResult& first = picks_.front();

  const auto emit = [this](SketchConstraint c, const char* prefix) {
    std::string why;
    const int id = scene_.addConstraint(c, &why);
    if (id == 0) {
      refusal_ = why;
      note("dimension REFUSED: " + why);
      resetGesture();
      return;
    }
    if (SketchConstraint* live = scene_.mutableConstraint(id))
      live->label = std::string(prefix) + std::to_string(id);
    touchScene();
    resolveWithDriver();
    note(std::string("dimension ") + toString(c.kind) + " = " + num(c.value));
    resetGesture();
  };

  if (picks_.size() == 1) {
    const SketchEntity* e = first.entityA != 0 ? scene_.entity(first.entityA) : nullptr;
    if (e == nullptr && first.point.valid()) e = scene_.entity(first.point.entity);
    if (e != nullptr && isCircular(e->kind) && first.kind != SnapKind::Endpoint) {
      SketchConstraint c;
      c.kind = SketchConstraintKind::Radius;
      c.entityA = e->id;
      c.value = e->v[2];
      emit(c, "R");
      return;
    }
    if (e != nullptr && e->kind == SketchEntityKind::Line && first.kind == SnapKind::OnEntity) {
      SketchConstraint c;
      c.kind = SketchConstraintKind::Distance;
      c.pointA = SketchPointId{e->id, SketchPointRole::Start};
      c.pointB = SketchPointId{e->id, SketchPointRole::End};
      c.value = e->length();
      emit(c, "d");
      return;
    }
    return;  // wait for a second pick
  }

  const SnapResult& second = picks_[1];
  if (first.point.valid() && second.point.valid() && first.point != second.point) {
    double ax = 0.0, ay = 0.0, bx = 0.0, by = 0.0;
    scene_.pointPosition(first.point, ax, ay);
    scene_.pointPosition(second.point, bx, by);
    SketchConstraint c;
    c.kind = SketchConstraintKind::Distance;
    c.pointA = first.point;
    c.pointB = second.point;
    c.value = std::hypot(bx - ax, by - ay);
    emit(c, "d");
    return;
  }
  const SketchEntity* la = scene_.entity(first.entityA);
  const SketchEntity* lb = scene_.entity(second.entityA);
  if (la != nullptr && lb != nullptr && la->id != lb->id &&
      la->kind == SketchEntityKind::Line && lb->kind == SketchEntityKind::Line) {
    const double ua = std::atan2(la->v[3] - la->v[1], la->v[2] - la->v[0]);
    const double ub = std::atan2(lb->v[3] - lb->v[1], lb->v[2] - lb->v[0]);
    SketchConstraint c;
    c.kind = SketchConstraintKind::Angle;
    c.entityA = la->id;
    c.entityB = lb->id;
    c.value = (ub - ua) * kDegPerRad;
    while (c.value > 180.0) c.value -= 360.0;
    while (c.value <= -180.0) c.value += 360.0;
    emit(c, "A");
    return;
  }
  refusal_ = "a dimension needs two points, one circle, one line, or two lines -- got " +
             first.describe() + " and " + second.describe();
  note("dimension REFUSED: " + refusal_);
  resetGesture();
}

// ── the constraint palette ──────────────────────────────────────────────────
bool SketchSession::constraintFromSelection(SketchConstraintKind kind, SketchConstraint& out,
                                            std::string& why) const {
  why.clear();
  SketchConstraint c;
  c.kind = kind;

  const std::size_t nEnt = selEntities_.size();
  const std::size_t nPt = selPoints_.size();
  const auto ent = [this](std::size_t i) { return scene_.entity(selEntities_[i]); };
  const auto needEntities = [&](std::size_t n) {
    if (nEnt == n) return true;
    why = "select " + std::to_string(n) + " entit" + (n == 1 ? "y" : "ies") + "; " +
          std::to_string(nEnt) + " selected";
    return false;
  };
  const auto needPoints = [&](std::size_t n) {
    if (nPt == n) return true;
    why = "select " + std::to_string(n) + " point" + (n == 1 ? "" : "s") + "; " +
          std::to_string(nPt) + " selected";
    return false;
  };
  const auto pointXY = [this](const SketchPointId& p, double& x, double& y) {
    return scene_.pointPosition(p, x, y);
  };

  switch (kind) {
    case SketchConstraintKind::Horizontal:
    case SketchConstraintKind::Vertical:
      if (!needEntities(1)) return false;
      c.entityA = selEntities_[0];
      break;

    case SketchConstraintKind::Fix:
      if (!needEntities(1)) return false;
      c.entityA = selEntities_[0];
      break;

    case SketchConstraintKind::Parallel:
    case SketchConstraintKind::Perpendicular:
    case SketchConstraintKind::Equal:
    case SketchConstraintKind::Concentric:
      if (!needEntities(2)) return false;
      c.entityA = selEntities_[0];
      c.entityB = selEntities_[1];
      break;

    case SketchConstraintKind::Angle: {
      if (!needEntities(2)) return false;
      c.entityA = selEntities_[0];
      c.entityB = selEntities_[1];
      const SketchEntity* a = ent(0);
      const SketchEntity* b = ent(1);
      if (a != nullptr && b != nullptr && a->kind == SketchEntityKind::Line &&
          b->kind == SketchEntityKind::Line) {
        const double ua = std::atan2(a->v[3] - a->v[1], a->v[2] - a->v[0]);
        const double ub = std::atan2(b->v[3] - b->v[1], b->v[2] - b->v[0]);
        c.value = (ub - ua) * kDegPerRad;
        while (c.value > 180.0) c.value -= 360.0;
        while (c.value <= -180.0) c.value += 360.0;
      }
      break;
    }

    case SketchConstraintKind::Tangent: {
      if (!needEntities(2)) return false;
      const SketchEntity* a = ent(0);
      const SketchEntity* b = ent(1);
      if (a == nullptr || b == nullptr) { why = "a selected entity vanished"; return false; }
      // The circular one must be second; the user should not have to select in a
      // particular order to get a tangency.
      if (isCircular(b->kind)) { c.entityA = a->id; c.entityB = b->id; }
      else if (isCircular(a->kind)) { c.entityA = b->id; c.entityB = a->id; }
      else { why = "tangent needs a circle or an arc; neither selection is one"; return false; }
      break;
    }

    case SketchConstraintKind::Radius:
    case SketchConstraintKind::Diameter: {
      if (!needEntities(1)) return false;
      const SketchEntity* a = ent(0);
      if (a == nullptr) { why = "the selected entity vanished"; return false; }
      c.entityA = a->id;
      c.value = kind == SketchConstraintKind::Radius ? a->v[2] : 2.0 * a->v[2];
      break;
    }

    case SketchConstraintKind::Coincident:
      if (!needPoints(2)) return false;
      c.pointA = selPoints_[0];
      c.pointB = selPoints_[1];
      break;

    case SketchConstraintKind::Distance:
    case SketchConstraintKind::HorizontalDistance:
    case SketchConstraintKind::VerticalDistance: {
      if (nPt == 2) {
        c.pointA = selPoints_[0];
        c.pointB = selPoints_[1];
      } else if (nPt == 0 && nEnt == 1 && ent(0) != nullptr &&
                 ent(0)->kind == SketchEntityKind::Line) {
        // One line selected means its LENGTH, which is the dimension a user
        // reaches for far more often than "select both ends first".
        c.pointA = SketchPointId{selEntities_[0], SketchPointRole::Start};
        c.pointB = SketchPointId{selEntities_[0], SketchPointRole::End};
      } else {
        why = "select two points, or one line for its length; " + std::to_string(nPt) +
              " points and " + std::to_string(nEnt) + " entities selected";
        return false;
      }
      double ax = 0.0, ay = 0.0, bx = 0.0, by = 0.0;
      if (pointXY(c.pointA, ax, ay) && pointXY(c.pointB, bx, by)) {
        if (kind == SketchConstraintKind::Distance) c.value = std::hypot(bx - ax, by - ay);
        else if (kind == SketchConstraintKind::HorizontalDistance) c.value = bx - ax;
        else c.value = by - ay;
      }
      break;
    }

    case SketchConstraintKind::PointOnEntity:
      if (!needPoints(1) || !needEntities(1)) return false;
      c.pointA = selPoints_[0];
      c.entityB = selEntities_[0];
      break;

    case SketchConstraintKind::Midpoint:
      if (!needPoints(1) || !needEntities(1)) return false;
      c.pointA = selPoints_[0];
      c.entityB = selEntities_[0];
      break;

    case SketchConstraintKind::Symmetric:
      if (!needPoints(2) || !needEntities(1)) return false;
      c.pointA = selPoints_[0];
      c.pointB = selPoints_[1];
      c.entityC = selEntities_[0];
      break;
  }

  if (!scene_.wellFormed(c, why)) return false;
  out = c;
  return true;
}

std::vector<SketchConstraintOffer> SketchSession::constraintOffers() const {
  std::vector<SketchConstraintOffer> out;
  out.reserve(kSketchConstraintKindCount);
  for (SketchConstraintKind kind : allSketchConstraintKinds()) {
    SketchConstraintOffer offer;
    offer.kind = kind;
    SketchConstraint built;
    std::string why;
    offer.applicable = constraintFromSelection(kind, built, why);
    offer.reason = offer.applicable ? std::string() : why;
    out.push_back(std::move(offer));
  }
  return out;
}

void SketchSession::applyConstraintKind(SketchConstraintKind kind) {
  SketchConstraint c;
  std::string why;
  if (!constraintFromSelection(kind, c, why)) {
    refusal_ = why;
    note(std::string("apply_constraint ") + toString(kind) + " REFUSED: " + why);
    return;
  }
  if (isSketchDimension(kind)) c.label = std::string(sketchConstraintGlyph(kind));
  const int id = scene_.addConstraint(c, &why);
  if (id == 0) {
    refusal_ = why;
    note(std::string("apply_constraint ") + toString(kind) + " REFUSED: " + why);
    return;
  }
  if (isSketchDimension(kind)) {
    if (SketchConstraint* live = scene_.mutableConstraint(id))
      live->label = std::string(sketchConstraintGlyph(kind)) + std::to_string(id);
  }
  touchScene();
  resolveWithDriver();
  // NOT refused when it over-constrains. The constraint is applied, the report
  // now says so, and `conflictHighlight()` names the whole set -- which is a
  // state the user can repair. Refusing here would be the capability gate.
  const SketchDofReport& report = dof();
  std::string line = std::string("apply_constraint ") + toString(kind) + " -> c" +
                     std::to_string(id) + " (" + toString(report.status) + ")";
  note(line);
}

// ── reporting ───────────────────────────────────────────────────────────────
const SketchDofReport& SketchSession::dof() const {
  if (dofDirty_) {
    static const SketchDofReport kNoSolver{};
    if (solver_ == nullptr) {
      dofCache_ = kNoSolver;
      dofCache_.detail = "no solver installed";
    } else {
      dofCache_ = solver_->analyse(scene_);
    }
    dofDirty_ = false;
  }
  return dofCache_;
}

bool SketchSession::isConflicting(int constraintId) const {
  const std::vector<int> hot = dof().conflictHighlight();
  return std::find(hot.begin(), hot.end(), constraintId) != hot.end();
}

SketchStatus SketchSession::status() const {
  const SketchDofReport& r = dof();
  SketchStatus s;
  s.active = active_;
  s.plane = toString(plane_.kind);
  s.tool = tool_;
  s.dof = r.status;
  s.degreesOfFreedom = r.dof;
  s.entities = scene_.entityCount();
  s.constraints = scene_.constraintCount();
  s.conflicts = r.conflicts.size();
  s.solverInstalled = driver_ != nullptr;
  if (!active_) {
    s.text = "not in sketch mode";
    return s;
  }
  s.text = std::string("sketch on ") + s.plane + " | " + toString(tool_) + " | " +
           std::to_string(s.entities) + " entities, " + std::to_string(s.constraints) +
           " constraints | " + toString(r.status);
  if (r.status == SketchDofStatus::Under)
    s.text += " (" + std::to_string(r.dof) + " DOF)";
  if (r.status == SketchDofStatus::Over)
    s.text += " (" + std::to_string(r.conflicts.size()) + " conflicting, " +
              std::to_string(r.dof) + " DOF)";
  return s;
}

// ── the rubber band ─────────────────────────────────────────────────────────
SketchPreview SketchSession::preview(double cursorX, double cursorY,
                                     bool filterIndependent) const {
  SketchPreview p;
  p.tool = tool_;
  if (!active_) {
    p.hint = "not in sketch mode";
    return p;
  }
  p.snap = snapCursor(scene_, snap_, cursorX, cursorY);
  if (p.snap.entityA != 0) p.references.push_back(p.snap.entityA);
  if (p.snap.entityB != 0) p.references.push_back(p.snap.entityB);

  const double sx = p.snap.x, sy = p.snap.y;
  const std::size_t n = picks_.size();
  p.active = n > 0;

  switch (tool_) {
    case SketchTool::Select:
      p.hint = "click to select; shift-click to add";
      return p;

    case SketchTool::Point:
      p.ghosts.push_back(makeSketchPoint(sx, sy));
      p.completes = true;
      p.hint = "click to place a point";
      break;

    case SketchTool::Line:
      if (n == 0) { p.hint = "click the first end"; break; }
      p.ghosts.push_back(makeSketchLine(picks_[0].x, picks_[0].y, sx, sy));
      p.completes = true;
      p.hint = "click the second end";
      break;

    case SketchTool::Polyline:
      if (n == 0) { p.hint = "click the chain's first point"; break; }
      p.ghosts.push_back(makeSketchLine(picks_.back().x, picks_.back().y, sx, sy));
      p.hint = "click for the next point; Enter to finish";
      break;

    case SketchTool::Rectangle:
      if (n == 0) { p.hint = "click one corner"; break; }
      {
        const double x0 = picks_[0].x, y0 = picks_[0].y;
        p.ghosts.push_back(makeSketchLine(x0, y0, sx, y0));
        p.ghosts.push_back(makeSketchLine(sx, y0, sx, sy));
        p.ghosts.push_back(makeSketchLine(sx, sy, x0, sy));
        p.ghosts.push_back(makeSketchLine(x0, sy, x0, y0));
      }
      p.completes = true;
      p.hint = "click the opposite corner";
      break;

    case SketchTool::Circle:
      if (n == 0) { p.hint = "click the centre"; break; }
      {
        const double r = std::hypot(sx - picks_[0].x, sy - picks_[0].y);
        if (r > 1.0e-9) p.ghosts.push_back(makeSketchCircle(picks_[0].x, picks_[0].y, r));
      }
      p.completes = true;
      p.hint = "click a point on the rim";
      break;

    case SketchTool::Arc:
      if (n == 0) { p.hint = "click the centre"; break; }
      if (n == 1) {
        const double r = std::hypot(sx - picks_[0].x, sy - picks_[0].y);
        if (r > 1.0e-9) p.ghosts.push_back(makeSketchCircle(picks_[0].x, picks_[0].y, r));
        p.hint = "click the start of the arc";
        break;
      }
      {
        const double r = std::hypot(picks_[1].x - picks_[0].x, picks_[1].y - picks_[0].y);
        const double a0 = std::atan2(picks_[1].y - picks_[0].y, picks_[1].x - picks_[0].x);
        const double a1 = std::atan2(sy - picks_[0].y, sx - picks_[0].x);
        if (r > 1.0e-9) p.ghosts.push_back(makeSketchArc(picks_[0].x, picks_[0].y, r, a0, a1));
      }
      p.completes = true;
      p.hint = "click the end of the arc";
      break;

    case SketchTool::Dimension:
      p.hint = n == 0 ? "pick a circle, a line, or the first point"
                      : "pick the second point, or the second line";
      return p;
  }

  if (p.ghosts.empty()) return p;

  // Inference against a COPY, so a live preview can never touch the real scene.
  // This is the reason the whole preview is a const query: the ghost has to
  // exist somewhere for the inference engine to reason about, and the one place
  // it must not exist is the document.
  SketchScene probe = scene_;
  std::vector<int> ghostIds;
  for (const SketchEntity& g : p.ghosts) {
    SketchEntity copy = g;
    copy.construction = construction_;
    const int id = probe.add(copy);
    if (id != 0) ghostIds.push_back(id);
  }
  if (!autoConstrain_ || ghostIds.empty()) return p;

  std::vector<ConstraintProposal> offered;
  for (std::size_t i = 0; i < ghostIds.size(); ++i) {
    std::vector<SketchPickBinding> bindings;
    // Only the LAST pick's snap can be attributed with confidence during a
    // preview: earlier picks bound points the ghost may not have (a rectangle's
    // ghost is rebuilt from scratch every frame). Binding the live snap to the
    // ghost point that sits on it is exactly true, and nothing else is claimed.
    for (SketchPointRole role :
         {SketchPointRole::Start, SketchPointRole::End, SketchPointRole::Centre}) {
      double bx = 0.0, by = 0.0;
      const SketchPointId pid{ghostIds[i], role};
      if (!probe.pointPosition(pid, bx, by)) continue;
      const double scale = 1.0 + std::max(std::fabs(bx), std::fabs(by));
      if (std::hypot(bx - sx, by - sy) > 1.0e-7 * scale) continue;
      SketchPickBinding b;
      b.point = pid;
      b.snap = p.snap;
      bindings.push_back(b);
      break;
    }
    const std::vector<ConstraintProposal> more =
        inferConstraints(probe, ghostIds[i], bindings, inference_);
    offered.insert(offered.end(), more.begin(), more.end());
  }

  if (filterIndependent && solver_ != nullptr)
    p.proposals = retainIndependent(*solver_, probe, offered);
  else
    p.proposals = offered;

  for (const ConstraintProposal& c : p.proposals) {
    for (int id : {c.constraint.entityB, c.constraint.pointB.entity}) {
      if (id != 0 && std::find(ghostIds.begin(), ghostIds.end(), id) == ghostIds.end())
        p.references.push_back(id);
    }
  }
  std::sort(p.references.begin(), p.references.end());
  p.references.erase(std::unique(p.references.begin(), p.references.end()), p.references.end());
  return p;
}

}  // namespace forge::ui
