/**
 * Reference geometry — planes / axes / coordinate systems that exist in
 * the model space but never render as solid geometry. Sketches anchor
 * to ReferencePlanes; assemblies anchor to ReferenceCoordSystems;
 * features (extrudeAlongAxis, revolveAroundAxis, mirrorAcrossPlane)
 * accept refs by handle.
 *
 * No native dependency — pure JS objects. Serialised into project files
 * alongside the feature tree.
 */

let nextId = 1;

function uid() {
  return String(nextId++);
}

function normalize3(v) {
  const [x, y, z] = v;
  const len = Math.hypot(x, y, z);
  if (len < 1e-12) throw new Error('[forge.ref] zero-length vector');
  return [x / len, y / len, z / len];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

function sub3(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function add3(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function scale3(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }

// ----------------------------------------------------------------------------
// Parametric datum constructors (Slice-4). Each returns a plain
// {origin, normal} (planes) or {origin, direction} (axes) spec — caller wraps
// it in a ReferencePlane/ReferenceAxis (or hands it to the sketch session as a
// custom plane frame). Kept as free functions so they're trivially unit-test-
// able without the registry.
// ----------------------------------------------------------------------------

/** Plane parallel to `base` (a {origin,normal}) offset `distance` along its
 *  normal. distance>0 moves along +normal. */
export function offsetPlaneSpec(base, distance) {
  const n = normalize3(base.normal);
  return { origin: add3(base.origin, scale3(n, distance)), normal: n };
}

/** Plane through three non-collinear points. Normal = (p2-p1)×(p3-p1),
 *  origin = p1. Throws if the points are collinear. */
export function planeThrough3PointsSpec(p1, p2, p3) {
  const n = cross3(sub3(p2, p1), sub3(p3, p1));
  if (Math.hypot(n[0], n[1], n[2]) < 1e-9) {
    throw new Error('[forge.ref] planeThrough3Points: points are collinear');
  }
  return { origin: [...p1], normal: normalize3(n) };
}

/** Mid-plane halfway between two PARALLEL planes a and b (each {origin,
 *  normal}). Normal taken from a; origin is the midpoint of a.origin and b's
 *  projection. For non-parallel planes we still produce a usable bisector
 *  using a's normal. */
export function midPlaneSpec(a, b) {
  const n = normalize3(a.normal);
  const mid = scale3(add3(a.origin, b.origin), 0.5);
  return { origin: mid, normal: n };
}

/** Axis through two distinct points. */
export function axisFrom2PointsSpec(p1, p2) {
  const d = sub3(p2, p1);
  if (Math.hypot(d[0], d[1], d[2]) < 1e-9) {
    throw new Error('[forge.ref] axisFrom2Points: coincident points');
  }
  return { origin: [...p1], direction: normalize3(d) };
}

/** Axis along the intersection line of two non-parallel planes a, b
 *  (each {origin,normal}). Direction = na×nb; a point on the line is found
 *  by solving the 2-plane system. Throws if planes are parallel. */
export function axisFromPlaneIntersectionSpec(a, b) {
  const na = normalize3(a.normal), nb = normalize3(b.normal);
  const dir = cross3(na, nb);
  const dl = Math.hypot(dir[0], dir[1], dir[2]);
  if (dl < 1e-9) throw new Error('[forge.ref] axisFromPlaneIntersection: planes are parallel');
  const u = scale3(dir, 1 / dl);
  // Plane constants: na·x = da, nb·x = db.
  const da = dot3(na, a.origin);
  const db = dot3(nb, b.origin);
  // Solve for a point on the line: x = c1*na + c2*nb (component in the plane
  // spanned by the two normals). Using the standard formula.
  const nana = dot3(na, na), nanb = dot3(na, nb), nbnb = dot3(nb, nb);
  const det = nana * nbnb - nanb * nanb;
  const c1 = (da * nbnb - db * nanb) / det;
  const c2 = (db * nana - da * nanb) / det;
  const origin = add3(scale3(na, c1), scale3(nb, c2));
  return { origin, direction: u };
}

/** Plane: anchored at `origin`, oriented by unit `normal`. */
export class ReferencePlane {
  constructor({ origin = [0, 0, 0], normal, name }) {
    if (!normal) throw new Error('[forge.ref] ReferencePlane requires a normal');
    this.id = uid();
    this.kind = 'plane';
    this.name = name || `Plane-${this.id}`;
    this.origin = [...origin];
    this.normal = normalize3(normal);
    this.suppressed = false;
  }
  containsPoint(p, tol = 1e-6) {
    const d = (p[0] - this.origin[0]) * this.normal[0]
            + (p[1] - this.origin[1]) * this.normal[1]
            + (p[2] - this.origin[2]) * this.normal[2];
    return Math.abs(d) < tol;
  }
  serialize() {
    return { id: this.id, kind: this.kind, name: this.name,
             origin: this.origin, normal: this.normal, suppressed: this.suppressed };
  }
}

/** Axis: line through `origin` in direction `direction`. */
export class ReferenceAxis {
  constructor({ origin = [0, 0, 0], direction, name }) {
    if (!direction) throw new Error('[forge.ref] ReferenceAxis requires a direction');
    this.id = uid();
    this.kind = 'axis';
    this.name = name || `Axis-${this.id}`;
    this.origin = [...origin];
    this.direction = normalize3(direction);
    this.suppressed = false;
  }
  serialize() {
    return { id: this.id, kind: this.kind, name: this.name,
             origin: this.origin, direction: this.direction, suppressed: this.suppressed };
  }
}

/**
 * Coordinate system: right-handed orthonormal triad. Constructor takes
 * `xAxis` + `yAxis`; we Gram-Schmidt the y against the x, then cross
 * for z so the result is always orthonormal regardless of input.
 */
export class ReferenceCoordSystem {
  constructor({ origin = [0, 0, 0], xAxis, yAxis, name }) {
    if (!xAxis || !yAxis) throw new Error('[forge.ref] CSys requires xAxis + yAxis');
    const x = normalize3(xAxis);
    // Project yAxis-input onto the plane perpendicular to x.
    const dotXY = dot3(x, yAxis);
    const yRaw = [yAxis[0] - dotXY * x[0], yAxis[1] - dotXY * x[1], yAxis[2] - dotXY * x[2]];
    const y = normalize3(yRaw);
    const z = cross3(x, y); // unit by construction (x,y orthonormal)

    this.id = uid();
    this.kind = 'csys';
    this.name = name || `CSys-${this.id}`;
    this.origin = [...origin];
    this.xAxis = x;
    this.yAxis = y;
    this.zAxis = z;
    this.suppressed = false;
  }
  /** 4×4 row-major transform: local → world. */
  toMatrix() {
    return new Float64Array([
      this.xAxis[0], this.yAxis[0], this.zAxis[0], this.origin[0],
      this.xAxis[1], this.yAxis[1], this.zAxis[1], this.origin[1],
      this.xAxis[2], this.yAxis[2], this.zAxis[2], this.origin[2],
      0,             0,             0,             1,
    ]);
  }
  serialize() {
    return { id: this.id, kind: this.kind, name: this.name,
             origin: this.origin, xAxis: this.xAxis, yAxis: this.yAxis, zAxis: this.zAxis,
             suppressed: this.suppressed };
  }
}

/**
 * Collection of reference entities. Acts as the registry the rest of
 * the app talks to. Provides the 3 default planes + global origin
 * CSys on construction (so a blank part already has something to
 * anchor a first sketch on).
 */
export class ReferenceFrame {
  constructor() {
    this.entities = new Map();
    this._installDefaults();
  }
  _installDefaults() {
    const xy = new ReferencePlane({ normal: [0, 0, 1], name: 'Front Plane (XY)' });
    const xz = new ReferencePlane({ normal: [0, 1, 0], name: 'Top Plane (XZ)' });
    const yz = new ReferencePlane({ normal: [1, 0, 0], name: 'Right Plane (YZ)' });
    const origin = new ReferenceCoordSystem({
      xAxis: [1, 0, 0], yAxis: [0, 1, 0], name: 'Origin',
    });
    [xy, xz, yz, origin].forEach((e) => this.add(e));
  }
  add(entity) {
    this.entities.set(entity.id, entity);
    return entity;
  }
  remove(id) {
    return this.entities.delete(id);
  }
  byId(id) { return this.entities.get(id); }
  byName(name) {
    for (const e of this.entities.values()) if (e.name === name) return e;
    return null;
  }
  byKind(kind) {
    return [...this.entities.values()].filter((e) => e.kind === kind);
  }
  list() { return [...this.entities.values()]; }

  serialize() {
    return { entities: this.list().map((e) => e.serialize()) };
  }
  static deserialize(json) {
    const f = new ReferenceFrame();
    f.entities.clear(); // drop defaults — the file owns the truth
    for (const e of json.entities || []) {
      let inst;
      if (e.kind === 'plane') inst = new ReferencePlane({ origin: e.origin, normal: e.normal, name: e.name });
      else if (e.kind === 'axis') inst = new ReferenceAxis({ origin: e.origin, direction: e.direction, name: e.name });
      else if (e.kind === 'csys') inst = new ReferenceCoordSystem({ origin: e.origin, xAxis: e.xAxis, yAxis: e.yAxis, name: e.name });
      else continue;
      inst.id = e.id;
      inst.suppressed = !!e.suppressed;
      f.entities.set(inst.id, inst);
    }
    return f;
  }
}
