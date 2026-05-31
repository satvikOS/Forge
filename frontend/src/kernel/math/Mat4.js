/**
 * ArchDisc Geometry Kernel — Mat4
 * 4x4 transformation matrix (column-major, OpenGL convention).
 * Used for transforms, projections, and coordinate system changes.
 */

import Vec3, { EPSILON } from './Vec3.js';

export default class Mat4 {
  constructor(elements) {
    // 16 elements in column-major order
    this.e = elements || [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ];
  }

  static identity() { return new Mat4(); }

  static translation(x, y, z) {
    return new Mat4([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1
    ]);
  }

  static scaling(x, y, z) {
    if (y === undefined) { y = x; z = x; }
    return new Mat4([
      x, 0, 0, 0,
      0, y, 0, 0,
      0, 0, z, 0,
      0, 0, 0, 1
    ]);
  }

  static rotationX(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return new Mat4([
      1, 0, 0, 0,
      0, c, s, 0,
      0, -s, c, 0,
      0, 0, 0, 1
    ]);
  }

  static rotationY(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return new Mat4([
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1
    ]);
  }

  static rotationZ(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return new Mat4([
      c, s, 0, 0,
      -s, c, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
  }

  static rotationAxis(axis, rad) {
    const n = axis.normalize();
    const c = Math.cos(rad), s = Math.sin(rad), t = 1 - c;
    const { x, y, z } = n;
    return new Mat4([
      t * x * x + c,     t * x * y + s * z, t * x * z - s * y, 0,
      t * x * y - s * z, t * y * y + c,     t * y * z + s * x, 0,
      t * x * z + s * y, t * y * z - s * x, t * z * z + c,     0,
      0, 0, 0, 1
    ]);
  }

  static lookAt(eye, target, up) {
    const z = eye.sub(target).normalize();
    const x = up.cross(z).normalize();
    const y = z.cross(x);
    return new Mat4([
      x.x, y.x, z.x, 0,
      x.y, y.y, z.y, 0,
      x.z, y.z, z.z, 0,
      -x.dot(eye), -y.dot(eye), -z.dot(eye), 1
    ]);
  }

  clone() { return new Mat4([...this.e]); }

  multiply(m) {
    const a = this.e, b = m.e, r = new Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        r[col * 4 + row] =
          a[0 * 4 + row] * b[col * 4 + 0] +
          a[1 * 4 + row] * b[col * 4 + 1] +
          a[2 * 4 + row] * b[col * 4 + 2] +
          a[3 * 4 + row] * b[col * 4 + 3];
      }
    }
    return new Mat4(r);
  }

  transformPoint(v) {
    const e = this.e;
    const w = e[3] * v.x + e[7] * v.y + e[11] * v.z + e[15];
    return new Vec3(
      (e[0] * v.x + e[4] * v.y + e[8]  * v.z + e[12]) / w,
      (e[1] * v.x + e[5] * v.y + e[9]  * v.z + e[13]) / w,
      (e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14]) / w
    );
  }

  transformDirection(v) {
    const e = this.e;
    return new Vec3(
      e[0] * v.x + e[4] * v.y + e[8]  * v.z,
      e[1] * v.x + e[5] * v.y + e[9]  * v.z,
      e[2] * v.x + e[6] * v.y + e[10] * v.z
    );
  }

  transformNormal(v) {
    const inv = this.inverse();
    if (!inv) return v;
    const e = inv.e;
    return new Vec3(
      e[0] * v.x + e[1] * v.y + e[2]  * v.z,
      e[4] * v.x + e[5] * v.y + e[6]  * v.z,
      e[8] * v.x + e[9] * v.y + e[10] * v.z
    ).normalize();
  }

  determinant() {
    const m = this.e;
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  }

  inverse() {
    const m = this.e;
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (Math.abs(det) < EPSILON) return null;

    const invDet = 1.0 / det;
    return new Mat4([
      (a11 * b11 - a12 * b10 + a13 * b09) * invDet,
      (a02 * b10 - a01 * b11 - a03 * b09) * invDet,
      (a31 * b05 - a32 * b04 + a33 * b03) * invDet,
      (a22 * b04 - a21 * b05 - a23 * b03) * invDet,
      (a12 * b08 - a10 * b11 - a13 * b07) * invDet,
      (a00 * b11 - a02 * b08 + a03 * b07) * invDet,
      (a32 * b02 - a30 * b05 - a33 * b01) * invDet,
      (a20 * b05 - a22 * b02 + a23 * b01) * invDet,
      (a10 * b10 - a11 * b08 + a13 * b06) * invDet,
      (a01 * b08 - a00 * b10 - a03 * b06) * invDet,
      (a30 * b04 - a31 * b02 + a33 * b00) * invDet,
      (a21 * b02 - a20 * b04 - a23 * b00) * invDet,
      (a11 * b07 - a10 * b09 - a12 * b06) * invDet,
      (a00 * b09 - a01 * b07 + a02 * b06) * invDet,
      (a31 * b01 - a30 * b03 - a32 * b00) * invDet,
      (a20 * b03 - a21 * b01 + a22 * b00) * invDet
    ]);
  }

  transpose() {
    const m = this.e;
    return new Mat4([
      m[0], m[4], m[8],  m[12],
      m[1], m[5], m[9],  m[13],
      m[2], m[6], m[10], m[14],
      m[3], m[7], m[11], m[15]
    ]);
  }

  getTranslation() {
    return new Vec3(this.e[12], this.e[13], this.e[14]);
  }

  getScale() {
    const e = this.e;
    return new Vec3(
      Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]),
      Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]),
      Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10])
    );
  }
}
