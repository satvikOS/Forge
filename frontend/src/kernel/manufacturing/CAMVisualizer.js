/**
 * ArchDisc — CAM Toolpath Visualizer
 *
 * Renders G-code toolpaths in the 3D viewport with color coding:
 * - GREEN: cutting moves (G1/G2/G3)
 * - BLUE: rapid moves (G0)
 * - YELLOW: plunge moves (downward G1)
 * - ORANGE: drilling cycles
 *
 * Provides estimated cycle time, total path length, and material removal.
 */

import * as THREE from 'three';

const COLOR_RAPID = 0x4080ff;
const COLOR_CUT = 0x40ff80;
const COLOR_PLUNGE = 0xffff40;
const COLOR_DRILL = 0xff8040;

export default class CAMVisualizer {

  /**
   * Parse G-code into 3D move list.
   * Returns array of moves: { type, from, to, feed, isRapid }
   */
  static parseGCode(gcode) {
    const lines = gcode.split('\n');
    const moves = [];
    let pos = { x: 0, y: 0, z: 0 };
    let feedRate = 0;
    let absolute = true;

    for (const raw of lines) {
      const line = raw.split('(')[0].trim().toUpperCase();
      if (!line || line.startsWith('%')) continue;

      // Modal codes
      if (line.match(/G90/)) absolute = true;
      if (line.match(/G91/)) absolute = false;

      // F (feed rate)
      const fMatch = line.match(/F([\d.]+)/);
      if (fMatch) feedRate = parseFloat(fMatch[1]);

      // Detect motion type
      let isRapid = false;
      let isDrill = false;
      if (line.match(/^N?\s*G0\b/) || line.match(/\bG0\b/)) isRapid = true;
      if (line.match(/^N?\s*G1\b/) || line.match(/\bG1\b/)) isRapid = false;
      if (line.match(/G83/)) isDrill = true;

      // Extract X, Y, Z
      const xMatch = line.match(/X(-?[\d.]+)/);
      const yMatch = line.match(/Y(-?[\d.]+)/);
      const zMatch = line.match(/Z(-?[\d.]+)/);

      if (!xMatch && !yMatch && !zMatch) continue;

      const newPos = { ...pos };
      if (xMatch) newPos.x = absolute ? parseFloat(xMatch[1]) : pos.x + parseFloat(xMatch[1]);
      if (yMatch) newPos.y = absolute ? parseFloat(yMatch[1]) : pos.y + parseFloat(yMatch[1]);
      if (zMatch) newPos.z = absolute ? parseFloat(zMatch[1]) : pos.z + parseFloat(zMatch[1]);

      // Detect plunge: only Z moving downward at feed rate
      const dz = newPos.z - pos.z;
      const isPlunge = !isRapid && dz < 0 && Math.abs(dz) > 0 &&
                       Math.abs(newPos.x - pos.x) < 0.001 &&
                       Math.abs(newPos.y - pos.y) < 0.001;

      let type = 'cut';
      if (isRapid) type = 'rapid';
      else if (isDrill) type = 'drill';
      else if (isPlunge) type = 'plunge';

      moves.push({
        type,
        from: { ...pos },
        to: { ...newPos },
        feed: feedRate,
      });

      pos = newPos;
    }

    return moves;
  }

