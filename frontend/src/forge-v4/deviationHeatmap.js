// Forge-162 — per-point deviation heatmap + statistical analysis.
//
// Inputs:
//   * measurement set from cmmImport — each feature has a probed
//     point and a nominal CAD point.
//   * optional CAD-surface point set — when supplied, deviation is
//     re-computed as Euclidean distance from each probed point to
//     the nearest CAD surface point (brute-force NN, fine for the
//     panel's demo sizes).
//
// Output:
//   * heatmap   — { points: [{x,y,z,dev,status}], min, max, mean,
//                  stdev, palette }
//   * stats     — { mean, stdev, Cp, Cpk } per ISO 14253 §A.2
//                 (Cp = (USL-LSL)/(6σ), Cpk = min((USL-µ)/(3σ),
//                 (µ-LSL)/(3σ))).
//   * conformity zones per ISO 14253 — count of points in pass /
//     warn / fail buckets.
//
// The renderer renders the heatmap as an SVG point cloud with a
// red/green/blue gradient (red = above tolerance, green = at
// nominal, blue = below tolerance).

export function computeHeatmap(measurement, opts = {}) {
  const surface = opts.cadSurfacePoints || null;
  const tolDefault = opts.toleranceDefault ?? 0.1;

  const points = [];
  for (const f of measurement.features) {
    const probed = f.probed;
    if (probed.x == null || probed.y == null || probed.z == null) continue;
    let dx, dy, dz, dev;
    if (surface) {
      const nn = nearestSurfacePt(probed, surface);
      dx = probed.x - nn.x;
      dy = probed.y - nn.y;
      dz = probed.z - nn.z;
      dev = Math.sqrt(dx * dx + dy * dy + dz * dz);
    } else {
      dx = (probed.x - (f.nominal.x ?? 0));
      dy = (probed.y - (f.nominal.y ?? 0));
      dz = (probed.z - (f.nominal.z ?? 0));
      dev = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const tolHi = f.tolerance?.hi ?? tolDefault;
    const tolLo = f.tolerance?.lo ?? -tolDefault;
    const tol = Math.max(Math.abs(tolHi), Math.abs(tolLo));
    const status =
      dev <= tol * 0.8 ? 'pass'
      : dev <= tol     ? 'warn'
      :                  'fail';
    // Signed deviation — sign comes from the dot product with the
    // outward direction (probed - nominal) projected onto a "more
    // material" / "less material" axis.  For point features we use
    // the sign of (dx + dy + dz) as a coarse approximation; for
    // axial features the projection along axis would be exact.
    const signed = (dx + dy + dz) >= 0 ? dev : -dev;
    points.push({
      id: f.id, name: f.name,
      x: probed.x, y: probed.y, z: probed.z,
      dev, signed, status,
      tolHi, tolLo,
    });
  }
  // Stats.
  const n = points.length;
  const devs = points.map((p) => p.signed);
  const mean = devs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const variance = devs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const stdev = Math.sqrt(variance);
  // Process capability — use the median tolerance band.
  const tols = points.map((p) => Math.max(Math.abs(p.tolHi), Math.abs(p.tolLo)));
  const tolMed = median(tols);
  const usl = +tolMed, lsl = -tolMed;
  const Cp  = stdev > 0 ? (usl - lsl) / (6 * stdev) : Infinity;
  const Cpk = stdev > 0
    ? Math.min((usl - mean) / (3 * stdev), (mean - lsl) / (3 * stdev))
    : Infinity;

  // Conformity zones.
  const conformity = { pass: 0, warn: 0, fail: 0 };
  for (const p of points) conformity[p.status]++;

  // Min/max of signed deviation for palette range.
  let minD = Infinity, maxD = -Infinity;
  for (const p of points) {
    if (p.signed < minD) minD = p.signed;
    if (p.signed > maxD) maxD = p.signed;
  }
  if (!Number.isFinite(minD)) { minD = -1; maxD = 1; }
  return {
    points,
    min: minD, max: maxD, mean, stdev,
    stats: { mean, stdev, Cp, Cpk, count: n, tolMedian: tolMed },
    conformity,
  };
}

function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : 0.5 * (a[mid - 1] + a[mid]);
}

// Brute-force NN — supplied for completeness; for big surfaces a
// KD-tree should be used.
function nearestSurfacePt(p, surface) {
  let bestD = Infinity;
  let bestPt = surface[0];
  for (const s of surface) {
    const dx = s.x - p.x;
    const dy = s.y - p.y;
    const dz = s.z - p.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; bestPt = s; }
  }
  return bestPt;
}

// Map a signed deviation to a RGB hex string (red high, green near
// nominal, blue low) — the classical metrology colour scale.
export function colourFor(dev, range) {
  // Clamp to ±range.
  const r = Math.max(-range, Math.min(range, dev));
  const t = (r + range) / (2 * range);   // 0..1
  // Piecewise: blue → green at t=0.5 → red.
  let R, G, B;
  if (t < 0.5) {
    const k = t * 2;
    R = 0;       G = Math.round(255 * k);     B = Math.round(255 * (1 - k));
  } else {
    const k = (t - 0.5) * 2;
    R = Math.round(255 * k);  G = Math.round(255 * (1 - k));  B = 0;
  }
  return `rgb(${R},${G},${B})`;
}

// Convenience — return a feature pass/fail table ready for the
// FAI report PDF.
export function passFailTable(measurement) {
  return measurement.features.map((f) => ({
    id: f.id, name: f.name, kind: f.kind,
    nominal: f.nominal, probed: f.probed,
    tolerance: f.tolerance,
    deviation: f.result?.deviation ?? null,
    status:    f.result?.status    ?? 'unknown',
  }));
}
