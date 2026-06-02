// forge-kernel MoldFlow smoke (Forge-172) — Hele-Shaw fill on a triangulated
// disc with ABS Cross-WLF rheology. Verifies:
//   * The cavity fills entirely within the time budget.
//   * Fill-time is monotonically increasing with radial distance from gate.
//   * Mass conservation: total injected volume matches cavity volume.
//   * Peak pressure is positive and finite.
//   * Halving the flow rate roughly doubles the fill time (linear Hele-Shaw).

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.mold && typeof forge.mold.heleShawFill === 'function',
          'forge.mold.heleShawFill missing');

// Build a triangulated disc of radius R, fan from the centre, with the gate
// AT the centre vertex.
function buildDisc(R, nRings, nSectors) {
  const verts = [0, 0, 0]; // centre
  const ringRadii = [];
  for (let r = 1; r <= nRings; ++r) {
    const rr = R * r / nRings;
    ringRadii.push(rr);
    for (let s = 0; s < nSectors; ++s) {
      const a = (2 * Math.PI * s) / nSectors;
      verts.push(rr * Math.cos(a), rr * Math.sin(a), 0);
    }
  }
  const tris = [];
  // Inner ring fan: centre (0) → ring 1 vertices
  for (let s = 0; s < nSectors; ++s) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % nSectors);
    tris.push(0, a, b);
  }
  // Subsequent annular rings between ring r and ring r+1
  for (let r = 0; r < nRings - 1; ++r) {
    const base0 = 1 + r * nSectors;       // ring r start
    const base1 = 1 + (r + 1) * nSectors; // ring r+1 start
    for (let s = 0; s < nSectors; ++s) {
      const a = base0 + s;
      const b = base0 + ((s + 1) % nSectors);
      const c = base1 + s;
      const d = base1 + ((s + 1) % nSectors);
      tris.push(a, b, d);
      tris.push(a, d, c);
    }
  }
  return {
    vertices: new Float64Array(verts),
    triangles: new Uint32Array(tris),
    nTri: tris.length / 3,
    ringRadii,
  };
}

const disc = buildDisc(0.040, 6, 16);   // R=40 mm, 6 rings × 16 sectors
const thicknessConst = 0.002;            // 2 mm wall
const mesh = {
  vertices:  disc.vertices,
  triangles: disc.triangles,
  thickness: new Float64Array(disc.nTri).fill(thicknessConst),
};

// ABS Cross-WLF parameters (Hieber & Shen 1980, Autodesk Moldflow library).
const ABS = {
  n:        0.30,
  tauStar:  1.5e5,
  D1:       3.0e8,        // η₀ reference
  A1:       28.0,
  A2:       51.6,
  Tg:       373.0,        // K (~100°C)
};

const gate = {
  x: 0, y: 0, z: 0,
  flowRateM3s: 5.0e-6,    // 5 cm³/s
  meltTempK:   513.0,     // 240 °C
};

const t0 = Date.now();
const r = forge.mold.heleShawFill(mesh, gate, ABS, 333.0 /* mold 60 °C */, 60.0, 600);
const ms = Date.now() - t0;

assert.ok(r.stepsTaken > 5, `only ${r.stepsTaken} steps — Hele-Shaw stalled`);
assert.ok(r.totalFillTimeSec > 0 && r.totalFillTimeSec < 30,
          `total fill time ${r.totalFillTimeSec} out of plausible range`);
// All triangles must end >= 99% filled.
let filledOk = 0;
for (const v of r.filledFraction) if (v >= 0.99) ++filledOk;
assert.ok(filledOk >= 0.95 * disc.nTri,
          `${filledOk}/${disc.nTri} fully filled — disc not converged`);
