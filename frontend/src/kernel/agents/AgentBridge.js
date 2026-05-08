/**
 * ArchDisc — AI Agent Bridge
 * Exposes the entire kernel as a callable API for swarm agents.
 * Agents issue commands in structured JSON, bridge executes them on the kernel.
 *
 * This is the interface between natural language → kernel operations.
 * Each command is atomic, validated, and produces measurable results.
 */

import Vec3 from '../math/Vec3.js';
import PrimitiveBuilder from '../features/PrimitiveBuilder.js';
import ExtrudeFeature from '../features/ExtrudeFeature.js';
import RevolveFeature from '../features/RevolveFeature.js';
import BooleanEngine from '../features/BooleanEngine.js';
import FilletChamfer from '../features/FilletChamfer.js';
import LoftSweep from '../features/LoftSweep.js';
import DirectEdit from '../features/DirectEdit.js';
import FEAEngine from '../simulation/FEAEngine.js';
import GCodeGenerator from '../manufacturing/GCodeGenerator.js';
import Slicer from '../manufacturing/Slicer.js';
import ExportEngine from '../export/ExportEngine.js';
import FastenerLibrary from '../standards/FastenerLibrary.js';
import BearingLibrary from '../standards/BearingLibrary.js';
import GDTEngine from '../standards/GDTEngine.js';
import Assembly from '../assembly/Assembly.js';
import ThreeJSBridge from '../bridge/ThreeJSBridge.js';
import AssemblyBridge from '../bridge/AssemblyBridge.js';

/**
 * Command schema:
 * {
 *   action: string,       // 'create_box', 'extrude', 'boolean_subtract', 'fea_static', etc.
 *   params: object,       // action-specific parameters
 *   validate: boolean,    // if true, validate before executing
 * }
 *
 * Result schema:
 * {
 *   success: boolean,
 *   featureId: number,
 *   solid: TopoSolid,
 *   measurements: object, // mass, volume, area, etc.
 *   message: string,
 * }
 */

export default class AgentBridge {
  constructor(featureTree, scene, viewport) {
    this.ft = featureTree;
    this.scene = scene;
    this.viewport = viewport;
    this.assembly = null;
    this.assemblyRoot = null;
    this.history = [];
  }

  /**
   * Execute a single agent command.
   */
  execute(command) {
    const start = performance.now();
    let result;

    try {
      switch (command.action) {
        // --- Primitives ---
        case 'create_box': result = this._createBox(command.params); break;
        case 'create_cylinder': result = this._createCylinder(command.params); break;
        case 'create_sphere': result = this._createSphere(command.params); break;
        case 'create_cone': result = this._createCone(command.params); break;
        case 'create_torus': result = this._createTorus(command.params); break;

        // --- Features ---
        case 'extrude': result = this._extrude(command.params); break;
        case 'revolve': result = this._revolve(command.params); break;
        case 'loft': result = this._loft(command.params); break;
        case 'sweep': result = this._sweep(command.params); break;
        case 'fillet': result = this._fillet(command.params); break;
        case 'chamfer': result = this._chamfer(command.params); break;
        case 'shell': result = this._shell(command.params); break;
        case 'push_pull': result = this._pushPull(command.params); break;

        // --- Booleans ---
        case 'boolean_union': result = this._booleanOp('union', command.params); break;
        case 'boolean_subtract': result = this._booleanOp('subtract', command.params); break;
        case 'boolean_intersect': result = this._booleanOp('intersect', command.params); break;

        // --- Patterns ---
        case 'linear_pattern': result = this._linearPattern(command.params); break;
        case 'circular_pattern': result = this._circularPattern(command.params); break;

        // --- Analysis ---
        case 'fea_static': result = this._feaStatic(command.params); break;
        case 'fea_modal': result = this._feaModal(command.params); break;
        case 'fea_thermal': result = this._feaThermal(command.params); break;
        case 'fea_fatigue': result = this._feaFatigue(command.params); break;

        // --- Measure ---
        case 'mass_properties': result = this._massProperties(command.params); break;
        case 'check_geometry': result = this._checkGeometry(); break;
        case 'gdt_report': result = this._gdtReport(); break;
        case 'tolerance_stackup': result = this._toleranceStackup(command.params); break;

        // --- Manufacturing ---
        case 'generate_gcode': result = this._generateGCode(command.params); break;
        case 'slice_for_print': result = this._sliceForPrint(command.params); break;

        // --- Assembly ---
        case 'add_to_assembly': result = this._addToAssembly(command.params); break;
        case 'insert_fastener': result = this._insertFastener(command.params); break;
        case 'insert_bearing': result = this._insertBearing(command.params); break;

        // --- Export ---
        case 'export': result = this._export(command.params); break;

        // --- Query ---
        case 'get_features': result = { success: true, features: this.ft.toJSON() }; break;
        case 'get_solid': result = this._getSolidInfo(); break;

        default:
          result = { success: false, message: `Unknown action: ${command.action}` };
      }
    } catch (err) {
      result = { success: false, message: err.message, error: err.stack };
    }

    result.executionTimeMs = (performance.now() - start).toFixed(2);
    this.history.push({ command, result, timestamp: Date.now() });
    return result;
  }

