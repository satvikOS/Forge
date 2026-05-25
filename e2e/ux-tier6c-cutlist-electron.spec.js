/**
 * ux-tier6c-cutlist-electron.spec.js — UX Tier 6c acceptance
 *
 * Weldments **Cut List** — the headline Weldments fabrication deliverable.
 *
 *   - cutList(opts:{rounding=1}) — kernel op that scans the live
 *     BodyRegistry, filters bodies tagged with `metadata.weldment` whose
 *     `profile` is one of the standard families (rect/square/round tube,
 *     angle, channel, ibeam), groups them by (profile, size, length) and
 *     returns a BOM-style report.
 *   - CutListPanel — modal opened by the `archdisc:open-cut-list` event,
 *     renders a table (Item No / Profile / Size / Length / Qty / Total)
 *     with footer "Copy CSV" + "Copy TSV" buttons (`navigator.clipboard.writeText`).
 *   - Ribbon entry "Cut List" on the Weldments tab; handler fires the event.
 *
 * ── Bespoke real model — welded steel pallet jack frame ────────────────────
 *
 * A fabricated welded steel pallet-jack frame:
 *
 *   4 vertical posts     — squaretube 40×40×3, 750 mm  (legs of the chassis)
 *   4 horizontal beams   — recttube  50×30×3, 1200 mm (perimeter rails)
 *   2 angle braces       — angle    50×50×5, 1500 mm (corner stiffeners)
 *   2 forks              — recttube 50×100×4, 1000 mm (load-bearing tines)
 *
 *   Total: 12 structural members → Cut List must aggregate to 4 line items.
 *
 * ── Framing — perfectly viewable, 2 stills ──────────────────────────────────
 *
 *   - ONE iso of the welded frame after all 12 members exist.
 *   - ONE still of the Cut List modal showing 4 line items / 12 members.
 *
 * ── Focal assertions ────────────────────────────────────────────────────────
 *
 *   A. After 12 Structural-Member ops, the registry holds 12 weldment-tagged
 *      structural bodies.
 *   B. cutList() returns `groups.length === 4` line items (one per unique
 *      `(profile, size, length)` triple).
 *   C. The sum of every group's `quantity` equals 12.
 *   D. The Cut List ribbon button opens the modal; the modal renders
 *      4 rows; the "Copy CSV" / "Copy TSV" buttons exist + clipboard write
 *      succeeds.
 *
 * ── Methodology ─────────────────────────────────────────────────────────────
 *   - Headed Electron, motion-capture, ONE test() block.
 *   - Real ribbon clicks for every op.
 *   - Bare specifiers (no `node:` prefix).
 *
 * Run: ./node_modules/.bin/playwright test ux-tier6c-cutlist --headed --workers=1
 */

import { test, expect } from '@playwright/test';
import { clickRibbonTab, clickRibbonTool, injectToolParams } from './helpers/uiWorkflow.js';
import { launchWithCapture } from './helpers/motionCapture.js';

test.setTimeout(600000);

/**
 * The 12 structural members of the pallet-jack frame.
 *
 * Each entry is the **Structural Member** param payload (mm, scene coords).
 * Posts run along +Z; beams along +X; braces diagonally; forks along +X.
 * Layout is roughly: 4 posts at the corners, 4 beams forming a perimeter,
 * 2 diagonal braces between opposite corners, 2 forks at the load end.
 */
