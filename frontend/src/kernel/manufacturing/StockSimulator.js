/**
 * ArchDisc — Stock Removal Simulation
 *
 * Visualizes machining as material removal. Renders raw stock block,
 * tracks volume removed at each toolpath step, and shows progressive
 * material reduction.
 *
 * Voxel-based: discretizes stock into a 3D grid, marks voxels removed
 * by tool path. Fast enough for ~100K voxels on real-time.
 */

import * as THREE from 'three';

export default class StockSimulator {

  /**
   * Initialize a voxel grid representing the raw stock block.
   * @param {object} bbox - { minX, maxX, minY, maxY, minZ, maxZ } in meters
   * @param {number} resolution - Voxels per axis (e.g., 32)
   */
  static buildStock(bbox, resolution = 32) {
    const sx = bbox.maxX - bbox.minX;
    const sy = bbox.maxY - bbox.minY;
    const sz = bbox.maxZ - bbox.minZ;
    const maxDim = Math.max(sx, sy, sz);
    const cellSize = maxDim / resolution;

    const nx = Math.max(2, Math.ceil(sx / cellSize));
    const ny = Math.max(2, Math.ceil(sy / cellSize));
    const nz = Math.max(2, Math.ceil(sz / cellSize));

    // Bitmap of voxel state (1 = present, 0 = removed)
    const voxels = new Uint8Array(nx * ny * nz).fill(1);

    return {
      bbox,
      cellSize,
      nx, ny, nz,
      voxels,
      totalVoxels: nx * ny * nz,
      removedCount: 0,
    };
  }

  /**
   * Apply tool removal at a specific 3D position.
   * Marks voxels within tool radius as removed.
   * @returns {number} voxels removed this call
   */
  static removeAt(stock, pos, toolRadius) {
    const { bbox, cellSize, nx, ny, nz, voxels } = stock;
    const r2 = toolRadius * toolRadius;
    let removed = 0;

    // Compute affected voxel range
    const ix0 = Math.max(0, Math.floor((pos.x - toolRadius - bbox.minX) / cellSize));
    const ix1 = Math.min(nx - 1, Math.ceil((pos.x + toolRadius - bbox.minX) / cellSize));
    const iy0 = Math.max(0, Math.floor((pos.y - toolRadius - bbox.minY) / cellSize));
    const iy1 = Math.min(ny - 1, Math.ceil((pos.y + toolRadius - bbox.minY) / cellSize));
    const iz0 = Math.max(0, Math.floor((pos.z - toolRadius - bbox.minZ) / cellSize));
    const iz1 = Math.min(nz - 1, Math.ceil((pos.z + toolRadius - bbox.minZ) / cellSize));

    for (let iz = iz0; iz <= iz1; iz++) {
      const cz = bbox.minZ + (iz + 0.5) * cellSize;
      for (let iy = iy0; iy <= iy1; iy++) {
        const cy = bbox.minY + (iy + 0.5) * cellSize;
        for (let ix = ix0; ix <= ix1; ix++) {
          const cx = bbox.minX + (ix + 0.5) * cellSize;
          const dist2 = (cx - pos.x) ** 2 + (cy - pos.y) ** 2 + (cz - pos.z) ** 2;
          if (dist2 < r2) {
            const idx = (iz * ny + iy) * nx + ix;
            if (voxels[idx] === 1) {
              voxels[idx] = 0;
              removed++;
            }
          }
        }
      }
    }

    stock.removedCount += removed;
    return removed;
  }

