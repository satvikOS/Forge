/**
 * ArchDisc Foundation — GLTF 2.0 / GLB binary export.
 *
 * GLTF is the de-facto interchange format for 3D scenes on the web,
 * AR (Apple Quick Look, Google Scene Viewer), VR (WebXR), and modern
 * desktop viewers. A foundation Manifold becomes embeddable in any
 * HTML page via Google's `<model-viewer>` web component just by
 * pointing it at the .gltf or .glb URL.
 *
 * GLTF JSON layout (https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html):
 *
 *   {
 *     "asset":      { "version": "2.0", "generator": "ArchDisc Foundation" },
 *     "scenes":     [{ "nodes": [0] }],
 *     "scene":      0,
 *     "nodes":      [{ "mesh": 0 }],
 *     "meshes":     [{
 *       "primitives": [{
 *         "attributes": { "POSITION": 0, "NORMAL": 1 },
 *         "indices":   2,
 *         "material":  0
 *       }]
 *     }],
 *     "accessors":  [ position-Float32, normal-Float32, indices-UInt32 ],
 *     "bufferViews":[ ... ],
 *     "buffers":    [{ "uri": "data:..." or "byteLength": N, "uri": "buffer.bin" }],
 *     "materials":  [{ "pbrMetallicRoughness": { ... } }]
 *   }
 *
 * GLB is the binary single-file form: a 12-byte header + JSON chunk +
 * BIN chunk. Both chunks have 4-byte type/length headers.
 *
 * Two output paths:
 *   - manifoldToGLTF(manifold): GLTF JSON with embedded base64 buffer
 *   - manifoldToGLB(manifold):  GLB binary (Uint8Array)
 *
 * Manifold normals: computed on the fly from triangle face normals,
 * averaged at shared vertices for smooth shading.
 */

const GLB_MAGIC = 0x46546C67;       // "glTF" little-endian
const GLB_VERSION = 2;
const CHUNK_TYPE_JSON = 0x4E4F534A;  // "JSON"
const CHUNK_TYPE_BIN  = 0x004E4942;  // "BIN\0"

function getMesh(manifold) {
  if (manifold.getMesh) return manifold.getMesh();
  return manifold;
}

/**
 * Compute per-vertex smooth normals: each vertex's normal is the
 * area-weighted average of its incident triangle face normals.
 */
function computeSmoothNormals(verts, tris, numProp) {
  const numV = verts.length / numProp;
  const normals = new Float32Array(numV * 3);
  const numTri = tris.length / 3;
  for (let t = 0; t < numTri; t++) {
    const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
    const p0 = [verts[i0 * numProp], verts[i0 * numProp + 1], verts[i0 * numProp + 2]];
    const p1 = [verts[i1 * numProp], verts[i1 * numProp + 1], verts[i1 * numProp + 2]];
    const p2 = [verts[i2 * numProp], verts[i2 * numProp + 1], verts[i2 * numProp + 2]];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    // Area-weighted (cross product magnitude = 2 * area)
    for (const idx of [i0, i1, i2]) {
      normals[idx * 3]     += nx;
      normals[idx * 3 + 1] += ny;
      normals[idx * 3 + 2] += nz;
    }
  }
  // Normalize
  for (let i = 0; i < numV; i++) {
    const x = normals[i * 3], y = normals[i * 3 + 1], z = normals[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    normals[i * 3]     = x / l;
    normals[i * 3 + 1] = y / l;
    normals[i * 3 + 2] = z / l;
  }
  return normals;
}

function computeBoundingBox(verts, numProp) {
  const numV = verts.length / numProp;
  let xmin = Infinity, ymin = Infinity, zmin = Infinity;
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < numV; i++) {
    const x = verts[i * numProp], y = verts[i * numProp + 1], z = verts[i * numProp + 2];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  return { min: [xmin, ymin, zmin], max: [xmax, ymax, zmax] };
}

/**
 * Export a Manifold (or compatible mesh data) as a complete GLTF 2.0
 * JSON document with embedded base64 binary buffer.
 *
 * @param {Manifold|MeshLike} manifold
 * @param {object} options
 * @param {string} options.name       part name (default 'ArchDisc_Part')
 * @param {[number,number,number,number]} options.colorRGBA  default light grey
 * @param {number} options.metallic   default 0.4
 * @param {number} options.roughness  default 0.55
 * @returns {object} GLTF JSON object
 */
export function manifoldToGLTF(manifold, options = {}) {
  const mesh = getMesh(manifold);
  const numProp = mesh.numProp ?? 3;
  // Extract positions as Float32 (3 props per vertex)
  const numV = mesh.vertProperties.length / numProp;
  const positions = new Float32Array(numV * 3);
  for (let i = 0; i < numV; i++) {
    positions[i * 3]     = mesh.vertProperties[i * numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
  }
  const normals = computeSmoothNormals(mesh.vertProperties, mesh.triVerts, numProp);
  const indices = new Uint32Array(mesh.triVerts);
  const bbox = computeBoundingBox(mesh.vertProperties, numProp);

  // Pack into a single binary blob: positions || normals || indices
  // (each aligned to 4 bytes, which is automatic for Float32 / Uint32)
  const posBytes = positions.byteLength;
  const norBytes = normals.byteLength;
  const idxBytes = indices.byteLength;
  const totalBytes = posBytes + norBytes + idxBytes;
  const buf = new Uint8Array(totalBytes);
  buf.set(new Uint8Array(positions.buffer, positions.byteOffset, posBytes), 0);
  buf.set(new Uint8Array(normals.buffer, normals.byteOffset, norBytes), posBytes);
  buf.set(new Uint8Array(indices.buffer, indices.byteOffset, idxBytes), posBytes + norBytes);

  const base64 = bytesToBase64(buf);
  const dataUri = `data:application/octet-stream;base64,${base64}`;

  const gltf = {
    asset: { version: '2.0', generator: 'ArchDisc Foundation' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: options.name ?? 'ArchDisc_Part' }],
    meshes: [{
      name: options.name ?? 'ArchDisc_Part',
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        material: 0,
      }],
    }],
    materials: [{
      name: 'PBR',
      pbrMetallicRoughness: {
        baseColorFactor: options.colorRGBA ?? [0.7, 0.74, 0.78, 1.0],
        metallicFactor: options.metallic ?? 0.4,
        roughnessFactor: options.roughness ?? 0.55,
      },
    }],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: numV, type: 'VEC3',
        min: bbox.min, max: bbox.max,
      },
      { bufferView: 1, componentType: 5126, count: numV, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0,                  byteLength: posBytes,  target: 34962 },   // ARRAY_BUFFER
      { buffer: 0, byteOffset: posBytes,           byteLength: norBytes,  target: 34962 },
      { buffer: 0, byteOffset: posBytes + norBytes, byteLength: idxBytes,  target: 34963 },   // ELEMENT_ARRAY_BUFFER
    ],
    buffers: [{ byteLength: totalBytes, uri: dataUri }],
  };
  return gltf;
}

