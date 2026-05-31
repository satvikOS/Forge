import assert from 'node:assert/strict';
import { buildAp242PmiBlock, injectAp242Pmi } from '../Ap242PmiEntities.js';

// Datum + FCF referencing that datum → real AP242 entities.
{
  const anns = [
    { kind: 'datum', name: 'A' },
    { kind: 'datum', name: 'B' },
    {
      kind: 'fcf', control: 'perpendicularity',
      tolerance: 0.05, datums: ['A', 'B'],
      modifiers: ['M'], text: '[⊥|0.050M|A|B]',
    },
    { kind: 'note', text: 'BREAK ALL EDGES 0.5 MAX' },
  ];
  const { lines, entityCount } = buildAp242PmiBlock(anns, 5000);

  assert.ok(entityCount > 0, 'entities emitted');
  // Datum entities emitted.
  assert.ok(lines.some((l) => l.includes('DATUM_FEATURE') && l.includes("'A'")),
            'DATUM_FEATURE A present');
  assert.ok(lines.some((l) => l.includes('DATUM_FEATURE') && l.includes("'B'")),
            'DATUM_FEATURE B present');
  // FCF as PERPENDICULARITY_TOLERANCE.
  assert.ok(lines.some((l) => l.includes('PERPENDICULARITY_TOLERANCE')),
            'PERPENDICULARITY_TOLERANCE entity present');
  // Magnitude carried.
  assert.ok(lines.some((l) => l.includes('LENGTH_MEASURE(0.050000)')),
            'tolerance magnitude entity present');
  // Datum references to A and B.
  const refs = lines.filter((l) => l.includes('GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE'));
  assert.equal(refs.length, 2, 'two datum references');
  // MMC modifier.
  assert.ok(lines.some((l) => l.includes('MAXIMUM_MATERIAL_REQUIREMENT')),
            'MMC modifier entity present');
  // Note as text occurrence.
  assert.ok(lines.some((l) => l.includes('ANNOTATION_TEXT_OCCURRENCE') &&
                              l.includes('BREAK ALL EDGES')),
            'note text occurrence entity present');
  // All entity ids strictly increasing from 5000.
  const ids = lines.map((l) => parseInt(l.match(/^#(\d+)/)[1], 10));
  for (let i = 1; i < ids.length; i++) {
    assert.ok(ids[i] > ids[i - 1], `id ${ids[i]} > previous ${ids[i - 1]}`);
  }
  assert.equal(ids[0], 5000, 'startId honoured');
}

// injectAp242Pmi splices entities before ENDSEC; of DATA section.
{
  const stepSrc = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Forge AP242 test'), '2;1');
FILE_NAME('foo.step', '2026-05-31', ('Forge'), ('Forge'), 'Forge', '', '');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;
#10 = APPLICATION_CONTEXT('mechanical design');
#11 = PRODUCT('p', 'p', '', (#10));
ENDSEC;
END-ISO-10303-21;`;

  const anns = [{ kind: 'datum', name: 'A' }];
  const out = injectAp242Pmi(stepSrc, anns);

  // Marker present.
  assert.ok(out.includes('/* FORGE AP242 PMI */'), 'marker present');
  // Datum entity inside DATA section.
  const dataSectionStart = out.indexOf('DATA;');
  const lastEndsec       = out.lastIndexOf('ENDSEC;');
  const datumIdx         = out.indexOf('DATUM_FEATURE');
  assert.ok(datumIdx > dataSectionStart && datumIdx < lastEndsec,
            'datum entity sits inside the DATA section');
  // Original entities preserved.
  assert.ok(out.includes("APPLICATION_CONTEXT('mechanical design')"),
            'original entities preserved');
  // Idempotent — re-injection is a no-op.
  const out2 = injectAp242Pmi(out, anns);
  assert.equal(out, out2, 'idempotent on re-injection');
}

// Empty annotations → text returned unchanged.
{
  const src = `ISO-10303-21;
HEADER;
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;`;
  const out = injectAp242Pmi(src, []);
  assert.equal(out, src, 'empty annotations → unchanged');
}

console.log('[forge.ap242-pmi-entities] all tests passed');
