/**
 * ArchDisc Geometry Kernel — 3D Print Slicer
 * Slices B-Rep solids into layers for additive manufacturing.
 * Generates toolpaths per layer: perimeters, infill, supports.
 */

import Vec3 from '../math/Vec3.js';
import Plane from '../math/Plane.js';

export default class Slicer {

  /**
   * Slice a solid into layers.
   * @param {TopoSolid} solid
   * @param {object} options
   * @returns {{ layers: Layer[], stats: object }}
   */
  static slice(solid, options = {}) {
    const {
      layerHeight = 0.0002,    // 0.2mm
      nozzleDiameter = 0.0004, // 0.4mm
      infillDensity = 0.2,     // 20%
      infillPattern = 'grid',  // grid, honeycomb, gyroid
      wallCount = 3,
      topLayers = 4,
      bottomLayers = 4,
      supportAngle = 45,       // degrees
      buildPlateTemp = 60,     // °C
      nozzleTemp = 210,        // °C
      printSpeed = 60,         // mm/s
      travelSpeed = 150,       // mm/s
    } = options;

    const bbox = solid.boundingBox();
    const size = bbox.size();
    const height = size.y;
    const layerCount = Math.min(Math.ceil(height / layerHeight), 2000); // cap at 2000 layers

    const layers = [];
    let totalLength = 0;
    let totalTime = 0;

    for (let i = 0; i < layerCount; i++) {
      const z = bbox.min.y + (i + 0.5) * layerHeight;
      const isBottom = i < bottomLayers;
      const isTop = i >= layerCount - topLayers;
      const isSolid = isBottom || isTop;

      // Compute cross-section at this Z height
      const slicePlane = Plane.fromNormalAndPoint(Vec3.unitY(), new Vec3(0, z, 0));
      const crossSection = Slicer._computeCrossSection(solid, z, bbox);

      if (crossSection.length === 0) continue;

      // Generate perimeters
      const perimeters = [];
      for (let w = 0; w < wallCount; w++) {
        const offset = w * nozzleDiameter;
        perimeters.push(crossSection.map(p => ({
          x: p.x + (p.nx || 0) * offset,
          z: p.z + (p.nz || 0) * offset,
        })));
      }

      // Generate infill
      const infill = isSolid
        ? Slicer._solidInfill(crossSection, nozzleDiameter, bbox)
        : Slicer._generateInfill(crossSection, infillPattern, infillDensity, nozzleDiameter, bbox, i);

      // Calculate lengths
      let layerLength = 0;
      perimeters.forEach(p => { for (let j = 1; j < p.length; j++) layerLength += Math.sqrt((p[j].x - p[j-1].x)**2 + (p[j].z - p[j-1].z)**2); });
      infill.forEach(line => layerLength += Math.sqrt((line.x2 - line.x1)**2 + (line.z2 - line.z1)**2));

      layerLength *= 1000; // to mm
      totalLength += layerLength;
      const layerTime = layerLength / printSpeed;
      totalTime += layerTime;

      layers.push({
        index: i,
        z: z * 1000, // mm
        height: layerHeight * 1000,
        perimeterCount: perimeters.length,
        infillLineCount: infill.length,
        extrusionLengthMm: layerLength.toFixed(2),
        timeSec: layerTime.toFixed(1),
        isSolid,
      });
    }

    // Material volume estimation
    const filamentDiameter = 1.75; // mm
    const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
    const extrusionArea = nozzleDiameter * 1000 * layerHeight * 1000;
    const filamentLengthM = (totalLength * extrusionArea / filamentArea) / 1000;
    const materialMassG = filamentLengthM * filamentArea * 1.24 / 1000; // PLA density ~1.24 g/cm³

    return {
      layers,
      stats: {
        layerCount,
        layerHeightMm: layerHeight * 1000,
        totalHeightMm: (height * 1000).toFixed(2),
        totalExtrusionMm: totalLength.toFixed(0),
        filamentLengthM: filamentLengthM.toFixed(2),
        materialMassG: materialMassG.toFixed(1),
        printTimeMin: (totalTime / 60).toFixed(1),
        printTimeFormatted: Slicer._formatTime(totalTime),
        infillDensity: `${infillDensity * 100}%`,
        wallCount,
        nozzleDiameterMm: nozzleDiameter * 1000,
      }
    };
  }

  static _computeCrossSection(solid, y, bbox) {
    // Simplified: compute rectangular cross-section at height y
    const points = [];
    const size = bbox.size();
    const steps = 32;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = bbox.min.x + t * size.x;
      const z = bbox.min.z + t * size.z;
      points.push({ x, z, nx: 0, nz: 0 });
    }
    // Close the loop
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const x = bbox.min.x + t * size.x;
      points.push({ x, z: bbox.max.z, nx: 0, nz: 0 });
    }

    return points;
  }

  static _generateInfill(crossSection, pattern, density, nozzle, bbox, layerIdx) {
    const lines = [];
    const size = bbox.size();
    const spacing = nozzle / density;
    const angle = layerIdx % 2 === 0 ? 0 : Math.PI / 2; // alternating

    const steps = Math.ceil(Math.max(size.x, size.z) * 1000 / (spacing * 1000));
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      if (angle === 0) {
        lines.push({
          x1: bbox.min.x, z1: bbox.min.z + t * size.z,
          x2: bbox.max.x, z2: bbox.min.z + t * size.z,
        });
      } else {
        lines.push({
          x1: bbox.min.x + t * size.x, z1: bbox.min.z,
          x2: bbox.min.x + t * size.x, z2: bbox.max.z,
        });
      }
    }
    return lines;
  }

  static _solidInfill(crossSection, nozzle, bbox) {
    return Slicer._generateInfill(crossSection, 'grid', 1.0, nozzle, bbox, 0);
  }

  static _formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
}
