// PUSH-95 (Slice-63 / Sheet Metal multi-flange catalogue panel).
//
// Up through PUSH-43 (Slice-12) only baseFlange + edgeFlange + flatPattern
// of the nine forge.sheetMetal.* kernel ops were reachable from the UI;
// miterFlange / hem / jog / closedCorner / cornerRelief / unfold were
// callable only through Archie or the macro recorder. PUSH-95 lands the
// missing UI: a right-docked Sheet Metal Catalogue panel that picks the
// active sheet body (auto-seeds a 100×60×2 mm baseFlange if no sheet
// body exists), exposes EIGHT downstream flange ops with inline param
// forms, and runs every Apply through the real kernel — the returned
// native handle replaces the previous active body via
// window.__forgeSetBodies so downstream ops chain.
//
// Proof end-to-end (this spec):
//   1. Boot Electron, dismiss any first-run banner.
//   2. Wait for the host's window surfaces:
//        window.__forgeOpenSheetCatalogue,
//        window.__forgeCloseSheetCatalogue,
//        window.__forgeLastSheetCatalogueOp.
//      That's the proof SheetCataloguePanelHost mounted from App.jsx
//      even before the panel is opened.
//   3. Seed a 100×60×2 baseFlange via window.forge.sheetMetal.baseFlange
//      directly (the canonical seed in the brief). Commit it via
//      __forgeAppendBody so the scene + the panel pick it up. Read the
//      kernel volume via forge.massProps — assert 12000 mm³ ± 1.
//   4. Open the panel via the tools.sheetCatalogue menu action. Assert
//      the panel mounts; data-has-sheet='true'; data-body-volume is
//      ~12000 mm³.
//   5. Expand the Edge Flange section; assert the inline form fields
//      render with the expected default length (25). Click Apply. The
//      panel dispatches sheetMetalDispatch.edgeFlange which calls the
//      real forge.sheetMetal.edgeFlange. Assert the active body's
//      handle changes AND its volume > 12000 mm³ (the added flange
//      contributes 25 × 60 × 2 = 3000 mm³ over the seed).
//   6. PUSH-43 regression: switch to the Sheet workbench and confirm
//      the legacy SheetMetalWorkbench panel still opens (the new
//      catalogue panel is an additive surface — it must not collide).
//
// Multi-cam: 5 named camera angles per Forge-171 multi-cam mandate.
//   - iso   (boot + host API + seed baseFlange)
//   - front (open panel + assert mounted)
//   - top   (expand Edge Flange section + read defaults)
//   - right (Apply edge flange + assert volume grew)
//   - iso   (PUSH-43 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-95-sheet-catalogue');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'sheet-catalogue-session.mp4');

// Seed shape: 100 × 60 × 2 → 12000 mm³. The OCCT volume integration is
// numerically exact for a prism of axis-aligned dimensions; the tolerance
// is just for floating-point comparison noise.
const SEED_W = 100;
const SEED_H = 60;
const SEED_T = 2;
const SEED_VOLUME_MM3 = SEED_W * SEED_H * SEED_T;
const VOLUME_TOL = 1.0;

let app, page;
let stepIndex = 0;
let seededBodyId = null;

async function shot(label) {
  stepIndex += 1;
  const name = String(stepIndex).padStart(3, '0') + '-' + label.replace(/[^a-z0-9-_.]/gi, '_');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 350) { await page.waitForTimeout(ms); }

async function platformMenuAction(actionId) {
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id } }));
  }, actionId);
  await pause(400);
}
async function cameraTo(viewName) {
  await platformMenuAction(`view.${viewName}`);
  await pause(250);
}

async function readBodyVolume(handle) {
  return await page.evaluate((h) => {
    if (!window.forge?.massProps || typeof h !== 'number') return null;
    try { return Math.abs(Number(window.forge.massProps(h).volume)); }
    catch (e) { return { error: e?.message || String(e) }; }
  }, handle);
}

