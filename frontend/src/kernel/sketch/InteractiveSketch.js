/**
 * ArchDisc — Interactive Sketch Engine
 * Mouse-driven 2D sketching on 3D planes.
 *
 * User clicks on a face → sketch plane activates on that face.
 * Mouse clicks place points. Drag creates lines/arcs.
 * Type dimensions to constrain. Constraints visualize as colored icons.
 *
 * This is the core interaction loop for all parametric modeling.
 */

import * as THREE from 'three';
import Vec3 from '../math/Vec3.js';
import Plane from '../math/Plane.js';
import SketchSolver, { SketchPoint, SketchLine, SketchCircle, SketchArc } from './SketchSolver.js';
import { Sketch2D } from '../../foundation/Sketch2D.js';
import { inferConstraintsAndDimension } from '../../foundation/SketchAutoDim.js';

const SNAP_DISTANCE = 0.005; // 5mm snap radius
const GRID_SIZE = 0.001;     // 1mm grid

// Sketch tool modes
const TOOLS = {
  NONE: 'none',
  LINE: 'line',
  RECTANGLE: 'rectangle',
  CIRCLE: 'circle',
  ARC: 'arc',
  DIMENSION: 'dimension',
  POINT: 'point',
  SPLINE: 'spline',
};

export { TOOLS };

export default class InteractiveSketch {
  constructor() {
    this.solver = new SketchSolver();
    this.plane = null;           // sketch plane (Plane object)
    this.planeOrigin = null;     // 3D origin of sketch plane
    this.planeU = null;          // U direction (horizontal on plane)
    this.planeV = null;          // V direction (vertical on plane)
    this.planeNormal = null;     // plane normal

    this.activeTool = TOOLS.NONE;
    this.active = false;
    this.entities = [];          // all sketch entities with 3D visualization data
    this.dimensions = [];        // dimension annotations
    this.tempPoints = [];        // points being placed for current tool
    this.snapPoint = null;       // current snap target
    this.cursorPos = null;       // current 2D cursor position on plane

    // Three.js visualization objects
    this.sketchGroup = null;     // THREE.Group holding all sketch visuals
    this.gridHelper = null;
    this.cursorHelper = null;
    this.tempLine = null;

    this.listeners = new Set();
  }

  /**
   * Activate sketch on a plane defined by a face or standard plane.
   * @param {THREE.Scene} scene
   * @param {object} planeSpec - { origin: Vec3, normal: Vec3 } or 'XY'|'XZ'|'YZ'
   */
  activate(scene, planeSpec) {
    this.active = true;

    if (typeof planeSpec === 'string') {
      switch (planeSpec) {
        case 'XY': this.planeOrigin = Vec3.zero(); this.planeNormal = Vec3.unitZ(); this.planeU = Vec3.unitX(); this.planeV = Vec3.unitY(); break;
        case 'XZ': this.planeOrigin = Vec3.zero(); this.planeNormal = Vec3.unitY(); this.planeU = Vec3.unitX(); this.planeV = Vec3.unitZ(); break;
        case 'YZ': this.planeOrigin = Vec3.zero(); this.planeNormal = Vec3.unitX(); this.planeU = Vec3.unitY(); this.planeV = Vec3.unitZ(); break;
      }
    } else {
      this.planeOrigin = planeSpec.origin;
      this.planeNormal = planeSpec.normal.normalize();
      // Compute U/V basis
      this.planeU = this.planeNormal.isParallelTo(Vec3.unitY())
        ? Vec3.unitX()
        : Vec3.unitY().cross(this.planeNormal).normalize();
      this.planeV = this.planeNormal.cross(this.planeU).normalize();
    }

    this.plane = Plane.fromNormalAndPoint(this.planeNormal, this.planeOrigin);

    // Create sketch visualization group
    this.sketchGroup = new THREE.Group();
    this.sketchGroup.name = '__sketch__';
    this.sketchGroup.userData.isHelper = true;

    // Sketch plane grid (semi-transparent)
    this._createGrid();

    // Cursor crosshair
    this._createCursor();

    scene.add(this.sketchGroup);
    this._notify('activated', { plane: planeSpec });
  }

