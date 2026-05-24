/**
 * ArchDisc Kernel — glTF 2.0 exporter with PBR material carriage (SP-13).
 *
 * Sub-Project SP-13 — Data exchange completion (Area M, T2). Native glTF 2.0
 * exporter that:
 *
 *   - Tessellates a SpineBody / BrepShape via the existing kernel faceter.
 *   - Reads PBR material parameters off SP-2 attributes:
 *       body.attributes['baseColor']      → pbrMetallicRoughness.baseColorFactor
 *       body.attributes['metallic']       → pbrMetallicRoughness.metallicFactor
 *       body.attributes['roughness']      → pbrMetallicRoughness.roughnessFactor
 *       body.attributes['materialName']   → material.name (also exposed in extras)
 *     Per-face colour attributes (face.attributes['color']) carry through as
 *     an `extras.faceColors` manifest so a round-trip can recover them.
 *   - Embeds extras: every user-namespace attribute on the body is serialised
 *     under `extras.archdiscAttributes` for full round-trip carriage.
 *
 * The output is a self-contained `.gltf` JSON file with the binary buffer
 * base64-embedded (single-file deliverable). For e2e + downstream readers,
 * the JSON is human-readable, the schema-valid glTF 2.0 structure is honoured.
 *
 * ── glTF 2.0 schema reference ──────────────────────────────────────────────
 *
 * Per Khronos GL Transmission Format 2.0 spec (the file format used by every
 * modern web-CAD viewer + game engine + Vercel/three.js viewport):
 *   { asset, scene, scenes, nodes, meshes, accessors, bufferViews, buffers,
 *     materials? } — minimal valid file requires asset.version === '2.0'.
 * pbrMetallicRoughness fields are normative (a real PBR shader reads them).
 *
 * Component types in accessors:
 *   5121 UNSIGNED_BYTE  5123 UNSIGNED_SHORT  5125 UNSIGNED_INT  5126 FLOAT
 *
 * Attribute targets in bufferViews:
 *   34962 ARRAY_BUFFER (vertex attribs)  34963 ELEMENT_ARRAY_BUFFER (indices)
 */

import { tessellate } from '../brep/BrepTessellate.js';

/**
 * Export a SpineBody / BrepShape to glTF 2.0 JSON text with embedded buffer.
 *
 * @param {object} body  SpineBody | BrepShape — must carry a TopoDS_Shape.
 * @param {object} [opts]
 * @param {string} [opts.name='ArchDisc_Part']
 * @param {number} [opts.deflection=0.1]   tessellation chord deviation (mm).
 * @returns {Promise<string>}  the glTF JSON file contents.
 */
export async function exportGltf(body, opts = {}) {
  if (!body) throw new Error('exportGltf: body required');
  const name = opts.name || 'ArchDisc_Part';
  const deflection = opts.deflection != null ? opts.deflection : 0.1;

  // Tessellate via the shared kernel faceter (the same call brepToMesh uses).
  // The brepShape contract is `.shape` + `_triangulation`; SpineBody inherits.
  const tess = await tessellate(body, deflection);
  const positions = tess.positions;        // Float32Array (mm)
  const normals = tess.normals;             // Float32Array
  const indices = tess.indices;             // Uint32Array
  const vertCount = positions.length / 3;

  // Compute bounds for the position accessor.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (vertCount === 0) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }

  // Build binary buffer: indices (uint32) + positions (float32) + normals (float32).
  // glTF spec § 3.6.2.2: bufferView byte offsets MUST satisfy the alignment of
  // their accessor component (uint32 → 4-byte, float32 → 4-byte). The natural
  // ordering here already satisfies that since every component is 4 bytes.
  const indexBytes = indices.length * 4;
  const posBytes = positions.length * 4;
  const normBytes = normals.length * 4;
  const totalBytes = indexBytes + posBytes + normBytes;

  const buffer = new ArrayBuffer(totalBytes);
  const indexView = new Uint32Array(buffer, 0, indices.length);
  const posView = new Float32Array(buffer, indexBytes, positions.length);
  const normView = new Float32Array(buffer, indexBytes + posBytes, normals.length);
  indexView.set(indices);
  posView.set(positions);
  normView.set(normals);

  // Base64-encode the binary buffer (small enough for SP-13 e2e).
  const base64 = arrayBufferToBase64(buffer);

  // Resolve PBR material from SP-2 attributes on the body if present.
  const spineBody = body.body || null;
  const material = resolvePbrMaterial(spineBody);

  // Resolve per-face colours if any.
  const faceColors = collectFaceColors(spineBody);

  // Collect every user-namespace attribute on the body as extras carriage.
  const bodyAttributes = collectUserAttributes(spineBody);

  // Build the glTF JSON.
  const gltf = {
    asset: {
      version: '2.0',
      generator: 'ArchDisc Kernel SP-13 — glTF 2.0 with PBR + attribute carriage',
    },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{
      name,
      mesh: 0,
      extras: {
        archdiscAttributes: bodyAttributes,
        archdiscFaceColors: faceColors,
      },
    }],
    meshes: [{
      name,
      primitives: [{
        attributes: { POSITION: 1, NORMAL: 2 },
        indices: 0,
        material: 0,
      }],
    }],
    materials: [material],
    accessors: [
      { bufferView: 0, componentType: 5125, count: indices.length, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: vertCount, type: 'VEC3',
        min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      { bufferView: 2, componentType: 5126, count: vertCount, type: 'VEC3' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: indexBytes, target: 34963 },
      { buffer: 0, byteOffset: indexBytes, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: indexBytes + posBytes, byteLength: normBytes, target: 34962 },
    ],
    buffers: [{
      uri: `data:application/octet-stream;base64,${base64}`,
      byteLength: totalBytes,
    }],
  };

  return JSON.stringify(gltf, null, 2);
}

