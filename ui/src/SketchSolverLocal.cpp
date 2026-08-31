#include "forge/ui/SketchSolverLocal.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/SketchScene.hpp"

namespace forge::ui {
namespace {

constexpr double kDegPerRad = 57.295779513082320876798154814105;

// The packed variable at `column`, and a setter for it. The packing is
// SketchScene's (documented in its header); reproducing the walk here rather
// than exposing a raw pointer keeps the scene's storage private.
double getVariable(const SketchScene& scene, std::size_t column) {
  const int id = scene.entityForVariable(column);
  std::size_t base = 0;
  if (id == 0 || !scene.variableBase(id, base)) return 0.0;
  const SketchEntity* e = scene.entity(id);
  if (e == nullptr) return 0.0;
  return e->v[column - base];
}

void setVariable(SketchScene& scene, std::size_t column, double value) {
  const int id = scene.entityForVariable(column);
  std::size_t base = 0;
  if (id == 0 || !scene.variableBase(id, base)) return;
  SketchEntity* e = scene.mutableEntity(id);
  if (e == nullptr) return;
  e->v[column - base] = value;
}

// Every packed column the constraint's equations can possibly depend on: the
// full variable range of every entity it names. A superset is safe (a zero
// derivative costs one evaluation); a subset would silently drop a Jacobian
// entry and understate the rank, which is the failure mode that reports an
// over-constrained sketch as merely constrained.
std::vector<std::size_t> columnsOf(const SketchScene& scene, const SketchConstraint& c) {
  std::vector<std::size_t> cols;
  const int ids[5] = {c.pointA.entity, c.pointB.entity, c.entityA, c.entityB, c.entityC};
  for (int id : ids) {
    if (id <= 0) continue;
    std::size_t base = 0;
    const SketchEntity* e = scene.entity(id);
    if (e == nullptr || !scene.variableBase(id, base)) continue;
    const std::size_t n = e->variableCount();
    for (std::size_t i = 0; i < n; ++i) cols.push_back(base + i);
  }
  std::sort(cols.begin(), cols.end());
  cols.erase(std::unique(cols.begin(), cols.end()), cols.end());
  return cols;
}

// Deterministic perturbation. std::rand would make the report depend on process
// history, and a DOF readout that differs between two runs of the same sketch is
// not a measurement.
double probeOffset(std::uint64_t& state) {
  state = state * 6364136223846793005ULL + 1442695040888963407ULL;
  const double u = static_cast<double>((state >> 11) & 0x1FFFFFFFFFFFFFULL) /
                   static_cast<double>(0x20000000000000ULL);
  return 2.0 * u - 1.0;  // (-1, 1)
}

double wrapDegrees(double d) {
  double r = std::fmod(d + 180.0, 360.0);
  if (r < 0.0) r += 360.0;
  return r - 180.0;
}

}  // namespace

std::vector<double> sketchConstraintResiduals(const SketchScene& scene,
                                              const SketchConstraint& c) {
  const std::size_t eq = equationCountFor(scene, c);
  if (eq == 0) return {};

  const auto pos = [&scene](const SketchPointId& p, double& x, double& y) {
    return scene.pointPosition(p, x, y);
  };
  double ax = 0.0, ay = 0.0, bx = 0.0, by = 0.0;

  switch (c.kind) {
    case SketchConstraintKind::Coincident:
      pos(c.pointA, ax, ay);
      pos(c.pointB, bx, by);
      return {ax - bx, ay - by};

    case SketchConstraintKind::PointOnEntity: {
      pos(c.pointA, ax, ay);
      const SketchEntity* h = scene.entity(c.entityB);
      if (h == nullptr) return {0.0};
      if (h->kind == SketchEntityKind::Line) {
        // Perpendicular offset from the INFINITE line: a point-on-line
        // constraint names the line, not the drawn segment, so the equation must
        // not be clamped to the endpoints the way a hit test is.
        const double dx = h->v[2] - h->v[0], dy = h->v[3] - h->v[1];
        const double len = std::hypot(dx, dy);
        if (!(len > 1.0e-12)) return {std::hypot(ax - h->v[0], ay - h->v[1])};
        return {((ax - h->v[0]) * dy - (ay - h->v[1]) * dx) / len};
      }
      return {std::hypot(ax - h->v[0], ay - h->v[1]) - h->v[2]};
    }

    case SketchConstraintKind::Horizontal: {
      const SketchEntity* l = scene.entity(c.entityA);
      return {l == nullptr ? 0.0 : l->v[3] - l->v[1]};
    }
    case SketchConstraintKind::Vertical: {
      const SketchEntity* l = scene.entity(c.entityA);
      return {l == nullptr ? 0.0 : l->v[2] - l->v[0]};
    }

    case SketchConstraintKind::Parallel:
    case SketchConstraintKind::Perpendicular:
    case SketchConstraintKind::Angle: {
      const SketchEntity* la = scene.entity(c.entityA);
      const SketchEntity* lb = scene.entity(c.entityB);
      if (la == nullptr || lb == nullptr) return {0.0};
      const double ux = la->v[2] - la->v[0], uy = la->v[3] - la->v[1];
      const double vx = lb->v[2] - lb->v[0], vy = lb->v[3] - lb->v[1];
      const double nu = std::hypot(ux, uy), nv = std::hypot(vx, vy);
      if (!(nu > 1.0e-12) || !(nv > 1.0e-12)) return {0.0};
      const double cr = (ux * vy - uy * vx) / (nu * nv);   // sin of the angle
      const double dt = (ux * vx + uy * vy) / (nu * nv);   // cos of the angle
      if (c.kind == SketchConstraintKind::Parallel) return {cr};
      if (c.kind == SketchConstraintKind::Perpendicular) return {dt};
      return {wrapDegrees(std::atan2(cr, dt) * kDegPerRad - c.value)};
    }

    case SketchConstraintKind::Tangent: {
      const SketchEntity* a = scene.entity(c.entityA);
      const SketchEntity* b = scene.entity(c.entityB);
      if (a == nullptr || b == nullptr) return {0.0};
      if (a->kind == SketchEntityKind::Line) {
        const double dx = a->v[2] - a->v[0], dy = a->v[3] - a->v[1];
        const double len = std::hypot(dx, dy);
        if (!(len > 1.0e-12)) return {0.0};
        const double signed_ = ((b->v[0] - a->v[0]) * dy - (b->v[1] - a->v[1]) * dx) / len;
        // |offset| - r rather than offset^2 - r^2: the absolute value's kink sits
        // at offset == 0, which is a centre ON the line, and a tangency solution
        // never lives there (r > 0). Squaring would be smooth everywhere and
        // scale as length^2, which conditions the row worse for no gain.
        return {std::fabs(signed_) - b->v[2]};
      }
      const double d = std::hypot(a->v[0] - b->v[0], a->v[1] - b->v[1]);
      const double external = d - (a->v[2] + b->v[2]);
      const double internal = d - std::fabs(a->v[2] - b->v[2]);
      // Two circles are tangent externally OR internally, and which one the user
      // means is read off the configuration they drew rather than asked for.
      // Picking the nearer branch is what every sketcher does; stating it here is
      // the difference between a documented choice and a surprise.
      return {std::fabs(external) <= std::fabs(internal) ? external : internal};
    }

    case SketchConstraintKind::Equal: {
      const SketchEntity* a = scene.entity(c.entityA);
      const SketchEntity* b = scene.entity(c.entityB);
      if (a == nullptr || b == nullptr) return {0.0};
      if (a->kind == SketchEntityKind::Line)
        return {std::hypot(a->v[2] - a->v[0], a->v[3] - a->v[1]) -
                std::hypot(b->v[2] - b->v[0], b->v[3] - b->v[1])};
      return {a->v[2] - b->v[2]};
    }

    case SketchConstraintKind::Concentric: {
      const SketchEntity* a = scene.entity(c.entityA);
      const SketchEntity* b = scene.entity(c.entityB);
      if (a == nullptr || b == nullptr) return {0.0, 0.0};
      return {a->v[0] - b->v[0], a->v[1] - b->v[1]};
    }

    case SketchConstraintKind::Midpoint: {
      pos(c.pointA, ax, ay);
      const SketchEntity* l = scene.entity(c.entityB);
      if (l == nullptr) return {0.0, 0.0};
      return {ax - 0.5 * (l->v[0] + l->v[2]), ay - 0.5 * (l->v[1] + l->v[3])};
    }

    case SketchConstraintKind::Symmetric: {
      pos(c.pointA, ax, ay);
      pos(c.pointB, bx, by);
      const SketchEntity* l = scene.entity(c.entityC);
      if (l == nullptr) return {0.0, 0.0};
      const double dx = l->v[2] - l->v[0], dy = l->v[3] - l->v[1];
      const double len = std::hypot(dx, dy);
      if (!(len > 1.0e-12)) return {0.0, 0.0};
      const double mx = 0.5 * (ax + bx) - l->v[0];
      const double my = 0.5 * (ay + by) - l->v[1];
      // 1: the midpoint of the pair lies on the axis.
      // 2: the pair's chord is perpendicular to the axis.
      return {(mx * dy - my * dx) / len, ((bx - ax) * dx + (by - ay) * dy) / len};
    }

    case SketchConstraintKind::Fix: {
      // A Fix pins the entity where it already is, so its residual is zero BY
      // CONSTRUCTION at every configuration this analysis ever sees. Its
      // information lives entirely in the Jacobian, which is built analytically
      // (unit rows) rather than differenced -- see buildJacobianRows.
      return std::vector<double>(eq, 0.0);
    }

    case SketchConstraintKind::Distance:
      pos(c.pointA, ax, ay);
      pos(c.pointB, bx, by);
      return {std::hypot(bx - ax, by - ay) - c.value};

    case SketchConstraintKind::HorizontalDistance:
      pos(c.pointA, ax, ay);
      pos(c.pointB, bx, by);
      return {(bx - ax) - c.value};

    case SketchConstraintKind::VerticalDistance:
      pos(c.pointA, ax, ay);
      pos(c.pointB, bx, by);
      return {(by - ay) - c.value};

    case SketchConstraintKind::Radius: {
      const SketchEntity* e = scene.entity(c.entityA);
      return {e == nullptr ? 0.0 : e->v[2] - c.value};
    }
    case SketchConstraintKind::Diameter: {
      const SketchEntity* e = scene.entity(c.entityA);
      return {e == nullptr ? 0.0 : 2.0 * e->v[2] - c.value};
    }
  }
  return std::vector<double>(eq, 0.0);
}

namespace {

struct JacobianRow {
  int constraintId = 0;
  std::vector<double> a;  // dense, length = unknowns
  double b = 0.0;         // residual
};

std::vector<JacobianRow> buildJacobianRows(const SketchScene& scene, double step) {
  const std::size_t n = scene.variableCount();
  std::vector<JacobianRow> rows;
  SketchScene work = scene;

  for (const SketchConstraint& c : scene.constraints()) {
    const std::size_t eq = equationCountFor(scene, c);
    if (eq == 0) continue;

    const std::size_t first = rows.size();
    const std::vector<double> f0 = sketchConstraintResiduals(scene, c);
    for (std::size_t k = 0; k < eq; ++k) {
      JacobianRow r;
      r.constraintId = c.id;
      r.a.assign(n, 0.0);
      r.b = (k < f0.size()) ? f0[k] : 0.0;
      rows.push_back(std::move(r));
    }

    if (c.kind == SketchConstraintKind::Fix) {
      // Analytic, because differencing a function that is identically zero gives
      // an identically zero row -- a Fix would then contribute NO rank and the
      // sketch would read as free in exactly the direction the user just pinned.
      std::size_t base = 0;
      if (scene.variableBase(c.entityA, base)) {
        for (std::size_t k = 0; k < eq && base + k < n; ++k) rows[first + k].a[base + k] = 1.0;
      }
      continue;
    }

    for (std::size_t col : columnsOf(scene, c)) {
      const double x0 = getVariable(scene, col);
      const double h = step * std::max(1.0, std::fabs(x0));
      setVariable(work, col, x0 + h);
      const std::vector<double> fp = sketchConstraintResiduals(work, c);
      setVariable(work, col, x0 - h);
      const std::vector<double> fm = sketchConstraintResiduals(work, c);
      setVariable(work, col, x0);
      for (std::size_t k = 0; k < eq; ++k) {
        const double up = (k < fp.size()) ? fp[k] : 0.0;
        const double dn = (k < fm.size()) ? fm[k] : 0.0;
        rows[first + k].a[col] = (up - dn) / (2.0 * h);
      }
    }
  }
  return rows;
}

// Column indices NOT in a maximal independent set of the row space -- a valid
// choice of free variables. Row-echelon with partial pivoting over the (already
// orthonormal) basis, so the pivot columns are the determined ones.
std::vector<std::size_t> freeColumns(std::vector<std::vector<double>> basis, std::size_t n,
                                     double tol) {
  std::vector<bool> pivot(n, false);
  std::size_t row = 0;
  for (std::size_t col = 0; col < n && row < basis.size(); ++col) {
    std::size_t best = row;
    double mag = std::fabs(basis[row][col]);
    for (std::size_t r = row + 1; r < basis.size(); ++r) {
      const double m = std::fabs(basis[r][col]);
      if (m > mag) { mag = m; best = r; }
    }
    if (!(mag > tol)) continue;
    std::swap(basis[row], basis[best]);
    const double p = basis[row][col];
    for (std::size_t k = col; k < n; ++k) basis[row][k] /= p;
    for (std::size_t r = 0; r < basis.size(); ++r) {
      if (r == row) continue;
      const double f = basis[r][col];
      if (f == 0.0) continue;
      for (std::size_t k = col; k < n; ++k) basis[r][k] -= f * basis[row][k];
    }
    pivot[col] = true;
    ++row;
  }
  std::vector<std::size_t> free;
  for (std::size_t col = 0; col < n; ++col) {
    if (!pivot[col]) free.push_back(col);
  }
  return free;
}

}  // namespace

SketchDofReport SketchSolverLocal::analyseAt(const SketchScene& scene) const {
  SketchDofReport rep;
  rep.unknowns = scene.variableCount();
  if (scene.entityCount() == 0) {
    rep.status = SketchDofStatus::Empty;
    rep.detail = "nothing drawn yet";
    return rep;
  }

  const std::size_t n = rep.unknowns;
  std::vector<JacobianRow> rows = buildJacobianRows(scene, tuning_.step);
  rep.equations = rows.size();

  // ── modified Gram-Schmidt, carrying each row's residual through ──────────
  std::vector<std::vector<double>> q;        // orthonormal basis of the row space
  std::vector<double> g;                     // the residual, transformed alongside
  std::vector<std::vector<int>> support;     // which constraints built each q
  const double kSupport = 1.0e-6;            // a coefficient below this is noise

  for (JacobianRow& row : rows) {
    double norm = 0.0;
    for (double v : row.a) norm += v * v;
    norm = std::sqrt(norm);

    if (!(norm > 1.0e-30)) {
      // A structurally empty row: at this configuration the constraint's
      // equation cannot be moved by ANY variable. It adds no rank, and whether
      // it is satisfied is read straight off its residual.
      SketchConflict k;
      k.constraintId = row.constraintId;
      k.consistent = std::fabs(row.b) <= tuning_.residualTolerance;
      k.detail = k.consistent
                     ? "already satisfied and immovable at this configuration"
                     : "cannot be satisfied by any first-order motion from here";
      rep.conflicts.push_back(k);
      continue;
    }
    for (double& v : row.a) v /= norm;
    row.b /= norm;

    std::vector<double> r = row.a;
    double gr = row.b;
    std::vector<int> touched;
    for (std::size_t k = 0; k < q.size(); ++k) {
      double coef = 0.0;
      for (std::size_t i = 0; i < n; ++i) coef += r[i] * q[k][i];
      if (coef == 0.0) continue;
      for (std::size_t i = 0; i < n; ++i) r[i] -= coef * q[k][i];
      gr -= coef * g[k];
      if (std::fabs(coef) > kSupport) touched.push_back(static_cast<int>(k));
    }

    double left = 0.0;
    for (double v : r) left += v * v;
    left = std::sqrt(left);

    if (left > tuning_.rankTolerance) {
      for (double& v : r) v /= left;
      gr /= left;
      // The new basis vector was built from this row AND from every basis vector
      // it leaned on, so its support is the transitive union. Attributing a later
      // dependency to only the row that created a basis vector would name one
      // constraint where the real conflict is a SET.
      std::vector<int> sup{row.constraintId};
      for (int k : touched) {
        const std::vector<int>& s = support[static_cast<std::size_t>(k)];
        sup.insert(sup.end(), s.begin(), s.end());
      }
      std::sort(sup.begin(), sup.end());
      sup.erase(std::unique(sup.begin(), sup.end()), sup.end());
      q.push_back(std::move(r));
      g.push_back(gr);
      support.push_back(std::move(sup));
      continue;
    }

    // Dependent. `gr` is the residual this row would have to have in order to
    // AGREE with everything before it; how far it actually sits from zero is the
    // difference between "redundant" and "contradictory".
    SketchConflict k;
    k.constraintId = row.constraintId;
    for (int t : touched) {
      const std::vector<int>& s = support[static_cast<std::size_t>(t)];
      k.withConstraints.insert(k.withConstraints.end(), s.begin(), s.end());
    }
    std::sort(k.withConstraints.begin(), k.withConstraints.end());
    k.withConstraints.erase(std::unique(k.withConstraints.begin(), k.withConstraints.end()),
                            k.withConstraints.end());
    k.withConstraints.erase(std::remove(k.withConstraints.begin(), k.withConstraints.end(),
                                        row.constraintId),
                            k.withConstraints.end());
    k.consistent = std::fabs(gr) <= tuning_.residualTolerance;
    k.detail = k.consistent ? "says nothing the constraints above do not already say"
                            : "contradicts the constraints above by " + std::to_string(gr);
    rep.conflicts.push_back(k);
  }

  rep.rank = q.size();
  rep.dof = n > rep.rank ? n - rep.rank : 0;
  rep.freeVariables = freeColumns(q, n, tuning_.rankTolerance);
  for (std::size_t col : rep.freeVariables) {
    const int id = scene.entityForVariable(col);
    if (id != 0) rep.underConstrainedEntities.push_back(id);
  }
  std::sort(rep.underConstrainedEntities.begin(), rep.underConstrainedEntities.end());
  rep.underConstrainedEntities.erase(
      std::unique(rep.underConstrainedEntities.begin(), rep.underConstrainedEntities.end()),
      rep.underConstrainedEntities.end());

  if (!rep.conflicts.empty()) {
    rep.status = SketchDofStatus::Over;
  } else if (rep.dof == 0) {
    rep.status = SketchDofStatus::Fully;
  } else {
    rep.status = SketchDofStatus::Under;
  }
  rep.detail = std::string(toString(rep.status)) + ": " + std::to_string(rep.dof) +
               " of " + std::to_string(rep.unknowns) + " unknowns free, rank " +
               std::to_string(rep.rank) + " of " + std::to_string(rep.equations) + " equations";
  return rep;
}

SketchDofReport SketchSolverLocal::analyse(const SketchScene& scene) const {
  SketchDofReport base = analyseAt(scene);

  // No dependent row means every equation was independent, so the rank is
  // already the largest it could be and no perturbation can raise it. Probing
  // then costs time and can only add noise, so it is skipped -- and skipping it
  // is a THEOREM about the rank, not an optimisation guess.
  if (base.conflicts.empty() || tuning_.probes == 0) return base;

  std::uint64_t state = 0x9E3779B97F4A7C15ULL;
  SketchDofReport best = base;
  for (std::size_t p = 0; p < tuning_.probes; ++p) {
    SketchScene probe = scene;
    const std::size_t n = probe.variableCount();
    for (std::size_t col = 0; col < n; ++col) {
      setVariable(probe, col,
                  getVariable(probe, col) + tuning_.probeAmplitude * probeOffset(state));
    }
    const SketchDofReport alt = analyseAt(probe);
    if (alt.rank > best.rank) best = alt;
  }
  if (best.rank == base.rank) return base;

  // The base configuration was ACCIDENTALLY degenerate: some constraint pair
  // looked dependent only because of where the geometry happens to sit. Take the
  // generic structure, but keep each surviving conflict's consistency verdict
  // from the TRUE configuration -- a residual measured at a perturbed one is
  // off by the perturbation and would call agreement a contradiction.
  SketchDofReport out = best;
  out.detail += " (rank taken from a perturbed configuration; the sketch as drawn is "
                "accidentally degenerate)";
  for (SketchConflict& k : out.conflicts) {
    for (const SketchConflict& b : base.conflicts) {
      if (b.constraintId == k.constraintId) {
        k.consistent = b.consistent;
        k.detail = b.detail;
        break;
      }
    }
  }
  if (out.conflicts.empty()) out.status = out.dof == 0 ? SketchDofStatus::Fully
                                                       : SketchDofStatus::Under;
  return out;
}

}  // namespace forge::ui
