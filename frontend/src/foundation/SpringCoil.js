// Helical spring GEOMETRY (kernel-dependent — do NOT import at node level
// in e2e; the spring ANALYSIS math lives in the kernel-free Spring.js).
// A wire (circular section) swept along a helix → a real coil spring
// (suspension / valve / compression), via the rotation-minimizing-frame
// sweep. Axis +Y, base at y=0; caller reorients.

import { sweep, circleProfile } from './SweepLoft.js';

/**
 * @param {object} o
 * @param {number} o.coilR    coil (mean) radius (mm)
 * @param {number} o.wireR    wire cross-section radius (mm)
 * @param {number} o.pitch    rise per turn (mm) — keep > 2·wireR so coils don't fuse
 * @param {number} o.turns    number of active coils
 * @param {number} [o.perTurn] path samples per turn (>=12)
 * @returns {Promise<Manifold>}  spring, axis +Y, base at y=0
 */
export async function helicalSpring({ coilR = 120, wireR = 20, pitch = 80, turns = 8, perTurn = 28 }) {
  const n = Math.max(16, Math.floor(turns * Math.max(12, perTurn)));
  const path = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = 2 * Math.PI * turns * t;
    path.push([coilR * Math.cos(a), pitch * turns * t, coilR * Math.sin(a)]);
  }
  return await sweep({ profile2D: circleProfile(wireR, 16), path, samples: n });
}
