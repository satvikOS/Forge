/**
 * Node test for geometry-based part retrieval (Task #33).
 *   node --test frontend/src/forge-v4/pdm/__tests__/partRetrieval.test.mjs
 *
 * Uses the prebuilt forge-kernel.node (REAL kernel bodies, headless) to build a
 * synthetic vault: distinct primitives + an L-bracket, plus a rotated+translated
 * COPY of one part and a NEAR-DUPLICATE (one dimension +5 %). Then asserts:
 *   1. pose-invariance is REAL — the rotated/translated copy's fingerprint
 *      distance to the original is < 1e-2 (not a transform-sensitive hash),
 *   2. findSimilar(copy,1) returns the original as the #1 match, score ≥ 0.99,
 *   3. findDuplicates flags the near-duplicate paired with its original and the
 *      tighter geometric confirm (shape_similarity ≥ 0.97) passes,
 *   4. unrelated primitives score < 0.6 and are NOT flagged as duplicates,
 *   5. retrieveThenEdit returns match===original and a cad.edit-step hand-off,
 *   6. determinism — a second fingerprint of the same body is bit-identical.
 *
 * If the kernel is unavailable the test self-skips (clearly reported); no new
 * npm packages.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  computeFingerprint, descriptorDistance, similarityScore,
  indexVault, findSimilar, findDuplicates, retrieveThenEdit,
  DEFAULT_DUP_DISTANCE, CONFIRM_SHAPE_SIMILARITY, __test,
} from '../partRetrieval.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let forge = null;
try {
  forge = require(path.resolve(
    __dirname, '..', '..', '..', '..', '..',
    'forge-kernel', 'build', 'Release', 'forge-kernel.node'));
} catch (e) {
  console.error('[partRetrieval.test] kernel unavailable — skipping:', e.message);
}

const SEED = 0xF0E33; // shared fingerprint seed → determinism across the vault

// Build a vault entry: tessellate via the kernel ONCE and cache the descriptor
// so the kd-tree + searches operate on stable, real geometry.
function vaultPart(partNumber, name, handle) {
  return { partNumber, name, handle,
    descriptor: computeFingerprint({ handle }, forge, { seed: SEED }) };
}

test('geometry-based part retrieval over a synthetic kernel vault', { skip: !forge }, async (t) => {
  // ── distinct parts (clearly different proportions) ──────────────────────────
  const hBox      = forge.makeBox(40, 20, 60);            // rectangular block
  const hCyl      = forge.makeCylinder(12, 80);           // slender cylinder
  const hSphere   = forge.makeSphere(25);                 // sphere
  const hCone     = forge.makeCone(20, 4, 70);            // tapered cone
  const hTorus    = forge.makeTorus(30, 8);               // ring
  const hFlatBox  = forge.makeBox(80, 80, 6);             // flat plate
  // fused L-bracket from two boxes
  let hBracket = forge.fuse(
    forge.makeBox(60, 12, 40),
    forge.translate(forge.makeBox(12, 48, 40), 0, 12, 0));
  const hWideCyl  = forge.makeCylinder(40, 20);           // squat disc

  const parts = [
    vaultPart('P-001', 'rect block 40x20x60', hBox),
    vaultPart('P-002', 'cylinder r12 h80', hCyl),
    vaultPart('P-003', 'sphere r25', hSphere),
    vaultPart('P-004', 'cone r20-r4 h70', hCone),
    vaultPart('P-005', 'torus R30 r8', hTorus),
    vaultPart('P-006', 'flat plate 80x80x6', hFlatBox),
    vaultPart('P-007', 'L-bracket', hBracket),
    vaultPart('P-008', 'squat disc r40 h20', hWideCyl),
  ];

  const index = indexVault(parts, forge, { seed: SEED });
  assert.equal(index.entries.length, 8);

  // ── 1. REAL pose-invariance: rotated + translated copy of P-002 ─────────────
  let hCopy = forge.rotate(hCyl, 1, 1, 0, 0.9);
  hCopy = forge.translate(hCopy, 50, 30, -20);
  const copyDesc = computeFingerprint({ handle: hCopy }, forge, { seed: SEED });
  const origDesc = parts[1].descriptor;
  const poseDist = descriptorDistance(copyDesc, origDesc);
  await t.test('pose-invariant fingerprint (copy ≈ original)', () => {
    assert.ok(poseDist < 1e-2,
      `rotated+translated copy must fingerprint within 1e-2 of original; got ${poseDist}`);
  });

  // ── 2. findSimilar: the copy retrieves P-002 as #1, score ~1.0 ──────────────
  await t.test('findSimilar returns the original copy as #1 with score≥0.99', () => {
    const top = findSimilar(copyDesc, 1, index, forge);
    assert.equal(top.length, 1);
    assert.equal(top[0].part.partNumber, 'P-002');
    assert.ok(top[0].score >= 0.99, `score should be ≥0.99 for a pose copy; got ${top[0].score}`);
  });

  // ── 3. near-duplicate: cylinder radius +5 % (12 → 12.6) ─────────────────────
  const hNearDup = forge.makeCylinder(12.6, 80);
  const nearVault = [...parts, vaultPart('P-002B', 'cylinder r12.6 h80 (near-dup)', hNearDup)];
  const nearIndex = indexVault(nearVault, forge, { seed: SEED });

  await t.test('findDuplicates flags the +5% near-duplicate and confirms it', () => {
    const dups = findDuplicates(nearIndex, { forge });
    const pair = dups.find((d) =>
      (d.a.partNumber === 'P-002' && d.b.partNumber === 'P-002B') ||
      (d.a.partNumber === 'P-002B' && d.b.partNumber === 'P-002'));
    assert.ok(pair, 'P-002 / P-002B must be flagged as a near-duplicate pair');
    assert.ok(pair.distance < DEFAULT_DUP_DISTANCE,
      `near-dup distance ${pair.distance} must be under ${DEFAULT_DUP_DISTANCE}`);
    assert.ok(pair.confirmed, 'the tighter geometric confirm must pass for the near-dup');
    assert.ok(pair.shapeSimilarity >= CONFIRM_SHAPE_SIMILARITY,
      `shape_similarity confirm should be ≥${CONFIRM_SHAPE_SIMILARITY}; got ${pair.shapeSimilarity}`);
  });

  // ── 3b. the confirm rejects a DISTINCT pair (defence in depth) ──────────────
  await t.test('geometric confirm separates a transform copy from a distinct part', () => {
    // exact/transform copy → ~1.0; a distinct part (cylinder vs box) → well below gate.
    const simCopy = __test.shapeSimilarityConfirm({ handle: hCyl }, { handle: hCopy }, forge);
    const simDistinct = __test.shapeSimilarityConfirm({ handle: hCyl }, { handle: hBox }, forge);
    assert.ok(simCopy >= 0.99, `transform copy confirm should be ~1.0; got ${simCopy}`);
    assert.ok(simDistinct < CONFIRM_SHAPE_SIMILARITY,
      `distinct pair must fall below the confirm gate; got ${simDistinct}`);
  });

  // ── 4. distinct parts score low + are NOT duplicates ────────────────────────
  await t.test('unrelated parts score <0.6 and are not flagged as duplicates', () => {
    // every cross-pair of the 8 distinct primitives must be a low-similarity miss
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const d = descriptorDistance(parts[i].descriptor, parts[j].descriptor);
        const s = similarityScore(d);
        assert.ok(s < 0.6,
          `distinct ${parts[i].partNumber} vs ${parts[j].partNumber} should score <0.6; got ${s}`);
      }
    }
    // and findDuplicates on the distinct-only vault yields no CONFIRMED pair
    const dups = findDuplicates(index, { forge }).filter((d) => d.confirmed);
    assert.equal(dups.length, 0, 'no confirmed duplicates among 8 distinct parts');
  });

  // ── 5. retrieve-then-edit hand-off ──────────────────────────────────────────
  await t.test('retrieveThenEdit returns the match + a cad.edit-step hand-off', () => {
    const res = retrieveThenEdit({ handle: hCopy }, index, forge);
    assert.equal(res.match.partNumber, 'P-002');
    assert.ok(res.score >= 0.99);
    assert.ok(res.editHandoff, 'an editHandoff descriptor must be returned');
    assert.equal(res.editHandoff.verb, 'cad.edit-step');
    assert.equal(res.editHandoff.sourceItem.partNumber, 'P-002');
    assert.ok(res.editHandoff.queryDelta, 'queryDelta morph hint must be present');
    assert.ok(typeof res.editHandoff.queryDelta.scaleFactor === 'number');
    // no editor is invoked — the hand-off is a descriptor only.
  });

  // ── 6. determinism (seeded PRNG) ────────────────────────────────────────────
  await t.test('fingerprint is deterministic for a fixed seed', () => {
    const a = computeFingerprint({ handle: hBox }, forge, { seed: SEED });
    const b = computeFingerprint({ handle: hBox }, forge, { seed: SEED });
    assert.equal(a.d2.length, b.d2.length);
    for (let i = 0; i < a.d2.length; i++) {
      assert.equal(a.d2[i], b.d2[i], `d2 bin ${i} must match bit-for-bit across runs`);
    }
    assert.equal(descriptorDistance(a, b), 0, 'identical body → zero distance');
    assert.equal(similarityScore(0), 1, 'zero distance → score 1.0');
  });

  // ── ranking sanity: near-dup ranks just below the exact copy ────────────────
  await t.test('exact copy outranks the near-duplicate for a cylinder query', () => {
    const ranked = findSimilar(copyDesc, 3, nearIndex, forge);
    assert.equal(ranked[0].part.partNumber, 'P-002', 'exact copy is #1');
    // P-002B (the +5% near-dup) should appear and rank below the exact P-002.
    const dupRank = ranked.findIndex((r) => r.part.partNumber === 'P-002B');
    assert.ok(dupRank >= 1, 'near-duplicate must rank below the exact copy');
    assert.ok(ranked[dupRank].score < ranked[0].score, 'near-dup score < exact copy score');
  });
});
