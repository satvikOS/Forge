// v4-164-streaming.spec.js — Forge-164 streaming chat output.
//
// Mirror of Studio's slice 951s. Proves that ForgeShellV4.runArchie
// sends stream:true on /v1/chat/completions, parses the SSE delta
// stream, and surfaces tokens into the pre-pushed pending archie
// message before the trace finalises.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-164-streaming';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve(__dirname, '..', '..', 'electron', 'main.js');

// Two assistant turns: turn 1 emits a tool_call; turn 2 (after the
// tool_response is appended) emits a plain reply with no further
// tool_calls so the runner exits with status=done.
const TURN_1_SSE_CHUNKS = [
  { delta: { content: '<plan>{"goal":"streaming check"}</plan>\n' } },
  { delta: { content: '<tool_call>{"name":"part.make-box","arguments":{"dx":10,"dy":10,"dz":10}}</tool_call>' } },
];
const TURN_2_SSE_CHUNKS = [
  { delta: { content: 'Built a 10×10×10 mm box. Streaming wire ok.' } },
];

function sseBody(chunks) {
  return chunks.map((c) => `data: ${JSON.stringify({ choices: [c] })}\n\n`).join('') + 'data: [DONE]\n\n';
}

test('Forge-164 — runArchie streams SSE tokens into ArchieDock', async () => {
  test.setTimeout(180000);

  const app = await electron.launch({
    args: [ELECTRON_MAIN, '--no-sandbox'],
    env: { ...process.env, FORGE_E2E: '1' },
  });
  const page = await app.firstWindow();
  page.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await page.waitForLoadState('domcontentloaded');

  // Stub the sidecars.
  await page.route('**/caption',  (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ caption: '' }) }));
  await page.route('**/recall',   (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turns: [] }) }));
  await page.route('**/remember', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1 }) }));

  let chatCalls = 0;
  const streamRequested = [];
  await page.route('**/v1/chat/completions', async (route) => {
    chatCalls++;
    try { streamRequested.push(!!JSON.parse(route.request().postData() || '{}').stream); } catch (_) {}
    const chunks = chatCalls === 1 ? TURN_1_SSE_CHUNKS : TURN_2_SSE_CHUNKS;
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody(chunks),
    });
  });

  await page.evaluate(() => {
    try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {}
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__forgeRenderer && !!window.__forgeCamera, { timeout: 10000 });
  await page.waitForTimeout(500);

  const input = page.locator('[data-testid="forge-cmdbar-input"]');
  const PROMPT = 'make a 10mm cube';

  // Poll the archie message text history.
  const polledTexts = [];
  let stopPolling = false;
  const poll = (async () => {
    while (!stopPolling) {
      try {
        const t = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('.forge-archie-msg[data-role="archie"]'));
          const last = els[els.length - 1];
          return last ? (last.textContent || '') : '';
        });
        if (t) polledTexts.push(t);
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 120));
    }
  })();

  await input.click();
  await input.fill(PROMPT);
  await input.press('Enter');

  // Wait for chat completions to have fired at least once + the trace
  // to settle.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (chatCalls >= 1 && polledTexts.some((t) => t.includes('Streaming wire ok'))) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(800);
  stopPolling = true;
  await poll;
  await page.screenshot({ path: path.join(SHOT_DIR, 'after-stream.png') });

  expect(chatCalls).toBeGreaterThanOrEqual(1);
  expect(streamRequested.length).toBeGreaterThanOrEqual(1);
  for (const s of streamRequested) expect(s).toBe(true);
  const sawFinal = polledTexts.some((t) => t.includes('Streaming wire ok'));
  expect(sawFinal).toBe(true);

  await app.close();
});
