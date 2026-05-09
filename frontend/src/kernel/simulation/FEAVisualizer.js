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
   * Add 3D markers at min and max stress locations.
   * Returns a THREE.Group of marker objects.
   */
  static addMinMaxMarkers(scene, feaResult) {
    if (!feaResult?.stressField || !scene) return null;
    const { stressField } = feaResult;

    let minElem = null, maxElem = null;
    for (const el of stressField) {
      if (!minElem || el.vonMises < minElem.vonMises) minElem = el;
      if (!maxElem || el.vonMises > maxElem.vonMises) maxElem = el;
    }
    if (!minElem || !maxElem) return null;

    const markersGroup = new THREE.Group();
    markersGroup.name = '__fea_markers__';
    markersGroup.userData.isHelper = true;
    markersGroup.userData.feaMarkers = true;

    const markerScale = 0.003; // 3mm sphere

    // MAX marker (red sphere + label)
    const maxC = maxElem.centroid;
    if (maxC) {
      const maxMesh = new THREE.Mesh(
        new THREE.SphereGeometry(markerScale, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      maxMesh.position.set(maxC.x, maxC.y, maxC.z);
      maxMesh.userData.label = `MAX ${(maxElem.vonMises / 1e6).toFixed(2)} MPa`;
      markersGroup.add(maxMesh);

      // Text sprite for MAX
      const maxSprite = FEAVisualizer._textSprite(`MAX ${(maxElem.vonMises / 1e6).toFixed(2)} MPa`, '#ff0000');
      maxSprite.position.set(maxC.x, maxC.y + 0.005, maxC.z);
      maxSprite.scale.set(0.020, 0.005, 1);
      markersGroup.add(maxSprite);
    }

    // MIN marker (blue sphere + label)
    const minC = minElem.centroid;
    if (minC) {
      const minMesh = new THREE.Mesh(
        new THREE.SphereGeometry(markerScale, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x0066ff })
      );
      minMesh.position.set(minC.x, minC.y, minC.z);
      minMesh.userData.label = `MIN ${(minElem.vonMises / 1e6).toFixed(2)} MPa`;
      markersGroup.add(minMesh);

      const minSprite = FEAVisualizer._textSprite(`MIN ${(minElem.vonMises / 1e6).toFixed(2)} MPa`, '#0066ff');
      minSprite.position.set(minC.x, minC.y - 0.005, minC.z);
      minSprite.scale.set(0.020, 0.005, 1);
      markersGroup.add(minSprite);
    }

    scene.add(markersGroup);
    return markersGroup;
  }

  /**
   * Generate iso-stress contour lines on a mesh group.
   * @param {THREE.Group} group
   * @param {object} feaResult
   * @param {number} levels - Number of contour levels (default 8)
   * @returns {THREE.Group} contour lines group
   */
  static addStressContours(scene, group, feaResult, levels = 8) {
    if (!feaResult?.stressField) return null;
    const { results } = feaResult;
    const min = results.minVonMises;
    const max = results.maxVonMises;
    const range = max - min;
    if (range < 1e-9) return null;

    // Compute iso-stress values
    const isoLevels = [];
    for (let i = 1; i < levels; i++) {
      isoLevels.push(min + (range * i / levels));
    }

    const contourGroup = new THREE.Group();
    contourGroup.name = '__stress_contours__';
    contourGroup.userData.isHelper = true;

    // Marching across triangles: for each iso level, find segments where stress crosses
    group.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      const positions = child.geometry.getAttribute('position');
      const indices = child.geometry.getIndex();
      if (!positions || !indices) return;

      // Compute per-vertex stress (nearest element)
      const vertStress = new Float32Array(positions.count);
      for (let i = 0; i < positions.count; i++) {
        const px = positions.getX(i), py = positions.getY(i), pz = positions.getZ(i);
        let nearest = min;
        let nearestDist = Infinity;
        for (const elem of feaResult.stressField) {
          const c = elem.centroid;
          if (!c) continue;
          const d = (px - c.x) ** 2 + (py - c.y) ** 2 + (pz - c.z) ** 2;
          if (d < nearestDist) { nearestDist = d; nearest = elem.vonMises; }
        }
        vertStress[i] = nearest;
      }

      // Marching for each level
      for (const level of isoLevels) {
        const segments = [];
        for (let t = 0; t < indices.count; t += 3) {
          const ia = indices.getX(t), ib = indices.getX(t + 1), ic = indices.getX(t + 2);
          const sa = vertStress[ia], sb = vertStress[ib], sc = vertStress[ic];

          // Triangle edges that cross the iso level
          const crossings = [];
          const checkEdge = (i1, i2, s1, s2) => {
            if ((s1 - level) * (s2 - level) <= 0 && s1 !== s2) {
              const u = (level - s1) / (s2 - s1);
              const x = positions.getX(i1) + u * (positions.getX(i2) - positions.getX(i1));
              const y = positions.getY(i1) + u * (positions.getY(i2) - positions.getY(i1));
              const z = positions.getZ(i1) + u * (positions.getZ(i2) - positions.getZ(i1));
              crossings.push({ x, y, z });
            }
          };
          checkEdge(ia, ib, sa, sb);
          checkEdge(ib, ic, sb, sc);
          checkEdge(ic, ia, sc, sa);

          if (crossings.length === 2) {
            segments.push(crossings[0], crossings[1]);
          }
        }

        if (segments.length > 0) {
          const geo = new THREE.BufferGeometry();
          const verts = new Float32Array(segments.length * 3);
          for (let i = 0; i < segments.length; i++) {
            verts[i * 3] = segments[i].x;
            verts[i * 3 + 1] = segments[i].y;
            verts[i * 3 + 2] = segments[i].z;
          }
          geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));

          // Color contour by level
          const t = (level - min) / range;
          const color = new THREE.Color();
          FEAVisualizer._mapColor(t, color);
          // Slightly darker for contour lines
          const lineColor = new THREE.Color(color.r * 0.5, color.g * 0.5, color.b * 0.5);

          const lineMat = new THREE.LineBasicMaterial({
            color: lineColor,
            linewidth: 1,
            transparent: true,
            opacity: 0.85,
          });
          const lines = new THREE.LineSegments(geo, lineMat);
          lines.userData.isHelper = true;
          lines.userData.isoLevel = level;
          contourGroup.add(lines);
        }
      }
    });

    scene.add(contourGroup);
    return contourGroup;
  }

  /**
   * Remove all FEA visualization helpers from the scene.
   */
  static clearVisualization(scene) {
    const toRemove = [];
    scene.traverse(obj => {
      if (obj.userData?.feaMarkers || obj.name === '__stress_contours__') {
        toRemove.push(obj);
      }
    });
    toRemove.forEach(obj => {
      obj.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
      scene.remove(obj);
    });
  }

  /**
   * Helper: create a text sprite at world coordinates.
   */
  static _textSprite(text, color = '#ff0000') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 254, 62);
    ctx.fillStyle = color;
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 40);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    return new THREE.Sprite(mat);
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
