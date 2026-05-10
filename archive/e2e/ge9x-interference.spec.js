import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'interference');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('GE9X interference: detect overlaps between major component groups', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const { PartIDRegistry } = m;
    const GE9XBuilder = builderMod.default;

    PartIDRegistry.reset();
    const ge9x = GE9XBuilder.build();
    const entries = PartIDRegistry.all();

    // Build category-grouped bounding boxes from each part's PartInstance
    const groupBboxes = new Map();
    let validParts = 0;
    for (const e of entries) {
      const pi = e.partInstance;
      if (!pi?.solid) continue;
      try {
        const bbox = pi.boundingBox();
        const minA = bbox.min, maxA = bbox.max;
        if (!isFinite(minA.x)) continue;
        validParts++;
        const key = `${e.category}/${e.subsystem}`;
        if (!groupBboxes.has(key)) {
          groupBboxes.set(key, {
            count: 0,
            min: { x: Infinity, y: Infinity, z: Infinity },
            max: { x: -Infinity, y: -Infinity, z: -Infinity },
          });
        }
        const g = groupBboxes.get(key);
        g.count++;
        g.min.x = Math.min(g.min.x, minA.x);
        g.min.y = Math.min(g.min.y, minA.y);
        g.min.z = Math.min(g.min.z, minA.z);
        g.max.x = Math.max(g.max.x, maxA.x);
        g.max.y = Math.max(g.max.y, maxA.y);
        g.max.z = Math.max(g.max.z, maxA.z);
      } catch {}
    }

    // Pairwise check between group bboxes
    const groups = Array.from(groupBboxes.entries());
    const overlaps = [];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const [keyA, A] = groups[i], [keyB, B] = groups[j];
        const overlapsBox = !(A.max.x < B.min.x || A.min.x > B.max.x ||
                              A.max.y < B.min.y || A.min.y > B.max.y ||
                              A.max.z < B.min.z || A.min.z > B.max.z);
        if (!overlapsBox) continue;
        // Compute overlap volume
        const ox = Math.max(0, Math.min(A.max.x, B.max.x) - Math.max(A.min.x, B.min.x));
        const oy = Math.max(0, Math.min(A.max.y, B.max.y) - Math.max(A.min.y, B.min.y));
        const oz = Math.max(0, Math.min(A.max.z, B.max.z) - Math.max(A.min.z, B.min.z));
        const overlapVol = ox * oy * oz;
        if (overlapVol < 1e-6) continue;
        overlaps.push({
          a: keyA, b: keyB,
          aCount: A.count, bCount: B.count,
          overlapVolume_m3: +overlapVol.toFixed(4),
          overlapBox: {
            x: [Math.max(A.min.x, B.min.x), Math.min(A.max.x, B.max.x)],
            y: [Math.max(A.min.y, B.min.y), Math.min(A.max.y, B.max.y)],
            z: [Math.max(A.min.z, B.min.z), Math.min(A.max.z, B.max.z)],
          },
        });
      }
    }

    // Categorize: is the overlap expected (e.g. shaft through disk hole)
    // or a bug? Flag the suspicious ones.
    const SUSPICIOUS_PATTERNS = [
      // Blade should not overlap with anything outside its own subsystem
      ['BLD', 'CSG'],
      ['BLD', 'STA'],
      ['BLD', 'BLD'],  // different category blades shouldn't overlap
    ];

    overlaps.sort((a, b) => b.overlapVolume_m3 - a.overlapVolume_m3);

    return {
      totalComponents: entries.length,
      validParts,
      groupCount: groups.length,
      overlapsFound: overlaps.length,
      top20: overlaps.slice(0, 20),
    };
  });

  console.log('\n=== Interference Check ===');
  console.log(`Components with valid solids: ${result.validParts.toLocaleString()}`);
  console.log(`Category/subsystem groups: ${result.groupCount}`);
  console.log(`Group-pair overlaps: ${result.overlapsFound}`);
  console.log('\nTop 20 overlaps by volume (group bbox-level — most are expected, like shaft passing through disk):');
  for (const o of result.top20) {
    console.log(`  ${o.overlapVolume_m3.toFixed(4)} m³   ${o.a.padEnd(12)} (${o.aCount.toString().padStart(5)} parts) ↔ ${o.b.padEnd(12)} (${o.bCount.toString().padStart(5)} parts)`);
  }

  fs.writeFileSync(path.join(OUT, 'interference-report.json'), JSON.stringify(result, null, 2));

  const md = `# GE9X Interference Detection Report

Generated: ${new Date().toISOString()}

## Method

Group every component by category/subsystem, compute the union bounding
box per group, then perform pairwise AABB overlap check on the
${result.groupCount} groups.

A bbox-level overlap doesn't mean physical interference — most of these
are expected (the LP shaft passes through every disk's bore, casings
enclose blades). The list below is for triage: anomalously large
overlaps between groups that *shouldn't* coexist suggest a positioning
bug.

## Summary

| Metric | Value |
|--------|-------|
| Components with valid solids | ${result.validParts.toLocaleString()} |
| Category/subsystem groups | ${result.groupCount} |
| Group-pair AABB overlaps | ${result.overlapsFound} |

## Top 20 overlaps (by volume)

| Volume (m³) | Group A | Count | Group B | Count |
|-------------|---------|-------|---------|-------|
${result.top20.map(o =>
  `| ${o.overlapVolume_m3.toFixed(4)} | ${o.a} | ${o.aCount} | ${o.b} | ${o.bCount} |`
).join('\n')}
`;
  fs.writeFileSync(path.join(OUT, 'INTERFERENCE_REPORT.md'), md);

  expect(result.validParts).toBeGreaterThan(20000);
});
