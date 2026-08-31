#include "forge/ui/SketchSolver.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/Sketch.hpp"

namespace forge::ui {
namespace {

constexpr double kPi = 3.14159265358979323846;

// A floor for every length a residual divides by. It is not a fudge: the solver
// is ALLOWED to move a line's endpoints together, and a residual that becomes
// infinite mid-iteration takes the whole solve with it. Below this the direction
// is meaningless anyway, and the residual degrades continuously to the unscaled
// cross product rather than exploding.
constexpr double kLenFloor = 1e-9;

double cross2(double ax, double ay, double bx, double by) noexcept { return ax * by - ay * bx; }
double dot2(double ax, double ay, double bx, double by) noexcept { return ax * bx + ay * by; }

double wrapToPi(double a) noexcept {
  while (a > kPi) a -= 2.0 * kPi;
  while (a < -kPi) a += 2.0 * kPi;
  return a;
}

bool isCurve(const Sketch& s, int entity) {
  const SketchEntity* e = s.entity(entity);
  return e != nullptr &&
         (e->kind == SketchEntityKind::Circle || e->kind == SketchEntityKind::Arc);
}

bool isDirectional(const Sketch& s, int entity) {
  const SketchEntity* e = s.entity(entity);
  return e != nullptr &&
         (e->kind == SketchEntityKind::Line || e->kind == SketchEntityKind::Spline ||
          e->kind == SketchEntityKind::Ellipse);
}

// `horizontal(line)` and `horizontal(pA, pB)` are the same constraint written
// two ways, and both are what a user reaches for. Normalising here — once —
// keeps every residual below reading two points and never a special case.
bool endpointPair(const Sketch& s, const SketchConstraint& k, SketchRef& a, SketchRef& b) {
  a = k.a;
  b = k.b;
  if (b.valid()) return a.valid();
  if (!a.valid() || a.role != SketchPointRole::Self) return false;
  if (!isDirectional(s, a.entity)) return false;
  const SketchEntity* e = s.entity(a.entity);
  if (e->kind == SketchEntityKind::Ellipse) return false;  // no endpoints
  a = SketchRef{k.a.entity, SketchPointRole::Start};
  b = SketchRef{k.a.entity, SketchPointRole::End};
  return true;
}

// ── the residuals ───────────────────────────────────────────────────────────
// Every one is a pure function of `params`, is ZERO exactly when the constraint
// holds, and is scaled to MILLIMETRES or to a dimensionless sine/cosine. The
// scaling is what lets ONE tolerance gate a sketch that mixes a 200 mm distance
// with a 30-degree angle: an unnormalised `cross(dA, dB)` residual on two 200 mm
// lines is 40 000 times the angle it represents, so a tolerance that is tight
// for one is meaningless for the other.
//
// Returns false when the constraint is MALFORMED for this sketch — an operand
// that does not name the quantity the kind needs. Nothing is appended in that
// case; the caller reports the index and carries on with the rest.
bool residualsOf(const Sketch& s, const SketchConstraint& k, const std::vector<double>& x,
                 std::vector<double>* out) {
  const auto emit = [out](double v) {
    if (out != nullptr) out->push_back(v);
  };
  double ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0;

  switch (k.kind) {
    case SketchConstraintKind::Coincident: {
      if (!resolvePoint(s, x, k.a, ax, ay) || !resolvePoint(s, x, k.b, bx, by)) return false;
      emit(ax - bx);
      emit(ay - by);
      return true;
    }
    case SketchConstraintKind::Collinear: {
      double dax = 0, day = 0, dbx = 0, dby = 0;
      if (!resolveDirection(s, x, k.a.entity, dax, day)) return false;
      if (!resolveDirection(s, x, k.b.entity, dbx, dby)) return false;
      if (!resolvePoint(s, x, SketchRef{k.a.entity, SketchPointRole::Start}, ax, ay)) return false;
      if (!resolvePoint(s, x, SketchRef{k.b.entity, SketchPointRole::Start}, bx, by)) return false;
      const double la = std::max(std::sqrt(dax * dax + day * day), kLenFloor);
      const double lb = std::max(std::sqrt(dbx * dbx + dby * dby), kLenFloor);
      emit(cross2(dax, day, dbx, dby) / (la * lb));   // same direction (sine)
      emit(cross2(dax, day, bx - ax, by - ay) / la);  // ...and the same line (mm)
      return true;
    }
    case SketchConstraintKind::Parallel: {
      double dax = 0, day = 0, dbx = 0, dby = 0;
      if (!resolveDirection(s, x, k.a.entity, dax, day)) return false;
      if (!resolveDirection(s, x, k.b.entity, dbx, dby)) return false;
      const double la = std::max(std::sqrt(dax * dax + day * day), kLenFloor);
      const double lb = std::max(std::sqrt(dbx * dbx + dby * dby), kLenFloor);
      emit(cross2(dax, day, dbx, dby) / (la * lb));
      return true;
    }
    case SketchConstraintKind::Perpendicular: {
      double dax = 0, day = 0, dbx = 0, dby = 0;
      if (!resolveDirection(s, x, k.a.entity, dax, day)) return false;
      if (!resolveDirection(s, x, k.b.entity, dbx, dby)) return false;
      const double la = std::max(std::sqrt(dax * dax + day * day), kLenFloor);
      const double lb = std::max(std::sqrt(dbx * dbx + dby * dby), kLenFloor);
      emit(dot2(dax, day, dbx, dby) / (la * lb));
      return true;
    }
    case SketchConstraintKind::Tangent: {
      double r1 = 0.0;
      if (!isCurve(s, k.a.entity)) return false;
      if (!resolveRadius(s, x, k.a.entity, r1)) return false;
      if (!resolvePoint(s, x, SketchRef{k.a.entity, SketchPointRole::Center}, ax, ay)) return false;
      if (isCurve(s, k.b.entity)) {
        double r2 = 0.0;
        if (!resolveRadius(s, x, k.b.entity, r2)) return false;
        if (!resolvePoint(s, x, SketchRef{k.b.entity, SketchPointRole::Center}, bx, by))
          return false;
        const double d = std::sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
        emit(k.internalTangent ? d - std::fabs(r1 - r2) : d - (r1 + r2));
        return true;
      }
      if (!isDirectional(s, k.b.entity)) return false;
      double dbx = 0, dby = 0;
      if (!resolveDirection(s, x, k.b.entity, dbx, dby)) return false;
      if (!resolvePoint(s, x, SketchRef{k.b.entity, SketchPointRole::Start}, bx, by)) return false;
      const double lb = std::max(std::sqrt(dbx * dbx + dby * dby), kLenFloor);
      // |perpendicular distance from the centre to the line| - r. The absolute
      // value has a kink only where the distance is zero, and tangency puts it
      // at r > 0, so the residual is smooth everywhere the solution is.
      emit(std::fabs(cross2(dbx, dby, ax - bx, ay - by)) / lb - r1);
      return true;
    }
    case SketchConstraintKind::Concentric: {
      if (!isCurve(s, k.a.entity) || !isCurve(s, k.b.entity)) return false;
      if (!resolvePoint(s, x, SketchRef{k.a.entity, SketchPointRole::Center}, ax, ay)) return false;
      if (!resolvePoint(s, x, SketchRef{k.b.entity, SketchPointRole::Center}, bx, by)) return false;
      emit(ax - bx);
      emit(ay - by);
      return true;
    }
    case SketchConstraintKind::Equal: {
      double va = 0.0, vb = 0.0;
      if (isCurve(s, k.a.entity) && isCurve(s, k.b.entity)) {
        if (!resolveRadius(s, x, k.a.entity, va) || !resolveRadius(s, x, k.b.entity, vb))
          return false;
        emit(va - vb);
        return true;
      }
      if (resolveLength(s, x, k.a.entity, va) && resolveLength(s, x, k.b.entity, vb)) {
        emit(va - vb);
        return true;
      }
      // Equal between a circle and a line has no meaning: a radius and a length
      // are both millimetres, and equating them is a coincidence of units, not a
      // constraint anybody drew.
      return false;
    }
    case SketchConstraintKind::Horizontal:
    case SketchConstraintKind::Vertical: {
      SketchRef ra{}, rb{};
      if (!endpointPair(s, k, ra, rb)) return false;
      if (!resolvePoint(s, x, ra, ax, ay) || !resolvePoint(s, x, rb, bx, by)) return false;
      emit(k.kind == SketchConstraintKind::Horizontal ? ay - by : ax - bx);
      return true;
    }
    case SketchConstraintKind::Symmetric: {
      if (!resolvePoint(s, x, k.a, ax, ay) || !resolvePoint(s, x, k.b, bx, by)) return false;
      double dx = 0, dy = 0;
      if (!resolveDirection(s, x, k.c.entity, dx, dy)) return false;
      if (!resolvePoint(s, x, SketchRef{k.c.entity, SketchPointRole::Start}, cx, cy)) return false;
      const double l = std::max(std::sqrt(dx * dx + dy * dy), kLenFloor);
      emit(dot2(bx - ax, by - ay, dx, dy) / l);                          // AB _|_ axis
      const double mx = 0.5 * (ax + bx), my = 0.5 * (ay + by);
      emit(cross2(dx, dy, mx - cx, my - cy) / l);                        // midpoint on axis
      return true;
    }
    case SketchConstraintKind::Fix: {
      if (!resolvePoint(s, x, k.a, ax, ay)) return false;
      emit(ax - k.fixX);
      emit(ay - k.fixY);
      return true;
    }
    case SketchConstraintKind::Distance: {
      if (!resolvePoint(s, x, k.a, ax, ay)) return false;
      // point-to-LINE distance when the second operand is a whole curve. This is
      // the dimension a user draws between a hole centre and an edge, and
      // without it they have to invent a construction point on the edge first.
      if (k.b.role == SketchPointRole::Self && isDirectional(s, k.b.entity)) {
        double dx = 0, dy = 0;
        if (!resolveDirection(s, x, k.b.entity, dx, dy)) return false;
        if (!resolvePoint(s, x, SketchRef{k.b.entity, SketchPointRole::Start}, bx, by))
          return false;
        const double l = std::max(std::sqrt(dx * dx + dy * dy), kLenFloor);
        emit(std::fabs(cross2(dx, dy, ax - bx, ay - by)) / l - k.value);
        return true;
      }
      if (!resolvePoint(s, x, k.b, bx, by)) return false;
      emit(std::sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)) - k.value);
      return true;
    }
    case SketchConstraintKind::Angle: {
      double dax = 0, day = 0, dbx = 0, dby = 0;
      if (!resolveDirection(s, x, k.a.entity, dax, day)) return false;
      if (!resolveDirection(s, x, k.b.entity, dbx, dby)) return false;
      const double theta = std::atan2(cross2(dax, day, dbx, dby), dot2(dax, day, dbx, dby));
      emit(wrapToPi(theta - k.value * kPi / 180.0));
      return true;
    }
    case SketchConstraintKind::Radius: {
      double r = 0.0;
      if (!resolveRadius(s, x, k.a.entity, r)) return false;
      emit(r - k.value);
      return true;
    }
    case SketchConstraintKind::Diameter: {
      double r = 0.0;
      if (!resolveRadius(s, x, k.a.entity, r)) return false;
      emit(2.0 * r - k.value);
      return true;
    }
  }
  return false;
}

