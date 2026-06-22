/**
 * Node test for in-model design-rationale / knowledge capture — Task #39.
 *   node --test frontend/src/forge-v4/rationale/__tests__/designRationale.test.mjs
 *
 * UI-free, no kernel — the rationale store/capture/query/rebuild operate on
 * recipes + records, not geometry, so this runs with zero native deps. State is
 * reset between cases via _resetForTests.
 *
 * Coverage (per the brief):
 *   1. capture "wall=4mm because min-stiffness req R-12 (alt 3mm rejected:
 *      deflection)" + "holeØ6 for M6 clearance", keyed by the persistent fid.
 *   2. query "why is the wall 4mm" → returns the wall intent + R-12 + the
 *      rejected 3mm alternative + provenance.
 *   3. query a DIFFERENT feature ("why is the hole Ø6") → its OWN rationale
 *      (the hole's), NOT the wall's.
 *   4. list → both records.
 *   5. survives rebuild / unrelated param edit → the wall rationale is STILL
 *      attached + queryable (keyed by fid, not index).
 *   6. remove the wall feature → its rationale is FLAGGED orphaned (still
 *      present in list, not deleted); the hole stays attached.
 *   7. persistence crash-safety round-trip (mirrors vcs test #9).
 *   8. bridge integration: rationale.capture then rationale.query via
 *      dispatchToolCall proves the Archie-drivable path end-to-end; and a build
 *      op carrying a `rationale` blob auto-captures (byproduct of building).
 *
 * No new npm packages.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import rationale, {
  captureRationale, queryRationale, listRationale, getRationale,
  reconcile, rationaleFromOp, featureIdOf, serializeState,
  _resetForTests, _flushForTests, _reloadForTests, __test, PART_SENTINEL,
} from '../designRationale.js';

// The rationale.* tools never touch the kernel, but dispatchToolCall resolves a
// `forge` before running any verb (it would throw getForge() outside Electron).
// Passing this empty stub via opts.forge short-circuits that — the tools ignore it.
const STUB_FORGE = {};

// A bracket recipe: a 4 mm wall + a Ø6 thru-hole, each carrying a persistent fid.
const bracket = (over = {}) => ({
  kind: 'bracket',
  params: { dx: 80, dy: 60, dz: 12 },
  features: [
    { fid: 'wall1', op: 'wall', params: { thickness: 4 } },
    { fid: 'hole1', op: 'hole', params: { diameter: 6 } },
    ...(over.features || []),
  ],
  ...(over.params ? { params: { dx: 80, dy: 60, dz: 12, ...over.params } } : {}),
});

test('design rationale: capture / query / list / rebuild-survival / orphan', async (t) => {
  // ── 1. capture rationale on two features ──────────────────────────────────
  await t.test('capture wall + hole rationale keyed by persistent fid', () => {
    _resetForTests();
    const recipe = bracket();

    const wall = captureRationale('P-1', 'wall1', {
      intent: 'minimum wall thickness for required stiffness',
      drivingRequirement: 'R-12 (min stiffness)',
      constraint: '4 mm wall — below this the panel fails the R-12 deflection limit',
      rejected: [{ alternative: '3 mm', reason: 'fails R-12 — excessive deflection under load' }],
      provenance: { who: 'archie', source: 'FEA run #7' },
      feature: recipe.features.find((f) => f.fid === 'wall1'),
    });
    assert.equal(wall.featureId, 'wall1', 'keyed by the persistent fid');
    assert.equal(wall.intent, 'minimum wall thickness for required stiffness');
    assert.equal(wall.drivingRequirement, 'R-12 (min stiffness)');
    assert.equal(wall.rejectedAlternatives.length, 1);
    assert.equal(wall.rejectedAlternatives[0].alternative, '3 mm');
    assert.match(wall.rejectedAlternatives[0].reason, /deflection/);
    assert.equal(wall.provenance.who, 'archie', 'who defaults / carries through');
    assert.ok(wall.provenance.when, 'when is stamped (ISO timestamp)');
    assert.equal(wall.orphaned, false);

    const hole = captureRationale('P-1', 'hole1', {
      intent: 'clearance hole for an M6 fastener',
      drivingRequirement: 'ISO 273 medium clearance',
      constraint: 'Ø6 — M6 clearance per ISO 273 medium fit',
      feature: recipe.features.find((f) => f.fid === 'hole1'),
    });
    assert.equal(hole.featureId, 'hole1');
    assert.equal(hole.provenance.who, 'archie', 'who defaults to archie when omitted');
  });

  // ── 2. NL query resolves the wall (value + name + the rejected alt) ───────
  await t.test('query "why is the wall 4mm" returns the wall rationale + R-12 + rejected 3mm', () => {
    const ans = queryRationale('P-1', 'why is the wall 4mm?');
    assert.equal(ans.found, true, 'the question resolves to a feature');
    assert.equal(ans.featureId, 'wall1', 'resolves to the WALL feature (value 4 + name "wall")');
    assert.equal(ans.intent, 'minimum wall thickness for required stiffness');
    assert.match(ans.drivingRequirement, /R-12/, 'returns the driving requirement R-12');
    assert.equal(ans.alternatives.length, 1);
    assert.equal(ans.alternatives[0].alternative, '3 mm', 'returns the rejected 3 mm alternative');
    assert.match(ans.alternatives[0].reason, /deflection/, 'with the reason it was rejected');
    assert.equal(ans.provenance.who, 'archie', 'returns provenance');
    assert.match(ans.provenance.source, /FEA run #7/);
  });

  // ── 3. a DIFFERENT feature resolves to its OWN rationale, not the wall's ──
  await t.test('query "why is the hole Ø6" returns the HOLE rationale (not the wall)', () => {
    const ans = queryRationale('P-1', 'why is the hole 6 mm diameter');
    assert.equal(ans.found, true);
    assert.equal(ans.featureId, 'hole1', 'resolves to the HOLE, not the wall');
    assert.match(ans.constraint, /M6 clearance/);
    assert.notEqual(ans.featureId, 'wall1', 'must NOT return the wall record');
  });

  // ── 4. list returns both records ──────────────────────────────────────────
  await t.test('list returns both captured records', () => {
    const all = listRationale('P-1');
    assert.equal(all.length, 2);
    const ids = all.map((r) => r.featureId).sort();
    assert.deepEqual(ids, ['hole1', 'wall1']);
  });

  // ── 5. survives rebuild with an UNRELATED param edit ──────────────────────
  await t.test('rebuild with an unrelated param edit keeps the wall rationale attached + queryable', () => {
    // Rebuild the part: change the hole diameter 6→6.2 AND a top-level param
    // (and reorder features) — everything EXCEPT the wall. Because records key
    // on the persistent fid, the wall rationale must stay attached.
    const rebuilt = {
      kind: 'bracket',
      params: { dx: 100, dy: 60, dz: 12 }, // dx 80→100 (unrelated)
      features: [
        { fid: 'hole1', op: 'hole', params: { diameter: 6.2 } }, // 6→6.2, reordered first
        { fid: 'wall1', op: 'wall', params: { thickness: 4 } },  // unchanged
      ],
    };
    const res = reconcile('P-1', rebuilt);
    assert.deepEqual(res.attached.sort(), ['hole1', 'wall1'], 'both still attached after rebuild');
    assert.equal(res.orphaned.length, 0, 'nothing orphaned by an unrelated edit');

    // The wall rationale is STILL queryable.
    const ans = queryRationale('P-1', 'why is the wall 4mm?');
    assert.equal(ans.found, true);
    assert.equal(ans.featureId, 'wall1', 'wall rationale survives the rebuild');
    assert.match(ans.drivingRequirement, /R-12/);

    // The hole snapshot was refreshed → a query for the NEW value (6.2) now resolves it.
    const holeAns = queryRationale('P-1', 'why is the hole 6.2');
    assert.equal(holeAns.found, true);
    assert.equal(holeAns.featureId, 'hole1', 'resolver value-matches the refreshed 6.2 param');
  });

  // ── 6. remove the wall feature → its rationale is FLAGGED orphaned ─────────
  await t.test('removing the wall feature flags its rationale orphaned (not deleted)', () => {
    const withoutWall = {
      kind: 'bracket',
      params: { dx: 100, dy: 60, dz: 12 },
      features: [
        { fid: 'hole1', op: 'hole', params: { diameter: 6.2 } }, // wall1 removed
      ],
    };
    const res = reconcile('P-1', withoutWall);
    assert.deepEqual(res.orphaned, ['wall1'], 'the removed wall feature is reported orphaned');
    assert.deepEqual(res.attached, ['hole1'], 'the hole stays attached');

    // The wall record is FLAGGED, not deleted — still present in list.
    const wall = getRationale('P-1', 'wall1');
    assert.ok(wall, 'the wall rationale record is NOT deleted');
    assert.equal(wall.orphaned, true, 'it is flagged orphaned');
    assert.ok(wall.orphanedAt, 'with an orphanedAt timestamp');
    const all = listRationale('P-1');
    assert.equal(all.length, 2, 'orphaned record still listed (the why is surfaced, not lost)');

    // An orphaned record is excluded from query resolution (its feature is gone).
    const ans = queryRationale('P-1', 'why is the wall 4mm?');
    assert.equal(ans.found, false, 'a removed feature no longer answers (its why is flagged, not active)');

    // Re-capturing the wall (re-added) clears the orphan flag.
    captureRationale('P-1', 'wall1', { feature: { fid: 'wall1', op: 'wall', params: { thickness: 4 } } });
    assert.equal(getRationale('P-1', 'wall1').orphaned, false, 're-capture re-attaches');
  });

  // ── 7. persistence crash-safety + key-sorted round-trip ───────────────────
  await t.test('crash-safe recovery from .tmp + lossless key-sorted serialization', () => {
    const store = new Map();
    const fakeLS = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    const prev = globalThis.localStorage;
    globalThis.localStorage = fakeLS;
    try {
      _resetForTests();
      captureRationale('P-9', 'rib7', {
        intent: 'stiffening rib', constraint: '2 mm rib for buckling margin',
        feature: { fid: 'rib7', op: 'rib', params: { thickness: 2 } },
      });
      _flushForTests(); // force a synchronous durable write to KEY (+ clears tmp)
      const keyText = store.get(__test.LS_KEY);
      assert.ok(keyText, 'live KEY written');

      // Simulate a crash that left a half-written tmp but no committed KEY.
      store.delete(__test.LS_KEY);
      store.set(__test.LS_TMP, keyText);
      const recovered = _reloadForTests();
      assert.ok(recovered.records['P-9'] && recovered.records['P-9'].rib7,
        'state recovered from .tmp after a crashed write');
      assert.equal(store.get(__test.LS_KEY), keyText, '.tmp promoted to the live KEY on recovery');

      // The recovered rationale is still queryable.
      const ans = queryRationale('P-9', 'why is the rib 2mm');
      assert.equal(ans.found, true);
      assert.equal(ans.featureId, 'rib7');
    } finally {
      if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev;
      _resetForTests();
    }

    // serializeState is valid, indented, key-sorted, parseable text.
    captureRationale('P-1', 'wall1', { intent: 'x', feature: { fid: 'wall1', op: 'wall', params: { thickness: 4 } } });
    const text = serializeState();
    const parsed = JSON.parse(text);
    assert.equal(parsed.schemaVersion, 1);
    assert.ok(parsed.records['P-1'].wall1, 'serialized record present');
    // top-level keys sorted (records < schemaVersion).
    assert.deepEqual(Object.keys(parsed), ['records', 'schemaVersion']);
  });

  // ── 8. the auto-capture hook (the "byproduct of building" seam) ───────────
  await t.test('rationaleFromOp auto-captures when a build op carries a rationale', () => {
    _resetForTests();
    // No rationale payload → no-op (every legacy build call is unaffected).
    const none = rationaleFromOp({ partId: 'P-2' }, { feature: { fid: 'b1', op: 'boss' } });
    assert.equal(none, null, 'no rationale supplied → no-op');

    // A build op result carries the produced feature; args carry the why.
    const rec = rationaleFromOp(
      { partId: 'P-2', rationale: {
        intent: 'locating boss for the mating PCB', constraint: 'Ø3 boss — datum-B clearance',
        rejected: ['no boss — relies on adhesive, rejected: poor repeatability'],
      } },
      { feature: { fid: 'boss3', op: 'boss', params: { diameter: 3 } } },
    );
    assert.ok(rec, 'rationale captured as a byproduct of the build op');
    assert.equal(rec.featureId, 'boss3', 'attached to the produced feature');
    assert.equal(rec.rejectedAlternatives.length, 1);
    const ans = queryRationale('P-2', 'why is the boss 3mm');
    assert.equal(ans.found, true);
    assert.equal(ans.featureId, 'boss3');
  });
});

// ── 9. Archie-drivable path: dispatch the rationale.* tools end-to-end ───────
test('ForgeToolBridge: rationale.capture / query / list are Archie-drivable', async () => {
  const { dispatchToolCall } = await import('../../../ai/ForgeToolBridge.js');
  _resetForTests();

  const cap = await dispatchToolCall({ name: 'rationale.capture', arguments: {
    partId: 'PB-1', featureId: 'wall1',
    intent: 'min wall for required stiffness',
    drivingRequirement: 'R-12',
    constraint: '4 mm wall — R-12 deflection limit',
    rejected: [{ alternative: '3 mm', reason: 'fails R-12' }],
    feature: { fid: 'wall1', op: 'wall', params: { thickness: 4 } },
  } }, { forge: STUB_FORGE });
  assert.equal(cap.ok, true, 'rationale.capture dispatches');
  assert.equal(cap.result.featureId, 'wall1');

  const q = await dispatchToolCall({ name: 'rationale.query', arguments: {
    partId: 'PB-1', question: 'why is the wall 4mm?',
  } }, { forge: STUB_FORGE });
  assert.equal(q.ok, true, 'rationale.query dispatches');
  assert.equal(q.result.found, true);
  assert.equal(q.result.featureId, 'wall1');
  assert.match(q.result.drivingRequirement, /R-12/, 'the captured why round-trips through the bridge');

  const list = await dispatchToolCall({ name: 'rationale.list', arguments: { partId: 'PB-1' } }, { forge: STUB_FORGE });
  assert.equal(list.ok, true, 'rationale.list dispatches');
  assert.equal(list.result.count, 1);

  // sanity: featureIdOf + PART_SENTINEL exports behave.
  assert.equal(featureIdOf({ fid: 'x' }), 'x');
  assert.equal(featureIdOf({ id: 'y' }), 'y');
  assert.equal(PART_SENTINEL, '__part__');
  assert.equal(typeof rationale.captureRationale, 'function');
  assert.equal(typeof reconcile, 'function');
});