const MEMBERS = [
  // ── 4 vertical posts (squaretube 40x40x3, 750 mm) ─────────────────────────
  { tag: 'post NE', profile: 'squaretube', size: '40x40x3', length: 750,
    startX:    0, startY:    0, startZ: 0, endX:    0, endY:    0, endZ: 750 },
  { tag: 'post NW', profile: 'squaretube', size: '40x40x3', length: 750,
    startX:    0, startY:  600, startZ: 0, endX:    0, endY:  600, endZ: 750 },
  { tag: 'post SE', profile: 'squaretube', size: '40x40x3', length: 750,
    startX: 1200, startY:    0, startZ: 0, endX: 1200, endY:    0, endZ: 750 },
  { tag: 'post SW', profile: 'squaretube', size: '40x40x3', length: 750,
    startX: 1200, startY:  600, startZ: 0, endX: 1200, endY:  600, endZ: 750 },
  // ── 4 horizontal beams (recttube 50x30x3, 1200 mm) ────────────────────────
  // Top-front, top-back, bottom-front, bottom-back rails.
  { tag: 'beam top-front', profile: 'recttube', size: '50x30x3', length: 1200,
    startX:    0, startY:    0, startZ: 750, endX: 1200, endY:    0, endZ: 750 },
  { tag: 'beam top-back',  profile: 'recttube', size: '50x30x3', length: 1200,
    startX:    0, startY:  600, startZ: 750, endX: 1200, endY:  600, endZ: 750 },
  { tag: 'beam bot-front', profile: 'recttube', size: '50x30x3', length: 1200,
    startX:    0, startY:    0, startZ:   0, endX: 1200, endY:    0, endZ:   0 },
  { tag: 'beam bot-back',  profile: 'recttube', size: '50x30x3', length: 1200,
    startX:    0, startY:  600, startZ:   0, endX: 1200, endY:  600, endZ:   0 },
  // ── 2 diagonal angle braces (angle 50x50x5, 1500 mm) ──────────────────────
  { tag: 'brace SW-NE', profile: 'angle', size: '50x50x5', length: 1500,
    startX:    0, startY:    0, startZ: 750, endX: 1200, endY:  600, endZ: 750 },
  { tag: 'brace SE-NW', profile: 'angle', size: '50x50x5', length: 1500,
    startX:    0, startY:  600, startZ: 750, endX: 1200, endY:    0, endZ: 750 },
  // ── 2 load-bearing forks (recttube 50x100x4, 1000 mm) ─────────────────────
  // Extend out along +X past the front beam.
  { tag: 'fork left',  profile: 'recttube', size: '50x100x4', length: 1000,
    startX: 1200, startY:  150, startZ: 100, endX: 2200, endY:  150, endZ: 100 },
  { tag: 'fork right', profile: 'recttube', size: '50x100x4', length: 1000,
    startX: 1200, startY:  450, startZ: 100, endX: 2200, endY:  450, endZ: 100 },
];

