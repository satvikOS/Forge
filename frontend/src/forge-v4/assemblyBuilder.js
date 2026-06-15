// SCAFFOLD (workflow-designed, 2026-06-15) — 100k-scale / AAA foundation.
// Designed by scale-100k-aaa-architecture workflow; wire + perf-verify before demo use.

/**
 * ProceduralsAssemblyGenerator.js
 * 
 * 100k-component procedural assembly for ArchDisc Forge.
 * Generates a complex mechanical assembly (V8-like engine or gearbox) using
 * OCCT kernel template parts + THREE.InstancedMesh rendering + LOD culling.
 * 
 * Usage:
 *   const gen = new ProceduralAssemblyGenerator(window.forge);
 *   const result = await gen.generate({ targetComponentCount: 100000 });
 *   // result = { bodies, scene, stats, cutawayHero }
 */

import * as THREE from 'three';
import { MultiResolutionPart, buildInstancedAssembly, frustumGroupCull } from './MassiveAssembly.js';

const BOLT_SIZES = [
  { name: 'M3', r: 1.5, h: 6 },
  { name: 'M4', r: 2.0, h: 8 },
  { name: 'M5', r: 2.5, h: 10 },
  { name: 'M6', r: 3.0, h: 12 },
  { name: 'M8', r: 4.0, h: 16 },
  { name: 'M10', r: 5.0, h: 20 },
];

const STRUCTURAL_TEMPLATES = [
  { kind: 'washer', name: 'Washer M4', r: 4.5, h: 1.0 },
  { kind: 'washer', name: 'Washer M6', r: 6.5, h: 1.5 },
  { kind: 'spacer', name: 'Spacer 3x10', r: 3.0, h: 10 },
  { kind: 'spacer', name: 'Spacer 4x14', r: 4.0, h: 14 },
  { kind: 'bracket-s', name: 'Bracket S', dx: 12, dy: 8, dz: 4 },
  { kind: 'bracket-m', name: 'Bracket M', dx: 18, dy: 12, dz: 6 },
];

class ProceduralAssemblyGenerator {
  constructor(forge, opts = {}) {
    if (!forge || typeof forge.makeBox !== 'function') {
      throw new Error('ProceduralAssemblyGenerator: kernel forge required with makeBox/Cylinder/Sphere');
    }
    this.forge = forge;
    this.templates = [];
    this.multiResGeo = new Map(); // templateId -> MultiResolutionPart
    this.seed = opts.seed || (Date.now() & 0x7fffffff);
    this.rng = this._mulberry32(this.seed);
    this.stats = {
      templateBuildMs: 0,
      tessellationMs: 0,
      instanceGenerationMs: 0,
      totalMs: 0,
    };
  }

  _mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Build template B-reps from the kernel.
   * Returns array of { templateId, kind, handle, name, dims }.
   */
  _buildTemplates() {
    const t0 = performance.now();
    const out = [];

    // Bolts (cylinders)
    for (const bolt of BOLT_SIZES) {
      try {
        const handle = this.forge.makeCylinder(bolt.r, bolt.h);
        out.push({
          templateId: `bolt-${bolt.name}`,
          kind: 'cylinder',
          handle,
          name: `Bolt ${bolt.name}`,
          dims: { r: bolt.r, h: bolt.h },
        });
      } catch (e) {
        console.warn(`Failed to build bolt ${bolt.name}:`, e.message);
      }
    }

    // Structural (washers, spacers, brackets)
    for (const tpl of STRUCTURAL_TEMPLATES) {
      try {
        let handle;
        if (tpl.kind === 'washer' || tpl.kind === 'spacer') {
          handle = this.forge.makeCylinder(tpl.r, tpl.h);
        } else if (tpl.kind.startsWith('bracket')) {
          handle = this.forge.makeBox(tpl.dx, tpl.dy, tpl.dz);
        } else {
          continue;
        }
        out.push({
          templateId: tpl.name.toLowerCase().replace(/\s+/g, '-'),
          kind: tpl.kind,
          handle,
          name: tpl.name,
          dims: tpl,
        });
      } catch (e) {
        console.warn(`Failed to build template ${tpl.name}:`, e.message);
      }
    }

    this.stats.templateBuildMs = performance.now() - t0;
    this.templates = out;
    return out;
  }

