// Gate — sciviz Inc 0 : colorMaps.js + TransferFunction (ParaView parity).
//
// Run head-less:  node frontend/test/sciviz/colorMaps.test.js
//
// Gates:
//   • Cool-to-Warm endpoints map (0.230,0.299,0.754)→(0.706,0.016,0.150) <1e-3
//   • mid (t=0.5) control point correct (Moreland grey)
//   • N=5 discretise yields exactly 5 unique colours
//   • bake-to-LUT sanity + log/symlog/NaN behaviour
import assert from 'node:assert/strict';
import {
  COLOR_PRESETS, PRESET_NAMES, samplePreset, TransferFunction,
} from '../../src/forge-v4/sciviz/colorMaps.js';

let checks = 0;
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: |${a}-${b}|=${Math.abs(a - b)} > ${tol}`); checks++; };

// ── all 8 canonical presets present ───────────────────────────────────────
const want = ['Cool to Warm', 'Viridis', 'Inferno', 'Plasma', 'Turbo', 'Jet', 'Black-Body', 'Grayscale'];
for (const n of want) assert.ok(COLOR_PRESETS[n], `missing preset ${n}`);
assert.equal(PRESET_NAMES.length, 8, 'expected 8 presets');
checks++;

// ── GATE 1: Cool-to-Warm endpoints (within 1e-3) ──────────────────────────
const c0 = samplePreset('Cool to Warm', 0.0);
const c1 = samplePreset('Cool to Warm', 1.0);
near(c0[0], 0.230, 1e-3, 'CtW t=0 R');
near(c0[1], 0.299, 1e-3, 'CtW t=0 G');
near(c0[2], 0.754, 1e-3, 'CtW t=0 B');
near(c1[0], 0.706, 1e-3, 'CtW t=1 R');
near(c1[1], 0.016, 1e-3, 'CtW t=1 G');
near(c1[2], 0.150, 1e-3, 'CtW t=1 B');
const e0 = Math.max(Math.abs(c0[0] - 0.230), Math.abs(c0[1] - 0.299), Math.abs(c0[2] - 0.754));
const e1 = Math.max(Math.abs(c1[0] - 0.706), Math.abs(c1[1] - 0.016), Math.abs(c1[2] - 0.150));

// ── GATE 2: mid control point correct (exact, since 0.5 is a control point) ─
const cm = samplePreset('Cool to Warm', 0.5);
near(cm[0], 0.865395256, 1e-9, 'CtW mid R');
near(cm[1], 0.865395256, 1e-9, 'CtW mid G');
near(cm[2], 0.865395256, 1e-9, 'CtW mid B');
assert.ok(cm[0] === cm[1] && cm[1] === cm[2], 'CtW midpoint must be neutral grey');
assert.ok(cm[0] > 0.85, 'CtW midpoint must be a light grey');
checks++;

// ── GATE 3: N=5 discretise → exactly 5 unique colours ─────────────────────
const tf = new TransferFunction({ preset: 'Cool to Warm', range: [0, 1], discretize: 5 });
const seen = new Set();
for (let i = 0; i <= 1000; i++) {
  const t = i / 1000;
  const rgb = tf.sampleColorUnit(t);
  seen.add(rgb.map((v) => v.toFixed(6)).join(','));
}
assert.equal(seen.size, 5, `discretize(5) produced ${seen.size} unique colours, expected 5`);
checks++;

// continuous (discretize 0) must yield many distinct colours
const tfc = new TransferFunction({ preset: 'Cool to Warm', discretize: 0 });
const seenC = new Set();
for (let i = 0; i <= 1000; i++) seenC.add(tfc.sampleColorUnit(i / 1000).map((v) => v.toFixed(6)).join(','));
assert.ok(seenC.size > 100, `continuous TF should be smooth (got ${seenC.size})`);
checks++;

// ── range mapping (fixed) ─────────────────────────────────────────────────
const tfr = new TransferFunction({ preset: 'Viridis', range: [10, 20] });
assert.deepEqual(tfr.sampleColor(10), samplePreset('Viridis', 0.0), 'range lo maps to t=0');
assert.deepEqual(tfr.sampleColor(20), samplePreset('Viridis', 1.0), 'range hi maps to t=1');
assert.deepEqual(tfr.sampleColor(15), samplePreset('Viridis', 0.5), 'range mid maps to t=0.5');
// clamp out-of-range
assert.deepEqual(tfr.sampleColor(-5), samplePreset('Viridis', 0.0), 'below-range clamps to lo');
assert.deepEqual(tfr.sampleColor(99), samplePreset('Viridis', 1.0), 'above-range clamps to hi');
checks += 2;

// ── auto range ────────────────────────────────────────────────────────────
const field = new Float32Array([3, 7, 5, 9, 1]);
const tfa = new TransferFunction({ preset: 'Turbo' }).setAutoRange(field);
assert.deepEqual(tfa.range, [1, 9], 'auto range from field min/max');
checks++;

// ── log scale: midpoint of [1,100] in log space is 10 → t=0.5 ─────────────
const tflog = new TransferFunction({ preset: 'Grayscale', range: [1, 100], scale: 'log' });
near(tflog.mapToUnit(10), 0.5, 1e-12, 'log mid (10 in [1,100]) → 0.5');
near(tflog.mapToUnit(1), 0.0, 1e-12, 'log lo → 0');
near(tflog.mapToUnit(100), 1.0, 1e-12, 'log hi → 1');

// ── symlog: 0 maps to the centre of a symmetric range ─────────────────────
const tfsl = new TransferFunction({ preset: 'Grayscale', range: [-100, 100], scale: 'symlog', symlogLinThresh: 1 });
near(tfsl.mapToUnit(0), 0.5, 1e-12, 'symlog 0 → 0.5');
near(tfsl.mapToUnit(-100), 0.0, 1e-12, 'symlog -hi → 0');
near(tfsl.mapToUnit(100), 1.0, 1e-12, 'symlog +hi → 1');

// ── NaN colour ────────────────────────────────────────────────────────────
const tfn = new TransferFunction({ preset: 'Jet', nanColor: [0.1, 0.2, 0.3], nanOpacity: 0.0 });
assert.deepEqual(tfn.sampleColor(NaN), [0.1, 0.2, 0.3], 'NaN → nanColor');
assert.equal(tfn.sampleOpacity(NaN), 0.0, 'NaN → nanOpacity');
assert.deepEqual(tfn.sampleRGBA(NaN), [0.1, 0.2, 0.3, 0.0], 'NaN → nan RGBA');
checks++;

// ── separate opacity map (piecewise linear, independent of colour) ────────
const tfo = new TransferFunction({
  preset: 'Plasma', range: [0, 1],
  opacityPoints: [{ x: 0, a: 0 }, { x: 1, a: 1 }],
});
near(tfo.sampleOpacity(0.0), 0.0, 1e-12, 'opacity at 0');
near(tfo.sampleOpacity(0.5), 0.5, 1e-12, 'opacity at 0.5');
near(tfo.sampleOpacity(1.0), 1.0, 1e-12, 'opacity at 1');
checks++;

// ── bake LUT (Float32Array RGBA) ──────────────────────────────────────────
const baked = new TransferFunction({ preset: 'Cool to Warm' }).bakeLUT(256);
assert.equal(baked.rgba.length, 256 * 4, 'LUT length');
assert.equal(baked.size, 256, 'LUT size');
near(baked.rgba[0], 0.2298057, 1e-6, 'LUT[0] R == CtW endpoint');
near(baked.rgba[(256 - 1) * 4 + 2], 0.150232812, 1e-6, 'LUT[last] B == CtW endpoint');
checks++;

console.log(`[sciviz Inc0 colorMaps] OK — ${checks} checks passed.`);
console.log(`  Cool-to-Warm endpoint errors: t=0 max|Δ|=${e0.toExponential(2)}  t=1 max|Δ|=${e1.toExponential(2)}`);
console.log(`  mid grey = (${cm.map((v) => v.toFixed(6)).join(', ')})`);
console.log(`  discretize(5) unique colours = ${seen.size}`);