// ── dense linear algebra, n is small ────────────────────────────────────────
// Gaussian elimination with partial pivoting. Returns false on a singular
// system rather than producing a vector of infinities: the caller answers a
// singular normal-equation matrix by raising lambda, which is exactly what
// Levenberg damping is for.
bool solveLinear(std::vector<double>& a, std::vector<double>& b, std::size_t n) {
  for (std::size_t col = 0; col < n; ++col) {
    std::size_t pivot = col;
    double best = std::fabs(a[col * n + col]);
    for (std::size_t row = col + 1; row < n; ++row) {
      const double v = std::fabs(a[row * n + col]);
      if (v > best) { best = v; pivot = row; }
    }
    if (!(best > 1e-300)) return false;
    if (pivot != col) {
      for (std::size_t j = 0; j < n; ++j) std::swap(a[col * n + j], a[pivot * n + j]);
      std::swap(b[col], b[pivot]);
    }
    const double d = a[col * n + col];
    for (std::size_t row = col + 1; row < n; ++row) {
      const double f = a[row * n + col] / d;
      if (f == 0.0) continue;
      for (std::size_t j = col; j < n; ++j) a[row * n + j] -= f * a[col * n + j];
      b[row] -= f * b[col];
    }
  }
  for (std::size_t i = n; i > 0; --i) {
    const std::size_t row = i - 1;
    double acc = b[row];
    for (std::size_t j = row + 1; j < n; ++j) acc -= a[row * n + j] * b[j];
    b[row] = acc / a[row * n + row];
  }
  for (std::size_t i = 0; i < n; ++i) {
    if (!std::isfinite(b[i])) return false;
  }
  return true;
}

