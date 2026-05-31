import assert from 'node:assert/strict';
import { BomRollup, autoBalloon, BomTable } from '../BomRollup.js';

// Forge stub that mirrors the Forge-35 assembly bridge surface used by
// BomRollup: assembly.getChildren walks the hierarchy, and the optional
// getComponentHandle dedupes identical part instances onto one row.
//
// Layout:
//
//   root(0)
//   ├── 10  ──┬── 20  comp=1  (Bolt)
//   │        └── 21  comp=1  (Bolt — same part as 20)
//   └── 11  ──── 22  comp=2  (Plate)
function stubForge() {
  return {
    assembly: {
      getChildren: (id) => {
        if (id === 0)  return [10, 11];
        if (id === 10) return [20, 21];
        if (id === 11) return [22];
        return [];
      },
    },
    getComponentHandle: (id) => {
      if (id === 20 || id === 21) return 1;
      if (id === 22)              return 2;
      return 0;
    },
  };
}

const PART_META = {
  'comp-1': { name: 'Bolt M3',       partNumber: 'P-1', description: 'M3 hex bolt',     material: 'Steel',    mass: 0.0157 },
  'comp-2': { name: 'Mounting plate', partNumber: 'P-2', description: 'AL plate',        material: 'Aluminum', mass: 0.0054 },
};

function stubProject() {
  return {
    partStore: { metaFor: (pid) => PART_META[pid] || null },
    materialLibrary: {
      Steel:    { usdPerKg: 2.50 },
      Aluminum: { usdPerKg: 4.00 },
    },
  };
}

// ─────────────── BomRollup ───────────────
{
  const forge = stubForge();
  const project = stubProject();
  const rollup = new BomRollup({ project, rootInstance: 0, forge,
                                 includeSubAssemblies: false });
  const rows = rollup.items();

  assert.equal(rows.length, 2, 'two distinct parts');
  // Aggregation by partId — bolts collapse into one row with qty=2.
  const bolt = rows.find((r) => r.partNumber === 'P-1');
  const plate = rows.find((r) => r.partNumber === 'P-2');
  assert.ok(bolt && plate);
  assert.equal(bolt.qty, 2);
  assert.equal(plate.qty, 1);

  // Mass + cost rollups.
  assert.ok(Math.abs(bolt.totalMass - 0.0157 * 2) < 1e-6,
            `bolt total mass ${bolt.totalMass}`);
  assert.ok(Math.abs(plate.totalMass - 0.0054) < 1e-6);
  // cost = mass × usdPerKg × qty
  assert.ok(Math.abs(bolt.totalCost - 0.0157 * 2.50 * 2) < 1e-6,
            `bolt total cost ${bolt.totalCost}`);
}

// ─────────────── BomTable.toSvg ───────────────
{
  const forge = stubForge();
  const project = stubProject();
  const rollup = new BomRollup({ project, rootInstance: 0, forge,
                                 includeSubAssemblies: false });
  const svg = BomTable.toSvg(rollup, {
    columns: ['item', 'partNumber', 'description', 'qty', 'material', 'mass'],
    sheetSize: 'A3',
  });
  assert.ok(svg.includes('<svg'), 'svg root');
  assert.ok(svg.includes('</svg>'), 'svg close');
  assert.ok(svg.includes('P-1'),       'first partNumber present');
  assert.ok(svg.includes('P-2'),       'second partNumber present');
  assert.ok(svg.includes('M3 hex bolt'), 'description column rendered');
}

// ─────────────── autoBalloon ───────────────
{
  const forge = stubForge();
  const project = stubProject();
  const rollup = new BomRollup({ project, rootInstance: 0, forge,
                                 includeSubAssemblies: false });

  const balloons = [];
  const view = {
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    componentsVisible: [
      { instanceId: 20, centroid: { x: 30, y: 40 } },
      { instanceId: 21, centroid: { x: 70, y: 60 } },
      { instanceId: 22, centroid: { x: 50, y: 50 } },
    ],
    balloons,
    addBalloon: (b) => { balloons.push(b); },
  };
  const placed = autoBalloon(view, rollup, {
    instanceList: view.componentsVisible.map((c) => ({
      instance: c.instanceId, row: rollup.rowFor(c.instanceId),
    })),
    centroidOf: (inst, row, i) => {
      const c = view.componentsVisible[i];
      return [c.centroid.x, c.centroid.y];
    },
  });
  assert.equal(placed.length, 3, 'three visible → three balloons');
  // Duplicate bolts share the same itemNumber.
  const labels = placed.map((b) => b.number).sort();
  // We don't assume which itemNumber the bolt vs plate got — only that
  // two of them match.
  assert.equal(new Set(labels).size, 2,
               'two distinct itemNumbers across three balloons');
}

console.log('[forge.bom-rollup] all tests passed');
