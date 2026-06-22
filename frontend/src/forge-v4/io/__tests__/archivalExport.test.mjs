/**
 * Node test for the LOTAR / AP242 Long-Term-Archival exporter (Task #40).
 *   node --test frontend/src/forge-v4/io/__tests__/archivalExport.test.mjs
 *
 * Coverage:
 *   1. export → verify VALID — a part + semantic PMI + a 2-part assembly with a
 *      mate. Asserts the AIP carries per-body validation properties (volume /
 *      area / centroid / bbox + a geometry checksum), an assembly structure
 *      hash, a whole-package fixity digest, LOTAR/OAIS conformance markers,
 *      retention, and a retention-aware audit-trail entry (who/when/why/
 *      retentionYears/fixityDigest). verifyArchival → valid:true, 0 mismatches.
 *   2. re-import → re-compute → MATCH — the verify path genuinely re-imports
 *      the AP242 (kernel forge.io.importStep when present, else re-parses the
 *      buildAP242 brep vertex pool) and re-computes the VPs within tolerance.
 *   3. tamper a STORED checksum → DETECTED (kind: 'vp'|'fixity').
 *   4. corrupt the package (a byte/field) without updating the fixity → the
 *      fixity digest fails (kind: 'fixity').
 *   5. perturb the geometry (verify a part's stored VP against a DIFFERENT box)
 *      → per-body volume/bbox mismatch, valid:false.
 *   6. structure-hash sensitivity — change the stored structure hash / mate set
 *      → structureHash mismatch reported.
 *
 * No new npm packages — node:crypto + the inline parse path; kernel optional.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { exportArchival, verifyArchival, __test } from '../archivalExport.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── try to load the prebuilt kernel (optional) ───────────────────────────────
let forge = null;
try {
  forge = require(path.resolve(
    __dirname, '..', '..', '..', '..', '..',
    'forge-kernel', 'build', 'Release', 'forge-kernel.node'));
} catch (e) {
  // kernel not available — tests use the inline buildAP242 fixture path.
}

// ── a closed box mesh (CCW outward, origin min-corner) — matches makeBox ─────
function boxFixture(id, name, dx, dy, dz, material) {
  const vertices = [
    [0, 0, 0], [dx, 0, 0], [dx, dy, 0], [0, dy, 0],
    [0, 0, dz], [dx, 0, dz], [dx, dy, dz], [0, dy, dz],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], // bottom (z=0)
    [4, 5, 6], [4, 6, 7], // top (z=dz)
    [0, 1, 5], [0, 5, 4], // y=0
    [2, 3, 7], [2, 7, 6], // y=dy
    [1, 2, 6], [1, 6, 5], // x=dx
    [0, 4, 7], [0, 7, 3], // x=0
  ];
  return { id, name, material, vertices, faces };
}

// Build the canonical test input: a 2-body assembly with one mate + PMI on b1.
// Kernel present → use real handles (makeBox). Kernel absent → inline fixtures.
function buildInput() {
  const pmi1 = [
    { id: 'a1', kind: 'FLATNESS', value: 0.05, faceId: 0 },
    { id: 'a2', kind: 'POSITION', value: 0.2, zone: 'DIAMETER', materialMod: 'MMC',
      datums: [{ letter: 'A' }, { letter: 'B' }], faceId: 2 },
  ];
  if (forge && typeof forge.makeBox === 'function') {
    const h1 = forge.makeBox(40, 40, 20);
    const h2 = forge.makeBox(20, 20, 10);
    return {
      name: 'archival_assembly',
      parts: [
        { id: 'b1', name: 'BasePlate', material: 'steel', handle: h1, pmi: pmi1 },
        { id: 'b2', name: 'Riser', material: 'aluminum', handle: h2 },
      ],
      mates: [{ type: 'coincident', parent: 'b1', child: 'b2',
                params: { faceA: 0, faceB: 1 } }],
    };
  }
  // Kernel-free fixture path.
  return {
    name: 'archival_assembly',
    bodies: [
      { ...boxFixture('b1', 'BasePlate', 40, 40, 20, 'steel'), pmi: pmi1 },
      boxFixture('b2', 'Riser', 20, 20, 10, 'aluminum'),
    ],
    mates: [{ type: 'coincident', parent: 'b1', child: 'b2',
              params: { faceA: 0, faceB: 1 } }],
  };
}

const baseOpts = {
  forge,
  retention: { years: 50, classification: 'ITAR', disposition: 'review' },
  provenance: { agent: 'satvik', organization: 'ArchDisc', why: 'certification baseline',
                software: 'ArchDisc Forge' },
  projectName: 'LOTAR-Test',
};

// ─────────────────────────────────────────────────────────── 1. export → valid
test('export builds a complete OAIS AIP and verifyArchival is valid', () => {
  const pkg = exportArchival(buildInput(), baseOpts);

  // CONTENT — AP242 STEP string.
  assert.equal(typeof pkg.ap242, 'string');
  assert.match(pkg.ap242, /ISO-10303-21|AP242|STEP/);

  // VALIDATION PROPERTIES — per body.
  assert.equal(pkg.validationProperties.bodies.length, 2);
  for (const b of pkg.validationProperties.bodies) {
    assert.ok(Number.isFinite(b.volume) && b.volume > 0, 'volume present');
    assert.ok(Number.isFinite(b.area) && b.area > 0, 'area present');
    assert.equal(b.centroid.length, 3);
    assert.equal(b.bbox.min.length, 3);
    assert.equal(b.bbox.max.length, 3);
    assert.equal(typeof b.geometryChecksum, 'string');
    assert.ok(b.geometryChecksum.length >= 16);
  }
  // assembly structure hash.
  assert.equal(typeof pkg.validationProperties.structureHash, 'string');

  // CONFORMANCE markers.
  assert.equal(pkg.conformance.lotar, 'EN 9300');
  assert.equal(pkg.conformance.pmiPart, 'EN 9300-210');
  assert.equal(pkg.conformance.oais, 'ISO 14721');
  assert.equal(pkg.conformance.ap242, 'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING');
  assert.equal(pkg.conformance.qif, 'validation-properties');

  // OAIS metadata — content / representation / provenance / context / fixity.
  assert.equal(pkg.oaisMetadata.content.bodyCount, 2);
  assert.equal(pkg.oaisMetadata.content.mateCount, 1);
  assert.ok(pkg.oaisMetadata.representation.schema);
  assert.equal(pkg.oaisMetadata.provenance.agent, 'satvik');
  assert.ok(pkg.oaisMetadata.provenance.createdAt);
  assert.ok(pkg.oaisMetadata.context.project);
  assert.ok(pkg.oaisMetadata.fixity.packageDigest);

  // RETENTION (retention-aware).
  assert.equal(pkg.retention.years, 50);
  assert.equal(pkg.retention.classification, 'ITAR');
  assert.ok(pkg.retention.expiresAt);

  // AUDIT TRAIL — who / when / why / retentionYears / fixityDigest.
  assert.equal(pkg.auditTrail.length, 1);
  const ev = pkg.auditTrail[0];
  assert.equal(ev.event, 'export');
  assert.equal(ev.who, 'satvik');
  assert.ok(ev.when);
  assert.equal(ev.why, 'certification baseline');
  assert.equal(ev.retentionYears, 50);
  assert.equal(ev.fixityDigest, pkg.fixity.packageDigest);

  // FIXITY — whole-package digest, mirrored into oaisMetadata.
  assert.ok(pkg.fixity.packageDigest);
  assert.equal(pkg.fixity.packageDigest, pkg.oaisMetadata.fixity.packageDigest);

  // VERIFY — valid, no mismatches.
  const res = verifyArchival(pkg, { forge });
  assert.equal(res.valid, true, 'archive should verify valid: ' + JSON.stringify(res.mismatches));
  assert.equal(res.mismatches.length, 0);
  assert.equal(res.checks.fixity, true);
  assert.equal(res.checks.structureHash, true);
  assert.equal(res.checks.perBody.length, 2);
});

// ──────────────────────────────────────────── 2. re-import → re-compute → match
test('verify re-imports the AP242 and re-computes the validation properties within tol', () => {
  const pkg = exportArchival(buildInput(), baseOpts);
  const res = verifyArchival(pkg, { forge });
  assert.equal(res.valid, true, JSON.stringify(res.mismatches));
  // every per-body property comparison passed within tolerance.
  for (const row of res.checks.perBody) {
    assert.equal(row.ok, true, 'body ' + row.bodyId + ' ' + JSON.stringify(row.properties));
    for (const [prop, cmp] of Object.entries(row.properties)) {
      assert.equal(cmp.ok, true, `${row.bodyId}.${prop} delta=${cmp.delta}`);
    }
  }
  assert.equal(res.checks.structureHash, true);
});

// ───────────────────────────────────────────── 3. tamper a stored checksum
test('a tampered stored validation checksum is detected', () => {
  const pkg = exportArchival(buildInput(), baseOpts);
  // mutate a stored per-body geometry checksum (a corrupted fixity record).
  pkg.validationProperties.bodies[0].geometryChecksum = 'deadbeef'.repeat(8);
  const res = verifyArchival(pkg, { forge });
  assert.equal(res.valid, false);
  // fixity catches it (the checksum lives inside the fixity-covered VP block);
  // the per-body self-checksum mismatch is also reported.
  const kinds = res.mismatches.map((m) => m.kind);
  assert.ok(kinds.includes('fixity') || kinds.includes('vp'),
    'expected a fixity or vp mismatch: ' + JSON.stringify(res.mismatches));
});

test('a tampered stored volume (checksum left stale) is detected as a vp mismatch', () => {
  const pkg = exportArchival(buildInput(), baseOpts);
  // change the stored volume but leave the geometryChecksum → self-checksum fails.
  pkg.validationProperties.bodies[0].volume *= 1.5;
  const res = verifyArchival(pkg, { forge });
  assert.equal(res.valid, false);
  const vp = res.mismatches.find((m) => m.kind === 'vp' && m.property === 'geometryChecksum');
  assert.ok(vp, 'expected a vp/geometryChecksum mismatch: ' + JSON.stringify(res.mismatches));
});

// ───────────────────────────────────────────── 4. corrupt the package → fixity
test('corrupting the AP242 content without updating the fixity digest fails fixity', () => {
  const pkg = exportArchival(buildInput(), baseOpts);
  pkg.ap242 = pkg.ap242.replace('ISO-10303-21', 'ISO-10303-99'); // flip the content
  const res = verifyArchival(pkg, { forge });
  assert.equal(res.valid, false);
  assert.ok(res.mismatches.some((m) => m.kind === 'fixity'),
    'expected a fixity mismatch: ' + JSON.stringify(res.mismatches));
  assert.equal(res.checks.fixity, false);
});

test('corrupting the retention years without re-fixity fails fixity', () => {
  const pkg = exportArchival(buildInput(), baseOpts);
  pkg.retention.years = 7;
  const res = verifyArchival(pkg, { forge });
  assert.equal(res.valid, false);
  assert.ok(res.mismatches.some((m) => m.kind === 'fixity'));
});

// ───────────────────────────────────────────── 5. perturb geometry → drift
test('verifying against a perturbed geometry recipe detects the drift', () => {
  const pkg = exportArchival(buildInput(), baseOpts);
  // Capture VPs from a DIFFERENT box (scaled) and overwrite body 0's stored VP +
  // re-checksum so the per-body self-check passes — but the re-imported geometry
  // no longer matches → a per-body volume/bbox mismatch must be reported. We
  // also re-fixity so the test isolates the GEOMETRY-drift detector (not fixity).
  const driftBody = __test.computeBodyVP(
    __test.normalizeProduct({ bodies: [boxFixtureScaled()] }).parts[0],
    forge && forge.makeBox ? forge : null);
  // overwrite stored VP for b1 with the drifted box's numbers + its own checksum.
  const stored = pkg.validationProperties.bodies[0];
  stored.volume = driftBody.volume;
  stored.area = driftBody.area;
  stored.centroid = driftBody.centroid;
  stored.bbox = driftBody.bbox;
  stored.geometryChecksum = __test.geometryChecksum(stored);
  // re-fixity the package so fixity passes and we isolate geometry drift.
  refixity(pkg);

  const res = verifyArchival(pkg, { forge });
  assert.equal(res.valid, false);
  const geo = res.mismatches.find((m) => m.kind === 'geometry' && m.bodyId === 'b1');
  assert.ok(geo, 'expected a per-body geometry drift mismatch: ' + JSON.stringify(res.mismatches));
});

function boxFixtureScaled() {
  // a clearly different box than b1 (40×40×20).
  return boxFixture('b1', 'BasePlate', 80, 40, 20, 'steel');
}

// ───────────────────────────────────────────── 6. structure-hash sensitivity
test('a changed structure hash (mate set) is detected', () => {
  const pkg = exportArchival(buildInput(), baseOpts);
  // Tamper the stored structureHash (e.g. an attacker edits the product tree
  // claim). reStructureHash recomputes from the stored part identities + mates,
  // which no longer matches the tampered hash → a structure mismatch.
  pkg.validationProperties.structureHash = 'f'.repeat(64);
  const res = verifyArchival(pkg, { forge });
  assert.equal(res.valid, false);
  assert.ok(res.mismatches.some((m) => m.kind === 'structure'),
    'expected a structure mismatch: ' + JSON.stringify(res.mismatches));
});

test('adding a mate changes the structure hash (different assembly ≠ stored)', () => {
  const a = exportArchival(buildInput(), baseOpts);
  // Build a SECOND assembly with an extra mate → different structure hash.
  const input2 = buildInput();
  input2.mates = [...input2.mates,
    { type: 'distance', parent: 'b1', child: 'b2', params: { distance: 10 } }];
  const b = exportArchival(input2, baseOpts);
  assert.notEqual(a.validationProperties.structureHash, b.validationProperties.structureHash,
    'adding a mate must change the structure hash');
  // and each one self-verifies.
  assert.equal(verifyArchival(a, { forge }).valid, true);
  assert.equal(verifyArchival(b, { forge }).valid, true);
});

// recompute the whole-package fixity digest after a legitimate VP edit (test
// helper mirroring the exporter's fixity input, so tests can isolate detectors).
function refixity(pkg) {
  const fixityInput = {
    ap242: pkg.ap242,
    validationProperties: pkg.validationProperties,
    oaisMetadataNoFixity: { ...pkg.oaisMetadata, fixity: undefined },
    retention: pkg.retention,
    conformance: pkg.conformance,
  };
  const d = __test.digest(__test.canonicalize(fixityInput));
  pkg.fixity.packageDigest = d;
  pkg.oaisMetadata.fixity.packageDigest = d;
}

// ── 7. fixity digest is a REAL, environment-independent SHA-256 ──────────────
test('fixity SHA-256: known vectors + inline === node:crypto', () => {
  const sha = (s) => require('node:crypto').createHash('sha256').update(s, 'utf8').digest('hex');
  // NIST known-answer vectors.
  assert.equal(__test._sha256HexInline(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(__test._sha256HexInline('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(__test._sha256HexInline(
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  // Inline path must equal node:crypto over varied inputs incl. multibyte UTF-8
  // and 55/56/63/64/65/119/120-byte padding boundaries (cross-runtime invariant).
  const samples = ['', 'a', 'A'.repeat(55), 'B'.repeat(56), 'C'.repeat(63),
    'D'.repeat(64), 'E'.repeat(65), 'F'.repeat(119), 'G'.repeat(120),
    'cafe resume pi 3.14159 数学 🛠️',
    JSON.stringify({ z: 1, a: [1, 2, 3], m: 'x' }),
    'euro € sum ∑ int ∫ ascii 12345'];
  for (const s of samples) {
    assert.equal(__test._sha256HexInline(s), sha(s), `inline!=crypto for ${JSON.stringify(s)}`);
    assert.equal(__test.digest(s), __test._sha256HexInline(s), `digest!=inline for ${JSON.stringify(s)}`);
  }
});
