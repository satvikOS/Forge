/**
 * ArchDisc Geometry Kernel — BBox3
 * Axis-aligned bounding box for spatial queries and collision detection.
 */

import Vec3 from './Vec3.js';

export default class BBox3 {
  constructor(min, max) {
    this.min = min || new Vec3(Infinity, Infinity, Infinity);
    this.max = max || new Vec3(-Infinity, -Infinity, -Infinity);
  }

  static empty() { return new BBox3(); }

  static fromPoints(points) {
    const box = BBox3.empty();
    for (const p of points) box.expandByPoint(p);
    return box;
  }

  static fromCenterSize(center, size) {
    const half = size.mul(0.5);
    return new BBox3(center.sub(half), center.add(half));
  }

  clone() { return new BBox3(this.min.clone(), this.max.clone()); }

  isEmpty() {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }

  expandByPoint(p) {
    this.min = this.min.min(p);
    this.max = this.max.max(p);
    return this;
  }

  expandByBox(box) {
    this.min = this.min.min(box.min);
    this.max = this.max.max(box.max);
    return this;
  }

  expandByScalar(s) {
    const v = new Vec3(s, s, s);
    this.min = this.min.sub(v);
    this.max = this.max.add(v);
    return this;
  }

  center() { return this.min.add(this.max).mul(0.5); }
  size() { return this.max.sub(this.min); }
  diagonal() { return this.size().length(); }

  volume() {
    const s = this.size();
    return s.x * s.y * s.z;
  }

  surfaceArea() {
    const s = this.size();
    return 2 * (s.x * s.y + s.y * s.z + s.z * s.x);
  }

  containsPoint(p) {
    return p.x >= this.min.x && p.x <= this.max.x &&
           p.y >= this.min.y && p.y <= this.max.y &&
           p.z >= this.min.z && p.z <= this.max.z;
  }

  containsBox(box) {
    return this.containsPoint(box.min) && this.containsPoint(box.max);
  }

  intersectsBox(box) {
    return this.max.x >= box.min.x && this.min.x <= box.max.x &&
           this.max.y >= box.min.y && this.min.y <= box.max.y &&
           this.max.z >= box.min.z && this.min.z <= box.max.z;
  }

  intersection(box) {
    const min = this.min.max(box.min);
    const max = this.max.min(box.max);
    if (min.x > max.x || min.y > max.y || min.z > max.z) return BBox3.empty();
    return new BBox3(min, max);
  }

  union(box) {
    return new BBox3(this.min.min(box.min), this.max.max(box.max));
  }

  intersectRay(origin, direction) {
    let tmin = -Infinity, tmax = Infinity;
    const axes = ['x', 'y', 'z'];
    for (const axis of axes) {
      const invD = 1.0 / direction[axis];
      let t0 = (this.min[axis] - origin[axis]) * invD;
      let t1 = (this.max[axis] - origin[axis]) * invD;
      if (invD < 0) { const tmp = t0; t0 = t1; t1 = tmp; }
      tmin = Math.max(tmin, t0);
      tmax = Math.min(tmax, t1);
      if (tmax < tmin) return null;
    }
    return { tmin, tmax, point: origin.add(direction.mul(tmin)) };
  }

  transform(mat4) {
    if (this.isEmpty()) return BBox3.empty();
    const corners = [
      new Vec3(this.min.x, this.min.y, this.min.z),
      new Vec3(this.max.x, this.min.y, this.min.z),
      new Vec3(this.min.x, this.max.y, this.min.z),
      new Vec3(this.max.x, this.max.y, this.min.z),
      new Vec3(this.min.x, this.min.y, this.max.z),
      new Vec3(this.max.x, this.min.y, this.max.z),
      new Vec3(this.min.x, this.max.y, this.max.z),
      new Vec3(this.max.x, this.max.y, this.max.z),
    ];
    return BBox3.fromPoints(corners.map(c => mat4.transformPoint(c)));
  }
}
