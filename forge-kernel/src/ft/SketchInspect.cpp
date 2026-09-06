// forge-kernel/src/ft/SketchInspect.cpp — the read-only half of the sketch family.
//
// See forge/ft/SketchInspect.hpp for what this answers and why. What follows is
// the ONE rule this file is written to:
//
//   EVERY NUMBER IT REPORTS IS READ BACK FROM THE SOLVER.
//
// Nothing is estimated, nothing is carried over from the statement that drew it,
// and a quantity that cannot be measured is reported ABSENT rather than filled
// in. A radius that a RADIUS constraint moved is read from the circle's own
// parameter; a residual comes from GCS::calculateConstraintErrorByTag; a degree
// of freedom comes from GCS::System's Jacobian rank. The as-drawn numbers are
// reported too, and are LABELLED as as-drawn, because "drawn 10, now 12" is a
// fact the drawing alone cannot tell you.

#include "forge/ft/SketchInspect.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <exception>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "forge/Sketcher.hpp"

namespace forge {
namespace ft {

namespace {

constexpr double kPi = 3.14159265358979323846;

// A sketch handle held for the length of one inspection and destroyed however
// this function leaves — including down a throw. The registry hands out handles
// that live until destroySketch(), so an inspection that ran once a frame and
// leaked would grow the process without bound.
class ScopedSketch {
 public:
  ScopedSketch() : h_(forge::createSketch()) {}
  ~ScopedSketch() {
    if (h_ != forge::kInvalidSketch) {
      try {
        forge::destroySketch(h_);
      } catch (...) {
        // Destroying a handle the registry has already forgotten is not a
        // failure worth propagating out of a destructor.
      }
    }
  }
  ScopedSketch(const ScopedSketch&) = delete;
  ScopedSketch& operator=(const ScopedSketch&) = delete;
  forge::SketchHandle get() const { return h_; }

