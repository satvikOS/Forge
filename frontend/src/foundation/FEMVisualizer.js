/**
 * ArchDisc Foundation — FEM result visualization.
 *
 * Given a TetMesh + FEM result + optional surface manifold, produces
 * a three.js Mesh whose vertex colors encode the field of interest
 * (default: nodal von Mises stress).
 *
 * Two output modes:
 *   • "tet-surface"  — extract the boundary faces of the tet mesh and
 *                      color them by interpolated nodal field. Good for
 *                      voxel-grid meshes where the staircased boundary
 *                      makes the FEM domain visible.
 *   • "manifold"     — use the original manifold's surface triangles
 *                      and resample the nodal field at each surface
 *                      vertex via nearest-neighbor in the tet mesh.
 *                      Cleaner visual on real geometry.
 */

import * as THREE from 'three';

/**
 * Map a normalized scalar (0..1) to a color (jet-like colormap, hot end).
 */
function viridis(t) {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.min(1, Math.max(0, 1.5 - 4 * Math.abs(x - 0.75)));
  const g = Math.min(1, Math.max(0, 1.5 - 4 * Math.abs(x - 0.50)));
  const b = Math.min(1, Math.max(0, 1.5 - 4 * Math.abs(x - 0.25)));
  return [r, g, b];
}

/**
 * Build a Mesh with per-vertex color encoding the field. Returns the
 * mesh + a small stats object (min/max field).
 */
export function buildTetSurfaceColoredMesh(tetMesh, nodalField, opts = {}) {
  // Build face → count map. Keys are sorted vertex triplets. Faces
  // with count 1 are boundary; count 2 are internal.
  const faceMap = new Map();
  const TET_FACES = [
    [0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3],
  ];
  for (const t of tetMesh.tets) {
    for (const fi of TET_FACES) {
      const a = t[fi[0]], b = t[fi[1]], c = t[fi[2]];
      const sorted = [a, b, c].sort((x, y) => x - y);
      const key = `${sorted[0]},${sorted[1]},${sorted[2]}`;
      const entry = faceMap.get(key);
      if (entry) entry.count++;
      else faceMap.set(key, { count: 1, verts: [a, b, c] });
    }
  }
  const boundary = [];
  for (const v of faceMap.values()) if (v.count === 1) boundary.push(v.verts);

  // Field range
  let fmin = Infinity, fmax = -Infinity;
  for (let i = 0; i < nodalField.length; i++) {
    if (nodalField[i] < fmin) fmin = nodalField[i];
    if (nodalField[i] > fmax) fmax = nodalField[i];
  }
  const fRange = (fmax - fmin) || 1;

  // Build buffers — one position+color per face vertex (no shared
  // vertices, so we get crisp face colors).
  const positions = new Float32Array(boundary.length * 9);
  const colors = new Float32Array(boundary.length * 9);
  for (let f = 0; f < boundary.length; f++) {
    const [a, b, c] = boundary[f];
    const va = tetMesh.vertices[a];
    const vb = tetMesh.vertices[b];
    const vc = tetMesh.vertices[c];
    positions[f * 9]     = va[0]; positions[f * 9 + 1] = va[1]; positions[f * 9 + 2] = va[2];
    positions[f * 9 + 3] = vb[0]; positions[f * 9 + 4] = vb[1]; positions[f * 9 + 5] = vb[2];
    positions[f * 9 + 6] = vc[0]; positions[f * 9 + 7] = vc[1]; positions[f * 9 + 8] = vc[2];
    const ta = (nodalField[a] - fmin) / fRange;
    const tb = (nodalField[b] - fmin) / fRange;
    const tc = (nodalField[c] - fmin) / fRange;
    const ca = viridis(ta), cb = viridis(tb), cc = viridis(tc);
    colors[f * 9]     = ca[0]; colors[f * 9 + 1] = ca[1]; colors[f * 9 + 2] = ca[2];
    colors[f * 9 + 3] = cb[0]; colors[f * 9 + 4] = cb[1]; colors[f * 9 + 5] = cb[2];
    colors[f * 9 + 6] = cc[0]; colors[f * 9 + 7] = cc[1]; colors[f * 9 + 8] = cc[2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: opts.flatShading ?? false,
    roughness:   opts.roughness ?? 0.55,
    metalness:   opts.metalness ?? 0.10,
    side:        THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  return { mesh, stats: { min: fmin, max: fmax, boundaryFaces: boundary.length } };
}

/**
 * Apply displacement (3N vector) to the tet mesh's vertices. Returns a
 * NEW TetMesh-like object — original is untouched. `scaleFactor` lets
 * you exaggerate small deformations for visualization (default 1).
 */
export function deformTetMesh(tetMesh, displacement, scaleFactor = 1) {
  const out = { vertices: [], tets: tetMesh.tets, metadata: tetMesh.metadata };
  for (let i = 0; i < tetMesh.vertices.length; i++) {
    const v = tetMesh.vertices[i];
    out.vertices.push([
      v[0] + displacement[i * 3]     * scaleFactor,
      v[1] + displacement[i * 3 + 1] * scaleFactor,
      v[2] + displacement[i * 3 + 2] * scaleFactor,
    ]);
  }
  return out;
}

/**
 * Build a small color-bar legend + numeric tick marks as a three.js
 * sprite that can be added to a scene's HUD layer. (Kept tiny — for
 * production usage you'd render the legend as DOM overlay; this is
 * sufficient for screenshot tests.)
 */
export function buildLegendSprite(stats, units = 'MPa') {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const c = viridis(t);
    grad.addColorStop(t, `rgb(${(c[0]*255)|0},${(c[1]*255)|0},${(c[2]*255)|0})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(8, 8, 240, 24);
  ctx.fillStyle = 'white';
  ctx.font = '14px monospace';
  ctx.fillText(`${stats.min.toFixed(2)}`, 8, 56);
  ctx.fillText(`${stats.max.toFixed(2)} ${units}`, 180, 56);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(1, 0.25, 1);
  return sprite;
}
