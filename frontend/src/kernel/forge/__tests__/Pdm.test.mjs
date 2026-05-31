import assert from 'node:assert/strict';
import {
  PartVersion, PartHistory, LifecycleState,
  ECO, EcoState, PartStore,
} from '../Pdm.js';

// ---- PartHistory commit chain --------------------------------------
{
  const h = new PartHistory('shaft-001');
  assert.equal(h.head(), null);
  const v1 = h.commit({ blobHash: 'sha-aaaa', message: 'initial', author: 'satvikOS' });
  assert.equal(v1.versionNumber, 1);
  const v2 = h.commit({ blobHash: 'sha-bbbb', message: 'fillet edges', author: 'satvikOS' });
  assert.equal(v2.versionNumber, 2);
  assert.equal(v2.parentVersion, 1);
  assert.equal(h.head(), v2);
}

// ---- Lifecycle promotion -------------------------------------------
{
  const h = new PartHistory('shaft-001');
  h.commit({ blobHash: 'sha-1', message: 'init', author: 'a' });
  const v1 = h.head();
  assert.equal(v1.state, 'WIP');

  const inReview = h.promote(1, LifecycleState.InReview, { author: 'reviewer' });
  assert.equal(inReview.state, 'InReview');
  // The slot was replaced, not mutated.
  assert.notEqual(h.byVersion(1), v1);

  const released = h.promote(1, LifecycleState.Released, { author: 'approver' });
  assert.equal(released.state, 'Released');

  // Released → Obsolete is allowed; Released → WIP is not.
  assert.throws(() => h.promote(1, LifecycleState.WIP), /illegal transition/);
  const obsolete = h.promote(1, LifecycleState.Obsolete);
  assert.equal(obsolete.state, 'Obsolete');
}

// ---- ECO state machine ---------------------------------------------
{
  const eco = new ECO({
    title: 'Increase shaft length 10→12mm',
    requestedBy: 'engA',
    affectedParts: ['shaft-001'],
    approvers: ['engB', 'engC'],
  });
  assert.equal(eco.state, 'Draft');

  eco.transition(EcoState.InReview, 'engA');
  assert.equal(eco.state, 'InReview');

  // Can't approve before all reviewers respond.
  assert.throws(() => eco.transition(EcoState.Approved, 'engA'), /unanimous/);

  eco.approve('engB');
  // Still only one of two approvals.
  assert.throws(() => eco.transition(EcoState.Approved, 'engA'), /unanimous/);

  eco.approve('engC');
  eco.transition(EcoState.Approved, 'engA');
  eco.transition(EcoState.Implemented, 'engA');
  eco.transition(EcoState.Closed, 'engA');

  // Closed is terminal.
  assert.throws(() => eco.transition(EcoState.Draft), /illegal/);
}

// ---- ECO reject path ----------------------------------------------
{
  const eco = new ECO({
    title: 'Risky change',
    requestedBy: 'engA',
    approvers: ['engB'],
  });
  eco.transition(EcoState.InReview);
  eco.reject('engB');
  eco.transition(EcoState.Rejected);
  // From Rejected can go back to Draft for revision or Closed.
  eco.transition(EcoState.Draft);
  assert.equal(eco.state, 'Draft');
}

// ---- PartStore plumbing -------------------------------------------
{
  const store = new PartStore();
  store.commitPart('p1', { blobHash: 'h1', message: 'init', author: 'a' });
  store.commitPart('p1', { blobHash: 'h2', message: 'edit', author: 'a' });
  assert.equal(store.history('p1').count(), 2);

  const eco = store.fileEco({
    title: 'Test', requestedBy: 'a', approvers: ['b'], affectedParts: ['p1'],
  });
  assert.equal(store.getEco(eco.id).title, 'Test');
  assert.equal(store.listEcos().length, 1);
}

// ---- error paths --------------------------------------------------
{
  assert.throws(() => new PartHistory(), /requires partId/);
  assert.throws(() => new ECO({}), /requires a title/);
  assert.throws(() => new PartVersion({ partId: 'x', versionNumber: 1 }), /blobHash required/);
}

console.log('[forge.pdm] all tests passed');