double norm2(const std::vector<double>& v) {
  double acc = 0.0;
  for (double e : v) acc += e * e;
  return std::sqrt(acc);
}

double normInf(const std::vector<double>& v) {
  double acc = 0.0;
  for (double e : v) acc = std::max(acc, std::fabs(e));
  return acc;
}

}  // namespace

// ── spellings ───────────────────────────────────────────────────────────────
const char* toString(SketchConstraintKind kind) noexcept {
  switch (kind) {
    case SketchConstraintKind::Coincident:    return "coincident";
    case SketchConstraintKind::Collinear:     return "collinear";
    case SketchConstraintKind::Parallel:      return "parallel";
    case SketchConstraintKind::Perpendicular: return "perpendicular";
    case SketchConstraintKind::Tangent:       return "tangent";
    case SketchConstraintKind::Concentric:    return "concentric";
    case SketchConstraintKind::Equal:         return "equal";
    case SketchConstraintKind::Horizontal:    return "horizontal";
    case SketchConstraintKind::Vertical:      return "vertical";
    case SketchConstraintKind::Symmetric:     return "symmetric";
    case SketchConstraintKind::Fix:           return "fix";
    case SketchConstraintKind::Distance:      return "distance";
    case SketchConstraintKind::Angle:         return "angle";
    case SketchConstraintKind::Radius:        return "radius";
    case SketchConstraintKind::Diameter:      return "diameter";
  }
  return "coincident";
}