/**
 * Parse a glTF JSON file and extract material + extras carriage. Used by e2e
 * to verify PBR + attribute round-trip.
 *
 * @param {string} text  glTF JSON.
 * @returns {{schema:string, vertCount:number, triCount:number,
 *            material:object, attributes:object, faceColors:object}}
 */
export function parseGltfSummary(text) {
  if (typeof text !== 'string') return null;
  let g;
  try { g = JSON.parse(text); } catch { return null; }
  const out = {
    schema: null,
    asset: g.asset || null,
    vertCount: 0,
    triCount: 0,
    material: null,
    attributes: null,
    faceColors: null,
    ok: false,
  };
  out.schema = (g.asset && g.asset.version) || null;
  if (g.accessors && g.accessors.length >= 2) {
    out.vertCount = g.accessors[1].count;
    out.triCount = Math.floor((g.accessors[0].count || 0) / 3);
  }
  if (g.materials && g.materials[0]) out.material = g.materials[0];
  if (g.nodes && g.nodes[0] && g.nodes[0].extras) {
    out.attributes = g.nodes[0].extras.archdiscAttributes || null;
    out.faceColors = g.nodes[0].extras.archdiscFaceColors || null;
  }
  out.ok = !!(out.schema === '2.0' && out.vertCount > 0 && out.material);
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolvePbrMaterial(spineBody) {
  // Sensible defaults — steel-grey, slightly metallic.
  let materialName = 'ArchDisc_Material';
  let baseColor = [0.62, 0.66, 0.72, 1.0];
  let metallic = 0.5;
  let roughness = 0.5;
  if (spineBody && spineBody.attributes) {
    const a = spineBody.attributes;
    if (a.materialName && typeof a.materialName.value === 'string') {
      materialName = a.materialName.value;
    } else if (a.material && typeof a.material.value === 'string') {
      materialName = a.material.value;
    }
    if (a.baseColor && Array.isArray(a.baseColor.value)) {
      const v = a.baseColor.value;
      if (v.length >= 3) {
        baseColor = [
          clamp01(v[0]), clamp01(v[1]), clamp01(v[2]),
          v.length >= 4 ? clamp01(v[3]) : 1.0,
        ];
      }
    }
    if (a.metallic && typeof a.metallic.value === 'number') {
      metallic = clamp01(a.metallic.value);
    }
    if (a.roughness && typeof a.roughness.value === 'number') {
      roughness = clamp01(a.roughness.value);
    }
  }
  return {
    name: materialName,
    pbrMetallicRoughness: {
      baseColorFactor: baseColor,
      metallicFactor: metallic,
      roughnessFactor: roughness,
    },
    extras: {
      archdiscMaterialName: materialName,
    },
  };
}

function collectFaceColors(spineBody) {
  if (!spineBody || typeof spineBody.faces !== 'function') return {};
  const out = {};
  for (const face of spineBody.faces()) {
    if (!face.attributes) continue;
    const c = face.attributes['color'];
    if (c && Array.isArray(c.value) && c.value.length >= 3) {
      const pid = face.persistentId || `f${face.transientId}`;
      out[pid] = c.value.slice(0, 4);
    }
  }
  return out;
}

function collectUserAttributes(spineBody) {
  const out = {};
  if (!spineBody || !spineBody.attributes) return out;
  for (const attr of Object.values(spineBody.attributes)) {
    if (attr.isSystem) continue;
    out[attr.key] = attr.value;
  }
  return out;
}

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function arrayBufferToBase64(buffer) {
  // Browser-friendly path using btoa. The buffer in SP-13 e2e is small
  // (a hydraulic spool is a few hundred KB of mesh data), so the
  // String.fromCharCode chunked approach is safe.
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  if (typeof btoa === 'function') return btoa(binary);
  // Fallback for Node — Buffer.from(binary, 'binary').toString('base64')
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(binary, 'binary').toString('base64');
  }
  return binary;  // Last-resort; e2e runs in Electron so btoa is available.
}