/**
 * Export a Manifold as a GLB binary (single file, Uint8Array).
 *
 * Layout: 12-byte header (magic + version + total length)
 *   + JSON chunk (length + type + JSON payload, padded to 4 bytes)
 *   + BIN chunk  (length + type + binary payload, padded to 4 bytes)
 */
export function manifoldToGLB(manifold, options = {}) {
  const gltf = manifoldToGLTF(manifold, options);
  // Strip the data URI from buffers[0]; replace with byteLength only
  // (the binary chunk supplies the actual bytes).
  const dataUri = gltf.buffers[0].uri;
  const totalBytes = gltf.buffers[0].byteLength;
  delete gltf.buffers[0].uri;

  const jsonStr = JSON.stringify(gltf);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  // Pad JSON to 4-byte boundary with spaces (0x20)
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = new Uint8Array(jsonBytes.length + jsonPad);
  jsonChunk.set(jsonBytes, 0);
  for (let i = 0; i < jsonPad; i++) jsonChunk[jsonBytes.length + i] = 0x20;

  // Decode the data URI back to bytes for the BIN chunk
  const base64 = dataUri.split(',')[1];
  const binBytes = base64ToBytes(base64);
  // Pad BIN chunk to 4-byte boundary with zeros
  const binPad = (4 - (binBytes.length % 4)) % 4;
  const binChunk = new Uint8Array(binBytes.length + binPad);
  binChunk.set(binBytes, 0);

  const headerLen = 12;
  const chunkHeaderLen = 8;
  const totalLen = headerLen + chunkHeaderLen + jsonChunk.length + chunkHeaderLen + binChunk.length;
  const out = new Uint8Array(totalLen);
  const view = new DataView(out.buffer);
  // Header
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLen, true);
  // JSON chunk
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, CHUNK_TYPE_JSON, true);
  out.set(jsonChunk, 20);
  // BIN chunk
  const binChunkOffset = 20 + jsonChunk.length;
  view.setUint32(binChunkOffset, binChunk.length, true);
  view.setUint32(binChunkOffset + 4, CHUNK_TYPE_BIN, true);
  out.set(binChunk, binChunkOffset + 8);
  return out;
}

/**
 * Build an HTML page with `<model-viewer>` embedded so the GLB file
 * can be viewed directly in any modern browser. No dependencies
 * beyond the model-viewer CDN script.
 */
export function buildModelViewerHTML(glbFilename, options = {}) {
  const title = options.title ?? 'ArchDisc Foundation Part';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<script type="module" src="https://unpkg.com/@google/model-viewer@^4/dist/model-viewer.min.js"><\/script>
<style>
  body { margin: 0; padding: 0; background: #f0f4f8; font-family: system-ui, sans-serif; }
  header { padding: 16px 24px; background: white; border-bottom: 1px solid #e1e4e8; }
  h1 { margin: 0; font-size: 20px; }
  .subtitle { color: #666; font-size: 13px; margin-top: 4px; }
  model-viewer { width: 100vw; height: calc(100vh - 70px); background: #f0f4f8; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="subtitle">Drag to orbit · scroll to zoom · double-tap for AR (mobile)</div>
</header>
<model-viewer
  src="${escapeHtml(glbFilename)}"
  alt="${escapeHtml(title)}"
  camera-controls
  auto-rotate
  shadow-intensity="1"
  exposure="1"
  ar
  ar-modes="webxr scene-viewer quick-look"
  environment-image="neutral"
></model-viewer>
</body>
</html>`;
}

// ---- internal helpers ----

function bytesToBase64(bytes) {
  // Browser-compatible base64 encoding without TextDecoder/btoa quirks
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  if (typeof btoa === 'function') return btoa(bin);
  // Node fallback
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
