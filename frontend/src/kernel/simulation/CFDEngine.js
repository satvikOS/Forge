/**
 * ArchDisc — CFD Engine (simplified)
 *
 * Compute flow fields and trace streamlines for visualization.
 * Uses simplified potential flow + drag/pressure estimates.
 *
 * Real CFD uses Navier-Stokes solvers (FVM/FEM/LBM). This module
 * provides realistic-magnitude estimates for visualization purposes.
 */

import * as THREE from 'three';

const FLUIDS = {
  air: { density: 1.225, viscosity: 1.81e-5, name: 'Air @ 20°C' },
  water: { density: 998, viscosity: 1.0e-3, name: 'Water @ 20°C' },
  oil_hydraulic: { density: 870, viscosity: 0.04, name: 'Hydraulic Oil ISO VG46' },
  oil_engine: { density: 860, viscosity: 0.15, name: 'Engine Oil 10W-40' },
  glycerin: { density: 1260, viscosity: 1.49, name: 'Glycerin' },
  honey: { density: 1420, viscosity: 10.0, name: 'Honey' },
  blood: { density: 1060, viscosity: 3.5e-3, name: 'Blood' },
  natural_gas: { density: 0.668, viscosity: 1.1e-5, name: 'Natural Gas' },
};

export { FLUIDS };

export default class CFDEngine {

  /**
   * Run a simplified flow analysis on a solid (treated as obstacle in flow).
   * @param {object} options
   * @param {TopoSolid} options.solid - Obstacle geometry
   * @param {string} options.fluid - 'air', 'water', etc.
   * @param {number} options.inletVelocity - m/s
   * @param {string} options.flowDirection - '+x', '-x', '+y', '-y', '+z', '-z'
   * @returns {object} flow analysis result
   */
  static analyze(options = {}) {
    const fluid = FLUIDS[options.fluid] || FLUIDS.air;
    const v = options.inletVelocity || 10; // m/s
    const dir = options.flowDirection || '+x';

    let solid = options.solid;
    let bbox, charLength, frontalArea, projectedAreaSide;
    if (solid) {
      bbox = solid.boundingBox();
      const size = bbox.size();
      // Characteristic length = bbox diagonal
      charLength = Math.sqrt(size.x ** 2 + size.y ** 2 + size.z ** 2);
      // Frontal area depends on flow direction
      if (dir.includes('x')) frontalArea = size.y * size.z;
      else if (dir.includes('y')) frontalArea = size.x * size.z;
      else frontalArea = size.x * size.y;
      projectedAreaSide = (size.x + size.y + size.z) * 2 * 0.3; // approx
    } else {
      bbox = { min: { x: -0.05, y: -0.025, z: -0.025 }, max: { x: 0.05, y: 0.025, z: 0.025 } };
      charLength = 0.07;
      frontalArea = 0.0025;
      projectedAreaSide = 0.005;
    }

    // Reynolds number: Re = ρvL/μ
    const reynolds = (fluid.density * v * charLength) / fluid.viscosity;

    // Flow regime
    let regime;
    if (reynolds < 1) regime = 'creeping';
    else if (reynolds < 100) regime = 'laminar';
    else if (reynolds < 1000) regime = 'transitional';
    else if (reynolds < 1e5) regime = 'turbulent (low)';
    else if (reynolds < 1e7) regime = 'turbulent (high)';
    else regime = 'turbulent (very high)';

    // Drag coefficient (empirical for bluff body):
    // Re < 1: Cd ~ 24/Re (Stokes)
    // Re 1-1000: Cd ~ 24/Re + 6/(1+sqrt(Re)) + 0.4
    // Re 1000-1e5: Cd ~ 1.0 (typical bluff body)
    // Re > 1e5: Cd ~ 0.5 (drag crisis)
    let Cd;
    if (reynolds < 1) Cd = 24 / Math.max(reynolds, 1e-3);
    else if (reynolds < 1000) Cd = 24 / reynolds + 6 / (1 + Math.sqrt(reynolds)) + 0.4;
    else if (reynolds < 1e5) Cd = 1.0;
    else Cd = 0.5;

    // Drag force: F = 0.5 × ρ × v² × Cd × A
    const dragForce = 0.5 * fluid.density * v * v * Cd * frontalArea;

    // Dynamic pressure
    const dynamicPressure = 0.5 * fluid.density * v * v;

    // Stagnation pressure (at front of obstacle)
    const stagnationPressure = dynamicPressure;

    // Pressure drop estimate (using Darcy-Weisbach for flow channel)
    const frictionFactor = reynolds > 4000 ? 0.316 / Math.pow(reynolds, 0.25) : 64 / Math.max(reynolds, 1);
    const pressureDrop = frictionFactor * (charLength / Math.max(charLength * 0.5, 1e-5)) * dynamicPressure;

    // Mass flow rate (assume inlet area = bbox cross-section)
    const massFlowRate = fluid.density * v * frontalArea;

    return {
      fluid: fluid.name,
      fluidProperties: fluid,
      flowDirection: dir,
      inletVelocity: v,
      bbox,
      charLengthMm: (charLength * 1000).toFixed(2),
      frontalAreaCm2: (frontalArea * 1e4).toFixed(2),

      reynolds: reynolds.toFixed(0),
      reynoldsExp: reynolds.toExponential(2),
      regime,

      dragCoefficient: Cd.toFixed(3),
      dragForceN: dragForce.toFixed(4),
      dragForceMilliN: (dragForce * 1000).toFixed(2),

      dynamicPressurePa: dynamicPressure.toFixed(2),
      stagnationPressurePa: stagnationPressure.toFixed(2),
      pressureDropPa: pressureDrop.toFixed(2),
      pressureDropBar: (pressureDrop / 1e5).toFixed(5),

      massFlowRateKgS: massFlowRate.toFixed(4),
      volumetricFlowLs: (massFlowRate / fluid.density * 1000).toFixed(3),
      volumetricFlowM3h: (massFlowRate / fluid.density * 3600).toFixed(2),
    };
  }

