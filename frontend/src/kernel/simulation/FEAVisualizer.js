/**
 * ArchDisc — FEA Visualization
 *
 * Maps FEA results onto rendered 3D geometry with:
 * - Color-mapped stress (blue→cyan→green→yellow→red gradient)
 * - Deformed shape overlay (vertices displaced by computed field)
 * - Modal animation (mode shape sinusoidal motion)
 * - Probe queries (point → stress value)
 * - SVG legend for stress scale
 */

import * as THREE from 'three';

const COLOR_STOPS = [
  { t: 0.0, color: new THREE.Color(0x0000ff) }, // deep blue (low)
  { t: 0.25, color: new THREE.Color(0x00ffff) }, // cyan
  { t: 0.5, color: new THREE.Color(0x00ff00) }, // green
  { t: 0.75, color: new THREE.Color(0xffff00) }, // yellow
  { t: 1.0, color: new THREE.Color(0xff0000) }, // red (high)
];

export default class FEAVisualizer {

  /**
   * Apply stress coloring to a Three.js group based on real per-element data.
   * Maps each vertex to its nearest mesh element and colors by stress.
   */
  static applyStressField(group, feaResult, options = {}) {
    if (!feaResult?.stressField || !feaResult.mesh) return;
    const { mesh, stressField } = feaResult;
    const maxStress = options.maxStress ?? feaResult.results.maxVonMises;
    const minStress = options.minStress ?? feaResult.results.minVonMises;
    const range = maxStress - minStress || 1;

    group.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      const positions = child.geometry.getAttribute('position');
      if (!positions) return;

      const colors = new Float32Array(positions.count * 3);
      const tmpColor = new THREE.Color();

      for (let i = 0; i < positions.count; i++) {
        const px = positions.getX(i);
        const py = positions.getY(i);
        const pz = positions.getZ(i);

        // Find nearest stress element by centroid
        let nearestStress = minStress;
        let nearestDist = Infinity;
        for (let j = 0; j < stressField.length; j++) {
          const elem = stressField[j];
          const cn = elem.centroid || (mesh.elements?.[j]?.centroid);
          if (!cn) continue;
          const cx = cn.x ?? cn[0] ?? 0;
          const cy = cn.y ?? cn[1] ?? 0;
          const cz = cn.z ?? cn[2] ?? 0;
          const d = (px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2;
          if (d < nearestDist) { nearestDist = d; nearestStress = elem.vonMises; }
        }

        const normalized = Math.max(0, Math.min(1, (nearestStress - minStress) / range));
        FEAVisualizer._mapColor(normalized, tmpColor);
        colors[i * 3] = tmpColor.r;
        colors[i * 3 + 1] = tmpColor.g;
        colors[i * 3 + 2] = tmpColor.b;
      }

      child.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      // Save original material
      if (!child.userData._origMat) child.userData._origMat = child.material;
      child.material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0.1,
        roughness: 0.65,
        side: THREE.DoubleSide,
      });
    });
  }

  /**
   * Apply deformed shape: displace vertices by displacement field × scale.
   */
  static applyDeformation(group, feaResult, scale = 100) {
    if (!feaResult?.displacementField) return;
    const { displacementField } = feaResult;

    group.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      const positions = child.geometry.getAttribute('position');
      if (!positions) return;

      // Save originals once
      if (!child.userData._origPositions) {
        child.userData._origPositions = positions.array.slice();
      }
      const orig = child.userData._origPositions;

      for (let i = 0; i < positions.count; i++) {
        const ox = orig[i * 3];
        const oy = orig[i * 3 + 1];
        const oz = orig[i * 3 + 2];

        const idx = i % displacementField.length;
        const d = displacementField[idx];
        positions.setXYZ(i,
          ox + (d.dx || 0) * scale,
          oy + (d.dy || 0) * scale,
          oz + (d.dz || 0) * scale
        );
      }
      positions.needsUpdate = true;
      child.geometry.computeVertexNormals();
    });
  }

  /**
   * Reset to original (undo deformation).
   */
  static resetDeformation(group) {
    group.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      const orig = child.userData._origPositions;
      if (!orig) return;
      const positions = child.geometry.getAttribute('position');
      positions.array.set(orig);
      positions.needsUpdate = true;
      child.geometry.computeVertexNormals();
    });
  }

  /**
   * Animate a modal mode shape: oscillate displacement sinusoidally.
   * Returns an animation handle with .stop().
   */
  static animateMode(group, feaResult, options = {}) {
    const amplitude = options.amplitude || 0.005;
    const frequency = options.frequency || 1.0; // Hz
    const start = performance.now();
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const t = (performance.now() - start) / 1000;
      const factor = Math.sin(t * frequency * Math.PI * 2) * amplitude;
      FEAVisualizer.applyDeformation(group, feaResult, factor);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    return {
      stop: () => {
        stopped = true;
        FEAVisualizer.resetDeformation(group);
      }
    };
  }

  /**
   * Probe a 3D point and return stress at that location.
   */
  static probePoint(feaResult, worldPoint) {
    if (!feaResult?.stressField) return null;
    const { stressField } = feaResult;
    let nearestDist = Infinity;
    let nearest = null;
    for (const elem of stressField) {
      const c = elem.centroid;
      if (!c) continue;
      const d = (worldPoint.x - (c.x || 0)) ** 2 + (worldPoint.y - (c.y || 0)) ** 2 + (worldPoint.z - (c.z || 0)) ** 2;
      if (d < nearestDist) { nearestDist = d; nearest = elem; }
    }
    if (!nearest) return null;
    return {
      vonMises: nearest.vonMises,
      vonMisesMPa: (nearest.vonMises / 1e6).toFixed(3),
      principal1: nearest.principal1,
      principal2: nearest.principal2,
      principal3: nearest.principal3,
      distanceFromQuery: Math.sqrt(nearestDist),
    };
  }

  /**
   * Generate SVG color legend showing stress scale.
   */
  static legendSVG(feaResult, options = {}) {
    const width = options.width || 180;
    const height = options.height || 20;
    const max = feaResult.results.maxVonMises;
    const min = feaResult.results.minVonMises;

    // Gradient stops
    const stops = COLOR_STOPS.map(s => `<stop offset="${(s.t * 100).toFixed(0)}%" stop-color="#${s.color.getHexString()}"/>`).join('');

    // Label ticks
    const ticks = 5;
    const labels = [];
    for (let i = 0; i <= ticks; i++) {
      const t = i / ticks;
      const stress = min + t * (max - min);
      const x = t * width;
      labels.push(`<line x1="${x.toFixed(1)}" y1="${height}" x2="${x.toFixed(1)}" y2="${height + 3}" stroke="#000" stroke-width="0.5"/>`);
      labels.push(`<text x="${x.toFixed(1)}" y="${height + 12}" font-family="monospace" font-size="6" text-anchor="middle" fill="#333">${(stress / 1e6).toFixed(1)}</text>`);
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 30}" viewBox="0 0 ${width} ${height + 30}">
  <defs>
    <linearGradient id="stress" x1="0" x2="100%">
      ${stops}
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#stress)" stroke="#333" stroke-width="0.5"/>
  ${labels.join('\n  ')}
  <text x="${width/2}" y="${height + 24}" font-family="monospace" font-size="7" text-anchor="middle" fill="#333" font-weight="bold">Von Mises Stress (MPa)</text>
</svg>`;
  }

  /**
   * Restore original materials on a group (undo stress coloring).
   */
  static restoreMaterials(group) {
    group.traverse(child => {
      if (!child.isMesh) return;
      if (child.userData._origMat) {
        child.material = child.userData._origMat;
        delete child.userData._origMat;
      }
    });
  }

  // --- Internal ---

  static _mapColor(t, out) {
    // Find segment
    for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
      const a = COLOR_STOPS[i], b = COLOR_STOPS[i + 1];
      if (t >= a.t && t <= b.t) {
        const local = (t - a.t) / (b.t - a.t);
        out.r = a.color.r + (b.color.r - a.color.r) * local;
        out.g = a.color.g + (b.color.g - a.color.g) * local;
        out.b = a.color.b + (b.color.b - a.color.b) * local;
        return;
      }
    }
    out.copy(COLOR_STOPS[COLOR_STOPS.length - 1].color);
  }
}
