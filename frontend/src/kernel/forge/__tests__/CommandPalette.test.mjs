import assert from 'node:assert/strict';
import { Command, CommandRegistry, fuzzyScore } from '../CommandPalette.js';

// ---- registration + invoke -----------------------------------------
{
  const r = new CommandRegistry();
  let invoked = 0;
  r.register({ id: 'file.save', title: 'Save', category: 'File', run: () => { invoked++; } });
  assert.equal(r.size(), 1);
  r.invoke('file.save');
  assert.equal(invoked, 1);
}

// ---- query produces ranked results ---------------------------------
{
  const r = new CommandRegistry();
  r.register({ title: 'Extrude Boss',  category: 'Part',     run: () => {} });
  r.register({ title: 'Revolve Boss',  category: 'Part',     run: () => {} });
  r.register({ title: 'Extrude Cut',   category: 'Part',     run: () => {} });
  r.register({ title: 'Export STEP',   category: 'File',     run: () => {} });

  const hits = r.query('ext').map((h) => h.command.title);
  assert.ok(hits[0].toLowerCase().startsWith('extrude'),
            `expected an Extrude command first, got ${JSON.stringify(hits)}`);
  // "Export STEP" still matches 'ext' as a subsequence (e-x...t).
  assert.ok(hits.includes('Export STEP'), 'subsequence matches');
}

// ---- when() context gating ----------------------------------------
{
  const r = new CommandRegistry();
  r.register({ title: 'Sketch Edit', category: 'Sketch', run: () => {}, when: (c) => c.inSketch });
  r.register({ title: 'Part Extrude', category: 'Part', run: () => {} });

  const outOfSketch = r.query('edit', { inSketch: false }).map((h) => h.command.title);
  assert.equal(outOfSketch.length, 0);
  const inSketch = r.query('edit', { inSketch: true }).map((h) => h.command.title);
  assert.equal(inSketch.includes('Sketch Edit'), true);
}

// ---- usage bias raises ranking ------------------------------------
{
  const r = new CommandRegistry();
  r.register({ id: 'a', title: 'AAA bot',  category: 'Z', run: () => {} });
  r.register({ id: 'b', title: 'AAA top',  category: 'Z', run: () => {} });

  // 'b' starts higher-scoring (same fuzzy score, alphabetical tiebreak indeterminate),
  // but after invoking 'a' three times it should outrank 'b'.
  r.invoke('a'); r.invoke('a'); r.invoke('a');
  const first = r.query('aaa')[0].command.id;
  assert.equal(first, 'a');
}

// ---- fuzzyScore primitive -----------------------------------------
{
  assert.ok(fuzzyScore('ext', 'extrude boss', 'extrude boss') > 0);
  assert.equal(fuzzyScore('zzz', 'extrude boss', 'extrude boss'), 0);
  // Prefix-on-title beats mid-match.
  const prefix = fuzzyScore('ext', 'extrude boss', 'extrude boss');
  const mid    = fuzzyScore('ext', 'next exterior', 'next exterior');
  assert.ok(prefix > mid, `prefix ${prefix} should beat mid ${mid}`);
}

// ---- error paths --------------------------------------------------
{
  const r = new CommandRegistry();
  assert.throws(() => r.invoke('nope'), /unknown/);
  assert.throws(() => new Command({}), /title/);
  assert.throws(() => new Command({ title: 'x' }), /run/);
}

console.log('[forge.cmd] all tests passed');
