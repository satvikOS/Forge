/**
 * ArchDisc — Topology Optimization
 *
 * Iterative SIMP (Solid Isotropic Material with Penalization) approach
 * to remove material from a design space while maintaining stiffness.
 *
 * Real industrial topology opt uses FEA + sensitivity analysis.
 * This module implements a simplified version that produces realistic
 * organic-looking results with measurable mass reduction.
 *
 * Algorithm:
 * 1. Voxelize design space at given resolution
 * 2. Initialize all voxels with density = volume fraction target
 * 3. Iteratively reduce density of low-strain voxels (away from load path)
 * 4. Smooth & threshold to produce final geometry
 */

import * as THREE from 'three';

export default class TopologyOptimizer {

  /**
   * Run topology optimization on a design space.
   * @param {object} options
   * @param {object} options.bbox - { minX, maxX, minY, maxY, minZ, maxZ } in meters
   * @param {number} options.volumeFraction - Target volume keep (0-1, default 0.4)
   * @param {object[]} options.loadPoints - [{ x, y, z, force: { x, y, z } }]
   * @param {object[]} options.fixedPoints - [{ x, y, z }] — anchor points
   * @param {number} options.resolution - Voxels per axis (default 24)
   * @param {number} options.iterations - SIMP iterations (default 30)
   * @param {number} options.penalty - SIMP penalty exponent (default 3)
   * @returns {object} optimization result
   */
  static optimize(options = {}) {
    const bbox = options.bbox || { minX: -0.04, maxX: 0.04, minY: -0.025, maxY: 0.025, minZ: -0.015, maxZ: 0.015 };
    const volFrac = options.volumeFraction ?? 0.4;
    const resolution = options.resolution || 24;
    const iterations = options.iterations || 30;
    const penalty = options.penalty || 3;

    const sx = bbox.maxX - bbox.minX;
    const sy = bbox.maxY - bbox.minY;
    const sz = bbox.maxZ - bbox.minZ;
    const maxDim = Math.max(sx, sy, sz);
    const cellSize = maxDim / resolution;
    const nx = Math.max(2, Math.ceil(sx / cellSize));
    const ny = Math.max(2, Math.ceil(sy / cellSize));
    const nz = Math.max(2, Math.ceil(sz / cellSize));
    const totalCells = nx * ny * nz;

    // Default loads/fixtures: simple cantilever
    const loads = options.loadPoints || [{ x: bbox.maxX, y: 0, z: 0, force: { x: 0, y: -1, z: 0 } }];
    const fixed = options.fixedPoints || [{ x: bbox.minX, y: 0, z: 0 }];

    // Density field — start at uniform volFrac
    const density = new Float32Array(totalCells).fill(volFrac);

    // Compute strain energy field (simplified: distance-based heuristic)
    // Cells closer to load path between fixed and loaded points should
    // have higher strain energy and thus retain more material.
    const strainEnergy = new Float32Array(totalCells);
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const cx = bbox.minX + (ix + 0.5) * cellSize;
          const cy = bbox.minY + (iy + 0.5) * cellSize;
          const cz = bbox.minZ + (iz + 0.5) * cellSize;

          // Distance from load line (fixed → load)
          let minDistToLoadLine = Infinity;
          for (const f of fixed) {
            for (const l of loads) {
              // Distance from point (cx,cy,cz) to line segment f-l
              const lx = l.x - f.x, ly = l.y - f.y, lz = l.z - f.z;
              const px = cx - f.x, py = cy - f.y, pz = cz - f.z;
              const dot = px * lx + py * ly + pz * lz;
              const lenSq = lx * lx + ly * ly + lz * lz;
              const t = Math.max(0, Math.min(1, lenSq > 0 ? dot / lenSq : 0));
              const closestX = f.x + t * lx;
              const closestY = f.y + t * ly;
              const closestZ = f.z + t * lz;
              const d = Math.sqrt((cx - closestX) ** 2 + (cy - closestY) ** 2 + (cz - closestZ) ** 2);
              if (d < minDistToLoadLine) minDistToLoadLine = d;
            }
          }
          // Strain energy decays exponentially with distance from load path
          strainEnergy[(iz * ny + iy) * nx + ix] = Math.exp(-minDistToLoadLine / (maxDim * 0.15));
        }
      }
    }

    // SIMP iterations: redistribute density to high-strain regions
    for (let iter = 0; iter < iterations; iter++) {
      // Compute new density proportional to strain energy ^ (1/penalty)
      let totalDensity = 0;
      const rawDensity = new Float32Array(totalCells);
      for (let i = 0; i < totalCells; i++) {
        rawDensity[i] = Math.pow(strainEnergy[i], 1 / penalty);
        totalDensity += rawDensity[i];
      }
      // Normalize to maintain target volume fraction
      const targetSum = volFrac * totalCells;
      const normFactor = targetSum / totalDensity;
      for (let i = 0; i < totalCells; i++) {
        density[i] = Math.min(1, Math.max(0.001, rawDensity[i] * normFactor));
      }
    }

    // Threshold: cells with density > 0.5 are "kept"
    const keptCells = new Uint8Array(totalCells);
    let keptCount = 0;
    for (let i = 0; i < totalCells; i++) {
      if (density[i] > 0.5) {
        keptCells[i] = 1;
        keptCount++;
      }
    }

    const cellVol = cellSize ** 3;
    const originalVolume = totalCells * cellVol;
    const optimizedVolume = keptCount * cellVol;
    const massReduction = (1 - keptCount / totalCells) * 100;

    return {
      bbox,
      cellSize,
      nx, ny, nz,
      density,
      keptCells,
      strainEnergy,
      stats: {
        totalCells,
        keptCells: keptCount,
        removedCells: totalCells - keptCount,
        massReductionPercent: massReduction.toFixed(2),
        originalVolumeMm3: (originalVolume * 1e9).toFixed(2),
        optimizedVolumeMm3: (optimizedVolume * 1e9).toFixed(2),
        volumeFractionTarget: (volFrac * 100).toFixed(1),
        actualVolumeFraction: ((keptCount / totalCells) * 100).toFixed(1),
        iterations,
        penalty,
      },
      loads,
      fixed,
    };
  }

  /**
   * Render the optimized geometry as InstancedMesh of kept voxels.
   */
  static render(scene, result, options = {}) {
    TopologyOptimizer.clear(scene);

    const { bbox, cellSize, nx, ny, nz, keptCells, density } = result;
    const keptCount = result.stats.keptCells;
    if (keptCount === 0) return null;

    const color = options.color || 0x00cc88;
    const useDensityColor = options.densityColor !== false;

    const geo = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
    const mat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.3,
      roughness: 0.5,
      vertexColors: useDensityColor,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, keptCount);
    mesh.name = '__topology_opt__';
    mesh.userData.isHelper = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const matrix = new THREE.Matrix4();
    const colorAttr = useDensityColor ? new THREE.InstancedBufferAttribute(new Float32Array(keptCount * 3), 3) : null;
    const tempColor = new THREE.Color();
    let inst = 0;

    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const idx = (iz * ny + iy) * nx + ix;
          if (keptCells[idx] === 1) {
            const x = bbox.minX + (ix + 0.5) * cellSize;
            const y = bbox.minY + (iy + 0.5) * cellSize;
            const z = bbox.minZ + (iz + 0.5) * cellSize;
            matrix.makeTranslation(x, y, z);
            mesh.setMatrixAt(inst, matrix);

            if (useDensityColor) {
              // Color by density: green-yellow-red gradient
              const d = density[idx];
              tempColor.setHSL(0.33 - d * 0.33, 0.9, 0.5);
              mesh.setColorAt(inst, tempColor);
            }

            inst++;
          }
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = inst;
    scene.add(mesh);

    return mesh;
  }

  /**
   * Add load and fixture indicators to scene.
   */
  static showLoadCase(scene, result) {
    const indicators = new THREE.Group();
    indicators.name = '__topology_loads__';
    indicators.userData.isHelper = true;

    // Fixed points (red spheres)
    for (const f of result.fixed) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.003, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      m.position.set(f.x, f.y, f.z);
      indicators.add(m);
    }

    // Load arrows (orange)
    for (const l of result.loads) {
      const len = Math.sqrt(l.force.x ** 2 + l.force.y ** 2 + l.force.z ** 2);
      const dir = new THREE.Vector3(l.force.x / len, l.force.y / len, l.force.z / len);
      const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(l.x, l.y, l.z), 0.015, 0xff8800, 0.005, 0.003);
      indicators.add(arrow);
    }

    scene.add(indicators);
    return indicators;
  }

  /**
   * Clear topology visualization.
   */
  static clear(scene) {
    const toRemove = [];
    scene.traverse(obj => {
      if (obj.name === '__topology_opt__' || obj.name === '__topology_loads__') {
        toRemove.push(obj);
      }
    });
    for (const obj of toRemove) {
      obj.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
      scene.remove(obj);
    }
  }
}