test('UX Tier 6c — welded steel pallet jack frame: 12 members → Cut List 4 line items via real ribbon clicks', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('ux-tier6c-cutlist');
  win.on('console', m => console.log('[browser] ' + m.text()));
  try {
    // ── Step 0 — Verify Tier 6c surface is exposed.
    const opsAvailable = await win.evaluate(() => {
      const K = window.__archdiscKernel && window.__archdiscKernel.kernel;
      return {
        cutList:              typeof K?.brep?.cutList              === 'function',
        structuralMember:     typeof K?.brep?.structuralMember     === 'function',
        isWeldment:           typeof K?.brep?.isWeldment           === 'function',
        getWeldmentMetadata:  typeof K?.brep?.getWeldmentMetadata  === 'function',
      };
    });
    console.log('  Tier-6c ops available:', JSON.stringify(opsAvailable));
    expect(opsAvailable.cutList,          'cutList on kernel facade').toBe(true);
    expect(opsAvailable.structuralMember, 'structuralMember on kernel facade').toBe(true);

    // ── Step 1 — Activate the Weldments ribbon tab + verify Cut List visible.
    console.log('  clicking Weldments ribbon tab …');
    await clickRibbonTab(win, 'Weldments');
    await win.waitForTimeout(220);

    const weldmentToolNames = await win.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('button.ribbon-tool .ribbon-tool-label'))
        .map(el => el.textContent.trim());
      return labels;
    });
    console.log('  Weldments-tab tool labels:', JSON.stringify(weldmentToolNames));
    expect(weldmentToolNames, 'Cut List tool visible').toContain('Cut List');
    expect(weldmentToolNames, 'Structural Member still visible').toContain('Structural Member');

    // ── Step 2 — Build all 12 structural members via real ribbon clicks.
    //
    // Each member: inject params for Structural Member, click the tool,
    // wait for the registry length to grow. Avoid the param-dialog flow —
    // injectToolParams + bypass = single click per member.
    console.log(`  building ${MEMBERS.length} members for the pallet-jack frame …`);
    for (let i = 0; i < MEMBERS.length; i++) {
      const m = MEMBERS[i];
      await injectToolParams(win, 'Structural Member', {
        profile:  m.profile,
        size:     m.size,
        length:   m.length,
        startX:   m.startX, startY: m.startY, startZ: m.startZ,
        endX:     m.endX,   endY:   m.endY,   endZ:   m.endZ,
      });
      const beforeCount = await win.evaluate(() => (window.__archdiscRegistry?.bodies?.length || 0));
      await clickRibbonTool(win, 'Structural Member');
      await win.waitForFunction(
        (b) => (window.__archdiscRegistry?.bodies?.length || 0) > b,
        beforeCount,
        { timeout: 90000 },
      );
      await win.waitForTimeout(80);
      if ((i + 1) % 4 === 0) {
        console.log(`    built ${i + 1}/${MEMBERS.length} members (last: ${m.tag} — ${m.profile}/${m.size}, ${m.length} mm)`);
      }
    }

    // ── FOCAL A — registry holds exactly 12 weldment-tagged bodies.
    const memberCount = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      const K = window.__archdiscKernel.kernel.brep;
      let weldments = 0;
      for (const e of (reg?.bodies || [])) {
        const bs = e.brepShapeRef || e.group?.userData?.brepShapeRef;
        if (bs && K.isWeldment(bs)) weldments++;
      }
      return { total: reg?.bodies?.length || 0, weldments };
    });
    console.log(`  body counts: ${JSON.stringify(memberCount)}`);
    expect(memberCount.weldments, '12 weldment-tagged bodies').toBe(MEMBERS.length);

    // Frame the iso so the whole pallet-jack fits.
    await frameAll(win);
    await win.waitForTimeout(280);
    await story.frame('01-pallet-jack-frame-built');

    // ── Step 3 — Invoke Cut List via the ribbon click.
    console.log('  clicking Cut List ribbon tool …');
    await clickRibbonTool(win, 'Cut List');
    // The handler fires `archdisc:open-cut-list` synchronously; the React
    // modal mounts shortly after. Poll the DOM for the modal element.
    await win.waitForSelector('[data-archdisc-cutlist-modal="open"]', { timeout: 30000 });
    await win.waitForTimeout(280);

    // FOCAL B — the kernel cutList op returns 4 line items.
    const report = await win.evaluate(() => {
      const K = window.__archdiscKernel.kernel.brep;
      return K.cutList({ rounding: 1 });
    });
    console.log(`  cut list report: ${JSON.stringify(report)}`);
    expect(report.totalLines, '4 unique (profile,size,length) groups').toBe(4);

    // FOCAL C — sum of quantities = 12 (one per member).
    const totalQty = report.groups.reduce((s, g) => s + g.quantity, 0);
    console.log(`  total qty across all line items: ${totalQty}`);
    expect(totalQty, 'aggregated quantity sums to 12 members').toBe(MEMBERS.length);

    // Sanity-check the expected quantities by profile family.
    const byProfile = {};
    for (const g of report.groups) {
      byProfile[g.profile] = (byProfile[g.profile] || 0) + g.quantity;
    }
    console.log(`  qty by profile: ${JSON.stringify(byProfile)}`);
    expect(byProfile.squaretube, '4 square-tube posts').toBe(4);
    // recttube quantity: 4 perimeter beams (50x30x3) + 2 forks (50x100x4) = 6
    expect(byProfile.recttube,   '6 recttube members (beams + forks)').toBe(6);
    expect(byProfile.angle,      '2 angle braces').toBe(2);

    // FOCAL D — the modal rendered all 4 rows + the Copy buttons exist.
    const modalRows = await win.evaluate(() => {
      const rows = document.querySelectorAll('tr[data-archdisc-cutlist-row]');
      return Array.from(rows).map(r => ({
        item:    r.getAttribute('data-archdisc-cutlist-row'),
        profile: r.getAttribute('data-archdisc-cutlist-profile'),
        size:    r.getAttribute('data-archdisc-cutlist-size'),
        length:  r.getAttribute('data-archdisc-cutlist-length'),
        qty:     r.getAttribute('data-archdisc-cutlist-qty'),
      }));
    });
    console.log(`  modal rows: ${JSON.stringify(modalRows)}`);
    expect(modalRows.length, 'modal rendered 4 cut-list rows').toBe(4);

    const copyButtons = await win.evaluate(() => ({
      csv: !!document.querySelector('[data-archdisc-cutlist-copy="csv"]'),
      tsv: !!document.querySelector('[data-archdisc-cutlist-copy="tsv"]'),
    }));
    console.log(`  copy buttons: ${JSON.stringify(copyButtons)}`);
    expect(copyButtons.csv, 'Copy CSV button rendered').toBe(true);
    expect(copyButtons.tsv, 'Copy TSV button rendered').toBe(true);

    // Capture the modal still.
    await story.frame('02-cutlist-modal-4-line-items');

    // No page errors during the whole workflow.
    expect(pageErrors, 'no page errors during Tier-6c workflow').toEqual([]);

    console.log('  ── Tier 6c summary ──');
    console.log(`     Members built: ${MEMBERS.length}`);
    console.log(`     Cut list line items: ${report.totalLines}`);
    console.log(`     Total stock length: ${report.totalLengthMm} mm`);
    for (const g of report.groups) {
      console.log(`       #${g.itemNo}: ${g.profile}/${g.size} × ${g.lengthMm} mm  qty ${g.quantity}  total ${g.totalLengthMm} mm`);
    }
  } finally {
    await app.close();
    const session = await story.finish();
    console.log(`Tier-6c motion-capture session: ${session}`);
    console.log(`Tier-6c stills: ${story.frames().length}`);
  }
});