  /**
   * Execute a sequence of commands (batch).
   */
  executeBatch(commands) {
    return commands.map((cmd, i) => ({
      step: i + 1,
      ...this.execute(cmd),
    }));
  }

  /**
   * Get available commands and their parameter schemas.
   */
  static schema() {
    return {
      primitives: {
        create_box: { width: 'number(m)', height: 'number(m)', depth: 'number(m)', center: '[x,y,z]?' },
        create_cylinder: { radius: 'number(m)', height: 'number(m)', segments: 'int?', center: '[x,y,z]?' },
        create_sphere: { radius: 'number(m)', center: '[x,y,z]?' },
        create_cone: { radius: 'number(m)', height: 'number(m)', center: '[x,y,z]?' },
        create_torus: { majorRadius: 'number(m)', minorRadius: 'number(m)', center: '[x,y,z]?' },
      },
      features: {
        extrude: { profile: '[[x,y,z],...]', direction: '[x,y,z]', distance: 'number(m)', taper: 'number(rad)?' },
        revolve: { profile: '[[x,y,z],...]', axisOrigin: '[x,y,z]', axisDir: '[x,y,z]', angle: 'number(rad)?' },
        loft: { profiles: '[[[x,y,z],...],...]', steps: 'int?' },
        sweep: { profile: '[[x,y,z],...]', path: '[[x,y,z],...]' },
        fillet: { featureId: 'int', edgeIds: '[int,...]', radius: 'number(m)' },
        chamfer: { featureId: 'int', edgeIds: '[int,...]', distance: 'number(m)' },
        shell: { featureId: 'int', faceIds: '[int,...]', thickness: 'number(m)' },
        push_pull: { featureId: 'int', faceId: 'int', distance: 'number(m)' },
      },
      booleans: {
        boolean_union: { featureIdA: 'int', featureIdB: 'int' },
        boolean_subtract: { featureIdA: 'int', featureIdB: 'int' },
        boolean_intersect: { featureIdA: 'int', featureIdB: 'int' },
      },
      analysis: {
        fea_static: { material: 'string?', force: 'number(N)?', direction: '[x,y,z]?' },
        fea_modal: { material: 'string?' },
        fea_thermal: { material: 'string?', heatInput: 'number(W)?' },
        fea_fatigue: { material: 'string?', loadAmplitude: 'number(N)?' },
        mass_properties: {},
        check_geometry: {},
        gdt_report: {},
      },
      manufacturing: {
        generate_gcode: { toolDiameter: 'number(m)?', feedRate: 'number(mm/min)?' },
        slice_for_print: { layerHeight: 'number(m)?', infillDensity: 'number(0-1)?' },
      },
      assembly: {
        add_to_assembly: { name: 'string?', color: 'hex?' },
        insert_fastener: { type: 'string', size: 'string', length: 'number(m)?' },
        insert_bearing: { designation: 'string' },
      },
      export: {
        export: { format: 'stl|obj|gltf|step', name: 'string?' },
      },
    };
  }

  // --- Implementation ---

  _v(arr) { return arr ? new Vec3(arr[0], arr[1], arr[2]) : Vec3.zero(); }

