import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'platform-tests', 'foundation');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(300000);

test('Platform foundation: registry + recorder + tests + exporter integration', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const {
      PartIDRegistry, InteractionRecorder, ProjectExporter,
      TestScenarios, RealWorldTestRunner,
      Assembly, PrimitiveBuilder,
    } = m;

    PartIDRegistry.reset();
    PartIDRegistry.setProject('GE9X');
    InteractionRecorder.reset();
    InteractionRecorder.start({ project: 'GE9X', user: 'satvik' });

    const asm = new Assembly('GE9X Foundation Test');

    // Build a small but realistic assembly
    const fanHub = asm.addPart(
      PrimitiveBuilder.cylinder(0.4, 0.3, 32),
      'Fan Hub Disk',
      { category: 'FAN', subsystem: 'HUB', material: 'Titanium Ti-6Al-4V' }
    );
    const fanHubID = fanHub.partID;

    for (let i = 0; i < 16; i++) {
      asm.addPart(
        PrimitiveBuilder.box(0.05, 0.4, 0.02),
        `Fan Blade ${i + 1}`,
        {
          category: 'FAN', subsystem: 'BLD',
          material: 'Composite Carbon-Epoxy',
          parentID: fanHubID,
          metadata: { stage: 1, position: i },
        }
      );
    }
    for (let i = 0; i < 76; i++) {
      asm.addPart(
        PrimitiveBuilder.box(0.03, 0.08, 0.015),
        `HPT Blade S1-${i + 1}`,
        {
          category: 'HPT', subsystem: 'BLD',
          material: 'Single-Crystal Nickel CMSX-4',
          metadata: { stage: 1, coated: 'TBC' },
        }
      );
    }
    asm.addPart(
      PrimitiveBuilder.cylinder(0.6, 0.05, 32),
      'HPT Casing',
      { category: 'HPT', subsystem: 'CSG', material: 'Inconel 718' }
    );

    InteractionRecorder.recordToolInvoke('addPart', { count: asm.parts.length });

    // Run a campaign on blade subsystem
    const campaign = await RealWorldTestRunner.runCampaign({
      scenarios: ['rotor_overspeed', 'fatigue_hcf', 'thermal_cycle'],
      filter: e => e.subsystem === 'BLD',
      maxParts: 5,
    });

    // Build file tree
    const exportTree = ProjectExporter.buildFileTree({
      includeGeometry: false,  // skip STL to keep test fast
    });

    const session = InteractionRecorder.stop();

    return {
      registered: PartIDRegistry.size(),
      categories: PartIDRegistry.stats().byCategory,
      campaignTotalRuns: campaign.totalRuns,
      campaignPass: campaign.pass,
      campaignFail: campaign.fail,
      filesEmitted: exportTree.files.size,
      manifest: exportTree.manifest,
      sampleFiles: Array.from(exportTree.files.keys()).slice(0, 20),
      sessionEvents: session.eventCount,
      bomEntries: JSON.parse(exportTree.files.get('bom.json')).length,
    };
  });

  console.log('\n=== Platform Foundation Integration ===');
  console.log(`Registered components: ${result.registered}`);
  console.log(`Categories: ${JSON.stringify(result.categories)}`);
  console.log(`Test campaign runs: ${result.campaignTotalRuns} (pass=${result.campaignPass}, fail=${result.campaignFail})`);
  console.log(`Files emitted: ${result.filesEmitted}`);
  console.log(`BOM unique entries: ${result.bomEntries}`);
  console.log(`Session events recorded: ${result.sessionEvents}`);
  console.log(`Sample files:\n  ${result.sampleFiles.join('\n  ')}`);

  fs.writeFileSync(path.join(OUT, 'foundation-summary.json'), JSON.stringify(result, null, 2));

  expect(result.registered).toBe(94);
  expect(result.campaignTotalRuns).toBe(15); // 3 scenarios × 5 parts
  expect(result.filesEmitted).toBeGreaterThan(94);
  expect(result.sessionEvents).toBeGreaterThan(0);
});