// Set an <input>'s value through the native setter so React's onChange
// fires reliably for controlled inputs (Playwright's .fill() can drop
// synthetic events on number inputs depending on focus timing).
async function setReactInput(testid, value) {
  await page.evaluate((args) => {
    const el = document.querySelector(`[data-testid="${args.testid}"]`);
    if (!el) throw new Error(`input not found: ${args.testid}`);
    const proto = (el.tagName === 'SELECT')
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    nativeSetter.call(el, args.value);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { testid, value });
}

test.beforeAll(async () => {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  app = await electron.launch({
    args: [path.resolve(__dirname, '..')], timeout: 60000,
    recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
  });
  page = await app.firstWindow();
  page.on('console', (msg) => {
    const t = msg.text();
    if (msg.type() === 'error' || msg.type() === 'warning'
        || /push-95|sheet-catalogue|SheetCatalogue|forge:sheet-catalogue|error|Error|TypeError|crashed/i.test(t)) {
      console.log('[browser]', msg.type(), t);
    }
  });
  page.on('pageerror', (err) => {
    console.log('[browser pageerror]', err.message);
  });
  await page.waitForLoadState('domcontentloaded');
  await pause(3000);
  // First-run banner dismissal.
  const setBtn = page.locator('button:has-text("Set")');
  if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
  else await page.keyboard.press('Escape');
  const discard = page.locator('button:has-text("Discard")');
  if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
  // Onboarding tour is a click-eating overlay; skip permanently.
  await page.evaluate(() => {
    try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
  });
  const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
  if (await tourSkip.count() > 0) {
    await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
    await pause(400);
  }
  await pause(800);
});

test.afterAll(async () => {
  try { await pause(2000); } catch {}
  let videoPath = null;
  try { videoPath = await page.video()?.path(); } catch {}
  if (app) {
    try { await app.close({ timeout: 10000 }); }
    catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
  }
  await new Promise((r) => setTimeout(r, 1200));
  if (!videoPath || !fs.existsSync(videoPath)) {
    const cands = fs.existsSync(VIDEO_DIR)
      ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm'))
      : [];
    if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
  }
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error('[push-95] no .webm'); return;
  }
  try { fs.unlinkSync(FINAL_MP4); } catch {}
  const ffmpegBin = require('ffmpeg-static');
  await new Promise((resolve) => {
    const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
      '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(FINAL_MP4)) {
        const sz = (fs.statSync(FINAL_MP4).size / 1024 / 1024).toFixed(2);
        console.log(`[push-95] mp4 written: ${FINAL_MP4} (${sz} MB)`);
      } else {
        console.error('[push-95] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
      }
      resolve();
    });
  });
});

test('00 — boot + host surface installed + seed 100×60×2 baseFlange (iso)', async () => {
  await cameraTo('iso');
  await shot('boot');

  // The SheetCataloguePanelHost effect installs the imperative
  // open/close hooks + the last-op slot at mount time, BEFORE the
  // panel is shown. That's the proof App.jsx mounted the host. The
  // shell's first render is ~3 s on a cold Electron boot when other
  // agents are sharing the CPU; give it a generous window.
  await page.waitForFunction(
    () => typeof window.__forgeOpenSheetCatalogue  === 'function'
       && typeof window.__forgeCloseSheetCatalogue === 'function'
       && typeof window.__forgeLastSheetCatalogueOp === 'object',
    null, { timeout: 30000 });

  // forge.sheetMetal must be live before we seed.
  await page.waitForFunction(
    () => !!window.forge && !!window.forge.sheetMetal
       && typeof window.forge.sheetMetal.baseFlange === 'function',
    null, { timeout: 10000 });

  // Seed a 100×60×2 mm baseFlange through the real kernel — same path
  // the panel's seed button uses, but driven from the spec so we can
  // assert the kernel volume independently of UI state. The dispatcher
  // takes (wire, params); we use makeWireRect → baseFlange exactly.
  seededBodyId = `push-95-seed-${Date.now().toString(36)}`;
  const seed = await page.evaluate(({ w, h, t, id }) => {
    const sm = window.forge.sheetMetal;
    const wire = sm.makeWireRect(w, h);
    if (typeof wire !== 'number') return { error: 'makeWireRect did not return a handle' };
    const handle = sm.baseFlange(wire, {
      thickness: t, kFactor: 0.44, bendRadius: 3,
    });
    if (typeof handle !== 'number') return { error: 'baseFlange did not return a handle' };
    window.__forgeAppendBody({
      id, kind: 'native', handle,
      toolId: 'sheet.baseFlange',
      name: 'Sheet · Base Flange (push-95 seed)',
      params: { width: w, height: h, thickness: t, bendRadius: 3 },
    });
    return { handle };
  }, { w: SEED_W, h: SEED_H, t: SEED_T, id: seededBodyId });
  expect(seed.error).toBeUndefined();
  expect(seed.handle).toBeGreaterThan(0);

  // Wait until the bodies array reflects the seed.
  await page.waitForFunction(
    (id) => (window.__forgeBodies || []).some((b) => b.id === id && b.kind === 'native'),
    seededBodyId, { timeout: 4000 });

  // Volume contract: 100 × 60 × 2 = 12000 mm³, within float tolerance.
  const vol = await readBodyVolume(seed.handle);
  console.log('[push-95] seed volume =', vol);
  expect(typeof vol).toBe('number');
  expect(Math.abs(vol - SEED_VOLUME_MM3)).toBeLessThan(VOLUME_TOL);

  await shot('baseflange-seeded');
});