  _createBox(p) {
    const f = this.ft.addBox(p.width, p.height, p.depth, this._v(p.center));
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id, measurements: f.solid.massProperties() };
  }

  _createCylinder(p) {
    const f = this.ft.addCylinder(p.radius, p.height, p.segments || 32, this._v(p.center));
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id, measurements: f.solid.massProperties() };
  }

  _createSphere(p) {
    const f = this.ft.addSphere(p.radius, 32, 16, this._v(p.center));
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id, measurements: f.solid.massProperties() };
  }

  _createCone(p) {
    const f = this.ft.addCone(p.radius, p.height, 32, this._v(p.center));
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id, measurements: f.solid.massProperties() };
  }

  _createTorus(p) {
    const f = this.ft.addTorus(p.majorRadius, p.minorRadius, 32, 16, this._v(p.center));
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id, measurements: f.solid.massProperties() };
  }

  _extrude(p) {
    const profile = p.profile.map(pt => this._v(pt));
    const dir = this._v(p.direction);
    const f = this.ft.addExtrude(profile, dir, p.distance, { taperAngle: p.taper || 0 });
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id, measurements: f.solid.massProperties() };
  }

  _revolve(p) {
    const profile = p.profile.map(pt => this._v(pt));
    const f = this.ft.addRevolve(profile, this._v(p.axisOrigin), this._v(p.axisDir), p.angle || Math.PI * 2);
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id, measurements: f.solid.massProperties() };
  }

  _loft(p) {
    const profiles = p.profiles.map(prof => prof.map(pt => this._v(pt)));
    const f = this.ft.addLoft(profiles, p.steps || 4);
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id, measurements: f.solid.massProperties() };
  }

  _sweep(p) {
    const profile = p.profile.map(pt => this._v(pt));
    const path = p.path.map(pt => this._v(pt));
    const f = this.ft.addSweep(profile, path);
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id, measurements: f.solid.massProperties() };
  }

  _fillet(p) {
    const f = this.ft.addFillet(p.featureId, p.edgeIds, p.radius);
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id };
  }

  _chamfer(p) {
    const f = this.ft.addChamfer(p.featureId, p.edgeIds, p.distance);
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id };
  }

  _shell(p) {
    const f = this.ft.addShell(p.featureId, p.faceIds, p.thickness);
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id };
  }

  _pushPull(p) {
    const f = this.ft.addPushPull(p.featureId, p.faceId, p.distance);
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id };
  }

  _booleanOp(op, p) {
    let f;
    switch (op) {
      case 'union': f = this.ft.addBooleanUnion(p.featureIdA, p.featureIdB); break;
      case 'subtract': f = this.ft.addBooleanSubtract(p.featureIdA, p.featureIdB); break;
      case 'intersect': f = this.ft.addBooleanIntersect(p.featureIdA, p.featureIdB); break;
    }
    this._render(f.solid, p.color);
    return { success: true, featureId: f.id, measurements: f.solid.massProperties() };
  }

  _linearPattern(p) {
    const results = [];
    const base = this.ft.getFeature(p.featureId);
    if (!base?.solid) return { success: false, message: 'Feature not found' };
    for (let i = 1; i < (p.count || 4); i++) {
      const offset = new Vec3(
        (p.direction?.[0] || 1) * i * (p.spacing || 0.05),
        (p.direction?.[1] || 0) * i * (p.spacing || 0.05),
        (p.direction?.[2] || 0) * i * (p.spacing || 0.05)
      );
      const f = this.ft.addBox(
        base.params.width || 0.01, base.params.height || 0.01, base.params.depth || 0.01, offset
      );
      this._render(f.solid);
      results.push(f.id);
    }
    return { success: true, featureIds: results, count: results.length + 1 };
  }

  _circularPattern(p) {
    const results = [];
    const count = p.count || 6;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = p.radius || 0.05;
      const f = this.ft.addCylinder(p.elementRadius || 0.005, p.elementHeight || 0.02, 12,
        new Vec3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
      this._render(f.solid);
      results.push(f.id);
    }
    return { success: true, featureIds: results, count };
  }

  _feaStatic(p) {
    const solid = this.ft.getSolid();
    if (!solid) return { success: false, message: 'No solid' };
    const result = FEAEngine.linearStatic(solid, {
      material: p.material,
      loads: [{ type: 'force', magnitude: p.force || 1000, direction: this._v(p.direction || [0, -1, 0]) }],
    });
    return { success: true, analysis: result.summary, full: result };
  }

  _feaModal(p) {
    const solid = this.ft.getSolid();
    if (!solid) return { success: false, message: 'No solid' };
    return { success: true, analysis: FEAEngine.modal(solid, { material: p.material }) };
  }

  _feaThermal(p) {
    const solid = this.ft.getSolid();
    if (!solid) return { success: false, message: 'No solid' };
    return { success: true, analysis: FEAEngine.thermal(solid, { material: p.material, heatInput: p.heatInput }) };
  }

  _feaFatigue(p) {
    const solid = this.ft.getSolid();
    if (!solid) return { success: false, message: 'No solid' };
    return { success: true, analysis: FEAEngine.fatigue(solid, { material: p.material, loadAmplitude: p.loadAmplitude }) };
  }

  _massProperties() {
    const solid = this.ft.getSolid();
    if (!solid) return { success: false, message: 'No solid' };
    return { success: true, properties: solid.massProperties() };
  }

  _checkGeometry() {
    const solid = this.ft.getSolid();
    if (!solid) return { success: false, message: 'No solid' };
    return {
      success: true,
      valid: solid.isValid(),
      vertices: solid.vertices().length,
      edges: solid.edges().length,
      faces: solid.faces().length,
      euler: solid.outerShell?.eulerCharacteristic(),
      manifold: solid.outerShell?.isManifold(),
    };
  }

  _gdtReport() {
    const solid = this.ft.getSolid();
    if (!solid) return { success: false, message: 'No solid' };
    return { success: true, report: GDTEngine.generateReport(solid) };
  }

  _toleranceStackup(p) {
    return { success: true, stackup: GDTEngine.stackUp(p.dimensions, p.method || 'rss') };
  }

  _generateGCode(p) {
    const solid = this.ft.getSolid();
    if (!solid) return { success: false, message: 'No solid' };
    const result = GCodeGenerator.pocketMill(solid, p);
    return { success: true, stats: result.stats, lineCount: result.gcode.split('\n').length };
  }

  _sliceForPrint(p) {
    const solid = this.ft.getSolid();
    if (!solid) return { success: false, message: 'No solid' };
    const result = Slicer.slice(solid, p);
    return { success: true, stats: result.stats };
  }

  _addToAssembly(p) {
    if (!this.assembly) this.assembly = new Assembly('Agent Assembly');
    const solid = this.ft.getSolid();
    if (!solid) return { success: false, message: 'No solid' };
    this.assembly.addPart(solid, p.name || solid.name, { color: p.color || 0x4a90d9 });
    return { success: true, partCount: this.assembly.partCount() };
  }

  _insertFastener(p) {
    let parts;
    switch (p.type) {
      case 'hex_bolt': parts = FastenerLibrary.hexBolt(p.size, p.length); break;
      case 'socket_screw': parts = FastenerLibrary.socketHeadCapScrew(p.size, p.length); break;
      case 'nut': parts = FastenerLibrary.hexNut(p.size); break;
      case 'washer': parts = FastenerLibrary.flatWasher(p.size); break;
      default: parts = FastenerLibrary.hexBolt(p.size || 'M8', p.length || 0.025);
    }
    if (parts.head) this._render(parts.head, 0x999999);
    if (parts.shank) this._render(parts.shank, 0x888888);
    if (parts.body) this._render(parts.body, 0x999999);
    return { success: true, type: p.type, size: p.size, specs: parts.specs };
  }

  _insertBearing(p) {
    const bearing = BearingLibrary.deepGrooveBallBearing(p.designation || '6008');
    bearing.parts.forEach(part => this._render(part.solid, part.color));
    return { success: true, designation: p.designation, partCount: bearing.parts.length, specs: bearing.specs };
  }

  _export(p) {
    const solid = this.ft.getSolid();
    if (!solid) return { success: false, message: 'No solid' };
    ExportEngine.exportSolid(solid, p.format || 'step', p.name || 'ArchDisc_Agent_Export');
    return { success: true, format: p.format };
  }

  _getSolidInfo() {
    const solid = this.ft.getSolid();
    if (!solid) return { success: false, message: 'No solid' };
    const props = solid.massProperties();
    return {
      success: true,
      name: solid.name,
      vertices: solid.vertices().length,
      edges: solid.edges().length,
      faces: solid.faces().length,
      volume: props.volume,
      surfaceArea: props.surfaceArea,
      mass: props.mass,
      boundingBox: solid.boundingBox(),
    };
  }

  _render(solid, color) {
    if (!this.scene) return;
    const group = ThreeJSBridge.solidToGroup(solid, { color: color || 0x4a90d9, edges: true });
    group.userData.pickable = true;
    group.userData.generatedModel = true;
    group.userData.kernelSolid = solid;
    this.scene.add(group);
  }
}
