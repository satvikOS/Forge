/**
 * Task #19 — AUTO-MBD + Autonomous PLM pre-release pipeline.
 *   node --test frontend/src/forge-v4/plm/__tests__/prerelease.test.mjs
 *
 * These tests prove the orchestrator drives the REAL shipped engines (the
 * reports cite engine-derived numbers — frame validation summaries, kernel
 * validity reports, native tolerance Cpk, archival fixity digests — not canned
 * booleans) and enforces ASME Y14.41-2019 / ISO 16792 model-based-definition
 * completeness + an ECO/ECN-style release gate.
 *
 * COVERAGE (the test matrix the brief asks for):
 *   1. A COMPLETE, well-defined part   → mbdCompleteness.complete === true.
 *   2. An INCOMPLETE part (missing a tolerance / dangling datum / malformed FCF /
 *      no material) → complete === false WITH the specific missing reason.
 *   3. prePlmRelease on a complete assembly → releasable === true, all gates pass,
 *      and the archival gate cites a REAL fixity digest + the tolerance gate cites
 *      a REAL native Cpk.
 *   4. prePlmRelease on an INCOMPLETE part → releasable === false with the specific
 *      mbd-complete blocker.
 *   5. An unresolved DUPLICATE in the vault → the no-unresolved-duplicates gate
 *      fails (REAL findDuplicates confirmed pair).
 *   6. An RSS-INVALID stack (zero-tolerance link) → the tolerance gate warns/fails
 *      and surfaces the rssValid:false reason.
 *
 * Kernel-optional: if forge-kernel.node is present, parts use real handles
 * (makeBox) so geometry-valid / drawing / tolerance / massProps run against the
 * native kernel; otherwise the kernel-free fixture path (vertices/faces +
 * volume/area) keeps every gate runnable. No new npm packages.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { mbdCompleteness, prePlmRelease } from '../prerelease.js';
import {
  setAnnotations, clearAnnotations, addAnnotation,
} from '../../pmiAnnotations.js';
import {
  captureRationale, _resetForTests as resetRationale,
} from '../../rationale/designRationale.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── try to load the prebuilt kernel (optional) ───────────────────────────────
let forge = null;
try {
  forge = require(path.resolve(
    __dirname, '..', '..', '..', '..', '..',
    'forge-kernel', 'build', 'Release', 'forge-kernel.node'));
} catch {
  // kernel not available — tests use the kernel-free fixture path.
}
const HAVE_KERNEL = !!(forge && typeof forge.makeBox === 'function');

// ── a closed box mesh (CCW outward, origin min-corner) — matches archival test ─
function boxFixture(dx, dy, dz) {
  const vertices = [
    [0, 0, 0], [dx, 0, 0], [dx, dy, 0], [0, dy, 0],
    [0, 0, dz], [dx, 0, dz], [dx, dy, dz], [0, dy, dz],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6],
    [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3],
  ];
  // signed-volume of an axis-aligned box at origin = dx*dy*dz; area = 2(xy+yz+zx).
  return { vertices, faces, volume: dx * dy * dz, area: 2 * (dx * dy + dy * dz + dz * dx) };
}

// Build a part body for the given dims — real handle if the kernel is present,
// else the fixture mesh. `shape` is the handle (or null in fixture mode).
function makeBody(dx, dy, dz) {
  if (HAVE_KERNEL) return { shape: forge.makeBox(dx, dy, dz) };
  const f = boxFixture(dx, dy, dz);
  return { shape: null, vertices: f.vertices, faces: f.faces, volume: f.volume, area: f.area };
}

// A well-formed Y14.5 GD&T PMI annotation (position with a 2-datum DRF + Ø).
function gdtPosition(bodyId, datums = ['A', 'B']) {
  return {
    kind: 'gdt', bodyId,
    payload: {
      characteristic: 'position', tolerance: 0.2, zoneShape: 'diameter',
      materialMod: 'MMC', datums: datums.map((ref) => ({ ref, mod: 'RFS' })),
    },
  };
}
function gdtFlatness(bodyId) {
  return {
    kind: 'gdt', bodyId,
    payload: { characteristic: 'flatness', tolerance: 0.05, zoneShape: 'none', materialMod: 'none', datums: [] },
  };
}
function finishAnn(bodyId) {
  return { kind: 'finish', bodyId, payload: { variant: 'Ra', param: 'roughness', value: 1.6, lay: 'X' } };
}

// Fully-defined part spec (everything an MBD data set needs).
function completePartSpec(bodyId, body) {
  return {
    ...body, bodyId, id: bodyId, name: bodyId,
    material: 'steel', units: 'mm', precision: 2,
    surfaceFinish: { Ra: 1.6 },
    datums: ['A', 'B'],
    criticalFeatures: [{ id: 'bore-1', kind: 'hole', covered: true }],
  };
}

function seedCompletePmi(bodyId) {
  clearAnnotations();
  setAnnotations([gdtPosition(bodyId), gdtFlatness(bodyId), finishAnn(bodyId)]);
}

// ───────────────────────────────────────────────────── 1. COMPLETE part passes
test('mbdCompleteness PASSES a fully-defined Y14.41 part (real validateFrames over real PMI)', () => {
  resetRationale();
  const bodyId = 'P-complete';
  seedCompletePmi(bodyId);
  const body = makeBody(40, 30, 20);
  const part = completePartSpec(bodyId, body);

  const res = mbdCompleteness(part, { forge });
  assert.equal(res.complete, true,
    'expected a complete MBD; missing=' + JSON.stringify(res.missing));
  assert.equal(res.missing.length, 0);
  // REAL engine evidence: the FCFs were run through validateFrames.
  assert.equal(res.pmiFrameCount, 2, 'two GD&T frames validated');
  assert.ok(res.validatedFrames && res.validatedFrames.framesTotal === 2,
    'cites the real validateFrames summary: ' + JSON.stringify(res.validatedFrames));
  assert.deepEqual(res.datumSet.sort(), ['A', 'B']);
});

// ───────────────────────────────────────────────────── 2. INCOMPLETE variations
test('mbdCompleteness FAILS a part missing material with the specific reason', () => {
  const bodyId = 'P-nomat';
  seedCompletePmi(bodyId);
  const body = makeBody(40, 30, 20);
  const part = { ...completePartSpec(bodyId, body), material: undefined };
  const res = mbdCompleteness(part, { forge });
  assert.equal(res.complete, false);
  assert.ok(res.missing.some((m) => m.kind === 'missing-material'),
    'expected a missing-material reason: ' + JSON.stringify(res.missing));
});

test('mbdCompleteness FAILS a DANGLING datum reference (FCF cites a datum not on the part)', () => {
  const bodyId = 'P-dangle';
  clearAnnotations();
  // FCF references datum 'C', but the part declares only A & B.
  setAnnotations([gdtPosition(bodyId, ['A', 'B', 'C']), finishAnn(bodyId)]);
  const body = makeBody(40, 30, 20);
  const part = { ...completePartSpec(bodyId, body), datums: ['A', 'B'] };
  const res = mbdCompleteness(part, { forge });
  assert.equal(res.complete, false);
  const dangle = res.missing.find((m) => m.kind === 'dangling-datum');
  assert.ok(dangle, 'expected a dangling-datum reason: ' + JSON.stringify(res.missing));
  assert.match(dangle.reason, /C/, 'dangling reason names the undefined datum letter');
});

test('mbdCompleteness FAILS a MALFORMED FCF (Position with NO datums) — cites the Y14.5 rule', () => {
  const bodyId = 'P-badfcf';
  clearAnnotations();
  // Position requires a datum reference frame; give it none → R-006/R-007 error.
  setAnnotations([
    { kind: 'gdt', bodyId, payload: { characteristic: 'position', tolerance: 0.2, zoneShape: 'diameter', materialMod: 'none', datums: [] } },
    finishAnn(bodyId),
  ]);
  const body = makeBody(40, 30, 20);
  const part = completePartSpec(bodyId, body);
  const res = mbdCompleteness(part, { forge });
  assert.equal(res.complete, false);
  // The malformed-fcf reason carries the REAL Y14.5 rule id (R-006/R-007).
  const bad = res.missing.find((m) => m.kind === 'malformed-fcf');
  const noDatum = res.missing.find((m) => m.kind === 'missing-datum-ref');
  assert.ok(bad || noDatum, 'expected malformed-fcf or missing-datum-ref: ' + JSON.stringify(res.missing));
  if (bad) {
    assert.ok(bad.detail.some((d) => /R-00[67]/.test(d)),
      'malformed-fcf detail cites the real Y14.5 rule id: ' + JSON.stringify(bad.detail));
  }
});

test('mbdCompleteness FAILS a part with NO PMI at all (no FCF, no finish)', () => {
  const bodyId = 'P-bare';
  clearAnnotations();
  setAnnotations([]); // body carries zero PMI
  const body = makeBody(40, 30, 20);
  // declare a critical bore that nothing tolerances → untoleranced-critical.
  const part = { ...completePartSpec(bodyId, body), surfaceFinish: undefined,
    criticalFeatures: [{ id: 'bore-1', kind: 'hole' }] };
  const res = mbdCompleteness(part, { forge });
  assert.equal(res.complete, false);
  assert.ok(res.missing.some((m) => m.kind === 'missing-finish'),
    'no finish → missing-finish: ' + JSON.stringify(res.missing));
  assert.ok(res.missing.some((m) => m.kind === 'untoleranced-critical'),
    'critical bore with no FCF → untoleranced-critical: ' + JSON.stringify(res.missing));
});

// ───────────────────────────────────────────────────── 3. RELEASE — full pass
test('prePlmRelease RELEASES a complete assembly — every blocking gate passes, real engine evidence', () => {
  resetRationale();
  const bodyId = 'R-ok';
  seedCompletePmi(bodyId);
  const body = makeBody(40, 30, 20);
  const part = {
    ...completePartSpec(bodyId, body),
    // a VALID RSS stack (2 independent ±-toleranced links).
    tolChain: [
      { name: 'a', nominal: 10, plus: 0.1, minus: 0.1, dist: 0 },
      { name: 'b', nominal: 5, plus: 0.05, minus: 0.05, dist: 0 },
    ],
    tolSpec: { USL: 15.6, LSL: 14.4 },
  };
  // capture a "why" so the rationale gate passes.
  captureRationale(bodyId, '__part__', { intent: 'load-bearing base plate', drivingRequirement: 'R-12' });

  const res = prePlmRelease({ name: 'rel-ok', parts: [part] }, {
    forge, minCpk: 1.0,
    retention: { years: 50, classification: 'ITAR' },
    provenance: { agent: 'satvik', organization: 'ArchDisc', why: 'release gate' },
  });

  assert.equal(res.releasable, true,
    'expected releasable; blockers=' + JSON.stringify(res.blockers));
  // every blocking gate passes.
  for (const g of res.gates) {
    if (g.blocking) assert.equal(g.pass, true, `gate ${g.name} should pass: ${JSON.stringify(g.detail)}`);
  }
  // REAL engine evidence — archival gate cites a real fixity digest.
  const archGate = res.gates.find((g) => g.name === 'archival-built-and-verified');
  assert.ok(archGate.detail.fixity && /^[0-9a-f]{64}$/.test(archGate.detail.fixity),
    'archival gate cites a real SHA-256 fixity digest: ' + JSON.stringify(archGate.detail.fixity));
  assert.equal(archGate.detail.valid, true);
  // REAL engine evidence — tolerance gate cites a finite native Cpk + rssValid.
  const tolGate = res.gates.find((g) => g.name === 'tolerance-rss-valid');
  const chain0 = tolGate.detail.perChain[0];
  assert.ok(Number.isFinite(chain0.Cpk) && chain0.Cpk > 1.0,
    'tolerance gate cites a real native Cpk: ' + JSON.stringify(chain0));
  assert.equal(chain0.rssValid, true);
  // REAL engine evidence — mbd gate cites the per-part frame validation.
  const mbdGate = res.gates.find((g) => g.name === 'mbd-complete');
  assert.equal(mbdGate.detail.perPart[0].complete, true);
  assert.equal(mbdGate.detail.perPart[0].pmiFrameCount, 2);
});

// ───────────────────────────────────────────────────── 4. RELEASE — mbd blocker
test('prePlmRelease HOLDS a release when a part is MBD-incomplete (missing tolerance), citing the blocker', () => {
  resetRationale();
  const bodyId = 'R-incomplete';
  clearAnnotations();
  // No FCF on a declared-critical bore → untoleranced-critical; also no finish.
  setAnnotations([]);
  const body = makeBody(40, 30, 20);
  const part = {
    ...completePartSpec(bodyId, body),
    surfaceFinish: undefined,
    criticalFeatures: [{ id: 'bore-1', kind: 'hole' }],
  };
  captureRationale(bodyId, '__part__', { intent: 'bracket' });

  const res = prePlmRelease({ name: 'rel-bad', parts: [part] }, { forge });
  assert.equal(res.releasable, false);
  const mbdBlocker = res.blockers.find((b) => b.gate === 'mbd-complete');
  assert.ok(mbdBlocker, 'expected an mbd-complete blocker: ' + JSON.stringify(res.blockers));
  assert.match(mbdBlocker.reason, /untoleranced-critical|missing-finish/,
    'blocker reason cites the specific MBD gap: ' + mbdBlocker.reason);
});

// ───────────────────────────────────────────────────── 5. RELEASE — duplicate
test('prePlmRelease HOLDS a release when the vault has an unresolved DUPLICATE (real findDuplicates)', () => {
  resetRationale();
  const idA = 'D-a'; const idB = 'D-b';
  clearAnnotations();
  // Both parts fully defined so ONLY the duplicate gate fails (isolates it).
  setAnnotations([
    gdtPosition(idA), finishAnn(idA),
    gdtPosition(idB), finishAnn(idB),
  ]);
  // two IDENTICAL boxes → a confirmed duplicate pair.
  const bodyA = makeBody(40, 30, 20);
  const bodyB = makeBody(40, 30, 20);
  const partA = completePartSpec(idA, bodyA);
  const partB = completePartSpec(idB, bodyB);
  captureRationale(idA, '__part__', { intent: 'plate' });
  captureRationale(idB, '__part__', { intent: 'plate' });

  const res = prePlmRelease({ name: 'rel-dup', parts: [partA, partB] }, { forge });
  const dupGate = res.gates.find((g) => g.name === 'no-unresolved-duplicates');
  assert.equal(dupGate.pass, false,
    'identical parts must produce a confirmed duplicate: ' + JSON.stringify(dupGate.detail));
  assert.ok(dupGate.detail.confirmedCount >= 1,
    'real findDuplicates confirmed ≥1 pair: ' + JSON.stringify(dupGate.detail));
  assert.equal(res.releasable, false);
  assert.ok(res.blockers.some((b) => b.gate === 'no-unresolved-duplicates'));
});

// ───────────────────────────────────────────────────── 6. RELEASE — RSS-invalid
test('prePlmRelease tolerance gate WARNS/FAILS on an RSS-invalid stack (zero-tolerance link)', () => {
  resetRationale();
  const bodyId = 'R-rss';
  seedCompletePmi(bodyId);
  const body = makeBody(40, 30, 20);
  const part = {
    ...completePartSpec(bodyId, body),
    // a zero-tolerance link makes RSS invalid (deterministic link breaks the
    // all-normal premise; rssSigma collapses).
    tolChain: [
      { name: 'a', nominal: 10, plus: 0.1, minus: 0.1, dist: 0 },
      { name: 'b', nominal: 5, plus: 0, minus: 0, dist: 0 },
    ],
    tolSpec: { USL: 15.3, LSL: 14.7 },
  };
  captureRationale(bodyId, '__part__', { intent: 'shaft' });

  const res = prePlmRelease({ name: 'rel-rss', parts: [part] }, { forge });
  const tolGate = res.gates.find((g) => g.name === 'tolerance-rss-valid');
  const chain0 = tolGate.detail.perChain[0];
  assert.equal(chain0.rssValid, false,
    'zero-tol link must flag rssValid:false: ' + JSON.stringify(chain0));
  assert.ok(chain0.rssWarnings.some((w) => /zero ± tolerance/.test(w)),
    'surfaces the zero-tolerance RSS warning: ' + JSON.stringify(chain0.rssWarnings));
  assert.equal(tolGate.pass, false);
  assert.equal(res.releasable, false);
  assert.ok(res.blockers.some((b) => b.gate === 'tolerance-rss-valid'));
});

// ───────────────────────────────────────────────────── 6b. kernel-optional stack
test('tolerance gate is KERNEL-OPTIONAL — runs the pure-JS stack engine with forge:null', () => {
  resetRationale();
  const bodyId = 'R-purejs';
  // fixture geometry so the whole release runs with NO kernel.
  const fb = boxFixture(40, 30, 20);
  clearAnnotations();
  setAnnotations([gdtPosition(bodyId), finishAnn(bodyId)]);
  const part = {
    ...fb, shape: null, bodyId, id: bodyId, material: 'steel', units: 'mm', precision: 2,
    surfaceFinish: { Ra: 1.6 }, datums: ['A', 'B'],
    criticalFeatures: [{ id: 'bore-1', covered: true }],
    tolChain: [
      { name: 'a', nominal: 10, plus: 0.1, minus: 0.1 },
      { name: 'b', nominal: 5, plus: 0.05, minus: 0.05 },
    ],
    tolSpec: { USL: 15.6, LSL: 14.4 },
  };
  captureRationale(bodyId, '__part__', { intent: 'plate' });

  const res = prePlmRelease({ name: 'rel-purejs', parts: [part] }, { forge: null, minCpk: 1.0 });
  const tolGate = res.gates.find((g) => g.name === 'tolerance-rss-valid');
  // The REAL pure-JS engine ran (not a "kernel not loaded" stub).
  assert.match(tolGate.detail.engine, /ToleranceStack\.js/,
    'forge:null must fall back to the pure-JS stack engine: ' + tolGate.detail.engine);
  const c = tolGate.detail.perChain[0];
  assert.ok(Number.isFinite(c.Cpk) && c.rssSigma > 0 && c.rssValid,
    'pure-JS stack produces a real finite Cpk: ' + JSON.stringify(c));
  assert.equal(tolGate.pass, true);
  assert.equal(res.releasable, true,
    'a complete part with fixture geometry must release with NO kernel: ' + JSON.stringify(res.blockers));
});

// ───────────────────────────────────────────────────── 7. real native validity
test('prePlmRelease geometry-valid gate runs the REAL kernel validity check when a handle is present', () => {
  resetRationale();
  const bodyId = 'R-geo';
  seedCompletePmi(bodyId);
  const body = makeBody(40, 30, 20);
  const part = completePartSpec(bodyId, body);
  captureRationale(bodyId, '__part__', { intent: 'plate' });

  const res = prePlmRelease({ name: 'rel-geo', parts: [part] }, { forge });
  const geo = res.gates.find((g) => g.name === 'geometry-valid');
  assert.equal(geo.pass, true);
  if (HAVE_KERNEL) {
    // the per-part row carries the REAL OCCT BRepCheck report (not a canned bool).
    assert.equal(geo.detail.perPart[0].checked, true);
    assert.ok(geo.detail.perPart[0].report && typeof geo.detail.perPart[0].report.isClosed === 'boolean',
      'cites the real OCCT validity report: ' + JSON.stringify(geo.detail.perPart[0]));
  }
});
