/**
 * ArchDisc Geometry Kernel — Curve
 * NURBS curves, arcs, lines, and circles.
 * Foundation for sketch geometry and edge definitions.
 */

import Vec3, { EPSILON } from './Vec3.js';

// --- Line Segment ---
export class LineCurve {
  constructor(start, end) {
    this.type = 'line';
    this.start = start;
    this.end = end;
  }

  pointAt(t) { return this.start.lerp(this.end, t); }
  tangentAt() { return this.end.sub(this.start).normalize(); }
  length() { return this.start.distanceTo(this.end); }
  midpoint() { return this.pointAt(0.5); }

  reverse() { return new LineCurve(this.end, this.start); }

  closestPointTo(point) {
    const ab = this.end.sub(this.start);
    const ap = point.sub(this.start);
    let t = ap.dot(ab) / ab.lengthSq();
    t = Math.max(0, Math.min(1, t));
    return { point: this.pointAt(t), t, distance: point.distanceTo(this.pointAt(t)) };
  }

  tessellate(segments = 1) {
    const pts = [];
    for (let i = 0; i <= segments; i++) pts.push(this.pointAt(i / segments));
    return pts;
  }

  transform(mat4) {
    return new LineCurve(mat4.transformPoint(this.start), mat4.transformPoint(this.end));
  }
}

// --- Circle / Arc ---
export class ArcCurve {
  constructor(center, radius, normal, startAngle = 0, endAngle = Math.PI * 2) {
    this.type = 'arc';
    this.center = center;
    this.radius = radius;
    this.normal = normal.normalize();
    this.startAngle = startAngle;
    this.endAngle = endAngle;
  }

  get isFull() { return Math.abs(this.endAngle - this.startAngle - Math.PI * 2) < EPSILON; }

  _basis() {
    let u = this.normal.isParallelTo(Vec3.unitX())
      ? Vec3.unitY().cross(this.normal).normalize()
      : Vec3.unitX().cross(this.normal).normalize();
    let v = this.normal.cross(u);
    return { u, v };
  }

  pointAt(t) {
    const angle = this.startAngle + (this.endAngle - this.startAngle) * t;
    const { u, v } = this._basis();
    return this.center
      .add(u.mul(Math.cos(angle) * this.radius))
      .add(v.mul(Math.sin(angle) * this.radius));
  }

  tangentAt(t) {
    const angle = this.startAngle + (this.endAngle - this.startAngle) * t;
    const { u, v } = this._basis();
    return u.mul(-Math.sin(angle))
      .add(v.mul(Math.cos(angle)))
      .normalize();
  }

  length() {
    return Math.abs(this.endAngle - this.startAngle) * this.radius;
  }

  tessellate(segmentsPerRadian = 16) {
    const sweep = Math.abs(this.endAngle - this.startAngle);
    const segments = Math.max(3, Math.ceil(sweep * segmentsPerRadian));
    const pts = [];
    for (let i = 0; i <= segments; i++) pts.push(this.pointAt(i / segments));
    return pts;
  }

  reverse() {
    return new ArcCurve(this.center, this.radius, this.normal, this.endAngle, this.startAngle);
  }

  transform(mat4) {
    const newCenter = mat4.transformPoint(this.center);
    const newNormal = mat4.transformNormal(this.normal);
    const scale = mat4.getScale();
    const avgScale = (scale.x + scale.y + scale.z) / 3;
    return new ArcCurve(newCenter, this.radius * avgScale, newNormal, this.startAngle, this.endAngle);
  }
}

// --- NURBS Curve ---
export class NurbsCurve {
  constructor(degree, controlPoints, weights, knots) {
    this.type = 'nurbs';
    this.degree = degree;
    this.controlPoints = controlPoints;
    this.weights = weights || controlPoints.map(() => 1);
    this.knots = knots || NurbsCurve._uniformKnots(degree, controlPoints.length);
  }

  static _uniformKnots(degree, n) {
    const m = n + degree + 1;
    const knots = [];
    for (let i = 0; i < m; i++) {
      if (i <= degree) knots.push(0);
      else if (i >= m - degree - 1) knots.push(1);
      else knots.push((i - degree) / (m - 2 * degree - 1));
    }
    return knots;
  }

  _basisFunction(i, p, u) {
    const knots = this.knots;
    if (p === 0) {
      return (u >= knots[i] && u < knots[i + 1]) ? 1 : 0;
    }
    let left = 0, right = 0;
    const dLeft = knots[i + p] - knots[i];
    const dRight = knots[i + p + 1] - knots[i + 1];
    if (dLeft > EPSILON) left = ((u - knots[i]) / dLeft) * this._basisFunction(i, p - 1, u);
    if (dRight > EPSILON) right = ((knots[i + p + 1] - u) / dRight) * this._basisFunction(i + 1, p - 1, u);
    return left + right;
  }

  pointAt(t) {
    // Clamp to avoid numerical issues at boundaries
    const u = Math.max(this.knots[this.degree], Math.min(t, this.knots[this.knots.length - this.degree - 1] - EPSILON));
    let point = Vec3.zero();
    let weightSum = 0;

    for (let i = 0; i < this.controlPoints.length; i++) {
      const basis = this._basisFunction(i, this.degree, u);
      const w = this.weights[i] * basis;
      point = point.add(this.controlPoints[i].mul(w));
      weightSum += w;
    }

    return weightSum > EPSILON ? point.div(weightSum) : this.controlPoints[0];
  }

  tangentAt(t, h = 1e-6) {
    const p0 = this.pointAt(Math.max(0, t - h));
    const p1 = this.pointAt(Math.min(1, t + h));
    return p1.sub(p0).normalize();
  }

  length(segments = 64) {
    let len = 0;
    let prev = this.pointAt(0);
    for (let i = 1; i <= segments; i++) {
      const curr = this.pointAt(i / segments);
      len += prev.distanceTo(curr);
      prev = curr;
    }
    return len;
  }

  tessellate(segments = 64) {
    const pts = [];
    for (let i = 0; i <= segments; i++) pts.push(this.pointAt(i / segments));
    return pts;
  }

  insertKnot(u) {
    const p = this.degree;
    const knots = [...this.knots];
    const cps = [...this.controlPoints];
    const ws = [...this.weights];

    let k = 0;
    for (let i = 0; i < knots.length - 1; i++) {
      if (u >= knots[i] && u < knots[i + 1]) { k = i; break; }
    }

    const newCps = [];
    const newWs = [];
    for (let i = 0; i <= k - p; i++) { newCps.push(cps[i]); newWs.push(ws[i]); }
    for (let i = k - p + 1; i <= k; i++) {
      const alpha = (u - knots[i]) / (knots[i + p] - knots[i]);
      newCps.push(cps[i - 1].mul(1 - alpha).add(cps[i].mul(alpha)));
      newWs.push(ws[i - 1] * (1 - alpha) + ws[i] * alpha);
    }
    for (let i = k; i < cps.length; i++) { newCps.push(cps[i]); newWs.push(ws[i]); }

    knots.splice(k + 1, 0, u);
    return new NurbsCurve(p, newCps, newWs, knots);
  }

  transform(mat4) {
    return new NurbsCurve(
      this.degree,
      this.controlPoints.map(p => mat4.transformPoint(p)),
      [...this.weights],
      [...this.knots]
    );
  }
}
