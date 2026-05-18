import { test, expect } from '@playwright/test';
import { buildReportMarkdown } from '../frontend/src/ai/sculptor/DeliverablePackage.js';

const COMPONENTS = [
  { id: 'c1', name: 'Watch Case', volume: 10933, accepted: false, stepBytes: 1307962 },
  { id: 'c2', name: 'Caseback', volume: 2246, accepted: false, stepBytes: 547826 },
  { id: 'c5', name: 'Dial', volume: 330, accepted: true, stepBytes: 183301 },
];

test.describe('DeliverablePackage — buildReportMarkdown', () => {
  test('the report has a title and an honest summary line', () => {
    const md = buildReportMarkdown(COMPONENTS, { product: 'Omega Seamaster' });
    expect(md).toContain('Omega Seamaster');
    expect(md).toContain('Build Report');
    expect(md).toContain('3');
    expect(md).toContain('1');
  });

  test('the report lists every component with its status', () => {
    const md = buildReportMarkdown(COMPONENTS, { product: 'Omega Seamaster' });
    for (const c of COMPONENTS) {
      expect(md).toContain(c.id);
      expect(md).toContain(c.name);
    }
    expect(md).toContain('best-effort');
    expect(md).toContain('verified');
  });

  test('the report states what is NOT included and why', () => {
    const md = buildReportMarkdown(COMPONENTS, { product: 'Omega Seamaster' });
    expect(md.toLowerCase()).toContain('not included');
  });

  test('an empty component list still produces a valid report', () => {
    const md = buildReportMarkdown([], { product: 'X' });
    expect(typeof md).toBe('string');
    expect(md.length).toBeGreaterThan(0);
  });
});
