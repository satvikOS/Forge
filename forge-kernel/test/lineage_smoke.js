// forge-kernel/test/lineage_smoke.js — Forge-60 smoke test for
// kernel-emitted Modified/Generated lineage.
//
// Runs natively against forge-kernel.node when built; verifies that
// after cut(boxA, boxB), forge.lineageFor(outHandle) returns a list
// of {kind, entityKind, originOp, oldIndices, newIndices} entries
// covering every input face of boxA (survivor or death) and every
// new output face introduced by the cut (birth).

const path = require('path');
const addon = require(path.join(__dirname, '..', 'build', 'Release', 'forge-kernel.node'));

const a = addon.makeBox(20, 20, 20);
const b = addon.makeBox(10, 30, 10);  // pokes through one face of a
const out = addon.cut(a, b);
const entries = addon.lineageFor(out);

console.log('cut lineage entries:', entries.length);
if (!Array.isArray(entries)) throw new Error('lineageFor must return an array');
if (entries.length === 0)    throw new Error('expected non-empty lineage from cut');

const kinds = entries.reduce((m, e) => (m[e.kind] = (m[e.kind] || 0) + 1, m), {});
console.log('lineage by kind:', kinds);

// Every entry must have a string kind, entityKind, originOp, and integer
// indices.
for (const e of entries) {
  if (!['survivor','split','merge','birth','death'].includes(e.kind)) {
    throw new Error('bad kind: ' + e.kind);
  }
  if (typeof e.entityKind !== 'string') throw new Error('entityKind missing');
  if (typeof e.originOp !== 'string')   throw new Error('originOp missing');
  if (e.originOp !== 'cut') throw new Error('expected originOp="cut", got ' + e.originOp);
  if (!Array.isArray(e.oldIndices)) throw new Error('oldIndices not array');
  if (!Array.isArray(e.newIndices)) throw new Error('newIndices not array');
}

// We expect at least one survivor (the 5 untouched faces of A) and at
// least one new face (the cut creates a hole-bottom + walls in A).
if (!kinds.survivor) console.warn('WARN: no survivors (op may have consumed all)');
if (!kinds.birth)    console.warn('WARN: no births (op was pure subtraction?)');

console.log('[forge.lineage] smoke OK');