  /**
   * Deactivate sketch mode.
   */
  deactivate(scene) {
    this.active = false;
    this.activeTool = TOOLS.NONE;
    this.tempPoints = [];

    if (this.sketchGroup && scene) {
      scene.remove(this.sketchGroup);
      this.sketchGroup.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
    }

    this.sketchGroup = null;
    this._notify('deactivated', null);
  }

  /**
   * Set the active drawing tool.
   */
  setTool(tool) {
    this.activeTool = tool;
    this.tempPoints = [];
    this._notify('toolChanged', tool);
  }

  /**
   * Handle mouse move — update cursor position, snap, preview.
   * @param {THREE.Raycaster} raycaster
   */
  onMouseMove(raycaster) {
    if (!this.active || !this.plane) return;

    // Intersect ray with sketch plane
    const planeThree = new THREE.Plane(
      new THREE.Vector3(this.planeNormal.x, this.planeNormal.y, this.planeNormal.z),
      -this.plane.d
    );
    const intersection = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(planeThree, intersection)) return;

    // Convert to 2D sketch coordinates
    const worldPoint = new Vec3(intersection.x, intersection.y, intersection.z);
    const delta = worldPoint.sub(this.planeOrigin);
    const u = delta.dot(this.planeU);
    const v = delta.dot(this.planeV);

    // Snap to grid
    const snappedU = Math.round(u / GRID_SIZE) * GRID_SIZE;
    const snappedV = Math.round(v / GRID_SIZE) * GRID_SIZE;

    // Snap to existing points
    this.snapPoint = this._findSnapTarget(snappedU, snappedV);
    this.cursorPos = this.snapPoint || { u: snappedU, v: snappedV };

    // Update cursor visual
    this._updateCursor(this.cursorPos);

