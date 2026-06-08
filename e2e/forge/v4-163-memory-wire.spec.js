// v4-163-memory-wire.spec.js — Forge-163 long-session memory wire.
//
// Mirror of Studio's slice 951r. Proves that ForgeShellV4.runArchie
// recalls top-K prior turns from the memory store on :8083 and
// prepends them as <prior_context>…</prior_context>, then fire-and-
// forgets the new turn back into the store via /remember.
//
// All store + chat endpoints are stubbed via Playwright route() so the
// spec runs without the live Python services or mlx_lm.server.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-163-memory-wire';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve(__dirname, '..', '..', 'electron', 'main.js');

const STUB_RECALL_TURNS = [
  { ts: '2026-06-01T12:00:00Z', app: 'forge',
    user_text: 'make a 50x30x10 aluminum bracket with M5 holes',
    assistant_summary: 'part.make-box + 4x sketch.add-circle', score: 0.78 },
  { ts: '2026-06-02T09:30:00Z', app: 'studio',
    user_text: 'design a wall mount fixture',
    assistant_summary: 'spawned + extruded plate', score: 0.51 },
];
const STUB_CAPTION = '{"bodies":[],"camera":{"angle_deg":0}}';
const STUB_REPLY =
  '<plan>{"goal":"upsize"}</plan>\n' +
  '<tool_call>{"name":"part.fillet-edges","arguments":{"radius":2}}</tool_call>';

test('Forge-163 — recall + remember wired into ForgeShellV4.runArchie', async () => {
  test.setTimeout(180000);

  const app = await electron.launch({
    args: [ELECTRON_MAIN, '--no-sandbox'],
    env: { ...process.env, FORGE_E2E: '1' },
  });
  const page = await app.firstWindow();
  page.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await page.waitForLoadState('domcontentloaded');

  // Capture every outgoing store + chat request.
  let recallHits = 0;
  const rememberPayloads = [];
  const chatBodies = [];
  await page.route('**/recall', async (route) => {
    recallHits++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ turns: STUB_RECALL_TURNS, ms: 14 }),
    });
  });
  await page.route('**/remember', async (route) => {
    try { rememberPayloads.push(JSON.parse(route.request().postData() || '{}')); } catch (_) {}
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 999, ms: 9 }),
    });
  });
  await page.route('**/caption', async (route) => {
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

  // Dismiss the OnboardingTour overlay.
  await page.evaluate(() => {
    try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {}
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__forgeRenderer && !!window.__forgeCamera, { timeout: 10000 });
  await page.waitForTimeout(500);

  const input = page.locator('[data-testid="forge-cmdbar-input"]');

  // ─── path 1: memory ON ───────────────────────────────────────────────
  chatBodies.length = 0;
  recallHits = 0;
  rememberPayloads.length = 0;
  const PROMPT_1 = 'now widen the bracket to 60x40x12';
  await input.click();
  await input.fill(PROMPT_1);
  await input.press('Enter');

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (chatBodies.some((b) => findUserMsg(b, PROMPT_1))) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT_DIR, 'after-memory-on.png') });

  expect(recallHits).toBeGreaterThanOrEqual(1);
  const onMsg = chatBodies.map((b) => findUserMsg(b, PROMPT_1)).find(Boolean);
  expect(onMsg).toBeTruthy();
  expect(onMsg.content).toContain('<prior_context>');
  expect(onMsg.content).toContain('50x30x10 aluminum bracket');
  expect(onMsg.content).toContain(PROMPT_1);
  // Order: prior_context BEFORE viewport_state BEFORE prompt.
  const pcIdx = onMsg.content.indexOf('<prior_context>');
  const vpIdx = onMsg.content.indexOf('<viewport_state>');
  const ptIdx = onMsg.content.indexOf(PROMPT_1);
  expect(pcIdx).toBeLessThan(vpIdx);
  expect(vpIdx).toBeLessThan(ptIdx);

  expect(rememberPayloads.length).toBeGreaterThanOrEqual(1);
  const remembered = rememberPayloads.find((p) => p.user_text === PROMPT_1);
  expect(remembered).toBeTruthy();
  expect(remembered.app).toBe('forge');
  // Tool calls from the trace should have been captured.
  expect(Array.isArray(remembered.tool_calls)).toBe(true);
  expect(remembered.tool_calls[0]?.name).toBe('part.fillet-edges');

  // ─── path 2: memory OFF ──────────────────────────────────────────────
  await page.evaluate(() => { window.__archieMemoryOff = true; });
  chatBodies.length = 0;
  recallHits = 0;
  rememberPayloads.length = 0;
  await page.waitForTimeout(400);
  const PROMPT_2 = 'blind run check forge';
  await input.click();
  await input.fill(PROMPT_2);
  await input.press('Enter');

  const d2 = Date.now() + 20000;
  while (Date.now() < d2) {
    if (chatBodies.some((b) => findUserMsg(b, PROMPT_2))) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT_DIR, 'after-memory-off.png') });

  expect(recallHits).toBe(0);
  const offMsg = chatBodies.map((b) => findUserMsg(b, PROMPT_2)).find(Boolean);
  expect(offMsg).toBeTruthy();
  expect(offMsg.content).not.toContain('<prior_context>');
  expect(rememberPayloads.length).toBe(0);

  await app.close();
});