const char* toString(SketchStatus status) noexcept {
  switch (status) {
    case SketchStatus::UnderConstrained: return "under_constrained";
    case SketchStatus::FullyConstrained: return "fully_constrained";
    case SketchStatus::OverConstrained:  return "over_constrained";
    case SketchStatus::Conflicting:      return "conflicting";
    case SketchStatus::Malformed:        return "malformed";
  }
  return "under_constrained";
}

// ── factories ───────────────────────────────────────────────────────────────
namespace {
SketchConstraint make(SketchConstraintKind kind, std::string name) {
  SketchConstraint k;
  k.kind = kind;
  k.name = std::move(name);
  return k;
}
}  // namespace

SketchConstraint coincident(SketchRef a, SketchRef b, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Coincident, std::move(name));
  k.a = a;
  k.b = b;
  return k;
}
SketchConstraint collinear(int lineA, int lineB, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Collinear, std::move(name));
  k.a = sketchRef(lineA);
  k.b = sketchRef(lineB);
  return k;
}
SketchConstraint parallel(int a, int b, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Parallel, std::move(name));
  k.a = sketchRef(a);
  k.b = sketchRef(b);
  return k;
}
SketchConstraint perpendicular(int a, int b, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Perpendicular, std::move(name));
  k.a = sketchRef(a);
  k.b = sketchRef(b);
  return k;
}
SketchConstraint tangent(int curve, int other, bool internal, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Tangent, std::move(name));
  k.a = sketchRef(curve);
  k.b = sketchRef(other);
  k.internalTangent = internal;
  return k;
}
SketchConstraint concentric(int a, int b, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Concentric, std::move(name));
  k.a = sketchRef(a);
  k.b = sketchRef(b);
  return k;
}
SketchConstraint equal(int a, int b, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Equal, std::move(name));
  k.a = sketchRef(a);
  k.b = sketchRef(b);
  return k;
}
SketchConstraint horizontal(SketchRef a, SketchRef b, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Horizontal, std::move(name));
  k.a = a;
  k.b = b;
  return k;
}
SketchConstraint vertical(SketchRef a, SketchRef b, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Vertical, std::move(name));
  k.a = a;
  k.b = b;
  return k;
}
SketchConstraint symmetric(SketchRef a, SketchRef b, int axisLine, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Symmetric, std::move(name));
  k.a = a;
  k.b = b;
  k.c = sketchRef(axisLine);
  return k;
}
SketchConstraint fixPoint(SketchRef a, double x, double y, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Fix, std::move(name));
  k.a = a;
  k.fixX = x;
  k.fixY = y;
  return k;
}
SketchConstraint distance(SketchRef a, SketchRef b, double mm, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Distance, std::move(name));
  k.a = a;
  k.b = b;
  k.value = mm;
  return k;
}
SketchConstraint angleBetween(int lineA, int lineB, double degrees, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Angle, std::move(name));
  k.a = sketchRef(lineA);
  k.b = sketchRef(lineB);
  k.value = degrees;
  return k;
}
SketchConstraint radius(int curve, double mm, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Radius, std::move(name));
  k.a = sketchRef(curve);
  k.value = mm;
  return k;
}
SketchConstraint diameter(int curve, double mm, std::string name) {
  SketchConstraint k = make(SketchConstraintKind::Diameter, std::move(name));
  k.a = sketchRef(curve);
  k.value = mm;
  return k;
}

