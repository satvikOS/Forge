/**
 * ArchDisc Geometry Kernel — G-Code Generator
 * Generates real CNC toolpath G-code from B-Rep solid geometry.
 * Supports: 2.5-axis milling, 3-axis contouring, drilling, facing.
 */

import Vec3 from '../math/Vec3.js';

export default class GCodeGenerator {

  /**
   * Generate 2.5-axis pocket milling G-code from a solid.
   * @param {TopoSolid} solid
   * @param {object} options
   * @returns {{ gcode: string, stats: object }}
   */
  static pocketMill(solid, options = {}) {
    const {
      toolDiameter = 0.010,   // 10mm endmill
      stepover = 0.4,          // 40% stepover
      depthOfCut = 0.002,      // 2mm depth per pass
      feedRate = 800,           // mm/min
      spindleSpeed = 8000,      // RPM
      safeHeight = 0.050,       // 50mm safe Z
      material = 'Aluminum 6061-T6',
    } = options;

    const bbox = solid.boundingBox();
    const size = bbox.size();
    const lines = [];
    let moveCount = 0;
    let totalLength = 0;

    // Header
    lines.push('(ArchDisc G-Code Generator)');
    lines.push(`(Part: ${solid.name || 'Unnamed'})`);
    lines.push(`(Material: ${material})`);
    lines.push(`(Tool: ${toolDiameter * 1000}mm Flat Endmill)`);
    lines.push(`(Feed: ${feedRate} mm/min, Speed: ${spindleSpeed} RPM)`);
    lines.push('');
    lines.push('G90 G21 (Absolute, millimeters)');
    lines.push('G17 (XY plane)');
    lines.push(`G0 Z${(safeHeight * 1000).toFixed(3)}`);
    lines.push(`M3 S${spindleSpeed} (Spindle ON CW)`);
    lines.push('G4 P2 (Dwell 2 sec for spindle)');

    // Calculate passes
    const xMin = bbox.min.x * 1000; // convert to mm
    const xMax = bbox.max.x * 1000;
    const yMin = bbox.min.z * 1000;
    const yMax = bbox.max.z * 1000;
    const zTop = bbox.max.y * 1000;
    const zBottom = bbox.min.y * 1000;
    const step = toolDiameter * 1000 * stepover;
    const zStep = depthOfCut * 1000;

    let z = zTop;
    let passNum = 0;
    const maxPasses = 50; // cap to prevent runaway on oversized geometry
    const maxYSteps = 100;

    while (z > zBottom && passNum < maxPasses) {
      z = Math.max(z - zStep, zBottom);
      passNum++;
      lines.push('');
      lines.push(`(Pass ${passNum}, Z=${z.toFixed(3)})`);

      // Zigzag toolpath
      let y = yMin + toolDiameter * 500;
      let dir = 1;
      let ySteps = 0;
      while (y < yMax - toolDiameter * 500 && ySteps < maxYSteps) {
        ySteps++;
        const x1 = dir > 0 ? xMin + toolDiameter * 500 : xMax - toolDiameter * 500;
        const x2 = dir > 0 ? xMax - toolDiameter * 500 : xMin + toolDiameter * 500;

        lines.push(`G0 X${x1.toFixed(3)} Y${y.toFixed(3)}`);
        lines.push(`G1 Z${z.toFixed(3)} F${feedRate * 0.3}`); // plunge
        lines.push(`G1 X${x2.toFixed(3)} F${feedRate}`);
        totalLength += Math.abs(x2 - x1);
        moveCount += 3;

        y += step;
        dir *= -1;
      }

      lines.push(`G0 Z${(safeHeight * 1000).toFixed(3)}`);
      moveCount++;
    }

    // Footer
    lines.push('');
    lines.push('M5 (Spindle OFF)');
    lines.push(`G0 Z${(safeHeight * 1000).toFixed(3)}`);
    lines.push('G0 X0 Y0');
    lines.push('M30 (Program end)');
    lines.push('%');

    const cycleTime = totalLength / feedRate; // minutes

    return {
      gcode: lines.join('\n'),
      stats: {
        lines: lines.length,
        moves: moveCount,
        passes: passNum,
        totalLengthMm: totalLength.toFixed(1),
        cycleTimeMin: cycleTime.toFixed(1),
        toolDiameterMm: toolDiameter * 1000,
        depthOfCutMm: depthOfCut * 1000,
        material,
      }
    };
  }

