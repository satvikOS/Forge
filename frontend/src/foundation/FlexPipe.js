// Corrugated flex pipe — a bellows/convoluted tube (the corrugated
// exhaust flex section a heavy truck uses between the manifold downpipe
// and the stack). Built as a tube whose radius oscillates sinusoidally
// along its axis, so it reads as real convolutions. Straight along +Z;
// the caller rotates/translates it into the run. Kernel-dependent.

import { getManifold } from './manifoldKernel.js';

/**
 * @param {object} o
 * @param {number} o.length        run length along +Z (mm)
 * @param {number} o.radius        mean radius (mm)
 * @param {number} o.amplitude     convolution depth (± mm on the radius)
 * @param {number} o.convolutions  number of bellows rings over the length
 * @param {number} [o.sides]       circumferential facets (>=8)
 * @param {number} [o.stationsPerConv] axial samples per convolution (>=2)
 * @returns {Promise<Manifold>}
 */
export async function corrugatedPipe({
  length = 600, radius = 90, amplitude = 22, convolutions = 12,
  sides = 36, stationsPerConv = 6,
}) {
  const Mod = await getManifold();
  const conv = Math.max(1, Math.floor(convolutions));
  const S = Math.max(8, Math.floor(sides));
  const N = Math.max(8, conv * Math.max(2, Math.floor(stationsPerConv)));
  const stations = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = t * length;
    const rr = radius + amplitude * Math.sin(2 * Math.PI * conv * t - Math.PI / 2);
    const ring = [];
    for (let j = 0; j < S; j++) {
      const a = 2 * Math.PI * j / S;
      ring.push([rr * Math.cos(a), rr * Math.sin(a), z]);
    }
    stations.push(ring);
  }
  const verts = [];
  for (const ring of stations) for (const p of ring) verts.push(p[0], p[1], p[2]);
  const tris = [];
  const idx = (i, j) => i * S + j;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < S; j++) {
      const j1 = (j + 1) % S;
      tris.push(idx(i, j), idx(i, j1), idx(i + 1, j1));
      tris.push(idx(i, j), idx(i + 1, j1), idx(i + 1, j));
    }
  }
  // end caps (triangle fan over the first / last ring)
  const fan = (off, flip) => {
    for (let j = 1; j < S - 1; j++) {
      if (flip) tris.push(off, off + j + 1, off + j);
      else tris.push(off, off + j, off + j + 1);
    }
  };
  fan(0, true);
  fan(N * S, false);
  const mesh = new Mod.Mesh({ vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris) });
  return new Mod.Manifold(mesh);
}