std::size_t sketchResidualCount(const Sketch& sketch, const SketchConstraint& constraint) {
  const std::vector<double> x = sketch.parameters();
  std::vector<double> probe;
  if (!residualsOf(sketch, constraint, x, &probe)) return 0;
  return probe.size();
}

bool evaluateSketchResiduals(const Sketch& sketch,
                             const std::vector<SketchConstraint>& constraints,
                             const std::vector<double>& params, std::vector<double>& out) {
  out.clear();
  if (params.size() != sketch.paramCount()) return false;
  bool allWellFormed = true;
  for (const SketchConstraint& k : constraints) {
    if (!residualsOf(sketch, k, params, &out)) allWellFormed = false;
  }
  return allWellFormed;
}

bool sketchJacobian(const Sketch& sketch, const std::vector<SketchConstraint>& constraints,
                    const std::vector<double>& params, double step, std::vector<double>& out,
                    std::size_t& rows, std::size_t& cols) {
  std::vector<double> base;
  evaluateSketchResiduals(sketch, constraints, params, base);
  rows = base.size();
  cols = params.size();
  out.assign(rows * cols, 0.0);
  if (rows == 0 || cols == 0) return true;

  std::vector<double> plus, minus, x = params;
  for (std::size_t j = 0; j < cols; ++j) {
    // Per-parameter step. One absolute h cannot serve both a coordinate of 250
    // and an angle of 0.02: too large and the derivative is of the wrong
    // function, too small and it is of rounding noise.
    const double h = step * std::max(1.0, std::fabs(params[j]));
    x[j] = params[j] + h;
    evaluateSketchResiduals(sketch, constraints, x, plus);
    x[j] = params[j] - h;
    evaluateSketchResiduals(sketch, constraints, x, minus);
    x[j] = params[j];
    if (plus.size() != rows || minus.size() != rows) return false;
    const double inv = 1.0 / (2.0 * h);
    for (std::size_t i = 0; i < rows; ++i) out[i * cols + j] = (plus[i] - minus[i]) * inv;
  }
  return true;
}

