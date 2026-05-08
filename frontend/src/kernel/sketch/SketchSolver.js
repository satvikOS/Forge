/**
 * ArchDisc Geometry Kernel — Sketch Constraint Solver
 * 2D constraint solver for parametric sketches.
 * Supports: coincident, parallel, perpendicular, tangent, equal, horizontal, vertical,
 *           distance, angle, radius, fixed, symmetric, midpoint.
 * Uses iterative Newton-Raphson approach.
 */

const EPSILON = 1e-8;
const MAX_ITERATIONS = 100;
const CONVERGENCE = 1e-10;

export class SketchPoint {
  constructor(x, y, fixed = false) {
    this.id = SketchPoint._nextId++;
    this.type = 'point';
    this.x = x;
    this.y = y;
    this.fixed = fixed;
  }
  distanceTo(other) {
    const dx = this.x - other.x, dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  clone() { return new SketchPoint(this.x, this.y, this.fixed); }
}
SketchPoint._nextId = 1;

export class SketchLine {
  constructor(p1, p2) {
    this.id = SketchLine._nextId++;
    this.type = 'line';
    this.p1 = p1;
    this.p2 = p2;
  }
  length() { return this.p1.distanceTo(this.p2); }
  midpoint() { return new SketchPoint((this.p1.x + this.p2.x) / 2, (this.p1.y + this.p2.y) / 2); }
  dx() { return this.p2.x - this.p1.x; }
  dy() { return this.p2.y - this.p1.y; }
  angle() { return Math.atan2(this.dy(), this.dx()); }
}
SketchLine._nextId = 1;

export class SketchCircle {
  constructor(center, radius) {
    this.id = SketchCircle._nextId++;
    this.type = 'circle';
    this.center = center;
    this.radius = radius;
  }
}
SketchCircle._nextId = 1;

export class SketchArc {
  constructor(center, startPoint, endPoint) {
    this.id = SketchArc._nextId++;
    this.type = 'arc';
    this.center = center;
    this.startPoint = startPoint;
    this.endPoint = endPoint;
  }
  radius() { return this.center.distanceTo(this.startPoint); }
}
SketchArc._nextId = 1;

// --- Constraints ---

class Constraint {
  constructor(type, entities, value) {
    this.id = Constraint._nextId++;
    this.type = type;
    this.entities = entities;
    this.value = value;
    this.weight = 1.0;
  }

