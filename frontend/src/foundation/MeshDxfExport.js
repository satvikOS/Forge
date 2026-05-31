/**
 * DXF Export — emits an AutoCAD R12 ASCII DXF file with every body's
 * tessellation as 3DFACE entities, one per body grouped on a named
 * LAYER (the body's name). DXF is the universal fabrication-shop
 * format — waterjet, laser, CNC, and AutoCAD seats all consume it
 * directly without conversion.
 *
 * Why R12 (AC1009): the spec is fully documented, ASCII, and every
 * downstream tool reads it. Modern DXF (AC1027+) supports more
 * primitives but the R12 subset covers triangles, lines, and layers,
 * which is enough for ArchDisc's geometry hand-off use case.
 *
 * Format:
 *
 *   0
 *   SECTION
 *   2
 *   HEADER
 *   9
 *   $ACADVER
 *   1
 *   AC1009
 *   0
 *   ENDSEC
 *   0
 *   SECTION
 *   2
 *   TABLES
 *   0
 *   TABLE
 *   2
 *   LAYER
 *   …layer defs…
 *   0
 *   ENDTAB
 *   0
 *   ENDSEC
 *   0
 *   SECTION
 *   2
 *   ENTITIES
 *   …3DFACE entries…
 *   0
 *   ENDSEC
 *   0
 *   EOF
 */

import * as THREE from 'three';

function listBodies() {
  if (typeof window === 'undefined' || !window.__archdiscBodies) return [];
  const reg = window.__archdiscBodies;
  if (typeof reg.list === 'function') return reg.list();
  if (Array.isArray(reg.bodies)) return reg.bodies;
  return [];
}

function safeLayer(name, idx) {
  // DXF R12 layer names: ≤ 31 chars, no spaces / commas / : / ; / *.
  const raw = String(name ?? `Body_${idx + 1}`).replace(/[^A-Za-z0-9_-]/g, '_');
  return (raw.length === 0 ? `Body_${idx + 1}` : raw).slice(0, 31);
}

/**
 * @returns {{ok:boolean, bodies:number, faces:number, bytes:number,
 *            zipBytes?:undefined, dxf:string, filename:string}}
 */
export function exportDxf(opts = {}) {
  const bodies = listBodies();
  if (bodies.length === 0) {
    return { ok: false, reason: 'empty-scene', bodies: 0, faces: 0, bytes: 0, dxf: '' };
  }

  // ─── HEADER section ─────────────────────────────────────────────────
  const lines = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$ACADVER',
    '1', 'AC1009',           // R12
    '9', '$INSUNITS',
    '70', '4',                // 4 = millimetres
    '0', 'ENDSEC',
  ];

  // ─── TABLES section: one LAYER per body so each part is a separate
  // toggleable layer in any DXF viewer / AutoCAD seat ────────────────
  const layerNames = bodies.map((b, i) => safeLayer(b.name, i));
  lines.push('0', 'SECTION', '2', 'TABLES');
  lines.push('0', 'TABLE', '2', 'LAYER', '70', String(layerNames.length));
  // Distinct AutoCAD colour numbers (1-9 = red/yellow/green/cyan/blue/
  // magenta/white/gray/light-gray); cycle if more bodies than colours.
  const COLOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = 0; i < layerNames.length; i++) {
    lines.push(
      '0', 'LAYER',
      '2', layerNames[i],
      '70', '0',                                      // no flags
      '62', String(COLOURS[i % COLOURS.length]),      // colour
      '6', 'CONTINUOUS',                              // linetype
    );
  }
  lines.push('0', 'ENDTAB', '0', 'ENDSEC');

  // ─── ENTITIES section: one 3DFACE per triangle, on the body's layer.
  // Coordinates emitted in mm (world × 1000 to undo the standard 0.001
  // Group scale baked into every body's wrapper). ─────────────────────
  lines.push('0', 'SECTION', '2', 'ENTITIES');

  let totalFaces = 0;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  for (let bi = 0; bi < bodies.length; bi++) {
    const body = bodies[bi];
    if (!body?.group) continue;
    const layer = layerNames[bi];
    body.group.updateMatrixWorld(true);
    body.group.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      const pos = obj.geometry.attributes.position;
      if (!pos) return;
      const idx = obj.geometry.index;
      const matrix = obj.matrixWorld;
      const triCount = idx ? idx.count : pos.count;
      for (let i = 0; i < triCount; i += 3) {
        const i0 = idx ? idx.getX(i)     : i;
        const i1 = idx ? idx.getX(i + 1) : i + 1;
        const i2 = idx ? idx.getX(i + 2) : i + 2;
        tmpA.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0)).applyMatrix4(matrix);
        tmpB.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1)).applyMatrix4(matrix);
        tmpC.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2)).applyMatrix4(matrix);
        // DXF 3DFACE expects 4 corners; degenerate the 4th into the 3rd
        // for triangle output.
        lines.push(
          '0', '3DFACE',
          '8', layer,
          '10', (tmpA.x * 1000).toFixed(4), '20', (tmpA.y * 1000).toFixed(4), '30', (tmpA.z * 1000).toFixed(4),
          '11', (tmpB.x * 1000).toFixed(4), '21', (tmpB.y * 1000).toFixed(4), '31', (tmpB.z * 1000).toFixed(4),
          '12', (tmpC.x * 1000).toFixed(4), '22', (tmpC.y * 1000).toFixed(4), '32', (tmpC.z * 1000).toFixed(4),
          '13', (tmpC.x * 1000).toFixed(4), '23', (tmpC.y * 1000).toFixed(4), '33', (tmpC.z * 1000).toFixed(4),
        );
        totalFaces += 1;
      }
    });
  }
  lines.push('0', 'ENDSEC', '0', 'EOF');

  // DXF uses CRLF terminators per the AutoCAD spec for portability.
  const dxf = lines.join('\r\n') + '\r\n';
  const filename = opts.filename ?? `archdisc-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.dxf`;

  if (opts.download !== false && typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      const blob = new Blob([dxf], { type: 'application/dxf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('[DXF] download failed', err);
    }
  }

  return {
    ok: true,
    bodies: bodies.length,
    faces: totalFaces,
    bytes: dxf.length,
    dxf,
    filename,
  };
}

export default { exportDxf };