    // Update temp preview
    if (this.tempPoints.length > 0) {
      this._updatePreview(this.cursorPos);
    }
  }

  /**
   * Handle mouse click — place point, complete entity.
   */
  onClick(raycaster) {
    if (!this.active || !this.cursorPos || this.activeTool === TOOLS.NONE) return;

    const pos = this.cursorPos;

    switch (this.activeTool) {
      case TOOLS.LINE:
        this.tempPoints.push(pos);
        if (this.tempPoints.length === 2) {
          this._createLine(this.tempPoints[0], this.tempPoints[1]);
          this.tempPoints = [this.tempPoints[1]]; // chain: end becomes new start
        }
        break;

      case TOOLS.RECTANGLE:
        this.tempPoints.push(pos);
        if (this.tempPoints.length === 2) {
          this._createRectangle(this.tempPoints[0], this.tempPoints[1]);
          this.tempPoints = [];
        }
        break;

      case TOOLS.CIRCLE:
        this.tempPoints.push(pos);
        if (this.tempPoints.length === 2) {
          const radius = Math.sqrt((pos.u - this.tempPoints[0].u) ** 2 + (pos.v - this.tempPoints[0].v) ** 2);
          this._createCircle(this.tempPoints[0], radius);
          this.tempPoints = [];
        }
        break;

      case TOOLS.ARC:
        this.tempPoints.push(pos);
        if (this.tempPoints.length === 3) {
          this._createArc(this.tempPoints[0], this.tempPoints[1], this.tempPoints[2]);
          this.tempPoints = [];
        }
        break;

      case TOOLS.POINT:
        this._createPoint(pos);
        break;

      case TOOLS.DIMENSION:
        this.tempPoints.push(pos);
        if (this.tempPoints.length === 2) {
          this._createDimension(this.tempPoints[0], this.tempPoints[1]);
          this.tempPoints = [];
        }
        break;
    }

    this._notify('click', pos);
  }

  /**
   * Handle double-click — finish current chain (e.g., end line chain).
   */
  onDoubleClick() {
    this.tempPoints = [];
    this._clearPreview();
    this._notify('doubleClick', null);
  }

  /**
   * Handle Escape — cancel current tool.
   */
  onEscape() {
    this.tempPoints = [];
    this._clearPreview();
    this.setTool(TOOLS.NONE);
  }

  /**
   * Apply dimension value to a sketch entity.
   * @param {number} entityIndex - Index in entities array
   * @param {number} value - Dimension value in meters
   */
  applyDimension(entityIndex, value) {
    const entity = this.entities[entityIndex];
    if (!entity) return;

    if (entity.type === 'line') {
      this.solver.distance(entity.solverP1, entity.solverP2, value);
    } else if (entity.type === 'circle') {
      this.solver.radius(entity.solverCircle, value);
    }

    // Solve and update visuals
    const result = this.solver.solve();
    this._updateAllVisuals();
    this._notify('dimensioned', { entityIndex, value, solverResult: result });
  }

  /**
   * Get the sketch profile as Vec3[] for extrusion.
   * Collects all connected closed loops.
   */
  getProfile() {
    // If there's a circle, return it as a polygonized closed loop
    const circles = this.entities.filter(e => e.type === 'circle');
    if (circles.length > 0) {
      const c = circles[circles.length - 1];
      const points = [];
      const segments = 32;
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        points.push(this._to3D(
          c.solverCenter.x + Math.cos(a) * c.solverCircle.radius,
          c.solverCenter.y + Math.sin(a) * c.solverCircle.radius
        ));
      }
      return points;
    }

    // Collect all line endpoints in order
    const points = [];
    for (const entity of this.entities) {
      if (entity.type === 'line') {
        const p1 = this._to3D(entity.solverP1.x, entity.solverP1.y);
        points.push(p1);
      }
    }
    // Add last point to close loop
    if (this.entities.length > 0) {
      const last = this.entities[this.entities.length - 1];
      if (last.type === 'line') {
        points.push(this._to3D(last.solverP2.x, last.solverP2.y));
      }
    }
    return points;
  }

  /**
   * Get solver status (DOF, constraint count).
   */
  getStatus() {
    return {
      dof: this.solver.degreesOfFreedom(),
      fullyConstrained: this.solver.isFullyConstrained(),
      overConstrained: this.solver.isOverConstrained(),
      entityCount: this.entities.length,
      constraintCount: this.solver.constraints.length,
      pointCount: this.solver.points.length,
    };
  }

  /**
   * Clean up the rough-drawn sketch with the validated foundation
   * Sketch2D kernel: build a foundation sketch from the line/circle
   * entities, infer horizontal / vertical / parallel / perpendicular
   * / equal-length constraints, run the Newton-Raphson solver, snap
   * the geometry, and emit dimension annotations.
   *
   * The interactive sketch works in metres (1 mm grid); the
   * foundation Sketch2D + SketchAutoDim work in millimetres — so
   * coordinates are scaled ×1000 going in and ÷1000 coming back.
   *
   * @returns {{ ok, constraintsAdded?, solver?, dimensions?, reason? }}
   */
  cleanupWithFoundation(opts = {}) {
    const S = 1000;                                  // m → mm
    const TOL = (opts.mergeTol ?? GRID_SIZE * 0.5) * S;
    const fSketch = new Sketch2D();
    const fpts = [];
    const getPt = (u, v) => {
      const mu = u * S, mv = v * S;
      let f = fpts.find(p => Math.hypot(p.u - mu, p.v - mv) < TOL);
      if (!f) { f = { u: mu, v: mv, sp: fSketch.addPoint(mu, mv) }; fpts.push(f); }
      return f.sp;
    };
    const lineMap = [], circleMap = [];
    for (const e of this.entities) {
      if (e.type === 'line') {
        const a = getPt(e.p1.u, e.p1.v);
        const b = getPt(e.p2.u, e.p2.v);
        lineMap.push({ entity: e, fline: fSketch.addLine(a, b) });
      } else if (e.type === 'circle') {
        const c = fSketch.addPoint(e.center.u * S, e.center.v * S);
        const fc = fSketch.addCircle(c, e.radius * S);
        fSketch.radius(fc, e.radius * S);
        circleMap.push({ entity: e, fcircle: fc });
      }
    }
    if (lineMap.length === 0 && circleMap.length === 0) {
      return { ok: false, reason: 'no line or circle entities to clean up' };
    }
    const result = inferConstraintsAndDimension(fSketch, opts);
    // Write the solved geometry back into the entities (mm → m).
    for (const { entity, fline } of lineMap) {
      entity.p1 = { u: fline.p1.x / S, v: fline.p1.y / S };
      entity.p2 = { u: fline.p2.x / S, v: fline.p2.y / S };
    }
    for (const { entity, fcircle } of circleMap) {
      entity.center = { u: fcircle.center.x / S, v: fcircle.center.y / S };
      entity.radius = fcircle.radius / S;
    }
    // Keep the dimension annotations (anchors stay in mm; label carries
    // the human-readable value) and rebuild the 3D visuals.
    this._foundationDimensions = result.dimensions ?? [];
    this._redrawAll();
    this._notify('cleanup', result);
    return { ok: true, ...result };
  }

  /** Dispose every sketch-entity visual and redraw from the entity list. */
  _redrawAll() {
    if (!this.sketchGroup) return;
    const stale = this.sketchGroup.children.filter(c => c.userData.sketchEntity);
    for (const c of stale) {
      this.sketchGroup.remove(c);
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    for (const e of this.entities) {
      if (e.type === 'line')        e.visual = this._drawLine3D(e.p1, e.p2, 0x00ccff);
      else if (e.type === 'circle') e.visual = this._drawCircle3D(e.center, e.radius, 0x00ccff);
      else if (e.type === 'arc')    e.visual = this._drawArc3D(e.p1, e.p2, e.p3, 0x00ccff);
    }
    for (const d of (this._foundationDimensions ?? [])) {
      this._drawAutoDimLabel(d);
    }
  }

  /** Render one auto-dimension annotation as a 3D text sprite. */
  _drawAutoDimLabel(dim) {
    const u = dim.anchor.x / 1000, v = dim.anchor.y / 1000;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffd66d';
    ctx.font = '18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(dim.label, 80, 22);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas), transparent: true,
    }));
    const p = this._to3D(u, v);
    sprite.position.set(p.x, p.y, p.z);
    sprite.scale.set(0.024, 0.0048, 1);
    sprite.userData.sketchEntity = true;
    this.sketchGroup?.add(sprite);
    return sprite;
  }

  // --- Entity creation ---

  _createLine(p1, p2) {
    const sp1 = this.solver.addPoint(p1.u, p1.v);
    const sp2 = this.solver.addPoint(p2.u, p2.v);
    const sLine = this.solver.addLine(sp1, sp2);

    const visual = this._drawLine3D(p1, p2, 0x00ccff);
    const entity = { type: 'line', solverP1: sp1, solverP2: sp2, solverLine: sLine, visual, p1, p2 };
    this.entities.push(entity);
    this._notify('entityCreated', entity);
    return entity;
  }

  _createRectangle(p1, p2) {
    const corners = [
      { u: p1.u, v: p1.v },
      { u: p2.u, v: p1.v },
      { u: p2.u, v: p2.v },
      { u: p1.u, v: p2.v },
    ];

    // Create 4 lines + 4 constraints
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      lines.push(this._createLine(a, b));
    }

    // Add horizontal/vertical constraints
    this.solver.horizontal(lines[0].solverLine);
    this.solver.horizontal(lines[2].solverLine);
    this.solver.vertical(lines[1].solverLine);
    this.solver.vertical(lines[3].solverLine);

    // Coincident constraints at corners
    this.solver.coincident(lines[0].solverP2, lines[1].solverP1);
    this.solver.coincident(lines[1].solverP2, lines[2].solverP1);
    this.solver.coincident(lines[2].solverP2, lines[3].solverP1);
    this.solver.coincident(lines[3].solverP2, lines[0].solverP1);

    this.solver.solve();
    this._notify('rectangleCreated', { corners, lines });
  }

  _createCircle(center, radius) {
    const sCenter = this.solver.addPoint(center.u, center.v);
    const sCircle = this.solver.addCircle(sCenter, radius);

    const visual = this._drawCircle3D(center, radius, 0x00ccff);
    const entity = { type: 'circle', solverCenter: sCenter, solverCircle: sCircle, visual, center, radius };
    this.entities.push(entity);
    this._notify('entityCreated', entity);
    return entity;
  }

  _createArc(p1, p2, p3) {
    const sp1 = this.solver.addPoint(p1.u, p1.v);
    const sp2 = this.solver.addPoint(p2.u, p2.v);
    const sp3 = this.solver.addPoint(p3.u, p3.v);

    // Compute center from 3 points
    const cx = (p1.u + p2.u + p3.u) / 3;
    const cy = (p1.v + p2.v + p3.v) / 3;
    const sCenter = this.solver.addPoint(cx, cy);
    const sArc = this.solver.addArc(sCenter, sp1, sp3);

    const visual = this._drawArc3D(p1, p2, p3, 0x00ccff);
    const entity = { type: 'arc', visual, p1, p2, p3 };
    this.entities.push(entity);
    this._notify('entityCreated', entity);
    return entity;
  }

  _createPoint(pos) {
    const sp = this.solver.addPoint(pos.u, pos.v, true);
    const visual = this._drawPoint3D(pos, 0x00ff88);
    const entity = { type: 'point', solverPoint: sp, visual, pos };
    this.entities.push(entity);
    return entity;
  }

  _createDimension(p1, p2) {
    const dist = Math.sqrt((p2.u - p1.u) ** 2 + (p2.v - p1.v) ** 2);
    const visual = this._drawDimension3D(p1, p2, dist, 0xffaa00);
    const dim = { type: 'dimension', p1, p2, value: dist, visual };
    this.dimensions.push(dim);
    this._notify('dimensionCreated', dim);
    return dim;
  }

  // --- 3D visualization helpers ---

  _to3D(u, v) {
    return this.planeOrigin
      .add(this.planeU.mul(u))
      .add(this.planeV.mul(v));
  }

  _toThreeVec(u, v) {
    const p = this._to3D(u, v);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  _drawLine3D(p1, p2, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      this._toThreeVec(p1.u, p1.v),
      this._toThreeVec(p2.u, p2.v),
    ]);
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    line.userData.sketchEntity = true;
    this.sketchGroup?.add(line);

    // Endpoint markers
    this._drawPoint3D(p1, color, 0.002);
    this._drawPoint3D(p2, color, 0.002);

    return line;
  }

  _drawCircle3D(center, radius, color) {
    const points = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      points.push(this._toThreeVec(
        center.u + Math.cos(a) * radius,
        center.v + Math.sin(a) * radius
      ));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geo, mat);
    line.userData.sketchEntity = true;
    this.sketchGroup?.add(line);

    // Center marker
    this._drawPoint3D(center, 0xffaa00, 0.003);

    return line;
  }

  _drawArc3D(p1, p2, p3, color) {
    const points = [];
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      // Quadratic Bezier approximation through 3 points
      const u = (1 - t) * (1 - t) * p1.u + 2 * (1 - t) * t * p2.u + t * t * p3.u;
      const v = (1 - t) * (1 - t) * p1.v + 2 * (1 - t) * t * p2.v + t * t * p3.v;
      points.push(this._toThreeVec(u, v));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geo, mat);
    line.userData.sketchEntity = true;
    this.sketchGroup?.add(line);
    return line;
  }

  _drawPoint3D(pos, color, size = 0.002) {
    const geo = new THREE.SphereGeometry(size, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    const p = this._to3D(pos.u, pos.v);
    mesh.position.set(p.x, p.y, p.z);
    mesh.userData.sketchEntity = true;
    this.sketchGroup?.add(mesh);
    return mesh;
  }

  _drawDimension3D(p1, p2, value, color) {
    // Dimension line with text sprite
    const mid = { u: (p1.u + p2.u) / 2, v: (p1.v + p2.v) / 2 + 0.005 };
    const line = this._drawLine3D(p1, p2, color);

    // Extension lines
    this._drawLine3D({ u: p1.u, v: p1.v }, { u: p1.u, v: p1.v + 0.004 }, 0x666666);
    this._drawLine3D({ u: p2.u, v: p2.v }, { u: p2.u, v: p2.v + 0.004 }, 0x666666);

    // Text label (canvas sprite)
    const label = `${(value * 1000).toFixed(2)}`;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffaa00';
    ctx.font = '20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, 64, 22);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    const midPos = this._to3D(mid.u, mid.v);
    sprite.position.set(midPos.x, midPos.y, midPos.z);
    sprite.scale.set(0.02, 0.005, 1);
    sprite.userData.sketchEntity = true;
    this.sketchGroup?.add(sprite);

    return { line, sprite };
  }

  _createGrid() {
    const size = 0.2; // 200mm grid
    const divisions = 40; // 5mm spacing
    const grid = new THREE.GridHelper(size, divisions, 0x334455, 0x1a2233);

    // Rotate grid to match sketch plane
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(this.planeNormal.x, this.planeNormal.y, this.planeNormal.z));
    grid.quaternion.copy(q);
    grid.position.set(this.planeOrigin.x, this.planeOrigin.y, this.planeOrigin.z);
    grid.userData.isHelper = true;
    this.sketchGroup.add(grid);
    this.gridHelper = grid;
  }

  _createCursor() {
    // Crosshair cursor
    const size = 0.008;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-size, 0, 0), new THREE.Vector3(size, 0, 0),
      new THREE.Vector3(0, 0, -size), new THREE.Vector3(0, 0, size),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 });
    const cursor = new THREE.LineSegments(geo, mat);
    cursor.userData.isHelper = true;
    this.sketchGroup.add(cursor);
    this.cursorHelper = cursor;
  }

  _updateCursor(pos) {
    if (!this.cursorHelper || !pos) return;
    const p = this._to3D(pos.u, pos.v);
    this.cursorHelper.position.set(p.x, p.y, p.z);

    // Rotate to match plane
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(this.planeNormal.x, this.planeNormal.y, this.planeNormal.z));
    this.cursorHelper.quaternion.copy(q);
  }

  _updatePreview(currentPos) {
    this._clearPreview();
    if (this.tempPoints.length === 0) return;

    const last = this.tempPoints[this.tempPoints.length - 1];

    if (this.activeTool === TOOLS.LINE || this.activeTool === TOOLS.RECTANGLE || this.activeTool === TOOLS.DIMENSION) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        this._toThreeVec(last.u, last.v),
        this._toThreeVec(currentPos.u, currentPos.v),
      ]);
      const mat = new THREE.LineBasicMaterial({ color: 0x00ff88, opacity: 0.5, transparent: true });
      this.tempLine = new THREE.Line(geo, mat);
      this.tempLine.name = '__temp_preview__';
      this.sketchGroup?.add(this.tempLine);
    }

    if (this.activeTool === TOOLS.CIRCLE && this.tempPoints.length === 1) {
      const center = this.tempPoints[0];
      const radius = Math.sqrt((currentPos.u - center.u) ** 2 + (currentPos.v - center.v) ** 2);
      const points = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        points.push(this._toThreeVec(center.u + Math.cos(a) * radius, center.v + Math.sin(a) * radius));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      this.tempLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.5 }));
      this.tempLine.name = '__temp_preview__';
      this.sketchGroup?.add(this.tempLine);
    }
  }

  _clearPreview() {
    if (this.tempLine && this.sketchGroup) {
      this.sketchGroup.remove(this.tempLine);
      if (this.tempLine.geometry) this.tempLine.geometry.dispose();
      if (this.tempLine.material) this.tempLine.material.dispose();
      this.tempLine = null;
    }
  }

  _updateAllVisuals() {
    // After solver runs, update entity positions
    for (const entity of this.entities) {
      if (entity.type === 'line' && entity.visual) {
        const positions = entity.visual.geometry.getAttribute('position');
        const p1 = this._to3D(entity.solverP1.x, entity.solverP1.y);
        const p2 = this._to3D(entity.solverP2.x, entity.solverP2.y);
        positions.setXYZ(0, p1.x, p1.y, p1.z);
        positions.setXYZ(1, p2.x, p2.y, p2.z);
        positions.needsUpdate = true;
      }
    }
  }

  _findSnapTarget(u, v) {
    // Snap to existing points
    for (const entity of this.entities) {
      if (entity.type === 'line') {
        if (Math.abs(entity.solverP1.x - u) < SNAP_DISTANCE && Math.abs(entity.solverP1.y - v) < SNAP_DISTANCE) {
          return { u: entity.solverP1.x, v: entity.solverP1.y, snappedTo: 'point' };
        }
        if (Math.abs(entity.solverP2.x - u) < SNAP_DISTANCE && Math.abs(entity.solverP2.y - v) < SNAP_DISTANCE) {
          return { u: entity.solverP2.x, v: entity.solverP2.y, snappedTo: 'point' };
        }
      }
    }
    // Snap to grid
    return { u, v, snappedTo: 'grid' };
  }

  // --- Events ---
  onChange(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  _notify(event, data) { for (const cb of this.listeners) cb(event, data); }
}