  /**
   * Tessellate each template into LOD0, LOD1, LOD2 geometries.
   * Returns Map<templateId, { lod0, lod1, lod2 }>.
   */
  _tessellateTemplates() {
    const t0 = performance.now();
    const multiResList = [];

    for (const tpl of this.templates) {
      try {
        // LOD0: detailed
        const m0 = this.forge.tessellate(tpl.handle, 0.05, 0.3);
        const geo0 = this._meshToGeometry(m0);

        // LOD1: medium
        const m1 = this.forge.tessellate(tpl.handle, 0.2, 0.8);
        const geo1 = this._meshToGeometry(m1);

        // LOD2: far
        const m2 = this.forge.tessellate(tpl.handle, 0.5, 1.5);
        const geo2 = this._meshToGeometry(m2);

        this.multiResGeo.set(tpl.templateId, {
          lod0: geo0,
          lod1: geo1,
          lod2: geo2,
          triCountLod0: m0.triangleCount || 0,
          triCountLod1: m1.triangleCount || 0,
          triCountLod2: m2.triangleCount || 0,
        });
      } catch (e) {
        console.warn(`Failed to tessellate ${tpl.name}:`, e.message);
      }
    }

    this.stats.tessellationMs = performance.now() - t0;
    return this.multiResGeo;
  }