  error() { return 0; }
}
Constraint._nextId = 1;

class CoincidentConstraint extends Constraint {
  constructor(p1, p2) { super('coincident', [p1, p2]); }
  error() {
    const [p1, p2] = this.entities;
    return (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
  }
}

class DistanceConstraint extends Constraint {
  constructor(p1, p2, distance) { super('distance', [p1, p2], distance); }
  error() {
    const [p1, p2] = this.entities;
    const d = p1.distanceTo(p2);
    return (d - this.value) ** 2;
  }
}

class HorizontalConstraint extends Constraint {
  constructor(line) { super('horizontal', [line]); }
  error() {
    const [line] = this.entities;
    return (line.p1.y - line.p2.y) ** 2;
  }
}

class VerticalConstraint extends Constraint {
  constructor(line) { super('vertical', [line]); }
  error() {
    const [line] = this.entities;
    return (line.p1.x - line.p2.x) ** 2;
  }
}

class ParallelConstraint extends Constraint {
  constructor(line1, line2) { super('parallel', [line1, line2]); }
  error() {
    const [l1, l2] = this.entities;
    const cross = l1.dx() * l2.dy() - l1.dy() * l2.dx();
    return cross ** 2;
  }
}

class PerpendicularConstraint extends Constraint {
  constructor(line1, line2) { super('perpendicular', [line1, line2]); }
  error() {
    const [l1, l2] = this.entities;
    const dot = l1.dx() * l2.dx() + l1.dy() * l2.dy();
    return dot ** 2;
  }
}

class EqualLengthConstraint extends Constraint {
  constructor(line1, line2) { super('equal', [line1, line2]); }
  error() {
    const [l1, l2] = this.entities;
    return (l1.length() - l2.length()) ** 2;
  }
}

class AngleConstraint extends Constraint {
  constructor(line1, line2, angle) { super('angle', [line1, line2], angle); }
  error() {
    const [l1, l2] = this.entities;
    const a1 = l1.angle();
    const a2 = l2.angle();
    let diff = a2 - a1 - this.value;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff ** 2;
  }
}

class RadiusConstraint extends Constraint {
  constructor(circle, radius) { super('radius', [circle], radius); }
  error() {
    const [c] = this.entities;
    const r = c.type === 'circle' ? c.radius : c.radius();
    return (r - this.value) ** 2;
  }
}

class FixedConstraint extends Constraint {
  constructor(point, x, y) { super('fixed', [point], { x, y }); }
  error() {
    const [p] = this.entities;
    return (p.x - this.value.x) ** 2 + (p.y - this.value.y) ** 2;
  }
}

class SymmetricConstraint extends Constraint {
  constructor(p1, p2, line) { super('symmetric', [p1, p2, line]); }
  error() {
    const [p1, p2, line] = this.entities;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    // Midpoint should lie on the symmetry line
    const dx = line.dx(), dy = line.dy();
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < EPSILON) return 0;
    // Distance from midpoint to line
    const dist = Math.abs(dy * (mx - line.p1.x) - dx * (my - line.p1.y)) / len;
    // P1-P2 should be perpendicular to line
    const dot = (p2.x - p1.x) * dx + (p2.y - p1.y) * dy;
    return dist ** 2 + (dot / (len * p1.distanceTo(p2) + EPSILON)) ** 2;
  }
}

class MidpointConstraint extends Constraint {
  constructor(point, line) { super('midpoint', [point, line]); }
  error() {
    const [p, line] = this.entities;
    const mx = (line.p1.x + line.p2.x) / 2;
    const my = (line.p1.y + line.p2.y) / 2;
    return (p.x - mx) ** 2 + (p.y - my) ** 2;
  }
}

class TangentConstraint extends Constraint {
  constructor(entity1, entity2) { super('tangent', [entity1, entity2]); }
  error() {
    const [e1, e2] = this.entities;
    if (e1.type === 'line' && e2.type === 'circle') {
      return this._lineCircleTangent(e1, e2);
    }
    if (e1.type === 'circle' && e2.type === 'line') {
      return this._lineCircleTangent(e2, e1);
    }
    if (e1.type === 'circle' && e2.type === 'circle') {
      const d = e1.center.distanceTo(e2.center);
      const rSum = e1.radius + e2.radius;
      const rDiff = Math.abs(e1.radius - e2.radius);
      return Math.min((d - rSum) ** 2, (d - rDiff) ** 2);
    }
    return 0;
  }

  _lineCircleTangent(line, circle) {
    const dx = line.dx(), dy = line.dy();
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < EPSILON) return 0;
    const dist = Math.abs(dy * (circle.center.x - line.p1.x) - dx * (circle.center.y - line.p1.y)) / len;
    return (dist - circle.radius) ** 2;
  }
}

// --- Solver ---

export default class SketchSolver {
  constructor() {
    this.points = [];
    this.lines = [];
    this.circles = [];
    this.arcs = [];
    this.constraints = [];
  }

  addPoint(x, y, fixed = false) {
    const p = new SketchPoint(x, y, fixed);
    this.points.push(p);
    return p;
  }

  addLine(p1, p2) {
    const l = new SketchLine(p1, p2);
    this.lines.push(l);
    return l;
  }

  addCircle(center, radius) {
    const c = new SketchCircle(center, radius);
    this.circles.push(c);
    return c;
  }

  addArc(center, startPoint, endPoint) {
    const a = new SketchArc(center, startPoint, endPoint);
    this.arcs.push(a);
    return a;
  }

  // Constraint factories
  coincident(p1, p2) { const c = new CoincidentConstraint(p1, p2); this.constraints.push(c); return c; }
  distance(p1, p2, d) { const c = new DistanceConstraint(p1, p2, d); this.constraints.push(c); return c; }
  horizontal(line) { const c = new HorizontalConstraint(line); this.constraints.push(c); return c; }
  vertical(line) { const c = new VerticalConstraint(line); this.constraints.push(c); return c; }
  parallel(l1, l2) { const c = new ParallelConstraint(l1, l2); this.constraints.push(c); return c; }
  perpendicular(l1, l2) { const c = new PerpendicularConstraint(l1, l2); this.constraints.push(c); return c; }
  equalLength(l1, l2) { const c = new EqualLengthConstraint(l1, l2); this.constraints.push(c); return c; }
  angle(l1, l2, a) { const c = new AngleConstraint(l1, l2, a); this.constraints.push(c); return c; }
  radius(circle, r) { const c = new RadiusConstraint(circle, r); this.constraints.push(c); return c; }
  fixed(point) { const c = new FixedConstraint(point, point.x, point.y); this.constraints.push(c); return c; }
  symmetric(p1, p2, line) { const c = new SymmetricConstraint(p1, p2, line); this.constraints.push(c); return c; }
  midpoint(point, line) { const c = new MidpointConstraint(point, line); this.constraints.push(c); return c; }
  tangent(e1, e2) { const c = new TangentConstraint(e1, e2); this.constraints.push(c); return c; }

