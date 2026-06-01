// Forge-88 — measure.* with real geometric queries.
//
// mass calls window.forge.massProps(handle) for native bodies (volume, mass,
// centroid, inertia tensor — all from OCCT).
// distance, angle, area, length compute from THREE.BufferGeometry coordinates
// of the selected entities — no faked numbers.

const k = () => (typeof window !== 'undefined' && window.forge);

export function massProps(handle) {
  if (typeof handle !== 'number') return { ok: false, error: 'no body handle' };
  try {
    const m = k()?.massProps?.(handle);
    if (!m) return { ok: false, error: 'kernel.massProps unavailable' };
    return {
      ok: true,
      volume_mm3: m.volume ?? m.Volume ?? 0,
      surface_mm2: m.surface ?? m.surfaceArea ?? 0,
      centroid: m.centroid || [0, 0, 0],
      inertia: m.inertia || [0, 0, 0, 0, 0, 0],
      // mass in g assuming default density 7.85 g/cm³ (steel) — UI overrides.
      mass_g: (m.volume || 0) * 7.85e-3,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function distance(a, b) {
  // a, b are [x,y,z] world points (e.g. centroids of selected entities).
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function angle(v0, v1) {
  // v0, v1 are direction vectors. Returns radians.
  const dot = v0[0]*v1[0] + v0[1]*v1[1] + v0[2]*v1[2];
  const n0 = Math.hypot(v0[0], v0[1], v0[2]);
  const n1 = Math.hypot(v1[0], v1[1], v1[2]);
  if (!n0 || !n1) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / (n0 * n1))));
}

/** Triangle area sum across a BufferGeometry index buffer (or non-indexed). */
export function meshArea(bufferGeometry) {
  if (!bufferGeometry) return 0;
  const pos = bufferGeometry.attributes?.position?.array;
  if (!pos) return 0;
  const idx = bufferGeometry.index?.array;
  let sum = 0;
  if (idx) {
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      sum += triangleArea(
        pos[a],pos[a+1],pos[a+2], pos[b],pos[b+1],pos[b+2], pos[c],pos[c+1],pos[c+2]);
    }
  } else {
    for (let i = 0; i < pos.length; i += 9) {
      sum += triangleArea(
        pos[i],pos[i+1],pos[i+2], pos[i+3],pos[i+4],pos[i+5], pos[i+6],pos[i+7],pos[i+8]);
    }
  }
  return sum;
}

function triangleArea(ax,ay,az, bx,by,bz, cx,cy,cz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy*vz - uz*vy;
  const ny = uz*vx - ux*vz;
  const nz = ux*vy - uy*vx;
  return 0.5 * Math.hypot(nx, ny, nz);
}

/** Bounding box of a BufferGeometry. */
export function meshBounds(g) {
  if (!g) return null;
  const pos = g.attributes?.position?.array;
  if (!pos) return null;
  let xmin = Infinity, ymin = Infinity, zmin = Infinity;
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i]   < xmin) xmin = pos[i];   if (pos[i]   > xmax) xmax = pos[i];
    if (pos[i+1] < ymin) ymin = pos[i+1]; if (pos[i+1] > ymax) ymax = pos[i+1];
    if (pos[i+2] < zmin) zmin = pos[i+2]; if (pos[i+2] > zmax) zmax = pos[i+2];
  }
  return { min:[xmin,ymin,zmin], max:[xmax,ymax,zmax],
           size:[xmax-xmin, ymax-ymin, zmax-zmin] };
}

export function detectInterference(bodyHandles, tolerance = 0.01) {
  const a = k()?.assembly;
  if (!a?.detectInterference) return { ok: false, error: 'assembly.detectInterference unavailable' };
  try {
    return { ok: true, pairs: a.detectInterference(bodyHandles, tolerance) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
