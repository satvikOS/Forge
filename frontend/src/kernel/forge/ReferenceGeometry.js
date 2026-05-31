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