std::size_t matrixRank(const std::vector<double>& m, std::size_t rows, std::size_t cols,
                       double tolerance, std::vector<std::size_t>& dependentRows) {
  dependentRows.clear();
  if (rows == 0 || cols == 0) return 0;

  // Row scaling first. Left-multiplying by a non-singular diagonal cannot change
  // the rank, and without it a constraint whose gradient is naturally 1e-6 (an
  // angle in radians against a coordinate in millimetres) is indistinguishable
  // from a dependent row at any fixed tolerance.
  std::vector<double> work(m);
  for (std::size_t i = 0; i < rows; ++i) {
    double scale = 0.0;
    for (std::size_t j = 0; j < cols; ++j) scale = std::max(scale, std::fabs(work[i * cols + j]));
    if (!(scale > 0.0)) continue;
    for (std::size_t j = 0; j < cols; ++j) work[i * cols + j] /= scale;
  }

  std::vector<std::vector<double>> pivots;  // already reduced against each other
  std::vector<std::size_t> pivotCols;
  for (std::size_t i = 0; i < rows; ++i) {
    std::vector<double> row(work.begin() + static_cast<std::ptrdiff_t>(i * cols),
                            work.begin() + static_cast<std::ptrdiff_t>((i + 1) * cols));
    for (std::size_t p = 0; p < pivots.size(); ++p) {
      const double f = row[pivotCols[p]];
      if (f == 0.0) continue;
      for (std::size_t j = 0; j < cols; ++j) row[j] -= f * pivots[p][j];
    }
    std::size_t best = 0;
    double bestAbs = 0.0;
    for (std::size_t j = 0; j < cols; ++j) {
      const double v = std::fabs(row[j]);
      if (v > bestAbs) { bestAbs = v; best = j; }
    }
    if (bestAbs <= tolerance) {
      dependentRows.push_back(i);
      continue;
    }
    const double d = row[best];
    for (std::size_t j = 0; j < cols; ++j) row[j] /= d;
    pivots.push_back(std::move(row));
    pivotCols.push_back(best);
  }
  return pivots.size();
}

