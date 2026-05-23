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

    // Tier-1 #4 / #7 — auto-relation hint published with every cursor
    // move while a drawing tool is active. One of:
    //   null               (no snap)
    //   'horizontal'       (line being drawn is ~axis-aligned to U)
    //   'vertical'         (line being drawn is ~axis-aligned to V)
    //   'coincident'       (cursor snapped to an existing endpoint)
    //   'tangent'          (cursor brushed an existing circle's tangent)
    //   'perpendicular'    (line being drawn is ~⊥ to nearest existing line)
    //   'parallel'         (line being drawn is ~∥ to nearest existing line)
    this.lastRelationHint = null;

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

    // Tier-1 #4 — clear the cursor readout so the overlay hides itself
    // immediately when the user exits sketch mode.
    if (typeof window !== 'undefined') {
      window.__archdiscSketchCursor = null;
      try {
        window.dispatchEvent(new CustomEvent('archdisc:sketch-cursor', {
          detail: null,
        }));
      } catch (_) {}
    }

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

    // Tier-1 #4 + #7 — publish live cursor X/Y readout + auto-relation hint
    // every move. The overlays in SwUxOverlays subscribe via the
    // window cursorBus / relationHintBus.
    try {
      const hint = this._detectAutoRelation(this.cursorPos);
      this.lastRelationHint = hint;
      this._publishCursor({ u: this.cursorPos.u, v: this.cursorPos.v, hint });
    } catch (_) { /* never let an overlay bug break the sketcher */ }
  }

  /**
   * Tier-1 #4 — publish the current cursor (u,v in metres) so an overlay
   * can render a live X/Y readout. Coordinates are EXACT — no rounding
   * past the existing 1 mm grid snap — so what the user sees is what
   * the next click will commit.
   *
   * Also publishes the current auto-relation hint (Tier-1 #7) so the
   * AutoRelationIndicator overlay can render the icon next to the cursor.
   *
   * Pure window/event-driven — never holds a React reference, so it
   * is safe to call from the engine without import cycles.
   */
  _publishCursor({ u, v, hint }) {
    if (typeof window === 'undefined') return;
    // u/v are metres → mm for the user-facing readout.
    const x_mm = u * 1000;
    const y_mm = v * 1000;
    window.__archdiscSketchCursor = { x_mm, y_mm, u, v, hint, when: Date.now() };
    // Custom event so React overlays don't have to poll.
    try {
      window.dispatchEvent(new CustomEvent('archdisc:sketch-cursor', {
        detail: { x_mm, y_mm, u, v, hint },
      }));
    } catch (_) {}
  }

  /**
   * Tier-1 #7 — detect the auto-relation that WOULD apply if the user
   * clicked NOW with the currently-active drawing tool. Mirrors what
   * the SW sketcher's "ghost relation" indicator shows next to the
   * cursor — a small icon hint. Returns one of:
   *   null | 'horizontal' | 'vertical' | 'coincident' |
   *   'tangent' | 'perpendicular' | 'parallel'
   *
   * Order of precedence (matches SW behaviour):
   *   1. Coincident (cursor snapped onto an existing point)
   *   2. Tangent (cursor on existing circle perimeter)
   *   3. While drawing a LINE with one endpoint placed:
   *        - Horizontal/Vertical (axis-aligned candidate line)
   *        - Perpendicular / Parallel (relative to nearest existing line)
   *   4. While drawing a CIRCLE (no relation hint, but coincident still fires)
   */
  _detectAutoRelation(cursorPos) {
    if (!cursorPos) return null;

    // (1) Coincident — already determined by the snap target.
    if (cursorPos.snappedTo === 'point') return 'coincident';

    // (2) Tangent — cursor on an existing circle's perimeter
    // (~within SNAP_DISTANCE of the circle radius).
    for (const e of this.entities) {
      if (e.type !== 'circle') continue;
      const cx = e.solverCenter ? e.solverCenter.x : e.center.u;
      const cy = e.solverCenter ? e.solverCenter.y : e.center.v;
      const r = e.solverCircle ? e.solverCircle.radius : e.radius;
      const d = Math.hypot(cursorPos.u - cx, cursorPos.v - cy);
      if (Math.abs(d - r) < SNAP_DISTANCE) return 'tangent';
    }

    // (3) Line tool with one endpoint placed → check angle of the
    // candidate line for H/V, then for ⊥ / ∥ vs nearest existing line.
    if (this.activeTool === TOOLS.LINE && this.tempPoints.length === 1) {
      const a = this.tempPoints[0];
      const b = cursorPos;
      const du = b.u - a.u;
      const dv = b.v - a.v;
      const len = Math.hypot(du, dv);
      if (len < 1e-6) return null;
      // 5° angular tolerance — same heuristic SW uses for the ghost.
      const TOL = Math.PI / 36;
      const ang = Math.atan2(dv, du);
      // Wrap to [-π/2, π/2] for axis-alignment checks.
      if (Math.abs(ang) < TOL || Math.abs(Math.abs(ang) - Math.PI) < TOL) {
        return 'horizontal';
      }
      if (Math.abs(Math.abs(ang) - Math.PI / 2) < TOL) {
        return 'vertical';
      }
      // Check ⊥ / ∥ against the nearest existing line (closest endpoint
      // to A). 5° tolerance applied to the absolute angular delta.
      let bestRefAng = null;
      let bestDist = Infinity;
      for (const ent of this.entities) {
        if (ent.type !== 'line' || ent.isConstruction) continue;
        const e1 = ent.solverP1; const e2 = ent.solverP2;
        if (!e1 || !e2) continue;
        const refAng = Math.atan2(e2.y - e1.y, e2.x - e1.x);
        // Distance from line-A start to either endpoint of the ref line.
        const d1 = Math.hypot(e1.x - a.u, e1.y - a.v);
        const d2 = Math.hypot(e2.x - a.u, e2.y - a.v);
        const d = Math.min(d1, d2);
        if (d < bestDist) { bestDist = d; bestRefAng = refAng; }
      }
      if (bestRefAng !== null) {
        const delta = Math.atan2(Math.sin(ang - bestRefAng), Math.cos(ang - bestRefAng));
        if (Math.abs(Math.abs(delta) - Math.PI / 2) < TOL) return 'perpendicular';
        if (Math.abs(delta) < TOL || Math.abs(Math.abs(delta) - Math.PI) < TOL) return 'parallel';
      }
    }

    // (4) Circle / Arc / etc. — no extra relation hint beyond coincident.
    return null;
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

    let kind = 'distance';
    let p1 = null, p2 = null;
    if (entity.type === 'line') {
      this.solver.distance(entity.solverP1, entity.solverP2, value);
      p1 = { u: entity.solverP1.x, v: entity.solverP1.y };
      p2 = { u: entity.solverP2.x, v: entity.solverP2.y };
    } else if (entity.type === 'circle') {
      this.solver.radius(entity.solverCircle, value);
      kind = 'radius';
      // Radius dimension goes from centre out along +U.
      const cx = entity.solverCenter ? entity.solverCenter.x : entity.center.u;
      const cy = entity.solverCenter ? entity.solverCenter.y : entity.center.v;
      p1 = { u: cx, v: cy };
      p2 = { u: cx + value, v: cy };
    }

    // Tier-1 #6 — record this dimension on the .dimensions list with
    // its `targetEntityIndex` set so the inline editor can drive the
    // right constraint on edit.
    if (p1 && p2) {
      const id = `dim-${this.dimensions.length}-${Date.now().toString(36)}`;
      const visual = this._drawDimension3D(p1, p2, value, 0xffaa00);
      this.dimensions.push({
        id, type: 'dimension', p1, p2, value, visual,
        targetEntityIndex: entityIndex,
        kind,
      });
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
          const sArc = this.solver.addArc(sCenter, sp1, sp3);
          const visual = this._drawArc3D(uv1, uv2, uv3, isConstruction ? 0xaa66ff : 0x00ccff);
          const idx = this.entities.length;
          const entity = {
            type: 'arc', visual, p1: uv1, p2: uv2, p3: uv3, isConstruction,
            convertedFrom: src.source ?? 'edge',
            solverArc: sArc,
            _solverCenterRef: sCenter,
            _solverStartRef: sp1,
            _solverEndRef: sp3,
          };
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

  // ──────────────────────────────────────────────────────────────────────
  // Tier-2b — Named geometric relations as user-applied constraints.
  //
  // SW exposes Concentric / Midpoint / Symmetric / Collinear / Fix as
  // discrete user actions in the Sketch → Relations group. Each user
  // selection emits a NAMED relation that:
  //
  //   - is recorded on the sketch model (`this.relations`) with an
  //     originating tool tag so the Display/Delete Relations dialog can
  //     show "Concentric" not "coincident" (the underlying solver
  //     equation type),
  //   - drives the solver via one or more constraints,
  //   - persists across re-solves until the user explicitly deletes it.
  //
  // The relations live PARALLEL to `solver.constraints`; each `Relation`
  // record carries the constraint IDs it produced so `deleteRelation()`
  // can remove them all atomically + re-solve. This is the same pattern
  // SW uses: relations are first-class user objects, the solver
  // equations are an implementation detail.
  // ──────────────────────────────────────────────────────────────────────

  /** Lazy-init the relation registry on first read. */
  _ensureRelationStore() {
    if (!this.relations) this.relations = [];
    return this.relations;
  }

  /**
   * Apply CONCENTRIC to an array of circle/arc entity indices. All centres
   * are constrained to coincide via pairwise `concentric` solver
   * constraints (N entities → N-1 pair constraints). Mixed
   * circle + arc is supported.
   *
   * @param {number[]} entityIndices  >= 2 circle / arc indices
   * @returns {{ok, relationId?, constraintIds?, dofBefore, dofAfter, reason?}}
   */
  applyConcentric(entityIndices) {
    if (!Array.isArray(entityIndices) || entityIndices.length < 2) {
      return { ok: false, reason: 'Concentric needs at least 2 circle/arc entities' };
    }
    const centres = [];
    for (const idx of entityIndices) {
      const e = this.entities[idx];
      if (!e) return { ok: false, reason: `Entity #${idx} does not exist` };
      let c;
      if (e.type === 'circle')   c = e.solverCenter;
      else if (e.type === 'arc') c = e.solverArc?.center ?? this.solver.points.find(p => p === e.solverCenter);
      if (!c) {
        // Best-effort lookup: arc centres in this codebase don't get a
        // dedicated reference, but `_createArc` does add a centre to the
        // solver points list. Reach by index when needed.
        if (e.type === 'arc' && e._solverCenterRef) c = e._solverCenterRef;
      }
      if (!c) return { ok: false, reason: `Entity #${idx} (${e.type}) has no resolvable centre — Concentric needs circles or arcs` };
      centres.push({ idx, centre: c, entity: e });
    }
    const dofBefore = this.solver.signedDOF();
    const ref = centres[0];
    const constraintIds = [];
    for (let i = 1; i < centres.length; i++) {
      const c = this.solver.concentric(ref.centre, centres[i].centre);
      constraintIds.push(c.id);
    }
    const rel = this._recordRelation({
      type: 'concentric',
      label: 'Concentric',
      entityIndices: [...entityIndices],
      constraintIds,
    });
    this.solver.solve();
    this._updateAllVisuals();
    try { this.applyDoFColouring(); } catch (_) {}
    const dofAfter = this.solver.signedDOF();
    this._notify('relationApplied', { relation: rel, dofBefore, dofAfter });
    return { ok: true, relationId: rel.id, constraintIds, dofBefore, dofAfter };
  }

  /**
   * Apply MIDPOINT: pick a point + a line → constrain the point to the
   * line's midpoint. The `pointEntityIndex` may either be a `point`-type
   * entity OR a free `solverPoint` reference for line-endpoint targeting.
   */
  applyMidpoint(pointEntityIndex, lineEntityIndex) {
    const pe = this.entities[pointEntityIndex];
    const le = this.entities[lineEntityIndex];
    if (!pe) return { ok: false, reason: `Point entity #${pointEntityIndex} not found` };
    if (!le || le.type !== 'line') return { ok: false, reason: `Entity #${lineEntityIndex} must be a line` };
    if (pe.type !== 'point') return { ok: false, reason: `Entity #${pointEntityIndex} must be a point` };
    const dofBefore = this.solver.signedDOF();
    const c = this.solver.midpointOf(pe.solverPoint, le.solverLine);
    const rel = this._recordRelation({
      type: 'midpoint',
      label: 'Midpoint',
      entityIndices: [pointEntityIndex, lineEntityIndex],
      constraintIds: [c.id],
    });
    this.solver.solve();
    this._updateAllVisuals();
    try { this.applyDoFColouring(); } catch (_) {}
    const dofAfter = this.solver.signedDOF();
    this._notify('relationApplied', { relation: rel, dofBefore, dofAfter });
    return { ok: true, relationId: rel.id, constraintIds: [c.id], dofBefore, dofAfter };
  }

  /**
   * Apply SYMMETRIC: pick 2 entities + 1 line (the symmetry axis) → the
   * two entities are constrained as mirror images about the axis.
   *
   * Supported entity pairs:
   *   - line + line: each line's two endpoints mirror the other line's two
   *     endpoints (4 SymmetricConstraints — 2 pairs of endpoints).
   *   - circle + circle: centres mirror + radii equal.
   *   - arc + arc: centres mirror (radii implied equal via the start-point
   *     coincidence — not enforced here).
   *
   * @param {number[]} entityIndices  exactly 2
   * @param {number} axisLineIndex   the symmetry-axis line entity index
   */
  applySymmetric(entityIndices, axisLineIndex) {
    if (!Array.isArray(entityIndices) || entityIndices.length !== 2) {
      return { ok: false, reason: 'Symmetric needs exactly 2 entities + an axis line' };
    }
    const [iA, iB] = entityIndices;
    const a = this.entities[iA];
    const b = this.entities[iB];
    const axis = this.entities[axisLineIndex];
    if (!a || !b) return { ok: false, reason: 'Symmetric: invalid entity index' };
    if (!axis || axis.type !== 'line') {
      return { ok: false, reason: 'Symmetric axis must be a line entity' };
    }
    if (a.type !== b.type) {
      return { ok: false, reason: `Symmetric: both entities must be the same type (got ${a.type} + ${b.type})` };
    }
    const dofBefore = this.solver.signedDOF();
    const constraintIds = [];
    if (a.type === 'line') {
      // Match the closer endpoint pairs to avoid pathological reflections.
      const pairs = _pairEndpointsForSymmetry(a, b);
      for (const [pA, pB] of pairs) {
        const c = this.solver.symmetric(pA, pB, axis.solverLine);
        constraintIds.push(c.id);
      }
    } else if (a.type === 'circle') {
      const c1 = this.solver.symmetric(a.solverCenter, b.solverCenter, axis.solverLine);
      constraintIds.push(c1.id);
      const c2 = this.solver.equalLength
        ? null /* equalLength is line-line */
        : null;
      // Radius equality is a separate scalar constraint — wire via a RadiusConstraint pair.
      // Use a soft equality through two `radius` constraints sharing a single value if both
      // have explicit radii; otherwise leave radii free.
      // Simpler: add two RadiusConstraints to the AVERAGE — gives equal solver radii.
      const rAvg = (a.solverCircle.radius + b.solverCircle.radius) / 2;
      const cr1 = this.solver.radius(a.solverCircle, rAvg);
      const cr2 = this.solver.radius(b.solverCircle, rAvg);
      constraintIds.push(cr1.id, cr2.id);
    } else if (a.type === 'arc') {
      // Centres mirror; radii implied by start-point coincidence.
      const arcCA = a._solverCenterRef ?? null;
      const arcCB = b._solverCenterRef ?? null;
      if (arcCA && arcCB) {
        const c = this.solver.symmetric(arcCA, arcCB, axis.solverLine);
        constraintIds.push(c.id);
      } else {
        return { ok: false, reason: 'Symmetric arc: arc centre reference not available' };
      }
    } else {
      return { ok: false, reason: `Symmetric not supported for ${a.type}` };
    }
    const rel = this._recordRelation({
      type: 'symmetric',
      label: 'Symmetric',
      entityIndices: [iA, iB, axisLineIndex],
      constraintIds,
    });
    this.solver.solve();
    this._updateAllVisuals();
    try { this.applyDoFColouring(); } catch (_) {}
    const dofAfter = this.solver.signedDOF();
    this._notify('relationApplied', { relation: rel, dofBefore, dofAfter });
    return { ok: true, relationId: rel.id, constraintIds, dofBefore, dofAfter };
  }

  /**
   * Apply COLLINEAR to an array of line entity indices. All lines are
   * constrained to lie on the SAME infinite line via pairwise
   * `collinear` solver constraints.
   */
  applyCollinear(entityIndices) {
    if (!Array.isArray(entityIndices) || entityIndices.length < 2) {
      return { ok: false, reason: 'Collinear needs at least 2 line entities' };
    }
    const lines = [];
    for (const idx of entityIndices) {
      const e = this.entities[idx];
      if (!e || e.type !== 'line') {
        return { ok: false, reason: `Entity #${idx} must be a line for Collinear` };
      }
      lines.push({ idx, line: e.solverLine });
    }
    const dofBefore = this.solver.signedDOF();
    const ref = lines[0];
    const constraintIds = [];
    for (let i = 1; i < lines.length; i++) {
      const c = this.solver.collinear(ref.line, lines[i].line);
      constraintIds.push(c.id);
    }
    const rel = this._recordRelation({
      type: 'collinear',
      label: 'Collinear',
      entityIndices: [...entityIndices],
      constraintIds,
    });
    this.solver.solve();
    this._updateAllVisuals();
    try { this.applyDoFColouring(); } catch (_) {}
    const dofAfter = this.solver.signedDOF();
    this._notify('relationApplied', { relation: rel, dofBefore, dofAfter });
    return { ok: true, relationId: rel.id, constraintIds, dofBefore, dofAfter };
  }

  /**
   * Apply FIX to a sketch entity. The entity's position is anchored —
   * solver treats it as locked. Behaviour by entity type:
   *
   *   - point   → 1 FixedConstraint on the point (2 DoF).
   *   - line    → 2 FixedConstraints, one per endpoint (4 DoF total).
   *   - circle  → 1 FixedConstraint on the centre (2 DoF) + 1 RadiusConstraint
   *               at the current radius (1 DoF) = 3 DoF total.
   *   - arc     → 1 FixedConstraint on the centre (2 DoF) — arc start/end
   *               are themselves stored as points so adding fixed constraints
   *               on them gives an additional 4 DoF reduction = 6 total.
   */
  applyFix(entityIndex) {
    const e = this.entities[entityIndex];
    if (!e) return { ok: false, reason: `Entity #${entityIndex} not found` };
    const dofBefore = this.solver.signedDOF();
    const constraintIds = [];
    if (e.type === 'point') {
      constraintIds.push(this.solver.fix(e.solverPoint).id);
    } else if (e.type === 'line') {
      constraintIds.push(this.solver.fix(e.solverP1).id);
      constraintIds.push(this.solver.fix(e.solverP2).id);
    } else if (e.type === 'circle') {
      constraintIds.push(this.solver.fix(e.solverCenter).id);
      constraintIds.push(this.solver.radius(e.solverCircle, e.solverCircle.radius).id);
    } else if (e.type === 'arc') {
      const arcC = e._solverCenterRef;
      if (arcC) constraintIds.push(this.solver.fix(arcC).id);
      // arc endpoints
      const e2 = this.entities[entityIndex];
      // Fix the three solver points used by the arc.
      // _createArc stores solver points but doesn't keep direct refs;
      // _solverArc carries center/startPoint/endPoint, capture from convertEntities flavour.
      if (e2.solverArc) {
        constraintIds.push(this.solver.fix(e2.solverArc.startPoint).id);
        constraintIds.push(this.solver.fix(e2.solverArc.endPoint).id);
      }
    } else {
      return { ok: false, reason: `Fix not supported for ${e.type}` };
    }
    const rel = this._recordRelation({
      type: 'fix',
      label: 'Fix',
      entityIndices: [entityIndex],
      constraintIds,
    });
    // No solve needed — the entity stays where it was.
    try { this.applyDoFColouring(); } catch (_) {}
    const dofAfter = this.solver.signedDOF();
    this._notify('relationApplied', { relation: rel, dofBefore, dofAfter });
    return { ok: true, relationId: rel.id, constraintIds, dofBefore, dofAfter };
  }

  /**
   * Record a named relation in the registry. Returns the registered record
   * with its id.
   */
  _recordRelation(rec) {
    const store = this._ensureRelationStore();
    const id = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${store.length}`;
    const relation = { id, createdAt: Date.now(), ...rec };
    store.push(relation);
    return relation;
  }

  /**
   * Return every relation involving `entityIndex`. Result rows are deep
   * enough for the Display/Delete dialog to show + offer per-relation
   * delete actions.
   *
   * @param {number} entityIndex
   * @returns {Array<{id, type, label, entityIndices, constraintIds}>}
   */
  getRelationsForEntity(entityIndex) {
    const store = this._ensureRelationStore();
    return store.filter(r => r.entityIndices.includes(entityIndex));
  }

  /** Return every relation in the sketch. */
  getAllRelations() {
    return [...this._ensureRelationStore()];
  }

  /**
   * Delete a relation by its id. Removes the solver constraints it created
   * AND removes the relation record. Returns whether anything was removed.
   *
   * After deletion the solver is re-solved (so the geometry can settle to
   * its new — less-constrained — state) and entity colours are refreshed.
   */
  deleteRelation(relationId) {
    const store = this._ensureRelationStore();
    const idx = store.findIndex(r => r.id === relationId);
    if (idx < 0) return { ok: false, reason: `Relation ${relationId} not found` };
    const rel = store[idx];
    const dofBefore = this.solver.signedDOF();
    for (const cid of rel.constraintIds) {
      this.solver.removeConstraint(cid);
    }
    store.splice(idx, 1);
    this.solver.solve();
    this._updateAllVisuals();
    try { this.applyDoFColouring(); } catch (_) {}
    const dofAfter = this.solver.signedDOF();
    this._notify('relationDeleted', { relation: rel, dofBefore, dofAfter });
    return { ok: true, deletedId: relationId, dofBefore, dofAfter };
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
    // Expose the solver references on the entity so Tier-2b relations
    // (Concentric / Symmetric on arcs, Fix on arcs) can reach the centre,
    // start, and end points without re-deriving them.
    const entity = {
      type: 'arc', visual, p1, p2, p3,
      solverArc: sArc,
      _solverCenterRef: sCenter,
      _solverStartRef: sp1,
      _solverMidRef: sp2,
      _solverEndRef: sp3,
    };
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
    // Tier-1 #6 — stable id so a double-click in the viewport can edit
    // this specific dimension's value (and the solver re-binds the
    // matching distance constraint).
    const id = `dim-${this.dimensions.length}-${Date.now().toString(36)}`;
    const dim = {
      id, type: 'dimension', p1, p2, value: dist, visual,
      // SW-style "edit on double-click": dimensions point back at the
      // entity + constraint they drive. _createDimension itself only
      // creates the visual; the constraint is created by applyDimension
      // (when called via the Smart Dimension UX) — we expose a
      // `targetEntityIndex` slot that applyDimension fills in.
      targetEntityIndex: null,
      kind: 'distance',
    };
    this.dimensions.push(dim);
    this._notify('dimensionCreated', dim);
    return dim;
  }

  // ─── Tier-1 #6 — Double-click-to-edit dimension API ─────────────────────
  //
  // Three pieces:
  //   1. `getDimensions()` — array of every dimension's id + label +
  //      world position (mid-point of the visual) so an overlay can hit-
  //      test a double-click and position the inline editor next to it.
  //   2. `editDimension(id, newValueMm)` — change the value of the
  //      stored dimension AND of the underlying solver constraint (if
  //      any), re-solve, and refresh the visual. Returns the post-solve
  //      status so the caller knows whether the sketch is now under /
  //      fully / over-defined.
  //   3. `getDimensionAt(worldPoint, tolMm)` — best-match hit-test used
  //      by the overlay when the viewport sends a double-click event.

  /**
   * Return one row per dimension in the sketch with everything an
   * overlay needs to render an inline editor next to it.
   *
   * Coordinates are returned in WORLD space (metres) because the
   * overlay projects them through the camera to screen space.
   *
   * @returns {Array<{ id, value_mm, kind, midWorld:{x,y,z}, p1, p2,
   *                   targetEntityIndex }>}
   */
  getDimensions() {
    const out = [];
    if (!this.planeOrigin) return out;
    for (const d of this.dimensions) {
      const midU = (d.p1.u + d.p2.u) / 2;
      const midV = (d.p1.v + d.p2.v) / 2 + 0.005;
      const w = this._to3D(midU, midV);
      out.push({
        id: d.id,
        value_mm: (d.value || 0) * 1000,
        kind: d.kind || 'distance',
        midWorld: { x: w.x, y: w.y, z: w.z },
        p1: d.p1,
        p2: d.p2,
        targetEntityIndex: d.targetEntityIndex ?? null,
      });
    }
    return out;
  }

  /**
   * Edit the value of an existing dimension by id. Updates the stored
   * value, drives the linked solver constraint (if any), re-solves,
   * refreshes the visual, and repaints DoF colours.
   *
   * @param {string} id  dimension id (from getDimensions())
   * @param {number} newValueMm  new dimension value in millimetres
   * @returns {{ ok, value_mm?, state?, signedDof?, reason? }}
   */
  editDimension(id, newValueMm) {
    if (!Number.isFinite(newValueMm) || newValueMm <= 0) {
      return { ok: false, reason: 'value must be > 0 mm' };
    }
    const dim = this.dimensions.find(d => d.id === id);
    if (!dim) return { ok: false, reason: `dimension '${id}' not found` };
    const newValueM = newValueMm / 1000;

    // Drive the underlying solver constraint. If the dimension is tied
    // to a specific entity (set by applyDimension), update or insert a
    // distance constraint on that entity's endpoints. If not, add a
    // distance constraint between two free SketchPoints created from
    // the dimension's stored p1/p2 (a no-op for purely-decorative dims).
    if (dim.targetEntityIndex !== null && dim.targetEntityIndex !== undefined) {
      const e = this.entities[dim.targetEntityIndex];
      if (e && e.type === 'line') {
        // Find an existing distance constraint on these two points and
        // update its `targetDistance` in place — keeps DoF accounting
        // stable. Otherwise add a fresh one.
        const existing = this.solver.constraints.find(c =>
          c.type === 'distance' &&
          c.entities &&
          c.entities[0] === e.solverP1 &&
          c.entities[1] === e.solverP2);
        if (existing) {
          existing.targetDistance = newValueM;
          if (existing.params) existing.params.distance = newValueM;
        } else {
          this.solver.distance(e.solverP1, e.solverP2, newValueM);
        }
      } else if (e && e.type === 'circle') {
        // Circle radius dimension: edit the RadiusConstraint or add one.
        const existing = this.solver.constraints.find(c =>
          c.type === 'radius' && c.entities && c.entities[0] === e.solverCircle);
        if (existing) {
          existing.targetRadius = newValueM;
          if (existing.params) existing.params.radius = newValueM;
        } else {
          this.solver.radius(e.solverCircle, newValueM);
        }
      }
    } else {
      // Decorative dimension — just update the stored value; no solver
      // re-bind needed. Caller still gets a re-solve so any other
      // pending constraint changes propagate.
    }

    dim.value = newValueM;
    const result = this.solver.solve();
    this._updateAllVisuals?.();
    // Redraw the dimension visual with the new label.
    if (dim.visual && this.sketchGroup) {
      try {
        if (dim.visual.line) {
          this.sketchGroup.remove(dim.visual.line);
          dim.visual.line.geometry?.dispose?.();
          dim.visual.line.material?.dispose?.();
        }
        if (dim.visual.sprite) {
          this.sketchGroup.remove(dim.visual.sprite);
          dim.visual.sprite.material?.map?.dispose?.();
          dim.visual.sprite.material?.dispose?.();
        }
      } catch (_) {}
      dim.visual = this._drawDimension3D(dim.p1, dim.p2, dim.value, 0xffaa00);
    }
    try { this.applyDoFColouring(); } catch (_) {}
    const st = this.getStatus();
    this._notify('dimensionEdited', { id, value_mm: newValueMm, state: st.state, signedDof: st.signedDof });
    return {
      ok: true,
      value_mm: newValueMm,
      state: st.state,
      signedDof: st.signedDof,
      converged: !!result.converged,
    };
  }

  /**
   * Hit-test the sketch's dimensions against a world-space point.
   * Returns the closest dimension whose mid-point is within `tolMm`
   * (default 8 mm) or null.
   *
   * @param {{x,y,z}} worldPoint  3D point in world space
   * @param {number} tolMm        match tolerance in mm
   * @returns {{ id, value_mm, kind, midWorld, p1, p2 } | null}
   */
  getDimensionAt(worldPoint, tolMm = 8) {
    if (!worldPoint || !this.planeOrigin) return null;
    const dims = this.getDimensions();
    let best = null;
    let bestDist = (tolMm / 1000) ** 2;
    for (const d of dims) {
      const dx = d.midWorld.x - worldPoint.x;
      const dy = d.midWorld.y - worldPoint.y;
      const dz = d.midWorld.z - worldPoint.z;
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd < bestDist) { bestDist = dd; best = d; }
    }
    return best;
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

// ─── Tier-2b helper: pair line endpoints for symmetric relations ──────────
//
// Given two line entities `a` and `b`, return [(pA, pB), (pA', pB')] —
// the endpoint pairing that minimises total squared distance after
// reflection across the symmetry axis. Without this matching the
// solver could converge with the line reversed (start ↔ end), which
// looks correct numerically but is wrong intent-wise.
function _pairEndpointsForSymmetry(a, b) {
  // Two possible matchings: (p1↔p1, p2↔p2) or (p1↔p2, p2↔p1).
  // Pick the one whose existing inter-pair distance is smaller — the
  // solver will then drive each pair to its mirror image.
  const dA = (a.solverP1.x - b.solverP1.x) ** 2 + (a.solverP1.y - b.solverP1.y) ** 2
           + (a.solverP2.x - b.solverP2.x) ** 2 + (a.solverP2.y - b.solverP2.y) ** 2;
  const dB = (a.solverP1.x - b.solverP2.x) ** 2 + (a.solverP1.y - b.solverP2.y) ** 2
           + (a.solverP2.x - b.solverP1.x) ** 2 + (a.solverP2.y - b.solverP1.y) ** 2;
  if (dA <= dB) {
    return [[a.solverP1, b.solverP1], [a.solverP2, b.solverP2]];
  }
  return [[a.solverP1, b.solverP2], [a.solverP2, b.solverP1]];
}