  /**
   * Apply an entire toolpath to the stock, accumulating removals.
   * @param {object} stock
   * @param {object[]} moves - From CAMVisualizer.parseGCode (mm units)
   * @param {number} toolRadius - in meters
   * @param {number} stepSize - sampling along each move (in meters)
   * @returns {{ removedVoxels, totalVoxels, removedFraction, removedVolumeMm3 }}
   */
  static applyToolpath(stock, moves, toolRadius, stepSize = null) {
    const step = stepSize || stock.cellSize * 0.5;
    let totalRemoved = 0;

    for (const move of moves) {
      if (move.type === 'rapid') continue; // rapid moves don't cut
      // Convert mm → meters
      const fx = move.from.x * 0.001;
      const fy = move.from.z * 0.001; // G-code Z = world Y
      const fz = -move.from.y * 0.001;
      const tx = move.to.x * 0.001;
      const ty = move.to.z * 0.001;
      const tz = -move.to.y * 0.001;

      const dx = tx - fx, dy = ty - fy, dz = tz - fz;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const steps = Math.max(1, Math.ceil(len / step));

      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const pos = { x: fx + dx * u, y: fy + dy * u, z: fz + dz * u };
        totalRemoved += StockSimulator.removeAt(stock, pos, toolRadius);
      }
    }

    const cellVol = stock.cellSize ** 3;
    return {
      removedVoxels: totalRemoved,
      totalVoxels: stock.totalVoxels,
      remainingVoxels: stock.totalVoxels - stock.removedCount,
      removedFraction: stock.removedCount / stock.totalVoxels,
      removedVolumeMm3: (stock.removedCount * cellVol * 1e9).toFixed(2),
      remainingVolumeMm3: ((stock.totalVoxels - stock.removedCount) * cellVol * 1e9).toFixed(2),
    };
  }

  /**
   * Render the current stock state as a Three.js mesh of remaining voxels.
   * Uses InstancedMesh for performance.
   */
  static renderStock(scene, stock, options = {}) {
    StockSimulator.clearStock(scene);

    const { bbox, cellSize, nx, ny, nz, voxels } = stock;
    const remaining = stock.totalVoxels - stock.removedCount;
    if (remaining === 0) return null;

    const color = options.color || 0xddaa66;
    const opacity = options.opacity ?? 0.6;

    const geo = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
    const mat = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity,
      metalness: 0.2,
      roughness: 0.7,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, remaining);
    mesh.name = '__stock__';
    mesh.userData.isHelper = true;

    const matrix = new THREE.Matrix4();
    let inst = 0;
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const idx = (iz * ny + iy) * nx + ix;
          if (voxels[idx] === 1) {
            const x = bbox.minX + (ix + 0.5) * cellSize;
            const y = bbox.minY + (iy + 0.5) * cellSize;
            const z = bbox.minZ + (iz + 0.5) * cellSize;
            matrix.makeTranslation(x, y, z);
            mesh.setMatrixAt(inst++, matrix);
          }
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = inst;
    scene.add(mesh);
    return mesh;
  }

  /**
   * Clear stock visualization from scene.
   */
  static clearStock(scene) {
    const existing = scene.getObjectByName('__stock__');
    if (existing) {
      if (existing.geometry) existing.geometry.dispose();
      if (existing.material) existing.material.dispose();
      scene.remove(existing);
    }
  }

  /**
   * Animate stock removal — replay toolpath, updating stock visualization.
   */
  static animateRemoval(scene, stock, moves, toolRadius, options = {}) {
    const movesPerFrame = options.movesPerFrame || 5;
    let idx = 0;
    let stopped = false;

    const tick = () => {
      if (stopped || idx >= moves.length) return;
      for (let i = 0; i < movesPerFrame && idx < moves.length; i++, idx++) {
        const move = moves[idx];
        if (move.type === 'rapid') continue;
        // Sample along move
        const steps = 4;
        const fx = move.from.x * 0.001, fy = move.from.z * 0.001, fz = -move.from.y * 0.001;
        const tx = move.to.x * 0.001, ty = move.to.z * 0.001, tz = -move.to.y * 0.001;
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          StockSimulator.removeAt(stock, {
            x: fx + (tx - fx) * u,
            y: fy + (ty - fy) * u,
            z: fz + (tz - fz) * u,
          }, toolRadius);
        }
      }
      // Re-render every N frames
      if (idx % (movesPerFrame * 5) === 0 || idx >= moves.length) {
        StockSimulator.renderStock(scene, stock);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    return { stop: () => { stopped = true; } };
  }
}
