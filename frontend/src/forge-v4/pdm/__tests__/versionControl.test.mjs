/**
 * Node test for local-first CAD version control ("git-for-CAD") — Task #32.
 *   node --test frontend/src/forge-v4/pdm/__tests__/versionControl.test.mjs
 *
 * UI-free. A synthetic in-memory vault (snapshot objects passed directly; VCS
 * state reset via _resetForTests). Uses the prebuilt forge-kernel.node for the
 * REAL geometry delta (massProps + tessellated bbox); the geom-delta sub-tests
 * self-skip if the kernel is unavailable, but the content-addressed graph /
 * branch / 3-way-merge / recipe-diff / where-used / impact / crash-safety tests
 * run with no kernel.
 *
 * Coverage (per the brief):
 *   1. commit v0 of a plate — deterministic id, idempotent re-commit dedupes.
 *   2. branch A + B from v0 — both heads === v0 (lock-free).
 *   3. parallel edit on DIFFERENT params (A width, B thickness) → 3-way merge
 *      auto-resolves to BOTH changes, zero conflicts (no silent loss).
 *   4. parallel edit on the SAME param differently (A width=120, B width=90) →
 *      merge reports a width CONFLICT carrying base/ours/theirs (no silent loss).
 *   5. feature-list 3-way: add/remove non-conflicting → auto-merge; modify-both
 *      differently → conflict.
 *   6. diff(v0, A) → recipeDiff lists width modified + (with kernel) a non-zero
 *      geomDelta (volume + bbox diagonal grow for the wider plate).
 *   7. where-used: a child used by 2 assemblies → both parents; transitive →
 *      grandparents.
 *   8. impact: transitive parent closure, deduped.
 *   9. crash-safety: KEY missing + .tmp present → loader recovers; serialize
 *      round-trip is lossless + key-sorted (text-diffable).
 *
 * No new npm packages.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import vcs, {
  commit, branch, tag, checkout, merge, mergeBranches, mergeBase,
  diff, recipeDiff, geomDelta, whereUsed, impact,
  log, listBranches, getCommit, headOf,
  serializeVersion, serializeState, hashContent, canonicalize,
  _resetForTests, _flushForTests, _reloadForTests,
  __test,
} from '../versionControl.js';

import {
  _resetForTests as resetPdm, createItem, linkBom,
} from '../../pdmStore.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let forge = null;
try {
  forge = require(path.resolve(
    __dirname, '..', '..', '..', '..', '..',
    'forge-kernel', 'build', 'Release', 'forge-kernel.node'));
} catch (e) {
  console.error('[versionControl.test] kernel unavailable — geom-delta sub-tests skip:', e.message);
}

// A plate recipe (box with a thru-hole) — matches autoDrawing.rebuildShape.
const plate = (over = {}) => ({
  kind: 'plate-hole',
  params: { dx: 80, dy: 60, dz: 12, holeR: 10, ...over },
});

test('content-addressed graph + branch/merge/diff/where-used/impact', async (t) => {
  _resetForTests();
  resetPdm();

  // ── 1. commit v0 of a plate ──────────────────────────────────────────────
  let v0;
  await t.test('commit v0 is deterministic + idempotent', () => {
    v0 = commit({ itemId: 'P-1', recipe: plate(), message: 'initial plate' });
    assert.ok(typeof v0 === 'string' && v0.length === 16, `versionId must be a 16-hex hash; got ${v0}`);

    // Re-committing identical content on the same parent (HEAD now v0) must
    // produce a NEW id (parent folded in) but the SAME content hash on the body.
    const c0 = getCommit(v0);
    assert.equal(c0.itemId, 'P-1');
    assert.equal(c0.parents.length, 0, 'first commit has no parent');

    // Deterministic: re-serialize same content → same content hash.
    const h1 = hashContent(serializeVersion({ recipe: plate(), pmi: [] }));
    const h2 = hashContent(serializeVersion({ recipe: plate(), pmi: [] }));
    assert.equal(h1, h2, 'identical content hashes identically');
    assert.equal(c0.contentHash, h1, 'commit records the content hash of its snapshot');

    // Idempotent dedupe: committing the exact same snapshot onto the same parent
    // (null) yields the same id and does NOT create a second node.
    _resetForTests();
    const a = commit({ itemId: 'P-1', recipe: plate() });
    const b = commit({ itemId: 'P-1', recipe: plate(), parent: null });
    assert.equal(a, b, 'same content + same parent dedupes to one version id');
  });

  // Re-seed a clean v0 for the branch/merge tests.
  _resetForTests();
  v0 = commit({ itemId: 'P-1', recipe: plate(), branch: 'main', message: 'v0' });

  // ── 2. branch A + B from v0 (lock-free) ──────────────────────────────────
  await t.test('branch A + B from v0 — both heads === v0, no lock', () => {
    const a = branch('A', v0);
    const b = branch('B', v0);
    assert.equal(a.head, v0);
    assert.equal(b.head, v0);
    assert.equal(headOf('A'), v0);
    assert.equal(headOf('B'), v0);
    const names = listBranches().map((x) => x.name).sort();
    assert.deepEqual(names, ['A', 'B', 'main']);
  });

  // ── 3. parallel edit, DIFFERENT params → auto-merge both, no conflict ─────
  await t.test('parallel edit on different params auto-merges to BOTH changes', () => {
    const headA = commit({ itemId: 'P-1', recipe: plate({ dx: 120 }), branch: 'A', parent: v0 }); // A: width 80→120
    const headB = commit({ itemId: 'P-1', recipe: plate({ dz: 20 }), branch: 'B', parent: v0 });  // B: thickness 12→20

    const { merged, conflicts } = merge(v0, headA, headB);
    assert.equal(conflicts.length, 0, 'different params must not conflict');
    assert.equal(merged.recipe.params.dx, 120, 'A\'s width change survives');
    assert.equal(merged.recipe.params.dz, 20, 'B\'s thickness change survives');
    assert.equal(merged.recipe.params.dy, 60, 'untouched param keeps base value');
    assert.equal(merged.recipe.params.holeR, 10, 'untouched param keeps base value');

    // mergeBranches finds the LCA (v0) automatically from the two heads.
    assert.equal(mergeBase(headA, headB), v0, 'LCA of the two heads is v0');
    const mb = mergeBranches('A', 'B');
    assert.equal(mb.base, v0);
    assert.equal(mb.conflicts.length, 0);
    assert.equal(mb.merged.recipe.params.dx, 120);
    assert.equal(mb.merged.recipe.params.dz, 20);
  });

  // ── 4. parallel edit, SAME param differently → CONFLICT (no silent loss) ──
  await t.test('same param changed differently is a surfaced conflict', () => {
    const headA = commit({ itemId: 'P-1', recipe: plate({ dx: 120 }), branch: 'A', parent: v0 });
    const headB = commit({ itemId: 'P-1', recipe: plate({ dx: 90 }), branch: 'B', parent: v0 });

    const { merged, conflicts } = merge(v0, headA, headB);
    const c = conflicts.find((x) => x.kind === 'param' && x.key === 'dx');
    assert.ok(c, 'a width (dx) conflict must be reported');
    assert.equal(c.base, 80, 'conflict carries the base value');
    assert.equal(c.ours, 120, 'conflict carries OUR value');
    assert.equal(c.theirs, 90, 'conflict carries THEIR value');
    // merged is still produced (defaults to ours) — never a silent drop.
    assert.equal(merged.recipe.params.dx, 120, 'merged keeps ours by default; both values retained in the conflict');
  });

  // ── 5. feature-list 3-way merge ──────────────────────────────────────────
  await t.test('feature-list: add/remove auto-merge; modify-both conflicts', () => {
    const base = { recipe: { kind: 'plate-hole', params: { dx: 80, dy: 60, dz: 12 },
      features: [
        { fid: 'f1', op: 'fillet', edges: [0], r: 2 },
        { fid: 'f2', op: 'chamfer', edges: [3], d: 1 },
      ] } };
    // ours: add a counterbore feature, keep f1/f2.
    const ours = { recipe: { ...base.recipe, features: [
      ...base.recipe.features,
      { fid: 'f3', op: 'counterbore', hole: 0, d: 6 },
    ] } };
    // theirs: remove f2, modify f1's radius.
    const theirs = { recipe: { ...base.recipe, features: [
      { fid: 'f1', op: 'fillet', edges: [0], r: 5 }, // modified r 2→5
    ] } };

    const { merged, conflicts } = merge(base, ours, theirs);
    assert.equal(conflicts.length, 0, 'add (ours) + remove/modify (theirs) on distinct features do not conflict');
    const fids = merged.recipe.features.map((f) => f.fid).sort();
    assert.deepEqual(fids, ['f1', 'f3'], 'f2 removed by theirs; f3 added by ours; f1 survives');
    const f1 = merged.recipe.features.find((f) => f.fid === 'f1');
    assert.equal(f1.r, 5, 'f1\'s radius modification (theirs only) is taken');

    // Now modify f1 differently on BOTH sides → conflict.
    const oursMod = { recipe: { ...base.recipe, features: [
      { fid: 'f1', op: 'fillet', edges: [0], r: 4 }, base.recipe.features[1],
    ] } };
    const theirsMod = { recipe: { ...base.recipe, features: [
      { fid: 'f1', op: 'fillet', edges: [0], r: 6 }, base.recipe.features[1],
    ] } };
    const res2 = merge(base, oursMod, theirsMod);
    const fc = res2.conflicts.find((x) => x.kind === 'feature' && x.fid === 'f1');
    assert.ok(fc, 'f1 modified differently on both sides is a feature conflict');
    assert.equal(fc.ours.r, 4);
    assert.equal(fc.theirs.r, 6);
    assert.equal(res2.merged.recipe.features.find((f) => f.fid === 'f1').r, 4, 'merged defaults to ours; not lost');
  });

  // ── 6. diff(v0, A) — recipe diff + (kernel) geom delta ───────────────────
  await t.test('diff lists the changed param + a non-zero geometry delta', () => {
    const a = { recipe: plate() };          // dx 80
    const b = { recipe: plate({ dx: 120 }) }; // dx 120 — wider plate
    const rd = recipeDiff(a, b);
    assert.deepEqual(rd.params.modified.dx, { from: 80, to: 120 }, 'width modification is reported');
    assert.equal(Object.keys(rd.params.added).length, 0);
    assert.equal(Object.keys(rd.params.removed).length, 0);
    assert.equal(rd.kindChanged, null, 'same kind → no kind change');

    if (forge) {
      const d = diff(a, b, forge);
      assert.ok(d.geomDeltaAvailable, 'geomDelta must be available with a kernel');
      const g = d.geomDelta;
      // A wider plate has MORE volume and a LONGER bbox diagonal.
      assert.ok(g.volume.delta > 0, `volume must grow for the wider plate; got Δ=${g.volume.delta}`);
      assert.ok(g.volume.b > g.volume.a, 'b volume > a volume');
      assert.ok(g.bbox.deltaDiag > 0, `bbox diagonal must grow; got Δ=${g.bbox.deltaDiag}`);
      assert.ok(Array.isArray(g.bbox.a) && Array.isArray(g.bbox.b), 'bbox a/b min-max present');
      // mass when density supplied.
      const dm = diff(a, b, forge, { density: 7850 });
      assert.ok(dm.geomDelta.mass && dm.geomDelta.mass.delta > 0, 'mass grows with density supplied');
    } else {
      // Honest scope: no kernel → geomDelta null, text recipeDiff still returned.
      const d = diff(a, b, null);
      assert.equal(d.geomDelta, null);
      assert.equal(d.geomDeltaAvailable, false);
      assert.ok(d.recipeDiff.params.modified.dx, 'text recipeDiff still works with no kernel');
    }
  });

  // ── 7. where-used (direct + transitive) ──────────────────────────────────
  await t.test('a part used by 2 assemblies → whereUsed returns both; transitive → grandparents', () => {
    resetPdm();
    // child bolt used by two sub-assemblies, both rolled into a top assembly.
    const bolt = createItem({ partNumber: 'BOLT-M6', name: 'M6 bolt' });
    const subA = createItem({ partNumber: 'SUB-A', name: 'bracket sub-assy A' });
    const subB = createItem({ partNumber: 'SUB-B', name: 'bracket sub-assy B' });
    const top  = createItem({ partNumber: 'TOP-1', name: 'top assembly' });
    linkBom(bolt.id, subA.id, 4);  // bolt is child of subA
    linkBom(bolt.id, subB.id, 2);  // bolt is child of subB
    linkBom(subA.id, top.id, 1);   // subA child of top
    linkBom(subB.id, top.id, 1);   // subB child of top

    const direct = whereUsed(bolt.id);
    const directPNs = direct.map((p) => p.partNumber).sort();
    assert.deepEqual(directPNs, ['SUB-A', 'SUB-B'], 'direct where-used returns both sub-assemblies');
    assert.ok(direct.every((p) => p.depth === 1), 'direct parents at depth 1');
    const qtyA = direct.find((p) => p.partNumber === 'SUB-A').qty;
    assert.equal(qtyA, 4, 'qty carried from the BOM edge');

    const trans = whereUsed(bolt.id, { transitive: true });
    const transPNs = trans.map((p) => p.partNumber).sort();
    assert.deepEqual(transPNs, ['SUB-A', 'SUB-B', 'TOP-1'], 'transitive reaches the grandparent TOP-1');
    const topRow = trans.find((p) => p.partNumber === 'TOP-1');
    assert.equal(topRow.depth, 2, 'grandparent at depth 2');

    // ── 8. impact: the transitive closure, deduped ─────────────────────────
    const imp = impact(bolt.id);
    const impPNs = imp.map((p) => p.partNumber).sort();
    assert.deepEqual(impPNs, ['SUB-A', 'SUB-B', 'TOP-1'], 'impact lists every assembly needing rebuild');
    assert.ok(imp.every((p) => p.reason === 'rebuild'), 'each impact tagged rebuild');
    // TOP-1 is reachable via two paths but must appear ONCE (deduped).
    assert.equal(impPNs.filter((p) => p === 'TOP-1').length, 1, 'TOP-1 deduped despite two paths');
  });

  // ── 9. crash-safety + lossless, key-sorted serialization ─────────────────
  await t.test('crash-safe recovery from .tmp + lossless key-sorted round-trip', () => {
    // serialize→parse round-trip is lossless and key-sorted (text-diffable).
    const snap = { recipe: plate({ dx: 99 }), pmi: [{ id: 'a', fcf: '[⊕|⌀0.1|A]' }] };
    const text = serializeVersion(snap);
    const back = JSON.parse(text);
    // key order is sorted at every level.
    assert.deepEqual(Object.keys(back), ['pmi', 'recipe'], 'top-level keys sorted');
    assert.deepEqual(Object.keys(back.recipe), ['features', 'kind', 'params'], 'recipe keys sorted');
    assert.deepEqual(Object.keys(back.recipe.params).sort(), Object.keys(back.recipe.params),
      'params keys sorted');
    // canonicalize is idempotent.
    assert.equal(JSON.stringify(canonicalize(back)), text, 'canonical form is stable under re-canonicalize');

    // crash-safety: stand up a fake localStorage, write the live KEY, then
    // simulate a crash mid-write (KEY removed, .tmp left behind) and assert the
    // loader recovers from the tmp.
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
      commit({ itemId: 'P-9', recipe: plate({ dx: 33 }), message: 'durable' });
      _flushForTests(); // force a synchronous durable write to KEY (+ clears tmp)
      const keyText = store.get(__test.LS_KEY);
      assert.ok(keyText, 'live KEY written');

      // Simulate a crash that left a half-written tmp but no committed KEY.
      store.delete(__test.LS_KEY);
      store.set(__test.LS_TMP, keyText);
      const recovered = _reloadForTests();
      assert.ok(Object.keys(recovered.commits).length >= 1, 'state recovered from .tmp after a crashed write');
      // and the loader promoted the tmp to the live KEY.
      assert.equal(store.get(__test.LS_KEY), keyText, '.tmp promoted to the live KEY on recovery');
    } finally {
      if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev;
      _resetForTests();
    }

    // serializeState is valid, indented, parseable text (the whole graph).
    _resetForTests();
    commit({ itemId: 'P-1', recipe: plate() });
    const stateText = serializeState();
    const parsed = JSON.parse(stateText);
    assert.equal(parsed.schemaVersion, 1);
    assert.ok(parsed.commits && Object.keys(parsed.commits).length === 1);
  });

  // ── extra: tag + log + checkout sanity ───────────────────────────────────
  await t.test('tag, log history walk, and checkout', () => {
    _resetForTests();
    const a = commit({ itemId: 'P-1', recipe: plate(), branch: 'main' });
    const b = commit({ itemId: 'P-1', recipe: plate({ dx: 100 }), branch: 'main' });
    const c = commit({ itemId: 'P-1', recipe: plate({ dx: 100, dz: 16 }), branch: 'main' });
    tag('release-1', c);
    assert.equal(vcs.listTags()[0].versionId, c);
    const hist = log('main');
    assert.deepEqual(hist.map((x) => x.id), [c, b, a], 'log walks newest→oldest by parent');
    const co = checkout('main');
    assert.equal(co.head, c);
  });
});