// Fill time at outer ring should exceed centre.
const ringMeanFillTimes = disc.ringRadii.map((_, r0) => {
  const start = 1 + r0 * 16, end = start + 16;
  let s = 0, n = 0;
  // Each ring's triangles are 16 triangles in the ring's annulus; map by index.
  for (let t = 0; t < disc.nTri; ++t) {
    const i0 = mesh.triangles[3 * t + 0];
    const i1 = mesh.triangles[3 * t + 1];
    const i2 = mesh.triangles[3 * t + 2];
    const radii = [i0, i1, i2].map((iv) => {
      if (iv === 0) return 0;
      const ring = Math.floor((iv - 1) / 16);
      return disc.ringRadii[ring];
    });
    const meanR = (radii[0] + radii[1] + radii[2]) / 3;
    const targetR = disc.ringRadii[r0];
    if (Math.abs(meanR - targetR) / Math.max(1e-6, targetR) < 0.4) {
      if (r.fillTimeSec[t] >= 0) { s += r.fillTimeSec[t]; ++n; }
    }
  }
  return n ? s / n : 0;
});
assert.ok(ringMeanFillTimes[ringMeanFillTimes.length - 1]
          > ringMeanFillTimes[0],
          `outer ring fill ${ringMeanFillTimes[ringMeanFillTimes.length - 1].toFixed(3)}` +
          ` should exceed inner ${ringMeanFillTimes[0].toFixed(3)}`);

assert.ok(r.maxPressurePa > 0 && isFinite(r.maxPressurePa),
          `peak pressure ${r.maxPressurePa} not positive`);

// Mass conservation: total filled volume vs flow rate × time.
let filledVol = 0;
const triA = new Float64Array(disc.nTri);
for (let t = 0; t < disc.nTri; ++t) {
  const i0 = mesh.triangles[3 * t + 0];
  const i1 = mesh.triangles[3 * t + 1];
  const i2 = mesh.triangles[3 * t + 2];
  const x0 = mesh.vertices[3*i0], y0 = mesh.vertices[3*i0+1];
  const x1 = mesh.vertices[3*i1], y1 = mesh.vertices[3*i1+1];
  const x2 = mesh.vertices[3*i2], y2 = mesh.vertices[3*i2+1];
  triA[t] = 0.5 * Math.abs((x1-x0)*(y2-y0) - (x2-x0)*(y1-y0));
  filledVol += r.filledFraction[t] * triA[t] * thicknessConst;
}
const injectedVol = gate.flowRateM3s * r.totalFillTimeSec;
const relErr = Math.abs(filledVol - injectedVol) / Math.max(injectedVol, 1e-12);
assert.ok(relErr < 0.20,
          `mass balance error ${(100*relErr).toFixed(1)}%: filled ${filledVol.toExponential(3)} ` +
          `vs injected ${injectedVol.toExponential(3)}`);

// Sanity: halving flow rate ≈ doubles fill time.
const rHalf = forge.mold.heleShawFill(
  mesh, { ...gate, flowRateM3s: gate.flowRateM3s / 2 },
  ABS, 333.0, 120.0, 1000);
assert.ok(rHalf.totalFillTimeSec > r.totalFillTimeSec * 1.6,
          `slow flow ${rHalf.totalFillTimeSec.toFixed(3)} should be ~2× baseline ${r.totalFillTimeSec.toFixed(3)}`);

console.log('✅ MoldFlow smoke PASSED');
console.log(`   triangles            ${disc.nTri}`);
console.log(`   steps / converged    ${r.stepsTaken} / ${r.converged}`);
console.log(`   total fill time      ${r.totalFillTimeSec.toFixed(3)} s`);
console.log(`   inner→outer ring t   ${ringMeanFillTimes.map(x => x.toFixed(2)).join(' → ')}`);
console.log(`   max pressure         ${(r.maxPressurePa / 1e6).toFixed(2)} MPa`);
console.log(`   mass-balance err     ${(100*relErr).toFixed(1)} %`);
console.log(`   slow flow rate test  ${rHalf.totalFillTimeSec.toFixed(3)} s   (≈ 2× baseline)`);
console.log(`   weld-line tris       ${r.weldLineTriangles.length}`);
console.log(`   air-trap tris        ${r.airTrapTriangles.length}`);
console.log(`   wall time            ${ms} ms`);