 private:
  forge::SketchHandle h_;
};

// What the walk knows about one statement it has already read.
struct Bound {
  bool isSketch = false;         // the SKETCH statement itself, or a CON over it
  int sketchIrId = 0;            // which sketch this value belongs to
  std::uint32_t entity = 0;      // the facade id, when this statement made one
  bool hasEntity = false;
  SketchCurveKind kind = SketchCurveKind::Point;
};

}  // namespace

// ── THE ONE CON KEYWORD TABLE ───────────────────────────────────────────────
// Nineteen rows, and each `kind` is written as the ENUMERATOR, then narrowed to
// the number the OCCT-free header carries. That is what makes the two spellings
// impossible to drift apart: renumber forge::SketchConstraintKind and this file
// stops compiling rather than starting to lie.
const std::vector<ConKeyword>& conKeywords() {
  using K = forge::SketchConstraintKind;
  auto row = [](const char* w, K k, bool dim, bool ang) {
    ConKeyword c;
    c.word = w;
    c.kind = static_cast<std::uint32_t>(k);
    c.dimensional = dim;
    c.angular = ang;
    return c;
  };
  static const std::vector<ConKeyword> kTable = {
      // geometric
      row("COINC", K::Coincident, false, false),
      row("PARA", K::Parallel, false, false),
      row("PERP", K::Perpendicular, false, false),
      row("TANG", K::Tangent, false, false),
      row("EQUAL", K::Equal, false, false),
      row("CONC", K::Concentric, false, false),
      row("COLL", K::Collinear, false, false),
      row("SYMM", K::Symmetric, false, false),
      row("MIDPT", K::Midpoint, false, false),
      row("HORIZ", K::Horizontal, false, false),
      row("VERT", K::Vertical, false, false),
      row("PTON", K::PointOnLine, false, false),
      row("FIX", K::Fix, false, false),
      // dimensional
      row("DIST", K::Distance, true, false),
      row("DISTX", K::DistanceX, true, false),
      row("DISTY", K::DistanceY, true, false),
      row("ANGLE", K::Angle, true, true),
      row("RADIUS", K::Radius, true, false),
      row("DIAM", K::Diameter, true, false),
  };
  return kTable;
}

const ConKeyword* findConKeyword(const std::string& word) {
  for (const ConKeyword& c : conKeywords()) {
    if (word == c.word) return &c;
  }
  return nullptr;
}

int SketchInspection::sketchOf(int irId) const {
  for (const SketchInfo& s : sketches) {
    if (s.irId == irId) return s.irId;
    for (const SketchEntityInfo& e : s.entities) {
      if (e.irId == irId) return s.irId;
    }
    for (const SketchConstraintInfo& c : s.constraints) {
      if (c.irId == irId) return s.irId;
    }
    if (s.solveIrId == irId) return s.irId;
  }
  return 0;
}

namespace {

// One sketch under construction, plus everything the report needs that the
// facade does not keep for us (which statement made which facade id).
struct Building {
  SketchInfo info;
  ScopedSketch sketch;
  // statement id -> the point/entity id the facade handed back
  std::unordered_map<int, std::uint32_t> entityOf;
  std::vector<int> pointStatements;   // in creation order — matches the facade's
                                      // point indices, which is what the free
                                      // parameter report indexes by
  std::vector<int> entityStatements;  // likewise for lines / circles / arcs
};

SketchHealth healthFromClassification(const std::string& c) {
  if (c == "well") return SketchHealth::FullyConstrained;
  if (c == "under") return SketchHealth::UnderConstrained;
  if (c == "over") return SketchHealth::OverConstrained;
  if (c == "redundant") return SketchHealth::Redundant;
  return SketchHealth::Empty;
}

// The statement that owns a facade id, or 0. The facade's ids are opaque to us
// so the map is kept by the walk rather than derived.
int statementForFacadeId(const Building& b, std::uint32_t facadeId, bool wantPoint) {
  const std::vector<int>& list = wantPoint ? b.pointStatements : b.entityStatements;
  for (int irId : list) {
    auto it = b.entityOf.find(irId);
    if (it != b.entityOf.end() && it->second == facadeId) return irId;
  }
  return 0;
}

}  // namespace

SketchInspection inspectSketches(const FeatureTree& ft) {
  SketchInspection out;

  // Every statement the walk has resolved, and the sketch it belongs to.
  std::unordered_map<int, Bound> env;
  // The sketches being built, keyed by their SKETCH statement id, in the order
  // the program declares them.
  std::vector<int> order;
  std::unordered_map<int, Building> building;

  auto boundOf = [&env](int ref) -> const Bound* {
    auto it = env.find(ref);
    return it == env.end() ? nullptr : &it->second;
  };

  for (const Op& op : ft.ops) {
    switch (op.code) {
      // ── SKETCH(PLANE) ────────────────────────────────────────────────────
      case OpCode::Sketch: {
        order.push_back(op.id);
        Building& b = building[op.id];
        b.info.irId = op.id;
        b.info.plane = (!op.args.empty() && op.args[0].kind == TokKind::Keyword)
                           ? op.args[0].kw
                           : std::string("XY");
        // The compiler solves every sketch on XY and SAYS SO when the statement
        // asked for another plane. Reporting the same fact here keeps the panel
        // honest about a plane the model does not actually have.
        b.info.planeApplied = (b.info.plane == "XY");
        Bound bd;
        bd.isSketch = true;
        bd.sketchIrId = op.id;
        env[op.id] = bd;
        break;
      }

      // ── SPT(%sketch, x, y) ───────────────────────────────────────────────
      case OpCode::SPt: {
        if (op.args.size() < 3 || op.args[0].kind != TokKind::Ref) break;
        const Bound* owner = boundOf(op.args[0].ref);
        if (owner == nullptr || owner->sketchIrId == 0) break;
        auto bi = building.find(owner->sketchIrId);
        if (bi == building.end()) break;
        if (op.args[1].kind != TokKind::Number || op.args[2].kind != TokKind::Number) break;
        Building& b = bi->second;
        const std::uint32_t pid =
            forge::addPoint(b.sketch.get(), op.args[1].num, op.args[2].num);
        b.entityOf[op.id] = pid;
        b.pointStatements.push_back(op.id);
        SketchEntityInfo e;
        e.irId = op.id;
        e.kind = SketchCurveKind::Point;
        b.info.entities.push_back(e);
        Bound bd;
        bd.sketchIrId = owner->sketchIrId;
        bd.entity = pid;
        bd.hasEntity = true;
        bd.kind = SketchCurveKind::Point;
        env[op.id] = bd;
        break;
      }

      // ── SLINE(%p0, %p1) / SCIRC(%c, r) / SARC(%c, %p0, %p1) ──────────────
      case OpCode::SLine:
      case OpCode::SCirc:
      case OpCode::SArc: {
        if (op.args.empty() || op.args[0].kind != TokKind::Ref) break;
        const Bound* first = boundOf(op.args[0].ref);
        if (first == nullptr || !first->hasEntity) break;
        auto bi = building.find(first->sketchIrId);
        if (bi == building.end()) break;
        Building& b = bi->second;

        // Gather the operand entity ids, refusing a cross-sketch operand the
        // same way the compiler does — an operand from another sketch is not a
        // line, it is a mistake, and drawing it would put a curve in this list
        // that the model does not contain.
        std::vector<std::uint32_t> refs;
        std::vector<int> parents;
        bool badOperand = false;
        for (const Token& a : op.args) {
          if (a.kind != TokKind::Ref) continue;
          const Bound* r = boundOf(a.ref);
          if (r == nullptr || !r->hasEntity || r->sketchIrId != first->sketchIrId) {
            badOperand = true;
            break;
          }
          refs.push_back(r->entity);
          parents.push_back(a.ref);
        }
        if (badOperand) break;

        std::uint32_t made = 0;
        SketchCurveKind kind = SketchCurveKind::Line;
        bool ok = false;
        double writtenRadius = 0.0;
        bool hasWritten = false;
        try {
          if (op.code == OpCode::SLine && refs.size() == 2) {
            made = forge::addLine(b.sketch.get(), refs[0], refs[1]);
            kind = SketchCurveKind::Line;
            ok = true;
          } else if (op.code == OpCode::SCirc && refs.size() == 1 && op.args.size() >= 2 &&
                     op.args[1].kind == TokKind::Number) {
            writtenRadius = op.args[1].num;
            hasWritten = true;
            made = forge::addCircle(b.sketch.get(), refs[0], writtenRadius);
            kind = SketchCurveKind::Circle;
            ok = true;
          } else if (op.code == OpCode::SArc && refs.size() == 3) {
            made = forge::addArc(b.sketch.get(), refs[0], refs[1], refs[2]);
            kind = SketchCurveKind::Arc;
            ok = true;
          }
        } catch (const std::exception&) {
          ok = false;
        }
        if (!ok) break;

        b.entityOf[op.id] = made;
        b.entityStatements.push_back(op.id);
        SketchEntityInfo e;
        e.irId = op.id;
        e.kind = kind;
        e.parentIrIds = parents;
        e.hasWrittenRadius = hasWritten;
        e.writtenRadius = writtenRadius;
        b.info.entities.push_back(e);
        Bound bd;
        bd.sketchIrId = first->sketchIrId;
        bd.entity = made;
        bd.hasEntity = true;
        bd.kind = kind;
        env[op.id] = bd;
        break;
      }

      // ── CON(%a, KIND [, %b, value]) ──────────────────────────────────────
      case OpCode::Con: {
        if (op.args.empty() || op.args[0].kind != TokKind::Ref) break;
        const Bound* first = boundOf(op.args[0].ref);
        if (first == nullptr || !first->hasEntity) break;
        auto bi = building.find(first->sketchIrId);
        if (bi == building.end()) break;
        Building& b = bi->second;

        SketchConstraintInfo c;
        c.irId = op.id;
        if (op.args.size() >= 2 && op.args[1].kind == TokKind::Keyword) c.keyword = op.args[1].kw;
        c.operandIrIds.push_back(op.args[0].ref);

        std::vector<std::uint32_t> refs{first->entity};
        for (std::size_t i = 2; i < op.args.size(); ++i) {
          if (op.args[i].kind == TokKind::Ref) {
            const Bound* r = boundOf(op.args[i].ref);
            if (r == nullptr || !r->hasEntity || r->sketchIrId != first->sketchIrId) {
              c.state = SketchConstraintState::BadOperand;
              break;
            }
            refs.push_back(r->entity);
            c.operandIrIds.push_back(op.args[i].ref);
          } else if (op.args[i].kind == TokKind::Number) {
            c.hasValue = true;
            c.value = op.args[i].num;
          }
        }

        const ConKeyword* kw = findConKeyword(c.keyword);
        if (c.state == SketchConstraintState::BadOperand) {
          // already named
        } else if (kw == nullptr) {
          c.state = SketchConstraintState::UnknownKind;
        } else {
          c.dimensional = kw->dimensional;
          c.angular = kw->angular;
          // The ONE unit seam, converted where the compiler converts it: the IR
          // spells an angle in degrees and planegcs takes radians.
          const double sent = kw->angular ? c.value * kPi / 180.0 : c.value;
          try {
            const std::uint32_t tag = forge::addConstraint(
                b.sketch.get(), static_cast<forge::SketchConstraintKind>(kw->kind), refs, sent);
            c.tag = static_cast<int>(tag);
            c.state = SketchConstraintState::Applied;
          } catch (const std::exception&) {
            c.state = SketchConstraintState::Rejected;
          }
        }
        b.info.constraints.push_back(c);
        // CON is PASS-THROUGH: the statement is that sketch, one constraint on.
        Bound bd;
        bd.isSketch = true;
        bd.sketchIrId = first->sketchIrId;
        env[op.id] = bd;
        break;
      }

      // ── SOLVE(%sketch) ───────────────────────────────────────────────────
      case OpCode::Solve: {
        if (op.args.empty() || op.args[0].kind != TokKind::Ref) break;
        const Bound* owner = boundOf(op.args[0].ref);
        if (owner == nullptr || owner->sketchIrId == 0) break;
        auto bi = building.find(owner->sketchIrId);
        if (bi == building.end()) break;
        bi->second.info.solveIrId = op.id;
        Bound bd;
        bd.sketchIrId = owner->sketchIrId;
        env[op.id] = bd;
        break;
      }

      default:
        break;
    }
  }

  // ── the measurement pass ─────────────────────────────────────────────────
  for (const int sketchId : order) {
    Building& b = building[sketchId];
    SketchInfo& info = b.info;
    const forge::SketchHandle h = b.sketch.get();

    // The STRUCTURAL diagnosis, taken BEFORE any repair: solveOrRepair removes
    // the conflicting constraints, so a report that only ever looked afterwards
    // would show a clean sketch and never say which constraint had to go.
    forge::SketchDiagnostics pre{};
    try {
      pre = forge::diagnoseSketch(h);
    } catch (const std::exception&) {
      pre.dof = -1;
      pre.classification = "empty";
    }
    auto markTags = [&info](const std::vector<int>& tags, bool SketchConstraintInfo::*field) {
      for (const int t : tags) {
        for (SketchConstraintInfo& c : info.constraints) {
          if (c.tag != 0 && c.tag == t) c.*field = true;
        }
      }
    };
    markTags(pre.conflicting, &SketchConstraintInfo::conflicting);
    markTags(pre.redundant, &SketchConstraintInfo::redundant);
    markTags(pre.partiallyRedundant, &SketchConstraintInfo::partiallyRedundant);

    // Run the SAME repair the compiler runs, and only when the program itself
    // asks for it. A sketch the program never solves is reported as drawn,
    // because that is what the model was built from.
    if (info.solveIrId != 0) {
      forge::SketchSolveReport r{};
      r.classification = "unsolved";
      r.dof = -1;
      bool ran = false;
      try {
        r = forge::solveOrRepair(h);
        ran = true;
      } catch (const std::exception&) {
        ran = false;
      }
      info.solved = ran;
      if (ran) {
        info.converged = (r.status == forge::SketchSolveStatus::Success);
        info.solvePasses = r.passes;
        info.worstResidual = r.worstResidual;
        info.hasWorstResidual = true;
        for (const forge::SketchDemotion& d : r.demoted) {
          for (SketchConstraintInfo& c : info.constraints) {
            if (c.tag != 0 && c.tag == d.tag) {
              c.demoted = true;
              c.demotedForConflict = (d.reason == forge::SketchDemotionReason::Conflicting);
            }
          }
        }
      }
    }

    // The FINAL diagnosis — the state the model actually has.
    forge::SketchDiagnostics post = pre;
    try {
      post = forge::diagnoseSketch(h);
    } catch (const std::exception&) {
      // Keep the pre-solve reading rather than inventing one.
    }
    info.dof = post.dof;
    info.health = healthFromClassification(post.classification);

    // Per-constraint residuals, by tag, from the solver's own error function.
    std::vector<forge::SketchConstraintResidual> residuals;
    try {
      residuals = forge::allConstraintResiduals(h);
    } catch (const std::exception&) {
      residuals.clear();
    }
    for (const forge::SketchConstraintResidual& r : residuals) {
      if (!std::isfinite(r.residual)) continue;
      for (SketchConstraintInfo& c : info.constraints) {
        if (c.tag != 0 && c.tag == r.tag) {
          c.residual = r.residual;
          c.hasResidual = true;
        }
      }
    }

    // ── WHAT IS STILL FREE TO MOVE ─────────────────────────────────────────
    // Read from `distinctDependentParams` and `dependentParamGroups`, NOT from
    // the flat `dependentParams` beside them: that list holds one entry per
    // (parameter, group) pair, so its length counts a coupled coordinate several
    // times. A panel that printed it would report a two-coordinate point as
    // having six free parameters, which is a plausible wrong number — the worst
    // kind, because a user believes it.
    auto roleOf = [](forge::SketchParamRole r) {
      switch (r) {
        case forge::SketchParamRole::PointX: return SketchFreeRole::X;
        case forge::SketchParamRole::PointY: return SketchFreeRole::Y;
        case forge::SketchParamRole::CircleRadius:
        case forge::SketchParamRole::ArcRadius: return SketchFreeRole::Radius;
        case forge::SketchParamRole::ArcStartAngle: return SketchFreeRole::StartAngle;
        case forge::SketchParamRole::ArcEndAngle: return SketchFreeRole::EndAngle;
        case forge::SketchParamRole::Unknown: break;
      }
      return SketchFreeRole::Other;
    };
    auto ownerStatement = [&b](const forge::SketchDependentParam& d) {
      const bool isPoint = (d.role == forge::SketchParamRole::PointX ||
                            d.role == forge::SketchParamRole::PointY);
      return statementForFacadeId(b, d.ownerId, isPoint);
    };
    for (const forge::SketchDependentParam& d : post.distinctDependentParams) {
      const int stmt = ownerStatement(d);
      if (stmt == 0) continue;
      for (SketchEntityInfo& e : info.entities) {
        if (e.irId != stmt) continue;
        const SketchFreeRole role = roleOf(d.role);
        if (std::find(e.freeRoles.begin(), e.freeRoles.end(), role) == e.freeRoles.end()) {
          e.freeRoles.push_back(role);
        }
      }
    }
    for (std::size_t g = 0; g < post.dependentParamGroups.size(); ++g) {
      SketchFreeGroup fg;
      fg.group = static_cast<int>(g);
      fg.paramCount = static_cast<int>(post.dependentParamGroups[g].size());
      for (const forge::SketchDependentParam& d : post.dependentParamGroups[g]) {
        const int stmt = ownerStatement(d);
        if (stmt == 0) continue;
        if (std::find(fg.entityIrIds.begin(), fg.entityIrIds.end(), stmt) == fg.entityIrIds.end()) {
          fg.entityIrIds.push_back(stmt);
        }
        for (SketchEntityInfo& e : info.entities) {
          if (e.irId != stmt) continue;
          if (std::find(e.freeGroups.begin(), e.freeGroups.end(), fg.group) == e.freeGroups.end()) {
            e.freeGroups.push_back(fg.group);
          }
        }
      }
      info.freeGroups.push_back(std::move(fg));
    }

    // Which constraints reach which entity — the adjacency a relations view is.
    for (const SketchConstraintInfo& c : info.constraints) {
      for (const int operand : c.operandIrIds) {
        for (SketchEntityInfo& e : info.entities) {
          if (e.irId == operand &&
              std::find(e.constraintIrIds.begin(), e.constraintIrIds.end(), c.irId) ==
                  e.constraintIrIds.end()) {
            e.constraintIrIds.push_back(c.irId);
          }
        }
      }
    }

    // The LIVE geometry, read back out of the parameter storage the solve wrote.
    for (SketchEntityInfo& e : info.entities) {
      auto it = b.entityOf.find(e.irId);
      if (it == b.entityOf.end()) continue;
      try {
        if (e.kind == SketchCurveKind::Point) {
          const forge::SketchPoint p = forge::readPoint(h, it->second);
          e.x0 = p.x;
          e.y0 = p.y;
        } else {
          const forge::SketchEntityGeometry g = forge::readEntity(h, it->second);
          e.x0 = g.x0;
          e.y0 = g.y0;
          e.x1 = g.x1;
          e.y1 = g.y1;
          e.cx = g.cx;
          e.cy = g.cy;
          e.length = g.length;
          e.hasLength = true;
          if (e.kind != SketchCurveKind::Line) {
            e.radius = g.radius;
            e.hasRadius = true;
          }
        }
      } catch (const std::exception&) {
        // Leave the entity's geometry ABSENT rather than half-filled.
      }
    }

    // ── the DRIVING NUMBERS ────────────────────────────────────────────────
    auto entityByIr = [&info](int irId) -> const SketchEntityInfo* {
      for (const SketchEntityInfo& e : info.entities) {
        if (e.irId == irId) return &e;
      }
      return nullptr;
    };
    for (const SketchConstraintInfo& c : info.constraints) {
      if (!c.dimensional || !c.hasValue) continue;
      SketchDimensionInfo d;
      d.irId = c.irId;
      d.source = SketchDimensionSource::Constraint;
      d.keyword = c.keyword;
      d.value = c.value;
      d.angular = c.angular;
      d.operandIrIds = c.operandIrIds;
      d.driving = (c.state == SketchConstraintState::Applied) && !c.demoted;
      d.hasResidual = c.hasResidual;
      d.residual = c.residual;
      // What the solver LEFT it at, wherever that is measurable from the solved
      // geometry rather than assumed from the request.
      if (c.keyword == "RADIUS" || c.keyword == "DIAM") {
        const SketchEntityInfo* e = c.operandIrIds.empty() ? nullptr
                                                           : entityByIr(c.operandIrIds.front());
        if (e != nullptr && e->hasRadius) {
          d.hasSolvedValue = true;
          d.solvedValue = (c.keyword == "DIAM") ? 2.0 * e->radius : e->radius;
        }
      } else if ((c.keyword == "DIST" || c.keyword == "DISTX" || c.keyword == "DISTY") &&
                 c.operandIrIds.size() == 2) {
        const SketchEntityInfo* a = entityByIr(c.operandIrIds[0]);
        const SketchEntityInfo* z = entityByIr(c.operandIrIds[1]);
        if (a != nullptr && z != nullptr && a->kind == SketchCurveKind::Point &&
            z->kind == SketchCurveKind::Point) {
          const double dx = z->x0 - a->x0;
          const double dy = z->y0 - a->y0;
          d.hasSolvedValue = true;
          // Signed for the axis forms, exactly as the constraint is signed.
          d.solvedValue = (c.keyword == "DISTX")   ? dx
                          : (c.keyword == "DISTY") ? dy
                                                   : std::sqrt(dx * dx + dy * dy);
        }
      }
      info.dimensions.push_back(d);
    }
    for (const SketchEntityInfo& e : info.entities) {
      if (!e.hasWrittenRadius) continue;
      SketchDimensionInfo d;
      d.irId = e.irId;
      d.source = SketchDimensionSource::CircleRadius;
      d.value = e.writtenRadius;
      d.driving = true;  // it IS the parameter the solver starts from
      d.operandIrIds = e.parentIrIds;
      if (e.hasRadius) {
        d.hasSolvedValue = true;
        d.solvedValue = e.radius;
      }
      info.dimensions.push_back(d);
    }
    std::sort(info.dimensions.begin(), info.dimensions.end(),
              [](const SketchDimensionInfo& a, const SketchDimensionInfo& c) {
                return a.irId < c.irId;
              });

    out.sketches.push_back(std::move(info));
  }

  return out;
}

SketchInspection inspectSketchesText(const std::string& irText) {
  SketchInspection out;
  FeatureTree tree;
  try {
    tree = parse(irText);
  } catch (const std::exception& e) {
    out.ok = false;
    out.error = e.what();
    return out;
  } catch (...) {
    out.ok = false;
    out.error = "the program could not be read";
    return out;
  }
  try {
    return inspectSketches(tree);
  } catch (const std::exception& e) {
    out.ok = false;
    out.error = e.what();
    return out;
  }
}

}  // namespace ft
}  // namespace forge
