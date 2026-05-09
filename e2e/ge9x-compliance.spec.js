import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'compliance');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(600000);

test('GE9X compliance: FAR Part 33 verification report', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const report = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const { PartIDRegistry, RealWorldTestRunner, ComplianceMatrix } = m;
    const GE9XBuilder = builderMod.default;

    PartIDRegistry.reset();
    const ge9x = GE9XBuilder.build();

    // Run a representative test campaign hitting all FAR-required scenarios
    await RealWorldTestRunner.runCampaign({
      scenarios: [
        'bird_strike', 'fod_ingestion', 'hail_ingestion',
        'rotor_overspeed', 'fatigue_hcf', 'thermal_cycle',
        'vibration_random', 'load_static', 'blade_off',
        'lightning_strike',
      ],
      filter: e => ['BLD', 'DSK', 'CSG', 'NGV', 'HUB', 'LIN', 'CAS', 'ACT', 'NAC'].includes(e.subsystem),
      maxParts: 20,
    });

    return ComplianceMatrix.buildReport(PartIDRegistry);
  });

  console.log('\n=== FAR Part 33 / CS-E Compliance ===');
  console.log(`Total requirements: ${report.totalItems}`);
  console.log(`Verified: ${report.verified}, Partial: ${report.partial}, Unverified: ${report.unverified}`);
  console.log(`Coverage: ${report.coveragePercent}%\n`);

  for (const it of report.items) {
    const tag = it.status === 'VERIFIED' ? '✓ VERIFIED'
      : it.status === 'FAILED' ? '✗ FAILED'
      : it.status === 'MIXED' ? '~ MIXED'
      : '· UNVERIFIED';
    console.log(`  ${tag.padEnd(14)} ${it.code.padEnd(8)} ${it.title}`);
    if (it.evidenceCount) {
      console.log(`                            ${it.passes} pass / ${it.fails} fail across ${it.evidenceCount} test runs`);
    }
  }

  fs.writeFileSync(path.join(OUT, 'compliance-report.json'), JSON.stringify(report, null, 2));

  // Markdown
  const md = `# GE9X — FAR Part 33 / EASA CS-E Compliance Report

Generated: ${report.generatedAt}
Engine: GE Aviation GE9X-105B1A
Regulation: ${report.regulation}

## Summary

| Status | Count |
|--------|-------|
| **VERIFIED** | ${report.verified} |
| Partial / Mixed | ${report.partial} |
| Unverified | ${report.unverified} |
| **Total** | ${report.totalItems} |
| **Coverage** | **${report.coveragePercent}%** |

## Requirements Matrix

| § Code | Title | Scenarios | Status | Pass / Fail / Total |
|--------|-------|-----------|--------|---------------------|
${report.items.map(it =>
  `| ${it.code} | ${it.title} | ${it.scenarios.join(', ')} | ${it.status} | ${it.passes} / ${it.fails} / ${it.evidenceCount} |`
).join('\n')}

## Evidence Detail

${report.items.map(it => `### § ${it.code} — ${it.title}

**Description:** ${it.description}

**Pass criteria:** ${it.passCriteria}

**Status:** ${it.status} (${it.evidenceCount} test runs against ${it.targetSubsystems.length} subsystem types)

${it.evidence.length > 0 ? `**Sample evidence:**

| Part ID | Scenario | Result | Standard |
|---------|----------|--------|----------|
${it.evidence.slice(0, 5).map(e => `| ${e.partID} | ${e.scenario} | ${e.result} | ${e.standard} |`).join('\n')}
` : '_No test evidence yet — run additional campaigns._'}
`).join('\n---\n')}
`;
  fs.writeFileSync(path.join(OUT, 'COMPLIANCE_REPORT.md'), md);

  console.log(`\nReport: ${path.join(OUT, 'COMPLIANCE_REPORT.md')}`);
  expect(report.verified).toBeGreaterThan(0);
});