  removeConstraint(id) {
    this.constraints = this.constraints.filter(c => c.id !== id);
  }

  // --- Solve ---

  solve() {
    // Collect free variables (unfixed point coordinates + circle radii)
    const vars = [];
    const varMap = new Map(); // entity → [varIndex for x, varIndex for y]

    for (const p of this.points) {
      if (p.fixed) continue;
      varMap.set(p, { xi: vars.length, yi: vars.length + 1 });
      vars.push(p.x, p.y);
    }

    for (const c of this.circles) {
      varMap.set(c, { ri: vars.length });
      vars.push(c.radius);
    }

    if (vars.length === 0 || this.constraints.length === 0) {
      return { converged: true, error: 0, iterations: 0 };
    }

    // Gradient descent with adaptive step
    let stepSize = 0.5;
    let prevError = Infinity;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      // Compute total error
      let totalError = 0;
      for (const c of this.constraints) {
        totalError += c.error() * c.weight;
      }

      if (totalError < CONVERGENCE) {
        return { converged: true, error: totalError, iterations: iter };
      }

      // Compute gradient via finite differences
      const gradient = new Array(vars.length).fill(0);
      const h = 1e-7;

      for (let vi = 0; vi < vars.length; vi++) {
        const original = vars[vi];

        vars[vi] = original + h;
        this._applyVars(vars, varMap);
        let errPlus = 0;
        for (const c of this.constraints) errPlus += c.error() * c.weight;

        vars[vi] = original - h;
        this._applyVars(vars, varMap);
        let errMinus = 0;
        for (const c of this.constraints) errMinus += c.error() * c.weight;

        gradient[vi] = (errPlus - errMinus) / (2 * h);
        vars[vi] = original;
      }

      this._applyVars(vars, varMap);

      // Normalize gradient
      let gradNorm = 0;
      for (const g of gradient) gradNorm += g * g;
      gradNorm = Math.sqrt(gradNorm);

      if (gradNorm < EPSILON) break;

      // Adaptive step
      if (totalError < prevError) {
        stepSize = Math.min(stepSize * 1.1, 2.0);
      } else {
        stepSize *= 0.5;
      }
      prevError = totalError;

      // Update variables
      for (let vi = 0; vi < vars.length; vi++) {
        vars[vi] -= stepSize * gradient[vi] / gradNorm;
      }

      this._applyVars(vars, varMap);
    }

    let finalError = 0;
    for (const c of this.constraints) finalError += c.error() * c.weight;

    return { converged: finalError < 1e-6, error: finalError, iterations: MAX_ITERATIONS };
  }

  _applyVars(vars, varMap) {
    for (const p of this.points) {
      if (p.fixed) continue;
      const m = varMap.get(p);
      if (m) { p.x = vars[m.xi]; p.y = vars[m.yi]; }
    }
    for (const c of this.circles) {
      const m = varMap.get(c);
      if (m) { c.radius = Math.max(EPSILON, vars[m.ri]); }
    }
  }

  // --- DOF Analysis ---

  degreesOfFreedom() {
    let dof = 0;
    for (const p of this.points) {
      if (!p.fixed) dof += 2;
    }
    for (const c of this.circles) {
      dof += 1; // radius
    }

    // Each constraint removes DOF
    for (const c of this.constraints) {
      switch (c.type) {
        case 'coincident': dof -= 2; break;
        case 'distance': dof -= 1; break;
        case 'horizontal': dof -= 1; break;
        case 'vertical': dof -= 1; break;
        case 'parallel': dof -= 1; break;
        case 'perpendicular': dof -= 1; break;
        case 'equal': dof -= 1; break;
        case 'angle': dof -= 1; break;
        case 'radius': dof -= 1; break;
        case 'fixed': dof -= 2; break;
        case 'symmetric': dof -= 2; break;
        case 'midpoint': dof -= 2; break;
        case 'tangent': dof -= 1; break;
      }
    }

    return Math.max(0, dof);
  }

  isFullyConstrained() {
    return this.degreesOfFreedom() === 0;
  }

  isOverConstrained() {
    return this.degreesOfFreedom() < 0;
  }
}
