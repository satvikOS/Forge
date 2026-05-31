/**
 * 3MF Export — produces a Microsoft 3D Manufacturing Format archive
 * for the current scene. 3MF is the modern alternative to STL for
 * 3D-printing workflows (PrusaSlicer, Cura, Bambu Studio, Microsoft
 * 3D Builder all consume it), and unlike STL it preserves per-body
 * naming, vertex precision (XML float text), and (optionally) units.
 *
 * Format details (3MF Core 1.2 spec):
 *   - ZIP archive (.3mf) using STORE method
 *   - [Content_Types].xml          MIME registry
 *   - _rels/.rels                  start-part pointer to 3dmodel.model
 *   - 3D/3dmodel.model             main XML with <resources>/<object>/
 *                                  <mesh>/<vertices>/<triangles>
 *
 * Coordinates: 3MF requires mm. Our mesh geometry is already in
 * metres (Three.js scene units) with a 0.001-scale group above each
 * Mesh; we resolve the group transform via getWorldMatrix and multiply
 * by 1000 to convert each vertex to mm.
 */

import * as THREE from 'three';
import { makeZipBrowser } from './ProjectBundleExport.js';

const NS_CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const NS_REL  = 'http://schemas.openxmlformats.org/package/2006/relationships';

function xmlEscape(s) {
  return String(s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

function listBodies() {
  if (typeof window === 'undefined' || !window.__archdiscBodies) return [];
  const reg = window.__archdiscBodies;
  if (typeof reg.list === 'function') return reg.list();
  if (Array.isArray(reg.bodies)) return reg.bodies;
  return [];
}

/**
 * Walk a Three.js group and collect every triangle in world (mm) coords.
 * Returns { vertices: Float64Array (xyz×N), indices: Uint32Array (3·M) }.
 */
function harvestMeshMm(group) {
  const verts = [];   // mm
  const tris = [];
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  let vertexOffset = 0;

  group.updateMatrixWorld(true);

  group.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const geom = obj.geometry;
    const pos = geom.attributes.position;
    if (!pos) return;
    const idx = geom.index;
    const matrix = obj.matrixWorld;

    // Push vertices in world coords (metres), then scale to mm.
    for (let i = 0; i < pos.count; i++) {
      tmpA.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      tmpA.applyMatrix4(matrix);
      verts.push(tmpA.x * 1000, tmpA.y * 1000, tmpA.z * 1000);
    }

    const triCount = idx ? idx.count : pos.count;
    for (let i = 0; i < triCount; i += 3) {
      const i0 = idx ? idx.getX(i)     : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;
      tris.push(vertexOffset + i0, vertexOffset + i1, vertexOffset + i2);
    }
    vertexOffset += pos.count;
  });

  return { verts, tris };
}

function modelXml(bodies) {
  const objects = [];
  const buildItems = [];
  let objectId = 1;
  for (const body of bodies) {
    if (!body?.group) continue;
    const harvested = harvestMeshMm(body.group);
    if (harvested.verts.length === 0 || harvested.tris.length === 0) continue;

    const vertsXml = [];
    for (let i = 0; i < harvested.verts.length; i += 3) {
      vertsXml.push(
        `<vertex x="${harvested.verts[i].toFixed(6)}" y="${harvested.verts[i+1].toFixed(6)}" z="${harvested.verts[i+2].toFixed(6)}"/>`
      );
    }
    const trisXml = [];
    for (let i = 0; i < harvested.tris.length; i += 3) {
      trisXml.push(
        `<triangle v1="${harvested.tris[i]}" v2="${harvested.tris[i+1]}" v3="${harvested.tris[i+2]}"/>`
      );
    }
    const safeName = xmlEscape(body.name ?? `body-${objectId}`);
    objects.push(
`<object id="${objectId}" type="model" name="${safeName}">
  <mesh>
    <vertices>
${vertsXml.join('\n')}
    </vertices>
    <triangles>
${trisXml.join('\n')}
    </triangles>
  </mesh>
</object>`
    );
    buildItems.push(`<item objectid="${objectId}"/>`);
    objectId += 1;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}">
  <metadata name="Title">ArchDisc Mechanical CAD project</metadata>
  <metadata name="Application">ArchDisc-Mech</metadata>
  <metadata name="CreationDate">${new Date().toISOString()}</metadata>
  <resources>
${objects.join('\n')}
  </resources>
  <build>
${buildItems.join('\n    ')}
  </build>
</model>
`;
}

const CONTENT_TYPES_XML =
`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const ROOT_RELS_XML =
`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="${NS_REL}">
  <Relationship Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"
                Target="/3D/3dmodel.model"
                Id="rel0"/>
</Relationships>
`;

/**
 * Build the 3MF bytes for the current scene and trigger a download.
 *
 * @param {object} opts
 * @param {string=} opts.filename   Defaults to "archdisc-<timestamp>.3mf"
 * @param {boolean=} opts.download  Defaults to true; pass false to keep bytes only
 * @returns {{ok: boolean, bytes: number, objects: number, zipBytes: Uint8Array}}
 */
export function export3MF(opts = {}) {
  const bodies = listBodies();
  if (bodies.length === 0) {
    return { ok: false, reason: 'empty-scene', bytes: 0, objects: 0 };
  }

  const xml = modelXml(bodies);
  const objectsEmitted = (xml.match(/<object\b/g) || []).length;
  if (objectsEmitted === 0) {
    return { ok: false, reason: 'no-meshes', bytes: 0, objects: 0 };
  }

  const entries = [
    { path: '[Content_Types].xml',   data: CONTENT_TYPES_XML },
    { path: '_rels/.rels',           data: ROOT_RELS_XML },
    { path: '3D/3dmodel.model',      data: xml },
  ];
  const zipBytes = makeZipBrowser(entries);

  const filename = opts.filename ?? `archdisc-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.3mf`;
  if (opts.download !== false && typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      const blob = new Blob([zipBytes], { type: 'application/3mf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('[3MF] download failed', err);
    }
  }

  return { ok: true, bytes: zipBytes.length, objects: objectsEmitted, filename, zipBytes };
}

export default { export3MF };
