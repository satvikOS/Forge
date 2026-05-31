/**
 * ArchDisc Geometry Kernel — Topological Solid
 * A solid is the highest-level topological entity.
 * It consists of one outer shell and zero or more inner shells (voids).
 */

import Vec3 from '../math/Vec3.js';
import BBox3 from '../math/BBox3.js';

let _solidId = 0;

export default class TopoSolid {
  constructor(outerShell, innerShells = []) {
    this.id = ++_solidId;
    this.type = 'solid';
    this.outerShell = outerShell;
    this.innerShells = innerShells; // voids/cavities
    this.tag = 0;
    this.userData = {};
    this.material = null;
    this.name = '';

    if (outerShell) outerShell.solid = this;
    for (const s of innerShells) s.solid = this;
  }

  allShells() {
    const shells = [];
    if (this.outerShell) shells.push(this.outerShell);
    shells.push(...this.innerShells);
    return shells;
  }

  faces() {
    const faces = [];
    for (const shell of this.allShells()) {
      faces.push(...shell.faces);
    }
    return faces;
  }

  edges() {
    const edges = new Set();
    for (const shell of this.allShells()) {
      for (const e of shell.edges()) edges.add(e);
    }
    return [...edges];
  }

  vertices() {
    const verts = new Set();
    for (const shell of this.allShells()) {
      for (const v of shell.vertices()) verts.add(v);
    }
    return [...verts];
  }

  boundingBox() {
    return this.outerShell ? this.outerShell.boundingBox() : BBox3.empty();
  }

  volume() {
    let vol = this.outerShell ? this.outerShell.volume() : 0;
    for (const inner of this.innerShells) {
      vol -= inner.volume();
    }
    return vol;
  }

  surfaceArea() {
    let area = 0;
    for (const shell of this.allShells()) {
      area += shell.surfaceArea();
    }
    return area;
  }

  centroid() {
    return this.outerShell ? this.outerShell.centroid() : Vec3.zero();
  }

  isValid() {
    if (!this.outerShell) return false;
    if (!this.outerShell.isClosed()) return false;
    if (this.outerShell.eulerCharacteristic() !== 2) return false;
    for (const inner of this.innerShells) {
      if (!inner.isClosed()) return false;
    }
    return true;
  }

  // Mass properties (given density in kg/m³)
  massProperties(density = 2700) { // default: aluminum
    const vol = this.volume();
    const mass = vol * density;
    const bbox = this.boundingBox();
    const size = bbox.size();
    // Approximate moment of inertia (treating as box)
    const Ixx = (mass / 12) * (size.y * size.y + size.z * size.z);
    const Iyy = (mass / 12) * (size.x * size.x + size.z * size.z);
    const Izz = (mass / 12) * (size.x * size.x + size.y * size.y);

    return {
      volume: vol,
      surfaceArea: this.surfaceArea(),
      mass,
      density,
      centroid: this.centroid(),
      boundingBox: bbox,
      momentOfInertia: { Ixx, Iyy, Izz }
    };
  }

  clone() {
    // Deep clone requires rebuilding topology — handled by kernel operations
    const solid = new TopoSolid(null, []);
    solid.material = this.material;
    solid.name = this.name;
    solid.userData = { ...this.userData };
    return solid;
  }

  toString() {
    const v = this.vertices().length;
    const e = this.edges().length;
    const f = this.faces().length;
    return `Solid#${this.id}("${this.name}" V:${v} E:${e} F:${f} vol:${this.volume().toFixed(6)})`;
  }
}

export function resetSolidIds() { _solidId = 0; }
