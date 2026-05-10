/**
 * ArchDisc Foundation — Manifold → three.js bridge.
 *
 * Converts a manifold-3d `Manifold` into a three.js `BufferGeometry`
 * for direct rendering. The bridge does not duplicate vertex memory
 * unnecessarily — vertProperties is taken straight from the manifold
 * mesh.
 */

import * as THREE from 'three';

/**
 * Build a three.js BufferGeometry from a Manifold.
 * @param {Manifold} manifold
 * @returns {THREE.BufferGeometry}
 */
export function manifoldToGeometry(manifold) {
  const mesh = manifold.getMesh();
  const numProp = mesh.numProp;
  const vertProps = mesh.vertProperties;
  const triVerts = mesh.triVerts;
  const numVert = vertProps.length / numProp;

  // Extract positions (first 3 props per vertex)
  const positions = new Float32Array(numVert * 3);
  for (let i = 0; i < numVert; i++) {
    positions[i * 3]     = vertProps[i * numProp];
    positions[i * 3 + 1] = vertProps[i * numProp + 1];
    positions[i * 3 + 2] = vertProps[i * numProp + 2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(triVerts), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Build a three.js Mesh (geometry + material) from a Manifold.
 * Default material is matte gray PBR.
 *
 * @param {Manifold} manifold
 * @param {object} opts
 * @param {number}  opts.color
 * @param {number}  opts.roughness  (0 = mirror, 1 = matte)
 * @param {number}  opts.metalness  (0 = dielectric, 1 = metal)
 * @param {boolean} opts.flatShading
 * @returns {THREE.Mesh}
 */
export function manifoldToMesh(manifold, opts = {}) {
  const geometry = manifoldToGeometry(manifold);
  const material = new THREE.MeshStandardMaterial({
    color:        opts.color ?? 0x9aa3ad,
    roughness:    opts.roughness ?? 0.55,
    metalness:    opts.metalness ?? 0.30,
    flatShading:  opts.flatShading ?? false,
    side:         THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
