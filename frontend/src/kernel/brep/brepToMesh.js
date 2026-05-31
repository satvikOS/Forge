/**
 * ArchDisc Kernel — convert a tessellated BrepShape into a THREE.Mesh.
 * Geometry is in mm; the caller wraps the mesh in a 0.001-scaled group.
 */

import * as THREE from 'three';
import { tessellate } from './BrepTessellate.js';

/**
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {object} [opts] { color, deflection }
 * @returns {Promise<THREE.Mesh>}
 */
export async function brepToMesh(brepShape, opts = {}) {
  const { color = 0x9aa3ad, deflection = 0.1 } = opts;
  const { positions, normals, indices } = await tessellate(brepShape, deflection);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const material = new THREE.MeshStandardMaterial({
    color, metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.brepShapeId = brepShape.id;
  return mesh;
}
