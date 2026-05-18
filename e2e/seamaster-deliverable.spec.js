/**
 * e2e/seamaster-deliverable.spec.js
 *
 * Node-mode Playwright spec: gathers on-disk Seamaster component STEP files,
 * generates the honest BUILD_REPORT via DeliverablePackage, and zips
 * everything using ArchDisc's ZipArchive (makeZip).
 *
 * All 22 manifest components are marked accepted: false — that is the honest
 * recorded outcome of the autonomous build. The SM-001-case-back-ring.step
 * extra file is included in the ZIP as a supplemental artefact.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { buildReportMarkdown } from '../frontend/src/ai/sculptor/DeliverablePackage.js';
import { makeZip } from '../frontend/src/foundation/ZipArchive.js';

const COMPONENTS_DIR = path.resolve('autonomous-output/seamaster/components');
const MANIFEST_PATH  = path.resolve('autonomous-output/seamaster/manifest.json');
const REPORT_PATH    = path.resolve('autonomous-output/seamaster/BUILD_REPORT.md');
const ZIP_PATH       = path.resolve('autonomous-output/seamaster/Omega-Seamaster-deliverable.zip');

test('Seamaster deliverable — build report + ZIP', () => {
  // ── 1. Read all .step files ──────────────────────────────────────────────
  const stepFiles = fs.readdirSync(COMPONENTS_DIR)
    .filter((f) => f.endsWith('.step'))
    .sort();

  // ── 2. Read manifest ──────────────────────────────────────────────────────
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const manifestById = Object.fromEntries(manifest.map((m) => [m.id, m]));

  // ── 3. Build components array ─────────────────────────────────────────────
  const components = stepFiles.map((filename) => {
    // Derive id: everything before '--', or 'SM-001' for the SM-001-... file
    let id;
    if (filename.startsWith('SM-001')) {
      id = 'SM-001';
    } else {
      id = filename.split('--')[0];
    }

    // Derive name: from manifest if available, else from filename
    let name;
    if (manifestById[id]) {
      name = manifestById[id].name;
    } else {
      // e.g. "SM-001-case-back-ring.step" → "Case Back Ring"
      // Strip the leading id prefix (e.g. "SM-001-") and capitalise words
      name = filename.replace(/\.step$/i, '')
        .replace(/^SM-\d+-/, '')      // remove "SM-001-" prefix
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
      if (!name) name = id;
    }

    const fullPath = path.join(COMPONENTS_DIR, filename);
    const stepBytes = fs.statSync(fullPath).size;

    return {
      id,
      name,
      volume: 0,          // not persisted to disk — do not fabricate
      accepted: false,    // honest recorded outcome: all best-effort
      stepBytes,
    };
  });

  // ── 4. Generate the build report ─────────────────────────────────────────
  const reportText = buildReportMarkdown(components, { product: 'Omega Seamaster' });
  fs.writeFileSync(REPORT_PATH, reportText, 'utf8');

  // ── 5. Build ZIP ──────────────────────────────────────────────────────────
  const zipEntries = stepFiles.map((filename) => ({
    path: `components/${filename}`,
    data: fs.readFileSync(path.join(COMPONENTS_DIR, filename)),
  }));
  zipEntries.push({
    path: 'BUILD_REPORT.md',
    data: Buffer.from(reportText, 'utf8'),
  });

  const zipBuf = makeZip(zipEntries);
  fs.writeFileSync(ZIP_PATH, zipBuf);

  // ── 6. Assertions ─────────────────────────────────────────────────────────
  expect(fs.existsSync(ZIP_PATH)).toBe(true);
  expect(zipBuf.length).toBeGreaterThan(1024);

  expect(fs.existsSync(REPORT_PATH)).toBe(true);
  expect(reportText).toContain('Omega Seamaster');
  expect(reportText).toContain('best-effort');

  expect(components.length).toBeGreaterThan(0);

  // ── 7. Console output ─────────────────────────────────────────────────────
  console.log(`  component count: ${components.length}`);
  console.log(`  ZIP byte size:   ${zipBuf.length}`);

  // Extract and print the Summary section
  const summaryMatch = reportText.match(/## Summary\n([\s\S]*?)(?=\n##)/);
  const summarySection = summaryMatch ? summaryMatch[1].trim() : '(not found)';
  console.log(`  Summary:\n${summarySection}`);
});
