// forge-kernel Circuit smoke (Forge-190).
// Voltage divider + RLC low-pass.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.circuit && typeof forge.circuit.dcAnalysis === 'function',
          'forge.circuit.dcAnalysis missing');

// ---------- Voltage divider ----------
// Vin --R1--+--R2--gnd. V_out at middle node = V_in × R2/(R1+R2).
// Nodes: 0=gnd, 1=Vin, 2=Vout.
{
  const Vin = 12, R1 = 1000, R2 = 2000;
  const r = forge.circuit.dcAnalysis({
    nodeCount: 3,
    comps: [
      // Kind: 0=R, 1=C, 2=L, 3=V, 4=I
      { kind: 3, name: 'V1', nA: 1, nB: 0, value: Vin },
      { kind: 0, name: 'R1', nA: 1, nB: 2, value: R1  },
      { kind: 0, name: 'R2', nA: 2, nB: 0, value: R2  },
    ],
  });
  const expVout = Vin * R2 / (R1 + R2);
  assert.ok(Math.abs(r.nodeVoltages[1] - Vin) < 1e-6);
  assert.ok(Math.abs(r.nodeVoltages[2] - expVout) < 1e-6,
            `divider Vout ${r.nodeVoltages[2]} should be ${expVout}`);
  // Current through V1 = -V_in/(R1+R2) (out of the source flows into +)
  const iExp = Vin / (R1 + R2);
  assert.ok(Math.abs(Math.abs(r.vSourceCurrents[0]) - iExp) < 1e-6,
            `V1 current ${r.vSourceCurrents[0]} should be ±${iExp}`);
}

// ---------- 4-node mesh with current source ----------
// Two parallel resistors driven by an ideal current source.
//   I1 -> nodes (1, 0): 1 A from gnd into n1.
//   R1=100 between n1-gnd, R2=200 between n1-gnd.
// Combined resistance: 100||200 = 66.67 Ω. V1 = 1 × 66.67.
{
  const r = forge.circuit.dcAnalysis({
    nodeCount: 2,
    comps: [
      { kind: 4, name: 'I1', nA: 1, nB: 0, value: 1.0 },
      { kind: 0, name: 'R1', nA: 1, nB: 0, value: 100 },
      { kind: 0, name: 'R2', nA: 1, nB: 0, value: 200 },
    ],
  });
  const exp = 100 * 200 / (100 + 200);
  assert.ok(Math.abs(r.nodeVoltages[1] - exp) < 0.01,
            `parallel V1 ${r.nodeVoltages[1]} should be ${exp}`);
}

// ---------- RC low-pass AC sweep ----------
// Vin -- R --+-- C -- gnd, output at +.
// Transfer function: H(jω) = 1/(1 + jωRC). |H(f_cutoff)| = 1/√2 where
// f_cutoff = 1/(2πRC).
{
  const R = 1000, C = 1e-6;
  const fc = 1.0 / (2 * Math.PI * R * C);
  const freqs = new Float64Array([fc / 10, fc, fc * 10, fc * 100]);
  const r = forge.circuit.acAnalysis({
    nodeCount: 3,
    comps: [
      { kind: 3, name: 'V1', nA: 1, nB: 0, value: 1.0 },
      { kind: 0, name: 'R',  nA: 1, nB: 2, value: R   },
      { kind: 1, name: 'C',  nA: 2, nB: 0, value: C   },
    ],
  }, freqs);
  // |V2|/|V1| should ≈ 1.0, 1/√2, 1/10, 1/100 across the sweep.
  const magOut = r.nodeVoltages.map((nv) => nv.magnitude[2]);
  assert.ok(Math.abs(magOut[0] - 1.0) < 0.05,
            `low-freq gain ${magOut[0]} should ≈ 1`);
  assert.ok(Math.abs(magOut[1] - 1/Math.sqrt(2)) < 0.02,
            `gain at f_c ${magOut[1]} should ≈ ${1/Math.sqrt(2)}`);
  assert.ok(magOut[2] < 0.12 && magOut[2] > 0.08,
            `gain at 10×f_c ${magOut[2]} should ≈ 0.1`);
}

console.log('✅ Circuit smoke PASSED');
console.log(`   voltage divider 12 V × 2 kΩ / 3 kΩ                 → V_out = 8.00 V`);
console.log(`   parallel 100 ∥ 200 with 1 A current source         → V1 = 66.67 V`);
console.log(`   RC low-pass at f_c (R=1k, C=1µF)                    → |H| ≈ 0.707`);
