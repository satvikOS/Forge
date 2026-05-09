import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'maintenance');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(60000);

test('GE9X maintenance: schedule + task cards + LLP table', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);

  const data = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { MaintenanceSchedule } = m;
    return {
      all: MaintenanceSchedule.all(),
      llp: MaintenanceSchedule.llpTable(),
      totalLabor: MaintenanceSchedule.totalLaborHours(24000),
      dueAt2000: MaintenanceSchedule.dueAt({ hours: 2000, cycles: 4000, days: 365 }),
      dueAt12000: MaintenanceSchedule.dueAt({ hours: 12000, cycles: 24000, days: 1500 }),
    };
  });

  console.log('\n=== GE9X Maintenance Schedule ===');
  console.log(`Total tasks in library: ${data.all.length}`);
  console.log(`Life-limited parts (LLP): ${data.llp.length}`);
  console.log(`Total labor over 24,000 cycle life: ${data.totalLabor.toFixed(0)} man-hours`);
  console.log(`\nTasks due at 2,000 hours / 4,000 cycles / 1 year:`);
  for (const t of data.dueAt2000) console.log(`  ${t.id.padEnd(15)} ${t.title}`);
  console.log(`\nTasks due at 12,000 hours / 24,000 cycles / 4 years:`);
  for (const t of data.dueAt12000.slice(0, 12)) console.log(`  ${t.id.padEnd(15)} ${t.title}`);

  fs.writeFileSync(path.join(OUT, 'task-library.json'), JSON.stringify(data.all, null, 2));
  fs.writeFileSync(path.join(OUT, 'llp-table.json'), JSON.stringify(data.llp, null, 2));

  // CSV maintenance schedule
  const csv = ['Task ID,Title,Interval Hours,Interval Cycles,Calendar Days,Labor (hr),LLP,EM Reference,Tooling'];
  for (const t of data.all) {
    csv.push([
      t.id,
      `"${t.title}"`,
      t.interval.hours ?? '',
      t.interval.cycles ?? '',
      t.interval.calendar_days ?? '',
      t.laborHours,
      t.llp ? 'YES' : 'no',
      t.emRef,
      `"${t.tooling.join('; ')}"`,
    ].join(','));
  }
  fs.writeFileSync(path.join(OUT, 'maintenance-schedule.csv'), csv.join('\n'));

  // Markdown task cards
  const md = `# GE9X Engine Maintenance Manual — Task Cards

Generated: ${new Date().toISOString()}
Engine: GE Aviation GE9X-105B1A
Reference: GE9X EMM (Engine Maintenance Manual) chapter 72

## Summary

| Metric | Value |
|--------|-------|
| Total task cards | ${data.all.length} |
| Life-limited parts (LLP) | ${data.llp.length} |
| Total scheduled labor over 24,000-cycle life | **${data.totalLabor.toFixed(0)} man-hours** |

## Life-Limited Parts (LLP) Table

Hard cycle limits per FAR 33.70 Critical Parts. Mandatory replacement
regardless of measured condition.

| Part | Cycles | Labor | EM Ref |
|------|--------|-------|--------|
${data.llp.filter(t => t.id.startsWith('LLP')).map(t =>
  `| ${t.title.replace('LLP — ', '')} | ${t.interval.cycles?.toLocaleString() || '—'} | ${t.laborHours} hr | ${t.emRef} |`
).join('\n')}

## All Task Cards

${data.all.map(t => `### ${t.id} — ${t.title}

| Field | Value |
|-------|-------|
| Interval (hours) | ${t.interval.hours ?? '—'} |
| Interval (cycles) | ${t.interval.cycles?.toLocaleString() ?? '—'} |
| Calendar (days) | ${t.interval.calendar_days ?? '—'} |
| Labor | ${t.laborHours} man-hours |
| LLP | ${t.llp ? '**YES — life-limited**' : 'no'} |
| Tooling | ${t.tooling.join('; ')} |
| EM Reference | ${t.emRef} |

${t.description}
`).join('\n---\n')}
`;
  fs.writeFileSync(path.join(OUT, 'MAINTENANCE_MANUAL.md'), md);

  expect(data.all.length).toBeGreaterThan(15);
  expect(data.llp.length).toBeGreaterThanOrEqual(4);
});