  /**
   * Generate streamlines around an obstacle.
   * Uses simplified potential flow: source/sink + uniform flow.
   * @param {object} options - { bbox, inletVelocity, flowDirection, seedCount }
   * @returns {object[]} array of streamline polylines
   */
  static streamlines(options = {}) {
    const bbox = options.bbox || { min: { x: -0.1, y: -0.05, z: -0.05 }, max: { x: 0.1, y: 0.05, z: 0.05 } };
    const v = options.inletVelocity || 10;
    const dir = options.flowDirection || '+x';
    const seedCount = options.seedCount || 20;
    const obstacleCenter = options.obstacleCenter || {
      x: (bbox.min.x + bbox.max.x) / 2,
      y: (bbox.min.y + bbox.max.y) / 2,
      z: (bbox.min.z + bbox.max.z) / 2,
    };
    const obstacleRadius = options.obstacleRadius || 0.015;

    const dirVec = CFDEngine._dirVector(dir);
    const inletDir = CFDEngine._oppositeDir(dirVec);

    // Seed grid on inlet face
    const sx = bbox.max.x - bbox.min.x;
    const sy = bbox.max.y - bbox.min.y;
    const sz = bbox.max.z - bbox.min.z;
    const seeds = [];
    const gridSize = Math.ceil(Math.sqrt(seedCount));
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const u = (i + 0.5) / gridSize;
        const w = (j + 0.5) / gridSize;
        // Place on inlet face based on direction
        let seed;
        if (dirVec.x !== 0) {
          seed = {
            x: dirVec.x > 0 ? bbox.min.x : bbox.max.x,
            y: bbox.min.y + u * sy,
            z: bbox.min.z + w * sz,
          };
        } else if (dirVec.y !== 0) {
          seed = {
            x: bbox.min.x + u * sx,
            y: dirVec.y > 0 ? bbox.min.y : bbox.max.y,
            z: bbox.min.z + w * sz,
          };
        } else {
          seed = {
            x: bbox.min.x + u * sx,
            y: bbox.min.y + w * sy,
            z: dirVec.z > 0 ? bbox.min.z : bbox.max.z,
          };
        }
        seeds.push(seed);
      }
    }

    // Trace each streamline using RK4 integration through velocity field
    const streamlines = [];
    const stepSize = Math.min(sx, sy, sz) / 100;
    const maxSteps = 500;

    for (const seed of seeds) {
      const line = [{ ...seed, vMag: v }];
      let pos = { ...seed };
      for (let step = 0; step < maxSteps; step++) {
        const v1 = CFDEngine._velocityField(pos, dirVec, v, obstacleCenter, obstacleRadius);
        const speed = Math.sqrt(v1.x ** 2 + v1.y ** 2 + v1.z ** 2);
        if (speed < 1e-6) break;

        // RK4 step
        const k1 = v1;
        const k2 = CFDEngine._velocityField({
          x: pos.x + k1.x * stepSize / 2,
          y: pos.y + k1.y * stepSize / 2,
          z: pos.z + k1.z * stepSize / 2,
        }, dirVec, v, obstacleCenter, obstacleRadius);
        const k3 = CFDEngine._velocityField({
          x: pos.x + k2.x * stepSize / 2,
          y: pos.y + k2.y * stepSize / 2,
          z: pos.z + k2.z * stepSize / 2,
        }, dirVec, v, obstacleCenter, obstacleRadius);
        const k4 = CFDEngine._velocityField({
          x: pos.x + k3.x * stepSize,
          y: pos.y + k3.y * stepSize,
          z: pos.z + k3.z * stepSize,
        }, dirVec, v, obstacleCenter, obstacleRadius);

        pos = {
          x: pos.x + stepSize * (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6,
          y: pos.y + stepSize * (k1.y + 2 * k2.y + 2 * k3.y + k4.y) / 6,
          z: pos.z + stepSize * (k1.z + 2 * k2.z + 2 * k3.z + k4.z) / 6,
        };

        line.push({ ...pos, vMag: speed });

        // Stop if outside bbox
        if (pos.x < bbox.min.x || pos.x > bbox.max.x ||
            pos.y < bbox.min.y || pos.y > bbox.max.y ||
            pos.z < bbox.min.z || pos.z > bbox.max.z) break;
      }
      if (line.length > 2) streamlines.push(line);
    }

    return streamlines;
  }

  /**
   * Velocity field: uniform flow + dipole obstacle (potential flow).
   */
  static _velocityField(p, mainDir, mainV, obsCenter, obsRadius) {
    // Uniform flow component
    let vx = mainDir.x * mainV;
    let vy = mainDir.y * mainV;
    let vz = mainDir.z * mainV;

    // Dipole disturbance from obstacle (3D potential flow around sphere)
    const dx = p.x - obsCenter.x;
    const dy = p.y - obsCenter.y;
    const dz = p.z - obsCenter.z;
    const r2 = dx * dx + dy * dy + dz * dz;
    const r = Math.sqrt(r2);

    if (r < obsRadius) {
      // Inside obstacle — push out
      return { x: 0, y: 0, z: 0 };
    }

    // Approximation: deflection scales with (radius/distance)³
    const factor = (obsRadius / r) ** 3 * mainV;
    const dot = (dx * mainDir.x + dy * mainDir.y + dz * mainDir.z) / r;

    // Perpendicular component pushes flow around sphere
    vx -= factor * (mainDir.x - dx * dot / r);
    vy -= factor * (mainDir.y - dy * dot / r);
    vz -= factor * (mainDir.z - dz * dot / r);

    return { x: vx, y: vy, z: vz };
  }

  static _dirVector(dir) {
    switch (dir) {
      case '+x': return { x: 1, y: 0, z: 0 };
      case '-x': return { x: -1, y: 0, z: 0 };
      case '+y': return { x: 0, y: 1, z: 0 };
      case '-y': return { x: 0, y: -1, z: 0 };
      case '+z': return { x: 0, y: 0, z: 1 };
      case '-z': return { x: 0, y: 0, z: -1 };
      default: return { x: 1, y: 0, z: 0 };
    }
  }

  static _oppositeDir(dirVec) {
    return { x: -dirVec.x, y: -dirVec.y, z: -dirVec.z };
  }

  /**
   * Render streamlines in 3D scene as colored line strips.
   */
  static renderStreamlines(scene, streamlines, options = {}) {
    CFDEngine.clearStreamlines(scene);
    if (!streamlines.length) return null;

    const group = new THREE.Group();
    group.name = '__streamlines__';
    group.userData.isHelper = true;

    // Find velocity range for color mapping
    let minV = Infinity, maxV = -Infinity;
    for (const line of streamlines) {
      for (const p of line) {
        if (p.vMag < minV) minV = p.vMag;
        if (p.vMag > maxV) maxV = p.vMag;
      }
    }
    const vRange = maxV - minV || 1;

    const tmpColor = new THREE.Color();
    for (const line of streamlines) {
      const positions = new Float32Array(line.length * 3);
      const colors = new Float32Array(line.length * 3);
      for (let i = 0; i < line.length; i++) {
        positions[i * 3] = line[i].x;
        positions[i * 3 + 1] = line[i].y;
        positions[i * 3 + 2] = line[i].z;

        // Color by velocity: blue (slow) → green → yellow → red (fast)
        const t = (line[i].vMag - minV) / vRange;
        tmpColor.setHSL(0.66 - t * 0.66, 1.0, 0.5);
        colors[i * 3] = tmpColor.r;
        colors[i * 3 + 1] = tmpColor.g;
        colors[i * 3 + 2] = tmpColor.b;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
      });
      const lineMesh = new THREE.Line(geo, mat);
      lineMesh.userData.isHelper = true;
      group.add(lineMesh);
    }

    scene.add(group);
    return { group, minV: minV.toFixed(3), maxV: maxV.toFixed(3), count: streamlines.length };
  }

  /**
   * Clear streamlines from scene.
   */
  static clearStreamlines(scene) {
    const existing = scene.getObjectByName('__streamlines__');
    if (existing) {
      existing.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
      scene.remove(existing);
    }
  }
}
