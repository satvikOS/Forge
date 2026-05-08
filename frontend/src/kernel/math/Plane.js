/**
 * ArchDisc Geometry Kernel — Plane
 * Infinite plane defined by normal and distance from origin.
 * Equation: normal · point = d
 */

import Vec3, { EPSILON } from './Vec3.js';

export default class Plane {
  constructor(normal, d) {
    this.normal = normal.normalize();
    this.d = d;
  }

  static fromNormalAndPoint(normal, point) {
    const n = normal.normalize();
    return new Plane(n, n.dot(point));
  }

  static fromThreePoints(a, b, c) {
    const normal = b.sub(a).cross(c.sub(a)).normalize();
    return new Plane(normal, normal.dot(a));
  }

  static XY() { return new Plane(Vec3.unitZ(), 0); }
  static XZ() { return new Plane(Vec3.unitY(), 0); }
  static YZ() { return new Plane(Vec3.unitX(), 0); }

  clone() { return new Plane(this.normal.clone(), this.d); }

  distanceToPoint(point) {
    return this.normal.dot(point) - this.d;
  }

  projectPoint(point) {
    return point.sub(this.normal.mul(this.distanceToPoint(point)));
  }

  containsPoint(point, eps = EPSILON) {
    return Math.abs(this.distanceToPoint(point)) < eps;
  }

  side(point, eps = EPSILON) {
    const dist = this.distanceToPoint(point);
    if (dist > eps) return 1;    // front
    if (dist < -eps) return -1;  // back
    return 0;                     // on plane
  }

  intersectLine(lineStart, lineEnd) {
    const dir = lineEnd.sub(lineStart);
    const denom = this.normal.dot(dir);
    if (Math.abs(denom) < EPSILON) return null; // parallel
    const t = (this.d - this.normal.dot(lineStart)) / denom;
    return { point: lineStart.add(dir.mul(t)), t };
  }

  intersectRay(origin, direction) {
    const denom = this.normal.dot(direction);
    if (Math.abs(denom) < EPSILON) return null;
    const t = (this.d - this.normal.dot(origin)) / denom;
    if (t < 0) return null;
    return { point: origin.add(direction.mul(t)), t };
  }

  intersectPlane(other) {
    const dir = this.normal.cross(other.normal);
    if (dir.isZero()) return null; // parallel

    const denom = dir.lengthSq();
    const point = dir.cross(other.normal).mul(this.d)
      .add(this.normal.cross(dir).mul(other.d))
      .div(denom);

    return { point, direction: dir.normalize() };
  }

  flip() {
    return new Plane(this.normal.negate(), -this.d);
  }

  transform(mat4) {
    const origin = this.normal.mul(this.d);
    const newOrigin = mat4.transformPoint(origin);
    const newNormal = mat4.transformNormal(this.normal);
    return Plane.fromNormalAndPoint(newNormal, newOrigin);
  }
}
