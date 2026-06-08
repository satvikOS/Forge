// v4-162-vision-wire.spec.js — Forge-162 viewport-perception wire.
//
// Mirror of Studio's slice 951q. Proves that the Forge v3 Archie loop
// (useArchieDriver → ForgeRunner.runForgePrompt) captures the live
// canvas, captions it via the local VL server on :8081, and prepends the
// caption to the next chat call as <viewport_state>...</viewport_state>.
//
// Both endpoints are stubbed via Playwright route() so the spec runs
// without the Qwen2.5-VL server or mlx_lm.server being up. The kernel
// readiness check (window.forge.isReady) is also stubbed so
// useArchieDriver takes the live path rather than the offline-echo
// fallback.
//
// Captures five named camera angles of an injected reference mesh —
// remote-desktop verification per [[feedback-forge-multicam-e2e]].

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-162-vision-wire';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve(__dirname, '..', '..', 'electron', 'main.js');

const STUB_CAPTION = '{"bodies":[{"kind":"box","dims":"40x20x15"}],"camera":{"angle_deg":35,"framing":"iso"}}';
const STUB_REPLY =
  '<think>Edge fillet next.</think>\n' +
  '<plan>{"goal":"fillet edges","bodies":[{"id":"b1"}]}</plan>\n' +
  '<tool_call>{"name":"part.fillet-edges","arguments":{"radius":1.5}}</tool_call>';

const ANGLES = [
  { name: 'front', pos: [0, 0, 5] },
  { name: 'top',   pos: [0, 5, 0.001] },
  { name: 'right', pos: [5, 0, 0] },
  { name: 'iso',   pos: [3, 3, 3] },
  { name: 'close', pos: [1.5, 1.2, 1.5] },
];

test('Forge-162 — viewport caption reaches runForgePrompt chat payload', async () => {
  test.setTimeout(180000);

  const app = await electron.launch({
    args: [ELECTRON_MAIN, '--no-sandbox'],
    env: { ...process.env, FORGE_E2E: '1' },
  });
  const page = await app.firstWindow();
  page.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await page.waitForLoadState('domcontentloaded');

  // Capture every chat payload + count caption hits.
  const chatBodies = [];
  let visionHit = 0;
  await page.route('**/caption', async (route) => {
    visionHit++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ caption: STUB_CAPTION }),
    });
  });
  await page.route('**/v1/chat/completions', async (route) => {
    try { chatBodies.push(JSON.parse(route.request().postData() || '{}')); } catch (_) {}
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: STUB_REPLY } }],
      }),
    });
  });
  const findUserMsg = (body, needle) => {
    if (!body || !Array.isArray(body.messages)) return null;
    return body.messages.find((m) => m.role === 'user' && (m.content || '').includes(needle));
  };

  // Dismiss the OnboardingTour overlay (Forge-v4 first-launch tour
  // covers the cmdbar). The shell respects localStorage forge.v4.onboarded.
  // Set BEFORE the React shell renders so the overlay never mounts.
  await page.evaluate(() => {
    try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {}
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  // Stub window.forge so ForgeShellV4.runArchie takes the LIVE path
  // (else the kernel-not-loaded fallback echoes and never calls
  // runForgePrompt).
  await page.evaluate(() => {
    const forge = {
      isReady: () => true,
      makeBox: () => ({ ok: true, handle: 7 }),
      filletEdges: () => ({ ok: true, handle: 8 }),
    };
    window.forge = forge;
  });

  // Wait for the v4 shell to mount the command bar. Vite dev bundle is
  // slow to compile the 9k-line ForgeShellV4 on cold start, so allow
  // a generous timeout.
  await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 90000 });
  await page.waitForTimeout(500);

  // Wait for the v4 renderer to publish its globals so the multi-cam
  // loop has a camera to drive. RendererPublisher (Viewport.jsx) sets
  // these on mount.
  await page.waitForFunction(() => !!window.__forgeRenderer && !!window.__forgeCamera && !!window.__forgeScene, { timeout: 10000 });

  for (const a of ANGLES) {
    await page.evaluate(({ pos }) => {
      const cam = window.__forgeCamera;
      const rend = window.__forgeRenderer;
      const scn = window.__forgeScene;
      if (!cam) return;
      cam.position.set(pos[0], pos[1], pos[2]);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
      if (rend && scn) rend.render(scn, cam);
    }, { pos: a.pos });
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(SHOT_DIR, `cam-${a.name}.png`) });
  }

  // ─── path 1: vision ON ───────────────────────────────────────────────
  chatBodies.length = 0;
  visionHit = 0;
  const PROMPT_1 = 'fillet all sharp edges 1.5mm';
  const input = page.locator('[data-testid="forge-cmdbar-input"]');
  await input.click();
  await input.fill(PROMPT_1);
  await input.press('Enter');

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (chatBodies.some((b) => findUserMsg(b, PROMPT_1))) break;
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: path.join(SHOT_DIR, 'after-vision-on.png') });

  expect(visionHit).toBeGreaterThanOrEqual(1);
  const onMsg = chatBodies.map((b) => findUserMsg(b, PROMPT_1)).find(Boolean);
  expect(onMsg).toBeTruthy();
  expect(onMsg.content).toContain('<viewport_state>');
  expect(onMsg.content).toContain(STUB_CAPTION);
  expect(onMsg.content).toContain(PROMPT_1);

  // ─── path 2: vision OFF — opt-out skips the caption ──────────────────
  await page.evaluate(() => { window.__forgeArchieVisionOff = true; });
  chatBodies.length = 0;
  visionHit = 0;
  await page.waitForTimeout(400);
  const PROMPT_2 = 'blind run check';
  await input.click();
  await input.fill(PROMPT_2);
  await input.press('Enter');

  const d2 = Date.now() + 20000;
  while (Date.now() < d2) {
    if (chatBodies.some((b) => findUserMsg(b, PROMPT_2))) break;
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: path.join(SHOT_DIR, 'after-vision-off.png') });

  expect(visionHit).toBe(0);
  const offMsg = chatBodies.map((b) => findUserMsg(b, PROMPT_2)).find(Boolean);
  expect(offMsg).toBeTruthy();
  expect(offMsg.content).not.toContain('<viewport_state>');

  await app.close();
});