// ── the solve ───────────────────────────────────────────────────────────────
namespace {

// The Levenberg-Marquardt core, over a constraint list already known to be
// well-formed. Returns the best iterate it reached, always.
struct CoreResult {
  std::vector<double> x;
  std::vector<double> residuals;
  double norm = 0.0;
  double maxAbs = 0.0;
  std::size_t iterations = 0;
};

CoreResult runLevenbergMarquardt(const Sketch& sketch,
                                 const std::vector<SketchConstraint>& active,
                                 const std::vector<double>& start,
                                 const SketchSolverOptions& opt) {
  CoreResult best;
  best.x = start;
  evaluateSketchResiduals(sketch, active, best.x, best.residuals);
  best.norm = norm2(best.residuals);
  best.maxAbs = normInf(best.residuals);

  const std::size_t n = start.size();
  const std::size_t m = best.residuals.size();
  if (n == 0 || m == 0) return best;

  std::vector<double> x = best.x;
  std::vector<double> r = best.residuals;
  double curNorm = best.norm;
  double lambda = opt.initialLambda;

  std::vector<double> jac, jtj, jtr, a, delta, candidate, rNew;
  std::size_t rows = 0, cols = 0;

  for (std::size_t iter = 0; iter < opt.maxIterations; ++iter) {
    if (normInf(r) <= opt.tolerance) break;
    if (!sketchJacobian(sketch, active, x, opt.jacobianStep, jac, rows, cols)) break;
    if (rows != m || cols != n) break;

    jtj.assign(n * n, 0.0);
    jtr.assign(n, 0.0);
    for (std::size_t i = 0; i < m; ++i) {
      for (std::size_t p = 0; p < n; ++p) {
        const double jip = jac[i * n + p];
        if (jip == 0.0) continue;
        jtr[p] += jip * r[i];
        for (std::size_t q = p; q < n; ++q) jtj[p * n + q] += jip * jac[i * n + q];
      }
    }
    for (std::size_t p = 0; p < n; ++p) {
      for (std::size_t q = 0; q < p; ++q) jtj[p * n + q] = jtj[q * n + p];
    }

    bool stepped = false;
    double stepLen = 0.0;
    for (int attempt = 0; attempt < 16; ++attempt) {
      a = jtj;
      for (std::size_t p = 0; p < n; ++p) {
        // Marquardt's own scaling: damp each parameter in proportion to its own
        // curvature, so a radius in mm and an angle in radians are damped alike.
        // The floor keeps a parameter no residual depends on from making the
        // system singular for ever.
        a[p * n + p] += lambda * std::max(jtj[p * n + p], 1e-12);
      }
      delta = jtr;
      for (double& v : delta) v = -v;
      if (!solveLinear(a, delta, n)) {
        lambda *= 10.0;
        continue;
      }
      candidate = x;
      for (std::size_t p = 0; p < n; ++p) candidate[p] += delta[p];
      evaluateSketchResiduals(sketch, active, candidate, rNew);
      const double newNorm = norm2(rNew);
      if (std::isfinite(newNorm) && newNorm < curNorm) {
        stepLen = norm2(delta);
        x.swap(candidate);
        r.swap(rNew);
        curNorm = newNorm;
        lambda = std::max(lambda / 3.0, 1e-14);
        stepped = true;
        break;
      }
      lambda *= 3.0;
    }
    ++best.iterations;

    if (curNorm < best.norm) {
      best.norm = curNorm;
      best.maxAbs = normInf(r);
      best.x = x;
      best.residuals = r;
    }
    if (!stepped) break;                       // no descent direction remains
    if (stepLen <= opt.stepTolerance) break;   // converged, or stuck at a floor
  }
  return best;
}

}  // namespace

