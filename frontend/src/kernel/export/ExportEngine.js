/**
 * ArchDisc Geometry Kernel — Export Engine
 * Exports B-Rep solids to standard file formats.
 * Supports: STL (binary + ASCII), OBJ, glTF 2.0
 */

import Tessellator from '../tessellation/Tessellator.js';
import STEPExporter from './STEPExporter.js';

export default class ExportEngine {

  /**
   * Export solid as STL (ASCII format).
   * @param {TopoSolid} solid
   * @param {string} name - Solid name (default: 'ArchDisc')
   * @returns {string} STL file content
   */
  static toSTL(solid, name = 'ArchDisc') {
    const tess = Tessellator.tessellate(solid);
    const verts = tess.vertices;
    const norms = tess.normals;
    const indices = tess.indices;

    const lines = [`solid ${name}`];

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];

      // Average normal of the triangle
      const nx = (norms[i0 * 3] + norms[i1 * 3] + norms[i2 * 3]) / 3;
      const ny = (norms[i0 * 3 + 1] + norms[i1 * 3 + 1] + norms[i2 * 3 + 1]) / 3;
      const nz = (norms[i0 * 3 + 2] + norms[i1 * 3 + 2] + norms[i2 * 3 + 2]) / 3;

      lines.push(`  facet normal ${nx} ${ny} ${nz}`);
      lines.push(`    outer loop`);
      lines.push(`      vertex ${verts[i0 * 3]} ${verts[i0 * 3 + 1]} ${verts[i0 * 3 + 2]}`);
      lines.push(`      vertex ${verts[i1 * 3]} ${verts[i1 * 3 + 1]} ${verts[i1 * 3 + 2]}`);
      lines.push(`      vertex ${verts[i2 * 3]} ${verts[i2 * 3 + 1]} ${verts[i2 * 3 + 2]}`);
      lines.push(`    endloop`);
      lines.push(`  endfacet`);
    }

    lines.push(`endsolid ${name}`);
    return lines.join('\n');
  }

  /**
   * Export solid as binary STL.
   * @param {TopoSolid} solid
   * @returns {ArrayBuffer}
   */
  static toSTLBinary(solid) {
    const tess = Tessellator.tessellate(solid);
    const verts = tess.vertices;
    const norms = tess.normals;
    const indices = tess.indices;
    const triCount = indices.length / 3;

    // STL binary: 80-byte header + 4-byte tri count + 50 bytes per triangle
    const bufferSize = 84 + triCount * 50;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // Header (80 bytes) — "ArchDisc Geometry Kernel"
    const header = 'ArchDisc Geometry Kernel - Proprietary B-Rep Export';
    for (let i = 0; i < 80; i++) {
      view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
    }

    // Triangle count
    view.setUint32(80, triCount, true);

    let offset = 84;
    for (let t = 0; t < triCount; t++) {
      const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];

      // Normal
      const nx = (norms[i0 * 3] + norms[i1 * 3] + norms[i2 * 3]) / 3;
      const ny = (norms[i0 * 3 + 1] + norms[i1 * 3 + 1] + norms[i2 * 3 + 1]) / 3;
      const nz = (norms[i0 * 3 + 2] + norms[i1 * 3 + 2] + norms[i2 * 3 + 2]) / 3;

      view.setFloat32(offset, nx, true); offset += 4;
      view.setFloat32(offset, ny, true); offset += 4;
      view.setFloat32(offset, nz, true); offset += 4;

      // Vertex 1
      view.setFloat32(offset, verts[i0 * 3], true); offset += 4;
      view.setFloat32(offset, verts[i0 * 3 + 1], true); offset += 4;
      view.setFloat32(offset, verts[i0 * 3 + 2], true); offset += 4;
      // Vertex 2
      view.setFloat32(offset, verts[i1 * 3], true); offset += 4;
      view.setFloat32(offset, verts[i1 * 3 + 1], true); offset += 4;
      view.setFloat32(offset, verts[i1 * 3 + 2], true); offset += 4;
      // Vertex 3
      view.setFloat32(offset, verts[i2 * 3], true); offset += 4;
      view.setFloat32(offset, verts[i2 * 3 + 1], true); offset += 4;
      view.setFloat32(offset, verts[i2 * 3 + 2], true); offset += 4;

      // Attribute byte count
      view.setUint16(offset, 0, true); offset += 2;
    }

    return buffer;
  }

  /**
   * Export solid as OBJ format.
   * @param {TopoSolid} solid
   * @param {string} name
   * @returns {string} OBJ file content
   */
  static toOBJ(solid, name = 'ArchDisc') {
    const tess = Tessellator.tessellate(solid);
    const verts = tess.vertices;
    const norms = tess.normals;
    const indices = tess.indices;

    const lines = [
      `# ArchDisc Geometry Kernel Export`,
      `# Object: ${name}`,
      `o ${name}`,
    ];

    // Vertices
    const vertCount = verts.length / 3;
    for (let i = 0; i < vertCount; i++) {
      lines.push(`v ${verts[i * 3].toFixed(6)} ${verts[i * 3 + 1].toFixed(6)} ${verts[i * 3 + 2].toFixed(6)}`);
    }

    // Normals
    for (let i = 0; i < vertCount; i++) {
      lines.push(`vn ${norms[i * 3].toFixed(6)} ${norms[i * 3 + 1].toFixed(6)} ${norms[i * 3 + 2].toFixed(6)}`);
    }

    // Faces (1-indexed in OBJ)
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] + 1;
      const b = indices[i + 1] + 1;
      const c = indices[i + 2] + 1;
      lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
    }

    return lines.join('\n');
  }

  /**
   * Export solid as glTF 2.0 JSON (embedded buffer).
   * @param {TopoSolid} solid
   * @param {string} name
   * @returns {string} glTF JSON string
   */
  static toGLTF(solid, name = 'ArchDisc') {
    const tess = Tessellator.tessellate(solid);
    const verts = tess.vertices;
    const norms = tess.normals;
    const indices = tess.indices;

    // Compute bounds
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const vertCount = verts.length / 3;
    for (let i = 0; i < vertCount; i++) {
      const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    // Build binary buffer: indices (uint32) + positions (float32) + normals (float32)
    const indexBytes = indices.length * 4;
    const posBytes = verts.length * 4;
    const normBytes = norms.length * 4;
    const totalBytes = indexBytes + posBytes + normBytes;

    const buffer = new ArrayBuffer(totalBytes);
    const indexView = new Uint32Array(buffer, 0, indices.length);
    const posView = new Float32Array(buffer, indexBytes, verts.length);
    const normView = new Float32Array(buffer, indexBytes + posBytes, norms.length);

    indexView.set(indices);
    posView.set(verts);
    normView.set(norms);

    // Base64 encode
    const base64 = ExportEngine._arrayBufferToBase64(buffer);

    const gltf = {
      asset: { version: '2.0', generator: 'ArchDisc Geometry Kernel' },
      scene: 0,
      scenes: [{ name, nodes: [0] }],
      nodes: [{ name, mesh: 0 }],
      meshes: [{
        name,
        primitives: [{
          attributes: { POSITION: 1, NORMAL: 2 },
          indices: 0,
          material: 0,
        }]
      }],
      materials: [{
        name: 'ArchDisc Material',
        pbrMetallicRoughness: {
          baseColorFactor: [0.54, 0.57, 0.85, 1.0],
          metallicFactor: 0.3,
          roughnessFactor: 0.5,
        }
      }],
      accessors: [
        { bufferView: 0, componentType: 5125, count: indices.length, type: 'SCALAR' },
        { bufferView: 1, componentType: 5126, count: vertCount, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
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
   * Trigger a browser download of exported content.
   * @param {string|ArrayBuffer} content
   * @param {string} filename
   * @param {string} mimeType
   */
  static download(content, filename, mimeType = 'application/octet-stream') {
    let blob;
    if (content instanceof ArrayBuffer) {
      blob = new Blob([content], { type: mimeType });
    } else {
      blob = new Blob([content], { type: mimeType });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Export and download a solid in the specified format.
   * @param {TopoSolid} solid
   * @param {string} format - 'stl', 'stl-binary', 'obj', 'gltf'
   * @param {string} name
   */
  static exportSolid(solid, format, name = 'ArchDisc_Export') {
    switch (format) {
      case 'stl':
        ExportEngine.download(ExportEngine.toSTL(solid, name), `${name}.stl`, 'model/stl');
        break;
      case 'stl-binary':
        ExportEngine.download(ExportEngine.toSTLBinary(solid), `${name}.stl`, 'model/stl');
        break;
      case 'obj':
        ExportEngine.download(ExportEngine.toOBJ(solid, name), `${name}.obj`, 'model/obj');
        break;
      case 'gltf':
        ExportEngine.download(ExportEngine.toGLTF(solid, name), `${name}.gltf`, 'model/gltf+json');
        break;
      case 'step':
        ExportEngine.download(STEPExporter.toSTEP(solid, name), `${name}.step`, 'application/step');
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  static _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
