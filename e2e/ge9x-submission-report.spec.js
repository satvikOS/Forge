import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(process.cwd(), 'engine-output', 'GE9X');

test.setTimeout(180000);

test('GE9X submission HTML report — single self-contained deliverable', async ({ page }) => {
  // Read existing artifacts
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const masterDrawingSVG = fs.existsSync(path.join(ROOT, 'assembly', 'master-assembly-drawing.svg'))
    ? fs.readFileSync(path.join(ROOT, 'assembly', 'master-assembly-drawing.svg'), 'utf8')
    : '';
  const mbom = JSON.parse(fs.readFileSync(path.join(ROOT, 'assembly', 'MBOM.json'), 'utf8'));
  const takeoff = JSON.parse(fs.readFileSync(path.join(ROOT, 'performance', 'brayton-takeoff.json'), 'utf8'));
  const cruise = JSON.parse(fs.readFileSync(path.join(ROOT, 'performance', 'brayton-cruise.json'), 'utf8'));
  const noise = JSON.parse(fs.readFileSync(path.join(ROOT, 'acoustics', 'noise-cert.json'), 'utf8')).noise;
  const compliance = JSON.parse(fs.readFileSync(path.join(ROOT, 'certification', 'far-33-compliance.json'), 'utf8'));
  const tasks = JSON.parse(fs.readFileSync(path.join(ROOT, 'maintenance', 'tasks.json'), 'utf8'));
  const llp = JSON.parse(fs.readFileSync(path.join(ROOT, 'maintenance', 'llp-table.json'), 'utf8'));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);

  const html = await page.evaluate(async (params) => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const { PartIDRegistry, SubmissionReport } = m;
    const GE9XBuilder = builderMod.default;

    // Need to populate registry so SubmissionReport can list LLP parts
    PartIDRegistry.reset();
    GE9XBuilder.build();

    return SubmissionReport.build({
      project: 'GE9X',
      title: 'GE Aviation GE9X-105B1A — Production Article Submission',
      submissionType: 'FAA Part 21 Production Approval (Aircraft Engine)',
      manifest: params.manifest,
      masterDrawingSVG: params.masterDrawingSVG,
      bom: params.mbom,
      performance: { takeoff: params.takeoff, cruise: params.cruise },
      noise: params.noise,
      compliance: params.compliance,
      maintenance: {
        tasks: params.tasks, llp: params.llp,
        totalLaborOver24kCycles: params.tasks.reduce((s, t) =>
          s + (t.interval?.cycles ? Math.floor(24000 / t.interval.cycles) * t.laborHours : 0), 0),
      },
      llp: params.llp,
    });
  }, { manifest, masterDrawingSVG, mbom, takeoff, cruise, noise, compliance, tasks, llp });

  fs.writeFileSync(path.join(ROOT, 'GE9X-Submission-Report.html'), html);
  const sizeKB = (html.length / 1024).toFixed(0);
  console.log(`\nSubmission HTML report: ${sizeKB} KB`);
  console.log(`Path: ${path.join(ROOT, 'GE9X-Submission-Report.html')}`);

  expect(html.length).toBeGreaterThan(50000);
  expect(html.includes('GE9X')).toBe(true);
  expect(html.includes('FAA Part 21')).toBe(true);
});