  /**
   * Generate drilling G-code for hole patterns.
   */
  static drill(holes, options = {}) {
    const {
      drillDiameter = 0.006,
      feedRate = 200,
      spindleSpeed = 3000,
      peckDepth = 0.003,
      safeHeight = 0.050,
    } = options;

    const lines = [];
    lines.push('(ArchDisc Drilling Program)');
    lines.push(`(Tool: ${drillDiameter * 1000}mm Drill)`);
    lines.push('G90 G21');
    lines.push(`G0 Z${(safeHeight * 1000).toFixed(3)}`);
    lines.push(`M3 S${spindleSpeed}`);
    lines.push('G4 P1');
    lines.push('');

    // G83 peck drilling cycle
    holes.forEach((hole, i) => {
      const x = (hole.x || 0) * 1000;
      const y = (hole.z || hole.y || 0) * 1000;
      const depth = (hole.depth || 0.020) * 1000;
      const peck = peckDepth * 1000;

      lines.push(`(Hole ${i + 1}: X${x.toFixed(3)} Y${y.toFixed(3)} D${depth.toFixed(3)})`);
      lines.push(`G0 X${x.toFixed(3)} Y${y.toFixed(3)}`);
      lines.push(`G83 Z${(-depth).toFixed(3)} R2.000 Q${peck.toFixed(3)} F${feedRate}`);
      lines.push('G80');
    });

    lines.push('');
    lines.push('M5');
    lines.push(`G0 Z${(safeHeight * 1000).toFixed(3)}`);
    lines.push('G0 X0 Y0');
    lines.push('M30');
    lines.push('%');

    return {
      gcode: lines.join('\n'),
      stats: { holeCount: holes.length, drillDiameterMm: drillDiameter * 1000, lines: lines.length }
    };
  }

  /**
   * Generate turning G-code from a revolution profile.
   */
  static turning(profile, options = {}) {
    const {
      feedRate = 150,
      spindleSpeed = 2400,
      depthOfCut = 0.5,
      safeX = 50,
    } = options;

    const lines = [];
    lines.push('(ArchDisc Turning Program)');
    lines.push('G90 G21');
    lines.push(`M3 S${spindleSpeed}`);
    lines.push('G4 P2');

    // Roughing passes
    let passNum = 0;
    const maxR = Math.max(...profile.map(p => Math.abs(p.x || 0))) * 1000;
    let currentR = maxR;

    while (currentR > depthOfCut) {
      currentR -= depthOfCut;
      passNum++;
      lines.push('');
      lines.push(`(Roughing pass ${passNum}, R=${currentR.toFixed(3)})`);
      lines.push(`G0 X${(currentR * 2).toFixed(3)} Z2.000`);

      profile.forEach((pt, i) => {
        const z = (pt.y || pt.z || 0) * 1000;
        const r = Math.min(Math.abs(pt.x || 0) * 1000, currentR);
        lines.push(`G1 X${(r * 2).toFixed(3)} Z${(-z).toFixed(3)} F${feedRate}`);
      });

      lines.push(`G0 X${safeX}`);
    }

    // Finishing pass
    lines.push('');
    lines.push('(Finishing pass)');
    lines.push(`G0 X${safeX} Z2.000`);
    profile.forEach(pt => {
      const z = (pt.y || pt.z || 0) * 1000;
      const r = Math.abs(pt.x || 0) * 1000;
      lines.push(`G1 X${(r * 2).toFixed(3)} Z${(-z).toFixed(3)} F${feedRate * 0.5}`);
    });

    lines.push('');
    lines.push('M5');
    lines.push(`G0 X${safeX} Z50`);
    lines.push('M30');
    lines.push('%');

    return {
      gcode: lines.join('\n'),
      stats: { passes: passNum + 1, lines: lines.length, profilePoints: profile.length }
    };
  }

  /**
   * Download G-code file.
   */
  static download(gcode, filename = 'ArchDisc_Toolpath.nc') {
    const blob = new Blob([gcode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
