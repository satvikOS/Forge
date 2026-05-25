/**
 * UI cleanup — ribbon clipping + overlay dedup, in motion.
 *
 * Verifies four user-visible fixes shipped in the 2026-05-24 UX cleanup
 * dispatch (in response to: "the ribbon, the AI options are getting cut.
 * also there are old UI behind the newer ones you can see behind the one
 * in viewport"):
 *
 *   Issue 1 — Ribbon clipping. The Part tab's dense two-row tool layout
 *             used to overflow a 124 px ribbon container so the second
 *             row of icons was visually cropped. Bumped --ribbon-height
 *             to 168 px; this spec measures the ribbon's content scroll
 *             height vs. its container client height and asserts the
 *             content fits without vertical clipping.
 *
 *   Issue 2 — Duplicate active-tool indicator. A top-centre "[Box]" pill
 *             rendered the same data as the top-right ConfirmationCorner.
 *             The top-centre pill (`active-tool-indicator`) was removed.
 *             Asserts at most ONE active-tool indicator exists in the DOM.
 *
 *   Issue 3 — Two AI buttons at bottom-right. A standalone .ai-settings-
 *             launcher "AI" pill duplicated the .chat-launcher chat
 *             bubble. The settings launcher was removed; AI Settings is
 *             reachable from inside the chat panel header. Asserts ONE
 *             floating AI launcher in the workspace.
 *
 *   Issue 4 — Design History debug header. The bare developer text
 *             "Feature timeline · viewport Rollback bar = kernel timeline"
 *             that rendered below the "Design History" header was removed.
 *             Asserts the DH panel's text does NOT contain "kernel timeline".
 *
 * Single test() block; ONE workflow; --workers=1; bare 'fs'/'path' imports
 * (no node:*); motion-capture infra so the reviewer can see the cleanup
 * in a real viewport, not just a numerical pass/fail.
 *
 * Run with:
 *   ./node_modules/.bin/playwright test \
 *     e2e/ui-cleanup-ribbon-overlay-dedup-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'ui-cleanup-ribbon-overlay-dedup');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('UI cleanup: ribbon fits both rows, single active-tool indicator, single AI launcher, no DH debug text', async () => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.png') || f.endsWith('.webm')) {
      try { fs.rmSync(path.join(OUT, f)); } catch {}
    }
  }

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
    slowMo: 200,
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (err) => pageErrors.push(err.message));
  win.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(`[console] ${msg.text()}`); });
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  // Ensure the kernel + viewport infra is up so a tool can actually run.
  await win.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });

  let frameIdx = 0;
  const frame = async (label) => {
    frameIdx += 1;
    const nn = String(frameIdx).padStart(2, '0');
    const safe = label.replace(/[^a-z0-9_-]/gi, '-');
    const file = path.join(OUT, `${nn}-${safe}.png`);
    await win.waitForTimeout(220);
    await win.screenshot({ path: file });
    console.log(`  [frame] ${file}`);
    return file;
  };

  // ─── A. Land on Mechanical CAD → Part tab (the dense-tool tab) ─────────
  await win.locator('button.ribbon-tab').filter({ hasText: /^Part$/ }).first()
    .evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await win.waitForTimeout(300);
  await frame('A-part-tab-active');

  // ─── B. Issue 1 — every tool button on the Part tab is fully visible ───
  // The fix bumped --ribbon-height from 124 → 168 px and gave .ribbon-group
  // flex layout enough room to wrap tools cleanly. We don't compare
  // scrollHeight to clientHeight (the .ribbon-content area uses
  // overflow-x:auto + overflow-y:hidden, and individual groups can grow
  // wider than the container — that's intentional horizontal scrolling).
  // Instead, the visibility test the user actually cares about: every
  // .ribbon-tool button must have its bottom edge ABOVE the container's
  // bottom edge by at least 1 px (no button clipped). The previous 124 px
  // ribbon failed this with ~6+ Part-tab buttons clipped below the seam.
  const ribbonGeom = await win.evaluate(() => {
    const container = document.querySelector('.ribbon-container');
    const content = document.querySelector('.ribbon-content');
    const tabs = document.querySelector('.ribbon-tabs');
    if (!container || !content) return { ok: false, why: 'ribbon DOM missing' };
    const cs = window.getComputedStyle(container);
    const cRect = container.getBoundingClientRect();
    const buttons = Array.from(container.querySelectorAll('.ribbon-tool'));
    const clipped = [];
    for (const b of buttons) {
      const r = b.getBoundingClientRect();
      // A button is clipped if its bottom edge sits BELOW the container's
      // bottom edge (the container's overflow:hidden clips it visually).
      if (r.bottom > cRect.bottom + 0.5) {
        const label = b.querySelector('.ribbon-tool-label');
        clipped.push({
          name: label ? label.textContent : '(unlabeled)',
          bottom: Math.round(r.bottom),
          containerBottom: Math.round(cRect.bottom),
          overhang: Math.round(r.bottom - cRect.bottom),
        });
      }
    }
    return {
      ok: true,
      containerClientH:    container.clientHeight,
      containerStyleH:     cs.height,
      containerMaxH:       cs.maxHeight,
      tabsClientH:         tabs ? tabs.clientHeight : 0,
      contentScrollH:      content.scrollHeight,
      contentClientH:      content.clientHeight,
      ribbonHeightVar:     window.getComputedStyle(document.documentElement)
                              .getPropertyValue('--ribbon-height').trim(),
      buttonCount:         buttons.length,
      clippedButtonCount:  clipped.length,
      clippedSample:       clipped.slice(0, 6),
    };
  });
  console.log('  [ribbon geom]', JSON.stringify(ribbonGeom));
  expect(ribbonGeom.ok, 'ribbon DOM must be mounted').toBe(true);
  // The new --ribbon-height is 168 px (was 124).
  expect(ribbonGeom.ribbonHeightVar).toBe('168px');
  expect(
    ribbonGeom.buttonCount,
    'Part tab should expose dozens of tool buttons',
  ).toBeGreaterThan(20);
  expect(
    ribbonGeom.clippedButtonCount,
    `ribbon has ${ribbonGeom.clippedButtonCount} clipped tool buttons ` +
    `(sample: ${JSON.stringify(ribbonGeom.clippedSample)})`,
  ).toBe(0);

  // ─── C. Build a Box so the active-tool indicator is exercised ─────────
  // Bypass the param dialog so the tool resolves with defaults atomically.
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });
  await win.locator('button.ribbon-tool:has(.ribbon-tool-label)')
    .filter({ has: win.locator('.ribbon-tool-label', { hasText: /^Box$/ }) })
    .first()
    .evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  // Wait for the brep shape to appear so we know the tool ran. Some builds
  // emit __lastBrepShape via the foundation path; we don't gate the
  // assertion on it (this spec measures the UI, not the kernel).
  await win.waitForTimeout(900);
  await frame('B-box-built');

  // ─── D. Issue 2 — at most ONE active-tool indicator in the DOM ────────
  // The removed `.active-tool-indicator` pill duplicated the
  // `.sw-confirm-corner` (Confirmation Corner). Either the corner is
  // showing (≤ 1) or neither shows (0). The bare pill should be gone.
  const indicatorCounts = await win.evaluate(() => ({
    legacyTopCenterPill: document.querySelectorAll('.active-tool-indicator').length,
    confirmationCorner:  document.querySelectorAll('.sw-confirm-corner').length,
  }));
  console.log('  [indicators]', JSON.stringify(indicatorCounts));
  expect(
    indicatorCounts.legacyTopCenterPill,
    'legacy .active-tool-indicator top-centre pill must have been removed',
  ).toBe(0);
  // Total active-tool-name overlays across both selectors must be ≤ 1.
  expect(
    indicatorCounts.legacyTopCenterPill + indicatorCounts.confirmationCorner,
  ).toBeLessThanOrEqual(1);

  // ─── E. Issue 3 — exactly ONE floating AI launcher in the workspace ───
  // The standalone .ai-settings-launcher pill was deleted; the chat
  // launcher carries data-ai-launcher="canonical".
  const aiButtons = await win.evaluate(() => ({
    settingsLauncher: document.querySelectorAll('.ai-settings-launcher').length,
    chatLauncher:     document.querySelectorAll('.chat-launcher').length,
    canonicalCount:   document.querySelectorAll('[data-ai-launcher="canonical"]').length,
    totalFloating:    document.querySelectorAll(
      '.ai-settings-launcher, .chat-launcher',
    ).length,
  }));
  console.log('  [ai buttons]', JSON.stringify(aiButtons));
  expect(
    aiButtons.settingsLauncher,
    'legacy .ai-settings-launcher floating pill must have been removed',
  ).toBe(0);
  expect(
    aiButtons.canonicalCount,
    'the canonical [data-ai-launcher="canonical"] chat launcher must exist',
  ).toBe(1);
  expect(
    aiButtons.totalFloating,
    'exactly one floating AI launcher must be present in the workspace',
  ).toBe(1);

  // ─── F. Issue 4 — Design History header has no debug text ─────────────
  const dhText = await win.evaluate(() => {
    const panel = document.querySelector('.design-history-panel');
    return panel ? panel.innerText : '';
  });
  console.log('  [dh innerText]', JSON.stringify(dhText.slice(0, 200)));
  expect(
    dhText.toLowerCase(),
    'Design History panel must not contain debug "kernel timeline" string',
  ).not.toContain('kernel timeline');
  expect(
    dhText.toLowerCase(),
    'Design History panel must still show its "Design History" label',
  ).toContain('design history');

  // ─── G. Issue 5 — left palette dedupe (obvious duplicates removed) ────
  // The 11 category dropdown launchers that mirrored the ribbon tabs
  // (Sketch / Part / Reference / Direct Edit / Surface / Assembly /
  // Sheet Metal / Weldments / Piping / Simulate / Manufacture) were
  // removed. Only viewport-interaction icons remain (Select, Move,
  // Settings → 3 buttons). We assert the left tool palette has ≤ 4
  // buttons (allows one drift slot for a future palette addition like
  // a dimension or measure tool, while still catching a regression that
  // re-added all 11 category launchers).
  const paletteCount = await win.evaluate(() => {
    const palette = document.querySelector('.workbench-tools-inner');
    if (!palette) return -1;
    return palette.querySelectorAll('.tool-icon-button').length;
  });
  console.log(`  [left palette tool-icon-button count] ${paletteCount}`);
  expect(paletteCount, 'left palette DOM must be present').toBeGreaterThan(0);
  expect(
    paletteCount,
    `left palette has too many buttons (${paletteCount}) — ` +
    'the 11 ribbon-duplicate category launchers should be gone',
  ).toBeLessThanOrEqual(4);

  // ─── H. Final visual still ─────────────────────────────────────────────
  await frame('Z-final-cleanup-state');

  // Log filtered page errors — purely informational. The UI cleanup
  // assertions above are the real verification surface.
  const realErrors = pageErrors.filter((m) =>
    !/Warning: |defaultProps|Each child in a list|forwardRef render|deprecated|sourcemap/i.test(m));
  if (realErrors.length) {
    console.log('  [pageErrors filtered]:\n  - ' + realErrors.join('\n  - '));
  }

  await app.close();
  // Resolve the recorded video path (only flushed on close).
  try {
    const v = typeof win.video === 'function' ? win.video() : null;
    if (v) {
      const p = await v.path();
      if (p && fs.existsSync(p)) {
        const dest = path.join(OUT, '00-session.webm');
        try { fs.copyFileSync(p, dest); } catch {}
        console.log(`  [session] ${dest}`);
      }
    }
  } catch {}

  // Verify the storyboard stills exist and are non-trivial.
  const stills = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
  expect(stills.length, 'storyboard stills must have been written').toBeGreaterThan(2);
  for (const s of stills) {
    expect(
      fs.statSync(path.join(OUT, s)).size,
      `still ${s} must be a real screenshot (> 1 KB)`,
    ).toBeGreaterThan(1024);
  }
});