SketchSolveResult solveSketch(Sketch& sketch, const std::vector<SketchConstraint>& constraints,
                              const SketchSolverOptions& options) {
  SketchSolveResult out;
  const std::vector<double> start = sketch.parameters();
  out.freeParameters = start.size();
  out.parameters = start;

  // 1. split well-formed from malformed. A malformed constraint is SKIPPED, not
  //    fatal: forty good constraints must not be lost to one that names a
  //    deleted entity.
  std::vector<SketchConstraint> active;
  std::vector<std::size_t> activeIndex;   // active slot -> caller's index
  for (std::size_t i = 0; i < constraints.size(); ++i) {
    if (sketchResidualCount(sketch, constraints[i]) == 0) {
      out.malformed.push_back(i);
      continue;
    }
    active.push_back(constraints[i]);
    activeIndex.push_back(i);
  }

  // 2. which constraint owns which residual row, so every diagnosis below can
  //    be reported by CONSTRAINT rather than by row number.
  std::vector<std::size_t> rowOwner;
  for (std::size_t s = 0; s < active.size(); ++s) {
    const std::size_t count = sketchResidualCount(sketch, active[s]);
    for (std::size_t k = 0; k < count; ++k) rowOwner.push_back(activeIndex[s]);
  }
  out.residuals = rowOwner.size();

  // 3. solve
  const CoreResult best = runLevenbergMarquardt(sketch, active, start, options);
  out.iterations = best.iterations;
  out.parameters = best.x;
  out.residualNorm = best.norm;
  out.maxResidual = best.maxAbs;
  out.converged = best.maxAbs <= options.tolerance;
  sketch.setParameters(best.x);

  // 4. rank and degrees of freedom, at the iterate actually returned
  std::vector<double> jac;
  std::size_t rows = 0, cols = 0;
  std::vector<std::size_t> dependentRows;
  if (sketchJacobian(sketch, active, best.x, options.jacobianStep, jac, rows, cols)) {
    out.rank = matrixRank(jac, rows, cols, options.rankTolerance, dependentRows);
  }
  out.degreesOfFreedom = out.freeParameters > out.rank ? out.freeParameters - out.rank : 0;

  for (std::size_t row : dependentRows) {
    if (row >= rowOwner.size()) continue;
    const std::size_t owner = rowOwner[row];
    if (std::find(out.redundant.begin(), out.redundant.end(), owner) == out.redundant.end()) {
      out.redundant.push_back(owner);
    }
  }

  // 5. conflict diagnosis — only when the residual could NOT be driven to zero,
  //    because a redundant-but-consistent sketch is solved and has nothing to
  //    locate. A constraint whose removal lets the rest converge is a member of
  //    a minimal conflicting set, which is the actionable answer: drop one of
  //    these and the sketch solves.
  if (!out.converged && options.diagnoseConflicts && active.size() <= options.diagnosisLimit) {
    SketchSolverOptions sub = options;
    sub.diagnoseConflicts = false;
    for (std::size_t s = 0; s < active.size(); ++s) {
      std::vector<SketchConstraint> without;
      without.reserve(active.size() - 1);
      for (std::size_t t = 0; t < active.size(); ++t) {
        if (t != s) without.push_back(active[t]);
      }
      // From the ORIGINAL start point, not from the failed iterate: a solve
      // launched from where a conflict left the geometry answers a different
      // question than "would this have solved without that constraint".
      const CoreResult attempt = runLevenbergMarquardt(sketch, without, start, sub);
      if (attempt.maxAbs <= options.tolerance) out.conflicting.push_back(activeIndex[s]);
    }
  }
  if (!out.converged && out.conflicting.empty()) {
    // No single removal fixed it (or diagnosis was skipped). Name the
    // constraints that are actually unsatisfied instead of saying nothing: a
    // report with no names is what forces a user to delete the sketch.
    std::size_t row = 0;
    for (std::size_t s = 0; s < active.size(); ++s) {
      const std::size_t count = sketchResidualCount(sketch, active[s]);
      double worst = 0.0;
      for (std::size_t k = 0; k < count && row + k < best.residuals.size(); ++k) {
        worst = std::max(worst, std::fabs(best.residuals[row + k]));
      }
      row += count;
      if (worst > options.tolerance) out.conflicting.push_back(activeIndex[s]);
    }
  }

  // 6. the headline. The vectors above carry the whole truth; this is the one
  //    word a status strip shows, and the precedence is worst-first.
  if (!out.malformed.empty()) {
    out.status = SketchStatus::Malformed;
  } else if (!out.converged) {
    out.status = SketchStatus::Conflicting;
  } else if (!out.redundant.empty()) {
    out.status = SketchStatus::OverConstrained;
  } else if (out.degreesOfFreedom > 0) {
    out.status = SketchStatus::UnderConstrained;
  } else {
    out.status = SketchStatus::FullyConstrained;
  }

  out.detail = std::string(toString(out.status)) + ": " + std::to_string(out.freeParameters) +
               " parameters, rank " + std::to_string(out.rank) + ", " +
               std::to_string(out.degreesOfFreedom) + " dof, " + std::to_string(out.residuals) +
               " residuals, max |r| = " + std::to_string(out.maxResidual);
  return out;
}

}  // namespace forge::ui