  /**
   * Render toolpath moves as colored line segments in scene.
   * Coordinates are in mm (G-code convention) — converts to meters for Three.js.
   * @param {THREE.Scene} scene
   * @param {object[]} moves - From parseGCode
   * @param {object} options - { offsetX, offsetY, offsetZ, scale }
   * @returns {THREE.Group}
   */
  static renderToolpath(scene, moves, options = {}) {
    const offsetX = options.offsetX || 0;
    const offsetY = options.offsetY || 0;
    const offsetZ = options.offsetZ || 0;
    const scale = options.scale ?? 0.001; // mm → m

    const group = new THREE.Group();
    group.name = '__toolpath__';
    group.userData.isHelper = true;

    // Group segments by type for batched rendering
    const byType = { rapid: [], cut: [], plunge: [], drill: [] };

    for (const move of moves) {
      const fx = move.from.x * scale + offsetX;
      const fy = move.from.z * scale + offsetY; // G-code Z = world Y (up)
      const fz = -move.from.y * scale + offsetZ;
      const tx = move.to.x * scale + offsetX;
      const ty = move.to.z * scale + offsetY;
      const tz = -move.to.y * scale + offsetZ;

      byType[move.type].push(fx, fy, fz, tx, ty, tz);
    }

    const colorMap = {
      rapid: COLOR_RAPID,
      cut: COLOR_CUT,
      plunge: COLOR_PLUNGE,
      drill: COLOR_DRILL,
    };

    let totalSegments = 0;
    for (const [type, vertices] of Object.entries(byType)) {
      if (vertices.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const mat = new THREE.LineBasicMaterial({
        color: colorMap[type],
        transparent: true,
        opacity: type === 'rapid' ? 0.4 : 0.85,
      });
      const lines = new THREE.LineSegments(geo, mat);
      lines.userData.toolpathType = type;
      lines.userData.isHelper = true;
      group.add(lines);
      totalSegments += vertices.length / 6;
    }

    group.userData.segmentCount = totalSegments;
    scene.add(group);
    return group;
  }

  /**
   * Compute statistics from a parsed toolpath.
   */
  static stats(moves) {
    let cutLength = 0;
    let rapidLength = 0;
    let cutTime = 0;     // minutes
    let rapidTime = 0;
    const rapidFeed = 5000; // mm/min typical rapid speed

    for (const m of moves) {
      const d = Math.sqrt(
        (m.to.x - m.from.x) ** 2 +
        (m.to.y - m.from.y) ** 2 +
        (m.to.z - m.from.z) ** 2
      );
      if (m.type === 'rapid') {
        rapidLength += d;
        rapidTime += d / rapidFeed;
      } else {
        cutLength += d;
        cutTime += d / Math.max(m.feed, 1);
      }
    }

    return {
      totalMoves: moves.length,
      rapidMoves: moves.filter(m => m.type === 'rapid').length,
      cutMoves: moves.filter(m => m.type === 'cut').length,
      plungeMoves: moves.filter(m => m.type === 'plunge').length,
      drillMoves: moves.filter(m => m.type === 'drill').length,
      cutLengthMm: cutLength.toFixed(1),
      rapidLengthMm: rapidLength.toFixed(1),
      totalLengthMm: (cutLength + rapidLength).toFixed(1),
      cutTimeMin: cutTime.toFixed(2),
      rapidTimeMin: rapidTime.toFixed(2),
      totalTimeMin: (cutTime + rapidTime).toFixed(2),
    };
  }

  /**
   * Animate the tool moving along the path.
   */
  static animateTool(scene, moves, toolDiameter = 0.006, options = {}) {
    const speed = options.speed || 1; // moves per second
    const offsetX = options.offsetX || 0;
    const offsetY = options.offsetY || 0;
    const offsetZ = options.offsetZ || 0;
    const scale = options.scale ?? 0.001;

    // Tool indicator (cylinder)
    const toolMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(toolDiameter / 2, toolDiameter / 2, toolDiameter * 4, 16),
      new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.7 })
    );
    toolMesh.name = '__cam_tool__';
    toolMesh.userData.isHelper = true;
    scene.add(toolMesh);

    let idx = 0;
    let stopped = false;
    const start = performance.now();

    const tick = () => {
      if (stopped || idx >= moves.length) {
        scene.remove(toolMesh);
        toolMesh.geometry.dispose();
        toolMesh.material.dispose();
        return;
      }
      const move = moves[idx];
      const dt = (performance.now() - start) / 1000;
      const u = Math.min(1, (dt * speed) % 1);
      const x = move.from.x + (move.to.x - move.from.x) * u;
      const y = move.from.z + (move.to.z - move.from.z) * u;
      const z = -move.from.y - (move.to.y - move.from.y) * u;
      toolMesh.position.set(x * scale + offsetX, y * scale + offsetY, z * scale + offsetZ);

      if (u >= 0.99) idx++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    return {
      stop: () => { stopped = true; }
    };
  }

  /**
   * Clear toolpath visualization from scene.
   */
  static clear(scene) {
    const toRemove = [];
    scene.traverse(obj => {
      if (obj.name === '__toolpath__' || obj.name === '__cam_tool__') {
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
