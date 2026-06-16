// v4-archie-conversational.spec.js — verifies the conversational-layer fix
// (user rule 2026-06-16: "make Archie conversational instead of spitting
// internal language"). The Archie dock must render a natural senior-designer
// line + a ▶/✓ humanized step list, with ZERO raw <plan>/<tool_call>/JSON.
//
// Requires: mlx_lm.server up on :8080 (runArchie hot-swaps adapters/archie/
// hermes_forge per-request) + frontend prod bundle built (npm run build).
// LIVE model — no mock. Uses a DIFFERENT prompt each run (vary-prompts rule).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-archie-conversational';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

// Rotating bank of DISTINCT prompts — pick a fresh one each run.
const PROMPTS = [
  'a 60x40x12 mm cover plate with a 20 mm centre bore',
  'a bushing, Ø30 outer, Ø18 bore, 25 mm long',
  'a 90x90x10 mm base plate, four Ø8 holes 12 mm in from the corners',
  'a spacer ring, Ø50 outer, Ø26 bore, 8 mm thick',
  'an 80x30x30 mm bracket with a Ø12 cross hole',
];
const PROMPT = PROMPTS[Date.now() % PROMPTS.length];

async function threadAll(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.forge-archie-msg')).map((el) => ({
      role: el.getAttribute('data-role'),
      text: (el.textContent || '').trim(),
    })));
}

test('Archie dock renders conversationally — no raw protocol tags', async () => {
  test.setTimeout(180000);
  const app = await _electron.launch({ args: [ELECTRON_MAIN, '--no-sandbox'], env: { ...process.env, FORGE_E2E: '1' } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.route('**/caption',  (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"caption":""}' }));
  await page.route('**/recall',   (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"turns":[]}' }));
  await page.route('**/remember', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":1}' }));
  await page.evaluate(() => { try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {} });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 30000 });
  await page.waitForFunction(() => !!(window.forge && window.forge.isReady && window.forge.isReady()), { timeout: 20000 });
  await page.waitForTimeout(500);

  console.log('[conversational] prompt →', PROMPT);
  const input = page.locator('[data-testid="forge-cmdbar-input"]');
  await input.click(); await input.fill(PROMPT); await input.press('Enter');

  // wait for at least one archie body to land (build happened) + settle
  const deadline = Date.now() + 90000;
  let bodies = 0;
  while (Date.now() < deadline) {
    bodies = await page.evaluate(() => (window.__forgeBodies || []).filter((b) => String(b.id || '').startsWith('archie-')).length);
    if (bodies >= 1) break;
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'dock-conversational.png') });

  const msgs = await threadAll(page);
  console.log('--- dock thread ---');
  for (const m of msgs) console.log(`[${m.role}] ${m.text.slice(0, 140)}`);

  const archie = msgs.filter((m) => m.role === 'archie');
  const tools = msgs.filter((m) => m.role === 'tool');
  const allText = msgs.map((m) => m.text).join('\n');

  // (1) ZERO raw protocol anywhere in the dock.
  expect(allText, 'dock must NOT contain raw <tool_call>/<plan>/<think> tags').not.toMatch(/<\/?(tool_call|plan|think)\b/);
  expect(allText, 'dock must NOT contain raw tool-call JSON').not.toMatch(/"name"\s*:\s*"(part|asset|sketch)\./);

  // (2) at least one humanized ▶/✓ step line (not raw JSON).
  expect(tools.some((m) => m.text.includes('▶')), `expected humanized ▶ step lines; tools: ${tools.map((t) => t.text).join(' | ')}`).toBe(true);

  // (3) a genuinely conversational final line (not the maxTurns fallback).
  expect(bodies, 'Archie should have built at least one body').toBeGreaterThanOrEqual(1);
  const finalArchie = archie.map((m) => m.text).join(' ');
  expect(finalArchie, 'archie bubble must not be the raw maxTurns hint').not.toMatch(/max turns/i);
  expect(finalArchie, `expected a conversational lead ("Here's …" / "Valid …"); got: ${finalArchie.slice(0, 160)}`).toMatch(/here's|valid|built|i'll/i);

  await app.close();
});