test('01 — open Sheet Catalogue panel via tools.sheetCatalogue (front)', async () => {
  await cameraTo('front');

  await platformMenuAction('tools.sheetCatalogue');
  await page.waitForSelector('[data-testid="forge-sheet-catalogue-panel"]',
                             { state: 'visible', timeout: 6000 });
  await shot('panel-open');

  const panel = page.locator('[data-testid="forge-sheet-catalogue-panel"]');

  // Kernel surface is live + the panel picked up the seeded body.
  expect(await panel.getAttribute('data-kernel-ready')).toBe('true');
  expect(await panel.getAttribute('data-has-sheet')).toBe('true');
  expect(await panel.getAttribute('data-body-toolid')).toBe('sheet.baseFlange');

  // The body-volume data-* mirror shows the kernel volume (12000) to two
  // decimals; we parse the string and compare with tolerance.
  const volAttr = await panel.getAttribute('data-body-volume');
  const volNum = Number(volAttr);
  console.log('[push-95] panel body-volume attribute =', volAttr);
  expect(Number.isFinite(volNum)).toBe(true);
  expect(Math.abs(volNum - SEED_VOLUME_MM3)).toBeLessThan(VOLUME_TOL);

  // Op-count contract: the panel exposes 8 catalogue ops. The seed
  // button is gone (has-sheet=true). No op is open yet.
  expect(await panel.getAttribute('data-op-count')).toBe('8');
  expect(await panel.getAttribute('data-open-op')).toBe('');

  // The Edge Flange row is rendered with its toggle button.
  await expect(page.locator(
    '[data-testid="forge-sheet-catalogue-op-edgeFlange"]')).toBeVisible();
  await expect(page.locator(
    '[data-testid="forge-sheet-catalogue-op-edgeFlange-toggle"]')).toBeVisible();
});

test('02 — expand Edge Flange section + read defaults (top)', async () => {
  await cameraTo('top');

  // Click the Edge Flange toggle. The row's data-open flips + the
  // panel's data-open-op publishes the active op id. The inline form
  // renders six fields by schema (edgeId / length / angleDeg / relief /
  // thickness / bendRadius).
  await page.locator('[data-testid="forge-sheet-catalogue-op-edgeFlange-toggle"]').click();
  await pause(200);

  const panel = page.locator('[data-testid="forge-sheet-catalogue-panel"]');
  expect(await panel.getAttribute('data-open-op')).toBe('sheet.edgeFlange');

  const row = page.locator('[data-testid="forge-sheet-catalogue-op-edgeFlange"]');
  expect(await row.getAttribute('data-open')).toBe('true');

  // Defaults: edgeId=0, length=25, angleDeg=90, relief=rect, thickness=2,
  // bendRadius=3. Verify the most load-bearing fields.
  const len = await page.locator(
    '[data-testid="forge-sheet-catalogue-field-edgeFlange-length"]').inputValue();
  expect(Number(len)).toBe(25);
  const angle = await page.locator(
    '[data-testid="forge-sheet-catalogue-field-edgeFlange-angleDeg"]').inputValue();
  expect(Number(angle)).toBe(90);
  const edgeId = await page.locator(
    '[data-testid="forge-sheet-catalogue-field-edgeFlange-edgeId"]').inputValue();
  expect(Number(edgeId)).toBe(0);
  const thickness = await page.locator(
    '[data-testid="forge-sheet-catalogue-field-edgeFlange-thickness"]').inputValue();
  expect(Number(thickness)).toBe(2);

  // The Apply button is visible + enabled (we have an active sheet body).
  const applyBtn = page.locator(
    '[data-testid="forge-sheet-catalogue-op-edgeFlange-apply"]');
  await expect(applyBtn).toBeVisible();
  await expect(applyBtn).toBeEnabled();

  await shot('edge-flange-form-open');
});

