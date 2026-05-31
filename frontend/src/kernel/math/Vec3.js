/**
 * ArchDisc Geometry Kernel — Vec3
 * High-precision 3D vector with CAD-grade operations.
 * All distances in meters, angles in radians.
 */

const EPSILON = 1e-10;

export default class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  static zero() { return new Vec3(0, 0, 0); }
  static unitX() { return new Vec3(1, 0, 0); }
  static unitY() { return new Vec3(0, 1, 0); }
  static unitZ() { return new Vec3(0, 0, 1); }

  static from(arr) { return new Vec3(arr[0], arr[1], arr[2]); }
  static fromObj(o) { return new Vec3(o.x || 0, o.y || 0, o.z || 0); }

  clone() { return new Vec3(this.x, this.y, this.z); }
  toArray() { return [this.x, this.y, this.z]; }
  toFixed(d = 6) { return new Vec3(+this.x.toFixed(d), +this.y.toFixed(d), +this.z.toFixed(d)); }

  // Arithmetic
  add(v) { return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z); }
  mul(s) { return new Vec3(this.x * s, this.y * s, this.z * s); }
  div(s) { return new Vec3(this.x / s, this.y / s, this.z / s); }
  negate() { return new Vec3(-this.x, -this.y, -this.z); }

  // In-place (for performance-critical loops)
  addInPlace(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  subInPlace(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  mulInPlace(s) { this.x *= s; this.y *= s; this.z *= s; return this; }

  // Products
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }

  cross(v) {
    return new Vec3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  // Magnitude
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }

  normalize() {
    const len = this.length();
    if (len < EPSILON) return Vec3.zero();
    return this.div(len);
  }

  normalizeInPlace() {
    const len = this.length();
    if (len < EPSILON) { this.x = 0; this.y = 0; this.z = 0; return this; }
    this.x /= len; this.y /= len; this.z /= len;
    return this;
  }

  // Distance
  distanceTo(v) { return this.sub(v).length(); }
  distanceToSq(v) { return this.sub(v).lengthSq(); }

  // Interpolation
  lerp(v, t) {
    return new Vec3(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t,
      this.z + (v.z - this.z) * t
    );
  }

  // Projection
  projectOnto(v) {
    const denom = v.lengthSq();
    if (denom < EPSILON) return Vec3.zero();
    return v.mul(this.dot(v) / denom);
  }

  projectOntoPlane(normal) {
    return this.sub(this.projectOnto(normal));
  }

  // Reflection
  reflect(normal) {
    return this.sub(normal.mul(2 * this.dot(normal)));
  }

  // Angle between vectors (radians)
  angleTo(v) {
    const denom = Math.sqrt(this.lengthSq() * v.lengthSq());
    if (denom < EPSILON) return 0;
    const cos = Math.max(-1, Math.min(1, this.dot(v) / denom));
    return Math.acos(cos);
  }

  // Component-wise operations
  min(v) { return new Vec3(Math.min(this.x, v.x), Math.min(this.y, v.y), Math.min(this.z, v.z)); }
  max(v) { return new Vec3(Math.max(this.x, v.x), Math.max(this.y, v.y), Math.max(this.z, v.z)); }
  abs() { return new Vec3(Math.abs(this.x), Math.abs(this.y), Math.abs(this.z)); }

  // Equality
  equals(v, eps = EPSILON) {
    return Math.abs(this.x - v.x) < eps &&
           Math.abs(this.y - v.y) < eps &&
           Math.abs(this.z - v.z) < eps;
  }

  isZero(eps = EPSILON) {
    return this.lengthSq() < eps * eps;
  }

  // Parallel / perpendicular checks
  isParallelTo(v, eps = EPSILON) {
    return this.cross(v).lengthSq() < eps * eps;
  }

  isPerpendicularTo(v, eps = EPSILON) {
    return Math.abs(this.dot(v)) < eps;
  }

  toString() { return `Vec3(${this.x}, ${this.y}, ${this.z})`; }
}

export { EPSILON };
