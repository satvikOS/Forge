// Forge-158 — AIS selection layer headed-Electron verification.
//
// Boots the real Forge v4 shell, loads a body into the stress overlay
// so the Viewport has something to hit, then drives the AIS selection
// module + verifies hover / click updates window.__forgeHovered +
// window.__forgeSelection plus dispatches the public events.
//
// Subshape mode rotation through the Tools menu is also exercised so
// the Forge-158 menu wiring is covered.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-selection';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR,
    `${String(++n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-158 · AIS selection layer', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 app boots + AIS selection API installed', async () => {
    await shot(page, 'baseline');
    await expect(page.locator('[data-testid="forge-app"]')).toBeVisible();
    await page.waitForFunction(
      () => typeof window.__forgeSelectionApi?.getMode === 'function' &&
            typeof window.__forgeSelectionApi.onClick === 'function' &&
            typeof window.__forgeOpenSelectionMode === 'function' &&
            !!window.__forgeAisSelection,
      { timeout: 5000 },
    );
    const meta = await page.evaluate(() => ({
      modes:    window.__forgeSelectionApi.MODES,
      mode:     window.__forgeSelectionApi.getMode(),
      selection:window.__forgeAisSelection.selection,
      hovered:  window.__forgeAisSelection.hovered,
    }));
    expect(meta.modes).toEqual(['body', 'face', 'edge', 'vertex']);
    expect(meta.mode).toBe('body');
    expect(meta.selection).toBeNull();
    expect(meta.hovered).toBeNull();
  });

  test('02 Tools menu → Selection Mode rotates body→face→edge→vertex→body', async () => {
    const rotate = async () => {
      await page.locator('[data-menu="tools"]').click();
      await page.locator('[data-menu-item="tools.selectionMode"]').click();
      await page.waitForTimeout(150);
      return page.evaluate(() => window.__forgeSelectionApi.getMode());
    };
    const m1 = await rotate(); expect(m1).toBe('face');
    await shot(page, 'mode-face');
    const m2 = await rotate(); expect(m2).toBe('edge');
    const m3 = await rotate(); expect(m3).toBe('vertex');
    const m4 = await rotate(); expect(m4).toBe('body');
    await shot(page, 'mode-cycle-complete');
  });

  test('03 load a body via stress overlay → scene has hittable mesh', async () => {
    await page.evaluate(() => window.__forgeOpenStressTest?.(true));
    await page.waitForTimeout(400);
    const cnt = await page.evaluate(() => {
      const body = {
        id: 'aisBody1',
        kind: 'synthetic',
        spec: { kind: 'box', dx: 30, dy: 30, dz: 30, cells: [{ x: 0, y: 0, z: 0 }] },
        handle: 42,
        instanceTag: 'aisDemo',
      };
      return window.__forgeSetBodies?.([body]) ?? 0;
    });
    expect(cnt).toBe(1);
    await page.waitForTimeout(1500);   // r3f mesh build + RendererPublisher.
    const sceneReady = await page.evaluate(() => !!window.__forgeScene);
    expect(sceneReady).toBe(true);
    await shot(page, 'body-loaded');
  });

  test('04 hover → window.__forgeHovered + AIS state set', async () => {
    const hovered = await page.evaluate(() => {
      const scene = window.__forgeScene;
      let mesh = null;
      scene.traverse((o) => {
        if (!mesh && o.isMesh && o.userData && o.userData.body) mesh = o;
      });
      if (!mesh) return { error: 'no mesh in scene' };
      const fakeEvt = {
        object: mesh,
        intersections: [{
          object: mesh,
          point: { x: 1, y: 2, z: 3 },
          face: { a: 0, b: 1, c: 2 },
          faceIndex: 0,
        }],
        stopPropagation: () => {},
      };
      window.__forgeSelectionApi.onPointerOver(fakeEvt);
      return {
        forgeHovered: window.__forgeHovered ? {
          id: window.__forgeHovered.id ?? null,
          handle: window.__forgeHovered.handle ?? null,
        } : null,
        ais: window.__forgeAisSelection.hovered ? {
          kind: window.__forgeAisSelection.hovered.kind,
          bodyId: window.__forgeAisSelection.hovered.bodyId,
        } : null,
      };
    });
    expect(hovered.error).toBeUndefined();
    expect(hovered.ais).not.toBeNull();
    expect(hovered.ais.kind).toBe('body');
    expect(hovered.ais.bodyId).toBe(42);
    // window.__forgeHovered is the AIS-shaped entity (legacy code used
    // the raw body object — both fields are valid identifiers).
    expect(hovered.forgeHovered).not.toBeNull();
    await shot(page, 'hovered');
  });

  test('05 click → window.__forgeSelection set + forge:selection-changed event fires', async () => {
    const result = await page.evaluate(() => new Promise((resolve) => {
      const scene = window.__forgeScene;
      let mesh = null;
      scene.traverse((o) => {
        if (!mesh && o.isMesh && o.userData && o.userData.body) mesh = o;
      });
      if (!mesh) return resolve({ error: 'no mesh' });
      let evtSeen = null;
      window.addEventListener('forge:selection-changed',
        (e) => { evtSeen = e.detail; }, { once: true });
      const fakeEvt = {
        object: mesh,
        intersections: [{
          object: mesh,
          point: { x: 0, y: 0, z: 0 },
          face: { a: 0, b: 1, c: 2 },
          faceIndex: 0,
        }],
        stopPropagation: () => {},
      };
      window.__forgeSelectionApi.onClick(fakeEvt);
      setTimeout(() => resolve({
        forgeSelection: window.__forgeSelection,
        ais: window.__forgeAisSelection.selection
          ? { kind: window.__forgeAisSelection.selection.kind,
              bodyId: window.__forgeAisSelection.selection.bodyId }
          : null,
        eventSeen: !!evtSeen,
      }), 80);
    }));
    expect(result.error).toBeUndefined();
    expect(result.forgeSelection.kind).toBe('body');
    expect(result.forgeSelection.ids).toContain(42);
    expect(result.ais).toEqual({ kind: 'body', bodyId: 42 });
    expect(result.eventSeen).toBe(true);
    await shot(page, 'selected');
  });

  test('06 setMode(face) clears selection + emits mode-changed event', async () => {
    const result = await page.evaluate(() => new Promise((resolve) => {
      let modeEvt = null;
      window.addEventListener('forge:selection-mode-changed',
        (e) => { modeEvt = e.detail; }, { once: true });
      window.__forgeSelectionApi.setMode('face');
      setTimeout(() => resolve({
        mode: window.__forgeSelectionApi.getMode(),
        sel:  window.__forgeAisSelection.selection,
        evt:  modeEvt,
      }), 50);
    }));
    expect(result.mode).toBe('face');
    expect(result.sel).toBeNull();
    expect(result.evt?.mode).toBe('face');
    await shot(page, 'mode-face-cleared');
  });
});