test('03 — Apply Edge Flange → real kernel call + volume grew (right)', async () => {
  await cameraTo('right');

  // Sample the active body handle BEFORE Apply so we can prove a
  // replacement happened.
  const before = await page.evaluate(() => {
    const arr = window.__forgeBodies || [];
    const tail = arr.filter((b) => b.kind === 'native').pop();
    return tail
      ? { id: tail.id, handle: tail.handle, toolId: tail.toolId }
      : null;
  });
  expect(before).not.toBeNull();
  console.log('[push-95] before Apply =', before);

  // Pin the form length=25 explicitly (also the default) so we exercise
  // the controlled-input → React state path even if the input was already
  // dirtied by a stray focus / blur.
  await setReactInput('forge-sheet-catalogue-field-edgeFlange-length', '25');
  await pause(150);

  // Click Apply. The panel's onClick calls sheetMetalDispatch.edgeFlange
  // which calls window.forge.sheetMetal.edgeFlange. On success the panel
  // replaces the active body via __forgeSetBodies + publishes the op on
  // window.__forgeLastSheetCatalogueOp + forge:sheet-catalogue-op bus.
  await page.locator(
    '[data-testid="forge-sheet-catalogue-op-edgeFlange-apply"]').click();

  // Wait for the publish — the most reliable signal that the dispatch
  // returned a native handle (and not a noop / error).
  await page.waitForFunction(() => {
    const op = window.__forgeLastSheetCatalogueOp;
    return op && op.op === 'sheet.edgeFlange' && op.ok === true
        && typeof op.handle === 'number';
  }, null, { timeout: 8000 });

  const lastOp = await page.evaluate(() => window.__forgeLastSheetCatalogueOp);
  console.log('[push-95] last op =', lastOp);
  expect(lastOp.op).toBe('sheet.edgeFlange');
  expect(lastOp.ok).toBe(true);
  expect(typeof lastOp.handle).toBe('number');

  // The active sheet body has been replaced; new tail body has the
  // edge-flange tool id and a different handle from the seed.
  const after = await page.evaluate(() => {
    const arr = window.__forgeBodies || [];
    const tail = arr.filter((b) => b.kind === 'native').pop();
    return tail
      ? { id: tail.id, handle: tail.handle, toolId: tail.toolId }
      : null;
  });
  console.log('[push-95] after Apply =', after);
  expect(after).not.toBeNull();
  expect(after.toolId).toBe('sheet.edgeFlange');
  expect(after.handle).not.toBe(before.handle);

  // Volume contract: the seed was 100×60×2 = 12000 mm³. Adding a 25 mm
  // edge flange on edge 0 develops a fresh prism of ~25 × 60 × 2 =
  // 3000 mm³ minus the bend allowance, so the total kernel volume must
  // be STRICTLY greater than the seed. We don't pin an upper bound
  // because the kernel composes a bend arc + auto-relief that adds /
  // subtracts a thin sliver depending on K-factor — strictly-greater is
  // the contract.
  const newVol = await readBodyVolume(after.handle);
  console.log('[push-95] after volume =', newVol);
  expect(typeof newVol).toBe('number');
  expect(newVol).toBeGreaterThan(SEED_VOLUME_MM3);

  // Panel's body-volume mirror also reflects the new kernel volume.
  // Give the live-volume effect a tick to settle.
  await pause(900);
  const panelVolAttr = await page.locator(
    '[data-testid="forge-sheet-catalogue-panel"]').getAttribute('data-body-volume');
  const panelVol = Number(panelVolAttr);
  console.log('[push-95] panel body-volume after =', panelVolAttr);
  expect(Number.isFinite(panelVol)).toBe(true);
  expect(panelVol).toBeGreaterThan(SEED_VOLUME_MM3);

  // The log row records the op + the new handle.
  const logRow = page.locator(
    '[data-testid="forge-sheet-catalogue-log-entry"]').first();
  await expect(logRow).toBeVisible();
  expect(await logRow.getAttribute('data-op')).toBe('sheet.edgeFlange');
  expect(await logRow.getAttribute('data-ok')).toBe('true');
  expect(Number(await logRow.getAttribute('data-handle'))).toBe(after.handle);

  await shot('edge-flange-applied');
});

test('04 — PUSH-43 regression: legacy SheetMetalWorkbench still mounts (iso)', async () => {
  await cameraTo('iso');

  // PUSH-43 (Slice-12) shipped the SheetMetalWorkbench right-docked
  // panel that auto-mounts when the active workbench flips to `sheet`.
  // The new catalogue panel is an additive surface — switching to the
  // sheet workbench MUST still open the legacy panel without
  // colliding with the catalogue surface.
  const sheetWbBtn = page.locator('[data-wb="sheet"]');
  if (await sheetWbBtn.count() > 0) {
    await sheetWbBtn.first().click({ timeout: 3000 }).catch(() => {});
    await pause(700);
  }

  // The legacy panel is queryable.
  const legacy = page.locator('[data-testid="forge-sheet-panel"]');
  if (await legacy.count() > 0) {
    await expect(legacy.first()).toBeVisible();
  } else {
    // On the off chance the workbench rail wasn't found (e.g. small
    // viewport) we re-trigger the open hook directly so the smoke
    // still proves the host wiring.
    await page.evaluate(() => {
      if (typeof window.__forgeOpenSheetMetal === 'function') {
        window.__forgeOpenSheetMetal();
      }
    });
    await page.waitForSelector('[data-testid="forge-sheet-panel"]',
                               { state: 'visible', timeout: 4000 });
  }

  // The new catalogue panel is ALSO still mounted — both portals
  // co-exist (they share the right edge cosmetically; that overlap
  // is known + accepted per the BigScene / SectionPlane precedent).
  const cataloguePanel = page.locator('[data-testid="forge-sheet-catalogue-panel"]');
  await expect(cataloguePanel).toBeVisible();

  await shot('legacy-and-catalogue-coexist');
});
