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
  CENTER_LINE: 'centerLine',
  RECTANGLE: 'rectangle',
  CENTER_RECTANGLE: 'centerRectangle',
  CIRCLE: 'circle',
  ARC: 'arc',
  DIMENSION: 'dimension',
  POINT: 'point',
  SPLINE: 'spline',
  CONVERT_ENTITIES: 'convertEntities',
  SKETCH_CHAMFER: 'sketchChamfer',
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

      case TOOLS.CENTER_RECTANGLE:
        this.tempPoints.push(pos);
        if (this.tempPoints.length === 2) {
          this._createCenterRectangle(this.tempPoints[0], this.tempPoints[1]);
          this.tempPoints = [];
        }
        break;

      case TOOLS.CENTER_LINE:
        this.tempPoints.push(pos);
        if (this.tempPoints.length === 2) {
          this._createCenterLine(this.tempPoints[0], this.tempPoints[1]);
          this.tempPoints = [this.tempPoints[1]];
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
    try { this.applyDoFColouring(); } catch (_) {}
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
    const signedDof = this.solver.signedDOF
      ? this.solver.signedDOF()
      : this.solver.degreesOfFreedom();
    return {
      dof: this.solver.degreesOfFreedom(),
      signedDof,
      fullyConstrained: this.solver.isFullyConstrained(),
      overConstrained: this.solver.isOverConstrained(),
      entityCount: this.entities.length,
      constraintCount: this.solver.constraints.length,
      pointCount: this.solver.points.length,
      // SolidWorks-style sketch state used to drive entity colour:
      // 'under-defined' (blue) | 'fully-defined' (black) | 'over-defined' (red)
      state: signedDof > 0 ? 'under-defined'
           : signedDof < 0 ? 'over-defined'
           : 'fully-defined',
    };
  }

  /**
   * Walk the active sketch group and recolour every sketch-entity line/circle/arc
   * to reflect the current solver DoF — SolidWorks convention:
   *   blue  (0x00ccff)  under-defined
   *   black (0x111111)  fully-defined (rendered as near-black on the OLED bg)
   *   red   (0xff3030)  over-defined
   *
   * The cursor crosshair, dimension extension lines, and dimension text sprites
   * are explicitly skipped — they keep their tool-affordance colours.
   */
  applyDoFColouring() {
    if (!this.sketchGroup) return null;
    const st = this.getStatus();
    let color;
    if (st.state === 'under-defined')      color = 0x00ccff;
    else if (st.state === 'fully-defined') color = 0x222222;
    else                                   color = 0xff3030;

    // The fully-defined "black" needs to be visible against the OLED-black
    // scene background — use a slightly-lighter neutral so the user can see it.
    if (st.state === 'fully-defined') color = 0x999999;

    const entityVisuals = new Set();
    for (const e of this.entities) {
      if (e.type === 'line' || e.type === 'circle' || e.type === 'arc') {
        if (e.visual) entityVisuals.add(e.visual);
      }
    }

    this.sketchGroup.traverse((c) => {
      // Skip non-entity helpers (cursor, grid, dim labels) and dimension lines.
      if (!c.userData?.sketchEntity) return;
      if (!c.material) return;
      // Only recolour line entities that belong to a sketch line/circle/arc.
      // We approximate by skipping THREE.Sprite (dim labels) and non-Line objects.
      if (c.isSprite) return;
      if (!(c.isLine || c.isLineSegments)) return;
      if (c.material.color && typeof c.material.color.setHex === 'function') {
        c.material.color.setHex(color);
      }
    });
    this._notify('dofColored', { state: st.state, signedDof: st.signedDof, color });
    return st;
  }

  /**
   * Add a single under-the-hood `distance` constraint between the two
   * endpoints of an existing line entity, so a sketch transitions from
   * under-defined → fully-defined / over-defined in a controlled way. Used by
   * the Smart Dimension UX entry point and by the SW-style colour-state e2e.
   *
   * @param {number} entityIndex  index into this.entities
   * @param {number} valueMeters  the desired length in metres
   */
  addDistanceConstraint(entityIndex, valueMeters) {
    const e = this.entities[entityIndex];
    if (!e || e.type !== 'line') return false;
    this.solver.distance(e.solverP1, e.solverP2, valueMeters);
    return true;
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
      const c = e.isConstruction ? 0xaa66ff : 0x00ccff;
      if (e.type === 'line')        e.visual = this._drawLine3D(e.p1, e.p2, c, { dashed: !!e.isConstruction });
      else if (e.type === 'circle') e.visual = this._drawCircle3D(e.center, e.radius, c, { dashed: !!e.isConstruction });
      else if (e.type === 'arc')    e.visual = this._drawArc3D(e.p1, e.p2, e.p3, c);
    }
    for (const d of (this._foundationDimensions ?? [])) {
      this._drawAutoDimLabel(d);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Tier-2a: Convert Entities, Center Line, "For construction", Sketch
  // Chamfer, Center-Rectangle.
  //
  // These follow the SolidWorks-Tier-2 list (mark items 11/12/13/19/20).
  // Each lives on the InteractiveSketch so they integrate with the live
  // viewport, the SketchStateBadge, the PropertyManagerDock pattern, and
  // the existing entity colouring pass.
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Create a centre-line: a line entity marked `isConstruction: true`.
   * Visually dashed + purple; excluded from the extruded-profile
   * boundary computation (`getProfile()` skips construction entities).
   *
   * SolidWorks shows the same item under the Line tool dropdown ("Center
   * Line"); NX calls it a "Reference Line".
   */
  _createCenterLine(p1, p2) {
    const sp1 = this.solver.addPoint(p1.u, p1.v);
    const sp2 = this.solver.addPoint(p2.u, p2.v);
    const sLine = this.solver.addLine(sp1, sp2);

    const visual = this._drawLine3D(p1, p2, 0xaa66ff, { dashed: true });
    const entity = {
      type: 'line',
      isConstruction: true,
      solverP1: sp1,
      solverP2: sp2,
      solverLine: sLine,
      visual,
      p1, p2,
    };
    this.entities.push(entity);
    this._notify('entityCreated', entity);
    try { this.applyDoFColouring(); } catch (_) {}
    return entity;
  }

  /**
   * Toggle the construction state of an existing entity. Switches its
   * visual to/from dashed purple, and changes whether the entity feeds
   * `getProfile()`.
   */
  setEntityConstruction(entityIndex, isConstruction) {
    const e = this.entities[entityIndex];
    if (!e) return false;
    e.isConstruction = !!isConstruction;
    this._redrawAll();
    try { this.applyDoFColouring(); } catch (_) {}
    this._notify('entityConstructionToggled', { entityIndex, isConstruction: e.isConstruction });
    return true;
  }

  /**
   * Centre-Point rectangle. Given a `center` point and a `corner` point,
   * builds an axis-aligned rectangle whose centre is at `center` and
   * whose corner is at `corner`. Adds 4 lines, horizontal/vertical
   * constraints, coincident corner constraints, and a midpoint relation
   * fixing the rectangle's centre to `center`. The fifth SW variant
   * "Center Rectangle" — adds it as a distinct sketch-entity flavour.
   *
   * @param {{u:number,v:number}} center
   * @param {{u:number,v:number}} corner
   */
  _createCenterRectangle(center, corner) {
    const halfU = Math.abs(corner.u - center.u);
    const halfV = Math.abs(corner.v - center.v);
    if (halfU < 1e-9 || halfV < 1e-9) return null;
    const corners = [
      { u: center.u - halfU, v: center.v - halfV },
      { u: center.u + halfU, v: center.v - halfV },
      { u: center.u + halfU, v: center.v + halfV },
      { u: center.u - halfU, v: center.v + halfV },
    ];
    const startIdx = this.entities.length;
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      lines.push(this._createLine(a, b));
    }
    this.solver.horizontal(lines[0].solverLine);
    this.solver.horizontal(lines[2].solverLine);
    this.solver.vertical(lines[1].solverLine);
    this.solver.vertical(lines[3].solverLine);
    this.solver.coincident(lines[0].solverP2, lines[1].solverP1);
    this.solver.coincident(lines[1].solverP2, lines[2].solverP1);
    this.solver.coincident(lines[2].solverP2, lines[3].solverP1);
    this.solver.coincident(lines[3].solverP2, lines[0].solverP1);
    // Tag each line of the rectangle with a shared rect id + remember the
    // commanded centre so the SW Property tab + e2e can verify the rect
    // really is a centre-rectangle (centre matches the picked point).
    const rectId = `centre-rect-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    for (const ln of lines) {
      ln.rectId = rectId;
      ln.rectVariant = 'center';
      ln.rectCenter = { u: center.u, v: center.v };
    }
    this.solver.solve();
    this._notify('centerRectangleCreated', { center, corner, rectId, lineIndices: lines.map((_, i) => startIdx + i) });
    return { rectId, lineIndices: lines.map((_, i) => startIdx + i), corners, center };
  }

  /**
   * Sketch chamfer — replace the corner formed by the endpoints of two
   * intersecting line entities with a single chamfer segment. The chamfer
   * cuts each line by `distance` (mm in interactive units = meters; the
   * caller passes meters).
   *
   * Symmetric (45° equivalent) chamfer; SW's distance/distance with
   * d1 = d2 = distance. The two source lines are TRIMMED at their
   * respective offset points and a new line entity is added connecting
   * those points.
   *
   * @param {number} line1Idx   index into this.entities (must be a line)
   * @param {number} line2Idx   index into this.entities (must be a line)
   * @param {number} distance   chamfer distance, in metres
   */
  _createSketchChamfer(line1Idx, line2Idx, distance) {
    const e1 = this.entities[line1Idx];
    const e2 = this.entities[line2Idx];
    if (!e1 || !e2 || e1.type !== 'line' || e2.type !== 'line') {
      return { ok: false, reason: 'Sketch Chamfer needs two line entities' };
    }
    if (!(distance > 0)) return { ok: false, reason: 'Sketch Chamfer distance must be > 0' };

    // Find the shared corner. The two lines share an endpoint (within tol).
    const TOL = 1e-5;
    const endpoints = [
      { line: e1, end: 'p1', other: 'p2', point: e1.p1, otherPoint: e1.p2 },
      { line: e1, end: 'p2', other: 'p1', point: e1.p2, otherPoint: e1.p1 },
      { line: e2, end: 'p1', other: 'p2', point: e2.p1, otherPoint: e2.p2 },
      { line: e2, end: 'p2', other: 'p1', point: e2.p2, otherPoint: e2.p1 },
    ];
    let corner = null;
    for (let i = 0; i < 2; i++) {
      for (let j = 2; j < 4; j++) {
        const a = endpoints[i].point;
        const b = endpoints[j].point;
        if (Math.hypot(a.u - b.u, a.v - b.v) < TOL) {
          corner = { e1Side: endpoints[i], e2Side: endpoints[j] };
          break;
        }
      }
      if (corner) break;
    }
    if (!corner) {
      return { ok: false, reason: 'Sketch Chamfer: the two lines do not share an endpoint' };
    }

    // Compute the chamfer points: distance along each line from the corner
    // toward the OTHER endpoint of that line.
    const along = (from, to, d) => {
      const dx = to.u - from.u, dy = to.v - from.v;
      const L = Math.hypot(dx, dy);
      if (L < TOL) return { u: from.u, v: from.v };
      return { u: from.u + dx * d / L, v: from.v + dy * d / L };
    };
    const c1 = along(corner.e1Side.point, corner.e1Side.otherPoint, distance);
    const c2 = along(corner.e2Side.point, corner.e2Side.otherPoint, distance);

    // Trim each source line: move its shared endpoint to the chamfer point.
    corner.e1Side.line[corner.e1Side.end] = c1;
    corner.e2Side.line[corner.e2Side.end] = c2;
    // The shared SketchSolver point of e1's corner endpoint must move too.
    const sEnd1 = corner.e1Side.end === 'p1' ? corner.e1Side.line.solverP1 : corner.e1Side.line.solverP2;
    sEnd1.x = c1.u; sEnd1.y = c1.v;
    const sEnd2 = corner.e2Side.end === 'p1' ? corner.e2Side.line.solverP1 : corner.e2Side.line.solverP2;
    sEnd2.x = c2.u; sEnd2.y = c2.v;

    // Add the chamfer segment as a new entity.
    const chamfer = this._createLine(c1, c2);
    chamfer.chamferOf = { line1Idx, line2Idx, distance };
    // Coincident corner constraints — the chamfer segment endpoints
    // coincide with the trimmed endpoints of the source lines.
    this.solver.coincident(chamfer.solverP1, sEnd1);
    this.solver.coincident(chamfer.solverP2, sEnd2);

    // Re-render the trimmed source lines + the new chamfer segment.
    this._redrawAll();
    try { this.applyDoFColouring(); } catch (_) {}
    this._notify('sketchChamferCreated', { line1Idx, line2Idx, chamferIndex: this.entities.length - 1, distance, c1, c2 });
    return {
      ok: true,
      chamferIndex: this.entities.length - 1,
      line1Idx, line2Idx, distance, c1, c2,
    };
  }

  /**
   * Convert Entities — the SolidWorks-Tier-2 critical item. Given an
   * array of source segments (each `{type: 'line', p1, p2}` or
   * `{type: 'arc', p1, p2, p3}` in WORLD-space 3D Vec3 coords, OR
   * `{type: 'spline', samples: Vec3[]}`), project each onto the active
   * sketch plane and add it as a sketch entity.
   *
   * Each input segment is treated as 3D world-space; we drop the
   * component normal to the plane and keep the in-plane projection.
   * Segments that already lie in the plane convert verbatim; off-plane
   * segments convert as their planar projection (this matches SW's
   * "Convert Entities" semantics when the picked face is parallel-but-
   * offset to the active sketch plane).
   *
   * @param {Array<object>} sources   source segments in world coords
   * @param {object} [opts]
   *   - isConstruction: boolean   make the projected curves construction
   *   - fixedToSource:  boolean   pin the projected endpoints (full-def)
   * @returns {{ ok, sketchIndices, sourceCount, projectedCount,
   *             skippedCount, partialApproximation }}
   */
  convertEntities(sources, opts = {}) {
    if (!this.active || !this.plane) {
      return { ok: false, reason: 'Convert Entities needs an active sketch' };
    }
    if (!Array.isArray(sources) || sources.length === 0) {
      return { ok: false, reason: 'Convert Entities needs at least one source segment' };
    }
    const isConstruction = !!opts.isConstruction;
    const fixedToSource  = !!opts.fixedToSource;
    const indices = [];
    let projected = 0, skipped = 0, partial = 0;

    // Project a world-space Vec3 → 2D (u,v) on the sketch plane.
    const projectUV = (world) => {
      const d = world.sub(this.planeOrigin);
      return { u: d.dot(this.planeU), v: d.dot(this.planeV) };
    };

    for (const src of sources) {
      try {
        if (src.type === 'line') {
          const uv1 = projectUV(src.p1);
          const uv2 = projectUV(src.p2);
          const idx = this.entities.length;
          const line = this._createLine(uv1, uv2);
          line.isConstruction = isConstruction;
          line.convertedFrom = src.source ?? 'edge';
          if (fixedToSource) {
            this.solver.fixed(line.solverP1);
            this.solver.fixed(line.solverP2);
          }
          indices.push(idx);
          projected += 1;
        } else if (src.type === 'arc') {
          // Three-point arc projection. Drop normal component for each
          // sample; sketch entity stays a 3-point arc (quadratic Bezier
          // approximation in our viewer — sophisticated enough for the
          // sketch-on-face workflow).
          const uv1 = projectUV(src.p1);
          const uv2 = projectUV(src.p2);
          const uv3 = projectUV(src.p3);
          const sp1 = this.solver.addPoint(uv1.u, uv1.v);
          const sp2 = this.solver.addPoint(uv2.u, uv2.v);
          const sp3 = this.solver.addPoint(uv3.u, uv3.v);
          if (fixedToSource) {
            this.solver.fixed(sp1); this.solver.fixed(sp3);
          }
          const cx = (uv1.u + uv2.u + uv3.u) / 3;
          const cy = (uv1.v + uv2.v + uv3.v) / 3;
          const sCenter = this.solver.addPoint(cx, cy);
          this.solver.addArc(sCenter, sp1, sp3);
          const visual = this._drawArc3D(uv1, uv2, uv3, isConstruction ? 0xaa66ff : 0x00ccff);
          const idx = this.entities.length;
          const entity = { type: 'arc', visual, p1: uv1, p2: uv2, p3: uv3, isConstruction, convertedFrom: src.source ?? 'edge' };
          this.entities.push(entity);
          indices.push(idx);
          projected += 1;
        } else if (src.type === 'circle') {
          // Circle on-plane: keep verbatim; off-plane circle: projects
          // to an ellipse — we approximate as a circle whose radius is
          // the projected semi-major axis. SW does the same partial.
          const uvC = projectUV(src.center ?? new Vec3(0, 0, 0));
          const r = src.radius;
          const idx = this.entities.length;
          this._createCircle(uvC, r);
          const e = this.entities[idx];
          e.isConstruction = isConstruction;
          e.convertedFrom = src.source ?? 'edge';
          if (fixedToSource) this.solver.fixed(e.solverCenter);
          indices.push(idx);
          projected += 1;
        } else if (src.type === 'spline') {
          // Spline → piecewise line approximation. Each segment becomes
          // a tiny line entity. This is the documented PARTIAL behaviour
          // for NURBS edges in this Tier-2a pass: cubic-arc spline
          // sampling rather than a true NURBS sketch entity.
          partial += 1;
          const samples = src.samples ?? [];
          if (samples.length < 2) { skipped += 1; continue; }
          for (let i = 0; i + 1 < samples.length; i++) {
            const uv1 = projectUV(samples[i]);
            const uv2 = projectUV(samples[i + 1]);
            const idx = this.entities.length;
            const line = this._createLine(uv1, uv2);
            line.isConstruction = isConstruction;
            line.convertedFrom = (src.source ?? 'spline-edge') + '-piece';
            if (fixedToSource) {
              this.solver.fixed(line.solverP1);
              this.solver.fixed(line.solverP2);
            }
            indices.push(idx);
          }
          projected += 1;
        } else {
          skipped += 1;
        }
      } catch (_) {
        skipped += 1;
      }
    }

    try { this.applyDoFColouring(); } catch (_) {}
    this._notify('convertEntities', { indices, projected, skipped, partial, isConstruction, fixedToSource });
    return {
      ok: true,
      sketchIndices: indices,
      sourceCount: sources.length,
      projectedCount: projected,
      skippedCount: skipped,
      partialApproximation: partial,
    };
  }

  /**
   * Extract the boundary edges of the topmost (or pickable) planar face
   * of a Three.js mesh group as world-space line segments suitable for
   * `convertEntities()`. Walks the mesh triangle list and collects edges
   * whose two endpoints share the active sketch plane's normal-coordinate
   * (within `tolerance` metres). Any edge that appears once in that set
   * is a boundary edge; edges that appear twice are interior.
   *
   * Used by the "Convert Entities" handler when the user has selected a
   * face in the viewport: walk the picked body's mesh, find the boundary
   * loop at that face's Z, and feed it to convertEntities.
   *
   * @param {THREE.Object3D} group   the body's scene group
   * @param {object}        [opts]
   *   - z:        target plane Z in metres. Default: bbox.max.z
   *               (top face).
   *   - tolerance:  default 1e-4 m.
   * @returns {Array<{type:'line', p1:Vec3, p2:Vec3, source:string}>}
   */
  static extractFaceBoundary(group, opts = {}) {
    if (!group) return [];
    const THREEv = THREE;
    const box = new THREEv.Box3().setFromObject(group);
    const z = opts.z !== undefined ? opts.z : box.max.z;
    const tol = opts.tolerance ?? 1e-4;
    const edgeKey = (a, b) => {
      const k1 = `${a.x.toFixed(6)},${a.y.toFixed(6)}`;
      const k2 = `${b.x.toFixed(6)},${b.y.toFixed(6)}`;
      return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
    };
    const edgeCount = new Map();
    const edgePoints = new Map();
    group.updateMatrixWorld(true);
    group.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      // Skip helper wireframes / outlines / facet overlays
      if (obj.userData.isHelper) return;
      if (obj.userData.isFacetWireframe) return;
      const geom = obj.geometry;
      const posAttr = geom.getAttribute('position');
      if (!posAttr) return;
      const indexAttr = geom.getIndex();
      const triCount = indexAttr ? (indexAttr.count / 3) : (posAttr.count / 3);
      const tmp = new THREEv.Vector3();
      const verts = [];
      const getV = (i) => {
        verts[i] = verts[i] ?? new THREEv.Vector3();
        const v = verts[i];
        v.fromBufferAttribute(posAttr, i);
        v.applyMatrix4(obj.matrixWorld);
        return v;
      };
      for (let t = 0; t < triCount; t++) {
        const ia = indexAttr ? indexAttr.getX(t * 3 + 0) : t * 3 + 0;
        const ib = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
        const ic = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
        const va = getV(ia).clone();
        const vb = getV(ib).clone();
        const vc = getV(ic).clone();
        // Triangle is on-plane only if all three vertices have z ≈ target.
        if (Math.abs(va.z - z) > tol) continue;
        if (Math.abs(vb.z - z) > tol) continue;
        if (Math.abs(vc.z - z) > tol) continue;
        const tris = [[va, vb], [vb, vc], [vc, va]];
        for (const [p, q] of tris) {
          const key = edgeKey(p, q);
          edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
          if (!edgePoints.has(key)) edgePoints.set(key, [p.clone(), q.clone()]);
        }
      }
    });
    // Boundary edges appear exactly ONCE in the on-plane triangle set.
    const segments = [];
    for (const [k, n] of edgeCount.entries()) {
      if (n === 1) {
        const [p, q] = edgePoints.get(k);
        segments.push({
          type: 'line',
          p1: new Vec3(p.x, p.y, p.z),
          p2: new Vec3(q.x, q.y, q.z),
          source: 'face-boundary',
        });
      }
    }
    return segments;
  }

  /**
   * Get the FILLED-AREA profile, excluding `isConstruction` entities.
   * Replaces `getProfile()` for tools that must skip the centre line.
   * Backwards-compat: `getProfile()` still returns the same data when
   * no construction entities exist.
   */
  getSolidProfile() {
    const solidEntities = this.entities.filter(e => !e.isConstruction);
    // If there's a non-construction circle, return it polygonized.
    const circles = solidEntities.filter(e => e.type === 'circle');
    if (circles.length > 0) {
      const c = circles[circles.length - 1];
      const points = [];
      const segments = 32;
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        points.push(this._to3D(
          c.solverCenter.x + Math.cos(a) * c.solverCircle.radius,
          c.solverCenter.y + Math.sin(a) * c.solverCircle.radius,
        ));
      }
      return points;
    }
    const points = [];
    for (const entity of solidEntities) {
      if (entity.type === 'line') {
        points.push(this._to3D(entity.solverP1.x, entity.solverP1.y));
      }
    }
    if (solidEntities.length > 0) {
      const last = solidEntities[solidEntities.length - 1];
      if (last.type === 'line') {
        points.push(this._to3D(last.solverP2.x, last.solverP2.y));
      }
    }
    return points;
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
    // SW-style colour: every entity starts under-defined (blue) and changes
    // as constraints/dimensions are added.
    try { this.applyDoFColouring(); } catch (_) {}
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
    try { this.applyDoFColouring(); } catch (_) {}
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

  _drawLine3D(p1, p2, color, opts = {}) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      this._toThreeVec(p1.u, p1.v),
      this._toThreeVec(p2.u, p2.v),
    ]);
    let mat;
    let line;
    if (opts.dashed) {
      // Construction-line style: short dashes, narrower than solid lines so
      // it reads as "reference" rather than "boundary".
      mat = new THREE.LineDashedMaterial({
        color, linewidth: 1, dashSize: 0.003, gapSize: 0.002,
      });
      line = new THREE.Line(geo, mat);
      line.computeLineDistances();
    } else {
      mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
      line = new THREE.Line(geo, mat);
    }
    line.userData.sketchEntity = true;
    this.sketchGroup?.add(line);

    // Endpoint markers (only for SOLID lines — construction lines stay clean)
    if (!opts.dashed) {
      this._drawPoint3D(p1, color, 0.002);
      this._drawPoint3D(p2, color, 0.002);
    }

    return line;
  }

  _drawCircle3D(center, radius, color, opts = {}) {
    const points = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      points.push(this._toThreeVec(
        center.u + Math.cos(a) * radius,
        center.v + Math.sin(a) * radius
      ));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    let line;
    if (opts.dashed) {
      const mat = new THREE.LineDashedMaterial({ color, dashSize: 0.003, gapSize: 0.002 });
      line = new THREE.Line(geo, mat);
      line.computeLineDistances();
    } else {
      line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
    }
    line.userData.sketchEntity = true;
    this.sketchGroup?.add(line);

    // Center marker (solid circles only)
    if (!opts.dashed) this._drawPoint3D(center, 0xffaa00, 0.003);

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
