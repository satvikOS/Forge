/**
 * ArchDisc Geometry Kernel — Surface
 * NURBS surfaces, planar faces, cylindrical/spherical surfaces.
 * Foundation for face geometry in B-Rep.
 */

import Vec3, { EPSILON } from './Vec3.js';
import Plane from './Plane.js';

// --- Planar Surface ---
export class PlanarSurface {
  constructor(origin, uDir, vDir) {
    this.type = 'planar';
    this.origin = origin;
    this.uDir = uDir.normalize();
    this.vDir = vDir.normalize();
    this.normal = uDir.cross(vDir).normalize();
  }

  static fromPlane(plane) {
    let u = plane.normal.isParallelTo(Vec3.unitX())
      ? Vec3.unitY().cross(plane.normal).normalize()
      : Vec3.unitX().cross(plane.normal).normalize();
    let v = plane.normal.cross(u);
    return new PlanarSurface(plane.normal.mul(plane.d), u, v);
  }

  pointAt(u, v) {
    return this.origin.add(this.uDir.mul(u)).add(this.vDir.mul(v));
  }

  normalAt() { return this.normal; }

  toPlane() { return Plane.fromNormalAndPoint(this.normal, this.origin); }

  projectPoint(point) {
    const d = point.sub(this.origin);
    return { u: d.dot(this.uDir), v: d.dot(this.vDir) };
  }

  transform(mat4) {
    return new PlanarSurface(
      mat4.transformPoint(this.origin),
      mat4.transformDirection(this.uDir).normalize(),
      mat4.transformDirection(this.vDir).normalize()
    );
  }
}

// --- Cylindrical Surface ---
export class CylindricalSurface {
  constructor(origin, axis, radius) {
    this.type = 'cylindrical';
    this.origin = origin;
    this.axis = axis.normalize();
    this.radius = radius;
  }

  pointAt(angle, height) {
    const { u, v } = this._basis();
    return this.origin
      .add(this.axis.mul(height))
      .add(u.mul(Math.cos(angle) * this.radius))
      .add(v.mul(Math.sin(angle) * this.radius));
  }

  normalAt(angle) {
    const { u, v } = this._basis();
    return u.mul(Math.cos(angle)).add(v.mul(Math.sin(angle)));
  }

  _basis() {
    let u = this.axis.isParallelTo(Vec3.unitX())
      ? Vec3.unitY().cross(this.axis).normalize()
      : Vec3.unitX().cross(this.axis).normalize();
    let v = this.axis.cross(u);
    return { u, v };
  }

  transform(mat4) {
    const newOrigin = mat4.transformPoint(this.origin);
    const newAxis = mat4.transformDirection(this.axis).normalize();
    const scale = mat4.getScale();
    const avgScale = (scale.x + scale.y + scale.z) / 3;
    return new CylindricalSurface(newOrigin, newAxis, this.radius * avgScale);
  }
}

// --- Spherical Surface ---
export class SphericalSurface {
  constructor(center, radius) {
    this.type = 'spherical';
    this.center = center;
    this.radius = radius;
  }

  pointAt(theta, phi) {
    return new Vec3(
      this.center.x + this.radius * Math.sin(phi) * Math.cos(theta),
      this.center.y + this.radius * Math.cos(phi),
      this.center.z + this.radius * Math.sin(phi) * Math.sin(theta)
    );
  }

  normalAt(theta, phi) {
    return new Vec3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    );
  }

  transform(mat4) {
    const newCenter = mat4.transformPoint(this.center);
    const scale = mat4.getScale();
    const avgScale = (scale.x + scale.y + scale.z) / 3;
    return new SphericalSurface(newCenter, this.radius * avgScale);
  }
}

// --- Conical Surface ---
export class ConicalSurface {
  constructor(apex, axis, halfAngle) {
    this.type = 'conical';
    this.apex = apex;
    this.axis = axis.normalize();
    this.halfAngle = halfAngle;
  }

  pointAt(angle, height) {
    const r = height * Math.tan(this.halfAngle);
    const { u, v } = this._basis();
    return this.apex
      .add(this.axis.mul(height))
      .add(u.mul(Math.cos(angle) * r))
      .add(v.mul(Math.sin(angle) * r));
  }

  normalAt(angle, height) {
    const { u, v } = this._basis();
    const cosHA = Math.cos(this.halfAngle);
    const sinHA = Math.sin(this.halfAngle);
    return u.mul(Math.cos(angle) * cosHA)
      .add(v.mul(Math.sin(angle) * cosHA))
      .sub(this.axis.mul(sinHA))
      .normalize();
  }

  _basis() {
    let u = this.axis.isParallelTo(Vec3.unitX())
      ? Vec3.unitY().cross(this.axis).normalize()
      : Vec3.unitX().cross(this.axis).normalize();
    let v = this.axis.cross(u);
    return { u, v };
  }

  transform(mat4) {
    return new ConicalSurface(
      mat4.transformPoint(this.apex),
      mat4.transformDirection(this.axis).normalize(),
      this.halfAngle
    );
  }
}

// --- Toroidal Surface ---
export class ToroidalSurface {
  constructor(center, axis, majorRadius, minorRadius) {
    this.type = 'toroidal';
    this.center = center;
    this.axis = axis.normalize();
    this.majorRadius = majorRadius;
    this.minorRadius = minorRadius;
  }

  pointAt(u, v) {
    const { uDir, vDir } = this._basis();
    const ringCenter = this.center
      .add(uDir.mul(Math.cos(u) * this.majorRadius))
      .add(vDir.mul(Math.sin(u) * this.majorRadius));
    const radialDir = uDir.mul(Math.cos(u)).add(vDir.mul(Math.sin(u)));
    return ringCenter
      .add(radialDir.mul(Math.cos(v) * this.minorRadius))
      .add(this.axis.mul(Math.sin(v) * this.minorRadius));
  }

  normalAt(u, v) {
    const { uDir, vDir } = this._basis();
    const radialDir = uDir.mul(Math.cos(u)).add(vDir.mul(Math.sin(u)));
    return radialDir.mul(Math.cos(v)).add(this.axis.mul(Math.sin(v)));
  }

  _basis() {
    let uDir = this.axis.isParallelTo(Vec3.unitX())
      ? Vec3.unitY().cross(this.axis).normalize()
      : Vec3.unitX().cross(this.axis).normalize();
    let vDir = this.axis.cross(uDir);
    return { uDir, vDir };
  }

  transform(mat4) {
    const scale = mat4.getScale();
    const avgScale = (scale.x + scale.y + scale.z) / 3;
    return new ToroidalSurface(
      mat4.transformPoint(this.center),
      mat4.transformDirection(this.axis).normalize(),
      this.majorRadius * avgScale,
      this.minorRadius * avgScale
    );
  }
}