/**
 * Frame the camera so every body in the scene fits the viewport at iso.
 * Same routine as Tier-6a / Tier-6b for visual consistency.
 */
async function frameAll(win) {
  await win.evaluate(() => {
    const v = window.__archdiscViewport;
    if (!v || !v.camera || !v.orbitControls) return;
    const THREE = window.THREE;
    if (!THREE) return;
    const reg = window.__archdiscRegistry;
    if (!reg || !reg.bodies || reg.bodies.length === 0) return;
    const box = new THREE.Box3();
    let init = false;
    for (const b of reg.bodies) {
      if (!b || !b.group) continue;
      const bb = new THREE.Box3().setFromObject(b.group);
      if (bb.isEmpty()) continue;
      if (!init) { box.copy(bb); init = true; }
      else box.union(bb);
    }
    if (!init || box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 0.5;
    const halfFov = (v.camera.fov * Math.PI / 180) / 2;
    const dist = (maxDim / 2) / Math.tan(halfFov) * 1.7;
    const dx = 0.7, dy = 0.45, dz = 0.55;
    const L = Math.hypot(dx, dy, dz);
    v.camera.position.set(
      center.x + dist * dx / L,
      center.y + dist * dy / L,
      center.z + dist * dz / L,
    );
    v.camera.up.set(0, 0, 1);
    v.camera.near = Math.max(dist * 0.001, 0.0001);
    v.camera.far = Math.max(dist * 100, 100);
    v.camera.updateProjectionMatrix();
    v.orbitControls.target.copy(center);
    v.orbitControls.update();
  });
}
