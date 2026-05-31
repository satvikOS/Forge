// Threaded rod — a real single-start helical V-thread, built as a direct
// parametric mesh: at axial height y and circumferential angle θ the
// radius follows a triangle-wave of the helical phase (y/pitch − θ/2π),
// so one crest wraps the circumference (single start) and spirals up with
// the pitch. Axis +Y, base y=0. Kernel-dependent.

import { getManifold } from './manifoldKernel.js';

/**
 * @param {object} o
 * @param {number} o.length       rod length along +Y (mm)
 * @param {number} o.majorR       major (crest) radius (mm)
 * @param {number} o.pitch        thread lead — rise per turn (mm)
 * @param {number} o.threadDepth  crest-to-root depth (mm)
 * @param {number} [o.sides]      circumferential facets (>=24 for clean threads)
 * @param {number} [o.stationsPerPitch] axial samples per pitch (>=8)
 * @returns {Promise<Manifold>}
 */
export async function threadedRod({
  length = 600, majorR = 80, pitch = 60, threadDepth = 20, sides = 56, stationsPerPitch = 12,
}) {
  const Mod = await getManifold();
  const minorR = Math.max(1, majorR - threadDepth);
  const S = Math.max(24, Math.floor(sides));
  const N = Math.max(24, Math.floor((length / pitch) * Math.max(8, stationsPerPitch)));
  const stations = [];
  for (let i = 0; i <= N; i++) {
    const y = (i / N) * length;
    const ring = [];
    for (let j = 0; j < S; j++) {
      const th = 2 * Math.PI * j / S;
      let ph = (y / pitch) - (th / (2 * Math.PI));
      ph -= Math.floor(ph);                       // fractional phase 0..1
      const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2; // triangle wave 0..1..0
      const r = minorR + threadDepth * tri;
      ring.push([r * Math.cos(th), y, r * Math.sin(th)]);
    }
    stations.push(ring);
  }
  const verts = [];
  for (const ring of stations) for (const p of ring) verts.push(p[0], p[1], p[2]);
  const tris = [];
  const idx = (i, j) => i * S + j;
  // rings advance +Y in the XZ plane → outward normals need the opposite
  // winding from a +Z/XY tube (flipped vs FlexPipe, else volume is < 0).
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < S; j++) {
      const j1 = (j + 1) % S;
      tris.push(idx(i, j), idx(i + 1, j1), idx(i, j1));
      tris.push(idx(i, j), idx(i + 1, j), idx(i + 1, j1));
    }
  }
  const fan = (off, flip) => {
    for (let j = 1; j < S - 1; j++) {
      if (flip) tris.push(off, off + j + 1, off + j);
      else tris.push(off, off + j, off + j + 1);
    }
  };
  fan(0, false);
  fan(N * S, true);
  const mesh = new Mod.Mesh({ vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris) });
  return new Mod.Manifold(mesh);
}
