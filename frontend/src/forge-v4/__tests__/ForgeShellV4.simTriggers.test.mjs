import assert from 'node:assert/strict';
import { detectSimTriggers as _detectSimTriggers } from '../simTriggers.js';

// Forge-165 — pure-function unit tests for the Phase D.3 sim auto-
// trigger detector. No DOM, no React mount.

// ── linear-static cues ─────────────────────────────────────────────
assert.match(_detectSimTriggers('design a load-bearing wall mount'),
             /Linear Static/);
assert.match(_detectSimTriggers('beam must support 5000 N at the tip'),
             /Linear Static/);
assert.match(_detectSimTriggers('what is the max stress under 200 kg?'),
             /Linear Static/);
assert.match(_detectSimTriggers('check the deflection of this bracket'),
             /Linear Static/);

// ── modal cues ────────────────────────────────────────────────────
assert.match(_detectSimTriggers('what is the first natural frequency of this fan?'),
             /Modal/);
assert.match(_detectSimTriggers('check for vibration resonance'),
             /Modal/);

// ── transient/fatigue cues ────────────────────────────────────────
assert.match(_detectSimTriggers('run an impact analysis at 3 m/s'),
             /Transient Dynamic/);
assert.match(_detectSimTriggers('cyclic loading 1e6 cycles, what is the fatigue life?'),
             /Transient Dynamic/);

// ── thermal cues ──────────────────────────────────────────────────
assert.match(_detectSimTriggers('check for hot spots in the heat exchanger'),
             /Thermal/);

// ── no-trigger prompts ────────────────────────────────────────────
assert.equal(_detectSimTriggers('make a 10mm cube'), '');
assert.equal(_detectSimTriggers('fillet all edges 2mm'), '');
assert.equal(_detectSimTriggers(''), '');
assert.equal(_detectSimTriggers(null), '');

// ── multiple triggers fire together ───────────────────────────────
const both = _detectSimTriggers('verify load-bearing and modal response of this gantry');
assert.match(both, /Linear Static/);
assert.match(both, /Modal/);
assert.ok(both.includes(';'), 'multiple hints joined with semicolons');

console.log('[forge-165] all sim-trigger tests passed');
