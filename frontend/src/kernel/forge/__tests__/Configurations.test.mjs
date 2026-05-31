import assert from 'node:assert/strict';
import {
  Configuration,
  ConfigurationSet,
  DesignTable,
} from '../Configurations.js';

// ---- Configuration basics ------------------------------------------
{
  const c = new Configuration({ name: 'Big', overrides: { 'boss.h': 30 } });
  assert.equal(c.name, 'Big');
  assert.equal(c.get('boss.h'), 30);
  c.set('boss.r', 5);
  assert.equal(c.get('boss.r'), 5);
  c.suppress('hole-2');
  assert.equal(c.isSuppressed('hole-2'), true);
}

// ---- ConfigurationSet defaults + active ---------------------------
{
  const s = new ConfigurationSet();
  assert.equal(s.list().length, 1);
  const def = s.active();
  assert.equal(def.name, 'Default');

  const big = s.add(new Configuration({ name: 'Big', overrides: { 'boss.h': 30 } }));
  s.setActive(big.id);
  assert.equal(s.active().name, 'Big');

  const master = { 'boss.h': 10, 'boss.r': 2 };
  const resolved = s.resolveParams(master);
  assert.equal(resolved['boss.h'], 30);  // overridden
  assert.equal(resolved['boss.r'], 2);   // default

  assert.throws(() => s.setActive('cfg-nope'), /unknown config/);
}

// ---- remove active falls back -------------------------------------
{
  const s = new ConfigurationSet();
  const big = s.add(new Configuration({ name: 'Big' }));
  s.setActive(big.id);
  s.remove(big.id);
  assert.notEqual(s.activeId, big.id);
  assert.ok(s.active() !== null, 'fallback active');
}

// ---- DesignTable from rows ---------------------------------------
{
  const s = DesignTable.fromRows([
    { Name: 'M3', dia: 3, len: 10 },
    { Name: 'M4', dia: 4, len: 12 },
    { Name: 'M5', dia: 5, len: 15 },
  ], { dia: 'boss.r', len: 'boss.h' });
  assert.equal(s.list().length, 3);
  const m4 = s.byName('M4');
  assert.equal(m4.get('boss.r'), 4);
  assert.equal(m4.get('boss.h'), 12);
}

// ---- DesignTable from CSV ----------------------------------------
{
  const csv = `Name,dia,len
M3,3,10
M4,4,12
M5,5,15`;
  const s = DesignTable.fromCsv(csv);
  assert.equal(s.list().length, 3);
  assert.equal(s.byName('M5').get('len'), 15);
}

// ---- serialize round-trip ----------------------------------------
{
  const s = new ConfigurationSet();
  s.add(new Configuration({ name: 'Tall', overrides: { 'a.b': 99 }, suppressed: ['hole-1'] }));
  const json = s.serialize();
  const r = ConfigurationSet.deserialize(json);
  assert.equal(r.list().length, s.list().length);
  assert.ok(r.byName('Tall'));
  assert.equal(r.byName('Tall').get('a.b'), 99);
  assert.equal(r.byName('Tall').isSuppressed('hole-1'), true);
}

// ---- error paths --------------------------------------------------
{
  assert.throws(() => new Configuration({}), /requires a name/);
  assert.throws(() => DesignTable.fromRows([]), /empty/i);
  assert.throws(() => DesignTable.fromCsv('Name,dia'), /≥1 row/);
}

console.log('[forge.config] all tests passed');