  /**
   * Convert forge tessellate output to THREE.BufferGeometry.
   */
  _meshToGeometry(tessResult) {
    if (!tessResult.positions || !tessResult.indices) {
      throw new Error('Invalid tessellation result');
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tessResult.positions), 3));
    if (tessResult.normals) {
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(tessResult.normals), 3));
    }
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(tessResult.indices), 1));
    if (!tessResult.normals) {
      geo.computeVertexNormals();
    }
    geo.computeBoundingSphere();
    return geo;
  }

  /**
   * Generate 100k instance placements.
   * Returns array of { templateId, position, rotation }.
   */
  _generateInstances(targetCount) {
    const t0 = performance.now();
    const instances = [];
    const chunkSize = 5000;

    // For a V8-like engine:
    // - 6 cylinders in a line (z-axis), spaced 80 mm apart
    // - Each cylinder has ~16 fasteners (rocker studs, valve adjusters, etc)
    // - 4 main bearing studs per main bearing (7 mains)
    // - Accessory mounts with fasteners
    // - Oil/coolant galleries with filler fasteners

    const cylinderCount = 6;
    const cylinderSpacing = 80;
    const fastenersPerCylinder = 200; // Spread over valve train, rocker studs, cooling jacket

    let idx = 0;

    // Cylinder head fasteners
    for (let c = 0; c < cylinderCount; c++) {
      const cz = c * cylinderSpacing;
      const headCenterX = c * 20; // Slight offset per cylinder
      const headCenterY = 0;

      // Rocker studs (M8): 16 per cylinder (two banks of 8)
      for (let bank = 0; bank < 2; bank++) {
        for (let i = 0; i < 8; i++) {
          if (idx >= targetCount) break;
          const x = headCenterX + (bank === 0 ? -15 : 15);
          const y = headCenterY + (i * 12 - 42);
          const z = cz + 10;
          instances.push({
            templateId: 'bolt-M8',
            position: [x, y, z],
            rotation: [0, 0, Math.PI / 2],
            scale: 1,
          });
          idx++;
        }
      }

      // Valve adjusters (M6): 16 per cylinder
      for (let i = 0; i < 16; i++) {
        if (idx >= targetCount) break;
        const angle = (i / 16) * Math.PI * 2;
        const x = headCenterX + Math.cos(angle) * 25;
        const y = headCenterY + Math.sin(angle) * 25;
        const z = cz + 5;
        instances.push({
          templateId: 'bolt-M6',
          position: [x, y, z],
          rotation: [0, 0, angle],
          scale: 1,
        });
        idx++;
      }

      // Cooling jacket fasteners (M5): scattered
      for (let i = 0; i < 12; i++) {
        if (idx >= targetCount) break;
        const x = headCenterX + (this.rng() - 0.5) * 60;
        const y = headCenterY + (this.rng() - 0.5) * 60;
        const z = cz + (this.rng() - 0.5) * 20;
        instances.push({
          templateId: 'bolt-M5',
          position: [x, y, z],
          rotation: [this.rng() * Math.PI * 2, this.rng() * Math.PI * 2, this.rng() * Math.PI * 2],
          scale: 1,
        });
        idx++;
      }
    }

    // Crankshaft main bearing studs
    for (let main = 0; main < 7; main++) {
      const mz = main * cylinderSpacing * 0.9;
      // 4 studs per main bearing cap
      for (let i = 0; i < 4; i++) {
        if (idx >= targetCount) break;
        const angle = (i / 4) * Math.PI * 2;
        const x = 50 + Math.cos(angle) * 30;
        const y = Math.sin(angle) * 30;
        const z = mz;
        instances.push({
          templateId: 'bolt-M8',
          position: [x, y, z],
          rotation: [0, 0, angle],
          scale: 1,
        });
        idx++;
      }
    }

    // Oil pan drain plug + strainer fasteners
    for (let i = 0; i < 6; i++) {
      if (idx >= targetCount) break;
      instances.push({
        templateId: 'bolt-M6',
        position: [60 + (this.rng() - 0.5) * 40, -80 + (this.rng() - 0.5) * 20, 200 + i * 30],
        rotation: [0, 0, 0],
        scale: 1,
      });
      idx++;
    }

    // Accessory mounts: alternator, water pump, power steering
    const accessoryMounts = [
      { cx: -100, cy: 50, cz: 150, name: 'Alternator' },
      { cx: 100, cy: 80, cz: 80, name: 'Water Pump' },
      { cx: -80, cy: -60, cz: 200, name: 'Power Steering' },
    ];

    for (const acc of accessoryMounts) {
      // Mounting bosses: M8 studs in bolt circles
      for (let i = 0; i < 8; i++) {
        if (idx >= targetCount) break;
        const angle = (i / 8) * Math.PI * 2;
        const x = acc.cx + Math.cos(angle) * 40;
        const y = acc.cy + Math.sin(angle) * 40;
        const z = acc.cz;
        instances.push({
          templateId: 'bolt-M8',
          position: [x, y, z],
          rotation: [0, 0, angle],
          scale: 1,
        });
        idx++;
      }

      // Internal fasteners for the accessory itself
      for (let i = 0; i < 20; i++) {
        if (idx >= targetCount) break;
        instances.push({
          templateId: ['bolt-M4', 'bolt-M5'][i % 2],
          position: [
            acc.cx + (this.rng() - 0.5) * 80,
            acc.cy + (this.rng() - 0.5) * 80,
            acc.cz + (this.rng() - 0.5) * 40,
          ],
          rotation: [this.rng() * Math.PI * 2, this.rng() * Math.PI * 2, this.rng() * Math.PI * 2],
          scale: 1,
        });
        idx++;
      }
    }

    // Fill remaining slots with random fasteners
    while (idx < targetCount) {
      const templateId = this.templates[Math.floor(this.rng() * this.templates.length)].templateId;
      instances.push({
        templateId,
        position: [
          (this.rng() - 0.5) * 400,
          (this.rng() - 0.5) * 400,
          (this.rng() - 0.5) * 400,
        ],
        rotation: [
          this.rng() * Math.PI * 2,
          this.rng() * Math.PI * 2,
          this.rng() * Math.PI * 2,
        ],
        scale: 1 + (this.rng() - 0.5) * 0.2,
      });
      idx++;
    }

    this.stats.instanceGenerationMs = performance.now() - t0;
    return instances;
  }

  /**
   * Build THREE.InstancedMesh objects from instance array.
   */
  _buildInstancedMeshes(instances) {
    const byTemplate = new Map();

    // Group instances by templateId
    for (const inst of instances) {
      if (!byTemplate.has(inst.templateId)) {
        byTemplate.set(inst.templateId, []);
      }
      byTemplate.get(inst.templateId).push(inst);
    }

    const scene = new THREE.Scene();
    const meshes = [];

    // Build one InstancedMesh per template
    for (const [templateId, templateInstances] of byTemplate) {
      const geoData = this.multiResGeo.get(templateId);
      if (!geoData) {
        console.warn(`No geometry for template ${templateId}`);
        continue;
      }

      // Use LOD0 for now; LOD selection happens per-frame
      const geo = geoData.lod0;
      const material = new THREE.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.5,
        metalness: 0.6,
      });

      const instMesh = new THREE.InstancedMesh(geo, material, templateInstances.length);
      instMesh.name = `Instanced_${templateId}_x${templateInstances.length}`;
      instMesh.frustumCulled = false;
      instMesh.castShadow = true;
      instMesh.receiveShadow = true;

      // Set per-instance transforms
      const mat4 = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const rot = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const euler = new THREE.Euler();

      for (let i = 0; i < templateInstances.length; i++) {
        const inst = templateInstances[i];
        pos.set(...inst.position);
        euler.setFromArray(inst.rotation);
        rot.setFromEuler(euler);
        scale.set(inst.scale, inst.scale, inst.scale);
        mat4.compose(pos, rot, scale);
        instMesh.setMatrixAt(i, mat4);
      }
      instMesh.instanceMatrix.needsUpdate = true;

      scene.add(instMesh);
      meshes.push({
        templateId,
        mesh: instMesh,
        instanceCount: templateInstances.length,
        geoData,
      });
    }

    return { scene, meshes };
  }

  /**
   * Main generation entry point.
   */
  async generate(opts = {}) {
    const targetComponentCount = opts.targetComponentCount || 100000;
    const onProgress = opts.onProgress || null;

    const tTotal = performance.now();

    // Step 1: Build templates
    this._buildTemplates();
    if (onProgress) onProgress(0.1, 'Building templates');

    // Step 2: Tessellate
    this._tessellateTemplates();
    if (onProgress) onProgress(0.3, 'Tessellating geometries');

    // Step 3: Generate instances
    const instances = this._generateInstances(targetComponentCount);
    if (onProgress) onProgress(0.7, 'Placing instances');

    // Step 4: Build three meshes
    const { scene, meshes } = this._buildInstancedMeshes(instances);
    if (onProgress) onProgress(0.9, 'Building GPU meshes');

    // Step 5: Create hero cutaway (simplified)
    const cutawayHero = this._buildHeroCutaway();

    this.stats.totalMs = performance.now() - tTotal;

    return {
      scene,
      meshes,
      instances,
      templates: this.templates,
      stats: this.stats,
      cutawayHero,
    };
  }

  /**
   * Build a hero subsystem (one cylinder head) for path-traced cutaway.
   */
  _buildHeroCutaway() {
    // Simplified: build a cylinder head from a box + some cuts
    // In a real implementation, this would pull a detailed B-rep
    const group = new THREE.Group();
    group.name = 'Hero_CylinderHead_Cutaway';

    // Placeholder: add a simple mesh
    const headGeo = new THREE.BoxGeometry(80, 60, 40);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xaa7744 });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    group.add(headMesh);

    return group;
  }
}

export default ProceduralAssemblyGenerator;
