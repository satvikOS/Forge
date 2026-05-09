import { test, expect } from '@playwright/test';

test.setTimeout(120000);

test('PartIDRegistry: register, lookup, search, tree, stats', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PartIDRegistry, Assembly, PrimitiveBuilder } = m;

    PartIDRegistry.reset();
    PartIDRegistry.setProject('GE9X');

    const asm = new Assembly('GE9X Test Engine');

    const fanHub = asm.addPart(
      PrimitiveBuilder.cylinder(0.5, 0.3, 32),
      'Fan Hub',
      { category: 'FAN', subsystem: 'HUB', material: 'Titanium Ti-6Al-4V' }
    );
    const fanHubID = fanHub.partID;

    const blades = [];
    for (let i = 0; i < 16; i++) {
      const b = asm.addPart(
        PrimitiveBuilder.box(0.05, 0.4, 0.02),
        `Fan Blade ${i + 1}`,
        {
          category: 'FAN',
          subsystem: 'BLD',
          material: 'Composite Carbon-Epoxy',
          parentID: fanHubID,
          metadata: { stage: 1, position: i },
        }
      );
      blades.push(b.partID);
    }

    for (let i = 0; i < 76; i++) {
      asm.addPart(
        PrimitiveBuilder.box(0.03, 0.08, 0.015),
        `HPT Blade ${i + 1}`,
        {
          category: 'HPT',
          subsystem: 'BLD',
          material: 'Inconel 718',
          metadata: { stage: 1, position: i, coated: 'TBC' },
        }
      );
    }

    PartIDRegistry.attachAnalysis(blades[0], {
      type: 'FEA',
      maxStress: 866e6,
      safetyFactor: 1.02,
      loadCase: 'bird strike 1.8kg @ 250m/s',
    });
    PartIDRegistry.attachTest(blades[0], {
      scenario: 'Bird Strike (FAR 33.76)',
      result: 'PASS',
      damageZone: 'tip 12% chord, no penetration',
    });
    PartIDRegistry.recordRevision(blades[0], 'Initial release', 'satvik');

    return {
      total: PartIDRegistry.size(),
      stats: PartIDRegistry.stats(),
      sampleBladeID: blades[0],
      sampleBlade: PartIDRegistry.get(blades[0]),
      fanCategory: PartIDRegistry.byCategory('FAN').length,
      bladesSubsystem: PartIDRegistry.bySubsystem('BLD').length,
      titaniumParts: PartIDRegistry.byMaterial('Titanium Ti-6Al-4V').length,
      searchHub: PartIDRegistry.search('hub').length,
      tree: PartIDRegistry.tree().slice(0, 3),
      hubChildren: PartIDRegistry.descendants(fanHubID).length,
    };
  });

  console.log('\n=== PartIDRegistry Test ===');
  console.log(`Total registered: ${result.total}`);
  console.log(`Project: ${result.stats.project}`);
  console.log(`By category: ${JSON.stringify(result.stats.byCategory)}`);
  console.log(`By subsystem: ${JSON.stringify(result.stats.bySubsystem)}`);
  console.log(`Sample blade ID: ${result.sampleBladeID}`);
  console.log(`Sample blade has ${result.sampleBlade.tests.length} tests, ${result.sampleBlade.analyses.length} analyses, ${result.sampleBlade.revisions.length} revisions`);
  console.log(`Fan category count: ${result.fanCategory}`);
  console.log(`Blades subsystem count: ${result.bladesSubsystem}`);
  console.log(`Hub children: ${result.hubChildren}`);

  expect(result.total).toBe(93);
  expect(result.fanCategory).toBe(17);
  expect(result.bladesSubsystem).toBe(92);
  expect(result.sampleBladeID).toMatch(/^GE9X-FAN-BLD-\d{4}$/);
  expect(result.sampleBlade.tests.length).toBe(1);
  expect(result.sampleBlade.analyses.length).toBe(1);
  expect(result.sampleBlade.revisions.length).toBe(1);
  expect(result.hubChildren).toBe(16);
});
