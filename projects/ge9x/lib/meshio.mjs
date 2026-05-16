/**
 * GE9X build — triangle-mesh I/O.
 *
 * A mesh is { vertices: [[x,y,z],...], triangles: [[i,j,k],...] }.
 * Writers: binary STL, Wavefront OBJ, glTF 2.0 (embedded buffer).
 */

import { Buffer } from 'node:buffer';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
function faceNormal(v0, v1, v2) {
  const n = cross(sub(v1, v0), sub(v2, v0));
  const L = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / L, n[1] / L, n[2] / L];
}

/** Merge meshes, re-indexing triangles into one combined mesh. */
export function mergeMeshes(meshes) {
  const vertices = [];
  const triangles = [];
  for (const m of meshes) {
    const base = vertices.length;
    for (const v of m.vertices) vertices.push(v);
    for (const t of m.triangles) triangles.push([t[0] + base, t[1] + base, t[2] + base]);
  }
  return { vertices, triangles };
}

/** Triangle count + vertex count of a mesh. */
export function meshStats(mesh) {
  return { vertices: mesh.vertices.length, triangles: mesh.triangles.length };
}

/** Binary STL — returns a Buffer. */
export function toBinarySTL(mesh) {
  const n = mesh.triangles.length;
  const buf = Buffer.alloc(84 + n * 50);
  buf.write('GE9X engineering model — ArchDisc generated', 0);
  buf.writeUInt32LE(n, 80);
  let o = 84;
  for (const [a, b, c] of mesh.triangles) {
    const v0 = mesh.vertices[a], v1 = mesh.vertices[b], v2 = mesh.vertices[c];
    const nrm = faceNormal(v0, v1, v2);
    for (const x of nrm) { buf.writeFloatLE(x, o); o += 4; }
    for (const v of [v0, v1, v2]) for (const x of v) { buf.writeFloatLE(x, o); o += 4; }
    buf.writeUInt16LE(0, o); o += 2;
  }
  return buf;
}

/** Wavefront OBJ — returns a string. */
export function toOBJ(mesh, name = 'ge9x') {
  const lines = [`# GE9X engineering model — ArchDisc generated`, `o ${name}`];
  for (const v of mesh.vertices) {
    lines.push(`v ${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}`);
  }
  for (const t of mesh.triangles) {
    lines.push(`f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}`);
  }
  return lines.join('\n') + '\n';
}

/** glTF 2.0 with an embedded base64 buffer — returns a JSON string. */
export function toGLTF(mesh, name = 'ge9x') {
  const positions = new Float32Array(mesh.vertices.length * 3);
  for (let i = 0; i < mesh.vertices.length; i++) {
    positions[i * 3] = mesh.vertices[i][0];
    positions[i * 3 + 1] = mesh.vertices[i][1];
    positions[i * 3 + 2] = mesh.vertices[i][2];
  }
  const indices = new Uint32Array(mesh.triangles.length * 3);
  for (let i = 0; i < mesh.triangles.length; i++) {
    indices[i * 3] = mesh.triangles[i][0];
    indices[i * 3 + 1] = mesh.triangles[i][1];
    indices[i * 3 + 2] = mesh.triangles[i][2];
  }
  // Bounds for the POSITION accessor (required by the spec).
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.vertices) {
    for (let k = 0; k < 3; k++) {
      if (v[k] < min[k]) min[k] = v[k];
      if (v[k] > max[k]) max[k] = v[k];
    }
  }
  const posBytes = Buffer.from(positions.buffer);
  const idxBytes = Buffer.from(indices.buffer);
  const buffer = Buffer.concat([posBytes, idxBytes]);
  const gltf = {
    asset: { version: '2.0', generator: 'ArchDisc GE9X builder' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{
      byteLength: buffer.length,
      uri: 'data:application/octet-stream;base64,' + buffer.toString('base64'),
    }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length, byteLength: idxBytes.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: mesh.vertices.length, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
  };
  return JSON.stringify(gltf, null, 1);
}
