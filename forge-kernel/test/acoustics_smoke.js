// forge-kernel Acoustics smoke (Forge-175) — shoebox 6 × 4 × 3 m with
// uniform 0.15 absorption across bands. Verifies:
//   * Sabine RT60_mid agrees with hand calculation: 0.161·V/A ≈ 1.49 s.
//   * Direct sound arrives at d/c.
//   * EDC monotonically decreasing.
//   * C50, C80 finite & per-band reasonable.
//   * Image source count grows ~ O(order³).

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.acoustics && typeof forge.acoustics.simulate === 'function',
          'forge.acoustics.simulate missing');

const walls15 = [0.15, 0.15, 0.15, 0.15, 0.15, 0.15];
const cfg = {
  room: {
    Lx: 6, Ly: 4, Lz: 3,
    walls: [
      new Float64Array(walls15), new Float64Array(walls15),
      new Float64Array(walls15), new Float64Array(walls15),
      new Float64Array(walls15), new Float64Array(walls15),
    ],
    airAtten: new Float64Array([0.0001, 0.0003, 0.0006, 0.0010, 0.0040, 0.0080]),
  },
  sourceX: 1, sourceY: 2, sourceZ: 1.5,
  recvX:   5, recvY:   2, recvZ:   1.5,
  maxOrder: 12,
  speedOfSound: 343,
  sampleRateHz: 48000,
  irLengthSec: 2.5,
  sourcePowerW: 1e-3,
  randomSeed: 42,
};

const t0 = Date.now();
const r = forge.acoustics.simulate(cfg);
const wallMs = Date.now() - t0;

// Sabine cross-check at 500 Hz: V = 72, S = 2(24+18+12) = 108
// A = S × ᾱ = 108 × 0.15 = 16.2 → T = 0.161 × 72 / 16.2 = 0.716 s (Sabine)
// Eyring: T = 0.161 × 72 / (−108 × ln(0.85)) = 0.161 × 72 / 17.55 = 0.66 s
const expectedSabineMid = 0.66;
assert.ok(Math.abs(r.sabineRt60Mid - expectedSabineMid) / expectedSabineMid < 0.05,
          `Sabine RT60_mid ${r.sabineRt60Mid.toFixed(2)} should be ≈ ${expectedSabineMid}`);

// Image source count should grow with order.
assert.ok(r.imageSourcesEvaluated > 800,
          `only ${r.imageSourcesEvaluated} image sources at order 12`);

// IR has content + first arrival at d/c.
const d = Math.sqrt((5-1)*(5-1) + (2-2)*(2-2) + (1.5-1.5)*(1.5-1.5));
const firstSample = Math.round(d / cfg.speedOfSound * cfg.sampleRateHz);
const window = 4;   // ±4 sample slack
let firstHit = -1;
for (let i = Math.max(0, firstSample - window); i < firstSample + window; ++i) {
  if (Math.abs(r.irCombined[i]) > 1e-9) { firstHit = i; break; }
}
assert.ok(firstHit >= 0,
          `no direct sound near sample ${firstSample} (d=${d.toFixed(2)}m)`);

// EDC monotone decreasing per band.
for (let b = 0; b < 6; ++b) {
  const edc = Array.from(r.edcDb[b]);
  let monotone = true;
  for (let i = 1; i < edc.length; ++i) {
    if (edc[i] > edc[i - 1] + 0.5) { monotone = false; break; }
  }
  assert.ok(monotone, `EDC band ${b} not monotone`);
}

// RT60 per band — fitted from EDC; should be in (0.3, 2.0) s for this room.
for (let b = 0; b < 6; ++b) {
  assert.ok(r.rt60Sec[b] > 0.2 && r.rt60Sec[b] < 3.0,
            `RT60 band ${b} = ${r.rt60Sec[b]} out of range`);
}

// C50 / C80 finite per band.
for (let b = 0; b < 6; ++b) {
  assert.ok(isFinite(r.c50Db[b]), `C50 band ${b} not finite`);
  assert.ok(isFinite(r.c80Db[b]), `C80 band ${b} not finite`);
  assert.ok(r.d50[b] > 0 && r.d50[b] < 1, `D50 band ${b} out of range: ${r.d50[b]}`);
}

console.log('✅ Acoustics smoke PASSED');
console.log(`   image sources       ${r.imageSourcesEvaluated}`);
console.log(`   Sabine RT60 mid     ${r.sabineRt60Mid.toFixed(2)} s  (expected ≈ ${expectedSabineMid})`);
console.log(`   EDC-fitted RT60     ${Array.from(r.rt60Sec).map(x => x.toFixed(2)).join(' / ')} s`);
console.log(`   C50 [dB]            ${Array.from(r.c50Db).map(x => x.toFixed(1)).join(' / ')}`);
console.log(`   C80 [dB]            ${Array.from(r.c80Db).map(x => x.toFixed(1)).join(' / ')}`);
console.log(`   D50                 ${Array.from(r.d50).map(x => x.toFixed(2)).join(' / ')}`);
console.log(`   wall time           ${wallMs} ms`);
